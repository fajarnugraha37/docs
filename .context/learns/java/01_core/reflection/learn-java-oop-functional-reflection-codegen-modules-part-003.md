# learn-java-oop-functional-reflection-codegen-modules-part-003

# Object Identity, Equality, Hashing, Immutability, and Object Contracts

> Seri: Java OOP, Functional, Reflection, Code Generation, Modules & Package Management  
> Part: 003  
> Target: advance Java engineer yang ingin berpikir bukan hanya “cara override `equals`/`hashCode`”, tetapi memahami konsekuensi desain object contract terhadap collection, cache, API publik, ORM/proxy, generated code, module boundary, dan evolusi sistem jangka panjang.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 001 kita membedakan:

- type
- class
- object
- reference
- value
- identity
- compile-time type
- runtime class

Pada Part 002 kita melihat anatomy class:

- field
- method
- constructor
- initializer
- class loading
- class identity

Sekarang kita masuk ke konsekuensi praktis pertama dari object model Java:

> Kapan dua object dianggap “sama”?

Pertanyaan ini terlihat kecil, tetapi efeknya besar. Jawabannya menentukan perilaku:

- `HashMap`
- `HashSet`
- `ConcurrentHashMap`
- cache
- deduplication
- dirty checking
- object graph traversal
- audit diff
- validation
- persistence identity
- domain modeling
- serialization
- distributed message handling
- generated DTO
- record
- proxy
- reflection-heavy framework
- public library API

Kesalahan equality/hash sering tidak meledak di compile-time. Ia muncul sebagai bug data:

- duplicate data yang seharusnya tidak duplicate
- object tidak bisa ditemukan di `HashMap`
- cache miss misterius
- audit diff salah
- entity dianggap berubah padahal tidak
- entity dianggap sama padahal berbeda
- infinite recursion pada `toString`
- stack overflow pada bidirectional object graph
- privacy leak di log
- test flaky
- production behavior berbeda setelah proxy/framework masuk

Part ini membangun mental model yang cukup kuat untuk mendesain object contract dengan sengaja.

---

## 1. Mental Model Utama: Object Punya Tiga “Wajah”

Dalam Java, object dapat dilihat dari tiga sudut:

```text
+-----------------------+
|       Object          |
+-----------------------+
| 1. Identity            | siapa object ini?
| 2. State               | apa isi object ini?
| 3. Behavior/Contract   | bagaimana object ini berinteraksi?
+-----------------------+
```

### 1.1 Identity

Identity menjawab:

> Apakah ini object instance yang sama di memory/runtime?

Operator utama:

```java
a == b
```

Untuk reference type, `==` membandingkan apakah dua reference menunjuk ke object yang sama.

Contoh:

```java
var a = new CustomerId("C-001");
var b = new CustomerId("C-001");

System.out.println(a == b);      // false
System.out.println(a.equals(b)); // tergantung implementasi equals
```

`a` dan `b` adalah dua object berbeda. Tetapi secara domain, mungkin keduanya mewakili customer id yang sama.

### 1.2 State

State menjawab:

> Data apa yang tersimpan dalam object ini?

Contoh:

```java
final class Money {
    private final String currency;
    private final long minorUnits;

    Money(String currency, long minorUnits) {
        this.currency = currency;
        this.minorUnits = minorUnits;
    }
}
```

Dua `Money` bisa berbeda identity tetapi punya state sama:

```java
var x = new Money("SGD", 1000);
var y = new Money("SGD", 1000);
```

Secara domain, keduanya hampir pasti seharusnya dianggap equal.

### 1.3 Behavior/Contract

Contract menjawab:

> Janji apa yang diberikan object ini kepada caller dan collection?

Contract Java paling fundamental:

- `equals`
- `hashCode`
- `toString`

Ketiganya berasal dari `java.lang.Object`.

Tetapi yang penting bukan hanya override method-nya. Yang penting adalah pilihan desain:

```text
Apakah class ini identity-based atau value-based?
Apakah equality-nya stabil?
Apakah aman dipakai sebagai Map key?
Apakah aman di-log?
Apakah aman di-proxy?
Apakah aman berevolusi sebagai public API?
```

---

## 2. `==` vs `equals`: Dua Level Kesamaan

### 2.1 `==` Untuk Reference Equality

```java
String a = new String("hello");
String b = new String("hello");

System.out.println(a == b);      // false
System.out.println(a.equals(b)); // true
```

`==` bertanya:

> Apakah ini object yang sama?

`equals` bertanya:

> Apakah object ini dianggap sama menurut kontrak class?

Default `Object.equals` pada dasarnya identity equality. Jika class tidak override `equals`, maka `equals` sama seperti `==`.

### 2.2 `equals` Untuk Logical Equality

Logical equality bergantung pada domain.

Contoh value object:

```java
public final class EmailAddress {
    private final String value;

    public EmailAddress(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("email is required");
        }
        this.value = value.trim().toLowerCase();
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof EmailAddress that)) return false;
        return value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }
}
```

Dua `EmailAddress` dengan value normalized sama dianggap equal walaupun object instance berbeda.

### 2.3 Kesalahan Umum

Kesalahan umum:

```java
if (name == "admin") { ... }
```

Harusnya:

```java
if ("admin".equals(name)) { ... }
```

Tetapi top engineer tidak berhenti di “gunakan `.equals` untuk String”. Pertanyaan yang lebih dalam:

> Apakah representasi string seharusnya langsung dipakai, atau perlu type eksplisit?

Lebih baik:

```java
record RoleName(String value) {
    public RoleName {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("role name is required");
        }
        value = value.trim().toLowerCase();
    }
}
```

Karena equality domain lebih aman ketika domain concept diberi type.

---

## 3. Contract `equals`

`equals` bukan sekadar method boolean. Ia punya contract.

Untuk non-null reference value, equality harus memenuhi:

```text
1. Reflexive
   x.equals(x) == true

2. Symmetric
   x.equals(y) == true  =>  y.equals(x) == true

3. Transitive
   x.equals(y) == true && y.equals(z) == true  =>  x.equals(z) == true

4. Consistent
   selama state relevan tidak berubah, hasil equals harus konsisten

5. Non-null
   x.equals(null) == false
```

Mari kita bahas bukan sebagai hafalan, tetapi sebagai invariant runtime.

---

## 4. Reflexive: Object Harus Sama Dengan Dirinya Sendiri

```java
x.equals(x) == true
```

Terdengar trivial, tetapi bisa rusak kalau `equals` ditulis buruk.

Contoh buruk:

```java
final class TemperatureReading {
    private final Double value;

    TemperatureReading(Double value) {
        this.value = value;
    }

    @Override
    public boolean equals(Object other) {
        if (!(other instanceof TemperatureReading that)) return false;
        return value == that.value; // buruk untuk wrapper/reference
    }
}
```

Untuk object wrapper tertentu, perbandingan reference bisa membuat hasil tidak sesuai logical equality.

Lebih aman:

```java
@Override
public boolean equals(Object other) {
    if (this == other) return true;
    if (!(other instanceof TemperatureReading that)) return false;
    return Objects.equals(value, that.value);
}
```

`this == other` sering dipakai sebagai fast path dan sekaligus menjaga reflexivity.

---

## 5. Symmetric: Equality Harus Dua Arah

```java
x.equals(y) == y.equals(x)
```

Symmetry sering rusak pada inheritance.

Contoh klasik:

```java
class Point {
    final int x;
    final int y;

    Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    @Override
    public boolean equals(Object other) {
        if (!(other instanceof Point that)) return false;
        return x == that.x && y == that.y;
    }

    @Override
    public int hashCode() {
        return Objects.hash(x, y);
    }
}

class ColoredPoint extends Point {
    final String color;

    ColoredPoint(int x, int y, String color) {
        super(x, y);
        this.color = color;
    }

    @Override
    public boolean equals(Object other) {
        if (!(other instanceof ColoredPoint that)) return false;
        return super.equals(that) && Objects.equals(color, that.color);
    }
}
```

