# learn-redis-mastery-for-java-engineers-part-005.md

# Part 005 — Redis Lists: Queue Primitive, Log Kecil, dan Blocking Pop

## Status Seri

- Series: `learn-redis-mastery-for-java-engineers`
- Part: `005`
- Judul: `Redis Lists: Queue Primitive, Log Kecil, dan Blocking Pop`
- Target pembaca: Java software engineer yang ingin memakai Redis secara benar dalam sistem backend production
- Posisi dalam seri:
  - Part 000: orientasi Redis sebagai sistem
  - Part 001: core mental model Redis server, command, event loop
  - Part 002: data model, keyspace, types, encodings
  - Part 003: Strings
  - Part 004: Hashes
  - Part 005: Lists

> Bagian ini tidak mengulang teori messaging dari Kafka/RabbitMQ. Fokusnya adalah Redis Lists sebagai primitive internal Redis: apa yang bisa dijamin, apa yang tidak, bagaimana failure model-nya, dan kapan masih masuk akal dipakai dalam service Java.

---

# 1. Kenapa Redis Lists Penting?

Redis List adalah salah satu data structure paling tua dan paling praktis di Redis. Banyak engineer pertama kali memakai Redis List untuk membuat:

- queue sederhana,
- worker queue internal,
- recent activity feed,
- bounded log kecil,
- retry list,
- delay-ish processing sederhana,
- pipeline antar proses kecil,
- temporary buffer.

Tetapi Redis List sering disalahpahami.

Banyak orang melihat command seperti `LPUSH`, `RPOP`, `BLPOP`, lalu menyimpulkan:

> Redis bisa jadi message broker.

Kesimpulan itu terlalu kasar.

Mental model yang lebih akurat:

> Redis List adalah ordered sequence yang bisa dimanipulasi dari dua ujung dengan operasi cepat. Dengan blocking pop, ia bisa dipakai sebagai queue sederhana. Tetapi queue sederhana bukan berarti durable broker, bukan berarti consumer group, bukan berarti audit log, bukan berarti replayable event stream, dan bukan berarti memiliki semantics seperti RabbitMQ/Kafka.

Redis List kuat sebagai **low-latency coordination primitive**, bukan sebagai general-purpose messaging backbone.

---

# 2. Mental Model Redis List

Redis List adalah urutan elemen string.

Secara konseptual:

```text
key: jobs:email
value:
  [job-001, job-002, job-003, job-004]
```

List punya dua sisi:

```text
LEFT  <------------------------------------>  RIGHT
head                                           tail
```

Kita bisa push/pop dari kiri atau kanan:

```text
LPUSH  => masukkan ke kiri
RPUSH  => masukkan ke kanan
LPOP   => ambil dari kiri
RPOP   => ambil dari kanan
```

Dengan kombinasi tertentu, Redis List bisa menjadi:

## 2.1 Stack / LIFO

```text
LPUSH + LPOP
```

Elemen terakhir masuk akan keluar lebih dulu.

## 2.2 Queue / FIFO

```text
LPUSH + RPOP
```

atau:

```text
RPUSH + LPOP
```

Elemen pertama masuk akan keluar lebih dulu.

## 2.3 Deque

Karena bisa operasi dari dua ujung, Redis List juga dapat dipakai sebagai double-ended queue.

---

# 3. Command Dasar Redis List

## 3.1 `LPUSH`

Menambahkan elemen ke sisi kiri list.

```redis
LPUSH jobs:email job-001
LPUSH jobs:email job-002
LPUSH jobs:email job-003
```

List menjadi:

```text
LEFT [job-003, job-002, job-001] RIGHT
```

`LPUSH` dengan beberapa elemen:

```redis
LPUSH jobs:email job-001 job-002 job-003
```

Redis memasukkan elemen satu per satu ke kiri. Urutan hasil perlu dipahami, jangan diasumsikan tanpa tes.

## 3.2 `RPUSH`

Menambahkan elemen ke sisi kanan list.

```redis
RPUSH jobs:email job-001
RPUSH jobs:email job-002
RPUSH jobs:email job-003
```

List menjadi:

```text
LEFT [job-001, job-002, job-003] RIGHT
```

## 3.3 `LPOP`

Mengambil dan menghapus elemen dari kiri.

```redis
LPOP jobs:email
```

## 3.4 `RPOP`

Mengambil dan menghapus elemen dari kanan.

```redis
RPOP jobs:email
```

## 3.5 `LLEN`

Melihat panjang list.

```redis
LLEN jobs:email
```

Penting untuk observability, backpressure, dan alerting.

## 3.6 `LRANGE`

Membaca sebagian list tanpa menghapus.

```redis
LRANGE jobs:email 0 9
```

Ambil 10 elemen pertama.

Hati-hati:

```redis
LRANGE jobs:email 0 -1
```

Untuk list besar, ini bisa mahal dan berbahaya di production.

## 3.7 `LTRIM`

Memotong list agar hanya menyimpan range tertentu.

Contoh: simpan 100 event terbaru.

```redis
LPUSH activity:user:123 event-999
LTRIM activity:user:123 0 99
```

Pattern ini umum untuk recent activity feed kecil.

## 3.8 `LREM`

Menghapus elemen berdasarkan value.

```redis
LREM jobs:email 1 job-001
```

Hati-hati: operasi ini perlu scan list. Untuk list besar, ini bisa menjadi mahal.

## 3.9 `LINDEX`

Mengambil elemen berdasarkan index.

```redis
LINDEX jobs:email 0
```

Akses index pada list bukan mental model terbaik untuk Redis List. Jika sering random access by index, mungkin struktur datanya salah.

## 3.10 `LINSERT`

