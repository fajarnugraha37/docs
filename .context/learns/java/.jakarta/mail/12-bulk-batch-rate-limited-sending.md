# Part 12 — Bulk, Batch, and Rate-Limited Sending

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `12-bulk-batch-rate-limited-sending.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, SMTP, enterprise mail subsystem design  
> Position: setelah reliability/outbox, sebelum security/deliverability

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas reliability: outbox, retry, idempotency, dan state machine. Bagian ini membahas masalah yang muncul ketika email tidak lagi dikirim satu-dua, tetapi puluhan, ratusan, ribuan, atau jutaan.

Tujuan bagian ini bukan membuat sistem spam, bukan campaign marketing engine, dan bukan menggantikan email service provider. Tujuannya adalah membuat engineer mampu mendesain **bulk dan batch email sending** yang:

1. tidak menjatuhkan aplikasi utama;
2. tidak melanggar quota provider;
3. tidak membuat retry storm;
4. tidak mengirim duplicate massal;
5. tetap mempertahankan auditability;
6. tetap bisa dipause, dilanjutkan, dan diinvestigasi;
7. bisa membedakan email transactional, operational, batch, dan bulk;
8. tetap aman ketika sebagian recipient gagal;
9. bisa dikendalikan oleh backpressure;
10. tidak naif terhadap realita SMTP dan provider throttling.

Di level top engineer, pertanyaannya bukan:

```text
Bagaimana kirim email ke banyak orang?
```

Pertanyaan yang benar:

```text
Bagaimana mengubah banyak intent bisnis menjadi pengiriman email terkontrol,
terukur, idempotent, rate-limited, observable, dan recoverable?
```

---

## 1. Mental Model: Bulk Email Is a Flow-Control Problem

Single email sending terlihat seperti API call:

```text
Application -> SMTP -> accepted/rejected
```

Bulk sending adalah flow-control problem:

```text
Business Intent
  -> Recipient Expansion
  -> Personalization
  -> Message Materialization
  -> Queueing
  -> Scheduling
  -> Rate Limiting
  -> Worker Execution
  -> Provider Throttling
  -> Retry Classification
  -> Feedback Loop
  -> Audit / Reporting
```

Setiap layer punya failure mode sendiri.

Jika satu email gagal, dampaknya kecil. Jika 100.000 email gagal karena konfigurasi salah, sistem bisa:

- menghabiskan quota harian;
- mengirim duplicate;
- masuk blacklist;
- mengunci account SMTP;
- membuat backlog besar;
- membebani database;
- membanjiri log;
- menghasilkan incident compliance;
- mengirim informasi sensitif ke recipient yang salah;
- menciptakan retry storm yang lebih berbahaya daripada failure awal.

Karena itu bulk mail harus diperlakukan sebagai **controlled pipeline**, bukan loop sederhana.

Anti-pattern awal:

```java
for (User user : users) {
    mailService.send(user.getEmail(), subject, body);
}
```

Masalahnya:

1. tidak ada rate limit;
2. tidak ada checkpoint;
3. tidak ada retry policy per recipient;
4. tidak ada pause/resume;
5. tidak ada progress visibility;
6. tidak ada deduplication;
7. tidak ada failure isolation;
8. request thread bisa terkunci sangat lama;
9. SMTP timeout satu recipient bisa menahan seluruh batch;
10. partial failure sulit dianalisis.

Bulk email bukan loop. Bulk email adalah job orchestration.

---

## 2. Vocabulary: Transactional, Operational, Batch, Bulk, Campaign

Sebelum mendesain sistem, kita harus membedakan jenis email.

### 2.1 Transactional Email

Transactional email adalah email yang dipicu oleh aksi atau state spesifik milik satu user/entity.

Contoh:

- reset password;
- OTP;
- invoice generated;
- application submitted;
- case assigned;
- approval completed;
- appointment confirmed.

Karakteristik:

- usually one recipient or small set;
- latency penting;
- retry harus hati-hati;
- duplicate sangat mengganggu;
- audit sangat penting;
- sering terkait proses bisnis;
- biasanya tidak bisa digabung massal.

### 2.2 Operational Email

Operational email adalah notifikasi sistem/internal.

Contoh:

- nightly report failed;
- disk space warning;
- SLA breach alert;
- admin digest;
- integration failure report.

Karakteristik:

- recipient bisa group;
- bukan marketing;
- content sering teknis;
- burst bisa terjadi ketika incident;
- perlu dedup/coalescing agar tidak alert storm.

### 2.3 Batch Email

Batch email adalah email yang diproses dalam batch terjadwal atau backfill.

Contoh:

- reminder H-7 untuk ribuan application;
- monthly statement;
- expiry notice;
- annual renewal notice;
- migration notification.

Karakteristik:

- dipicu job;
- recipient banyak;
- perlu progress tracking;
- perlu checkpoint;
- rate limit penting;
- personalization biasanya ada;
- audit per recipient tetap diperlukan.

### 2.4 Bulk Email

Bulk email adalah pengiriman volume besar, biasanya content serupa untuk banyak recipient.

Contoh:

- announcement;
- broadcast policy update;
- system-wide maintenance notice;
- newsletter;
- mass notification.

Karakteristik:

- volume tinggi;
- provider quota dominan;
- deliverability risk lebih tinggi;
- unsubscribe mungkin wajib jika marketing;
- suppression list penting;
- per-domain throttling penting.

### 2.5 Campaign Email

Campaign email biasanya lebih dekat ke marketing automation.

Contoh:

- promotional campaign;
- drip sequence;
- A/B testing;
- conversion tracking.

Karakteristik:

- sebaiknya tidak dibangun dari nol kecuali memang core business;
- membutuhkan consent, unsubscribe, segmentation, tracking, feedback loop;
- provider API sering lebih cocok daripada raw SMTP.

### 2.6 Ringkasan Perbedaan

| Jenis | Volume | Latency | Personalization | Audit | Rate Limit | Best Fit |
|---|---:|---:|---:|---:|---:|---|
| Transactional | rendah | tinggi | tinggi | tinggi | sedang | outbox + priority |
| Operational | rendah-sedang | sedang | rendah | sedang | sedang | alert pipeline |
| Batch | sedang-tinggi | rendah-sedang | tinggi | tinggi | tinggi | scheduled worker |
| Bulk | tinggi | rendah | rendah-sedang | tinggi | sangat tinggi | controlled campaign/job |
| Campaign | sangat tinggi | rendah | tinggi | tinggi | sangat tinggi | ESP/API platform |

---

## 3. SMTP Accepted Is Not Bulk Success

Dalam SMTP, keberhasilan awal biasanya berarti server SMTP menerima message untuk diproses lebih lanjut. Itu bukan jaminan recipient membaca email. Bahkan bukan selalu jaminan email sampai inbox.

Untuk single email, ambiguity ini kadang diterima. Untuk bulk, ambiguity menjadi besar:

```text
100.000 intended recipients
  99.000 SMTP accepted
   1.000 immediate reject
  unknown delivered
  unknown spam folder
  unknown bounced later
  unknown complaint
