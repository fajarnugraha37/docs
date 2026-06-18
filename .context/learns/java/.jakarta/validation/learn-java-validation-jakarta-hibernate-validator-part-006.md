# learn-java-validation-jakarta-hibernate-validator-part-006

# Container Element Constraints: Lists, Maps, Optional, Custom Containers

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `006`  
> Topik: Container element constraints, type-use constraints, `ValueExtractor`, nested container validation, custom container validation  
> Target: Java 8 hingga Java 25, Bean Validation 2.0, Jakarta Validation 3.x, Hibernate Validator 6/7/8/9

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas cascaded validation dengan `@Valid`: bagaimana validator menelusuri object graph dan kapan traversal tersebut aman atau berbahaya.

Bagian ini memperdalam satu fitur yang mengubah cara kita menulis validation modern sejak Bean Validation 2.0: **container element constraints**.

Sebelum Bean Validation 2.0, validasi container sering ditulis seperti ini:

```java
@Valid
private List<AddressDto> addresses;
```

Itu hanya mengatakan: “tolong cascade ke elemen-elemen address”. Tetapi ia tidak cukup ekspresif untuk mengatakan hal seperti:

```java
private List<@NotBlank String> tags;

private Map<@NotBlank String, @Valid AddressDto> addressesByType;

private Optional<@Email String> recoveryEmail;
```

Dengan container element constraints, kita tidak hanya memberi constraint pada field sebagai container, tetapi juga pada **elemen di dalam container**.

Mental model utama bagian ini:

> Container element constraint adalah cara untuk menyatakan kontrak terhadap isi container, bukan hanya terhadap container itu sendiri.

Contoh perbedaannya:

```java
@NotEmpty
private List<String> names;
```

Artinya:

> List tidak boleh null atau kosong.

Sedangkan:

```java
private List<@NotBlank String> names;
```

Artinya:

> Setiap elemen String di dalam list tidak boleh blank. Tetapi list-nya sendiri masih boleh null kecuali diberi `@NotNull`.

Dan:

```java
@NotEmpty
private List<@NotBlank String> names;
```

Artinya:

> List harus ada, tidak kosong, dan setiap elemennya harus tidak blank.

Perbedaan kecil ini sangat penting di production system.

---

## 1. Masalah yang Diselesaikan Container Element Constraints

Bayangkan DTO berikut:

```java
public class SubmitApplicationRequest {

    @NotEmpty
    private List<String> selectedServices;
}
```

Apakah DTO ini aman?

Belum.

Ia hanya memastikan list tidak kosong. Ia tidak mencegah payload seperti ini:

```json
{
  "selectedServices": ["", "   ", null]
}
```

`@NotEmpty` pada `List<String>` hanya memvalidasi list sebagai container. Ia tidak otomatis memvalidasi elemen `String` di dalamnya.

Solusi modern:

```java
public class SubmitApplicationRequest {

    @NotEmpty
    private List<@NotBlank String> selectedServices;
}
```

Sekarang kontraknya lebih lengkap:

1. `selectedServices` tidak boleh null.
2. `selectedServices` tidak boleh kosong.
3. Setiap service code tidak boleh null, empty, atau blank.

Ini jauh lebih tepat daripada membuat custom validator besar seperti:

```java
@ValidSelectedServices
private List<String> selectedServices;
```

Custom validator seperti itu kadang diperlukan, tetapi untuk rule struktural sederhana, container element constraints lebih jelas, reusable, introspectable, dan mudah dimapping ke error response.

---

## 2. Dari Field Constraint ke Type-Use Constraint

Container element constraints bekerja karena Java 8 memperkenalkan kemampuan annotation pada penggunaan type atau **type use annotation**.

Contoh:

```java
List<@NotBlank String>
```

Di sini `@NotBlank` tidak ditempelkan pada field. Ia ditempelkan pada type argument `String`.

Bandingkan:

```java
@NotEmpty
List<String> names;
```

`@NotEmpty` berlaku pada object `List`.

Sedangkan:

```java
List<@NotBlank String> names;
```

`@NotBlank` berlaku pada setiap `String` di dalam `List`.

Dan:

```java
@NotEmpty
List<@NotBlank String> names;
```

Ada dua level kontrak:

| Lokasi constraint | Target validasi | Contoh |
|---|---|---|
| Field/container | List sebagai object | `@NotEmpty List<String>` |
| Type argument | Elemen di dalam list | `List<@NotBlank String>` |
| Dua-duanya | Container dan element | `@NotEmpty List<@NotBlank String>` |

Ini adalah salah satu hal yang membedakan validation modern dari model lama.

---

## 3. Specification Context

Bean Validation 2.0 memperkenalkan dukungan untuk container element constraints, termasuk penggunaan constraint pada type argument seperti `List<@Positive Integer>` dan dukungan built-in untuk beberapa container umum seperti `Optional`. Jakarta Validation 3.1 meneruskan model ini dalam namespace `jakarta.validation` dan mendefinisikan API serta metadata model untuk JavaBean dan method validation.

Hibernate Validator sebagai reference implementation mendukung container element constraints untuk container umum seperti `Iterable`, `List`, `Map`, `Optional`, dan juga menyediakan mekanisme `ValueExtractor` untuk custom container.

Catatan versi:

| Era | Namespace | Umum dipakai dengan | Catatan |
|---|---|---|---|
| Bean Validation 2.0 | `javax.validation` | Java 8+, Spring Boot 2.x, Jakarta EE 8 style | Mulai mendukung container element constraints secara standar |
| Jakarta Validation 3.0 | `jakarta.validation` | Jakarta EE 10, Spring Boot 3.x era awal | Package pindah dari `javax` ke `jakarta` |
| Jakarta Validation 3.1 | `jakarta.validation` | Jakarta EE 11, Java 17+ | Clarification untuk records dan update dependencies |
| Hibernate Validator 9.x | `jakarta.validation` | Jakarta Validation 3.1 | Java 17+ baseline pada stack modern |

Implikasi praktis:

- Di Java 8 legacy stack, Anda masih bisa memakai container element constraints dengan Bean Validation 2.0 / Hibernate Validator 6.x.
- Di Spring Boot 3 / Jakarta modern stack, gunakan `jakarta.validation.*`.
- Jangan campur `javax.validation.*` dan `jakarta.validation.*` dalam satu model aplikasi modern.

