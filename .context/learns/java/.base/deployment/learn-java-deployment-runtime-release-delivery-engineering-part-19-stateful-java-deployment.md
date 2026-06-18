# learn-java-deployment-runtime-release-delivery-engineering

# Part 19 — Stateful Java Deployment: Sessions, Caches, Queues, Schedulers, and Jobs

> Seri: Java Deployment Runtime Release Delivery Engineering  
> Bagian: 19 dari 35  
> Fokus: memahami deployment Java ketika aplikasi tidak sepenuhnya stateless: session, cache, queue consumer, scheduler, batch/job, local state, distributed state, idempotency, leader election, drain, dan handover.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas strategi release seperti rolling, blue-green, canary, shadow, dan ring deployment, lalu database-aware deployment. Sekarang kita masuk ke salah satu sumber risiko deployment terbesar dalam sistem Java enterprise: **stateful workload**.

Banyak materi deployment modern menyederhanakan asumsi:

> “Service sebaiknya stateless, jadi rolling update aman.”

Sebagai prinsip desain, ini benar. Tetapi dalam production nyata, terutama sistem enterprise, regulatory, case management, settlement, claim, approval, enforcement, billing, notification, batch, integration, dan workflow, aplikasi hampir selalu memiliki state dalam beberapa bentuk:

- HTTP session;
- local in-memory cache;
- distributed cache;
- pending request state;
- connection pool;
- transaction context;
- message consumer offset/ack;
- scheduled job;
- batch execution state;
- file processing state;
- lock ownership;
- leader election;
- workflow token;
- idempotency record;
- saga state;
- temporary files;
- WebSocket connection;
- subscription state;
- long-running business process.

Bagian ini bertujuan membuat kamu bisa melihat deployment bukan sebagai “restart aplikasi”, tetapi sebagai **state transition dari sistem yang sedang hidup**.

Setelah bagian ini, kamu diharapkan mampu:

1. membedakan stateless service, externally stateful service, dan internally stateful service;
2. mengenali state mana yang aman hilang dan mana yang tidak;
3. merancang deployment yang tidak memutus session, tidak menggandakan message processing, tidak menjalankan job dua kali, dan tidak merusak cache consistency;
4. menentukan kapan rolling update aman, kapan butuh drain, kapan butuh leader election, kapan butuh pause scheduler, dan kapan butuh maintenance window;
5. membuat checklist deployment untuk Java service yang memakai session, cache, queue, scheduler, dan job processing.

---

## 1. Mental Model: Deployment adalah Migrasi Kepemilikan State

Untuk aplikasi stateless murni, deployment relatif sederhana:

```text
old process receives traffic
new process starts
traffic shifts to new process
old process stops
```

Jika tidak ada state penting di old process, proses lama bisa dihentikan tanpa konsekuensi besar.

Tetapi untuk aplikasi stateful, deployment lebih mirip ini:

```text
old process owns some state or work
new process starts with different code/config/runtime
ownership must move safely
old process must stop accepting new work
old process must finish or persist current work
new process must continue without duplication or loss
```

Dengan kata lain:

> Deployment stateful bukan hanya mengganti binary. Deployment stateful adalah memindahkan kepemilikan work, connection, lock, session, offset, cache responsibility, dan execution context.

Kalau state ownership tidak jelas, hasilnya bisa berupa:

- user tiba-tiba logout;
- request yang sedang diproses gagal di tengah;
- pesan queue diproses dua kali;
- scheduled job berjalan paralel di dua pod;
- cache menyajikan data lama setelah schema berubah;
- batch job restart dari awal dan membuat duplicate output;
- lock tidak dilepas;
- workflow masuk state setengah jadi;
- file yang sedang diproses hilang;
- WebSocket client reconnect ke node yang belum siap;
- sistem terlihat healthy tetapi backlog naik diam-diam.

Top 1% engineer tidak hanya bertanya:

> “Apakah pod berhasil rolling update?”

Tetapi bertanya:

> “State apa yang sedang dimiliki pod lama, bagaimana state itu dilepas, dipersist, dipindahkan, atau dibuat idempotent?”

---

## 2. Taxonomy State dalam Deployment Java

Sebelum mendesain strategi deployment, kita perlu memetakan jenis state.

### 2.1 Ephemeral Local State

State yang ada di memory/process lokal dan boleh hilang tanpa merusak correctness.

Contoh:

- computed cache yang bisa dibangun ulang;
- temporary object;
- prepared metadata;
- compiled regex cache;
- object mapper cache;
- connection idle yang bisa dibuat ulang;
- local metrics buffer yang tidak kritikal.

Karakteristik:

- hilang saat restart;
- tidak menjadi source of truth;
- boleh cold start ulang;
- dampaknya biasanya performance, bukan correctness.

Deployment implication:

- rolling update relatif aman;
- perlu memperhitungkan warm-up;
- jangan menganggap readiness true sebelum cache penting selesai minimum warm-up jika cache miss sangat mahal.

---

### 2.2 Durable External State

State yang disimpan di sistem eksternal dan tidak hilang saat process restart.

Contoh:

- database rows;
- Redis distributed session;
- Kafka topic;
- RabbitMQ queue;
- object storage;
- Quartz JDBC job store;
- workflow engine database;
- idempotency table;
- audit trail.

Karakteristik:

- process boleh restart;
- state bisa dilanjutkan process lain;
- correctness bergantung pada transactional boundary dan ownership protocol.

Deployment implication:

- rolling update bisa aman jika protocol-nya benar;
- idempotency sangat penting;
- lock/lease/ack/offset handling harus jelas;
- backward compatibility antara versi lama dan baru harus dijaga.

---

### 2.3 Volatile Business State

State bisnis yang sedang berjalan di process memory tetapi belum durable.

Contoh:

- request create case sedang validasi lintas sistem;
- batch sedang membaca file dan belum commit progress;
- message sedang diproses tetapi belum ack;
- payment/notification sedang kirim ke external system;
- workflow transition sudah update sebagian data tetapi belum selesai;
- generated document belum disimpan.

Karakteristik:

- kehilangan state bisa menyebabkan lost update, duplicate side effect, atau inconsistent outcome;
- sering tersembunyi di code path;
- tidak selalu terlihat dari Kubernetes health check.

Deployment implication:

- butuh graceful shutdown;
- stop accepting new work;
- finish in-flight work atau persist checkpoint;
- side effect harus idempotent;
- timeout harus selaras dengan termination grace period.

---

### 2.4 Ownership State

State yang menunjukkan process mana yang berhak mengerjakan sesuatu.

Contoh:

- message delivery ownership;
- Kafka partition assignment;
- RabbitMQ unacked delivery;
- leader election lease;
- distributed lock;
- Quartz trigger acquisition;
- scheduler singleton ownership;
- file lock;
- WebSocket connection ownership;
- cache shard ownership.

Karakteristik:

- bukan data bisnis langsung;
- mengatur siapa yang boleh bekerja;
- deployment mengubah pemilik.

Deployment implication:

