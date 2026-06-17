# Part 4 — Manual Mapping: The Baseline Every Senior Engineer Must Master

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `04-manual-mapping-baseline-every-senior-engineer-must-master.md`  
> Target: Java 8 sampai Java 25  
> Posisi: fondasi eksplisit sebelum framework mapping seperti Jackson, MapStruct, Lombok, records, dan code generation.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **manual mapping** sebagai baseline kemampuan wajib untuk engineer senior.

Manual mapping sering dianggap “boilerplate”, padahal sebenarnya ia adalah bentuk paling jujur dari transformasi data. Saat kita menulis mapper manual, semua keputusan terlihat:

- field mana yang dipindahkan;
- field mana yang diabaikan;
- nilai mana yang dikonversi;
- nilai mana yang dinormalisasi;
- object mana yang boleh bocor antar layer;
- kapan null diterima;
- kapan missing value dianggap error;
- kapan default value boleh diberikan;
- kapan mapping harus gagal;
- kapan mapping harus preserve raw input untuk audit;
- kapan mapping hanya copy, dan kapan mapping sudah menjadi policy.

Framework seperti MapStruct dan Jackson dapat mempercepat pekerjaan, tetapi engineer yang tidak paham manual mapping biasanya akan memakai framework sebagai “magic copier”. Ini berbahaya, terutama pada sistem enterprise, regulatory, case management, audit trail, enforcement lifecycle, authentication/authorization, financial workflow, dan integrasi antar sistem.

**Prinsip utama bagian ini:**

> Sebelum automation, kuasai bentuk eksplisitnya.  
> Jika manual mapping-nya tidak bisa kamu jelaskan, generated mapping-nya juga tidak bisa kamu percaya.

---

## 1. Mental Model: Mapping Adalah Translation, Bukan Assignment

Pemula melihat mapping seperti ini:

```java
response.setName(entity.getName());
response.setEmail(entity.getEmail());
response.setStatus(entity.getStatus());
```

Senior engineer melihat mapping seperti ini:

```text
Source model membawa data dari satu boundary.
Target model mewakili kontrak boundary lain.
Mapper adalah translator yang mengubah bentuk, makna, izin akses, default, format, dan visibility.
```

Perbedaannya besar.

Assignment hanya menjawab:

```text
Bagaimana cara memindahkan nilai?
```

Translation menjawab:

```text
Apakah nilai ini punya makna yang sama di target?
Apakah aman diekspos?
Apakah perlu dinormalisasi?
Apakah target menerima null?
Apakah target butuh format berbeda?
Apakah field ini backwards-compatible?
Apakah field ini legal untuk diisi user?
Apakah field ini derived dari domain state?
Apakah perubahan mapping ini breaking change?
```

Manual mapper yang baik bukan hanya “menulis setter”. Ia mendokumentasikan keputusan boundary.

---

## 2. Kenapa Manual Mapping Tetap Penting Walaupun Ada MapStruct/Jackson

### 2.1 Manual Mapping Adalah Reference Implementation

Dalam tim yang mature, manual mapping sering menjadi bentuk pertama dari desain.

Sebelum mengotomasi, kita perlu tahu:

- source object apa;
- target object apa;
- field mana direct copy;
- field mana conversion;
- field mana enrichment;
- field mana redaction;
- field mana projection;
- field mana tidak boleh dimapping;
- rule null/default;
- rule error.

Setelah desain jelas, barulah sebagian bisa dipindahkan ke MapStruct atau serializer configuration.

### 2.2 Manual Mapping Membuat Intent Terlihat

Bandingkan dua pendekatan ini.

#### Reflection copier

```java
BeanUtils.copyProperties(request, entity);
```

Kelihatannya singkat, tetapi intent-nya gelap.

Pertanyaan yang tidak terlihat:

- apakah `id` ikut tercopy?
- apakah `createdBy` ikut tertimpa?
- apakah `status` boleh diubah dari request?
- apakah `role` dari user input bisa masuk ke entity?
- apakah nested object dicopy shallow atau deep?
- apakah null akan overwrite value existing?
- apakah field baru otomatis ikut tercopy tanpa review?

#### Manual mapper

```java
public User updateProfile(User existing, UpdateProfileRequest request) {
    existing.setDisplayName(normalizeDisplayName(request.getDisplayName()));
    existing.setPhoneNumber(normalizePhoneNumber(request.getPhoneNumber()));
    existing.setUpdatedAt(clock.instant());
    return existing;
}
```

Intent-nya jelas:

- hanya `displayName` dan `phoneNumber` boleh diubah;
- tidak ada `id`, `role`, `status`, `createdAt`, `createdBy` dari request;
- update timestamp dikontrol server;
- ada normalization;
- ini update profile, bukan overwrite user entity.

### 2.3 Manual Mapping Adalah Safety Net Terhadap Framework Misuse

Framework mapping kuat, tetapi tidak bisa menyelamatkan desain yang salah.

Contoh:

```java
@Mapper
interface UserMapper {
    User toEntity(UserRequest request);
}
```

Jika `UserRequest` berisi field `role`, `enabled`, atau `verified`, MapStruct dapat saja memapping field itu jika namanya cocok. Dari sisi generator, itu benar. Dari sisi security, itu fatal.

Manual mapper mengajarkan satu prinsip:

> Mapping harus berangkat dari use case, bukan dari kemiripan nama field.

---

## 3. Kapan Manual Mapping Lebih Baik daripada Framework

Manual mapping bukan berarti anti-framework. Pilih manual mapping ketika decision density tinggi.

### 3.1 Gunakan Manual Mapping Jika Ada Security Boundary

Contoh:

- user registration;
- role assignment;
- permission update;
- account activation;
- administrative action;
- approval/rejection workflow;
- enforcement decision;
- payment status update;
- regulatory case outcome;
- audit trail output;
- public API response.

Pada boundary seperti ini, setiap field harus disengaja.

Buruk:

```java
BeanUtils.copyProperties(request, user);
```

Lebih aman:

```java
public User register(RegisterUserRequest request) {
    return new User(
        UserId.newId(),
        normalizeEmail(request.email()),
        PasswordHash.fromRaw(request.password()),
        UserStatus.PENDING_VERIFICATION,
        Role.USER,
        clock.instant()
    );
}
```

Yang penting bukan panjang kodenya, tetapi ownership-nya.

### 3.2 Gunakan Manual Mapping Jika Ada Semantic Transformation

Contoh:

```text
External status: "A", "I", "S"
Internal status: ACTIVE, INACTIVE, SUSPENDED
API status: "active", "inactive", "suspended"
UI label: "Active", "Inactive", "Suspended"
```

Ini bukan copy. Ini translation.

```java
public AccountStatus mapExternalStatus(String source) {
    if (source == null) {
        throw new MappingException("External account status is required");
    }

    switch (source.trim().toUpperCase(Locale.ROOT)) {
        case "A": return AccountStatus.ACTIVE;
        case "I": return AccountStatus.INACTIVE;
        case "S": return AccountStatus.SUSPENDED;
        default:
            throw new MappingException("Unsupported external account status: " + source);
    }
}
```

Manual mapping membuat rule terlihat dan testable.

### 3.3 Gunakan Manual Mapping Jika Ada Audit/Compliance Requirement

Contoh regulatory/case system:

```text
Incoming payload harus disimpan raw untuk audit.
Normalized value dipakai untuk processing.
Rejected value harus bisa dijelaskan.
```

Manual mapper dapat preserve keduanya:

```java
public CaseApplicant mapApplicant(ApplicantRequest request) {
    String rawIdNumber = request.idNumber();
    String normalizedIdNumber = normalizeIdNumber(rawIdNumber);

    return new CaseApplicant(
        normalizedIdNumber,
        rawIdNumber,
        normalizeName(request.name()),
        request.dateOfBirth()
    );
}
```

Jika raw value hilang saat mapping, auditability turun.

### 3.4 Gunakan Manual Mapping Jika Partial Update Semantics Kompleks

PATCH bukan PUT.

Null bisa berarti:

1. client tidak mengirim field;
2. client mengirim field dengan nilai null untuk clear value;
3. deserializer memberi null karena missing;
4. field tidak valid;
5. field tidak applicable.

Manual mapping dapat membedakan ini jika request model mendukung presence.

```java
public void applyPatch(UserProfile profile, UserProfilePatch patch) {
    if (patch.displayName().isPresent()) {
        profile.setDisplayName(normalizeDisplayName(patch.displayName().get()));
    }

    if (patch.phoneNumber().isPresent()) {
        String value = patch.phoneNumber().get();
        profile.setPhoneNumber(value == null ? null : normalizePhoneNumber(value));
    }
}
```

Catatan: `Optional` sebagai field DTO masih kontroversial dan akan dibahas lebih dalam pada part berikutnya. Yang penting di sini adalah konsep **presence tracking**.

### 3.5 Gunakan Manual Mapping Jika Error Message Harus Presisi

Untuk public API dan regulatory integration, error mapping harus jelas.

Buruk:

```text
Could not deserialize object.
```

Lebih baik:

```text
Field 'applicant.dateOfBirth' must be ISO-8601 date, got '31/13/2024'.
```

Manual mapping memungkinkan field-path-aware error.

```java
private LocalDate parseDate(String value, String fieldPath) {
    try {
        return LocalDate.parse(value);
    } catch (DateTimeParseException ex) {
        throw new MappingException(fieldPath, "must be ISO-8601 date", ex);
    }
}
```

---

## 4. Bentuk-Bentuk Manual Mapper

Manual mapping tidak hanya satu bentuk. Ada beberapa pola, masing-masing punya trade-off.

---

## 5. Pattern 1: Constructor Mapping

Constructor mapping cocok untuk target immutable.

### 5.1 Contoh Dasar

```java
public final class UserResponse {
    private final String id;
    private final String displayName;
    private final String email;
    private final String status;

    public UserResponse(String id, String displayName, String email, String status) {
        this.id = id;
        this.displayName = displayName;
        this.email = email;
        this.status = status;
    }

    public String getId() { return id; }
    public String getDisplayName() { return displayName; }
    public String getEmail() { return email; }
    public String getStatus() { return status; }
}
```

Mapper:

```java
public final class UserResponseMapper {

    public UserResponse toResponse(User user) {
        if (user == null) {
            return null;
        }

        return new UserResponse(
            user.getId().toString(),
            user.getDisplayName(),
            maskEmailIfNeeded(user.getEmail()),
            mapStatus(user.getStatus())
        );
    }

    private String mapStatus(UserStatus status) {
        switch (status) {
            case ACTIVE: return "active";
            case SUSPENDED: return "suspended";
            case PENDING_VERIFICATION: return "pending_verification";
            default: throw new IllegalArgumentException("Unsupported status: " + status);
        }
    }

    private String maskEmailIfNeeded(String email) {
        return email;
    }
}
```

### 5.2 Kelebihan Constructor Mapping

- target immutable;
- semua required field terlihat;
- object tidak sempat berada dalam half-initialized state;
- cocok untuk response DTO;
- cocok untuk command object;
- cocok untuk event payload;
- mudah dites;
- minim side effect.

### 5.3 Kekurangan Constructor Mapping

- constructor panjang bisa sulit dibaca;
- field order rawan tertukar jika type sama;
- perubahan field menyebabkan banyak compile error;
- untuk object besar, builder bisa lebih jelas.

Contoh risiko:

```java
new UserResponse(user.getId(), user.getEmail(), user.getDisplayName(), user.getStatus());
```

Jika `email` dan `displayName` sama-sama `String`, compiler tidak tahu urutan salah.

### 5.4 Mitigasi Constructor Panjang

Gunakan value object, record, builder, atau grouping.

Buruk:

```java
new CaseResponse(id, refNo, applicantName, applicantEmail, applicantPhone,
    officerName, officerEmail, status, stage, createdAt, updatedAt, submittedAt);
```

Lebih baik:

```java
new CaseResponse(
    caseSummary,
    applicantSummary,
    officerSummary,
    timelineSummary
);
```

Object shape harus mengikuti konsep, bukan sekadar daftar field.

---

## 6. Pattern 2: Static Factory Mapping

Static factory cocok ketika mapping melekat kuat pada target DTO.

```java
public final class UserResponse {
    private final String id;
    private final String name;
    private final String status;

    private UserResponse(String id, String name, String status) {
        this.id = id;
        this.name = name;
        this.status = status;
    }

    public static UserResponse from(User user) {
        if (user == null) {
            return null;
        }
        return new UserResponse(
            user.getId().toString(),
            user.getDisplayName(),
            user.getStatus().name().toLowerCase(Locale.ROOT)
        );
    }
}
```

### 6.1 Kapan Cocok

- DTO sederhana;
- mapping tidak butuh dependency eksternal;
- mapping hanya satu arah;
- source-target relation sangat dekat;
- logic mapping kecil.

### 6.2 Kapan Tidak Cocok

Jangan letakkan mapping di DTO jika butuh:

- repository lookup;
- service dependency;
- permission/user context;
- localization;
- complex redaction;
- banyak source object;
- banyak variasi response;
- dependency ke domain internal yang ingin dihindari.

Masalah:

```java
public static UserResponse from(User user, PermissionService permissionService) {
    ...
}
```

DTO mulai tahu service. Itu tanda mapping harus keluar ke mapper/assembler.

---

## 7. Pattern 3: Dedicated Mapper Class

Dedicated mapper adalah pola yang paling fleksibel dan paling mudah dikembangkan ke MapStruct.

```java
public final class UserMapper {

    public UserResponse toResponse(User user) {
        if (user == null) {
            return null;
        }

        return new UserResponse(
            user.getId().toString(),
            user.getDisplayName(),
            user.getEmail(),
            toApiStatus(user.getStatus())
        );
    }

    public UserCommand toCommand(CreateUserRequest request) {
        requireNonNull(request, "request");

        return new UserCommand(
            normalizeEmail(request.email()),
            normalizeDisplayName(request.displayName())
        );
    }

    private String toApiStatus(UserStatus status) {
        switch (status) {
            case ACTIVE: return "active";
            case SUSPENDED: return "suspended";
            case PENDING_VERIFICATION: return "pending_verification";
            default: throw new MappingException("Unsupported user status: " + status);
        }
    }
}
```

### 7.1 Kelebihan Dedicated Mapper

- mapping policy terkumpul;
- mudah dites;
- bisa dipecah per boundary;
- bisa menggunakan dependency injection;
- bisa menjadi basis MapStruct;
- bisa menampung helper private;
- lebih mudah direview.

### 7.2 Risiko Dedicated Mapper

Mapper bisa menjadi terlalu besar.

Tanda mapper mulai busuk:

- ratusan/ribuan baris;
- banyak `if` berdasarkan use case;
- memanggil banyak service;
- melakukan authorization;
- melakukan database query besar;
- menghitung workflow decision;
- mengubah state domain terlalu banyak;
- mengandung logic bisnis utama.

