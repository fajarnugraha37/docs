# learn-redis-mastery-for-java-engineers-part-002.md

# Part 002 — Redis Data Model: Keys, Values, Types, Encodings

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memakai Redis secara benar dalam sistem produksi  
> Fokus bagian ini: membangun mental model tentang **keyspace**, **Redis data types**, **schema design**, **internal encoding**, dan konsekuensi desain terhadap **memory**, **latency**, **cluster**, dan **evolusi aplikasi**.

---

## 0. Posisi Bagian Ini dalam Seri

Di Part 000 kita membangun orientasi: Redis bukan sekadar cache, tetapi in-memory data structure server dengan konsekuensi operasional besar.

Di Part 001 kita membahas Redis sebagai server: command masuk lewat koneksi client, diproses oleh Redis, dan setiap command individual bersifat atomic terhadap command lain.

Bagian ini naik satu level: **apa sebenarnya yang kita simpan di Redis?**

Banyak engineer salah memakai Redis bukan karena tidak tahu command, tetapi karena salah memodelkan data:

- key terlalu panjang atau terlalu pendek tanpa namespace;
- value terlalu besar;
- tidak ada TTL policy;
- key tidak cluster-safe;
- satu Redis dipakai bersama banyak bounded context tanpa ownership;
- Hash dijadikan tabel besar;
- Sorted Set dipakai tanpa memahami score precision;
- JSON dipakai seperti document database penuh;
- semua data disimpan sebagai serialized Java object;
- tidak ada strategi evolusi schema;
- tidak ada jawaban jelas: “kalau key ini hilang, apa yang terjadi?”

Part ini bertujuan membentuk cara berpikir yang membuat command Redis terasa natural.

---

## 1. Redis Data Model dalam Satu Kalimat

Redis menyimpan **mapping dari key string ke value bertipe tertentu**.

Secara konseptual:

```text
keyspace:
  "user:123:profile"      -> Hash
  "session:abc"           -> String
  "tenant:42:quota"       -> String counter
  "leaderboard:daily"     -> Sorted Set
  "order:{9001}:events"   -> Stream
  "feature:beta:users"    -> Set
```

Ini terlihat sederhana, tetapi desainnya berbeda tajam dari SQL database, document database, atau message broker.

Redis tidak memiliki:

- tabel;
- foreign key;
- join;
- query planner tradisional;
- schema eksplisit;
- transaction rollback seperti RDBMS;
- automatic relational consistency;
- built-in ownership model antar service.

Redis memiliki:

- key namespace;
- value dengan tipe data kaya;
- command yang sangat spesifik untuk setiap tipe;
- TTL per key;
- memory-first storage;
- optional persistence;
- atomic command execution;
- clustering berbasis hash slot;
- server-side primitives seperti Lua/functions;
- data types modern seperti JSON, Search, dan Vector Set pada Redis modern.

Redis documentation mengelompokkan tipe umum seperti Strings, Hashes, Lists, Sets, Sorted Sets, Streams, JSON, geospatial, probabilistic structures, dan lain-lain sebagai data type yang masing-masing punya operasi dan karakteristik berbeda. Redis Hash misalnya didokumentasikan sebagai record type berisi field-value pairs, sementara Sorted Set adalah collection unik dengan score untuk ordering.  

Referensi resmi: Redis data types, Redis hashes, Redis sorted sets, memory optimization, dan Redis Cluster hash slots.

---

## 2. Mental Model: Redis Bukan Remote HashMap

Kesalahan mental model paling umum:

```java
Map<String, Object> redis = new RemoteHashMap<>();
```

Ini berbahaya.

Kenapa?

Karena Redis bukan sekadar Map remote. Redis adalah server dengan:

1. **network round-trip** untuk setiap command;
2. **memory overhead** untuk setiap key dan object internal;
3. **type-specific command semantics**;
4. **TTL dan eviction behavior**;
5. **cluster slot constraints**;
6. **command complexity** yang berbeda-beda;
7. **serialization boundary** antara JVM dan Redis;
8. **operational consequences** ketika key count, value size, atau cardinality membesar.

Di Java, local map seperti:

```java
ConcurrentHashMap<String, UserSession> sessions = new ConcurrentHashMap<>();
```

punya karakteristik:

- akses memory lokal;
- object reference native JVM;
- GC pressure lokal;
- consistency hanya dalam proses;
- hilang saat proses mati;
- tidak bisa di-share antar instance tanpa mekanisme lain.

Redis-backed state seperti:

```text
session:{sessionId} -> JSON/String/Hash with TTL
```

punya karakteristik:

- remote access;
- shared antar service instance;
- serialized representation;
- memory Redis, bukan heap JVM;
- latency network;
- TTL bisa natural;
- failure Redis memengaruhi request path;
- value harus didesain agar tidak terlalu besar;
- key harus diperlakukan sebagai API internal antar komponen.

Jadi pertanyaan desainnya bukan:

> “Bagaimana saya simpan object Java ini di Redis?”

Tetapi:

> “State apa yang perlu diwakili Redis, dengan lifecycle apa, operasi dominan apa, failure behavior apa, dan tipe data Redis mana yang paling natural?”

---

## 3. Keyspace: Database Logis Redis

Redis keyspace adalah seluruh kumpulan key dalam satu logical database.

Contoh:

```text
GET user:123:name
HGETALL user:123:profile
SMEMBERS user:123:roles
ZADD leaderboard:daily 1500 user:123
XADD order:{9001}:events * type created by system
```

Semua key hidup dalam namespace yang sama pada logical database tersebut.

Redis memang punya logical database index seperti `SELECT 0`, `SELECT 1`, dan seterusnya pada mode non-cluster tertentu, tetapi dalam sistem produksi modern, khususnya cluster dan managed Redis, bergantung pada multiple logical DB sering menjadi sumber kebingungan. Lebih defensible memakai **namespace eksplisit di key name**.

Contoh buruk:

```text
123
profile
token
active
queue
```

Contoh lebih baik:

```text
identity:user:123:profile
identity:user:123:sessions
billing:invoice:2026-06:10001
workflow:case:987:state
ratelimit:api-key:ak_123:/v1/search
cache:product:sku:ABC-001
```

Key name adalah bagian dari desain sistem. Ia bukan detail teknis kecil.

---

## 4. Anatomy of a Good Redis Key

Key Redis yang baik biasanya menjawab beberapa pertanyaan:

1. **Siapa pemiliknya?**
2. **Domain atau bounded context-nya apa?**
3. **Entity apa yang direpresentasikan?**
4. **Instance identifier-nya apa?**
5. **State/aspect apa yang disimpan?**
6. **Apakah harus cluster-friendly?**
7. **Apakah perlu TTL?**
8. **Apakah key ini temporary, cache, atau operational state?**

Template umum:

```text
<domain>:<entity>:<id>:<aspect>
```

Contoh:

```text
identity:user:123:profile
identity:user:123:roles
case:enforcement:987:state
case:enforcement:987:timeline
cache:product:sku:ABC-001:v1
ratelimit:tenant:42:user:123:login
lock:settlement:batch:2026-06-20
idempotency:payment:request:req_789
```

Untuk Redis Cluster dan multi-key operation, gunakan hash tag dengan hati-hati:

```text
case:{987}:state
case:{987}:timeline
case:{987}:locks
case:{987}:events
```

Bagian dalam `{}` akan digunakan untuk menentukan hash slot. Tujuannya agar key-key terkait bisa berada pada slot yang sama, sehingga operasi multi-key tertentu memungkinkan.

Redis Cluster memiliki 16.384 hash slots. Key dipetakan ke slot, dan slot didistribusikan ke node cluster. Hash tags memungkinkan beberapa key sengaja diletakkan di slot yang sama. Ini berguna untuk multi-key operations, tetapi dapat menciptakan hot slot jika dipakai sembarangan.

---

## 5. Key Naming: Jangan Terlalu Pendek, Jangan Terlalu Panjang

Redis menyimpan key sebagai string. Key juga memakan memory.

Contoh terlalu pendek:

```text
u:1:p
```

Masalah:

