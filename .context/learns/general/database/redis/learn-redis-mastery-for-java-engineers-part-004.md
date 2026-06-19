# learn-redis-mastery-for-java-engineers-part-004.md

# Part 004 — Hashes: Object-Like Data Tanpa Menjadi Document Database

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `004 / 034`  
> Fokus: Redis Hashes sebagai struktur object-like untuk partial field access, compact object representation, counters per entity, dan state kecil yang sering berubah.  
> Perspektif: Java backend engineer yang ingin memakai Redis secara benar, bukan sekadar hafal command.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita membahas **Redis Strings** sebagai primitive paling fundamental:

- cache blob,
- counter,
- token,
- lock value,
- serialized payload,
- dan TTL-bound state.

Sekarang kita masuk ke **Redis Hashes**.

Secara dangkal, Hash sering dijelaskan sebagai:

> Map di dalam Redis.

Penjelasan itu benar, tapi terlalu dangkal.

Mental model yang lebih berguna:

> Redis Hash adalah satu Redis key yang berisi kumpulan field-value kecil, cocok untuk merepresentasikan state entity yang perlu dibaca/diubah sebagian, tetapi tetap harus diperlakukan sebagai satu aggregate kecil, bukan sebagai tabel, bukan sebagai document database penuh, dan bukan sebagai pengganti relational model.

Hash penting karena banyak penggunaan Redis di backend Java akan jatuh ke salah satu dari dua bentuk:

1. **String blob**: satu key berisi serialized JSON/protobuf/object.
2. **Hash object**: satu key berisi banyak field yang bisa diakses sebagian.

Keputusan antara keduanya mempengaruhi:

- latency,
- bandwidth,
- memory,
- update atomicity,
- schema evolution,
- serialization boundary,
- debugging,
- dan maintainability.

---

## 1. Redis Hash Mental Model

Redis Hash adalah struktur data berbentuk:

```text
key -> {
  field1 -> value1,
  field2 -> value2,
  field3 -> value3
}
```

Contoh:

```text
user:1001 -> {
  name        -> "Alya",
  email       -> "alya@example.com",
  plan        -> "premium",
  status      -> "active",
  login_count -> "42",
  updated_at  -> "2026-06-20T10:15:00+07:00"
}
```

Perhatikan dua level:

```text
Redis key      : user:1001
Hash field     : name, email, plan, status, login_count, updated_at
Hash field val : string-like bytes
```

Hash field dan value pada dasarnya tetap binary-safe string. Redis tidak tahu bahwa `login_count` adalah integer, `updated_at` adalah timestamp, atau `status` adalah enum. Semua semantic meaning berasal dari aplikasi.

### 1.1 Hash Bukan Nested Map

Redis Hash tidak punya nested field secara native.

Ini valid:

```text
HSET user:1001 profile.name Alya
```

Tapi Redis tidak menganggap `profile.name` sebagai nested object. Itu hanya field name literal.

Jadi ini:

```text
profile.name
```

bukan struktur:

```json
{
  "profile": {
    "name": "Alya"
  }
}
```

Melainkan field biasa bernama `profile.name`.

Kalau butuh nested document dengan query/JSON path, itu domain RedisJSON/Search, bukan Hash sederhana.

---

## 2. Command Dasar Hash

### 2.1 Membuat atau Mengubah Field

```redis
HSET user:1001 name "Alya" email "alya@example.com" status "active"
```

`HSET` bisa membuat hash baru jika key belum ada, atau menambah/mengubah field jika key sudah ada.

### 2.2 Membaca Satu Field

```redis
HGET user:1001 email
```

Output:

```text
"alya@example.com"
```

### 2.3 Membaca Banyak Field

```redis
HMGET user:1001 name email status
```

Output konseptual:

```text
["Alya", "alya@example.com", "active"]
```

### 2.4 Membaca Semua Field

```redis
HGETALL user:1001
```

Output konseptual:

```text
name        Alya
email       alya@example.com
status      active
```

`HGETALL` nyaman untuk debugging, tetapi berbahaya untuk hash besar karena mengembalikan seluruh field.

### 2.5 Mengecek Field

```redis
HEXISTS user:1001 status
```

### 2.6 Menghapus Field

```redis
HDEL user:1001 status
```

Jika semua field dihapus, hash key akan hilang.

### 2.7 Menghitung Jumlah Field

```redis
HLEN user:1001
```

### 2.8 Mendapatkan Semua Nama Field

```redis
HKEYS user:1001
```

### 2.9 Mendapatkan Semua Value

```redis
HVALS user:1001
```

### 2.10 Iterasi Aman untuk Hash Besar

```redis
HSCAN user:1001 0 COUNT 100
```

`HSCAN` lebih aman daripada `HGETALL` untuk hash besar, tetapi tetap bukan alasan untuk membuat hash raksasa tanpa batas.

---

## 3. Hash vs String Blob

Ini keputusan desain yang sering muncul.

Misal kita punya object:

```json
{
  "id": "1001",
  "name": "Alya",
  "email": "alya@example.com",
  "status": "active",
  "loginCount": 42
}
```

Ada dua cara umum menyimpannya.

### 3.1 Sebagai String Blob

```redis
SET user:1001 '{"id":"1001","name":"Alya","email":"alya@example.com","status":"active","loginCount":42}'
```

Kelebihan:

- sederhana,
- cocok untuk object kecil yang selalu dibaca utuh,
- mapping Java DTO mudah,
- TTL per object mudah,
- cocok untuk cache-aside object.

Kekurangan:

- update satu field butuh read-modify-write dari sisi aplikasi,
- bandwidth lebih besar jika hanya butuh satu field,
- concurrent update field berbeda bisa saling overwrite,
- Redis tidak bisa melakukan atomic increment terhadap field di dalam JSON blob tanpa module/RedisJSON.

### 3.2 Sebagai Hash

```redis
HSET user:1001 \
  id "1001" \
  name "Alya" \
  email "alya@example.com" \
  status "active" \
  loginCount "42"
```

Kelebihan:

- bisa baca field tertentu saja,
- bisa update field tertentu saja,
- bisa increment field numerik dengan `HINCRBY`,
- lebih mudah di-debug dengan redis-cli,
- bisa lebih compact untuk object kecil tertentu,
- mengurangi risiko overwrite seluruh object ketika field berbeda diupdate oleh flow berbeda.

Kekurangan:

- DTO mapping lebih manual,
- tidak ada nested object native,
- semua field tetap string-like,
- schema evolution harus dikelola eksplisit,
- tidak ada constraint relational,
- TTL tetap di level key, bukan field,
- hash bisa tumbuh tanpa kontrol.

---

## 4. Kapan Memakai Hash

Gunakan Redis Hash ketika entity memenuhi mayoritas kondisi berikut:

1. Entity relatif kecil.
2. Field sering dibaca atau diubah sebagian.
3. Field punya lifecycle yang sama.
4. TTL berlaku untuk seluruh entity.
5. Tidak butuh query kompleks antar entity.
6. Tidak butuh transaksi relational.
7. Tidak butuh nested document yang dalam.
8. Data bersifat transient, cache, derived state, session-like, counter-like, atau coordination state.

Contoh cocok:

```text
session:{sessionId}
cart-summary:{cartId}
user-cache:{userId}
rate-state:{tenantId}:{endpoint}
workflow-runtime:{caseId}
idempotency:{key}
feature-eval:{tenantId}:{userId}
connection-state:{nodeId}:{connectionId}
```

---

## 5. Kapan Tidak Memakai Hash

Jangan memakai Redis Hash jika sebenarnya Anda butuh:

1. Tabel dengan jutaan row dalam satu key.
2. Query by arbitrary field.
3. Join.
4. Secondary index kuat.
5. Full document query.
6. Deep nested object update.
7. Long-term source of truth tanpa durability reasoning.
8. Per-field TTL.
9. Audit-grade immutable history.
10. Strong consistency lintas aggregate.

Anti-pattern klasik:

```text
users -> {
  1001 -> "{...}",
  1002 -> "{...}",
  1003 -> "{...}",
  ... jutaan user ...
}
```

Ini memakai satu Redis Hash sebagai tabel.

Masalahnya:

- satu key menjadi besar,
- operasi tertentu menjadi mahal,
- cluster distribution buruk karena satu key hanya berada di satu slot,
- migrasi/resharding tidak membagi field ke node berbeda,
- backup/restore/debugging lebih sulit,
- potensi latency spike,
- deletion/expiration tidak granular per entity.

Lebih baik:

```text
user:1001 -> hash fields
user:1002 -> hash fields
user:1003 -> hash fields
```

Satu entity, satu Redis key.

---

## 6. Hash sebagai Object-Like Aggregate

Cara berpikir yang sehat:

> Satu Redis Hash merepresentasikan satu aggregate kecil dengan ownership jelas.

Contoh:

```text
case-runtime:{caseId}
```

Fields:

```text
state              -> UNDER_REVIEW
assigned_to         -> officer-17
last_transition_at  -> 2026-06-20T09:42:00+07:00
version             -> 12
sla_due_at           -> 2026-06-25T17:00:00+07:00
risk_score          -> 81
```

Ini cukup masuk akal jika Redis dipakai sebagai **runtime acceleration layer** untuk workflow state, sementara source of truth tetap database utama.

Namun jangan membuat Redis Hash sebagai satu-satunya sumber audit enforcement lifecycle kecuali Anda sudah mendesain persistence, replication, failover, backup, replay, dan legal defensibility secara eksplisit.

Untuk regulatory/case management system, Redis Hash biasanya cocok sebagai:

- fast lookup state,
- transient assignment cache,
- SLA countdown state,
- deduplication state,
- rate/quota state,
- user/session/work queue metadata,
- derived projection.

Bukan sebagai:

- canonical case record,
- audit trail,
- immutable legal evidence,
- primary enforcement decision store.

---

## 7. Field Lifecycle dan TTL

TTL pada Redis Hash berlaku di level key.

```redis
EXPIRE user:1001 3600
```

Artinya seluruh hash `user:1001` akan expire setelah 3600 detik.

Tidak ada TTL native per field seperti:

```text
user:1001.email expires in 1 hour
user:1001.status expires in 5 minutes
```

Jika Anda butuh field dengan lifecycle berbeda, ada beberapa pilihan:

### 7.1 Pisahkan ke Key Berbeda

```text
user:1001:profile      -> hash, TTL 1 hour
user:1001:risk         -> hash/string, TTL 5 minutes
user:1001:permissions  -> set/hash, TTL 10 minutes
```

### 7.2 Simpan Expiry Metadata di Field

```text
temporary_flag -> true
flag_expires_at -> 2026-06-20T11:00:00+07:00
```

Aplikasi harus mengecek sendiri.

Kelemahan:

- data expired secara semantic masih ada,
- memory tidak otomatis hilang,
- semua read path harus disiplin memeriksa expiry.

### 7.3 Gunakan Sorted Set untuk Index Expiration

Misal field tertentu butuh cleanup:

```text
zset:temporary-field-expiry -> member = user:1001:temporary_flag, score = epochMillis
```

Lalu worker membersihkan.

Kelemahan:

- lebih kompleks,
- butuh background cleanup,
- ada race condition kalau tidak didesain benar.

### 7.4 Kesimpulan

Kalau field-field dalam satu hash punya lifecycle berbeda secara substansial, mungkin aggregate boundary Anda salah.

Rule praktis:

> Satu Redis Hash sebaiknya berisi field yang expire bersama, dimiliki flow yang sama, dan dibaca dalam konteks yang sama.

---

## 8. Partial Update Benefit

Misal kita menyimpan session state:

```text
session:abc123 -> {
  user_id      -> 1001
  tenant_id    -> tenant-9
  role         -> admin
  last_seen_at -> 2026-06-20T10:00:00+07:00
  ip           -> 203.0.113.10
  user_agent   -> Mozilla/5.0 ...
}
```

Jika setiap request hanya perlu update `last_seen_at`, dengan string blob Anda harus:

1. `GET session:abc123`
2. deserialize JSON
3. update field
4. serialize ulang
5. `SET session:abc123 ...`

Dengan Hash:

```redis
HSET session:abc123 last_seen_at "2026-06-20T10:01:00+07:00"
```

Lebih kecil:

- network payload,
- CPU serialization,
- object allocation di JVM,
- overwrite risk.

Namun partial update bukan selalu menang.

Kalau setiap read selalu butuh semua field, dan update jarang, string blob bisa lebih sederhana.

---

## 9. Atomic Field Increment

Redis Hash punya command increment field numerik:

```redis
HINCRBY user:1001 login_count 1
```

Untuk floating point:

```redis
HINCRBYFLOAT account:1001 balance_delta 12.50
```

