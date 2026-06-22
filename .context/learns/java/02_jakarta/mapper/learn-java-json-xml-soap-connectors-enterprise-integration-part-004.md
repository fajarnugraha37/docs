# learn-java-json-xml-soap-connectors-enterprise-integration-part-004

# Part 4 — JSON-P Streaming Deep Dive

> Seri: **learn-java-json-xml-soap-connectors-enterprise-integration**  
> Bagian: **Part 4 dari 34**  
> Topik: **JSON-P Streaming API, event-driven parsing, generator, large payload handling, partial extraction, dan desain pipeline produksi**  
> Target Java: **Java 8 sampai Java 25**  
> Fokus API: `javax.json.stream.*` dan `jakarta.json.stream.*`

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membangun mental model dasar JSON-P: object model, builder, reader, writer, provider, immutability, dan perbedaan JSON-P dengan JSON-B/Jackson.

Part ini masuk ke bagian yang lebih penting untuk engineer enterprise: **streaming**.

Streaming JSON-P adalah kemampuan memproses JSON sebagai **urutan event**, bukan sebagai satu tree penuh di memori. Ini menjadi krusial saat:

- payload besar;
- response dari external API sangat panjang;
- file JSON perlu diproses baris demi baris atau objek demi objek;
- sistem hanya butuh sebagian kecil field;
- ingin melakukan transformasi dari input stream ke output stream;
- service harus tahan terhadap memory pressure;
- integration pipeline harus bisa fail-fast sebelum membangun object model besar;
- payload berasal dari network, file, object storage, message queue, atau legacy batch system.

Setelah bagian ini, target pemahaman bukan sekadar tahu cara memakai `JsonParser`, tetapi mampu menjawab pertanyaan arsitektural:

> “Apakah payload ini harus dibaca sebagai object model, binding DTO, atau stream event?”

Dan lebih jauh:

> “Bagaimana mendesain parser yang aman, hemat memori, observable, recoverable, dan tidak rapuh terhadap perubahan kontrak?”

---

## 1. Posisi JSON-P Streaming dalam Peta Besar

JSON-P menyediakan dua gaya utama:

1. **Object Model API**  
   Representasi JSON sebagai struktur `JsonObject`, `JsonArray`, `JsonString`, `JsonNumber`, dan turunannya.

2. **Streaming API**  
   Representasi JSON sebagai aliran event seperti:

   - `START_OBJECT`
   - `END_OBJECT`
   - `START_ARRAY`
   - `END_ARRAY`
   - `KEY_NAME`
   - `VALUE_STRING`
   - `VALUE_NUMBER`
   - `VALUE_TRUE`
   - `VALUE_FALSE`
   - `VALUE_NULL`

Object model mirip DOM pada XML: nyaman, random access, tetapi seluruh struktur harus tersedia. Streaming model mirip StAX pada XML: lebih rendah level, lebih eksplisit, tetapi sangat kuat untuk payload besar.

Secara mental model:

```text
JSON text
   |
   v
+------------------+
| lexical scanner  |  karakter, escape, token
+------------------+
   |
   v
+------------------+
| JSON parser      |  event stream
+------------------+
   |
   v
START_OBJECT, KEY_NAME, VALUE_STRING, START_ARRAY, ...
```

Object model membangun tree dari event-event tersebut.

```text
JSON text -> parser events -> JsonObject/JsonArray tree
```

JSON-B biasanya berjalan lebih jauh lagi:

```text
JSON text -> parser events/tree -> Java object graph
```

Streaming API memungkinkan kita berhenti di layer event dan mengontrol sendiri keputusan:

- event mana yang dibaca;
- field mana yang diabaikan;
- kapan parser boleh berhenti;
- kapan value dikonversi;
- kapan error dianggap fatal;
- bagaimana output ditulis tanpa menyimpan semuanya di memori.

Inilah inti kekuatannya.

---

## 2. Kapan Streaming Wajib Dipertimbangkan

Streaming bukan selalu pilihan terbaik. Ia lebih verbose dan lebih manual. Tetapi pada sistem besar, ada kondisi yang membuat streaming jauh lebih tepat.

### 2.1 Payload Besar

Misalnya external API mengirim:

```json
{
  "batchId": "B-2026-001",
  "records": [
    { "id": "A001", "status": "APPROVED", "amount": 100.50 },
    { "id": "A002", "status": "REJECTED", "amount": 20.00 }
  ]
}
```

Jika `records` berisi 2 juta item, membangun `JsonObject` penuh berarti:

- seluruh input harus diparse;
- seluruh array disimpan;
- semua string/number/object dialokasikan;
- GC pressure naik;
- latency first-result tinggi;
- risiko OOM meningkat.

Dengan streaming, kita bisa memproses satu record pada satu waktu:

```text
read record 1 -> validate -> persist / emit / aggregate
read record 2 -> validate -> persist / emit / aggregate
...
```

Tidak perlu menyimpan semua record sekaligus.

### 2.2 Partial Extraction

Kadang kita hanya butuh field kecil dari payload besar:

```json
{
  "meta": {
    "requestId": "REQ-001",
    "producer": "external-system"
  },
  "massivePayload": [ ... 500 MB ... ],
  "signature": "..."
}
```

Jika hanya butuh `meta.requestId`, object model adalah overkill.

Streaming memungkinkan:

```text
scan until meta.requestId found -> return -> close parser
```

### 2.3 Gateway / Proxy / Transformation

Contoh service yang menerima JSON besar, mengganti beberapa field, lalu meneruskan ke sistem lain. Jika memakai tree penuh:

```text
read all -> build tree -> mutate tree -> write all
```

Dengan streaming:

```text
read event -> write event
           -> when field X, transform value
           -> continue
```

Ini mirip stream transducer.

### 2.4 Compliance / Audit Pipeline

Pada sistem regulatori, audit/event sering berupa payload besar. Kita sering butuh:

- extract correlation id;
- extract actor;
- extract timestamp;
- extract module/action;
- validate minimal fields;
- reject payload yang tidak sesuai;
- simpan payload mentah ke storage;
- index metadata saja.

Streaming cocok karena metadata dapat diekstrak tanpa mengikat seluruh payload ke DTO.

### 2.5 Defensive Parsing

Streaming memberi kesempatan untuk menerapkan batas:

- maksimum depth;
- maksimum jumlah field;
- maksimum jumlah array item;
- maksimum string length;
- maksimum angka;
- maksimum objek per batch;
- timeout/abort lebih awal.

Object binding sering gagal setelah banyak memori sudah terpakai. Streaming bisa gagal lebih awal.

---

## 3. API Utama Streaming JSON-P

Paket utama:

```java
javax.json.stream.*   // Java EE / Jakarta EE 8 era
jakarta.json.stream.* // Jakarta EE 9+
```

Interface penting:

```java
JsonParser
JsonGenerator
JsonParserFactory
JsonGeneratorFactory
JsonLocation
JsonParsingException
```

Factory biasanya dibuat lewat `Json` atau `JsonProvider`:

```java
JsonParser parser = Json.createParser(inputStream);
JsonGenerator generator = Json.createGenerator(outputStream);
```

Atau dengan factory:

```java
JsonParserFactory parserFactory = Json.createParserFactory(Map.of());
JsonGeneratorFactory generatorFactory = Json.createGeneratorFactory(Map.of());
```

Untuk Java 8, jika memakai Java EE 7/8 stack:

```java
import javax.json.Json;
import javax.json.stream.JsonParser;
```

Untuk Jakarta EE 9+:

```java
import jakarta.json.Json;
import jakarta.json.stream.JsonParser;
```

Perbedaan namespace ini penting ketika migrasi:

```text
javax.json.*  -> jakarta.json.*
```

Tetapi mental model API-nya tetap sangat mirip.

---

## 4. Mental Model `JsonParser`

`JsonParser` adalah cursor. Ia tidak memberikan object tree. Ia bergerak satu event demi satu event.

Pola umum:

```java
try (JsonParser parser = Json.createParser(inputStream)) {
    while (parser.hasNext()) {
        JsonParser.Event event = parser.next();
        // react to event
    }
}
```

Setiap `next()` memajukan parser ke event berikutnya.

Untuk mengambil value, kita harus tahu event saat ini:

```java
switch (event) {
    case KEY_NAME:
        String key = parser.getString();
        break;
    case VALUE_STRING:
        String value = parser.getString();
        break;
    case VALUE_NUMBER:
        BigDecimal number = parser.getBigDecimal();
        break;
}
```

Hal penting:

- `getString()` valid untuk `KEY_NAME` dan `VALUE_STRING`;
- `getInt()`, `getLong()`, `getBigDecimal()` valid untuk `VALUE_NUMBER`;
- memanggil accessor pada event yang salah adalah bug;
- parser bersifat forward-only;
- tidak ada random access;
- setelah event dilewati, ia tidak bisa dibaca ulang kecuali input diparse ulang.

