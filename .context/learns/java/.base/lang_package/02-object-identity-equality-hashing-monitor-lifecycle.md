# Part 2 — `Object`: Identity, Equality, Hashing, Monitor, Lifecycle

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `02-object-identity-equality-hashing-monitor-lifecycle.md`  
> Scope: Java 8–25  
> Focus: `java.lang.Object` sebagai akar kontrak object model Java.

---

## 1. Tujuan Part Ini

`java.lang.Object` terlihat sederhana karena semua developer Java sudah pernah melihat `equals`, `hashCode`, dan `toString`. Namun dalam sistem besar, kontrak `Object` adalah salah satu sumber bug paling mahal: cache miss, duplicate entity, data hilang dari `HashSet`, audit log bocor data sensitif, deadlock karena monitor salah, class-loader leak, dan resource leak karena finalization.

Target bagian ini adalah membangun mental model yang kuat tentang:

1. **identity**: apakah dua reference menunjuk instance yang sama;
2. **logical equality**: apakah dua object dianggap merepresentasikan nilai/domain yang sama;
3. **hashing**: bagaimana equality terhubung ke `HashMap`, `HashSet`, cache, deduplication, dan lookup;
4. **runtime type**: bagaimana `getClass()` mempengaruhi reflection, framework, proxy, dan equality;
5. **diagnostic representation**: bagaimana `toString()` harus membantu debugging tanpa membocorkan data;
6. **monitor primitives**: mengapa `wait/notify/notifyAll` ada di `Object`, tetapi jarang menjadi abstraction terbaik untuk aplikasi modern;
7. **legacy lifecycle hooks**: mengapa `clone()` dan `finalize()` harus dipahami lebih sebagai historical API daripada default design tool.

Part ini tidak mengulang OOP dasar. Kita akan membahas `Object` sebagai **platform contract**.

---

## 2. Mental Model Utama

### 2.1 `Object` adalah akar semua reference type

Setiap class Java secara langsung atau tidak langsung mewarisi dari `Object`.

```java
class Customer {
}
```

Secara konseptual:

```java
class Customer extends Object {
}
```

Namun primitive seperti `int`, `long`, `boolean`, `double`, dan `char` bukan subclass dari `Object`. Mereka bisa di-box menjadi wrapper object seperti `Integer`, `Long`, `Boolean`, `Double`, atau `Character`, tetapi primitive value-nya sendiri tidak memiliki object identity.

Model sederhana:

```text
Reference variable ──points to──> object instance
Primitive variable ──contains───> primitive value
```

Konsekuensi:

```java
int a = 10;
Object o = a; // boxing menjadi Integer
```

Di sini `o` bukan menunjuk `int`; `o` menunjuk `Integer` hasil boxing.

---

### 2.2 Ada dua jenis equality: identity dan logical equality

Di Java, reference dapat dibandingkan dengan dua cara:

```text
==       : identity equality
.equals : logical equality, jika class mendefinisikannya
```

Contoh:

```java
Customer c1 = new Customer("C001");
Customer c2 = new Customer("C001");

System.out.println(c1 == c2);      // false, beda instance
System.out.println(c1.equals(c2)); // tergantung implementasi equals
```

`==` menjawab:

```text
Apakah dua reference menunjuk object yang sama persis?
```

`equals` seharusnya menjawab:

```text
Apakah dua object dianggap setara menurut kontrak class/domain ini?
```

Jika `equals` tidak dioverride, default `Object.equals` juga identity-based. Jadi untuk class biasa, dua instance berbeda akan dianggap tidak equal walaupun field-nya sama.

---

### 2.3 `hashCode` adalah indexing contract, bukan unique identifier

`hashCode()` menghasilkan `int` yang digunakan oleh struktur data berbasis hash. Ia bukan ID unik, bukan memory address yang aman dipakai, dan bukan fingerprint kriptografis.

Kontrak utamanya:

```text
Jika a.equals(b) true, maka a.hashCode() harus sama dengan b.hashCode().
```

Namun:

```text
Jika a.hashCode() == b.hashCode(), belum tentu a.equals(b) true.
```

Hash collision valid dan harus ditangani oleh collection.

---

### 2.4 Setiap object punya intrinsic monitor

