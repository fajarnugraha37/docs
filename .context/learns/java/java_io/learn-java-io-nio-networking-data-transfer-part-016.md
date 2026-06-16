# Part 016 — Serialization I: Java Object Serialization Architecture, Object Graph, Identity, dan Format

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-016.md`  
> Status: Part 016 dari 030 — seri belum selesai

---

## 1. Tujuan Pembelajaran

Part ini membahas **Java Object Serialization** dari sisi arsitektur internal, bukan hanya contoh `implements Serializable`.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami apa yang sebenarnya terjadi ketika object Java ditulis ke `ObjectOutputStream`.
2. Membedakan serialization sebagai **object graph persistence** vs format data biasa seperti JSON/CSV/binary protocol.
3. Memahami bagaimana Java mempertahankan object identity, reference, cyclic graph, class descriptor, field state, dan custom serialization hooks.
4. Mendesain class serializable dengan sadar terhadap compatibility, invariant, runtime resource, dan trust boundary.
5. Mengenali kenapa serialization terlihat sederhana tetapi sebenarnya kompleks dan berisiko.

Bagian ini fokus pada **arsitektur dan mekanisme**. Security, versioning, gadget chain, dan filtering akan dibahas lebih dalam di Part 017.

---

## 2. Referensi Utama

Materi ini mengacu pada dokumentasi resmi Java Object Serialization Specification dan API Java:

- Java Object Serialization Specification — System Architecture: https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/serial-arch.html
- Java Object Serialization Specification — Object Output Classes: https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/output.html
- Java Object Serialization Specification — Object Input Classes: https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/input.html
- Java Object Serialization Specification — Stream Protocol: https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/protocol.html
- `ObjectOutputStream`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectOutputStream.html
- `ObjectInputStream`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputStream.html
- `Serializable`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html
- `Externalizable`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Externalizable.html
- `@Serial`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serial.html

---

## 3. Posisi Serialization dalam Java I/O

Java I/O punya beberapa bentuk transfer:

| Bentuk I/O | Unit data utama | Contoh API | Cocok untuk |
|---|---:|---|---|
| Byte stream | byte | `InputStream`, `OutputStream` | binary data, file, socket, compression |
| Character stream | char/text | `Reader`, `Writer` | text, config, log, CSV sederhana |
| Buffer/channel | block/buffer | `ByteBuffer`, `FileChannel`, `SocketChannel` | high-performance I/O, random access, non-blocking |
| Object serialization | object graph | `ObjectOutputStream`, `ObjectInputStream` | object persistence internal, legacy object transfer |
| Structured format | value/schema tree | JSON, XML, Protobuf, Avro, CBOR | API, data pipeline, long-lived integration |

Serialization berada di atas byte stream:

```text
Object graph
    ↓
ObjectOutputStream
    ↓
bytes in Java serialization stream format
    ↓
OutputStream / file / socket / byte array
```

Deserialization adalah kebalikannya:

```text
InputStream / file / socket / byte array
    ↓
bytes in Java serialization stream format
    ↓
ObjectInputStream
    ↓
newly reconstructed object graph
```

Mental model penting:

> Java serialization bukan sekadar mengubah satu object menjadi byte. Ia menelusuri object graph, menyimpan class metadata, field state, references, identity, dan instruksi rekonstruksi object.

---

## 4. Serialization Bukan JSON

Banyak developer menyederhanakan serialization seperti ini:

```java
byte[] bytes = serialize(user);
User user = deserialize(bytes);
```

Padahal Java serialization berbeda dari JSON/XML biasa.

### 4.1 JSON/XML biasanya value-oriented

JSON umum merepresentasikan value tree:

```json
{
  "id": "U-001",
  "name": "Fajar"
}
```

Jika dua field menunjuk object yang sama di memory, JSON biasa tidak otomatis menjaga identity itu.

### 4.2 Java serialization graph-oriented

Java serialization melihat object sebagai graph:

```text
Order
 ├── buyer ───────┐
 └── approver ────┘
        same User object
```

Jika `buyer` dan `approver` menunjuk instance `User` yang sama, serialization dapat mempertahankan shared reference itu.

Setelah deserialize:

```java
order.buyer() == order.approver(); // bisa true jika sebelumnya reference yang sama
```

Ini bukan kesamaan value. Ini identity.

---

## 5. Core API Serialization

### 5.1 `Serializable`

`Serializable` adalah marker interface.

```java
public interface Serializable {
}
```

Tidak ada method yang harus diimplementasikan.

```java
import java.io.Serial;
import java.io.Serializable;

public final class Money implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String currency;
    private final long minorUnits;

    public Money(String currency, long minorUnits) {
        if (currency == null || currency.isBlank()) {
            throw new IllegalArgumentException("currency must not be blank");
        }
        this.currency = currency;
        this.minorUnits = minorUnits;
    }

    public String currency() {
        return currency;
    }

    public long minorUnits() {
        return minorUnits;
    }
}
```

Maknanya:

> Class ini mengizinkan Java serialization mechanism membaca dan menulis state object-nya.

Bukan berarti class ini aman untuk external boundary.

### 5.2 `ObjectOutputStream`

`ObjectOutputStream` mengubah primitive dan object menjadi serialization stream.

```java
try (ObjectOutputStream out = new ObjectOutputStream(
        new BufferedOutputStream(Files.newOutputStream(path)))) {
    out.writeObject(object);
}
```

Tanggung jawab utamanya:

- menulis stream header,
- menulis object graph,
- menjaga handle table untuk reference yang sudah ditulis,
- menulis class descriptor,
- menulis field state,
- memanggil custom hook jika ada,
- menulis primitive data jika diminta.

### 5.3 `ObjectInputStream`

`ObjectInputStream` membaca serialization stream dan merekonstruksi object graph.

```java
try (ObjectInputStream in = new ObjectInputStream(
        new BufferedInputStream(Files.newInputStream(path)))) {
    Object object = in.readObject();
}
```

Tanggung jawab utamanya:

- membaca stream header,
- membaca descriptor,
- mengalokasikan object,
- mengisi field,
- menjaga handle table untuk object yang sudah dibaca,
- menyambungkan reference,
- memanggil hook seperti `readObject` dan `readResolve` jika ada.

---

## 6. Minimal Serialization Example

```java
import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;

public class SerializationDemo {
    public static void main(String[] args) throws Exception {
        Path file = Path.of("money.bin");
        Money original = new Money("IDR", 125_000L);

        write(file, original);
        Money restored = read(file, Money.class);

        System.out.println(restored.currency());
        System.out.println(restored.minorUnits());
    }

    static void write(Path file, Object object) throws IOException {
        try (ObjectOutputStream out = new ObjectOutputStream(
                new BufferedOutputStream(Files.newOutputStream(file)))) {
            out.writeObject(object);
        }
    }

