# learn-java-oop-functional-reflection-codegen-modules-part-008

# Records Deep Dive: Value-Carrying Types, Canonical Constructor, and API Design

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `008`  
> Topik: Java Records sebagai value-carrying types, canonical constructor, compact constructor, validation, immutability boundary, API design, serialization, reflection, pattern matching, dan evolution risk.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- object identity, equality, hashing, dan immutability;
- encapsulation sebagai perlindungan invariant;
- inheritance dan substitutability;
- interface sebagai contract/capability/SPI;
- sealed hierarchy sebagai closed-world modelling.

Sekarang kita masuk ke **records**.

Records adalah fitur Java yang tampak sederhana, tetapi punya dampak besar terhadap cara kita mendesain object model. Banyak developer melihat record sebagai:

```java
public record UserDto(String id, String name) {}
```

lalu menyimpulkan:

> “Record = Lombok `@Data` versi Java.”

Kesimpulan itu terlalu dangkal.

Record bukan sekadar generator constructor/getter/equals/hashCode/toString. Record adalah **deklarasi niat desain**:

> “Type ini adalah pembawa data transparan dengan komponen tetap.”

Artinya, ketika kita memilih record, kita sedang membuat beberapa keputusan desain sekaligus:

1. State utama type ini dinyatakan lengkap di record header.
2. Field component bersifat final.
3. Accessor component bersifat public.
4. Equality/hash/toString berbasis component.
5. Type ini lebih dekat ke value-carrier daripada behavior-rich entity.
6. Evolusi public API-nya lebih sensitif karena header adalah contract.

Mental model utama part ini:

> **Record adalah class khusus untuk data aggregate yang transparent, shallowly immutable, dan structurally described by its components.**

---

## 1. Apa Itu Record Secara Konseptual?

Secara bahasa Java, record adalah special kind of class.

Contoh:

```java
public record Money(String currency, long amountMinor) {}
```

Deklarasi tersebut secara konseptual menyatakan:

```java
public final class Money extends java.lang.Record {
    private final String currency;
    private final long amountMinor;

    public Money(String currency, long amountMinor) {
        this.currency = currency;
        this.amountMinor = amountMinor;
    }

    public String currency() {
        return currency;
    }

    public long amountMinor() {
        return amountMinor;
    }

    @Override
    public boolean equals(Object o) { ... component-based ... }

    @Override
    public int hashCode() { ... component-based ... }

    @Override
    public String toString() { ... component-based ... }
}
```

Namun ini bukan ekspansi source code literal. Compiler menghasilkan struktur class dengan aturan khusus.

Poin penting:

- Record tetap class.
- Record punya constructor.
- Record bisa punya method tambahan.
- Record bisa implement interface.
- Record bisa punya static field/method.
- Record bisa punya nested type.
- Record tidak bisa extend class lain secara eksplisit.
- Record secara implisit extend `java.lang.Record`.
- Record secara implisit final.
- Record component menghasilkan private final field dan public accessor.

---

## 2. Record Bukan “Immutable Object” Secara Penuh

Dokumentasi `java.lang.Record` menyebut record sebagai **shallowly immutable** transparent carrier.

Kata pentingnya adalah **shallowly**.

Contoh record yang terlihat immutable tetapi sebenarnya bocor:

```java
public record OrderSnapshot(String orderId, List<String> itemIds) {}
```

Masalah:

```java
List<String> items = new ArrayList<>();
items.add("A");

OrderSnapshot snapshot = new OrderSnapshot("ORD-1", items);

items.add("B");

System.out.println(snapshot.itemIds()); // [A, B]
```

Record field `itemIds` memang final, tetapi object `List` yang direferensikan tetap mutable.

Jadi:

- final reference ≠ immutable object;
- record ≠ deep immutable;
- record hanya mencegah re-assignment component field;
- record tidak otomatis defensive copy;
- record tidak otomatis membuat nested object immutable.

Versi lebih aman:

```java
public record OrderSnapshot(String orderId, List<String> itemIds) {
    public OrderSnapshot {
        itemIds = List.copyOf(itemIds);
    }
}
```

Sekarang record menyimpan copy yang tidak dapat dimodifikasi melalui API `List` biasa.

Namun tetap perlu sadar:

```java
public record Group(List<Member> members) {
    public Group {
        members = List.copyOf(members);
    }
}

public final class Member {
    private String name;
    public void rename(String newName) {
        this.name = newName;
    }
}
```

`List.copyOf` melindungi struktur list, bukan mutability `Member` di dalamnya.

Mental model:

```text
record immutability level:

field assignment immutable       yes
reference immutable              yes
referenced object immutable       not guaranteed
nested object immutable           not guaranteed
deep immutability                 must be designed manually
```

---

## 3. Record Header Adalah Contract

Deklarasi record:

```java
public record CustomerView(
    String customerId,
    String displayName,
    String email
) {}
```

Header record menyatakan contract public:

1. Component `customerId` ada.
2. Type-nya `String`.
3. Ada accessor `customerId()`.
4. Ada constructor canonical dengan parameter tersebut.
5. `equals/hashCode/toString` memasukkan component tersebut.
6. Reflection dapat membaca record component metadata.
7. Serialization/framework binding bisa mengandalkan component tersebut.

Karena itu, mengganti header record bukan refactor kecil.

Misalnya:

```java
public record CustomerView(
    String id,
    String displayName,
    String email
) {}
```

Secara manusia mungkin `customerId` dan `id` sama. Namun secara API:

- accessor berubah dari `customerId()` ke `id()`;
- canonical constructor signature berubah;
- JSON mapping mungkin berubah;
- reflection-based mapper bisa rusak;
- binary/source compatibility dapat terdampak;
- documentation contract berubah.

Record header adalah bagian paling penting dari desain record.

---

## 4. Kapan Record Cocok?

Record cocok ketika type adalah **transparent carrier of data**.

Contoh bagus:

```java
public record PostalAddress(
    String block,
    String street,
    String postalCode
) {}
```

```java
public record PageRequest(
    int page,
    int size
) {}
```

```java
public record Money(
    Currency currency,
    long amountMinor
) {}
```

```java
public record ValidationError(
    String field,
    String code,
    String message
) {}
```

```java
public record CaseSummary(
    String caseId,
    String status,
    Instant lastUpdatedAt
) {}
```

Record cocok untuk:

- DTO;
- read model;
- query result;
- command payload;
- event payload;
- response view;
- validation error;
- small value object;
- immutable snapshot;
- composite key;
- intermediate transformation result;
- data transfer antar layer;
- data shape untuk pattern matching.

---

## 5. Kapan Record Tidak Cocok?

Record kurang cocok ketika type perlu menyembunyikan representasi internal secara kuat.

Contoh:

```java
public record PasswordHash(byte[] bytes) {}
```

Ini buruk karena:

- component `bytes` terekspos melalui accessor;
- array mutable;
- `equals` untuk array memakai reference equality, bukan content equality;
- `toString` bisa membocorkan informasi bentuk internal;
- security-sensitive state tidak seharusnya transparent.

Lebih baik:

```java
public final class PasswordHash {
    private final byte[] bytes;

    public PasswordHash(byte[] bytes) {
        this.bytes = bytes.clone();
    }

    public boolean matches(byte[] candidateHash) {
        return MessageDigest.isEqual(bytes, candidateHash);
    }

    public byte[] copyBytesForStorage() {
        return bytes.clone();
    }
}
```

Record juga kurang cocok untuk:

- entity dengan identity lifecycle;
- aggregate root dengan invariant kompleks;
- object yang butuh lazy loading;
- object yang butuh mutation terkontrol;
- object dengan representasi internal rahasia;
- type security-sensitive;
- type dengan field mutable array/collection tanpa defensive copy;
- API publik yang kemungkinan sering berubah;
- hierarchy polymorphic berbasis inheritance;
- type yang equality-nya bukan component-based.

---

## 6. Record vs Class

Pertanyaan desainnya bukan:

> “Bisa tidak dibuat record?”

Tapi:

> “Apakah public shape type ini memang seluruh semantic state-nya?”

Bandingkan:

```java
public record Money(String currency, long amountMinor) {}
```

vs

```java
public final class Money {
    private final Currency currency;
    private final long amountMinor;

    private Money(Currency currency, long amountMinor) {
        this.currency = currency;
        this.amountMinor = amountMinor;
    }

    public static Money of(Currency currency, BigDecimal majorAmount) {
        // rounding, scale, currency minor unit validation
    }

    public Money add(Money other) { ... }
}
```

Record version cocok bila:

- representation sederhana;
- tidak banyak behavior;
- tidak perlu menyembunyikan construction policy;
- semua component memang boleh diketahui public.

Class version cocok bila:

- construction perlu factory kompleks;
- invariant kuat;
- representasi internal bisa berubah;
- API behavior lebih penting daripada data exposure;
- compatibility jangka panjang penting;
- equality perlu custom semantic.

Rule sederhana:

```text
Use record when public data shape is the semantic contract.
Use class when behavior, invariants, or representation hiding dominate.
```

---

## 7. Record Component

Deklarasi:

```java
public record UserProfile(
    String userId,
    String displayName,
    String email
) {}
```

`userId`, `displayName`, dan `email` adalah record components.

Untuk setiap component, compiler menyediakan:

- private final field;
- public accessor method dengan nama sama;
- parameter canonical constructor;
- part of record descriptor;
- part of generated `equals/hashCode/toString`.

Accessor record tidak memakai prefix `get`.

```java
profile.userId();      // yes
profile.getUserId();   // no, kecuali dibuat manual
```

Ini penting untuk framework dan convention. Banyak JavaBeans-based framework historically mengharapkan `getX()`, tetapi modern framework biasanya sudah mendukung records.

---

## 8. Canonical Constructor

Canonical constructor adalah constructor utama yang parameternya sama dengan record components.

```java
public record PageRequest(int page, int size) {
    public PageRequest(int page, int size) {
        if (page < 0) {
            throw new IllegalArgumentException("page must be >= 0");
        }
        if (size <= 0 || size > 100) {
            throw new IllegalArgumentException("size must be between 1 and 100");
        }
        this.page = page;
        this.size = size;
    }
}
```

Constructor ini eksplisit menugaskan semua fields.

Kelebihan:

- jelas;
- familiar;
- mudah ketika perlu transformasi kompleks.

Kekurangan:

- repetitif;
- rawan salah assign;
- kurang idiomatis untuk validasi sederhana.

---

## 9. Compact Constructor

Compact constructor adalah canonical constructor yang tidak menulis parameter list dan tidak melakukan assignment fields secara eksplisit.

```java
public record PageRequest(int page, int size) {
    public PageRequest {
        if (page < 0) {
            throw new IllegalArgumentException("page must be >= 0");
        }
        if (size <= 0 || size > 100) {
            throw new IllegalArgumentException("size must be between 1 and 100");
        }
    }
}
```

Compiler akan melakukan assignment ke component fields setelah body compact constructor selesai.

Artinya, di dalam compact constructor, kita bisa melakukan validation dan normalization terhadap parameter.

Contoh normalization:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        Objects.requireNonNull(value, "value");
        value = value.trim().toLowerCase(Locale.ROOT);

        if (!value.contains("@")) {
            throw new IllegalArgumentException("invalid email address");
        }
    }
}
```

Perhatikan:

```java
value = value.trim().toLowerCase(Locale.ROOT);
```

Ini mengubah parameter constructor, bukan field. Setelah compact constructor selesai, compiler menugaskan nilai parameter yang sudah dinormalisasi ke field.

---

## 10. Validation Dalam Record

Record sering dipakai sebagai DTO, tetapi DTO juga bisa membawa invariant.

Contoh:

```java
public record DateRange(LocalDate start, LocalDate end) {
    public DateRange {
        Objects.requireNonNull(start, "start");
        Objects.requireNonNull(end, "end");

        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
    }
}
```

Ini bagus karena invariant `end >= start` dijaga di satu tempat.

Namun jangan gunakan record constructor untuk validasi yang butuh dependency eksternal:

```java
public record UserRegistration(String email) {
    public UserRegistration {
        // buruk: constructor memanggil database/service eksternal
        if (emailRepository.exists(email)) { ... }
    }
}
```

Constructor sebaiknya menjaga invariant lokal yang deterministic.

Validasi yang memerlukan:

- database;
- remote API;
- clock volatile;
- user session;
- permission;
- transaction;
- distributed lock;

sebaiknya dilakukan di service/application layer, bukan record constructor.

---

## 11. Normalization Dalam Record

Normalization membuat representation konsisten.

Contoh:

```java
public record PostalCode(String value) {
    public PostalCode {
        Objects.requireNonNull(value, "value");
        value = value.trim();

        if (!value.matches("\\d{6}")) {
            throw new IllegalArgumentException("postal code must be 6 digits");
        }
    }
}
```

Keuntungan:

```java
new PostalCode(" 123456 ").equals(new PostalCode("123456")) // true
```

Karena normalization dilakukan sebelum field assignment.

Tapi hati-hati: normalization harus predictable dan tidak mengubah semantic secara mengejutkan.

Contoh buruk:

```java
public record PersonName(String value) {
    public PersonName {
        value = value.toUpperCase(); // bisa salah untuk locale tertentu
    }
}
```

Lebih aman:

```java
value = value.strip();
```

Untuk case-sensitive identifier, jangan normalisasi sembarangan.

---

## 12. Defensive Copy Dalam Record

Record dengan collection component hampir selalu perlu defensive copy.

Buruk:

```java
public record RoleAssignment(String userId, List<String> roles) {}
```

Lebih aman:

```java
public record RoleAssignment(String userId, List<String> roles) {
    public RoleAssignment {
        Objects.requireNonNull(userId, "userId");
        roles = List.copyOf(roles);
    }
}
```

Namun `List.copyOf(null)` akan throw `NullPointerException`; jika ingin error message jelas:

```java
public record RoleAssignment(String userId, List<String> roles) {
    public RoleAssignment {
        Objects.requireNonNull(userId, "userId");
        Objects.requireNonNull(roles, "roles");
        roles = List.copyOf(roles);
    }
}
```

Jika element juga harus non-null:

```java
public record RoleAssignment(String userId, List<String> roles) {
    public RoleAssignment {
        Objects.requireNonNull(userId, "userId");
        Objects.requireNonNull(roles, "roles");
        roles.forEach(role -> Objects.requireNonNull(role, "role"));
        roles = List.copyOf(roles);
    }
}
```

Atau dengan explicit loop supaya error lebih informatif:

```java
public record RoleAssignment(String userId, List<String> roles) {
    public RoleAssignment {
        Objects.requireNonNull(userId, "userId");
        Objects.requireNonNull(roles, "roles");

        for (int i = 0; i < roles.size(); i++) {
            if (roles.get(i) == null) {
                throw new IllegalArgumentException("roles[" + i + "] must not be null");
            }
        }

        roles = List.copyOf(roles);
    }
}
```

---

## 13. Record Dengan Array: Hampir Selalu Bahaya

Array adalah mutable dan `equals` array default adalah identity equality.

Buruk:

```java
public record Digest(byte[] value) {}
```

Masalah:

```java
byte[] a = {1, 2, 3};
byte[] b = {1, 2, 3};

