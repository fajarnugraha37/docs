# Part 9 — `Record`: Runtime Contract, Value Carrier Semantics, and API Boundaries

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `09-record-runtime-contract-value-carrier-api-boundaries.md`  
> Scope: Java 8–25, with records available as a final language feature since Java 16  
> Main package focus: `java.lang.Record`, `java.lang.Class` record metadata, Java language record classes

---

## 1. Tujuan Part Ini

Bagian ini membahas `record` bukan sebagai shortcut untuk membuat DTO, tetapi sebagai **kontrak bahasa dan runtime** untuk mendefinisikan *transparent value carrier*: class yang bentuk utamanya adalah sekumpulan komponen bernama, dengan identity object tetap ada, tetapi API publiknya secara eksplisit mengatakan: “state utama object ini adalah komponen-komponen ini.”

Setelah part ini, target pemahamanmu adalah:

1. memahami kenapa `record` bukan sekadar “Lombok `@Data` bawaan Java”;
2. membedakan record dari POJO, entity, DTO, command, event, value object, projection, dan tuple;
3. memahami generated members: constructor, fields, accessors, `equals`, `hashCode`, `toString`;
4. memahami canonical constructor, compact constructor, dan invariant enforcement;
5. memahami kenapa record disebut *shallowly immutable*, bukan deeply immutable;
6. memahami defensive copying untuk mutable components;
7. memahami runtime reflection model: `java.lang.Record`, `Class::isRecord`, dan `RecordComponent`;
8. memahami dampak record terhadap serialization, mapping, JSON/XML binding, persistence, dan API compatibility;
9. memahami failure modes record di production systems;
10. mampu menggunakan record sebagai bagian dari desain sistem yang bersih, bukan hanya mengurangi boilerplate.

---

## 2. Posisi Record dalam Java 8–25

Record tidak tersedia di Java 8. Record diperkenalkan sebagai preview pada Java 14/15 dan menjadi final pada Java 16 melalui JEP 395. Di Java 25, `java.lang.Record` adalah abstract base class bagi semua record class.

Implikasi untuk seri Java 8–25:

| Java Version | Status Record | Implikasi |
|---|---:|---|
| Java 8 | Tidak ada | Gunakan class biasa, Lombok, Immutables, AutoValue, atau custom value object |
| Java 11 | Tidak ada | Sama seperti Java 8 |
| Java 14 | Preview | Tidak untuk baseline production jangka panjang tanpa sadar preview risk |
| Java 15 | Preview kedua | Masih belum final |
| Java 16+ | Final | Aman sebagai language feature stabil |
| Java 17 LTS | Final | Baseline modern enterprise yang umum |
| Java 21 LTS | Final + pattern matching ecosystem makin matang | Cocok untuk modelling modern |
| Java 25 LTS | Final | Record menjadi bagian normal dari desain Java modern |

Hal penting: kalau library kamu harus mendukung Java 8, kamu tidak bisa mengekspos record dalam public API artifact yang sama, kecuali memakai strategi multi-release JAR, modul terpisah, atau baseline berbeda.

---

## 3. Mental Model Utama: Record adalah Transparent Carrier

Record adalah cara Java mengatakan:

> “Class ini terutama ada untuk membawa sekumpulan nilai bernama, dan API publiknya sengaja mencerminkan seluruh state utamanya.”

Contoh sederhana:

```java
public record Money(String currency, long minorUnits) {}
```

Ini bukan hanya mempersingkat:

```java
public final class Money {
    private final String currency;
    private final long minorUnits;

    public Money(String currency, long minorUnits) {
        this.currency = currency;
        this.minorUnits = minorUnits;
    }

    public String currency() { return currency; }
    public long minorUnits() { return minorUnits; }

    @Override public boolean equals(Object o) { ... }
    @Override public int hashCode() { ... }
    @Override public String toString() { ... }
}
```

Lebih dalam dari itu, record memberi sinyal desain:

1. **komponen di header adalah state utama**;
2. **accessor publik tersedia untuk setiap komponen**;
3. **equality default berdasarkan semua komponen**;
4. **constructor canonical menerima semua komponen**;
5. **representasi data sengaja transparan**;
6. **class-nya final secara efektif untuk inheritance eksternal karena record tidak bisa di-extend oleh class lain**;
7. **record cocok untuk data aggregate, bukan object dengan identity lifecycle kompleks**.

---

## 4. Record Bukan Apa?

Sebelum masuk detail, penting membongkar asumsi lemah.

### 4.1 Record bukan “immutable object” secara penuh

Record sering disebut immutable, tetapi lebih tepat: **shallowly immutable**.

Contoh berbahaya:

```java
public record UserPermissions(String userId, List<String> permissions) {}

List<String> list = new ArrayList<>();
list.add("READ");

UserPermissions p = new UserPermissions("u-1", list);
list.add("ADMIN");

System.out.println(p.permissions()); // [READ, ADMIN]
```

Field record memang `private final`, tetapi object yang direferensikan oleh field bisa mutable.

Mental model:

```text
record field final  !=  referenced object immutable
```

### 4.2 Record bukan entity persistence ideal

Entity biasanya punya:

- identity lifecycle;
- lazy loading;
- proxying;
- partial mutation;
- dirty checking;
- no-arg constructor;
- persistence framework constraints.

Record justru punya:

- final components;
- canonical constructor;
- equality berdasarkan full state;
- transparent representation.

Untuk JPA-style entity, record biasanya tidak cocok sebagai entity utama. Tetapi record bisa sangat cocok sebagai:

- projection;
- query result;
- API response;
- command object;
- domain event;
- immutable snapshot;
- key object;
- value object kecil.

### 4.3 Record bukan replacement semua DTO

DTO sering menjadi boundary antar layer/framework. Record cocok kalau DTO tersebut:

- membawa data lengkap;
- tidak butuh mutation bertahap;
- tidak butuh no-arg constructor;
- tidak butuh setter;
- tidak butuh inheritance;
- aman jika constructor dipakai sebagai validation point.

Kalau framework masih mengandalkan setter/no-arg constructor, record bisa menimbulkan friction.

### 4.4 Record bukan tuple anonim

Record punya nama type dan nama komponen. Ini lebih kuat daripada tuple.

Buruk:

```java
record Pair(String left, String right) {}
```

Lebih baik:

```java
record PostalAddressLine(String blockNumber, String streetName) {}
record UserName(String firstName, String lastName) {}
```

Record yang baik bukan hanya “dua value”, tetapi “dua value yang membentuk konsep eksplisit”.

---

## 5. Bentuk Dasar Record

```java
public record CustomerId(String value) {}
```

Compiler menghasilkan konsep berikut:

```java
public final class CustomerId extends java.lang.Record {
    private final String value;

    public CustomerId(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) { ... }

    @Override
    public int hashCode() { ... }

    @Override
    public String toString() { ... }
}
```

Catatan penting:

- record class secara implisit extends `java.lang.Record`;
- record tidak bisa extend class lain;
- record bisa implement interface;
- record component menghasilkan accessor dengan nama component, bukan `getX()`;
- record field bersifat `private final`;
- record class tidak bisa abstract;
- record class tidak bisa punya instance field tambahan non-static di luar komponen record;
- record bisa punya static field, static method, instance method, nested type.

---

## 6. Anatomy Record Header

```java
public record CaseTransition(
        String caseId,
        String fromState,
        String toState,
        String actorUserId,
        Instant occurredAt
) {}
```

Record header mendefinisikan **record descriptor**: urutan, nama, dan type komponen.

Setiap component menghasilkan:

1. private final field;
2. public accessor;
3. parameter dalam canonical constructor;
4. bagian dari default `equals`;
5. bagian dari default `hashCode`;
6. bagian dari default `toString`;
7. metadata reflection sebagai `RecordComponent`.

Ini membuat header record sebagai public contract yang kuat.

Kalau kamu mengubah header record, kamu sedang mengubah API dan semantic identity class tersebut.

---

## 7. Generated Accessor: Kenapa `name()` bukan `getName()`?

Record accessor memakai nama komponen:

```java
record User(String id, String email) {}

User u = new User("u-1", "a@example.com");
System.out.println(u.id());
System.out.println(u.email());
```

Bukan:

```java
u.getId();
u.getEmail();
```

Ini sengaja. Record bukan JavaBean tradisional. Ia adalah transparent carrier; component accessor merepresentasikan component secara langsung.

Implikasi framework:

- framework modern biasanya sudah mendukung record;
- framework lama yang hanya mengenali JavaBean getter/setter mungkin gagal;
- mapping convention perlu dicek;
- public API dengan record berarti consumer memakai `component()` style.

---

## 8. Constructor Record

Ada tiga bentuk penting:

1. implicit canonical constructor;
2. explicit canonical constructor;
3. compact constructor.

### 8.1 Implicit Canonical Constructor

```java
public record Point(int x, int y) {}
```

Compiler menghasilkan canonical constructor:

```java
public Point(int x, int y) {
    this.x = x;
    this.y = y;
}
```

Urutan dan type parameter sama dengan record header.

### 8.2 Explicit Canonical Constructor

```java
public record EmailAddress(String value) {
    public EmailAddress(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        this.value = value.toLowerCase(Locale.ROOT);
    }
}
```

Di sini kamu bertanggung jawab assign semua fields.

### 8.3 Compact Constructor

Compact constructor adalah bentuk yang paling idiomatik untuk validation/normalization:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        value = value.trim().toLowerCase(Locale.ROOT);
    }
}
```

Compiler akan menyisipkan assignment ke field setelah body compact constructor selesai.

Secara mental:

```java
public EmailAddress {
    // kamu validasi dan boleh reassign parameter
    value = normalize(value);
    // setelah block, compiler melakukan this.value = value
}
```

### 8.4 Compact Constructor Trap

Ini salah:

```java
public record BadEmail(String value) {
    public BadEmail {
        this.value = value; // compile error
    }
}
```

Dalam compact constructor, kamu tidak assign field secara eksplisit. Kamu hanya memanipulasi parameter.

---

## 9. Validation dan Normalization

Record sangat cocok untuk invariant lokal.

Contoh:

```java
public record CaseNumber(String value) {
    public CaseNumber {
        if (value == null) {
            throw new IllegalArgumentException("case number must not be null");
        }
        value = value.trim().toUpperCase(Locale.ROOT);

        if (!value.matches("CASE-[0-9]{8}")) {
            throw new IllegalArgumentException("invalid case number format: " + value);
        }
    }
}
```

Dengan ini, semua instance `CaseNumber` valid by construction.

Mental model top-tier:

```text
Do not validate records only at the edge.
Put local invariant into the record constructor when the invariant belongs to that concept.
```

Tetapi hati-hati: jangan masukkan invariant yang butuh external dependency.

Buruk:

```java
public record UserId(String value) {
    public UserId {
        if (!database.existsUser(value)) { // buruk: record constructor melakukan I/O
            throw new IllegalArgumentException("unknown user");
        }
    }
}
```

Lebih baik:

- record memvalidasi format/local invariant;
- service memvalidasi keberadaan di database;
- repository/domain service memvalidasi cross-entity invariant.

---

## 10. Defensive Copying untuk Mutable Components

Contoh rawan:

```java
public record WorkflowDefinition(List<String> states) {}
```

Bug:

```java
List<String> states = new ArrayList<>(List.of("DRAFT", "SUBMITTED"));
WorkflowDefinition wf = new WorkflowDefinition(states);

states.add("APPROVED"); // mengubah isi record secara tidak langsung
wf.states().add("REJECTED"); // kalau list mutable, accessor bocor
```

Solusi:

```java
public record WorkflowDefinition(List<String> states) {
    public WorkflowDefinition {
        states = List.copyOf(states);
        if (states.isEmpty()) {
            throw new IllegalArgumentException("states must not be empty");
        }
    }
}
```

Sekarang:

- input list disalin;
- accessor mengembalikan list immutable hasil copy;
- external mutation tidak mempengaruhi state record;
- consumer tidak bisa mutate list.

Untuk array, lebih berbahaya lagi.

Buruk:

```java
public record FileDigest(byte[] sha256) {}
```

Lebih aman:

```java
public record FileDigest(byte[] sha256) {
    public FileDigest {
        sha256 = sha256.clone();
        if (sha256.length != 32) {
            throw new IllegalArgumentException("SHA-256 digest must be 32 bytes");
        }
    }

    @Override
    public byte[] sha256() {
        return sha256.clone();
    }
}
```

Tetapi perhatikan: default `equals` untuk array membandingkan reference, bukan isi. Jadi untuk array component, default record equality sering tidak sesuai.

Lebih baik gunakan wrapper immutable:

```java
public record FileDigest(List<Byte> bytes) {}
```

atau custom class khusus, atau simpan hex/base64 string yang canonical.

---

## 11. Default `equals`, `hashCode`, `toString`

Record default equality berdasarkan semua components.

```java
record Point(int x, int y) {}

System.out.println(new Point(1, 2).equals(new Point(1, 2))); // true
```

Mental model:

```text
Two record instances are equal when they have the same record class and equal component values.
```

### 11.1 Equality Mengikuti Component Equality

```java
record Tags(List<String> values) {}

Tags a = new Tags(List.of("x", "y"));
Tags b = new Tags(List.of("x", "y"));

System.out.println(a.equals(b)); // true, List equality by elements
```

Untuk array:

```java
record Bytes(byte[] value) {}

Bytes a = new Bytes(new byte[] {1, 2});
Bytes b = new Bytes(new byte[] {1, 2});

System.out.println(a.equals(b)); // false, array equality by reference
```

### 11.2 `toString` Bisa Membocorkan Data

```java
record LoginRequest(String username, String password) {}

System.out.println(new LoginRequest("fajar", "secret"));
// LoginRequest[username=fajar, password=secret]
```

Jangan gunakan record default `toString` untuk data sensitif.

Solusi:

```java
public record LoginRequest(String username, String password) {
    @Override
    public String toString() {
        return "LoginRequest[username=" + username + ", password=<redacted>]";
    }
}
```

### 11.3 Override Generated Members dengan Hati-hati

Record boleh override accessor, `equals`, `hashCode`, `toString`, tetapi harus hati-hati.

Kalau terlalu banyak override, pertanyaan desain muncul:

> Apakah ini masih cocok sebagai record?

Record idealnya transparan. Kalau representasi eksternal ingin disembunyikan total, class biasa mungkin lebih tepat.

---

## 12. Record dan Identity

Record tetap object. Artinya:

```java
record Point(int x, int y) {}

Point a = new Point(1, 2);
Point b = new Point(1, 2);

System.out.println(a == b);      // false
System.out.println(a.equals(b)); // true
```

Record bukan primitive, bukan value type JVM, dan bukan inline class.

Mental model:

```text
Record is value-oriented, but still identity-bearing as a Java object.
```

Ini penting untuk:

- synchronization;
- identity hash;
- object allocation;
- reference equality;
- GC;
- memory layout;
- serialization identity graphs.

Jangan mengasumsikan record otomatis bebas allocation atau disimpan seperti primitive.

---

## 13. Record dan Inheritance

Record punya batasan:

- semua record secara implicit extends `java.lang.Record`;
- record tidak bisa extend class lain;
- record bisa implement interface;
- record bersifat final, tidak bisa di-extend;
- record tidak bisa abstract.

Contoh baik:

```java
public interface DomainEvent {
    String aggregateId();
    Instant occurredAt();
}

public record CaseSubmitted(
        String aggregateId,
        String submittedBy,
        Instant occurredAt
) implements DomainEvent {}
```

Ini sangat kuat untuk event modelling.

Contoh buruk:

```java
public record JpaUserEntity(Long id, String email) extends BaseEntity {} // tidak bisa
```

Kalau desainmu bergantung pada inheritance hierarchy class, record bukan tool yang tepat.

---

## 14. Record dan Interface Design

Record sangat cocok menjadi implementation dari interface kecil.

```java
public interface HasCaseId {
    String caseId();
}