---

## 4. Container Constraint vs Element Constraint

Ini kesalahan paling umum.

### 4.1 Constraint pada Container

```java
@NotNull
private List<String> documents;
```

Validasi:

| Value | Valid? |
|---|---:|
| `null` | Tidak valid |
| `[]` | Valid |
| `[null]` | Valid |
| `[""]` | Valid |

`@NotNull` hanya mengecek list-nya ada.

---

```java
@NotEmpty
private List<String> documents;
```

Validasi:

| Value | Valid? |
|---|---:|
| `null` | Tidak valid |
| `[]` | Tidak valid |
| `[null]` | Valid |
| `[""]` | Valid |

`@NotEmpty` mengecek list tidak null dan size > 0. Ia tidak peduli kualitas elemennya.

---

### 4.2 Constraint pada Element

```java
private List<@NotBlank String> documents;
```

Validasi:

| Value | Valid? |
|---|---:|
| `null` | Valid |
| `[]` | Valid |
| `[null]` | Tidak valid |
| `[""]` | Tidak valid |
| `["   "]` | Tidak valid |
| `["PASSPORT"]` | Valid |

Karena constraint ditempelkan ke elemen, list-nya sendiri masih boleh null dan kosong.

---

### 4.3 Constraint pada Container dan Element

```java
@NotEmpty
private List<@NotBlank String> documents;
```

Validasi:

| Value | Valid? |
|---|---:|
| `null` | Tidak valid |
| `[]` | Tidak valid |
| `[null]` | Tidak valid |
| `[""]` | Tidak valid |
| `["PASSPORT"]` | Valid |

Ini biasanya bentuk yang benar untuk “user harus mengirim minimal satu item, dan setiap item harus valid”.

---

## 5. List Element Validation

Contoh DTO:

```java
public class CreateCaseRequest {

    @NotBlank
    private String title;

    @Size(max = 10)
    private List<@NotBlank String> tags;
}
```

Kontrak:

- `title` wajib tidak blank.
- `tags` boleh null.
- Jika `tags` ada, maksimal 10 elemen.
- Setiap elemen `tags` tidak boleh blank.

Jika `tags` harus wajib ada dan minimal satu elemen:

```java
public class CreateCaseRequest {

    @NotEmpty
    @Size(max = 10)
    private List<@NotBlank String> tags;
}
```

Namun hati-hati: `@NotEmpty` sudah mengandung not-null dan size > 0. Jadi tidak perlu:

```java
@NotNull
@NotEmpty
private List<@NotBlank String> tags;
```

Itu redundant. Gunakan:

```java
@NotEmpty
private List<@NotBlank String> tags;
```

---

## 6. Set Element Validation

```java
public class AssignRolesRequest {

    @NotEmpty
    private Set<@NotBlank String> roleCodes;
}
```

Kontrak:

- `roleCodes` tidak boleh null atau kosong.
- Setiap role code tidak boleh blank.
- Duplikasi role code secara struktur dicegah oleh `Set`, tetapi bukan berarti secara semantik aman.

Masalah yang sering terjadi:

```json
{
  "roleCodes": ["ADMIN", " admin "]
}
```

Jika JSON deserializer membuat `Set<String>` sebelum normalization, maka `"ADMIN"` dan `" admin "` dianggap berbeda.

Karena itu, untuk code-like values, validation sebaiknya dipadukan dengan normalization policy:

1. Trim whitespace.
2. Reject blank.
3. Canonicalize case jika domain memang case-insensitive.
4. Deduplicate setelah canonicalization.
5. Validasi membership terhadap allowed role set di layer domain/service.

Bean Validation cocok untuk shape:

```java
@NotEmpty
private Set<@Pattern(regexp = "[A-Z_]+") String> roleCodes;
```

Tetapi membership check seperti “role harus exist dan assignable oleh actor ini” bukan tugas annotation sederhana.

---

## 7. Array Element Validation

Array juga dapat divalidasi pada elemen:

```java
public class UploadMetadataRequest {

    @Size(max = 5)
    private String @NotNull [] labels;
}
```

Namun syntax type-use pada array di Java bisa membingungkan.

Lebih umum dan lebih terbaca:

```java
public class UploadMetadataRequest {

    @Size(max = 5)
    private List<@NotBlank String> labels;
}
```

Dalam API DTO modern, prefer `List<T>` dibanding array kecuali ada alasan spesifik seperti low-level binary processing atau interoperability.

Untuk request/response DTO, `List<@Constraint T>` lebih jelas, lebih mudah dites, dan lebih mudah dimapping ke violation path.

---

## 8. Map Key and Value Validation

Map adalah container dengan dua dimensi: key dan value.

Contoh:

```java
public class ContactRequest {

    @NotEmpty
    private Map<@NotBlank String, @Email String> emailsByType;
}
```

Kontrak:

- Map tidak boleh null atau kosong.
- Setiap key tidak boleh blank.
- Setiap value harus email valid.

Payload valid:

```json
{
  "emailsByType": {
    "PRIMARY": "user@example.com",
    "RECOVERY": "recovery@example.com"
  }
}
```

Payload invalid:

```json
{
  "emailsByType": {
    "": "not-email"
  }
}
```

Pada violation path, provider biasanya dapat menunjukkan bahwa error terjadi pada map key atau map value.

Contoh konseptual path:

```text
emailsByType<K>[].<map key>
emailsByType[PRIMARY].<map value>
```

Dalam API error response, jangan hanya mengeluarkan string mentah dari provider. Normalisasi menjadi format stabil:

```json
{
  "code": "VALIDATION_FAILED",
  "violations": [
    {
      "path": "emailsByType.<key>",
      "messageCode": "contact.email.type.required"
    },
    {
      "path": "emailsByType.PRIMARY",
      "messageCode": "contact.email.invalid"
    }
  ]
}
```

Untuk Map, path strategy perlu diputuskan secara eksplisit karena key bisa mengandung karakter aneh, PII, atau string panjang.

---

## 9. Nested Container Validation

Container element constraints bisa nested.

Contoh:

```java
public class BulkAssignmentRequest {

    @NotEmpty
    private Map<
        @NotBlank String,
        @NotEmpty List<@NotBlank String>
    > roleCodesByUserId;
}
```

Kontrak:

- Map tidak boleh null/kosong.
- Setiap user id sebagai key tidak boleh blank.
- Setiap value list tidak boleh null/kosong.
- Setiap role code dalam list tidak boleh blank.

Ini ekspresif, tetapi bisa cepat menjadi sulit dibaca.

Jika generic declaration terlalu kompleks, pertimbangkan membuat type eksplisit:

```java
public class BulkAssignmentRequest {

    @NotEmpty
    private List<@Valid UserRoleAssignment> assignments;
}

public class UserRoleAssignment {

    @NotBlank
    private String userId;

    @NotEmpty
    private List<@NotBlank String> roleCodes;
}
```

Versi ini biasanya lebih baik untuk API publik karena:

- error path lebih manusiawi,
- dokumentasi lebih jelas,
- bisa ditambah metadata di masa depan,
- rule per assignment bisa diperluas,
- lebih mudah diuji.

Rule of thumb:

> Nested generic constraints bagus untuk struktur kecil. Jika struktur punya makna domain, buat class eksplisit.

---

## 10. Optional Element Validation

`Optional` sebagai field DTO perlu hati-hati. Namun jika digunakan, container element constraints bisa mengekspresikan validasi value di dalamnya.

```java
public class UserPreferenceRequest {

    private Optional<@Email String> recoveryEmail;
}
```

Makna:

- Jika optional kosong, valid.
- Jika optional berisi value, value harus email valid.

Namun ada beberapa caveat penting.

### 10.1 Optional Field Tidak Selalu Cocok untuk DTO

Dalam Java API design, `Optional<T>` lebih umum sebagai return type untuk menandai kemungkinan tidak ada value. Untuk field DTO, apalagi JSON DTO, `Optional` sering membuat semantics lebih kabur:

- field absent,
- field present null,
- field present value,
- optional empty,
- optional with value.

Serializer/deserializer bisa memperlakukan semua ini berbeda tergantung konfigurasi.

Untuk DTO request, sering lebih jelas memakai field nullable + explicit patch/presence model.

Contoh create/update biasa:

```java
public class UpdateUserRequest {

    @Email
    private String recoveryEmail;
}
```

Contoh patch presence-aware:

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    // constructors/factory omitted
}
```

Lalu validasi dengan custom `ValueExtractor` jika ingin constraint pada value.

### 10.2 Optional dengan `@NotNull`

```java
@NotNull
private Optional<@Email String> recoveryEmail;
```

Artinya:

- Optional object tidak boleh null.
- Optional boleh empty.
- Jika berisi value, value harus email.

Ini bukan berarti email wajib ada.

Jika email wajib ada, jangan pakai `Optional`:

```java
@NotBlank
@Email
private String recoveryEmail;
```

Atau gunakan domain-specific wrapper dengan semantics jelas.

---

## 11. OptionalInt, OptionalLong, OptionalDouble

Primitive optional seperti `OptionalInt` bukan generic container. Anda tidak bisa menulis:

```java
OptionalInt<@Min(1)> // invalid Java
```

Provider seperti Hibernate Validator mendukung value extraction untuk beberapa non-generic container dengan mekanisme extractor tertentu. Karena syntax generic tidak tersedia, constraint biasanya ditempatkan pada field dan di-unwrap oleh value extractor.

Contoh konseptual:

```java
@Min(1)
private OptionalInt quantity;
```

Maknanya bergantung pada extractor/provider behavior: constraint diterapkan pada contained primitive value ketika present.

Namun untuk DTO API, pertimbangkan apakah `OptionalInt` memang lebih jelas daripada:

```java
@Min(1)
private Integer quantity;
```

Dalam request DTO, `Integer` sering lebih interoperable dengan JSON dan lebih mudah dipahami.

---

## 12. Cascading Inside Container: `List<@Valid AddressDto>`

Untuk object element, gunakan `@Valid` pada type argument:

```java
public class RegisterUserRequest {

    @NotEmpty
    private List<@Valid AddressDto> addresses;
}
```

Makna:

- List tidak boleh null/kosong.
- Setiap `AddressDto` divalidasi secara cascade.

Jika elemen tidak boleh null, tambahkan `@NotNull`:

```java
@NotEmpty
private List<@NotNull @Valid AddressDto> addresses;
```

Karena `@Valid` bukan `@NotNull`.

Tanpa `@NotNull`, list seperti ini bisa lolos pada elemen null tergantung traversal semantics:

```json
{
  "addresses": [null]
}
```

Best practice untuk list of object request:

```java
@NotEmpty
@Size(max = 5)
private List<@NotNull @Valid AddressDto> addresses;
```

Kontraknya eksplisit:

- wajib ada,
- minimal satu,
- maksimal lima,
- tidak boleh ada elemen null,
- setiap address divalidasi.

---

## 13. Legacy `@Valid` at Container Level vs Type Argument Level

Pola lama:

```java
@Valid
private List<AddressDto> addresses;
```

Pola modern:

```java
private List<@Valid AddressDto> addresses;
```

Pola modern lebih presisi karena `@Valid` ditempelkan langsung ke elemen container.

Untuk container kompleks:

```java
private Map<String, List<AddressDto>> addresses;
```

Pola lama tidak cukup jelas: `@Valid` di field berlaku ke mana?

Pola modern:

```java
private Map<
    @NotBlank String,
    @NotEmpty List<@NotNull @Valid AddressDto>
> addressesByType;
```

Sekarang targetnya jelas:

- key map divalidasi,
- list value divalidasi sebagai container,
- elemen address divalidasi cascade.

Hibernate Validator 9.1 bahkan mendepresiasi penggunaan legacy `@Valid` di container level untuk container element cascading dan mendorong penggunaan type argument level. Jadi untuk code baru, biasakan bentuk modern.

---

## 14. Constraint Path untuk Container Element

Validation result tidak cukup hanya “invalid”. Engineer yang baik harus bisa membaca lokasi error.

Contoh DTO:

```java
public class SubmitRequest {

    @NotEmpty
    private List<@NotBlank String> documentTypes;
}
```

Payload:

```json
{
  "documentTypes": ["PASSPORT", "", "LICENSE"]
}
```

Violation path konseptual:

```text
documentTypes[1]
```

Untuk nested object:

```java
public class SubmitRequest {

    @NotEmpty
    private List<@NotNull @Valid ApplicantDto> applicants;
}

public class ApplicantDto {