Semua object Java dapat dipakai sebagai monitor:

```java
synchronized (lock) {
    // critical section
}
```

Karena monitor melekat pada object, method `wait`, `notify`, dan `notifyAll` berada di `Object`, bukan di `Thread`.

Namun ini adalah primitive low-level. Untuk kebanyakan aplikasi modern, gunakan abstraction yang lebih eksplisit seperti `Lock`, `Condition`, `BlockingQueue`, `CountDownLatch`, `CompletableFuture`, actor/event loop, atau message queue.

---

### 2.5 `Object` adalah kontrak lintas framework

Framework banyak bergantung pada method `Object`:

- logging memanggil `toString()`;
- collection memakai `equals` dan `hashCode`;
- ORM/proxy berinteraksi dengan `getClass()` dan equality;
- caching memakai object sebagai key;
- serializer dan mapper membaca runtime class;
- test assertions memakai equality;
- distributed deduplication sering bergantung pada key equality.

Kesalahan di `Object` contract jarang berhenti di satu class. Ia merambat ke cache, DB, log, audit, retry, idempotency, dan security.

---

## 3. API Surface `Object`

Method inti `Object`:

```java
public final native Class<?> getClass();
public native int hashCode();
public boolean equals(Object obj);
protected native Object clone() throws CloneNotSupportedException;
public String toString();
public final native void notify();
public final native void notifyAll();
public final void wait() throws InterruptedException;
public final native void wait(long timeoutMillis) throws InterruptedException;
public final void wait(long timeoutMillis, int nanos) throws InterruptedException;
@Deprecated(since = "9", forRemoval = true)
protected void finalize() throws Throwable;
```

Catatan penting:

- `getClass`, `wait`, `notify`, dan `notifyAll` bersifat `final`, sehingga tidak bisa dioverride;
- `equals`, `hashCode`, dan `toString` adalah method yang paling sering dioverride;
- `clone` adalah legacy hook yang hampir selalu lebih baik dihindari;
- `finalize` deprecated sejak Java 9 dan telah dideprecate for removal; jangan membangun desain baru di atasnya.

---

## 4. `getClass()`: Runtime Type dan Type Identity

### 4.1 Static type vs runtime type

```java
Object value = "hello";

System.out.println(value.getClass()); // class java.lang.String
```

Variable `value` bertipe static `Object`, tetapi object runtime-nya adalah `String`.

```text
Static type  : type yang diketahui compiler
Runtime type : class nyata dari object saat program berjalan
```

Contoh lain:

```java
Number n = Integer.valueOf(10);

System.out.println(n.getClass());        // class java.lang.Integer
System.out.println(Number.class);        // class java.lang.Number
System.out.println(n instanceof Number); // true
System.out.println(n instanceof Integer);// true
```

`getClass()` menjawab class persis. `instanceof` menjawab compatibility.

---

### 4.2 `getClass()` dalam equality

Ada dua pola umum.

#### Pola exact class

```java
@Override
public boolean equals(Object other) {
    if (this == other) return true;
    if (other == null || getClass() != other.getClass()) return false;
    Customer that = (Customer) other;
    return id.equals(that.id);
}
```

Maknanya:

```text
Equal hanya jika runtime class sama persis.
```

Cocok untuk:

- value object final;
- class yang tidak didesain untuk inheritance;
- object yang equality-nya tidak boleh diwariskan sembarangan;
- record-like model.

Risiko:

- ORM/proxy subclass bisa gagal dianggap equal;
- kurang cocok untuk hierarchy polymorphic.

#### Pola `instanceof`

```java
@Override
public boolean equals(Object other) {
    if (this == other) return true;
    if (!(other instanceof Customer that)) return false;
    return id.equals(that.id);
}
```

Maknanya:

```text
Equal jika object kompatibel dengan type Customer.
```

Cocok jika:

- class memang didesain untuk equality polymorphic;
- proxy subclass harus diterima;
- kontrak equality berada di supertype.

Risiko:

- subclass yang menambah state bisa merusak symmetry/transitivity.

---

### 4.3 Equality inheritance trap

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
        if (!(other instanceof Point p)) return false;
        return x == p.x && y == p.y;
    }
}

class ColorPoint extends Point {
    final String color;

