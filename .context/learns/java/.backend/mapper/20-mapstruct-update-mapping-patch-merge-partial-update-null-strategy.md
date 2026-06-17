# Part 20 — MapStruct Update Mapping: Patch, Merge, Partial Update, Null Strategy

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `20-mapstruct-update-mapping-patch-merge-partial-update-null-strategy.md`  
> Fokus: MapStruct update mapping, `@MappingTarget`, PATCH vs PUT, merge semantics, null handling, absent handling, JPA dirty checking, auditability, dan pencegahan overwrite tidak sengaja.  
> Target: Java 8 hingga Java 25, MapStruct 1.5/1.6 stable, dengan catatan desain untuk evolusi Java modern.

---

## 1. Kenapa Part Ini Penting

Banyak engineer memakai mapper untuk hal sederhana:

```java
UserDto dto = userMapper.toDto(user);
```

atau:

```java
User user = userMapper.toEntity(request);
```

Tetapi bug paling mahal sering muncul bukan di mapping create/read, melainkan di **update mapping**.

Contoh bug production yang umum:

```json
{
  "displayName": "Fajar"
}
```

Payload di atas dikirim untuk mengubah `displayName` saja. Namun mapper mengubah field lain menjadi `null` karena field tersebut tidak ada di request.

Akibatnya:

- email hilang,
- nomor telepon hilang,
- alamat hilang,
- flag status berubah ke default,
- relasi entity terhapus,
- audit trail menunjukkan update besar padahal user hanya mengubah satu field,
- data compliance rusak,
- sistem downstream menerima event yang salah.

Di sistem enterprise, case management, regulatory workflow, backoffice, finance, dan identity management, update mapping adalah titik rawan karena ia menentukan:

1. field mana boleh berubah,
2. field mana tidak boleh disentuh,
3. apa arti `null`,
4. apa arti field tidak dikirim,
5. siapa pemilik policy update,
6. bagaimana perubahan diaudit,
7. apakah update memicu side effect downstream.

MapStruct menyediakan fitur sangat kuat melalui `@MappingTarget`, `NullValuePropertyMappingStrategy`, `NullValueCheckStrategy`, `NullValueMappingStrategy`, `@BeanMapping`, `@Condition`, lifecycle hook, dan mapper configuration. Namun fitur ini harus dipakai dengan mental model yang benar.

---

## 2. Mental Model Utama: Update Mapping Bukan Create Mapping

Create mapping biasanya membentuk object baru.

```java
CreateUserRequest request -> User entity baru
```

Update mapping biasanya mengubah object yang sudah ada.

```java
UpdateUserRequest request + existing User entity -> existing User entity termutasi
```

Perbedaan ini fundamental.

### 2.1 Create Mapping

Create mapping menjawab:

> Dari input ini, object baru apa yang harus dibuat?

Contoh:

```java
User user = userMapper.toEntity(request);
```

Karakteristik:

- target belum ada,
- semua required field harus tersedia,
- default boleh diberikan,
- missing field biasanya invalid,
- identity biasanya belum ada atau dibuat sistem,
- relasi belum terikat,
- audit biasanya `createdBy`, `createdAt`.

### 2.2 Update Mapping

Update mapping menjawab:

> Dari input ini, field apa pada object existing yang boleh berubah?

Contoh:

```java
userMapper.updateEntity(request, existingUser);
```

Karakteristik:

- target sudah ada,
- identity harus dipertahankan,
- sebagian field mungkin tidak dikirim,
- missing field belum tentu berarti null,
- null mungkin berarti clear atau ignore tergantung kontrak,
- relasi bisa sensitif,
- audit harus menangkap perubahan,
- JPA dirty checking bisa aktif,
- side effect dapat muncul dari setter.

### 2.3 Kesalahan Berpikir Paling Umum

Kesalahan umum:

> “Request DTO punya field yang sama dengan entity, jadi tinggal map semua.”

Itu berbahaya.

Update bukan sekadar menyamakan bentuk. Update adalah keputusan policy.

Field yang sama secara nama belum tentu boleh diubah.

Contoh:

```java
class User {
    private Long id;
    private String email;
    private String displayName;
    private String role;
    private boolean locked;
    private Instant createdAt;
    private Instant updatedAt;
}
```

Jika request update membawa:

```java
class UpdateUserRequest {
    private String email;
    private String displayName;
    private String role;
    private Boolean locked;
}
```

Pertanyaannya bukan “bisa dimap atau tidak”. Pertanyaannya:

- apakah email boleh diubah user sendiri?
- apakah role boleh diubah endpoint ini?
- apakah locked boleh diubah oleh admin saja?
- apakah null email berarti clear atau invalid?
- apakah displayName kosong boleh?
- apakah perubahan email butuh re-verification?
- apakah perubahan role harus menghasilkan audit/security event?

Mapper tidak boleh menjadi jalan pintas yang melewati policy ini.

---

## 3. Tiga Operasi yang Sering Tertukar: PUT, PATCH, dan Merge

Sebelum menulis mapper, kita harus menentukan semantics update.

### 3.1 PUT — Replace Semantics

`PUT` biasanya berarti resource direpresentasikan ulang secara lengkap.

Mental model:

> Target resource setelah request harus sama dengan representasi request, dengan field server-managed tetap dijaga.

Contoh:

```http
PUT /users/123
Content-Type: application/json

{
  "email": "fajar@example.com",
  "displayName": "Fajar",
  "phone": null
}
```

Dalam replace semantics:

- field yang dikirim null bisa berarti clear,
- field yang tidak dikirim bisa dianggap default/null/invalid tergantung kontrak,
- request idealnya lengkap,
- missing required field harus error,
- lebih cocok untuk full edit form.

Risiko:

- client lama yang tidak tahu field baru bisa menghapus field baru,
- partial client bisa merusak data,
- entity besar membuat payload boros,
- sulit untuk mobile/partial UI.

### 3.2 PATCH — Partial Modification Semantics

`PATCH` berarti request berisi perubahan parsial.

Mental model:

> Hanya field yang secara eksplisit dimaksudkan untuk berubah yang boleh berubah.

Contoh:

```http
PATCH /users/123
Content-Type: application/json

{
  "displayName": "Fajar"
}
```

Dalam patch semantics:

- field tidak dikirim berarti jangan disentuh,
- field dikirim null bisa berarti clear atau bisa invalid, tergantung kontrak,
- perlu cara membedakan absent vs null,
- lebih cocok untuk partial UI dan workflow action.

### 3.3 Merge — Domain-Specific Combination

Merge bukan HTTP method. Merge adalah operasi domain.

Contoh:

```java
existingProfile.mergeFrom(submittedProfile);
```

Atau:

```java
caseFile.mergeExternalAgencyUpdate(payload);
```

Merge semantics bisa berarti:

- jika source punya value, update target,
- jika source null, abaikan,
- jika source lebih baru, update,
- jika target sudah verified, jangan overwrite,
- jika source authority lebih tinggi, override,
- jika conflict, masuk manual review.

Merge sangat domain-specific. Jangan diperlakukan sebagai generic mapping biasa.

---

## 4. `@MappingTarget`: Fondasi Update Mapping di MapStruct

MapStruct dapat mengupdate object existing dengan `@MappingTarget`.

```java
@Mapper(componentModel = "spring")
public interface UserMapper {

    void updateUser(UpdateUserRequest request, @MappingTarget User user);
}
```

Generated code-nya secara konseptual akan mirip:

```java
@Override
public void updateUser(UpdateUserRequest request, User user) {
    if (request == null) {
        return;
    }

    user.setEmail(request.getEmail());
    user.setDisplayName(request.getDisplayName());
    user.setPhone(request.getPhone());
}
```

Ini sederhana, tetapi sangat berbahaya jika DTO parsial.

Jika `request.getEmail()` null karena field tidak dikirim atau tidak diisi, entity email akan menjadi null.

### 4.1 `@MappingTarget` Mengubah Object yang Sama

Berbeda dari create mapping:

```java
User toEntity(UpdateUserRequest request);
```

update mapping:

```java
void updateUser(UpdateUserRequest request, @MappingTarget User user);
```

Tidak membuat object baru. Ia memutasi target existing.

Implikasi:

- identity target tetap sama,
- JPA dirty checking dapat mendeteksi perubahan setter,
- collection existing bisa diganti atau dimodifikasi,
- proxy/lazy relation bisa tersentuh,
- audit listener dapat terpicu,
- side effect setter bisa terjadi.

### 4.2 Return Type Bisa `void` atau Target

MapStruct mendukung update method yang return target.

```java
User updateUser(UpdateUserRequest request, @MappingTarget User user);
```

Ini berguna untuk chaining, tetapi jangan sampai menciptakan ilusi bahwa object baru dibuat.

Contoh pemakaian:

```java
User user = userRepository.findById(id).orElseThrow();
userMapper.updateUser(request, user);
return user;
```

Atau:

```java
User user = userRepository.findById(id).orElseThrow();
User updated = userMapper.updateUser(request, user);
assert user == updated;
```

Secara mental, ini tetap mutation operation.

---

## 5. Null Handling: Bagian yang Tidak Boleh Ditebak

Null handling adalah inti update mapping.

Ada beberapa jenis null yang sering tercampur:

1. source object null,
2. source property null,
3. target property null,
4. collection null,
5. missing JSON field yang menjadi null di DTO,
6. explicit JSON null yang menjadi null di DTO,
7. optional empty,
8. empty string,
9. default primitive value.

Jika semua diperlakukan sama, mapper akan salah.

---

## 6. MapStruct Null Strategy: Tiga Konsep Berbeda

MapStruct memiliki beberapa null strategy yang namanya mirip tetapi fungsinya berbeda.

### 6.1 `NullValuePropertyMappingStrategy`

Dipakai terutama untuk update method dengan `@MappingTarget`.

Menentukan apa yang dilakukan ketika **property source bernilai null**.

Nilai umum:

```java
NullValuePropertyMappingStrategy.SET_TO_NULL
NullValuePropertyMappingStrategy.IGNORE
NullValuePropertyMappingStrategy.SET_TO_DEFAULT
```

Contoh:

```java
@Mapper(componentModel = "spring")
public interface UserMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    void updateUser(UpdateUserRequest request, @MappingTarget User user);
}
```

Generated code secara konseptual:

```java
if (request.getEmail() != null) {
    user.setEmail(request.getEmail());
}
if (request.getDisplayName() != null) {
    user.setDisplayName(request.getDisplayName());
}
```

Artinya:

- source null tidak overwrite target,
- cocok untuk merge/patch “null means ignore”,
- tidak cocok jika explicit null harus clear field.

### 6.2 `NullValueCheckStrategy`

Menentukan kapan MapStruct menghasilkan null check sebelum assignment/conversion.

Contoh:

```java
@Mapper(
    componentModel = "spring",
    nullValueCheckStrategy = NullValueCheckStrategy.ALWAYS
)
public interface UserMapper {
    UserDto toDto(User user);
}
```

Ini bukan semantics PATCH. Ini lebih terkait generated code dan safety ketika property bisa null.

Jangan salah memakai `NullValueCheckStrategy` untuk menggantikan `NullValuePropertyMappingStrategy`.

### 6.3 `NullValueMappingStrategy`

Menentukan hasil ketika **source parameter** bernilai null, khususnya untuk mapping collection/map/bean.

Contoh:

```java
@Mapper(nullValueMappingStrategy = NullValueMappingStrategy.RETURN_DEFAULT)
public interface UserMapper {
    List<UserDto> toDtos(List<User> users);
}
```

Jika `users == null`, return list kosong atau default tergantung konteks.

Ini berbeda dari property-level update behavior.

### 6.4 Ringkasan Perbedaan

| Strategy | Level | Menjawab Pertanyaan | Umum Dipakai Untuk |
|---|---:|---|---|
| `NullValuePropertyMappingStrategy` | property dalam update target | kalau source property null, target property diapakan? | PATCH/merge update |
| `NullValueCheckStrategy` | generated assignment/conversion | kapan perlu generate null check? | safety/performance/codegen |
| `NullValueMappingStrategy` | source method/collection/map | kalau source object/collection null, return apa? | list/map/default return |

---

## 7. Patch Semantics Paling Umum: Null Means Ignore

Untuk partial update sederhana, strategy umum adalah:

> Field null di DTO tidak mengubah target.

Contoh:

```java
@Mapper(componentModel = "spring")
public interface UserPatchMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "role", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    void patch(UpdateUserRequest request, @MappingTarget User user);
}
```

Dengan DTO:

```java
public class UpdateUserRequest {
    private String displayName;
    private String phone;

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }
}
```

Request:

```json
{
  "displayName": "Fajar"
}
```

Hasil:

```text
displayName berubah
phone tetap
id tetap
role tetap
createdAt tetap
createdBy tetap
```

### 7.1 Kelebihan

- sederhana,
- aman untuk partial update,
- mencegah accidental null overwrite,
- cocok untuk banyak form update internal.

### 7.2 Kekurangan

Tidak bisa membedakan:

```json
{}
```

dengan:

```json
{
  "phone": null
}
```

Jika keduanya menjadi DTO dengan `phone == null`, maka mapper tidak tahu apakah user ingin:

- tidak mengubah phone, atau
- menghapus phone.

Inilah batas dari DTO biasa.

---

## 8. Masalah Absent vs Explicit Null

Dalam JSON:

```json
{}
```

berbeda secara semantik dari:

```json
{
  "phone": null
}
```

Yang pertama berarti field tidak hadir.

Yang kedua berarti field hadir dengan value null.

Tetapi Java POJO biasa:

```java
public class PatchUserRequest {
    private String phone;
}
```

akan menghasilkan:

```java
request.getPhone() == null
```

untuk dua payload tersebut.

Maka mapper biasa tidak bisa membedakan absent vs explicit null.

### 8.1 Kenapa Ini Penting

Dalam PATCH:

- absent biasanya berarti “jangan ubah”,
- explicit null bisa berarti “clear field”,
- explicit null juga bisa berarti “invalid”,
- empty string bisa berarti “clear”, “invalid”, atau “set empty string”.

Contoh field:

| Field | Absent | Explicit Null | Empty String |
|---|---|---|---|
| `displayName` | no change | invalid | invalid/trim invalid |
| `phone` | no change | clear phone | clear/invalid tergantung policy |
| `email` | no change | invalid | invalid |
| `middleName` | no change | clear | clear |
| `addressLine2` | no change | clear | clear |
| `role` | no change | invalid | invalid |

DTO biasa tidak cukup untuk patch semantics yang presisi.

---

## 9. Solusi Absent vs Null: Beberapa Pola

Ada beberapa pola untuk menangani absent vs null.

Tidak ada satu solusi universal. Pilih berdasarkan kompleksitas domain dan library stack.

---

## 10. Pola 1 — Null Means Ignore, Clear Pakai Endpoint/Aksi Terpisah

Ini pola paling sederhana.

Aturan:

- field absent/null di request tidak mengubah target,
- untuk clear field, pakai endpoint khusus atau action khusus.

Contoh:

```http
PATCH /users/123

{
  "displayName": "Fajar"
}
```

Clear phone:

```http
DELETE /users/123/phone
```

Atau:

```http
POST /users/123/actions/clear-phone
```

### 10.1 Kapan Cocok

Cocok jika:

- field yang bisa di-clear sedikit,
- API internal,
- UI controlled,
- simplicity lebih penting,
- audit action ingin eksplisit.

### 10.2 Kapan Tidak Cocok

Tidak cocok jika:

- banyak field optional yang perlu clear,
- API publik mengikuti PATCH semantics ketat,
- client butuh partial update fleksibel,
- contract harus membedakan absent/null.

---

## 11. Pola 2 — Explicit Patch Wrapper

Buat wrapper yang dapat membedakan:

- undefined/absent,
- present null,
- present value.

Contoh konseptual:

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

DTO:

```java
public class PatchUserRequest {
    private PatchField<String> displayName = PatchField.absent();
    private PatchField<String> phone = PatchField.absent();

    public PatchField<String> getDisplayName() {
        return displayName;
    }

    public void setDisplayName(PatchField<String> displayName) {
        this.displayName = displayName;
    }

    public PatchField<String> getPhone() {
        return phone;
    }

    public void setPhone(PatchField<String> phone) {
        this.phone = phone;
    }
}
```

Kemudian mapping manual atau MapStruct custom method:

```java
@Mapper(componentModel = "spring")
public interface UserPatchMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    @Mapping(target = "displayName", ignore = true)
    @Mapping(target = "phone", ignore = true)
    void patchBase(PatchUserRequest request, @MappingTarget User user);

    default void patch(PatchUserRequest request, User user) {
        if (request == null) {
            return;
        }

        patchBase(request, user);

        if (request.getDisplayName() != null && request.getDisplayName().isPresent()) {
            user.setDisplayName(request.getDisplayName().getValue());
        }

        if (request.getPhone() != null && request.getPhone().isPresent()) {
            user.setPhone(request.getPhone().getValue());
        }
    }
}
```

### 11.1 Kelebihan

- semantics paling jelas,
- explicit null bisa diproses,
- absent bisa diabaikan,
- cocok untuk API patch serius,
- audit bisa tahu field yang dimaksudkan berubah.

### 11.2 Kekurangan

- butuh custom Jackson deserializer atau module,
- DTO lebih berat,
- client contract lebih kompleks,
- MapStruct tidak otomatis memahami wrapper tanpa bantuan.

---

## 12. Pola 3 — `JsonNode` Patch Layer, Baru Map ke Command

Untuk PATCH yang sangat dinamis, kita bisa menerima `JsonNode`, menganalisis field presence, lalu membuat command eksplisit.

Controller:

```java
@PatchMapping("/users/{id}")
public UserResponse patchUser(
        @PathVariable Long id,
        @RequestBody JsonNode patch
) {
    PatchUserCommand command = patchParser.parse(patch);
    return userService.patchUser(id, command);
}
```

Parser:

```java
public PatchUserCommand parse(JsonNode node) {
    PatchUserCommand command = new PatchUserCommand();

    if (node.has("displayName")) {
        JsonNode value = node.get("displayName");
        command.setDisplayNamePresent(true);
        command.setDisplayName(value.isNull() ? null : value.asText());
    }

    if (node.has("phone")) {
        JsonNode value = node.get("phone");
        command.setPhonePresent(true);
        command.setPhone(value.isNull() ? null : value.asText());
    }

    return command;
}
```

Service:

```java
public User patchUser(Long id, PatchUserCommand command) {
    User user = userRepository.findById(id).orElseThrow();

    if (command.isDisplayNamePresent()) {
        user.changeDisplayName(command.getDisplayName());
    }

    if (command.isPhonePresent()) {
        user.changePhone(command.getPhone());
    }

    return user;
}
```

### 12.1 Kelebihan

- field presence akurat,
- cocok untuk public API,
- bisa validate unknown field manual,
- bisa hasilkan error path presisi,
- command lebih domain-oriented.

### 12.2 Kekurangan

- lebih banyak kode,
- tidak semua field bisa otomatis dimap,
- butuh disiplin testing.

---

## 13. Pola 4 — JSON Merge Patch

JSON Merge Patch adalah format patch standar di mana explicit null memiliki arti menghapus field.

Contoh:

Original:

```json
{
  "displayName": "Old Name",
  "phone": "123",
  "address": {
    "city": "Jakarta",
    "line2": "Apt 10"
  }
}
```

Patch:

```json
{
  "displayName": "New Name",
  "phone": null,
  "address": {
    "line2": null
  }
}
```

Result:

```json
{
  "displayName": "New Name",
  "address": {
    "city": "Jakarta"
  }
}
```

Mental model:

- absent means unchanged,
- present value means replace/add,
- present null means remove.

### 13.1 Kapan Cocok

Cocok jika:

- API client paham JSON Merge Patch,
- resource document model cukup natural,
- clear/delete field memang diwakili null,
- contract mengikuti RFC-style patch.

### 13.2 Risiko

Untuk entity/domain object, “remove property” tidak selalu sama dengan `set null`.

Contoh:

- remove phone mungkin allowed,
- remove email mungkin forbidden,
- remove status mungkin impossible,
- remove role bisa security issue,
- remove child relation bisa orphan deletion.

Karena itu, JSON Merge Patch sebaiknya tetap diterjemahkan ke domain command, bukan langsung ke entity.

---

## 14. Pola 5 — JSON Patch

JSON Patch memakai operasi eksplisit seperti `add`, `replace`, `remove`.

Contoh:

```json
[
  { "op": "replace", "path": "/displayName", "value": "Fajar" },
  { "op": "remove", "path": "/phone" }
]
```

Kelebihan:

- operasi eksplisit,
- bisa menyasar nested field,
- bisa `test` sebelum update,
- cocok untuk document-like resource.

Kekurangan:

- lebih kompleks,
- path harus dijaga kompatibilitasnya,
- raw path bisa expose internal shape,
- mapping ke domain command tetap perlu.

Untuk sebagian besar enterprise CRUD form, JSON Patch terlalu powerful. Gunakan jika memang butuh operasi patch eksplisit dan client cukup matang.

---

## 15. Recommended Strategy untuk Enterprise CRUD

Untuk mayoritas sistem enterprise:

1. Gunakan DTO khusus per operation.
2. Untuk simple partial update, gunakan `nullValuePropertyMappingStrategy = IGNORE`.
3. Untuk field yang butuh clear semantics, buat command/action eksplisit atau patch wrapper.
4. Jangan langsung map arbitrary patch ke entity.
5. Ignore field server-managed secara eksplisit.
6. Test null/missing/unknown/update forbidden field.
7. Untuk JPA entity, hati-hati collection dan relation update.

---

## 16. Contoh Full: Simple Patch dengan Null Ignore

### 16.1 Entity

```java
public class UserProfile {
    private Long id;
    private String displayName;
    private String phone;
    private String email;
    private String status;
    private Instant createdAt;
    private Instant updatedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
```

### 16.2 Request DTO

```java
public class PatchUserProfileRequest {
    private String displayName;
    private String phone;

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }
}
```

DTO ini sengaja tidak punya `email`, `status`, `id`, `createdAt`, `updatedAt`.

Menghilangkan field dari DTO lebih aman daripada mengandalkan mapper ignore saja.

### 16.3 Mapper

```java
@Mapper(componentModel = "spring")
public interface UserProfileMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "email", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    void patch(PatchUserProfileRequest request, @MappingTarget UserProfile profile);
}
```

### 16.4 Service

```java
@Service
public class UserProfileService {
    private final UserProfileRepository repository;
    private final UserProfileMapper mapper;
    private final Clock clock;

    public UserProfileService(
            UserProfileRepository repository,
            UserProfileMapper mapper,
            Clock clock
    ) {
        this.repository = repository;
        this.mapper = mapper;
        this.clock = clock;
    }

    @Transactional
    public UserProfile patchProfile(Long id, PatchUserProfileRequest request) {
        UserProfile profile = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("User profile not found"));

        mapper.patch(request, profile);
        profile.setUpdatedAt(Instant.now(clock));

        return profile;
    }
}
```

### 16.5 Apa yang Aman dari Desain Ini

- `id` tidak bisa diubah dari request.
- `email` tidak bisa diubah endpoint ini.
- `status` tidak bisa diubah endpoint ini.
- `createdAt` tidak bisa disentuh.
- null input tidak menghapus existing field.
- `updatedAt` dikontrol service, bukan client.

### 16.6 Apa yang Belum Ditangani

- explicit clear phone tidak bisa dilakukan,
- empty string belum dinormalisasi,
- validation belum ditunjukkan,
- audit diff belum ditangkap,
- collection/relation belum dibahas.

---

## 17. Update Mapping dengan Normalization

Sering kali input harus dinormalisasi sebelum diset ke entity.

Contoh:

- trim whitespace,
- empty string menjadi null,
- uppercase code,
- normalize phone number,
- normalize postal code,
- normalize email lowercase.