Gunakan hati-hati untuk nilai finansial. Untuk uang, lebih aman menyimpan integer minor unit:

```text
amount_cents = 1250
```

Bukan:

```text
amount = 12.50
```

### 9.1 Counter per Entity

Contoh:

```redis
HINCRBY api-usage:tenant-9 success_count 1
HINCRBY api-usage:tenant-9 failure_count 1
HINCRBY api-usage:tenant-9 throttled_count 1
```

Hash cocok untuk banyak counter kecil yang dimiliki satu entity/context.

### 9.2 Race Condition yang Dihindari

`HINCRBY` atomic di Redis.

Dua client yang melakukan:

```redis
HINCRBY user:1001 login_count 1
```

akan menghasilkan increment yang benar karena command dieksekusi satu per satu oleh Redis.

Ini lebih aman daripada aplikasi melakukan:

1. `HGET login_count`
2. parse integer
3. tambah 1
4. `HSET login_count`

Pola read-modify-write seperti itu rentan lost update tanpa `WATCH`, Lua, atau mekanisme atomic lain.

---

## 10. Hash dan Versioning

Hash memudahkan menyimpan version field:

```redis
HSET workflow:case-777 state "UNDER_REVIEW" version "12"
```

Lalu update bisa menaikkan version:

```redis
HINCRBY workflow:case-777 version 1
HSET workflow:case-777 state "ESCALATED"
```

Namun hati-hati: dua command tersebut bukan satu atomic unit jika dijalankan terpisah.

Jika butuh atomic transition:

- gunakan Lua,
- atau `WATCH` + `MULTI/EXEC`,
- atau simpan canonical transition di database lalu Redis hanya projection.

Untuk workflow/regulatory system, version field di Redis bagus sebagai:

- optimistic cache freshness indicator,
- projection version,
- stale detection,
- diagnostic metadata.

Tapi jangan mengandalkan Redis Hash version sebagai satu-satunya concurrency control untuk keputusan legal/regulated tanpa source-of-truth yang kuat.

---

## 11. Schema Design untuk Redis Hash

Redis tidak punya schema enforcement.

Jadi schema harus dibuat sebagai kontrak aplikasi.

Contoh buruk:

```text
user:1001 -> {
  n -> Alya
  e -> alya@example.com
  s -> A
  lc -> 42
}
```

Memang hemat memory, tetapi sulit dibaca, sulit debug, sulit maintain.

Contoh lebih baik:

```text
user:1001 -> {
  name        -> Alya
  email       -> alya@example.com
  status      -> active
  login_count -> 42
  schema_ver  -> 1
  updated_at  -> 2026-06-20T10:15:00+07:00
}
```

### 11.1 Field Naming Convention

Gunakan convention yang konsisten:

```text
snake_case
```

atau:

```text
camelCase
```

Pilih satu.

Untuk Redis CLI/debugging, `snake_case` sering lebih nyaman:

```text
last_seen_at
created_at
schema_ver
lock_owner
retry_count
```

### 11.2 Sertakan Metadata Minimal

Untuk hash yang penting, pertimbangkan field:

```text
schema_ver
created_at
updated_at
source_version
source_updated_at
owner_service
```

Tidak semua hash perlu semua field. Tetapi untuk Redis yang dipakai lintas service, metadata membantu debugging dan migration.

### 11.3 Hindari Field yang Maknanya Ambigu

Buruk:

```text
status -> 1
flag -> Y
type -> A
```

Lebih baik:

```text
status -> active
is_suspended -> true
account_type -> premium
```

Redis adalah operational system. Saat incident, manusia akan membuka key. Field yang jelas mempercepat diagnosis.

---

## 12. Schema Evolution

Karena Redis Hash tidak punya schema registry, evolusi field harus dikelola dengan disiplin.

### 12.1 Additive Change

Menambah field biasanya aman:

```redis
HSET user:1001 risk_tier "medium"
```

Reader lama mengabaikan field baru.

### 12.2 Rename Field

Rename berbahaya.

Misal:

```text
status -> account_status
```

Strategi aman:

1. Writer menulis kedua field untuk sementara.
2. Reader baru membaca `account_status`, fallback ke `status`.
3. Setelah semua reader baru terdeploy, stop menulis `status`.
4. Cleanup field lama.

### 12.3 Change Value Semantics

Misal:

```text
status: "A" -> "active"
```

Ini lebih berbahaya daripada rename karena field name sama tapi makna berubah.

Gunakan salah satu:

- field baru,
- `schema_ver`,
- migration script,
- atau dual-read strategy.

### 12.4 Removing Field

Jangan langsung delete field jika masih ada reader lama.

Redis tidak mencegah runtime error di aplikasi:

```java
String status = hash.get("status");
Status parsed = Status.valueOf(status.toUpperCase());
```

Jika `status` null, aplikasi bisa error.

---

## 13. Hash vs RedisJSON

Redis Hash cocok untuk flat object.

RedisJSON cocok jika:

- butuh nested document,
- update path tertentu di JSON,
- query/index via Redis Query Engine,
- document-centric modeling,
- search/filter tertentu di Redis.

Namun RedisJSON membawa trade-off:

- complexity lebih tinggi,
- memory overhead berbeda,
- operasional lebih kompleks,
- query/index harus dirancang,
- bukan otomatis pengganti MongoDB/PostgreSQL JSONB.

Decision sederhana:

```text
Flat object kecil + partial field access -> Hash
Object selalu dibaca utuh -> String JSON blob
Nested document + path update/search -> RedisJSON/Search, dengan alasan kuat
Canonical relational record -> SQL database
Canonical document system -> document database
```

---

## 14. Hash vs Relational Row

Hash sering menggoda karena terlihat seperti row:

```text
user:1001 -> fields
```

Tapi Redis Hash tidak punya:

- primary key constraint di level relational,
- foreign key,
- secondary index native untuk arbitrary field,
- join,
- transaction isolation seperti database relational,
- SQL query optimizer,
- durable commit log dengan semantics database umum,
- migration tooling setara Flyway/Liquibase,
- audit/history model.

Jadi jangan berpikir:

```text
PostgreSQL row == Redis hash
```

Lebih tepat:

```text
Redis hash == fast, mutable, field-addressable projection/state object
```

Hash bisa menjadi projection dari relational row:

```text
PostgreSQL users table -> Redis user-cache:{userId}
```