Menyisipkan elemen sebelum/sesudah pivot.

```redis
LINSERT jobs:email BEFORE job-010 job-009b
```

Ini juga memerlukan pencarian pivot. Jangan dipakai pada hot path list besar.

---

# 4. Kompleksitas Operasi: Bagian yang Sering Diabaikan

Sebagai engineer Java, jangan hanya melihat API command. Lihat cost model.

| Operasi | Kira-kira cost | Catatan |
|---|---:|---|
| `LPUSH` / `RPUSH` | O(1) | Cepat untuk push ujung |
| `LPOP` / `RPOP` | O(1) | Cepat untuk pop ujung |
| `LLEN` | O(1) | Aman untuk monitoring |
| `LRANGE start stop` | O(S + N) | Tergantung jarak start dan jumlah elemen |
| `LTRIM` | O(N) untuk elemen yang dibuang | Aman kalau trimming kecil dan terkendali |
| `LREM` | O(N + M) | Perlu scan |
| `LINDEX` | O(N) | Bisa mahal untuk index jauh |
| `LINSERT` | O(N) | Perlu cari pivot |

Rule praktis:

> Redis List sangat bagus untuk operasi di ujung. Redis List buruk untuk operasi pencarian, random access, dan mutation di tengah pada list besar.

---

# 5. Redis List sebagai Queue FIFO

Ada dua bentuk umum.

## 5.1 Producer `LPUSH`, Consumer `RPOP`

Producer:

```redis
LPUSH queue:email job-001
LPUSH queue:email job-002
LPUSH queue:email job-003
```

Consumer:

```redis
RPOP queue:email
```

Urutan keluar:

```text
job-001
job-002
job-003
```

## 5.2 Producer `RPUSH`, Consumer `LPOP`

Producer:

```redis
RPUSH queue:email job-001
RPUSH queue:email job-002
RPUSH queue:email job-003
```

Consumer:

```redis
LPOP queue:email
```

Urutan keluar:

```text
job-001
job-002
job-003
```

Keduanya valid. Pilih satu convention dan pakai konsisten.

Untuk materi ini, kita gunakan:

```text
Producer: RPUSH
Consumer: LPOP / BLPOP
```

Karena secara visual lebih natural:

```text
RIGHT append, LEFT consume
```

---

# 6. Problem Polling Naif

Consumer sederhana bisa melakukan:

```redis
LPOP queue:email
```

Jika tidak ada job, Redis return null.

Consumer Java naif:

```java
while (true) {
    String job = redis.lpop("queue:email");
    if (job == null) {
        Thread.sleep(100);
        continue;
    }
    process(job);
}
```

Masalahnya:

1. Polling terus-menerus membuang CPU.
2. Sleep terlalu kecil membuat beban Redis naik.
3. Sleep terlalu besar menambah latency.
4. Banyak worker menghasilkan polling storm.
5. Shutdown handling menjadi kasar.

Redis menyediakan blocking pop untuk kasus ini.

---

# 7. Blocking Pop: `BLPOP` dan `BRPOP`

## 7.1 Apa Itu Blocking Pop?

`BLPOP` adalah versi blocking dari `LPOP`.

```redis
BLPOP queue:email 5
```

Artinya:

- coba ambil elemen dari kiri,
- jika list kosong, tunggu sampai ada elemen,
- timeout maksimal 5 detik,
- jika tetap kosong, return null.

`BRPOP` sama, tetapi dari kanan.

## 7.2 Contoh Producer/Consumer

Producer:

```redis
RPUSH queue:email '{"id":"job-001","to":"a@example.com"}'
```

Consumer:

```redis
BLPOP queue:email 30
```

Jika ada item, respons berisi:

```text
1) "queue:email"
2) "{\"id\":\"job-001\",\"to\":\"a@example.com\"}"
```

## 7.3 Kenapa Response Mengandung Key?

Karena `BLPOP` bisa menunggu banyak queue sekaligus:

```redis
BLPOP queue:critical queue:normal queue:low 30
```

Response menyertakan key agar consumer tahu item berasal dari queue mana.

## 7.4 Priority Queue Sederhana dengan Multi-Key `BLPOP`

```redis
BLPOP queue:critical queue:normal queue:low 30
```

Redis akan mengecek key sesuai urutan argumen. Jika `queue:critical` punya item, itu diambil dulu.

Ini bisa menjadi priority queue sederhana.

Tetapi hati-hati:

- priority rendah bisa starvation,
- tidak ada fair scheduling kompleks,
- di Redis Cluster multi-key command punya constraint slot,
- ini bukan replacement untuk scheduler/broker serius.

---

# 8. Java Implementation: Consumer dengan Lettuce

Contoh sederhana menggunakan Lettuce sync API.

> Ini contoh konseptual. Production code perlu lifecycle management, metrics, structured logging, retry policy, dan shutdown handling.

```java
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.KeyValue;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;

import java.time.Duration;

public class EmailQueueWorker {
    private final RedisClient client;
    private final StatefulRedisConnection<String, String> connection;
    private final RedisCommands<String, String> redis;
    private volatile boolean running = true;

    public EmailQueueWorker(String redisUri) {
        this.client = RedisClient.create(RedisURI.create(redisUri));
        this.connection = client.connect();
        this.redis = connection.sync();
    }

    public void runLoop() {
        while (running) {
            try {
                KeyValue<String, String> item = redis.blpop(5, "queue:email");

                if (item == null || !item.hasValue()) {
                    continue;
                }

                String queueName = item.getKey();
                String payload = item.getValue();

                process(queueName, payload);
            } catch (Exception ex) {
                // Production: classify exception, emit metric, apply bounded backoff.
                System.err.println("Worker error: " + ex.getMessage());
                sleep(Duration.ofSeconds(1));
            }
        }
    }

    private void process(String queueName, String payload) {
        System.out.printf("Processing from %s: %s%n", queueName, payload);
        // Decode JSON, validate schema, call business logic.
    }

    public void shutdown() {
        running = false;
        connection.close();
        client.shutdown();
    }

    private static void sleep(Duration duration) {
        try {
            Thread.sleep(duration.toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

Important detail:

> Jangan gunakan connection yang sama untuk blocking operation dan command non-blocking lain pada thread yang sama tanpa memahami client behavior. Pisahkan blocking workers dari traffic Redis normal.

---

# 9. Producer Java Sederhana

```java
import io.lettuce.core.RedisClient;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;

