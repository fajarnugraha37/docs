# learn-redis-mastery-for-java-engineers-part-019.md

# Part 019 — Geospatial, JSON, Search, dan Vector Set

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memakai Redis secara arsitektural, bukan hanya sebagai cache  
> Fokus bagian ini: Redis modern sebagai geospatial store ringan, JSON document store, query/search engine, dan vector similarity layer

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 018, kita sudah membahas Redis dari sisi struktur data inti:

- String
- Hash
- List
- Set
- Sorted Set
- TTL / eviction
- cache architecture
- rate limiting
- idempotency
- distributed lock
- Lua / Functions
- Pub/Sub
- Streams
- Bitmap / Bitfield / HyperLogLog

Part ini masuk ke area yang sering membuat engineer salah persepsi:

> “Kalau Redis sudah punya JSON, Search, Geospatial, dan Vector, apakah Redis bisa menggantikan PostgreSQL, Elasticsearch, MongoDB, atau vector database?”

Jawaban singkatnya:

> Bisa untuk sebagian use case. Tidak untuk semua. Redis harus dipakai sebagai **latency-critical retrieval/query layer**, bukan otomatis sebagai source of truth universal.

Bagian ini akan membangun mental model agar kamu bisa menjawab:

1. Kapan memakai Redis Geospatial native?
2. Kapan memakai Redis Search geospatial?
3. Kapan JSON lebih baik daripada Hash atau String JSON blob?
4. Kapan Redis Query Engine layak dipakai?
5. Apa beda vector search via Redis Query Engine dengan Vector Set?
6. Apa risiko memory, indexing, consistency, dan operability-nya?
7. Bagaimana Java service sebaiknya mengintegrasikannya?

---

## 1. Redis Modern: Dari Data Structure Server ke Retrieval Engine

Redis klasik sering dipahami sebagai:

```text
in-memory key-value store
```

Namun Redis modern lebih akurat dipahami sebagai:

```text
in-memory data structure server + programmable execution layer + query/retrieval layer
```

Redis 8 membuat garis ini semakin jelas karena kemampuan yang dulu sering diasosiasikan dengan Redis Stack—seperti JSON, Search, Time Series, probabilistic data structures, dan vector/search capability—menjadi bagian integral dari Redis Open Source modern.

Konsekuensinya besar:

- Redis bukan hanya `GET key`.
- Redis bisa menyimpan JSON document.
- Redis bisa membuat secondary index.
- Redis bisa melakukan full-text search.
- Redis bisa melakukan filtering numeric/tag/geo.
- Redis bisa melakukan vector similarity search.
- Redis punya Vector Set sebagai native data type untuk similarity use case tertentu.

Namun konsekuensi kedua juga penting:

> Semakin Redis digunakan sebagai query engine, semakin Redis perlu diperlakukan seperti database operasional: ada schema, index, memory budget, query budget, migration, observability, dan failure model.

Jika kamu memakai Redis hanya sebagai cache, kehilangan Redis mungkin menyebabkan degradasi performa.  
Jika kamu memakai Redis sebagai query layer utama, kehilangan Redis bisa menyebabkan fitur inti tidak berjalan.

---

## 2. Empat Capability yang Dibahas

Part ini mencakup empat kelompok capability:

```text
1. Geospatial native
   - GEOADD
   - GEOSEARCH
   - GEODIST
   - GEOPOS

2. JSON document
   - JSON.SET
   - JSON.GET
   - JSON.MGET
   - JSON.NUMINCRBY
   - path-based update

3. Search / Query Engine
   - FT.CREATE
   - FT.SEARCH
   - FT.AGGREGATE
   - indexes over Hash and JSON
   - full-text, tag, numeric, geo, vector fields

4. Vector Set / Vector Search
   - vector field search via query engine
   - native Vector Set data type
```

Jangan campur mental modelnya.

Redis Geospatial native adalah **data type-oriented**.

Redis Search geospatial adalah **index/query-oriented**.

Redis JSON adalah **document storage-oriented**.

Redis Search adalah **secondary index and retrieval-oriented**.

Vector search adalah **embedding similarity-oriented**.

Vector Set adalah **native similarity data structure-oriented**.

---

## 3. Geospatial Native: Nearby Lookup Ringan

Redis punya geospatial commands untuk menyimpan koordinat longitude/latitude dan melakukan lookup berdasarkan jarak.

Contoh model:

```text
Key: geo:drivers:jakarta
Member: driver-123
Coordinate: 106.8456, -6.2088
```

Command konseptual:

```redis
GEOADD geo:drivers:jakarta 106.8456 -6.2088 driver-123
GEOADD geo:drivers:jakarta 106.8272 -6.1751 driver-456

GEOSEARCH geo:drivers:jakarta \
  FROMLONLAT 106.8456 -6.2088 \
  BYRADIUS 5 km \
  ASC \
  WITHDIST \
  COUNT 20
```

Hasilnya kira-kira:

```text
driver terdekat dalam radius 5 km dari titik tertentu
```

Use case cocok:

- nearby store lookup
- nearby driver/courier lookup sederhana
- facility locator
- branch locator
- spatial pre-filtering sederhana
- “find nearest N points” ringan

Use case tidak cocok:

- polygon kompleks
- routing
- map matching
- traffic-aware ETA
- geofencing kompleks dengan banyak shape
- spatial analytics besar
- GIS-grade correctness

Redis native geospatial berguna kalau pertanyaanmu seperti:

```text
Dari titik ini, siapa member terdekat dalam radius X?
```

Bukan:

```text
Hitung rute optimal multi-stop dengan constraint jalan, traffic, polygon administratif, dan historical movement.
```

---

## 4. Cara Kerja Geospatial Native secara Mental Model

Redis geospatial secara praktis memakai Sorted Set di bawahnya.

Member disimpan sebagai elemen, sedangkan skor internalnya merepresentasikan posisi yang sudah diencode.

Mental model:

```text
GEO key = sorted-set-like index of location members
```

Implikasi:

1. Satu key geospatial bisa berisi banyak member.
2. Member adalah string identifier.
3. Detail entity biasanya tidak disimpan di GEO key.
4. Detail entity disimpan di key lain.
5. GEO key lebih cocok sebagai index posisi.

Contoh desain:

```text
geo:driver:active:{cityId}                -> geospatial index
hash:driver:{driverId}:location-state     -> detail driver state
string:driver:{driverId}:availability     -> availability flag
```

Flow:

```text
1. Query GEOSEARCH untuk candidate driver dekat.
2. Ambil detail driver dengan HMGET/MGET.
3. Filter availability/status/business rule di application atau Search index.
4. Ranking final di service.
```

Jangan masukkan semua atribut ke member string seperti:

```text
driver-123|available|gold|bike|rating-4.9
```

Itu anti-pattern karena:

- parsing brittle
- update sulit
- member identity kacau
- query rule tidak eksplisit
- cardinality member membengkak
- sulit maintain backward compatibility

---

## 5. Geospatial Native vs Redis Search Geospatial

Redis punya dua “rasa” geospatial:

### 5.1 Native Geospatial

Contoh:

```redis
GEOADD places 106.8456 -6.2088 place:1
GEOSEARCH places FROMLONLAT 106.8 -6.2 BYRADIUS 10 km
```

Cocok untuk:

- simple radius lookup
- nearby lookup
- lightweight operational index
- state yang sering berubah
- entity ID retrieval

### 5.2 Search Geospatial

Redis Query Engine dapat membuat index atas field geospatial di Hash/JSON.

Cocok untuk query gabungan:

```text
Find stores near this point
where category = pharmacy
and openNow = true
and rating >= 4.5
and supportsInsurance = true
```

Native GEO akan membutuhkan:

```text
GEOSEARCH -> ambil kandidat -> filter manual
```

Search GEO bisa membuat query lebih declarative:

```text
@category:{pharmacy} @openNow:{true} @rating:[4.5 +inf] @location:[lon lat radius km]
```

Trade-off:

| Aspek | Native GEO | Search GEO |
|---|---:|---:|
| Simplicity | Tinggi | Sedang |
| Query gabungan | Lemah | Kuat |
| Index cost | Relatif lebih kecil | Lebih besar |
| Schema | Minimal | Harus eksplisit |
| Operational complexity | Lebih rendah | Lebih tinggi |
| Cocok untuk moving object | Sering lebih cocok | Bisa, tapi index churn perlu dihitung |
| Cocok untuk document filtering | Tidak | Ya |

Rule of thumb:

> Pakai native GEO untuk nearby candidate retrieval sederhana. Pakai Search GEO ketika geospatial hanya salah satu filter dari query document yang lebih kaya.

---

## 6. Java Example: Native GEO dengan Lettuce

Contoh sederhana memakai Lettuce synchronous API secara konseptual.

```java
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.GeoArgs;
import io.lettuce.core.GeoCoordinates;
import io.lettuce.core.GeoWithin;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;

import java.util.List;

public class DriverGeoRepository {
    private final RedisCommands<String, String> redis;

    public DriverGeoRepository(RedisCommands<String, String> redis) {
        this.redis = redis;
    }

    public void updateDriverLocation(String cityId, String driverId, double lon, double lat) {
        String key = "geo:driver:active:" + cityId;
        redis.geoadd(key, lon, lat, driverId);
    }

    public List<GeoWithin<String>> findNearbyDrivers(
            String cityId,
            double lon,
            double lat,
            double radiusKm,
            int limit
    ) {
        String key = "geo:driver:active:" + cityId;

        GeoArgs args = new GeoArgs()
                .withDistance()
                .sort(GeoArgs.Sort.asc)
                .limit(limit);

        return redis.georadius(key, lon, lat, radiusKm, GeoArgs.Unit.km, args);
    }

    public void removeDriver(String cityId, String driverId) {
        String key = "geo:driver:active:" + cityId;
        redis.zrem(key, driverId);
    }
}
```

Catatan:

- Di beberapa client/API versi baru, command `GEOSEARCH` lebih disarankan daripada command lama `GEORADIUS`.
- Contoh ini untuk mental model, bukan final production wrapper.
- Production code perlu timeout, metrics, retry policy hati-hati, dan fallback.

---

## 7. JSON di Redis: Document Value dengan Path-Based Update

Sebelum Redis JSON, banyak engineer melakukan ini:

```redis
SET user:123 '{"id":"123","name":"Ayu","status":"ACTIVE","score":42}'
```

Lalu aplikasi melakukan:

```text
GET JSON blob -> deserialize -> modify -> serialize -> SET full blob
```

Ini bisa cukup untuk cache blob sederhana.

Namun kelemahannya:

1. Update partial mahal.
2. Race condition mudah terjadi.
3. Tidak bisa query field tanpa external index.
4. Perubahan kecil menulis ulang seluruh value.
5. Tidak ada path operation.
6. Sulit increment field numeric secara server-side.

Redis JSON memperkenalkan operasi document-style:

```redis
JSON.SET user:123 $ '{"id":"123","name":"Ayu","status":"ACTIVE","score":42}'
JSON.GET user:123 $.name
JSON.NUMINCRBY user:123 $.score 1
JSON.SET user:123 $.status '"SUSPENDED"'
```

Mental model:

```text
Redis JSON = Redis value yang bisa dimanipulasi dengan path expression
```

Bukan:

```text
MongoDB lengkap di dalam Redis
```

---

## 8. JSON vs Hash vs String Blob

Ini keputusan penting.

### 8.1 String JSON Blob

Cocok jika:

- object kecil
- read mostly
- update whole object
- tidak perlu query field
- Redis hanya cache
- source of truth ada di database lain

Contoh:

```redis
SET cache:user-profile:123 '{...}' EX 300
```

Kelebihan:

- sederhana
- cepat secara konseptual
- mudah dengan Jackson
- tidak perlu module/query schema

Kelemahan:

- update partial tidak atomic secara natural
- query field tidak ada
- full rewrite
- risiko lost update kalau read-modify-write tidak dikontrol

### 8.2 Hash

Cocok jika:

- object flat
- field sederhana
- partial update penting
- tidak butuh nested structure
- field sering diambil sebagian

Contoh:

```redis
HSET user:123 name Ayu status ACTIVE score 42
HINCRBY user:123 score 1
```

Kelebihan:

- sederhana
- memory efficient untuk small hash
- partial field update
- atomic field increment

Kelemahan:

- nested object tidak natural
- array tidak natural
- field typing tetap manual
- query field butuh Search index kalau ingin secondary query

### 8.3 Redis JSON

Cocok jika:

- object nested
- array penting
- path update penting
- query/search di field JSON diperlukan
- ingin index JSON document
- Redis memang menjadi retrieval document layer

Kelebihan:

- nested document natural
- path-based update
- integrasi dengan Search index
- cocok untuk retrieval layer modern

Kelemahan:

- memory overhead lebih tinggi
- schema governance lebih penting
- index cost perlu dihitung
- operability lebih kompleks
- tidak otomatis menggantikan database dokumen durable

Decision rule:

```text
Jika object flat dan field update sederhana -> Hash.
Jika object nested dan butuh path/index/query -> Redis JSON.
Jika hanya cache blob read-mostly -> String JSON blob.
```

---

## 9. Modeling JSON Document dengan Discipline

Misalnya kita punya product card untuk catalog retrieval:

```json
{
  "id": "p-1001",
  "tenantId": "t-01",
  "sku": "SKU-RED-001",
  "name": "Red Running Shoes",
  "category": "shoes",
  "brand": "Acme",
  "price": 799000,
  "currency": "IDR",
  "available": true,
  "rating": 4.7,
  "tags": ["running", "sport", "red"],
  "updatedAt": "2026-06-20T10:15:00+07:00"
}
```

Redis key:

```text
json:product:{tenantId}:{productId}
```

Example:

```redis
JSON.SET json:product:t-01:p-1001 $ '{
  "id":"p-1001",
  "tenantId":"t-01",
  "sku":"SKU-RED-001",
  "name":"Red Running Shoes",
  "category":"shoes",
  "brand":"Acme",
  "price":799000,
  "currency":"IDR",
  "available":true,
  "rating":4.7,
  "tags":["running","sport","red"],
  "updatedAt":"2026-06-20T10:15:00+07:00"
}'
```

Important discipline:

1. Key contains ownership/boundary info.
2. JSON field also contains tenant ID for query filtering.
3. Version field is useful.
4. Updated timestamp is useful.
5. Source-of-truth relation must be explicit.
6. Indexable fields must be stable.
7. Avoid unbounded nested arrays.

Bad pattern:

```json
{
  "events": [
    { "time": "...", "action": "..." },
    { "time": "...", "action": "..." },
    ... infinite growth ...
  ]
}
```

Redis JSON should not become an infinite audit log. Use a database/event log for that.

---

## 10. Redis Search / Query Engine

Redis Search lets Redis maintain indexes over Hash or JSON documents.

Mental model:

```text
Document keys -> indexed fields -> query engine -> matching keys/documents
```

Example index over JSON product documents:

```redis
FT.CREATE idx:product:t-01
  ON JSON
  PREFIX 1 "json:product:t-01:"
  SCHEMA
    $.id AS id TAG
    $.tenantId AS tenantId TAG
    $.sku AS sku TAG
    $.name AS name TEXT
    $.category AS category TAG
    $.brand AS brand TAG
    $.price AS price NUMERIC
    $.available AS available TAG
    $.rating AS rating NUMERIC
    $.tags[*] AS tags TAG
```

Query examples:

```redis
FT.SEARCH idx:product:t-01 '@category:{shoes} @available:{true}'
```

```redis
FT.SEARCH idx:product:t-01 '@category:{shoes} @price:[500000 1000000] @rating:[4 +inf]'
```

```redis
FT.SEARCH idx:product:t-01 'running shoes'
```

This changes Redis from:

```text
known-key lookup system
```

to:

```text
field-indexed retrieval system
```

That is powerful but dangerous if you treat it as free.

---

## 11. Indexing Is a Write Amplifier

Every indexed document write may create additional index updates.

Without index:

```text
JSON.SET key value
```

With index:

```text
JSON.SET key value
+ parse relevant fields
+ update TEXT index
+ update TAG index
+ update NUMERIC index
+ update GEO index
+ maybe update VECTOR index
```

Consequences:

1. Writes become heavier.
2. Memory usage increases.
3. Reindexing/migration becomes operational work.
4. High-churn fields can be expensive.
5. Query performance improves at the cost of write and memory overhead.

Design implication:

> Jangan index semua field. Index field yang benar-benar digunakan untuk query path penting.

Bad schema:

```text
Index every property because maybe someday needed.
```

Good schema:

```text
Index only fields that appear in production query contracts.
```

---

## 12. Field Type Matters: TEXT vs TAG vs NUMERIC

Redis Search schema field type is not cosmetic.

### 12.1 TEXT

Use for full-text search.

Example:

```text
product name, description, article body
```

TEXT supports tokenization and relevance-oriented search.

Good:

```text
name TEXT
```

Bad:

```text
tenantId TEXT
status TEXT
sku TEXT
```

Why bad?

Because tenant/status/sku usually need exact matching, not tokenization.

### 12.2 TAG

Use for exact-match categorical fields.

Example:

```text
tenantId, status, category, brand, sku, country, role
```

Good:

```text
status TAG
category TAG
tenantId TAG
```

### 12.3 NUMERIC

Use for range query.

Example:

```text
price, score, timestamp epoch, rating
```

Good:

```text
price NUMERIC
rating NUMERIC
createdAtEpochMillis NUMERIC
```

### 12.4 GEO

Use for geospatial query over document fields.

### 12.5 VECTOR

Use for embedding similarity search.

The schema is part of your application contract. Treat it like database schema.

