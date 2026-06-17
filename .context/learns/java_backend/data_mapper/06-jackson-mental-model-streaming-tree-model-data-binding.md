# Part 6 — Jackson Mental Model: Streaming, Tree Model, Data Binding

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `06-jackson-mental-model-streaming-tree-model-data-binding.md`  
> Scope Java: Java 8 sampai Java 25  
> Fokus utama: membangun mental model Jackson sebagai engine transformasi JSON, bukan sekadar utilitas `ObjectMapper`.

---

## 0. Tujuan Bagian Ini

Setelah bagian sebelumnya kita membahas arsitektur mapping layer, sekarang kita masuk ke salah satu library paling penting dalam ekosistem Java enterprise: **Jackson**.

Banyak developer memakai Jackson seperti ini:

```java
UserDto dto = objectMapper.readValue(json, UserDto.class);
String json = objectMapper.writeValueAsString(dto);
```

Itu valid, tetapi belum cukup untuk level senior/architect.

Masalah nyata di production biasanya tidak muncul dari happy path seperti itu. Masalah muncul ketika:

- payload besar;
- schema berubah;
- field nullable/absent;
- enum bertambah;
- nested object terlalu dalam;
- object graph punya cycle;
- format tanggal tidak konsisten;
- API butuh backward compatibility;
- response harus masking data sensitif;
- object domain tidak boleh langsung terekspos;
- deserialization menerima field yang tidak seharusnya boleh diisi;
- mapper global berubah lalu merusak endpoint lain;
- polymorphic deserialization membuka attack surface;
- JSON parsing jadi bottleneck memory/latency.

Karena itu, tujuan bagian ini bukan hanya “cara pakai Jackson”, tetapi memahami:

1. **Jackson bekerja dalam beberapa lapisan.**
2. **Setiap lapisan punya trade-off.**
3. **Pilihan API Jackson adalah keputusan arsitektur.**
4. **`ObjectMapper` bukan magic; ia orkestrator dari parser, generator, serializer, deserializer, annotation introspection, type resolution, dan configuration.**
5. **Mapping JSON harus dipikirkan sebagai contract boundary.**

---

## 1. Jackson dalam Satu Kalimat

Jackson adalah library Java untuk membaca, menulis, dan mentransformasi data terstruktur, terutama JSON, melalui tiga model utama:

1. **Streaming model** — membaca/menulis token secara incremental.
2. **Tree model** — merepresentasikan JSON sebagai pohon `JsonNode`.
3. **Data binding model** — mengikat JSON ke object Java dan sebaliknya.

Secara mental:

```text
JSON bytes/chars
    |
    v
[Streaming Parser]  ---> token: START_OBJECT, FIELD_NAME, VALUE_STRING, ...
    |
    v
[Tree Model]        ---> JsonNode tree
    |
    v
[Data Binding]      ---> POJO / Record / DTO / Map / Collection
```

Namun hubungan ini bukan selalu linear. Kita bisa langsung streaming tanpa tree. Kita bisa langsung databind tanpa memegang token. Kita bisa parse ke tree lalu convert ke POJO. Kita bisa serialize POJO ke stream tanpa membuat string intermediate.

---

## 2. Tiga Level Jackson

### 2.1 Level 1 — Streaming API

Streaming API adalah level paling bawah.

Komponen utama:

```java
JsonFactory factory = new JsonFactory();

try (JsonParser parser = factory.createParser(jsonInputStream)) {
    while (parser.nextToken() != null) {
        JsonToken token = parser.currentToken();
        // handle token
    }
}
```

Dan untuk menulis:

```java
JsonFactory factory = new JsonFactory();

try (JsonGenerator generator = factory.createGenerator(outputStream)) {
    generator.writeStartObject();
    generator.writeStringField("id", "U-001");
    generator.writeStringField("name", "Fajar");
    generator.writeEndObject();
}
```

Streaming API melihat JSON sebagai urutan token.

Contoh JSON:

```json
{
  "id": "U-001",
  "name": "Fajar",
  "roles": ["ADMIN", "REVIEWER"]
}
```

Token stream-nya kira-kira:

```text
START_OBJECT
FIELD_NAME("id")
VALUE_STRING("U-001")
FIELD_NAME("name")
VALUE_STRING("Fajar")
FIELD_NAME("roles")
START_ARRAY
VALUE_STRING("ADMIN")
VALUE_STRING("REVIEWER")
END_ARRAY
END_OBJECT
```

Mental model-nya mirip membaca file besar baris demi baris, tetapi untuk struktur JSON.

Kelebihan:

- memory rendah;
- cocok untuk payload besar;
- cocok untuk array besar;
- bisa process data incremental;
- tidak perlu membangun seluruh object graph;
- paling cepat jika logic sederhana.

Kekurangan:

- kode verbose;
- raw dan imperative;
- lebih mudah salah state;
- tidak otomatis mapping ke object;
- perlu handle token, field name, nesting sendiri.

Gunakan streaming ketika:

- payload bisa sangat besar;
- ingin process item satu per satu;
- tidak perlu seluruh JSON berada di memory;
- ingin filtering/transformasi ringan;
- latency dan memory sangat kritikal;
- ingest pipeline, export, batch, audit log, event replay, data migration.

Jangan gunakan streaming untuk semua hal. Untuk API request/response normal, databind lebih maintainable.

---

### 2.2 Level 2 — Tree Model

Tree model merepresentasikan JSON sebagai pohon node.

```java
JsonNode root = objectMapper.readTree(json);

String id = root.path("id").asText();
JsonNode roles = root.path("roles");
```

Contoh struktur:

```json
{
  "id": "U-001",
  "profile": {
    "displayName": "Fajar"
  },
  "roles": ["ADMIN", "REVIEWER"]
}
```

Pohon konseptualnya:

```text
ObjectNode
├── id: TextNode("U-001")
├── profile: ObjectNode
│   └── displayName: TextNode("Fajar")
└── roles: ArrayNode
    ├── TextNode("ADMIN")
    └── TextNode("REVIEWER")
```

Tree model berada di tengah:

- lebih fleksibel daripada POJO;
- lebih terstruktur daripada raw string;
- lebih mudah daripada streaming;
- tetapi lebih mahal memory dibanding streaming.

Kelebihan:

- cocok untuk dynamic JSON;
- bisa inspect field yang tidak known at compile time;
- cocok untuk partial extraction;
- bisa mutate object tree;
- cocok untuk adapter/integration layer;
- cocok untuk schema-less payload;
- bisa bridging antara raw JSON dan typed DTO.

Kekurangan:

- kehilangan type safety;
- banyak `.asText()`, `.asInt()` yang bisa menyembunyikan error;
- mudah menghasilkan logic stringly-typed;
- memory lebih besar karena seluruh tree dibangun;
- path typo baru ketahuan runtime;
- semantic mapping tetap manual.

Gunakan tree model ketika:

- payload formatnya fleksibel/dynamic;
- hanya butuh sebagian field;
- ingin preserve unknown fields;
- ingin membuat proxy/adapter;
- ingin patch/merge JSON;
- ingin inspect metadata sebelum memilih target class;
- ingin validasi shape sebelum binding;
- butuh intermediate representation.

---

### 2.3 Level 3 — Data Binding

Data binding adalah level paling sering dipakai.

```java
UserDto dto = objectMapper.readValue(json, UserDto.class);
String jsonOut = objectMapper.writeValueAsString(dto);
```

Jackson membaca JSON dan membuat object Java berdasarkan:

- field/property;
- getter/setter;
- constructor;
- record canonical constructor;
- annotation;
- naming strategy;
- modules;
- serializers/deserializers;
- type information;
- configuration flags.

Contoh:

```java
public class UserDto {
    private String id;
    private String name;

    public UserDto() {
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
```

JSON:

```json
{
  "id": "U-001",
  "name": "Fajar"
}
```

Binding:

```java
UserDto dto = objectMapper.readValue(json, UserDto.class);
```

Kelebihan:

- produktif;
- readable;
- type-safe secara Java object;
- cocok untuk API DTO;
- cocok untuk normal request/response;
- bisa menggunakan annotation;
- mudah dikombinasikan dengan Bean Validation;
- mudah dites dengan golden payload.

Kekurangan:

- bisa menyembunyikan detail penting;
- rawan silent default;
- rawan over-posting jika DTO salah;
- rawan accidental field exposure;
- bisa memicu lazy loading jika langsung serialize entity;
- polymorphism berisiko jika tidak aman;
- konfigurasi global bisa berdampak luas;
- reflection/introspection lebih mahal dibanding generated mapper untuk object-to-object mapping.

Gunakan data binding ketika:

- format payload stabil;
- target model jelas;
- payload ukuran normal;
- butuh maintainability;
- API contract strongly typed;
- response/request DTO jelas.

---

## 3. Jackson Bukan “ObjectMapper Saja”

`ObjectMapper` sering dianggap Jackson itu sendiri. Padahal `ObjectMapper` adalah orkestrator.

Komponen mental:

```text
ObjectMapper
├── JsonFactory
│   ├── JsonParser
│   └── JsonGenerator
├── SerializerProvider
├── DeserializationContext
├── SerializerFactory
├── DeserializerFactory
├── TypeFactory
├── AnnotationIntrospector
├── VisibilityChecker
├── PropertyNamingStrategy / PropertyNamingStrategies
├── Modules
│   ├── JavaTimeModule
│   ├── Jdk8Module
│   ├── ParameterNamesModule
│   ├── KotlinModule
│   └── CustomModule
├── ObjectReader
└── ObjectWriter
```

Ketika kita menulis:

```java
UserDto dto = objectMapper.readValue(json, UserDto.class);
```

Yang sebenarnya terjadi kira-kira:

```text
1. ObjectMapper menerima input.
2. JsonFactory membuat JsonParser.
3. Parser membaca token JSON.
4. ObjectMapper menentukan target JavaType.
5. Deserializer untuk UserDto dicari/dibuat/cache.
6. Annotation dan property visibility dianalisis.
7. Field JSON dicocokkan ke property Java.
8. Nilai primitive/string/object/array dikonversi.
9. Nested object di-deserialize secara rekursif.
10. Object Java selesai dibentuk.
```

Ketika kita menulis:

```java
String json = objectMapper.writeValueAsString(dto);
```

Yang terjadi kira-kira:

```text
1. ObjectMapper menerima object.
2. Type runtime dianalisis.
3. Serializer dicari/dibuat/cache.
4. Property yang visible ditentukan.
5. Annotation diperiksa.
6. JsonGenerator menulis token output.
7. Field object diubah menjadi token JSON.
8. Nested object diserialisasi secara rekursif.
9. Output selesai sebagai String/byte/stream.
```

Jadi, `ObjectMapper` adalah facade yang nyaman. Tetapi masalah production biasanya butuh kita paham lapisan di bawahnya.

---

## 4. Perbandingan Tiga Model

| Aspek | Streaming | Tree Model | Data Binding |
|---|---:|---:|---:|
| Abstraksi | Token | Node tree | Java object |
| Type safety | Rendah | Rendah-sedang | Tinggi |
| Memory | Paling rendah | Sedang-tinggi | Sedang-tinggi |
| Verbosity | Tinggi | Sedang | Rendah |
| Cocok untuk payload besar | Sangat cocok | Kurang cocok | Tergantung |
| Cocok untuk API DTO | Jarang | Kadang | Sangat cocok |
| Cocok untuk dynamic JSON | Bisa, tapi verbose | Sangat cocok | Sulit |
| Cocok untuk contract kuat | Bisa | Sedang | Sangat cocok |
| Debuggability | Sulit | Baik | Baik |
| Failure visibility | Manual | Manual | Bergantung config |
| Performance control | Tinggi | Sedang | Sedang |

Rule of thumb:

```text
Jika payload besar dan process incremental -> Streaming.
Jika shape dynamic/partial/unknown -> Tree Model.
Jika schema jelas dan DTO kuat -> Data Binding.
```

---

## 5. Mental Model: JSON Itu Bukan Object Java

Kesalahan umum: menganggap JSON sama dengan object Java.

Padahal JSON hanya punya konsep:

- object;
- array;
- string;
- number;
- boolean;
- null.

Java punya:

- class;
- interface;
- record;
- enum;
- sealed class;
- generic;
- primitive;
- wrapper;
- `BigDecimal`;
- `LocalDate`;
- `Instant`;
- `Optional`;
- collection;
- map;
- constructor;
- visibility;
- inheritance;
- method;
- annotation;
- identity;
- reference cycle.

Mapping antara JSON dan Java bukan 1:1. Ia butuh keputusan.

Contoh:

```json
{
  "amount": 1000.00
}
```

Apa type Java-nya?

```java
double amount;
BigDecimal amount;
Money amount;
String amount;
Long amountInCents;
```

Semua mungkin. Tetapi semantic-nya berbeda.

Contoh lain:

```json
{
  "approved": null
}
```

Maknanya apa?

1. belum diisi;
2. eksplisit dikosongkan;
3. tidak berlaku;
4. false;
5. error dari client;
6. data migration legacy;
7. unknown.

Jackson bisa membaca `null`, tetapi tidak bisa secara otomatis tahu semantic domain-nya.

---

## 6. Token-Level Thinking

Senior engineer perlu sesekali berpikir di level token karena itu menjelaskan banyak edge case.

Contoh JSON:

```json
{
  "active": "false"
}
```

Token untuk `active` adalah `VALUE_STRING`, bukan `VALUE_FALSE`.

Jika target Java:

```java
boolean active;
```

Pertanyaannya:

- apakah string `"false"` boleh dipaksa menjadi boolean `false`?
- apakah harus fail?
- apakah hanya external legacy API yang boleh lenient?
- apakah public API internal harus strict?
- apakah `""` boleh jadi false?
- apakah `"0"` boleh jadi false?

Jika kita tidak sadar token-level, kita akan mengira “Jackson error/random”. Padahal itu keputusan coercion.

Contoh:

```json
{
  "count": "10"
}
```

Target:

```java
int count;
```

Coercion dari string ke number mungkin terjadi tergantung konfigurasi.

Top-level mental model:

```text
JSON token type != Java target type.
Deserialization = token + target type + config + annotation + module + custom deserializer.
```

---

## 7. Tree-Level Thinking

Tree model membantu ketika kita tidak ingin langsung percaya payload untuk diikat ke class.

Contoh use case:

```json
{
  "eventType": "USER_REGISTERED",
  "payload": {
    "userId": "U-001",
    "email": "fajar@example.com"
  }
}
```

Kita bisa baca dulu metadata:

```java
JsonNode root = objectMapper.readTree(json);
String eventType = root.path("eventType").asText();

JsonNode payload = root.path("payload");

switch (eventType) {
    case "USER_REGISTERED" -> {
        UserRegisteredPayload p =
            objectMapper.treeToValue(payload, UserRegisteredPayload.class);
    }
    case "USER_DEACTIVATED" -> {
        UserDeactivatedPayload p =
            objectMapper.treeToValue(payload, UserDeactivatedPayload.class);
    }
    default -> throw new IllegalArgumentException("Unsupported eventType: " + eventType);
}
```

Ini pattern penting untuk:

- event envelope;
- webhook;
- external integration;
- polymorphic payload tanpa unsafe default typing;
- versioned payload;
- audit replay;
- partial inspection.

Daripada langsung menggunakan global polymorphic deserialization, tree model sering lebih aman dan eksplisit.

---

## 8. Data-Binding-Level Thinking

Data binding bukan sekadar mencocokkan nama field.

Contoh DTO:

```java
public record CreateUserRequest(
    String username,
    String email,
    boolean admin
) {
}
```