Masalah:

```java
Point p = new Point(1, 2);
ColoredPoint cp = new ColoredPoint(1, 2, "red");

p.equals(cp);  // true, karena cp instanceof Point
cp.equals(p);  // false, karena p bukan ColoredPoint
```

Symmetry rusak.

### 5.1 Pelajaran Desain

Jika class dirancang untuk equality berbasis value, inheritance sering menjadi bahaya.

Karena itu value class biasanya lebih aman:

```java
public final class Point { ... }
```

Atau gunakan `record`:

```java
public record Point(int x, int y) {}
```

### 5.2 Rule Praktis

Untuk class value-like:

```text
Prefer final class atau record.
Jangan biarkan subclass mengubah equality semantics.
```

Untuk class yang memang butuh inheritance, pertimbangkan:

- equality tetap identity-based
- equality hanya di root final hierarchy
- sealed hierarchy dengan aturan jelas
- composition daripada inheritance

---

## 6. Transitive: Equality Tidak Boleh Membentuk Segitiga Rusak

```text
Jika A sama dengan B,
dan B sama dengan C,
maka A harus sama dengan C.
```

Inheritance juga bisa merusak transitivity.

Misalnya kita mencoba memperbaiki symmetry dengan mengizinkan `ColoredPoint` dibandingkan ke `Point` hanya berdasarkan koordinat ketika lawan bukan `ColoredPoint`.

```java
@Override
public boolean equals(Object other) {
    if (!(other instanceof Point)) return false;

    if (!(other instanceof ColoredPoint)) {
        return other.equals(this);
    }

    ColoredPoint that = (ColoredPoint) other;
    return super.equals(that) && Objects.equals(color, that.color);
}
```

Lalu:

```java
ColoredPoint red  = new ColoredPoint(1, 2, "red");
Point plain       = new Point(1, 2);
ColoredPoint blue = new ColoredPoint(1, 2, "blue");
```

Kemungkinan:

```text
red equals plain  -> true
plain equals blue -> true
red equals blue   -> false
```

Transitivity rusak.

### 6.1 Pelajaran Besar

> Equality yang melibatkan inheritance dan tambahan state hampir selalu rawan.

Karena itu untuk value object:

- pakai `final class`
- atau `record`
- atau sealed hierarchy dengan equality didefinisikan hati-hati
- atau hindari overriding equality di subclass

---

## 7. Consistency: Equality Harus Stabil Selama State Relevan Stabil

Ini berkaitan langsung dengan mutability.

Contoh buruk:

```java
final class UserKey {
    private String username;

    UserKey(String username) {
        this.username = username;
    }

    void rename(String username) {
        this.username = username;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof UserKey that)) return false;
        return Objects.equals(username, that.username);
    }

    @Override
    public int hashCode() {
        return Objects.hash(username);
    }
}
```

Masalah:

```java
var key = new UserKey("alice");
var map = new HashMap<UserKey, String>();

map.put(key, "profile");
key.rename("bob");

System.out.println(map.get(key)); // bisa null
```

Kenapa?

`HashMap` menaruh entry berdasarkan hash saat insert. Setelah field yang dipakai untuk `hashCode` berubah, object “berpindah secara logical” tetapi bucket fisiknya tidak berubah.

### 7.1 Invariant Hash Collection

Untuk object yang dipakai sebagai key di hash-based collection:

```text
Field yang menentukan equals/hashCode harus tidak berubah selama object ada di collection.
```

Lebih ketat:

```text
Key object sebaiknya immutable.
```

---

## 8. Non-null: `equals(null)` Harus False

```java
x.equals(null) == false
```

Implementasi idiomatik:

```java
@Override
public boolean equals(Object other) {
    if (this == other) return true;
    if (!(other instanceof EmailAddress that)) return false;
    return value.equals(that.value);
}
```

`instanceof` terhadap `null` selalu false, jadi aman.

---

## 9. Contract `hashCode`

`hashCode` punya relasi erat dengan `equals`.

Contract inti:

```text
Jika x.equals(y) == true,
maka x.hashCode() harus sama dengan y.hashCode().
```

Tetapi kebalikannya tidak wajib:

```text
Jika x.hashCode() == y.hashCode(),
belum tentu x.equals(y) == true.
```

Hash collision boleh terjadi.

### 9.1 Kenapa Contract Ini Penting?

Hash-based collection memakai dua tahap:

```text
1. Gunakan hashCode untuk menemukan bucket kandidat.
2. Gunakan equals untuk memastikan logical equality.
```

Diagram:

```text
put(key, value)
   |
   v
hash = key.hashCode()
   |
   v
bucket = index(hash)
   |
   v
compare existing keys with equals
```

Jika `equals` true tetapi `hashCode` beda, object bisa masuk bucket berbeda dan collection gagal menemukan duplicate.

Contoh bug:

```java
final class OrderId {
    private final String value;

    OrderId(String value) {
        this.value = value;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof OrderId that)) return false;
        return Objects.equals(value, that.value);
    }

    // hashCode tidak di-override
}
```

Bug:

```java
var a = new OrderId("O-1");
var b = new OrderId("O-1");

System.out.println(a.equals(b)); // true

var set = new HashSet<OrderId>();
set.add(a);
set.add(b);

System.out.println(set.size()); // bisa 2, melanggar ekspektasi domain
```

Karena default `hashCode` identity-based.

### 9.2 Rule Keras

```text
Override equals dan hashCode bersama-sama.
Atau override neither.
```

---

## 10. Hash Collision Bukan Bug, Tetapi Kualitas Hash Tetap Penting

Dua object berbeda boleh punya hash sama.

```java
x.equals(y) == false
x.hashCode() == y.hashCode() // allowed
```

Tetapi hash yang buruk dapat merusak performance.

Contoh buruk:

```java
@Override
public int hashCode() {
    return 1;
}
```

Secara contract benar, tetapi semua key masuk bucket sama.

Efek:

```text
HashMap ideal: O(1) rata-rata
HashMap dengan hash buruk: degradasi, collision tinggi, compare equals banyak
```

### 10.1 Gunakan Field Yang Sama Dengan equals

Jika equality berdasarkan `currency` dan `minorUnits`, hash juga harus berdasarkan keduanya.

```java
@Override
public boolean equals(Object other) {
    if (this == other) return true;
    if (!(other instanceof Money that)) return false;
    return minorUnits == that.minorUnits
        && Objects.equals(currency, that.currency);
}

@Override
public int hashCode() {
    return Objects.hash(currency, minorUnits);
}
```

Untuk high-performance hot path, `Objects.hash` bisa punya overhead karena varargs array. Bisa manual:

```java
@Override
public int hashCode() {
    int result = currency.hashCode();
    result = 31 * result + Long.hashCode(minorUnits);
    return result;
}
```

### 10.2 Jangan Masukkan Field Turunan Yang Tidak Dipakai equals

Buruk:

```java
@Override
public boolean equals(Object other) {
    if (!(other instanceof Customer that)) return false;
    return Objects.equals(id, that.id);
}

@Override
public int hashCode() {
    return Objects.hash(id, displayName); // salah kalau displayName tidak dipakai equals
}
```

Jika dua customer punya id sama tapi displayName berbeda:

```text
equals true tetapi hashCode berbeda
```

Contract rusak.

---

## 11. `toString`: Debugging Contract, Logging Boundary, dan Data Exposure

