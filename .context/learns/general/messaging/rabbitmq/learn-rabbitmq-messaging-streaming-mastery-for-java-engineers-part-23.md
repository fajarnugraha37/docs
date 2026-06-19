# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-23.md

# Part 23 — Federation, Shovel, Multi-Region, and Edge Messaging

> Seri: RabbitMQ, RabbitMQ Streams, dan Messaging Mastery untuk Java Engineers  
> Bagian: 23 dari 34  
> Fokus: menghubungkan broker RabbitMQ lintas cluster, region, network boundary, dan edge environment tanpa menganggap WAN sebagai LAN.

---

## 0. Tujuan Bagian Ini

Di part sebelumnya kita membahas clustering, high availability, dan network partition. Bagian ini melangkah ke pertanyaan yang sering muncul begitu sistem mulai tersebar:

> “Bagaimana kalau saya punya RabbitMQ di beberapa data center, cloud region, tenant, edge site, atau network zone?”

Jawaban yang salah biasanya:

> “Cluster RabbitMQ-nya saja across region.”

Jawaban yang lebih matang:

> “Jangan perlakukan WAN seperti LAN. Tentukan dulu message movement semantics yang dibutuhkan: push, pull, selective replication, migration, DR, audit forwarding, edge buffering, atau workload sharing. Baru pilih Shovel, Federation, application relay, stream replication pattern, atau sistem lain.”

RabbitMQ menyediakan beberapa mekanisme distribusi broker:

1. **Clustering** — beberapa node menjadi satu logical broker/cluster.
2. **Federation** — broker downstream menarik pesan dari upstream exchange/queue.
3. **Shovel** — proses/plugin yang consume dari source dan publish ke destination.
4. **Application-level relay** — service buatan kita yang consume, transform, validate, dan publish ulang.
5. **Hybrid pattern** — kombinasi queue, exchange, stream, outbox, dan relay.

Dokumentasi RabbitMQ menegaskan bahwa clustering dimaksudkan untuk LAN; untuk WAN, Shovel atau Federation lebih cocok, tetapi keduanya bukan clustering dan tidak memberikan semantics yang sama seperti satu broker tunggal.

---

## 1. Mental Model Utama: Distribusi Broker Bukan Replikasi Magic

Saat ada dua region:

```text
Region A                         Region B
+-------------+                   +-------------+
| RabbitMQ A  |   WAN / Internet  | RabbitMQ B  |
+-------------+                   +-------------+
```

Pertanyaan yang benar bukan hanya:

> “Bagaimana pesan dari A sampai ke B?”

Pertanyaan yang lebih lengkap:

1. Siapa yang memutuskan message mana yang boleh bergerak?
2. Apakah message bergerak sekali, berkali-kali, atau bisa duplicate?
3. Apakah destination harus mempertahankan ordering?
4. Apa yang terjadi kalau WAN putus?
5. Apakah source boleh menghapus message sebelum destination confirm?
6. Apakah message perlu transformasi?
7. Apakah message membawa data sensitif lintas boundary?
8. Apakah downstream boleh backpressure upstream?
9. Apakah destination broker dianggap authoritative atau hanya replica/feed?
10. Bagaimana reconciliation dilakukan setelah outage?

Distribusi messaging selalu punya **semantics of movement**.

Tanpa semantics eksplisit, sistem mudah jatuh ke ilusi:

- “multi-region active-active” padahal sebenarnya duplicate-prone;
- “DR” padahal tidak ada replay plan;
- “global queue” padahal ordering dan locking tidak realistis;
- “audit replicated” padahal ada loss window;
- “federation” padahal butuh transformasi dan policy enforcement.

---

## 2. Clustering vs Federation vs Shovel

### 2.1 Clustering

RabbitMQ clustering membuat beberapa node menjadi satu logical cluster.

Cocok untuk:

- high availability dalam satu region / LAN;
- quorum queue replication;
- stream replication;
- shared metadata;
- operational cluster tunggal.

Tidak cocok untuk:

- WAN latency tinggi;
- unstable network;
- region yang sering partition;
- active-active geo queue illusion;
- data residency boundary yang ketat;
- site yang harus tetap independen saat koneksi antar-site putus.

Mental model:

```text
Cluster = satu broker logis dengan beberapa node.
```

Jika network antar node buruk, cluster metadata, leader election, queue leadership, dan client behavior ikut terdampak.

---

### 2.2 Federation

Federation menghubungkan broker atau cluster RabbitMQ secara lebih longgar. Sebuah downstream broker dapat menerima pesan dari upstream broker.

Ada dua bentuk utama:

1. **Federated Exchange**
2. **Federated Queue**

Mental model:

```text
Downstream RabbitMQ menarik pesan dari upstream RabbitMQ berdasarkan federation configuration.
```

Federation lebih “opinionated” dibanding Shovel. Ia memahami konsep exchange/queue federation dan biasanya dipakai untuk menghubungkan broker agar pesan tertentu bisa tersedia di broker lain.

---

### 2.3 Shovel

Shovel adalah mekanisme lebih rendah level:

```text
consume dari source queue/exchange -> publish ke destination exchange/queue
```

Mental model:

```text
Shovel = managed message mover.
```

Shovel cocok ketika kita butuh kontrol eksplisit atas movement:

- dari queue tertentu ke exchange tertentu;
- migrasi broker;
- bridge antar vhost;
- bridge antar cluster;
- DR feed;
- edge-to-core forwarding;
- selective transfer;
- operational simplicity.

---

### 2.4 Application Relay

Kadang Shovel/Federation tidak cukup.

Gunakan application relay jika perlu:

- transformasi payload;
- schema validation;
- PII redaction;
- enrichment;
- routing decision kompleks;
- idempotency repository khusus;
- exactly-once-effect ke sistem tujuan;
- domain policy enforcement;
- audit trail aplikasi;
- custom retry dan reconciliation.