JSON:

```json
{
  "username": "fajar",
  "email": "fajar@example.com",
  "admin": true
}
```

Secara teknis Jackson bisa binding. Tapi secara security, pertanyaan penting:

- apakah client boleh mengirim `admin`?
- apakah field itu seharusnya di request DTO?
- apakah `admin` harus ditentukan server side?
- apakah ini mass assignment risk?

Mapper yang “berhasil” belum tentu aman.

Contoh yang lebih aman:

```java
public record CreateUserRequest(
    String username,
    String email
) {
}
```

Lalu role/admin ditentukan di application service berdasarkan authorization context.

Mental model:

```text
Deserialization success != business correctness.
DTO shape is an authorization and contract decision.
```

---

## 9. ObjectMapper Lifecycle

### 9.1 Jangan Membuat ObjectMapper Baru Setiap Request

Anti-pattern:

```java
public UserDto parse(String json) throws JsonProcessingException {
    ObjectMapper mapper = new ObjectMapper();
    return mapper.readValue(json, UserDto.class);
}
```

Masalah:

- konfigurasi tidak konsisten;
- module mungkin lupa diregister;
- serializer/deserializer cache tidak efektif;
- overhead object creation;
- sulit governance;
- sulit audit konfigurasi.

Lebih baik:

```java
public final class JsonCodec {
    private final ObjectMapper objectMapper;

    public JsonCodec(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public UserDto parseUser(String json) throws JsonProcessingException {
        return objectMapper.readValue(json, UserDto.class);
    }
}
```

Atau di framework seperti Spring:

```java
@Service
public class UserJsonCodec {
    private final ObjectMapper objectMapper;

    public UserJsonCodec(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }
}
```

### 9.2 ObjectMapper Harus Dianggap Configuration Object

`ObjectMapper` sebaiknya dikonfigurasi saat startup, lalu dipakai ulang.

Jangan mengubah konfigurasi global di tengah runtime berdasarkan request.

Anti-pattern:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
return objectMapper.readValue(json, SomeDto.class);
```

Kenapa berbahaya?

- objectMapper shared;
- request lain bisa terkena efek;
- behavior non-deterministic;
- sulit debug;
- race configuration;
- contract endpoint lain bisa berubah.

Gunakan `ObjectReader` atau `ObjectWriter` untuk variasi operasi.

---

## 10. ObjectReader dan ObjectWriter

`ObjectReader` dan `ObjectWriter` merepresentasikan operasi read/write yang lebih spesifik.

Contoh:

```java
private final ObjectReader userReader;
private final ObjectWriter userWriter;

public UserJsonCodec(ObjectMapper mapper) {
    this.userReader = mapper.readerFor(UserDto.class);
    this.userWriter = mapper.writerFor(UserDto.class);
}

public UserDto read(String json) throws IOException {
    return userReader.readValue(json);
}

public String write(UserDto dto) throws JsonProcessingException {
    return userWriter.writeValueAsString(dto);
}
```

Keuntungan:

- konfigurasi operation-specific;
- reusable;
- lebih jelas target type;
- lebih aman daripada mutate mapper global;
- bisa dipakai untuk strict/lenient profile.

Contoh strict reader:

```java
ObjectReader strictReader = mapper
    .readerFor(CreateUserRequest.class)
    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
```

Contoh writer dengan pretty print untuk debug/export:

```java
ObjectWriter prettyWriter = mapper
    .writerFor(UserDto.class)
    .withDefaultPrettyPrinter();
```

Mental model:

```text
ObjectMapper = configured factory/facade.
ObjectReader = immutable read plan.
ObjectWriter = immutable write plan.
```

---

## 11. JavaType dan Type Erasure

Masalah klasik:

```java
List<UserDto> users = objectMapper.readValue(json, List.class);
```

Hasilnya bukan `List<UserDto>`, tetapi biasanya `List<LinkedHashMap>`.

Karena runtime Java tidak tahu generic `UserDto` dari `List.class`.

Solusi 1:

```java
List<UserDto> users = objectMapper.readValue(
    json,
    new TypeReference<List<UserDto>>() {}
);
```

Solusi 2:

```java
JavaType type = objectMapper.getTypeFactory()
    .constructCollectionType(List.class, UserDto.class);

List<UserDto> users = objectMapper.readValue(json, type);
```

Untuk nested generic:

```java
JavaType userListType = mapper.getTypeFactory()
    .constructCollectionType(List.class, UserDto.class);

JavaType responseType = mapper.getTypeFactory()
    .constructParametricType(ApiResponse.class, userListType);
```

Mental model:

```text
Class<T> cukup untuk type non-generic.
TypeReference/JavaType dibutuhkan untuk generic/nested generic.
```

Ini sangat penting untuk:

- paginated response;
- API wrapper;
- event envelope;
- cache value;
- message broker payload;
- generic client;
- test helper.

---

## 12. Annotation Introspection

Jackson membaca annotation untuk menentukan behavior.

Contoh:

```java
public record UserResponse(
    @JsonProperty("user_id")
    String userId,

    @JsonInclude(JsonInclude.Include.NON_NULL)
    String displayName
) {
}
```

Annotation bukan sekadar dekorasi. Ia bagian dari contract.

Jackson dapat membaca:

- annotation Jackson;
- annotation JDK tertentu;
- annotation module tertentu;
- constructor parameter metadata;
- record component;
- visibility;
- naming strategy.

Urutan mental saat Jackson mencari property:

```text
1. Apakah ada annotation eksplisit?
2. Apakah property visible berdasarkan getter/setter/field/constructor?
3. Apakah naming strategy mengubah nama?
4. Apakah ada ignore/include rule?
5. Apakah ada custom serializer/deserializer?
6. Apakah ada module yang mengubah behavior?
```

Masalah muncul ketika annotation tersebar tanpa policy.

Contoh buruk:

```java
@Entity
@JsonIgnoreProperties({"hibernateLazyInitializer", "handler"})
public class UserEntity {
    // ...
}
```

Ini sering menjadi tanda entity langsung diserialisasi ke API. Lebih aman gunakan DTO.

---

## 13. Visibility: Field vs Getter vs Constructor

Jackson bisa menemukan property melalui beberapa cara.

### 13.1 Setter-Based Binding

```java
public class UserDto {
    private String id;

    public UserDto() {}

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }
}
```

### 13.2 Field-Based Binding

```java
public class UserDto {
    public String id;
}
```

Atau dengan visibility configuration/annotation.

### 13.3 Constructor-Based Binding

```java
public class UserDto {
    private final String id;

    @JsonCreator
    public UserDto(@JsonProperty("id") String id) {
        this.id = id;
    }

    public String getId() {
        return id;
    }
}
```

### 13.4 Record Binding

```java
public record UserDto(String id, String name) {
}
```

Records lebih natural untuk immutable DTO di Java modern.

Namun, untuk Java 8 legacy, kita biasanya memakai:

- no-args constructor + setters;
- all-args constructor dengan `@JsonCreator`;
- Lombok `@Value`/`@Builder` dengan konfigurasi tambahan.

Mental model:

```text
Jackson tidak membaca “object” secara abstrak.
Jackson membaca property model yang dibangun dari visibility + annotation + constructor metadata.
```

---

## 14. Module System Jackson

Module memperluas kemampuan Jackson.

Contoh module umum:

- Java Time module untuk `LocalDate`, `Instant`, `OffsetDateTime`;
- JDK8 module untuk `Optional`;
- Parameter Names module untuk constructor parameter name;
- custom module untuk serializer/deserializer sendiri;
- datatype modules untuk format tertentu.

Contoh:

```java
ObjectMapper mapper = new ObjectMapper();
mapper.registerModule(new JavaTimeModule());
mapper.registerModule(new Jdk8Module());
mapper.registerModule(new ParameterNamesModule());
```

Di aplikasi modern, framework seperti Spring Boot biasanya melakukan auto-configuration, tetapi tetap penting memahami module mana yang aktif.

Kenapa?

Karena behavior ini bisa berbeda antar service:

```java
public record EventDto(
    Instant occurredAt
) {
}
```

Tanpa JavaTimeModule, behavior bisa error atau tidak sesuai harapan.

Dengan JavaTimeModule, format bisa tergantung feature:

```java
mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
```

Mental model:

```text
ObjectMapper behavior = base mapper + modules + features + annotations + target type.
```

Jika dua service punya konfigurasi mapper berbeda, contract yang sama bisa menghasilkan JSON berbeda.

---

## 15. Feature Flags: Strict vs Lenient

Jackson punya banyak feature. Yang paling penting secara mental adalah membedakan **strict boundary** dan **lenient boundary**.

### 15.1 Strict Boundary

Cocok untuk:

- public/internal API yang dikontrol;
- command request;
- security-sensitive operation;
- admin action;
- money/payment/authorization;
- regulatory workflow.

Contoh:

```java
ObjectMapper strictMapper = JsonMapper.builder()
    .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
    .build();
