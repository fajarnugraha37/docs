# learn-redis-mastery-for-java-engineers-part-017.md

# Part 017 — Redis Streams: Consumer Groups, Pending Entries, dan Practical Event Processing

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `017` dari `034`  
> Target pembaca: Java software engineer yang sudah memahami HTTP, SQL, PostgreSQL/MySQL, Kafka, RabbitMQ, Nginx, dan dasar Redis dari part sebelumnya.  
> Fokus: Redis Streams sebagai struktur data log/stream ringan, consumer group, delivery semantics, pending entries, claim/retry, retention, backpressure, dan arsitektur Java consumer yang realistis.

---

## 0. Posisi Part Ini dalam Seri

Sampai bagian sebelumnya, kita sudah membangun Redis dari beberapa sisi:

- Redis sebagai server command-oriented.
- Redis data model dan keyspace.
- Strings, Hashes, Lists, Sets, Sorted Sets.
- TTL, expiration, eviction.
- Cache architecture.
- Rate limiting.
- Idempotency.
- Distributed lock.
- Lua scripting.
- Redis Functions.
- Pub/Sub sebagai fire-and-forget fanout tanpa durability.

Part ini membahas **Redis Streams**.

Redis Streams sering disalahpahami karena namanya mengandung kata “Streams”. Banyak engineer langsung membandingkannya dengan Kafka, RabbitMQ, atau reactive stream API. Itu berbahaya.

Redis Streams adalah **Redis data type** yang berperilaku seperti append-only log ringan, punya ID berurutan, bisa dibaca dengan range, bisa dibaca blocking, dan punya consumer group untuk pembagian kerja antar consumer.

Tetapi Redis Streams tetap berada di dalam karakter Redis:

- memory-first,
- key-based,
- command-driven,
- punya retention manual/terbatas,
- tidak otomatis menjadi event platform skala Kafka,
- tidak otomatis punya routing model RabbitMQ,
- tidak otomatis cocok sebagai audit log permanen.

Part ini akan membuat Anda mampu menjawab pertanyaan berikut:

1. Apa Redis Streams sebenarnya?
2. Kapan Streams lebih tepat daripada Lists, Pub/Sub, Kafka, atau RabbitMQ?
3. Bagaimana consumer group bekerja?
4. Apa itu Pending Entries List?
5. Bagaimana menangani worker mati, retry, claim, duplicate delivery, dan poison message?
6. Bagaimana mendesain Redis Streams untuk Java service secara aman?
7. Kapan Redis Streams harus dihindari?

---

## 1. Mental Model Redis Streams

Redis Stream adalah struktur data Redis yang menyimpan sequence entries.

Setiap entry memiliki:

- stream key,
- entry ID,
- field-value pairs.

Contoh konseptual:

```text
stream: enforcement:case-events

1680000000000-0  caseId=CASE-001  eventType=SUBMITTED  actor=user-7
1680000000100-0  caseId=CASE-002  eventType=ASSIGNED   actor=system
1680000000200-0  caseId=CASE-001  eventType=REVIEWED   actor=officer-2
```

Stream bukan value tunggal. Stream adalah collection di bawah satu key.

Kalau String adalah:

```text
key -> value
```

Hash adalah:

```text
key -> field -> value
```

Stream adalah:

```text
key -> ordered entries
entry id -> field -> value
```

Entry ID biasanya berbentuk:

```text
milliseconds-sequence
```

Contoh:

```text
1718800000000-0
1718800000000-1
1718800000123-0
```

Bagian pertama biasanya timestamp dalam milidetik. Bagian kedua adalah sequence number untuk membedakan beberapa entry pada milidetik yang sama.

Redis bisa menghasilkan ID otomatis dengan `*`.

```bash
XADD mystream * event created userId 123
```

Redis akan mengembalikan ID entry yang dibuat.

---

## 2. Redis Streams Bukan Pub/Sub

Sebelum masuk command, perlu dipaku dulu perbedaannya.

Pub/Sub:

```text
publisher -> channel -> subscriber yang sedang online
```

Jika subscriber offline, message hilang untuk subscriber tersebut.

Stream:

```text
producer -> stream key -> entry tersimpan -> consumer bisa membaca kemudian
```

Kalau consumer offline, entry masih ada selama belum di-trim/dihapus.

Dengan kata lain:

- Pub/Sub adalah **transient signal**.
- Stream adalah **stored sequence**.

Pub/Sub cocok untuk:

- cache invalidation signal,
- live notification ringan,
- fanout ephemeral,
- event yang boleh hilang.

Streams cocok untuk:

- work queue ringan,
- async processing internal,
- ordered event per key tertentu,
- delayed-ish retry via pending/claim,
- small event log dengan bounded retention,
- real-time processing dengan consumer group sederhana.

Namun Streams tidak otomatis cocok untuk:

- audit log jangka panjang,
- event sourcing utama,
- high-volume distributed event platform,
- multi-region event backbone,
- use case yang butuh retention besar dan replay massif,
- workflow dengan routing kompleks seperti topic/exchange/binding model.

---

## 3. Redis Streams Bukan Kafka

Karena Anda sudah punya materi Kafka, kita tidak perlu mengulang Kafka. Yang penting adalah batas Redis Streams.

Redis Streams punya beberapa konsep yang mirip:

| Konsep | Kafka | Redis Streams |
|---|---|---|
| Append log | Topic partition | Stream key |
| Offset | Offset per partition | Stream entry ID |
| Consumer group | Consumer group | Consumer group |
| Ack | Commit offset | `XACK` |
| Replay | Offset reset | Read from ID/range atau pending reprocessing |
| Retention | Time/size policy broker | Trim stream manual/approx/exact |

Tetapi perbedaan fundamentalnya besar.

Kafka didesain sebagai distributed commit log.

Redis Streams adalah data type di Redis.

Konsekuensinya:

1. Redis Streams berbagi memory dengan key Redis lain.
2. Retention harus sangat dipikirkan supaya memory tidak membengkak.
3. Redis Cluster membagi stream berdasarkan key, bukan partitioning semantic seperti Kafka topic partition.
4. Stream consumer workload bisa mengganggu Redis cache/rate limiter/session workload lain kalau dicampur sembarangan.
5. Redis Streams tidak memberi durability dan scalability envelope yang sama dengan Kafka.
6. Redis Streams lebih cocok untuk internal service-level asynchronous coordination daripada platform event backbone organisasi.

Cara berpikir yang lebih tepat:

```text
Redis Streams = durable-ish in-memory work log / lightweight stream data structure.
Kafka = distributed durable event log platform.
RabbitMQ = broker dengan routing, acknowledgement, queue semantics, dan delivery control.
```

---

## 4. Kapan Redis Streams Layak Dipakai

Redis Streams layak dipertimbangkan ketika:

1. Event volume relatif kecil sampai sedang.
2. Redis sudah ada sebagai dependency operasional yang terkelola baik.
3. Use case membutuhkan durability lebih baik daripada Pub/Sub.
4. Use case tidak membutuhkan full Kafka/RabbitMQ platform.
5. Retention bisa dibatasi dengan jelas.
6. Payload kecil.
7. Consumer group sederhana cukup.
8. Event bukan audit source of truth jangka panjang.
9. Processing bisa idempotent terhadap duplicate delivery.
10. Kegagalan Redis sudah masuk risk model sistem.

