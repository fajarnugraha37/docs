# Part 017 — Serialization II: Versioning, Compatibility, Security, dan Kenapa Deserialization Berbahaya

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-017.md`  
> Status seri: **belum selesai**  
> Part sebelumnya: Part 016 — Serialization I: Java Object Serialization Architecture, Object Graph, Identity, dan Format  
> Part berikutnya: Part 018 — Compression: ZIP, GZIP, Deflater, Inflater, Tar Concept, dan Streaming Compression

---

## 1. Tujuan Pembelajaran

Di Part 016 kita sudah membedah Java Object Serialization dari sisi arsitektur dasar: `Serializable`, `Externalizable`, `ObjectOutputStream`, `ObjectInputStream`, object graph, object identity, handle table, `serialVersionUID`, callback `writeObject/readObject`, `writeReplace/readResolve`, dan bagaimana satu stream serialization bukan hanya berisi data mentah, tetapi juga metadata class, reference, object graph, dan state internal serialization runtime.

Part ini melangkah ke area yang lebih kritis: **apa yang terjadi ketika class berubah, aplikasi berevolusi, data serialized lama masih tersimpan, atau stream serialization datang dari boundary yang tidak sepenuhnya dipercaya**.

Setelah menyelesaikan part ini, target pemahamanmu adalah:

1. Memahami bahwa serialization compatibility berbeda dari source compatibility dan binary compatibility.
2. Bisa membedakan perubahan class yang relatif aman, berisiko, dan incompatible untuk Java serialization.
3. Mengerti peran `serialVersionUID` secara tepat: bukan versi bisnis, bukan migration engine, tetapi compatibility gate.
4. Mampu mendesain class serializable yang evolvable dengan invariant jelas.
5. Memahami kenapa `readObject` adalah constructor tersembunyi yang sangat berbahaya bila salah dipakai.
6. Mengerti kenapa deserialization data tidak tepercaya adalah risiko security serius.
7. Bisa memakai `ObjectInputFilter` untuk membatasi tipe, depth, jumlah reference, ukuran array, dan ukuran stream.
8. Bisa menentukan kapan native Java serialization masih layak, kapan harus dihindari, dan apa alternatifnya.
9. Mampu membuat checklist engineering untuk legacy system yang masih memakai Java serialization.

Part ini bukan bertujuan membuatmu “semakin suka” native Java serialization. Justru sebaliknya: setelah memahami mekanismenya, kamu harus bisa memperlakukan serialization sebagai primitive yang **sangat kuat, sangat convenient, tetapi berbahaya jika melewati trust boundary**.

---

## 2. Big Mental Model: Serialization adalah Constructor + Reflection + Protocol + Class Evolution Layer

Cara paling aman memahami deserialization adalah ini:

```text
Serialized bytes
      |
      v
ObjectInputStream
      |
      v
Class resolution + allocation without normal constructor
      |
      v
Field population + callback invocation
      |
      v
Object graph reconstruction
      |
      v
Application object enters runtime
```

Masalahnya: ketika object masuk runtime, developer sering memperlakukannya seolah-olah object itu dibuat lewat constructor normal, padahal tidak selalu begitu.

Pada Java serialization:

- constructor class `Serializable` biasanya **tidak dipanggil** saat deserialization;
- field bisa diisi langsung dari stream;
- private field bisa dipulihkan;
- object graph bisa cyclic;
- callback seperti `readObject`, `readResolve`, `validateObject` bisa berjalan;
- class dalam classpath bisa ikut terlibat meskipun application code tidak eksplisit memanggil constructor-nya;
- object dari dependency library juga bisa dibuat jika stream mengandung descriptor yang cocok.

Maka deserialization bukan sekadar parsing data. Ia adalah **runtime object reconstruction mechanism**.

Itulah sebabnya topik ini punya dua sisi besar:

1. **Compatibility problem**: apakah bytes lama masih bisa dibaca setelah class berubah?
2. **Security problem**: apakah bytes dari luar boleh menentukan object apa yang dibuat dan callback apa yang berjalan?

---

## 3. Serialization Compatibility Bukan Source Compatibility

Di Java, kita biasa mengenal beberapa jenis compatibility:

| Jenis Compatibility | Pertanyaan Utama |
|---|---|
| Source compatibility | Apakah source code lama masih bisa dikompilasi dengan API baru? |
| Binary compatibility | Apakah class lama masih bisa link/run dengan class baru tanpa recompile? |
| Behavioral compatibility | Apakah behavior masih sesuai ekspektasi lama? |
| Serialization compatibility | Apakah serialized bytes lama masih bisa dibaca oleh class versi baru, dan sebaliknya jika diperlukan? |

Serialization compatibility punya aturan sendiri karena object state disimpan sebagai external representation.

Contoh:

```java
public final class User implements Serializable {
    private static final long serialVersionUID = 1L;

    private String username;
}
```

Lalu berubah menjadi:

```java
public final class User implements Serializable {
    private static final long serialVersionUID = 1L;

