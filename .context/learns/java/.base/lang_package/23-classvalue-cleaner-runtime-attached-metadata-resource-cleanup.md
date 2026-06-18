# Part 23 — `ClassValue`, `Cleaner`, Runtime-Attached Metadata, and Resource Cleanup

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `23-classvalue-cleaner-runtime-attached-metadata-resource-cleanup.md`  
> Scope: Java 8–25, dengan fokus pada `java.lang.ClassValue`, `java.lang.ref.Cleaner`, resource lifecycle, dan metadata/caching yang aman terhadap class loader.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas `java.lang.invoke` boundary dan runtime support yang biasanya dipakai oleh compiler, framework, atau library tingkat rendah. Part ini melanjutkan ke dua area kecil tetapi sangat penting untuk engineer yang bekerja di layer framework/runtime:

1. **`ClassValue<T>`**: mekanisme resmi JVM-level API untuk menyimpan nilai terkomputasi yang diasosiasikan dengan sebuah `Class<?>`.
2. **`java.lang.ref.Cleaner`**: mekanisme cleanup berbasis reachability yang lebih aman daripada finalization, tetapi tetap bukan pengganti deterministic resource management.

Keduanya sering tidak dipakai langsung oleh application developer sehari-hari, tetapi sangat relevan untuk:

- dependency injection container;
- serializer/deserializer;
- object mapper;
- validation framework;
- expression engine;
- annotation processor runtime support;
- plugin architecture;
- class loader isolated platform;
- native/off-heap resource wrapper;
- cache metadata per class;
- library yang harus berjalan di Java 8–25 tanpa leaking memory.

Target setelah part ini:

- kamu memahami kenapa `Map<Class<?>, Metadata>` bisa menjadi class loader leak;
- kamu tahu kapan `ClassValue` lebih tepat daripada `ConcurrentHashMap<Class<?>, ...>`;
- kamu memahami lifecycle nilai pada `ClassValue`;
- kamu tahu batas guarantee `ClassValue`;
- kamu memahami reachability, phantom reachability, dan kenapa cleanup berbasis GC tidak deterministic;
- kamu bisa mendesain wrapper resource dengan `AutoCloseable` sebagai primary cleanup dan `Cleaner` sebagai safety net;
- kamu tahu failure modes yang sering muncul pada `Cleaner`, terutama accidental strong reference ke referent;
- kamu bisa mengevaluasi apakah sebuah API cleanup cukup aman untuk production.

---

## 2. Mental Model Utama

### 2.1 `ClassValue`: metadata yang mengikuti class, bukan map global biasa

Banyak framework perlu menjawab pertanyaan seperti:

- untuk class `UserDto`, field mana saja yang bisa di-serialize?
- untuk class `Invoice`, annotation mana yang berlaku?
- untuk class `CaseState`, transition metadata apa yang valid?
- untuk class `MyController`, method handler mana yang perlu dipanggil?
- untuk record `Address`, component extractor-nya apa?

Solusi naif:

```java
static final ConcurrentHashMap<Class<?>, Metadata> CACHE = new ConcurrentHashMap<>();
```

Masalahnya: key `Class<?>` memegang class object. Class object memegang defining class loader. Class loader memegang semua class/resource yang pernah dimuat olehnya. Jika cache global di class loader parent menahan key class dari child class loader, maka child class loader bisa tidak pernah di-GC.

Ini sangat sering terjadi di:

- application server;
- servlet container;
- plugin system;
- test runner;
- hot reload;
- script engine;
- dynamic module layer;
- framework yang memindai class aplikasi.

`ClassValue<T>` memberi model yang lebih tepat:

> Nilai dikaitkan dengan `Class` target melalui mekanisme VM/library yang dirancang agar lebih ramah terhadap unloading class.

Bukan berarti `ClassValue` adalah magic anti-leak untuk semua kasus, tetapi ia menghilangkan pola cache global paling berbahaya: strong map dari parent loader ke child loader classes.

---

### 2.2 `Cleaner`: fallback cleanup, bukan lifecycle utama

`Cleaner` sering disalahpahami sebagai “replacement langsung untuk `finalize()`”. Lebih tepatnya:

> `Cleaner` adalah safety net untuk menjalankan cleaning action setelah object tidak lagi strongly reachable, berdasarkan notifikasi dari garbage collector.

Karena bergantung pada GC, maka:

- tidak ada guarantee kapan cleaning action jalan;
- tidak cocok untuk resource yang harus dilepas segera;
- tidak cocok untuk transaction commit/rollback;
- tidak cocok untuk release lock bisnis;
- tidak cocok untuk predictable file/socket/native handle lifetime;
- tidak boleh menjadi satu-satunya cleanup untuk resource yang terbatas.

Primary mechanism untuk resource adalah:

```java
try (Resource r = Resource.open()) {
    // use resource
}
```

`Cleaner` hanya backup jika caller lupa memanggil `close()`.

---

## 3. Posisi API dalam Java 8–25

### 3.1 `ClassValue`

`ClassValue<T>` berada di package `java.lang` dan tersedia sejak Java 7, sehingga tersedia di seluruh range Java 8–25.

Karakter penting:

- abstract class;
- subclass override `computeValue(Class<?> type)`;
- value diakses via `get(Class<?>)`;
- value bisa dihapus via `remove(Class<?>)`;
- compute bisa dipanggil lebih dari sekali dalam race;
- caller harus membuat computation idempotent dan side-effect minimal;
- cocok untuk metadata per class.

---

### 3.2 `Cleaner`

`Cleaner` berada di `java.lang.ref` dan tersedia sejak Java 9. Untuk Java 8, API ini belum ada.

Implikasi Java 8–25:

- Jika baseline library adalah Java 8, tidak bisa refer langsung ke `java.lang.ref.Cleaner` pada main source set yang ditargetkan Java 8.
- Bisa memakai multi-release JAR untuk Java 9+ implementation.
- Atau gunakan abstraction yang fallback ke no-op/leak detector/manual cleanup di Java 8.
- Jangan kembali ke finalization hanya demi Java 8, kecuali benar-benar legacy dan kamu sadar risikonya.