public class EmailQueueProducer {
    private final RedisCommands<String, String> redis;

    public EmailQueueProducer(StatefulRedisConnection<String, String> connection) {
        this.redis = connection.sync();
    }

    public void enqueueEmailJob(String jobJson) {
        redis.rpush("queue:email", jobJson);
    }
}
```

Payload contoh:

```json
{
  "jobId": "email-2026-000001",
  "type": "SEND_EMAIL",
  "to": "user@example.com",
  "template": "WELCOME",
  "createdAt": "2026-06-20T10:15:30Z"
}
```

Untuk production, payload minimal perlu:

- stable job id,
- type/version,
- created timestamp,
- tenant/user/correlation id,
- attempt count atau metadata retry,
- trace id,
- schema version.

---

# 10. Masalah Besar: Pop Menghapus Job Sebelum Diproses

Queue sederhana:

```redis
BLPOP queue:email 30
```

Begitu worker menerima job, job sudah hilang dari queue.

Flow:

```text
1. job ada di queue
2. worker BLPOP
3. Redis menghapus job dari queue
4. worker mulai process
5. worker crash sebelum selesai
6. job hilang
```

Ini disebut:

> at-most-once processing

Job diproses nol atau satu kali. Jika worker crash setelah pop tetapi sebelum proses selesai, job hilang.

Untuk pekerjaan penting, ini biasanya tidak cukup.

---

# 11. Reliable Queue Pattern dengan Processing List

Redis List bisa dibuat lebih aman dengan dua list:

```text
queue:email:ready
queue:email:processing
```

Flow:

```text
ready -> processing -> done
```

Consumer mengambil dari ready dan memindahkan ke processing secara atomik.

Command klasik:

```redis
RPOPLPUSH queue:email:ready queue:email:processing
```

Blocking variant lama:

```redis
BRPOPLPUSH queue:email:ready queue:email:processing 30
```

Redis modern juga punya command family `LMOVE` / `BLMOVE` yang lebih eksplisit.

Contoh:

```redis
BLMOVE queue:email:ready queue:email:processing LEFT RIGHT 30
```

Makna konseptual:

- ambil dari `queue:email:ready`,
- pindahkan ke `queue:email:processing`,
- operasi atomik di Redis,
- worker baru memproses item yang sudah ada di processing.

Setelah sukses:

```redis
LREM queue:email:processing 1 <payload>
```

## 11.1 Flow Reliable Queue

```text
Producer
  RPUSH queue:email:ready job-001

Worker
  BLMOVE ready processing LEFT RIGHT 30
  process(job-001)
  LREM processing 1 job-001
```

Jika worker crash setelah move tapi sebelum ack:

```text
job masih ada di queue:email:processing
```

Secara teori job bisa direcover.

---

# 12. Recovery Problem pada Processing List

Reliable queue pattern belum selesai hanya dengan `processing` list.

Kita perlu menjawab:

> Bagaimana tahu item di processing sudah terlalu lama dan harus dikembalikan ke ready?

List biasa tidak punya timestamp per item.

Jika payload menyimpan timestamp:

```json
{
  "jobId": "job-001",
  "createdAt": "2026-06-20T10:15:30Z",
  "pickedAt": "2026-06-20T10:16:00Z"
}
```

Tetapi begitu payload di-list, mengubah field `pickedAt` berarti mengubah value string. Menghapus value lama dengan `LREM` juga bergantung pada exact string.

Ini membuat recovery dengan List menjadi awkward.

Alternatif:

1. Simpan payload di Hash berdasarkan job id.
2. List hanya menyimpan job id.
3. Processing state disimpan di Hash atau Sorted Set.

Contoh desain lebih baik:

```text
queue:email:ready           List of jobId
queue:email:processing      List of jobId
job:email:<jobId>           Hash payload/status
queue:email:processing:zset Sorted Set jobId -> pickedAtEpochMillis
```

Worker:

```text
1. BLMOVE ready -> processing
2. HSET job:<id> status processing pickedAt ...
3. ZADD processing:zset pickedAtEpochMillis jobId
4. process
5. LREM processing 1 jobId
6. ZREM processing:zset jobId
7. HSET job:<id> status completed
```

Recovery process:

```text
1. ZRANGEBYSCORE processing:zset -inf now-timeout
2. for each jobId:
   - remove from processing list
   - remove from processing zset
   - push back to ready
   - increment attempt count
