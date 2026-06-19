# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-30.md

# Part 30 — Migration, Refactoring, and Legacy RabbitMQ Systems

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Bagian: `30 / 34`  
> Fokus: memperbaiki sistem RabbitMQ yang sudah berjalan tanpa big-bang rewrite, tanpa kehilangan data, tanpa menghancurkan ordering, dan tanpa membuat insiden operasional baru.

---

## 1. Mengapa migration RabbitMQ sulit

Migrasi RabbitMQ jarang sulit karena syntax AMQP. Yang sulit adalah karena RabbitMQ biasanya berada di tengah banyak service.

Satu queue sering menjadi boundary antara:

- producer lama,
- consumer lama,
- service baru,
- retry mechanism,
- DLQ,
- monitoring,
- deployment pipeline,
- operational runbook,
- dan asumsi bisnis yang tidak pernah terdokumentasi.

Masalahnya: message broker adalah **shared mutable operational contract**.

Kalau kamu mengubah exchange, queue, binding, routing key, queue type, acknowledgement behavior, retry topology, atau message contract, kamu bukan sekadar mengubah infrastruktur. Kamu mengubah cara service-service melakukan koordinasi.

Legacy RabbitMQ system biasanya punya karakteristik seperti ini:

```text
Producer A ----> exchange lama ----> queue lama ----> Consumer B
                         |
                         +---------> queue tidak jelas ----> Consumer C
```

Di diagram tampak sederhana. Dalam realita, ada banyak hidden dependency:

```text
- producer tidak pakai publisher confirm
- consumer auto-ack
- retry pakai immediate requeue
- DLQ tidak dimonitor
- message contract berupa serialized Java class
- queue dibuat manual di UI
- routing key tidak punya taxonomy
- queue type masih classic/mirrored legacy
- tidak ada owner queue
- tidak ada runbook saat backlog
- tidak ada test untuk duplicate message
```

Migrasi yang matang dimulai dengan satu prinsip:

> Jangan mengganti primitive sebelum memahami invariant sistem lama.

---

## 2. Tujuan part ini

Setelah bagian ini, kamu harus bisa:

1. Menilai kondisi RabbitMQ legacy secara sistematis.
2. Membedakan masalah topology, reliability, operability, security, dan contract.
3. Membuat migration plan bertahap.
4. Memigrasikan classic/mirrored queue ke quorum queue atau stream dengan aman.
5. Menambahkan publisher confirms tanpa memecahkan producer.
6. Menambahkan DLQ/retry tanpa membuat retry storm.
7. Mengganti routing key/topology tanpa downtime.
8. Memecah queue besar tanpa kehilangan ordering penting.
9. Melakukan shadow consumer, dual publish, bridge, dan drain strategy.
10. Menulis runbook migrasi yang bisa dipakai saat produksi.

---

## 3. Mental model: migration bukan rewrite

Migration RabbitMQ yang sehat bukan ini:

```text
Matikan sistem lama -> deploy topology baru -> berharap semua aman
```

Migration sehat biasanya ini:

```text
Observe -> stabilize -> add safety -> introduce parallel path -> compare -> shift traffic -> drain -> remove old path
```

Atau lebih formal:

```text
1. Discover current topology
2. Classify risk
3. Freeze accidental behavior
4. Add observability
5. Add safety controls
6. Introduce new primitive/topology
7. Mirror or bridge traffic
8. Validate semantic equivalence
9. Move consumers/producers gradually
10. Drain old queues
11. Remove old topology
12. Update runbook and ownership
```

Kata kuncinya: **semantic equivalence**.

Dua topology bisa sama-sama “berhasil mengirim message”, tetapi berbeda secara semantics:

- ordering berbeda,
- retry berbeda,
- duplicate rate berbeda,
- redelivery berbeda,
- DLQ berbeda,
- durability berbeda,
- latency berbeda,
- failure behavior berbeda.

Migration yang bagus bukan hanya memastikan message sampai. Migration yang bagus memastikan **business effect tetap benar** dalam kondisi normal dan failure.

---

## 4. Legacy RabbitMQ smell catalog

Sebelum migrasi, cari smell berikut.

### 4.1 Producer smell

```text
- Producer tidak memakai publisher confirms
- Producer tidak menangani returned messages
- Producer publish ke exchange yang diasumsikan selalu ada
- Producer retry publish tanpa stable message id
- Producer tidak punya timeout policy
- Producer tidak punya outbox
- Producer publish message sebelum DB commit
- Producer publish JPA entity/internal object
- Producer tidak log message id/correlation id/routing key
```

### 4.2 Consumer smell

```text
- Consumer memakai auto-ack untuk workload penting
- Consumer ack sebelum DB commit
- Consumer tidak idempotent
- Consumer immediate requeue saat error
- Consumer tidak membedakan transient/permanent failure
- Consumer prefetch terlalu besar
- Consumer concurrency dinaikkan tanpa memikirkan ordering
- Consumer tidak log delivery tag, redelivered, message id
- Consumer tidak punya poison message policy
```

### 4.3 Queue/topology smell

```text
- Queue dibuat manual di Management UI
- Tidak ada definitions/topology as code
- Satu queue menampung banyak message type tidak terkait
- Queue tanpa owner
- Queue tanpa DLQ
- Queue tanpa max length/TTL/retention policy
- Queue lama masih classic mirrored
- Exchange terlalu generic seperti app.exchange
- Routing key tidak punya taxonomy
- Binding tidak terdokumentasi
- Queue per entity/user tanpa lifecycle policy
```