Namun normalization harus hati-hati.

### 17.1 Custom Method dengan `@Named`

```java
@Mapper(componentModel = "spring")
public interface UserProfileMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "displayName", source = "displayName", qualifiedByName = "trimToNull")
    @Mapping(target = "phone", source = "phone", qualifiedByName = "trimToNull")
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "email", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    void patch(PatchUserProfileRequest request, @MappingTarget UserProfile profile);

    @Named("trimToNull")
    static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
```

### 17.2 Subtle Bug dengan Null Ignore

Perhatikan interaksi ini:

```java
@Mapping(target = "displayName", source = "displayName", qualifiedByName = "trimToNull")
@BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
```

Jika input:

```json
{
  "displayName": "   "
}
```

`trimToNull` menghasilkan null.

Pertanyaan:

- apakah target harus diabaikan?
- apakah target harus di-clear?
- apakah harus validation error?

Untuk field seperti `displayName`, biasanya empty string harus error, bukan diam-diam ignore.

Maka normalization tidak boleh menggantikan validation.

### 17.3 Pola Lebih Aman

Untuk field required-on-update:

1. validate input dulu,
2. reject blank,
3. baru mapping.

Contoh:

```java
public class PatchUserProfileRequest {
    @Size(max = 100)
    private String displayName;

    @Size(max = 30)
    private String phone;
}
```

Lalu service/domain memutuskan:

```java
if (request.getDisplayName() != null && request.getDisplayName().isBlank()) {
    throw new ValidationException("displayName must not be blank");
}
```

Di Java 8, gunakan trim check:

```java
private boolean isBlank(String value) {
    return value == null || value.trim().isEmpty();
}
```

---

## 18. Update Mapping dan Domain Method

Untuk domain yang penting, jangan langsung pakai setter.

Daripada:

```java
user.setStatus(request.getStatus());
```

lebih baik:

```java
user.changeStatus(newStatus, actor, reason);
```

Mapper cocok untuk structural update. Domain method cocok untuk invariant-bearing update.

### 18.1 Contoh Buruk

```java
@Mapper(componentModel = "spring")
public interface CaseMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    void patch(PatchCaseRequest request, @MappingTarget CaseEntity entity);
}
```

Jika `PatchCaseRequest` punya:

```java
private String status;
private String officerId;
private LocalDate dueDate;
```

Mapper bisa mengubah status case tanpa memeriksa:

- current status,
- allowed transition,
- user role,
- business calendar,
- SLA rules,
- assignment rule,
- audit reason.

Ini bahaya.

### 18.2 Contoh Lebih Aman

```java
@Transactional
public CaseEntity updateCase(Long id, PatchCaseRequest request, Actor actor) {
    CaseEntity entity = repository.findById(id).orElseThrow();

    if (request.getTitle() != null) {
        entity.renameTitle(request.getTitle(), actor);
    }

    if (request.getDueDate() != null) {
        entity.rescheduleDueDate(request.getDueDate(), actor, calendarService);
    }

    if (request.getOfficerId() != null) {
        Officer officer = officerRepository.getReferenceById(request.getOfficerId());
        entity.assignTo(officer, actor);
    }

    return entity;
}
```

MapStruct masih bisa dipakai untuk simple structural subpart, misalnya mapping note draft atau address value object.

### 18.3 Rule of Thumb

Gunakan MapStruct update mapping jika:

- field sederhana,
- tidak ada invariant kompleks,
- tidak ada state transition,
- tidak ada authorization per field,
- tidak ada side effect bisnis,
- field boleh diubah secara langsung.

Gunakan service/domain method jika:

- perubahan punya meaning bisnis,
- ada state machine,
- ada audit reason,
- ada permission per field,
- ada derived field,
- ada event domain,
- ada SLA/escalation/recalculation.

---

## 19. `@MappingTarget` dan JPA Dirty Checking

Dalam JPA/Hibernate, entity managed di persistence context akan otomatis dideteksi perubahannya.

```java
@Transactional
public User update(Long id, PatchUserRequest request) {
    User user = repository.findById(id).orElseThrow();
    mapper.patch(request, user);
    return user;
}
```

Tidak perlu selalu memanggil `save(user)` jika entity managed, meski banyak codebase tetap melakukannya untuk konsistensi repository style.

### 19.1 Risiko Setter Memicu Dirty Field

Jika MapStruct memanggil setter dengan value yang sama:

```java
user.setDisplayName(request.getDisplayName());
```

Hibernate biasanya melakukan dirty checking berdasarkan snapshot, sehingga value sama belum tentu menghasilkan SQL update. Namun tergantung enhancement, custom type, mutable object, dan setter side effects.

Jika setter punya side effect:

```java
public void setDisplayName(String displayName) {
    this.displayName = displayName;
    this.updatedAt = Instant.now();
}
```

Maka mapper bisa menyebabkan side effect walaupun value sama.

### 19.2 Setter Side Effect Biasanya Buruk untuk Entity

Lebih aman:

```java
public void changeDisplayName(String displayName, Clock clock) {
    if (Objects.equals(this.displayName, displayName)) {
        return;
    }
    this.displayName = displayName;
    this.updatedAt = Instant.now(clock);
}
```

Namun MapStruct tidak otomatis memanggil method domain seperti itu kecuali dikonfigurasi/custom.

### 19.3 Pattern: Mapper untuk Draft, Domain untuk Apply

DTO -> command/draft:

```java
PatchUserDraft draft = mapper.toDraft(request);
```

Apply:

```java
user.applyPatch(draft, actor, clock);
```

Ini lebih eksplisit untuk aggregate penting.

---

## 20. Collection Update: Area Paling Berbahaya

Collection update dengan mapper sering menghasilkan bug besar.

Contoh entity:

```java
public class Order {
    private Long id;
    private List<OrderLine> lines = new ArrayList<>();
}
```

DTO:

```java
public class UpdateOrderRequest {
    private List<OrderLineRequest> lines;
}
```

Jika MapStruct mengassign collection:

```java
order.setLines(mapLines(request.getLines()));
```

Potensi masalah:

- existing line identity hilang,
- orphan removal menghapus row,
- audit diff kacau,
- optimistic locking conflict,
- order line yang tidak dikirim dianggap delete,
- duplicate line muncul,
- child entity detached,
- JPA cascade tidak sesuai,
- lazy collection terinitialize tanpa sadar.

### 20.1 Collection Replace Semantics

Jika endpoint adalah full replace:

```json
{
  "lines": [
    { "productId": 1, "quantity": 2 },
    { "productId": 2, "quantity": 3 }
  ]
}
```

Maka seluruh lines diganti sesuai request.

Ini harus dinyatakan eksplisit.

### 20.2 Collection Patch Semantics

Untuk patch, lebih baik operasi eksplisit:

```json
{
  "addLines": [
    { "productId": 3, "quantity": 1 }
  ],
  "updateLines": [
    { "lineId": 10, "quantity": 5 }
  ],
  "removeLineIds": [11, 12]
}
```

Service/domain:

```java
for (AddLineCommand line : command.getAddLines()) {
    order.addLine(line.productId(), line.quantity());
}

for (UpdateLineCommand line : command.getUpdateLines()) {
    order.updateLineQuantity(line.lineId(), line.quantity());
}

for (Long lineId : command.getRemoveLineIds()) {
    order.removeLine(lineId);
}
```

Ini lebih aman daripada generic collection mapping.

### 20.3 Rule for Collection Mapping

- For read DTO: MapStruct collection mapping sangat berguna.
- For create: MapStruct collection mapping boleh jika child baru semua.
- For update: jangan replace collection kecuali memang full replace semantics.
- For patch: gunakan operation DTO/domain method.

---

## 21. Nested Object Update

Nested object update punya problem mirip collection.

Contoh:

```java
public class User {
    private Address address;
}
```

Request:

```java
public class PatchUserRequest {
    private PatchAddressRequest address;
}
```

Jika address null:

- no change?
- clear address?
- invalid?

Jika address tidak null tetapi hanya `city` ada:

- update city saja?
- replace seluruh address?

### 21.1 Replace Nested Object

```java
@Mapping(target = "address", source = "address")
void update(PatchUserRequest request, @MappingTarget User user);
```

Risiko: address existing diganti object baru.

### 21.2 Patch Nested Object

Lebih aman:

```java
@Mapper(componentModel = "spring")
public interface UserMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "address", ignore = true)
    void patchUser(PatchUserRequest request, @MappingTarget User user);

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    void patchAddress(PatchAddressRequest request, @MappingTarget Address address);

    default void patch(PatchUserRequest request, User user) {
        if (request == null) {
            return;
        }

        patchUser(request, user);

        if (request.getAddress() != null) {
            if (user.getAddress() == null) {
                user.setAddress(new Address());
            }
            patchAddress(request.getAddress(), user.getAddress());
        }
    }
}
```

### 21.3 Pertanyaan Desain

Sebelum nested update, jawab:

- apakah nested object value object atau entity?
- apakah boleh dibuat otomatis jika null?
- apakah null berarti clear nested object?
- apakah partial nested update allowed?
- apakah nested object punya invariant?
- apakah nested object punya audit sendiri?

---

## 22. Ignore Field Server-Managed Secara Eksplisit

Dalam update mapper, field server-managed harus di-ignore.

Contoh:

```java
@Mapping(target = "id", ignore = true)
@Mapping(target = "createdAt", ignore = true)
@Mapping(target = "createdBy", ignore = true)
@Mapping(target = "updatedAt", ignore = true)
@Mapping(target = "updatedBy", ignore = true)
@Mapping(target = "version", ignore = true)
@Mapping(target = "status", ignore = true)
void patch(Request request, @MappingTarget Entity entity);
```

Kenapa explicit ignore penting?

- mencegah accidental mapping ketika DTO berubah,
- membuat reviewer melihat field sensitif,
- mengurangi over-posting risk,
- menjaga audit field,
- menjaga optimistic locking,
- menjaga identity.

### 22.1 DTO Tidak Boleh Mengandung Field Forbidden

Lebih baik field forbidden tidak ada di DTO.

Buruk:

```java
public class PatchUserRequest {
    private Long id;
    private String role;
    private Instant createdAt;
    private String displayName;
}
```

Lebih baik:

```java
public class PatchUserRequest {
    private String displayName;
}
```

Mapper ignore adalah lapisan kedua. DTO design adalah lapisan pertama.

---

## 23. `unmappedTargetPolicy`: Jadikan Compiler sebagai Reviewer

Untuk update mapper, sebaiknya jangan biarkan unmapped target diam-diam.

Konfigurasi:

```java
@MapperConfig(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface StrictMapperConfig {
}
```

Mapper:

```java
@Mapper(config = StrictMapperConfig.class)
public interface UserMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    @Mapping(target = "updatedBy", ignore = true)
    void patch(PatchUserRequest request, @MappingTarget User user);
}
```

Jika entity menambah field baru, build bisa gagal sampai field itu diputuskan:

- dimap,
- di-ignore,
- ditangani manual,
- tidak boleh ada di mapper.

Ini bagus.

### 23.1 Kenapa ERROR Lebih Baik dari WARN

`WARN` sering diabaikan di build log.

`ERROR` memaksa engineer membuat keputusan mapping.

Dalam sistem besar, ini mengurangi contract drift.

---

## 24. Per-Method Strategy Lebih Aman dari Global Strategy

Jangan asal global:

```java
@MapperConfig(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
```

Karena tidak semua mapping update harus ignore null.

Contoh:

- PATCH profile: null ignore.
- PUT profile: null set atau invalid.
- admin clear optional field: null set allowed.
- merge external payload: null ignore.
- full sync from authoritative source: null set allowed.

Lebih aman menetapkan strategy di method:

```java
@BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
void patch(...);

@BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.SET_TO_NULL)
void replace(...);
```

Atau pisahkan mapper:

```java
UserPatchMapper
UserReplaceMapper
ExternalUserSyncMapper
```

---

## 25. Create vs Replace vs Patch Mapper Dipisah

Jangan satu method untuk semua.

Buruk:

```java
void update(UserRequest request, @MappingTarget User user);
```

Lebih baik:

```java
User create(CreateUserRequest request);

void replace(ReplaceUserRequest request, @MappingTarget User user);

void patch(PatchUserRequest request, @MappingTarget User user);
```

Masing-masing punya semantics berbeda.

### 25.1 Create

```java
@Mapper(config = StrictMapperConfig.class)
public interface UserCreateMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "status", constant = "ACTIVE")
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    User create(CreateUserRequest request);
}
```

### 25.2 Replace

```java
@Mapper(config = StrictMapperConfig.class)
public interface UserReplaceMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.SET_TO_NULL)
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    @Mapping(target = "updatedBy", ignore = true)
    void replace(ReplaceUserRequest request, @MappingTarget User user);
}
```

### 25.3 Patch

```java
@Mapper(config = StrictMapperConfig.class)
public interface UserPatchMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "email", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    @Mapping(target = "updatedBy", ignore = true)
    void patch(PatchUserRequest request, @MappingTarget User user);
}
```

---

## 26. Conditional Mapping dengan `@Condition`

MapStruct mendukung conditional mapping untuk menentukan apakah property source perlu dimap.

Contoh use case:

- hanya map string jika tidak blank,
- hanya map positive number,
- hanya map collection jika tidak empty,
- hanya map field jika value valid secara local.

Contoh:

```java
@Mapper(componentModel = "spring")
public interface UserMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    void patch(PatchUserRequest request, @MappingTarget User user);

    @Condition
    default boolean isNotBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
```

Konseptualnya MapStruct dapat menggunakan condition untuk property mapping string.

### 26.1 Hati-Hati: Condition Bisa Menyembunyikan Invalid Input

Jika input:

```json
{
  "displayName": "   "
}
```

Condition `isNotBlank` akan membuat mapper ignore field itu.

Apakah itu benar?

Mungkin tidak. User mengirim input invalid, tetapi sistem diam-diam mengabaikan.

Untuk API yang baik, invalid input harus ditolak, bukan diabaikan.

Gunakan condition untuk policy yang memang “ignore if blank”, bukan untuk validation wajib.

---

## 27. Object Factory dalam Update Mapping

Kadang nested target null dan perlu dibuat.

Contoh:

```java
if (user.getAddress() == null) {
    user.setAddress(new Address());
}
```

MapStruct menyediakan `@ObjectFactory`, tetapi untuk update nested existing object, manual default method sering lebih jelas.

Contoh:

```java
default Address ensureAddress(User user) {
    if (user.getAddress() == null) {
        user.setAddress(new Address());
    }
    return user.getAddress();
}
```

Untuk factory yang butuh repository/reference data, hati-hati agar mapper tidak menjadi service layer.

---

## 28. Update Mapping dengan Reference Data

Contoh request:

```java
public class PatchCaseRequest {
    private String categoryCode;
}
```

Entity:

```java
public class CaseEntity {
    private Category category;
}
```

Mapping code mungkin butuh lookup:

```java
Category category = categoryRepository.findByCode(code);
entity.setCategory(category);
```

Apakah repository boleh dipakai di mapper?

Tergantung architecture.

### 28.1 Pilihan A — Lookup di Service

```java
if (request.getCategoryCode() != null) {
    Category category = categoryRepository.findByCode(request.getCategoryCode())
            .orElseThrow(() -> new ValidationException("Invalid category"));
    entity.changeCategory(category, actor);
}
```

Kelebihan:

- policy jelas,
- error handling jelas,
- domain method bisa dipakai,
- mapper tetap pure.

### 28.2 Pilihan B — Lookup via `@Context`

```java
@Mapper(componentModel = "spring")
public interface CaseMapper {

    @Mapping(target = "category", source = "categoryCode")
    void patch(PatchCaseRequest request, @MappingTarget CaseEntity entity, @Context CategoryResolver resolver);

    default Category map(String code, @Context CategoryResolver resolver) {
        if (code == null) {
            return null;
        }
        return resolver.resolve(code);
    }
}
```