    private String username;
    private String displayName;
}
```

Secara source dan binary, ini mungkin aman. Secara serialization, field baru `displayName` akan mendapat default value `null` saat membaca stream lama. Itu bisa kompatibel secara teknis, tetapi belum tentu kompatibel secara invariant bisnis.

Kalau invariant baru berkata `displayName` wajib non-null, maka class ini technically deserializable tetapi semantically broken.

Inilah point penting:

> Serialization compatibility bukan hanya “tidak exception”. Object yang berhasil dibuat juga harus valid menurut invariant versi baru.

---

## 4. `serialVersionUID`: Gate Compatibility, Bukan Migration Engine

`serialVersionUID` adalah angka `long` yang dipakai serialization runtime untuk memverifikasi apakah class lokal kompatibel dengan class descriptor dalam stream.

Contoh canonical:

```java
public final class AccountSnapshot implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String accountId;
    private final long balanceInCents;

    public AccountSnapshot(String accountId, long balanceInCents) {
        this.accountId = Objects.requireNonNull(accountId, "accountId");
        this.balanceInCents = balanceInCents;
    }
}
```

Jika stream berisi `serialVersionUID = 1L` dan class lokal juga `1L`, runtime menganggap keduanya kompatibel secara deklaratif. Jika berbeda, biasanya akan terjadi `InvalidClassException`.

Namun `serialVersionUID` tidak:

- memigrasikan field;
- mengubah data lama;
- menjamin invariant object;
- menjamin semantic compatibility;
- menjamin security;
- menjamin dependency class aman;
- menggantikan schema evolution.

`serialVersionUID` hanya menjawab:

```text
Apakah runtime boleh mencoba membaca stream ini memakai class lokal ini?
```

Bukan:

```text
Apakah hasil object pasti benar?
```

### 4.1 Kenapa Harus Deklarasikan `serialVersionUID` Secara Eksplisit?

Jika tidak dideklarasikan, JVM menghitung default `serialVersionUID` dari detail class. Masalahnya, default computation sensitif terhadap detail implementasi class. Perubahan yang terlihat kecil bisa mengubah UID dan membuat data lama tidak bisa dibaca.

Bad:

```java
public class UserSession implements Serializable {
    private String userId;
    private Instant loginAt;
}
```

Better:

```java
public class UserSession implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private String userId;
    private Instant loginAt;
}
```

Rule praktis:

> Setiap class `Serializable` yang memang sengaja serializable harus mendeklarasikan `serialVersionUID` eksplisit.

Kalau class tidak dimaksudkan menjadi format stabil, jangan sembarangan `implements Serializable`.

---

## 5. Compatible vs Incompatible Changes

Serialization specification membagi perubahan class menjadi yang kompatibel dan tidak kompatibel. Namun sebagai engineer, kita perlu membedakan tiga level:

| Level | Makna |
|---|---|
| Runtime-compatible | ObjectInputStream bisa membaca tanpa exception besar. |
| Semantically-compatible | Object hasil baca masih memenuhi invariant. |
| Operationally-compatible | Aman di production: tidak merusak cache, session, queue, atau persisted object lama. |

### 5.1 Perubahan yang Umumnya Bisa Kompatibel

#### 5.1.1 Menambah Field Non-Primitive atau Primitive

Versi 1:

```java
public final class ExportJob implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private String jobId;
    private String status;
}
```

Versi 2:

```java
public final class ExportJob implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private String jobId;
    private String status;
    private int retryCount;
}
```

Stream lama tidak punya `retryCount`, maka nilainya menjadi default `0`. Ini sering aman jika `0` memang default yang valid.

Tetapi kalau field baru:

```java
private Instant expiresAt;
```

maka stream lama menghasilkan `expiresAt == null`. Kalau code baru mengasumsikan non-null, bug muncul.

Solusi: custom `readObject` untuk memperbaiki default.

```java
@Serial
private void readObject(ObjectInputStream in) throws IOException, ClassNotFoundException {
    in.defaultReadObject();

    if (expiresAt == null) {
        expiresAt = Instant.EPOCH; // atau default yang benar secara domain
    }
}
```

Namun hati-hati: jika field `final`, perbaikan di `readObject` lebih rumit dan desain harus dipikir ulang.

#### 5.1.2 Menghapus Field

Versi lama:

```java
private String legacyCode;
```

Versi baru menghapus field tersebut. Data lama yang punya field itu biasanya bisa dibaca; field di stream yang tidak ada di class lokal akan diabaikan.

Tetapi ini hanya aman jika field tersebut tidak lagi dibutuhkan untuk invariant baru.

#### 5.1.3 Mengubah Method Biasa

Menambah, menghapus, atau mengubah method biasa biasanya tidak langsung merusak stream format, karena serialization default berfokus pada field serializable, bukan method biasa.

Tetapi behavior object setelah deserialization bisa berubah karena method baru membaca field lama dengan cara baru.

#### 5.1.4 Menambah `writeObject/readObject`

Bisa kompatibel jika dilakukan hati-hati. Namun perubahan ini dapat mengubah format custom data dalam stream untuk object baru.

Jika versi lama memakai default serialization dan versi baru menambah custom data, pastikan logic membaca versi lama masih bisa.

---

### 5.2 Perubahan yang Umumnya Incompatible atau Sangat Berisiko

#### 5.2.1 Mengubah Tipe Field

Versi 1:

```java
private int amount;
```

Versi 2:

```java
private long amount;
```

Walaupun secara domain masuk akal, stream serialization melihat field type sebagai bagian dari descriptor. Mengubah tipe field bisa membuat data lama tidak cocok.

Migration yang lebih aman:

```java
public final class Payment implements Serializable {
    @Serial
    private static final long serialVersionUID = 2L;

    // legacy field tetap ada sementara
    private int amount;