Contoh use case realistis:

- background enrichment internal,
- async notification task,
- local event fanout antar service kecil,
- work queue ringan,
- event processor per bounded context,
- delayed investigation job sederhana,
- cache warm-up queue,
- retryable side-effect queue internal,
- stream aktivitas temporer untuk dashboard realtime.

---

## 5. Kapan Redis Streams Sebaiknya Dihindari

Hindari Redis Streams untuk:

1. Audit log permanen.
2. Financial ledger.
3. Enforcement decision record yang harus immutable dan long-retention.
4. Cross-domain enterprise event backbone.
5. Event sourcing canonical state.
6. High-throughput topic dengan banyak independent subscribers.
7. Multi-tenant unbounded event ingestion.
8. Payload besar.
9. Replay historis besar.
10. Use case yang membutuhkan schema registry, compaction, exactly-once transactional producer, atau strong broker governance.

Redis Streams bisa membantu workflow, tetapi jangan jadikan Redis sebagai “Kafka kecil” tanpa konsekuensi.

Pertanyaan arsitektural yang harus dijawab:

```text
Kalau stream hilang, apakah sistem masih benar?
Kalau entry diproses dua kali, apakah sistem masih benar?
Kalau consumer mati selama 2 jam, apakah backlog masih muat memory?
Kalau Redis failover terjadi, apakah duplicate/lost processing masih acceptable?
Kalau retention trimming menghapus entry sebelum diproses, siapa yang tahu?
```

Kalau jawaban tidak jelas, desain belum siap.

---

## 6. Command Dasar: XADD

`XADD` menambahkan entry ke stream.

Format dasar:

```bash
XADD <stream-key> <id> field value [field value ...]
```

Contoh:

```bash
XADD enforcement:case-events * caseId CASE-001 eventType SUBMITTED actor user-7
```

Redis mengembalikan ID:

```text
1718800000000-0
```

Dengan ID otomatis:

```bash
XADD mystream * type created id 123
```

Dengan ID manual:

```bash
XADD mystream 1718800000000-0 type created id 123
```

Biasanya gunakan `*`, kecuali Anda punya alasan kuat mengontrol ID.

### 6.1 Entry Field-Value

Entry bukan JSON object secara native. Entry adalah map field-value.

Contoh:

```bash
XADD order:events * orderId O-123 status PAID amount 100000 currency IDR
```

Field dan value pada Redis protocol pada dasarnya bulk strings. Dari sisi Java, Anda perlu serializer/deserializer.

### 6.2 Payload Strategy

Ada dua pendekatan umum.

Pertama, field-value eksplisit:

```bash
XADD case:events * caseId CASE-1 eventType ASSIGNED actor officer-9 version 3
```

Kedua, envelope + JSON payload:

```bash
XADD case:events * eventType ASSIGNED payload '{"caseId":"CASE-1","actor":"officer-9","version":3}'
```

Field-value eksplisit enak untuk inspection dan routing sederhana.

JSON payload enak untuk schema evolusi yang lebih kompleks.

Namun jangan menyimpan payload besar. Redis Streams tetap memory-costly.

### 6.3 Event Envelope yang Disarankan

Untuk backend Java, entry sebaiknya punya envelope minimal:

```text
eventId
correlationId
causationId
eventType
schemaVersion
producer
occurredAt
entityType
entityId
payload
```

Contoh:

```bash
XADD enforcement:events * \
  eventId 01HZ... \
  correlationId req-abc \
  causationId cmd-789 \
  eventType CASE_SUBMITTED \
  schemaVersion 1 \
  producer enforcement-case-service \
  occurredAt 2026-06-20T10:15:30Z \
  entityType CASE \
  entityId CASE-001 \
  payload '{"priority":"HIGH","jurisdiction":"ID"}'
```

Kenapa perlu `eventId` padahal Stream sudah punya ID?

Karena Stream ID adalah posisi di Redis Stream. `eventId` adalah identity domain/event. Keduanya berbeda.

Stream ID bisa berubah jika event direplay ke stream lain. `eventId` tetap sama.

---

## 7. Membaca Stream: XRANGE dan XREVRANGE

`XRANGE` membaca entries berdasarkan ID range.

```bash
XRANGE enforcement:events - +
```

`-` berarti ID paling awal. `+` berarti ID paling akhir.

Batas jumlah:

```bash
XRANGE enforcement:events - + COUNT 10
```

Baca setelah ID tertentu:

```bash
XRANGE enforcement:events 1718800000000-0 + COUNT 10
```

`XREVRANGE` membaca mundur:

```bash
XREVRANGE enforcement:events + - COUNT 10
```

Use case:

- debugging,
- manual inspection,
- admin tooling,
- replay kecil,
- backfill terbatas.

Jangan gunakan `XRANGE - +` tanpa `COUNT` pada stream besar di production.

---

## 8. Membaca Stream Realtime: XREAD

`XREAD` membaca satu atau beberapa stream.

Contoh membaca entries setelah ID tertentu:

```bash
XREAD COUNT 10 STREAMS enforcement:events 0
```

Baca entries baru setelah last seen ID:

```bash
XREAD COUNT 10 STREAMS enforcement:events 1718800000000-0
```

Blocking read:

```bash
XREAD BLOCK 5000 COUNT 10 STREAMS enforcement:events $
```

`$` berarti mulai dari entry baru setelah saat command dipanggil.

Hati-hati: kalau consumer mulai dengan `$`, entries lama yang sudah ada tidak dibaca.

Untuk consumer custom tanpa consumer group, Anda harus menyimpan last seen ID sendiri.

Biasanya consumer group lebih aman untuk worker pool.

---

## 9. Consumer Group Mental Model

Consumer group membuat beberapa consumer bisa berbagi pekerjaan dari satu stream.

Konsep utamanya:

```text
stream key
  -> consumer group
       -> consumer A
       -> consumer B
       -> consumer C
```

Setiap entry baru akan diberikan kepada salah satu consumer dalam group ketika dibaca dengan `XREADGROUP`.

Consumer group menyimpan state:

- last delivered ID untuk group,
- pending entries yang sudah dikirim ke consumer tetapi belum di-ack,
- idle time pending entry,
- delivery count.

Ini sangat penting.

Consumer group bukan hanya “banyak subscriber”. Ia adalah pembagian kerja dengan acknowledgement.

---

## 10. Membuat Consumer Group: XGROUP CREATE

Format:

```bash
XGROUP CREATE <stream-key> <group-name> <id> [MKSTREAM]
```

Contoh:

```bash
XGROUP CREATE enforcement:events case-indexer-group 0 MKSTREAM
```

Artinya:

- Buat group `case-indexer-group`.
- Mulai membaca dari ID `0`, yaitu dari awal stream.
- `MKSTREAM` membuat stream jika belum ada.

Kalau ingin mulai hanya dari entry baru:

```bash
XGROUP CREATE enforcement:events case-indexer-group $ MKSTREAM
```

Pilihan `0` vs `$` adalah keputusan penting.

| Start ID | Arti | Cocok untuk |
|---|---|---|
| `0` | Proses dari awal stream | Consumer baru yang perlu backfill |
| `$` | Proses hanya entry baru | Consumer baru yang tidak perlu historis |

Dalam production, keputusan ini harus eksplisit dalam deployment/runbook.

---

## 11. Membaca dengan Consumer Group: XREADGROUP