`toString` sering dianggap kurang penting. Padahal di sistem enterprise, `toString` berpengaruh pada:

- log
- exception message
- debugging
- audit troubleshooting
- observability
- test failure output
- generated diagnostic

### 11.1 Tujuan `toString`

`toString` sebaiknya memberikan representasi manusiawi untuk debugging, bukan format data stabil.

Buruk:

```java
@Override
public String toString() {
    return id + "," + name + "," + email;
}
```

Masalah:

- tidak jelas field mana yang mana
- raw email mungkin data sensitif
- caller bisa salah menganggap format ini stabil

Lebih baik:

```java
@Override
public String toString() {
    return "Customer{id=" + id + ", name=" + name + "}";
}
```

Jika ada data sensitif:

```java
@Override
public String toString() {
    return "Customer{id=" + id + ", email=<redacted>}";
}
```

### 11.2 Jangan Jadikan `toString` Sebagai Serialization Format

Jangan desain:

```java
String payload = order.toString();
```

Karena `toString` tidak punya contract stabil untuk machine parsing.

Gunakan:

- JSON serializer
- protobuf
- explicit mapper
- explicit export format

### 11.3 Hindari Recursive `toString`

Contoh object graph bidirectional:

```java
final class Department {
    private List<Employee> employees;
}

final class Employee {
    private Department department;
}
```

Jika `Department.toString()` mencetak employees dan `Employee.toString()` mencetak department, bisa terjadi infinite recursion.

Rule:

```text
Untuk object graph besar/bidirectional, toString hanya cetak identity ringkas.
```

Contoh:

```java
@Override
public String toString() {
    return "Employee{id=" + id + ", name=" + name + "}";
}
```

---

## 12. Identity-Based Class vs Value-Based Class

Salah satu keputusan desain paling penting:

```text
Apakah class ini identity-based atau value-based?
```

### 12.1 Identity-Based Class

Identity-based class adalah class yang object-nya mewakili entity unik.

Contoh:

- database entity
- session
- lock
- connection
- actor
- aggregate root
- runtime component
- mutable service object
- thread-like object
- object yang punya lifecycle

Untuk identity-based object, dua instance dengan state sama belum tentu sama.

Contoh:

```java
final class UserSession {
    private final String sessionId;
    private Instant lastAccessedAt;
}
```

Sesi adalah object dengan lifecycle. Equality bisa berdasarkan identity object atau session id tergantung desain.

### 12.2 Value-Based Class

Value-based class adalah class yang equality-nya ditentukan oleh value.

Contoh:

- `Money`
- `EmailAddress`
- `PostalCode`
- `DateRange`
- `Coordinate`
- `CustomerId`
- `OrderNumber`

Dua value object dengan state sama dianggap sama.

```java
record Money(String currency, long minorUnits) {}

new Money("SGD", 100).equals(new Money("SGD", 100)); // true
```

### 12.3 Decision Table

| Pertanyaan | Jika Ya | Implikasi |
|---|---:|---|
| Object punya lifecycle sendiri? | Identity-based | Hindari value equality penuh |
| Object mewakili nilai/domain scalar? | Value-based | Override equals/hashCode atau gunakan record |
| Object mutable? | Biasanya identity-based | Jangan jadikan key hash collection jika equality mutable |
| Object immutable? | Value-based mungkin cocok | Aman untuk map key/cache key |
| Object dikelola ORM? | Hati-hati | Entity equality punya aturan khusus |
| Object hasil generated DTO? | Biasanya value-ish | Tapi cek array/list/mutable component |
| Object service/component? | Identity-based | Jangan override equals/hashCode kecuali ada alasan kuat |

---

## 13. Entity Equality vs Value Object Equality

Dalam domain modeling, bedakan entity dan value object.

### 13.1 Value Object

Value object equality berdasarkan semua field yang mendefinisikan nilai.

```java
public record DateRange(LocalDate start, LocalDate end) {
    public DateRange {
        Objects.requireNonNull(start);
        Objects.requireNonNull(end);
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
    }
}
```

Dua `DateRange` sama jika start dan end sama.

### 13.2 Entity

Entity equality lebih rumit.

Contoh:

```java
final class Customer {
    private CustomerId id;
    private String name;
    private EmailAddress email;
}
```

Apakah equality berdasarkan:

- object identity?
- database id?
- business key?
- semua fields?

Jawaban tergantung lifecycle.

### 13.3 Entity Dengan Database ID

Masalah umum:

```java
class CustomerEntity {
    private Long id; // null sebelum persisted
    private String email;

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof CustomerEntity that)) return false;
        return Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

Bug:

```java
var c1 = new CustomerEntity(null, "a@example.com");
var c2 = new CustomerEntity(null, "b@example.com");

c1.equals(c2); // true jika id sama-sama null, salah besar
```

Bisa diperbaiki:

```java
@Override
public boolean equals(Object other) {
    if (this == other) return true;
    if (!(other instanceof CustomerEntity that)) return false;
    return id != null && id.equals(that.id);
}

@Override
public int hashCode() {
    return getClass().hashCode();
}
```

Tetapi ini pun punya trade-off.

### 13.4 Business Key Equality

Jika entity punya natural/business key yang immutable:

```java
final class Country {
    private final String isoCode;
    private String displayName;

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof Country that)) return false;
        return Objects.equals(isoCode, that.isoCode);
    }

    @Override
    public int hashCode() {
        return Objects.hash(isoCode);
    }
}
```

Ini aman jika:

```text
isoCode immutable dan globally unique dalam domain.
```

Tidak aman jika business key bisa berubah.

### 13.5 Entity Equality Rule Praktis

Untuk entity:

```text
Jangan otomatis generate equals/hashCode dari semua fields.
```

Kenapa?

- field mutable
- object graph besar
- lazy proxy
- bidirectional reference
- persistence lifecycle
- ID belum ada sebelum insert
- audit field berubah
- association berubah
- performance buruk
- stack overflow

Untuk entity, equality harus didesain eksplisit.

---

## 14. DTO Equality

DTO tampak sederhana:

```java
record CustomerResponse(String id, String name, String email) {}
```

Record memberi equality berdasarkan semua components.

Ini cocok untuk:

- test assertion
- cache value comparison
- snapshot comparison
- idempotency payload comparison

Tetapi hati-hati jika DTO berisi mutable component:

```java
record CustomerResponse(String id, List<String> tags) {}
```

Record field `tags` final, tetapi list-nya bisa mutable.

```java
var tags = new ArrayList<>(List.of("vip"));
var dto = new CustomerResponse("C-1", tags);

var set = new HashSet<CustomerResponse>();
set.add(dto);

tags.add("blocked");

System.out.println(set.contains(dto)); // bisa false
```

Solusi:

```java
record CustomerResponse(String id, List<String> tags) {
    CustomerResponse {
        tags = List.copyOf(tags);
    }
}
```

Record bukan deep immutable secara otomatis. Record hanya membuat field component final dan menyediakan method berbasis component.

---

## 15. Record Equality

Record adalah pilihan bagus untuk value carrier.

Contoh:

```java
public record CustomerId(String value) {
    public CustomerId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("customer id is required");
        }
        value = value.trim();
    }
}
```

Record otomatis menyediakan:

- accessor component
- `equals`
- `hashCode`
- `toString`

Equality record berdasarkan:

```text
same record class + same component values
```

### 15.1 Record Dengan Array: Trap Besar

Array equality default adalah reference equality.

```java
record Blob(byte[] bytes) {}

var a = new Blob(new byte[] {1, 2});
var b = new Blob(new byte[] {1, 2});

System.out.println(a.equals(b)); // false
```

Karena `byte[]` tidak override `equals` untuk content equality.

Jika butuh content equality, jangan langsung expose array mutable. Bisa pakai immutable wrapper atau custom class.

Contoh:

```java
public final class Bytes {
    private final byte[] value;