- susah dipahami;
- rawan collision antar tim;
- sulit debugging saat incident;
- tidak self-documenting;
- observability buruk.

Contoh terlalu panjang:

```text
production:identity-service:asia-southeast2:tenant-management-context:user-profile-management-module:users:123456789:full-profile-object:version-1
```

Masalah:

- memboroskan memory;
- log dan metric noisy;
- menambah network payload;
- key count tinggi akan memperbesar overhead total.

Contoh seimbang:

```text
identity:user:123:profile:v1
tenant:42:user:123:session:abc
case:{987}:state:v2
```

Rule of thumb:

- Gunakan prefix domain yang jelas.
- Gunakan delimiter konsisten, biasanya `:`.
- Sertakan versi jika schema value mungkin berubah.
- Gunakan hash tag hanya untuk entity group yang benar-benar butuh co-location.
- Jangan memasukkan data sensitif langsung ke key.
- Hindari key dengan free-form text panjang.
- Hindari key yang bergantung pada format yang tidak stabil.

---

## 6. Key sebagai API Internal

Dalam microservices, Redis key sering menjadi **kontrak tidak tertulis**.

Contoh:

Service A menulis:

```text
user:123:profile
```

Service B membaca:

```text
user:123:profile
```

Jika A mengubah format value, B bisa rusak diam-diam.

Maka key Redis harus diperlakukan seperti API internal:

- punya owner;
- punya schema;
- punya lifecycle;
- punya versioning;
- punya compatibility rule;
- punya deletion policy;
- punya migration plan.

Untuk sistem regulatory atau case management, ini sangat penting. Redis sering menyimpan state sementara, lock, idempotency, rate limiter, session, atau cache. Jika kontraknya tidak eksplisit, incident dapat terlihat seperti “random missing data”, padahal akar masalahnya adalah desain keyspace.

Dokumentasikan minimal:

```text
Key pattern      : case:{caseId}:state:v1
Owner            : case-service
Redis type       : Hash
TTL              : none / 7 days / 30 minutes
Source of truth  : PostgreSQL table case_state
Consistency      : eventually refreshed from DB
Cluster rule     : {caseId} hash tag
Allowed readers  : case-service only / workflow-service read-only
Allowed writers  : case-service
Schema fields    : status, version, updatedAt, updatedBy
Failure behavior : on miss, reload from DB
```

---

## 7. Redis Value: Type Matters

Setiap key menunjuk ke value dengan tipe Redis tertentu.

Tipe Redis bukan sekadar serialization detail. Tipe menentukan:

- command yang tersedia;
- atomicity granularity;
- memory layout;
- operation complexity;
- read/write pattern;
- apakah partial update murah;
- apakah range query natural;
- apakah membership test cepat;
- apakah order penting;
- apakah approximated result acceptable;
- apakah cocok untuk TTL sebagai whole key.

Contoh pilihan tipe:

```text
Need store one token?                 String
Need increment counter?               String integer counter
Need object fields with partial read? Hash
Need FIFO queue?                      List or Stream depending reliability need
Need unique membership?               Set
Need ranking/time ordering?           Sorted Set
Need append-only event log?           Stream
Need compact boolean flags?           Bitmap
Need approximate unique count?        HyperLogLog
Need geo radius query?                Geospatial
Need structured JSON update/query?    RedisJSON/Search
Need vector similarity?               Vector Set / Search vector index depending design
```

Redis data modeling is choosing the **operation shape** first, then the type.

Jangan mulai dari class Java.

Mulailah dari pertanyaan:

> “Operasi paling sering apa?”

---

## 8. Redis Type vs Application Type

Java type:

```java
class UserProfile {
    String userId;
    String displayName;
    String email;
    Set<String> roles;
    Instant updatedAt;
}
```

Bisa dimodelkan di Redis sebagai beberapa cara:

### Option A — JSON/String blob

```text
key: identity:user:123:profile:v1
value: {"userId":"123","displayName":"Ayu","email":"ayu@example.com","roles":["admin"],"updatedAt":"..."}
```

Kelebihan:

- sederhana;
- cocok untuk cache whole object;
- mudah di-serialize;
- satu `GET` cukup.

Kekurangan:

- partial update butuh read-modify-write;
- race condition jika banyak writer;
- semua field ikut terbaca;
- ukuran value bisa membesar;
- schema evolution harus dikontrol.

### Option B — Hash

```text
key: identity:user:123:profile:v1
fields:
  displayName -> Ayu
  email       -> ayu@example.com
  updatedAt   -> 2026-06-20T10:00:00Z
```

Kelebihan:

- partial read/write natural;
- field-level counter memungkinkan;
- memory efficient untuk small object tertentu;
- tidak perlu deserialize semua field.

Kekurangan:

- nested object tidak natural;
- semua field tetap string/binary;
- mapping DTO lebih eksplisit;
- TTL tetap per key, bukan per field.

### Option C — Multiple keys

```text
identity:user:123:displayName -> Ayu
identity:user:123:email       -> ayu@example.com
identity:user:123:roles       -> Set
```

Kelebihan:

- setiap aspek bisa punya tipe sendiri;
- roles bisa Set;
- counters bisa String integer;
- update granular.

Kekurangan:

- lebih banyak key;
- memory overhead lebih besar;
- multi-key consistency lebih sulit;
- Redis Cluster constraint muncul;
- cleanup lebih sulit.

Tidak ada satu jawaban universal. Yang benar bergantung pada read/write pattern, consistency need, dan operational budget.

---

## 9. Core Redis Data Types Overview

Bagian ini belum membahas setiap command detail. Itu akan masuk ke part-part berikutnya. Di sini kita bangun peta mentalnya.

---

## 9.1 Strings

Redis String adalah tipe paling dasar. Isinya binary-safe string sampai batas ukuran tertentu.

Digunakan untuk:

- cache serialized object;
- token;
- session blob;
- counter;
- feature flag scalar;
- lock value;
- idempotency marker;
- small config value.

Contoh:

```text
SET session:abc "{...}" EX 1800
GET session:abc
INCR ratelimit:user:123:login:2026-06-20T10:00
SET lock:batch:42 token-xyz NX PX 30000
```

Mental model:

> String adalah scalar/blob. Cocok jika operasi utama adalah read/write whole value atau atomic numeric increment.

Jangan otomatis menyimpan semua object Java sebagai String JSON. Itu mudah di awal, tetapi bisa mahal ketika butuh partial update, conditional update, atau large object.

---

## 9.2 Hashes

Hash adalah collection field-value dalam satu key.

Digunakan untuk:

- object sederhana;
- profile kecil;
- state machine snapshot;
- counters per dimension;
- metadata;
- small maps.

Contoh:

```text
HSET case:{987}:state status OPEN version 12 assignee user-42
HGET case:{987}:state status
HINCRBY case:{987}:metrics retryCount 1
```

Mental model:

> Hash adalah record ringan, bukan tabel relational.

Hash cocok jika Anda sering membaca atau menulis sebagian field.

Anti-pattern:

```text
HSET all_users 123 "{...}"
HSET all_users 124 "{...}"
HSET all_users 125 "{...}"
```

Ini menjadikan satu Hash sebagai pseudo-table besar. Masalahnya:

- key menjadi big key;
- operasi tertentu dapat berat;
- sulit TTL per user;
- sulit shard per entity;
- satu key menjadi hotspot;
- migration dan cleanup sulit.

Lebih baik:

```text
identity:user:123:profile
identity:user:124:profile
identity:user:125:profile
```

---

## 9.3 Lists

List adalah sequence string yang bisa didorong/dipop dari kiri atau kanan.

Digunakan untuk:

- simple queue;
- stack;
- recent items;
- bounded log kecil;
- blocking worker sederhana.

Contoh:

```text
LPUSH queue:email job-1
RPOP queue:email
BLPOP queue:email 5
```

Mental model:

> List cocok untuk urutan sederhana, bukan durable event streaming serius.

Jika Anda butuh consumer group, pending message tracking, replay, atau acknowledgment, Redis Streams lebih natural daripada List.

---

## 9.4 Sets