JEP 421 mendeprecate finalization for removal dan menyarankan migrasi ke mekanisme seperti `try-with-resources` dan cleaners. Dokumentasi `Cleaner` Java SE 25 menjelaskan bahwa cleaning action didaftarkan untuk dijalankan setelah object menjadi phantom reachable; cleaner menggunakan `PhantomReference` dan `ReferenceQueue` untuk notifikasi perubahan reachability. `Cleaner.Cleanable.clean()` menjalankan cleaning action paling banyak sekali. Referensi: dokumentasi resmi Java SE 25 dan JEP 421.  

---

## 4. `ClassValue<T>` secara Mendalam

### 4.1 Problem yang dipecahkan

Bayangkan kamu menulis object mapper:

```java
public final class MetadataRegistry {
    private static final ConcurrentHashMap<Class<?>, ModelMetadata> CACHE = new ConcurrentHashMap<>();

    public static ModelMetadata metadataFor(Class<?> type) {
        return CACHE.computeIfAbsent(type, MetadataRegistry::scan);
    }

    private static ModelMetadata scan(Class<?> type) {
        // expensive reflection scan
        return ModelMetadata.from(type);
    }
}
```

Kode ini tampak benar:

- thread-safe;
- lazy;
- avoids repeated reflection;
- simple.

Tetapi dalam container/plugin system, ini bisa leaking:

```text
Parent class loader
  └─ loads MetadataRegistry
       └─ static CACHE
            └─ key: Class<?> from ChildAppClassLoader
                 └─ defining loader: ChildAppClassLoader
                      └─ all app classes/resources
```

Ketika aplikasi di-redeploy, child loader lama seharusnya bisa unload. Tetapi static cache di parent masih menahan class-nya. Akibat:

- old application class loader tidak hilang;
- old static fields tetap hidup;
- old bytecode/metaspace tetap tertahan;
- memory naik setiap redeploy;
- eventually metaspace atau heap pressure.

`ClassValue` mengubah model menjadi:

```java
private static final ClassValue<ModelMetadata> METADATA = new ClassValue<>() {
    @Override
    protected ModelMetadata computeValue(Class<?> type) {
        return ModelMetadata.from(type);
    }
};

public static ModelMetadata metadataFor(Class<?> type) {
    return METADATA.get(type);
}
```

Secara API, kita tetap punya lazy metadata per class, tetapi tidak menyimpan `Class<?>` sebagai key dalam `ConcurrentHashMap` global milik kita.

---

### 4.2 Cara kerja konseptual

Mental model:

```text
ClassValue instance
   │
   ├─ defines how to compute T for a Class<?>
   │
   └─ get(SomeClass.class)
          │
          ├─ if value exists for this Class + this ClassValue: return it
          └─ else computeValue(SomeClass.class), associate, return
```

Key association sebenarnya adalah kombinasi:

```text
(ClassValue instance, Class<?> target) -> value
```

Artinya dua `ClassValue` berbeda bisa menyimpan value berbeda pada class yang sama.

---

### 4.3 Basic example

```java
public final class FieldCountRegistry {
    private static final ClassValue<Integer> FIELD_COUNT = new ClassValue<>() {
        @Override
        protected Integer computeValue(Class<?> type) {
            return type.getDeclaredFields().length;
        }
    };

    public static int fieldCount(Class<?> type) {
        return FIELD_COUNT.get(type);
    }
}
```

Pemakaian:

```java
int count = FieldCountRegistry.fieldCount(MyDto.class);
```

Kualitas kode ini:

- computation lazy;
- value scoped per class;
- tidak perlu manual synchronization;
- cocok untuk metadata yang pure/derived;
- lebih aman untuk class unloading dibanding map global naif.

---

### 4.4 `computeValue` harus pure-ish

`computeValue` sebaiknya:

- deterministik untuk class yang sama;
- tidak mengubah global state;
- tidak membuka resource yang perlu ditutup;
- tidak melakukan blocking I/O berat;
- tidak bergantung pada request context;
- tidak menyimpan user/tenant/session state;
- tidak melempar exception kecuali class benar-benar invalid.

Contoh buruk:

```java
private static final ClassValue<ModelMetadata> BAD = new ClassValue<>() {
    @Override
    protected ModelMetadata computeValue(Class<?> type) {
        auditService.log("Scanning " + type.getName()); // side effect
        return remoteConfigClient.fetchMetadata(type.getName()); // remote I/O
    }
};
```

Masalah:

- computation bisa terjadi saat hot path;
- remote failure membuat akses metadata gagal;
- side effect bisa terjadi lebih dari sekali;
- sulit diuji;
- runtime metadata tergantung availability external system.

Lebih baik:

```java
private static final ClassValue<ModelMetadata> GOOD = new ClassValue<>() {
    @Override
    protected ModelMetadata computeValue(Class<?> type) {
        return ModelMetadata.scan(type); // local, deterministic, bounded
    }
};
```

---

### 4.5 Race dan duplicate computation

`ClassValue` tidak boleh diasumsikan hanya memanggil `computeValue` sekali secara global dalam semua kondisi race. Desain computation harus aman jika dieksekusi lebih dari sekali.

Jangan lakukan:

```java
private static final AtomicInteger registrationId = new AtomicInteger();

private static final ClassValue<Metadata> BAD = new ClassValue<>() {
    @Override
    protected Metadata computeValue(Class<?> type) {
        int id = registrationId.incrementAndGet();
        registerGlobally(id, type);
        return new Metadata(id, type);
    }
};
```

Jika compute terjadi lebih dari sekali, global registry bisa punya duplicate/stale registration.

Lebih baik pisahkan:

- `ClassValue` untuk derived immutable metadata;
- global registration eksplisit dilakukan di lifecycle container yang deterministic.

---

