# learn-java-memory-byte-bit-buffer-offheap-gc-part-019

# Generational GC Internals: Young, Survivor, Old, Promotion, Card Marking

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `019`  
> Topik: `Generational GC Internals`  
> Target: Java 8 sampai Java 25  
> Level: Advanced / production engineering

---

## 0. Posisi Bagian Ini dalam Seri

Di bagian sebelumnya, kita sudah membangun fondasi garbage collection secara umum:

- tracing;
- root scanning;
- mark;
- sweep;
- copy;
- compact;
- safepoint;
- barrier;
- remembered set;
- card table.

Bagian ini mempersempit fokus ke **generational GC internals**.

Ini penting karena mayoritas collector HotSpot modern tetap memakai, pernah memakai, atau terpengaruh oleh ide generational:

- Serial GC;
- Parallel GC;
- CMS di Java 8;
- G1;
- Generational ZGC;
- Generational Shenandoah.

Bahkan ketika collector tidak berbentuk “eden-survivor-old” klasik, cara berpikir generational tetap penting karena workload Java biasanya memiliki pola umur object yang tidak merata.

Mental model utama bagian ini:

```text
GC cost is not primarily about how many objects were allocated.
GC cost is about how many allocated objects remain reachable long enough to be copied, scanned, promoted, remembered, relocated, or retained.
```

Dalam bahasa yang lebih praktis:

```text
Banyak object mati muda biasanya murah.
Sedikit object yang bertahan lama bisa mahal.
Object yang hidup “nanggung” sering paling berbahaya.
```

---

## 1. Mengapa Generational GC Ada?

Generational GC lahir dari observasi empiris yang sering disebut **generational hypothesis**.

Secara sederhana:

```text
Most objects die young.
```

Dalam banyak aplikasi Java:

- object request sementara cepat mati;
- DTO parsing cepat mati;
- iterator/lambda/helper cepat mati;
- temporary `StringBuilder` cepat mati;
- hasil intermediate stream cepat mati;
- wrapper object cepat mati;
- buffer kecil lokal cepat mati;
- exception object untuk path error cepat mati.

Kalau hampir semua object mati muda, maka collector tidak perlu terus-menerus scan seluruh heap. Collector bisa fokus ke area tempat object baru dialokasikan.

Model klasiknya:

```text
Heap
├── Young Generation
│   ├── Eden
│   ├── Survivor From
│   └── Survivor To
└── Old Generation / Tenured Generation
```

Object baru masuk ke young generation. Kalau mati cepat, object itu dibuang di young collection. Kalau bertahan beberapa collection, object itu dipindah ke old generation.

---

## 2. Masalah yang Dipecahkan Generational GC

Tanpa generational design, collector harus memperlakukan seluruh heap sebagai satu area besar.

Misalnya:

```text
Heap 8 GB
Live object 4 GB
Temporary garbage 500 MB/sec
```

Kalau setiap GC harus melihat seluruh heap, maka temporary allocation kecil pun bisa memicu kerja besar.

Generational GC memecah masalah:

```text
Temporary allocation → young generation
Long-lived state     → old generation
```

Tujuannya:

1. membuat collection object muda murah;
2. menghindari scanning old generation terlalu sering;
3. menunda kerja mahal sampai benar-benar perlu;
4. memanfaatkan fakta bahwa object muda paling mungkin mati;
5. mengurangi pause rata-rata untuk workload umum.

Tetapi trade-off-nya:

```text
Generational GC needs bookkeeping for references from old objects to young objects.
```

Inilah kenapa card table, remembered set, dan write barrier menjadi penting.

---

## 3. Istilah-Istilah Utama

### 3.1 Eden

**Eden** adalah area tempat object baru biasanya dialokasikan.

Contoh allocation path:

```java
OrderDto dto = new OrderDto();
```

Secara konseptual:

```text
new OrderDto()
  → allocate in TLAB
  → TLAB berada di Eden
```

Eden biasanya cepat penuh karena semua object baru masuk ke sana.

Ketika Eden penuh, terjadi **young GC**.

---

### 3.2 Survivor Space

Survivor space menyimpan object yang masih hidup setelah young GC, tetapi belum cukup tua untuk dipromosikan ke old generation.

Model klasik:

```text
Before young GC:

Eden       : [many new objects]
Survivor A : [previous survivors]
Survivor B : [empty]

After young GC:

Eden       : empty
Survivor A : empty
Survivor B : [objects still alive]
Old        : [objects promoted]
```

Survivor space biasanya bergantian per GC:

```text
From survivor → To survivor
To survivor   → From survivor in next cycle
```

---

### 3.3 Object Age

Object yang bertahan dari young GC biasanya mendapat age.

Secara konseptual:

```text
new object in Eden       → age 0
survives first young GC  → age 1
survives second young GC → age 2
...
```

Ketika age melewati threshold tertentu, object dapat dipromosikan ke old generation.

Di HotSpot, age metadata historisnya berkaitan dengan object header mark word. Detail persisnya bisa berubah, tetapi mental modelnya tetap:

```text
Repeated survival means the collector increasingly treats the object as longer-lived.
```

---

### 3.4 Promotion / Tenuring

**Promotion** atau **tenuring** adalah pemindahan object dari young generation ke old generation.

Contoh:

```text
Object survives young GC multiple times
  → collector assumes it may live longer
  → object copied/promoted to old generation
```

Promotion bukan “hadiah”. Promotion adalah konsekuensi dari object yang bertahan terlalu lama untuk tetap di young generation.

---

### 3.5 Old Generation / Tenured Generation

Old generation berisi object yang dianggap lebih panjang umur.

Contoh:

- singleton service object;
- Spring bean;
- cache entry;
- loaded configuration;
- class metadata references;
- connection pool object;
- registry/listener;
- long-lived queue;
- session state;
- retained business state;
- object yang tidak sengaja leak.

Old generation dikumpulkan lebih jarang karena lebih mahal. Masalahnya, jika old generation terisi object yang sebenarnya garbage tetapi masih reachable, GC tidak bisa menghapusnya.

---

## 4. Young GC: Apa yang Sebenarnya Terjadi?

Young GC biasanya dipicu ketika Eden penuh atau collector memutuskan young region perlu dikosongkan.

Secara konseptual:

```text
1. Stop application threads, depending on collector phase.
2. Identify roots into young generation.
3. Find live young objects.
4. Copy live objects to survivor or old.
5. Discard the rest of Eden as garbage.
6. Resume application.
```

Model penting:

```text
Young GC does not pay for dead objects individually.
Young GC mostly pays for live objects that must be found and copied.
```

Ini alasan allocation di Java bisa sangat murah:

```text
Allocate many short-lived objects
  → most die in Eden
  → collector just resets/reclaims Eden-like space
```

Tetapi jika banyak object bertahan:

```text
Allocate many objects
  → many survive
  → copy to survivor/old
  → scan references
  → update remembered metadata
  → pause/cpu cost increases
```

---

## 5. The Key Equation: Allocation Rate, Survival Rate, Promotion Rate

Untuk memahami generational GC, jangan hanya melihat heap usage. Lihat tiga rate:

```text
allocation rate
survival rate
promotion rate
```

### 5.1 Allocation Rate

Allocation rate adalah seberapa cepat aplikasi membuat object baru.

```text
allocation rate = bytes allocated per second
```

Contoh:

```text
Service A allocates 200 MB/s
Service B allocates 2 GB/s
```

Allocation rate tinggi tidak selalu buruk. Jika object mati muda, GC bisa menanganinya relatif murah.

---

### 5.2 Survival Rate

Survival rate adalah porsi object young yang tetap hidup setelah young GC.

```text
survival rate = live bytes after young GC / young bytes before GC
```

Contoh:

```text
Eden before GC: 1 GB
Live after GC : 50 MB
Survival rate : 5%
```

Ini biasanya bagus.

Contoh buruk:

```text
Eden before GC: 1 GB
Live after GC : 700 MB
Survival rate : 70%
```

Artinya young generation tidak berhasil menjadi tempat “object mati muda”. Banyak object harus disalin.

---

### 5.3 Promotion Rate

Promotion rate adalah seberapa cepat object masuk old generation.

```text
promotion rate = bytes promoted to old per second
```

Promotion rate tinggi biasanya jauh lebih berbahaya daripada allocation rate tinggi.

Kenapa?

Karena promoted object:

- menambah old live set;
- mempercepat old generation pressure;
- meningkatkan marking cost;
- bisa memicu mixed/full/major collection;
- sering berkorelasi dengan object lifetime yang tidak ideal.

---

## 6. Allocation Rate Tinggi Tidak Sama dengan Memory Leak

Misalnya ada service JSON-heavy:

```java
public Response handle(Request request) {
    Map<String, Object> parsed = parseJson(request.body());
    ResponseDto dto = transform(parsed);
    return serialize(dto);
}
```

Object sementara banyak sekali:

- parser token;
- map entry;
- temporary string;
- DTO;
- byte array;
- builder;
- iterator.

Allocation rate bisa tinggi.

Tetapi jika semua object mati setelah request selesai:

```text
high allocation rate
low survival rate
low promotion rate
stable old gen
```

Ini biasanya bukan leak. Ini workload allocation-heavy.

Sebaliknya:

```text
moderate allocation rate
high promotion rate
old gen after GC slowly rising
```

Ini jauh lebih mencurigakan.

---

## 7. Middle-Lived Objects: Musuh Generational GC

Generational hypothesis paling cocok untuk dua kelompok ekstrem:

```text
Very short-lived objects → die in young
Very long-lived objects  → go old and stay stable
```

Yang sering bermasalah adalah **middle-lived objects**.

Contoh:

- request object yang bertahan di async queue beberapa detik;
- batch buffer yang hidup selama beberapa cycle GC;
- cache entry TTL 30 detik dengan traffic tinggi;
- event aggregation window;
- retry queue;
- reactive pipeline backlog;
- object yang tertahan oleh `CompletableFuture` chain;
- log/event payload yang masuk bounded queue tetapi drain lambat;
- temporary data yang disimpan sampai transaksi panjang selesai.

Middle-lived object sering:

```text
survive young GC
  → get copied to survivor
  → survive again
  → promoted to old
  → die shortly after promotion
  → old generation fills with recently-dead garbage
```

Ini buruk karena old generation tidak dikumpulkan sesering young generation.

Pola ini disebut secara informal:

```text
premature promotion of middle-lived objects
```

---

## 8. Premature Promotion