    static <T> T read(Path file, Class<T> expectedType)
            throws IOException, ClassNotFoundException {
        try (ObjectInputStream in = new ObjectInputStream(
                new BufferedInputStream(Files.newInputStream(file)))) {
            Object value = in.readObject();
            return expectedType.cast(value);
        }
    }
}
```

Yang tampak sederhana:

```java
out.writeObject(object);
```

Yang sebenarnya terjadi secara konseptual:

```text
1. Tulis stream header.
2. Cek apakah object null.
3. Cek apakah object sudah pernah ditulis di stream ini.
4. Jika belum, cek class descriptor.
5. Tulis metadata class.
6. Tulis field primitive.
7. Telusuri field reference.
8. Untuk setiap referenced object, ulangi proses.
9. Simpan handle untuk menjaga identity/reference.
10. Selesaikan graph.
```

---

## 7. Serialization Stream sebagai Container

Satu `ObjectOutputStream` tidak harus hanya berisi satu object.

```java
try (ObjectOutputStream out = new ObjectOutputStream(Files.newOutputStream(path))) {
    out.writeObject(new Money("IDR", 1000));
    out.writeObject(new Money("SGD", 500));
    out.writeInt(42);
    out.writeUTF("done");
}
```

Dibaca dengan urutan yang sama:

```java
try (ObjectInputStream in = new ObjectInputStream(Files.newInputStream(path))) {
    Money first = (Money) in.readObject();
    Money second = (Money) in.readObject();
    int number = in.readInt();
    String marker = in.readUTF();
}
```

Invariant penting:

> Serialization stream adalah ordered stream. Reader harus membaca dengan urutan dan tipe yang kompatibel dengan writer.

Jika writer menulis:

```text
object, object, int, UTF
```

reader tidak boleh membaca:

```text
object, int, object, UTF
```

---

## 8. Object Graph Traversal

Misal:

```java
import java.io.Serial;
import java.io.Serializable;
import java.util.List;

public final class Department implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String name;
    private final List<Employee> employees;

    public Department(String name, List<Employee> employees) {
        this.name = name;
        this.employees = List.copyOf(employees);
    }
}

public final class Employee implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String id;
    private final String name;

    public Employee(String id, String name) {
        this.id = id;
        this.name = name;
    }
}
```

Ketika menulis:

```java
out.writeObject(department);
```

Java tidak hanya menulis field `Department.name` dan `Department.employees` sebagai shallow data. Ia menulis reachable object graph:

```text
Department
 ├── String name
 └── List employees
      ├── Employee #1
      │    ├── String id
      │    └── String name
      └── Employee #2
           ├── String id
           └── String name
```

Syaratnya:

> Semua object reachable yang perlu diserialisasi juga harus serializable, kecuali field tersebut `transient` atau ditangani manual.

Jika ada field non-serializable:

```java
public final class ReportJob implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String jobId;
    private final Thread workerThread; // Thread tidak semestinya diserialisasi

    public ReportJob(String jobId, Thread workerThread) {
        this.jobId = jobId;
        this.workerThread = workerThread;
    }
}
```

Maka dapat terjadi:

```text
java.io.NotSerializableException: java.lang.Thread
```

Solusi bukan asal membuat semua class `Serializable`. Solusi benar adalah bertanya:

> Apakah field ini bagian dari persistent logical state, atau hanya runtime resource?

Untuk runtime resource:

```java
private transient Thread workerThread;
```

---

## 9. Object Identity dan Handle Table

Salah satu fitur penting Java serialization adalah object identity preservation.

```java
import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;

record User(String id, String name) implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;
}

record Approval(User requester, User approver) implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;
}

public class IdentityDemo {
    public static void main(String[] args) throws Exception {
        User sameUser = new User("U-001", "Fajar");
        Approval approval = new Approval(sameUser, sameUser);

        Path file = Path.of("approval.bin");
        try (ObjectOutputStream out = new ObjectOutputStream(Files.newOutputStream(file))) {
            out.writeObject(approval);
        }

        Approval restored;
        try (ObjectInputStream in = new ObjectInputStream(Files.newInputStream(file))) {
            restored = (Approval) in.readObject();
        }

        System.out.println(restored.requester() == restored.approver()); // true
    }
}
```

Kenapa bisa `true`?

Karena stream menjaga handle table.

```text
User(U-001) → assigned handle H1
second reference to same User → write reference to H1, not duplicate full object
```

Ini penting untuk:

- graph dengan shared object,
- cyclic graph,
- memory efficiency dalam stream,
- menjaga semantic identity.

---

## 10. Cyclic Object Graph

Serialization dapat menangani cyclic reference.

```java
import java.io.Serial;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

public final class Node implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String name;
    private final List<Node> children = new ArrayList<>();
    private Node parent;

    public Node(String name) {
        this.name = name;
    }

    public void addChild(Node child) {
        children.add(child);
        child.parent = this;
    }
}
```

Graph:

```text
root
 └── child
      └── parent → root
```

Tanpa handle table, serialization akan infinite recursion:

```text
root → child → parent/root → child → parent/root → ...
```

Dengan handle table:

```text
1. Write root, assign H1.
2. Write child, assign H2.
3. child.parent points to root.
4. root already known as H1.
5. Write reference H1.
```

Mental model:

> Java serialization bukan recursive dump naif. Ia adalah graph traversal dengan identity registry.

---

## 11. Stream Header dan Kenapa Append Object ke File Bisa Gagal

Ketika membuat `ObjectOutputStream`, constructor-nya menulis stream header.

```java
try (ObjectOutputStream out = new ObjectOutputStream(Files.newOutputStream(path))) {
    out.writeObject(object);
}
```

Masalah umum:

```java
try (ObjectOutputStream out = new ObjectOutputStream(
        Files.newOutputStream(path, StandardOpenOption.CREATE, StandardOpenOption.APPEND))) {
    out.writeObject(object1);
}

try (ObjectOutputStream out = new ObjectOutputStream(
        Files.newOutputStream(path, StandardOpenOption.APPEND))) {
    out.writeObject(object2);
}
```

Ini menulis header kedua di tengah file. Saat dibaca berurutan dengan satu `ObjectInputStream`, bisa terjadi `StreamCorruptedException`.

Cara aman jika jumlah object diketahui dalam satu sesi:

```java
try (ObjectOutputStream out = new ObjectOutputStream(Files.newOutputStream(path))) {
    out.writeObject(object1);
    out.writeObject(object2);
    out.writeObject(object3);
}
```

Jika benar-benar perlu append, dapat memakai custom stream tanpa header ulang:

```java
import java.io.IOException;
import java.io.ObjectOutputStream;
import java.io.OutputStream;

public final class AppendingObjectOutputStream extends ObjectOutputStream {
    public AppendingObjectOutputStream(OutputStream out) throws IOException {
        super(out);
    }

