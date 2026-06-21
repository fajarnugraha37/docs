# Part 23 — Spring Integration and Enterprise Integration Patterns

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `23-spring-integration-enterprise-integration-patterns.md`  
> Status seri: Part 23 dari 35 — **belum selesai**  
> Berikutnya: `24-spring-batch-stateful-job-runtime.md`

---

## 0. Posisi Part Ini di Dalam Seri

Pada part sebelumnya kita sudah membahas messaging boundary: JMS, AMQP/RabbitMQ, Kafka, listener container, acknowledgement, retry, dead-letter, ordering, idempotency, dan transaction boundary.

Part ini tidak mengulang teori messaging tersebut. Fokusnya berbeda.

Part ini membahas **Spring Integration** sebagai runtime untuk menyusun **message-driven flow di dalam aplikasi Spring** berdasarkan pola **Enterprise Integration Patterns**.

Spring Integration sering disalahpahami sebagai:

1. message broker,
2. workflow engine,
3. BPM engine,
4. ETL platform penuh,
5. replacement Kafka/RabbitMQ/JMS,
6. atau sekadar cara lain menulis service method.

Mental model yang lebih tepat:

```text
Spring Integration adalah flow composition runtime di dalam aplikasi Spring.
Ia menghubungkan message source, channel, endpoint, transformer, router,
filter, splitter, aggregator, adapter, dan service activator untuk membangun
integration flow yang eksplisit, testable, dan bisa diobservasi.
```

Dokumentasi resmi Spring Integration menyatakan bahwa Spring Integration memperluas programming model Spring untuk mendukung Enterprise Integration Patterns, lightweight messaging di dalam aplikasi Spring, dan declarative adapters ke sistem eksternal.

---

## 1. Masalah yang Ingin Diselesaikan Spring Integration

Dalam sistem enterprise, sering ada logic seperti ini:

```text
Ambil file dari folder SFTP
→ parse CSV
→ validasi baris
→ split per record
→ enrich dengan data internal
→ filter record invalid
→ route berdasarkan jenis transaksi
→ panggil service domain
→ kirim hasil ke queue
→ arsipkan file
→ jika gagal, kirim ke error channel
```

Bisa saja semua ditulis dalam satu service method:

```java
public void processFile(Path file) {
    var rows = parse(file);
    for (Row row : rows) {
        if (!valid(row)) continue;
        var enriched = enrich(row);
        if (enriched.type().equals("A")) {
            serviceA.handle(enriched);
        } else {
            serviceB.handle(enriched);
        }
    }
    archive(file);
}
```

Untuk kasus kecil, ini cukup.

Tapi ketika flow menjadi besar, muncul masalah:

1. routing tersembunyi di nested `if`,
2. error path tidak eksplisit,
3. retry bercampur dengan domain logic,
4. sulit mengobservasi stage mana yang lambat,
5. sulit mengganti input adapter,
6. sulit mengetes flow per stage,
7. concurrency tersebar manual,
8. backpressure tidak jelas,
9. correlation id hilang,
10. flow tidak terbaca sebagai pipeline.

Spring Integration memberikan vocabulary untuk menjadikan flow tersebut eksplisit.

---

## 2. Mental Model Utama

Spring Integration terdiri dari tiga konsep fundamental:

```text
Message
Channel
Endpoint
```

### 2.1 Message

`Message<T>` adalah unit data yang bergerak di dalam flow.

Ia berisi:

```text
payload : data utama
headers : metadata operasional
```

Contoh:

```java
Message<OrderCreatedEvent> message = MessageBuilder
    .withPayload(orderCreatedEvent)
    .setHeader("correlationId", correlationId)
    .setHeader("tenantId", tenantId)
    .setHeader("source", "order-api")
    .build();
```

Mental model penting:

```text
Payload adalah apa yang diproses.
Header adalah bagaimana payload diproses, dilacak, dirutekan, dikorelasikan,
dan diamankan.
```

Kesalahan umum adalah memasukkan semua metadata ke payload. Akibatnya, setiap transformer, router, dan handler harus tahu struktur domain yang terlalu luas.

### 2.2 Channel

Channel adalah jalur komunikasi antar endpoint.

Channel bukan sekadar queue. Channel adalah abstraction boundary.

```text
Producer tidak harus tahu siapa consumer.
Consumer tidak harus tahu siapa producer.
Mereka hanya sepakat pada channel dan message contract.
```

### 2.3 Endpoint

Endpoint adalah komponen yang membaca dari channel, melakukan sesuatu, lalu mungkin mengirim ke channel lain.

Contoh endpoint:

1. service activator,
2. transformer,
3. filter,
4. router,
5. splitter,
6. aggregator,
7. inbound adapter,
8. outbound adapter,
9. gateway.

Jika digambar:

```text
          +-------------+       +---------------+       +-------------+
Input --->| Transformer |------>|    Router     |------>| Handler A   |
Channel   +-------------+       +-------+-------+       +-------------+
                                      |
                                      v
                                +-------------+
                                | Handler B   |
                                +-------------+
```

---

## 3. Spring Integration Bukan Message Broker

Spring Integration dapat memakai broker seperti RabbitMQ, Kafka, JMS, MQTT, Redis, atau HTTP sebagai adapter.

Tetapi Spring Integration sendiri bukan broker.

Perbedaannya:

| Aspek | Broker | Spring Integration |
|---|---|---|
| Fungsi utama | Transport antar proses | Flow composition dalam aplikasi |
| Contoh | Kafka, RabbitMQ, ActiveMQ | Channels, endpoints, adapters |
| Durability | Biasanya broker-level | Tergantung channel/adapter/store |
| Cross-service communication | Ya | Melalui adapter/broker |
| In-memory routing | Bukan fokus utama | Fokus utama |
| EIP vocabulary | Terbatas/berbeda | Native pattern vocabulary |

Mental model:

```text
Broker membawa message antar aplikasi.
Spring Integration menyusun perjalanan message di dalam aplikasi.
```

---

## 4. Kapan Spring Integration Cocok

Spring Integration cocok ketika aplikasi membutuhkan flow seperti:

1. file ingestion,
2. SFTP polling,
3. email inbound/outbound orchestration,
4. HTTP-to-message bridging,
5. queue-to-service routing,
6. protocol mediation,
7. message transformation,
8. enrichment,
9. split/aggregate,
10. lightweight orchestration antar adapter,
11. integration gateway untuk legacy system,
12. domain service invocation dari message pipeline,
13. reusable inbound/outbound adapter layer.

Contoh yang cocok:

```text
SFTP CSV inbound
→ split file menjadi record
→ validate
→ transform ke command
→ route berdasarkan command type
→ invoke application service
→ publish result
→ archive source file
```

Contoh lain:

```text
HTTP webhook inbound
→ verify signature
→ normalize payload
→ enrich tenant context
→ route event type
→ write inbox table
→ acknowledge fast
→ process async
```

---

## 5. Kapan Spring Integration Tidak Cocok

Spring Integration kurang cocok jika kebutuhan utamanya adalah:

1. long-running human workflow,
2. BPMN orchestration,
3. case lifecycle management dengan banyak state dan SLA,
4. complex approval process,
5. durable saga state machine lintas hari/bulan,
6. visual process governance,
7. process audit trail formal,
8. compensation workflow kompleks,
9. multi-actor task assignment.

Untuk kebutuhan tersebut, pertimbangkan:

1. Camunda/Zeebe,
2. Temporal,
3. Conductor,
4. custom state machine + outbox,
5. domain workflow engine internal.

Batas penting:

```text
Spring Integration kuat untuk message mediation dan integration pipeline.
Ia bukan pengganti workflow/case engine untuk proses bisnis panjang.
```

Jika flow mulai berisi:

```text
menunggu approval user
menunggu SLA 7 hari
reassign task
escalation matrix
manual review
legal hold
appeal lifecycle
multi-stage case transition
```

maka kemungkinan besar Spring Integration bukan pusat model yang tepat.

---

## 6. Enterprise Integration Patterns: Vocabulary Teknis

Spring Integration mengimplementasikan banyak pola dari Enterprise Integration Patterns.

Pola-pola penting:

| Pattern | Fungsi |
|---|---|
| Message Channel | Menghubungkan producer-consumer |
| Message Endpoint | Komponen pemroses message |
| Channel Adapter | Menghubungkan sistem eksternal ke channel |
| Messaging Gateway | Interface untuk masuk ke messaging layer |
| Transformer | Mengubah payload/message |
| Filter | Membuang atau meneruskan message berdasarkan predicate |
| Router | Mengirim message ke channel berbeda |
| Splitter | Memecah satu message menjadi banyak message |
| Aggregator | Menggabungkan banyak message menjadi satu |
| Enricher | Menambahkan data/header |
| Service Activator | Memanggil service method |
| Polling Consumer | Mengambil message secara berkala |
| Wire Tap | Menyalin message untuk observability/audit |
| Publish-Subscribe Channel | Broadcast ke beberapa subscriber |
| Queue Channel | Buffer message |
| Error Channel | Jalur error message |
| Claim Check | Menyimpan payload besar dan hanya mengirim referensi |
| Resequencer | Mengurutkan ulang message |
| Scatter-Gather | Fan-out lalu aggregate result |

Pattern-pattern ini penting bukan karena namanya, tetapi karena memberi bahasa yang lebih presisi saat mendesain flow.

Daripada berkata:

```text
Nanti service-nya parse lalu panggil service lain, kalau tipe A ke sini, tipe B ke sana.
```

Lebih jelas:

```text
Inbound adapter menerima file, splitter memecah record, transformer membentuk command,
router memilih channel berdasarkan command type, service activator memanggil application service,
dan error channel menangani failed message.
```

---

## 7. Message Anatomy

Sebuah message biasanya perlu membawa metadata berikut:

| Header | Tujuan |
|---|---|
| `correlationId` | Menghubungkan message-message dalam satu flow |
| `messageId` | Identitas message |
| `tenantId` | Multi-tenant boundary |
| `sourceSystem` | Asal message |
| `receivedAt` | Waktu diterima |
| `schemaVersion` | Versi payload contract |
| `causationId` | Event/command yang menyebabkan message ini |
| `traceId` | Distributed tracing |
| `userId` | Audit/security context jika relevan |
| `retryCount` | Retry semantics |
| `originalFileName` | File ingestion lineage |

Contoh:

```java
Message<PaymentInstruction> message = MessageBuilder
    .withPayload(instruction)
    .setHeader("correlationId", correlationId)
    .setHeader("tenantId", tenantId)
    .setHeader("schemaVersion", "v2")
    .setHeader("sourceSystem", "bank-sftp")
    .build();
```

Heuristic:

```text
Jika metadata dibutuhkan oleh banyak endpoint, taruh di header.
Jika data adalah bagian dari business object, taruh di payload.
```

