
# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-026.md

# Part 026 — Observability and Production Operations

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `026`  
> Fokus: observability, production operations, metrics, logs, dashboards, alerting, runbooks, dan incident taxonomy untuk Elasticsearch  
> Target pembaca: Java software engineer / tech lead yang perlu mengoperasikan Elasticsearch sebagai search platform production-grade, bukan hanya memakai query API.

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya membahas **schema evolution dan zero-downtime reindexing**. Itu adalah fondasi evolvability.

Part ini membahas fondasi berikutnya: **operability**.

Sebuah search platform production bukan hanya harus bisa:

- meng-index dokumen;
- menjalankan query;
- menghasilkan relevance bagus;
- melakukan migration.

Ia juga harus bisa dijawab ketika terjadi pertanyaan seperti:

```text
Kenapa search lambat?
Kenapa hasil search stale?
Kenapa indexing tertahan?
Kenapa cluster yellow?
Kenapa bulk request ditolak?
Kenapa JVM heap naik?
Kenapa query tertentu membuat cluster panas?
Kenapa satu tenant lambat tapi tenant lain normal?
Kenapa dashboard bilang sehat tetapi user komplain search timeout?
```

Jawaban untuk pertanyaan-pertanyaan itu tidak bisa muncul dari “feeling”. Harus ada:

- metrics;
- logs;
- traces;
- dashboards;
- alerts;
- runbooks;
- known-good baselines;
- incident taxonomy;
- ownership model.

Part ini adalah jembatan dari “Elasticsearch bisa jalan” ke “Elasticsearch bisa dioperasikan”.

---

## 1. Core Thesis

Observability Elasticsearch harus didesain berdasarkan **user journey + search pipeline + cluster internals**.

Banyak tim hanya memonitor:

```text
cluster health = green
```

Lalu merasa aman.

Itu lemah.

Cluster bisa green tetapi:

- p99 search latency tinggi;
- query tertentu timeout;
- indexing lag besar;
- autocomplete rusak;
- permission filter terlalu mahal;
- shard tertentu hot;
- JVM memory pressure tinggi;
- search queue mulai backlog;
- relevance regression terjadi;
- facet count lambat;
- bulk indexing partial failure;
- search result stale dari event lag;
- application-level zero-result rate naik.

Jadi observability harus mencakup beberapa lapisan:

```text
User experience
→ Search API
→ Query behavior
→ Elasticsearch coordinating/search/indexing path
→ Shard/node/resource behavior
→ Ingestion pipeline
→ Source-of-truth consistency
→ Operational lifecycle
```

---

## 2. Observability vs Monitoring vs Alerting

### 2.1 Monitoring

Monitoring menjawab:

```text
Apa status sistem sekarang?
```

Contoh:

- cluster health;
- CPU;
- heap;
- disk;
- indexing rate;
- search latency;
- queue size.

### 2.2 Alerting

Alerting menjawab:

```text
Kapan manusia harus peduli?
```

Contoh:

- p95 search latency > threshold;
- JVM pressure > 85% secara konsisten;
- rejected search requests meningkat;
- cluster red;
- indexing lag > SLA;
- permission check error meningkat.

### 2.3 Observability

Observability menjawab:

```text
Ketika ada gejala, bisakah kita menjelaskan penyebabnya?
```

Observability yang baik membuat engineer bisa bergerak dari:

```text
User komplain search lambat
```

ke:

```text
Query /cases/search p99 naik karena tenant-a menjalankan filter high-cardinality + sort pada field non-optimal. Query fan-out ke 120 shard, satu shard hot pada node es-hot-3, search thread pool queue meningkat, slow log menunjukkan wildcard query pada field analyzed.
```

Itu level diagnosis yang kita tuju.

---

## 3. Mental Model Operasional Elasticsearch

Elasticsearch production behavior bisa dipahami dari lima plane:

```text
1. API Plane
   Search API, indexing API, bulk API, admin API.

2. Query Execution Plane
   query phase, fetch phase, scoring, sorting, aggregation, highlighting.

3. Indexing Plane
   bulk ingestion, refresh, translog, segment creation, merge.

4. Cluster Coordination Plane
   master-eligible node, cluster state, shard allocation, relocation.

5. Resource Plane
   CPU, heap, disk, IO, network, thread pools, OS limits.
```

Incident biasanya terjadi ketika salah satu plane memberi tekanan ke plane lain.

Contoh:

```text
Aggressive bulk indexing
→ segment creation naik
→ merge pressure naik
→ disk IO naik
→ search latency naik
→ user search timeout
```

Atau:

```text
Expensive wildcard query
→ search thread pool saturated
→ queue backlog
→ rejected requests
→ API error rate naik
```

Atau:

```text
Disk watermark tercapai
→ shard allocation blocked
→ cluster yellow/red
→ indexing terganggu
```

---

## 4. Observability Harus Dimulai Dari SLO

Sebelum memilih metrics, definisikan SLO.

Contoh SLO search:

```text
Search availability:
99.9% request /cases/search berhasil dalam window bulanan.

Search latency:
p95 interactive search <= 500 ms.
p99 interactive search <= 1500 ms.

Autocomplete latency:
p95 <= 100 ms.

Freshness:
95% updates searchable <= 5 seconds.
99% updates searchable <= 60 seconds.

Indexing correctness:
bulk item failure rate <= 0.01% excluding validation errors.

Security:
0 known unauthorized search result exposure.
```

SLO ini memandu apa yang dimonitor.

Tanpa SLO, dashboard mudah berubah menjadi koleksi grafik yang tidak memberi keputusan.

---

## 5. Golden Signals Untuk Search Platform

Adaptasi golden signals untuk Elasticsearch search system:

| Signal | Search Interpretation |
|---|---|
| Latency | Search API latency, Elasticsearch took, query phase/fetch phase, indexing latency |
| Traffic | Search QPS, bulk docs/sec, query type distribution |
| Errors | API 5xx/4xx, ES rejected requests, bulk item failures, timeouts |
| Saturation | CPU, heap, disk, IO, thread pool queue, shard hotspot, merge pressure |

Tambahkan search-specific signals:

| Signal | Meaning |
|---|---|
| Zero-result rate | Banyak query tidak menemukan hasil |
| Result count distribution | Query tiba-tiba terlalu luas/sempit |
| Top query latency | Query populer jadi mahal |
| Indexing lag | Event/source update belum searchable |
| Refresh delay | Data sudah masuk tapi belum searchable |
| Relevance regression | Top result berubah buruk |
| Permission deny/drop rate | Filter permission terlalu ketat atau salah |
| Facet latency | Aggregation bottleneck |
| Highlight latency | Fetch/highlight bottleneck |

---

## 6. Observability Layer 1 — User-Facing Search API

Dari perspektif user, Elasticsearch internal tidak penting. Yang penting:

- search berhasil atau gagal;
- cepat atau lambat;
- hasilnya relevan atau tidak;
- data terlihat atau tidak;
- hasil terbaru muncul atau tidak.

Metric API minimal:

```text
search_api.request.count
search_api.request.error.count
search_api.request.duration.p50/p95/p99
search_api.elasticsearch.duration.p50/p95/p99
search_api.result.count
search_api.zero_result.count
search_api.timeout.count
search_api.validation_error.count
search_api.permission_filtered.count
search_api.page.size
search_api.query.length
search_api.query.type
```

Dimensi penting:

```text
endpoint
tenant
user_role
query_type
index_alias
schema_version
sort_mode
has_facets
has_highlight
has_autocomplete
uses_vector
uses_hybrid
```

Jangan menambahkan dimensi high-cardinality sembarangan seperti raw query string penuh sebagai metric label. Simpan raw query di log/event analytics yang sesuai, bukan label metrics.

---

## 7. Search API Latency Decomposition

Search API latency bukan hanya Elasticsearch `took`.

Pisahkan:

```text
total_api_latency
= request parsing
+ auth/session lookup
+ permission context build
+ query planning
+ Elasticsearch roundtrip
+ response mapping
+ highlighting post-processing if any
+ serialization
+ network overhead
```

Elasticsearch `took` sendiri tidak selalu sama dengan end-to-end latency karena tidak mencakup semua overhead client/network/application.

Metric yang berguna:

```text
search_api.total_ms
search_api.auth_ms
search_api.permission_context_ms
search_api.query_build_ms
search_api.es_roundtrip_ms
search_api.es_took_ms
search_api.response_map_ms
search_api.serialize_ms
```

Dengan ini, kalau user search lambat, Anda bisa tahu apakah masalahnya:

- auth service lambat;
- permission expansion lambat;
- query DSL generation berat;
- Elasticsearch lambat;
- response terlalu besar;
- JSON serialization mahal;
- network overhead;
- frontend rendering.

---

## 8. Search Request Structured Logging

Untuk setiap request search, log event ringkas.

Contoh:

```json
{
  "event": "search_request_completed",
  "endpoint": "/cases/search",
  "tenantId": "tenant-a",
  "userRole": "investigator",
  "queryType": "full_text_with_facets",
  "indexAlias": "cases-search-read",
  "schemaVersion": "v026",
  "status": "success",
  "totalMs": 342,
  "esTookMs": 211,
  "resultCount": 42,
  "pageSize": 20,
  "hasFacets": true,
  "hasHighlight": true,
  "sortMode": "relevance",
  "permissionScopesCount": 8,
  "requestId": "req-abc"
}
```

Jangan log sensitive raw query secara sembrono. Untuk domain regulatory, raw query bisa mengandung nama orang, nomor kasus, dokumen rahasia, atau istilah investigasi sensitif.

Alternatif:

```text
raw query → restricted analytics store
metrics/logs → normalized query class/hash
```

---

## 9. Observability Layer 2 — Query Behavior

Search API metrics memberi gejala. Query behavior memberi penyebab.

Track:

```text
query_type:
- exact_identifier
- full_text
- phrase
- fuzzy
- autocomplete
- faceted
- sorted
- export
- vector
- hybrid
- admin
```

Track query features:

```text
uses_wildcard
uses_prefix
uses_fuzzy
uses_script_score
uses_function_score
uses_nested
uses_aggregation
uses_highlight
uses_search_after
uses_pit
uses_post_filter
uses_large_terms_filter
```

Kenapa penting?

Karena dua request sama-sama `/cases/search`, tetapi cost-nya bisa sangat berbeda.

Contoh:

```text
Simple exact case number search:
term query on caseNumber.keyword
→ cheap

Free text + 8 facets + highlight + nested parties + recency ranking:
multi_match + aggregations + highlight + function score
→ much more expensive
```

Jika semua disatukan dalam satu metric, diagnosis buruk.

---

## 10. Query Fingerprinting

Query fingerprint adalah representasi struktur query tanpa nilai sensitif.

Contoh raw:

```json
{
  "bool": {
    "must": [
      { "multi_match": { "query": "John Doe market manipulation", "fields": ["title", "body"] }}
    ],
    "filter": [
      { "term": { "tenantId": "tenant-a" }},
      { "terms": { "visibilityScopes": ["scope1", "scope2"] }}
    ]
  }
}
```

Fingerprint:

```text
bool(must:multi_match(title,body),filter:term(tenantId)+terms(visibilityScopes))
```

Gunanya:

- mengelompokkan slow queries;
- menghindari PII;
- melihat pattern mahal;
- regression detection setelah deployment;
- ranking/query template governance.

---

## 11. Observability Layer 3 — Elasticsearch Cluster Health

Cluster health adalah sinyal dasar, bukan satu-satunya sinyal.

Status:

```text
green  = all primary and replica shards assigned
yellow = all primary assigned, some replicas unassigned
red    = at least one primary shard unassigned
```

Makna operasional:

- green: bukan berarti search sehat, hanya shard assignment lengkap.
- yellow: data primary tersedia, tetapi redundancy kurang; risiko data loss/performance degradation naik.
- red: sebagian data primary tidak tersedia; search/indexing bisa gagal.

Health check:

```http
GET /_cluster/health
```

Pantau:

```text
status
number_of_nodes
number_of_data_nodes
active_primary_shards
active_shards
relocating_shards
initializing_shards
unassigned_shards
delayed_unassigned_shards
number_of_pending_tasks
active_shards_percent_as_number
```

Alert minimal:

```text
cluster_red immediately
cluster_yellow sustained > N minutes, depending environment
unassigned_shards > 0
pending_tasks sustained high
relocating_shards stuck
```

---

## 12. Observability Layer 4 — Node Metrics

Node metrics menjawab:

```text
Node mana yang sakit?
```

Pantau per node:

```text
CPU usage
load average
heap used percent
JVM GC count/time
non-heap memory
open file descriptors
disk used percent
disk IO
network RX/TX
search thread pool active/queue/rejected
write thread pool active/queue/rejected
management/generic thread pool
indexing rate
search rate
segment memory
fielddata memory
query cache memory/hit
request cache memory/hit
breaker estimates
```

Endpoint:

```http
GET /_nodes/stats
GET /_cat/nodes?v
```

Node-level diagnosis penting karena cluster average bisa menipu.

Contoh:

```text
Cluster CPU avg 45%
Node es-hot-3 CPU 98%
User search timeout karena shard hot di es-hot-3
```

---

## 13. JVM Memory and GC

Elasticsearch berjalan di JVM, jadi heap pressure krusial.

Pantau:

```text
jvm.mem.heap_used_percent
jvm.gc.collectors.young.collection_count
jvm.gc.collectors.young.collection_time
jvm.gc.collectors.old.collection_count
jvm.gc.collectors.old.collection_time
breakers.parent.estimated_size
breakers.fielddata.estimated_size
breakers.request.estimated_size
```

Gejala heap pressure:

- latency naik;
- GC pause meningkat;
- circuit breaker error;
- node tidak responsif;
- search/indexing rejected;
- cluster instability.

Elastic menyebut high JVM memory pressure dapat menurunkan performa dan memicu circuit breaker, dan merekomendasikan tindakan jika JVM memory usage secara konsisten melebihi 85%. Ini angka penting sebagai trigger investigasi, bukan satu-satunya rule mutlak.

Penyebab umum:

- aggregations berat;
- fielddata pada text field;
- high-cardinality facets;
- huge query result;
- too many shards;
- large cluster state;
- mapping explosion;
- large terms query;
- script/ranking heavy;
- caches terlalu besar;
- segment count tinggi.

---

## 14. Disk Metrics and Watermark Awareness

Disk bukan hanya kapasitas storage. Disk memengaruhi:

- indexing throughput;
- merge performance;
- shard relocation;
- snapshot/restore;
- cluster allocation;
- search latency;
- recovery time.

Pantau:

```text
disk.used_percent
disk.free_bytes
disk.io.utilization
disk.read/write latency
merge.current
merge.total_throttled_time
translog.size
store.size
```

Elasticsearch punya disk watermark behavior. Jika disk terlalu penuh, shard allocation bisa dibatasi. Ini dapat menyebabkan cluster yellow/red atau mencegah shard relocation.

Alert:

```text
disk usage > 75% warning
disk usage > 85% high
disk usage > 90% critical
flood stage risk
```

Threshold aktual harus disesuaikan dengan ukuran disk dan operational policy. Disk 90% pada disk 10TB masih menyisakan 1TB, tetapi merge/relocation tetap butuh headroom.

---

## 15. Thread Pools and Queues

Elasticsearch menggunakan thread pools untuk mengelola eksekusi dan memori. Thread pool penting meliputi search, write, get, management, generic, dan lainnya.

Pantau:

```text
thread_pool.search.active
thread_pool.search.queue
thread_pool.search.rejected
thread_pool.write.active
thread_pool.write.queue
thread_pool.write.rejected
thread_pool.management.queue
thread_pool.generic.queue
```

Endpoint:

```http
GET /_cat/thread_pool?v
GET /_nodes/stats/thread_pool
```

Interpretasi:

```text
queue naik sementara:
  mungkin spike normal.

queue sustained:
  node tidak mampu mengikuti workload.

rejected naik:
  requests sudah ditolak; user/API akan melihat error atau retry.

active tinggi + CPU tinggi:
  node busy compute.

active tinggi + IO tinggi:
  mungkin disk bottleneck.

queue tinggi di satu node:
  hot shard atau uneven routing.
```

Elastic troubleshooting untuk task queue backlog menyarankan memeriksa thread pool status, hot threads, long-running tasks, cluster tasks, dan slow logs.

---

## 16. Rejected Requests

Rejected requests adalah sinyal kuat bahwa kapasitas atau workload sudah melewati batas.

Jenis rejection:

```text
search rejection
write rejection
bulk rejection
coordination rejection
```

Jangan hanya retry membabi buta. Retry agresif bisa memperburuk overload.

Diagnosis:

1. Rejection terjadi di thread pool apa?
2. Node mana?
3. Query/index pattern apa?
4. Apakah ada hot shard?
5. Apakah traffic spike?
6. Apakah deployment baru?
7. Apakah backfill/reindex sedang berjalan?
8. Apakah queue backlog sustained?
9. Apakah CPU/IO/heap tinggi?

Mitigasi:

- throttle client;
- reduce bulk concurrency;
- reduce query cost;
- route heavy exports away;
- increase capacity;
- fix shard distribution;
- isolate workload;
- add backpressure at application layer.

---

## 17. Hot Threads

Hot threads membantu melihat operasi yang mengonsumsi CPU.

Endpoint:

```http
GET /_nodes/hot_threads
```

Gunakan ketika:

- CPU tinggi;
- search latency tinggi;
- queue backlog;
- indexing lambat;
- node tampak stuck;
- ingin membedakan CPU-bound vs waiting.

Interpretasi harus hati-hati. Hot threads adalah snapshot. Ambil beberapa kali sebelum kesimpulan.

Contoh sinyal:

```text
- banyak waktu di regex/wildcard query
- script scoring mahal
- segment merge
- garbage collection
- aggregation collection
- compression/decompression
```

---

## 18. Slow Logs

Slow logs adalah salah satu alat diagnosis paling berguna untuk Elasticsearch.

Ada dua jenis:

```text
search slow log
indexing slow log
```

Elastic mendokumentasikan slow log sebagai mekanisme untuk mencatat operasi search atau indexing yang melebihi threshold yang didefinisikan, dan default threshold slow log adalah disabled (`-1`) sampai diaktifkan.

Gunakan slow logs untuk:

- menemukan query mahal;
- menemukan indexing bottleneck;
- audit operasi berat;
- melihat pattern slow query historis;
- memverifikasi dampak deployment;
- mengelompokkan expensive query by index/query type.

Contoh setting konseptual:

```json
PUT /cases-search-v001/_settings
{
  "index.search.slowlog.threshold.query.warn": "2s",
  "index.search.slowlog.threshold.query.info": "1s",
  "index.search.slowlog.threshold.fetch.warn": "1s",
  "index.indexing.slowlog.threshold.index.warn": "1s"
}
```

Jangan set terlalu rendah di production tanpa volume planning. Slow logs sendiri bisa menghasilkan log noise besar.

---

## 19. Query Phase vs Fetch Phase

Slow log search biasanya membedakan query phase dan fetch phase.

Query phase mahal jika:

- matching/scoring mahal;
- wildcard/fuzzy/regexp berat;
- aggregation mahal;
- sorting mahal;
- nested query mahal;
- script_score mahal;
- banyak shard.

Fetch phase mahal jika:

- `_source` besar;
- highlight mahal;
- stored fields/docvalue_fields banyak;
- banyak result returned;
- network payload besar;
- decompression cost tinggi.

Diagnosis:

```text
query phase slow → optimize query/mapping/shards/scoring/aggs
fetch phase slow → optimize source filtering/highlight/page size/document size
```

---

## 20. Index Stats

Index metrics menjawab:

```text
Index mana yang mahal?
```

Endpoint:

```http
GET /_stats
GET /cases-search-read/_stats
GET /_cat/indices?v
```

Pantau per index:

```text
docs.count
docs.deleted
store.size
indexing.index_total
indexing.index_time
indexing.index_failed
search.query_total
search.query_time
search.fetch_total
search.fetch_time
refresh.total
refresh.total_time
merges.current
merges.total_time
segments.count
segments.memory
fielddata.memory
query_cache.hit_count/miss_count
request_cache.hit_count/miss_count
```