Digest d1 = new Digest(a);
Digest d2 = new Digest(b);

System.out.println(d1.equals(d2)); // false, karena byte[] equals = reference equality
```

Selain itu:

```java
byte[] raw = {1, 2, 3};
Digest digest = new Digest(raw);
raw[0] = 9;
```

State record berubah secara tidak langsung.

Bisa diperbaiki sebagian:

```java
public record Digest(byte[] value) {
    public Digest {
        value = value.clone();
    }

    @Override
    public byte[] value() {
        return value.clone();
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof Digest d && Arrays.equals(value, d.value);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(value);
    }

    @Override
    public String toString() {
        return "Digest[value=<redacted>]";
    }
}
```

Tapi setelah override sebanyak ini, pertanyaannya:

> Apakah ini masih pantas menjadi record?

Sering kali jawabannya: tidak.

Lebih baik pakai class biasa jika representation sensitive/mutable.

---

## 14. Record Accessor Bisa Dioverride

Record accessor default bisa diganti, tetapi harus hati-hati.

Contoh yang masih masuk akal:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        value = value.trim().toLowerCase(Locale.ROOT);
    }

    public String domain() {
        return value.substring(value.indexOf('@') + 1);
    }
}
```

Accessor `value()` tidak dioverride.

Contoh berisiko:

```java
public record Secret(String value) {
    @Override
    public String value() {
        return "****";
    }
}
```

Masalah:

- record mengklaim transparent carrier;
- accessor tidak mengembalikan component asli;
- `equals/hashCode` tetap berdasarkan field asli;
- developer lain akan bingung;
- framework bisa punya asumsi berbeda.

Jika data tidak boleh diekspos, jangan gunakan record.

---

## 15. Record dan Behavior

Record boleh punya method behavior.

```java
public record Money(Currency currency, long amountMinor) {
    public Money {
        Objects.requireNonNull(currency, "currency");
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(currency, amountMinor + other.amountMinor);
    }

    public boolean isZero() {
        return amountMinor == 0;
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("currency mismatch");
        }
    }
}
```

Ini tetap masuk akal karena behavior berasal dari components dan tidak menyembunyikan lifecycle state.

Record tidak berarti “anemic”. Record bisa punya behavior, tetapi behavior-nya sebaiknya:

- pure atau mostly pure;
- deterministic;
- berbasis component;
- tidak membutuhkan mutable lifecycle;
- tidak mengubah state internal.

---

## 16. Record Sebagai DTO

Record sangat cocok untuk DTO sederhana.

```java
public record UserResponse(
    String id,
    String displayName,
    String email
) {}
```

Keuntungan:

- concise;
- immutable by default at field level;
- jelas shape-nya;
- cocok untuk serialization/deserialization modern;
- enak untuk test assertion;
- mengurangi boilerplate;
- cocok untuk query projection.

Namun DTO publik perlu hati-hati terhadap API evolution.

Jika record menjadi response API eksternal:

```java
public record CaseResponse(
    String caseId,
    String status,
    Instant submittedAt
) {}
```

Menambah component:

```java
public record CaseResponse(
    String caseId,
    String status,
    Instant submittedAt,
    String officerName
) {}
```

Secara Java constructor berubah. Jika consumer Java memanggil constructor langsung, mereka rusak. Jika hanya JSON consumer, bisa jadi aman tergantung compatibility policy.

Jangan menyamakan compatibility JSON dengan compatibility Java binary/source.

---

## 17. Record Sebagai Value Object

Record bisa bagus untuk value object sederhana.

```java
public record CaseNumber(String value) {
    public CaseNumber {
        Objects.requireNonNull(value, "value");
        value = value.trim().toUpperCase(Locale.ROOT);

        if (!value.matches("CASE-[0-9]{6}")) {
            throw new IllegalArgumentException("invalid case number");
        }
    }
}
```

Ini bagus karena:

- value object hanya punya satu value;
- invariant lokal;
- equality berbasis value;
- representation memang boleh transparan;
- behavior sederhana.

Namun untuk value object yang butuh representation hiding, gunakan class.

Contoh:

```java
public final class NationalId {
    private final String normalized;

    private NationalId(String normalized) {
        this.normalized = normalized;
    }

    public static NationalId parse(String raw) { ... }

    public String masked() { ... }

    public boolean sameAs(NationalId other) { ... }
}
```

---

## 18. Record Sebagai Command, Event, Query

Record sering sangat cocok untuk message types.

Command:

```java
public record SubmitApplicationCommand(
    String applicantId,
    String applicationType,
    Instant submittedAt
) {}
```

Event:

```java
public record ApplicationSubmittedEvent(
    String applicationId,
    String applicantId,
    Instant occurredAt
) {}
```

Query:

```java
public record FindApplicationsQuery(
    String applicantId,
    String status,
    int page,
    int size
) {}
```

Tetapi jangan lupa:

- command/event sering perlu versioning;
- menambah component bisa mempengaruhi deserialization;
- component name menjadi contract;
- event lama harus tetap bisa dibaca;
- default value tidak otomatis ada;
- schema evolution perlu strategi.

Untuk event jangka panjang, pertimbangkan:

```java
public record ApplicationSubmittedV1(
    String applicationId,
    String applicantId,
    Instant occurredAt
) {}

public record ApplicationSubmittedV2(
    String applicationId,
    String applicantId,
    String channel,
    Instant occurredAt
) {}
```

Atau gunakan envelope:

```java
public record DomainEventEnvelope<T>(
    String eventId,
    String eventType,
    int schemaVersion,
    Instant occurredAt,
    T payload
) {}
```

---

## 19. Record dan Sealed Hierarchy

Record sangat kuat ketika dipadukan dengan sealed interface.

Contoh result modeling:

```java
public sealed interface SubmitResult
        permits SubmitResult.Accepted,
                SubmitResult.Rejected,
                SubmitResult.Duplicate {

    record Accepted(String applicationId) implements SubmitResult {}

    record Rejected(List<String> errors) implements SubmitResult {
        public Rejected {
            errors = List.copyOf(errors);
        }
    }

    record Duplicate(String existingApplicationId) implements SubmitResult {}
}
```

Konsumen bisa melakukan exhaustive switch:

```java
String message = switch (result) {
    case SubmitResult.Accepted accepted ->
        "Accepted: " + accepted.applicationId();
    case SubmitResult.Rejected rejected ->
        "Rejected: " + rejected.errors();
    case SubmitResult.Duplicate duplicate ->
        "Duplicate: " + duplicate.existingApplicationId();
};
```

Ini sangat cocok untuk:

- business outcome;
- validation result;
- workflow transition result;
- parsing result;
- command handling result;
- domain error taxonomy;
- finite state modeling.

Pattern ini sering lebih jelas daripada:

```java
class Result {
    boolean success;
    String errorCode;
    Object payload;
}
```

Karena tiap variant punya data shape yang tepat.

---

## 20. Record vs Enum

Enum cocok untuk finite set tanpa banyak per-instance data berbeda.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Record cocok untuk membawa data.

```java
public record StatusChange(
    CaseStatus from,
    CaseStatus to,
    String reason,
    Instant changedAt
) {}
```

Sealed + record cocok ketika setiap variant membawa data berbeda.

```java
public sealed interface CaseDecision {
    record Approved(String officerId, Instant approvedAt) implements CaseDecision {}
    record Rejected(String officerId, String reason, Instant rejectedAt) implements CaseDecision {}
    record Withdrawn(String applicantId, Instant withdrawnAt) implements CaseDecision {}
}
```

Decision matrix:

```text
finite constants, no payload             enum
finite variants, different payload        sealed interface + records
plain aggregate data                      record
behavior-rich lifecycle object            class
```

---

## 21. Record dan Pattern Matching

Records adalah transparent carriers. Pattern matching membuat transparansi itu makin berguna.

Konsepnya:

```java
record Point(int x, int y) {}
```

Dengan record pattern, data bisa didekonstruksi secara langsung dalam pattern matching.

Walaupun detail syntax bergantung versi Java yang digunakan, mental modelnya:

```text
record construction:
  new Point(10, 20)

record deconstruction:
  Point(int x, int y)
```

Ini membuat record cocok untuk data-oriented programming:

- data shape jelas;
- variant sealed jelas;
- switch exhaustive;
- transformation eksplisit;
- boilerplate visitor berkurang.

Namun jangan menjadikan semua domain object record hanya karena pattern matching terlihat menarik.

Jika domain object perlu menjaga state dan behavior kompleks, class tetap lebih cocok.

---

## 22. Record dan Serialization

Record sering dipakai sebagai serialization target.

Contoh JSON:

```java
public record CreateUserRequest(
    String email,
    String displayName
) {}
```

Hal-hal yang harus dicek:

1. Apakah framework mendukung records?
2. Apakah nama component sesuai nama field JSON?
3. Apakah constructor validation compatible dengan deserialization?
4. Bagaimana menangani missing field?
5. Bagaimana menangani unknown field?
6. Bagaimana versioning dilakukan?
7. Apakah component type immutable?
8. Apakah default value perlu?

Record tidak punya no-args constructor. Framework yang memerlukan no-args constructor tradisional bisa bermasalah.

Jangan desain record hanya berdasarkan kebutuhan framework lama.

Jika framework memaksa mutable POJO:

```java
public class CreateUserRequestDto {
    private String email;
    private String displayName;

    public CreateUserRequestDto() {}

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
}
```

maka bisa gunakan DTO mutable di boundary, lalu convert ke domain record/class yang lebih aman.

---

## 23. Record dan Java Serialization

Record punya treatment khusus dalam Java serialization. Namun untuk sistem modern, Java native serialization sering dihindari karena isu security, compatibility, dan operational risk.

Jika record digunakan untuk persistence atau wire protocol, lebih baik gunakan schema/protocol eksplisit seperti:

- JSON dengan compatibility policy;
- Avro;
- Protobuf;
- database schema;
- explicit mapper;
- event schema registry;
- custom serialization yang terkontrol.

Jangan mengandalkan `Serializable` sebagai desain distributed contract.

Contoh:

```java
public record UserSnapshot(String id, String name) implements Serializable {}
```

Ini compile, tetapi belum berarti cocok untuk long-term storage contract.

Masalah:

- serialVersionUID;
- class name coupling;
- package coupling;
- binary compatibility;
- deserialization security;
- classpath dependency;
- version evolution.

---

## 24. Record dan Reflection

Record bisa diinspeksi via reflection.

Contoh:

```java
public record UserProfile(String userId, String displayName) {}
```

Reflection:

```java
Class<UserProfile> type = UserProfile.class;

System.out.println(type.isRecord());

for (RecordComponent component : type.getRecordComponents()) {
    System.out.println(component.getName());
    System.out.println(component.getType());
    System.out.println(component.getAccessor());
}
```

Ini penting untuk:

- JSON mapper;
- object mapper;
- validation framework;
- documentation generator;
- schema generator;
- query projection;
- code generation;
- test tooling.

Namun reflection terhadap record tetap harus menghormati:

- access control;
- module encapsulation;
- component metadata;
- constructor signature;
- generic type information limitations.

