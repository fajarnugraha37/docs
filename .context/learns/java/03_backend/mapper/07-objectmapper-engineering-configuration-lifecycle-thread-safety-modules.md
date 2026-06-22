# Part 7 — ObjectMapper Engineering: Configuration, Lifecycle, Thread Safety, Modules

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `07-objectmapper-engineering-configuration-lifecycle-thread-safety-modules.md`  
> Target: Java 8 sampai Java 25  
> Fokus: ObjectMapper sebagai komponen infrastruktur serialization/deserialization, bukan utilitas stateless biasa.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 6, kita sudah membangun mental model Jackson dalam tiga layer:

1. **Streaming model** — token-level parser/generator.
2. **Tree model** — `JsonNode` sebagai representasi JSON fleksibel.
3. **Data binding model** — POJO/record/DTO ke JSON dan sebaliknya.

Part 7 masuk ke pertanyaan yang sangat sering diremehkan di production system:

> Bagaimana seharusnya `ObjectMapper` dikelola sebagai bagian dari arsitektur aplikasi?

Banyak developer melihat `ObjectMapper` seperti helper:

```java
new ObjectMapper().writeValueAsString(obj);
```

Itu terlihat sederhana, tetapi di sistem enterprise besar bisa menghasilkan masalah:

- konfigurasi tidak konsisten antar endpoint;
- format tanggal berbeda antar service;
- field null diperlakukan berbeda;
- unknown field kadang gagal, kadang diterima;
- enum invalid kadang jadi null;
- payload sensitif bocor karena serializer global;
- performance buruk karena mapper dibuat berulang;
- migration Jackson 2 ke Jackson 3 menjadi sulit karena konfigurasi tersebar;
- test hijau tetapi runtime berbeda karena Spring Boot customizer tidak ikut dipakai;
- bug sulit direproduksi karena mapper dikonfigurasi setelah dipakai.

Jadi Part 7 bukan sekadar “cara setup ObjectMapper”. Bagian ini membahas `ObjectMapper` sebagai **runtime contract component**.

---

## 1. Mental Model: ObjectMapper Adalah Boundary Engine

`ObjectMapper` bukan hanya class untuk parse JSON. Ia adalah mesin yang menjawab pertanyaan berikut:

- Field mana yang dianggap bagian dari kontrak?
- Nama property Java diterjemahkan menjadi nama JSON apa?
- Null ditulis atau dihapus?
- Missing field boleh atau gagal?
- Unknown field diterima atau ditolak?
- Date/time ditulis sebagai string ISO, timestamp, array, atau custom format?
- Enum ditulis sebagai name, object, code, atau string custom?
- Constructor mana yang dipakai saat deserialization?
- Annotation apa yang dihormati?
- Module apa yang aktif?
- Polymorphic type diperbolehkan atau tidak?
- Error apa yang muncul saat payload rusak?

Dengan kata lain:

```text
ObjectMapper = JSON runtime policy + Java object introspection + conversion engine + module registry + serializer/deserializer cache
```

Karena itu, setiap aplikasi serius perlu memperlakukan `ObjectMapper` sebagai infrastruktur, setara dengan:

- `DataSource`
- `EntityManagerFactory`
- HTTP client
- cache client
- message serializer
- validation factory

Ia harus punya lifecycle, ownership, convention, test, dan migration policy.

---

## 2. Kesalahan Dasar: Membuat ObjectMapper Baru di Setiap Tempat

Contoh buruk:

```java
public String toJson(Object value) {
    try {
        return new ObjectMapper().writeValueAsString(value);
    } catch (JsonProcessingException e) {
        throw new RuntimeException(e);
    }
}
```

Masalahnya bukan hanya performance.

### 2.1 Masalah Konfigurasi

`new ObjectMapper()` tidak otomatis punya konfigurasi aplikasi.

Misalnya di Spring Boot aplikasi sudah dikonfigurasi:

- `JavaTimeModule` aktif;
- date ditulis ISO string;
- `snake_case` naming strategy;
- null excluded;
- unknown properties gagal untuk inbound API;
- custom serializer untuk `Money`;
- custom deserializer untuk domain code;
- masking serializer untuk audit log.

Tetapi helper di atas membuat mapper default.

Hasilnya:

```java
record UserResponse(
    String userId,
    LocalDateTime createdAt
) {}
```

Mapper aplikasi mungkin menghasilkan:

```json
{
  "user_id": "U-001",
  "created_at": "2026-06-17T10:30:00"
}
```

Mapper baru default bisa menghasilkan error atau format berbeda, tergantung versi dan module.

### 2.2 Masalah Performance

`ObjectMapper` membangun banyak struktur internal:

- serializer cache;
- deserializer cache;
- type metadata;
- annotation introspection result;
- module-registered handlers;
- subtype resolver;
- factory configuration;
- feature flags.

Membuat mapper berulang di hot path membuang cache dan meningkatkan allocation.

### 2.3 Masalah Observability

Saat mapper tersebar, bug sulit dilacak:

```text
Endpoint A serializes LocalDate as ISO string.
Endpoint B serializes LocalDate as array.
Kafka event serializes enum as name.
Audit log serializes enum as object.
Batch export serializes BigDecimal as floating number.
```

Ketika consumer komplain, tidak jelas mapper mana yang dipakai.

### 2.4 Rule of Thumb

```text
Do not create ObjectMapper ad hoc in application logic.
Create named, configured, shared mappers at infrastructure boundary.
```

---

## 3. Thread Safety: Aman Jika Dikonfigurasi Sebelum Dipakai

`ObjectMapper` umumnya aman untuk digunakan bersama antar thread **jika semua konfigurasi dilakukan sebelum operasi read/write pertama**.

Mental modelnya:

```text
Build phase:
  create ObjectMapper
  register modules
  set features
  set naming strategy
  set inclusion
  set serializers/deserializers
  publish as shared bean

Runtime phase:
  read JSON
  write JSON
  create ObjectReader/ObjectWriter
  never mutate global config
```

Yang berbahaya:

```java
objectMapper.writeValueAsString(value);
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false); // dangerous after use
```

Bukan berarti selalu pasti crash. Justru lebih buruk: efeknya bisa sebagian terlihat, sebagian tidak, tergantung cache yang sudah terbentuk.

### 3.1 Anti-Pattern: Mutable Global Mapper

```java
@Component
public class JsonService {
    private final ObjectMapper mapper;

    public String export(Object value) throws JsonProcessingException {
        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL); // bad
        return mapper.writeValueAsString(value);
    }
}
```

Masalah:

- request lain bisa terkena konfigurasi ini;
- behavior bergantung urutan request;
- race condition semantik;
- test single-threaded bisa lolos, production concurrent gagal.

### 3.2 Pattern: Immutable Reader/Writer Per Use Case

Gunakan `ObjectReader` dan `ObjectWriter` untuk variasi runtime.

```java
public final class JsonCodec {
    private final ObjectMapper mapper;
    private final ObjectWriter compactWriter;
    private final ObjectWriter prettyWriter;

    public JsonCodec(ObjectMapper mapper) {
        this.mapper = mapper;
        this.compactWriter = mapper.writer();
        this.prettyWriter = mapper.writerWithDefaultPrettyPrinter();
    }

    public String compact(Object value) {
        try {
            return compactWriter.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new JsonSerializationException("Failed to serialize compact JSON", e);
        }
    }

    public String pretty(Object value) {
        try {
            return prettyWriter.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new JsonSerializationException("Failed to serialize pretty JSON", e);
        }
    }
}
```