Set adalah collection unik tanpa urutan.

Digunakan untuk:

- membership;
- deduplication;
- role membership;
- online users;
- feature targeting;
- processed event IDs;
- relationship sederhana.

Contoh:

```text
SADD feature:beta:users user-123
SISMEMBER feature:beta:users user-123
SREM presence:online user-123
SINTER role:admin tenant:42:active-users
```

Mental model:

> Set menjawab “apakah X anggota dari kelompok Y?” dengan cepat.

Hati-hati dengan operasi set besar seperti union/intersection pada production path. Complexity dan memory temporary dapat mengejutkan.

---

## 9.5 Sorted Sets

Sorted Set adalah collection member unik dengan score numeric.

Digunakan untuk:

- leaderboard;
- ranking;
- priority queue;
- delay queue;
- time index;
- sliding window rate limiter;
- scheduled task candidate list.

Contoh:

```text
ZADD leaderboard:daily 1500 user-123
ZRANGE leaderboard:daily 0 9 REV WITHSCORES
ZADD delay:emails 1781952000000 email-job-1
ZRANGEBYSCORE delay:emails -inf 1781952000000 LIMIT 0 100
```

Mental model:

> Sorted Set adalah index terurut di memory.

Score sering berupa timestamp, priority, ranking score, atau metric tertentu.

Risiko:

- score precision;
- pagination consistency;
- member uniqueness;
- memory cost;
- large range scans;
- cluster multi-key constraints.

---

## 9.6 Streams

Stream adalah append-only log-like data type dengan entry ID dan field-value pairs.

Digunakan untuk:

- event-like processing;
- lightweight durable-ish queue;
- consumer groups;
- audit-ish operational trail terbatas;
- background jobs dengan acknowledgment;
- integration antar komponen kecil.

Contoh:

```text
XADD order:{9001}:events * type created by user-123
XREAD COUNT 10 STREAMS order:{9001}:events 0
XGROUP CREATE workflow:events workers $ MKSTREAM
XREADGROUP GROUP workers worker-1 COUNT 10 STREAMS workflow:events >
```

Mental model:

> Stream lebih kuat dari Pub/Sub dan List untuk processing, tetapi bukan pengganti universal Kafka.

Redis Streams bagus untuk local/medium-scale event processing, tetapi perlu retention, trimming, pending entry management, dan recovery design.

---

## 9.7 Bitmaps

Bitmap memakai String sebagai underlying representation, tetapi memberi operasi bit-level.

Digunakan untuk:

- daily active users;
- attendance flags;
- compact boolean state;
- feature exposure tracking;
- eligibility bitsets.

Contoh:

```text
SETBIT dau:2026-06-20 12345 1
GETBIT dau:2026-06-20 12345
BITCOUNT dau:2026-06-20
```

Mental model:

> Bitmap cocok ketika identifier bisa dipetakan ke integer offset dan state-nya boolean.

Risiko:

- offset besar menciptakan sparse allocation besar;
- mapping ID ke offset harus stabil;
- sulit untuk entity ID non-numeric tanpa mapping.

---

## 9.8 HyperLogLog

HyperLogLog adalah probabilistic data structure untuk estimasi cardinality.

Digunakan untuk:

- approximate unique visitors;
- approximate unique API consumers;
- analytics ringan;
- deduplicated count tanpa menyimpan semua ID.

Contoh:

```text
PFADD unique:visitors:2026-06-20 user-123
PFCOUNT unique:visitors:2026-06-20
```

Mental model:

> HyperLogLog menjawab “berapa kira-kira jumlah unique item?” bukan “siapa saja itemnya?”

Untuk regulatory/audit system, jangan gunakan HyperLogLog sebagai source of truth. Ia cocok untuk metric estimasi, bukan bukti audit.

---

## 9.9 Geospatial

Geospatial Redis memungkinkan indexing koordinat dan query jarak.

Digunakan untuk:

- nearby store;
- driver location;
- region lookup sederhana;
- proximity search ringan.

Mental model:

> Geo Redis adalah Sorted Set dengan encoding geospatial di belakangnya.

Redis geo cocok untuk use case sederhana. Untuk GIS kompleks, polygon, routing, dan geospatial analytics berat, gunakan engine khusus.

---

## 9.10 JSON

RedisJSON memungkinkan menyimpan dokumen JSON dan melakukan operasi pada path tertentu.

Digunakan untuk:

- structured cache;
- document-like object;
- partial JSON update;
- integrasi dengan query/search;
- nested data yang lebih natural daripada Hash.

Contoh konseptual:

```text
JSON.SET product:sku:ABC-001 $ '{"name":"Keyboard","stock":10,"tags":["peripheral"]}'
JSON.GET product:sku:ABC-001 $.stock
JSON.NUMINCRBY product:sku:ABC-001 $.stock -1
```

Mental model:

> RedisJSON berguna ketika value memang dokumen, tetapi tetap tinggal di memory Redis dan tetap perlu memory discipline.

Jangan menganggap RedisJSON otomatis menggantikan MongoDB/PostgreSQL JSONB. Tanyakan:

- apakah data ini source of truth?
- apakah butuh query kompleks?
- apakah butuh durability kuat?
- apakah memory cost acceptable?
- apakah index cost acceptable?

---

## 9.11 Search / Query Engine

Redis modern dapat menyediakan indexing dan query untuk data tertentu.

Digunakan untuk:

- full-text search sederhana-menengah;
- filtering;
- secondary index atas JSON/Hash;
- vector search workloads tertentu;
- low-latency retrieval layer.

Mental model:

> Search di Redis memperluas Redis dari key-value access menjadi indexed retrieval, tetapi setiap index adalah tambahan memory, write amplification, dan operational complexity.

Jika Anda memakai Redis hanya sebagai cache, search index mungkin tidak perlu. Jika Redis menjadi retrieval layer, desain index harus diperlakukan seperti desain database.

---

## 9.12 Vector Set dan Vector Search

Redis 8 memperkenalkan Vector Set sebagai data structure untuk menyimpan vector embedding dan menjalankan similarity search tertentu.

Digunakan untuk:

- semantic similarity;
- recommendation candidate retrieval;
- AI agent memory retrieval;
- approximate nearest neighbor use cases tertentu.

Mental model:

> Vector capability di Redis berguna untuk low-latency retrieval, tetapi tidak membuat Redis otomatis menjadi jawaban untuk semua vector database workload.

Pertanyaan desain:

- berapa dimensi vector?
- berapa juta item?
- seberapa sering update?
- latency target?
- recall requirement?
- memory budget?
- apakah butuh hybrid search?
- apakah Redis harus source of truth atau serving index?

Untuk seri ini, Vector akan dibahas sebagai Redis capability modern, tetapi tidak akan menggantikan pembahasan khusus vector database.

---

## 10. Internal Encoding: Kenapa Perlu Peduli?

Redis mengekspos data types pada level command, tetapi di dalamnya Redis dapat menggunakan encoding yang berbeda tergantung ukuran dan bentuk data.

Contoh high-level:

- small Hash dapat memakai compact encoding seperti listpack;
- small Sorted Set dapat memakai compact encoding sebelum menjadi struktur yang lebih mahal;
- Set berisi integer dapat memakai encoding khusus;
- String kecil punya representasi yang berbeda dari String besar;
- Sorted Set besar umumnya membutuhkan kombinasi struktur untuk lookup dan ordering.

Redis documentation tentang memory optimization menjelaskan bahwa beberapa aggregate data type kecil dioptimalkan agar memakai memory lebih rendah hingga batas tertentu, seperti Hash, List, Set integer, dan Sorted Set kecil.

Kenapa Java engineer perlu peduli?

Karena perubahan ukuran data dapat mengubah karakteristik memory dan latency.

Contoh:

```text
Hash kecil:
  key: user:123:profile
  fields: 8
  memory: relatif compact

Hash membesar:
  fields: 10,000
  memory: jauh lebih besar
  latency: operasi tertentu memburuk
  operational risk: big key
```

Redis tidak hanya menyimpan payload. Ia menyimpan object metadata, key, allocator overhead, encoding structure, dan pointer/structure overhead.