### 4.6 `remove(Class<?>)`

`ClassValue` menyediakan `remove(type)` untuk menghapus associated value.

Use case:

- metadata dipengaruhi dynamic configuration;
- testing perlu reset;
- generated accessor berubah;
- class instrumentation mengubah bentuk class;
- framework reload internal cache.

Contoh:

```java
public final class MetadataCache {
    private static final ClassValue<ModelMetadata> METADATA = new ClassValue<>() {
        @Override
        protected ModelMetadata computeValue(Class<?> type) {
            return ModelMetadata.scan(type);
        }
    };

    public static ModelMetadata get(Class<?> type) {
        return METADATA.get(type);
    }

    public static void invalidate(Class<?> type) {
        METADATA.remove(type);
    }
}
```

Tetapi hati-hati: `remove` bukan distributed invalidation system. Kalau value sudah dipegang caller lain, value itu tetap hidup selama ada reference eksternal.

---

### 4.7 Value tidak boleh menahan class loader secara tidak perlu

`ClassValue` membantu pada sisi key, tetapi value tetap bisa leak jika value memegang object dari class loader lain secara berlebihan.

Contoh:

```java
final class ModelMetadata {
    private final Class<?> type;
    private final List<Field> fields;
    private final Object applicationService; // dangerous
}
```

Menyimpan `Class<?>` dan `Field` sebagai metadata biasanya wajar karena metadata memang terkait class itu. Tetapi menyimpan service/container/request object di metadata class-level adalah bau desain.

Lebih aman:

```java
final class ModelMetadata {
    private final String className;
    private final List<FieldMetadata> fields;
    private final MethodHandle constructor;
}
```

Tergantung use case, kamu bisa memilih apakah menyimpan reflective object (`Field`, `Method`) atau representation netral (`String`, descriptor, handle). Dalam framework internal, reflective object sering dibutuhkan dan wajar, selama lifecycle-nya mengikuti class.

Yang berbahaya adalah value class-level menahan state yang lifecycle-nya lebih pendek atau berasal dari container global yang salah arah.

---

## 5. Kapan Memakai `ClassValue` vs Map Biasa

### 5.1 Pakai `ClassValue` ketika...

Gunakan `ClassValue` ketika:

- key utama adalah `Class<?>`;
- value adalah metadata turunan dari class tersebut;
- metadata mahal dihitung;
- library/framework bisa dipakai dalam class loader berbeda;
- kamu ingin mengurangi risiko class loader leak;
- value berlaku selama class masih relevan;
- invalidation jarang atau per-class.

Contoh bagus:

- record component metadata;
- bean property metadata;
- annotation lookup cache;
- field accessor cache;
- enum external-code lookup;
- mapper plan;
- validation constraint metadata;
- per-class serializer/deserializer plan.

---

### 5.2 Pakai `ConcurrentHashMap` ketika...

Map biasa masih tepat ketika:

- key bukan class;
- lifecycle cache dikelola eksplisit;
- cache punya max size/TTL/eviction policy;
- value bergantung pada configuration/user/tenant;
- key composite, misalnya `(Class, Locale, View, Version)`;
- kamu butuh metrics/inspection/clear all;
- kamu punya dedicated cache library.

Contoh:

```java
record SerializerKey(Class<?> type, String view, boolean includeNulls) {}
```

Jika key bukan hanya `Class<?>`, `ClassValue` mungkin tetap bisa menyimpan metadata dasar per class, lalu map lain menyimpan varian runtime.

Pattern hybrid:

```java
final class SerializerRegistry {
    private static final ClassValue<BasePlan> BASE_PLAN = new ClassValue<>() {
        @Override
        protected BasePlan computeValue(Class<?> type) {
            return BasePlan.scan(type);
        }
    };

    private final ConcurrentHashMap<SerializerKey, Serializer> serializers = new ConcurrentHashMap<>();

    Serializer serializerFor(Class<?> type, String view) {
        BasePlan base = BASE_PLAN.get(type);
        return serializers.computeIfAbsent(new SerializerKey(type, view), key -> compile(base, view));
    }
}
```

---

## 6. Production Pattern: Per-Class Metadata Registry

### 6.1 Example: external code lookup for enums

Misal kamu punya enum yang dipersist sebagai external code, bukan `ordinal()` atau `name()`.

```java
public interface CodedEnum {
    String code();
}
```

```java
public enum CaseStatus implements CodedEnum {
    DRAFT("D"),
    SUBMITTED("S"),
    APPROVED("A"),
    REJECTED("R");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    @Override
    public String code() {
        return code;
    }
}
```

Registry:

```java
public final class CodedEnumLookup {
    private CodedEnumLookup() {}

    private static final ClassValue<Map<String, Enum<?>>> BY_CODE = new ClassValue<>() {
        @Override
        protected Map<String, Enum<?>> computeValue(Class<?> type) {
            if (!type.isEnum()) {
                throw new IllegalArgumentException(type.getName() + " is not an enum");
            }
            if (!CodedEnum.class.isAssignableFrom(type)) {
                throw new IllegalArgumentException(type.getName() + " does not implement CodedEnum");
            }

            Object[] constants = type.getEnumConstants();
            Map<String, Enum<?>> map = new HashMap<>();

            for (Object constant : constants) {
                Enum<?> enumConstant = (Enum<?>) constant;
                CodedEnum coded = (CodedEnum) constant;

                Enum<?> previous = map.put(coded.code(), enumConstant);
                if (previous != null) {
                    throw new IllegalStateException(
                        "Duplicate code '" + coded.code() + "' in " + type.getName()
                    );
                }
            }

            return Map.copyOf(map);
        }
    };

    public static <E extends Enum<E> & CodedEnum> E parse(Class<E> enumType, String code) {
        Objects.requireNonNull(enumType, "enumType");
        Objects.requireNonNull(code, "code");

        Enum<?> value = BY_CODE.get(enumType).get(code);
        if (value == null) {
            throw new IllegalArgumentException(
                "Unknown code '" + code + "' for enum " + enumType.getName()
            );
        }
        return enumType.cast(value);
    }
}
```

