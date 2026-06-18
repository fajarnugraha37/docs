# Part 26 — Records, Builders, and Modern Java DTO Strategy

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `26-records-builders-modern-java-dto-strategy.md`  
> Status: Part 26 dari 35  
> Fokus: strategi DTO modern berbasis Java records, builders, immutability, compatibility, dan migrasi dari Java 8-style POJO/Lombok menuju Java 21/25-style DTO.

---

## 1. Mengapa Part Ini Penting

Setelah memahami Lombok, Jackson, MapStruct, dan builder interoperability, sekarang kita perlu menjawab pertanyaan desain yang lebih besar:

> Dalam Java modern, bentuk DTO terbaik itu apa?

Apakah kita harus selalu memakai:

- POJO mutable dengan getter/setter?
- Lombok `@Data`?
- Lombok `@Value`?
- Lombok `@Builder`?
- Java records?
- sealed hierarchy?
- manual immutable class?

Jawaban senior bukan “pakai records saja” atau “pakai Lombok saja”. Jawaban yang lebih benar:

> Bentuk DTO harus dipilih berdasarkan boundary, lifecycle, compatibility, deserialization model, evolution cost, dan semantic guarantees yang ingin dipertahankan.

DTO bukan sekadar class pembungkus data. DTO adalah public shape dari boundary. Ketika DTO dipakai di API, event, persistence projection, cache, batch file, atau integration payload, bentuk DTO akan memengaruhi:

- cara Jackson membaca dan menulis payload,
- cara MapStruct menghasilkan mapping,
- cara validation dijalankan,
- cara compatibility dijaga,
- cara test ditulis,
- cara IDE/compiler membantu menemukan kesalahan,
- cara sistem berevolusi saat field bertambah/berubah,
- cara developer baru memahami kontrak.

Java 8 era banyak codebase memakai POJO mutable karena itulah bentuk paling kompatibel dengan framework. Java modern membuka opsi yang lebih kuat: records, sealed types, pattern matching, stricter constructors, dan explicit immutability. Tetapi opsi modern ini harus dipakai dengan pemahaman, bukan sekadar karena terlihat lebih ringkas.

---

## 2. Mental Model Utama

### 2.1 DTO Shape adalah Contract Shape

Misalnya kita punya response:

```json
{
  "applicationId": "APP-2026-0001",
  "status": "PENDING_REVIEW",
  "submittedAt": "2026-06-17T08:30:00+07:00"
}
```

Java DTO-nya bisa ditulis sebagai POJO:

```java
public class ApplicationResponse {
    private String applicationId;
    private String status;
    private OffsetDateTime submittedAt;

    public String getApplicationId() { return applicationId; }
    public void setApplicationId(String applicationId) { this.applicationId = applicationId; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public OffsetDateTime getSubmittedAt() { return submittedAt; }
    public void setSubmittedAt(OffsetDateTime submittedAt) { this.submittedAt = submittedAt; }
}
```

Atau sebagai record:

```java
public record ApplicationResponse(
        String applicationId,
        String status,
        OffsetDateTime submittedAt
) {}
```

JSON contract-nya mungkin sama. Tetapi semantic shape Java-nya berbeda.

POJO mutable mengatakan:

> Object boleh dibuat kosong, lalu diisi bertahap, lalu diubah lagi.

Record mengatakan:

> Object ini adalah carrier data immutable dengan semua komponennya diketahui saat construction.

Perbedaan ini penting karena mapper, validation, dan domain boundary membaca sinyal desain dari bentuk object.

---

### 2.2 DTO Bukan Domain Object

Record cocok untuk banyak DTO, tetapi jangan disalahartikan sebagai domain model otomatis.

DTO menjawab:

> Data apa yang masuk/keluar boundary?

Domain model menjawab:

> Invariant apa yang harus selalu benar dalam sistem?

Contoh DTO request:

```java
public record SubmitAppealRequest(
        String applicationId,
        String reason,
        List<String> documentIds
) {}
```

Ini tidak harus menjadi aggregate domain. Domain command bisa berbeda:

```java
public record SubmitAppealCommand(
        ApplicationId applicationId,
        AppealReason reason,
        List<DocumentId> documentIds,
        UserId submittedBy
) {}
```

Request DTO masih stringly-typed karena berasal dari HTTP JSON. Command lebih semantic karena sudah melewati parsing, normalization, dan authorization context enrichment.

Mental model:

```text
External JSON
    ↓ deserialize
Request DTO
    ↓ normalize + validate + authorize + map
Command
    ↓ domain behavior
Aggregate / Domain Service
    ↓ result
Response DTO / Event DTO
    ↓ serialize
External JSON / Event Payload
```

Records sangat berguna untuk DTO dan command carrier. Tetapi domain aggregate sering membutuhkan behavior, lifecycle, state transition, dan invariant yang lebih kaya daripada sekadar record.

---

## 3. Evolusi Bentuk DTO dari Java 8 ke Java 25

### 3.1 Java 8 Era: Mutable POJO sebagai Default

Di Java 8, DTO umumnya:

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

Kelebihan:

- sangat kompatibel dengan framework lama,
- mudah dipahami,
- mudah di-bind oleh Jackson/JAXB lama,
- mudah dipakai oleh reflection mapper,
- cocok untuk form binding lama,
- cocok untuk tools yang butuh no-args constructor.

Kekurangan:

- object bisa berada dalam keadaan setengah valid,
- field bisa diubah setelah dibuat,
- mudah terjadi accidental mutation,
- equality sering tidak jelas,
- banyak boilerplate,
- kontrak object tidak eksplisit,
- over-posting lebih mudah jika entity/DTO dipakai sembarangan,
- sulit membedakan required field dari optional field hanya dari class shape.

Mutable POJO bukan buruk. Ia hanya terlalu permisif untuk banyak boundary modern.

---

### 3.2 Lombok Era: Boilerplate Reduction

Dengan Lombok:

```java
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class UserDto {
    private String id;
    private String name;
}
```

Atau:

```java
@Data
public class UserDto {
    private String id;
    private String name;
}
```

Kelebihan:

- mengurangi boilerplate,
- tetap kompatibel dengan Java 8,
- tetap cocok dengan framework lama,
- mudah transisi dari POJO manual.

Kekurangan:

- generated behavior tidak terlihat langsung,
- `@Data` terlalu luas,
- equals/hashCode/toString bisa berbahaya untuk entity/proxy/cycle,
- annotation processor coupling,
- perlu IDE/plugin/build setup benar,
- tidak memberikan immutability kecuali memakai annotation tertentu.

Lombok membantu mengurangi kebisingan, tetapi tidak otomatis memperbaiki desain DTO.

---

### 3.3 Java 16+ Records: Data Carrier sebagai Language Feature

Record:

```java
public record UserDto(
        String id,
        String name
) {}
```

Record secara konsep adalah transparent carrier untuk data immutable. Compiler menghasilkan:

- private final fields,
- canonical constructor,
- accessor dengan nama component,
- `equals`,
- `hashCode`,
- `toString`.

Kelebihan:

- ringkas tanpa Lombok,
- immutable by default,
- constructor jelas,
- equality structural,
- shape object eksplisit,
- cocok untuk DTO, event, command, projection,
- baik untuk contract readability,
- annotation processor dependency berkurang.

Kekurangan:

- tidak cocok untuk semua framework lama,
- tidak punya no-args constructor,
- tidak punya setter,
- component list adalah bagian dari API source-level,
- jika field banyak, constructor call bisa sulit dibaca,
- compatibility perlu direncanakan,
- shallow immutability: collection di dalam record tetap bisa mutable jika tidak disalin.

Record adalah pilihan modern yang kuat, tetapi bukan pengganti universal untuk semua class.

---

## 4. Records Deep Dive untuk DTO

### 4.1 Record sebagai Immutable Data Carrier

Contoh:

```java
public record CaseSummaryResponse(
        String caseId,
        String caseNo,
        String status,
        String assignedOfficerName,
        OffsetDateTime createdAt,
        OffsetDateTime lastUpdatedAt
) {}
```

Yang dibaca dari bentuk ini:

1. Semua data diberikan saat object dibuat.
2. Tidak ada setter.
3. Object tidak dimaksudkan berubah setelah dibuat.
4. Equality berdasarkan semua component.
5. Shape DTO terlihat langsung dari header record.

Ini sangat cocok untuk response DTO dan event DTO yang harus stabil setelah dibuat.

---

### 4.2 Record Accessor Bukan Getter JavaBean Tradisional

Record accessor bernama sama dengan component:

```java
caseSummary.caseId();
caseSummary.status();
```

Bukan:

```java
caseSummary.getCaseId();
```

Framework modern seperti Jackson dan MapStruct sudah mendukung records, tetapi codebase lama atau library lama mungkin masih mengasumsikan JavaBean getter.

Implikasi:

- records cocok untuk stack modern,
- hati-hati jika ada reflection utility lama,
- hati-hati jika ada template engine/form binding lama,
- hati-hati jika internal coding convention masih JavaBean-centric.

---

### 4.3 Compact Constructor untuk Normalization dan Guard Ringan

Record bisa punya compact constructor:

```java
public record CreateUserRequest(
        String username,
        String email
) {
    public CreateUserRequest {
        username = username == null ? null : username.trim();
        email = email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }
}
```

Ini berguna untuk normalization sederhana. Tetapi jangan menjadikan record constructor sebagai service layer.

Masuk akal di compact constructor:

- trim string,
- canonicalize email case,
- defensive copy collection,
- reject impossible structural state,
- normalize empty string jika policy jelas.

Tidak ideal di compact constructor:

- akses database,
- cek authorization,
- panggil external API,
- resolve reference data,
- validasi kompleks cross-aggregate,
- logic bisnis yang butuh context runtime.

Rule:

> Record constructor boleh menjaga local structural correctness, bukan menjalankan workflow bisnis.

---

### 4.4 Shallow Immutability: Jebakan Collection di Record

Record ini terlihat immutable:

```java
public record SubmitDocumentsRequest(
        String applicationId,
        List<String> documentIds
) {}
```

Tetapi `List` di dalamnya bisa mutable:

```java
List<String> ids = new ArrayList<>();
ids.add("DOC-1");

SubmitDocumentsRequest request = new SubmitDocumentsRequest("APP-1", ids);

ids.add("DOC-2");

// request.documentIds() sekarang ikut berubah secara observable
```

Record hanya membuat reference field final. Ia tidak otomatis membuat isi object menjadi immutable.

Defensive copy:

```java
public record SubmitDocumentsRequest(
        String applicationId,
        List<String> documentIds
) {
    public SubmitDocumentsRequest {
        documentIds = documentIds == null
                ? List.of()
                : List.copyOf(documentIds);
    }
}
```

Untuk Java 8, bisa pakai:

```java
this.documentIds = documentIds == null
        ? Collections.emptyList()
        : Collections.unmodifiableList(new ArrayList<>(documentIds));
```

Mental model:

```text
record gives final references
not automatically immutable object graph
```

Untuk top-level engineer, ini wajib dipahami. Banyak engineer mengira record selalu immutable total. Itu keliru.

---

### 4.5 Record dengan Optional: Hati-Hati

Secara umum, hindari `Optional` sebagai field DTO JSON:

```java
public record UserResponse(
        String id,
        Optional<String> displayName
) {}
```

Masalah:

- JSON tidak punya konsep `Optional`,
- Jackson support bergantung module/config,
- OpenAPI schema bisa membingungkan,
- null vs absent vs optional menjadi kabur,
- client tidak melihat `Optional`, client hanya melihat field ada/tidak/null.

Lebih jelas:

```java
public record UserResponse(
        String id,
        String displayName
) {}
```

Lalu contract menentukan:

- apakah `displayName` required,
- apakah boleh null,
- apakah field boleh absent,
- apakah empty string valid.

