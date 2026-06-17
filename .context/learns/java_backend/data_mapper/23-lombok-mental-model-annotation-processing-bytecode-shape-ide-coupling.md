# Part 23 — Lombok Mental Model: Annotation Processing, Bytecode Shape, IDE Coupling

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `23-lombok-mental-model-annotation-processing-bytecode-shape-ide-coupling.md`  
> Posisi: Part 23 dari 35  
> Fokus: memahami Lombok sebagai compiler/IDE transformation tool, bukan sekadar penghapus boilerplate.

---

## 1. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas MapStruct sebagai compile-time mapper yang menghasilkan implementation class. Sekarang kita masuk ke Lombok.

Banyak engineer mengenal Lombok dari permukaan:

```java
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserDto {
    private String id;
    private String name;
}
```

Lalu menyimpulkan:

> Lombok hanya mengurangi boilerplate.

Kesimpulan itu tidak salah, tetapi terlalu dangkal. Untuk engineer senior/top-level, Lombok harus dipahami sebagai alat yang memengaruhi:

1. bentuk source code yang dibaca manusia,
2. bentuk symbol yang dilihat compiler,
3. bentuk method/constructor yang dilihat framework,
4. bentuk bytecode yang berjalan di runtime,
5. pengalaman IDE,
6. urutan annotation processing,
7. kompatibilitas JDK,
8. strategi migrasi ke Java modern seperti records.

Dengan kata lain, Lombok adalah bagian dari **build-time transformation layer**.

Mental model utamanya:

> Lombok membuat source code terlihat lebih kecil, tetapi model program yang sebenarnya menjadi lebih besar daripada yang tampak di file `.java`.

Itu produktif jika disiplin. Itu berbahaya jika tim lupa bahwa ada code yang tidak terlihat.

---

## 2. Apa Sebenarnya Lombok?

Lombok adalah library Java yang masuk ke editor dan build tools untuk menghasilkan/memberi efek pada code seperti getter, setter, constructor, builder, logger, `equals`, `hashCode`, `toString`, dan lain-lain.

Secara praktis, Lombok bekerja di fase kompilasi/IDE. Dalam build Maven/Gradle biasa, Lombok berada di compile-time path sebagai annotation processor. Dokumentasi Lombok menyatakan bahwa dengan `javac`, Maven, Gradle, dan banyak build system lain, Lombok berjalan sebagai annotation processor.

Namun Lombok berbeda dari annotation processor biasa.

Annotation processor normal biasanya:

- membaca annotation,
- menghasilkan file source baru,
- tidak mengubah class yang sedang dikompilasi secara langsung.

Lombok melakukan sesuatu yang lebih agresif:

- membaca annotation Lombok,
- memodifikasi representasi internal compiler/AST,
- menambahkan method/constructor/field/logical behavior ke class yang sedang dikompilasi,
- membuat compiler melihat member yang tidak tertulis di source.

Karena itu, Lombok membutuhkan integrasi mendalam dengan compiler dan IDE.

---

## 3. Lombok Bukan Runtime Library Utama

Salah satu miskonsepsi umum:

> Kalau aplikasi pakai Lombok, berarti Lombok harus ada di runtime.

Biasanya tidak.

Dalam konfigurasi Maven resmi, Lombok dipakai sebagai dependency yang dibutuhkan saat compile, tetapi tidak dibutuhkan saat runtime/deploy. Dalam Maven, ini biasanya memakai scope `provided`.

Contoh:

```xml
<dependency>
    <groupId>org.projectlombok</groupId>
    <artifactId>lombok</artifactId>
    <version>1.18.40</version>
    <scope>provided</scope>
</dependency>
```

Dalam Gradle:

```gradle
dependencies {
    compileOnly 'org.projectlombok:lombok:1.18.40'
    annotationProcessor 'org.projectlombok:lombok:1.18.40'

    testCompileOnly 'org.projectlombok:lombok:1.18.40'
    testAnnotationProcessor 'org.projectlombok:lombok:1.18.40'
}
```

Maknanya:

- source code memakai annotation Lombok,
- compiler memproses annotation itu,
- bytecode hasil kompilasi sudah berisi method/constructor/generated member,
- runtime tidak perlu Lombok untuk menjalankan getter/setter/builder yang sudah menjadi bytecode.

Pengecualian bisa muncul untuk annotation tertentu atau tooling tertentu, tetapi prinsip arsitekturalnya: **Lombok adalah compile-time tool**.

---

## 4. Source Shape vs Bytecode Shape

Ini konsep paling penting.

Source shape:

```java
@Getter
@RequiredArgsConstructor
public class AccountView {
    private final String id;
    private final String displayName;
}
```

Yang manusia lihat:

- dua field,
- dua annotation.

Yang compiler/runtime lihat setelah Lombok:

```java
public class AccountView {
    private final String id;
    private final String displayName;

    public AccountView(String id, String displayName) {
        this.id = id;
        this.displayName = displayName;
    }

    public String getId() {
        return this.id;
    }

    public String getDisplayName() {
        return this.displayName;
    }
}
```

Konsekuensinya:

- Jackson bisa melihat getter/constructor tertentu,
- MapStruct bisa melihat accessor tertentu,
- Spring bisa melakukan constructor injection,
- reflection bisa menemukan method yang tidak tertulis eksplisit,
- IDE harus paham Lombok agar tidak memberi error palsu,
- reviewer harus membayangkan generated code.