    @Override
    protected void writeStreamHeader() throws IOException {
        reset();
    }
}
```

Namun pattern append serialized object ke file tetap harus hati-hati:

- corrupt di tengah file sulit recovery,
- tidak ada index bawaan,
- tidak ada transaction boundary kuat,
- sulit compact,
- sulit versioning jangka panjang.

Untuk append-only durable log, biasanya lebih baik mendesain format frame sendiri seperti Part 004.

---

## 12. `serialVersionUID`

`serialVersionUID` adalah versi serialization class.

```java
@Serial
private static final long serialVersionUID = 1L;
```

Jika tidak dideklarasikan, JVM dapat menghitungnya berdasarkan detail class. Itu rapuh karena perubahan kecil di class dapat menghasilkan nilai berbeda.

Best practice:

> Deklarasikan `serialVersionUID` secara eksplisit untuk class serializable.

```java
import java.io.Serial;
import java.io.Serializable;

public final class CustomerSnapshot implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String customerId;
    private final String displayName;

    public CustomerSnapshot(String customerId, String displayName) {
        this.customerId = customerId;
        this.displayName = displayName;
    }
}
```

Mental model:

```text
serialized stream contains class descriptor
class descriptor contains serialVersionUID
reader class also has serialVersionUID
if incompatible → InvalidClassException
```

Namun jangan salah paham:

> `serialVersionUID` bukan schema migration system lengkap. Ia hanya salah satu compatibility guard.

Versioning lebih dalam akan dibahas di Part 017.

---

## 13. Class Descriptor

Saat object ditulis, Java serialization perlu tahu class apa yang merepresentasikan object tersebut.

Descriptor dapat mencakup:

- class name,
- `serialVersionUID`,
- serializable flags,
- field descriptors,
- superclass descriptor.

Secara mental:

```text
Object stream
 ├── stream header
 ├── object
 │    ├── class descriptor: com.example.CustomerSnapshot
 │    │    ├── serialVersionUID: 1
 │    │    ├── fields:
 │    │    │    ├── customerId: String
 │    │    │    └── displayName: String
 │    │    └── superclass descriptor
 │    └── field values
```

Descriptor memungkinkan reader memahami struktur data yang dibaca.

Tapi ini juga berarti:

- stream terkait kuat dengan nama class Java,
- refactoring package/class name bisa merusak compatibility,
- serialization tidak ideal untuk long-term public data format,
- serialization kurang cocok untuk cross-language integration.

---

## 14. Constructor saat Deserialization

Untuk class `Serializable`, constructor class serializable **tidak dipanggil** saat deserialization.

```java
import java.io.Serial;
import java.io.Serializable;

public final class StrictUser implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String id;

    public StrictUser(String id) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("id must not be blank");
        }
        this.id = id;
    }
}
```

Saat deserialize, Java mengalokasikan object dan mengisi field dari stream. Constructor `StrictUser(String id)` tidak dipanggil.

Implikasi:

> Invariant yang hanya dijaga di constructor bisa dilewati oleh deserialization.

Ini alasan custom `readObject` sering diperlukan:

```java
@Serial
private void readObject(ObjectInputStream in)
        throws IOException, ClassNotFoundException {
    in.defaultReadObject();

    if (id == null || id.isBlank()) {
        throw new InvalidObjectException("id must not be blank");
    }
}
```

Catatan:

- Constructor no-arg tidak dibutuhkan untuk `Serializable`.
- Constructor no-arg public dibutuhkan untuk `Externalizable`.
- Constructor superclass pertama yang tidak serializable akan dipanggil.

---

## 15. Serializable Superclass dan Non-Serializable Superclass

Misal:

```java
class Base {
    protected String baseState;

    public Base() {
        this.baseState = "default";
    }
}

class Child extends Base implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private String childState;
}
```

`Base` tidak implements `Serializable`, sedangkan `Child` implements `Serializable`.

Saat deserialization `Child`:

- field serializable milik `Child` dipulihkan dari stream,
- constructor no-arg `Base` dipanggil untuk menginisialisasi bagian non-serializable.

Artinya state milik superclass non-serializable tidak otomatis dipersist.

Jika `Base` punya state penting, kamu harus:

1. membuat `Base` juga serializable, atau
2. menyalin state base ke field serializable di child, atau
3. menggunakan custom `writeObject/readObject`, atau
4. menghindari inheritance untuk model serializable.

---

## 16. `transient`: Memisahkan Persistent State dan Runtime State

Field `transient` tidak diserialisasi secara default.

```java
import java.io.Serial;
import java.io.Serializable;
import java.time.Instant;

public final class SessionSnapshot implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String userId;
    private final Instant createdAt;

    private transient String cachedDisplayName;

    public SessionSnapshot(String userId, Instant createdAt) {
        this.userId = userId;
        this.createdAt = createdAt;
    }
}
```

Setelah deserialization:

```text
cachedDisplayName == null
```

Gunakan `transient` untuk:

- cache,
- logger,
- file handle,
- socket,
- thread,
- connection,
- executor,
- security context runtime,
- lazily computed value,
- dependency injection reference.

Jangan gunakan `transient` sebagai cara menyembunyikan data sensitif jika data itu masih ada di field lain atau bisa direkonstruksi. Untuk security, desain threat model terpisah.

---

## 17. Custom Serialization dengan `writeObject` dan `readObject`

Class serializable dapat mengontrol sebagian proses serialization dengan private method khusus.

Signature harus tepat:

```java
@Serial
private void writeObject(ObjectOutputStream out) throws IOException

@Serial
private void readObject(ObjectInputStream in)
        throws IOException, ClassNotFoundException
```

Contoh:

```java
import java.io.*;
import java.util.Objects;

public final class ApiToken implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String tokenId;
    private transient String plaintextSecret;

    public ApiToken(String tokenId, String plaintextSecret) {
        this.tokenId = Objects.requireNonNull(tokenId);
        this.plaintextSecret = Objects.requireNonNull(plaintextSecret);
    }

    @Serial
    private void writeObject(ObjectOutputStream out) throws IOException {
        out.defaultWriteObject();
        // deliberately do not write plaintextSecret
    }

    @Serial
    private void readObject(ObjectInputStream in)
            throws IOException, ClassNotFoundException {
        in.defaultReadObject();

        if (tokenId == null || tokenId.isBlank()) {
            throw new InvalidObjectException("tokenId must not be blank");
        }

        this.plaintextSecret = null;
    }
}
```

### 17.1 `defaultWriteObject`

`defaultWriteObject()` menulis field non-static, non-transient dengan format default.

### 17.2 `defaultReadObject`

`defaultReadObject()` membaca field default dari stream.

### 17.3 Kapan custom hook diperlukan?

Gunakan ketika:

- perlu validasi invariant saat deserialize,
- perlu menulis bentuk lebih compact,
- perlu menangani transient field,
- perlu menjaga compatibility manual,
- perlu mencegah field sensitif ikut tertulis,
- perlu reconstruct derived state.

Jangan gunakan hanya untuk terlihat sophisticated. Custom serialization menambah beban maintenance.

---

## 18. `writeReplace` dan `readResolve`

`writeReplace` dan `readResolve` memungkinkan object diganti saat serialization/deserialization.

### 18.1 `writeReplace`

Sebelum object ditulis, class dapat mengganti object yang akan ditulis.

```java
@Serial
private Object writeReplace() throws ObjectStreamException {
    return new SerializationProxy(this);
}
```

### 18.2 `readResolve`

Setelah object dibaca, class dapat mengganti object hasil deserialization.

```java
@Serial
private Object readResolve() throws ObjectStreamException {
    return canonicalInstance();
}
```

Use case:

- singleton,
- enum-like class lama,
- canonicalized value object,
- serialization proxy pattern,
- immutable object invariant.

Contoh singleton:

```java
import java.io.ObjectStreamException;
import java.io.Serial;
import java.io.Serializable;

