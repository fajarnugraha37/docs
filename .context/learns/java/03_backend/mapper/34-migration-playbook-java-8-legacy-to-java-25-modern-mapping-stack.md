# Part 34 — Migration Playbook: Java 8 Legacy to Java 25 Modern Mapping Stack

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `34-migration-playbook-java-8-legacy-to-java-25-modern-mapping-stack.md`  
> Status: Part 34 dari 35  
> Fokus: playbook migrasi mapping layer dari Java 8 legacy menuju Java modern sampai Java 25, dengan Jackson, MapStruct, Lombok, records, compatibility harness, rollback, dan governance.

---

## 1. Tujuan Part Ini

Bagian ini menjawab pertanyaan besar:

> Bagaimana memodernisasi mapping layer Java 8 legacy ke Java modern tanpa merusak kontrak API, persistence behavior, event payload, audit trail, integrasi eksternal, dan build pipeline?

Migrasi mapping layer sering terlihat seperti pekerjaan mekanis:

- ganti DTO mutable menjadi record;
- ganti manual mapper menjadi MapStruct;
- ganti `ObjectMapper` lama menjadi konfigurasi modern;
- kurangi Lombok;
- upgrade Jackson;
- ganti `javax` ke `jakarta`;
- upgrade JDK.

Tetapi secara engineering, migrasi ini jauh lebih berisiko dari kelihatannya. Mapping layer berada di banyak boundary sekaligus:

```text
HTTP JSON request
    -> deserialization
    -> request DTO
    -> command/query model
    -> domain object
    -> persistence entity
    -> audit/event payload
    -> response DTO
    -> serialization
    -> HTTP JSON response
```

Jika mapping berubah sedikit saja, efeknya bisa muncul sebagai:

- response field hilang;
- field `null` berubah menjadi absent;
- date/time berubah format;
- enum unknown gagal diparse;
- PATCH tidak sengaja overwrite database;
- lazy proxy JPA tiba-tiba terserialisasi;
- `equals/hashCode` entity berubah karena Lombok;
- generated mapper gagal compile setelah upgrade JDK;
- client lama gagal karena strictness berubah;
- audit/event payload tidak backward compatible;
- rollback susah karena data sudah terlanjur ditulis dalam shape baru.

Karena itu, playbook ini memakai prinsip:

> Modernisasi mapping layer harus dilakukan sebagai migration of observable contracts, bukan sekadar migration of source code.

---

## 2. Mental Model: Migrasi Mapping = Migrasi Boundary

Sebelum menyentuh code, kita harus mengubah cara melihat migrasi.

### 2.1 Yang Sebenarnya Dimigrasikan

Ketika kita bilang “migrasi DTO/mapping”, sebenarnya ada beberapa hal berbeda:

| Yang Dimigrasikan | Contoh | Risiko Utama |
|---|---|---|
| Java language model | POJO mutable -> record | constructor binding, binary/source compatibility |
| Annotation processing | Lombok/MapStruct processor | build order, IDE mismatch, generated code berubah |
| Serialization runtime | Jackson 2 -> Jackson 3 | package/API change, default behavior change |
| Contract shape | JSON/XML field shape | client compatibility |
| Null semantics | `null`, absent, default | PATCH bug, validation bug |
| Type semantics | date, enum, decimal, ID | data corruption halus |
| Persistence interaction | entity -> DTO | lazy load, N+1, proxy leakage |
| Integration payload | external DTO | partner contract break |
| Test strategy | unit-only -> golden/contract | false confidence |

Migrasi sukses bukan berarti semua code compile. Migrasi sukses berarti:

1. output observable tetap kompatibel;
2. input lama masih diterima sesuai policy;
3. data tersimpan tidak rusak;
4. rollback masih mungkin;
5. mapping behavior bisa dibuktikan dengan test;
6. developer berikutnya tahu boundary mana yang boleh berubah.

### 2.2 Tiga Lapisan yang Tidak Boleh Dicampur

Dalam migrasi, selalu pisahkan tiga lapisan ini:

```text
1. Language/runtime migration
   Java 8 -> 11 -> 17 -> 21 -> 25

2. Library migration
   Jackson 2 -> Jackson 3
   MapStruct version upgrade
   Lombok version upgrade/reduction
   javax -> jakarta

3. Contract migration
   DTO shape
   JSON/XML semantics
   enum/date/null/required behavior
   external API/event/audit compatibility
```

Kesalahan umum adalah melakukan semuanya sekaligus. Itu menciptakan situasi di mana saat test gagal, kita tidak tahu penyebabnya:

- apakah karena Java version?
- apakah karena Jackson behavior?
- apakah karena Lombok generated constructor berubah?
- apakah karena MapStruct builder detection berubah?
- apakah karena DTO shape memang berubah?

Prinsip migrasi:

> Pisahkan migrasi compiler/runtime dari migrasi contract. Jangan ubah behavior saat mengganti infrastruktur, kecuali memang diproteksi oleh compatibility test.

---

## 3. Target Akhir Modern Mapping Stack

Target akhir bukan “semua harus record” atau “semua harus MapStruct”. Target akhir adalah mapping stack yang explicit, safe, testable, evolvable.

### 3.1 Target Architecture

```text
[External Input]
      |
      v
[Boundary DTO]
  - Jackson/JAXB binding
  - API-specific annotations
  - validation annotations where appropriate
      |
      v
[Boundary Mapper]
  - MapStruct/manual mapping
  - normalization decision explicit
  - no hidden persistence access
      |
      v
[Application Command/Query]
  - semantic object
  - no serialization annotation if possible
      |
      v
[Domain/Application Logic]
      |
      v
[Persistence Mapper / Projection]
      |
      v
[Entity / SQL Projection / Event Payload]
```

### 3.2 Desired Properties

Modern mapping layer harus punya properti berikut:

1. **Contract explicit**  
   DTO yang keluar/masuk boundary tidak bergantung pada kebetulan field entity.

2. **Mapping explicit**  
   Perubahan field penting terlihat di mapper, bukan terjadi otomatis tanpa review.

3. **Null semantics defined**  
   `null`, absent, empty, default, dan unknown punya arti jelas.

4. **Generated code inspectable**  
   MapStruct/Lombok generated effect bisa dipahami dan diuji.

5. **Serialization profile separated**  
   External API, internal event, cache, audit, dan debug tidak wajib memakai `ObjectMapper` global yang sama.

6. **Version evolution supported**  
   Field rename/deprecation/addition punya policy.

7. **Migration reversible**  
   Step migrasi kecil, ada rollback, ada compatibility harness.

8. **No entity leakage**  
   JPA entity tidak menjadi public JSON contract.

9. **No unbounded magic**  
   Reflection mapper/generic mapper tidak mengubah contract tanpa compile-time visibility.

10. **Reviewable by senior engineer**  
   Pull request mapping bisa direview berdasarkan checklist, bukan feeling.

---

## 4. Inventory Fase 0: Peta Sebelum Migrasi

Jangan mulai migrasi sebelum tahu apa yang ada.

### 4.1 Inventory DTO

Buat daftar DTO berdasarkan boundary:

```text
src/main/java
  com.example.api.dto
  com.example.api.request
  com.example.api.response
  com.example.application.command
  com.example.persistence.projection
  com.example.integration.partnerx.dto
  com.example.event.payload
  com.example.audit.dto
```

Untuk setiap DTO, catat:

| Field | Arti |
|---|---|
| Nama class | misalnya `ApplicationDto` |
| Boundary | public API, internal API, event, persistence, integration |
| Direction | inbound, outbound, both |
| Consumer | UI, mobile app, partner API, reporting, queue consumer |
| Versioned? | ya/tidak |
| Jackson annotations? | ada/tidak |
| Lombok annotations? | `@Data`, `@Builder`, etc |
| Used as JPA entity? | ya/tidak |
| Used in cache/event/audit? | ya/tidak |
| Golden payload exists? | ya/tidak |

Tujuan inventory bukan dokumentasi cantik. Tujuannya menemukan area berisiko.

### 4.2 Inventory Mapper

Cari semua bentuk mapping:

```text
Manual mapper:
- toDto(...)
- fromDto(...)
- assemble(...)
- convert(...)
- populate(...)

MapStruct:
- @Mapper
- @Mapping
- @MappingTarget

Jackson implicit mapping:
- direct entity serialization
- readValue into entity
- JsonNode manipulation

Reflection mapper:
- BeanUtils.copyProperties
- ModelMapper
- Dozer
- custom reflection copier

SQL projection:
- constructor projection
- interface projection
- tuple/object[] mapping
```

Pertanyaan penting:

- Mapper mana yang mengandung logic bisnis?
- Mapper mana yang memanggil repository/service?
- Mapper mana yang punya side effect?
- Mapper mana yang melakukan PATCH/update entity?
- Mapper mana yang menyentuh field audit/status/security?
- Mapper mana yang tidak punya test?

### 4.3 Inventory ObjectMapper

Cari semua `ObjectMapper`:

```bash
rg "new ObjectMapper|ObjectMapper|JsonMapper|XmlMapper" src test
```

Kategorikan:

| ObjectMapper | Pemakai | Purpose | Risiko |
|---|---|---|---|
| Spring global mapper | REST API | HTTP JSON | perubahan global memengaruhi semua endpoint |
| Kafka/event mapper | event payload | async contract | compatibility consumer |
| Audit mapper | audit JSON | forensic/logging | legal/regulatory concern |
| Cache mapper | Redis | internal serialized object | rollback/data version |
| Test mapper | tests | assertion | beda dengan prod mapper |
| Ad-hoc mapper | random util | unknown | behavior drift |

Red flag:

```java
public class JsonUtils {
    private static final ObjectMapper MAPPER = new ObjectMapper();
}
```

atau:

```java
new ObjectMapper().writeValueAsString(obj)
```

Jika banyak mapper ad-hoc, migrasi Jackson akan menyakitkan karena konfigurasi tersebar.

### 4.4 Inventory Lombok

Cari annotation Lombok:

```bash
rg "@Data|@Value|@Builder|@SuperBuilder|@Getter|@Setter|@EqualsAndHashCode|@ToString|@NoArgsConstructor|@AllArgsConstructor|@Jacksonized" src
```

Klasifikasi:

| Annotation | Risiko |
|---|---|
| `@Getter` | rendah |
| `@Setter` | sedang, tergantung mutability |
| `@Data` | tinggi, karena terlalu banyak generated behavior |
| `@Builder` | sedang/tinggi, interaksi Jackson/MapStruct |
| `@SuperBuilder` | tinggi, inheritance complexity |
| `@EqualsAndHashCode` | tinggi di JPA entity |
| `@ToString` | tinggi jika ada cycle/sensitive field |
| `@NoArgsConstructor(force = true)` | tinggi untuk immutable field |
| `@Jacksonized` | useful, tetapi contract harus diuji |

### 4.5 Inventory `javax` / `jakarta`

Java 8 legacy sering punya:

```java
javax.validation.*
javax.persistence.*
javax.xml.bind.*
javax.ws.rs.*
```

Modern Jakarta stack memakai:

```java
jakarta.validation.*
jakarta.persistence.*
jakarta.xml.bind.*
jakarta.ws.rs.*
```

Untuk mapping layer, dampak paling sering:

- validation annotation di DTO pindah package;
- JAXB annotation pindah package;
- JPA entity annotation pindah package;
- generated source atau mapper import berubah;
- test fixture dan reflection scan berubah;
- dependency split dari JDK karena JAXB tidak lagi bundled di JDK modern.

---

## 5. Risk Classification: Jangan Migrasi Semua dengan Strategi yang Sama

Tidak semua DTO/mapper punya risiko sama.

### 5.1 Risk Level

| Level | Contoh | Strategi |
|---|---|---|
| Low | internal DTO tanpa persistence/event | refactor cepat, unit test cukup |
| Medium | REST response DTO consumed UI sendiri | golden response + integration test |
| High | public API/request DTO, PATCH update | contract test + negative tests + staged rollout |
| Critical | event payload, audit payload, partner integration, persisted JSON | versioning + dual read/write + rollback plan |

### 5.2 Critical Mapping Smells

Waspadai class/method berikut:

```java
// 1. Entity langsung jadi response
@GetMapping("/{id}")
public ApplicationEntity get(@PathVariable Long id) { ... }

// 2. Request langsung bind ke entity
@PostMapping
public void create(@RequestBody ApplicationEntity entity) { ... }

// 3. Reflection copy tanpa policy
BeanUtils.copyProperties(request, entity);

// 4. @Data di entity dengan relationship
@Data
@Entity
class CaseEntity { ... }

// 5. PATCH pakai DTO biasa tanpa absent/null semantics
void update(UpdateRequest request, Entity entity) {
    mapper.update(request, entity);
}

// 6. Global ObjectMapper diubah untuk satu use case
objectMapper.configure(FAIL_ON_UNKNOWN_PROPERTIES, false);

// 7. Event payload memakai domain/entity class
publisher.publish(entity);
```

Red flag ini harus diprioritaskan sebelum migrasi besar.

---

## 6. Compatibility Harness: Safety Net Sebelum Refactor

Sebelum mengubah code, buat harness untuk membuktikan behavior lama.

### 6.1 Golden Payload Tests

Golden payload adalah payload JSON/XML yang mewakili kontrak nyata.

Struktur contoh:

```text
src/test/resources/contracts/application-response/v1/
  happy-path.json
  null-optional-fields.json
  full-fields.json
  deprecated-field.json
  unknown-future-field.json

src/test/resources/contracts/application-request/v1/
  create-minimal.json
  create-full.json
  update-patch-null.json
  update-patch-absent.json
  invalid-enum.json
```

Test response:

```java
@Test
void shouldSerializeApplicationResponseLikeGoldenPayload() throws Exception {
    ApplicationResponse response = fixtureApplicationResponse();

    String actual = externalApiObjectMapper.writeValueAsString(response);

    assertJsonEqualsResource(
        "/contracts/application-response/v1/happy-path.json",
        actual
    );
}
```

Test request:

```java
@Test
void shouldDeserializeLegacyRequestPayload() throws Exception {
    String json = resource("/contracts/application-request/v1/create-full.json");

    CreateApplicationRequest request = externalApiObjectMapper.readValue(
        json,
        CreateApplicationRequest.class
    );

    assertThat(request.applicantName()).isEqualTo("Alice Tan");
    assertThat(request.submissionType()).isEqualTo(SubmissionType.NEW);
}
```

### 6.2 Round-Trip Test: Pakai Secara Terbatas

Round-trip test berguna, tetapi jangan terlalu percaya.

```java
T value = mapper.readValue(mapper.writeValueAsString(original), T.class);
assertThat(value).isEqualTo(original);
```

Masalahnya, round-trip bisa lulus walaupun contract external salah, karena serializer dan deserializer sama-sama salah.

Pakai round-trip untuk:

- cache payload internal;
- immutable DTO sanity check;
- custom serializer/deserializer pair.

Jangan jadikan round-trip sebagai satu-satunya contract test.

### 6.3 Dual Mapper Comparison

Saat migrasi mapper lama ke MapStruct:

```java
@Test
void newMapperShouldMatchLegacyMapperForKnownFixture() {
    ApplicationEntity entity = fixtureEntity();

    ApplicationResponse oldResponse = legacyMapper.toResponse(entity);
    ApplicationResponse newResponse = mapStructMapper.toResponse(entity);

    assertThat(newResponse).usingRecursiveComparison()
        .isEqualTo(oldResponse);
}
```

Untuk JSON contract, bandingkan output serialized:

```java
String oldJson = objectMapper.writeValueAsString(oldMapper.toResponse(entity));
String newJson = objectMapper.writeValueAsString(newMapper.toResponse(entity));

assertJsonEquals(oldJson, newJson);
```

### 6.4 Compatibility Matrix

Buat matrix minimum:

| Scenario | Old payload | New code reads? | New payload | Old consumer reads? |
|---|---:|---:|---:|---:|
| Add optional field | yes | yes | yes | yes |
| Rename field with alias | yes | yes | yes | depends |
| Remove field | yes | no/yes? | yes | no |
| Enum add value | yes | yes | yes | depends |
| Date format change | yes | maybe | yes | maybe |
| Null -> absent | yes | maybe | yes | maybe |

Kalau tidak bisa menjawab matrix ini, migrasi belum siap.

---

## 7. Migration Sequence: Urutan Aman

Berikut urutan yang disarankan untuk codebase enterprise.

```text
Phase 0: Inventory and risk classification
Phase 1: Build compatibility harness
Phase 2: Centralize ObjectMapper profiles
Phase 3: Remove direct entity exposure
Phase 4: Stabilize DTO contracts
Phase 5: Introduce MapStruct gradually
Phase 6: Contain Lombok risk
Phase 7: Introduce records selectively
Phase 8: javax -> jakarta migration where needed
Phase 9: Jackson 2 hardening before Jackson 3
Phase 10: Jackson 3 migration planning/execution
Phase 11: Java 21/25 language modernization
Phase 12: Governance and cleanup
```

Penting: tidak semua organisasi perlu sampai phase 12 dalam satu cycle. Pilih berdasarkan risk dan value.

---

## 8. Phase 1 — Compatibility Harness First

Jangan mulai dari refactor. Mulai dari test yang mengunci behavior penting.

### 8.1 Minimal Harness untuk REST API

Untuk setiap endpoint penting:

- satu happy path response golden JSON;
- satu minimal request payload;
- satu full request payload;
- satu unknown field payload jika forward compatibility diperlukan;
- satu null/absent test untuk field penting;
- satu enum invalid/unknown test;
- satu date/time format test.

Contoh:

```java
class ApplicationContractTest {

    private final ObjectMapper mapper = ExternalApiJson.mapper();

    @Test
    void createRequestShouldAcceptLegacyPayload() throws Exception {
        String json = resource("/contracts/application/create-request-v1.json");

        CreateApplicationRequest request = mapper.readValue(json, CreateApplicationRequest.class);

        assertThat(request).isNotNull();
        assertThat(request.applicationType()).isEqualTo(ApplicationType.NEW);
    }

    @Test
    void responseShouldMatchGoldenJson() throws Exception {
        ApplicationResponse response = fixtureResponse();

        assertJsonEqualsResource(
            "/contracts/application/response-v1.json",
            mapper.writeValueAsString(response)
        );
    }
}
```

### 8.2 Minimal Harness untuk Event

Event payload lebih kritikal karena consumer bisa asynchronous dan tidak deploy bersamaan.

```java
@Test
void shouldKeepApplicationSubmittedEventV1Stable() throws Exception {
    ApplicationSubmittedEvent event = fixtureEvent();

    String actual = eventObjectMapper.writeValueAsString(event);

    assertJsonEqualsResource(
        "/contracts/events/application-submitted-v1.json",
        actual
    );
}
```

Untuk event, tambahkan deserialization compatibility:

```java
@Test
void shouldReadOldApplicationSubmittedEvent() throws Exception {
    String oldPayload = resource("/contracts/events/application-submitted-v1-old.json");

    ApplicationSubmittedEvent event = eventObjectMapper.readValue(
        oldPayload,
        ApplicationSubmittedEvent.class
    );

    assertThat(event.applicationId()).isEqualTo("APP-001");
}
```

### 8.3 Minimal Harness untuk XML

XML butuh canonical-ish comparison, bukan string compare polos.

Checklist XML:

- namespace URI benar;
- element order sesuai XSD jika required;
- attribute vs element tidak berubah;
- empty element vs absent element sesuai contract;
- parser aman dari XXE;
- signature/canonicalization tidak berubah jika payload signed.

---

## 9. Phase 2 — Centralize ObjectMapper Profiles

Sebelum upgrade Jackson, hentikan penyebaran `new ObjectMapper()`.

### 9.1 ObjectMapper Profile

Buat profile eksplisit:

```java
public final class JsonMappers {

    private JsonMappers() {}

    public static ObjectMapper externalApiMapper() {
        return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();
    }

    public static ObjectMapper internalEventMapper() {
        return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();
    }

    public static ObjectMapper auditMapper() {
        return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .build();
    }
}
```

Catatan: contoh di atas memakai Jackson 2 style `com.fasterxml.jackson.databind.json.JsonMapper`. Untuk Jackson 3, package dan beberapa API berubah; jangan hardcode asumsi tanpa branch migrasi.

### 9.2 Jangan Mutasi ObjectMapper Global Setelah Dipakai

Buruk:

```java
objectMapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
```

Lebih aman:

```java
private static final ObjectReader LENIENT_READER = objectMapper
    .readerFor(LegacyPayload.class)
    .without(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
```

Atau buat mapper profile terpisah.

### 9.3 Test Mapper Profile

Konfigurasi ObjectMapper juga harus diuji:

```java
@Test
void externalApiMapperShouldRejectUnknownFields() {
    String json = "{\"name\":\"Alice\",\"admin\":true}";

    assertThatThrownBy(() -> mapper.readValue(json, CreateUserRequest.class))
        .isInstanceOf(UnrecognizedPropertyException.class);
}
```

---

## 10. Phase 3 — Remove Direct Entity Exposure

Sebelum migrasi records/Jackson/MapStruct, hentikan entity leakage.

### 10.1 Jangan Return Entity dari Controller

Buruk:

```java
@GetMapping("/{id}")
public ApplicationEntity get(@PathVariable Long id) {
    return repository.findById(id).orElseThrow();
}
```

Aman:

```java
@GetMapping("/{id}")
public ApplicationResponse get(@PathVariable Long id) {
    Application application = service.getApplication(id);
    return mapper.toResponse(application);
}
```

### 10.2 Jangan Bind Request ke Entity

Buruk:

```java
@PostMapping
public void create(@RequestBody ApplicationEntity entity) {
    repository.save(entity);
}
```

Aman:

```java
@PostMapping
public void create(@Valid @RequestBody CreateApplicationRequest request) {
    CreateApplicationCommand command = mapper.toCommand(request);
    applicationService.create(command);
}
```

### 10.3 Kenapa Ini Harus Sebelum Modernisasi?

Kalau entity masih menjadi JSON contract, maka:

- perubahan JPA field bisa menjadi breaking API change;
- Lombok `@ToString`/`@EqualsAndHashCode` bisa memicu lazy loading;
- Jackson bisa melihat proxy/relationship internal;
- records tidak membantu karena akar masalahnya boundary bocor;
- MapStruct tidak bisa memberi value besar karena controller bypass mapper.

---

## 11. Phase 4 — Stabilize DTO Contracts

Sebelum ubah bentuk DTO, tetapkan contract-nya.

### 11.1 DTO Contract Annotation Policy

Buat aturan:

```java
public record ApplicationResponse(
    @JsonProperty("application_id")
    String applicationId,

    @JsonProperty("status")
    String status,

    @JsonProperty("submitted_at")
    OffsetDateTime submittedAt
) {}
```

Untuk public API, lebih baik eksplisit:

- `@JsonProperty` untuk nama external;
- `@JsonInclude` sesuai policy;
- date/time format standardized;
- enum strategy jelas;
- internal field tidak ada di DTO.

### 11.2 Jangan Bergantung pada Naming Strategy Global untuk Contract Kritis

Naming strategy global bisa berguna, tetapi untuk contract kritis, eksplisit lebih aman.

Risiko naming strategy global:

```java
private String URLValue;
private String userID;
private String XMLPayload;
```

Bentuk JSON hasil naming strategy bisa tidak sesuai ekspektasi manusia.

Untuk field kritis:

```java
@JsonProperty("user_id")
String userId;

@JsonProperty("xml_payload")
String xmlPayload;
```

### 11.3 Tentukan Null Policy

Contoh policy:

| Boundary | Null Policy |
|---|---|
| Public response | omit optional null jika documented |
| Public request | distinguish null vs absent untuk PATCH |
| Internal event | avoid optional absent for critical fields |
| Audit payload | preserve raw value including null |
| Cache payload | stable, versioned, explicit defaults |

---

## 12. Phase 5 — Introduce MapStruct Gradually

Jangan langsung rewrite semua mapper.

### 12.1 Pilih Kandidat Awal

Kandidat terbaik:

- mapper dengan pure field mapping;
- tidak ada repository/service call;
- tidak mengandung PATCH semantics rumit;
- punya golden/dual comparison test;
- bukan event/audit critical path pertama.

Kandidat buruk untuk awal:

- mapper yang update entity existing;
- mapper yang punya side effect;
- mapper yang mengandung legacy business rules tersembunyi;
- mapper yang dipakai banyak boundary sekaligus;
- mapper yang bersentuhan dengan JPA lazy relationship kompleks.

### 12.2 Dual Run Strategy

Untuk mapper kritikal, pakai dual comparison di test dulu:

```java
class ApplicationMapperCompatibilityTest {

    @Test
    void mapStructMapperShouldMatchLegacyMapper() {
        ApplicationEntity source = fixtureEntity();

        ApplicationResponse oldResult = legacyMapper.toResponse(source);
        ApplicationResponse newResult = mapStructMapper.toResponse(source);

        assertThat(newResult)
            .usingRecursiveComparison()
            .isEqualTo(oldResult);
    }
}
```

Jika hasil berbeda, klasifikasikan:

| Difference | Kemungkinan |
|---|---|
| field hilang | unmapped target/source |
| null berubah default | default/null strategy beda |
| nested object null | nested mapper behavior beda |
| collection empty vs null | collection initialization beda |
| enum beda | implicit enum mapping salah |
| date format beda | bukan MapStruct, serialization layer |

### 12.3 MapStruct Config Global

Buat config organisasi:

```java
@MapperConfig(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR,
    unmappedSourcePolicy = ReportingPolicy.WARN,
    nullValueCheckStrategy = NullValueCheckStrategy.ALWAYS
)
public interface CentralMapperConfig {
}
```

Lalu:

```java
@Mapper(config = CentralMapperConfig.class)
public interface ApplicationMapper {
    ApplicationResponse toResponse(ApplicationEntity entity);
}
```

Untuk legacy migration, kadang perlu mulai dengan `WARN`, lalu naik ke `ERROR` bertahap.

### 12.4 Jangan Jadikan MapStruct Tempat Business Logic Besar

Buruk:

```java
@Mapping(target = "eligible", expression = "java(service.checkEligibility(entity))")
ApplicationResponse toResponse(ApplicationEntity entity);
```

Lebih baik:

```java
ApplicationView view = applicationQueryService.getView(id);
ApplicationResponse response = mapper.toResponse(view);
```

Mapper boleh melakukan transformasi deterministik. Tetapi jika butuh I/O, authorization, workflow transition, atau policy kompleks, itu bukan mapper.

---

## 13. Phase 6 — Contain Lombok Risk

Migrasi Java modern bukan berarti langsung hapus Lombok. Tetapi Lombok harus dibatasi.

### 13.1 Buat Lombok Policy

Contoh allowlist:

| Annotation | Policy |
|---|---|
| `@Getter` | allowed |
| `@Setter` | allowed only mutable DTO/internal model |
| `@RequiredArgsConstructor` | allowed for DI/simple immutable class |
| `@Builder` | allowed for test fixture/complex immutable DTO with tests |
| `@Jacksonized` | allowed only with serialization/deserialization tests |
| `@Slf4j` | allowed |

Contoh restricted/denylist:

| Annotation | Policy |
|---|---|
| `@Data` | avoid for entity/domain/public DTO |
| `@EqualsAndHashCode` | restricted for JPA entity |
| `@ToString` | must exclude sensitive/cyclic fields |
| `@SuperBuilder` | restricted; inheritance mapping must be reviewed |
| `@NoArgsConstructor(force = true)` | restricted |

### 13.2 Gunakan `lombok.config`

Contoh:

```properties
config.stopBubbling = true

lombok.addLombokGeneratedAnnotation = true
lombok.anyConstructor.addConstructorProperties = true

lombok.data.flagUsage = warning
lombok.value.flagUsage = warning
lombok.superBuilder.flagUsage = warning
```

Tujuannya bukan memusuhi Lombok, tetapi membuat penggunaannya sadar.

### 13.3 Delombok untuk Audit Behavior

Untuk area yang sulit dipahami, jalankan delombok untuk melihat source efektif.

Gunakan saat:

- debug constructor binding;
- MapStruct tidak menemukan property;
- Jackson builder deserialization gagal;
- equals/hashCode entity aneh;
- upgrade JDK memicu error annotation processing;
- ingin refactor dari Lombok ke record/manual code.

### 13.4 Lombok + MapStruct

Untuk project yang memakai Lombok dan MapStruct, pastikan annotation processor path explicit.

Maven concept:

```xml
<annotationProcessorPaths>
    <path>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <version>${lombok.version}</version>
    </path>
    <path>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok-mapstruct-binding</artifactId>
        <version>${lombok-mapstruct-binding.version}</version>
    </path>
    <path>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct-processor</artifactId>
        <version>${mapstruct.version}</version>
    </path>
</annotationProcessorPaths>
```

Jika ini tidak deterministic, MapStruct bisa membaca class sebelum Lombok menghasilkan accessor/builder yang diharapkan.

---

## 14. Phase 7 — Introduce Records Selectively

Records bagus untuk DTO modern, tetapi bukan solusi universal.

### 14.1 Kandidat Bagus untuk Record

Gunakan record untuk:

- response DTO immutable;
- request DTO simple;
- command/query model;
- event payload immutable;
- projection read model;
- value object kecil;
- test fixture data object.

Contoh:

```java
public record ApplicationSummaryResponse(
    String applicationId,
    String applicantName,
    String status,
    OffsetDateTime submittedAt
) {}
```

### 14.2 Kandidat Buruk untuk Record