Tetapi Redis Hash sebaiknya tidak menggantikan relational row untuk data canonical yang membutuhkan integritas jangka panjang.

---

## 15. Hash dan Cluster

Redis Cluster mendistribusikan data berdasarkan key, bukan field.

Artinya seluruh hash:

```text
user:1001
```

berada pada satu hash slot.

Field di dalamnya tidak tersebar ke beberapa node.

Implikasi:

1. Hash besar tidak otomatis terbagi.
2. Satu hot hash bisa membebani satu node.
3. Satu key terlalu besar sulit di-scale horizontally.
4. Multi-field access dalam hash aman karena satu key.
5. Multi-key operation lintas hash bisa terkena cross-slot issue.

### 15.1 Hash Tag Jika Butuh Multi-Key Colocation

Contoh:

```text
user:{1001}:profile
user:{1001}:permissions
user:{1001}:quota
```

Bagian `{1001}` menentukan slot yang sama.

Ini berguna jika beberapa key milik satu aggregate harus diproses bersama.

Tapi jangan overuse hash tag sehingga satu slot menjadi hot.

---

## 16. Memory Behavior: Kenapa Hash Bisa Efisien

Redis bisa menyimpan small hashes dengan encoding compact tertentu. Secara konseptual, hash kecil sering lebih hemat daripada banyak key individual.

Bandingkan:

### 16.1 Banyak Key Individual

```text
user:1001:name        -> Alya
user:1001:email       -> alya@example.com
user:1001:status      -> active
user:1001:login_count -> 42
```

Setiap key membawa overhead Redis key sendiri.

### 16.2 Satu Hash

```text
user:1001 -> {
  name        -> Alya
  email       -> alya@example.com
  status      -> active
  login_count -> 42
}
```

Satu Redis key, banyak field.

Untuk object kecil, hash bisa lebih compact.

Namun ini bukan izin membuat hash raksasa. Setelah melewati threshold tertentu, Redis bisa memakai struktur internal berbeda yang memiliki trade-off memory/CPU berbeda.

Pelajaran praktis:

> Hash bagus untuk mengelompokkan field kecil yang dimiliki satu entity. Hash buruk untuk menggabungkan banyak entity tak terbatas ke dalam satu key.

---

## 17. Big Hash Problem

Hash besar adalah salah satu sumber latency dan operability problem.

Contoh buruk:

```text
all-sessions -> {
  session-1 -> {...}
  session-2 -> {...}
  session-3 -> {...}
  ... millions ...
}
```

Masalah:

- `HGETALL` bisa mengembalikan payload besar,
- deletion bisa mahal,
- migration sulit,
- cluster tidak membantu karena satu key,
- per-session TTL tidak ada,
- memory ownership tidak jelas,
- monitoring cardinality sering terlambat.

Lebih baik:

```text
session:{sessionId} -> hash
```

Dengan TTL:

```redis
EXPIRE session:abc123 1800
```

### 17.1 Big Hash Detection

Gunakan pendekatan:

```redis
HLEN some:key
```

Untuk sampling manual.

Di produksi, gunakan tooling observability/key analysis, bukan scan sembarangan tanpa kontrol.

### 17.2 Red Flag Threshold

Tidak ada angka universal, tetapi secara desain:

- puluhan field: normal,
- ratusan field: masih mungkin, perlu alasan,
- ribuan field: mulai mencurigakan,
- jutaan field: hampir pasti salah model kecuali kasus khusus yang sangat sadar.

---

## 18. Access Pattern First, Struktur Data Second

Jangan mulai dari:

> Saya punya object, simpan sebagai Hash.

Mulailah dari pertanyaan:

1. Siapa owner key ini?
2. Siapa yang membaca?
3. Siapa yang menulis?
4. Apakah read selalu full object atau sebagian?
5. Apakah update sebagian sering?
6. Apakah field expire bersama?
7. Apakah field punya cardinality terbatas?
8. Apakah key akan hot?
9. Apakah key akan tumbuh tanpa batas?
10. Apakah butuh query by field?
11. Apakah Redis hanya cache/projection atau source of truth?
12. Bagaimana schema berubah?
13. Bagaimana data dibersihkan?
14. Bagaimana incident responder memahami isi key?

Jawaban inilah yang menentukan Hash, String, Set, Sorted Set, Stream, atau database lain.

---

## 19. Java Mapping Strategy

Dalam Java, Hash bisa dipetakan dengan beberapa pendekatan.

### 19.1 Manual Map Mapping

Contoh konseptual dengan Spring Data Redis `HashOperations`:

```java
Map<String, String> fields = Map.of(
    "id", user.id(),
    "name", user.name(),
    "email", user.email(),
    "status", user.status().name(),
    "schema_ver", "1",
    "updated_at", OffsetDateTime.now().toString()
);

redisTemplate.opsForHash().putAll("user:" + user.id(), fields);
redisTemplate.expire("user:" + user.id(), Duration.ofMinutes(30));
```

Kelebihan:

- eksplisit,
- mudah dikontrol,
- field naming jelas,
- cocok untuk cache/projection.

Kekurangan:

- boilerplate,
- parse/format manual,
- risk typo field name.

### 19.2 Field Constants

Gunakan constants untuk menghindari typo:

```java
public final class UserHashFields {
    public static final String ID = "id";
    public static final String NAME = "name";
    public static final String EMAIL = "email";
    public static final String STATUS = "status";
    public static final String SCHEMA_VER = "schema_ver";
    public static final String UPDATED_AT = "updated_at";

    private UserHashFields() {}
}
```

Lalu:

```java
String status = (String) redisTemplate.opsForHash()
    .get(key, UserHashFields.STATUS);
```

### 19.3 Dedicated Mapper

Lebih baik buat mapper:

```java
public final class UserCacheMapper {

    public Map<String, String> toHash(UserCacheValue value) {
        Map<String, String> map = new HashMap<>();
        map.put("id", value.id());
        map.put("name", value.name());
        map.put("email", value.email());
        map.put("status", value.status().name());
        map.put("schema_ver", "1");
        map.put("updated_at", value.updatedAt().toString());
        return map;
    }

    public UserCacheValue fromHash(Map<Object, Object> hash) {
        String schema = required(hash, "schema_ver");
        if (!"1".equals(schema)) {
            throw new IllegalStateException("Unsupported user cache schema: " + schema);
        }

        return new UserCacheValue(
            required(hash, "id"),
            required(hash, "name"),
            required(hash, "email"),
            UserStatus.valueOf(required(hash, "status")),
            OffsetDateTime.parse(required(hash, "updated_at"))
        );
    }

    private String required(Map<Object, Object> hash, String field) {
        Object value = hash.get(field);
        if (value == null) {
            throw new IllegalStateException("Missing Redis hash field: " + field);
        }
        return value.toString();
    }
}
```