public final class SystemMarker implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    public static final SystemMarker INSTANCE = new SystemMarker();

    private SystemMarker() {
    }

    @Serial
    private Object readResolve() throws ObjectStreamException {
        return INSTANCE;
    }
}
```

Tanpa `readResolve`, deserialization dapat membuat instance baru dan merusak singleton property.

---

## 19. Serialization Proxy Pattern

Serialization proxy pattern adalah cara lebih aman untuk serializable immutable object.

Ide:

> Jangan serialize internal representation langsung. Serialize proxy sederhana yang merepresentasikan logical state, lalu rebuild object via public constructor/factory yang menjaga invariant.

```java
import java.io.*;

public final class EmailAddress implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String value;

    public EmailAddress(String value) {
        if (value == null || !value.contains("@")) {
            throw new IllegalArgumentException("invalid email");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Serial
    private Object writeReplace() throws ObjectStreamException {
        return new Proxy(this);
    }

    @Serial
    private void readObject(ObjectInputStream in) throws InvalidObjectException {
        throw new InvalidObjectException("proxy required");
    }

    private static final class Proxy implements Serializable {
        @Serial
        private static final long serialVersionUID = 1L;

        private final String value;

        Proxy(EmailAddress source) {
            this.value = source.value;
        }

        @Serial
        private Object readResolve() throws ObjectStreamException {
            return new EmailAddress(value);
        }
    }
}
```

Kenapa ini kuat?

- Object asli tidak dibangun langsung dari field mentah.
- Deserialization dipaksa melalui constructor/factory.
- Invariant tetap dijaga.
- Format serialized lebih stabil dan kecil.

Trade-off:

- boilerplate lebih banyak,
- tidak cocok untuk class yang perlu inheritance kompleks,
- harus memahami hook serialization dengan benar.

---

## 20. `Externalizable`

`Externalizable` memberi kontrol penuh atas format external object.

```java
public interface Externalizable extends Serializable {
    void writeExternal(ObjectOutput out) throws IOException;
    void readExternal(ObjectInput in) throws IOException, ClassNotFoundException;
}
```

Contoh:

```java
import java.io.*;

public final class CompactPoint implements Externalizable {
    private int x;
    private int y;

    // Required public no-arg constructor
    public CompactPoint() {
    }

    public CompactPoint(int x, int y) {
        this.x = x;
        this.y = y;
    }

    @Override
    public void writeExternal(ObjectOutput out) throws IOException {
        out.writeInt(x);
        out.writeInt(y);
    }

    @Override
    public void readExternal(ObjectInput in) throws IOException {
        this.x = in.readInt();
        this.y = in.readInt();
    }
}
```

Perbedaan penting:

| Aspek | `Serializable` | `Externalizable` |
|---|---|---|
| Default field serialization | Ada | Tidak ada |
| Constructor saat deserialize | Constructor serializable class tidak dipanggil | Public no-arg constructor dipanggil |
| Kontrol format | Sebagian | Penuh |
| Risiko salah urutan read/write | Sedang | Tinggi |
| Boilerplate | Lebih rendah | Lebih tinggi |
| Compatibility manual | Bisa | Wajib lebih disiplin |

Gunakan `Externalizable` hanya jika benar-benar perlu kontrol format penuh. Untuk kebanyakan boundary jangka panjang, Protobuf/Avro/custom binary lebih baik.

---

## 21. `ObjectOutputStream.reset()` dan Handle Table Memory

`ObjectOutputStream` menyimpan object yang sudah ditulis dalam handle table.

Ini penting untuk identity, tetapi bisa menyebabkan memory growth jika stream panjang.

Contoh buruk:

```java
try (ObjectOutputStream out = new ObjectOutputStream(Files.newOutputStream(path))) {
    for (Event event : hugeEventSource()) {
        out.writeObject(event);
    }
}
```

Jika jutaan event ditulis dalam satu stream, `ObjectOutputStream` dapat menyimpan referensi ke banyak object yang sudah ditulis untuk menjaga identity. Akibatnya memory naik.

Solusi jika identity antar record tidak diperlukan:

```java
try (ObjectOutputStream out = new ObjectOutputStream(Files.newOutputStream(path))) {
    int count = 0;
    for (Event event : hugeEventSource()) {
        out.writeObject(event);
        if (++count % 10_000 == 0) {
            out.reset();
        }
    }
}
```

Makna `reset()`:

- membuang state object yang sudah dikenal oleh stream,
- object berikutnya akan ditulis ulang sebagai object baru,
- reference sharing sebelum reset tidak dijaga melewati reset boundary.

Invariant:

> Jangan pakai `reset()` jika kamu membutuhkan identity sharing antar object yang dipisahkan oleh reset.

---

## 22. `writeUnshared` dan `readUnshared`

`writeUnshared` menulis object sebagai object baru yang tidak dibagi sebagai reference sebelumnya.

```java
out.writeUnshared(object);
```

`readUnshared` membaca object dengan ekspektasi bahwa object tersebut tidak menjadi shared reference.

```java
Object object = in.readUnshared();
```

Fitur ini jarang dipakai dalam aplikasi biasa. Gunakan hanya jika kamu benar-benar memahami object identity dalam stream.

Untuk kebanyakan aplikasi:

- gunakan `writeObject/readObject`, atau
- desain format eksplisit sendiri.

---

## 23. Primitive Data dalam Object Stream

`ObjectOutputStream` juga bisa menulis primitive:

```java
out.writeInt(123);
out.writeLong(999L);
out.writeUTF("hello");
out.writeObject(new Money("IDR", 1000));
```

Reader harus mengikuti urutan:

```java
int a = in.readInt();
long b = in.readLong();
String c = in.readUTF();
Money d = (Money) in.readObject();
```

Pattern ini bisa dipakai untuk membuat container format sederhana:

```java
out.writeInt(MAGIC);
out.writeInt(VERSION);
out.writeObject(payload);
```

Namun hati-hati:

- `writeUTF` punya format modified UTF-8 Java, bukan selalu sama dengan UTF-8 umum.
- Campuran primitive dan object membuat format semakin Java-specific.
- Untuk integration external, lebih baik format eksplisit yang terdokumentasi.

---

## 24. `ObjectStreamClass`

`ObjectStreamClass` merepresentasikan descriptor serialization class.

```java
import java.io.ObjectStreamClass;

ObjectStreamClass descriptor = ObjectStreamClass.lookup(CustomerSnapshot.class);
System.out.println(descriptor.getName());
System.out.println(descriptor.getSerialVersionUID());
```

Gunakan untuk diagnostic, bukan sebagai dependency desain utama.

Potential use:

- debugging serialVersionUID,
- migration investigation,
- tooling internal,
- audit serialized class.

---

## 25. `@Serial` Annotation

Sejak Java modern, gunakan `@Serial` untuk menandai member khusus serialization.

```java
import java.io.Serial;
import java.io.Serializable;

public final class InvoiceSnapshot implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    @Serial
    private Object readResolve() {
        return this;
    }
}
```

`@Serial` membantu compiler/tooling mengenali apakah member tersebut memang serialization-related.

Member yang umum diberi `@Serial`:

- `serialVersionUID`,
- `serialPersistentFields`,
- `writeObject`,
- `readObject`,
- `readObjectNoData`,
- `writeReplace`,
- `readResolve`.

---

## 26. `serialPersistentFields`

`serialPersistentFields` memungkinkan class mendefinisikan field serialized form secara eksplisit, berbeda dari field fisik class.

Contoh konsep:

```java
import java.io.*;