Pemakaian:

```java
CaseStatus status = CodedEnumLookup.parse(CaseStatus.class, "S");
```

Kenapa cocok untuk `ClassValue`?

- metadata murni dari enum class;
- mahal sedikit tetapi tidak perlu dihitung ulang;
- scoped per class;
- tidak tergantung request;
- tidak butuh TTL;
- aman terhadap dynamic loading dibanding global map naif.

---

### 6.2 Java 8 compatible variant

`Map.copyOf` baru ada Java 10. Untuk Java 8 baseline, gunakan:

```java
return Collections.unmodifiableMap(new HashMap<>(map));
```

Jika seri ini membahas Java 8–25, setiap contoh production harus sadar API level. Kamu bisa menulis versi modern, tetapi saat membangun library lintas Java 8, jangan compile source yang menggunakan API Java 9+ tanpa isolasi.

---

## 7. `Cleaner` secara Mendalam

### 7.1 Problem finalization

Dulu Java punya `finalize()` pada `Object`. Ide awalnya: sebelum object dikoleksi GC, JVM memanggil method finalizer.

Masalah besar finalization:

- tidak deterministic;
- bisa sangat terlambat;
- bisa tidak pernah sempat berjalan sebelum proses mati;
- punya overhead GC/lifecycle;
- bisa resurrect object;
- rawan deadlock;
- rawan security issue;
- execution thread tidak jelas untuk business logic;
- membuat resource exhaustion lebih mungkin;
- sulit diuji.

JEP 421 mendeprecate finalization for removal dan mendorong migrasi ke `try-with-resources` dan cleaners.

Tetapi cleaner pun bukan silver bullet. Cleaner hanya menghilangkan sebagian bahaya finalizer, bukan mengubah cleanup berbasis GC menjadi deterministic.

---

### 7.2 Reachability mental model

Garbage collector bekerja dengan reachability.

Simplified:

```text
Strongly reachable
  Object masih bisa dicapai dari GC roots via strong reference.

Softly reachable
  Tidak strongly reachable, tetapi masih reachable via SoftReference.

Weakly reachable
  Tidak strongly/softly reachable, tetapi reachable via WeakReference.

Phantom reachable
  Object sudah finalizable/collectable path, tetapi phantom reference bisa diberi notifikasi setelah collector menentukan object tidak lagi reachable secara normal.

Unreachable
  Tidak ada reference yang bisa dipakai untuk mencapai object.
```

`Cleaner` menggunakan phantom-reference-style mechanism. Cleaning action dijalankan setelah object menjadi phantom reachable.

Mental model production:

```text
Object no longer used
   ↓
Eventually GC runs
   ↓
GC detects object phantom reachable
   ↓
Cleaner gets notification
   ↓
Cleaner thread runs cleaning action
```

Kata paling penting: **eventually**.

---

### 7.3 Basic `Cleaner` pattern

Contoh wrapper native handle:

```java
public final class NativeBuffer implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();

    private final State state;
    private final Cleaner.Cleanable cleanable;

    public NativeBuffer(long size) {
        this.state = new State(NativeApi.allocate(size));
        this.cleanable = CLEANER.register(this, state);
    }

    public long address() {
        ensureOpen();
        return state.address;
    }

    @Override
    public void close() {
        cleanable.clean();
    }

    private void ensureOpen() {
        if (state.closed) {
            throw new IllegalStateException("NativeBuffer is closed");
        }
    }

    private static final class State implements Runnable {
        private long address;
        private boolean closed;

        State(long address) {
            this.address = address;
        }

        @Override
        public void run() {
            if (!closed) {
                NativeApi.free(address);
                address = 0;
                closed = true;
            }
        }
    }
}
```

Struktur penting:

```text
NativeBuffer instance
  ├─ State state
  └─ Cleanable cleanable

Cleaner holds cleaning action: State
```

`State` harus static nested class agar tidak menangkap outer `NativeBuffer`.

---

### 7.4 Bug paling berbahaya: cleaning action menangkap referent

Contoh salah:

```java
public final class BadNativeBuffer implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();

    private final long address;
    private final Cleaner.Cleanable cleanable;

    public BadNativeBuffer(long size) {
        this.address = NativeApi.allocate(size);
        this.cleanable = CLEANER.register(this, () -> NativeApi.free(this.address)); // BAD
    }

    @Override
    public void close() {
        cleanable.clean();
    }
}
```

Masalah:

```text
Cleaner
  └─ cleaning action lambda
       └─ captures this
            └─ BadNativeBuffer
```

Cleaner memegang cleaning action. Cleaning action memegang `this`. Maka referent tetap strongly reachable. Object tidak pernah phantom reachable. Cleaning action tidak pernah otomatis berjalan.

Ini menyebabkan leak.

Rule:

> Cleaning action tidak boleh memiliki strong reference ke object yang didaftarkan sebagai referent.

Gunakan static nested `State` class.

---

### 7.5 `clean()` harus idempotent

`Cleaner.Cleanable.clean()` menjamin action dipanggil at most once untuk cleanable tersebut, tetapi cleaning logic tetap sebaiknya idempotent karena:

- native/free API mungkin dipanggil dari path lain;
- close bisa race;
- object lifecycle bisa kompleks;
- defensive design mengurangi double-free risk.

Gunakan atomic state jika concurrency mungkin:

```java
private static final class State implements Runnable {
    private final AtomicLong address;

    State(long address) {
        this.address = new AtomicLong(address);
    }

    @Override
    public void run() {
        long addr = address.getAndSet(0);
        if (addr != 0) {
            NativeApi.free(addr);
        }
    }
}
```

---

### 7.6 `AutoCloseable` tetap primary

Desain resource yang benar:

```java
try (NativeBuffer buffer = new NativeBuffer(1024)) {
    use(buffer);
}
```