Hindari record untuk:

- JPA entity;
- object yang butuh lifecycle mutable panjang;
- PATCH request yang harus membedakan absent vs null tanpa wrapper;
- DTO dengan backward-compatible constructor kompleks;
- class yang dipakai framework lama yang butuh no-args constructor/setter;
- object dengan banyak optional field dan builder lebih readable.

### 14.3 Record dan Jackson

Record binding biasanya natural karena canonical constructor. Tetapi perhatikan:

```java
public record CreateUserRequest(
    @JsonProperty("email") String email,
    @JsonProperty("display_name") String displayName
) {}
```

Test wajib:

- missing field;
- null field;
- unknown field;
- invalid enum;
- date/time format;
- alias legacy field jika ada rename.

### 14.4 Record dan Compatibility

Mengubah POJO menjadi record bisa memengaruhi:

- constructor behavior;
- default value behavior;
- framework binding;
- equals/hashCode semantics;
- binary compatibility;
- mutability expectation;
- reflection-based code;
- serialization property detection.

Karena itu, jangan ubah public DTO menjadi record tanpa golden tests.

---

## 15. Phase 8 — `javax` to `jakarta` Migration

Bagian ini sering bersamaan dengan Spring Boot 3/Jakarta EE modern migration.

### 15.1 Mapping-Related Impact

| Legacy | Modern | Dampak Mapping |
|---|---|---|
| `javax.validation.*` | `jakarta.validation.*` | DTO validation imports berubah |
| `javax.xml.bind.*` | `jakarta.xml.bind.*` | JAXB/XML DTO annotation berubah |
| `javax.persistence.*` | `jakarta.persistence.*` | entity/projection mapping affected |
| `javax.annotation.*` | `jakarta.annotation.*` | generated/DI lifecycle annotation |

### 15.2 JAXB Tidak Lagi Built-in di JDK Modern

Java 8 codebase sering mengandalkan JAXB dari JDK. Di Java modern, dependency perlu explicit.

Contoh concept dependency:

```xml
<dependency>
    <groupId>jakarta.xml.bind</groupId>
    <artifactId>jakarta.xml.bind-api</artifactId>
</dependency>
<dependency>
    <groupId>org.glassfish.jaxb</groupId>
    <artifactId>jaxb-runtime</artifactId>
</dependency>
```

### 15.3 Jangan Ubah XML Contract Saat Ubah Package

Migrasi `javax.xml.bind.annotation.XmlElement` ke `jakarta.xml.bind.annotation.XmlElement` seharusnya tidak mengubah XML contract.

Buktikan dengan golden XML test:

```java
@Test
void xmlOutputShouldRemainStableAfterJakartaMigration() {
    String actual = marshal(dto);
    assertXmlEquivalentResource("/contracts/xml/application-v1.xml", actual);
}
```

---

## 16. Phase 9 — Jackson 2 Hardening Before Jackson 3

Sebelum lompat ke Jackson 3, buat Jackson 2 codebase sehat dulu.

### 16.1 Hilangkan `ObjectMapper` Ad-Hoc

Target:

- tidak ada `new ObjectMapper()` di business code;
- semua mapper via bean/factory/profile;
- test pakai mapper yang sama dengan production profile;
- custom serializer/deserializer diregister via module;
- config tidak dimutasi setelah mapper dipakai.

### 16.2 Hilangkan Deprecated/Unsafe Pattern

Contoh risk:

```java
objectMapper.enableDefaultTyping(); // unsafe/deprecated pattern in old Jackson
```

Gunakan polymorphism explicit dengan discriminator jika memang perlu.

### 16.3 Stabilkan Date/Time

Pastikan:

```java
.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
.addModule(new JavaTimeModule())
```

Dan contract test untuk:

- `LocalDate`;
- `LocalDateTime`;
- `OffsetDateTime`;
- timezone offset;
- legacy string date.

### 16.4 Lock Unknown Field Policy

External API mungkin strict:

```java
FAIL_ON_UNKNOWN_PROPERTIES = true
```

Event consumer mungkin tolerant:

```java
FAIL_ON_UNKNOWN_PROPERTIES = false
```

Yang penting bukan true/false-nya. Yang penting policy-nya explicit per boundary.

---

## 17. Phase 10 — Jackson 3 Migration Planning

Jackson 3 adalah migrasi besar karena ada perubahan package/API dan ekosistem framework terkait.

### 17.1 Jangan Anggap Jackson 3 sebagai Patch Upgrade

Jackson 2 ke 3 bukan sekadar naik minor version. Dampak yang harus dicek:

- package rename untuk banyak artifact/API;
- dependency coordinates/version alignment;
- module compatibility;
- custom serializer/deserializer API;
- Spring/Framework integration;
- third-party library yang masih compile terhadap Jackson 2;
- annotations compatibility strategy;
- generated code/imports;
- object mapper customization.

### 17.2 Buat Branch Eksperimen Terpisah

Strategi:

```text
main
  -> stable Java 17/21 + Jackson 2 hardened

branch/jackson3-spike
  -> dependency upgrade
  -> compile fixes
  -> run contract suite
  -> identify incompatible modules
  -> measure runtime behavior
```

Jangan campur dengan feature delivery.

### 17.3 Gunakan Automated Refactoring dengan Review Manual

Tool seperti OpenRewrite bisa membantu migrasi package/dependency. Tetapi automated refactor tidak cukup untuk contract behavior.

Setelah automated refactor:

- run golden payload tests;
- run deserialization negative tests;
- run integration tests;
- inspect custom modules;
- inspect Spring configuration;
- inspect third-party compatibility;
- compare serialized payload before/after.

### 17.4 Dual Support Strategy

Untuk library internal, mungkin perlu support dua jalur:

```text
module-core
module-json-jackson2
module-json-jackson3
```

atau setidaknya isolate adapter:

```java
interface JsonCodec {
    <T> T read(String json, Class<T> type);
    String write(Object value);
}
```

Lalu implementation bisa berbeda:

```java
final class Jackson2JsonCodec implements JsonCodec { ... }
final class Jackson3JsonCodec implements JsonCodec { ... }
```

Ini useful jika ada banyak service dengan upgrade cadence berbeda.

---

## 18. Phase 11 — Java 21/25 Modernization

Setelah behavior stabil, baru manfaatkan language features modern.

### 18.1 Java 8 to Modern DTO Evolution

Java 8 style:

```java
public class ApplicationResponse {
    private String applicationId;
    private String status;

    public ApplicationResponse() {}

    public String getApplicationId() { return applicationId; }
    public void setApplicationId(String applicationId) { this.applicationId = applicationId; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}
```

Lombok transitional style:

```java
@Getter
@Builder
@AllArgsConstructor
public class ApplicationResponse {
    private final String applicationId;
    private final String status;
}
```

Modern record style:

```java
public record ApplicationResponse(
    String applicationId,
    String status
) {}
```

Tidak semua harus langsung record. Gunakan sequence:

```text
mutable POJO -> immutable POJO/Lombok -> record
```

atau:

```text
mutable POJO -> record directly
```

hanya jika test harness kuat dan framework compatible.

### 18.2 Sealed Types for Polymorphic DTO

Legacy:

```java
public abstract class NotificationPayload { }
public class EmailPayload extends NotificationPayload { }
public class SmsPayload extends NotificationPayload { }
```

Modern:

```java
public sealed interface NotificationPayload
    permits EmailPayload, SmsPayload {
}

public record EmailPayload(String email, String subject) implements NotificationPayload {}
public record SmsPayload(String phoneNumber, String message) implements NotificationPayload {}
```