- perlu handoff;
- harus ada lease expiry atau explicit release;
- duplicate ownership harus dicegah;
- no-owner gap harus dikendalikan.

---

### 2.5 Compatibility State

State yang formatnya bisa berubah antar versi aplikasi.

Contoh:

- serialized Java object di Redis/session;
- JSON payload di cache;
- message schema;
- database enum/string code;
- file format;
- workflow variable;
- Quartz job data map;
- persisted retry payload;
- outbox payload;
- JWT/custom claim interpretation;
- feature flag state.

Karakteristik:

- versi lama dan baru mungkin membaca/menulis format berbeda;
- rollback bisa gagal jika versi baru menulis state yang tidak dipahami versi lama;
- sering menjadi penyebab rollback tidak aman.

Deployment implication:

- format harus backward/forward compatible;
- gunakan additive change;
- hindari Java native serialization untuk cross-version state;
- rollback plan harus memasukkan state compatibility, bukan hanya artifact rollback.

---

## 3. Pertanyaan Kunci sebelum Deploy Stateful Java Service

Sebelum menentukan strategi deployment, jawab pertanyaan berikut.

### 3.1 State apa yang ada?

```text
Apakah service menyimpan state di memory?
Apakah ada session?
Apakah ada local cache?
Apakah ada distributed cache?
Apakah ada queue consumer?
Apakah ada scheduler?
Apakah ada batch/job?
Apakah ada file temporary?
Apakah ada long-running request?
Apakah ada WebSocket/SSE?
Apakah ada external side effect?
```

### 3.2 Siapa pemilik state saat ini?

```text
Pod mana yang memegang session?
Consumer mana yang memegang message?
Node mana yang menjalankan scheduler?
Instance mana yang memegang lock?
Thread mana yang sedang menjalankan job?
Transaction mana yang belum commit?
```

### 3.3 State bisa hilang atau harus dipindahkan?

```text
Jika pod mati sekarang, apa yang rusak?
Apakah work bisa diulang?
Apakah external system akan menerima duplicate request?
Apakah user cukup retry?
Apakah audit trail tetap konsisten?
```

### 3.4 State kompatibel dengan versi baru dan lama?

```text
Apakah versi baru menulis field baru?
Apakah versi lama bisa membaca payload baru?
Apakah session object berubah class/package?
Apakah cache key berubah?
Apakah job data map berubah?
Apakah message schema berubah?
```

### 3.5 Apa mekanisme drain?

```text
Bagaimana instance berhenti menerima traffic baru?
Bagaimana consumer berhenti mengambil message baru?
Bagaimana scheduler berhenti trigger job baru?
Bagaimana batch checkpoint?
Bagaimana WebSocket reconnect diarahkan?
Berapa lama in-flight work boleh selesai?
```

Jika jawaban ini tidak jelas, deployment masih spekulatif.

---

## 4. HTTP Session Deployment

HTTP session adalah bentuk stateful yang sangat umum di Java web application, terutama aplikasi berbasis servlet container, Spring MVC, JSF, Jakarta Faces, legacy WAR, dan enterprise portal.

### 4.1 Session Local di Memory

Model paling sederhana:

```text
client -> load balancer -> app instance A
app instance A stores session in memory
```

Masalah saat deployment:

```text
instance A terminated
session disappears
user is logged out or state lost
```

Jika ada sticky session:

```text
client consistently routed to A
A dies during rolling update
client must reconnect to another instance
new instance does not have session
```

Local session cocok hanya jika:

- logout saat deployment dapat diterima;
- aplikasi internal low criticality;
- deployment dilakukan di maintenance window;
- session tidak menyimpan state bisnis penting;
- user retry/relogin acceptable.

Untuk sistem enterprise, local session sering menjadi deployment liability.

---

### 4.2 Sticky Session

Sticky session membuat client yang sama diarahkan ke backend yang sama.

```text
client-1 -> instance A
client-2 -> instance B
client-3 -> instance A
```

Keuntungan:

- session local bisa dipakai;
- tidak perlu distributed session;
- lebih sederhana.

Risiko deployment:

- instance yang di-drain masih memegang banyak session;
- rolling update bisa memaksa relogin sebagian user;
- load imbalance;
- scale down sulit;
- failure node menyebabkan session loss;
- blue-green cutover dapat memutus semua sticky affinity.

Sticky session bukan zero-downtime guarantee. Sticky session hanya affinity routing.

---

### 4.3 Distributed Session

Session dipindah ke store eksternal:

```text
client -> any app instance -> Redis/JDBC/session store
```

Keuntungan:

- instance boleh mati tanpa kehilangan session;
- rolling update lebih aman;
- scale out lebih mudah;
- tidak wajib sticky session.

Risiko:

- Redis/session store menjadi dependency kritikal;
- latency setiap request bisa naik;
- serialization compatibility menjadi penting;
- session payload bisa membengkak;
- TTL/expiration behavior harus jelas;
- logout/session invalidation harus konsisten.

Deployment implication:

- jangan simpan object Java kompleks yang berubah class/package antar versi;
- prefer JSON/simple primitive session attributes;
- versioning session data jika perlu;
- pastikan versi lama dan baru bisa membaca session yang sama selama rolling update;
- pahami TTL dan cleanup behavior.

Spring Session, misalnya, dapat memakai Redis sebagai backing store. Untuk Redis indexed sessions, dokumentasinya menjelaskan bahwa cleanup session expired bergantung pada Redis keyspace events untuk mendengar event expired/deleted. Ini berarti deployment session bukan hanya “pasang Redis”, tetapi juga konfigurasi Redis dan event expiry behavior.

---

### 4.4 Session Compatibility Problem

Contoh buruk:

```java
session.setAttribute("userContext", new UserContext(...));
```

Lalu versi baru mengubah package/class:

```text
com.company.auth.UserContext
-> com.company.identity.AuthenticatedUserContext
```

Jika session diserialisasi sebagai Java object, versi lain bisa gagal membaca.

Failure mode:

```text
ClassNotFoundException
InvalidClassException
Cannot deserialize session
User forced logout
Request 500
```

Pattern lebih aman:

```text
session stores:
- userId
- tenantId
- role codes
- auth time
- csrf token
- small primitive/string values

application reconstructs rich context from database/cache/token
```

Prinsip:

> Session adalah continuity token, bukan object graph dump.

---

### 4.5 Session Deployment Checklist

Sebelum deploy aplikasi sessionful:

```text
[ ] Apakah session local atau distributed?
[ ] Jika local, apakah relogin user acceptable?
[ ] Jika sticky, apa behavior saat instance terminate?
[ ] Jika distributed, apakah session format backward compatible?
[ ] Apakah session payload kecil?
[ ] Apakah session TTL jelas?
[ ] Apakah logout invalidates central session?
[ ] Apakah rolling update menjalankan dua versi yang membaca session sama?
[ ] Apakah session store punya capacity dan monitoring?
[ ] Apakah readiness bergantung pada session store availability?
```

---

## 5. Local Cache Deployment

Local cache umum dalam Java:

- Caffeine;
- Guava Cache;
- Ehcache local mode;
- static map;
- in-memory lookup table;
- compiled rule cache;
- feature/config cache;
- permission cache;
- template cache;
- postal/address cache;
- reference data cache.

### 5.1 Local Cache sebagai Performance Optimization

Jika cache hanya optimization:

```text
cache miss -> load from DB/API -> store local cache
```

Maka deployment relatif aman. Instance baru cold cache, lalu warm up perlahan.

Risiko:

- cold start latency spike;
- thundering herd ke DB/API;
- readiness true terlalu cepat;
- canary terlihat lambat bukan karena bug, tapi cache belum warm;
- rolling update semua pod sekaligus menghapus seluruh local cache.

Mitigasi:

- rolling update bertahap;
- maxUnavailable rendah;
- pre-warm critical cache;
- request coalescing/in-flight dedup;
- TTL jitter;
- rate limit external lookup;
- readiness menunggu minimum required reference data.

---

### 5.2 Local Cache sebagai Hidden Source of Truth

Ini berbahaya:

```text
DB updated
local cache not invalidated
old process serves stale decision
```

Contoh:

- role/permission cache;
- enforcement rule cache;
- fee calculation table;
- status transition rule;
- template version;
- agency configuration;
- feature entitlement.

Jika local cache mempengaruhi keputusan bisnis, maka deployment harus menjawab:

```text
Apakah cache harus flushed saat deploy?
Apakah versi lama dan baru memakai key sama?
Apakah cache invalidation event reliable?
Apakah cache berisi data dengan schema lama?
Apakah rollback membaca cache versi baru?
```

---

### 5.3 Cache Key Versioning

Jika format value berubah, cache key harus diberi version.

Buruk:

```text
permission:{userId}
```

Lebih aman:

```text
permission:v1:{userId}
permission:v2:{userId}
```

Untuk local cache, version bisa di nama cache:

```text
permission-cache-v2
rule-evaluation-cache-v3
```

Trade-off:

- key versioning mencegah deserialization/format mismatch;
- tetapi menyebabkan cold cache saat release;
- butuh expiry/cleanup untuk key lama.

---

### 5.4 Cache Invalidation saat Rolling Update

Rolling update menjalankan dua versi bersamaan:

```text
version N pods still running
version N+1 pods starting
```

Pertanyaan:

```text
Apakah kedua versi boleh share cache?
Apakah cache value kompatibel?
Apakah invalidation event dipahami dua versi?
Apakah version N+1 menulis value yang version N tidak bisa baca?
```

Jika tidak kompatibel:

- gunakan cache namespace berbeda;
- deploy expand-contract;
- clear cache sebelum/selama deploy;
- gunakan short TTL;
- hindari rollback setelah value incompatible ditulis.

---

### 5.5 Cache Deployment Checklist

```text
[ ] Apakah cache local, distributed, atau hybrid?
[ ] Apakah cache hanya performance atau mempengaruhi correctness?
[ ] Apa behavior jika cache kosong?
[ ] Apa behavior jika cache stale?
[ ] Apakah cache key/value berubah di release ini?
[ ] Apakah versi lama dan baru bisa share cache?
[ ] Apakah ada TTL dan jitter?
[ ] Apakah ada invalidation mechanism?
[ ] Apakah warm-up diperlukan sebelum readiness?
[ ] Apakah external dependency aman dari thundering herd?
```

---

## 6. Distributed Cache Deployment

Distributed cache seperti Redis, Hazelcast, Infinispan, Memcached, atau managed cache sering dianggap menyelesaikan state. Sebenarnya ia hanya memindahkan state dari process ke sistem lain.

### 6.1 Distributed Cache sebagai Shared State

Model:

```text
app instance A -> Redis
app instance B -> Redis
app instance C -> Redis
```

Keuntungan:

- state survives process restart;
- multiple instance share data;
- rolling update lebih stabil;
- session/cache tidak hilang saat pod mati.

Risiko:

- cache outage bisa menjatuhkan aplikasi jika tidak degraded gracefully;
- value compatibility antar versi;
- cache stampede;
- distributed lock misuse;
- stale data global;
- large payload;
- memory eviction;
- TTL terlalu panjang;
- key collision antar environment;
- secret/config salah menunjuk cache environment lain.

---

### 6.2 Cache is Not Database

Kesalahan umum:

> “Karena Redis persistent, kita jadikan source of truth.”

Cache boleh durable secara teknis, tetapi belum tentu punya:

- relational integrity;
- audit trail;
- transaction semantics yang dibutuhkan bisnis;
- backup/restore policy setara database;
- schema migration discipline;
- access governance;
- reporting capability.

Untuk deployment, bedakan:

```text
cache-aside performance cache
vs
shared operational state
vs
business source of truth
```

Semakin cache mendekati source of truth, semakin deployment harus memperlakukannya seperti database migration.

---

### 6.3 Redis Deployment Interaction

Untuk Java app yang memakai Redis:

- connection pool harus drain saat shutdown;
- timeout tidak boleh infinite;
- reconnection behavior harus jelas;
- key namespace harus environment-specific;
- TLS/truststore harus dikelola;
- failover behavior harus diuji;
- serialization harus version-tolerant;
- TTL harus eksplisit untuk temporary state.

Contoh key namespace:

```text
{system}:{env}:{service}:{domain}:{version}:{id}

aceas:uat:case-service:permission:v2:USER123
```

---

### 6.4 Distributed Cache Checklist

```text
[ ] Apakah cache bisa unavailable tanpa total outage?
[ ] Apakah cache value backward/forward compatible?
[ ] Apakah cache key memiliki namespace environment?
[ ] Apakah TTL eksplisit?
[ ] Apakah eviction risk dimonitor?
[ ] Apakah cache miss storm dimitigasi?
[ ] Apakah cache clear diperlukan saat deploy?
[ ] Apakah rollback aman terhadap value baru?
[ ] Apakah connection pool ditutup saat shutdown?
[ ] Apakah readiness memeriksa cache dependency secara proporsional?
```

---

## 7. Queue Consumer Deployment

Message queue adalah area yang sangat rawan saat deployment karena ada konsep ownership, acknowledgement, retry, ordering, dan side effect.

Contoh teknologi:

- RabbitMQ;
- Kafka;
- ActiveMQ/Artemis;
- Amazon SQS;
- JMS broker;
- IBM MQ;
- cloud pub/sub.

### 7.1 Queue Consumer Mental Model

Consumer lifecycle:

```text
consumer subscribes
broker delivers message
consumer processes message
consumer acknowledges/commits offset
broker removes or marks message done
```

Deployment risk muncul ketika process berhenti di tengah:

```text
message delivered
processing starts
external side effect happens
process dies before ack
broker redelivers
side effect happens again
```

Atau:

```text
message delivered
ack sent too early
process dies before business commit
message lost
```

---

## 8. RabbitMQ Consumer Deployment

RabbitMQ umum di Java enterprise via Spring AMQP, raw AMQP client, atau JMS adapter.

