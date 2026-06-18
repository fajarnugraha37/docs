# learn-java-json-xml-soap-connectors-enterprise-integration-part-003

# Part 3 — JSON-P Core Mental Model: Object Model, Reader/Writer, Builder, Provider, Immutability, dan Boundary Thinking

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Bagian: `Part 3 dari 34`  
> Target Java: Java 8 sampai Java 25  
> Fokus: memahami Jakarta JSON Processing / JSON-P sebagai API standar untuk memproses JSON secara eksplisit, terkontrol, dan contract-aware.

---

## 0. Tujuan Bagian Ini

Pada Part 2 kita sudah memetakan ekosistem JSON di Java: JSON-P, JSON-B, Jackson, Gson, provider runtime, dan konsekuensi memilih library. Sekarang kita masuk ke fondasi teknis pertama: **JSON-P core mental model**.

JSON-P sering disalahpahami sebagai “library JSON kecil” yang kalah populer dari Jackson. Cara pikir itu terlalu sempit. JSON-P adalah API standar Jakarta untuk memproses JSON dengan dua pendekatan:

1. **Object Model API** — membangun representasi JSON sebagai tree immutable: `JsonObject`, `JsonArray`, `JsonValue`, `JsonNumber`, `JsonString`.
2. **Streaming API** — membaca/menulis JSON sebagai event/token stream: `JsonParser`, `JsonGenerator`.

Bagian ini fokus pada **Object Model API dan lifecycle dasar**:

- `JsonReader`
- `JsonWriter`
- `JsonObject`
- `JsonArray`
- `JsonValue`
- `JsonObjectBuilder`
- `JsonArrayBuilder`
- `JsonBuilderFactory`
- `JsonReaderFactory`
- `JsonWriterFactory`
- `JsonProvider`
- provider implementation seperti Eclipse Parsson
- konsekuensi immutability dan memory
- boundary design untuk enterprise integration

Streaming API akan dibahas lebih dalam di Part 4.

Referensi resmi menyebut Jakarta JSON Processing sebagai API untuk **parse, generate, transform, dan query JSON documents**, baik melalui object model maupun streaming model. Jakarta JSON Processing 2.1 adalah rilis untuk Jakarta EE 10, sedangkan JSON-P 2.2 sedang diarahkan untuk Jakarta EE 12. Lihat referensi resmi Jakarta JSON Processing dan dokumentasi API pada bagian akhir materi.

---

## 1. Premis Utama: JSON-P Adalah API Struktur, Bukan API Binding

Sebelum belajar class-class JSON-P, pegang prinsip ini:

> JSON-P tidak bertugas mengubah object Java domain menjadi JSON secara otomatis. JSON-P bertugas memberi kita kontrol eksplisit terhadap struktur JSON.

Bandingkan mental model-nya:

```text
JSON-B / Jackson / Gson
    Java object <──── mapping rules ────> JSON

JSON-P
    Java code <──── explicit structural API ────> JSON tree / JSON stream
```

Dengan JSON-B/Jackson, pertanyaan utamanya:

```text
Bagaimana class Java ini dimapping menjadi JSON?
```

Dengan JSON-P, pertanyaan utamanya:

```text
Struktur JSON apa yang ingin saya baca, validasi, ubah, atau hasilkan?
```

Ini membuat JSON-P sangat berguna untuk kasus-kasus berikut:

1. **Payload semi-dinamis** — field tidak selalu cocok dengan DTO stabil.
2. **Gateway/facade** — menerima JSON dari sistem luar, lalu hanya mengambil/memodifikasi sebagian field.
3. **Audit/event payload** — ingin menyimpan struktur mentah tanpa memaksa mapping ke domain object.
4. **Patch/merge/diff** — bekerja dengan struktur JSON, bukan class Java.
5. **Contract validation ringan** — cek field wajib, tipe, dan shape sebelum binding.
6. **Transformation layer** — ubah payload antar versi API.
7. **Interop dengan Jakarta EE** — memakai API standar, portable antar runtime.
8. **Testing contract** — membandingkan struktur JSON secara eksplisit.

JSON-P bukan pengganti JSON-B/Jackson untuk semua kasus. Tetapi JSON-P memberi kemampuan yang sering hilang saat engineer hanya tahu binding otomatis.

---

## 2. Lapisan-Lapisan JSON-P

JSON-P bisa dipahami sebagai beberapa lapisan.

```text
jakarta.json.Json
    ├── factory methods
    ├── reader/writer creation
    ├── builder creation
    └── provider discovery shortcut

Object Model API
    ├── JsonValue
    ├── JsonObject
    ├── JsonArray
    ├── JsonString
    ├── JsonNumber
    └── JsonStructure

Builder API
    ├── JsonObjectBuilder
    ├── JsonArrayBuilder
    └── JsonBuilderFactory

Reader/Writer API
    ├── JsonReader
    ├── JsonWriter
    ├── JsonReaderFactory
    └── JsonWriterFactory

Streaming API
    ├── JsonParser
    ├── JsonGenerator
    ├── JsonParserFactory
    └── JsonGeneratorFactory

SPI
    └── JsonProvider
```

Dalam Part 3, kita fokus pada area berikut:

```text
InputStream / Reader
    ↓
JsonReader
    ↓
JsonObject / JsonArray / JsonStructure
    ↓
explicit inspection / validation / transformation
    ↓
JsonObjectBuilder / JsonArrayBuilder
    ↓
JsonWriter
    ↓
OutputStream / Writer
```

---

## 3. Versi dan Namespace: Javax vs Jakarta

Untuk Java 8 sampai Java 25, isu penting bukan hanya API, tapi namespace dan dependency.

### 3.1 Era Java EE / `javax.json`

Di Java EE 7/8, JSON-P dikenal dengan package:

```java
javax.json.*
```

Contoh dependency era Java EE / Jakarta EE 8 style:

```xml
<dependency>
    <groupId>javax.json</groupId>
    <artifactId>javax.json-api</artifactId>
    <version>1.1.4</version>
</dependency>
```

Provider implementation umum:

```xml
<dependency>
    <groupId>org.glassfish</groupId>
    <artifactId>javax.json</artifactId>
    <version>1.1.4</version>
</dependency>
```

### 3.2 Era Jakarta / `jakarta.json`

Sejak Jakarta EE 9, namespace berubah menjadi:

```java
jakarta.json.*
```

Contoh dependency API:

```xml
<dependency>
    <groupId>jakarta.json</groupId>
    <artifactId>jakarta.json-api</artifactId>
    <version>2.1.3</version>
</dependency>
```

Contoh provider implementation:

```xml
<dependency>
    <groupId>org.eclipse.parsson</groupId>
    <artifactId>jakarta.json</artifactId>
    <version>1.1.7</version>
</dependency>
```

Versi di atas hanya contoh gaya dependency; saat implementasi nyata, selalu pin versi sesuai BOM/framework/container yang dipakai.

### 3.3 Prinsip Migrasi

Jangan campur `javax.json.*` dan `jakarta.json.*` dalam module/classpath yang sama tanpa alasan kuat.

Kesalahan umum:

```text
Library A compile ke javax.json.JsonObject
Library B compile ke jakarta.json.JsonObject
Application mencoba passing object antar keduanya
Hasil: type mismatch walaupun nama class tampak mirip
```

Secara binary, ini dua tipe berbeda:

```text
javax.json.JsonObject     !=     jakarta.json.JsonObject
```

Mental model migrasinya:

```text
Java EE 8 / Jakarta EE 8
    javax.json

Jakarta EE 9+
    jakarta.json

Java runtime 11/17/21/25
    tidak otomatis menentukan namespace
    yang menentukan adalah dependency/framework/container
```

---

## 4. JSON-P Tidak Sama dengan JSON-B

Karena namanya mirip, banyak orang bingung.

| Aspek | JSON-P | JSON-B |
|---|---|---|
| Nama | JSON Processing | JSON Binding |
| Fokus | struktur JSON | object mapping |
| Mental model | JSON sebagai tree/stream | Java object sebagai sumber/target |
| API utama | `JsonObject`, `JsonReader`, `JsonWriter`, `JsonParser` | `Jsonb`, `JsonbBuilder`, annotation mapping |
| Cocok untuk | transformasi, partial read, patch, dynamic payload | DTO request/response stabil |
| Risiko utama | verbose bila dipakai untuk semua DTO | hidden mapping behavior |
| Kontrol struktur | sangat eksplisit | tergantung mapping rules |
| Mirip dengan | DOM/StAX untuk XML | JAXB/Jackson databind |

Analogi XML:

```text
JSON-P Object Model     ~ DOM untuk JSON
JSON-P Streaming API    ~ StAX untuk JSON
JSON-B                 ~ JAXB/Jackson databinding untuk JSON
```

Seorang engineer senior tidak bertanya “mana yang paling bagus?” tetapi:

```text
Apakah problem ini structural processing atau object binding?
```

Contoh:

```text
Menerima API request stabil: JSON-B/Jackson cocok.
Membuat gateway yang hanya rewrite field tertentu: JSON-P cocok.
Membaca payload 2GB: JSON-P streaming cocok.
Menyimpan audit raw JSON dan query field tertentu: JSON-P object/stream cocok.
Membuat DTO strongly typed untuk business logic: JSON-B/Jackson cocok.
```

---

## 5. Core Type Hierarchy JSON-P

Untuk memahami JSON-P, mulai dari `JsonValue`.

```text
JsonValue
    ├── JsonStructure
    │   ├── JsonObject
    │   └── JsonArray
    ├── JsonString
    ├── JsonNumber
    ├── TRUE
    ├── FALSE
    └── NULL
```

JSON hanya punya beberapa jenis value:

```text
object, array, string, number, true, false, null
```

JSON-P memodelkan ini dengan tipe Java.

### 5.1 `JsonValue`

`JsonValue` adalah representasi satu nilai JSON.

```java
JsonValue value = Json.createValue("ACTIVE");
```

Kita bisa cek tipenya:

```java
JsonValue.ValueType type = value.getValueType();
```

Nilai `ValueType` biasanya:

```text
OBJECT
ARRAY
STRING
NUMBER
TRUE
FALSE
NULL
```

### 5.2 `JsonStructure`

`JsonStructure` adalah base untuk top-level JSON structure:

```text
JsonObject atau JsonArray
```

Top-level JSON valid bisa object:

```json
{
  "id": 1001,
  "status": "ACTIVE"
}
```

atau array:

```json
[
  { "id": 1001 },
  { "id": 1002 }
]
```

Karena itu `JsonReader` punya method:

```java
JsonStructure read();
JsonObject readObject();
JsonArray readArray();
```

Gunakan `readObject()` jika kontrak memang harus object. Gunakan `read()` jika top-level bisa object atau array.

### 5.3 `JsonObject`

`JsonObject` merepresentasikan JSON object.

```json
{
  "caseId": "CASE-2026-0001",
  "status": "OPEN",
  "priority": 3
}
```

Secara mental model, `JsonObject` mirip map dari nama field ke `JsonValue`.

```java
String status = obj.getString("status");
int priority = obj.getInt("priority");
JsonValue raw = obj.get("caseId");
```

Tetapi hati-hati: JSON object bukan domain object. Ia adalah representasi struktur payload.

### 5.4 `JsonArray`

`JsonArray` merepresentasikan array JSON.

```json
[
  "READ",
  "WRITE",
  "APPROVE"
]
```

atau array object:

```json
[
  { "role": "MAKER" },
  { "role": "CHECKER" }
]
```

Contoh akses:

```java
JsonArray roles = obj.getJsonArray("roles");
for (JsonValue role : roles) {
    System.out.println(role);
}
```

### 5.5 `JsonString`

JSON-P membedakan `JsonString` dari Java `String`.

```java
JsonString js = obj.getJsonString("status");
String status = js.getString();
```

Biasanya kita memakai helper:

```java
String status = obj.getString("status");
```

Namun `getJsonString()` berguna saat kita ingin mempertahankan detail tipe JSON dan tidak langsung convert.

### 5.6 `JsonNumber`

`JsonNumber` penting untuk precision.

JSON number tidak membedakan `int`, `long`, `BigDecimal`, atau `double` seperti Java. Semua terlihat sebagai “number”. JSON-P menyediakan akses:

```java
JsonNumber amount = obj.getJsonNumber("amount");
BigDecimal exact = amount.bigDecimalValue();
long id = amount.longValueExact();
```

Untuk uang, rate, tax, scoring, atau ID numeric besar, jangan sembarangan memakai `double`.

```java
BigDecimal amount = obj.getJsonNumber("amount").bigDecimalValue();
```

Prinsip enterprise:

```text
External numeric value harus dibaca sesuai semantic domain,
bukan sesuai convenience method paling cepat.
```

---

## 6. Membaca JSON dengan `JsonReader`

`JsonReader` membaca JSON dari `InputStream` atau `Reader` menjadi object model.

### 6.1 Membaca dari String

```java
import jakarta.json.Json;
import jakarta.json.JsonObject;
import jakarta.json.JsonReader;

import java.io.StringReader;

public class ReadJsonObjectExample {
    public static void main(String[] args) {
        String json = """
            {
              "caseId": "CASE-2026-0001",
              "status": "OPEN",
              "priority": 3
            }
            """;

        try (JsonReader reader = Json.createReader(new StringReader(json))) {
            JsonObject object = reader.readObject();

            String caseId = object.getString("caseId");
            String status = object.getString("status");
            int priority = object.getInt("priority");

            System.out.println(caseId);
            System.out.println(status);
            System.out.println(priority);
        }
    }
}
```

Untuk Java 8, text block belum tersedia. Gunakan string biasa:

```java
String json = "{"
        + "\"caseId\":\"CASE-2026-0001\"," 
        + "\"status\":\"OPEN\"," 
        + "\"priority\":3"
        + "}";
```

### 6.2 Membaca dari InputStream

Dalam service nyata, input sering berupa `InputStream`:

```java
public JsonObject readPayload(InputStream inputStream) {
    try (JsonReader reader = Json.createReader(inputStream)) {
        return reader.readObject();
    }
}
```

Namun ini memuat seluruh JSON object ke memory.

Untuk payload kecil-menengah, ini normal. Untuk payload besar, gunakan streaming API di Part 4.

### 6.3 `readObject()` vs `readArray()` vs `read()`

Gunakan method sesuai kontrak.

```java
JsonObject obj = reader.readObject();
```

Artinya:

```text
Saya mengharapkan top-level JSON object.
Jika ternyata top-level array, ini kontrak rusak.
```

Gunakan:

```java
JsonArray arr = reader.readArray();
```

jika kontrak memang array.

Gunakan:

```java
JsonStructure structure = reader.read();
```

jika top-level bisa object atau array.

Pattern defensive:

```java
try (JsonReader reader = Json.createReader(inputStream)) {
    JsonStructure structure = reader.read();

    if (structure.getValueType() != JsonValue.ValueType.OBJECT) {
        throw new IllegalArgumentException("Expected top-level JSON object");
    }

    JsonObject object = structure.asJsonObject();
}
```

### 6.4 Jangan Membaca Dua Kali dari Reader yang Sama

`JsonReader` adalah reader satu arah terhadap input.

Buruk:

```java
JsonObject first = reader.readObject();
JsonObject second = reader.readObject(); // salah secara lifecycle
```

Mental model:

```text
InputStream / Reader dikonsumsi.
Setelah JSON dibaca, cursor sudah selesai.
```

Kalau perlu baca ulang, simpan string/byte atau hasil `JsonObject`-nya. Tetapi hati-hati terhadap memory.

---

## 7. Menulis JSON dengan `JsonWriter`

`JsonWriter` menulis object model ke `Writer` atau `OutputStream`.

```java
import jakarta.json.Json;
import jakarta.json.JsonObject;
import jakarta.json.JsonWriter;

import java.io.StringWriter;

public class WriteJsonExample {
    public static void main(String[] args) {
        JsonObject object = Json.createObjectBuilder()
                .add("caseId", "CASE-2026-0001")
                .add("status", "OPEN")
                .add("priority", 3)
                .build();

        StringWriter out = new StringWriter();

        try (JsonWriter writer = Json.createWriter(out)) {
            writer.writeObject(object);
        }

        System.out.println(out);
    }
}
```

Output tipikal:

```json
{"caseId":"CASE-2026-0001","status":"OPEN","priority":3}
```

JSON-P default biasanya menghasilkan compact JSON. Pretty printing dapat dikonfigurasi melalui factory/provider config, dibahas nanti.

---

## 8. Membuat JSON dengan Builder

Karena `JsonObject` dan `JsonArray` bersifat immutable, kita membuatnya melalui builder.

### 8.1 Object Builder

```java
JsonObject payload = Json.createObjectBuilder()
        .add("caseId", "CASE-2026-0001")
        .add("status", "OPEN")
        .add("priority", 3)
        .add("active", true)
        .build();
```

Hasil:

```json
{
  "caseId": "CASE-2026-0001",
  "status": "OPEN",
  "priority": 3,
  "active": true
}
```

### 8.2 Array Builder

```java
JsonArray permissions = Json.createArrayBuilder()
        .add("READ")
        .add("WRITE")
        .add("APPROVE")
        .build();
```