---

## 13. Query Design: Known-Key vs Search Query

Before using Redis Search, ask:

```text
Do I already know the key?
```

If yes, use direct key access:

```redis
JSON.GET json:product:t-01:p-1001
```

Do not search by ID:

```redis
FT.SEARCH idx:product:t-01 '@id:{p-1001}'
```

unless there is a good reason.

Known-key lookup is Redis’s strongest path:

```text
application knows key -> direct fetch
```

Search query is for:

```text
application knows conditions -> Redis finds matching keys/docs
```

Examples where Search makes sense:

```text
Find active products by category and price range.
Find nearby open stores with certain service flags.
Find documents matching text query.
Find top candidates by vector similarity and metadata filter.
```

Examples where Search does not make sense:

```text
Fetch session by session ID.
Fetch user profile by user ID.
Fetch idempotency record by request ID.
Fetch lock state by lock key.
```

---

## 14. Vector Search: What Problem It Solves

Traditional query asks:

```text
Find documents where field equals/ranges/matches text.
```

Vector search asks:

```text
Find documents whose embedding is close to this embedding.
```

This supports:

- semantic search
- recommendation
- similarity lookup
- retrieval augmented generation candidate retrieval
- duplicate-ish detection
- intent matching
- nearest-neighbor lookup in embedding space

Example:

```text
Query: "comfortable shoes for marathon training"
```

Embedding model converts it into vector:

```text
[0.031, -0.442, 0.118, ...]
```

Redis compares it with stored product/document vectors.

Result:

```text
products semantically similar to the query
```

Important:

> Redis does not create embeddings by itself in the usual architecture. Your application or embedding service creates vectors, Redis stores and queries them.

---

## 15. Redis Query Engine Vector Fields

Redis Query Engine can index vector fields and combine vector search with filters.

Conceptual schema:

```redis
FT.CREATE idx:product-vector:t-01
  ON JSON
  PREFIX 1 "json:product:t-01:"
  SCHEMA
    $.tenantId AS tenantId TAG
    $.category AS category TAG
    $.available AS available TAG
    $.price AS price NUMERIC
    $.embedding AS embedding VECTOR HNSW 6
      TYPE FLOAT32
      DIM 768
      DISTANCE_METRIC COSINE
```

Conceptual query:

```redis
FT.SEARCH idx:product-vector:t-01 \
  '(@category:{shoes} @available:{true})=>[KNN 10 @embedding $query_vector AS score]' \
  PARAMS 2 query_vector <binary-vector> \
  SORTBY score \
  DIALECT 2
```

This is powerful because it combines:

```text
metadata filter + vector nearest neighbor
```

Example business query:

```text
Find 10 semantically similar products,
but only in tenant t-01,
only category shoes,
only available items,
within price range.
```

This is often more useful than raw vector search.

---

## 16. Vector Set: Native Similarity Data Type

Redis 8 introduces Vector Set as a native data type.

Mental model:

```text
Vector Set ≈ Sorted Set-like collection where each element has a vector instead of score
```

With Sorted Set:

```text
member -> numeric score
```

With Vector Set:

```text
member -> vector representation
```

Vector Set supports:

- add element with vector
- search most similar to a given vector
- search most similar to an existing element’s vector

It is useful for Redis-native similarity workflows where you want a direct data structure rather than full document indexing.

Think of it like:

```text
I need a similarity set.
I do not necessarily need a full document search index.
```

Possible use cases:

- similar item lookup
- lightweight recommendation candidates
- semantic deduplication candidates
- nearest neighbor over compact entity IDs
- fast AI-agent memory candidate retrieval with simple metadata elsewhere

But be careful:

> Vector Set is not automatically a replacement for full vector databases or Redis Query Engine vector search.

If you need complex metadata filters, document fields, hybrid text/vector search, aggregations, or advanced query plans, Query Engine vector indexing may fit better.

---

## 17. Vector Search vs Vector Set

| Dimension | Query Engine Vector Search | Vector Set |
|---|---:|---:|
| Primary abstraction | Indexed document field | Native vector collection |
| Stores full document? | Usually Hash/JSON document | Element + vector |
| Metadata filtering | Strong | Limited / externalized |
| Hybrid search | Strong | Not primary goal |
| Query language | FT.SEARCH | Vector-set commands |
| Operational model | Index schema | Data structure key |
| Best for | document retrieval, RAG, filtered search | direct similarity over members |
| Complexity | Higher | Lower for narrow use cases |

Decision rule:

```text
Use Query Engine vector search when vector is one field among many indexed document fields.
Use Vector Set when similarity itself is the main primitive and metadata can be simple or external.
```

---

## 18. Java Architecture for Embedding + Redis

A typical Java architecture:

```text
[User query]
    |
    v
[Java API service]
    |
    | 1. normalize query
    | 2. call embedding service/model
    v
[Embedding vector]
    |
    | 3. query Redis vector index/vector set
    v
[Candidate IDs]
    |
    | 4. fetch documents/details
    | 5. apply authorization/business filters
    | 6. rerank if needed
    v
[Response]
```

Important boundaries:

1. Embedding generation is separate from Redis.
2. Redis query returns candidates, not necessarily final truth.
3. Authorization must not be skipped.
4. Tenant filter must be enforced.
5. Vector similarity is probabilistic-ish retrieval, not proof.
6. Final response may need reranking.
7. Source of truth should be clear.

Bad design:

```text
Redis vector result -> return directly to user with no authorization/filtering/freshness check
```

Good design:

```text
Redis vector result -> candidate set -> validate -> enrich -> rerank -> respond
```

---

## 19. Retrieval Layer vs Source of Truth

Redis can store documents. Redis can index documents. Redis can search documents.

But architecture still needs this question:

```text
Is Redis the source of truth or a derived retrieval projection?
```

### 19.1 Redis as Derived Projection

Most common and safer.

```text
PostgreSQL / primary DB / event stream
        |
        v
Redis JSON/Search/Vector projection
        |
        v
Low-latency retrieval
```

