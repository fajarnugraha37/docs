# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-024.md

# Part 024 — Lifecycle Management, Time-Based Indices, and Data Streams

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Audience: Java software engineer / backend engineer / tech lead  
> Fokus: Elasticsearch sebagai search/retrieval platform production-grade  
> Posisi dalam seri: setelah shard/capacity planning, sebelum schema evolution dan zero-downtime reindexing

---

## 0. Ringkasan Eksekutif

Elasticsearch index bukan objek statis. Di production, index memiliki **umur hidup**:

1. dibuat,
2. menerima write,
3. melayani query intensif,
4. menjadi kurang sering diakses,
5. dipindahkan ke storage lebih murah,
6. mungkin dioptimalkan,
7. akhirnya dihapus atau diarsipkan.

Part ini membahas bagaimana mengelola siklus hidup tersebut dengan benar menggunakan:

- time-based indices,
- rollover,
- aliases,
- data streams,
- Index Lifecycle Management / ILM,
- data tiers: hot, warm, cold, frozen,
- retention,
- shrink,
- force merge,
- delete phase,
- desain lifecycle berdasarkan pola query.

Mental model penting:

> Elasticsearch lifecycle management bukan sekadar “hapus data lama”. Ini adalah mekanisme untuk menjaga **latency, biaya storage, shard size, operational safety, dan retention policy** tetap terkendali seiring data bertambah.

Tanpa lifecycle management, cluster Elasticsearch biasanya gagal secara perlahan:

- shard terlalu banyak,
- index terlalu besar,
- disk penuh,
- query makin lambat,
- merge pressure naik,
- recovery makin lama,
- storage cost meledak,
- data lama tidak pernah dibersihkan,
- retention tidak defensible.

Untuk engineer yang membangun sistem enterprise/regulatory, lifecycle design juga berkaitan dengan:

- audit retention,
- legal hold,
- privacy deletion,
- operational observability,
- evidentiary search,
- historical query,
- current-state query,
- disaster recovery.

---

## 1. Kenapa Lifecycle Management Penting?

Bayangkan index `case-events` menerima 20 juta event per hari. Jika semua document ditulis ke satu index permanen:

```text
case-events
  ├── grows forever
  ├── shard grows forever
  ├── segment count grows
  ├── merge cost grows
  ├── recovery time grows
  ├── snapshot size grows
  └── query cost becomes harder to reason about
```

Masalahnya bukan hanya kapasitas disk. Masalah sebenarnya adalah **loss of operational boundedness**.

Sistem production yang sehat membutuhkan batas:

- batas ukuran shard,
- batas umur data aktif,
- batas retention,
- batas recovery time,
- batas query window,
- batas jumlah index aktif,
- batas jumlah document yang perlu discan untuk use case umum.

Lifecycle management memberikan cara sistematis untuk membuat batas tersebut.

---

## 2. Search Data Tidak Semuanya Sama

Tidak semua data Elasticsearch memiliki lifecycle yang sama.

### 2.1 Current-state search data

Contoh:

- active cases,
- current entities,
- current customers,
- current enforcement subjects,
- latest product catalog,
- current documents.

Karakteristik:

- document sering di-update,
- query biasanya mencari kondisi terkini,
- retention mungkin mengikuti canonical DB,
- index sering perlu reindex saat mapping berubah,
- deletion mengikuti lifecycle domain.

Biasanya cocok dengan:

- versioned index + alias,
- zero-downtime reindex,
- source-of-truth rebuild,
- bukan selalu data stream.

### 2.2 Append-only time-series data

Contoh:

- logs,
- audit events,
- case activity events,
- telemetry,
- metrics,
- ingestion events,
- notification history,
- search query logs.

Karakteristik:

- mostly append-only,
- timestamp adalah dimensi utama,
- retention jelas,
- data lama makin jarang dibaca,
- rollover alami berdasarkan size/age,
- cocok untuk data streams.

### 2.3 Historical snapshot data

Contoh:

- historical case snapshot,
- regulatory decision archive,
- prior entity states,
- old evidence metadata,
- archived search documents.

Karakteristik:

- jarang diubah,
- penting untuk audit/historical search,
- query lebih jarang tapi harus benar,
- retention bisa panjang,
- storage cost penting.

Biasanya cocok dengan:

- time-based index,
- warm/cold tier,
- searchable snapshots untuk cold/frozen use case,
- explicit retention governance.

### 2.4 Derived search index

Contoh:

- denormalized case search index,
- investigator work queue index,
- regulatory risk search index,
- RAG passage index,
- autocomplete index.

Karakteristik:

- dapat dibangun ulang dari source-of-truth,
- bukan canonical data,
- lifecycle mengikuti kebutuhan query,
- mapping/query evolution sering terjadi.

Biasanya cocok dengan:

- index alias,
- versioned index,
- blue/green reindex,
- controlled delete setelah cutover.

---

## 3. Mental Model: Index Lifecycle sebagai State Machine

Sebagai engineer yang terbiasa dengan lifecycle modelling, pikirkan Elasticsearch index lifecycle sebagai state machine.

```text
[CREATED]
    ↓
[HOT / WRITABLE]
    ↓ rollover
[HOT / READ-ONLY OLD INDEX]
    ↓ age/condition
[WARM]
    ↓ age/condition
[COLD]
    ↓ age/condition
[FROZEN]
    ↓ age/condition
[DELETE]
```

Tidak semua index perlu melewati semua state. Beberapa cukup:

```text
HOT → DELETE
```

Beberapa:

```text
HOT → WARM → DELETE
```

Beberapa enterprise archive:

```text
HOT → WARM → COLD → FROZEN → DELETE
```

Yang penting bukan jumlah phase, tetapi kesesuaian phase dengan:

- query pattern,
- data value decay,
- retention obligation,
- storage cost,
- recovery expectation,
- compliance requirement.

---

## 4. Time-Based Indices

Time-based index berarti index dipartisi berdasarkan waktu.

Contoh:

```text
case-events-2026.06.22
case-events-2026.06.23
case-events-2026.06.24
```

Atau bulanan:

```text
case-events-2026.06
case-events-2026.07
case-events-2026.08
```

Atau rollover sequence:

```text
case-events-000001
case-events-000002
case-events-000003
```

Tujuan time-based index:

1. membatasi ukuran index,
2. membatasi ukuran shard,
3. memudahkan retention,
4. memudahkan query berdasarkan time range,
5. memudahkan operasi pada data lama,
6. mengurangi blast radius.

---

## 5. Kesalahan Umum: Daily Index by Habit

Banyak engineer membuat daily index karena kebiasaan dari logging stack lama:

```text
logs-2026.06.22
logs-2026.06.23
logs-2026.06.24
```

Ini tidak selalu salah, tetapi sering menjadi masalah.

Jika volume kecil, daily index menghasilkan terlalu banyak shard kecil.

Misal:

```text
1 index per day
1 primary shard per index
1 replica
365 days retention
```

Total shard:

```text
365 * 2 = 730 shards
```

Jika ada 50 dataset:

```text
730 * 50 = 36,500 shards
```

Itu bisa menjadi oversharding serius.

Prinsip yang lebih baik:

> Rollover berdasarkan ukuran shard dan umur data, bukan tanggal kalender semata.

Tanggal tetap berguna untuk readability, tetapi lifecycle harus didesain berdasarkan workload.

---

## 6. Rollover

Rollover adalah proses membuat index baru untuk write berikutnya ketika kondisi tertentu terpenuhi.

Contoh konsep:

```text
case-events-000001  ← old write index, now read-only
case-events-000002  ← new write index
```

Rollover bisa dipicu oleh:

- umur index,
- ukuran shard,
- jumlah document,
- manual API call,
- ILM automation,
- data stream lifecycle.

Rollover membantu menjaga index tidak tumbuh tanpa batas.

Elastic mendokumentasikan bahwa rollover dapat membuat index baru untuk data stream atau alias; untuk data stream, rollover membuat backing index baru sebagai write index, sedangkan backing index sebelumnya menjadi regular backing index.

---

## 7. Alias-Based Rollover

Sebelum data streams populer, pola umum adalah menggunakan write alias.

```text
Alias: case-events-write
  └── case-events-000001  is_write_index=true
```

Setelah rollover:

```text
Alias: case-events-write
  └── case-events-000002  is_write_index=true

Alias: case-events-read
  ├── case-events-000001
  └── case-events-000002
```

Write aplikasi selalu ke:

```text
case-events-write
```

Search aplikasi bisa ke:

```text
case-events-read
```

atau pattern:

```text
case-events-*
```

Keuntungan alias:

- kompatibel dengan custom search index,
- fleksibel,
- cocok untuk current-state index migration,
- bisa digunakan untuk blue/green reindex,
- explicit control.

Kekurangan:

- lebih mudah salah konfigurasi,
- harus mengelola `is_write_index`,
- template dan policy harus rapi,
- tidak se-ergonomis data streams untuk time-series append-only.

---

## 8. Data Streams

Data stream adalah abstraksi Elasticsearch untuk data time-series append-only.

Data stream memiliki:

- nama logical stream,
- satu write backing index aktif,
- beberapa backing index historis,
- template,
- lifecycle/ILM policy.

Contoh:

```text
Data stream: case-audit-events

Backing indices:
  .ds-case-audit-events-2026.06.22-000001
  .ds-case-audit-events-2026.06.23-000002
  .ds-case-audit-events-2026.06.24-000003  ← write index
```

Aplikasi menulis ke:

```text
case-audit-events
```

Elasticsearch mengarahkan write ke backing index aktif.

Search ke data stream membaca backing indices yang relevan.

Elastic merekomendasikan penggunaan ILM untuk me-rollover data stream otomatis ketika write index mencapai age atau size tertentu.

---

## 9. Kapan Menggunakan Data Stream?

Gunakan data stream ketika data:

- time-series,
- append-only atau mostly append-only,
- punya field timestamp,
- punya retention berbasis waktu,
- query umum memakai time range,
- write masuk secara kontinu,
- data lama jarang di-update.

Contoh bagus:

```text
logs
metrics
audit-events
case-events
workflow-events
ingestion-events
search-query-logs
application-observability-events
```

Kurang cocok untuk:

```text
current case search index
current customer index
current product catalog
current regulatory subject index
frequently updated canonical search documents
```

Karena data stream didesain terutama untuk append-only time-series, bukan mutable entity index.

---

## 10. Data Stream vs Normal Index + Alias

| Aspek | Data Stream | Index + Alias |
|---|---|---|
| Cocok untuk | Time-series append-only | General search index |
| Write target | Data stream name | Write alias |
| Backing index | Managed by Elasticsearch | Managed manually/ILM |
| Rollover | Natural | Explicit alias rollover |
| Updates | Bisa, tapi bukan use case utama | Lebih fleksibel |
| Current-state entity search | Kurang cocok | Cocok |
| Logs/audit/events | Sangat cocok | Bisa, tapi lebih manual |
| Operational simplicity | Tinggi untuk time-series | Tinggi untuk custom migration bila disiplin |

