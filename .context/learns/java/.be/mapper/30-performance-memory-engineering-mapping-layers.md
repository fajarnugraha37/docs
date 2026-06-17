# Part 30 — Performance and Memory Engineering for Mapping Layers

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `30-performance-memory-engineering-mapping-layers.md`  
> Status: Part 30 dari 35  
> Target: Java 8 sampai Java 25  
> Fokus: allocation, object graph, reflection vs generated mapper, Jackson databind vs streaming, MapStruct, collection sizing, batch mapping, pagination, lazy loading, JPA proxy, benchmark, dan production performance review.

---

## 1. Premis Utama

Mapping layer sering terlihat sebagai kode sederhana:

```java
UserResponse response = mapper.toResponse(user);
```

Namun di production, baris seperti ini dapat memicu:

- alokasi ribuan object,
- traversal graph yang tidak terbatas,
- query database tambahan karena lazy loading,
- serialisasi object internal yang terlalu besar,
- copy collection berulang,
- CPU tinggi karena reflection/introspection,
- GC pressure,
- latency tail yang buruk,
- payload network membengkak,
- memory spike saat batch export/import,
- dan benchmark palsu yang membuat optimasi salah arah.

Mental model senior engineer: **mapping bukan operasi gratis**. Mapping adalah operasi runtime yang mengubah bentuk data, dan setiap perubahan bentuk punya biaya: CPU, memory, allocation, cache locality, I/O, database access, serialization cost, dan observability cost.

Top 1% engineer tidak hanya bertanya:

> “Mapper ini benar tidak?”

Tetapi juga:

> “Mapper ini benar, aman, stabil, predictable, dan scalable tidak ketika payload 10x lebih besar, request 100x lebih banyak, dan object graph berubah karena fitur baru?”

---

## 2. Performance Model untuk Mapping Layer

Untuk memahami performance mapping, pecah biaya menjadi beberapa kategori.

```text
Mapping Cost
├── CPU cost
│   ├── field access
│   ├── type conversion
│   ├── reflection / method handle / generated call
│   ├── formatting date/time/number
│   ├── enum/string lookup
│   └── conditional logic
│
├── Memory cost
│   ├── target object allocation
│   ├── nested object allocation
│   ├── collection allocation
│   ├── intermediate string allocation
│   ├── JsonNode/tree allocation
│   └── buffer allocation
│
├── Graph traversal cost
│   ├── depth
│   ├── breadth
│   ├── cycles
│   ├── duplicate references
│   └── lazy association access
│
├── Serialization cost
│   ├── property discovery
│   ├── serializer lookup/cache
│   ├── escaping
│   ├── output encoding
│   ├── compression interaction
│   └── payload size
│
├── I/O side effect cost
│   ├── JPA lazy loading
│   ├── remote enrichment
│   ├── cache lookup
│   └── reference data lookup
│
└── Observability cost
    ├── logging payload
    ├── stack trace size
    ├── error path construction
    └── metrics cardinality
```

Kunci desain: jangan menganggap semua biaya berada di “mapper”. Mapping dapat memicu biaya di layer lain.

Contoh:

```java
public UserResponse toResponse(User user) {
    return new UserResponse(
        user.getId(),
        user.getName(),
        user.getRoles().stream().map(Role::getName).toList()
    );
}
```

Secara kode, ini mapping biasa. Tetapi jika `roles` adalah lazy association JPA, maka mapping dapat memicu query database.

Jadi performance mapping tidak bisa dianalisis hanya dari kode mapper. Ia harus dianalisis bersama:

- source object shape,
- persistence fetch plan,
- target DTO shape,
- serializer behavior,
- request volume,
- payload size,
- concurrency,
- dan SLA endpoint.

---

## 3. Allocation: Musuh yang Sering Tidak Terlihat

Di Java modern, alokasi object kecil memang relatif cepat. Tetapi “cepat” bukan berarti gratis. Mapping layer sering menghasilkan **allocation amplification**.

Misalnya satu entity:

```java
class CaseEntity {
    Long id;
    String referenceNo;
    Applicant applicant;
    List<Document> documents;
    List<CaseAction> actions;
}
```

Response DTO:

```java
record CaseDetailResponse(
    Long id,
    String referenceNo,
    ApplicantResponse applicant,
    List<DocumentResponse> documents,
    List<ActionResponse> actions
) {}
```

Untuk satu case, mapping dapat membuat:

- 1 `CaseDetailResponse`,
- 1 `ApplicantResponse`,
- N `DocumentResponse`,
- M `ActionResponse`,
- beberapa `ArrayList`,
- hasil conversion enum/string,
- hasil formatting date/time,
- string tambahan untuk label, status display, masked value,
- dan object intermediate jika memakai stream/lambda tertentu.

Untuk 1 request detail, ini mungkin kecil. Untuk export 50.000 rows, ini bisa menjadi masalah besar.

### 3.1 Allocation Amplification Formula

Gunakan formula kasar:

```text
Target allocations per request
≈ root DTO
+ nested DTO count
+ collection count
+ copied collection elements
+ conversion temporary objects
+ serialization buffers
+ logging/error temporary objects
```

Jika response list:

```text
Total allocations
≈ pageSize × allocationsPerRow
```

Jika nested:

```text
Total allocations
≈ rootCount
  + rootCount × childAverage
  + rootCount × childAverage × grandChildAverage
```

Ini disebut object graph explosion.

---

## 4. Object Graph Explosion

Object graph explosion terjadi ketika target shape terlalu kaya untuk use case.

Contoh buruk:

```java
record CaseListItemResponse(
    Long id,
    String referenceNo,
    ApplicantResponse applicant,
    List<DocumentResponse> documents,
    List<ActionResponse> actions,
    List<CommentResponse> comments,
    List<AuditResponse> audits
) {}
```

Untuk list page, user biasanya hanya butuh:

```java
record CaseListItemResponse(
    Long id,
    String referenceNo,
    String applicantName,
    String status,
    Instant submittedAt
) {}
```

Masalahnya bukan MapStruct atau Jackson. Masalahnya adalah **DTO shape salah untuk use case**.

Prinsip:

> Performance mapping terbaik sering datang dari target model yang tepat, bukan mapper yang lebih cepat.

### 4.1 Detail DTO Tidak Boleh Dipakai untuk List DTO

Anti-pattern:

```java
List<CaseDetailResponse> list = cases.stream()
    .map(caseMapper::toDetailResponse)
    .toList();
```

Masalah:

- terlalu banyak field,
- nested graph terlalu dalam,
- lazy loading mudah terpicu,
- payload besar,
- serialization cost tinggi,
- pagination tidak efektif.

Lebih baik:

```java
List<CaseListItemResponse> list = cases.stream()
    .map(caseMapper::toListItemResponse)
    .toList();
```

Atau lebih baik lagi untuk query-heavy endpoint:

```java
interface CaseListProjection {
    Long getId();
    String getReferenceNo();
    String getApplicantName();
    String getStatus();
    Instant getSubmittedAt();
}
```

Lalu mapping projection ke DTO tipis.

---

## 5. Reflection vs Generated Code vs Manual Mapping

Secara umum, ada beberapa pendekatan mapping:

```text
Manual Mapper
├── explicit Java code
├── maximum control
├── low runtime magic
└── maintenance cost tinggi jika banyak mapping

Generated Mapper / MapStruct
├── compile-time generated code
├── plain method invocation
├── type-safe
├── easy to inspect
└── excellent baseline for enterprise mapping

Reflection-Based Mapper
├── runtime introspection
├── convention-heavy
├── fast initial development
├── hidden runtime cost
└── less explicit failure mode

Serialization-Based Mapper
├── object -> JSON -> object
├── convenient but expensive
├── loses type/semantic nuance
└── dangerous for internal mapping if overused
```

MapStruct secara resmi menghasilkan implementasi mapper pada compile time dan menggunakan plain Java method invocations, bukan reflection runtime. Ini membuat generated mapper mudah dipahami, mudah di-debug, dan memiliki overhead runtime rendah dibanding mapper berbasis reflection. 

### 5.1 Manual Mapper

Manual mapper cocok ketika:

- mapping kecil,
- mapping sangat semantic,
- performance hot path,
- butuh kontrol penuh,
- tidak ingin annotation processor,
- target object immutable dengan aturan khusus,
- mapping harus sangat mudah diaudit.

Contoh:

```java
final class CaseResponseMapper {

    CaseListItemResponse toListItem(CaseListProjection source) {
        return new CaseListItemResponse(
            source.id(),
            source.referenceNo(),
            source.applicantName(),
            StatusFormatter.toDisplay(source.status()),
            source.submittedAt()
        );
    }
}
```

Kelebihan:

- tidak ada magic,
- jelas field mana dipakai,
- mudah dioptimasi,
- mudah dibaca saat review.

Kekurangan:

- boilerplate,
- rawan field lupa saat DTO berkembang,
- butuh test lebih disiplin.

### 5.2 MapStruct Generated Mapper

MapStruct cocok ketika:

- banyak DTO/entity mapping,
- mapping mostly structural,
- ingin compile-time error saat field tidak cocok,
- ingin menghindari reflection runtime,
- ingin mapper mudah diinspeksi,
- butuh integrasi Spring/CDI.

Contoh:

```java
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface CaseMapper {

    @Mapping(target = "applicantName", source = "applicant.name")
    @Mapping(target = "status", source = "status", qualifiedByName = "statusDisplay")
    CaseListItemResponse toListItem(CaseEntity source);

    @Named("statusDisplay")
    static String statusDisplay(CaseStatus status) {
        return status == null ? null : status.displayName();
    }
}
```

Generated code biasanya mirip manual mapping.

Kunci performance: MapStruct bukan izin untuk membuat DTO terlalu besar. MapStruct mempercepat field mapping, tetapi tidak menghilangkan biaya object graph.

### 5.3 Reflection-Based Mapper

Contoh kategori:

- ModelMapper,
- Dozer-style mapper,
- generic bean copier berbasis reflection,
- object-to-object mapper convention-heavy.

Masalah umum:

- property resolution runtime,
- nested path runtime,
- ambiguity lebih susah dilihat,
- performance lebih sulit diprediksi,
- error bisa muncul di runtime,
- mapping tersembunyi dari code review.

Reflection mapper tidak selalu buruk untuk prototyping atau admin tools kecil. Tetapi untuk core domain, high-throughput API, batch, atau regulated systems, explicit/generated mapper lebih defensible.

### 5.4 Serialization-Based Mapping

Anti-pattern:

```java
Target target = objectMapper.convertValue(source, Target.class);
```

Atau lebih buruk:

```java
String json = objectMapper.writeValueAsString(source);
Target target = objectMapper.readValue(json, Target.class);
```

Masalah:

- mahal CPU,
- mahal allocation,
- melewati JSON shape bukan semantic mapping,
- annotation JSON memengaruhi internal mapping,
- risk field leakage/field omission,
- sulit mendeteksi semantic mismatch,
- null/default/coercion bisa berubah.

`convertValue` masih berguna untuk kasus terbatas:

- generic config object,
- test utility,
- dynamic payload,
- plugin boundary,
- map-to-typed conversion yang benar-benar sadar risiko.

Tetapi jangan jadikan default internal mapper.

---

## 6. Jackson Databind vs Tree Model vs Streaming untuk Performance

Jackson punya tiga level utama:

```text
Streaming API
├── JsonParser / JsonGenerator
├── lowest allocation potential
├── lowest abstraction
└── best for huge payload/hot path

Tree Model
├── JsonNode
├── flexible partial/dynamic processing
├── allocates tree
└── good for transformation/inspection

Data Binding
├── ObjectMapper to/from POJO
├── easiest and safest for normal API
├── uses metadata/introspection/cache
└── enough for most endpoints
```

Dokumentasi Jackson menjelaskan bahwa databind mudah digunakan, tetapi convenience ini tidak gratis karena ada overhead automated processing seperti handling property dengan reflection dibanding explicit getter/setter call. Untuk lower-level processing, Streaming API memberi kontrol lebih besar dan dapat menghindari pembuatan object graph penuh.

### 6.1 Kapan Databind Cukup?

Gunakan databind untuk:

- normal REST request/response,
- payload kecil-menengah,
- DTO jelas,
- throughput biasa,
- readability lebih penting,
- tim butuh maintainability.

Contoh:

```java
CreateCaseRequest request = objectMapper.readValue(json, CreateCaseRequest.class);
```

Ini wajar.

### 6.2 Kapan Tree Model Lebih Cocok?

