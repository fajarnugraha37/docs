# Part 26 — Cost and Quota Engineering

Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-26-cost-and-quota-engineering.md`  
Target pembaca: Java backend engineer yang ingin mendesain integrasi AWS yang bukan hanya benar secara fungsi, tetapi juga **terkendali biaya, quota-aware, throttling-aware, resilient, dan operable**.  
Rentang Java: Java 8 sampai Java 25, dengan praktik utama menggunakan AWS SDK for Java 2.x.

> Prinsip utama bagian ini: **cloud cost dan quota bukan urusan finance/infra belakangan. Untuk sistem production, cost dan quota adalah bagian dari desain correctness.**

---

## 1. Kenapa Cost dan Quota Engineering Penting?

Banyak engineer melihat AWS sebagai kumpulan service yang “elastic”. Ini benar dalam arti AWS dapat menyediakan kapasitas besar, tetapi salah jika diasumsikan sebagai **infinite capacity tanpa constraint**.

Dalam sistem Java yang memanggil AWS service, ada empat hal yang selalu berjalan bersamaan:

1. **Functional correctness**  
   Apakah operasi berhasil?

2. **Reliability correctness**  
   Apakah operasi tetap aman saat retry, timeout, duplicate, partial failure, dan throttling?

3. **Quota correctness**  
   Apakah sistem tetap berada di bawah limit service, account, region, resource, dan downstream?

4. **Cost correctness**  
   Apakah cost naik secara proporsional dan dapat diprediksi ketika traffic naik, error naik, payload membesar, atau retry meningkat?

Engineer biasa bertanya:

> "Apakah kodenya bisa publish SNS / consume SQS / upload S3?"

Engineer kuat bertanya:

> "Berapa API call per business transaction? Berapa retry amplification saat downstream throttled? Berapa CloudWatch log GB per hari? Apa quota yang akan lebih dulu pecah? Apakah backlog SQS akan menaikkan Lambda concurrency sampai menghantam account concurrency? Apakah KMS decrypt dipanggil per request atau dicache?"

Cost dan quota engineering membuat desain cloud menjadi **measurable**.

---

## 2. Mental Model: AWS Bill dan AWS Quota adalah Runtime Feedback

Dalam sistem lokal/tradisional, bottleneck sering terlihat sebagai CPU, heap, thread, DB connection, atau disk. Di AWS-integrated application, bottleneck juga muncul sebagai:

- API request cost.
- Storage cost.
- Data transfer cost.
- Log ingestion cost.
- KMS request cost.
- Secret retrieval cost.
- Lambda duration cost.
- Queue request cost.
- Event fan-out cost.
- Quota exceeded.
- Throttling.
- Concurrency cap.
- In-flight message cap.
- Region/account limit.

Cloud membuat biaya dan quota menjadi **runtime behavior**.

Contoh:

```text
Business action:
  User uploads 1 document.

Naive mental model:
  1 upload.

Real AWS cost/quota model:
  1 presigned URL generation
  1 S3 PUT
  1 S3 event
  1 SQS send
  N SQS receive attempts
  1 Lambda/worker processing
  1 S3 GET
  1 KMS decrypt maybe
  1 Secrets Manager call maybe
  X CloudWatch logs
  Y metrics
  maybe retry
  maybe DLQ
  maybe replay
```

Satu business transaction bisa menjadi puluhan metered operations.

---

## 3. Terminologi Dasar

### 3.1 Cost Driver

**Cost driver** adalah faktor yang membuat bill naik.

Contoh:

| Service | Cost driver umum |
|---|---|
| Lambda | request count, duration, memory size, provisioned concurrency, SnapStart cache/restore, logs |
| S3 | storage GB-month, request count, data retrieval, lifecycle transition, replication, data transfer |
| SQS | API request count, payload chunking, FIFO/fair queue behavior, long polling pattern |
| SNS | publish request, delivery type, payload size chunking, fan-out destination |
| Secrets Manager | secret count per month, API call count |
| KMS | encrypt/decrypt/generate data key request count |
| CloudWatch | log ingestion, log storage, metric count, custom metrics, alarm, query scan |
| DynamoDB | read/write capacity or request units, storage, streams, backup, global table replication |
| EventBridge | event ingestion, archive, replay, scheduler invocation, pipe processing |

### 3.2 Quota

**Quota** adalah batas yang diterapkan AWS terhadap account, region, service, atau resource.

Jenis quota:

1. **Account-level regional quota**  
   Contoh: Lambda concurrent executions per account per region.

2. **Resource-level quota**  
   Contoh: SQS in-flight messages per queue.

3. **API request quota**  
   Contoh: KMS request-per-second limit.

4. **Payload/size quota**  
   Contoh: Lambda payload size, SQS message size, SNS message size.

5. **Rate/scaling quota**  
   Contoh: seberapa cepat Lambda bisa scale execution environments.

6. **Soft quota / adjustable quota**  
   Bisa diminta naik melalui Service Quotas.

7. **Hard quota / non-adjustable quota**  
   Harus didesain di sekitar batas tersebut.

### 3.3 Throttling

**Throttling** terjadi ketika AWS menolak request yang valid karena request rate melebihi capacity/quota/policy.

Throttling bukan selalu error “fatal”. Ia adalah sinyal:

```text
Your system is asking too fast for this account/region/resource/service.
```

Respons yang benar bukan hanya “retry lebih banyak”. Kadang justru:

- kurangi concurrency,
- tambah batching,
- tambah cache,
- ubah partitioning,
- naikkan quota,
- pisahkan workload,
- degrade,
- queue,
- atau redesign flow.

### 3.4 Amplification

**Amplification** adalah efek ketika satu input menghasilkan banyak operasi downstream.

Contoh:

```text
1 API request
  -> 1 DB read
  -> 1 Secrets Manager get
  -> 1 KMS decrypt
  -> 1 SNS publish
  -> 5 SQS deliveries
  -> 5 Lambda invocations
  -> 5 S3 GET
  -> logs per function
```

Jika satu dependency throttled dan SDK melakukan 3 attempts, maka request downstream bisa naik 3x. Jika ada batch retry yang mengulang seluruh batch, amplification bisa jauh lebih besar.

---

## 4. Prinsip Dasar Cost/Quota Engineering

## 4.1 Hitung dari Business Transaction, Bukan dari Service

Jangan mulai dari:

> "Berapa harga SQS?"

Mulai dari:

> "Untuk satu business transaction, berapa SQS API call yang terjadi?"

Template:

```text
Business event: <nama event>

Per event:
- Lambda invocation: ...
- S3 PUT/GET/LIST/HEAD: ...
- SQS Send/Receive/Delete/ChangeVisibility: ...
- SNS Publish: ...
- KMS Encrypt/Decrypt/GenerateDataKey: ...
- SecretsManager GetSecretValue: ...
- CloudWatch log bytes: ...
- CloudWatch custom metrics: ...
- DynamoDB read/write units: ...
- EventBridge PutEvents: ...
- Data transfer: ...

Expected traffic:
- normal per second:
- peak per second:
- daily:
- monthly:

Retry assumption:
- p50 attempts:
- p95 attempts:
- worst acceptable attempts:

Fan-out:
- subscribers:
- DLQ/replay factor:
```

Tanpa model per business transaction, cost estimation hanya tebakan.

---

## 4.2 Treat Quota as Capacity Contract

Quota harus dianggap seperti connection pool atau thread pool.

Contoh:

```text
Lambda account concurrency = 1000
Reserved concurrency function A = 400
Reserved concurrency function B = 300
Unreserved pool = 300
```

Jika function A backlog SQS dan scale agresif, ia tidak boleh menghabiskan seluruh account concurrency dan membunuh function lain.

Quota bukan angka dokumentasi; quota adalah **capacity contract**.

---

## 4.3 Retry is Not Free

Retry mengonsumsi:

- waktu,
- thread,
- connection,
- request quota,
- downstream capacity,
- bill,
- log volume,
- dan kadang memperparah incident.

Retry yang baik punya:

- max attempts,
- jittered exponential backoff,
- per-operation timeout,
- idempotency,
- per-downstream concurrency cap,
- metric retry count,
- circuit/bulkhead jika perlu.

AWS SDK for Java 2.x memiliki retry strategy seperti standard/adaptive/legacy. Standard adalah default yang umum, sedangkan adaptive lebih cocok untuk workload single-resource yang throttling-heavy dan latency-tolerant. Adaptive dapat menunda initial request sehingga tidak cocok sebagai default sembarangan.

---

## 4.4 Batching Mengurangi Cost, Tetapi Mengubah Failure Semantics

Batching sering mengurangi cost dan meningkatkan throughput.

Contoh:

- SQS `SendMessageBatch`.
- SQS `DeleteMessageBatch`.
- DynamoDB batch write.
- CloudWatch metric batching.
- EventBridge `PutEvents` batch.
- Kinesis batch.
- S3 multipart.

Namun batching mengubah failure model:

```text
Single operation:
  one input -> one success/failure

Batch operation:
  many inputs -> partial success/failure possible