---

## 8. Channel Types

Spring Integration menyediakan beberapa tipe channel dengan semantics berbeda.

### 8.1 DirectChannel

`DirectChannel` mengirim message ke handler dalam thread caller.

```text
caller thread → channel → handler
```

Karakteristik:

1. synchronous,
2. sederhana,
3. exception dilempar ke caller,
4. transaction context tetap sama,
5. cocok untuk flow internal yang harus atomic.

Contoh mental model:

```text
DirectChannel seperti method call yang dipisah oleh messaging abstraction.
```

Risiko:

1. handler lambat membuat caller lambat,
2. tidak ada buffering,
3. downstream failure memfailkan upstream.

### 8.2 ExecutorChannel

`ExecutorChannel` memakai executor untuk dispatch asynchronous.

```text
caller thread → channel → executor queue → worker thread → handler
```

Karakteristik:

1. asynchronous,
2. thread berganti,
3. transaction context tidak otomatis ikut,
4. security/MDC context perlu propagation,
5. error handling berbeda.

Risiko:

1. queue overload,
2. rejection,
3. ordering berubah,
4. lost context,
5. error tidak terlihat oleh caller.

### 8.3 QueueChannel

`QueueChannel` menyimpan message di queue internal.

```text
producer → queue channel → polling consumer
```

Karakteristik:

1. buffering,
2. decoupling producer-consumer,
3. polling-based consumption,
4. bisa membatasi kapasitas.

Risiko:

1. in-memory queue hilang saat restart,
2. backlog tersembunyi jika tidak dimonitor,
3. bukan pengganti durable broker kecuali memakai message store yang sesuai.

### 8.4 PublishSubscribeChannel

`PublishSubscribeChannel` mengirim message ke banyak subscriber.

```text
message → subscriber A
        → subscriber B
        → subscriber C
```

Cocok untuk:

1. audit tap,
2. metrics tap,
3. notification fan-out,
4. side effects yang independent.

Risiko:

1. satu subscriber gagal dapat mempengaruhi flow tergantung konfigurasi,
2. ordering antar subscriber perlu dipahami,
3. jika async, error handling harus eksplisit.

### 8.5 PriorityChannel

`PriorityChannel` mengurutkan message berdasarkan priority.

Cocok jika ada message urgent.

Risiko:

1. starvation,
2. sulit menjamin fairness,
3. priority sering disalahgunakan untuk business politics.

### 8.6 RendezvousChannel

`RendezvousChannel` mensinkronkan producer-consumer secara blocking handoff.

Jarang dipakai, tetapi penting untuk pola tertentu.

---

## 9. Endpoint Types

### 9.1 Service Activator

Service activator memanggil method aplikasi.

```java
@ServiceActivator(inputChannel = "paymentCommandChannel")
public void handle(PaymentCommand command) {
    paymentApplicationService.handle(command);
}
```

Gunakan untuk:

1. memanggil application service,
2. memproses command,
3. menjalankan side effect yang memang boundary service.

Jangan gunakan untuk:

1. menyembunyikan orchestration besar,
2. menggabungkan parsing, routing, retry, dan persistence sekaligus,
3. business workflow panjang.

### 9.2 Transformer

Transformer mengubah message/payload.

```text
RawWebhookPayload → NormalizedWebhookEvent
```

Prinsip:

```text
Transformer idealnya pure atau hampir pure.
Tidak melakukan side effect besar.
```

Transformer yang baik:

1. mudah dites,
2. tidak membuka transaction besar,
3. tidak memanggil external API tanpa alasan kuat,
4. tidak menyembunyikan retry.

### 9.3 Filter

Filter meneruskan atau membuang message.

Contoh:

```text
Hanya teruskan record yang valid secara format.
```

Pertanyaan desain:

1. Message yang ditolak dibuang?
2. Dikirim ke discard channel?
3. Dicatat sebagai rejected item?
4. Apakah rejection adalah error atau business outcome?

Jangan sembarangan `discard` tanpa audit jika flow regulatory/financial.

### 9.4 Router

Router memilih channel tujuan.

Contoh:

```text
if command.type == NEW_APPLICATION → newApplicationChannel
if command.type == RENEWAL         → renewalChannel
if command.type == APPEAL          → appealChannel
```

Router harus mudah diaudit.

Jika routing logic mulai kompleks, pertimbangkan memindahkannya ke policy object:

```java
public String route(ApplicationCommand command) {
    return routingPolicy.resolveChannel(command);
}
```

### 9.5 Splitter

Splitter memecah satu message menjadi banyak message.

Contoh:

```text
FilePayload → List<RecordPayload>
```

Pertanyaan penting:

1. Apakah setiap split item punya correlation id sama?
2. Apakah sequence number disimpan?
3. Apakah failure satu item menggagalkan semua file?
4. Apakah hasil harus diagregasi kembali?
5. Bagaimana audit lineage tiap item?

### 9.6 Aggregator

Aggregator menggabungkan banyak message menjadi satu.

Contoh:

```text
100 record result → FileProcessingSummary
```

Aggregator membutuhkan:

1. correlation strategy,
2. release strategy,
3. message store,
4. timeout strategy,
5. partial result policy.

Aggregator adalah salah satu komponen paling rawan bug karena ia menyimpan state.

Pertanyaan desain:

```text
Jika dari 100 message hanya 99 tiba, kapan aggregate dilepas?
Jika satu message gagal permanen, apakah summary tetap dibuat?
Jika aplikasi restart, apakah state aggregate hilang?
```