public final class PersonName implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    @Serial
    private static final ObjectStreamField[] serialPersistentFields = {
            new ObjectStreamField("fullName", String.class)
    };

    private String firstName;
    private String lastName;

    public PersonName(String firstName, String lastName) {
        this.firstName = firstName;
        this.lastName = lastName;
    }

    @Serial
    private void writeObject(ObjectOutputStream out) throws IOException {
        ObjectOutputStream.PutField fields = out.putFields();
        fields.put("fullName", firstName + " " + lastName);
        out.writeFields();
    }

    @Serial
    private void readObject(ObjectInputStream in)
            throws IOException, ClassNotFoundException {
        ObjectInputStream.GetField fields = in.readFields();
        String fullName = (String) fields.get("fullName", "");
        String[] parts = fullName.split(" ", 2);
        this.firstName = parts.length > 0 ? parts[0] : "";
        this.lastName = parts.length > 1 ? parts[1] : "";
    }
}
```

Ini advanced dan jarang dibutuhkan. Untuk immutable object, serialization proxy biasanya lebih bersih.

---

## 27. Records dan Serialization

Java records dapat implements `Serializable`.

```java
import java.io.Serial;
import java.io.Serializable;

public record PaymentSnapshot(
        String paymentId,
        long amountMinor,
        String currency
) implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    public PaymentSnapshot {
        if (paymentId == null || paymentId.isBlank()) {
            throw new IllegalArgumentException("paymentId must not be blank");
        }
        if (currency == null || currency.isBlank()) {
            throw new IllegalArgumentException("currency must not be blank");
        }
    }
}
```

Records lebih value-oriented, sehingga sering lebih cocok untuk snapshot DTO internal.

Namun tetap hati-hati:

- serialized form tetap Java-specific,
- compatibility tetap perlu dipikirkan,
- untrusted deserialization tetap berbahaya,
- record bukan magic solution untuk schema evolution.

---

## 28. Enum Serialization

Enum serialization punya aturan khusus.

```java
public enum TransferStatus {
    PENDING,
    IN_PROGRESS,
    COMPLETED,
    FAILED
}
```

Enum diserialisasi berdasarkan nama constant, bukan field biasa.

Implikasi:

- rename enum constant bisa merusak deserialization,
- menghapus enum constant bisa merusak data lama,
- menambah enum constant biasanya aman untuk data lama,
- custom field enum tidak dipakai seperti object biasa dalam serialized form.

Untuk long-lived persisted data, hati-hati menyimpan enum Java langsung. Kadang lebih aman menyimpan stable code:

```java
PENDING("P")
IN_PROGRESS("I")
COMPLETED("C")
FAILED("F")
```

Tetapi dengan Java serialization default, enum name tetap penting.

---

## 29. Serialization dan Immutability

Immutable class cocok untuk serialization jika invariant dijaga dengan benar.

Masalahnya:

- constructor tidak dipanggil saat deserialization,
- final field dapat diisi oleh serialization mechanism,
- invalid stream bisa menciptakan object dengan state tidak valid jika tidak divalidasi,
- mutable component di dalam immutable wrapper bisa bocor.

Contoh validasi:

```java
public final class DateRange implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final LocalDate start;
    private final LocalDate end;

    public DateRange(LocalDate start, LocalDate end) {
        this.start = Objects.requireNonNull(start);
        this.end = Objects.requireNonNull(end);
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end before start");
        }
    }

    @Serial
    private void readObject(ObjectInputStream in)
            throws IOException, ClassNotFoundException {
        in.defaultReadObject();
        if (start == null || end == null || end.isBefore(start)) {
            throw new InvalidObjectException("invalid date range");
        }
    }
}
```

Lebih baik lagi: serialization proxy.

---

## 30. Serialization dan Runtime Resource

Object yang merepresentasikan runtime resource biasanya tidak boleh diserialisasi langsung.

Buruk:

```java
public final class FileProcessor implements Serializable {
    private final Path input;
    private final InputStream stream;
    private final ExecutorService executor;
}
```

Masalah:

- `InputStream` adalah open resource, bukan logical state.
- `ExecutorService` adalah runtime scheduler, bukan persistent data.
- Setelah deserialization, resource tersebut tidak valid.
- Bahkan jika bisa diserialisasi, semantics-nya salah.

Desain yang lebih benar:

```java
public final class FileProcessorConfig implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final Path input;
    private final int parallelism;

    public FileProcessorConfig(Path input, int parallelism) {
        this.input = input;
        this.parallelism = parallelism;
    }
}
```

Lalu runtime resource dibuat ulang dari config:

```java
FileProcessor processor = FileProcessor.from(config);
```

Mental model:

> Serialize logical state, not live capability.

---

## 31. Serialization ke File dengan Atomic Replace

Pattern dasar:

```java
public static void writeSnapshot(Path file, Object snapshot) throws IOException {
    Path parent = file.toAbsolutePath().getParent();
    Path temp = Files.createTempFile(parent, file.getFileName().toString(), ".tmp");

    try {
        try (ObjectOutputStream out = new ObjectOutputStream(
                new BufferedOutputStream(Files.newOutputStream(temp)))) {
            out.writeObject(snapshot);
        }

        Files.move(temp, file,
                StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE);
    } catch (IOException | RuntimeException e) {
        try {
            Files.deleteIfExists(temp);
        } catch (IOException suppressed) {
            e.addSuppressed(suppressed);
        }
        throw e;
    }
}
```

Kenapa pakai temp + atomic move?

Karena direct write ke target bisa menghasilkan file setengah jadi jika process crash.

Namun jika butuh crash durability kuat, lihat Part 014:

- force file content,
- force directory metadata jika memungkinkan,
- pahami batas filesystem.

---

## 32. Serialization ke Byte Array

Pattern umum untuk testing atau transport internal:

```java
public static byte[] serializeToBytes(Object object) throws IOException {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    try (ObjectOutputStream out = new ObjectOutputStream(bytes)) {
        out.writeObject(object);
    }
    return bytes.toByteArray();
}