### 4.4 Operational smell

```text
- Tidak ada dashboard queue-level
- Alert hanya broker down, bukan backlog/age/redelivery/DLQ
- Tidak ada runbook replay DLQ
- Tidak ada rule aman untuk purge/requeue
- Tidak ada capacity estimate
- Tidak ada load test
- Tidak ada documented ownership
```

### 4.5 Security smell

```text
- Semua service pakai user admin
- Vhost dicampur untuk semua environment/domain
- Permission regex terlalu luas
- TLS tidak aktif
- Secret hardcoded
- DLQ berisi PII dan bisa dibaca banyak orang
```

---

## 5. Audit awal: topology discovery

Langkah pertama migration adalah membuat peta nyata, bukan peta yang diingat tim.

Yang perlu dikumpulkan:

```text
- vhost
- user dan permission
- exchange
- exchange type
- queue
- queue type
- bindings
- routing keys
- arguments
- policies
- consumers
- publish rate
- deliver rate
- ack rate
- redelivery rate
- ready messages
- unacked messages
- message age
- DLQ depth
- shovel/federation links
- plugins enabled
```

Contoh struktur inventory:

```markdown
## Queue Inventory

| Queue | Type | Owner | Producer | Consumer | DLQ | Criticality | Ordering Key | Peak Rate | Max Age SLA |
|---|---|---|---|---|---|---|---|---:|---:|
| case.review.requested.q | classic | case-platform | case-api | review-worker | yes | high | caseId | 120/s | 5m |
```

Untuk setiap queue, jawab:

1. Message apa yang masuk?
2. Siapa yang publish?
3. Siapa yang consume?
4. Apakah message boleh duplicate?
5. Apakah ordering penting?
6. Apakah message harus durable?
7. Apa yang terjadi kalau consumer mati 1 jam?
8. Apa yang terjadi kalau message gagal permanen?
9. Apakah queue bisa dipurge?
10. Siapa owner keputusan purge/replay?

Kalau jawaban tidak ada, jangan migrasi dulu. Tambahkan observability dan ownership dulu.

---

## 6. Freeze accidental behavior sebelum mengganti

Legacy system sering punya accidental behavior yang ternyata dipakai business process.

Contoh:

```text
Consumer hanya satu -> ordering per queue kebetulan terjaga
```

Lalu tim mengganti dengan 10 consumer untuk meningkatkan throughput. Akibatnya:

```text
CaseUpdated v2 diproses sebelum CaseCreated v1
```

Atau:

```text
Retry immediate requeue -> message cepat berhasil karena downstream biasanya pulih dalam 1 detik
```

Lalu diganti ke delayed retry 10 menit. Akibatnya:

```text
SLA workflow berubah tanpa disadari
```

Sebelum migrasi, dokumentasikan behavior lama:

```text
- ordering behavior
- duplicate behavior
- retry delay
- retry count
- poison handling
- failure visibility
- latency distribution
- backlog tolerance
- consumer concurrency
- persistence behavior
```

Bukan untuk mempertahankan semua behavior lama, tetapi untuk tahu mana yang harus dipertahankan dan mana yang memang ingin diubah.

---

## 7. Migration safety invariants

Setiap migration RabbitMQ harus punya invariant eksplisit.

Contoh invariant:

```text
No confirmed message may be lost.
```

```text
Every business command is processed at least once and guarded by idempotency.
```

```text
A case transition may only move forward according to the state machine.
```

```text
DLQ messages must remain inspectable for at least 14 days.
```

```text
New topology must not increase duplicate business side effects.
```

```text
Producer rollout must be reversible.
```

```text
Consumer rollout must be drainable.
```

Migration tanpa invariant biasanya berubah menjadi “deploy and pray”.

---

## 8. Migration pattern map

Ada beberapa pattern umum.

| Pattern | Cocok Untuk | Risiko Utama |
|---|---|---|
| In-place config change | argumen/policy minor | sulit rollback kalau semantics berubah |
| Blue-green queue | ganti queue/topology | duplicate/ordering split |
| Dual publish | ganti exchange/contract | duplicate publish dan divergence |
| Shadow consumer | validasi consumer baru | side effect tidak boleh aktif |
| Bridge queue | drain old ke new | duplicate dan ack boundary |
| Consumer cutover | pindah consumer ke queue baru | backlog lama tertinggal |
| Producer cutover | producer publish ke topology baru | consumer baru belum siap |
| Stream audit tap | tambah replay/history | fanout cost dan PII exposure |
| Outbox relay | reliability publisher | DB schema dan relay ops |
| Canary consumer | rollout handler baru | mixed side effects |

Tidak ada pattern universal. Pilih berdasarkan apa yang berubah:

```text
Apakah yang berubah producer?
Apakah yang berubah consumer?
Apakah yang berubah routing?
Apakah yang berubah queue type?
Apakah yang berubah contract?
Apakah yang berubah retry semantics?
Apakah message lama masih harus diproses?
```

---

## 9. Migrasi classic mirrored queue ke quorum queue

### 9.1 Kenapa perlu migrasi

Classic mirrored queue adalah pola lama high availability RabbitMQ. Di RabbitMQ modern, pendekatan yang direkomendasikan untuk replicated durable queue adalah quorum queue.

