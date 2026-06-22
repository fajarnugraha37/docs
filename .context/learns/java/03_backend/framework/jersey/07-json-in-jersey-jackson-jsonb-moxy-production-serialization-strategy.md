# Part 7 — JSON in Jersey: Jackson, JSON-B, MOXy, and Production Serialization Strategy

> Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
> File: `07-json-in-jersey-jackson-jsonb-moxy-production-serialization-strategy.md`  
> Scope: Java 8 sampai Java 25, Jersey 2.x/3.x/4.x, `javax.ws.rs` dan `jakarta.ws.rs` migration awareness  
> Fokus: strategi JSON di Jersey sebagai runtime/provider pipeline, bukan pengulangan dasar Jackson/JSON-B.

---

## 0. Posisi Part Ini Dalam Seri

Sebelumnya kita sudah membahas:

1. Jersey sebagai runtime, bukan sekadar annotation REST.
2. Bootstrap `ResourceConfig` dan startup graph.
3. Resource model internal.
4. Request matching, method selection, dan media negotiation.
5. Parameter injection semantics.
6. Entity provider pipeline: `MessageBodyReader`, `MessageBodyWriter`, dan provider selection.

Part ini masuk ke salah satu area yang paling sering terlihat sederhana tetapi sering menjadi sumber bug production:

> “Bagaimana object Java berubah menjadi JSON, dan bagaimana JSON berubah kembali menjadi object Java, di dalam pipeline Jersey?”

Di level pemula, jawabannya sering: “pakai Jackson”.

Di level production engineer, jawabannya harus lebih presisi:

- Provider mana yang aktif?
- Siapa yang mendaftarkannya?
- Apakah provider itu milik Jersey, Jackson JAX-RS/Jakarta-RS module, JSON-B, MOXy, atau container?
- Apakah ada lebih dari satu provider JSON?
- Bagaimana prioritas provider diselesaikan?
- Apakah DTO aman diserialisasi?
- Apakah entity JPA ikut bocor?
- Apakah lazy proxy akan meledak?
- Apakah `Instant`, `LocalDate`, `record`, `sealed class`, `Optional`, enum, polymorphism, dan unknown field sudah dikendalikan?
- Apakah error payload konsisten?
- Apakah konfigurasi Java 8 masih kompatibel dengan Java 17/21/25?
- Apakah migration dari `javax` ke `jakarta` memengaruhi dependency JSON?

Part ini membangun mental model itu.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan Part 7, kamu diharapkan bisa:

1. Menjelaskan posisi JSON provider di dalam Jersey entity pipeline.
2. Membedakan Jackson, JSON-B, dan MOXy dari sudut pandang runtime Jersey.
3. Mengendalikan provider registration secara eksplisit.
4. Membuat `ObjectMapper` atau `Jsonb` configuration yang production-grade.
5. Menghindari konflik provider ketika dependency bertambah.
6. Mendesain DTO yang stabil untuk backward compatibility.
7. Menangani Java 8 sampai Java 25 feature dalam JSON serialization.
8. Menghindari risiko security seperti unsafe polymorphism dan data leakage.
9. Men-debug error umum seperti:
   - `No MessageBodyWriter found`
   - `No MessageBodyReader found`
   - infinite recursion
   - unknown property
   - invalid enum
   - lazy proxy serialization failure
   - timezone/date mismatch
10. Menentukan strategi JSON yang cocok untuk enterprise API.

---

## 2. Prinsip Utama: JSON Bukan Fitur Resource, Tetapi Provider Runtime

Saat resource method seperti ini dipanggil:

```java
@GET
@Path("/{id}")
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse getCustomer(@PathParam("id") String id) {
    return customerService.getCustomer(id);
}
```

Resource method tidak benar-benar “mengubah object menjadi JSON”.

Yang terjadi secara konseptual:

```text
Resource method returns Java object
        │
        ▼
Jersey sees response entity type
        │
        ▼
Jersey checks selected media type: application/json
        │
        ▼
Jersey asks provider registry:
  “Who can write CustomerResponse as application/json?”
        │
        ▼
Selected MessageBodyWriter writes bytes to HTTP response stream
```

Untuk request body:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse createCustomer(CreateCustomerRequest request) {
    return customerService.create(request);
}
```

Yang terjadi:

```text
HTTP request body contains bytes
        │
        ▼
Jersey sees resource method parameter type: CreateCustomerRequest
        │
        ▼
Jersey sees Content-Type: application/json
        │
        ▼
Jersey asks provider registry:
  “Who can read application/json into CreateCustomerRequest?”
        │
        ▼
Selected MessageBodyReader parses bytes into Java object
        │
        ▼
Resource method receives object
```

Jadi, JSON di Jersey berada pada layer:

```text
HTTP bytes
  ↕
MessageBodyReader / MessageBodyWriter
  ↕
JSON provider implementation
  ↕
DTO / Java object
```

Bukan pada layer:

```text
@Path method annotation
@Service business logic
@Repository persistence logic
```

Ini penting karena banyak bug JSON bukan bug controller, bukan bug service, dan bukan bug database. Bug itu sering terjadi di provider pipeline.

---

## 3. Mental Model Provider JSON di Jersey

Jersey sendiri adalah implementasi Jakarta REST/JAX-RS. Spesifikasi REST mendefinisikan konsep provider seperti `MessageBodyReader` dan `MessageBodyWriter`, tetapi implementasi detail JSON biasanya diberikan oleh modul tambahan.

Secara umum, ada tiga keluarga JSON provider yang sering muncul di konteks Jersey:

```text
Jersey runtime
│
├── Jackson-based provider
│   ├── jersey-media-json-jackson
│   ├── jackson-jaxrs-json-provider       // javax-era
│   └── jackson-jakarta-rs-json-provider  // jakarta-era
│
├── JSON-B provider
│   ├── Jakarta JSON Binding API
│   ├── Yasson implementation, commonly
│   └── Jersey JSON-B integration
│
└── MOXy provider
    ├── EclipseLink MOXy
    ├── historically common in Jersey/JAX-RS environments
    └── JAXB-oriented JSON/XML mapping heritage
```

### 3.1 Provider Bukan Sekadar Dependency

Menambahkan dependency belum tentu sama dengan provider aktif secara benar.

Ada beberapa cara provider bisa aktif:

1. Registered explicitly di `ResourceConfig`.
2. Auto-discovered dari Jersey feature.
3. Discovered via `META-INF/services`.
4. Provided by container/application server.
5. Registered oleh framework integration seperti Spring Boot/Jakarta EE runtime.

Masalah muncul ketika engineer tidak sadar ada lebih dari satu provider yang bisa menulis/membaca `application/json`.

Contoh situasi berbahaya:

```text
Classpath contains:
- jersey-media-json-jackson
- jersey-media-json-binding
- jersey-media-moxy
- app server built-in JSON-B provider
```

Lalu ketika endpoint mengembalikan object:

```text
Which provider writes the response?
```

Kalau jawabannya “tidak tahu”, berarti behavior serialization belum deterministic.

Production-grade Jersey application seharusnya punya jawaban eksplisit:

> “Untuk JSON, server kami menggunakan Jackson provider yang didaftarkan eksplisit melalui `JacksonFeature` dan `ContextResolver<ObjectMapper>`. Auto-discovery provider JSON yang tidak diperlukan dinonaktifkan/diwaspadai. DTO contract divalidasi melalui contract tests.”

Atau:

> “Kami menggunakan JSON-B untuk alignment Jakarta EE, dengan konfigurasi `JsonbConfig` terpusat dan error mapper konsisten.”

Yang tidak sehat:

> “Sepertinya Jackson aktif karena selama ini jalan.”

---

## 4. Jackson vs JSON-B vs MOXy: Kapan Pakai Apa?

Tidak ada jawaban universal. Pilihan provider harus dilihat dari context.

### 4.1 Jackson

Jackson biasanya dipilih ketika aplikasi membutuhkan kontrol serialization yang sangat kaya.

Kekuatan Jackson:

- Ekosistem sangat luas.
- Banyak module:
  - Java Time
  - JDK8 types
  - parameter names
  - Kotlin, Scala, afterburner/blackbird tergantung versi
  - Jakarta XML Bind annotation module
- Sangat umum di Spring ecosystem.
- Banyak annotation dan customization point.
- Baik untuk DTO kompleks.
- Mature untuk streaming JSON.
- Banyak library third-party sudah mendukung Jackson.

Risiko Jackson:

- Konfigurasinya luas sehingga mudah tidak konsisten.
- Annotation bisa mencampur API contract dengan internal model.
- Polymorphic deserialization bisa berbahaya kalau salah konfigurasi.
- Entity persistence bisa bocor kalau langsung diserialisasi.
- Provider conflict bisa terjadi antara `javax` dan `jakarta` artifacts.
- ObjectMapper mutable saat bootstrap, tetapi harus dianggap effectively immutable setelah runtime.

Jackson cocok jika:

- Aplikasi punya API contract yang kompleks.
- Perlu compatibility dengan Spring/service lain.
- Perlu fine-grained serialization control.
- Perlu module Java modern.
- Perlu custom serializer/deserializer.
- Tim sudah punya governance ObjectMapper.

Jackson kurang cocok jika:

- Tim ingin strict Jakarta EE standard-only approach.
- Konfigurasi tidak dikendalikan dan setiap module membuat `ObjectMapper` sendiri.
- Banyak entity JPA langsung diekspos sebagai response.

### 4.2 JSON-B

JSON-B adalah standard Jakarta EE untuk binding JSON ke object Java.

Kekuatan JSON-B:

- Standard Jakarta EE.
- Cocok untuk aplikasi yang ingin portability antar Jakarta EE runtime.
- Integrasi natural di server Jakarta EE.
- API relatif sederhana.
- Mengurangi ketergantungan pada vendor-specific JSON stack.

Risiko JSON-B:

- Ekosistem customization tidak seluas Jackson.
- Beberapa behavior bisa berbeda antar implementation/configuration.
- Tim yang terbiasa Jackson mungkin kehilangan beberapa fitur advanced.
- Third-party integration sering lebih Jackson-centric.

JSON-B cocok jika:

- Kamu berada di Jakarta EE full runtime.
- Portability lebih penting daripada deep customization.
- DTO relatif bersih dan tidak butuh banyak annotation vendor-specific.
- Governance mengutamakan standard API.

JSON-B kurang cocok jika:

- Kamu butuh kontrol advanced pada polymorphism, custom module, atau serializer kompleks.
- Kamu banyak memakai library yang mengasumsikan Jackson.
- Kamu perlu compatibility kuat dengan Spring/Jackson ecosystem.

### 4.3 MOXy

MOXy berasal dari EclipseLink dan historisnya kuat dalam XML/JAXB-style mapping, lalu juga mendukung JSON.

Kekuatan MOXy:

- Familiar dalam lingkungan lama Jersey/GlassFish/EclipseLink.
- Bisa berguna saat model sudah sangat JAXB/XML-oriented.
- Bisa membantu sistem yang harus mempertahankan XML dan JSON dari model annotation yang sama.

Risiko MOXy:

- Untuk JSON modern enterprise API, Jackson/JSON-B biasanya lebih umum dipilih.
- Annotation JAXB-style tidak selalu ideal untuk kontrak JSON modern.
- Bisa aktif tanpa disadari di classpath tertentu.
- Bisa menyebabkan hasil JSON berbeda dari ekspektasi Jackson.

MOXy cocok jika:

- Legacy application sudah bergantung pada MOXy.
- Ada kebutuhan XML/JSON mapping berbasis JAXB yang sulit dimigrasi.
- Runtime/container sudah distandardisasi di sekitar MOXy.

MOXy kurang cocok jika:

- Kamu membangun API baru dan butuh JSON-first strategy.
- Tim tidak punya alasan kuat mempertahankan MOXy.
- Kamu ingin alignment dengan ecosystem Jackson atau JSON-B modern.

### 4.4 Ringkasan Pilihan

```text
Need maximum ecosystem/control?        → Jackson
Need Jakarta EE standard portability?  → JSON-B
Need legacy JAXB/MOXy alignment?       → MOXy
```

Namun keputusan paling penting bukan hanya provider mana, tetapi:

> Provider harus satu, jelas, terkonfigurasi pusat, dan diuji sebagai bagian dari API contract.

---

## 5. Namespace Era: Jersey 2.x vs 3.x vs 4.x

Ini sangat penting untuk Java 8–25 dan migration.

### 5.1 Jersey 2.x

Jersey 2.x berada di era Java EE/JAX-RS dengan namespace:

```java
javax.ws.rs.*
```

Biasanya cocok untuk:

- Java 8 legacy applications.
- Java EE 7/8 era.
- Servlet `javax.servlet.*`.
- Jackson JAX-RS provider `com.fasterxml.jackson.jaxrs.*`.

Contoh dependency style:

```xml
<dependency>
    <groupId>org.glassfish.jersey.media</groupId>
    <artifactId>jersey-media-json-jackson</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