Gunakan `JsonNode` ketika:

- hanya butuh sebagian field,
- payload semi-dynamic,
- ingin inspect sebelum bind,
- format external tidak stabil,
- butuh tolerant reader,
- butuh merge/patch operation.

Contoh:

```java
JsonNode root = objectMapper.readTree(input);
JsonNode statusNode = root.path("status");
```

Tetapi ingat: `JsonNode` membuat tree object. Untuk payload besar, ini bisa mahal.

### 6.3 Kapan Streaming Wajib Dipertimbangkan?

Gunakan streaming ketika:

- payload sangat besar,
- array besar,
- import/export,
- event ingestion high volume,
- hanya perlu membaca sebagian token,
- tidak boleh load semua ke memory,
- response dibuat bertahap,
- memory spike harus dicegah.

Contoh pola streaming read array besar:

```java
try (JsonParser parser = objectMapper.getFactory().createParser(inputStream)) {
    if (parser.nextToken() != JsonToken.START_ARRAY) {
        throw new IllegalArgumentException("Expected array");
    }

    ObjectReader itemReader = objectMapper.readerFor(ImportRow.class);

    while (parser.nextToken() == JsonToken.START_OBJECT) {
        ImportRow row = itemReader.readValue(parser);
        process(row);
    }
}
```

Pola ini menghindari:

```java
List<ImportRow> rows = objectMapper.readValue(inputStream, new TypeReference<List<ImportRow>>() {});
```

Untuk 1 juta row, perbedaannya bisa sangat besar.

---

## 7. ObjectReader dan ObjectWriter untuk Hot Path

`ObjectMapper` lazimnya dipakai sebagai singleton. Untuk konfigurasi yang sering dipakai, gunakan `ObjectReader` dan `ObjectWriter`.

```java
private static final ObjectReader IMPORT_ROW_READER = mapper.readerFor(ImportRow.class);
private static final ObjectWriter CASE_RESPONSE_WRITER = mapper.writerFor(CaseResponse.class);
```

Manfaat:

- konfigurasi target type sudah disiapkan,
- lebih eksplisit,
- mudah dipakai ulang,
- cocok untuk hot path,
- menghindari konfigurasi mapper per request.

Jangan buat `ObjectMapper` baru per request.

Buruk:

```java
String json = new ObjectMapper().writeValueAsString(response);
```

Masalah:

- kehilangan cache serializer/deserializer,
- konfigurasi tidak konsisten,
- allocation tidak perlu,
- module bisa tidak lengkap,
- behavior antar tempat bisa berbeda.

Lebih baik:

```java
@Component
final class JsonCodec {
    private final ObjectWriter caseWriter;

    JsonCodec(ObjectMapper mapper) {
        this.caseWriter = mapper.writerFor(CaseResponse.class);
    }

    String writeCase(CaseResponse response) throws JsonProcessingException {
        return caseWriter.writeValueAsString(response);
    }
}
```

---

## 8. Collection Mapping: Sizing, Copying, and Stream Trade-Offs

Collection mapping tampak sederhana, tetapi sering menjadi sumber allocation besar.

### 8.1 Pre-size Collection

Manual mapping buruk:

```java
List<DocumentResponse> result = new ArrayList<>();
for (Document document : documents) {
    result.add(toResponse(document));
}
```

Lebih baik:

```java
List<DocumentResponse> result = new ArrayList<>(documents.size());
for (Document document : documents) {
    result.add(toResponse(document));
}
```

MapStruct generated code biasanya melakukan hal seperti ini untuk collection mapping: membuat target collection dengan size yang masuk akal jika source size tersedia.

### 8.2 Stream vs Loop

Stream:

```java
return documents.stream()
    .map(this::toResponse)
    .toList();
```

Loop:

```java
List<DocumentResponse> result = new ArrayList<>(documents.size());
for (Document document : documents) {
    result.add(toResponse(document));
}
return result;
```

Stream lebih ekspresif. Loop sering lebih mudah dioptimasi, lebih mudah debug, dan kadang lebih predictable di hot path.

Rule praktis:

- Untuk normal mapping kecil: stream boleh.
- Untuk hot path/list besar/batch: prefer loop atau generated mapper.
- Untuk mapping yang butuh checked exception/context/error path: loop lebih jelas.

### 8.3 Jangan Copy Jika Tidak Perlu

Kadang mapper membuat copy collection padahal target immutable/read-only cukup.

Contoh:

```java
new UserResponse(List.copyOf(roles));
```

Ini baik untuk safety, tetapi punya biaya. Untuk list kecil, aman. Untuk list besar, evaluasi.

Prinsip:

> Defensive copy adalah correctness tool. Gunakan sadar biaya, bukan otomatis tanpa pikir.

---

## 9. Batch Mapping dan Pagination

Batch mapping sering berbeda total dari request-response mapping.

### 9.1 Jangan Map Semua Data Sekaligus

Buruk:

```java
List<CaseEntity> cases = repository.findAll();
List<CaseExportRow> rows = cases.stream()
    .map(exportMapper::toRow)
    .toList();
writeCsv(rows);
```

Masalah:

- semua entity masuk memory,
- semua DTO masuk memory,
- GC pressure besar,
- transaction panjang,
- lazy loading tidak terkendali,
- export gagal di tengah sulit dilanjutkan.

Lebih baik:

```java
PageRequest page = PageRequest.of(0, 500);
Page<CaseProjection> result;

while ((result = repository.findExportRows(page)).hasContent()) {
    for (CaseProjection projection : result.getContent()) {
        CaseExportRow row = exportMapper.toRow(projection);
        writer.write(row);
    }
    page = page.next();
}
```

Lebih baik lagi untuk dataset besar:

- cursor/streaming query,
- keyset pagination,
- chunk processing,
- backpressure-aware writing,
- checkpoint/resume.

### 9.2 Mapping Batch Harus Punya Flush Boundary

Untuk export:

```text
read chunk -> map chunk -> write chunk -> flush -> release references
```

Jangan:

```text
read all -> map all -> write all
```

### 9.3 Jangan Simpan DTO Besar dalam List Jika Bisa Streaming

Buruk:

```java
List<ExportRow> rows = new ArrayList<>();
for (...) {
    rows.add(mapper.toRow(entity));
}
return rows;
```

Lebih baik:

```java
for (...) {
    writer.write(mapper.toRow(entity));
}
```

Atau untuk JSON output besar:

```java
try (JsonGenerator generator = objectMapper.getFactory().createGenerator(outputStream)) {
    generator.writeStartArray();
    for (CaseProjection projection : cursor) {
        CaseExportRow row = mapper.toRow(projection);
        objectWriter.writeValue(generator, row);
    }
    generator.writeEndArray();
}
```

---

## 10. Lazy Loading Trap: Mapping yang Diam-Diam Query Database

Salah satu performance bug paling umum:

```java
@Mapper
interface CaseMapper {
    CaseDetailResponse toDetail(CaseEntity entity);
}
```

Jika `CaseEntity` punya associations:

```java
@OneToMany(fetch = FetchType.LAZY)
private List<DocumentEntity> documents;

@OneToMany(fetch = FetchType.LAZY)
private List<ActionEntity> actions;
```

Mapper dapat memanggil getter dan memicu load.

### 10.1 N+1 Mapping Problem

Flow buruk:

```text
1 query load 50 cases
for each case:
  mapper reads applicant -> 50 queries
  mapper reads documents -> 50 queries
  mapper reads actions -> 50 queries
```

Total:

```text
1 + 50 + 50 + 50 = 151 queries
```

Mapper tampak tidak salah. Fetch plan salah.

### 10.2 Solusi

Pilih berdasarkan use case:

1. DTO projection langsung dari query.
2. Fetch join untuk detail endpoint.
3. Entity graph eksplisit.
4. Batch size/fetch tuning.
5. Pisahkan list DTO dan detail DTO.
6. Jangan serialize entity langsung.

Contoh projection:

```java
public record CaseListProjection(
    Long id,
    String referenceNo,
    String applicantName,
    String status,
    Instant submittedAt
) {}
```

Repository:

```java
@Query("""
    select new com.example.CaseListProjection(
        c.id,
        c.referenceNo,
        a.name,
        c.status,
        c.submittedAt
    )
    from CaseEntity c
    join c.applicant a
    where c.status = :status
""")
Page<CaseListProjection> findListByStatus(CaseStatus status, Pageable pageable);
```

Mapper tipis:

```java
CaseListItemResponse toResponse(CaseListProjection projection) {
    return new CaseListItemResponse(
        projection.id(),
        projection.referenceNo(),
        projection.applicantName(),
        StatusFormatter.display(projection.status()),
        projection.submittedAt()
    );
}
```

---

## 11. JPA Proxy Serialization Problem

Jangan kembalikan entity langsung dari controller.

Buruk:

```java
@GetMapping("/cases/{id}")
CaseEntity getCase(@PathVariable Long id) {
    return repository.findById(id).orElseThrow();
}
```

Risiko:

- lazy proxy serialization error,
- infinite recursion bidirectional relationship,
- field internal bocor,
- schema API dikendalikan entity,
- payload berubah saat entity berubah,
- query tambahan saat serializer membaca getter,
- `LazyInitializationException`,
- sensitive audit/security fields bisa keluar.

Lebih baik:

```java
@GetMapping("/cases/{id}")
CaseDetailResponse getCase(@PathVariable Long id) {
    CaseEntity entity = repository.findDetailById(id).orElseThrow();
    return caseMapper.toDetail(entity);
}
```

Dengan fetch plan yang memang cocok untuk detail.

---

## 12. Date/Time, Number, Enum: Conversion Hot Spots

Beberapa conversion tampak kecil tetapi mahal jika dilakukan jutaan kali.

### 12.1 Date/Time Formatting

Buruk di hot path:

```java
String formatted = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm:ss")
    .format(instant.atZone(zoneId));
```

Jika formatter dibuat per row, mahal.

Lebih baik:

```java
private static final DateTimeFormatter DISPLAY_FORMATTER =
    DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm:ss").withZone(ZoneId.of("Asia/Jakarta"));

String formatted = DISPLAY_FORMATTER.format(instant);
```

Catatan: `DateTimeFormatter` immutable dan thread-safe.

### 12.2 Enum Display Mapping

Buruk:

```java
String display = switch (status.name()) {
    case "SUBMITTED" -> "Submitted";
    case "APPROVED" -> "Approved";
    default -> "Unknown";
};
```

Lebih baik:

```java
enum CaseStatus {
    SUBMITTED("Submitted"),
    APPROVED("Approved");

    private final String displayName;

    CaseStatus(String displayName) {
        this.displayName = displayName;
    }

    public String displayName() {
        return displayName;
    }
}
```

Atau gunakan lookup map jika mapping external code.

### 12.3 BigDecimal Formatting

Untuk money/decimal:

- hindari double,
- jangan format string terlalu dini,
- pisahkan numeric value dan display value,
- pastikan scale/rounding eksplisit,
- untuk export besar, hindari repeated locale formatter mahal.

---

## 13. Intermediate Structures: JsonNode, Map, String

Mapping sering membuat intermediate structure tanpa sadar.

Buruk:

```java
Map<String, Object> map = objectMapper.convertValue(source, new TypeReference<>() {});
Target target = objectMapper.convertValue(map, Target.class);
```

Lebih buruk:

```java
String json = objectMapper.writeValueAsString(source);
Target target = objectMapper.readValue(json, Target.class);
```

Ini membuat:

- intermediate object/map/tree,
- string JSON penuh,
- parse ulang,
- serializer/deserializer cycle,
- allocation besar.

Gunakan hanya jika boundary memang JSON/dynamic.

Untuk internal mapping, prefer:

- manual mapper,
- MapStruct,
- explicit factory,
- projection query.

---

## 14. Payload Size adalah Performance Feature

Mapping performance tidak hanya CPU. Payload size memengaruhi:

- serialization time,
- network time,
- TLS overhead,
- compression cost,
- client parse time,
- browser memory,
- mobile data,
- observability/log storage.

DTO kecil sering lebih penting daripada serializer cepat.

Contoh:

```java
record CaseListItemResponse(
    Long id,
    String referenceNo,
    String applicantName,
    String status,
    Instant submittedAt
) {}
```

Lebih baik daripada mengirim detail besar lalu berharap frontend memilih field yang dibutuhkan.

Prinsip:

> Jangan mengoptimasi mapper untuk mengirim data yang seharusnya tidak dikirim.