Tapi migration bukan sekadar mengganti argument:

```text
x-queue-type=classic -> x-queue-type=quorum
```

Queue type tidak bisa selalu diubah in-place setelah queue dibuat. Biasanya perlu membuat queue baru.

### 9.2 Perbedaan semantics yang perlu dipahami

Classic/mirrored lama dan quorum queue berbeda dalam:

```text
- replication mechanism
- leader behavior
- failover behavior
- throughput/latency profile
- poison message behavior
- delivery-limit support
- memory/disk behavior
- operational tuning
```

Quorum queue memberi safety lebih baik untuk durable replicated work queue, tetapi ada biaya replication dan disk I/O.

### 9.3 Migration strategy: blue-green queue

Misalnya legacy queue:

```text
case.review.requested.q
```

Queue baru:

```text
case.review.requested.v2.qq
```

Topology:

```text
case.commands.x
   routing key: case.review.requested
        -> old queue: case.review.requested.q
        -> new queue: case.review.requested.v2.qq
```

Ada beberapa opsi.

#### Opsi A — bind old dan new bersamaan, shadow consumer di new

```text
Producer -> exchange -> old queue -> old consumer -> side effect aktif
                  |
                  +-> new quorum queue -> new consumer shadow -> no side effect
```

Kelebihan:

- bisa validasi message masuk ke queue baru,
- bisa validasi consumer baru,
- tidak mengganggu old path.

Risiko:

- message diduplikasi ke dua queue,
- shadow consumer harus benar-benar tidak melakukan side effect,
- storage meningkat.

#### Opsi B — consumer cutover setelah drain

```text
1. Stop old producer or switch routing.
2. Drain old queue.
3. Start consuming new queue.
```

Kelebihan:

- lebih sederhana.

Risiko:

- butuh maintenance window atau controlled deployment,
- kalau producer masih publish ke old queue, backlog bercabang.

#### Opsi C — bridge old queue ke new queue

```text
old queue -> bridge consumer -> publish to new exchange/queue -> new consumer
```

Kelebihan:

- bisa drain message lama ke topology baru.

Risiko:

- bridge harus idempotent,
- ack old message hanya setelah publish ke new queue confirmed,
- duplicate masih mungkin kalau bridge crash setelah publish sebelum ack.

Safe bridge algorithm:

```text
consume from old queue
validate/transform message
publish to new exchange with stable message id
wait for publisher confirm
ack old delivery
```

Kalau crash setelah confirm sebelum ack, message lama akan redeliver dan publish ulang. Karena itu, stable message id dan idempotency tetap wajib.

---

## 10. Bridge consumer Java skeleton

```java
public final class QueueBridge {
    private final Channel sourceChannel;
    private final Channel targetChannel;
    private final String targetExchange;

    public void bridgeDelivery(
            String consumerTag,
            Envelope envelope,
            AMQP.BasicProperties properties,
            byte[] body
    ) throws IOException, InterruptedException {

        long deliveryTag = envelope.getDeliveryTag();

        AMQP.BasicProperties newProperties = properties.builder()
                .messageId(resolveStableMessageId(properties, body))
                .headers(mergeHeaders(properties.getHeaders(), Map.of(
                        "x-bridged-from", envelope.getExchange(),
                        "x-bridge-version", "2026-06"
                )))
                .deliveryMode(2)
                .build();

        try {
            targetChannel.basicPublish(
                    targetExchange,
                    envelope.getRoutingKey(),
                    true,
                    newProperties,
                    body
            );

            targetChannel.waitForConfirmsOrDie(5_000);
            sourceChannel.basicAck(deliveryTag, false);

        } catch (Exception e) {
            // Do not ack source message if target publish is not confirmed.
            // Redelivery is safer than silent loss.
            sourceChannel.basicNack(deliveryTag, false, true);
        }
    }

    private String resolveStableMessageId(AMQP.BasicProperties properties, byte[] body) {
        if (properties.getMessageId() != null && !properties.getMessageId().isBlank()) {
            return properties.getMessageId();
        }
        return sha256(body);
    }
}
```

Important constraints:

```text
- source ack must happen after target confirm
- target publish must use mandatory when route safety matters
- bridge must preserve correlation/causation metadata
- bridge must not silently transform semantics
- bridge must be observable
```

---

## 11. Menambahkan publisher confirms ke legacy producer

Legacy producer sering seperti ini:

```java
channel.basicPublish(exchange, routingKey, props, body);
return success;
```

Masalah:

```text
basicPublish success hanya berarti client menulis frame ke connection/channel,
bukan berarti broker durable menyimpan message.
```

Migration bertahap:

### Tahap 1 — observe-only wrapper

Tambahkan publisher abstraction tanpa mengubah behavior eksternal.

```java
public interface MessagePublisher {
    PublishResult publish(OutboundMessage message);
}
```

Awalnya wrapper tetap fire-and-forget, tapi log metadata:

```text
messageId
exchange
routingKey
mandatory
payloadSize
producer
correlationId
```

### Tahap 2 — enable confirms di non-critical path

```java
channel.confirmSelect();
channel.basicPublish(exchange, routingKey, true, props, body);
boolean confirmed = channel.waitForConfirms(5_000);
```

### Tahap 3 — handle returned messages

Tambahkan return listener untuk unroutable messages.