Mental model:

```text
Broker movement primitive cukup untuk transport.
Application relay dibutuhkan untuk domain semantics.
```

---

## 3. Decision Matrix

| Kebutuhan | Clustering | Federation | Shovel | Application Relay |
|---|---:|---:|---:|---:|
| HA satu region/LAN | Sangat cocok | Tidak utama | Tidak utama | Tidak utama |
| WAN broker linking | Tidak disarankan | Cocok | Cocok | Cocok |
| Transfer queue ke broker lain | Tidak | Bisa, tergantung model | Sangat cocok | Cocok |
| Federated pub/sub exchange | Tidak | Sangat cocok | Bisa tapi lebih manual | Cocok |
| Migrasi broker | Tidak utama | Bisa | Sangat cocok | Cocok |
| Transform payload | Tidak | Tidak | Terbatas/tidak domain-aware | Sangat cocok |
| PII filtering | Tidak | Tidak cukup | Tidak cukup | Sangat cocok |
| Domain-level idempotency | Tidak | Tidak | Tidak | Sangat cocok |
| Multi-region active-active business semantics | Tidak cukup | Tidak cukup | Tidak cukup | Perlu desain domain |
| Edge buffering | Tidak | Bisa | Cocok | Cocok |
| Simple one-way bridge | Tidak | Bisa | Sangat cocok | Bisa, tapi lebih banyak kode |
| Topology-aware exchange distribution | Tidak | Sangat cocok | Manual | Bisa |

---

## 4. Federation Deep Dive

## 4.1 Federated Exchange

Federated exchange memungkinkan downstream exchange menerima pesan dari upstream exchange.

Simplified topology:

```text
Upstream Broker                         Downstream Broker
+------------------+                    +--------------------+
| exchange.events  | -- federation -->  | exchange.events    |
+------------------+                    +--------------------+
                                                |
                                                v
                                         local queues/consumers
```

Use case:

- region B ingin menerima event tertentu dari region A;
- central analytics ingin subscribe event dari site lokal;
- tenant-specific broker ingin forward subset public events ke shared broker;
- local application tetap publish ke local exchange, remote consumers receive melalui federated exchange.

Yang penting: downstream tetap punya topology lokal. Federation bukan berarti semua queue/source state menjadi satu.

---

## 4.2 Federated Queue

Federated queue memungkinkan queue downstream mengambil pesan dari upstream queues ketika ada demand.

Simplified topology:

```text
Upstream queue(s)  --->  downstream federated queue  ---> local consumers
```

Use case:

- workload sharing across brokers;
- local consumer dapat mengambil pekerjaan dari upstream jika diperlukan;
- balancing logical queue across clusters.

Namun federated queue harus dipakai hati-hati karena queue semantics, ordering, locality, dan consumer demand menjadi lebih kompleks.

Untuk Java engineer, federated queue sering lebih sulit dipahami daripada federated exchange karena ia menyentuh work distribution semantics, bukan hanya event propagation.

---

## 4.3 Federation Upstream dan Policy

Federation biasanya dikonfigurasi dengan:

1. upstream definition;
2. upstream set;
3. policy yang menerapkan federation ke exchange/queue tertentu.

Conceptual example:

```bash
rabbitmq-plugins enable rabbitmq_federation rabbitmq_federation_management

rabbitmqctl set_parameter federation-upstream upstream-region-a \
  '{"uri":"amqp://user:pass@rabbit-a:5672/%2f","expires":3600000}'

rabbitmqctl set_policy federate-events '^events\.' \
  '{"federation-upstream":"upstream-region-a"}' \
  --apply-to exchanges
```

Catatan:

- URI harus diamankan, idealnya via secret management.
- TLS harus dipakai untuk network tidak terpercaya.
- Permission upstream harus least privilege.
- Policy pattern jangan terlalu luas.
- Federation harus dimonitor seperti production integration, bukan “set and forget”.

---

## 4.4 Federation Semantics yang Harus Dipahami

Federation bukan synchronous replication.

Konsekuensi:

- ada delay;
- ada duplicate possibility;
- ada outage catch-up behavior;
- ordering global tidak dijamin seperti single queue;
- downstream local topology tetap menentukan routing akhir;
- backpressure dan link health harus dimonitor;
- security boundary harus eksplisit.

Jangan mendesain business invariant seperti:

> “Jika event ada di region A, pasti pada saat yang sama ada di region B.”

Yang lebih realistis:

> “Event yang memenuhi policy akan dipropagasi secara asynchronous; downstream harus idempotent dan mampu menghadapi delay, duplicate, serta gap sementara.”

---

## 5. Shovel Deep Dive

## 5.1 Shovel sebagai Managed Message Pump

Shovel melakukan hal yang secara aplikasi bisa kita tulis sendiri:

```text
consume -> maybe ack -> publish -> confirm -> repeat
```

Tetapi Shovel dikelola oleh RabbitMQ sebagai plugin.

Simplified topology:

```text
Source Broker                      Destination Broker
+---------------+                  +--------------------+
| source.queue  | -- Shovel ---->  | destination.exchange|
+---------------+                  +--------------------+
```

---

## 5.2 Dynamic vs Static Shovel

Ada dua gaya konfigurasi umum:

### Static Shovel

Didefinisikan di konfigurasi broker.

Cocok untuk:

- infrastructure-as-code;
- bootstrap konsisten;
- topology yang jarang berubah;
- environment production yang harus deterministic.

### Dynamic Shovel

Didefinisikan sebagai runtime parameter.

Cocok untuk:

- migrasi sementara;
- operational bridge;
- ad-hoc transfer;
- controlled DR drill;
- emergency forwarding.

Untuk production long-lived bridge, prefer IaC/static atau managed dynamic yang tersimpan dan diaudit.