Dan class seperti:

```java
import org.glassfish.jersey.jackson.JacksonFeature;
```

Jersey module internally aligns with the Jersey version and its era.

### 5.2 Jersey 3.x

Jersey 3.x masuk era Jakarta EE 9/10 dengan namespace:

```java
jakarta.ws.rs.*
```

Ini bukan sekadar rename import. Seluruh dependency ecosystem juga harus konsisten:

```text
javax.ws.rs    → jakarta.ws.rs
javax.servlet  → jakarta.servlet
javax.validation → jakarta.validation
javax.json     → jakarta.json
```

Untuk Jackson, perhatikan artifact/module yang mendukung Jakarta namespace, misalnya keluarga `com.fasterxml.jackson.jakarta.rs` untuk provider Jakarta-RS.

### 5.3 Jersey 4.x

Jersey 4.x relevan untuk Jakarta EE 11/Jakarta REST 4.0 line. Baseline Java-nya naik mengikuti Jakarta REST 4.0 dan Jakarta EE 11 landscape.

Implikasi:

- Java 8 tidak relevan untuk Jersey 4 runtime modern.
- Legacy Java 8 harus tetap di Jersey 2.x atau dimigrasi bertahap.
- Jakarta namespace wajib.
- Dependency harus konsisten Jakarta-era.
- Testing migration menjadi sangat penting.

### 5.4 Rule of Thumb Version Alignment

```text
Java 8 + javax stack       → Jersey 2.x
Java 11/17 + jakarta stack → Jersey 3.x, tergantung platform
Java 17+ / EE 11 stack     → Jersey 4.x
Java 21/25 modern runtime  → Jersey 4.x atau compatible 3.x, sesuai platform
```

Yang harus dihindari:

```text
Jersey 2.x + jakarta.ws.rs imports
Jersey 3.x/4.x + javax.ws.rs imports
jackson-jaxrs provider + jakarta.ws.rs runtime
jackson-jakarta-rs provider + javax.ws.rs runtime
mixed servlet javax/jakarta dependencies
```

Failure yang sering muncul:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
LinkageError
Provider not selected
No MessageBodyWriter found
No MessageBodyReader found
```

Ini sering bukan bug JSON, tapi mismatch dependency namespace.

---

## 6. Production Principle: Explicit Provider Registration

Untuk aplikasi production, usahakan provider JSON didaftarkan eksplisit.

### 6.1 Jackson Registration di Jersey

Contoh Jersey server dengan Jackson:

```java
import org.glassfish.jersey.jackson.JacksonFeature;
import org.glassfish.jersey.server.ResourceConfig;

public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        packages("com.acme.api.resources");

        register(JacksonFeature.class);
        register(ObjectMapperProvider.class);
    }
}
```

`ObjectMapperProvider`:

```java
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import jakarta.ws.rs.ext.ContextResolver;
import jakarta.ws.rs.ext.Provider;

@Provider
public final class ObjectMapperProvider implements ContextResolver<ObjectMapper> {

    private final ObjectMapper mapper;

    public ObjectMapperProvider() {
        this.mapper = createObjectMapper();
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }

    private static ObjectMapper createObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();

        mapper.registerModule(new JavaTimeModule());

        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.disable(DeserializationFeature.ADJUST_DATES_TO_CONTEXT_TIME_ZONE);

        mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        mapper.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);

        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);

        return mapper;
    }
}
```

Catatan namespace:

Untuk Jersey 2.x/Java 8 era, import-nya:

```java
import javax.ws.rs.ext.ContextResolver;
import javax.ws.rs.ext.Provider;
```

Untuk Jersey 3.x/4.x:

```java
import jakarta.ws.rs.ext.ContextResolver;
import jakarta.ws.rs.ext.Provider;
```

### 6.2 JSON-B Registration

Konsepnya mirip: provider JSON-B harus tersedia dan config sebaiknya terpusat.

Contoh conceptual:

```java
import jakarta.json.bind.Jsonb;
import jakarta.json.bind.JsonbBuilder;
import jakarta.json.bind.JsonbConfig;
import jakarta.ws.rs.ext.ContextResolver;
import jakarta.ws.rs.ext.Provider;

@Provider
public final class JsonbProvider implements ContextResolver<Jsonb> {

    private final Jsonb jsonb;

    public JsonbProvider() {
        JsonbConfig config = new JsonbConfig()
            .withNullValues(false)
            .withFormatting(false);

        this.jsonb = JsonbBuilder.create(config);
    }

    @Override
    public Jsonb getContext(Class<?> type) {
        return jsonb;
    }
}
```

Namun detail integrasi JSON-B provider tergantung dependency Jersey JSON-B module dan runtime.

### 6.3 Hindari “Provider by Accident”

Masalah production sering muncul ketika provider berubah karena dependency baru.

Contoh:

```text
Sebelumnya:
- only Jackson provider present

Lalu module baru menambahkan:
- jersey-media-json-binding

Tiba-tiba response format berubah untuk LocalDate atau null field.
```

Atau:

```text
Sebelumnya:
- JSON-B provider dari application server

Lalu developer menambahkan:
- jersey-media-json-jackson

Sebagian endpoint tampak berubah karena provider selection/priority.
```

Checklist:

```text
[ ] Satu strategy JSON dipilih secara sadar.
[ ] Provider utama didaftarkan eksplisit.
[ ] Provider lain tidak ikut masuk tanpa alasan.
[ ] Dependency tree diperiksa.
[ ] Contract test mendeteksi perubahan shape JSON.
[ ] Startup log cukup jelas menunjukkan provider aktif.
```

---

## 7. ObjectMapper sebagai Platform Contract, Bukan Utility Bebas

Kesalahan umum:

```java
ObjectMapper mapper = new ObjectMapper();
```

muncul di banyak tempat:

```text
Resource A
Service B
Kafka consumer C
Audit serializer D
Test helper E
Exception mapper F
```

Akibatnya:

```text
Endpoint API memakai mapper config A
Audit trail memakai mapper config B
Test expectation memakai mapper config C
Outbound client memakai mapper config D
```

Lalu bug muncul:

- `LocalDate` berbeda format.
- `Instant` kadang timestamp, kadang ISO string.
- `null` field kadang ada, kadang hilang.
- Unknown property kadang error, kadang diabaikan.
- Enum lowercase kadang diterima, kadang tidak.
- Test lolos, production gagal.

Production-grade approach:

```text
ObjectMapper is part of platform contract.
```

Artinya:

1. Dibuat di satu tempat.
2. Dipakai oleh Jersey provider.
3. Dipakai oleh Jersey client provider.
4. Dipakai oleh contract tests.
5. Dipakai oleh error mapper jika error payload diserialisasi manual.
6. Tidak dimutasi setelah aplikasi start.
7. Dipisahkan bila memang ada contract berbeda.

Contoh struktur:

```text
com.acme.platform.json
├── ApiObjectMapperFactory
├── InternalObjectMapperFactory
├── AuditObjectMapperFactory
├── JerseyObjectMapperProvider
└── JsonContractTestSupport
```

Mengapa dipisahkan?

Karena tidak semua JSON punya contract yang sama.

```text
Public API JSON
  - stable
  - backward compatible
  - consumer-facing
  - careful null/default semantics