Data yang terlihat kecil di aplikasi bisa jauh lebih mahal di Redis.

---

## 11. Encoding Bukan Kontrak Aplikasi

Penting: internal encoding bukan API stabil yang harus dijadikan dasar logic bisnis.

Jangan menulis desain seperti:

> “Karena Hash kecil pakai encoding X, maka aplikasi kami aman.”

Yang benar:

> “Kami menjaga Hash ini tetap kecil melalui invariant cardinality, monitoring, dan test.”

Encoding membantu kita memahami cost, tetapi aplikasi harus tetap bergantung pada Redis command semantics, bukan detail implementation.

---

## 12. Big Key: Musuh Utama Redis Data Model

Big key adalah key yang value-nya terlalu besar.

Bentuknya bisa:

- String berisi JSON 20 MB;
- Hash dengan ratusan ribu field;
- List dengan jutaan item;
- Set dengan jutaan member;
- Sorted Set besar tanpa partitioning;
- Stream tanpa trimming;
- JSON document nested besar.

Kenapa big key berbahaya?

1. Operasi terhadap key bisa memblokir Redis lebih lama.
2. Network transfer besar.
3. Replication bisa terbebani.
4. Persistence/rewrite lebih berat.
5. Deletion bisa mahal jika tidak asynchronous.
6. Cluster slot bisa menjadi hotspot.
7. Memory fragmentation memburuk.
8. Debugging incident lebih sulit.

Contoh anti-pattern:

```text
tenant:42:all-events -> List with 100 million entries
```

Lebih baik:

```text
tenant:42:events:2026-06-20
tenant:42:events:2026-06-21
tenant:42:events:2026-06-22
```

Atau gunakan Redis Streams dengan trimming, atau sistem event log yang lebih tepat seperti Kafka jika workload membutuhkan log besar dan durable.

---

## 13. Hot Key: Key yang Terlalu Populer

Big key berbicara tentang ukuran. Hot key berbicara tentang traffic.

Contoh hot key:

```text
cache:homepage
feature:global-config
leaderboard:daily
ratelimit:global:login
```

Masalah:

- satu Redis node menerima traffic berlebihan;
- Redis Cluster tidak otomatis membagi satu key ke banyak slot;
- replica reads bisa membantu read-heavy, tetapi consistency dan topology perlu desain;
- hot key dapat menciptakan latency spike.

Mitigasi:

- local cache di JVM untuk read-mostly data;
- key sharding untuk counter tertentu;
- TTL jitter;
- pre-compute multiple variants;
- separate Redis deployment untuk workload tertentu;
- avoid global lock/counter pada request path tinggi.

Data model harus memperhitungkan distribusi akses, bukan hanya bentuk data.

---

## 14. TTL adalah Bagian dari Data Model

Redis TTL berlaku pada key, bukan field.

Contoh:

```text
SET session:abc "..." EX 1800
EXPIRE identity:user:123:profile 300
TTL session:abc
```

Pertanyaan wajib untuk setiap key:

1. Apakah key ini harus expire?
2. Jika expire, berapa TTL?
3. Apakah TTL fixed atau diperbarui saat akses?
4. Apakah perlu jitter?
5. Apa yang terjadi saat key hilang?
6. Apakah missing key berarti error atau cache miss normal?
7. Apakah Redis boleh evict key ini saat memory penuh?
8. Apakah key ini boleh di-rebuild dari source of truth?

Contoh desain:

```text
cache:product:sku:ABC-001:v1
TTL: 10 minutes + jitter
On miss: reload from product-service/database
Source of truth: PostgreSQL
```

```text
idempotency:payment:req_789
TTL: 24 hours
On miss: request may be treated as new, depending idempotency window contract
Source of truth: Redis + payment ledger correlation
```

```text
lock:settlement:batch:2026-06-20
TTL: 30 seconds
On miss: lock expired; worker must rely on fencing token or downstream guard
Source of truth: not Redis lock alone
```

TTL bukan detail ops. TTL adalah bagian dari correctness.

---

## 15. Schema Design di Redis

Redis tidak memaksa schema, tetapi aplikasi tetap harus punya schema.

Contoh Hash schema:

```text
Key pattern:
  case:{caseId}:state:v1

Type:
  Hash

Fields:
  status      string enum: OPEN | UNDER_REVIEW | ESCALATED | CLOSED
  version     integer monotonic
  assignee    string user id, optional
  updatedAt   ISO-8601 timestamp
  updatedBy   string user id/system id

TTL:
  none

Source of truth:
  PostgreSQL case_state table

Miss behavior:
  reload from DB; if DB missing, return 404 domain error
```

Contoh String JSON schema:

```text
Key pattern:
  cache:case-summary:{caseId}:v2

Type:
  String JSON

Fields:
  caseId
  title
  status
  riskScore
  nextAction
  updatedAt

TTL:
  5 minutes + random jitter 0-60 seconds

Source of truth:
  case-service read model

Miss behavior:
  recompute summary
```

Schema perlu ditulis karena Redis tidak akan melindungi Anda dari:

- field typo;
- incompatible type;
- stale version;
- missing TTL;
- wrong serialization;
- reader/writer mismatch;
- accidental overwrite.

---

## 16. Type Safety Problem

Redis command akan gagal jika key ada tetapi tipe tidak sesuai.

Contoh:

```text
SET user:123:roles "admin"
SADD user:123:roles auditor
```

Command kedua akan error karena key `user:123:roles` sudah bertipe String, bukan Set.

Dalam Java, ini bisa terjadi karena:

- dua service memakai key pattern sama untuk tipe berbeda;
- versi lama dan versi baru berjalan bersamaan;
- test environment memakai stale data;
- developer manual mengisi Redis CLI;
- migration tidak membersihkan key lama;
- prefix tidak cukup spesifik.

Mitigasi:

1. Key prefix jelas.
2. Version suffix untuk format breaking change.
3. Contract test untuk key schema.
4. Redis ACL/prefix separation jika memungkinkan.
5. Avoid sharing Redis database antar bounded context tanpa governance.
6. Observability untuk WRONGTYPE errors.

Contoh versioning:

```text
identity:user:123:profile:v1  -> String JSON
identity:user:123:profile:v2  -> Hash
```

Migration bisa dilakukan bertahap:

1. Write v1 + v2.
2. Read prefer v2 fallback v1.
3. Observe traffic.
4. Stop writing v1.
5. Delete/expire v1.

---

## 17. Serialization Boundary untuk Java Engineer

Redis tidak menyimpan object Java. Redis menyimpan bytes.

Java object:

```java
record UserProfile(
    String userId,
    String displayName,
    List<String> roles,
    Instant updatedAt
) {}
```

Harus diubah menjadi representasi Redis:

- String JSON;
- Hash fields;
- RedisJSON document;
- multiple keys;
- binary format seperti Protobuf;
- atau kombinasi.

Pilihan serialization memengaruhi:

- readability via Redis CLI;
- compatibility;
- payload size;
- CPU cost;
- partial update;
- schema evolution;
- debugging;
- language interoperability;
- security.

### Hindari Java native serialization

Java native serialization biasanya buruk untuk Redis karena:

- tidak human-readable;
- versioning rapuh;
- payload besar;
- tight coupling ke class Java;
- security risk historis;
- menyulitkan service non-Java;
- debugging incident sulit.

Lebih umum:

- JSON untuk readability dan interoperability;
- Hash untuk field-level object sederhana;
- Protobuf/Avro jika ukuran dan schema governance penting;
- RedisJSON jika butuh nested partial updates/query.

---

## 18. Design by Access Pattern

Cara memilih tipe Redis:

### Pertanyaan 1 — Apakah saya membaca whole object atau field tertentu?

Whole object:

```text
String JSON
```

Partial fields:

```text
Hash / RedisJSON
```

### Pertanyaan 2 — Apakah saya butuh uniqueness?

Ya:

```text
Set
```

Dengan ranking/order:

```text
Sorted Set
```

### Pertanyaan 3 — Apakah saya butuh urutan append dan consumer processing?

