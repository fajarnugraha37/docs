# learn-redis-mastery-for-java-engineers-part-016.md

# Part 016 — Redis Pub/Sub: Real-Time Fanout Tanpa Durability

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `016 / 034`  
> Fokus: Redis Pub/Sub sebagai primitive broadcast real-time ringan, bukan broker durable  
> Persona: Java software engineer / backend architect yang sudah memahami HTTP, SQL, Kafka, RabbitMQ, Nginx, dan Redis core data structures

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Memahami Redis Pub/Sub sebagai **message fanout mechanism**, bukan persistent queue.
2. Menjelaskan secara tepat apa yang terjadi saat publisher mengirim message ke channel.
3. Mendesain channel naming, payload, subscription lifecycle, dan handler di Java/Spring.
4. Menentukan kapan Pub/Sub cocok dan kapan harus memakai Redis Streams, Kafka, RabbitMQ, WebSocket broker, atau database-backed outbox.
5. Menghindari kesalahan umum: menganggap Pub/Sub durable, replayable, observable seperti broker, atau cocok untuk audit trail.
6. Memahami perbedaan regular Pub/Sub, pattern subscription, keyspace notifications, dan sharded Pub/Sub di Redis Cluster.
7. Membuat failure model: subscriber disconnect, slow subscriber, reconnect gap, duplicate process, node failover, dan operational backpressure.

Bagian ini sengaja dibuat kritis. Banyak sistem memakai Redis Pub/Sub karena mudah, lalu diam-diam membangun dependency yang seharusnya membutuhkan durability, ordering, replay, dan monitoring. Redis Pub/Sub sangat berguna, tetapi hanya jika kontraknya benar.

---

## 1. Mental Model Utama

Redis Pub/Sub adalah mekanisme:

```text
Publisher ---> Redis channel ---> currently connected subscribers
```

Bukan ini:

```text
Producer ---> durable log/queue ---> consumers can replay later
```

Perbedaan paling penting:

| Aspek | Redis Pub/Sub |
|---|---|
| Persistence | Tidak ada |
| Replay | Tidak ada |
| Consumer offset | Tidak ada |
| Ack | Tidak ada |
| Delivery ke subscriber offline | Tidak ada |
| Backpressure semantic | Sangat terbatas, terutama lewat buffer/client behavior |
| Use case utama | Real-time notification ke subscriber yang sedang online |
| Salah kaprah umum | Dipakai sebagai queue/broker durable |

Kalimat yang harus tertanam:

> Redis Pub/Sub delivers to subscribers that are connected at the time of publication. Kalau subscriber tidak sedang subscribe, message hilang dari perspektif subscriber itu.

Ini bukan bug. Ini kontrak.

---

## 2. Kenapa Pub/Sub Ada di Redis?

Redis adalah in-memory data structure server. Pub/Sub memberi Redis kemampuan broadcast ringan untuk kasus seperti:

1. Memberi tahu instance aplikasi lain bahwa cache tertentu perlu di-invalidasi.
2. Mengirim signal ringan: configuration changed, tenant disabled, feature flag changed.
3. Fanout event ke WebSocket gateway yang sedang online.
4. Local coordination antar service instance dalam bounded context yang sama.
5. Trigger ephemeral: “ada perubahan, silakan refresh sendiri dari source of truth”.

Perhatikan pola terakhir: **message Pub/Sub sebaiknya berisi signal, bukan satu-satunya sumber kebenaran**.

Contoh payload yang baik:

```json
{
  "type": "CUSTOMER_CACHE_INVALIDATED",
  "customerId": "cust-1021",
  "version": 42,
  "occurredAt": "2026-06-20T10:15:00Z"
}
```

Subscriber menerima signal, lalu mengambil state terbaru dari database/cache/source of truth.

Payload yang berbahaya:

```json
{
  "type": "PAYMENT_SETTLED",
  "paymentId": "pay-9001",
  "amount": 1250000,
  "legalStatus": "SETTLED",
  "thisIsTheOnlyRecord": true
}
```

Kalau ini hilang, sistem kehilangan fakta bisnis. Itu berarti Pub/Sub dipakai di tempat yang salah.

---

## 3. Redis Pub/Sub vs Queue vs Stream

Karena kamu sudah punya seri Kafka/RabbitMQ, kita tidak akan mengulang teori broker. Kita hanya bedakan dari sisi Redis.

### 3.1 Pub/Sub

```text
PUBLISH channel message
```

Karakter:

- message dikirim ke subscriber yang saat itu aktif;
- tidak disimpan sebagai data structure Redis biasa;
- tidak ada consumer group;
- tidak ada ack;
- tidak ada retry;
- tidak ada pending list;
- tidak ada replay;
- cocok untuk event ephemeral.