`close()` terjadi segera di akhir block.

Cleaner hanya menangani kasus caller lupa:

```java
NativeBuffer buffer = new NativeBuffer(1024);
use(buffer);
// forgot close; Cleaner may eventually clean
```

Kamu tidak boleh membuat API yang “mengandalkan GC” untuk release resource normal.

Checklist:

- expose `close()`;
- document ownership;
- support try-with-resources;
- make close idempotent;
- prevent use after close;
- cleaner only as fallback;
- optionally log leak only if low-volume and safe.

---

## 8. Cleaner Design Variants

### 8.1 Shared cleaner vs per-instance cleaner

Jangan buat `Cleaner.create()` per instance.

Buruk:

```java
public Resource() {
    Cleaner cleaner = Cleaner.create();
    this.cleanable = cleaner.register(this, state);
}
```

Masalah:

- overhead thread/resource;
- cleaner object lifecycle tidak jelas;
- lebih sulit dikontrol.

Lebih baik:

```java
private static final Cleaner CLEANER = Cleaner.create();
```

Atau dependency-injected cleaner untuk library besar:

```java
public final class ResourceFactory {
    private final Cleaner cleaner;

    public ResourceFactory(Cleaner cleaner) {
        this.cleaner = Objects.requireNonNull(cleaner);
    }
}
```

---

### 8.2 Cleaner dengan custom ThreadFactory

`Cleaner.create(ThreadFactory)` memungkinkan kontrol thread.

Use case:

- memberi nama thread;
- daemon status;
- context class loader;
- uncaught exception handler;
- security/context hygiene.

Contoh:

```java
private static final Cleaner CLEANER = Cleaner.create(r -> {
    Thread t = new Thread(r, "my-library-cleaner");
    t.setDaemon(true);
    t.setContextClassLoader(ClassLoader.getPlatformClassLoader());
    t.setUncaughtExceptionHandler((thread, error) -> {
        // Avoid throwing from cleaner thread; log minimal diagnostic.
        System.err.println("Cleaner failure in " + thread.getName() + ": " + error);
    });
    return t;
});
```

Hati-hati Java 8: `ClassLoader.getPlatformClassLoader()` tidak ada. Untuk Java 8 baseline, isolasi kode ini di Java 9+ source atau gunakan fallback.

---

### 8.3 Cleaner action jangan blocking lama

Cleaner thread bukan worker pool untuk cleanup bisnis.

Jangan lakukan:

```java
@Override
public void run() {
    remoteAuditClient.sendCleanupEvent(resourceId); // network I/O, BAD
    NativeApi.free(address);
}
```

Masalah:

- cleaner thread bisa tersumbat;
- cleanup resource lain tertunda;
- network failure masuk ke cleanup path;
- shutdown behavior sulit diprediksi.

Cleaner action harus:

- cepat;
- bounded;
- idempotent;
- tidak blocking lama;
- tidak memanggil kode user arbitrary;
- tidak bergantung pada service container yang mungkin sudah shutdown.

---

## 9. Java 8–25 Compatibility Strategy untuk Cleanup

### 9.1 Baseline Java 8 problem

Jika kamu menulis library dengan `--release 8`, kode ini tidak bisa compile:

```java
import java.lang.ref.Cleaner;
```

Karena `Cleaner` baru Java 9.

Solusi:

1. Drop Java 8 support.
2. Pakai abstraction dan implementation berbeda untuk Java 8 dan Java 9+.
3. Pakai multi-release JAR.
4. Gunakan reflection untuk optional Cleaner API, tetapi hati-hati linkage/test complexity.
5. Hindari cleaner sama sekali dan hanya support explicit close + leak detection optional.

---

### 9.2 Abstraction approach

Interface:

```java
interface CleanupSupport {
    Registration register(Object referent, Runnable action);

    interface Registration {
        void clean();
    }
}
```

Java 8 implementation:

```java
final class ExplicitOnlyCleanupSupport implements CleanupSupport {
    @Override
    public Registration register(Object referent, Runnable action) {
        return new Registration() {
            private final AtomicBoolean cleaned = new AtomicBoolean();

            @Override
            public void clean() {
                if (cleaned.compareAndSet(false, true)) {
                    action.run();
                }
            }
        };
    }
}
```

Java 9+ implementation:

```java
final class CleanerCleanupSupport implements CleanupSupport {
    private final Cleaner cleaner;

    CleanerCleanupSupport(Cleaner cleaner) {
        this.cleaner = cleaner;
    }

    @Override
    public Registration register(Object referent, Runnable action) {
        Cleaner.Cleanable cleanable = cleaner.register(referent, action);
        return cleanable::clean;
    }
}
```

Dengan multi-release JAR, Java 9+ bisa memakai cleaner, Java 8 memakai explicit cleanup only.

---

### 9.3 Jangan memakai finalizer sebagai fallback Java 8

Godaan legacy:

```java
@Override
protected void finalize() throws Throwable {
    close();
}
```

Hindari.

Lebih baik:

- dokumentasikan bahwa Java 8 path membutuhkan explicit close;
- tambahkan test leak detection di development;
- gunakan `AutoCloseable`;
- gunakan ownership API jelas;
- sediakan factory yang mendorong try-with-resources.

Finalizer memperkenalkan class of problems yang lebih buruk daripada manfaat fallback-nya.

---

## 10. Runtime-Attached Metadata Pattern

`ClassValue` dan `Cleaner` terlihat tidak berhubungan, tetapi keduanya sama-sama beroperasi pada **runtime attachment**:

- `ClassValue`: attach metadata ke `Class` lifecycle.
- `Cleaner`: attach cleanup action ke object reachability lifecycle.

Keduanya menuntut disiplin lifecycle.

### 10.1 Salah lifecycle = leak

Salah `ClassValue`:

```java
ClassValue<Metadata> value contains ApplicationContext
```

Akibat: metadata class-level menahan container/request lifecycle.

Salah `Cleaner`:

```java
Cleaner action captures this
```

Akibat: referent tidak pernah phantom reachable.

Prinsip:

```text
Attached value/action must not accidentally extend lifetime of the thing it is attached to.
```

---

### 10.2 Metadata sebaiknya immutable

Class metadata ideal:

```java
final class BeanPlan {
    private final List<PropertyPlan> properties;
    private final MethodHandle constructor;

    BeanPlan(List<PropertyPlan> properties, MethodHandle constructor) {
        this.properties = List.copyOf(properties);
        this.constructor = constructor;
    }
}
```

Untuk Java 8:

```java
this.properties = Collections.unmodifiableList(new ArrayList<>(properties));
```

Kenapa immutable?

- safe sharing;
- no locking;
- no stale mutation;
- easier invalidation;
- easier reasoning;
- fewer concurrency bugs.

---

## 11. Failure Modes

### 11.1 `Map<Class<?>, Metadata>` leak

Symptom:

- memory/metaspace naik setelah redeploy;
- old class loader muncul di heap dump;
- static cache dari framework menahan app class;
- GC tidak membebaskan class metadata.

Fix:

- gunakan `ClassValue` untuk per-class metadata;
- gunakan weak keys jika butuh map, tapi hati-hati value juga bisa memegang key;
- sediakan lifecycle clear;
- hindari static cache di parent loader untuk app class;
- audit cache values.

---

### 11.2 `WeakHashMap<Class<?>, Metadata>` yang tetap leak

Banyak engineer berpikir `WeakHashMap<Class<?>, Metadata>` otomatis aman.

Contoh:

```java
Map<Class<?>, Metadata> cache = new WeakHashMap<>();
```

Tetapi jika value memegang key secara strong:

```java
final class Metadata {
    final Class<?> type;
}
```

Maka graph:

```text
WeakHashMap entry value -> Metadata -> Class key
```

Key tetap reachable dari value. Entry tidak hilang.

Ini disebut weak-key/value-back-reference trap.

Solusi:

- `ClassValue`;
- jangan simpan `Class<?>` di value jika tidak perlu;
- gunakan `WeakReference` di value dengan hati-hati;
- lifecycle explicit clear.

---

### 11.3 `computeValue` terlalu berat

Symptom:

- request pertama lambat;
- startup lazy spikes;
- metadata scan terjadi pada latency-sensitive path;
- class init deadlock/slowdown.

Fix:

- warm up metadata saat startup untuk class penting;
- keep compute local and bounded;
- avoid network/disk I/O;
- benchmark reflection scan;
- precompute via annotation processing bila perlu.

---

### 11.4 Cleaner action menangkap referent

Symptom:

- `close()` manual bekerja;
- automatic cleanup tidak pernah terjadi;
- native memory/off-heap leak;
- heap dump menunjukkan lambda cleaner menahan object.

Fix:

- static nested state class;
- cleaning action hanya punya primitive/resource handle;
- jangan capture `this`;
- test dengan phantom/weak reachability harness jika penting.

---

### 11.5 Cleaner dijadikan business lifecycle

Buruk:

```java
class TransactionScope {
    // Cleaner rollback transaction if not committed
}
```

Kenapa salah:

- transaction harus deterministic;
- rollback telat bisa mengunci resource;
- failure semantics tidak jelas;
- shutdown process bisa melewati cleanup;
- observability buruk.

Fix:

- explicit `commit/rollback/close`;
- try-with-resources;
- transaction manager;
- timeout external;
- cleaner hanya optional diagnostic.

---

### 11.6 Cleaner action bergantung pada service yang sudah shutdown

Contoh:

```java
private static final class State implements Runnable {
    private final AuditService auditService;

    @Override
    public void run() {
        auditService.recordCleanup();
    }
}
```

Saat JVM shutdown atau container undeploy, `auditService` mungkin sudah mati.

Fix:

- cleaner action hanya release low-level resource;
- jangan gunakan application service;
- logging minimal;
- no remote dependency.

---

## 12. Performance, Memory, and Security Considerations

### 12.1 `ClassValue` performance

`ClassValue` cocok untuk metadata yang:

- dihitung sekali;
- dibaca sering;
- scoped by class;
- immutable.

Tetapi jangan pakai `ClassValue` untuk:

- data per request;
- dynamic policy yang berubah tiap menit;
- metrics counter high-frequency;
- cache dengan banyak varian per class;
- resource yang perlu close.

---

### 12.2 Reflection metadata cost

Sering kali `ClassValue` dipakai untuk cache hasil reflection.

Hati-hati:

- scanning annotation bisa mahal;
- `setAccessible`/deep reflection terkena JPMS boundary;
- method handle lookup bisa butuh access mode;
- record/sealed metadata Java version dependent;
- metadata bisa memicu class loading tambahan.

Pattern:

```text
Scan once -> validate -> compile immutable plan -> use plan in hot path
```

---

### 12.3 Cleaner memory cost

Setiap registration punya overhead:

- cleanable object;
- state object;
- reference tracking;
- cleaner queue.

Jangan daftarkan cleaner untuk object kecil yang jumlahnya jutaan kalau cleanup-nya tidak penting.

Cleaner cocok untuk object yang membungkus resource mahal:

- native memory;
- file descriptor;
- OS handle;
- mapped memory;
- direct-ish resource;
- library native context.

---

### 12.4 Security

`Cleaner` bisa berbahaya jika action menjalankan kode kompleks setelah object tidak lagi dikontrol caller.

Risiko:

- cleaner thread menjalankan action dengan context tak terduga;
- class loader context salah;
- action memakai stale credentials/context;
- action melakukan I/O dengan data sensitif;
- exception di cleanup path menghilangkan evidence.

Rule:

```text
Cleaner action must be boring.
```

Boring berarti:

- release handle;
- set state closed;
- no secrets;
- no remote call;
- no business mutation;
- no user callback.

---

## 13. Design Heuristics untuk Top-Level Engineering