Simple queue:

```text
List
```

Consumer group / acknowledgment:

```text
Stream
```

### Pertanyaan 4 — Apakah data hanya counter?

Simple counter:

```text
String + INCR
```

Counter per field:

```text
Hash + HINCRBY
```

Time-window counter:

```text
String keys per bucket / Sorted Set / Lua pattern
```

### Pertanyaan 5 — Apakah result boleh approximate?

Unique count saja:

```text
HyperLogLog
```

Boolean state massal:

```text
Bitmap
```

### Pertanyaan 6 — Apakah perlu query by non-key field?

Jika ya, Anda perlu:

- maintain secondary index sendiri dengan Sets/Sorted Sets;
- atau Redis Search/Query Engine;
- atau jangan pakai Redis sebagai query layer.

---

## 19. Secondary Index Manual

Redis basic key-value access tidak punya query seperti:

```sql
SELECT * FROM users WHERE tenant_id = 42 AND status = 'ACTIVE';
```

Jika butuh query, Anda harus membuat index sendiri atau memakai Redis Search.

Contoh manual index:

```text
user:123:profile                  -> Hash/String
idx:tenant:42:users               -> Set of user IDs
idx:tenant:42:user-status:ACTIVE  -> Set of user IDs
idx:tenant:42:user-created        -> Sorted Set userId scored by timestamp
```

Write path harus update data dan index:

```text
HSET user:123:profile status ACTIVE tenantId 42
SADD idx:tenant:42:users 123
SADD idx:tenant:42:user-status:ACTIVE 123
ZADD idx:tenant:42:user-created 1781952000000 123
```

Risiko:

- index stale;
- partial write failure;
- cleanup sulit;
- multi-key cluster constraint;
- transaction/Lua mungkin dibutuhkan;
- source of truth ambiguity.

Dalam banyak sistem, lebih baik query tetap di SQL/search engine, Redis hanya cache hasil query atau state akses cepat.

---

## 20. Cluster-Aware Data Modeling

Redis Cluster membagi keyspace ke 16.384 hash slots. Setiap key berada di satu slot.

Implikasi:

- operasi single-key aman secara natural;
- multi-key operation butuh keys berada pada slot yang sama;
- cross-slot command bisa gagal;
- transaction multi-key perlu slot sama;
- Lua script di cluster harus memperhatikan key slot;
- naming key harus dipikirkan sejak awal.

Contoh tidak cluster-safe:

```text
case:987:state
case:987:events
case:987:locks
```

Key-key ini mungkin masuk slot berbeda.

Contoh cluster-friendly:

```text
case:{987}:state
case:{987}:events
case:{987}:locks
```

Semua memakai hash tag `{987}` sehingga diarahkan ke slot yang sama.

Tapi hati-hati:

```text
tenant:{42}:user:1
tenant:{42}:user:2
tenant:{42}:user:3
...
```

Jika tenant 42 sangat besar, semua key tenant 42 masuk satu slot dan bisa menjadi hot slot.

Jadi hash tag harus dipilih berdasarkan unit konsistensi, bukan sekadar domain besar.

Better:

```text
tenant:42:user:{1}:profile
tenant:42:user:{2}:profile
```

Atau:

```text
user:{1}:profile
user:{1}:sessions
user:{1}:quota
```

Pilih hash tag berdasarkan operasi multi-key yang benar-benar dibutuhkan.

---

## 21. Ownership dan Bounded Context

Redis sering menjadi tempat “nyampah” state karena mudah dipakai.

Contoh buruk:

```text
user:123
session:123
cache:abc
lock:123
queue:jobs
state:case:1
```

Semua service menulis di tempat yang sama tanpa ownership.

Akibat:

- collision;
- accidental deletion;
- inconsistent TTL;
- migration sulit;
- security boundary kabur;
- incident sulit ditriage;
- satu service bisa menyebabkan eviction untuk service lain.

Gunakan ownership explicit:

```text
identity:user:123:profile
identity:user:123:roles
auth:session:abc
case:enforcement:{987}:state
case:enforcement:{987}:locks
billing:invoice:1001:cache:v1
notification:email:queue
```

Untuk organisasi besar, bahkan prefix service saja belum cukup. Perlu governance:

```text
<product-or-domain>:<service>:<entity>:<id>:<aspect>:<version>
```

Namun jangan terlalu verbose. Cari keseimbangan antara readability dan memory.

---

## 22. Key Lifecycle States

Setiap key punya lifecycle.

Contoh cache key:

```text
created -> read hits -> stale -> expired/evicted -> rebuilt
```

Contoh idempotency key:

```text
created as STARTED -> updated COMPLETED -> retained until idempotency window expires -> deleted
```

Contoh lock key:

```text
acquired -> renewed? -> released safely or expired
```

Contoh stream key:

```text
created -> entries appended -> consumer group reads -> acknowledged -> trimmed -> archived? / deleted
```

Contoh rate limit key:

```text
created on first request -> incremented during window -> expired automatically
```

Jika lifecycle tidak jelas, Redis akan menjadi memory leak.

Minimal lifecycle document:

```text
Creation trigger:
Update trigger:
Read path:
Expiration/deletion:
Rebuild behavior:
Owner:
Failure semantics:
Monitoring:
```

---

## 23. Data Model dan Failure Behavior

Redis key model harus menjawab skenario gagal.

### Scenario A — Key missing

Apa artinya?

- cache miss normal?
- session expired?
- data corruption?
- idempotency window expired?
- lock released?
- invalid state?

Contoh:

```text
GET cache:product:ABC -> nil
```

Normal: reload from DB.

```text
GET auth:session:abc -> nil
```

Normal: user session expired; request unauthorized.

```text
GET workflow:case:987:state -> nil
```

Mungkin abnormal jika Redis adalah transient state store tanpa fallback.

### Scenario B — Wrong type

Artinya schema collision atau migration bug.

### Scenario C — Value too large

Artinya model melanggar invariant.

### Scenario D — TTL missing

Untuk key temporary, ini memory leak.

### Scenario E — Evicted key

Jika Redis memakai eviction policy, aplikasi harus tahu key mana yang boleh hilang.

Redis data modeling harus mencakup bukan hanya happy path, tetapi failure interpretation.

---

## 24. Redis as Cache vs Redis as State Store vs Redis as Index

Satu key bisa punya peran berbeda.

### Cache

```text
cache:product:sku:ABC:v1 -> String JSON
```

Properties:

- source of truth di tempat lain;
- missing key normal;
- stale data acceptable dalam batas;
- TTL penting;
- eviction acceptable.

### State store

```text
idempotency:payment:req_789 -> Hash/String state
```

Properties:

- missing key punya konsekuensi correctness;
- TTL adalah contract window;
- eviction bisa berbahaya;
- persistence mungkin relevan;
- monitoring lebih ketat.

### Index

```text
idx:tenant:42:active-users -> Set
```

Properties:

- harus sinkron dengan primary data;
- stale index bisa salah query;
- rebuild plan perlu ada;
- write amplification.

### Coordination primitive

```text
lock:batch:42 -> token
```

Properties:

- TTL wajib;
- safe release wajib;
- fencing token mungkin perlu;
- Redis failure harus dimodelkan.

Jangan mencampur peran tanpa sadar. “Sama-sama key Redis” bukan berarti risiko sama.

---

## 25. Cardinality Planning

Sebelum memakai Redis, estimasikan cardinality.

Contoh:

```text
Key pattern: session:{sessionId}
Expected active sessions: 2,000,000
Average value size: 1 KB
TTL: 30 minutes
Total payload: ~2 GB before overhead
```

Tapi Redis memory bukan hanya payload:

- key string;
- value string;
- object metadata;
- allocator overhead;
- fragmentation;
- replication buffers;
- client output buffers;
- AOF rewrite/fork copy-on-write overhead;
- index structures.

Worksheet awal:

```text
Number of keys:
Average key length:
Average value payload:
Redis type:
Average members/fields per key:
Peak write rate:
Peak read rate:
TTL:
Eviction allowed:
Replication factor:
Persistence mode:
Safety margin:
```

