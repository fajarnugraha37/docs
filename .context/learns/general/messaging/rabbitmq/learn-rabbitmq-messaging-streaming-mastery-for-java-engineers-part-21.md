# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-21.md

# Part 21 — Flow Control, Backpressure, Memory, Disk, and Overload

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami RabbitMQ pada level desain, implementasi, dan operasi produksi.  
> Fokus part ini: bagaimana RabbitMQ bereaksi saat sistem lebih cepat menghasilkan message daripada memprosesnya, bagaimana backpressure bekerja, bagaimana memory/disk alarm melindungi broker, dan bagaimana mendesain aplikasi Java yang tidak membuat RabbitMQ menjadi tempat pembuangan beban tanpa batas.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Menjelaskan perbedaan antara **flow control**, **backpressure**, **rate limiting**, **throttling**, **consumer prefetch**, **memory alarm**, dan **disk alarm**.
2. Membaca gejala RabbitMQ overload dari Management UI, metrics, logs, dan client behavior.
3. Mendesain producer Java yang tidak menabrak broker saat RabbitMQ mulai melambat.
4. Mendesain consumer Java/Spring yang memakai prefetch sebagai budget concurrency, bukan angka asal.
5. Menentukan kapan queue growth adalah kondisi normal, kapan warning, dan kapan incident.
6. Menghindari anti-pattern seperti unbounded queues, unlimited prefetch, infinite requeue loop, large message abuse, dan DLQ tanpa ownership.
7. Membuat runbook operasional untuk memory alarm, disk alarm, publisher blocked, slow consumer, dan retry storm.
8. Mengaitkan overload RabbitMQ dengan state machine, workflow, dan regulatory defensibility.

---

## 2. Mental Model Utama: Broker Bukan Tempat Sampah Beban

RabbitMQ sering dipakai untuk “decouple service”. Itu benar, tetapi sering disalahartikan.

Decoupling bukan berarti:

> “Producer boleh publish sebanyak mungkin, consumer boleh lambat, dan broker akan menyelesaikan semuanya.”

Yang lebih akurat:

> RabbitMQ memberi buffer, routing, delivery semantics, dan koordinasi antar producer/consumer. Tetapi kapasitas broker tetap terbatas oleh CPU, memory, disk, network, replication cost, consumer speed, dan message lifecycle.

Kalau producer rate lebih besar dari consumer completion rate secara terus-menerus, hanya ada beberapa kemungkinan:

1. Queue depth terus naik.
2. Memory/disk pressure naik.
3. Broker mulai melakukan flow control.
4. Publisher mulai blocked atau timeout.
5. Latency end-to-end naik.
6. DLQ/retry queue membengkak.
7. Node crash, disk penuh, atau cluster kehilangan availability.

RabbitMQ bukan penghapus bottleneck. RabbitMQ hanya memindahkan, menunda, dan membuat bottleneck terlihat lebih eksplisit.

---

## 3. Istilah yang Sering Tertukar

### 3.1 Flow Control

**Flow control** adalah mekanisme RabbitMQ untuk memperlambat publishing connection ketika node atau internal component tidak bisa mengejar kecepatan publisher.

Contoh penyebab:

- queue process tertinggal,
- disk write tertinggal,
- quorum queue replication tertinggal,
- memory pressure,
- internal broker component overload,
- broker perlu melindungi dirinya dari pertumbuhan memory yang tidak terkendali.

RabbitMQ documentation menjelaskan flow control sebagai back-pressure mechanism yang diterapkan pada publishing connection agar memory tidak tumbuh liar ketika node component tertinggal dari publisher cepat.

### 3.2 Backpressure

**Backpressure** adalah sinyal balik dari downstream ke upstream bahwa downstream tidak mampu menerima workload lebih cepat.

Dalam RabbitMQ, backpressure bisa muncul pada beberapa level:

```text
consumer slow
  -> queue depth grows
    -> broker memory/disk pressure rises
      -> broker applies flow control / alarms
        -> publisher slows, blocks, times out, or fails
          -> application must decide: wait, shed load, retry later, or fail request
```

Backpressure yang baik harus **propagate** sampai boundary yang bisa mengambil keputusan.

Contoh boundary:

- HTTP API returns `429 Too Many Requests`,
- batch ingestion pauses,
- scheduled job slows,
- producer circuit breaker opens,
- upstream workflow enters `WAITING_FOR_CAPACITY`,
- non-critical notification dropped/deferred.

Backpressure yang buruk berhenti di broker, lalu broker menjadi korban.

### 3.3 Rate Limiting

**Rate limiting** adalah pembatasan rate secara eksplisit.

Contoh:

- maksimal 500 publish/second per service,
- maksimal 50 case evaluation jobs/second,
- maksimal 10 expensive notification jobs/tenant/second.

Rate limiting biasanya dilakukan di aplikasi, API gateway, scheduler, atau producer service.

### 3.4 Throttling

**Throttling** adalah memperlambat operasi berdasarkan sinyal tertentu.

Contoh:

- jika queue depth > 100_000, producer tidur 200 ms,
- jika publish confirm latency p95 > 2 detik, kurangi in-flight publish,
- jika blocked connection event terjadi, hentikan intake baru,
- jika DLQ rate naik, pause replay job.

Rate limiting bisa statis. Throttling biasanya adaptif.

### 3.5 Consumer Prefetch

**Prefetch** membatasi jumlah message yang boleh dikirim RabbitMQ ke consumer tetapi belum di-ack.

Ini bukan rate limit publisher.

Prefetch menjawab pertanyaan:

> “Berapa banyak work item yang boleh berada di tangan consumer ini pada saat yang sama sebelum broker menunggu ack?”

Prefetch adalah salah satu alat backpressure paling penting di consumer side.

### 3.6 Memory Alarm

**Memory alarm** terjadi ketika node RabbitMQ melewati memory watermark yang dikonfigurasi. Saat memory alarm aktif, RabbitMQ akan memblokir connections yang melakukan publish sampai alarm clear.

Default modern RabbitMQ menggunakan memory threshold sekitar 60% available RAM jika tidak dikonfigurasi secara eksplisit, menurut dokumentasi RabbitMQ memory threshold.

### 3.7 Disk Alarm

**Disk alarm** terjadi ketika free disk space turun di bawah batas yang dikonfigurasi. Saat disk alarm aktif, RabbitMQ akan memblokir publisher agar broker tidak terus menulis sampai disk habis.

Disk alarm sangat penting untuk persistent messages, quorum queues, streams, dan queue backlog besar.

---

## 4. Message Flow dengan Capacity Lens

