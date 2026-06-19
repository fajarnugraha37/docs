# learn-openapi-mastery-for-java-engineers-part-013.md

# Part 013 — Java/Spring OpenAPI Ecosystem: Springdoc, Swagger Core, OpenAPI Generator, and Build Integration

> Seri: OpenAPI Mastery for Java Engineers  
> Bagian: 013 / 030  
> Status seri: In progress  
> Prasyarat seri: Part 000–012  
> Fokus: bagaimana memakai OpenAPI di ekosistem Java/Spring tanpa membiarkan framework, annotation, atau generator mengambil alih desain arsitektur.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas sisi yang sangat praktis: bagaimana OpenAPI hidup di project Java, khususnya Spring Boot, Spring MVC/WebFlux, JAX-RS, Maven/Gradle, CI/CD, generated clients, generated server stubs, dan dokumentasi runtime.

Namun targetnya bukan sekadar "cara menampilkan Swagger UI". Targetnya adalah membangun mental model yang lebih kuat:

- kapan spec boleh dihasilkan dari code;
- kapan code harus dihasilkan dari spec;
- kapan annotation membantu;
- kapan annotation menipu;
- kapan generator mempercepat;
- kapan generator menjadi debt;
- bagaimana menjaga OpenAPI sebagai contract yang bisa direview;
- bagaimana memisahkan API DTO, application command/query, domain model, dan persistence entity;
- bagaimana memasukkan validation, linting, diffing, dan publishing ke build pipeline.

OpenAPI di Java sering gagal bukan karena tool-nya buruk, tetapi karena organisasi salah menempatkan tool. Banyak tim mengira mereka sudah contract-driven hanya karena punya endpoint `/v3/api-docs`. Padahal endpoint itu bisa saja hanya snapshot runtime dari controller, bukan kontrak yang sengaja didesain.

---

## 1. Peta Ekosistem Java OpenAPI

Dalam praktik Java modern, ekosistem OpenAPI biasanya terdiri dari beberapa kelas tool.

### 1.1 Runtime spec generation tools

Tool jenis ini membaca aplikasi Java dan menghasilkan OpenAPI description dari controller, annotation, Bean Validation, Jackson metadata, route mapping, dan konfigurasi framework.

Contoh paling umum:

- `springdoc-openapi` untuk Spring Boot;
- `swagger-core` untuk JAX-RS dan annotation model;
- framework-specific integration lain.

Dokumentasi springdoc menjelaskan bahwa library ini mengotomasi generasi dokumentasi API dengan memeriksa aplikasi Spring Boot pada runtime untuk menginfer API semantics dari konfigurasi Spring, struktur class, dan annotations. Ini penting: springdoc **menginfer**, bukan membaca pikiran desain API Anda.

### 1.2 Annotation libraries

Annotation library memberi cara menambahkan metadata OpenAPI langsung di Java source code.

Contoh umum:

- `@Operation`;
- `@Parameter`;
- `@RequestBody` dari Swagger annotations, bukan Spring `@RequestBody`;
- `@ApiResponse`;
- `@Schema`;
- `@SecurityRequirement`;
- `@Tag`;
- `@Hidden`.

Swagger Core menyediakan annotation untuk mendeklarasikan dan memanipulasi output OpenAPI. Artinya annotation adalah alat untuk memperkaya atau mengarahkan output, bukan pengganti desain contract.

### 1.3 OpenAPI Generator

OpenAPI Generator membaca OpenAPI document dan menghasilkan artifact seperti:

- Java client;
- Spring server stub;
- JAX-RS server stub;
- TypeScript client;
- Kotlin client/server;
- documentation;
- configuration;
- model classes.

Dokumentasi official generator `spring` menyatakan generator tersebut menghasilkan aplikasi Java Spring Boot server dengan integrasi SpringDoc. Generator ini berstatus stable dan bertipe server generator untuk bahasa Java.

### 1.4 Documentation/rendering tools

Tool jenis ini menampilkan OpenAPI agar bisa dibaca manusia.

Contoh:

- Swagger UI;
- Redoc;
- Scalar;
- Stoplight Elements;
- portal internal;
- API catalog.

Tool ini tidak membuat contract benar. Ia hanya memvisualisasikan contract yang sudah ada.

### 1.5 Validation, linting, diffing, and governance tools

Tool jenis ini menjaga kualitas spec.

Contoh kategori:

- OpenAPI validator;
- Spectral-style linter;
- OpenAPI diff/breaking-change detector;
- example validator;
- schema validator;
- bundler/dereferencer;
- API catalog checker;
- custom governance rules.

Pada level tim senior, ini lebih penting daripada Swagger UI. Swagger UI membantu eksplorasi. Lint/diff/test membantu mencegah kerusakan produksi.

---

## 2. Empat Mode Integrasi OpenAPI di Java

Ada empat mode besar.

### 2.1 Code-first

Dalam mode code-first, controller Java adalah sumber utama. OpenAPI dihasilkan dari code.

Alur umum:

```text
Java controller + annotations + validation + Jackson
        ↓
springdoc/swagger-core runtime scan
        ↓
OpenAPI JSON/YAML
        ↓
Swagger UI / generated docs / optional CI artifact
```

Kelebihan:

- cepat untuk existing Spring Boot APIs;
- cocok untuk internal service kecil;
- minim friction untuk developer Java;
- spec cenderung tidak tertinggal dari route aktual;
- bagus untuk discovery awal.

Kelemahan:

- contract sering mengikuti implementation accident;
- annotation bisa menjadi noise;
- sulit melakukan review sebelum implementation;
- schema sering mirror DTO/entity;
- response error sering tidak lengkap;
- polymorphism/nullable/oneOf sering salah;
- operationId sering tidak stabil;
- perubahan kecil di code bisa menjadi breaking change di spec tanpa disadari.

Code-first bukan dosa. Tetapi code-first tanpa contract governance hampir selalu berubah menjadi documentation-after-the-fact.

### 2.2 Design-first

Dalam mode design-first, OpenAPI ditulis atau didesain dulu sebelum implementasi.

Alur umum:

```text
OpenAPI contract draft
        ↓
design review + lint + mock
        ↓
consumer feedback
        ↓
server implementation
        ↓
provider contract tests
        ↓
published API artifact
```

Kelebihan:

- consumer bisa review lebih awal;
- API bisa dimock sebelum backend selesai;
- contract tidak terlalu terikat ke struktur Java;
- cocok untuk public API, partner API, platform API, regulated API;
- breaking change bisa dicegah sebelum masuk code.

Kelemahan:

- butuh disiplin;
- butuh skill menulis schema;
- bisa drift dari implementation jika tidak ada test;
- sebagian developer merasa lambat di awal;
- butuh pipeline artifact yang jelas.