Interpretasi:

- `docs.deleted` tinggi bisa menunjukkan update/delete churn dan segment belum merge.
- `segments.count` tinggi bisa menyebabkan overhead search.
- `refresh.total_time` tinggi bisa terkait refresh pressure.
- `merge.total_throttled_time` tinggi bisa menunjukkan merge bottleneck.
- `fielddata.memory` tinggi sering tanda field usage bermasalah.

---

## 21. Segment Metrics

Segment adalah unit penting dari Lucene.

Pantau:

```text
segments.count
segments.memory
segments.terms_memory
segments.stored_fields_memory
segments.term_vectors_memory
segments.norms_memory
segments.points_memory
segments.doc_values_memory
```

Gejala:

```text
segments.count tinggi:
  banyak small segments, search overhead naik.

merge pressure tinggi:
  indexing/updates membuat banyak segment; disk IO naik.

docs.deleted tinggi:
  update/delete churn; old docs menunggu merge.
```

Jangan force merge sembarangan di hot index yang masih menerima writes. Force merge cocok untuk read-only/cold historical index dalam konteks lifecycle tertentu.

---

## 22. Refresh Metrics

Refresh membuat document yang sudah di-index menjadi visible untuk search.

Pantau:

```text
refresh.total
refresh.total_time
refresh.external_total
refresh.listeners
```

Operational questions:

- Apakah refresh interval terlalu agresif?
- Apakah user membutuhkan read-after-write?
- Apakah indexing throughput turun karena refresh terlalu sering?
- Apakah `refresh=wait_for` menumpuk listener?
- Apakah freshness SLA terpenuhi?

Aplikasi harus memonitor indexing-to-searchable lag, bukan hanya refresh metric internal.

---

## 23. Merge Metrics

Merge menggabungkan segment kecil menjadi lebih besar dan membersihkan deleted docs.

Pantau:

```text
merges.current
merges.current_docs
merges.current_size
merges.total
merges.total_time
merges.total_throttled_time
```

Merge pressure tinggi bisa menyebabkan:

- indexing melambat;
- search latency naik;
- disk IO tinggi;
- CPU naik;
- backlog write.

Penyebab:

- bulk indexing terlalu agresif;
- refresh interval terlalu pendek;
- high update/delete workload;
- too many shards;
- disk lambat;
- n-gram/analyzer menghasilkan index besar.

---

## 24. Cache Metrics

Elasticsearch punya beberapa cache relevan:

```text
query cache
request cache
fielddata cache
filesystem/page cache
```

Pantau:

```text
query_cache.memory_size
query_cache.hit_count
query_cache.miss_count
query_cache.evictions

request_cache.memory_size
request_cache.hit_count
request_cache.miss_count
request_cache.evictions

fielddata.memory_size
fielddata.evictions
```

Interpretasi:

- Query cache efektif untuk repeated filter context.
- Request cache bisa berguna untuk repeated aggregation/search result tertentu.
- Fielddata tinggi bisa berbahaya, terutama jika text field dipakai sorting/aggs tanpa keyword/doc_values strategy.
- Filesystem cache tidak selalu muncul sebagai Elasticsearch metric langsung, tetapi sangat penting untuk performance.

Jangan mengejar cache hit ratio secara buta. Query interaktif user sering bervariasi sehingga cache hit rendah bisa normal.

---

## 25. Circuit Breakers

Circuit breaker mencegah operasi memakai memori terlalu besar.

Pantau:

```text
breakers.parent.tripped
breakers.request.tripped
breakers.fielddata.tripped
breakers.in_flight_requests.tripped
```

Circuit breaker error berarti query/index operation terlalu mahal atau cluster memory pressure tinggi.

Common causes:

- large aggregation;
- huge terms query;
- fielddata explosion;
- too large response;
- large bulk request;
- many concurrent heavy requests.

Mitigasi:

- limit request size;
- validate query complexity;
- cap aggregation size;
- use composite agg for pagination;
- reduce page size;
- use keyword/doc_values field correctly;
- add application-level quotas.

---

## 26. Ingestion Pipeline Observability

Search freshness sering gagal bukan di Elasticsearch, tetapi di pipeline sebelum Elasticsearch.

Pipeline umum:

```text
source DB
→ outbox/event stream
→ indexer service
→ bulk API
→ refresh
→ searchable
```

Pantau:

```text
source_change_timestamp
event_published_timestamp
event_consumed_timestamp
bulk_sent_timestamp
bulk_ack_timestamp
search_visible_timestamp
```

Derived metrics:

```text
event_lag_ms
indexer_lag_ms
bulk_latency_ms
bulk_failure_rate
refresh_visibility_lag_ms
end_to_end_freshness_ms
```

Untuk user, freshness yang penting:

```text
Waktu dari domain update sampai update muncul di search.
```

Bukan hanya:

```text
Bulk request succeeded.
```

---

## 27. Bulk Indexer Metrics

Untuk Java indexing service:

```text
bulk.batch.size.docs
bulk.batch.size.bytes
bulk.request.duration
bulk.item.success.count
bulk.item.failure.count
bulk.retry.count
bulk.dlq.count
bulk.rejected.count
bulk.mapper_error.count
bulk.version_conflict.count
bulk.timeout.count
bulk.inflight.count
bulk.queue.size
```

Dimensi:

```text
index_alias
physical_index
document_type
tenant
failure_type
```

Bulk API bisa partial success. Observability harus item-level, bukan hanya request-level.

---

## 28. Dead Letter Queue

DLQ bukan tempat sampah permanen. DLQ adalah sinyal data/indexing contract rusak.

Track:

```text
dlq.size
dlq.new_items_rate
dlq.oldest_age
dlq.by_failure_type
dlq.by_document_type
dlq.reprocessed_count
dlq.reprocess_success
dlq.reprocess_failure
```

Alert:

```text
DLQ new item > 0 for permission/security field
DLQ oldest age > SLA
DLQ growth sustained
mapper_parsing_exception spike
```

For regulatory systems, DLQ can mean some cases are not searchable. That can be operationally serious.

---

## 29. Source-of-Truth Reconciliation Metrics

If Elasticsearch is derived from canonical DB, monitor drift.

Periodic reconciliation:

```text
sample DB cases
→ build expected search doc hash
→ fetch ES doc
→ compare fields/hash/version
```

Metrics:

```text
reconciliation.sample.count
reconciliation.mismatch.count
reconciliation.missing_in_es.count
reconciliation.extra_in_es.count
reconciliation.permission_mismatch.count
reconciliation.stale_version.count
```

This catches:

- missed events;
- failed deletes;
- projection bug;
- backfill gaps;
- dual-write divergence;
- stale permission fields.