    // field baru
    private long amountInCents;
}
```

Atau gunakan `serialPersistentFields` untuk mengontrol field serializable secara eksplisit.

#### 5.2.2 Mengubah Class dari Serializable ke Non-Serializable

Jika class lama serializable dan data lama disimpan, lalu class baru tidak lagi serializable, stream lama tidak bisa dipulihkan seperti biasa.

#### 5.2.3 Mengubah Hierarchy Secara Signifikan

Menambah, menghapus, atau mengubah superclass serializable/non-serializable bisa berpengaruh besar karena serialization memperlakukan hierarchy dengan aturan khusus.

Masalah umum:

- superclass baru tidak punya no-arg constructor;
- field pindah dari subclass ke superclass;
- class yang tadinya serializable menjadi externalizable;
- class yang tadinya bukan enum menjadi enum;
- package/class name berubah.

#### 5.2.4 Mengubah Nama Class atau Package

Serialized stream menyimpan class name. Jika class pindah package, stream lama mencari class lama. Ini bukan sekadar refactor aman.

Contoh:

```text
com.old.UserSession
```

berubah menjadi:

```text
com.new.UserSession
```

Bagi Java serialization, itu class berbeda.

Mitigasi:

- jangan gunakan native serialization untuk long-term persisted data;
- sediakan compatibility class lama;
- custom `ObjectInputStream.resolveClass` jika benar-benar perlu migration;
- lakukan offline migration;
- gunakan format schema-based untuk storage jangka panjang.

#### 5.2.5 Mengubah `serialVersionUID`

Mengubah UID secara sengaja berarti kamu memutus compatibility gate. Itu boleh jika memang ingin menolak data lama.

Namun jangan menjadikan UID sebagai “nomor versi setiap release”. Jika setiap release mengubah UID, semua serialized data lama invalid.

Better mental model:

```text
serialVersionUID tetap sama selama format serialized masih bisa dibaca secara aman.
serialVersionUID berubah ketika format lama memang harus ditolak.
```

---

## 6. Versioning Strategy yang Realistis

Ada beberapa strategi evolusi class serializable.

### 6.1 Strategy A — Compatibility by Discipline

Cocok untuk session object internal, cache internal, atau data transient yang lifetime-nya pendek.

Aturan:

- deklarasikan `serialVersionUID` eksplisit;
- perubahan field dilakukan konservatif;
- field baru harus punya default aman;
- `readObject` memperbaiki invariant;
- hindari refactor package/class name;
- data lama boleh expire cepat.

Kelebihan:

- simple;
- cocok untuk object internal pendek umur.

Kekurangan:

- rapuh untuk long-term storage;
- sulit audit;
- sulit cross-language;
- rawan bug saat refactor.

### 6.2 Strategy B — Serialization Proxy Pattern

Cocok untuk immutable object, object dengan invariant kuat, atau class yang tidak ingin expose internal representation.

Prinsipnya:

- object asli tidak diserialisasi langsung;
- `writeReplace` mengganti object dengan proxy sederhana;
- proxy punya `readResolve` untuk memanggil constructor/factory normal;
- `readObject` di class asli menolak deserialization langsung.

Contoh:

```java
public final class Money implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final String currency;
    private final long cents;

    public Money(String currency, long cents) {
        this.currency = validateCurrency(currency);
        this.cents = cents;
    }

    private static String validateCurrency(String currency) {
        if (currency == null || !currency.matches("[A-Z]{3}")) {
            throw new IllegalArgumentException("Invalid currency: " + currency);
        }
        return currency;
    }

    @Serial
    private Object writeReplace() {
        return new SerializationProxy(this);
    }

    @Serial
    private void readObject(ObjectInputStream in) throws InvalidObjectException {
        throw new InvalidObjectException("Use SerializationProxy");
    }

    private static final class SerializationProxy implements Serializable {
        @Serial
        private static final long serialVersionUID = 1L;

        private final String currency;
        private final long cents;

        SerializationProxy(Money money) {
            this.currency = money.currency;
            this.cents = money.cents;
        }

        @Serial
        private Object readResolve() throws ObjectStreamException {
            return new Money(currency, cents);
        }
    }
}
```

Kelebihan:

- invariant dilewatkan ke constructor/factory normal;
- representation serialized bisa dibuat sederhana;
- internal field bisa berubah tanpa mengubah serialized form;
- lebih aman untuk immutable object.

Kekurangan:

- lebih verbose;
- perlu disiplin;
- tidak selalu cocok untuk complex cyclic graph.

### 6.3 Strategy C — `serialPersistentFields`

`serialPersistentFields` memungkinkan class mendefinisikan field serializable secara eksplisit, berbeda dari field fisik class.

Contoh:

```java
public final class CustomerRecord implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    @Serial
    private static final ObjectStreamField[] serialPersistentFields = {
            new ObjectStreamField("id", String.class),
            new ObjectStreamField("name", String.class)
    };

    private String customerId;
    private String displayName;

    @Serial
    private void writeObject(ObjectOutputStream out) throws IOException {
        ObjectOutputStream.PutField fields = out.putFields();
        fields.put("id", customerId);
        fields.put("name", displayName);
        out.writeFields();
    }

    @Serial
    private void readObject(ObjectInputStream in) throws IOException, ClassNotFoundException {
        ObjectInputStream.GetField fields = in.readFields();
        this.customerId = (String) fields.get("id", null);
        this.displayName = (String) fields.get("name", null);

        if (customerId == null) {
            throw new InvalidObjectException("customerId is required");
        }
        if (displayName == null) {
            displayName = customerId;
        }
    }
}
```

Ini berguna saat:

- nama field internal berubah;
- representation internal berubah;
- ingin mempertahankan serialized schema lama.

Namun ini membuat class lebih kompleks. Gunakan hanya bila memang perlu compatibility dengan serialized Java stream.

### 6.4 Strategy D — Stop Using Native Serialization for Long-Term Data

Untuk long-term storage, external API, message queue, file exchange, atau cross-service boundary, strategi terbaik biasanya:

```text
Jangan gunakan native Java serialization.
```

Gunakan format yang punya schema atau representation eksplisit:

- JSON untuk human-readable payload dan interoperability;
- CBOR/Smile/MessagePack untuk binary compact representation;
- Protocol Buffers untuk schema evolution yang kuat;
- Avro untuk data pipeline dan schema registry style;
- FlatBuffers/Cap'n Proto untuk use case tertentu;
- custom binary format jika butuh kontrol penuh dan siap menanggung kompleksitas.

Native serialization cocoknya lebih sempit:

- internal-only;
- trusted boundary;
- short-lived data;
- tidak cross-language;
- class evolution terkendali;
- object graph identity benar-benar dibutuhkan.

---

## 7. `readObject` adalah Constructor Tersembunyi

Salah satu kesalahan mental terbesar adalah menganggap `readObject` sebagai “method biasa”. Lebih tepat:

> `readObject` adalah bagian dari construction path saat object dibangun dari bytes.

Karena constructor normal class serializable tidak dipanggil, `readObject` harus bertanggung jawab mengembalikan invariant object.

### 7.1 Invariant yang Hilang Saat Deserialization

Contoh class biasa:

```java
public final class DateRange implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private Instant start;
    private Instant end;

    public DateRange(Instant start, Instant end) {
        this.start = Objects.requireNonNull(start, "start");
        this.end = Objects.requireNonNull(end, "end");
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
    }
}
```

Constructor menjamin:

```text
start != null
end != null
end >= start
```

Tetapi deserialization dapat mengisi field langsung dari stream. Jika stream corrupt atau malicious, object bisa dibuat dengan:

```text
start = null
end = null
```

atau:

```text
end < start
```

Solusi:

```java
@Serial
private void readObject(ObjectInputStream in) throws IOException, ClassNotFoundException {
    in.defaultReadObject();

    if (start == null) {
        throw new InvalidObjectException("start is required");
    }
    if (end == null) {
        throw new InvalidObjectException("end is required");
    }
    if (end.isBefore(start)) {
        throw new InvalidObjectException("end must not be before start");
    }
}
```

### 7.2 Defensive Copy Saat Deserialization

Jika class menyimpan mutable object, constructor sering melakukan defensive copy.

```java
public final class Payload implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private byte[] bytes;

    public Payload(byte[] bytes) {
        this.bytes = bytes.clone();
    }

    public byte[] bytes() {
        return bytes.clone();
    }
}
```

Saat deserialization, field `bytes` diisi dari stream. Kita perlu validasi dan defensive normalization:

```java
@Serial
private void readObject(ObjectInputStream in) throws IOException, ClassNotFoundException {
    in.defaultReadObject();

    if (bytes == null) {
        throw new InvalidObjectException("bytes is required");
    }
    if (bytes.length > 10 * 1024 * 1024) {
        throw new InvalidObjectException("payload too large");
    }

    bytes = bytes.clone();
}
```

Meskipun array yang datang dari stream adalah object baru, defensive clone tetap bisa berguna untuk menjaga prinsip ownership dan mencegah aliasing internal jika logic custom lebih kompleks.

### 7.3 Jangan Panggil Overridable Method dari `readObject`

Sama seperti constructor, `readObject` tidak boleh memanggil method yang bisa dioverride. Saat deserialization, object mungkin belum stabil.

Bad:

```java
@Serial
private void readObject(ObjectInputStream in) throws IOException, ClassNotFoundException {
    in.defaultReadObject();
    validate(); // jika validate bisa dioverride, bahaya
}
```

Better:

```java
@Serial
private void readObject(ObjectInputStream in) throws IOException, ClassNotFoundException {
    in.defaultReadObject();
    validateState();
}

private void validateState() throws InvalidObjectException {
    if (id == null) {
        throw new InvalidObjectException("id is required");
    }
}
```

---

## 8. `readResolve` dan Singleton/Canonical Object

`readResolve` dipakai untuk mengganti object yang baru dideserialize dengan object lain.

Use case:

- singleton;
- enum-like object lama sebelum enum;
- canonical instance;
- serialization proxy.

Contoh singleton:

```java
public final class AppConfigMarker implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    public static final AppConfigMarker INSTANCE = new AppConfigMarker();

    private AppConfigMarker() {
    }

    @Serial
    private Object readResolve() throws ObjectStreamException {
        return INSTANCE;
    }
}
```

Tanpa `readResolve`, deserialization bisa membuat instance baru dan merusak invariant singleton.

Namun untuk singleton modern, enum sering lebih aman:

```java
public enum Marker {
    INSTANCE
}
```

Enum serialization punya aturan khusus dan lebih tahan terhadap banyak jebakan serialization biasa.

---

## 9. `Externalizable`: Kontrol Penuh, Risiko Penuh

`Externalizable` memberi class kontrol penuh atas format serialized melalui:

```java
void writeExternal(ObjectOutput out)
void readExternal(ObjectInput in)
```

Contoh:

```java
public final class CompactPoint implements Externalizable {
    private int x;
    private int y;