RabbitMQ mendukung acknowledgement mode. Dalam mode manual acknowledgement, consumer mengirim ack setelah berhasil memproses pesan. Dokumentasi RabbitMQ membedakan automatic acknowledgement dan manual acknowledgement; manual ack penting untuk data safety karena broker tahu kapan delivery dianggap selesai.

### 8.1 Auto Ack Risk

Dengan auto ack:

```text
broker delivers message
message considered done immediately
consumer crashes before processing complete
message lost
```

Auto ack cocok hanya untuk event low criticality yang boleh hilang, bukan workflow penting.

---

### 8.2 Manual Ack Pattern

Pattern aman:

```text
receive message
validate schema
start transaction or business unit
perform idempotent business operation
commit durable state
ack message
```

Pseudo-code:

```java
void handle(Message message, Channel channel) {
    long tag = message.getMessageProperties().getDeliveryTag();

    try {
        businessService.processIdempotently(message);
        channel.basicAck(tag, false);
    } catch (TransientException e) {
        channel.basicNack(tag, false, true); // requeue carefully
    } catch (PermanentException e) {
        deadLetter(message, e);
        channel.basicAck(tag, false);
    }
}
```

Tetapi hati-hati:

- requeue tanpa limit bisa infinite poison loop;
- nack requeue bisa mengganggu ordering;
- DLQ harus disiapkan;
- idempotency tetap wajib karena crash bisa terjadi setelah commit sebelum ack.

---

### 8.3 Prefetch and Shutdown

RabbitMQ prefetch membatasi jumlah pesan unacked yang boleh dikirim ke consumer. Dokumentasi RabbitMQ menjelaskan consumer prefetch sebagai extension terhadap channel prefetch untuk membatasi jumlah unacknowledged messages yang dikirim.

Deployment implication:

- prefetch terlalu tinggi membuat pod yang akan shutdown masih memegang banyak pesan;
- drain jadi lama;
- redelivery burst setelah pod mati;
- memory naik;
- uneven work distribution.

Contoh:

```text
10 pods
prefetch = 100
max unacked in cluster = 1000
rolling update terminates 1 pod
that pod may hold up to 100 unfinished messages
```

Jika setiap message butuh 2 detik, drain bisa lama.

Untuk graceful shutdown:

```text
SIGTERM received
stop consuming new messages
finish current messages up to timeout
ack completed messages
nack/requeue unfinished messages deliberately
close channel/connection
exit
```

---

### 8.4 Spring AMQP Shutdown Consideration

Dalam Spring-based consumer, perhatikan:

- listener container shutdown timeout;
- concurrent consumers;
- prefetch count;
- acknowledge mode;
- error handler;
- retry interceptor;
- DLQ binding;
- transaction manager;
- `SimpleMessageListenerContainer` vs `DirectMessageListenerContainer` behavior;
- Kubernetes termination grace period.

Kontrak waktu harus selaras:

```text
terminationGracePeriodSeconds >= listener shutdown timeout + max processing time + buffer
```

Jika tidak, Kubernetes bisa kill process saat message masih diproses.

---

### 8.5 RabbitMQ Deployment Checklist

```text
[ ] Apakah consumer auto ack atau manual ack?
[ ] Apakah business operation idempotent?
[ ] Apakah ack dilakukan setelah durable commit?
[ ] Apakah prefetch sesuai dengan shutdown time?
[ ] Apakah consumer stop menerima pesan saat SIGTERM?
[ ] Apakah DLQ tersedia?
[ ] Apakah poison message punya retry limit?
[ ] Apakah redelivery metric dimonitor?
[ ] Apakah deployment bisa menyebabkan duplicate processing?
[ ] Apakah termination grace period cukup?
```

---

## 9. Kafka Consumer Deployment

Kafka berbeda dari RabbitMQ. State utama adalah offset dan partition assignment.

### 9.1 Kafka Consumer Mental Model

```text
consumer group owns topic partitions
each partition assigned to one consumer in group
consumer polls records
consumer processes records
consumer commits offset
```

Deployment memicu:

- consumer leaves group;
- rebalance;
- partition assigned to another consumer;
- in-flight records may be retried;
- ordering per partition must be respected.

---

### 9.2 Offset Commit Timing

Risk pattern 1: commit terlalu awal.

```text
poll records
commit offset
process records
crash
records lost from consumer perspective
```

Risk pattern 2: commit setelah process.

```text
poll records
process records
crash before commit
records processed again
```

Pattern kedua lebih aman jika business operation idempotent.

Prinsip:

> Untuk workload penting, prefer at-least-once + idempotency daripada at-most-once yang silently loses work.

---

### 9.3 Rebalance and Rolling Update

Rolling update Kafka consumer menyebabkan group rebalance.

Jika deployment terlalu agresif:

```text
pod-1 down -> rebalance
pod-2 down -> rebalance again
pod-3 down -> rebalance again
```

Dampak:

- processing pause;
- latency naik;
- duplicate processing;
- consumer lag naik;
- partition thrashing.

Mitigasi:

- rolling update lambat;
- maxUnavailable = 1;
- cooperative rebalancing jika sesuai;
- static membership jika sesuai;
- graceful shutdown consumer;
- pause/resume consumer;
- monitor consumer lag;
- avoid deploy saat backlog tinggi.

---

### 9.4 Kafka Deployment Checklist

```text
[ ] Apakah offset commit setelah durable processing?
[ ] Apakah processing idempotent?
[ ] Apakah consumer group rebalance behavior dipahami?
[ ] Apakah rolling update terlalu cepat?
[ ] Apakah consumer lag dimonitor saat deploy?
[ ] Apakah poison record handling tersedia?
[ ] Apakah schema compatible dengan versi lama/baru?
[ ] Apakah partition ordering requirement jelas?
[ ] Apakah max.poll.interval.ms cukup untuk processing time?
[ ] Apakah shutdown memanggil close() agar rebalance clean?
```

---

## 10. Idempotency sebagai Syarat Deployment Stateful

Idempotency berarti operasi bisa diulang tanpa mengubah hasil secara salah.

Contoh operasi tidak idempotent:

```text
send email
charge payment
create case
add penalty
publish notification
insert audit row
increment counter
call external API
```

Jika message bisa redeliver, request bisa retry, atau deployment bisa kill process setelah side effect, maka idempotency wajib.

### 10.1 Idempotency Key

Gunakan idempotency key dari domain:

```text
messageId
requestId
caseId + transitionId
externalReferenceNo
fileName + rowNumber + batchId
businessEventId
```

Database table:

```sql
CREATE TABLE processed_message (
    idempotency_key VARCHAR(200) PRIMARY KEY,
    status VARCHAR(30) NOT NULL,
    result_ref VARCHAR(200),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

Flow:

```text
receive message
insert idempotency key
if duplicate, return previous result or skip
perform operation
mark completed
ack/commit
```

---

### 10.2 Idempotency Boundary

Idempotency harus menutup side effect, bukan hanya database insert.

Buruk:

```text
insert idempotency key
send external email
crash before mark completed
retry sends email again
```

Lebih aman:

```text
create notification record with unique business key
outbox publisher sends email once
external provider called with idempotency/reference key if supported
```

---

### 10.3 Idempotency Checklist

```text
[ ] Apa idempotency key-nya?
[ ] Apakah key berasal dari domain, bukan random runtime UUID?
[ ] Apakah duplicate request menghasilkan hasil aman?
[ ] Apakah external side effect juga idempotent?
[ ] Apakah idempotency record transactional dengan business change?
[ ] Apakah partial failure status jelas?
[ ] Apakah retry bisa membedakan in-progress, completed, failed?
[ ] Apakah retention idempotency key cukup panjang?
```

---

## 11. Scheduler Deployment

Scheduler sering terlihat sederhana, tetapi sangat berbahaya dalam deployment multi-instance.

Contoh:

- Spring `@Scheduled`;
- Quartz;
- cron inside app;
- Kubernetes CronJob;
- EJB Timer;
- custom polling loop;
- batch trigger;
- report generator;
- reminder notification;
- SLA escalation job;
- housekeeping job.

### 11.1 The Double Scheduler Problem

Jika aplikasi punya 3 pod dan semua menjalankan scheduler:

```text
pod A runs job at 01:00
pod B runs job at 01:00
pod C runs job at 01:00
```

Jika job tidak idempotent, hasilnya fatal:

- email terkirim tiga kali;
- penalty dihitung tiga kali;
- case auto-escalated tiga kali;
- report overwritten;
- duplicate integration call;
- lock contention;
- database spike.

---

### 11.2 Disable Local Scheduler by Default in Replicated Services

Untuk service yang diskalakan horizontal, pattern aman:

```text
web/API pods: scheduler disabled
worker/scheduler pod: scheduler enabled
```

Contoh config:

```yaml
app:
  scheduler:
    enabled: false
