# learn-java-memory-byte-bit-buffer-offheap-gc-part-008

# Java References Deep Dive: Strong, Soft, Weak, Phantom, Cleaner

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `008`  
> Topik: `Java References Deep Dive: Strong, Soft, Weak, Phantom, Cleaner`  
> Target Java: 8 sampai 25  
> Level: advanced / production engineering

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas **object lifetime engineering**: object yang sangat pendek umur, object yang hidup cukup lama sampai terpromosi, dan object yang memang long-lived. Sekarang kita masuk ke mekanisme yang lebih halus: **jenis reference**.

Java bukan hanya punya “pointer ke object”. Java punya beberapa level reference yang berinteraksi langsung dengan garbage collector:

1. **Strong reference**
2. **Soft reference**
3. **Weak reference**
4. **Phantom reference**
5. **ReferenceQueue**
6. **Cleaner**
7. **Finalization** sebagai legacy mechanism yang harus dihindari

Topik ini penting karena banyak bug memory production tidak terjadi karena object “tidak bisa di-GC” secara misterius. Sering kali masalahnya adalah kita salah memahami:

- object masih **strongly reachable**;
- cache memakai reference type yang keliru;
- `WeakHashMap` dianggap otomatis membersihkan value padahal key/value graph masih menahan object;
- resource native/off-heap mengandalkan finalizer/Cleaner secara tidak disiplin;
- reference processing menyebabkan latency spike;
- object sudah unreachable dari business logic, tetapi masih reachable dari listener, queue, ThreadLocal, static holder, lambda capture, atau executor task.

Bagian ini bukan sekadar “SoftReference untuk cache, WeakReference untuk listener, PhantomReference untuk cleanup”. Itu terlalu dangkal. Kita akan membangun model mental tentang **reachability lattice**: bagaimana GC menilai object, kapan reference di-clear, kapan masuk queue, dan kenapa referent yang terlihat “tidak dipakai” belum tentu eligible untuk reclamation.

---

## 1. Mental Model Utama: GC Tidak Menghapus Object, GC Menghapus Object yang Tidak Reachable

Dalam Java, object tidak hidup karena “masih ada di heap”. Semua object ada di heap sampai memory-nya direklamasi. Yang menentukan object boleh direklamasi adalah **reachability**.

Secara sederhana:

```text
GC roots
  ↓
strong references
  ↓
reachable objects
```

GC roots meliputi hal-hal seperti:

- local variable pada stack frame aktif;
- static fields;
- JNI handles;
- thread object aktif;
- monitor/lock tertentu;
- class metadata yang masih hidup;
- reference dari runtime JVM sendiri.

Object yang dapat dicapai dari root lewat rantai strong reference dianggap **strongly reachable** dan tidak boleh dihapus.

Namun Java menyediakan reference yang lebih lemah dari strong reference. Ini membuat status object tidak lagi hanya “reachable” atau “unreachable”, tetapi punya beberapa level.

---

## 2. Reachability Levels

Model yang perlu diingat:

```text
strongly reachable
  ↓ kalau tidak ada strong path
softly reachable
  ↓ kalau tidak ada soft/strong path
weakly reachable
  ↓ kalau tidak ada weak/soft/strong path
phantom reachable
  ↓ setelah finalization/cleanup eligibility tertentu
unreachable
```

Tabel ringkas:

| Level | Arti Praktis | Bisa diakses via `get()`? | Kapan GC boleh clear? | Use Case Umum |
|---|---|---:|---|---|
| Strong | Ada path normal dari GC root | Ya | Tidak selama strong path ada | Hampir semua object normal |
| Soft | Hanya ditahan SoftReference | Ya, sampai di-clear | Saat memory pressure / keputusan GC | Memory-sensitive cache, tapi sering bukan pilihan terbaik |
| Weak | Hanya ditahan WeakReference | Ya, sampai di-clear | Pada GC cycle ketika weakly reachable | canonical map, metadata non-owning, observer lemah |
| Phantom | Object sudah tidak bisa diakses normal, tapi lifecycle cleanup bisa dilacak | Tidak, `get()` selalu `null` | Setelah masuk tahap phantom reachability | native/off-heap cleanup, post-mortem notification |
| Unreachable | Tidak ada path relevan | Tidak | Boleh direklamasi | Sampah |

Yang paling penting:

> Reference lemah bukan “pointer spesial yang mencegah leak”. Reference lemah adalah kontrak dengan GC tentang **seberapa kuat** object boleh dipertahankan.

---

## 3. Strong Reference

Strong reference adalah reference biasa.

```java
User user = new User("alice");
```

Selama `user` masih reachable dari stack frame aktif, static field, collection, queue, atau object lain yang strongly reachable, maka `User` tidak eligible untuk GC.

Contoh strong reference lewat collection:

```java
static final List<byte[]> RETAINED = new ArrayList<>();

void handleRequest() {
    byte[] payload = new byte[10 * 1024 * 1024];
    RETAINED.add(payload);
}
```

Walaupun method selesai, `payload` tetap hidup karena:

```text
GC root
  ↓
Class object/static field RETAINED
  ↓
ArrayList
  ↓
elementData[]
  ↓
byte[] payload
```

Inilah bentuk leak paling umum di Java: bukan memory yang “hilang”, tetapi object graph yang masih reachable dari root yang salah.

---

## 4. Strong Reference dan Ownership

Untuk engineering produksi, strong reference harus dipahami sebagai **ownership signal**.

Jika object A menyimpan strong reference ke object B, maka A pada dasarnya berkata:

> “Selama aku hidup, B juga harus hidup.”

Contoh:

```java
final class OrderAggregate {
    private final List<OrderLine> lines;
}
```

Ini masuk akal. `OrderAggregate` memang memiliki `OrderLine`.

Namun ini berbahaya:

```java
final class AuditContext {
    private final HttpServletRequest request;
    private final Object fullBusinessObject;
    private final byte[] uploadedFile;
}
```