    ColorPoint(int x, int y, String color) {
        super(x, y);
        this.color = color;
    }

    @Override
    public boolean equals(Object other) {
        if (!(other instanceof ColorPoint cp)) return false;
        return x == cp.x && y == cp.y && color.equals(cp.color);
    }
}
```

```java
Point p = new Point(1, 2);
ColorPoint cp = new ColorPoint(1, 2, "red");

System.out.println(p.equals(cp)); // true
System.out.println(cp.equals(p)); // false
```

Symmetry rusak.

Pelajaran:

```text
Equality untuk inheritance hierarchy sulit. Jika tidak perlu inheritance, buat value type final atau gunakan record.
```

---

## 5. `equals(Object)`: Logical Equality Contract

### 5.1 Lima properti kontrak `equals`

`equals` harus memenuhi:

| Properti | Kontrak |
|---|---|
| Reflexive | `x.equals(x)` harus true untuk non-null `x` |
| Symmetric | jika `x.equals(y)` true, maka `y.equals(x)` true |
| Transitive | jika `x.equals(y)` dan `y.equals(z)`, maka `x.equals(z)` true |
| Consistent | hasil tidak berubah selama state pembanding tidak berubah |
| Non-null | `x.equals(null)` harus false |

Kontrak ini diasumsikan oleh collection dan framework. Jika dilanggar, behavior bisa terlihat acak padahal sebenarnya kontraknya yang rusak.

---

### 5.2 Kapan override `equals`?

Override `equals` jika object merepresentasikan nilai atau key yang harus dibandingkan berdasarkan isi/domain meaning.

Cocok:

- value object: `Money`, `EmailAddress`, `PostalCode`, `DateRange`;
- cache key;
- composite key;
- command/query object untuk testing;
- DTO immutable;
- idempotency key;
- domain identifier wrapper.

Tidak selalu cocok:

- service object;
- repository;
- connection/session/resource handle;
- mutable aggregate root dengan lifecycle kompleks;
- task/thread/process handle;
- object yang identity-nya memang instance identity.

---

### 5.3 Equality untuk entity: jangan otomatis override

Entity sering punya lifecycle:

```java
class CaseFile {
    private Long id;       // generated database ID
    private String caseNo; // business identifier
}
```

Pilihan equality tidak trivial.

#### A. Tidak override

Entity memakai identity equality.

Kelebihan:

- aman dari perubahan ID setelah persist;
- tidak merusak `HashSet` jika entity mutable;
- tidak bentrok dengan persistence lifecycle.

Kelemahan:

- dua object dari row sama tidak equal;
- cache/dedup perlu explicit key.

#### B. Equality berdasarkan generated ID

```java
@Override
public boolean equals(Object other) {
    if (this == other) return true;
    if (!(other instanceof CaseFile that)) return false;
    return id != null && id.equals(that.id);
}
```

Risiko:

- sebelum persist `id` null;
- `hashCode` berubah setelah insert;
- object yang sudah berada di hash collection bisa tidak ditemukan lagi.

#### C. Equality berdasarkan immutable business key

```java
@Override
public boolean equals(Object other) {
    if (this == other) return true;
    if (!(other instanceof CaseFile that)) return false;
    return caseNo.equals(that.caseNo);
}
```

Cocok hanya jika `caseNo` benar-benar immutable, unique, dan stabil sepanjang lifecycle.

Prinsip praktis:

```text
Jika tidak ada identity invariant yang stabil, jangan paksa entity override equals/hashCode. Gunakan key object eksplisit.
```

Contoh key object:

```java
public record CaseKey(String agencyCode, String caseNo) {}
```

---

### 5.4 Equality untuk value object

Value object ideal:

- immutable;
- valid sejak construction;
- equality berdasarkan semua state signifikan;
- hashCode konsisten;
- tidak punya lifecycle identity.

```java
public final class EmailAddress {
    private final String value;

    public EmailAddress(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        this.value = raw.trim().toLowerCase(java.util.Locale.ROOT);
    }