Mapper harus menerjemahkan data. Ia boleh punya policy mapping, tetapi jangan menjadi domain service tersembunyi.

---

## 8. Pattern 4: Assembler

Assembler biasanya dipakai saat membangun response dari beberapa source.

Contoh:

```text
Case entity
+ Applicant entity
+ Officer entity
+ Permission context
+ SLA summary
+ Document count
= CaseDetailResponse
```

```java
public final class CaseDetailAssembler {
    private final CaseMapper caseMapper;
    private final ApplicantMapper applicantMapper;
    private final DocumentSummaryMapper documentSummaryMapper;

    public CaseDetailAssembler(
        CaseMapper caseMapper,
        ApplicantMapper applicantMapper,
        DocumentSummaryMapper documentSummaryMapper
    ) {
        this.caseMapper = caseMapper;
        this.applicantMapper = applicantMapper;
        this.documentSummaryMapper = documentSummaryMapper;
    }

    public CaseDetailResponse assemble(
        CaseRecord caseRecord,
        Applicant applicant,
        List<Document> documents,
        ViewerContext viewer
    ) {
        return new CaseDetailResponse(
            caseMapper.toSummary(caseRecord),
            applicantMapper.toResponse(applicant, viewer),
            documentSummaryMapper.toSummary(documents)
        );
    }
}
```

### 8.1 Mapper vs Assembler

```text
Mapper:
  satu source atau source kecil -> target

Assembler:
  beberapa source/result/context -> response aggregate
```

Assembler lebih dekat ke application layer.

### 8.2 Kapan Assembler Cocok

- detail page response;
- dashboard response;
- regulatory case summary;
- workflow timeline response;
- integration payload dari banyak aggregate;
- API yang butuh permission-aware redaction;
- response dengan computed/derived sections.

### 8.3 Jangan Membuat Assembler Menjadi Query Service

Buruk:

```java
public CaseDetailResponse assemble(String caseId) {
    CaseRecord c = caseRepository.findById(caseId);
    Applicant a = applicantRepository.findByCaseId(caseId);
    List<Document> d = documentRepository.findByCaseId(caseId);
    ...
}
```

Ini bukan assembler lagi. Ini query/application service.

Lebih baik:

```java
public CaseDetailResponse getCaseDetail(String caseId, ViewerContext viewer) {
    CaseRecord c = caseRepository.get(caseId);
    Applicant a = applicantRepository.getByCaseId(caseId);
    List<Document> d = documentRepository.listByCaseId(caseId);

    return caseDetailAssembler.assemble(c, a, d, viewer);
}
```

Assembler menerima data yang sudah disiapkan.

---

## 9. Pattern 5: Translator / Anti-Corruption Mapper

Untuk integrasi eksternal, istilah “mapper” sering kurang kuat. Yang dibutuhkan adalah translator.

Contoh external API:

```json
{
  "USR_ID": "123",
  "STAT": "A",
  "DOB": "19890131",
  "ADDR1": "...",
  "ADDR2": "..."
}
```

Internal model:

```java
public final class PersonProfile {
    private final ExternalPersonId externalId;
    private final PersonStatus status;
    private final LocalDate dateOfBirth;
    private final Address address;
}
```

Translator:

```java
public final class LegacyPersonTranslator {

    public PersonProfile toDomain(LegacyPersonPayload payload) {
        requireNonNull(payload, "payload");

        return new PersonProfile(
            new ExternalPersonId(required(payload.getUsrId(), "USR_ID")),
            toStatus(required(payload.getStat(), "STAT")),
            parseLegacyDate(required(payload.getDob(), "DOB"), "DOB"),
            toAddress(payload)
        );
    }

    private PersonStatus toStatus(String stat) {
        switch (stat.trim().toUpperCase(Locale.ROOT)) {
            case "A": return PersonStatus.ACTIVE;
            case "I": return PersonStatus.INACTIVE;
            case "D": return PersonStatus.DECEASED;
            default: throw new MappingException("Unsupported STAT: " + stat);
        }
    }

    private LocalDate parseLegacyDate(String value, String field) {
        try {
            DateTimeFormatter formatter = DateTimeFormatter.BASIC_ISO_DATE;
            return LocalDate.parse(value, formatter);
        } catch (DateTimeParseException ex) {
            throw new MappingException(field + " must use yyyyMMdd format", ex);
        }
    }

    private Address toAddress(LegacyPersonPayload payload) {
        return new Address(
            payload.getAddr1(),
            payload.getAddr2(),
            payload.getPostalCode()
        );
    }
}
```

### 9.1 Anti-Corruption Principle

Jangan biarkan bentuk legacy menyebar ke domain.

Buruk:

```java
if (person.getStat().equals("A")) { ... }
```

Jika kode ini muncul di banyak tempat, external system sudah mencemari domain.

Lebih baik:

```java
if (personProfile.status() == PersonStatus.ACTIVE) { ... }
```

Translator menjadi satu-satunya tempat yang tahu `STAT = "A"`.

---

## 10. Null Strategy dalam Manual Mapping

Null adalah sumber bug mapping yang sangat besar.

Ada beberapa makna null:

```text
1. value memang tidak ada
2. value belum diketahui
3. value tidak applicable
4. value sengaja dikosongkan
5. source field missing
6. deserializer gagal membedakan missing vs null
7. default belum dihitung
8. user tidak berwenang melihat value
9. value disembunyikan/redacted
10. data rusak
```

Mapper harus memilih strategy.

---

## 11. Null Strategy 1: Null In, Null Out

```java
public UserResponse toResponse(User user) {
    if (user == null) {
        return null;
    }
    ...
}
```

Cocok untuk mapper umum ketika null source berarti tidak ada object.

Kelebihan:

- sederhana;
- cocok untuk nested optional object;
- menghindari NPE.

Kekurangan:

- bisa menyembunyikan bug;
- caller mungkin tidak sadar source seharusnya required;
- error muncul jauh setelah mapping.

Gunakan untuk nested optional object, bukan required boundary input.

---

## 12. Null Strategy 2: Fail Fast

```java
public UserCommand toCommand(CreateUserRequest request) {
    if (request == null) {
        throw new IllegalArgumentException("request must not be null");
    }
    ...
}
```

Cocok untuk:

- request utama;
- command utama;
- event wajib;
- integration payload wajib;
- persistence entity yang harus ada.

Prinsip:

> Null pada root object biasanya bug.  
> Null pada nested optional object bisa jadi data sah.

---

## 13. Null Strategy 3: Defaulting

Defaulting harus hati-hati.

```java
String displayName = request.displayName() == null
    ? "Unknown"
    : request.displayName().trim();
```

Pertanyaan penting:

- apakah default ini business rule?
- apakah default ini hanya UI convenience?
- apakah default harus terlihat di audit?
- apakah default boleh menggantikan missing value?
- apakah default bisa membuat data salah tampak valid?

Contoh bahaya:

```java
boolean active = request.active() == null ? true : request.active();
```

Jika client lupa mengirim `active`, user otomatis active. Ini bisa menjadi bug security.

Defaulting sebaiknya explicit:

```java
UserStatus initialStatus = UserStatus.PENDING_VERIFICATION;
```

Bukan dari request.

---

## 14. Null Strategy 4: Preserve Unknown

Kadang null tidak cukup. Kita perlu membedakan unknown, absent, not applicable, dan redacted.

Contoh:

```java
public enum ValueState {
    PRESENT,
    ABSENT,
    UNKNOWN,
    NOT_APPLICABLE,
    REDACTED
}
```

