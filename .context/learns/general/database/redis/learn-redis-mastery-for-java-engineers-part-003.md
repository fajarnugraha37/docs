# learn-redis-mastery-for-java-engineers-part-003.md

# Part 003 — Strings: Counter, Token, Lock Value, Cache Blob

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `003 / 034`  
> Status: **belum bagian terakhir**  
> Fokus: Redis String sebagai primitive paling fundamental untuk cache value, counter, token, marker, lock value, TTL-bound state, dan binary-safe payload.

---

## 0. Posisi Bagian Ini dalam Seri

Di Part 000 kita membangun orientasi: Redis bukan sekadar cache, melainkan **in-memory data structure server** yang sering dipakai sebagai latency-critical component dalam sistem backend.

Di Part 001 kita membahas core execution model: command Redis dieksekusi di server, command individual bersifat atomic, dan network round trip sering menjadi bottleneck nyata.

Di Part 002 kita membahas Redis data model: keyspace, value type, internal encoding, ownership key, naming convention, dan konsekuensi memory/latency.

Bagian ini masuk ke Redis data type pertama dan paling dasar: **String**.

Redis String terlihat sederhana, tetapi justru karena terlalu sederhana, banyak sistem produksi rusak karena engineer memperlakukannya seperti:

- remote `String` biasa,
- remote Java object,
- cache blob tanpa lifecycle,
- lock tanpa fencing,
- counter tanpa boundary,
- token store tanpa expiry discipline,
- atau serialized object store tanpa schema/versioning.

Target bagian ini bukan hanya bisa memakai `GET` dan `SET`, tetapi mampu mengambil keputusan:

> “Apakah data ini sebaiknya disimpan sebagai Redis String, Hash, JSON, Sorted Set, SQL row, Kafka event, atau tidak seharusnya masuk Redis sama sekali?”

---

## 1. Apa Itu Redis String?

Redis String adalah **binary-safe sequence of bytes** yang diasosiasikan dengan sebuah key.

Secara konseptual:

```text
key -> bytes
```

Contoh:

```text
user:123:profile-cache -> "{...json...}"
rate:tenant:acme:api:/payments:2026-06-20T10:41 -> "17"
session:9f84c... -> "userId=123;roles=admin"
lock:invoice:INV-90001 -> "owner-instance-7:uuid-abc"
feature:tenant:acme:new-risk-engine:enabled -> "true"
```

Redis dokumentasi menyebut String sebagai data type paling dasar, dan banyak command lain seperti counter berbasis `INCR` bekerja di atas value String yang direpresentasikan sebagai integer. Redis `SET` membuat atau mengganti string value suatu key, sementara `INCR` menaikkan nilai integer di key tersebut dan menganggap missing key sebagai `0` sebelum increment. Referensi resmi: Redis Strings, `SET`, dan `INCR` docs.

Catatan penting:

Redis String bukan berarti hanya teks UTF-8.

Redis String dapat berisi:

- plain text,
- JSON,
- integer string,
- binary payload,
- compressed bytes,
- protobuf bytes,
- UUID,
- token,
- flags,
- small serialized object.

Karena binary-safe, client Java bisa menyimpan `byte[]`. Tetapi kemampuan menyimpan bytes bukan berarti semua object Java layak dijadikan blob di Redis.

---

## 2. Mental Model: String adalah “Single Opaque Value”

String adalah value tunggal yang dilihat Redis sebagai satu unit.

```text
Redis tidak memahami struktur internal value String.

Redis hanya tahu:
- key ada atau tidak,
- value adalah bytes,
- mungkin bisa diinterpretasikan sebagai integer untuk command numeric,
- punya TTL atau tidak,
- dapat di-overwrite secara keseluruhan.
```

Jika Anda menyimpan JSON sebagai Redis String:

```json
{
  "userId": "123",
  "name": "Ayu",
  "tier": "GOLD",
  "riskScore": 71
}
```

Redis tidak memahami `tier` atau `riskScore`.

Konsekuensinya:

- update field kecil membutuhkan read-modify-write seluruh blob,
- partial field query tidak bisa dilakukan dengan String command,
- concurrent update rentan lost update jika tidak pakai CAS/Lua/transaction,
- schema evolution sepenuhnya tanggung jawab aplikasi,
- memory value dihitung sebagai satu payload besar.

Maka keputusan dasar:

```text
Gunakan String ketika value diperlakukan sebagai satu unit atomik oleh aplikasi.
Jangan gunakan String ketika aplikasi butuh operasi granular per field atau per element.
```

---

## 3. Operasi Dasar: GET, SET, MGET, MSET

### 3.1 `SET`

Command paling dasar:

```redis
SET app:user:123:name "Ayu"
```

Secara default, `SET`:

- membuat key jika belum ada,
- mengganti value jika sudah ada,
- mengabaikan type lama dan mengganti dengan String,
- dapat menghapus TTL lama kecuali memakai opsi tertentu seperti `KEEPTTL`.

Bentuk paling penting:

```redis
SET key value
SET key value EX 60
SET key value PX 5000
SET key value NX EX 60
SET key value XX KEEPTTL
```

Redis `SET` modern mendukung opsi seperti:

- `NX`: set hanya jika key belum ada,
- `XX`: set hanya jika key sudah ada,
- `EX`: expiry dalam detik,
- `PX`: expiry dalam milidetik,
- `EXAT` / `PXAT`: absolute expiration timestamp,
- `KEEPTTL`: mempertahankan TTL lama,
- `GET`: mengembalikan old value saat set,
- dan pada versi baru Redis ada conditional options tambahan seperti `IFEQ` / `IFNE` di dokumentasi command `SET`.

Untuk engineer Java, bentuk yang paling sering penting:

```redis
SET cache:user:123 "..." EX 300
SET idempotency:payment:abc "STARTED" NX EX 86400
SET lock:invoice:9001 "uuid-owner-token" NX PX 30000
SET feature:tenant:acme:risk "enabled" XX KEEPTTL
```

### 3.2 `GET`

```redis
GET app:user:123:name
```

Kemungkinan hasil:

```text
"Ayu"  -> key ada
nil    -> key tidak ada
error  -> key ada tapi type bukan String-compatible untuk GET
```