---

## 10. Adapter: Boundary ke Dunia Luar

Adapter menghubungkan channel dengan sistem eksternal.

Jenis adapter umum:

1. file,
2. FTP/SFTP,
3. HTTP,
4. JMS,
5. AMQP,
6. Kafka,
7. JDBC,
8. Mail,
9. TCP/UDP,
10. MQTT,
11. WebSocket,
12. Redis.

### 10.1 Inbound Adapter

Inbound adapter membawa data dari luar ke flow.

```text
SFTP folder → MessageChannel
```

Pertanyaan desain:

1. polling interval?
2. duplicate detection?
3. file lock?
4. partial file prevention?
5. idempotency?
6. archive/error directory?
7. backpressure?

### 10.2 Outbound Adapter

Outbound adapter mengirim message ke luar.

```text
MessageChannel → HTTP API
MessageChannel → SFTP folder
MessageChannel → RabbitMQ exchange
```

Pertanyaan desain:

1. timeout?
2. retry?
3. idempotency?
4. response handling?
5. circuit breaker?
6. audit?

### 10.3 Gateway

Gateway memberi interface Java untuk masuk ke flow.

Contoh:

```java
@MessagingGateway
public interface PaymentGateway {
    @Gateway(requestChannel = "paymentInputChannel")
    PaymentResult submit(PaymentCommand command);
}
```

Gateway berguna untuk menyembunyikan detail channel dari caller.

Namun jangan sampai gateway membuat flow terlihat seperti synchronous method biasa padahal di dalamnya asynchronous, retrying, buffering, atau eventually consistent.

---

## 11. Java DSL

Spring Integration Java DSL memungkinkan flow ditulis fluent.

Contoh konseptual:

```java
@Bean
IntegrationFlow inboundPaymentFlow(PaymentApplicationService paymentService) {
    return IntegrationFlow
        .from("rawPaymentChannel")
        .transform(rawPayloadToCommandTransformer())
        .filter(PaymentCommand::isValid, endpoint -> endpoint.discardChannel("invalidPaymentChannel"))
        .route(PaymentCommand::type, mapping -> mapping
            .channelMapping("CARD", "cardPaymentChannel")
            .channelMapping("BANK_TRANSFER", "bankTransferChannel")
            .defaultOutputChannel("unknownPaymentTypeChannel"))
        .get();
}
```

Contoh service activator flow:

```java
@Bean
IntegrationFlow cardPaymentFlow(PaymentApplicationService service) {
    return IntegrationFlow
        .from("cardPaymentChannel")
        .handle(service, "handleCardPayment")
        .channel("paymentResultChannel")
        .get();
}
```

Keuntungan DSL:

1. flow terlihat sebagai pipeline,
2. channel eksplisit,
3. endpoint mudah dikenali,
4. cocok untuk Java 8+ lambda,
5. lebih mudah dibanding XML untuk codebase modern.

Risiko DSL:

1. flow terlalu panjang,
2. business logic dimasukkan inline lambda,
3. sulit debug jika semua ada dalam satu bean,
4. channel string raw tersebar,
5. error flow tidak eksplisit.

Heuristic:

```text
DSL bagus untuk wiring flow.
Business logic tetap di class/method biasa yang bisa dites langsung.
```

---

## 12. XML vs Annotation vs Java DSL

Spring Integration historis kuat di XML, tetapi codebase modern biasanya memakai Java DSL.

| Style | Kelebihan | Risiko |
|---|---|---|
| XML | eksplisit, bagus untuk legacy, bisa dibaca non-Java | verbose, sulit refactor |
| Annotation | dekat dengan method handler | flow tersebar, channel implicit |
| Java DSL | pipeline terbaca, refactor-friendly | bisa menjadi lambda spaghetti |

Untuk sistem modern, rekomendasi umum:

```text
Gunakan Java DSL untuk flow composition.
Gunakan class biasa untuk transformer/router/policy/handler.
Gunakan annotation secukupnya untuk adapter/handler sederhana.
```

---

## 13. Error Handling Model

Spring Integration mendukung error handling dengan mengirim exception sebagai payload `ErrorMessage` ke channel error.

Namun error handling berbeda tergantung channel dan thread model.

### 13.1 Synchronous Flow

Jika menggunakan `DirectChannel`:

```text
caller thread → handler throws exception → exception kembali ke caller
```

Error bisa ditangani oleh caller atau advice/interceptor.

### 13.2 Asynchronous Flow

Jika menggunakan executor/asynchronous channel:

```text
caller thread → executor → worker thread throws exception
```

Caller tidak menerima exception langsung.

Error perlu diarahkan ke:

1. header `errorChannel`,
2. global `errorChannel`,
3. custom error flow,
4. retry advice,
5. DLQ/outbox/error table.

### 13.3 Global Error Channel

Pola umum:

```java
@Bean
IntegrationFlow errorFlow() {
    return IntegrationFlow
        .from("errorChannel")
        .handle(errorMessageHandler())
        .get();
}
```

Handler dapat membaca:

1. exception,
2. failed message,
3. headers,
4. correlation id,
5. tenant id,
6. retry count.

### 13.4 Error Handling Design Questions

Untuk setiap flow, jawab:

1. Error mana yang retryable?
2. Error mana yang permanent?
3. Error mana yang business rejection?
4. Apakah failed message perlu disimpan?
5. Apakah original payload cukup kecil untuk disimpan?
6. Apakah PII boleh ditulis ke error table?
7. Apakah operator bisa replay?
8. Apakah duplicate replay aman?
9. Bagaimana korelasi dengan source file/message?
10. Apakah error channel diamati dengan metrics?