Format:

```bash
XREADGROUP GROUP <group> <consumer> COUNT <n> BLOCK <ms> STREAMS <stream> >
```

Contoh:

```bash
XREADGROUP GROUP case-indexer-group worker-1 COUNT 10 BLOCK 5000 STREAMS enforcement:events >
```

Simbol `>` berarti:

```text
Berikan entry baru yang belum pernah dikirim ke consumer group ini.
```

Jika worker berhasil memproses entry, ia harus mengirim `XACK`.

```bash
XACK enforcement:events case-indexer-group 1718800000000-0
```

Kalau tidak `XACK`, entry masuk Pending Entries List.

---

## 12. Pending Entries List: Konsep Paling Penting

Pending Entries List atau PEL adalah daftar entry yang sudah dikirim ke consumer dalam group, tetapi belum di-ack.

Entry pending bisa terjadi karena:

1. Consumer sedang memproses.
2. Consumer mati sebelum ack.
3. Consumer stuck.
4. Processing error.
5. Timeout eksternal.
6. Bug lupa ack.
7. Ack gagal dikirim.

PEL adalah inti reliability Redis Streams.

Tanpa memahami PEL, consumer group akan menjadi jebakan.

Contoh alur:

```text
1. XADD entry E1
2. worker-1 XREADGROUP membaca E1
3. Redis mencatat E1 pending untuk worker-1
4. worker-1 memproses E1
5. worker-1 XACK E1
6. Redis menghapus E1 dari PEL group
```

Kalau worker mati pada langkah 4:

```text
E1 tetap pending untuk worker-1.
```

Worker lain tidak otomatis menerima E1 sebagai new message.

Harus ada mekanisme recovery:

- inspect pending,
- claim pending,
- retry,
- dead-letter.

---

## 13. Melihat Pending: XPENDING

Summary pending:

```bash
XPENDING enforcement:events case-indexer-group
```

Output konseptual:

```text
pending_count
smallest_pending_id
largest_pending_id
consumer_summary
```

Detail pending:

```bash
XPENDING enforcement:events case-indexer-group - + 10
```

Output tiap entry biasanya mencakup:

- entry ID,
- consumer name,
- idle time,
- delivery count.

Informasi ini penting untuk retry policy.

Contoh interpretasi:

```text
ID: 1718800000000-0
consumer: worker-1
idle: 120000 ms
delivery count: 3
```

Artinya entry ini sudah 2 menit pending dan sudah pernah dikirim 3 kali.

Kalau delivery count tinggi, kemungkinan poison message.

---

## 14. Claim Pending: XCLAIM dan XAUTOCLAIM

Jika worker mati, worker lain perlu mengambil alih pending entry.

Redis menyediakan `XCLAIM` dan `XAUTOCLAIM`.

### 14.1 XCLAIM

`XCLAIM` mengambil entry pending tertentu jika idle lebih dari threshold.

```bash
XCLAIM enforcement:events case-indexer-group worker-2 60000 1718800000000-0
```

Artinya:

```text
Jika entry 1718800000000-0 sudah idle minimal 60000 ms,
claim entry itu ke worker-2.
```

Kelemahannya: Anda perlu tahu ID yang mau di-claim.

Biasanya perlu `XPENDING` dulu.

### 14.2 XAUTOCLAIM

`XAUTOCLAIM` lebih praktis untuk scanning pending entries.

```bash
XAUTOCLAIM enforcement:events case-indexer-group worker-2 60000 0-0 COUNT 10
```

Artinya:

```text
Cari pending entries yang idle minimal 60000 ms,
mulai scan dari 0-0,
claim maksimal 10 entries ke worker-2.
```

`XAUTOCLAIM` mengembalikan cursor next start ID dan entries yang berhasil di-claim.

Ini sangat berguna untuk background recovery loop.

---

## 15. Delivery Semantics Redis Streams

Redis Streams dengan consumer group biasanya memberikan semantic praktis:

```text
at-least-once delivery
```

Artinya entry bisa dikirim lebih dari sekali.

Contoh duplicate:

1. Worker membaca entry.
2. Worker memproses side effect ke database.
3. Worker crash sebelum `XACK`.
4. Entry tetap pending.
5. Worker lain claim dan memproses ulang.

Kalau processing tidak idempotent, side effect bisa terjadi dua kali.

Maka rule utama:

```text
Redis Streams consumer harus idempotent.
```

Jangan mendesain consumer dengan asumsi exactly-once.

Exactly-once adalah ilusi kecuali seluruh chain—read, process, side effect, ack—dikontrol dalam satu transaksi atomic yang sama. Redis Streams tidak memberi itu untuk side effect eksternal.

---

## 16. ACK Timing: Sebelum atau Sesudah Processing?

Ada dua strategi:

### 16.1 Ack Setelah Processing

```text
read -> process -> ack
```

Kelebihan:

- Jika worker mati sebelum selesai, entry bisa diproses ulang.
- Lebih reliable untuk side effect penting.

Kekurangan:

- Duplicate mungkin terjadi kalau side effect sukses tapi ack gagal.
- Butuh idempotency.

Ini default yang lebih aman.

### 16.2 Ack Sebelum Processing

```text
read -> ack -> process
```

Kelebihan:

- Tidak ada pending buildup karena crash saat processing.
- Lower operational complexity.

Kekurangan:

- Jika worker crash setelah ack sebelum process selesai, entry hilang dari perspektif group.
- Cocok hanya untuk event yang boleh hilang.

Untuk kebanyakan use case backend penting, gunakan ack setelah processing.

---

## 17. Idempotency Consumer Pattern

Karena Redis Streams at-least-once, consumer perlu idempotency.

Minimal event harus punya `eventId`.

Processing flow:

```text
1. XREADGROUP entry
2. Extract eventId
3. Try mark eventId as processing/processed
4. If already processed, XACK and skip
5. Execute side effect
6. Mark processed
7. XACK
```

Contoh key idempotency:

```text
idem:stream-consumer:{group}:{eventId}
```

Pattern sederhana:

```bash
SET idem:case-indexer:event-123 processing NX EX 86400
```

Jika gagal karena key sudah ada:

- cek status,
- skip jika completed,
- hati-hati jika masih processing terlalu lama.

Untuk side effect database, lebih baik pakai unique constraint di database target.

Contoh:

```sql
CREATE TABLE processed_stream_events (
    consumer_group VARCHAR(100) NOT NULL,
    event_id VARCHAR(100) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_group, event_id)
);
```

Kenapa database target sering lebih baik?

Karena side effect dan idempotency marker bisa berada dalam transaksi yang sama.

Contoh:

```text
BEGIN
  INSERT processed_event(event_id) -- unique
  UPDATE projection
COMMIT
XACK stream group id
```

Jika ack gagal setelah commit, duplicate read berikutnya akan melihat event sudah processed dan hanya ack.

Ini lebih defensible daripada idempotency marker di Redis untuk side effect SQL.

---

## 18. Poison Message Problem

Poison message adalah entry yang selalu gagal diproses.

Penyebab:

- payload invalid,
- schema version tidak didukung,
- referenced entity tidak ada,
- bug consumer,
- external dependency selalu reject,
- data domain tidak valid.

Kalau tidak ditangani, poison message akan:

- terus pending,
- terus di-claim,
- terus gagal,
- menghabiskan resource,
- menutupi backlog sehat.