    @NotBlank
    private String name;
}
```

Payload:

```json
{
  "applicants": [
    { "name": "Alice" },
    { "name": "" }
  ]
}
```

Violation path konseptual:

```text
applicants[1].name
```

Untuk map:

```java
private Map<@NotBlank String, @Valid AddressDto> addressesByType;
```

Violation path bisa mengandung:

- map key,
- map value,
- key/index metadata,
- container element node.

Ketika membuat API error response, jangan bergantung penuh pada `toString()` path provider jika Anda butuh backward-compatible error contract. Lebih baik transform `Path` node-by-node menjadi format sendiri.

---

## 15. Value Extraction: Mesin di Balik Container Element Constraint

Pertanyaan penting:

> Bagaimana validator tahu cara mengambil elemen dari `List<T>`, value dari `Optional<T>`, atau key/value dari `Map<K, V>`?

Jawabannya: **ValueExtractor**.

`ValueExtractor` adalah mekanisme untuk memberi tahu provider bagaimana mengambil value dari container.

Secara konseptual:

```java
List<@NotBlank String> names
```

Validator melakukan:

1. Melihat constraint `@NotBlank` pada type argument `String`.
2. Menyadari type argument itu berada di dalam `List`.
3. Memakai value extractor untuk `List`/`Iterable`.
4. Mengiterasi elemen.
5. Menerapkan `@NotBlank` ke setiap elemen.
6. Membangun violation path dengan index.

Untuk `Map<K, V>`:

```java
Map<@NotBlank String, @Email String> emailsByType
```

Validator perlu extractor untuk:

- map key,
- map value.

Karena itu path bisa membedakan key dan value.

---

## 16. Built-in Value Extractors

Provider Jakarta Validation/Hibernate Validator menyediakan extractor untuk container umum.

Secara praktis, Anda bisa memakai constraints pada:

```java
List<@NotBlank String>
Set<@NotBlank String>
Collection<@Valid ItemDto>
Iterable<@Valid ItemDto>
Map<@NotBlank String, @Valid AddressDto>
Optional<@Email String>
```

Pada Hibernate Validator, dukungan juga mencakup beberapa container lain dan mekanisme extension.

Namun jangan berasumsi semua custom container otomatis bisa diekstrak.

Contoh ini tidak otomatis valid kecuali ada extractor:

```java
public final class Result<T> {
    private final T value;
    private final String errorCode;
}

public class Request {
    private Result<@NotBlank String> applicantName;
}
```

Validator tidak tahu apakah ia harus mengambil `value`, `errorCode`, keduanya, atau tidak sama sekali.

Anda perlu `ValueExtractor`.

---

## 17. Custom Container: Kapan Dibutuhkan

Custom container umum di domain modern:

```java
Result<T>
Either<L, R>
PatchField<T>
Maybe<T>
Encrypted<T>
LocalizedText<T>
Money<TCurrency>
TypedId<T>
Reference<T>
```

Namun tidak semua perlu `ValueExtractor`.

Pertanyaan desain:

1. Apakah constraint harus diterapkan ke isi container?
2. Apakah container punya satu value utama atau banyak value?
3. Jika ada beberapa type parameter, mana yang divalidasi?
4. Jika container empty/error, apakah constraint harus skip atau fail?
5. Bagaimana violation path harus terlihat?
6. Apakah unwrapping otomatis aman?

Contoh `PatchField<T>`:

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    public boolean isPresent() {
        return present;
    }

    public T getValue() {
        return value;
    }
}
```

Untuk PATCH, kita mungkin ingin:

```java
private PatchField<@Email String> recoveryEmail;
```

Semantics yang diinginkan:

- jika field absent → tidak divalidasi,
- jika field present dengan null → tergantung rule,
- jika field present dengan value → value harus email.

Ini tidak bisa diekspresikan hanya dengan nullable `String` tanpa kehilangan informasi presence.

---

## 18. Contoh Custom `ValueExtractor` untuk `PatchField<T>`