    public String value() {
        return value;
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

    @Override
    public String toString() {
        return value;
    }
}
```

Untuk Java 16+, record sering lebih cocok:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        value = value.trim().toLowerCase(java.util.Locale.ROOT);
    }
}
```

---

## 6. `hashCode()`: Hash Contract dan Collection Behavior

### 6.1 Kenapa `hashCode` wajib konsisten dengan `equals`

`HashMap` kira-kira bekerja seperti ini:

1. hitung hash key;
2. tentukan bucket;
3. cari key equal di bucket itu.

Jika dua object equal tetapi hash berbeda, lookup bisa gagal.

Bug:

```java
final class CaseKey {
    private final String agency;
    private final String caseNo;

    CaseKey(String agency, String caseNo) {
        this.agency = agency;
        this.caseNo = caseNo;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof CaseKey that)) return false;
        return agency.equals(that.agency) && caseNo.equals(that.caseNo);
    }

    // BUG: hashCode tidak dioverride
}
```

```java
Map<CaseKey, String> statusByCase = new HashMap<>();
statusByCase.put(new CaseKey("CEA", "C-001"), "OPEN");

System.out.println(statusByCase.get(new CaseKey("CEA", "C-001"))); // bisa null
```

Rule:

```text
Jika override equals, override hashCode.
```

---

### 6.2 Implementasi hashCode

Sederhana:

```java
@Override
public int hashCode() {
    return java.util.Objects.hash(agency, caseNo);
}
```

Untuk hot path, hindari `Objects.hash` karena varargs bisa allocate:

```java
@Override
public int hashCode() {
    int result = agency.hashCode();
    result = 31 * result + caseNo.hashCode();
    return result;
}
```

Untuk immutable key modern:

```java
public record CaseKey(String agency, String caseNo) {}
```

Record menghasilkan `equals`, `hashCode`, dan `toString` berdasarkan components.

---

### 6.3 Mutable key adalah bug waiting to happen

```java
final class MutableKey {
    String value;

    MutableKey(String value) {
        this.value = value;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof MutableKey that && value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }
}
```

```java
Set<MutableKey> set = new HashSet<>();
MutableKey key = new MutableKey("A");

set.add(key);
key.value = "B";

System.out.println(set.contains(key)); // false atau inconsistent
```

Kenapa? Object dimasukkan ke bucket berdasarkan hash dari `A`, lalu berubah menjadi hash dari `B`.

Invariant:

```text
Selama object berada dalam hash-based collection, field yang mempengaruhi equals/hashCode tidak boleh berubah.
```

---

### 6.4 Hash collision bukan pelanggaran kontrak

```java
class BadKey {
    @Override
    public int hashCode() {
        return 1;
    }
}
```

Ini tidak otomatis salah secara kontrak, tetapi buruk untuk performance karena semua key masuk bucket sama.

Kontrak benar belum tentu performa baik.

```text
Correctness: equal objects must have equal hash.
Performance: unequal objects sebaiknya tersebar cukup merata.
```

---

## 7. `toString()`: Diagnostic Contract

### 7.1 Default `toString`

Default `Object.toString()` biasanya berbentuk:

```text
ClassName@hexHashCode
```

Contoh:

```text
com.example.Customer@5e2de80c
```

Ini berguna sebagai fallback tetapi miskin makna domain.

---

### 7.2 `toString` untuk observability

`toString` sebaiknya menjawab:

```text
Apa informasi minimal yang membantu developer/operator memahami object ini?
```

Contoh baik:

```java
@Override
public String toString() {
    return "CaseFile{" +
           "caseNo='" + caseNo + '\'' +
           ", status=" + status +
           ", agency='" + agency + '\'' +
           '}';
}
```

Namun jangan membocorkan:

- password;
- token;
- session ID sensitif;
- NRIC/NIK/SSN/passport;
- full address;
- private key;
- access token;
- PII yang tidak perlu;
- serialized document payload besar.

Contoh lebih aman:

```java
@Override
public String toString() {
    return "UserLoginAttempt{" +
           "username='" + username + '\'' +
           ", ip='" + maskedIp + '\'' +
           ", result=" + result +
           '}';
}
```

---

### 7.3 `toString` bukan serialization format

Jangan jadikan `toString()` sebagai format yang diparse balik.

Buruk:

```java
String s = caseKey.toString();
String[] parts = s.split(":");
```

Lebih baik:

```java
record CaseKey(String agency, String caseNo) {
    String externalForm() {
        return agency + ":" + caseNo;
    }

    static CaseKey parse(String value) {
        String[] parts = value.split(":", 2);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid case key");
        return new CaseKey(parts[0], parts[1]);
    }
}
```

`toString` untuk manusia/operator, bukan stable machine protocol.

---

## 8. `clone()`: Legacy Copying Mechanism

### 8.1 Mengapa `clone` problematik

`Object.clone()` membuat copy shallow, tetapi hanya bisa dipakai jika class mengimplementasikan `Cloneable`. Jika tidak, ia melempar `CloneNotSupportedException`.

Masalah desain:

- `Cloneable` tidak mendeklarasikan method `clone`;
- default copy shallow sering salah untuk object dengan mutable fields;
- constructor tidak dipanggil secara normal;
- invariant bisa terlewati;
- inheritance membuat cloning makin sulit;
- checked exception menambah noise.

Contoh shallow copy trap:

```java
class Order implements Cloneable {
    List<String> items = new ArrayList<>();

    @Override
    protected Order clone() throws CloneNotSupportedException {
        return (Order) super.clone();
    }
}
```

```java
Order a = new Order();
a.items.add("A");

Order b = a.clone();
b.items.add("B");

System.out.println(a.items); // [A, B]
```

List dibagi oleh dua object.

---

### 8.2 Alternatif yang lebih baik

Gunakan copy constructor:

```java
public final class OrderSnapshot {
    private final List<String> items;

    public OrderSnapshot(List<String> items) {
        this.items = List.copyOf(items);
    }

    public OrderSnapshot(OrderSnapshot source) {
        this.items = source.items;
    }
}
```

Atau factory method:

```java
public OrderSnapshot copy() {
    return new OrderSnapshot(this.items);
}
```

Atau record untuk immutable data:

```java
public record OrderSnapshot(List<String> items) {
    public OrderSnapshot {
        items = List.copyOf(items);
    }
}
```

Prinsip:

```text
Copying harus eksplisit tentang shallow/deep/immutable sharing.
```

---

## 9. `wait`, `notify`, `notifyAll`: Intrinsic Monitor Contract

### 9.1 Kenapa ada di `Object`?

Karena setiap object bisa menjadi monitor. Thread bukan satu-satunya object yang bisa disinkronisasi.

```java
private final Object lock = new Object();

synchronized (lock) {
    lock.wait();
}
```

`wait` hanya boleh dipanggil ketika thread sedang memiliki monitor object tersebut. Jika tidak, JVM melempar `IllegalMonitorStateException`.

---

### 9.2 Pola benar: wait dalam loop

Jangan:

```java
synchronized (lock) {
    if (!ready) {
        lock.wait();
    }
    useData();
}
```

Gunakan loop:

```java
synchronized (lock) {
    while (!ready) {
        lock.wait();
    }
    useData();
}
```

Kenapa?

- spurious wakeup mungkin terjadi;
- thread bisa dibangunkan tetapi condition belum benar;
- thread lain bisa mengambil state lebih dulu;
- `notifyAll` membangunkan banyak waiter dengan condition berbeda.

Mental model:

```text
wait bukan menunggu event.
wait menunggu sampai condition predicate menjadi true.
```

---

### 9.3 Producer-consumer sederhana

```java
final class OneSlotBuffer<T> {
    private T value;
    private boolean hasValue;

    public synchronized void put(T newValue) throws InterruptedException {
        while (hasValue) {
            wait();
        }
        value = newValue;
        hasValue = true;
        notifyAll();
    }

    public synchronized T take() throws InterruptedException {
        while (!hasValue) {
            wait();
        }
        T result = value;
        value = null;
        hasValue = false;
        notifyAll();
        return result;
    }
}
```

Ini contoh untuk memahami kontrak. Di production, biasanya gunakan `BlockingQueue`.

---

### 9.4 `notify` vs `notifyAll`

`notify()` membangunkan satu waiter arbitrer. `notifyAll()` membangunkan semua waiter.

Gunakan `notify` hanya jika:

- semua waiter menunggu condition yang sama;
- satu wakeup cukup;
- kamu yakin tidak ada starvation/lost signal;
- invariants sangat jelas.

Jika ada multiple condition, `notifyAll` biasanya lebih aman walaupun lebih mahal.

Namun lebih baik lagi: gunakan `Condition` dari `java.util.concurrent.locks` untuk condition queue yang eksplisit.

---

### 9.5 Failure modes monitor

| Failure mode | Dampak |
|---|---|
| `wait` di luar synchronized | `IllegalMonitorStateException` |
| `if` bukan `while` | spurious wakeup bug |
| `notify` salah waiter | deadlock/lost progress |
| lock object public | external code bisa mengunci object yang sama |
| synchronize pada string literal | lock global tidak sengaja |
| synchronize pada boxed primitive | cache wrapper menyebabkan lock sharing |
| blocking call di dalam synchronized | throughput drop/deadlock |

Contoh buruk:

```java
synchronized ("LOCK") {
    // string literal bisa dipakai code lain juga
}
```

Lebih baik:

```java
private final Object lock = new Object();
```

---

## 10. `finalize()`: Historical Lifecycle Hook yang Harus Ditinggalkan

### 10.1 Apa itu finalization?

`finalize()` adalah hook lama yang dapat dipanggil GC sebelum object direclaim.

Masalah fundamental:

- tidak ada jaminan kapan dipanggil;
- tidak ada jaminan akan dipanggil sebelum proses mati;
- bisa menunda reclaim memory;
- bisa menyebabkan security issue;
- bisa resurrect object;
- sulit diuji;
- buruk untuk resource management deterministik.

Finalization deprecated sejak Java 9 dan kemudian dideprecate for removal. Untuk desain baru, anggap `finalize` tidak tersedia.

---

### 10.2 Jangan pakai finalizer untuk resource penting

Buruk:

```java
class NativeHandle {
    private long handle;

    @Override
    protected void finalize() throws Throwable {
        closeNative(handle);
    }
}
```

Masalah:

```text
Resource OS/native bisa habis jauh sebelum GC memutuskan menjalankan finalizer.
```

Lebih baik:

```java
final class NativeHandle implements AutoCloseable {
    private long handle;
    private boolean closed;

    @Override
    public void close() {
        if (!closed) {
            closeNative(handle);
            closed = true;
        }
    }
}
```

Pemakaian:

```java
try (NativeHandle handle = openHandle()) {
    // use handle
}
```

Untuk safety net, gunakan `Cleaner` dengan sangat hati-hati, bukan sebagai mekanisme utama.

---

## 11. Patterns untuk Production Design

### 11.1 Pattern: immutable value object

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

Keuntungan:

- equality benar by default;
- hashCode benar by default;
- toString cukup diagnostik;
- invariant berada di constructor;
- cocok untuk key, command, event, dan DTO immutable.

---

### 11.2 Pattern: explicit key object untuk entity

```java
public record CaseKey(String agencyCode, String caseNo) {
    public CaseKey {
        Objects.requireNonNull(agencyCode, "agencyCode");
        Objects.requireNonNull(caseNo, "caseNo");
    }
}

public final class CaseFile {
    private final CaseKey key;
    private CaseStatus status;

    public CaseKey key() {
        return key;
    }
}
```

Alih-alih menjadikan seluruh entity sebagai map key:

```java
Map<CaseFile, WorkflowState> bad;
```

Gunakan:

```java
Map<CaseKey, WorkflowState> good;
```

Ini jauh lebih stabil.

---

### 11.3 Pattern: safe `toString`

```java
public final class AccessTokenInfo {
    private final String token;
    private final Instant expiresAt;
    private final String subject;

    @Override
    public String toString() {
        return "AccessTokenInfo{" +
               "token='<redacted>'" +
               ", expiresAt=" + expiresAt +
               ", subject='" + subject + '\'' +
               '}';
    }
}
```

Rule:

```text
toString boleh membantu debugging, tetapi tidak boleh menjadi data exfiltration channel.
```

---

### 11.4 Pattern: private lock object

```java
public final class Counter {
    private final Object lock = new Object();
    private long value;

    public void increment() {
        synchronized (lock) {
            value++;
        }
    }

    public long value() {
        synchronized (lock) {
            return value;
        }
    }
}
```

Jangan lock pada `this` jika external code juga bisa synchronize pada object-mu.

---

## 12. Failure Modes yang Wajib Diingat

### 12.1 Broken equality symmetry

```text
A.equals(B) true, tetapi B.equals(A) false.
```

Biasanya terjadi karena inheritance dan penggunaan `instanceof` tanpa desain yang matang.

---

### 12.2 Equal object dengan hash berbeda

```text
HashMap gagal menemukan key walaupun object terlihat equal.
```

Penyebab: override `equals` tapi lupa override `hashCode`.

---

### 12.3 Mutable hash key

```text
Object masuk HashSet, field pembentuk hash berubah, object tidak bisa ditemukan.
```

Penyebab: mutable field dipakai di `equals/hashCode`.

---

### 12.4 `toString` membocorkan data

```text
Log menjadi sumber kebocoran PII/secrets.
```

Penyebab: auto-generated `toString` memasukkan semua field.

---

### 12.5 ORM/proxy equality mismatch

```text
Entity dari proxy dan entity konkret tidak dianggap equal.
```

Penyebab: `getClass() != other.getClass()` pada class yang diproxy subclass oleh framework.

Solusi bergantung framework dan domain invariant. Tidak ada jawaban universal.

---

### 12.6 `wait` tanpa loop

```text
Thread lanjut walaupun condition belum true.
```

Penyebab: `if` bukan `while`.

---

### 12.7 Relying on finalization

```text
File/socket/native handle telat ditutup atau tidak tertutup.
```

Penyebab: resource management diserahkan ke GC.

---

## 13. Java 8–25 Evolution Notes

### 13.1 `Object` relatif stabil, tetapi konteksnya berubah

Method utama `Object` sudah lama stabil. Yang berubah adalah ekosistem dan best practice di sekitarnya:

- Java 8 masih banyak code memakai anonymous class, mutable POJO, dan manual equality;
- Java 9 membawa module system dan deprecates `finalize`;
- Java 14+ membawa helpful NullPointerException yang memperbaiki diagnostic failure;
- Java 16 membawa records sebagai alternatif kuat untuk immutable data carrier;
- Java 17 membawa sealed classes sebagai fondasi hierarchy yang lebih terkendali;
- Java 21 membawa virtual threads, membuat monitor pinning/locking menjadi topik performa yang lebih penting;
- Java 25 melanjutkan posisi modern Java sebagai platform di mana finalization bukan lagi desain yang layak untuk code baru.

---

### 13.2 Records mengurangi boilerplate, bukan menghapus kebutuhan memahami equality

Record membantu:

```java
public record UserId(String value) {}
```

Tetapi kamu tetap perlu memahami:

- apakah semua component harus ikut equality;
- apakah component mutable;
- apakah canonicalization diperlukan;
- apakah `toString` aman;
- apakah record cocok untuk public API jangka panjang.

Record dengan mutable component tetap bisa bermasalah:

```java
public record Group(List<String> members) {}
```

Lebih aman:

```java
public record Group(List<String> members) {
    public Group {
        members = List.copyOf(members);
    }
}
```

---

### 13.3 Finalization adalah legacy compatibility, bukan design option

Jika menemukan `finalize()` di codebase:

1. audit resource apa yang ditutup;
2. ubah ke `AutoCloseable`/try-with-resources;
3. pertimbangkan `Cleaner` hanya sebagai safety net;
4. buat test untuk memastikan close deterministik;
5. cari subclass finalizer lain di dependency/internal library.

---

## 14. Checklist Desain `Object` Contract

Sebelum menulis atau mereview class, tanyakan:

### Identity dan equality

- Apakah object ini value object, entity, service, resource handle, atau event?
- Apakah dua instance berbeda boleh dianggap equal?
- Field mana yang membentuk equality?
- Apakah field itu immutable?
- Apakah equality harus exact class atau polymorphic?
- Apakah class bisa diproxy oleh framework?

### Hashing

- Jika `equals` dioverride, apakah `hashCode` juga dioverride?
- Apakah hashCode memakai field yang sama dengan equals?
- Apakah field pembentuk hash stabil selama object berada di map/set?
- Apakah object ini akan dipakai sebagai cache key?

### Diagnostics

- Apakah `toString` membantu debugging?
- Apakah `toString` membocorkan secrets/PII?
- Apakah output terlalu besar?
- Apakah `toString` dipakai sebagai protocol? Jika ya, itu smell.

### Lifecycle

- Apakah class memegang resource yang harus ditutup?
- Apakah sudah implement `AutoCloseable`?
- Apakah ada finalizer lama yang harus dimigrasi?
- Apakah copying perlu shallow, deep, atau immutable sharing?

### Monitor/concurrency

- Apakah lock object private?
- Apakah `wait` selalu dalam loop?
- Apakah ada blocking I/O di synchronized block?
- Apakah seharusnya memakai abstraction concurrent yang lebih tinggi?

---

## 15. Latihan Pemahaman

### Latihan 1 — Cache key

Buat `record ApplicantKey(String agencyCode, String applicantNo)` dengan validasi:

- `agencyCode` tidak null dan tidak blank;
- `applicantNo` tidak null dan tidak blank;
- canonicalize trim;
- `agencyCode` uppercase `Locale.ROOT`.

Pikirkan: apakah `toString` aman dipakai di log?

---

### Latihan 2 — Entity equality

Untuk entity `EnforcementCase` dengan field:

- `Long id` generated DB;
- `String agencyCode`;
- `String caseNo`;
- `CaseStatus status`;
- `Instant createdAt`.

Tentukan apakah kamu akan override `equals/hashCode`. Jelaskan invariant yang kamu pilih.

---

### Latihan 3 — Mutable key bug

Buat class mutable yang override `equals/hashCode`, masukkan ke `HashSet`, ubah field pembentuk hash, lalu observasi `contains`. Jelaskan kenapa hasilnya seperti itu.

---

### Latihan 4 — Monitor correctness

Implementasikan `OneSlotBuffer<T>` dengan `wait/notifyAll`. Pastikan:

- `put` menunggu jika buffer penuh;
- `take` menunggu jika buffer kosong;
- semua `wait` berada dalam `while`;
- interruption tidak ditelan.

Lalu bandingkan dengan `ArrayBlockingQueue<T>`.

---

## 16. Ringkasan

`Object` bukan sekadar class default. Ia adalah kontrak dasar object model Java.

Hal yang harus melekat:

1. `==` adalah identity equality; `equals` adalah logical equality.
2. Jika override `equals`, override `hashCode`.
3. Field pembentuk `equals/hashCode` harus stabil selama object dipakai sebagai key di hash collection.
4. Equality untuk inheritance dan entity lifecycle sangat sulit; jangan otomatis override.
5. `toString` adalah diagnostic contract, bukan serialization protocol.
6. `clone` adalah legacy copying mechanism; lebih baik gunakan constructor/factory/record.
7. `wait/notify/notifyAll` adalah primitive monitor low-level; gunakan loop dan pahami condition predicate.
8. `finalize` adalah legacy API yang harus dimigrasi dari desain modern.
9. `Object` contract mempengaruhi collection, cache, framework, logging, persistence, dan reliability.

Jika kamu memahami `Object` secara benar, kamu akan lebih kuat dalam mendesain domain model, cache key, entity identity, runtime diagnostics, dan concurrency boundaries.

---

## 17. Referensi Resmi

- Java SE 25 API — `java.lang.Object`: `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html`
- Java SE 8 API — `java.lang.Object`: `https://docs.oracle.com/javase/8/docs/api/java/lang/Object.html`
- Java SE 25 Deprecated List — finalization: `https://docs.oracle.com/en/java/javase/25/docs/api/deprecated-list.html`
- OpenJDK JEP 421 — Deprecate Finalization for Removal: `https://openjdk.org/jeps/421`
- Oracle Java Tutorial — Object as a Superclass: `https://docs.oracle.com/javase/tutorial/java/IandI/objectclass.html`

---

## 18. Status Seri

Part ini adalah **Part 2 dari 32**.

Seri **belum selesai**.

Part berikutnya:

```text
03-class-type-token-runtime-type-metadata.md
```

Judul:

```text
Part 3 — Class<T> and Runtime Type Tokens
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 1 — `java.lang` as the Root Contract of the Java Platform](./01-java-lang-as-platform-root-contract.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 3 — `Class<T>` and Runtime Type Tokens](./03-class-type-token-runtime-type-metadata.md)