Model dasar RabbitMQ:

```text
Producer
  -> TCP connection
  -> AMQP channel
  -> exchange
  -> routing/binding
  -> queue/stream
  -> delivery to consumer
  -> consumer processing
  -> ack/nack/reject
```

Capacity lens-nya:

```text
Producer rate
  <= broker ingress capacity
  <= routing + queue write capacity
  <= replication/disk capacity
  <= delivery capacity
  <= consumer processing capacity
  <= downstream dependency capacity
```

Sistem stabil jika dalam jangka panjang:

```text
average accepted publish rate <= average successfully acknowledged processing rate
```

Kalau tidak, backlog naik.

Queue depth yang naik bukan selalu masalah. Kadang queue memang buffer. Yang berbahaya adalah backlog naik tanpa rencana drain.

---

## 5. Backlog: Normal, Warning, atau Incident?

Queue depth harus dibaca dengan konteks.

### 5.1 Backlog Normal

Backlog bisa normal jika:

- workload memang bursty,
- consumer bisa mengejar setelah burst,
- age of oldest message masih dalam SLO,
- disk dan memory aman,
- publish confirm latency stabil,
- no redelivery storm,
- no DLQ spike,
- backlog growth punya batas natural.

Contoh:

```text
Nightly batch publishes 500k report jobs at 01:00.
Workers process 10k/minute.
Queue drains in 50 minutes.
SLO says report completed before 03:00.
This is acceptable.
```

### 5.2 Backlog Warning

Backlog warning jika:

- queue depth naik terus selama lebih dari window normal,
- consumer utilization turun,
- oldest message age mendekati SLO,
- publish confirm latency naik,
- unacked messages tinggi,
- consumer error rate naik,
- retry queue mulai tumbuh.

### 5.3 Backlog Incident

Backlog menjadi incident jika:

- oldest message age melampaui SLO,
- memory/disk alarm aktif,
- publishers blocked,
- DLQ spike tidak diketahui penyebabnya,
- redelivery loop terjadi,
- consumer crash loop,
- queue tidak bisa drain walau consumers sehat,
- disk free limit hampir tercapai,
- regulatory deadline/escalation bisa terlewat.

---

## 6. Ready vs Unacked: Dua Bentuk Backlog yang Berbeda

RabbitMQ queue biasanya menampilkan dua angka penting:

```text
Ready   = message ada di queue, belum dikirim ke consumer
Unacked = message sudah dikirim ke consumer, belum di-ack
```

### 6.1 Ready Tinggi

`ready` tinggi biasanya berarti:

- consumer terlalu sedikit,
- consumer tidak running,
- consumer kalah cepat,
- routing terlalu banyak ke satu queue,
- downstream dependency lambat,
- prefetch terlalu rendah untuk workload tertentu,
- message processing terlalu mahal,
- backlog memang sedang burst.

### 6.2 Unacked Tinggi

`unacked` tinggi biasanya berarti:

- prefetch terlalu besar,
- consumer mengambil terlalu banyak message,
- handler lambat,
- consumer stuck,
- thread pool saturated,
- DB/API downstream lambat,
- manual ack tidak dipanggil karena bug,
- worker crash belum terdeteksi,
- long-running job ditaruh sebagai single message.

### 6.3 Diagnostic Matrix

| Ready | Unacked | Kemungkinan |
|---:|---:|---|
| Tinggi | Rendah | Consumer kurang/tidak aktif, prefetch terlalu rendah, queue masuk lebih cepat daripada delivery |
| Rendah | Tinggi | Consumer sudah ambil message tapi lambat/stuck, prefetch terlalu besar |
| Tinggi | Tinggi | Sistem overload end-to-end, consumers lambat dan queue tetap tumbuh |
| Rendah | Rendah | Sehat, idle, atau traffic rendah |

---

## 7. Consumer Prefetch sebagai Budget, Bukan Tuning Acak

Prefetch adalah jumlah maksimum message unacked per consumer.

```java
channel.basicQos(50);
```

Artinya:

```text
RabbitMQ may deliver up to 50 unacked messages to this consumer.
After that, RabbitMQ waits for acknowledgements before delivering more.
```

RabbitMQ dokumentasi consumer prefetch menjelaskan bahwa RabbitMQ menerapkan prefetch per consumer sebagai extension dari AMQP `basic.qos` channel prefetch.

### 7.1 Prefetch = Concurrency Budget

Untuk Java engineer, prefetch harus dipahami seperti:

```text
prefetch = max in-flight work reserved by this consumer from broker
```

Kalau satu process punya 4 consumer dan masing-masing prefetch 50:

```text
max unacked in process = 4 * 50 = 200
```

Kalau 10 pod:

```text
cluster-wide unacked = 10 * 4 * 50 = 2,000
```

Itu berarti 2.000 message bisa berada di aplikasi tetapi belum selesai.

### 7.2 Prefetch Terlalu Rendah

Dampak:

- throughput rendah,
- consumer sering idle menunggu network round-trip,
- CPU tidak penuh,
- queue ready tinggi padahal consumer masih punya kapasitas.

Cocok untuk:

- expensive task,
- strict fairness,
- memory-heavy message,
- external dependency terbatas,
- ordering lebih penting.

### 7.3 Prefetch Terlalu Tinggi

Dampak:

- message menumpuk di memory consumer,
- unfair distribution,
- redelivery blast saat consumer crash,
- latency naik untuk message yang sudah dikirim ke consumer lambat,
- sulit menghentikan consumer dengan graceful,
- unacked tinggi.

### 7.4 Heuristik Awal Prefetch

Tidak ada angka universal. Tetapi untuk mulai:

| Workload | Starting Prefetch |
|---|---:|
| CPU-bound expensive job | 1 sampai jumlah worker thread |
| I/O-bound cepat | 20–200 |
| DB transaction sedang | 5–50 |
| Long-running job | 1 |
| Ordering sensitive | 1 |
| High-throughput small message | test 100–1000 dengan hati-hati |

Formula kasar:

```text
prefetch_per_consumer ≈ worker_concurrency_per_consumer * small_buffer_factor
```

Dengan:

```text
small_buffer_factor = 1 sampai 5
```

Contoh:

```text
Consumer process has 8 worker threads.
Each message takes 200 ms average.
Start prefetch = 16 or 32.
Measure p95 latency, unacked, throughput, memory, redelivery.
```

---

## 8. Publisher Flow Control

RabbitMQ bisa memperlambat publishing connection saat broker perlu melindungi dirinya.

Publisher biasanya melihat gejala seperti:

- publish call menjadi lambat,
- confirm latency naik,
- connection blocked callback terpanggil,
- publish timeout,
- application thread pool penuh,
- HTTP request ke producer service ikut lambat,
- batch job tidak selesai.

### 8.1 Flow Control Bukan Bug

Flow control adalah sinyal bahwa:

```text
Upstream pressure > broker/downstream capacity
```

Yang salah biasanya bukan karena RabbitMQ melakukan flow control. Yang salah adalah jika aplikasi tidak punya respons terhadap sinyal tersebut.

### 8.2 Java Publisher Harus Punya Bounded In-flight

Publisher confirm async tanpa batas bisa tetap overload.

Contoh buruk:

```java
while (true) {
    channel.basicPublish(exchange, routingKey, props, body);
}
```

Contoh prinsip yang lebih aman:

```text
publish only if in_flight_confirms < max_in_flight
wait or shed load when in-flight is full
observe confirm latency
react to blocked connection
```

Pseudo-code:

```java
Semaphore inFlight = new Semaphore(10_000);

void publish(Message msg) throws Exception {
    if (!inFlight.tryAcquire(500, TimeUnit.MILLISECONDS)) {
        throw new BackpressureException("publisher in-flight limit reached");
    }

    long seqNo = channel.getNextPublishSeqNo();
    pending.put(seqNo, msg.id());

    try {
        channel.basicPublish(exchange, routingKey, mandatory, props, msg.body());
    } catch (Exception e) {
        pending.remove(seqNo);
        inFlight.release();
        throw e;
    }
}

ConfirmCallback ack = (seqNo, multiple) -> {
    completePending(seqNo, multiple);
    releasePermits(seqNo, multiple);
};

ConfirmCallback nack = (seqNo, multiple) -> {
    markUnknownOrRetry(seqNo, multiple);
    releasePermits(seqNo, multiple);
};
```

### 8.3 Confirm Latency sebagai Backpressure Signal

Publisher confirms tidak hanya untuk reliability. Confirm latency juga merupakan sinyal kapasitas.

Jika confirm p95 naik:

- broker write path melambat,
- queue replication melambat,
- disk latency naik,
- queue process tertinggal,
- cluster/network pressure,
- publisher terlalu agresif.

Producer bisa merespons:

```text
if confirm_latency_p95 > threshold:
    reduce max_in_flight
    reduce publish rate
    reject non-critical intake
    pause replay/bulk publish
```

---

## 9. Blocked Connection Handling di Java

RabbitMQ Java client menyediakan listener untuk blocked/unblocked connection.

Contoh:

```java
Connection connection = factory.newConnection("case-service-publisher");

connection.addBlockedListener(new BlockedListener() {
    @Override
    public void handleBlocked(String reason) {
        log.warn("RabbitMQ connection blocked: {}", reason);
        publisherHealth.markBlocked(reason);
        intakeController.pauseNonCriticalTraffic();
    }

    @Override
    public void handleUnblocked() {
        log.info("RabbitMQ connection unblocked");
        publisherHealth.markUnblocked();
        intakeController.resumeGradually();
    }
});
```

Saat connection blocked:

- jangan terus menambah publish thread,
- jangan retry ketat tanpa delay,
- jangan menambah connection baru untuk “menghindari” block,
- jangan abaikan callback,
- propagate signal ke readiness/health atau intake control.

Yang benar:

```text
blocked connection = broker asks publisher to slow down
```

Bukan:

```text
blocked connection = create more connections
```

---

## 10. Memory Alarm

RabbitMQ menggunakan memory watermark untuk mencegah node menghabiskan RAM.

Saat memory alarm aktif:

- publisher connections diblokir,
- consumers tetap diharapkan bisa consume/ack agar memory turun,
- normal service resume setelah alarm clear,
- jika tidak clear, berarti workload atau konfigurasi bermasalah.

### 10.1 Penyebab Umum Memory Pressure

- queue backlog besar,
- banyak unacked messages,
- prefetch terlalu tinggi,
- message terlalu besar,
- terlalu banyak queues/channels/connections,
- management UI/API query berat,
- redelivery loop,
- consumer lambat,
- publisher terlalu cepat,
- plugins atau metrics cardinality berlebihan,
- stream/quorum workload dengan resource planning buruk.

### 10.2 Cara Berpikir Tentang Memory

Memory RabbitMQ bukan hanya isi message body.

Memory dipakai untuk:

- connection state,
- channel state,
- queue process state,
- metadata,
- indexes,
- unacked deliveries,
- routing state,
- message headers/properties,
- metrics,
- Erlang VM overhead,
- plugin state.

Maka, message kecil tetapi jumlah queue/connection/channel sangat besar tetap bisa berat.

### 10.3 Memory Alarm Runbook

Langkah triage:

1. Cek apakah memory alarm aktif pada node tertentu atau semua node.
2. Cek top queues by memory, ready, unacked.
3. Cek publishers yang masih mengirim traffic tinggi.
4. Cek consumer count dan consumer utilization.
5. Cek unacked messages per queue.
6. Cek redelivery rate.
7. Cek DLQ/retry queue growth.
8. Cek message size distribution.
9. Stop/pause non-critical publishers.
10. Scale consumers jika bottleneck consumer dan downstream mampu.
11. Kurangi prefetch jika unacked sangat tinggi.
12. Jangan purge tanpa business decision.

Emergency actions harus disesuaikan dengan data criticality:

| Action | Risiko |
|---|---|
| Pause publisher | Intake tertunda, data aman |
| Scale consumer | Bisa overload DB/downstream |
| Reduce prefetch | Throughput bisa turun, memory consumer/broker membaik |
| Purge queue | Data hilang |
| Move/replay DLQ | Bisa retry storm |
| Increase memory threshold | Bisa menunda crash, bukan memperbaiki root cause |

---

## 11. Disk Alarm

Disk alarm melindungi node dari kondisi disk penuh.

Disk pressure lebih berbahaya daripada memory pressure karena persistent messages, quorum queues, streams, WAL/segments, logs, dan node recovery bergantung pada disk.

### 11.1 Penyebab Umum Disk Pressure

- persistent queue backlog,
- quorum queue replicated logs,
- streams retention terlalu besar,
- consumers mati lama,
- DLQ tidak pernah diproses,
- retry queues tumbuh,
- message besar,
- log file tidak terotasi,
- disk sizing salah,
- node menerima terlalu banyak queue leaders,
- workload replay/bulk import tanpa throttle.

### 11.2 Disk Alarm Runbook

