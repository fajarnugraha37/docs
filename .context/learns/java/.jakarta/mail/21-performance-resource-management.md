# Part 21 — Performance and Resource Management

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `21-performance-resource-management.md`  
> Scope: Java 8–25, JavaMail/`javax.mail`, Jakarta Mail/`jakarta.mail`, Jakarta Activation, SMTP, MIME, outbound and inbound mail workloads.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas observability: bagaimana mail subsystem dilihat dari luar melalui log, metrics, tracing, dan audit. Bagian ini membahas sisi internal runtime: **bagaimana mail subsystem menggunakan thread, socket, memory, heap, file, connection, queue, dan kapasitas provider**.

Di level pemula, email terlihat murah:

```java
mailSender.send(message);
```

Di production, email tidak murah. Email adalah kombinasi dari:

1. blocking network I/O;
2. protocol round-trip;
3. DNS/provider latency;
4. TLS handshake;
5. authentication;
6. MIME generation;
7. template rendering;
8. attachment reading;
9. base64 expansion;
10. retry;
11. queueing;
12. provider throttling;
13. memory allocation;
14. audit persistence;
15. failure classification.

Top 1% engineer tidak bertanya hanya:

> “Bagaimana cara kirim email?”

Tetapi:

> “Berapa banyak email yang bisa kita kirim tanpa membuat aplikasi utama lambat, heap naik, thread habis, provider rate-limit, SMTP connection leak, queue backlog, atau duplicate notification?”

---

## 1. Mental Model: Email Sending Is Blocking I/O with Expensive Payload Preparation

Jakarta Mail / JavaMail abstraction membuat sending terlihat seperti satu method call. Tetapi di bawahnya, outbound SMTP biasanya melakukan tahapan berikut:

```text
Application Thread
  |
  | render template
  | build MIME message
  | read attachment(s)
  | encode body/attachments
  | open socket
  | TLS handshake / STARTTLS
  | authenticate
  | SMTP MAIL FROM
  | SMTP RCPT TO x N
  | SMTP DATA
  | stream message bytes
  | wait for server response
  | close/reuse connection
  v
SMTP provider accepted / rejected / timeout
```

Setiap tahap memiliki cost.

### 1.1 Cost yang sering diremehkan

| Area | Cost | Failure impact |
|---|---:|---|
| Template rendering | CPU + allocation | latency naik, GC pressure |
| MIME construction | allocation + boundary/header processing | heap pressure, malformed message |
| Attachment reading | disk/network I/O + memory | OOM, slow send |
| Base64 encoding | CPU + 33% size expansion | payload lebih besar |
| SMTP connection | network + timeout | stuck thread |
| TLS handshake | CPU + latency | slow start |
| Authentication | network round-trip | auth failure/backoff |
| DATA phase | socket write | write hang without timeout |
| Retry | repeated work | duplicate/rate-limit storm |

### 1.2 Prinsip utama

Mail sending harus dipandang sebagai **bounded resource-consuming side effect**, bukan helper utility ringan.

Implikasinya:

1. jangan kirim email berat di request thread kecuali benar-benar kecil dan non-critical;
2. jangan melakukan SMTP call di dalam database transaction;
3. selalu pasang timeout;
4. batasi concurrency;
5. batasi ukuran attachment/message;
6. punya queue/outbox;
7. ukur latency dan backlog;
8. pisahkan performance concern dari business use case.

---

## 2. Blocking Nature of SMTP

SMTP adalah protocol berbasis command-response. Client mengirim command, server merespons. Untuk satu message, client bisa melewati beberapa round-trip.

Contoh konseptual:

```text
CLIENT -> SERVER: EHLO app.example.com
SERVER -> CLIENT: 250-...
CLIENT -> SERVER: STARTTLS
SERVER -> CLIENT: 220 Ready to start TLS
[TLS handshake]
CLIENT -> SERVER: EHLO app.example.com
SERVER -> CLIENT: 250-...
CLIENT -> SERVER: AUTH ...
SERVER -> CLIENT: 235 Authentication successful
CLIENT -> SERVER: MAIL FROM:<noreply@example.com>
SERVER -> CLIENT: 250 OK
CLIENT -> SERVER: RCPT TO:<user@example.net>
SERVER -> CLIENT: 250 OK
CLIENT -> SERVER: DATA
SERVER -> CLIENT: 354 End data with <CR><LF>.<CR><LF>
CLIENT -> SERVER: [message bytes]
SERVER -> CLIENT: 250 Accepted
```

Ini bukan operasi lokal. Jika server lambat menjawab, thread bisa menunggu. Jika socket write macet, thread bisa menunggu. Jika timeout tidak dikonfigurasi, beberapa provider default-nya bisa membuat operasi terlihat seperti “hang”.

Dokumentasi SMTP provider JavaMail/Jakarta Mail mencatat property penting seperti `mail.smtp.connectiontimeout`, `mail.smtp.timeout`, dan `mail.smtp.writetimeout`; default timeout dapat infinite. Dokumentasi Angus Mail juga menyebut `mail.smtp.writetimeout` diimplementasikan dengan `ScheduledExecutorService` per connection sehingga ada overhead tambahan per connection.

### 2.1 Blocking bukan selalu buruk

Blocking code punya keuntungan:

1. lebih sederhana;
2. stack trace lebih mudah;
3. exception flow lebih natural;
4. cocok untuk worker model;
5. cocok untuk Java 8–17 platform thread selama concurrency dibatasi;
6. cocok untuk Java 21+ virtual threads jika dipakai dengan hati-hati.