Design-first bagus jika organisasi punya consumer yang perlu stabilitas.

### 2.3 Contract-first

Contract-first mirip design-first, tetapi lebih tegas: OpenAPI adalah artifact utama yang mengikat provider dan consumer.

Alur umum:

```text
OpenAPI contract as source of truth
        ↓
server interface/stub generation
        ↓
manual domain/application implementation
        ↓
client SDK generation
        ↓
contract validation in CI
        ↓
versioned release artifact
```

Kelebihan:

- sangat kuat untuk multi-team integration;
- generated clients/stubs konsisten;
- breaking-change gate lebih natural;
- contract bisa dipublish sebagai release artifact;
- cocok untuk API dengan lifecycle panjang.

Kelemahan:

- generator bisa mendikte architecture jika tidak hati-hati;
- spec harus sangat disiplin;
- generated DTO bisa bocor ke domain layer;
- regeneration workflow harus aman.

Contract-first bukan berarti semua code digenerate. Yang ideal: generate boundary interface/model seperlunya, lalu implementasi bisnis tetap manual dan terpisah.

### 2.4 Hybrid

Inilah realita banyak organisasi.

Contoh hybrid sehat:

```text
Existing code-first API
        ↓
Generate baseline OpenAPI
        ↓
Clean manually into reviewed contract
        ↓
Put contract in repository
        ↓
Use diff/lint/test gates
        ↓
Use springdoc only as implementation verification
```

Contoh hybrid lain:

```text
OpenAPI contract source-of-truth
        ↓
Generate Java interfaces/models
        ↓
Spring implementation fills delegates
        ↓
Runtime springdoc output is compared against contract
```

Hybrid yang sehat selalu punya jawaban jelas untuk pertanyaan ini:

> Jika generated runtime spec berbeda dari committed contract, mana yang benar?

Jika jawabannya tidak jelas, Anda belum punya contract governance. Anda hanya punya dokumentasi yang kebetulan bisa digenerate.

---

## 3. Springdoc-OpenAPI: Cara Berpikir yang Benar

Springdoc sangat berguna, tetapi harus diposisikan dengan benar.

### 3.1 Apa yang dilakukan springdoc

Secara sederhana, springdoc:

- membaca route Spring MVC/WebFlux;
- membaca controller methods;
- membaca request mapping;
- membaca request/response type;
- membaca Bean Validation annotations;
- membaca Jackson metadata;
- membaca Swagger/OpenAPI annotations;
- menghasilkan OpenAPI JSON/YAML;
- menyediakan Swagger UI integration.

Contoh minimal dependency Maven untuk Spring Boot modern biasanya berbentuk seperti ini:

```xml
<dependency>
  <groupId>org.springdoc</groupId>
  <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
  <version>${springdoc.version}</version>
</dependency>
```

Untuk WebFlux:

```xml
<dependency>
  <groupId>org.springdoc</groupId>
  <artifactId>springdoc-openapi-starter-webflux-ui</artifactId>
  <version>${springdoc.version}</version>
</dependency>
```

Versi sengaja ditulis sebagai property karena harus mengikuti compatibility matrix Spring Boot/Spring Framework yang digunakan project Anda.

### 3.2 Endpoint umum

Biasanya springdoc menyediakan:

```text
/v3/api-docs
/v3/api-docs.yaml
/swagger-ui.html
/swagger-ui/index.html
```

Namun URL detail bisa berubah tergantung konfigurasi.

