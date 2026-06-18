# Part 14 — Jackson Performance: Allocation, Streaming, Large Payloads, Hot Paths

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `14-jackson-performance-allocation-streaming-large-payloads-hot-paths.md`  
> Target: Java 8 sampai Java 25  
> Fokus: performance Jackson sebagai bagian dari boundary engineering, bukan sekadar micro-optimization.

---

## 0. Posisi Materi Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

1. mental model transformation boundary,
2. desain object/DTO,
3. manual mapping,
4. arsitektur mapper,
5. Jackson streaming/tree/databind,
6. `ObjectMapper` engineering,
7. serialization/deserialization,
8. polymorphism,
9. custom serializer/deserializer,
10. enterprise API contract,
11. security Jackson.

Bagian ini membahas aspek yang sering terlambat dipikirkan: **performance JSON mapping**.

Namun penting: performa Jackson bukan hanya soal “Jackson cepat atau lambat”. Yang lebih penting adalah:

- payload sebesar apa yang kita proses,
- apakah payload dibaca sekaligus atau incremental,
- apakah object graph yang dibuat terlalu besar,
- apakah mapper membuat object yang tidak perlu,
- apakah kita memicu lazy loading database saat serialization,
- apakah JSON conversion dilakukan berulang di hot path,
- apakah kita mengukur dengan benar,
- apakah optimasi justru merusak contract dan maintainability.

Top engineer tidak langsung berkata “pakai streaming agar cepat”. Top engineer bertanya:

> “Di boundary ini, bottleneck-nya CPU, allocation, GC, network, database, payload size, serialization shape, atau desain API?”

---

## 1. Mental Model: Jackson Performance = CPU + Allocation + I/O + Object Graph

Jackson performance biasanya dipengaruhi empat komponen besar.

```text
JSON bytes
   |
   v
[ I/O read ]
   |
   v
[ parsing tokens ]        CPU
   |
   v
[ binding to objects ]    CPU + allocation
   |
   v
[ object graph ]          memory + GC
   |
   v
[ application logic ]
   |
   v
[ serialization ]         CPU + allocation
   |
   v
JSON bytes
```

Saat deserialization:

- bytes dibaca dari network/file/message,
- Jackson parser membaca token JSON,
- databind membuat object Java,
- field dikonversi,
- collection dialokasikan,
- nested object dibuat,
- custom deserializer mungkin menjalankan logic tambahan,
- validation/application layer memproses object hasil binding.

Saat serialization:

- Jackson menginspeksi object,
- property writer mengambil value,
- custom serializer mungkin berjalan,
- date/time/enum/numeric diformat,
- nested object graph dijalankan,
- generator menulis token JSON,
- bytes dikirim ke response/file/message.

### 1.1 Bottleneck yang berbeda butuh solusi berbeda

| Gejala | Kemungkinan bottleneck | Solusi yang relevan |
|---|---:|---|
| CPU tinggi saat JSON encode/decode | parsing/binding cost | reuse mapper, ObjectReader/Writer, generated accessor module, reduce shape |
| GC sering | allocation object graph | streaming, projection DTO, avoid tree model, reduce nested graph |
| memory melonjak untuk file besar | full materialization | streaming parser, chunking, batch processing |
| response lambat karena DB query banyak | lazy loading/N+1 saat serialization | DTO projection, fetch plan, precomputed view |
| latency tinggi hanya di endpoint tertentu | hot path serialization | cache serialized output carefully, thinner DTO, benchmark |
| payload besar tapi CPU rendah | network/I/O bound | compression, pagination, partial response, API redesign |
| custom serializer lambat | inefficient code | optimize serializer, remove repeated formatting/config lookup |

Performance Jackson harus dilihat sebagai **pipeline**, bukan satu function call.

---

## 2. Tiga Mode Jackson dan Konsekuensi Performance

Jackson punya tiga model utama:

1. Streaming API,
2. Tree Model,
3. Data Binding.

Masing-masing punya trade-off.

---

## 3. Data Binding: Paling Nyaman, Tapi Membuat Object Graph Penuh

Contoh umum:

```java
OrderRequest request = objectMapper.readValue(json, OrderRequest.class);
String responseJson = objectMapper.writeValueAsString(response);
```

Data binding cocok untuk mayoritas API request/response karena:

- readable,
- type-safe,
- cocok dengan DTO,
- mudah ditest,
- integrasi baik dengan Spring/Jakarta stack,
- mendukung annotation/config/module.

Namun data binding membuat object Java lengkap.

Artinya, jika input JSON berisi 100.000 item, dan kita bind ke:

```java
public class ImportRequest {
    private List<ImportRow> rows;
}
```

maka semua row dibuat sebagai object di memory.

### 3.1 Biaya data binding

Biaya data binding berasal dari:

- parsing token,
- mencari deserializer,
- membuat object,
- memanggil constructor/setter/field accessor,
- membuat collection,
- konversi scalar,
- nested deserialization,
- custom deserializer,
- annotation introspection/cache,
- exception path tracking.

Jackson melakukan caching banyak metadata, tetapi object hasil binding tetap harus dialokasikan.

### 3.2 Kapan data binding cukup

Data binding biasanya cukup jika:

- payload kecil sampai sedang,
- endpoint request/response biasa,
- payload perlu divalidasi sebagai object utuh,
- object graph tidak terlalu dalam,
- volume traffic masih wajar,
- bottleneck utama bukan JSON processing.

Contoh aman:

```java
public record CreateCaseRequest(
    String caseType,
    String subjectId,
    String description
) {}
```

Payload kecil seperti ini tidak perlu streaming.

### 3.3 Kapan data binding mulai bermasalah

Data binding mulai bermasalah jika:

- payload array sangat besar,
- import/export file,
- Kafka/Rabbit batch message besar,
- report result ribuan/utaan row,
- JSON hanya perlu sebagian field,
- object graph dalam dan kompleks,
- ada cycles/proxy/lazy loading,
- custom serializer/deserializer berat,
- response shape terlalu gemuk.

Anti-pattern:

```java
ImportRequest request = objectMapper.readValue(largeJson, ImportRequest.class);

for (ImportRow row : request.getRows()) {
    process(row);
}
```

Masalahnya: kita menunggu semua row masuk memory sebelum mulai memproses.

---

## 4. Tree Model: Fleksibel, Tapi Lebih Mahal dari yang Sering Dikira

Tree model:

```java
JsonNode root = objectMapper.readTree(json);
String id = root.path("id").asText();
```

Tree model berguna untuk:

- payload dinamis,
- partial inspection,
- custom routing berdasarkan field,
- schema-less input,
- transformasi ringan,
- debugging,
- compatibility adapter,
- migration bridge.

Tetapi tree model membuat representasi JSON sebagai node object:

```text
ObjectNode
 ├── TextNode
 ├── NumericNode
 ├── ArrayNode
 │    ├── ObjectNode
 │    ├── ObjectNode
 │    └── ObjectNode
```

Ini bisa lebih mahal daripada binding langsung ke DTO, karena Jackson membuat node generic, lalu kadang kita convert lagi:

```java
JsonNode node = objectMapper.readTree(json);
Order order = objectMapper.treeToValue(node, Order.class);
```

Pipeline ini bisa menjadi:

```text
bytes -> tokens -> JsonNode tree -> DTO object
```

Padahal data binding langsung:

```text
bytes -> tokens -> DTO object
```

### 4.1 Kapan tree model masuk akal

Gunakan tree model jika:

- struktur payload tidak stabil,
- hanya perlu baca beberapa field kecil,
- payload kecil/sedang,
- perlu preserve unknown JSON section,
- perlu routing sebelum binding,
- perlu adapter legacy yang field-nya tidak konsisten.

Contoh:

```java
JsonNode root = objectMapper.readTree(json);
String eventType = root.path("type").asText();

switch (eventType) {
    case "CASE_CREATED" -> handle(objectMapper.treeToValue(root, CaseCreatedEvent.class));
    case "CASE_CLOSED" -> handle(objectMapper.treeToValue(root, CaseClosedEvent.class));
    default -> handleUnknown(root);
}
```

Ini masuk akal untuk event routing.

### 4.2 Kapan tree model harus dihindari

Hindari tree model untuk:

- file besar,
- array besar,
- high-throughput hot path,
- payload yang schema-nya sudah jelas,
- transformasi yang sebenarnya bisa dilakukan dengan DTO kecil,
- pipeline yang akhirnya tetap bind semua node ke object.

Anti-pattern:

```java
JsonNode root = objectMapper.readTree(hugeJson);
ArrayNode rows = (ArrayNode) root.get("rows");

for (JsonNode row : rows) {
    ImportRow importRow = objectMapper.treeToValue(row, ImportRow.class);
    process(importRow);
}
```

Untuk import besar, streaming lebih tepat.

---

## 5. Streaming API: Paling Efisien, Tapi Paling Eksplisit

Streaming API bekerja pada token.

Contoh token JSON:

```json
{
  "caseId": "C-001",
  "status": "OPEN"
}
```

Token stream:

```text
START_OBJECT
FIELD_NAME caseId
VALUE_STRING C-001
FIELD_NAME status
VALUE_STRING OPEN
END_OBJECT
```

Streaming cocok untuk:

- payload besar,
- file import/export,
- array besar,
- partial extraction,
- low allocation pipeline,
- data transfer antar sistem,
- batch processing,
- response streaming.

### 5.1 Membaca array besar secara streaming

Misal payload:

```json
{
  "batchId": "B-2026-001",
  "rows": [
    { "id": "1", "amount": 100 },
    { "id": "2", "amount": 200 }
  ]
}
```

Kita bisa streaming sampai field `rows`, lalu bind item per item.

```java
public final class ImportStreamingReader {

    private final ObjectMapper mapper;
    private final ObjectReader rowReader;

    public ImportStreamingReader(ObjectMapper mapper) {
        this.mapper = mapper;
        this.rowReader = mapper.readerFor(ImportRow.class);
    }

    public void read(InputStream input, RowHandler handler) throws IOException {
        JsonFactory factory = mapper.getFactory();

        try (JsonParser parser = factory.createParser(input)) {
            if (parser.nextToken() != JsonToken.START_OBJECT) {
                throw new IllegalArgumentException("Expected JSON object as root");
            }

            while (parser.nextToken() != JsonToken.END_OBJECT) {
                String fieldName = parser.currentName();
                parser.nextToken();

                if ("rows".equals(fieldName)) {
                    readRows(parser, handler);
                } else {
                    parser.skipChildren();
                }
            }
        }
    }

    private void readRows(JsonParser parser, RowHandler handler) throws IOException {
        if (parser.currentToken() != JsonToken.START_ARRAY) {
            throw new IllegalArgumentException("Expected rows to be an array");
        }

        while (parser.nextToken() != JsonToken.END_ARRAY) {
            ImportRow row = rowReader.readValue(parser);
            handler.handle(row);
        }
    }
}
```

Interface handler:

```java
@FunctionalInterface
public interface RowHandler {
    void handle(ImportRow row);
}
```

DTO:

```java
public record ImportRow(
    String id,
    BigDecimal amount
) {}
```

Keuntungan:

- tidak membuat `List<ImportRow>` besar,
- processing bisa dimulai sebelum semua payload selesai dibaca,
- memory lebih stabil,
- error bisa dikaitkan dengan row tertentu,
- cocok untuk batch import.

### 5.2 Hybrid streaming + databind

Model terbaik sering bukan pure streaming manual, tetapi hybrid:

```text
Streaming untuk struktur besar
Databind untuk unit kecil yang stabil
```

Contoh:

```java
while (parser.nextToken() != JsonToken.END_ARRAY) {
    ImportRow row = rowReader.readValue(parser);
    process(row);
}
```

Ini memberi keseimbangan:

- efficient untuk array besar,
- tetap maintainable untuk row object,
- tidak perlu manual parse semua field.

### 5.3 Pure streaming manual

Pure streaming manual seperti ini:

```java
String id = null;
BigDecimal amount = null;

while (parser.nextToken() != JsonToken.END_OBJECT) {
    String name = parser.currentName();
    parser.nextToken();

    switch (name) {
        case "id" -> id = parser.getValueAsString();
        case "amount" -> amount = parser.getDecimalValue();
        default -> parser.skipChildren();
    }
}

ImportRow row = new ImportRow(id, amount);
```

Gunakan hanya jika:

- format sangat sederhana,
- hot path sangat kritikal,
- butuh kontrol penuh,
- sudah diukur bahwa databind per item terlalu mahal,
- code complexity bisa diterima.

Pure streaming terlalu mudah menjadi sulit dirawat.

---

## 6. Allocation: Musuh Tersembunyi dalam Mapping Layer

Performance Java modern sering bukan hanya CPU, tetapi allocation.

Contoh endpoint:

```java
List<CaseResponse> response = cases.stream()
    .map(caseMapper::toResponse)
    .toList();

return objectMapper.writeValueAsString(response);
```

Allocation terjadi di:

- list result,
- setiap DTO response,
- nested DTO,
- string formatting,
- date formatting,
- temporary collection,
- serializer internal buffers,
- exception/path object jika error,
- custom mapper temporary object.

### 6.1 Allocation amplification

Misal satu `CaseEntity` menjadi:

```java
CaseResponse
 ├── ApplicantResponse
 ├── List<DocumentResponse>
 ├── List<ActionResponse>
 ├── List<CommentResponse>
 └── StatusResponse
```

Jika 1 case menghasilkan 30 object DTO, maka 1.000 case menghasilkan 30.000 object DTO, belum termasuk internal Jackson object dan string/collection.

Ini disebut **allocation amplification**.

### 6.2 Object graph explosion

Object graph explosion terjadi ketika response mengikutsertakan terlalu banyak nested relationship.

Contoh buruk:

```java
public class CaseResponse {
    private String caseId;
    private ApplicantResponse applicant;
    private List<DocumentResponse> documents;
    private List<WorkflowHistoryResponse> histories;
    private List<CommentResponse> comments;
    private List<AuditTrailResponse> auditTrails;
    private List<NotificationResponse> notifications;
    private List<PaymentResponse> payments;
}
```

Untuk listing page, ini terlalu besar.

Lebih baik:

```java
public record CaseListItemResponse(
    String caseId,
    String applicantName,
    String status,
    Instant submittedAt,
    boolean hasPendingAction
) {}
```

Untuk detail page baru gunakan response lebih kaya.

### 6.3 Rule penting

> Cara tercepat membuat JSON adalah tidak membuat field yang tidak dibutuhkan.

Sebelum micro-optimization, kurangi shape.

---

## 7. Reuse ObjectMapper, ObjectReader, ObjectWriter

Membuat `ObjectMapper` baru berulang-ulang adalah anti-pattern.

Buruk:

```java
public String serialize(Object value) throws JsonProcessingException {
    ObjectMapper mapper = new ObjectMapper();
    mapper.registerModule(new JavaTimeModule());
    return mapper.writeValueAsString(value);
}
```

Masalah:

- metadata/cache tidak optimal,
- konfigurasi berulang,
- module registration berulang,
- potensi konfigurasi tidak konsisten,
- overhead tinggi.

Lebih baik:

```java
public final class JsonCodec {

    private final ObjectMapper mapper;
    private final ObjectReader orderReader;
    private final ObjectWriter orderWriter;

    public JsonCodec(ObjectMapper mapper) {
        this.mapper = mapper;
        this.orderReader = mapper.readerFor(OrderRequest.class);
        this.orderWriter = mapper.writerFor(OrderResponse.class);
    }

    public OrderRequest readOrder(String json) throws JsonProcessingException {
        return orderReader.readValue(json);
    }

    public String writeOrder(OrderResponse response) throws JsonProcessingException {
        return orderWriter.writeValueAsString(response);
    }
}
```

### 7.1 Kenapa ObjectReader/ObjectWriter penting

`ObjectReader` dan `ObjectWriter` merepresentasikan konfigurasi baca/tulis yang lebih spesifik.

Keuntungan:

- immutable,
- reusable,
- type-specific,
- mengurangi repeated setup,
- lebih jelas untuk boundary tertentu,
- bisa memiliki pretty printer/filter/view tertentu tanpa mengubah mapper global.

Contoh:

```java
private static final ObjectWriter PUBLIC_CASE_WRITER = mapper
    .writerFor(CasePublicResponse.class);

private static final ObjectWriter INTERNAL_CASE_WRITER = mapper
    .writerFor(CaseInternalResponse.class);
```

Namun jangan over-engineer. Untuk endpoint biasa, framework seperti Spring sudah mengelola writer internalnya.

---

## 8. `writeValueAsString` vs Streaming to OutputStream

Sering ditemukan:

```java
String json = objectMapper.writeValueAsString(response);
return ResponseEntity.ok(json);
```

Untuk payload kecil ini tidak masalah. Untuk payload besar, ini berarti:

1. object response sudah ada di memory,
2. JSON string penuh dibuat di memory,
3. string dikonversi ke bytes untuk response.

Lebih baik untuk payload besar:

```java
objectMapper.writeValue(outputStream, response);
```

Atau dengan generator:

```java
try (JsonGenerator generator = objectMapper.getFactory().createGenerator(outputStream)) {
    generator.writeStartArray();

    for (CaseListItemResponse item : items) {
        objectMapper.writeValue(generator, item);
    }

    generator.writeEndArray();
}
```

### 8.1 Response streaming listing besar

Contoh:

```java
public void writeCases(OutputStream output, Iterator<CaseListItemResponse> cases) throws IOException {
    JsonFactory factory = objectMapper.getFactory();

    try (JsonGenerator generator = factory.createGenerator(output)) {
        generator.writeStartArray();

        while (cases.hasNext()) {
            objectMapper.writeValue(generator, cases.next());
        }

        generator.writeEndArray();
    }
}
```

Cocok untuk:

- export,
- report,
- large list,
- streaming download.

Tidak cocok untuk:

- response yang butuh pagination normal,
- API yang harus mengembalikan count/metadata setelah semua data diproses,
- response yang butuh transaction terbuka terlalu lama,
- endpoint dengan client timeout rendah.

---

## 9. Payload Besar: Jangan Full Materialize

Payload besar punya dua arah:

1. inbound besar: import/upload/message,
2. outbound besar: export/report/download.

### 9.1 Inbound besar

Anti-pattern:

```java
ImportRequest request = objectMapper.readValue(inputStream, ImportRequest.class);
service.process(request.rows());
```

Lebih baik:

```java
streamingReader.read(inputStream, row -> {
    validator.validate(row);
    buffer.add(row);

    if (buffer.size() == 500) {
        service.processBatch(buffer);
        buffer.clear();
    }
});
```

Pattern:

```text
read one row -> validate -> normalize -> batch persist -> release memory
```

### 9.2 Outbound besar

Anti-pattern:

```java
List<ReportRow> rows = reportService.findAllRows(filter);
return objectMapper.writeValueAsString(rows);
```

Lebih baik:

```text
DB cursor/page -> map row -> write JSON token -> flush periodically
```

Contoh konseptual:

```java
public void export(OutputStream output, ReportFilter filter) throws IOException {
    try (JsonGenerator g = objectMapper.getFactory().createGenerator(output)) {
        g.writeStartObject();
        g.writeStringField("reportType", filter.reportType());
        g.writeArrayFieldStart("rows");

        reportService.forEachRow(filter, row -> {
            try {
                objectMapper.writeValue(g, row);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        });

        g.writeEndArray();
        g.writeEndObject();
    }
}
```

### 9.3 Batching matters

Saat import, jangan persist row satu per satu jika database menjadi bottleneck.

Pipeline yang lebih baik:

```text
JSON streaming -> row DTO -> validate -> collect 500 rows -> batch insert/update
```

Tapi jangan juga batch terlalu besar.

Trade-off batch size:

| Batch size | Kelebihan | Risiko |
|---:|---|---|
| 1 | error isolation mudah | lambat, DB roundtrip tinggi |
| 100–1000 | balance umum | butuh memory sedang |
| 10.000+ | throughput bisa tinggi | memory besar, rollback mahal |

---

## 10. Hot Path: Bedakan Endpoint Biasa vs Endpoint Kritis

Tidak semua endpoint layak dioptimasi agresif.

Hot path biasanya memiliki:

- traffic tinggi,
- latency SLO ketat,
- payload besar,
- dipanggil dalam loop antar service,
- digunakan oleh UI listing utama,
- menjadi bottleneck batch/integration,
- masuk jalur login/auth/checkout/case assignment.

Endpoint biasa:

```text
Admin update category configuration 10x/hari
```

Tidak perlu streaming atau custom serializer ekstrem.

Endpoint hot path:

```text
Case listing 500 req/sec
Event ingestion 10.000 msg/sec
Bulk export 1 juta row
```