---

## 5. Event Stream dari JSON Sederhana

Ambil JSON:

```json
{
  "id": "A001",
  "active": true,
  "score": 87,
  "tags": ["risk", "priority"]
}
```

Event stream-nya kira-kira:

```text
START_OBJECT
KEY_NAME        id
VALUE_STRING    A001
KEY_NAME        active
VALUE_TRUE
KEY_NAME        score
VALUE_NUMBER    87
KEY_NAME        tags
START_ARRAY
VALUE_STRING    risk
VALUE_STRING    priority
END_ARRAY
END_OBJECT
```

Ini perlu dibayangkan dengan jelas karena semua streaming parser bekerja di level seperti ini.

Object model menyembunyikan urutan ini. Streaming membuatnya eksplisit.

---

## 6. Contoh Dasar: Mencetak Event

```java
import jakarta.json.Json;
import jakarta.json.stream.JsonParser;

import java.io.InputStream;

public final class JsonEventPrinter {

    public static void printEvents(InputStream inputStream) {
        try (JsonParser parser = Json.createParser(inputStream)) {
            while (parser.hasNext()) {
                JsonParser.Event event = parser.next();

                switch (event) {
                    case KEY_NAME -> System.out.println("KEY_NAME: " + parser.getString());
                    case VALUE_STRING -> System.out.println("VALUE_STRING: " + parser.getString());
                    case VALUE_NUMBER -> System.out.println("VALUE_NUMBER: " + parser.getBigDecimal());
                    case VALUE_TRUE -> System.out.println("VALUE_TRUE");
                    case VALUE_FALSE -> System.out.println("VALUE_FALSE");
                    case VALUE_NULL -> System.out.println("VALUE_NULL");
                    case START_OBJECT -> System.out.println("START_OBJECT");
                    case END_OBJECT -> System.out.println("END_OBJECT");
                    case START_ARRAY -> System.out.println("START_ARRAY");
                    case END_ARRAY -> System.out.println("END_ARRAY");
                }
            }
        }
    }
}
```

Untuk Java 8, ganti arrow switch dengan switch klasik dan import `javax.json.*` jika menggunakan API lama.

---

## 7. Tracking Context: Kenapa Streaming Butuh State Machine

Kesalahan umum engineer saat memakai streaming parser adalah menganggap event berdiri sendiri.

Padahal event hanya bermakna jika dikombinasikan dengan konteks.

Contoh:

```json
{
  "user": {
    "id": "U001"
  },
  "case": {
    "id": "C001"
  }
}
```

Event `KEY_NAME id` muncul dua kali. Value setelahnya bisa berarti `user.id` atau `case.id`.

Karena itu streaming parser hampir selalu membutuhkan state:

- current key;
- current object path;
- current depth;
- apakah sedang berada dalam array tertentu;
- apakah sedang membaca object record;
- apakah value harus dikumpulkan atau di-skip.

Mental model yang benar:

```text
JsonParser = lexical/event source
Your code   = state machine / interpreter
```

Parser hanya memberi event. Kita yang memberi makna.

---

## 8. Path Tracking Minimal

Untuk memahami lokasi logis, kita bisa melacak stack path.

Contoh path:

```text
/user/id
/case/id
/records[]/amount
```

Implementasi sederhana:

```java
import jakarta.json.Json;
import jakarta.json.stream.JsonParser;

import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.Deque;

public final class PathAwareScanner {

    public static void scan(InputStream inputStream) {
        Deque<String> path = new ArrayDeque<>();
        String currentKey = null;

        try (JsonParser parser = Json.createParser(inputStream)) {
            while (parser.hasNext()) {
                JsonParser.Event event = parser.next();

                switch (event) {
                    case KEY_NAME -> currentKey = parser.getString();

                    case START_OBJECT, START_ARRAY -> {
                        if (currentKey != null) {
                            path.addLast(currentKey);
                            currentKey = null;
                        }
                    }

                    case END_OBJECT, END_ARRAY -> {
                        if (!path.isEmpty()) {
                            path.removeLast();
                        }
                    }

                    case VALUE_STRING, VALUE_NUMBER, VALUE_TRUE, VALUE_FALSE, VALUE_NULL -> {
                        String fullPath = buildPath(path, currentKey);
                        System.out.println(fullPath + " -> " + event);
                        currentKey = null;
                    }
                }
            }
        }
    }

    private static String buildPath(Deque<String> path, String currentKey) {
        StringBuilder sb = new StringBuilder();
        for (String p : path) {
            sb.append('/').append(p);
        }
        if (currentKey != null) {
            sb.append('/').append(currentKey);
        }
        return sb.length() == 0 ? "/" : sb.toString();
    }
}
```

Ini belum sempurna untuk array index, tetapi cukup untuk menunjukkan prinsip: streaming parsing adalah stateful interpretation.

---

## 9. Partial Extraction: Mengambil Field Tertentu Tanpa Tree

Misalnya kita hanya ingin mengambil `meta.requestId`.

Payload:

```json
{
  "meta": {
    "requestId": "REQ-2026-0001",
    "source": "external-agency"
  },
  "records": [
    { "id": "A001" },
    { "id": "A002" }
  ]
}
```

Strategi:

1. scan event;
2. masuk ke object `meta`;
3. cari key `requestId`;
4. baca value string;
5. return langsung;
6. close parser/input.

```java
import jakarta.json.Json;
import jakarta.json.stream.JsonParser;

import java.io.InputStream;
import java.util.Optional;

public final class RequestIdExtractor {

    public static Optional<String> extractRequestId(InputStream inputStream) {
        boolean insideMeta = false;
        int metaDepth = -1;
        int depth = 0;
        String currentKey = null;

        try (JsonParser parser = Json.createParser(inputStream)) {
            while (parser.hasNext()) {
                JsonParser.Event event = parser.next();

                switch (event) {
                    case START_OBJECT -> {
                        depth++;
                        if ("meta".equals(currentKey)) {
                            insideMeta = true;
                            metaDepth = depth;
                        }
                        currentKey = null;
                    }
                    case END_OBJECT -> {
                        if (insideMeta && depth == metaDepth) {
                            insideMeta = false;
                            metaDepth = -1;
                        }
                        depth--;
                        currentKey = null;
                    }
                    case START_ARRAY -> {
                        depth++;
                        currentKey = null;
                    }
                    case END_ARRAY -> {
                        depth--;
                        currentKey = null;
                    }
                    case KEY_NAME -> currentKey = parser.getString();
                    case VALUE_STRING -> {
                        if (insideMeta && "requestId".equals(currentKey)) {
                            return Optional.of(parser.getString());
                        }
                        currentKey = null;
                    }
                    case VALUE_NUMBER, VALUE_TRUE, VALUE_FALSE, VALUE_NULL -> currentKey = null;
                }
            }
        }

        return Optional.empty();
    }
}
```

Catatan desain:

- extraction tidak perlu tahu schema penuh;
- cocok untuk correlation id, request id, tenant id, module id, signature reference;
- jangan pakai ini untuk object kompleks jika mapping DTO lebih jelas;
- tetap perlu batas depth dan size untuk input tidak dipercaya.

---

## 10. Membaca Array Besar sebagai Record Stream

Payload batch umum:

```json
{
  "batchId": "B-001",
  "records": [
    { "id": "A001", "status": "APPROVED", "amount": 100.50 },
    { "id": "A002", "status": "REJECTED", "amount": 25.00 }
  ]
}
```

Kita ingin memproses satu record per satu.

Pendekatan sederhana:

- cari key `records`;
- saat masuk array `records`, setiap `START_OBJECT` pada depth record dikumpulkan menjadi object kecil;
- setelah `END_OBJECT`, proses record tersebut.

Ada dua pendekatan:

1. **Full manual field parsing**  
   Field `id`, `status`, `amount` dibaca langsung dari event.

2. **Hybrid streaming + object model per item**  
   Seluruh batch tidak dijadikan tree, tetapi setiap record kecil dibangun sebagai `JsonObject`.

Pendekatan kedua sering paling seimbang.

---

## 11. Hybrid Pattern: Streaming Outer, Object Model Inner

Ini pattern produksi yang sangat berguna:

```text
large JSON batch
    -> stream sampai records[]
    -> untuk setiap item, build JsonObject kecil
    -> validate/process item
    -> discard item
```

Dengan cara ini:

- memori hanya sebesar satu record;
- code tidak terlalu manual;
- validasi per item lebih mudah;
- bisa integrasi dengan JSON-B/Jackson per item jika perlu.