---

## 30. Permission-Aware Search Observability

Permission problems are high severity.

Track:

```text
permission_context_build_ms
permission_scope_count
permission_filter_applied
permission_filter_missing_count
permission_filtered_result_count
security_denied_result_count
facet_security_mode
source_filtering_mode
```

Security audit sample:

```text
For sampled searches:
- user principal
- tenant
- query class
- permission scope count
- total hits before permission if safely measurable in non-prod/shadow
- total hits after permission
- sensitive field exposure flag
```

Never log sensitive full result sets in general logs.

Alert on:

```text
permission_filter_missing_count > 0
tenant_filter_missing_count > 0
unexpected cross-tenant hit
security field missing in indexed docs
```

---

## 31. Facet and Aggregation Observability

Facets often become hidden bottleneck.

Track:

```text
has_facets
facet_count
aggregation_count
aggregation_type
aggregation_duration_estimate
result_total_relation
facet_bucket_count
high_cardinality_facet
```

Common expensive facets:

- high-cardinality keyword fields;
- nested aggregations;
- date histograms with tiny intervals;
- large terms aggregation size;
- cardinality aggregation on huge data;
- aggregations combined with broad query.

Operational guardrail:

```text
Facet schema should be allowlisted.
User should not freely aggregate arbitrary fields in public search endpoint.
```

---

## 32. Highlight Observability

Highlight can move bottleneck to fetch phase.

Track:

```text
has_highlight
highlight_fields_count
highlight_fragment_size
highlight_number_of_fragments
fetch_phase_ms
source_size_bytes
```

Issues:

- large body fields;
- many highlight fields;
- large page size;
- highlighter choice;
- `_source` decompression;
- memory pressure.

Guardrails:

- highlight only fields needed by UX;
- cap fragment size;
- cap page size;
- avoid highlighting huge binary-derived content blindly;
- consider separate snippet field.

---

## 33. Autocomplete Observability

Autocomplete has stricter latency expectation than full search.

Track separately:

```text
autocomplete.request.count
autocomplete.duration.p95/p99
autocomplete.zero_suggestion_rate
autocomplete.prefix_length
autocomplete.result_count
autocomplete.index_alias
autocomplete.timeout.count
```

Common issues:

- prefix too short;
- n-gram field too large;
- completion suggester memory behavior;
- suggestions leak restricted data;
- autocomplete uses different permission logic from main search;
- frontend sends request per keystroke without debounce.

Guardrails:

- minimum prefix length;
- debounce;
- rate limit;
- permission-aware suggestions;
- separate SLO.

---

## 34. Export/Search-All Observability

Export workloads should not silently share same path as interactive search.

Track:

```text
export.request.count
export.duration
export.rows
export.search_after_pages
export.pit_duration
export.failure.count
```

Operational rule:

```text
Interactive search and export are different workloads.
```

Exports can:

- hold PIT longer;
- page through many docs;
- stress fetch phase;
- create large network payload;
- compete with user search;
- bypass normal page limits if poorly designed.

Consider:

- async export job;
- separate rate limits;
- separate queue;
- separate user permission validation;
- dedicated worker.

---

## 35. Dashboard Design

A good Elasticsearch dashboard should answer questions in layers.

### 35.1 Executive / SLO Dashboard

Shows:

```text
Search availability
Search p95/p99 latency
Autocomplete p95/p99 latency
Indexing freshness
Error rate
Zero-result rate
Current incident flags
```

Audience:

- product;
- engineering manager;
- on-call lead.

### 35.2 Search API Dashboard

Shows:

```text
Request rate by endpoint/query type
Latency by endpoint/query type
Error by status/failure type
Result count distribution
Zero-result rate
Facet/highlight usage
Tenant/user-role breakdown
```

Audience:

- backend/search engineers.

### 35.3 Elasticsearch Cluster Dashboard

Shows:

```text
Cluster health
Node CPU/heap/disk
Thread pools
Rejected requests
Shard allocation
Search/indexing rate
Cache/circuit breakers
Slow log counts
```

Audience:

- platform/search/on-call.

### 35.4 Ingestion Dashboard

Shows:

```text
Event lag
Bulk throughput
Bulk item failures
DLQ
Backfill/replay status
Freshness lag
Reconciliation mismatch
```

Audience:

- backend/search/data pipeline team.

### 35.5 Relevance Dashboard

Shows:

```text
Top queries
Zero-result queries
Clicked/no-click queries if available
Golden query pass rate
Query reformulation rate
Top-K regression after deploy
```

Audience:

- search/product/domain experts.

---

## 36. Alerting Philosophy

Bad alert:

```text
CPU > 80% for 1 minute
```

Maybe noisy.

Better alert:

```text
p95 search latency > SLO for 10 minutes
AND search QPS normal/high
AND error rate increasing
```

Or:

```text
search thread pool rejected > 0 for 5 minutes
```

Or:

```text
cluster red immediately
```

Alert should be:

- actionable;
- routed to owner;
- have severity;
- have runbook link;
- avoid duplicate pages for same incident;
- distinguish warning vs page.

---

## 37. Suggested Alerts

### 37.1 Critical

```text
Cluster red
Unauthorized search result suspected
Tenant filter missing in production query
Write alias missing or points to unexpected index
Read alias missing
Search API 5xx above threshold
p99 search latency severe sustained
Bulk item failures for permission fields
Disk flood-stage risk
JVM pressure severe sustained
```

### 37.2 High

```text
Cluster yellow sustained
Search rejected requests > 0 sustained
Write rejected requests > 0 sustained
Indexing lag > freshness SLA
DLQ growing
p95 search latency above SLO
Autocomplete latency above SLO
Unassigned shards > 0
```

### 37.3 Medium

```text
Zero-result rate anomalous
Slow log volume spike
Query cache evictions spike
Segment count unusually high
Merge throttling sustained
Heap > 85% sustained
Disk usage high watermark approaching
```

### 37.4 Low / Ticket

```text
Old index still present after decommission date
Deprecated field still queried
Feature flag not removed
Relevance golden query minor regression
Index template drift detected
```

---

## 38. Runbook Structure

Every alert should link to runbook.

Runbook template:

```markdown
# Alert: Search rejected requests sustained

## Meaning
Search thread pool is rejecting requests. Users may see timeouts/errors.

## Impact
Interactive search degraded.

## First Checks
1. Check affected nodes.
2. Check search thread pool queue/rejected.
3. Check CPU/heap/disk.
4. Check slow logs.
5. Check top query types.
6. Check recent deployments/backfills.

## Diagnosis Branches
- If one node affected → hot shard or uneven routing.
- If all nodes affected → traffic spike or expensive query rollout.
- If heap high → aggregation/fielddata/circuit breaker.
- If IO high → merge/snapshot/disk issue.

## Mitigation
- throttle heavy clients;
- disable expensive query feature flag;
- reduce export concurrency;
- pause backfill;
- add capacity;
- reroute hot shard if appropriate.

## Escalation
Search platform owner + infra on-call.

## Post-Incident
Add query guardrail or capacity fix.
```