1. Cek free disk per node.
2. Cek queue/stream terbesar.
3. Cek growth rate disk.
4. Cek apakah backlog bisa drain.
5. Pause non-critical publisher.
6. Stop replay/bulk ingestion.
7. Scale consumer jika aman.
8. Untuk stream, evaluasi retention policy.
9. Untuk DLQ, buat remediation plan.
10. Tambah disk hanya jika capacity memang legitimate.
11. Jangan hapus data files manual tanpa prosedur RabbitMQ.

### 11.3 Disk Capacity Formula Kasar

Untuk queue persistent:

```text
disk_needed ≈ message_rate_per_sec
            * average_message_size_bytes
            * expected_backlog_seconds
            * replication_factor
            * overhead_factor
```

Untuk stream:

```text
disk_needed ≈ ingest_rate_per_sec
            * average_message_size_bytes
            * retention_seconds
            * replication_factor
            * overhead_factor
```

Gunakan `overhead_factor` konservatif:

```text
1.5 sampai 3.0
```

Karena overhead metadata, segments, indexes, filesystem, safety margin, dan operational spikes.

---

## 12. Queue Length Limit dan TTL sebagai Guardrail

RabbitMQ dapat memakai:

- message TTL,
- queue TTL,
- max length,
- max length bytes,
- dead-lettering saat limit tercapai,
- stream retention.

Guardrail ini bukan pengganti capacity planning, tetapi mencegah kerusakan tidak terbatas.

### 12.1 Message TTL

Message TTL menjawab:

> “Berapa lama message masih berguna?”

Contoh:

- notification email mungkin valid 24 jam,
- real-time cache invalidation mungkin valid 5 menit,
- compliance audit event mungkin tidak boleh TTL pendek,
- enforcement command mungkin harus tetap sampai diproses atau masuk exception workflow.

### 12.2 Max Queue Length

Max queue length menjawab:

> “Berapa banyak backlog yang boleh kita toleransi sebelum mengambil tindakan?”

Policy harus disesuaikan dengan semantics:

| Message Type | Max Length Strategy |
|---|---|
| Critical command | Jangan drop diam-diam; DLX/parking lot |
| Notification | Drop/defer mungkin acceptable |
| Audit event | Jangan drop; pakai stream retention/storage planning |
| Cache invalidation | TTL pendek bisa acceptable |
| Retry work | Limit + DLQ/parking lot wajib |

### 12.3 Danger: Limit Tanpa DLX

Jika queue limit menyebabkan message drop tanpa observability, kamu kehilangan data secara diam-diam.

Untuk sistem penting:

```text
limit breach should create explicit operational signal
```

Bukan:

```text
limit breach silently discards message
```

---

## 13. Large Messages: Broker Bukan Object Storage

Large message adalah salah satu penyebab klasik memory/disk/network pressure.

RabbitMQ cocok untuk message sebagai instruction/event/metadata, bukan payload raksasa.

Contoh buruk:

```json
{
  "messageType": "EvidenceSubmitted",
  "pdfBase64": "...200MB..."
}
```

Contoh lebih baik:

```json
{
  "messageId": "01J...",
  "messageType": "EvidenceSubmitted",
  "caseId": "CASE-2026-00019",
  "evidenceId": "EVD-8891",
  "objectRef": {
    "bucket": "case-evidence-prod",
    "key": "cases/CASE-2026-00019/evidence/EVD-8891.pdf",
    "sha256": "...",
    "sizeBytes": 209715200
  }
}
```

Rule of thumb:

> Put data needed for routing and processing decision in message. Put large binary/document content in object storage.

---

## 14. Retry Storm dan Redelivery Storm

Retry storm terjadi ketika failure membuat message diproses ulang terlalu cepat dan terlalu banyak.

Contoh:

```text
External API down
  -> consumer fails
  -> basicNack(requeue=true)
  -> RabbitMQ immediately redelivers
  -> consumer fails again
  -> CPU/log/network explode
  -> queue never drains
```

Ini bukan reliability. Ini self-DDoS.

### 14.1 Tanda Retry Storm

- redelivery rate tinggi,
- same message id muncul berkali-kali,
- logs penuh error yang sama,
- consumer CPU tinggi tapi throughput success rendah,
- downstream semakin overload,
- queue depth tidak turun,
- DLQ/retry queues tumbuh cepat.

### 14.2 Mitigasi

- jangan immediate requeue untuk transient external dependency,
- gunakan delayed retry / TTL retry queue,
- gunakan retry limit,
- gunakan circuit breaker,
- pause consumer untuk dependency yang down,
- classify error,
- DLQ/parking lot untuk poison,
- make retry observable.

---

## 15. Consumer Utilization

Consumer utilization memberi indikasi apakah queue bisa segera deliver ke consumers.

Interpretasi umum:

- rendah dengan ready tinggi: consumer mungkin saturated, prefetch penuh, network lambat, atau consumers tidak bisa menerima lebih banyak,
- tinggi dengan ready rendah: consumers mampu mengejar,
- rendah dengan ready rendah: queue idle atau consumer tidak dibutuhkan.

Jangan membaca satu metric secara terpisah. Gabungkan:

```text
ready
unacked
publish rate
deliver rate
ack rate
redelivery rate
consumer count
consumer utilization
oldest message age
confirm latency
memory/disk alarms
```

---

## 16. Publisher Rate vs Ack Rate

Stabilitas jangka panjang bisa dibaca dari:

```text
publish_rate <= ack_rate_successful
```

Jika:

```text
publish_rate > ack_rate
```

maka backlog naik.

Tetapi ack rate juga harus dipisahkan:

- ack success,
- nack/reject,
- redelivery,
- DLQ,
- retry.

Consumer yang cepat meng-ack tetapi gagal melakukan business effect adalah bug serius.

---

## 17. Designing Overload-Safe Producer

Producer production-grade harus punya:

1. publisher confirms,
2. bounded in-flight confirms,
3. blocked connection listener,
4. publish timeout,
5. retry with jitter,
6. idempotent message id,
7. rate limit per workload,
8. circuit breaker untuk broker unhealthy,
9. outbox untuk critical event,
10. load shedding untuk non-critical traffic,
11. metrics.

### 17.1 Producer Decision Table

| Signal | Producer Response |
|---|---|
| Confirm latency naik | Reduce in-flight/rate |
| Connection blocked | Pause non-critical publish |
| Return NO_ROUTE | Do not retry blindly; topology/routing issue |
| Nack from broker | Mark unknown/retry safely |
| Publish timeout | Treat as unknown outcome |
| Outbox backlog naik | Slow intake or scale relay |
| Broker unavailable | Store in outbox or fail fast depending criticality |