    public Bytes(byte[] value) {
        this.value = value.clone();
    }

    public byte[] toByteArray() {
        return value.clone();
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof Bytes that)) return false;
        return Arrays.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(value);
    }
}
```

Lalu:

```java
record Blob(Bytes bytes) {}
```

### 15.2 Record Dengan BigDecimal

`BigDecimal.equals` mempertimbangkan scale.

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")); // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")); // 0
```

Jika record memakai `BigDecimal`:

```java
record Amount(BigDecimal value) {}
```

Maka equality mengikuti `BigDecimal.equals`, bukan numeric comparison.

Solusi bisa normalize:

```java
public record Amount(BigDecimal value) {
    public Amount {
        Objects.requireNonNull(value);
        value = value.stripTrailingZeros();
    }
}
```

Tetapi normalisasi harus sesuai domain.

---

## 16. Proxy Equality: Framework Boundary Yang Sering Merusak Asumsi

Reflection/proxy framework bisa membuat runtime class berbeda dari source class yang Anda tulis.

Contoh konsep:

```text
Source class:       CustomerEntity
Runtime instance:   CustomerEntity$Proxy$123
```

Jika equals memakai:

```java
if (getClass() != other.getClass()) return false;
```

Maka proxy subclass bisa gagal dibandingkan dengan real entity.

Jika equals memakai:

```java
if (!(other instanceof CustomerEntity that)) return false;
```

Maka subclass bisa dianggap sama, tetapi inheritance symmetry risk muncul.

### 16.1 `getClass` vs `instanceof`

| Pendekatan | Kelebihan | Risiko |
|---|---|---|
| `getClass() == other.getClass()` | Strict, aman untuk value final semantics | Proxy/subclass bisa gagal |
| `instanceof` | Lebih fleksibel terhadap subtype/proxy | Inheritance equality bisa rusak |
| final class + `instanceof` | Aman dan simpel | Tidak bisa diproxy subclass |
| record | Equality strict ke record class | Tidak cocok untuk entity proxy |

### 16.2 Practical Rule

Untuk value object:

```text
Gunakan final class/record. Equality berbasis exact value.
```

Untuk entity/proxy-managed object:

```text
Pahami framework lifecycle dan proxy model sebelum mendesain equals/hashCode.
```

Jangan generate otomatis dari IDE tanpa memahami runtime.

---

## 17. Immutability: Fondasi Equality Yang Stabil

Immutability berarti state object tidak berubah setelah construction.

Tetapi ada level-level immutability.

### 17.1 Shallow Immutability

```java
record OrderSnapshot(String id, List<String> itemIds) {}
```

Field `itemIds` final, tetapi list bisa mutable. Ini shallow immutable.

### 17.2 Deep Immutability

```java
record OrderSnapshot(String id, List<String> itemIds) {
    OrderSnapshot {
        itemIds = List.copyOf(itemIds);
    }
}
```

Jika element list juga immutable, ini mendekati deep immutable.

### 17.3 Effectively Immutable

Object tidak dipaksa immutable oleh type system, tetapi setelah construction tidak dimutasi secara konvensi.

```java
final class Config {
    private Map<String, String> values;

    // tidak ada setter, tetapi internal bisa saja berubah
}
```

Effectively immutable lebih rapuh daripada benar-benar immutable.

---

## 18. Cara Mendesain Immutable Class Manual

Checklist immutable class:

```text
1. Class final, atau constructor aman terhadap subclass.
2. Field private final.
3. Tidak ada setter/mutator.
4. Validasi semua invariant di constructor/factory.
5. Defensive copy untuk mutable input.
6. Defensive copy untuk mutable output.
7. Jangan leak `this` saat construction.
8. Jangan simpan reference mutable eksternal tanpa copy.
9. Pastikan equals/hashCode memakai immutable state.
```

Contoh:

```java
public final class DateRange {
    private final LocalDate start;
    private final LocalDate end;

    public DateRange(LocalDate start, LocalDate end) {
        this.start = Objects.requireNonNull(start, "start");
        this.end = Objects.requireNonNull(end, "end");
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
    }

    public LocalDate start() {
        return start;
    }

    public LocalDate end() {
        return end;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof DateRange that)) return false;
        return start.equals(that.start) && end.equals(that.end);
    }

    @Override
    public int hashCode() {
        return Objects.hash(start, end);
    }

    @Override
    public String toString() {
        return "DateRange[start=" + start + ", end=" + end + "]";
    }
}
```

Dengan record:

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

Record mengurangi boilerplate tetapi tidak menggantikan pemikiran invariant.

---

## 19. Defensive Copy: Menutup Kebocoran Representasi

### 19.1 Bug Dari Mutable Input

```java
public final class AccessPolicy {
    private final List<String> roles;

    public AccessPolicy(List<String> roles) {
        this.roles = roles;
    }
}
```

Caller bisa mengubah roles setelah object dibuat:

```java
var roles = new ArrayList<>(List.of("ADMIN"));
var policy = new AccessPolicy(roles);

roles.clear(); // policy berubah diam-diam
```

Solusi:

```java
public AccessPolicy(List<String> roles) {
    this.roles = List.copyOf(roles);
}
```

### 19.2 Bug Dari Mutable Output

```java
public List<String> roles() {
    return roles;
}
```

Jika `roles` mutable, caller bisa mutate internal state.

Solusi:

```java
public List<String> roles() {
    return roles; // aman jika roles sudah List.copyOf dan tidak mutable
}
```

Atau untuk array:

```java
public byte[] bytes() {
    return bytes.clone();
}
```

### 19.3 Defensive Copy dan Equality

Jika field mutable dipakai di `equals/hashCode`, defensive copy bukan hanya soal encapsulation. Ini soal contract stability.

---

## 20. HashCode Caching: Kapan Boleh?

Immutable object dengan hash mahal kadang cache hashCode.

Contoh:

```java
public final class LargeKey {
    private final List<String> parts;
    private int hash; // 0 means not computed

    public LargeKey(List<String> parts) {
        this.parts = List.copyOf(parts);
    }

    @Override
    public int hashCode() {
        int h = hash;
        if (h == 0) {
            h = parts.hashCode();
            hash = h;
        }
        return h;
    }
}
```

Tetapi ada caveat:

- jika hash sebenarnya 0, akan dihitung ulang terus
- thread-safety perlu dipahami
- hanya aman jika object immutable
- jangan lakukan premature optimization

Versi lebih eksplisit:

```java
private volatile Integer cachedHash;

@Override
public int hashCode() {
    Integer h = cachedHash;
    if (h == null) {
        h = parts.hashCode();
        cachedHash = h;
    }
    return h;
}
```

Tetapi boxing overhead muncul.

Rule:

```text
Cache hashCode hanya untuk immutable object dengan hash computation mahal dan terbukti hot path.
```

---

## 21. IdentityHashMap dan Identity-Based Operations

Normal `HashMap` memakai `equals`.

```java
Map<CustomerId, Customer> map = new HashMap<>();
```

`IdentityHashMap` memakai `==` untuk key comparison.

```java
Map<Object, String> map = new IdentityHashMap<>();
```

Use case:

- object graph traversal
- cycle detection berdasarkan instance
- serialization framework internals
- proxy tracking
- canonicalization internals
- debugging identity problem

Contoh cycle detection:

```java
void traverse(Object root) {
    var visited = Collections.newSetFromMap(new IdentityHashMap<Object, Boolean>());
    traverse(root, visited);
}

void traverse(Object node, Set<Object> visited) {
    if (node == null || !visited.add(node)) {
        return;
    }
    // traverse fields...
}
```