### 18.1 Delivery Count sebagai Signal

Redis menyimpan delivery count pending entry.

Policy contoh:

```text
if deliveryCount <= 3:
    retry
else:
    move to dead-letter stream
    ack original
```

### 18.2 Dead-Letter Stream

Gunakan stream lain:

```text
stream: enforcement:events:dlq
```

Entry DLQ sebaiknya menyimpan:

- original stream,
- original entry ID,
- eventId,
- eventType,
- payload,
- failureReason,
- failureClass,
- failedAt,
- consumerGroup,
- consumerName,
- deliveryCount,
- stackTraceHash,
- correlationId.

Contoh:

```bash
XADD enforcement:events:dlq * \
  originalStream enforcement:events \
  originalId 1718800000000-0 \
  eventId event-123 \
  failureClass ValidationException \
  failureReason 'Unsupported schema version 99' \
  failedAt 2026-06-20T10:30:00Z \
  payload '{...}'
```

Setelah masuk DLQ, ack original:

```bash
XACK enforcement:events case-indexer-group 1718800000000-0
```

Ini bukan menghilangkan masalah, tetapi memindahkan masalah ke jalur investigasi eksplisit.

---

## 19. Retention dan Trimming

Redis Streams tidak boleh dibiarkan tumbuh tanpa batas.

Command utama:

```bash
XTRIM
```

Atau trimming saat `XADD`:

```bash
XADD enforcement:events MAXLEN ~ 100000 * eventType CASE_SUBMITTED payload '{}'
```

`MAXLEN ~` berarti approximate trimming. Lebih cepat, tetapi tidak presisi.

Exact trim:

```bash
XADD enforcement:events MAXLEN = 100000 * eventType CASE_SUBMITTED payload '{}'
```

Approx biasanya lebih cocok untuk production throughput.

### 19.1 Retention by Length

```text
Keep latest 100k entries.
```

Kelebihan:

- mudah,
- memory relatif terkendali.

Kekurangan:

- retention time berubah tergantung traffic.
- saat spike, entry lama cepat hilang.

### 19.2 Retention by ID/Time

Anda bisa trim berdasarkan min ID:

```bash
XTRIM enforcement:events MINID ~ 1718800000000-0
```

Ini lebih mendekati retention berbasis waktu.

Namun tetap perlu operational discipline.

### 19.3 Bahaya Trimming terhadap Consumer Group

Jika entry di-trim sebelum consumer memproses, consumer bisa kehilangan data.

Desain retention harus mempertimbangkan:

```text
max_producer_rate
max_consumer_lag
max_outage_duration
entry_size
available_memory
recovery_time_objective
```

Rumus kasar:

```text
required_entries = peak_events_per_second * max_outage_seconds * safety_factor
```

Memory kasar:

```text
required_memory = required_entries * average_entry_memory_bytes
```

Jangan hanya memilih angka seperti 10.000 karena terlihat rapi.

---

## 20. Backpressure

Redis Streams tidak otomatis memberi backpressure end-to-end seperti sistem broker yang lebih kaya.

Jika producer lebih cepat daripada consumer:

- stream length naik,
- memory naik,
- consumer lag naik,
- trimming bisa menghapus entry belum diproses,
- Redis latency bisa terdampak,
- workload Redis lain ikut terganggu.

Backpressure harus didesain.

### 20.1 Producer-Side Guard

Sebelum `XADD`, producer bisa cek panjang stream:

```bash
XLEN enforcement:events
```

Jika terlalu besar:

- reject request,
- degrade feature,
- route ke broker lain,
- shed load,
- slow down,
- write to durable DB outbox instead.

Namun `XLEN` saja tidak cukup untuk multi-group lag.

### 20.2 Consumer Lag Monitoring

Gunakan `XINFO GROUPS`:

```bash
XINFO GROUPS enforcement:events
```

Anda perlu monitor:

- pending count,
- lag,
- last delivered ID,
- consumers count.

### 20.3 Scaling Consumer

Anda bisa menambah consumer dalam group.

Tetapi ada batas:

- Redis command throughput,
- external dependency throughput,
- per-entry processing cost,
- idempotency store contention,
- hot partition jika hanya satu stream key.

Menambah worker tidak selalu menyelesaikan backlog.

Kalau bottleneck-nya database target, menambah consumer justru memperparah.

---

## 21. Stream Partitioning dan Key Design

Satu stream key adalah satu ordered sequence.

Kalau throughput tinggi, Anda bisa membuat beberapa stream key.

Contoh:

```text
enforcement:events:{00}
enforcement:events:{01}
enforcement:events:{02}
...
enforcement:events:{15}
```

Partition berdasarkan hash entity ID:

```text
partition = hash(caseId) % 16
```

Keuntungan:

- parallelism lebih tinggi,
- backlog per partition lebih kecil,
- hot partition bisa diamati.

Kekurangan:

- consumer orchestration lebih kompleks,
- ordering global hilang,
- consumer perlu membaca banyak stream,
- Redis Cluster hash slot harus diperhatikan.

### 21.1 Ordering Semantics

Tentukan ordering yang benar-benar diperlukan.

Sering kali yang diperlukan bukan global order, tetapi per-entity order.

Contoh case management:

```text
Event untuk CASE-001 harus diproses berurutan.
Event antara CASE-001 dan CASE-002 boleh paralel.
```

Maka partition by `caseId` masuk akal.

Tetapi kalau consumer group punya banyak worker pada stream yang sama, Redis membagikan entries ke consumer berbeda. Processing completion order bisa berbeda dari delivery order.

Kalau strict per-entity sequential processing penting, Anda butuh strategi tambahan:

- partition stream by entity hash,
- single worker per partition,
- per-entity lock/sequencer,
- detect version gap,
- use database optimistic version check.

Jangan menganggap Stream otomatis menjaga business ordering di downstream.

---

## 22. Redis Cluster Considerations

Dalam Redis Cluster, key berada di hash slot.

Stream adalah key. Consumer group melekat pada stream key.

Multi-stream reads pada cluster bisa menjadi rumit jika keys berada di slot berbeda.

Strategi:

1. Gunakan stream per bounded context dan biarkan client cluster-aware.
2. Jika butuh multi-key atomic/script, pakai hash tag agar keys satu slot.
3. Hindari desain yang membutuhkan operasi cross-slot atomic.

Contoh hash tag:

```text
enforcement:{case-events}:stream
enforcement:{case-events}:dlq
enforcement:{case-events}:metrics
```

Semua key dengan `{case-events}` berada di slot yang sama.

Namun menaruh terlalu banyak traffic di satu slot dapat menciptakan hot slot.

Trade-off:

```text
same slot -> bisa multi-key local, tapi risk hot slot
many slots -> scalable, tapi multi-key atomic sulit
```

---

## 23. Java Integration: Lettuce Basic Consumer

Lettuce adalah client Redis Java yang mendukung sync, async, dan reactive API.

Pseudo-dependency Maven:

```xml
<dependency>
  <groupId>io.lettuce</groupId>
  <artifactId>lettuce-core</artifactId>
  <version><!-- gunakan versi terbaru yang sesuai BOM project --></version>
</dependency>
```

Contoh konseptual consumer sync:

```java
import io.lettuce.core.RedisClient;
import io.lettuce.core.StreamMessage;
import io.lettuce.core.XReadArgs;
import io.lettuce.core.Consumer;
import io.lettuce.core.models.stream.ClaimedMessages;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;

import java.time.Duration;
import java.util.List;
import java.util.Map;

public final class RedisStreamWorker implements Runnable {

    private final RedisCommands<String, String> redis;
    private final String streamKey;
    private final String group;
    private final String consumer;
    private volatile boolean running = true;

    public RedisStreamWorker(
            RedisCommands<String, String> redis,
            String streamKey,
            String group,
            String consumer
    ) {
        this.redis = redis;
        this.streamKey = streamKey;
        this.group = group;
        this.consumer = consumer;
    }

    @Override
    public void run() {
        while (running) {
            try {
                List<StreamMessage<String, String>> messages = redis.xreadgroup(
                        Consumer.from(group, consumer),
                        XReadArgs.Builder.block(Duration.ofSeconds(5)).count(10),
                        XReadArgs.StreamOffset.lastConsumed(streamKey)
                );

                for (StreamMessage<String, String> message : messages) {
                    processOne(message);
                }
            } catch (Exception e) {
                // Log, metric, bounded sleep.
                // Jangan tight-loop saat Redis/downstream error.
                sleepQuietly(Duration.ofSeconds(1));
            }
        }
    }

    private void processOne(StreamMessage<String, String> message) {
        String messageId = message.getId();
        Map<String, String> body = message.getBody();

        try {
            handleBusinessLogic(messageId, body);
            redis.xack(streamKey, group, messageId);
        } catch (RetryableProcessingException e) {
            // Jangan ack. Biarkan masuk PEL dan recovery loop melakukan retry/claim.
            recordRetryableFailure(messageId, e);
        } catch (NonRetryableProcessingException e) {
            moveToDeadLetter(messageId, body, e);
            redis.xack(streamKey, group, messageId);
        }
    }

    private void handleBusinessLogic(String messageId, Map<String, String> body) {
        // Parse envelope, validate schemaVersion, execute idempotent side effect.
    }

    private void moveToDeadLetter(String messageId, Map<String, String> body, Exception e) {
        redis.xadd(streamKey + ":dlq", Map.of(
                "originalId", messageId,
                "failureClass", e.getClass().getSimpleName(),
                "failureReason", safeMessage(e),
                "payload", body.toString()
        ));
    }

    private void recordRetryableFailure(String messageId, Exception e) {
        // Metric/log only. Recovery loop decides claim policy.
    }

    public void stop() {
        this.running = false;
    }

    private static void sleepQuietly(Duration duration) {
        try {
            Thread.sleep(duration.toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static String safeMessage(Exception e) {
        return e.getMessage() == null ? "" : e.getMessage();
    }

    static class RetryableProcessingException extends RuntimeException {}
    static class NonRetryableProcessingException extends RuntimeException {}
}
```

Catatan:

- Contoh ini konseptual, bukan production-ready penuh.
- Production code perlu graceful shutdown, metrics, tracing, idempotency, DLQ serializer, retry policy, dan recovery loop.
- Jangan share blocking stream read connection dengan command latency-sensitive lain tanpa memahami client behavior.

---

## 24. Membuat Group Secara Aman dari Java

Group creation sering race saat banyak instance start bersamaan.

Pseudo-code:

```java
try {
    redis.xgroupCreate(
        XReadArgs.StreamOffset.from(streamKey, "0-0"),
        group,
        XGroupCreateArgs.Builder.mkstream()
    );
} catch (RedisBusyException alreadyExists) {
    // BUSYGROUP Consumer Group name already exists
    // safe to ignore
}
```

Prinsipnya:

```text
Create group idempotently at startup or migration phase.
```

Jangan manual create di production tanpa IaC/runbook.

Lebih baik group creation dikelola sebagai migration/bootstrapping step.

---

## 25. Spring Data Redis Consumer Pattern

Spring Data Redis menyediakan `StreamMessageListenerContainer` untuk stream listener.

Konsepnya:

```java
StreamMessageListenerContainer<String, MapRecord<String, String, String>> container = ...;

container.receive(
    Consumer.from("case-indexer-group", "worker-1"),
    StreamOffset.create("enforcement:events", ReadOffset.lastConsumed()),
    message -> {
        // process
        // ack
    }
);
```

Dengan Spring, hati-hati terhadap beberapa hal:

1. Default serializer.
2. Error handler.
3. Ack mode.
4. Threading model.
5. Container lifecycle.
6. Backpressure ke executor.
7. Graceful shutdown.
8. Observability.

Spring abstraction membantu wiring, tetapi tidak menghapus kebutuhan memahami PEL, claim, idempotency, dan DLQ.

---

## 26. Recommended Java Consumer Architecture

Untuk production, pisahkan komponen.

```text
RedisStreamProducer
RedisStreamConsumer
StreamMessageDeserializer
StreamMessageValidator
IdempotencyService
BusinessHandler
AckManager
DeadLetterPublisher
PendingRecoveryWorker
StreamMetricsPublisher
```

### 26.1 Producer

Tanggung jawab:

- membangun event envelope,
- validasi payload size,
- set schemaVersion,
- generate eventId,
- add correlationId,
- publish via XADD dengan MAXLEN/MINID policy jika dipilih.

Producer tidak boleh asal `xadd(Map.of(...))` tanpa kontrak.

### 26.2 Consumer

Tanggung jawab:

- read batch,
- deserialize,
- validate,
- call handler,
- ack setelah sukses,
- classify failure.

### 26.3 Recovery Worker

Tanggung jawab:

- periodically scan pending idle entries,
- claim eligible entries,
- retry,
- DLQ setelah max delivery count,
- emit metrics.

Recovery worker bisa berjalan di setiap instance dengan coordination sederhana, atau satu dedicated worker.

### 26.4 DLQ Processor

Tanggung jawab:

- inspect DLQ,
- expose admin tooling,
- allow replay setelah fix,
- record human intervention.

Untuk regulatory system, DLQ bukan tempat sampah. DLQ adalah evidence queue untuk investigasi teknis.

---

## 27. Failure Matrix

| Failure | Dampak | Mitigasi |
|---|---|---|
| Producer gagal sebelum `XADD` | Event tidak masuk stream | Outbox DB jika event penting |
| Producer timeout setelah `XADD` sukses | Producer tidak tahu event terkirim | eventId idempotency, producer retry safe |
| Consumer crash sebelum processing | Entry pending | claim/recovery |
| Consumer crash setelah side effect sebelum ack | Duplicate processing | idempotent handler |
| Consumer lupa ack | Pending buildup | metrics + alert pending idle |
| Payload invalid | Retry sia-sia | validation + DLQ |
| Consumer lambat | Lag naik | scale carefully, optimize dependency |
| Redis memory penuh | XADD bisa gagal/evict tergantung policy | maxmemory policy, retention, alerts |
| Stream trimmed terlalu agresif | Data belum diproses hilang | retention sizing, lag monitoring |
| Redis failover | Duplicate/lost depending timing | idempotency, recovery testing |
| DLQ tidak dimonitor | Silent data loss secara bisnis | DLQ dashboard + ownership |

---

## 28. Producer Reliability: Outbox vs Direct XADD

Untuk event yang penting, direct `XADD` dari request transaction sering tidak cukup.

Contoh buruk:

```text
1. Update database case status to SUBMITTED
2. XADD case-submitted event to Redis Stream
```