Hasil:

```json
["READ", "WRITE", "APPROVE"]
```

### 8.3 Nested Object

```java
JsonObject payload = Json.createObjectBuilder()
        .add("caseId", "CASE-2026-0001")
        .add("applicant", Json.createObjectBuilder()
                .add("name", "Alice")
                .add("type", "INDIVIDUAL"))
        .add("tags", Json.createArrayBuilder()
                .add("urgent")
                .add("manual-review"))
        .build();
```

Perhatikan kita bisa menambahkan builder langsung tanpa `.build()` pada nested object/array, karena overload `add` menerima builder.

### 8.4 Membuat `null`

Untuk JSON null:

```java
JsonObject payload = Json.createObjectBuilder()
        .add("caseId", "CASE-2026-0001")
        .addNull("closedDate")
        .build();
```

Jangan lakukan:

```java
.add("closedDate", (String) null) // berisiko NullPointerException atau ambiguity
```

Gunakan `addNull()` jika semantic-nya memang explicit JSON null.

---

## 9. Null vs Absent: Salah Satu Konsep Paling Penting

Dalam JSON contract, ini berbeda:

```json
{
  "closedDate": null
}
```

vs

```json
{
}
```

Yang pertama berarti field ada, nilainya null. Yang kedua berarti field tidak dikirim.

Dalam enterprise integration, perbedaannya bisa besar:

```text
null     = clear value / explicitly empty / unknown / intentionally omitted value
absent   = leave unchanged / not part of this version / caller not authorized to see field
```

Tergantung kontrak.

### 9.1 Cek Field Ada atau Tidak

```java
boolean exists = object.containsKey("closedDate");
```

### 9.2 Cek Field Ada dan Null

```java
boolean explicitlyNull = object.containsKey("closedDate")
        && object.isNull("closedDate");
```

### 9.3 Cek Field Absent

```java
boolean absent = !object.containsKey("closedDate");
```

### 9.4 Pattern PATCH DTO

Untuk PATCH, jangan langsung mapping seperti:

```java
class PatchCaseRequest {
    String status;
    String assignee;
}
```

Karena Java `null` tidak bisa membedakan:

```text
field absent
field present null
```

Dengan JSON-P, kita bisa menjaga semantic ini:

```java
public CasePatch parsePatch(JsonObject patch) {
    CasePatch result = new CasePatch();

    if (patch.containsKey("status")) {
        if (patch.isNull("status")) {
            result.clearStatus();
        } else {
            result.changeStatus(patch.getString("status"));
        }
    }

    if (patch.containsKey("assignee")) {
        if (patch.isNull("assignee")) {
            result.unassign();
        } else {
            result.assignTo(patch.getString("assignee"));
        }
    }

    return result;
}
```

Mental model:

```text
JSON-P preserves structural intent.
Binding frameworks often collapse structural intent into Java null.
```

---

## 10. Immutability: `JsonObject` Bukan Mutable Map

`JsonObject` terlihat seperti map, tetapi object model JSON-P bersifat immutable.

Buruk:

```java
JsonObject obj = ...;
obj.put("status", Json.createValue("CLOSED")); // tidak seperti mutable map biasa
```

Secara API, `JsonObject` memang extend `Map<String, JsonValue>` pada beberapa versi, tapi operasi modifikasi tidak dimaksudkan untuk dipakai dan umumnya melempar `UnsupportedOperationException`.

Cara benar: buat object baru dari object lama.

```java
JsonObject original = Json.createObjectBuilder()
        .add("caseId", "CASE-2026-0001")
        .add("status", "OPEN")
        .build();

JsonObject changed = Json.createObjectBuilder(original)
        .add("status", "CLOSED")
        .build();
```

### 10.1 Kenapa Immutable?

Immutability memberi beberapa keuntungan:

1. Aman dibagikan antar method tanpa takut berubah diam-diam.
2. Cocok untuk transformation pipeline.
3. Lebih mudah untuk audit/diff.
4. Mengurangi bug akibat mutation order.
5. Cocok untuk contract testing.

Tetapi ada trade-off:

1. Mengubah object besar berarti membangun object baru.
2. Patch berulang pada tree besar bisa mahal.
3. Untuk payload sangat besar, streaming lebih tepat.

Mental model:

```text
JsonObject adalah snapshot struktur JSON.
JsonObjectBuilder adalah staging area untuk membuat snapshot baru.
```

---

## 11. Transformation Pattern dengan JSON-P

Misalnya external system mengirim payload versi lama:

```json
{
  "id": "CASE-2026-0001",
  "state": "OPEN",
  "owner": "alice"
}
```

Internal boundary baru ingin:

```json
{
  "caseId": "CASE-2026-0001",
  "status": "OPEN",
  "assignee": "alice",
  "sourceVersion": "v1"
}
```

Dengan JSON-P:

```java
public JsonObject normalizeV1(JsonObject input) {
    return Json.createObjectBuilder()
            .add("caseId", input.getString("id"))
            .add("status", input.getString("state"))
            .add("assignee", input.getString("owner", "UNASSIGNED"))
            .add("sourceVersion", "v1")
            .build();
}
```

Ini eksplisit dan mudah diaudit.

Bandingkan dengan mapping otomatis yang tersembunyi di banyak annotation. Untuk transformation antar kontrak, eksplisit sering lebih aman.

### 11.1 Preserve Unknown Field

Kadang kita ingin preserve unknown field.

```java
public JsonObject enrich(JsonObject input) {
    return Json.createObjectBuilder(input)
            .add("receivedAt", Instant.now().toString())
            .build();
}
```

Tetapi hati-hati: preserve unknown field bisa membocorkan data yang tidak dimaksudkan.

Decision:

```text
Allowlist transformation
    lebih aman untuk public/external response

Copy-through transformation
    berguna untuk internal event enrichment,
    tetapi harus jelas trust boundary-nya
```

---

## 12. Factory API: Kenapa Ada `JsonReaderFactory`, `JsonWriterFactory`, dan `JsonBuilderFactory`?

Untuk contoh kecil, kita sering pakai shortcut:

```java
Json.createReader(inputStream)
Json.createWriter(outputStream)
Json.createObjectBuilder()
```

Tetapi dalam aplikasi production, factory penting untuk:

1. Konfigurasi reusable.
2. Menghindari repeated provider lookup.
3. Menentukan setting seperti pretty printing.
4. Membuat lifecycle lebih eksplisit.
5. Memudahkan injection/wrapping/test.

### 12.1 `JsonReaderFactory`

```java
Map<String, ?> config = Map.of();
JsonReaderFactory factory = Json.createReaderFactory(config);

try (JsonReader reader = factory.createReader(inputStream)) {
    JsonObject object = reader.readObject();
}
```

Untuk Java 8:

```java
Map<String, Object> config = new HashMap<>();
JsonReaderFactory factory = Json.createReaderFactory(config);
```

### 12.2 `JsonWriterFactory` dengan Pretty Printing

```java
Map<String, Object> config = new HashMap<>();
config.put(JsonGenerator.PRETTY_PRINTING, true);

JsonWriterFactory writerFactory = Json.createWriterFactory(config);

StringWriter out = new StringWriter();
try (JsonWriter writer = writerFactory.createWriter(out)) {
    writer.writeObject(payload);
}
```

Catatan: constant pretty printing berada pada streaming generator config, tetapi dipakai juga oleh writer factory pada implementasi JSON-P.

### 12.3 `JsonBuilderFactory`

```java
JsonBuilderFactory builderFactory = Json.createBuilderFactory(Map.of());

JsonObject object = builderFactory.createObjectBuilder()
        .add("caseId", "CASE-2026-0001")
        .build();
```

Dalam service besar, factory bisa dibungkus sebagai component:

```java
public final class JsonSupport {
    private final JsonReaderFactory readerFactory;
    private final JsonWriterFactory writerFactory;
    private final JsonBuilderFactory builderFactory;

    public JsonSupport() {
        Map<String, Object> config = new HashMap<>();
        this.readerFactory = Json.createReaderFactory(config);
        this.writerFactory = Json.createWriterFactory(config);
        this.builderFactory = Json.createBuilderFactory(config);
    }

    public JsonObjectBuilder objectBuilder() {
        return builderFactory.createObjectBuilder();
    }

    public JsonObject readObject(InputStream in) {
        try (JsonReader reader = readerFactory.createReader(in)) {
            return reader.readObject();
        }
    }

    public void writeObject(OutputStream out, JsonObject object) {
        try (JsonWriter writer = writerFactory.createWriter(out)) {
            writer.writeObject(object);
        }
    }
}
```