---

## 39. Incident Taxonomy

Classify incidents so patterns become visible.

### 39.1 Search Latency Incident

Symptoms:

- p95/p99 latency high;
- user complaints;
- slow logs increase.

Possible causes:

- expensive query;
- shard fan-out;
- hot shard;
- heap pressure;
- disk IO/merge;
- large fetch/highlight;
- coordinator bottleneck.

### 39.2 Indexing Lag Incident

Symptoms:

- updates not visible;
- freshness SLA breach;
- event lag;
- bulk failures.

Possible causes:

- indexer down;
- event consumer lag;
- bulk rejections;
- mapping error;
- refresh issue;
- source DB slow;
- merge pressure.

### 39.3 Cluster Health Incident

Symptoms:

- yellow/red;
- unassigned shards;
- pending tasks;
- relocation stuck.

Possible causes:

- node lost;
- disk watermark;
- allocation awareness;
- replica impossible;
- corrupt shard;
- master pressure.

### 39.4 Resource Saturation Incident

Symptoms:

- CPU/heap/disk/IO high;
- thread pool backlog;
- rejected requests.

Possible causes:

- traffic spike;
- query explosion;
- indexing storm;
- merge pressure;
- too many shards;
- high-cardinality aggregation.

### 39.5 Data Correctness Incident

Symptoms:

- missing documents;
- stale docs;
- deleted docs visible;
- wrong status;
- wrong facet count.

Possible causes:

- missed events;
- failed bulk items;
- projection bug;
- dual-write divergence;
- reindex gap;
- source-of-truth mismatch.

### 39.6 Security / Permission Incident

Symptoms:

- unauthorized result;
- cross-tenant data;
- facet count leak;
- highlight leak.

Possible causes:

- missing filter;
- wrong alias;
- stale permission field;
- query builder bug;
- cache contamination;
- index contains sensitive field unexpectedly.

### 39.7 Relevance Incident

Symptoms:

- exact match not top;
- important docs hidden;
- noisy results;
- zero-result spike.

Possible causes:

- analyzer change;
- synonym change;
- ranking weight deployment;
- mapping bug;
- query DSL regression;
- stale ranking signal.

---

## 40. First 10 Minutes of an Incident

When incident starts, avoid random debugging.

Use sequence:

```text
1. Confirm user impact.
2. Identify affected endpoint/search surface.
3. Check if cluster health red/yellow.
4. Check API latency/error dashboard.
5. Check ES rejected requests/thread pool.
6. Check CPU/heap/disk by node.
7. Check recent deploy/migration/backfill.
8. Check slow logs/top query fingerprints.
9. Decide mitigation: rollback, throttle, disable feature, pause job.
10. Start incident log.
```

Do not spend 30 minutes optimizing query while cluster is red due to disk watermark. Triage first.

---

## 41. Search Latency Diagnosis Tree

```text
Search latency high
|
+-- API total high but ES took normal?
|   +-- auth slow
|   +-- permission expansion slow
|   +-- response serialization large
|   +-- network/client issue
|
+-- ES took high?
    |
    +-- query phase high?
    |   +-- expensive query
    |   +-- broad query + aggs
    |   +-- sort expensive
    |   +-- shard fan-out
    |   +-- hot shard
    |
    +-- fetch phase high?
    |   +-- large _source
    |   +-- highlight
    |   +-- page size too large
    |   +-- stored fields/docvalue fields
    |
    +-- only one node high?
    |   +-- hot shard
    |   +-- uneven routing
    |   +-- node resource issue
    |
    +-- all nodes high?
        +-- traffic spike
        +-- deployment query regression
        +-- indexing/merge pressure
        +-- capacity issue
```

---

## 42. Indexing Lag Diagnosis Tree

```text
Freshness lag high
|
+-- Events not produced?
|   +-- source/outbox issue
|
+-- Events produced but not consumed?
|   +-- consumer lag
|   +-- indexer down
|   +-- poison message
|
+-- Bulk sent but failing?
|   +-- mapper parsing
|   +-- rejected requests
|   +-- version conflict
|   +-- auth/index alias issue
|
+-- Bulk succeeds but not visible?
|   +-- refresh interval
|   +-- refresh=wait_for listeners
|   +-- querying wrong alias
|
+-- ES overloaded?
    +-- write queue
    +-- merge pressure
    +-- disk IO
    +-- heap/circuit breaker
```

---

## 43. Cluster Health Diagnosis Tree

```text
Cluster yellow/red
|
+-- unassigned primary?
|   +-- red, high severity
|
+-- unassigned replica?
|   +-- yellow, redundancy/perf risk
|
+-- node missing?
|   +-- infra/network/node crash
|
+-- disk watermark?
|   +-- free disk or add node
|
+-- allocation disabled?
|   +-- check cluster settings
|
+-- awareness/zone constraint?
|   +-- insufficient nodes in zone
|
+-- shard too large?
|   +-- relocation/recovery slow
|
+-- pending tasks high?
    +-- master pressure/cluster state issue
```

---

## 44. Operational Guardrails in Java Search API

Do not rely only on Elasticsearch to protect itself. Application should enforce guardrails.

Examples:

```text
max page size
max number of facets
allowed facet fields
allowed sort fields
minimum autocomplete prefix length
wildcard disabled or restricted
regexp disabled for normal users
max permission scopes
query timeout
search_after required beyond shallow page
export routed to async job
```

Java validation example:

```java
public void validate(SearchRequestDto request) {
    if (request.pageSize() > 100) {
        throw new BadRequestException("pageSize too large");
    }

    if (request.facets().size() > 10) {
        throw new BadRequestException("too many facets");
    }

    for (String facet : request.facets()) {
        if (!allowedFacetFields.contains(facet)) {
            throw new BadRequestException("facet not allowed: " + facet);
        }
    }

    if (request.query().contains("*") && !request.user().canUseWildcard()) {
        throw new BadRequestException("wildcard search not allowed");
    }
}
```

Guardrails reduce incident probability.

---

## 45. Timeout Strategy

Set timeouts intentionally.

Layers:

```text
frontend timeout
API gateway timeout
Java service timeout
Elasticsearch client request timeout
Elasticsearch search timeout
circuit breaker/bulk timeout
```

Bad:

```text
Every layer has random default timeout.
```

Better:

```text
frontend: 5s
API gateway: 6s
Java service: 4.5s internal deadline
ES request: 3s
ES query timeout: 2.5s
```

Principle:

```text
Inner timeout should fire before outer timeout.
```