Untuk sistem regulatory, ini penting karena:

- data yang tidak dikirim berbeda dari data yang disembunyikan;
- data yang tidak applicable berbeda dari data yang belum diketahui;
- audit explanation membutuhkan state.

Contoh response:

```java
public final class FieldValue<T> {
    private final T value;
    private final ValueState state;

    private FieldValue(T value, ValueState state) {
        this.value = value;
        this.state = state;
    }

    public static <T> FieldValue<T> present(T value) {
        return new FieldValue<>(value, ValueState.PRESENT);
    }

    public static <T> FieldValue<T> redacted() {
        return new FieldValue<>(null, ValueState.REDACTED);
    }
}
```

Jangan terlalu cepat menyederhanakan semua menjadi null.

---

## 15. Defensive Copy dalam Mapping

Mapping sering memindahkan collection, array, map, byte array, dan mutable object.

Jika tidak hati-hati, target object bisa berbagi mutable reference dengan source.

### 15.1 Contoh Bug

```java
public UserResponse toResponse(User user) {
    return new UserResponse(user.getRoles());
}
```

Jika `getRoles()` mengembalikan mutable list internal, response memegang reference yang sama.

Akibat:

- response bisa berubah jika entity berubah;
- caller bisa mengubah internal state jika getter tidak defensive;
- serialization bisa melihat state tidak konsisten;
- thread safety terganggu.

### 15.2 Defensive Copy Java 8

```java
List<String> roles = user.getRoles() == null
    ? Collections.emptyList()
    : Collections.unmodifiableList(new ArrayList<>(user.getRoles()));
```

### 15.3 Defensive Copy Java 10+

```java
List<String> roles = user.getRoles() == null
    ? List.of()
    : List.copyOf(user.getRoles());
```

### 15.4 Perhatian pada `List.copyOf`

`List.copyOf` menolak null element.

Jika source list bisa berisi null, mapper harus memutuskan:

- reject;
- filter;
- preserve;
- convert null ke placeholder.

Untuk API response, lebih baik reject atau normalize secara eksplisit daripada diam-diam menyebarkan null.

```java
private List<String> copyRoles(List<String> roles) {
    if (roles == null) {
        return List.of();
    }

    List<String> result = new ArrayList<>(roles.size());
    for (String role : roles) {
        if (role == null) {
            throw new MappingException("roles must not contain null element");
        }
        result.add(role);
    }
    return List.copyOf(result);
}
```

---

## 16. Nested Mapping

Nested object mapping membutuhkan keputusan: apakah nested object dipertahankan, diflatten, diringkas, atau dihilangkan.

Domain:

```java
public final class CaseRecord {
    private final CaseId id;
    private final CaseReference reference;
    private final Applicant applicant;
    private final CaseStatus status;
    private final Officer assignedOfficer;
}
```

Response summary:

```java
public final class CaseSummaryResponse {
    private final String id;
    private final String referenceNo;
    private final String applicantName;
    private final String status;
}
```

Mapper:

```java
public CaseSummaryResponse toSummary(CaseRecord c) {
    requireNonNull(c, "caseRecord");

    return new CaseSummaryResponse(
        c.getId().value(),
        c.getReference().value(),
        c.getApplicant() == null ? null : c.getApplicant().getDisplayName(),
        toApiStatus(c.getStatus())
    );
}
```

### 16.1 Pertanyaan untuk Nested Mapping

Untuk setiap nested object, tanya:

```text
Apakah target butuh object penuh?
Apakah target hanya butuh identifier?
Apakah target hanya butuh label?
Apakah target butuh summary?
Apakah target boleh melihat data nested itu?
Apakah nested object lazy-loaded?
Apakah mapping akan trigger DB query?
Apakah nested object bisa cycle?
```

### 16.2 Hindari Blind Deep Mapping

Buruk:

```java
CaseResponse response = mapper.deepMap(caseEntity);
```

Jika entity punya relasi:

```text
Case -> Applicant -> Cases -> Applicant -> Cases -> ...
```

Blind deep mapping bisa menyebabkan:

- infinite recursion;
- payload terlalu besar;
- N+1 query;
- data leakage;
- stack overflow;
- latency tinggi.

Manual mapping mengajarkan untuk memilih shape.

---

## 17. Collection Mapping

Collection mapping terlihat sederhana, tetapi banyak detail.

### 17.1 Basic Collection Mapping Java 8

```java
public List<UserResponse> toResponses(List<User> users) {
    if (users == null) {
        return Collections.emptyList();
    }

    List<UserResponse> result = new ArrayList<>(users.size());
    for (User user : users) {
        result.add(toResponse(user));
    }
    return Collections.unmodifiableList(result);
}
```

### 17.2 Stream Mapping

```java
public List<UserResponse> toResponses(List<User> users) {
    if (users == null) {
        return Collections.emptyList();
    }

    return users.stream()
        .map(this::toResponse)
        .collect(Collectors.toList());
}
```

Di Java 16+:

```java
return users.stream()
    .map(this::toResponse)
    .toList();
```

### 17.3 Loop vs Stream

Loop sering lebih baik jika:

- perlu field path error detail;
- perlu index-aware diagnostics;
- perlu skip/reject policy;
- perlu pre-size collection;
- hot path performance;
- mapping punya checked exception wrapper;
- debugging penting.

Contoh index-aware error:

```java
public List<ItemCommand> toItemCommands(List<ItemRequest> requests) {
    if (requests == null) {
        return Collections.emptyList();
    }

    List<ItemCommand> result = new ArrayList<>(requests.size());
    for (int i = 0; i < requests.size(); i++) {
        try {
            result.add(toItemCommand(requests.get(i)));
        } catch (MappingException ex) {
            throw ex.withPathPrefix("items[" + i + "]");
        }
    }
    return result;
}
```

### 17.4 Null Element Strategy

Jika list berisi null, apa yang dilakukan?

Opsi:

```text
1. preserve null
2. filter null
3. reject null
4. convert null ke empty object
```

Untuk request API, biasanya reject.

```java
if (item == null) {
    throw new MappingException("items[" + i + "] must not be null");
}
```

Untuk response internal tertentu, preserve bisa masuk akal, tetapi harus sadar kontraknya.

---

## 18. Enum Mapping

Enum mapping adalah area kecil yang sering menyebabkan breaking change.

### 18.1 Jangan Mengekspos `enum.name()` Sembarangan

Buruk:

```java
return status.name();
```

Jika internal enum berubah dari `PENDING_VERIFICATION` menjadi `PENDING`, API ikut berubah. Itu breaking change.

Lebih baik:

```java
public String toApiStatus(UserStatus status) {
    switch (status) {
        case ACTIVE: return "active";
        case SUSPENDED: return "suspended";
        case PENDING_VERIFICATION: return "pending_verification";
        default: throw new MappingException("Unsupported status: " + status);
    }
}
```

### 18.2 Jangan Gunakan `Enum.valueOf` untuk External Input Tanpa Guard

Buruk:

```java
UserStatus status = UserStatus.valueOf(input);
```

Masalah:

- case-sensitive;
- error message tidak ramah;
- external value terikat internal enum name;
- rename enum menjadi breaking change;
- tidak bisa handle alias/deprecated value.

Lebih baik:

```java
public UserStatus fromApiStatus(String input) {
    if (input == null) {
        throw new MappingException("status is required");
    }

    switch (input.trim().toLowerCase(Locale.ROOT)) {
        case "active": return UserStatus.ACTIVE;
        case "suspended": return UserStatus.SUSPENDED;
        case "pending_verification":
        case "pending":
            return UserStatus.PENDING_VERIFICATION;
        default:
            throw new MappingException("Unsupported status: " + input);
    }
}
```