```

Jika batch failure ditangani salah, cost bisa turun tetapi correctness rusak.

---

## 4.5 Log adalah Data, dan Data Itu Dibayar

CloudWatch Logs sering menjadi cost driver tersembunyi.

Masalah umum:

- log full payload,
- log exception stack trace berulang,
- log debug aktif di production,
- log per retry attempt terlalu verbose,
- log high-cardinality metadata,
- log body SQS/SNS/S3 event yang besar,
- log raw secret/config accidentally.

Observability harus cukup untuk operasi, tetapi tidak boleh menjadi data lake sampah.

---

## 4.6 Cache Mengurangi Cost, Tetapi Membawa Staleness

Caching bisa mengurangi:

- Secrets Manager call,
- SSM Parameter Store call,
- KMS decrypt,
- S3 HEAD,
- STS AssumeRole,
- DynamoDB read,
- config lookup.

Namun cache membawa risiko:

- stale secret setelah rotation,
- stale feature flag,
- stale policy/config,
- memory growth,
- inconsistent behavior antar instance,
- delayed revocation.

Cost optimization tidak boleh mengorbankan safety tanpa eksplisit.

---

## 5. Taxonomy Cost: Bagaimana AWS Mengubah Behavior Menjadi Bill

## 5.1 Request-Based Cost

Service seperti SQS, SNS, S3, EventBridge, Secrets Manager, KMS, dan CloudWatch API sering memiliki dimensi request count.

Contoh desain yang membuat request count meledak:

```java
// Anti-pattern: call secret manager per HTTP request
String password = secretsManager.getSecretValue(...).secretString();
```

Lebih baik:

```text
Startup load + cache + refresh strategy + forced refresh on auth failure.
```

### Invariant

> Request-based cost harus dihitung dari request per business event, bukan request per line of code.

---

## 5.2 Duration-Based Cost

Lambda membebankan biaya berdasarkan durasi eksekusi dan memory allocation. Semakin besar memory, semakin besar resource yang dialokasikan; tetapi CPU juga meningkat secara proporsional, sehingga memory lebih besar bisa menurunkan latency dan kadang menurunkan total cost jika durasi turun signifikan.

Mental model:

```text
Cost ≈ invocations × duration × memory-size-rate
```

Namun untuk Java:

```text
Duration = init cost + handler cost + downstream wait + retry wait + serialization + logging
```

Karena Java punya class loading, dependency initialization, dan JIT/runtime behavior, tuning Lambda Java harus berbasis measurement.

---

## 5.3 Storage-Based Cost

S3, DynamoDB, CloudWatch Logs retention, ECR image, backups, snapshots, dan archive punya storage dimension.

Storage cost biasanya perlahan naik dan tidak terlihat sampai retention/lifecycle buruk.

Anti-pattern:

```text
Put everything into S3 forever in Standard class with no lifecycle.
```

Lebih baik:

```text
Classify object:
- transient
- operational
- audit
- legal retention
- archive
- quarantine
- replayable event
```

Lalu tentukan:

- retention,
- lifecycle transition,
- delete policy,
- restore expectation,
- legal hold/immutability,
- encryption,
- ownership.

---

## 5.4 Data Transfer Cost

Data transfer sering menjadi cost trap.

Perhatikan:

- internet egress,
- cross-region transfer,
- cross-AZ pattern,
- NAT Gateway data processing,
- VPC endpoint vs NAT,
- public endpoint access from private subnet,
- replication,
- CloudFront vs direct S3,
- large payload through API Gateway/Lambda instead of S3 presigned URL.

Mental model:

```text
Moving bytes is often more expensive than storing bytes.
```

---

## 5.5 Observability Cost

Observability cost dapat berasal dari:

- log ingestion,
- log retention,
- custom metrics,
- high-resolution metrics,
- alarms,
- traces,
- query scan,
- dashboard,
- metric streams.

Observability yang baik bukan “log everything”, tetapi:

```text
Log events with high diagnostic value.
Measure signals with operational action.
Trace boundaries where latency/failure attribution matters.
```

---

## 6. Taxonomy Quota: Limit Mana yang Biasanya Pecah?

## 6.1 Concurrency Quota

Biasanya muncul di:

- Lambda concurrent executions.
- Thread pool Java worker.
- HTTP connection pool.
- SQS message processing concurrency.
- DB connection pool.
- downstream API concurrency.
- Netty event loop capacity.

AWS Lambda default regional concurrency sering menjadi constraint awal dalam account baru. AWS juga memiliki scaling behavior per function, sehingga walaupun account quota besar, function tidak selalu naik tanpa batas secara instan.

### Design rule

```text
Concurrency must be explicitly budgeted per workload.
```

Jangan membiarkan satu consumer backlog menghabiskan kapasitas seluruh account.

---

## 6.2 In-Flight Quota

SQS memiliki konsep **in-flight messages**: message yang sudah diterima consumer tetapi belum di-delete. Untuk standard queue, limit in-flight kira-kira 120.000 message per queue.

Jika consumer lambat atau visibility timeout terlalu panjang, in-flight bisa penuh.

Efeknya:

```text
receiveMessage stops returning useful work
backlog appears stuck
consumer looks idle
messages are not actually gone
```

### Formula kasar

```text
in_flight ≈ processing_concurrency × average_processing_time / polling_interval_effect
```

Lebih praktis:

```text
max_safe_concurrency <= in_flight_limit / worst_case_processing_seconds_per_message_window
```

Namun desain nyata harus memonitor:

- `ApproximateNumberOfMessagesVisible`
- `ApproximateNumberOfMessagesNotVisible`
- `ApproximateAgeOfOldestMessage`
- consumer processing duration
- delete failure
- visibility extension count

---

## 6.3 Request-Per-Second Quota

KMS, STS, Secrets Manager, SSM, DynamoDB, EventBridge, dan banyak AWS API memiliki quota request rate.

Masalah yang sering terjadi:

```text
Java service scales horizontally from 5 pods to 100 pods.
Each pod refreshes config/secrets every 10 seconds.
Suddenly SSM/Secrets/KMS gets throttled.
```

Ini bukan bug AWS. Ini desain refresh yang tidak punya jitter dan tidak punya budget.

### Design rule

```text
Every periodic AWS call must have jitter.
Every refresh loop must have max concurrency.
Every expensive lookup must be cached unless freshness requires otherwise.
```

---

## 6.4 Payload Size Quota

Payload size sering memaksa perubahan arsitektur.

Contoh:

- SQS message max 256 KB.
- SNS message size bounded.
- Lambda synchronous payload bounded.
- API Gateway payload bounded.
- EventBridge event bounded.
- CloudWatch log event bounded.
- Lambda environment variables bounded.

Pattern yang benar untuk large payload:

```text
Put payload in S3.
Send pointer/reference in event/message.
Validate object with metadata/checksum/version.
```

Bukan:

```text
Stuff everything into SQS/SNS/EventBridge payload.
```

---

## 6.5 Policy/Configuration Size Quota

IAM policy, SQS policy, Lambda resource policy, environment variables, role trust policy, and event patterns punya batas ukuran.

Jika desain butuh memasukkan ratusan tenant/account/principal ke satu policy, mungkin desain boundary salah.

Better patterns:

- use condition keys,
- use organization ID,
- use role assumption,
- use resource tagging,
- split resource,
- use account-level governance,
- avoid per-user policy explosion.

---

## 7. Service-by-Service Cost and Quota Mental Model

## 7.1 Lambda

### Cost drivers

- invocation count,
- duration,
- memory size,
- provisioned concurrency,
- SnapStart-related charges if applicable,
- logs,
- data transfer,
- downstream calls caused by function.

### Quota drivers

- regional account concurrency,
- reserved concurrency,
- provisioned concurrency,
- function scaling rate,
- payload size,
- environment variable size,
- deployment package size,
- layer count,
- `/tmp` storage,
- timeout max.

### Common cost traps

1. **Too much logging per invocation**

```text
1000 req/sec × 2 KB log = 2 MB/sec
≈ 172.8 GB/day before retention/query cost
```

2. **Lambda used for long-running polling**

If workload is always-on and constantly polling, container worker may be cheaper and simpler.

3. **Memory too small**

Small memory can increase duration due to low CPU, making total cost worse.

4. **Retries invoke function repeatedly**

Asynchronous invocation retries or event source retries can multiply invocation cost.

5. **No reserved concurrency**

A bad function can consume account concurrency and affect unrelated functions.

### Design guidance

- Put reserved concurrency on noisy or risky functions.
- Use provisioned concurrency only for latency-critical predictable traffic.
- Use SnapStart for Java functions where compatible and beneficial.
- Keep init path lean.
- Avoid per-invocation client creation.
- Avoid synchronous downstream calls with no timeout.
- Measure p50/p95/p99 and cost per successful business outcome, not just cost per invocation.

---

## 7.2 S3

### Cost drivers

- GB stored by storage class,
- PUT/COPY/POST/LIST requests,
- GET/SELECT/request retrieval,
- lifecycle transition,
- replication,
- object tagging/analytics/inventory,
- data retrieval from infrequent/archive class,
- data transfer out,
- KMS request if SSE-KMS is used.

### Quota/performance considerations

- object key design affects operational behavior and listing pattern,
- multipart upload has part count/size constraints,
- incomplete multipart upload can leak cost,
- LIST can be expensive at large scale and architecturally dangerous,
- small objects can cause request-cost dominance.

### Common cost traps

1. **Using S3 as a database**

Frequent LIST/HEAD/GET for tiny metadata objects can be inefficient.

2. **No lifecycle policy**

Temporary files remain forever.

3. **Incomplete multipart uploads**

Failed uploads leave parts stored.

4. **SSE-KMS for ultra-high request objects without KMS budget**

Every encrypted object access may involve KMS depending on path and caching.

5. **Cross-region replication without cost model**

Replication adds storage, requests, transfer, and KMS.

### Design guidance

- Model object lifecycle at design time.
- Separate prefixes by lifecycle class.
- Avoid LIST in hot path.
- Store index/metadata elsewhere if you need query semantics.
- Use S3 pointer pattern for large messages.
- Use lifecycle rule to abort incomplete multipart uploads.
- Use S3 Inventory for large estate analysis instead of ad-hoc recursive LIST.
- Monitor request metrics for hot buckets/prefixes when needed.

---

## 7.3 SQS

### Cost drivers

- API requests: send, receive, delete, change visibility.
- Batch usage.
- Payload size chunks.
- Empty receives.
- FIFO/high-throughput behavior.
- Extended client S3 storage if using large messages.
- DLQ and replay operations.

### Quota drivers

- message size,
- message retention,
- visibility timeout,
- in-flight messages,
- batch size,
- FIFO throughput/message group behavior,
- queue policy size.

### Cost traps

1. **Short polling with empty receives**

Long polling reduces empty responses and cost.

2. **No batch delete**

Deleting one by one increases API call count.

3. **Visibility too short**

Messages reappear, duplicate processing increases cost.

4. **Visibility too long**

In-flight messages accumulate; recovery slows.

5. **Poison message loops**

Same message repeatedly processed until DLQ or retention.

### Design guidance

- Use long polling.
- Use batch receive/delete where possible.
- Set visibility timeout based on p99 processing time plus margin.
- Use visibility extension for variable-duration jobs.
- Use DLQ with explicit redrive policy.
- Track cost per processed message, not just queue price.
- Use idempotency store for side-effecting consumers.

---

## 7.4 SNS

### Cost drivers

- publish request count,
- payload size chunks,
- number and type of subscriptions,
- delivery retries,
- SMS/mobile/email endpoint cost if used,
- downstream SQS/Lambda cost.

### Quota/design drivers

- message size,
- publish rate,
- subscription filter policy complexity,
- delivery retry policy,
- topic policy,
- FIFO throughput if FIFO topic.

### Cost traps

1. **Unbounded fan-out**

One publish to 20 subscriptions is not “one operation” operationally.

2. **No filter policy**

All subscribers receive all messages and discard locally, wasting downstream cost.

3. **Large payloads**

Payload chunking and downstream duplication.

4. **Chatty domain events**

Publishing every minor field change as global event can explode cost.

### Design guidance

- Use message attributes and filter policies.
- Publish meaningful domain events, not internal implementation noise.
- Keep payload concise; use S3 pointer for large data.
- Isolate subscribers with SQS.
- Monitor per-subscriber failure and DLQ.

---

## 7.5 Secrets Manager and SSM Parameter Store

### Cost drivers

Secrets Manager commonly charges per secret per month and per API call. Parameter Store has tiers and features that affect cost. The key engineering issue is not just unit price, but access pattern.

### Common cost traps

1. **Get secret per request**
2. **Get parameter per message**
3. **No cache**
4. **Synchronized refresh across hundreds of instances**
5. **Too many tiny per-tenant secrets**
6. **Using Secrets Manager for non-secret high-churn config**

### Design guidance

- Cache secrets/config locally.
- Use jittered refresh.
- Use version/label awareness.
- Separate static config, dynamic config, and secrets.
- Avoid putting every runtime decision behind SSM call.
- Treat secret rotation as correctness workflow, not only cost workflow.

### Example cost reasoning

Bad:

```text
100 pods × 20 req/sec × 1 GetSecretValue/request
= 2,000 secret API calls/sec
= 172,800,000 calls/day
```

Good:

```text
100 pods × refresh every 5 minutes with jitter
= 100 × 288 = 28,800 calls/day
```

Same application behavior, radically different bill and throttling risk.

---

## 7.6 KMS

### Cost drivers

- Encrypt,
- Decrypt,
- GenerateDataKey,
- ReEncrypt,
- Sign/Verify,
- key count,
- custom key store,
- multi-region key usage,
- service-integrated encryption behavior.

### Quota drivers

- request-per-second per account/region/API,
- key policy size,
- grants,
- regional quota,
- asymmetric/HMAC/custom key store separate limits.

### Cost traps

1. **Decrypt per request**
2. **GenerateDataKey per tiny object**
3. **No data key caching where appropriate**
4. **SSE-KMS on high-frequency S3 workload without KMS budget**
5. **Fan-out message processing that decrypts same config repeatedly**

### Design guidance

- Use envelope encryption for application-level encryption.
- Cache data keys only when security model allows.
- Use encryption context for audit and misuse detection.
- Budget KMS TPS before high-throughput design.
- Monitor throttling.
- Avoid KMS in inner loop if possible.

---

## 7.7 CloudWatch

### Cost drivers

- log ingestion,
- log storage retention,
- Logs Insights query scan,
- custom metric count,
- high-resolution metric,
- alarm,
- dashboard,
- trace ingestion/storage depending on tracing stack.

### Cost traps

1. **Payload logging**
2. **Debug logs in production**
3. **Unbounded exception logging in retry loop**
4. **No retention policy**
5. **High-cardinality custom metrics**
6. **Too many per-tenant/per-user metrics**
7. **Frequent wide Logs Insights queries**

### Design guidance

- Set retention explicitly.
- Redact payload.
- Log structured summary, not full body.
- Use sampling for repetitive errors.
- Use metrics for count/latency; logs for diagnostics.
- Avoid high-cardinality metric dimensions.
- Estimate log bytes per request.

### Log size formula

```text
daily_log_gb =
  requests_per_day
  × average_log_events_per_request
  × average_log_event_bytes
  / 1024^3