Dalam aplikasi Java, `nil` harus dibedakan dari:

- value kosong `""`,
- JSON `null`,
- string literal `"null"`,
- cache miss,
- error koneksi,
- timeout,
- deserialization failure.

Kesalahan umum:

```java
String value = redis.get(key);
if (value == null) {
    // assume data does not exist in database
}
```

Padahal `null` dari Redis client bisa berarti cache miss, bukan source-of-truth miss. Di cache-aside, cache miss harus memicu load dari sumber utama, bukan langsung dianggap data tidak ada.

### 3.3 `MGET`

```redis
MGET cache:user:1 cache:user:2 cache:user:3
```

`MGET` mengurangi round trip dibanding banyak `GET` individual.

Buruk:

```text
GET key1
GET key2
GET key3
...
GET key1000
```

Lebih baik:

```text
MGET key1 key2 key3 ... key1000
```

Tetapi `MGET` bukan selalu gratis:

- response bisa besar,
- server harus mengumpulkan banyak value,
- client harus deserialize banyak payload,
- di Redis Cluster, multi-key command harus memperhatikan slot; key berbeda slot bisa bermasalah tergantung client dan command routing,
- batch terlalu besar bisa menaikkan tail latency.

Prinsip praktis:

```text
Gunakan MGET untuk mengurangi round trip.
Batasi ukuran batch.
Ukur latency p95/p99, bukan hanya throughput rata-rata.
```

### 3.4 `MSET`

```redis
MSET cache:user:1 "..." cache:user:2 "..." cache:user:3 "..."
```

`MSET` berguna untuk batch write beberapa String.

Namun perhatikan:

- `MSET` tidak memberi TTL per key,
- jika perlu TTL, biasanya pakai pipeline beberapa `SET key value EX ttl`,
- di cluster, multi-key constraint tetap harus diperhatikan.

Untuk cache, sering lebih benar:

```text
pipeline:
  SET cache:user:1 value EX 300
  SET cache:user:2 value EX 300
  SET cache:user:3 value EX 300
```

daripada:

```text
MSET cache:user:1 value cache:user:2 value cache:user:3 value
EXPIRE cache:user:1 300
EXPIRE cache:user:2 300
EXPIRE cache:user:3 300
```

Karena `SET EX` membuat value dan TTL dalam satu command atomic per key.

---

## 4. `SET` dengan TTL: Hindari Dua Command Jika Bisa Satu

Anti-pattern klasik:

```redis
SET session:abc "user-123"
EXPIRE session:abc 1800
```

Mengapa ini berbahaya?

Karena ada failure window:

```text
1. SET berhasil.
2. Aplikasi crash sebelum EXPIRE.
3. Key session hidup tanpa TTL.
4. Memory leak logic terjadi.
```

Pola yang benar:

```redis
SET session:abc "user-123" EX 1800
```

Atau untuk millisecond precision:

```redis
SET lock:invoice:9001 "owner-token" PX 30000 NX
```

Rule:

```text
Jika value harus punya TTL sejak lahir, buat value dan TTL dalam command yang sama.
```

Ini berlaku untuk:

- session,
- token,
- cache entry,
- idempotency key,
- lock lease,
- temporary workflow marker,
- rate limit bucket,
- OTP,
- password reset token,
- verification code,
- ephemeral feature gate override.

---

## 5. `NX`, `XX`, `EX`, `PX`, `KEEPTTL`: Semantik yang Harus Diinternalisasi

### 5.1 `NX`: Create If Absent

```redis
SET idempotency:payment:REQ-123 "STARTED" NX EX 86400
```

Makna:

```text
Buat key hanya jika belum ada.
Jika sudah ada, jangan overwrite.
```

Use case:

- idempotency key,
- first-writer-wins marker,
- simple lease lock,
- duplicate request suppression,
- one-time token claim,
- registration uniqueness guard sementara.

Tetapi `NX` bukan transaksi lintas sistem.

Contoh:

```text
SET idempotency:abc STARTED NX EX 86400 berhasil.
Lalu aplikasi menulis database tetapi crash sebelum update Redis jadi COMPLETED.
Request retry melihat STARTED.
Apa yang harus terjadi?
```

Tanpa state machine idempotency yang jelas, `NX` hanya menunda masalah.

### 5.2 `XX`: Update If Present

```redis
SET cache:user:123 "new-value" XX EX 300
```

Makna:

```text
Update hanya jika key sudah ada.
Jika key tidak ada, jangan buat baru.
```

Use case:

- refresh cache hanya jika masih ada,
- avoid cache resurrection,
- update ephemeral marker,
- preserve ownership invariant.

### 5.3 `EX` dan `PX`

```redis
SET otp:user:123 "918274" EX 300
SET lock:job:abc "token" PX 10000
```

Gunakan `EX` untuk TTL second-level.
Gunakan `PX` untuk lease/lock yang butuh millisecond-level.

Tetapi jangan over-engineer precision.

Untuk cache user profile, `EX 300` cukup.
Untuk lock lease yang sensitif, `PX 30000` mungkin relevan.

### 5.4 `KEEPTTL`

Default `SET` dapat menghapus TTL existing.

Contoh problem:

```redis
SET session:abc "user-123" EX 1800
# 5 menit kemudian
SET session:abc "updated-user-state"
```

Jika tidak memakai expiry lagi atau `KEEPTTL`, session bisa berubah dari volatile key menjadi persistent key.

Lebih aman:

```redis
SET session:abc "updated-user-state" KEEPTTL
```

Atau:

```redis
SET session:abc "updated-user-state" EX 1800
```

Pilih berdasarkan kontrak:

```text
Sliding session? Reset TTL saat update.
Fixed session? Keep TTL.
```

---

## 6. String sebagai Counter

Redis String bisa berperan sebagai numeric counter ketika value adalah integer string.

```redis
INCR page:view:home
INCRBY page:view:home 10
DECR inventory:sku:ABC
DECRBY inventory:sku:ABC 3
```

`INCR` bersifat atomic per command.

Jika key belum ada:

```redis
INCR counter:x
```

Redis memperlakukan value awal sebagai `0`, lalu menghasilkan `1`.

### 6.1 Counter Dasar

Use case:

```text
page views
API request count
login attempts
retry count
sequence number
temporary quota usage
```

Contoh:

```redis
INCR metrics:api:/payments:2026-06-20T10:41
EXPIRE metrics:api:/payments:2026-06-20T10:41 3600
```

Namun lagi-lagi ada failure window jika `INCR` dan `EXPIRE` dipisah.

Untuk counter yang dibuat pertama kali dan perlu TTL, ada beberapa pola:

#### Pola sederhana dengan Lua

```lua
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
```

Atomic.

#### Pola aplikasi dengan toleransi kecil

```text
INCR key
if result == 1:
  EXPIRE key ttl
```

Ini masih punya failure window jika aplikasi crash setelah `INCR` pertama sebelum `EXPIRE`.

Untuk rate limiter/security-sensitive quota, gunakan Lua atau transaction pattern yang benar.

### 6.2 Sequence Generator

```redis
INCR sequence:invoice
```

Hasil:

```text
1, 2, 3, 4, ...
```

Redis counter dapat menjadi sequence generator cepat.

Tapi hati-hati:

- Redis persistence menentukan apakah sequence bisa mundur setelah crash,
- failover async replication bisa kehilangan increment terakhir,
- sequence gap pasti bisa terjadi jika nomor sudah diambil tetapi transaksi bisnis gagal,
- global monotonicity lintas cluster/shard tidak otomatis,
- sequence untuk invoice/regulatory document biasanya perlu aturan hukum/audit yang lebih ketat.

Prinsip:

```text
Redis counter cocok untuk technical sequence, metrics, temporary ordering, dan non-critical ID.
Untuk legally significant numbering, gunakan database/system-of-record yang durability dan audit trail-nya jelas.
```

### 6.3 Counter untuk Rate Limit

Fixed window sederhana:

```text
key = rate:user:123:/payments:20260620T1041
count = INCR key
if count == 1: EXPIRE key 60
if count > limit: reject
```

Masalah:

- boundary burst di antara dua window,
- failure window TTL,
- multi-dimensional quota key explosion,
- clock alignment,
- abuse by hot key,
- failover losing recent increments.

Kita akan bahas rate limiting detail di Part 011.

Di sini cukup pahami:

```text
String counter adalah primitive, bukan desain quota lengkap.
```

---

## 7. String sebagai Token Store

Redis sering dipakai untuk token/token-like state:

- session token,
- access token metadata,
- refresh token denylist,
- OTP,
- email verification token,
- password reset token,
- CSRF nonce,
- idempotency request key,
- one-time claim marker.

Contoh OTP:

```redis
SET otp:user:123 "918274" EX 300
```

Validasi:

```redis
GET otp:user:123
```

Jika cocok, hapus:

```redis
DEL otp:user:123
```

Tetapi validasi one-time token dengan `GET` lalu `DEL` punya race condition.

Dua request paralel bisa melakukan:

```text
Request A: GET -> valid
Request B: GET -> valid
Request A: DEL
Request B: DEL
```

Keduanya bisa lolos.

Pola lebih aman:

```lua
local value = redis.call('GET', KEYS[1])
if value == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
else
  return 0
end
```

Atau dengan command modern tertentu tergantung versi dan kebutuhan, tetapi Lua sering paling eksplisit untuk compare-and-delete.

### 7.1 Token Store Bukan Auth System Lengkap

Redis dapat menyimpan token metadata, tetapi auth system tetap butuh:

- cryptographic token design,
- expiration policy,
- replay prevention,
- device/session model,
- revocation semantics,
- audit trail,
- breach response,
- key rotation,
- rate limiting.

Redis hanya membantu state access cepat.

### 7.2 Token Value Design

Jangan simpan hanya:

```text
session:abc -> user-123
```

Untuk sistem serius, value biasanya perlu metadata:

```json
{
  "userId": "123",
  "tenantId": "acme",
  "issuedAt": "2026-06-20T10:00:00Z",
  "authLevel": "MFA",
  "deviceId": "device-789",
  "version": 2
}
```

Tetapi jika metadata makin kompleks dan sering partial update, pertimbangkan:

- Redis Hash,
- RedisJSON,
- SQL session table,
- hybrid Redis cache + DB source of truth.

---

## 8. String sebagai Lock Value

Distributed lock paling sederhana sering ditulis sebagai:

```redis
SET lock:invoice:INV-90001 "owner-token" NX PX 30000
```

Makna:

```text
Ambil lock hanya jika belum ada.
Lock otomatis expire setelah 30 detik.
Value berisi token unik pemilik lock.
```

Mengapa value harus unik?

Karena unlock tidak boleh sekadar:

```redis
DEL lock:invoice:INV-90001
```

Problem:

```text
1. Worker A ambil lock dengan TTL 30s.
2. Worker A pause 45s karena GC/network stall.
3. Lock A expire.
4. Worker B ambil lock baru.
5. Worker A resume lalu DEL lock.
6. A menghapus lock milik B.
```

Pola aman minimal:

```lua
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
```

Lock value harus berupa random token yang diketahui owner.

Namun ini masih belum menyelesaikan semua masalah distributed locking:

- lock lease bisa expire saat critical section masih berjalan,
- JVM GC pause bisa melebihi lease,
- clock dan network delay memengaruhi asumsi,
- Redis failover bisa menghilangkan lock write yang belum direplikasi,
- downstream resource tetap bisa menerima write stale dari owner lama,
- tanpa fencing token, sistem eksternal tidak bisa menolak actor lama.

Kesimpulan untuk Part 003:

```text
Redis String mendukung primitive lock value.
Distributed lock yang benar adalah desain sistem, bukan sekadar SET NX PX.
```

Distributed lock akan dibahas detail di Part 013.

---

## 9. String sebagai Cache Blob

Ini salah satu penggunaan Redis paling umum:

```redis
SET cache:user-profile:tenant:acme:user:123 "{...json...}" EX 300
```

### 9.1 Kapan String Cache Blob Cocok?

Gunakan String cache blob jika:

- value dibaca sebagai satu objek lengkap,
- update dilakukan dengan mengganti seluruh objek,
- ukuran value kecil sampai sedang,
- TTL jelas,
- cache miss bisa di-load dari source of truth,
- stale value masih dapat diterima dalam window tertentu,
- schema/value versioning dipikirkan.