Jika `AuditContext` masuk async queue dan diproses 10 menit kemudian, maka semua object besar ikut tertahan.

Model yang lebih baik:

```java
record AuditEvent(
    String correlationId,
    String actorId,
    String module,
    String action,
    Instant occurredAt
) {}
```

Prinsip:

> Strong reference harus menyimpan **data yang memang dimiliki**, bukan object accidental yang kebetulan tersedia saat method dipanggil.

---

## 5. SoftReference

`SoftReference<T>` adalah reference yang lebih lemah dari strong reference, tetapi lebih kuat dari weak reference.

Contoh:

```java
SoftReference<byte[]> ref = new SoftReference<>(new byte[10 * 1024 * 1024]);

byte[] data = ref.get();
if (data != null) {
    // masih tersedia
} else {
    // sudah di-clear oleh GC
}
```

Object yang hanya reachable lewat `SoftReference` disebut **softly reachable**.

GC boleh mempertahankan soft object selama memory masih cukup, dan boleh membersihkannya saat memory pressure.

---

## 6. SoftReference Bukan Cache Policy yang Baik untuk Banyak Sistem Modern

Secara historis, `SoftReference` sering dipakai untuk cache:

```java
Map<Key, SoftReference<Value>> cache = new ConcurrentHashMap<>();
```

Idenya:

```text
kalau memory cukup → value tetap ada
kalau memory kurang → GC boleh buang
```

Terdengar bagus, tetapi dalam sistem produksi modern sering bermasalah.

### 6.1 Masalah 1: Policy Tidak Eksplisit

Cache yang sehat biasanya butuh policy jelas:

- maksimum size;
- maksimum weight;
- TTL;
- idle expiration;
- admission policy;
- eviction policy;
- per-tenant limit;
- observability hit/miss/eviction.

SoftReference menyerahkan sebagian besar keputusan eviction ke GC. Ini membuat perilaku cache menjadi sulit diprediksi.

### 6.2 Masalah 2: Cache Bisa Terlihat Bagus Sampai Tiba-tiba Buruk

Selama heap besar, soft values dapat bertahan lama. Lalu saat memory pressure, banyak soft values bisa di-clear. Akibatnya:

```text
heap pressure naik
  ↓
GC clear banyak soft reference
  ↓
cache miss storm
  ↓
recompute / reload besar-besaran
  ↓
allocation naik
  ↓
GC pressure makin tinggi
```

Ini bisa menciptakan feedback loop buruk.

### 6.3 Masalah 3: Reference Object-nya Sendiri Tetap Ada

Jika cache map menyimpan `SoftReference`, maka entry map tetap ada meskipun referent sudah di-clear.

```java
Map<String, SoftReference<byte[]>> cache = new ConcurrentHashMap<>();
```

Setelah referent hilang:

```text
cache
  ↓
entry
  ↓
key String
  ↓
SoftReference object
  ↓
referent = null
```

Jika tidak dibersihkan, map tetap membesar dengan dead entries.

### 6.4 Rekomendasi Praktis

Untuk cache aplikasi, biasanya lebih baik gunakan cache eksplisit seperti:

- bounded LRU/LFU;
- size-based eviction;
- weight-based eviction;
- TTL;
- refresh policy;
- metrics.

SoftReference masih bisa berguna untuk kasus tertentu, tetapi jangan jadikan default cache design.

---

## 7. WeakReference

`WeakReference<T>` lebih lemah daripada `SoftReference`.

Jika object hanya reachable lewat weak reference, GC boleh membersihkannya pada cycle berikutnya.

Contoh:

```java
WeakReference<User> ref = new WeakReference<>(new User("alice"));

User user = ref.get();
if (user != null) {
    // referent masih hidup saat ini
}
```

Setelah tidak ada strong reference lain, referent bisa di-clear.

Pola umum:

```text
WeakReference tidak memiliki object.
WeakReference hanya mengamati object kalau object itu masih hidup karena pihak lain.
```

---

## 8. WeakReference sebagai Non-Owning Reference

Weak reference cocok ketika relasi antar object bukan ownership.

Misalnya registry ingin mengasosiasikan metadata dengan object, tetapi registry tidak boleh memperpanjang umur object tersebut.

```java
final class MetadataRegistry {
    private final Map<WeakReference<Object>, Metadata> metadata = new HashMap<>();
}
```

Namun implementasi seperti ini jarang cukup, karena weak reference yang sudah clear harus dibersihkan dari map. Karena itu biasanya dibutuhkan `ReferenceQueue`.

---

## 9. WeakHashMap: Berguna, tetapi Sering Disalahpahami

`WeakHashMap<K,V>` menyimpan key sebagai weak reference.

Artinya entry dapat hilang jika key tidak lagi strongly reachable di tempat lain.

Contoh:

```java
Map<Object, String> map = new WeakHashMap<>();
Object key = new Object();

map.put(key, "metadata");

key = null;
// setelah GC, entry dapat hilang
```

Namun ada jebakan besar.

### 9.1 Value Bisa Menahan Key

```java
Map<Key, Value> map = new WeakHashMap<>();

Key key = new Key("A");
Value value = new Value(key); // value menyimpan strong reference ke key

map.put(key, value);
key = null;
```

Graph-nya:

```text
WeakHashMap
  ↓ strong
Entry
  ↓ strong
Value
  ↓ strong
Key
```

Walaupun key di sisi map weak, value justru menahan key secara strong. Akibatnya key tetap reachable, entry tidak hilang.

Prinsip:

> Dalam `WeakHashMap`, value tidak boleh strongly reference key jika tujuan weak-key cleanup ingin bekerja.

### 9.2 String Key Bisa Tertahan oleh Interning atau Constant Pool

```java
map.put("USER:123", value);
```

String literal biasanya interned dan strongly reachable dari class metadata. Maka weak key tidak akan hilang seperti yang diharapkan.