Konfigurasi spesifik writer tidak mengubah mapper global.

---

## 4. Lifecycle ObjectMapper yang Sehat

Lifecycle yang sehat:

```text
1. Define JSON policy
2. Build mapper
3. Register modules
4. Configure features
5. Freeze usage convention
6. Expose as dependency
7. Test behavior
8. Monitor errors
9. Version/migrate deliberately
```

### 4.1 Jangan Mulai dari Code

Banyak tim langsung bertanya:

```java
objectMapper.configure(...)
```

Pertanyaan yang benar:

```text
Boundary ini harus strict atau tolerant?
Apakah ini inbound API, outbound API, event, audit log, cache, atau test fixture?
Apa compatibility policy-nya?
Apa security exposure-nya?
Apa format date/time canonical-nya?
Apa perlakuan null/missing/unknown field?
```

Baru setelah itu pilih konfigurasi.

---

## 5. Satu ObjectMapper atau Banyak ObjectMapper?

Jawaban senior: tergantung boundary.

### 5.1 Satu Mapper untuk Seluruh Aplikasi

Cocok jika aplikasi sederhana:

```text
Web API only
No event payload
No legacy integration
No audit JSON
No strict/lenient separation
No external weird format
```

Keuntungan:

- mudah dipahami;
- konsisten;
- sedikit konfigurasi;
- cocok untuk CRUD service kecil.

Risiko:

- semua boundary dipaksa punya policy sama;
- inbound strictness bisa konflik dengan outbound compatibility;
- audit redaction bisa bercampur dengan API serializer;
- legacy integration butuh format aneh lalu merusak global config.

### 5.2 Banyak Mapper Berdasarkan Boundary

Untuk sistem besar, lebih sehat memakai mapper terpisah berdasarkan boundary:

```text
apiObjectMapper
  Untuk HTTP API public/internal

eventObjectMapper
  Untuk Kafka/RabbitMQ/JMS payload

auditObjectMapper
  Untuk audit trail/log snapshot

cacheObjectMapper
  Untuk Redis/cache serialization

legacyPartnerObjectMapper
  Untuk external system yang punya format khusus

testFixtureObjectMapper
  Untuk golden payload test
```

Keuntungan:

- policy eksplisit;
- migration lebih terkendali;
- external integration tidak mengotori API;
- audit masking bisa berbeda dari response DTO;
- event compatibility bisa lebih stabil.

Risiko:

- konfigurasi duplikatif;
- developer bisa salah inject mapper;
- perlu naming convention yang disiplin;
- perlu test behavior per mapper.

### 5.3 Prinsip Pemisahan

Gunakan mapper berbeda jika:

- strictness berbeda;
- naming strategy berbeda;
- date/time format berbeda;
- serializer/deserializer custom berbeda;
- compatibility policy berbeda;
- security/redaction berbeda;
- payload dimiliki consumer berbeda;
- format bagian dari kontrak jangka panjang.

Jangan membuat mapper berbeda hanya karena class berbeda.

---

## 6. ObjectMapper Profiles

Cara berpikir yang lebih baik adalah profile.

```text
Mapper profile = named set of serialization/deserialization policies for a boundary
```

Contoh:

| Profile | Use Case | Policy |
|---|---|---|
| `api-strict` | inbound REST request | fail unknown, reject weird coercion |
| `api-response` | outbound REST response | stable naming, non-null policy |
| `event-stable` | event payload | tolerant reader, stable date format |
| `audit-safe` | audit/log snapshot | include null maybe yes, mask sensitive fields |
| `legacy-partner-x` | partner integration | custom naming/date/enum format |
| `cache-internal` | Redis/internal cache | optimized, versioned wrapper |

### 6.1 Example Profile Object

```java
public enum JsonProfile {
    API_STRICT,
    API_RESPONSE,
    EVENT_STABLE,
    AUDIT_SAFE,
    LEGACY_PARTNER_X,
    CACHE_INTERNAL
}
```

Kemudian registry:

```java
public final class JsonMapperRegistry {
    private final Map<JsonProfile, ObjectMapper> mappers;

    public JsonMapperRegistry(Map<JsonProfile, ObjectMapper> mappers) {
        this.mappers = Map.copyOf(mappers);
    }

    public ObjectMapper mapper(JsonProfile profile) {
        ObjectMapper mapper = mappers.get(profile);
        if (mapper == null) {
            throw new IllegalArgumentException("No ObjectMapper registered for profile: " + profile);
        }
        return mapper;
    }
}
```

Untuk Java 8:

```java
public final class JsonMapperRegistry {
    private final Map<JsonProfile, ObjectMapper> mappers;

    public JsonMapperRegistry(Map<JsonProfile, ObjectMapper> mappers) {
        this.mappers = Collections.unmodifiableMap(new EnumMap<>(mappers));
    }

    public ObjectMapper mapper(JsonProfile profile) {
        ObjectMapper mapper = mappers.get(profile);
        if (mapper == null) {
            throw new IllegalArgumentException("No ObjectMapper registered for profile: " + profile);
        }
        return mapper;
    }
}
```

---

## 7. Baseline Configuration yang Umumnya Sehat

Tidak ada satu konfigurasi universal, tetapi ada baseline yang sering aman untuk enterprise API.

### 7.1 Date/Time sebagai ISO String

```java
ObjectMapper mapper = new ObjectMapper();
mapper.registerModule(new JavaTimeModule());
mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
```

Tujuan:

```json
{
  "createdAt": "2026-06-17T10:30:00"
}
```

Bukan:

```json
{
  "createdAt": [2026, 6, 17, 10, 30]
}
```

Untuk API manusia dan contract, ISO string biasanya lebih jelas.

### 7.2 Unknown Field untuk Inbound API

Dua policy umum:

#### Strict

```java
mapper.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
```

Cocok untuk:

- admin API internal;
- command endpoint sensitif;
- regulatory workflow;
- input yang harus deterministic;
- sistem yang ingin menangkap typo payload.

#### Tolerant

```java
mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
```

Cocok untuk:

- event consumer;
- external API evolution;
- backward/forward compatibility;
- tolerant reader pattern.

Yang salah adalah tidak sadar policy mana yang dipakai.

### 7.3 Null Inclusion

```java
mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
```

Ini populer, tetapi tidak selalu benar.

Pertanyaan:

```text
Apakah field null berarti unknown?
Apakah field absent berarti unchanged?
Apakah consumer membedakan null dan missing?
Apakah audit butuh melihat field null secara eksplisit?
```

Untuk response API, `NON_NULL` sering baik.

Untuk audit snapshot, include null bisa lebih jujur.

Untuk patch/update, null vs absent sangat penting dan tidak boleh disembunyikan sembarangan.

### 7.4 Enum Handling

Default Jackson enum biasanya memakai `name()`.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

JSON:

```json
"SUBMITTED"
```

Ini sederhana, tetapi ada risiko:

- rename enum memutus kontrak;
- enum name internal bocor;
- external code table tidak selalu sama dengan enum name;
- compatibility sulit.

Untuk contract jangka panjang, bisa pertimbangkan explicit code.

```java
public enum CaseStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    APPROVED("A"),
    REJECTED("R");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    @JsonValue
    public String code() {
        return code;
    }

    @JsonCreator
    public static CaseStatus fromCode(String code) {
        for (CaseStatus status : values()) {
            if (status.code.equals(code)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
    }
}
```

Namun ini juga policy. Jangan asal pakai untuk semua enum.

---

## 8. Java 8, Java 11, Java 17, Java 21, Java 25: Apa Dampaknya ke ObjectMapper?