Contoh utilitas membaca satu object dari parser current position sedikit tricky karena JSON-P object model `JsonReader` biasanya membaca dari stream mentah, bukan dari posisi parser. Untuk pattern hybrid, kita bisa menggunakan `JsonGenerator` ke buffer untuk satu object lalu parse ulang, atau membangun `JsonObjectBuilder` manual.

Untuk field sederhana, manual builder cukup.

```java
import jakarta.json.Json;
import jakarta.json.JsonObject;
import jakarta.json.JsonObjectBuilder;
import jakarta.json.stream.JsonParser;

import java.io.InputStream;
import java.math.BigDecimal;
import java.util.function.Consumer;

public final class RecordStreamingReader {

    public static void readRecords(InputStream inputStream, Consumer<JsonObject> consumer) {
        boolean expectingRecordsArray = false;
        boolean insideRecordsArray = false;
        boolean insideRecord = false;

        int depth = 0;
        int recordsArrayDepth = -1;
        int recordDepth = -1;

        String currentKey = null;
        JsonObjectBuilder recordBuilder = null;

        try (JsonParser parser = Json.createParser(inputStream)) {
            while (parser.hasNext()) {
                JsonParser.Event event = parser.next();

                switch (event) {
                    case KEY_NAME -> {
                        currentKey = parser.getString();
                        if (!insideRecord && "records".equals(currentKey)) {
                            expectingRecordsArray = true;
                        }
                    }

                    case START_ARRAY -> {
                        depth++;
                        if (expectingRecordsArray) {
                            insideRecordsArray = true;
                            recordsArrayDepth = depth;
                            expectingRecordsArray = false;
                        }
                        currentKey = null;
                    }

                    case END_ARRAY -> {
                        if (insideRecordsArray && depth == recordsArrayDepth) {
                            insideRecordsArray = false;
                            recordsArrayDepth = -1;
                        }
                        depth--;
                        currentKey = null;
                    }

                    case START_OBJECT -> {
                        depth++;
                        if (insideRecordsArray && !insideRecord && depth == recordsArrayDepth + 1) {
                            insideRecord = true;
                            recordDepth = depth;
                            recordBuilder = Json.createObjectBuilder();
                        }
                        currentKey = null;
                    }

                    case END_OBJECT -> {
                        if (insideRecord && depth == recordDepth) {
                            consumer.accept(recordBuilder.build());
                            insideRecord = false;
                            recordDepth = -1;
                            recordBuilder = null;
                        }
                        depth--;
                        currentKey = null;
                    }

                    case VALUE_STRING -> {
                        if (insideRecord && currentKey != null) {
                            recordBuilder.add(currentKey, parser.getString());
                        }
                        currentKey = null;
                    }

                    case VALUE_NUMBER -> {
                        if (insideRecord && currentKey != null) {
                            BigDecimal number = parser.getBigDecimal();
                            recordBuilder.add(currentKey, number);
                        }
                        currentKey = null;
                    }

                    case VALUE_TRUE -> {
                        if (insideRecord && currentKey != null) {
                            recordBuilder.add(currentKey, true);
                        }
                        currentKey = null;
                    }

                    case VALUE_FALSE -> {
                        if (insideRecord && currentKey != null) {
                            recordBuilder.add(currentKey, false);
                        }
                        currentKey = null;
                    }

                    case VALUE_NULL -> {
                        if (insideRecord && currentKey != null) {
                            recordBuilder.addNull(currentKey);
                        }
                        currentKey = null;
                    }
                }
            }
        }
    }
}
```

Limitasi contoh ini:

- hanya mendukung field scalar di record;
- belum mendukung nested object/array di dalam record;
- belum ada validasi size/depth;
- belum ada error recovery per record;
- belum ada path-based diagnostics.

Tetapi mental model-nya benar: stream outer, process inner.

---

## 12. Pattern Lebih Kuat: Copy Subtree dengan Generator

Jika record berisi nested object/array, kita perlu cara menyalin subtree dari parser ke generator.

Misalnya record:

```json
{
  "id": "A001",
  "owner": {
    "name": "Alice",
    "contacts": ["email", "sms"]
  }
}
```

Kita bisa membaca event dari `START_OBJECT` sampai pasangan `END_OBJECT` pada depth yang sama, lalu menulisnya ke `JsonGenerator`.

```java
import jakarta.json.Json;
import jakarta.json.JsonObject;
import jakarta.json.JsonReader;
import jakarta.json.stream.JsonGenerator;
import jakarta.json.stream.JsonParser;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

public final class JsonSubtreeCopier {

    public static JsonObject readCurrentObjectAsJsonObject(JsonParser parser) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        try (JsonGenerator generator = Json.createGenerator(out)) {
            copyObject(parser, generator);
        }

        byte[] bytes = out.toByteArray();
        try (JsonReader reader = Json.createReader(new ByteArrayInputStream(bytes))) {
            return reader.readObject();
        }
    }

    /**
     * Precondition: current parser event is START_OBJECT.
     */
    private static void copyObject(JsonParser parser, JsonGenerator generator) {
        int depth = 0;
        JsonParser.Event event = JsonParser.Event.START_OBJECT;

        while (true) {
            switch (event) {
                case START_OBJECT -> {
                    generator.writeStartObject();
                    depth++;
                }
                case END_OBJECT -> {
                    generator.writeEnd();
                    depth--;
                    if (depth == 0) {
                        return;
                    }
                }
                case START_ARRAY -> {
                    generator.writeStartArray();
                    depth++;
                }
                case END_ARRAY -> {
                    generator.writeEnd();
                    depth--;
                }
                case KEY_NAME -> generator.writeKey(parser.getString());
                case VALUE_STRING -> generator.write(parser.getString());
                case VALUE_NUMBER -> generator.write(parser.getBigDecimal());
                case VALUE_TRUE -> generator.write(true);
                case VALUE_FALSE -> generator.write(false);
                case VALUE_NULL -> generator.writeNull();
            }

            if (!parser.hasNext()) {
                throw new IllegalStateException("Unexpected end of JSON while copying object subtree");
            }
            event = parser.next();
        }
    }
}
```

Penting: contoh ini menunjukkan teknik, bukan implementasi final enterprise-ready. Dalam produksi, perlu:

- batas ukuran buffer per subtree;
- batas depth;
- error message dengan lokasi;
- karakter encoding konsisten UTF-8;
- tidak menggunakan `ByteArrayOutputStream` jika subtree bisa sangat besar;
- metric untuk jumlah record, ukuran record, dan durasi parse.

---

## 13. `JsonGenerator`: Menulis JSON Secara Streaming

`JsonGenerator` adalah kebalikan dari `JsonParser`.

Parser:

```text
JSON text -> events
```

Generator:

```text
events / method calls -> JSON text
```

Contoh sederhana:

```java
import jakarta.json.Json;
import jakarta.json.stream.JsonGenerator;

import java.io.OutputStream;

public final class SimpleJsonWriter {

    public static void write(OutputStream outputStream) {
        try (JsonGenerator generator = Json.createGenerator(outputStream)) {
            generator.writeStartObject()
                    .write("id", "A001")
                    .write("active", true)
                    .write("score", 87)
                    .writeStartArray("tags")
                        .write("risk")
                        .write("priority")
                    .writeEnd()
                    .writeEnd();
        }
    }
}
```

Output:

```json
{"id":"A001","active":true,"score":87,"tags":["risk","priority"]}
```

Generator biasanya tidak menyimpan seluruh output. Ia menulis ke target stream.

Karena itu cocok untuk:

- response besar;
- export file;
- batch API;
- proxy/transformer;
- NDJSON-like generation jika memakai generator per object;
- memory-efficient report output.

---

## 14. Generator adalah State Machine Juga

`JsonGenerator` akan menjaga state struktur JSON.

Contoh benar:

```java
generator.writeStartObject()
         .write("id", "A001")
         .writeEnd();
```

Contoh salah:

```java
generator.write("id", "A001");
```

Jika belum berada dalam object, menulis key-value tidak valid.

Contoh salah lain:

```java
generator.writeStartArray()
         .write("id", "A001")
         .writeEnd();
```

Dalam array, value boleh ditulis, tetapi key-value pair seperti `write("id", "A001")` biasanya hanya valid di dalam object. Untuk array harus:

```java
generator.writeStartArray()
         .write("A001")
         .write("A002")
         .writeEnd();
```

Mental model:

```text
JsonGenerator = structural writer
Your code     = producer state machine
```

Generator bukan templating engine. Ia tidak tahu domain. Ia hanya memastikan struktur JSON valid.

---

## 15. Pretty Printing dan Konfigurasi Generator

JSON-P menyediakan konfigurasi generator, salah satunya pretty printing.