Misalnya kita punya:

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    private PatchField(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> PatchField<T> absent() {
        return new PatchField<>(false, null);
    }

    public static <T> PatchField<T> of(T value) {
        return new PatchField<>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    public T getValue() {
        return value;
    }
}
```

Extractor konseptual:

```java
import jakarta.validation.valueextraction.ExtractedValue;
import jakarta.validation.valueextraction.ValueExtractor;

public final class PatchFieldValueExtractor
        implements ValueExtractor<PatchField<@ExtractedValue ?>> {

    @Override
    public void extractValues(
            PatchField<?> originalValue,
            ValueReceiver receiver
    ) {
        if (originalValue == null) {
            return;
        }

        if (!originalValue.isPresent()) {
            return;
        }

        receiver.value("value", originalValue.getValue());
    }
}
```

Sekarang DTO dapat ditulis:

```java
public class PatchUserRequest {

    private PatchField<@Email String> recoveryEmail;
}
```

Makna:

- absent tidak divalidasi,
- present value divalidasi sebagai email.

Jika explicit null tidak boleh:

```java
private PatchField<@NotNull @Email String> recoveryEmail;
```

Makna:

- absent valid,
- present null invalid,
- present non-email invalid,
- present valid email valid.

Ini jauh lebih akurat untuk PATCH dibanding DTO nullable biasa.

---

## 19. Mendaftarkan Custom ValueExtractor

Ada beberapa cara bergantung framework/provider.

Secara programmatic bootstrap:

```java
ValidatorFactory factory = Validation.byDefaultProvider()
        .configure()
        .addValueExtractor(new PatchFieldValueExtractor())
        .buildValidatorFactory();

Validator validator = factory.getValidator();
```

Dalam framework seperti Spring Boot atau Jakarta EE/CDI, pendaftaran biasanya dilakukan melalui konfigurasi provider/factory bean/framework integration.

Prinsip production:

- Daftarkan extractor secara application-level.
- Jangan membuat `ValidatorFactory` baru per request.
- Pastikan semua service memakai factory yang sama.
- Test konfigurasi validation dalam integration test, bukan hanya unit test extractor.

---

## 20. `@ExtractedValue`: Menandai Type Parameter yang Diekstrak

Dalam extractor generic:

```java
implements ValueExtractor<PatchField<@ExtractedValue ?>>
```

`@ExtractedValue` memberi tahu provider bahwa type argument inilah value yang akan diekstrak.

Untuk container dengan beberapa type parameter seperti `Either<L, R>`:

```java
public final class Either<L, R> {
    private final L left;
    private final R right;
    private final boolean rightSide;
}
```

Anda harus memutuskan: constraints pada type parameter mana yang didukung?

Misalnya hanya right side yang dianggap success value:

```java
public final class EitherRightValueExtractor
        implements ValueExtractor<Either<?, @ExtractedValue ?>> {

    @Override
    public void extractValues(Either<?, ?> originalValue, ValueReceiver receiver) {
        if (originalValue == null) {
            return;
        }

        if (originalValue.isRight()) {
            receiver.value("right", originalValue.getRight());
        }
    }
}
```

Maka penggunaan:

```java
private Either<ErrorCode, @Valid ApplicationDto> application;
```

Validator hanya menerapkan validation pada right value ketika present.

Namun ini harus sangat hati-hati. `Either` biasanya bukan DTO boundary type yang ideal untuk JSON request. Lebih sering ia internal result type.

---

## 21. Ambiguity dalam Value Extractor

Custom extractor bisa menimbulkan ambiguity.

Contoh buruk:

```java
class Box<T> { T value; }
```

Lalu Anda mendaftarkan lebih dari satu extractor yang sama-sama cocok:

```java
ValueExtractor<Box<@ExtractedValue ?>> extractorA
ValueExtractor<Box<@ExtractedValue ?>> extractorB
```

Provider tidak tahu mana yang harus dipakai.

Ambiguity juga bisa muncul karena inheritance/generic hierarchy.

Guideline:

1. Satu custom container sebaiknya punya satu semantics extraction utama.
2. Hindari membuat extractor yang terlalu generic dan menangkap banyak type tidak sengaja.
3. Test bootstrap validation factory; banyak error extractor muncul saat factory dibuat atau saat validation pertama berjalan.
4. Dokumentasikan semantics unwrapping container.

---

## 22. Unwrapping: Constraint pada Container atau Isi?

Kadang constraint ditempelkan pada field container, tetapi maksudnya diterapkan ke isi container.

Contoh dengan optional primitive:

```java
@Min(1)
private OptionalInt quantity;
```

Apakah `@Min` diterapkan ke `OptionalInt` object atau ke int di dalamnya?

Untuk kasus tertentu, provider dapat melakukan unwrapping berdasarkan extractor dengan behavior default.

Namun untuk desain API, lebih baik eksplisit jika memungkinkan:

```java
private Optional<@Min(1) Integer> quantity;
```

Lebih jelas daripada:

```java
@Min(1)
private Optional<Integer> quantity;
```

Untuk custom container, jangan mengandalkan magic unwrapping tanpa dokumentasi. Bentuk paling jelas adalah type-use constraint:

```java
private PatchField<@Email String> recoveryEmail;
```

Bukan:

```java
@Email
private PatchField<String> recoveryEmail;
```

Kecuali Anda memang mendesain extractor dengan unwrapping default dan tim memahami semantics-nya.

---

## 23. Domain Wrapper: `EmailAddress`, `PostalCode`, `CaseReference`

Container element constraints sering mengurangi kebutuhan wrapper, tetapi tidak menggantikan domain type.

Contoh sederhana:

```java
private List<@Email String> emails;
```

Ini cukup untuk DTO boundary.

Tetapi untuk domain model, lebih kuat:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Email is required");
        }
        // additional parsing/canonicalization omitted
    }
}
```

Lalu:

```java
private List<EmailAddress> emails;
```

Kapan pakai constraint element pada primitive/string?

- DTO boundary,
- import row model,
- external API model,
- temporary validation before mapping.

Kapan pakai domain wrapper?

- value dipakai luas di domain,
- ada canonicalization,
- ada behavior,
- ada invariant kuat,
- tidak ingin raw string menyebar.

Best architecture:

```text
Inbound DTO
  List<@Email String>
      ↓ validation + normalization
Domain model
  List<EmailAddress>
```

---

## 24. Container Element Constraint vs Custom Validator

Misalnya requirement:

> `selectedServices` wajib minimal satu, maksimal lima, setiap service code uppercase alphanumeric, dan tidak boleh duplikat setelah trim/case normalization.

Bagian struktural bisa pakai annotation:

```java
@NotEmpty
@Size(max = 5)
private List<@Pattern(regexp = "[A-Z0-9_]+") String> selectedServices;
```

Tetapi “tidak boleh duplikat setelah normalization” kurang cocok dengan built-in constraint.

Opsi:

### Opsi A: Custom Constraint pada List

```java
@UniqueNormalizedElements
@NotEmpty
@Size(max = 5)
private List<@Pattern(regexp = "[A-Z0-9_]+") String> selectedServices;
```

Cocok jika uniqueness adalah input shape rule.

### Opsi B: Normalize lalu Validasi Domain

```java
List<ServiceCode> serviceCodes = request.selectedServices().stream()
        .map(ServiceCode::parse)
        .distinct()
        .toList();

if (serviceCodes.size() != request.selectedServices().size()) {
    throw duplicateServiceCode();
}
```

Cocok jika normalization/canonicalization bagian dari domain mapping.

### Opsi C: Domain Policy

Jika rule tergantung actor, product, workflow state, agency, atau date:

```java
selectionPolicy.validate(actor, application, serviceCodes);
```

Jangan dipaksa menjadi container element constraint.

---

## 25. Validation Groups pada Container Element

Constraint pada element juga bisa diberi group.

```java
public interface Submit {}
public interface Draft {}

public class ApplicationRequest {

    @Size(max = 20, groups = Draft.class)
    @NotEmpty(groups = Submit.class)
    private List<
        @NotBlank(groups = Submit.class)
        String
    > attachments;
}
```

Makna:

- Saat draft, attachments maksimal 20 jika dikirim.
- Saat submit, attachments wajib ada dan setiap elemennya tidak blank.

Namun hati-hati: group di nested generic declaration bisa cepat sulit dibaca.

Jika sudah seperti ini:

```java
private Map<
    @NotBlank(groups = Submit.class) String,
    @NotEmpty(groups = Submit.class) List<
        @NotNull(groups = Submit.class) @Valid AttachmentDto
    >
> attachmentsByCategory;
```

Kemungkinan model Anda terlalu padat. Pertimbangkan class eksplisit:

```java
public class AttachmentCategoryInput {
    @NotBlank(groups = Submit.class)
    private String category;

    @NotEmpty(groups = Submit.class)
    private List<@NotNull(groups = Submit.class) @Valid AttachmentDto> attachments;
}
```

Readability adalah bagian dari correctness.

---

## 26. Method Parameter Container Validation

Container element constraints juga berlaku pada method parameter.

```java
public void assignRoles(
        @NotBlank String userId,
        @NotEmpty List<@NotBlank String> roleCodes
) {
    // ...
}
```

Kontrak method:

- `userId` harus tidak blank.
- `roleCodes` tidak boleh null/kosong.
- setiap role code tidak boleh blank.

Pada framework yang mendukung executable validation, constraint ini bisa dijalankan otomatis melalui proxy/interceptor.

Namun ingat pitfall method validation:

- self-invocation biasanya tidak memicu proxy-based validation,
- private method tidak divalidasi otomatis,
- final method/class dapat mengganggu proxy tertentu,
- validation di method internal tidak menggantikan validation di API boundary.

Untuk public service method, ini berguna sebagai internal contract.

---

## 27. Return Value Container Validation

Anda juga bisa memberi constraint pada return value.

```java
public @NotEmpty List<@Valid CaseSummaryDto> findOpenCases() {
    // ...
}
```

Atau:

```java
public List<@NotNull @Valid CaseSummaryDto> findOpenCases() {
    // ...
}
```

Namun return value validation harus dipakai selektif.

Cocok untuk:

- library/public API internal,
- service contract kuat,
- generated adapter,
- defensive boundary antar module.

Kurang cocok untuk:

- hot path query besar,
- repository method yang mengembalikan ribuan row,
- response yang sudah dijamin oleh type/domain model,
- method yang dipanggil sangat sering dan cost validation tidak sepadan.

Validation return value adalah postcondition check. Ia berguna, tetapi bisa mahal jika overused.

---

## 28. Container Element Constraints dan API Documentation

Container element constraints bisa dimanfaatkan untuk API documentation, tetapi tool support bervariasi.

Misalnya:

```java
@NotEmpty
private List<@NotBlank @Size(max = 20) String> tags;
```

Secara kontrak API:

```yaml
tags:
  type: array
  minItems: 1
  items:
    type: string
    minLength: 1
    maxLength: 20
```

Namun tidak semua OpenAPI generator menangkap semua type-use constraints dengan sempurna, terutama untuk nested generic.

Untuk API publik yang stabil, jangan hanya mengandalkan generator. Pastikan:

- generated schema diuji,
- contract test memvalidasi response error,
- API docs menyebutkan rule penting,
- frontend tidak menebak rule dari message string.

---

## 29. Container Validation dan Frontend Error Mapping

Container element validation sering menghasilkan path dengan index.

Contoh:

```text
applicants[2].addresses[0].postalCode
```

Frontend butuh path stabil untuk menempelkan error ke field yang benar.

Recommended API violation shape:

```json
{
  "code": "VALIDATION_FAILED",
  "violations": [
    {
      "path": "applicants[2].addresses[0].postalCode",
      "messageCode": "address.postalCode.invalid",
      "message": "Postal code is invalid",
      "constraint": "Pattern"
    }
  ]
}
```

Untuk map key, hati-hati:

```text
contacts[personal@email.com].phone
```

Jika key mengandung PII, jangan selalu expose key mentah di error response. Alternatif:

```json
{
  "path": "contacts[1].phone",
  "keyHash": "...",
  "messageCode": "contact.phone.invalid"
}
```

Atau ubah request model dari `Map` ke `List` dengan field eksplisit:

```java
public class ContactInput {
    @NotBlank
    private String type;

    @Valid
    private ContactDetail detail;
}
```

Untuk API publik, list of objects sering lebih aman daripada map bebas.

---

## 30. Performance Cost Model

Container element validation bisa mahal jika tidak dikontrol.

Cost dipengaruhi oleh:

1. Jumlah elemen container.
2. Kedalaman nested container.
3. Cascaded object graph.
4. Banyaknya constraint per element.
5. Regex complexity.
6. Message interpolation.
7. Group sequence.
8. Custom validator yang melakukan IO/database call.

Contoh berbahaya:

```java
@NotEmpty
private List<@Valid LargeApplicationDto> applications;
```

Jika payload berisi 10.000 applications dan setiap application punya nested graph besar, validation bisa menjadi bottleneck atau DoS vector.

Mitigasi:

```java
@NotEmpty
@Size(max = 100)
private List<@NotNull @Valid ApplicationDto> applications;
```

Selalu kombinasikan element validation dengan container size limit untuk inbound request.

Rule:

> Jika Anda memvalidasi elemen container dari input eksternal, hampir selalu tetapkan batas ukuran container.

---

## 31. Security Considerations

Container element constraints sering berada di input boundary. Karena itu, pikirkan abuse case.

### 31.1 Huge Collection Attack

Payload:

```json
{
  "emails": ["a@example.com", "a@example.com", ... 1000000 items ...]
}
```

Jika tidak ada `@Size(max = ...)`, validator akan mencoba memproses semuanya.

### 31.2 Deep Nested Graph Attack

```java
private List<List<List<List<@Valid NodeDto>>>> nodes;
```

Jangan expose nested container tak terbatas di API.

### 31.3 Regex ReDoS per Element

```java
private List<@Pattern(regexp = "(a+)+$") String> values;
```

Regex buruk pada ribuan elemen bisa menjadi CPU attack.

### 31.4 PII Leakage in Violation Path

Map key mungkin berisi email, identifier, token, atau user-submitted data.

```java
private Map<@Email String, @Valid ContactDto> contactsByEmail;
```

Jika violation path menampilkan key email, itu bisa bocor ke log/error response.

Design safer model:

```java
private List<@Valid ContactInput> contacts;
```

Dengan index path, bukan key PII.

---

## 32. Production Design Patterns

### 32.1 DTO Boundary Pattern

```java
public class SubmitApplicationRequest {

    @NotBlank
    private String applicantName;

    @NotEmpty
    @Size(max = 10)
    private List<@NotBlank String> selectedServices;

    @Size(max = 5)
    private List<@NotNull @Valid AttachmentInput> attachments;
}
```

Cocok untuk request validation.

---

### 32.2 Explicit Item Type Pattern

Daripada:

```java
private Map<String, List<String>> selections;
```

Lebih baik:

```java
private List<@Valid SelectionInput> selections;

public class SelectionInput {
    @NotBlank
    private String category;

    @NotEmpty
    private List<@NotBlank String> values;
}
```

Lebih maintainable.

---

### 32.3 Presence-Aware Patch Pattern

```java
public class PatchUserRequest {

    private PatchField<@NotBlank String> displayName;

    private PatchField<@Email String> recoveryEmail;
}
```

Dengan custom `ValueExtractor`, validation bisa membedakan absent vs present invalid.

---

### 32.4 Domain Mapping Pattern

```java
public UserCommand toCommand() {
    return new UserCommand(
            displayName.trim(),
            recoveryEmail == null ? null : EmailAddress.parse(recoveryEmail)
    );
}
```

Bean Validation menjaga shape. Domain type menjaga invariant.

---

### 32.5 Import Row Pattern

```java
public class ImportApplicationRow {

    @NotBlank
    private String rowNumber;

    @NotEmpty
    private List<@NotBlank String> errors;
}
```

Untuk import/batch, kadang Anda tidak ingin fail-fast. Anda ingin mengumpulkan semua violation per row dan menghasilkan report.

---

## 33. Anti-Patterns

### 33.1 `@Valid` Everywhere

```java
@Valid
private List<@Valid Something> everything;
```

Masalah:

- graph traversal tidak terkendali,
- lazy loading bisa terpicu,
- performance tidak jelas,
- boundary domain bocor.

Gunakan `@Valid` hanya pada boundary yang memang harus dicascade.

---

### 33.2 Constraint Hanya pada Container

```java
@NotEmpty
private List<String> emails;
```

Padahal yang dibutuhkan:

```java
@NotEmpty
private List<@Email String> emails;
```

---

### 33.3 Constraint Hanya pada Element

```java
private List<@NotBlank String> selectedServices;
```

Padahal field wajib ada:

```java
@NotEmpty
private List<@NotBlank String> selectedServices;
```

---

### 33.4 Nested Generic Terlalu Rumit

```java
private Map<
    @NotBlank String,
    List<Map<@NotBlank String, @Valid SomethingDto>>
> data;
```

Jika sudah sulit dibaca, buat type eksplisit.

---

### 33.5 Custom ValueExtractor untuk Menutupi Model yang Buruk

Jika Anda perlu extractor kompleks untuk membuat DTO bisa divalidasi, mungkin DTO-nya salah bentuk.

Jangan gunakan `ValueExtractor` untuk menyelamatkan model yang tidak jelas semantics-nya.

---

### 33.6 DB Call per Element

```java
private List<@ExistingUserId String> userIds;
```

Jika `@ExistingUserId` melakukan query DB per element, payload 1000 user id bisa memicu 1000 query.

Lebih baik:

- validasi shape dengan Bean Validation,
- lakukan batch existence check di service layer,
- hasilkan error per element jika perlu.

---

## 34. Validation Strategy untuk Large Batch

Untuk batch input:

```java
public class BulkImportRequest {

    @NotEmpty
    @Size(max = 1000)
    private List<@NotNull @Valid ImportRow> rows;
}
```

Pertanyaan penting:

1. Apakah ingin stop pada error pertama?
2. Apakah ingin semua error per row?
3. Apakah ada limit error report?
4. Apakah row valid secara shape tetapi invalid secara reference?
5. Apakah partial success diperbolehkan?

Bean Validation bisa memberikan structural violations. Tetapi batch import biasanya butuh validation pipeline:

```text
Parse file
  ↓
Structural validation per row
  ↓
Normalization/canonicalization
  ↓
Reference validation in batch
  ↓
Cross-row validation
  ↓
Business policy validation
  ↓
Import plan / reject report
```

Container element constraints cocok untuk tahap structural validation, bukan seluruh pipeline.

---

## 35. Case Management Example

Misalnya request submit case:

```java
public class SubmitCaseRequest {

    @NotBlank
    private String caseType;

    @NotEmpty
    @Size(max = 5)
    private List<@NotBlank String> allegationCodes;

    @NotEmpty
    @Size(max = 20)
    private List<@NotNull @Valid PartyInput> parties;

    @Size(max = 50)
    private Map<@NotBlank String, @NotBlank String> externalReferences;

    @Size(max = 10)
    private List<@NotNull @Valid EvidenceInput> evidences;
}
```

Child DTO:

```java
public class PartyInput {

    @NotBlank
    private String partyType;

    @NotBlank
    private String name;

    @Size(max = 5)
    private List<@NotBlank String> identifiers;
}
```

Evidence DTO:

```java
public class EvidenceInput {

    @NotBlank
    private String evidenceType;

    @NotBlank
    private String documentId;

    @Size(max = 20)
    private List<@NotBlank String> tags;
}
```

Apa yang dilakukan Bean Validation:

- memastikan struktur request masuk akal,
- membatasi ukuran list/map,
- memastikan elemen tidak blank/null,
- cascade ke child DTO.

Apa yang tidak boleh dipaksa ke Bean Validation annotation:

- apakah `caseType` boleh memakai allegation code tertentu,
- apakah party boleh submit evidence tertentu,
- apakah documentId benar-benar exist,
- apakah actor punya permission,
- apakah current workflow state memperbolehkan submit,
- apakah allegation code masih aktif pada tanggal submit,
- apakah duplicate party secara domain.

Itu domain/service/workflow validation.

---

## 36. Review Checklist

Gunakan checklist ini saat code review DTO/service method:

### Container Level

- Apakah container boleh null?
- Apakah container boleh kosong?
- Apakah ada `@Size(max = ...)` untuk input eksternal?
- Apakah min/max size sesuai business dan security limit?

### Element Level

- Apakah element boleh null?
- Apakah string element boleh blank?
- Apakah format element perlu `@Pattern`, `@Email`, atau domain-specific parser?
- Apakah object element perlu `@Valid`?

### Nested Structure

- Apakah nested generic masih readable?
- Apakah lebih baik membuat class eksplisit?
- Apakah path error masih bisa dipetakan ke frontend?

### Map

- Apakah key mengandung PII?
- Apakah map lebih baik diganti list of object?
- Apakah key dan value divalidasi terpisah?

### Custom Container

- Apakah benar butuh `ValueExtractor`?
- Apakah extraction semantics jelas?
- Apakah absent/empty/error state didefinisikan?
- Apakah extractor didaftarkan di factory yang benar?

### Performance/Security

- Apakah ada bound untuk jumlah element?
- Apakah ada validator mahal per element?
- Apakah regex aman?
- Apakah violation logging tidak membocorkan value/key sensitif?

---

## 37. Testing Strategy

### 37.1 Test Container vs Element

```java
@Test
void shouldRejectBlankElement() {
    SubmitRequest request = new SubmitRequest();
    request.setDocumentTypes(List.of("PASSPORT", ""));

    Set<ConstraintViolation<SubmitRequest>> violations = validator.validate(request);

    assertThat(violations)
            .anyMatch(v -> v.getPropertyPath().toString().contains("documentTypes"));
}
```

### 37.2 Test Null Container

```java
@Test
void shouldRejectNullListWhenNotEmpty() {
    SubmitRequest request = new SubmitRequest();
    request.setDocumentTypes(null);

    Set<ConstraintViolation<SubmitRequest>> violations = validator.validate(request);

    assertThat(violations).isNotEmpty();
}
```

### 37.3 Test Empty Container

```java
@Test
void shouldRejectEmptyListWhenNotEmpty() {
    SubmitRequest request = new SubmitRequest();
    request.setDocumentTypes(List.of());

    Set<ConstraintViolation<SubmitRequest>> violations = validator.validate(request);

    assertThat(violations).isNotEmpty();
}
```

### 37.4 Test Custom ValueExtractor

```java
@Test
void shouldValidatePresentPatchFieldValue() {
    PatchUserRequest request = new PatchUserRequest();
    request.setRecoveryEmail(PatchField.of("not-email"));

    Set<ConstraintViolation<PatchUserRequest>> violations = validator.validate(request);

    assertThat(violations).isNotEmpty();
}

@Test
void shouldIgnoreAbsentPatchField() {
    PatchUserRequest request = new PatchUserRequest();
    request.setRecoveryEmail(PatchField.absent());

    Set<ConstraintViolation<PatchUserRequest>> violations = validator.validate(request);

    assertThat(violations).isEmpty();
}
```

### 37.5 Test API Error Path

Selain test validator, test mapping error response:

```json
{
  "violations": [
    {
      "path": "documentTypes[1]",
      "messageCode": "document.type.required"
    }
  ]
}
```

Jangan hanya test jumlah violation. Test path dan code.

---

## 38. Java 8 sampai Java 25 Notes

### Java 8

- Type-use annotation tersedia.
- Bean Validation 2.0 dapat memakai container element constraints.
- Cocok dengan Hibernate Validator 6.x pada legacy `javax.validation` stack.

### Java 11

- Tidak ada perubahan khusus di syntax validation.
- Banyak enterprise app masih berada di Java 11 dengan Spring Boot 2.x atau early migration.

### Java 17

- Baseline umum untuk Spring Boot 3 dan Jakarta modern.
- Records mulai relevan untuk immutable DTO.
- Jakarta Validation 3.1 minimum Java 17.

### Java 21

- LTS modern.
- Validation placement harus memperhatikan virtual threads: jangan lakukan blocking DB call per element dalam validator.
- Records makin natural untuk request/command object.

### Java 25

- Target modern untuk codebase baru.
- Prinsip tetap sama: container element constraints adalah kontrak type-level.
- Gunakan modern Java modeling untuk mengurangi primitive obsession dan nested generic berlebihan.

---

## 39. Mental Model Final

Container element constraints menjawab pertanyaan:

> “Apa kontrak terhadap value yang ada di dalam container ini?”

Bukan hanya:

> “Apakah container ini ada?”

Pisahkan level kontrak:

```text
Container existence
  @NotNull

Container cardinality
  @NotEmpty, @Size

Element existence
  List<@NotNull T>

Element shape
  List<@NotBlank String>
  List<@Email String>
  List<@Pattern(...) String>

Element object invariant
  List<@Valid AddressDto>

Nested structure
  Map<@NotBlank String, @NotEmpty List<@Valid Item>>

Custom container semantics
  ValueExtractor
```

Jika Anda memahami level ini, Anda bisa mendesain validation yang:

- presisi,
- mudah dibaca,
- mudah dites,
- aman untuk API,
- tidak overfit ke framework,
- tidak mencampur input shape dengan business policy.

---

## 40. Kesimpulan

Container element constraints adalah fitur kecil secara syntax tetapi besar secara arsitektur.

Ia memungkinkan kita menulis kontrak yang lebih akurat:

```java
@NotEmpty
private List<@NotBlank String> selectedServices;
```

Bukan hanya:

```java
@NotEmpty
private List<String> selectedServices;
```

Ia juga memungkinkan nested validation modern:

```java
private Map<@NotBlank String, @NotEmpty List<@NotNull @Valid EvidenceInput>> evidences;
```

Tetapi kekuatannya harus dikontrol. Jika terlalu nested, terlalu magic, atau terlalu banyak custom extraction, model menjadi sulit dipahami.

Top-tier validation design bukan tentang memakai annotation sebanyak mungkin. Top-tier validation design adalah tentang menempatkan kontrak pada level yang benar:

- container,
- element,
- object,
- domain policy,
- workflow guard,
- database constraint,
- event/schema boundary.

Gunakan container element constraints untuk structural correctness. Gunakan domain model dan policy object untuk semantic correctness.

---

## 41. Referensi

- Jakarta Validation 3.1 Specification: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Jakarta Validation 3.1 Overview: https://jakarta.ee/specifications/bean-validation/3.1/
- Bean Validation 2.0 / JSR 380: https://beanvalidation.org/2.0/
- Hibernate Validator Reference Guide: https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/
- Hibernate Validator 9.0 Release Notes: https://in.relation.to/2025/05/20/hibernate-validator-9-0-0-Final/
- Hibernate Validator 9.1 Release Notes: https://in.relation.to/2025/11/07/hibernate-validator-9-1-0-Final/

---

## 42. Status Seri

Bagian ini adalah **part 006** dari seri `learn-java-validation-jakarta-hibernate-validator`.

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-007.md
```

Topik berikutnya:

```text
Validation Groups: Operation-Specific Contracts without DTO Explosion
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-005](./learn-java-validation-jakarta-hibernate-validator-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-007](./learn-java-validation-jakarta-hibernate-validator-part-007.md)

</div>