Untuk key berbasis string, WeakHashMap sering bukan solusi.

### 9.3 WeakHashMap Bukan Cache Umum

WeakHashMap tidak berarti “cache otomatis aman”. Ia cocok untuk metadata yang hidup selama key hidup di tempat lain.

Contoh cocok:

```text
Object instance → derived metadata
ClassLoader → metadata
UI component → listener metadata
```

Contoh kurang cocok:

```text
userId string → user profile
postal code → geocoding result
query string → database result
```

Untuk cache domain, gunakan bounded cache eksplisit.

---

## 10. PhantomReference

`PhantomReference<T>` adalah reference paling lemah di antara reference object standar.

Ciri utama:

```java
PhantomReference<Object> ref = new PhantomReference<>(obj, queue);
ref.get(); // selalu null
```

Berbeda dari soft/weak reference, phantom reference tidak digunakan untuk “mengambil lagi” object. Ia digunakan untuk mengetahui bahwa object sudah tidak dapat digunakan lagi dan resource eksternal yang terkait bisa dibersihkan.

Model:

```text
object sudah tidak strongly/softly/weakly reachable
  ↓
GC menentukan object phantom reachable
  ↓
PhantomReference dienqueue ke ReferenceQueue
  ↓
cleanup logic bisa berjalan berdasarkan metadata di luar referent
```

Karena `get()` selalu null, cleanup tidak boleh membutuhkan object asli. Semua informasi cleanup harus disimpan terpisah.

---

## 11. ReferenceQueue

`ReferenceQueue<T>` adalah queue tempat reference object dimasukkan setelah GC membersihkan/menentukan status referent.

Contoh weak reference dengan queue:

```java
ReferenceQueue<Object> queue = new ReferenceQueue<>();
WeakReference<Object> ref = new WeakReference<>(new Object(), queue);

Reference<?> cleared = queue.poll();
if (cleared != null) {
    // referent sudah di-clear; bersihkan bookkeeping
}
```

`ReferenceQueue` penting karena tanpa queue, kita tidak tahu kapan referent sudah hilang dan kapan metadata perlu dibersihkan.

---

## 12. Pola ReferenceQueue untuk Membersihkan Map

Contoh struktur sederhana:

```java
final class WeakIdentityRegistry<V> {
    private final ReferenceQueue<Object> queue = new ReferenceQueue<>();
    private final Map<IdentityWeakReference, V> map = new HashMap<>();

    public void put(Object key, V value) {
        expungeStaleEntries();
        map.put(new IdentityWeakReference(key, queue), value);
    }

    public V get(Object key) {
        expungeStaleEntries();
        return map.get(new IdentityWeakReference(key, null));
    }

    private void expungeStaleEntries() {
        Reference<?> ref;
        while ((ref = queue.poll()) != null) {
            map.remove(ref);
        }
    }

    private static final class IdentityWeakReference extends WeakReference<Object> {
        private final int hash;

        IdentityWeakReference(Object referent, ReferenceQueue<Object> queue) {
            super(referent, queue);
            this.hash = System.identityHashCode(referent);
        }

        @Override
        public int hashCode() {
            return hash;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) return true;
            if (!(other instanceof IdentityWeakReference that)) return false;
            return this.get() == that.get();
        }
    }
}
```

Catatan penting:

- hash disimpan karena setelah referent clear, `get()` menjadi null;
- cleanup dilakukan secara berkala;
- value jangan menahan key;
- implementasi production perlu concurrency discipline.

---

## 13. Cleaner

`Cleaner` adalah API untuk menjalankan cleanup action ketika object menjadi phantom reachable.

Pola dasarnya:

```java
import java.lang.ref.Cleaner;

public final class NativeBuffer implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();

    private final State state;
    private final Cleaner.Cleanable cleanable;

    public NativeBuffer(long size) {
        this.state = new State(size);
        this.cleanable = CLEANER.register(this, state);
    }

    @Override
    public void close() {
        cleanable.clean();
    }

    private static final class State implements Runnable {
        private long address;

        State(long size) {
            this.address = allocateNative(size);
        }

        @Override
        public void run() {
            if (address != 0) {
                freeNative(address);
                address = 0;
            }
        }
    }

    private static long allocateNative(long size) {
        throw new UnsupportedOperationException("example");
    }

    private static void freeNative(long address) {
        throw new UnsupportedOperationException("example");
    }
}
```

Yang penting:

```text
NativeBuffer object
  ↓ has State
Cleaner has cleaning action State
```

Tetapi `State` **tidak boleh** menyimpan reference ke `NativeBuffer`.

Jika `State` menyimpan outer object, object tidak akan unreachable.

Salah:

```java
public final class BadNativeBuffer implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();
    private final Cleaner.Cleanable cleanable;

    public BadNativeBuffer() {
        this.cleanable = CLEANER.register(this, () -> {
            // lambda capture this secara implisit/eksplisit bisa berbahaya
            this.release();
        });
    }

    private void release() {}

    @Override
    public void close() {
        cleanable.clean();
    }
}
```

Masalah:

```text
Cleaner
  ↓
cleaning action lambda
  ↓
this BadNativeBuffer
```

Akibatnya referent bisa tertahan oleh cleanup action-nya sendiri.

Prinsip:

> Cleaner action harus static-style state object yang tidak mereferensikan object yang sedang dibersihkan.

---

## 14. Cleaner Bukan Pengganti `close()`

Cleaner adalah safety net, bukan lifecycle utama.

Benar:

```java
try (NativeBuffer buffer = new NativeBuffer(1024)) {
    // use buffer
}
```

`close()` harus menjadi jalur normal.

Cleaner hanya untuk kasus:

```text
programmer lupa close
  ↓
object akhirnya unreachable
  ↓
Cleaner mencoba membersihkan resource
```

Namun Cleaner punya kelemahan:

- tidak deterministic;
- bergantung pada GC cycle;
- cleanup bisa terlambat;
- cleanup berjalan di thread terpisah;
- cleanup action lambat bisa menumpuk;
- tidak cocok untuk resource yang harus dilepas tepat waktu;
- tidak menggantikan backpressure resource.

Untuk file/socket/native memory besar, mengandalkan Cleaner saja bisa menyebabkan resource exhaustion sebelum GC merasa perlu berjalan.

---

## 15. Finalization: Legacy Mechanism yang Harus Dihindari

Finalization adalah mekanisme lama melalui `finalize()`.

Contoh lama:

```java
@Override
protected void finalize() throws Throwable {
    try {
        releaseNativeResource();
    } finally {
        super.finalize();
    }
}
```

Ini harus dihindari.

Masalah finalization:

1. Tidak deterministic.
2. Bisa delay sangat lama.
3. Bisa menyebabkan resurrection.
4. Menambah kerja GC.
5. Sulit diprediksi dalam low-latency system.
6. Berisiko security dan reliability.
7. Deprecated for removal.

Object resurrection:

```java
final class Zombie {
    static Zombie saved;

    @Override
    protected void finalize() {
        saved = this; // object hidup lagi
    }
}
```

Ini membuat lifecycle object kacau.

Alternatif modern:

1. `AutoCloseable` + try-with-resources.
2. `Cleaner` sebagai fallback.
3. `PhantomReference` + `ReferenceQueue` untuk framework-level cleanup.
4. `MemorySegment`/`Arena` untuk off-heap memory modern.

---

## 16. Reachability and Reference Processing: Apa yang Terjadi saat GC

Saat GC berjalan, ia tidak hanya mark object biasa. Ia juga perlu memproses reference object.

Secara konseptual:

```text
1. Trace strong graph dari GC roots
2. Tentukan object yang tidak strongly reachable
3. Evaluasi soft references
4. Evaluasi weak references
5. Evaluasi finalization/phantom reachability
6. Clear referent sesuai aturan
7. Enqueue reference ke ReferenceQueue jika registered
8. Reclaim memory pada fase sesuai collector
```

Detail implementasi berbeda antar collector, tetapi mental model ini cukup penting.

Reference processing bisa menambah biaya GC, terutama jika ada sangat banyak reference object.

Contoh buruk:

```java
List<WeakReference<byte[]>> refs = new ArrayList<>();
for (int i = 0; i < 10_000_000; i++) {
    refs.add(new WeakReference<>(new byte[128]));
}
```

Walaupun referent kecil, jumlah `WeakReference` sangat besar. GC perlu memproses reference object tersebut.

Prinsip:

> Weak/soft/phantom reference bukan gratis. Mereka adalah object tambahan dan menambah reference-processing workload.

---

## 17. Reference Object Juga Object

Ini sering dilupakan.

```java
WeakReference<User> ref = new WeakReference<>(user);
```

`ref` sendiri adalah object di heap.

Graph:

```text
some holder
  ↓ strong
WeakReference object
  ↓ weak
User
```

Jika `User` di-clear, `WeakReference object` tetap hidup selama holder masih menyimpannya.

Maka struktur seperti ini:

```java
List<WeakReference<User>> users = new ArrayList<>();
```

bisa tetap leak walaupun semua referent sudah null, karena list menyimpan jutaan weak reference mati.

Cleanup tetap diperlukan.

---

## 18. Pattern: Weak Listener

Problem umum:

```java
publisher.addListener(subscriber::onEvent);
```

Jika publisher long-lived dan subscriber short-lived, publisher menahan subscriber lewat listener.

Graph:

```text
Publisher singleton
  ↓
listeners list
  ↓
method reference / lambda
  ↓
Subscriber
```

Subscriber tidak pernah GC.

Weak listener mencoba menghindari ownership.

Contoh sederhana:

```java
final class WeakListener<T> implements Listener<T> {
    private final WeakReference<Listener<T>> delegateRef;

    WeakListener(Listener<T> delegate) {
        this.delegateRef = new WeakReference<>(delegate);
    }

    @Override
    public void onEvent(T event) {
        Listener<T> delegate = delegateRef.get();
        if (delegate != null) {
            delegate.onEvent(event);
        }
    }
}
```

Namun ini belum cukup. Publisher perlu membersihkan weak listener mati.

Lebih baik:

```java
final class Publisher<T> {
    private final List<WeakReference<Listener<T>>> listeners = new ArrayList<>();

    public void addListener(Listener<T> listener) {
        listeners.add(new WeakReference<>(listener));
    }

    public void publish(T event) {
        Iterator<WeakReference<Listener<T>>> it = listeners.iterator();
        while (it.hasNext()) {
            Listener<T> listener = it.next().get();
            if (listener == null) {
                it.remove();
            } else {
                listener.onEvent(event);
            }
        }
    }
}
```

Trade-off:

- weak listener mengurangi leak;
- tetapi bisa membuat listener hilang jika tidak ada strong owner lain;
- cleanup tetap diperlukan;
- explicit unsubscribe sering lebih jelas.

Prinsip:

> Weak listener berguna untuk non-owning relation, tetapi explicit lifecycle registration/unregistration biasanya lebih mudah di-debug.

---

## 19. Pattern: Canonicalization dengan Weak Reference

Canonicalization berarti beberapa object equivalent diarahkan ke satu instance canonical.

Contoh konseptual:

```java
final class SymbolTable {
    private final Map<String, WeakReference<Symbol>> symbols = new HashMap<>();

    public synchronized Symbol canonicalize(String name) {
        WeakReference<Symbol> ref = symbols.get(name);
        Symbol symbol = ref == null ? null : ref.get();
        if (symbol != null) {
            return symbol;
        }

        Symbol created = new Symbol(name);
        symbols.put(name, new WeakReference<>(created));
        return created;
    }
}
```