---

## 14. Retry, Advice, and Recovery

Spring Integration dapat memakai advice chain untuk endpoint.

Retry cocok untuk error transient:

1. timeout sementara,
2. connection reset,
3. 503,
4. deadlock retryable,
5. rate limit dengan backoff.

Retry tidak cocok untuk:

1. validation error,
2. schema mismatch,
3. authorization denied,
4. missing required field,
5. permanent business rejection,
6. non-idempotent side effect tanpa key.

Pola yang benar:

```text
classify error
→ retry transient dengan bounded retry
→ recover permanent ke error channel/DLQ/error table
→ expose metric
→ support replay bila aman
```

Jangan membuat retry tanpa batas.

```text
Infinite retry adalah denial-of-service terhadap sistem sendiri.
```

---

## 15. Poller

Poller digunakan untuk endpoint polling.

Contoh sumber:

1. file directory,
2. SFTP directory,
3. JDBC table,
4. queue channel,
5. external polling API.

Parameter penting:

1. fixed rate/fixed delay,
2. max messages per poll,
3. transaction boundary,
4. task executor,
5. advice chain,
6. error handler,
7. trigger.

### 15.1 Polling Is a Capacity Control

Poller bukan sekadar scheduler.

Poller mengontrol:

1. berapa cepat data masuk,
2. berapa banyak message per batch,
3. apakah flow membanjiri downstream,
4. seberapa cepat backlog dikuras.

Contoh failure:

```text
SFTP poller membaca 10.000 file sekaligus.
Setiap file di-split menjadi 1.000 record.
Downstream database menerima 10 juta write.
Connection pool penuh.
Retry storm terjadi.
```

Desain yang lebih baik:

1. batasi `maxMessagesPerPoll`,
2. gunakan bounded executor,
3. gunakan idempotency,
4. gunakan staging table bila perlu,
5. observasi backlog,
6. gunakan rate limiting.

---

## 16. Splitter and Aggregator Deep Dive

Splitter dan aggregator sering terlihat sederhana, tetapi sangat berbahaya jika state semantics tidak jelas.

### 16.1 Splitter Metadata

Saat split, setiap child message sebaiknya punya:

1. correlation id,
2. sequence number,
3. sequence size,
4. source id,
5. parent message id.

Contoh:

```text
file-2026-06-21.csv
  record 1/500
  record 2/500
  ...
  record 500/500
```

### 16.2 Aggregator Release Strategy

Release strategy menjawab:

```text
Kapan aggregate dianggap lengkap?
```

Pilihan:

1. semua item tiba,
2. jumlah minimum tiba,
3. timeout tercapai,
4. external signal,
5. batch window selesai,
6. partial completion accepted.

### 16.3 Aggregator Message Store

Jika aggregator state hanya in-memory, restart dapat menghilangkan partial aggregate.

Untuk flow penting, pertimbangkan persistent message store.

Pertanyaan:

1. Apakah aggregator harus survive restart?
2. Apakah duplicate child message mungkin terjadi?
3. Apakah aggregator idempotent?
4. Apakah aggregate result deterministik?
5. Apakah partial group dibersihkan?

---

## 17. Routing Design

Router bisa menjadi pusat complexity.

Contoh buruk:

```java
.route(payload -> {
    if (payload.getType().equals("A") && payload.getAmount() > 1000 && payload.getCountry().equals("SG")) {
        return "highValueSingaporeChannel";
    }
    if (payload.getType().equals("B") && payload.isManualReview()) {
        return "manualReviewChannel";
    }
    // 200 lines more...
})
```

Masalah:

1. routing policy tersembunyi di DSL,
2. sulit dites,
3. sulit diaudit,
4. sulit dijelaskan ke BA/QA,
5. sulit diubah tanpa regression.

Lebih baik:

```java
@Component
public class PaymentRoutingPolicy {
    public String route(PaymentCommand command) {
        if (command.requiresManualReview()) {
            return Channels.MANUAL_REVIEW;
        }
        if (command.isHighValue()) {
            return Channels.HIGH_VALUE;
        }
        return Channels.STANDARD;
    }
}
```

Flow:

```java
@Bean
IntegrationFlow paymentRoutingFlow(PaymentRoutingPolicy policy) {
    return IntegrationFlow
        .from(Channels.PAYMENT_COMMAND)
        .route(PaymentCommand.class, policy::route)
        .get();
}
```

---

## 18. Channel Naming and Governance

Channel name adalah contract internal.

Gunakan nama yang stabil dan bermakna.

Contoh buruk:

```text
input
output
channel1
nextChannel
processChannel
```

Contoh lebih baik:

```text
rawPaymentInboundChannel
validatedPaymentCommandChannel
manualReviewPaymentChannel
paymentProcessingErrorChannel
paymentResultOutboundChannel
```

Untuk codebase besar, gunakan constants:

```java
public final class IntegrationChannels {
    public static final String RAW_PAYMENT_INBOUND = "rawPaymentInboundChannel";
    public static final String VALIDATED_PAYMENT_COMMAND = "validatedPaymentCommandChannel";
    public static final String PAYMENT_ERROR = "paymentProcessingErrorChannel";

    private IntegrationChannels() {}
}
```

Hindari string literal tersebar.

---

## 19. Transaction Boundary in Integration Flow