---

## 25. Record dan Annotation

Annotation bisa dipasang pada record component.

```java
public record RegisterUserRequest(
    @NotBlank String email,
    @NotBlank String displayName
) {}
```

Record component annotation bisa memiliki dampak ke beberapa target tergantung annotation target-nya:

- record component;
- field;
- accessor method;
- constructor parameter.

Karena itu annotation design untuk record perlu hati-hati.

Jika membuat annotation sendiri:

```java
@Target({ElementType.RECORD_COMPONENT, ElementType.PARAMETER, ElementType.FIELD})
@Retention(RetentionPolicy.RUNTIME)
public @interface Sensitive {}
```

Pertimbangkan siapa konsumen annotation:

- annotation processor?
- runtime reflection?
- serializer?
- validator?
- documentation generator?
- logging redactor?

Record membuat metadata lebih terstruktur, tetapi juga membuat metadata target lebih penting.

---

## 26. Record dan Annotation Processing

Annotation processor dapat membaca record components dari element model.

Use case:

- generate mapper;
- generate schema;
- generate validator;
- generate documentation;
- generate SQL projection;
- generate metadata index.

Contoh konsep:

```java
@GenerateSchema
public record ApplicationView(
    String applicationId,
    String status,
    Instant submittedAt
) {}
```

Processor bisa menghasilkan:

```json
{
  "name": "ApplicationView",
  "components": [
    { "name": "applicationId", "type": "java.lang.String" },
    { "name": "status", "type": "java.lang.String" },
    { "name": "submittedAt", "type": "java.time.Instant" }
  ]
}
```

Keuntungan record untuk code generation:

- shape eksplisit;
- component order jelas;
- canonical constructor jelas;
- accessor convention sederhana;
- boilerplate rendah;
- mapping lebih deterministic.

Risiko:

- generator terlalu bergantung pada component order;
- perubahan nama component memecah generated code;
- nested generic component sulit;
- annotation target salah;
- generated code tidak compatible dengan compact constructor validation.

---

## 27. Record dan Builder Pattern

Record tidak otomatis cocok dengan builder.

Contoh record dengan banyak field:

```java
public record SearchCriteria(
    String keyword,
    String status,
    LocalDate fromDate,
    LocalDate toDate,
    int page,
    int size,
    String sortBy,
    boolean descending
) {}
```

Jika constructor call menjadi sulit dibaca:

```java
new SearchCriteria("abc", "OPEN", null, null, 0, 20, "createdAt", true);
```

Ada beberapa opsi.

### Opsi 1: Static factory dengan nama

```java
public record SearchCriteria(
    String keyword,
    String status,
    LocalDate fromDate,
    LocalDate toDate,
    int page,
    int size,
    String sortBy,
    boolean descending
) {
    public static SearchCriteria firstPage(String keyword) {
        return new SearchCriteria(keyword, null, null, null, 0, 20, "createdAt", true);
    }
}
```

### Opsi 2: Builder manual

```java
public record SearchCriteria(
    String keyword,
    String status,
    LocalDate fromDate,
    LocalDate toDate,
    int page,
    int size,
    String sortBy,
    boolean descending
) {
    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String keyword;
        private String status;
        private LocalDate fromDate;
        private LocalDate toDate;
        private int page = 0;
        private int size = 20;
        private String sortBy = "createdAt";
        private boolean descending = true;

        public Builder keyword(String keyword) {
            this.keyword = keyword;
            return this;
        }

        public Builder status(String status) {
            this.status = status;
            return this;
        }

        public SearchCriteria build() {
            return new SearchCriteria(keyword, status, fromDate, toDate, page, size, sortBy, descending);
        }
    }
}
```

Namun pertanyaan desainnya:

> Jika record butuh builder kompleks, apakah record ini terlalu besar?

Mungkin perlu dipecah:

```java
public record PageSpec(int page, int size) {}
public record SortSpec(String sortBy, boolean descending) {}
public record DateFilter(LocalDate from, LocalDate to) {}

public record SearchCriteria(
    String keyword,
    String status,
    DateFilter dateFilter,
    PageSpec page,
    SortSpec sort
) {}
```

Composition sering lebih baik daripada builder raksasa.

---

## 28. Record dan Default Value

Record tidak punya default value per component di header.

Tidak bisa:

```java
public record PageRequest(int page = 0, int size = 20) {} // invalid
```

Gunakan constructor/factory.

```java
public record PageRequest(int page, int size) {
    public PageRequest {
        if (page < 0) {
            throw new IllegalArgumentException("page must be >= 0");
        }
        if (size <= 0 || size > 100) {
            throw new IllegalArgumentException("size must be 1..100");
        }
    }

    public static PageRequest firstPage() {
        return new PageRequest(0, 20);
    }

    public static PageRequest ofNullable(Integer page, Integer size) {
        return new PageRequest(
            page == null ? 0 : page,
            size == null ? 20 : size
        );
    }
}
```

Hindari terlalu banyak overloaded constructor jika membuat call site membingungkan.

---

## 29. Record dan Derived Fields

Record component adalah state utama. Derived value sebaiknya method, bukan component, kecuali memang bagian dari data contract.

Contoh:

```java
public record PersonName(String firstName, String lastName) {
    public String fullName() {
        return firstName + " " + lastName;
    }
}
```

Jangan lakukan ini kecuali `fullName` memang data independen:

```java
public record PersonName(String firstName, String lastName, String fullName) {}
```

Karena bisa inconsistent:

```java
new PersonName("Ada", "Lovelace", "Grace Hopper");
```

Jika ingin cache derived value, record kurang cocok karena instance field tambahan non-static dilarang untuk record, kecuali field tersebut adalah component. Record hanya boleh punya static fields selain component-backed fields.

Jika derived value mahal dan perlu cached, gunakan class biasa.

---

## 30. Record dan Inheritance

Record secara implisit final.

Tidak bisa:

```java
public record UserDto(String id) extends BaseDto {} // invalid
```

Record bisa implement interface:

```java
public interface Identified {
    String id();
}

public record UserDto(String id, String name) implements Identified {}
```

Ini sering bagus untuk capability kecil.

Namun jangan membuat interface hanya agar record “terlihat polymorphic” tanpa kebutuhan nyata.

```java
public interface UserDtoLike {
    String id();
    String name();
}
```

Jika hanya ada satu implementation dan tidak ada abstraction need, interface tersebut mungkin noise.

---

## 31. Record dan Entity: Biasanya Jangan

Entity biasanya punya identity dan lifecycle.

Buruk:

```java
public record UserEntity(
    Long id,
    String email,
    String status
) {}
```

Mengapa sering buruk?

- ORM sering butuh no-args constructor/proxy/mutation;
- entity state berubah sepanjang lifecycle;
- equality entity biasanya berdasarkan identity, bukan semua field;
- lazy loading/proxy bisa bermasalah;
- domain behavior sering lebih penting dari data exposure;
- persistence concern mencemari record shape.

Lebih baik:

```java
public class UserEntity {
    private Long id;
    private String email;
    private UserStatus status;

    protected UserEntity() {
        // for ORM
    }

    public UserEntity(String email) {
        this.email = normalizeEmail(email);
        this.status = UserStatus.ACTIVE;
    }

    public void suspend(String reason) {
        if (status == UserStatus.SUSPENDED) {
            return;
        }
        this.status = UserStatus.SUSPENDED;
    }
}
```

Record dapat dipakai sebagai projection dari entity:

```java
public record UserListItem(
    Long id,
    String email,
    String status
) {}
```

Jadi:

```text
entity lifecycle object        class
read projection                record
command/request DTO            record
event payload                  record/class depending on versioning
```

---

## 32. Record Equality: Component-Based

Record generated `equals` membandingkan:

- type yang sama;
- semua component equal.

Contoh:

```java
public record Point(int x, int y) {}

new Point(1, 2).equals(new Point(1, 2)) // true
```

Jika component adalah array:

```java
public record Bytes(byte[] value) {}

new Bytes(new byte[] {1}).equals(new Bytes(new byte[] {1})) // false
```

Karena array `equals` adalah identity equality.

Jika component adalah list:

```java
public record Names(List<String> values) {}

new Names(List.of("A")).equals(new Names(List.of("A"))) // true
```

Karena `List.equals` membandingkan element.

Namun jika list mutable, hash code bisa berubah.

```java
List<String> values = new ArrayList<>(List.of("A"));
Names names = new Names(values);
Set<Names> set = new HashSet<>();
set.add(names);

values.add("B");

System.out.println(set.contains(names)); // bisa false
```

Karena hashCode berubah setelah object masuk `HashSet`.

Jadi record yang dipakai sebagai key harus benar-benar stable.

---

## 33. Record `toString`: Berguna, Tapi Bisa Membocorkan Data

Record default `toString` mencetak nama record dan components.

```java
public record LoginRequest(String username, String password) {}
```

```java
System.out.println(new LoginRequest("alice", "secret"));
```

Output kira-kira:

```text
LoginRequest[username=alice, password=secret]
```

Ini berbahaya.

Untuk sensitive data, opsi:

1. Jangan gunakan record.
2. Jangan masukkan secret sebagai component record yang mudah ter-log.
3. Override `toString`.
4. Gunakan redaction layer.

Contoh override:

```java
public record LoginRequest(String username, String password) {
    @Override
    public String toString() {
        return "LoginRequest[username=" + username + ", password=<redacted>]";
    }
}
```

Namun tetap ada risiko:

- accessor `password()` tetap public;
- reflection bisa membaca component;
- serializer bisa menulisnya;
- log framework bisa inspect object.

Untuk secret, class biasa sering lebih tepat.

---

## 34. Record dan Public API Evolution

Record sangat concise tetapi public API-nya sensitif.

Misalnya library v1:

```java
public record UserKey(String tenantId, String userId) {}
```

Consumer:

```java
UserKey key = new UserKey("tenant-a", "user-1");
String userId = key.userId();
```

Library v2:

```java
public record UserKey(String tenantId, String region, String userId) {}
```

Dampak:

- constructor call lama tidak compile;
- binary compatibility rusak;
- equality semantics berubah;
- hashCode berubah;
- map key behavior berubah;
- serialization shape berubah;
- generated schema berubah;
- pattern matching deconstruction berubah.

Jika API perlu sering berubah, pertimbangkan class dengan factory/builder.

Contoh lebih evolvable:

```java
public final class UserKey {
    private final String tenantId;
    private final String userId;
    private final String region;

    private UserKey(Builder builder) { ... }

    public static Builder builder(String tenantId, String userId) { ... }
}
```

Atau gunakan nested metadata:

```java
public record UserKey(
    String tenantId,
    String userId,
    UserKeyMetadata metadata
) {}

public record UserKeyMetadata(
    String region
) {}
```

Tapi jangan menambah nesting hanya untuk menghindari keputusan API. Gunakan bila memang ada boundary konseptual.

---

## 35. Record dan Binary Compatibility

Dalam Java, compatibility tidak hanya source-level.

Ada beberapa level:

```text
source compatibility       consumer source masih compile
binary compatibility       consumer binary lama masih bisa jalan
behavioral compatibility   semantic lama tetap benar
serialization compatibility shape data tetap compatible
```

Record header change sering mempengaruhi semuanya.

Contoh perubahan berisiko:

- rename component;
- remove component;
- reorder component;
- change component type;
- add component;
- change validation rule;
- change normalization rule;
- override accessor differently;
- change equals/hashCode manually;
- change package/name;
- change annotation metadata used by framework.

Untuk internal record yang tidak keluar module, perubahan aman. Untuk public library/API, record harus diperlakukan sebagai contract serius.

---

## 36. Record dan Package/Module Boundary

Record sering menggoda untuk dijadikan public karena concise.

```java
public record InternalCalculationStep(...) {}
```

Jika class ini hanya detail internal, jangan public.

Gunakan package-private record:

```java
record CalculationStep(
    String ruleId,
    BigDecimal amount
) {}
```

Package-private record cocok untuk intermediate result di package.

Contoh:

```java
package com.example.billing.calculation;

record TaxableAmount(BigDecimal base, BigDecimal tax) {}
```

Tidak semua record harus public.

Dengan JPMS, package yang tidak di-export tetap tersembunyi dari module lain. Ini membuat record internal aman sebagai implementation detail.

---

## 37. Record Sebagai Intermediate Transformation Result

Dalam code kompleks, developer sering membuat `Map<String, Object>` untuk membawa hasil sementara.

Buruk:

```java
Map<String, Object> row = new HashMap<>();
row.put("caseId", caseId);
row.put("status", status);
row.put("lastUpdatedAt", lastUpdatedAt);
```

Lebih baik:

```java
record CaseRow(String caseId, String status, Instant lastUpdatedAt) {}
```

Keuntungan:

- type-safe;
- readable;
- refactor-friendly;
- tidak stringly typed;
- equality/toString berguna untuk test;
- scope bisa local/package-private.

Record lokal juga bisa dipakai di method:

```java
public List<String> summarize(List<Case> cases) {
    record CaseSummaryInput(String caseId, String status) {}

    return cases.stream()
        .map(c -> new CaseSummaryInput(c.id(), c.status().name()))
        .map(input -> input.caseId() + ":" + input.status())
        .toList();
}
```