### 18.3 Exhaustive Switch sebagai Safety

Pada Java modern, switch expression membantu memastikan mapping eksplisit.

```java
public String toApiStatus(UserStatus status) {
    return switch (status) {
        case ACTIVE -> "active";
        case SUSPENDED -> "suspended";
        case PENDING_VERIFICATION -> "pending_verification";
    };
}
```

Jika enum bertambah dan tidak ada default, compiler dapat membantu menemukan mapping yang belum diperbarui.

Untuk Java 8, gunakan switch statement dan test coverage.

---

## 19. Date/Time Mapping

Date/time mapping harus eksplisit. Jangan mengandalkan timezone default JVM.

### 19.1 Masalah Umum

```text
LocalDate vs Instant vs OffsetDateTime vs ZonedDateTime
server timezone vs user timezone
API format vs DB format
business date vs timestamp
inclusive vs exclusive boundary
```

### 19.2 Business Date

Tanggal lahir, tanggal berlaku, tanggal dokumen biasanya `LocalDate`.

```java
public String toApiDate(LocalDate date) {
    return date == null ? null : date.toString(); // ISO-8601 yyyy-MM-dd
}
```

### 19.3 Audit Timestamp

Audit timestamp sebaiknya `Instant`.

```java
public String toApiTimestamp(Instant instant) {
    return instant == null ? null : instant.toString(); // ISO-8601 UTC
}
```

### 19.4 User Display Time

Jika target API butuh waktu sesuai timezone user:

```java
public String toUserTime(Instant instant, ZoneId userZone) {
    if (instant == null) {
        return null;
    }
    return instant.atZone(userZone).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
}
```

### 19.5 Jangan Ini

```java
new Date().toString()
```

atau:

```java
LocalDateTime.now()
```

untuk audit/integration timestamp. `LocalDateTime` tidak punya timezone/offset. Untuk event dan audit, gunakan `Instant` kecuali ada alasan kuat.

---

## 20. Money/Decimal Mapping

Money tidak boleh diperlakukan seperti `double`.

Buruk:

```java
double amount = request.getAmount();
```

Lebih aman:

```java
BigDecimal amount = request.amount();
```

Namun `BigDecimal` juga perlu policy.

### 20.1 Scale dan Rounding

```java
public BigDecimal normalizeAmount(BigDecimal amount) {
    if (amount == null) {
        throw new MappingException("amount is required");
    }
    if (amount.scale() > 2) {
        throw new MappingException("amount must have at most 2 decimal places");
    }
    if (amount.signum() < 0) {
        throw new MappingException("amount must not be negative");
    }
    return amount.setScale(2, RoundingMode.UNNECESSARY);
}
```

### 20.2 Money Value Object

Lebih baik lagi:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        if (amount == null) throw new IllegalArgumentException("amount required");
        if (currency == null) throw new IllegalArgumentException("currency required");
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("invalid currency scale");
        }
        this.amount = amount;
        this.currency = currency;
    }
}
```

Mapper menjadi tempat membuat value object dari primitive external representation.

---

## 21. Identifier Mapping

ID tampak sederhana, tetapi punya banyak risiko.

### 21.1 Jangan Campur Internal ID dan External ID

```java
public final class UserId {
    private final UUID value;
}

public final class ExternalCustomerId {
    private final String value;
}
```

Mapper harus menjaga boundary.

Buruk:

```java
new UserId(UUID.fromString(payload.getCustomerId()))
```

Jika `customerId` berasal dari external system, jangan langsung dianggap internal user ID.

### 21.2 Public ID vs Database ID

Jangan selalu expose database primary key.

```java
public UserResponse toResponse(User user) {
    return new UserResponse(
        user.getPublicId().value(),
        user.getDisplayName()
    );
}
```

Manual mapper membuat pilihan ini eksplisit.

---

## 22. Redaction dan Masking dalam Manual Mapping

Mapping response sering harus mempertimbangkan viewer.

```java
public UserResponse toResponse(User user, ViewerContext viewer) {
    return new UserResponse(
        user.getPublicId().value(),
        user.getDisplayName(),
        viewer.canViewEmail(user) ? user.getEmail() : null,
        viewer.canViewPhone(user) ? maskPhone(user.getPhoneNumber()) : null
    );
}
```

### 22.1 Null Redaction Bisa Ambigu

Jika field redacted dikembalikan sebagai null, client tidak tahu apakah:

- data tidak ada;
- data disembunyikan;
- data belum diisi.

Untuk contract yang butuh clarity:

```java
public final class SensitiveFieldResponse {
    private final String value;
    private final boolean redacted;
}
```

atau:

```json
{
  "email": {
    "value": null,
    "state": "redacted"
  }
}
```

Jangan sembunyikan semantic di null jika domain butuh kejelasan.

---

## 23. Update Mapping: Create vs Replace vs Patch

Ini salah satu area paling penting.

### 23.1 Create Mapping

Create mapping membuat object baru dari request/command.

```java
public CreateUserCommand toCommand(CreateUserRequest request) {
    requireNonNull(request, "request");

    return new CreateUserCommand(
        normalizeEmail(request.email()),
        normalizeDisplayName(request.displayName()),
        request.rawPassword()
    );
}
```

Pada create, server biasanya menentukan:

- ID;
- status awal;
- createdAt;
- createdBy;
- version;
- approval state;
- security role default.

Jangan ambil dari request kecuali memang contract-nya memperbolehkan.

### 23.2 Replace/PUT Mapping

PUT biasanya berarti target representation diganti secara penuh.

```java
public void replaceProfile(UserProfile profile, ReplaceProfileRequest request) {
    requireNonNull(profile, "profile");
    requireNonNull(request, "request");

    profile.setDisplayName(normalizeDisplayName(request.displayName()));
    profile.setPhoneNumber(normalizePhoneNumber(request.phoneNumber()));
    profile.setAddress(toAddress(request.address()));
}
```

Jika request tidak membawa field, itu error atau field menjadi null sesuai contract.

### 23.3 Patch Mapping

PATCH hanya mengubah field yang hadir.

```java
public void patchProfile(UserProfile profile, PatchProfileRequest request) {
    requireNonNull(profile, "profile");
    requireNonNull(request, "request");

    if (request.hasDisplayName()) {
        profile.setDisplayName(normalizeDisplayName(request.displayName()));
    }

    if (request.hasPhoneNumber()) {
        profile.setPhoneNumber(
            request.phoneNumber() == null ? null : normalizePhoneNumber(request.phoneNumber())
        );
    }
}
```

### 23.4 Anti-Pattern: CopyProperties untuk Update Entity

Sangat berbahaya:

```java
BeanUtils.copyProperties(request, entity);
```

Risiko:

- id tertimpa;
- status tertimpa;
- audit fields tertimpa;
- null overwrite existing value;
- role/permission berubah;
- relationship rusak;
- optimistic lock version berubah;
- field baru otomatis ikut termapping tanpa review;
- security review terlewati.

Untuk update, mapping harus use-case-specific.

---

## 24. Error Handling dalam Manual Mapping

Mapper harus menghasilkan error yang bisa dipahami.

### 24.1 MappingException

```java
public final class MappingException extends RuntimeException {
    private final String fieldPath;

    public MappingException(String message) {
        super(message);
        this.fieldPath = null;
    }

    public MappingException(String fieldPath, String message) {
        super(fieldPath + ": " + message);
        this.fieldPath = fieldPath;
    }