### 8.1 Java 8

Java 8 membawa:

- `java.time`;
- `Optional`;
- parameter name reflection dengan compiler flag `-parameters`;
- lambda dan functional style.

Untuk Jackson 2.x, biasanya perlu module tambahan:

```java
mapper.registerModule(new JavaTimeModule());
mapper.registerModule(new Jdk8Module());
mapper.registerModule(new ParameterNamesModule());
```

### 8.2 Java 11

Secara mapping, tidak banyak fitur bahasa baru yang mengubah DTO drastis, tetapi Java 11 sering menjadi baseline modern untuk library enterprise.

Perhatian:

- module path vs classpath;
- reflective access warning;
- dependency upgrade;
- legacy JAXB keluar dari JDK sejak Java 11.

### 8.3 Java 16+

Records menjadi fitur production.

```java
public record UserResponse(
    String id,
    String name
) {}
```

Dampak ke ObjectMapper:

- constructor binding menjadi lebih penting;
- property immutable by default;
- no setter;
- canonical constructor dipakai;
- null/default behavior harus eksplisit.

### 8.4 Java 17+

Sealed classes/interface menjadi relevan untuk polymorphic DTO.

```java
public sealed interface PaymentCommand
        permits CardPaymentCommand, BankTransferCommand {
}
```

Dampak:

- polymorphic deserialization butuh discriminator;
- subtype registration lebih eksplisit;
- security default typing harus hati-hati;
- API contract perlu type field yang stabil.

### 8.5 Java 21 dan 25

Untuk mapping layer, Java modern mendorong:

- records untuk DTO immutable;
- sealed hierarchy untuk explicit variant;
- pattern matching di service/domain logic;
- lebih sedikit Lombok untuk DTO murni;
- constructor-based binding lebih umum;
- lebih banyak compile-time expressiveness.

Tetapi legacy Java 8 masih penting karena banyak enterprise system belum modern.

Seri ini akan terus membedakan:

```text
Java 8-compatible approach
Modern Java 17/21/25 approach
```

---

## 9. Module Registration

Module adalah cara Jackson memperluas behavior.

Contoh module umum:

```java
ObjectMapper mapper = new ObjectMapper();
mapper.registerModule(new JavaTimeModule());
mapper.registerModule(new Jdk8Module());
mapper.registerModule(new ParameterNamesModule());
```

### 9.1 JavaTimeModule

Untuk tipe `java.time`:

- `LocalDate`
- `LocalDateTime`
- `OffsetDateTime`
- `ZonedDateTime`
- `Instant`
- `Duration`
- `Period`

Tanpa module yang tepat, Jackson 2.x bisa gagal atau menghasilkan format tidak diinginkan.

### 9.2 Jdk8Module

Untuk tipe Java 8 seperti:

- `Optional`
- `OptionalInt`
- `OptionalLong`
- `OptionalDouble`

Catatan penting: jangan gunakan `Optional` sembarangan sebagai field DTO. `Optional` lebih cocok sebagai return type method, bukan field data model. Tetapi bila legacy code memilikinya, module perlu mendukung.

### 9.3 ParameterNamesModule

Membantu constructor binding berdasarkan nama parameter, terutama jika class tidak memakai setter.

```java
public class UserDto {
    private final String id;
    private final String name;

    public UserDto(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() { return id; }
    public String getName() { return name; }
}
```

Agar nama parameter tersedia, compile dengan:

```text
-parameters
```

Namun untuk kontrak penting, lebih eksplisit memakai `@JsonCreator` dan `@JsonProperty`.

```java
public class UserDto {
    private final String id;
    private final String name;

    @JsonCreator
    public UserDto(
            @JsonProperty("id") String id,
            @JsonProperty("name") String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() { return id; }
    public String getName() { return name; }
}
```

### 9.4 Custom Module

Untuk sistem besar, buat module custom agar serializer/deserializer tidak tersebar.

```java
public final class CompanyJsonModule extends SimpleModule {
    public CompanyJsonModule() {
        super("CompanyJsonModule");
        addSerializer(Money.class, new MoneySerializer());
        addDeserializer(Money.class, new MoneyDeserializer());
        addSerializer(SensitiveString.class, new SensitiveStringSerializer());
    }
}
```

Register:

```java
mapper.registerModule(new CompanyJsonModule());
```

Manfaat:

- reusable;
- testable;
- explicit ownership;
- migration lebih mudah;
- audit serializer/deserializer lebih jelas.

---

## 10. findAndRegisterModules(): Nyaman tapi Harus Hati-Hati

Jackson menyediakan:

```java
mapper.findAndRegisterModules();
```

Ini akan mencari module lewat service loader/classpath.

Keuntungan:

- setup cepat;
- cocok untuk aplikasi kecil;
- mengurangi lupa register JavaTimeModule.

Risiko:

- behavior bergantung dependency classpath;
- module bisa aktif tanpa disadari;
- sulit untuk deterministic build;
- hasil test dan production bisa berbeda jika dependency berbeda;
- governance kurang jelas.

Untuk sistem enterprise, lebih baik eksplisit:

```java
mapper.registerModule(new JavaTimeModule());
mapper.registerModule(new Jdk8Module());
mapper.registerModule(new ParameterNamesModule());
mapper.registerModule(new CompanyJsonModule());
```

Rule:

```text
For prototypes, findAndRegisterModules is acceptable.
For regulated/enterprise systems, prefer explicit module registration.
```

---

## 11. Feature Flags: SerializationFeature, DeserializationFeature, MapperFeature, JsonParser.Feature

Jackson punya banyak feature. Jangan hafal semua; pahami kategori.

### 11.1 SerializationFeature

Mengontrol object menjadi JSON.

Contoh:

```java
mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
mapper.enable(SerializationFeature.INDENT_OUTPUT);
```

Pertanyaan desain:

- bentuk output apa yang menjadi kontrak?
- output harus stabil atau human-readable?
- date/time canonical format apa?
- gagal jika empty bean atau tidak?

### 11.2 DeserializationFeature

Mengontrol JSON menjadi object.

Contoh:

```java
mapper.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
mapper.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
mapper.enable(DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS);
```

Pertanyaan desain:

- input invalid harus gagal cepat atau ditoleransi?
- coercion boleh atau tidak?
- missing/null field punya makna apa?
- enum unknown harus gagal, null, atau default?

### 11.3 MapperFeature

Mengontrol introspection dan binding behavior level mapper.

Contoh area:

- auto-detect fields/getters/setters;
- annotation usage;
- case-insensitive property;
- access modifier handling.

Semakin banyak auto-detection dibuka, semakin besar kemungkinan field tidak sengaja masuk kontrak.

### 11.4 JsonParser/JsonGenerator Features

Lebih dekat ke syntax JSON token-level.

Contoh:

- allow comments;
- allow single quotes;
- allow unquoted field names;
- duplicate detection;
- non-numeric numbers.

Untuk external API, jangan terlalu lenient kecuali ada alasan compatibility kuat.

---

## 12. Strict vs Lenient: Jangan Campur dalam Satu Mapper Global

### 12.1 Strict Inbound API Mapper

```java
public final class StrictApiObjectMapperFactory {
    public static ObjectMapper create() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.registerModule(new Jdk8Module());
        mapper.registerModule(new ParameterNamesModule());

        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        mapper.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
        mapper.enable(DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS);

        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        return mapper;
    }
}
```

Cocok untuk request command:

```json
{
  "caseId": "C-001",
  "approvalStatus": "APPROVED",
  "unexpectedField": "typo"
}
```