Gunakan local record ketika shape hanya relevan di satu method dan membuat pipeline lebih jelas.

Jangan gunakan local record jika membuat method terlalu panjang atau type tersebut sebenarnya reusable concept.

---

## 38. Record dan Local Reasoning

Record meningkatkan local reasoning karena state-nya explicit.

Bandingkan:

```java
class Context {
    String a;
    String b;
    String c;
}
```

vs

```java
record Context(String a, String b, String c) {}
```

Pada record:

- semua component terlihat di header;
- tidak ada hidden instance field tambahan;
- fields final;
- constructor jelas;
- accessor jelas;
- equality jelas.

Ini membantu saat membaca code besar.

Namun record yang punya 15 component justru mengurangi local reasoning.

```java
public record MegaRequest(
    String a,
    String b,
    String c,
    String d,
    String e,
    String f,
    String g,
    String h,
    String i,
    String j
) {}
```

Jika record terlalu besar, biasanya ada konsep yang belum diekstrak.

---

## 39. Record dan Nullability

Record tidak otomatis non-null.

```java
public record User(String id, String name) {}

new User(null, null); // valid secara bahasa
```

Jika tidak boleh null, validasi eksplisit:

```java
public record User(String id, String name) {
    public User {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(name, "name");
    }
}
```

Jika beberapa field optional, jangan langsung pakai `Optional` sebagai component tanpa berpikir.

```java
public record UserProfile(String id, Optional<String> nickname) {}
```

Ini bisa dipakai untuk internal API, tetapi untuk serialization boundary sering buruk karena:

- JSON shape aneh;
- framework compatibility;
- nested optional awkward;
- `Optional` sendiri bisa null jika tidak divalidasi.

Alternatif:

```java
public record UserProfile(String id, String nickname) {
    public Optional<String> nicknameOptional() {
        return Optional.ofNullable(nickname);
    }
}
```

Atau domain-specific type:

```java
public sealed interface Nickname {
    record Present(String value) implements Nickname {}
    enum Missing implements Nickname { INSTANCE }
}
```

Pilih berdasarkan boundary dan readability.

---

## 40. Record dan `Optional` Component

Guideline praktis:

```text
Optional return type             often good
Optional field/component          usually avoid for DTO/serialization
Optional internal model           acceptable if team convention clear
Optional parameter                usually avoid
```

Buruk:

```java
public record SearchFilter(Optional<String> status) {}
```

Karena bisa dipanggil:

```java
new SearchFilter(null); // tetap mungkin
```

Jika tetap memakai Optional, validasi:

```java
public record SearchFilter(Optional<String> status) {
    public SearchFilter {
        status = Objects.requireNonNull(status, "status");
    }
}
```

Tapi banyak kasus lebih jelas:

```java
public record SearchFilter(String status) {
    public Optional<String> statusOptional() {
        return Optional.ofNullable(status);
    }
}
```

---

## 41. Record dan Generic Types

Record bisa generic:

```java
public record Page<T>(
    List<T> items,
    int page,
    int size,
    long totalElements
) {
    public Page {
        items = List.copyOf(items);
    }
}
```

Ini bagus untuk response/query result.

Namun type erasure tetap berlaku.

Runtime tidak selalu tahu `T` secara penuh.

Framework serialization/deserialization mungkin perlu type token:

```java
Page<UserDto>
```

Pada runtime, `Page<T>` mengalami erasure. Metadata generic bisa ada di declaration/signature, tetapi instance object tidak membawa concrete `T` secara langsung.

Jangan menganggap record generic otomatis menyelesaikan masalah runtime generic type.

---

## 42. Record dan Validation Error Accumulation

Constructor record biasanya throw exception pada error pertama.

```java
public record RegisterRequest(String email, String password) {
    public RegisterRequest {
        if (email == null || email.isBlank()) {
            throw new IllegalArgumentException("email is required");
        }
        if (password == null || password.length() < 12) {
            throw new IllegalArgumentException("password too short");
        }
    }
}
```

Untuk input user, kadang perlu semua errors sekaligus.

Maka pattern lebih baik:

```java
public record RegisterRequest(String email, String password) {}

public record ValidationError(String field, String code, String message) {}

public sealed interface ValidationResult<T> {
    record Valid<T>(T value) implements ValidationResult<T> {}
    record Invalid<T>(List<ValidationError> errors) implements ValidationResult<T> {
        public Invalid {
            errors = List.copyOf(errors);
        }
    }
}
```

Validator:

```java
public final class RegisterRequestValidator {
    public ValidationResult<RegisterRequest> validate(RegisterRequest request) {
        List<ValidationError> errors = new ArrayList<>();

        if (request.email() == null || request.email().isBlank()) {
            errors.add(new ValidationError("email", "required", "email is required"));
        }

        if (request.password() == null || request.password().length() < 12) {
            errors.add(new ValidationError("password", "too_short", "password must be at least 12 characters"));
        }

        if (!errors.isEmpty()) {
            return new ValidationResult.Invalid<>(errors);
        }

        return new ValidationResult.Valid<>(request);
    }
}
```

Constructor invariant cocok untuk invariant yang tidak boleh pernah dilanggar. User input validation yang butuh banyak error sering lebih baik di validator terpisah.

---

## 43. Record dan Domain Invariant: Jangan Terlalu Lemah

Jika record menjadi value object, jangan biarkan invalid state.

Buruk:

```java
public record Percentage(BigDecimal value) {}
```

Lebih baik:

```java
public record Percentage(BigDecimal value) {
    public Percentage {
        Objects.requireNonNull(value, "value");
        if (value.compareTo(BigDecimal.ZERO) < 0 || value.compareTo(BigDecimal.valueOf(100)) > 0) {
            throw new IllegalArgumentException("percentage must be between 0 and 100");
        }
    }
}
```

Atau jika scale/rounding penting:

```java
public record Percentage(BigDecimal value) {
    public Percentage {
        Objects.requireNonNull(value, "value");
        value = value.stripTrailingZeros();
        if (value.compareTo(BigDecimal.ZERO) < 0 || value.compareTo(BigDecimal.valueOf(100)) > 0) {
            throw new IllegalArgumentException("percentage must be between 0 and 100");
        }
    }
}
```

Tapi hati-hati: BigDecimal equality sensitive terhadap scale.

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")) // false
```

Jika component `BigDecimal` tidak dinormalisasi, record equality mengikuti `BigDecimal.equals`, bukan numeric compare.

Ini contoh kenapa record equality harus dipahami.

---

## 44. BigDecimal Dalam Record

Money record naive:

```java
public record Money(String currency, BigDecimal amount) {}
```

Masalah:

```java
new Money("SGD", new BigDecimal("1.0"))
    .equals(new Money("SGD", new BigDecimal("1.00"))) // false
```

Karena BigDecimal equals memperhitungkan scale.

Solusi 1: normalize amount.

```java
public record Money(Currency currency, BigDecimal amount) {
    public Money {
        Objects.requireNonNull(currency, "currency");
        Objects.requireNonNull(amount, "amount");
        amount = amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.UNNECESSARY);
    }
}
```

Solusi 2: simpan minor unit.

```java
public record Money(Currency currency, long amountMinor) {
    public Money {
        Objects.requireNonNull(currency, "currency");
    }
}
```

Untuk monetary domain serius, representation decision sangat penting. Record tidak menghilangkan kebutuhan desain domain.

---

## 45. Record dan Sorting/Comparable

Record bisa implement `Comparable`.

```java
public record CasePriority(int severity, Instant submittedAt)
        implements Comparable<CasePriority> {

    public CasePriority {
        Objects.requireNonNull(submittedAt, "submittedAt");
    }

    @Override
    public int compareTo(CasePriority other) {
        int bySeverity = Integer.compare(other.severity, severity); // higher first
        if (bySeverity != 0) {
            return bySeverity;
        }
        return submittedAt.compareTo(other.submittedAt);
    }
}
```

Pastikan `compareTo` konsisten dengan equals jika object digunakan di sorted set/map.

Jika compare hanya menggunakan sebagian component, `TreeSet` bisa menganggap dua object berbeda sebagai sama menurut ordering.

```java
public record UserScore(String userId, int score) implements Comparable<UserScore> {
    @Override
    public int compareTo(UserScore other) {
        return Integer.compare(score, other.score);
    }
}
```

Masalah:

```java
new UserScore("A", 10).equals(new UserScore("B", 10)) // false
compareTo returns 0
```

Untuk sorted collection, ini bug potensial.

---

## 46. Record dan Map Key

Record sangat cocok sebagai composite key jika components immutable dan equality benar.

```java
public record UserTenantKey(String tenantId, String userId) {
    public UserTenantKey {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(userId, "userId");
    }
}
```

Penggunaan:

```java
Map<UserTenantKey, UserSession> sessions = new ConcurrentHashMap<>();
sessions.put(new UserTenantKey("tenant-a", "user-1"), session);
```

Lebih baik daripada:

```java
Map<String, UserSession> sessions = new HashMap<>();
sessions.put(tenantId + ":" + userId, session);
```

Karena menghindari:

- delimiter collision;
- string parsing;
- order confusion;
- accidental key mismatch;
- weak type safety.

Namun jangan gunakan record key dengan mutable component.

---

## 47. Record dan Testing

Record memudahkan testing karena equality/toString otomatis.

```java
assertEquals(
    new CaseSummary("CASE-1", "SUBMITTED"),
    service.getSummary("CASE-1")
);
```

Ini lebih bersih daripada assertion field-by-field.

Namun hati-hati jika record memiliki:

- timestamp generated;
- random id;
- collection order tidak deterministic;
- BigDecimal scale issue;
- floating point component;
- array component.

Contoh buruk:

```java
public record CalculationResult(double value) {}
```

Floating point equality bisa tricky.

Untuk decimal business values, gunakan `BigDecimal` dengan normalization atau minor unit integer.

---

## 48. Record dan Floating Point

Record equality untuk `double`/`float` mengikuti aturan wrapper comparison yang digunakan generated equals.

Floating point domain biasanya punya isu:

- rounding;
- NaN;
- -0.0 vs 0.0;
- precision error.

Jika value adalah measurement approximate, jangan mengandalkan record equals untuk semantic equality.

Contoh:

```java
public record Coordinate(double latitude, double longitude) {}
```

Ini boleh untuk data carrier, tetapi untuk domain comparison gunakan method eksplisit:

```java
public boolean near(Coordinate other, double epsilon) {
    return Math.abs(latitude - other.latitude) <= epsilon
        && Math.abs(longitude - other.longitude) <= epsilon;
}
```

---

## 49. Record dan Framework Proxy

Record final, fields final, constructor canonical. Ini membuatnya kurang cocok untuk framework yang mengandalkan:

- subclass proxy;
- no-args constructor;
- field mutation;
- lazy loading;
- bytecode enhancement mutable;
- setter injection.

Cocok:

- request/response DTO;
- projection;
- immutable config snapshot;
- query result;
- event payload dengan mapper modern.

Kurang cocok:

- JPA entity tradisional;
- lazy-loaded association holder;
- framework-managed mutable bean;
- subclass-proxied service.

Jika framework modern mendukung constructor binding, record bisa sangat baik.

---

## 50. Record dan Configuration Object

Record cocok untuk immutable configuration.

```java
public record RetryPolicy(
    int maxAttempts,
    Duration initialDelay,
    Duration maxDelay
) {
    public RetryPolicy {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be >= 1");
        }
        Objects.requireNonNull(initialDelay, "initialDelay");
        Objects.requireNonNull(maxDelay, "maxDelay");

        if (maxDelay.compareTo(initialDelay) < 0) {
            throw new IllegalArgumentException("maxDelay must be >= initialDelay");
        }
    }
}
```

Keuntungan:

- thread-safe if components immutable;
- clear validation;
- easy to pass around;
- no accidental mutation;
- equality useful in tests.

Namun jangan isi configuration record dengan mutable object seperti live client/connection.

```java
public record BadConfig(DataSource dataSource, int timeout) {}
```

Ini bukan config value murni; ini dependency holder.

---

## 51. Record dan Dependency Injection

Record bisa digunakan untuk configuration atau parameter object, bukan sebagai service utama.

Kurang tepat:

```java
public record UserService(UserRepository repository, MailClient mailClient) {
    public void register(...) { ... }
}
```

Memang bisa, tetapi signal-nya membingungkan. Service bukan transparent data carrier; service adalah behavior object dengan dependencies.

Lebih baik:

```java
public final class UserService {
    private final UserRepository repository;
    private final MailClient mailClient;

    public UserService(UserRepository repository, MailClient mailClient) {
        this.repository = repository;
        this.mailClient = mailClient;
    }
}
```

Record untuk service dependency holder bisa terlihat concise, tetapi public accessors ke dependencies bukan API yang biasanya ingin diekspos.

Gunakan record untuk:

```java
public record UserRegistrationInput(String email, String displayName) {}
public record UserRegistrationResult(String userId, Instant createdAt) {}
```

Bukan untuk service behavior object.

---

## 52. Record dan Layered/Hexagonal Architecture

Di enterprise Java, record sangat berguna sebagai boundary shape.

Contoh:

```text
controller/request boundary      record
application command              record
application result               record/sealed records
domain value object              record/class depending invariant
entity/aggregate                 class
persistence projection           record
external API DTO                 record/class depending compatibility
```

Contoh flow:

```java
public record SubmitApplicationRequest(
    String applicantId,
    String applicationType
) {}