### 3.2 List sebagai Queue

```text
LPUSH queue message
BRPOP queue
```

Karakter:

- message disimpan sebagai list item;
- consumer mengambil message dari list;
- bisa membangun queue sederhana;
- tetapi reliable processing harus didesain sendiri;
- tidak ada metadata consumer group seperti stream.

### 3.3 Stream

```text
XADD stream * field value
XREADGROUP GROUP group consumer STREAMS stream >
XACK stream group id
```

Karakter:

- append-only log-like data structure;
- message tersimpan sampai di-trim/dihapus;
- punya ID;
- bisa range query;
- consumer group;
- pending entries list;
- ack;
- recovery consumer mati;
- cocok untuk event processing Redis-native.

### 3.4 Decision Rule

Gunakan Pub/Sub jika:

```text
Message boleh hilang untuk subscriber yang offline,
dan subscriber bisa recover dengan membaca state terbaru dari tempat lain.
```

Gunakan Streams/Kafka/RabbitMQ jika:

```text
Message adalah fakta bisnis,
harus diproses setidaknya sekali,
harus bisa direplay,
atau harus punya audit/recovery trail.
```

---

## 4. Command Dasar

### 4.1 `PUBLISH`

```bash
PUBLISH app:cache:invalidate '{"entity":"customer","id":"cust-1021"}'
```

Return value adalah jumlah subscriber yang menerima message pada saat itu.

Maknanya sering disalahpahami.

Jika return value `0`, itu bukan berarti publish gagal secara teknis. Itu berarti tidak ada subscriber aktif yang matched channel tersebut saat command dijalankan.

### 4.2 `SUBSCRIBE`

```bash
SUBSCRIBE app:cache:invalidate
```

Setelah subscribe, connection masuk mode subscription. Pada RESP2 klasik, connection yang sudah subscribe hanya bisa menjalankan subset command tertentu yang berkaitan dengan Pub/Sub. Dalam aplikasi Java, praktik aman adalah memakai dedicated connection/container untuk subscription.

### 4.3 `UNSUBSCRIBE`

```bash
UNSUBSCRIBE app:cache:invalidate
```

Menghapus subscription channel tertentu.

### 4.4 `PSUBSCRIBE`

```bash
PSUBSCRIBE app:cache:*
```

Pattern subscription menerima message dari channel yang match pattern.

Contoh channel:

```text
app:cache:customer
app:cache:account
app:cache:case
```

Pattern:

```text
app:cache:*
```

Pattern subscription berguna, tetapi bisa membuat topology sulit diaudit. Pakai dengan disiplin.

---

## 5. Channel Naming

Channel adalah namespace broadcast. Channel bukan key, tetapi tetap perlu governance seperti key schema.

Format yang direkomendasikan:

```text
<env>:<bounded-context>:<domain>:<signal-type>[:<partition-or-tenant>]
```

Contoh:

```text
prod:case-management:case:cache-invalidated
prod:case-management:workflow:definition-changed
prod:identity:user:session-revoked
prod:tenant-ops:tenant:config-changed
```

Untuk dev/test:

```text
dev:case-management:case:cache-invalidated
```

### 5.1 Jangan Terlalu Global

Buruk:

```text
events
notifications
updates
pubsub
```

Masalah:

- ownership tidak jelas;
- subscriber tidak bisa dibatasi;
- payload berubah liar;
- mudah terjadi collision;
- sulit observability.

### 5.2 Jangan Terlalu Granular Tanpa Alasan

Buruk:

```text
prod:case-management:case:case-1001:field:status:updated:for-user:john
```

Masalah:

- channel explosion;
- sulit mengelola subscription;
- monitoring tidak berguna;
- pattern subscription menjadi mahal secara mental.

Biasanya channel cukup merepresentasikan **kelas event/signal**, bukan tiap entity instance.

---

## 6. Payload Design

Pub/Sub payload adalah bytes/string. Redis tidak peduli schema.

Untuk Java backend, gunakan JSON kecil dan eksplisit.

Contoh envelope:

```json
{
  "schemaVersion": 1,
  "messageId": "01JZ8A2C6N6G9V7Q0N8K5K3K7X",
  "type": "CASE_CACHE_INVALIDATED",
  "source": "case-service",
  "occurredAt": "2026-06-20T10:15:00Z",
  "correlationId": "corr-abc-123",
  "data": {
    "caseId": "case-1001",
    "reason": "status_changed",
    "newVersion": 87
  }
}
```

### 6.1 Field Penting