---

## 13. Provider SPI: `JsonProvider`

JSON-P adalah API. Di runtime, perlu implementation/provider.

```text
Application code
    ↓
jakarta.json-api
    ↓
JsonProvider SPI
    ↓
Implementation provider
    contoh: Eclipse Parsson
```

`JsonProvider` berada di:

```java
jakarta.json.spi.JsonProvider
```

Kita biasanya tidak perlu memanggil provider langsung, karena `Json` sudah menyediakan shortcut.

Tetapi untuk memahami runtime problem, provider ini penting.

### 13.1 Provider Discovery

Saat kita memanggil:

```java
Json.createObjectBuilder()
```

JSON-P mencari provider implementation di classpath/module path. Jika hanya ada API tanpa implementation, aplikasi bisa gagal saat runtime.

Gejala umum:

```text
No JsonProvider found
ClassNotFoundException provider
ServiceConfigurationError
```

### 13.2 API vs Implementation Dependency

Salah:

```xml
<dependency>
    <groupId>jakarta.json</groupId>
    <artifactId>jakarta.json-api</artifactId>
    <version>2.1.3</version>
</dependency>
```

Jika aplikasi standalone hanya memasukkan API tanpa provider, API tidak cukup.

Benar untuk standalone:

```xml
<dependency>
    <groupId>jakarta.json</groupId>
    <artifactId>jakarta.json-api</artifactId>
    <version>2.1.3</version>
</dependency>

<dependency>
    <groupId>org.eclipse.parsson</groupId>
    <artifactId>jakarta.json</artifactId>
    <version>1.1.7</version>
</dependency>
```

Dalam application server Jakarta EE, provider mungkin sudah disediakan container. Maka dependency bisa `provided`, tergantung packaging strategy.

### 13.3 Production Rule

Selalu jawab pertanyaan ini saat memakai JSON-P:

```text
Siapa yang menyediakan JsonProvider di runtime?

- application dependency?
- application server?
- framework BOM?
- shaded dependency?
- test dependency berbeda dari production?
```

Jika tidak jelas, bug akan muncul saat deployment, bukan saat compile.

---

## 14. Maven dan Gradle Setup untuk Java 8–25

### 14.1 Jakarta JSON-P untuk Java 11+

Contoh Maven modern:

```xml
<dependencies>
    <dependency>
        <groupId>jakarta.json</groupId>
        <artifactId>jakarta.json-api</artifactId>
        <version>2.1.3</version>
    </dependency>
    <dependency>
        <groupId>org.eclipse.parsson</groupId>
        <artifactId>jakarta.json</artifactId>
        <version>1.1.7</version>
    </dependency>
</dependencies>
```

Contoh Gradle:

```gradle
dependencies {
    implementation 'jakarta.json:jakarta.json-api:2.1.3'
    runtimeOnly 'org.eclipse.parsson:jakarta.json:1.1.7'
}
```

Jika provider perlu dipakai saat test juga:

```gradle
dependencies {
    implementation 'jakarta.json:jakarta.json-api:2.1.3'
    implementation 'org.eclipse.parsson:jakarta.json:1.1.7'
}
```

### 14.2 Java 8 / Java EE Namespace

Untuk project Java 8 legacy yang masih `javax.json`:

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

### 14.3 Jangan Campur Namespace dalam Modul yang Sama

Buruk:

```xml
<dependency>
    <groupId>javax.json</groupId>
    <artifactId>javax.json-api</artifactId>
    <version>1.1.4</version>
</dependency>
<dependency>
    <groupId>jakarta.json</groupId>
    <artifactId>jakarta.json-api</artifactId>
    <version>2.1.3</version>
</dependency>
```

Bisa saja ada transitive dependency yang membawa keduanya. Maka gunakan:

```bash
mvn dependency:tree
```

atau:

```bash
./gradlew dependencies
```

Tujuan:

```text
Pastikan boundary module memilih satu dunia:
- javax.json untuk legacy Java EE 8
- jakarta.json untuk Jakarta EE 9+
```

---

## 15. Basic Validation dengan JSON-P

JSON-P bukan Bean Validation dan bukan JSON Schema validator. Tetapi sangat berguna untuk validasi structural ringan sebelum binding.

Misalnya kontrak request:

```json
{
  "caseId": "CASE-2026-0001",
  "action": "APPROVE",
  "comment": "Looks good"
}
```

Kita ingin:

```text
caseId wajib string non-empty
action wajib salah satu APPROVE/REJECT/RETURN
comment optional string
unknown field ditolak
```

### 15.1 Helper Validasi

```java
public final class JsonContractValidator {
    private JsonContractValidator() {}

    public static String requiredString(JsonObject obj, String field) {
        if (!obj.containsKey(field) || obj.isNull(field)) {
            throw new IllegalArgumentException("Missing required field: " + field);
        }
        if (obj.get(field).getValueType() != JsonValue.ValueType.STRING) {
            throw new IllegalArgumentException("Field must be string: " + field);
        }
        String value = obj.getString(field).trim();
        if (value.isEmpty()) {
            throw new IllegalArgumentException("Field must not be blank: " + field);
        }
        return value;
    }

    public static Optional<String> optionalString(JsonObject obj, String field) {
        if (!obj.containsKey(field) || obj.isNull(field)) {
            return Optional.empty();
        }
        if (obj.get(field).getValueType() != JsonValue.ValueType.STRING) {
            throw new IllegalArgumentException("Field must be string: " + field);
        }
        return Optional.of(obj.getString(field));
    }

    public static void rejectUnknownFields(JsonObject obj, Set<String> allowedFields) {
        for (String key : obj.keySet()) {
            if (!allowedFields.contains(key)) {
                throw new IllegalArgumentException("Unknown field: " + key);
            }
        }
    }
}
```

Untuk Java 8, `Set.of(...)` belum ada. Gunakan `new HashSet<>(Arrays.asList(...))`.

### 15.2 Menggunakan Validator

```java
public ReviewAction parseReviewAction(JsonObject obj) {
    Set<String> allowed = Set.of("caseId", "action", "comment");
    JsonContractValidator.rejectUnknownFields(obj, allowed);

    String caseId = JsonContractValidator.requiredString(obj, "caseId");
    String action = JsonContractValidator.requiredString(obj, "action");
    Optional<String> comment = JsonContractValidator.optionalString(obj, "comment");

    if (!Set.of("APPROVE", "REJECT", "RETURN").contains(action)) {
        throw new IllegalArgumentException("Invalid action: " + action);
    }

    return new ReviewAction(caseId, action, comment.orElse(null));
}
```

Ini bukan pengganti validation framework, tetapi bagus untuk boundary yang perlu strict structural contract.

---

## 16. Unknown Field Policy: Reject, Ignore, atau Preserve?

Saat membaca JSON, selalu putuskan unknown field policy.

| Policy | Arti | Cocok untuk | Risiko |
|---|---|---|---|
| Reject | field tidak dikenal = error | command API, payment, regulatory action | bisa terlalu rigid |
| Ignore | field tidak dikenal diabaikan | backward-compatible client input | typo client bisa tidak ketahuan |
| Preserve | field disalin ke output/event | gateway/enrichment/internal event | data leak / contract ambiguity |
| Capture | field tidak dikenal masuk `metadata` | extensibility terkontrol | metadata jadi tempat sampah |

JSON-P membuat policy ini eksplisit.

### 16.1 Reject Unknown

```java
public void rejectUnknown(JsonObject obj, Set<String> allowed) {
    for (String key : obj.keySet()) {
        if (!allowed.contains(key)) {
            throw new IllegalArgumentException("Unknown field: " + key);
        }
    }
}
```

### 16.2 Ignore Unknown

```java
String caseId = obj.getString("caseId");
String status = obj.getString("status");
```

Field lain otomatis tidak dipakai.

### 16.3 Preserve Unknown

```java
JsonObject enriched = Json.createObjectBuilder(obj)
        .add("processedAt", Instant.now().toString())
        .build();
```

### 16.4 Capture Unknown

```java
public JsonObject captureUnknown(JsonObject obj, Set<String> known) {
    JsonObjectBuilder metadata = Json.createObjectBuilder();

    for (Map.Entry<String, JsonValue> entry : obj.entrySet()) {
        if (!known.contains(entry.getKey())) {
            metadata.add(entry.getKey(), entry.getValue());
        }
    }

    return metadata.build();
}
```

Rule of thumb:

```text
For commands that change state: reject unknown fields.
For queries/read models: ignore may be acceptable.
For gateways: preserve only inside trusted internal boundary.
```

---

## 17. Type-Safe Access vs Convenience Methods

`JsonObject` menyediakan convenience method:

```java
obj.getString("status")
obj.getInt("priority")
obj.getBoolean("active")
```

Namun method ini bisa throw exception jika field tidak ada atau tipe salah.

### 17.1 Dengan Default Value

```java
String status = obj.getString("status", "UNKNOWN");
int priority = obj.getInt("priority", 0);
boolean active = obj.getBoolean("active", false);
```

Default value berguna, tapi berbahaya jika dipakai untuk field wajib.

Buruk:

```java
String caseId = obj.getString("caseId", "");
```

Kenapa buruk?

```text
Missing required field disembunyikan menjadi empty string.
Bug kontrak berubah menjadi bug business logic.
```

### 17.2 Untuk Field Wajib, Fail Fast

```java
String caseId = requiredString(obj, "caseId");
```

### 17.3 Untuk Field Optional, Pakai Optional Semantik

```java
Optional<String> note = optionalString(obj, "note");
```

Jangan treat optional sama dengan required yang punya default palsu.

---

## 18. Numeric Precision dan JSON-P

JSON tidak punya tipe numerik eksplisit seperti Java.

```json
{
  "id": 9007199254740993,
  "amount": 1234567890.123456789
}
```

Jika dibaca sebagai double, precision bisa rusak.

```java
double amount = obj.getJsonNumber("amount").doubleValue(); // hati-hati
```

Untuk amount:

```java
BigDecimal amount = obj.getJsonNumber("amount").bigDecimalValue();
```

Untuk ID numeric besar:

```java
BigInteger id = obj.getJsonNumber("id").bigIntegerValueExact();
```

Untuk integer yang harus muat `int`:

```java
int priority = obj.getJsonNumber("priority").intValueExact();
```

`intValueExact()` lebih baik daripada `intValue()` jika overflow atau decimal harus dianggap error.

### 18.1 Rule of Thumb Numerik

| Data | Gunakan | Hindari |
|---|---|---|
| Money | `BigDecimal` | `double`, `float` |
| Database ID besar | `longValueExact()` / `BigInteger` | `double` |
| Count kecil | `intValueExact()` | silent narrowing |
| Percentage/rate | `BigDecimal` | binary floating point bila audit-critical |
| Scientific approximate | `double` bisa diterima | BigDecimal berlebihan |

Mental model:

```text
JSON number is syntax.
Java number type is semantic decision.
```

---

## 19. Dates dan Time: JSON-P Tidak Memiliki Tipe Date

JSON tidak punya date type. Date biasanya string.

```json
{
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Dengan JSON-P:

```java
String raw = obj.getString("submittedAt");
OffsetDateTime submittedAt = OffsetDateTime.parse(raw);
```

Untuk date-only:

```java
LocalDate date = LocalDate.parse(obj.getString("effectiveDate"));
```

### 19.1 Jangan Pakai Default Time Zone Diam-Diam

Buruk:

```java
Date date = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss").parse(raw);
```

Masalah:

```text
timezone implicit
thread-safety SimpleDateFormat
ambiguous interpretation
audit trail tidak deterministik
```

Lebih baik:

```java
OffsetDateTime.parse(raw)
Instant.parse(raw)
ZonedDateTime.parse(raw)
```

Pilih berdasarkan kontrak:

```text
Instant          = absolute machine time
OffsetDateTime  = timestamp dengan offset eksplisit
ZonedDateTime   = timestamp dengan region zone rules
LocalDate       = tanggal kalender tanpa waktu
LocalTime       = jam tanpa tanggal
```

---

## 20. Character Encoding: InputStream vs Reader

JSON secara praktis biasanya UTF-8. Namun Java API bisa membaca dari `InputStream` atau `Reader`.

```java
Json.createReader(inputStream)
Json.createReader(reader)
```

Jika memakai `Reader`, encoding sudah diputuskan sebelum JSON-P.

```java
Reader reader = new InputStreamReader(inputStream, StandardCharsets.UTF_8);
JsonReader jsonReader = Json.createReader(reader);
```

Jika memakai `InputStream`, provider menangani pembacaan bytes sesuai JSON encoding detection/implementation behavior.

Praktik enterprise:

1. Di HTTP, validasi `Content-Type` dan charset jika relevan.
2. Standarkan UTF-8 untuk semua JSON contract.
3. Hindari default platform encoding.
4. Saat logging, jangan re-encode payload sembarangan.

Buruk:

```java
new InputStreamReader(inputStream) // default charset platform
```

Baik:

```java
new InputStreamReader(inputStream, StandardCharsets.UTF_8)
```

---

## 21. Memory Model: Object Model Memuat Tree ke Heap

Ini sangat penting.

Saat memakai:

```java
JsonObject obj = reader.readObject();
```

JSON-P membuat object model di heap.

Mental model:

```text
Raw JSON bytes
    ↓ parse
JsonObject tree in memory
    ↓ each object/array/string/number represented as Java objects
```

Konsekuensi:

1. Payload 1 MB bisa menjadi beberapa MB di heap.
2. Banyak nested object memperbanyak allocation.
3. Array besar akan membuat banyak object.
4. Garbage collection bisa meningkat.
5. Untuk high-throughput API, object model bisa menjadi bottleneck.

### 21.1 Kapan Object Model Aman?

Object model aman untuk:

- request/response kecil-menengah;
- config JSON;
- metadata;
- event payload wajar;
- transformasi field terbatas;
- contract testing;
- patch document kecil;
- admin/internal API.

### 21.2 Kapan Harus Streaming?

Gunakan streaming jika:

- payload bisa sangat besar;
- array berisi ratusan ribu/millions item;
- hanya perlu field tertentu;
- ingin proses record per record;
- ingin menghindari heap spike;
- ingestion pipeline;
- file import/export;
- event replay besar.

Decision:

```text
Need random access / structural transformation?
    Object Model.

Need linear read/write / huge payload?
    Streaming.
```

---

## 22. JSON-P sebagai Boundary Layer

Top 1% engineer tidak memakai JSON-P hanya karena “bisa parse JSON”. Ia memakai JSON-P untuk menjaga boundary.

Boundary yang baik memisahkan:

```text
External JSON contract
    ≠ Internal domain model
    ≠ Persistence entity
    ≠ UI view state
    ≠ Audit representation
```

JSON-P bisa menjadi layer eksplisit:

```text
HTTP request body
    ↓
JsonObject rawPayload
    ↓
structural validation
    ↓
normalization
    ↓
DTO / command object
    ↓
application service
```

Contoh desain:

```java
public final class SubmitApplicationJsonAdapter {
    public SubmitApplicationCommand parse(JsonObject json) {
        rejectUnknownFields(json, Set.of(
                "applicantId",
                "applicationType",
                "submittedAt",
                "answers"
        ));

        String applicantId = requiredString(json, "applicantId");
        String applicationType = requiredString(json, "applicationType");
        OffsetDateTime submittedAt = OffsetDateTime.parse(requiredString(json, "submittedAt"));
        JsonArray answers = requiredArray(json, "answers");

        return new SubmitApplicationCommand(
                applicantId,
                applicationType,
                submittedAt,
                parseAnswers(answers)
        );
    }
}
```

Ini lebih verbose daripada binding otomatis. Tetapi untuk boundary kritikal, verbosity adalah harga untuk explicitness.

---

## 23. Anti-Pattern: Langsung Pakai `JsonObject` di Domain Layer

JSON-P cocok di boundary. Tetapi jangan biarkan `JsonObject` menyebar ke domain core.

Buruk:

```java
public class CaseService {
    public void submit(JsonObject payload) {
        String applicantId = payload.getString("applicantId");
        // business logic campur parsing
    }
}
```

Masalah:

1. Domain service tergantung format external.
2. Field rename merusak business logic.
3. Validation tersebar.
4. Test business logic harus membuat JSON.
5. Security boundary kabur.
6. Tidak jelas mana data sudah normalized.

Lebih baik:

```java
public class CaseService {
    public void submit(SubmitApplicationCommand command) {
        // business logic memakai model internal yang sudah valid
    }
}
```

Adapter di boundary:

```java
public class SubmitApplicationEndpoint {
    private final SubmitApplicationJsonAdapter adapter;
    private final CaseService caseService;

    public void submit(InputStream body) {
        JsonObject json = readJsonObject(body);
        SubmitApplicationCommand command = adapter.parse(json);
        caseService.submit(command);
    }
}
```

Rule:

```text
JsonObject boleh masuk adapter/boundary layer.
JsonObject sebaiknya tidak masuk domain/application core.
```

---

## 24. Error Handling: Parse Error vs Contract Error vs Business Error

Saat membaca JSON, bedakan jenis error.

```text
Parse error
    JSON syntax rusak