Yang buruk adalah **unbounded blocking**.

---

## 3. Timeout: Resource Protection Pertama

Timeout bukan “nice to have”. Timeout adalah batas atas konsumsi resource.

Untuk SMTP, minimal pikirkan tiga timeout:

```properties
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
```

### 3.1 Connection timeout

`mail.smtp.connectiontimeout` membatasi waktu membuat koneksi socket ke SMTP server.

Tanpa ini, masalah jaringan, firewall, routing, atau provider endpoint bisa membuat thread menunggu terlalu lama.

### 3.2 Read timeout

`mail.smtp.timeout` membatasi waktu menunggu response dari server.

Ini penting saat:

1. server menerima koneksi tapi lambat menjawab;
2. TLS/auth/DATA response delay;
3. provider sedang degraded;
4. network idle tetapi socket belum mati.

### 3.3 Write timeout

`mail.smtp.writetimeout` membatasi waktu menulis bytes ke socket.

Ini penting untuk email besar, terutama attachment. Tanpa write timeout, DATA phase bisa menggantung ketika network/server lambat menerima data.

Namun, ada trade-off: pada implementasi provider tertentu, write timeout dapat memiliki overhead thread/scheduled task per connection. Jadi tetap batasi jumlah connection paralel.

### 3.4 Timeout bukan SLA bisnis

Misalnya:

```text
connectiontimeout = 5s
read timeout       = 10s
write timeout      = 20s
```

Bukan berarti email pasti selesai dalam 35 detik. SMTP transaction terdiri dari beberapa read/write. Retry juga bisa menambah waktu. Timeout adalah guardrail per operasi, bukan end-to-end SLA.

Untuk SLA end-to-end, gunakan:

1. queue age SLO;
2. max attempts;
3. max delivery window;
4. deadline per notification;
5. dead-letter policy.

---

## 4. Request Thread vs Background Worker

### 4.1 Mengirim email langsung di request thread

Contoh buruk:

```java
@Transactional
public void submitApplication(SubmitCommand command) {
    Application app = applicationRepository.save(command.toEntity());

    MimeMessage message = buildEmail(app);
    mailSender.send(message); // blocking side effect inside business flow

    auditRepository.save(...);
}
```

Masalah:

1. user latency tergantung SMTP;
2. database transaction bisa terlalu lama;
3. rollback tidak otomatis membatalkan email yang sudah terkirim;
4. retry browser/user dapat menyebabkan duplicate email;
5. spike traffic dapat menghabiskan servlet/request thread;
6. provider outage bisa terlihat seperti aplikasi utama down.

### 4.2 Better pattern: record intent, send asynchronously

```text
HTTP request
  |
  | validate command
  | update business state
  | insert email_outbox row
  v
commit transaction

Background worker
  |
  | claim pending email
  | render/build MIME
  | send SMTP
  | classify result
  | update outbox status
  v
metrics/audit
```

Dengan pattern ini, mail subsystem punya resource pool sendiri dan tidak langsung mencemari request path.

### 4.3 Kapan boleh synchronous send?

Synchronous send masih bisa diterima untuk kasus kecil:

1. internal tooling;
2. low-volume admin action;
3. development/test utility;
4. email bukan bagian dari critical transaction;
5. timeout ketat;
6. error tidak membuat state bisnis ambigu.

Tetapi untuk production enterprise workflow, default desain sebaiknya outbox/worker.

---

## 5. Thread Pool Sizing for Java 8–17 Platform Threads

Pada Java 8 sampai Java 17, kebanyakan aplikasi memakai platform thread untuk worker. Karena SMTP sending blocking, jumlah thread menentukan concurrency.

### 5.1 Jangan pakai unbounded executor

Anti-pattern:

```java
ExecutorService executor = Executors.newCachedThreadPool();
```

Masalah:

1. thread bisa tumbuh tanpa batas;
2. setiap stuck SMTP call mengikat thread;
3. memory stack thread naik;
4. provider bisa dibanjiri;
5. retry storm makin parah.

### 5.2 Gunakan bounded executor

Contoh:

```java
int workers = 8;
int queueCapacity = 500;

ThreadPoolExecutor executor = new ThreadPoolExecutor(
        workers,
        workers,
        0L,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(queueCapacity),
        new ThreadFactory() {
            private final AtomicInteger seq = new AtomicInteger();

            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r);
                t.setName("mail-worker-" + seq.incrementAndGet());
                t.setDaemon(false);
                return t;
            }
        },
        new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Tetapi untuk outbox polling, sering lebih baik tidak memasukkan semua row ke executor queue. Worker bisa langsung claim batch kecil dari database.

### 5.3 Estimasi throughput sederhana

Formula kasar:

```text
throughput/sec ≈ concurrency / avg_send_latency_seconds
```

Jika:

```text
worker = 10
avg send latency = 2s
```

Maka throughput kasar:

```text
10 / 2 = 5 email/sec
```

Kalau provider quota hanya 2 email/sec, maka worker 10 tidak membantu; malah menyebabkan throttling.

### 5.4 Sizing harus mengikuti bottleneck

Bottleneck bisa ada di:

1. SMTP provider quota;
2. network bandwidth;
3. attachment size;
4. template rendering CPU;
5. database outbox claim/update;
6. provider per-domain throttle;
7. recipient domain limit;
8. JVM heap.

Top 1% engineer tidak menaikkan thread hanya karena backlog naik. Ia mencari bottleneck dulu.

---

## 6. Virtual Threads in Java 21+

Java 21 memperkenalkan virtual threads sebagai fitur final. Virtual threads tetap `java.lang.Thread`, tetapi tidak terikat permanen ke OS thread. Saat virtual thread melakukan blocking I/O, runtime dapat mensuspend virtual thread dan membebaskan OS thread untuk pekerjaan lain.

Ini sangat menarik untuk SMTP karena SMTP adalah blocking I/O.

### 6.1 Virtual threads membuat blocking lebih scalable, bukan unlimited

Dengan virtual threads:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (MailJob job : jobs) {
        executor.submit(() -> mailSender.send(job));
    }
}
```

