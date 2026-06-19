# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-14.md

# Part 14 — RPC, Request/Reply, Correlation, Timeout, and Why It Is Dangerous

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Context: Java software engineer  
> Fokus: memahami request/reply di RabbitMQ secara benar, kapan layak dipakai, kapan harus dihindari, dan bagaimana membangun implementasi yang aman terhadap timeout, duplicate reply, lost reply, overload, dan hidden synchronous coupling.

---

## 0. Posisi Part Ini Dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi:

- RabbitMQ sebagai broker dan routing fabric.
- AMQP entity: exchange, queue, binding, channel, consumer.
- publisher reliability: confirm, return, mandatory publish.
- consumer reliability: ack, nack, reject, redelivery, prefetch.
- retry, DLQ, parking lot.
- Spring AMQP integration.
- message contract.
- ordering, concurrency, dan partitioning.

Part ini membahas pola yang sering tampak sederhana tetapi berbahaya:

```text
service A mengirim request message ke RabbitMQ
service B consume request
service B mengirim reply message
service A menunggu reply
```

Secara teknis, ini disebut:

- RPC over RabbitMQ
- request/reply messaging
- asynchronous transport with synchronous waiting
- message-based RPC

Masalahnya: banyak tim memakai pola ini karena ingin “microservice async”, tetapi perilakunya tetap synchronous dependency.

RabbitMQ memang bisa melakukan request/reply. Namun, kemampuan teknis bukan berarti selalu cocok secara arsitektur.

---

## 1. Core Mental Model

### 1.1 Request/Reply bukan eventing

Eventing:

```text
A says: sesuatu sudah terjadi
B may react
A tidak menunggu B
```

Request/reply:

```text
A asks: lakukan/berikan sesuatu
B must answer
A menunggu jawaban
```

Eventing memisahkan waktu hidup producer dan consumer.

Request/reply mengikat kembali waktu hidup requester dan responder.

Artinya, walaupun transport-nya RabbitMQ, arsitekturnya bisa tetap synchronous.

---

### 1.2 RabbitMQ request/reply adalah distributed call dengan message broker di tengah

Bentuk mentalnya:

```text
Requester
  publish request
    -> request exchange
      -> request queue
        -> responder consumer
          process
          publish reply
            -> reply-to address
              -> requester consumer receives reply
```

Yang sering disalahpahami:

```text
RabbitMQ tidak membuat RPC menjadi magically reliable, fast, atau loosely coupled.
```

RabbitMQ hanya memindahkan call path:

```text
HTTP:
A -> B

RabbitMQ request/reply:
A -> broker -> B -> broker -> A
```

Jumlah komponen yang bisa gagal bertambah.

---

## 2. Kapan Request/Reply Layak Dipakai

Request/reply bisa masuk akal bila:

1. requester butuh jawaban langsung untuk melanjutkan proses;
2. responder memang modelnya service query/command yang bounded;
3. request rate bisa dikendalikan;
4. latency tolerance lebih besar daripada HTTP/gRPC;
5. broker topology sudah menjadi integration boundary;
6. requester bisa menangani timeout/unknown outcome;
7. reply tidak menjadi sumber kebenaran permanen tanpa audit.

Contoh yang cukup masuk akal:

- internal validation service yang butuh jawaban cepat tetapi ingin buffering;
- legacy system adapter yang hanya bisa dipanggil lewat queue;
- controlled worker pool untuk CPU-heavy calculation;
- request to external gateway dengan backpressure kuat;
- batch orchestration internal yang tidak user-facing langsung.

---

## 3. Kapan Request/Reply Harus Dihindari

Hindari request/reply jika:

1. caller adalah HTTP endpoint user-facing dengan SLA ketat;
2. reply bisa lama atau tidak pasti;
3. responder melakukan human workflow;
4. caller tidak bisa retry dengan aman;
5. caller menganggap timeout berarti operasi gagal;
6. ada chain RPC panjang antar service;
7. pesan request/reply dipakai sebagai pengganti query API sederhana;
8. message broker dipakai hanya karena “semua harus async”.

Anti-pattern paling umum:

```text
Frontend -> API A -> RabbitMQ RPC -> Service B -> RabbitMQ RPC -> Service C -> DB
```

Ini bukan event-driven architecture.

Ini distributed synchronous chain dengan debugging lebih sulit.

---

## 4. Basic AMQP Request/Reply Building Blocks

AMQP menyediakan property penting:

- `replyTo`
- `correlationId`

Requester mengirim request dengan:

```text
replyTo = alamat reply queue
correlationId = id unik request
```

Responder membaca request lalu publish reply ke `replyTo` dengan `correlationId` yang sama.

Requester memakai `correlationId` untuk mencocokkan reply dengan request yang sedang menunggu.

---

## 5. Request/Reply Flow

```text
1. Requester membuat correlationId.
2. Requester menyiapkan pending future/map entry.
3. Requester publish request ke request exchange/queue.
4. Request message membawa replyTo dan correlationId.
5. Responder consume request.
6. Responder process request.
7. Responder publish reply ke replyTo.
8. Requester menerima reply.
9. Requester match correlationId.
10. Requester complete future.
11. Jika timeout, requester remove pending entry.
```

Invarian penting:

```text
correlationId adalah join key antara request dan reply.
```