| Field | Fungsi |
|---|---|
| `schemaVersion` | Evolusi payload |
| `messageId` | Observability/dedup best-effort |
| `type` | Routing logis di handler |
| `source` | Debugging producer |
| `occurredAt` | Diagnosis delay/reordering |
| `correlationId` | Trace antar request/service |
| `data` | Payload domain minimal |

### 6.2 Payload Harus Kecil

Redis Pub/Sub bukan tempat mengirim object besar.

Buruk:

```json
{
  "entireCaseFile": { "...": "huge nested payload" }
}
```

Lebih baik:

```json
{
  "type": "CASE_CHANGED",
  "data": { "caseId": "case-1001", "newVersion": 87 }
}
```

Subscriber yang butuh detail mengambil state terbaru dari source of truth.

---

## 7. Delivery Semantics

Redis Pub/Sub biasanya bisa dianggap sebagai:

```text
best-effort real-time fanout to connected subscribers
```

Lebih rinci:

1. Kalau subscriber aktif dan sehat, message diterima.
2. Kalau subscriber belum subscribe, message tidak diterima.
3. Kalau subscriber disconnect saat publish, message tidak diterima.
4. Kalau subscriber lambat membaca, Redis menumpuk output buffer untuk client itu sampai limit tertentu.
5. Kalau buffer melebihi limit, Redis dapat memutus client lambat.
6. Tidak ada ack dari aplikasi.
7. Tidak ada replay dari Redis Pub/Sub.
8. Tidak ada consumer offset.

Ini membuat Pub/Sub cocok untuk signal yang bisa direkonstruksi dari state lain.

---

## 8. Failure Model

### 8.1 Subscriber Offline

Timeline:

```text
T1 subscriber A disconnect
T2 publisher sends CASE_CHANGED
T3 subscriber A reconnect
```

Subscriber A tidak menerima event T2.

Mitigasi:

- jangan pakai Pub/Sub untuk fakta penting;
- saat reconnect, lakukan reconciliation;
- simpan versi state di DB/Redis key;
- publish hanya sebagai wake-up signal.

Contoh reconciliation:

```text
onStartupOrReconnect:
  reload tenant config version
  reload local cache version
  compare local version with remote version
  invalidate local state if stale
```

### 8.2 Slow Subscriber

Subscriber menerima message lebih lambat daripada publisher mengirim.

Akibat:

- output buffer membesar;
- memory Redis naik;
- client bisa diputus;
- latency Redis bisa terdampak.

Mitigasi:

- handler harus cepat;
- jangan proses blocking langsung di listener thread;
- offload ke bounded executor;
- drop/coalesce signal jika aman;
- ukur queue internal aplikasi;
- gunakan Streams jika butuh backpressure nyata.

### 8.3 Handler Exception

Pub/Sub tidak punya retry semantic. Kalau handler Java throw exception setelah menerima message, Redis tidak tahu.

Mitigasi:

- catch exception di listener;
- log structured event;
- increment metric;
- untuk signal cache, mungkin cukup reload periodik;
- untuk event penting, jangan Pub/Sub.

### 8.4 Duplicate Application Instances

Jika 10 instance subscribe channel yang sama, semua menerima message.

Ini benar untuk broadcast.

Jika kamu ingin hanya satu worker memproses message, Pub/Sub bukan primitive yang tepat. Gunakan queue/stream/consumer group.

### 8.5 Publisher Melihat Subscriber Count 0

`PUBLISH` mengembalikan `0` kalau tidak ada subscriber aktif.

Jangan treat itu otomatis sebagai error. Tergantung kontrak.

Untuk cache invalidation signal, mungkin normal jika tidak ada subscriber.

Untuk command bisnis penting, justru itu bukti desain salah.

---

## 9. Use Case yang Cocok

### 9.1 Cache Invalidation Broadcast

Saat service A update database, semua instance perlu invalidate local cache.

```text
case-service instance 1 updates DB
case-service instance 1 publishes CASE_CACHE_INVALIDATED
case-service instance 2/3/4 invalidate local cache entry
```

Kalau instance 4 offline, saat hidup lagi ia harus bootstrap cache dari DB atau Redis, bukan mengandalkan event yang hilang.

### 9.2 Feature Flag / Config Refresh Signal

```text
admin updates feature flag
config-service persists new version
config-service publishes CONFIG_CHANGED
app instances reload config version
```

Signal hilang tidak fatal jika aplikasi juga punya polling/reload-on-access fallback.

### 9.3 WebSocket Fanout

```text
business service publishes USER_NOTIFICATION_CREATED
websocket gateway instances subscribed
connected user receives live notification
```