```

Maka metric bulk harus dibagi:

1. **planned** — recipient direncanakan;
2. **materialized** — email request dibuat;
3. **eligible** — lolos filter/suppression/preference;
4. **attempted** — worker mencoba kirim;
5. **accepted by SMTP/provider** — provider menerima;
6. **failed immediate** — reject saat send;
7. **retry scheduled** — transient failure;
8. **permanent failed** — tidak akan retry;
9. **bounced later** — feedback asynchronous;
10. **complained/unsubscribed** — feedback negatif;
11. **delivered/opened/clicked** — jika provider mendukung dan legal/compliant.

Top engineer tidak menamai status `SENT` jika artinya hanya `SMTP_ACCEPTED`, kecuali domain sudah jelas.

Lebih baik:

```text
ACCEPTED_BY_PROVIDER
```

Daripada:

```text
DELIVERED
```

Kalau belum ada bukti delivery.

---

## 4. Why “One Email with Many Recipients” Is Often Wrong

Ada dua cara mengirim ke banyak orang:

### 4.1 One Message, Many Recipients

```text
To: user1@example.com, user2@example.com, user3@example.com
```

Atau BCC:

```text
Bcc: user1@example.com, user2@example.com, user3@example.com
```

Kelebihan:

- lebih sedikit SMTP transaction;
- lebih cepat secara naive;
- lebih sedikit MIME message dibangun.

Kekurangan:

- privacy risk jika pakai To/Cc;
- personalization sulit;
- audit per recipient tidak jelas;
- partial failure sulit;
- unsubscribe/preference per recipient sulit;
- per-recipient template variable tidak bisa;
- satu bad recipient bisa mempengaruhi transaction tergantung provider/config;
- sulit korelasikan bounce ke recipient jika tidak ada VERP/provider metadata;
- Message-ID sama untuk semua recipient;
- email threading bisa tidak diinginkan;
- regulatory evidence lemah.

### 4.2 One Message per Recipient

```text
for each recipient:
    create personalized MimeMessage
    send individually
```

Kelebihan:

- personalization mudah;
- audit kuat;
- failure per recipient jelas;
- unsubscribe/preference jelas;
- template variable aman;
- bounce correlation lebih mudah;
- privacy lebih baik;
- rate limiting lebih presisi.

Kekurangan:

- lebih banyak SMTP transaction;
- lebih banyak CPU/template rendering;
- lebih banyak queue row;
- butuh worker/pipeline matang.

Untuk enterprise system, terutama yang memiliki audit dan personalization, default yang lebih aman adalah:

```text
one logical notification per recipient
```

Bukan:

```text
one email to many recipients
```

### 4.3 Kapan Many Recipients Masih Masuk Akal?

Bisa dipakai jika:

1. recipient adalah internal group yang memang saling terlihat;
2. content sama persis;
3. tidak perlu audit individual;
4. tidak ada unsubscribe/preference individual;
5. jumlah recipient kecil;
6. privacy sudah disetujui;
7. failure semantics bisa diterima.

Contoh:

```text
To: system-admins@example.com
Subject: Nightly integration failure
```

Bahkan di sini lebih baik pakai distribution list daripada expose banyak alamat.

---

## 5. Recipient Expansion: Dari Segment ke Recipient Konkret

Bulk email biasanya dimulai dari query atau segment:

```text
all users whose license expires in 30 days
```

Atau:

```text
all case officers assigned to active compliance cases
```

Jangan langsung kirim dari query tersebut. Lakukan expansion menjadi snapshot.

### 5.1 Kenapa Perlu Snapshot?

Tanpa snapshot:

- data berubah di tengah job;
- recipient bisa bertambah/berkurang;
- progress sulit dihitung;
- resume bisa duplicate atau skip;
- audit tidak bisa menjelaskan “siapa target job ini waktu itu”.

Dengan snapshot:

```text
bulk_job
  id = J001
  segment_definition = "license_expiry_h_30"
  created_at = T0
  total_target = 12_430

bulk_job_recipient
  job_id = J001
  recipient_id = R001
  email = a@example.com
  entity_id = license-123
  status = PENDING
```

Snapshot menjawab:

```text
Pada saat job dibuat, siapa saja yang menjadi target?
```

### 5.2 Recipient Expansion Pipeline

```text
Segment Definition
  -> Query Candidate Entities
  -> Resolve Recipient Identity
  -> Apply Eligibility Rules
  -> Apply Preference / Consent
  -> Apply Suppression List
  -> Deduplicate
  -> Materialize Recipient Snapshot