Kenapa bukan `HashSet` biasa?

Karena object berbeda yang `equals` true tetap harus dikunjungi sebagai instance berbeda.

### 21.1 Jangan Gunakan IdentityHashMap Untuk Business Logic Umum

Jika business key equality penting, gunakan `HashMap` biasa dengan object contract benar.

`IdentityHashMap` adalah tool khusus untuk identity semantics.

---

## 22. Canonicalization dan Interning

Kadang kita ingin satu instance canonical untuk value tertentu.

Contoh built-in yang familiar:

```java
String a = "hello";
String b = "hello";
System.out.println(a == b); // true karena string literal interned
```

Tetapi jangan membangun logic berdasarkan asumsi interning kecuali memang eksplisit.

### 22.1 Manual Canonicalization

```java
final class CountryCode {
    private static final ConcurrentMap<String, CountryCode> CACHE = new ConcurrentHashMap<>();

    private final String value;

    private CountryCode(String value) {
        this.value = value;
    }

    public static CountryCode of(String value) {
        String normalized = value.trim().toUpperCase(Locale.ROOT);
        return CACHE.computeIfAbsent(normalized, CountryCode::new);
    }
}
```

Dengan canonicalization:

```java
CountryCode.of("sg") == CountryCode.of("SG") // true
```

Tetapi tetap implementasikan `equals/hashCode` dengan benar. Jangan mengandalkan `==` untuk domain equality.

### 22.2 Risiko Canonicalization

- memory leak jika cache tak terbatas
- classloader leak
- weak reference complexity
- contention
- lifecycle management
- serialization consistency

Rule:

```text
Canonicalization adalah optimization/semantic tool khusus, bukan pengganti equals/hashCode.
```

---

## 23. Arrays, Collections, dan Equality Semantics

### 23.1 Array

Array tidak override `equals` untuk content equality.

```java
int[] a = {1, 2};
int[] b = {1, 2};

System.out.println(a.equals(b)); // false
System.out.println(Arrays.equals(a, b)); // true
```

Untuk nested array:

```java
Object[] x = { new int[] {1, 2} };
Object[] y = { new int[] {1, 2} };

System.out.println(Arrays.equals(x, y));     // false
System.out.println(Arrays.deepEquals(x, y)); // true
```

### 23.2 List

List equality biasanya element-wise dan order-sensitive.

```java
List.of(1, 2).equals(List.of(1, 2)); // true
List.of(1, 2).equals(List.of(2, 1)); // false
```

### 23.3 Set

Set equality order-insensitive.

```java
Set.of(1, 2).equals(Set.of(2, 1)); // true
```

### 23.4 Map

Map equality berdasarkan mapping key-value.

```java
Map.of("a", 1).equals(Map.of("a", 1)); // true
```

### 23.5 Domain Implication

Jika field collection dipakai di equality, pahami semantics collection tersebut.

Contoh:

```java
record PermissionSet(Set<String> permissions) {
    PermissionSet {
        permissions = Set.copyOf(permissions);
    }
}
```

Order tidak relevan.

Jika order relevan:

```java
record ApprovalChain(List<String> approverIds) {
    ApprovalChain {
        approverIds = List.copyOf(approverIds);
    }
}
```

---

## 24. Floating Point Equality

`double` dan `float` punya edge case:

- NaN
- positive zero
- negative zero
- precision error

Contoh:

```java
double x = 0.1 + 0.2;
double y = 0.3;

System.out.println(x == y); // false
```

Untuk domain seperti money, jangan gunakan floating point.

Untuk measurement domain, equality mungkin perlu tolerance:

```java
static boolean closeTo(double a, double b, double epsilon) {
    return Math.abs(a - b) <= epsilon;
}
```

Tetapi tolerance-based equality berbahaya untuk `equals`, karena bisa merusak transitivity.

Contoh:

```text
0.0 close to 0.1
0.1 close to 0.2
0.0 not close to 0.2
```

Transitivity rusak.

Rule:

```text
Jangan implementasikan equals dengan epsilon tolerance kecuali Anda benar-benar memahami konsekuensinya.
```

Lebih baik sediakan method domain eksplisit:

```java
boolean approximatelyEquals(Measurement other, double tolerance) { ... }
```

Bukan override `equals`.

---

## 25. BigDecimal Equality

Seperti disebut sebelumnya:

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00"));    // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")); // 0
```

Karena `equals` mempertimbangkan value dan scale.

Jika domain money membutuhkan scale tetap:

```java
record Money(String currency, BigDecimal amount) {
    Money {
        Objects.requireNonNull(currency);
        Objects.requireNonNull(amount);
        amount = amount.setScale(2, RoundingMode.UNNECESSARY);
    }
}
```

Jika domain membutuhkan numeric equality tanpa scale:

```java
record DecimalValue(BigDecimal value) {
    DecimalValue {
        Objects.requireNonNull(value);
        value = value.stripTrailingZeros();
    }
}
```

Tetapi hati-hati dengan representasi scientific notation dan domain display.

---

## 26. Equality dan Time

Date/time equality juga butuh pemahaman domain.

Contoh:

```java
Instant a = Instant.parse("2026-01-01T00:00:00Z");
OffsetDateTime b = OffsetDateTime.parse("2026-01-01T08:00:00+08:00");
```

Mereka bisa mewakili instant yang sama tetapi type berbeda.

`equals` pada date/time class biasanya mempertimbangkan type dan representasi sesuai contract masing-masing.

Domain decision:

- Apakah equality berdasarkan instant global?
- Apakah berdasarkan local date/time?
- Apakah timezone/offset bagian dari identity?
- Apakah precision sampai millis, micros, nanos?

Contoh wrapper:

```java
record BusinessTimestamp(Instant value) {
    BusinessTimestamp {
        Objects.requireNonNull(value);
        value = value.truncatedTo(ChronoUnit.MILLIS);
    }
}
```

Jangan biarkan precision mismatch diam-diam menghancurkan equality.

---

## 27. Equality Dalam Distributed Systems

Dalam sistem distributed, object identity Java tidak melewati process boundary.

```text
JVM A object identity != JVM B object identity
```

Setelah serialization/deserialization:

```java
var before = new CustomerId("C-1");
var after = deserialize(serialize(before));

before == after      // false
before.equals(after) // harusnya true untuk value object
```

### 27.1 Distributed Identity Harus Explicit

Untuk event/message/API:

- gunakan explicit ID
- gunakan idempotency key
- gunakan correlation id
- gunakan version/revision jika perlu

Jangan bergantung pada object identity.

### 27.2 Equality Untuk Commands dan Events

Command/event sering lebih cocok sebagai value-ish object:

```java
record SubmitApplicationCommand(
    String commandId,
    String applicantId,
    Instant submittedAt,
    Map<String, Object> payload
) {}
```

Tetapi equality semua field mungkin tidak selalu domain-correct.

Untuk idempotency, mungkin equality berdasarkan `commandId` saja. Tetapi record default equality semua components.

Jika semantic equality tidak sama dengan component equality, jangan asal pakai record default tanpa berpikir.

Bisa buat type eksplisit:

```java
record CommandId(String value) {}

final class SubmitApplicationCommand {
    private final CommandId commandId;
    private final String applicantId;
    private final Instant submittedAt;