Tanpa correlation id, request/reply di sistem concurrent akan rusak.

---

## 6. Reply Queue Strategy

Ada beberapa strategi reply queue.

---

### 6.1 Dedicated reply queue per requester service instance

```text
service-a.instance-123.reply.q
```

Kelebihan:

- mudah dipahami;
- requester punya consumer sendiri;
- cocok untuk long-lived service process.

Kekurangan:

- queue lifecycle harus dikelola;
- jika instance banyak, jumlah queue meningkat;
- reply bisa tertinggal jika requester mati;
- perlu TTL/exclusive/auto-delete policy.

---

### 6.2 Temporary exclusive auto-delete reply queue

Requester membuat queue sementara:

```text
queueDeclare("", false, true, true, args)
```

Artinya:

- server-generated name;
- non-durable;
- exclusive;
- auto-delete.

Kelebihan:

- lifecycle sederhana;
- cocok untuk client sementara.

Kekurangan:

- tidak cocok untuk high-throughput microservice jika dibuat per request;
- queue churn membebani broker;
- reply hilang jika connection mati;
- bukan durability boundary.

---

### 6.3 Shared reply queue

Semua requester instance consume dari queue yang sama.

Kelebihan:

- queue count rendah.

Kekurangan:

- reply bisa dikonsumsi instance yang tidak punya pending correlation id;
- butuh requeue/ignore strategy;
- berisiko reply hilang jika salah ack;
- sulit dibuat benar.

Umumnya hindari kecuali ada desain correlation dispatcher yang benar.

---

### 6.4 Direct Reply-to

RabbitMQ menyediakan direct reply-to sebagai mekanisme khusus untuk RPC ringan.

Requester memakai:

```text
replyTo = amq.rabbitmq.reply-to
```

Lalu consume dari pseudo-queue tersebut.

Kelebihan:

- tidak membuat queue reply eksplisit;
- overhead lebih rendah;
- cocok untuk request/reply ringan.

Kekurangan:

- bukan durable reply mechanism;
- reply hilang jika requester tidak tersedia;
- tidak cocok untuk reply yang harus bertahan;
- tetap perlu correlation, timeout, dan flow control.

Mental model:

```text
direct reply-to adalah optimization, bukan reliability upgrade.
```

---

## 7. Correlation ID Deep Dive

### 7.1 Apa yang harus menjadi correlation id?

Gunakan ID unik per request.

Contoh:

```text
rpc-01J9Z8ZBD2AJ3M6WQZ3AJ8BT5A
```

Bisa berupa:

- UUID;
- ULID;
- KSUID;
- application-generated request id.

Jangan memakai:

- user id;
- case id;
- order id;
- timestamp;
- routing key;
- thread id.

Karena satu entity bisa memiliki banyak request concurrent.

---

### 7.2 Correlation id vs message id

`messageId`:

```text
identitas message tertentu
```

`correlationId`:

```text
identitas conversation/request flow
```

Dalam request/reply:

```text
request.messageId      = id message request
request.correlationId  = id rpc request
reply.messageId        = id message reply
reply.correlationId    = request.correlationId
```

---

### 7.3 Correlation id vs trace id

`traceId` dipakai observability lintas service.

`correlationId` dipakai application-level matching.

Bisa sama dalam sistem kecil, tetapi lebih baik dipisahkan.

```text
traceId       = distributed tracing path
correlationId = request/reply join key
```

---

## 8. Timeout: Bagian Terpenting RPC

RPC tanpa timeout adalah resource leak.

Requester harus punya timeout untuk:

- membebaskan thread/future;
- menghapus pending correlation entry;
- mengembalikan error ke caller;
- mencegah memory leak;
- menjaga bounded concurrency.

---

### 8.1 Timeout tidak berarti responder gagal

Ini invarian sangat penting:

```text
Timeout means unknown, not failed.
```

Skenario:

```text
1. Requester publish request.
2. Responder process berhasil.
3. Responder publish reply.
4. Reply terlambat.
5. Requester sudah timeout.
```

Dari sudut requester:

```text
hasil tidak diketahui
```

Bukan:

```text
responder pasti gagal
```

Jika request menyebabkan side effect, retry setelah timeout bisa menggandakan side effect.

---

### 8.2 Timeout harus lebih kecil dari user-facing timeout

Jika HTTP endpoint menunggu RabbitMQ RPC:

```text
HTTP timeout = 5s
RabbitMQ RPC timeout = 2s atau 3s
```

Jangan:

```text
HTTP timeout = 5s
RabbitMQ RPC timeout = 30s
```

Karena caller sudah pergi, tapi backend masih menunggu.

---

### 8.3 Late reply handling

Late reply adalah reply yang tiba setelah requester timeout.

Requester harus:

1. melihat correlation id;
2. tidak menemukan pending request;
3. log as late/unknown reply;
4. ack reply;
5. tidak memproses ulang sebagai sukses.

Pseudo:

```java
PendingRequest pending = pendingRequests.remove(correlationId);
if (pending == null) {
    log.warn("late_or_unknown_reply correlationId={}", correlationId);
    ack(delivery);
    return;
}
pending.complete(reply);
ack(delivery);
```

---

## 9. Duplicate Reply

Duplicate reply bisa terjadi karena:

- responder publish reply lalu crash sebelum ack request;
- request redelivered;
- responder memproses ulang request;
- requester retry request;
- network uncertainty;
- publisher confirm timeout pada reply publish.

Requester harus tahan terhadap duplicate reply.

Strategy:

```text
first reply wins
subsequent replies ignored/logged
```

Requester pending map naturally supports this:

```java
PendingRequest pending = pendingRequests.remove(correlationId);
if (pending == null) {
    // duplicate or late reply
}
```

Responder juga sebaiknya idempotent terhadap request id.

---

## 10. Lost Reply

Reply bisa hilang jika:

- responder gagal publish reply;
- reply queue non-durable dan requester connection mati;
- direct reply-to consumer tidak tersedia;
- reply unroutable;
- responder tidak memakai mandatory publish/confirm;
- reply TTL expired.

Jika reply penting, responder harus memperlakukan reply publishing sebagai reliable publish:

- persistent reply if needed;
- durable reply queue if needed;
- publisher confirm;
- mandatory publish;
- return handling.

Namun, jika reply harus durable dan recoverable, pertanyaan arsitektur muncul:

```text
Apakah ini masih cocok sebagai RPC?
```

Sering kali lebih tepat memakai:

- command accepted response;
- asynchronous status event;
- query API untuk status;
- workflow state machine.

---

## 11. Request Message Contract

Request message minimal harus membawa:

```json
{
  "requestId": "rpc-01J9Z8ZBD2AJ3M6WQZ3AJ8BT5A",
  "requestType": "case.risk.evaluate.requested.v1",
  "schemaVersion": 1,
  "requestedAt": "2026-06-19T10:15:30Z",
  "requester": "case-service",
  "tenantId": "tenant-001",
  "payload": {
    "caseId": "CASE-2026-000123",
    "policyVersion": "risk-policy-2026.06"
  }
}
```

AMQP properties:

```text
messageId     = unique request message id
correlationId = requestId
replyTo       = reply address
contentType   = application/json
headers       = trace/context metadata
expiration    = optional request TTL
```

---

## 12. Reply Message Contract

Reply message minimal:

```json
{
  "requestId": "rpc-01J9Z8ZBD2AJ3M6WQZ3AJ8BT5A",
  "responseType": "case.risk.evaluate.completed.v1",
  "schemaVersion": 1,
  "respondedAt": "2026-06-19T10:15:31Z",
  "responder": "risk-service",
  "status": "SUCCESS",
  "payload": {
    "caseId": "CASE-2026-000123",
    "riskScore": 87,
    "riskBand": "HIGH"
  },
  "error": null
}
```

Untuk error:

```json
{
  "requestId": "rpc-01J9Z8ZBD2AJ3M6WQZ3AJ8BT5A",
  "responseType": "case.risk.evaluate.failed.v1",
  "schemaVersion": 1,
  "respondedAt": "2026-06-19T10:15:31Z",
  "responder": "risk-service",
  "status": "FAILED",
  "payload": null,
  "error": {
    "code": "POLICY_NOT_FOUND",
    "message": "Risk policy version is not available",
    "retryable": false
  }
}
```

Jangan mengirim Java exception serialized sebagai reply.

---

## 13. Request Expiration / TTL

AMQP message property `expiration` bisa dipakai agar request tidak diproses setelah terlalu lama.

Contoh:

```text
expiration = "3000"
```

Berarti message expired setelah sekitar 3 detik jika belum dikonsumsi.

Namun, hati-hati:

- TTL tidak menghentikan processing yang sudah dimulai consumer.
- TTL bukan distributed cancellation.
- TTL tidak menggantikan timeout di requester.
- Expired request bisa dead-letter jika topology mendukung.

Mental model:

```text
request timeout = requester waiting budget
message TTL     = broker queue waiting budget
handler timeout = responder processing budget
```

Ketiganya berbeda.

---

## 14. Responder Processing Semantics

Responder menerima request dari queue.

Urutan aman untuk side-effect-free query:

```text
consume request
compute response
publish reply with confirm
ack request
```

Untuk side-effecting command:

```text
consume request
check idempotency by requestId
execute transaction if not processed
store result
publish reply with confirm
ack request
```

Jika responder publish reply lalu crash sebelum ack request:

```text
request redelivered
reply may be published again
```

Karena itu duplicate reply harus dianggap normal.

---

## 15. Java Client Implementation: Minimal RPC Client

> Ini contoh edukatif. Untuk production, perlu lifecycle management, metrics, bounded executor, graceful shutdown, dan robust serialization.