Keputusan praktis:

```text
Is the data append-only and time-oriented?
  yes → consider data stream
  no  → use normal index + alias/versioned index
```

---

## 11. Index Lifecycle Management / ILM

Index Lifecycle Management adalah mekanisme Elasticsearch untuk mengatur lifecycle index secara otomatis.

ILM policy berisi phase dan action.

Phase umum:

```text
hot
warm
cold
frozen
delete
```

Action contoh:

```text
rollover
shrink
forcemerge
allocate/migrate
searchable_snapshot
delete
```

Elastic mendokumentasikan ILM sebagai cara untuk mendefinisikan bagaimana index berpindah melalui phase hot, warm, cold, frozen, dan delete berdasarkan umur atau kondisi tertentu.

---

## 12. Phase: Hot

Hot phase adalah fase ketika index aktif menerima write dan sering di-query.

Karakteristik:

- indexing rate tinggi,
- query rate tinggi,
- storage cepat,
- CPU cukup,
- IO tinggi,
- biasanya replica aktif,
- shard balancing penting.

Action umum:

- rollover,
- set priority,
- maybe no force merge,
- maybe tune replica.

Contoh data:

- log 24 jam terakhir,
- active case events,
- recent audit events,
- current operational events.

Design principle:

> Hot index harus kecil cukup agar write/search cepat dan recovery masuk akal.

---

## 13. Phase: Warm

Warm phase untuk data yang masih sering dicari, tetapi tidak lagi menerima write aktif.

Karakteristik:

- read mostly,
- indexing sudah berhenti,
- query lebih jarang dari hot,
- storage bisa lebih murah,
- bisa dilakukan segment optimization.

Action umum:

- shrink,
- force merge,
- reduce replica,
- migrate to warm tier.

Contoh:

- case events 7–90 hari lalu,
- historical audit events yang masih sering diperlukan,
- logs untuk troubleshooting jangka menengah.

Design principle:

> Warm data masih harus cukup cepat untuk investigator/operator, tetapi tidak perlu resource setinggi hot.

---

## 14. Phase: Cold

Cold phase untuk data jarang diakses tetapi masih harus tersedia.

Karakteristik:

- low query frequency,
- storage cost mulai dominan,
- latency boleh lebih tinggi,
- availability tetap penting,
- biasanya read-only.

Action umum:

- migrate to cold tier,
- searchable snapshot pada beberapa deployment,
- reduce replica strategy tergantung snapshot/availability.

Contoh:

- audit events 3–24 bulan lalu,
- historical enforcement records,
- compliance archives.

Design principle:

> Cold data bukan data mati. Ia jarang dicari, tetapi saat dicari biasanya penting.

---

## 15. Phase: Frozen

Frozen phase untuk data sangat jarang diakses dan optimasi storage cost sangat penting.

Karakteristik:

- very low query frequency,
- latency lebih tinggi diterima,
- biasanya memanfaatkan searchable snapshot,
- tidak cocok untuk interactive frequent search.

Contoh:

- multi-year historical logs,
- legal archive,
- regulatory historical material yang jarang dibuka.

Design principle:

> Frozen cocok untuk “must be searchable if needed”, bukan “must feel instant”.

---

## 16. Phase: Delete

Delete phase menghapus index setelah retention terpenuhi.

Ini tampak sederhana, tetapi sangat sensitif.

Pertanyaan wajib:

1. Retention dihitung dari kapan?
2. Berdasarkan index creation time atau rollover time?
3. Apakah data terakhir dalam index bisa lebih muda dari usia index?
4. Apakah ada legal hold?
5. Apakah deletion harus sinkron dengan canonical store?
6. Apakah snapshot tetap menyimpan data?
7. Apakah ada audit trail deletion?

Kesalahan umum:

```text
rollover every 7 days
delete after 7 days
```

Jika index menerima data sepanjang 7 hari lalu dihapus segera setelah phase delete, document paling baru di index bisa jauh lebih muda dari retention yang diinginkan.

Mental model:

> Retention pada index-level tidak selalu sama dengan retention pada document-level.

Jika retention wajib per document, index-level delete perlu dirancang hati-hati.

---

## 17. Rollover Time vs Creation Time vs Document Time

Ada tiga waktu berbeda:

```text
index creation time
rollover time
document event time
```

Contoh:

```text
Index created:        2026-06-01
Rollover happened:   2026-06-08
Document inside:     2026-06-07 23:59
Delete phase:        30 days after rollover
```

Jika engineer tidak memahami basis umur lifecycle, retention bisa salah.

Untuk sistem regulated, jangan hanya berkata “retention 30 hari”. Definisikan:

```text
Retention is measured from event_time.
```

atau:

```text
Retention is measured from index rollover time with max tolerated retention skew of N days.
```

Keduanya berbeda secara compliance.

---

## 18. Designing Retention Windows

Retention harus berasal dari kebutuhan nyata:

- operasi,
- audit,
- hukum,
- investigasi,
- privacy,
- storage budget,
- incident response.

Contoh policy:

```text
Application logs:
  hot: 7 days
  warm: 23 days
  delete: 30 days

Audit events:
  hot: 30 days
  warm: 11 months
  cold: 6 years
  delete: 7 years

Search query logs:
  hot: 14 days
  warm: 76 days
  delete: 90 days

Regulatory evidence metadata:
  hot: 90 days
  warm: 2 years
  cold: 5 years
  frozen: 10 years
  delete/manual review: after legal retention clearance
```

Retention bukan nilai teknis default. Retention adalah business/legal decision yang diterjemahkan ke lifecycle policy.