```java
channel.addReturnListener(returned -> {
    log.error("message_returned replyCode={} replyText={} exchange={} routingKey={} messageId={}",
            returned.getReplyCode(),
            returned.getReplyText(),
            returned.getExchange(),
            returned.getRoutingKey(),
            returned.getProperties().getMessageId());
});
```

### Tahap 4 — bounded async confirms

Untuk high throughput, jangan tunggu confirm per message. Gunakan async confirms dengan bounded in-flight.

Migration invariant:

```text
No API response may claim business success if the required message publish outcome is unknown, unless the event is persisted in an outbox.
```

---

## 12. Menambahkan outbox ke sistem legacy

Jika producer publish setelah DB commit tanpa outbox:

```text
DB commit success -> app crash before publish -> event lost
```

Jika producer publish sebelum DB commit:

```text
publish success -> DB rollback -> false event published
```

Outbox memperbaiki boundary:

```text
same DB transaction:
  write business state
  write outbox row

relay:
  read outbox row
  publish message
  wait confirm
  mark published
```

### 12.1 Migration bertahap ke outbox

1. Tambah tabel outbox.
2. Tulis outbox row bersamaan dengan business transaction.
3. Tetap publish lama untuk sementara.
4. Jalankan relay dalam shadow mode yang publish ke test exchange atau log only.
5. Validasi jumlah event.
6. Aktifkan relay publish ke exchange baru.
7. Matikan direct publish lama.
8. Jadikan outbox sebagai satu-satunya path.

### 12.2 Tabel outbox contoh

```sql
CREATE TABLE message_outbox (
    id UUID PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    message_type VARCHAR(200) NOT NULL,
    routing_key VARCHAR(200) NOT NULL,
    exchange_name VARCHAR(200) NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL,
    status VARCHAR(30) NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP NOT NULL,
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

### 12.3 Outbox relay state machine

```text
PENDING -> PUBLISHING -> PUBLISHED
                  |
                  v
               RETRY_WAIT
                  |
                  v
                FAILED
```

Important invariant:

```text
Outbox relay may publish duplicate messages, but must not lose confirmed-intended messages.
```

Karena itu consumer harus idempotent.

---

## 13. Menambahkan DLQ ke queue legacy

Queue legacy sering tidak punya DLQ. Consumer error langsung requeue, atau message hilang karena auto-ack.

Menambahkan DLQ juga tidak boleh asal.

### 13.1 Problem: queue arguments immutable

Banyak queue arguments tidak bisa diganti begitu saja setelah queue dibuat. Kalau queue lama dibuat tanpa DLX argument, kamu mungkin perlu:

- memakai policy kalau memungkinkan,
- atau membuat queue baru,
- atau delete/redeclare dengan downtime,
- atau blue-green migration.

### 13.2 Policy-based DLX

Untuk menghindari hardcode di queue declaration, gunakan policy.

```bash
rabbitmqctl set_policy dlx-case-review '^case\.review\..*\.q$' \
  '{"dead-letter-exchange":"case.dlx"}' \
  --apply-to queues
```

Tetapi policy harus diuji karena bisa berdampak ke banyak queue.

### 13.3 DLQ migration plan

1. Buat DLX.
2. Buat DLQ.
3. Bind DLQ dengan routing key yang jelas.
4. Tambahkan policy/queue arg untuk dead lettering.
5. Ubah consumer agar permanent error `nack(requeue=false)`.
6. Tambahkan dashboard DLQ.
7. Tambahkan runbook inspect/replay.
8. Uji poison message.

### 13.4 Jangan langsung replay DLQ ke source queue

Replay buta seperti ini berbahaya:

```text
DLQ -> source queue
```

Jika penyebab belum diperbaiki, kamu membuat poison loop.

Replay aman:

```text
inspect -> classify -> fix data/code/config -> replay limited batch -> observe -> continue
```

---

## 14. Mengganti retry mechanism legacy

Legacy retry sering seperti ini:

```java
catch (Exception e) {
    channel.basicNack(tag, false, true); // immediate requeue
}
```

Akibatnya:

```text
- message yang sama diproses ribuan kali
- CPU habis
- logs meledak
- downstream makin ditekan
- queue tidak maju
```

Migration ke retry sehat:

```text
main queue -> consumer
   transient failure -> retry exchange/queue with delay
   permanent failure -> DLQ/parking lot
```

Pattern bertahap:

1. Tambahkan error classifier di consumer.
2. Untuk permanent error, langsung DLQ.
3. Untuk transient error, republish ke retry queue dengan increment attempt.
4. Ack original hanya setelah retry publish confirmed.
5. Setelah max attempt, parking lot.

State:

```text
MAIN_ATTEMPT_1
RETRY_WAIT_1
MAIN_ATTEMPT_2
RETRY_WAIT_2
MAIN_ATTEMPT_3
PARKED
```

Invariant:

```text
A message may be retried, but each retry transition must be observable and bounded.
```

---

## 15. Memecah one queue for everything

Legacy topology:

```text
app.events.x -> app.events.q -> mega-consumer
```

Masalah:

```text
- satu poison message mengganggu semua jenis event
- satu slow handler menahan semua workload
- scaling tidak bisa per workload
- ownership kabur
- DLQ tidak informatif
- observability buruk
```

Refactor target:

```text
case.events.x
  case.opened.v1        -> case-projection.q
  evidence.submitted.v1 -> evidence-indexer.q
  review.assigned.v1    -> notification.q
  # audit tap          -> case.audit.stream