Masalah:

- key `String name` tetap strongly held oleh map;
- jika jumlah name tidak bounded, map tetap membesar;
- perlu cleanup;
- bisa race dalam concurrent case;
- value mungkin menyimpan key.

Canonicalization yang benar di production butuh:

- boundedness;
- cleanup;
- concurrency safety;
- metrics;
- clear ownership model.

---

## 20. Pattern: ClassLoader Leak dan Weak Reference

ClassLoader leak sering terjadi di app server, plugin system, test framework, scripting engine, atau hot reload.

Contoh graph buruk:

```text
Static global cache
  ↓
Class object
  ↓
ClassLoader
  ↓
all classes loaded by loader
```

Jika aplikasi redeploy, classloader lama harusnya mati. Namun static cache dari parent loader bisa menahan class dari child loader.

Weak reference bisa membantu jika registry tidak boleh memiliki classloader/plugin.

Tetapi hati-hati:

```java
static final Map<Class<?>, Metadata> CACHE = new ConcurrentHashMap<>();
```

Jika `Metadata` menyimpan `Method`, `Field`, annotation proxy, atau lambda dari classloader yang sama, classloader tetap tertahan.

Lebih aman:

- gunakan `ClassValue<T>` untuk metadata per class;
- hindari static cache global yang key/value-nya cross-classloader;
- gunakan weak keys dengan cleanup;
- pastikan value tidak menahan key/classloader secara tidak perlu;
- clear cache saat unload/redeploy lifecycle.

---

## 21. Soft vs Weak vs Phantom: Cara Memilih

Gunakan pertanyaan ini.

### 21.1 Apakah object harus hidup selama owner hidup?

Gunakan strong reference.

```text
Order → OrderLine
UserSession → SecurityContext
RequestContext → correlation metadata
```

### 21.2 Apakah object boleh dibuang saat memory pressure dan bisa dibuat ulang?

Mungkin SoftReference, tetapi pertimbangkan cache eksplisit lebih dulu.

```text
large derived image
parsed schema snapshot
optional reusable intermediate representation
```

Tetapi untuk kebanyakan service backend, bounded cache eksplisit lebih baik.

### 21.3 Apakah kita hanya ingin mengamati object selama object hidup karena pihak lain?

Gunakan WeakReference.

```text
metadata registry
weak listener
canonical table tertentu
non-owning association
```

### 21.4 Apakah kita perlu diberitahu setelah object tidak bisa digunakan lagi untuk cleanup resource eksternal?

Gunakan PhantomReference atau Cleaner.

```text
native memory handle
file descriptor wrapper fallback
GPU/native resource wrapper
foreign allocation cleanup
```

### 21.5 Apakah cleanup harus deterministic?

Gunakan `AutoCloseable`, bukan Cleaner sebagai jalur utama.

```java
try (Resource r = open()) {
    use(r);
}
```

---

## 22. Common Misconceptions

### 22.1 “WeakReference Mencegah Memory Leak”

Tidak selalu.

WeakReference hanya melemahkan satu edge dalam graph. Jika ada strong path lain, object tetap hidup.

```text
GC root
  ↓ strong
A
  ↓ weak
B
```

B bisa dikumpulkan jika tidak ada strong path lain.

Tetapi:

```text
GC root
  ↓ strong
C
  ↓ strong
B
```

B tetap hidup.

### 22.2 “SoftReference adalah Cache Otomatis”

SoftReference bukan policy cache lengkap. Ia tidak menggantikan size bound, TTL, eviction, metrics, atau backpressure.

### 22.3 “Cleaner Akan Segera Membersihkan Resource”

Tidak. Cleaner bergantung pada object menjadi unreachable dan GC memprosesnya.

### 22.4 “PhantomReference Bisa Dipakai untuk Mengakses Object Terakhir Kali”

Tidak. `get()` pada PhantomReference selalu null.

### 22.5 “Jika Heap Dump Tidak Besar, Tidak Ada Leak”

Salah. Leak bisa terjadi di native memory, direct buffer, mmap, thread stack, metaspace, code cache, atau resource OS.

---

## 23. Reference Types and Off-Heap Memory

Off-heap resource punya masalah berbeda dari heap object.

Contoh wrapper:

```text
Java object kecil: NativeBuffer wrapper
Native memory besar: 1 GB malloc/mmap/direct memory
```

Heap melihat object kecil. GC mungkin tidak merasa perlu segera berjalan. Tetapi native memory sudah penuh.

Jika cleanup hanya mengandalkan Cleaner:

```text
wrapper object kecil tidak segera memicu GC
  ↓
native memory terus naik
  ↓
Direct buffer memory OOM / native OOM / container OOMKilled
```

Karena itu off-heap design butuh:

1. explicit `close()`;
2. bounded allocation;
3. pooling atau arena lifetime;
4. Cleaner fallback;
5. metrics native memory;
6. pressure propagation ke aplikasi;
7. tests untuk leak.

---

## 24. Cleaner vs Foreign Function & Memory API Arena

Modern Java menyediakan Foreign Function & Memory API yang membawa konsep `Arena` dan `MemorySegment`.