Dalam code review, Lombok membuat pertanyaan berubah dari:

> Apakah method ini benar?

menjadi:

> Method apa saja yang sebenarnya akan ada setelah Lombok memproses class ini?

---

## 5. Annotation Processing Mental Model

Siklus compile sederhana:

```text
.java source
   |
   v
parse source
   |
   v
annotation processing
   |
   v
compiler symbol/type analysis
   |
   v
bytecode generation
   |
   v
.class file
```

Dalam proyek tanpa Lombok, source code yang kamu baca relatif dekat dengan member yang compiler lihat.

Dalam proyek dengan Lombok:

```text
.java source with @Getter/@Builder/@Value
   |
   v
Lombok annotation processing / compiler integration
   |
   v
compiler sees additional methods/constructors/builders
   |
   v
.class file contains generated members
```

Masalah muncul saat tools tidak sepakat tentang shape class:

```text
IDE sees source only          -> method seems missing
javac with Lombok sees method -> compile succeeds

atau sebaliknya:

IDE plugin sees Lombok        -> editor looks fine
Maven annotation processor off -> compile fails
```

Karena itu, Lombok problem sering terasa “aneh”: code tampak benar di IDE tetapi gagal di CI, atau sebaliknya.

---

## 6. IDE Coupling

Lombok membutuhkan dukungan IDE/language server.

Tanpa dukungan Lombok, IDE bisa gagal mengenali:

- generated getter,
- generated setter,
- generated constructor,
- generated builder,
- generated logger field,
- generated `equals/hashCode`,
- generated `toString`.

Contoh:

```java
@Getter
public class UserDto {
    private String name;
}

class Demo {
    void run(UserDto dto) {
        dto.getName(); // IDE tanpa Lombok support bisa menganggap ini error
    }
}
```

Pada level build, compiler mungkin tetap berhasil. Pada level IDE, developer terganggu.

Dalam tim besar, ini bukan detail kecil. Ini memengaruhi:

- onboarding,
- code navigation,
- refactoring,
- auto-complete,
- static analysis,
- debugging,
- CI consistency.

Rule praktis:

> Jangan memperkenalkan Lombok sebagai preference individual. Lombok harus menjadi keputusan team-level/build-level.

Checklist minimal:

- Maven/Gradle annotation processor sudah benar,
- IDE setup terdokumentasi,
- CI memakai versi JDK dan Lombok yang compatible,
- `lombok.config` disimpan di repo,
- aturan annotation yang boleh/dilarang disepakati.

---

## 7. JDK Coupling dan Upgrade Risk

Lombok mengikuti perubahan internal compiler/JDK. Karena Lombok terintegrasi dalam compile process dan AST/compiler internals, upgrade JDK bisa berdampak pada Lombok.

Contoh real-world: changelog Lombok mencatat dukungan JDK 25 pada rilis Lombok tertentu. Ini menunjukkan pola penting:

> Saat upgrade JDK, Lombok bukan dependency pasif. Lombok harus ikut diverifikasi.

Untuk project Java 8 sampai Java 25, risiko ini nyata karena codebase enterprise sering memiliki campuran:

- Java 8 legacy service,
- Java 11/17 transitional service,
- Java 21 LTS service,
- target Java 25 modern service.

Upgrade checklist:

```text
[ ] JDK target version berubah?
[ ] Lombok version sudah support JDK tersebut?
[ ] IDE/language server support Lombok version tersebut?
[ ] Maven/Gradle compiler plugin annotation processor config masih valid?
[ ] MapStruct + Lombok integration masih valid?
[ ] CI build memakai JDK yang sama dengan local dev?
[ ] delombok/javadoc/static-analysis pipeline masih jalan?
```

Untuk engineer senior, jangan hanya bertanya:

> Apakah project compile?

Tanya juga:

> Apakah seluruh toolchain melihat shape class yang sama?

---

## 8. Delombok: Melihat Bentuk Code yang Sebenarnya

Lombok menyediakan `delombok`, yaitu proses menyalin source file ke directory lain dan mengganti annotation Lombok dengan code Java hasil transformasi.

Mental model:

```text
Lombok source
   |
   v
Delombok
   |
   v
Plain Java source without Lombok annotations
```

Gunanya:

1. memahami generated code,
2. debugging behavior aneh,
3. menghasilkan source untuk tool yang tidak paham Lombok,
4. migrasi keluar dari Lombok,
5. audit/review code tertentu,
6. training developer junior.

Contoh source:

```java
@Getter
@Setter
@ToString
public class PersonDto {
    private String id;
    private String name;
}
```

Bentuk delombok kira-kira:

```java
public class PersonDto {
    private String id;
    private String name;

    public String getId() {
        return this.id;
    }

    public String getName() {
        return this.name;
    }

    public void setId(String id) {
        this.id = id;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String toString() {
        return "PersonDto(id=" + this.getId() + ", name=" + this.getName() + ")";
    }
}
```

Perhatikan `toString()` memanggil getter. Itu detail penting jika getter punya logic, lazy loading, proxy, atau side effect.

Rule:

> Jika annotation Lombok menghasilkan behavior yang memengaruhi correctness/security/performance, engineer harus bisa memprediksi delombok output-nya.