Catatan:

- Ini contoh pedagogis.
- Di produksi, error handling harus disesuaikan: cache miss, schema mismatch, fallback ke database, metric, dan logging.

---

## 20. Spring Data Redis Hash Mapping Caution

Spring Data Redis menyediakan abstraction untuk mapping object ke Redis. Ini berguna, tetapi harus dipakai dengan sadar.

Risiko abstraction:

1. Key naming tersembunyi.
2. Serialization format tidak jelas.
3. TTL behavior tidak terlihat.
4. Field schema tersebar di annotation/config.
5. Debugging lebih sulit jika tim tidak paham hasil fisik di Redis.
6. Perubahan class Java bisa mempengaruhi data Redis.
7. Mudah memperlakukan Redis seperti repository database biasa.

Untuk engineer senior, aturan sehat:

> Selalu pahami bentuk fisik key dan field di Redis, walaupun memakai abstraction.

Jangan puas dengan:

```java
repository.save(user);
```

Tanyakan:

```text
Redis key apa yang dibuat?
Field apa yang disimpan?
TTL-nya apa?
Serialization-nya apa?
Berapa memory per entity?
Apa yang terjadi saat class berubah?
Bagaimana membaca data saat incident?
```

---

## 21. Serialization Strategy untuk Hash Values

Hash value biasanya string sederhana.

Contoh:

```text
status -> active
count -> 42
updated_at -> 2026-06-20T10:15:00+07:00
```

### 21.1 Simpan Primitive sebagai String Normal

Gunakan format stabil:

```text
boolean    -> true / false
integer    -> base-10 string
money      -> integer minor units, e.g. cents
instant    -> ISO-8601 or epoch millis
uuid       -> canonical UUID string
status     -> explicit enum name
```

### 21.2 Hindari Java Native Serialization

Jangan simpan Java serialized object di field hash kecuali Anda punya alasan ekstrem.

Masalah:

- tidak human-readable,
- rentan class compatibility,
- sulit debugging,
- security risk historis,
- coupling kuat ke JVM/classpath,
- menyulitkan polyglot service.

### 21.3 JSON di Dalam Field?

Boleh untuk field tertentu, tapi jangan berlebihan.

Contoh masuk akal:

```text
metadata -> {"source":"mobile","campaign":"x"}
```

Jika banyak field berisi nested JSON, mungkin Hash bukan struktur yang tepat.

---

## 22. Null, Missing Field, dan Default Value

Redis Hash membedakan:

```text
field tidak ada
```

vs

```text
field ada dengan value kosong
```

Contoh:

```redis
HSET user:1001 nickname ""
```

`nickname` ada, tapi kosong.

Sedangkan jika:

```redis
HDEL user:1001 nickname
```

field hilang.

Dalam Java, ini harus jelas.

Buruk:

```java
String nickname = (String) hash.get("nickname");
// null bisa berarti field tidak ada, cache corrupt, schema lama, atau valid unknown
```

Lebih baik:

```java
Optional<String> nickname = Optional.ofNullable((String) hash.get("nickname"));
```

Tetapi untuk field wajib, jangan silently default:

```java
String status = Optional.ofNullable((String) hash.get("status"))
    .orElse("active"); // dangerous if missing means corruption
```

Default value harus dipakai hanya jika itu bagian dari schema evolution yang sadar.

---

## 23. Hash untuk Session Store

Session adalah salah satu use case populer.

```text
session:{sessionId} -> {
  user_id       -> 1001
  tenant_id     -> tenant-9
  auth_level    -> MFA_VERIFIED
  created_at    -> 2026-06-20T09:00:00+07:00
  last_seen_at  -> 2026-06-20T10:15:00+07:00
  ip            -> 203.0.113.10
  user_agent    -> Mozilla/5.0 ...
}
```

TTL:

```redis
EXPIRE session:abc123 1800
```

Update last seen:

```redis
HSET session:abc123 last_seen_at "2026-06-20T10:16:00+07:00"
EXPIRE session:abc123 1800
```

Perhatikan: jika ingin sliding session expiration, Anda harus refresh TTL.

### 23.1 Failure Mode

Jika `HSET` berhasil tapi `EXPIRE` gagal karena network issue, session bisa kehilangan TTL.

Solusi:

- gunakan transaction/pipeline dengan awareness bahwa pipeline bukan atomic,
- gunakan Lua untuk atomic `HSET + EXPIRE`,
- atau set TTL pada creation dan refresh TTL dengan path yang jelas,
- monitor keys without TTL jika seharusnya semua session punya TTL.

Contoh Lua konseptual:

```lua
redis.call('HSET', KEYS[1], 'last_seen_at', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
```

---

## 24. Hash untuk Idempotency State

Contoh:

```text
idempotency:{tenantId}:{idempotencyKey} -> {
  state              -> PROCESSING
  request_hash       -> sha256:...
  response_status    ->
  response_body_key   ->
  created_at         -> 2026-06-20T10:00:00+07:00
  updated_at         -> 2026-06-20T10:00:00+07:00
}
```

TTL:

```redis
EXPIRE idempotency:tenant-9:abc 86400
```

Kenapa Hash cocok?

- state berubah dari `PROCESSING` ke `COMPLETED`,
- bisa update `response_status` tanpa rewrite semua,
- bisa menyimpan metadata diagnostik,
- field kecil dan lifecycle sama.

Tapi initial creation harus atomic:

```redis
SET idempotency-lock:tenant-9:abc token NX EX 86400
```

atau Lua yang membuat hash hanya jika belum ada.

Kalau hanya:

```redis
HSET idempotency:tenant-9:abc state PROCESSING
```

dua request concurrent bisa sama-sama merasa berhasil.

Hash bagus untuk state representation, tapi creation race tetap harus didesain.

---

## 25. Hash untuk Rate Limiter State

Contoh fixed window per tenant-endpoint:

```text
rate:{tenantId}:{endpoint}:{window} -> {
  allowed_count  -> 124
  rejected_count -> 9
  first_seen_at  -> 2026-06-20T10:00:00+07:00
}
```

Increment:

```redis
HINCRBY rate:tenant-9:/payment:202606201000 allowed_count 1
EXPIRE rate:tenant-9:/payment:202606201000 120
```

Lagi-lagi, `HINCRBY + EXPIRE` perlu diperhatikan. Jika key baru dibuat tanpa TTL akibat failure, counter bisa bocor.

Lua sering lebih tepat untuk limiter production.

Part khusus rate limiting akan membahas ini lebih dalam.

---

## 26. Hash untuk Workflow Runtime Projection

Untuk case management atau enforcement lifecycle:

```text
case-runtime:{caseId} -> {
  state                 -> AWAITING_EVIDENCE
  assigned_team          -> enforcement-review
  assigned_user          -> user-127
  priority              -> HIGH
  sla_due_at             -> 2026-06-25T17:00:00+07:00
  last_transition        -> REQUEST_EVIDENCE
  last_transition_at     -> 2026-06-20T10:12:00+07:00
  source_version         -> 48
  projection_updated_at  -> 2026-06-20T10:12:01+07:00
}
```

Ini sangat berguna untuk:

- dashboard cepat,
- routing decision sementara,
- SLA check acceleration,
- worker assignment lookup,
- reducing database load.

Tetapi source of truth tetap harus jelas.

Kalau Redis hilang, sistem harus bisa rebuild projection dari database/event log.

Pertanyaan desain wajib:

```text
Bisakah hash ini direkonstruksi?
Dari mana?
Berapa lama?
Apa dampak jika stale?
Apa dampak jika hilang?
Apa dampak jika field missing?
```

---

## 27. Atomicity: Satu Command vs Multi-Command

Redis command tunggal atomic.

Contoh atomic:

```redis
HSET user:1001 status active updated_at "2026-06-20T10:20:00+07:00"
```

Ini satu command, update beberapa field dalam satu hash secara atomic.

Contoh tidak atomic:

```redis
HSET user:1001 status active
HSET user:1001 updated_at "2026-06-20T10:20:00+07:00"
```

Di antara dua command itu, client lain bisa membaca state intermediate.

### 27.1 Gunakan Multi-Field HSET

Lebih baik:

```redis
HSET user:1001 \
  status active \
  updated_at "2026-06-20T10:20:00+07:00" \
  source_version 49
```

### 27.2 Jika Ada Logic Conditional

Misal hanya update jika current version = 48.

Tidak bisa aman hanya dengan:

```redis
HGET user:1001 source_version
HSET user:1001 source_version 49 status active
```

Gunakan:

- Lua,
- `WATCH` + transaction,
- atau push concurrency control ke database source of truth.

---

## 28. HGETALL Problem di Java Services

`HGETALL` sering terlihat praktis:

```java
Map<Object, Object> hash = redisTemplate.opsForHash().entries(key);
```

Masalahnya:

- jika hash tumbuh, response membesar,
- service tidak sadar field bertambah,
- latency naik perlahan,
- memory allocation di JVM naik,
- GC pressure naik,
- tail latency memburuk.

Gunakan `HMGET` jika hanya butuh field tertentu:

```redis
HMGET user:1001 status plan risk_tier
```

Di Java, buat method yang eksplisit:

```java
UserAccessSnapshot readAccessSnapshot(String userId)
```

bukan:

```java
Map<Object, Object> readEverything(String userId)
```

Access pattern harus terlihat dari API internal Anda.

---

## 29. Pipelining Hash Operations

Misal Anda butuh membaca hash untuk banyak user:

```text
user:1001
user:1002
user:1003
...
```

Jangan lakukan sequential network round trip:

```java
for (String id : ids) {
    redisTemplate.opsForHash().multiGet("user:" + id, fields);
}
```

Ini bisa menjadi N round trip.

Gunakan pipelining/batching dengan hati-hati.

Namun ingat:

- pipeline mengurangi round trip,
- pipeline bukan atomic transaction,
- pipeline response besar bisa membebani memory client,
- pipeline terlalu besar bisa menambah latency spike.

Rule praktis:

```text
Batch cukup besar untuk mengurangi RTT, cukup kecil untuk menjaga tail latency dan memory.
```

Part latency engineering akan membahas detail.

---

## 30. Hash dan Field-Level Authorization

Redis tidak memberi ACL per field hash.

Jika satu service punya akses ke key, secara praktis ia bisa membaca field dalam hash.

Jangan campur field dengan sensitivity berbeda jika service boundary berbeda.

Contoh buruk:

```text
user:1001 -> {
  display_name      -> Alya
  account_status    -> active
  password_hash     -> ...
  kyc_risk_score    -> high
  internal_note     -> suspicious activity
}
```

Lebih baik pisahkan:

```text
user-public-cache:1001
user-auth-sensitive:1001
user-risk-internal:1001
```

Dengan Redis ACL/key pattern/network boundary yang sesuai.

Field grouping adalah security decision, bukan hanya modeling decision.

---

## 31. Hash dan Observability

Untuk setiap Redis Hash penting, observability minimal harus menjawab:

1. Berapa jumlah key pattern ini?
2. Berapa rata-rata field per key?
3. Berapa p95/p99 field per key?
4. Apakah semua key punya TTL jika seharusnya transient?
5. Apakah ada big hash?
6. Apakah ada hot hash?
7. Command apa yang paling sering?
8. Apakah `HGETALL` dipakai di path panas?
9. Berapa miss rate?
10. Berapa stale/corrupt/schema mismatch count?

Dari aplikasi Java, emit metric seperti:

```text
redis.user_cache.hit
redis.user_cache.miss
redis.user_cache.schema_mismatch
redis.user_cache.field_missing
redis.user_cache.read_latency
redis.user_cache.write_latency
redis.user_cache.payload_fields
```

Jangan hanya mengandalkan Redis server metrics. Banyak bug Hash muncul di semantic layer aplikasi.

---

## 32. Operational Debugging dengan Hash

Redis Hash lebih mudah di-debug daripada opaque blob.

Contoh:

```redis
HGETALL case-runtime:case-777
```

Hasil:

```text
state                 AWAITING_EVIDENCE
assigned_team          enforcement-review
assigned_user          user-127
priority              HIGH
sla_due_at             2026-06-25T17:00:00+07:00
last_transition        REQUEST_EVIDENCE
last_transition_at     2026-06-20T10:12:00+07:00
source_version         48
projection_updated_at  2026-06-20T10:12:01+07:00
```

Ini sangat membantu saat incident.