---

## 5.3 Shovel Example

Contoh konseptual dynamic shovel:

```bash
rabbitmq-plugins enable rabbitmq_shovel rabbitmq_shovel_management

rabbitmqctl set_parameter shovel evidence-to-core '{
  "src-uri": "amqp://edge_user:secret@edge-rabbit:5672/edge_vhost",
  "src-queue": "edge.evidence.accepted.q",
  "dest-uri": "amqp://core_user:secret@core-rabbit:5672/core_vhost",
  "dest-exchange": "case.events.x",
  "dest-routing-key": "evidence.accepted",
  "ack-mode": "on-confirm",
  "reconnect-delay": 5
}'
```

Yang penting di sini adalah `ack-mode`.

Untuk reliable transfer, source message sebaiknya tidak di-ack sebelum destination publish aman.

---

## 5.4 Shovel Ack Mode Mental Model

Shovel harus memutuskan kapan meng-ack message di source.

Simplified options conceptually:

1. ack setelah consume;
2. ack setelah publish ke destination;
3. ack setelah destination confirm.

Untuk reliability, model yang paling aman biasanya:

```text
consume source
publish destination
wait destination confirm
ack source
```

Jika source di-ack sebelum destination confirm, crash di tengah bisa menyebabkan message loss.

Jika destination confirm sukses tapi source ack gagal, message bisa dikirim ulang dan duplicate di destination.

Jadi bahkan dengan mode aman:

```text
loss risk turun, duplicate risk tetap ada.
```

Maka destination consumer tetap harus idempotent.

---

## 6. Multi-Region Pattern Catalog

## 6.1 One-Way Event Propagation

Use case:

- region lokal memproses transaksi;
- central region menerima event untuk analytics, compliance, audit, notification, atau ML.

Topology:

```text
Region A
producer -> events.x -> local queues
              |
              | federation/shovel
              v
Central
central.events.x -> analytics.q / audit.q / reporting.q
```

Semantics:

- asynchronous;
- duplicate possible;
- central can lag;
- local processing independent;
- central consumers idempotent.

Cocok untuk:

- audit feed;
- reporting;
- cross-region notification;
- central projection.

Tidak cocok untuk:

- real-time invariant enforcement yang harus synchronous;
- global locking;
- exactly-once multi-region transaction.

---

## 6.2 Edge-to-Core Buffering

Use case:

- edge site punya koneksi tidak stabil;
- edge harus tetap menerima/menyimpan work/event lokal;
- ketika koneksi pulih, pesan dikirim ke core.

Topology:

```text
Edge Site
app -> local RabbitMQ -> edge.outbox.q -- Shovel --> core.exchange

Core
core.exchange -> validation.q -> canonical store
```

Design principle:

> Edge RabbitMQ bukan hanya transport; ia juga buffer operasional saat disconnected.

Kebutuhan tambahan:

- retention/TTL edge;
- disk capacity planning;
- duplicate handling di core;
- edge identity;
- message signing atau integrity field;
- delayed reconciliation;
- replay/resend runbook.

---

## 6.3 DR Feed

Use case:

- production region primary;
- secondary region menerima subset message untuk recovery;
- bukan active-active penuh.

Topology:

```text
Primary Region
critical.events.x -> dr.forward.q -- Shovel --> Secondary Region dr.events.x

Secondary Region
standby consumers disabled or read-only projections enabled
```

Important distinction:

- DR feed bukan guarantee bahwa secondary selalu identik.
- DR feed harus diuji dengan drill.
- Recovery point objective harus dihitung dari lag dan loss/duplicate semantics.

DR checklist:

- Apakah message movement confirmed?
- Apakah destination idempotent?
- Apakah cutover procedure ada?
- Apakah duplicate saat failback aman?
- Apakah offset/reconciliation tersedia?
- Apakah ada audit untuk pesan yang gagal dipindahkan?

---

## 6.4 Broker Migration

Use case:

- pindah dari RabbitMQ lama ke cluster baru;
- pindah cloud/provider;
- split vhost;
- upgrade major version dengan risiko minimal.

Pattern:

1. create new broker/cluster;
2. mirror topology definitions;
3. shovel selected queues;
4. dual-publish atau forward events;
5. migrate consumers;
6. drain old queues;
7. cut producers;
8. monitor duplicates/gaps;
9. decommission old broker.

Simplified migration flow:

```text
Old Broker queue -> Shovel -> New Broker exchange -> New queues
```

Pitfall:

- Jika old consumers dan shovel sama-sama consume dari queue yang sama, workload bisa terbagi tidak sengaja.
- Untuk migration, freeze/coordinate consumers atau buat dedicated forwarding queue.

---

## 6.5 Cross-Vhost Boundary

Kadang multi-region bukan masalahnya. Masalahnya adalah boundary internal:

```text
vhost team-a -> vhost integration -> vhost team-b
```

Shovel bisa memindahkan pesan antar vhost.

Use case:

- isolate permission;
- expose public events;
- prevent team B membaca internal exchange team A;
- create integration layer.

Namun untuk domain filtering, lebih baik application relay.

---

## 6.6 Selective Public Event Publication

Pattern:

```text
internal.events.x -> public-event-relay-service -> public.events.x
```

Mengapa bukan shovel langsung?

Karena public event boundary biasanya membutuhkan:

- schema stabilization;
- redaction;
- tenant filtering;
- policy enforcement;
- data classification;
- compatibility guarantees;
- audit of exposure.

Shovel/Federation cocok untuk message movement. Public event boundary sering butuh domain-aware relay.

---

## 7. Active-Active Multi-Region: Challenge the Premise

“Active-active” sering dipakai terlalu ringan.

Ada beberapa makna berbeda:

1. Kedua region menerima traffic read-only.
2. Kedua region menerima command untuk entity yang berbeda.
3. Kedua region menerima command untuk entity yang sama.
4. Kedua region saling replicate event.
5. Kedua region bisa failover satu sama lain.
6. Kedua region menjaga invariant global secara real-time.

RabbitMQ Federation/Shovel tidak menyelesaikan semua bentuk active-active.

### 7.1 Active-Active yang Masuk Akal

Contoh aman:

```text
Region A handles cases with jurisdiction A.
Region B handles cases with jurisdiction B.
Events are asynchronously exchanged for visibility.
```

Karena ownership jelas:

- case A authoritative di region A;
- case B authoritative di region B;
- cross-region feed hanya projection/notification.

### 7.2 Active-Active yang Berbahaya

Contoh berbahaya:

```text
Case C can be updated in Region A and Region B at the same time.
Both regions publish state-changing commands/events.
RabbitMQ bridges replicate both directions.
```

Masalah:

- conflict resolution;
- duplicate commands;
- out-of-order events;
- concurrent transitions;
- split-brain business state;
- compensating actions;
- audit ambiguity.

Solusi tidak ada di Shovel/Federation. Solusi ada pada domain model:

- single-writer per entity;
- ownership partitioning;
- command routing to owner region;
- conflict-free data types jika cocok;
- explicit merge/reconciliation process;
- globally consistent database/coordination jika memang wajib.

---

## 8. Bi-Directional Federation/Shovel

Bi-directional link terlihat menarik:

```text
Rabbit A <----> Rabbit B
```

Tapi sangat mudah membuat loop.

Contoh loop:

1. A publishes event X.
2. Shovel A->B forwards X.
3. B receives X and republishes to exchange.
4. Shovel B->A forwards X back.
5. A receives X again.
6. Repeat or duplicate storm.

Loop prevention strategies:

- origin region header;
- visited bridge header;
- separate inbound/outbound exchanges;
- no republish to outbound exchange for inbound messages;
- bridge-specific routing keys;
- application relay with loop detection;
- TTL/hop count;
- topology review.

Safer topology:

```text
Region A outbound.x --> bridge --> Region B inbound.x
Region B outbound.x --> bridge --> Region A inbound.x

Inbound processing does not automatically republish to outbound.x.
```

---

## 9. Ordering Across Regions

Do not assume global ordering.

Even one-way bridge can reorder depending on:

- multiple source queues;
- multiple shovels;
- reconnection;
- retry;
- destination routing;
- consumer concurrency;
- broker failure;
- duplicate handling.

Design rule:

> If ordering matters, define ordering scope explicitly.

Possible scopes:

| Scope | Feasible? | Strategy |
|---|---:|---|
| Global all messages | Usually no | Avoid; use stream partition if truly needed, with constraints |
| Per entity/case | Yes | entityId as partition/routing key, sequence/version check |
| Per tenant | Sometimes | tenant partitioning, beware hot tenants |
| Per source region | Yes | origin region + sequence |
| Per queue | Yes-ish | single queue, single consumer, low throughput |

For regulatory workflows, the most defensible model is usually:

```text
single writer per case + per-case version + idempotent transition guard
```

---

## 10. Duplicate Semantics

All cross-broker movement should be treated as at-least-once unless proven otherwise.

Duplicate sources:

- destination publish succeeded but source ack failed;
- shovel/federation reconnects;
- source broker redelivers;
- destination consumer retries;
- manual replay;
- migration dual-publish;
- bi-directional topology loop;
- operator requeues messages.

Required fields:

```json
{
  "messageId": "01HV...",
  "eventId": "evt_...",
  "correlationId": "corr_...",
  "causationId": "cmd_...",
  "originRegion": "ap-southeast-3",
  "schemaVersion": 3,
  "occurredAt": "2026-06-19T10:15:30Z"
}
```

Idempotency table example:

```sql
create table processed_integration_message (
    message_id varchar(128) primary key,
    origin_region varchar(64) not null,
    message_type varchar(128) not null,
    processed_at timestamp not null,
    outcome varchar(32) not null
);
```

For business event idempotency, `eventId` may be better than transport `messageId` if message is republished through bridges.

---

## 11. Failure Scenarios

## 11.1 WAN Down

Symptoms:

- shovel/federation link down;
- source queue depth grows;
- edge disk usage increases;
- central projection becomes stale;
- alert fires on link status or queue age.

Safe behavior:

- local processing continues if local broker available;
- source retains messages within capacity;
- destination catches up after reconnect;
- consumers tolerate delayed messages.

Bad behavior:

- producers block indefinitely;
- edge disk fills;
- messages expire unexpectedly;
- retry storm after reconnect;
- central system assumes no event means no activity.

Design response:

- capacity plan for offline window;
- oldest message age alert;
- dead-letter expired messages explicitly;
- communicate stale projection status;
- run catch-up throttled if necessary.

---

## 11.2 Destination Down

For Shovel:

```text
source queue accumulates messages
shovel reconnects later
```

If source capacity is finite, decide:

- block source producers?
- drop low-priority messages via TTL?
- route to local parking lot?
- degrade functionality?

For critical regulatory evidence, do not silently drop.

---

## 11.3 Source Down

Destination stops receiving new messages.

Important: destination must distinguish:

- no activity;
- link down;
- source down;
- policy misconfiguration;
- authentication failure;
- source queue empty.

Monitoring must not infer “no messages” as “healthy”.

---

## 11.4 Duplicate After Reconnect

Scenario:

1. Shovel publishes message to destination.
2. Destination confirms.
3. Network drops before source ack completes.
4. Source redelivers later.
5. Destination receives duplicate.

Correct handling:

- destination idempotency key detects duplicate;
- duplicate count metric increments;
- no business side-effect repeated.

---

## 11.5 Message Lost by Wrong Ack Mode

Scenario:

1. Shovel consumes source.
2. Source ack happens too early.
3. Destination publish fails.
4. Message gone from source and absent from destination.

Prevention:

- use confirm-aware movement where possible;
- test failure injection;
- monitor moved vs confirmed counts;
- keep source retention or audit stream if message critical.

---

## 12. Security and Data Residency

Cross-region message movement is not just transport.

It is data movement.

Security checklist:

- TLS for AMQP links;
- least privilege users;
- separate vhosts for integration;
- no broad configure/write/read permissions;
- secret rotation;
- certificate rotation;
- mTLS where appropriate;
- message-level encryption for sensitive payload;
- redact PII before public/cross-boundary publication;
- classify messages by sensitivity;
- audit who configured federation/shovel;
- monitor unexpected routing volume;
- separate inbound and outbound exchanges.

Data residency questions:

1. Is this message allowed to leave the jurisdiction?
2. Does the payload contain personal data?
3. Can metadata itself be sensitive?
4. Is the destination region compliant?
5. Is retention policy different in destination?
6. Can a downstream queue create unauthorized data persistence?
7. Is deletion/right-to-erasure feasible if message has been bridged?

For regulated systems, do not use raw internal events as public cross-region events.

Prefer:

```text
internal event -> policy relay -> sanitized integration event -> bridge
```

---

## 13. Observability for Federation/Shovel

Essential metrics:

- link status;
- reconnect count;
- messages moved rate;
- source queue depth;
- source oldest message age;
- destination publish confirm latency;
- destination queue depth;
- duplicate count at destination;
- dead-letter count;
- expired messages;
- authentication errors;
- TLS errors;
- policy/config drift;
- bridge process restarts;
- throughput after reconnect;
- backlog drain ETA.

Useful dashboards:

1. **Bridge health dashboard**
   - up/down, reconnects, last success timestamp.

2. **Backlog dashboard**
   - source depth, oldest age, growth rate, drain rate.

3. **Destination impact dashboard**
   - publish rate, confirm latency, downstream consumer lag.

4. **Data quality dashboard**
   - duplicates, invalid schema, rejected messages, quarantine.

5. **Compliance dashboard**
   - cross-boundary message counts by type/tenant/region.

---

## 14. Alerting Strategy

Bad alert:

```text
Queue depth > 1000
```

Better alert:

```text
source queue oldest message age > 10 minutes for critical bridge
AND bridge link status down OR drain rate < publish rate
```

Alert examples:

| Alert | Meaning | Action |
|---|---|---|
| bridge link down > 5 min | WAN/config/auth issue | inspect link, credentials, network |
| source oldest age > SLA | destination stale | communicate degradation, inspect drain |
| backlog growth rate positive for 30 min | consumers/bridge too slow | scale/throttle/check destination |
| duplicate rate spike | reconnect/replay/loop | inspect bridge recent events |
| inbound invalid schema spike | contract mismatch | stop relay or quarantine |
| destination confirm latency high | destination broker overloaded | check memory/disk/consumer lag |
| bridge auth failures | expired/rotated secret | fix credentials/certs |

---

## 15. Java Application Relay Pattern

When Shovel/Federation is not enough, build a relay.

Architecture:

```text
Source RabbitMQ
source.integration.q
      |
      v
Java Relay Service
- consume
- validate
- deduplicate
- redact/enrich
- publish destination
- wait confirm
- record movement
- ack source
      |
      v
Destination RabbitMQ
destination.integration.x
```

Core invariant:

```text
Do not ack source until destination publish outcome is safe enough.
```

But remember:

```text
destination publish confirmed + source ack failed = duplicate later
```

So relay must persist transfer state.

---

## 16. Relay State Machine

```text
RECEIVED_FROM_SOURCE
    |
    v
VALIDATED
    |
    v
TRANSFORMED
    |
    v
PUBLISHING_TO_DESTINATION
    |
    +-- confirm ack --> DESTINATION_CONFIRMED
    |                       |
    |                       v
    |                    SOURCE_ACKED
    |
    +-- confirm nack/timeout --> RETRY_OR_QUARANTINE
```

State table:

```sql
create table message_relay_attempt (
    relay_id varchar(128) primary key,
    source_message_id varchar(128) not null,
    source_region varchar(64) not null,
    destination_region varchar(64) not null,
    message_type varchar(128) not null,
    status varchar(64) not null,
    attempt_count int not null,
    last_error text,
    first_seen_at timestamp not null,
    updated_at timestamp not null,
    unique(source_message_id, destination_region)
);
```

This gives you:

- duplicate detection;
- retry coordination;
- auditability;
- reconciliation;
- operator visibility.

---

## 17. Java Relay Pseudocode

```java
public final class RabbitRelayConsumer {

    private final Channel sourceChannel;
    private final Channel destinationChannel;
    private final RelayRepository relayRepository;
    private final MessageTransformer transformer;

    public void handle(Delivery delivery) throws Exception {
        long tag = delivery.getEnvelope().getDeliveryTag();
        String sourceMessageId = extractMessageId(delivery);
        String destinationRegion = "core-ap-southeast-1";

        RelayRecord record = relayRepository.findOrCreate(sourceMessageId, destinationRegion);

        if (record.isSourceAcked()) {
            sourceChannel.basicAck(tag, false);
            return;
        }

        try {
            validate(delivery);

            OutboundMessage outbound = transformer.transform(delivery);

            relayRepository.markPublishing(record.id());

            long seq = destinationChannel.getNextPublishSeqNo();
            destinationChannel.basicPublish(
                    "core.case.events.x",
                    outbound.routingKey(),
                    true,
                    outbound.properties(),
                    outbound.body()
            );

            boolean confirmed = destinationChannel.waitForConfirms(10_000);
            if (!confirmed) {
                relayRepository.markUnknown(record.id(), "confirm timeout or nack");
                sourceChannel.basicNack(tag, false, true);
                return;
            }

            relayRepository.markDestinationConfirmed(record.id());
            sourceChannel.basicAck(tag, false);
            relayRepository.markSourceAcked(record.id());

        } catch (PermanentRelayException e) {
            relayRepository.markQuarantined(record.id(), e.getMessage());
            sourceChannel.basicReject(tag, false);
        } catch (TransientRelayException e) {
            relayRepository.markRetryable(record.id(), e.getMessage());
            sourceChannel.basicNack(tag, false, true);
        }
    }
}
```