Internal event JSON
  - schema/versioned
  - may contain internal fields
  - optimized for internal consumers

Audit JSON
  - evidence-oriented
  - immutable
  - sensitive data masking/redaction
  - may need canonicalization

Debug JSON
  - never exposed externally
  - can contain diagnostic detail
```

Satu `ObjectMapper` untuk semua bisa terlihat simple, tapi sering salah secara domain.

---

## 8. Recommended Jackson Baseline Configuration

Konfigurasi berikut bukan aturan mutlak, tetapi baseline yang masuk akal untuk banyak API enterprise.

```java
public final class ApiObjectMapperFactory {

    private ApiObjectMapperFactory() {
    }

    public static ObjectMapper create() {
        ObjectMapper mapper = new ObjectMapper();

        mapper.registerModule(new JavaTimeModule());
        mapper.registerModule(new Jdk8Module());
        mapper.registerModule(new ParameterNamesModule());

        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.disable(DeserializationFeature.ADJUST_DATES_TO_CONTEXT_TIME_ZONE);

        mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        mapper.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);

        mapper.disable(SerializationFeature.FAIL_ON_EMPTY_BEANS);

        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);

        return mapper;
    }
}
```

Mari kita bedah trade-off-nya.

### 8.1 `JavaTimeModule`

Wajib untuk Java date/time modern:

```java
Instant
LocalDate
LocalDateTime
OffsetDateTime
ZonedDateTime
Duration
```

Tanpa module ini, Java 8 date/time sering gagal atau terserialisasi tidak sesuai harapan.

### 8.2 `WRITE_DATES_AS_TIMESTAMPS = false`

Biasanya API lebih aman dengan ISO-8601 string daripada numeric timestamp.

```json
{
  "createdAt": "2026-06-16T10:15:30Z"
}
```

lebih jelas daripada:

```json
{
  "createdAt": 1781604930000
}
```

Numeric timestamp ambigu:

```text
seconds? milliseconds? nanoseconds?
timezone? epoch?
```

### 8.3 `ADJUST_DATES_TO_CONTEXT_TIME_ZONE = false`

Ini mencegah deserialization mengubah date-time berdasarkan timezone context mapper.

Untuk API enterprise, waktu harus eksplisit.

Preferred:

```java
Instant        // machine timestamp
OffsetDateTime // timestamp with offset
LocalDate      // date-only business concept
```

Hindari untuk API external:

```java
java.util.Date
Calendar
LocalDateTime for actual instant event
```

`LocalDateTime` tidak punya timezone/offset. Cocok untuk konsep lokal seperti “jadwal kantor jam 09:00”, bukan event global seperti “payment received at”.

### 8.4 `FAIL_ON_UNKNOWN_PROPERTIES = false`

Ini sering dipilih untuk backward/forward compatibility request.

Jika client mengirim field baru:

```json
{
  "name": "Alice",
  "nickname": "Al"
}
```

Server lama masih bisa membaca `name` dan mengabaikan `nickname`.

Namun ada trade-off:

- Pro: lebih tolerant terhadap client version drift.
- Con: typo field bisa tidak terdeteksi.

Untuk API public, pilihan ini masuk akal jika ada validation/contract test yang baik.

Untuk internal strict command API, bisa pilih:

```java
mapper.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
```

Tetapi harus siap dengan versioning lebih disiplin.

### 8.5 `FAIL_ON_NULL_FOR_PRIMITIVES = true`

Ini penting untuk menghindari silent default.

Misalnya DTO:

```java
public final class CreateOrderRequest {
    public int quantity;
}
```

Jika JSON:

```json
{
  "quantity": null
}
```

Tanpa guard, bisa menjadi `0`, yang mungkin sangat berbahaya.

Lebih baik gunakan wrapper dan validation:

```java
public final class CreateOrderRequest {
    @NotNull
    @Min(1)
    private Integer quantity;
}
```

Production lesson:

> Primitive di request DTO sering menyembunyikan absent/null bug.

### 8.6 `NON_NULL`

Menghilangkan `null` field bisa membuat response lebih compact.

Namun jangan pakai tanpa memahami contract.

Perbedaan:

```json
{
  "middleName": null
}
```

vs

```json
{}
```

Bisa berarti:

```text
null    → field diketahui, nilainya kosong
absent  → field tidak disediakan / tidak berlaku / tidak diketahui / hidden by authorization
```

Untuk enterprise API, absent vs null adalah contract decision.

Contoh:

```text
Field hidden karena user tidak authorized melihatnya:
  better absent, or explicit masked marker depending policy

Field memang belum diisi:
  null can be acceptable

Field deprecated:
  absent in newer version, retained in old version
```

Jadi `NON_NULL` boleh, tapi pastikan seluruh API contract mengikuti semantics itu.

---

## 9. DTO Design: Jangan Serialisasi Domain Entity Langsung

Ini prinsip besar.

Jangan jadikan JPA entity sebagai response JSON external.

Contoh buruk:

```java
@Entity
public class Customer {
    @Id
    private Long id;

    private String name;

    private String internalRiskRating;

    @OneToMany(mappedBy = "customer")
    private List<Order> orders;
}

@GET
@Path("/{id}")
@Produces(MediaType.APPLICATION_JSON)
public Customer get(@PathParam("id") Long id) {
    return repository.findById(id);
}
```

Masalah:

1. Field internal bisa bocor.
2. Lazy collection bisa memicu query tambahan.
3. Serialization bisa gagal karena proxy.
4. Infinite recursion bisa terjadi.
5. API contract ikut berubah ketika entity berubah.
6. Persistence model dan API model menjadi satu.
7. Authorization per field sulit.
8. Audit defensibility rendah.

Lebih baik:

```java
public final class CustomerResponse {
    private String id;
    private String displayName;
    private String status;
    private Instant createdAt;

    // getters
}
```

Resource:

```java
@GET
@Path("/{id}")
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get(@PathParam("id") String id) {
    Customer customer = customerService.getRequired(id);
    return customerMapper.toResponse(customer);
}
```

Mental model:

```text
Persistence entity = internal truth model
Domain model      = business invariant model
API DTO           = external contract model
JSON              = wire representation
```

Jangan campur semuanya menjadi satu class.

---

## 10. DTO Compatibility Rules

API JSON adalah contract. Mengubah DTO berarti mengubah contract.

### 10.1 Biasanya Safe

Menambahkan optional field di response:

```json
{
  "id": "C001",
  "name": "Alice",
  "segment": "PREMIUM"
}
```

Jika client tolerant terhadap unknown fields, ini safe.

Menambahkan optional field di request:

```json
{
  "name": "Alice",
  "email": "alice@example.com"
}
```

Safe jika server lama mengabaikan unknown fields dan server baru optional.

### 10.2 Biasanya Breaking

Menghapus field response:

```text
client mungkin masih membaca field itu
```

Mengubah type:

```json
"amount": "100.00"
```

menjadi:

```json
"amount": 100.00
```

Mengubah format date:

```json
"2026-06-16"
```

menjadi:

```json
"16/06/2026"
```

Mengubah enum value:

```json
"PENDING_REVIEW"
```

menjadi:

```json
"PENDING"
```

Menjadikan optional field sebagai required.

Mengubah absent/null semantics.

Mengubah error payload shape.

### 10.3 Field Naming Strategy

Pilih konsisten:

```json
camelCase
```

atau:

```json
snake_case
```

Untuk Java/Jersey enterprise, `camelCase` umum karena mapping natural ke Java property.

Namun jika organisasi sudah punya API standard `snake_case`, gunakan naming strategy terpusat.

Jackson example:

```java
mapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
```

Tapi hati-hati: global naming strategy bisa memengaruhi semua DTO.

Untuk migration, lebih aman eksplisit per field jika hanya sebagian:

```java
@JsonProperty("case_id")
private String caseId;
```

### 10.4 Enum Compatibility

Enum terlihat sederhana tapi sering breaking.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Jika response menambahkan:

```java
ESCALATED
```

Client lama bisa gagal jika enum parsing strict.

Untuk public API, pertimbangkan:

- dokumentasikan enum extensibility;
- client harus handle unknown;
- gunakan string status dengan registry kalau status sering berubah;
- sediakan `UNKNOWN` fallback pada client model;
- jangan rename enum value sembarangan.

Untuk request enum:

- strict enum lebih aman;
- unknown harus 400 dengan error jelas;
- jangan silently map unknown ke default.

---

## 11. Records, Immutability, Builders, and Java Version Strategy

### 11.1 Java 8 DTO

Java 8 tidak punya record.

Common DTO style:

```java
public final class CreateCustomerRequest {

    private String name;
    private String email;

    public CreateCustomerRequest() {
        // required by some serializers/deserializers
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }
}
```

Kelemahan:

- Mutable.
- No-args constructor required by many frameworks.
- Invariant sulit dijaga.
- Object bisa setengah valid sebelum validation.

Alternative dengan constructor:

```java
public final class CustomerResponse {

    private final String id;
    private final String name;