Premature promotion terjadi ketika object masuk old generation padahal sebentar lagi mati.

Contoh timeline:

```text
t=0ms   object allocated for request
 t=50ms  young GC #1, object still referenced by async task → survivor
 t=200ms young GC #2, object still referenced by queue → survivor age increases
 t=400ms young GC #3, survivor pressure high → object promoted
 t=700ms request completes, object unreachable
 t=700ms object dead, but now in old generation
```

Object sudah mati, tetapi ruang old generation baru bisa direclaim pada old/mixed/full/concurrent cycle berikutnya.

Jika ini terjadi terus-menerus:

```text
old generation occupancy rises
mixed collections become frequent
full GC risk increases
latency tail worsens
```

---

## 9. Survivor Space Overflow

Survivor space terlalu kecil dapat menyebabkan object dipromosikan terlalu cepat.

Model:

```text
Young GC live bytes: 300 MB
Available survivor : 100 MB
```

Maka sebagian survivor tidak muat:

```text
100 MB → survivor
200 MB → old generation
```

Ini bisa terjadi meskipun object belum “tua”.

Dampaknya:

```text
survivor overflow
  → early promotion
  → old gen pressure
  → more expensive GC later
```

Oracle GC tuning guide menjelaskan bahwa survivor space yang terlalu kecil dapat menyebabkan copying collection overflow langsung ke old generation; sementara survivor yang terlalu besar juga mengurangi ruang berguna untuk Eden. Jadi tuning survivor selalu trade-off, bukan sekadar “besar lebih baik”.

---

## 10. Tenuring Threshold

Tenuring threshold mengontrol kira-kira berapa kali object dapat bertahan di young collection sebelum dipromosikan.

Secara konseptual:

```text
if object.age >= tenuringThreshold:
    promote to old
else:
    copy to survivor
```

Tetapi real HotSpot ergonomics lebih kompleks karena collector bisa menyesuaikan threshold berdasarkan survivor occupancy.

Jangan menganggap tenuring threshold sebagai kontrol deterministik sempurna.

Lebih akurat:

```text
Tenuring threshold influences promotion behavior,
but actual promotion also depends on survivor capacity,
collector ergonomics,
region availability,
and pause-time goals.
```

---

## 11. Dynamic Tenuring

Collector dapat menurunkan effective tenuring threshold jika survivor space terlalu penuh.

Misalnya:

```text
MaxTenuringThreshold = 15
```

Tetapi jika object age 3 saja sudah memenuhi sebagian besar survivor space, collector dapat mempromosikan lebih awal.

Mental model:

```text
Collector prefers not to overflow survivor space.
If survivor is under pressure, promotion can happen earlier.
```

Karena itu, ketika membaca GC log, jangan hanya melihat flag. Lihat distribusi umur object dan promotion aktual.

---

## 12. Card Table: Masalah Old-to-Young Reference

Young GC ingin mengumpulkan young generation tanpa scan seluruh old generation.

Tetapi ada masalah:

```java
class Cache {
    Object latest;
}

static final Cache CACHE = new Cache();

void handle() {
    Object young = new Object();
    CACHE.latest = young;
}
```

`CACHE` hidup di old generation. `young` hidup di young generation.

Graph-nya:

```text
Old object ──references──> Young object
```

Saat young GC, kalau collector hanya scan stack roots dan young generation, object muda itu terlihat unreachable. Padahal masih direferensikan oleh old object.

Solusi:

```text
Track old-to-young references.
```

Card table adalah salah satu mekanisme tracking tersebut.

---

## 13. Card Table: Mental Model

Heap dibagi menjadi kartu-kartu kecil secara logis.

Contoh konseptual:

```text
Old generation memory
+--------+--------+--------+--------+--------+
| card 0 | card 1 | card 2 | card 3 | card 4 |
+--------+--------+--------+--------+--------+
```

Jika program menulis reference field di old object:

```java
oldObj.child = youngObj;
```

Write barrier menandai card yang berisi `oldObj` sebagai dirty:

```text
card 2 = dirty
```

Saat young GC, collector tidak perlu scan seluruh old generation. Collector cukup scan dirty cards yang mungkin mengandung old-to-young references.

Mental model:

```text
Card table is a coarse-grained memory map that says:
"Something in this memory area may point to young objects."
```

---

## 14. Write Barrier

Card table diupdate oleh **write barrier**.

Write barrier adalah kode tambahan yang dijalankan ketika aplikasi menulis reference.

Contoh Java:

```java
order.customer = customer;
```

Secara runtime, ini bukan cuma store field. JVM dapat menyisipkan barrier logic:

```text
store reference
mark card dirty
maybe do collector-specific bookkeeping
```

Pseudocode konseptual:

```text
writeReference(object, field, newValue):
    object.field = newValue
    if object is in old generation and newValue is in young generation:
        markCardDirty(object.address)
```

Real implementation lebih optimized dan collector-specific.

Yang penting:

```text
Reference writes are not always free.
```

Bukan berarti setiap setter mahal, tetapi struktur data dengan mutasi reference masif bisa meningkatkan barrier cost dan remembered-set pressure.

---

## 15. Remembered Set

Remembered set adalah struktur data yang membantu collector menemukan cross-region atau cross-generation references.

Dalam model klasik:

```text
remembered set tracks old → young references
```