Model Arena:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(1024);
    // use segment
} // close arena releases memory
```

Mental model:

```text
Arena owns allocations
try-with-resources defines lifetime
close releases group of segments
```

Ini lebih deterministic daripada mengandalkan Cleaner.

Cleaner masih bisa menjadi fallback internal, tetapi desain utama harus tetap explicit lifetime.

---

## 25. Reference Processing and Latency

Dalam low-latency system, banyak reference object dapat memperburuk pause atau concurrent GC work.

Misalnya:

```text
10 million SoftReference cache entries
5 million WeakReference listener wrappers
large ReferenceQueue backlog
Cleaner thread processing slow native cleanup
```

Dampaknya:

- reference processing meningkat;
- GC log menunjukkan fase reference processing signifikan;
- cleanup backlog menunda resource release;
- tail latency naik;
- heap terlihat banyak wrapper kecil;
- native memory tidak turun walaupun wrapper sudah unreachable.

Operational checklist:

1. Monitor jumlah cache entries, bukan hanya heap.
2. Monitor ReferenceQueue backlog jika framework sendiri mengelolanya.
3. Jangan membuat reference object per request tanpa bound.
4. Jangan memakai SoftReference untuk cache besar tanpa cleanup.
5. Jangan melakukan cleanup lambat di Cleaner action.
6. Jangan biarkan cleanup action melakukan blocking I/O berat.

---

## 26. Anti-Pattern: SoftReference untuk Large Backend Cache

Contoh:

```java
final class ReportCache {
    private final ConcurrentHashMap<String, SoftReference<byte[]>> cache = new ConcurrentHashMap<>();

    byte[] getReport(String id) {
        SoftReference<byte[]> ref = cache.get(id);
        byte[] bytes = ref == null ? null : ref.get();
        if (bytes != null) {
            return bytes;
        }

        byte[] generated = generateReport(id);
        cache.put(id, new SoftReference<>(generated));
        return generated;
    }
}
```

Masalah:

- key tidak pernah hilang;
- SoftReference mati tetap di map;
- report besar bisa bertahan tak terduga;
- saat memory pressure, semua hilang lalu regenerate storm;
- tidak ada weight limit;
- tidak ada per-user/per-tenant protection;
- tidak ada metrics eviction.

Desain lebih baik:

```text
bounded cache
max weight by bytes
TTL
explicit invalidation
single-flight generation
metrics hit/miss/eviction/load-failure
backpressure saat generation mahal
```

---

## 27. Anti-Pattern: WeakReference untuk Menghindari Desain Lifecycle

Contoh:

```java
final class SessionManager {
    private final List<WeakReference<Session>> sessions = new ArrayList<>();
}
```

Ini sering dipakai sebagai tambalan karena tidak jelas siapa owner session.

Pertanyaan yang lebih benar:

- siapa membuat session?
- siapa menutup session?
- kapan session expire?
- apakah session punya timeout?
- apakah ada max session?
- apakah ada logout lifecycle?
- apa metrik active session?

WeakReference tidak menggantikan lifecycle model.

---

## 28. Anti-Pattern: Cleaner untuk Resource yang Harus Cepat Dilepas

Contoh:

```java
void handleRequest() {
    NativeBuffer buffer = new NativeBuffer(100 * 1024 * 1024);
    process(buffer);
    // lupa close
}
```

Jika request rate tinggi:

```text
100 MB native allocation/request
  ↓
wrapper Java kecil cepat unreachable
  ↓
GC belum tentu segera jalan
  ↓
native memory naik cepat
  ↓
container OOMKilled
```

Cleaner mungkin akhirnya berjalan, tetapi terlalu terlambat.

Correct pattern:

```java
void handleRequest() {
    try (NativeBuffer buffer = new NativeBuffer(100 * 1024 * 1024)) {
        process(buffer);
    }
}
```

Cleaner hanya fallback.

---

## 29. Memory Leak Diagnosis dengan Reference Awareness

Saat heap dump menunjukkan object besar tertahan, gunakan pertanyaan berikut.

### 29.1 Apa GC root-nya?

Cari path to GC root.

Contoh:

```text
GC Root: static field
  ↓
CacheManager.INSTANCE
  ↓
ConcurrentHashMap
  ↓
Entry
  ↓
SoftReference
  ↓
LargeReport
```

Jika referent masih ada, mungkin soft object belum di-clear.

### 29.2 Apakah Reference Object Menumpuk?

Histogram mungkin menunjukkan:

```text
java.lang.ref.WeakReference        5,000,000 instances
java.lang.ref.SoftReference        2,000,000 instances
java.lang.ref.Cleaner$Cleanable    500,000 instances
```

Pertanyaan:

- siapa menyimpan reference object tersebut?
- apakah referent sudah null?
- apakah ReferenceQueue diproses?
- apakah cleanup backlog?

### 29.3 Apakah Value Menahan Key?

Untuk weak map/canonical map, cek apakah value punya path balik ke key.

```text
WeakHashMap Entry
  ↓ value
Metadata
  ↓ clazz
Class
  ↓ classloader
```

### 29.4 Apakah Cleaner Action Menahan Referent?

Cari lambda/inner class yang capture outer object.

```text
Cleaner
  ↓
Cleanable
  ↓
Runnable lambda
  ↓
this resource wrapper
```

Jika ya, cleanup tidak akan terjadi.

---

## 30. Java 8 sampai 25: Apa yang Berubah secara Relevan

### Java 8

- Reference classes sudah ada lama.
- Finalization masih umum ditemukan di library lama.
- Cleaner publik `java.lang.ref.Cleaner` belum menjadi API utama seperti Java 9+.
- Banyak library memakai `sun.misc.Cleaner` atau `Unsafe` internal.

### Java 9+

- Module system memperketat akses internal API.
- `java.lang.ref.Cleaner` tersedia sebagai API publik.
- Akses ke internal JDK makin dibatasi bertahap.

### Java 18

- Finalization deprecated for removal melalui JEP 421.
- Sinyal kuat bahwa `finalize()` bukan mekanisme lifecycle yang layak dipertahankan.

### Java 22+

- Foreign Function & Memory API finalized.
- Off-heap memory modern lebih diarahkan ke `MemorySegment`/`Arena` daripada `Unsafe` manual.

### Java 23–25

- Arah platform makin jelas: kurangi penggunaan API unsafe/internal, gunakan API standar untuk memory access dan lifecycle.
- Untuk resource lifecycle, kombinasi modern adalah:

```text
AutoCloseable + try-with-resources
  + Cleaner fallback jika perlu
  + FFM Arena/MemorySegment untuk foreign memory