Contoh bagus:

```text
user profile summary untuk UI header
product card display summary
tenant config snapshot
feature flag evaluation snapshot
small authorization context
API response cache untuk endpoint idempotent
```

### 9.2 Kapan String Cache Blob Buruk?

Buruk jika:

- value sangat besar,
- hanya satu field sering berubah,
- banyak client update field berbeda,
- perlu query berdasarkan field,
- perlu atomic update granular,
- perlu partial invalidation,
- perlu audit perubahan field,
- object menjadi mini database.

Contoh buruk:

```text
cache:tenant:acme:all-users -> huge JSON array 80MB
cache:case:123 -> mutable case object with 200 fields updated by many workflows
cache:permissions:global -> giant nested permission graph
```

### 9.3 Large Value Problem

Large Redis String membuat masalah:

- network transfer besar,
- serialization/deserialization mahal,
- memory pressure,
- replication bandwidth naik,
- AOF/RDB persistence cost naik,
- slow client risk,
- cache stampede makin mahal,
- eviction menjadi kasar karena satu key membawa payload besar.

Rule of thumb konseptual:

```text
Redis unggul untuk banyak value kecil yang sering diakses.
Redis sering memburuk saat dipakai sebagai blob warehouse.
```

Ukuran “besar” tergantung sistem, tetapi sebagai arsitek Anda harus punya budget eksplisit:

```text
max value size target
average value size target
p95 value size target
max keys per tenant
memory budget per bounded context
network budget per request path
```

---

## 10. Serialization di Java: Boundary yang Sering Diremehkan

Redis menyimpan bytes.
Java aplikasi mengelola object.
Di tengahnya ada serialization boundary.

```text
Java object <-> serializer <-> byte[]/String <-> Redis
```

Banyak bug Redis bukan bug Redis, tetapi bug serialization:

- class berubah tapi payload lama masih ada,
- enum value berubah,
- field rename tanpa backward compatibility,
- timezone berubah,
- decimal precision berubah,
- null handling berubah,
- serializer berbeda antar service,
- Java native serialization membuka risiko compatibility/security/performance,
- compression format berubah,
- schema version tidak disimpan.

### 10.1 Hindari Java Native Serialization untuk Cache Publik/Shared

Java native serialization biasanya buruk untuk Redis shared cache karena:

- payload tidak human-readable,
- class coupling kuat,
- rentan incompatibility saat refactor,
- sulit debug dengan `redis-cli`,
- tidak portable lintas bahasa,
- security concern jika deserialization tidak terkendali,
- payload cenderung besar.

Lebih umum dipakai:

- JSON untuk readability dan interoperability,
- Smile/CBOR/MessagePack untuk compact binary JSON-like,
- Protobuf/Avro untuk schema-aware binary,
- plain string untuk token/counter/flag,
- custom binary hanya jika benar-benar punya alasan.

### 10.2 Tambahkan Version Field

Untuk cache blob JSON:

```json
{
  "schemaVersion": 3,
  "userId": "123",
  "displayName": "Ayu",
  "tier": "GOLD"
}
```

Atau di key:

```text
cache:v3:user-profile:tenant:acme:user:123
```

Keduanya punya trade-off.

Version di key:

- mudah invalidasi massal dengan mengganti namespace,
- payload lebih bersih,
- key lama akan expire natural,
- memory sementara bisa naik saat v2 dan v3 coexist.

Version di value:

- bisa migrasi saat read,
- key tetap stabil,
- perlu deserializer yang backward-compatible.

Untuk cache, version di key sering lebih sederhana.
Untuk state yang lebih long-lived, version di value biasanya lebih aman.

### 10.3 Jangan Lupakan Charset

Untuk Redis String textual:

```text
String -> bytes using UTF-8
bytes -> String using UTF-8
```

Pastikan semua service menggunakan encoding konsisten.

Jangan mengandalkan platform default charset.

---

## 11. JSON String vs Redis Hash vs RedisJSON

Keputusan ini sangat penting.

### 11.1 JSON sebagai String

```text
key -> JSON blob
```

Cocok jika:

- read selalu whole object,
- write whole object,
- object kecil,
- tidak perlu query field,
- TTL satu object,
- cache-aside sederhana.

Kelebihan:

- sederhana,
- portable,
- mudah debug,
- cocok dengan DTO Java,
- satu round trip untuk whole object.

Kekurangan:

- partial update sulit,
- lost update risk,
- field-level concurrency buruk,
- memory bisa boros,
- no server-side field query.

### 11.2 Redis Hash

```text
key -> field -> value
```

Cocok jika:

- object punya field sederhana,
- perlu partial read/update,
- field tidak nested kompleks,
- update field sering terjadi,
- ingin menghindari rewrite whole JSON.

Contoh:

```redis
HSET user:123 name "Ayu" tier "GOLD" riskScore "71"
HGET user:123 tier
```

Kita bahas detail di Part 004.

### 11.3 RedisJSON

Cocok jika:

- perlu nested JSON,
- partial JSON path update,
- document-like structure,
- integrasi dengan Redis Query/Search,
- Redis Stack/Redis 8 feature set tersedia di deployment.

Namun RedisJSON bukan alasan untuk menjadikan Redis document database default.

Pertanyaan arsitektural:

```text
Apakah Redis di sini cache/search-serving layer,
atau source of truth yang harus durable, queryable, audited, migrated, dan governed?
```

Untuk regulatory/case management systems, jangan kaburkan batas ini.

---

## 12. Boolean, Flag, dan Marker

Redis String sering menyimpan flag:

```redis
SET feature:tenant:acme:new-risk-engine "true" EX 3600
SET marker:user:123:email-verified "1"
SET suppress:notification:case:777 "1" EX 86400
```

Tiga desain umum:

### 12.1 Value Carries Boolean

```redis
SET flag:x "true"
GET flag:x
```

Baik jika perlu eksplisit true/false.

### 12.2 Existence Carries Meaning

```redis
SET suppress:notification:case:777 "1" EX 86400
EXISTS suppress:notification:case:777
```

Baik untuk marker sementara:

```text
key exists -> suppressed
key absent -> not suppressed
```