```

Example:

```text
10,000,000 req/day
× 5 log events/request
× 500 bytes
= 25,000,000,000 bytes
≈ 23.3 GB/day
```

That is before retention and query scan.

---

## 7.8 DynamoDB

### Cost drivers

- read request units,
- write request units,
- storage,
- backup,
- streams,
- global tables replication,
- GSI storage/read/write,
- TTL delete side effects in streams/global tables,
- on-demand vs provisioned capacity.

### Quota/design drivers

- partition throughput,
- item size,
- transaction limits,
- batch limits,
- GSI backfill,
- hot partitions,
- account/table quotas.

### Cost traps

1. **Scan in hot path**
2. **Wrong key design causing hot partition**
3. **Large item updated frequently**
4. **GSI explosion**
5. **Strongly consistent reads by default without need**
6. **On-demand mode hiding inefficient access pattern until bill arrives**

### Design guidance

- Design from access patterns.
- Estimate item size.
- Count reads/writes per business transaction.
- Use conditional writes for idempotency and correctness.
- Avoid scans.
- Monitor throttling and consumed capacity.
- Separate hot counters or use sharding.

---

## 7.9 EventBridge

### Cost drivers

- events published,
- matched/invoked targets,
- archive storage,
- replay,
- scheduler invocations,
- pipes processing,
- cross-account/cross-region routing.

### Cost traps

1. **Event bus as global debug stream**
2. **Publishing overly granular implementation events**
3. **Too many broad rules matching same event**
4. **Archive everything without retention policy**
5. **Replay causing unintended downstream cost**

### Design guidance

- Define event taxonomy.
- Use event detail type intentionally.
- Use archive selectively.
- Treat replay as controlled operation.
- Put guardrails around rules and target fan-out.
- Measure event-to-target amplification.

---

## 8. Cost Amplification Patterns

## 8.1 Retry Amplification

Suppose:

```text
Inbound requests: 1,000/sec
Each request calls S3 once
SDK max attempts: 3
S3 throttling or timeout affects 10%
```

Naive expected S3 calls:

```text
1,000/sec
```

With retry:

```text
900 normal × 1 = 900
100 affected × 3 = 300
total = 1,200/sec
```

That is 20% extra. But if latency causes upstream timeout and client retries the whole business request:

```text
client retry × service retry × SDK retry
```

Can become:

```text
2 × 2 × 3 = 12 attempts
```

### Rule

> Retry policies must be considered across the whole call chain, not per layer.

---

## 8.2 Fan-Out Amplification

```text
1 domain event
-> 1 SNS topic
-> 8 SQS subscriptions
-> 8 consumers
-> each does 2 AWS calls
```

One event becomes:

```text
1 publish + 8 deliveries + 16 downstream calls + logs/metrics
```

If event is emitted for every minor update, cost scales with implementation noise.

### Rule

> Fan-out requires event quality discipline.

---

## 8.3 Polling Amplification

Bad polling:

```text
100 consumers
poll every 1 second
mostly empty queue
```

This is:

```text
8,640,000 ReceiveMessage calls/day
```

Long polling reduces empty responses and cost.

### Rule

> Polling must be demand-aware, batched, and long-polling where supported.

---

## 8.4 Logging Amplification

A single exception inside retry loop:

```java
for (int attempt = 1; attempt <= 3; attempt++) {
    try {
        callAws();
    } catch (Exception e) {
        log.error("AWS call failed", e);
    }
}
```

At high volume, this logs full stack trace multiple times per user action.

Better:

```text
- log attempt failures at debug/warn with compact fields
- log final failure once at error
- metric every failure class
- include AWS request ID where available
```

---

## 8.5 Batch Retry Amplification

If Lambda consumes SQS batch of 10 messages and one message fails, retrying the whole batch reprocesses 9 successful messages.

Better:

- partial batch response,
- idempotency,
- per-message failure classification,
- DLQ after max receives,
- small batch for high-risk workloads,
- larger batch for homogeneous low-risk workloads.

---

## 9. Quota-Aware Architecture Patterns

## 9.1 Budgeted Concurrency

Create explicit budget:

```text
Workload A: max 100 concurrent
Workload B: max 200 concurrent
Workload C: max 50 concurrent
Reserve emergency/unreserved capacity: 100
```

In Java worker:

```java
Semaphore downstreamPermits = new Semaphore(50);