---

## 15. Mapping Cache: Kapan Perlu, Kapan Bahaya

Kadang mapping mengandung conversion reference data:

```java
String countryName = countryCodeLookup.nameOf(source.countryCode());
```

Jika lookup mahal, cache bisa membantu.

Tetapi hati-hati:

- cache di mapper dapat menyembunyikan state,
- stale reference data,
- memory leak jika key tidak terbatas,
- concurrency issue,
- test menjadi sulit,
- mapper berubah menjadi service.

Lebih baik bawa context eksplisit:

```java
record MappingContext(Map<String, String> countryNames) {}
```

Manual:

```java
ApplicantResponse toResponse(Applicant source, MappingContext context) {
    return new ApplicantResponse(
        source.name(),
        context.countryNames().get(source.countryCode())
    );
}
```

MapStruct:

```java
@Mapper
interface ApplicantMapper {

    @Mapping(target = "countryName", source = "countryCode", qualifiedByName = "countryName")
    ApplicantResponse toResponse(Applicant source, @Context CountryLookupContext context);

    @Named("countryName")
    default String countryName(String code, @Context CountryLookupContext context) {
        return context.countryName(code);
    }
}
```

Rule:

> Mapper boleh memakai data referensi yang sudah disiapkan. Mapper sebaiknya tidak melakukan remote/database lookup sendiri.

---

## 16. Avoiding Hidden Remote Calls in Mapper

Anti-pattern:

```java
@Mapper(componentModel = "spring")
abstract class CaseMapper {

    @Autowired
    UserClient userClient;

    @Mapping(target = "officerName", expression = "java(userClient.getName(entity.getOfficerId()))")
    abstract CaseResponse toResponse(CaseEntity entity);
}
```

Masalah:

- satu mapping bisa menjadi N remote calls,
- timeout tersembunyi,
- retry tersembunyi,
- mapper tidak deterministic,
- sulit dites,
- sulit diobservasi,
- circuit breaker tidak jelas.

Lebih baik:

```text
service layer:
  collect officerIds
  bulk fetch officer names
  build MappingContext
  mapper maps using context
```

Contoh:

```java
List<CaseEntity> cases = repository.findPage(...);
Set<Long> officerIds = cases.stream().map(CaseEntity::getOfficerId).collect(toSet());
Map<Long, String> officerNames = officerClient.getNames(officerIds);

CaseMappingContext context = new CaseMappingContext(officerNames);
return cases.stream()
    .map(c -> mapper.toResponse(c, context))
    .toList();
```

---

## 17. Measuring Mapping Performance Correctly

Jangan optimasi berdasarkan feeling.

Gunakan observability berlapis:

```text
Production metrics
├── endpoint latency p50/p95/p99
├── allocation rate
├── GC pause/time
├── CPU profile
├── DB query count
├── payload size
├── error rate
└── throughput

Profiling
├── async-profiler / JFR
├── allocation flame graph
├── CPU flame graph
├── heap dump for leaks
└── DB query tracing

Microbenchmark
├── JMH
├── controlled mapper comparison
├── warmup-aware
├── blackhole/result consumption
└── representative data shape
```

OpenJDK JMH adalah harness untuk membangun dan menjalankan benchmark JVM skala nano/micro/milli/macro. Dokumentasi JMH sendiri menekankan bahwa samples dan pitfalls penting dipahami, dan benchmark tetap harus direview karena harness tidak otomatis menghilangkan semua kesalahan desain benchmark.

### 17.1 Contoh JMH Mapper Benchmark

```java
@State(Scope.Thread)
public class CaseMapperBenchmark {

    private CaseEntity source;
    private ManualCaseMapper manualMapper;
    private CaseMapper mapStructMapper;

    @Setup
    public void setup() {
        source = TestFixtures.caseEntityWithDocuments(10);
        manualMapper = new ManualCaseMapper();
        mapStructMapper = Mappers.getMapper(CaseMapper.class);
    }

    @Benchmark
    public CaseResponse manualMapping() {
        return manualMapper.toResponse(source);
    }

    @Benchmark
    public CaseResponse mapStructMapping() {
        return mapStructMapper.toResponse(source);
    }
}
```

### 17.2 Benchmark Pitfalls

Hindari:

- data terlalu kecil,
- data tidak representative,
- result tidak dipakai,
- benchmark hanya happy path,
- tidak ada warmup cukup,
- membandingkan mapper dengan shape berbeda,
- menjalankan di laptop sibuk lalu mengambil kesimpulan besar,
- mengabaikan allocation,
- mengabaikan DB/I/O side effect,
- mengukur mapper isolated padahal production bottleneck ada di serialization atau DB.

Benchmark yang baik menjawab pertanyaan spesifik:

> “Untuk mapping 1000 `CaseProjection` menjadi `CaseListItemResponse` dengan 5 field simple dan 2 enum conversion, apakah MapStruct/loop/manual berbeda signifikan dalam allocation dan throughput?”

Benchmark yang buruk:

> “Library mana paling cepat?”

---

## 18. CPU Profiling vs Allocation Profiling

Kadang CPU tidak terlihat tinggi, tetapi GC tinggi karena allocation.

Gunakan:

- Java Flight Recorder,
- async-profiler allocation mode,
- GC logs,
- heap histogram,
- endpoint-level metrics.

Cari pola:

```text
High allocation in:
├── DTO constructors
├── ArrayList growth
├── String formatting
├── DateTimeFormatter creation
├── JsonNode creation
├── BigDecimal/string conversion
├── stream pipeline temporary objects
├── exception path building
└── logging payload serialization
```

### 18.1 Mapping Allocation Review

Checklist:

- Apakah DTO terlalu besar?
- Apakah collection dipresize?
- Apakah mapper membuat intermediate map/json?
- Apakah date formatter dibuat per item?
- Apakah string concatenation terjadi di loop besar?
- Apakah nested graph perlu semua?
- Apakah projection bisa menggantikan entity mapping?
- Apakah response bisa streaming?
- Apakah logging menggandakan serialization?

---

## 19. Tail Latency: p99 Lebih Penting dari Average

Mapping layer sering terlihat aman di average latency, tetapi buruk di p99.

Contoh:

```text
p50  = 40 ms
p95  = 180 ms
p99  = 1200 ms
```

Penyebab mapping-related p99:

- beberapa request punya nested graph jauh lebih besar,
- satu entity punya ribuan children,
- lazy load hanya terjadi untuk status tertentu,
- formatter locale mahal muncul di cabang tertentu,
- fallback external lookup di mapper,
- payload error besar dilog penuh,
- GC pause karena burst allocation.

Solusi:

- batasi response shape,
- batasi collection size per DTO,
- gunakan pagination nested collection,
- gunakan summary count daripada full child list,
- enforce payload limit,
- profiling dengan data outlier,
- metrics payload size dan item count.

---

## 20. Defensive DTO Design untuk Performance

DTO harus punya batas.

Buruk:

```java
record CaseDetailResponse(
    Long id,
    List<DocumentResponse> documents,
    List<CommentResponse> comments,
    List<AuditResponse> audits,
    List<ActionResponse> actions
) {}
```

Jika semua list unbounded, satu response bisa meledak.

Lebih aman:

```java
record CaseDetailResponse(
    Long id,
    List<DocumentSummaryResponse> recentDocuments,
    int documentCount,
    List<CommentResponse> recentComments,
    int commentCount,
    List<ActionResponse> recentActions,
    int actionCount
) {}
```

Atau endpoint terpisah:

```text
GET /cases/{id}
GET /cases/{id}/documents?page=...
GET /cases/{id}/comments?page=...
GET /cases/{id}/audit-trail?page=...
```

Mapping performance sering dimulai dari API shape.

---

## 21. Backpressure-Adjacent Mapping

Mapping sendiri bukan reactive stream, tetapi pada ingestion/export besar, mapping perlu menghormati flow.

Buruk:

```java
List<EventDto> dtos = events.stream()
    .map(mapper::toDto)
    .toList();
producer.sendAll(dtos);
```

Lebih baik:

```java
for (Event event : eventCursor) {
    EventDto dto = mapper.toDto(event);
    producer.send(dto); // with batching/backpressure-aware producer
}
```

Untuk reactive pipeline:

```java
Flux<EventDto> dtos = eventFlux
    .map(mapper::toDto)
    .limitRate(500);
```

Pertanyaan penting:

- Apakah mapper blocking?
- Apakah mapper melakukan lookup?
- Apakah mapper heavy CPU?
- Apakah mapping perlu bounded concurrency?
- Apakah output queue bisa tumbuh tanpa batas?

---

## 22. Mapping dan GC Pressure

Mapping menghasilkan banyak short-lived objects. JVM GC modern sangat baik menangani short-lived allocations, tetapi jika rate terlalu tinggi, tetap muncul pressure.

Gejala:

- allocation rate tinggi,
- young GC sering,
- CPU GC meningkat,
- latency spike,
- humongous allocation untuk buffer/string besar,
- old gen naik jika reference tertahan.

Penyebab mapping:

- batch list besar ditahan sampai akhir,
- DTO besar ditahan untuk logging/audit,
- `JsonNode` tree besar,
- string JSON penuh dibuat sebelum dikirim,
- caching tanpa batas,
- error payload disimpan lengkap.

Solusi:

- streaming,
- chunking,
- release reference setelah chunk,
- avoid intermediate strings,
- size limit,
- bounded cache,
- projection DTO,
- reduce nested graph.

---

## 23. Large JSON Output: Avoid Full In-Memory String

Buruk:

```java
String json = objectMapper.writeValueAsString(hugeResponse);
return ResponseEntity.ok(json);
```

Masalah:

- semua JSON jadi satu string besar,
- duplicate memory: object graph + JSON string,
- risk OOM,
- latency first byte buruk.

Lebih baik gunakan streaming response.

Contoh konseptual Spring MVC:

```java
@GetMapping("/exports/cases")
public StreamingResponseBody exportCases() {
    return outputStream -> {
        try (JsonGenerator generator = objectMapper.getFactory().createGenerator(outputStream)) {
            generator.writeStartArray();

            ObjectWriter rowWriter = objectMapper.writerFor(CaseExportRow.class);
            caseService.streamExportRows(row -> {
                try {
                    rowWriter.writeValue(generator, row);
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });

            generator.writeEndArray();
        }
    };
}
```

Catatan: production code harus mengurus transaction boundary, exception handling, client disconnect, timeout, dan observability.

---

## 24. Mapping Error Path Bisa Mahal

Saat error, sistem sering melakukan lebih banyak kerja:

- serialize failed payload,
- construct detailed validation errors,
- build stack trace,
- log object besar,
- mask sensitive fields,
- store dead-letter payload,
- send notification.

Untuk high-volume invalid input, error path bisa jadi DoS vector.

Prinsip:

- batasi error detail,
- batasi number of field errors,
- jangan log full payload default,
- simpan hash/correlation id,
- sample payload jika perlu,
- enforce request size limit sebelum parse.

---

## 25. Performance Review untuk Mapper PR

Gunakan checklist ini saat code review.

### 25.1 Shape Review

- Apakah DTO sesuai use case?
- Apakah list endpoint memakai DTO ringkas?
- Apakah nested collection bounded?
- Apakah field mahal benar-benar dibutuhkan?
- Apakah response mengandung internal/audit/security field?

### 25.2 Mapping Cost Review

- Apakah mapping mostly structural atau semantic?
- Apakah mapper melakukan lookup remote/database?
- Apakah ada intermediate JSON/Map/JsonNode tidak perlu?
- Apakah formatter dibuat per item?
- Apakah collection dipresize?
- Apakah ada deep copy besar?

### 25.3 Persistence Review

- Apakah source entity punya lazy association?
- Apakah mapper memicu getter lazy?
- Apakah fetch plan sesuai target DTO?
- Apakah projection lebih tepat?
- Apakah ada N+1 risk?

### 25.4 Serialization Review

- Apakah payload size masuk akal?
- Apakah field null/empty membuat payload bengkak?
- Apakah serializer custom mahal?
- Apakah output besar butuh streaming?
- Apakah ObjectMapper/ObjectWriter reused?

### 25.5 Benchmark/Observability Review

- Apakah endpoint punya metrics payload size/item count?
- Apakah slow request bisa dikorelasikan dengan object count?
- Apakah ada query count tracing?
- Apakah benchmark representative?
- Apakah allocation profile sudah dicek untuk hot path?

---

## 26. Decision Matrix