```

Tetapi di titik ini sistem sudah mulai kompleks.

Pertanyaan arsitekturalnya:

> Jika queue harus punya visibility timeout, retry, dead-letter, observability, consumer group, dan recovery, apakah Redis List masih primitive yang tepat?

Sering kali jawabannya: gunakan Redis Streams, RabbitMQ, Kafka, SQS, atau broker lain sesuai requirement.

---

# 13. Redis List vs Redis Streams untuk Queue

Redis List cocok untuk:

- simple queue,
- single logical consumer group,
- low ceremony,
- temporary task,
- best-effort background work,
- small internal async pipeline,
- bounded recent items.

Redis Streams lebih cocok untuk:

- consumer group,
- pending entries,
- acknowledgement,
- replay terbatas,
- multiple consumers dalam group,
- message id,
- inspection,
- trimming by length/minid,
- event-like processing.

Perbandingan ringkas:

| Aspek | Redis List | Redis Streams |
|---|---|---|
| Data model | ordered string list | append-only stream entries |
| Consumer group | manual | built-in |
| Ack | manual workaround | built-in `XACK` |
| Pending tracking | manual | built-in PEL |
| Replay | sulit | lebih natural |
| Message id | manual | built-in |
| Simplicity | sangat sederhana | lebih kompleks |
| Use case | queue sederhana | event/task stream ringan |

Redis List bukan jelek. Ia hanya primitive lebih rendah.

---

# 14. Redis List vs RabbitMQ/Kafka: Batas yang Harus Tegas

Karena Anda sudah punya seri Kafka/RabbitMQ, bagian ini hanya boundary spesifik.

## 14.1 Redis List Tidak Memberikan Broker Semantics Lengkap

Redis List tidak secara native memberi:

- durable routing model,
- exchange/binding,
- consumer acknowledgement formal,
- dead-letter exchange,
- offset log partitioning,
- replay stream panjang,
- retention policy event log,
- consumer lag semantics seperti Kafka,
- broker-level backpressure sophistication,
- schema registry,
- compaction,
- ordered partition model.

## 14.2 Kapan Redis List Masih Masuk Akal?

Redis List masuk akal ketika:

- job loss dapat diterima atau dapat direkonstruksi,
- pekerjaan bersifat ephemeral,
- queue kecil,
- lifecycle pendek,
- operasi sangat sederhana,
- requirement observability minimal,
- Redis sudah tersedia di path sistem,
- throughput/latency target sederhana,
- operational team tidak ingin menambah broker hanya untuk primitive kecil.

Contoh yang masuk akal:

```text
Generate thumbnail sementara untuk cache image yang bisa diulang.
```

Jika job hilang, user request berikutnya bisa membuat job lagi.

Contoh yang tidak masuk akal:

```text
Posting transaksi finansial antar sistem ledger.
```

Untuk ini, Redis List terlalu lemah.

---

# 15. Bounded Log Kecil dengan `LPUSH` + `LTRIM`

Redis List sangat bagus untuk menyimpan N item terbaru.

Contoh recent activity:

```redis
LPUSH user:123:recent-activity '{"type":"LOGIN","at":"2026-06-20T10:00:00Z"}'
LTRIM user:123:recent-activity 0 99
```

Membaca:

```redis
LRANGE user:123:recent-activity 0 19
```

Kegunaan:

- recent login,
- recent notifications,
- recent viewed products,
- latest audit preview non-authoritative,
- UI activity widget,
- debugging breadcrumb terbatas.

Batas penting:

> Ini bukan audit log authoritative.

Kenapa?

- item lama sengaja dipotong,
- Redis bisa evict jika policy memungkinkan,
- persistence mungkin tidak sekuat database/log utama,
- tidak cocok untuk compliance retention,
- tidak ada query kompleks.

Untuk regulatory/audit systems, Redis List boleh menjadi **derived view**, bukan source of truth.

---

# 16. Backpressure dengan Redis List

Queue tanpa backpressure akan berubah menjadi memory leak.

Producer bisa terus `RPUSH`, worker lambat, list tumbuh tanpa batas.

```text
Producer rate: 10,000 job/s
Consumer rate: 2,000 job/s
Backlog growth: 8,000 job/s
```

Dalam 1 jam:

```text
8,000 * 3,600 = 28,800,000 job
```

Jika setiap job payload 1 KB:

```text
~28.8 GB payload mentah + overhead
```

Redis Anda bisa jatuh.

## 16.1 Ukur Queue Length

```redis
LLEN queue:email
```

Metric penting:

```text
queue_depth = LLEN(queue)
```

## 16.2 Estimasi Lag

Jika Anda tahu processing rate:

```text
lag_seconds = queue_depth / consumer_rate_per_second
```

Contoh:

```text
queue_depth = 50,000
consumer_rate = 500/s
lag = 100 seconds
```

## 16.3 Producer-Side Limit

Sebelum push:

```redis
LLEN queue:email
```

Jika terlalu besar, reject/degrade.

Tetapi naive check-then-push tidak atomic:

```text
1. Producer A LLEN = 999
2. Producer B LLEN = 999
3. A RPUSH
4. B RPUSH
5. limit 1000 terlampaui
```

Untuk hard bound, gunakan Lua.

Contoh Lua bounded push:

```lua
local key = KEYS[1]
local max = tonumber(ARGV[1])
local value = ARGV[2]

local len = redis.call('LLEN', key)
if len >= max then
  return 0
end