```

Migration strategy:

### 15.1 Introduce new exchange/bindings parallel

```text
old producer -> old exchange -> old queue
             -> new exchange -> new queues  (dual publish or bridge)
```

### 15.2 Shadow consumers

Consumer baru membaca queue baru tetapi tidak melakukan side effect.

Mereka hanya:

```text
- validate schema
- compare derived output
- record metrics
- detect missing fields
```

### 15.3 Consumer capability split

Pecah mega-consumer berdasarkan capability:

```text
- projection consumer
- notification consumer
- audit consumer
- rule-evaluation consumer
- escalation consumer
```

### 15.4 Cutover one capability at a time

Jangan semua sekaligus.

```text
Week 1: notification moved
Week 2: projection moved
Week 3: audit tap moved
Week 4: old mega-consumer reduced
```

---

## 16. Routing key refactoring

Legacy routing key smell:

```text
event
update
case
case.123
prod.case.review.ap-southeast-1.urgent.v2
```

Routing key harus membantu routing, bukan menampung semua metadata.

Target taxonomy:

```text
<domain>.<entity>.<event>.<version>
```

Contoh:

```text
case.evidence.submitted.v1
case.review.assigned.v1
case.enforcement.action.proposed.v1
```

### 16.1 Migration dengan dual binding

Tambahkan binding lama dan baru:

```text
old.routing.key -> same queue
new.routing.key -> same queue
```

Lalu rollout producer ke routing key baru.

Setelah tidak ada traffic lama:

```text
remove old binding
```

### 16.2 Observability wajib

Selama migrasi, ukur:

```text
publish count by routing key
unroutable count
returned messages
queue ingress by binding group
```

Kalau tidak, kamu tidak tahu kapan aman menghapus binding lama.

---

## 17. Contract migration

Legacy contract sering berupa:

```java
public class CaseEvent implements Serializable {
    private CaseEntity caseEntity;
}
```

Target:

```json
{
  "messageId": "...",
  "messageType": "case.evidence.submitted",
  "schemaVersion": 2,
  "correlationId": "...",
  "causationId": "...",
  "occurredAt": "2026-06-20T10:15:30Z",
  "payload": {
    "caseId": "CASE-123",
    "evidenceId": "EV-456",
    "submittedBy": "officer-17"
  }
}
```

### 17.1 Compatibility-first migration

Langkah:

1. Consumer lama tetap menerima v1.
2. Consumer baru bisa menerima v1 dan v2.
3. Producer mulai dual-field atau publish v2.
4. Monitor consumer parsing errors.
5. Setelah semua consumer kompatibel, deprecate v1.
6. Hapus v1 setelah retention window.

### 17.2 Anti-pattern: breaking all consumers

Jangan ubah payload field langsung:

```json
{"caseId":"123"}
```

menjadi:

```json
{"regulatoryCaseId":"123"}
```

tanpa compatibility layer.

Gunakan additive change:

```json
{
  "caseId":"123",
  "regulatoryCaseId":"123"
}
```

sementara, lalu migrasi consumer.

---

## 18. Migrasi consumer tanpa downtime

Consumer migration biasanya lebih aman daripada producer migration karena consumer bisa di-shadow.

### 18.1 Strategy: shadow consumer

```text
queue -> old consumer -> side effect aktif
      -> not possible: RabbitMQ competing consumer means messages shared, not copied
```

Queue biasa tidak mengirim copy message ke dua consumer pada queue yang sama. Kalau ingin shadow, perlu queue terpisah lewat binding fanout/topic.

```text
exchange -> old queue -> old consumer active
         -> shadow queue -> new consumer no side effect
```

### 18.2 Strategy: canary consumer

Kalau queue yang sama punya competing consumers:

```text
queue -> old consumer x9
      -> new consumer x1
```

Ini bukan shadow. New consumer akan memproses sebagian message dengan side effect aktif.

Gunakan hanya kalau:

```text
- handler idempotent
- contract kompatibel
- rollback mudah
- metrics granular
- risk accepted
```

### 18.3 Strategy: drain and switch

```text
1. Stop producer or route producer to new queue.
2. Let old queue drain to zero.
3. Stop old consumer.
4. Start new consumer.
```

Cocok untuk workload rendah atau maintenance window.

---

## 19. Migrasi producer tanpa kehilangan message

Producer migration lebih berbahaya karena producer menentukan message masuk ke mana.

### 19.1 Dual publish

```text
producer -> old exchange
         -> new exchange
```

Kelebihan:

```text
- new path bisa divalidasi
- rollback mudah
```

Risiko:

```text
- duplicate side effect kalau kedua path aktif
- divergence kalau publish old success tapi new fail
- latency naik
```

Safe dual publish rules:

```text
- gunakan stable message id yang sama
- new consumers harus shadow/no side effect dulu
- publish result harus dicatat per target
- jangan klaim full migration sampai kedua path match
```

### 19.2 Feature flag routing

```text
if (flag.newRabbitTopologyEnabled()) {
    publishNew(message);
} else {
    publishOld(message);
}
```

Lebih mudah rollback, tetapi tidak memvalidasi new path dengan traffic real kecuali canary.

### 19.3 Outbox-targeted routing

Outbox row menyimpan target exchange/routing key.

```text
outbox row:
  exchange_name
  routing_key
  payload
  schema_version
