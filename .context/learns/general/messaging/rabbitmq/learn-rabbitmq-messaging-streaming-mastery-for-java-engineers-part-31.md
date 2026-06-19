# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-31.md

# Part 31 — Architecture Decision Framework: RabbitMQ vs Kafka vs Database vs HTTP

> Series: **RabbitMQ, RabbitMQ Streams, and Messaging Mastery for Java Engineers**  
> Part: **31 of 34**  
> Focus: memilih primitive komunikasi yang benar: RabbitMQ, Kafka, database queue, HTTP/gRPC, Redis Streams, atau workflow engine.

---

## 0. Tujuan Bagian Ini

Sampai titik ini, kita sudah masuk cukup dalam ke RabbitMQ:

- AMQP 0-9-1
- exchange, binding, queue, routing key
- classic queue, quorum queue, stream, super stream
- publisher confirms
- consumer ack/nack/redelivery
- retry, DLX, parking lot
- Spring AMQP/Spring Boot
- message contract
- ordering/concurrency/partitioning
- RPC/request-reply
- workflow/saga
- streams/replay/dedup/filtering
- clustering, federation, shovel
- security, observability, performance, topology pattern, testing, migration

Bagian ini menjawab pertanyaan yang lebih arsitektural:

> “Kapan saya harus memilih RabbitMQ, Kafka, database queue, HTTP/gRPC, Redis Streams, atau workflow engine?”

Ini bukan perbandingan fanboy. Ini decision framework.

Engineer top 1% tidak bertanya:

> “Tool mana yang paling bagus?”

Mereka bertanya:

> “Invariant apa yang harus dijaga, failure apa yang harus diterima, dan operational cost apa yang paling masuk akal untuk problem ini?”

---

## 1. Core Thesis

RabbitMQ bukan pengganti Kafka universal. Kafka bukan pengganti RabbitMQ universal. Database queue bukan selalu anti-pattern. HTTP/gRPC bukan selalu coupling buruk. Workflow engine bukan selalu overkill.

Semua primitive komunikasi punya bentuk trade-off sendiri.

Kesalahan arsitektur paling sering bukan karena memilih teknologi “jelek”, tetapi karena memilih teknologi dengan **semantic shape** yang tidak cocok terhadap problem.

Contoh:

- memakai Kafka untuk command dispatch sederhana yang butuh routing fleksibel dan ack per worker;
- memakai RabbitMQ classic queue untuk immutable audit replay jangka panjang;
- memakai database polling untuk throughput besar dan fanout banyak consumer;
- memakai HTTP sync untuk workflow yang sebenarnya butuh retry, timeout, escalation, dan audit;
- memakai workflow engine untuk event notification sederhana;
- memakai Redis Streams untuk audit/regulatory history tanpa memahami persistence, retention, dan ops modelnya.

Decision framework di bagian ini akan menurunkan pilihan teknologi dari kebutuhan nyata:

1. Apakah ini command, event, job, query, notification, atau workflow step?
2. Apakah message harus dikonsumsi sekali atau bisa direplay banyak kali?
3. Apakah ordering penting? Ordering global atau per key?
4. Apakah consumer harus push-based atau pull/replay-based?
5. Apakah routing broker-side kompleks dibutuhkan?
6. Apakah data harus bertahan lama sebagai log?
7. Apakah state machine bisnis perlu eksplisit?
8. Apa failure mode dominan?
9. Siapa pemilik operasionalnya?
10. Apa audit dan compliance requirement-nya?

---

## 2. Communication Primitive Mental Model

Sebelum membandingkan tool, pisahkan dulu jenis komunikasi.

### 2.1 Command

Command adalah instruksi untuk melakukan sesuatu.

Contoh:

```text
AssignCaseReviewerCommand
GenerateViolationNoticeCommand
EvaluateRiskRuleCommand
SendNotificationCommand
```

Karakteristik:

- biasanya punya intended handler;
- sering hanya satu consumer group/worker yang harus memproses;
- retry penting;
- duplicate harus aman;
- failure harus jelas;
- ack setelah side effect berhasil;
- DLQ/parking lot sering dibutuhkan.

RabbitMQ sangat kuat untuk command dispatch.

Kafka bisa dipakai, tetapi sering terasa tidak natural kalau command butuh routing fleksibel, per-message ack/retry, dan dead-letter workflow yang granular.

HTTP/gRPC cocok jika command harus synchronous dan caller butuh hasil cepat.

Workflow engine cocok jika command adalah bagian dari proses panjang dengan timer, compensation, dan state transition kompleks.

---

### 2.2 Event

Event menyatakan sesuatu sudah terjadi.

Contoh:

```text
CaseOpenedEvent
EvidenceSubmittedEvent
PenaltyCalculatedEvent
ReviewApprovedEvent
```

Karakteristik:

- producer tidak memerintah consumer;
- consumer bisa banyak;
- fanout sering terjadi;
- event bisa menjadi audit trail;
- replay mungkin penting;
- ordering per aggregate sering penting.

Kafka sangat kuat untuk durable event log dan replay multi-consumer.

RabbitMQ exchange + queue sangat kuat untuk event notification dan broker-side fanout.

RabbitMQ Streams mengisi area event log/replay di dalam RabbitMQ ecosystem.

Database event table/outbox bisa menjadi source of truth untuk event publication.

---

### 2.3 Job / Work Item

Job adalah unit kerja yang harus diambil worker.

Contoh:

```text
IndexDocumentJob
GeneratePdfJob
SendBatchEmailJob
RecalculateRiskScoreJob
```

Karakteristik:

- work distribution;
- competing consumers;
- ack setelah selesai;
- retry/DLQ penting;
- throughput dan backpressure penting;
- ordering biasanya tidak dominan, kecuali per key.

RabbitMQ work queue sangat cocok.

Kafka bisa dipakai tetapi modelnya lebih partition-based pull log, bukan work stealing queue tradisional.

Database queue bisa cukup untuk volume kecil/menengah dan coupling dengan DB transaction.