Butuh perhatian khusus.

### 10.1 Hot path checklist

Untuk hot path, tanya:

1. Berapa RPS?
2. Berapa P50/P95/P99 latency?
3. Berapa ukuran payload rata-rata dan maksimum?
4. Berapa object dialokasikan per request?
5. Berapa GC pause/frequency?
6. Apakah response shape terlalu besar?
7. Apakah serialization memicu lazy loading?
8. Apakah mapper membuat nested DTO tidak perlu?
9. Apakah custom serializer melakukan lookup/service call?
10. Apakah `ObjectMapper` dibuat ulang?
11. Apakah tree model digunakan tanpa alasan?
12. Apakah hasil bisa dipagination/streaming?

---

## 11. Response Shape Optimization: Optimasi Paling Bernilai

Contoh response terlalu besar:

```json
{
  "caseId": "C-001",
  "applicant": { ... },
  "documents": [ ... ],
  "histories": [ ... ],
  "auditTrails": [ ... ],
  "notifications": [ ... ],
  "payments": [ ... ],
  "internalFlags": { ... }
}
```

Jika UI listing hanya menampilkan:

- case id,
- applicant name,
- status,
- submitted date,
- pending action.

Maka response harus:

```json
{
  "caseId": "C-001",
  "applicantName": "Alice Tan",
  "status": "OPEN",
  "submittedAt": "2026-06-17T03:00:00Z",
  "hasPendingAction": true
}
```

### 11.1 Shape-first optimization

Urutan optimasi yang sehat:

```text
1. Kurangi field yang tidak perlu
2. Kurangi nesting
3. Gunakan projection DTO
4. Hindari lazy graph traversal
5. Reuse mapper/reader/writer
6. Gunakan streaming untuk payload besar
7. Baru pertimbangkan module performance/codegen
8. Baru pertimbangkan custom serializer ekstrem
```

Jangan mulai dari Afterburner/Blackbird jika response masih membawa 10x data yang tidak digunakan.

---

## 12. Lazy Loading dan Serialization Storm

Salah satu performance bug terbesar di enterprise Java adalah serialization yang memicu lazy loading.

Contoh buruk:

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable String id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Jika `CaseEntity` punya relationship lazy:

```java
@OneToMany(mappedBy = "case")
private List<DocumentEntity> documents;

@OneToMany(mappedBy = "case")
private List<AuditTrailEntity> auditTrails;
```

Jackson bisa mencoba membaca getter dan memicu database query.

Masalah:

- N+1 query,
- response membengkak,
- cycle serialization,
- lazy initialization error,
- data internal bocor,
- latency unpredictable.

### 12.1 Solusi yang benar

Gunakan DTO/projection:

```java
public record CaseDetailResponse(
    String caseId,
    String status,
    String applicantName,
    List<DocumentSummaryResponse> documents
) {}
```

Service mengontrol fetch:

```java
CaseEntity entity = caseRepository.findDetailById(caseId)
    .orElseThrow();

return caseMapper.toDetailResponse(entity);
```

Atau projection langsung:

```java
public record CaseListProjection(
    String caseId,
    String applicantName,
    String status,
    Instant submittedAt
) {}
```

### 12.2 Rule

> Jangan jadikan Jackson sebagai navigator object graph persistence.

Jackson harus menulis DTO yang sudah disiapkan, bukan mencari data lewat entity graph.

---

## 13. Date/Time Formatting Cost

Date/time formatting bisa menjadi hotspot jika dilakukan berulang di list besar.

Contoh:

```java
@JsonFormat(pattern = "dd/MM/yyyy HH:mm:ss", timezone = "Asia/Singapore")
private Instant submittedAt;
```

Untuk response kecil tidak masalah.

Untuk 1 juta row export, formatting date/time bisa signifikan.

### 13.1 Strategi

Opsi umum:

1. Gunakan ISO-8601 standar untuk API.
2. Hindari format lokal di backend kecuali kontrak mengharuskan.
3. Format display di frontend jika memungkinkan.
4. Untuk export, pertimbangkan precomputed string jika format wajib dan volume besar.
5. Reuse formatter jika custom serializer manual.

Custom serializer buruk:

```java
public void serialize(Instant value, JsonGenerator gen, SerializerProvider serializers)
        throws IOException {
    DateTimeFormatter formatter = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm:ss")
        .withZone(ZoneId.of("Asia/Singapore"));
    gen.writeString(formatter.format(value));
}
```

Masalah: formatter dibuat setiap field.

Lebih baik:

```java
public final class SingaporeInstantSerializer extends JsonSerializer<Instant> {

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter
        .ofPattern("dd/MM/yyyy HH:mm:ss")
        .withZone(ZoneId.of("Asia/Singapore"));

    @Override
    public void serialize(Instant value, JsonGenerator gen, SerializerProvider serializers)
            throws IOException {
        gen.writeString(FORMATTER.format(value));
    }
}
```

---

## 14. Enum Serialization Performance dan Compatibility

Enum serialization biasanya tidak mahal. Yang lebih penting adalah compatibility.

Contoh:

```java
public enum CaseStatus {
    OPEN,
    PENDING_REVIEW,
    CLOSED
}
```

Default output:

```json
"PENDING_REVIEW"
```

Jika consumer butuh label:

```json
{
  "code": "PENDING_REVIEW",
  "label": "Pending Review"
}
```

Jangan buat serializer yang melakukan lookup database per enum.

Buruk:

```java
public void serialize(CaseStatus value, JsonGenerator gen, SerializerProvider provider)
        throws IOException {
    String label = labelService.findLabel(value.name()); // bahaya
    gen.writeString(label);
}
```

Serializer harus deterministic dan cheap.

Lebih baik:

```java
public enum CaseStatus {
    OPEN("Open"),
    PENDING_REVIEW("Pending Review"),
    CLOSED("Closed");

    private final String label;

    CaseStatus(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}
```

DTO:

```java
public record StatusResponse(
    String code,
    String label
) {
    public static StatusResponse from(CaseStatus status) {
        return new StatusResponse(status.name(), status.label());
    }
}
```

---

## 15. Avoid Service Calls in Serializer/Deserializer

Custom serializer/deserializer sebaiknya tidak melakukan:

- database query,
- HTTP call,
- Redis call,
- remote lookup,
- permission check kompleks,
- business workflow transition,
- audit write,
- mutation external state.

Kenapa?

Karena serialization sering dianggap pure output operation. Jika serializer melakukan I/O:

- latency menjadi tersembunyi,
- error handling sulit,
- retry tidak jelas,
- N+1 remote call mudah terjadi,
- testing sulit,
- observability buruk,
- contract layer bercampur service layer.

Buruk:

```java
public class UserNameSerializer extends JsonSerializer<String> {
    private final UserService userService;

    @Override
    public void serialize(String userId, JsonGenerator gen, SerializerProvider serializers)
            throws IOException {
        gen.writeString(userService.getDisplayName(userId));
    }
}
```

Lebih baik enrichment dilakukan sebelum serialization:

```java
UserDisplayName name = userDirectory.resolve(userId);
CaseResponse response = mapper.toResponse(caseEntity, name);
```

Serializer tinggal menulis value.

---

## 16. `convertValue`: Praktis, Tapi Jangan Jadi Mapper Hot Path

Jackson punya:

```java
Target target = objectMapper.convertValue(source, Target.class);
```

Ini berguna untuk:

- dynamic object conversion,
- test helper,
- adapter sementara,
- map-to-object conversion,
- migration bridge.

Namun jangan menjadikan `convertValue` sebagai mapper utama untuk domain/DTO hot path.

Masalah:

- mapping implicit,
- contract tersembunyi,
- error compile-time minim,
- performance tidak sebaik manual/MapStruct untuk mapping object-to-object,
- refactor field bisa silent break,
- policy mapping sulit terlihat.

Buruk:

```java
CaseResponse response = objectMapper.convertValue(caseEntity, CaseResponse.class);
```

Lebih baik:

```java
CaseResponse response = caseMapper.toResponse(caseEntity);
```

Gunakan Jackson untuk JSON boundary, bukan sebagai general-purpose domain mapper kecuali memang alasan kuat.

---

## 17. `JsonNode` sebagai Intermediate Format: Hati-hati Double Work

Kadang pipeline seperti ini muncul:

```java
JsonNode node = objectMapper.valueToTree(entity);
node = transform(node);
ResponseDto response = objectMapper.treeToValue(node, ResponseDto.class);
String json = objectMapper.writeValueAsString(response);
```

Ini bisa menjadi sangat mahal:

```text
entity -> JsonNode -> transformed JsonNode -> DTO -> JSON string
```

Pertanyaan desain:

- Kenapa tidak langsung map entity ke DTO?
- Apakah transformasi memang schema-less?
- Apakah perlu preserve unknown fields?
- Apakah ini adapter sementara?
- Apakah ada golden test?

JsonNode boleh, tapi jangan menjadi default mapping engine.

---

## 18. Collection Mapping dan Pre-sizing

Saat manual mapping list besar:

Buruk:

```java
List<CaseResponse> result = new ArrayList<>();
for (CaseEntity entity : entities) {
    result.add(toResponse(entity));
}
```

Lebih baik jika size diketahui:

```java
List<CaseResponse> result = new ArrayList<>(entities.size());
for (CaseEntity entity : entities) {
    result.add(toResponse(entity));
}
```

Untuk list kecil tidak signifikan. Untuk hot path besar, ini mengurangi resize internal array.

Namun jangan overdo di semua tempat. Gunakan pada batch/list besar.

### 18.1 Stream API vs loop

```java
List<CaseResponse> result = entities.stream()
    .map(this::toResponse)
    .toList();
```

Readable, tetapi untuk hot path sangat besar, loop explicit kadang lebih mudah dioptimasi dan diobservasi.

Loop juga memungkinkan:

- pre-sizing,
- error per item,
- metrics,
- partial processing,
- controlled batching.

---

## 19. Compression: Bukan Solusi Universal

JSON besar sering dikompresi dengan gzip/br.

Compression membantu:

- network bandwidth,
- response transfer time,
- large repetitive JSON.

Tetapi compression menambah:

- CPU cost,
- latency CPU-bound,
- complexity caching,
- risk double compression.

Compression tidak mengurangi object allocation sebelum serialization. Jika masalahnya server memory karena object graph besar, compression tidak menyelesaikan akar masalah.

Urutan berpikir:

```text
1. Apakah payload perlu sebesar itu?
2. Apakah bisa pagination/projection?
3. Apakah bisa stream?
4. Apakah network transfer bottleneck?
5. Baru compression tuning.
```

---

## 20. Pagination, Cursor, dan Partial Response

Kadang solusi terbaik bukan optimasi Jackson, tetapi kontrak API.

### 20.1 Pagination

Daripada:

```http
GET /cases
```

mengembalikan 100.000 item.

Lebih baik:

```http
GET /cases?page=0&size=50
```

atau cursor:

```http
GET /cases?cursor=eyJpZCI6IkMtMTAwIn0=&limit=50
```

### 20.2 Partial response

Jika consumer tidak selalu butuh field besar:

```http
GET /cases/{id}?include=documents,actions
```

Hati-hati: partial response bisa membuat API kompleks. Untuk internal API tertentu bisa berguna, tetapi public API sering lebih baik punya endpoint/DTO spesifik.

### 20.3 Separate endpoint by use case

Lebih jelas:

```http
GET /cases
GET /cases/{id}
GET /cases/{id}/audit-trails
GET /cases/{id}/documents
```

Ini mengontrol shape dan performance lebih baik.

---

## 21. Jackson Modules for Performance: Afterburner dan Blackbird

Jackson ekosistem memiliki module untuk mempercepat data binding dengan mengurangi overhead akses property.

Secara umum:

- **Afterburner** historis digunakan untuk mempercepat databind lewat generated bytecode.
- **Blackbird** ditujukan untuk Java modern dengan pendekatan yang lebih cocok untuk runtime Java 11+.

Namun gunakan dengan disiplin.

### 21.1 Kapan layak dipertimbangkan

Pertimbangkan module performance jika:

- JSON databind terbukti bottleneck,
- endpoint high-throughput,
- sudah ada benchmark,
- response shape sudah optimal,
- mapper sudah direuse,
- tidak ada lazy loading storm,
- tidak ada custom serializer lambat,
- environment kompatibel.

### 21.2 Kapan tidak perlu

Tidak perlu jika:

- traffic rendah,
- bottleneck di database/network,
- payload kecil,
- bottleneck karena response terlalu gemuk,
- belum ada measurement,
- aplikasi sedang migrasi runtime/library besar.

### 21.3 Testing wajib

Jika menambahkan module performance:

- jalankan serialization/deserialization regression test,
- test records/builders/Lombok DTO,
- test Java version target,
- test native image jika digunakan,
- test custom serializer/deserializer,
- benchmark before/after.

Jangan menganggap module performance selalu net-positive.

---

## 22. Java 8 sampai Java 25: Performance Considerations

Seri ini mencakup Java 8 hingga Java 25. Beberapa perubahan platform memengaruhi mapping performance dan desain DTO.

### 22.1 Java 8

Karakteristik umum:

- JavaBean mutable DTO umum,
- Lombok banyak dipakai,
- `Optional` mulai muncul,
- `java.time` tersedia,
- records belum ada,
- module system belum ada,
- reflection access lebih longgar dibanding Java modern.

Mapping style umum:

```java
public class CaseResponse {
    private String caseId;
    private String status;

    public String getCaseId() { return caseId; }
    public void setCaseId(String caseId) { this.caseId = caseId; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}
```

### 22.2 Java 11/17/21

Karakteristik:

- Java 11 LTS banyak menjadi baseline enterprise modern,
- Java 17 LTS membawa sealed class preview/final lineage dan platform modern,
- Java 21 LTS membawa virtual threads, records sudah matang, pattern matching lebih kuat.