Cocok jika resolver pure/deterministic dan memang bagian dari mapping boundary.

### 28.3 Rule of Thumb

- Lookup yang punya business error/permission: service/domain.
- Lookup static/reference deterministic: boleh mapper context.
- Lookup remote/slow/transactional: hindari mapper.
- Lookup yang memicu side effect: jangan di mapper.

---

## 29. Audit-Friendly Update Mapping

Dalam sistem enterprise, update harus bisa dijawab:

- field apa berubah?
- dari value apa ke value apa?
- siapa yang mengubah?
- kapan?
- melalui endpoint/operation apa?
- apakah perubahan dari user, system, migration, atau integration?
- apakah ada reason/comment?

Mapper langsung ke entity sering menghilangkan konteks ini.

### 29.1 Snapshot Before/After

Pattern sederhana:

```java
@Transactional
public User patch(Long id, PatchUserRequest request, Actor actor) {
    User user = repository.findById(id).orElseThrow();

    UserAuditSnapshot before = auditSnapshotMapper.toSnapshot(user);

    userPatchMapper.patch(request, user);
    user.setUpdatedBy(actor.id());
    user.setUpdatedAt(clock.instant());

    UserAuditSnapshot after = auditSnapshotMapper.toSnapshot(user);
    auditService.recordDiff("USER_PROFILE_PATCH", user.getId(), before, after, actor);

    return user;
}
```

### 29.2 Better: Operation-Aware Audit

Daripada diff generic saja:

```java
entity.changeDisplayName(newName, actor, reason);
```

Domain method dapat mencatat:

- operation name,
- business meaning,
- reason,
- actor,
- old value/new value.

MapStruct structural update cocok untuk low-risk field. Untuk high-risk field, gunakan operation-aware method.

---

## 30. Optimistic Locking dan Version Field

Entity sering punya field:

```java
@Version
private Long version;
```

Jangan map version sembarangan.

Ada dua pendekatan:

### 30.1 Version dari Path/Header, Bukan Body

Client mengirim `If-Match` header atau version parameter.

```http
PATCH /users/123
If-Match: "7"
```

Service membandingkan version.

### 30.2 Version di Request DTO

```java
public class PatchUserRequest {
    private Long version;
    private String displayName;
}
```

Tetapi mapper tetap harus ignore version untuk assignment:

```java
@Mapping(target = "version", ignore = true)
```

Service yang memeriksa:

```java
if (!Objects.equals(user.getVersion(), request.getVersion())) {
    throw new OptimisticLockException("Version mismatch");
}
```

Jangan:

```java
user.setVersion(request.getVersion());
```

Itu merusak optimistic locking.

---

## 31. Primitive Field Trap

DTO patch jangan gunakan primitive untuk optional field.

Buruk:

```java
public class PatchSettingsRequest {
    private boolean emailNotificationEnabled;
    private int maxItems;
}
```

Jika field tidak dikirim, Jackson menghasilkan default:

```java
false
0
```

Mapper tidak tahu apakah client mengirim false/0 atau field absent.

Lebih baik:

```java
public class PatchSettingsRequest {
    private Boolean emailNotificationEnabled;
    private Integer maxItems;
}
```

Namun ini tetap tidak membedakan absent vs explicit null. Tetapi minimal tidak memaksa default primitive.

Untuk patch serius, gunakan wrapper/presence tracking.

---

## 32. Enum Update Trap

Enum update punya beberapa risiko:

```java
public enum CasePriority {
    LOW,
    MEDIUM,
    HIGH
}
```

Request:

```java
private CasePriority priority;
```

Jika null ignore, absent/null tidak update.

Namun risiko lain:

- unknown enum gagal deserialization,
- enum baru dari client lama,
- lowercase/uppercase mismatch,
- empty string coercion,
- default enum fallback menyembunyikan invalid input,
- enum transition punya business rule.

Untuk field seperti status/priority, mapper langsung mungkin terlalu lemah.

Lebih aman:

```java
if (request.getPriority() != null) {
    caseEntity.changePriority(request.getPriority(), actor);
}
```

Untuk status state machine, jangan map langsung.

---

## 33. Date/Time Update Trap

Field waktu sering punya semantics khusus.

Contoh:

```java
private LocalDate dueDate;
private Instant submittedAt;
private Instant approvedAt;
```

Update due date mungkin allowed.

Update submittedAt/approvedAt biasanya tidak boleh dari client.

Mapper harus ignore:

```java
@Mapping(target = "submittedAt", ignore = true)
@Mapping(target = "approvedAt", ignore = true)
```

Due date update harus mempertimbangkan:

- timezone,
- business calendar,
- weekend/public holiday,
- SLA recalculation,
- escalation reset,
- audit reason.

Jika ada rule seperti ini, jangan sekadar map.

---

## 34. Money/Decimal Update Trap

Field uang/amount tidak boleh asal mapping.

```java
private BigDecimal amount;
private String currency;
```

Risiko:

- scale berbeda,
- rounding,
- negative value,
- currency mismatch,
- amount/currency atomicity,
- precision loss jika dari double,
- partial update amount tanpa currency.

Untuk field money, lebih baik value object:

```java
public class Money {
    private BigDecimal amount;
    private Currency currency;
}
```

Update:

```java
entity.changeFee(Money.of(request.getAmount(), request.getCurrency()), actor);
```

Bukan generic mapper langsung ke amount/currency secara terpisah jika ada invariant.

---

## 35. Generated Code Inspection

Setiap update mapper penting sebaiknya dicek generated code-nya.

Cari file seperti:

```text
target/generated-sources/annotations/.../UserMapperImpl.java
```

atau Gradle:

```text
build/generated/sources/annotationProcessor/java/main/...
```

Periksa:

- apakah null check sesuai?
- apakah field forbidden di-ignore?
- apakah nested object di-replace?
- apakah collection di-clear/diganti?
- apakah conversion method terpanggil?
- apakah builder/object factory digunakan?
- apakah MapStruct memanggil setter yang tidak diinginkan?

### 35.1 Contoh Generated Code yang Perlu Diwaspadai

```java
if (user.getRoles() != null) {
    List<Role> list = roleDtoListToRoleList(request.getRoles());
    if (list != null) {
        user.getRoles().clear();
        user.getRoles().addAll(list);
    }
}
```

Ini bisa menghapus relasi role existing.

Jika roles adalah security-critical field, mapping seperti ini tidak boleh terjadi.

---

## 36. Mapper Config untuk Update yang Lebih Aman

Contoh konfigurasi dasar:

```java
@MapperConfig(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR,
    unmappedSourcePolicy = ReportingPolicy.WARN,
    nullValueCheckStrategy = NullValueCheckStrategy.ALWAYS
)
public interface EnterpriseMapperConfig {
}
```

Mapper patch:

```java
@Mapper(config = EnterpriseMapperConfig.class)
public interface UserPatchMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "email", ignore = true)
    @Mapping(target = "role", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    @Mapping(target = "updatedBy", ignore = true)
    @Mapping(target = "version", ignore = true)
    void patch(PatchUserRequest request, @MappingTarget User user);
}
```

Catatan:

- `unmappedTargetPolicy = ERROR` memaksa keputusan eksplisit.
- `nullValueCheckStrategy = ALWAYS` membantu codegen defensif.
- `nullValuePropertyMappingStrategy` tetap di method karena semantics update berbeda-beda.

---

## 37. Testing Update Mapper

Update mapper harus dites dengan skenario khusus.

### 37.1 Test: Null Tidak Menghapus Existing Field

```java
@Test
void patch_shouldNotOverwriteExistingField_whenSourceFieldIsNull() {
    User user = new User();
    user.setDisplayName("Old");
    user.setPhone("123");

    PatchUserRequest request = new PatchUserRequest();
    request.setDisplayName("New");
    request.setPhone(null);

    mapper.patch(request, user);

    assertEquals("New", user.getDisplayName());
    assertEquals("123", user.getPhone());
}
```

### 37.2 Test: Forbidden Field Tidak Berubah