CompletableFuture<Result> callDownstream(Input input) {
    return CompletableFuture.supplyAsync(() -> {
        boolean acquired = false;
        try {
            downstreamPermits.acquire();
            acquired = true;
            return doAwsCall(input);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException(e);
        } finally {
            if (acquired) downstreamPermits.release();
        }
    }, executor);
}
```

In Lambda:

```text
reserved concurrency = blast radius limiter
provisioned concurrency = latency stabilizer
event source max concurrency = queue drain limiter
```

---

## 9.2 Token Bucket for AWS Calls

For expensive or throttling-sensitive API:

```text
KMS decrypt
SecretsManager GetSecretValue
STS AssumeRole
SSM GetParametersByPath
DynamoDB writes
```

Use logical token bucket:

```text
rate = known safe TPS
burst = small multiple
on no token = wait/drop/defer
```

Do not rely only on SDK retry.

---

## 9.3 Jittered Refresh

Bad:

```text
Every pod refreshes secret at exactly 00:00, 00:05, 00:10.
```

Good:

```text
refresh_interval = 5 minutes
jitter = random 0-60 seconds
```

Pseudo-code:

```java
Duration base = Duration.ofMinutes(5);
Duration jitter = Duration.ofSeconds(ThreadLocalRandom.current().nextInt(0, 60));
Duration next = base.plus(jitter);
```

---

## 9.4 Bulkhead Per Dependency

Separate capacity pools:

```text
S3 client pool
SQS consumer executor
DynamoDB idempotency executor
Secrets refresh executor
KMS crypto executor
```

Avoid one slow dependency starving unrelated work.

---

## 9.5 Queue Before Expensive Downstream

If a downstream API has strict rate limit:

```text
HTTP request -> enqueue command -> worker drains at safe rate
```

Instead of:

```text
HTTP request -> directly call downstream with user-facing timeout
```

This converts burst into backlog.

---

## 9.6 Cache with Freshness Contract

Define cache contract explicitly:

```text
Config type: database password
source: Secrets Manager
freshness: must observe rotation within 5 minutes
refresh: jittered periodic + forced refresh on auth failure
failure mode: use stale for max 15 minutes if source unavailable
security: never log value
```

Without freshness contract, cache becomes guesswork.

---

## 10. Java SDK Implementation Patterns

## 10.1 Centralize AWS Client Construction

Do not scatter client builders across codebase.

Bad:

```java
public void handle() {
    S3Client s3 = S3Client.builder().build();
    // ...
}
```

Good:

```java
public final class AwsClients implements AutoCloseable {
    private final S3Client s3;
    private final SqsClient sqs;
    private final SnsClient sns;

    public AwsClients(Region region, AwsCredentialsProvider credentialsProvider) {
        this.s3 = S3Client.builder()
                .region(region)
                .credentialsProvider(credentialsProvider)
                .overrideConfiguration(c -> c
                        .apiCallTimeout(Duration.ofSeconds(10))
                        .apiCallAttemptTimeout(Duration.ofSeconds(3)))
                .build();

        this.sqs = SqsClient.builder()
                .region(region)
                .credentialsProvider(credentialsProvider)
                .overrideConfiguration(c -> c
                        .apiCallTimeout(Duration.ofSeconds(8))
                        .apiCallAttemptTimeout(Duration.ofSeconds(2)))
                .build();

        this.sns = SnsClient.builder()
                .region(region)
                .credentialsProvider(credentialsProvider)
                .overrideConfiguration(c -> c
                        .apiCallTimeout(Duration.ofSeconds(5))
                        .apiCallAttemptTimeout(Duration.ofSeconds(2)))
                .build();
    }

    public S3Client s3() { return s3; }
    public SqsClient sqs() { return sqs; }
    public SnsClient sns() { return sns; }

    @Override
    public void close() {
        s3.close();
        sqs.close();
        sns.close();
    }
}
```

Centralization enables:

- timeout standardization,
- retry standardization,
- metric wrapping,
- test substitution,
- client reuse,
- shutdown management,
- cost attribution.

---

## 10.2 Count AWS Calls Per Use Case

Instrument at boundary.

Conceptual wrapper:

```java
public final class MeteredS3Gateway {
    private final S3Client s3;
    private final AwsCostMetrics metrics;

    public MeteredS3Gateway(S3Client s3, AwsCostMetrics metrics) {
        this.s3 = s3;
        this.metrics = metrics;
    }

    public PutObjectResponse putObject(PutObjectRequest request, RequestBody body, String useCase) {
        long start = System.nanoTime();
        try {
            PutObjectResponse response = s3.putObject(request, body);
            metrics.count("aws.s3.put.success", useCase, request.bucket());
            return response;
        } catch (S3Exception e) {
            metrics.count("aws.s3.put.failure", useCase, e.awsErrorDetails().errorCode());
            throw e;
        } finally {
            metrics.timing("aws.s3.put.latency", useCase, System.nanoTime() - start);
        }
    }
}
```

Do not overdo wrappers if using instrumentation library, but the principle stands:

```text
Every AWS boundary must be attributable to a business use case.
```

---

## 10.3 Avoid Per-Request Secret Loading

Bad:

```java
public Connection openConnection() {
    String secret = secrets.getSecretValue(r -> r.secretId(secretId)).secretString();
    return connect(parse(secret));
}
```

Better:

```java
public final class CachedSecretProvider {
    private final SecretsManagerClient client;
    private final String secretId;
    private volatile CachedSecret cached;

    public String currentSecret() {
        CachedSecret local = cached;
        if (local != null && !local.isExpired()) {
            return local.value();
        }
        return refreshWithSingleFlight();
    }