Tetapi Jackson polymorphism tetap butuh discriminator contract:

```json
{
  "type": "email",
  "email": "a@example.com",
  "subject": "Hello"
}
```

Sealed classes membantu Java compiler, bukan otomatis menyelesaikan JSON contract.

### 18.3 Pattern Matching in Mapping Code

Modern Java membuat mapping polymorphic lebih jelas:

```java
public NotificationResponse toResponse(NotificationPayload payload) {
    return switch (payload) {
        case EmailPayload email -> new EmailNotificationResponse(
            email.email(),
            email.subject()
        );
        case SmsPayload sms -> new SmsNotificationResponse(
            sms.phoneNumber(),
            sms.message()
        );
    };
}
```

Manfaat:

- exhaustive check untuk sealed hierarchy;
- mapping lebih eksplisit;
- mengurangi unsafe cast;
- compiler membantu saat subtype baru ditambah.

---

## 19. Phase 12 — Governance and Cleanup

Setelah migrasi teknis, rapikan governance agar tidak regress.

### 19.1 Ban/Flag Patterns

Tambahkan static analysis/checkstyle/ArchUnit/custom rule untuk:

- `new ObjectMapper()` di luar config;
- controller return entity;
- `@RequestBody` entity;
- `@Data` di entity;
- `BeanUtils.copyProperties` di production code;
- mapper memanggil repository;
- event payload memakai entity;
- DTO public tanpa golden contract test;
- mapper update entity tanpa null/patch test.

Contoh ArchUnit idea:

```java
ArchRule controllersShouldNotReturnEntities = methods()
    .that().areDeclaredInClassesThat().resideInAPackage("..controller..")
    .should().notHaveRawReturnType(assignableToBaseEntity());
```

### 19.2 Pull Request Checklist

Setiap PR mapping harus menjawab:

- Boundary mana yang berubah?
- Apakah JSON/XML shape berubah?
- Apakah field baru optional atau required?
- Apakah null semantics berubah?
- Apakah enum value baru ditambahkan?
- Apakah date/time format berubah?
- Apakah DTO public/event/audit affected?
- Apakah golden payload diperbarui?
- Apakah old payload masih bisa dibaca?
- Apakah rollback masih aman?
- Apakah entity/lazy relationship tersentuh?
- Apakah Lombok generated behavior berubah?
- Apakah MapStruct generated code sudah dicek?

### 19.3 Compatibility Policy

Contoh policy:

```text
Public API:
- Add optional field: allowed minor change.
- Remove field: breaking, major version or deprecation cycle required.
- Rename field: breaking unless alias + dual-write/read strategy.
- Enum add: potentially breaking for strict clients; announce.
- Null -> absent: contract change; must be reviewed.
- Date format change: breaking.

Event payload:
- Add optional field: allowed if consumers tolerate unknown fields.
- Remove/rename field: new event version.
- Change meaning of field: new version.

Audit payload:
- Must preserve interpretability.
- New shape must be versioned.
- Migration must not destroy forensic value.
```

---

## 20. Migration Recipes

Bagian ini berisi recipe praktis.

---

### Recipe A — Replace `BeanUtils.copyProperties` with Explicit Mapper

Legacy:

```java
public void update(UpdateUserRequest request, UserEntity entity) {
    BeanUtils.copyProperties(request, entity);
}
```

Masalah:

- over-posting;
- null overwrite;
- field security bisa tertimpa;
- source/target mismatch tidak compile-time visible;
- audit sulit.

Step migrasi:

1. Buat mapper manual dulu.
2. Tulis test untuk null/absent/security fields.
3. Baru pindahkan ke MapStruct jika pola stabil.

Manual transitional:

```java
public void update(UpdateUserRequest request, UserEntity entity) {
    if (request.displayName() != null) {
        entity.setDisplayName(request.displayName().trim());
    }

    if (request.phoneNumber() != null) {
        entity.setPhoneNumber(normalizePhone(request.phoneNumber()));
    }

    // intentionally not mapped:
    // - role
    // - status
    // - createdBy
    // - createdAt
}
```

MapStruct later:

```java
@Mapper(config = CentralMapperConfig.class)
public interface UserUpdateMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "role", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    void update(@MappingTarget UserEntity entity, UpdateUserRequest request);
}
```

---

### Recipe B — Convert Mutable Response DTO to Record

Legacy:

```java
@Data
public class UserResponse {
    private String userId;
    private String displayName;
    private String status;
}
```

Target:

```java
public record UserResponse(
    @JsonProperty("user_id") String userId,
    @JsonProperty("display_name") String displayName,
    @JsonProperty("status") String status
) {}
```

Step:

1. Tambah golden response test.
2. Tambah test Jackson deserialization jika response juga dipakai internal.
3. Replace DTO.
4. Update MapStruct mapper if needed.
5. Verify JSON unchanged.

MapStruct:

```java
@Mapper(config = CentralMapperConfig.class)
public interface UserMapper {
    UserResponse toResponse(UserEntity entity);
}
```

Karena record punya canonical constructor, MapStruct biasanya bisa instantiate lewat constructor.

---

### Recipe C — Separate API DTO from Command

Legacy:

```java
public class CreateApplicationRequest {
    public String applicantName;
    public String applicationType;
    public String internalStatus;
}
```

Controller langsung service:

```java
applicationService.create(request);
```

Target:

```java
public record CreateApplicationRequest(
    @JsonProperty("applicant_name") String applicantName,
    @JsonProperty("application_type") String applicationType
) {}

public record CreateApplicationCommand(
    ApplicantName applicantName,
    ApplicationType applicationType,
    UserId submittedBy
) {}
```

Mapper:

```java
@Mapper(config = CentralMapperConfig.class)
public interface ApplicationCommandMapper {

    @Mapping(target = "submittedBy", source = "submittedBy")
    CreateApplicationCommand toCommand(
        CreateApplicationRequest request,
        UserId submittedBy
    );

    default ApplicantName mapApplicantName(String raw) {
        return ApplicantName.of(raw.trim());
    }

    default ApplicationType mapApplicationType(String raw) {
        return ApplicationType.fromExternalCode(raw);
    }
}
```

Manfaat:

- API shape tidak sama dengan domain command;
- internal field tidak bisa over-posted;
- normalization/type conversion explicit;
- submitted user dari security context, bukan request body.

---

### Recipe D — Migrate Legacy Date String

Legacy DTO:

```java
public class SubmissionDto {
    private String submittedDate; // "31/12/2025"
}
```

Transitional inbound:

```java
public record SubmissionRequest(
    @JsonProperty("submitted_date") String submittedDate
) {}
```

Command:

```java
public record SubmitCommand(
    LocalDate submittedDate
) {}
```

Mapper:

```java
@Mapper(config = CentralMapperConfig.class)
public interface SubmissionMapper {

    @Mapping(target = "submittedDate", source = "submittedDate", qualifiedByName = "parseLegacyDate")
    SubmitCommand toCommand(SubmissionRequest request);

    @Named("parseLegacyDate")
    default LocalDate parseLegacyDate(String value) {
        if (value == null || value.isBlank()) {
            throw new InvalidMappingException("submitted_date is required");
        }
        return LocalDate.parse(value, DateTimeFormatter.ofPattern("dd/MM/uuuu"));
    }
}
```

Better long-term outbound:

```json
{
  "submitted_date": "2025-12-31"
}
```

Tetapi ubah format hanya dengan versioning/deprecation.

---

### Recipe E — Legacy Enum Evolution