    @JsonCreator
    public CustomerResponse(
            @JsonProperty("id") String id,
            @JsonProperty("name") String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }
}
```

Untuk Java 8, ini lebih immutable, tapi butuh annotation/config yang benar.

### 11.2 Java 16+ Records

Untuk Java 16+, DTO response bisa sangat rapi:

```java
public record CustomerResponse(
    String id,
    String name,
    String status,
    Instant createdAt
) {
}
```

Kelebihan:

- Immutable by default.
- Concise.
- Cocok untuk data carrier.
- Mengurangi boilerplate.

Risiko:

- Jangan masukkan behavior domain berat ke record DTO.
- Jangan gunakan record jika butuh backward-compatible constructor rumit tanpa kontrol.
- Pastikan Jackson/JSON-B version mendukung record sesuai runtime.
- Untuk Java 8 compatibility, record tidak tersedia.

Strategi multi-Java:

```text
Library harus support Java 8?
  → jangan gunakan record di shared DTO.

Service sudah baseline Java 17/21/25?
  → record layak dipakai untuk DTO sederhana.

API generated/shared across legacy and modern apps?
  → gunakan class biasa atau codegen target compatible.
```

### 11.3 Builders

Builder berguna untuk response kompleks:

```java
CustomerResponse response = CustomerResponse.builder()
    .id(customer.id())
    .name(customer.displayName())
    .status(customer.status().name())
    .createdAt(customer.createdAt())
    .build();
```

Namun jangan membuat request DTO terlalu “smart”. Request DTO harus jelas sebagai input contract.

---

## 12. Date and Time Strategy

Date/time adalah sumber bug klasik.

### 12.1 Pilihan Type

Gunakan type berdasarkan makna domain:

```text
Instant
  Event happened at an exact machine timestamp.
  Example: createdAt, submittedAt, approvedAt.

OffsetDateTime
  Timestamp with explicit offset.
  Example: external API sends time with +07:00.

LocalDate
  Date-only business concept.
  Example: birthDate, effectiveDate, dueDate.

LocalTime
  Time-only local concept.
  Example: officeOpeningTime.

LocalDateTime
  Local wall-clock datetime without timezone.
  Use carefully. Not suitable for global event timestamp.
```

### 12.2 Response Format

Recommended:

```json
{
  "createdAt": "2026-06-16T03:30:00Z",
  "effectiveDate": "2026-06-16"
}
```

Avoid ambiguous:

```json
{
  "createdAt": "16-06-2026 10:30"
}
```

### 12.3 Timezone Rule

Jangan sembunyikan timezone conversion di serializer.

Lebih baik:

```text
Store internally: Instant/UTC
Expose externally: ISO-8601 explicit
Display timezone: frontend/client concern, unless API contract says otherwise
```

Untuk regulatory/case management systems:

- `createdAt` sebaiknya precise timestamp.
- `decisionDate` bisa `LocalDate` jika domain hanya butuh tanggal keputusan.
- `submittedAt` harus timestamp.
- `effectiveFrom` bisa date atau datetime tergantung rule legal.

Jangan asal memakai `LocalDateTime` karena “mudah”.

---

## 13. Null, Absent, Empty, Default: Semantics Wajib Jelas

JSON punya beberapa state yang sering dicampur:

```text
Field absent:
{}

Field null:
{"name": null}

Field empty string:
{"name": ""}

Field empty array:
{"items": []}

Field zero:
{"amount": 0}

Field false:
{"active": false}
```

Semua berbeda.

### 13.1 Request Semantics

Untuk create request:

```json
{
  "name": "Alice"
}
```

Jika `email` absent, artinya bisa:

```text
not provided
optional
not applicable
```

Jika:

```json
{
  "email": null
}
```

artinya bisa:

```text
explicitly no email
clear existing value
invalid input
```

Untuk PATCH, perbedaan ini sangat penting.

Contoh:

```json
{
  "email": null
}
```

mungkin berarti “hapus email”.

Sedangkan:

```json
{}
```

berarti “jangan ubah email”.

DTO biasa sering tidak cukup untuk membedakan absent vs explicit null, karena keduanya menjadi `null` di Java.

Untuk PATCH, pertimbangkan:

- JSON Merge Patch.
- JSON Patch.
- Custom wrapper seperti `OptionalField<T>`.
- Raw JSON tree parsing untuk endpoint tertentu.
- Explicit operation command.

Contoh wrapper concept:

```java
public final class PatchCustomerRequest {
    private OptionalField<String> email;
}
```

State:

```text
undefined → field absent
null      → field present with null
value     → field present with value
```

### 13.2 Response Semantics

Response juga harus konsisten.

Misalnya field `assignedOfficer`:

```json
{
  "assignedOfficer": null
}
```

Bisa berarti:

```text
case belum assigned
```

Tapi jika user tidak punya permission melihat officer:

```json
{}
```

atau:

```json
{
  "assignedOfficer": {
    "masked": true
  }
}
```

tergantung policy.

Jangan gunakan `null` untuk semua hal.

---

## 14. Unknown Fields: Tolerant Reader vs Strict Contract

Ada dua filosofi:

### 14.1 Tolerant Reader

Server mengabaikan unknown fields.

Kelebihan:

- Client/server version drift lebih aman.
- Rolling deployment lebih mudah.
- Forward compatibility lebih baik.

Kekurangan:

- Typo tidak ketahuan.
- Client bisa mengira field diproses padahal tidak.

### 14.2 Strict Reader

Server menolak unknown fields.

Kelebihan:

- Input contract ketat.
- Typo terdeteksi cepat.
- Cocok untuk regulated command API tertentu.

Kekurangan:

- Lebih mudah breaking saat client lebih baru dari server.
- Rolling deployment harus lebih hati-hati.

### 14.3 Enterprise Recommendation

Tidak harus satu pilihan global.

```text
Public/external API:
  Often tolerant reader + clear docs + validation + contract tests.

Internal command API with strict governance:
  Strict reader can be acceptable.

Security-sensitive endpoint:
  Strict can prevent suspicious extra payload.

PATCH endpoint:
  Need explicit semantics, not just unknown field setting.
```

Jika memakai Jackson global `FAIL_ON_UNKNOWN_PROPERTIES=false`, tetapi ada endpoint yang ingin strict, jangan asal ganti global mapper. Buat provider/reader khusus atau parse `JsonNode` lalu validate manually untuk endpoint itu.

---

## 15. Polymorphism: Powerful, Dangerous, Often Unnecessary

Polymorphic JSON adalah area rawan security.

Contoh ide:

```java
public interface PaymentMethod {
}

public final class CardPayment implements PaymentMethod {
    public String cardToken;
}

public final class BankTransferPayment implements PaymentMethod {
    public String bankCode;
}
```

JSON:

```json
{
  "type": "CARD",
  "cardToken": "tok_123"
}
```

Masalah terjadi jika kita mengizinkan client menentukan class secara bebas:

```json
{
  "@class": "some.dangerous.Class",
  "...": "..."
}
```

Jangan aktifkan default typing secara luas untuk input tidak terpercaya.

Prinsip:

```text
Never let untrusted JSON choose arbitrary Java classes.
```

Lebih aman:

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "type"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = CardPaymentRequest.class, name = "CARD"),
    @JsonSubTypes.Type(value = BankTransferPaymentRequest.class, name = "BANK_TRANSFER")
})
public sealed interface PaymentMethodRequest permits
    CardPaymentRequest,
    BankTransferPaymentRequest {
}
```

Atau lebih eksplisit di service layer:

```java
public final class CreatePaymentRequest {
    private String type;
    private CardPayload card;
    private BankTransferPayload bankTransfer;
}
```

Lalu validate:

```text
if type == CARD, card must be present and bankTransfer absent
if type == BANK_TRANSFER, bankTransfer must be present and card absent
```

Untuk regulated systems, explicit union-like DTO sering lebih defendable daripada magic polymorphic deserialization.

---

## 16. Lazy Proxy, Infinite Recursion, and Persistence Leakage

### 16.1 Infinite Recursion

Entity relationship:

```java
public class Customer {
    private List<Order> orders;
}

public class Order {
    private Customer customer;
}
```

Jika langsung diserialisasi:

```text
Customer → orders → customer → orders → customer → ...
```

Jackson bisa menghasilkan stack overflow atau error recursion.

Workaround annotation seperti:

```java
@JsonManagedReference
@JsonBackReference
```

atau:

```java
@JsonIgnore
```

bisa membantu, tetapi sering hanya menambal masalah desain.

Lebih baik:

```java
public record CustomerResponse(
    String id,
    String name,
    List<OrderSummaryResponse> orders
) {}

public record OrderSummaryResponse(
    String id,
    BigDecimal amount,
    String status
) {}
```

DTO response menentukan graph eksplisit.

### 16.2 Lazy Proxy Failure

Jika transaction sudah selesai lalu serializer mengakses lazy collection:

```text
LazyInitializationException
```

Atau serializer melihat proxy class internal.

Jangan mengandalkan serializer untuk “menavigasi domain graph”.

Query dan mapping harus eksplisit:

```text
Resource
  → service fetches required data
  → mapper builds DTO
  → JSON provider serializes DTO only
```

### 16.3 Data Leakage

Entity sering punya field:

```java
private String passwordHash;
private String internalNote;
private String riskScore;
private String officerComment;
private String deletedFlag;
private String lastUpdatedBy;
```

Sekali field ini punya getter, serializer bisa menganggapnya property.

Annotation `@JsonIgnore` membantu, tapi whitelist DTO jauh lebih aman.

Security principle:

```text
External response should be allow-list, not deny-list.
```

---

## 17. Error Payload Strategy dengan JSON Provider

Exception mapper sering mengembalikan object:

```java
@Provider
public final class ApiExceptionMapper implements ExceptionMapper<ApiException> {

    @Override
    public Response toResponse(ApiException exception) {
        ErrorResponse error = new ErrorResponse(
            exception.code(),
            exception.message(),
            correlationId()
        );

        return Response.status(exception.status())
            .type(MediaType.APPLICATION_JSON)
            .entity(error)
            .build();
    }
}
```

Error object juga melewati `MessageBodyWriter` JSON yang sama.

Artinya:

- Jika JSON provider broken, error mapper bisa ikut broken.
- Jika `ErrorResponse` tidak serializable, client menerima 500 lain.
- Jika provider selection berubah, error shape bisa berubah.
- Jika `message` mengandung sensitive info, JSON akan menyebarkannya.

Design error DTO sederhana:

```java
public record ErrorResponse(
    String code,
    String message,
    String correlationId,
    List<FieldViolation> violations
) {
}

public record FieldViolation(
    String field,
    String code,
    String message
) {
}
```

Jangan masukkan:

```java
Throwable cause;
StackTraceElement[] stackTrace;
Object rawInput;
HttpServletRequest request;
```

ke error response.

### 17.1 RFC 7807 Style

Bisa gunakan Problem Details style:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation error",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/cases/123",
  "correlationId": "abc-123",
  "violations": [
    {
      "field": "applicant.email",
      "code": "invalid_email",
      "message": "Email format is invalid."
    }
  ]
}
```

Namun jangan hanya ikut RFC style tanpa taxonomy error yang matang.

Untuk enterprise/regulatory systems, error harus mendukung:

```text
client troubleshooting
support troubleshooting
audit context
security masking
correlation tracing
contract stability
```

---

## 18. Jersey Client JSON Strategy

Jersey Client juga memakai provider pipeline.

Contoh:

```java
Client client = ClientBuilder.newBuilder()
    .register(JacksonFeature.class)
    .register(ObjectMapperProvider.class)
    .build();
```

Outbound request:

```java
CreateCustomerRequest request = new CreateCustomerRequest("Alice");

CustomerResponse response = client
    .target(baseUri)
    .path("/customers")
    .request(MediaType.APPLICATION_JSON_TYPE)
    .post(Entity.entity(request, MediaType.APPLICATION_JSON_TYPE), CustomerResponse.class);
```

Pipeline:

```text
Java request DTO
  → client MessageBodyWriter
  → JSON bytes
  → HTTP request
  → remote server

HTTP response body
  → client MessageBodyReader
  → Java response DTO
```

Important:

> Server ObjectMapper dan client ObjectMapper belum tentu sama kecuali kamu buat sama.

Untuk internal service-to-service, sebaiknya client factory memakai platform mapper yang sama atau contract-specific mapper.

Contoh:

```java
public final class JerseyClientFactory {

    public static Client createApiClient(ObjectMapper mapper) {
        return ClientBuilder.newBuilder()
            .register(JacksonFeature.class)
            .register(new ObjectMapperProvider(mapper))
            .build();
    }
}
```

Tetapi hati-hati instance provider:

```java
public final class ObjectMapperProvider implements ContextResolver<ObjectMapper> {

    private final ObjectMapper mapper;