```

### 5.3 Deduplication Level

Dedup bisa dilakukan pada beberapa level:

| Level | Contoh | Risiko jika tidak dedup |
|---|---|---|
| Email address | sama email muncul dari 2 role | duplicate email |
| User ID | user punya banyak entity | duplicate notification |
| Entity ID | satu license diproses dua rule | duplicate business event |
| Notification key | same template + same target + same period | duplicate batch |

Tidak ada satu dedup rule universal. Harus sesuai domain.

Contoh idempotency key:

```text
license-expiry-reminder:{licenseId}:{recipientUserId}:D-30:2026-06
```

---

## 6. Materialization: Render Now or Render Later?

Dalam bulk pipeline, ada dua strategi:

### 6.1 Render Saat Job Dibuat

```text
job creation -> render subject/html/text -> store rendered content -> worker sends stored content
```

Kelebihan:

- output stabil;
- audit kuat;
- resume konsisten;
- template berubah setelah job dibuat tidak mempengaruhi job;
- worker lebih ringan.

Kekurangan:

- storage besar;
- PII tersimpan lebih banyak;
- jika template bug, bug sudah tersebar di materialized content;
- sulit memperbaiki sebelum send kecuali regenerate.

### 6.2 Render Saat Send

```text
job creation -> store template id + variables -> worker renders just before send
```

Kelebihan:

- storage lebih kecil;
- template bisa diperbaiki sebelum send;
- variable bisa fresh;
- lebih fleksibel.

Kekurangan:

- output bisa berubah antar recipient/time;
- audit harus menyimpan template version;
- worker lebih berat;
- template error muncul saat runtime;
- retry bisa render hasil berbeda jika data berubah.

### 6.3 Rekomendasi Enterprise

Untuk regulated/enterprise:

```text
Store template_id + template_version + normalized variables + content hash.
Optionally store rendered output for high-audit notification.
```

Untuk email yang sangat sensitif:

```text
Avoid storing full rendered body if it contains sensitive PII.
Store immutable template version + immutable variable snapshot + hash.
```

Untuk bukti kuat:

```text
Store rendered subject + safe body snapshot or encrypted rendered artifact.
```

Trade-off harus eksplisit.

---

## 7. Rate Limit: Three Different Limits

Banyak sistem gagal karena menganggap rate limit hanya satu angka.

Padahal minimal ada tiga limit:

### 7.1 Provider Global Limit

Contoh:

```text
max 50 emails/sec for account
max 100.000 emails/day
```

Ini batas dari SMTP relay/email provider.

### 7.2 Application Safety Limit

Batas internal yang sengaja lebih rendah dari provider.

Contoh:

```text
provider max = 50/sec
application cap = 35/sec
```

Kenapa?

- memberi headroom;
- mencegah spike;
- menghindari throttle;
- menghindari semua quota dipakai satu job;
- memberi ruang untuk transactional email prioritas tinggi.

### 7.3 Domain-Level Limit

Recipient domain bisa throttle sendiri.

Contoh:

```text
gmail.com      -> 20/sec
outlook.com    -> 10/sec
company.gov.sg -> 2/sec
```

Jika semua email diarahkan ke satu domain, global rate limit saja tidak cukup.

### 7.4 Campaign/Job Limit

Batas per job:

```text
job A max 5/sec
job B max 20/sec
transactional max 30/sec priority
```

Tanpa per-job limit, satu bulk job bisa membuat transactional email terlambat.

---

## 8. Rate Limiting Algorithms

### 8.1 Fixed Sleep Loop

Naive:

```java
for (MailTask task : tasks) {
    send(task);
    Thread.sleep(100);
}
```

Masalah:

- tidak aman multi-worker;
- tidak adaptif;
- sulit pause;
- tidak distributed;
- sleep menahan thread;
- tidak memperhitungkan send latency;
- tidak support priority.

### 8.2 Token Bucket

Mental model:

```text
bucket capacity = burst allowance
refill rate     = allowed sustained rate
send requires 1 token
```

Contoh:

```text
refill 20 tokens/sec
capacity 40 tokens
```

Artinya sistem boleh burst sampai 40, tetapi sustained rate 20/sec.

Cocok untuk:

- provider global rate;
- per-domain rate;
- per-job rate.

### 8.3 Leaky Bucket

Mental model:

```text
requests enter queue
worker drains at constant rate
```

Cocok jika ingin output stabil dan tidak burst.

### 8.4 Sliding Window Counter

Mental model:

```text
no more than N sends in last T seconds
```

Cocok untuk daily/hourly quotas, tetapi butuh storage/atomic counter.

### 8.5 Distributed Rate Limiting

Jika worker lebih dari satu pod/node, rate limiter harus shared.

Pilihan:

1. Redis atomic counter/token bucket;
2. database row lock counter;
3. message broker partitioning;
4. single dispatcher service;
5. provider-side throttling plus local backoff.

Redis sering dipakai karena cepat, tetapi harus diperlakukan sebagai infra dependency.

---

## 9. Worker Pool Sizing

Bulk email worker tidak boleh hanya dihitung dari CPU.

SMTP sending biasanya blocking I/O:

```text
connect/auth/TLS/write/wait response
```

Maka throughput dipengaruhi oleh:

1. provider rate limit;
2. average SMTP latency;
3. connection reuse;
4. timeout;
5. attachment size;
6. template rendering time;
7. DB polling/locking overhead;
8. retry volume;
9. network stability;
10. per-domain throttling.

### 9.1 Simple Throughput Formula

Jika setiap send butuh rata-rata 500ms, satu worker bisa sekitar:

```text
1 / 0.5s = 2 sends/sec
```

Jika target 20 sends/sec:

```text
20 / 2 = 10 workers
```

Tapi jika provider limit 10/sec, 10 workers mungkin terlalu banyak jika tanpa rate limiter.

### 9.2 Worker Count Tidak Sama dengan Send Rate

Worker count menentukan concurrency.

Rate limiter menentukan throughput.

```text
workers = how many in-flight sends allowed
rate    = how many sends per time window allowed
```

Keduanya harus ada.

### 9.3 Java 21+ Virtual Threads

Dengan Java 21+, virtual threads bisa membuat blocking SMTP lebih murah dari sisi thread platform. Tetapi virtual threads tidak menghapus kebutuhan untuk:

- rate limit;
- timeout;
- backpressure;
- connection limit;
- memory control;
- provider quota;
- retry policy.

Virtual thread membantu concurrency cost, bukan correctness.

Java 8–17 biasanya memakai bounded executor biasa.

### 9.4 Recommended Worker Boundaries

```text
max_worker_threads
max_in_flight_per_provider
max_in_flight_per_domain
max_in_flight_attachment_bytes
max_queue_claim_per_poll
max_retry_per_minute
```

Top engineer tidak hanya bertanya “berapa thread?”. Ia bertanya:

```text
Apa resource yang sedang dilimit?
```

---

## 10. Priority: Transactional Must Not Starve Behind Bulk

Salah satu kegagalan serius:

```text
bulk announcement 100.000 emails masuk queue
password reset email ikut antre 3 jam
```

Ini buruk.

Solusi:

### 10.1 Queue Priority

Pisahkan priority:

```text
P0: OTP / password reset / security
P1: transactional business notification
P2: operational digest
P3: batch reminder
P4: bulk announcement
```

Worker mengambil P0 dulu, tetapi jangan sampai P0 retry storm membunuh semua.

### 10.2 Separate Lane

Lebih aman:

```text
transactional queue -> transactional workers -> reserved quota
bulk queue          -> bulk workers          -> capped quota
```

Contoh allocation:

```text
provider allowed 50/sec
transactional reserved 20/sec
bulk max 25/sec
safety headroom 5/sec
```

### 10.3 Separate Provider Credential

Untuk sistem besar:

```text
transactional SMTP credential/domain
bulk SMTP credential/domain
```

Manfaat:

- reputation isolation;
- quota isolation;
- incident blast radius lebih kecil;
- monitoring lebih jelas.

---

## 11. Connection Reuse and SMTP Session Strategy

Membuka koneksi SMTP untuk setiap message bisa mahal:

```text
TCP connect
TLS handshake
SMTP greeting
AUTH
MAIL FROM
RCPT TO
DATA
QUIT
```

Connection reuse dapat meningkatkan throughput, tetapi ada trade-off.

### 11.1 Simple Send Per Message

```java
Transport.send(message);
```

Kelebihan:

- sederhana;
- aman untuk low volume;
- lifecycle jelas.

Kekurangan:

- overhead connect/auth per message;
- lambat untuk bulk;
- sulit mengontrol partial behavior.

### 11.2 Manual Transport Reuse

```java
Transport transport = session.getTransport("smtp");
transport.connect(host, username, password);
try {
    for (MimeMessage message : messages) {
        transport.sendMessage(message, message.getAllRecipients());
    }
} finally {
    transport.close();
}
```

Kelebihan:

- mengurangi handshake;
- throughput lebih baik;
- cocok untuk worker batch kecil.

Kekurangan:

- connection bisa stale;
- perlu reconnect logic;
- satu failure bisa merusak transport state;
- harus hati-hati thread-safety;
- provider bisa menutup koneksi setelah limit tertentu;
- idle timeout harus diketahui.

### 11.3 Jangan Share Transport Sembarangan

`Transport` adalah connection/session-oriented object. Jangan share satu `Transport` lintas thread tanpa design eksplisit.

Lebih aman:

```text
one worker owns one transport at a time
```

Atau:

```text
connection pool with strict borrow/return semantics
```

Tapi connection pool SMTP harus benar-benar diuji. Jangan membuat pool custom jika tidak perlu.

### 11.4 Batch Size per Connection

Gunakan batas:

```text
max messages per SMTP connection = 50/100/500 depending provider
max connection lifetime = e.g. 5 minutes
max idle lifetime = e.g. 30 seconds
```

Kenapa?

- menghindari stale connection;
- menghindari memory/resource leak;
- menghindari provider disconnect random;
- membuat failure blast radius kecil.

---

## 12. SMTP Partial Success in Bulk Context

SMTP bisa punya partial behavior, terutama ketika banyak recipient dalam satu message.

Misalnya:

```text
RCPT TO user1 -> 250 OK
RCPT TO user2 -> 550 No such user
RCPT TO user3 -> 250 OK
```

Pertanyaan:

```text
Apakah message tetap dikirim ke user1 dan user3?
```

Jawabannya bergantung pada provider, konfigurasi, dan cara API digunakan. Jakarta Mail SMTP provider punya properti seperti `mail.smtp.sendpartial` yang mempengaruhi apakah message tetap dikirim jika sebagian address invalid.

Untuk bulk enterprise, ini alasan kuat untuk:

```text
one message per recipient
```

Dengan begitu failure classification lebih sederhana:

```text
recipient A -> accepted
recipient B -> permanent failed
recipient C -> retryable failed
```

---

## 13. Retry Storm: Bahaya Terbesar Bulk Sending

Retry storm terjadi ketika failure massal menyebabkan retry massal yang memperburuk sistem.

Contoh:

```text
10.000 emails attempted
provider returns 421 rate limit
system marks retry in 1 minute
1 minute later 10.000 retry together
provider throttles harder
queue grows
workers saturated
transactional email delayed
```

### 13.1 Penyebab Retry Storm

1. retry delay sama untuk semua message;
2. tidak ada jitter;
3. tidak ada global circuit breaker;
4. tidak ada provider-level backoff;
5. semua worker retry bersamaan;
6. transient failure tidak dibedakan dari rate-limit failure;
7. bulk dan transactional berbagi lane;
8. max attempts terlalu tinggi;
9. queue polling terlalu agresif;
10. timeout infinite membuat worker stuck lalu retry menumpuk.

### 13.2 Anti-Storm Rules

```text
Never retry a bulk failure immediately without jitter.
Never retry provider-wide failure per message independently only.
Never allow retry traffic to exceed fresh traffic limit.
Never let bulk retry consume transactional reserved quota.
```

### 13.3 Provider-Level Backoff

Jika banyak message gagal dengan code serupa:

```text
421 Too many connections
451 Temporary local problem
454 TLS not available
```

Maka jangan hanya retry per message. Set provider health state:

```text
provider_state = DEGRADED
bulk_send_paused_until = now + 10 minutes
transactional_rate = reduced
```

---

## 14. Scheduling and Pacing

Bulk job tidak harus dikirim secepat mungkin.

Kadang lebih baik:

```text
send 100.000 emails across 6 hours
```

Daripada:

```text
send 100.000 emails in 5 minutes
```

### 14.1 Why Pacing Matters

1. menghindari provider throttle;
2. mengurangi spam suspicion;
3. memberi ruang untuk pause jika template salah;
4. mengurangi load database;
5. memberi waktu feedback awal;
6. menghindari support spike;
7. mengurangi incident blast radius.

### 14.2 Schedule Window

Bulk job sebaiknya punya window:

```text
start_at
not_before
not_after
allowed_days
allowed_hours
timezone
```

Contoh:

```text
maintenance notice boleh dikirim 09:00–17:00 local business time
```

### 14.3 Quiet Hours

Untuk beberapa domain/regulasi/produk, jangan kirim di jam tertentu.

```text
quiet_hours: 22:00–07:00 recipient timezone
```

Jika timezone recipient tidak diketahui, gunakan default tenant/agency timezone.

---

## 15. Batch Size and Claiming Strategy

Worker biasanya mengambil task dari DB/outbox.

Naive:

```sql
SELECT * FROM mail_outbox WHERE status = 'PENDING' LIMIT 1000;
```

Masalah:

- race condition multi-worker;
- lock contention;
- satu worker claim terlalu banyak;
- retry due time tidak diperhatikan;
- priority tidak diperhatikan.

### 15.1 Claim Small Batches

Lebih aman:

```text
claim 10–100 tasks per worker poll
```

Tergantung send latency dan throughput.

### 15.2 Use Lease

Status `PROCESSING` harus punya lease/timeout:

```text
locked_by
locked_until
attempt_no
```

Jika worker mati:

```text
PROCESSING with expired locked_until -> eligible for recovery
```

### 15.3 Query Shape

Conceptual query:

```sql
SELECT *
FROM mail_outbox
WHERE status IN ('PENDING', 'FAILED_RETRYABLE')
  AND next_attempt_at <= CURRENT_TIMESTAMP
  AND not_before <= CURRENT_TIMESTAMP