public record CaseAssigned(String caseId, String officerId) implements HasCaseId {}
public record CaseClosed(String caseId, String reasonCode) implements HasCaseId {}
```

Ini memungkinkan generic processing:

```java
static void audit(HasCaseId event) {
    System.out.println("caseId=" + event.caseId());
}
```

Tetapi jangan membuat interface terlalu lebar.

Buruk:

```java
interface MutableUserDto {
    String getId();
    void setId(String id);
}
```

Record tidak cocok untuk contract yang membutuhkan setter.

---

## 15. Record sebagai Value Object

Record sering cocok untuk value object kecil.

```java
public record PostalCode(String value) {
    public PostalCode {
        if (value == null || !value.matches("[0-9]{6}")) {
            throw new IllegalArgumentException("postal code must be 6 digits");
        }
    }
}
```

Manfaat:

- menghindari primitive obsession;
- invariant dekat dengan data;
- equality otomatis;
- readable API;
- safe map key kalau components immutable.

Contoh:

```java
public record AddressKey(PostalCode postalCode, String unitNumber) {}
```

Lebih baik daripada:

```java
Map<String, Address> byPostalAndUnit; // format string raw rawan bug
```

---

## 16. Record sebagai Command

Command merepresentasikan niat melakukan sesuatu.

```java
public record SubmitApplicationCommand(
        String applicationId,
        String submittedByUserId,
        Instant submittedAt
) {}
```

Command record cocok kalau:

- command immutable setelah dibuat;
- command melewati layer service;
- validation lokal bisa dilakukan di constructor;
- tidak butuh mutation bertahap.

Tetapi command tidak selalu sama dengan domain event.

```text
Command = request/intention to do something
Event   = fact that something already happened
```

Record cocok untuk keduanya, tetapi semantic naming harus jelas.

---

## 17. Record sebagai Domain Event

```java
public record EnforcementCaseEscalated(
        String caseId,
        String fromLevel,
        String toLevel,
        String reasonCode,
        String actorUserId,
        Instant occurredAt
) {}
```

Event record cocok karena:

- event adalah fakta immutable;
- semua data penting eksplisit;
- equality bisa berguna untuk test;
- serialization mapping straightforward;
- event bisa disimpan sebagai snapshot.

Tetapi hati-hati dengan event evolution.

Jika event sudah persisted/consumed external systems, mengubah record header berarti mengubah schema.

Strategi:

- tambah field nullable/default dengan compatibility plan;
- gunakan versioned event;
- jangan rename component sembarangan;
- pisahkan internal record dari external event schema bila perlu.

---

## 18. Record sebagai Query Projection

```java
public record CaseListingRow(
        String caseId,
        String status,
        String assignedOfficer,
        Instant lastUpdatedAt
) {}
```

Record sangat cocok untuk projection karena:

- data read-only;
- field list eksplisit;
- tidak perlu entity lifecycle;
- constructor mapping jelas;
- test mudah.

Dalam SQL/JDBC/MyBatis/JPA projection, record bisa menjadi target mapping modern, selama framework mendukung canonical constructor.

---

## 19. Record dan API Boundary

Record sering bagus untuk internal boundary, tetapi public API perlu kehati-hatian.

### 19.1 Internal API

Untuk internal module/service boundary:

```java
record ParsedToken(String subject, Set<String> roles, Instant expiresAt) {}
```

Bagus karena mudah refactor selama semua consumer internal dikontrol.

### 19.2 Public Java Library API

Kalau kamu expose record dari library publik:

```java
public record SearchResult(String id, String title, double score) {}
```

Maka kamu mengunci:

- nama component;
- accessor name;
- constructor shape;
- equality semantics;
- `toString` shape kurang lebih;
- reflection metadata;
- serialization/mapping expectation.

Mengubah `score` menjadi `BigDecimal score` bukan perubahan kecil.

Mengubah `title` menjadi `displayTitle` bukan sekadar rename internal.

### 19.3 External JSON/XML API

Record component name sering dipakai sebagai property name.

```java
record UserResponse(String userId, String displayName) {}
```

JSON mungkin menjadi:

```json
{
  "userId": "u-1",
  "displayName": "Fajar"
}
```

Mengubah component name berarti breaking API, kecuali mapper dikonfigurasi dengan annotation/name override.

---

## 20. Record dan Reflection

Record punya runtime metadata.

```java
public record UserRecord(String id, String email) {}
```

Reflection:

```java
Class<UserRecord> type = UserRecord.class;

System.out.println(type.isRecord()); // true

for (RecordComponent component : type.getRecordComponents()) {
    System.out.println(component.getName() + " : " + component.getType());
}
```

Output kira-kira:

```text
id : class java.lang.String
email : class java.lang.String
```

Komponen record bisa digunakan oleh:

- serializers;
- object mappers;
- schema generators;
- documentation tools;
- validation frameworks;
- test data builders;
- plugin systems.

Tetapi reflection harus memperhatikan:

- module exports/opens;
- generic type info;
- annotation pada record component;
- canonical constructor accessibility;
- older runtime compatibility.

---

## 21. Annotation pada Record Component

Record component bisa diberi annotation.

```java
public record RegisterUserRequest(
        @NotBlank String email,
        @NotBlank String displayName
) {}
```

Secara konsep, annotation pada component bisa berdampak ke beberapa target, tergantung annotation target-nya:

- record component;
- field;
- accessor method;
- constructor parameter.

Framework validasi/mapping yang modern biasanya memahami record component, tetapi jangan berasumsi semua framework lama memahaminya.

Checklist:

1. apakah annotation target mencakup `RECORD_COMPONENT`?
2. apakah framework membaca constructor parameter?
3. apakah framework membaca accessor?
4. apakah module membuka package untuk reflection?
5. apakah runtime Java minimal sudah mendukung record?

---

## 22. Record dan Serialization

Java serialization memberi perlakuan khusus terhadap record. Secara garis besar:

- serialization record berbasis state components;
- deserialization menggunakan canonical constructor;
- beberapa mekanisme custom serialization tradisional memiliki batasan/behavior berbeda dibanding class biasa.

Ini penting karena canonical constructor akan dipakai saat deserialization, sehingga validation/normalization bisa tetap terjadi.

Contoh:

```java
public record EmailAddress(String value) implements Serializable {
    public EmailAddress {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        value = value.trim().toLowerCase(Locale.ROOT);
    }
}
```

Saat deserialization, constructor canonical menjadi gate invariant.

Tetapi jangan jadikan Java native serialization sebagai default untuk distributed systems modern. Untuk external boundary, biasanya lebih baik:

- JSON;
- XML;
- Protocol Buffers;
- Avro;
- custom stable schema;
- database schema versioning.

Java serialization punya sejarah risiko security dan compatibility yang berat.

---

## 23. Record dan JSON Mapping

Modern JSON mapper seperti Jackson versi baru umumnya mendukung record. Mental model mapper:

```text
JSON property name -> record component name -> canonical constructor parameter
```

Contoh:

```java
public record CreateCaseRequest(String applicantId, String caseType) {}
```

JSON:

```json
{
  "applicantId": "A-001",
  "caseType": "LICENSE_RENEWAL"
}
```

Mapping berjalan baik jika:

- property names cocok;
- constructor parameter names tersedia via record metadata;
- mapper versi mendukung record;
- tidak butuh setter;
- missing/null behavior dipahami.

Failure mode:

```java
public record CreateCaseRequest(String applicantId, String caseType) {
    public CreateCaseRequest {
        if (applicantId.isBlank()) { // NPE kalau applicantId null
            throw new IllegalArgumentException("blank applicant id");
        }
    }
}
```

Lebih aman:

```java
public record CreateCaseRequest(String applicantId, String caseType) {
    public CreateCaseRequest {
        if (applicantId == null || applicantId.isBlank()) {
            throw new IllegalArgumentException("applicant id is required");
        }
        if (caseType == null || caseType.isBlank()) {
            throw new IllegalArgumentException("case type is required");
        }
    }
}
```

---

## 24. Record dan XML Mapping

Record bisa dipakai untuk XML mapping, tetapi lebih banyak friction dibanding JSON karena XML punya:

- element vs attribute;
- namespace;
- order;
- mixed content;
- text node;
- repeated elements;
- schema type;
- default values;
- whitespace handling.

Record cocok untuk XML extraction result:

```java
public record ParsedApplicant(
        String id,
        String name,
        String postalCode
) {}
```

Tetapi DOM/SAX parser sering lebih baik menghasilkan record secara eksplisit melalui extraction logic:

```java
ParsedApplicant applicant = new ParsedApplicant(
        textOf(applicantElement, "id"),
        textOf(applicantElement, "name"),
        textOf(applicantElement, "postalCode")
);
```

Untuk XML yang rumit, jangan memaksa record menjadi mirror langsung XML tree. XML document model dan domain model sering tidak sama.

---

## 25. Record dan Persistence

### 25.1 Record sebagai Entity: Biasanya Tidak Ideal

Entity persistence biasanya butuh:

- mutable lifecycle;
- identity database;
- lazy relation;
- proxy;
- no-arg constructor;
- dirty checking;
- partial loading.

Record tidak cocok untuk mayoritas kebutuhan itu.

Buruk:

```java
@Entity
public record UserEntity(Long id, String email) {}
```

Mungkin beberapa framework/version mendukung sebagian use case, tetapi secara desain entity adalah object dengan lifecycle, sedangkan record adalah data carrier transparan.

### 25.2 Record sebagai Projection: Sangat Cocok

```java
public record UserSummary(Long id, String email, String status) {}
```

Projection tidak butuh lifecycle; ia hanya membawa hasil query.

### 25.3 Record sebagai ID/Key

```java
public record CaseAssignmentKey(String caseId, String officerId) {}
```

Cocok sebagai key map/cache/event deduplication selama components immutable dan equality sesuai.

---

## 26. Record dan Builder Pattern

Record sering tidak butuh builder kalau jumlah component kecil.

```java
record PageRequest(int page, int size) {}
```

Tetapi kalau component banyak, constructor call menjadi sulit dibaca.

```java
record ReportFilter(
        String agency,
        String status,
        Instant from,
        Instant to,
        String officer,
        String caseType,
        boolean includeArchived
) {}
```

Pemanggilan:

```java
new ReportFilter("CEA", "OPEN", from, to, "u-1", "LIC", false);
```

Rawan tertukar.

Solusi:

1. pecah menjadi records lebih kecil;
2. gunakan named value objects;
3. gunakan static factories;
4. gunakan builder eksternal jika memang perlu.

Contoh refactor:

```java
record DateRange(Instant from, Instant to) {
    public DateRange {
        if (from != null && to != null && from.isAfter(to)) {
            throw new IllegalArgumentException("from must not be after to");
        }
    }
}