| Problem | Default Choice | When to Escalate |
|---|---|---|
| Normal API DTO mapping | MapStruct/manual | Jika mapping semantic kompleks, manual lebih jelas |
| Tiny hot path mapping | Manual or MapStruct | Benchmark jika dipanggil jutaan kali |
| Large JSON import | Jackson streaming + ObjectReader | Jika per-row validation complex, chunk pipeline |
| Large JSON export | JsonGenerator + ObjectWriter | Jika client butuh pagination, jangan export besar langsung |
| List endpoint with JPA | Projection DTO | Entity mapping hanya jika fetch plan terkendali |
| Detail endpoint with nested data | Fetch plan + DTO mapper | Split endpoint jika nested collection unbounded |
| Dynamic external payload | JsonNode/tree model | Streaming jika payload besar |
| Internal object conversion | MapStruct/manual | Hindari JSON round-trip |
| Repeated reference lookup | Context preloaded map | Bounded cache jika data relatif statis |
| Performance suspicion | Profile first | JMH untuk isolated mapper comparison |

---

## 27. Design Patterns untuk Mapping Performance

### 27.1 Projection First Pattern

Untuk read-heavy list:

```text
DB projection -> thin DTO -> serialize
```

Bukan:

```text
DB entity graph -> rich domain/entity -> deep DTO -> serialize
```

### 27.2 Chunked Transformation Pattern

Untuk batch:

```text
read chunk -> map -> write -> flush -> release
```

### 27.3 Contextual Mapping Pattern

Untuk lookup/reference:

```text
collect keys -> bulk load context -> map using context
```

### 27.4 Boundary-Specific DTO Pattern

Untuk mencegah overfetch/overmap:

```text
List DTO != Detail DTO != Export DTO != Event DTO
```

### 27.5 Streaming Codec Pattern

Untuk payload besar:

```text
JsonParser/JsonGenerator + ObjectReader/ObjectWriter
```

### 27.6 Generated Structural Mapper Pattern

Untuk mapping field-heavy:

```text
MapStruct with ReportingPolicy.ERROR + inspected generated code
```

---

## 28. Anti-Patterns

### 28.1 Universal Mapper

```java
class UniversalMapper {
    <T> T map(Object source, Class<T> targetType) { ... }
}
```

Masalah:

- semantic hilang,
- sulit review,
- runtime failure,
- performance unpredictable,
- boundary ownership kabur.

### 28.2 Entity as API Response

Sudah dibahas: lazy loading, leakage, cycles, contract drift.

### 28.3 Detail DTO for Everything

Satu DTO dipakai untuk list/detail/export/event.

Akibat:

- payload besar,
- mapping mahal,
- API sulit evolve,
- security risk.

### 28.4 Mapper Calls Service Per Item

N+1 versi remote call.

### 28.5 JSON Round Trip Internal Mapping

Mahal dan semantic-nya salah.

### 28.6 Benchmark Tanpa Data Representative

Mengoptimasi kasus palsu.

---

## 29. Case Study: Case Management List Endpoint

### 29.1 Versi Buruk

```java
@GetMapping("/cases")
Page<CaseDetailResponse> list(Pageable pageable) {
    return repository.findAll(pageable)
        .map(caseMapper::toDetail);
}
```

Masalah:

- `findAll` entity terlalu umum,
- `toDetail` terlalu kaya,
- lazy association berisiko,
- N+1,
- payload besar,
- page size kecil pun bisa lambat,
- response list tidak butuh semua detail.

### 29.2 Versi Lebih Baik

Projection:

```java
public record CaseListRow(
    Long id,
    String referenceNo,
    String applicantName,
    CaseStatus status,
    Instant submittedAt,
    Long documentCount
) {}
```

DTO:

```java
public record CaseListItemResponse(
    Long id,
    String referenceNo,
    String applicantName,
    String status,
    Instant submittedAt,
    Long documentCount
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface CaseListMapper {

    @Mapping(target = "status", source = "status", qualifiedByName = "displayStatus")
    CaseListItemResponse toResponse(CaseListRow row);

    @Named("displayStatus")
    static String displayStatus(CaseStatus status) {
        return status == null ? null : status.displayName();
    }
}
```

Controller:

```java
@GetMapping("/cases")
Page<CaseListItemResponse> list(CaseSearchCriteria criteria, Pageable pageable) {
    return caseQueryService.search(criteria, pageable)
        .map(caseListMapper::toResponse);
}
```

Keuntungan:

- query hanya mengambil field perlu,
- DTO kecil,
- mapper murah,
- no lazy graph traversal,
- payload bounded,
- lebih mudah profile.

---

## 30. Case Study: Large Import

### 30.1 Buruk

```java
List<ImportRow> rows = objectMapper.readValue(input, new TypeReference<>() {});
for (ImportRow row : rows) {
    service.process(row);
}
```

Masalah:

- load semua row,
- memory spike,
- gagal di tengah sulit resume,
- validation error bisa sangat banyak,
- tidak ada backpressure.

### 30.2 Lebih Baik

```java
public ImportResult importCases(InputStream input) throws IOException {
    ImportResult result = new ImportResult();
    ObjectReader rowReader = objectMapper.readerFor(ImportRow.class);

    try (JsonParser parser = objectMapper.getFactory().createParser(input)) {
        expectArrayStart(parser);

        int rowNumber = 0;
        while (parser.nextToken() == JsonToken.START_OBJECT) {
            rowNumber++;
            try {
                ImportRow row = rowReader.readValue(parser);
                service.process(rowNumber, row);
                result.incrementSuccess();
            } catch (Exception ex) {
                result.addFailure(rowNumber, safeMessage(ex));
                if (result.failureCount() > 100) {
                    throw new TooManyImportErrorsException(result);
                }
            }
        }
    }

    return result;
}
```

Keuntungan:

- memory bounded,
- error per row,
- bisa stop setelah threshold,
- cocok untuk large payload,
- lebih mudah checkpoint.

---

## 31. Java 8 sampai Java 25 Considerations

### 31.1 Java 8

- tidak ada records,
- DTO biasanya class + constructor/getter,
- Lombok sering dipakai untuk boilerplate,
- stream `.collect(Collectors.toList())`,
- pastikan annotation processing stabil di build.

### 31.2 Java 11/17