Structural contract error
    JSON valid, tapi shape salah

Semantic contract error
    tipe benar, tapi value tidak valid untuk kontrak

Business error
    kontrak valid, tapi operasi tidak boleh menurut state/rule
```

Contoh:

```json
{ "caseId": "CASE-1", "action": }
```

Parse error.

```json
{ "caseId": 123, "action": "APPROVE" }
```

Structural contract error jika `caseId` harus string.

```json
{ "caseId": "CASE-1", "action": "DELETE" }
```

Semantic contract error jika action hanya `APPROVE/REJECT/RETURN`.

```json
{ "caseId": "CASE-1", "action": "APPROVE" }
```

Business error jika case sudah CLOSED dan tidak boleh approve.

### 24.1 Mapping ke HTTP Status

Dalam API HTTP umum:

| Error | HTTP Status Umum |
|---|---:|
| malformed JSON | 400 Bad Request |
| structural contract violation | 400 Bad Request |
| semantic validation violation | 400 atau 422 tergantung standar API |
| unauthorized/forbidden | 401/403 |
| business state conflict | 409 Conflict |
| downstream unavailable | 502/503/504 |

JSON-P membantu memisahkan parse/structure sebelum masuk business layer.

---

## 25. Membuat Error Response dengan JSON-P

Contoh error response eksplisit:

```java
public JsonObject errorResponse(String code, String message, String correlationId) {
    return Json.createObjectBuilder()
            .add("error", Json.createObjectBuilder()
                    .add("code", code)
                    .add("message", message)
                    .add("correlationId", correlationId))
            .build();
}
```

Hasil:

```json
{
  "error": {
    "code": "INVALID_JSON_CONTRACT",
    "message": "Field must be string: caseId",
    "correlationId": "c6f7d2b1"
  }
}
```

Praktik penting:

1. Jangan echo payload sensitif ke error response.
2. Jangan bocorkan stack trace.
3. Sertakan correlation ID.
4. Gunakan code stabil untuk client.
5. Message boleh manusiawi, tapi jangan menjadi contract utama.

---

## 26. Testability: JSON-P untuk Contract Tests

JSON-P bagus untuk contract testing karena kita bisa assert struktur.

```java
@Test
void shouldBuildErrorResponse() {
    JsonObject error = errorResponse(
            "INVALID_JSON_CONTRACT",
            "Field must be string: caseId",
            "corr-1"
    );

    JsonObject body = error.getJsonObject("error");
    assertEquals("INVALID_JSON_CONTRACT", body.getString("code"));
    assertEquals("corr-1", body.getString("correlationId"));
}
```

Untuk membandingkan JSON string, jangan bandingkan raw string jika field order tidak dijamin sebagai contract.

Buruk:

```java
assertEquals("{\"a\":1,\"b\":2}", json);
```

Lebih baik:

```java
JsonObject actual = readObject(json);
assertEquals(1, actual.getInt("a"));
assertEquals(2, actual.getInt("b"));
```

### 26.1 Field Order

JSON object secara semantic adalah kumpulan name/value pair. Jangan jadikan field order sebagai contract kecuali ada kebutuhan canonicalization khusus.

Untuk signature/canonical JSON, field order dan serialization detail perlu aturan tersendiri. Itu akan dibahas lebih jauh pada Part 6.

---

## 27. Layered Example: Mini Boundary Adapter Lengkap

Kita buat contoh kecil tapi production-minded.

### 27.1 Contract

Request:

```json
{
  "caseId": "CASE-2026-0001",
  "action": "APPROVE",
  "comment": "Checked and approved",
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Rules:

```text
caseId wajib string non-blank
action wajib APPROVE/REJECT/RETURN
comment optional string, boleh absent, tidak boleh null jika dikirim
submittedAt wajib ISO offset datetime
unknown field ditolak
```

### 27.2 Command Object

```java
public final class ReviewCaseCommand {
    private final String caseId;
    private final ReviewAction action;
    private final Optional<String> comment;
    private final OffsetDateTime submittedAt;

    public ReviewCaseCommand(
            String caseId,
            ReviewAction action,
            Optional<String> comment,
            OffsetDateTime submittedAt
    ) {
        this.caseId = Objects.requireNonNull(caseId);
        this.action = Objects.requireNonNull(action);
        this.comment = Objects.requireNonNull(comment);
        this.submittedAt = Objects.requireNonNull(submittedAt);
    }

    public String caseId() {
        return caseId;
    }

    public ReviewAction action() {
        return action;
    }

    public Optional<String> comment() {
        return comment;
    }

    public OffsetDateTime submittedAt() {
        return submittedAt;
    }
}
```

Untuk Java 16+, bisa pakai record:

```java
public record ReviewCaseCommand(
        String caseId,
        ReviewAction action,
        Optional<String> comment,
        OffsetDateTime submittedAt
) {}
```

### 27.3 Enum

```java
public enum ReviewAction {
    APPROVE,
    REJECT,
    RETURN;

    public static ReviewAction parse(String raw) {
        try {
            return ReviewAction.valueOf(raw);
        } catch (IllegalArgumentException ex) {
            throw new JsonContractException("Invalid action: " + raw, ex);
        }
    }
}
```

### 27.4 Contract Exception

```java
public class JsonContractException extends RuntimeException {
    public JsonContractException(String message) {
        super(message);
    }

    public JsonContractException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

### 27.5 Adapter

```java
public final class ReviewCaseJsonAdapter {
    private static final Set<String> ALLOWED_FIELDS = Set.of(
            "caseId",
            "action",
            "comment",
            "submittedAt"
    );

    public ReviewCaseCommand parse(JsonObject json) {
        rejectUnknownFields(json);

        String caseId = requiredString(json, "caseId");
        ReviewAction action = ReviewAction.parse(requiredString(json, "action"));
        Optional<String> comment = optionalNonNullString(json, "comment");
        OffsetDateTime submittedAt = parseOffsetDateTime(requiredString(json, "submittedAt"));

        return new ReviewCaseCommand(caseId, action, comment, submittedAt);
    }

    private void rejectUnknownFields(JsonObject json) {
        for (String key : json.keySet()) {
            if (!ALLOWED_FIELDS.contains(key)) {
                throw new JsonContractException("Unknown field: " + key);
            }
        }
    }

    private String requiredString(JsonObject json, String field) {
        if (!json.containsKey(field)) {
            throw new JsonContractException("Missing required field: " + field);
        }
        if (json.isNull(field)) {
            throw new JsonContractException("Field must not be null: " + field);
        }
        if (json.get(field).getValueType() != JsonValue.ValueType.STRING) {
            throw new JsonContractException("Field must be string: " + field);
        }
        String value = json.getString(field).trim();
        if (value.isEmpty()) {
            throw new JsonContractException("Field must not be blank: " + field);
        }
        return value;
    }

    private Optional<String> optionalNonNullString(JsonObject json, String field) {
        if (!json.containsKey(field)) {
            return Optional.empty();
        }
        if (json.isNull(field)) {
            throw new JsonContractException("Field must not be null if present: " + field);
        }
        if (json.get(field).getValueType() != JsonValue.ValueType.STRING) {
            throw new JsonContractException("Field must be string: " + field);
        }
        return Optional.of(json.getString(field));
    }

    private OffsetDateTime parseOffsetDateTime(String value) {
        try {
            return OffsetDateTime.parse(value);
        } catch (DateTimeParseException ex) {
            throw new JsonContractException("Invalid submittedAt datetime", ex);
        }
    }
}
```

Untuk Java 8, `Set.of` diganti:

```java
private static final Set<String> ALLOWED_FIELDS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("caseId", "action", "comment", "submittedAt"))
);
```

### 27.6 Reader Wrapper

```java
public final class JsonPayloadReader {
    private final JsonReaderFactory readerFactory;

    public JsonPayloadReader() {
        this.readerFactory = Json.createReaderFactory(Collections.emptyMap());
    }

    public JsonObject readObject(InputStream inputStream) {
        try (JsonReader reader = readerFactory.createReader(inputStream)) {
            return reader.readObject();
        } catch (JsonParsingException ex) {
            throw new JsonContractException("Malformed JSON", ex);
        } catch (JsonException ex) {
            throw new JsonContractException("Invalid JSON payload", ex);
        }
    }
}
```

### 27.7 Flow Lengkap

```text
HTTP InputStream
    ↓
JsonPayloadReader
    ↓ parse syntax
JsonObject
    ↓ structural + semantic validation
ReviewCaseJsonAdapter
    ↓
ReviewCaseCommand
    ↓