---

## 9. Lombok dan Reflection-Based Frameworks

Framework seperti Jackson, Spring, Jakarta Bean Validation, JPA, MapStruct, dan banyak library lain sering bergantung pada bentuk class:

- field,
- getter,
- setter,
- constructor,
- annotation,
- access modifier,
- parameter name,
- builder method,
- no-args constructor.

Lombok mengubah bentuk itu.

Contoh DTO:

```java
@Getter
@Builder
public class CreateUserRequest {
    private final String username;
    private final String email;
}
```

Pertanyaan framework-level:

- Apakah Jackson bisa deserialize object ini?
- Apakah ada constructor yang bisa dipakai?
- Apakah builder dikenali Jackson?
- Apakah field final bisa diisi?
- Apakah perlu `@Jacksonized`?
- Apakah MapStruct bisa membuat object target ini?
- Apakah Bean Validation membaca field atau getter?

Lombok tidak bisa dinilai sendiri. Lombok harus dinilai bersama framework yang akan membaca class tersebut.

---

## 10. Lombok dan Jackson: Shape Matters

Jackson bisa bekerja melalui beberapa jalur:

- field visibility,
- getter/setter,
- constructor binding,
- record canonical constructor,
- builder deserialization,
- custom serializer/deserializer.

Lombok bisa menghasilkan getter, setter, constructor, atau builder. Jadi Lombok memengaruhi cara Jackson memahami object.

### 10.1 Mutable DTO dengan No-Args Constructor

```java
@Getter
@Setter
@NoArgsConstructor
public class UserRequest {
    private String username;
    private String email;
}
```

Jackson mudah deserialize:

```text
instantiate no-args constructor
set username
set email
```

Kelebihan:

- sederhana,
- compatible dengan banyak framework lama,
- mudah untuk Java 8.

Kekurangan:

- object bisa berada dalam state tidak valid,
- semua field mutable,
- over-posting lebih mudah jika DTO terlalu lebar,
- invariant tidak terjaga di constructor.

### 10.2 Immutable DTO dengan Constructor

```java
@Getter
@AllArgsConstructor
public class UserRequest {
    private final String username;
    private final String email;
}
```

Lebih aman secara immutability, tetapi deserialization perlu dipastikan:

- apakah Jackson mengetahui nama parameter constructor?
- apakah ada `@JsonCreator`/`@JsonProperty`?
- apakah compile dengan `-parameters`?

### 10.3 Builder DTO

```java
@Getter
@Builder
public class UserRequest {
    private final String username;
    private final String email;
}
```

Builder enak untuk konstruksi manual, tetapi Jackson tidak otomatis selalu tahu bahwa builder itu harus dipakai. Lombok menyediakan `@Jacksonized` untuk integrasi builder Lombok dengan Jackson.

Contoh:

```java
@Getter
@Builder
@Jacksonized
public class UserRequest {
    private final String username;
    private final String email;
}
```

Rule:

> Jangan berasumsi `@Builder` otomatis berarti JSON bisa deserialize. Test inbound JSON selalu wajib.

---

## 11. Lombok dan MapStruct: Generated Code Bertemu Generated Code

MapStruct membaca model Java saat compile dan menghasilkan mapper implementation. Lombok juga memodifikasi/menambahkan member saat compile.

Artinya:

```text
Lombok-generated getters/builders/constructors
        |
        v
MapStruct observes Java model
        |
        v
MapStruct generates mapper implementation
```

Jika urutan/konfigurasi annotation processor tidak benar, MapStruct bisa tidak melihat accessor/builder yang Lombok hasilkan.

Contoh masalah:

```java
@Getter
@Builder
public class UserDto {
    private String id;
    private String name;
}
```

```java
@Mapper
public interface UserMapper {
    UserDto toDto(User source);
}
```

MapStruct perlu tahu cara membuat `UserDto`:

- via constructor?
- via setter?
- via builder?

Jika Lombok builder tidak terbaca, mapping bisa gagal.

Untuk integrasi modern, sering digunakan dependency tambahan:

```gradle
annotationProcessor 'org.projectlombok:lombok-mapstruct-binding:0.2.0'
```

atau konfigurasi Maven annotation processor path yang eksplisit.

Rule:

> Jika memakai Lombok + MapStruct, treat keduanya sebagai satu unit build pipeline. Jangan debug mapper tanpa memeriksa annotation processor configuration.

---

## 12. Bytecode Shape dan Debugging

Ketika Lombok menghasilkan method, method tersebut ada di bytecode.

Tools yang bisa membantu:

```bash
javap -classpath target/classes -p com.example.UserDto
```

Output akan menunjukkan method/constructor yang sebenarnya ada.

Contoh:

```text
public class com.example.UserDto {
  private java.lang.String id;
  private java.lang.String name;
  public java.lang.String getId();
  public java.lang.String getName();
  public void setId(java.lang.String);
  public void setName(java.lang.String);
}
```

Untuk kasus sulit:

- gunakan `delombok`,
- lihat generated MapStruct implementation,
- gunakan `javap`,
- cek dependency tree,
- cek annotation processor path,
- cek versi JDK,
- cek CI vs local JDK.

Debugging Lombok harus berpikir dalam tiga bentuk:

```text
1. Source yang manusia baca
2. Source/AST yang compiler proses setelah Lombok
3. Bytecode yang runtime jalankan
```

---

## 13. Lombok Config: Governance di Level Repository

Lombok mendukung file `lombok.config`.

Contoh:

```properties
config.stopBubbling = true

lombok.addLombokGeneratedAnnotation = true
lombok.anyConstructor.addConstructorProperties = true

lombok.data.flagUsage = warning
lombok.value.flagUsage = warning
lombok.builder.flagUsage = warning
```

Fungsi `lombok.config`:

- membuat aturan Lombok eksplisit,
- mengurangi variasi antar module,
- membantu static analysis mengenali generated code,
- mencegah annotation tertentu dipakai sembarangan,
- menjaga style tim.

Untuk enterprise codebase, tanpa `lombok.config`, Lombok mudah menjadi selera personal.

Rule:

> Jika Lombok dipakai di banyak module, wajib ada policy repository-level.

---

## 14. Annotation Granularity: Jangan Pakai Lombok Terlalu Lebar

Lombok annotation memiliki level risiko berbeda.

### Lebih aman / umum

```java
@Getter
@RequiredArgsConstructor
@Slf4j
```

Biasanya relatif aman karena behavior-nya mudah diprediksi.

### Perlu disiplin

```java
@Setter
@Builder
@ToString
@EqualsAndHashCode
@NoArgsConstructor
@AllArgsConstructor
```

Bisa aman, tetapi tergantung konteks object.

### Sering terlalu lebar

```java
@Data
```

`@Data` kira-kira menggabungkan:

- getter,
- setter,
- required args constructor,
- `toString`,
- `equals`,
- `hashCode`.

Masalahnya: kamu mungkin hanya butuh getter, tetapi mendapatkan setter, equals/hashCode, dan toString sekaligus.

Contoh buruk:

```java
@Data
public class CaseEntity {
    private Long id;
    private String caseNo;
    private List<DocumentEntity> documents;
}
```

Risiko:

- setter membuka mutability luas,
- `toString()` bisa traverse relationship besar,
- `equals/hashCode()` bisa salah untuk entity,
- sensitive field bisa tercetak,
- lazy proxy bisa ter-trigger,
- cyclic relationship bisa stack overflow.

Rule:

> Prefer annotation kecil dan eksplisit. Hindari annotation yang menghasilkan terlalu banyak behavior tanpa review.

---

## 15. Lombok pada DTO vs Entity vs Domain Model

### 15.1 DTO

Lombok cukup cocok untuk DTO, terutama:

```java
@Getter
@Builder
public class UserResponse {
    private final String id;
    private final String displayName;
}
```

DTO biasanya boundary object, bukan pemilik invariant domain terdalam.

Namun tetap hati-hati:

- response DTO jangan leak sensitive field,
- request DTO jangan terlalu mutable/lebar,
- builder DTO perlu diuji dengan Jackson,
- `@Data` bisa terlalu banyak.

### 15.2 JPA Entity

Lombok lebih berbahaya pada entity.

Contoh rawan:

```java
@Data
@Entity
public class OrderEntity {
    @Id
    private Long id;

    @OneToMany(mappedBy = "order")
    private List<OrderLineEntity> lines;
}
```

Masalah:

- `equals/hashCode` pada entity sulit,
- lazy relation bisa terakses oleh `toString`,
- bidirectional relation bisa cycle,
- setter semua field membuka state mutation liar,
- constructor Lombok bisa bentrok dengan requirement JPA.

Lebih aman:

```java
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
public class OrderEntity {
    @Id
    private Long id;

    private String orderNo;

    protected OrderEntity() {
        // for JPA
    }

    public void renameOrderNo(String newOrderNo) {
        this.orderNo = normalizeOrderNo(newOrderNo);
    }
}
```

Kalau tetap memakai Lombok:

```java
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@ToString(onlyExplicitlyIncluded = true)
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
@Entity
public class OrderEntity {
    @Id
    @EqualsAndHashCode.Include
    @ToString.Include
    private Long id;

    @ToString.Include
    private String orderNo;

    @OneToMany(mappedBy = "order")
    @ToString.Exclude
    private List<OrderLineEntity> lines = new ArrayList<>();
}
```

Tetap perlu domain reasoning. Lombok tidak menyelesaikan identity model entity.

### 15.3 Domain Model

Pada domain model kaya behavior, Lombok harus sangat selektif.

Buruk:

```java
@Data
public class CaseAggregate {
    private CaseStatus status;
    private List<CaseAction> actions;
}
```

Ini membuat semua state bisa diubah tanpa melewati invariant.

Lebih baik:

```java
@Getter
public class CaseAggregate {
    private CaseStatus status;
    private final List<CaseAction> actions = new ArrayList<>();

    public void escalate(EscalationReason reason) {
        if (!status.canEscalate()) {
            throw new IllegalStateException("Case cannot be escalated from " + status);
        }
        this.status = CaseStatus.ESCALATED;
        this.actions.add(CaseAction.escalated(reason));
    }
}
```

Rule:

> Lombok boleh mengurangi boilerplate, tetapi tidak boleh menghapus friction yang sengaja dipasang untuk menjaga invariant.

---

## 16. Lombok dan `equals/hashCode`: Area Risiko Tinggi