### 12.3 Counter Carries Meaning

```redis
INCR attempt:user:123
```

Baik jika butuh jumlah attempt.

Hati-hati dengan ambiguity:

```text
missing key berarti false?
missing key berarti unknown?
missing key berarti expired?
missing key berarti not loaded?
missing key berarti Redis unavailable?
```

Desain yang defensible selalu membedakan:

- absent,
- false,
- unknown,
- expired,
- error.

---

## 13. Cache Null dan Negative Caching dengan String

Masalah cache-aside:

```text
GET cache:user:999 -> nil
DB query user 999 -> not found
next request -> GET nil -> DB query lagi
```

Jika banyak request untuk data yang tidak ada, database bisa tetap terbebani.

Solusi: negative cache.

```redis
SET cache:user:999 "__NULL__" EX 60
```

Atau JSON envelope:

```json
{
  "kind": "NOT_FOUND",
  "schemaVersion": 1
}
```

Lebih baik daripada literal raw `null`, karena ambiguity.

### 13.1 TTL Negative Cache Harus Pendek

Data yang tidak ada hari ini bisa ada sebentar lagi.

Contoh:

```text
User 999 belum dibuat.
Negative cache 1 jam.
User 999 dibuat 2 menit kemudian.
Service masih menganggap not found selama 58 menit.
```

Maka negative cache biasanya TTL pendek:

```text
30s, 60s, 120s
```

Tergantung domain.

Untuk regulatory/case systems, negative cache bisa berbahaya jika workflow creation dan lookup saling dekat waktunya.

---

## 14. Atomic Read-Modify-Write: Jangan Lakukan Naif di Aplikasi

Problem:

```java
String json = redis.get(key);
UserCache cache = objectMapper.readValue(json, UserCache.class);
cache.setLoginCount(cache.getLoginCount() + 1);
redis.set(key, objectMapper.writeValueAsString(cache));
```

Jika dua request paralel:

```text
A read loginCount=10
B read loginCount=10
A write 11
B write 11
```

Seharusnya 12, tetapi hasil 11.

Solusi tergantung data type:

- jika hanya counter, pakai `INCR`,
- jika field object, pakai Hash `HINCRBY`,
- jika conditional update, pakai Lua atau `WATCH` + `MULTI/EXEC`,
- jika state penting, mungkin seharusnya di database transaction,
- jika event-derived, tulis event lalu rebuild projection.

Rule:

```text
Jangan read-modify-write Redis String dari aplikasi jika correctness bergantung pada update atomic.
```

---

## 15. Command Cost dan Latency Behavior untuk Strings

Sebagian command String terlihat O(1), tetapi real latency dipengaruhi oleh ukuran value.

Contoh:

```redis
GET small:key
GET huge:key
```

Keduanya mungkin command lookup sederhana, tetapi `huge:key` harus:

- membaca pointer value,
- mengirim bytes besar lewat network,
- client menerima buffer besar,
- Java deserialize payload besar,
- GC pressure meningkat.

Jadi cost nyata:

```text
server lookup + memory copy + network transfer + client decode + application processing
```

Jangan hanya membaca time complexity command.

Untuk Java service, breakdown p99 bisa begini:

```text
Redis server command time: 0.3 ms
Network round trip: 1.2 ms
Client wait in pool: 4 ms
JSON deserialization: 8 ms
GC side effect: 20 ms tail
```

Lalu engineer menyalahkan Redis, padahal bottleneck ada di client/payload.

---

## 16. Pipelining untuk Banyak String Command

Jika harus melakukan banyak `SET` atau `GET`, jangan lakukan loop blocking satu per satu.

Buruk:

```java
for (String key : keys) {
    redis.get(key);
}
```

Lebih baik:

- `MGET` jika cocok,
- pipelining jika command berbeda atau perlu `SET EX` per key,
- async batching jika memakai Lettuce,
- local coalescing untuk hot path.

Contoh konseptual pipeline:

```text
send SET key1 value1 EX 300
send SET key2 value2 EX 300
send SET key3 value3 EX 300
read responses together
```

Pipeline mengurangi round trip, tetapi:

- tidak sama dengan transaction,
- command tetap dieksekusi berurutan di server,
- response harus tetap dibaca,
- batch terlalu besar bisa menahan koneksi,
- error handling per command harus jelas.

Pipeline dan transaksi Java client akan dibahas lebih detail di Part 024 dan Part 026.

---

## 17. TTL Discipline untuk String

Banyak String di Redis sebaiknya volatile.

Checklist:

```text
Apakah key ini punya TTL?
Jika tidak, siapa yang menghapusnya?
Jika tidak dihapus, apakah memang permanent state?
Jika permanent, kenapa Redis bukan database utama?
```

### 17.1 Common TTL Classes

```text
OTP/password reset token:        5-15 menit
session:                         15 menit - beberapa hari
idempotency key:                 24 jam - 7 hari tergantung retry window
cache user profile:              1-30 menit
feature config snapshot:         30 detik - 5 menit
rate limit fixed window:         window + buffer
lock lease:                      detik, bukan menit panjang tanpa alasan
negative cache:                  puluhan detik
workflow temporary marker:       sesuai SLA workflow + recovery buffer
```

TTL bukan angka asal. TTL adalah kontrak antara:

- freshness,
- memory cost,
- source-of-truth load,
- recovery behavior,
- user experience,
- consistency tolerance.

### 17.2 Jitter TTL

Jika banyak key dibuat bersamaan dengan TTL sama:

```text
100.000 key dibuat pukul 10:00 dengan TTL 300s.
Semua expire sekitar 10:05.
Backend dan DB terkena stampede.
```

Gunakan jitter:

```text
TTL = baseTTL + random(0, jitter)
```

Contoh:

```text
base 300s + random 0..60s
```

Atau:

```text
base 300s +/- 10%
```

---

## 18. Key Design untuk String

String key harus menunjukkan:

- bounded context,
- entity,
- purpose,
- tenant jika multi-tenant,
- version jika perlu,
- unit lifecycle.

Contoh buruk:

```text
user:123
session:abc
counter:login
lock:1
```

Contoh lebih baik:

```text
auth:v1:session:token:sha256:9f84...
identity:v2:user-profile-cache:tenant:acme:user:123
billing:v1:idempotency:tenant:acme:request:REQ-20260620-001
risk:v1:rate-limit:tenant:acme:subject:user:123:route:payments:window:202606201041
case:v1:lock:tenant:gov-id:case:CASE-777
```

Prinsip:

```text
Key name adalah bagian dari kontrak arsitektur.
```

Jangan terlalu pendek sampai ambigu.
Jangan terlalu panjang tanpa alasan karena key juga memakai memory.

Balance:

```text
Readable enough for operations.
Compact enough for memory.
Structured enough for ownership.
```

---

## 19. Java Implementation dengan Lettuce

Contoh sederhana memakai Lettuce synchronous API.

> Catatan: Dependency version sengaja tidak dipaku di sini karena berubah dari waktu ke waktu. Gunakan versi terbaru stabil sesuai build policy proyek Anda.

### 19.1 Connect dan Basic String Command

```java
import io.lettuce.core.RedisClient;
import io.lettuce.core.SetArgs;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;

import java.time.Duration;

public class RedisStringExample {
    public static void main(String[] args) {
        RedisClient client = RedisClient.create("redis://localhost:6379");

        try (StatefulRedisConnection<String, String> connection = client.connect()) {
            RedisCommands<String, String> redis = connection.sync();

            redis.set("demo:greeting", "hello", SetArgs.Builder.ex(60));

            String value = redis.get("demo:greeting");
            System.out.println(value);

            Long count = redis.incr("demo:counter");
            System.out.println(count);
        } finally {
            client.shutdown();
        }
    }
}
```

### 19.2 `SET NX EX` untuk Idempotency Marker

```java
import io.lettuce.core.SetArgs;
import io.lettuce.core.api.sync.RedisCommands;

import java.time.Duration;
import java.util.Objects;

public final class IdempotencyStore {
    private final RedisCommands<String, String> redis;

    public IdempotencyStore(RedisCommands<String, String> redis) {
        this.redis = Objects.requireNonNull(redis);
    }

    public boolean tryStart(String tenantId, String requestId, Duration ttl) {
        String key = "billing:v1:idempotency:tenant:" + tenantId + ":request:" + requestId;

        String result = redis.set(
            key,
            "STARTED",
            SetArgs.Builder.nx().ex(ttl)
        );

        return "OK".equals(result);
    }
}
```

Interpretasi:

```text
true  -> request pertama berhasil membuat marker
false -> duplicate atau request sedang/pernah diproses
```

Tapi production-grade idempotency tidak cukup `STARTED`. Biasanya perlu state:

```text
STARTED
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
```

Dan mungkin response replay.

### 19.3 Counter dengan TTL via Lua

```java
import io.lettuce.core.ScriptOutputType;
import io.lettuce.core.api.sync.RedisCommands;

public final class TtlCounter {
    private static final String INCR_WITH_EXPIRE = """
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return current
        """;

    private final RedisCommands<String, String> redis;

    public TtlCounter(RedisCommands<String, String> redis) {
        this.redis = redis;
    }

    public long increment(String key, long ttlSeconds) {
        return redis.eval(
            INCR_WITH_EXPIRE,
            ScriptOutputType.INTEGER,
            new String[] { key },
            String.valueOf(ttlSeconds)
        );
    }
}
```

Use case:

```text
rate limit window counter
login attempt counter
temporary metric counter
```

---

## 20. Java Implementation dengan Jedis

Jedis cocok untuk synchronous usage yang sederhana.

```java
import redis.clients.jedis.JedisPooled;
import redis.clients.jedis.params.SetParams;

public class JedisStringExample {
    public static void main(String[] args) {
        try (JedisPooled jedis = new JedisPooled("localhost", 6379)) {
            jedis.set("demo:greeting", "hello", SetParams.setParams().ex(60));

            String value = jedis.get("demo:greeting");
            System.out.println(value);

            long count = jedis.incr("demo:counter");
            System.out.println(count);
        }
    }
}
```

Distributed lock acquire minimal:

```java
String result = jedis.set(
    "lock:invoice:INV-90001",
    ownerToken,
    SetParams.setParams().nx().px(30_000)
);

boolean acquired = "OK".equals(result);
```

Safe release tetap butuh compare-and-delete, biasanya via Lua.

---

## 21. Spring Data Redis: RedisTemplate untuk String

Spring Data Redis sering dipakai di aplikasi Spring Boot.

Konfigurasi serializer sangat penting.

Contoh eksplisit String template:

```java
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
public class RedisTokenRepository {
    private final StringRedisTemplate redis;

    public RedisTokenRepository(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public void saveOtp(String userId, String otp) {
        String key = "auth:v1:otp:user:" + userId;
        redis.opsForValue().set(key, otp, Duration.ofMinutes(5));
    }

    public String getOtp(String userId) {
        String key = "auth:v1:otp:user:" + userId;
        return redis.opsForValue().get(key);
    }
}
```

Untuk object JSON, hindari RedisTemplate default yang tidak jelas.

Lebih baik eksplisit:

```text
ObjectMapper -> JSON String -> StringRedisTemplate
```

Daripada membiarkan implicit Java serialization menyimpan payload binary yang sulit di-debug.

---

## 22. Envelope Pattern untuk Cache Blob

Daripada menyimpan DTO mentah:

```json
{
  "userId": "123",
  "name": "Ayu"
}
```

Gunakan envelope:

```json
{
  "schemaVersion": 2,
  "cachedAt": "2026-06-20T10:41:33Z",
  "sourceVersion": "user-row-version-881",
  "kind": "VALUE",
  "payload": {
    "userId": "123",
    "name": "Ayu",
    "tier": "GOLD"
  }
}
```

Untuk negative cache:

```json
{
  "schemaVersion": 1,
  "cachedAt": "2026-06-20T10:41:33Z",
  "kind": "NOT_FOUND"
}
```

Kelebihan:

- debugging lebih mudah,
- deserializer bisa menangani version,
- cache age bisa diketahui,
- not found tidak ambigu,
- source version bisa dipakai untuk stale detection.

Kekurangan:

- payload lebih besar,
- butuh standard library internal,
- tidak cocok untuk ultra-hot tiny key jika overhead terlalu besar.