```java
import com.rabbitmq.client.*;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;

public final class RabbitRpcClient implements AutoCloseable {
    private final Connection connection;
    private final Channel channel;
    private final String requestExchange;
    private final String requestRoutingKey;
    private final String replyQueue;
    private final Map<String, CompletableFuture<String>> pending = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    public RabbitRpcClient(
            Connection connection,
            String requestExchange,
            String requestRoutingKey
    ) throws Exception {
        this.connection = connection;
        this.channel = connection.createChannel();
        this.requestExchange = requestExchange;
        this.requestRoutingKey = requestRoutingKey;

        this.replyQueue = channel.queueDeclare(
                "",
                false,
                true,
                true,
                null
        ).getQueue();

        channel.basicConsume(replyQueue, false, this::handleReply, consumerTag -> {});
    }

    public CompletableFuture<String> call(String requestJson, Duration timeout) throws Exception {
        String correlationId = UUID.randomUUID().toString();
        CompletableFuture<String> future = new CompletableFuture<>();
        pending.put(correlationId, future);

        scheduler.schedule(() -> {
            CompletableFuture<String> removed = pending.remove(correlationId);
            if (removed != null) {
                removed.completeExceptionally(new TimeoutException(
                        "RPC timeout correlationId=" + correlationId
                ));
            }
        }, timeout.toMillis(), TimeUnit.MILLISECONDS);

        AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
                .contentType("application/json")
                .deliveryMode(2)
                .messageId(UUID.randomUUID().toString())
                .correlationId(correlationId)
                .replyTo(replyQueue)
                .expiration(String.valueOf(timeout.toMillis()))
                .build();

        try {
            channel.basicPublish(
                    requestExchange,
                    requestRoutingKey,
                    true,
                    props,
                    requestJson.getBytes(StandardCharsets.UTF_8)
            );
        } catch (Exception e) {
            pending.remove(correlationId);
            future.completeExceptionally(e);
            throw e;
        }

        return future;
    }

    private void handleReply(String consumerTag, Delivery delivery) throws java.io.IOException {
        String correlationId = delivery.getProperties().getCorrelationId();
        String body = new String(delivery.getBody(), StandardCharsets.UTF_8);

        CompletableFuture<String> future = pending.remove(correlationId);
        if (future == null) {
            // late, duplicate, or unknown reply
            channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
            return;
        }

        future.complete(body);
        channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
    }

    @Override
    public void close() throws Exception {
        try {
            channel.close();
        } finally {
            scheduler.shutdownNow();
        }
    }
}
```

Masalah production yang belum selesai pada contoh ini:

- publish belum memakai publisher confirm;
- channel publish dan consume digabung;
- no return listener untuk unroutable request;
- no bounded pending request count;
- no metrics;
- no tracing;
- no reconnect lifecycle;
- no structured error response.

---

## 16. Java Client: Bounded RPC Client Design

Production RPC client harus punya limit:

```text
maxInFlightRequests
requestTimeout
publishTimeout
maxRequestBytes
maxReplyBytes
```

Kenapa?

Karena tanpa limit:

```text
slow responder -> pending map grows -> heap pressure -> requester crash
```

Pseudo:

```java
Semaphore inFlight = new Semaphore(maxInFlight);

public CompletableFuture<Response> call(Request request) {
    if (!inFlight.tryAcquire()) {
        return failedFuture(new RejectedExecutionException("too many in-flight RPC requests"));
    }

    CompletableFuture<Response> f = doCall(request);
    f.whenComplete((r, e) -> inFlight.release());
    return f;
}
```

Ini bukan detail kecil.

Ini adalah backpressure boundary.

---

## 17. Responder Java Skeleton

```java
import com.rabbitmq.client.*;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

public final class RiskEvaluationResponder {
    private final Channel consumeChannel;
    private final Channel publishChannel;

    public RiskEvaluationResponder(Connection connection) throws Exception {
        this.consumeChannel = connection.createChannel();
        this.publishChannel = connection.createChannel();
        this.publishChannel.confirmSelect();
    }

    public void start(String requestQueue) throws Exception {
        consumeChannel.basicQos(20);

        consumeChannel.basicConsume(requestQueue, false, (tag, delivery) -> {
            long deliveryTag = delivery.getEnvelope().getDeliveryTag();
            String correlationId = delivery.getProperties().getCorrelationId();
            String replyTo = delivery.getProperties().getReplyTo();

            try {
                if (replyTo == null || replyTo.isBlank()) {
                    // invalid RPC request; do not requeue endlessly
                    consumeChannel.basicReject(deliveryTag, false);
                    return;
                }

                String requestJson = new String(delivery.getBody(), StandardCharsets.UTF_8);
                String responseJson = handle(requestJson, correlationId);

                AMQP.BasicProperties replyProps = new AMQP.BasicProperties.Builder()
                        .contentType("application/json")
                        .deliveryMode(2)
                        .messageId(UUID.randomUUID().toString())
                        .correlationId(correlationId)
                        .build();

                publishChannel.basicPublish(
                        "",
                        replyTo,
                        true,
                        replyProps,
                        responseJson.getBytes(StandardCharsets.UTF_8)
                );

                publishChannel.waitForConfirmsOrDie(5_000);
                consumeChannel.basicAck(deliveryTag, false);

            } catch (Exception e) {
                // Do not blindly requeue; classify failure in real code.
                consumeChannel.basicNack(deliveryTag, false, false);
            }
        }, tag -> {});
    }

    private String handle(String requestJson, String correlationId) {
        return "{\"requestId\":\"" + correlationId + "\",\"status\":\"SUCCESS\"}";
    }
}
```

Production notes:

- classify exceptions;
- validate request schema;
- use idempotency store for side effects;
- avoid synchronous `waitForConfirmsOrDie` in high-throughput path unless acceptable;
- handle returned reply if reply is unroutable;
- do not requeue invalid request forever.

---

## 18. Spring AMQP Request/Reply

Spring AMQP supports request/reply through `RabbitTemplate`.

Conceptually:

```java
Object reply = rabbitTemplate.convertSendAndReceive(
    exchange,
    routingKey,
    request
);
```

But this simplicity hides:

- reply queue strategy;
- correlation management;
- timeout;
- reply converter;
- error response handling;
- late reply behavior;
- blocked caller thread;
- backpressure.

---

### 18.1 Spring RabbitTemplate example

```java
@Configuration
class RabbitRpcConfig {

    @Bean
    RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setReplyTimeout(3_000);
        template.setMandatory(true);
        template.setMessageConverter(new Jackson2JsonMessageConverter());
        return template;
    }
}
```

Caller:

```java
@Service
class RiskRpcClient {
    private final RabbitTemplate rabbitTemplate;

    RiskRpcClient(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    RiskEvaluationReply evaluate(RiskEvaluationRequest request) {
        Object reply = rabbitTemplate.convertSendAndReceive(
                "case.command.x",
                "risk.evaluate",
                request,
                message -> {
                    message.getMessageProperties().setMessageId(UUID.randomUUID().toString());
                    message.getMessageProperties().setCorrelationId(request.requestId());
                    message.getMessageProperties().setContentType("application/json");
                    message.getMessageProperties().setExpiration("3000");
                    return message;
                }
        );

        if (reply == null) {
            throw new RpcTimeoutException("risk evaluation RPC timeout");
        }

        return (RiskEvaluationReply) reply;
    }
}
```

---

### 18.2 Spring listener responder

```java
@Component
class RiskRpcResponder {

    @RabbitListener(queues = "risk.evaluate.request.q")
    public RiskEvaluationReply evaluate(RiskEvaluationRequest request) {
        try {
            return RiskEvaluationReply.success(
                    request.requestId(),
                    87,
                    "HIGH"
            );
        } catch (KnownBusinessException e) {
            return RiskEvaluationReply.failed(
                    request.requestId(),
                    e.code(),
                    false
            );
        }
    }
}
```

Spring can send the return value as reply if request properties include reply-to.

But for serious production systems, prefer explicit error contract over letting framework exception semantics leak.

---

## 19. Direct Reply-To in Spring

Spring AMQP can use direct reply-to internally for request/reply patterns.

Important mental model:

```text
Direct reply-to optimizes reply queue management.
It does not remove timeout, duplicate reply, late reply, or coupling concerns.
```

Do not let framework convenience hide architecture risk.

---

## 20. Error Semantics

There are at least four kinds of errors:

### 20.1 Publish error

Requester could not publish request.

Possible causes:

- exchange missing;
- connection closed;
- broker blocked;
- unroutable request;
- publisher confirm failed.

Outcome:

```text
request likely not accepted
```

But if uncertainty exists, treat as unknown.

---

### 20.2 Timeout

Requester did not receive reply in time.

Outcome:

```text
unknown
```

Not safe to assume failure.

---

### 20.3 Business failure reply

Responder processed request and returned domain-level failure.

Example:

```text
POLICY_NOT_FOUND
CASE_NOT_ELIGIBLE
VALIDATION_FAILED
```

Outcome:

```text
known failure
```

---

### 20.4 System failure reply

Responder failed due to infrastructure or dependency.

Example:

```text
DB_TIMEOUT
EXTERNAL_SERVICE_UNAVAILABLE
MODEL_ENGINE_OVERLOADED
```

Outcome:

```text
known retryable/non-retryable system condition depending on contract
```

---

## 21. Designing Error Reply Contract

Avoid:

```json
{
  "exception": "java.lang.NullPointerException..."
}
```

Prefer:

```json
{
  "requestId": "rpc-123",
  "status": "FAILED",
  "error": {
    "code": "RISK_POLICY_NOT_FOUND",
    "category": "BUSINESS",
    "retryable": false,
    "message": "Risk policy is not available for requested version"
  }
}
```

Do not expose stack traces in message contracts.

---

## 22. Request/Reply and HTTP APIs

Common architecture:

```text
HTTP POST /cases/{id}/risk-evaluation
  -> API service
    -> RabbitMQ RPC
      -> risk service
        -> reply
  -> HTTP response
```

This can work if:

- strict timeout;
- bounded in-flight requests;
- responder capacity is known;
- fallback behavior is defined;
- user-facing SLA allows it.

But often better:

```text
HTTP POST /cases/{id}/risk-evaluation
  -> persist request state
  -> publish command
  -> return 202 Accepted

Client polls / subscribes to status
```

This is better when processing is:

- long-running;
- variable latency;
- dependent on external systems;
- auditable;
- human-in-the-loop;
- not needed immediately.

---

## 23. Request/Reply vs Command Accepted Pattern

RPC:

```text
send request -> wait -> get result
```

Command accepted:

```text
send command -> return accepted -> process async -> emit result event/status
```

RPC is suitable for:

```text
bounded quick operation
```

Command accepted is suitable for:

```text
workflow state change
```

For enforcement/case management systems, command accepted often gives better auditability and operational safety.

---

## 24. Request/Reply and State Machines

If a request changes case state, avoid hiding it as RPC.

Bad:

```text
case-service asks risk-service via RPC
risk-service changes something
case-service receives reply and updates state
```

Better:

```text
case-service records RiskEvaluationRequested state
publishes command
risk-service processes command
publishes RiskEvaluationCompleted event
case-service consumes event
transitions state
```