```

Tujuannya:

- reject field tak dikenal;
- reject coercion berbahaya;
- fail fast;
- tidak menerima payload ambigu.

### 15.2 Lenient Boundary

Cocok untuk:

- legacy external integration;
- webhook pihak ketiga;
- log ingestion;
- data migration;
- partner API yang tidak stabil;
- tolerant reader untuk event lama.

Contoh:

```java
ObjectMapper lenientMapper = JsonMapper.builder()
    .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    .build();
```

Tetapi lenient bukan berarti asal terima. Lenient harus tetap punya policy:

- unknown fields boleh dipreserve atau diabaikan?
- coercion mana yang boleh?
- field wajib tetap wajib?
- error dicatat ke audit?
- legacy alias dipetakan ke field canonical?
- data aneh direject atau masuk quarantine?

Mental model:

```text
Strictness is not global preference.
Strictness is boundary-specific policy.
```

---

## 16. Null, Missing, Empty: Tiga Hal Berbeda

JSON ini berbeda:

### Missing

```json
{
  "name": "Fajar"
}
```

`email` tidak ada.

### Null

```json
{
  "name": "Fajar",
  "email": null
}
```

`email` eksplisit null.

### Empty String

```json
{
  "name": "Fajar",
  "email": ""
}
```

`email` string kosong.

Dalam domain, ketiganya bisa punya makna berbeda:

| Shape | Kemungkinan makna |
|---|---|
| missing | tidak dikirim, tidak berubah, versi lama |
| null | clear value, unknown, eksplisit kosong |
| empty string | input kosong, legacy encoding, valid string kosong |

Untuk create request:

```text
missing email -> invalid
null email -> invalid
empty email -> invalid
```

Untuk patch request:

```text
missing email -> jangan ubah
null email -> clear email atau invalid, tergantung policy
empty email -> invalid atau normalize ke null, tergantung policy
```

Jackson bisa membantu membedakan, tetapi desain DTO harus mendukung.

Contoh naive PATCH DTO:

```java
public record UpdateUserRequest(
    String email
) {
}
```

Masalah: kita tidak tahu apakah `email` missing atau null, karena keduanya bisa menjadi `null`.

Strategi:

1. gunakan `JsonNode` untuk patch;
2. gunakan wrapper `Optional` dengan hati-hati;
3. gunakan custom `JsonNullable`;
4. gunakan JSON Merge Patch;
5. gunakan command model eksplisit.

Mental model:

```text
Java null tidak cukup untuk merepresentasikan semua state input JSON.
```

---

## 17. ConvertValue: Berguna tapi Berbahaya Jika Disalahgunakan

Jackson punya:

```java
TargetDto target = mapper.convertValue(source, TargetDto.class);
```

Ini sering dipakai untuk object-to-object mapping.

Masalahnya:

- melewati JSON-like conversion model;
- bisa terlihat seperti MapStruct/manual mapper;
- bisa menyembunyikan field mismatch;
- tidak sejelas semantic mapping;
- bisa bergantung pada annotation serialization;
- sulit membedakan “mapping policy” dengan “serialization policy”.

Contoh:

```java
UserResponse response = mapper.convertValue(userEntity, UserResponse.class);
```

Ini bisa berbahaya jika:

- entity punya field internal;
- lazy relation ikut terbaca;
- annotation entity memengaruhi API;
- field dengan nama sama punya makna berbeda;
- error baru muncul runtime.

`convertValue` berguna untuk:

- test helper;
- quick conversion Map/JsonNode ke DTO;
- dynamic config;
- adapter internal yang shape-nya sama;
- prototype;
- migration utility.

Tetapi untuk domain/API mapping utama, gunakan:

- manual mapper;
- MapStruct;
- explicit assembler.

Rule:

```text
Jackson is primarily JSON/data-format binding.
Do not turn ObjectMapper into your domain mapper by default.
```

---

## 18. readTree + treeToValue Pattern

Pattern yang sering kuat:

```java
JsonNode root = mapper.readTree(json);

String type = root.path("type").asText();
JsonNode payload = root.path("payload");

switch (type) {
    case "A" -> mapper.treeToValue(payload, PayloadA.class);
    case "B" -> mapper.treeToValue(payload, PayloadB.class);
    default -> throw new UnsupportedOperationException(type);
}
```

Kapan cocok?

- event envelope;
- polymorphic payload;
- external webhook;
- import file;
- message queue;
- integration adapter;
- versioned API;
- audit replay.

Keuntungan:

- metadata dibaca eksplisit;
- target class dipilih sendiri;
- tidak perlu unsafe global polymorphism;
- error bisa diberi konteks;
- unknown event bisa masuk dead-letter.

Kelemahan:

- kode lebih banyak;
- perlu maintain registry;
- schema harus jelas;
- testing harus kuat.

Versi lebih rapi:

```java
public interface EventPayload {
}

public final class EventPayloadRegistry {
    private final Map<String, Class<? extends EventPayload>> types = Map.of(
        "USER_REGISTERED", UserRegisteredPayload.class,
        "USER_DEACTIVATED", UserDeactivatedPayload.class
    );

    public Class<? extends EventPayload> resolve(String eventType) {
        Class<? extends EventPayload> type = types.get(eventType);
        if (type == null) {
            throw new IllegalArgumentException("Unsupported event type: " + eventType);
        }
        return type;
    }
}
```

---

## 19. Streaming Large Arrays

Misalnya payload:

```json
[
  { "id": "1", "amount": 100 },
  { "id": "2", "amount": 200 },
  ...
]
```

Jika kita lakukan:

```java
List<TransactionDto> all = mapper.readValue(
    inputStream,
    new TypeReference<List<TransactionDto>>() {}
);
```

Seluruh list masuk memory.

Untuk file sangat besar, ini berbahaya.

Streaming dengan `MappingIterator`:

```java
ObjectReader reader = mapper.readerFor(TransactionDto.class);

try (MappingIterator<TransactionDto> iterator =
         reader.readValues(inputStream)) {

    while (iterator.hasNext()) {
        TransactionDto item = iterator.next();
        process(item);
    }
}
```

Namun format input harus sesuai. Untuk array JSON besar, sering digunakan:

```java
JsonParser parser = mapper.getFactory().createParser(inputStream);

if (parser.nextToken() != JsonToken.START_ARRAY) {
    throw new IllegalArgumentException("Expected array");
}

ObjectReader itemReader = mapper.readerFor(TransactionDto.class);