Legacy:

```json
{
  "status": "P"
}
```

Modern internal enum:

```java
public enum ApplicationStatus {
    PENDING,
    APPROVED,
    REJECTED,
    UNKNOWN;

    public static ApplicationStatus fromExternalCode(String code) {
        return switch (code) {
            case "P" -> PENDING;
            case "A" -> APPROVED;
            case "R" -> REJECTED;
            default -> UNKNOWN;
        };
    }

    public String toExternalCode() {
        return switch (this) {
            case PENDING -> "P";
            case APPROVED -> "A";
            case REJECTED -> "R";
            case UNKNOWN -> "UNKNOWN";
        };
    }
}
```

Mapper:

```java
default ApplicationStatus mapStatus(String code) {
    return ApplicationStatus.fromExternalCode(code);
}
```

Jangan biarkan Jackson langsung map string external ke enum internal jika code external tidak sama dengan semantic enum.

---

### Recipe F — Move Public DTO Away from Lombok `@Data`

Legacy:

```java
@Data
public class CaseResponse {
    private String caseId;
    private String officerName;
    private String internalRemark;
}
```

Step 1: explicit Lombok minimal:

```java
@Getter
@AllArgsConstructor
public class CaseResponse {
    private final String caseId;
    private final String officerName;

    @JsonIgnore
    private final String internalRemark;
}
```

Step 2: remove internal field from DTO entirely:

```java
public record CaseResponse(
    String caseId,
    String officerName
) {}
```

Key point:

> Jangan hanya hide internal field dengan `@JsonIgnore` jika field itu tidak seharusnya ada di boundary DTO.

---

## 21. Rollback Strategy

Migrasi bagus selalu punya rollback.

### 21.1 Code Rollback vs Data Rollback

Ada dua jenis rollback:

| Rollback | Mudah/Sulit | Contoh |
|---|---|---|
| Code rollback | relatif mudah | revert mapper implementation |
| Data rollback | sulit | payload/event/cache sudah ditulis dalam format baru |

Jika migrasi mengubah serialized persistent data, gunakan versioning.

### 21.2 Payload Versioning

Event/cache/audit payload:

```json
{
  "schema_version": 2,
  "application_id": "APP-001",
  "status": "PENDING"
}
```

Reader:

```java
public ApplicationEvent read(JsonNode node) {
    int version = node.path("schema_version").asInt(1);

    return switch (version) {
        case 1 -> readV1(node);
        case 2 -> readV2(node);
        default -> throw new UnsupportedSchemaVersionException(version);
    };
}
```

### 21.3 Dual Read, Single Write

Transitional strategy:

```text
Release N:
- read v1 and v2
- write v1

Release N+1:
- read v1 and v2
- write v2

Release N+2:
- read v2, optionally still read v1 if old data exists
```

Untuk distributed systems, dual read harus hadir sebelum single write format baru.

### 21.4 Feature Flag untuk Mapper Baru

Untuk high-risk mapping:

```java
public ApplicationResponse toResponse(ApplicationEntity entity) {
    if (mappingFlags.useNewApplicationMapper()) {
        return newMapper.toResponse(entity);
    }
    return legacyMapper.toResponse(entity);
}
```

Pakai feature flag sementara, bukan permanen.

Test tetap wajib agar dua mapper tidak drift.

---

## 22. CI/CD Pipeline untuk Migration Safety

Pipeline minimum:

```text
compile
  -> annotation processing check
  -> unit tests
  -> mapper compatibility tests
  -> golden JSON/XML tests
  -> API contract tests
  -> integration tests
  -> ArchUnit/static rules
  -> dependency convergence
  -> optional JMH/performance smoke
```

### 22.1 Generated Code Check

Untuk MapStruct:

- pastikan generated sources tidak error;
- optional inspect generated mapper in PR for critical mapping;
- set unmapped target policy;
- fail build untuk mapping penting.

### 22.2 Dependency Convergence

Jackson ecosystem sering rusak karena versi module tidak align:

```text
jackson-core
jackson-databind
jackson-annotations
jackson-datatype-jsr310
jackson-dataformat-xml
jackson-module-parameter-names
```

Pastikan dependency management konsisten.

### 22.3 Multi-JDK Build Matrix

Untuk migrasi bertahap:

```text
JDK 17 compile/test
JDK 21 compile/test
JDK 25 compile/test spike
```

Atau minimal:

```text
current production JDK
next target JDK
```

Lombok dan annotation processors sangat sensitif terhadap JDK version, jadi matrix build membantu menemukan masalah lebih awal.

---

## 23. Migration Decision Matrix

### 23.1 Should This DTO Become a Record?

| Question | Jika Ya | Jika Tidak |
|---|---|---|
| Immutable boundary object? | record cocok | POJO/builder mungkin |
| Butuh no-args constructor? | record kurang cocok | POJO |
| Banyak optional field? | builder mungkin lebih readable | record ok |
| Public contract tested? | aman | buat test dulu |
| Dipakai JPA entity? | jangan record | entity biasa |
| Butuh PATCH absent/null? | hati-hati | wrapper/custom DTO |

### 23.2 Should This Mapper Become MapStruct?

| Question | Jika Ya | Jika Tidak |
|---|---|---|
| Pure deterministic mapping? | MapStruct cocok | manual/service layer |
| Banyak field/nested mapping? | MapStruct cocok | manual bisa verbose |
| Butuh repository call? | jangan di mapper | service/query layer |
| Butuh patch update? | MapStruct bisa, test ketat | manual jika semantics rumit |
| Need compile-time failure? | MapStruct bagus | reflection mapper buruk |

### 23.3 Should This Lombok Annotation Stay?

| Annotation | Keep If | Remove If |
|---|---|---|
| `@Getter` | simple class | almost always okay |
| `@Setter` | mutable DTO/entity intentional | immutable target |
| `@Data` | prototype/internal trivial | entity/public DTO/domain |
| `@Builder` | many optional fields/test fixture | simple record enough |
| `@Value` | Java 8 immutable transitional | record available and compatible |
| `@EqualsAndHashCode` | value object | JPA entity/relationship graph |

---

## 24. Common Migration Failure Modes

### 24.1 “All Tests Pass” But Client Breaks

Cause:

- tests assert Java object, not JSON contract;
- no golden payload;
- naming/null inclusion changed;
- frontend expected absent field but got null or vice versa.

Fix:

- assert serialized JSON;
- add contract test from real payload;
- include null/empty/absent cases.

### 24.2 MapStruct Generated Mapper Silently Ignores Field

Cause:

- unmapped target policy too lenient;
- field name mismatch;
- Lombok processor issue;
- builder detection unexpected.

Fix:

- `unmappedTargetPolicy = ERROR`;
- inspect generated source;
- add `lombok-mapstruct-binding`;
- add mapper unit tests.

### 24.3 Record Migration Breaks Deserialization

Cause:

- missing canonical constructor parameter info;
- Jackson module/config mismatch;
- JSON field name not matching record component;
- custom creator conflict;
- no default constructor expected by old framework.

Fix:

- explicit `@JsonProperty`;
- use correct Jackson version/module;
- golden deserialization tests;
- avoid record for framework-bound class.

### 24.4 Lombok Upgrade Breaks Build on New JDK

Cause:

- Lombok depends on compiler internals;
- old Lombok version not compatible with new JDK;
- IDE plugin/java language server mismatch.

Fix:

- upgrade Lombok early in isolation;
- run multi-JDK CI;
- avoid excessive Lombok in core contracts;
- use records/manual code for stable DTOs.