Application service
```

Inilah style boundary yang kuat: parsing, contract validation, dan business logic tidak dicampur.

---

## 28. JSON-P di Jakarta REST / JAX-RS Context

Karena seri sebelumnya sudah membahas JAX-RS advance, kita tidak mengulang detail JAX-RS. Tetapi JSON-P punya posisi penting di JAX-RS.

Dalam Jakarta REST, `JsonObject` bisa dipakai sebagai entity type bila provider mendukung.

Contoh konseptual:

```java
@POST
@Path("/cases/review")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response review(JsonObject payload) {
    ReviewCaseCommand command = adapter.parse(payload);
    service.review(command);

    JsonObject response = Json.createObjectBuilder()
            .add("status", "ACCEPTED")
            .add("caseId", command.caseId())
            .build();

    return Response.accepted(response).build();
}
```

Namun di boundary kritikal, membaca `InputStream` sendiri kadang memberi kontrol lebih atas:

1. ukuran maksimum payload;
2. parse error handling;
3. logging/redaction;
4. metrics;
5. correlation;
6. rejection sebelum binding.

---

## 29. JSON-P dan Logging/Audit

JSON-P sering dipakai untuk audit karena bisa menjaga struktur.

Tetapi jangan sembarang log payload.

Buruk:

```java
log.info("payload={}", jsonObject);
```

Masalah:

1. PII bocor.
2. Secret/token bocor.
3. Payload besar memenuhi log.
4. Log injection.
5. Unknown field bisa membawa data sensitif.

### 29.1 Redaction dengan JSON-P

```java
public JsonObject redact(JsonObject input) {
    JsonObjectBuilder builder = Json.createObjectBuilder();

    for (Map.Entry<String, JsonValue> entry : input.entrySet()) {
        String key = entry.getKey();
        if (isSensitive(key)) {
            builder.add(key, "***REDACTED***");
        } else {
            builder.add(key, entry.getValue());
        }
    }

    return builder.build();
}

private boolean isSensitive(String key) {
    String normalized = key.toLowerCase(Locale.ROOT);
    return normalized.contains("password")
            || normalized.contains("token")
            || normalized.contains("secret")
            || normalized.contains("nric")
            || normalized.contains("email")
            || normalized.contains("phone");
}
```

Ini hanya redaction level pertama. Untuk nested object/array, perlu recursive redaction.

### 29.2 Recursive Redaction

```java
public JsonValue redactValue(JsonValue value) {
    switch (value.getValueType()) {
        case OBJECT:
            return redactObject(value.asJsonObject());
        case ARRAY:
            JsonArrayBuilder array = Json.createArrayBuilder();
            for (JsonValue item : value.asJsonArray()) {
                array.add(redactValue(item));
            }
            return array.build();
        default:
            return value;
    }
}

public JsonObject redactObject(JsonObject input) {
    JsonObjectBuilder builder = Json.createObjectBuilder();

    for (Map.Entry<String, JsonValue> entry : input.entrySet()) {
        if (isSensitive(entry.getKey())) {
            builder.add(entry.getKey(), "***REDACTED***");
        } else {
            builder.add(entry.getKey(), redactValue(entry.getValue()));
        }
    }

    return builder.build();
}
```

Ini contoh bagaimana JSON-P berguna untuk transformasi struktur tanpa memerlukan DTO.

---

## 30. Security Baseline untuk JSON-P Core

Security JSON tidak sedalam XML security, tetapi tetap ada risiko.

### 30.1 Risiko Utama

1. **Payload terlalu besar** — heap exhaustion.
2. **Nested terlalu dalam** — parser/stack/memory pressure.
3. **Array sangat besar** — allocation spike.
4. **String sangat besar** — memory/log issue.
5. **Duplicate keys** — interpretasi bisa berbeda antar parser/library.
6. **Number ekstrem** — overflow/precision issue.
7. **Unknown field injection** — field tak dikenal masuk pipeline.
8. **Log injection** — payload mengandung newline/control characters.
9. **Semantic confusion** — null vs absent tidak dibedakan.

### 30.2 Baseline Mitigation

Di boundary:

```text
- Batasi ukuran request body sebelum parsing.
- Pilih object model hanya untuk payload yang ukurannya wajar.
- Reject unknown fields untuk command kritikal.
- Validasi tipe sebelum mengambil value.
- Pakai BigDecimal/BigInteger untuk angka audit-critical.
- Bedakan null dan absent.
- Redact sebelum logging.
- Hindari echo raw payload ke response.
- Gunakan streaming untuk payload besar.
```

### 30.3 Size Limit Bukan Tugas JSON-P Saja

Batas ukuran biasanya dilakukan di layer sebelum parser:

```text
API Gateway / reverse proxy
    ↓
Servlet container / framework config
    ↓
application input wrapper
    ↓
JSON parser
```

Jangan berharap JSON-P object model menyelamatkan heap jika input sudah terlalu besar.

---

## 31. Performance Baseline

JSON-P object model performanya cukup untuk banyak kasus, tapi bukan magic.

### 31.1 Cost Centers

Cost utama:

1. Parsing bytes/chars.
2. Membuat object tree.
3. Allocation string/number/value.
4. Traversal object/array.
5. Serialization output.
6. GC cleanup.

### 31.2 Optimasi yang Masuk Akal

1. Reuse factory.
2. Jangan parse payload yang sama berkali-kali.
3. Jangan convert JSON → string → JSON berulang.
4. Hindari object model untuk array sangat besar.
5. Gunakan streaming untuk ingestion/export besar.
6. Validasi ukuran payload sebelum parse.
7. Benchmark dengan data nyata.
8. Jangan optimize field access mikro sebelum tahu bottleneck.

### 31.3 Anti-Pattern Performance

Buruk:

```java
String json = readAll(inputStream);
JsonObject obj = readJson(json);
String jsonAgain = obj.toString();
JsonObject objAgain = readJson(jsonAgain);
```

Ini membuat parse/serialize berulang tanpa kebutuhan.

Lebih baik:

```java
JsonObject obj = readJson(inputStream);
// gunakan object yang sama untuk validation/transformation
```

Atau untuk streaming:

```text
InputStream → JsonParser → process event → output/result
```

---

## 32. JPMS / Module Path Considerations

Pada Java 9+, ada module system. Banyak aplikasi enterprise tetap memakai classpath, tetapi jika memakai module path, dependency JSON-P perlu module metadata.

Konsep penting:

```text
API module: jakarta.json
Provider module: implementation provider, misalnya org.eclipse.parsson
```

Contoh module-info konseptual:

```java
module com.example.integration {
    requires jakarta.json;
}
```

Namun provider discovery via service loader harus tersedia. Jika memakai module path dan provider tidak terlihat, bisa muncul error provider tidak ditemukan.

Production advice:

1. Jika memakai classpath, dependency provider cukup ada di runtime classpath.
2. Jika memakai module path, test provider discovery secara eksplisit.
3. Jangan hanya test di IDE classpath lalu deploy di module path/container berbeda.
4. Buat smoke test yang memanggil `Json.createObjectBuilder().build()` di startup/test.

Smoke test:

```java
@Test
void jsonProviderShouldBeAvailable() {
    JsonObject object = Json.createObjectBuilder()
            .add("ok", true)
            .build();

    assertTrue(object.getBoolean("ok"));
}
```

---

## 33. JSON-P dalam Container vs Standalone

### 33.1 Standalone Application

Contoh:

```text
Spring Boot jar
CLI tool
batch processor
plain Java service
```

Biasanya Anda harus membawa API + provider sendiri.

```text
application jar
    ├── jakarta.json-api
    └── provider implementation
```

### 33.2 Jakarta EE Container

Contoh:

```text
Payara
WildFly
Open Liberty
GlassFish
```

Container mungkin sudah menyediakan API dan provider.

Dalam kasus ini, dependency sering `provided`.

```xml
<dependency>
    <groupId>jakarta.json</groupId>
    <artifactId>jakarta.json-api</artifactId>
    <scope>provided</scope>
</dependency>
```

Tetapi hati-hati:

1. Versi provider mengikuti container.
2. Behavior minor bisa berbeda antar implementation.
3. Fat jar yang membawa provider sendiri bisa konflik dengan container.
4. Classloader isolation penting.

### 33.3 Rule

```text
Untuk standalone: own your provider.
Untuk container: align with container BOM/spec version.
Untuk migration: lock behavior with tests.
```

---

## 34. JSON-P Object Model vs Jackson Tree Model

Karena banyak engineer familiar dengan Jackson `JsonNode`, bandingkan secara mental:

| Aspek | JSON-P `JsonObject` | Jackson `JsonNode` |
|---|---|---|
| Standar Jakarta | Ya | Tidak |
| Provider model | Jakarta SPI | Jackson implementation |
| Tree model | Ya | Ya |
| Mutability | JSON-P object immutable | `ObjectNode` mutable, `JsonNode` tree model variatif |
| Binding integration | via JSON-B/Jakarta stack | native Jackson databind |
| Ecosystem | Jakarta EE | Sangat luas di Spring/industry |
| Streaming | `JsonParser` JSON-P | Jackson streaming parser |
| Advanced features | standar minimal-portable | sangat kaya |

Decision:

```text
Jakarta EE portability / standard API / container integration?
    JSON-P.