public record SubmitApplicationCommand(
    ApplicantId applicantId,
    ApplicationType applicationType,
    Instant requestedAt
) {}

public sealed interface SubmitApplicationResult {
    record Accepted(ApplicationId applicationId) implements SubmitApplicationResult {}
    record Rejected(List<ValidationError> errors) implements SubmitApplicationResult {
        public Rejected {
            errors = List.copyOf(errors);
        }
    }
}
```

Controller DTO belum tentu sama dengan application command. Record membuat mapping eksplisit dan aman.

---

## 53. Record dan Anti-Corruption Layer

Saat menerima data dari external system, record cocok untuk raw external DTO.

```java
public record ExternalCustomerPayload(
    String customer_id,
    String full_name,
    String status_code
) {}
```

Lalu map ke internal model:

```java
public record CustomerSnapshot(
    CustomerId id,
    String displayName,
    CustomerStatus status
) {}
```

Jangan biarkan external naming masuk domain internal.

Buruk:

```java
public record Customer(String customer_id, String full_name, String status_code) {}
```

Record membuat external contract jelas, tetapi tetap perlu boundary mapping.

---

## 54. Record dan Error Modeling

Record sangat cocok untuk structured error.

```java
public record ErrorDetail(
    String code,
    String message,
    String field
) {}
```

Untuk domain error finite:

```java
public sealed interface ApplicationError {
    record MissingDocument(String documentType) implements ApplicationError {}
    record InvalidApplicantStatus(String currentStatus) implements ApplicationError {}
    record DuplicateApplication(String existingApplicationId) implements ApplicationError {}
}
```

Keuntungan:

- error bukan string bebas;
- caller harus handle variant;
- data tiap error spesifik;
- cocok untuk mapping ke HTTP/API;
- test lebih mudah.

Mapping:

```java
public ErrorDetail toErrorDetail(ApplicationError error) {
    return switch (error) {
        case ApplicationError.MissingDocument e ->
            new ErrorDetail("missing_document", "Missing document: " + e.documentType(), "documents");
        case ApplicationError.InvalidApplicantStatus e ->
            new ErrorDetail("invalid_status", "Invalid applicant status: " + e.currentStatus(), "status");
        case ApplicationError.DuplicateApplication e ->
            new ErrorDetail("duplicate", "Existing application: " + e.existingApplicationId(), null);
    };
}
```

---

## 55. Record dan State Machine Snapshot

Record cocok untuk immutable snapshot dari state machine.

```java
public record CaseStateSnapshot(
    String caseId,
    String currentState,
    List<String> allowedTransitions,
    Instant updatedAt
) {
    public CaseStateSnapshot {
        allowedTransitions = List.copyOf(allowedTransitions);
    }
}
```

Namun state machine behavior sendiri lebih baik bukan record jika memiliki transition logic kompleks.

```java
public final class CaseStateMachine {
    public CaseTransitionResult transition(Case caseData, CaseAction action) { ... }
}
```

Record untuk:

- state snapshot;
- transition request;
- transition result;
- transition audit payload;
- validation errors.

Class/service untuk:

- transition rule;
- guard evaluation;
- side-effect orchestration;
- persistence interaction.

---

## 56. Record dan Audit/Event Payload

Record cocok untuk audit payload jika schema stabil.

```java
public record AuditEntryPayload(
    String actorId,
    String action,
    String targetType,
    String targetId,
    Instant occurredAt,
    Map<String, String> metadata
) {
    public AuditEntryPayload {
        metadata = Map.copyOf(metadata);
    }
}
```

Tapi hati-hati:

- metadata map bisa menjadi dumping ground;
- toString bisa expose sensitive data;
- schema evolution perlu versioning;
- map value stringly typed;
- field addition impact consumer.

Untuk audit jangka panjang, pertimbangkan explicit versioned payload.

---

## 57. Record dan Logging

Record `toString` membuat logging mudah.

```java
log.info("result={}", result);
```

Namun ini juga bahaya.

Checklist sebelum log record:

- Apakah ada PII?
- Apakah ada secret/token/password?
- Apakah ada payload besar?
- Apakah ada nested object yang toString mahal?
- Apakah ada collection besar?
- Apakah log retention aman?
- Apakah redaction diterapkan?

Untuk sensitive record:

```java
public record PaymentRequest(
    String userId,
    String cardNumber,
    BigDecimal amount
) {
    @Override
    public String toString() {
        return "PaymentRequest[userId=" + userId + ", cardNumber=<redacted>, amount=" + amount + "]";
    }
}
```

Namun lebih baik jangan simpan raw card number dalam record biasa.

---

## 58. Record dan Performance

Record bukan primitive/value type. Record instance tetap object biasa di heap, kecuali optimisasi JVM dapat melakukan scalar replacement atau escape analysis pada kasus tertentu.

Jangan berpikir:

> “Record lebih cepat karena immutable.”

Yang benar:

- record mengurangi boilerplate;
- final fields dapat membantu reasoning;
- JVM bisa mengoptimalkan object biasa juga;
- allocation tetap terjadi secara konseptual;
- performance bergantung escape analysis, JIT, workload;
- microbenchmark harus hati-hati.

Jika membuat jutaan small objects di hot path, tetap ukur.

Future Java punya arah value objects melalui Project Valhalla, tetapi record saat ini bukan value object JVM-level.

---

## 59. Record dan Memory Footprint

Record tidak otomatis lebih kecil dari class dengan field sama.

```java
record Point(int x, int y) {}
```

Secara object layout, ini tetap object dengan header dan fields. Ukuran aktual tergantung JVM, compressed oops, alignment, field layout, dan runtime.

Keuntungan record bukan memory footprint langsung, tetapi:

- lebih sedikit source boilerplate;
- lebih kecil risiko method contract salah;
- lebih mudah dibaca;
- component model jelas.

---

## 60. Record dan Concurrency

Record dengan immutable components aman dibagikan antar thread.

```java
public record JobConfig(String name, int retryCount, Duration timeout) {}
```

Jika semua components immutable, object effectively immutable.

Namun jika component mutable:

```java
public record SharedState(List<String> values) {}
```

Maka thread safety tidak otomatis.

Gunakan defensive copy:

```java
public record SharedState(List<String> values) {
    public SharedState {
        values = List.copyOf(values);
    }
}
```

Jika element mutable, tetap belum deep thread-safe.

---

## 61. Record dan API Documentation

Record header membuat documentation ringkas.

```java
/**
 * Immutable view of a case shown in the officer dashboard.
 *
 * @param caseId stable case identifier
 * @param status current workflow status
 * @param lastUpdatedAt timestamp of the last state-changing action
 */
public record CaseDashboardItem(
    String caseId,
    String status,
    Instant lastUpdatedAt
) {}
```

Javadoc `@param` pada record component sangat berguna.

Untuk public API, selalu dokumentasikan:

- nullability;
- allowed format;
- units;
- timezone;
- currency;
- range;
- sort order;
- versioning note;
- sensitive data warning.

Contoh:

```java
/**
 * @param amountMinor amount in minor currency unit, e.g. cents for USD/SGD
 */
public record Money(Currency currency, long amountMinor) {}
```

Tanpa documentation, record concise bisa menjadi ambiguous.

---

## 62. Record dan Naming

Component name adalah API.

Pilih nama yang:

- domain-specific;
- stable;
- tidak terlalu teknis;
- tidak bergantung storage;
- tidak memakai singkatan internal;
- tidak memakai prefix aneh.

Buruk:

```java
public record UserDto(String usrId, String nm, String statCd) {}
```

Lebih baik:

```java
public record UserSummary(String userId, String displayName, String statusCode) {}
```

Namun untuk external DTO yang mencerminkan raw external API, boleh mempertahankan naming eksternal jika mapping tool membutuhkannya. Tapi lebih baik gunakan annotation mapping bila memungkinkan.

---

## 63. Record dan Package Naming

Contoh package struktur:

```text
com.example.caseapp.application.command
  SubmitApplicationCommand.java
  WithdrawApplicationCommand.java

com.example.caseapp.application.result
  SubmitApplicationResult.java

com.example.caseapp.web.dto
  SubmitApplicationRequest.java
  SubmitApplicationResponse.java

com.example.caseapp.persistence.projection
  CaseListProjection.java

com.example.caseapp.domain.value
  CaseNumber.java
  OfficerId.java
```

Record bukan alasan untuk membuat package `dto` raksasa berisi semua hal.

Package tetap harus mencerminkan boundary.

---

## 64. Record dan Generated Code

Record sering menjadi target/generated source.

Contoh generator membuat record dari schema:

```java
public record CustomerGenerated(
    String id,
    String name,
    String email
) {}
```

Pertanyaan desain:

1. Apakah generated record boleh diedit manual?
2. Apakah record berada di package `generated`?
3. Apakah component names stable?
4. Apakah generated record masuk public API?
5. Bagaimana versioning schema?
6. Bagaimana nullability direpresentasikan?
7. Bagaimana default values?
8. Bagaimana nested object/collection dibuat immutable?
9. Apakah generated code perlu validation?
10. Apakah generated code perlu custom `toString` redaction?

Generated record bisa sangat bagus, tetapi generator harus diperlakukan seperti compiler kecil, bukan script asal.

---

## 65. Record dan Mapper

Mapping class ke record:

```java
public record UserDto(String id, String displayName) {}

public final class UserMapper {
    public UserDto toDto(User user) {
        return new UserDto(user.id().value(), user.displayName());
    }
}
```

Mapping record ke domain:

```java
public record CreateUserRequest(String email, String displayName) {}

public final class CreateUserMapper {
    public CreateUserCommand toCommand(CreateUserRequest request, Clock clock) {
        return new CreateUserCommand(
            new EmailAddress(request.email()),
            request.displayName(),
            Instant.now(clock)
        );
    }
}
```

Jangan biarkan record DTO langsung menjadi domain model jika boundary-nya berbeda.

```java
// terlalu cepat menyamakan external request dengan domain command
service.createUser(request);
```

Lebih baik explicit mapping ketika invariant/domain type penting.

---

## 66. Record dan Overloaded Constructors

Record boleh punya constructor tambahan, tetapi constructor non-canonical harus delegate ke canonical constructor.

```java
public record PageRequest(int page, int size) {
    public PageRequest(int page) {
        this(page, 20);
    }

    public static PageRequest firstPage() {
        return new PageRequest(0, 20);
    }
}
```

Terlalu banyak overloaded constructors bisa membingungkan.

```java
new ReportFilter("OPEN");
new ReportFilter("OPEN", true);
new ReportFilter("OPEN", true, null);
```

Static factory sering lebih jelas:

```java
ReportFilter.openOnly();
ReportFilter.openIncludingArchived();
ReportFilter.forStatus("OPEN");
```

---

## 67. Record dan Static Factory

Static factory cocok untuk:

- default value;
- named construction;
- parsing;
- validation context ringan;
- normalization;
- alternative representation.

Contoh:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        Objects.requireNonNull(value, "value");
        value = value.trim().toLowerCase(Locale.ROOT);
        if (!value.contains("@")) {
            throw new IllegalArgumentException("invalid email");
        }
    }

    public static EmailAddress parse(String raw) {
        return new EmailAddress(raw);
    }
}
```

Untuk conversion yang bisa gagal tanpa exception:

```java
public static Optional<EmailAddress> tryParse(String raw) {
    try {
        return Optional.of(new EmailAddress(raw));
    } catch (RuntimeException ex) {
        return Optional.empty();
    }
}
```

Atau sealed result:

```java
public sealed interface EmailParseResult {
    record Success(EmailAddress value) implements EmailParseResult {}
    record Failure(String reason) implements EmailParseResult {}
}
```

---

## 68. Record dan Exception Design

Jangan membuat constructor record throw exception yang terlalu generic atau tidak informatif.

Buruk:

```java
throw new RuntimeException("invalid");
```

Lebih baik:

```java
throw new IllegalArgumentException("postalCode must be exactly 6 digits");
```

Untuk domain error yang perlu diproses caller, jangan selalu throw exception. Gunakan result type bila expected failure.

```java
public sealed interface PostalCodeParseResult {
    record Valid(PostalCode value) implements PostalCodeParseResult {}
    record Invalid(String raw, String reason) implements PostalCodeParseResult {}
}
```

---

## 69. Record dan `equals/hashCode` Manual

Record boleh override `equals/hashCode`, tetapi biasanya jangan.

Jika override, alasan harus kuat.

Contoh mungkin valid:

```java
public record CaseInsensitiveEmail(String value) {
    public CaseInsensitiveEmail {
        Objects.requireNonNull(value, "value");
        value = value.trim();
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof CaseInsensitiveEmail email
            && value.equalsIgnoreCase(email.value);
    }

    @Override
    public int hashCode() {
        return value.toLowerCase(Locale.ROOT).hashCode();
    }
}
```