```

Deployment:

```text
case-api deployment replicas=4 scheduler=false
case-scheduler deployment replicas=1 scheduler=true
```

Tetapi single replica scheduler punya availability issue. Untuk HA, gunakan leader election atau clustered scheduler.

---

### 11.3 Quartz Clustered Scheduler

Quartz mendukung clustering dengan JDBC JobStore. Dokumentasi Quartz menyatakan clustering diaktifkan dengan `org.quartz.jobStore.isClustered=true`, dan instance cluster berbagi database yang sama.

Mental model:

```text
multiple scheduler nodes
shared Quartz tables
trigger acquisition protected by DB lock
only one node executes a trigger fire
```

Keuntungan:

- HA scheduler;
- failover;
- multiple nodes bisa share workload;
- trigger state durable.

Risiko:

- DB lock contention;
- clock skew;
- misfire handling harus dipahami;
- long-running job perlu interruption/checkpoint;
- job data compatibility antar versi;
- deployment dua versi scheduler bersamaan bisa membaca job data berbeda.

---

### 11.4 Spring @Scheduled in Kubernetes

Spring `@Scheduled` sederhana, tetapi bukan cluster-aware secara default.

Jika dipakai di multi-pod deployment:

- semua pod menjalankan job;
- tidak ada distributed lock otomatis;
- tidak ada persistent trigger state;
- tidak ada failover semantics yang eksplisit.

Pattern mitigasi:

1. scheduler hanya aktif di satu deployment/replica;
2. gunakan ShedLock atau DB/distributed lock;
3. gunakan Kubernetes CronJob untuk trigger external;
4. gunakan Quartz clustered;
5. pindahkan scheduled work ke queue-based worker.

---

### 11.5 Kubernetes CronJob vs In-App Scheduler

Kubernetes CronJob:

```text
Kubernetes creates Job at schedule time
Job runs pod
pod exits after completion
```

Cocok untuk:

- periodic batch yang isolated;
- housekeeping;
- report generation;
- integration polling;
- short-to-medium job;
- job yang bisa containerized terpisah.

Kurang cocok untuk:

- sub-second scheduling;
- complex trigger calendar;
- persistent trigger state complex;
- job yang perlu tightly integrated dengan app memory;
- long-running workflow engine.

In-app scheduler cocok jika:

- job butuh domain service langsung;
- trigger logic kompleks;
- perlu persistent trigger state;
- butuh misfire handling;
- butuh clustering semantics seperti Quartz.

---

### 11.6 Scheduler Deployment Checklist

```text
[ ] Apakah scheduler berjalan di semua pod?
[ ] Jika ya, apakah job idempotent dan aman paralel?
[ ] Jika tidak, bagaimana singleton dijamin?
[ ] Apakah scheduler state durable?
[ ] Apakah ada leader election/cluster lock?
[ ] Apakah job bisa selesai saat SIGTERM?
[ ] Apakah job bisa checkpoint/resume?
[ ] Apakah misfire policy dipahami?
[ ] Apakah deployment dua versi scheduler aman?
[ ] Apakah job data compatible antar versi?
```

---

## 12. Batch Job Deployment

Batch/job processing punya karakteristik berbeda dari API request.

API request:

```text
short-lived
client waiting
failure visible quickly
```

Batch job:

```text
long-running
no interactive client
may process many records
may call external systems
may write partial output
failure discovered late
```

### 12.1 Batch State

Batch job biasanya punya state:

- job instance;
- job execution;
- step execution;
- cursor/page position;
- processed count;
- failed count;
- input file offset;
- output file location;
- retry state;
- partition ownership;
- checkpoint.

Jika state hanya di memory, deployment/restart bisa membuat batch mulai ulang dari awal.

---

### 12.2 Restartable Batch Pattern

Batch yang production-grade harus punya checkpoint.

```text
job starts
process chunk 1
commit chunk 1 + checkpoint
process chunk 2
commit chunk 2 + checkpoint
crash
restart from chunk 3
```

Prinsip:

```text
small durable chunks
idempotent write
checkpoint after commit
restart from last safe point
```

---

### 12.3 Spring Batch Deployment Notes

Spring Batch menyediakan konsep metadata job repository seperti JobInstance, JobExecution, StepExecution, dan ExecutionContext. Dalam deployment, metadata ini adalah deployment safety mechanism.

Risiko:

- schema Spring Batch tidak cocok versi library;
- job parameter berubah sehingga job instance dianggap berbeda;
- job restart policy salah;
- step tidak idempotent;
- chunk terlalu besar;
- pod termination lebih pendek dari chunk processing;
- multiple launcher menjalankan job yang sama.

---

### 12.4 Batch During Deployment

Strategi:

1. **No batch during deploy**  
   Pause scheduler/launcher sebelum deploy.

2. **Drain and deploy**  
   Tunggu running job selesai, lalu deploy.

3. **Checkpoint and stop**  
   Stop job di checkpoint aman, deploy, resume.

4. **Rolling workers**  
   Jika job partitioned dan idempotent, worker bisa rolling bertahap.

5. **Blue-green batch**  
   Gunakan versi baru hanya untuk job baru; job lama diselesaikan versi lama.

---

### 12.5 Batch Deployment Checklist

```text
[ ] Apakah job restartable?
[ ] Apakah checkpoint durable?
[ ] Apakah chunk size sesuai termination grace period?
[ ] Apakah step idempotent?
[ ] Apakah multiple launcher bisa duplicate job?
[ ] Apakah job lama boleh dilanjutkan versi baru?
[ ] Apakah job parameter/schema berubah?
[ ] Apakah running job harus drain sebelum deploy?
[ ] Apakah partial output bisa dibersihkan?
[ ] Apakah job execution status dimonitor?
```

---

## 13. Leader Election dan Distributed Lock

Leader election digunakan ketika hanya satu instance boleh menjalankan suatu fungsi.

Contoh:

- scheduler singleton;
- polling external system;
- reconciliation loop;
- cache warmer;
- cleanup job;
- outbox publisher;
- workflow timer;
- license sync;
- file pickup.

### 13.1 Lock vs Lease

Distributed lock biasa:

```text
instance acquires lock
holds lock
releases lock
```

Masalah:

```text
instance dies before release
lock stuck forever
```

Lease:

```text
instance acquires lock with TTL
renews periodically
if dies, lease expires
another instance acquires
```

Untuk deployment, lease lebih aman karena process bisa mati mendadak.

---

### 13.2 Fencing Token

Distributed lock saja belum cukup untuk mencegah stale owner.

Scenario:

```text
A acquires lock
A pauses due to GC/network
lease expires
B acquires lock
A resumes and still thinks it owns lock
A writes stale update
```

Fencing token pattern:

```text
lock service returns increasing token
resource accepts only latest token
old owner write rejected
```

Contoh:

```text
A token=10
B token=11
DB/resource rejects writes with token < 11
```

Ini advanced, tetapi penting untuk sistem yang benar-benar strict.

---

### 13.3 Lock Checklist

```text
[ ] Apakah lock punya TTL?
[ ] Apakah lock diperpanjang secara aman?
[ ] Apakah lock release best-effort atau mandatory?
[ ] Apa yang terjadi jika holder crash?
[ ] Apakah split-brain mungkin?
[ ] Apakah perlu fencing token?
[ ] Apakah job idempotent walau lock gagal?
[ ] Apakah lock dependency highly available?
```

---

## 14. WebSocket, SSE, and Long-Lived Connections

Deployment API request biasa mungkin selesai dalam milidetik/detik. WebSocket dan SSE bisa hidup lama.

### 14.1 Deployment Problem

```text
client connected to pod A via WebSocket
rolling update terminates pod A
connection drops
client reconnects
new pod must restore subscription/context
```

Risiko:

- message lost during reconnect;
- duplicate subscription;
- user presence wrong;
- server-side state lost;
- sticky routing broken;
- readiness true but subscription system not ready.

---

### 14.2 Safer Pattern

```text
connection state is ephemeral
subscription state stored/recoverable
client has reconnect logic
messages have sequence id
client can resume from last seen id
server supports heartbeat
pod drains by refusing new connection before close
```

Untuk WebSocket deployment:

```text
readiness false
stop accepting new connections
notify clients to reconnect if protocol supports
wait drain duration
close remaining connections
exit
```

---

### 14.3 Long Connection Checklist

```text
[ ] Apakah client reconnect otomatis?
[ ] Apakah subscription state recoverable?
[ ] Apakah message punya sequence/replay?
[ ] Apakah readiness false sebelum close?
[ ] Apakah load balancer idle timeout sesuai?
[ ] Apakah sticky session diperlukan?
[ ] Apakah rolling update capacity cukup saat reconnect storm?
```

---

## 15. File Processing State

Banyak Java enterprise system masih memproses file:

- CSV import;
- XML integration;
- SFTP pickup;
- report generation;
- document conversion;
- batch upload;
- archival export;
- reconciliation file.

### 15.1 File Processing Failure Modes

```text
file picked by pod A
pod A crashes mid-processing
pod B also picks same file
partial output exists
input file moved too early
error file generated twice
```

---

### 15.2 Safe File Processing Pattern

```text
incoming/file1.csv
-> acquire lock or atomic rename
processing/file1.csv
-> process with checkpoint/idempotency
-> write output temp
-> atomic move output final
-> move input to archive
```

Use state markers:

```text
RECEIVED
PROCESSING
COMPLETED
FAILED_RETRYABLE
FAILED_PERMANENT
ARCHIVED
```

Prefer database row as processing ledger:

```sql
CREATE TABLE file_processing_job (
    file_id VARCHAR(200) PRIMARY KEY,
    file_name VARCHAR(500) NOT NULL,
    checksum VARCHAR(128),
    status VARCHAR(50) NOT NULL,
    locked_by VARCHAR(100),
    lock_until TIMESTAMP,
    processed_rows BIGINT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

---

## 16. StatefulSet vs Deployment in Kubernetes

Kubernetes Deployment treats pods as interchangeable.

```text
case-api-7d8f9c-abc
case-api-7d8f9c-def
```

StatefulSet provides stable identity and stable storage association:

```text
worker-0
worker-1
worker-2
```

Kubernetes documentation describes StatefulSet as workload API object for stateful applications, managing deployment/scaling of Pods while providing guarantees such as stable identity and ordered behavior.

Use StatefulSet when:

- pod identity matters;
- stable network identity matters;
- each replica owns shard/partition/local disk;
- ordered startup/shutdown matters;
- persistent volume per replica is required.

Do not use StatefulSet just because app has database state. Most Java API services with external database should still be Deployment.

### 16.1 StatefulSet Deployment Risk

StatefulSet updates can be more conservative, but do not magically solve application-level state.

You still need:

- graceful shutdown;
- ownership release;
- data compatibility;
- readiness correctness;
- backup/restore;
- split-brain prevention;
- idempotency.

---

## 17. Deployment Strategy by Stateful Pattern

### 17.1 Sessionful Web App

Recommended:

```text
use distributed session or accept relogin
ensure session compatibility
readiness false before termination
traffic drain
avoid incompatible session object changes
```

Deployment strategy:

- rolling update if distributed/compatible;
- blue-green if session can be re-established;
- maintenance window if local session loss unacceptable and no distributed session.

---

### 17.2 Queue Worker

Recommended:

```text
manual ack / commit after durable processing
idempotency key
stop consuming on SIGTERM
prefetch tuned to drain time
DLQ and retry policy
```

Deployment strategy:

- rolling update with maxUnavailable=1;
- pause consumers if message schema incompatible;
- canary worker if side effects are observable and safe;
- avoid blue-green both active unless duplicate processing controlled.

---

### 17.3 Scheduler

Recommended:

```text
single scheduler role
cluster-aware scheduler or leader election
pause schedule during incompatible deployment
job idempotency
misfire policy
```

Deployment strategy:

- deploy scheduler separately from API;
- drain running job;
- disable trigger temporarily for dangerous changes;
- run new version for new jobs only if old jobs incompatible.

---

### 17.4 Batch Job

Recommended:

```text
checkpoint
restartability
idempotent chunks
single launcher per job instance
clear status model
```

Deployment strategy:

- no deploy during critical batch unless restartable;
- checkpoint then stop;
- deploy worker pool rolling only if partitioned and safe;
- preserve old version for running job if execution context incompatible.

---

### 17.5 Cache-Heavy Service

Recommended:

```text
versioned keys
warm-up
TTL jitter
cache invalidation
cache stampede protection
```

Deployment strategy:

- rolling update with gradual warm-up;
- canary may look slower due to cold cache;
- blue-green can cause cache stampede if all new pods cold.

---

## 18. Stateful Deployment Decision Matrix

| Workload | Main Risk | Required Control | Deployment Strategy |
|---|---|---|---|
| Local session web app | User session loss | Sticky/drain/distributed session | Rolling with caution or maintenance |
| Distributed session web app | Session format mismatch | Version-tolerant session | Rolling |
| Local cache app | Cold start/stampede | Warm-up, rate limit, TTL jitter | Rolling slow |
| Distributed cache app | Format/stale data | Key versioning, TTL, invalidation | Rolling/blue-green |
| RabbitMQ worker | Duplicate/lost message | Manual ack, idempotency, DLQ | Rolling slow |
| Kafka worker | Rebalance/duplicate processing | Commit discipline, idempotency | Rolling slow |
| Scheduler singleton | Duplicate job | Lock/leader/cluster scheduler | Separate scheduler deployment |
| Quartz cluster | Misfire/job data incompatibility | JDBC store, compatible job data | Rolling with care |
| Batch job | Partial processing | Checkpoint, restartability | Drain/checkpoint before deploy |
| WebSocket/SSE | Connection drop/lost event | Reconnect, replay, drain | Rolling with capacity buffer |
| File processor | Duplicate/partial file | Ledger, lock, atomic move | Rolling with lock/checkpoint |

---

## 19. Designing Graceful Shutdown for Stateful Workloads

A generic shutdown sequence:

```text
1. receive SIGTERM
2. mark instance as not ready
3. stop accepting new external traffic
4. stop acquiring new internal work
5. finish in-flight work within budget
6. persist/checkpoint/ack completed work
7. release locks/leases if safe
8. close connections
9. exit before grace period expires
```

For API:

```text
readiness false
HTTP server stops accepting new requests
drain in-flight requests
close DB/cache clients
```

For queue worker:

```text
stop consumer container
finish current messages
ack completed
nack/requeue unfinished if needed
close broker connection
```

For scheduler:

```text
pause trigger acquisition
finish or interrupt current job according to policy
update job execution state
release leader lease
```

For batch:

```text
stop after current chunk
commit checkpoint
mark execution STOPPED or FAILED_RETRYABLE
exit
```

---

## 20. Deployment Readiness for Stateful Java Services

Readiness is not only “process started”. For stateful services, readiness may require:

- DB reachable;
- cache reachable if required for correctness;
- session store reachable;
- message broker reachable for worker;
- schema version compatible;
- required reference data loaded;
- leader election initialized;
- migration lock not active;
- local cache warm enough;
- application not in draining mode.

But readiness must not be too strict either. If readiness fails because optional cache is down, Kubernetes may remove all pods and create outage.

Classify dependency:

```text
hard dependency: app cannot serve correct response without it
soft dependency: app can serve degraded response
startup dependency: required only during boot
worker dependency: required only for background workload
```

---

## 21. Observability for Stateful Deployment

You cannot safely deploy stateful systems without observing state transitions.

### 21.1 Metrics

For sessions:

```text
active_sessions
session_store_latency
session_deserialization_errors
forced_logout_count
```

For cache:

```text
cache_hit_ratio
cache_miss_rate
cache_load_latency
cache_evictions
cache_stampede_prevented
```

For queue:

```text
queue_depth
consumer_lag
unacked_messages
redelivery_count
DLQ_count
processing_latency
ack_latency
```

For scheduler/job:

```text
running_jobs
job_duration
job_failure_count
job_misfire_count
duplicate_job_detected
last_success_time
```

For shutdown:

```text
sigterm_received_count
drain_duration
inflight_at_shutdown
forced_shutdown_count
unfinished_work_requeued
```

---

### 21.2 Logs

Stateful deployment logs should show:

```text
instance entering draining mode
consumer paused
scheduler paused
in-flight count
message ack/nack decision
job checkpoint saved
leader lease released/acquired
session deserialization failure
cache namespace version
```

Avoid logs that only say:

```text
Application stopped
```

That tells nothing about work safety.

---

## 22. Anti-Patterns

### 22.1 “Stateless” Label without State Audit

Tim berkata service stateless karena tidak menyimpan data bisnis di memory, tetapi ternyata ada:

- session local;
- scheduled job;
- local permission cache;
- async queue consumer;
- temp file;
- in-memory retry buffer.

Deployment gagal karena state tidak terlihat di architecture diagram.

---

### 22.2 Auto Ack for Critical Messages

Message dianggap done saat diterima, bukan saat business commit selesai. Jika process mati di tengah, work hilang.

---

### 22.3 Scheduler Enabled in Every Replica

Horizontal scaling membuat job berjalan berkali-kali.

---

### 22.4 Java Serialized Session Object

Class berubah antar release, session gagal deserialize.

---

### 22.5 Cache without Versioning

Versi baru menulis value format baru, versi lama crash saat rollback.

---

### 22.6 Rollback without State Compatibility

Artifact rollback berhasil, tetapi state yang sudah ditulis versi baru tidak bisa dibaca versi lama.

---

### 22.7 Termination Grace Too Short

Kubernetes kill process sebelum message/job/request selesai.

---

### 22.8 Prefetch Too Large

Worker yang akan terminate memegang ratusan pesan sehingga shutdown lambat dan redelivery burst.

---

### 22.9 In-Memory Batch Progress

Batch restart dari awal dan duplicate output.

---

## 23. Practical Deployment Checklist: Stateful Java Service

Gunakan checklist ini sebelum release.

```text
STATE INVENTORY
[ ] Apakah ada HTTP session?
[ ] Apakah ada local cache?
[ ] Apakah ada distributed cache?
[ ] Apakah ada queue/topic consumer?
[ ] Apakah ada scheduler?
[ ] Apakah ada batch/job?
[ ] Apakah ada file processing?
[ ] Apakah ada WebSocket/SSE?
[ ] Apakah ada distributed lock/leader election?
[ ] Apakah ada external side effect?

OWNERSHIP
[ ] Siapa pemilik work saat runtime?
[ ] Bagaimana ownership dilepas saat shutdown?
[ ] Bagaimana ownership diambil alih instance baru?
[ ] Apakah duplicate owner mungkin?
[ ] Apakah no-owner gap acceptable?

COMPATIBILITY
[ ] Apakah state format berubah?
[ ] Apakah versi lama dan baru bisa coexist?
[ ] Apakah rollback bisa membaca state baru?
[ ] Apakah cache/session/message/job data versioned?

DRAIN
[ ] Apakah readiness false sebelum termination?
[ ] Apakah stop accepting new traffic/work tersedia?
[ ] Apakah in-flight work diberi waktu selesai?
[ ] Apakah timeout sesuai termination grace period?
[ ] Apakah unfinished work requeued/checkpointed?

CORRECTNESS
[ ] Apakah operation idempotent?
[ ] Apakah side effect external idempotent?
[ ] Apakah ack/commit setelah durable success?
[ ] Apakah retry/DLQ tersedia?
[ ] Apakah duplicate detection tersedia?

OBSERVABILITY
[ ] Apakah queue depth/lag terlihat?
[ ] Apakah redelivery terlihat?
[ ] Apakah running job terlihat?
[ ] Apakah session error terlihat?
[ ] Apakah drain duration terlihat?
[ ] Apakah forced shutdown terlihat?
```

---

## 24. Case Study 1: Rolling Update Queue Worker yang Tidak Idempotent

### Situation

Java worker membaca RabbitMQ message untuk membuat reminder letter.

Flow lama:

```text
receive message
generate PDF
send email
insert notification history
ack message
```

Saat deployment:

```text
send email succeeded
pod killed before insert history and ack
message redelivered
new pod sends email again
```

### Root Cause

- side effect email terjadi sebelum durable idempotency record;
- ack setelah side effect benar untuk preventing loss, tetapi duplicate tidak dikendalikan;
- deployment memperbesar kemungkinan crash window.

### Better Design

```text
receive message
insert notification command with unique business key
commit
ack message
outbox/email sender sends once based on command key
record provider message id
```

Atau:

```text
receive message
create idempotency record
if already completed -> ack and skip
send email with deterministic idempotency/reference key if provider supports
mark completed
ack
```

---

## 25. Case Study 2: Scheduler Runs Twice after Scaling

### Situation

Spring Boot app memiliki `@Scheduled` job untuk auto-escalate overdue cases.

Awalnya replica=1. Setelah traffic naik, replica dinaikkan ke 3.

Hasil:

```text
same overdue case escalated three times
three audit logs
three email notifications
```

### Root Cause

- scheduler local tidak cluster-aware;
- scaling API juga scaling scheduler;
- job tidak idempotent;
- tidak ada unique transition constraint.

### Better Design

Option A:

```text
case-api replicas=3 scheduler=false
case-scheduler replicas=1 scheduler=true
job idempotent with case transition unique constraint
```

Option B:

```text
Quartz clustered scheduler with JDBC JobStore
job idempotent
transition guarded by DB constraint
```

Option C:

```text
Kubernetes CronJob triggers endpoint/worker
worker claims overdue cases using DB lock/skip locked
```

---

## 26. Case Study 3: Cache Format Breaks Rollback

### Situation

Version N stores Redis value:

```json
{
  "roleCodes": ["ADMIN", "OFFICER"]
}
```

Version N+1 stores:

```json
{
  "roles": [
    {"code": "ADMIN", "scope": "GLOBAL"},
    {"code": "OFFICER", "scope": "TEAM"}
  ]
}
```

Rollback to N causes parse failure.

### Root Cause

- same key used for incompatible format;
- rollback plan ignored cache state;
- no versioning.

### Better Design

```text
permission:v1:{userId}
permission:v2:{userId}
```

Or additive compatibility:

```json
{
  "roleCodes": ["ADMIN", "OFFICER"],
  "roles": [
    {"code": "ADMIN", "scope": "GLOBAL"},
    {"code": "OFFICER", "scope": "TEAM"}
  ]
}
```

Deploy flow:

```text
N+1 can read old and new
N+1 writes both during transition
after rollback window, stop writing v1
later cleanup v1
```

---

## 27. Top 1% Mental Models

### 27.1 State Must Have an Owner

Every unit of work must answer:

```text
who owns this now?
how long is the ownership valid?
how is ownership transferred?
what happens if owner dies?
can two owners exist?
```

---

### 27.2 At-Least-Once Is the Default Reality

Networks retry. Brokers redeliver. Users double-click. Pods die. Deployments interrupt.

Assume:

```text
operation may run more than once
message may arrive more than once
request may be retried
side effect may be partially completed
```

Design idempotency accordingly.

---

### 27.3 Rollback Is a State Compatibility Problem

Rollback is not:

```text
kubectl rollout undo
```

Rollback is:

```text
Can old code safely read and operate on state already written by new code?
```

---

### 27.4 Graceful Shutdown Is a Business Correctness Feature

Graceful shutdown is not just politeness. It protects:

- money;
- legal status;
- audit trail;
- notification correctness;
- user trust;
- workflow integrity.

---

### 27.5 Stateless Is a Design Goal, Not an Assumption

A service is stateless only after state audit proves:

```text
no local business state
no local session dependency
no local scheduler side effect
no uncheckpointed batch work
no non-idempotent in-flight operation
```

---

## 28. Summary

Stateful Java deployment is about controlling continuity.

Core lessons:

1. Deployment is migration of state ownership, not just replacement of artifact.
2. State can be local, external, durable, volatile, ownership-related, or compatibility-sensitive.
3. HTTP session requires explicit decision: local, sticky, or distributed.
4. Cache requires versioning, invalidation, TTL, and warm-up strategy.
5. Queue consumers require manual ack/offset discipline, idempotency, drain, retry, and DLQ.
6. Scheduler must not accidentally run once per replica unless job is safe.
7. Batch jobs need checkpoint and restartability.
8. Distributed locks need lease semantics and sometimes fencing tokens.
9. WebSocket/SSE need reconnect and replay semantics.
10. Rollback safety depends on state format compatibility.
11. Observability must expose state transition, not only process health.

The practical invariant:

> Any state that can outlive, outpace, or be interrupted by deployment must have explicit ownership, compatibility, drain, retry, and observability rules.

---

## 29. Referensi Teknis

- Kubernetes Documentation — StatefulSets: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/
- RabbitMQ Documentation — Consumer Acknowledgements and Publisher Confirms: https://www.rabbitmq.com/docs/confirms
- RabbitMQ Documentation — Consumer Prefetch: https://www.rabbitmq.com/docs/consumer-prefetch
- RabbitMQ Documentation — Consumers: https://www.rabbitmq.com/docs/consumers
- Quartz Scheduler Documentation — Configure Clustering with JDBC-JobStore: https://www.quartz-scheduler.org/documentation/quartz-2.3.0/configuration/ConfigJDBCJobStoreClustering.html
- Spring Boot Documentation — Quartz Scheduler: https://docs.spring.io/spring-boot/reference/io/quartz.html
- Spring Session Documentation — Redis Indexed Sessions: https://docs.spring.io/spring-session/reference/configuration/reactive-redis-indexed.html

---

## 30. Status Series

Bagian ini adalah **Part 19 dari 35**.

Series **belum selesai**.

Bagian berikutnya:

> **Part 20 — Configuration, Secret Rotation, Certificate Rotation, and Truststore Deployment**