---

## 23. Failure Mode Matrix untuk Redis String

| Scenario | Root Cause | Dampak | Mitigasi |
|---|---|---|---|
| Key cache tidak pernah expire | `SET` tanpa `EX`, atau `SET` kedua menghapus TTL | Memory growth, stale data | Gunakan `SET EX`, `KEEPTTL`, TTL audit |
| Counter tanpa TTL | `INCR` tanpa expire | Infinite key growth | Lua `INCR` + `EXPIRE` saat first increment |
| Lost update pada JSON blob | Read-modify-write paralel | Update hilang | Hash, Lua, WATCH, DB transaction |
| Lock owner lama menghapus lock owner baru | Unlock pakai `DEL` langsung | Mutual exclusion rusak | Value token + Lua compare-and-delete |
| Large cache blob | Object terlalu besar | Network, memory, p99 latency buruk | Split model, Hash, compression, avoid Redis |
| Negative cache terlalu lama | TTL not found terlalu besar | Data baru tidak terlihat | TTL pendek, invalidasi saat create |
| Serialization incompatible | Class/schema berubah | Deserialization error massal | Versioning, JSON/protobuf discipline |
| Cache key collision | Key naming buruk | Data salah tenant/user | Namespace + tenant + purpose + version |
| `MGET` terlalu besar | Batch size tidak dibatasi | Tail latency naik | Batch limit, pipeline, pagination |
| Redis unavailable dianggap miss | Error handling salah | DB overload atau incorrect behavior | Bedakan miss vs error |
| Counter mundur setelah failover | Async replication/data loss window | Duplicate/invalid sequence | Jangan pakai Redis untuk critical numbering |
| TTL reset tidak sengaja | `SET EX` saat harus fixed TTL | Session/lease semantics salah | Pilih `KEEPTTL` atau explicit policy |

---

## 24. Decision Framework: Apakah Pakai String?

Gunakan Redis String jika jawaban mayoritas “ya”:

```text
[ ] Value dibaca sebagai satu unit.
[ ] Value ditulis sebagai satu unit.
[ ] Ukuran value kecil/sedang dan punya budget.
[ ] TTL/lifecycle jelas.
[ ] Missing key adalah kondisi normal dan tertangani.
[ ] Serialization format eksplisit.
[ ] Schema evolution sudah dipikirkan.
[ ] Tidak perlu query field internal.
[ ] Tidak perlu update field granular atomic.
[ ] Tidak menjadi source of truth kritikal tanpa durability reasoning.
```

Pertimbangkan Redis Hash jika:

```text
[ ] Banyak field kecil.
[ ] Butuh partial update.
[ ] Butuh increment field tertentu.
[ ] Object tidak nested kompleks.
```

Pertimbangkan RedisJSON jika:

```text
[ ] Butuh nested JSON.
[ ] Butuh partial JSON path update.
[ ] Deployment mendukung RedisJSON/Redis 8 feature set.
[ ] Query/search integration memang dibutuhkan.
```

Pertimbangkan SQL jika:

```text
[ ] Data adalah source of truth.
[ ] Butuh transaksi kuat.
[ ] Butuh audit trail.
[ ] Butuh relational constraints.
[ ] Butuh query ad hoc/analytical.
```

Pertimbangkan Kafka/RabbitMQ jika:

```text
[ ] Yang disimpan adalah event log/message stream durable.
[ ] Consumer replay penting.
[ ] Ordering/retention/consumer semantics adalah concern utama.
```

---

## 25. Latihan Praktik

### Lab 1 — Basic String TTL

Jalankan Redis lokal:

```bash
docker run --rm -p 6379:6379 redis:8
```

Coba:

```bash
redis-cli SET demo:greeting hello EX 30
redis-cli GET demo:greeting
redis-cli TTL demo:greeting
```

Tunggu 30 detik:

```bash
redis-cli GET demo:greeting
```

Ekspektasi:

```text
nil
```

### Lab 2 — TTL Hilang karena SET Ulang

```bash
redis-cli SET demo:session user-123 EX 60
redis-cli TTL demo:session
redis-cli SET demo:session user-123-updated
redis-cli TTL demo:session
```

Perhatikan hasil TTL.

Lalu ulangi dengan:

```bash
redis-cli SET demo:session user-123 EX 60
redis-cli SET demo:session user-123-updated KEEPTTL
redis-cli TTL demo:session
```

Tujuan:

```text
Melihat bahwa SET ulang bisa mengubah lifecycle key.
```

### Lab 3 — Counter

```bash
redis-cli DEL demo:counter
redis-cli INCR demo:counter
redis-cli INCR demo:counter
redis-cli INCRBY demo:counter 10
redis-cli GET demo:counter
```

Ekspektasi:

```text
12
```

### Lab 4 — `NX` Marker

```bash
redis-cli SET demo:once started NX EX 60
redis-cli SET demo:once started-again NX EX 60
redis-cli GET demo:once
```

Ekspektasi:

```text
started
```

### Lab 5 — Safe Unlock Script

Acquire:

```bash
redis-cli SET demo:lock owner-a NX PX 30000
```

Release dengan token benar:

```bash
redis-cli EVAL "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end" 1 demo:lock owner-a
```

Acquire lagi:

```bash
redis-cli SET demo:lock owner-b NX PX 30000
```

Coba release dengan token salah:

```bash
redis-cli EVAL "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end" 1 demo:lock owner-a
```

Ekspektasi:

```text
0
```

Lock owner-b tidak terhapus.

---

## 26. Checklist Production untuk Redis String

Sebelum merge kode yang memakai Redis String, tanyakan:

```text
Key Design
[ ] Apakah key punya namespace bounded context?
[ ] Apakah tenant/user/entity jelas?
[ ] Apakah versioning diperlukan?
[ ] Apakah key length masuk akal?

Lifecycle
[ ] Apakah TTL diperlukan?
[ ] Apakah SET dilakukan dengan EX/PX jika TTL wajib?
[ ] Apakah SET ulang mempertahankan atau reset TTL sesuai kontrak?
[ ] Apakah ada cleanup untuk non-TTL key?

Correctness
[ ] Apakah missing key ditangani sebagai state normal?
[ ] Apakah miss dibedakan dari Redis error?
[ ] Apakah read-modify-write aman dari race?
[ ] Apakah lock release memakai compare token?
[ ] Apakah counter durability cukup?

Serialization
[ ] Apakah serializer eksplisit?
[ ] Apakah Java native serialization dihindari kecuali ada alasan kuat?
[ ] Apakah schema version ada?
[ ] Apakah backward compatibility dipikirkan?
[ ] Apakah payload bisa di-debug?

Performance
[ ] Apakah value size punya batas?
[ ] Apakah batch size punya batas?
[ ] Apakah MGET/pipeline dipakai untuk banyak key?
[ ] Apakah p95/p99 diukur?
[ ] Apakah client pool/timeout dikonfigurasi?

Operations
[ ] Apakah key bisa ditemukan saat incident?
[ ] Apakah memory impact diperkirakan?
[ ] Apakah dashboard punya hit/miss/error/latency metric?
[ ] Apakah alert membedakan Redis down vs cache miss?
```

---

## 27. Mini Case Study: Session TTL Bug

### Situasi

Service auth menyimpan session:

```redis
SET auth:session:abc "{...}" EX 1800
```

Setiap kali user melakukan request, service memperbarui metadata `lastSeenAt`:

```redis
SET auth:session:abc "{...updated...}"
```

### Gejala

Memory Redis terus naik.
Banyak session lama tidak pernah hilang.
User tetap terlihat aktif walau sudah lama tidak login.

### Root Cause

`SET` kedua menghapus TTL existing karena tidak memakai `EX` atau `KEEPTTL`.

### Fix Option A — Sliding Expiration

Jika setiap aktivitas memperpanjang session:

```redis
SET auth:session:abc "{...updated...}" EX 1800
```

### Fix Option B — Fixed Expiration

Jika session harus berakhir pada waktu awal:

```redis
SET auth:session:abc "{...updated...}" KEEPTTL
```

### Lesson

```text
TTL bukan detail storage.
TTL adalah bagian dari security/session contract.
```

---

## 28. Mini Case Study: JSON Cache Lost Update

### Situasi

Key:

```text
case:v1:cache:tenant:gov:case:CASE-777
```

Value:

```json
{
  "caseId": "CASE-777",
  "status": "UNDER_REVIEW",
  "assignedOfficer": "officer-a",
  "riskScore": 80
}
```

Service A update `assignedOfficer`.
Service B update `riskScore`.

Keduanya melakukan:

```text
GET -> deserialize -> mutate field -> SET whole JSON
```

### Race

```text
A reads old object
B reads old object
A writes assignedOfficer=officer-b
B writes riskScore=91 with old assignedOfficer=officer-a
```

Update A hilang.

### Fix Options

Option 1: Redis Hash.

```redis
HSET case:v1:state:CASE-777 assignedOfficer officer-b
HSET case:v1:state:CASE-777 riskScore 91
```

Option 2: Lua compare/update.

Option 3: `WATCH` optimistic transaction.

Option 4: Jangan jadikan Redis tempat mutable case state; pakai DB transaction sebagai source of truth dan Redis hanya projection/cache.

### Lesson

```text
String JSON blob cocok untuk immutable-ish snapshot, bukan mutable shared state dengan field-level concurrency.
```

---

## 29. Mini Case Study: Counter untuk Nomor Invoice

### Situasi

Tim memakai:

```redis
INCR invoice:number
```

untuk membuat nomor invoice legal.

### Masalah

Setelah failover, beberapa nomor duplicate/mundur karena write terakhir belum durable/replicated sesuai asumsi.

### Root Cause

Redis counter cepat dan atomic di primary saat command dieksekusi, tetapi bukan otomatis memenuhi semua kebutuhan legal numbering:

- persistence configuration,
- replication lag,
- failover semantics,
- audit trail,
- gap policy,
- monotonicity guarantee.

### Better Design

Untuk nomor legal:

- gunakan database transaction/sequence dengan durability yang tepat,
- simpan audit allocation,
- definisikan gap policy,
- gunakan Redis hanya untuk preallocation non-final jika benar-benar perlu,
- validasi dengan compliance requirement.

### Lesson

```text
Atomic command tidak sama dengan durable business guarantee.
```

---

## 30. Ringkasan Mental Model

Redis String adalah primitive paling dasar:

```text
key -> bytes
```

Ia powerful karena:

- simple,
- cepat,
- atomic per command,
- mendukung TTL,
- mendukung conditional set,
- bisa menjadi counter,
- bisa menjadi token store,
- bisa menjadi cache blob,
- bisa menjadi lock value.

Ia berbahaya karena:

- Redis tidak tahu struktur internal value,
- read-modify-write mudah race,
- TTL mudah hilang saat `SET` ulang,
- large blob merusak latency/memory,
- serialization boundary sering tidak disiplin,
- counter/lock sering diberi makna correctness lebih besar daripada jaminan sebenarnya.

Satu kalimat utama:

```text
Gunakan Redis String untuk value yang secara domain memang satu unit atomik, kecil, punya lifecycle jelas, dan tidak membutuhkan operasi granular di dalam value.
```

---

## 31. Referensi

- Redis official documentation — Redis Strings data type.
- Redis official documentation — `SET` command and options including `NX`, `XX`, expiry-related options, and TTL-related behavior.
- Redis official documentation — `GET`, `MGET`, `MSET`, `INCR`, `INCRBY`, `EXPIRE`, `TTL`.
- Redis official documentation — Java clients: Lettuce and Jedis guides.
- Spring Data Redis reference documentation for RedisTemplate/StringRedisTemplate patterns.

---

## 32. Status Seri

```text
Part 003 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-004.md
```

Part berikutnya akan membahas:

```text
Part 004 — Hashes: Object-Like Data Tanpa Menjadi Document Database
```

Fokus Part 004:

- Redis Hash sebagai field-value record,
- object modeling,
- partial update,
- memory encoding,
- Hash vs JSON String,
- Hash vs SQL row,
- Java DTO mapping,
- dan anti-pattern giant hash as table.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Redis Data Model: Keys, Values, Types, Encodings</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-004.md">Part 004 — Hashes: Object-Like Data Tanpa Menjadi Document Database ➡️</a>
</div>