```java
import jakarta.json.Json;
import jakarta.json.stream.JsonGenerator;
import jakarta.json.stream.JsonGeneratorFactory;

import java.io.OutputStream;
import java.util.Map;

public final class PrettyJsonWriter {

    public static void writePretty(OutputStream outputStream) {
        JsonGeneratorFactory factory = Json.createGeneratorFactory(
                Map.of(JsonGenerator.PRETTY_PRINTING, true)
        );

        try (JsonGenerator generator = factory.createGenerator(outputStream)) {
            generator.writeStartObject()
                    .write("id", "A001")
                    .write("status", "APPROVED")
                    .writeEnd();
        }
    }
}
```

Production guidance:

- pretty printing berguna untuk debug, test snapshot, fixture, dan human-readable files;
- untuk network high-throughput, compact JSON biasanya lebih efisien;
- pretty printing tidak boleh menjadi mekanisme canonicalization;
- jika butuh deterministic JSON untuk signature/hash, desain canonicalization terpisah.

---

## 16. Streaming Transform: Parser ke Generator

Kasus: kita menerima payload, lalu ingin meneruskan JSON yang sama tetapi mengganti field `status`.

Input:

```json
{
  "id": "A001",
  "status": "PENDING",
  "amount": 100
}
```

Output:

```json
{
  "id": "A001",
  "status": "APPROVED",
  "amount": 100
}
```

Kita bisa stream-copy dengan transformasi kecil.

```java
import jakarta.json.Json;
import jakarta.json.stream.JsonGenerator;
import jakarta.json.stream.JsonParser;

import java.io.InputStream;
import java.io.OutputStream;

public final class StatusTransformingProxy {

    public static void transform(InputStream inputStream, OutputStream outputStream) {
        String currentKey = null;

        try (JsonParser parser = Json.createParser(inputStream);
             JsonGenerator generator = Json.createGenerator(outputStream)) {

            while (parser.hasNext()) {
                JsonParser.Event event = parser.next();

                switch (event) {
                    case START_OBJECT -> generator.writeStartObject();
                    case END_OBJECT -> generator.writeEnd();
                    case START_ARRAY -> generator.writeStartArray();
                    case END_ARRAY -> generator.writeEnd();
                    case KEY_NAME -> {
                        currentKey = parser.getString();
                        generator.writeKey(currentKey);
                    }
                    case VALUE_STRING -> {
                        if ("status".equals(currentKey)) {
                            generator.write("APPROVED");
                        } else {
                            generator.write(parser.getString());
                        }
                        currentKey = null;
                    }
                    case VALUE_NUMBER -> {
                        generator.write(parser.getBigDecimal());
                        currentKey = null;
                    }
                    case VALUE_TRUE -> {
                        generator.write(true);
                        currentKey = null;
                    }
                    case VALUE_FALSE -> {
                        generator.write(false);
                        currentKey = null;
                    }
                    case VALUE_NULL -> {
                        generator.writeNull();
                        currentKey = null;
                    }
                }
            }
        }
    }
}
```

Namun ini masih terlalu naif untuk produksi karena setiap field bernama `status` akan diganti, termasuk nested status.

Top 1% engineer tidak berhenti di “works on sample”. Ia bertanya:

- status di path mana yang boleh diubah?
- bagaimana jika ada `case.status` dan `payment.status`?
- bagaimana jika field order berubah?
- bagaimana jika `status` bukan string?
- bagaimana jika status hilang?
- bagaimana jika ada duplicate key?
- bagaimana observability transformasi dilakukan?

---

## 17. Path-Aware Streaming Transform

Transformasi produksi harus path-aware.

Misalnya hanya ubah `/case/status`, bukan semua `status`.

```json
{
  "case": {
    "id": "C001",
    "status": "PENDING"
  },
  "payment": {
    "status": "UNPAID"
  }
}
```

Target:

```text
/case/status -> APPROVED
/payment/status -> unchanged
```

Untuk itu kita butuh path stack seperti di bagian sebelumnya.

Prinsipnya:

```text
on KEY_NAME:
    remember key
    write key
on scalar value:
    build path from stack + key
    if path == /case/status, transform
    else copy
```

Ini lebih aman daripada key-only transform.

Dalam integrasi enterprise, key-only transform adalah sumber bug serius karena kontrak JSON sering punya field bernama sama di banyak level.

---

## 18. Depth Limit: Perlindungan dari JSON Terlalu Dalam

Payload malicious atau buggy bisa sangat dalam:

```json
[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]
```

Masalah:

- parser bisa menghabiskan CPU;
- logic path stack bisa membengkak;
- downstream object builder bisa stack/memory pressure;
- validasi bisa lambat;
- log error bisa membesar.

Saat streaming, kita bisa membatasi depth.

```java
public final class DepthGuard {

    private final int maxDepth;
    private int depth;

    public DepthGuard(int maxDepth) {
        if (maxDepth < 1) {
            throw new IllegalArgumentException("maxDepth must be positive");
        }
        this.maxDepth = maxDepth;
    }

    public void onEvent(jakarta.json.stream.JsonParser.Event event) {
        switch (event) {
            case START_OBJECT, START_ARRAY -> {
                depth++;
                if (depth > maxDepth) {
                    throw new IllegalArgumentException("JSON depth exceeds limit: " + maxDepth);
                }
            }
            case END_OBJECT, END_ARRAY -> depth--;
            default -> {
                // no-op
            }
        }
    }
}
```

Production rule of thumb:

- external API request body: depth limit eksplisit;
- internal trusted file: tetap beri limit, tetapi bisa lebih longgar;
- audit payload: limit tergantung domain;
- config JSON: limit rendah;
- integration batch: limit sesuai schema.

Jangan memakai angka universal. Gunakan angka berbasis kontrak.

---

## 19. Array Item Limit

Payload berikut bisa menghabiskan resource:

```json
{
  "records": [ ... 100 million items ... ]
}
```

Jika sistem Anda hanya menerima maksimum 10.000 record per batch, parser harus enforce limit.

```java
public final class ArrayItemLimit {

    private final int maxItems;
    private int count;

    public ArrayItemLimit(int maxItems) {
        this.maxItems = maxItems;
    }

    public void onRecordStart() {
        count++;
        if (count > maxItems) {
            throw new IllegalArgumentException("Too many records. Max allowed: " + maxItems);
        }
    }

    public int count() {
        return count;
    }
}
```

Di parser record:

```java
if (insideRecordsArray && event == JsonParser.Event.START_OBJECT) {
    limit.onRecordStart();
}
```

Prinsip:

> Streaming bukan hanya untuk performa. Streaming adalah tempat terbaik untuk memasang guardrail struktural.

---

## 20. String Length Limit

JSON string besar dapat menjadi masalah:

```json
{
  "comment": "... 100 MB text ..."
}
```

Masalahnya, saat kita memanggil `parser.getString()`, string sudah materialized sebagai Java `String`.

Karena JSON-P streaming API bekerja di level token, ia tidak memberikan chunk string secara bertahap seperti reader karakter. Jadi limit string panjang tidak selalu bisa dicegah sebelum value dibangun oleh provider.

Tetapi kita tetap bisa melakukan guard setelah value dibaca:

```java
String value = parser.getString();
if (value.length() > maxLength) {
    throw new IllegalArgumentException("String value too long for field: " + currentPath);
}
```

Untuk benar-benar membatasi sebelum materialization, perlu layer lain:

- request size limit di server/gateway;
- input stream wrapper yang membatasi bytes;
- reverse proxy limit;
- message broker max payload;
- object storage metadata validation;
- custom low-level parser jika requirement ekstrem.

Top 1% perspective:

> Jangan mengandalkan parser API untuk semua proteksi. Resource boundary harus dipasang berlapis: transport, container, stream, parser, domain validation.

---

## 21. Numeric Precision dan Streaming

JSON number tidak punya tipe eksplisit seperti Java `int`, `long`, atau `BigDecimal`.

Contoh:

```json
{
  "amount": 100.50,
  "count": 42,
  "huge": 999999999999999999999999999999999999999
}
```

Dengan streaming:

```java
BigDecimal value = parser.getBigDecimal();
```

Ini paling aman untuk angka enterprise seperti money, score, amount, tax, fee.

Hati-hati dengan:

```java
int i = parser.getInt();
long l = parser.getLong();
double d = parser.getBigDecimal().doubleValue();
```

Masalah:

- overflow;
- precision loss;
- rounding tidak eksplisit;
- nilai fractional masuk ke integer;
- scientific notation dapat mengejutkan;
- downstream DB punya precision/scale berbeda.

Pattern aman:

```java
BigDecimal amount = parser.getBigDecimal();
amount = amount.setScale(2, RoundingMode.UNNECESSARY);
```

Jika scale salah, exception muncul. Ini lebih baik daripada silently rounding.

---

## 22. Duplicate Keys: Masalah yang Sering Diremehkan

JSON secara praktis sering dianggap object sebagai map. Tetapi input bisa punya duplicate key:

```json
{
  "id": "A001",
  "id": "A002"
}
```

Apa artinya?

- parser event akan melihat dua `KEY_NAME id`;
- object model/provider bisa mengambil last value, first value, atau behavior tertentu;
- security-sensitive payload bisa disalahgunakan;
- audit trail bisa ambigu;
- signature/canonicalization bisa bermasalah.

Streaming memberi kesempatan mendeteksi duplicate key per object.

Pseudo-design:

```text
on START_OBJECT:
    push new Set<String>
on KEY_NAME:
    if key exists in top Set -> reject
    else add key
on END_OBJECT:
    pop Set
```

Implementasi sederhana:

```java
import jakarta.json.stream.JsonParser;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Set;

public final class DuplicateKeyGuard {

    private final Deque<Set<String>> objectKeys = new ArrayDeque<>();

    public void onEvent(JsonParser parser, JsonParser.Event event) {
        switch (event) {
            case START_OBJECT -> objectKeys.addLast(new HashSet<>());
            case END_OBJECT -> objectKeys.removeLast();
            case KEY_NAME -> {
                String key = parser.getString();
                Set<String> current = objectKeys.peekLast();
                if (current != null && !current.add(key)) {
                    throw new IllegalArgumentException("Duplicate JSON key in same object: " + key);
                }
            }
            default -> {
                // no-op
            }
        }
    }
}
```

Pada API publik atau payload yang berdampak hukum/regulasi, duplicate key sebaiknya ditolak.

---

## 23. Error Location dan Diagnostics

`JsonParser` menyediakan lokasi melalui `getLocation()` pada beberapa situasi.

Ketika terjadi parse error, provider biasanya melempar `JsonParsingException` dengan lokasi.

Contoh:

```java
import jakarta.json.Json;
import jakarta.json.stream.JsonLocation;
import jakarta.json.stream.JsonParser;
import jakarta.json.stream.JsonParsingException;

import java.io.InputStream;

public final class SafeParserRunner {

    public static void parse(InputStream inputStream) {
        try (JsonParser parser = Json.createParser(inputStream)) {
            while (parser.hasNext()) {
                JsonParser.Event event = parser.next();
                // process event
            }
        } catch (JsonParsingException e) {
            JsonLocation location = e.getLocation();
            throw new IllegalArgumentException(
                    "Invalid JSON at line=" + location.getLineNumber()
                            + ", column=" + location.getColumnNumber()
                            + ", offset=" + location.getStreamOffset(),
                    e
            );
        }
    }
}
```

Diagnostics yang baik harus menjawab:

- error terjadi di line/column/offset mana;
- field/path apa yang sedang diproses;
- rule apa yang dilanggar;
- request/correlation id apa;
- input berasal dari source mana;
- apakah error parse, validation, transform, atau downstream.

Jangan log seluruh payload besar atau sensitif. Log metadata dan potongan aman.

---

## 24. Fail-Fast vs Error Accumulation

Saat streaming, ada dua strategi error:

### 24.1 Fail-Fast

Begitu menemukan error, hentikan.

Cocok untuk:

- API request;
- security validation;
- schema critical;
- payload kecil/sedang;
- transaction harus atomic.

Contoh:

```text
record 17 invalid -> reject whole batch
```

### 24.2 Error Accumulation

Tetap proses item lain dan kumpulkan error per record.

Cocok untuk:

- batch import;
- nightly integration;
- regulatory file submission;
- partial acceptance;
- human correction workflow.

Contoh:

```text
10.000 records submitted
9.930 accepted
70 rejected with row-level reasons
```

Tetapi error accumulation dalam streaming sulit jika:

- JSON secara struktural invalid;
- array tidak bisa dilanjutkan;
- parser kehilangan sinkronisasi;
- record nested rusak.

Prinsip:

- parse error struktural biasanya fatal;
- domain validation per record bisa accumulated;
- downstream persistence error bisa retried atau dead-lettered tergantung idempotency.

---

## 25. Batch Processing Design dengan Streaming

Misalnya Anda menerima batch external agency:

```json
{
  "batchId": "B-2026-0001",
  "submittedAt": "2026-06-17T10:00:00Z",
  "records": [ ... ]
}
```

Pipeline ideal:

```text
InputStream
  -> byte limit wrapper
  -> JsonParser
  -> structural guard
       - max depth
       - duplicate key
       - max records
  -> header extractor
       - batchId
       - submittedAt
       - source
  -> record iterator
       - per record JsonObject/DTO
       - validation
       - idempotency key
       - persistence/event emit
  -> summary result
```

Bukan:

```text
read whole request body into String
  -> parse into JsonObject
  -> map entire thing into DTO
  -> loop all records
```

Pendekatan kedua hanya aman untuk payload kecil dan predictable.

---

## 26. Membuat Iterator Record Berbasis Streaming

Agar pipeline bersih, jangan biarkan seluruh service method berisi `while(parser.hasNext())` raksasa.

Lebih baik bungkus sebagai iterator/domain reader.

Contoh konsep:

```java
public interface RecordReader<T> extends AutoCloseable {
    boolean hasNext();
    T next();
    BatchHeader header();
}
```

Implementasi streaming menyembunyikan detail parser.

```text
Controller / Job
    -> RecordReader<RecordPayload>
        -> JsonParser
        -> guards
        -> extraction logic
```

Manfaat:

- parser complexity terisolasi;
- test lebih mudah;
- contract-specific reader bisa dibuat per external system;
- observability bisa distandardisasi;
- migrasi provider lebih aman.

---

## 27. Kenapa Tidak Selalu Memakai Jackson Streaming?

Jackson juga punya streaming API (`JsonParser`, `JsonGenerator`) yang sangat populer dan powerful. Pertanyaan wajar: kenapa belajar JSON-P streaming?

Jawabannya bukan “JSON-P lebih baik”. Jawabannya: **beda posisi**.

JSON-P unggul saat:

- ingin standard Jakarta API;
- berjalan di Jakarta EE runtime;
- ingin portable across compliant implementation;
- ingin integrasi natural dengan JSON-B/Jakarta stack;
- ingin dependency surface lebih standar;
- membuat library yang tidak ingin hard-bind ke Jackson.

Jackson unggul saat:

- butuh fitur ekosistem luas;
- butuh performa dan konfigurasi kompleks;
- butuh polymorphic binding advanced;
- butuh mature module ecosystem;
- berjalan di Spring ecosystem;
- butuh NDJSON/Smile/CBOR/YAML extension;
- butuh very fine-grained parser constraints modern.

Top engineer tidak fanatik. Ia memilih berdasarkan runtime, constraint, maintainability, dan risk.

Decision simplification:

```text
Jakarta EE portable integration?      JSON-P/JSON-B
Spring Boot app standard?             Jackson default
Huge payload with Jakarta boundary?   JSON-P streaming
Huge payload with Jackson ecosystem?  Jackson streaming
Simple DTO API?                       JSON-B/Jackson binding
Contract-level transformation?        Streaming parser/generator
```

---

## 28. JSON-P Streaming dan Backpressure

JSON-P streaming API sendiri bersifat blocking dan pull-based:

```java
while (parser.hasNext()) {
    Event e = parser.next();
}
```

Artinya code kita menarik event dari input.

Ini bukan reactive-streams API. Tidak ada `Publisher`, `Subscriber`, `request(n)`, atau backpressure protocol formal.

Namun streaming tetap membantu karena:

- kita tidak membangun seluruh payload;
- kita bisa memproses bertahap;
- kita bisa flush output bertahap;
- kita bisa berhenti lebih awal;
- kita bisa mengontrol batch commit size.

Jika masuk ke sistem reactive/non-blocking, jangan otomatis memasukkan JSON-P blocking parser ke event loop. Desain yang lebih aman:

```text
network non-blocking layer
  -> bounded buffer / temp file / worker thread
  -> blocking streaming parser on worker pool
  -> bounded output queue
```

Atau gunakan parser non-blocking yang memang dirancang untuk itu jika requirement-nya ketat.

---

## 29. Integrasi dengan HTTP Response Besar

Untuk endpoint yang menghasilkan JSON besar:

```json
{
  "items": [ ... many records ... ]
}
```

Generator memungkinkan output bertahap.

Pseudo-code server-side:

```java
try (JsonGenerator generator = Json.createGenerator(outputStream)) {
    generator.writeStartObject();
    generator.writeStartArray("items");

    for (Item item : repository.streamItems(criteria)) {
        generator.writeStartObject()
                .write("id", item.id())
                .write("name", item.name())
                .writeEnd();
    }

    generator.writeEnd(); // items
    generator.writeEnd(); // root
}
```

Hal produksi yang harus dipikirkan:

- database cursor/stream harus ditutup;
- transaction jangan terlalu panjang jika output lambat;
- client disconnect harus ditangani;
- pagination sering lebih aman daripada single huge response;
- timeout reverse proxy bisa memutus response;
- compression bisa menambah memory/CPU behavior;
- output yang sudah sebagian terkirim tidak bisa “di-rollback”.

Karena response streaming tidak atomic, error di tengah output sulit direpresentasikan sebagai JSON valid.

Contoh problem:

```json
{
  "items": [
    { "id": "1" },
    { "id": "2" },
```

Jika error terjadi di sini, response rusak. Maka untuk API publik, pagination biasanya lebih robust daripada streaming JSON array sangat besar.

---

## 30. NDJSON: Bukan JSON Array Biasa

NDJSON atau newline-delimited JSON sering dipakai untuk log/batch:

```text
{"id":"A001","status":"APPROVED"}
{"id":"A002","status":"REJECTED"}
{"id":"A003","status":"PENDING"}
```

Ini bukan satu JSON document berupa array. Ini banyak JSON object dipisahkan newline.

JSON-P parser standar membaca satu JSON document. Untuk NDJSON, pattern-nya biasanya:

```text
read line by line
  -> parse each line as JsonObject
  -> process
```

Contoh:

```java
import jakarta.json.Json;
import jakarta.json.JsonObject;
import jakarta.json.JsonReader;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.Reader;
import java.io.StringReader;
import java.util.function.Consumer;

public final class NdjsonReader {

    public static void read(Reader reader, Consumer<JsonObject> consumer) throws IOException {
        BufferedReader buffered = new BufferedReader(reader);
        String line;
        long lineNo = 0;

        while ((line = buffered.readLine()) != null) {
            lineNo++;
            if (line.isBlank()) {
                continue;
            }

            try (JsonReader jsonReader = Json.createReader(new StringReader(line))) {
                consumer.accept(jsonReader.readObject());
            } catch (RuntimeException e) {
                throw new IllegalArgumentException("Invalid NDJSON object at line " + lineNo, e);
            }
        }
    }
}
```

Untuk file besar, NDJSON sering lebih recoverable daripada satu array besar karena error bisa dilokalisasi per line, asalkan kontrak memang mendukung partial failure.

---

## 31. Resource Management

`JsonParser` dan `JsonGenerator` harus ditutup.

```java
try (JsonParser parser = Json.createParser(inputStream)) {
    // parse
}
```

```java
try (JsonGenerator generator = Json.createGenerator(outputStream)) {
    // write
}
```

Pertanyaan penting: apakah menutup parser/generator menutup underlying stream?

Secara praktis, banyak implementasi akan menutup resource terkait, tetapi desain ownership harus eksplisit:

- jika method menerima `InputStream`, siapa pemilik stream?
- apakah method boleh menutupnya?
- jika parser dibuat di dalam method, try-with-resources parser benar;
- jika stream dimiliki container HTTP, hati-hati menutup output terlalu awal;
- jika pipeline chaining, closing harus jelas.

Rule sederhana:

```text
The component that opens resource should usually close resource.
The component that wraps parser/generator should close parser/generator.
Document ownership explicitly.
```

Dalam service internal, lebih baik method bernama jelas:

```java
parseAndClose(InputStream in)
parseButDoNotClose(InputStream in)
```

Atau gunakan abstraction yang mengatur lifecycle.

---

## 32. Charset dan Encoding

JSON umumnya UTF-8 di boundary modern. JSON-P bisa membuat parser dari `InputStream` atau `Reader`.

```java
Json.createParser(inputStream);
Json.createParser(reader);
```

Jika memakai `InputStream`, provider akan menangani decoding sesuai JSON encoding rules. Dalam HTTP modern, gunakan `Content-Type: application/json; charset=utf-8` jika perlu, tetapi banyak sistem mengasumsikan UTF-8.

Jika memakai `Reader`, Anda sudah memilih charset sebelum parser.

```java
Reader reader = new InputStreamReader(inputStream, StandardCharsets.UTF_8);
JsonParser parser = Json.createParser(reader);
```

Prinsip:

- jangan bergantung pada platform default charset;
- untuk file, tentukan UTF-8 eksplisit;
- untuk HTTP, validate Content-Type;
- untuk legacy system, encoding mismatch bisa menghasilkan data korup, bukan hanya parse error.

---

## 33. Testing Streaming Parser

Streaming parser lebih mudah bug karena state machine manual. Test harus mencakup struktur, bukan hanya happy path.

### 33.1 Happy Path

```json
{
  "records": [
    { "id": "A001", "status": "APPROVED" }
  ]
}
```

### 33.2 Field Order Berbeda

```json
{
  "records": [
    { "status": "APPROVED", "id": "A001" }
  ]
}
```

JSON object tidak boleh diasumsikan urutan field-nya stabil.

### 33.3 Missing Field

```json
{
  "records": [
    { "status": "APPROVED" }
  ]
}
```

### 33.4 Null Field

```json
{
  "records": [
    { "id": null, "status": "APPROVED" }
  ]
}
```

### 33.5 Wrong Type

```json
{
  "records": [
    { "id": 123, "status": "APPROVED" }
  ]
}
```

### 33.6 Nested Same Key

```json
{
  "case": { "status": "APPROVED" },
  "payment": { "status": "UNPAID" }
}
```

### 33.7 Duplicate Key

```json
{
  "id": "A001",
  "id": "A002"
}
```

### 33.8 Too Deep

```json
[[[[[[[[[[[]]]]]]]]]]]
```

### 33.9 Too Many Records

Generate array with `max + 1` item.

### 33.10 Invalid JSON

```json
{
  "id": "A001",
```

Test bukan hanya output, tetapi juga error classification.

---

## 34. Contract Test untuk Streaming Reader

Untuk reader khusus external system, buat contract test berbasis fixture.

Struktur folder:

```text
src/test/resources/contracts/external-agency/v1/
  valid-minimal.json
  valid-full.json
  valid-field-order-random.json
  invalid-missing-id.json
  invalid-wrong-amount-type.json
  invalid-too-many-records.json
  invalid-duplicate-key.json
```

Test harus memverifikasi:

- jumlah record yang terbaca;
- header extracted benar;
- error path benar;
- error code stabil;
- parser tidak membaca lebih jauh dari yang perlu untuk partial extraction;
- payload besar tidak menyebabkan OOM pada test stress ringan;
- unknown field policy sesuai kontrak.

Contract reader adalah bagian dari boundary integration. Treat it as production-critical code.

---

## 35. Observability untuk Streaming Pipeline

Saat parsing batch besar, observability wajib.

Metric minimal:

```text
json_parse_duration_ms
json_records_total
json_records_success_total
json_records_failed_total
json_payload_bytes
json_max_depth_seen
json_duplicate_key_rejected_total
json_parse_error_total
json_validation_error_total
json_output_bytes
```

Log minimal:

```text
correlationId
sourceSystem
batchId
schemaVersion
recordIndex
errorCode
jsonPath
line
column
offset
```

Jangan log:

- payload penuh;
- PII;
- credential/token;
- field sensitif;
- binary/base64 besar;
- full stacktrace untuk expected validation error di hot path.

Untuk regulatory/audit system, error harus cukup jelas untuk investigasi tetapi tidak membocorkan data.

---

## 36. Performance Model

Streaming lebih hemat memori, tetapi bukan otomatis lebih cepat untuk semua kasus.

### 36.1 Object Model

```text
parse all -> allocate tree -> access fields
```

Biaya:

- alokasi object banyak;
- memory proportional to payload;
- random access mudah;
- code sederhana.

### 36.2 Streaming

```text
parse event -> process immediate -> discard
```

Biaya:

- alokasi lebih rendah;
- code stateful lebih kompleks;
- akses mundur tidak bisa;
- path logic manual;
- bisa lebih cepat untuk partial extraction;
- bisa lebih lambat jika Anda membangun ulang banyak state secara buruk.

### 36.3 Hybrid

```text
stream outer -> small object model per item
```

Sering menjadi sweet spot.

### 36.4 Benchmark dengan Jujur

Jangan benchmark hanya dengan payload 5 KB jika produksi 500 MB.

Benchmark variasi:

- payload kecil;
- payload sedang;
- payload besar;
- deeply nested;
- many small records;
- few large records;
- numeric-heavy;
- string-heavy;
- happy path;
- invalid early;
- invalid late.

Ukur:

- throughput;
- p95/p99 latency;
- allocation rate;
- GC pause/frequency;
- peak RSS/container memory;
- time to first record;
- failure latency.

---

## 37. Integration Boundary Pattern

Untuk production code, hindari controller/service langsung mengandung parser loop.

Buruk:

```java
@PostMapping("/batch")
public ResponseEntity<?> upload(InputStream in) {
    try (JsonParser parser = Json.createParser(in)) {
        while (parser.hasNext()) {
            // 300 lines state machine
        }
    }
}
```