while (parser.nextToken() != JsonToken.END_ARRAY) {
    TransactionDto item = itemReader.readValue(parser);
    process(item);
}
```

Mental model:

```text
Data binding bisa digunakan per item di atas streaming parser.
Streaming dan data binding bukan musuh; bisa dikombinasikan.
```

Ini pattern penting untuk:

- import CSV/JSON besar;
- export besar;
- ETL;
- event replay;
- audit trail;
- migration;
- data warehouse feed.

---

## 20. Serialization ke Stream, Bukan String

Anti-pattern untuk payload besar:

```java
String json = mapper.writeValueAsString(bigObject);
outputStream.write(json.getBytes(StandardCharsets.UTF_8));
```

Masalah:

- membuat string besar di memory;
- membuat byte array tambahan;
- double memory;
- pressure ke GC.

Lebih baik:

```java
mapper.writeValue(outputStream, bigObject);
```

Atau streaming array:

```java
try (JsonGenerator g = mapper.getFactory().createGenerator(outputStream)) {
    g.writeStartArray();

    for (TransactionDto item : transactions) {
        mapper.writeValue(g, item);
    }

    g.writeEndArray();
}
```

Mental model:

```text
String JSON adalah convenience.
Stream JSON adalah production-grade untuk payload besar.
```

---

## 21. Object Graph Problem

Java object bisa punya reference cycle.

Contoh:

```java
class User {
    public String id;
    public List<Order> orders;
}

class Order {
    public String id;
    public User user;
}
```

Serialization naive:

```text
User -> orders -> Order -> user -> orders -> ...
```

Hasil:

- infinite recursion;
- stack overflow;
- huge payload;
- lazy loading storm;
- accidental data exposure.

Solusi bukan sekadar annotation.

Pilihan:

1. gunakan DTO yang memutus cycle;
2. flatten response;
3. gunakan id reference;
4. gunakan projection;
5. desain aggregate boundary;
6. pakai annotation identity jika memang object graph serialization dibutuhkan.

Contoh DTO aman:

```java
public record UserResponse(
    String id,
    List<OrderSummaryResponse> orders
) {
}

public record OrderSummaryResponse(
    String id,
    BigDecimal total
) {
}
```

Mental model:

```text
JSON is a tree.
Java object graph can be a graph.
Tree serialization of graph requires deliberate cutting or identity strategy.
```

---

## 22. Domain Object vs DTO: Jangan Samakan

Jackson bisa serialize apapun yang visible. Itu kekuatan sekaligus bahaya.

Anti-pattern:

```java
@GetMapping("/users/{id}")
public UserEntity getUser(@PathVariable String id) {
    return userRepository.findById(id).orElseThrow();
}
```

Risiko:

- field internal terekspos;
- lazy relation error;
- relation cycle;
- API berubah saat entity berubah;
- persistence concern bocor;
- audit/security field bocor;
- performance tidak terkendali;
- backward compatibility buruk.

Lebih baik:

```java
@GetMapping("/users/{id}")
public UserResponse getUser(@PathVariable String id) {
    User user = userService.getUser(id);
    return userMapper.toResponse(user);
}
```

Jackson bekerja di boundary DTO, bukan entity domain/persistence.

Rule:

```text
ObjectMapper belongs at serialization boundary.
Domain mapping belongs in explicit mapper/assembler.
```

---

## 23. Error Surface Jackson

Jackson error bukan satu jenis.

Kategori:

### 23.1 Parse Error

JSON invalid:

```json
{ "name": "Fajar", }
```

Masalah token/syntax.

### 23.2 Shape Error

Target expect object, input array:

```json
[
  { "name": "Fajar" }
]
```

Target:

```java
UserDto user;
```

### 23.3 Type Error

```json
{ "age": "abc" }
```

Target:

```java
int age;
```

### 23.4 Unknown Field

```json
{
  "name": "Fajar",
  "unexpected": true
}
```

Tergantung strictness.

### 23.5 Missing Required Field

```json
{
  "name": "Fajar"
}
```

Target butuh email.

Jackson tidak selalu tahu field required kecuali dikonfigurasi/desain mendukung.

### 23.6 Semantic Error

```json
{
  "startDate": "2026-01-10",
  "endDate": "2026-01-01"
}
```

Secara Jackson valid. Secara domain invalid.

Mental model:

```text
Jackson catches syntax/type/shape errors.
Domain/application validation catches semantic errors.
Do not expect Jackson to enforce business invariants.
```

---

## 24. Designing Error Messages

Bad error response:

```json
{
  "error": "Cannot deserialize value of type `int` from String \"abc\""
}
```

Masalah:

- terlalu internal;
- class/package leak;
- tidak user-friendly;
- bisa expose implementation;
- sulit dipakai client.

Better external error:

```json
{
  "code": "INVALID_JSON_FIELD_TYPE",
  "message": "Request body contains invalid field type.",
  "details": [
    {
      "field": "/age",
      "expected": "number",
      "actual": "string"
    }
  ]
}
```

Internal log boleh lebih detail:

```text
correlationId=abc123 error=InvalidFormatException path=/age targetType=int value="abc"
```

Prinsip:

```text
External error: safe, stable, actionable.
Internal log: detailed, diagnostic, correlated.
```

---

## 25. JSON Pointer and Field Path

Ketika deserialization gagal, penting tahu path field.

Contoh:

```json
{
  "profile": {
    "age": "abc"
  }
}
```

Error path:

```text
/profile/age
```

Jackson exception sering punya reference path.

Kita bisa menerjemahkan ke JSON Pointer-like format.

Pseudo:

```java
private String toJsonPointer(JsonMappingException e) {
    StringBuilder path = new StringBuilder();

    for (JsonMappingException.Reference ref : e.getPath()) {
        if (ref.getFieldName() != null) {
            path.append('/').append(ref.getFieldName());
        } else if (ref.getIndex() >= 0) {
            path.append('/').append(ref.getIndex());
        }
    }

    return path.isEmpty() ? "/" : path.toString();
}
```

Ini sangat membantu untuk:

- frontend error highlighting;
- API client debugging;
- contract tests;
- support investigation;
- audit event rejection.

---

## 26. Configuration Scope: Global, Boundary, Operation

Ada tiga level konfigurasi.

### 26.1 Global Mapper

Contoh:

```java
ObjectMapper appMapper = JsonMapper.builder()
    .addModule(new JavaTimeModule())
    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    .build();
```

Untuk default umum aplikasi.

### 26.2 Boundary Mapper

Misalnya:

```java
ObjectMapper publicApiMapper;
ObjectMapper legacyPartnerMapper;
ObjectMapper internalEventMapper;
ObjectMapper auditExportMapper;
```

Cocok jika boundary punya policy berbeda.

### 26.3 Operation Reader/Writer

```java
ObjectReader strictCreateUserReader;
ObjectWriter auditPrettyWriter;
```

Cocok untuk variasi kecil.

Rule:

```text
Jangan semua perbedaan dijadikan global config.
Jangan semua boundary dipaksa memakai mapper yang sama.
```

Contoh:

- Public API harus strict unknown field.
- Legacy integration harus tolerant unknown field.
- Audit export harus include null.
- Public response mungkin exclude null.
- Internal event harus stable dan versioned.

Satu ObjectMapper global sering terlalu kasar.

---

## 27. Boundary-Specific ObjectMapper Profiles

Contoh desain:

```java
public final class JsonMappers {
    private JsonMappers() {}

    public static ObjectMapper publicApiMapper() {
        return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();
    }

    public static ObjectMapper legacyIntegrationMapper() {
        return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();
    }