Why better?

- state is visible;
- timeout does not imply hidden unknown;
- audit trail exists;
- retry can be explicit;
- human remediation is possible;
- DLQ/parking lot can be integrated.

---

## 25. Hidden Coupling Analysis

RabbitMQ RPC introduces coupling across:

| Coupling Type | Description |
|---|---|
| Temporal coupling | requester waits for responder |
| Availability coupling | responder outage impacts requester |
| Latency coupling | responder latency becomes requester latency |
| Contract coupling | request/reply schema must align |
| Capacity coupling | responder throughput limits requester throughput |
| Failure semantics coupling | requester must understand timeout/unknown outcome |
| Operational coupling | broker, queues, consumers, and reply path all matter |

This does not mean RPC is forbidden.

It means you must know what coupling you are accepting.

---

## 26. Bounded Concurrency and Bulkhead

RPC requester should have bulkhead isolation.

Example:

```text
risk-rpc max in-flight = 100
legacy-rpc max in-flight = 20
notification-rpc max in-flight = 50
```

Never allow unlimited caller threads to block waiting for replies.

For Java/Spring:

- use bounded executor;
- limit HTTP thread blocking;
- use semaphore around RPC call;
- configure timeout;
- expose metrics;
- circuit-break when responder is unhealthy.

Pseudo:

```java
if (!bulkhead.tryAcquire()) {
    throw new ServiceUnavailableException("risk RPC overloaded");
}
try {
    return rpcClient.call(request, Duration.ofSeconds(2));
} finally {
    bulkhead.release();
}
```

---

## 27. Circuit Breaker Interaction

For RabbitMQ RPC, circuit breaker can protect requester from:

- repeated timeouts;
- responder outage;
- broker routing failure;
- reply path failure.

But circuit breaker must be interpreted carefully.

If circuit open:

```text
new calls rejected quickly
```

It does not cancel already published requests.

Requester may still receive late replies.

---

## 28. Backpressure Strategy

There are several layers:

```text
HTTP ingress limit
RPC in-flight limit
request queue length limit
responder consumer prefetch
responder worker pool size
reply consumer throughput
```

All must be coherent.

Bad:

```text
HTTP allows 5000 concurrent requests
RPC client allows unlimited pending futures
request queue unbounded
responder prefetch 1000
responder DB pool 20
```

Better:

```text
HTTP max concurrent 200
RPC in-flight 100
request queue length limit 10_000
responder prefetch 20
responder DB pool 20
request timeout 2s
```

---

## 29. Observability for RabbitMQ RPC

Track at least:

Requester metrics:

- requests published;
- publish failures;
- unroutable requests;
- confirm latency;
- pending in-flight count;
- timeout count;
- late reply count;
- duplicate reply count;
- reply latency;
- error reply count;
- circuit breaker state.

Responder metrics:

- request consume rate;
- processing latency;
- success reply count;
- failure reply count;
- reply publish failure;
- request redelivery count;
- invalid request count;
- DLQ count.

Broker metrics:

- request queue depth;
- unacked request messages;
- consumer utilization;
- publish rate;
- deliver rate;
- ack rate;
- redelivery rate;
- connection blocked state.

---

## 30. Logging Discipline

Requester log fields:

```text
correlationId
messageId
requestType
routingKey
replyTo strategy
timeoutMs
publishedAt
completedAt
status
```

Responder log fields:

```text
correlationId
requestMessageId
replyMessageId
requestType
responder
processingMs
replyPublishMs
redelivered
status
errorCode
```

Avoid logging sensitive payload.

---

## 31. Tracing

Propagate trace context through message headers.

Example headers:

```text
traceparent
tracestate
baggage
```

But do not rely on trace ID for application correlation.

Use both:

```text
traceId       -> observability
correlationId -> request/reply matching
requestId     -> domain/application identity
```

---

## 32. Testing RPC Correctly

Test cases:

1. normal success reply;
2. business failure reply;
3. responder timeout;
4. late reply after timeout;
5. duplicate reply;
6. unroutable request;
7. missing replyTo;
8. invalid correlationId;
9. responder publishes reply then crashes before ack;
10. requester crashes before reply;
11. request TTL expiry;
12. in-flight limit exceeded;
13. broker blocked/unavailable;
14. conversion failure;
15. redelivered request.

If your RPC implementation only tests success path, it is not production-ready.

---

## 33. Failure Walkthrough: Responder Publishes Reply Then Crashes

Timeline:

```text
T1 requester publishes request correlationId=C1
T2 responder consumes request
T3 responder executes business logic successfully
T4 responder publishes reply R1
T5 requester receives R1 and completes call
T6 responder crashes before acking request
T7 broker redelivers request
T8 responder processes again
T9 responder publishes reply R2
T10 requester has no pending C1
T11 requester logs duplicate/late reply and acks it
```

Required properties:

- responder idempotency if business side effect exists;
- requester duplicate reply handling;
- responder publish-before-ack discipline;
- observability for duplicate/late reply.

---

## 34. Failure Walkthrough: Requester Times Out But Responder Later Succeeds

Timeline:

```text
T1 requester publishes request C2
T2 responder is slow
T3 requester timeout at 2s
T4 API returns timeout/error/202 fallback
T5 responder completes at 5s
T6 responder publishes reply
T7 requester receives late reply
T8 requester ignores/logs it
```