ORDER BY priority ASC, next_attempt_at ASC, created_at ASC
FETCH FIRST :batchSize ROWS ONLY
FOR UPDATE SKIP LOCKED;
```

Catatan:

- SQL detail bergantung database;
- `SKIP LOCKED` berguna untuk multi-worker;
- index harus sesuai query;
- jangan scan table besar setiap beberapa detik.

### 15.4 Important Indexes

Contoh index konseptual:

```sql
CREATE INDEX idx_mail_outbox_claim
ON mail_outbox (status, next_attempt_at, priority, created_at);
```

Jika multi-tenant:

```sql
CREATE INDEX idx_mail_outbox_tenant_claim
ON mail_outbox (tenant_id, status, next_attempt_at, priority, created_at);
```

Jika per-provider routing:

```sql
CREATE INDEX idx_mail_outbox_provider_claim
ON mail_outbox (provider_id, status, next_attempt_at, priority, created_at);
```

---

## 16. Queue Depth and Backpressure

Queue depth adalah jumlah item yang belum selesai.

Tapi metric yang lebih penting:

```text
queue age
```

Karena 1.000 email pending bisa normal, tetapi jika oldest pending sudah 6 jam, itu incident.

### 16.1 Metrics

Minimal:

```text
mail_queue_pending_count{priority, provider, tenant}
mail_queue_processing_count{priority, provider, tenant}
mail_queue_retryable_count{priority, provider, tenant}
mail_queue_dead_letter_count{priority, provider, tenant}
mail_queue_oldest_age_seconds{priority, provider, tenant}
mail_send_rate_per_second{provider}
mail_send_failure_rate{provider, failure_class}
mail_provider_throttle_count{provider}
```

### 16.2 Backpressure Actions

Ketika backlog naik:

1. reduce bulk rate;
2. pause low priority jobs;
3. preserve transactional lane;
4. increase workers only if provider and DB can handle;
5. reject new bulk job temporarily;
6. alert operator;
7. expose ETA.

### 16.3 Jangan Auto-Scale Buta

Auto-scale worker ketika queue naik bisa salah jika bottleneck adalah provider rate limit.

```text
More workers + same provider throttle = more failures
```

Scale harus memperhatikan:

- provider accepted rate;
- throttle count;
- timeout count;
- DB load;
- network error;
- queue age;
- per-domain distribution.

---

## 17. Per-Domain Throttling

Bulk job sering punya domain distribution tidak merata.

Contoh:

```text
60% gmail.com
20% outlook.com
10% corporate domain
10% others
```

Jika kirim berdasarkan global FIFO, domain besar akan menerima burst.

### 17.1 Domain Extraction

Dari recipient:

```text
alice@gmail.com -> gmail.com
bob@agency.gov.sg -> agency.gov.sg
```

Normalize:

- lowercase;
- trim;
- punycode/IDN handling jika perlu;
- validate format sebelum queue.

### 17.2 Domain Bucket

```text
global bucket: 50/sec
gmail.com bucket: 20/sec
outlook.com bucket: 10/sec
agency.gov.sg bucket: 2/sec
unknown bucket: 5/sec
```

A send requires:

```text
1 global token + 1 domain token + 1 job token
```

### 17.3 Domain-Level Backoff

Jika only `agency.gov.sg` returns 421/451, jangan pause semua provider.

Set:

```text
domain_backoff[agency.gov.sg] = now + 15 minutes
```

Continue others.

---

## 18. Bulk Job State Machine

Email row punya state. Bulk job juga harus punya state.

### 18.1 Job-Level States

```text
DRAFT
SCHEDULED
EXPANDING_RECIPIENTS
READY
RUNNING
PAUSED
COMPLETED
COMPLETED_WITH_FAILURES
FAILED
CANCELLED
EXPIRED
```

### 18.2 Recipient-Level States

```text
PENDING
SUPPRESSED
SKIPPED_INVALID_ADDRESS
PROCESSING
ACCEPTED_BY_PROVIDER
FAILED_RETRYABLE
FAILED_PERMANENT
DEAD_LETTER
CANCELLED
```

### 18.3 State Relationship

Job `COMPLETED` jika semua recipient terminal:

```text
ACCEPTED_BY_PROVIDER
SUPPRESSED
SKIPPED_INVALID_ADDRESS
FAILED_PERMANENT
DEAD_LETTER
CANCELLED
```

Job `COMPLETED_WITH_FAILURES` jika ada failure terminal.

Job `RUNNING` jika masih ada pending/retryable/processing.

### 18.4 Pause Semantics

Pause job bukan berarti membatalkan send yang sedang in-flight.

```text
PAUSED means no new tasks claimed.
In-flight tasks may finish.
```

### 18.5 Cancel Semantics

Cancel job harus jelas:

```text
PENDING -> CANCELLED
FAILED_RETRYABLE -> CANCELLED
PROCESSING -> allowed to finish or marked cancel_requested
ACCEPTED_BY_PROVIDER -> cannot unsend
```

Email yang sudah accepted tidak bisa “ditarik kembali” secara reliable.

---

## 19. Data Model Reference

Berikut contoh data model konseptual.

### 19.1 `bulk_mail_job`

```sql
CREATE TABLE bulk_mail_job (
    id                  VARCHAR(64) PRIMARY KEY,
    job_type            VARCHAR(64) NOT NULL,
    status              VARCHAR(32) NOT NULL,
    priority            INT NOT NULL,
    template_id         VARCHAR(128) NOT NULL,
    template_version    VARCHAR(64) NOT NULL,
    segment_type        VARCHAR(128) NOT NULL,
    segment_definition  CLOB,
    scheduled_at        TIMESTAMP,
    not_before          TIMESTAMP,
    not_after           TIMESTAMP,
    rate_limit_per_sec  INT,
    created_by          VARCHAR(128),
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    cancelled_at        TIMESTAMP,
    cancel_reason       VARCHAR(512)
);
```

### 19.2 `bulk_mail_recipient`

```sql
CREATE TABLE bulk_mail_recipient (
    id                    VARCHAR(64) PRIMARY KEY,
    job_id                VARCHAR(64) NOT NULL,
    recipient_key         VARCHAR(256) NOT NULL,
    email_address         VARCHAR(320) NOT NULL,
    email_domain          VARCHAR(255) NOT NULL,
    display_name          VARCHAR(255),
    entity_type           VARCHAR(64),
    entity_id             VARCHAR(128),
    idempotency_key       VARCHAR(512) NOT NULL,
    status                VARCHAR(32) NOT NULL,
    attempt_count         INT NOT NULL,
    next_attempt_at       TIMESTAMP,
    locked_by             VARCHAR(128),
    locked_until          TIMESTAMP,
    provider_id           VARCHAR(64),
    provider_message_id   VARCHAR(256),
    smtp_code             INT,
    failure_class         VARCHAR(64),
    failure_reason        VARCHAR(1024),
    created_at            TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP NOT NULL,
    accepted_at           TIMESTAMP,
    terminal_at           TIMESTAMP,
    CONSTRAINT uq_bulk_recipient_idempotency UNIQUE (idempotency_key)
);
```

### 19.3 `mail_send_attempt`

```sql
CREATE TABLE mail_send_attempt (
    id                  VARCHAR(64) PRIMARY KEY,
    recipient_id        VARCHAR(64) NOT NULL,
    attempt_no          INT NOT NULL,
    started_at          TIMESTAMP NOT NULL,
    finished_at         TIMESTAMP,
    provider_id         VARCHAR(64),
    smtp_code           INT,
    enhanced_status     VARCHAR(32),
    result              VARCHAR(32),
    failure_class       VARCHAR(64),
    error_message_safe  VARCHAR(2048),
    latency_ms          INT
);
```

Kenapa attempt table penting?

- audit retry;
- debugging transient failure;
- provider incident correlation;
- latency analysis;
- prove system behavior.

---

## 20. Java Design: Interfaces and Boundaries

Bulk sending tidak boleh bergantung langsung pada `MimeMessage` di semua layer.

### 20.1 Domain-Level Request

```java
public final class BulkMailRecipientTask {
    private final String recipientId;
    private final String jobId;
    private final String idempotencyKey;
    private final String emailAddress;
    private final String emailDomain;
    private final String templateId;
    private final String templateVersion;
    private final Map<String, Object> variables;
    private final int attemptNo;