Dalam G1, remembered set menjadi lebih penting karena heap dibagi ke banyak region.

Contoh G1:

```text
Region A may contain references to Region B.
Region C may contain references to Region B.
```

Ketika Region B dikumpulkan, collector perlu tahu region lain mana yang mungkin menunjuk ke B.

Mental model:

```text
Remembered set reduces scanning scope.
It trades memory and write-barrier overhead for shorter collection work.
```

Trade-off-nya:

```text
more cross-region references
  → larger remembered sets
  → more memory overhead
  → more refinement/scanning cost
```

---

## 16. Card Dirtying dan Mutasi Data Struktur

Kode seperti ini bisa menimbulkan banyak reference writes:

```java
List<Order> orders = cache.get(userId);
orders.add(newOrder);
```

Atau:

```java
map.put(key, value);
```

Atau:

```java
node.next = newNode;
```

Jika container/list/map sudah old dan value baru masih young:

```text
old collection object → young payload
```

Maka collector harus track hubungan itu.

Pola yang perlu diwaspadai:

- long-lived cache yang sering dimutasi;
- old queue yang terus menerima young objects;
- static registry yang diupdate terus;
- old graph dengan banyak edge baru;
- listener list yang sering berubah;
- global map sebagai staging area.

Ini bukan berarti semua map buruk. Masalah muncul ketika struktur long-lived menjadi “tempat parkir” object muda dalam volume tinggi.

---

## 17. Young Generation Size: Terlalu Kecil vs Terlalu Besar

Young generation kecil:

```text
+ frequent young GC
+ shorter individual pause maybe
- more GC overhead
- more premature promotion risk
- less batching of short-lived garbage
```

Young generation besar:

```text
+ less frequent young GC
+ more time for temporary objects to die before collection
+ lower promotion for some workloads
- larger young collection pause when it happens
- more memory reserved for young
- can increase latency spikes
```

Tidak ada ukuran “benar” secara universal.

Targetnya adalah:

```text
young gen large enough for most temporary objects to die,
but not so large that young GC pause violates latency objective.
```

---

## 18. Old Generation Size: Headroom dan Live Set

Old generation harus cukup besar untuk live set jangka panjang plus headroom.

```text
old capacity >= stable old live set + promotion/concurrent headroom
```

Jika old generation terlalu kecil:

- marking lebih sering;
- mixed/major GC lebih sering;
- promotion failure risk meningkat;
- allocation stall risk meningkat;
- full GC risk meningkat.

Jika terlalu besar:

- memory cost naik;
- old GC dapat lebih jarang tetapi lebih besar;
- leak lebih lama tidak terlihat;
- container RSS bisa membesar;
- pause pada collector tertentu bisa memburuk.

Untuk collector concurrent seperti ZGC, heap headroom juga penting karena aplikasi tetap berjalan dan tetap mengalokasikan selama GC bekerja.

---

## 19. Promotion Failure

Promotion failure terjadi ketika object perlu dipromosikan ke old generation tetapi old generation tidak punya ruang cukup atau tidak punya contiguous/evacuation capacity yang diperlukan collector.

Secara konseptual:

```text
young GC finds live objects
  → some must move to old
  → old cannot accept enough data
  → promotion failure
```

Dampak:

- fallback ke collection lebih mahal;
- full GC;
- long pause;
- possible `OutOfMemoryError`;
- severe latency spike.

Promotion failure adalah sinyal bahwa kombinasi berikut bermasalah:

```text
high survival/promotion rate
+ insufficient old headroom
+ fragmentation/evacuation limitation
+ collector cannot keep up
```

---

## 20. Full GC vs Major GC vs Old GC

Istilah ini sering dipakai tidak konsisten.

Secara praktis:

| Istilah | Makna umum |
|---|---|
| Young GC / Minor GC | Collection fokus young generation |
| Old GC / Major GC | Collection yang melibatkan old generation |
| Mixed GC | G1 collection yang mengambil young plus sebagian old region |
| Full GC | Collection berat seluruh heap, sering stop-the-world, sering fallback |

Jangan hanya mengandalkan istilah. Baca GC log collector-specific.

Pertanyaan yang lebih baik:

```text
Apakah event ini stop-the-world?
Area heap mana yang dikumpulkan?
Berapa live bytes sebelum/sesudah?
Berapa object dipromosikan?
Berapa lama pause?
Apakah ada fallback?
```

---

## 21. Generational GC pada Java 8

Di Java 8, banyak production system memakai:

- Parallel GC;
- CMS;
- G1 opsional;
- Serial untuk small heap/tooling.

Model generational klasik sangat relevan.

Konsep penting:

```text
Young generation:
  Eden + Survivor spaces

Old generation:
  Tenured generation
```

CMS mengumpulkan old generation secara mostly concurrent, tetapi young generation tetap dikumpulkan dengan collector young seperti ParNew pada kombinasi umum CMS.

Masalah Java 8 yang sering terlihat:

- promotion failure;
- concurrent mode failure CMS;
- fragmentation di old generation CMS;
- long full GC;
- survivor overflow;
- terlalu banyak middle-lived data;
- `PermGen` sudah tidak ada di Java 8, diganti Metaspace, tetapi classloader leak tetap bisa terjadi.

---

## 22. Generational Thinking pada G1