`equals` dan `hashCode` bukan boilerplate biasa. Mereka menentukan identity semantics.

Untuk value object:

```java
@Value
public class Money {
    BigDecimal amount;
    String currency;
}
```

Ini masuk akal karena identity berdasarkan semua field.

Untuk entity:

```java
@EqualsAndHashCode
@Entity
public class UserEntity {
    @Id
    private Long id;
    private String email;
}
```

Ini rawan karena entity punya lifecycle:

- sebelum persist `id == null`,
- setelah persist `id != null`,
- proxy subclass mungkin terlibat,
- mutable field bisa berubah saat object ada di `HashSet`,
- equality by all fields bisa salah.

Rule:

> Untuk entity, jangan generate equals/hashCode secara otomatis tanpa identity policy eksplisit.

Pertanyaan review:

```text
[ ] Object ini value object atau entity?
[ ] Identity berdasarkan field apa?
[ ] Field yang dipakai immutable?
[ ] Object bisa masuk HashSet/HashMap?
[ ] Ada proxy/lazy loading?
[ ] Ada inheritance?
```

---

## 17. Lombok dan `toString`: Data Leakage dan Lazy Loading

`toString()` terlihat harmless, tetapi di production bisa berbahaya.

Contoh:

```java
@Data
public class UserAccount {
    private String username;
    private String passwordHash;
    private String resetToken;
}
```

`@Data` menghasilkan `toString()` yang bisa mencetak semua field.

Risiko:

- password hash masuk log,
- token masuk log,
- PII bocor,
- audit/regulatory issue,
- lazy relationship ter-load,
- cyclic graph stack overflow.

Lebih aman:

```java
@Getter
@ToString(onlyExplicitlyIncluded = true)
public class UserAccount {
    @ToString.Include
    private String username;

    @ToString.Exclude
    private String passwordHash;

    @ToString.Exclude
    private String resetToken;
}
```

Rule:

> Di boundary object yang berisi PII/security data, `toString()` harus allowlist, bukan default include-all.

---

## 18. Lombok dan Builder: Productivity with Semantic Cost

Builder sering dianggap selalu bagus.

```java
@Builder
@Getter
public class CreateCaseCommand {
    private final String applicantId;
    private final String caseType;
    private final String description;
}
```

Kelebihan:

- readable object construction,
- cocok untuk banyak optional field,
- enak untuk tests,
- cocok untuk immutable object.

Namun builder juga punya risiko:

1. tidak menjamin required field kecuali didesain,
2. bisa melewati constructor/factory invariant jika salah pakai,
3. default value butuh `@Builder.Default`,
4. collection mutability perlu dijaga,
5. Jackson integration perlu konfigurasi,
6. MapStruct integration perlu jelas.

Contoh jebakan default:

```java
@Builder
@Getter
public class SearchRequest {
    private int page = 1;
    private int size = 20;
}
```

Dengan Lombok builder, default initializer bisa tidak berlaku seperti yang diharapkan kecuali memakai:

```java
@Builder
@Getter
public class SearchRequest {
    @Builder.Default
    private int page = 1;

    @Builder.Default
    private int size = 20;
}
```

Rule:

> Builder memperbaiki readability konstruksi, bukan otomatis memperbaiki validity object.

---

## 19. `@Value` vs Java Records

Sebelum records, Lombok `@Value` sangat populer untuk immutable value class.

```java
@Value
public class UserView {
    String id;
    String displayName;
}
```

Generated kira-kira:

- private final fields,
- all-args constructor,
- getters,
- equals/hashCode,
- toString.

Di Java 16+, records memberi fitur bahasa native:

```java
public record UserView(String id, String displayName) {}
```

Perbandingan:

| Aspek | Lombok `@Value` | Java record |
|---|---|---|
| Butuh Lombok | Ya | Tidak |
| Native Java language | Tidak | Ya |
| Generated by compiler | Via Lombok | Via Java compiler |
| Accessor naming | `getId()` | `id()` |
| Mutability | Immutable-ish | Shallow immutable |
| Framework compatibility lama | Kadang lebih familiar | Perlu library modern |
| Java 8 support | Ya | Tidak |
| Migration future | Bisa jadi stepping stone | Lebih modern |

Rule untuk Java 8-11 legacy:

> Lombok `@Value` masih masuk akal untuk immutable DTO/value object.

Rule untuk Java 17/21/25 modern:

> Pertimbangkan records untuk DTO/value carrier baru, kecuali ada alasan framework/API compatibility yang kuat.

Namun jangan fanatik. Records punya trade-off:

- accessor bukan `getX`,
- inheritance terbatas,
- semua component bagian dari API constructor,
- binary/source compatibility perlu dipikirkan,
- JPA entity tidak cocok sebagai record biasa.

---

## 20. Lombok dan API Compatibility

Generated code adalah bagian dari public API class.

Contoh:

```java
@Getter
public class UserDto {
    private String id;
}
```

Public API class ini memiliki method:

```java
public String getId()
```

Jika kamu mengubah field:

```java
private String userId;
```

Maka generated method berubah:

```java
public String getUserId()
```

Untuk internal code mungkin compile error. Untuk external binary/library consumer, ini bisa breaking change.

Jika class dipakai sebagai library contract, Lombok tidak mengurangi kewajiban compatibility.

Checklist:

```text
[ ] Apakah class ini public API?
[ ] Apakah generated getter/setter bagian dari contract?
[ ] Apakah rename field akan rename method?
[ ] Apakah JSON property ikut berubah?
[ ] Apakah MapStruct mapping ikut berubah?
[ ] Apakah OpenAPI/schema ikut berubah?
```

Rule:

> Field rename pada Lombok class sering berarti method/API/property rename. Jangan treat sebagai internal refactor jika class adalah boundary contract.

---

## 21. Lombok dalam Multi-Module Enterprise Build

Di multi-module project, Lombok problem sering muncul karena module A dan B punya setup berbeda.

Contoh struktur:

```text
project-root
  common-dto
  case-service
  integration-client
  batch-job
  reporting
```

Risiko:

- `common-dto` pakai Lombok tapi consumer module tidak punya processor config,
- generated source tidak terlihat oleh javadoc/static analysis,
- module Java 8 dan Java 21 memakai versi Lombok sama tapi JDK berbeda,
- MapStruct ada di module tertentu tapi Lombok binding tidak konsisten,
- IDE import project tidak mengaktifkan annotation processing semua module.

Strategi:

1. definisikan Lombok version di parent/platform,
2. gunakan convention plugin Gradle atau parent POM Maven,
3. simpan `lombok.config` di root,
4. gunakan CI sebagai source of truth,
5. sediakan command verifikasi:

```bash
./gradlew clean compileJava compileTestJava
```

atau:

```bash
mvn -U clean verify
```

6. tambahkan module sample/test untuk Lombok + MapStruct jika keduanya dipakai.

---

## 22. Lombok Failure Modes

### 22.1 Compile Works Locally, Fails in CI

Kemungkinan:

- CI annotation processor path tidak benar,
- versi JDK berbeda,
- versi Lombok tidak support JDK CI,
- Maven/Gradle config berbeda,
- incremental compile menyembunyikan masalah lokal.

### 22.2 IDE Error, Build Succeeds

Kemungkinan:

- IDE plugin missing/outdated,
- language server tidak memuat Lombok,
- annotation processing disabled di IDE,
- project import salah.

### 22.3 Jackson Cannot Deserialize Lombok DTO

Kemungkinan:

- hanya ada builder tanpa `@Jacksonized`,
- tidak ada no-args constructor,
- constructor parameter names tidak tersedia,
- final fields tanpa creator,
- visibility mismatch.

### 22.4 MapStruct Cannot Find Property

Kemungkinan:

- Lombok belum diproses saat MapStruct membaca model,
- missing `lombok-mapstruct-binding`,
- accessor naming custom,
- boolean getter naming ambiguity,
- builder detection mismatch.

### 22.5 `toString()` Causes Incident

Kemungkinan:

- `@Data` mencetak sensitive field,
- relation besar/lazy diakses,
- cyclic graph,
- log payload terlalu besar.

### 22.6 Equals/HashCode Breaks Collection Behavior

Kemungkinan:

- mutable fields digunakan di hashCode,
- entity id berubah setelah persist,
- lazy/proxy field ikut dihitung,
- inheritance equality salah.

---

## 23. Decision Matrix: Kapan Lombok Cocok?

| Context | Lombok cocok? | Catatan |
|---|---:|---|
| Java 8 DTO sederhana | Ya | Mengurangi boilerplate signifikan |
| Java 21/25 DTO baru | Mungkin | Records bisa lebih tepat |
| JPA entity | Hati-hati | Hindari `@Data`; selective only |
| Domain aggregate kaya invariant | Sangat hati-hati | Jangan generate setter luas |
| Test fixture object | Ya | Builder bisa sangat produktif |
| Public library API | Hati-hati | Generated methods bagian dari API |
| Security-sensitive object | Hati-hati | `toString`, setter, field exposure |
| MapStruct target/source | Ya, dengan setup benar | Perhatikan annotation processor binding |
| Jackson immutable DTO | Ya, dengan config | Perlu constructor/builder strategy jelas |
| Large regulated codebase | Ya, jika governed | Wajib policy + review checklist |

---

## 24. Recommended Lombok Policy untuk Enterprise Java

Policy yang sehat biasanya bukan “pakai Lombok semua” atau “larang Lombok semua”. Yang sehat adalah: pakai dengan batas.

Contoh policy:

### Allowed by default

```text
@Getter
@RequiredArgsConstructor
@Slf4j
```

### Allowed with review

```text
@Setter
@Builder
@SuperBuilder
@Value
@With
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
@ToString
```

### Discouraged / require strong reason

```text
@Data
@SneakyThrows
@Cleanup
@EqualsAndHashCode(callSuper = true) without explicit inheritance policy
@ToString on entity without onlyExplicitlyIncluded
@Setter on domain aggregate
```

### For JPA entities

```text
Allowed:
- @Getter
- @NoArgsConstructor(access = PROTECTED)
- @ToString(onlyExplicitlyIncluded = true)
- @EqualsAndHashCode(onlyExplicitlyIncluded = true) only with explicit identity policy

Avoid:
- @Data
- blanket @Setter
- default @ToString
- default @EqualsAndHashCode
```

### For DTOs

```text
Java 8/11:
- @Getter + @Builder for immutable response DTO
- @Getter/@Setter + @NoArgsConstructor for simple request DTO if framework requires mutable binding

Java 17/21/25:
- Prefer records for simple immutable DTO
- Use Lombok builder only when constructor gets unwieldy or Java 8 compatibility is needed
```