Important caveats:

- synchronous `waitForConfirms` is simple but may be slow;
- async confirms need more complex correlation;
- relay repository must be transactional enough for audit;
- poison messages should not loop forever;
- idempotency must exist on destination side too.

---

## 18. Edge Messaging Architecture

Edge environments are special:

- intermittent connectivity;
- constrained disk/CPU;
- local autonomy needed;
- delayed central visibility acceptable;
- security risk higher;
- operator access limited.

Edge RabbitMQ design:

```text
Edge Application
    |
    v
Local RabbitMQ
- command queue for local work
- event exchange for local events
- outbound queue for core forwarding
- DLQ/parking lot local
- retention guardrails
    |
    v
Shovel or relay over secure link
    |
    v
Core RabbitMQ
```

Key edge invariants:

1. Edge can operate while offline.
2. Edge stores enough backlog for expected offline window.
3. Edge rejects/degrades gracefully before disk exhaustion.
4. Core treats incoming messages as delayed and duplicate-prone.
5. Every message has edge identity and origin timestamp.
6. Operators can inspect and replay local DLQ safely.

---

## 19. Multi-Region Regulatory Case Example

Scenario:

- Indonesia region processes local enforcement cases.
- Singapore region hosts central reporting and analytics.
- Each jurisdiction owns its own case state.
- Central reporting receives sanitized case lifecycle events.
- Evidence payload must not cross region; only metadata can cross.

Wrong design:

```text
internal.case.events.x -- Federation --> central.case.events.x
```

Problem:

- internal events may include sensitive evidence metadata;
- schema is internal and unstable;
- every internal event leaks across boundary;
- no policy decision point;
- no exposure audit.

Better design:

```text
Regional Case Service
    |
    v
internal.case.events.x
    |
    v
Public Event Relay
- validates event
- checks data classification
- redacts sensitive fields
- maps internal schema to public schema
- records exposure audit
    |
    v
public.case.events.x
    |
    v
Shovel/Federation
    |
    v
Central reporting broker
```

Public event example:

```json
{
  "eventId": "evt_01J...",
  "eventType": "CaseMilestoneReached",
  "schemaVersion": 2,
  "originRegion": "ID-JKT",
  "jurisdiction": "ID",
  "caseId": "case_123",
  "milestone": "NOTICE_ISSUED",
  "occurredAt": "2026-06-19T09:00:00Z",
  "classification": "PUBLIC_OPERATIONAL_METADATA",
  "correlationId": "corr_456",
  "causationId": "cmd_789"
}
```

No evidence body. No internal notes. No unredacted actor details unless allowed.

---

## 20. Federation/Shovel with RabbitMQ Streams

RabbitMQ Streams are not magically globally replicated across independent clusters through normal queue semantics.

If you need cross-cluster stream-like history, options include:

1. Publish once to local stream, then relay to remote stream.
2. Publish to queue/exchange and shovel/federate to remote stream-compatible endpoint/topology where appropriate.
3. Use an application relay that reads stream offsets and writes remote stream.
4. Use a central event backbone if RabbitMQ Streams are not enough for global log requirements.

Important questions:

- Is remote stream authoritative or projection?
- Do offsets need to be preserved? Usually no; use event IDs instead.
- How are duplicates handled?
- How is replay performed without re-triggering side effects?
- Is retention equal in both regions?
- What is recovery after gap?

Recommended mental model:

```text
stream event identity > transport offset
```

Offsets are local to a stream. Cross-cluster correctness should depend on event identity, sequence/version, and idempotency, not matching numeric offsets.

---

## 21. Topology Design Recipes

## 21.1 Simple One-Way Shovel

```text
source.q -> shovel -> destination.x
```

Use when:

- clear source queue;
- simple one-way movement;
- no transform;
- duplicate safe;
- destination routing is local.

Avoid when:

- need redaction;
- need complex filtering;
- need per-tenant policy;
- message schema differs.

---

## 21.2 Federated Public Exchange

```text
upstream public.events.x -> federated downstream public.events.x -> local queues
```

Use when:

- pub/sub event propagation;
- remote consumers should bind locally;
- topology should look like local exchange usage;
- event contract is stable and safe.

Avoid when:

- events are internal;
- remote consumers should not choose arbitrary binding keys;
- strict delivery workflow is needed.

---

## 21.3 Relay-Governed Boundary

```text
internal.x -> relay.q -> Java relay -> public.x -> bridge -> remote.public.x
```

Use when:

- boundary is regulatory/security-sensitive;
- payload transform required;
- audit exposure required;
- schema stabilization required.

---

## 21.4 Edge Offline Buffer

```text
edge.local.x -> edge.outbound.q -> shovel/relay -> core.ingress.x
```

Use when:

- local site must survive WAN loss;
- central can catch up later;
- messages are durable and capacity-planned.

---

## 21.5 Migration Bridge

```text
old.queue -> shovel -> new.exchange
```

Use when:

- broker migration;
- vhost migration;
- phased cutover.

Caution:

- coordinate with old consumers;
- preserve idempotency;
- run reconciliation.

---

## 22. Anti-Patterns

## 22.1 WAN Cluster

```text
Node A in Jakarta + Node B in Singapore + Node C in Tokyo as one cluster
```

Usually bad because:

- latency impacts consensus and metadata;
- partitions become normal, not exceptional;
- operational blast radius grows;
- failure modes are subtle.

Prefer regional clusters linked by Shovel/Federation/relay.

---

## 22.2 Bidirectional Bridge Without Loop Guard

Symptoms:

- duplicate storm;
- queue depth explosion;
- repeated events;
- consumers repeatedly applying same side effects.

Prevent with:

- inbound/outbound exchange separation;
- origin headers;
- hop count;
- relay state;
- no automatic re-export of imported messages.

---

## 22.3 Internal Event Federation

Internal events often contain:

- unstable schema;
- sensitive fields;
- implementation details;
- excessive volume;
- semantics not meant for other systems.

Do not federate internal exchanges directly across governance boundaries.

---

## 22.4 Treating Shovel as Exactly-Once Replication

Shovel can improve reliability, but it cannot remove fundamental distributed failure windows.

Always design destination as idempotent.

---

## 22.5 No Backlog Capacity Plan

If WAN goes down and source queue grows, you need to know:

- max offline duration;
- average publish rate;
- peak publish rate;
- message size;
- disk capacity;
- TTL/retention;
- degradation threshold.

Without this, “edge buffering” is wishful thinking.

---

## 22.6 Cross-Region Synchronous Business Assumption

If business process assumes remote event is visible immediately, asynchronous bridge will eventually violate it.

Either:

- make process asynchronous and tolerant;
- route command to owner region;
- use synchronous API with timeout semantics;
- use globally consistent platform if truly required.

---

## 23. Capacity Planning for Bridge Backlog

Formula sederhana:

```text
required_backlog_bytes = publish_rate_per_second
                       * average_message_size_bytes
                       * offline_window_seconds
                       * safety_factor
```

Example:

```text
publish rate: 200 msg/s
avg message: 4 KB
offline window: 6 hours = 21,600 seconds
safety factor: 2

required = 200 * 4096 * 21600 * 2
         = 35,389,440,000 bytes
         ≈ 35.4 GB
```

But include overhead:

- queue metadata;
- quorum replication factor;
- DLQ messages;
- retry queues;
- OS disk reserve;
- broker disk alarm threshold.

If quorum queue replication factor is 3, physical storage can be much larger.

---

## 24. Runbook: Bridge Down

Symptoms:

- link status down;
- source queue increasing;
- destination no longer receiving;
- central projection stale.

Steps:

1. Confirm whether issue is source, destination, network, auth, TLS, or policy.
2. Check source queue depth and oldest message age.
3. Estimate time to disk alarm.
4. Check destination broker health.
5. Check credentials/certs.
6. Check recent configuration changes.
7. If outage expected long, apply degradation policy:
   - throttle producers;
   - pause non-critical event generation;
   - increase edge capacity if possible;
   - divert low-priority messages.
8. After reconnect, monitor drain rate.
9. Watch duplicate/invalid message rate at destination.
10. Record incident timeline.

---

## 25. Runbook: Duplicate Spike After Reconnect

Steps:

1. Identify bridge/link that reconnected.
2. Check source redelivery count.
3. Check destination idempotency table.
4. Confirm no business side effects repeated.
5. Check whether manual replay was triggered.
6. Inspect origin headers and message IDs.
7. Look for bidirectional loop.
8. If loop, disable one bridge direction immediately.
9. Quarantine repeated messages if needed.
10. Add regression test for loop prevention.

---

## 26. Runbook: Migration with Shovel

1. Export topology definitions from old broker.
2. Create topology on new broker.
3. Create idempotent consumers on new side.
4. Stop or coordinate old consumers for queues being migrated.
5. Start shovel from old queue to new exchange.
6. Monitor old queue drain.
7. Validate counts and sample payloads.
8. Switch producers to new broker.
9. Keep old broker read-only for rollback window.
10. Disable shovel after drain and validation.
11. Archive migration audit.

---

## 27. Testing Strategy

Test these failure cases before production:

1. Destination broker down.
2. Source broker down.
3. WAN/network blocked.
4. Credential expired.
5. TLS cert invalid.
6. Destination exchange missing.
7. Destination unroutable message.
8. Source message poison.
9. Duplicate after reconnect.
10. Large backlog catch-up.
11. Bidirectional loop prevention.
12. Message schema mismatch.
13. Destination consumer overloaded.
14. Disk alarm on source.
15. Disk alarm on destination.

Test invariants:

- no source ack before safe destination outcome;
- duplicate does not duplicate business effect;
- forbidden payload does not cross boundary;
- stale projection is visible to users/operators;
- backlog can survive expected offline window;
- replay does not trigger irreversible side effects.

---

## 28. Design Checklist

Before approving a Federation/Shovel design, answer:

### Purpose

- What exact problem is solved?
- Event propagation, migration, DR, edge buffering, workload sharing, or integration boundary?

### Direction

- One-way or two-way?
- If two-way, how are loops prevented?

### Ownership

- Which region owns the entity?
- Can two regions update same entity?
- Is there single-writer rule?

### Semantics

- At-least-once acceptable?
- How are duplicates handled?
- Is ordering required? What scope?
- What happens if bridge is down?

### Data

- What fields cross boundary?
- Is PII present?
- Is redaction required?
- Is data residency satisfied?

### Operations

- Who owns the bridge?
- How is it deployed?
- How is it monitored?
- What is the runbook?
- How is backlog capacity calculated?

### Security

- TLS?
- Least privilege user?
- Secret rotation?
- Audit of config changes?

### Recovery

- How to replay safely?
- How to reconcile gaps?
- How to cut over/fail over?
- How to fail back?

---

## 29. Practical Heuristics