Jika DTO tidak punya forbidden field, test ini bisa di service/API layer. Jika DTO punya field karena shared legacy DTO, mapper test wajib.

```java
@Test
void patch_shouldNotChangeServerManagedFields() {
    User user = new User();
    user.setId(100L);
    user.setStatus("ACTIVE");
    user.setCreatedAt(Instant.parse("2024-01-01T00:00:00Z"));

    PatchUserRequest request = new PatchUserRequest();
    request.setDisplayName("New");

    mapper.patch(request, user);

    assertEquals(100L, user.getId());
    assertEquals("ACTIVE", user.getStatus());
    assertEquals(Instant.parse("2024-01-01T00:00:00Z"), user.getCreatedAt());
}
```

### 37.3 Test: Nested Object Partial Update

```java
@Test
void patch_shouldUpdateNestedAddressWithoutReplacingIt() {
    Address address = new Address();
    address.setCity("Old City");
    address.setPostalCode("111111");

    User user = new User();
    user.setAddress(address);

    PatchAddressRequest addressRequest = new PatchAddressRequest();
    addressRequest.setCity("New City");

    PatchUserRequest request = new PatchUserRequest();
    request.setAddress(addressRequest);

    mapper.patch(request, user);

    assertSame(address, user.getAddress());
    assertEquals("New City", user.getAddress().getCity());
    assertEquals("111111", user.getAddress().getPostalCode());
}
```

### 37.4 Test: Collection Tidak Terganti Diam-Diam

```java
@Test
void patch_shouldNotReplaceRoles() {
    User user = new User();
    user.setRoles(new ArrayList<>(List.of(new Role("USER"))));

    PatchUserRequest request = new PatchUserRequest();
    request.setDisplayName("New");

    mapper.patch(request, user);

    assertEquals(1, user.getRoles().size());
    assertEquals("USER", user.getRoles().get(0).getName());
}
```

### 37.5 Test: Generated Mapper Spring Wiring

Untuk mapper dengan `componentModel = "spring"`, minimal ada context test atau slice test untuk memastikan annotation processor dan bean registration berjalan.

Namun jangan terlalu banyak Spring test untuk mapper pure. Mapper unit test lebih cepat.

---

## 38. API-Level Test untuk Missing vs Null

Mapper unit test tidak cukup jika problem berasal dari JSON deserialization.

Test API/body parsing:

### 38.1 Missing Field

```json
{
  "displayName": "New"
}
```

Expected:

```text
phone unchanged
```

### 38.2 Explicit Null

```json
{
  "phone": null
}
```

Expected sesuai kontrak:

- unchanged,
- clear,
- or validation error.

Yang penting: harus eksplisit.

### 38.3 Unknown Field

```json
{
  "role": "ADMIN"
}
```

Expected untuk external API biasanya:

```text
400 Bad Request unknown field
```

Atau minimal field ignored dengan audit/security consideration.

---

## 39. Update Mapper Review Checklist

Sebelum approve mapper update, review pertanyaan ini.

### 39.1 Semantics

- Apakah method ini create, replace, patch, atau merge?
- Apakah null berarti ignore, clear, default, atau invalid?
- Apakah missing field bisa dibedakan dari explicit null?
- Apakah endpoint perlu field presence tracking?

### 39.2 Security

- Apakah DTO mengandung field yang tidak boleh diubah?
- Apakah mapper ignore field server-managed?
- Apakah role/status/permission field aman?
- Apakah over-posting dicegah?
- Apakah unknown field ditolak untuk external API?

### 39.3 Domain Correctness

- Apakah ada state transition?
- Apakah ada invariant lintas field?
- Apakah ada authorization per field?
- Apakah field butuh recalculation?
- Apakah field butuh audit reason?

### 39.4 Persistence

- Apakah entity managed oleh JPA?
- Apakah collection diganti/di-clear?
- Apakah nested object diganti?
- Apakah lazy relation tersentuh?
- Apakah version field aman?

### 39.5 Testing

- Ada test null ignore?
- Ada test forbidden field?
- Ada test nested field?
- Ada test collection?
- Ada test missing vs null di API layer?
- Ada compatibility test untuk payload lama?

---

## 40. Anti-Patterns

### 40.1 Satu DTO untuk Create, Update, Response

```java
public class UserDto {
    private Long id;
    private String email;
    private String role;
    private String status;
    private Instant createdAt;
    private Instant updatedAt;
}
```

Dipakai untuk semua:

```java
User create(UserDto dto);
void update(UserDto dto, @MappingTarget User user);
UserDto toDto(User user);
```

Masalah:

- over-posting,
- field forbidden bocor,
- required semantics kacau,
- patch semantics tidak jelas,
- response shape mengontrol input shape,
- backward compatibility sulit.

### 40.2 Global Null Ignore Tanpa Semantics

```java
@MapperConfig(nullValuePropertyMappingStrategy = IGNORE)
```

Dipakai semua mapper.

Masalah:

- replace operation tidak benar,
- clear field tidak bisa,
- invalid null bisa diam-diam diabaikan,
- bug tersembunyi.

### 40.3 Mapping Status Langsung

```java
caseEntity.setStatus(request.getStatus());
```

Masalah:

- state machine bypass,
- authorization bypass,
- audit reason hilang,
- downstream event salah.

### 40.4 Replace Collection Diam-Diam

```java
entity.setItems(mapItems(request.getItems()));
```

Masalah:

- orphan deletion,
- child identity hilang,
- audit kacau,
- partial update dianggap full replacement.

### 40.5 Mapper Mengakses Banyak Service

```java
@Mapper(componentModel = "spring", uses = {
    UserRepository.class,
    PermissionService.class,
    NotificationService.class,
    ExternalApiClient.class
})
```

Masalah:

- mapper menjadi service layer,
- sulit dites,
- side effect tersembunyi,
- transaction boundary kabur,
- performance tidak jelas.

---

## 41. Design Pattern: Patch Command sebagai Boundary Aman

Untuk domain penting, gunakan pipeline:

```text
JSON Request
    ↓
Request DTO / JsonNode
    ↓
Patch Command
    ↓
Domain Method Apply
    ↓
Entity State Change
    ↓
Audit/Event
```

Contoh command:

```java
public class PatchCaseCommand {
    private OptionalChange<String> title;
    private OptionalChange<LocalDate> dueDate;
    private OptionalChange<String> assigneeId;
}
```

Apply:

```java
public void apply(PatchCaseCommand command, Actor actor, BusinessCalendar calendar) {
    if (command.getTitle().isPresent()) {
        changeTitle(command.getTitle().getValue(), actor);
    }

    if (command.getDueDate().isPresent()) {
        reschedule(command.getDueDate().getValue(), actor, calendar);
    }

    if (command.getAssigneeId().isPresent()) {
        assignTo(command.getAssigneeId().getValue(), actor);
    }
}
```

MapStruct bisa membantu dari request DTO ke command, tetapi domain apply tetap eksplisit.

---

## 42. Design Pattern: Structural Patch Mapper untuk Low-Risk Aggregate Component

Untuk data low-risk seperti preferences:

```java
public class NotificationSettings {
    private Boolean emailEnabled;
    private Boolean smsEnabled;
    private String digestFrequency;
}
```

Mapper patch sederhana cukup:

```java
@Mapper(config = EnterpriseMapperConfig.class)
public interface NotificationSettingsMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    void patch(PatchNotificationSettingsRequest request,
               @MappingTarget NotificationSettings settings);
}
```

Dengan validasi:

```java
public class PatchNotificationSettingsRequest {
    private Boolean emailEnabled;
    private Boolean smsEnabled;

    @Pattern(regexp = "DAILY|WEEKLY|MONTHLY")
    private String digestFrequency;
}
```

Ini acceptable karena:

- field low risk,
- tidak ada state machine,
- null ignore sesuai semantics,
- DTO terbatas.

---

## 43. Design Pattern: Replace Mapper untuk Authoritative Sync

Integrasi eksternal authoritative source kadang membutuhkan null overwrite.

Contoh:

```text
External HR system adalah source of truth untuk employee profile.
Jika HR mengirim department null, internal juga harus null.
```