Jika `unexpectedField` tidak dikenal, fail.

Kenapa? Karena command bisa mengubah state. Toleransi berlebihan bisa menyembunyikan typo atau client bug.

### 12.2 Lenient Event Consumer Mapper

```java
public final class EventObjectMapperFactory {
    public static ObjectMapper create() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        return mapper;
    }
}
```

Cocok untuk event evolution:

```json
{
  "eventId": "E-001",
  "caseId": "C-001",
  "status": "APPROVED",
  "newFieldFromFutureProducer": "value"
}
```

Consumer lama tetap bisa memproses field yang dikenalnya.

### 12.3 Audit Mapper

```java
public final class AuditObjectMapperFactory {
    public static ObjectMapper create() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.registerModule(new CompanyAuditJsonModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        mapper.setSerializationInclusion(JsonInclude.Include.ALWAYS);
        return mapper;
    }
}
```

Kenapa `ALWAYS`?

Karena audit mungkin butuh tahu bahwa field eksplisit bernilai null, bukan hilang karena serializer.

---

## 13. Spring Boot Integration

Di Spring Boot, `ObjectMapper` biasanya dikelola otomatis.

### 13.1 Jangan Bypass Mapper Spring untuk API

Buruk:

```java
@RestController
class UserController {
    @GetMapping("/users/{id}/raw")
    public String getRaw(@PathVariable String id) throws JsonProcessingException {
        UserResponse response = service.get(id);
        return new ObjectMapper().writeValueAsString(response);
    }
}
```

Lebih baik:

```java
@RestController
class UserController {
    @GetMapping("/users/{id}")
    public UserResponse get(@PathVariable String id) {
        return service.get(id);
    }
}
```

Biarkan HTTP message converter memakai mapper aplikasi.

Jika butuh manual serialization:

```java
@Component
class JsonService {
    private final ObjectMapper objectMapper;

    JsonService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }
}
```

### 13.2 Customizer Pattern

Di Spring Boot, konfigurasi bisa via builder/customizer.

Contoh konseptual:

```java
@Configuration
class JacksonConfig {

    @Bean
    Jackson2ObjectMapperBuilderCustomizer jsonCustomizer() {
        return builder -> builder
                .modules(new JavaTimeModule(), new Jdk8Module(), new ParameterNamesModule())
                .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                .serializationInclusion(JsonInclude.Include.NON_NULL);
    }
}
```

Untuk Spring Boot versi modern, detail API bisa berubah, tetapi prinsipnya tetap:

```text
Configure centrally.
Do not create ad hoc ObjectMapper for API behavior.
```

### 13.3 Multiple Mapper di Spring

```java
@Configuration
class JsonMapperConfig {

    @Bean
    @Qualifier("apiObjectMapper")
    ObjectMapper apiObjectMapper() {
        return StrictApiObjectMapperFactory.create();
    }

    @Bean
    @Qualifier("eventObjectMapper")
    ObjectMapper eventObjectMapper() {
        return EventObjectMapperFactory.create();
    }

    @Bean
    @Qualifier("auditObjectMapper")
    ObjectMapper auditObjectMapper() {
        return AuditObjectMapperFactory.create();
    }
}
```

Inject dengan eksplisit:

```java
@Service
class AuditSnapshotService {
    private final ObjectMapper auditObjectMapper;

    AuditSnapshotService(@Qualifier("auditObjectMapper") ObjectMapper auditObjectMapper) {
        this.auditObjectMapper = auditObjectMapper;
    }
}
```

Hindari field bernama generik `objectMapper` jika ada banyak mapper.

---

## 14. ObjectReader dan ObjectWriter sebagai Boundary Codec

Alih-alih expose `ObjectMapper` ke semua class, sering lebih baik expose codec spesifik.

### 14.1 Problem Jika Semua Orang Punya ObjectMapper

```java
class SomeService {
    private final ObjectMapper objectMapper;

    void doSomething() {
        objectMapper.convertValue(...);
        objectMapper.writerWithDefaultPrettyPrinter();
        objectMapper.configure(...); // someone might do this
    }
}
```

Terlalu banyak power.

### 14.2 Codec Spesifik

```java
public final class CaseEventJsonCodec {
    private final ObjectReader reader;
    private final ObjectWriter writer;

    public CaseEventJsonCodec(ObjectMapper eventObjectMapper) {
        this.reader = eventObjectMapper.readerFor(CaseEvent.class);
        this.writer = eventObjectMapper.writerFor(CaseEvent.class);
    }

    public CaseEvent decode(byte[] payload) {
        try {
            return reader.readValue(payload);
        } catch (IOException e) {
            throw new EventDecodingException("Failed to decode CaseEvent", e);
        }
    }

    public byte[] encode(CaseEvent event) {
        try {
            return writer.writeValueAsBytes(event);
        } catch (JsonProcessingException e) {
            throw new EventEncodingException("Failed to encode CaseEvent", e);
        }
    }
}
```

Manfaat:

- class consumer tidak bisa mutate mapper;
- type target jelas;
- error context lebih baik;
- bisa ditest sebagai contract codec;
- dependency lebih kecil.

---

## 15. convertValue(): Berguna tapi Sering Disalahgunakan

Jackson punya:

```java
Target target = objectMapper.convertValue(source, Target.class);
```

Ini terlihat seperti mapper object-to-object.

### 15.1 Kapan Boleh

Boleh untuk:

- test fixture;
- prototyping;
- dynamic map to DTO;
- JSON-like object transformation;
- boundary di mana lossy conversion diterima;
- admin/internal tooling.

### 15.2 Kapan Berbahaya

Berbahaya untuk domain mapping penting:

```java
UserEntity entity = objectMapper.convertValue(requestDto, UserEntity.class);
```

Masalah:

- mapping implicit;
- field matching by name;
- unknown semantic change tidak terlihat;
- entity bisa terisi field yang tidak boleh diubah;
- validation/invariant terlewati;
- security over-posting;
- refactoring field bisa mengubah behavior diam-diam;
- sulit review.

Untuk production domain mapping, lebih baik:

- manual mapper;
- MapStruct;
- explicit assembler;
- command object.

Rule:

```text
Do not use ObjectMapper.convertValue as a domain mapper for state-changing flows.
```

---

## 16. treeToValue() dan valueToTree(): Jembatan Tree Model

```java
JsonNode node = mapper.valueToTree(object);
Target target = mapper.treeToValue(node, Target.class);
```

Berguna saat:

- ingin inspect payload sebagian;
- ingin ambil metadata dulu;
- ingin route berdasarkan field;
- ingin transform dynamic JSON;
- ingin validate structure sebelum binding.

Contoh:

```java
public CaseEvent decode(JsonNode node) {
    String eventType = node.path("eventType").asText(null);

    if (eventType == null) {
        throw new EventDecodingException("Missing eventType");
    }

    return switch (eventType) {
        case "CASE_SUBMITTED" -> mapper.treeToValue(node, CaseSubmittedEvent.class);
        case "CASE_APPROVED" -> mapper.treeToValue(node, CaseApprovedEvent.class);
        default -> throw new EventDecodingException("Unsupported eventType: " + eventType);
    };
}
```

Untuk Java 8, tanpa switch expression:

```java
public CaseEvent decode(JsonNode node) throws JsonProcessingException {
    String eventType = node.path("eventType").asText(null);

    if ("CASE_SUBMITTED".equals(eventType)) {
        return mapper.treeToValue(node, CaseSubmittedEvent.class);
    }
    if ("CASE_APPROVED".equals(eventType)) {
        return mapper.treeToValue(node, CaseApprovedEvent.class);
    }
    throw new EventDecodingException("Unsupported eventType: " + eventType);
}
```