### 3.3 Contoh controller sederhana

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    private final CaseApplicationService service;

    CaseController(CaseApplicationService service) {
        this.service = service;
    }

    @GetMapping("/{caseId}")
    CaseDetailResponse getCase(@PathVariable UUID caseId) {
        return service.getCase(caseId);
    }
}
```

Springdoc dapat menginfer operasi `GET /cases/{caseId}` dari controller ini.

Tetapi spec yang dihasilkan kemungkinan masih miskin:

- summary tidak ada;
- operationId bisa default dan tidak stabil;
- error responses tidak lengkap;
- security requirement tidak jelas;
- domain semantics tidak dijelaskan;
- examples tidak ada;
- conflict behavior tidak ada.

Maka annotation bisa ditambahkan.

```java
@Operation(
    operationId = "getCaseById",
    summary = "Get a case by ID",
    description = "Returns the externally visible case detail for an authorized user. Internal investigation notes are not included."
)
@ApiResponses({
    @ApiResponse(responseCode = "200", description = "Case found"),
    @ApiResponse(responseCode = "401", description = "Authentication required"),
    @ApiResponse(responseCode = "403", description = "User is not allowed to access this case"),
    @ApiResponse(responseCode = "404", description = "Case does not exist or is not visible to the user")
})
@GetMapping("/{caseId}")
CaseDetailResponse getCase(
    @Parameter(description = "Stable public case identifier")
    @PathVariable UUID caseId
) {
    return service.getCase(caseId);
}
```

Ini lebih baik. Tetapi perhatikan masalahnya: Java source mulai menjadi tempat design documentation, routing, authorization explanation, error model, dan API review metadata bercampur.

Untuk endpoint kecil, ini masih oke. Untuk API besar, annotation-heavy code menjadi sulit dibaca.

---

## 4. Swagger Core Annotations: Useful but Dangerous When Overused

Swagger annotations berguna untuk memperbaiki inference.

### 4.1 Annotation umum

Contoh annotation yang sering dipakai:

```java
@Operation
@ApiResponse
@ApiResponses
@Parameter
@RequestBody
@Schema
@ArraySchema
@SecurityRequirement
@Tag
@Hidden
```

Hati-hati: ada nama annotation yang sama dengan Spring.

Contoh konflik konseptual:

```java
org.springframework.web.bind.annotation.RequestBody
io.swagger.v3.oas.annotations.parameters.RequestBody
```

Yang pertama mengikat HTTP request body ke parameter Java. Yang kedua mendeskripsikan request body dalam OpenAPI.

### 4.2 Annotation pada DTO

```java
public record CreateCaseRequest(
    @Schema(description = "Short human-readable case title", minLength = 3, maxLength = 200)
    @NotBlank
    String title,

    @Schema(description = "External complainant identifier")
    UUID complainantId,

    @Schema(description = "Initial allegation summary", maxLength = 5000)
    String allegationSummary
) {}
```

Ini bisa membantu. Tetapi jangan menganggap `@Schema` + Bean Validation otomatis cukup.

Masalah yang sering muncul:

- `@NotNull` berarti field required, tapi tidak menjelaskan business meaning;
- `@Size(max = 255)` sering hanya warisan database column;
- `@Pattern` bisa terlalu teknis;
- `@Schema(example = "foo")` sering tidak valid secara domain;
- `@Schema(description = "...")` bisa menjadi dokumentasi basi;
- Jackson `@JsonIgnore` bisa menyembunyikan field dari runtime tetapi tidak selalu sesuai contract yang diinginkan;
- Lombok/records/generic wrappers bisa menghasilkan schema yang tidak ergonomis.

### 4.3 Annotation soup

Anti-pattern umum:

```java
@Operation(
    summary = "Create case",
    description = "Create case",
    tags = {"Cases"},
    security = {@SecurityRequirement(name = "bearerAuth")}
)
@ApiResponses({
    @ApiResponse(responseCode = "201", description = "Created",
        content = @Content(mediaType = "application/json",
            schema = @Schema(implementation = CaseResponse.class))),
    @ApiResponse(responseCode = "400", description = "Bad Request",
        content = @Content(mediaType = "application/json",
            schema = @Schema(implementation = ErrorResponse.class))),
    @ApiResponse(responseCode = "401", description = "Unauthorized"),
    @ApiResponse(responseCode = "403", description = "Forbidden"),
    @ApiResponse(responseCode = "409", description = "Conflict",
        content = @Content(mediaType = "application/json",
            schema = @Schema(implementation = ErrorResponse.class)))
})
@PostMapping
ResponseEntity<CaseResponse> createCase(
    @io.swagger.v3.oas.annotations.parameters.RequestBody(
        description = "Case creation payload",
        required = true,
        content = @Content(schema = @Schema(implementation = CreateCaseRequest.class))
    )
    @Valid @org.springframework.web.bind.annotation.RequestBody CreateCaseRequest request
) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.create(request));
}
```

Ini technically works, tapi source code sulit dibaca. Untuk API besar, lebih baik beberapa hal distandardisasi melalui global customizer, reusable components, atau contract-first document.

### 4.4 Rule of thumb annotation

Gunakan annotation untuk:

- menambahkan summary dan description yang dekat dengan endpoint;
- memperbaiki operationId;
- mendokumentasikan parameter yang tidak bisa diinfer;
- menandai response codes penting;
- mengatur schema detail yang tidak bisa diinfer dari Java type;
- menyembunyikan endpoint internal;
- menambahkan security requirement yang jelas.

Jangan gunakan annotation untuk:

- menggantikan API design review;
- menambal DTO/entity yang buruk;
- menyembunyikan schema chaos;
- memodelkan workflow kompleks yang seharusnya dirancang di contract;
- membuat Java controller menjadi OpenAPI YAML dalam bentuk annotation.

---

## 5. Spring MVC/WebFlux Type Inference Pitfalls

Springdoc menginfer dari type Java. Ini berguna, tetapi ada jebakan.

### 5.1 `ResponseEntity<T>`

```java
@GetMapping("/{id}")
ResponseEntity<CaseDetailResponse> getCase(@PathVariable UUID id) {
    return ResponseEntity.ok(service.getCase(id));
}
```

`T` bisa diinfer. Tetapi status code alternatif tidak otomatis diketahui.

Jika code melempar exception untuk 404/403/409, OpenAPI tidak otomatis tahu error model kecuali:

- Anda menambahkan `@ApiResponse`;
- menggunakan global exception mapping customizer;
- mendefinisikan reusable error responses;
- atau memvalidasi response contract di test.

### 5.2 Generic wrapper

Banyak Java API memakai wrapper generik:

```java
record ApiResponse<T>(
    boolean success,
    T data,
    ErrorPayload error
) {}
```

Lalu controller:

```java
@GetMapping("/{id}")
ApiResponse<CaseDetailResponse> getCase(@PathVariable UUID id) { ... }
```

Masalah:

- success dan error shape bercampur;
- HTTP status semantics menjadi kabur;
- generated client mendapat model yang lebih rumit;
- schema generic bisa jelek;
- error handling consumer menjadi tidak idiomatis.

OpenAPI lebih kuat jika success dan error responses dimodelkan sebagai response berbeda berdasarkan HTTP status.

### 5.3 `Map<String, Object>`

```java
@PostMapping("/search")
Map<String, Object> search(@RequestBody Map<String, Object> request) { ... }
```

Ini hampir selalu contract smell.

OpenAPI yang dihasilkan akan sangat lemah:

```yaml
type: object
additionalProperties: true
```

Artinya consumer tidak tahu field apa yang valid.

Gunakan typed request:

```java
record CaseSearchRequest(
    String status,
    UUID assignedOfficerId,
    LocalDate openedAfter,
    LocalDate openedBefore
) {}
```

Jika memang butuh dynamic filter DSL, dokumentasikan grammar dengan eksplisit.

### 5.4 `Object`, raw type, dan erased generic

Hindari:

```java
ResponseEntity<?>
List
Map
Object
JsonNode
```

Boleh digunakan hanya jika contract memang intentionally dynamic, dan schema-nya tetap harus ditulis jelas.

### 5.5 Java date/time mapping

Java memiliki banyak tipe waktu:

```java
LocalDate
LocalDateTime
OffsetDateTime
Instant
ZonedDateTime
```

OpenAPI biasanya merepresentasikan:

```yaml
type: string
format: date
```

atau:

```yaml
type: string
format: date-time
```

Masalah utama bukan hanya format, tetapi semantics:

- apakah timestamp UTC?
- apakah offset dipertahankan?
- apakah local time punya timezone domain tertentu?
- apakah date inclusive/exclusive?
- apakah precision sampai seconds, millis, nanos?

Untuk external APIs, `OffsetDateTime` atau `Instant` sering lebih aman daripada `LocalDateTime` karena `LocalDateTime` tidak membawa offset/timezone.

### 5.6 `Optional<T>` field

Hindari `Optional` sebagai field DTO.

```java
record UpdateCaseRequest(
    Optional<String> title
) {}
```

Ini sering membuat serialization dan schema membingungkan. Gunakan field nullable/absent semantics dengan jelas.

Untuk PATCH, bedakan:

- field absent: tidak berubah;
- field present dengan `null`: clear value;
- field present dengan value: update value.

Ini tidak bisa diselesaikan hanya dengan `Optional` tanpa desain eksplisit.

---

## 6. Bean Validation vs OpenAPI Schema

Bean Validation dan OpenAPI schema saling berhubungan, tapi tidak identik.

### 6.1 Contoh mapping umum

```java
record CreateOfficerRequest(
    @NotBlank
    @Size(min = 2, max = 100)
    String fullName,

    @Email
    String email,

    @NotNull
    UUID departmentId
) {}
```

Kemungkinan schema:

```yaml
CreateOfficerRequest:
  type: object
  required:
    - fullName
    - departmentId
  properties:
    fullName:
      type: string
      minLength: 2
      maxLength: 100
    email:
      type: string
      format: email
    departmentId:
      type: string
      format: uuid