public static Object deserializeFromBytes(byte[] bytes)
        throws IOException, ClassNotFoundException {
    try (ObjectInputStream in = new ObjectInputStream(
            new ByteArrayInputStream(bytes))) {
        return in.readObject();
    }
}
```

Hati-hati:

- byte array berarti seluruh serialized data ada di memory,
- tidak cocok untuk data sangat besar,
- jangan deserialize bytes dari sumber tidak tepercaya,
- selalu validasi expected type.

Lebih aman:

```java
public static <T> T deserializeFromBytes(byte[] bytes, Class<T> expectedType)
        throws IOException, ClassNotFoundException {
    try (ObjectInputStream in = new ObjectInputStream(
            new ByteArrayInputStream(bytes))) {
        Object object = in.readObject();
        return expectedType.cast(object);
    }
}
```

---

## 33. Serialization lewat Network

Secara teknis bisa:

```java
try (Socket socket = new Socket(host, port);
     ObjectOutputStream out = new ObjectOutputStream(socket.getOutputStream());
     ObjectInputStream in = new ObjectInputStream(socket.getInputStream())) {

    out.writeObject(request);
    out.flush();

    Object response = in.readObject();
}
```

Tapi secara desain, ini biasanya tidak disarankan untuk service boundary modern.

Masalah:

- tight coupling ke class Java,
- sulit evolusi schema,
- sulit cross-language,
- rentan deserialization vulnerability,
- debugging sulit,
- observability payload buruk,
- backward compatibility rapuh,
- classpath harus kompatibel.

Untuk internal short-lived tool, mungkin masih bisa. Untuk public/internal service API jangka panjang, lebih baik:

- JSON untuk simplicity,
- Protobuf untuk schema dan compact binary,
- Avro untuk data pipeline,
- CBOR/MessagePack untuk binary structured data,
- custom binary frame jika butuh kontrol penuh.

---

## 34. EOF dan Membaca Banyak Object

Jika stream berisi banyak object tanpa jumlah awal:

```java
try (ObjectInputStream in = new ObjectInputStream(Files.newInputStream(path))) {
    while (true) {
        Object object = in.readObject();
        process(object);
    }
} catch (EOFException end) {
    // normal end of stream
}
```

Ini umum tetapi tidak selalu ideal.

Lebih baik menulis count jika jumlah diketahui:

```java
out.writeInt(events.size());
for (Event event : events) {
    out.writeObject(event);
}
```

Reader:

```java
int count = in.readInt();
for (int i = 0; i < count; i++) {
    Event event = (Event) in.readObject();
    process(event);
}
```

Untuk stream besar/unknown length, EOF loop boleh, tetapi pastikan:

- EOF benar-benar berarti end normal,
- corruption tidak tertelan sebagai EOF normal,
- ada checksum/manifest jika durability penting.

---

## 35. Exception Model

Serialization dapat melempar banyak exception.

| Exception | Umum terjadi ketika |
|---|---|
| `NotSerializableException` | Ada object reachable yang tidak serializable |
| `InvalidClassException` | `serialVersionUID` mismatch atau class invalid |
| `ClassNotFoundException` | Class serialized tidak ada di classpath reader |
| `StreamCorruptedException` | Stream bukan serialization stream valid atau header rusak |
| `OptionalDataException` | Primitive/object read order tidak cocok |
| `EOFException` | Stream habis sebelum data lengkap |
| `InvalidObjectException` | Validasi custom gagal |
| `WriteAbortedException` | Exception terjadi saat serialization dan dicatat dalam stream |

Jangan treat semua exception sama.

```java
try {
    Snapshot snapshot = readSnapshot(path);
    use(snapshot);
} catch (InvalidClassException e) {
    throw new SnapshotFormatException("Snapshot version is incompatible", e);
} catch (ClassNotFoundException e) {
    throw new SnapshotFormatException("Snapshot class is unavailable", e);
} catch (StreamCorruptedException e) {
    throw new SnapshotFormatException("Snapshot stream is corrupted", e);
} catch (IOException e) {
    throw new UncheckedIOException("Cannot read snapshot", e);
}
```

---

## 36. Designing Serializable Classes

Checklist desain class serializable:

### 36.1 Tentukan apakah class memang perlu serializable

Pertanyaan:

- Apakah object ini akan disimpan sebagai object Java?
- Apakah hanya untuk cache internal?
- Apakah ini melintasi service boundary?
- Apakah data harus hidup lebih lama dari versi aplikasi saat ini?
- Apakah ada alternatif format yang lebih cocok?

Jika melintasi boundary jangka panjang, Java serialization biasanya bukan pilihan terbaik.

### 36.2 Deklarasikan `serialVersionUID`

```java
@Serial
private static final long serialVersionUID = 1L;
```

### 36.3 Pisahkan logical state dan runtime state

```java
private final String id;
private transient Logger logger;
private transient ExecutorService executor;
```

### 36.4 Validasi ulang saat deserialize

```java
@Serial
private void readObject(ObjectInputStream in)
        throws IOException, ClassNotFoundException {
    in.defaultReadObject();
    validate();
}
```

### 36.5 Pertimbangkan serialization proxy untuk immutable object

Terutama jika invariant penting.

### 36.6 Jangan serialize dependency injection object

Buruk:

```java
private UserRepository repository;
```

Lebih baik serialize ID/config/snapshot.

### 36.7 Dokumentasikan serialized form

Jika class dipersist jangka panjang, dokumentasikan field yang menjadi bagian format.

---

## 37. Anti-Pattern

### 37.1 `implements Serializable` karena IDE menyarankan

Buruk:

```java
public class Everything implements Serializable {
    private Service service;
    private Socket socket;
    private Thread thread;
}
```

Masalah:

- tidak jelas state apa yang ingin dipersist,
- runtime resource ikut graph,
- kemungkinan `NotSerializableException`,
- class menjadi punya compatibility contract tanpa sadar.

### 37.2 Serialize entity JPA langsung

Buruk:

```java
out.writeObject(orderEntity);
```

Risiko:

- lazy proxy,
- bidirectional graph besar,
- sensitive field ikut tertulis,
- persistence concern bocor,
- schema evolution kacau.

Lebih baik snapshot DTO:

```java
OrderSnapshot snapshot = OrderSnapshot.from(order);
out.writeObject(snapshot);
```

### 37.3 Serialize object untuk external API

Buruk untuk service boundary:

```text
Service A Java object serialization → Service B
```

Masalah:

- coupling classpath,
- security,
- compatibility,
- cross-language impossible,
- debugging sulit.

### 37.4 Tidak validasi `readObject`

Buruk:

```java
private void readObject(ObjectInputStream in)
        throws IOException, ClassNotFoundException {
    in.defaultReadObject();
}
```

Jika invariant penting, validasi harus ada.

### 37.5 Menganggap `transient` berarti secure

`transient` hanya berarti default serialization tidak menulis field itu. Bukan solusi enkripsi, masking, atau secure storage.

---

## 38. Production Use Cases yang Masih Masuk Akal

Walaupun Java serialization sering dihindari untuk boundary modern, masih ada use case terbatas.

### 38.1 Short-lived internal cache

Misal cache lokal hanya dibaca oleh versi aplikasi yang sama.

Syarat:

- bukan input untrusted,
- bisa dihapus saat gagal,
- tidak menjadi format kontrak jangka panjang,
- ada fallback rebuild.

### 38.2 Test fixture internal

Menyimpan object graph untuk test tertentu.

Tetap hati-hati karena fixture bisa rapuh saat class berubah.

### 38.3 Legacy interoperability

Sistem lama mungkin sudah memakai serialization.

Strategi:

- batasi boundary,
- tambahkan filter,
- migrasikan perlahan,
- buat adapter ke format eksplisit,
- dokumentasikan class yang diizinkan.

### 38.4 In-memory deep copy legacy

Kadang serialization dipakai untuk deep copy.

```java
T copy = deserialize(serialize(original));
```

Ini biasanya lambat dan fragile. Lebih baik copy constructor, mapper, atau immutable data structure.

---

## 39. Serialization Decision Matrix

| Situasi | Java serialization? | Alasan |
|---|---:|---|
| Persist cache lokal sementara | Mungkin | Jika bisa invalidasi dan bukan untrusted |
| Public API | Tidak | Security, compatibility, cross-language |
| Microservice internal API | Umumnya tidak | Tight coupling dan operational risk |
| Long-term file archive | Tidak disarankan | Class evolution rapuh |
| Short-lived Java-only tool | Bisa | Jika scope terbatas |
| Object graph kompleks dengan cycles | Bisa secara teknis | Tapi pertimbangkan format dan risk |
| Data pipeline | Tidak | Avro/Parquet/JSON/CSV lebih tepat |
| Secure boundary | Tidak | Deserialization risk |
| Snapshot DTO internal | Mungkin | Jika class stabil dan lifecycle jelas |

---

## 40. Mental Model: Serialization sebagai Hidden Constructor

Cara paling sehat memandang deserialization:

> Deserialization adalah jalur konstruksi object alternatif yang melewati constructor normal.

Artinya setiap class serializable punya minimal dua jalur penciptaan:

```text
Normal construction:
    constructor/factory → invariant checked → object valid