    private synchronized String refreshWithSingleFlight() {
        CachedSecret local = cached;
        if (local != null && !local.isExpired()) {
            return local.value();
        }

        GetSecretValueResponse response = client.getSecretValue(r -> r.secretId(secretId));
        CachedSecret next = CachedSecret.from(response.secretString(), ttlWithJitter());
        cached = next;
        return next.value();
    }
}
```

In production, prefer the AWS-supported caching library where suitable, but understand the mechanics.

---

## 10.4 Make Retry Budget Visible

Expose metrics:

```text
aws.sdk.attempts.count
aws.sdk.retries.count
aws.sdk.throttles.count
aws.sdk.timeout.count
aws.sdk.final_failure.count
aws.sdk.latency
```

If retry count rises before error count, you have early warning.

---

## 10.5 Use Backpressure, Not Unlimited Futures

Bad:

```java
for (Message m : messages) {
    CompletableFuture.runAsync(() -> process(m));
}
```

Good:

```java
ExecutorService executor = new ThreadPoolExecutor(
        16,
        16,
        0L,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(100),
        new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Backpressure options:

- bounded queue,
- semaphore,
- rate limiter,
- adaptive polling,
- pause intake,
- reduce batch size,
- fail fast,
- queue externally.

---

## 11. Cost Estimation Worksheets

## 11.1 SQS Consumer Cost Worksheet

```text
Inputs:
- messages_per_day:
- batch_size_receive:
- batch_size_delete:
- empty_receive_rate:
- retries_per_message:
- visibility_extensions_per_message:
- payload_size_kb:

Derived:
- send_requests = messages_per_day / send_batch_size
- receive_requests = messages_per_day / receive_batch_size + empty_receives
- delete_requests = successful_messages / delete_batch_size
- change_visibility_requests = messages_requiring_extension
- retry_extra_receives = failed_attempts
- billed_payload_chunks = ceil(payload_size_kb / 64)

Questions:
- Is long polling enabled?
- Is partial failure handled?
- Is DLQ redrive modeled?
- Is poison message bounded?
```

---

## 11.2 Lambda Cost Worksheet

```text
Inputs:
- invocations_per_day:
- average_duration_ms:
- p95_duration_ms:
- p99_duration_ms:
- memory_mb:
- cold_start_rate:
- retry_invocation_rate:
- provisioned_concurrency:
- log_bytes_per_invocation:

Derived:
- GB_seconds = invocations × duration_seconds × memory_gb
- request_count = invocations × (1 + retry_rate)
- log_GB_day = invocations × log_bytes / 1024^3
- concurrency_required ≈ RPS × average_duration_seconds
- peak_concurrency_required ≈ peak_RPS × p95_duration_seconds

Questions:
- Is reserved concurrency set?
- Is provisioned concurrency justified by latency/business need?
- Does memory increase reduce total duration enough?
- Are downstream calls bounded?
```

---

## 11.3 S3 Pipeline Cost Worksheet

```text
Inputs:
- objects_per_day:
- average_object_size_mb:
- storage_retention_days:
- put_per_object:
- get_per_object:
- head_per_object:
- list_per_batch:
- lifecycle_transition:
- kms_per_object:
- cross_region_replication:
- data_transfer_out_gb:

Derived:
- storage_gb_month
- put_requests
- get_requests
- metadata_requests
- lifecycle_transition_requests
- kms_requests
- replication_storage
- transfer_cost

Questions:
- Are incomplete multipart uploads cleaned?
- Is LIST in hot path?
- Is object lifecycle explicit?
- Is S3 used for query-like behavior?
```

---

## 11.4 Secrets/KMS Cost Worksheet

```text
Inputs:
- app_instances:
- secrets_per_instance:
- refresh_interval_seconds:
- startup_fetches:
- forced_refresh_rate:
- decrypts_per_request:
- requests_per_second:

Derived:
- secret_calls_per_day =
    app_instances × secrets_per_instance × (86400 / refresh_interval_seconds)
    + startup_fetches
    + forced_refreshes

- kms_calls_per_day =
    decrypts_per_request × requests_per_second × 86400
    + service_integrated_kms_calls

Questions:
- Can values be cached?
- Is refresh jittered?
- Is stale use acceptable temporarily?
- Are calls synchronized during deploy?
- Does rotation cause burst?
```

---

## 12. Quota Planning Worksheets

## 12.1 Lambda Concurrency Planning

```text
average_concurrency = average_rps × average_duration_seconds
peak_concurrency = peak_rps × p95_duration_seconds
safe_reserved_concurrency = peak_concurrency × safety_factor
```

Example:

```text
peak_rps = 200
p95_duration = 0.8 sec
peak_concurrency = 160
safety_factor = 1.5
reserved_concurrency = 240
```

But also check:

```text
downstream DB connection limit
SQS batch behavior
KMS request rate
Secrets refresh pattern
CloudWatch log volume
```

Concurrency without downstream budget is dangerous.

---

## 12.2 SQS In-Flight Planning

```text
in_flight = active_workers × messages_per_worker
```

For Lambda SQS mapping:

```text
in_flight ≈ concurrent_lambda_invocations × batch_size
```

If:

```text
concurrency = 1000
batch_size = 10
in_flight = 10,000
```

This is under 120k standard queue in-flight, but downstream may not survive.

---

## 12.3 KMS TPS Planning

```text
kms_tps =
  request_tps × decrypts_per_request
  + object_tps × kms_ops_per_object
  + secret_refresh_tps
```

If each request decrypts a field:

```text
request_tps = 2,000
decrypts_per_request = 3
kms_tps = 6,000
```

This may be a quota and cost problem. Usually application-level data key caching or different design is required.

---

## 12.4 CloudWatch Logs Planning

```text
log_gb_day =
  rps × 86400 × log_events_per_request × avg_event_bytes / 1024^3
```

Then decide:

- retention days,
- log class,
- sampling,
- redaction,
- query pattern,
- export/archive to S3 if needed.

---

## 13. Cost-Aware Design Patterns

## 13.1 Pointer Payload Pattern

Use for large events/messages:

```json
{
  "eventId": "evt-123",
  "type": "DocumentUploaded",
  "document": {
    "bucket": "case-doc-prod",
    "key": "cases/2026/06/case-123/doc-456.pdf",
    "versionId": "abc",
    "sha256": "..."
  }
}
```

Benefits:

- avoids payload quota,
- reduces queue/topic cost,
- enables independent retention,
- enables checksum validation,
- enables access control via S3/IAM/KMS.

Risks:

- object may be deleted too early,
- consumer needs S3 permission,
- object versioning/immutability must be considered,
- event and object lifecycle must be aligned.

---

## 13.2 Batch But Preserve Item-Level Outcome

For SQS:

```text
Receive up to 10
Process each independently
Delete successful messages in batch
Return/retain failed messages
DLQ poison messages
```

For EventBridge `PutEvents`, each entry can succeed/fail independently. The application must inspect per-entry result.

For DynamoDB batch write, unprocessed items must be retried with backoff.

---

## 13.3 Precompute and Cache Expensive Metadata

Bad:

```text
For each message:
  HEAD S3 object
  GET tags
  GET secret
  KMS decrypt
```

Better:

```text
Include stable metadata in event at production time:
  object size
  content type
  checksum
  source system
  schema version
  tenant/case ID
```

Do not make every consumer rediscover metadata from AWS APIs.

---

## 13.4 Use Lifecycle as Cost Control

S3 lifecycle example by semantic zone:

```text
landing/       retain 7 days if not processed
processing/    retain 3 days
processed/     retain 90 days then IA/archive
quarantine/    retain 180 days or manual review
audit/         retain per regulatory policy
tmp/           delete after 1 day
```

CloudWatch retention:

```text
dev: 7-14 days
uat: 14-30 days
prod operational: 30-90 days
prod audit: export/centralize separately if long retention required
```

---

## 13.5 Use Reserved Concurrency as Cost and Blast Radius Guard

Reserved concurrency is not only performance tool. It is a safety tool.

```text
Function: document-thumbnail-generator
Reserved concurrency: 20
Reason:
  - protects downstream image library CPU
  - protects S3/KMS request rate
  - prevents backlog from consuming account concurrency
```

---

## 13.6 Use DLQ Intentionally, Not as Trash Bin

DLQ cost may be low, but DLQ is operational debt.

A DLQ needs:

- owner,
- alarm,
- triage dashboard,
- message schema,
- failure reason,
- replay tool,
- max retention,
- redrive policy,
- manual quarantine policy.

Without this, DLQ hides correctness failure.

---

## 14. Cost Anti-Patterns

## 14.1 "AWS SDK Call Inside Every Getter"

Example:

```java
public String getConfig(String key) {
    return ssm.getParameter(r -> r.name(key)).parameter().value();
}
```

This turns normal object access into remote billed API call.

---

## 14.2 "LIST S3 to Find Work"

Bad:

```text
Every minute:
  list all objects under prefix
  process unprocessed objects
```

Better:

```text
S3 event -> SQS -> consumer
```

Or:

```text
S3 Inventory / batch job for periodic reconciliation
```

---

## 14.3 "Log Full Event Body Everywhere"

Bad:

```java
log.info("Received event {}", eventJson);
```

Better:

```java
log.info("Received event id={} type={} caseId={} objectKey={} size={}",
        eventId, type, caseId, objectKey, size);
```

---

## 14.4 "Retry Storm as Reliability"

Bad:

```text
client retries 3x
API gateway retries
service retries 3x
SDK retries 3x
queue retries
Lambda retries
```

Better:

```text
one clear retry owner per boundary
bounded attempts
jitter
idempotency
DLQ/compensation
```

---

## 14.5 "One Shared AWS Account Quota for Everything"

If DEV/UAT/PROD or multiple teams share quota without budgeting, one workload can break another.

Better:

- account separation,
- reserved concurrency,
- quota ownership,
- per-service monitoring,
- workload tags,
- cost allocation tags,
- budget alerts.

---

## 14.6 "Use Secrets Manager for Every Config Value"

Secrets Manager is for secrets and rotation-oriented sensitive values. High-frequency non-secret config may belong elsewhere.

---

## 14.7 "No Cost Model Until Production"

If the first cost model happens after bill shock, the design is already late.

---

## 15. Designing Cost Attribution

## 15.1 Tagging Strategy

Use tags for:

- application,
- environment,
- owner,
- cost center,
- data classification,
- workload,
- criticality,
- lifecycle,
- compliance domain.

Example:

```text
app=case-management
env=prod
owner=platform-team
service=document-processing
cost-center=regulatory-platform
data-classification=confidential
criticality=high
```

Tags should be enforced by IaC/policy, not manually remembered.

---

## 15.2 Business Metric Mapping

Technical cost must map to business activity:

```text
cost per uploaded document
cost per case created
cost per screening request
cost per notification delivered
cost per report generated
cost per archived file
```

This is how engineering discusses cost with product/business.

---

## 15.3 Cost Allocation by AWS Boundary

Example:

```text
Document upload pipeline:
- S3 storage/request: document service
- SQS queue: document processing service
- Lambda: thumbnail/validation service
- KMS: shared security platform but allocated by key/tag
- CloudWatch logs: owning function/service
```

Without ownership, optimization becomes political.

---

## 16. Alerting for Cost and Quota

## 16.1 Cost Alerts

Minimum:

- AWS Budgets monthly forecast,
- anomaly detection,
- per-service budget for known high-risk services,
- tag-based budget,
- daily report for non-prod,
- alert on sudden CloudWatch Logs increase,
- alert on NAT/data transfer spike.

---

## 16.2 Quota Alerts

Monitor:

- Lambda concurrent executions,
- Lambda throttles,
- SQS in-flight messages,
- SQS age of oldest message,
- KMS throttles,
- DynamoDB throttles,
- API Gateway 429,
- EventBridge failed invocations,
- SNS delivery failures,
- CloudWatch ingestion anomalies,
- AWS SDK retry/throttle metrics.

---

## 16.3 Leading vs Lagging Signals

Lagging:

```text
Monthly bill increased.
```

Leading:

```text
retry count increased
throttle count increased
log GB/day increased
queue age increased
concurrency near cap
KMS TPS near quota
DLQ depth increasing
```

Top-tier systems alert on leading signals.

---

## 17. Incident Scenarios

## 17.1 Scenario: CloudWatch Bill Spike

Symptoms:

- bill anomaly,
- log ingestion up 10x,
- no traffic increase.

Likely causes:

- debug enabled,
- exception loop,
- retry storm,
- full payload logging,
- new verbose dependency log,
- poison message repeatedly failing.

Investigation:

```text
1. Check CloudWatch usage by log group.
2. Compare ingestion before/after deploy.
3. Query top logger/error signatures.
4. Check retry/throttle metrics.
5. Check DLQ/backlog.
6. Reduce log level or add sampling.
7. Patch root cause.
8. Set retention if missing.
```

Preventive controls:

- log budget per service,
- max payload logging policy,
- structured compact logs,
- debug disabled in prod,
- alarm on log ingestion anomaly.

---

## 17.2 Scenario: KMS Throttling During Traffic Spike

Symptoms:

- `ThrottlingException` from KMS,
- increased request latency,
- Lambda timeout,
- SQS backlog grows.

Likely causes:

- decrypt per request,
- no data key cache,
- secret refresh synchronized,
- SSE-KMS high object access spike,
- fan-out consumers all decrypt same payload.

Mitigation:

```text
1. Reduce consumer concurrency.
2. Enable cache if safe.
3. Add jitter.
4. Batch/defer workload.
5. Request quota increase if design is valid.
6. Redesign inner-loop encryption calls.
```

---

## 17.3 Scenario: SQS Backlog Explodes

Symptoms:

- visible messages increasing,
- age oldest message increasing,
- Lambda concurrency maxed,
- downstream throttling.

Likely causes:

- downstream slow,
- poison message retries,
- visibility too short,
- batch retry whole batch,
- concurrency too low or too high,
- DLQ missing/misconfigured.

Cost risk:

- repeated receives,
- repeated Lambda invocations,
- repeated logs,
- repeated downstream calls.

Mitigation:

```text
1. Classify failure.
2. Stop retry storm.
3. Reduce batch size if partial failure bad.
4. Enable partial batch response.
5. Move poison messages to DLQ.
6. Scale consumers only if downstream can handle.
7. Replay carefully.
```

---

## 17.4 Scenario: Lambda Concurrency Starves Other Functions

Symptoms:

- unrelated Lambda functions throttled,
- one queue-backed function consuming account concurrency,
- account-level concurrency near limit.

Mitigation:

```text
1. Set reserved concurrency for noisy function.
2. Reserve capacity for critical functions.
3. Configure event source max concurrency.
4. Request quota increase if justified.
5. Split account/workload if needed.
```

---

## 17.5 Scenario: Secrets Manager Cost Spike

Symptoms:

- API call count high,
- many `GetSecretValue`,
- no matching increase in deploy count.

Likely causes:

- secret fetched per request/message,
- cache disabled,
- low TTL,
- every tenant has many secrets,
- refresh synchronized.

Mitigation:

```text
1. Add client-side caching.
2. Increase TTL within rotation SLA.
3. Add jitter.
4. Consolidate secret shape if appropriate.
5. Move non-secret config out.
6. Monitor calls per app instance.
```

---

## 18. Designing Cost-Aware Java Libraries

For an internal platform, create reusable modules:

```text
aws-client-factory
aws-call-metrics
aws-rate-limiter
aws-secret-provider
aws-s3-gateway
aws-sqs-consumer
aws-sns-publisher
aws-idempotency
aws-retry-policy
aws-cost-budget-test
```

### 18.1 AWS Client Factory Requirements

- one client per service/region/config,
- shared HTTP client where appropriate,
- explicit timeouts,
- explicit retry strategy,
- lifecycle close,
- metrics interceptor,
- request ID capture,
- test override.

### 18.2 Secret Provider Requirements

- cache,
- jitter,
- forced refresh,
- redaction,
- version awareness,
- metric for refresh/failure/stale use,
- no secret in exception/log.

### 18.3 SQS Consumer Requirements

- long polling,
- bounded concurrency,
- batch delete,
- partial failure,
- visibility extension,
- DLQ awareness,
- idempotency,
- graceful shutdown,
- metric per message outcome.

### 18.4 S3 Gateway Requirements

- no hot path LIST unless explicitly allowed,
- multipart cleanup,
- checksum,
- stream-safe upload/download,
- SSE-KMS awareness,
- object lifecycle classification,
- metric by operation and use case.

---

## 19. Cost and Quota Review Checklist

Use this before production.

### 19.1 General

- [ ] What is the expected traffic per business operation?
- [ ] What AWS calls happen per operation?
- [ ] What is the peak traffic assumption?
- [ ] What retry factor is assumed?
- [ ] What fan-out factor is assumed?
- [ ] What logs are emitted per operation?
- [ ] What payload sizes are expected?
- [ ] What quotas are closest to exhaustion?
- [ ] What cost alarms exist?
- [ ] Who owns the cost?

### 19.2 SDK

- [ ] Are clients reused?
- [ ] Are timeouts explicit?
- [ ] Is retry bounded?
- [ ] Is adaptive retry used only where appropriate?
- [ ] Are throttling metrics visible?
- [ ] Are request IDs logged?
- [ ] Is concurrency bounded?

### 19.3 Lambda

- [ ] Is reserved concurrency set where needed?
- [ ] Is provisioned concurrency justified?
- [ ] Is memory tuned using measurement?
- [ ] Is cold start acceptable?
- [ ] Are logs bounded?
- [ ] Are downstream calls timeout-protected?
- [ ] Are retries understood per event source?

### 19.4 S3

- [ ] Is lifecycle configured?
- [ ] Are incomplete multipart uploads cleaned?
- [ ] Is LIST avoided in hot path?
- [ ] Is object size distribution known?
- [ ] Is SSE-KMS cost/quota modeled?
- [ ] Is data transfer modeled?
- [ ] Is retention aligned to data classification?

### 19.5 SQS/SNS

- [ ] Is long polling enabled for SQS?
- [ ] Is batching used safely?
- [ ] Is DLQ configured and owned?
- [ ] Is fan-out modeled?
- [ ] Are filter policies used?
- [ ] Is idempotency implemented?
- [ ] Is visibility timeout correct?

### 19.6 Secrets/KMS/SSM

- [ ] Are secrets cached?
- [ ] Is refresh jittered?
- [ ] Is rotation behavior tested?
- [ ] Is KMS TPS modeled?
- [ ] Is decrypt avoided in hot loop?
- [ ] Are non-secrets kept out of Secrets Manager?
- [ ] Are values redacted?

### 19.7 CloudWatch

- [ ] Is retention set?
- [ ] Are logs structured?
- [ ] Is payload logging forbidden?
- [ ] Are metric dimensions bounded?
- [ ] Are query costs considered?
- [ ] Is log ingestion monitored?

---

## 20. Top 1% Mental Model

A strong Java AWS engineer does not merely know:

```text
S3Client.putObject()
SqsClient.receiveMessage()
Lambda handler
SecretsManagerClient.getSecretValue()
```

They know the hidden multiplication:

```text
throughput
× fan-out
× retry
× payload size
× logging
× encryption
× retention
× region/account quota
× downstream capacity
```

They design systems where each of these has an explicit budget.

The top-tier question is not:

> "Can AWS scale?"

The top-tier question is:

> "Which exact limit will we hit first, what will it cost, what signal warns us early, and what control prevents blast radius?"

---

## 21. Practical Design Exercise

Design a document processing flow:

```text
User uploads document
S3 event goes to SQS
Java Lambda validates document
Result event published to SNS
Audit entry stored
Failure goes to DLQ
```

Fill this table:

| Dimension | Estimate |
|---|---:|
| documents/day | |
| peak documents/sec | |
| average document size | |
| S3 PUT/document | |
| S3 GET/document | |
| SQS send/receive/delete/document | |
| Lambda invocations/document | |
| Lambda average duration | |
| Lambda memory | |
| SNS publishes/document | |
| SNS subscriptions | |
| KMS calls/document | |
| log bytes/document | |
| expected retry factor | |
| DLQ rate | |
| retention days | |

Then answer:

1. What is the cost per document?
2. What quota will fail first?
3. What happens if validation service slows by 10x?
4. What happens if KMS throttles?
5. What happens if a poison document enters the queue?
6. What happens if traffic doubles?
7. What happens if logs increase by 5x?
8. What metric alarms before users complain?
9. What concurrency cap protects downstream?
10. What is the replay procedure?

This is cost and quota engineering as system design.

---

## 22. References

Official AWS references used as grounding material:

- AWS Lambda quotas: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
- AWS Lambda concurrency: https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html
- AWS Lambda pricing: https://aws.amazon.com/lambda/pricing/
- Amazon S3 pricing: https://aws.amazon.com/s3/pricing/
- Amazon SQS quotas: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-quotas.html
- Amazon SQS visibility timeout and in-flight messages: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
- Amazon SQS long polling: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html
- Amazon SQS pricing: https://aws.amazon.com/sqs/pricing/
- Amazon SNS pricing: https://aws.amazon.com/sns/pricing/
- AWS KMS quotas: https://docs.aws.amazon.com/kms/latest/developerguide/limits.html
- AWS KMS request quotas: https://docs.aws.amazon.com/kms/latest/developerguide/requests-per-second.html
- AWS KMS throttling: https://docs.aws.amazon.com/kms/latest/developerguide/throttling.html
- AWS Secrets Manager pricing: https://aws.amazon.com/secrets-manager/pricing/
- AWS Service Quotas: https://docs.aws.amazon.com/servicequotas/latest/userguide/intro.html
- Requesting quota increases: https://docs.aws.amazon.com/servicequotas/latest/userguide/request-quota-increase.html
- AWS SDK retry behavior reference: https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- AWS SDK for Java 2.x retry strategy: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/retry-strategy.html
- CloudWatch pricing: https://aws.amazon.com/cloudwatch/pricing/
- CloudWatch billing/cost optimization: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_billing.html
- CloudWatch Logs billing: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/LogsBillingDetails.html

---

## 23. Ringkasan

Cost and quota engineering adalah kemampuan untuk melihat sistem AWS bukan sebagai kumpulan API, tetapi sebagai jaringan metered operations dengan batas kapasitas.

Yang harus selalu dihitung:

```text
business volume
× AWS calls per business operation
× retry factor
× fan-out factor
× payload size
× log volume
× retention
× encryption calls
× concurrency
× quota
```

Jika desain tidak punya angka, desain belum production-ready.

Dalam part berikutnya, kita akan masuk ke **Spring Boot Integration with AWS SDK**, yaitu bagaimana semua prinsip AWS SDK, client lifecycle, credential, timeout, observability, secret/config, LocalStack profile, dan graceful shutdown diterapkan dalam aplikasi Java/Spring Boot yang realistis.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-25-security-hardening-for-java-aws-applications.md">⬅️ Part 25 — Security Hardening for Java AWS Applications</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-27-spring-boot-integration-with-aws-sdk.md">Part 27 — Spring Boot Integration with AWS SDK ➡️</a>
</div>