Redis data model tanpa cardinality estimation adalah gambling.

---

## 26. Value Size Discipline

Saran praktis:

- Simpan value kecil dan spesifik.
- Hindari JSON sangat besar.
- Hindari menyimpan HTML/page penuh kecuali memang cache layer dengan memory budget jelas.
- Hindari menyimpan binary besar seperti image/PDF/file.
- Hindari object graph Java besar.
- Hindari nested collection tak terbatas.

Redis sangat cepat ketika working set cocok di memory dan command ringan. Redis bukan object storage.

Jika value besar karena ingin mengurangi round-trip, pertimbangkan:

- batching/pipelining;
- Hash partial read;
- RedisJSON path read;
- local aggregation;
- redesign API;
- menyimpan large blob di object storage dan metadata di Redis.

---

## 27. Atomicity Granularity Berdasarkan Type

Atomicity di Redis terjadi pada command. Tipe data menentukan command atomic apa yang tersedia.

Contoh String counter:

```text
INCR quota:user:123
```

Atomic increment.

Contoh JSON blob counter:

```text
GET quota:user:123
// parse JSON
// increment
SET quota:user:123
```

Tidak atomic tanpa Lua/WATCH/RedisJSON atomic operation.

Contoh Hash counter:

```text
HINCRBY quota:user:123 apiCalls 1
```

Atomic per field.

Jadi tipe Redis bukan hanya storage shape. Ia menentukan operation correctness.

---

## 28. Mapping Java Use Case ke Redis Type

### Use case: API response cache

```text
Type: String JSON
Key: cache:api-response:<hash>:v1
TTL: short + jitter
```

### Use case: user profile cache with partial read

```text
Type: Hash
Key: identity:user:<id>:profile:v1
TTL: medium
```

### Use case: login attempt rate limiter

```text
Type: String counter or Sorted Set
Key: ratelimit:login:user:<id>:<window>
TTL: window duration
```

### Use case: idempotency key

```text
Type: String JSON or Hash
Key: idempotency:<operation>:<requestId>
TTL: business-defined window
```

### Use case: online presence

```text
Type: Set or per-user String with TTL
Key: presence:online / presence:user:<id>
```

### Use case: delay queue

```text
Type: Sorted Set
Key: delay:<queueName>
Score: execution timestamp
```

### Use case: background task processing with ack

```text
Type: Stream
Key: stream:<domain>:<eventName>
```

### Use case: unique visitor estimate

```text
Type: HyperLogLog
Key: hll:visitor:<date>
```

---

## 29. Anti-Pattern: One Giant JSON per Tenant

Contoh:

```text
tenant:42:config -> 25 MB JSON containing all rules, users, limits, flags, policies
```

Kenapa sering terjadi?

- mudah diimplementasikan;
- satu `GET` terlihat sederhana;
- cocok di development;
- menghindari desain schema.

Kenapa buruk?

- update satu field menulis ulang seluruh JSON;
- network payload besar;
- memory besar;
- parsing mahal di Java;
- invalidation kasar;
- cluster slot hotspot;
- debugging sulit;
- race condition tinggi;
- Redis latency bisa terganggu.

Alternatif:

```text
tenant:42:config:core         -> Hash/String JSON kecil
tenant:42:feature-flags       -> Hash
tenant:42:rate-limits         -> Hash
tenant:42:policy:{policyId}   -> String/Hash
tenant:42:policy-index        -> Set/Sorted Set
```

Atau gunakan database/source of truth untuk config kompleks dan Redis hanya cache subset yang dibutuhkan request path.

---

## 30. Anti-Pattern: No Prefix Cache

Contoh:

```text
12345 -> "{...}"
```

Masalah:

- entity apa?
- owner siapa?
- TTL berapa?
- tipe apa?
- versi schema apa?
- aman dihapus?
- aman dimigrasi?

Gunakan:

```text
cache:product:sku:12345:v1
```

atau:

```text
identity:user:12345:profile:v2
```

Key harus bisa dibaca oleh engineer saat incident jam 3 pagi.

---

## 31. Anti-Pattern: Redis sebagai Relational Database Manual

Contoh:

```text
user:1 -> Hash
user:2 -> Hash
idx:users:by-email -> Hash email -> userId
idx:users:by-status:ACTIVE -> Set userIds
idx:users:by-country:ID -> Set userIds
idx:users:by-created -> Sorted Set
```

Ini tidak selalu salah. Tapi jika Anda mulai membangun:

- banyak secondary index;
- complex query planner manual;
- joins manual;
- transaction semantics manual;
- rollback manual;
- referential integrity manual;
- migration manual;
- audit manual;

mungkin Anda sedang membangun database buruk di atas Redis.

Redis bisa menjadi serving index. Tetapi source of truth dan query complexity harus dipertanyakan.

---

## 32. Anti-Pattern: Key Pattern yang Tidak Bisa Di-delete Aman

Misalnya:

```text
cache:<randomHash>
```

Tanpa mapping domain, Anda sulit menjawab:

- key ini punya siapa?
- aman dihapus?
- generated oleh versi aplikasi mana?
- TTL seharusnya ada?
- mengapa masih ada setelah 90 hari?

Gunakan key yang memungkinkan lifecycle management:

```text
cache:product-detail:v3:<productId>
cache:search-result:v2:<queryHash>
cache:case-summary:v1:{caseId}
```

Tambahkan TTL untuk cache. Untuk cleanup batch, gunakan SCAN dengan pattern secara hati-hati, bukan KEYS di production.

---

## 33. Practical Data Modeling Process

Saat mendesain Redis key baru, lakukan langkah berikut.

### Step 1 — Definisikan role Redis

Pilih salah satu:

```text
cache / transient state / coordination / queue / index / metric / retrieval layer
```

### Step 2 — Definisikan source of truth

```text
Redis sendiri?
Database lain?
Event log?
External API?
Derived state?
```

### Step 3 — Definisikan access pattern

```text
read whole?
read field?
increment?
membership check?
range query?
append?
consume?
expire?
```

### Step 4 — Pilih Redis type

Jangan pilih type sebelum access pattern jelas.

### Step 5 — Desain key pattern

Termasuk prefix, entity ID, aspect, version, dan hash tag jika perlu.

### Step 6 — Tentukan TTL/eviction contract

Setiap key temporary harus punya TTL. Cache hampir selalu harus punya TTL.

### Step 7 — Tentukan failure semantics

Apa yang terjadi jika Redis down, key missing, wrong type, timeout, atau stale?

### Step 8 — Tentukan capacity estimate

Cardinality dan average size.

### Step 9 — Tentukan observability

Metrics, logs, slowlog, keyspace sampling, cardinality check.

### Step 10 — Tulis contract

Simpan dalam ADR, README service, atau schema registry internal.

---

## 34. Redis Key Design Template

Gunakan template ini untuk setiap key penting.

```markdown
## Redis Key Contract

### Name
<descriptive name>

### Owner
<team/service>

### Purpose
<why this key exists>

### Key Pattern
`<prefix>:<entity>:<id>:<aspect>:<version>`

### Redis Type
<String | Hash | List | Set | Sorted Set | Stream | Bitmap | HyperLogLog | JSON | ...>

### Example
`...`

### Value Schema
<fields / JSON schema / member format / score meaning>

### Access Pattern
- Reads:
- Writes:
- Updates:
- Deletes:

### TTL / Expiration
<ttl, refresh behavior, jitter>

### Source of Truth
<Redis / DB / event stream / derived>

### Consistency Contract
<staleness allowed, read-your-write expectation>

### Cluster Consideration
<hash tag or no multi-key requirement>

### Capacity Estimate
- expected keys:
- max keys:
- average value size:
- max value size:

### Failure Semantics
- missing key:
- wrong type:
- Redis timeout:
- Redis unavailable:
- stale value:

### Observability
- metrics:
- alerts:
- dashboards:

### Cleanup / Migration
<how to remove or migrate>
```

---

## 35. Example: Designing a Case State Cache

Context: regulatory enforcement case management platform.

Requirement:

- request path frequently needs case status;
- source of truth is PostgreSQL;
- workflow-service and case-service need fast read;
- updates occur when case transitions state;
- stale data up to 30 seconds acceptable for read UI, but not for final enforcement action;
- case ID scoped operations may need multiple Redis keys later.

### Design

```text
Key pattern:
  case:{caseId}:state:v1

Example:
  case:{987}:state:v1

Type:
  Hash

Fields:
  status       -> OPEN | UNDER_REVIEW | ESCALATED | CLOSED
  version      -> monotonic integer from DB
  riskTier     -> LOW | MEDIUM | HIGH
  assignee     -> user id or empty
  updatedAt    -> ISO-8601
  updatedBy    -> actor id

TTL:
  5 minutes + jitter

Source of truth:
  PostgreSQL case_state

Read behavior:
  HGETALL; if missing, reload from PostgreSQL and HSET + EXPIRE

Write behavior:
  after DB commit, update/delete Redis cache

Consistency:
  UI can tolerate stale <= 30s; enforcement decision must reload or validate version from DB

Cluster:
  hash tag {caseId} to co-locate future state/timeline/lock keys per case

Failure:
  Redis miss -> reload DB
  Redis timeout -> fallback DB for critical path, degrade for non-critical path
  WRONGTYPE -> log critical schema error and fallback DB
```

### Why Hash?

Because frequent reads may need only `status`, `version`, or `riskTier`. A JSON String would be acceptable for whole-object cache, but Hash makes partial access explicit.

### Why not no TTL?

Because this is derived cache. TTL gives automatic cleanup and protects against invalidation bugs.

### Why include version?

Because version allows stale cache detection and protects workflows that need monotonic state awareness.

---

## 36. Example: Designing Idempotency Key

Requirement:

- payment API must avoid duplicate processing;
- same idempotency key should return same result within 24 hours;
- in-progress request should block or return conflict;
- final result may be replayed.

### Design

```text
Key pattern:
  idempotency:payment:{idempotencyKey}:v1

Type:
  Hash

Fields:
  state           -> STARTED | COMPLETED | FAILED
  requestHash     -> hash of normalized request body
  responseCode    -> HTTP/domain response code
  responseBodyRef -> small response or reference
  createdAt       -> ISO-8601
  updatedAt       -> ISO-8601

TTL:
  24 hours

Creation:
  HSET/SET NX equivalent via Lua or SET marker first

Source of truth:
  Redis for idempotency window, payment ledger for actual financial state

Failure:
  missing key after 24h -> treated as new request
  mismatched requestHash -> idempotency conflict
  Redis unavailable -> fail closed or route to DB-backed idempotency depending risk
```

### Why not simple String?

A simple String can work for basic dedupe, but Hash allows tracking state, request hash, and replay metadata.

### Why not Redis only for payment correctness?

Because payment correctness must be anchored in durable ledger/database. Redis idempotency is a request-level guard, not the ultimate financial source of truth.

---

## 37. Example: Designing Rate Limit Counter

Requirement:

- limit login attempts per user per 5 minutes;
- block brute force;
- must expire automatically;
- approximate fixed window acceptable.

### Design

```text
Key pattern:
  ratelimit:login:user:{userId}:window:{yyyyMMddHHmmBucket}

Type:
  String integer counter

Commands:
  INCR
  EXPIRE on first increment

TTL:
  6 minutes to cover 5-minute bucket plus buffer

Failure:
  Redis unavailable -> fail closed for high-risk endpoint or fallback to degraded policy
```

### Why String counter?

Because Redis provides atomic `INCR` semantics. There is no need for Hash or JSON if the only operation is incrementing one number.

### When use Sorted Set instead?

If you need true sliding window based on individual request timestamps.

---

## 38. Example: Designing Feature Targeting

Requirement:

- check whether user is in beta program;
- add/remove users dynamically;
- membership check is frequent.

### Design

```text
Key pattern:
  feature:beta-checkout:users:v1

Type:
  Set

Commands:
  SISMEMBER feature:beta-checkout:users:v1 user-123
  SADD feature:beta-checkout:users:v1 user-123
  SREM feature:beta-checkout:users:v1 user-123

TTL:
  none, if managed explicitly

Source of truth:
  feature management database/admin service

Failure:
  Redis unavailable -> default off or local cached snapshot depending risk
```

### Why Set?

Because the core question is membership.

### Risk

If set becomes huge or accessed globally at very high QPS, it may become a hot key. Local caching or partitioning may be needed.

---

## 39. Java-Oriented Design Guidance

When integrating Redis into Java services:

### Prefer explicit codecs

Know exactly how key and value are serialized.

Bad:

```java
RedisTemplate<Object, Object>
```

Better:

```java
RedisTemplate<String, String>
```

or explicit serializers for DTOs.

### Avoid hiding Redis behind generic repository too early

A generic repository can hide important type semantics.

Bad mental model:

```java
redisRepository.save(userProfile);
```

Better mental model:

```java
caseStateCache.put(caseId, state, ttl);
idempotencyStore.markStarted(operation, key, requestHash, ttl);
rateLimiter.incrementLoginAttempt(userId, window);
```

Name Redis access by business primitive, not storage primitive.

### Do not let annotations define architecture accidentally

Spring Cache annotations are convenient, but can hide:

- key naming;
- TTL;
- serialization;
- stampede behavior;
- failure behavior;
- cache invalidation;
- observability.

Use them when the cache is simple. For correctness-sensitive Redis usage, prefer explicit components.

---

## 40. Decision Matrix

| Requirement | Natural Redis Type | Watch Out |
|---|---:|---|
| Whole-object cache | String JSON | large value, stale data, serialization |
| Field-level object | Hash | giant hash, TTL per key only |
| Counter | String | windowing, overflow, TTL |
| Counter group | Hash | field cardinality growth |
| Membership | Set | large set ops, hot key |
| Ranking | Sorted Set | score precision, memory |
| Delay queue | Sorted Set | claiming, concurrency, duplicates |
| Simple queue | List | reliability, poison jobs |
| Consumer group queue | Stream | trimming, pending entries |
| Boolean flags at scale | Bitmap | offset mapping |
| Approx unique count | HyperLogLog | approximate only |
| Nested document | JSON | memory/index cost |
| Full-text/filter query | Search | index write amplification |
| Semantic similarity | Vector capability | memory, recall, fit vs vector DB |
| Distributed lock | String with NX/PX | lease, fencing, safe unlock |
| Idempotency | String/Hash | expiry window, replay semantics |

---

## 41. Checklist: Before Creating a Redis Key

Jawab ini sebelum merge PR:

```text
[ ] Apa owner key ini?
[ ] Apa key pattern finalnya?
[ ] Apakah mengandung data sensitif?
[ ] Redis type apa yang dipakai?
[ ] Kenapa tipe itu dipilih?
[ ] Apa source of truth-nya?
[ ] Apakah key ini cache, state, index, queue, metric, atau coordination primitive?
[ ] Apakah TTL wajib?
[ ] Apa yang terjadi saat key missing?
[ ] Apa yang terjadi saat Redis unavailable?
[ ] Apakah key boleh dievict?
[ ] Berapa expected cardinality?
[ ] Berapa average dan max value size?
[ ] Apakah ada risiko big key?
[ ] Apakah ada risiko hot key?
[ ] Apakah cluster-safe?
[ ] Apakah multi-key operation diperlukan?
[ ] Apakah perlu hash tag?
[ ] Bagaimana schema versioning?
[ ] Bagaimana migration/cleanup?
[ ] Metric apa yang memantau key ini?
```

---

## 42. Lab: Inspect Redis Data Model Locally

### 42.1 Start Redis

Jika memakai Docker:

```bash
docker run --rm --name redis-lab -p 6379:6379 redis:8
```

Atau jika image Redis 8 belum tersedia di environment Anda, gunakan versi Redis terbaru yang tersedia di registry Anda.

Masuk CLI:

```bash
docker exec -it redis-lab redis-cli
```

### 42.2 Explore String

```redis
SET identity:user:123:name "Ayu"
GET identity:user:123:name
TYPE identity:user:123:name
```