Otherwise threads/resources remain busy after caller already gave up.

---

## 46. Backpressure Strategy

When Elasticsearch is overloaded, application should not amplify the overload.

Backpressure patterns:

- limit concurrent searches per user/tenant;
- limit export jobs;
- queue indexing with bounded queue;
- throttle bulk indexer on rejection;
- fail fast for expensive query features;
- degrade optional features;
- disable highlight/facets temporarily;
- use cached fallback for autocomplete if acceptable.

Avoid:

```text
Retry immediately with no jitter.
```

Use:

```text
exponential backoff + jitter + max retry budget
```

---

## 47. Graceful Degradation

Search can degrade in layers.

Examples:

```text
Normal:
full text + facets + highlight + ranking + suggestions

Degraded level 1:
disable highlight

Degraded level 2:
disable expensive facets

Degraded level 3:
exact identifier search only + basic filters

Degraded level 4:
read-only maintenance mode / cached recent results
```

For regulatory systems, degradation must preserve security. Never degrade by removing permission filter.

---

## 48. Operational Readiness Checklist

Before launching Elasticsearch-backed feature:

```text
[ ] SLO defined
[ ] API metrics implemented
[ ] ES metrics dashboard exists
[ ] ingestion lag dashboard exists
[ ] slow logs configured appropriately
[ ] bulk item failures monitored
[ ] DLQ monitored
[ ] permission filter metrics implemented
[ ] query guardrails enforced
[ ] timeout budget defined
[ ] alert runbooks written
[ ] rollback plan exists
[ ] load test completed
[ ] relevance golden queries exist
[ ] index alias verified
[ ] backup/snapshot strategy known
[ ] on-call owner defined
```

---

## 49. Production Dashboard Checklist

```text
[ ] Search latency p50/p95/p99
[ ] Search error rate
[ ] Search QPS
[ ] Zero-result rate
[ ] Result count distribution
[ ] Top query fingerprints by latency
[ ] Autocomplete latency
[ ] Facet/highlight usage
[ ] ES cluster health
[ ] Node CPU/heap/disk
[ ] JVM GC
[ ] Search/write thread pool queue/rejected
[ ] Indexing rate
[ ] Bulk failure rate
[ ] Refresh/merge metrics
[ ] Segment count
[ ] Cache/circuit breaker metrics
[ ] Indexing freshness lag
[ ] DLQ size/age
[ ] Reconciliation mismatch
[ ] Slow log count
```

---

## 50. Useful Elasticsearch APIs For Operations

Cluster:

```http
GET /_cluster/health
GET /_cluster/stats
GET /_cluster/pending_tasks
GET /_cluster/allocation/explain
```

Nodes:

```http
GET /_nodes/stats
GET /_nodes/hot_threads
GET /_cat/nodes?v
GET /_cat/thread_pool?v
```

Indices:

```http
GET /_cat/indices?v
GET /_cat/shards?v
GET /_stats
GET /{index}/_stats
GET /{index}/_segments
GET /{index}/_settings
GET /{index}/_mapping
```

Tasks:

```http
GET /_tasks
GET /_tasks?detailed=true&actions=*
```

Search diagnosis:

```http
GET /{index}/_search
GET /{index}/_search?profile=true
GET /{index}/_explain/{id}
```

Remember: APIs are tools. The real skill is knowing which question each API answers.

---

## 51. Multi-Tenant Observability

If one cluster serves many tenants, aggregate metrics can hide tenant-specific incidents.

Track:

```text
tenant search QPS
tenant latency
tenant error rate
tenant result count distribution
tenant indexing lag
tenant document count
tenant storage usage
tenant expensive query count
tenant rejected/throttled count
```

But keep label cardinality controlled. For very many tenants:

- track top-N tenants;
- sample long-tail;
- use logs for high-cardinality exploration;
- separate noisy tenants if necessary.

Tenant incident examples:

```text
Tenant A bulk import causes merge pressure affecting Tenant B.
Tenant B runs wildcard-heavy queries affecting shared cluster.
Tenant C has huge permission scope list causing slow filters.
```

Noisy-neighbor control matters.

---

## 52. Regulatory / Case Management Observability

For enforcement/case systems, add domain-specific metrics:

```text
case_search.exact_case_number.success_rate
case_search.active_case_not_found.count
case_search.permission_denied.count
case_search.legal_hold_filter_applied.count
case_search.sensitive_field_returned.count
case_search.lifecycle_status_mismatch.count
case_search.escalation_queue_search_latency
case_search.audit_search_latency
case_search.cross_entity_search_latency
```

Operationally important questions:

```text
Can investigator find active cases?
Can auditor search historical decisions?
Are legal-hold documents searchable only by allowed roles?
Are closed/superseded statuses shown correctly?
Are escalation/SLA fields fresh?
```

This is where generic Elasticsearch metrics are not enough.

---

## 53. Post-Incident Review Template

```markdown
# Incident Review: Search Latency Spike

## Summary
What happened?

## Impact
Who was affected? Which endpoints? Which tenants? Duration?

## Timeline
Detection, mitigation, recovery.

## Detection
Which alert fired? Was it timely?

## Root Cause
Technical root cause and contributing factors.

## What Went Well
Useful dashboards, logs, runbooks.

## What Went Poorly
Missing metrics, noisy alerts, unclear owner.

## Corrective Actions
- Query guardrail
- Dashboard improvement
- Capacity change
- Runbook update
- Test addition
- Alert tuning

## Regression Prevention
How do we make this class of incident less likely?
```

Postmortem output should feed back into:

- query design;
- mapping design;
- capacity planning;
- guardrails;
- tests;
- runbooks.

---

## 54. Common Operational Anti-Patterns

### 54.1 Only Monitoring Cluster Green

Green cluster does not mean good search UX.

### 54.2 No App-Level Search Metrics

Without API metrics, you cannot distinguish ES problem from application problem.

### 54.3 No Slow Logs Until Incident

Enable controlled slow logs before you need them.

### 54.4 Logging Raw Sensitive Queries Everywhere

Dangerous in regulated systems.

### 54.5 Bulk Request Success Count Only

Bulk can partially fail. Track item-level failures.

### 54.6 No Freshness Metric

Users care when updates become searchable.

### 54.7 No Permission Observability

Security failures are often invisible until reported.

### 54.8 One Dashboard For Everything

Different audiences need different dashboards.

### 54.9 Alerts Without Runbooks

A page without next action creates panic.

### 54.10 Retrying Overload

Retries can turn overload into outage.

---

## 55. Practical Baseline Values

Baseline depends on workload, but useful starting questions:

```text
Interactive search p95:
  What is acceptable for user flow?

Autocomplete p95:
  Is it under 100–200ms?

Indexing freshness:
  Is it seconds, minutes, or batch?

Bulk failure:
  Is any mapper error acceptable?

DLQ age:
  How long can a document remain unsearchable?

Cluster health yellow:
  Is it acceptable in dev only, or production warning?

Heap > 85%:
  Is it sustained or spike?

Search rejected:
  Usually should be zero in healthy steady state.

Zero-result rate:
  What is normal for your domain?
```

Do not copy thresholds blindly. Establish baselines under normal load and tune from there.

---

## 56. End-to-End Example: Search Slow Incident

Symptom:

```text
/cases/search p99 latency jumps from 800ms to 5s.
```

Investigation:

1. API dashboard shows only requests with facets are slow.
2. ES `took` also high, so not app-only issue.
3. Slow logs show `terms` aggregation on `partyName.keyword`.
4. Cardinality of `partyName.keyword` very high.
5. New frontend release enabled party name facet by default.
6. Heap pressure and request breaker near limit.
7. Search thread pool queue rising.

Mitigation:

```text
Disable partyName facet feature flag.
Clear stuck traffic.
Monitor latency recovery.
```

Permanent fix:

```text
Do not allow high-cardinality partyName as default facet.
Add facet allowlist review.
Add dashboard for facet latency by field.
Add load test for new facets.
```

Lesson:

> Feature-level observability matters. “Elasticsearch slow” was actually “new high-cardinality facet enabled by default.”

---

## 57. End-to-End Example: Stale Search Incident

Symptom:

```text
Case status updated to CLOSED, but search still shows OPEN.
```

Investigation:

1. Source DB updated.
2. Outbox event exists.
3. Consumer lag high.
4. Indexer logs show repeated mapper parsing error for new field.
5. Bulk request returns partial failures.
6. Application only monitored bulk request status, not item failures.
7. Failed item went to DLQ but no alert.

Mitigation:

```text
Fix mapping/projection bug.
Reprocess DLQ.
Run reconciliation for affected cases.
```

Permanent fix:

```text
Item-level bulk failure metric.
DLQ age alert.
Mapping contract test.
Reconciliation job.
```

Lesson:

> Bulk request-level success is not correctness.

---

## 58. End-to-End Example: Security Leak Near-Miss

Symptom:

```text
Internal audit finds restricted case count visible in facet.
```

Investigation:

1. Hits are permission-filtered correctly.
2. Aggregations computed before post-filter in endpoint variant.
3. Facet counts include documents user cannot view.
4. UI did not show documents, but count leaks restricted category existence.

Mitigation:

```text
Move permission filter into main bool filter.
Re-run permission matrix.
Patch endpoint.
```

Permanent fix:

```text
Facet permission test.
Query contract test requiring tenant/security filter inside main query.
Security metric for facet mode.
```

Lesson:

> Permission-aware search includes hits, facets, highlights, suggestions, and exports.

---

## 59. Exercises

### Exercise 1 — Build Dashboard

Design a dashboard for `/cases/search` with:

- latency;
- error rate;
- query type;
- result count;
- zero-result rate;
- tenant distribution;
- facet usage;
- highlight usage;
- ES took vs API total.

Explain what each graph helps diagnose.

### Exercise 2 — Alert Design

Create alerts for:

1. Search latency SLO breach.
2. Indexing freshness lag.
3. Bulk mapper errors.
4. Search thread pool rejection.
5. Permission filter missing.
6. Cluster yellow/red.
7. DLQ growth.
8. Heap pressure.

For each alert, define severity and first action.

### Exercise 3 — Incident Diagnosis

Given:

```text
cluster health = green
API p99 = 6s
ES took = 5.5s
search thread pool queue high on one node
CPU high on same node
slow logs show wildcard query
```

Answer:

- likely cause;
- first mitigation;
- long-term fix;
- missing guardrail.

### Exercise 4 — Freshness Measurement

Design a metric that measures:

```text
domain update timestamp → searchable timestamp
```

Explain where timestamps should be captured and what alerts should exist.

---

## 60. Summary

Production Elasticsearch observability must be built around more than cluster health.

A mature search platform observes:

- user-facing API behavior;
- query type and cost;
- Elasticsearch cluster/node/index metrics;
- JVM/GC/heap pressure;
- thread pool queues and rejections;
- slow logs;
- indexing pipeline and freshness lag;
- bulk item-level failures;
- DLQ and reconciliation;
- permission-aware behavior;
- facet/highlight/autocomplete/export-specific behavior;
- relevance and zero-result signals.

The core operational mental model:

```text
Search UX symptom
→ API metric
→ query behavior
→ Elasticsearch execution
→ shard/node/resource
→ ingestion/source correctness
→ mitigation
→ permanent guardrail
```

Top-tier Elasticsearch engineering is not just knowing which API to call. It is knowing what question you are asking, what signal answers it, how to act safely, and how to prevent the same class of failure from recurring.

---

## 61. What Comes Next

Part 027 will cover:

```text
Failure Modes and Incident Response
```

Topics:

- red/yellow cluster;
- unassigned shards;
- split-brain historical context and modern coordination;
- disk watermark;
- circuit breaker;
- rejected execution;
- heap pressure;
- long GC pause;
- mapping explosion;
- hotspot shard;
- slow query incident;
- bulk indexing storm;
- corrupt relevance after deployment;
- recovery playbooks;
- post-incident hardening.

---

## References

- Elastic Docs — Elasticsearch metrics: https://www.elastic.co/docs/deploy-manage/monitor/monitoring-data/elasticsearch-metrics
- Elastic Docs — Slow log settings: https://www.elastic.co/docs/reference/elasticsearch/index-settings/slow-log
- Elastic Docs — Slow query and index logging: https://www.elastic.co/docs/deploy-manage/monitor/logging-configuration/slow-logs
- Elastic Docs — Thread pool settings: https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/thread-pool-settings
- Elastic Docs — Task queue backlog troubleshooting: https://www.elastic.co/docs/troubleshoot/elasticsearch/task-queue-backlog
- Elastic Docs — Rejected requests troubleshooting: https://www.elastic.co/docs/troubleshoot/elasticsearch/rejected-requests
- Elastic Docs — Red or yellow cluster health status: https://www.elastic.co/docs/troubleshoot/elasticsearch/red-yellow-cluster-status
- Elastic Docs — High JVM memory pressure: https://www.elastic.co/docs/troubleshoot/elasticsearch/high-jvm-memory-pressure
- Elastic Docs — High CPU usage and hot threads: https://www.elastic.co/docs/troubleshoot/elasticsearch/high-cpu-usage
- Elastic Docs — Clusters, nodes, and shards: https://www.elastic.co/docs/deploy-manage/distributed-architecture/clusters-nodes-shards
- Elastic Docs — Tune for search speed: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/search-speed


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Schema Evolution and Zero-Downtime Reindexing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-027.md">Part 027 — Failure Modes and Incident Response ➡️</a>
</div>