    public static ObjectMapper auditMapper() {
        return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .serializationInclusion(JsonInclude.Include.ALWAYS)
            .build();
    }
}
```

Namun hati-hati. Terlalu banyak mapper juga bisa kacau.

Governance yang sehat:

| Mapper | Purpose | Strictness | Null policy | Date policy | Owner |
|---|---|---|---|---|---|
| publicApiMapper | REST API | strict | exclude null response | ISO string | API platform |
| legacyPartnerMapper | Partner inbound | lenient | preserve where needed | partner-specific | integration team |
| eventMapper | internal event | strict-ish | explicit | ISO instant | platform/event team |
| auditMapper | audit export | deterministic | include null | ISO instant | compliance/platform |

---

## 28. Date/Time: Salah Satu Sumber Bug Terbesar

Contoh JSON:

```json
{
  "createdAt": "2026-06-17T10:15:30Z"
}
```

Target Java:

```java
Instant createdAt;
```

Baik untuk event timestamp.

Contoh:

```json
{
  "birthDate": "1996-01-20"
}
```

Target:

```java
LocalDate birthDate;
```

Baik untuk tanggal tanpa timezone.

Contoh:

```json
{
  "appointmentTime": "2026-06-17T10:15:30+07:00"
}
```

Target:

```java
OffsetDateTime appointmentTime;
```

Baik jika offset penting.

Jangan asal pakai `Date`, `LocalDateTime`, atau `String`.

Mental model:

| Domain concept | Java type |
|---|---|
| moment di timeline global | `Instant` |
| tanggal kalender tanpa waktu | `LocalDate` |
| waktu lokal tanpa tanggal | `LocalTime` |
| tanggal+waktu lokal tanpa zone | `LocalDateTime` |
| tanggal+waktu dengan offset | `OffsetDateTime` |
| tanggal+waktu dengan zone rules | `ZonedDateTime` |

Jackson hanya encode/decode. Makna waktunya harus kita desain.

Danger:

```java
LocalDateTime createdAt;
```

Untuk timestamp event, ini ambigu karena tidak punya timezone/offset.

---

## 29. Number: int, long, BigDecimal, String

JSON number tidak membedakan `int`, `long`, `BigInteger`, `float`, `double`, `BigDecimal`.

Contoh:

```json
{
  "amount": 9999999999999999.99
}
```

Target:

```java
double amount;
```

Bisa kehilangan presisi.

Untuk uang:

```java
BigDecimal amount;
```

Atau lebih eksplisit:

```java
long amountInCents;
String currency;
```

Untuk identifier numeric dari external system:

```java
String externalId;
```

Karena external ID bukan angka untuk operasi matematika.

Mental model:

```text
Number-looking value is not necessarily numeric domain value.
ID, postal code, phone, account number should often be String.
Money should not be double.
```

---

## 30. Enum: Contract yang Mudah Pecah

DTO:

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
{
  "status": "SUBMITTED"
}
```

Masalah muncul ketika:

- external API kirim lowercase;
- enum baru ditambahkan;
- old client tidak kenal enum baru;
- unknown value harus tetap bisa dibaca;
- display label berbeda dari wire value.

Strategi:

### 30.1 Strict Enum

Cocok untuk command internal.

```text
Unknown enum -> reject.
```

### 30.2 Enum with UNKNOWN

Cocok untuk tolerant reader.

```java
public enum PartnerStatus {
    ACTIVE,
    INACTIVE,
    UNKNOWN
}
```

### 30.3 Stable Wire Value

```java
public enum CaseStatus {
    DRAFT("draft"),
    SUBMITTED("submitted"),
    APPROVED("approved"),
    REJECTED("rejected");

    private final String value;

    CaseStatus(String value) {
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }

    @JsonCreator
    public static CaseStatus fromValue(String value) {
        for (CaseStatus status : values()) {
            if (status.value.equals(value)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown status: " + value);
    }
}
```

Mental model:

```text
Java enum name is source code detail.
JSON enum value is contract detail.
```

---

## 31. Polymorphism: Powerful but Dangerous

Jackson mendukung polymorphic deserialization.

Contoh konsep:

```json
{
  "type": "email",
  "to": "a@example.com",
  "subject": "Hello"
}
```

Bisa di-bind ke:

```java
sealed interface NotificationCommand permits EmailCommand, SmsCommand {
}
```

Namun global/default typing yang tidak aman bisa membuka risiko security.

Lebih aman:

- gunakan discriminator eksplisit;
- whitelist subtype;
- hindari menerima arbitrary class name;
- jangan expose internal class name di JSON;
- pertimbangkan tree inspection + registry;
- pisahkan external payload model dari internal class hierarchy.

Bad idea:

```json
{
  "@class": "com.company.internal.SomeClass",
  ...
}
```

Good idea:

```json
{
  "type": "email",
  ...
}
```

Mental model:

```text
Polymorphic JSON must use stable business discriminator, not Java class identity.
```

---

## 32. Jackson 2 vs Jackson 3: Mental Migration Awareness

Dalam Java ecosystem modern, Jackson 2 masih sangat luas digunakan, tetapi Jackson 3 sudah menjadi jalur besar baru.

Hal yang perlu dipahami secara arsitektural:

- Jackson 3 adalah major version, tidak sepenuhnya API-compatible dengan Jackson 2.
- Package/group/artifact dan API tertentu berubah.
- Java baseline Jackson 3 lebih modern dibanding Jackson 2.
- Framework modern seperti Spring mulai menyediakan support Jackson 3.
- Migration harus diperlakukan sebagai platform migration, bukan sekadar bump dependency.

Strategi seri ini:

```text
Bahas konsep yang stabil lintas Jackson 2/3.
Saat ada API/version difference penting, beri catatan.
Jangan mengunci mental model ke satu versi minor.
```

Untuk project enterprise:

- inventory semua ObjectMapper customization;
- inventory custom serializers/deserializers;
- inventory modules;
- inventory annotation usage;
- inventory direct usage of internal Jackson API;
- buat golden payload tests;
- migrasi di branch/platform layer;
- jangan upgrade tanpa contract regression suite.

---

## 33. Jackson dengan Java 8 sampai Java 25

### Java 8

Umum:

- class DTO mutable;
- no-args constructor;
- getters/setters;
- `Optional`;
- `java.time` tersedia tapi butuh module;
- Lombok sering dipakai mengurangi boilerplate.

DTO style:

```java
public class UserDto {
    private String id;
    private String name;

    public UserDto() {}

    // getter/setter
}
```

### Java 11/17

Mulai lebih nyaman:

- var untuk lokal;
- better runtime baseline;
- records mulai dari Java 16;
- sealed classes mulai Java 17;
- module ecosystem lebih mature.

### Java 21/25

DTO modern:

- records;
- sealed interface untuk polymorphic model;
- pattern matching membantu handling;
- lebih natural immutable model;
- builder tetap berguna untuk object kompleks.

DTO style:

```java
public record UserDto(
    String id,
    String name
) {
}
```

Namun jangan dogmatis.

Record cocok untuk:

- immutable DTO;
- simple request/response;
- event payload;
- query projection;
- value carrier.

Class masih cocok untuk:

- framework legacy;
- mutable binding;
- partial update DTO;
- complex builder;
- backward compatibility;
- JPA entity;
- object dengan lifecycle/method lebih kompleks.

Mental model:

```text
Java version changes DTO design options.
Jackson model remains: token -> property model -> object construction.
```

---

## 34. Jackson dalam Spring Boot/Jakarta Context

Walaupun seri ini bukan seri Spring, banyak aplikasi Java enterprise memakai Jackson via framework.

Biasanya request flow:

```text
HTTP request body
    |
    v
HttpMessageConverter / JSON provider
    |
    v
ObjectMapper
    |
    v
Request DTO
    |
    v
Validation
    |
    v
Controller method
```

Response flow:

```text
Controller return DTO
    |
    v
HttpMessageConverter / JSON provider
    |
    v
ObjectMapper
    |
    v
HTTP response body
```

Implikasi:

- ObjectMapper config framework memengaruhi semua endpoint;
- annotation di DTO memengaruhi API contract;
- exception handling harus menerjemahkan Jackson error;
- validation terjadi setelah deserialization;
- request DTO harus aman sebelum masuk service;
- response DTO harus tidak expose internal field.

Common mistake:

```java
@PostMapping("/users")
public void create(@RequestBody Map<String, Object> request) {
    // manual chaos
}
```