Kode blocking tetap sederhana, tetapi jumlah virtual thread bisa jauh lebih besar daripada platform thread.

Namun, ini bukan berarti boleh mengirim 50.000 email paralel.

Kenapa?

1. SMTP provider tetap punya quota;
2. socket tetap resource OS;
3. connection tetap resource server/provider;
4. attachment tetap memakai disk/network/memory;
5. `mail.smtp.writetimeout` bisa punya overhead per connection;
6. database update tetap bottleneck;
7. downstream recipient domain bisa throttle;
8. retry storm tetap bisa terjadi.

Virtual threads menyelesaikan masalah **thread blocking cost**, bukan masalah **external capacity**.

### 6.2 Pattern yang benar

Gunakan virtual thread untuk menyederhanakan blocking worker, tetapi tetap gunakan concurrency limiter.

```java
public final class BoundedVirtualThreadMailDispatcher {
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Semaphore permits;
    private final MailGateway gateway;

    public BoundedVirtualThreadMailDispatcher(int maxConcurrentSends, MailGateway gateway) {
        this.permits = new Semaphore(maxConcurrentSends);
        this.gateway = gateway;
    }

    public Future<MailSendResult> submit(MailJob job) {
        return executor.submit(() -> {
            permits.acquire();
            try {
                return gateway.send(job);
            } finally {
                permits.release();
            }
        });
    }
}
```

Concurrency limit tetap eksplisit.

### 6.3 Pinning dan blocking caveat

Virtual threads bagus untuk blocking I/O yang didukung runtime. Tetapi tetap hindari:

1. synchronized block panjang sekitar blocking I/O;
2. native/blocking library yang tidak ramah virtual thread;
3. memegang lock saat SMTP send;
4. blocking di critical section.

Buruk:

```java
synchronized (tenantLock) {
    mailSender.send(message); // jangan tahan monitor selama network I/O
}
```

Lebih baik:

```java
MailPermit permit = tenantLimiter.acquire(tenantId);
try {
    mailSender.send(message);
} finally {
    permit.release();
}
```

---

## 7. Connection Reuse and Transport Lifecycle

### 7.1 `Transport.send(message)` convenience method

Banyak contoh memakai:

```java
Transport.send(message);
```

Ini sederhana, tetapi biasanya membuka koneksi, mengirim, lalu menutup. Untuk low volume, ini cukup.

Untuk high volume, connection setup/TLS/auth overhead bisa signifikan.

### 7.2 Manual `Transport` reuse

```java
Session session = Session.getInstance(props);
Transport transport = session.getTransport("smtp");

try {
    transport.connect(host, port, username, password);

    for (MimeMessage message : batch) {
        transport.sendMessage(message, message.getAllRecipients());
    }
} finally {
    try {
        transport.close();
    } catch (MessagingException ignored) {
        // log safely if needed
    }
}
```

Keuntungan:

1. mengurangi connection overhead;
2. mengurangi TLS/auth overhead;
3. throughput lebih stabil untuk batch kecil;
4. lebih mudah mengelola connection lifecycle eksplisit.

Risiko:

1. connection bisa stale;
2. provider bisa menutup idle connection;
3. failure satu message bisa merusak connection state;
4. partial failure harus ditangani;
5. connection reuse lintas tenant bisa salah identity;
6. perlu close di finally.

### 7.3 Jangan reuse connection secara global tanpa policy

Anti-pattern:

```java
static Transport globalTransport;
```

Masalah:

1. thread-safety tidak jelas;
2. lifecycle kacau;
3. credential rotation sulit;
4. stale connection;
5. tenant identity leak;
6. failure recovery buruk.

### 7.4 Practical connection policy

Untuk enterprise workload, lebih aman mulai dari:

```text
low volume:  one connection per send
medium:      one connection per worker batch
high volume: provider-specific pool/gateway with strict lifecycle
```

Connection reuse harus diukur. Jangan asumsi selalu lebih baik.

---

## 8. Attachment Memory and Payload Expansion

Attachment adalah sumber performance problem paling umum.

### 8.1 Base64 expansion

Binary attachment biasanya dikirim sebagai base64. Ukuran naik sekitar 33% sebelum overhead line wrapping dan MIME headers.

Contoh:

```text
10 MB PDF   -> ±13.3 MB base64 payload
20 MB ZIP   -> ±26.6 MB base64 payload
```

Jika Anda mengirim 10 email paralel dengan attachment 20 MB, bytes yang diproses bisa ratusan MB.

### 8.2 Jangan selalu pakai byte array

Anti-pattern:

```java
byte[] fileBytes = Files.readAllBytes(path);
MimeBodyPart attachment = new MimeBodyPart();
attachment.setDataHandler(new DataHandler(new ByteArrayDataSource(fileBytes, "application/pdf")));
```

Ini membuat seluruh file berada di heap.

Lebih baik untuk file lokal:

```java
MimeBodyPart attachment = new MimeBodyPart();
attachment.attachFile(file); // provider can stream from file depending on implementation path
```

Atau eksplisit:

```java
DataSource source = new FileDataSource(file);
MimeBodyPart part = new MimeBodyPart();
part.setDataHandler(new DataHandler(source));
part.setFileName(file.getName());
```

`DataHandler` dengan `DataSource` memberi akses stream ke data. Jakarta Activation mendefinisikan `DataHandler`/`DataSource` untuk mengenkapsulasi akses data dan MIME type.

### 8.3 Remote attachment

Jika attachment berasal dari object storage, jangan download semua ke memory tanpa batas.

Buruk:

```java
byte[] bytes = s3Client.getObjectAsBytes(key).asByteArray();
```

Lebih baik:

1. stream ke temporary file;
2. validate size;
3. scan if required;
4. attach from file;
5. cleanup temporary file after send;
6. or send secure download link instead of attachment.

### 8.4 Attachment size policy

Contoh policy:

```text
max single attachment size: 10 MB
max total attachment size: 15 MB
max message raw MIME size: 20 MB
max attachment count: 5
large document strategy: secure link
```

Ingat: provider/mailbox sering punya limit message size sendiri. Bahkan jika aplikasi bisa membuat MIME 80 MB, provider atau recipient server mungkin menolak.

### 8.5 Heap budget thinking

Untuk parallel send dengan attachment:

```text
estimated_heap_pressure ≈ concurrency × per_message_allocation
```

Jika per message membuat:

```text
rendered HTML: 200 KB
metadata/object graph: 100 KB
attachment byte[]: 15 MB
base64 intermediate: 20 MB
```

Maka 10 parallel sends bisa menciptakan ratusan MB allocation pressure.

Target desain: hindari intermediate byte array besar.

---

## 9. MIME Construction Cost

MIME bukan hanya string concat. Message dapat terdiri dari:

```text
multipart/mixed
  multipart/related
    multipart/alternative
      text/plain
      text/html
    inline image
  attachment 1
  attachment 2
```

Setiap part punya headers, content type, transfer encoding, boundary, dan stream.

### 9.1 Jangan render berulang tanpa alasan

Buruk:

```java
String html = templateEngine.render(template, data);
String text = htmlToTextConverter.convert(templateEngine.render(template, data));
```

Lebih baik:

```java
RenderedEmail rendered = renderer.render(template, data);
String html = rendered.html();
String text = rendered.text();
```

### 9.2 Cache yang aman

Boleh cache:

1. compiled template;
2. static assets metadata;
3. tenant SMTP config for short TTL;
4. template schema.

Jangan cache:

1. rendered email berisi PII tanpa policy;
2. `MimeMessage` mutable object lintas request;
3. `Transport` global;
4. attachment byte array besar.

### 9.3 `MimeMessage` bukan domain object

Jangan simpan `MimeMessage` sebagai business state utama. Lebih baik simpan:

1. template ID;
2. template version;
3. variable snapshot;
4. recipient snapshot;
5. attachment reference;
6. send status.

`MimeMessage` adalah infrastructure representation.

---

## 10. Queue Backpressure

Mail subsystem perlu backpressure agar tidak merusak sistem utama.

### 10.1 Backlog sebagai sinyal kapasitas

Queue/outbox backlog naik bisa berarti:

1. traffic naik;
2. provider lambat;
3. SMTP auth gagal;
4. rate limit terlalu rendah;
5. worker mati;
6. attachment terlalu besar;
7. DB claim lambat;
8. retry storm.

Jangan langsung menaikkan worker.

### 10.2 Backpressure point

Backpressure bisa diterapkan di beberapa layer:

| Layer | Contoh |
|---|---|
| API | reject/slow non-critical notification creation |
| Domain | coalesce duplicate notification |
| Outbox | max pending per tenant/type |
| Worker | max concurrent sends |
| Provider | token bucket rate limit |
| Attachment | max size / link fallback |
| Retry | exponential backoff + jitter |

### 10.3 Token bucket sederhana

```java
public final class SimpleRateLimiter {
    private final Semaphore permits;
    private final ScheduledExecutorService scheduler;

    public SimpleRateLimiter(int permitsPerSecond) {
        this.permits = new Semaphore(permitsPerSecond);
        this.scheduler = Executors.newSingleThreadScheduledExecutor();
        this.scheduler.scheduleAtFixedRate(() -> {
            int missing = permitsPerSecond - permits.availablePermits();
            if (missing > 0) {
                permits.release(missing);
            }
        }, 1, 1, TimeUnit.SECONDS);
    }

    public void acquire() throws InterruptedException {
        permits.acquire();
    }
}
```

Untuk production, gunakan implementation yang matang, distributed jika perlu, dan observability yang jelas.

---

## 11. Worker Claim Strategy

Jika menggunakan database outbox, worker perlu mengambil job tanpa double processing.

### 11.1 Batch claim

Konseptual:

```sql
SELECT id
FROM email_outbox
WHERE status = 'PENDING'
  AND next_attempt_at <= CURRENT_TIMESTAMP
ORDER BY priority DESC, created_at ASC
FETCH FIRST 50 ROWS ONLY
FOR UPDATE SKIP LOCKED;
```

Kemudian update ke `PROCESSING` dengan `locked_by`, `locked_until`, `attempt_no`.

### 11.2 Batch size bukan throughput target

Batch size adalah jumlah job yang di-claim per transaksi. Concurrency adalah jumlah job yang dikirim paralel.