1. Do not cluster RabbitMQ across WAN unless you fully understand and accept the failure model.
2. Use clustering for LAN HA; use Federation/Shovel/relay for WAN links.
3. Treat every cross-broker bridge as at-least-once.
4. Destination consumers must be idempotent.
5. Never federate internal event streams across governance boundaries without review.
6. Public/integration events should be intentionally designed contracts.
7. Prefer one-way bridges unless bidirectional semantics are truly required.
8. Separate inbound and outbound exchanges.
9. Include origin region and event identity in every cross-region message.
10. Monitor oldest message age, not just queue depth.
11. Capacity plan for offline windows.
12. Test reconnect behavior before production.
13. Shovel is a message mover, not a domain policy engine.
14. Federation is topology-aware, but not a global broker illusion.
15. Use application relay when transformation, validation, redaction, or audit is required.
16. DR feed is not DR unless failover and reconciliation are tested.
17. Cross-region active-active is a domain design problem, not a RabbitMQ setting.
18. Offsets are local; event IDs are portable.
19. Security metadata can be sensitive too.
20. Bridge configuration is production code and must be versioned.

---

## 30. Mini Lab

### Lab 1 — Two RabbitMQ Brokers with Shovel

Create two brokers:

```yaml
services:
  rabbit-a:
    image: rabbitmq:4-management
    hostname: rabbit-a
    ports:
      - "15672:15672"
      - "5672:5672"
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest

  rabbit-b:
    image: rabbitmq:4-management
    hostname: rabbit-b
    ports:
      - "15673:15672"
      - "5673:5672"
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
```

Enable shovel on one side:

```bash
rabbitmq-plugins enable rabbitmq_shovel rabbitmq_shovel_management
```

Create source queue on A and destination exchange on B.

Create shovel:

```bash
rabbitmqctl set_parameter shovel a-to-b '{
  "src-uri": "amqp://guest:guest@rabbit-a:5672/%2f",
  "src-queue": "outbound.to.b.q",
  "dest-uri": "amqp://guest:guest@rabbit-b:5672/%2f",
  "dest-exchange": "inbound.from.a.x",
  "dest-routing-key": "case.event",
  "ack-mode": "on-confirm",
  "reconnect-delay": 5
}'
```

Experiments:

1. Publish message to source queue.
2. Verify arrival at B.
3. Stop B.
4. Publish more messages.
5. Restart B.
6. Observe catch-up.
7. Check duplicates by replaying manually.

---

### Lab 2 — Prevent Bridge Loop

Create:

```text
A outbound.x -> B inbound.x
B outbound.x -> A inbound.x
```

Then intentionally misconfigure inbound to outbound forwarding and observe duplicate growth.

Fix by:

- separate inbound/outbound flows;
- add origin header;
- reject messages whose origin equals destination outbound target.

---

### Lab 3 — Application Relay

Build Java relay that:

1. consumes from `edge.public.outbound.q`;
2. validates JSON schema;
3. redacts `internalNotes`;
4. publishes to `core.public.events.x`;
5. waits for publisher confirm;
6. acks source;
7. stores relay state in PostgreSQL;
8. handles duplicates.

Expected result:

- invalid message goes to quarantine;
- valid message arrives at core;
- duplicate does not create duplicate business effect.

---

## 31. Architecture Review Template

```markdown
# RabbitMQ Cross-Broker Link ADR

## Context

We need to move messages from <source> to <destination> because <business reason>.

## Non-Goals

- This is not global synchronous replication.
- This is not exactly-once delivery.
- This does not make both regions authoritative for the same entity.

## Chosen Mechanism

- Mechanism: Shovel / Federation / Java Relay / Hybrid
- Direction: one-way / two-way
- Source: <exchange/queue/vhost/region>
- Destination: <exchange/queue/vhost/region>

## Message Semantics

- Delivery: at-least-once
- Ordering scope: per <entity/tenant/source queue>
- Duplicate handling: <strategy>
- Replay strategy: <strategy>

## Security

- TLS: yes/no
- Credentials: <secret path>
- Permissions: <read/write/configure>
- Data classification: <classification>
- Redaction: yes/no

## Failure Behavior

- Source down: <behavior>
- Destination down: <behavior>
- WAN down: <behavior>
- Duplicate: <behavior>
- Poison message: <behavior>

## Observability

- Link status
- Source queue depth
- Oldest message age
- Destination confirm latency
- Duplicate count
- Invalid schema count

## Operational Runbook

<links or steps>

## Risks

<known risks>

## Alternatives Considered

- Clustering
- Shovel
- Federation
- Application relay
- Kafka/global event backbone
- Database replication

## Decision

<decision and why>
```

---

## 32. Summary

Federation, Shovel, and application relays are tools for explicit message movement across broker boundaries.

The key distinction:

```text
Clustering = one logical broker, LAN-oriented.
Federation = topology-aware asynchronous broker linking.
Shovel = explicit managed message movement.
Application relay = domain-aware movement with validation, transformation, audit, and policy.
```

A top-level engineer does not ask only:

> “Can RabbitMQ forward this message?”

They ask:

> “What are the semantics of this movement, what failures are acceptable, who owns the business state, what data is allowed to cross, and how do we recover when the bridge lies, lags, duplicates, or stops?”

For multi-region and edge systems, RabbitMQ can be extremely useful when used honestly. It is dangerous when used to pretend distributed systems are local systems.

---

## 33. What Comes Next

Part 24 will cover:

```text
Security, TLS, AuthN/AuthZ, Multi-Tenancy
```

We will go deeper into:

- users;
- virtual hosts;
- permissions;
- TLS;
- credential rotation;
- OAuth2/JWT/LDAP overview;
- multi-tenant topology;
- secret management in Spring Boot;
- auditability;
- secure production defaults.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-22.md">⬅️ Part 22 — Clustering, High Availability, Network Partitions</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-24.md">Part 24 — Security, TLS, AuthN/AuthZ, Multi-Tenancy ➡️</a>
</div>