---

## 19. Data Tiers

Elasticsearch data tiers mengorganisasi data berdasarkan temperatur akses dan karakteristik storage.

Umumnya:

```text
hot    → frequently accessed, actively written
warm   → less frequently accessed, read mostly
cold   → rarely accessed, cost optimized
frozen → very rarely accessed, searchable snapshot oriented
```

Elastic menjelaskan data tiers sebagai cara menyeimbangkan performance, cost, dan accessibility.

Pikirkan tier sebagai trade-off:

```text
more performance → more cost
less frequent access → cheaper storage acceptable
```

---

## 20. Hardware Thinking per Tier

### Hot tier

Butuh:

- fast SSD,
- CPU cukup,
- heap sehat,
- network baik,
- indexing throughput tinggi.

### Warm tier

Butuh:

- storage cukup,
- CPU sedang,
- query masih wajar,
- write minimal.

### Cold tier

Butuh:

- storage cost rendah,
- latency lebih longgar,
- snapshot strategy jelas.

### Frozen tier

Butuh:

- searchable snapshot design,
- ekspektasi latency realistis,
- query volume rendah.

---

## 21. Lifecycle Berdasarkan Query Pattern

Jangan mendesain lifecycle hanya berdasarkan usia. Desain berdasarkan pola query.

Pertanyaan:

1. User paling sering query range berapa lama?
2. Apakah default UI hanya mencari 30 hari terakhir?
3. Apakah investigator sering membuka data 2 tahun lalu?
4. Apakah audit query harus lintas 7 tahun?
5. Apakah data lama perlu facet/aggs berat?
6. Apakah data lama perlu full-text search atau hanya exact lookup?
7. Apakah data lama perlu ranking relevansi atau sekadar retrieval?

Contoh:

```text
Case activity search:
  90% query: last 30 days
  9% query: last 1 year
  1% query: older than 1 year
```

Lifecycle bisa:

```text
hot: 30 days
warm: 335 days
cold: 6 years
```

UI bisa default:

```text
last 30 days
```

Untuk older range, tampilkan warning:

```text
Searching older archives may be slower.
```

Ini bukan hanya technical design. Ini product contract.

---

## 22. Current Index Alias vs Historical Index Alias

Untuk beberapa sistem, Anda ingin memisahkan current search dan historical search.

Contoh:

```text
cases-current-read
cases-current-write
cases-history-read
cases-history-write
```

Atau:

```text
case-search-current-v3
case-search-history-2026.06
case-search-history-2026.07
```

Manfaat:

- query current cepat,
- historical query eksplisit,
- retention lebih mudah,
- mapping bisa disesuaikan,
- access control bisa berbeda,
- UI bisa membedakan mode.

Kesalahan umum:

> Semua data, semua umur, semua mode query, semua user, dimasukkan ke satu alias besar.

Akibatnya:

- query fan-out terlalu luas,
- aggregation mahal,
- permission filtering berat,
- result ranking kacau antara current dan historical,
- lifecycle sulit.

---

## 23. Index Naming Convention

Naming convention bukan kosmetik. Ia membantu operasi, observability, troubleshooting, dan automation.

Contoh buruk:

```text
idx1
search
prod-data
case
```

Contoh lebih baik:

```text
case-search-current-v003
case-events-prod
case-events-dev
reg-subject-search-v002
audit-events-prod
search-query-logs-prod
```

Untuk rollover index:

```text
case-events-000001
case-events-000002
```

Untuk time-based readability:

```text
case-events-2026.06.000001
```

Gunakan convention yang menjawab:

- domain apa?
- environment apa?
- dataset apa?
- current atau historical?
- version berapa?
- stream atau index biasa?

---

## 24. Template untuk Lifecycle

Lifecycle harus dihubungkan dengan index template.

Template biasanya mengatur:

- mapping,
- settings,
- shard count,
- replica count,
- ILM policy,
- rollover alias jika memakai alias,
- data stream definition jika memakai data stream.

Pola:

```text
component template: mapping common
component template: settings common
index template: dataset-specific composition
ILM policy: lifecycle behavior
```

Tujuannya:

- konsisten,
- repeatable,
- menghindari manual index creation,
- governance lebih kuat,
- migration lebih aman.

---

## 25. Contoh ILM Policy Sederhana

Contoh policy untuk event/audit ringan:

```json
PUT _ilm/policy/case-events-90d-policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_primary_shard_size": "30gb",
            "max_age": "7d"
          }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "forcemerge": {
            "max_num_segments": 1
          }
        }
      },
      "delete": {
        "min_age": "90d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

Catatan:

- `max_primary_shard_size` menjaga shard tidak terlalu besar,
- `max_age` mencegah index aktif terlalu lama walaupun volume kecil,
- `forcemerge` hanya masuk akal setelah index tidak menerima write,
- delete phase harus sesuai retention.

Angka di atas bukan rekomendasi universal. Itu contoh pola.

---

## 26. Contoh Index Template untuk Data Stream

```json
PUT _index_template/case-events-template
{
  "index_patterns": ["case-events-*"],
  "data_stream": {},
  "template": {
    "settings": {
      "index.lifecycle.name": "case-events-90d-policy",
      "number_of_shards": 3,
      "number_of_replicas": 1
    },
    "mappings": {
      "properties": {
        "@timestamp": {
          "type": "date"
        },
        "case_id": {
          "type": "keyword"
        },
        "event_type": {
          "type": "keyword"
        },
        "actor_id": {
          "type": "keyword"
        },
        "message": {
          "type": "text"
        },
        "severity": {
          "type": "keyword"
        }
      }
    }
  }
}
```

Kemudian write ke data stream:

```http
POST case-events-prod/_doc
{
  "@timestamp": "2026-06-22T10:15:00Z",
  "case_id": "CASE-2026-000123",
  "event_type": "ESCALATED",
  "actor_id": "user-789",
  "message": "Case escalated due to overdue response",
  "severity": "HIGH"
}
```

---

## 27. Shrink

Shrink mengurangi jumlah primary shard pada index read-only.

Contoh:

```text
hot index: 6 primary shards
warm index after rollover: shrink to 1 primary shard
```

Mengapa?

- saat hot, butuh parallel write,
- saat warm, write sudah berhenti,
- query volume lebih rendah,
- shard terlalu banyak menjadi overhead.

Syarat/prinsip:

- index harus read-only,
- target shard count harus faktor dari source shard count,
- operasi ini perlu disk/IO,
- jangan dilakukan sembarangan saat cluster sibuk.

Gunakan shrink untuk index yang saat hot perlu shard banyak, tetapi saat historical lebih efisien dengan shard sedikit.

---

## 28. Force Merge

Force merge menggabungkan segment agar index read-only lebih efisien untuk search/storage.

Contoh:

```json
"forcemerge": {
  "max_num_segments": 1
}
```

Mengapa berguna?

- mengurangi segment count,
- menghapus deleted docs secara fisik setelah merge,
- bisa memperbaiki search overhead pada read-only historical index,
- bisa mengurangi storage.

Bahaya:

- sangat IO intensive,
- bisa mengganggu cluster,
- tidak cocok untuk index yang masih aktif menerima write,
- max segment terlalu agresif tidak selalu perlu.

Rule:

> Force merge hanya untuk index read-only dan lakukan melalui lifecycle yang terkendali.

---

## 29. Delete Phase dan Legal Hold

Untuk sistem regulatory, delete phase tidak boleh hanya technical timer.

Anda perlu legal hold model.

Contoh:

```text
case-events-2024.01 should be deleted after 7 years
BUT case CASE-2024-123 is under legal hold
```

Jika index-level delete menghapus seluruh index, document terkait legal hold ikut hilang.

Solusi desain bisa berupa:

1. legal-hold data dipisah ke index khusus,
2. retention index-level dibuat lebih panjang dari legal hold maximum,
3. legal hold documents direplikasi ke archive store,
4. deletion bukan ILM otomatis penuh tetapi gated workflow,
5. ILM delete hanya untuk data yang aman secara legal.

Prinsip:

> ILM delete bekerja pada level index, bukan individual legal obligation.

Jika kewajiban retention berbeda per document, desain index partitioning harus mencerminkan itu.

---

## 30. Document-Level Retention vs Index-Level Retention

Elasticsearch lifecycle management paling natural bekerja di index-level.

Jika document dalam satu index punya retention berbeda, muncul masalah.

Contoh:

```text
Document A retention: 30 days
Document B retention: 7 years
Document C retention: legal hold indefinite
```

Jika semuanya di index yang sama:

```text
events-2026.06
```

Anda tidak bisa menghapus index setelah 30 hari tanpa melanggar B/C.

Pilihan desain:

### Option A — Separate indices by retention class

```text
events-short-retention-*
events-long-retention-*
events-legal-hold-*
```

### Option B — Keep long retention and delete per document

Kelemahan:

- deleted docs tetap ada sampai merge,
- mahal untuk volume besar,
- lifecycle lebih rumit.

### Option C — Archive before delete

```text
hot search index → archive store → delete from search
```

### Option D — Use canonical store for retention, search index as disposable

Search index bisa dihapus/rebuild, tetapi canonical retention ada di sistem lain.

---

## 31. Searchable History vs Source-of-Truth Archive

Tanya dulu:

> Apakah data lama harus searchable di Elasticsearch, atau cukup rebuild/restore jika diperlukan?

Pilihan:

### Always searchable

Kelebihan:

- user bisa langsung search,
- operationally convenient,
- audit cepat.

Kekurangan:

- storage cost tinggi,
- cluster lebih kompleks,
- security scope lebih luas.

### Archived outside Elasticsearch

Kelebihan:

- storage lebih murah,
- cluster lebih ringan,
- retention lebih formal.

Kekurangan:

- search historis tidak instant,
- restore/reindex butuh waktu,
- UX lebih kompleks.

### Hybrid

```text
last 1 year searchable hot/warm
1–7 years cold/frozen searchable
>7 years external archive only
```

Untuk regulatory case system, hybrid sering paling realistis.

---

## 32. Designing Lifecycle by Dataset Type

### 32.1 Application logs

```text
Purpose: troubleshooting
Query: recent-heavy
Retention: 14–90 days
Lifecycle: hot → warm → delete
```

### 32.2 Audit events

```text
Purpose: accountability/compliance
Query: recent + historical investigation
Retention: years
Lifecycle: hot → warm → cold/frozen → delete/manual review
```

### 32.3 Search query logs

```text
Purpose: relevance improvement
Query: analytics/relevance team
Retention: privacy-sensitive
Lifecycle: hot → warm → delete/anonymize
```

### 32.4 Case activity events

```text
Purpose: timeline and investigation
Query: case-specific, time-filtered
Retention: tied to case retention
Lifecycle: hot → warm → cold
```

### 32.5 Current case search index

```text
Purpose: active search
Query: current state
Retention: derived from canonical DB
Lifecycle: versioned index + alias, not necessarily ILM rollover
```

### 32.6 RAG passage index

```text
Purpose: retrieval for LLM grounding
Query: semantic/hybrid
Retention: follows source document lifecycle
Lifecycle: versioned index + rebuild + permission-aware delete
```

---

## 33. Query Routing to Lifecycle-Aware Indices

Search API should not blindly query all indices.

Bad:

```text
GET case-events-*/_search
```

Better:

```text
if request.timeRange <= 30 days:
    search hot alias/data stream