    // equals based on commandId? tergantung domain
}
```

Atau tetap record tapi jangan gunakan `equals` untuk idempotency; gunakan explicit key extractor.

```java
CommandId idempotencyKey() {
    return commandId;
}
```

---

## 28. Equality Dalam Cache

Cache key harus immutable dan punya equality stabil.

Buruk:

```java
class SearchCriteria {
    List<String> statuses;
    LocalDate from;
    LocalDate to;
}
```

Jika `statuses` mutable dan dipakai sebagai key, cache behavior bisa rusak.

Baik:

```java
record SearchCriteria(
    List<String> statuses,
    LocalDate from,
    LocalDate to
) {
    SearchCriteria {
        statuses = List.copyOf(statuses);
        Objects.requireNonNull(from);
        Objects.requireNonNull(to);
    }
}
```

### 28.1 Normalisasi Cache Key

Jika order status tidak relevan:

```java
record SearchCriteria(
    Set<String> statuses,
    LocalDate from,
    LocalDate to
) {
    SearchCriteria {
        statuses = Set.copyOf(statuses);
    }
}
```

Jika case-insensitive:

```java
statuses = statuses.stream()
    .map(s -> s.toUpperCase(Locale.ROOT))
    .collect(Collectors.toUnmodifiableSet());
```

Equality yang baik sering dimulai dari normalisasi invariant.

---

## 29. Equality Dalam Audit Diff

Audit diff sering membandingkan old object dan new object.

Pertanyaan:

```text
Apakah object equality cukup untuk audit diff?
```

Biasanya tidak.

Karena `equals` menjawab:

> Apakah dua object dianggap sama secara logical?

Audit diff menjawab:

> Field apa yang berubah?

Contoh entity equality berdasarkan id:

```java
oldCustomer.equals(newCustomer) == true
```

Tetapi name/email/status bisa berubah.

Audit diff tidak boleh hanya mengandalkan `equals` entity.

Gunakan:

- explicit field comparison
- snapshot value object
- generated diff model
- reflection-based diff dengan whitelist
- domain event capturing changes

### 29.1 Snapshot Untuk Audit

```java
record CustomerSnapshot(
    CustomerId id,
    String name,
    EmailAddress email,
    CustomerStatus status
) {}
```

Snapshot equality semua field bisa berguna untuk test/diff coarse-grained.

Tetapi audit detail tetap butuh field-level diff.

---

## 30. Equality Dalam Validation

Validation sering membutuhkan konsep equality yang bukan `equals`.

Contoh:

- duplicate email case-insensitive
- overlapping date range
- equivalent address after normalization
- same postal code after stripping spaces

Jangan paksakan semua ke `equals`.

Gunakan method domain eksplisit:

```java
boolean sameRecipientAs(NotificationTarget other) { ... }
boolean overlaps(DateRange other) { ... }
boolean sameNormalizedAddress(Address other) { ... }
```

Rule:

```text
`equals` harus satu semantic utama yang stabil dan general.
Semantic comparison lain beri nama eksplisit.
```

---

## 31. Generated Code dan Equality

Banyak tool bisa generate `equals/hashCode/toString`:

- IDE
- Lombok
- Immutables
- AutoValue
- record compiler support
- annotation processor custom
- OpenAPI generator
- protobuf generator

Generated code bukan otomatis benar secara domain.

### 31.1 Pertanyaan Sebelum Generate

```text
1. Field mana yang menentukan identity/equality?
2. Apakah field mutable?
3. Apakah ada array?
4. Apakah ada BigDecimal?
5. Apakah ada floating point?
6. Apakah ada collection dengan order yang relevan/tidak relevan?
7. Apakah ada field sensitif untuk toString?
8. Apakah class bisa diproxy?
9. Apakah class bisa disubclass?
10. Apakah equality perlu compatible antar versi?
```

### 31.2 Lombok-Like Risk

Misalnya `@Data` pada entity bisa generate equals/hashCode dari semua fields.

Risiko:

- association ikut dibandingkan
- lazy load terpanggil
- stack overflow pada relationship bidirectional
- performance berat
- hash berubah saat field mutable berubah
- data sensitif masuk `toString`

Rule:

```text
Generated equals/hashCode/toString harus direview seperti handwritten business logic.
```

---

## 32. Reflection dan Equality

Reflection-based equality bisa dibuat:

```java
boolean reflectiveEquals(Object a, Object b) { ... }
```

Tetapi risk besar:

- field order tidak boleh diasumsikan untuk semantic
- synthetic field ikut terbaca
- transient/static field harus dikecualikan
- inaccessible field under JPMS
- performance overhead
- cyclic graph
- proxy field
- security/access concern
- private representation bocor

Reflection-based equality cocok untuk:

- testing utility tertentu
- debug/diff tool dengan aturan eksplisit
- generated code fallback

Tidak cocok sebagai default domain equality.

---

## 33. Module Boundary dan Object Contract

Dengan JPMS, package/module boundary bisa membatasi reflective access. Ini berdampak pada framework yang mencoba membaca private field untuk equality/diff/serialization.

Jika module tidak `opens` package ke framework tertentu, deep reflection bisa gagal.

Karena itu desain object contract sebaiknya tidak bergantung pada reflective private access dari luar module.

Public behavior seperti `equals/hashCode/toString` tetap callable jika class accessible, tetapi reflective field introspection punya boundary berbeda.

Prinsip:

```text
Object contract sebaiknya explicit di class, bukan bergantung pada framework menebak private state.
```

---

## 34. Binary Compatibility dan Evolusi Equality

Mengubah equality adalah breaking change secara behavioral, walaupun binary compatible.

Contoh versi 1:

```java
record CustomerKey(String country, String number) {}
```

Versi 2:

```java
record CustomerKey(String country, String number, String branch) {}
```

Record equality berubah karena component bertambah.

Dampak:

- cache key berubah
- serialized snapshot comparison berubah
- test snapshot berubah
- map/set behavior berubah
- dedup logic berubah
- API client expectation berubah

### 34.1 Public API Rule

Untuk public type:

```text
Equality semantics adalah bagian dari contract publik.
```

Dokumentasikan:

- field apa yang menentukan equality
- apakah class immutable
- apakah aman sebagai map key
- apakah toString stable atau diagnostic only

### 34.2 Evolusi Aman

Jika equality perlu stabil lintas versi, jangan bergantung pada “semua field”.

Contoh:

```java
public final class CustomerKey {
    private final String country;
    private final String number;
    private final String branch; // field baru, tidak masuk equality v1-compatible

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof CustomerKey that)) return false;
        return Objects.equals(country, that.country)
            && Objects.equals(number, that.number);
    }

    @Override
    public int hashCode() {
        return Objects.hash(country, number);
    }
}
```

Tetapi ini harus sengaja, bukan kebetulan.

---

## 35. Designing `equals`: Template Yang Aman Untuk Final Value Class

Untuk final value class:

```java
public final class CustomerId {
    private final String value;