Transaction boundary dalam Spring Integration harus eksplisit.

Pertanyaan penting:

1. Apakah message receive dan database write dalam transaction yang sama?
2. Apakah external call dilakukan di dalam transaction?
3. Apakah message ack terjadi sebelum atau sesudah commit?
4. Apakah retry mengulang seluruh flow atau hanya satu endpoint?
5. Apakah split item diproses dalam transaction terpisah?
6. Apakah aggregator update state transactional?

### 19.1 Direct Flow with Transaction

```text
receive message
→ begin transaction
→ transform
→ service activator writes DB
→ commit
→ ack
```

Cocok jika flow pendek dan atomic.

### 19.2 External Side Effect Risk

Jangan sembarangan:

```text
begin DB transaction
→ write DB
→ call external API
→ commit DB
```

Jika external API sukses tapi DB commit gagal, state inconsistent.

Jika DB commit sukses tapi external API timeout, state ambiguous.

Pola lebih defensible:

```text
transaction:
  write business state
  write outbox/integration request
commit

async flow:
  read outbox
  call external API with idempotency key
  record result
```

---

## 20. Idempotency in Integration Flow

Integration flow hampir selalu harus idempotent karena:

1. file bisa diproses ulang,
2. broker bisa redeliver,
3. HTTP webhook bisa retry,
4. scheduler bisa overlap,
5. operator bisa replay,
6. app bisa crash setelah side effect.

Idempotency key dapat berasal dari:

1. external message id,
2. file name + row number + checksum,
3. business reference number,
4. tenant id + source system + external id,
5. command id,
6. outbox id.

Contoh table:

```sql
CREATE TABLE processed_integration_message (
    tenant_id        VARCHAR(64) NOT NULL,
    source_system    VARCHAR(64) NOT NULL,
    message_key      VARCHAR(256) NOT NULL,
    processed_at     TIMESTAMP NOT NULL,
    status           VARCHAR(32) NOT NULL,
    PRIMARY KEY (tenant_id, source_system, message_key)
);
```

Flow:

```text
message arrives
→ compute idempotency key
→ attempt insert processed key
→ if duplicate, skip or return previous result
→ process
→ update status
```

---

## 21. Observability

Integration flow harus bisa dijawab:

1. berapa message masuk per menit?
2. stage mana paling lambat?
3. channel mana backlog?
4. berapa message gagal?
5. error type apa paling banyak?
6. tenant mana terdampak?
7. source file/message mana gagal?
8. berapa retry?
9. berapa DLQ/error table?
10. berapa latency end-to-end?

### 21.1 Logging

Log minimal:

1. flow name,
2. channel name,
3. correlation id,
4. tenant id,
5. source id,
6. stage,
7. outcome,
8. latency,
9. error classification.

Jangan log payload penuh jika mengandung PII.

### 21.2 Metrics

Metrics umum:

```text
integration.messages.received
integration.messages.processed
integration.messages.failed
integration.messages.retried
integration.messages.discarded
integration.flow.duration
integration.channel.backlog
integration.error.by_type
```

Tag hati-hati:

```text
flow=paymentInbound
stage=validation
tenant_group=regulated
error_type=validation
```

Jangan pakai high-cardinality tag seperti raw message id, user id, file name lengkap, atau business reference individual.

### 21.3 Tracing

Trace penting untuk flow yang memanggil:

1. HTTP API,
2. database,
3. queue,
4. external system,
5. multiple internal services.

Pastikan correlation id diteruskan dari header message ke log dan outbound call.

---

## 22. Testing Spring Integration Flow

Testing perlu beberapa level.

### 22.1 Unit Test Pure Components

Transformer/router/filter/policy harus bisa dites tanpa Spring.

```java
@Test
void routesHighValuePaymentToManualReview() {
    var policy = new PaymentRoutingPolicy();
    var command = PaymentCommand.highValue();

    assertThat(policy.route(command)).isEqualTo(Channels.MANUAL_REVIEW);
}
```

### 22.2 Flow Slice Test

Tes flow dengan input channel dan mock handler.

Tujuan:

1. memastikan message masuk channel benar,
2. memastikan routing benar,
3. memastikan discard channel benar,
4. memastikan error channel benar.

### 22.3 Adapter Contract Test

Untuk adapter eksternal:

1. SFTP test container/mock server,
2. HTTP mock server,
3. embedded broker/testcontainers,
4. test file fixtures,
5. schema compatibility test.

### 22.4 Failure Test

Tes failure path:

1. invalid payload,
2. transformer exception,
3. handler timeout,
4. duplicate message,
5. retry exhausted,
6. partial aggregate timeout,
7. downstream unavailable,
8. app restart during processing.

---

## 23. Design Example: File Ingestion Flow

Kebutuhan:

```text
Aplikasi menerima file CSV dari SFTP.
Setiap file berisi application update.
Setiap row harus divalidasi, diubah menjadi command, diproses idempotent,
dan hasilnya diringkas. File invalid harus masuk error path, bukan hilang.
```

### 23.1 Flow Design

```text
SFTP inbound adapter
→ rawFileChannel
→ fileMetadataEnricher
→ csvSplitter
→ rawRecordChannel
→ recordValidator
→ validRecordChannel / invalidRecordChannel
→ recordToCommandTransformer
→ commandChannel
→ idempotencyFilter
→ applicationUpdateServiceActivator
→ recordResultChannel
→ aggregator
→ fileSummaryChannel
→ summaryPublisher
```

Error path:

```text
errorChannel
→ classify exception
→ persist integration_error
→ notify ops if severe
→ expose metric
```

### 23.2 Boundary Decisions

| Decision | Choice |
|---|---|
| Duplicate file | checksum + source filename |
| Duplicate row | file id + row number + business key |
| Invalid row | discard to invalid record channel with reason |
| Partial file success | allowed, with summary |
| External side effect | outbox, not direct call in same transaction |
| Replay | by file id or row id |
| Audit | per file and per row |

### 23.3 Data Model

```sql
CREATE TABLE integration_file_run (
    id              VARCHAR(64) PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL,
    source_system   VARCHAR(64) NOT NULL,
    file_name       VARCHAR(512) NOT NULL,
    checksum        VARCHAR(128) NOT NULL,
    status          VARCHAR(32) NOT NULL,
    total_rows      INT,
    success_rows    INT,
    failed_rows     INT,
    started_at      TIMESTAMP NOT NULL,
    completed_at    TIMESTAMP NULL
);
```

```sql
CREATE TABLE integration_record_result (
    file_run_id     VARCHAR(64) NOT NULL,
    row_number      INT NOT NULL,
    business_key    VARCHAR(128),
    status          VARCHAR(32) NOT NULL,
    error_code      VARCHAR(64),
    error_message   VARCHAR(1024),
    processed_at    TIMESTAMP,
    PRIMARY KEY (file_run_id, row_number)
);
```

### 23.4 Why This Is Better Than One Big Method

Karena setiap stage punya boundary jelas:

1. inbound,
2. metadata enrichment,
3. splitting,
4. validation,
5. transformation,
6. idempotency,
7. application service invocation,
8. aggregation,
9. error handling,
10. summary publication.

Setiap boundary bisa:

1. dites,
2. diamati,
3. diubah,
4. diberi retry,
5. diberi metric,
6. diberi policy.

---

## 24. Design Example: Webhook Normalization Flow

Kebutuhan:

```text
Aplikasi menerima webhook dari beberapa external provider.
Payload berbeda-beda, signature berbeda, event type berbeda.
Aplikasi ingin menormalisasi semua menjadi internal IntegrationEvent.
```

Flow:

```text
HTTP inbound controller
→ providerWebhookInputChannel
→ signatureVerificationFilter
→ providerRouter
→ providerATransformer / providerBTransformer / providerCTransformer
→ normalizedEventChannel
→ schemaVersionValidator
→ inboxWriter
→ asyncEventProcessor
```

Catatan penting:

1. HTTP controller jangan melakukan semua processing.
2. HTTP response harus cepat jika provider punya timeout pendek.
3. Signature verification adalah security boundary.
4. Normalized event harus punya schema version.
5. Inbox table memberi durability dan replay.
6. Processing async harus idempotent.

---

## 25. Spring Integration vs Spring Batch

Keduanya sering tertukar.

| Aspek | Spring Integration | Spring Batch |
|---|---|---|
| Fokus | message flow/integration | job processing stateful |
| Unit kerja | message | job/step/chunk |
| State runtime | optional/message store | JobRepository fundamental |
| Cocok untuk | routing, adapter, mediation | batch job besar, restartability |
| File processing | bisa | sangat kuat |
| Long-running batch | bukan fokus utama | fokus utama |
| Restart after failure | harus didesain | model bawaan |

Heuristic:

```text
Jika masalahnya adalah menghubungkan sistem dan merutekan message, Spring Integration cocok.
Jika masalahnya adalah job besar yang harus restartable, chunked, dan punya execution history,
Spring Batch lebih cocok.
```

Sering keduanya dipakai bersama:

```text
Spring Integration mendeteksi file masuk
→ Spring Batch menjalankan job pemrosesan file
→ Spring Integration publish hasil job
```

---

## 26. Spring Integration vs Camel

Apache Camel dan Spring Integration sama-sama punya EIP vocabulary.

| Aspek | Spring Integration | Apache Camel |
|---|---|---|
| Natural fit | Spring application internal flow | integration-heavy routing platform |
| Spring integration | sangat native | baik, tapi bukan Spring-native secara origin |
| DSL | Java DSL, XML, annotation | banyak DSL, route-centric |
| Component ecosystem | luas, Spring-centric | sangat luas untuk integration connectors |
| Mental model | Spring messaging/channel/endpoint | route/exchange/processor |
| Best fit | aplikasi Spring yang butuh integration layer | integration service/bus yang connector-heavy |

Tidak ada jawaban universal.

Jika aplikasi sudah Spring-heavy dan butuh flow internal, Spring Integration natural.

Jika sistem adalah integration hub dengan banyak protocol heterogen, Camel bisa lebih cocok.

---

## 27. Common Anti-Patterns

### 27.1 Flow Terlalu Panjang

Jika satu `IntegrationFlow` berisi 40 langkah, biasanya sudah sulit dirawat.

Pisahkan per semantic boundary:

```text
inboundFlow
validationFlow
routingFlow
processingFlow
errorFlow
```

### 27.2 Lambda Business Logic

Buruk:

```java
.handle((payload, headers) -> {
    // 200 lines of business logic
})
```

Lebih baik:

```java
.handle(applicationService, "handle")
```

### 27.3 Error Channel Tidak Didesain

Jika error path tidak eksplisit, production incident akan sulit diinvestigasi.

### 27.4 In-Memory Queue untuk Critical Work

`QueueChannel` in-memory bukan durable broker.

Jika message tidak boleh hilang, gunakan durable broker/store/table.