else if request.timeRange <= 1 year:
    search hot + warm
else:
    search archive mode
```

Even better:

```text
SearchMode.CURRENT
SearchMode.RECENT_HISTORY
SearchMode.FULL_ARCHIVE
```

This makes cost explicit.

API example:

```json
{
  "query": "escalated overdue",
  "time_range": {
    "from": "2026-01-01T00:00:00Z",
    "to": "2026-06-22T23:59:59Z"
  },
  "scope": "RECENT_HISTORY"
}
```

Backend can map:

```text
RECENT_HISTORY → case-events-prod
FULL_ARCHIVE   → case-events-prod + case-events-archive-prod
```

---

## 34. Lifecycle-Aware UX

UI should reflect lifecycle realities.

Examples:

```text
Default search: last 30 days
```

```text
Searching more than 1 year may take longer.
```

```text
Archive search does not include live draft cases.
```

```text
Results older than 7 years may require archive retrieval.
```

This is not weakness. This is honest system behavior.

For regulated systems, explicit scope is better than hidden partial results.

---

## 35. Avoiding Accidental Cross-Tier Expensive Queries

A query across hot/warm/cold/frozen can become expensive.

Dangerous patterns:

- no time filter,
- wildcard query across all history,
- high-cardinality aggregation over archive,
- sorting by non-index-optimized field,
- highlighting old large documents,
- semantic/vector search across huge archive without prefilter.

Guardrails:

- require time range,
- cap historical search window,
- async search for archive,
- separate archive endpoint,
- disallow expensive query classes on archive mode,
- limit aggregations for old data,
- use PIT/search_after carefully,
- apply tenant/permission filters first.

---

## 36. Lifecycle and Snapshots

ILM is not backup.

Deleting an index via ILM removes it from the cluster. If you need recoverability, you need snapshot strategy.

Questions:

1. Are snapshots taken before delete?
2. How long are snapshots retained?
3. Do snapshots include restricted/sensitive data?
4. Who can restore snapshots?
5. Is restore tested?
6. Does retention law require snapshot deletion too?

A dangerous misconception:

> “ILM deletes after 90 days, so data is gone.”

Maybe not. It may still exist in snapshots.

For privacy/compliance, snapshot retention must align with data retention policy.

---

## 37. Lifecycle and Reindexing

Lifecycle interacts with reindexing.

If mapping changes, do you reindex:

- only current data?
- last 90 days?
- all history?
- only data likely to be searched?
- all archive indices?

For large historical datasets, reindexing all history may be expensive.

Alternative:

```text
new mapping applies to new indices only
old indices remain searchable with older query compatibility
```

This creates multi-version search.

Search API must know:

```text
index version v2 supports field X
index version v1 does not
```

This is covered deeper in Part 025, but lifecycle planning should anticipate it.

---

## 38. Lifecycle and Mapping Compatibility

When querying multiple indices, mappings must be compatible enough.

Problem:

```text
case-events-2026.01: severity is keyword
case-events-2026.02: severity is integer
```

A cross-index search/aggregation can fail or behave inconsistently.

Rule:

> Lifecycle partitions time, but schema governance must keep index generations compatible.

Use:

- component templates,
- versioned field addition,
- no random dynamic mapping,
- mapping tests,
- controlled template rollout.

---

## 39. Lifecycle and Permission Model

Permission-aware search becomes harder with historical data.

Questions:

- Should old permission state apply or current permission state?
- If user had access in 2024 but not now, can they search 2024 data?
- If case was reassigned, do old events remain visible?
- If document was sealed, should historical search remove it?
- If role changes, do archive queries reflect new role?

Two models:

### Current authorization model

Search filters use current user permissions.

Good for:

- current operational search,
- security simplicity.

Hard for:

- historical audit reconstruction.

### Historical authorization model

Search considers permission at event time.

Good for:

- audit reconstruction,
- “who could see what then?” questions.

Hard for:

- implementation complexity,
- storage of historical ACL state.

Lifecycle design must decide which model applies to each dataset.

---

## 40. Lifecycle and Regulatory Defensibility

For regulatory systems, lifecycle policy must be explainable.

You should be able to answer:

1. Why is this data searchable for this period?
2. Why is this data deleted after this period?
3. Who approved the retention policy?
4. Is search index canonical or derived?
5. How do you prove deleted data is not still searchable?
6. How do you handle legal hold?
7. How do you restore mistakenly deleted search data?
8. How do you audit lifecycle policy changes?
9. How do you test lifecycle behavior?
10. How do you prevent data leakage through historical search?

Top-tier engineering means lifecycle policy is not tribal knowledge. It is documented, versioned, tested, and reviewed.

---

## 41. Java Backend Design: Lifecycle-Aware Search Routing

A Java search service should make lifecycle explicit.

Example domain enum:

```java
public enum SearchScope {
    CURRENT,
    RECENT_HISTORY,
    FULL_ARCHIVE
}
```

Index resolver:

```java
public final class SearchIndexResolver {