```

Migrasi bisa dilakukan dengan mengubah relay strategy tanpa menyentuh business transaction.

---

## 20. Migrasi dari database polling ke RabbitMQ

Legacy pattern:

```text
worker scans table every 5s where status='PENDING'
```

Masalah:

```text
- DB load
- latency polling
- locking contention
- duplicate processing
- scaling sulit
```

Target:

```text
transaction writes work item + outbox event
outbox relay publishes command/event to RabbitMQ
consumer processes work item idempotently
```

Migration:

1. Tetap pertahankan polling worker.
2. Tambah outbox event saat work item dibuat.
3. Rabbit consumer berjalan shadow dan membandingkan work item visibility.
4. Aktifkan Rabbit consumer untuk subset work item.
5. Kurangi polling frequency.
6. Matikan polling setelah confidence cukup.

Jangan langsung menghapus polling sebelum Rabbit path terbukti.

---

## 21. Migrasi dari synchronous HTTP ke asynchronous command queue

Legacy:

```text
case-api -> HTTP -> rule-engine
```

Masalah:

```text
- user request menunggu rule engine
- timeout ambiguity
- retry di client
- cascading failure
```

Target:

```text
case-api -> DB transaction -> outbox -> RabbitMQ command queue -> rule-engine-worker
```

Response API berubah:

```text
200 OK with final decision
```

menjadi:

```text
202 Accepted with requestId/processId
```

Ini bukan hanya teknis. Ini contract API/business UX berubah.

Migration perlu:

```text
- status endpoint
- notification/event saat selesai
- idempotency key untuk command
- timeout/escalation policy
- workflow state
```

---

## 22. Migrasi dari RabbitMQ queue ke RabbitMQ Stream

Queue cocok untuk work distribution. Stream cocok untuk history/replay.

Legacy:

```text
case.events.x -> consumer queues
```

Target hybrid:

```text
case.events.x -> consumer queues
              -> case.audit.stream
```

Jangan mengganti semua queue menjadi stream hanya karena ingin replay.

Migration safe:

1. Tambahkan stream sebagai audit tap.
2. Preserve same message id/correlation id.
3. Consumer utama tetap dari queue.
4. Validasi stream retention dan replay.
5. Buat replay consumer terpisah.
6. Gunakan stream untuk projection rebuild/audit, bukan menggantikan command queue tanpa alasan.

---

## 23. Migrasi dari RabbitMQ ke Kafka atau sebaliknya

Karena kamu sudah punya Kafka series, bagian ini hanya boundary ringkas.

RabbitMQ -> Kafka cocok jika:

```text
- replay panjang jadi kebutuhan utama
- throughput event streaming sangat tinggi
- banyak consumer group independen
- log retention adalah source of truth
- partitioned event log lebih natural
```

Kafka -> RabbitMQ cocok jika:

```text
- butuh broker-side routing fleksibel
- butuh work queue dengan ack/redelivery natural
- butuh per-consumer queue topology
- butuh low-latency command dispatch
- event retention panjang bukan pusat kebutuhan
```

Bridge pattern:

```text
RabbitMQ queue/stream -> relay -> Kafka topic
Kafka topic -> relay -> RabbitMQ exchange/queue
```

Invariant tetap sama:

```text
bridge publish target confirmed before committing source progress
```

---

## 24. Zero-downtime topology migration playbook

Contoh target: ubah topology lama:

```text
legacy.x -> legacy.q -> legacy-consumer
```

menjadi:

```text
case.commands.x -> case.review.requested.qq -> review-worker
```

### Phase 0 — discovery

```text
- export definitions
- identify producer/consumer
- measure traffic
- identify peak/off-peak
- inspect old messages
- identify message contract versions
```

### Phase 1 — add observability

```text
- dashboard old queue
- publisher return count
- confirm latency if available
- consumer ack/redelivery rate
- DLQ visibility if exists
- application logs with message id
```

### Phase 2 — create new topology

```text
- new exchange
- new quorum queue
- new DLQ
- retry queue
- bindings
- permissions
- dashboards
```

### Phase 3 — shadow path

```text
- bind shadow queue or dual publish
- run new consumer in no-side-effect mode
- compare parsing/validation results
```

### Phase 4 — canary

```text
- enable side effect for small segment
- route selected tenant/entity/key
- compare business outcomes
- monitor DLQ/redelivery/latency
```

### Phase 5 — gradual traffic shift

```text
10% -> 25% -> 50% -> 100%
```

For each stage:

```text
- queue depth stable?
- oldest message age stable?
- DLQ acceptable?
- duplicate side effects controlled?
- confirm latency acceptable?
- consumer error rate acceptable?
```

### Phase 6 — drain old path

```text
- stop new publish to old path
- keep old consumer until old queue empty
- archive old DLQ
- retain old topology for rollback window
```

### Phase 7 — cleanup

```text
- remove old bindings
- remove old queues after retention window
- remove old permissions
- update documentation
- update runbooks
- close migration ADR
```

---

## 25. Drain strategy

Draining berarti membiarkan queue lama kosong dengan aman.

### 25.1 Safe drain checklist

```text
- producer lama sudah berhenti publish ke queue lama
- no hidden binding still routes to old queue
- old consumer masih berjalan
- DLQ lama dimonitor
- backlog turun monoton
- oldest message age turun
- no requeue loop
```

### 25.2 Jangan purge sebagai drain

Purge berarti buang message.

Gunakan purge hanya kalau:

```text
- message memang disposable
- owner bisnis menyetujui
- snapshot/backup/audit dilakukan bila perlu
- keputusan dicatat
```

Untuk critical command queue, purge biasanya bukan drain.

---

## 26. Rollback strategy

Migration tanpa rollback strategy bukan migration plan.

Rollback harus menjawab:

```text
- Bagaimana menghentikan producer baru?
- Bagaimana routing dikembalikan?
- Apakah message yang sudah masuk new queue harus diproses/dibridge balik?
- Apakah consumer lama masih kompatibel dengan message baru?
- Apakah side effect sudah terjadi di new path?
- Bagaimana menghindari duplicate side effect saat rollback?
```

Rollback paling mudah jika:

```text
- producer switch via feature flag
- old topology masih ada
- consumer idempotent
- message contract backward compatible
- new path belum melakukan irreversible side effect tanpa audit
```

---

## 27. Versioning topology

Queue/exchange naming sebaiknya tidak terlalu sering diberi versi. Tapi saat breaking change, versi eksplisit membantu.

Contoh:

```text
case.review.requested.q          # stable logical queue
case.review.requested.v2.q       # breaking semantics migration
case.review.requested.qq         # queue type indicated if useful
```

Untuk exchange:

```text
case.events.x
case.events.v2.x
```

Gunakan versi jika berubah:

```text
- message contract incompatible
- routing semantics incompatible
- queue type/ordering semantics berubah signifikan
- consumer ownership berubah
```

Jangan versi untuk perubahan kecil additive.

---

## 28. Migration observability dashboard

Selama migration, buat dashboard khusus.

### 28.1 Old vs new path

```text
old publish rate
new publish rate
old queue ingress
new queue ingress
old consumer ack rate
new consumer ack rate
old DLQ rate
new DLQ rate
old redelivery rate
new redelivery rate
old oldest age
new oldest age
```

### 28.2 Semantic comparison metrics

```text
messages parsed successfully
messages rejected by schema
messages with missing idempotency key
business transition accepted
business transition rejected as duplicate
business transition rejected as invalid state
side effect success/failure
```

### 28.3 Migration decision gates

```text
Gate A: New topology receives expected traffic.
Gate B: Shadow consumer validates >= 99.99% messages.
Gate C: Canary has no critical semantic mismatch.
Gate D: New DLQ cause distribution understood.
Gate E: Rollback tested.
```

---

## 29. Legacy RabbitMQ on Kubernetes migration notes

Common legacy K8s problems:

```text
- RabbitMQ deployed as Deployment, not StatefulSet
- no persistent volume
- no anti-affinity
- probes too aggressive
- memory limit lower than RabbitMQ expectation
- abrupt pod termination
- clients not configured for failover
```

Migration approach:

```text
1. Stabilize broker deployment first.
2. Ensure persistent storage.
3. Add graceful shutdown.
4. Use readiness probes carefully.
5. Validate cluster formation.
6. Validate client recovery.
7. Only then migrate queues/topology.
```

Do not combine platform migration and application semantics migration unless unavoidable.

Bad combined migration:

```text
move RabbitMQ to K8s + change queue type + change retry + deploy new consumers
```

This creates too many variables.

---

## 30. Regulatory case-management migration example

### 30.1 Legacy state

```text
case.exchange
  -> case.events.q
       -> case-worker
       -> notification-worker competing on same queue accidentally