### 27.5 Tidak Ada Idempotency

Flow integration tanpa idempotency hampir pasti bermasalah saat retry/replay.

### 27.6 Channel Name Ambiguous

Channel bernama `input`, `output`, `process` membuat flow sulit dibaca.

### 27.7 Menjadikan Spring Integration Workflow Engine

Jika flow merepresentasikan long-running business process dengan user task, escalation, dan SLA, gunakan workflow/case model yang tepat.

### 27.8 Hidden Transaction Boundary

Developer mengira semua flow atomic, padahal ada executor channel yang memutus transaction context.

### 27.9 No Backpressure

Poller terlalu agresif, executor unbounded, downstream collapse.

### 27.10 Payload Logging

Payload mentah berisi PII/log rahasia ditulis ke log/error table.

---

## 28. Production Design Checklist

Sebelum memakai Spring Integration di production, jawab checklist ini.

### 28.1 Flow Contract

- [ ] Apa nama flow?
- [ ] Apa input source?
- [ ] Apa output sink?
- [ ] Apa payload contract?
- [ ] Apa header wajib?
- [ ] Apa schema version?
- [ ] Apa correlation id?

### 28.2 Channel Semantics

- [ ] Channel synchronous atau asynchronous?
- [ ] Ada queue/buffer?
- [ ] Queue bounded?
- [ ] Ordering penting?
- [ ] Transaction context melewati channel atau tidak?

### 28.3 Error Handling

- [ ] Error channel eksplisit?
- [ ] Retryable error diklasifikasi?
- [ ] Permanent error disimpan?
- [ ] Business rejection berbeda dari technical failure?
- [ ] Replay tersedia?
- [ ] Payload sensitif dilindungi?

### 28.4 Idempotency

- [ ] Idempotency key jelas?
- [ ] Duplicate input aman?
- [ ] Retry aman?
- [ ] Replay aman?
- [ ] External call punya idempotency key?

### 28.5 Observability

- [ ] Metrics per flow?
- [ ] Metrics per stage?
- [ ] Error metrics?
- [ ] Correlation id di log?
- [ ] Backlog terlihat?
- [ ] Latency end-to-end terlihat?

### 28.6 Operations

- [ ] Graceful shutdown aman?
- [ ] In-flight message policy jelas?
- [ ] Restart behavior jelas?
- [ ] Partial aggregate cleanup?
- [ ] Poller capacity aman?
- [ ] Operator tahu cara replay?

---

## 29. Mental Model Ringkas

Ingat model berikut:

```text
Message membawa payload + metadata.
Channel memisahkan producer dan consumer.
Endpoint melakukan satu jenis pekerjaan.
Adapter menghubungkan dunia luar.
Flow menyusun perjalanan message.
Error channel adalah jalur kegagalan.
Poller adalah capacity control.
Splitter/Aggregator membawa state risk.
Transaction boundary harus eksplisit.
Idempotency adalah syarat integration flow production.
```

Spring Integration menjadi kuat jika dipakai untuk:

```text
integration mediation
message routing
protocol adaptation
flow composition
lightweight orchestration
```

Ia menjadi berbahaya jika dipakai untuk:

```text
long-running business workflow
durable case lifecycle
human approval process
unbounded retry pipeline
implicit transaction magic
```

---

## 30. Hubungan dengan Part Berikutnya

Part berikutnya membahas:

```text
24-spring-batch-stateful-job-runtime.md
```

Spring Batch akan membahas runtime job yang stateful:

1. JobRepository,
2. JobInstance,
3. JobExecution,
4. StepExecution,
5. chunk processing,
6. restartability,
7. skip/retry,
8. partitioning,
9. large data processing,
10. operational recovery.

Perbedaan utama yang perlu dibawa dari part ini:

```text
Spring Integration mengatur flow message.
Spring Batch mengatur eksekusi job yang stateful dan restartable.
```

Keduanya bisa saling melengkapi, tetapi jangan disamakan.

---

## 31. Ringkasan Akhir

Spring Integration adalah tool yang sangat kuat jika digunakan dengan mental model yang benar.

Ia bukan magic pipeline builder dan bukan workflow engine. Ia adalah implementasi Spring-native dari Enterprise Integration Patterns untuk menyusun integration flow berbasis message, channel, endpoint, adapter, dan gateway.

Top 1% engineer tidak hanya tahu cara menulis `.from().transform().handle()`. Ia mampu menjawab:

1. channel ini synchronous atau asynchronous?
2. exception mengalir ke caller atau error channel?
3. transaction context masih sama atau sudah putus?
4. duplicate message aman atau tidak?
5. retry akan mengulang side effect atau tidak?
6. flow survive restart atau tidak?
7. aggregator state disimpan di mana?
8. poller bisa membanjiri downstream atau tidak?
9. operator bisa replay failed message atau tidak?
10. flow ini seharusnya Spring Integration, Spring Batch, atau workflow engine?

Jika pertanyaan-pertanyaan itu bisa dijawab secara eksplisit, Spring Integration menjadi alat engineering yang kuat, bukan sekadar abstraksi tambahan.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./22-spring-messaging-jms-amqp-kafka-boundary.md">⬅️ Part 22 — Spring Messaging: JMS, AMQP/RabbitMQ, Kafka, and Integration Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./24-spring-batch-stateful-job-runtime.md">Part 24 — Spring Batch Architecture: Stateful Job Runtime, Restartability, and Operational Recovery ➡️</a>
</div>