record ReportFilter(
        AgencyCode agency,
        CaseStatus status,
        DateRange period,
        UserId officer,
        CaseType caseType,
        IncludeArchived includeArchived
) {}
```

Ini lebih kaya secara domain dan mengurangi primitive obsession.

---

## 27. Record dan Static Factory

Record tetap bisa punya static factory.

```java
public record Percentage(int basisPoints) {
    public Percentage {
        if (basisPoints < 0 || basisPoints > 10_000) {
            throw new IllegalArgumentException("percentage must be between 0 and 100%");
        }
    }

    public static Percentage ofPercent(double percent) {
        return new Percentage((int) Math.round(percent * 100));
    }

    public double asPercent() {
        return basisPoints / 100.0;
    }
}
```

Factory berguna untuk:

- alternative construction;
- parsing;
- canonicalization;
- naming intent;
- avoiding ambiguous raw constructor arguments.

Tetapi constructor canonical tetap public jika record public. Karena record transparan, consumer tetap bisa memanggil canonical constructor.

Kalau kamu butuh private constructor total, record mungkin bukan pilihan tepat.

---

## 28. Record dan Nested Records

Nested record sering berguna untuk scope lokal.

```java
public class AuditReportService {
    private record AuditRow(String module, String action, Instant at) {}

    public void generate() {
        List<AuditRow> rows = loadRows();
    }
}
```

Local record juga bisa dipakai dalam method untuk intermediate computation.

```java
void process(List<String> lines) {
    record ParsedLine(String code, int count) {}

    List<ParsedLine> parsed = lines.stream()
            .map(line -> line.split(","))
            .map(parts -> new ParsedLine(parts[0], Integer.parseInt(parts[1])))
            .toList();
}
```

Ini bagus kalau:

- type hanya relevan dalam scope kecil;
- meningkatkan readability;
- menghindari `Map.Entry`/tuple mentah.

Jangan berlebihan sampai domain concept penting tersembunyi sebagai local record.

---

## 29. Record dan Pattern Matching

Record makin kuat ketika digabung dengan pattern matching modern.

Contoh record pattern:

```java
record Point(int x, int y) {}

static int manhattan(Object o) {
    if (o instanceof Point(int x, int y)) {
        return Math.abs(x) + Math.abs(y);
    }
    return 0;
}
```

Ini menunjukkan ide besar:

```text
Record makes construction transparent.
Record pattern makes deconstruction transparent.
```

Untuk Java 8–17 compatibility, jangan bergantung pada record pattern kalau baseline belum mendukung. Tetapi secara Java 21/25 mental model, record adalah bagian dari data-oriented programming.

---

## 30. Record dan Sealed Hierarchy

Record sangat kuat saat digabung dengan sealed interface.

```java
public sealed interface CaseAction
        permits SubmitCase, ApproveCase, RejectCase {}

public record SubmitCase(String caseId, String actorId) implements CaseAction {}
public record ApproveCase(String caseId, String approverId) implements CaseAction {}
public record RejectCase(String caseId, String officerId, String reason) implements CaseAction {}
```

Manfaat:

- action variants eksplisit;
- setiap variant punya data sendiri;
- compiler bisa membantu exhaustiveness pada switch modern;
- tidak perlu inheritance mutable yang rumit.

Ini sangat cocok untuk:

- workflow commands;
- domain events;
- parser AST;
- validation results;
- state transition inputs;
- integration message variants.

---

## 31. Record sebagai Return Type

Record bagus untuk method yang perlu return beberapa value dengan semantic jelas.

Buruk:

```java
Map.Entry<Boolean, String> validate(Input input) { ... }
```

Lebih baik:

```java
record ValidationResult(boolean valid, String message) {}

ValidationResult validate(Input input) { ... }
```

Lebih baik lagi dengan sealed result:

```java
sealed interface ValidationResult permits Valid, Invalid {}
record Valid() implements ValidationResult {}
record Invalid(String reason) implements ValidationResult {}
```

Ini menghindari boolean blindness.

---

## 32. Record dan Null Handling

Record tidak otomatis melarang null.

```java
record User(String id, String email) {}

User u = new User(null, null); // valid secara default
```

Kalau null tidak valid, constructor harus melarangnya.

```java
public record User(String id, String email) {
    public User {
        id = Objects.requireNonNull(id, "id");
        email = Objects.requireNonNull(email, "email");
    }
}
```

Strategi null:

| Kondisi | Strategi |
|---|---|
| Field wajib | `Objects.requireNonNull` |
| Field optional internal | `Optional` jarang sebagai field; pertimbangkan nullable eksplisit + docs |
| Field optional API response | tergantung serializer/API convention |
| Collection kosong vs null | pilih empty collection, bukan null |
| Unknown external value | model dengan enum `UNKNOWN`, sealed type, atau nullable terkontrol |

Jangan menganggap record membuat data lebih valid. Record hanya membuat data lebih transparan. Validity tetap tanggung jawab desain.

---

## 33. Record dan Optional Field

Ini sering jadi perdebatan.

```java
record UserProfile(String id, Optional<String> middleName) {}
```

Bisa, tetapi tidak selalu ideal.

Kelebihan:

- explicit optionality;
- caller sadar field mungkin tidak ada.

Kekurangan:

- beberapa serializers tidak nyaman;
- `Optional` sebagai field masih kontroversial;
- bisa menghasilkan nested awkward API;
- JavaBeans/framework compatibility bisa terganggu.

Alternatif:

```java
record UserProfile(String id, String middleName) {
    public Optional<String> middleNameOptional() {
        return Optional.ofNullable(middleName);
    }
}
```

Untuk internal domain, pilih berdasarkan clarity. Untuk external API, pilih berdasarkan schema contract.

---

## 34. Record dan Sensitive Data

Karena `toString` default mencetak semua component, record berbahaya untuk secrets.

Jangan lakukan:

```java
record DbCredentials(String username, String password) {}
```

Kalau tetap harus:

```java
public record DbCredentials(String username, String password) {
    public DbCredentials {
        username = Objects.requireNonNull(username, "username");
        password = Objects.requireNonNull(password, "password");
    }

    @Override
    public String toString() {
        return "DbCredentials[username=" + username + ", password=<redacted>]";
    }
}
```

Tetapi lebih baik gunakan type khusus untuk secret:

```java
public final class SecretString {
    private final String value;

    private SecretString(String value) {
        this.value = Objects.requireNonNull(value);
    }

    public static SecretString of(String value) {
        return new SecretString(value);
    }

    public String reveal() {
        return value;
    }

    @Override
    public String toString() {
        return "<secret>";
    }
}