Contoh:

```text
batch size = 50
concurrency = 8
```

Artinya worker bisa claim 50, tapi hanya 8 yang aktif mengirim bersamaan.

### 11.3 Lock timeout

Worker bisa mati setelah set job `PROCESSING`. Maka perlu:

```text
locked_until
heartbeat
reaper process
max processing duration
```

Rule:

```text
if status = PROCESSING and locked_until < now -> eligible for retry/recovery
```

---

## 12. Retry Cost and Retry Storm

Retry meningkatkan reliability, tetapi juga bisa memperburuk outage.

### 12.1 Retry storm pattern

```text
09:00 provider outage starts
09:01 all sends fail
09:02 app retries immediately
09:03 failures double
09:04 queue grows
09:05 provider recovers partially
09:06 app floods provider
09:07 provider throttles
```

### 12.2 Retry policy yang sehat

```text
attempt 1: immediate
attempt 2: +1 minute ± jitter
attempt 3: +5 minutes ± jitter
attempt 4: +15 minutes ± jitter
attempt 5: +1 hour ± jitter
then dead-letter/manual review
```

### 12.3 Retry classification

Retry hanya untuk transient failure:

| Failure | Retry? |
|---|---:|
| connection timeout | yes |
| read timeout | yes |
| write timeout | yes, with caution |
| 4xx SMTP | usually yes |
| provider rate limit | yes, delayed |
| auth failed | no or circuit-break globally |
| invalid recipient | no |
| content rejected | usually no until content fixed |
| message too large | no unless transformed |

### 12.4 Circuit breaker

Jika semua send gagal karena auth/provider outage, jangan retry semua job agresif. Aktifkan circuit breaker:

```text
if auth_failure_rate > threshold:
  pause sending for tenant/provider
  mark attempts as delayed, not failed repeatedly
  alert operator
```

---

## 13. Per-Tenant and Per-Provider Isolation

Enterprise system sering multi-tenant atau multi-agency.

Jangan biarkan satu tenant membanjiri seluruh mail subsystem.

### 13.1 Isolation dimensions

1. per tenant;
2. per mail type;
3. per priority;
4. per provider;
5. per recipient domain;
6. per attachment-heavy workload.

### 13.2 Priority lanes

Contoh:

```text
HIGH: password reset, OTP, legal deadline notice
NORMAL: workflow notification
LOW: digest, report, announcement
```

Jangan biarkan low-priority bulk digest memenuhi queue sehingga OTP/password reset terlambat.

### 13.3 Worker pool separation

```text
critical-mail-worker: concurrency 5, rate limit 5/s
normal-mail-worker:   concurrency 10, rate limit 10/s
bulk-mail-worker:     concurrency 3, rate limit 2/s
```

Atau satu worker pool dengan priority queue dan fairness policy.

---

## 14. Network Bandwidth and Message Size

SMTP DATA phase mengirim seluruh MIME payload ke provider.

Jika message besar, bottleneck bukan hanya thread, tapi bandwidth.

### 14.1 Estimasi bandwidth

```text
message size: 5 MB
send rate:    10 email/sec
bandwidth:    50 MB/sec ≈ 400 Mbps
```

Ini belum termasuk TLS overhead, retry, dan network variability.

### 14.2 Consequence

Untuk attachment-heavy workload:

1. lebih baik kirim secure link;
2. pisahkan worker attachment-heavy;
3. lower concurrency;
4. monitor socket write latency;
5. enforce max size;
6. compress hanya jika aman dan berguna;
7. jangan attach file yang sudah tersedia di portal internal.

---

## 15. SMTP Provider Rate Limit and Quota

Provider biasanya punya:

1. per-second send rate;
2. daily quota;
3. message size limit;
4. recipient count limit;
5. connection count limit;
6. per-domain throttling;
7. suppression/bounce rules.

Worker sizing harus mengikuti quota tersebut.

### 15.1 Formula dengan quota

```text
max_effective_throughput = min(
  app_worker_capacity,
  provider_rate_limit,
  network_capacity,
  db_outbox_capacity,
  template_render_capacity,
  recipient_domain_acceptance
)
```

Jika provider rate limit 14 email/sec, menjalankan worker yang bisa 100 email/sec hanya akan membuat throttling dan retry.

### 15.2 Adaptive throttling

Jika provider memberi sinyal rate limit:

1. turunkan send rate sementara;
2. delay retry;
3. jangan langsung dead-letter;
4. alert jika berlangsung lama;
5. catat provider response.

---

## 16. Garbage Collection and Allocation Pressure

Mail workloads menghasilkan banyak short-lived object:

1. rendered string;
2. template context map;
3. address objects;
4. MIME body part;
5. byte buffers;
6. base64 encoding buffers;
7. exception objects during failure storm;
8. log strings if debug enabled.

### 16.1 Java 8 vs Java 17/21/25

Pada Java 8, GC tuning lebih sensitif, dan banyak sistem legacy memakai CMS/Parallel/G1 tergantung konfigurasi. Pada Java modern, G1 default sudah lebih matang; ZGC/Shenandoah tersedia untuk low-latency use case. Namun, GC modern tidak menyelamatkan desain yang membaca ratusan attachment ke heap.

### 16.2 Reduce allocation

1. avoid `readAllBytes` for large attachment;
2. avoid repeated template rendering;
3. avoid huge string concat;
4. use streaming/file-backed data source;
5. cap concurrency;
6. avoid debug logging raw MIME in production;
7. reuse immutable config, not mutable message;
8. store attachment reference, not attachment bytes.