Lebih baik:

```text
BatchController
  -> BatchImportUseCase
      -> ExternalAgencyBatchReader
          -> JsonParser
          -> StructuralGuards
      -> BatchProcessor
      -> BatchResultWriter
```

Dengan desain ini:

- boundary parsing terpisah;
- domain logic bersih;
- test parser tidak butuh HTTP;
- parser bisa diganti;
- error mapping konsisten;
- observability bisa ditempel pada reader.

---

## 38. Error Taxonomy

Streaming pipeline sebaiknya punya klasifikasi error jelas.

```text
TRANSPORT_ERROR
  request too large
  connection closed
  timeout

JSON_SYNTAX_ERROR
  invalid JSON grammar
  unexpected EOF

JSON_STRUCTURE_ERROR
  root must be object
  records must be array
  max depth exceeded
  duplicate key

CONTRACT_ERROR
  missing required field
  wrong type
  unsupported version
  unknown enum

DOMAIN_ERROR
  invalid business state
  amount exceeds allowed range
  record not eligible

DOWNSTREAM_ERROR
  database unavailable
  external service timeout
  message broker publish failed
```

Kenapa ini penting?

Karena retry, HTTP status, audit message, dan user feedback berbeda.

Contoh:

```text
JSON_SYNTAX_ERROR      -> 400, no retry
CONTRACT_ERROR         -> 422, user/external system correction
DOMAIN_ERROR           -> 422 or business rejection report
DOWNSTREAM_ERROR       -> 503/500, retry possible
TRANSPORT_ERROR        -> depends on layer
```

---

## 39. Idempotency dalam Streaming Batch

Saat memproses record satu demi satu, risiko partial success muncul.

Contoh:

```text
record 1 persisted
record 2 persisted
record 3 failed due DB timeout
```

Jika client retry seluruh batch, record 1 dan 2 bisa diproses ulang.

Karena itu streaming batch butuh idempotency.

Idempotency key bisa berupa:

```text
sourceSystem + batchId + recordId
```

Atau:

```text
sourceSystem + externalReferenceNo + version
```

Streaming parser harus mengekstrak field yang diperlukan untuk idempotency sebelum side effect.

Pipeline aman:

```text
parse record
  -> validate required idempotency fields
  -> compute idempotency key
  -> check/process atomically
  -> emit event with same key
```

Jangan melakukan side effect sebelum field minimum tervalidasi.

---

## 40. Transaction Boundary

Jangan otomatis membungkus seluruh batch besar dalam satu database transaction.

Opsi:

### 40.1 One Transaction per Batch

Kelebihan:

- atomic;
- mudah reasoning;
- all-or-nothing.

Kekurangan:

- transaction panjang;
- lock lama;
- rollback mahal;
- memory/undo/log pressure;
- timeout tinggi.

### 40.2 One Transaction per Record

Kelebihan:

- isolasi error;
- lock pendek;
- partial success mudah.

Kekurangan:

- batch tidak atomic;
- perlu idempotency;
- summary/report lebih kompleks.

### 40.3 Chunk Transaction

Contoh 500 record per commit.

Kelebihan:

- kompromi throughput dan recovery;
- cocok untuk import besar.

Kekurangan:

- partial chunk failure handling perlu desain;
- idempotency tetap penting.

Streaming parsing membuat semua opsi ini mungkin. Object model full-batch sering mendorong desain batch transaction yang kurang sehat.

---

## 41. Security Checklist untuk JSON-P Streaming

Gunakan checklist ini untuk external input:

- [ ] Enforce maximum request/body size di gateway/container.
- [ ] Enforce maximum depth di parser state.
- [ ] Enforce maximum array item count.
- [ ] Enforce duplicate key policy.
- [ ] Enforce required root structure.
- [ ] Enforce allowed schema/version.
- [ ] Enforce numeric precision/scale.
- [ ] Enforce string length per field setelah materialization.
- [ ] Reject unexpected binary/base64 field size.
- [ ] Avoid logging full payload.
- [ ] Track line/column/offset for parse error.
- [ ] Classify syntax vs structure vs contract vs domain error.
- [ ] Use idempotency before side effect.
- [ ] Do not parse blocking stream on event loop thread.
- [ ] Close parser/generator deterministically.

---

## 42. Java 8 sampai Java 25 Compatibility Notes

### 42.1 Java 8

Pada era Java EE/Jakarta EE 8 awal, namespace yang umum:

```java
javax.json.*
javax.json.stream.*
```

Dependency sering disediakan oleh application server, atau ditambahkan sebagai library.

### 42.2 Java 9–10

JPMS mulai ada, tetapi banyak enterprise app masih classpath-based. JSON-P bukan bagian inti Java SE, jadi tetap tergantung dependency/container.

### 42.3 Java 11+

Java EE modules yang dulu ada di JDK telah dihapus. Untuk JSON-P, karena memang bukan Java SE core module, praktik yang sehat adalah eksplisit dependency dan tidak mengandalkan JDK.

Untuk XML Binding/JAX-WS nanti ini jauh lebih kritikal, tetapi kebiasaan eksplisit dependency juga penting di JSON-P.

### 42.4 Jakarta EE 9+

Namespace berubah:

```text
javax.json.* -> jakarta.json.*
```

Ini bukan perubahan kecil jika codebase besar. Impact:

- source imports;
- generated code;
- libraries;
- application server compatibility;
- test fixtures;
- shaded dependencies;
- transitive dependencies.

### 42.5 Java 17/21/25

Untuk runtime modern:

- gunakan dependency Jakarta yang sesuai server/framework;
- hindari split package/module conflict;
- perhatikan reflection jika integrasi dengan binding layer;
- untuk native image, test parser/provider behavior secara eksplisit;
- gunakan container memory limit sebagai bagian benchmark.

---

## 43. Maven Dependency Contoh

Contoh Jakarta JSON Processing API dan implementasi perlu disesuaikan dengan runtime.

Untuk standalone app, butuh API + implementation.

Contoh konseptual:

```xml
<dependencies>
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
</dependencies>
```

Jika berjalan dalam Jakarta EE server yang sudah menyediakan JSON-P, dependency API biasanya `provided` atau tidak perlu dibundel tergantung packaging.

Prinsip:

```text
Standalone app: API + implementation
Jakarta EE container: align with container-provided version
Spring app: usually Jackson default; add JSON-P only if needed
Library: depend on API carefully; avoid forcing implementation unless necessary
```

Selalu cek versi aktual dari BOM/runtime yang digunakan.

---

## 44. Gradle Dependency Contoh

```gradle
dependencies {
    implementation("jakarta.json:jakarta.json-api:2.1.3")
    runtimeOnly("org.eclipse.parsson:parsson:1.1.7")
}
```

Untuk Jakarta EE server:

```gradle
dependencies {
    compileOnly("jakarta.json:jakarta.json-api:2.1.3")
}
```

Pilih sesuai deployment model.

---

## 45. Anti-Patterns

### 45.1 Membaca Semua ke String Dulu

```java
String body = new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
JsonObject root = Json.createReader(new StringReader(body)).readObject();
```

Masalah:

- double memory;
- tidak streaming;
- request besar berbahaya;
- sulit enforce limit bertahap.

### 45.2 Parser Loop 500 Baris Tanpa Abstraction

Masalah:

- tidak bisa dites granular;
- state bug tersembunyi;
- susah maintenance;
- error handling berantakan.

### 45.3 Key-Only Matching

```java
if ("status".equals(currentKey)) { ... }
```

Masalah:

- nested field salah kena;
- kontrak berkembang, bug muncul diam-diam.

### 45.4 Tidak Menangani Duplicate Key

Masalah:

- ambiguity;
- security issue;
- audit issue.

### 45.5 Menyamakan Parse Error dan Business Error

Masalah:

- retry salah;
- status code salah;
- user feedback salah;
- observability buruk.

### 45.6 Streaming Response Tanpa Recovery Plan

Masalah:

- jika error setelah output sebagian terkirim, response bisa invalid;
- client tidak mendapat error envelope valid;
- API contract rapuh.

---

## 46. Practical Design: External Batch Import Reader

Berikut desain konseptual untuk reader batch external system.

### 46.1 Contract

Input:

```json
{
  "schemaVersion": "1.0",
  "batchId": "B-2026-0001",
  "sourceSystem": "AGENCY-X",
  "records": [
    {
      "recordId": "R001",
      "caseNo": "C-001",
      "amount": 100.50,
      "status": "SUBMITTED"
    }
  ]
}
```

### 46.2 Domain Types

```java
import java.math.BigDecimal;

public record BatchHeader(
        String schemaVersion,
        String batchId,
        String sourceSystem
) {}

public record ExternalRecord(
        String recordId,
        String caseNo,
        BigDecimal amount,
        String status
) {}
```