---

## 17. copy(): Membuat Mapper Turunan

Jackson menyediakan:

```java
ObjectMapper child = base.copy();
```

Ini berguna jika ingin membuat mapper variant dari baseline.

```java
ObjectMapper base = baseMapper();

ObjectMapper audit = base.copy()
    .setSerializationInclusion(JsonInclude.Include.ALWAYS)
    .registerModule(new CompanyAuditJsonModule());
```

Namun hati-hati:

- lakukan saat initialization;
- jangan copy di hot path;
- jangan copy lalu mutate berdasarkan request;
- beri nama bean jelas.

Pattern:

```java
ObjectMapper baseMapper = createBaseMapper();
ObjectMapper apiMapper = createApiMapper(baseMapper);
ObjectMapper eventMapper = createEventMapper(baseMapper);
ObjectMapper auditMapper = createAuditMapper(baseMapper);
```

---

## 18. Base Mapper Factory Pattern

Untuk menghindari duplikasi:

```java
public final class BaseObjectMapperFactory {
    private BaseObjectMapperFactory() {}

    public static ObjectMapper createBase() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.registerModule(new Jdk8Module());
        mapper.registerModule(new ParameterNamesModule());
        mapper.registerModule(new CompanyJsonModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return mapper;
    }
}
```

Profile factory:

```java
public final class ObjectMapperProfiles {
    private ObjectMapperProfiles() {}

    public static ObjectMapper apiStrict() {
        ObjectMapper mapper = BaseObjectMapperFactory.createBase();
        mapper.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        mapper.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        return mapper;
    }

    public static ObjectMapper eventStable() {
        ObjectMapper mapper = BaseObjectMapperFactory.createBase();
        mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        return mapper;
    }

    public static ObjectMapper auditSafe() {
        ObjectMapper mapper = BaseObjectMapperFactory.createBase();
        mapper.registerModule(new CompanyAuditJsonModule());
        mapper.setSerializationInclusion(JsonInclude.Include.ALWAYS);
        return mapper;
    }
}
```

Kunci: semua mapper selesai dikonfigurasi sebelum dipakai.

---

## 19. Naming Strategy: Jangan Dianggap Kosmetik

Naming strategy mengubah kontrak.

Java:

```java
public record UserResponse(
    String userId,
    String displayName
) {}
```

Default JSON:

```json
{
  "userId": "U-001",
  "displayName": "Fajar"
}
```

Snake case:

```json
{
  "user_id": "U-001",
  "display_name": "Fajar"
}
```

Ini breaking change bagi consumer.

### 19.1 Global Naming Strategy

```java
mapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
```

Cocok jika seluruh API punya standard sama.

### 19.2 Annotation Per Field

```java
public record UserResponse(
    @JsonProperty("user_id") String userId,
    @JsonProperty("display_name") String displayName
) {}
```

Lebih verbose tetapi explicit.

### 19.3 Policy

Gunakan global naming strategy jika:

- sistem baru;
- convention kuat;
- semua DTO mengikuti rule;
- tidak ada exception banyak.

Gunakan explicit annotation jika:

- external contract stabil;
- field name legacy;
- beberapa field punya nama aneh;
- migration bertahap;
- perlu dokumentasi field-level.

---

## 20. Date/Time Policy: Salah Satu Sumber Bug Terbesar

Date/time bukan format teknis saja; ia membawa makna.

### 20.1 Jenis Tipe

| Java Type | Meaning |
|---|---|
| `LocalDate` | tanggal tanpa waktu dan zona |
| `LocalDateTime` | tanggal+waktu tanpa zona |
| `OffsetDateTime` | tanggal+waktu dengan offset |
| `ZonedDateTime` | tanggal+waktu dengan timezone region |
| `Instant` | titik waktu universal |
| `Date` | legacy instant-ish type |

### 20.2 Jangan Asal Pakai LocalDateTime untuk Timestamp Global

```java
public record AuditEntry(
    LocalDateTime createdAt
) {}
```

Masalah:

```text
createdAt di timezone mana?
Apakah ini UTC?
Apakah ini local server time?
Apakah consumer beda negara bisa menafsirkan benar?
```

Untuk audit/event, sering lebih aman:

```java
public record AuditEntry(
    Instant createdAt
) {}
```

Atau:

```java
public record UserVisibleSchedule(
    OffsetDateTime scheduledAt
) {}
```

### 20.3 ObjectMapper Tidak Bisa Memperbaiki Model yang Salah

Jika tipe Java salah, konfigurasi JSON hanya menutup gejala.

```text
Bad model + pretty JSON = still bad contract
```

---

## 21. Null, Missing, Empty: Policy Harus Eksplisit

Dalam JSON:

```json
{
  "name": null
}
```

Berbeda dari:

```json
{}
```

Berbeda dari:

```json
{
  "name": ""
}
```

### 21.1 Meaning Matrix

| Shape | Possible Meaning |
|---|---|
| missing | not provided, unchanged, unknown, default |
| null | explicitly empty, clear value, unknown |
| empty string | user input blank, invalid, intentionally empty |
| empty array | no items |
| missing array | not requested, not loaded, no change |

### 21.2 Update/Patch Risk

Request:

```json
{
  "displayName": null
}
```

Bisa berarti:

1. hapus display name;
2. client tidak tahu display name;
3. bug client;
4. jangan ubah display name.

ObjectMapper hanya binding. Semantik harus didesain di DTO dan mapper layer.

---

## 22. Coercion: Kenyamanan yang Bisa Berbahaya

Jackson bisa melakukan coercion:

```json
{
  "age": "30"
}
```

Menjadi:

```java
int age = 30;
```

Atau:

```json
{
  "enabled": "true"
}
```

Menjadi boolean.

Ini membantu integrasi legacy, tetapi berbahaya untuk API strict.

### 22.1 Masalah Coercion

- client bug tidak terlihat;
- schema contract longgar;
- security validation melemah;
- error data masuk lebih jauh;
- behavior berubah antar versi library;
- field kosong bisa menjadi default tak terduga.

### 22.2 Policy

```text
External strict API:
  minimize coercion

Legacy partner integration:
  allow controlled coercion in partner-specific mapper

Internal event:
  choose based on compatibility policy
```

---

## 23. Error Wrapping: Jangan Bocorkan Jackson Exception Mentah ke Domain

Buruk:

```java
public CaseEvent decode(String json) throws JsonProcessingException {
    return mapper.readValue(json, CaseEvent.class);
}
```

Lebih baik:

```java
public CaseEvent decode(String json) {
    try {
        return reader.readValue(json);
    } catch (JsonProcessingException e) {
        throw new CaseEventPayloadException("Invalid CaseEvent JSON payload", e);
    }
}
```

Kenapa?

- caller tidak perlu tahu Jackson;
- error context lebih jelas;
- bisa bedakan API input error vs event DLQ error;
- log sanitization bisa dilakukan;
- migration Jackson 2 ke 3 tidak bocor ke layer atas.

### 23.1 Exception Taxonomy

```text
JsonSerializationException
  gagal object -> JSON

JsonDeserializationException
  gagal JSON -> object

PayloadContractException
  JSON valid tapi tidak sesuai kontrak

PayloadVersionException
  versi payload tidak didukung

PayloadSecurityException
  payload berisiko / terlalu besar / unsafe type
```

---

## 24. Payload Size, Depth, and Safety

ObjectMapper sering dipakai untuk memproses input tidak terpercaya.