public record DbCredentials(String username, SecretString password) {}
```

---

## 35. Record dan Large Object Graph

Record nyaman, tetapi jangan menjadikannya alasan membuat object graph besar tanpa batas.

```java
record FullCaseSnapshot(
        CaseHeader header,
        List<Party> parties,
        List<Document> documents,
        List<AuditTrailEntry> auditTrail,
        List<Comment> comments,
        List<Task> tasks
) {}
```

Ini bisa valid untuk snapshot, tetapi perhatikan:

- memory footprint;
- serialization cost;
- `toString` sangat besar;
- `equals/hashCode` sangat mahal;
- accidental logging;
- object retention;
- API response bloat.

Untuk graph besar, pertimbangkan:

- projection yang lebih kecil;
- paging;
- lazy query explicit, bukan lazy object mutation;
- custom `toString`;
- jangan gunakan sebagai map key;
- jangan gunakan equality default jika terlalu mahal.

---

## 36. Record dan `equals/hashCode` Cost

Default equality membandingkan semua components. Kalau component adalah list besar, equality mahal.

```java
record ReportData(List<ReportRow> rows) {}
```

`reportA.equals(reportB)` bisa membandingkan ribuan row.

Kalau record dipakai sebagai cache key, pastikan components kecil dan stable.

Baik:

```java
record ReportCacheKey(String agency, String reportType, LocalDate from, LocalDate to) {}
```

Buruk:

```java
record ReportCacheKey(String agency, List<ReportRow> previousRows) {}
```

---

## 37. Record dan Compatibility

Mengubah record header punya dampak besar.

### 37.1 Menambah Component

Sebelum:

```java
record UserResponse(String id, String name) {}
```

Sesudah:

```java
record UserResponse(String id, String name, String email) {}
```

Dampak:

- constructor signature berubah;
- binary/source compatibility consumer bisa rusak;
- JSON output bisa berubah;
- equality/hashCode berubah;
- `toString` berubah;
- pattern matching deconstruction berubah;
- serialization schema berubah.

### 37.2 Rename Component

```java
record UserResponse(String displayName) {}
```

menjadi:

```java
record UserResponse(String name) {}
```

Dampak:

- accessor berubah dari `displayName()` ke `name()`;
- JSON property mungkin berubah;
- reflection metadata berubah;
- source compatibility rusak.

### 37.3 Reorder Component

```java
record Range(int min, int max) {}
```

menjadi:

```java
record Range(int max, int min) {}
```

Ini sangat berbahaya karena type sama, tetapi semantic constructor berubah.

Panggilan:

```java
new Range(1, 10)
```

bisa berubah makna tanpa compile error jika parameter type sama.

### 37.4 Mengubah Type Component

```java
record Price(long cents) {}
```

menjadi:

```java
record Price(BigDecimal amount) {}
```

Ini jelas breaking.

### 37.5 Compatibility Rule of Thumb

Untuk public record:

```text
Treat the record header as a public schema.
```

Kalau schema perlu evolusi fleksibel, pertimbangkan class biasa, builder, versioned type, atau explicit API schema mapping.

---

## 38. Record dan Binary Compatibility

Dari sisi binary, consumer yang sudah compile terhadap canonical constructor lama akan mencari descriptor lama.

Misalnya consumer compile terhadap:

```java
record Point(int x, int y) {}
```

Bytecode consumer memanggil constructor:

```text
Point.<init>(int, int)
```

Kalau library mengganti menjadi:

```java
record Point(int x, int y, int z) {}
```

Constructor lama hilang. Consumer lama bisa gagal runtime dengan linkage error bila tidak direcompile dan disesuaikan.

Ini alasan public record harus distabilkan seperti schema.

---

## 39. Record dan Modules

Record berada di `java.lang`, module `java.base`. Tetapi reflection terhadap record dalam module sendiri tetap mengikuti aturan JPMS.

Jika framework perlu reflective access ke package non-open, kamu mungkin perlu:

```java
module com.example.app {
    requires com.fasterxml.jackson.databind;

    opens com.example.api.dto to com.fasterxml.jackson.databind;
}
```

Atau desain agar mapper memakai public canonical constructor/accessor tanpa deep reflection.

Mental model:

```text
Record metadata exists, but JPMS access rules still matter.
```

---

## 40. Record dan Local Invariant vs Cross-Entity Invariant

Record constructor cocok untuk invariant yang hanya membutuhkan component record itu sendiri.

Cocok:

```java
record DateRange(LocalDate from, LocalDate to) {
    public DateRange {
        Objects.requireNonNull(from);
        Objects.requireNonNull(to);
        if (from.isAfter(to)) {
            throw new IllegalArgumentException("from must not be after to");
        }
    }
}
```

Tidak cocok:

```java
record AssignOfficerCommand(String caseId, String officerId) {
    public AssignOfficerCommand {
        // butuh cek DB: apakah officer punya role tertentu?
    }
}
```

Cross-entity invariant sebaiknya di service/domain layer.

---

## 41. Record dan Error Message Design

Karena record constructor sering menjadi validation point, error message harus operable.

Buruk:

```java
throw new IllegalArgumentException("invalid");
```

Lebih baik:

```java
throw new IllegalArgumentException("postal code must contain exactly 6 digits");
```

Untuk data sensitif, jangan echo raw input.

Buruk:

```java
throw new IllegalArgumentException("invalid password: " + password);
```

Lebih baik:

```java
throw new IllegalArgumentException("password does not satisfy policy");
```

---

## 42. Record dan Framework Proxy

Karena record final dan field final, framework yang mengandalkan subclass proxy tidak cocok.

Contoh potensi masalah:

- JPA lazy entity proxy;
- AOP subclass proxy;
- runtime bytecode enhancement yang butuh no-arg constructor/setter;
- mocking framework lama;
- serialization framework lama.

Solusi:

- gunakan record di boundary/projection;
- gunakan interface-based proxy jika perlu;
- jangan jadikan record target AOP mutable lifecycle;
- cek framework version.

---

## 43. Record dan Testing

Record membuat test lebih jelas.

```java
record ValidationCase(String input, boolean expectedValid) {}

List<ValidationCase> cases = List.of(
        new ValidationCase("123456", true),
        new ValidationCase("ABC", false)
);
```

Untuk test fixtures, record bagus karena:

- ringkas;
- immutable-ish;
- readable `toString` saat assertion failure;
- equality otomatis.

Tetapi hati-hati kalau record berisi data sensitif atau graph besar karena failure output bisa bocor/bising.

---

## 44. Record dan Performance

Record tidak otomatis lebih cepat daripada class biasa. Ia tetap object dengan field dan method.

Keuntungan potensial:

- lebih sedikit boilerplate;
- JIT bisa mengoptimasi seperti class final biasa;
- escape analysis bisa mengeliminasi allocation dalam beberapa kasus;
- immutable-ish shape membantu reasoning.

Tetapi jangan mengasumsikan:

- record selalu stack-allocated;
- record sama dengan primitive/value type;
- record equality murah;
- record toString aman di hot path.

Performance checklist:

1. Hindari record besar sebagai key.
2. Hindari `toString` default pada graph besar.
3. Hindari mutable array component jika equality penting.
4. Gunakan value object kecil untuk cache key.
5. Benchmark jika record ada di hot path, jangan menebak.

---

## 45. Record dan Memory

Record field final bisa membantu safe publication reasoning, tetapi component object tetap punya memory sendiri.

```java
record CaseSnapshot(List<Document> documents) {}
```

Memory bukan hanya `CaseSnapshot`, tetapi seluruh list dan documents yang direferensikan.

Jika record menjadi long-lived object, ia mempertahankan seluruh graph.

Failure mode:

```java
record ErrorContext(HttpRequest request, Throwable throwable) {}
```

Kalau disimpan di cache/log queue, bisa menahan request besar, body, headers, session, dan exception stack.

Lebih baik:

```java
record ErrorContext(String correlationId, String path, String errorCode) {}
```

---

## 46. Record dan Concurrency

Record dengan immutable components aman dibagikan antar thread.

```java
record ConfigSnapshot(Map<String, String> values) {
    public ConfigSnapshot {
        values = Map.copyOf(values);
    }
}
```

Ini thread-safe untuk read-only use.

Tetapi record dengan mutable components tidak otomatis thread-safe.

```java
record MutableHolder(List<String> values) {}
```

Jika list mutable dan dibagi antar thread, race tetap terjadi.

Rule:

```text
Record thread-safety = final fields + component thread-safety + no escaped mutable state.
```

---

## 47. Record dan Domain Modelling Regulatory Workflow

Dalam workflow/regulatory systems, record sangat cocok untuk konsep berikut:

### 47.1 State Transition

```java
public record StateTransition(
        String entityId,
        String fromState,
        String toState,
        String reasonCode,
        String actorUserId,
        Instant occurredAt
) {
    public StateTransition {
        Objects.requireNonNull(entityId);
        Objects.requireNonNull(fromState);
        Objects.requireNonNull(toState);
        Objects.requireNonNull(actorUserId);
        Objects.requireNonNull(occurredAt);

        if (fromState.equals(toState)) {
            throw new IllegalArgumentException("fromState and toState must differ");
        }
    }
}
```

### 47.2 Escalation Decision

```java
public record EscalationDecision(
        boolean escalate,
        String targetQueue,
        String rationale
) {
    public EscalationDecision {
        if (escalate && (targetQueue == null || targetQueue.isBlank())) {
            throw new IllegalArgumentException("targetQueue is required when escalate=true");
        }
    }
}
```

Namun boolean di sini mungkin masih lemah. Lebih baik sealed result:

```java
sealed interface EscalationDecision permits Escalate, DoNotEscalate {}