### 16.3 Debug mode hazard

`Session.setDebug(true)` atau SMTP debug output bisa menghasilkan log besar dan sensitif. Ini juga meningkatkan I/O dan allocation.

Gunakan hanya:

1. di lower environment;
2. dengan redaction output stream;
3. sementara;
4. untuk targeted tenant/job;
5. tidak untuk semua traffic production.

---

## 17. Measuring Performance Correctly

Jangan ukur hanya `send()` duration.

Pisahkan timing:

```text
outbox_claim_latency
render_latency
mime_build_latency
attachment_fetch_latency
smtp_connect_latency
smtp_send_latency
provider_response_latency
status_update_latency
total_job_latency
queue_age
```

### 17.1 Timer boundary

Contoh domain timing:

```java
long start = System.nanoTime();
try {
    RenderedEmail rendered = renderer.render(job.template(), job.variables());
    metrics.timer("mail.render").record(System.nanoTime() - start, TimeUnit.NANOSECONDS);

    long mimeStart = System.nanoTime();
    MimeMessage message = composer.compose(rendered, job);
    metrics.timer("mail.mime.build").record(System.nanoTime() - mimeStart, TimeUnit.NANOSECONDS);

    long smtpStart = System.nanoTime();
    gateway.send(message);
    metrics.timer("mail.smtp.send").record(System.nanoTime() - smtpStart, TimeUnit.NANOSECONDS);
} catch (Exception e) {
    // classify
}
```

### 17.2 Percentiles matter

Average latency sering menipu.

Pantau:

1. p50;
2. p90;
3. p95;
4. p99;
5. max;
6. queue age p95/p99.

Jika p50 500ms tapi p99 45s, user/system tetap bisa merasakan incident.

---

## 18. Capacity Planning

### 18.1 Input yang dibutuhkan

Untuk capacity planning, kumpulkan:

1. peak email/hour;
2. peak email/minute;
3. average SMTP latency;
4. p95 SMTP latency;
5. message size distribution;
6. attachment ratio;
7. provider quota;
8. retry rate;
9. bounce/failure rate;
10. critical vs bulk split;
11. allowed delivery window;
12. queue storage growth.

### 18.2 Contoh calculation

Misal:

```text
peak demand:       60,000 email/hour
provider quota:    20 email/sec
avg send latency:  1.5 sec
p95 send latency:  5 sec
```

Demand per second:

```text
60,000 / 3600 = 16.67 email/sec
```

Concurrency based on avg latency:

```text
16.67 × 1.5 ≈ 25 concurrent sends
```

Concurrency based on p95 latency:

```text
16.67 × 5 ≈ 84 concurrent sends
```

Tetapi provider quota 20/sec. Jadi Anda tidak boleh hanya menaikkan concurrency ke 84 tanpa rate limiter. Better:

```text
rate limit: 16–18/sec steady
concurrency: enough to cover latency, e.g. 30–50
queue absorbs spikes
retry delayed with jitter
```

### 18.3 Backlog drain time

Jika backlog 100,000 email dan effective throughput 10/sec:

```text
100,000 / 10 = 10,000 sec ≈ 2.78 hours
```

Jika SLA delivery 30 menit, kapasitas tidak cukup.

---

## 19. Performance Anti-Patterns

### 19.1 Send inside DB transaction

Dampak:

1. transaction lama;
2. lock lama;
3. rollback side effect mismatch;
4. latency user naik.

### 19.2 Unbounded async

```java
CompletableFuture.runAsync(() -> mailSender.send(message));
```

Tanpa executor eksplisit, ini bisa memakai common pool dan mengganggu workload lain.

### 19.3 Raw attachment bytes in queue

Menyimpan attachment bytes besar di outbox table bisa membuat:

1. DB bloat;
2. backup lambat;
3. query lambat;
4. replication pressure;
5. memory pressure saat fetch.

Lebih baik simpan reference ke object storage/document store dengan retention policy.

### 19.4 One email with thousands of recipients

Masalah:

1. privacy risk;
2. partial failure sulit;
3. personalization impossible;
4. deliverability buruk;
5. provider recipient limit.

### 19.5 No timeout

Paling berbahaya. Satu provider incident bisa mengikat semua worker thread.

### 19.6 Debug full MIME in production

Masalah:

1. PII leak;
2. log volume explosion;
3. latency;
4. compliance issue.

### 19.7 Retry immediately forever

Masalah:

1. retry storm;
2. provider throttling;
3. duplicate risk;
4. backlog explosion.

---

## 20. Reference Runtime Architecture

```text
                         +-------------------+
Business Transaction --->| email_outbox      |
                         | status=PENDING    |
                         +---------+---------+
                                   |
                                   v
                         +-------------------+
                         | Mail Scheduler    |
                         | claim small batch |
                         +---------+---------+
                                   |
                 +-----------------+-----------------+
                 |                                   |
                 v                                   v
        +-------------------+              +-------------------+
        | Rate Limiter      |              | Priority/Fairness |
        | provider/tenant   |              | critical vs bulk  |
        +---------+---------+              +---------+---------+
                  |                                  |
                  +----------------+-----------------+
                                   v
                         +-------------------+
                         | Worker Executor   |
                         | bounded           |
                         +---------+---------+
                                   |
                                   v
                         +-------------------+
                         | Render Template   |
                         +---------+---------+
                                   |
                                   v
                         +-------------------+
                         | Build MIME        |
                         | stream attachment |
                         +---------+---------+
                                   |
                                   v
                         +-------------------+
                         | SMTP Gateway      |
                         | timeout + TLS     |
                         +---------+---------+
                                   |
                                   v
                         +-------------------+
                         | Classify Result   |
                         | retry/dead-letter |
                         +-------------------+
```