### 17.2 Java Backpressure-Aware Publisher Shape

```java
public interface ReliablePublisher {
    PublishResult publish(OutboundMessage message) throws BackpressureException, PublishFailedException;
}

public sealed interface PublishResult {
    record Accepted(String messageId) implements PublishResult {}
    record Rejected(String messageId, String reason) implements PublishResult {}
    record Unknown(String messageId, String reason) implements PublishResult {}
}
```

For critical data:

```text
Unknown != failed
Unknown means reconcile via outbox/idempotency
```

---

## 18. Designing Overload-Safe Consumer

Consumer production-grade harus punya:

1. manual ack,
2. bounded prefetch,
3. bounded worker pool,
4. bounded downstream concurrency,
5. timeout per handler,
6. retry classification,
7. DLQ/parking lot,
8. idempotency guard,
9. graceful shutdown,
10. metrics.

### 18.1 Consumer Concurrency Budget

Misalnya:

```text
pod_count = 8
consumers_per_pod = 2
worker_threads_per_consumer = 10
prefetch_per_consumer = 20
```

Maka:

```text
total consumers = 16
total worker capacity = 160
total max unacked = 320
```

Tanya:

1. Apakah DB sanggup 160 concurrent transactions?
2. Apakah external API sanggup?
3. Apakah memory pod sanggup menampung 320 message bodies?
4. Kalau satu pod crash, apakah redelivery 40 message acceptable?
5. Apakah ordering masih benar?

### 18.2 Jangan Jadikan Prefetch sebagai “Throughput Magic”

Naikkan prefetch hanya jika bottleneck-nya broker-to-consumer delivery/network latency.

Jika bottleneck-nya DB atau external API, menaikkan prefetch hanya memindahkan backlog ke memory consumer.

---

## 19. Admission Control: Keputusan Paling Penting

Admission control menjawab:

> “Apakah sistem boleh menerima work baru saat kapasitas downstream sedang tidak cukup?”

Tanpa admission control, producer akan terus menerima request dan menaruh semuanya ke RabbitMQ.

Contoh buruk:

```text
HTTP API always returns 202 Accepted
Message queue grows for 2 days
Case deadline missed
Operators discover backlog too late
```

Contoh lebih baik:

```text
If critical queue oldest_message_age > threshold:
    reject new non-critical intake
    return 429 or 503 with retry-after
    pause batch import
    alert owner
```

### 19.1 Admission Control Signals

- oldest message age,
- queue depth,
- publish confirm latency,
- broker alarms,
- consumer success rate,
- DLQ growth,
- downstream dependency health,
- outbox backlog,
- retry queue depth.

### 19.2 Business-Aware Admission

Tidak semua traffic sama.

| Traffic | Behavior Under Pressure |
|---|---|
| Legal deadline action | Preserve, prioritize, alert |
| User notification | Defer/drop depending requirement |
| Audit event | Preserve, possibly separate stream |
| Bulk import | Pause |
| Rebuild projection | Pause |
| Replay job | Pause/throttle |
| Low-priority analytics | Drop/defer |

---

## 20. Priority and Workload Segregation

Satu queue untuk semua workload membuat overload menyebar.

Contoh buruk:

```text
case.workflow.q
  contains:
    - legal deadline escalation
    - PDF OCR jobs
    - email notifications
    - analytics events
    - bulk migration tasks
```

Saat OCR lambat, escalation ikut telat.

Lebih baik:

```text
case.command.review.assign.q
case.command.escalation.trigger.q
case.job.ocr.q
case.notification.email.q
case.analytics.projection.q
case.audit.stream
```

Workload segregation memberi:

- independent prefetch,
- independent concurrency,
- independent DLQ,
- independent SLO,
- independent scaling,
- independent ownership,
- safer incident response.

---

## 21. Queue Growth dan SLO: Depth Tidak Cukup

Queue depth 10.000 bisa sehat atau buruk tergantung processing rate.

Gunakan age.

```text
estimated_drain_time = queue_depth / successful_ack_rate
```

Contoh:

```text
queue_depth = 100_000
ack_rate = 5_000/minute
estimated_drain_time = 20 minutes
SLO = 2 hours
=> OK
```

Contoh lain:

```text
queue_depth = 5_000
ack_rate = 10/minute
estimated_drain_time = 500 minutes
SLO = 30 minutes
=> incident
```

Metric penting:

```text
oldest_message_age
```

Jika tidak tersedia langsung untuk semua queue type/setup, implementasikan timestamp di message envelope:

```json
{
  "messageId": "...",
  "publishedAt": "2026-06-19T10:15:30Z",
  "occurredAt": "2026-06-19T10:15:20Z"
}
```

Consumer menghitung:

```text
processing_lag = now - publishedAt
business_lag = now - occurredAt
```

---

## 22. Memory vs Disk vs Latency Trade-off

Mengurangi memory pressure sering menaikkan disk I/O.

Persistent queues, quorum queues, dan streams memang memakai disk sebagai bagian dari safety model.

Trade-off:

| Strategy | Benefit | Cost |
|---|---|---|
| Persistent messages | Survive broker restart | Disk write latency |
| Quorum queue | Replicated safety | Network + disk + consensus cost |
| Stream retention | Replay/history | Disk capacity |
| Lower prefetch | Lower unacked/memory | Possibly lower throughput |
| Higher prefetch | Higher throughput | More unacked/memory/redelivery blast |
| Queue length limit | Bound damage | Possible data loss if wrong policy |
| TTL | Remove stale work | Can violate business requirement if misused |

Top engineer tidak bertanya “mana paling cepat?” saja.

Ia bertanya:

```text
What failure mode are we buying with this performance optimization?
```

---

## 23. RabbitMQ Streams dan Backpressure

Streams memiliki model berbeda dari queues.

Queue:

```text
message removed after ack
backlog = work not completed
```

Stream:

```text
message retained by policy
consumer offset indicates progress
lag = consumer position behind stream tail
```

Overload pada stream biasanya terlihat sebagai:

- consumer lag naik,
- disk retention pressure,
- producer confirm latency naik,
- super stream partition hot,
- replay jobs mengganggu live consumers,
- filtering tidak cukup selektif,
- offset commit lambat.

### 23.1 Stream Retention adalah Capacity Contract

Stream retention harus dirancang dari requirement:

```text
How long do we need replay?
How much data per second?
How many replicas?
What disk safety margin?
What happens if consumer is down longer than retention?
```