Question:

```text
What is the business state?
```

If operation was a query, maybe no issue.

If operation changed state, you now have hidden state transition after caller gave up.

This is why side-effecting RPC is dangerous.

---

## 35. Failure Walkthrough: Unroutable Request

Timeline:

```text
T1 requester publishes to exchange X routing key risk.evaluate
T2 no binding matches
T3 mandatory=true returns message
T4 requester fails fast
```

Without mandatory publish:

```text
message silently dropped from requester perspective if no confirm/return handling discipline
```

For RPC, `mandatory=true` is strongly recommended.

---

## 36. Design Pattern: RPC for Pure Query

Good candidate:

```text
Get computed risk score from in-memory model service
```

Properties:

- no side effect;
- bounded runtime;
- duplicate request safe;
- timeout safe;
- fallback available;
- high-throughput responder pool.

Design:

```text
request queue: risk.query.request.q
responder: competing consumers
reply: direct reply-to or dedicated reply queue
request timeout: 1s-3s
idempotency: not required for side effect, but correlation required
```

---

## 37. Design Pattern: RPC as Legacy Adapter

Legacy systems sometimes require queue-based request/reply.

Design guardrails:

- strict SLA documentation;
- bounded in-flight;
- retry carefully;
- idempotency key sent to legacy if possible;
- durable audit of request and reply;
- DLQ for invalid request;
- parking lot for unknown state;
- operator dashboard.

Legacy RPC often needs more operational discipline than modern HTTP service calls.

---

## 38. Design Pattern: Command Accepted Instead of RPC

For workflows:

```text
CaseService -> publish EvaluateRiskCommand
RiskService -> publish RiskEvaluationCompletedEvent
CaseService -> update case state
```

HTTP API:

```http
POST /cases/CASE-123/risk-evaluations
HTTP/1.1 202 Accepted
Location: /cases/CASE-123/risk-evaluations/REQ-456
```

This avoids long synchronous wait and makes state visible.

---

## 39. Decision Matrix

| Requirement | Prefer |
|---|---|
| Need immediate small query result | HTTP/gRPC or RabbitMQ RPC |
| Need buffering before responder | RabbitMQ RPC may fit |
| Need long-running processing | Command accepted + event |
| Need audit/replay | Stream/event log + state machine |
| Need user-facing low latency | HTTP/gRPC often better |
| Need responder rate limiting | Queue-based command/RPC |
| Need side effect with unknown timeout | Avoid RPC or add idempotency/status model |
| Need human workflow | Avoid RPC |
| Need fanout | Event publish, not RPC |
| Need multiple responders | Event or scatter-gather design, not simple RPC |

---

## 40. Scatter-Gather Warning

Sometimes teams build:

```text
send request to N services
wait for N replies
aggregate
```

This is scatter-gather.

It is much harder than simple RPC.

Problems:

- partial response;
- slowest responder dominates latency;
- duplicate replies;
- missing replies;
- aggregation timeout;
- per-responder error contract;
- result completeness semantics.

Do not implement scatter-gather casually with RabbitMQ unless the business semantics tolerate partial/late answers.

---

## 41. Security Considerations

For RPC queues:

- requester should only write to request exchange;
- requester should only read from its reply queue/direct reply-to;
- responder should only read request queue and write replies as needed;
- avoid exposing sensitive data in error message;
- validate request schema;
- enforce max payload size;
- avoid Java native serialization;
- sanitize logs.

Permission boundary matters because request/reply often exposes command-like behavior.

---

## 42. Naming Conventions

Example topology:

```text
exchange:
case.command.x

request queue:
risk.evaluate.request.q

routing key:
risk.evaluate

reply queue:
case-api.instance-01.reply.q
```

For direct reply-to:

```text
replyTo = amq.rabbitmq.reply-to
```

Message types:

```text
case.risk.evaluate.requested.v1
case.risk.evaluate.succeeded.v1
case.risk.evaluate.failed.v1
```

---

## 43. Architecture Review Questions

Before approving RabbitMQ RPC, ask:

1. Why not HTTP/gRPC?
2. Why not command accepted + event?
3. Is the operation side-effect-free?
4. What does timeout mean?
5. Can requester safely retry?
6. What happens to late replies?
7. What happens to duplicate replies?
8. Is there max in-flight limit?
9. Is request queue bounded?
10. What is the responder prefetch?
11. What is the reply queue strategy?
12. Is request publish confirmed?
13. Is reply publish confirmed?
14. What happens if requester dies?
15. What happens if responder dies after reply before ack?
16. Are errors typed?
17. Are trace/correlation IDs propagated?
18. Is this user-facing?
19. Does this hide a workflow state transition?
20. Is there an operational dashboard?

---

## 44. Production Checklist

A RabbitMQ RPC design is not production-ready unless:

- `correlationId` is mandatory;
- timeout is mandatory;
- pending request map is bounded;
- request publish uses mandatory/return handling;
- publisher confirms are used where reliability matters;
- late replies are handled;
- duplicate replies are handled;
- responder validates request;
- responder classifies errors;
- responder does not infinite-requeue bad requests;
- side effects are idempotent;
- request queue has sane limits;
- responder prefetch is tuned;
- metrics expose pending, timeout, late, duplicate, error counts;
- logs include correlation id;
- sensitive data is not logged;
- integration tests cover failure paths;
- architecture decision explains why RPC is appropriate.