Spring ecosystem / rich customization / high-performance Jackson stack?
    Jackson.

Need explicit structural boundary without vendor lock-in?
    JSON-P is a strong option.
```

Tidak perlu fanatik. Banyak sistem memakai keduanya di tempat berbeda. Yang penting: boundary jelas dan conversion tidak acak.

---

## 35. Design Heuristics: Kapan Memakai JSON-P Object Model?

Gunakan JSON-P object model jika:

1. Anda ingin memproses JSON sebagai struktur eksplisit.
2. Payload ukurannya wajar.
3. Anda perlu null vs absent.
4. Anda perlu reject/capture unknown field.
5. Anda membuat adapter antar versi kontrak.
6. Anda membuat audit redaction/transformation.
7. Anda berada di Jakarta EE stack.
8. Anda ingin portable API.
9. Anda ingin test contract tanpa binding magic.
10. Anda ingin menghindari domain object bocor ke external contract.

Jangan gunakan object model jika:

1. Payload sangat besar.
2. Anda hanya perlu mapping DTO sederhana dan stabil.
3. Anda perlu fitur advanced binding kaya.
4. Anda butuh schema validation formal.
5. Anda butuh JSON canonicalization/signature tanpa aturan tambahan.
6. Anda sedang memproses data stream record-by-record.

Gunakan streaming API untuk payload besar. Gunakan JSON-B/Jackson untuk DTO stabil. Gunakan JSON Schema validator jika butuh validasi formal JSON Schema.

---

## 36. Production Checklist JSON-P Core

Sebelum memakai JSON-P di production, jawab checklist ini.

### 36.1 Runtime

- [ ] Namespace sudah jelas: `javax.json` atau `jakarta.json`.
- [ ] API dependency dan provider dependency tersedia.
- [ ] Tidak ada konflik transitive `javax` vs `jakarta`.
- [ ] Behavior sama antara test dan production runtime.
- [ ] Provider discovery sudah diuji.

### 36.2 Contract

- [ ] Top-level object/array sudah ditentukan.
- [ ] Required field jelas.
- [ ] Optional field jelas.
- [ ] Null vs absent punya semantic eksplisit.
- [ ] Unknown field policy jelas.
- [ ] Numeric precision diputuskan berdasarkan domain.
- [ ] Date/time format eksplisit.

### 36.3 Security

- [ ] Request body size dibatasi sebelum parse.
- [ ] Payload besar tidak dibaca dengan object model.
- [ ] Unknown fields tidak bocor ke internal model.
- [ ] Sensitive fields di-redact sebelum log.
- [ ] Error response tidak mengandung raw payload/stack trace.
- [ ] Duplicate key policy dipahami/dicakup test jika penting.

### 36.4 Performance

- [ ] Factory reusable jika high-throughput.
- [ ] Tidak parse/serialize berulang tanpa alasan.
- [ ] Streaming dipilih untuk array/file besar.
- [ ] Benchmark menggunakan payload realistis.
- [ ] Memory usage dipertimbangkan.

### 36.5 Architecture

- [ ] `JsonObject` tidak bocor ke domain core.
- [ ] Adapter boundary terpisah dari business service.
- [ ] Contract tests tersedia.
- [ ] Transformation eksplisit dan mudah diaudit.
- [ ] Migration Java 8→11+ dan `javax`→`jakarta` dipetakan.

---

## 37. Mental Model Akhir Part 3

Ringkasnya:

```text
JSON-P Object Model adalah cara standar Jakarta untuk memegang JSON sebagai struktur immutable.
```

Ia bukan binding otomatis. Ia memberi kontrol.

```text
JsonReader
    membaca JSON menjadi JsonObject/JsonArray

JsonObject/JsonArray
    snapshot immutable struktur JSON

JsonObjectBuilder/JsonArrayBuilder
    staging area untuk membuat struktur baru

JsonWriter
    menulis struktur JSON keluar

JsonProvider
    implementation runtime di balik API
```

Gunakan JSON-P ketika yang Anda butuhkan adalah:

```text
explicit structure
controlled boundary
contract-aware transformation
null vs absent semantics
safe pre-binding validation
```

Jangan pakai JSON-P object model sebagai palu untuk semua paku. Untuk payload besar, gunakan streaming. Untuk DTO stabil, JSON-B/Jackson bisa lebih produktif. Untuk schema formal, gunakan validator yang memang memahami schema.

Top 1% engineer bukan yang paling hafal semua method. Yang membedakan adalah kemampuan memilih layer yang benar:

```text
Binding ketika model stabil.
Object model ketika struktur perlu dikontrol.
Streaming ketika ukuran dan throughput dominan.
Schema ketika kontrak perlu formal.
Adapter ketika external contract tidak boleh mencemari domain.
```

---

## 38. Latihan Praktis

### Latihan 1 — Null vs Absent

Buat parser PATCH JSON berikut:

```json
{
  "status": "CLOSED",
  "assignee": null
}
```

Rules:

```text
status absent     = tidak berubah
status null       = error
status string     = ubah status
assignee absent   = tidak berubah
assignee null     = unassign
assignee string   = assign
```

Target: jangan gunakan DTO biasa yang menghilangkan perbedaan null vs absent.

### Latihan 2 — Unknown Field Policy

Buat method:

```java
JsonObject normalizeExternalCase(JsonObject input)
```

Input versi eksternal:

```json
{
  "id": "CASE-1",
  "state": "OPEN",
  "owner": "alice",
  "unexpected": "x"
}
```

Output internal:

```json
{
  "caseId": "CASE-1",
  "status": "OPEN",
  "assignee": "alice"
}
```

Tentukan apakah `unexpected` ditolak, diabaikan, atau disimpan sebagai metadata. Jelaskan konsekuensinya.

### Latihan 3 — Numeric Precision

Parse payload:

```json
{
  "amount": 1234567890.123456789,
  "caseNumericId": 9007199254740993
}
```

Gunakan tipe Java yang tidak kehilangan precision.

### Latihan 4 — Recursive Redaction

Buat recursive redaction untuk JSON:

```json
{
  "name": "Alice",
  "credentials": {
    "token": "secret-token"
  },
  "contacts": [
    { "email": "alice@example.com" }
  ]
}
```

Output harus mengganti `token` dan `email` menjadi `***REDACTED***`.

### Latihan 5 — Provider Smoke Test

Buat unit test yang memastikan provider JSON-P tersedia di runtime. Jalankan di local dan environment build.

---

## 39. Referensi Resmi

- Jakarta JSON Processing specification page: https://jakarta.ee/specifications/jsonp/
- Jakarta JSON Processing 2.1: https://jakarta.ee/specifications/jsonp/2.1/
- Jakarta EE Tutorial — JSON Processing: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jsonp/jsonp.html
- Jakarta JSON Processing API docs — `JsonReader`: https://jakarta.ee/specifications/jsonp/2.1/apidocs/jakarta.json/jakarta/json/jsonreader
- Jakarta JSON Processing API docs — streaming package: https://jakarta.ee/specifications/jsonp/2.1/apidocs/jakarta.json/jakarta/json/stream/package-summary
- Eclipse Parsson project: https://projects.eclipse.org/projects/ee4j.parsson
- Eclipse Parsson GitHub: https://github.com/eclipse-ee4j/parsson
- Jakarta JSON-P API GitHub: https://github.com/jakartaee/jsonp-api

---

## 40. Penutup

Part 3 membangun fondasi JSON-P object model. Setelah ini, kita akan masuk ke **Part 4 — JSON-P Streaming Deep Dive**, yaitu cara membaca/menulis JSON sebagai event stream untuk payload besar, ingestion pipeline, partial extraction, dan desain yang lebih hemat memory.

Status seri: **belum selesai**.  
Part ini adalah **Part 3 dari 34**.  
Berikutnya: **Part 4 — JSON-P Streaming Deep Dive**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-002.md">⬅️ Part 2 — Java JSON Ecosystem Map: JSON-P, JSON-B, Jackson, Gson, Provider Runtime, dan Pilihan Library yang Benar</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-004.md">Part 4 — JSON-P Streaming Deep Dive ➡️</a>
</div>