Deserialization:
    byte stream → allocate object → set fields → optional readObject/readResolve → object maybe valid
```

Jika jalur kedua tidak divalidasi, class tidak benar-benar menjaga invariant.

Untuk class penting, jangan puas dengan:

```java
implements Serializable
```

Tanyakan:

```text
Can a malicious/corrupt/old stream create an invalid instance?
```

Jika jawabannya ya, class butuh validasi atau proxy.

---

## 41. Failure Model

Serialization failure harus dipahami sebagai beberapa kategori.

### 41.1 Graph failure

Contoh:

- object reachable tidak serializable,
- graph terlalu besar,
- cyclic graph dengan custom serialization salah,
- object identity tidak sengaja diputus oleh `reset()`.

### 41.2 Class compatibility failure

Contoh:

- `serialVersionUID` berubah,
- field type berubah,
- class pindah package,
- class tidak ada di classpath.

### 41.3 Stream corruption failure

Contoh:

- file partial write,
- stream header rusak,
- append header dobel,
- compression layer salah,
- read/write order mismatch.

### 41.4 Invariant failure

Contoh:

- field required menjadi null,
- range invalid,
- enum value hilang,
- derived state tidak diinisialisasi ulang.

### 41.5 Security failure

Dibahas mendalam di Part 017, tetapi sejak sekarang ingat:

- jangan deserialize untrusted data,
- object graph bisa memicu eksekusi code lewat hook/gadget,
- filter dan allowlist sangat penting untuk legacy boundary.

---

## 42. Performance Notes

Java serialization tidak didesain sebagai format paling cepat/compact untuk semua workload.

Faktor performa:

- reflection/internal metadata,
- class descriptor overhead,
- handle table,
- graph traversal,
- allocation saat deserialization,
- object churn,
- large graph memory pressure,
- buffering underlying stream.

Tips:

1. Bungkus file/socket stream dengan buffering.
2. Gunakan `reset()` untuk stream panjang jika identity antar record tidak diperlukan.
3. Jangan serialize entity graph besar tanpa batas.
4. Jangan pakai serialization untuk high-throughput protocol baru.
5. Ukur ukuran output dan latency sebelum memilih.
6. Untuk format performa tinggi, evaluasi Protobuf/FlatBuffers/custom binary.

---

## 43. Security Notes Singkat

Part 017 akan deep dive security, tetapi minimum rule di sini:

> Treat deserialization as dangerous input parsing plus object construction.

Rule praktis:

- Jangan deserialize dari user input langsung.
- Jangan deserialize dari network tanpa filter.
- Jangan deserialize dari file yang bisa dimodifikasi pihak lain.
- Jangan menganggap cast type cukup aman.
- Jangan mengandalkan `transient` untuk security.
- Jangan biarkan classpath berisi gadget library berbahaya tanpa mitigasi.
- Gunakan `ObjectInputFilter` untuk legacy deserialization.

---

## 44. Testing Serializable Classes

Minimal test:

```java
import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class SerializationTest {
    @Test
    void shouldRoundTripMoney() throws Exception {
        Money original = new Money("IDR", 10_000L);

        byte[] bytes = SerializationTestSupport.serialize(original);
        Money restored = SerializationTestSupport.deserialize(bytes, Money.class);

        assertEquals(original.currency(), restored.currency());
        assertEquals(original.minorUnits(), restored.minorUnits());
    }
}
```

Helper:

```java
final class SerializationTestSupport {
    private SerializationTestSupport() {
    }

    static byte[] serialize(Object object) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ObjectOutputStream out = new ObjectOutputStream(bytes)) {
            out.writeObject(object);
        }
        return bytes.toByteArray();
    }

    static <T> T deserialize(byte[] bytes, Class<T> type)
            throws IOException, ClassNotFoundException {
        try (ObjectInputStream in = new ObjectInputStream(
                new ByteArrayInputStream(bytes))) {
            return type.cast(in.readObject());
        }
    }
}
```

Test tambahan untuk class penting:

- invalid state ditolak di `readObject`,
- `readResolve` menjaga singleton/canonicalization,
- transient field diinisialisasi ulang,
- shared reference tetap shared jika dibutuhkan,
- cyclic graph pulih,
- class lama masih bisa dibaca jika compatibility dijanjikan.

---

## 45. Mini Case Study: Snapshot Internal yang Aman Secara Reasonable

Kebutuhan:

Sebuah batch job ingin menyimpan checkpoint lokal agar bisa resume jika process restart.

Data:

- job id,
- input file path,
- last processed offset,
- processed record count,
- checksum manifest version.

Class:

```java
import java.io.*;
import java.nio.file.Path;
import java.util.Objects;