```

---

## 31. Decision Matrix

| Problem | Jangan Langsung Pakai | Pilihan Lebih Baik |
|---|---|---|
| Cache domain object | SoftReference | bounded cache dengan TTL/weight/metrics |
| Metadata attached to object | Static HashMap strong key | WeakHashMap/ClassValue/weak registry dengan cleanup |
| Listener leak | WeakReference sebagai tambalan buta | explicit unsubscribe atau weak listener dengan cleanup |
| Native memory cleanup | finalize | AutoCloseable + Cleaner fallback |
| Off-heap allocation group | Cleaner per object | Arena lifetime / pooled allocator / explicit close |
| Class metadata cache | static `Map<Class<?>, ...>` | ClassValue atau weak-key cache hati-hati |
| Large temporary object | SoftReference | avoid retention, stream, bounded buffer |
| Unknown heap growth | tambah heap | heap dump, dominator tree, path to GC root |
| RSS growth stable heap | heap dump saja | NMT, direct memory, mmap, native leak analysis |

---

## 32. Production Checklist

Gunakan checklist ini saat mendesain atau review code.

### 32.1 Strong Reference

- Apakah object ini benar-benar dimiliki oleh holder?
- Apakah object besar ikut tertahan karena field convenience?
- Apakah async task/lambda menangkap object terlalu besar?
- Apakah collection punya bound?
- Apakah static field menahan state tenant/request/user?

### 32.2 SoftReference

- Apakah kita benar-benar ingin GC menentukan eviction?
- Apakah ada cleanup untuk cleared references?
- Apakah ada metrics hit/miss/clear/reload?
- Apakah regenerate storm bisa terjadi?
- Apakah cache punya max size/weight alternatif?

### 32.3 WeakReference

- Apakah weak relation benar-benar non-owning?
- Apakah ada strong path lain yang tetap menahan referent?
- Apakah reference object dibersihkan?
- Apakah value menahan key?
- Apakah key adalah interned String/literal?

### 32.4 PhantomReference / Cleaner

- Apakah cleanup state tidak menahan referent?
- Apakah cleanup deterministic tetap lewat close?
- Apakah cleanup action ringan dan idempotent?
- Apakah resource punya metric active/allocated/freed?
- Apakah ada fallback jika cleaner backlog menumpuk?

### 32.5 Finalization

- Apakah ada override `finalize()`?
- Apakah library lama masih bergantung padanya?
- Apakah ada warning deprecation?
- Apakah migrasi ke AutoCloseable/Cleaner/FFM memungkinkan?

---

## 33. Mini Case Study 1: WeakHashMap yang Tetap Leak

### Situasi

Service plugin memakai cache:

```java
static final Map<Class<?>, Metadata> CACHE = new WeakHashMap<>();
```

Setelah plugin reload beberapa kali, metaspace naik.

### Dugaan Awal

Developer berpikir:

```text
WeakHashMap memakai weak key, jadi class lama harus hilang.
```

### Temuan

`Metadata` menyimpan `Method` dan `Class<?>`:

```java
final class Metadata {
    private final Class<?> type;
    private final List<Method> methods;
}
```

Graph:

```text
WeakHashMap
  ↓ strong
Metadata
  ↓ strong
Class
  ↓ strong
ClassLoader
```

Value menahan key/classloader.

### Fix

Opsi:

1. gunakan `ClassValue<Metadata>`;
2. hilangkan strong class reference dari Metadata jika tidak perlu;
3. clear cache pada plugin unload;
4. gunakan weak/soft structure yang benar-benar tidak punya back-reference;
5. tambahkan test unload dengan WeakReference ke ClassLoader.

---

## 34. Mini Case Study 2: Direct Memory OOM karena Cleaner Terlambat

### Situasi

Service memakai direct/native buffer per request. Heap stabil 1 GB, tetapi pod 4 GB kena OOMKilled.

### Temuan

Wrapper object kecil dan cepat unreachable. Native memory besar dilepas oleh Cleaner, tetapi GC tidak cukup sering berjalan karena heap pressure rendah.

```text
heap stable
native memory grows
RSS grows
container kills process
```

### Fix

1. explicit `close()`;
2. try-with-resources;
3. buffer pool dengan max capacity;
4. direct memory metrics;
5. set `MaxDirectMemorySize` bila relevan;
6. NMT untuk observability;
7. reject/backpressure saat pool exhausted.

---

## 35. Mini Case Study 3: SoftReference Cache Menyebabkan Latency Spike

### Situasi

Report service menyimpan hasil report besar dengan SoftReference. Saat traffic tinggi, heap pressure naik.

### Gejala

- GC frequency naik;
- banyak soft reference di-clear;
- cache miss naik mendadak;
- report regeneration mahal;
- CPU naik;
- latency p99 memburuk.

### Fix

1. ganti dengan bounded weighted cache;
2. batasi total bytes;
3. tambahkan single-flight per report ID;
4. tambahkan TTL;
5. tambahkan admission policy;
6. expose metrics;
7. pertimbangkan menyimpan report di object storage atau disk cache.

---

## 36. Praktik Coding: Safe Cleaner Template

Template yang relatif aman:

```java
public final class ResourceHandle implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();

    private final ResourceState state;
    private final Cleaner.Cleanable cleanable;

    public ResourceHandle(long size) {
        this.state = new ResourceState(size);
        this.cleanable = CLEANER.register(this, state);
    }

    public void use() {
        state.ensureOpen();
        // operate using state.address
    }

    @Override
    public void close() {
        cleanable.clean();
    }

    private static final class ResourceState implements Runnable {
        private long address;
        private boolean closed;

        ResourceState(long size) {
            this.address = allocate(size);
        }

        void ensureOpen() {
            if (closed) {
                throw new IllegalStateException("Resource already closed");
            }
        }

        @Override
        public synchronized void run() {
            if (!closed) {
                free(address);
                address = 0;
                closed = true;
            }
        }

        private static long allocate(long size) {
            throw new UnsupportedOperationException("example");
        }

        private static void free(long address) {
            throw new UnsupportedOperationException("example");
        }
    }
}
```

Karakteristik:

- `ResourceState` static nested class;
- tidak capture `ResourceHandle`;
- cleanup idempotent;
- `close()` deterministic;
- Cleaner fallback;
- state memuat hanya data cleanup minimum.

---

## 37. Praktik Coding: Weak Registry dengan Cleanup Berkala

```java
public final class WeakRegistry<K, V> {
    private final ReferenceQueue<K> queue = new ReferenceQueue<>();
    private final Map<WeakKey<K>, V> map = new HashMap<>();