### 46.3 Reader Responsibility

Reader bertanggung jawab untuk:

- parse JSON;
- enforce structure;
- extract header;
- iterate records;
- validate basic contract type;
- expose record satu demi satu.

Reader tidak bertanggung jawab untuk:

- business eligibility;
- database transaction;
- external API call;
- authorization;
- final user response formatting.

Boundary ini penting agar parser tidak berubah menjadi god class.

---

## 47. Practical Design: Record-Level Validation

Setelah record terbaca:

```java
public final class ExternalRecordValidator {

    public void validate(ExternalRecord record) {
        requireNonBlank(record.recordId(), "recordId");
        requireNonBlank(record.caseNo(), "caseNo");
        requireNonBlank(record.status(), "status");

        if (record.amount() == null) {
            throw new ContractViolation("amount is required");
        }

        if (record.amount().scale() > 2) {
            throw new ContractViolation("amount scale must not exceed 2");
        }

        if (record.amount().signum() < 0) {
            throw new ContractViolation("amount must be non-negative");
        }
    }

    private static void requireNonBlank(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new ContractViolation(field + " is required");
        }
    }
}
```

Contract validation tetap berbeda dari business validation.

Contract validation menjawab:

> “Apakah data sesuai bentuk yang disepakati?”

Business validation menjawab:

> “Apakah data ini boleh diproses menurut aturan domain?”

---

## 48. Streaming Writer untuk Large Export

Misalnya export case list:

```java
public final class CaseExportWriter {

    public void write(OutputStream outputStream, Iterable<CaseRow> rows) {
        try (JsonGenerator generator = Json.createGenerator(outputStream)) {
            generator.writeStartObject();
            generator.write("schemaVersion", "1.0");
            generator.writeStartArray("cases");

            for (CaseRow row : rows) {
                generator.writeStartObject()
                        .write("caseNo", row.caseNo())
                        .write("status", row.status())
                        .write("createdAt", row.createdAt().toString())
                        .writeEnd();
            }

            generator.writeEnd();
            generator.writeEnd();
        }
    }
}
```

Production caveat:

- Jika `rows` berasal dari DB stream, pastikan cursor lifecycle aman.
- Jangan expose export raksasa tanpa pagination/asynchronous job jika user-facing.
- Untuk file export, lebih baik tulis ke object storage lalu user download.
- Untuk inter-service integration, sepakati timeout dan retry behavior.

---

## 49. Arah Pemikiran Top 1% Engineer

Engineer biasa bertanya:

> “Bagaimana parse JSON ini?”

Engineer senior bertanya:

> “Apakah JSON ini kecil, stabil, dan trusted sehingga binding cukup?”

Engineer top-tier bertanya lebih jauh:

> “Apa kontrak evolusinya, apa resource boundary-nya, apa failure taxonomy-nya, bagaimana recovery/idempotency-nya, apa observability-nya, dan bagaimana sistem tetap aman saat payload berubah atau membesar?”

Streaming JSON-P adalah alat untuk menjawab sebagian dari pertanyaan itu.

Bukan karena streaming selalu lebih elegan, tetapi karena streaming memaksa kita melihat JSON sebagai **aliran data di boundary sistem**, bukan hanya object di memori.

---

## 50. Ringkasan Mental Model

### 50.1 Parser

```text
JsonParser = forward-only event cursor
```

Parser membaca JSON menjadi event. Makna event ditentukan oleh state machine kita.

### 50.2 Generator

```text
JsonGenerator = structural JSON writer
```

Generator menulis JSON valid berdasarkan urutan method call. Code kita bertanggung jawab terhadap isi dan kontrak.

### 50.3 Streaming

```text
Streaming = control over memory, failure point, and boundary semantics
```

Streaming cocok untuk payload besar, partial extraction, transformation, dan guardrail.

### 50.4 Hybrid

```text
Stream the large boundary, materialize the small unit
```

Ini sering pattern paling praktis.

### 50.5 Enterprise Boundary

```text
Transport limit
  -> parser guard
  -> contract validation
  -> domain validation
  -> idempotent side effect
  -> observable result
```

---

## 51. Latihan Praktis

### Latihan 1 — Event Printer

Buat program yang menerima file JSON dan mencetak semua event beserta depth.

Target output:

```text
0 START_OBJECT
1 KEY_NAME: meta
1 START_OBJECT
2 KEY_NAME: requestId
2 VALUE_STRING: REQ-001
1 END_OBJECT
0 END_OBJECT
```

### Latihan 2 — Request ID Extractor

Buat extractor untuk path:

```text
/meta/requestId
```

Syarat:

- tidak build object model penuh;
- return `Optional<String>`;
- berhenti setelah ketemu;
- handle JSON invalid dengan error location.

### Latihan 3 — Duplicate Key Guard

Implementasikan guard duplicate key per object.

Input invalid:

```json
{
  "id": "A001",
  "nested": {
    "x": 1,
    "x": 2
  }
}
```

Harus reject key `x`, bukan hanya root-level key.

### Latihan 4 — Batch Record Reader

Buat reader untuk payload:

```json
{
  "batchId": "B001",
  "records": [
    { "recordId": "R001", "amount": 100.50 },
    { "recordId": "R002", "amount": 200.00 }
  ]
}
```

Syarat:

- max records 10.000;
- amount harus scale <= 2;
- recordId wajib string non-blank;
- return summary success/error.

### Latihan 5 — Streaming Transformer

Buat transformer yang hanya mengubah:

```text
/case/status
```

Bukan:

```text
/payment/status
/user/status
```

Gunakan path-aware transform.

---

## 52. Checklist Penguasaan Part 4

Anda dianggap menguasai part ini jika mampu menjelaskan dan mengimplementasikan:

- [ ] Perbedaan object model dan streaming model.
- [ ] Cara kerja `JsonParser` sebagai event cursor.
- [ ] Cara kerja `JsonGenerator` sebagai structural writer.
- [ ] Event sequence untuk object/array/scalar.
- [ ] State machine parsing dengan `currentKey`, `depth`, dan path stack.
- [ ] Partial extraction tanpa tree penuh.
- [ ] Streaming outer + object model inner.
- [ ] Transform parser-to-generator.
- [ ] Path-aware transform.
- [ ] Depth limit.
- [ ] Array item limit.
- [ ] Duplicate key detection.
- [ ] Numeric precision handling.
- [ ] Error diagnostics dengan line/column/offset.
- [ ] Difference between parse, structure, contract, domain, and downstream error.
- [ ] Idempotency impact pada streaming batch.
- [ ] Transaction boundary untuk batch besar.
- [ ] Kapan streaming response berbahaya.
- [ ] Kapan JSON-P streaming vs Jackson streaming.

---

## 53. Sumber Resmi dan Bacaan Lanjutan

Sumber utama yang relevan untuk bagian ini:

- Jakarta JSON Processing specification page: `https://jakarta.ee/specifications/jsonp/`
- Jakarta JSON Processing 2.1: `https://jakarta.ee/specifications/jsonp/2.1/`
- Jakarta JSON Processing API docs: `https://jakarta.ee/specifications/jsonp/2.1/apidocs/`
- `jakarta.json.stream` package summary: `https://jakarta.ee/specifications/jsonp/2.1/apidocs/jakarta.json/jakarta/json/stream/package-summary`
- Jakarta EE Tutorial — JSON Processing: `https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jsonp/jsonp.html`
- JSON-P API project: `https://github.com/jakartaee/jsonp-api`
- Eclipse Parsson implementation: `https://github.com/eclipse-ee4j/parsson`

---

# Penutup Part 4

Part ini membahas JSON-P Streaming secara mendalam: bukan hanya API `JsonParser` dan `JsonGenerator`, tetapi juga bagaimana menggunakannya sebagai alat desain integration boundary.

Kunci utamanya:

```text
Streaming JSON is not just a performance optimization.
It is a boundary-control technique.
```

Dengan streaming, kita bisa mengontrol kapan membaca, apa yang diekstrak, seberapa jauh input dipercaya, kapan gagal, bagaimana menghindari memory blow-up, dan bagaimana menjaga kontrak tetap aman saat payload membesar.

Pada part berikutnya, kita akan naik ke kemampuan transformasi JSON yang lebih spesifik:

> **Part 5 — JSON-P Transformation & Mutation: JSON Pointer, JSON Patch, Merge Patch, immutable tree handling, diff/patch strategies, dan audit-safe mutation design.**

Status seri: **belum selesai**.  
Part ini adalah **Part 4 dari 34**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-003.md">⬅️ Part 3 — JSON-P Core Mental Model: Object Model, Reader/Writer, Builder, Provider, Immutability, dan Boundary Thinking</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-005.md">Part 005 — P Transformation & Mutation ➡️</a>
</div>