Jika langkah 1 sukses dan langkah 2 gagal, state berubah tetapi event tidak keluar.

Solusi yang lebih kuat: transactional outbox.

```text
1. Dalam transaksi database:
   - update case status
   - insert outbox event
2. Background publisher membaca outbox
3. Publisher XADD ke Redis Stream
4. Mark outbox published
```

Ini sudah Anda kenal dari materi messaging, tetapi di sini konteksnya Redis Streams.

Redis Streams tidak menghilangkan dual-write problem.

Jika event hanyalah optimization atau async cache warming, direct `XADD` mungkin cukup.

Jika event adalah bagian correctness, gunakan outbox atau broker yang sesuai.

---

## 29. Consumer Transaction Boundary

Misal consumer memperbarui projection SQL.

Flow aman:

```text
1. Read stream message
2. Begin SQL transaction
3. Insert processed_event(eventId, group) with unique constraint
4. If duplicate, rollback/commit no-op then XACK
5. Apply projection update
6. Commit
7. XACK stream message
```

Jika crash setelah commit sebelum XACK:

- message akan retry,
- insert processed_event duplicate,
- consumer tahu sudah processed,
- consumer XACK.

Ini pattern yang sangat kuat.

Jangan lakukan:

```text
1. XACK
2. Update DB
```

kecuali kehilangan processing acceptable.

---

## 30. Batching Strategy

`XREADGROUP COUNT 10` membaca batch.

Batching membantu throughput karena mengurangi round trip.

Tetapi batch terlalu besar bisa:

- membuat processing latency per entry naik,
- membuat pending banyak sekaligus,
- memperbesar duplicate batch saat crash,
- menekan memory aplikasi,
- memperlama shutdown.

Mulai dengan batch kecil:

```text
COUNT 10 atau 50
```

Kemudian ukur:

- processing time per entry,
- batch processing time,
- ack latency,
- pending count,
- Redis CPU,
- downstream saturation.

### 30.1 Ack per Entry vs Ack Batch

Anda bisa ack beberapa ID sekaligus.

```bash
XACK enforcement:events case-indexer-group id1 id2 id3
```

Ack batch mengurangi round trip.

Tetapi jangan ack entry yang belum sukses diproses.

Pattern:

```text
process each entry
collect successful IDs
XACK successful IDs
failed retryable stays pending
failed non-retryable DLQ then collect ack
```

---

## 31. Retry Strategy

Redis Streams tidak punya built-in retry delay seperti beberapa broker.

Dengan PEL, retry berbasis idle time:

```text
If pending idle > minIdleTime, claim and retry.
```

Policy contoh:

```text
minIdleTime = 60 seconds
maxDelivery = 5
```

Pseudo-flow:

```text
loop every 30 seconds:
  XAUTOCLAIM idle > 60s COUNT 20
  for each claimed:
    if deliveryCount > 5:
       XADD DLQ
       XACK original
    else:
       process again
```

Jika butuh exponential backoff presisi, Redis Streams saja tidak cukup elegan.

Alternatif:

- gunakan Sorted Set delay queue untuk retry schedule,
- gunakan stream khusus retry-N,
- gunakan broker yang punya delayed retry/dead-letter semantics lebih kuat,
- simpan retry schedule di DB.

Jangan memaksakan Redis Streams untuk seluruh retry workflow kompleks.

---

## 32. Observability untuk Redis Streams

Minimal metrics:

### 32.1 Producer Metrics

- `stream_xadd_success_total`
- `stream_xadd_failure_total`
- `stream_xadd_latency_ms`
- `stream_payload_size_bytes`
- `stream_length`

### 32.2 Consumer Metrics

- `stream_read_count`
- `stream_process_success_total`
- `stream_process_failure_total`
- `stream_ack_success_total`
- `stream_ack_failure_total`
- `stream_processing_latency_ms`
- `stream_batch_size`
- `stream_idle_poll_total`

### 32.3 Group Metrics

- pending count,
- lag,
- consumers count,
- idle pending age max,
- delivery count distribution,
- oldest pending age.

### 32.4 DLQ Metrics

- DLQ entries total,
- DLQ by failure class,
- DLQ oldest age,
- replay success/failure.

### 32.5 Redis Instance Metrics

- used memory,
- memory fragmentation,
- commandstats for `XADD`, `XREADGROUP`, `XACK`, `XPENDING`, `XAUTOCLAIM`,
- slowlog,
- CPU,
- connected clients,
- rejected connections,
- evicted keys.

Alerts harus berbasis konsekuensi:

```text
pending age > SLA
DLQ count increasing
stream length growing faster than consumer drain rate
Redis memory > threshold
XADD failures > 0
consumer group has zero active consumers
```

---

## 33. Admin Runbook

Untuk setiap stream production, dokumentasikan:

```text
Stream key:
Owner service:
Producer service:
Consumer groups:
Retention policy:
Average event size:
Peak event rate:
Max acceptable lag:
DLQ key:
Replay procedure:
Idempotency mechanism:
Schema versions:
On-call owner:
Dashboard:
Alert rules:
```

Tanpa ini, Redis Streams akan menjadi hidden dependency yang sulit dioperasikan.

### 33.1 Useful Commands

Inspect stream length:

```bash
XLEN enforcement:events
```

Inspect stream metadata:

```bash
XINFO STREAM enforcement:events
```

Inspect groups:

```bash
XINFO GROUPS enforcement:events
```

Inspect consumers:

```bash
XINFO CONSUMERS enforcement:events case-indexer-group
```

Inspect pending:

```bash
XPENDING enforcement:events case-indexer-group
```

Read recent entries:

```bash
XREVRANGE enforcement:events + - COUNT 10
```

Read DLQ:

```bash
XREVRANGE enforcement:events:dlq + - COUNT 10
```

---

## 34. Schema Evolution

Stream entries hidup lebih lama daripada request memory. Maka schema evolution penting.

Prinsip:

1. Tambahkan `schemaVersion`.
2. Consumer harus toleran terhadap field tambahan.
3. Jangan langsung menghapus field lama.
4. Gunakan additive changes dulu.
5. Untuk breaking change, buat event type baru atau schema version baru.
6. DLQ untuk unsupported schema harus jelas.
7. Replay lama harus masih bisa diproses atau sengaja ditolak dengan prosedur.

Contoh handler:

```java
switch (eventType) {
    case "CASE_SUBMITTED" -> {
        int schemaVersion = parseSchemaVersion(body);
        if (schemaVersion == 1) handleCaseSubmittedV1(body);
        else if (schemaVersion == 2) handleCaseSubmittedV2(body);
        else throw new NonRetryableProcessingException("Unsupported schema version: " + schemaVersion);
    }
    default -> throw new NonRetryableProcessingException("Unknown eventType: " + eventType);
}
```

Dalam sistem regulatori, “unknown event ignored” adalah anti-pattern kecuali memang ada kontrak eksplisit.

Lebih aman:

```text
unknown event -> DLQ + alert
```

---

## 35. Payload Size Discipline

Redis Streams tidak cocok untuk payload besar.

Simpan pointer jika payload besar.

Contoh:

```text
eventId=...
payloadRef=s3://bucket/object
payloadHash=sha256:...
payloadSize=...
```

Atau simpan detail di database dan stream hanya membawa ID:

```text
eventType=CASE_REQUIRES_REVIEW
caseId=CASE-001
version=17
```

Consumer mengambil detail dari database.

Trade-off:

- payload kecil di stream: consumer lebih mandiri, memory lebih mahal.
- payload ref: memory hemat, consumer tergantung storage eksternal.

Untuk event penting, simpan canonical payload di durable store, bukan hanya Redis.

---

## 36. Security dan Multi-Tenancy

Stream bisa berisi data sensitif.

Jangan asal memasukkan:

- PII,
- credential,
- access token,
- raw document,
- enforcement evidence sensitif,
- informasi rahasia regulator.

Gunakan:

- data minimization,
- payload reference,
- encryption at application layer bila perlu,
- Redis ACL,
- TLS,
- network isolation,
- separate Redis untuk domain sensitif.

Multi-tenant stream harus hati-hati.

Key design contoh:

```text
tenant:{tenantId}:events
```

Tetapi kalau tenantId langsung dari user input, validasi ketat.

Jangan buat tenant bisa mempengaruhi key namespace sembarangan.

---

## 37. Common Anti-Patterns

### 37.1 Stream Tanpa Retention

```text
XADD terus, tidak pernah XTRIM.
```

Akibat:

- memory naik,
- Redis melambat,
- eviction/failure,
- outage meluas.

### 37.2 Consumer Tanpa XACK

Entry selalu pending.

Akibat:

- PEL membengkak,
- retry kacau,
- operator bingung.

### 37.3 Tidak Ada DLQ

Poison message retry selamanya.

### 37.4 Ack Sebelum Side Effect Penting

Data bisa hilang saat consumer crash.

### 37.5 Tidak Idempotent

Duplicate delivery menyebabkan duplicate side effect.

### 37.6 Stream sebagai Audit Log

Redis memory-first bukan tempat utama audit permanen.

### 37.7 Payload Terlalu Besar

Redis memory habis, latency naik.

### 37.8 Satu Redis untuk Semua

Cache, lock, session, rate limiter, stream, search semuanya dicampur tanpa isolation.

Akibat:

- stream backlog bisa merusak cache latency,
- cache eviction bisa mengganggu stream workload,
- incident blast radius besar.

### 37.9 Menganggap Consumer Group Sama dengan Kafka Group

Mirip secara nama, tetapi operational model berbeda.

### 37.10 Tidak Menguji Failover

Saat Redis failover, consumer behavior bisa mengejutkan.

Test failure, bukan hanya happy path.

---

## 38. Practical Design Example: Case Review Projection

Misal kita punya service enforcement case.

Kebutuhan:

- Saat case berubah status, update projection untuk dashboard reviewer.
- Projection boleh eventually consistent.
- Kalau event diproses dua kali, projection harus tetap benar.
- Event bukan audit canonical; audit tetap di PostgreSQL.
- Redis Streams dipakai untuk async internal projection.

### 38.1 Stream

```text
enforcement:case-events
```

### 38.2 Consumer Group

```text
case-review-projection-group
```

### 38.3 Entry

```text
eventId=01J...
eventType=CASE_STATUS_CHANGED
schemaVersion=1
caseId=CASE-001
oldStatus=DRAFT
newStatus=SUBMITTED
caseVersion=12
occurredAt=2026-06-20T10:00:00Z
correlationId=req-123
producer=enforcement-case-service
```

### 38.4 Projection DB Table

```sql
CREATE TABLE reviewer_case_projection (
    case_id VARCHAR(64) PRIMARY KEY,
    status VARCHAR(50) NOT NULL,
    case_version BIGINT NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE processed_projection_events (
    consumer_group VARCHAR(100) NOT NULL,
    event_id VARCHAR(100) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_group, event_id)
);
```

### 38.5 Consumer Logic

```text
read event
validate schema
begin transaction
insert processed event; if duplicate -> commit and ack
update projection only if incoming caseVersion >= current caseVersion
commit
ack
```

### 38.6 Why Version Check?

Because processing completion order may differ from event order.

If event version 13 processed before version 12, version 12 must not overwrite projection backward.

SQL:

```sql
UPDATE reviewer_case_projection
SET status = ?, case_version = ?, updated_at = ?
WHERE case_id = ?
  AND case_version < ?;
```

This protects against out-of-order processing.

### 38.7 Retention

Assume:

```text
peak: 200 events/s
max outage: 2 hours
safety factor: 2
```

Required entries:

```text
200 * 7200 * 2 = 2,880,000 entries
```

If average entry memory roughly 500 bytes to 1 KB, memory could be multiple GB.

This may already be too expensive for Redis if shared.

Architectural conclusion might be:

```text
Use Kafka/RabbitMQ/outbox for this if outage window and volume are high.
Use Redis Streams only if volume/retention is bounded and Redis capacity is dedicated.
```

This is senior reasoning: not “Redis can”, but “Redis should under these constraints”.

---

## 39. Practical Design Example: Lightweight Notification Fanout with Durability

Use case:

- Service wants to notify websocket gateway about UI update.
- If gateway restarts briefly, notification should not be lost immediately.
- If lost after a few minutes, acceptable because UI can refresh state.

Redis Pub/Sub may be too ephemeral.
Redis Streams may be appropriate.

Stream:

```text
ui:notifications
```

Retention:

```text
MAXLEN ~ 10000
```

Consumer group:

```text
websocket-gateway-group
```

Payload:

```text
notificationId
tenantId
userId
notificationType
entityId
occurredAt
```

Consumer:

- read stream,
- send websocket event,
- ack after gateway enqueue,
- if user offline, maybe ack anyway because UI refresh can catch up.

This is a good Redis Streams use case because:

- bounded retention,
- payload small,
- loss acceptable after window,
- simple consumer group,
- not audit-critical.

---

## 40. Practical Design Example: Bad Fit

Use case:

- All enforcement lifecycle events must be retained 7 years.
- Events are used for legal audit.
- Must support replay by regulator investigation.
- Must support schema history.
- Must handle high traffic bursts.
- Must be queryable later.

Redis Streams is a bad primary store.

Better:

- PostgreSQL audit table,
- append-only immutable ledger store,
- object storage archive,
- Kafka for event transport if needed,
- Redis only for transient projection/notification acceleration.

Redis Streams can still be used as derived async work queue, but not as source of truth.

---

## 41. Testing Strategy

### 41.1 Integration Test with Testcontainers

Use real Redis in tests.

Test:

1. create stream group,
2. produce message,
3. consume message,
4. process success,
5. ack,
6. assert pending empty.

### 41.2 Crash Before Ack

Test:

1. consume message,
2. simulate processing success,
3. do not ack,
4. inspect pending,
5. claim,
6. process duplicate idempotently,
7. ack.

### 41.3 Poison Message

Test:

1. produce invalid schema,
2. consumer classifies non-retryable,
3. writes DLQ,
4. ack original,
5. alert metric increments.

### 41.4 Retention Test

Test maxlen behavior with enough entries.

Do not assume exact count when using approximate trimming.

### 41.5 Out-of-Order Test

Produce version 2 then version 1, or process version 2 before version 1.

Assert projection does not regress.

---

## 42. Performance Notes

Redis Streams can be fast, but performance depends on:

- entry size,
- number of fields,
- stream length,
- pending size,
- consumer count,
- trimming mode,
- pipelining,
- network latency,
- Redis CPU,
- persistence settings,
- replication/failover,
- cluster topology.