Tetapi jika user offline dan notification harus tetap ada, simpan notification di database/stream terlebih dahulu. Pub/Sub hanya live push.

### 9.4 Local Cluster Coordination

Contoh:

- refresh authorization policy cache;
- invalidate decision cache;
- reload workflow definition;
- clear tenant-level local memory;
- notify background scheduler to rescan.

### 9.5 Keyspace Notifications

Redis bisa mem-publish event ketika key tertentu berubah/expired, jika keyspace notification dikonfigurasi.

Use case:

- debugging;
- reactive local cache invalidation;
- lightweight expiry notification;
- operational signal.

Tetapi hati-hati: keyspace notification juga Pub/Sub, jadi tidak durable.

---

## 10. Use Case yang Tidak Cocok

### 10.1 Payment Processing

Buruk:

```text
payment-service PUBLISH payment.settled
ledger-service SUBSCRIBE payment.settled
```

Jika ledger-service offline, settlement hilang.

Gunakan durable log/queue/outbox.

### 10.2 Audit Trail

Buruk:

```text
PUBLISH audit.case.status.changed
```

Audit harus durable, queryable, tamper-aware, dan replayable. Pub/Sub tidak cocok.

### 10.3 Background Job Queue

Jika butuh retry, dead letter, visibility timeout, ack, scaling worker, Pub/Sub bukan jawabannya.

### 10.4 Distributed Workflow State Transition

Kalau workflow state berubah berdasarkan message Pub/Sub saja, sistem rawan kehilangan transition.

Workflow event harus disimpan di system of record atau event log. Pub/Sub bisa menjadi notification layer saja.

### 10.5 Regulatory Enforcement Event

Untuk sistem enforcement/regulatory, setiap tindakan material harus punya record authoritative. Pub/Sub boleh membantu propagasi cache, tetapi tidak boleh menjadi evidence trail.

---

## 11. Java Implementation dengan Spring Data Redis

### 11.1 Publisher

Contoh sederhana memakai `StringRedisTemplate`:

```java
package com.example.redis.pubsub;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Component
public class RedisSignalPublisher {

    private static final String CHANNEL = "prod:case-management:case:cache-invalidated";

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public RedisSignalPublisher(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    public long publishCaseCacheInvalidated(String caseId, long newVersion, String correlationId) {
        var envelope = Map.of(
            "schemaVersion", 1,
            "messageId", UUID.randomUUID().toString(),
            "type", "CASE_CACHE_INVALIDATED",
            "source", "case-service",
            "occurredAt", Instant.now().toString(),
            "correlationId", correlationId,
            "data", Map.of(
                "caseId", caseId,
                "newVersion", newVersion
            )
        );

        try {
            String json = objectMapper.writeValueAsString(envelope);
            Long subscribers = redisTemplate.convertAndSend(CHANNEL, json);
            return subscribers == null ? 0 : subscribers;
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize Redis Pub/Sub message", e);
        }
    }
}
```

Catatan:

- return count berguna untuk metric;
- jangan membuat business correctness tergantung count;
- payload kecil;
- include `messageId` dan `correlationId`.

### 11.2 Listener Container

```java
package com.example.redis.pubsub;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

@Configuration
public class RedisPubSubConfig {

    @Bean
    RedisMessageListenerContainer redisMessageListenerContainer(
            RedisConnectionFactory connectionFactory,
            CaseCacheInvalidationListener listener
    ) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);

        container.addMessageListener(
            listener,
            new ChannelTopic("prod:case-management:case:cache-invalidated")
        );

        container.setTaskExecutor(redisPubSubExecutor());
        return container;
    }

    @Bean
    Executor redisPubSubExecutor() {
        return Executors.newFixedThreadPool(4, runnable -> {
            Thread thread = new Thread(runnable);
            thread.setName("redis-pubsub-listener-" + thread.threadId());
            thread.setDaemon(true);
            return thread;
        });
    }
}
```

### 11.3 Listener Handler