Redis/Sidekiq-style queue bisa cocok untuk background job sederhana, tergantung stack.

---

### 2.4 Query / Request

Query meminta data atau jawaban.

Contoh:

```text
GET /cases/{id}
RiskService.Evaluate(request)
```

Karakteristik:

- caller menunggu jawaban;
- latency matters;
- timeout explicit;
- biasanya tidak boleh hidden async;
- retry bisa menyebabkan duplicate load.

HTTP/gRPC biasanya lebih cocok.

RabbitMQ RPC bisa dipakai jika environment memang messaging-only atau butuh broker-mediated request/reply, tetapi harus hati-hati.

Kafka bukan primitive query-response natural.

---

### 2.5 Notification

Notification adalah sinyal bahwa sesuatu perlu diketahui.

Contoh:

```text
NotifyRiskTeam
NotifyCaseOwner
WebhookDeliveryRequested
```

Karakteristik:

- best-effort atau reliable tergantung domain;
- fanout mungkin penting;
- retry sering dibutuhkan;
- idempotency penting.

RabbitMQ cocok.

Kafka cocok jika notification juga bagian dari event log besar.

HTTP webhook cocok untuk external integration, tetapi perlu retry queue/outbox.

---

### 2.6 Workflow Step

Workflow step adalah transisi dalam proses panjang.

Contoh:

```text
CaseSubmitted -> RuleEvaluationPending -> ReviewAssigned -> DecisionIssued
```

Karakteristik:

- state machine penting;
- timer/deadline penting;
- compensation mungkin ada;
- audit wajib;
- duplicate/out-of-order harus dikendalikan;
- human intervention mungkin ada.

RabbitMQ bisa menjadi transport/work distribution backbone.

Tetapi state machine harus hidup di aplikasi atau workflow engine, bukan di queue.

Workflow engine seperti Temporal/Camunda/Zeebe/Conductor dapat lebih cocok jika workflow sangat kompleks, long-running, dan butuh durable orchestration semantics.

---

## 3. Technology Shapes

Sekarang kita definisikan “shape” masing-masing teknologi.

---

## 4. RabbitMQ Shape

RabbitMQ adalah broker messaging dan streaming yang kuat pada routing, queue semantics, work distribution, consumer ack, dan broker-side topology.

RabbitMQ modern mendukung beberapa protokol dan primitive, termasuk AMQP 0-9-1, AMQP 1.0, MQTT, STOMP, RabbitMQ Stream Protocol, quorum queues, dan streams.

### 4.1 Sweet Spot RabbitMQ

RabbitMQ unggul saat kamu butuh:

- command dispatch;
- work queue;
- competing consumers;
- broker-side routing;
- direct/fanout/topic/header exchange;
- per-consumer queue;
- ack/nack/requeue per message;
- DLQ dan retry topology;
- backpressure via prefetch;
- request/reply brokered messaging;
- workflow task dispatch;
- integration messaging antar service;
- hybrid queue + stream dalam satu broker ecosystem;
- lower conceptual overhead dibanding event streaming platform besar untuk use case queue-centric.

### 4.2 RabbitMQ Queue Strength

RabbitMQ queue cocok untuk:

```text
Producer -> Exchange -> Queue -> Competing Consumers
```

Saat message diproses, message biasanya hilang dari queue setelah ack. Ini cocok untuk work, bukan history.

Dengan quorum queue, RabbitMQ cocok untuk durable replicated work queues.

Dokumentasi resmi RabbitMQ menyebut quorum queue sebagai queue modern durable dan replicated berbasis Raft, dan default choice saat membutuhkan queue replicated/highly available.

### 4.3 RabbitMQ Stream Strength

RabbitMQ Streams cocok saat kamu butuh:

- append-only log;
- retention;
- replay;
- non-destructive consumption;
- offset;
- stream deduplication;
- super stream/partitioning;
- audit feed yang masih berada dalam RabbitMQ ecosystem.

Namun RabbitMQ Streams bukan berarti RabbitMQ otomatis menjadi Kafka untuk semua workload. Kafka ecosystem, operational model, log compaction, connector ecosystem, dan large-scale event streaming platform capability tetap berbeda.

### 4.4 RabbitMQ Weakness / Cost

RabbitMQ kurang ideal jika:

- kamu butuh event log besar dengan retention lama dan banyak replay consumer;
- kamu butuh analytics/event streaming ecosystem luas;
- kamu butuh partitioned log sebagai backbone data platform besar;
- kamu butuh global ordering semua event;
- kamu butuh multi-region active-active broker tunggal;
- kamu ingin broker menyimpan large payload;
- kamu tidak siap mengelola queue growth, retry storm, DLQ, dan consumer lag.

RabbitMQ cluster juga tidak direkomendasikan untuk WAN; dokumentasi RabbitMQ menyatakan clustering ditujukan untuk LAN dan Shovel/Federation lebih tepat untuk koneksi antar broker melalui WAN.

---

## 5. Kafka Shape

Kafka adalah distributed commit log / event streaming platform.

Kafka unggul pada:

- durable event log;
- high throughput append;
- partitioned topics;
- replay by offset;
- multiple independent consumer groups;
- stream processing ecosystem;
- data pipeline;
- event sourcing/event log use cases;
- analytics integration;
- long-lived event history.

### 5.1 Sweet Spot Kafka

Kafka cocok jika requirement utama adalah:

- “semua event harus tersimpan sebagai log dan bisa direplay”;
- banyak consumer group independen membaca event yang sama;
- throughput event sangat besar;
- event ordering per key dibutuhkan;
- event stream menjadi data backbone;
- consumer progress berbasis offset;
- reprocessing adalah fitur utama;
- downstream analytics/warehouse/lake/stream processing penting.

### 5.2 Kafka Weakness / Cost

Kafka kurang natural untuk:

- complex broker-side routing ala RabbitMQ exchange;
- per-message ack/nack/requeue;
- work stealing competing consumers model yang sangat queue-centric;
- delayed retry/DLQ yang mudah secara broker semantics;
- RPC/request-reply;
- routing command ke queue khusus dengan topology fleksibel;
- workload kecil yang hanya butuh background job reliable.