    public CustomerId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("customer id is required");
        }
        this.value = value.trim();
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof CustomerId that)) return false;
        return value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }

    @Override
    public String toString() {
        return "CustomerId[value=" + value + "]";
    }
}
```

Kenapa aman?

- class final
- field final
- invariant dijaga constructor
- equality berdasarkan immutable normalized value
- hashCode konsisten
- toString jelas

Dengan record:

```java
public record CustomerId(String value) {
    public CustomerId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("customer id is required");
        }
        value = value.trim();
    }
}
```

Record lebih ringkas, tetapi perhatikan apakah default `toString` boleh mengekspos value.

Jika sensitif:

```java
public record NationalId(String value) {
    public NationalId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("national id is required");
        }
    }

    @Override
    public String toString() {
        return "NationalId[value=<redacted>]";
    }
}
```

---

## 36. Designing `equals`: Template Untuk Non-Final Class

Untuk non-final class, equality lebih sulit.

Salah satu pendekatan strict:

```java
@Override
public boolean equals(Object other) {
    if (this == other) return true;
    if (other == null || getClass() != other.getClass()) return false;
    Base that = (Base) other;
    return Objects.equals(field, that.field);
}
```

Ini mencegah subclass symmetry problem, tetapi membuat subclass tidak equal dengan base.

Rule:

```text
Jika equality penting dan berbasis state, pertimbangkan membuat class final.
```

Jika class harus extensible, pertimbangkan tidak override equals, atau dokumentasikan equality hanya identity-based.

---

## 37. Designing `hashCode`: Template Manual

```java
@Override
public int hashCode() {
    int result = id.hashCode();
    result = 31 * result + status.hashCode();
    result = 31 * result + createdDate.hashCode();
    return result;
}
```

Untuk nullable field:

```java
result = 31 * result + Objects.hashCode(optionalField);
```

Untuk primitive:

```java
result = 31 * result + Integer.hashCode(count);
result = 31 * result + Long.hashCode(amount);
result = 31 * result + Boolean.hashCode(active);
```

Untuk array:

```java
result = 31 * result + Arrays.hashCode(bytes);
```

Untuk nested array:

```java
result = 31 * result + Arrays.deepHashCode(values);
```

---

## 38. `canEqual` Pattern: Kapan Muncul, Kenapa Jarang Ideal

Beberapa bahasa/library memakai `canEqual` untuk mengatasi equality inheritance.

Konsep:

```java
class Point {
    public boolean canEqual(Object other) {
        return other instanceof Point;
    }

    @Override
    public boolean equals(Object other) {
        if (!(other instanceof Point that)) return false;
        return that.canEqual(this) && x == that.x && y == that.y;
    }
}
```

Subclass override `canEqual`.

Ini bisa membantu symmetry, tetapi complexity meningkat.

Dalam Java modern, sering lebih baik:

- final value class
- record
- sealed hierarchy
- composition
- explicit comparator/matcher

Daripada hierarchy equality kompleks.

---

## 39. Comparator Bukan Equality

`Comparator` bisa mendefinisikan ordering yang tidak konsisten dengan equals.

Contoh case-insensitive order:

```java
var set = new TreeSet<String>(String.CASE_INSENSITIVE_ORDER);
set.add("abc");
set.add("ABC");

System.out.println(set.size()); // 1
```

Tetapi:

```java
"abc".equals("ABC") // false
```

Untuk sorted collections, comparator menentukan uniqueness.

Rule:

```text
Jika comparator tidak konsisten dengan equals, dokumentasikan dan pahami efek collection.
```

Untuk domain, lebih baik buat normalized value object:

```java
record CaseInsensitiveName(String value) {
    CaseInsensitiveName {
        value = value.toLowerCase(Locale.ROOT);
    }
}
```

---

## 40. Equality Testing Strategy

Jangan hanya test happy path.

### 40.1 Test Contract Minimal

```java
@Test
void equalityContract() {
    var a = new CustomerId("C-1");
    var b = new CustomerId("C-1");
    var c = new CustomerId("C-1");
    var d = new CustomerId("C-2");

    assertEquals(a, a); // reflexive
    assertEquals(a, b);
    assertEquals(b, a); // symmetric
    assertEquals(b, c);
    assertEquals(a, c); // transitive
    assertNotEquals(a, d);
    assertNotEquals(a, null);
    assertEquals(a.hashCode(), b.hashCode());
}
```

### 40.2 Test Hash Collection Behavior

```java
@Test
void worksAsHashMapKey() {
    var map = new HashMap<CustomerId, String>();
    map.put(new CustomerId("C-1"), "Alice");

    assertEquals("Alice", map.get(new CustomerId("C-1")));
}
```

### 40.3 Test Mutability Hazard

Jika class seharusnya immutable, test defensive copy:

```java
@Test
void makesDefensiveCopy() {
    var roles = new ArrayList<>(List.of("ADMIN"));
    var policy = new AccessPolicy(roles);

    roles.clear();

    assertEquals(List.of("ADMIN"), policy.roles());
}
```

---

## 41. Production Checklist: Sebelum Menulis `equals/hashCode/toString`

Gunakan checklist ini:

```text
1. Class ini entity, value object, DTO, service, atau runtime component?
2. Equality harus identity-based atau value-based?
3. Field equality immutable atau bisa berubah?
4. Object akan dipakai sebagai Map key/Set element/cache key?
5. Ada field array?
6. Ada field collection mutable?
7. Ada BigDecimal/floating point/date-time?
8. Ada field sensitif yang tidak boleh masuk toString?
9. Ada association/bidirectional graph?
10. Ada kemungkinan proxy/subclass/framework enhancement?
11. Class public API atau internal?
12. Equality semantics perlu stabil lintas versi?
13. Generated code aman atau perlu override manual?
14. Module boundary/reflection akan mempengaruhi framework?
15. Test contract sudah ada?
```

---

## 42. Decision Matrix

| Jenis Class | Equality Rekomendasi | HashCode | ToString | Catatan |
|---|---|---|---|---|
| Value object immutable | Semua field value signifikan | Sama dengan equals fields | Aman tapi hindari sensitive data | `record` cocok |
| ID wrapper | Normalized id value | Id value | Biasanya aman, kecuali sensitive id | Sangat cocok sebagai key |
| DTO response | Biasanya semua component | Semua component | Hati-hati sensitive field | Record cocok, defensive copy collection |
| Command/event | Tergantung semantic | Sama dengan equality | Hati-hati payload besar/sensitif | Idempotency key sebaiknya eksplisit |
| Entity ORM | Jangan semua field | Hati-hati ID lifecycle | Jangan cetak graph | Framework-specific concern |
| Service/component | Biasanya identity/default | Default | Ringkas | Jangan override tanpa alasan |
| Proxy/decorator | Delegasi atau identity? | Konsisten dengan equals | Jelaskan wrapper | Hati-hati symmetry |
| Cache key | Immutable normalized fields | Sama dengan fields | Diagnostic | Jangan mutable |
| Generated class | Review config | Review config | Review sensitive data | Jangan blindly accept |

---

## 43. Anti-Pattern Catalog

### 43.1 Override `equals` Tanpa `hashCode`

```text
Bug: HashSet/HashMap behavior rusak.
```

### 43.2 Mutable Field Dalam `hashCode`

```text
Bug: object hilang dari HashMap setelah dimutasi.
```

### 43.3 Entity `equals/hashCode` Dari Semua Field

```text
Bug: stack overflow, lazy load, performance, unstable equality.
```

### 43.4 `toString` Mencetak Data Sensitif

```text
Bug: PII/secrets leak ke log.
```

### 43.5 Record Dengan Mutable Collection Tanpa Copy

```text
Bug: record terlihat immutable padahal tidak.
```

### 43.6 Record Dengan Array Component

```text
Bug: equality reference-based untuk array.
```

### 43.7 Floating Point Tolerance Dalam `equals`

```text
Bug: transitivity bisa rusak.
```

### 43.8 Equality Berdasarkan Generated Database ID Yang Awalnya Null

```text
Bug: transient entities bisa dianggap sama atau hash berubah setelah persist.
```

### 43.9 `toString` Untuk Serialization

```text
Bug: format tidak stabil, parsing rapuh.
```

### 43.10 `getClass` Equality Pada Proxy-Managed Entity Tanpa Pertimbangan

```text
Bug: proxy dan real entity tidak equal.
```

---

## 44. Worked Example: Mendesain `Money`

### 44.1 Versi Buruk

```java
class Money {
    BigDecimal amount;
    String currency;
}
```

Masalah:

- mutable
- no invariant
- no equality
- currency tidak normalized
- amount scale ambiguity

### 44.2 Versi Lebih Baik

```java
public record Money(String currency, BigDecimal amount) {
    public Money {
        if (currency == null || currency.isBlank()) {
            throw new IllegalArgumentException("currency is required");
        }
        Objects.requireNonNull(amount, "amount");

        currency = currency.trim().toUpperCase(Locale.ROOT);
        amount = amount.setScale(2, RoundingMode.UNNECESSARY);
    }

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(currency, amount.add(other.amount));
    }

    public Money minus(Money other) {
        requireSameCurrency(other);
        return new Money(currency, amount.subtract(other.amount));
    }

    private void requireSameCurrency(Money other) {
        Objects.requireNonNull(other, "other");
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("currency mismatch: " + currency + " vs " + other.currency);
        }
    }
}
```

Keputusan:

- record untuk value object
- currency normalized
- scale fixed
- equality otomatis sesuai normalized fields
- operation menjaga invariant

### 44.3 Apakah `toString` Aman?

Default:

```text
Money[currency=SGD, amount=10.00]
```

Biasanya aman. Tetapi untuk field sensitif, override.

---

## 45. Worked Example: Cache Key Untuk Search

### 45.1 Problem

Search parameter:

- agency id
- statuses
- date range
- keyword

Status order tidak relevan. Keyword case-insensitive dan trim.

### 45.2 Desain Key

```java
public record CaseSearchCacheKey(
    String agencyId,
    Set<String> statuses,
    LocalDate fromDate,
    LocalDate toDate,
    String keyword
) {
    public CaseSearchCacheKey {
        if (agencyId == null || agencyId.isBlank()) {
            throw new IllegalArgumentException("agencyId is required");
        }
        Objects.requireNonNull(statuses, "statuses");
        Objects.requireNonNull(fromDate, "fromDate");
        Objects.requireNonNull(toDate, "toDate");

        agencyId = agencyId.trim();
        statuses = statuses.stream()
            .filter(Objects::nonNull)
            .map(s -> s.trim().toUpperCase(Locale.ROOT))
            .filter(s -> !s.isBlank())
            .collect(Collectors.toUnmodifiableSet());

        keyword = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);

        if (toDate.isBefore(fromDate)) {
            throw new IllegalArgumentException("toDate must not be before fromDate");
        }
    }
}
```

Hasil:

```java
new CaseSearchCacheKey(" A ", Set.of("open", "closed"), from, to, " ABC ")
    .equals(new CaseSearchCacheKey("A", Set.of("CLOSED", "OPEN"), from, to, "abc"));