- Java EE modules seperti JAXB tidak lagi bundled sejak Java 11,
- lebih banyak aplikasi mulai migrasi ke immutable DTO,
- JFR lebih praktis untuk profiling,
- GC modern lebih baik, tetapi allocation tetap perlu dikendalikan.

### 31.3 Java 16+

- records menjadi stable,
- DTO immutable jauh lebih natural,
- Jackson/MapStruct mendukung records pada versi modern,
- constructor binding lebih eksplisit.

### 31.4 Java 21

- LTS modern baseline banyak enterprise,
- sequenced collections muncul di Java 21,
- virtual threads tidak membuat mapping CPU menjadi gratis,
- profiling tetap diperlukan.

### 31.5 Java 25

- LTS baru,
- library annotation processor harus dipastikan kompatibel,
- hindari mengasumsikan Lombok/MapStruct/Jackson versi lama aman di compiler baru,
- CI harus menjalankan annotation processing dan generated mapper tests.

---

## 32. Practical Optimization Order

Jangan langsung ganti library. Optimasi mapping dengan urutan ini:

1. Pastikan DTO shape benar.
2. Pastikan fetch plan/projection benar.
3. Hilangkan hidden lookup/I/O dari mapper.
4. Hindari JSON round-trip internal.
5. Reuse `ObjectMapper`, `ObjectReader`, `ObjectWriter`.
6. Gunakan MapStruct/manual untuk structural mapping.
7. Batasi nested collection.
8. Gunakan streaming untuk large input/output.
9. Profile allocation dan CPU.
10. Baru benchmark alternatif micro-level.

Sering kali perubahan terbesar bukan “MapStruct lebih cepat dari X”, tetapi “jangan map data yang tidak dibutuhkan”.

---

## 33. Production Metrics yang Perlu Ditambahkan

Untuk endpoint mapping-heavy:

```text
http.server.duration
payload.response.bytes
payload.request.bytes
response.item.count
nested.item.count.documents
nested.item.count.actions
mapper.duration
serialization.duration
repository.query.count
repository.duration
json.parse.duration
json.write.duration
import.row.count
import.failure.count
```

Jangan buat metrics dengan cardinality tinggi seperti ID case/user sebagai label.

Contoh label aman:

```text
endpoint=/cases
operation=list
dto=CaseListItemResponse
status=success/failure
```

---

## 34. Mental Model Final

Mapping performance bukan tentang “mapper tercepat” saja.

Mapping performance adalah gabungan dari:

```text
Correct DTO shape
+ controlled object graph
+ proper fetch plan
+ explicit mapper
+ bounded collection
+ minimal intermediate allocation
+ streaming for large payload
+ safe conversion logic
+ profiling and benchmark discipline
```

Top-level engineer melihat mapper sebagai bagian dari dataflow:

```text
DB / external input
    -> source model
    -> transformation boundary
    -> target model
    -> serialization / persistence / event
    -> consumer
```

Setiap panah punya biaya. Setiap boundary punya contract. Setiap contract punya failure mode.

---

## 35. Latihan

### Latihan 1 — DTO Shape Review

Ambil satu endpoint list di sistemmu. Tulis:

- field yang benar-benar dipakai UI,
- field yang dikirim tapi tidak dipakai,
- nested collection yang tidak perlu,
- field yang bisa menjadi count saja,
- field yang butuh endpoint terpisah.

Refactor desain DTO-nya.

### Latihan 2 — Lazy Loading Audit

Untuk satu mapper entity-to-response:

- daftar semua getter yang dipanggil,
- tandai mana association lazy,
- estimasi query tambahan,
- usulkan fetch plan/projection.

### Latihan 3 — Allocation Audit

Untuk satu response detail:

- hitung jumlah root DTO,
- jumlah nested DTO,
- jumlah collection,
- jumlah string formatting,
- jumlah enum conversion,
- estimasi alokasi untuk page size 50.

### Latihan 4 — Large Payload Strategy

Desain import JSON 1 juta rows:

- bagaimana parsing,
- bagaimana validation,
- bagaimana error threshold,
- bagaimana chunk transaction,
- bagaimana checkpoint,
- bagaimana observability.

### Latihan 5 — Benchmark Design

Buat JMH benchmark untuk membandingkan:

- manual mapper,
- MapStruct mapper,
- reflection mapper jika ada,
- JSON `convertValue`.

Pastikan data shape representative dan result dikonsumsi.

---

## 36. Checklist Ringkas

Sebelum menganggap mapping layer production-ready:

- [ ] DTO sesuai use case.
- [ ] Tidak memakai entity sebagai API response.
- [ ] Tidak memakai detail DTO untuk list.
- [ ] Tidak ada unbounded nested collection.
- [ ] Tidak ada hidden DB/remote call dalam mapper.
- [ ] Fetch plan sesuai DTO.
- [ ] Projection dipakai untuk list/report bila perlu.
- [ ] Tidak ada JSON round-trip untuk internal mapping.
- [ ] ObjectMapper singleton/reused.
- [ ] ObjectReader/ObjectWriter dipakai untuk hot path.
- [ ] Collection besar diproses chunk/streaming.
- [ ] Date/time formatter tidak dibuat per item.
- [ ] Mapping error path tidak log payload penuh.
- [ ] Payload size dimonitor.
- [ ] Allocation/CPU profile dicek untuk hot endpoint.
- [ ] Benchmark menggunakan JMH jika membandingkan mapper.

---

## 37. Penutup

Part ini menggeser cara melihat mapper dari “kode copy field” menjadi “komponen performance-critical dalam dataflow”.

Kesimpulan utama:

1. Mapper cepat tidak menyelamatkan DTO yang salah.
2. DTO kecil dan projection tepat sering lebih berdampak daripada optimasi library.
3. MapStruct/manual mapper baik untuk structural mapping yang predictable.
4. Jackson databind cocok untuk normal API, streaming cocok untuk payload besar.
5. JPA lazy loading dapat membuat mapper menjadi query generator tersembunyi.
6. Benchmark harus representative; profiling production lebih penting dari asumsi.
7. Mapping layer harus didesain dengan batas object graph, memory, payload, dan failure mode.

Di Part 31, kita akan masuk lebih dalam ke persistence-specific pitfalls: JPA entities, lazy loading, proxies, cycles, entity graph, DTO projection, dan bagaimana mapper dapat memicu database storm jika tidak dirancang dengan benar.