---

## 21. Java 8 Implementation Posture

Untuk Java 8 legacy:

1. gunakan bounded `ThreadPoolExecutor`;
2. selalu set SMTP timeout;
3. hindari `CompletableFuture` common pool untuk sending;
4. hindari loading attachment besar ke heap;
5. gunakan JavaMail `javax.mail` dependency yang kompatibel;
6. pastikan Activation dependency tersedia;
7. gunakan outbox DB polling;
8. monitor thread pool active count, queue, completed tasks;
9. jangan mengandalkan virtual threads;
10. lakukan load test lebih konservatif.

Contoh property:

```properties
mail.smtp.host=smtp.example.com
mail.smtp.port=587
mail.smtp.auth=true
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=15000
```

---

## 22. Java 21/25 Implementation Posture

Untuk Java 21+:

1. virtual threads dapat dipakai untuk blocking mail send;
2. tetap batasi concurrency dengan semaphore/rate limiter;
3. jangan tahan monitor/lock saat blocking I/O;
4. gunakan structured concurrency jika sesuai arsitektur;
5. tetap gunakan timeout;
6. tetap hindari byte array attachment besar;
7. manfaatkan observability modern;
8. gunakan Jakarta Mail/Angus modern;
9. pisahkan provider quota dari executor size;
10. uji behaviour saat provider lambat.

Virtual thread bukan alasan untuk menghapus queue/outbox. Queue tetap dibutuhkan untuk reliability, audit, retry, dan backpressure.

---

## 23. Load Testing Mail Subsystem

### 23.1 Jangan load test ke provider production tanpa koordinasi

Gunakan fake SMTP atau sandbox provider.

Tools yang umum:

1. GreenMail;
2. Mailpit/MailHog;
3. provider sandbox;
4. local mock SMTP server;
5. custom slow SMTP test server.

### 23.2 Scenario penting

Test:

1. 1,000 small email no attachment;
2. 1,000 HTML email with template;
3. 100 email with 5 MB attachment;
4. provider slow response;
5. provider connection timeout;
6. provider write stall;
7. 4xx transient failure;
8. 5xx permanent failure;
9. rate limit simulation;
10. worker restart while jobs PROCESSING;
11. retry backlog drain;
12. duplicate job submission;
13. queue priority under bulk load.

### 23.3 Metrics during test

Measure:

1. throughput/sec;
2. p95/p99 SMTP send latency;
3. queue age;
4. heap usage;
5. GC pause;
6. thread count;
7. socket count;
8. DB CPU/query time;
9. retry rate;
10. failed classification distribution;
11. log volume.

---

## 24. Practical Configuration Profiles

### 24.1 Low volume internal app

```text
concurrency: 2-5
rate limit: provider default or low
connection reuse: not necessary
attachment: small only
timeout: mandatory
outbox: recommended
```

### 24.2 Transactional enterprise app

```text
concurrency: 5-30 depending quota/latency
rate limit: explicit per provider/tenant
outbox: mandatory
template versioning: mandatory
attachment size policy: mandatory
metrics/alerting: mandatory
```

### 24.3 Bulk notification workload

```text
concurrency: calculated
rate limit: strict
priority isolation: mandatory
suppression list: mandatory
unsubscribe/compliance: mandatory
backoff/jitter: mandatory
provider feedback loop: mandatory
```

### 24.4 Attachment-heavy workflow

```text
concurrency: low
secure link preferred
file-backed attachment source
message size cap
write timeout tuned
separate worker lane
```

---

## 25. Design Checklist

Sebelum mail subsystem production, jawab pertanyaan ini:

### Runtime and thread

- [ ] Apakah send dilakukan di background worker, bukan request thread utama?
- [ ] Apakah executor bounded?
- [ ] Apakah virtual thread tetap dibatasi concurrency-nya?
- [ ] Apakah tidak ada blocking I/O di dalam synchronized lock?

### Timeout

- [ ] Apakah `connectiontimeout` diset?
- [ ] Apakah read timeout diset?
- [ ] Apakah write timeout diset?
- [ ] Apakah timeout sesuai message size?

### Memory

- [ ] Apakah attachment besar tidak dibaca penuh ke heap?
- [ ] Apakah ada max attachment size?
- [ ] Apakah ada max total message size?
- [ ] Apakah raw MIME tidak dilog sembarangan?

### Queue and retry

- [ ] Apakah ada outbox?
- [ ] Apakah retry punya exponential backoff + jitter?
- [ ] Apakah permanent failure tidak di-retry terus?
- [ ] Apakah ada dead-letter?
- [ ] Apakah ada recovery untuk stuck PROCESSING?

### Throughput

- [ ] Apakah worker sizing mengikuti provider quota?
- [ ] Apakah ada rate limiter?
- [ ] Apakah queue age dimonitor?
- [ ] Apakah backlog drain time diketahui?

### Isolation

- [ ] Apakah critical email tidak kalah oleh bulk email?
- [ ] Apakah tenant noisy bisa dibatasi?
- [ ] Apakah attachment-heavy workload dipisahkan?

---

## 26. Top 1% Mental Model

Engineer biasa melihat email sebagai utility.

Engineer senior melihat email sebagai integration.

Engineer top 1% melihat email sebagai **bounded, observable, asynchronous, failure-prone delivery subsystem**.