`Map<String,Object>` boleh untuk dynamic integration, tetapi buruk untuk contract API yang jelas.

Common mistake lain:

```java
@PostMapping("/users")
public void create(@RequestBody UserEntity entity) {
    userRepository.save(entity);
}
```

Ini membuka mass assignment dan persistence leakage.

---

## 35. Jackson as Boundary Codec

Untuk top-level engineering, pikirkan Jackson sebagai **codec boundary**:

```text
External representation <-> Boundary DTO
```

Bukan:

```text
External representation <-> Domain object directly
```

Arsitektur sehat:

```text
JSON
  |
  | Jackson
  v
Request DTO
  |
  | Request mapper / command factory
  v
Command
  |
  | Application service
  v
Domain model
  |
  | Domain/entity mapper
  v
Persistence model
```

Untuk response:

```text
Domain/read model
  |
  | Mapper/projection
  v
Response DTO
  |
  | Jackson
  v
JSON
```

Jackson tidak harus tahu domain rule. Jackson harus tahu bagaimana boundary representation dibaca/ditulis.

---

## 36. Practical Decision Matrix

### 36.1 Public API Request

Gunakan:

- data binding ke request DTO;
- strict unknown fields;
- validation;
- no entity binding;
- no admin/internal fields;
- stable date/enum format.

Hindari:

- `Map<String,Object>` kecuali benar-benar dynamic;
- entity as request body;
- global lenient mapper;
- default typing.

### 36.2 Public API Response

Gunakan:

- response DTO;
- explicit field names;
- masking;
- stable enum/date format;
- include/exclude null policy jelas.

Hindari:

- entity serialization;
- lazy relation exposure;
- internal audit/security fields.

### 36.3 Legacy Partner Inbound

Gunakan:

- boundary-specific lenient mapper;
- `JsonNode` inspection bila shape tidak stabil;
- alias mapping;
- quarantine bad payload;
- raw payload preservation bila perlu audit.

Hindari:

- mencampur lenient config ke public API mapper;
- langsung bind ke domain object.

### 36.4 Large Import File

Gunakan:

- streaming parser;
- item-level data binding;
- batch processing;
- per-record error handling;
- backpressure/batching.

Hindari:

- read entire list ke memory;
- `writeValueAsString` untuk payload besar.

### 36.5 Event Envelope

Gunakan:

- read tree envelope;
- resolve event type/version;
- bind payload ke DTO spesifik;
- whitelist type;
- dead-letter unknown.

Hindari:

- class-name-based polymorphism;
- unsafe default typing.

---

## 37. Anti-Patterns

### 37.1 “One Global ObjectMapper to Rule Them All”

Satu mapper global boleh untuk default, tetapi tidak semua boundary punya policy sama.

Gejala:

- public API jadi lenient karena partner API butuh lenient;
- audit export exclude null karena response API exclude null;
- event mapper berubah karena UI perlu date format berbeda.

### 37.2 “Just Use Map”

```java
Map<String, Object> payload = mapper.readValue(json, Map.class);
```

Masalah:

- no type safety;
- nested cast chaos;
- numeric type ambiguity;
- no contract;
- validation susah;
- typo runtime;
- refactor buruk.

Map boleh untuk:

- truly dynamic metadata;
- temporary adapter;
- generic config;
- unknown JSON preservation.

### 37.3 “Just Use convertValue for Everything”

Masalah:

- object-to-object mapping menjadi implicit;
- semantic mapping tersembunyi;
- runtime failure;
- annotation serialization bocor ke domain mapping.

### 37.4 “Expose Entity and Add @JsonIgnore Until It Works”

Ini salah satu anti-pattern paling umum.

Akibat:

- API contract mengikuti database;
- cycle/lazy loading patchwork;
- security leakage;
- perubahan persistence memecah API.

### 37.5 “Disable All Failures”

```java
mapper.configure(FAIL_ON_UNKNOWN_PROPERTIES, false);
mapper.configure(FAIL_ON_INVALID_SUBTYPE, false);
mapper.configure(READ_UNKNOWN_ENUM_VALUES_AS_NULL, true);
```

Lenient config tanpa policy menghasilkan silent corruption.

### 37.6 “Use String for Everything”

```java
record Request(String amount, String date, String active) {}
```

Kadang perlu untuk legacy boundary, tapi buruk untuk internal canonical DTO.

---

## 38. Example: Designing a Case Submission JSON Boundary

Misalnya API:

```http
POST /cases
Content-Type: application/json
```

Payload:

```json
{
  "applicantId": "A-001",
  "caseType": "licence_appeal",
  "submittedAt": "2026-06-17T03:15:30Z",
  "facts": {
    "description": "Applicant disputes the decision.",
    "attachments": [
      {
        "documentId": "D-001",
        "type": "supporting_document"
      }
    ]
  }
}
```

### 38.1 Request DTO

```java
public record SubmitCaseRequest(
    String applicantId,
    String caseType,
    Instant submittedAt,
    CaseFactsRequest facts
) {
}

public record CaseFactsRequest(
    String description,
    List<AttachmentRequest> attachments
) {
}

public record AttachmentRequest(
    String documentId,
    String type
) {
}
```

### 38.2 Jackson Responsibility

Jackson bertugas:

- parse JSON;
- bind field ke DTO;
- parse `Instant`;
- bind nested object/list;
- report syntax/type error.

### 38.3 Validation Responsibility

Bean Validation/application validation bertugas:

- applicantId required;
- caseType supported;
- submittedAt not in future/past beyond policy;
- description length;
- documentId exists;
- attachment type allowed.

### 38.4 Mapping Responsibility

Mapper/application factory bertugas:

```text
SubmitCaseRequest -> SubmitCaseCommand
```

Dengan policy:

- normalize case type ke enum;
- resolve applicant reference;
- apply actor context;
- generate correlation id;
- ignore client-supplied fields yang tidak boleh dipercaya.

### 38.5 Domain Responsibility

Domain bertugas:

- enforce transition;
- create case aggregate;
- create audit event;
- ensure invariant.

Mental model:

```text
Jackson parses representation.
Validation checks input correctness.
Mapper translates boundary language.
Domain enforces business invariant.
```

---

## 39. Example: Safer Event Envelope

JSON:

```json
{
  "eventId": "EVT-001",
  "eventType": "CASE_SUBMITTED",
  "eventVersion": 2,
  "occurredAt": "2026-06-17T03:15:30Z",
  "payload": {
    "caseId": "C-001",
    "applicantId": "A-001"
  }
}
```

Envelope DTO:

```java
public record EventEnvelope(
    String eventId,
    String eventType,
    int eventVersion,
    Instant occurredAt,
    JsonNode payload
) {
}
```

Payload DTO:

```java
public record CaseSubmittedV2Payload(
    String caseId,
    String applicantId
) {
}
```

Handler:

```java
public void handle(String json) throws IOException {
    EventEnvelope envelope = mapper.readValue(json, EventEnvelope.class);

    if (!"CASE_SUBMITTED".equals(envelope.eventType())) {
        throw new UnsupportedOperationException(envelope.eventType());
    }

    if (envelope.eventVersion() != 2) {
        throw new UnsupportedOperationException(
            envelope.eventType() + " v" + envelope.eventVersion()
        );
    }

    CaseSubmittedV2Payload payload =
        mapper.treeToValue(envelope.payload(), CaseSubmittedV2Payload.class);

    process(envelope, payload);
}
```

Keuntungan:

- envelope strongly typed;
- payload deferred;
- event type/version explicit;
- no unsafe polymorphism;
- easier dead-letter;
- easier backward compatibility.

---

## 40. Example: Large Export

Naive:

```java
List<CaseExportRow> rows = caseService.findAllRows();
String json = mapper.writeValueAsString(rows);
return json;
```

Masalah:

- semua rows di memory;
- string besar di memory;
- response lama;
- GC pressure.

Streaming:

```java
public void exportCases(OutputStream outputStream) throws IOException {
    try (JsonGenerator generator = mapper.getFactory().createGenerator(outputStream)) {
        generator.writeStartArray();

        int page = 0;
        Page<CaseExportRow> rows;

        do {
            rows = caseService.findRows(page, 500);

            for (CaseExportRow row : rows.content()) {
                mapper.writeValue(generator, row);
            }

            page++;
        } while (rows.hasNext());

        generator.writeEndArray();
    }
}
```

Mental model:

```text
Streaming output lets DB pagination, mapping, and network writing cooperate.
```

---

## 41. Checklist: Memilih Jackson Model

Gunakan checklist ini sebelum memilih API.

### 41.1 Pertanyaan Shape

- Apakah JSON schema stabil?
- Apakah semua field diketahui?
- Apakah ada dynamic metadata?
- Apakah ada event type/version?
- Apakah payload bisa sangat besar?
- Apakah perlu preserve unknown fields?

### 41.2 Pertanyaan Correctness

- Apakah unknown field harus ditolak?
- Apakah missing dan null harus dibedakan?
- Apakah string-to-number coercion boleh?
- Apakah enum unknown boleh?
- Apakah date/time format tunggal?
- Apakah field order penting untuk consumer lama?

### 41.3 Pertanyaan Security

- Apakah target DTO hanya berisi field yang boleh dikirim client?
- Apakah ada field internal/admin?
- Apakah polymorphism aman?
- Apakah data sensitif termasking?
- Apakah entity pernah langsung diserialisasi?
- Apakah error message expose class/package?

### 41.4 Pertanyaan Performance

- Apakah payload besar?
- Apakah array bisa streaming?
- Apakah perlu menghindari intermediate string?
- Apakah mapping memicu lazy loading?
- Apakah object graph terlalu besar?
- Apakah perlu benchmark hot path?

### 41.5 Pertanyaan Governance

- Mapper mana yang dipakai boundary ini?
- Module apa saja aktif?
- Feature strict/lenient apa yang aktif?
- Siapa owner contract?
- Apakah ada golden payload test?
- Apakah perubahan DTO melalui compatibility review?

---

## 42. Mental Model Ringkas

```text
Jackson has three faces:

1. Streaming
   JSON as tokens.
   Best for large/incremental/high-control processing.

2. Tree
   JSON as JsonNode.
   Best for dynamic, partial, envelope, inspection, patch-like processing.

3. Data Binding
   JSON as Java object.
   Best for stable DTO contracts and normal API request/response.
```

```text
ObjectMapper is not just a utility.
It is a configured codec engine.
```

```text
JSON is a tree.
Java object can be a graph.
Serialization requires deliberate shape design.
```

```text
Deserialization success does not mean business correctness.
It only means representation could be converted into Java shape.
```

```text
Strictness is boundary-specific.
Public command API and legacy partner integration should not blindly share the same policy.
```

```text
Do not expose entities.
DTO is the serialization boundary.
```

---

## 43. Practical Rules for Top 1% Engineering

1. Treat JSON binding as a **contract boundary**, not a convenience call.
2. Use data binding for stable DTOs.
3. Use tree model for dynamic/envelope/partial payloads.
4. Use streaming for large payloads.
5. Do not mutate shared `ObjectMapper` at runtime.
6. Prefer `ObjectReader`/`ObjectWriter` for operation-specific behavior.
7. Use `TypeReference`/`JavaType` for generic types.
8. Design DTOs to prevent over-posting.
9. Never serialize JPA entities directly to public API.
10. Make null/missing/empty semantics explicit.
11. Use strict mode for command APIs.
12. Use lenient mode only with explicit legacy policy.
13. Treat polymorphism as security-sensitive.
14. Keep date/time semantic precise.
15. Use `BigDecimal` or minor units for money.
16. Test serialization/deserialization with golden payloads.
17. Translate Jackson exceptions into safe, stable API errors.
18. Keep raw diagnostic details in internal logs with correlation id.
19. Govern ObjectMapper profiles per boundary.
20. Review Jackson config as architecture, not plumbing.

---

## 44. Latihan

### Latihan 1 — Pilih Model Jackson

Untuk setiap kasus, pilih Streaming, Tree, atau Data Binding:

1. REST request `POST /users` dengan schema stabil.
2. Webhook partner dengan `eventType` dan dynamic payload.
3. Export 5 juta audit rows ke JSON.
4. Admin API response yang mengambil read model stabil.
5. Import file JSON array ukuran 2GB.
6. Config JSON yang field-nya berubah antar tenant.
7. Internal event dengan versioned payload.
8. Public API command yang harus reject unknown field.

Jawaban yang diharapkan:

| Kasus | Model utama |
|---|---|
| REST request stabil | Data Binding |
| Webhook event dynamic | Tree + Data Binding |
| Export 5 juta rows | Streaming + per-row Data Binding |
| Admin response stabil | Data Binding |
| Import 2GB array | Streaming + per-item Binding |
| Tenant config dynamic | Tree / Map with policy |
| Versioned event | Envelope Binding + Tree payload + Binding |
| Strict command API | Data Binding with strict reader |

### Latihan 2 — Identifikasi Bug Boundary

Diberikan DTO:

```java
public record CreateUserRequest(
    String username,
    String email,
    boolean admin,
    String status
) {
}
```

Payload:

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "admin": true,
  "status": "ACTIVE"
}
```

Pertanyaan:

- Field mana yang berisiko over-posting?
- Field mana yang seharusnya server-side?
- Bagaimana DTO yang lebih aman?

Jawaban:

```java
public record CreateUserRequest(
    String username,
    String email
) {
}
```

`admin` dan `status` seharusnya ditentukan application service berdasarkan actor, policy, dan lifecycle.

### Latihan 3 — Null vs Missing

Untuk PATCH user:

```json
{
  "displayName": null
}
```

Apa bedanya dengan:

```json
{}
```

Jawaban:

- `{}` berarti tidak ada perubahan.
- `"displayName": null` bisa berarti clear displayName atau invalid, tergantung policy.
- DTO biasa dengan `String displayName` tidak cukup untuk membedakan missing vs null.

---

## 45. Kesimpulan

Jackson adalah salah satu komponen paling penting dalam aplikasi Java modern karena ia berada di titik keluar-masuk data. Tetapi kekuatan Jackson bukan hanya `ObjectMapper.readValue()` dan `writeValueAsString()`.

Mental model yang benar:

```text
Jackson = codec engine untuk boundary representation.
```

Ia punya tiga mode:

- streaming untuk kontrol dan skala;
- tree untuk fleksibilitas dan inspeksi;
- data binding untuk DTO contract yang stabil.

Engineer level tinggi tidak hanya bertanya:

```text
Bagaimana cara parse JSON ini?
```

Tetapi bertanya:

```text
Boundary apa ini?
Schema-nya stabil atau dynamic?
Strict atau lenient?
Payload kecil atau besar?
Field mana yang boleh dikirim client?
Null dan missing artinya apa?
Apakah ini contract publik, internal, event, audit, atau legacy integration?
Apakah error-nya aman dan diagnosable?
Apakah mapping ini akan tetap benar saat versi berubah?
```

Dengan mental model ini, bagian berikutnya dapat masuk lebih dalam ke `ObjectMapper` engineering: configuration, lifecycle, thread-safety, module strategy, strict/lenient profile, dan cara membuat mapper production-grade.

---

## 46. Referensi Konseptual

- Jackson Databind documentation: databinding dan tree model dibangun di atas streaming parser/generator.
- Jackson `ObjectMapper` Javadoc: fungsi read/write POJO dan tree model.
- Jackson 3 release/migration notes: Jackson 3 adalah major version dengan perubahan API dan arah konfigurasi modern.
- Spring Framework/Jackson 3 notes: ekosistem modern mulai mengadopsi format-specific mapper seperti `JsonMapper`.