### 13.1 Untuk metadata per class

Tanyakan:

1. Apakah key utama benar-benar `Class<?>`?
2. Apakah value murni turunan dari class itu?
3. Apakah value bisa immutable?
4. Apakah value perlu invalidation?
5. Apakah library akan hidup di parent loader dan menerima class dari child loader?
6. Apakah value menyimpan reference ke class loader lain?
7. Apakah computation bisa dilakukan tanpa I/O?
8. Apakah duplicate computation aman?

Jika jawaban mayoritas “ya”, `ClassValue` kemungkinan tepat.

---

### 13.2 Untuk resource cleanup

Tanyakan:

1. Apakah resource harus dilepas segera?
2. Apakah resource terbatas?
3. Apakah caller bisa diberi ownership jelas?
4. Apakah API bisa `AutoCloseable`?
5. Apakah cleaner hanya fallback?
6. Apakah cleaning action tidak capture referent?
7. Apakah action cepat dan idempotent?
8. Apakah Java 8 masih perlu support?

Jika resource harus deterministic, jangan mengandalkan Cleaner.

---

## 14. Capstone Mini Example: Safe Metadata + Cleanup Utility

Di bawah ini contoh desain kecil yang menggabungkan dua ide part ini.

### 14.1 Metadata cache untuk resource wrapper type

```java
public final class ResourceIntrospector {
    private ResourceIntrospector() {}

    private static final ClassValue<ResourceTypeMetadata> METADATA = new ClassValue<>() {
        @Override
        protected ResourceTypeMetadata computeValue(Class<?> type) {
            return ResourceTypeMetadata.scan(type);
        }
    };

    public static ResourceTypeMetadata metadataFor(Class<?> type) {
        return METADATA.get(Objects.requireNonNull(type, "type"));
    }

    public static void invalidate(Class<?> type) {
        METADATA.remove(Objects.requireNonNull(type, "type"));
    }
}
```

```java
public final class ResourceTypeMetadata {
    private final String typeName;
    private final boolean autoCloseable;

    private ResourceTypeMetadata(String typeName, boolean autoCloseable) {
        this.typeName = typeName;
        this.autoCloseable = autoCloseable;
    }

    public static ResourceTypeMetadata scan(Class<?> type) {
        return new ResourceTypeMetadata(
            type.getName(),
            AutoCloseable.class.isAssignableFrom(type)
        );
    }

    public String typeName() {
        return typeName;
    }

    public boolean autoCloseable() {
        return autoCloseable;
    }
}
```

Java 8 note: record accessor style tidak dipakai agar compatible.

---

### 14.2 Resource wrapper with Cleaner for Java 9+

```java
public final class ManagedHandle implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();

    private final State state;
    private final Cleaner.Cleanable cleanable;

    public ManagedHandle() {
        this.state = new State(NativeApi.open());
        this.cleanable = CLEANER.register(this, state);
    }

    public void doWork() {
        long handle = state.requireOpen();
        NativeApi.doWork(handle);
    }

    @Override
    public void close() {
        cleanable.clean();
    }

    private static final class State implements Runnable {
        private final AtomicLong handle;

        State(long handle) {
            this.handle = new AtomicLong(handle);
        }

        long requireOpen() {
            long current = handle.get();
            if (current == 0) {
                throw new IllegalStateException("Handle is closed");
            }
            return current;
        }

        @Override
        public void run() {
            long current = handle.getAndSet(0);
            if (current != 0) {
                NativeApi.close(current);
            }
        }
    }
}
```

Apa yang benar:

- `ManagedHandle` implements `AutoCloseable`;
- `close()` deterministic;
- cleaner fallback;
- `State` static nested;
- cleaning action tidak capture `ManagedHandle`;
- double clean safe;
- use-after-close ditolak.

---

## 15. Testing Strategy

### 15.1 Test `ClassValue`

Test yang berguna:

```java
class MetadataCacheTest {
    @Test
    void returnsSameMetadataForSameClass() {
        ModelMetadata a = MetadataCache.get(MyType.class);
        ModelMetadata b = MetadataCache.get(MyType.class);
        assertSame(a, b);
    }

    @Test
    void invalidationRecomputesMetadata() {
        ModelMetadata a = MetadataCache.get(MyType.class);
        MetadataCache.invalidate(MyType.class);
        ModelMetadata b = MetadataCache.get(MyType.class);
        assertNotSame(a, b);
    }
}
```

Untuk class loader leak, unit test biasa sering tidak cukup. Perlu integration test yang:

- membuat custom class loader;
- load class;
- access metadata;
- drop strong reference;
- force GC best effort;
- assert weak reference eventually cleared.

Tetapi test GC-sensitive bisa flaky. Gunakan sebagai diagnostic/integration test, bukan unit test deterministik utama.

---

### 15.2 Test Cleaner

Test utama bukan “GC pasti memanggil cleaner”. Test utama harus memastikan `close()` benar.

```java
@Test
void closeReleasesResourceOnce() {
    FakeNativeApi api = new FakeNativeApi();

    ManagedHandle handle = ManagedHandle.open(api);
    handle.close();
    handle.close();

    assertEquals(1, api.closeCount());
}
```

Cleaner fallback bisa dites dengan harness khusus, tetapi jangan jadikan correctness sistem bergantung pada test GC timing.

---

## 16. Production Checklist

### 16.1 `ClassValue` checklist

Sebelum memakai `ClassValue`, pastikan:

- [ ] value adalah metadata per class;
- [ ] computation deterministic;
- [ ] computation tidak melakukan remote I/O;
- [ ] computation aman jika terjadi lebih dari sekali;
- [ ] value immutable atau effectively immutable;
- [ ] value tidak menyimpan request/user/tenant state;
- [ ] value tidak menahan service container tanpa alasan kuat;
- [ ] invalidation strategy jelas jika metadata bisa berubah;
- [ ] Java 8 compatibility aman;
- [ ] class loader leak dianalisis.

---