Tapi jangan jadikan debugging convenience sebagai satu-satunya alasan memakai Hash. Tetap evaluasi access pattern dan lifecycle.

---

## 33. Design Example: User Access Snapshot

### 33.1 Requirement

Sebuah Java service perlu mengecek akses user pada setiap request.

Data yang dibutuhkan:

- user id,
- tenant id,
- account status,
- subscription plan,
- risk tier,
- permission version,
- last policy evaluation timestamp.

Source of truth ada di PostgreSQL dan policy service. Redis dipakai sebagai acceleration layer.

### 33.2 Key Design

```text
user-access:{tenantId}:{userId}
```

Contoh:

```text
user-access:tenant-9:user-1001
```

### 33.3 Field Design

```text
user_id             -> user-1001
tenant_id           -> tenant-9
account_status      -> active
plan                -> premium
risk_tier           -> medium
permission_version  -> 42
policy_evaluated_at -> 2026-06-20T10:15:00+07:00
schema_ver          -> 1
```

### 33.4 TTL

```text
TTL = 5 minutes + jitter
```

Kenapa tidak terlalu lama?

- access decision tidak boleh terlalu stale,
- risk tier/permission bisa berubah,
- cache harus cepat self-heal.

Kenapa tidak terlalu pendek?

- hit rate turun,
- source system terbebani,
- stampede risk naik.

### 33.5 Read Path

```text
1. HMGET required fields.
2. Jika semua field valid dan schema_ver supported, gunakan snapshot.
3. Jika missing/stale/schema mismatch, fallback ke source.
4. Rebuild Redis hash.
5. Set TTL dengan jitter.
```

### 33.6 Write/Invalidation Path

Saat permission berubah:

```text
DEL user-access:{tenantId}:{userId}
```

Atau update projection:

```redis
HSET user-access:tenant-9:user-1001 permission_version 43 policy_evaluated_at "..."
EXPIRE user-access:tenant-9:user-1001 300
```

Pilih invalidation atau update berdasarkan consistency requirement.

### 33.7 Failure Behavior

Jika Redis down:

- service fallback ke source,
- latency naik,
- metric alert,
- jangan hard fail kecuali access policy memang membutuhkan Redis as enforcement dependency.

Jika Redis stale:

- TTL membatasi durasi staleness,
- invalidation event mempercepat correction,
- permission_version bisa dipakai untuk stale detection.

---

## 34. Design Example: Case Runtime Projection

### 34.1 Requirement

Case management platform butuh dashboard yang sering membaca runtime state case.

Canonical data ada di database.

Redis dipakai untuk mempercepat:

- current state lookup,
- assigned officer lookup,
- SLA display,
- escalation hint.

### 34.2 Key

```text
case-runtime:{caseId}
```

### 34.3 Fields

```text
case_id                -> CASE-2026-0001
state                  -> UNDER_REVIEW
assigned_team           -> team-enforcement-a
assigned_user           -> officer-17
priority               -> HIGH
sla_due_at              -> 2026-06-25T17:00:00+07:00
last_transition         -> SUBMIT_FOR_REVIEW
last_transition_at      -> 2026-06-20T09:15:00+07:00
source_version          -> 91
projection_updated_at   -> 2026-06-20T09:15:02+07:00
schema_ver              -> 1
```

### 34.4 Why Hash

Hash cocok karena:

- dashboard sering butuh subset field,
- assignment bisa berubah,
- SLA bisa dihitung dari field tertentu,
- data flat,
- projection bisa direbuild,
- field debug-friendly.

### 34.5 What Not to Store

Jangan simpan audit trail lengkap di hash:

```text
transition_1 -> ...
transition_2 -> ...
transition_3 -> ...
```

Itu akan menjadi unbounded growth.

Audit trail harus ada di database/event log yang sesuai.

---

## 35. Common Anti-Patterns

### 35.1 Hash sebagai Tabel

Buruk:

```text
users -> userId -> json
```

Lebih baik:

```text
user:{userId} -> hash
```

### 35.2 Hash Tanpa TTL untuk Data Transient

Buruk:

```text
session:{id} -> hash tanpa TTL
```

Akibat:

- memory leak,
- stale session,
- operational cleanup manual.

### 35.3 HGETALL di Hot Path

Buruk:

```text
HGETALL large-hash
```

pada request path dengan traffic tinggi.

Gunakan `HMGET` field yang dibutuhkan.

### 35.4 Field Berubah Tanpa Versioning

Buruk:

```text
status: A
```

lalu diam-diam berubah menjadi:

```text
status: active
```

Reader lama bisa rusak.

### 35.5 Campur Banyak Ownership

Buruk:

```text
user:1001 -> profile fields + auth fields + risk fields + billing fields
```

Jika owner berbeda, lifecycle berbeda, sensitivity berbeda, pisahkan.

### 35.6 Giant Metadata Field

Buruk:

```text
metadata -> giant JSON 2MB
```

Kalau ada field besar, pertimbangkan String blob terpisah, object storage, database, atau model lain.

### 35.7 Menganggap HSET + EXPIRE Selalu Aman

Dua command bisa partially succeed dari perspektif client/network.

Gunakan Lua jika TTL wajib bersamaan dengan mutation.

---

## 36. Decision Matrix: Hash atau Bukan?

| Pertanyaan | Jika Ya | Jika Tidak |
|---|---:|---:|
| Object flat? | Hash cocok | Pertimbangkan JSON/String/database |
| Butuh partial read? | Hash kuat | String blob mungkin cukup |
| Butuh partial update? | Hash kuat | String blob mungkin cukup |
| Field expire bersama? | Hash cocok | Pisah key/model |
| Field count bounded? | Hash cocok | Hindari hash raksasa |
| Butuh query by field? | Redis Hash saja tidak cukup | Search/DB/index khusus |
| Butuh audit durable? | Jangan Redis Hash sebagai primary | Gunakan DB/event log |
| Butuh per-field TTL? | Hash kurang cocok | Pisah key atau cleanup design |
| Butuh nested document? | Hash kurang cocok | RedisJSON/document DB |
| Butuh atomic multi-field same key update? | HSET multi-field cocok | Cross-key butuh desain lain |

---

## 37. Practical Java Checklist

Sebelum memakai Redis Hash di Java service, jawab checklist ini.

### 37.1 Key Design

- Apa key pattern?
- Apakah key punya tenant/context prefix?
- Apakah key aman untuk Redis Cluster?
- Apakah cardinality key terkontrol?