```

Ini bagus untuk structural validation.

### 6.2 Yang tidak tertangkap schema

Bean Validation/OpenAPI schema tidak cukup untuk:

- `departmentId` harus existing;
- officer tidak boleh ditambahkan ke closed case;
- user harus punya permission untuk department;
- title tidak boleh duplicate dalam scope tertentu;
- transition hanya valid dari state tertentu;
- evidence cannot be deleted after adjudication;
- status reason wajib untuk beberapa transition saja.

Itu business validation. Contract harus menjelaskan behavior dan error response, tetapi implementasinya ada di application/domain layer.

### 6.3 Validation split-brain

Masalah serius muncul jika:

- OpenAPI mengatakan `maxLength: 200`;
- Bean Validation memakai `@Size(max = 255)`;
- database column `varchar(128)`;
- frontend membatasi 100 karakter;
- error message bilang 150.

Ini disebut validation split-brain. Consumer tidak tahu batas yang benar.

Strategi:

1. Tetapkan API contract limit sebagai public truth.
2. Pastikan Bean Validation mengikuti contract.
3. Pastikan database limit lebih longgar atau sama aman.
4. Validasi response/request terhadap OpenAPI di tests.
5. Jadikan diff contract sebagai CI gate.

---

## 7. Jackson Interaction

Jackson memengaruhi OpenAPI karena schema sering diinfer dari serialization behavior.

### 7.1 Naming strategy

Jika Jackson memakai snake_case:

```java
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
record CaseDetailResponse(
    UUID caseId,
    OffsetDateTime openedAt
) {}
```

JSON output:

```json
{
  "case_id": "...",
  "opened_at": "2026-06-20T10:00:00Z"
}
```

Schema harus mengikuti JSON property name, bukan Java field name.

### 7.2 `@JsonProperty`

```java
record CaseDetailResponse(
    @JsonProperty("case_id") UUID caseId
) {}
```

Ini bisa menjaga external name tetap stabil meskipun Java name berubah.

### 7.3 `@JsonIgnore`

```java
record UserResponse(
    UUID id,
    String username,
    @JsonIgnore String internalRiskScore
) {}
```

Jika field di-ignore, jangan sampai tetap muncul di schema. Ini penting untuk data leakage.

### 7.4 `@JsonInclude`

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
record CaseDetailResponse(
    UUID id,
    String closureReason
) {}
```

Jika null fields tidak diserialisasi, consumer perlu tahu:

- field optional karena bisa absent;
- field nullable karena bisa null;
- atau keduanya.

OpenAPI harus merepresentasikan JSON behavior aktual.

### 7.5 Polymorphism

Jackson polymorphism:

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
    @JsonSubTypes.Type(value = EmailEvidence.class, name = "email"),
    @JsonSubTypes.Type(value = DocumentEvidence.class, name = "document")
})
sealed interface Evidence permits EmailEvidence, DocumentEvidence {}
```

OpenAPI perlu `oneOf` + discriminator yang benar. Jangan mengandalkan inference jika output-nya belum diverifikasi.

---

## 8. Records, Lombok, Kotlin, and Modern Java Types

### 8.1 Java records

Records cocok untuk immutable API DTO.

```java
public record CaseSummaryResponse(
    UUID caseId,
    String title,
    String status,
    OffsetDateTime openedAt
) {}
```

Kelebihan:

- ringkas;
- immutable by default;
- constructor jelas;
- cocok untuk request/response boundary.

Kelemahan:

- default value handling tidak natural;
- optional/nullable semantics harus jelas;
- complex validation kadang butuh canonical constructor;
- beberapa generator/library punya edge case tergantung versi.

### 8.2 Lombok

Lombok sering dipakai:

```java
@Data
@NoArgsConstructor
@AllArgsConstructor
class CaseResponse {
    private UUID id;
    private String title;
}
```

Masalah:

- generated accessors bisa memengaruhi introspection;
- mutability default;
- constructor behavior tidak selalu jelas;
- `@Builder` bisa menyembunyikan required fields;
- schema bisa mengikuti getter yang tidak diharapkan.

Lombok bukan masalah jika disiplin. Tetapi untuk API DTO, records sering lebih eksplisit.

### 8.3 Kotlin data class

Kotlin punya nullability lebih ekspresif, tetapi generator dan reflection perlu dikonfigurasi dengan benar.

```kotlin
data class CreateCaseRequest(
    val title: String,
    val complainantId: UUID?,
)
```

`String` vs `String?` harus dipetakan dengan tepat ke required/nullable semantics.

### 8.4 Sealed classes/interfaces

Java sealed types bisa membantu modelling closed polymorphic hierarchy, tetapi jangan otomatis memaksakan `oneOf` jika domain lebih sederhana dengan `type` + optional fields atau state-specific endpoints.

---

## 9. OpenAPI Generator untuk Java Clients

Client generation adalah salah satu manfaat terbesar OpenAPI, tapi juga salah satu sumber coupling terbesar.

### 9.1 Basic command

Contoh CLI:

```bash
openapi-generator-cli generate \
  -i openapi.yaml \
  -g java \
  -o build/generated-client \
  --additional-properties=library=webclient,dateLibrary=java8
```

Contoh Maven plugin concept:

```xml
<plugin>
  <groupId>org.openapitools</groupId>
  <artifactId>openapi-generator-maven-plugin</artifactId>
  <version>${openapi-generator.version}</version>
  <executions>
    <execution>
      <goals>
        <goal>generate</goal>
      </goals>
      <configuration>
        <inputSpec>${project.basedir}/src/main/openapi/openapi.yaml</inputSpec>
        <generatorName>java</generatorName>
        <output>${project.build.directory}/generated-sources/openapi</output>
        <configOptions>
          <library>webclient</library>
          <dateLibrary>java8</dateLibrary>
        </configOptions>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 9.2 Generated client belongs at integration boundary

Bad layering:

```text
Domain service
  ↓ depends on
Generated OpenAPI client model
```

Better layering:

```text
Domain/application layer
  ↓ calls port/interface
Integration adapter
  ↓ uses generated OpenAPI client
External API
```

Generated model should not leak into your core domain unless the generated API is truly your canonical domain, which is rare.

### 9.3 Error handling problem

Generated clients often expose HTTP errors as generic exceptions.

You still need adapter-level mapping:

```java
try {
    ExternalCaseResponse response = generatedClient.getCase(caseId);
    return mapper.toApplicationResult(response);
} catch (ApiException e) {
    if (e.getCode() == 404) {
        throw new ExternalCaseNotFound(caseId);
    }
    if (e.getCode() == 429) {
        throw new ExternalRateLimited(e);
    }
    throw new ExternalSystemFailure(e);
}
```

If the OpenAPI error schema is precise, this adapter can be much better.

### 9.4 Timeout, retry, auth, observability

Generated clients rarely solve production integration concerns by themselves.

You still need:

- connect timeout;
- read timeout;
- retry policy;
- circuit breaker;
- correlation ID propagation;
- auth token injection;
- logging policy;
- PII-safe logging;
- metrics;
- tracing;
- error mapping.

These are adapter concerns, not schema concerns.

### 9.5 Generated client review checklist

Before adopting generated client, check:

- Does it use the HTTP library your team supports?
- Can you configure timeouts?
- Can you inject auth headers cleanly?
- Does it preserve unknown enum values?
- Does it handle nullable correctly?
- Does it parse problem details/errors?
- Does it expose response headers when needed?
- Does it support streaming/binary endpoints?
- Can it be regenerated reproducibly?
- Is generated code committed or generated at build time?
- How will generated client version be released?

---

## 10. OpenAPI Generator untuk Spring Server Stubs

Server generation bisa berguna, tetapi harus dikendalikan.

### 10.1 Basic command

```bash
openapi-generator-cli generate \
  -i openapi.yaml \
  -g spring \
  -o build/generated-server \
  --additional-properties=interfaceOnly=true,useSpringBoot3=true
```

Pilihan seperti `interfaceOnly` sering lebih aman karena generator membuat interface/controller contract, sementara implementasi bisnis tetap manual.

### 10.2 Delegate pattern

Generator bisa menghasilkan interface seperti:

```java
public interface CasesApi {
    ResponseEntity<CaseDetailResponse> getCaseById(UUID caseId);
}
```

Lalu kita implementasikan:

```java
@RestController
class CasesApiController implements CasesApi {

    private final GetCaseUseCase getCaseUseCase;
    private final CaseApiMapper mapper;

    CasesApiController(GetCaseUseCase getCaseUseCase, CaseApiMapper mapper) {
        this.getCaseUseCase = getCaseUseCase;
        this.mapper = mapper;
    }

    @Override
    public ResponseEntity<CaseDetailResponse> getCaseById(UUID caseId) {
        CaseDetail detail = getCaseUseCase.get(caseId);
        return ResponseEntity.ok(mapper.toResponse(detail));
    }
}
```

Ini menjaga boundary:

```text
Generated API interface/model
        ↓
Controller adapter
        ↓
Application use case
        ↓
Domain
```

Jangan balik arah.

### 10.3 Dangerous pattern

```text
Generated model
        ↓
Used directly as domain object
        ↓
Stored by JPA
        ↓
Returned again as API response
```

Ini mencampur:

- external contract;
- application state;
- domain invariants;
- database persistence;
- serialization concerns.

Akibatnya perubahan API bisa memecahkan database atau domain logic.

### 10.4 DTO mapping is not boilerplate waste

Banyak engineer menganggap mapping layer membosankan.

Namun pada API contract yang serius, mapping layer adalah protection boundary.

```java
final class CaseApiMapper {

    CreateCaseCommand toCommand(CreateCaseRequest request, UserId currentUser) {
        return new CreateCaseCommand(
            request.title(),
            request.complainantId(),
            request.allegationSummary(),
            currentUser
        );
    }

    CaseDetailResponse toResponse(CaseDetail detail) {
        return new CaseDetailResponse(
            detail.publicId().value(),
            detail.title(),
            detail.status().externalName(),
            detail.openedAt(),
            detail.closedAt().orElse(null)
        );
    }
}
```

Mapping layer memungkinkan:

- rename internal field tanpa breaking API;
- hide sensitive fields;
- convert enum internal ke external vocabulary;
- normalize timestamps;
- enforce response shape;
- protect domain from generated code churn.

---

## 11. Build Integration: Maven and Gradle

OpenAPI artifact harus masuk build pipeline, bukan hanya runtime endpoint.

### 11.1 Recommended repository layout

Untuk contract-first/design-first:

```text
service-repo/
  src/main/openapi/
    openapi.yaml
    components/
      schemas.yaml
      responses.yaml
      parameters.yaml
  src/main/java/
  src/test/java/
  build.gradle
  pom.xml
```

Untuk code-first dengan exported artifact:

```text
service-repo/
  src/main/java/
  src/test/java/
  build/generated/openapi/openapi.yaml
  src/main/openapi-baseline/openapi.yaml   # optional reviewed baseline
```

### 11.2 Build stages

Ideal pipeline:

```text
validate OpenAPI syntax
        ↓
lint style/governance
        ↓
bundle multi-file spec
        ↓
validate examples
        ↓
run OpenAPI diff against latest released spec
        ↓
generate server/client artifacts if needed
        ↓
compile generated code
        ↓
run contract tests
        ↓
publish versioned OpenAPI artifact
        ↓
publish docs/catalog entry
```

### 11.3 Maven lifecycle concept

Possible mapping:

```text
validate phase:
  - openapi syntax validation
  - lint

generate-sources phase:
  - generate Java interfaces/client

compile phase:
  - compile generated + handwritten source

test phase:
  - contract tests
  - response validation tests

verify phase:
  - breaking-change diff
  - example validation

package/deploy phase:
  - publish OpenAPI YAML as artifact
  - publish docs
```

### 11.4 Gradle concept

Example task shape:

```gradle
tasks.register("validateOpenApi") {
    inputs.file("src/main/openapi/openapi.yaml")
    doLast {
        exec {
            commandLine "openapi-generator-cli", "validate", "-i", "src/main/openapi/openapi.yaml"
        }
    }
}

tasks.register("generateOpenApiClient") {
    dependsOn "validateOpenApi"
    doLast {
        exec {
            commandLine "openapi-generator-cli", "generate",
                "-i", "src/main/openapi/openapi.yaml",
                "-g", "java",
                "-o", "$buildDir/generated/openapi-client"
        }
    }
}
```

Real project should use official Gradle/Maven plugin rather than shelling out everywhere, but the mental model is the same: OpenAPI is an input/output artifact with lifecycle.

---

## 12. Runtime Docs vs Release Artifact

A major architecture distinction:

```text
Runtime docs endpoint != released API contract
```

Runtime docs endpoint:

- generated from currently running app;
- useful for debugging;
- useful for internal exploration;
- can vary by environment/config/profile;
- may include accidental endpoints;
- may not represent released promise.

Released API contract:

- versioned;
- reviewed;
- immutable after release;
- diffed for breaking changes;
- used by clients/tests/docs;
- traceable to deployment/release.

For serious systems, publish OpenAPI as build artifact:

```text
com.company.case-api:case-api-openapi:1.12.0:yaml
```

Or as catalog entry:

```text
api: case-management
version: 1.12.0
contract: openapi.yaml
owner: enforcement-platform-team
lifecycle: active
```

---

## 13. Grouped APIs in Springdoc

Large Spring apps may expose multiple API groups:

- public API;
- internal admin API;
- partner API;
- actuator/internal operational endpoints;
- versioned API groups.

Springdoc supports grouped OpenAPI configuration conceptually like:

```java
@Bean
GroupedOpenApi publicApi() {
    return GroupedOpenApi.builder()
        .group("public")
        .pathsToMatch("/api/public/**")
        .build();
}

@Bean
GroupedOpenApi internalApi() {
    return GroupedOpenApi.builder()
        .group("internal")
        .pathsToMatch("/api/internal/**")
        .build();
}
```

Why grouping matters:

- public consumers should not see internal endpoints;
- partner docs may have different examples/security;
- admin endpoints may require different policies;
- internal endpoints may still need contract, but not public exposure.

Anti-pattern:

```text
One giant OpenAPI document exposes everything because it is convenient.
```

This can cause accidental disclosure.

---

## 14. Customizing Generated OpenAPI in Springdoc

Sometimes inference needs global customization.

### 14.1 Add global metadata

```java
@Bean
OpenAPI caseManagementOpenApi() {
    return new OpenAPI()
        .info(new Info()
            .title("Case Management API")
            .version("1.0.0")
            .description("API for externally visible case lifecycle operations."));
}
```

### 14.2 Add security scheme

```java
@Bean
OpenAPI openAPI() {
    return new OpenAPI()
        .components(new Components()
            .addSecuritySchemes("bearerAuth",
                new SecurityScheme()
                    .type(SecurityScheme.Type.HTTP)
                    .scheme("bearer")
                    .bearerFormat("JWT")))
        .addSecurityItem(new SecurityRequirement().addList("bearerAuth"));
}
```

### 14.3 Operation customizer

Operation customizers can enforce conventions, but use carefully.

Possible uses:

- default operationId strategy;
- add common headers;
- add correlation ID response header;
- attach standard error responses;
- hide internal endpoints;
- normalize tags.

But do not hide poor API design behind customizers.

---

## 15. Standard Error Response in Java/Spring

A serious OpenAPI integration needs consistent error handling.

### 15.1 Problem Details

Modern APIs often use `application/problem+json` based on Problem Details. In Java/Spring, this can map to Spring's problem detail support or a custom DTO.

Example custom shape:

```java
record ProblemDetailResponse(
    String type,
    String title,
    int status,
    String detail,
    String instance,
    String code,
    String correlationId,
    List<FieldViolation> violations
) {}

record FieldViolation(
    String field,
    String message,
    String code
) {}
```

### 15.2 Global exception handler

```java
@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(CaseNotFoundException.class)
    ResponseEntity<ProblemDetailResponse> handleCaseNotFound(
        CaseNotFoundException ex,
        HttpServletRequest request
    ) {
        ProblemDetailResponse body = new ProblemDetailResponse(
            "https://api.example.com/problems/case-not-found",
            "Case not found",
            404,
            "The requested case was not found or is not visible to the current user.",
            request.getRequestURI(),
            "CASE_NOT_FOUND",
            correlationId(),
            List.of()
        );
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(body);
    }
}
```

### 15.3 Contract alignment

OpenAPI should define reusable error response:

```yaml
components:
  responses:
    NotFoundProblem:
      description: Resource not found or not visible
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/ProblemDetail'
```

If every endpoint has undocumented exception behavior, the contract is incomplete.

---

## 16. Contract Tests for Spring Implementation

A good Java integration does not stop at generating docs. It verifies implementation against OpenAPI.

### 16.1 Provider response validation

Test idea:

```text
Given OpenAPI contract says GET /cases/{caseId} returns CaseDetailResponse
When Spring MockMvc calls endpoint
Then response status, headers, and body validate against OpenAPI schema
```

Pseudo-test:

```java
@Test
void getCase_responseMatchesOpenApiContract() throws Exception {
    mockMvc.perform(get("/cases/{caseId}", existingCaseId)
            .header("Authorization", bearerToken()))
        .andExpect(status().isOk())
        .andExpect(openApi().isValid("getCaseById"));
}
```

Exact assertion library varies. The principle matters: response body must not drift from contract.

### 16.2 Negative paths matter

Test not only 200.

```text
401 unauthenticated
403 unauthorized
404 not found / hidden
409 invalid transition
422 semantic validation failure
429 rate limited
500 sanitized problem response
```

If only success response is contract-tested, consumer failure handling remains fragile.

### 16.3 Runtime-generated spec diff

For hybrid mode:

```text
committed contract openapi.yaml
        vs
runtime-generated /v3/api-docs
```

Detect drift:

- missing path;
- added accidental path;
- changed schema;
- changed operationId;
- missing error response;
- content type mismatch.

Do not blindly publish runtime spec without review.

---

## 17. Handling Profiles and Environment Differences

Spring apps often differ by profile:

- local;
- dev;
- staging;
- prod;
- partner sandbox;
- internal admin mode.

This can affect OpenAPI if endpoints or beans are profile-dependent.

Risk:

```text
OpenAPI generated in local profile includes endpoint not available in production.
```

or:

```text
OpenAPI generated in CI misses endpoint enabled in production.
```

Strategy:

- generate contract under deterministic profile;
- avoid profile-dependent public API shape;
- if shape differs, publish separate contracts;
- run contract tests under deployment-like configuration;
- never let local-only debug endpoints leak into public API docs.

---

## 18. Versioning Java Packages and OpenAPI Contracts

Common generated package strategy:

```text
com.company.caseapi.v1.model
com.company.caseapi.v1.api
```

For v2:

```text
com.company.caseapi.v2.model
com.company.caseapi.v2.api
```

But avoid creating v2 just because internal Java package changed.

Version API based on external contract, not implementation refactor.

### 18.1 Artifact version vs API version

Distinguish:

```text
OpenAPI artifact version: 1.12.3
API public version: v1
Service app version: 2026.06.20.5
Java package version: com.company.caseapi.v1
```

These are related but not identical.

### 18.2 Semantic versioning caution

SemVer can help, but API compatibility is more subtle.

Example:

- adding optional response field: usually minor;
- adding required request field: major/breaking;
- adding enum value: may be breaking for generated clients;
- changing description only: patch;
- changing operationId: breaking for generated SDK even if HTTP API same.