record Escalate(String targetQueue, String rationale) implements EscalationDecision {}
record DoNotEscalate(String rationale) implements EscalationDecision {}
```

Ini menghilangkan invalid combination.

### 47.3 Audit Event

```java
public record AuditEvent(
        String correlationId,
        String module,
        String action,
        String actor,
        Instant occurredAt,
        Map<String, String> attributes
) {
    public AuditEvent {
        correlationId = Objects.requireNonNull(correlationId);
        module = Objects.requireNonNull(module);
        action = Objects.requireNonNull(action);
        actor = Objects.requireNonNull(actor);
        occurredAt = Objects.requireNonNull(occurredAt);
        attributes = Map.copyOf(attributes == null ? Map.of() : attributes);
    }
}
```

Record membantu memastikan audit event immutable-ish dan lengkap sejak dibuat.

---

## 48. Record vs Class Biasa: Decision Matrix

| Use Case | Record Cocok? | Alasan |
|---|---:|---|
| Small immutable value object | Ya | State transparan, equality otomatis |
| API response DTO | Ya, dengan compatibility awareness | Ringkas, mapping mudah |
| Command object | Ya | Immutable request data |
| Domain event | Ya | Fact immutable, clear schema |
| Query projection | Ya | Read-only aggregate |
| Cache key | Ya, jika kecil dan immutable | Equality/hash bagus |
| JPA entity | Biasanya tidak | Entity lifecycle/mutation/proxy |
| Object dengan behavior kompleks dan hidden representation | Mungkin tidak | Record transparan |
| Object dengan many optional fields | Hati-hati | Constructor panjang, compatibility risk |
| Sensitive data holder | Hati-hati | Default toString bocor |
| Large graph snapshot | Hati-hati | equals/hashCode/toString/memory mahal |
| Public library schema yang sering berubah | Hati-hati | Header adalah public contract |

---

## 49. Advanced Pattern: Canonicalization

Kadang record bisa menormalisasi agar equality stabil.

```java
public record AgencyCode(String value) {
    public AgencyCode {
        value = Objects.requireNonNull(value, "value")
                .trim()
                .toUpperCase(Locale.ROOT);

        if (!value.matches("[A-Z0-9_]{2,20}")) {
            throw new IllegalArgumentException("invalid agency code");
        }
    }
}
```

Sekarang:

```java
new AgencyCode(" cea ").equals(new AgencyCode("CEA")); // true
```

Ini bagus jika canonicalization adalah bagian dari konsep domain.

Tetapi jangan canonicalize secara diam-diam kalau raw input penting untuk audit.

Alternatif:

```java
record RawAndCanonicalAgencyCode(String raw, AgencyCode canonical) {}
```

---

## 50. Advanced Pattern: Derived Methods

Record boleh punya method tambahan.

```java
public record DateRange(LocalDate from, LocalDate to) {
    public DateRange {
        Objects.requireNonNull(from);
        Objects.requireNonNull(to);
        if (from.isAfter(to)) {
            throw new IllegalArgumentException("from must not be after to");
        }
    }

    public boolean contains(LocalDate date) {
        return !date.isBefore(from) && !date.isAfter(to);
    }

    public long daysInclusive() {
        return ChronoUnit.DAYS.between(from, to) + 1;
    }
}
```

Record bukan hanya dumb data. Ia boleh punya behavior yang berasal dari component-nya.

Rule:

```text
Behavior that is pure and derived from components fits records well.
Behavior that requires mutable lifecycle or external dependency usually does not.
```

---

## 51. Advanced Pattern: Static Validation Result

```java
public record ValidationError(String field, String message) {}

public record ValidationReport(List<ValidationError> errors) {
    public ValidationReport {
        errors = List.copyOf(errors);
    }

    public boolean isValid() {
        return errors.isEmpty();
    }

    public static ValidationReport valid() {
        return new ValidationReport(List.of());
    }
}
```

Ini lebih ekspresif daripada mengembalikan `List<String>` mentah.

---

## 52. Advanced Pattern: Record for Parser Output

Nanti saat masuk DOM/SAX, record sangat berguna untuk hasil parsing.

```java
public record XmlLocation(int line, int column) {}

public record ParsedElement(
        String namespaceUri,
        String localName,
        Map<String, String> attributes,
        XmlLocation location
) {
    public ParsedElement {
        attributes = Map.copyOf(attributes);
    }
}
```

Untuk SAX, event state machine bisa menghasilkan record:

```java
record ApplicantParsed(String applicantId, String name, String postalCode) {}
```

Record membuat hasil extraction eksplisit dan testable.

---

## 53. Anti-Pattern: God Record

```java
record ApplicationEverything(
        String id,
        String status,
        String applicantName,
        String applicantEmail,
        String applicantPhone,
        String agency,
        String officer,
        String supervisor,
        String createdBy,
        Instant createdAt,
        Instant submittedAt,
        Instant approvedAt,
        Instant rejectedAt,
        List<String> documents,
        List<String> comments,
        List<String> auditTrail,
        Map<String, Object> metadata
) {}
```

Ini biasanya tanda bahwa kamu belum menemukan boundary model.

Masalah:

- terlalu banyak optional/null;
- constructor unreadable;
- equality mahal;
- schema rapuh;
- semua layer tergoda memakai satu type;
- domain concept hilang.

Refactor menjadi:

- `ApplicationHeader`;
- `ApplicantSummary`;
- `ApprovalTimeline`;
- `DocumentSummary`;
- `AuditSummary`;
- use-case specific projection.

---

## 54. Anti-Pattern: Boolean Flag Record

```java
record Decision(boolean approved, boolean rejected, boolean pending) {}
```

Invalid combinations banyak:

```text
approved=true, rejected=true
approved=false, rejected=false, pending=false
```

Lebih baik:

```java
enum DecisionStatus { APPROVED, REJECTED, PENDING }
record Decision(DecisionStatus status, String reason) {}
```

Lebih kuat lagi:

```java
sealed interface Decision permits Approved, Rejected, Pending {}
record Approved(String approverId) implements Decision {}
record Rejected(String reason) implements Decision {}
record Pending() implements Decision {}
```

---

## 55. Anti-Pattern: Record dengan `Map<String, Object>`

```java
record GenericPayload(Map<String, Object> values) {}
```

Kadang perlu untuk dynamic payload, tetapi sering menghapus manfaat record.

Masalah:

- type safety hilang;
- schema tidak eksplisit;
- runtime cast;
- serialization ambiguity;
- equality tidak jelas;
- API contract kabur.

Kalau data benar-benar dynamic, pertimbangkan:

- typed envelope + raw JSON/XML node;
- sealed variant;
- schema registry;
- domain-specific map type;
- explicit extension attributes.

Contoh lebih baik:

```java
record IntegrationMessage(
        String messageType,
        String schemaVersion,
        JsonNode payload
) {}
```

atau:

```java
record AuditEvent(
        String eventType,
        Map<String, String> attributes
) {
    public AuditEvent {
        attributes = Map.copyOf(attributes);
    }
}
```

---

## 56. Anti-Pattern: Record untuk Mutable Workflow State

```java
record CaseState(String caseId, String status, List<String> pendingTasks) {}
```

Kalau object ini dipakai sebagai mutable aggregate root, record tidak cocok.

Lebih baik:

- class aggregate untuk behavior/mutation;
- record snapshot untuk read model;
- record event untuk perubahan.

```java
final class CaseAggregate {
    private final String caseId;
    private CaseStatus status;
    private final List<Task> pendingTasks = new ArrayList<>();