---

## 25. Code Review Checklist untuk Lombok

Gunakan checklist ini saat review PR.

### General

```text
[ ] Annotation Lombok yang dipakai minimal dan eksplisit?
[ ] Tidak memakai @Data tanpa alasan kuat?
[ ] Generated code bisa diprediksi?
[ ] Ada risiko API method berubah karena field rename?
[ ] lombok.config sudah mengatur policy repo?
```

### DTO / API Contract

```text
[ ] JSON property shape stabil?
[ ] Jackson deserialization sudah diuji?
[ ] Builder membutuhkan @Jacksonized atau custom config?
[ ] Null/default behavior jelas?
[ ] Sensitive field tidak ikut toString?
```

### MapStruct

```text
[ ] MapStruct bisa membaca Lombok-generated accessor/builder?
[ ] annotationProcessor path benar?
[ ] lombok-mapstruct-binding diperlukan dan sudah ada?
[ ] generated mapper diperiksa untuk mapping penting?
```

### Entity / Persistence

```text
[ ] Tidak memakai @Data pada entity?
[ ] equals/hashCode identity policy eksplisit?
[ ] toString tidak traverse lazy relationship?
[ ] no-args constructor sesuai kebutuhan JPA?
[ ] setter tidak membuka invariant penting?
```

### Security / Compliance

```text
[ ] toString tidak mencetak token/password/PII?
[ ] setter tidak memungkinkan mass assignment internal field?
[ ] generated method tidak membuka field internal?
[ ] audit log tidak bergantung pada generated toString default?
```

### Toolchain

```text
[ ] Lombok version support JDK target?
[ ] IDE setup documented?
[ ] CI compile clean dari fresh checkout?
[ ] Delombok tersedia untuk debugging/audit jika perlu?
```

---

## 26. Practical Setup Maven

Contoh Maven modern:

```xml
<properties>
    <java.version>21</java.version>
    <lombok.version>1.18.40</lombok.version>
    <mapstruct.version>1.6.3</mapstruct.version>
</properties>

<dependencies>
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <version>${lombok.version}</version>
        <scope>provided</scope>
    </dependency>

    <dependency>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct</artifactId>
        <version>${mapstruct.version}</version>
    </dependency>
</dependencies>

<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.13.0</version>
            <configuration>
                <source>${java.version}</source>
                <target>${java.version}</target>
                <annotationProcessorPaths>
                    <path>
                        <groupId>org.projectlombok</groupId>
                        <artifactId>lombok</artifactId>
                        <version>${lombok.version}</version>
                    </path>
                    <path>
                        <groupId>org.projectlombok</groupId>
                        <artifactId>lombok-mapstruct-binding</artifactId>
                        <version>0.2.0</version>
                    </path>
                    <path>
                        <groupId>org.mapstruct</groupId>
                        <artifactId>mapstruct-processor</artifactId>
                        <version>${mapstruct.version}</version>
                    </path>
                </annotationProcessorPaths>
            </configuration>
        </plugin>
    </plugins>
</build>
```

Catatan:

- versi harus disesuaikan dengan project,
- jangan copy-paste tanpa dependency management,
- untuk Java 25, pastikan compiler plugin, Lombok, dan CI JDK mendukung target tersebut.

---

## 27. Practical Setup Gradle

Contoh Gradle:

```gradle
plugins {
    id 'java'
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    compileOnly 'org.projectlombok:lombok:1.18.40'
    annotationProcessor 'org.projectlombok:lombok:1.18.40'

    testCompileOnly 'org.projectlombok:lombok:1.18.40'
    testAnnotationProcessor 'org.projectlombok:lombok:1.18.40'

    implementation 'org.mapstruct:mapstruct:1.6.3'
    annotationProcessor 'org.mapstruct:mapstruct-processor:1.6.3'
    annotationProcessor 'org.projectlombok:lombok-mapstruct-binding:0.2.0'
}
```

Untuk multi-module build, lebih baik jadikan ini convention plugin daripada diulang manual di setiap module.

---

## 28. Lombok dalam Perspektif Mapping Engineering

Karena seri ini tentang data mapper/JSON/XML/MapStruct/Lombok, kita perlu menempatkan Lombok pada posisi yang tepat.

Lombok bukan mapper. Lombok tidak melakukan transformasi data antar object.

Tetapi Lombok memengaruhi mapping karena ia menentukan:

- apakah source object punya getter,
- apakah target object punya setter,
- apakah target object punya constructor,
- apakah target object punya builder,
- apakah field final bisa diisi,
- apakah Jackson bisa bind JSON,
- apakah MapStruct bisa instantiate target,
- apakah DTO immutable atau mutable,
- apakah `equals/hashCode/toString` aman.

Jadi Lombok adalah **shape generator**.

```text
Lombok defines object shape
Jackson binds JSON/XML-ish data to/from shape
MapStruct maps between shapes
Validation checks shape constraints
Domain model enforces semantic invariants
```

Jika shape salah, semua layer berikutnya ikut salah.

---

## 29. Anti-Patterns

### 29.1 `@Data` Everywhere