Pros:

- primary truth remains durable
- rebuild possible
- Redis can be flushed/reindexed/recovered
- query layer can be optimized for reads

Cons:

- eventual consistency
- projection pipeline complexity
- reindexing required
- stale data possible

### 19.2 Redis as Source of Truth

Possible but heavier operationally.

Requires:

- persistence configured deliberately
- backup/restore tested
- failover tested
- durability window accepted
- schema migration discipline
- audit requirement satisfied
- memory budget strong
- disaster recovery story

For regulatory/enforcement lifecycle systems, default assumption should be:

> Redis is not the authoritative audit record unless you have explicitly designed and validated durability, retention, replay, access control, and recovery controls.

---

## 20. Projection Design Pattern

Suppose source of truth is PostgreSQL:

```text
product table
product_inventory table
product_price table
```

You build Redis projection:

```text
json:product-search:{tenantId}:{productId}
```

With index:

```text
idx:product-search:{tenantId}
```

Update pipeline:

```text
1. Product changes in DB.
2. Transaction commits.
3. Outbox event emitted.
4. Projection worker consumes event.
5. Worker loads canonical view.
6. Worker writes Redis JSON document.
7. Search index updates automatically.
8. Query API reads Redis projection.
```

This avoids writing Redis inside the same transaction as DB in a fragile way.

Why?

Because this common flow is dangerous:

```text
BEGIN DB transaction
UPDATE product
JSON.SET Redis
COMMIT DB transaction
```

Failure cases:

| Failure | Result |
|---|---|
| Redis write succeeds, DB commit fails | Redis shows non-existent update |
| DB commit succeeds, Redis write fails | Redis stale |
| service crashes after DB update before Redis | Redis stale |
| retry updates Redis twice | maybe okay, maybe not |

Better:

```text
DB commit -> durable event/outbox -> async projection update
```

Redis projection becomes rebuildable.

---

## 21. Consistency Model for Search Projections

For Redis JSON/Search projection, define:

```text
Freshness SLA: how stale may results be?
Completeness SLA: may search miss newly created records?
Deletion SLA: how fast must deleted records disappear?
Authorization SLA: can stale ACL leak data?
Rebuild SLA: how long to reconstruct index?
```

Example:

```text
Product search may be stale up to 30 seconds.
Deleted products must disappear within 5 seconds.
Tenant isolation must never be stale.
Price may be stale up to 60 seconds if checkout revalidates price from source of truth.
```

This is architecture, not implementation detail.

For regulatory systems:

```text
Search result may be projection.
Enforcement action state must be authoritative elsewhere.
Audit log must not depend only on Redis index.
```

---

## 22. Multi-Tenant Design

Redis Search multi-tenant design has several options.

### Option A — Index per tenant

```text
idx:case:t-001
idx:case:t-002
idx:case:t-003
```

Pros:

- isolation simpler
- query automatically tenant-scoped
- easier deletion per tenant

Cons:

- many indexes
- operational overhead
- bad for thousands/millions of tenants

### Option B — Shared index with tenant TAG

```text
idx:case:all
```

Every query includes:

```text
@tenantId:{t-001}
```

Pros:

- fewer indexes
- simpler global management

Cons:

- every query must enforce tenant filter
- bug can leak data
- cardinality/performance must be tested

### Option C — Hybrid

```text
large tenants -> dedicated index
small tenants -> shared index
```

Best for SaaS with skewed tenant sizes.

Key principle:

> Tenant isolation must be enforced structurally, not only by developer discipline.

For sensitive systems, prefer defense in depth:

- key prefix includes tenant
- document field includes tenant
- index query filters tenant
- service authorization checks tenant
- tests assert tenant isolation

---

## 23. Schema Evolution

Redis Search schema is not something to casually mutate without plan.

Possible changes:

- add indexed field
- remove indexed field
- change field type
- change prefix
- change JSON path
- change tokenizer behavior
- change vector dimensions
- change distance metric

Some changes are backward-compatible. Some require reindex/rebuild.

Example problem:

```text
embedding dimension changes from 768 to 1536
```

You cannot mix dimensions in the same vector field expectation.

Better migration:

```text
idx:doc:v1 -> uses 768 dimension
idx:doc:v2 -> uses 1536 dimension
```

Dual write:

```text
json:doc:v1:{id}
json:doc:v2:{id}
```

Or same document with separate fields:

```json
{
  "embedding_v1": [...768...],
  "embedding_v2": [...1536...]
}
```

Then migrate query traffic:

```text
1. Create v2 index.
2. Backfill v2 embeddings.
3. Shadow query v2.
4. Compare result quality/latency.
5. Shift traffic.
6. Retire v1.
```

---

## 24. Memory Budget: The Hard Limit

JSON + Search + Vector can consume significant memory.

Budget categories:

```text
Raw key names
Raw JSON documents
Index metadata
Text inverted index
Tag index
Numeric index
Geo index
Vector index
Allocator overhead
Fragmentation
Replication overhead
Persistence fork copy-on-write headroom
```

Vector memory example:

```text
1 vector = 768 dimensions
FLOAT32 = 4 bytes per dimension
raw vector = 768 * 4 = 3072 bytes ≈ 3 KB
1 million vectors raw = ~3 GB
```

But raw vector is not total cost.

You also need:

- document data
- key overhead
- index graph/metadata
- allocator overhead
- replication memory
- reindexing headroom
- persistence fork headroom

A naive estimate:

```text
1M docs * 3 KB raw vector = 3 GB
Real operational memory may be significantly higher.
```

Therefore capacity planning should use measured data, not only theoretical math.

Recommended process:

```text
1. Load representative dataset.
2. Measure used_memory.
3. Measure index memory.
4. Run representative queries.
5. Run representative writes.
6. Measure p95/p99 latency.
7. Test failover/restart/reindex.
8. Add headroom.
```

---

## 25. Query Latency Discipline

Redis is often selected because of low latency. Search/vector queries can break that expectation if uncontrolled.

Define query budgets:

```text
Simple key lookup: very low latency expectation
JSON path fetch: low latency expectation
Search with filter: depends on cardinality
Full-text search: depends on index and result count
Vector search: depends on vector count/index/parameters
Hybrid search: depends on filter selectivity and vector index
```

Do not put all Redis operations in one latency class.

Bad SLO:

```text
Redis call must be < 5ms
```

Better SLO:

```text
GET/MGET p99 < X ms
JSON.GET p99 < Y ms
FT.SEARCH product p99 < Z ms for top 20
Vector KNN p99 < W ms for tenant under N docs
```

Also define:

- max result count
- pagination strategy
- query timeout
- fallback behavior
- circuit breaker threshold
- max query complexity

---

## 26. Pagination and Result Windows

Search pagination can become expensive when using large offsets.

Bad:

```text
page 10000 with offset 999900
```

This often forces the engine to process many results only to skip them.

Better patterns:

1. Limit deep pagination.
2. Use cursor-like continuation where supported/appropriate.
3. Use business-specific anchors.
4. Encourage filtering/refinement.
5. Cache query result IDs for short-lived sessions if justified.
6. Use Sorted Set/time index for predictable feed-like pagination.

Product search can allow pages 1-20.  
Audit search may need export pipeline.  
Operational dashboard may need time-bounded search.

Do not make Redis Search serve arbitrary infinite scrolling over huge corpora without testing.

---

## 27. Authorization and Security

Search systems create a common risk:

> You index data broadly, then forget to enforce authorization in every query.

For Redis Search/JSON/vector:

- tenant ID must be part of key and/or indexed field
- ACL-sensitive fields should be carefully modeled
- deleted/revoked access must be handled quickly
- final fetch should revalidate access for sensitive records
- avoid storing secrets in searchable documents
- avoid indexing PII unnecessarily
- define retention and deletion semantics

Bad query:

```redis
FT.SEARCH idx:case:all '@status:{OPEN}'
```

Good query:

```redis
FT.SEARCH idx:case:all '@tenantId:{t-001} @status:{OPEN}'
```

Better architecture:

```text
query layer receives authenticated principal
service resolves allowed tenant/scope
Redis query includes mandatory scope filters
result IDs are revalidated where necessary
```

For high-sensitivity data, consider not putting sensitive text into Redis full-text index at all.

---

## 28. Java Integration Strategy

For Redis JSON/Search/Vector, Java integration usually needs lower-level command support or library support beyond simple `RedisTemplate.opsForValue()`.

Options:

1. Lettuce with custom command interfaces or modules support.
2. Jedis with command support.
3. Redis OM Spring for document/search-style mapping.
4. Spring Data Redis plus lower-level command execution.
5. Direct Redis protocol command wrappers for advanced commands.

Architecture recommendation:

```text
Do not scatter FT.SEARCH strings across services.
```

Instead create repository-like boundary:

```java
public interface ProductSearchRepository {
    SearchResult<ProductCard> search(ProductSearchQuery query);
    List<ProductCard> findSimilarProducts(String tenantId, float[] embedding, int limit);
    void upsertProjection(ProductSearchDocument document);
    void deleteProjection(String tenantId, String productId);
}
```

The implementation hides:

- Redis command syntax
- schema field names
- index names
- escaping
- vector serialization
- pagination rules
- query limits
- metrics

This makes Redis Search a controlled dependency, not a stringly-typed leak across the codebase.

---

## 29. Query Object Pattern

Use explicit query objects.

```java
public record ProductSearchQuery(
        String tenantId,
        String text,
        String category,
        Boolean available,
        Long minPrice,
        Long maxPrice,
        Double minRating,
        int limit,
        String cursor
) {
    public ProductSearchQuery {
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalArgumentException("tenantId is required");
        }
        if (limit <= 0 || limit > 100) {
            throw new IllegalArgumentException("limit must be between 1 and 100");
        }
    }
}
```

Then build Redis query centrally.

Pseudo-code:

```java
public String toRedisQuery(ProductSearchQuery q) {
    List<String> clauses = new ArrayList<>();

    clauses.add("@tenantId:{" + escapeTag(q.tenantId()) + "}");

    if (q.category() != null) {
        clauses.add("@category:{" + escapeTag(q.category()) + "}");
    }

    if (q.available() != null) {
        clauses.add("@available:{" + q.available() + "}");
    }

    if (q.minPrice() != null || q.maxPrice() != null) {
        long min = q.minPrice() == null ? Long.MIN_VALUE : q.minPrice();
        long max = q.maxPrice() == null ? Long.MAX_VALUE : q.maxPrice();
        clauses.add("@price:[" + min + " " + max + "]");
    }

    if (q.text() != null && !q.text().isBlank()) {
        clauses.add(escapeText(q.text()));
    }

    return String.join(" ", clauses);
}
```

Never concatenate unescaped user input directly into Redis search query syntax.

---

## 30. Vector Serialization in Java

Vector commands often require binary representation for float arrays.

Conceptual serializer:

```java
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public final class FloatVectorCodec {
    private FloatVectorCodec() {}

    public static byte[] toLittleEndianFloat32(float[] vector) {
        ByteBuffer buffer = ByteBuffer.allocate(vector.length * Float.BYTES)
                .order(ByteOrder.LITTLE_ENDIAN);

        for (float v : vector) {
            buffer.putFloat(v);
        }

        return buffer.array();
    }
}
```

Discipline:

1. Dimension must match index schema.
2. Byte order must match expected format.
3. Normalize vectors if using cosine similarity and model requires it.
4. Store embedding model version.
5. Validate vector length before writing/querying.
6. Do not log raw vectors unnecessarily.
7. Avoid putting huge vectors in general request logs.

Example validation:

```java
public final class Embedding {
    private static final int DIMENSION = 768;

    private final float[] values;
    private final String modelVersion;

    public Embedding(float[] values, String modelVersion) {
        if (values == null || values.length != DIMENSION) {
            throw new IllegalArgumentException("Expected embedding dimension " + DIMENSION);
        }
        if (modelVersion == null || modelVersion.isBlank()) {
            throw new IllegalArgumentException("modelVersion is required");
        }
        this.values = values.clone();
        this.modelVersion = modelVersion;
    }

    public float[] values() {
        return values.clone();
    }

    public String modelVersion() {
        return modelVersion;
    }
}
```

---

## 31. Hybrid Retrieval Pattern

For AI/search systems, direct vector top-K is often not enough.

Better pattern:

```text
1. Filter by hard constraints.
2. Vector search for semantic candidates.
3. Fetch candidate documents.
4. Apply business rules.
5. Rerank.
6. Return final result.
```

Example:

```text
User: “running shoes for rainy weather”
```

Hard filters:

```text
tenantId = t-01
available = true
country = ID
category = shoes
```

Vector:

```text
semantic similarity to query embedding
```

Business rerank:

```text
stock > 0
margin rules
preferred brands
rating threshold
compliance filters
```

Final response:

```text
ranked product cards
```

This separates:

- retrieval relevance
- business eligibility
- authorization
- ranking policy

Do not overload Redis vector similarity as the entire decision engine.

---

## 32. Geospatial + Vector + Metadata Example

Use case:

```text
Find nearby service providers whose profile semantically matches the user request.
```

Requirements:

```text
- tenant-scoped
- provider active
- provider within 10 km
- provider supports requested service type
- provider profile semantically close to query
```

Possible Redis Search model:

```json
{
  "providerId": "prov-123",
  "tenantId": "t-01",
  "active": true,
  "serviceTypes": ["inspection", "repair"],
  "location": "106.8456,-6.2088",
  "profileText": "Experienced building safety inspection provider...",
  "embedding": "<binary/vector>"
}
```

Query shape:

```text
@tenantId:{t-01}
@active:{true}
@serviceTypes:{inspection}
@location:[lon lat 10 km]
=> KNN over embedding
```

But final service should still:

- validate provider availability
- check calendar/booking state
- enforce authorization
- apply scoring/ranking
- fetch authoritative current details if needed

---

## 33. Failure Modes

### 33.1 Index Stale

Source of truth updated, Redis projection not yet updated.

Symptoms:

- search shows old price
- deleted item still appears
- availability wrong

Mitigation:

- freshness SLA
- projection lag metrics
- revalidate critical fields at final action
- outbox/retry/reconciliation

### 33.2 Index Missing Documents

Projection worker failed or backfill incomplete.

Symptoms:

- item exists in DB but not searchable
- tenant has incomplete catalog

Mitigation:

- projection completeness checks
- periodic reconciliation
- rebuild tools
- event replay

### 33.3 Query Too Broad

Query matches too many docs or uses poor filters.

Symptoms:

- high latency
- CPU spike
- p99 degradation

Mitigation:

- query limits
- mandatory filters
- max result count
- query budget
- reject broad query

### 33.4 Vector Dimension Mismatch

Embedding service upgraded dimension but index expects old dimension.

Symptoms:

- query errors
- no results
- bad relevance

Mitigation:

- model versioning
- dimension validation
- dual index migration

### 33.5 Tenant Leakage

Query forgot tenant filter.

Symptoms:

- cross-tenant data in results

Mitigation:

- repository boundary
- mandatory tenant in query object
- tests
- key prefix isolation
- index per tenant for sensitive contexts

### 33.6 Memory Explosion

Documents/vectors/indexes exceed capacity.

Symptoms:

- eviction
- OOM risk
- latency spike
- failover/restart slow

Mitigation:

- memory budget
- dataset sizing
- max document size
- vector count control
- index only necessary fields

---

## 34. Testing Strategy

Test categories:

### 34.1 Schema Test

Assert index exists with expected fields.

```text
idx:product-search must include tenantId TAG, category TAG, price NUMERIC, name TEXT
```

### 34.2 Query Contract Test

Given documents:

```text
p1 category shoes available true
p2 category shoes available false
p3 category bag available true
```

Query:

```text
category=shoes available=true
```

Expect:

```text
p1 only
```

### 34.3 Tenant Isolation Test

Given same product name in two tenants, query tenant A must not return tenant B.

### 34.4 Projection Lag Test

Simulate source update and delayed Redis projection.

Assert service behavior is acceptable.

### 34.5 Deletion Test

Deleted object must disappear or be revalidated before final use.

### 34.6 Vector Dimension Test

Wrong vector dimension should fail before hitting Redis.

### 34.7 Load Test

Use representative data size and query mix.

Measure:

- p50/p95/p99 latency
- memory
- CPU
- index size
- write latency
- projection throughput

---

## 35. Operational Checklist

Before production:

```text
[ ] Is Redis source of truth or projection?
[ ] Is rebuild process documented?
[ ] Are indexes declared as code?
[ ] Are query strings centralized?
[ ] Are user inputs escaped?
[ ] Are tenant filters mandatory?
[ ] Are document size limits defined?
[ ] Are vector dimensions versioned?
[ ] Are embedding model versions tracked?
[ ] Are memory budgets measured with representative data?
[ ] Are broad queries rejected?
[ ] Are result limits enforced?
[ ] Are projection lag metrics available?
[ ] Are stale/deleted data failure modes handled?
[ ] Are sensitive fields excluded or protected?
[ ] Is failover tested?
[ ] Is backup/rebuild tested?
```

---

## 36. Design Review Questions

Use these in architecture review:

1. Why Redis Search/JSON/Vector instead of direct DB query?
2. Is Redis the system of record or projection?
3. What is the freshness SLA?
4. What happens if Redis index is stale?
5. What happens if Redis index is empty?
6. Can the index be rebuilt from authoritative data?
7. How large is each document?
8. How many documents per tenant?
9. Which fields are indexed and why?
10. What is the query cardinality distribution?
11. Are there hot tenants or hot queries?
12. What is p99 query latency target?
13. What is max acceptable memory?
14. What is vector dimension and model version?
15. How is tenant isolation enforced?
16. Are deleted/revoked records removed fast enough?
17. Are results revalidated before sensitive actions?
18. What is fallback behavior when Redis is down?
19. What is migration plan for schema changes?
20. Who owns the index schema?