redis.call('RPUSH', key, value)
return 1
```

Dari Java, script ini dapat dipanggil sebagai atomic operation.

## 16.4 Consumer Scaling

Menambah consumer bisa membantu, tetapi tidak gratis:

- job harus idempotent,
- downstream harus sanggup menerima beban,
- Redis connection meningkat,
- failure handling makin kompleks,
- ordering global hilang jika banyak worker memproses paralel.

---

# 17. Ordering: Queue Order Tidak Sama dengan Processing Completion Order

Dengan satu consumer:

```text
job-1 -> job-2 -> job-3
```

Processing order dan completion order cenderung sama.

Dengan banyak consumer:

```text
Worker A ambil job-1, proses 10 detik
Worker B ambil job-2, proses 1 detik
```

Completion order:

```text
job-2 selesai dulu
job-1 selesai belakangan
```

Jadi Redis List FIFO hanya menjamin order pengambilan dari queue, bukan order efek bisnis selesai.

Jika domain butuh strict ordering per aggregate, desain queue harus dipartisi per aggregate/key.

Contoh:

```text
queue:account:<accountId>
```

Tetapi ini memunculkan masalah baru:

- banyak queue,
- scheduling worker lebih kompleks,
- hot aggregate,
- observability lebih sulit.

---

# 18. Poison Message Problem

Poison message adalah job yang selalu gagal diproses.

Contoh:

```json
{
  "jobId": "job-999",
  "type": "SEND_EMAIL",
  "to": "not-an-email",
  "template": null
}
```

Jika retry terus, queue bisa tersumbat atau resource habis.

Minimum metadata:

```json
{
  "jobId": "job-999",
  "attempt": 3,
  "maxAttempt": 5,
  "lastError": "Invalid email",
  "createdAt": "2026-06-20T10:00:00Z"
}
```

Tetapi dengan Redis List, updating attempt di payload bukan trivial jika payload sudah ada di list. Lebih baik:

```text
queue:email:ready       List jobId
job:email:<jobId>       Hash attempt, status, payload, lastError
queue:email:dead        List jobId
```

Flow:

```text
if attempt < max:
  increment attempt
  requeue
else:
  move to dead queue
```

Dead queue:

```redis
RPUSH queue:email:dead job-999
```

Observability:

```redis
LLEN queue:email:dead
LRANGE queue:email:dead 0 99
```

Untuk production, dead-letter handling perlu dashboard dan replay tool, bukan hanya list diam-diam.

---

# 19. Payload Design untuk Redis List Queue

Ada dua pendekatan utama.

## 19.1 Payload Langsung di List

```redis
RPUSH queue:email '{"jobId":"job-001","to":"a@example.com"}'
```

Kelebihan:

- sederhana,
- satu write,
- mudah dipahami,
- cocok untuk job kecil.

Kekurangan:

- sulit update metadata,
- `LREM` butuh exact payload,
- payload besar membebani memory,
- retry attempt harus rewrite item,
- debugging bisa messy.

## 19.2 Job ID di List, Payload di Hash/String

```redis
HSET job:email:job-001 type SEND_EMAIL to a@example.com status ready attempt 0
RPUSH queue:email job-001
```

Kelebihan:

- metadata mudah diupdate,
- payload bisa dipisah,
- status tracking lebih jelas,
- retry/dead-letter lebih manageable,
- list lebih ringan.

Kekurangan:

- lebih banyak key,
- perlu cleanup,
- perlu atomicity lebih hati-hati,
- orphan job risk.

Untuk sistem serius, pattern kedua biasanya lebih baik.

---

# 20. Atomicity Problem: HSET lalu RPUSH

Misalnya producer:

```redis
HSET job:email:job-001 status ready payload ...
RPUSH queue:email job-001
```

Failure scenario:

```text
1. HSET sukses
2. app crash sebelum RPUSH
3. job payload ada, tapi tidak pernah masuk queue
```

Atau kebalikannya:

```text
1. RPUSH sukses
2. app crash sebelum HSET
3. queue punya job id, tapi payload tidak ada
```

Solusi:

1. Lua script untuk atomic create + enqueue.
2. Redis transaction `MULTI/EXEC` untuk grouping command.
3. Desain reconciler untuk menemukan orphan.
4. Gunakan system of record eksternal dan Redis hanya derived queue.

Lua example:

```lua
local jobKey = KEYS[1]
local queueKey = KEYS[2]
local jobId = ARGV[1]
local payload = ARGV[2]

if redis.call('EXISTS', jobKey) == 1 then
  return 0
end

redis.call('HSET', jobKey,
  'status', 'ready',
  'payload', payload,
  'attempt', '0'
)
redis.call('RPUSH', queueKey, jobId)
return 1
```

Ini membuat enqueue atomic dari sudut pandang Redis.

---

# 21. TTL dan Cleanup untuk Queue Objects

Jika memakai key per job:

```text
job:email:<jobId>
```

Anda butuh lifecycle policy.

Contoh:

- job ready: TTL 24 jam,
- job processing: TTL diperpanjang,
- job completed: TTL 7 hari untuk debug,
- job failed/dead: TTL 30 hari atau sesuai policy,
- audit authoritative tetap di database/log lain.

Redis command:

```redis
EXPIRE job:email:job-001 604800
```

Tapi hati-hati:

> Jika job key expired saat job id masih berada di queue, worker akan menemukan job id tanpa payload.

Maka worker harus punya behavior:

```text
if payload missing:
  emit metric
  remove/discard according to policy
  do not crash-loop