```java
package com.example.redis.pubsub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
public class CaseCacheInvalidationListener implements MessageListener {

    private static final Logger log = LoggerFactory.getLogger(CaseCacheInvalidationListener.class);

    private final ObjectMapper objectMapper;
    private final LocalCaseCache localCaseCache;

    public CaseCacheInvalidationListener(ObjectMapper objectMapper, LocalCaseCache localCaseCache) {
        this.objectMapper = objectMapper;
        this.localCaseCache = localCaseCache;
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        String channel = new String(message.getChannel(), StandardCharsets.UTF_8);

        try {
            JsonNode root = objectMapper.readTree(body);

            String type = root.path("type").asText();
            String messageId = root.path("messageId").asText();
            String correlationId = root.path("correlationId").asText();

            if (!"CASE_CACHE_INVALIDATED".equals(type)) {
                log.warn("Ignoring unsupported Redis Pub/Sub message type. channel={}, type={}, messageId={}",
                    channel, type, messageId);
                return;
            }

            String caseId = root.path("data").path("caseId").asText();
            long newVersion = root.path("data").path("newVersion").asLong();

            localCaseCache.invalidateIfOlder(caseId, newVersion);

            log.debug("Processed Redis Pub/Sub signal. channel={}, messageId={}, correlationId={}, caseId={}, newVersion={}",
                channel, messageId, correlationId, caseId, newVersion);

        } catch (Exception ex) {
            log.error("Failed to process Redis Pub/Sub message. channel={}, body={}", channel, body, ex);
            // Do not rethrow blindly. Pub/Sub has no retry semantics.
            // Record metric and rely on reconciliation if needed.
        }
    }
}
```

### 11.4 Local Cache Example

```java
package com.example.redis.pubsub;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class LocalCaseCache {

    private final Map<String, CachedCase> cases = new ConcurrentHashMap<>();

    public void invalidateIfOlder(String caseId, long newVersion) {
        cases.computeIfPresent(caseId, (id, cached) -> {
            if (cached.version() < newVersion) {
                return null;
            }
            return cached;
        });
    }

    public record CachedCase(String caseId, long version, String status) {}
}
```

Perhatikan `newVersion`. Ini penting agar message lama tidak menghapus cache yang lebih baru.

---

## 12. Versioning dan Reordering

Pub/Sub tidak memberi jaminan yang cukup untuk menjadi state transition engine.

Misal:

```text
T1 CASE version 41 published
T2 CASE version 42 published
```

Dalam praktik network, failover, reconnect, atau handler scheduling bisa membuat subscriber memproses secara tidak ideal, terutama jika handler offload async.

Karena itu payload cache invalidation sebaiknya membawa version.

Pattern aman:

```text
if message.version > local.version:
    invalidate/reload
else:
    ignore
```

Jangan desain handler seperti:

```text
apply payload as final state blindly
```

Lebih aman:

```text
message says something changed;
subscriber validates latest state from authoritative store.
```

---

## 13. Pattern: Pub/Sub sebagai Wake-Up Signal

Ini pola paling sehat.

### 13.1 State Stored Separately

```text
Redis key / DB row:
  tenant-config:tenant-123 -> version 88

Pub/Sub message:
  CONFIG_CHANGED tenant-123 version 88
```

Jika message hilang, aplikasi masih bisa mengecek version saat:

- startup;
- reconnect;
- scheduled refresh;
- request path tertentu;
- admin-triggered refresh.

### 13.2 Handler

```text
on CONFIG_CHANGED(tenantId, version):
  if localVersion < version:
      reload config from source
```

Dengan begitu Pub/Sub mempercepat propagation, bukan satu-satunya jalan kebenaran.

---

## 14. Pattern: Cache Invalidation dengan Local Cache + Redis Cache

Arsitektur:

```text
Java instance local cache
        |
        v
Redis distributed cache
        |
        v
PostgreSQL / source of truth
```

Masalah:

- Redis cache bisa dihapus oleh writer;
- tetapi tiap Java instance mungkin punya local memory cache;
- Pub/Sub dipakai untuk broadcast invalidasi local cache.

Flow:

```text
1. command updates DB
2. writer deletes Redis cache key
3. writer publishes local-cache invalidation signal
4. all instances invalidate local cache
5. next read reloads through Redis/DB
```

Failure-safe addition:

```text
- local cache TTL pendek
- version check
- startup reconciliation
- metrics for missed refresh suspected
```

---

## 15. Pattern: WebSocket Gateway Fanout

Misal banyak instance WebSocket gateway, user bisa connect ke instance mana saja.

```text
notification-service -> Redis Pub/Sub -> all websocket-gateway instances
```

Setiap gateway mengecek apakah user target connect di instance tersebut.

```java
public void onNotification(UserNotificationSignal signal) {
    if (sessionRegistry.isConnectedLocally(signal.userId())) {
        websocketSender.send(signal.userId(), signal.payload());
    }
}
```

Tetapi notification durable tetap harus disimpan:

```text
notification-service stores notification in DB
notification-service publishes live-push signal
```

Jika user offline:

```text
no websocket delivery,
but notification still visible when user opens inbox.
```

---

## 16. Keyspace Notifications

Redis keyspace notifications memungkinkan Redis mengirim event Pub/Sub ketika key berubah, expired, evicted, dan sebagainya, tergantung konfigurasi.