    // constructor, getters
}
```

### 20.2 Gateway Boundary

```java
public interface MailGateway {
    MailSendResult send(MailEnvelope envelope, RenderedMailContent content) throws MailGatewayException;
}
```

### 20.3 Rate Limiter Boundary

```java
public interface MailRateLimiter {
    RateLimitDecision acquire(RateLimitRequest request);
}
```

### 20.4 Failure Classifier

```java
public interface MailFailureClassifier {
    ClassifiedFailure classify(Throwable error);
}
```

### 20.5 Worker Orchestrator

```java
public final class BulkMailWorker {
    private final BulkMailTaskRepository repository;
    private final TemplateRenderer renderer;
    private final MailRateLimiter rateLimiter;
    private final MailGateway gateway;
    private final MailFailureClassifier failureClassifier;
    private final RetryPolicy retryPolicy;

    public void runOnce() {
        List<BulkMailRecipientTask> tasks = repository.claimDueTasks(50);

        for (BulkMailRecipientTask task : tasks) {
            processOne(task);
        }
    }

    private void processOne(BulkMailRecipientTask task) {
        RateLimitDecision decision = rateLimiter.acquire(new RateLimitRequest(
            task.getJobId(),
            task.getEmailDomain(),
            task.getAttemptNo()
        ));

        if (!decision.isAllowed()) {
            repository.releaseForLater(task.getRecipientId(), decision.retryAfter());
            return;
        }

        try {
            RenderedMailContent content = renderer.render(
                task.getTemplateId(),
                task.getTemplateVersion(),
                task.getVariables()
            );

            MailEnvelope envelope = MailEnvelope.singleRecipient(task.getEmailAddress());
            MailSendResult result = gateway.send(envelope, content);

            repository.markAccepted(task.getRecipientId(), result);
        } catch (Exception ex) {
            ClassifiedFailure failure = failureClassifier.classify(ex);

            if (failure.isRetryable()) {
                repository.markRetryable(
                    task.getRecipientId(),
                    failure,
                    retryPolicy.nextAttemptAt(task.getAttemptNo(), failure)
                );
            } else {
                repository.markPermanentFailure(task.getRecipientId(), failure);
            }
        }
    }
}
```

Catatan:

- contoh ini synchronous untuk clarity;
- production perlu transaction boundary jelas;
- jangan render dan send di DB transaction panjang;
- claim/update harus kecil dan cepat;
- metrics/logging belum ditampilkan.

---

## 21. Retry Policy for Bulk

Retry policy bulk berbeda dari transactional.

Transactional mungkin retry cepat karena user menunggu.

Bulk sebaiknya lebih lambat dan menyebar.

### 21.1 Example Retry Schedule

```text
attempt 1: immediate original send
attempt 2: +5 min ± jitter
attempt 3: +30 min ± jitter
attempt 4: +2 hours ± jitter
attempt 5: +12 hours ± jitter
then dead-letter
```

### 21.2 Jitter

Tanpa jitter:

```text
10.000 failures at 10:00
10.000 retries at 10:05
```

Dengan jitter:

```text
10.000 retries spread between 10:04 and 10:08
```

### 21.3 Failure-Specific Retry

| Failure | Retry? | Suggested Handling |
|---|---:|---|
| SMTP 421 rate limit | yes | provider/domain backoff |
| SMTP 450 mailbox unavailable | yes | delayed retry |
| SMTP 451 local error | yes | delayed retry |
| SMTP 452 insufficient storage | yes | delayed retry, lower rate |
| SMTP 550 user unknown | no | permanent failure/suppress |
| SMTP 552 message too large | no/fix | permanent or content fix |
| Auth failure | no per-message | pause provider, alert |
| TLS/certificate failure | no per-message | pause provider, alert |
| Timeout | yes with cap | retry with backoff |
| Template render error | no | fail job or recipient until fixed |

### 21.4 Provider-Wide Failure Should Pause Job

If all recipients fail because SMTP credential expired, retrying each message is waste.

Better:

```text
provider auth failed -> mark provider unhealthy -> pause workers -> alert
```

---

## 22. Multi-Tenant Bulk Sending

Jika aplikasi melayani banyak tenant/agency/customer, bulk sending harus fair.

Problem:

```text
Tenant A creates 1 million email job.
Tenant B password reset delayed.
```

### 22.1 Tenant Quotas

```text
tenant A bulk max 10/sec
tenant B bulk max 10/sec
global bulk max 30/sec
transactional shared reserved 20/sec
```

### 22.2 Tenant Isolation

Bisa dilakukan dengan:

1. separate queue per tenant;
2. shared queue with weighted fair scheduling;
3. separate provider credential per tenant;
4. separate sender domain per tenant;
5. tenant-level suppression/preference.

### 22.3 Weighted Fair Scheduling

Concept:

```text
Tenant A weight 5
Tenant B weight 1
Tenant C weight 1
```

Tetapi fairness tetap harus menjaga priority. Jangan biarkan low-priority tenant A mengalahkan high-priority tenant B.

---

## 23. Suppression List and Eligibility

Bulk sending harus punya mekanisme suppression.

Suppression artinya recipient tidak boleh dikirim, walaupun segment query memasukkannya.

### 23.1 Suppression Reasons

```text
HARD_BOUNCE
COMPLAINT
UNSUBSCRIBED
INVALID_ADDRESS
MANUAL_BLOCK
LEGAL_HOLD
NO_CONSENT
DUPLICATE
TENANT_POLICY
```

### 23.2 Apply Before Materialization

Lebih baik suppression dilakukan sebelum send task masuk `PENDING`.

Tapi tetap simpan status:

```text
SUPPRESSED with reason
```

Agar report total jelas:

```text
12.000 targeted
11.500 eligible
300 suppressed due unsubscribe
100 suppressed due hard bounce
100 invalid address
```

### 23.3 Transactional Exception

Beberapa email transactional/security mungkin tetap wajib dikirim walau user unsubscribe marketing.

Maka preference model harus punya category:

```text
SECURITY
LEGAL_NOTICE
TRANSACTIONAL
OPERATIONAL
MARKETING
```

Jangan gunakan boolean `unsubscribed` tunggal untuk semua.

---

## 24. Content Personalization and Caching

Bulk email sering memakai template yang sama dengan variable berbeda.

### 24.1 Personalization Levels

| Level | Example | Send Model |
|---|---|---|
| none | maintenance notice | possible group/send-many |
| shallow | `Dear {name}` | one per recipient |
| entity-specific | license expiry date | one per recipient/entity |
| sensitive | case outcome, payment | strict one per recipient |

### 24.2 Template Compilation Cache

Template engine biasanya punya parse/compile cost.

Cache:

```text
template_id + version -> compiled template
```

Jangan cache rendered output kecuali key dan privacy jelas.

### 24.3 Variable Snapshot

Untuk audit dan retry consistency:

```json
{
  "recipientName": "Alice Tan",
  "licenseNo": "L-2026-001",
  "expiryDate": "2026-07-18"
}
```

Jika data berubah setelah job dibuat, retry tetap memakai snapshot.

### 24.4 Content Hash

Simpan hash:

```text
sha256(subject + text + html + attachment metadata)
```

Manfaat:

- audit;
- duplicate detection;
- debugging;
- prove rendered content version.

---

## 25. Attachment in Bulk: Dangerous by Default

Bulk email dengan attachment adalah risk multiplier.

Jika 10.000 recipient menerima attachment 5 MB:

```text
50 GB outbound payload
```

Plus memory/CPU/network overhead.

### 25.1 Prefer Secure Link Over Attachment

Untuk large/sensitive document:

```text
email contains secure link
user authenticates
file downloaded from application
```

Keuntungan:

- less email size;
- access control;
- revocation possible;
- audit download;
- avoid mailbox retention of sensitive file;
- easier virus scanning.

### 25.2 If Attachment Is Required

Controls:

```text
max attachment size
max total message size
streaming data source
virus scan
file type allowlist
filename sanitization
per-recipient authorization
memory budget
```

### 25.3 Do Not Preload All Attachments

Anti-pattern:

```java
List<byte[]> attachments = loadAllAttachmentsForAllRecipients();
```

Better:

```text
load/stream only for one message at send time
release immediately after send
```

---

## 26. Reporting and Progress

Bulk job needs user/operator visible progress.

### 26.1 Basic Progress

```text
Total targeted: 100,000
Eligible: 96,500
Suppressed: 3,500
Accepted: 80,000
Retrying: 2,000
Permanent failed: 500
Pending: 14,000
ETA: 35 minutes
```

### 26.2 ETA Calculation

Naive ETA:

```text
pending / current_send_rate
```

But adjust for:

- retry delay;
- quiet hours;
- provider throttling;
- job pause;
- rate cap;
- domain backlog.

ETA should be labelled approximate.

### 26.3 Failure Breakdown

```text
550 invalid mailbox: 300
421 rate limited: 1200 retrying
timeout: 500 retrying
content rejected: 15 permanent
```

### 26.4 Export Audit

For regulated systems:

- job definition;
- segment criteria;
- template version;
- recipient snapshot;
- suppression reasons;
- send attempts;
- provider responses;
- operator actions;
- pause/resume/cancel events.

---

## 27. Operational Controls

Bulk sending must have controls.

### 27.1 Required Controls

```text
pause job
resume job
cancel job
reduce rate
increase rate within approved cap
pause provider
pause domain
pause tenant
drain queue
replay dead-letter after fix
export affected recipients
```

### 27.2 Kill Switch

Global kill switch:

```text
mail.bulk.enabled = false
```

Provider kill switch:

```text
provider.smtp-main.enabled = false
```

Template kill switch:

```text
template.license-expiry-v3.enabled = false
```

### 27.3 Blast Radius Reduction

For large job, use staged rollout:

```text
1% canary
wait 15 minutes
10%
wait
100%
```

This catches:

- broken template;
- wrong recipient segment;
- provider rejection;
- high spam complaint;
- broken link;
- wrong language.

---

## 28. Canary Sending

Canary is not just for software deployment. It applies to email.

### 28.1 Canary Recipients

Before sending to real recipients:

```text
send to internal seed list
validate rendering
validate links
validate tracking if applicable
validate attachments
validate sender identity
validate spam score if tool exists
```

### 28.2 Production Canary

Then send to a small real subset:

```text
first 100 recipients
pause 10 minutes
monitor bounce/failure/complaint
continue if healthy
```

### 28.3 Canary Must Be Built into Job State

```text
RUNNING_CANARY
CANARY_PAUSED
RUNNING_FULL
```

Operator should see canary result before full release.

---

## 29. Bulk and Compliance Boundaries

Bulk sending often crosses into compliance territory.

### 29.1 Consent and Category

Never treat all bulk as same.

```text
LEGAL_NOTICE may be mandatory.
MARKETING requires consent/unsubscribe.
OPERATIONAL may be legitimate interest/internal.
SECURITY should bypass marketing unsubscribe.
```

### 29.2 Unsubscribe

Marketing/broadcast email may require unsubscribe mechanisms depending jurisdiction and policy.

Engineering implication:

- category field mandatory;
- preference checked before materialization;
- suppression list updated from bounce/complaint;
- unsubscribe link should be per recipient/tokenized;
- no shared unsubscribe URL.

### 29.3 PII Minimization

Bulk report should avoid exposing full recipient emails to broad admin roles.

Use:

```text
masked email: a***e@example.com
hash for correlation
role-based access for full address
```

---

## 30. API vs SMTP for Bulk

SMTP can send bulk, but provider HTTP APIs often provide better bulk features.

### 30.1 SMTP Strengths

- standard;
- portable;
- Jakarta Mail compatible;
- easy to test with fake SMTP;
- works with many enterprise relays.

### 30.2 SMTP Weaknesses

- limited structured telemetry;
- bounce handling separate;
- provider metadata limited;
- rate limit feedback less structured;
- difficult per-message tags unless headers supported;
- campaign features absent.

### 30.3 Provider API Strengths

- structured response;
- message id;
- tags/categories;
- templates;
- suppression list;
- webhook for delivery/bounce/complaint;
- analytics;
- rate-limit headers.

### 30.4 Provider API Weaknesses

- vendor lock-in;
- SDK dependency;
- data residency/privacy review;
- provider-specific failure model;
- migration cost.

### 30.5 Abstraction Recommendation

Design application around:

```java
interface MailGateway {
    MailSendResult send(MailEnvelope envelope, RenderedMailContent content);
}
```

Have adapters:

```text
JakartaMailSmtpGateway
SesApiMailGateway
SendGridMailGateway
InternalRelayGateway
```

Do not expose Jakarta Mail API to domain service.

---

## 31. Example: Safe Bulk Mail Execution Flow

```text
1. Operator creates bulk job as DRAFT.
2. System validates template variables.
3. Operator previews sample render.
4. Operator schedules job.
5. Recipient expansion creates immutable snapshot.
6. Suppression/preference filters run.
7. Job enters READY.
8. Canary send to seed list.
9. Operator/system validates canary.
10. Job enters RUNNING.
11. Workers claim recipient tasks in small batches.
12. Rate limiter checks global + tenant + job + domain tokens.
13. Worker renders content from template version + variable snapshot.
14. SMTP/API gateway sends.
15. Result saved per recipient.
16. Retryable failure schedules next attempt with jitter.
17. Provider/domain failures update backoff state.
18. Metrics and progress update.
19. Job completes when all recipients are terminal.
20. Later bounce/complaint webhook updates feedback state.
```

---

## 32. Example Rate Limiter Pseudocode

```java
public final class CompositeMailRateLimiter implements MailRateLimiter {
    private final TokenBucket globalBucket;
    private final TenantBucketRegistry tenantBuckets;
    private final JobBucketRegistry jobBuckets;
    private final DomainBucketRegistry domainBuckets;
    private final ProviderHealthRegistry providerHealth;