    CaseSnapshot snapshot() {
        return new CaseSnapshot(caseId, status, List.copyOf(pendingTasks));
    }
}

record CaseSnapshot(String caseId, CaseStatus status, List<Task> pendingTasks) {}
```

---

## 57. Migration dari POJO ke Record

Sebelum:

```java
public final class UserDto {
    private final String id;
    private final String email;

    public UserDto(String id, String email) {
        this.id = id;
        this.email = email;
    }

    public String getId() { return id; }
    public String getEmail() { return email; }
}
```

Sesudah:

```java
public record UserDto(String id, String email) {}
```

Checklist migration:

1. Apakah getter name berubah dari `getId()` ke `id()` dapat diterima?
2. Apakah serializer mendukung record?
3. Apakah deserializer bisa memakai canonical constructor?
4. Apakah equality sebelumnya identity-based atau field-based?
5. Apakah `toString` sebelumnya redacted?
6. Apakah ada no-arg constructor requirement?
7. Apakah class sebelumnya bisa di-extend?
8. Apakah field mutable perlu defensive copy?
9. Apakah public API compatibility harus dijaga?
10. Apakah Java baseline minimal 16/17+?

---

## 58. Record dan Lombok

Record sering menggantikan sebagian use case Lombok:

- `@Value`;
- `@Data` untuk immutable-ish DTO;
- constructor/getter/toString/equality boilerplate.

Tetapi Lombok masih punya area:

- builder generation;
- Java 8/11 compatibility;
- mutable DTO;
- framework-specific patterns;
- generated withers;
- complex constructor customization.

Pertanyaan desain:

```text
Apakah saya butuh language-level transparent carrier, atau hanya ingin mengurangi boilerplate class biasa?
```

Kalau ingin contract transparent dan baseline Java mendukung, record lebih eksplisit daripada Lombok.

---

## 59. Record dan `var`

Record sering nyaman dengan `var` lokal:

```java
var range = new DateRange(LocalDate.now(), LocalDate.now().plusDays(7));
```

Tetapi jangan hilangkan readability jika type penting.

Baik:

```java
DateRange activePeriod = new DateRange(start, end);
```

Kurang jelas:

```java
var result = service.process(input);
```

Jika record type menyampaikan domain concept penting, explicit type bisa lebih baik.

---

## 60. Record dan Naming

Nama record harus menunjukkan konsep, bukan struktur.

Buruk:

```java
record StringIntPair(String s, int i) {}
record TwoDates(LocalDate a, LocalDate b) {}
record ResultData(String x, String y) {}
```

Baik:

```java
record RetryPolicy(int maxAttempts, Duration delay) {}
record EffectivePeriod(LocalDate startDate, LocalDate endDate) {}
record CaseSearchResult(String caseId, String status) {}
```

Nama component juga bagian dari contract.

Buruk:

```java
record User(String s1, String s2) {}
```

Baik:

```java
record User(String id, String email) {}
```

---

## 61. Record dan Package Design

Record kecil sering menggoda untuk ditaruh sembarangan.

Guideline:

- value object domain: taruh dekat domain concept;
- API DTO: taruh di API boundary package;
- internal parser result: taruh dekat parser;
- test helper record: local/nested di test;
- event record: taruh di event package/versioned schema.

Jangan membuat `common.dto` menjadi tempat semua record tanpa ownership.

---

## 62. Record dan Documentation

Record yang public tetap butuh dokumentasi.

```java
/**
 * Represents a normalized six-digit Singapore postal code.
 * The value is guaranteed to contain exactly six ASCII digits.
 */
public record PostalCode(String value) {
    public PostalCode {
        if (value == null || !value.matches("[0-9]{6}")) {
            throw new IllegalArgumentException("postal code must contain exactly six digits");
        }
    }
}
```

Dokumentasikan:

- invariant;
- nullability;
- normalization;
- units;
- timezone;
- precision;
- whether collections are immutable;
- external schema mapping;
- compatibility expectations.

---

## 63. Record dengan Temporal Types

```java
record SubmissionTime(Instant value) {}
record BusinessDate(LocalDate value) {}
record AppointmentSlot(ZonedDateTime start, ZonedDateTime end) {}
```

Temporal type harus jelas:

- `Instant`: timeline moment UTC;
- `LocalDate`: date tanpa timezone;
- `LocalDateTime`: local date-time tanpa zone, sering ambiguous;
- `ZonedDateTime`: date-time dengan zone;
- `OffsetDateTime`: date-time dengan offset.

Record tidak menyelesaikan ambiguity temporal. Nama type dan invariant tetap penting.

Contoh:

```java
public record AppointmentSlot(ZonedDateTime start, ZonedDateTime end) {
    public AppointmentSlot {
        Objects.requireNonNull(start);
        Objects.requireNonNull(end);
        if (!start.getZone().equals(end.getZone())) {
            throw new IllegalArgumentException("start and end must use the same zone");
        }
        if (!start.isBefore(end)) {
            throw new IllegalArgumentException("start must be before end");
        }
    }
}
```

---

## 64. Record dan Units

Jangan gunakan primitive tanpa unit kalau domain sensitif.

Buruk:

```java
record TimeoutConfig(long timeout) {}
```

Apakah milliseconds? seconds? nanos?

Lebih baik:

```java
record TimeoutConfig(Duration timeout) {
    public TimeoutConfig {
        Objects.requireNonNull(timeout);
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
    }
}
```

Atau:

```java
record StorageSizeBytes(long value) {}
```

Nama component/type harus menyampaikan unit.

---

## 65. Record dan Money

Buruk:

```java
record Payment(double amount) {}
```

Lebih baik:

```java
public record Money(String currency, long minorUnits) {
    public Money {
        currency = Objects.requireNonNull(currency).toUpperCase(Locale.ROOT);
        if (!currency.matches("[A-Z]{3}")) {
            throw new IllegalArgumentException("currency must be ISO-like 3-letter code");
        }
    }
}
```

Atau gunakan `BigDecimal` dengan scale policy eksplisit.

Record membantu membungkus money, tetapi tidak otomatis menentukan rounding, scale, currency minor unit, atau regulatory calculation rule.

---

## 66. Record dan Error/Result Modelling

Daripada throw exception untuk semua validation branch, record/ sealed result bisa lebih eksplisit.

```java
sealed interface ParseResult<T> permits ParseSuccess, ParseFailure {}

record ParseSuccess<T>(T value) implements ParseResult<T> {}
record ParseFailure<T>(String message, int line, int column) implements ParseResult<T> {}
```

Ini sangat berguna untuk SAX/DOM parsing nanti:

- parser bisa melaporkan lokasi error;
- caller bisa aggregate errors;
- tidak semua invalid input harus exception;
- result type menjadi bagian dari contract.

---

## 67. Record dan API Layer: Request vs Response

Request record:

```java
record CreateUserRequest(String email, String displayName) {}
```

Response record:

```java
record UserResponse(String id, String email, String displayName, Instant createdAt) {}
```

Jangan pakai satu record untuk request dan response hanya karena field mirip.

Masalah kalau digabung:

- request tidak punya server-generated ID;
- response tidak butuh password;
- validation beda;
- compatibility beda;
- security risk.

Lebih baik type terpisah meski mirip.

---

## 68. Record dan Layer Leakage

Buruk:

```java
record UserRecord(Long id, String email, String dbStatus, String apiStatus, String uiLabel) {}
```

Ini mencampur DB/API/UI concerns.

Lebih baik:

```java
record UserRow(Long id, String email, String statusCode) {}
record UserResponse(String id, String email, String status) {}
record UserViewModel(String displayName, String statusLabel) {}
```

Record harus memperjelas boundary, bukan menghapus boundary.

---

## 69. Record dan Versioned External Contract

Untuk external event/API, pertimbangkan versioning explicit.

```java
public record CaseSubmittedV1(
        String caseId,
        String applicantId,
        Instant submittedAt
) {}