G1 tidak memakai contiguous young/old generation klasik. G1 membagi heap menjadi region.

Tetapi G1 tetap generational.

Model konseptual:

```text
Heap regions:
  some regions = Eden
  some regions = Survivor
  some regions = Old
  some regions = Humongous
```

Young GC di G1:

```text
collect Eden + Survivor regions
copy live objects to Survivor or Old regions
```

Mixed GC di G1:

```text
collect young regions + selected old regions
```

Kenapa “selected old regions”?

Karena G1 mencoba memilih old region yang memberikan reclaim benefit tinggi dalam pause target.

Mental model:

```text
G1 is generational, region-based, evacuating, and pause-target driven.
```

---

## 23. Generational Thinking pada ZGC Modern

ZGC awalnya non-generational. Generational ZGC diperkenalkan untuk memanfaatkan generational hypothesis dengan tetap mempertahankan low-latency design.

Mulai JDK 24, dokumentasi Oracle Java SE 25 menyatakan ZGC adalah generational collector dan opsi `ZGenerational` telah dihapus.

Motivasi generational ZGC:

- menurunkan risiko allocation stalls;
- menurunkan heap overhead yang dibutuhkan;
- menurunkan CPU overhead GC;
- tetap menjaga low latency.

Mental model:

```text
Even low-latency concurrent collectors benefit from knowing that most objects die young.
```

Tetapi implementasinya tidak sama dengan young/survivor/old klasik. Jangan memaksakan model Parallel/CMS ke ZGC. Gunakan konsep generational sebagai lifetime separation, bukan layout fisik yang sama.

---

## 24. Generational Thinking pada Shenandoah Modern

Shenandoah juga bergerak ke generational mode di Java modern. Pada Java 25, Generational Shenandoah menjadi product feature.

Tujuannya mirip:

```text
reduce unnecessary tracing/evacuation work for objects that die young,
while preserving low-pause concurrent compaction behavior.
```

Tetapi seperti ZGC, detailnya berbeda dari generational collector klasik.

Prinsip yang tetap sama:

```text
Object lifetime distribution affects collector cost.
```

---

## 25. Reading GC Logs: Apa yang Dicari?

Saat membaca GC log untuk generational issue, cari pola berikut.

### 25.1 Young GC Frequency

```text
Young GC every few milliseconds
```

Kemungkinan:

- allocation rate sangat tinggi;
- young generation terlalu kecil;
- heap terlalu kecil;
- burst traffic;
- object churn ekstrem.

Tetapi jangan langsung tune. Lihat survival.

---

### 25.2 High Young Live After GC

```text
Young before: 1 GB
Young after : 700 MB
```

Kemungkinan:

- banyak object young masih reachable;
- request backlog;
- queue retention;
- batch window;
- cache staging;
- async lifecycle terlalu panjang;
- transaction scope terlalu besar.

---

### 25.3 High Promotion

```text
Promoted: 500 MB per young GC
```

Kemungkinan:

- survivor overflow;
- tenuring threshold efektif rendah;
- middle-lived object;
- old data structure menahan young object;
- young generation terlalu kecil;
- workload memang long-lived.

---

### 25.4 Old Gen After GC Rising

```text
Old after GC:
2.1 GB → 2.4 GB → 2.8 GB → 3.3 GB
```

Kemungkinan:

- leak;
- cache growth;
- unbounded collection;
- old garbage belum dikumpulkan;
- promotion lebih cepat daripada old reclaim;
- live set memang meningkat.

Bedakan:

```text
old occupancy before GC rises
```

vs

```text
old occupancy after GC rises
```

Yang kedua lebih mencurigakan.

---

### 25.5 Frequent Full GC

```text
Full GC repeated with little memory reclaimed
```

Ini sinyal serius.

Kemungkinan:

- live set terlalu besar untuk heap;
- memory leak;
- old generation tidak punya headroom;
- humongous allocation pressure;
- metaspace/classloader leak;
- native memory issue yang bukan terlihat dari heap saja.

---

## 26. Metrics yang Wajib Ada di Production

Untuk generational GC, dashboard minimal harus mencakup:

| Metric | Kenapa penting |
|---|---|
| Allocation rate | Mengukur object churn |
| Young GC count/rate | Mengukur frekuensi collection muda |
| Young GC pause p50/p95/p99 | Mengukur latency impact |
| Young before/after | Mengukur survival |
| Promotion rate | Mengukur tekanan ke old gen |
| Old used after GC | Mengukur live set/trend leak |
| Full GC count | Sinyal fallback/serious pressure |
| GC CPU time | Mengukur biaya collector |
| Heap committed/used/max | Kapasitas vs penggunaan |
| RSS/container memory | Membandingkan heap vs process memory |

Metric paling sering disalahpahami:

```text
heap used before GC
```

Heap used naik-turun normal. Yang lebih penting:

```text
heap used after GC trend
old generation after GC trend
promotion rate trend
```

---

## 27. Anti-Pattern: Menilai GC dari Heap Usage Sawtooth Saja

Heap sawtooth normal.

Contoh normal:

```text
heap used rises
young GC happens
heap used drops
heap used rises again
```

Ini bukan leak.

Leak lebih terlihat seperti:

```text
after-GC baseline rises over time
```

Contoh:

```text
After GC baseline:
500 MB → 700 MB → 900 MB → 1.2 GB → 1.6 GB
```

Atau:

```text
Old after mixed/full GC keeps rising
```

Jangan panik hanya karena heap used naik sebelum GC.

---

## 28. Anti-Pattern: Tuning GC Sebelum Memahami Object Lifetime

Kesalahan umum:

```text
GC pause tinggi → tambah Xmx
GC sering       → tambah young gen
Old penuh       → ganti collector
```

Kadang benar, sering tidak.

Urutan diagnosis yang lebih baik:

```text
1. Berapa allocation rate?
2. Berapa survival rate?
3. Berapa promotion rate?
4. Old after GC naik atau stabil?
5. Apakah banyak middle-lived object?
6. Apakah ada old data structure menahan young object?
7. Apakah heap memang kurang atau lifecycle object salah?
8. Baru pilih/tune collector.
```

GC tuning tidak boleh menjadi pengganti desain lifecycle object.

---

## 29. Design Patterns yang Ramah Generational GC

### 29.1 Keep Temporary Objects Truly Temporary

Object request-scope sebaiknya tidak bocor ke long-lived structure.

Buruk:

```java
static final List<RequestContext> DEBUG_CONTEXTS = new ArrayList<>();

void handle(RequestContext ctx) {
    DEBUG_CONTEXTS.add(ctx); // accidental retention
}
```

Lebih baik:

```java
void handle(RequestContext ctx) {
    log(ctx.requestId());
}
```

Simpan identifier kecil, bukan seluruh graph.

---

### 29.2 Avoid Parking Young Objects in Old Queues Too Long

Buruk:

```java
static final BlockingQueue<EventPayload> QUEUE = new LinkedBlockingQueue<>();

void publish(EventPayload payload) {
    QUEUE.add(payload);
}
```

Jika queue long-lived dan drain lambat, payload muda menjadi middle-lived/old.

Lebih baik:

- bounded queue;
- backpressure;
- payload lebih kecil;
- batching terkontrol;
- timeout/drop policy sesuai domain;
- observability queue age;
- jangan menahan graph besar.

---

### 29.3 Bound Caches Explicitly

Buruk:

```java
Map<String, UserProfile> cache = new ConcurrentHashMap<>();
```

Jika tidak ada eviction, ini bukan cache. Ini memory ownership permanen.

Lebih baik:

```text
cache = bounded by size and/or weight
entry TTL is explicit
eviction metrics are visible
value graph is intentionally small
```

---

### 29.4 Prefer Stable Long-Lived Data over Constant Mutation

Long-lived mutable structures yang terus mendapat young references dapat menciptakan remembered-set pressure.

Kadang lebih baik:

```text
build new immutable snapshot
publish atomically
let old snapshot die as a whole
```

Daripada:

```text
mutate old global graph continuously
```

Tetapi snapshot juga bisa mahal jika terlalu besar. Ini trade-off.

---

### 29.5 Reduce Object Graph Retention, Not Just Object Count

Object kecil yang menjadi root ke graph besar lebih berbahaya daripada object besar yang cepat mati.

Contoh:

```java
class RequestContext {
    HttpRequest request;
    User user;
    Map<String, Object> attributes;
    byte[] body;
}
```

Menyimpan `RequestContext` di queue/cache berarti menahan seluruh graph.

Lebih baik simpan:

```java
record RetryJob(String requestId, long userId, byte[] minimalPayload) {}
```

---

## 30. Case Study 1: High Allocation, Low Promotion

Gejala:

```text
Allocation rate: 1.5 GB/s
Young GC: frequent
Young pause: acceptable
Promotion rate: low
Old after GC: stable
Full GC: none
```

Interpretasi:

```text
Aplikasi allocation-heavy tetapi object mati muda.
```

Kemungkinan tindakan:

- jangan buru-buru object pooling;
- jangan buru-buru ganti GC;
- cek CPU GC overhead;
- optimasi allocation hanya jika CPU/latency bermasalah;
- gunakan JFR allocation profiling untuk hotspot allocation;
- fokus pada hot path yang benar-benar mahal.

Object pooling dalam kasus ini bisa memperburuk keadaan karena membuat object hidup lebih lama dan meningkatkan old-gen retention.

---

## 31. Case Study 2: Moderate Allocation, High Promotion

Gejala:

```text
Allocation rate: 300 MB/s
Young GC: moderate
Promotion rate: 200 MB/s
Old after GC: rising
Mixed/full GC: increasing
```

Interpretasi:

```text
Bukan sekadar banyak allocation.
Banyak object bertahan cukup lama untuk masuk old.
```

Kemungkinan akar masalah:

- queue backlog;
- cache TTL terlalu panjang;
- async completion lambat;
- transaction batch terlalu besar;
- request object tertahan oleh lambda/future;
- listener registry leak;
- survivor space overflow.

Tindakan:

```text
1. Inspect heap dump dominator tree.
2. Cari old objects yang menahan banyak young-ish payload.
3. Ukur queue size dan queue age.
4. Cek cache size/weight/eviction.
5. Cek old after GC trend.
6. Baru pertimbangkan GC tuning.
```

---

## 32. Case Study 3: Cache sebagai Promotion Machine

Kode:

```java
class ProductService {
    private final Map<String, ProductView> cache = new ConcurrentHashMap<>();

    ProductView get(String id) {
        return cache.computeIfAbsent(id, this::loadProductView);
    }
}
```

Masalah:

- key tidak bounded;
- value besar;
- value berisi nested graph;
- invalidation tidak jelas;
- traffic unik tinggi.

GC symptoms:

```text
old generation grows
promotion rate high
full GC reclaims little
heap dump dominated by ConcurrentHashMap nodes and ProductView graph
```

Fix bukan GC flag. Fix desain ownership:

- bounded cache;
- max weight;
- TTL;
- explicit invalidation;
- smaller value;
- cache only ID/projection minimal;
- metrics hit/miss/eviction/load time/weight.

---

## 33. Case Study 4: Async Queue Middle-Lived Data

Kode:

```java
record EmailJob(String recipient, String subject, String body, Map<String, Object> model) {}

BlockingQueue<EmailJob> queue = new LinkedBlockingQueue<>();
```

Ketika email provider lambat:

```text
queue grows
jobs live for seconds/minutes
young GC sees them alive
jobs promoted
old gen grows
```

Masalah bukan semata GC. Masalahnya lifecycle queue.

Fix:

- bounded queue;
- persistent queue/message broker;
- backpressure;
- payload minimal;
- separate large body storage;
- timeout/dead-letter;
- queue age metrics;
- consumer scaling;
- retry policy yang tidak menahan object graph di heap.

---

## 34. Case Study 5: Request Context Captured by Lambda

Kode:

```java
void handle(RequestContext ctx) {
    CompletableFuture.runAsync(() -> {
        audit(ctx);
    });
}
```

Masalah:

Lambda menangkap `ctx`, bukan hanya field yang dibutuhkan.

Jika async executor backlog:

```text
RequestContext retained
body/session/user/attributes retained
middle-lived graph promoted
```

Lebih baik:

```java
void handle(RequestContext ctx) {
    String requestId = ctx.requestId();
    long userId = ctx.userId();

    CompletableFuture.runAsync(() -> {
        audit(requestId, userId);
    });
}
```

Prinsip:

```text
Capture minimal stable data, not the whole request graph.
```

---

## 35. Generational GC and Object Pooling

Object pooling sering terlihat menggoda:

```text
allocation tinggi → pool object
```

Tetapi di generational GC, pooling bisa buruk.

Kenapa?

Object yang seharusnya mati muda malah dibuat long-lived:

```text
temporary object
  → returned to pool
  → pool is old
  → object becomes old
  → reused/mutated
  → remembered-set/write-barrier pressure
  → stale state risk
```

Object pooling masuk akal jika:

- allocation sangat mahal di luar heap;
- object memegang native resource;
- buffer besar;
- lifecycle ketat;
- clear/reset aman;
- pool bounded;
- contention rendah;
- manfaat terukur.

Untuk object Java kecil biasa, biarkan GC bekerja kecuali profiling membuktikan sebaliknya.

---

## 36. Generational GC and Large Objects

Large object punya perilaku berbeda per collector.

Di G1, object sangat besar bisa menjadi humongous allocation dan ditaruh di humongous regions. Ini akan dibahas lebih detail di bagian G1, tetapi mental model awalnya:

```text
large object does not behave like ordinary tiny young object
```

Contoh large allocation:

```java
byte[] data = new byte[64 * 1024 * 1024];
```

Risiko:

- langsung old/humongous handling;
- sulit dipindahkan;
- fragmentation/region pressure;
- pause/marking impact;
- allocation failure.

Untuk large data:

- streaming lebih baik daripada materialization;
- chunking lebih aman;
- off-heap/direct/mmap mungkin relevan;
- bounded buffer wajib;
- hindari menyimpan large byte array di cache tanpa weight limit.

---

## 37. Generational GC and Reference Types

Bagian reference sudah dibahas sebelumnya, tetapi dalam generational GC ada efek khusus:

- soft references dapat bertahan sampai memory pressure, membuat cache sulit diprediksi;
- weak references butuh reference processing;
- phantom references/cleaner dapat menunda resource cleanup;
- reference queues perlu didrain;
- banyak reference object bisa menambah GC processing cost.

Jangan membangun cache high-throughput hanya dengan `SoftReference` dan berharap GC menjadi cache manager sempurna.

Prinsip:

```text
Cache policy should be explicit.
GC should not be your primary eviction policy.
```

---

## 38. Java 8 sampai 25: Perubahan Cara Berpikir

### Java 8

Fokus generational klasik sangat dominan:

- young/old tuning;
- CMS failure;
- Parallel throughput;
- G1 optional/adopted gradually;
- GC log format lama;
- `PermGen` sudah berganti Metaspace.

### Java 9 sampai 17

G1 menjadi default di banyak distribusi HotSpot modern.

Cara berpikir:

```text
region-based generational GC
pause target
mixed collections
remembered set pressure
humongous allocation
```

### Java 21

Generational ZGC tersedia sebagai feature penting untuk low-latency workload.

Cara berpikir:

```text
heap headroom
allocation stall risk
concurrent GC capacity
low-pause objective
```

### Java 24/25

ZGC generational menjadi baseline modern. Java SE 25 docs menyatakan ZGC adalah generational dan opsi `ZGenerational` sudah dihapus.

Java 25 juga relevan untuk Generational Shenandoah.