    public List<String> resolveCaseEventIndices(SearchScope scope) {
        return switch (scope) {
            case CURRENT -> List.of("case-events-current");
            case RECENT_HISTORY -> List.of("case-events-prod");
            case FULL_ARCHIVE -> List.of("case-events-prod", "case-events-archive-prod");
        };
    }
}
```

Better version with policy object:

```java
public record SearchRoutingPolicy(
    SearchScope scope,
    Duration maxWindow,
    boolean allowAggregations,
    boolean allowHighlighting,
    boolean requireExplicitTimeRange,
    List<String> targetIndices
) {}
```

Then validate request:

```java
public void validate(SearchRequestDto request, SearchRoutingPolicy policy) {
    if (policy.requireExplicitTimeRange() && request.timeRange() == null) {
        throw new BadRequestException("Historical search requires explicit time range");
    }

    if (request.timeRange().duration().compareTo(policy.maxWindow()) > 0) {
        throw new BadRequestException("Requested time range exceeds scope limit");
    }

    if (!policy.allowAggregations() && request.hasAggregations()) {
        throw new BadRequestException("Aggregations are not allowed for this archive scope");
    }
}
```

This prevents accidental archive-wide expensive queries.

---

## 42. Java Backend Design: Write Target Isolation

For data stream/event ingestion, Java service should write to logical target, not backing index.

Good:

```java
client.index(i -> i
    .index("case-events-prod")
    .document(eventDocument)
);
```

Bad:

```java
client.index(i -> i
    .index(".ds-case-events-prod-2026.06.22-000123")
    .document(eventDocument)
);
```

Application should not know backing index names.

Similarly for alias-based rollover, write to write alias:

```java
client.index(i -> i
    .index("case-events-write")
    .document(eventDocument)
);
```

Never hard-code generation index in business code unless doing maintenance/reindex tooling.

---

## 43. Lifecycle Observability

Monitor lifecycle, not only cluster health.

Useful signals:

- ILM explain status,
- index phase distribution,
- stuck lifecycle steps,
- rollover not happening,
- shard size per backing index,
- index age,
- data tier disk usage,
- force merge duration,
- shrink failures,
- delete phase execution,
- unexpected indices without lifecycle policy,
- old write index still receiving data,
- backing index count per data stream.

Example operational questions:

```text
Which indices are still in hot phase after expected rollover?
Which indices have shard size > target?
Which indices have no ILM policy?
Which data streams have too many backing indices?
Which lifecycle action failed recently?
```

A mature platform has dashboards for these.

---

## 44. Lifecycle Runbook: Rollover Not Happening

Symptoms:

- write index grows too large,
- shard size exceeds target,
- indexing slows down,
- search latency rises,
- ILM policy exists but not executing.

Investigation:

1. Check index/data stream has correct ILM policy.
2. Check rollover alias is configured if using alias rollover.
3. Check `is_write_index` is correct.
4. Check rollover conditions are actually met.
5. Check ILM explain output.
6. Check cluster health.
7. Check disk watermark/allocation issues.
8. Check template applied to new indices.

Common causes:

- policy not attached,
- wrong index pattern,
- write alias missing,
- data stream template misconfigured,
- rollover conditions unrealistic,
- ILM stopped or blocked,
- cluster allocation problem.

---

## 45. Lifecycle Runbook: Disk Filling Up

Symptoms:

- high disk watermark,
- shard relocation,
- write blocks,
- cluster yellow/red risk,
- indexing failures.

Investigation:

1. Which tier is full?
2. Which indices consume most disk?
3. Are old indices past retention?
4. Is delete phase stuck?
5. Are replicas too high?
6. Are snapshots/searchable snapshots configured correctly?
7. Are force merges creating temporary disk pressure?
8. Are deleted documents not merged yet?

Emergency actions:

- stop non-critical ingestion,
- increase disk/capacity,
- manually delete safe expired indices,
- reduce replicas if safe,
- move shards if possible,
- fix ILM delete stuck state.

Avoid:

- deleting unknown indices blindly,
- force merge under disk emergency,
- reducing replicas without understanding failure risk,
- disabling watermarks without plan.

---

## 46. Lifecycle Runbook: Historical Search Too Slow

Symptoms:

- archive search timeout,
- query latency spikes,
- coordinating node pressure,
- cold/frozen tier overloaded.

Investigation:

1. Is time range too wide?
2. Is query hitting too many indices?
3. Are aggregations needed?
4. Is sort expensive?
5. Is highlighting enabled on large archive fields?
6. Is permission filter high-cost?
7. Are old indices optimized/read-only?
8. Is archive tier hardware aligned with expectation?

Mitigations:

- require explicit time range,
- split current/recent/archive endpoints,
- use async search for archive,
- cap result window,
- disable expensive features in archive mode,
- pre-aggregate if analytics is needed,
- route only to relevant indices,
- improve index sorting or field design.

---

## 47. Lifecycle Policy Change Management

Changing lifecycle policy is operationally sensitive.

Treat it like schema/config migration.

Checklist:

- What datasets are affected?
- What indices already exist?
- Does policy affect old indices or only new ones?
- What phase are existing indices in?
- Could data be deleted earlier than expected?
- Does snapshot retention align?
- Has legal/compliance approved retention change?
- Is rollback possible?
- Is there a dry-run/explain review?
- Are alerts updated?

For regulated systems, policy change should be:

- reviewed,
- versioned,
- linked to requirement/ticket,
- auditable,
- tested in lower environment.

---

## 48. Anti-Patterns

### 48.1 One index forever

```text
case-events
```

Problem:

- unbounded growth,
- hard retention,
- slow recovery,
- difficult optimization.

### 48.2 Daily indices for everything

Problem:

- shard explosion for low-volume datasets,
- operational overhead,
- many tiny shards.

### 48.3 Query all history by default

Problem:

- unnecessary fan-out,
- bad latency,
- expensive aggregations.

### 48.4 ILM delete without retention review

Problem:

- accidental compliance breach,
- legal hold violation,
- data loss.

### 48.5 Mixing retention classes in one index

Problem:

- shortest retention cannot be enforced safely,
- longest retention dominates cost.

### 48.6 Force merge on active write index

Problem:

- IO storm,
- merge pressure,
- degraded indexing.

### 48.7 Application writes to backing index directly

Problem:

- rollover broken,
- operational coupling,
- data written to old index.

### 48.8 Lifecycle only known by ops

Problem:

- backend/API behavior ignores cost,
- UI lies about archive search,
- product expectations unrealistic.

---

## 49. Practical Design Exercise

Scenario:

You are designing Elasticsearch for a regulatory case management system.

Datasets:

1. `case-search-current`
2. `case-events`
3. `audit-events`
4. `search-query-logs`
5. `case-evidence-metadata`

Requirements:

- active case search must be fast,
- case events searchable for 7 years,
- audit events retained 10 years,
- search query logs retained 90 days due privacy,
- evidence metadata follows case legal hold,
- archive search may be slower,
- current search must not query all history.

Possible design:

```text
case-search-current:
  normal versioned index + read/write alias
  no time-based rollover
  rebuildable from canonical DB