```

---

# 22. Redis List dan Memory Risk

Redis List menyimpan elemen sebagai string. Walaupun internal Redis menggunakan encoding efisien, kita tetap harus berpikir memory-first.

Masalah umum:

## 22.1 Payload Terlalu Besar

Jangan push object besar:

```json
{
  "jobId": "job-001",
  "pdfBase64": "...10MB..."
}
```

Lebih baik simpan reference:

```json
{
  "jobId": "job-001",
  "documentRef": "s3://bucket/path/file.pdf"
}
```

Redis bukan blob store.

## 22.2 Queue Tidak Dibatasi

Queue tanpa max length adalah potensi incident.

Minimal punya:

- metric `LLEN`,
- alert threshold,
- producer throttle,
- fallback behavior,
- capacity budget.

## 22.3 Dead Queue Menumpuk

Dead-letter list tanpa review adalah kuburan memory.

Perlu:

- retention,
- operator workflow,
- replay/delete tooling,
- summary metric.

---

# 23. Serialization Boundary untuk Java

Jangan gunakan Java native serialization untuk Redis queue payload.

Masalah:

- tidak portable,
- class evolution rapuh,
- payload opaque untuk debugging,
- security risk,
- sulit dipakai lintas bahasa,
- coupling tinggi ke JVM class.

Lebih baik:

- JSON untuk readability,
- Protobuf/Avro untuk schema ketat,
- MessagePack/CBOR jika butuh compact,
- explicit schema version.

Contoh payload JSON dengan versioning:

```json
{
  "schemaVersion": 1,
  "jobId": "email-000001",
  "jobType": "SEND_EMAIL",
  "tenantId": "tenant-123",
  "correlationId": "req-abc",
  "createdAt": "2026-06-20T10:15:30Z",
  "data": {
    "to": "user@example.com",
    "template": "WELCOME"
  }
}
```

Java record:

```java
public record EmailJob(
    int schemaVersion,
    String jobId,
    String jobType,
    String tenantId,
    String correlationId,
    String createdAt,
    EmailJobData data
) {}

public record EmailJobData(
    String to,
    String template
) {}
```

Parsing harus defensif:

```java
try {
    EmailJob job = objectMapper.readValue(payload, EmailJob.class);
    validate(job);
    handle(job);
} catch (Exception ex) {
    // classify as invalid payload, not transient Redis failure
}
```

---

# 24. Error Classification dalam Worker

Tidak semua error harus retry.

## 24.1 Permanent Error

Contoh:

- payload invalid,
- missing required field,
- unknown schema version,
- invalid email format,
- tenant not found jika seharusnya tidak mungkin.

Action:

```text
move to dead queue
```

## 24.2 Transient Error

Contoh:

- downstream timeout,
- temporary 503,
- network issue,
- rate limited by provider.

Action:

```text
retry with backoff
```

## 24.3 Ambiguous Error

Contoh:

- downstream request may have succeeded but response timeout,
- worker crash after side effect before ack.

Action:

```text
requires idempotency key / reconciliation
```

Redis List queue tidak menghapus kebutuhan idempotency. Justru ia membuat idempotency makin penting.

---

# 25. Retry dengan Redis List: Jangan Retry Langsung Tanpa Delay

Naive retry:

```text
on failure -> RPUSH queue:email jobId
```

Masalah:

- job gagal bisa langsung diambil lagi,
- tight failure loop,
- downstream makin overload,
- poison message menghabiskan worker.

Untuk delayed retry, Redis List saja kurang ideal.

Better primitive:

- Sorted Set dengan score = nextAttemptAt,
- worker scheduler memindahkan due job ke ready queue,
- atau gunakan Redis Streams / broker yang mendukung delay/retry pattern lebih jelas,
- atau gunakan scheduler eksternal.

Pattern sederhana:

```text
queue:email:ready         List
queue:email:retry         Sorted Set jobId -> nextAttemptEpochMillis
```

Failure transient:

```redis
ZADD queue:email:retry 1781931030000 job-001
```

Scheduler:

```redis
ZRANGEBYSCORE queue:email:retry -inf now LIMIT 0 100
```

Lalu atomic move due jobs ke ready queue dengan Lua.

Pembahasan detail Sorted Set ada di Part 007.

---

# 26. Observability untuk Redis List Queue

Minimum metrics:

```text
queue_ready_depth
queue_processing_depth
queue_dead_depth
enqueue_rate
consume_rate
success_rate
failure_rate
retry_rate
oldest_job_age
worker_processing_duration
redis_command_latency
payload_deserialization_failure_count
missing_payload_count
```

Command dasar:

```redis
LLEN queue:email:ready
LLEN queue:email:processing
LLEN queue:email:dead
```

Untuk oldest job age, jika payload punya `createdAt`, consumer/sampler bisa inspect beberapa item.

Tetapi hati-hati:

```redis
LRANGE queue:email:ready 0 -1
```

Jangan lakukan di queue besar.

Gunakan sample kecil:

```redis
LRANGE queue:email:ready 0 9
```

atau jika oldest berada di sisi pop, inspect sisi yang relevan.

---

# 27. Runbook untuk Queue Berbasis Redis List

Sebuah queue Redis List production minimal harus punya runbook.

## 27.1 Queue Depth Naik

Diagnosis:

1. Apakah enqueue rate naik?
2. Apakah consumer turun?
3. Apakah downstream lambat?
4. Apakah Redis latency naik?
5. Apakah ada poison message?
6. Apakah ada deployment baru?

Action:

- scale worker jika downstream sanggup,
- throttle producer,
- pause non-critical jobs,
- inspect dead queue,
- rollback worker jika bug parsing,
- protect Redis memory.

## 27.2 Dead Queue Naik

Diagnosis:

1. Error type apa?
2. Schema mismatch?
3. Deployment producer baru?
4. Downstream contract berubah?
5. Data domain invalid?

Action:

- classify permanent/transient,
- fix producer,
- replay selected jobs,
- delete invalid jobs sesuai policy,
- add validation before enqueue.

## 27.3 Processing Queue Tidak Turun

Diagnosis:

1. Worker crash?
2. Ack path gagal?
3. `LREM` tidak cocok karena payload berubah?
4. Recovery worker tidak jalan?
5. Job stuck karena downstream hang?

Action:

- restart worker,
- inspect processing age,
- requeue expired processing jobs,
- verify idempotency before reprocessing.

## 27.4 Redis Memory Tinggi

Diagnosis:

1. Queue mana paling besar?
2. Payload average size?
3. Dead queue retention?
4. Processing leak?
5. No TTL job keys?

Action:

- stop/throttle producer,
- drain queue,
- trim non-critical recent lists,
- archive/delete dead jobs,
- increase capacity hanya jika growth valid.

---

# 28. Cluster Considerations

Redis Cluster membatasi multi-key command jika key berada di hash slot berbeda.

Reliable queue dengan:

```text
queue:email:ready
queue:email:processing
```

Command seperti `LMOVE source destination` membutuhkan source dan destination berada di slot yang sama dalam Redis Cluster.

Gunakan hash tag:

```text
queue:{email}:ready
queue:{email}:processing
queue:{email}:dead
queue:{email}:retry
```

Bagian di dalam `{}` menentukan hash slot.

Dengan hash tag sama:

```text
{email}
```

semua key terkait queue email berada di slot sama.

Trade-off:

- operasi multi-key bisa jalan,
- tetapi satu queue terikat ke satu slot,
- hot queue bisa membuat hot slot,
- perlu sharding queue jika throughput tinggi.

Sharding contoh:

```text
queue:{email-00}:ready
queue:{email-01}:ready
queue:{email-02}:ready
...
```

Tetapi consumer scheduling menjadi lebih kompleks.

---

# 29. Security dan Abuse Surface

Redis List queue sering dipakai untuk menampung payload dari request user. Jangan langsung percaya payload.

Risiko:

- payload terlalu besar,
- JSON malicious/deep nesting,
- schema invalid,
- tenant spoofing,
- duplicate job id,
- command injection tidak langsung via key construction,
- PII masuk Redis tanpa retention policy.

Defensive rule:

1. Validate before enqueue.
2. Limit payload size.
3. Do not put secrets in queue payload.
4. Do not construct Redis key directly from raw user input without normalization.
5. Include tenant boundary explicitly.
6. Encrypt sensitive payload di layer aplikasi jika perlu.
7. Define TTL/retention.

---

# 30. Practical Design: Simple Email Queue

## 30.1 Requirements

Misal:

- email welcome tidak critical secara finansial,
- boleh retry,
- boleh delay beberapa menit,
- tidak boleh infinite retry,
- perlu observability,
- jika hilang sesekali bisa direkonsiliasi dari database user,
- Redis bukan audit log.

## 30.2 Key Schema

```text
queue:{email}:ready                 List of jobId
queue:{email}:processing            List of jobId
queue:{email}:dead                  List of jobId
queue:{email}:retry                 Sorted Set jobId -> nextAttemptMs
job:{email}:<jobId>                 Hash job metadata and payload
```

## 30.3 Enqueue

Atomic Lua:

```lua
local jobKey = KEYS[1]
local readyQueue = KEYS[2]
local jobId = ARGV[1]
local payload = ARGV[2]
local ttlSeconds = tonumber(ARGV[3])