    // wajib public no-arg constructor untuk Externalizable
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

Trade-off:

| Aspek | Serializable | Externalizable |
|---|---|---|
| Kontrol format | Sedang | Penuh |
| Butuh public no-arg constructor | Tidak untuk class serializable biasa | Ya |
| Risiko invariant rusak | Ada | Lebih besar jika tidak disiplin |
| Evolusi field otomatis | Ada sebagian | Manual penuh |
| Verbosity | Lebih rendah | Lebih tinggi |

`Externalizable` bukan “lebih aman” secara otomatis. Ia hanya lebih eksplisit. Jika `readExternal` tidak validasi, object tetap bisa rusak.

---

## 10. Security: Kenapa Deserialization Berbahaya?

Deserialization untrusted data berbahaya karena input bytes bisa memengaruhi:

- class apa yang dimuat;
- object graph apa yang dibuat;
- field private apa yang diisi;
- callback serialization apa yang dipanggil;
- method library dependency apa yang berjalan lewat gadget chain;
- ukuran object graph;
- depth object graph;
- jumlah reference;
- ukuran array;
- konsumsi CPU/memory.

Dengan parser JSON biasa, input umumnya menjadi struktur data sederhana:

```text
bytes -> parser -> Map/List/DTO primitive-ish
```

Dengan Java deserialization:

```text
bytes -> ObjectInputStream -> arbitrary object graph + callbacks
```

Ini jauh lebih powerful.

Dan semakin powerful sebuah primitive, semakin sempit boundary aman penggunaannya.

### 10.1 Trust Boundary Rule

Rule yang harus diingat:

> Jangan deserialize native Java serialization dari input yang tidak tepercaya.

Tidak tepercaya berarti:

- datang dari internet;
- datang dari user upload;
- datang dari message queue yang bisa ditulis service lain;
- datang dari cache/shared storage yang tidak sepenuhnya dikontrol;
- datang dari file lama yang bisa dimodifikasi operator/user;
- datang dari network internal yang tidak punya strong authenticity;
- datang dari service lain yang berbeda deployment lifecycle;
- datang dari dependency/plugin pihak ketiga.

Internal network bukan otomatis trusted. Banyak incident security terjadi karena asumsi “ini kan internal”.

### 10.2 Gadget Chain Mental Model

Gadget chain adalah rangkaian class/method yang sudah ada di classpath, yang jika object-nya dideserialize dengan field tertentu, bisa memicu behavior berbahaya.

Simplified model:

```text
Attacker controls serialized bytes
      |
      v
ObjectInputStream reads class descriptors
      |
      v
Class from application/dependency is instantiated/restored
      |
      v
readObject/readResolve/compare/toString/etc. side effect triggered
      |
      v
Dangerous behavior: command execution, JNDI lookup, file access, SSRF, DoS, etc.
```

Application tidak perlu punya class `Exploit`. Cukup punya dependency yang mengandung gadget yang bisa disusun.

Karena itu mitigation “kami tidak punya class berbahaya” tidak cukup. Yang penting adalah seluruh classpath.

---

## 11. ObjectInputFilter: Minimum Safety Net

Sejak Java 9, platform menyediakan serialization filtering melalui `ObjectInputFilter` sebagai mekanisme membatasi incoming serialization data. JEP 290 memperkenalkan filter incoming serialization data, dan JEP 415 kemudian menambahkan context-specific deserialization filters.

Filter bisa memeriksa metadata seperti:

- class yang akan dibuat;
- array length;
- graph depth;
- jumlah references;
- jumlah bytes dalam stream.

### 11.1 Filter Per Stream

Contoh allowlist sederhana:

```java
import java.io.*;
import java.util.Set;

public final class SafeDeserializer {
    private static final Set<String> ALLOWED_CLASSES = Set.of(
            "com.example.transfer.TransferManifest",
            "com.example.transfer.TransferChunk",
            "java.lang.String",
            "java.time.Instant",
            "java.util.ArrayList"
    );

    public static Object readTrustedButConstrained(InputStream source)
            throws IOException, ClassNotFoundException {

        try (ObjectInputStream in = new ObjectInputStream(source)) {
            in.setObjectInputFilter(info -> {
                if (info.depth() > 20) {
                    return ObjectInputFilter.Status.REJECTED;
                }
                if (info.references() > 10_000) {
                    return ObjectInputFilter.Status.REJECTED;
                }
                if (info.arrayLength() >= 0 && info.arrayLength() > 1_000_000) {
                    return ObjectInputFilter.Status.REJECTED;
                }
                if (info.streamBytes() > 50L * 1024 * 1024) {
                    return ObjectInputFilter.Status.REJECTED;
                }

                Class<?> serialClass = info.serialClass();
                if (serialClass == null) {
                    return ObjectInputFilter.Status.UNDECIDED;
                }

                if (serialClass.isArray()) {
                    Class<?> component = serialClass.getComponentType();
                    if (component.isPrimitive() || component == String.class) {
                        return ObjectInputFilter.Status.ALLOWED;
                    }
                    return ObjectInputFilter.Status.UNDECIDED;
                }

                if (serialClass.isPrimitive()) {
                    return ObjectInputFilter.Status.ALLOWED;
                }

                String name = serialClass.getName();
                if (ALLOWED_CLASSES.contains(name)) {
                    return ObjectInputFilter.Status.ALLOWED;
                }

                return ObjectInputFilter.Status.REJECTED;
            });

            return in.readObject();
        }
    }
}
```

Catatan penting:

- filter bukan magic shield;
- allowlist harus ketat;
- dependency class harus dipahami;
- filter harus dipasang sebelum `readObject()`;
- filter harus dianggap defense-in-depth, bukan izin untuk menerima serialized object dari internet.

### 11.2 Pattern-Based Filter

Java juga mendukung pattern-based filter string.

Contoh konsep:

```text
maxdepth=20;maxrefs=10000;maxbytes=52428800;com.example.transfer.*;java.base/*;!* 
```

Makna umumnya:

- batasi depth;
- batasi reference count;
- batasi bytes;
- izinkan package tertentu;
- tolak lainnya.

Namun pattern filter harus diuji serius. Jangan menulis pattern terlalu longgar seperti:

```text
java.*;com.mycompany.*;*
```

Itu hampir tidak memberi proteksi bermakna.

### 11.3 JVM-Wide Filter

Filter bisa juga dipasang secara global via system property atau konfigurasi JVM. Ini berguna untuk baseline protection pada legacy application.

Namun global filter punya risiko:

- bisa memblokir library yang memang butuh serialization;
- sulit disesuaikan per context;
- harus diuji regression;
- bisa terlalu longgar karena ingin tidak merusak aplikasi.

Best practice modern:

```text
Global filter sebagai baseline kasar.
Per-stream/context filter sebagai enforcement spesifik.
```

---

## 12. Denial-of-Service: Object Graph, Depth, Array, dan Memory Bomb

Deserialization tidak hanya berisiko RCE. Ia juga bisa menyebabkan DoS.

Contoh input malicious bisa mencoba membuat:

- array sangat besar;
- graph sangat dalam;
- graph sangat lebar;
- banyak reference;
- recursive structure;
- object dengan expensive `hashCode`/`equals` setelah deserialization;
- compressed serialized stream yang menjadi sangat besar setelah decompression.

### 12.1 Array Bomb

Jika stream meminta array besar, deserialization bisa mengalokasikan memory besar.

Filter harus membatasi:

```java
if (info.arrayLength() > MAX_ARRAY_LENGTH) {
    return ObjectInputFilter.Status.REJECTED;
}
```

### 12.2 Depth Bomb

Graph terlalu dalam bisa menyebabkan stack/memory pressure atau processing cost tinggi.

```java
if (info.depth() > MAX_DEPTH) {
    return ObjectInputFilter.Status.REJECTED;
}
```

### 12.3 Reference Bomb

Jumlah object/reference terlalu banyak bisa menyebabkan heap pressure.

```java
if (info.references() > MAX_REFERENCES) {
    return ObjectInputFilter.Status.REJECTED;
}
```

### 12.4 Stream Size Limit

Jika input berasal dari file/network, batasi ukuran sebelum sampai ke `ObjectInputStream`.

```java
public final class BoundedInputStream extends FilterInputStream {
    private final long maxBytes;
    private long readBytes;

    public BoundedInputStream(InputStream in, long maxBytes) {
        super(in);
        if (maxBytes < 0) {
            throw new IllegalArgumentException("maxBytes must be >= 0");
        }
        this.maxBytes = maxBytes;
    }

    @Override
    public int read() throws IOException {
        ensureCanRead(1);
        int value = super.read();
        if (value != -1) {
            readBytes++;
        }
        return value;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        Objects.checkFromIndexSize(off, len, b.length);
        if (len == 0) {
            return 0;
        }
        ensureCanRead(1);
        long remaining = maxBytes - readBytes;
        int allowed = (int) Math.min(len, remaining);
        int count = super.read(b, off, allowed);
        if (count > 0) {
            readBytes += count;
        }
        return count;
    }

    private void ensureCanRead(int requested) throws IOException {
        if (readBytes + requested > maxBytes) {
            throw new EOFException("Input exceeds max allowed bytes: " + maxBytes);
        }
    }
}
```

Lalu:

```java
try (InputStream bounded = new BoundedInputStream(raw, 50L * 1024 * 1024);
     ObjectInputStream in = new ObjectInputStream(bounded)) {
    in.setObjectInputFilter(myFilter);
    Object object = in.readObject();
}
```

Filter dan bounded stream saling melengkapi.

---

## 13. Allowlist vs Denylist

Dalam deserialization, denylist hampir selalu lemah.

Denylist berkata:

```text
Tolak class yang diketahui berbahaya.
```

Masalahnya:

- gadget baru terus ditemukan;
- dependency berubah;
- classpath berbeda antar environment;
- attacker hanya butuh satu chain yang lolos;
- denylist sering tertinggal.

Allowlist berkata:

```text
Hanya izinkan class yang memang diperlukan.
```

Untuk deserialization, allowlist jauh lebih masuk akal.

Namun allowlist juga harus hati-hati. Jangan allowlist terlalu luas:

Bad:

```text
com.company.*
```

Better:

```text
com.company.transfer.TransferManifest
com.company.transfer.TransferChunk
java.lang.String
java.time.Instant
java.util.ArrayList
```

Lebih baik lagi: jangan deserialize arbitrary object sama sekali; baca DTO spesifik dengan schema format.

---

## 14. Native Serialization di Boundary: Decision Matrix

Gunakan matrix ini sebagai rule engineering.

| Use Case | Native Java Serialization? | Alasan |
|---|---:|---|
| HTTP request body dari user | Tidak | Untrusted boundary, RCE/DoS risk, tidak interoperable. |
| Public API | Tidak | Format tidak stabil dan Java-specific. |
| Message antar microservice | Umumnya tidak | Cross-version dan trust boundary sulit. |
| Long-term file persistence | Tidak direkomendasikan | Class rename/refactor merusak data. |
| Distributed cache internal short-lived | Mungkin | Jika trusted, filter, TTL pendek, versioning disiplin. |
| HTTP session replication legacy | Mungkin terpaksa | Harus audit semua session attributes. |
| RMI legacy | Mungkin terpaksa | Wajib filter dan hardening. |
| Unit test fixture internal | Boleh terbatas | Jika tidak dari input eksternal. |
| Object deep copy hack | Hindari | Mahal, rapuh, security smell. |
| Plugin system | Sangat berbahaya | Trust boundary kompleks. |

Prinsip:

```text
Semakin lama data hidup dan semakin jauh boundary-nya, semakin buruk native serialization sebagai pilihan.
```

---

## 15. Designing Serializable Classes Safely

Jika kamu memang harus membuat class serializable, gunakan checklist berikut.

### 15.1 Deklarasikan Intent Secara Jelas

Jangan `implements Serializable` hanya karena framework meminta tanpa memahami konsekuensi.

Bad:

```java
public class EverythingDto implements Serializable {
    // semua field domain, entity, service reference ikut masuk
}
```

Better:

```java
/**
 * Serializable because this object is stored in short-lived internal job cache.
 * Serialized form is not a public or long-term persistence format.
 */
public final class JobCacheEntry implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;
}
```

### 15.2 Hindari Menserialisasi Object dengan Resource Eksternal

Jangan serialisasi:

- `Connection`;
- `Socket`;
- `InputStream`;
- `OutputStream`;
- `Thread`;
- `ExecutorService`;
- file handle;
- database transaction;
- security context mentah;
- logger;
- Spring bean/service;
- entity manager/session.

Gunakan `transient` untuk field non-state:

```java
private transient Logger logger;
private transient ExecutorService executor;
```

Tetapi `transient` bukan cukup. Setelah deserialization, field transient menjadi default/null. Class harus bisa memulihkannya atau tidak bergantung padanya.

### 15.3 Validasi Invariant di `readObject`

```java
@Serial
private void readObject(ObjectInputStream in) throws IOException, ClassNotFoundException {
    in.defaultReadObject();
    validateForDeserialization();
}

private void validateForDeserialization() throws InvalidObjectException {
    if (id == null || id.isBlank()) {
        throw new InvalidObjectException("id is required");
    }
}
```

### 15.4 Gunakan Serialization Proxy untuk Immutable Value Object

Jika object punya invariant kuat, serialization proxy sering lebih baik.

### 15.5 Jangan Bocorkan Internal Mutable State

Pastikan getter melakukan defensive copy atau return immutable view.

### 15.6 Jangan Menyimpan Secret Mentah

Serializable object sering masuk cache/file/log/debug dump. Hindari field:

- password;
- token;
- private key;
- session secret;
- API key;
- PII sensitif.

Jika harus ada secret runtime, tandai `transient` dan desain ulang lifecycle.

```java
private transient char[] password;
```

Namun ini tidak otomatis aman. Secret tetap bisa muncul di heap dump.

### 15.7 Dokumentasikan Serialized Form

Jika class menjadi bagian dari public serialized form, dokumentasikan field dan compatibility contract. Gunakan `@Serial` annotation untuk method/field serialization-specific agar intent jelas.

---

## 16. Legacy System Audit: Menemukan Serialization Risk

Di enterprise codebase, serialization sering muncul tidak eksplisit.

Cari pola berikut:

```text
implements Serializable
ObjectInputStream
ObjectOutputStream
readObject(
writeObject(
readResolve(
writeReplace(
Externalizable
readExternal(
writeExternal(
serialVersionUID
java.rmi
HttpSession attribute
Redis serializer Java
JMS ObjectMessage
```

### 16.1 Risk Ranking

| Pattern | Risk |
|---|---|
| `ObjectInputStream` dari HTTP upload/body | Critical |
| `ObjectInputStream` dari socket | Critical/High |
| JMS `ObjectMessage` antar service | High |
| Redis/JCache Java serialization shared antar service | High |
| HTTP session replication | Medium/High |
| Internal cache same JVM | Medium |
| Unit test fixture | Low |
| Serialization proxy value object internal | Low/Medium |

### 16.2 Audit Questions

Tanyakan:

1. Dari mana bytes datang?
2. Siapa yang bisa menulis bytes tersebut?
3. Berapa lama bytes hidup?
4. Apakah classpath mengandung dependency lama/berisiko?
5. Apakah ada `ObjectInputFilter`?
6. Apakah filter allowlist atau denylist?
7. Apakah ada size/depth/reference limit?
8. Apakah class serializable punya invariant validation?
9. Apakah serialized data melewati service boundary?
10. Apa migration plan jika class berubah?
11. Apa fallback jika deserialization gagal saat deployment?
12. Apakah data mengandung secret/PII?

---

## 17. Safer Replacement Patterns

### 17.1 JSON DTO

Untuk API dan configuration:

```java
public record TransferManifestDto(
        String transferId,
        String fileName,
        long sizeBytes,
        String sha256Hex,
        List<ChunkDto> chunks
) {}

public record ChunkDto(
        int index,
        long offset,
        long length,
        String sha256Hex
) {}
```

Kelebihan:

- explicit;
- inspectable;
- interoperable;
- mudah validasi;
- mudah schema documentation.

Kekurangan:

- tidak preserve object identity;
- butuh mapping;
- bisa lebih verbose.

### 17.2 Protocol Buffers

Cocok untuk:

- service-to-service contract;
- binary compact;
- schema evolution;
- cross-language;
- high throughput.

Mental model:

```text
Schema adalah contract, bukan class Java runtime.
```

### 17.3 Avro

Cocok untuk:

- data pipeline;
- Kafka/event streaming;
- schema registry;
- analytics ingestion.

### 17.4 Custom Binary Format

Cocok jika:

- butuh format sangat spesifik;
- volume besar;
- latency kritis;
- bisa membayar biaya desain dan testing.

Wajib punya:

- magic number;
- version;
- flags;
- length prefix;
- checksum;
- max size;
- compatibility rules;
- test vector;
- fuzz test.

---

## 18. Migration dari Native Serialization

Misalkan legacy system menyimpan file `.ser` jangka panjang. Targetnya pindah ke JSON/Protobuf.

### 18.1 Migration Plan

```text
Phase 1: Inventory
  - cari semua producer dan consumer serialized data
  - identifikasi class dan serialVersionUID
  - identifikasi storage/cache/queue

Phase 2: Stabilize
  - pasang ObjectInputFilter
  - tambah size limit
  - tambah logging failure
  - tambah validation di readObject

Phase 3: Dual Read
  - reader bisa baca format lama dan baru
  - format baru jadi default output

Phase 4: Backfill
  - migrasi file/cache/object lama ke format baru
  - simpan checksum dan audit result

Phase 5: Stop Writing Old Format
  - producer hanya menulis format baru
  - old reader tetap sementara

Phase 6: Remove Old Format
  - setelah TTL/data retention lewat
  - hapus ObjectInputStream path
```

### 18.2 Envelope Pattern

Format baru bisa memakai envelope:

```json
{
  "format": "transfer-manifest",
  "version": 2,
  "createdAt": "2026-06-16T00:00:00Z",
  "payload": {
    "transferId": "TRF-001",
    "fileName": "report.csv",
    "sizeBytes": 1048576,
    "sha256Hex": "..."
  }
}
```

Envelope memberi ruang untuk:

- versioning;
- metadata;
- migration;
- checksum;
- tracing;
- compatibility.

---

## 19. Case Study: Session Attribute yang Diam-Diam Tidak Aman

Banyak Java web app legacy menyimpan object kompleks dalam session.

```java
session.setAttribute("currentUser", userEntity);
```

Masalah:

- `userEntity` mungkin Hibernate entity;
- entity punya lazy proxy;
- graph terlalu besar;
- field berubah antar deployment;
- session replication memakai Java serialization;
- deployment rolling upgrade membaca session dari versi lama;
- object mungkin mengandung permission lama;
- data bisa stale;
- class rename memutus session.

Better:

```java
public record SessionUser(
        String userId,
        String username,
        Set<String> roles,
        Instant authenticatedAt
) implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;
}
```

Lebih baik lagi: simpan session minimal.

```text
session -> userId + auth context version
server -> fetch current authorization state when needed
```

Aturan session:

- jangan simpan entity;
- jangan simpan service;
- jangan simpan graph besar;
- jangan simpan secret mentah;
- simpan DTO kecil dan stabil;
- TTL pendek;
- rolling deployment harus diuji.

---

## 20. Case Study: Redis Cache dengan Java Serialization

Legacy Spring app kadang memakai Java native serialization untuk Redis value.

Masalah:

```text
Service A writes UserCacheEntry v1
Service B reads UserCacheEntry v2
Deployment rolling terjadi
Class berubah
serialVersionUID mismatch
Cache read gagal massal
```

Atau:

```text
Dependency upgrade mengubah internal serialized object
Cache lama tidak bisa dibaca
```

Mitigasi:

1. Jangan cache object domain kompleks.
2. Cache DTO eksplisit.
3. Gunakan JSON/CBOR/Protobuf serializer.
4. Tambah cache namespace version.
5. TTL pendek.
6. Treat cache miss on deserialization failure.
7. Jangan biarkan cache deserialization failure menjatuhkan request utama.

Contoh fallback:

```java
public Optional<UserCacheEntry> readUser(String userId) {
    try {
        return redis.get(userKey(userId));
    } catch (SerializationException ex) {
        log.warn("Failed to deserialize user cache entry, evicting key userId={}", userId, ex);
        redis.delete(userKey(userId));
        return Optional.empty();
    }
}
```

---

## 21. Case Study: Queue/ObjectMessage

JMS `ObjectMessage` terlihat convenient:

```java
ObjectMessage message = session.createObjectMessage(orderEvent);
```

Namun antar service, ini buruk karena:

- consumer harus punya class Java yang sama;
- schema tidak eksplisit;
- class evolution rapuh;
- security risk;
- language lock-in;
- dependency coupling tinggi.

Better:

```text
Message body: JSON/Avro/Protobuf
Headers: eventType, schemaVersion, correlationId, idempotencyKey
```

Event bukan object runtime. Event adalah contract.

---

## 22. Failure Model Deserialization

Saat membaca serialized data, failure yang mungkin terjadi:

| Failure | Penyebab | Handling |
|---|---|---|
| `InvalidClassException` | UID mismatch atau incompatible class | Treat as incompatible data, migrate/reject/evict. |
| `ClassNotFoundException` | Class tidak ada di classpath | Migration issue atau malicious input. |
| `StreamCorruptedException` | Header/format rusak | Reject data, audit source. |
| `OptionalDataException` | Primitive/object stream mismatch | Bug format atau corrupt data. |
| `EOFException` | Stream terpotong | Reject, retry only if source transfer incomplete. |
| `InvalidObjectException` | Custom validation gagal | Reject as invalid semantic state. |
| `NotSerializableException` | Saat write, ada field non-serializable | Fix object graph or mark transient. |
| `WriteAbortedException` | Exception saat serialization write sebelumnya | Treat as corrupted/incomplete stream. |
| `SecurityException` | Filter/security policy reject | Expected for blocked unsafe payload. |
| `OutOfMemoryError` | Payload terlalu besar/graph bomb | Prevent via filter/limits. |

Prinsip handling:

```text
Deserialization failure tidak boleh diam-diam menghasilkan default object palsu.
```

Untuk cache: evict dan recompute.  
Untuk persisted file: quarantine dan audit.  
Untuk network/API: reject.  
Untuk queue: DLQ dengan reason.  
Untuk session: invalidate session jika perlu.  

---

## 23. Testing Serialization Compatibility

Jika class serializable menjadi bagian dari contract internal penting, buat test compatibility.

### 23.1 Golden File Test

Simpan serialized bytes versi lama sebagai fixture.

```text
src/test/resources/serialization/user-session-v1.ser
src/test/resources/serialization/user-session-v2.ser
```

Test:

```java
@Test
void canReadUserSessionV1() throws Exception {
    try (InputStream raw = getClass().getResourceAsStream("/serialization/user-session-v1.ser");
         ObjectInputStream in = new ObjectInputStream(raw)) {

        Object object = in.readObject();
        assertThat(object).isInstanceOf(UserSession.class);

        UserSession session = (UserSession) object;
        assertThat(session.userId()).isEqualTo("u-123");
        assertThat(session.roles()).contains("ADMIN");
    }
}
```

### 23.2 Round-Trip Test Tidak Cukup

Round-trip test:

```text
current class -> serialize -> deserialize -> compare
```

Ini hanya membuktikan versi saat ini bisa membaca dirinya sendiri. Tidak membuktikan bisa membaca versi lama.

Harus ada:

- old fixture read test;
- current fixture read test;
- invalid fixture reject test;
- field missing test;
- corrupt stream test;
- oversized graph test jika security relevant.

### 23.3 Compatibility Matrix

Untuk rolling deployment:

| Writer | Reader | Expected |
|---|---|---|
| v1 | v1 | OK |
| v1 | v2 | OK atau migrate |
| v2 | v1 | OK jika backward required, otherwise blocked |
| v2 | v2 | OK |

Sering kali yang dilupakan adalah:

```text
new writer -> old reader
```

Pada rolling deployment, old pod bisa membaca data dari new pod jika cache/session/queue shared.

---

## 24. Practical Checklist: Sebelum Menambahkan `implements Serializable`

Jawab dulu:

1. Kenapa class ini perlu serializable?
2. Siapa producer dan consumer stream-nya?
3. Apakah stream melewati trust boundary?
4. Berapa lama data hidup?
5. Apakah class ini akan direfactor?
6. Apakah ada object graph besar?
7. Apakah ada field sensitive?
8. Apakah invariant class kuat?
9. Apakah constructor normal harus selalu dipakai?
10. Apakah serialization proxy lebih cocok?
11. Apakah alternatif JSON/Protobuf lebih baik?
12. Apakah perlu `ObjectInputFilter`?
13. Apakah perlu golden compatibility test?
14. Apakah failure strategy sudah jelas?

Jika jawabannya tidak jelas, jangan tambahkan `implements Serializable` dulu.

---

## 25. Anti-Pattern

### 25.1 `implements Serializable` di Base Class Tanpa Alasan

```java
public abstract class BaseEntity implements Serializable {
}
```

Ini membuat semua subclass ikut serializable dan membuka graph luas.

### 25.2 Menserialisasi Entity ORM

Entity ORM biasanya punya:

- lazy proxy;
- bidirectional relationship;
- persistence context;
- field internal;
- graph besar;
- lifecycle framework.

Gunakan DTO.

### 25.3 Java Serialization untuk Public API

Public API harus punya contract eksplisit dan interoperable. Native serialization bukan pilihan bagus.

### 25.4 Mengabaikan `InvalidClassException`

Bad:

```java
catch (Exception ignored) {
    return new UserSession();
}
```

Ini membuat object palsu dan bisa merusak authorization/session logic.

### 25.5 Global Allow `*`

Filter yang mengizinkan semua class bukan filter.

### 25.6 Deep Copy via Serialization

```java
Object copy = deserialize(serialize(original));
```

Masalah:

- lambat;
- butuh semua field serializable;
- callback side effect;
- invariant risk;
- security smell;
- class evolution coupling.

Gunakan copy constructor, mapper, record, atau explicit clone logic.

---

## 26. Production Pattern: Safe Internal Deserialization Envelope

Jika terpaksa memakai Java serialization internal, buat envelope dan filter.

### 26.1 Envelope Metadata

Simpan metadata di luar serialized object jika memungkinkan:

```text
magic = JOBJ
formatVersion = 1
payloadType = TransferManifest
payloadLength = ...
payloadSha256 = ...
javaSerializedPayload = ...
```

Dengan envelope, sebelum `ObjectInputStream` berjalan, kita bisa cek:

- magic number;
- version;
- type expected;
- length;
- checksum;
- max size.

### 26.2 Read Flow

```text
read envelope header
validate magic/version/type
validate payload length <= max
read payload bytes bounded
verify checksum
create ObjectInputStream over bounded bytes
install ObjectInputFilter allowlist
read object
validate object type
validate semantic invariant
return object
```

### 26.3 Example Skeleton

```java
public final class InternalSerializationEnvelopeReader<T> {
    private final Class<T> expectedType;
    private final long maxPayloadBytes;
    private final ObjectInputFilter filter;

    public InternalSerializationEnvelopeReader(
            Class<T> expectedType,
            long maxPayloadBytes,
            ObjectInputFilter filter
    ) {
        this.expectedType = Objects.requireNonNull(expectedType, "expectedType");
        this.maxPayloadBytes = maxPayloadBytes;
        this.filter = Objects.requireNonNull(filter, "filter");
    }

    public T read(byte[] payload) throws IOException, ClassNotFoundException {
        if (payload.length > maxPayloadBytes) {
            throw new IOException("Payload too large: " + payload.length);
        }

        try (ObjectInputStream in = new ObjectInputStream(new ByteArrayInputStream(payload))) {
            in.setObjectInputFilter(filter);
            Object object = in.readObject();

            if (!expectedType.isInstance(object)) {
                throw new InvalidObjectException(
                        "Expected " + expectedType.getName() + " but got " +
                                (object == null ? "null" : object.getClass().getName())
                );
            }

            return expectedType.cast(object);
        }
    }
}
```

Ini tetap bukan untuk untrusted internet input, tetapi jauh lebih baik daripada `new ObjectInputStream(raw).readObject()` tanpa limit.

---

## 27. Security Notes yang Harus Diingat

1. Deserialization untrusted data inherently dangerous.
2. Filter adalah defense-in-depth, bukan pembenaran untuk desain yang salah.
3. Allowlist lebih baik daripada denylist.
4. Batasi size sebelum deserialization.
5. Batasi graph depth dan references.
6. Jangan deserialize dari HTTP body/upload/socket user.
7. Jangan memakai `ObjectMessage` untuk boundary antar service modern.
8. Jangan menyimpan secret dalam serializable object.
9. Audit dependency classpath, bukan hanya class application.
10. Treat deserialization failure as security-relevant event jika input dari boundary eksternal.

---

## 28. Performance Notes

Serialization native Java punya overhead:

- class descriptor;
- handle table;
- reflection/internal access;
- object graph traversal;
- reference tracking;
- allocation saat read;
- callback invocation;
- GC pressure.

Untuk object graph kecil internal, overhead bisa diterima. Untuk throughput tinggi, large payload, service-to-service, atau data pipeline, format seperti Protobuf/Avro/custom binary sering lebih predictable.

Performance smell:

```text
CPU tinggi di ObjectInputStream.readObject
GC pressure tinggi saat cache read
latency spike saat session replication
payload size membengkak tanpa disadari
```

Optimization pertama bukan tuning `ObjectInputStream`, tetapi bertanya:

```text
Apakah native serialization memang format yang tepat?
```

---

## 29. Ringkasan Mental Model

Java serialization adalah mekanisme powerful untuk menyimpan dan memulihkan object graph Java. Ia bisa mempertahankan identity, cyclic reference, field private, dan class-specific behavior. Tetapi kekuatan itulah yang membuatnya berbahaya di boundary yang salah.

Poin inti:

1. `serialVersionUID` adalah compatibility gate, bukan migration engine.
2. Compatible secara runtime belum tentu valid secara domain.
3. `readObject` harus dianggap seperti constructor tersembunyi.
4. Invariant harus divalidasi ulang setelah `defaultReadObject`.
5. `readResolve` berguna untuk canonicalization/singleton/proxy.
6. Serialization proxy pattern adalah desain kuat untuk immutable object.
7. `Externalizable` memberi kontrol penuh tetapi juga risiko penuh.
8. Native deserialization dari untrusted data harus dihindari.
9. `ObjectInputFilter` wajib untuk legacy/internal deserialization yang masih ada.
10. Allowlist, size limit, depth limit, reference limit, dan semantic validation harus dipakai bersama.
11. Untuk long-term storage dan service boundary, gunakan format eksplisit/schema-based.
12. Migration dari native serialization harus dilakukan bertahap: inventory, hardening, dual-read, backfill, stop-write, remove-old.

---

## 30. Checklist Final Part 017

Sebelum memakai atau mempertahankan Java serialization, pastikan:

- [ ] Semua class serializable disengaja, bukan accidental.
- [ ] `serialVersionUID` eksplisit.
- [ ] Invariant divalidasi di `readObject` atau via serialization proxy.
- [ ] Field sensitive tidak ikut serialized.
- [ ] Object graph kecil dan terkendali.
- [ ] Tidak ada entity ORM/proxy/service/resource handle dalam graph.
- [ ] Data tidak berasal dari untrusted boundary.
- [ ] Ada `ObjectInputFilter` untuk semua read path.
- [ ] Ada size/depth/reference/array limit.
- [ ] Failure handling jelas: reject, evict, quarantine, DLQ, atau migrate.
- [ ] Ada compatibility test untuk golden serialized data lama.
- [ ] Ada migration plan jika format ini perlu dihentikan.

---

## 31. Latihan

### Latihan 1 — Audit Serializable Class

Ambil satu class `Serializable` dari codebase. Jawab:

1. Kenapa class itu serializable?
2. Siapa yang serialize?
3. Siapa yang deserialize?
4. Dari mana bytes datang?
5. Berapa lama data hidup?
6. Apakah ada `readObject` validation?
7. Apakah ada field sensitive?
8. Apakah ada `serialVersionUID` eksplisit?
9. Apa yang terjadi jika field baru ditambahkan?
10. Apa yang terjadi saat rolling deployment?

### Latihan 2 — Tambahkan Validation

Buat class `DateRange implements Serializable` dengan invariant:

```text
start != null
end != null
end >= start
```

Tambahkan `readObject` yang menolak object invalid.

### Latihan 3 — Buat Serialization Proxy

Buat class immutable `EmailAddress` yang:

- menyimpan lowercase normalized email;
- validasi format minimal;
- memakai serialization proxy;
- menolak direct deserialization.

### Latihan 4 — Buat ObjectInputFilter

Buat filter yang hanya mengizinkan:

- `com.example.transfer.TransferManifest`
- `com.example.transfer.TransferChunk`
- `java.lang.String`
- primitive arrays
- max depth 10
- max references 5.000
- max array length 1.000.000

### Latihan 5 — Rancang Migration Plan

Anggap aplikasi lama menyimpan `.ser` file untuk export job selama 2 tahun. Rancang migrasi ke JSON envelope dengan dual-read dan backfill.

---

## 32. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

1. Java Object Serialization Specification — Versioning of Serializable Objects  
   https://docs.oracle.com/en/java/javase/26/docs/specs/serialization/version.html

2. Java Object Serialization Specification — System Architecture  
   https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/serial-arch.html

3. Java Object Serialization Specification — Object Input Classes  
   https://docs.oracle.com/en/java/javase/22/docs/specs/serialization/input.html

4. Java Object Serialization Specification — Object Output Classes  
   https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/output.html

5. `ObjectInputStream` Java API Documentation  
   https://docs.oracle.com/en/java/javase/23/docs/api/java.base/java/io/ObjectInputStream.html

6. Serialization Filtering Guide  
   https://docs.oracle.com/en/java/javase/11/core/serialization-filtering1.html

7. JEP 290 — Filter Incoming Serialization Data  
   https://openjdk.org/jeps/290

8. JEP 415 — Context-Specific Deserialization Filters  
   https://openjdk.org/jeps/415

9. `Serializable` Java API Documentation  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html

10. `Externalizable` Java API Documentation  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Externalizable.html

---

## 33. Penutup

Part 017 menutup dua bagian serialization. Part 016 menjelaskan bagaimana Java serialization bekerja sebagai object graph protocol. Part 017 menjelaskan konsekuensi engineering-nya: compatibility, versioning, invariant, security, filtering, migration, dan decision-making.

Mulai Part 018, kita pindah ke **compression**: ZIP, GZIP, Deflater, Inflater, streaming compression, zip bomb, zip slip, CRC, dan bagaimana compression berinteraksi dengan I/O pipeline, network transfer, CPU, memory, dan security.