Jika consumer butuh replay 30 hari, tetapi retention hanya 7 hari, itu bukan RabbitMQ problem. Itu requirement mismatch.

---

## 24. Quorum Queue dan Overload

Quorum queue lebih aman untuk replicated durable work queue, tetapi safety punya cost.

Overload quorum queue bisa muncul karena:

- write harus direplikasi,
- leader disk lambat,
- follower tertinggal,
- consumer lambat,
- delivery-limit/requeue churn,
- queue terlalu panjang,
- terlalu banyak quorum queues,
- node placement tidak seimbang.

### 24.1 Quorum Queue Rule of Thumb

Gunakan quorum queue untuk critical durable work.

Jangan gunakan quorum queue sebagai dumping ground untuk:

- huge analytics backlog,
- large binary payload,
- infinite retry loop,
- unbounded notification backlog,
- long-term audit retention.

Untuk long-term replay/history, pertimbangkan streams.

---

## 25. Observability: Metrics yang Harus Ada

Minimal dashboard per queue:

- ready messages,
- unacked messages,
- total messages,
- publish rate,
- deliver rate,
- ack rate,
- redelivery rate,
- get rate kalau ada polling,
- consumer count,
- consumer utilization,
- memory used,
- disk used/estimated,
- oldest message age / processing lag,
- DLQ depth,
- retry queue depth.

Per node:

- memory used,
- memory watermark/alarm,
- disk free,
- disk alarm,
- file descriptors,
- sockets,
- Erlang processes,
- run queue,
- CPU,
- network I/O,
- disk I/O latency,
- GC/runtime metrics if exposed,
- connection/channel count.

Per producer:

- publish attempts,
- publish success confirmed,
- nack count,
- return count,
- confirm latency p50/p95/p99,
- in-flight confirms,
- blocked connection count/duration,
- outbox backlog,
- publish retry count.

Per consumer:

- deliveries received,
- ack success,
- nack/reject,
- processing latency,
- business success/failure,
- idempotency duplicate count,
- DB latency,
- external dependency latency,
- redelivery count,
- handler timeout,
- DLQ sends.

---

## 26. Alert Design

Bad alert:

```text
Queue depth > 10,000
```

Better alert:

```text
Queue oldest message age > 15 minutes for 5 minutes
AND ack rate < publish rate
AND consumer count > 0
```

Bad alert:

```text
Memory usage high
```

Better alert:

```text
RabbitMQ memory alarm active on any production node for > 1 minute
```

Bad alert:

```text
DLQ has messages
```

Better alert:

```text
DLQ depth increased by > 100 in 10 minutes
OR any critical workflow DLQ depth > 0
```

### 26.1 Alert by Semantics

| Queue | Alert Basis |
|---|---|
| Critical command | Any DLQ, oldest age, consumer down |
| Notification | backlog age, provider failure, DLQ growth |
| Audit stream | producer failure, confirm latency, retention risk |
| Retry queue | retry depth growth, max retry exceeded |
| Bulk job | drain time, not raw depth |

---

## 27. Overload Control Patterns

### 27.1 Bounded Producer In-flight

Limit outstanding confirms.

```text
producer cannot create infinite broker pressure
```

### 27.2 Bounded Consumer Prefetch

Limit outstanding unacked deliveries.

```text
consumer cannot absorb infinite work into memory
```

### 27.3 Workload Isolation

Separate critical and non-critical queues.

```text
bulk workload cannot starve deadline workload
```

### 27.4 Retry with Delay

Do not requeue immediately for transient dependency failure.

```text
failure does not become hot loop
```

### 27.5 Circuit Breaker

Stop work when downstream cannot handle it.

```text
consumer does not destroy dependency further
```

### 27.6 Admission Control

Reject/defer upstream work before broker collapses.

```text
capacity signal reaches business boundary
```

### 27.7 DLQ + Parking Lot

Separate recoverable failure from human remediation.

```text
poison messages do not block healthy flow
```

### 27.8 Stream for Audit/Replay

Do not use work queue as historical archive.

```text
history and work have different primitives
```

---

## 28. Java/Spring Implementation Patterns

### 28.1 Spring Boot Publisher Blocked Connection

With Spring AMQP, configure the underlying connection factory and observe connection events.

Conceptual shape:

```java
@Configuration
public class RabbitPublisherConnectionConfig {

    @Bean
    public CachingConnectionFactory rabbitConnectionFactory(
            RabbitProperties properties,
            PublisherBackpressureState backpressureState
    ) throws Exception {
        com.rabbitmq.client.ConnectionFactory rabbit = new com.rabbitmq.client.ConnectionFactory();
        rabbit.setHost(properties.getHost());
        rabbit.setPort(properties.getPort());
        rabbit.setUsername(properties.getUsername());
        rabbit.setPassword(properties.getPassword());
        rabbit.setVirtualHost(properties.getVirtualHost());

        CachingConnectionFactory factory = new CachingConnectionFactory(rabbit);
        factory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        factory.setPublisherReturns(true);
        factory.addConnectionListener(new ConnectionListener() {
            @Override
            public void onCreate(Connection connection) {
                // Depending on Spring AMQP version, access to native connection may differ.
                // The core idea: register blocked listener on the native RabbitMQ connection
                // or use available connection blocked events/listeners.
            }
        });
        return factory;
    }
}
```

Exact API details can differ by Spring AMQP version, but the design goal is stable:

```text
publisher service must know when broker blocks publishing
```

### 28.2 Listener Container Prefetch

```java
@Bean
SimpleRabbitListenerContainerFactory caseCommandListenerFactory(
        ConnectionFactory connectionFactory,
        MessageConverter messageConverter
) {
    SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setMessageConverter(messageConverter);
    factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
    factory.setConcurrentConsumers(4);
    factory.setMaxConcurrentConsumers(12);
    factory.setPrefetchCount(20);
    factory.setDefaultRequeueRejected(false);
    return factory;
}
```

Interpretation:

```text
max unacked ≈ active_consumers * prefetch
```

If max consumers = 12 and prefetch = 20:

```text
max unacked in this app instance = 240
```

If 6 app instances:

```text
max unacked across deployment = 1,440
```

That number must be intentional.

### 28.3 Consumer Handler Timeout

```java
public void handle(Message message, Channel channel, long tag) throws IOException {
    try {
        processingExecutor.submit(() -> process(message))
            .get(30, TimeUnit.SECONDS);

        channel.basicAck(tag, false);
    } catch (TimeoutException e) {
        // Do not requeue forever. Classify.
        channel.basicNack(tag, false, false); // DLQ
    } catch (TransientDependencyException e) {
        channel.basicNack(tag, false, false); // DLX to delayed retry
    } catch (ValidationException e) {
        channel.basicReject(tag, false); // DLQ/parking lot
    } catch (Exception e) {
        channel.basicNack(tag, false, false);
    }
}
```