Namun lebih baik normalize di constructor:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        Objects.requireNonNull(value, "value");
        value = value.trim().toLowerCase(Locale.ROOT);
    }
}
```

Dengan normalization, generated equals/hashCode tetap benar dan sederhana.

Rule:

```text
Prefer normalize components over overriding equals/hashCode.
Override only when normalization cannot express semantics safely.
```

---

## 70. Record dan `with` Methods

Record immutable, jadi update berarti membuat instance baru.

```java
public record UserProfile(String id, String displayName, String email) {
    public UserProfile withDisplayName(String newDisplayName) {
        return new UserProfile(id, newDisplayName, email);
    }
}
```

Ini bisa berguna.

Namun jika banyak fields dan banyak withers, record bisa menjadi tidak nyaman.

Jika domain butuh banyak state transition, gunakan class atau state machine model.

```java
profile = profile.withDisplayName("New Name");
```

Untuk data transformation, withers oke. Untuk lifecycle mutation, class behavior lebih natural.

---

## 71. Record dan Partial Update

Record sering tidak cocok untuk PATCH request jika field optional/absent/null harus dibedakan.

Buruk:

```java
public record UpdateUserRequest(String displayName, String email) {}
```

Apakah `displayName == null` berarti:

- tidak dikirim?
- dikirim null?
- ingin clear value?

Untuk PATCH, buat explicit tri-state.

```java
public sealed interface PatchField<T> {
    record Absent<T>() implements PatchField<T> {}
    record Present<T>(T value) implements PatchField<T> {}
}

public record UpdateUserPatch(
    PatchField<String> displayName,
    PatchField<String> email
) {}
```

Atau gunakan layer deserialization khusus.

Record bisa dipakai, tapi absent/null semantics harus explicit.

---

## 72. Record dan LocalDate/Instant

Record sering membawa waktu.

```java
public record CaseTimelineItem(
    String caseId,
    Instant occurredAt
) {}
```

Dokumentasikan semantics:

- `Instant` untuk timestamp global;
- `LocalDate` untuk tanggal kalender tanpa timezone;
- `LocalDateTime` sering ambiguous untuk distributed system;
- timezone perlu explicit jika display/business calendar penting.

Contoh:

```java
public record BusinessDateRange(LocalDate from, LocalDate to, ZoneId zone) {
    public BusinessDateRange {
        Objects.requireNonNull(from, "from");
        Objects.requireNonNull(to, "to");
        Objects.requireNonNull(zone, "zone");
        if (to.isBefore(from)) {
            throw new IllegalArgumentException("to must not be before from");
        }
    }
}
```

---

## 73. Record dan Units

Primitive component bisa ambigu.

Buruk:

```java
public record TimeoutConfig(long timeout) {}
```

Apa unit-nya? ms? seconds? minutes?

Lebih baik:

```java
public record TimeoutConfig(Duration timeout) {}
```

Atau jika harus primitive:

```java
public record TimeoutConfig(long timeoutMillis) {}
```

Untuk amount:

```java
public record Money(Currency currency, long amountMinor) {}
```

Naming component harus membawa unit jika type tidak membawa unit.

---

## 74. Record dan Boolean Trap

Banyak boolean di record membuat call site tidak jelas.

Buruk:

```java
new ExportOptions(true, false, true);
```

Deklarasi:

```java
public record ExportOptions(
    boolean includeHeader,
    boolean compress,
    boolean overwrite
) {}
```

Lebih baik gunakan enum atau nested records.

```java
public enum CompressionMode { NONE, ZIP }
public enum OverwriteMode { FAIL_IF_EXISTS, OVERWRITE }

public record ExportOptions(
    HeaderMode headerMode,
    CompressionMode compressionMode,
    OverwriteMode overwriteMode
) {}
```

Atau static factories:

```java
ExportOptions.withHeaderAndZip();
```

Boolean components boleh, tetapi jangan terlalu banyak.

---

## 75. Record dan Primitive Obsession

Record bisa memperbaiki primitive obsession.

Buruk:

```java
public record SubmitApplicationCommand(
    String applicantId,
    String applicationType,
    String channel
) {}
```

Lebih baik:

```java
public record ApplicantId(String value) {
    public ApplicantId {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) {
            throw new IllegalArgumentException("applicantId must not be blank");
        }
    }
}

public enum ApplicationType {
    NEW,
    RENEWAL
}

public enum SubmissionChannel {
    INTERNET,
    INTRANET,
    BATCH
}

public record SubmitApplicationCommand(
    ApplicantId applicantId,
    ApplicationType applicationType,
    SubmissionChannel channel
) {}
```

Record kecil untuk strong type bisa meningkatkan correctness.

Namun jangan membungkus semua primitive secara ekstrem jika hanya menambah noise.

---

## 76. Record dan Module API Design

Jika record diekspor dari module:

```java
module com.example.case.api {
    exports com.example.case.api.dto;
}
```

Maka record di package tersebut adalah API publik module.

Perubahan record header harus dikelola seperti public contract.

Jika record internal:

```java
module com.example.case.core {
    exports com.example.case.core.api;
    // package com.example.case.core.internal tidak diekspor
}
```

Package-private/public record di non-exported package tidak accessible dari module lain secara normal.

JPMS memperkuat boundary sehingga record internal dapat dipakai bebas tanpa membocorkan API.

---

## 77. Record dan `var`

Record sering dipakai dengan `var`.

```java
var result = service.submit(command);
```

Ini baik jika RHS jelas.

Namun untuk record dengan nama mirip, explicit type kadang membantu.

```java
SubmitApplicationResult result = service.submit(command);
```

Jangan gunakan `var` bila menghilangkan informasi penting.

```java
var data = mapper.map(input); // type tidak jelas
```

Record clarity berasal dari nama type dan component. Jangan sembunyikan dua-duanya.

---

## 78. Record dan Local Records

Local record adalah record yang dideklarasikan di dalam method/block.

```java
public Map<String, Long> countByStatus(List<Case> cases) {
    record StatusKey(String status) {}

    return cases.stream()
        .collect(Collectors.groupingBy(
            c -> new StatusKey(c.status().name()),
            Collectors.counting()
        ))
        .entrySet()
        .stream()
        .collect(Collectors.toMap(e -> e.getKey().status(), Map.Entry::getValue));
}
```

Local record cocok untuk:

- temporary grouping key;
- transformation intermediate;
- algorithm local shape;
- avoiding `Map.Entry` abuse;
- replacing ad-hoc arrays/tuples.

Jangan gunakan local record jika:

- type dipakai banyak method;
- domain concept penting;
- perlu test terpisah;
- membuat method terlalu ramai.

---

## 79. Record Sebagai Tuple: Hati-Hati

Record bisa menjadi tuple, tetapi jangan membuat type tanpa makna.

Buruk:

```java
record Pair<A, B>(A first, B second) {}
```

Generic pair sering melemahkan domain language.

Lebih baik:

```java
record OfficerWorkload(String officerId, int openCaseCount) {}
```

Nama record dan component harus memberi makna.

Record bukan alasan untuk membawa tuple culture yang opaque.

---

## 80. Record dan Nested Records

Nested record cocok untuk grouping variant kecil.

```java
public sealed interface PaymentResult {
    record Success(String paymentId) implements PaymentResult {}
    record Failed(String reasonCode, String message) implements PaymentResult {}
}
```

Ini membuat namespace rapi.

Namun jangan nesting terlalu dalam.

```java
A.B.C.D.Result
```

Jika nested type mulai banyak dipakai lintas package, naikkan menjadi top-level type.

---

## 81. Record dan Access Modifier

Top-level record bisa public atau package-private.

```java
public record PublicDto(String id) {}
```

```java
record InternalRow(String id) {}
```

Nested record dalam interface/class bisa punya modifier sesuai aturan nested type.

Gunakan visibility minimum.

```text
public record      hanya untuk API boundary
package-private    untuk internal implementation shape
local record       untuk method-local temporary shape
nested record      untuk variant/namespace grouping
```

---

## 82. Record dan Business Rule Leakage

Buruk:

```java
public record DiscountRequest(
    String customerType,
    BigDecimal amount,
    boolean vip,
    boolean blacklisted,
    boolean hasCoupon
) {}
```

Ini membawa terlalu banyak raw condition.

Lebih baik modelkan intent:

```java
public record DiscountEligibility(
    CustomerSegment segment,
    Money purchaseAmount,
    CouponStatus couponStatus,
    RiskStatus riskStatus
) {}
```

Atau behavior object:

```java
public final class DiscountPolicy {
    public DiscountDecision evaluate(DiscountEligibility eligibility) { ... }
}
```

Record adalah carrier; jangan jadikan dumping ground semua flag bisnis.

---

## 83. Record dan Domain Language

Record yang baik memperkuat ubiquitous/domain language.

Buruk:

```java
public record Data(String a, String b, String c) {}
```

Baik:

```java
public record OfficerAssignment(
    String officerId,
    String caseId,
    AssignmentReason reason
) {}
```

Record harus menjawab:

- Ini data apa?
- Component ini maknanya apa?
- Siapa yang membuatnya?
- Siapa yang mengonsumsinya?
- Apakah shape ini stabil?
- Apakah semua component memang bagian dari semantic state?

---

## 84. Record dan Table Projection

Record cocok untuk query projection.

```java
public record CaseListRow(
    String caseId,
    String applicantName,
    String status,
    Instant lastUpdatedAt
) {}
```

Ini bukan entity. Ini read shape.

Keuntungan:

- query result jelas;
- mapping sederhana;
- tidak membawa lifecycle;
- tidak terikat ORM entity behavior;
- cocok untuk pagination/listing.

Namun jangan menyamakan projection dengan domain object.

```java
CaseListRow row = repository.findRow(id);
// jangan row.approve()
```

Projection adalah view, bukan aggregate.

---

## 85. Record dan API Request/Response Versioning

Untuk public API, pertimbangkan naming version.

```java
public record SubmitApplicationRequestV1(
    String applicantId,
    String applicationType
) {}
```

Namun jangan terlalu cepat menambahkan versi di class name jika API versioning sudah di route/package.

Contoh package:

```text
com.example.api.v1.SubmitApplicationRequest
com.example.api.v2.SubmitApplicationRequest
```

Pilih satu strategi konsisten.

Record component names harus sinkron dengan JSON/API schema.

Jika ingin rename internal tanpa mengubah JSON, gunakan mapper/annotation framework dengan hati-hati.

---

## 86. Record dan Backward Compatibility Tactics

Jika record public perlu berubah, opsi:

### Opsi 1: Tambah overload/factory, tapi header tetap berubah jika component ditambah

Tidak selalu cukup.

### Opsi 2: Buat record baru

```java
public record UserResponseV1(String id, String name) {}
public record UserResponseV2(String id, String name, String email) {}
```

### Opsi 3: Tambahkan nested optional metadata

```java
public record UserResponse(
    String id,
    String name,
    UserResponseMetadata metadata
) {}
```

### Opsi 4: Gunakan class untuk API yang sangat evolvable

```java
public final class UserResponse {
    private final String id;
    private final String name;
    private final String email;

    // factory/builders; backward compatibility managed manually
}
```

Tidak ada solusi universal. Yang penting, jangan mengubah record header public dengan asumsi “ini cuma tambah field”.

---

## 87. Record dan OpenAPI/Schema

Record mudah dikonversi ke schema karena component explicit.

Tapi schema generator perlu memahami:

- nullability;
- required/optional;
- validation annotation;
- enum values;
- date/time format;
- collection mutability irrelevant to schema;
- nested record;
- generic record;
- sealed hierarchy mapping.

Jika schema menjadi contract eksternal, jangan biarkan generated schema berubah tanpa review.

Record concise bisa membuat schema drift lebih mudah tidak terlihat.

---

## 88. Record dan Clean Boundary

Pattern enterprise yang kuat:

```text
ExternalRequest record
  -> mapper
ApplicationCommand record/class
  -> handler/service
Domain object class/record
  -> result sealed record/class
ExternalResponse record
```

Contoh:

```java
public record SubmitRequest(String applicantId, String type) {}

public record SubmitCommand(ApplicantId applicantId, ApplicationType type) {}

public sealed interface SubmitResult {
    record Accepted(ApplicationId applicationId) implements SubmitResult {}
    record Rejected(List<ValidationError> errors) implements SubmitResult {
        public Rejected {
            errors = List.copyOf(errors);
        }
    }
}

public record SubmitResponse(String status, String applicationId, List<ErrorDetail> errors) {
    public SubmitResponse {
        errors = errors == null ? List.of() : List.copyOf(errors);
    }
}
```

Record membantu boundary shape, tetapi mapping menjaga domain tidak tercemar external API.

---

## 89. Record dan “Anemic Domain Model”

Record bisa memperparah anemic model jika semua domain dijadikan data bag dan semua rule dipindah ke service procedural.

Buruk:

```java
public record Application(
    String id,
    String status,
    List<String> documents
) {}