Cara berpikir:

```text
generational lifetime separation is now relevant even for modern concurrent low-latency collectors
```

---

## 39. Practical Diagnostic Decision Tree

Ketika melihat masalah GC, gunakan urutan ini.

### Step 1: Apakah heap after-GC naik?

```text
No  → mungkin allocation churn normal
Yes → lanjut
```

### Step 2: Apakah promotion rate tinggi?

```text
No  → mungkin old live set tumbuh karena long-lived allocation langsung/cache
Yes → cari middle-lived object atau survivor overflow
```

### Step 3: Apakah young live after GC tinggi?

```text
Yes → object request/batch/queue bertahan terlalu lama
No  → promotion mungkin berasal dari threshold/ergonomics/large object
```

### Step 4: Apakah old after full/mixed GC tetap tinggi?

```text
Yes → live set atau leak
No  → old garbage ada, collector mungkin terlambat/kurang headroom
```

### Step 5: Apakah RSS naik tanpa heap naik?

```text
Yes → native/direct/mmap/thread/metaspace, bukan murni generational heap
```

---

## 40. Checklist Engineering untuk Mengurangi Promotion Pressure

Gunakan checklist ini ketika promotion rate tinggi.

### Request Lifecycle

- Apakah request context ditahan di async job?
- Apakah request body disimpan terlalu lama?
- Apakah MDC/logging context bocor?
- Apakah lambda menangkap object besar?

### Queue dan Backlog

- Apakah queue bounded?
- Apakah queue age diukur?
- Apakah consumer lambat?
- Apakah retry menahan payload penuh?

### Cache

- Apakah cache punya max size/weight?
- Apakah key cardinality terkendali?
- Apakah value graph terlalu besar?
- Apakah TTL/invalidation jelas?

### Batch

- Apakah batch materialize semua data?
- Apakah bisa streaming/chunking?
- Apakah intermediate list/map terlalu besar?

### Data Structure

- Apakah old mutable graph sering menerima young references?
- Apakah linked structures menyebabkan pointer chasing?
- Apakah object graph bisa diringkas?

### GC Config

- Apakah young terlalu kecil?
- Apakah survivor overflow?
- Apakah heap headroom kurang?
- Apakah collector sesuai latency/throughput objective?

---

## 41. Checklist GC Log untuk Generational Analysis

Saat mengambil GC log, pastikan bisa menjawab:

```text
1. Berapa allocation rate?
2. Berapa young GC interval?
3. Berapa young pause p95/p99?
4. Berapa young before/after?
5. Berapa survivor occupancy?
6. Berapa promotion per event?
7. Berapa old before/after?
8. Apakah old after GC naik?
9. Apakah ada evacuation/promotion failure?
10. Apakah ada full GC fallback?
11. Apakah humongous object muncul?
12. Apakah GC CPU terlalu tinggi?
```

Tanpa data ini, diskusi tuning sering berubah menjadi tebak-tebakan.

---

## 42. Mental Model Akhir

Generational GC bukan hanya tentang membagi heap menjadi young dan old.

Generational GC adalah strategi untuk mengeksploitasi pola umur object.

Ringkasnya:

```text
Allocation rate tells how fast objects are born.
Survival rate tells how many refuse to die young.
Promotion rate tells how much young garbage becomes old pressure.
Old-after-GC trend tells whether memory is truly retained.
```

Kalau hanya ingat satu hal dari bagian ini, ingat ini:

```text
The enemy is not allocation.
The enemy is accidental retention across GC boundaries.
```

Allocation yang mati muda sering murah. Object yang tidak sengaja bertahan melewati beberapa young GC dapat menjadi mahal karena masuk old generation, memperbesar live set, memperberat marking, dan meningkatkan risiko pause panjang.

---

## 43. Hubungan dengan Bagian Berikutnya

Bagian ini memberi fondasi untuk collector spesifik.

Bagian berikutnya akan membahas collector legacy dan semi-legacy:

```text
Serial, Parallel, CMS: Legacy Collectors You Still Need to Understand
```

Kenapa masih penting?

Karena:

- banyak sistem Java 8 masih memakai Parallel/CMS;
- banyak istilah GC modern berasal dari collector lama;
- memahami failure mode CMS/Parallel membantu memahami kenapa G1, ZGC, dan Shenandoah berkembang;
- migrasi Java 8 ke 17/21/25 sering melibatkan perubahan collector.

---

# Referensi

- Oracle Java SE 25 Garbage Collection Tuning Guide — G1 Garbage Collector.
- Oracle Java SE 25 Garbage Collection Tuning Guide — Z Garbage Collector.
- Oracle Java SE 25 Garbage Collection Tuning Guide — Factors Affecting Garbage Collection Performance.
- OpenJDK JEP 439 — Generational ZGC.
- Oracle Java SE 17 GC Tuning Guide — G1 basic concepts.
- Oracle legacy HotSpot GC tuning documentation for young generation, survivor spaces, and tenuring concepts.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Garbage Collection Fundamentals: Tracing, Roots, Mark, Sweep, Copy, Compact](./learn-java-memory-byte-bit-buffer-offheap-gc-part-018.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Serial, Parallel, CMS: Legacy Collectors You Still Need to Understand](./learn-java-memory-byte-bit-buffer-offheap-gc-part-020.md)