Risiko:

- payload terlalu besar;
- object graph terlalu dalam;
- array terlalu panjang;
- string sangat panjang;
- recursive structure;
- polymorphic type abuse;
- memory pressure;
- slow parsing.

### 24.1 Jangan Mengandalkan ObjectMapper Saja

Gunakan kombinasi:

- HTTP request size limit;
- API gateway limit;
- servlet container limit;
- message broker max payload;
- streaming parser untuk payload besar;
- validation setelah binding;
- timeouts;
- DLQ policy.

### 24.2 Large Payload Pattern

Jika payload berupa array besar:

```json
[
  { "id": "1" },
  { "id": "2" },
  ... millions
]
```

Jangan selalu bind ke:

```java
List<Item> items = mapper.readValue(json, new TypeReference<List<Item>>() {});
```

Untuk data sangat besar, pertimbangkan streaming:

```java
try (JsonParser parser = mapper.getFactory().createParser(inputStream)) {
    if (parser.nextToken() != JsonToken.START_ARRAY) {
        throw new IllegalArgumentException("Expected array");
    }

    ObjectReader itemReader = mapper.readerFor(Item.class);

    while (parser.nextToken() == JsonToken.START_OBJECT) {
        Item item = itemReader.readValue(parser);
        process(item);
    }
}
```

Ini menghindari load seluruh array ke memory.

---

## 25. Serialization untuk Log dan Audit: Jangan Pakai Mapper API Sembarangan

Audit/log bukan response API.

Contoh bahaya:

```java
log.info("Request payload={}", objectMapper.writeValueAsString(request));
```

Risiko:

- password/token bocor;
- NRIC/NIK/email/phone bocor;
- internal field bocor;
- object graph besar;
- lazy loading trigger;
- exception saat logging mengganggu flow;
- recursive reference.

### 25.1 Audit Mapper Terpisah

Gunakan mapper audit dengan:

- serializer masking;
- depth control;
- field allowlist;
- include null jika dibutuhkan;
- stable schema;
- no lazy proxy expansion;
- exception-safe behavior.

Contoh wrapper:

```java
public final class SafeAuditJsonWriter {
    private final ObjectWriter writer;

    public SafeAuditJsonWriter(ObjectMapper auditMapper) {
        this.writer = auditMapper.writer();
    }

    public String write(Object value) {
        try {
            return writer.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            return "{\"auditSerializationError\":true}";
        }
    }
}
```

Logging tidak boleh membuat business operation gagal kecuali audit mandatory secara regulasi dan sudah didesain sebagai transactional requirement.

---

## 26. ObjectMapper dan JPA Entity: Kombinasi Berbahaya

Jangan serialize JPA entity langsung untuk API.

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable String id) {
    return repository.findById(id).orElseThrow();
}
```

Masalah:

- lazy loading;
- bidirectional cycle;
- internal field bocor;
- audit field bocor;
- entity shape menjadi API contract;
- refactoring persistence menjadi breaking API;
- N+1 query saat serialization;
- Hibernate proxy issue.

ObjectMapper bisa dikonfigurasi untuk menghadapi sebagian masalah, tetapi akar masalahnya tetap desain boundary.

Gunakan DTO:

```java
@GetMapping("/cases/{id}")
public CaseResponse getCase(@PathVariable String id) {
    Case caseAggregate = service.getCase(id);
    return mapper.toResponse(caseAggregate);
}
```

---

## 27. Polymorphic Deserialization: Jangan Aktifkan Default Typing Sembarangan

Polymorphic JSON butuh type discriminator.

Contoh aman konseptual:

```json
{
  "type": "CARD",
  "cardNumberMasked": "****1111"
}
```

Model:

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
    @JsonSubTypes.Type(value = CardPayment.class, name = "CARD"),
    @JsonSubTypes.Type(value = BankTransferPayment.class, name = "BANK_TRANSFER")
})
public sealed interface Payment permits CardPayment, BankTransferPayment {
}
```

Jangan mengizinkan payload menentukan class Java arbitrary.

Dangerous mental model:

```json
{
  "@class": "some.internal.ClassName",
  ...
}
```

Itu membuat kontrak JSON tergantung nama class internal dan memperbesar attack surface.

Rule:

```text
Use explicit logical discriminator.
Do not expose Java class names as external contract.
Avoid unsafe default typing for untrusted payloads.
```

---

## 28. ObjectMapper sebagai Dependency: Jangan Static Global Tanpa Governance

Static mapper:

```java
public final class JsonUtils {
    public static final ObjectMapper MAPPER = new ObjectMapper();
}
```

Tidak selalu salah, tetapi sering menjadi tempat sampah.

Masalah:

- sulit test override;
- sulit punya multiple profiles;
- sulit dependency injection;
- konfigurasi tersebar;
- lifecycle tidak jelas;
- kode domain tergantung Jackson;
- migration sulit.

Lebih baik di aplikasi enterprise:

```text
Infrastructure config owns ObjectMapper.
Application services depend on codec/mapper interface when possible.
Domain layer does not depend on ObjectMapper.
```

---

## 29. Design Pattern: JsonCodec Interface

Agar layer atas tidak tergantung Jackson langsung:

```java
public interface JsonCodec<T> {
    String encode(T value);
    T decode(String json);
}
```

Implementation:

```java
public final class JacksonJsonCodec<T> implements JsonCodec<T> {
    private final ObjectReader reader;
    private final ObjectWriter writer;

    public JacksonJsonCodec(ObjectMapper mapper, Class<T> type) {
        this.reader = mapper.readerFor(type);
        this.writer = mapper.writerFor(type);
    }

    @Override
    public String encode(T value) {
        try {
            return writer.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new JsonSerializationException("Failed to encode " + value.getClass().getSimpleName(), e);
        }
    }

    @Override
    public T decode(String json) {
        try {
            return reader.readValue(json);
        } catch (IOException e) {
            throw new JsonDeserializationException("Failed to decode JSON", e);
        }
    }
}
```

Untuk generic type:

```java
public final class JacksonListCodec<T> {
    private final ObjectReader reader;
    private final ObjectWriter writer;

    public JacksonListCodec(ObjectMapper mapper, Class<T> elementType) {
        JavaType listType = mapper.getTypeFactory()
                .constructCollectionType(List.class, elementType);
        this.reader = mapper.readerFor(listType);
        this.writer = mapper.writerFor(listType);
    }
}
```

---

## 30. Testing ObjectMapper Configuration

Jangan hanya test mapper business. Test konfigurasi mapper juga.

### 30.1 Test Date Format

```java
@Test
void serializesLocalDateTimeAsIsoString() throws Exception {
    ObjectMapper mapper = ObjectMapperProfiles.apiStrict();

    var dto = new CreatedResponse(LocalDateTime.of(2026, 6, 17, 10, 30));

    String json = mapper.writeValueAsString(dto);

    assertThat(json).contains("\"createdAt\":\"2026-06-17T10:30:00\"");
}
```

### 30.2 Test Unknown Field Strictness

```java
@Test
void strictApiMapperRejectsUnknownFields() {
    ObjectMapper mapper = ObjectMapperProfiles.apiStrict();

    String json = """
        {
          "name": "Fajar",
          "unknown": "value"
        }
        """;

    assertThatThrownBy(() -> mapper.readValue(json, CreateUserRequest.class))
            .isInstanceOf(UnrecognizedPropertyException.class);
}
```

Java 8 string version:

```java
String json = "{\n" +
        "  \"name\": \"Fajar\",\n" +
        "  \"unknown\": \"value\"\n" +
        "}";
```