```java
@Data
public class EverythingDtoOrEntityOrDomain {
    private String id;
    private String status;
    private List<String> permissions;
}
```

Masalah:

- terlalu banyak generated behavior,
- setter terlalu luas,
- equality tidak selalu benar,
- toString bisa bocor,
- reviewer sulit tahu intention.

### 29.2 Lombok untuk Menutupi Model yang Buruk

Jika class punya 80 field, `@Builder` membuatnya lebih mudah dibuat, tetapi tidak membuat modelnya baik.

```java
@Builder
public class MegaRequest {
    // 80 fields
}
```

Pertanyaan yang lebih penting:

- apakah request harus dipecah?
- apakah ada nested value object?
- apakah field merepresentasikan beberapa use case berbeda?
- apakah DTO terlalu generic?

### 29.3 Setter pada Aggregate

```java
@Setter
public class ApplicationCase {
    private CaseStatus status;
    private Officer assignedOfficer;
}
```

Ini bypass state machine.

Lebih baik:

```java
public void assignTo(Officer officer) { ... }
public void approve(ApprovalDecision decision) { ... }
public void reject(RejectionReason reason) { ... }
```

### 29.4 Generated `toString` untuk Logging Business Object

```java
log.info("request={}", request);
```

Jika `request.toString()` generated dan include-all, log policy hilang.

Lebih baik:

```java
log.info("requestId={}, applicantId={}, type={}",
        request.getRequestId(),
        request.getApplicantId(),
        request.getType());
```

atau structured safe log object.

---

## 30. Exercises

### Exercise 1 — Delombok Reasoning

Untuk class berikut, tulis kira-kira method/constructor apa yang akan muncul:

```java
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@ToString
public class ApplicantDto {
    private String id;
    private String name;
    private String email;
}
```

Pertanyaan:

1. Apakah Jackson bisa deserialize?
2. Apakah object mutable?
3. Apakah `toString()` aman jika email dianggap PII?
4. Apa annotation yang akan kamu ubah?

---

### Exercise 2 — Entity Lombok Review

Review class berikut:

```java
@Data
@Entity
public class CaseEntity {
    @Id
    private Long id;

    private String caseNo;

    @OneToMany(mappedBy = "caseEntity")
    private List<DocumentEntity> documents;
}
```

Cari minimal 5 masalah.

Jawaban yang diharapkan mencakup:

- `@Data` terlalu luas,
- `toString` bisa traverse documents,
- `equals/hashCode` entity tidak eksplisit,
- setter membuka semua state,
- lazy loading risk,
- cycle risk,
- no-args constructor/access policy belum jelas.

---

### Exercise 3 — DTO Strategy Java 8 vs Java 25

Desain response DTO untuk:

```json
{
  "caseId": "C-001",
  "status": "PENDING_REVIEW",
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Buat dua versi:

1. Java 8 + Lombok,
2. Java 25 + record.

Diskusikan trade-off:

- accessor naming,
- Jackson compatibility,
- immutability,
- API evolution,
- readability.

---

### Exercise 4 — Lombok + MapStruct Build Failure

MapStruct gagal membaca target builder yang dibuat Lombok.

Checklist investigasi:

```text
[ ] Apakah Lombok dependency ada sebagai annotationProcessor?
[ ] Apakah MapStruct processor ada?
[ ] Apakah lombok-mapstruct-binding diperlukan?
[ ] Apakah IDE compile dan CLI compile sama-sama gagal?
[ ] Apakah generated mapper terlihat di build/generated/sources?
[ ] Apakah target class punya builder naming custom?
[ ] Apakah Lombok version compatible dengan JDK?
```

---

## 31. Ringkasan Mental Model

Lombok harus dipahami dalam lima lapisan:

```text
1. Source compression
   Lombok mengurangi code yang ditulis manusia.

2. Compile-time transformation
   Lombok menambahkan/mengubah member saat compile.

3. Bytecode shape
   Runtime melihat method/constructor yang sudah generated.

4. Framework visibility
   Jackson, MapStruct, Spring, JPA membaca shape hasil transformasi.

5. Governance risk
   Tanpa policy, Lombok membuat behavior tersembunyi dan tidak konsisten.
```

Prinsip utama:

> Lombok baik ketika menghapus boilerplate yang benar-benar mekanis. Lombok buruk ketika menyembunyikan semantic decision.

Gunakan Lombok untuk mengurangi noise. Jangan gunakan Lombok untuk menghindari desain.

---

## 32. Koneksi ke Part Berikutnya

Part ini membahas mental model Lombok. Part berikutnya akan masuk ke penggunaan praktis annotation Lombok:

- `@Getter`,
- `@Setter`,
- `@Builder`,
- `@SuperBuilder`,
- `@Value`,
- `@Data`,
- `@EqualsAndHashCode`,
- `@ToString`,
- constructor annotations,
- entity pitfalls,
- inheritance pitfalls,
- collection mutability pitfalls.

Tujuannya bukan menghafal annotation, tetapi tahu **behavior apa yang dihasilkan**, **risiko apa yang muncul**, dan **kapan annotation tersebut layak dipakai**.

---

## 33. Status Seri

Progress saat ini:

```text
Part 23 dari 35 selesai.
```

Seri belum selesai.

Berikutnya:

```text
Part 24 — Lombok Practical: Getter Setter Builder Value With Equals HashCode
```