Contoh use case:

```text
subscribe to expired keys for debugging token/session expiry
```

Namun ada batas besar:

1. Tidak aktif default di banyak deployment karena ada overhead.
2. Tidak durable.
3. Subscriber offline kehilangan notification.
4. Tidak boleh menjadi satu-satunya business trigger penting.

Buruk:

```text
When payment lock key expires, process settlement.
```

Lebih baik:

```text
Use scheduler/stream/database state machine to detect due work.
Expiry notification may only accelerate detection.
```

---

## 17. Redis Cluster dan Sharded Pub/Sub

Pada Redis Cluster, regular Pub/Sub punya implikasi cluster-wide fanout. Untuk scaling Pub/Sub di cluster, Redis menyediakan sharded Pub/Sub sejak Redis 7.

Command terkait:

```bash
SPUBLISH shard-channel message
SSUBSCRIBE shard-channel
SUNSUBSCRIBE shard-channel
```

Mental model:

- shard channel dipetakan ke hash slot;
- message dikirim pada shard yang memiliki slot tersebut;
- lebih scalable dibanding regular cluster-wide Pub/Sub untuk traffic besar;
- channel naming perlu memperhatikan distribusi hash slot.

Contoh channel:

```text
prod:notifications:{tenant-123}:user-live
prod:notifications:{tenant-456}:user-live
```

Hash tag `{tenant-123}` bisa membantu menempatkan channel terkait tenant tertentu ke slot deterministik.

Tetapi hati-hati: jika satu tenant sangat besar, hash tag justru bisa membuat hot shard.

---

## 18. Observability

Redis Pub/Sub sulit diobservasi dibanding broker durable karena tidak ada backlog dan offset.

Minimal metric di publisher:

```text
redis_pubsub_publish_total{channel,type}
redis_pubsub_publish_subscriber_count{channel}
redis_pubsub_publish_error_total{channel}
redis_pubsub_publish_latency_ms{channel}
```

Metric di subscriber:

```text
redis_pubsub_received_total{channel,type}
redis_pubsub_handler_success_total{channel,type}
redis_pubsub_handler_error_total{channel,type}
redis_pubsub_handler_latency_ms{channel,type}
redis_pubsub_message_age_ms{channel,type}
```

Metric aplikasi tambahan:

```text
local_cache_invalidation_total
local_cache_reconciliation_total
local_cache_version_mismatch_total
websocket_live_push_delivered_total
websocket_live_push_no_local_session_total
```

Redis-level commands yang relevan:

```bash
PUBSUB CHANNELS
PUBSUB NUMSUB channel1 channel2
PUBSUB NUMPAT
INFO clients
INFO stats
```

Di Redis 7+, `INFO` juga punya informasi terkait shard pub/sub channels.

### 18.1 Message Age

Karena payload punya `occurredAt`, subscriber bisa hitung:

```text
now - occurredAt
```

Ini membantu mendeteksi:

- handler lambat;
- executor backlog;
- GC pause;
- network stall;
- Redis overloaded.

---

## 19. Backpressure dan Slow Consumer

Pub/Sub tidak punya backpressure application-level seperti consumer lag/ack.

Jika subscriber tidak sanggup mengikuti traffic:

```text
Redis output buffer grows
client may be disconnected
messages may be lost to that client
```

Untuk handler Java:

1. Jangan melakukan query berat langsung di listener thread.
2. Gunakan bounded queue/executor.
3. Jika queue penuh, pilih strategi eksplisit:
   - drop signal jika aman;
   - coalesce by entity/tenant;
   - trigger full reconciliation;
   - fail fast dan expose alert.
4. Jangan memakai unbounded executor.

Contoh bounded offload:

```java
public final class BoundedSignalDispatcher {

    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(
        4,
        4,
        0L,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(10_000),
        new ThreadPoolExecutor.AbortPolicy()
    );

    public boolean dispatch(Runnable task) {
        try {
            executor.execute(task);
            return true;
        } catch (RejectedExecutionException ex) {
            return false;
        }
    }
}
```

Jika `dispatch` false untuk cache invalidation, kamu bisa set flag:

```text
localCache.markReconciliationRequired()
```

Lalu background job reload penuh.

---

## 20. Security dan Governance

Pub/Sub channel juga bagian dari interface antar service.

Risiko:

1. Service tidak berwenang publish signal tertentu.
2. Payload berisi PII/secret.
3. Channel terlalu global sehingga subscriber tidak sah dapat membaca message.
4. ACL Redis terlalu longgar.
5. Pattern subscribe membuka terlalu banyak visibility.

Prinsip:

- jangan masukkan secret ke Pub/Sub payload;
- gunakan ACL Redis untuk membatasi command/channel jika deployment mendukung;
- pisahkan Redis untuk bounded context sensitif;
- log payload secara hati-hati;
- dokumentasikan channel contract.

Contoh payload buruk:

```json
{
  "type": "USER_SESSION_REVOKED",
  "jwt": "actual-token-value",
  "passwordResetSecret": "..."
}
```

Lebih baik:

```json
{
  "type": "USER_SESSION_REVOKED",
  "data": {
    "userId": "user-123",
    "sessionVersion": 19
  }
}
```

---

## 21. Testing Strategy

### 21.1 Integration Test dengan Testcontainers

```java
@Testcontainers
class RedisPubSubIntegrationTest {

    @Container
    static GenericContainer<?> redis = new GenericContainer<>(DockerImageName.parse("redis:8"))
        .withExposedPorts(6379);

    @Test
    void shouldReceivePublishedSignalWhenSubscribed() {
        // arrange subscriber
        // publish message
        // await listener side effect
    }
}
```

Yang perlu dites:

1. Message valid diterima.
2. Unknown type diabaikan.
3. Malformed JSON tidak membunuh listener.
4. Duplicate/old version tidak merusak cache baru.
5. Listener exception tercatat sebagai metric.
6. Reconnect/restart melakukan reconciliation.

### 21.2 Test yang Sering Dilupakan

Test ini penting:

```text
publish while subscriber is offline
```

Expected behavior:

```text
subscriber does not receive missed message,
but catches up via reconciliation/startup reload/version check.
```

Kalau sistem gagal di test ini, berarti kamu diam-diam membutuhkan durable messaging.

---

## 22. Design Review Checklist

Sebelum memakai Redis Pub/Sub, jawab pertanyaan ini.

### 22.1 Correctness

1. Apa yang terjadi jika subscriber offline selama 5 menit?
2. Apakah message boleh hilang?
3. Apakah state bisa direkonstruksi dari source lain?
4. Apakah handler idempotent?
5. Apakah ada version/timestamp untuk menghindari stale processing?
6. Apakah message adalah signal atau fakta bisnis?

### 22.2 Operational

1. Berapa message per second per channel?
2. Berapa subscriber?
3. Apakah subscriber bisa lambat?
4. Apa metric untuk received/processed/error?
5. Apa alert jika message age naik?
6. Apa strategi reconnect?
7. Apa strategi saat executor penuh?

### 22.3 Security

1. Siapa boleh publish?
2. Siapa boleh subscribe?
3. Apakah payload mengandung PII/secret?
4. Apakah channel naming punya ownership jelas?
5. Apakah logs aman?

### 22.4 Alternatives

1. Apakah Redis Streams lebih tepat?
2. Apakah Kafka/RabbitMQ lebih tepat?
3. Apakah polling version lebih sederhana?
4. Apakah database trigger/outbox diperlukan?
5. Apakah local cache TTL sudah cukup?

---

## 23. Architecture Decision Matrix

| Requirement | Pub/Sub | Streams | Kafka/RabbitMQ | DB polling/version |
|---|---:|---:|---:|---:|
| Real-time best-effort signal | Sangat cocok | Bisa | Bisa | Kurang real-time |
| Durable event | Tidak | Bisa | Sangat cocok | Bisa |
| Replay | Tidak | Bisa | Sangat cocok | Terbatas |
| Consumer group | Tidak | Ya | Ya | Tidak native |
| Offline subscriber catch-up | Tidak | Ya | Ya | Ya lewat state |
| Very simple invalidation | Cocok | Overkill | Overkill | Bisa |
| Audit/regulatory trail | Tidak | Terbatas | Cocok jika diarsipkan | Cocok jika DB authoritative |
| Backpressure semantic | Lemah | Lebih baik | Baik | Natural via polling |
| Operational complexity | Rendah | Sedang | Lebih tinggi | Rendah-sedang |

---

## 24. Anti-Patterns

### 24.1 Pub/Sub sebagai Payment Event Bus

```text
PUBLISH payment.completed
```

Jika downstream offline, event hilang. Fatal.

### 24.2 Pub/Sub sebagai Job Queue

```text
workers subscribe jobs.email
publisher publishes job
```

Semua worker menerima job yang sama. Tidak ada ack/retry. Salah primitive.

### 24.3 Massive Payload Fanout

Mengirim object besar ke banyak subscriber meningkatkan memory/network pressure.

### 24.4 Handler Blocking

Listener melakukan:

```text
call external API
run heavy DB query
sleep/retry loop
```

Ini membuat subscriber lambat dan rawan disconnect.

### 24.5 No Reconciliation