### 37.2 Field Design

- Apa daftar field?
- Field mana wajib?
- Field mana optional?
- Apa format setiap field?
- Apakah ada `schema_ver`?
- Apakah ada `updated_at`?

### 37.3 Lifecycle

- Apakah key punya TTL?
- Siapa yang set TTL?
- Apakah TTL di-refresh?
- Bagaimana mencegah key tanpa TTL?

### 37.4 Consistency

- Apakah Redis source of truth atau projection?
- Bagaimana invalidation?
- Bagaimana stale detection?
- Apa fallback saat missing/corrupt?

### 37.5 Concurrency

- Apakah ada concurrent writer?
- Apakah multi-field update harus atomic?
- Apakah perlu Lua/WATCH?
- Apakah increment memakai `HINCRBY`?

### 37.6 Serialization

- Apakah semua field string format stabil?
- Apakah enum safe terhadap rename?
- Apakah timestamp format konsisten?
- Apakah Java native serialization dihindari?

### 37.7 Observability

- Apakah hit/miss diukur?
- Apakah schema mismatch diukur?
- Apakah field missing diukur?
- Apakah latency Redis command diukur?
- Apakah big hash terdeteksi?

---

## 38. Latihan Praktik

### Latihan 1 — User Cache Hash

Buat key:

```text
user-cache:{userId}
```

Fields:

```text
id
name
email
status
schema_ver
updated_at
```

Tugas:

1. Tulis command `HSET` untuk membuat hash.
2. Tulis command `HMGET` untuk membaca `status` dan `email`.
3. Tulis command untuk update `status` dan `updated_at` dalam satu command.
4. Set TTL 10 menit.
5. Jelaskan apa yang terjadi jika TTL lupa diset.

### Latihan 2 — Counter per Tenant

Buat key:

```text
api-counter:{tenantId}:{yyyyMMddHHmm}
```

Fields:

```text
allowed
rejected
error
```

Tugas:

1. Increment `allowed`.
2. Increment `rejected`.
3. Set TTL 2 jam.
4. Jelaskan race/failure jika `HINCRBY` berhasil tapi `EXPIRE` gagal.
5. Usulkan Lua sederhana untuk menggabungkan increment + expire.

### Latihan 3 — Schema Evolution

Schema lama:

```text
status -> A / S
```

Schema baru:

```text
account_status -> active / suspended
```

Tugas:

1. Rancang strategi deploy bertahap.
2. Jelaskan bagaimana reader baru membaca data lama.
3. Jelaskan kapan field lama boleh dihapus.
4. Tambahkan `schema_ver` strategy.

### Latihan 4 — Detect Bad Hash Model

Diberikan desain:

```text
all-user-profiles -> {
  user-1 -> {...}
  user-2 -> {...}
  user-3 -> {...}
  ...
}
```

Tugas:

1. Jelaskan minimal 5 masalah desain.
2. Redesign dengan satu key per user.
3. Tambahkan TTL policy.
4. Jelaskan dampak Redis Cluster.

---

## 39. Mini Lab dengan redis-cli

Jalankan Redis lokal, lalu:

```redis
HSET user:1001 id 1001 name Alya email alya@example.com status active login_count 0 schema_ver 1
HGET user:1001 email
HMGET user:1001 name status login_count
HINCRBY user:1001 login_count 1
HGET user:1001 login_count
HSET user:1001 status suspended updated_at "2026-06-20T10:30:00+07:00"
HGETALL user:1001
EXPIRE user:1001 600
TTL user:1001
```

Eksperimen:

```redis
HDEL user:1001 email
HGET user:1001 email
HEXISTS user:1001 email
HLEN user:1001
```

Pertanyaan:

1. Apa beda field missing dan empty string?
2. Apa output `TTL` setelah `EXPIRE`?
3. Apakah `HSET` field baru menghapus TTL?
4. Bagaimana Anda membuktikan TTL tetap ada?

---

## 40. Mental Model Ringkas

Redis Hash bukan sekadar map.

Redis Hash adalah:

```text
Satu Redis key berisi field-value kecil yang dimiliki satu aggregate, cocok untuk partial access dan partial update, dengan TTL di level key, atomic command di level Redis command, dan tanpa schema enforcement native.
```

Gunakan Hash untuk:

- object flat kecil,
- session state,
- user access snapshot,
- idempotency metadata,
- per-entity counters,
- workflow runtime projection,
- cache/projection yang perlu partial update.

Hindari Hash untuk:

- tabel besar,
- unbounded collection,
- audit trail,
- nested document kompleks,
- query by arbitrary field,
- data dengan lifecycle field berbeda,
- source of truth yang butuh durability/integrity kuat.

Senior Redis usage bukan soal tahu `HSET` dan `HGET`.

Senior Redis usage adalah tahu:

```text
aggregate boundary,
field lifecycle,
TTL contract,
serialization format,
concurrency model,
cluster implication,
memory growth,
operational debugging,
and failure behavior.
```

---

## 41. Ringkasan Part 004

Kita sudah membahas:

1. Redis Hash sebagai object-like aggregate.
2. Command dasar Hash.
3. Hash vs String blob.
4. Hash vs RedisJSON.
5. Hash vs relational row.
6. TTL level key, bukan field.
7. Partial update dan atomic field increment.
8. Schema design dan schema evolution.
9. Java mapping strategy.
10. Spring Data Redis caution.
11. Serialization boundary.
12. Null/missing field handling.
13. Use case session, idempotency, rate limiter, workflow projection.
14. Atomicity dan multi-command risk.
15. Big hash anti-pattern.
16. Redis Cluster implication.
17. Observability dan debugging.
18. Decision matrix dan checklist.

---

## 42. Status Seri

```text
Part 004 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-005.md
```

Part berikutnya akan membahas:

```text
Part 005 — Lists: Queue Primitive, Log Kecil, dan Blocking Pop
```

Di sana kita akan membedah Redis Lists bukan sekadar `LPUSH/RPOP`, tetapi sebagai queue primitive dengan konsekuensi reliability, blocking consumer, backpressure, poison message, dan kenapa Lists bukan pengganti Kafka/RabbitMQ walaupun bisa dipakai untuk queue sederhana.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Strings: Counter, Token, Lock Value, Cache Blob</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-005.md">Part 005 — Redis Lists: Queue Primitive, Log Kecil, dan Blocking Pop ➡️</a>
</div>