Kafka bisa melakukan sebagian hal itu, tetapi sering membutuhkan pola tambahan:

- retry topic;
- DLQ topic;
- consumer group design;
- key partitioning;
- idempotent processing;
- transaction semantics;
- state store;
- stream processor.

Itu bukan salah Kafka. Itu karena shape Kafka adalah log, bukan work queue broker.

---

## 6. Database Queue Shape

Database queue berarti menggunakan tabel sebagai queue.

Contoh:

```sql
job_queue(id, type, payload, status, available_at, locked_by, locked_until, attempts)
```

Atau outbox table:

```sql
outbox(id, aggregate_id, event_type, payload, published_at)
```

### 6.1 Sweet Spot Database Queue

Database queue bisa valid jika:

- volume rendah sampai sedang;
- workload dekat dengan transaction database;
- atomicity dengan business state lebih penting daripada throughput;
- tim ingin menghindari broker tambahan untuk fase awal;
- job adalah internal monolith background work;
- latency tidak ekstrem;
- concurrency terbatas;
- schema dan operational model mudah dikendalikan;
- polling overhead masih acceptable.

### 6.2 Database Queue sebagai Outbox

Outbox table adalah pola yang sangat kuat.

Masalah:

```text
DB commit berhasil, publish message gagal.
```

Solusi:

```text
Business transaction inserts outbox row.
Outbox relay publishes to RabbitMQ/Kafka.
Relay marks row as published after confirm/ack.
```

Ini bukan “database queue buruk”. Ini database sebagai transactional publication buffer.

### 6.3 Database Queue Weakness

Database queue menjadi buruk jika:

- throughput tinggi;
- polling terlalu sering;
- banyak worker berebut lock;
- tabel queue menjadi hotspot;
- retention besar;
- fanout banyak consumer;
- retry scheduling kompleks;
- broker semantics direplikasi manual;
- queue logic mengganggu OLTP workload;
- observability buruk.

Tanda database queue sudah waktunya dipindah:

- query polling mendominasi DB load;
- job latency tidak stabil;
- lock contention tinggi;
- backlog sulit dianalisis;
- retry logic membengkak;
- fanout mulai dibutuhkan;
- tim membuat exchange/binding/DLQ palsu di SQL.

---

## 7. HTTP/gRPC Shape

HTTP/gRPC adalah request-response communication.

### 7.1 Sweet Spot HTTP/gRPC

HTTP/gRPC cocok jika:

- caller butuh response langsung;
- operasi pendek;
- dependency sync memang acceptable;
- failure bisa dikembalikan sebagai status/error;
- timeout jelas;
- query/read model;
- user-facing request path;
- low-latency service-to-service call;
- contract bisa didefinisikan via OpenAPI/Protobuf;
- backpressure bisa dilakukan via rate limit/circuit breaker.

### 7.2 HTTP/gRPC Weakness

HTTP/gRPC buruk jika:

- caller tidak perlu hasil langsung;
- operasi long-running;
- retry harus survive caller crash;
- request fanout ke banyak downstream;
- side effect perlu audit/retry/DLQ;
- traffic spike harus diserap queue;
- human workflow/timer/escalation diperlukan;
- caller tidak boleh terikat availability consumer.

### 7.3 Synchronous Trap

Banyak sistem “microservice” gagal karena semua komunikasi tetap sync:

```text
API -> Service A -> Service B -> Service C -> Service D
```

Masalah:

- latency chain;
- cascading failure;
- retry amplification;
- unclear ownership;
- timeout ambiguity;
- distributed transaction illusion.

Tetapi bukan berarti semua HTTP harus diganti RabbitMQ.

Better framing:

- query/read: HTTP/gRPC;
- command accepted: HTTP returns 202 + RabbitMQ command queue;
- event notification: RabbitMQ/Kafka;
- long workflow: workflow engine/RabbitMQ orchestration;
- internal job: RabbitMQ/database queue.

---

## 8. Redis Streams Shape

Redis Streams menyediakan append-only stream structure di Redis dengan consumer groups.

### 8.1 Sweet Spot Redis Streams

Redis Streams bisa cocok jika:

- sistem sudah kuat di Redis;
- latency rendah penting;
- workload sedang;
- operational simplicity lebih penting daripada broker feature lengkap;
- ephemeral/event-ish processing;
- consumer group sederhana;
- retention terbatas;
- use case dekat cache/session/realtime.

### 8.2 Redis Streams Weakness

Redis Streams harus hati-hati jika:

- audit/regulatory durability sangat tinggi;
- retention panjang;
- replay besar;
- multi-tenant security kompleks;
- broker-side routing kompleks dibutuhkan;
- DLQ/retry semantics butuh banyak custom logic;
- message volume besar dan long-lived;
- tim menganggap Redis persistence sama dengan log broker durability.

Redis Streams bukan RabbitMQ exchange/queue topology. Bukan juga Kafka ecosystem. Ia punya tempat sendiri.

---

## 9. Workflow Engine Shape

Workflow engine seperti Temporal, Camunda, Zeebe, Conductor, atau lainnya menyediakan durable orchestration.

### 9.1 Sweet Spot Workflow Engine

Workflow engine cocok jika:

- proses long-running;
- banyak step;
- timer/deadline penting;
- compensation penting;
- human task banyak;
- state machine kompleks;
- retry policy per activity;
- visibility workflow penting;
- replay/history workflow penting;
- business process harus eksplisit.

Contoh:

```text
Case intake -> validation -> evidence request -> risk scoring -> reviewer assignment -> legal approval -> notice generation -> appeal window -> closure
```

RabbitMQ bisa membantu dispatch task/activity. Tetapi workflow state sebaiknya tidak disembunyikan di queue.

### 9.2 Workflow Engine Weakness

Workflow engine bisa overkill jika:

- hanya perlu simple async job;
- hanya event notification;
- tim belum siap operational model baru;
- process state sederhana;
- throughput event lebih penting daripada orchestration;
- task bisa diselesaikan dengan RabbitMQ + DB state machine.

---

## 10. Decision Axis 1 — Work Distribution vs Event History

Ini axis paling penting.

### 10.1 Work Distribution

Pertanyaan:

> “Apakah message ini harus dikerjakan oleh satu worker lalu selesai?”

Jika ya:

- RabbitMQ queue/quorum queue sangat cocok;
- database queue bisa cukup untuk internal low volume;
- Kafka kurang natural tetapi bisa;
- HTTP/gRPC tidak cocok jika kerja long-running.

Contoh:

```text
GenerateNoticePdfJob
SendEmailCommand
RecalculateScoreJob
```

### 10.2 Event History

Pertanyaan:

> “Apakah message ini adalah history yang harus bisa dibaca ulang oleh banyak consumer?”

Jika ya:

- Kafka sangat cocok;
- RabbitMQ Streams bisa cocok jika ecosystem RabbitMQ cukup dan scale/retention cocok;
- database event table bisa jadi source of truth/outbox;
- RabbitMQ queue biasa tidak cocok karena destructive consumption.

Contoh:

```text
CaseOpenedEvent
EvidenceSubmittedEvent
ReviewDecisionIssuedEvent
```

---

## 11. Decision Axis 2 — Routing Complexity

RabbitMQ unggul jika broker-side routing penting.

Pertanyaan:

- Apakah producer harus publish sekali dan broker menentukan queue mana yang menerima?
- Apakah routing key/topic wildcard penting?
- Apakah tiap consumer punya queue sendiri?
- Apakah event harus difilter berdasarkan domain/action/region/tenant?
- Apakah topology sendiri adalah control plane?

Jika ya, RabbitMQ sangat kuat.

Kafka routing biasanya lebih topic/partition oriented.

Kafka producer biasanya memilih topic; consumer group membaca topic. Broker tidak melakukan exchange-style routing ke banyak queue berdasarkan binding wildcard.

---

## 12. Decision Axis 3 — Replay Requirement

Pertanyaan:

> “Apakah consumer baru harus bisa membaca event lama?”

Jika tidak:

- RabbitMQ queue/event fanout cukup.

Jika ya untuk retention pendek/menengah dan RabbitMQ ecosystem:

- RabbitMQ Streams.

Jika ya untuk platform-scale event log:

- Kafka.

Jika replay hanya untuk audit query dan bukan streaming processing:

- database audit table/object storage bisa cukup.

Jangan pakai queue destructive sebagai audit log.

---

## 13. Decision Axis 4 — Ordering

Ordering harus selalu ditanya dengan scope:

- global ordering?
- per aggregate ordering?
- per tenant ordering?
- per case ordering?
- per key ordering?
- only causality ordering?

### 13.1 RabbitMQ Ordering

RabbitMQ queue bisa mempertahankan queue order sampai kamu menambah:

- competing consumers;
- prefetch > 1;
- retry/requeue;
- DLQ replay;
- priority;
- parallel handler.

Untuk per-key ordering di RabbitMQ:

- route per key ke partition queue;
- gunakan consistent hash exchange;
- gunakan single active consumer;
- gunakan state machine guard/version.

### 13.2 Kafka Ordering

Kafka ordering natural per partition.

Jika key sama masuk partition sama, ordering per key lebih natural.

Tetapi global ordering di banyak partition tetap tidak ada.

### 13.3 Database Ordering

Database bisa memberikan ordering via transaction sequence atau version number.

Tetapi polling dan concurrent workers tetap bisa merusak processing order jika tidak hati-hati.

### 13.4 Workflow Engine Ordering

Workflow engine bisa menjaga urutan step dalam workflow instance.

Ini kuat untuk lifecycle state machine.

---

## 14. Decision Axis 5 — Delivery and Ack Semantics

RabbitMQ:

- per-message delivery;
- consumer ack/nack;
- requeue;
- DLQ;
- prefetch;
- at-least-once;
- duplicate possible.

Kafka:

- offset commit;
- consumer group progress;
- replay via offset;
- duplicate possible;
- poison message handling usually application/topic pattern.

Database queue:

- status/lock rows;
- application-defined ack;
- transactional with DB;
- duplicate possible if lock expires.

HTTP/gRPC:

- response status;
- retry by caller;
- timeout unknown;
- no built-in durable ack.

Workflow engine:

- durable activity/workflow state;
- retry policy;
- deterministic/replay semantics depending on engine;
- activity idempotency still important.

---

## 15. Decision Axis 6 — Latency vs Durability

Primitive berbeda punya cost profile.

### 15.1 Low Latency Sync

Use HTTP/gRPC.

### 15.2 Durable Async Work

Use RabbitMQ quorum queue.

### 15.3 Durable Event History

Use Kafka or RabbitMQ Streams.

### 15.4 Atomic DB State + Later Publish

Use database outbox.

### 15.5 Long Process Durability

Use workflow engine or DB-backed state machine + RabbitMQ.

---

## 16. Decision Axis 7 — Failure Mode Dominant

Pilih teknologi berdasarkan failure yang paling penting.

### 16.1 Consumer Crash During Work

RabbitMQ shines:

```text
message delivered -> consumer crashes before ack -> broker redelivers
```

Kafka handles via offset not committed.

Database queue handles via lock timeout.

HTTP/gRPC caller must retry or operation is lost unless server persists work.

### 16.2 Producer Crash After DB Commit

Use outbox.

This applies regardless of RabbitMQ or Kafka.

### 16.3 Consumer Poison Message

RabbitMQ has DLX/DLQ/retry topology.

Kafka needs retry/DLQ topic pattern.

Database queue needs status/attempt/dead table.

Workflow engine can fail workflow/activity with visibility.

### 16.4 Need Reprocessing

Kafka/RabbitMQ Streams.

Queue replay from DLQ is operationally hazardous if treated as history.

### 16.5 Downstream Slow