Perbedaannya ada pada invariants:

```text
No unbounded blocking.
No unbounded concurrency.
No unbounded retry.
No unbounded attachment memory.
No SMTP call inside transaction.
No critical/bulk queue starvation.
No provider quota ignorance.
No raw PII debug logging.
No assumption that accepted means delivered.
```

Performance mail subsystem bukan hanya “lebih cepat kirim email”. Performance yang benar adalah:

1. aplikasi utama tetap responsif;
2. worker tidak kehabisan thread/socket/memory;
3. provider tidak dibanjiri;
4. queue bisa drain dalam SLA;
5. retry tidak menjadi storm;
6. attachment tidak membuat heap collapse;
7. critical notification tetap prioritas;
8. operator bisa melihat bottleneck dengan cepat;
9. failure tidak membuat state bisnis ambigu.

---

## 27. Ringkasan

Bagian ini membahas performance dan resource management untuk mail subsystem Java/Jakarta Mail.

Poin utama:

1. SMTP adalah blocking network I/O.
2. Timeout wajib: connection, read, write.
3. Sending sebaiknya dipisahkan dari request transaction melalui outbox/worker.
4. Platform thread perlu bounded executor.
5. Virtual thread Java 21+ membantu blocking scalability, tetapi bukan pengganti rate limit/concurrency control.
6. Attachment adalah sumber memory dan bandwidth pressure besar.
7. Base64 membuat payload lebih besar.
8. Connection reuse bisa membantu, tetapi punya lifecycle risk.
9. Retry tanpa backoff bisa menjadi retry storm.
10. Provider quota adalah constraint utama dalam throughput.
11. Backpressure harus ada di API/domain/outbox/worker/provider layer.
12. Capacity planning harus memakai throughput, latency, quota, size distribution, dan backlog drain time.
13. Load testing harus mensimulasikan latency, failure, rate limit, dan attachment-heavy workload.

---

## 28. Referensi

- Jakarta Mail API documentation — `Session`, `Transport`, `Message`, `MimeMessage`, SMTP provider properties.
- Eclipse Angus Mail documentation — SMTP provider properties, timeout behavior, Jakarta Mail compatible implementation.
- Oracle Java 21 documentation — Virtual Threads and blocking I/O behavior.
- Jakarta Activation specification/API — `DataHandler`, `DataSource`, MIME data access abstraction.
- RFC 5321 — Simple Mail Transfer Protocol.
- RFC 5322 — Internet Message Format.

---

## 29. Status Seri

Progress saat ini:

```text
[x] Part 0  — Orientation: Email as a Distributed System
[x] Part 1  — Email Protocol Stack: SMTP, MIME, POP3, IMAP
[x] Part 2  — JavaMail to Jakarta Mail: History, Namespace, Compatibility, Migration
[x] Part 3  — Core API: Session, Store, Folder, Transport, Message
[x] Part 4  — SMTP Sending: Properties, Transport, Timeout, TLS, Auth
[x] Part 5  — MIME Message Construction: Text, HTML, Charset, Headers
[x] Part 6  — Multipart Email: Alternative, Mixed, Related, Nested Structure
[x] Part 7  — Attachment Handling and Jakarta Activation
[x] Part 8  — HTML Email Engineering: Templates, CSS, Images, Client Compatibility
[x] Part 9  — Mail Addressing, Identity, and Header Semantics
[x] Part 10 — Error Model: MessagingException, SendFailedException, SMTPAddressFailedException
[x] Part 11 — Reliable Email Delivery Architecture: Queue, Outbox, Retry, Idempotency
[x] Part 12 — Bulk, Batch, and Rate-Limited Sending
[x] Part 13 — Security Deep Dive: TLS, Credential, OAuth2, Secret Management
[x] Part 14 — Deliverability Fundamentals: SPF, DKIM, DMARC, Reputation, Bounce
[x] Part 15 — Inbound Mail: IMAP/POP3, Store, Folder, Message Reading
[x] Part 16 — MIME Parsing: Reading Complex Messages Safely
[x] Part 17 — Jakarta Mail in Jakarta EE Containers
[x] Part 18 — Jakarta Mail in Spring Boot and Modern Java Applications
[x] Part 19 — Testing Mail Systems
[x] Part 20 — Observability: Logs, Metrics, Tracing, Audit
[x] Part 21 — Performance and Resource Management
[ ] Part 22 — Provider Integration Patterns: SMTP Relay vs API-Based Email Provider
[ ] Part 23 — Bounce, Complaint, Webhook, and Delivery Feedback Loop
[ ] Part 24 — Template Architecture and Domain Notification Design
[ ] Part 25 — Compliance, Privacy, and Regulatory-Grade Mail Systems
[ ] Part 26 — Advanced MIME and Internationalization
[ ] Part 27 — Failure Modelling and Production Incident Playbook
[ ] Part 28 — End-to-End Reference Implementation: Java 8 Legacy and Java 21/25 Modern
[ ] Part 29 — Top 1% Design Review: Evaluating a Mail Subsystem Like an Architect
```

Seri **belum selesai**. Bagian berikutnya adalah:

```text
Part 22 — Provider Integration Patterns: SMTP Relay vs API-Based Email Provider
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 20 — Observability: Logs, Metrics, Tracing, Audit](./20-observability-logs-metrics-tracing-audit.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 22 — Provider Integration Patterns: SMTP Relay vs API-Based Email Provider](./22-provider-integration-smtp-vs-api.md)