---

## 45. Mini Case Study: Risk Evaluation in Regulatory Case Management

### 45.1 Bad design

```text
Case API receives submit evidence request
Case API calls Risk Service via RabbitMQ RPC
Risk Service calls Rule Engine via RabbitMQ RPC
Rule Engine calls External Registry via RabbitMQ RPC
Case API waits for final result
```

Problems:

- long synchronous chain;
- hidden dependency graph;
- timeout ambiguity;
- poor auditability;
- user request tied to all downstream systems;
- difficult incident reconstruction.

---

### 45.2 Better design

```text
Case API receives evidence submission
Case API persists EvidenceSubmitted state
Case API publishes EvaluateRiskCommand
Risk Service consumes command
Risk Service evaluates risk
Risk Service publishes RiskEvaluationCompleted event
Case Service consumes event
Case state transitions to RiskEvaluated
Notification service informs reviewer if needed
Audit stream records every event
```

RPC can still exist for a small pure query inside Risk Service, but not as the backbone of case workflow.

---

## 46. Practical Heuristics

Use RabbitMQ RPC when:

```text
operation is short, bounded, mostly side-effect-free, and buffering/backpressure is useful
```

Avoid RabbitMQ RPC when:

```text
operation is long, workflow-like, human-facing, side-effecting, or audit-critical
```

Always remember:

```text
Timeout = unknown.
Duplicate reply = normal.
Late reply = normal.
Correlation id = required.
In-flight limit = required.
```

---

## 47. Common Anti-Patterns

### Anti-pattern 1: RPC everywhere

Every service talks to every other service through RabbitMQ RPC.

Result:

```text
distributed monolith with queues
```

---

### Anti-pattern 2: no timeout

Caller waits forever.

Result:

```text
thread exhaustion / memory leak
```

---

### Anti-pattern 3: timeout means failure

Caller retries side-effecting request after timeout.

Result:

```text
duplicate side effect
```

---

### Anti-pattern 4: shared reply queue with careless ack

Wrong instance receives reply and acks it.

Result:

```text
real requester never receives reply
```

---

### Anti-pattern 5: framework convenience hides semantics

Using `convertSendAndReceive` without understanding correlation, reply queue, timeout, and late replies.

Result:

```text
works in demo, fails in production
```

---

### Anti-pattern 6: RPC for workflow

A state transition depends on synchronous reply.

Result:

```text
invisible intermediate state and poor recovery model
```

---

## 48. Mini Lab Exercises

### Exercise 1: direct reply-to RPC

Build:

- request queue `risk.evaluate.request.q`;
- requester using direct reply-to;
- responder returns success reply;
- verify correlation id matching.

---

### Exercise 2: timeout and late reply

Modify responder to sleep longer than requester timeout.

Verify:

- requester times out;
- reply arrives late;
- requester logs unknown/late reply;
- no memory leak in pending map.

---

### Exercise 3: duplicate reply

Make responder publish reply twice.

Verify:

- first reply completes call;
- second reply is ignored/logged;
- no exception leaks.

---

### Exercise 4: responder crash after reply

Simulate:

```text
publish reply
crash before ack
```

Verify:

- request redelivered;
- duplicate reply possible;
- idempotency needed if handler has side effect.

---

### Exercise 5: bounded in-flight

Set max in-flight requests to 10.

Send 100 concurrent calls.

Verify:

- 10 accepted;
- rest rejected or queued intentionally;
- requester heap does not grow unbounded.

---

## 49. What Top 1% Engineers Internalize

Top engineers do not ask only:

```text
Can RabbitMQ do RPC?
```

They ask:

```text
What coupling am I accepting?
What does timeout mean?
What state becomes hidden?
Can I recover from duplicate, late, and missing replies?
Is this really a workflow?
Where is the audit trail?
What is the overload behavior?
```

They understand that request/reply is not evil.

But it is rarely neutral.

It creates a synchronous contract over asynchronous infrastructure.

That contract must be explicit, bounded, observable, and justified.

---

## 50. Summary

RabbitMQ request/reply is useful but dangerous.

Core rules:

1. Always use `correlationId`.
2. Always use timeout.
3. Treat timeout as unknown.
4. Handle late replies.
5. Handle duplicate replies.
6. Bound in-flight requests.
7. Use publisher confirms/mandatory where reliability matters.
8. Avoid side-effecting RPC unless idempotency and status tracking exist.
9. Prefer command accepted + event for workflows.
10. Do not mistake RabbitMQ RPC for loose coupling.

The architectural question is not:

```text
RabbitMQ or HTTP?
```

The better question is:

```text
Is this interaction a synchronous query, a command, an event, or a workflow transition?
```

Once that is clear, RabbitMQ RPC becomes one tool among many, not the default answer.

---

# End of Part 14

Part berikutnya:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-15.md
```

Topik:

```text
Workflow, Saga, and Enforcement Lifecycle Modelling with RabbitMQ
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-13.md">⬅️ Part 13 — Ordering, Concurrency, Partitioning, and Work Distribution</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-15.md">Part 15 — Workflow, Saga, and Enforcement Lifecycle Modelling with RabbitMQ ➡️</a>
</div>