public final class ImportCheckpoint implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String jobId;
    private final Path inputFile;
    private final long byteOffset;
    private final long processedRecords;
    private final int manifestVersion;

    public ImportCheckpoint(
            String jobId,
            Path inputFile,
            long byteOffset,
            long processedRecords,
            int manifestVersion
    ) {
        this.jobId = requireNonBlank(jobId, "jobId");
        this.inputFile = Objects.requireNonNull(inputFile, "inputFile");
        if (byteOffset < 0) throw new IllegalArgumentException("byteOffset must be >= 0");
        if (processedRecords < 0) throw new IllegalArgumentException("processedRecords must be >= 0");
        if (manifestVersion <= 0) throw new IllegalArgumentException("manifestVersion must be > 0");
        this.byteOffset = byteOffset;
        this.processedRecords = processedRecords;
        this.manifestVersion = manifestVersion;
    }

    @Serial
    private void readObject(ObjectInputStream in)
            throws IOException, ClassNotFoundException {
        in.defaultReadObject();

        if (jobId == null || jobId.isBlank()) throw new InvalidObjectException("jobId must not be blank");
        if (inputFile == null) throw new InvalidObjectException("inputFile must not be null");
        if (byteOffset < 0) throw new InvalidObjectException("byteOffset must be >= 0");
        if (processedRecords < 0) throw new InvalidObjectException("processedRecords must be >= 0");
        if (manifestVersion <= 0) throw new InvalidObjectException("manifestVersion must be > 0");
    }

    private static String requireNonBlank(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
```

Writer dengan atomic replace:

```java
public final class CheckpointStore {
    public void save(Path target, ImportCheckpoint checkpoint) throws IOException {
        Path directory = target.toAbsolutePath().getParent();
        Path temp = Files.createTempFile(directory, target.getFileName().toString(), ".tmp");

        try {
            try (FileOutputStream fos = new FileOutputStream(temp.toFile());
                 BufferedOutputStream bos = new BufferedOutputStream(fos);
                 ObjectOutputStream out = new ObjectOutputStream(bos)) {
                out.writeObject(checkpoint);
                out.flush();
                fos.getFD().sync();
            }

            Files.move(temp, target,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException | RuntimeException e) {
            try {
                Files.deleteIfExists(temp);
            } catch (IOException suppressed) {
                e.addSuppressed(suppressed);
            }
            throw e;
        }
    }

    public ImportCheckpoint load(Path source)
            throws IOException, ClassNotFoundException {
        try (ObjectInputStream in = new ObjectInputStream(
                new BufferedInputStream(Files.newInputStream(source)))) {
            Object object = in.readObject();
            return ImportCheckpoint.class.cast(object);
        }
    }
}
```

Kenapa use case ini masih reasonable?

- file lokal internal,
- bukan input user,
- bisa dihapus/rebuild jika incompatible,
- class kecil dan eksplisit,
- invariant divalidasi,
- write atomic.

Tetap, jika checkpoint harus kompatibel lintas versi lama atau dianalisis tools lain, JSON/CBOR/Protobuf bisa lebih baik.

---

## 46. Checklist Praktis

Sebelum memakai Java serialization, jawab:

```text
[ ] Apakah ini benar-benar perlu Java object serialization?
[ ] Apakah data tidak berasal dari sumber untrusted?
[ ] Apakah format ini tidak perlu cross-language?
[ ] Apakah lifecycle data pendek atau migration plan jelas?
[ ] Apakah semua class reachable memang layak serializable?
[ ] Apakah serialVersionUID dideklarasikan eksplisit?
[ ] Apakah runtime resource diberi transient?
[ ] Apakah invariant divalidasi saat readObject/readResolve?
[ ] Apakah ada test round-trip?
[ ] Apakah ada test compatibility jika format disimpan jangka panjang?
[ ] Apakah stream ditulis secara atomic jika ke file?
[ ] Apakah stream besar memakai reset bila perlu?
[ ] Apakah deserialization filter direncanakan untuk boundary berisiko?
```

---

## 47. Ringkasan

Java Object Serialization adalah mekanisme untuk menyimpan dan memulihkan object graph Java ke/dari byte stream.

Poin inti:

1. Serialization bekerja di atas byte stream.
2. Ia menyimpan object graph, bukan sekadar value tree.
3. Ia menjaga object identity dan cyclic reference melalui handle table.
4. `Serializable` adalah marker interface, tetapi membawa konsekuensi compatibility contract.
5. `ObjectOutputStream` menulis object, descriptor, field, dan reference.
6. `ObjectInputStream` merekonstruksi object tanpa memanggil constructor serializable class.
7. Karena constructor bisa dilewati, invariant harus divalidasi ulang.
8. `transient` memisahkan runtime state dari persistent state.
9. `writeObject/readObject`, `writeReplace/readResolve`, dan serialization proxy memberi kontrol lebih kuat.
10. `Externalizable` memberi kontrol penuh tetapi lebih mudah salah.
11. `reset()` penting untuk stream panjang agar handle table tidak tumbuh tanpa batas.
12. Java serialization masih berguna untuk scope terbatas, tetapi buruk untuk service boundary modern dan input untrusted.

Mental model terakhir:

```text
Serialization = object graph traversal + class descriptor + field state + reference identity + alternative object construction path.
```

Jika kamu mengingat satu hal saja:

> Java serialization terlihat seperti API sederhana, tetapi sebenarnya ia membuka jalur konstruksi object yang berbeda dari constructor normal. Karena itu, desain serializable class harus memperhatikan invariant, lifecycle, compatibility, dan trust boundary.

---

## 48. Latihan

### Latihan 1 — Shared Reference

Buat class:

```text
User
Approval(requester, approver)
```

Serialize `Approval` dengan requester dan approver menunjuk object yang sama. Deserialize dan buktikan `requester == approver`.

### Latihan 2 — Cyclic Graph

Buat tree node dengan parent-child reference. Serialize root dan deserialize. Pastikan child.parent menunjuk root hasil deserialization.

### Latihan 3 — Invariant Bypass

Buat class `DateRange(start, end)` yang menolak `end < start` di constructor. Tambahkan `readObject` untuk validasi. Coba manipulasi test agar invalid object tidak lolos.

### Latihan 4 — `transient` Runtime State

Buat class yang punya transient cache. Setelah deserialize, rebuild cache secara lazy.

### Latihan 5 — Stream Panjang

Serialize 1 juta object kecil ke satu `ObjectOutputStream`. Bandingkan memory behavior dengan dan tanpa `out.reset()` setiap 10.000 object.

### Latihan 6 — Header Append Problem

Coba append object menggunakan `new ObjectOutputStream(... APPEND ...)` dua kali. Amati error saat membaca. Lalu buat custom append stream yang override `writeStreamHeader`.

---

## 49. Koneksi ke Part Berikutnya

Part 016 membahas arsitektur dan mekanisme serialization.

Part 017 akan membahas sisi yang lebih berbahaya dan production-critical:

```text
Serialization II: Versioning, Compatibility, Security, dan Kenapa Deserialization Berbahaya
```

Topik utama Part 017:

- compatible vs incompatible class evolution,
- `serialVersionUID` strategy,
- field evolution,
- `readObjectNoData`,
- serialization proxy lebih dalam,
- gadget chain,
- untrusted deserialization,
- `ObjectInputFilter`,
- allowlist vs denylist,
- migrasi dari Java serialization ke format aman.