Caveat: if you move processing to another thread, make sure channel usage remains safe. RabbitMQ channels should not be casually shared across threads. In Spring listener containers, prefer keeping ack operations within the listener thread unless you fully understand the threading model.

---

## 29. Case Study: Enforcement Lifecycle Overload

Domain:

```text
Case opened
Evidence submitted
Rule evaluation requested
Review assigned
Escalation deadline scheduled
Notification sent
Audit archived
```

### 29.1 Bad Topology

```text
case.all.q
```

Everything goes to one queue.

Failure:

1. Evidence OCR provider slows.
2. OCR messages pile up.
3. Review assignment messages wait behind OCR.
4. Deadline escalation messages wait behind review.
5. Notifications wait.
6. Queue depth high but operators do not know which workload matters.
7. Regulatory deadline missed.

### 29.2 Better Topology

```text
case.command.rule-evaluation.q      quorum
case.command.review-assignment.q    quorum
case.command.escalation.q           quorum
case.job.ocr.q                      quorum or classic depending criticality
case.notification.email.q           quorum/classic depending requirement
case.retry.rule-evaluation.5m.q
case.retry.rule-evaluation.30m.q
case.dlq.rule-evaluation.q
case.parking-lot.q
case.audit.stream                   stream
```

### 29.3 Overload Policy

| Workload | Under Pressure |
|---|---|
| Escalation | Preserve, prioritize, alert immediately |
| Review assignment | Preserve, scale consumers if DB can handle |
| OCR | Throttle/pause if provider slow |
| Email notification | Defer, lower priority |
| Audit stream | Preserve, monitor confirm latency/disk retention |
| Replay/projection rebuild | Pause first |

### 29.4 Workflow State Machine Reaction

Instead of hiding overload, workflow states can make it explicit:

```text
RULE_EVALUATION_REQUESTED
RULE_EVALUATION_QUEUED
RULE_EVALUATION_DELAYED_CAPACITY
RULE_EVALUATION_IN_PROGRESS
RULE_EVALUATION_FAILED_RETRYABLE
RULE_EVALUATION_FAILED_REQUIRES_REVIEW
RULE_EVALUATION_COMPLETED
```

This is defensible because an auditor can see:

- when work was accepted,
- when it was queued,
- when capacity delay happened,
- whether retries occurred,
- who/what approved manual remediation,
- whether deadlines were protected.

---

## 30. Incident Runbooks

### 30.1 Publisher Blocked

Symptoms:

- producer logs connection blocked,
- publish latency high,
- HTTP requests hanging,
- RabbitMQ alarm may be active.

Actions:

1. Identify blocked reason.
2. Check memory/disk alarms.
3. Pause non-critical producers.
4. Check top growing queues.
5. Check consumers and downstream dependencies.
6. Check retry/redelivery storm.
7. Reduce ingestion/replay.
8. Scale consumers only if downstream has capacity.
9. Keep critical outbox safe.
10. Resume gradually after unblocked.

Do not:

- create more publisher connections,
- retry tight loop,
- purge critical queues without approval,
- assume message was not published if timeout occurred.

### 30.2 Memory Alarm

Actions:

1. Check queues by ready/unacked.
2. Check unacked explosion.
3. Lower prefetch if necessary.
4. Stop stuck consumers gracefully if they hoard unacked messages.
5. Pause bulk producers.
6. Investigate large messages.
7. Drain queues.
8. Tune memory only after root cause.

### 30.3 Disk Alarm

Actions:

1. Stop non-critical publishing.
2. Stop replay/bulk jobs.
3. Identify largest queues/streams.
4. Check retention policies.
5. Drain if possible.
6. Add disk if workload requirement justifies it.
7. Archive/remove obsolete data only via safe mechanisms.
8. Review DLQ ownership.

### 30.4 Retry Storm

Actions:

1. Identify top redelivered message types.
2. Stop immediate requeue loop.
3. Disable/pause failing consumer if needed.
4. Route failures to delayed retry/DLQ.
5. Check downstream dependency.
6. Add circuit breaker.
7. Replay carefully after fix.

### 30.5 Slow Consumer

Actions:

1. Measure handler latency.
2. Separate CPU vs DB vs external API bottleneck.
3. Check prefetch/unacked.
4. Scale consumers only if bottleneck not downstream.
5. Split workload queues if mixed.
6. Optimize handler.
7. Add idempotency before aggressive parallelism.

---

## 31. Design Review Checklist

For each queue/stream, answer:

### 31.1 Workload Identity

- What message type enters this queue?
- Is it command, event, job, notification, reply, or audit record?
- Who owns the queue?
- What is the SLO?
- What is the maximum acceptable age?

### 31.2 Capacity

- Expected average publish rate?
- Expected peak publish rate?
- Expected average processing latency?
- Expected p95/p99 processing latency?
- Expected max backlog?
- Expected drain time after burst?

### 31.3 Backpressure

- What happens when queue depth exceeds threshold?
- What happens when oldest message age exceeds threshold?
- What happens when publisher is blocked?
- What happens when consumer is slow?
- What upstream traffic can be rejected/deferred?

### 31.4 Memory/Disk

- Average message size?
- Max message size?
- Persistent or transient?
- Queue type?
- Replication factor?
- Retention/TTL?
- Disk capacity requirement?

### 31.5 Consumer

- Manual ack?
- Prefetch?
- Consumer count?
- Max unacked deployment-wide?
- Handler timeout?
- Downstream concurrency limit?
- Idempotency guard?

### 31.6 Failure

- Retry strategy?
- DLQ?
- Parking lot?
- Poison message handling?
- Replay procedure?
- Alert owner?

### 31.7 Observability

- Dashboard exists?
- Alerts exist?
- Correlation id logged?
- Message age measured?
- Publisher confirm latency measured?
- DLQ growth measured?

---

## 32. Anti-Patterns

### 32.1 Unbounded Queue as Architecture

```text
We can accept unlimited requests because RabbitMQ will queue them.
```

Wrong. Unlimited queue means delayed failure.

### 32.2 Unlimited Prefetch

Consumer takes too many messages, crashes, then causes redelivery blast.

### 32.3 Immediate Requeue for External Failure

External API down, consumers keep retrying instantly, causing storm.

### 32.4 One Queue for All Work

Critical and non-critical workload share fate.