```

Problems:

```text
- one queue used by unrelated consumers
- consumers compete, so each event only handled by one of them
- notification sometimes misses event
- no DLQ
- auto ack
- event payload contains full CaseEntity
- no audit stream
```

### 30.2 Target state

```text
case.events.x(topic)
  case.opened.v1                    -> case-projection.q
  case.evidence.submitted.v1         -> evidence-indexer.q
  case.review.assigned.v1            -> notification.q
  case.#                             -> case-audit.stream

case.commands.x(direct)
  case.review.requested              -> review-requested.qq
  case.escalation.evaluate           -> escalation-evaluate.qq

case.dlx
  *.dead                             -> case.dlq
```

### 30.3 Migration plan

1. Export legacy definitions.
2. Add logs for message id/correlation id.
3. Create new topic exchange and queues.
4. Add bridge from old queue to new exchange in shadow mode.
5. Build new consumers no-side-effect mode.
6. Introduce envelope v1 while preserving legacy payload field.
7. Enable notification consumer first.
8. Enable projection consumer second.
9. Add audit stream tap.
10. Move producers to new exchange.
11. Drain old queue.
12. Remove legacy exchange/queue after retention.

### 30.4 Critical invariant

```text
Every case event must be available for audit reconstruction,
and every command side effect must be idempotent by case transition id.
```

---

## 31. Migration ADR template

```markdown
# ADR: RabbitMQ Migration for <Capability>

## Status
Proposed / Accepted / In Progress / Completed / Rolled Back

## Context
What topology exists today?
What incidents/smells motivate migration?
What services are affected?

## Current Topology
- Exchanges:
- Queues:
- Bindings:
- Producers:
- Consumers:
- Retry/DLQ:

## Target Topology
- Exchanges:
- Queues:
- Queue types:
- Bindings:
- Retry/DLQ:
- Streams:

## Invariants
- No confirmed message loss
- Idempotent processing by <key>
- Rollback possible within <window>

## Migration Strategy
- Shadow / dual publish / bridge / drain / canary

## Rollout Plan
1.
2.
3.