Mapper:

```java
@Mapper(config = EnterpriseMapperConfig.class)
public interface HrEmployeeSyncMapper {

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.SET_TO_NULL)
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    @Mapping(target = "updatedBy", ignore = true)
    void sync(HrEmployeePayload payload, @MappingTarget Employee employee);
}
```

Tetapi tetap hati-hati:

- payload source harus trusted,
- schema harus stabil,
- field authority jelas,
- audit source harus dicatat,
- unknown/missing behavior harus diuji.

---

## 44. Design Pattern: Two-Phase Update untuk Audit dan Validation

Untuk update kompleks:

```text
1. Parse request
2. Validate request shape
3. Build change set
4. Validate change set against current state
5. Apply change set
6. Record audit/event
```

Change set:

```java
public class UserProfileChangeSet {
    private final List<FieldChange<?>> changes = new ArrayList<>();

    public void add(String field, Object oldValue, Object newValue) {
        if (!Objects.equals(oldValue, newValue)) {
            changes.add(new FieldChange<>(field, oldValue, newValue));
        }
    }

    public boolean hasChanges() {
        return !changes.isEmpty();
    }
}
```

Apply:

```java
UserProfileChangeSet changeSet = changeSetBuilder.build(request, user);
policy.validate(changeSet, actor, user);
changeSetApplier.apply(changeSet, user);
audit.record(changeSet, actor);
```

MapStruct bisa membantu mapping simple values, tetapi perubahan domain tetap eksplisit.

---

## 45. MapStruct Update Mapping pada Java 8 sampai Java 25

### 45.1 Java 8

Umumnya memakai:

- mutable POJO,
- JavaBean getter/setter,
- Lombok optional,
- JPA entity mutable,
- DTO class biasa.

Update mapper paling natural dengan `@MappingTarget`.

### 45.2 Java 11/17

Mulai banyak codebase lebih strict:

- immutable DTO,
- constructor binding,
- modular runtime considerations,
- better testing stack,
- Spring Boot modern.

Update target entity tetap mutable, tetapi request DTO bisa immutable.

### 45.3 Java 16+

Records tersedia.

Patch DTO dengan records:

```java
public record PatchUserRequest(
    String displayName,
    String phone
) {}
```

Masalah tetap sama:

- null tidak membedakan absent vs explicit null,
- primitive tetap default issue jika dipakai,
- record cocok untuk immutable request shape, bukan otomatis solve patch semantics.

### 45.4 Java 21/25

Modern Java memberi:

- records stabil,
- sealed types,
- pattern matching ecosystem,
- better expressiveness,
- virtual threads untuk concurrency layer, tetapi bukan langsung mapping semantics.

Untuk update mapping, prinsip tetap:

- semantics eksplisit,
- field mutability dikontrol,
- domain method untuk invariant,
- MapStruct untuk generated structural mapping.

---

## 46. Latihan Desain

### 46.1 Latihan 1 — Profile Patch

Desain endpoint:

```http
PATCH /profiles/{id}
```

Field:

- displayName: optional update, blank invalid,
- phone: optional update, explicit clear allowed,
- email: tidak boleh diubah di endpoint ini,
- address: partial nested update,
- status: server-managed.

Tentukan:

- DTO shape,
- absent/null semantics,
- MapStruct method,
- field yang ignore,
- service logic,
- tests.

### 46.2 Latihan 2 — Case Assignment

Endpoint:

```http
PATCH /cases/{id}/assignment
```

Field:

- assigneeId,
- teamId,
- reason.

Rule:

- assignee harus anggota team,
- case status harus assignable,
- reason wajib jika reassignment,
- audit wajib.

Pertanyaan:

- apakah MapStruct update entity langsung boleh?
- apa bentuk command?
- mana yang mapper lakukan?
- mana yang domain/service lakukan?

Jawaban yang baik: MapStruct tidak langsung mengubah entity assignment. Ia boleh map request ke command. Domain/service melakukan validation dan apply.

### 46.3 Latihan 3 — External HR Sync

Payload HR:

```json
{
  "employeeNo": "E001",
  "name": "Fajar",
  "department": null,
  "active": true
}
```

HR adalah source of truth.

Pertanyaan:

- apakah null department harus ignore atau set null?
- field mana authoritative?
- bagaimana audit source dicatat?
- bagaimana jika payload missing department?
- apakah sync mapper sama dengan patch mapper user?

Jawaban yang baik: sync mapper berbeda dari patch mapper. Null dari authoritative source bisa berarti set null, tetapi missing field harus didefinisikan berdasarkan contract HR.

---

## 47. Production Checklist

Untuk update mapper MapStruct production-grade:

- [ ] Method name menyatakan semantics: `create`, `replace`, `patch`, `sync`, atau `merge`.
- [ ] DTO tidak reuse sembarangan.
- [ ] `@MappingTarget` hanya dipakai ketika mutation existing target memang diinginkan.
- [ ] Null semantics tertulis jelas.
- [ ] `NullValuePropertyMappingStrategy` dipilih per method.
- [ ] Field server-managed di-ignore eksplisit.
- [ ] Field security-sensitive tidak ada di DTO atau di-ignore.
- [ ] `unmappedTargetPolicy = ERROR` dipakai untuk mapper penting.
- [ ] Collection update tidak mengganti data diam-diam.
- [ ] Nested object update semantics jelas.
- [ ] Domain invariant tidak dilewati mapper.
- [ ] State transition tidak dimap langsung.
- [ ] Version field tidak diassign dari request.
- [ ] Primitive tidak dipakai untuk optional patch field.
- [ ] Generated code pernah diperiksa.
- [ ] Unit test mencakup null/missing/forbidden/nested/collection.
- [ ] API test mencakup absent vs explicit null.
- [ ] Audit behavior jelas.
- [ ] Unknown field policy jelas.

---

## 48. Ringkasan Mental Model

Update mapping adalah tempat di mana banyak bug enterprise lahir karena engineer menganggap mapping sebagai operasi mekanis.

Padahal update mapping harus menjawab:

```text
Apa arti request ini terhadap state existing?
```

MapStruct memberi alat:

- `@MappingTarget` untuk update existing object,
- `NullValuePropertyMappingStrategy` untuk property null behavior,
- `@BeanMapping` untuk per-method config,
- `@Mapping(ignore = true)` untuk field protection,
- `@Condition` untuk conditional assignment,
- `@Context` untuk dependency/context,
- lifecycle hook untuk advanced control.

Namun MapStruct tidak bisa menggantikan desain semantics.

Prinsip utamanya:

1. Bedakan create, replace, patch, merge, sync.
2. Jangan samakan absent, null, empty, default.
3. Jangan update field sensitif lewat mapper generic.
4. Jangan replace collection/nested object tanpa semantics eksplisit.
5. Gunakan domain method untuk invariant dan state transition.
6. Gunakan compiler sebagai reviewer dengan strict unmapped policy.
7. Test update mapper dengan skenario negatif, bukan hanya happy path.

Seorang engineer top-level tidak hanya bisa membuat mapper bekerja. Ia bisa menjelaskan apa yang **tidak boleh** dimap, kenapa, dan bagaimana mencegah future engineer merusak semantics tersebut tanpa sadar.

---

## 49. Koneksi ke Part Berikutnya

Part ini membahas update mapping: PATCH, merge, null strategy, `@MappingTarget`, JPA dirty checking, dan audit-friendly update.

Part berikutnya akan masuk ke fitur advanced MapStruct yang memperluas kemampuan mapper:

- qualifier,
- `@Named`,
- custom mapping method,
- `@Context`,
- lifecycle hook,
- `@BeforeMapping`,
- `@AfterMapping`,
- `@ObjectFactory`,
- dependency injection,
- menghindari mapper-service circular logic.

Dengan kata lain, Part 20 menjawab:

> Bagaimana mengupdate existing object dengan aman?

Part 21 akan menjawab:

> Bagaimana menyusun mapper kompleks yang membutuhkan policy, context, dan lifecycle control tanpa berubah menjadi service layer tersembunyi?