### 30.3 Test Event Tolerant Reader

```java
@Test
void eventMapperIgnoresFutureFields() throws Exception {
    ObjectMapper mapper = ObjectMapperProfiles.eventStable();

    String json = """
        {
          "eventId": "E-001",
          "caseId": "C-001",
          "futureField": "future-value"
        }
        """;

    CaseEvent event = mapper.readValue(json, CaseEvent.class);

    assertThat(event.eventId()).isEqualTo("E-001");
}
```

### 30.4 Test Null Inclusion

```java
@Test
void auditMapperIncludesNulls() throws Exception {
    ObjectMapper mapper = ObjectMapperProfiles.auditSafe();

    AuditSnapshot snapshot = new AuditSnapshot("C-001", null);

    String json = mapper.writeValueAsString(snapshot);

    assertThat(json).contains("\"remarks\":null");
}
```

---

## 31. Golden Payload Tests

Untuk public/event contract, gunakan golden payload.

```text
src/test/resources/contracts/case-submitted-event.v1.json
src/test/resources/contracts/case-approved-event.v1.json
src/test/resources/contracts/create-case-request.valid.json
src/test/resources/contracts/create-case-request.unknown-field.json
```

Test:

```java
@Test
void caseSubmittedEventMatchesGoldenPayload() throws Exception {
    CaseSubmittedEvent event = new CaseSubmittedEvent(
            "E-001",
            "C-001",
            Instant.parse("2026-06-17T03:30:00Z")
    );

    String actual = eventWriter.writeValueAsString(event);
    String expected = Files.readString(Path.of("src/test/resources/contracts/case-submitted-event.v1.json"));

    assertThatJson(actual).isEqualTo(expected);
}
```

Golden payload memastikan konfigurasi ObjectMapper tidak berubah diam-diam.

---

## 32. ObjectMapper dan Build/Dependency Governance

Mapping behavior bisa berubah karena dependency upgrade.

Governance minimal:

- lock dependency version;
- baca release notes sebelum upgrade major/minor besar;
- jalankan contract tests;
- jalankan negative deserialization tests;
- cek custom serializer/deserializer;
- cek module registration;
- cek Spring Boot auto-configuration change;
- cek package rename jika migrasi Jackson 3;
- cek ObjectMapper feature default berubah atau tidak.

### 32.1 Dependency Scope

Untuk Maven:

```xml
<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
</dependency>

<dependency>
    <groupId>com.fasterxml.jackson.datatype</groupId>
    <artifactId>jackson-datatype-jsr310</artifactId>
</dependency>

<dependency>
    <groupId>com.fasterxml.jackson.datatype</groupId>
    <artifactId>jackson-datatype-jdk8</artifactId>
</dependency>

<dependency>
    <groupId>com.fasterxml.jackson.module</groupId>
    <artifactId>jackson-module-parameter-names</artifactId>
</dependency>
```

Versi sebaiknya dikelola oleh BOM atau parent platform seperti Spring Boot dependency management, kecuali ada alasan override.

---

## 33. Jackson 2 ke Jackson 3: Migration Awareness

Jackson 3 adalah major release dan tidak sepenuhnya API-compatible dengan Jackson 2.

Implikasi desain:

- jangan sebar import Jackson ke domain layer;
- bungkus codec penting dengan interface;
- minimalkan custom serializer/deserializer yang terlalu bergantung internal API;
- test semua profile mapper;
- gunakan golden payload;
- hindari ad hoc ObjectMapper;
- dokumentasikan feature yang dipakai;
- jangan andalkan default yang tidak diketahui.

### 33.1 Migration Readiness Checklist

```text
[ ] Semua ObjectMapper dibuat di central config/factory
[ ] Tidak ada `new ObjectMapper()` liar di business code
[ ] Tidak ada mutation mapper setelah runtime start
[ ] Ada test untuk strictness unknown field
[ ] Ada test untuk date/time format
[ ] Ada test untuk enum format
[ ] Ada golden payload untuk public/event contract
[ ] Custom serializer/deserializer terisolasi dalam module
[ ] Domain layer tidak depend pada ObjectMapper
[ ] convertValue tidak dipakai untuk state-changing domain mapping
[ ] Multiple mapper profile terdokumentasi
[ ] Spring HTTP mapper behavior ditest
```

---

## 34. Practical ObjectMapper Blueprint untuk Enterprise Service

Struktur package:

```text
com.company.caseapp
  infrastructure
    json
      ObjectMapperProfiles.java
      BaseObjectMapperFactory.java
      CompanyJsonModule.java
      CompanyAuditJsonModule.java
      JsonSerializationException.java
      JsonDeserializationException.java
      codec
        CaseEventJsonCodec.java
        AuditJsonWriter.java
```

### 34.1 Base Factory

```java
public final class BaseObjectMapperFactory {
    private BaseObjectMapperFactory() {}

    public static ObjectMapper createBaseMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.registerModule(new Jdk8Module());
        mapper.registerModule(new ParameterNamesModule());
        mapper.registerModule(new CompanyJsonModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return mapper;
    }
}
```

### 34.2 API Mapper

```java
public static ObjectMapper createApiMapper() {
    ObjectMapper mapper = BaseObjectMapperFactory.createBaseMapper();
    mapper.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    mapper.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
    mapper.enable(DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS);
    mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
    return mapper;
}
```

### 34.3 Event Mapper

```java
public static ObjectMapper createEventMapper() {
    ObjectMapper mapper = BaseObjectMapperFactory.createBaseMapper();
    mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
    return mapper;
}
```

### 34.4 Audit Mapper

```java
public static ObjectMapper createAuditMapper() {
    ObjectMapper mapper = BaseObjectMapperFactory.createBaseMapper();
    mapper.registerModule(new CompanyAuditJsonModule());
    mapper.setSerializationInclusion(JsonInclude.Include.ALWAYS);
    return mapper;
}
```

### 34.5 Spring Configuration

```java
@Configuration
class JsonConfiguration {

    @Bean
    @Primary
    ObjectMapper apiObjectMapper() {
        return ObjectMapperProfiles.createApiMapper();
    }

    @Bean
    @Qualifier("eventObjectMapper")
    ObjectMapper eventObjectMapper() {
        return ObjectMapperProfiles.createEventMapper();
    }

    @Bean
    @Qualifier("auditObjectMapper")
    ObjectMapper auditObjectMapper() {
        return ObjectMapperProfiles.createAuditMapper();
    }

    @Bean
    CaseEventJsonCodec caseEventJsonCodec(
            @Qualifier("eventObjectMapper") ObjectMapper eventObjectMapper) {
        return new CaseEventJsonCodec(eventObjectMapper);
    }

    @Bean
    AuditJsonWriter auditJsonWriter(
            @Qualifier("auditObjectMapper") ObjectMapper auditObjectMapper) {
        return new AuditJsonWriter(auditObjectMapper);
    }
}
```

---

## 35. Common Failure Scenarios

### 35.1 Failure: LocalDateTime Serialization Berbeda Antar Service

Penyebab:

- satu service register `JavaTimeModule`, service lain tidak;
- satu service disable timestamps, service lain tidak;
- satu service pakai custom date format;
- ObjectMapper dibuat manual di helper.

Pencegahan:

- central mapper factory;
- golden payload tests;
- API style guide;
- contract tests.

### 35.2 Failure: Unknown Field Diabaikan pada Command Update

Payload:

```json
{
  "caseId": "C-001",
  "approvalStatuz": "APPROVED"
}
```