RabbitMQ queue absorbs backlog, but must be bounded/monitored.

Kafka lag absorbs backlog by offsets/log retention.

HTTP/gRPC propagates slowness unless protected.

Database queue shifts pressure to DB.

---

## 17. Decision Axis 8 — Operational Ownership

A tool is not just code. It is operational responsibility.

Ask:

- who operates broker/cluster?
- who monitors DLQ/lag/backlog?
- who owns schemas/contracts?
- who handles replay?
- who handles partition failure?
- who rotates credentials?
- who handles incident reconstruction?
- who understands upgrades?

RabbitMQ operational ownership includes:

- queue depth;
- memory/disk alarms;
- node failure;
- retry storms;
- DLQ triage;
- permissions/vhosts;
- topology drift;
- shovel/federation links.

Kafka operational ownership includes:

- topic/partition design;
- consumer lag;
- retention;
- broker storage;
- rebalancing;
- schema evolution;
- connector pipelines;
- compaction if used.

Database queue operational ownership includes:

- DB load;
- lock contention;
- vacuum/bloat/indexes;
- polling latency;
- archival;
- retry cleanup.

Workflow engine operational ownership includes:

- workflow history;
- task queues;
- worker deployment;
- stuck workflows;
- versioning;
- deterministic code constraints;
- visibility/search.

---

## 18. Decision Axis 9 — Compliance, Audit, and Forensics

Untuk regulatory/evidence/enforcement system, audit bukan nice-to-have.

Tanya:

- Apakah harus membuktikan command diterima?
- Apakah harus membuktikan handler memproses?
- Apakah harus melihat alasan state berubah?
- Apakah harus replay historical event?
- Apakah DLQ/parking lot harus diaudit?
- Apakah message mengandung PII?
- Apakah retention policy legal berbeda dari technical retention?

### 18.1 RabbitMQ Queue untuk Audit?

Queue bukan audit log.

Queue bisa memberikan operational trace, tetapi setelah ack message hilang.

Audit harus disimpan di:

- business DB audit table;
- RabbitMQ Stream;
- Kafka topic;
- append-only storage;
- workflow engine history;
- immutable object store.

### 18.2 RabbitMQ Streams for Audit

RabbitMQ Streams cocok untuk audit/event replay jika:

- retention cocok;
- volume cocok;
- RabbitMQ ops team sanggup;
- replay governance jelas;
- compliance policy sinkron dengan retention.

### 18.3 Kafka for Audit/Event Platform

Kafka cocok jika audit event juga menjadi data platform, integration backbone, dan multi-consumer replay source.

### 18.4 Database Audit

Database audit table cocok jika audit query transactional dan dekat dengan domain state.

Untuk regulatory defensibility, database audit + message correlation biasanya lebih kuat daripada hanya broker logs.

---

## 19. Quick Decision Matrix

| Requirement | Best Initial Candidate | Notes |
|---|---|---|
| Background job with reliable ack/retry | RabbitMQ quorum queue | Work distribution natural |
| Event notification to multiple services | RabbitMQ topic/fanout exchange | Queue per consumer service |
| Durable event log with replay at scale | Kafka | Especially many independent consumer groups |
| Durable event log inside RabbitMQ ecosystem | RabbitMQ Streams | Good if scale/retention fit |
| Transactional publish after DB commit | DB outbox + RabbitMQ/Kafka | Outbox solves atomicity gap |
| Simple internal low-volume job | DB queue | Acceptable if DB load/concurrency low |
| Sync query/read | HTTP/gRPC | Do not force async |
| Long-running business workflow | Workflow engine or DB state machine + RabbitMQ | Broker should not be state machine |
| Complex broker-side routing | RabbitMQ | Exchange/binding model shines |
| Per-message nack/requeue/DLQ | RabbitMQ | More natural than Kafka |
| Massive analytics/event pipeline | Kafka | Ecosystem advantage |
| Edge broker to core broker | RabbitMQ Shovel/Federation/application relay | Not WAN cluster |
| Request/reply through broker | RabbitMQ RPC/direct reply-to | Use sparingly |
| Strict per-key event ordering | Kafka or RabbitMQ partition queues/super streams | Depends replay/work semantics |
| Regulatory audit trail | DB audit + stream/log | Queue alone insufficient |

---

## 20. RabbitMQ vs Kafka: Detailed Decision

### 20.1 Choose RabbitMQ When

Choose RabbitMQ when:

```text
The problem is primarily about routing work to consumers reliably.
```

Strong signals:

- you need commands/jobs;
- message should be consumed and removed;
- per-message ack matters;
- per-message retry/requeue/DLQ matters;
- topology routes messages to queues;
- services need their own queues;
- routing keys/wildcards are valuable;
- slow consumers should build backlog in their own queue;
- producer should not know all consumers;
- background work dominates over replay.

Example:

```text
Case API receives evidence.
It publishes EvidenceSubmittedEvent.
Rule engine queue receives event.
Notification queue receives event.
Audit stream also receives event.
Rule engine emits EvaluateRiskCommand.
Workers consume command from quorum queue.
Failed commands go to DLQ/parking lot.
```

### 20.2 Choose Kafka When

Choose Kafka when:

```text
The problem is primarily about durable event history consumed by many independent readers.
```

Strong signals:

- replay is core;
- event log is source of integration truth;
- high throughput append;
- multiple independent consumer groups;
- analytics/stream processing;
- partitioned ordering per key;
- long retention;
- consumer progress by offset;
- historical reprocessing is routine.

Example:

```text
All case lifecycle events feed analytics, risk modeling, compliance reporting, projection rebuilds, fraud detection, and notification systems.
```

### 20.3 Hybrid RabbitMQ + Kafka

In serious systems, both can coexist.

Pattern:

```text
RabbitMQ: command/work dispatch, retry, workflow task queues
Kafka: durable domain event log/data platform
Outbox: reliable bridge from DB transaction to broker/log
```

Example:

```text
Case service writes state + outbox event.
Outbox relay publishes domain event to Kafka.
Kafka consumer updates projections and analytics.
Another relay publishes RabbitMQ command for specific work queue.
RabbitMQ workers perform side-effecting tasks with DLQ/retry.
```

But be careful: more infrastructure means more failure modes.

Use hybrid only when responsibilities are clearly separated.

---

## 21. RabbitMQ vs Database Queue

### 21.1 Use RabbitMQ When

- multiple services consume;
- fanout/routing needed;
- retry/DLQ needed;
- high concurrency;
- DB should not absorb queue load;
- backpressure/consumer prefetch useful;
- broker observability useful;
- work distribution is central.

### 21.2 Use Database Queue When

- same application owns DB and worker;
- low/medium volume;
- atomicity with DB transaction is primary;
- simple scheduled jobs;
- small team/early system;
- operational simplicity matters;
- no fanout;
- no complex routing.

### 21.3 Migration Path

A mature path:

```text
DB table -> outbox -> RabbitMQ command queue -> RabbitMQ + stream/Kafka as needed
```

Do not prematurely introduce broker if a DB-backed job table is enough.

Do not stubbornly keep DB queue after it becomes a custom broken broker.

---

## 22. RabbitMQ vs HTTP/gRPC

### 22.1 Use HTTP/gRPC When

- caller needs immediate response;
- operation is short;
- request is query/read;
- synchronous dependency acceptable;
- failure can be surfaced immediately;
- client/user waiting.

### 22.2 Use RabbitMQ When

- operation is async;
- caller only needs acceptance;
- work can outlive caller;
- retry must be durable;
- consumer may be temporarily down;
- workload burst should be buffered;
- fanout or routing needed.

### 22.3 Useful Hybrid Pattern

```http
POST /cases/{id}/submit-evidence
202 Accepted
Location: /operations/{operationId}
```

Internally:

```text
API writes command request record.
API publishes command/event via outbox to RabbitMQ.
Worker processes.
Client polls operation status or receives notification.
```

This avoids long synchronous chains.

---

## 23. RabbitMQ vs Workflow Engine

### 23.1 Use RabbitMQ + DB State Machine When

- workflow is moderate;
- domain state model is already in app DB;
- team wants explicit control;
- steps are mostly service work queues;
- timer/escalation can be implemented with scheduler/outbox;
- process visibility can be built from domain/audit tables.

### 23.2 Use Workflow Engine When

- workflow is long-running and complex;
- many timers;
- many retries with business semantics;
- compensation is common;
- human task orchestration is central;
- process visibility is required by operations;
- versioning workflow is manageable;
- workflow history is a first-class artifact.

### 23.3 RabbitMQ Role with Workflow Engine

RabbitMQ can still be used for:

- activity task dispatch;
- integration events;
- notification jobs;
- external service command queues;
- audit event stream.

But do not duplicate workflow state in queue names and DLQs.

---

## 24. Architecture Decision Tree

Use this as a practical decision tree.

### Step 1 — Is caller waiting for immediate data?

If yes:

```text
Use HTTP/gRPC.
```

Unless the operation is long-running; then return `202 Accepted` and dispatch async.

### Step 2 — Is this long-running business process with timers/compensation?

If yes:

```text
Use workflow engine OR DB state machine + RabbitMQ.
```

Choose workflow engine if process complexity justifies operational cost.

### Step 3 — Is message a work item to be consumed once?

If yes:

```text
Use RabbitMQ quorum queue.
```

Use database queue only if internal, low-volume, and DB atomicity dominates.

### Step 4 — Is message an event history that many consumers may replay?

If yes:

```text
Use Kafka or RabbitMQ Streams.
```

Use Kafka for data platform/event streaming at scale. Use RabbitMQ Streams if RabbitMQ ecosystem and retention/scale are enough.

### Step 5 — Is broker-side routing important?

If yes:

```text
Use RabbitMQ exchange/binding topology.
```

### Step 6 — Is source of truth DB transaction critical?

If yes:

```text
Use outbox/inbox regardless of broker choice.
```

### Step 7 — Is cross-region broker link required?

If yes:

```text
Do not stretch RabbitMQ cluster over WAN.
Use Shovel/Federation/application relay or event platform replication.
```

---

## 25. ADR Template

Use this template for real architecture decisions.

```markdown
# ADR: Messaging Primitive for <Use Case>

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
Describe the business process, producer, consumer, volume, latency, durability, ordering, replay, audit, and operational constraints.

## Message Type
- Command | Event | Job | Notification | Query | Workflow Step

## Requirements
- Delivery semantics:
- Ordering scope:
- Retry/DLQ:
- Replay:
- Retention:
- Throughput:
- Latency:
- Audit/compliance:
- Security/data sensitivity:
- Multi-region:
- Operational owner:

## Options Considered
1. RabbitMQ quorum queue
2. RabbitMQ stream
3. Kafka topic
4. Database queue/outbox
5. HTTP/gRPC
6. Workflow engine

## Decision
Chosen option:

## Rationale
Why this option fits the semantic shape.

## Rejected Options
Why alternatives were rejected.

## Failure Model
- Producer crash:
- Broker/log unavailable:
- Consumer crash:
- Duplicate processing:
- Poison message:
- Slow consumer:
- Replay/backfill:
- Network partition:

## Operational Model
- Metrics:
- Alerts:
- Runbook:
- Ownership:
- Capacity plan:

## Migration/Rollback Plan
How to introduce/change safely.

## Consequences
Positive and negative trade-offs accepted.
```

---

## 26. Example ADR 1 — Evidence PDF Generation

### Context

After evidence is submitted, the system must generate a PDF bundle. Generation can take seconds to minutes. If PDF service is down, work must retry. Duplicate generation is acceptable if output is idempotently written by evidence ID/version.

### Decision

Use RabbitMQ quorum queue.

### Rationale

This is work distribution, not event history.

Needs:

- durable async work;
- competing workers;
- ack after output stored;
- retry and DLQ;
- bounded prefetch;
- poison handling.