## Rollback Plan
1.
2.
3.

## Observability
Metrics, dashboards, logs, alerts.

## Risks
Duplicate, ordering, backlog, DLQ spike, contract incompatibility.

## Decision Gates
Gate A:
Gate B:
Gate C:

## Cleanup Plan
Remove old queues/bindings/permissions after <date/window>.
```

---

## 32. Production migration checklist

### Before migration

```text
[ ] Definitions exported
[ ] Queue owners identified
[ ] Producers identified
[ ] Consumers identified
[ ] Traffic baseline captured
[ ] Oldest message age baseline captured
[ ] DLQ baseline captured
[ ] Redelivery baseline captured
[ ] Contract versions known
[ ] Rollback plan written
[ ] Runbook written
[ ] Stakeholders notified
```

### During migration

```text
[ ] New topology created
[ ] Permissions verified
[ ] Shadow/canary active
[ ] Publisher confirms monitored
[ ] Returned messages monitored
[ ] Queue depth monitored
[ ] DLQ monitored
[ ] Consumer error monitored
[ ] Business state mismatch monitored
[ ] Rollback switch available
```

### After migration

```text
[ ] Old queue drained
[ ] Old bindings removed
[ ] Old permissions removed
[ ] Old dashboards archived or updated
[ ] Runbook updated
[ ] ADR closed
[ ] Incident review if issues occurred
[ ] Lessons added to platform guidelines
```

---

## 33. Common migration mistakes

### Mistake 1 — Changing queue type and consumer behavior together

Bad:

```text
classic queue -> quorum queue
manual ack -> auto ack
prefetch 10 -> prefetch 500
new consumer code
```

Too many variables.

Better:

```text
change one dimension at a time
```

### Mistake 2 — Treating shadow consumer as competing consumer

Shadow needs separate queue. Competing consumer consumes real share of messages.

### Mistake 3 — No stable message id

Without stable message id, duplicate detection becomes guesswork.

### Mistake 4 — Replay without fixing cause

DLQ replay before fix causes repeated failure.

### Mistake 5 — Removing old binding too early

Wait until traffic by old routing key is truly zero across full deployment window.

### Mistake 6 — Assuming no downtime means no risk

Zero downtime can still mean duplicate side effects, silent loss, or corrupted workflow state.

---

## 34. Mini labs

### Lab 1 — Blue-green queue migration

1. Create old classic queue.
2. Create new quorum queue.
3. Bind both to same exchange/routing key.
4. Run old active consumer.
5. Run new shadow consumer.
6. Compare message counts.
7. Cut over consumer.
8. Drain old queue.

### Lab 2 — Add DLQ via policy

1. Create queue without DLQ.
2. Add DLX/DLQ.
3. Apply policy.
4. Publish poison message.
5. Consumer rejects with requeue=false.
6. Confirm message appears in DLQ.

### Lab 3 — Bridge old queue to new queue

1. Publish 100 messages to old queue.
2. Run bridge consumer.
3. Confirm target publish before ack source.
4. Crash bridge mid-run.
5. Restart bridge.
6. Observe duplicates.
7. Add idempotency.

### Lab 4 — Contract migration

1. Publish v1 messages.
2. Deploy consumer accepting v1 and v2.
3. Publish v2 additive messages.
4. Confirm both parse.
5. Remove v1 after simulated retention window.

---

## 35. Review questions

1. Why is queue migration more than changing queue arguments?
2. What is semantic equivalence in RabbitMQ migration?
3. Why should source ack in a bridge happen after target publish confirm?
4. Why is dual publish risky?
5. Why is shadow consumer impossible on the same queue with normal competing consumers?
6. What should be measured before deleting old bindings?
7. Why does outbox migration usually require idempotent consumers?
8. Why is replay from DLQ dangerous without classification?
9. What makes quorum queue migration different from classic queue migration?
10. What rollback questions must be answered before producer cutover?

---

## 36. Key takeaways

1. RabbitMQ migration is a semantics migration, not just infrastructure migration.
2. Inventory and observability come before topology change.
3. Never migrate without explicit invariants.
4. Queue type changes usually need blue-green/bridge/drain strategy.
5. Publisher confirms can reveal hidden failure windows in legacy producers.
6. Outbox fixes DB/message atomicity but shifts duplicate handling to consumers.
7. DLQ/retry migration must be bounded and observable.
8. Shadow consumer requires a separate queue, not another competing consumer on the same queue.
9. Contract migration must be compatibility-first.
10. Cleanup is part of migration, not optional housekeeping.

---

## 37. Where this fits in the series

Sampai part ini, kamu sudah mempelajari primitive, reliability, stream, quorum, topology, anti-patterns, testing, dan sekarang migration.

Part berikutnya akan membahas **Architecture Decision Framework: RabbitMQ vs Kafka vs Database vs HTTP**.

Tujuannya bukan membuat RabbitMQ selalu menang, tetapi membuat kamu bisa memilih primitive yang benar untuk requirement yang benar.

---

# Status seri

- Part ini: `part-30` selesai.
- Seri belum selesai.
- Berikutnya: `part-31 — Architecture Decision Framework: RabbitMQ vs Kafka vs Database vs HTTP`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-29.md">⬅️ Part 29 — Testing Strategy for RabbitMQ-Based Java Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-31.md">Part 31 — Architecture Decision Framework: RabbitMQ vs Kafka vs Database vs HTTP ➡️</a>
</div>