Typo `approvalStatuz` diabaikan jika mapper lenient.

Akibat:

- status tidak berubah;
- client mengira sukses;
- audit membingungkan;
- bug baru terlihat terlambat.

Pencegahan:

- strict inbound mapper untuk command;
- validation required field;
- API error jelas.

### 35.3 Failure: Audit Log Membocorkan Token

Penyebab:

- audit memakai API mapper;
- DTO punya field `accessToken`;
- tidak ada masking serializer;
- log raw request.

Pencegahan:

- audit mapper terpisah;
- sensitive type wrapper;
- field allowlist;
- log sanitization.

### 35.4 Failure: Event Consumer Gagal Setelah Producer Tambah Field

Penyebab:

- event consumer memakai strict API mapper;
- `FAIL_ON_UNKNOWN_PROPERTIES` aktif;
- producer menambah additive field.

Pencegahan:

- event mapper tolerant;
- event versioning policy;
- consumer-driven compatibility test.

### 35.5 Failure: Entity Serialization Trigger N+1 Query

Penyebab:

- controller return JPA entity;
- Jackson mengakses getter lazy association;
- setiap getter trigger query.

Pencegahan:

- DTO projection;
- explicit fetch plan;
- MapStruct/manual mapping di transaction boundary;
- jangan expose entity.

---

## 36. Review Checklist untuk ObjectMapper Engineering

Gunakan checklist ini saat review PR.

### 36.1 Mapper Creation

```text
[ ] Tidak ada `new ObjectMapper()` di business code
[ ] Mapper dibuat di config/factory terpusat
[ ] Semua module diregister sebelum mapper dipakai
[ ] Tidak ada konfigurasi mapper setelah read/write pertama
[ ] Mapper profile diberi nama sesuai boundary
```

### 36.2 Serialization Contract

```text
[ ] Date/time format eksplisit
[ ] Null inclusion policy eksplisit
[ ] Naming strategy eksplisit
[ ] Enum format eksplisit jika external contract
[ ] Sensitive field tidak bocor
[ ] Entity tidak langsung diserialize untuk API
```

### 36.3 Deserialization Contract

```text
[ ] Unknown field policy sesuai boundary
[ ] Null/missing/empty semantics dipahami
[ ] Coercion tidak terlalu longgar untuk strict API
[ ] Polymorphic type aman
[ ] Error wrapping sesuai layer
```

### 36.4 Testing

```text
[ ] Ada test untuk konfigurasi mapper
[ ] Ada negative test invalid payload
[ ] Ada golden payload untuk kontrak penting
[ ] Ada test event forward compatibility jika event-driven
[ ] Ada test custom serializer/deserializer
```

### 36.5 Migration

```text
[ ] Import Jackson tidak bocor ke domain layer
[ ] Custom module terisolasi
[ ] Dependency version dikelola BOM/platform
[ ] Upgrade Jackson/Spring menjalankan contract tests
[ ] Behavior mapper terdokumentasi
```

---

## 37. Latihan Desain

### Latihan 1 — Tentukan Mapper Profile

Kamu memiliki service case management dengan boundary:

1. REST API untuk officer internal.
2. REST API untuk public user.
3. Kafka event untuk downstream reporting.
4. Audit trail snapshot.
5. Legacy XML/JSON partner integration.
6. Redis cache untuk read model.

Tentukan:

- berapa ObjectMapper yang kamu butuhkan;
- profile name;
- unknown field policy;
- null inclusion policy;
- date/time format;
- sensitive masking policy;
- apakah DTO/API/event boleh memakai mapper sama.

Jawaban senior kemungkinan tidak “satu mapper untuk semua”.

### Latihan 2 — Debug Date Format Drift

Dua endpoint mengembalikan response berikut.

Endpoint A:

```json
{
  "createdAt": "2026-06-17T10:30:00"
}
```

Endpoint B:

```json
{
  "createdAt": [2026, 6, 17, 10, 30]
}
```

Analisis:

- kemungkinan konfigurasi apa yang berbeda;
- di mana mencari penyebab;
- test apa yang perlu ditambah;
- bagaimana mencegah terjadi lagi.

### Latihan 3 — Strict vs Tolerant

Payload update case:

```json
{
  "caseId": "C-001",
  "decision": "APPROVE",
  "commments": "typo field"
}
```

Field benar seharusnya `comments`, bukan `commments`.

Pertanyaan:

- apakah mapper harus reject?
- apakah ini command atau event?
- jika public API, error seperti apa?
- jika event consumer, apakah tetap reject?

### Latihan 4 — Refactor JsonUtils

Legacy code:

```java
public final class JsonUtils {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static String toJson(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    public static <T> T fromJson(String json, Class<T> type) {
        try {
            return MAPPER.readValue(json, type);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }
}
```

Refactor menjadi:

- central mapper factory;
- typed codec;
- custom exception;
- profile-specific mapper;
- tests.

---

## 38. Kesimpulan

`ObjectMapper` adalah salah satu komponen kecil yang dampaknya besar.

Developer biasa melihatnya sebagai:

```text
JSON utility
```

Engineer senior melihatnya sebagai:

```text
contract boundary engine
```

Engineer top-tier melihatnya sebagai:

```text
governed serialization/deserialization infrastructure with explicit lifecycle, safety profile, compatibility policy, performance behavior, and migration strategy
```

Inti Part 7:

1. Jangan buat `ObjectMapper` ad hoc.
2. Konfigurasi sebelum pemakaian runtime.
3. Gunakan mapper profile per boundary jika policy berbeda.
4. Gunakan `ObjectReader`/`ObjectWriter` untuk variasi immutable.
5. Jangan gunakan `convertValue` sebagai domain mapper state-changing flow.
6. Date/time, null, unknown field, enum, coercion adalah contract decision.
7. Audit/log/cache/event/API tidak selalu boleh memakai mapper yang sama.
8. Test konfigurasi mapper dengan golden payload dan negative cases.
9. Isolasi custom serializer/deserializer dalam module.
10. Siapkan migration path untuk Jackson 2 ke Jackson 3.

---

## 39. Referensi Resmi dan Bacaan Lanjutan

- Jackson `ObjectMapper` Javadoc — thread-safety jika konfigurasi dilakukan sebelum read/write, serta peran sebagai factory untuk `ObjectReader`/`ObjectWriter`.
- FasterXML Jackson Databind Wiki — fitur Jackson dan catatan bahwa `ObjectReader`/`ObjectWriter` immutable.
- FasterXML Jackson 3 Migration Guide — panduan migrasi major version Jackson 2 ke 3.
- FasterXML Jackson 3 Release Notes — Jackson 3 sebagai major release yang tidak API-compatible penuh dengan 2.x.
- Jackson modules for Java 8 — module untuk `java.time`, JDK 8 types, dan parameter names pada Jackson 2.x.
- Spring blog: Introducing Jackson 3 support in Spring — konteks migrasi ekosistem Spring ke Jackson 3.

---

## 40. Status Seri

Progress seri:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - berikutnya
...
Part 35 - belum
```

Seri belum selesai. Bagian berikutnya adalah:

```text
Part 8 — Jackson Serialization: Shape Control, Inclusion, Naming, Formatting
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./06-jackson-mental-model-streaming-tree-model-data-binding.md">⬅️ Part 6 — Jackson Mental Model: Streaming, Tree Model, Data Binding</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./08-jackson-serialization-shape-control-inclusion-naming-formatting.md">Part 8 — Jackson Serialization: Shape Control, Inclusion, Naming, Formatting ➡️</a>
</div>