Gunakan `Optional` untuk return method internal, bukan sebagai default shape DTO.

---

## 5. Builder Deep Dive

### 5.1 Builder Menyelesaikan Masalah Constructor Panjang

Record dengan banyak field:

```java
public record CaseDetailResponse(
        String caseId,
        String caseNo,
        String status,
        String caseType,
        String assignedOfficerName,
        String applicantName,
        String applicantEmail,
        OffsetDateTime createdAt,
        OffsetDateTime submittedAt,
        OffsetDateTime lastUpdatedAt,
        List<DocumentResponse> documents,
        List<ActionHistoryResponse> actionHistory
) {}
```

Constructor call akan sulit dibaca:

```java
new CaseDetailResponse(
        caseId,
        caseNo,
        status,
        caseType,
        officerName,
        applicantName,
        applicantEmail,
        createdAt,
        submittedAt,
        lastUpdatedAt,
        documents,
        actionHistory
);
```

Risiko:

- parameter tertukar,
- review sulit,
- field baru membuat call site berubah banyak,
- readability rendah.

Builder membantu:

```java
CaseDetailResponse response = CaseDetailResponse.builder()
        .caseId(caseId)
        .caseNo(caseNo)
        .status(status)
        .caseType(caseType)
        .assignedOfficerName(officerName)
        .applicantName(applicantName)
        .applicantEmail(applicantEmail)
        .createdAt(createdAt)
        .submittedAt(submittedAt)
        .lastUpdatedAt(lastUpdatedAt)
        .documents(documents)
        .actionHistory(actionHistory)
        .build();
```

Builder meningkatkan readability saat jumlah field banyak atau banyak optional fields.

---

### 5.2 Builder Bukan Pengganti Validity

Builder sering membuat object creation tampak aman, tetapi bisa tetap menghasilkan object invalid:

```java
CaseDetailResponse response = CaseDetailResponse.builder()
        .caseId("APP-1")
        .build();
```

Jika required fields tidak di-check, builder hanya memindahkan masalah dari constructor ke `build()`.

Builder production-grade harus punya:

- required field policy,
- null policy,
- default policy,
- defensive copy,
- validation location yang jelas,
- test untuk incomplete builder.

Dengan Lombok `@Builder`, required field tidak otomatis required secara compile-time. Semua setter builder biasanya optional secara syntactic.

---

### 5.3 Builder Cocok Untuk Apa?

Builder cocok untuk:

- DTO dengan banyak field,
- response assembly kompleks,
- test fixture,
- optional fields banyak,
- object immutable dengan readable construction,
- MapStruct target builder,
- Jackson builder deserialization jika dikonfigurasi benar.

Builder kurang cocok untuk:

- DTO kecil 2-4 field,
- command yang harus semua field required,
- object dengan strict invariant yang lebih baik dipaksa constructor,
- model yang sering dipakai di hot path allocation sensitif,
- patch request dengan absent/null semantics yang perlu eksplisit.

---

### 5.4 Builder dan Records

Java records tidak punya builder built-in. Opsi:

1. Gunakan canonical constructor langsung.
2. Tulis builder manual.
3. Gunakan Lombok `@Builder` pada record jika versi Lombok mendukung dan policy tim mengizinkan.
4. Pakai mapper/generated builder eksternal.

Contoh builder manual sederhana:

```java
public record CaseSummaryResponse(
        String caseId,
        String caseNo,
        String status,
        OffsetDateTime createdAt
) {
    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String caseId;
        private String caseNo;
        private String status;
        private OffsetDateTime createdAt;

        public Builder caseId(String caseId) {
            this.caseId = caseId;
            return this;
        }

        public Builder caseNo(String caseNo) {
            this.caseNo = caseNo;
            return this;
        }

        public Builder status(String status) {
            this.status = status;
            return this;
        }

        public Builder createdAt(OffsetDateTime createdAt) {
            this.createdAt = createdAt;
            return this;
        }

        public CaseSummaryResponse build() {
            return new CaseSummaryResponse(caseId, caseNo, status, createdAt);
        }
    }
}
```

Ini verbose. Untuk DTO kecil, constructor record jauh lebih bersih.

---

## 6. Strategy Matrix: POJO vs Lombok vs Record vs Builder

### 6.1 Perbandingan Umum

| Bentuk | Cocok Untuk | Kelebihan | Risiko |
|---|---|---|---|
| Mutable POJO | legacy framework, form binding, Java 8 compatibility | kompatibel, mudah dipakai framework lama | mutable, boilerplate, state setengah valid |
| Lombok `@Getter/@Setter` | Java 8+ DTO sederhana | boilerplate rendah, tetap familiar | mutability tetap ada, generated code tersembunyi |
| Lombok `@Value` | immutable DTO Java 8+ | immutable-ish, ringkas | Lombok coupling, collection tetap shallow |
| Lombok `@Builder` | banyak field, readable creation | call site jelas | required field tidak compile-time enforced |
| Java record | modern DTO, event, command carrier | ringkas, immutable reference, transparent shape | no setter/no no-args, shallow immutability |
| Record + manual constructor | DTO dengan normalization lokal | invariant ringan dekat data | jangan overuse untuk business logic |
| Record + builder | banyak field modern DTO | readable + immutable | complexity dan tooling meningkat |
| Manual immutable class | high-control model | full control | verbose |

---

### 6.2 Decision Heuristic

Gunakan **record** jika:

- Java baseline minimal 16+,
- DTO adalah data carrier,
- semua field sebaiknya diketahui saat construction,
- tidak butuh setter/no-args,
- boundary modern mendukung records,
- kamu ingin immutability dan shape eksplisit.

Gunakan **mutable POJO** jika:

- masih Java 8,
- framework/tool lama membutuhkan no-args + setter,
- XML/JAXB legacy binding lebih mudah dengan bean style,
- form binding lama membutuhkan mutability,
- DTO memang intermediate object yang diisi bertahap oleh framework.

Gunakan **Lombok `@Value`** jika:

- masih Java 8/11 tetapi ingin immutable DTO,
- tim sudah matang dengan Lombok,
- build/IDE annotation processing stabil,
- belum bisa memakai records.

Gunakan **builder** jika:

- field banyak,
- optional fields banyak,
- readability constructor buruk,
- test fixture banyak,
- response assembly kompleks,
- object tetap ingin immutable.

Hindari **`@Data` sebagai default DTO policy** jika:

- DTO dipakai sebagai public API contract,
- ada sensitive fields,
- ada nested graph/cycle,
- DTO dekat dengan JPA entity,
- equality/toString tidak ingin otomatis.

---

## 7. DTO Strategy per Boundary

### 7.1 Request DTO

Request DTO mewakili input eksternal.

Pertanyaan desain:

- Apakah field required?
- Apakah null allowed?
- Apakah unknown fields ditolak?
- Apakah string perlu trim?
- Apakah absent berbeda dari explicit null?
- Apakah partial update perlu semantics khusus?

Untuk simple create request di Java modern:

```java
public record CreateOfficerRequest(
        String name,
        String email,
        String departmentCode
) {
    public CreateOfficerRequest {
        name = normalizeBlankToNull(name);
        email = normalizeEmail(email);
        departmentCode = normalizeUpper(departmentCode);
    }

    private static String normalizeBlankToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String normalizeEmail(String value) {
        String normalized = normalizeBlankToNull(value);
        return normalized == null ? null : normalized.toLowerCase(Locale.ROOT);
    }

    private static String normalizeUpper(String value) {
        String normalized = normalizeBlankToNull(value);
        return normalized == null ? null : normalized.toUpperCase(Locale.ROOT);
    }
}
```

Ini masih aman karena normalization bersifat lokal dan deterministic.

Untuk PATCH request, record biasa bisa kurang ekspresif karena perlu membedakan absent vs null.

Misalnya:

```json
{}
```

berbeda dari:

```json
{
  "email": null
}
```

Dalam kasus ini, DTO biasa:

```java
public record UpdateUserRequest(String email) {}
```

Tidak cukup karena `email == null` bisa berarti absent atau explicit null, tergantung deserialization metadata.

Solusi lebih eksplisit akan dibahas lanjut di part update/patch dan testing, tetapi bentuk umum bisa berupa wrapper:

```java
public record PatchField<T>(
        boolean present,
        T value
) {}
```

Lalu:

```java
public record UpdateUserPatchRequest(
        PatchField<String> email,
        PatchField<String> displayName
) {}
```

Atau gunakan JSON Merge Patch/JsonNode di boundary lalu mapping manual.

Rule:

> Record cocok untuk request penuh. Untuk patch semantics, butuh representasi presence yang eksplisit.

---

### 7.2 Response DTO

Response DTO sangat cocok memakai records:

```java
public record OfficerResponse(
        String officerId,
        String name,
        String email,
        String departmentName,
        boolean active
) {}
```

Response biasanya:

- dibuat oleh server,
- tidak dimutasi setelah dibuat,
- dikirim ke client,
- shape-nya harus jelas,
- cocok dengan immutable DTO.

Untuk response besar, builder bisa dipertimbangkan, tetapi jangan otomatis.

Jika MapStruct membuat record dari source object, constructor record cukup.

---

### 7.3 Command DTO / Application Command

Command internal juga cocok dengan record:

```java
public record AssignCaseCommand(
        CaseId caseId,
        OfficerId officerId,
        UserId assignedBy,
        AssignmentReason reason
) {}
```

Command berbeda dari request DTO karena sudah semantic:

- `CaseId` bukan raw string,
- `OfficerId` bukan raw string,
- `assignedBy` berasal dari security context,
- `reason` bisa value object atau enum domain,
- command hanya bisa dibuat setelah boundary validation/enrichment.

Record membuat command immutable dan eksplisit.

---

### 7.4 Event DTO

Event payload harus sangat hati-hati karena compatibility-nya jangka panjang.

```java
public record CaseAssignedEventV1(
        String eventId,
        String caseId,
        String officerId,
        String assignedBy,
        OffsetDateTime occurredAt
) {}
```

Record cocok karena event seharusnya immutable. Tetapi ada risiko:

- menambah component mengubah canonical constructor,
- equality berubah,
- deserialization event lama harus tetap bisa,
- default value untuk field baru perlu jelas,
- schema evolution harus direncanakan.

Untuk event public atau cross-service, jangan mengandalkan bentuk Java saja. Tetap butuh:

- versioned event type,
- compatibility tests,
- golden payload,
- documented nullable/required policy,
- consumer impact analysis.

---

### 7.5 Persistence Projection DTO

Projection DTO dari query database:

```java
public record CaseListProjection(
        String caseId,
        String caseNo,
        String status,
        OffsetDateTime createdAt
) {}
```

Record cocok untuk query projection karena:

- immutable,
- shape dekat dengan query output,
- tidak perlu entity lifecycle,
- mudah dimapping ke response.

Tetapi jika framework projection lama butuh JavaBean getter atau no-args constructor, POJO masih bisa diperlukan.

---

### 7.6 XML DTO

Untuk XML/JAXB legacy, mutable POJO sering masih lebih praktis:

```java
@XmlRootElement(name = "Case")
@XmlAccessorType(XmlAccessType.FIELD)
public class CaseXmlDto {
    @XmlElement(name = "CaseId")
    private String caseId;

    @XmlElement(name = "Status")
    private String status;

    public CaseXmlDto() {
    }

    public String getCaseId() {
        return caseId;
    }

    public void setCaseId(String caseId) {
        this.caseId = caseId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
```

Jangan memaksakan records jika XML binding stack membuat konfigurasi menjadi terlalu rapuh. Untuk XML, contract sering bergantung pada:

- element order,
- namespace,
- attributes,
- wrapper element,
- XSD compatibility,
- no-args constructor expectations.

Rule:

> Modern Java DTO strategy bukan berarti semua class menjadi record. Boundary menentukan bentuk.

---

## 8. Jackson dengan Records

### 8.1 Deserialization Record