Avoid microbenchmark conclusions like:

```text
Redis can do X ops/sec, so architecture is safe.
```

Benchmark your actual shape:

- realistic payload,
- realistic consumer processing,
- realistic retention,
- realistic failure/retry,
- same persistence config,
- same network topology.

---

## 43. Decision Framework

Use Redis Streams when all are true:

```text
[ ] Event retention is bounded.
[ ] Payload is small.
[ ] Duplicate processing is safe.
[ ] Consumer lag is monitored.
[ ] DLQ exists.
[ ] Redis memory budget includes stream growth.
[ ] Stream is not the canonical audit/source-of-truth.
[ ] Operational team knows XINFO/XPENDING/XAUTOCLAIM.
[ ] Failure and failover tests exist.
```

Avoid Redis Streams when any are true:

```text
[ ] Need long-term immutable audit.
[ ] Need high-volume event platform.
[ ] Need complex routing/delayed retry/dead-letter semantics.
[ ] Need large replay history.
[ ] Payloads are large.
[ ] Consumer cannot be idempotent.
[ ] Redis is already latency-critical shared cache with tight memory.
```

---

## 44. Command Cheat Sheet

Produce:

```bash
XADD mystream * field value
XADD mystream MAXLEN ~ 100000 * field value
```

Read range:

```bash
XRANGE mystream - + COUNT 10
XREVRANGE mystream + - COUNT 10
```

Read without group:

```bash
XREAD COUNT 10 BLOCK 5000 STREAMS mystream $
```

Create group:

```bash
XGROUP CREATE mystream mygroup 0 MKSTREAM
XGROUP CREATE mystream mygroup $ MKSTREAM
```

Read group:

```bash
XREADGROUP GROUP mygroup consumer-1 COUNT 10 BLOCK 5000 STREAMS mystream >
```

Ack:

```bash
XACK mystream mygroup 1718800000000-0
```

Pending:

```bash
XPENDING mystream mygroup
XPENDING mystream mygroup - + 10
```

Claim:

```bash
XCLAIM mystream mygroup consumer-2 60000 1718800000000-0
XAUTOCLAIM mystream mygroup consumer-2 60000 0-0 COUNT 10
```

Info:

```bash
XINFO STREAM mystream
XINFO GROUPS mystream
XINFO CONSUMERS mystream mygroup
```

Trim:

```bash
XTRIM mystream MAXLEN ~ 100000
XTRIM mystream MINID ~ 1718800000000-0
```

---

## 45. Review Checklist untuk Design Review

Gunakan checklist ini saat ada proposal memakai Redis Streams.

### 45.1 Purpose

```text
Apa stream ini menyelesaikan masalah apa?
Kenapa bukan Pub/Sub?
Kenapa bukan List?
Kenapa bukan RabbitMQ/Kafka?
Apakah stream ini source of truth atau derived/transient?
```

### 45.2 Data Contract

```text
Apa event types?
Apa schema versioning policy?
Apakah ada eventId?
Apakah payload kecil?
Apakah ada PII/sensitive data?
```

### 45.3 Retention

```text
Berapa peak rate?
Berapa retention window?
Berapa average entry size?
Berapa memory budget?
Apa yang terjadi saat backlog melebihi retention?
```

### 45.4 Consumer

```text
Berapa consumer group?
Apakah handler idempotent?
Ack dilakukan kapan?
Bagaimana retry?
Bagaimana DLQ?
Bagaimana replay?
```

### 45.5 Operations

```text
Apa dashboard?
Apa alert?
Siapa owner?
Apa runbook pending buildup?
Apa runbook DLQ?
Apa failover behavior yang sudah diuji?
```

---

## 46. Summary Mental Model

Redis Streams adalah:

```text
ordered, append-oriented Redis data type
with entry IDs, field-value payloads,
blocking reads, consumer groups,
acknowledgement, pending entries,
and manual retention discipline.
```

Gunakan Redis Streams sebagai:

- lightweight internal event/work log,
- better-than-Pub/Sub durable-ish queue,
- small bounded stream,
- asynchronous processing primitive.

Jangan gunakan Redis Streams sebagai:

- universal broker,
- audit ledger,
- Kafka replacement by default,
- hidden unbounded database,
- exactly-once processing guarantee.

Skill utama bukan menghafal `XADD` dan `XREADGROUP`.

Skill utama adalah memahami invariants:

```text
Every message may be delivered more than once.
Every pending message needs ownership/recovery.
Every stream needs retention.
Every consumer needs idempotency.
Every DLQ needs human/operational ownership.
Every Redis memory byte is shared capacity.
```

Jika Anda memegang invariants itu, Redis Streams bisa sangat berguna.

Jika tidak, Streams akan menjadi sumber outage yang sulit dilacak.

---

## 47. Latihan Mandiri

### Latihan 1 — Basic Stream

1. Buat stream `lab:events`.
2. Tambah 5 entry dengan `XADD`.
3. Baca dengan `XRANGE`.
4. Baca mundur dengan `XREVRANGE`.
5. Catat format ID.

### Latihan 2 — Consumer Group

1. Buat group `lab-group` dari awal stream.
2. Jalankan consumer `worker-1`.
3. Baca 2 entry dengan `XREADGROUP`.
4. Ack 1 entry.
5. Lihat pending dengan `XPENDING`.

### Latihan 3 — Claim

1. Biarkan 1 entry pending.
2. Claim entry itu ke `worker-2` setelah idle threshold.
3. Ack dari `worker-2`.
4. Lihat pending kosong.

### Latihan 4 — DLQ

1. Buat event invalid.
2. Consumer mendeteksi invalid schema.
3. Tulis ke `lab:events:dlq`.
4. Ack original.
5. Inspect DLQ.

### Latihan 5 — Java Idempotent Consumer

1. Buat consumer Java dengan Lettuce/Spring Data Redis.
2. Simpan processed event ke PostgreSQL/H2 dengan unique key.
3. Simulasikan crash setelah commit sebelum ack.
4. Pastikan retry tidak menggandakan side effect.

---

## 48. Penutup Part 017

Di bagian ini kita membahas Redis Streams dari sisi mental model, command, consumer group, pending entries, claim/retry, DLQ, retention, backpressure, Java integration, dan failure modeling.

Part ini sengaja menekankan batas Redis Streams karena banyak desain gagal bukan karena Redis tidak mampu, tetapi karena Redis dipakai tanpa kontrak operasional.

Redis Streams adalah alat yang kuat jika:

- bounded,
- monitored,
- idempotent,
- punya DLQ,
- bukan source of truth jangka panjang,
- dipakai untuk use case yang memang sesuai.

Pada part berikutnya, kita masuk ke data structures yang lebih compact dan probabilistic:

```text
Part 018 — Bitmaps, Bitfields, HyperLogLog: Compact State dan Approximation
```

Kita akan belajar bagaimana Redis bisa menyimpan state masif dengan memory kecil, tetapi juga bagaimana approximation dapat menjadi bahaya jika dipakai untuk keputusan yang membutuhkan akurasi/auditability.

---

## Status Seri

```text
Part 017 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-018.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Redis Pub/Sub: Real-Time Fanout Tanpa Durability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-018.md">Part 018 — Bitmaps, Bitfields, HyperLogLog: Compact State dan Approximation ➡️</a>
</div>