Menganggap semua subscriber selalu online dan selalu menerima semua message.

Ini asumsi rapuh.

### 24.6 Channel Tanpa Ownership

```text
PUBLISH update "..."
```

Akhirnya banyak service publish/subscribe payload berbeda pada channel sama.

---

## 25. Practical Blueprint: Pub/Sub untuk Cache Invalidation Defensible

### 25.1 Contract

```text
Channel:
  prod:case-management:case:cache-invalidated

Semantics:
  Best-effort signal that a case changed.
  Subscriber must not rely on receiving every signal.
  Subscriber must reconcile on startup/reconnect/periodic interval.

Payload:
  schemaVersion
  messageId
  correlationId
  caseId
  newVersion
  occurredAt
```

### 25.2 Publisher Rule

```text
After DB commit succeeds:
  delete Redis distributed cache key
  publish local-cache invalidation signal
```

Jika publish gagal:

```text
- log error
- metric
- local cache TTL/reconciliation handles eventual correction
```

Untuk perubahan yang butuh strong propagation, jangan hanya Pub/Sub.

### 25.3 Subscriber Rule

```text
on message:
  parse envelope
  validate schemaVersion
  compare version
  invalidate local cache if older
  do not throw uncaught exception
```

### 25.4 Reconciliation Rule

```text
on startup:
  clear/reload local cache

on reconnect suspected:
  mark local cache dirty or reload affected domain

periodically:
  compare known domain version
```

---

## 26. Mini Lab

### 26.1 Jalankan Redis

```bash
docker run --rm -p 6379:6379 redis:8
```

### 26.2 Terminal Subscriber

```bash
redis-cli SUBSCRIBE dev:case-management:case:cache-invalidated
```

### 26.3 Terminal Publisher

```bash
redis-cli PUBLISH dev:case-management:case:cache-invalidated '{"schemaVersion":1,"type":"CASE_CACHE_INVALIDATED","data":{"caseId":"case-1","newVersion":2}}'
```

Subscriber melihat message.

### 26.4 Coba Offline Gap

1. Stop subscriber.
2. Publish message.
3. Start subscriber lagi.

Hasil: message yang dipublish saat offline tidak muncul.

Ini eksperimen paling penting.

### 26.5 Coba Subscriber Count

```bash
redis-cli PUBLISH dev:case-management:case:cache-invalidated '{}'
```

Jika tidak ada subscriber, output:

```text
(integer) 0
```

Jangan salah tafsir sebagai Redis error.

---

## 27. Hubungan dengan Bagian Sebelumnya dan Berikutnya

Dari bagian sebelumnya:

- Part 009 dan 010 membahas cache architecture dan invalidation.
- Part 011 membahas rate limiter, atomicity, dan Lua.
- Part 012 membahas idempotency.
- Part 013 dan 014 membahas lock dan Lua.
- Part 015 membahas Redis Functions.

Part ini menempatkan Pub/Sub sebagai signal layer.

Bagian berikutnya, Part 017, akan membahas Redis Streams. Streams harus dipahami sebagai jawaban ketika kamu mulai merasa Pub/Sub butuh:

- persistence;
- replay;
- consumer group;
- ack;
- pending message recovery;
- message history.

Dengan kata lain:

```text
Jika kamu ingin Pub/Sub punya durability, kamu sebenarnya sedang meminta Streams atau broker.
```

---

## 28. Ringkasan Mental Model

Redis Pub/Sub adalah primitive yang sangat berguna jika dipakai untuk hal yang benar:

```text
real-time best-effort fanout to currently connected subscribers
```

Gunakan untuk:

- cache invalidation signal;
- config refresh signal;
- live WebSocket push signal;
- local app instance coordination;
- ephemeral notification;
- keyspace notification yang tidak critical.

Jangan gunakan untuk:

- audit trail;
- payment/ledger event;
- durable job queue;
- reliable workflow transition;
- exactly-once processing;
- legal/regulatory evidence.

Checklist paling sederhana:

```text
If the subscriber misses this message, can the system still become correct by reading current state somewhere else?
```

Jika jawabannya **ya**, Pub/Sub mungkin tepat.

Jika jawabannya **tidak**, jangan pakai Redis Pub/Sub sebagai mekanisme utama.

---

## 29. Status Seri

```text
Part 016 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-017.md
```

Part berikutnya:

```text
Part 017 — Redis Streams: Consumer Groups, Pending Entries, dan Practical Event Processing
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Redis Functions dan Programmability Modern</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-017.md">Part 017 — Redis Streams: Consumer Groups, Pending Entries, dan Practical Event Processing ➡️</a>
</div>