case-events:
  data stream
  hot: 30d
  warm: 335d
  cold: 6y
  delete/manual review: 7y, with legal hold rules outside ILM if needed

audit-events:
  data stream or retention-class-separated indices
  hot: 90d
  warm: 2y
  cold/frozen: 8y
  delete/manual review: 10y

search-query-logs:
  data stream
  hot: 14d
  warm: 76d
  delete: 90d
  maybe anonymization before long-term analytics

case-evidence-metadata:
  normal index or retention-class index
  legal hold-aware
  likely not pure ILM delete unless partitioned by retention class
```

Search API scopes:

```text
/current-cases/search       → case-search-current-read
/case-events/search         → case-events data stream, requires time range
/archive/search             → archive indices, async/limited features
/audit/search               → audit-events with strict permission and time range
```

This design makes lifecycle visible in API and product behavior.

---

## 50. Mental Model Checklist

Before designing lifecycle, answer:

```text
[ ] Is the dataset current-state, append-only, historical, or derived?
[ ] Is timestamp central to query behavior?
[ ] Is data stream appropriate?
[ ] What is the write rate?
[ ] What is the search rate by data age?
[ ] What is retention policy?
[ ] Is retention per index or per document?
[ ] Are legal holds possible?
[ ] What is acceptable latency for old data?
[ ] What tier should old data live on?
[ ] What is target shard size?
[ ] What rollover condition is appropriate?
[ ] Is delete phase safe?
[ ] Are snapshots aligned with retention?
[ ] Does API route current/recent/archive separately?
[ ] Are lifecycle failures monitored?
[ ] Are policy changes reviewed?
```

---

## 51. Top 1% Engineer Takeaways

A strong Elasticsearch engineer does not merely create an index and write queries.

They design the index lifecycle as an operational system.

Key takeaways:

1. Lifecycle management is about boundedness: size, time, cost, recovery, and risk.
2. Time-based indices are useful, but daily index by habit often causes oversharding.
3. Rollover should usually be based on size/age conditions aligned with workload.
4. Data streams are excellent for append-only time-series data.
5. Normal index + alias is still important for current-state and versioned search indices.
6. ILM works at index lifecycle level; be careful with per-document retention obligations.
7. Delete phase is a compliance decision, not just a storage cleanup setting.
8. Hot/warm/cold/frozen tiers represent cost/performance/accessibility trade-offs.
9. Search API should be lifecycle-aware and avoid querying all history by default.
10. Historical search needs explicit UX/API contracts.
11. Snapshots and ILM are different concerns.
12. Legal hold can invalidate naive index-level deletion.
13. Lifecycle policy changes should be reviewed like production migrations.
14. Observability must include lifecycle state, stuck actions, shard growth, and tier usage.
15. A defensible system can explain why data is searchable, where it lives, and when/how it disappears.

---

## 52. How This Part Connects to the Next Part

Part 024 focused on how indices live, age, move, and disappear.

Part 025 will focus on **schema evolution and zero-downtime reindexing**:

- why mappings are hard to change,
- versioned indices,
- alias swap,
- blue/green reindex,
- dual-read/dual-write,
- backfill verification,
- rollback strategy,
- relevance regression during migration,
- Java service orchestration.

Lifecycle and schema evolution are connected:

- lifecycle partitions data over time,
- schema evolution changes how data is represented,
- search APIs often need to query across lifecycle generations and schema generations.

Top-tier Elasticsearch systems treat both as first-class architecture concerns.

---

## References

- Elastic Docs — Index lifecycle management: https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management
- Elastic Docs — Index lifecycle phases and actions: https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management/index-lifecycle
- Elastic Docs — Data streams: https://www.elastic.co/docs/manage-data/data-store/data-streams
- Elastic Docs — Rollover API: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-rollover
- Elastic Docs — Rollover lifecycle action: https://www.elastic.co/docs/reference/elasticsearch/index-lifecycle-actions/ilm-rollover
- Elastic Docs — Data tiers: https://www.elastic.co/docs/manage-data/lifecycle/data-tiers
- Elastic Docs — Configure lifecycle policy: https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management/configure-lifecycle-policy


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Shard, Replica, and Capacity Planning</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-025.md">Part 025 — Schema Evolution and Zero-Downtime Reindexing ➡️</a>
</div>