// true
```

Karena semantic cache key memang demikian.

---

## 46. Worked Example: Entity Equality Dengan Business Key

Misal `RegulatoryCase` punya immutable case number setelah dibuat.

```java
public final class CaseNumber {
    private final String value;

    public CaseNumber(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("case number is required");
        }
        this.value = value.trim().toUpperCase(Locale.ROOT);
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof CaseNumber that)) return false;
        return value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }

    @Override
    public String toString() {
        return value;
    }
}
```

Entity:

```java
public class RegulatoryCase {
    private final CaseNumber caseNumber;
    private CaseStatus status;
    private String assignedOfficerId;

    public RegulatoryCase(CaseNumber caseNumber) {
        this.caseNumber = Objects.requireNonNull(caseNumber);
        this.status = CaseStatus.DRAFT;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof RegulatoryCase that)) return false;
        return caseNumber.equals(that.caseNumber);
    }

    @Override
    public int hashCode() {
        return caseNumber.hashCode();
    }

    @Override
    public String toString() {
        return "RegulatoryCase[caseNumber=" + caseNumber + ", status=" + status + "]";
    }
}
```

Ini masuk akal jika:

```text
caseNumber immutable, unique, dan tersedia sejak construction.
```

Jika case number baru muncul setelah persistence/approval, desain ini tidak aman.

---

## 47. Mental Model Akhir

Ingat struktur ini:

```text
Object contract
   |
   +-- Identity equality
   |      |
   |      +-- ==
   |      +-- default Object.equals
   |      +-- IdentityHashMap
   |      +-- runtime lifecycle objects
   |
   +-- Logical/value equality
   |      |
   |      +-- equals
   |      +-- hashCode
   |      +-- value objects
   |      +-- records
   |      +-- immutable cache keys
   |
   +-- Diagnostic representation
          |
          +-- toString
          +-- logging safety
          +-- debugging clarity
```

Top engineer tidak bertanya:

> Bagaimana cara generate equals/hashCode?

Melainkan:

> Semantic equality apa yang benar untuk object ini sepanjang lifecycle-nya, di dalam collection, cache, proxy/framework, serialization boundary, module boundary, dan versi API berikutnya?

---

## 48. Ringkasan Prinsip

1. `==` membandingkan reference identity.
2. Default `Object.equals` identity-based.
3. Logical equality harus didesain sesuai domain.
4. Jika override `equals`, override `hashCode`.
5. Jika dua object equal, hashCode wajib sama.
6. Hash collision boleh terjadi, tapi hash buruk merusak performance.
7. Mutable equality fields merusak hash collection.
8. Value object sebaiknya immutable.
9. Record bagus untuk value carrier, tetapi bukan deep immutable otomatis.
10. Array component dalam record adalah trap equality.
11. Entity equality tidak boleh asal semua field.
12. Proxy/framework bisa mengubah asumsi runtime class.
13. `toString` adalah diagnostic contract, bukan serialization format.
14. Jangan leak sensitive data lewat `toString`.
15. Equality semantics adalah bagian dari public API contract.
16. Generated equality harus direview secara domain.
17. Reflection-based equality jarang cocok untuk domain core.
18. Semantic comparison lain sebaiknya diberi method eksplisit, bukan dipaksa ke `equals`.

---

## 49. Latihan

### Latihan 1

Desain `EmailAddress` sebagai immutable value object.

Requirement:

- trim
- lowercase domain part
- reject blank
- `equals/hashCode` berdasarkan normalized value
- `toString` tidak perlu redact

Pertanyaan:

- Apakah local part email aman di-lowercase?
- Apakah domain Anda case-insensitive?
- Apakah normalization harus sepenuhnya RFC-compliant atau cukup business-level?

### Latihan 2

Desain `UserAccountEntity` dengan field:

- database id nullable sebelum persist
- username unique dan immutable
- displayName mutable
- lastLoginAt mutable

Tentukan equality berdasarkan apa.

Bandingkan trade-off:

- object identity
- database id
- username
- semua field

### Latihan 3

Buat `SearchCriteria` cache key untuk:

- keyword case-insensitive
- tags order-insensitive
- page number included
- page size included
- date range included

Pastikan immutable dan aman sebagai `HashMap` key.

### Latihan 4

Ambil satu entity di project nyata. Cek:

- apakah `equals/hashCode` generated?
- apakah field mutable masuk hash?
- apakah ada association?
- apakah `toString` mencetak sensitive data?
- apakah proxy framework digunakan?

Tulis risiko konkret.

---

## 50. Referensi Resmi dan Lanjutan

Referensi utama:

- Java SE 25 API — `java.lang.Object`
- Java SE 25 API — `java.lang.Record`
- Java SE 25 API — `java.util.Objects`
- Java SE API — `java.util.IdentityHashMap`
- Java Language Specification — Types, Classes, Records, Expressions
- Java Collections Framework documentation
- Effective Java, Joshua Bloch — Item tentang `equals`, `hashCode`, `toString`, immutability, defensive copy

---

## 51. Status Seri

Part 003 selesai.

Seri belum selesai.

Part berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-004.md
```

Topik berikutnya:

```text
Encapsulation Beyond private: Invariants, State Ownership, and API Surface
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-002.md">⬅️ Part 002 — Class Anatomy: Fields, Methods, Constructors, Initializers, Class Loading Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-004.md">Encapsulation Beyond `private`: Invariants, State Ownership, and API Surface ➡️</a>
</div>