DTO bisa mulai memakai record:

```java
public record CaseResponse(
    String caseId,
    String status
) {}
```

Performance implication:

- DTO immutable lebih predictable,
- object tetap dialokasikan,
- constructor binding lebih jelas,
- reflection/module access perlu diperhatikan,
- framework/library version harus kompatibel.

### 22.3 Java 25

Java 25 sebagai generasi modern/LTS membuat desain DTO modern makin relevan:

- records sebagai pilihan kuat untuk DTO,
- sealed hierarchy untuk polymorphic model,
- pattern matching lebih nyaman,
- library harus diuji terhadap JDK baru,
- annotation processor seperti Lombok/MapStruct harus kompatibel.

Untuk performance, Java version tidak otomatis menyelesaikan object graph buruk. Java modern membantu runtime, tetapi desain shape tetap dominan.

---

## 23. Benchmarking: Jangan Percaya Feeling

Performance tuning tanpa measurement adalah spekulasi.

### 23.1 Ukur level yang benar

Ada beberapa level measurement:

| Level | Tujuan |
|---|---|
| Unit microbenchmark | biaya serialize/deserialize object tertentu |
| Component benchmark | biaya mapper + validation + transform |
| Endpoint benchmark | latency request/response actual |
| Load test | behavior di concurrency dan traffic realistis |
| Production telemetry | bukti real bottleneck |

Jangan hanya microbenchmark Jackson jika bottleneck endpoint ada di database.

### 23.2 Metrics yang perlu dilihat

Untuk endpoint JSON:

- request payload size,
- response payload size,
- serialization time,
- deserialization time,
- total request latency,
- P50/P95/P99,
- allocation rate,
- GC count/time,
- CPU utilization,
- DB query count,
- downstream call count,
- error rate,
- timeout rate.

### 23.3 JMH untuk microbenchmark

JMH cocok untuk membandingkan:

- `writeValueAsString` vs `writeValue(OutputStream)`,
- databind vs streaming,
- manual mapper vs MapStruct,
- custom serializer before/after,
- ObjectWriter reuse vs non-reuse.

Contoh skeleton:

```java
@State(Scope.Benchmark)
public class JacksonSerializationBenchmark {

    private ObjectMapper mapper;
    private ObjectWriter writer;
    private CaseResponse response;

    @Setup
    public void setup() {
        mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        writer = mapper.writerFor(CaseResponse.class);
        response = TestData.caseResponse();
    }

    @Benchmark
    public String writeWithMapper() throws Exception {
        return mapper.writeValueAsString(response);
    }

    @Benchmark
    public String writeWithWriter() throws Exception {
        return writer.writeValueAsString(response);
    }
}
```

### 23.4 JMH pitfalls

Hindari:

- benchmark tanpa warmup,
- benchmark yang hasilnya dioptimasi hilang oleh JVM,
- payload tidak realistis,
- hanya mengukur happy path kecil,
- tidak mengukur allocation,
- membandingkan code dengan konfigurasi berbeda,
- mengabaikan GC,
- menyimpulkan endpoint performance dari microbenchmark kecil.

---

## 24. Profiling: Cari Bukti

Tool yang relevan:

- Java Flight Recorder,
- async-profiler,
- YourKit/JProfiler,
- VisualVM untuk baseline sederhana,
- GC logs,
- Micrometer metrics,
- OpenTelemetry traces,
- allocation profiling.

Cari method seperti:

- Jackson serializer/deserializer hot methods,
- custom serializer code,
- date formatter creation,
- reflection/accessor path,
- `ArrayList.grow`,
- `StringBuilder`/buffer churn,
- database calls saat serialization,
- lazy proxy initialization,
- `ObjectMapper` construction.

### 24.1 Profiling question

Saat melihat flame graph, tanyakan:

- Apakah Jackson benar-benar besar persentasenya?
- Apakah custom code di serializer yang mahal?
- Apakah Jackson memicu getter yang melakukan kerja berat?
- Apakah property terlalu banyak?
- Apakah nested graph terlalu dalam?
- Apakah allocation lebih bermasalah daripada CPU?

---

## 25. Error Handling untuk Streaming Pipeline

Streaming payload besar membuat error handling lebih kompleks.

Contoh import 100.000 row. Row ke-50.321 invalid.

Pilihan:

1. fail fast seluruh import,
2. collect error dan lanjut,
3. batch-level rollback,
4. row-level quarantine,
5. dead-letter file/message.

### 25.1 Fail fast

Cocok jika:

- payload harus atomic,
- error sedikit pun membatalkan semua,
- ukuran tidak terlalu besar,
- consumer bisa retry setelah fix.

### 25.2 Continue with errors

Cocok jika:

- import bulk user-facing,
- sebagian row boleh sukses,
- perlu report error per row,
- business mengizinkan partial success.

Contoh result:

```java
public record ImportResult(
    int totalRows,
    int successRows,
    int failedRows,
    List<RowError> errors
) {}

public record RowError(
    long rowNumber,
    String field,
    String code,
    String message
) {}
```

### 25.3 Jangan simpan semua error tanpa batas

Jika file sangat besar dan semua row invalid, list error bisa meledak.

Batasi:

```java
private static final int MAX_ERRORS = 1000;
```

Jika lebih:

```text
Too many errors; stopped after 1000 errors.
```

---

## 26. Memory-Safe Import Pattern

Pattern production-grade:

```text
InputStream
 -> JsonParser
 -> row reader
 -> row validator
 -> row normalizer
 -> bounded error collector
 -> batch buffer
 -> batch processor
 -> result summary
```

Contoh skeleton:

```java
public ImportResult importCases(InputStream input) throws IOException {
    ImportAccumulator acc = new ImportAccumulator(1000);
    List<CaseImportRow> batch = new ArrayList<>(500);

    streamingReader.read(input, rowContext -> {
        acc.incrementTotal();

        try {
            CaseImportRow row = rowContext.row();
            validator.validate(row);
            CaseImportCommand command = normalizer.normalize(row);
            batch.add(command);

            if (batch.size() == 500) {
                service.processBatch(batch);
                acc.addSuccess(batch.size());
                batch.clear();
            }
        } catch (ValidationException e) {
            acc.addError(rowContext.rowNumber(), e);
        }
    });

    if (!batch.isEmpty()) {
        service.processBatch(batch);
        acc.addSuccess(batch.size());
        batch.clear();
    }

    return acc.toResult();
}
```

Hal penting:

- batch buffer bounded,
- error collector bounded,
- tidak menyimpan semua row,
- row number dipertahankan,
- validation error dipisahkan dari parse error,
- transaction boundary jelas.

---

## 27. Memory-Safe Export Pattern

Pattern:

```text
OutputStream
 <- JsonGenerator
 <- DTO row writer
 <- page/cursor from repository
 <- projection query
```

Contoh:

```java
public void exportCases(OutputStream output, CaseExportFilter filter) throws IOException {
    try (JsonGenerator g = objectMapper.getFactory().createGenerator(output)) {
        g.writeStartObject();
        g.writeStringField("type", "CASE_EXPORT");
        g.writeStringField("generatedAt", Instant.now().toString());
        g.writeArrayFieldStart("rows");

        String cursor = null;
        do {
            PageResult<CaseExportRow> page = repository.findExportRows(filter, cursor, 1000);

            for (CaseExportRow row : page.items()) {
                objectMapper.writeValue(g, row);
            }

            cursor = page.nextCursor();
            g.flush();
        } while (cursor != null);

        g.writeEndArray();
        g.writeEndObject();
    }
}
```

Caution:

- jangan tahan transaction terlalu lama tanpa alasan,
- jangan stream dari JPA lazy entity graph,
- gunakan projection row,
- handle client disconnect,
- set timeout sesuai export,
- pertimbangkan async export ke file/object storage untuk data sangat besar.

---

## 28. Async Export vs Synchronous Streaming

Untuk export besar, synchronous response mungkin bukan desain terbaik.

### 28.1 Synchronous streaming cocok jika

- ukuran cukup besar tapi masih wajar,
- user menunggu download,
- proses selesai dalam batas timeout,
- infra mendukung streaming response,
- retry tidak terlalu kompleks.

### 28.2 Async export cocok jika

- jutaan row,
- proses menit/jam,
- perlu audit/export history,
- perlu resume/retry,
- perlu file hasil di object storage,
- perlu notifikasi user,
- timeout gateway tidak cukup.

Flow:

```text
POST /exports
 -> create export job
 -> worker generate JSON/CSV to storage
 -> update status
 -> user download when ready
```

Jackson tetap dipakai, tetapi di worker pipeline, bukan request thread.

---

## 29. Binary Formats: Kapan JSON Tidak Cukup

Untuk internal high-throughput system, JSON mungkin bukan format terbaik.

Alternatif:

- Smile,
- CBOR,
- Avro,
- Protobuf,
- MessagePack.

Namun jangan migrasi format hanya karena “lebih cepat”. Pertimbangkan:

- debugging,
- schema evolution,
- language interoperability,
- tool support,
- backward compatibility,
- operational visibility,
- client support,
- governance.

JSON sering cukup jika shape benar dan pipeline tidak boros.

---

## 30. Observability untuk Mapping Layer

Mapping performance harus terlihat.

Metrics yang bisa ditambahkan:

```text
json.deserialize.duration
json.serialize.duration
json.payload.request.bytes
json.payload.response.bytes
json.import.rows.total
json.import.rows.failed
json.export.rows.total
json.mapping.errors
```

Untuk endpoint biasa, framework metrics mungkin cukup. Untuk import/export besar, custom metrics sangat berguna.

### 30.1 Logging payload hati-hati

Jangan log full payload besar/sensitif.

Buruk:

```java
log.error("Failed to parse payload: {}", json, e);
```

Lebih baik:

```java
log.error("Failed to parse import payload. correlationId={}, row={}, field={}, errorCode={}",
    correlationId,
    rowNumber,
    field,
    errorCode,
    e
);
```

Untuk debugging, simpan sanitized sample atau hash payload jika perlu.

---

## 31. Common Anti-Patterns

### 31.1 New ObjectMapper per request

```java
new ObjectMapper().writeValueAsString(value);
```

Masalah: konfigurasi, cache, overhead, inconsistency.

---

### 31.2 Entity langsung ke response

```java
return caseRepository.findAll();
```

Masalah: lazy loading, data leakage, cycles, huge graph.

---

### 31.3 Tree model untuk semua payload

```java
JsonNode root = mapper.readTree(json);
```

Masalah: object node overhead, double conversion.

---

### 31.4 `convertValue` sebagai mapper domain utama

```java
mapper.convertValue(entity, Response.class);
```

Masalah: implicit mapping, weak compile-time safety.

---

### 31.5 Custom serializer melakukan DB/service call

Masalah: hidden I/O, N+1, unpredictable latency.

---

### 31.6 Full list before export

```java
List<Row> rows = repository.findAll();
mapper.writeValue(output, rows);
```

Masalah: memory explosion.

---

### 31.7 Mengoptimasi library sebelum kontrak

Menambahkan performance module saat response masih membawa data 10x tidak perlu adalah optimasi di tempat yang salah.

---

## 32. Decision Framework

Gunakan framework berikut.

### 32.1 Payload kecil/sedang, API biasa

Gunakan:

- DTO,
- databind,
- reusable ObjectMapper managed by framework,
- clear annotation/config,
- normal unit/contract tests.

Tidak perlu:

- streaming manual,
- custom serializer ekstrem,
- performance module tanpa measurement.

---

### 32.2 Payload besar inbound

Gunakan:

- streaming parser,
- hybrid row databind,
- bounded batch,
- bounded error collector,
- row-level diagnostics,
- no full materialization.

---

### 32.3 Payload besar outbound

Gunakan:

- projection query,
- pagination/cursor,
- JsonGenerator,
- write to OutputStream,
- async export jika sangat besar.

---

### 32.4 Hot path high-throughput

Gunakan:

- thin DTO,
- measured ObjectReader/Writer reuse,
- avoid tree model,
- avoid custom heavy serializer,
- allocation profiling,
- possible performance module after benchmark.

---

### 32.5 Complex dynamic payload

Gunakan:

- JsonNode untuk routing/partial flexible structure,
- schema/contract tests,
- convert to typed DTO secepat mungkin,
- hindari JsonNode menyebar ke domain.

---

## 33. Production Checklist

### 33.1 ObjectMapper

- [ ] Tidak membuat `ObjectMapper` baru per request.
- [ ] Mapper dikonfigurasi sebelum digunakan.
- [ ] Ada profile mapper jika boundary butuh strict/lenient berbeda.
- [ ] `ObjectReader`/`ObjectWriter` digunakan untuk hot path jika relevan.
- [ ] Module registration tidak random lewat `findAndRegisterModules()` tanpa governance pada sistem kritis.

### 33.2 Payload

- [ ] Response shape sesuai use case.
- [ ] Listing DTO tidak membawa detail nested besar.
- [ ] Import/export besar tidak full materialized.
- [ ] Ada max payload size.
- [ ] Ada pagination/cursor untuk list besar.

### 33.3 Serialization

- [ ] Tidak serialize JPA entity langsung.
- [ ] Tidak ada lazy loading tidak disengaja.
- [ ] Tidak ada sensitive field leakage.
- [ ] Custom serializer pure dan cheap.
- [ ] Date/time formatting tidak membuat formatter berulang.

### 33.4 Deserialization

- [ ] Unknown/null/missing/coercion policy jelas.
- [ ] Payload besar diproses streaming/batch.
- [ ] Error path jelas.
- [ ] Error collector bounded.

### 33.5 Measurement

- [ ] Ada benchmark/measurement sebelum optimasi besar.
- [ ] P95/P99 endpoint dipantau.
- [ ] Payload size dipantau.
- [ ] Allocation/GC dipantau untuk hot path.
- [ ] DB query count dicek untuk endpoint serialization-heavy.

---