    @Override
    public RateLimitDecision acquire(RateLimitRequest request) {
        ProviderHealth health = providerHealth.get(request.providerId());
        if (!health.isSendAllowed()) {
            return RateLimitDecision.deniedUntil(health.retryAfter());
        }

        TokenBucket tenant = tenantBuckets.get(request.tenantId());
        TokenBucket job = jobBuckets.get(request.jobId());
        TokenBucket domain = domainBuckets.get(request.domain());

        Instant retryAfter = maxRetryAfter(
            globalBucket.peekRetryAfter(1),
            tenant.peekRetryAfter(1),
            job.peekRetryAfter(1),
            domain.peekRetryAfter(1)
        );

        if (retryAfter != null) {
            return RateLimitDecision.deniedUntil(retryAfter);
        }

        // In distributed implementation this must be atomic.
        globalBucket.consume(1);
        tenant.consume(1);
        job.consume(1);
        domain.consume(1);

        return RateLimitDecision.allowed();
    }
}
```

Important note:

```text
peek + consume must be atomic in distributed system.
```

If multiple workers run, implement atomicity with Redis script, DB transaction/lock, or centralized dispatcher.

---

## 33. Example Backoff Policy

```java
public final class BulkRetryPolicy {
    public RetryDecision decide(ClassifiedFailure failure, int attemptNo, Instant now) {
        if (!failure.isRetryable()) {
            return RetryDecision.permanent();
        }

        if (attemptNo >= 5) {
            return RetryDecision.deadLetter("max attempts reached");
        }

        Duration baseDelay;
        switch (failure.failureClass()) {
            case PROVIDER_RATE_LIMIT:
                baseDelay = Duration.ofMinutes(15);
                break;
            case SMTP_TEMPORARY_RECIPIENT_FAILURE:
                baseDelay = Duration.ofMinutes(30);
                break;
            case NETWORK_TIMEOUT:
                baseDelay = Duration.ofMinutes(5).multipliedBy(attemptNo);
                break;
            default:
                baseDelay = Duration.ofMinutes(10).multipliedBy(attemptNo);
        }

        Duration jitter = randomJitter(baseDelay.dividedBy(5));
        return RetryDecision.retryAt(now.plus(baseDelay).plus(jitter));
    }
}
```

---

## 34. Failure Isolation Patterns

### 34.1 Isolate by Priority

```text
security/OTP != bulk announcement
```

### 34.2 Isolate by Provider

```text
primary transactional relay
bulk relay
backup relay
```

### 34.3 Isolate by Domain

```text
pause gmail.com if Gmail throttles
continue other domains
```

### 34.4 Isolate by Template

If template causes content rejection:

```text
pause only jobs using template X version Y
```

### 34.5 Isolate by Tenant

If tenant config invalid:

```text
pause tenant A sender identity
continue tenant B
```

---

## 35. Common Anti-Patterns

### 35.1 Sending Bulk Inside HTTP Request

Bad:

```text
Admin clicks send -> request loops 50.000 recipients
```

Better:

```text
Admin clicks schedule -> job created -> async workers send
```

### 35.2 No Dry Run

Bulk job should support:

```text
preview count
sample recipients
sample render
suppression summary
estimated duration
```

Before actual send.

### 35.3 No Immutable Recipient Snapshot

Without snapshot, resume and audit are weak.

### 35.4 No Rate Limit

Provider will become your rate limiter, but painfully.

### 35.5 One Retry Time for All Failures

Creates retry storm.

### 35.6 No Priority Separation

Bulk blocks transactional.

### 35.7 Store Full PII Everywhere

Bulk logs/reports become privacy risk.

### 35.8 No Kill Switch

Incident response becomes database surgery.

### 35.9 Trusting “Sent” Too Much

SMTP accepted is not inbox delivered.

### 35.10 Infinite Timeout

Worker stuck means invisible capacity loss.

---

## 36. Java 8–25 Considerations

### 36.1 Java 8

Likely stack:

```text
javax.mail:mail / com.sun.mail:javax.mail
javax.activation
bounded ExecutorService
manual CompletableFuture limited usage
```

Considerations:

- no virtual threads;
- be careful with old JavaMail dependency;
- timeout properties mandatory;
- thread pool must be bounded;
- memory pressure from attachments more dangerous.

### 36.2 Java 11–17

Likely transitional:

```text
Jakarta Mail or JavaMail depending framework
Activation explicit dependency
bounded executor
modern TLS defaults
```

Considerations:

- Java EE modules removed from JDK long ago;
- avoid mixed `javax`/`jakarta`;
- better container/runtime options.

### 36.3 Java 21–25

Likely modern:

```text
jakarta.mail
jakarta.activation
Eclipse Angus Mail implementation
virtual threads possible
structured concurrency concepts possible depending version/style
```

Considerations:

- virtual threads useful for blocking SMTP;
- still use rate limiter;
- still bound in-flight sends;
- still cap memory and attachments;
- still separate priority lanes.

### 36.4 Version-Agnostic Principle

The architecture should not depend on whether implementation uses Java 8 thread pool or Java 21 virtual threads.

Core invariant:

```text
bounded work + bounded rate + bounded retry + bounded memory
```

---

## 37. Production Readiness Checklist

Before enabling bulk/batch sending:

### 37.1 Functional

- [ ] recipient expansion snapshot exists;
- [ ] duplicate/idempotency key exists;
- [ ] one-recipient-per-message default defined;
- [ ] suppression/preference checked;
- [ ] template version fixed;
- [ ] preview/dry run available;
- [ ] canary flow available;
- [ ] job state machine defined;
- [ ] recipient state machine defined.

### 37.2 Reliability

- [ ] outbox/queue used;
- [ ] no send inside business transaction;
- [ ] retry with jitter;
- [ ] max attempts;
- [ ] dead-letter state;
- [ ] lease/lock recovery;
- [ ] pause/resume/cancel;
- [ ] provider/domain backoff;
- [ ] bulk does not starve transactional.

### 37.3 Rate Control

- [ ] global rate limit;
- [ ] provider quota configured;
- [ ] app safety cap;
- [ ] per-job limit;
- [ ] per-tenant limit if applicable;
- [ ] per-domain throttling if volume high;
- [ ] retry traffic capped;
- [ ] quiet hours if needed.

### 37.4 Security/Privacy

- [ ] no PII in broad logs;
- [ ] recipient masking in UI;
- [ ] attachment size limit;
- [ ] secure link considered instead of attachment;
- [ ] unsubscribe/preference category correct;
- [ ] operator permission model;
- [ ] audit for operator actions;
- [ ] template variable escaping.

### 37.5 Observability

- [ ] queue depth;
- [ ] queue age;
- [ ] send rate;
- [ ] failure rate by class;
- [ ] provider throttle count;
- [ ] domain throttle count;
- [ ] retry count;
- [ ] dead-letter count;
- [ ] job progress;
- [ ] alerting thresholds.

---

## 38. Mini Case Study: License Expiry Reminder

Business requirement:

```text
Send reminder email to all license holders whose license expires in 30 days.
```

Naive implementation:

```java
List<License> licenses = licenseRepository.findExpiringIn30Days();
for (License license : licenses) {
    mailService.send(license.getHolderEmail(), "License expiring", body);
}
```

Problems:

- no snapshot;
- duplicate if job reruns;
- no suppression;
- no per-recipient audit;
- no retry control;
- no progress;
- no rate limit;
- no template version;
- no failure classification.

Better design:

```text
1. Create job: LICENSE_EXPIRY_D30, date=2026-06-18.
2. Query candidate licenses.
3. Resolve holder recipient.
4. Generate idempotency key:
   license-expiry-d30:{licenseId}:{holderUserId}:2026-06-18