### 24.5 Jackson Upgrade Breaks Third-Party Library

Cause:

- dependency still compiled against Jackson 2;
- module not available for Jackson 3;
- package rename/API change.

Fix:

- dependency tree audit;
- isolate JSON adapter;
- wait for ecosystem readiness;
- branch spike before production migration.

### 24.6 PATCH Update Corrupts Data

Cause:

- null treated as “clear field” in one endpoint and “ignore” in another;
- absent not distinguishable;
- MapStruct update mapper uses wrong null strategy;
- request DTO has default values masking absent.

Fix:

- define PATCH semantics;
- use `JsonNullable`, Optional-like wrapper, JsonNode patch, or explicit field mask;
- test absent/null/default separately.

---

## 25. Practical Migration Roadmap Example

Misal codebase Java 8 + Spring legacy:

```text
- Java 8
- Jackson 2 old config
- Lombok @Data everywhere
- BeanUtils.copyProperties
- JPA entities returned by some controllers
- no golden payload tests
- some JAXB XML integrations
```

### Milestone 1 — Stop the Bleeding

- ban new direct entity response;
- ban new `BeanUtils.copyProperties`;
- centralize ObjectMapper;
- create DTO for new endpoints;
- add golden tests for top 10 endpoints/events.

### Milestone 2 — Stabilize Existing Contracts

- inventory DTO/mapper;
- classify high-risk mapping;
- create event/XML golden tests;
- document null/date/enum policy;
- add ArchUnit rules.

### Milestone 3 — Introduce MapStruct

- start with low-risk response mappers;
- add CentralMapperConfig;
- use dual comparison tests;
- replace reflection copy;
- handle update mapper separately.

### Milestone 4 — Contain Lombok

- add `lombok.config`;
- stop using `@Data` for new DTO/entity;
- replace easy response DTOs with records if target JDK supports;
- delombok critical classes before refactor.

### Milestone 5 — Modern Runtime

- upgrade to Java 17/21 baseline first if required by framework;
- migrate `javax` to `jakarta` if moving to Jakarta stack;
- harden Jackson 2;
- verify XML/JAXB dependencies explicit.

### Milestone 6 — Java 25/Jackson 3 Readiness

- CI spike with JDK 25;
- upgrade Lombok to JDK 25-compatible version;
- run annotation processor build;
- Jackson 3 spike branch;
- identify incompatible modules;
- run contract suite;
- decide upgrade window.

### Milestone 7 — Cleanup and Governance

- remove dead legacy mappers;
- remove duplicate ObjectMapper configs;
- enforce mapper review checklist;
- maintain compatibility matrix;
- document migration patterns.

---

## 26. What “Top 1%” Looks Like in This Migration

A senior/top-tier engineer does not just say:

> “Let’s use records and MapStruct.”

They ask:

1. Which boundary does this model represent?
2. Who consumes this JSON/XML/event?
3. Is shape change allowed?
4. What is null semantics?
5. How do we know old payload still works?
6. Can we rollback if data was written in new format?
7. Does mapper trigger DB lazy loading?
8. Is generated code deterministic under JDK upgrade?
9. Is Lombok helping or hiding behavior?
10. Is the contract encoded in tests or tribal knowledge?

Top-tier migration is less about trendy syntax and more about protecting system invariants during change.

---

## 27. Final Checklist

Sebelum merge migrasi mapping besar:

### Contract

- [ ] Golden JSON/XML payload exists for affected boundary.
- [ ] Old payload deserialization tested.
- [ ] New payload compatibility reviewed.
- [ ] Null/absent/default semantics tested.
- [ ] Enum/date/time behavior tested.
- [ ] OpenAPI/schema updated if applicable.

### Mapper

- [ ] Mapper ownership/layer clear.
- [ ] No repository/service I/O hidden in mapper.
- [ ] Unmapped target policy appropriate.
- [ ] Generated MapStruct code inspected for critical path.
- [ ] Manual mapper tested for semantic conversion.
- [ ] PATCH/update mapper has absent/null tests.

### Jackson/XML

- [ ] ObjectMapper profile used, no ad-hoc mapper.
- [ ] Date/time module and format stable.
- [ ] Unknown field policy explicit per boundary.
- [ ] Custom serializers/deserializers tested.
- [ ] XML namespace/order/security tested if applicable.

### Lombok/Records

- [ ] Lombok version compatible with target JDK.
- [ ] `lombok-mapstruct-binding` configured if needed.
- [ ] `@Data` avoided in public DTO/entity/domain.
- [ ] Record migration tested with Jackson/MapStruct.
- [ ] Equals/hashCode/toString reviewed for entity/cycle/sensitive data.

### Persistence

- [ ] Entity not exposed as API/event DTO.
- [ ] Lazy loading/N+1 risk checked.
- [ ] Bidirectional cycles prevented.
- [ ] Audit/version/security fields protected.

### Rollback

- [ ] Code rollback simple.
- [ ] Data/payload rollback considered.
- [ ] Versioned payload if persisted/asynchronous.
- [ ] Dual read before new write if distributed.
- [ ] Feature flag temporary if high risk.

---

## 28. Summary

Migrasi mapping layer dari Java 8 legacy ke Java 25 modern stack bukan pekerjaan cosmetic. Ini adalah perubahan pada lapisan yang menentukan bagaimana sistem melihat, menerima, menyimpan, mengirim, dan menjelaskan data.

Urutan aman:

```text
inventory
-> compatibility harness
-> centralize mapper profiles
-> remove entity leakage
-> stabilize DTO contract
-> introduce MapStruct gradually
-> contain Lombok risk
-> introduce records selectively
-> migrate javax/jakarta carefully
-> harden Jackson 2
-> plan Jackson 3 separately
-> modernize Java language usage
-> enforce governance
```

Prinsip paling penting:

> Jangan modernisasi syntax lebih cepat daripada kemampuanmu membuktikan compatibility.

Records, MapStruct, Jackson 3, Lombok upgrade, dan Java 25 semuanya bisa memberi value besar. Tetapi value itu hanya aman jika mapping boundary sudah explicit, testable, versioned, dan governed.

---

## 29. Referensi

- Oracle JDK 25 Release Notes, Important Changes, and Information  
  https://www.oracle.com/in/java/technologies/javase/25-relnote-issues.html

- OpenJDK JDK 25 Project Page  
  https://openjdk.org/projects/jdk/25/

- Oracle Java SE 25 Language Documentation  
  https://docs.oracle.com/en/java/javase/25/language/

- FasterXML Jackson 3 Migration Guide  
  https://github.com/FasterXML/jackson/blob/main/jackson3/MIGRATING_TO_JACKSON_3.md

- Spring Blog: Introducing Jackson 3 Support in Spring  
  https://spring.io/blog/2025/10/07/introducing-jackson-3-support-in-spring

- MapStruct 1.6.3 Reference Guide  
  https://mapstruct.org/documentation/stable/reference/html/

- Project Lombok Changelog  
  https://projectlombok.org/changelog

- Project Lombok Configuration System  
  https://projectlombok.org/features/configuration

- OpenRewrite Jackson 2 to 3 Migration Recipe  
  https://docs.openrewrite.org/recipes/java/jackson/upgradejackson_2_3

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./33-mapping-governance-standards-reviews-compatibility-policy.md">⬅️ Part 33 — Mapping Governance: Standards, Reviews, Compatibility Policy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./35-capstone-designing-production-grade-mapping-layer.md">Part 35 — Capstone: Designing a Production-Grade Mapping Layer ➡️</a>
</div>