if redis.call('EXISTS', jobKey) == 1 then
  return 0
end

redis.call('HSET', jobKey,
  'jobId', jobId,
  'status', 'ready',
  'attempt', '0',
  'payload', payload
)
redis.call('EXPIRE', jobKey, ttlSeconds)
redis.call('RPUSH', readyQueue, jobId)
return 1
```

## 30.4 Consume

```redis
BLMOVE queue:{email}:ready queue:{email}:processing LEFT RIGHT 30
```

Then:

```text
HGETALL job:{email}:<jobId>
process
on success:
  LREM queue:{email}:processing 1 <jobId>
  HSET job:{email}:<jobId> status completed completedAt ...
  EXPIRE job:{email}:<jobId> 604800
```

## 30.5 Failure

Permanent:

```text
LREM processing jobId
RPUSH dead jobId
HSET job status dead lastError ...
```

Transient:

```text
LREM processing jobId
ZADD retry nextAttemptMs jobId
HINCRBY job attempt 1
HSET job status retry
```

## 30.6 Scheduler

Every second or few seconds:

```text
find due retry jobs
move from retry zset to ready list atomically
```

This already shows why queue sophistication grows quickly.

---

# 31. When Redis List Is the Wrong Tool

Avoid Redis List queue if you need:

1. long-term durable event history,
2. replay by consumer offset,
3. many independent consumer groups,
4. strict audit trail,
5. advanced routing,
6. dead-letter workflow built into broker,
7. delayed delivery as first-class feature,
8. high fanout event distribution,
9. partitioned ordered event log,
10. exactly-once-like transactional integration,
11. cross-region durable messaging,
12. compliance-grade retention.

Use another tool:

- Redis Streams for lightweight stream semantics,
- RabbitMQ for broker/routing/work queues,
- Kafka for durable event log and stream processing,
- database outbox for transactional event handoff,
- cloud queue service for managed durable queue.

---

# 32. Common Anti-Patterns

## 32.1 Using Redis List as Invisible Critical Queue

```text
No dashboard, no alert, no dead-letter, no owner.
```

This is incident waiting to happen.

## 32.2 No Maximum Queue Length

Unbounded queue means unbounded memory risk.

## 32.3 Storing Huge Payloads

Redis memory is expensive and operationally sensitive.

## 32.4 Assuming `BLPOP` Means Reliable Delivery

It does not. Pop removes the item before processing.

## 32.5 Retrying Forever

Infinite retry converts one bad message into permanent capacity drain.

## 32.6 Sharing One Queue for Multiple Job Types

```text
queue:background
```

Bad because:

- priority unclear,
- failure handling mixed,
- payload schemas mixed,
- one poison type can affect others,
- scaling cannot be per workload.

Prefer:

```text
queue:{email}:ready
queue:{thumbnail}:ready
queue:{webhook}:ready
```

## 32.7 Using `LRANGE 0 -1` for Monitoring

For large list, this hurts Redis and network.

Use `LLEN`, sampled `LRANGE`, and metrics emitted by workers.

---

# 33. Design Review Checklist

Before approving Redis List queue, ask:

## 33.1 Requirement Fit

- Is job loss acceptable?
- If not, what recovery mechanism exists?
- Is Redis the source of truth or derived buffer?
- What is the maximum acceptable lag?
- What is the maximum acceptable duplicate processing?

## 33.2 Data Model

- Is list storing payload or job id?
- Is payload schema versioned?
- Is payload size bounded?
- Are keys named with ownership and environment?
- Are cluster hash tags planned?

## 33.3 Failure Handling

- What happens if worker crashes after pop?
- What happens if worker crashes after side effect before ack?
- What happens if Redis is temporarily unavailable?
- What happens if payload is invalid?
- Is there a dead-letter path?
- Is retry bounded?

## 33.4 Operations

- Is queue depth monitored?
- Is oldest job age monitored?
- Is dead queue monitored?
- Is Redis memory monitored?
- Is there a replay tool?
- Is there a cleanup policy?
- Is there a runbook?

## 33.5 Java Client Behavior

- Are blocking operations isolated?
- Are timeouts configured?
- Is JSON parsing defensive?
- Is retry policy bounded?
- Are metrics emitted?
- Is shutdown graceful?

---

# 34. Lab: Explore Redis Lists Locally

Run Redis:

```bash
docker run --rm -p 6379:6379 redis:8
```

Open CLI:

```bash
docker exec -it $(docker ps -q --filter ancestor=redis:8) redis-cli
```

## 34.1 Basic FIFO

```redis
DEL queue:demo
RPUSH queue:demo job-1
RPUSH queue:demo job-2
RPUSH queue:demo job-3
LRANGE queue:demo 0 -1
LPOP queue:demo
LPOP queue:demo
LPOP queue:demo
LPOP queue:demo
```

Observe null when empty.

## 34.2 Blocking Pop

Terminal A:

```redis
BLPOP queue:blocking 30
```

Terminal B:

```redis
RPUSH queue:blocking hello
```

Terminal A should unblock.

## 34.3 Recent Activity

```redis
DEL user:123:recent
LPUSH user:123:recent event-1
LTRIM user:123:recent 0 2
LPUSH user:123:recent event-2
LTRIM user:123:recent 0 2
LPUSH user:123:recent event-3
LTRIM user:123:recent 0 2
LPUSH user:123:recent event-4
LTRIM user:123:recent 0 2
LRANGE user:123:recent 0 -1
```

Expected: only 3 newest events.

## 34.4 Reliable Queue Skeleton

```redis
DEL queue:{demo}:ready queue:{demo}:processing
RPUSH queue:{demo}:ready job-1 job-2 job-3
LMOVE queue:{demo}:ready queue:{demo}:processing LEFT RIGHT
LRANGE queue:{demo}:ready 0 -1
LRANGE queue:{demo}:processing 0 -1
LREM queue:{demo}:processing 1 job-1
LRANGE queue:{demo}:processing 0 -1
```

Observe how job moves from ready to processing, then is acknowledged by removal.

---

# 35. Mental Model Ringkas

Redis List is excellent when you need:

```text
small, fast, ordered, edge-operated sequence
```

Redis List is risky when you secretly need:

```text
durable broker, replayable log, consumer group, audit trail, or complex retry engine
```

Core invariant:

> Operations at the ends are cheap. Operations in the middle are not the design center.

Queue invariant:

> `BLPOP` gives convenient waiting, not reliable delivery.

Reliability invariant:

> Once you need ack, retry, dead-letter, timeout recovery, and observability, your “simple Redis List queue” has become a queueing subsystem. Treat it with the same seriousness as any other production subsystem.

Java invariant:

> Isolate blocking connections, bound retries, version payloads, validate aggressively, and never let Redis queue growth be invisible.

---

# 36. What You Should Be Able to Explain After This Part

You should now be able to explain:

1. How Redis List behaves as a sequence.
2. How `LPUSH`, `RPUSH`, `LPOP`, and `RPOP` combine into stack/queue behavior.
3. Why `BLPOP` helps avoid polling.
4. Why simple pop is at-most-once.
5. How reliable queue pattern uses ready and processing lists.
6. Why recovery with List becomes complex.
7. Why job id + Hash is often better than full payload in List.
8. How dead-letter and retry concerns emerge.
9. Why delayed retry usually needs Sorted Set or another system.
10. Why Redis List is not RabbitMQ/Kafka.
11. How to design bounded recent activity lists.
12. What metrics and runbooks are needed for production.
13. What Java-specific issues matter: serialization, blocking connections, timeouts, graceful shutdown.

---

# 37. Preview Part 006

Part 006 akan membahas:

```text
Sets: Membership, Deduplication, Relationship, Eligibility
```

Kita akan masuk ke Redis Sets sebagai primitive untuk:

- membership check,
- deduplication,
- eligibility,
- feature targeting,
- user relationship,
- processed event window,
- online user tracking,
- intersection/union/difference,
- dan cluster-aware set design.

Setelah Lists, Sets adalah data structure yang sangat sering dipakai untuk backend systems karena ia menjawab pertanyaan sederhana tapi penting:

```text
“Apakah X termasuk dalam kelompok Y?”
```

atau:

```text
“Elemen mana yang overlap antara A dan B?”
```

---

# Status Akhir Part 005

```text
Part 005 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-006.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — Hashes: Object-Like Data Tanpa Menjadi Document Database</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-006.md">Part 006 — Redis Sets: Membership, Deduplication, Relationship, Eligibility ➡️</a>
</div>