    public ObjectMapperProvider(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

### 18.1 Always Close Client Response

Jika membaca generic response:

```java
Response response = target.request().get();
try {
    ErrorResponse error = response.readEntity(ErrorResponse.class);
} finally {
    response.close();
}
```

Jika lupa close, connection pool bisa bocor.

Ini bukan pure JSON issue, tetapi JSON deserialization sering membuat engineer memegang `Response` lebih lama.

### 18.2 Error Body Deserialization

Remote API error shape harus ditangani:

```java
if (response.getStatus() >= 400) {
    ErrorResponse error = response.readEntity(ErrorResponse.class);
    throw mapRemoteError(response.getStatus(), error);
}
```

Jika remote mengembalikan HTML error page:

```text
Content-Type: text/html
```

lalu client mencoba read as JSON:

```text
No MessageBodyReader / JSON parse exception
```

Jadi client error handling harus memeriksa:

- status;
- content type;
- body size;
- parse failure;
- correlation id;
- remote error code.

---

## 19. Provider Selection: Bagaimana Jersey Memilih JSON Provider

Secara konseptual, Jersey menilai provider berdasarkan:

```text
Can provider read/write this Java type?
Can provider read/write this media type?
Does generic type match?
Does annotation context matter?
What is provider priority/order?
What providers are registered in runtime?
```

Jika ada dua provider:

```text
Jackson provider supports Object + application/json
JSON-B provider supports Object + application/json
```

maka conflict bisa muncul.

Symptoms:

- Format date berubah.
- Null field berubah.
- Annotation Jackson tidak dihormati.
- `@JsonProperty` tidak bekerja.
- `@JsonbProperty` tidak bekerja.
- Error hanya muncul di container tertentu.
- Local test berbeda dengan server runtime.

Diagnosis:

1. Print dependency tree.
2. Lihat registered features/provider di `ResourceConfig`.
3. Disable package scanning/provider auto-discovery jika perlu.
4. Reproduce dengan Jersey Test Framework.
5. Buat endpoint diagnostic sementara di non-prod yang mengembalikan provider config? Hati-hati jangan expose internals di prod.
6. Paksa registration eksplisit dan hilangkan provider tidak perlu.

Production rule:

```text
Do not rely on provider selection luck.
```

---

## 20. Custom Serializer and Deserializer

Kadang default mapping tidak cukup.

Contoh value object:

```java
public final class CaseId {
    private final String value;

    private CaseId(String value) {
        if (!value.matches("CASE-[0-9]{8}")) {
            throw new IllegalArgumentException("Invalid case id");
        }
        this.value = value;
    }

    public static CaseId of(String value) {
        return new CaseId(value);
    }

    public String value() {
        return value;
    }
}
```

Kamu ingin JSON:

```json
{
  "caseId": "CASE-20260616"
}
```

bukan:

```json
{
  "caseId": {
    "value": "CASE-20260616"
  }
}
```

Jackson serializer:

```java
public final class CaseIdSerializer extends JsonSerializer<CaseId> {

    @Override
    public void serialize(
            CaseId value,
            JsonGenerator gen,
            SerializerProvider serializers) throws IOException {
        gen.writeString(value.value());
    }
}
```

Deserializer:

```java
public final class CaseIdDeserializer extends JsonDeserializer<CaseId> {

    @Override
    public CaseId deserialize(
            JsonParser parser,
            DeserializationContext context) throws IOException {
        return CaseId.of(parser.getValueAsString());
    }
}
```

Module:

```java
public final class ApiValueObjectModule extends SimpleModule {

    public ApiValueObjectModule() {
        addSerializer(CaseId.class, new CaseIdSerializer());
        addDeserializer(CaseId.class, new CaseIdDeserializer());
    }
}
```

Register:

```java
mapper.registerModule(new ApiValueObjectModule());
```

Trade-off:

- Bagus untuk value object yang stabil.
- Jangan berlebihan untuk semua field sederhana.
- Pastikan error invalid value dipetakan menjadi 400, bukan 500.
- Hindari serializer/deserializer yang memanggil database/service.

Serializer harus pure transformation, bukan business process.

---

## 21. Custom MessageBodyReader/Writer vs Jackson Serializer

Kapan membuat custom `MessageBodyReader/Writer`, bukan Jackson serializer?

### 21.1 Gunakan Jackson Serializer Jika

- Masalahnya hanya mapping satu type/value object.
- Format tetap JSON biasa.
- Kamu masih ingin Jackson menangani object tree utama.
- Butuh field-level atau type-level customization.

### 21.2 Gunakan Custom MessageBodyReader/Writer Jika

- Format bukan JSON standar.
- Butuh streaming khusus.
- Butuh envelope/protocol custom.
- Butuh media type khusus.
- Butuh canonical JSON untuk signature.
- Butuh decrypt/verify sebelum parse.
- Butuh specialized error behavior di body reader.

Contoh media type khusus:

```java
@Provider
@Consumes("application/vnd.acme.secure-json")
@Produces("application/vnd.acme.secure-json")
public final class SecureJsonBodyProvider
        implements MessageBodyReader<Object>, MessageBodyWriter<Object> {
    // decrypt/verify + delegate to ObjectMapper
}
```

Namun custom provider sangat mudah salah. Pastikan:

- media type spesifik;
- priority jelas;
- tidak shadow provider JSON umum;
- stream handling benar;
- error mapping jelas;
- tested dengan Jersey runtime.

---

## 22. Streaming JSON

Untuk response besar, jangan selalu build full list di memory.

Buruk:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public List<CustomerResponse> exportCustomers() {
    return customerService.findAllCustomers();
}
```

Jika data besar:

```text
DB loads many rows
mapper creates many DTOs
list holds all data
Jackson serializes all
memory spikes
GC pressure
possible OOM
```

Alternative dengan streaming:

```java
@GET
@Path("/export")
@Produces(MediaType.APPLICATION_JSON)
public StreamingOutput exportCustomers() {
    return output -> {
        JsonFactory factory = objectMapper.getFactory();
        try (JsonGenerator generator = factory.createGenerator(output)) {
            generator.writeStartArray();

            customerService.streamCustomers(customer -> {
                try {
                    objectMapper.writeValue(generator, customerMapper.toResponse(customer));
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });

            generator.writeEndArray();
        }
    };
}
```

Caveat:

- Error setelah sebagian response terkirim tidak bisa lagi menjadi JSON error normal.
- Transaction harus tidak menahan terlalu lama.
- DB cursor lifecycle harus aman.
- Client disconnect harus ditangani.
- Proxy timeout perlu dipahami.
- Audit/logging tidak boleh buffer semua body.

Untuk export besar, kadang lebih baik:

```text
POST /exports
→ 202 Accepted
→ background job
→ download file when ready
```

Daripada streaming request sinkron yang lama.

---

## 23. JSON Security Checklist

### 23.1 Jangan Expose Internal Fields

Gunakan response DTO allow-list.

### 23.2 Jangan Enable Unsafe Default Typing

Hindari membiarkan JSON menentukan arbitrary Java class.

### 23.3 Batasi Payload Size

JSON besar bisa menyerang memory dan CPU.

Control di:

- reverse proxy;
- servlet container;
- Jersey/container config;
- request filter;
- parser constraint jika tersedia;
- application validation.

### 23.4 Batasi Nesting Depth

Deeply nested JSON bisa mahal diparse.

### 23.5 Jangan Log Raw JSON Sensitive

Request body bisa berisi:

- password;
- token;
- NRIC/NIK/passport;
- financial data;
- health data;
- personal address;
- uploaded document metadata;
- internal comments.

Gunakan masking/redaction.

### 23.6 Jangan Masukkan Stack Trace ke JSON Response

Stack trace untuk log internal, bukan API response.

### 23.7 Validate Setelah Deserialize

Deserialization bukan validation.

JSON valid belum tentu request valid.

```text
JSON syntax valid
  ≠ schema valid
  ≠ business valid
  ≠ authorized
  ≠ state transition valid
```

### 23.8 Hindari Denial-of-Service via Huge Numbers/String

Contoh:

```json
{
  "amount": 999999999999999999999999999999999999999999
}
```

atau string sangat panjang.

Validation harus membatasi:

- length;
- range;
- precision;
- scale;
- array size;
- object nesting.

---

## 24. BigDecimal and Money

Jangan gunakan `double` untuk uang.

Buruk:

```java
public final class PaymentRequest {
    private double amount;
}
```

Lebih baik:

```java
public final class PaymentRequest {
    @NotNull
    @Digits(integer = 12, fraction = 2)
    private BigDecimal amount;

    @NotBlank
    private String currency;
}
```

JSON:

```json
{
  "amount": "100.00",
  "currency": "SGD"
}
```

atau:

```json
{
  "amount": 100.00,
  "currency": "SGD"
}
```

Keduanya punya trade-off.

Numeric JSON:

- natural secara JSON;
- tapi parser/client language bisa memakai floating point.

String decimal:

- lebih aman lintas bahasa untuk precision;
- tapi perlu contract jelas bahwa amount adalah decimal string.

Untuk API enterprise lintas sistem, sering lebih defendable memakai string decimal atau minor unit integer:

```json
{
  "amountMinor": 10000,
  "currency": "SGD"
}
```

Artinya 100.00 SGD jika minor unit 2.

Tetapi minor unit juga punya complexity untuk currency dengan minor unit berbeda.

Intinya:

> Money serialization adalah domain/API design decision, bukan sekadar ObjectMapper setting.

---

## 25. Binary Data di JSON: Jangan Sembarangan Base64

Kadang request ingin mengirim file dalam JSON:

```json
{
  "fileName": "evidence.pdf",
  "contentBase64": "JVBERi0x..."
}
```

Ini bisa acceptable untuk file kecil, tapi buruk untuk file besar.

Masalah:

- Base64 membesar ~33%.
- JSON parser harus membaca string besar.
- Memory spike.
- Logging risk.
- Error handling lebih sulit.

Untuk file besar, gunakan multipart atau upload flow terpisah.

```text
POST /documents/metadata
POST /documents/{id}/content
```

atau:

```text
Pre-signed upload URL / object storage pattern
```

Part 17 nanti membahas file upload/download lebih dalam.

---

## 26. JSON Views, Filtering, and Field-Level Authorization

Jackson punya fitur seperti `@JsonView` atau filters. Bisa menggoda untuk field-level authorization.

Contoh:

```java
@JsonView(Views.Public.class)
private String name;

@JsonView(Views.Internal.class)
private String riskRating;
```

Masalah:

- Authorization tersebar di serialization annotation.
- Sulit diaudit.
- Bisa salah view.
- Test harus sangat disiplin.
- Domain decision bercampur dengan JSON mechanism.

Untuk field-level authorization yang serius, lebih jelas membangun DTO berdasarkan permission:

```java
CustomerResponse response = customerResponseAssembler.assemble(customer, currentUser);
```

Assembler menentukan field mana yang boleh ada.

```java
public CustomerResponse assemble(Customer customer, UserContext user) {
    return new CustomerResponse(
        customer.id(),
        customer.name(),
        user.canViewRiskRating() ? customer.riskRating() : null
    );
}
```

Namun null vs absent harus sesuai contract.

Untuk regulatory systems, explicit assembler lebih mudah dipertanggungjawabkan daripada serializer magic.

---

## 27. JSON and Validation Boundary

Deserialization terjadi sebelum Bean Validation pada resource method parameter.

Flow:

```text
HTTP bytes
  → MessageBodyReader parses JSON
  → DTO instance created
  → Bean Validation validates DTO/parameters
  → Resource method invoked
```

Jika JSON syntax invalid:

```text
MessageBodyReader throws parse exception
resource method not invoked
validation not invoked
```

Jika JSON valid tapi field invalid:

```text
DTO created
Bean Validation catches violation
```

Contoh invalid syntax:

```json
{
  "name": "Alice",
```

Result should be 400 parse error.

Contoh invalid semantic:

```json
{
  "email": "not-an-email"
}
```

Result should be 400 validation error.

Pisahkan error code:

```text
invalid_json_syntax
unsupported_media_type
malformed_request_body
validation_failed
business_rule_violation
```

Jangan jadikan semua:

```text
bad_request
```

karena troubleshooting menjadi buruk.

---

## 28. Handling JSON Parse Errors in Jersey

Jackson parse error biasanya muncul sebagai exception dari provider, lalu Jersey mapping menjadi 400 atau 500 tergantung exception path dan mapper yang tersedia.

Kamu bisa membuat mapper untuk JSON parse/mapping exceptions, tetapi harus hati-hati agar tidak bergantung terlalu spesifik pada provider jika ingin provider-agnostic.

Conceptual mapper:

```java
@Provider
public final class JsonMappingExceptionMapper
        implements ExceptionMapper<JsonProcessingException> {

    @Override
    public Response toResponse(JsonProcessingException exception) {
        ErrorResponse error = ErrorResponse.badRequest(
            "invalid_json",
            "Request body is not valid JSON.",
            correlationId()
        );

        return Response.status(Response.Status.BAD_REQUEST)
            .type(MediaType.APPLICATION_JSON_TYPE)
            .entity(error)
            .build();
    }
}
```

Namun beberapa exceptions bisa wrapped oleh Jersey.

Diagnosis perlu melihat actual exception type di runtime:

```text
JsonParseException
JsonMappingException
MismatchedInputException
ProcessingException
ParamException
NoContentException
```

Part 9 tentang exception mapping akan membahas taxonomy lebih dalam.

Prinsip di sini:

- invalid JSON syntax → 400;
- wrong content type → 415;
- unacceptable response media → 406;
- server cannot serialize internal response → 500;
- client sent value with wrong type → usually 400;
- validation failed after parse → 400 with violations;
- unauthorized field access → not a serialization error; should be authorization/DTO assembly decision.

---

## 29. JSON Provider and Media Types

`application/json` bukan satu-satunya media type JSON.

Ada vendor media type:

```text
application/vnd.acme.case.v1+json
application/problem+json
application/merge-patch+json
application/json-patch+json
```

Provider harus bisa match media type tersebut.

Jackson/Jersey provider umumnya bisa menangani `+json` media type, tapi pastikan dengan test.

Contoh resource:

```java
@POST
@Consumes("application/vnd.acme.case-command.v1+json")
@Produces("application/vnd.acme.case.v1+json")
public CaseResponse createCase(CreateCaseRequest request) {
    return caseService.create(request);
}
```

Jika provider tidak menganggap media type itu compatible, kamu bisa dapat:

```text
415 Unsupported Media Type
No MessageBodyReader found
No MessageBodyWriter found
```

Test vendor media type secara eksplisit.

---

## 30. JSON Merge Patch and JSON Patch

PATCH endpoint berbeda dari PUT.

### 30.1 PUT

PUT biasanya mengganti representasi resource secara penuh.

```http
PUT /customers/C001
Content-Type: application/json
```

```json
{
  "name": "Alice",
  "email": "alice@example.com"
}
```

### 30.2 JSON Merge Patch

Media type:

```text
application/merge-patch+json
```

Semantics:

```json
{
  "email": null
}
```

berarti remove/clear email.

Field absent berarti no change.

### 30.3 JSON Patch

Media type:

```text
application/json-patch+json
```

Body:

```json
[
  { "op": "replace", "path": "/email", "value": "alice@example.com" },
  { "op": "remove", "path": "/phone" }
]
```

JSON Patch lebih eksplisit tetapi lebih kompleks.

### 30.4 Jersey Strategy

Untuk PATCH, jangan asal bind ke DTO biasa:

```java
public UpdateCustomerRequest patch(UpdateCustomerRequest request)
```

karena absent/null semantics hilang.

Lebih baik:

- gunakan `JsonNode` untuk merge patch;
- gunakan library JSON Patch;
- gunakan command operation list;
- gunakan wrapper tri-state field.

PATCH adalah API semantics problem, bukan sekadar serialization problem.

---

## 31. ObjectMapper Thread Safety and Lifecycle

Jackson `ObjectMapper` aman digunakan concurrent setelah konfigurasi selesai.

Praktik sehat:

```text
Create once at startup
Register modules/features at startup
Expose as singleton/effectively immutable
Do not mutate dynamically per request
```

Buruk:

```java
@GET
public Response get() {
    objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
    return Response.ok(service.get()).build();
}
```

Kenapa buruk?

- Request concurrent bisa saling memengaruhi.
- Output endpoint lain berubah.
- Race condition behavior.

Jika butuh variasi per call, gunakan:

```java
ObjectWriter writer = objectMapper.writerWithView(...);
```

atau:

```java
ObjectReader reader = objectMapper.readerFor(...);
```

`ObjectWriter`/`ObjectReader` lebih aman sebagai immutable derived configuration.

---

## 32. Pretty Printing: Jangan Default di Production API

Pretty JSON:

```json
{
  "id" : "C001",
  "name" : "Alice"
}
```

Mudah dibaca, tapi:

- response lebih besar;
- CPU lebih banyak;
- tidak perlu untuk machine client;
- bisa mengubah snapshot tests kalau tidak konsisten.

Untuk production API, default compact.

Jika butuh debug:

- gunakan non-prod config;
- atau query param internal/debug yang sangat dibatasi;
- atau logging formatter, bukan response formatter.

---

## 33. Content Negotiation and JSON Provider

Resource bisa punya:

```java
@Produces({MediaType.APPLICATION_JSON, MediaType.APPLICATION_XML})
```

Client mengirim:

```http
Accept: application/xml
```

Maka Jersey memilih XML provider jika tersedia.

Jika DTO punya annotation Jackson saja, XML output mungkin gagal/aneh.

Untuk API modern, jangan expose banyak representation jika tidak benar-benar didukung.

Lebih aman:

```java
@Produces(MediaType.APPLICATION_JSON)
```

Jika butuh `application/problem+json` untuk error:

```java
.type("application/problem+json")
```

Pastikan provider bisa menulisnya.

---

## 34. Testing JSON Contract

Unit test service tidak cukup.

Kamu perlu test yang melewati Jersey provider pipeline.

### 34.1 Serializer Contract Test

```java
@Test
void customerResponse_shouldSerializeAsContract() throws Exception {
    ObjectMapper mapper = ApiObjectMapperFactory.create();

    CustomerResponse response = new CustomerResponse(
        "C001",
        "Alice",
        "ACTIVE",
        Instant.parse("2026-06-16T03:30:00Z")
    );

    String json = mapper.writeValueAsString(response);

    assertThat(json).isEqualTo("""
        {"id":"C001","name":"Alice","status":"ACTIVE","createdAt":"2026-06-16T03:30:00Z"}
        """.trim());
}
```

### 34.2 Jersey Runtime Test

Gunakan Jersey Test Framework untuk memastikan provider benar-benar aktif.

Conceptual:

```java
public class CustomerResourceTest extends JerseyTest {

    @Override
    protected Application configure() {
        return new ResourceConfig()
            .register(CustomerResource.class)
            .register(JacksonFeature.class)
            .register(ObjectMapperProvider.class);
    }

    @Test
    void getCustomer_shouldReturnJsonContract() {
        Response response = target("customers/C001")
            .request(MediaType.APPLICATION_JSON_TYPE)
            .get();

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getMediaType().toString()).contains("application/json");

        String body = response.readEntity(String.class);
        assertThat(body).contains("\"createdAt\":\"2026-06-16T03:30:00Z\"");
    }
}
```

### 34.3 Negative Tests

Test invalid JSON:

```http
POST /customers
Content-Type: application/json

{ invalid
```

Expected:

```text
400 invalid_json
```

Test wrong content type:

```http
POST /customers
Content-Type: text/plain

hello
```

Expected:

```text
415 unsupported_media_type
```

Test unacceptable Accept:

```http
GET /customers/C001
Accept: application/xml
```

Expected if XML unsupported:

```text
406 not_acceptable
```

Test unknown property if strict:

```json
{
  "name": "Alice",
  "unknown": "x"
}
```

Test primitive null:

```json
{
  "quantity": null
}
```

Test enum unknown:

```json
{
  "status": "SOMETHING_NEW"
}
```

Contract tests should detect accidental provider changes.

---

## 35. Dependency Governance

### 35.1 Check Dependency Tree

Maven:

```bash
mvn dependency:tree | grep -E "jersey|jackson|jsonb|yasson|moxy|jakarta.ws.rs|javax.ws.rs"
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath
```

Cari:

```text
org.glassfish.jersey.media:jersey-media-json-jackson
org.glassfish.jersey.media:jersey-media-json-binding
org.glassfish.jersey.media:jersey-media-moxy
com.fasterxml.jackson.jaxrs:jackson-jaxrs-json-provider
com.fasterxml.jackson.jakarta.rs:jackson-jakarta-rs-json-provider
jakarta.json.bind:jakarta.json.bind-api
org.eclipse:yasson
org.eclipse.persistence:org.eclipse.persistence.moxy
javax.ws.rs:javax.ws.rs-api
jakarta.ws.rs:jakarta.ws.rs-api
```

### 35.2 Enforce Convergence

Gunakan dependency management/BOM.

Maven example concept:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.glassfish.jersey</groupId>
            <artifactId>jersey-bom</artifactId>
            <version>${jersey.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
        <dependency>
            <groupId>com.fasterxml.jackson</groupId>
            <artifactId>jackson-bom</artifactId>
            <version>${jackson.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

Pastikan BOM kompatibel dengan Jersey version dan namespace era.

### 35.3 Avoid Mixed Era Artifacts

Salah:

```text
jakarta.ws.rs-api + jackson-jaxrs-json-provider javax-era
```

Salah:

```text
javax.ws.rs-api + jackson-jakarta-rs-json-provider jakarta-era
```

Salah:

```text
Jersey 2.x + jakarta imports
```

Salah:

```text
Jersey 4.x + Java 8 target
```

---

## 36. Java 8 sampai Java 25 Considerations

### 36.1 Java 8

- No records.
- No sealed classes.
- Java time API available but needs module support in Jackson.
- Common with Jersey 2.x/javax.
- DTO often class + getters/setters/constructors.
- Beware old Jackson versions.
- Stronger need for dependency pinning.

### 36.2 Java 11

- Common modernization baseline.
- Still no records finalized.
- Better TLS/runtime than Java 8.
- Can run Jersey 2.x/3.x depending dependency stack.
- Migration bridge era.

### 36.3 Java 17

- LTS and common Jakarta EE 10/11 baseline.
- Records available.
- Sealed classes available.
- Pattern matching evolution starts to help DTO/domain handling.
- Jersey 3/4 more relevant.

### 36.4 Java 21

- LTS.
- Virtual threads relevant for server/client blocking calls, but JSON serialization itself remains CPU/allocation-bound.
- Records/sealed mature.
- Better runtime performance/GC options.

### 36.5 Java 25

- Modern LTS line.
- Treat as long-term modernization target.
- Jersey/Jakarta dependencies must be checked for official support.
- JSON provider libraries must be aligned with runtime.
- Avoid assuming Java 25 automatically improves serialization bottlenecks.

Key point:

```text
Java version changes language/runtime capability.
JSON contract stability still depends on provider config and DTO design.
```

---

## 37. Production Failure Modes and Diagnosis

### 37.1 `No MessageBodyWriter found`

Possible causes:

```text
No JSON provider registered
Wrong media type
Provider cannot write type
Generic type erased incorrectly
javax/jakarta mismatch
Response entity type is weird/proxy/internal class
Provider conflict
```

Diagnosis:

```text
[ ] Is @Produces application/json?
[ ] Is Jackson/JSON-B/MOXy module present?
[ ] Is provider registered?
[ ] Is media type vendor +json supported?
[ ] Is entity a DTO or JPA proxy?
[ ] Is runtime javax or jakarta?
[ ] Does Jersey Test reproduce?
```

### 37.2 `No MessageBodyReader found`

Possible causes:

```text
No JSON provider registered
Content-Type missing/wrong
Request parameter type not readable
Generic type issue
Provider not matching application/vnd...+json
javax/jakarta mismatch
```

Diagnosis:

```text
[ ] Does request include Content-Type: application/json?
[ ] Does method have entity parameter?
[ ] Is DTO constructible/deserializable?
[ ] Is provider registered server-side?
[ ] Are imports consistent?
```

### 37.3 Infinite Recursion

Cause:

```text
Bidirectional object graph serialized directly
```

Fix:

```text
Use response DTO
Map explicit graph
Avoid entity exposure
```

### 37.4 Lazy Initialization Error

Cause:

```text
Serializer touches lazy proxy outside transaction
```

Fix:

```text
Fetch required data intentionally
Map to DTO inside service/transaction boundary
Serialize DTO only
```

### 37.5 Date Format Changed After Dependency Upgrade

Cause:

```text
ObjectMapper config changed
Provider changed
JavaTimeModule missing
WRITE_DATES_AS_TIMESTAMPS changed
```

Fix:

```text
Centralize mapper
Contract test JSON output
Pin dependency versions
Review provider registration
```

### 37.6 Jackson Annotation Ignored

Cause:

```text
JSON-B/MOXy provider active instead of Jackson
```

Fix:

```text
Check provider registry/dependency tree
Register Jackson explicitly
Remove/disable unintended provider
```

### 37.7 400 Instead of Validation Error

Cause:

```text
JSON parse/deserialization fails before validation
```

Fix:

```text
Map parse errors separately
Do not expect Bean Validation for malformed JSON
```

### 37.8 500 When Returning ErrorResponse

Cause:

```text
ErrorResponse itself cannot be serialized
JSON provider missing
Exception mapper throws exception
Circular reference in error object
```

Fix:

```text
Keep error DTO simple
Test exception mapper through Jersey runtime
```

---

## 38. Recommended Enterprise JSON Architecture for Jersey

A robust architecture:

```text
api-platform-json
│
├── ApiObjectMapperFactory
├── ApiJsonFeature
├── JerseyObjectMapperProvider
├── ErrorResponse DTOs
├── JsonExceptionMappers
├── JsonContractTestSupport
└── Dependency governance/BOM rules
```

Resource layer:

```text
Resource receives request DTO
Resource calls application service
Service returns domain/application result
Assembler maps result to response DTO
Jersey provider serializes response DTO
```

Do not:

```text
Resource returns JPA entity
Service returns Response
Serializer enforces authorization
ObjectMapper created per method
Provider discovered accidentally
```

Do:

```text
Explicit provider registration
DTO allow-list
Central mapper config
Contract tests
Error taxonomy
Payload limits
Sensitive data masking
Dependency convergence
```

---

## 39. Reference Implementation Sketch

### 39.1 ResourceConfig

```java
public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        packages("com.acme.caseapi.resources");

        register(ApiJsonFeature.class);
        register(ApiExceptionMapper.class);
        register(JsonParseExceptionMapper.class);
        register(ValidationExceptionMapper.class);
    }
}
```

### 39.2 Feature

```java
public final class ApiJsonFeature implements Feature {

    @Override
    public boolean configure(FeatureContext context) {
        context.register(JacksonFeature.class);
        context.register(new ApiObjectMapperProvider(ApiObjectMapperFactory.create()));
        return true;
    }
}
```

### 39.3 Provider

```java
@Provider
public final class ApiObjectMapperProvider implements ContextResolver<ObjectMapper> {

    private final ObjectMapper mapper;

    public ApiObjectMapperProvider(ObjectMapper mapper) {
        this.mapper = Objects.requireNonNull(mapper, "mapper");
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

### 39.4 DTO

```java
public record CaseResponse(
    String id,
    String status,
    String applicantName,
    Instant submittedAt,
    List<String> availableActions
) {
}
```

Java 8 equivalent:

```java
public final class CaseResponse {

    private final String id;
    private final String status;
    private final String applicantName;
    private final Instant submittedAt;
    private final List<String> availableActions;

    @JsonCreator
    public CaseResponse(
            @JsonProperty("id") String id,
            @JsonProperty("status") String status,
            @JsonProperty("applicantName") String applicantName,
            @JsonProperty("submittedAt") Instant submittedAt,
            @JsonProperty("availableActions") List<String> availableActions) {
        this.id = id;
        this.status = status;
        this.applicantName = applicantName;
        this.submittedAt = submittedAt;
        this.availableActions = availableActions == null
            ? List.of()
            : List.copyOf(availableActions);
    }

    public String getId() {
        return id;
    }

    public String getStatus() {
        return status;
    }

    public String getApplicantName() {
        return applicantName;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }

    public List<String> getAvailableActions() {
        return availableActions;
    }
}
```

For Java 8, replace `List.of()` and `List.copyOf()` with compatible alternatives:

```java
this.availableActions = availableActions == null
    ? Collections.emptyList()
    : Collections.unmodifiableList(new ArrayList<>(availableActions));
```

### 39.5 Resource

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public final class CaseResource {

    private final CaseApplicationService caseService;
    private final CaseResponseAssembler assembler;

    public CaseResource(
            CaseApplicationService caseService,
            CaseResponseAssembler assembler) {
        this.caseService = caseService;
        this.assembler = assembler;
    }

    @GET
    @Path("/{caseId}")
    public CaseResponse getCase(@PathParam("caseId") String caseId) {
        CaseView view = caseService.getCaseView(caseId);
        return assembler.toResponse(view);
    }
}
```

### 39.6 Assembler

```java
public final class CaseResponseAssembler {

    public CaseResponse toResponse(CaseView view) {
        return new CaseResponse(
            view.caseId().value(),
            view.status().name(),
            view.applicantName(),
            view.submittedAt(),
            view.availableActions().stream()
                .map(Enum::name)
                .toList()
        );
    }
}
```

Java 8 stream equivalent:

```java
List<String> actions = view.availableActions().stream()
    .map(Enum::name)
    .collect(Collectors.toList());
```

---

## 40. Decision Matrix

| Decision | Prefer | Avoid |
|---|---|---|
| JSON provider | One explicit provider | Accidental multiple providers |
| API model | DTO allow-list | JPA entity exposure |
| ObjectMapper | Central factory/provider | `new ObjectMapper()` everywhere |
| Date/time | ISO-8601 with Java Time | Ambiguous strings/timestamps |
| Money | BigDecimal/string/minor unit | double/float |
| Unknown fields | Deliberate tolerant/strict policy | Accidental behavior |
| PATCH | Merge Patch/JSON Patch/tri-state | Plain DTO losing absent/null semantics |
| Error response | Simple stable DTO | Throwable/stack trace serialization |
| Polymorphism | Explicit subtype names/commands | Default typing for untrusted input |
| Field authorization | Explicit assembler | Serializer magic as primary auth |
| Testing | Jersey runtime + contract tests | Only service unit tests |

---

## 41. Practical Checklist

Before considering JSON in Jersey production-ready:

```text
[ ] We know whether we use Jackson, JSON-B, or MOXy.
[ ] Provider is registered explicitly.
[ ] Dependency tree does not contain unintended JSON providers.
[ ] javax/jakarta namespace is consistent.
[ ] ObjectMapper/Jsonb config is centralized.
[ ] Date/time format is specified and tested.
[ ] Null/absent semantics are documented.
[ ] Request DTOs use wrapper types where null matters.
[ ] JPA entities are not returned directly.
[ ] Lazy proxy serialization is not relied upon.
[ ] Error payload is stable and simple.
[ ] Invalid JSON maps to clear 400 error.
[ ] Wrong Content-Type maps to 415.
[ ] Wrong Accept maps to 406.
[ ] Contract tests cover representative DTOs.
[ ] Large payload strategy is defined.
[ ] Sensitive fields are not logged or exposed.
[ ] Polymorphic deserialization is not unsafe.
[ ] Jersey Client uses compatible JSON provider.
[ ] Provider behavior is tested under actual Jersey runtime.
```

---

## 42. Exercises

### Exercise 1 — Provider Diagnosis

Given dependency tree:

```text
org.glassfish.jersey.media:jersey-media-json-jackson
org.glassfish.jersey.media:jersey-media-json-binding
org.eclipse:yasson
com.fasterxml.jackson.core:jackson-databind
```

Answer:

1. What risk exists?
2. How would you make provider selection deterministic?
3. What tests would you add?

### Exercise 2 — DTO Redesign

Given entity:

```java
@Entity
public class EnforcementCase {
    private Long id;
    private String caseNo;
    private String internalRiskScore;
    private String officerInternalComment;
    private LocalDateTime createdDateTime;
    private List<CaseDocument> documents;
}
```

Design a safe `CaseResponse` DTO.

Questions:

1. Which fields should be exposed?
2. Should `createdDateTime` be `Instant`, `OffsetDateTime`, or `LocalDateTime`?
3. How would you handle documents?
4. How would authorization affect the response?

### Exercise 3 — PATCH Semantics

Given request:

```json
{
  "email": null
}
```

What should it mean for:

1. POST create?
2. PUT replace?
3. PATCH merge?
4. PATCH operation command?

### Exercise 4 — Error Contract

Design JSON error payload for:

1. malformed JSON;
2. unknown enum value;
3. validation failure;
4. lazy serialization failure;
5. unauthorized field access.

Which are client errors and which are server design/runtime errors?

### Exercise 5 — Migration

You migrate from Jersey 2.x to Jersey 4.x.

List likely JSON-related changes:

1. package namespace;
2. dependency artifacts;
3. provider module;
4. Jackson Jakarta-RS provider;
5. tests that must be run;
6. failure symptoms.

---

## 43. Key Takeaways

1. JSON in Jersey is implemented through `MessageBodyReader` and `MessageBodyWriter` providers.
2. Jackson, JSON-B, and MOXy are different provider strategies with different trade-offs.
3. Production systems should not rely on accidental provider discovery.
4. Central JSON configuration is part of platform architecture.
5. DTOs are API contracts, not persistence entities.
6. Date/time, money, null/absent semantics, enum values, and error shape are contract decisions.
7. Unsafe polymorphism and direct entity serialization are serious risks.
8. Jersey Client needs JSON provider governance too.
9. Contract tests must go through the actual Jersey provider pipeline.
10. Java 8–25 affects DTO language features and runtime compatibility, but does not remove the need for explicit JSON governance.

---

## 44. References

Primary references to verify concepts and version direction:

- Eclipse Jersey User Guide — Support for Common Media Type Representations: `https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/media.html`
- Eclipse Jersey User Guide — Message Body Workers: `https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/message-body-workers.html`
- Jakarta RESTful Web Services 4.0 Specification: `https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0`
- Jakarta RESTful Web Services API — `MessageBodyReader`: `https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/messagebodyreader`
- Jackson Jakarta-RS JSON Provider documentation: `https://javadoc.io/doc/com.fasterxml.jackson.jakarta.rs/jackson-jakarta-rs-json-provider`
- Jakarta JSON Binding / JSON-B overview: `https://jakarta.ee/specifications/jsonb/`

---

## 45. Status Seri

Progress:

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — berikutnya
...
Part 32 — target akhir / capstone
```

Seri belum selesai. Bagian berikutnya:

> Part 8 — Response Engineering: Status, Headers, Entities, Streaming, Caching, Conditional Requests

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./06-entity-provider-pipeline-messagebodyreader-messagebodywriter-provider-selection.md">⬅️ Part 6 — Entity Provider Pipeline: `MessageBodyReader`, `MessageBodyWriter`, and Provider Selection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./08-response-engineering-status-headers-entities-streaming-caching-conditional-requests.md">Part 8 — Response Engineering: Status, Headers, Entities, Streaming, Caching, Conditional Requests ➡️</a>
</div>