## 34. Case Study: Case Management Listing Endpoint

### 34.1 Masalah awal

Endpoint:

```http
GET /cases
```

Mengembalikan:

```java
List<CaseEntity>
```

Entity punya:

- applicant,
- documents,
- histories,
- audit trails,
- comments,
- payment records.

Gejala:

- response lambat,
- DB query banyak,
- payload besar,
- UI hanya memakai 6 field,
- kadang `LazyInitializationException`,
- CPU dan GC naik saat traffic listing.

### 34.2 Diagnosis

Root cause bukan Jackson “lambat”. Root cause:

- response shape salah,
- entity exposure,
- lazy loading storm,
- object graph terlalu besar,
- DTO tidak spesifik use case.

### 34.3 Desain ulang

DTO listing:

```java
public record CaseListItemResponse(
    String caseId,
    String applicantName,
    String status,
    Instant submittedAt,
    String assignedOfficerName,
    boolean pendingAction
) {}
```

Repository projection:

```java
public interface CaseListProjection {
    String getCaseId();
    String getApplicantName();
    String getStatus();
    Instant getSubmittedAt();
    String getAssignedOfficerName();
    boolean isPendingAction();
}
```

Mapper:

```java
public CaseListItemResponse toResponse(CaseListProjection p) {
    return new CaseListItemResponse(
        p.getCaseId(),
        p.getApplicantName(),
        p.getStatus(),
        p.getSubmittedAt(),
        p.getAssignedOfficerName(),
        p.isPendingAction()
    );
}
```

Endpoint:

```java
@GetMapping("/cases")
public Page<CaseListItemResponse> list(CaseFilter filter, Pageable pageable) {
    return caseService.list(filter, pageable);
}
```

### 34.4 Dampak

- query lebih terkendali,
- payload kecil,
- object allocation turun,
- Jackson serialization lebih murah,
- security lebih baik,
- contract lebih jelas.

Pelajaran:

> Optimasi Jackson terbaik sering dimulai dari DTO dan query design.

---

## 35. Case Study: Bulk Import JSON

### 35.1 Masalah awal

Payload:

```json
{
  "source": "LEGACY_SYSTEM",
  "rows": [
    { "caseNo": "A-1", "amount": "100.00" },
    { "caseNo": "A-2", "amount": "200.00" }
  ]
}
```

Kode awal:

```java
ImportRequest request = objectMapper.readValue(inputStream, ImportRequest.class);
for (ImportRow row : request.rows()) {
    process(row);
}
```

Masalah:

- file besar membuat memory naik,
- error row tidak jelas,
- gagal di tengah membuang semua progress,
- retry mahal,
- latency tinggi sebelum row pertama diproses.

### 35.2 Desain ulang

```text
InputStream
 -> JsonParser
 -> read metadata
 -> stream rows one by one
 -> validate row
 -> normalize row
 -> batch process 500 rows
 -> collect max 1000 errors
 -> return summary
```

### 35.3 Error result

```json
{
  "totalRows": 100000,
  "successRows": 99500,
  "failedRows": 500,
  "errors": [
    {
      "rowNumber": 120,
      "field": "amount",
      "code": "INVALID_DECIMAL",
      "message": "amount must be valid decimal"
    }
  ]
}
```

### 35.4 Pelajaran

Jackson streaming bukan sekadar performance optimization. Ia juga mengubah operational behavior:

- partial progress,
- row diagnostics,
- bounded memory,
- better retry strategy,
- better import UX.

---

## 36. Latihan Praktis

### Latihan 1 — Diagnose endpoint lambat

Diberikan endpoint:

```java
@GetMapping("/applications")
public List<ApplicationEntity> list() {
    return applicationRepository.findAll();
}
```

Entity punya 12 relationship lazy. UI hanya menampilkan 5 kolom.

Tugas:

1. Jelaskan kenapa ini bukan sekadar masalah Jackson.
2. Desain DTO listing.
3. Desain repository projection.
4. Jelaskan dampak terhadap allocation dan query count.
5. Jelaskan test yang perlu dibuat.

---

### Latihan 2 — Streaming import

Diberikan JSON 500 MB:

```json
{
  "batchId": "B-001",
  "rows": [ ... ]
}
```

Tugas:

1. Desain reader streaming.
2. Tentukan batch size.
3. Tentukan error policy.
4. Tentukan max error count.
5. Jelaskan transaction boundary.
6. Jelaskan metrics yang dicatat.

---

### Latihan 3 — Custom serializer hot path

Diberikan serializer:

```java
public void serialize(String userId, JsonGenerator gen, SerializerProvider provider)
        throws IOException {
    User user = userService.findById(userId);
    gen.writeString(user.displayName());
}
```

Tugas:

1. Jelaskan performance dan architecture problem.
2. Refactor agar enrichment terjadi sebelum serialization.
3. Jelaskan cara testing.
4. Jelaskan cara observability.

---

## 37. Ringkasan

Jackson performance bukan dimulai dari trik kecil. Urutan berpikir yang benar:

```text
1. Benarkan contract shape.
2. Jangan expose entity graph.
3. Hindari field/nesting tidak perlu.
4. Reuse ObjectMapper/ObjectReader/ObjectWriter.
5. Hindari JsonNode/convertValue sebagai default mapper.
6. Gunakan streaming untuk payload besar.
7. Batch import/export secara bounded.
8. Jangan lakukan I/O di serializer/deserializer.
9. Measure dengan benchmark/profiling/telemetry.
10. Baru pertimbangkan module performance.
```

Performance adalah konsekuensi desain boundary.

Top engineer tidak hanya tahu API Jackson. Ia tahu kapan:

- databind cukup,
- tree model berguna,
- streaming wajib,
- DTO harus diperkecil,
- endpoint harus dipagination,
- export harus async,
- mapper harus manual/generated,
- custom serializer harus dihindari,
- optimasi harus dibuktikan dengan measurement.

---

## 38. Referensi

- FasterXML Jackson Docs — Jackson Streaming API.
- FasterXML Jackson Docs — Jackson Performance presentation.
- FasterXML Jackson Databind Wiki — `ObjectReader` / `ObjectWriter` and configuration notes.
- FasterXML Jackson Core repository — streaming parser/generator abstractions.
- FasterXML Jackson portal — Afterburner module notes.
- Jackson Blackbird repository — Java 11+ databind acceleration notes.
- JMH — Java Microbenchmark Harness.
- Java Flight Recorder / JDK Mission Control documentation.

---

## 39. Status Seri

Part 14 selesai.

Progress seri:

```text
[■■■■■■■■■■■■■■□□□□□□□□□□□□□□□]
14/35 selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 15 — JSON Schema, OpenAPI, and Runtime Contract Alignment
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 13 — Jackson Security: Over-Posting, Polymorphic Attacks, Data Exposure](./13-jackson-security-overposting-polymorphic-attacks-data-exposure.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 15 — JSON Schema, OpenAPI, and Runtime Contract Alignment](./15-json-schema-openapi-runtime-contract-alignment.md)

</div>