Expected:

```text
string
```

### 42.3 Explore Hash

```redis
HSET identity:user:123:profile:v1 displayName "Ayu" email "ayu@example.com" status "ACTIVE"
HGET identity:user:123:profile:v1 displayName
HGETALL identity:user:123:profile:v1
TYPE identity:user:123:profile:v1
```

Expected:

```text
hash
```

### 42.4 Explore Set

```redis
SADD feature:beta:users:v1 user-123 user-456
SISMEMBER feature:beta:users:v1 user-123
SMEMBERS feature:beta:users:v1
TYPE feature:beta:users:v1
```

Expected:

```text
set
```

### 42.5 Explore Sorted Set

```redis
ZADD leaderboard:daily:v1 1500 user-123 1800 user-456
ZRANGE leaderboard:daily:v1 0 -1 WITHSCORES
ZREVRANGE leaderboard:daily:v1 0 0 WITHSCORES
TYPE leaderboard:daily:v1
```

Expected:

```text
zset
```

### 42.6 Explore TTL

```redis
SET cache:product:ABC:v1 "{\"sku\":\"ABC\",\"name\":\"Keyboard\"}" EX 60
TTL cache:product:ABC:v1
TYPE cache:product:ABC:v1
```

Wait and observe TTL decrease:

```redis
TTL cache:product:ABC:v1
```

### 42.7 Trigger WRONGTYPE Intentionally

```redis
SET demo:wrongtype "hello"
SADD demo:wrongtype "member1"
```

You should see a WRONGTYPE error.

Lesson:

> Redis key type is part of schema even if Redis does not have schema files.

### 42.8 Inspect Memory Usage

```redis
MEMORY USAGE identity:user:123:name
MEMORY USAGE identity:user:123:profile:v1
MEMORY USAGE feature:beta:users:v1
MEMORY USAGE leaderboard:daily:v1
```

Notice that memory usage is not equal to raw payload length. There is overhead.

### 42.9 Check Cluster Slot Conceptually

If your Redis supports cluster commands or you run a cluster:

```redis
CLUSTER KEYSLOT case:{987}:state:v1
CLUSTER KEYSLOT case:{987}:events:v1
CLUSTER KEYSLOT case:{988}:state:v1
```

The first two should map to the same slot because of `{987}`.

---

## 43. Mini Java Example: Explicit Key Contract

This is not a full client setup yet. Java integration will be deeper in Part 025. For now, focus on shape.

```java
package com.example.redis.keys;

import java.time.Duration;
import java.util.Objects;

public final class RedisKeys {
    private RedisKeys() {}

    public static String caseState(String caseId) {
        Objects.requireNonNull(caseId, "caseId");
        return "case:{" + caseId + "}:state:v1";
    }

    public static String productCache(String sku) {
        Objects.requireNonNull(sku, "sku");
        return "cache:product:sku:" + sanitize(sku) + ":v1";
    }

    public static String loginRateLimit(String userId, String bucket) {
        Objects.requireNonNull(userId, "userId");
        Objects.requireNonNull(bucket, "bucket");
        return "ratelimit:login:user:{" + userId + "}:window:" + bucket;
    }

    public static Duration productCacheTtl() {
        return Duration.ofMinutes(10);
    }

    public static Duration idempotencyTtl() {
        return Duration.ofHours(24);
    }

    private static String sanitize(String raw) {
        // Keep this simple for illustration.
        // Real systems should define allowed character sets explicitly.
        return raw.replace(":", "_").replace(" ", "_");
    }
}
```

Key patterns should not be scattered as string concatenations across codebase.

Bad:

```java
redis.get("user:" + id + ":profile");
redis.get("users:" + id + ":profile");
redis.get("user:" + userId + ":profiles");
```

Better:

```java
String key = RedisKeys.caseState(caseId);
```

Best for larger systems:

- key contract documented;
- key builder centralized;
- tests assert pattern;
- metrics tagged by logical key family, not raw key;
- no sensitive data in key.

---

## 44. Contract Test Example

```java
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class RedisKeysTest {

    @Test
    void caseStateUsesHashTagForCaseId() {
        assertThat(RedisKeys.caseState("987"))
            .isEqualTo("case:{987}:state:v1");
    }

    @Test
    void productCacheUsesVersionedKey() {
        assertThat(RedisKeys.productCache("ABC-001"))
            .isEqualTo("cache:product:sku:ABC-001:v1");
    }

    @Test
    void sanitizesUnsafeSkuCharacters() {
        assertThat(RedisKeys.productCache("ABC:001"))
            .isEqualTo("cache:product:sku:ABC_001:v1");
    }
}
```

This looks small, but it prevents a surprising class of production bugs.

---

## 45. Design Review Exercise

Evaluate these key designs.

### Design A

```text
user:123 -> JSON user profile, roles, sessions, preferences, permissions, recent activity
TTL: none
```

Problems:

- too broad;
- likely large value;
- unrelated lifecycles mixed;
- no version;
- no clear source of truth;
- no partial update strategy;
- roles/sessions/preferences have different access patterns.

Better:

```text
identity:user:123:profile:v1       -> Hash/String JSON
identity:user:123:roles:v1         -> Set
identity:user:123:preferences:v1   -> Hash/JSON
session:user:123:active:v1         -> Set or separate session keys with TTL
activity:user:123:recent:v1        -> List/Stream with trim
```

### Design B

```text
allActiveUsers -> Set with 50 million users
```

Potential problems:

- big key;
- hot key;
- expensive full scans;
- no tenant partition;
- no lifecycle partition;
- cluster hotspot.

Better depending use case:

```text
active-users:tenant:42
active-users:tenant:43
presence:user:<id> -> String with TTL
presence:shard:<n> -> Set
```

### Design C

```text
case:{caseId}:state:v1 -> Hash
case:{caseId}:events:v1 -> Stream
case:{caseId}:locks:v1 -> String
```

Good aspects:

- entity-scoped;
- cluster co-location;
- type-specific aspect;
- versioned.

Potential concern:

- if one case becomes extremely hot, all its state is in one slot;
- acceptable if per-case consistency matters more than slot distribution.

---

## 46. Heuristics for Top-Tier Redis Modeling

A strong Redis design usually has these properties:

1. Key names are readable and owned.
2. Redis type matches dominant operation.
3. TTL is explicit where applicable.
4. Missing key semantics are clear.
5. Value size is bounded.
6. Cardinality is estimated.
7. Big key risk is monitored.
8. Hot key risk is considered.
9. Cluster hash tags are intentional.
10. Serialization is explicit.
11. Schema versioning exists.
12. Source of truth is clear.
13. Failure behavior is documented.
14. Migration path exists.
15. Redis is not accidentally becoming a worse database.

---

## 47. Summary

Redis data modeling looks simple because Redis exposes simple primitives. But production Redis complexity hides in the relationships between:

- key name;
- value type;
- command semantics;
- TTL;
- memory;
- latency;
- cardinality;
- cluster slot;
- serialization;
- ownership;
- failure behavior.

The most important lesson:

> Choose Redis data types based on access pattern and correctness boundary, not based on whatever Java object you happen to have.

Key principles:

- Keyspace is your schema surface.
- Redis type is part of your contract.
- TTL is part of correctness.
- Internal encoding affects cost but is not an application API.
- Big keys and hot keys are design failures, not just ops problems.
- Cluster compatibility should be considered early.
- Redis key contracts should be documented like internal APIs.

---

## 48. What Comes Next

Part 003 will focus on **Strings**:

- `GET`, `SET`, `MGET`, `MSET`;
- `SET NX/XX EX/PX`;
- counters with `INCR`;
- token/cache/lock/idempotency use cases;
- serialized object trade-offs;
- large value problems;
- Java serialization warnings;
- JSON String vs Hash vs RedisJSON;
- failure modes.

---

## 49. Status Seri

```text
Part 002 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-003.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Redis Core Mental Model: Server, Keyspace, Command, Event Loop</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-003.md">Part 003 — Strings: Counter, Token, Lock Value, Cache Blob ➡️</a>
</div>