Record:

```java
public record CreateCaseRequest(
        String applicantId,
        String caseType,
        String description
) {}
```

JSON:

```json
{
  "applicantId": "APL-1",
  "caseType": "COMPLAINT",
  "description": "Customer complaint about service delay"
}
```

Jackson modern dapat bind JSON ke canonical constructor record. Namun contract behavior tetap perlu dipahami:

- missing field bisa menjadi null untuk reference type,
- explicit null juga null,
- unknown field behavior tergantung config,
- required field enforcement tidak otomatis sama dengan Bean Validation,
- primitive default bisa menutupi missing field.

Contoh berbahaya:

```java
public record CreateUserRequest(
        String username,
        int age
) {}
```

Jika `age` missing dan config tidak strict, default `0` bisa muncul. Untuk inbound API, hindari primitive jika missing harus terdeteksi.

Lebih aman:

```java
public record CreateUserRequest(
        String username,
        Integer age
) {}
```

Lalu validation menentukan required/range.

---

### 8.2 Annotation pada Record Component

```java
public record UserResponse(
        @JsonProperty("user_id") String userId,
        @JsonProperty("display_name") String displayName
) {}
```

Atau gunakan naming strategy global/per mapper. Untuk public API, pilih policy konsisten:

- annotation explicit untuk field kontrak kritikal,
- naming strategy untuk standar umum,
- jangan campur tanpa alasan.

---

### 8.3 Record dan Backward Compatibility

Misalnya V1:

```java
public record UserResponse(
        String id,
        String name
) {}
```

V2 menambah field:

```java
public record UserResponse(
        String id,
        String name,
        String email
) {}
```

Untuk serialization ke client, penambahan field biasanya additive jika client tolerant.

Untuk deserialization dari payload lama, `email` akan null jika missing. Apakah itu valid? Tergantung contract.

Jika DTO dipakai untuk inbound event replay, menambah required component bisa menjadi breaking change.

Rule:

> Record membuat shape source code jelas, tetapi tidak otomatis menyelesaikan schema evolution.

---

## 9. MapStruct dengan Records

### 9.1 Mapping ke Record Target

```java
public record UserResponse(
        String id,
        String name,
        String email
) {}
```

Mapper:

```java
@Mapper(componentModel = "spring")
public interface UserMapper {
    UserResponse toResponse(User user);
}
```

Generated mapper secara konsep akan memanggil constructor record:

```java
return new UserResponse(
        user.getId(),
        user.getName(),
        user.getEmail()
);
```

Kelebihan:

- missing target component bisa terdeteksi saat compile,
- mapping eksplisit lebih mudah dicek,
- output immutable.

---

### 9.2 Update Mapping Tidak Cocok untuk Record Target

MapStruct `@MappingTarget` cocok untuk mutable target:

```java
void updateEntity(UpdateUserRequest request, @MappingTarget User entity);
```

Record tidak bisa di-update karena immutable:

```java
public record UserDto(String id, String name) {}
```

Tidak ada setter. Untuk immutable target, update berarti membuat object baru:

```java
public UserDto withName(UserDto existing, String newName) {
    return new UserDto(existing.id(), newName);
}
```

Untuk DTO response, ini tidak masalah. Untuk patch/update entity, target biasanya entity mutable atau aggregate method, bukan record DTO.

Rule:

> Records cocok sebagai output atau command carrier; tidak cocok sebagai in-place update target.

---

### 9.3 Record Mapping dan Field Order

Record constructor bergantung pada component order. Namun MapStruct menyambungkan berdasarkan nama property/component, bukan sekadar urutan manual di source code user.

Tetap, saat manual mapping, field order raw constructor bisa berisiko:

```java
return new UserResponse(user.getName(), user.getId(), user.getEmail()); // tertukar
```

Jika field bertipe sama (`String`, `String`, `String`), compiler tidak menolong.

Untuk DTO dengan banyak same-type fields, pertimbangkan:

- MapStruct,
- builder,
- static factory dengan nama jelas,
- value object untuk tipe semantic,
- test golden payload.

---

## 10. Lombok vs Records: Bukan Sekadar Ringkas Mana

### 10.1 Lombok `@Value`

```java
@Value
public class UserResponse {
    String id;
    String name;
    String email;
}
```

Mirip record dalam banyak hal:

- final class by default,
- private final fields,
- constructor,
- getters,
- equals/hashCode/toString.

Tetapi berbeda:

- accessor JavaBean-style `getId()`,
- butuh Lombok,
- bukan language-level record,
- tidak punya record component metadata yang sama,
- lebih kompatibel dengan Java 8.

Gunakan `@Value` saat Java baseline belum mendukung records.

---

### 10.2 Records Mengurangi Kebutuhan Lombok DTO

Jika baseline Java 21/25, banyak DTO sederhana tidak perlu Lombok:

```java
public record DepartmentResponse(
        String code,
        String name
) {}
```

Ini lebih jelas daripada:

```java
@Value
public class DepartmentResponse {
    String code;
    String name;
}
```

Keuntungan records:

- tidak perlu annotation processor,
- behavior standar language,
- IDE/compiler memahami langsung,
- lebih mudah onboarding.

Tetapi Lombok tetap berguna untuk:

- Java 8/11 codebase,
- builder generation,
- mixed legacy code,
- non-record immutable classes,
- constructor injection di component class.

---

## 11. Sealed DTO Hierarchy

Java modern memungkinkan sealed hierarchy:

```java
public sealed interface SearchResultResponse
        permits CaseSearchResultResponse, OfficerSearchResultResponse {
}

public record CaseSearchResultResponse(
        String caseId,
        String caseNo,
        String status
) implements SearchResultResponse {}

public record OfficerSearchResultResponse(
        String officerId,
        String name,
        String department
) implements SearchResultResponse {}
```

Ini berguna jika output memiliki beberapa varian terbatas.

Tetapi untuk JSON, polymorphism harus dirancang eksplisit:

```json
{
  "type": "CASE",
  "caseId": "CASE-1",
  "caseNo": "C-2026-001",
  "status": "OPEN"
}
```

Jangan mengandalkan class name sebagai type id untuk public contract. Gunakan discriminator stabil seperti `type`.

Mental model:

```text
sealed hierarchy gives Java-side exhaustiveness
JSON still needs explicit stable discriminator
```

Cocok untuk:

- limited response variants,
- event subtypes,
- command subtypes internal,
- domain-adjacent DTO.

Hati-hati untuk:

- public API evolution,
- Jackson polymorphic config,
- consumer compatibility,
- OpenAPI discriminator documentation.

---

## 12. Required, Optional, Nullable, Absent: DTO Shape Tidak Cukup

DTO field bisa berada dalam empat state kontrak:

1. Required and non-null.
2. Required but nullable.
3. Optional and absent allowed.
4. Optional but if present must be non-null.

Java type saja tidak cukup untuk mengekspresikan semua ini.

Contoh:

```java
public record UserRequest(String email) {}
```

`String email` tidak menjelaskan:

- apakah email wajib,
- apakah null boleh,
- apakah absent sama dengan null,
- apakah blank valid,
- apakah perlu format email.

Maka perlu kombinasi:

- deserialization strictness,
- Bean Validation,
- OpenAPI schema,
- mapper normalization,
- contract tests.

Contoh:

```java
public record CreateUserRequest(
        @NotBlank
        @Email
        String email,

        @NotBlank
        String displayName
) {}
```

Tetapi tetap perlu memahami bahwa Bean Validation berjalan setelah deserialization, bukan menggantikan deserialization strictness.

---

## 13. Compatibility: Mengubah DTO Modern Tidak Selalu Aman

### 13.1 Menambah Field

Response DTO:

```java
public record UserResponse(
        String id,
        String name,
        String email
) {}
```

Menambah field:

```java
public record UserResponse(
        String id,
        String name,
        String email,
        String department
) {}
```

Untuk outbound JSON, additive field biasanya aman jika client tolerant. Tetapi bisa tetap breaking jika:

- client strict parser,
- generated client tidak expect field,
- signature/hash payload berubah,
- snapshot tests client gagal,
- response size/performance berubah,
- field sensitive tidak boleh terekspos.

---

### 13.2 Menghapus Field

Menghapus field hampir selalu breaking untuk response/public event.

V1:

```json
{
  "id": "U-1",
  "name": "Alice"
}
```

V2:

```json
{
  "id": "U-1"
}
```

Client yang memakai `name` rusak.

Jika harus deprecate:

1. Tandai field deprecated di docs/schema.
2. Tetap serialize selama periode kompatibilitas.
3. Monitor usage jika memungkinkan.
4. Rilis versi baru jika kontrak besar berubah.

---

### 13.3 Rename Field

Rename bukan additive; itu remove + add.

```java
public record UserResponse(String fullName) {}
```

Mengubah dari `name` ke `fullName` akan memutus client kecuali ada compatibility alias pada inbound atau dual output sementara pada outbound.

Untuk inbound:

```java
public record UserRequest(
        @JsonAlias("name")
        @JsonProperty("fullName")
        String fullName
) {}
```

Untuk outbound, alias tidak otomatis membuat dua field. Kalau perlu transisi, expose dua property secara sadar.

---

## 14. Migration Strategy: Java 8 POJO/Lombok ke Records

### 14.1 Jangan Migrasi Semua Sekaligus

Migrasi DTO ke records harus bertahap:

1. Pilih DTO outbound internal yang risiko rendah.
2. Tambahkan golden payload tests sebelum refactor.
3. Ubah POJO ke record.
4. Pastikan JSON output sama.
5. Pastikan MapStruct/Jackson tests lewat.
6. Baru lanjut ke DTO lain.

Jangan mulai dari:

- public event payload kritikal,
- XML/JAXB DTO,
- patch request,
- DTO yang dipakai banyak reflection utility lama,
- JPA entity,
- class dengan behavior lifecycle kompleks.

---

### 14.2 Migration Example

Sebelum:

```java
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class CaseSummaryResponse {
    private String caseId;
    private String caseNo;
    private String status;
    private OffsetDateTime createdAt;
}
```

Test dulu output JSON:

```java
@Test
void shouldSerializeCaseSummaryResponseContract() throws Exception {
    CaseSummaryResponse response = new CaseSummaryResponse(
            "CASE-1",
            "C-2026-001",
            "OPEN",
            OffsetDateTime.parse("2026-06-17T08:30:00+07:00")
    );

    String json = objectMapper.writeValueAsString(response);

    assertThatJson(json).isEqualTo("""
        {
          "caseId": "CASE-1",
          "caseNo": "C-2026-001",
          "status": "OPEN",
          "createdAt": "2026-06-17T08:30:00+07:00"
        }
        """);
}
```

Sesudah:

```java
public record CaseSummaryResponse(
        String caseId,
        String caseNo,
        String status,
        OffsetDateTime createdAt
) {}
```

Jalankan test yang sama. Jika JSON berubah, evaluasi apakah perubahan itu disengaja.

---

### 14.3 Migration Checklist

Sebelum mengubah DTO ke record, cek:

- Apakah Java baseline sudah mendukung records?
- Apakah Jackson version mendukung records dengan baik?
- Apakah MapStruct version mendukung mapping ke records?
- Apakah DTO butuh no-args constructor?
- Apakah DTO butuh setter?
- Apakah DTO dipakai JAXB/XML binding?
- Apakah DTO dipakai reflection utility lama?
- Apakah DTO dipakai template engine/form binding?
- Apakah ada field collection yang perlu defensive copy?
- Apakah JSON contract sudah ditest?
- Apakah OpenAPI/schema tetap sama?
- Apakah public clients terdampak?

---

## 15. Common Anti-Patterns

### 15.1 “Semua DTO Harus Record”

Ini terlalu dogmatis. Records sangat baik, tetapi tidak semua boundary cocok.

Counterexample:

- XML DTO lama,
- patch request yang butuh presence tracking,
- framework lama yang butuh setter,
- huge DTO yang butuh builder untuk readability,
- generated classes dari XSD/OpenAPI,
- intermediate mutable accumulator.

---

### 15.2 “Record Sudah Pasti Immutable Total”

Salah. Record memberikan shallow immutability. Collection dan object nested tetap bisa mutable.

Selalu evaluasi:

```java
List.copyOf(...)
Set.copyOf(...)
Map.copyOf(...)
```

Untuk nested object mutable, perlu strategi lebih lanjut.

---

### 15.3 “Builder Selalu Lebih Baik dari Constructor”

Builder bagus untuk readability, tetapi bisa melemahkan required field guarantee.

DTO kecil:

```java
public record DepartmentResponse(String code, String name) {}
```

Tidak perlu builder.

---

### 15.4 “Lombok `@Data` Aman untuk Semua DTO”

`@Data` terlalu luas. Ia menghasilkan setter, getter, equals, hashCode, toString, dan constructor tertentu. Untuk DTO public, sensitive, nested, atau dekat persistence, ini sering terlalu permisif.

Lebih baik gunakan annotation spesifik:

```java
@Getter
@AllArgsConstructor
public class UserResponse {
    private final String id;
    private final String name;
}
```

Atau record jika memungkinkan.

---

### 15.5 “DTO Sama dengan Entity karena Field-nya Mirip”

Entity:

```java
@Entity
public class User {
    @Id
    private Long id;
    private String passwordHash;
    private boolean admin;
    private Instant deletedAt;
}
```

DTO:

```java
public record UserResponse(
        String id,
        String displayName
) {}
```

DTO harus dipilih berdasarkan contract, bukan struktur database.

---

## 16. Top 1% Design Principles

### Principle 1 — Shape Follows Boundary

Jangan pilih record/POJO/builder karena style pribadi. Pilih berdasarkan boundary.

```text
HTTP request    -> strict DTO, often record unless patch
HTTP response   -> record works well
event payload   -> immutable, versioned, contract-tested
XML payload     -> POJO may be more pragmatic
JPA entity      -> not DTO, not record by default
command         -> record/value object works well
patch           -> presence-aware model
```

---

### Principle 2 — Immutability is a Contract, Not Decoration

Immutable DTO mengurangi accidental mutation. Tetapi harus dipastikan sampai collection/nested object jika dibutuhkan.

---

### Principle 3 — Constructor is a Boundary

Record canonical constructor adalah titik masuk object. Gunakan untuk structural normalization ringan, bukan business workflow.

---

### Principle 4 — Compatibility Beats Elegance

Jangan mengubah public DTO ke bentuk modern jika output/input contract berubah tanpa sengaja. Golden tests lebih penting daripada estetika.

---

### Principle 5 — Avoid Ambiguous Null Semantics

Null bisa berarti:

- missing,
- explicit null,
- unknown,
- not applicable,
- not loaded,
- intentionally cleared.

DTO strategy harus membuat perbedaannya eksplisit jika penting.

---

### Principle 6 — Generated Convenience Must Be Auditable

Lombok dan MapStruct boleh dipakai, tetapi generated behavior harus bisa diinspeksi, dites, dan dipahami saat production incident.

---

## 17. Practical Architecture Recommendation

Untuk codebase Java modern, rekomendasi realistis:

### 17.1 Default untuk Response DTO

Gunakan record.

```java
public record CaseSummaryResponse(
        String caseId,
        String caseNo,
        String status,
        OffsetDateTime createdAt
) {}
```

---

### 17.2 Default untuk Create/Replace Request DTO

Gunakan record dengan normalization ringan dan Bean Validation.

```java
public record CreateCaseRequest(
        @NotBlank String applicantId,
        @NotBlank String caseType,
        @Size(max = 4000) String description
) {
    public CreateCaseRequest {
        applicantId = trimToNull(applicantId);
        caseType = upperTrimToNull(caseType);
        description = trimToNull(description);
    }

    private static String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String upperTrimToNull(String value) {
        String trimmed = trimToNull(value);
        return trimmed == null ? null : trimmed.toUpperCase(Locale.ROOT);
    }
}
```

---

### 17.3 Default untuk Patch Request DTO

Jangan gunakan plain record field jika absent/null penting. Gunakan:

- `JsonNode` boundary + explicit patch mapper,
- JSON Merge Patch model,
- custom `PatchField<T>`,
- atau command object yang membedakan operation.

---

### 17.4 Default untuk Command Internal

Gunakan record dengan semantic types.

```java
public record CreateCaseCommand(
        ApplicantId applicantId,
        CaseType caseType,
        CaseDescription description,
        UserId submittedBy
) {}
```

---

### 17.5 Default untuk Event Payload

Gunakan immutable DTO/record, tetapi versioning dan golden tests wajib.

```java
public record CaseCreatedEventV1(
        String eventId,
        String caseId,
        String applicantId,
        String caseType,
        OffsetDateTime occurredAt
) {}
```

---

### 17.6 Default untuk XML DTO

Gunakan POJO jika JAXB/Jakarta XML Binding contract lebih stabil dengan JavaBean style.

---

### 17.7 Default untuk Large DTO dengan Banyak Field

Pertimbangkan builder, tetapi jangan membuat builder wajib untuk semua DTO.

---

## 18. Worked Example: Case Management DTO Strategy

### 18.1 External Request

```java
public record SubmitApplicationRequest(
        @NotBlank String applicantId,
        @NotBlank String applicationType,
        @NotBlank String description,
        List<String> documentIds
) {
    public SubmitApplicationRequest {
        applicantId = trimToNull(applicantId);
        applicationType = upperTrimToNull(applicationType);
        description = trimToNull(description);
        documentIds = documentIds == null ? List.of() : List.copyOf(documentIds);
    }

    private static String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String upperTrimToNull(String value) {
        String trimmed = trimToNull(value);
        return trimmed == null ? null : trimmed.toUpperCase(Locale.ROOT);
    }
}
```