---

## 19. Generated Code: Commit or Not Commit?

There is no universal answer.

### 19.1 Commit generated code when

- consumers need source visibility;
- build environment cannot run generator reliably;
- generated SDK is published as library;
- regeneration is manually reviewed;
- generated code is part of release artifact.

### 19.2 Do not commit generated code when

- it creates noisy diffs;
- generator runs deterministically in build;
- output is purely internal;
- code is huge;
- generated files obscure meaningful review.

### 19.3 Always commit the input contract

Even if generated code is not committed, the OpenAPI input should be versioned.

```text
Do not treat generator output as source of truth.
The source of truth is the contract plus generator configuration.
```

---

## 20. Generator Configuration Is Part of the Contract Toolchain

Generator config affects generated API surface.

Example config file:

```yaml
generatorName: java
inputSpec: src/main/openapi/openapi.yaml
outputDir: build/generated/openapi-client
library: webclient
dateLibrary: java8
modelPackage: com.company.caseapi.client.model
apiPackage: com.company.caseapi.client.api
invokerPackage: com.company.caseapi.client.invoker
hideGenerationTimestamp: true
```

This config should be reviewed and versioned.

Changing generator config can be breaking for SDK consumers even when OpenAPI spec did not change.

Examples:

- package name changed;
- date library changed;
- enum naming changed;
- nullable handling changed;
- method signature changed;
- client HTTP library changed.

---

## 21. Java Architecture Pattern for OpenAPI Boundary

Recommended layering:

```text
HTTP/API layer
  - generated or handwritten controllers
  - API DTOs
  - request validation
  - response mapping
  - exception-to-problem mapping

Application layer
  - use cases
  - commands
  - queries
  - transaction boundary
  - authorization orchestration

Domain layer
  - entities/value objects
  - invariants
  - state transitions
  - domain services

Infrastructure layer
  - persistence
  - external clients
  - generated SDK adapters
  - messaging adapters
```

OpenAPI should primarily bind to the HTTP/API layer.

### 21.1 Good dependency direction

```text
API layer depends on application layer.
Application layer does not depend on OpenAPI-generated DTOs.
Domain layer does not depend on OpenAPI-generated DTOs.
Persistence layer does not depend on OpenAPI-generated DTOs.
```

### 21.2 Why this matters

If domain depends on API DTO:

- public contract changes can force domain changes;
- internal invariants become serialization-dependent;
- generated code churn pollutes business logic;
- multiple API versions become painful;
- persistence migrations become entangled with API evolution.

---

## 22. Practical Example: Contract-First Spring Implementation

### 22.1 OpenAPI operation

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCaseById
      summary: Get case detail
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Case detail
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseDetailResponse'
        '404':
          $ref: '#/components/responses/NotFoundProblem'
```

### 22.2 Generated interface

```java
public interface CasesApi {
    ResponseEntity<CaseDetailResponse> getCaseById(UUID caseId);
}
```

### 22.3 Application use case

```java
public interface GetCaseUseCase {
    CaseDetail getCase(CasePublicId caseId, CurrentUser user);
}
```

### 22.4 Controller adapter

```java
@RestController
class CasesController implements CasesApi {

    private final GetCaseUseCase useCase;
    private final CaseApiMapper mapper;
    private final CurrentUserProvider currentUserProvider;

    CasesController(
        GetCaseUseCase useCase,
        CaseApiMapper mapper,
        CurrentUserProvider currentUserProvider
    ) {
        this.useCase = useCase;
        this.mapper = mapper;
        this.currentUserProvider = currentUserProvider;
    }

    @Override
    public ResponseEntity<CaseDetailResponse> getCaseById(UUID caseId) {
        CaseDetail detail = useCase.getCase(
            new CasePublicId(caseId),
            currentUserProvider.currentUser()
        );
        return ResponseEntity.ok(mapper.toResponse(detail));
    }
}
```

This is the clean mental model:

```text
OpenAPI operationId → generated Java interface method → controller adapter → application use case → domain
```

---

## 23. Practical Example: Code-First With Guardrails

If you choose code-first, use guardrails.

### 23.1 Controller

```java
@Tag(name = "Cases", description = "Case lifecycle operations")
@RestController
@RequestMapping("/cases")
class CaseController {