public class ApplicationService {
    public Application submit(Application app) { ... }
    public Application approve(Application app) { ... }
    public Application reject(Application app) { ... }
}
```

Mungkin ini valid untuk functional core, tetapi bisa buruk jika domain lifecycle kompleks.

Class mungkin lebih tepat:

```java
public final class Application {
    private final ApplicationId id;
    private ApplicationStatus status;
    private final List<Document> documents;

    public void submit() { ... }
    public void approve(Officer officer) { ... }
    public void reject(Officer officer, RejectionReason reason) { ... }
}
```

Record untuk snapshot/result:

```java
public record ApplicationSnapshot(
    String id,
    String status,
    List<String> documentIds
) {}
```

Jangan menjadikan record sebagai default untuk semua object.

---

## 90. Record dan Functional Style

Record cocok dengan functional transformation.

```java
public record RawUser(String id, String email) {}
public record NormalizedUser(String id, String email) {}

public NormalizedUser normalize(RawUser raw) {
    return new NormalizedUser(
        raw.id().trim(),
        raw.email().trim().toLowerCase(Locale.ROOT)
    );
}
```

Record membuat data pipeline jelas.

Namun pipeline panjang dengan banyak anonymous records/tuples bisa sulit dibaca.

Gunakan nama type yang bermakna.

---

## 91. Record dan Immutability Boundary Dalam Pipeline

Contoh transformasi aman:

```java
public record RawOrder(String orderId, List<String> itemIds) {}
public record NormalizedOrder(String orderId, List<String> itemIds) {
    public NormalizedOrder {
        itemIds = List.copyOf(itemIds);
    }
}
```

Pipeline:

```java
NormalizedOrder normalize(RawOrder raw) {
    return new NormalizedOrder(
        raw.orderId().trim(),
        raw.itemIds().stream()
            .map(String::trim)
            .filter(id -> !id.isBlank())
            .distinct()
            .toList()
    );
}
```

Record membantu menunjukkan tahap transformasi.

---

## 92. Record dan Invariant Layering

Tidak semua record perlu invariant sama kuat.

Layering:

```text
RawInputRecord        minimal validation, reflects incoming data
NormalizedRecord      local normalization and simple invariant
DomainValueRecord     strong invariant
PersistenceRecord     storage/query shape
ResponseRecord        external response shape
```

Contoh:

```java
public record RawPostalCode(String value) {}

public record PostalCode(String value) {
    public PostalCode {
        Objects.requireNonNull(value, "value");
        value = value.trim();
        if (!value.matches("\\d{6}")) {
            throw new IllegalArgumentException("postal code must be 6 digits");
        }
    }
}
```

Jangan paksa raw external input langsung menjadi domain value jika error handling butuh detail.

---

## 93. Record dan Security

Hindari record untuk:

- password;
- token;
- secret key;
- private key;
- session secret;
- raw credential;
- sensitive identity data yang sering ter-log.

Jika tetap perlu, minimal:

- override `toString`;
- avoid exposing raw accessor if possible;
- but record accessor must be public for component;
- consider class instead;
- apply redaction in logging/serialization;
- avoid reflection leakage.

Class biasa memberi kontrol lebih kuat.

---

## 94. Record dan Accessor Naming Conflict

Component name tidak boleh sembarangan karena accessor method akan memakai nama itu.

```java
public record Weird(String toString) {}
```

Ini legal? Nama component dapat berbenturan dengan method Object tertentu dalam beberapa kasus dan aturan bahasa membatasi member tertentu. Secara desain, jangan pilih nama yang membingungkan.

Hindari component names seperti:

- `hashCode`;
- `toString`;
- `class`;
- `getClass`;
- `wait`;
- `notify`;
- nama method domain yang ambigu.

Pilih nama noun/attribute yang jelas.

---

## 95. Record dan Component Order

Component order penting untuk constructor dan deconstruction.

```java
public record Range(int start, int end) {}
```

Call site:

```java
new Range(10, 20)
```

Jika urutan diubah:

```java
public record Range(int end, int start) {}
```

Ini sangat berbahaya jika type sama.

Constructor call masih compile jika dua-duanya `int`, tetapi semantic terbalik.

Karena itu untuk components dengan type sama, static factory bisa lebih aman:

```java
public record Range(int startInclusive, int endExclusive) {
    public static Range ofStartEnd(int startInclusive, int endExclusive) {
        return new Range(startInclusive, endExclusive);
    }
}
```

Nama component juga harus explicit.

---

## 96. Record dan Same-Type Parameter Trap

Buruk:

```java
public record TransferRequest(String fromAccountId, String toAccountId, BigDecimal amount) {}
```

Call site bisa salah:

```java
new TransferRequest(to, from, amount);
```

Lebih baik strong types:

```java
public record SourceAccountId(String value) {}
public record DestinationAccountId(String value) {}

public record TransferRequest(
    SourceAccountId from,
    DestinationAccountId to,
    Money amount
) {}
```

Atau static factory:

```java
TransferRequest.fromTo(from, to, amount);
```

Record constructor positional. Banyak same-type parameters meningkatkan risiko.

---

## 97. Record dan Factory Naming Untuk Same-Type Fields

```java
public record DateRange(LocalDate startInclusive, LocalDate endExclusive) {
    public DateRange {
        Objects.requireNonNull(startInclusive, "startInclusive");
        Objects.requireNonNull(endExclusive, "endExclusive");
        if (endExclusive.isBefore(startInclusive)) {
            throw new IllegalArgumentException("endExclusive must not be before startInclusive");
        }
    }

    public static DateRange closedOpen(LocalDate startInclusive, LocalDate endExclusive) {
        return new DateRange(startInclusive, endExclusive);
    }
}
```

Nama `closedOpen` memberi semantic interval.

---

## 98. Record dan Documentation of Equality

Untuk value object record, dokumentasikan equality jika ada normalization.

```java
/**
 * Case-insensitive email address. The value is normalized to lower case.
 * Two EmailAddress instances are equal when their normalized values are equal.
 */
public record EmailAddress(String value) { ... }
```

Jangan mengandalkan pembaca menebak normalization.

---

## 99. Record dan `readResolve`/Serialization Magic

Untuk Java native serialization, record memiliki aturan khusus; jangan terlalu cepat memasukkan custom serialization hook tanpa paham konsekuensinya.

Dalam sistem modern, lebih baik hindari native serialization untuk record domain/API.

Jika butuh singleton, enum lebih tepat.

Jika butuh stable wire contract, gunakan explicit schema.

---

## 100. Record dan API Surface Minimal

Record sudah expose semua components. Jangan tambahkan method publik terlalu banyak sampai record berubah menjadi service-like object.

Masih wajar:

```java
public record DateRange(LocalDate start, LocalDate end) {
    public boolean contains(LocalDate date) { ... }
    public long days() { ... }
}
```

Mulai mencurigakan:

```java
public record ApplicationRecord(...) {
    public void submit(ApplicationRepository repository) { ... }
    public void sendEmail(MailClient client) { ... }
    public void persist(EntityManager em) { ... }
}
```

Record sebaiknya tidak melakukan I/O, persistence, remote call, atau orchestration.

---

## 101. Record dan Clean `toString` Untuk Large Payload

Jika record punya collection besar:

```java
public record BatchResult(List<ItemResult> results) {}
```

Default toString bisa menghasilkan log besar.

Override:

```java
public record BatchResult(List<ItemResult> results) {
    public BatchResult {
        results = List.copyOf(results);
    }

    @Override
    public String toString() {
        return "BatchResult[count=" + results.size() + "]";
    }
}
```

Ini berguna untuk batch processing, audit-safe logging, dan failure diagnostics.

---

## 102. Record dan `Map.copyOf` Caveat

```java
public record Metadata(Map<String, String> values) {
    public Metadata {
        values = Map.copyOf(values);
    }
}
```

`Map.copyOf`:

- membuat unmodifiable copy;
- menolak null key/value;
- tidak menjamin order tertentu jika source map tidak ordered;
- shallow copy.

Jika order penting, gunakan explicit representation.

```java
public record OrderedMetadata(List<Entry> entries) {
    public OrderedMetadata {
        entries = List.copyOf(entries);
    }

    public record Entry(String key, String value) {}
}
```

---

## 103. Record dan Collection Order

Record equality untuk list memperhatikan order.

```java
public record Roles(List<String> roles) {
    public Roles {
        roles = List.copyOf(roles);
    }
}

new Roles(List.of("A", "B")).equals(new Roles(List.of("B", "A"))) // false
```

Jika semantic roles adalah set, gunakan Set dan normalisasi.

```java
public record Roles(Set<String> roles) {
    public Roles {
        roles = Set.copyOf(roles);
    }
}
```

Namun Set iteration order tidak selalu stable. Jika output order penting, simpan sorted list.

```java
public record Roles(List<String> roles) {
    public Roles {
        roles = roles.stream()
            .distinct()
            .sorted()
            .toList();
    }
}
```

Pilih representation sesuai semantic.

---

## 104. Record dan Duplicate Handling

Jika component list tidak boleh duplicate:

```java
public record PermissionSet(List<String> permissions) {
    public PermissionSet {
        Objects.requireNonNull(permissions, "permissions");
        permissions = permissions.stream()
            .map(String::trim)
            .filter(p -> !p.isBlank())
            .distinct()
            .sorted()
            .toList();
    }
}
```

Sekarang equality deterministic.

```java
new PermissionSet(List.of("WRITE", "READ"))
    .equals(new PermissionSet(List.of("READ", "WRITE", "READ"))) // true jika sorted/distinct
```

Ini contoh record constructor sebagai normalization boundary.

---

## 105. Record dan Deep Copy Strategy

Jika component nested mutable object, defensive copy harus lebih dalam.

```java
public record Schedule(List<Slot> slots) {
    public Schedule {
        slots = slots.stream()
            .map(Slot::copy)
            .toList();
    }
}
```

Tapi lebih baik buat `Slot` immutable.

```java
public record Slot(LocalTime start, LocalTime end) {
    public Slot {
        if (!end.isAfter(start)) {
            throw new IllegalArgumentException("end must be after start");
        }
    }
}

public record Schedule(List<Slot> slots) {
    public Schedule {
        slots = List.copyOf(slots);
    }
}
```

Desain terbaik biasanya membuat graph object immutable dari bawah, bukan copy manual tanpa akhir.

---

## 106. Record dan Dependency Direction

Record di package API/domain boleh dipakai oleh package luar. Tapi jangan record internal bergantung pada layer atas.

Buruk:

```java
package domain;

public record DomainResult(WebResponse response) {}
```

Domain tidak boleh tahu web response.

Lebih baik:

```java
package domain;

public record DomainResult(String id, DomainStatus status) {}
```

Mapping ke web response dilakukan di adapter.

Record tidak menghapus aturan dependency direction.

---

## 107. Record dan Naming Suffix

Suffix `Dto`, `Request`, `Response`, `Command`, `Event`, `Projection`, `View`, `Snapshot` bisa berguna jika menunjukkan boundary.

Contoh:

```java
SubmitApplicationRequest   // web/API input
SubmitApplicationCommand   // application use case input
ApplicationSubmittedEvent  // domain/integration event
ApplicationSnapshot        // immutable domain snapshot
CaseListProjection         // persistence/read projection
CaseView                   // UI/API view
```

Hindari suffix generic tanpa makna:

```java
UserData
UserInfo
UserObject
UserRecord
```

Nama harus menjelaskan role.

---

## 108. Record dan Test Data Builder

Record constructor positional bisa membuat test sulit jika banyak fields.

```java
new CaseView("C1", "A1", "SUBMITTED", now, "Officer", true, false)
```

Gunakan test factory/builder.

```java
public final class CaseViewTestData {
    public static CaseView submittedCase() {
        return new CaseView("C1", "A1", "SUBMITTED", Instant.parse("2026-01-01T00:00:00Z"));
    }
}
```

Atau builder khusus test.

Jangan mengorbankan production design hanya untuk test convenience.

---

## 109. Record dan Lombok

Record mengurangi kebutuhan Lombok untuk data carrier.

Namun Lombok masih sering dipakai untuk:

- builder;
- withers;
- logging;
- mutable POJO;
- framework-specific patterns.

Pertanyaan migration:

```text
Lombok @Value DTO sederhana         kandidat record
Lombok @Data mutable bean           bukan record otomatis
Lombok @Builder large object        evaluasi ulang object shape
Lombok entity                       biasanya jangan record
```

Jangan migrate Lombok class ke record secara mekanis.

---

## 110. Record dan Code Review Checklist

Saat review record, tanyakan:

1. Apakah type ini benar-benar transparent data carrier?
2. Apakah semua components bagian dari semantic state?
3. Apakah ada component mutable?
4. Jika ada collection/map, apakah defensive copy dilakukan?
5. Jika ada array, apakah record masih layak?
6. Apakah nullability jelas?
7. Apakah invariant lokal dijaga?
8. Apakah normalization perlu?
9. Apakah equality semantics sesuai?
10. Apakah `toString` aman untuk log?
11. Apakah component names stable?
12. Apakah component order aman?
13. Apakah banyak same-type parameters?
14. Apakah record public API atau internal?
15. Apakah schema/versioning diperhatikan?
16. Apakah framework mendukung record?
17. Apakah record dipakai sebagai entity/service secara salah?
18. Apakah ada sensitive data?
19. Apakah builder diperlukan karena record terlalu besar?
20. Apakah class biasa lebih tepat?

---

## 111. Decision Matrix

```text
Use record when:
  - data shape is the semantic contract
  - fields can be final
  - equality should include all components
  - accessors can be public
  - representation can be transparent
  - local invariants are simple
  - object is DTO/view/result/value-like
  - API evolution is controlled