    public MappingException(String message, Throwable cause) {
        super(message, cause);
        this.fieldPath = null;
    }

    public String getFieldPath() {
        return fieldPath;
    }
}
```

### 24.2 Field Path

Untuk nested/collection mapping, field path sangat membantu.

```text
applicant.dateOfBirth: must be ISO date
items[2].amount: must not be negative
addresses[0].postalCode: unsupported format
```

### 24.3 Jangan Bocorkan Data Sensitif

Buruk:

```java
throw new MappingException("Invalid password: " + rawPassword);
```

Lebih aman:

```java
throw new MappingException("password does not meet policy");
```

Untuk log internal pun berhati-hati. Payload mapping error sering mengandung PII.

---

## 25. Validation vs Mapping

Mapping dan validation berdekatan, tetapi tidak sama.

### 25.1 Mapping

Mapping menjawab:

```text
Bagaimana source representation diterjemahkan menjadi target representation?
```

### 25.2 Validation

Validation menjawab:

```text
Apakah representation ini sah menurut contract/rule?
```

### 25.3 Normalization

Normalization menjawab:

```text
Bagaimana value dibuat canonical?
```

Contoh:

```java
public UserCommand toCommand(CreateUserRequest request) {
    String email = normalizeEmail(request.email());
    return new UserCommand(email, request.displayName());
}
```

Validation bisa terjadi sebelum atau sesudah normalization, tergantung rule.

Misalnya email:

```text
1. trim
2. lowercase domain
3. validate format
4. construct EmailAddress value object
```

### 25.4 Jangan Menaruh Semua Business Rule di Mapper

Buruk:

```java
public CaseDecision toDecision(DecisionRequest request, CaseRecord caseRecord) {
    if (caseRecord.isClosed()) throw ...
    if (!officer.canApprove(caseRecord)) throw ...
    if (request.approved() && !caseRecord.hasAllDocuments()) throw ...
    ...
}
```

Ini bukan mapper. Ini application/domain decision service.

Lebih baik:

```java
DecisionCommand command = decisionMapper.toCommand(request);
caseService.decide(caseId, command, officer);
```

Mapper membentuk command. Service mengeksekusi rule.

---

## 26. Manual Mapping dan Domain Model

Mapper tidak boleh merusak domain encapsulation.

### 26.1 Buruk: Mapper Mengisi Entity dengan Setter Bebas

```java
User user = new User();
user.setId(UUID.randomUUID());
user.setEmail(request.email());
user.setStatus(UserStatus.ACTIVE);
user.setCreatedAt(Instant.now());
```

Jika entity punya invariant, setter bebas bisa melewati rule.

### 26.2 Lebih Baik: Mapper Membuat Command/Value, Domain yang Membuat Entity

```java
CreateUserCommand command = userMapper.toCommand(request);
User user = User.register(command.email(), command.displayName(), passwordHasher);
```

Atau:

```java
User user = new User(
    UserId.newId(),
    EmailAddress.of(request.email()),
    DisplayName.of(request.displayName()),
    UserStatus.PENDING_VERIFICATION,
    clock.instant()
);
```

Prinsip:

> Mapper boleh membuat value object.  
> Domain harus menjaga invariant domain.

---

## 27. Manual Mapping dan Persistence Entity

Jangan langsung menganggap persistence entity sama dengan domain model atau API DTO.

### 27.1 Entity to Response

```java
public UserResponse toResponse(UserEntity entity) {
    requireNonNull(entity, "entity");

    return new UserResponse(
        entity.getPublicId(),
        entity.getDisplayName(),
        toApiStatus(entity.getStatus())
    );
}
```

### 27.2 Response to Entity Biasanya Buruk

```java
UserEntity entity = mapper.fromResponse(response);
```

Response DTO bukan input persistence. Itu representation untuk client.

### 27.3 Request to Entity Harus Sangat Dibatasi

```java
public UserEntity toNewEntity(CreateUserRequest request) {
    return new UserEntity(
        UUID.randomUUID(),
        normalizeEmail(request.email()),
        UserStatus.PENDING_VERIFICATION
    );
}
```

Untuk update existing entity, jangan full mapping.

```java
public void applyProfileUpdate(UserEntity entity, UpdateProfileRequest request) {
    entity.setDisplayName(normalizeDisplayName(request.displayName()));
    entity.setPhoneNumber(normalizePhoneNumber(request.phoneNumber()));
}
```

---

## 28. Manual Mapping untuk Java 8 sampai Java 25

### 28.1 Java 8 Style

```java
public final class UserDto {
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

Collection:

```java
return Collections.unmodifiableList(new ArrayList<>(items));
```

Switch:

```java
switch (status) {
    case ACTIVE: return "active";
    default: throw new MappingException("Unsupported status");
}
```

### 28.2 Java 16+ Records

```java
public record UserResponse(String id, String name, String status) {}
```

Mapper:

```java
public UserResponse toResponse(User user) {
    return new UserResponse(
        user.id().toString(),
        user.displayName(),
        toApiStatus(user.status())
    );
}
```

### 28.3 Java 17+ Sealed Models

```java
public sealed interface PaymentMethod permits CardPayment, BankTransferPayment {}

public record CardPayment(String token) implements PaymentMethod {}
public record BankTransferPayment(String accountNo) implements PaymentMethod {}
```

Manual mapper:

```java
public PaymentMethodCommand toCommand(PaymentMethodRequest request) {
    switch (request.type()) {
        case "card":
            return new CardPaymentCommand(request.cardToken());
        case "bank_transfer":
            return new BankTransferCommand(request.accountNo());
        default:
            throw new MappingException("Unsupported payment method type: " + request.type());
    }
}
```

Java modern membuat modeling lebih kuat, tetapi mapping decision tetap harus eksplisit.

---

## 29. Anti-Pattern Manual Mapping

### 29.1 God Mapper

```java
public class ApplicationMapper {
    // 3000 lines mapping every object in the system
}
```

Masalah:

- sulit direview;
- dependency membengkak;
- ownership kabur;
- perubahan kecil berisiko besar;
- test sulit dipahami.

Lebih baik:

```text
user/UserMapper
case/CaseSummaryMapper
case/CaseDetailAssembler
integration/legacy/LegacyCaseTranslator
audit/AuditTrailResponseMapper
```

### 29.2 Blind Reflection Copy

```java
BeanUtils.copyProperties(source, target);
```

Boleh untuk prototyping/internal trivial object, tetapi berbahaya untuk boundary penting.

### 29.3 Mapper dengan Hidden Database Query

```java
public UserResponse toResponse(User user) {
    Department dept = departmentRepository.findById(user.getDepartmentId());
    ...
}
```

Ini bisa menyebabkan N+1 query saat collection mapping.

Lebih baik data disiapkan di service/query layer.

### 29.4 Mapper Melakukan Authorization Decision Besar

Mapper boleh melakukan redaction berdasarkan `ViewerContext`, tetapi jangan membuat keputusan authorization utama.

Baik:

```java
viewer.canViewEmail(user) ? user.getEmail() : null
```

Buruk:

```java
if (!permissionService.canAccessCase(user, caseRecord)) {
    throw new ForbiddenException();
}
```

Akses kontrol utama harus terjadi sebelum mapping.

### 29.5 Mapping Mengandalkan Field Name Tanpa Semantic Review

```text
source.status -> target.status
```

Nama sama belum tentu makna sama.

Contoh:

```text
Internal status = workflow state
External status = account lifecycle state
UI status = display label
```

---

## 30. Manual Mapper Testing

Manual mapper harus dites seperti unit logic.

### 30.1 Test Direct Mapping

```java
@Test
void mapsUserToResponse() {
    User user = new User(
        new UserId("u-123"),
        "Fajar",
        "fajar@example.com",
        UserStatus.ACTIVE
    );

    UserResponse response = mapper.toResponse(user);

    assertEquals("u-123", response.id());
    assertEquals("Fajar", response.name());
    assertEquals("active", response.status());
}
```

### 30.2 Test Field Not Mapped

Penting untuk security.

```java
@Test
void createCommandDoesNotAcceptRoleFromRequest() {
    CreateUserRequest request = new CreateUserRequest(
        "user@example.com",
        "User",
        "ADMIN" // malicious or ignored field, depending DTO design
    );

    CreateUserCommand command = mapper.toCommand(request);

    assertFalse(command.hasRoleOverride());
}
```

Lebih baik DTO tidak memiliki field berbahaya sama sekali.

### 30.3 Test Null Policy

```java
@Test
void toCommandRejectsNullRequest() {
    assertThrows(IllegalArgumentException.class, () -> mapper.toCommand(null));
}
```

### 30.4 Test Enum Evolution

```java
@Test
void mapsEveryInternalStatusToApiStatus() {
    for (UserStatus status : UserStatus.values()) {
        assertNotNull(mapper.toApiStatus(status));
    }
}
```

### 30.5 Test Negative External Value

```java
@Test
void rejectsUnsupportedExternalStatus() {
    MappingException ex = assertThrows(
        MappingException.class,
        () -> mapper.fromApiStatus("archived_unknown")
    );

    assertTrue(ex.getMessage().contains("Unsupported status"));
}
```

### 30.6 Golden Payload Test

Untuk response contract, golden JSON test penting. Walau Part ini fokus manual mapper, hasil mapping biasanya diserialisasi.

```text
User -> UserResponse -> JSON
compare with expected JSON fixture
```

Ini menangkap perubahan shape yang tidak disengaja.

---

## 31. Manual Mapping Checklist

Gunakan checklist ini saat membuat atau mereview mapper.

### 31.1 Boundary Checklist

```text
[ ] Source boundary jelas?
[ ] Target boundary jelas?
[ ] Mapping ini untuk create, update, patch, response, event, atau integration?
[ ] DTO tidak dipakai lintas boundary secara berlebihan?
[ ] Domain internal tidak bocor ke external API?
[ ] External weirdness tidak bocor ke domain?
```

### 31.2 Field Checklist

```text
[ ] Setiap field target disengaja?
[ ] Field sensitif diabaikan atau direduksi dengan benar?
[ ] Field server-owned tidak diambil dari request?
[ ] Field audit tidak tertimpa request?
[ ] Field id/version/status tidak berubah tanpa policy?
[ ] Field baru harus melalui review mapping?
```

### 31.3 Null/Default Checklist

```text
[ ] Root object null: reject atau null-out?
[ ] Nested object null: allowed atau error?
[ ] Missing vs null perlu dibedakan?
[ ] Default value business-approved?
[ ] Null redaction ambigu atau tidak?
```

### 31.4 Collection Checklist

```text
[ ] Null collection menjadi empty atau error?
[ ] Null element allowed atau rejected?
[ ] Defensive copy dilakukan?
[ ] Collection order penting?
[ ] Large collection menyebabkan memory pressure?
```

### 31.5 Conversion Checklist

```text
[ ] Enum mapping explicit?
[ ] Date/time timezone explicit?
[ ] BigDecimal scale explicit?
[ ] ID type tidak tercampur?
[ ] External code table terisolasi?
[ ] Unsupported value fail-fast?
```

### 31.6 Performance Checklist

```text
[ ] Mapper tidak trigger DB query tersembunyi?
[ ] Nested mapping tidak deep-map tanpa batas?
[ ] Collection pre-sized untuk hot path?
[ ] Payload besar tidak diproses seluruhnya jika streaming cukup?
[ ] Mapper tidak menciptakan object graph berlebihan?
```

### 31.7 Test Checklist

```text
[ ] Happy path tested?
[ ] Null policy tested?
[ ] Unsupported enum/value tested?
[ ] Sensitive field exposure tested?
[ ] Field not mapped tested?
[ ] Collection edge cases tested?
[ ] Golden payload test untuk API/event penting?
```

---

## 32. Example End-to-End: Case Creation Manual Mapping

Kita gunakan contoh case management sederhana.

### 32.1 Request DTO

```java
public record CreateCaseRequest(
    String applicantName,
    String applicantEmail,
    String applicantIdNumber,
    String caseType,
    String description
) {}
```

### 32.2 Command Model

```java
public record CreateCaseCommand(
    ApplicantInfo applicant,
    CaseType caseType,
    String description
) {}
```

### 32.3 Value Objects

```java
public record ApplicantInfo(
    String name,
    EmailAddress email,
    IdNumber idNumber
) {}

public record EmailAddress(String value) {
    public EmailAddress {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("email is required");
        }
    }
}

public record IdNumber(String normalizedValue, String rawValue) {}
```

### 32.4 Mapper

```java
public final class CreateCaseRequestMapper {

    public CreateCaseCommand toCommand(CreateCaseRequest request) {
        requireNonNull(request, "request");

        return new CreateCaseCommand(
            toApplicantInfo(request),
            toCaseType(request.caseType()),
            normalizeDescription(request.description())
        );
    }

    private ApplicantInfo toApplicantInfo(CreateCaseRequest request) {
        return new ApplicantInfo(
            normalizeName(request.applicantName()),
            new EmailAddress(normalizeEmail(request.applicantEmail())),
            toIdNumber(request.applicantIdNumber())
        );
    }

    private IdNumber toIdNumber(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new MappingException("applicantIdNumber is required");
        }
        String normalized = raw.replace("-", "").trim().toUpperCase(Locale.ROOT);
        return new IdNumber(normalized, raw);
    }

    private CaseType toCaseType(String value) {
        if (value == null || value.isBlank()) {
            throw new MappingException("caseType is required");
        }

        switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "complaint": return CaseType.COMPLAINT;
            case "appeal": return CaseType.APPEAL;
            case "enforcement": return CaseType.ENFORCEMENT;
            default: throw new MappingException("Unsupported caseType: " + value);
        }
    }

    private String normalizeName(String value) {
        if (value == null || value.isBlank()) {
            throw new MappingException("applicantName is required");
        }
        return value.trim().replaceAll("\\s+", " ");
    }

    private String normalizeEmail(String value) {
        if (value == null || value.isBlank()) {
            throw new MappingException("applicantEmail is required");
        }
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private String normalizeDescription(String value) {
        return value == null ? null : value.trim();
    }
}
```

### 32.5 Yang Sengaja Tidak Dilakukan Mapper

Mapper tidak menentukan:

- case ID;
- createdAt;
- createdBy;
- workflow stage;
- assignment officer;
- SLA deadline;
- approval rule;
- duplicate detection;
- authorization.

Itu milik application/domain service.

Mapper hanya menerjemahkan request menjadi command yang bersih.

---

## 33. Example End-to-End: Case Response Manual Mapping

### 33.1 Domain/Read Model

```java
public record CaseView(
    CaseId id,
    CaseReference reference,
    ApplicantView applicant,
    CaseStatus status,
    Instant submittedAt,
    OfficerView assignedOfficer,
    boolean sensitive
) {}
```

### 33.2 Response DTO

```java
public record CaseDetailResponse(
    String id,
    String referenceNo,
    ApplicantResponse applicant,
    String status,
    String submittedAt,
    OfficerResponse assignedOfficer
) {}
```

### 33.3 Permission-Aware Mapper

```java
public final class CaseDetailResponseMapper {

    public CaseDetailResponse toResponse(CaseView view, ViewerContext viewer) {
        requireNonNull(view, "view");
        requireNonNull(viewer, "viewer");

        return new CaseDetailResponse(
            view.id().value(),
            view.reference().value(),
            toApplicantResponse(view.applicant(), viewer, view.sensitive()),
            toApiStatus(view.status()),
            toApiTimestamp(view.submittedAt()),
            toOfficerResponse(view.assignedOfficer())
        );
    }

    private ApplicantResponse toApplicantResponse(
        ApplicantView applicant,
        ViewerContext viewer,
        boolean sensitiveCase
    ) {
        if (applicant == null) {
            return null;
        }

        boolean canViewSensitive = !sensitiveCase || viewer.hasPermission("CASE_VIEW_SENSITIVE");

        return new ApplicantResponse(
            applicant.name(),
            canViewSensitive ? applicant.email() : null,
            canViewSensitive ? maskIdNumber(applicant.idNumber()) : null
        );
    }

    private String toApiStatus(CaseStatus status) {
        return switch (status) {
            case DRAFT -> "draft";
            case SUBMITTED -> "submitted";
            case UNDER_REVIEW -> "under_review";
            case APPROVED -> "approved";
            case REJECTED -> "rejected";
            case CLOSED -> "closed";
        };
    }

    private String toApiTimestamp(Instant value) {
        return value == null ? null : value.toString();
    }

    private String maskIdNumber(String value) {
        if (value == null || value.length() <= 4) {
            return "****";
        }
        return "****" + value.substring(value.length() - 4);
    }
}
```

### 33.4 Review Pertanyaan

Mapper ini menjawab beberapa keputusan:

```text
[ ] ID diekspose sebagai public id?
[ ] applicant email hanya muncul jika viewer authorized?
[ ] sensitive id number dimasking?
[ ] status external value stabil?
[ ] timestamp memakai Instant ISO UTC?
[ ] assigned officer boleh null?
```

---

## 34. Dari Manual Mapping ke MapStruct

Manual mapper yang baik mudah dipindahkan sebagian ke MapStruct.

Contoh manual:

```java
public UserResponse toResponse(User user) {
    return new UserResponse(
        user.getId().toString(),
        user.getDisplayName(),
        toApiStatus(user.getStatus())
    );
}
```

MapStruct nanti bisa menjadi:

```java
@Mapper
public interface UserMapper {
    @Mapping(target = "id", expression = "java(user.getId().toString())")
    @Mapping(target = "name", source = "displayName")
    @Mapping(target = "status", expression = "java(toApiStatus(user.getStatus()))")
    UserResponse toResponse(User user);

    default String toApiStatus(UserStatus status) {
        return switch (status) {
            case ACTIVE -> "active";
            case SUSPENDED -> "suspended";
            case PENDING_VERIFICATION -> "pending_verification";
        };
    }
}
```

Tetapi tidak semua harus dipindahkan.

Tetap manual untuk:

- security-sensitive mapping;
- patch semantics kompleks;
- error diagnostics presisi;
- anti-corruption translation kompleks;
- mapping dengan audit preservation;
- mapping dengan presence tracking.

Gunakan MapStruct untuk:

- field mapping yang banyak tetapi rule jelas;
- DTO response sederhana;
- nested structural mapping;
- collection mapping biasa;
- compile-time safety terhadap target fields;
- mengurangi boilerplate setelah policy jelas.

---

## 35. Practical Heuristics: Cara Memilih Bentuk Mapper

### 35.1 Decision Table

| Situasi | Rekomendasi |
|---|---|
| DTO kecil, mapping trivial | static factory atau mapper kecil |
| Response dari entity/read model | dedicated mapper |
| Response dari banyak source | assembler |
| External legacy payload | translator/anti-corruption mapper |
| Create request ke command | manual mapper eksplisit |
| Update/PATCH entity | manual use-case-specific method |
| Banyak field structural, low risk | MapStruct setelah rule jelas |
| Security-sensitive boundary | manual atau MapStruct sangat eksplisit |
| Need precise error path | manual |
| Need generated compile-time safety | MapStruct |
| Need JSON binding only | Jackson config/DTO design |

### 35.2 Rule of Thumb

```text
If the mapping changes meaning, write it manually first.
If the mapping only changes shape, generation may help.
If the mapping crosses trust boundary, be explicit.
If the mapping updates existing state, never blindly copy.
If the mapping affects contract, test the payload.
```

---

## 36. Latihan Desain

### Latihan 1 — User Profile Update

Desain manual mapper untuk:

```text
UpdateProfileRequest:
- displayName
- phoneNumber
- address

UserProfile entity:
- id
- displayName
- phoneNumber
- address
- status
- verified
- createdAt
- updatedAt
```

Tentukan:

- field mana boleh diubah;
- field mana server-owned;
- null policy;
- PUT vs PATCH behavior;
- test case minimal.

### Latihan 2 — External Status Translation

External system mengirim:

```text
A = Active
I = Inactive
S = Suspended
D = Deleted
```

Internal domain punya:

```text
ACTIVE
INACTIVE
SUSPENDED
ARCHIVED
```

Tentukan:

- apakah `D` menjadi `ARCHIVED` atau error;
- apakah unknown value ditolak;
- apakah original code disimpan untuk audit;
- bagaimana test enum evolution.

### Latihan 3 — Sensitive Case Response

Case response memiliki:

```text
case id
reference no
applicant name
applicant email
applicant id number
case status
assigned officer
```

Viewer bisa:

```text
public user
case owner
officer
admin
```

Desain mapper yang:

- tidak membocorkan sensitive field;
- membedakan null karena tidak ada vs redacted;
- menghasilkan contract stabil;
- mudah dites.

---

## 37. Kesimpulan

Manual mapping adalah baseline engineering, bukan pekerjaan rendahan.

Engineer yang kuat tidak langsung bertanya:

```text
Pakai MapStruct atau BeanUtils?
```

Ia bertanya:

```text
Boundary apa yang sedang dilewati data ini?
Makna apa yang berubah?
Field mana yang boleh bergerak?
Field mana yang harus berhenti?
Apa null policy-nya?
Apa security exposure-nya?
Apa compatibility impact-nya?
Apa failure mode-nya?
Bagaimana saya membuktikan mapping ini benar?
```

Setelah itu, baru diputuskan apakah mapping ditulis manual, digenerate oleh MapStruct, dikendalikan oleh Jackson annotation/configuration, atau dipisah menjadi translator/assembler.

Manual mapping memberi kita satu hal yang tidak boleh hilang saat memakai framework:

> kesadaran eksplisit atas perubahan bentuk dan makna data.

Itulah fondasi untuk masuk ke level berikutnya: **mapping architecture placement, ownership, and dependency direction**.

---

## 38. Status Seri

- Part 0: selesai — Orientation: Data Transformation as Software Boundary
- Part 1: selesai — Java Object Model for Mapping
- Part 2: selesai — Transformation Taxonomy
- Part 3: selesai — DTO Design
- Part 4: selesai — Manual Mapping Baseline
- Part 5: berikutnya — Mapping Architecture: Mapper Placement, Ownership, and Dependency Direction

Seri belum selesai. Ini adalah **Part 4 dari 35**.