This DTO:

- normalizes whitespace,
- canonicalizes type code,
- prevents external mutation of `documentIds`,
- keeps validation annotations near boundary,
- does not access DB or security context.

---

### 18.2 Internal Command

```java
public record SubmitApplicationCommand(
        ApplicantId applicantId,
        ApplicationType applicationType,
        String description,
        List<DocumentId> documentIds,
        UserId submittedBy
) {
    public SubmitApplicationCommand {
        documentIds = documentIds == null ? List.of() : List.copyOf(documentIds);
    }
}
```

Command is richer:

- semantic ID types,
- `submittedBy` from security context,
- ready for application service.

---

### 18.3 Response DTO

```java
public record SubmitApplicationResponse(
        String applicationId,
        String status,
        OffsetDateTime submittedAt
) {}
```

Small response DTO does not need builder.

---

### 18.4 Event DTO

```java
public record ApplicationSubmittedEventV1(
        String eventId,
        String applicationId,
        String applicantId,
        String applicationType,
        OffsetDateTime occurredAt
) {}
```

Event gets version suffix because public/internal asynchronous contracts tend to outlive code structure.

---

### 18.5 Mapping Flow

```text
SubmitApplicationRequest
    ↓ boundary normalization + validation
SubmitApplicationCommand
    ↓ application service/domain
Application aggregate
    ↓ event factory / mapper
ApplicationSubmittedEventV1
    ↓ serializer
message broker payload
```

DTO strategy is not about one class. It is about the whole transformation chain.

---

## 19. Review Checklist

Saat review DTO modern, tanyakan:

1. Boundary apa yang diwakili DTO ini?
2. Apakah DTO ini inbound, outbound, internal command, event, projection, XML, atau patch?
3. Apakah records cocok untuk boundary ini?
4. Apakah object perlu mutable?
5. Apakah framework membutuhkan no-args constructor atau setter?
6. Apakah field collection sudah defensive copy?
7. Apakah null/absent semantics jelas?
8. Apakah DTO kecil sehingga builder tidak perlu?
9. Apakah DTO besar sehingga constructor raw rawan tertukar?
10. Apakah JSON contract sudah diuji?
11. Apakah OpenAPI/schema tetap aligned?
12. Apakah event payload butuh versioning?
13. Apakah Lombok annotation terlalu luas?
14. Apakah generated behavior bisa diinspeksi?
15. Apakah migration dari POJO ke record mengubah serialization shape?

---

## 20. Latihan

### Latihan 1 — Pilih Bentuk DTO

Untuk setiap kasus, pilih POJO, record, Lombok `@Value`, builder, atau model khusus:

1. HTTP response `UserSummaryResponse` dengan 4 field.
2. PATCH request untuk update email/displayName.
3. XML payload dari vendor lama berbasis XSD.
4. Kafka event `PaymentCapturedV1`.
5. Internal command `ApproveCaseCommand`.
6. Test fixture object dengan 20 field optional.
7. DTO Java 8 legacy yang ingin immutable.

Jawaban yang diharapkan:

1. record.
2. model khusus presence-aware / JsonNode patch / merge patch.
3. POJO JavaBean/JAXB-friendly.
4. record immutable + versioned + golden tests.
5. record dengan semantic types.
6. builder.
7. Lombok `@Value` atau manual immutable class.

---

### Latihan 2 — Temukan Bug Immutability

Kode:

```java
public record AssignDocumentsCommand(
        String caseId,
        List<String> documentIds
) {}
```

Apa masalahnya?

Jawaban:

Record hanya membuat reference final. `documentIds` masih bisa mutable jika list eksternal dimodifikasi. Tambahkan defensive copy:

```java
public record AssignDocumentsCommand(
        String caseId,
        List<String> documentIds
) {
    public AssignDocumentsCommand {
        documentIds = documentIds == null ? List.of() : List.copyOf(documentIds);
    }
}
```

---

### Latihan 3 — Evaluasi Migration

Sebuah DTO public response berubah dari Lombok POJO ke record. Apa test minimal sebelum merge?

Minimal:

- serialize golden JSON lama vs baru,
- deserialize jika inbound juga dipakai,
- OpenAPI/schema diff,
- MapStruct mapper compile test,
- null/missing field test jika inbound,
- consumer compatibility review,
- sensitive field exposure check.

---

## 21. Ringkasan

Java modern memberi kita pilihan DTO yang jauh lebih kuat daripada era Java 8 mutable POJO. Tetapi semakin banyak pilihan berarti semakin penting memiliki decision model.

Inti bagian ini:

- Records sangat cocok untuk banyak DTO modern, command carrier, event payload, dan projection.
- Records memberikan shallow immutability, bukan deep immutability.
- Builder berguna untuk DTO besar, tetapi bukan pengganti required-field correctness.
- Lombok tetap relevan untuk Java 8/11 dan builder-heavy codebase, tetapi harus dipakai dengan policy.
- Mutable POJO masih valid untuk legacy/framework/XML use case.
- Patch request membutuhkan presence-aware strategy; plain record field sering tidak cukup.
- Compatibility harus dijaga dengan golden payload tests sebelum refactor DTO shape.
- Top engineer memilih DTO shape berdasarkan boundary, bukan tren.

---

## 22. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

# Part 27 — Mapping Validation Boundary: Bean Validation, Invariants, and Normalization

Kita akan masuk ke pertanyaan penting:

> Apa bedanya deserialization, normalization, validation, mapping, dan domain invariant?

Ini penting karena banyak sistem enterprise mencampur semuanya di DTO, mapper, controller, atau entity. Hasilnya biasanya error handling buruk, kontrak tidak jelas, dan bug regulatory/audit sulit dilacak.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 25 — Lombok with Jackson and MapStruct: Builders, Records, Immutability](./25-lombok-with-jackson-mapstruct-builders-records-immutability.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 27 — Mapping Validation Boundary: Bean Validation, Invariants, and Normalization](./27-mapping-validation-boundary-bean-validation-invariants-normalization.md)