public record CaseSubmittedV2(
        String caseId,
        String applicantId,
        String channel,
        Instant submittedAt
) {}
```

Atau envelope:

```java
public record EventEnvelope<T>(
        String eventType,
        int schemaVersion,
        String eventId,
        Instant occurredAt,
        T payload
) {}
```

Record membuat schema eksplisit, tetapi schema evolution tetap harus didesain.

---

## 70. Practical Example: Designing a Safe `CaseTransition` Record

Naive:

```java
record CaseTransition(String caseId, String from, String to, String actor, Instant at) {}
```

Lebih baik:

```java
public record CaseTransition(
        CaseId caseId,
        CaseStatus fromStatus,
        CaseStatus toStatus,
        UserId actorUserId,
        Instant occurredAt,
        String reasonCode
) {
    public CaseTransition {
        caseId = Objects.requireNonNull(caseId, "caseId");
        fromStatus = Objects.requireNonNull(fromStatus, "fromStatus");
        toStatus = Objects.requireNonNull(toStatus, "toStatus");
        actorUserId = Objects.requireNonNull(actorUserId, "actorUserId");
        occurredAt = Objects.requireNonNull(occurredAt, "occurredAt");

        if (fromStatus == toStatus) {
            throw new IllegalArgumentException("fromStatus and toStatus must differ");
        }

        if (reasonCode != null) {
            reasonCode = reasonCode.trim().toUpperCase(Locale.ROOT);
            if (reasonCode.isBlank()) {
                reasonCode = null;
            }
        }
    }
}
```

Support types:

```java
public record CaseId(String value) {
    public CaseId {
        value = Objects.requireNonNull(value).trim();
        if (value.isBlank()) {
            throw new IllegalArgumentException("caseId must not be blank");
        }
    }
}

public record UserId(String value) {
    public UserId {
        value = Objects.requireNonNull(value).trim();
        if (value.isBlank()) {
            throw new IllegalArgumentException("userId must not be blank");
        }
    }
}

enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

Kenapa lebih baik:

- `CaseId` dan `UserId` tidak tertukar walau sama-sama string;
- status terbatas enum;
- invariant lokal ditegakkan;
- normalization dilakukan sekali;
- type bisa dipakai sebagai event/command/audit payload;
- lebih mudah dites.

---

## 71. Practical Example: Defensive XML Parse Result

```java
public record ParsedXmlCase(
        String sourceFileName,
        String caseId,
        String applicantName,
        List<String> documentIds,
        XmlLocation location
) {
    public ParsedXmlCase {
        sourceFileName = Objects.requireNonNull(sourceFileName, "sourceFileName");
        caseId = Objects.requireNonNull(caseId, "caseId").trim();
        applicantName = Objects.requireNonNull(applicantName, "applicantName").trim();
        documentIds = List.copyOf(documentIds == null ? List.of() : documentIds);
        location = Objects.requireNonNull(location, "location");

        if (caseId.isBlank()) {
            throw new IllegalArgumentException("caseId must not be blank");
        }
        if (applicantName.isBlank()) {
            throw new IllegalArgumentException("applicantName must not be blank");
        }
    }
}

public record XmlLocation(int line, int column) {
    public XmlLocation {
        if (line < 1) {
            throw new IllegalArgumentException("line must be >= 1");
        }
        if (column < 1) {
            throw new IllegalArgumentException("column must be >= 1");
        }
    }
}
```

Ini akan relevan ketika masuk SAX `Locator` dan DOM error reporting.

---

## 72. Failure Modes Checklist

### 72.1 Mutable Component Leak

```java
record R(List<String> values) {}
```

Fix:

```java
record R(List<String> values) {
    public R { values = List.copyOf(values); }
}
```

### 72.2 Array Equality Trap

```java
record Digest(byte[] bytes) {}
```

Default equality membandingkan array reference. Hindari atau override dengan sangat hati-hati.

### 72.3 Sensitive `toString`

```java
record Token(String accessToken) {}
```

Default `toString` bocor. Override atau jangan gunakan record.

### 72.4 Public API Header Change

Menambah/rename/reorder component adalah breaking change.

### 72.5 Record sebagai Entity

Record tidak cocok untuk lifecycle/proxy/mutation-heavy entity.

### 72.6 Too Many Components

Constructor sulit dibaca dan rawan tertukar.

### 72.7 Boolean Blindness

Banyak boolean flags menghasilkan invalid combinations.

### 72.8 Null Assumption

Record tidak otomatis non-null.

### 72.9 Framework Compatibility

Framework lama mungkin butuh getter/setter/no-arg constructor.

### 72.10 Overusing Record for Everything

Tidak semua class seharusnya record. Jika representation harus tersembunyi, behavior kompleks, atau lifecycle mutable, class biasa lebih baik.

---

## 73. Production Checklist

Sebelum membuat record baru, jawab:

1. Apakah type ini terutama data carrier transparan?
2. Apakah semua component merupakan bagian dari public semantic state?
3. Apakah equality berdasarkan semua component memang benar?
4. Apakah `toString` default aman?
5. Apakah components immutable atau sudah defensive copied?
6. Apakah nullability jelas?
7. Apakah constructor menegakkan invariant lokal?
8. Apakah component names stabil untuk API/mapping?
9. Apakah jumlah component masih readable?
10. Apakah type ini bukan entity lifecycle/proxy object?
11. Apakah framework target mendukung record?
12. Apakah Java baseline minimal mendukung record?
13. Apakah public compatibility sudah dipikirkan?
14. Apakah record ini cocok dengan module/reflection boundary?
15. Apakah performance `equals/hashCode/toString` aman untuk component size?

---

## 74. Latihan Pemahaman

### Latihan 1 — Refactor Primitive Obsession

Ubah desain berikut menjadi record/value objects yang lebih aman:

```java
record Assignment(String caseId, String officerId, String queue, String status) {}
```

Pertanyaan:

- component mana yang sebaiknya punya type sendiri?
- apakah `status` sebaiknya enum?
- invariant apa yang bisa ditegakkan lokal?
- field apa yang boleh nullable?

### Latihan 2 — Defensive Copy

Desain record untuk:

```text
WorkflowDefinition:
- workflowCode
- list of states
- map of allowedTransitions: fromState -> allowed target states
```

Pastikan external caller tidak bisa mutate state internal.

### Latihan 3 — API Compatibility

Kamu punya public record:

```java
record UserResponse(String id, String name) {}
```

Sekarang product ingin menambah `email`, `phone`, dan `status`. Apa strategi yang paling aman?

Bandingkan:

- langsung tambah component;
- buat `UserResponseV2`;
- buat nested `ContactInfo`;
- pakai optional fields;
- mapping layer external.

### Latihan 4 — Record atau Class?

Tentukan apakah cocok sebagai record:

1. `Money`
2. `UserEntity`
3. `CaseSubmittedEvent`
4. `HttpClientWithConnectionPool`
5. `ParsedXmlApplicant`
6. `MutableShoppingCart`
7. `ReportSearchFilter`
8. `DbCredentials`

Jelaskan alasannya.

---

## 75. Ringkasan

Record adalah salah satu fitur paling penting dalam Java modern karena ia mengubah cara kita mendesain data carrier. Namun nilai utamanya bukan pengurangan boilerplate. Nilai utamanya adalah **kontrak eksplisit**: komponen record adalah state utama yang transparan, constructor canonical adalah jalur pembentukan object, dan equality/hash/toString default mengikuti komponen tersebut.

Record cocok untuk value object kecil, command, event, query projection, parser output, cache key kecil, API DTO yang stabil, dan sealed hierarchy variants. Record kurang cocok untuk entity persistence mutable, object dengan hidden representation, object yang butuh inheritance/proxy, sensitive secret holder, atau schema yang sering berubah tanpa versioning.

Hal paling penting yang harus diingat:

```text
Record makes data shape explicit.
It does not automatically make data valid, deeply immutable, secure, cheap, or evolution-friendly.
```

Engineer yang matang menggunakan record untuk memperjelas boundary, menegakkan invariant lokal, mengurangi primitive obsession, dan membuat data flow lebih eksplisit—bukan untuk mengganti semua class.

---

## 76. Status Seri

Part ini adalah **Part 9 dari 32** dalam series:

```text
learn-java-lang-dom-sax-core-runtime-platform-contracts
```

Seri **belum selesai**.

Part berikutnya:

```text
10-sealed-types-runtime-view-permitted-subclasses-exhaustiveness.md
```

Topik berikutnya: **Sealed Types Runtime View: `Class`, Permitted Subclasses, and Exhaustiveness**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./08-enum-constant-identity-type-safety-switch-serialization.md">⬅️ Part 8 — `Enum`: Constant Identity, Type Safety, Switch, Serialization, Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./10-sealed-types-runtime-view-permitted-subclasses-exhaustiveness.md">Part 10 — Sealed Types Runtime View: `Class`, Permitted Subclasses, and Exhaustiveness ➡️</a>
</div>