Kafka would be unnecessary unless PDF generation is driven from a broader event log.

HTTP sync would create latency/cascading failure.

Database queue might work at low volume, but RabbitMQ gives better worker control and operational visibility.

### Topology

```text
exchange: case.commands.topic
routing key: case.evidence.pdf.generate
queue: q.pdf-generator.commands.quorum
DLQ: q.pdf-generator.commands.dlq
parking lot: q.pdf-generator.commands.parking
```

---

## 27. Example ADR 2 — Case Lifecycle Event History

### Context

All case lifecycle events must be retained for analytics, projection rebuild, compliance reporting, and downstream services. Many consumers read independently.

### Decision

Use Kafka or RabbitMQ Streams depending organization platform.

If enterprise already has Kafka data platform, choose Kafka.

If scope is inside RabbitMQ-centric platform with moderate retention/scale, RabbitMQ Streams can be sufficient.

### Rationale

This is event history, not work queue.

Needs:

- non-destructive consumption;
- replay;
- independent consumer progress;
- retention policy;
- event ordering per case ID;
- schema governance.

RabbitMQ queue alone is wrong.

---

## 28. Example ADR 3 — Submit Evidence API

### Context

User submits evidence through frontend. User needs confirmation that submission was accepted, not that all downstream processing completed.

### Decision

Use HTTP API + DB transaction + outbox + RabbitMQ/Kafka publication.

### Flow

```text
POST /cases/{caseId}/evidence
  -> validate request
  -> store evidence metadata
  -> insert outbox event EvidenceSubmitted
  -> commit
  -> return 202/201

Outbox relay:
  -> publish event
  -> wait confirm/ack
  -> mark outbox row published
```

### Rationale

HTTP is correct at user boundary.

RabbitMQ/Kafka is correct for downstream async integration.

Outbox solves DB/publish atomicity gap.

---

## 29. Example ADR 4 — Reviewer Assignment Workflow

### Context

Case review assignment requires eligibility checks, workload balancing, manual override, timeout escalation, reassignment, and audit trail.

### Options

1. RabbitMQ only
2. DB state machine + RabbitMQ command queues
3. Workflow engine

### Decision

Use DB state machine + RabbitMQ initially; evaluate workflow engine if process branches grow.

### Rationale

The business state belongs in DB, not queue.

RabbitMQ dispatches work:

```text
AssignReviewerCommand
NotifyReviewerCommand
EscalateUnassignedCaseCommand
```

State transitions remain explicit:

```text
PENDING_ASSIGNMENT -> ASSIGNED -> ACCEPTED -> REVIEW_IN_PROGRESS -> COMPLETED
```

If deadlines/compensation/human task branching become too complex, move orchestration to workflow engine.

---

## 30. Anti-Decision Smells

### 30.1 “We use Kafka because it scales.”

Scale of what?

- work dispatch?
- event replay?
- routing complexity?
- consumer parallelism?
- audit retention?

Kafka scale is not automatically the right shape for work queues.

### 30.2 “We use RabbitMQ because it is simpler.”

Simpler for what?

RabbitMQ is simple for routing/work queue, but not if you secretly need long-term event replay/data platform semantics.

### 30.3 “We will just use database table as queue.”

Valid at first. Dangerous if it becomes custom broker.

Watch DB load, locking, fanout, retry complexity.

### 30.4 “Async means reliable.”

No.

Async without confirms, ack discipline, idempotency, DLQ, observability, and runbook is just delayed failure.

### 30.5 “Queue is audit.”

No.

Queue is operational buffer. Audit needs durable queryable history.

### 30.6 “Exactly once will solve it.”

Usually wrong framing.

Design for:

- at-least-once transport;
- idempotent consumer;
- stable message IDs;
- business state guard;
- dedup store/inbox;
- compensating action.

---

## 31. Java Engineer Implementation Heuristics

### 31.1 If Using RabbitMQ

Use:

- quorum queues for critical durable work;
- publisher confirms;
- mandatory publish or alternate exchange;
- manual ack;
- bounded prefetch;
- DLQ/parking lot;
- stable message ID;
- idempotency table;
- outbox for DB-originated events;
- structured logs with correlation/causation;
- Spring listener factory per workload.

Avoid:

- auto ack for critical work;
- fire-and-forget publish;
- infinite requeue;
- unbounded queue;
- hidden RPC;
- one queue for everything;
- JPA entity payload.

### 31.2 If Using Kafka

Use:

- stable keys for ordering;
- schema governance;
- consumer group strategy;
- retry/DLQ topics;
- idempotent processing;
- offset commit discipline;
- replay-safe consumers;
- compaction only when semantically valid.

Avoid:

- putting commands in Kafka without ownership clarity;
- assuming topic order globally;
- using retention as compliance archive without governance;
- consumer side effects without idempotency.

### 31.3 If Using Database Queue

Use:

- explicit status;
- attempts;
- available_at;
- locked_until;
- indexes;
- batch polling;
- SKIP LOCKED where appropriate;
- cleanup/archival;
- metrics.

Avoid:

- unindexed polling;
- infinite retry;
- large payload rows;
- queue table sharing OLTP hot path at high volume;
- fanout implemented by copying rows everywhere.

### 31.4 If Using HTTP/gRPC

Use:

- explicit timeout;
- retry budget;
- circuit breaker;
- idempotency key for side-effecting APIs;
- 202 Accepted for async work;
- OpenAPI/Protobuf contract.

Avoid:

- long sync chains;
- unbounded retries;
- hidden distributed transaction;
- waiting for async downstream in user request path.

### 31.5 If Using Workflow Engine

Use:

- explicit workflow boundaries;
- activity idempotency;
- versioning strategy;
- compensation design;
- workflow visibility;
- integration events separate from internal workflow state.

Avoid:

- using workflow engine as generic message bus;
- embedding every small async task as workflow;
- ignoring deterministic/replay constraints;
- duplicating state in workflow and DB without reconciliation.

---

## 32. Decision Exercises

### Exercise 1 — Email Notification