---

## 37. Practical Decision Matrix

| Use Case | Redis Feature | Recommended? | Notes |
|---|---|---:|---|
| Nearby branch lookup | Native GEO | Yes | Simple and fast |
| Nearby + category + open now | Search GEO | Yes | If index cost acceptable |
| Product profile cache | String JSON | Yes | If read-mostly and whole-object access |
| Flat session fields | Hash | Yes | Avoid JSON overhead |
| Nested product document with search | JSON + Search | Yes | Good projection use case |
| Full enterprise search over huge corpus | Redis Search | Maybe | Compare with dedicated search engine |
| Semantic top-K with metadata filters | Query Engine vector | Yes | Good if data size/latency fit |
| Simple similarity set by entity ID | Vector Set | Yes | Good native primitive |
| Audit log | JSON/Search | No as sole store | Use durable log/DB |
| Complex GIS/routing | GEO | No | Use GIS/routing engine |
| Authorization-critical search | Search | Maybe | Requires strict filtering/revalidation |
| Long-term document database | JSON | Maybe | Must solve durability/backup/schema |

---

## 38. Mental Model Summary

Redis Geospatial:

```text
Fast nearby lookup over members.
```

Redis JSON:

```text
Document-shaped value with path operations.
```

Redis Search:

```text
Secondary indexes over Hash/JSON for field/text/range/geo/vector retrieval.
```

Redis Vector Search:

```text
Find semantically similar documents/items using embeddings, often with metadata filters.
```

Redis Vector Set:

```text
Native vector similarity collection, closer in spirit to Sorted Set than document search engine.
```

Architecture rule:

```text
Use Redis advanced retrieval features when low-latency derived access is worth the memory/index/operation cost.
```

Do not use them because:

```text
Redis has the command, so Redis should own the data.
```

---

## 39. Mini Lab

### Lab Goal

Build a small product search projection.

### Dataset

Create JSON documents:

```text
json:product:t-01:p-001
json:product:t-01:p-002
json:product:t-01:p-003
```

Each document:

```json
{
  "id": "p-001",
  "tenantId": "t-01",
  "name": "Trail Running Shoes",
  "category": "shoes",
  "brand": "Acme",
  "price": 899000,
  "available": true,
  "rating": 4.8,
  "tags": ["trail", "running", "outdoor"]
}
```

### Tasks

1. Store documents using JSON.
2. Create index over tenantId, category, brand, price, available, rating, name, tags.
3. Query available shoes under a price range.
4. Query full-text `running`.
5. Update price with JSON path operation.
6. Verify search result changes.
7. Delete one document.
8. Verify index result no longer includes it.
9. Add tenant t-02 document with same category.
10. Verify tenant isolation.

### Reflection

Answer:

```text
Which fields did you index?
Which query paths justify those indexes?
What is source of truth?
Can Redis projection be rebuilt?
What stale result is acceptable?
What stale result is unacceptable?
```

---

## 40. Common Anti-Patterns

### Anti-Pattern 1 — Redis JSON as Unbounded Document Dump

```text
Store every API payload forever in Redis JSON.
```

Problem:

- memory grows
- no lifecycle
- no schema
- no source-of-truth boundary

### Anti-Pattern 2 — Index Everything

```text
FT.CREATE with every possible JSON field.
```

Problem:

- memory explosion
- write amplification
- migration pain

### Anti-Pattern 3 — Search by ID

```text
FT.SEARCH index '@id:{123}'
```

when direct key lookup exists.

Problem:

- unnecessary index path
- higher overhead

### Anti-Pattern 4 — Vector Search Without Business Filters

```text
KNN top 10 -> return
```

Problem:

- wrong tenant
- unavailable item
- unauthorized item
- stale item

### Anti-Pattern 5 — Treating Similarity as Truth

Vector result means “similar”, not “correct”, “allowed”, or “authoritative”.

### Anti-Pattern 6 — No Rebuild Plan

If Redis is projection and cannot be rebuilt, it is secretly a source of truth.

### Anti-Pattern 7 — Sensitive Full-Text Index

Indexing sensitive investigation notes, PII, or confidential text without access controls can create data leakage risk.

---

## 41. Key Takeaways

1. Redis modern can do much more than key-value caching.
2. Native GEO is good for simple nearby lookup.
3. Search GEO is better for geospatial + metadata queries.
4. Redis JSON is useful for nested documents and path updates.
5. Hash remains better for many flat object use cases.
6. Search indexes improve retrieval at memory/write cost.
7. Vector search solves similarity, not correctness.
8. Vector Set is a native similarity primitive, not full document search.
9. Redis retrieval layers should often be derived projections.
10. For Java systems, hide Redis query syntax behind repository boundaries.
11. Tenant filtering, escaping, memory budget, and rebuild strategy are not optional.
12. Advanced Redis features require database-like operational discipline.

---

## 42. Referensi Resmi untuk Pendalaman

Gunakan dokumentasi resmi Redis sebagai anchor utama ketika mengecek command detail dan perubahan versi:

- Redis data types
- Redis Geospatial data type
- Redis JSON
- Redis Query Engine / Search
- Redis vector search
- Redis Vector Set
- Redis 8 release notes / what’s new
- Lettuce and Jedis client documentation
- Spring Data Redis documentation

---

## 43. Status Seri

```text
Part 019 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-020.md
```

Part berikutnya akan membahas:

```text
Persistence: RDB, AOF, Durability, Recovery
```

Fokus berikutnya sangat penting karena setelah Redis dipakai lebih dari cache, pertanyaan durability dan recovery tidak bisa lagi diabaikan.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Bitmaps, Bitfields, HyperLogLog: Compact State dan Approximation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-020.md">Part 020 — Persistence: RDB, AOF, Durability, Recovery ➡️</a>
</div>