5. Apply suppression/preferences.
6. Store recipient snapshot with licenseNo and expiryDate variables.
7. Run canary.
8. Send at max 10/sec with domain throttling.
9. Retry transient failure with jitter.
10. Report accepted/permanent/suppressed/dead-letter.
```

Key invariant:

```text
A license holder should not receive the same D-30 reminder twice for the same license and reminder date.
```

---

## 39. Summary Mental Model

Bulk email is not “many calls to send”.

It is:

```text
controlled, stateful, observable, rate-limited, recoverable delivery pipeline
```

The hard problems are not Jakarta Mail syntax. The hard problems are:

1. recipient snapshot;
2. personalization boundary;
3. rate limiting;
4. priority isolation;
5. retry storm prevention;
6. domain/provider backoff;
7. duplicate prevention;
8. auditability;
9. pause/resume/cancel;
10. operational visibility.

A top-tier engineer designs email sending as a subsystem with explicit invariants.

Core invariants:

```text
No unbounded send.
No unbounded retry.
No unbounded queue claim.
No unbounded attachment memory.
No bulk starvation of transactional mail.
No recipient ambiguity.
No status name that overclaims delivery.
No production bulk send without pause/kill switch.
```

---

## 40. Practical Design Heuristics

Use these as default rules:

1. For audited systems, create one logical email per recipient.
2. Never send bulk directly from an HTTP request.
3. Always snapshot recipients before sending.
4. Always use idempotency key per recipient/business event.
5. Always rate limit below provider quota.
6. Reserve capacity for transactional email.
7. Use jitter for retry.
8. Treat 4xx as potentially retryable, but detect provider-wide failures.
9. Treat 5xx recipient errors as usually permanent, but classify carefully.
10. Make pause/resume/cancel first-class.
11. Prefer secure links over large/sensitive attachments.
12. Expose queue age, not only queue size.
13. Store template version and variable snapshot.
14. Never call SMTP accepted “delivered” unless you have delivery confirmation.
15. For very high volume/campaign needs, evaluate provider API instead of raw SMTP.

---

## 41. References

Primary references used for this part:

1. Jakarta Mail / JavaMail SMTP provider documentation — SMTP provider properties, SMTP access, and provider behavior concepts.  
   `https://jakarta.ee/specifications/mail/1.6/apidocs/com/sun/mail/smtp/package-summary`

2. Eclipse Angus Mail SMTP provider documentation — modern Jakarta Mail implementation package documentation.  
   `https://eclipse-ee4j.github.io/angus-mail/docs/api/org.eclipse.angus.mail/org/eclipse/angus/mail/smtp/package-summary.html`

3. AWS SES sending quotas documentation — example of provider-side sending quotas and sandbox limits.  
   `https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas.html`

4. AWS SES service quotas documentation — daily quota and send-rate quota concepts.  
   `https://docs.aws.amazon.com/ses/latest/dg/quotas.html`

5. RFC 5321 — Simple Mail Transfer Protocol, reply code classes and SMTP semantics.  
   `https://datatracker.ietf.org/doc/html/rfc5321`

---

## 42. Next Part

Next:

```text
Part 13 — Security Deep Dive: TLS, Credential, OAuth2, Secret Management
```

Part 13 akan membahas threat model mail sending dari sisi Java application:

- TLS/STARTTLS;
- credential leakage;
- OAuth2/XOAUTH2;
- secret rotation;
- SMTP debug log redaction;
- header injection;
- attachment malware risk;
- phishing/link risk;
- tenant sender abuse;
- audit security;
- secure production checklist.