Requirement:

- send email after case assigned;
- retry on SMTP failure;
- no replay requirement;
- duplicate email must be avoided.

Decision:

- RabbitMQ quorum queue for `SendEmailCommand`;
- idempotency key: `caseId + notificationType + recipient + version`;
- DLQ/parking lot;
- optional outbox from case service.

---

### Exercise 2 — Risk Analytics

Requirement:

- all case events feed risk model;
- multiple analytics consumers;
- replay last 90 days;
- high volume.

Decision:

- Kafka, or RabbitMQ Streams if scale/platform fit;
- event key = `caseId`;
- schema versioning;
- replay-safe consumers.

---

### Exercise 3 — User Reads Case Detail

Requirement:

- frontend needs current case detail;
- user waits;
- response under 300ms.

Decision:

- HTTP/gRPC query to case read API;
- do not use RabbitMQ RPC unless forced by architecture.

---

### Exercise 4 — Nightly Recalculation

Requirement:

- recalculate risk score for 500k cases;
- can process in parallel;
- retry individual failures;
- no long-term event history.

Decision:

- RabbitMQ work queues or database batch job depending architecture;
- if service distributed, RabbitMQ quorum queue / partitioned queues;
- use idempotent recalculation per case version;
- monitor backlog age.

---

### Exercise 5 — Appeal Window Deadline

Requirement:

- after notice issued, wait 30 days;
- if no appeal, close case;
- if appeal submitted, cancel closure;
- full audit required.

Decision:

- DB state machine + scheduler/outbox + RabbitMQ command, or workflow engine;
- do not rely only on delayed queue for legal deadline source of truth;
- deadline stored in DB;
- RabbitMQ dispatches closure command when due.

---

## 33. Decision Checklist

Before choosing RabbitMQ/Kafka/DB/HTTP/workflow, answer these:

### Message Type

- Is it command, event, job, notification, query, or workflow step?

### Consumption Model

- Consumed once?
- Consumed by many?
- Replayed later?
- Independent consumer progress?

### Routing

- Does producer know consumer?
- Is broker-side routing needed?
- Are wildcard/topic bindings valuable?

### Ordering

- Is ordering required?
- What scope?
- What breaks ordering?

### Delivery

- What happens on producer crash?
- What happens on consumer crash?
- What happens on timeout?
- What happens on duplicate?
- What happens on poison message?

### State

- Where is business state stored?
- Where is workflow state stored?
- Where is audit state stored?

### Retry

- Is failure transient or permanent?
- Where is retry count stored?
- How is DLQ handled?
- Who triages parking lot?

### Retention

- How long must data live?
- Is retention technical or legal?
- Can message be purged?

### Operations

- Who owns broker/log/table/workflow runtime?
- What dashboard exists?
- What alert exists?
- What runbook exists?

### Security

- What data is in payload?
- Who can publish/read/configure?
- Is replay restricted?
- Are DLQs protected?

---

## 34. Final Mental Models

### 34.1 RabbitMQ

RabbitMQ is best thought of as:

```text
A broker-side routing and work distribution system with strong queue semantics.
```

Modern RabbitMQ also has streams, but its core advantage remains topology-driven messaging.

### 34.2 Kafka

Kafka is best thought of as:

```text
A durable partitioned event log and event streaming platform.
```

Its core advantage is history and replay at scale.

### 34.3 Database Queue

Database queue is best thought of as:

```text
A transactional local work buffer, useful until it becomes a broker you accidentally maintain.
```

### 34.4 HTTP/gRPC

HTTP/gRPC is best thought of as:

```text
A synchronous request-response contract for immediate interaction.
```

### 34.5 Workflow Engine

Workflow engine is best thought of as:

```text
A durable state machine runtime for long-running processes.
```

---

## 35. What Top 1% Engineers Do Differently

They do not ask:

```text
RabbitMQ or Kafka?
```

They ask:

```text
Is this work or history?
Is this command or event?
Is replay essential?
What is the ordering scope?
Where is business state?
Where is audit state?
What happens on duplicate?
What happens on timeout?
What happens if consumer is down for 6 hours?
What happens if broker is partitioned?
Who owns DLQ at 3 AM?
```

Then they choose the simplest primitive that preserves the required invariants.

That is architectural maturity.

---

## 36. Summary

In this part, you learned:

- RabbitMQ is strongest for routing, queues, commands, jobs, retry, DLQ, and work distribution.
- Kafka is strongest for durable event history, replay, consumer groups, and event streaming/data platform.
- Database queue is valid for local transactional low/medium volume work, especially outbox.
- HTTP/gRPC is right for synchronous query/request-response boundaries.
- Workflow engines are right for long-running stateful orchestration.
- RabbitMQ Streams extend RabbitMQ into append-only log/replay territory, but do not erase Kafka’s event streaming platform advantage.
- Queue is not audit log.
- Outbox/inbox patterns matter regardless of broker choice.
- Technology decisions should be based on invariants, failure modes, and operational ownership.

---

## 37. References

- RabbitMQ official documentation — RabbitMQ as messaging and streaming broker, supported protocols.
- RabbitMQ official documentation — quorum queues as durable replicated queues based on Raft.
- RabbitMQ official documentation — RabbitMQ Streams, stream protocol, retention, offset/replay model.
- RabbitMQ official documentation — clustering is intended for LAN; Shovel/Federation are recommended for WAN broker links.
- RabbitMQ official documentation — Shovel and Federation plugins.
- Apache Kafka official documentation — topics, partitions, consumer groups, offset/replay model.
- Spring AMQP documentation — RabbitTemplate, listener containers, message conversion, confirms/returns.

---

# End of Part 31

Next part:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-32.md
```

**Part 32 — End-to-End Case Study: Regulatory Case Management Messaging Platform**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-30.md">⬅️ Part 30 — Migration, Refactoring, and Legacy RabbitMQ Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-32.md">Learn RabbitMQ Messaging & Streaming Mastery for Java Engineers — Part 32 ➡️</a>
</div>