Avoid record when:
  - identity/lifecycle dominates
  - object must be mutable
  - representation must be hidden
  - equality is not component-based
  - component contains mutable array/sensitive data
  - framework requires no-args/proxy/setters
  - public API needs frequent evolution
  - object is service/dependency holder
  - behavior involves I/O/orchestration
```

---

## 112. Worked Example: Designing a Search API Model

### Bad first design

```java
public record SearchRequest(
    String keyword,
    String status,
    String fromDate,
    String toDate,
    Integer page,
    Integer size,
    String sortBy,
    Boolean desc
) {}
```

Problems:

- raw strings for dates/status;
- nullable everything;
- weak validation;
- boolean unclear;
- page/size default ambiguous;
- sort field stringly typed;
- too much boundary concern.

### Better boundary record

```java
public record SearchRequest(
    String keyword,
    String status,
    LocalDate fromDate,
    LocalDate toDate,
    Integer page,
    Integer size,
    String sortBy,
    Boolean descending
) {}
```

Still boundary-level, allows raw optional fields.

### Application command

```java
public record SearchCasesCommand(
    SearchKeyword keyword,
    Optional<CaseStatus> status,
    Optional<DateRange> dateRange,
    PageSpec page,
    SortSpec sort
) {}
```

### Supporting records/classes

```java
public record SearchKeyword(String value) {
    public SearchKeyword {
        value = value == null ? "" : value.strip();
    }
}

public record DateRange(LocalDate from, LocalDate to) {
    public DateRange {
        Objects.requireNonNull(from, "from");
        Objects.requireNonNull(to, "to");
        if (to.isBefore(from)) {
            throw new IllegalArgumentException("to must not be before from");
        }
    }
}

public record PageSpec(int page, int size) {
    public PageSpec {
        if (page < 0) {
            throw new IllegalArgumentException("page must be >= 0");
        }
        if (size <= 0 || size > 100) {
            throw new IllegalArgumentException("size must be 1..100");
        }
    }

    public static PageSpec ofNullable(Integer page, Integer size) {
        return new PageSpec(page == null ? 0 : page, size == null ? 20 : size);
    }
}

public enum SortDirection {
    ASC,
    DESC
}

public record SortSpec(String field, SortDirection direction) {
    public SortSpec {
        Objects.requireNonNull(field, "field");
        Objects.requireNonNull(direction, "direction");
    }
}
```

### Mapper

```java
public final class SearchCasesMapper {
    public SearchCasesCommand toCommand(SearchRequest request) {
        Optional<DateRange> range = buildDateRange(request.fromDate(), request.toDate());

        return new SearchCasesCommand(
            new SearchKeyword(request.keyword()),
            parseStatus(request.status()),
            range,
            PageSpec.ofNullable(request.page(), request.size()),
            new SortSpec(
                request.sortBy() == null ? "lastUpdatedAt" : request.sortBy(),
                Boolean.TRUE.equals(request.descending()) ? SortDirection.DESC : SortDirection.ASC
            )
        );
    }

    private Optional<CaseStatus> parseStatus(String status) {
        if (status == null || status.isBlank()) {
            return Optional.empty();
        }
        return Optional.of(CaseStatus.valueOf(status.trim().toUpperCase(Locale.ROOT)));
    }

    private Optional<DateRange> buildDateRange(LocalDate from, LocalDate to) {
        if (from == null && to == null) {
            return Optional.empty();
        }
        if (from == null || to == null) {
            throw new IllegalArgumentException("fromDate and toDate must be provided together");
        }
        return Optional.of(new DateRange(from, to));
    }
}
```

Lesson:

- boundary record can be lenient;
- application command should be normalized;
- small records strengthen invariants;
- mapping is where interpretation happens.

---

## 113. Worked Example: Sealed Result with Records

```java
public sealed interface SubmitCaseResult
        permits SubmitCaseResult.Accepted,
                SubmitCaseResult.ValidationFailed,
                SubmitCaseResult.Duplicate,
                SubmitCaseResult.SystemRejected {

    record Accepted(String caseId, Instant acceptedAt) implements SubmitCaseResult {
        public Accepted {
            Objects.requireNonNull(caseId, "caseId");
            Objects.requireNonNull(acceptedAt, "acceptedAt");
        }
    }

    record ValidationFailed(List<ValidationError> errors) implements SubmitCaseResult {
        public ValidationFailed {
            errors = List.copyOf(errors);
        }
    }

    record Duplicate(String existingCaseId) implements SubmitCaseResult {
        public Duplicate {
            Objects.requireNonNull(existingCaseId, "existingCaseId");
        }
    }

    record SystemRejected(String reasonCode, String message) implements SubmitCaseResult {
        public SystemRejected {
            Objects.requireNonNull(reasonCode, "reasonCode");
            Objects.requireNonNull(message, "message");
        }
    }
}
```

Consumer:

```java
public SubmitCaseResponse toResponse(SubmitCaseResult result) {
    return switch (result) {
        case SubmitCaseResult.Accepted accepted ->
            SubmitCaseResponse.accepted(accepted.caseId());

        case SubmitCaseResult.ValidationFailed failed ->
            SubmitCaseResponse.validationFailed(failed.errors());

        case SubmitCaseResult.Duplicate duplicate ->
            SubmitCaseResponse.duplicate(duplicate.existingCaseId());

        case SubmitCaseResult.SystemRejected rejected ->
            SubmitCaseResponse.rejected(rejected.reasonCode(), rejected.message());
    };
}
```

Ini lebih kuat daripada:

```java
public record SubmitCaseResult(
    boolean success,
    String caseId,
    String errorCode,
    List<String> errors
) {}
```

Karena impossible states berkurang.

---

## 114. Worked Example: Record as Composite Cache Key

Bad:

```java
String key = tenantId + ":" + postalCode + ":" + locale;
```

Better:

```java
public record AddressLookupKey(
    String tenantId,
    String postalCode,
    Locale locale
) {
    public AddressLookupKey {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(postalCode, "postalCode");
        Objects.requireNonNull(locale, "locale");
        postalCode = postalCode.trim();
    }
}
```

Usage:

```java
Map<AddressLookupKey, AddressResult> cache = new ConcurrentHashMap<>();

AddressLookupKey key = new AddressLookupKey(tenantId, postalCode, locale);
return cache.computeIfAbsent(key, this::lookupAddress);
```

Benefits:

- no delimiter collision;
- clear equality;
- self-documenting;
- safe refactor;
- easier test;
- supports additional component explicitly.

But if key becomes public API, adding component changes semantics.

---

## 115. Failure Model

Records fail in predictable categories.

### 115.1 Mutable component failure

Symptom:

- HashMap lookup fails;
- equality changes over time;
- snapshot changes unexpectedly.

Cause:

- mutable collection/array/object stored as component.

Prevention:

- defensive copy;
- immutable components;
- avoid arrays;
- deep immutable design.

### 115.2 Sensitive data leakage

Symptom:

- password/token appears in logs;
- PII appears in trace;
- audit exports expose internal data.

Cause:

- default `toString`;
- public accessor;
- reflection/serialization.

Prevention:

- avoid record for secrets;
- override `toString`;
- redaction;
- boundary-specific DTO.

### 115.3 API compatibility break

Symptom:

- consumer compile errors;
- runtime `NoSuchMethodError`;
- JSON/schema mismatch;
- pattern matching break.

Cause:

- component rename/add/remove/reorder/type change.

Prevention:

- treat record header as public contract;
- version DTOs;
- use class for highly evolvable API;
- compatibility tests.

### 115.4 Wrong equality semantics

Symptom:

- duplicate detection wrong;
- cache key mismatch;
- set behavior surprising.

Cause:

- BigDecimal scale;
- array identity;
- unordered list semantic;
- floating point;
- mutable nested object.

Prevention:

- normalize;
- choose correct component type;
- override only when necessary;
- test equality explicitly.

### 115.5 Framework mismatch

Symptom:

- deserialization fails;
- ORM fails;
- proxy fails;
- no default constructor error.

Cause:

- framework expects mutable bean/proxy/no-args constructor.

Prevention:

- verify framework support;
- use boundary mapper;
- use class for framework-managed entity.

---

## 116. Practical Rules of Thumb

1. Use record when the type is primarily data and its public components are its meaning.
2. Do not use record just to reduce boilerplate.
3. Treat record header as public API.
4. Validate local invariants in compact constructor.
5. Normalize before assignment when equality depends on canonical form.
6. Defensive copy collections/maps.
7. Avoid arrays as record components.
8. Avoid secrets as record components.
9. Be careful with BigDecimal, floating point, and unordered collections.
10. Prefer small records with meaningful names.
11. Use sealed interface + records for finite result/variant modeling.
12. Do not use record for entity lifecycle object by default.
13. Do not use record for service/dependency holder.
14. Prefer package-private/local records for internal intermediate shapes.
15. Document nullability, units, time semantics, and compatibility expectations.

---

## 117. Mental Model Summary

Record adalah class khusus yang membantu kita mengekspresikan data aggregate secara ringkas dan aman, selama kita menerima konsekuensi desainnya.

Pusat pemahamannya:

```text
record = transparent data carrier
       + fixed component set
       + generated component-based object contract
       + shallow immutability
       + public accessor for every component
       + sensitive API evolution surface
```

Record paling kuat ketika digunakan untuk:

- value-like object sederhana;
- DTO/request/response;
- query projection;
- immutable snapshot;
- command/event payload;
- sealed result variants;
- cache key;
- local intermediate result.

Record paling berbahaya ketika digunakan untuk:

- mutable entity;
- service;
- secret holder;
- framework proxy target;
- highly evolving public contract;
- data bag dengan banyak flag;
- object dengan hidden representation.

Top engineer tidak bertanya:

> “Apakah ini bisa dibuat record?”

Tetapi:

> “Apakah transparent component-based object contract adalah semantic yang benar untuk type ini?”

Jika jawabannya iya, record adalah alat yang sangat kuat. Jika tidak, class biasa tetap lebih tepat.

---

## 118. Latihan

### Latihan 1: Refactor DTO Mutable ke Record

Ubah class ini menjadi record yang aman:

```java
public class UserView {
    private String id;
    private String name;
    private List<String> roles;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public List<String> getRoles() { return roles; }
    public void setRoles(List<String> roles) { this.roles = roles; }
}
```

Target:

- id/name non-null;
- roles immutable copy;
- no null role;
- deterministic equality.

### Latihan 2: Pilih Record atau Class

Untuk masing-masing type, pilih record/class dan jelaskan alasannya:

1. `PasswordHash`
2. `CaseListItem`
3. `ApplicationAggregate`
4. `Money`
5. `SubmitApplicationCommand`
6. `UserService`
7. `AddressLookupCacheKey`
8. `AuditLogPayload`

### Latihan 3: Sealed Result

Desain result untuk use case `ApproveCase`:

- approved;
- already approved;
- rejected because missing document;
- rejected because officer not authorized;
- system failure.

Gunakan sealed interface + records.

### Latihan 4: Equality Trap

Jelaskan bug dari record ini:

```java
public record FileHash(byte[] digest) {}
```

Perbaiki dengan dua alternatif:

1. tetap record;
2. ubah menjadi class.

### Latihan 5: API Evolution

Anda memiliki public record:

```java
public record CustomerResponse(String id, String name) {}
```

Sekarang perlu menambah `email`, `phoneNumber`, dan `status`.

Rancang strategi evolusi yang meminimalkan breakage.

---

## 119. Referensi Resmi

- Java SE 25 Language Guide: Record Classes.
- Java SE 25 API: `java.lang.Record`.
- Java Language Specification Java SE 25: Record Classes, Record Components, Record Constructors.
- OpenJDK JEP 395: Records.
- OpenJDK JEP 440: Record Patterns.

---

## 120. Penutup Part 008

Part ini membahas records sebagai alat desain, bukan sekadar syntax ringkas.

Kita sudah melihat:

- record sebagai transparent carrier;
- canonical dan compact constructor;
- validation dan normalization;
- shallow immutability;
- defensive copy;
- equality/hash/toString consequences;
- record vs class;
- record vs entity;
- record + sealed hierarchy;
- record untuk DTO, command, event, result, projection, cache key;
- API compatibility dan schema evolution;
- reflection, annotation, code generation, module boundary;
- failure model dan checklist review.

Seri belum selesai.

Part berikutnya:

`learn-java-oop-functional-reflection-codegen-modules-part-009.md`

Topik:

**Enums as Type-Safe State, Strategy, Registry, and Domain Model**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-007](./learn-java-oop-functional-reflection-codegen-modules-part-007.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-009](./learn-java-oop-functional-reflection-codegen-modules-part-009.md)