### 16.2 Cleaner checklist

Sebelum memakai `Cleaner`, pastikan:

- [ ] resource punya `close()` eksplisit;
- [ ] class implements `AutoCloseable`;
- [ ] cleaner hanya fallback;
- [ ] cleaning action tidak capture referent;
- [ ] cleaning action cepat;
- [ ] cleaning action idempotent;
- [ ] cleaning action tidak remote I/O;
- [ ] cleaning action tidak business logic;
- [ ] cleaning action tidak bergantung pada service yang bisa shutdown lebih dulu;
- [ ] Java 8 strategy jelas;
- [ ] failure cleanup tidak menyembunyikan bug utama.

---

## 17. Thought Exercises

### Exercise 1 — Mapper metadata

Kamu membangun mapper untuk 2000 DTO class. Metadata scan mahal, tetapi hasil scan hanya bergantung pada class. Aplikasi berjalan di servlet container yang bisa redeploy.

Pertanyaan:

1. Apakah `ClassValue` cocok?
2. Apa yang tidak boleh disimpan dalam metadata?
3. Bagaimana invalidation jika annotation config berubah?
4. Apa risiko `ConcurrentHashMap<Class<?>, Metadata>`?

Jawaban inti:

- `ClassValue` cocok untuk metadata per class;
- jangan simpan application context/request/session;
- invalidation bisa via `remove(type)` atau lifecycle rebuild;
- map global bisa menahan app class loader setelah redeploy.

---

### Exercise 2 — Native resource wrapper

Kamu membangun wrapper untuk native image processing context yang memegang native memory besar.

Pertanyaan:

1. Apakah cukup memakai `Cleaner`?
2. Apa API publik yang harus disediakan?
3. Apa struktur cleaning action yang aman?
4. Apa yang harus terjadi jika `process()` dipanggil setelah `close()`?

Jawaban inti:

- tidak cukup;
- harus `AutoCloseable` dan mendukung try-with-resources;
- static state object, no capture referent;
- throw `IllegalStateException`.

---

### Exercise 3 — WeakHashMap trap

Kamu memakai `WeakHashMap<Class<?>, Metadata>`, tetapi heap dump tetap menunjukkan class loader leak. Metadata menyimpan `Class<?> type`.

Pertanyaan:

1. Kenapa leak tetap terjadi?
2. Bagaimana memperbaikinya?

Jawaban inti:

- value memegang key secara strong sehingga weak key tidak bisa hilang;
- gunakan `ClassValue`, atau hilangkan back-reference strong, atau lifecycle clear eksplisit.

---

## 18. Ringkasan

`ClassValue` dan `Cleaner` adalah API kecil yang mengajarkan prinsip besar: **runtime lifecycle matters**.

`ClassValue` membantu menyimpan metadata per class tanpa membuat static global map yang mudah menahan class loader. Ia sangat cocok untuk framework dan library yang menghitung metadata dari class: serializer plan, validator metadata, enum lookup, mapper metadata, accessor cache, dan sejenisnya. Tetapi value harus immutable, computation harus pure-ish, dan lifecycle harus dipahami.

`Cleaner` membantu membuat fallback cleanup yang lebih aman daripada finalizer, tetapi tetap bukan deterministic resource management. Resource serius harus punya `close()`, memakai `AutoCloseable`, dan didesain untuk try-with-resources. Cleaner hanya safety net. Cleaning action harus static/terpisah, tidak capture referent, cepat, idempotent, dan tidak menjalankan business logic.

Mental model utama part ini:

```text
ClassValue:
  Attach metadata to Class lifecycle.
  Good for per-class derived immutable metadata.
  Avoid naive Class-keyed global cache leaks.

Cleaner:
  Attach cleanup action to object reachability lifecycle.
  Good as fallback for forgotten close.
  Not a replacement for deterministic close.
```

Engineer yang kuat tidak hanya bertanya “API apa yang tersedia?”, tetapi juga:

- siapa yang memegang reference ke siapa?
- lifecycle siapa lebih panjang?
- kapan resource harus dilepas?
- apakah cleanup deterministic?
- apakah cache bisa unload?
- apakah computation aman jika terjadi ulang?

Di production, jawaban atas pertanyaan itu sering lebih menentukan stabilitas sistem daripada pilihan framework.

---

## 19. Referensi

- Java SE 25 API — `java.lang.ClassValue`.
- Java SE 25 API — `java.lang.ref.Cleaner`.
- Java SE 25 API — `Cleaner.Cleanable`.
- Java SE 25 API — `AutoCloseable`.
- OpenJDK JEP 421 — Deprecate Finalization for Removal.
- Java SE 8 API — baseline compatibility untuk `ClassValue` dan absennya `Cleaner`.

---

## 20. Status Seri

Progress setelah part ini:

```text
Part 0  selesai
Part 1  selesai
Part 2  selesai
Part 3  selesai
Part 4  selesai
Part 5  selesai
Part 6  selesai
Part 7  selesai
Part 8  selesai
Part 9  selesai
Part 10 selesai
Part 11 selesai
Part 12 selesai
Part 13 selesai
Part 14 selesai
Part 15 selesai
Part 16 selesai
Part 17 selesai
Part 18 selesai
Part 19 selesai
Part 20 selesai
Part 21 selesai
Part 22 selesai
Part 23 selesai
Part 24 belum
...
Part 32 belum
```

Seri belum selesai. Part berikutnya adalah:

**Part 24 — DOM Mental Model: Document as Mutable Tree, Node Identity, Ownership**

File berikutnya:

```text
24-dom-mental-model-document-node-tree-ownership.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 22 — `FunctionalInterface`, Lambda Runtime Support, `invokedynamic`, and `java.lang.invoke` Boundary](./22-functionalinterface-lambda-runtime-support-invokedynamic-boundary.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 24 — DOM Mental Model: Document as Mutable Tree, Node Identity, Ownership](./24-dom-mental-model-document-node-tree-ownership.md)