    @Operation(
        operationId = "createCase",
        summary = "Create a new case"
    )
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "Case created"),
        @ApiResponse(responseCode = "400", description = "Invalid request"),
        @ApiResponse(responseCode = "409", description = "Case conflicts with existing record")
    })
    @PostMapping
    ResponseEntity<CaseDetailResponse> createCase(
        @Valid @RequestBody CreateCaseRequest request
    ) {
        CaseDetail detail = service.create(mapper.toCommand(request));
        return ResponseEntity.created(URI.create("/cases/" + detail.id()))
            .body(mapper.toResponse(detail));
    }
}
```

### 23.2 CI guardrails

```text
1. Start app in CI under deterministic profile.
2. Export /v3/api-docs.yaml.
3. Validate exported spec.
4. Lint exported spec.
5. Diff against previous released spec.
6. Fail build on unapproved breaking change.
7. Publish exported spec as artifact only after review.
```

Code-first becomes much safer once exported spec is treated as a contract artifact.

---

## 24. Common Anti-Patterns in Java OpenAPI Projects

### 24.1 “We have Swagger, so we have a contract”

Swagger UI is not a contract. It is a viewer.

Contract requires:

- stable artifact;
- review;
- compatibility policy;
- tests;
- consumer communication;
- versioning.

### 24.2 Entity-as-schema

```java
@Entity
class CaseEntity {
    @Id UUID id;
    String internalStatus;
    String investigatorNotes;
    BigDecimal riskScore;
}
```

Returning this from controller exposes persistence design.

Bad:

```java
@GetMapping("/{id}")
CaseEntity getCase(@PathVariable UUID id) { ... }
```

Good:

```java
@GetMapping("/{id}")
CaseDetailResponse getCase(@PathVariable UUID id) { ... }
```

### 24.3 Annotation patchwork

A poor API with many annotations is still a poor API.

### 24.4 Generated model in domain

Generated models are boundary artifacts, not domain truth.

### 24.5 Ignoring non-200 responses

If your Java code has `@ControllerAdvice` but your OpenAPI lacks errors, contract is incomplete.

### 24.6 Runtime-only OpenAPI

If the only spec exists at `/v3/api-docs`, you do not have release history.

### 24.7 No operationId discipline

Generated clients depend heavily on operation IDs. Unstable operation IDs break SDK ergonomics.

### 24.8 Generator output manually edited

Never manually edit generated code unless your process explicitly owns a forked template strategy.

---

## 25. Decision Matrix: Which Java OpenAPI Approach Should You Use?

| Context | Recommended Approach | Why |
|---|---|---|
| Small internal Spring service | Code-first with lint/diff guardrails | Low overhead, acceptable if governed |
| Existing legacy API | Generate baseline, clean contract, then hybrid | Avoid blank-page rewrite |
| Public API | Design-first or contract-first | Consumer stability matters |
| Partner API | Contract-first | Integration cost and compatibility matter |
| Regulated API | Contract-first + audit trail | Contract is evidence |
| Platform API used by many teams | Contract-first + catalog + SDK generation | Dependency management matters |
| Rapid prototype | Code-first | Speed matters, but do not confuse prototype with contract |
| Multiple language consumers | Contract-first + generated clients | Avoid hand-written divergent clients |
| High workflow complexity | Design-first with examples and state semantics | Prevent implementation-shaped API |

---

## 26. Top 1% Java Engineer Checklist

A strong Java engineer working with OpenAPI should be able to answer:

1. What is the source of truth for this API contract?
2. Is the OpenAPI artifact versioned and released?
3. Are operation IDs stable?
4. Are all important non-2xx responses documented?
5. Is the error model consistent?
6. Are request and response schemas separated where needed?
7. Are generated models kept out of the domain layer?
8. Is there a mapping boundary?
9. Are Bean Validation constraints aligned with OpenAPI constraints?
10. Does Jackson serialization match documented schema?
11. Are examples valid?
12. Is there a breaking-change diff gate?
13. Is the generated client configured reproducibly?
14. Does the generated client have timeout/auth/retry integration?
15. Is runtime-generated spec compared against committed contract?
16. Are public/internal API groups separated?
17. Are security schemes documented accurately?
18. Is the contract published somewhere consumers can depend on?
19. Are profile/environment differences controlled?
20. Can a consumer upgrade safely?

---

## 27. Minimal Practical Setup Recommendations

For a serious Spring Boot service, a pragmatic baseline:

```text
1. Use springdoc for local exploration and runtime introspection.
2. Keep reviewed OpenAPI YAML in repository, or export generated YAML in CI and review it.
3. Add OpenAPI validation in CI.
4. Add lint rules for operationId, tags, error responses, security, pagination, and naming.
5. Add breaking-change diff against latest released spec.
6. Add response contract tests for important endpoints.
7. Generate clients only at integration boundaries.
8. Keep generated DTOs away from domain/persistence.
9. Publish OpenAPI artifact with service release.
10. Document ownership and lifecycle metadata.
```

For public/partner/regulatory APIs, strengthen it:

```text
1. Contract-first OpenAPI source of truth.
2. Human review before implementation.
3. Mock server for consumer feedback.
4. Generated server interface, not generated business logic.
5. Generated SDKs with versioned releases.
6. Full compatibility policy.
7. Audit trail for contract changes.
8. Consumer notification process.
```

---

## 28. Mental Model Summary

Java/Spring OpenAPI work has three separate concerns:

```text
1. Discovery
   What endpoints does the Java application expose?

2. Description
   What does the API promise to consumers?

3. Governance
   How do we prevent unsafe or unclear changes?
```

Springdoc is excellent for discovery and convenient documentation.

Swagger annotations are useful for enriching description.

OpenAPI Generator is powerful for producing clients/stubs/docs.

But none of them automatically gives you API governance.

The mature position is:

```text
Use Java tools to automate the boring parts.
Use OpenAPI contract discipline to protect consumers.
Use architecture boundaries to protect your domain model.
Use CI/CD gates to prevent drift.
```

---

## 29. Exercises

### Exercise 1 — Inspect an Existing Spring Endpoint

Pick one Spring controller in your codebase.

Answer:

1. What path and method does it expose?
2. What is the operationId?
3. Does it document non-200 responses?
4. Does the response schema expose internal fields?
5. Does the request schema reuse persistence entity?
6. Are validation constraints clear?
7. Are examples present?
8. Would a generated client method name be stable and readable?

### Exercise 2 — Convert Annotation Soup into Contract Design

Take one annotation-heavy controller method.

Refactor thinking:

1. Which metadata belongs in reusable OpenAPI components?
2. Which metadata belongs in global customizer?
3. Which belongs near the method?
4. Which should be moved into design-first YAML?
5. Which annotation exists only because the DTO is poorly shaped?

### Exercise 3 — Design a Boundary Mapping

Given:

```text
CreateCaseRequest → CreateCaseCommand → Case aggregate → CaseDetailResponse
```

Write mapping responsibilities:

- API request validation;
- application command creation;
- domain invariant enforcement;
- response shaping;
- sensitive field exclusion;
- error mapping.

### Exercise 4 — Generated Client Risk Review

Generate a Java client from one OpenAPI spec.

Review:

1. package names;
2. method names;
3. enum handling;
4. nullable handling;
5. date/time handling;
6. exception model;
7. auth injection;
8. timeout configuration;
9. response header access;
10. regeneration reproducibility.

---

## 30. Part 013 Key Takeaways

- springdoc is a runtime inference/documentation tool, not automatically a design authority.
- Swagger annotations enrich OpenAPI output, but annotation-heavy controllers are a maintainability smell.
- OpenAPI Generator is powerful, but generated code should live at system boundaries.
- Generated DTOs should not leak into domain or persistence layers.
- Bean Validation, Jackson, and OpenAPI schema must be aligned deliberately.
- Runtime `/v3/api-docs` is useful, but a released OpenAPI artifact is what consumers can depend on.
- CI should validate, lint, diff, test, and publish OpenAPI artifacts.
- The best Java/OpenAPI workflow is not purely code-first or contract-first by ideology; it is chosen based on consumer risk, API lifecycle, and governance needs.

---

## 31. References

Primary references used while preparing this part:

- OpenAPI Specification v3.2.0 — official specification.
- OpenAPI Initiative — official OpenAPI overview and lifecycle positioning.
- springdoc-openapi official documentation — Spring Boot OpenAPI generation from runtime application structure and annotations.
- Swagger Core annotations documentation — Java annotations for OpenAPI output.
- OpenAPI Generator official documentation — Java/Spring generator and code generation capabilities.

---

## 32. Series Progress

```text
Current part: 013 / 030
Status: In progress
Series complete: No
Remaining parts: 17
Next: Part 014 — Contract Testing: Validating Providers and Consumers Against OpenAPI
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-012.md">⬅️ OpenAPI Mastery for Java Engineers — Part 012</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-014.md">OpenAPI Mastery for Java Engineers — Part 014 ➡️</a>
</div>