    public synchronized void put(K key, V value) {
        cleanup();
        map.put(new WeakKey<>(key, queue), value);
    }

    public synchronized V get(K key) {
        cleanup();
        return map.get(new WeakKey<>(key, null));
    }

    public synchronized int sizeApprox() {
        cleanup();
        return map.size();
    }

    private void cleanup() {
        Reference<? extends K> ref;
        while ((ref = queue.poll()) != null) {
            map.remove(ref);
        }
    }

    private static final class WeakKey<K> extends WeakReference<K> {
        private final int hash;

        WeakKey(K key, ReferenceQueue<K> queue) {
            super(Objects.requireNonNull(key), queue);
            this.hash = System.identityHashCode(key);
        }

        @Override
        public int hashCode() {
            return hash;
        }

        @Override
        public boolean equals(Object obj) {
            if (this == obj) return true;
            if (!(obj instanceof WeakKey<?> other)) return false;
            return this.get() == other.get();
        }
    }
}
```

Catatan:

- contoh ini synchronized untuk kesederhanaan;
- production concurrent registry butuh desain lebih hati-hati;
- value tetap tidak boleh menahan key jika cleanup diinginkan;
- gunakan `ClassValue` jika use case-nya metadata per class.

---

## 38. Debug Checklist Saat Melihat `java.lang.ref.*` di Heap Dump

Jika heap dump menunjukkan banyak object reference:

```text
java.lang.ref.WeakReference
java.lang.ref.SoftReference
java.lang.ref.PhantomReference
java.lang.ref.Cleaner$Cleanable
```

Tanyakan:

1. Siapa holder reference object?
2. Apakah referent masih ada atau sudah null?
3. Apakah ReferenceQueue diproses?
4. Apakah map/list menyimpan cleared references?
5. Apakah value menahan key?
6. Apakah Cleaner action capture outer object?
7. Apakah jumlah reference object proportional dengan traffic?
8. Apakah ada per-request reference object tanpa bound?
9. Apakah GC log menunjukkan reference processing mahal?
10. Apakah native memory turun setelah GC/cleanup?

---

## 39. Mental Model Final

Ringkasnya:

```text
StrongReference:
  ownership / keep alive

SoftReference:
  maybe keep alive until memory pressure

WeakReference:
  observe without owning

PhantomReference:
  post-reachability lifecycle signal

ReferenceQueue:
  cleanup bookkeeping after referent changes state

Cleaner:
  phantom-based fallback cleanup mechanism

AutoCloseable:
  deterministic lifecycle mechanism
```

Aturan desain:

```text
Use strong references for ownership.
Use weak references for non-owning associations.
Avoid soft references as default cache policy.
Use phantom/cleaner for fallback cleanup, not primary lifecycle.
Use AutoCloseable for deterministic resource release.
Use explicit boundedness for memory safety.
```

---

## 40. Hubungan ke Bagian Berikutnya

Bagian ini memberi fondasi untuk memahami kenapa array/string/buffer bisa leak atau membengkak:

- strong reference dari cache/list/static field menahan array besar;
- substring/string/key dapat tertahan oleh map;
- reference object bisa menumpuk;
- Cleaner menentukan kapan direct/off-heap buffer dilepas;
- value/key graph menentukan apakah weak map bekerja.

Bagian berikutnya akan masuk ke:

```text
Arrays, Strings, Compact Strings, Charsets, and Memory Footprint
```

Di sana kita akan membahas bagaimana array dan string benar-benar memakan memory, kenapa string-heavy application sering boros memory, bagaimana Compact Strings mengubah internal representation sejak Java 9, dan bagaimana text/charset/logging dapat menjadi sumber allocation serta retention besar.

---

## 41. Ringkasan Eksekutif

1. Java reference bukan hanya pointer; ia bagian dari kontrak reachability dengan GC.
2. Strong reference adalah ownership dan penyebab utama object tetap hidup.
3. SoftReference jarang ideal sebagai cache modern karena eviction policy tidak eksplisit.
4. WeakReference cocok untuk non-owning association, tetapi cleanup tetap wajib.
5. WeakHashMap hanya weak pada key; value masih bisa menahan key.
6. PhantomReference dipakai untuk post-mortem cleanup signal, bukan untuk mengakses object.
7. Cleaner adalah fallback cleanup berbasis phantom reachability, bukan pengganti `close()`.
8. Finalization harus dihindari dan sudah deprecated for removal.
9. Reference object sendiri tetap object dan bisa menumpuk.
10. Off-heap/native resource harus punya deterministic lifecycle; GC tidak memahami pressure native sebesar heap pressure.
11. Desain memory yang baik dimulai dari ownership graph yang jelas, bukan dari memilih reference type secara reaktif.

---

## Status Seri

```text
Part 008 selesai.
Seri belum selesai.
Masih lanjut ke part 009 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-009.md
```

Topik berikutnya:

```text
Arrays, Strings, Compact Strings, Charsets, and Memory Footprint
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-007.md">⬅️ Object Lifetime Engineering: Young, Middle-Lived, Long-Lived Objects</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-009.md">Arrays, Strings, Compact Strings, Charsets, and Memory Footprint ➡️</a>
</div>