### 32.5 Large Payload in Message

Broker becomes slow object storage.

### 32.6 Ignoring Publisher Blocked

Producer keeps accepting business requests even though broker says stop.

### 32.7 Queue Depth Alert Without Semantics

Raw depth tells little without rate, age, and SLO.

### 32.8 Scaling Consumers Blindly

Adding consumers overloads DB/external dependency.

### 32.9 Purging as First Response

Purge may destroy business evidence.

### 32.10 Treating TTL as Safe Cleanup

TTL can silently remove still-needed business messages if requirement is wrong.

---

## 33. Mini Lab

Use the local lab from part 05.

### Lab 1 — Observe Ready Growth

1. Start RabbitMQ.
2. Create a quorum queue `lab.slow-consumer.q`.
3. Publish 10,000 small messages.
4. Start one consumer with 1 second processing time.
5. Observe ready count.
6. Compute estimated drain time.

Questions:

- Is queue depth itself bad?
- What is oldest message age?
- What is acceptable drain time?

### Lab 2 — Prefetch Impact

Run consumer with:

```text
prefetch=1
prefetch=10
prefetch=100
```

Observe:

- throughput,
- unacked,
- memory in app,
- fairness across two consumers,
- redelivery count if consumer is killed.

### Lab 3 — Retry Storm

1. Consumer always throws exception.
2. Use `basicNack(requeue=true)`.
3. Observe redelivery rate.
4. Replace with DLX delayed retry.
5. Compare broker behavior.

### Lab 4 — Publisher Confirm Latency

1. Enable confirms.
2. Publish with unbounded in-flight.
3. Publish with max in-flight 1,000.
4. Compare confirm latency and memory.

### Lab 5 — Disk Retention Thought Experiment

Calculate stream disk need:

```text
message_rate = 2,000/sec
average_size = 2 KB
retention = 7 days
replication_factor = 3
overhead_factor = 2
```

Rough result:

```text
2,000 * 2KB * 604,800 * 3 * 2
≈ 14.5 TB
```

Lesson:

> Retention is a storage contract, not a checkbox.

---

## 34. Master Heuristics

1. If producer is always faster than consumer, RabbitMQ only delays the incident.
2. Queue depth without age and rate is weak signal.
3. Oldest message age is often more important than message count.
4. Prefetch is a concurrency budget.
5. Large prefetch increases redelivery blast radius.
6. Publisher confirms are reliability and capacity signals.
7. Confirm latency rising is an early warning.
8. Blocked connection is not a bug; it is a backpressure signal.
9. Memory alarm means stop adding pressure.
10. Disk alarm means stop writing until you understand data growth.
11. Do not scale consumers if downstream is the bottleneck.
12. Do not immediate-requeue transient external failures.
13. DLQ without owner is just delayed data loss.
14. TTL must match business validity, not operational convenience.
15. Critical and non-critical workloads should not share one queue.
16. Streams need retention math.
17. Quorum queues need replication cost awareness.
18. Broker-side protection is last line of defense, not first.
19. Admission control belongs near the business boundary.
20. A production RabbitMQ design must define what happens under overload.

---

## 35. Summary

RabbitMQ overload management is not one feature. It is a chain of design decisions:

```text
publisher rate
  -> publisher confirms
  -> bounded in-flight
  -> broker flow control
  -> memory/disk alarms
  -> queue depth
  -> consumer prefetch
  -> handler latency
  -> downstream capacity
  -> ack/nack/retry/DLQ
  -> business SLO
```

The core lesson:

> RabbitMQ can buffer imbalance, but it cannot make imbalance disappear.

A top-tier engineer designs the whole pressure path:

- how fast work enters,
- how work is routed,
- how much can be outstanding,
- how failure retries behave,
- how critical work is protected,
- how overload is detected,
- how upstream is told to slow down,
- how operators safely recover.

If your RabbitMQ system has no answer for overload, it is not production-ready yet.

---

## 36. Sources and Further Reading

Official RabbitMQ documentation and primary references used for this part:

1. RabbitMQ — Flow Control: https://www.rabbitmq.com/docs/flow-control
2. RabbitMQ — Memory and Disk Alarms: https://www.rabbitmq.com/docs/alarms
3. RabbitMQ — Memory Threshold and Limit: https://www.rabbitmq.com/docs/memory
4. RabbitMQ — Consumer Prefetch: https://www.rabbitmq.com/docs/consumer-prefetch
5. RabbitMQ — Quorum Queues: https://www.rabbitmq.com/docs/quorum-queues
6. RabbitMQ Blog — Quorum Queues and Flow Control, Concepts: https://www.rabbitmq.com/blog/2020/05/04/quorum-queues-and-flow-control-the-concepts
7. RabbitMQ Blog — RabbitMQ 3.12 Performance Improvements: https://www.rabbitmq.com/blog/2023/05/17/rabbitmq-3.12-performance-improvements

---

## 37. Posisi dalam Seri

Selesai:

- Part 00 — Orientation, Mental Model, dan Scope RabbitMQ Modern
- Part 01 — Messaging Fundamentals yang Spesifik RabbitMQ
- Part 02 — AMQP 0-9-1 Deep Dive
- Part 03 — Exchange Routing Mastery
- Part 04 — Queue Semantics: Classic, Quorum, Stream
- Part 05 — Hands-on Local Lab
- Part 06 — Java Client Fundamentals tanpa Spring
- Part 07 — Publisher Reliability
- Part 08 — Consumer Reliability
- Part 09 — Retry, Dead Lettering, Poison Message, Parking Lot
- Part 10 — Spring AMQP Deep Dive
- Part 11 — Spring Boot Integration Patterns
- Part 12 — Message Contract Design untuk Java Systems
- Part 13 — Ordering, Concurrency, Partitioning, and Work Distribution
- Part 14 — RPC, Request/Reply, Correlation, Timeout
- Part 15 — Workflow, Saga, and Enforcement Lifecycle Modelling
- Part 16 — RabbitMQ Streams Mental Model
- Part 17 — RabbitMQ Stream Java Client
- Part 18 — Super Streams and Partitioned Streaming
- Part 19 — Stream Deduplication, Filtering, and Replay Patterns
- Part 20 — Quorum Queues Deep Dive
- Part 21 — Flow Control, Backpressure, Memory, Disk, and Overload

Berikutnya:

- Part 22 — Clustering, High Availability, Network Partitions


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-20.md">⬅️ Part 20 — Quorum Queues Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-22.md">Part 22 — Clustering, High Availability, Network Partitions ➡️</a>
</div>
