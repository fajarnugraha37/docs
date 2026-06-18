# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-009

# Part 9 — Acknowledgement Semantics: AUTO, CLIENT, DUPS\_OK, SESSION\_TRANSACTED, dan Jakarta Context Modes

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Level: Advanced / production engineering  
> Target Java: Java 8 sampai Java 25  
> Fokus: acknowledgement sebagai batas kebenaran antara broker, consumer, side effect, retry, duplicate, redelivery, dan transaksi.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas consumer engineering: bagaimana message masuk ke aplikasi, listener berjalan, prefetch memengaruhi flow, dan shutdown harus dilakukan secara aman. Namun semua itu belum menjawab pertanyaan paling penting:

> **Kapan sebuah message dianggap selesai?**

Di JMS/Jakarta Messaging, jawaban teknisnya adalah **acknowledgement**. Tetapi dalam sistem production, jawaban sebenarnya lebih berat:

> Sebuah message boleh dianggap selesai hanya ketika semua side effect yang diwajibkan oleh business semantics sudah aman, durable, dan replay-safe.

Part ini membahas acknowledgement bukan sebagai enum API, tetapi sebagai **failure boundary**.

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan perbedaan `AUTO_ACKNOWLEDGE`, `CLIENT_ACKNOWLEDGE`, `DUPS_OK_ACKNOWLEDGE`, dan `SESSION_TRANSACTED`.
2. Memahami bahwa acknowledgement bekerja pada level **session/context**, bukan selalu per-message seperti intuisi umum.
3. Menentukan ack mode yang tepat untuk consumer yang melakukan side effect ke database, HTTP downstream, file, cache, email, atau external system.
4. Memahami kapan message bisa hilang, duplicate, redelivery, atau stuck.
5. Mendesain handler yang aman terhadap crash setelah side effect tetapi sebelum ack.
6. Menghubungkan ack dengan retry, redelivery, DLQ, idempotency, transaction, dan observability.
7. Membaca kode JMS dan langsung melihat apakah acknowledgement boundary-nya aman atau berbahaya.

---

## 1. Big Picture: Acknowledgement Adalah Kontrak “Saya Sudah Aman”

Secara sederhana, acknowledgement adalah sinyal dari consumer ke provider/broker:

> “Message ini sudah boleh dianggap dikonsumsi. Broker tidak perlu mengirim ulang message ini kepada saya.”

Tetapi dalam engineering nyata, acknowledgement bukan sekadar “sudah dibaca”. Message yang sudah dibaca belum tentu sudah diproses. Message yang sudah diproses belum tentu side effect-nya sudah commit. Side effect yang sudah commit belum tentu aman dari duplicate jika consumer crash sebelum ack.

Mari lihat lifecycle kasar:

```text
Broker queue
   |
   | deliver
   v
Consumer receive buffer / listener
   |
   | application handler runs
   v
Business side effect
   |
   | acknowledgement
   v
Broker removes / marks message as consumed
```

Pertanyaan desainnya:

```text
Ack terjadi sebelum side effect?
Ack terjadi setelah side effect?
Ack terjadi otomatis?
Ack terjadi manual?
Ack terjadi per message?
Ack terjadi per batch/session?
Ack digabung dengan transaction commit?
Ack bisa tertunda?
Ack bisa gagal?
```

Setiap jawaban menghasilkan reliability semantics yang berbeda.

---

## 2. Mental Model Utama: Ada 3 State Berbeda

Banyak bug JMS muncul karena engineer menyamakan tiga hal berikut:

1. **Delivered**
2. **Processed**
3. **Acknowledged**

Padahal ketiganya berbeda.

### 2.1 Delivered

Message sudah dikirim oleh broker ke consumer. Bisa sudah masuk ke network socket, client library buffer, session dispatch thread, atau listener callback.

Delivered tidak berarti handler berhasil.

```text
Broker --> Consumer
```

Pada tahap ini, message bisa masih dianggap “in-flight” oleh broker.

### 2.2 Processed

Application code sudah menjalankan business logic. Misalnya:

- insert database,
- update case status,
- call downstream API,
- kirim email,
- generate document,
- publish event lanjutan,
- update search index,
- write audit log.

Processed tidak otomatis berarti broker tahu bahwa message selesai.

### 2.3 Acknowledged

Broker/provider sudah menerima sinyal bahwa message selesai. Setelah acknowledged, message biasanya tidak akan dikirim ulang dalam alur normal.

```text
Consumer --> Broker: ACK
```

### 2.4 Failure Window

Masalah muncul di antara state-state tersebut.

```text
Delivered
   |
   | crash before processing
   v
Not processed, not acknowledged
=> safe redelivery expected

Processed
   |
   | crash before acknowledgement
   v
Processed, not acknowledged
=> duplicate side effect risk on redelivery

Acknowledged
   |
   | crash before durable side effect
   v
Acknowledged, not processed durably
=> message loss from business perspective
```

Top 1% engineer tidak hanya bertanya “ack mode apa?”. Mereka bertanya:

> Failure window mana yang saya pilih, dan bagaimana saya menutup risikonya?

---

## 3. Acknowledgement Bukan Business Success

Ack hanya memberi tahu provider bahwa message boleh tidak dikirim ulang. Ack tidak otomatis membuktikan:

- database commit berhasil,
- downstream API benar-benar memproses request,
- email sudah terkirim,
- state machine tidak melanggar invariant,
- audit trail sudah ditulis,
- event lanjutan sudah publish,
- external side effect tidak duplicate,
- user-visible outcome sudah benar.

Karena itu, jangan mendesain handler seperti ini:

```text
received message = work done
```

Desain yang benar:

```text
received message = work assigned
acknowledged message = broker no longer responsible for retry
business completion = domain invariant has safely moved forward
```

---

## 4. API Surface: Ack Mode Klasik dan Simplified API

Di JMS klasik (`javax.jms`) dan Jakarta Messaging (`jakarta.jms`), mode acknowledgement umumnya muncul saat membuat `Session` atau `JMSContext`.

### 4.1 Classic API Style

```java
Connection connection = connectionFactory.createConnection();
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(queue);
```

Parameter pertama `false` berarti session tidak transacted. Parameter kedua menentukan acknowledgement mode.

Untuk transacted session:

```java
Session session = connection.createSession(true, Session.SESSION_TRANSACTED);
```

Dalam praktik, ketika session transacted, acknowledge mode biasa diabaikan karena commit/rollback session yang menentukan nasib message.

### 4.2 Simplified API Style JMS 2.0 / Jakarta Messaging

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
    JMSConsumer consumer = context.createConsumer(queue);
    Message message = consumer.receive(5_000);
}
```

Atau transacted:

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.SESSION_TRANSACTED)) {
    JMSConsumer consumer = context.createConsumer(queue);
    Message message = consumer.receive(5_000);
    // process
    context.commit();
}
```

### 4.3 Mode Utama

| Mode | Inti Semantics | Cocok Untuk | Risiko Utama |
|---|---|---|---|
| `AUTO_ACKNOWLEDGE` | Provider otomatis ack setelah receive/listener sukses | Handler sederhana, idempotent, low-risk | Ack bisa terjadi terlalu cepat relatif terhadap side effect jika logic salah memahami boundary |
| `CLIENT_ACKNOWLEDGE` | Aplikasi eksplisit memanggil `acknowledge()` | Batch manual, kontrol ack | Ack biasanya session-level, bukan individual message |
| `DUPS_OK_ACKNOWLEDGE` | Provider boleh lazy ack; duplicate lebih mungkin | Throughput tinggi, duplicate acceptable | Duplicate delivery lebih mungkin dan recovery lebih longgar |
| `SESSION_TRANSACTED` | Commit/rollback session menentukan ack dan send | Local JMS atomicity | Tidak otomatis atomic dengan database kecuali XA/JTA |

---

## 5. AUTO_ACKNOWLEDGE

`AUTO_ACKNOWLEDGE` sering dianggap paling mudah, dan memang begitu. Namun “mudah” tidak selalu berarti “aman untuk semua kasus”.

### 5.1 Semantics Dasar

Dalam synchronous receive, message di-ack secara otomatis ketika call receive berhasil selesai menurut aturan provider/API.

Dalam asynchronous listener, acknowledgement biasanya terjadi ketika `onMessage()` berhasil return tanpa exception.

Mental model:

```text
Broker delivers message
Consumer receives message
Application callback completes successfully
Provider acknowledges message automatically
```

### 5.2 Contoh Classic API

```java
Connection connection = connectionFactory.createConnection();
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(queue);

connection.start();

Message message = consumer.receive(5_000);
if (message != null) {
    handle(message);
    // no explicit acknowledge
}
```

### 5.3 Contoh Listener

```java
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(queue);

consumer.setMessageListener(message -> {
    handle(message);
    // if this method returns normally, provider considers it successful
});
```

### 5.4 Kapan Cocok

`AUTO_ACKNOWLEDGE` cocok ketika:

- handler cepat dan sederhana,
- side effect idempotent,
- kehilangan satu message tidak catastrophic,
- retry tidak perlu custom,
- message hanya update cache non-critical,
- handler menulis ke store yang sudah punya idempotency constraint,
- listener container/framework menangani exception dengan benar.

Contoh cukup aman:

```text
Message: ProductUpdatedEvent
Handler: invalidate cache by productId
Jika duplicate: aman
Jika redelivered: aman
Jika cache invalidation gagal: eventual refresh masih mungkin
```

### 5.5 Kapan Berbahaya

Berbahaya untuk:

- payment,
- case status transition,
- enforcement action,
- legal notification,
- email resmi,
- one-time token generation,
- irreversible external API,
- document issuance,
- audit-critical update.

Contoh problem:

```java
consumer.setMessageListener(message -> {
    CaseCommand command = parse(message);

    updateCaseStatus(command);      // DB update
    callExternalAgency(command);    // external side effect
    writeAudit(command);            // audit
});
```

Jika `updateCaseStatus()` commit berhasil, lalu `callExternalAgency()` berhasil, tetapi `writeAudit()` throw exception, provider mungkin tidak ack dan message bisa redelivered. Pada redelivery, `updateCaseStatus()` dan `callExternalAgency()` bisa terjadi lagi kecuali handler idempotent.

Jika exception ditelan:

```java
consumer.setMessageListener(message -> {
    try {
        handle(message);
    } catch (Exception e) {
        log.error("failed", e);
        // dangerous: method returns normally
    }
});
```

Maka provider melihat listener berhasil dan melakukan ack. Dari broker perspective message selesai, padahal business processing gagal.

Ini anti-pattern besar.

### 5.6 Rule of Thumb

```text
Dalam AUTO_ACKNOWLEDGE, jangan swallow exception yang berarti message belum berhasil diproses.
```

Jika kamu catch exception hanya untuk logging lalu return normal, kamu mengubah failure menjadi success di mata broker.

---

## 6. CLIENT_ACKNOWLEDGE

`CLIENT_ACKNOWLEDGE` memberi kontrol manual kepada aplikasi untuk menentukan kapan acknowledgement dikirim.

Namun ada jebakan besar:

> Dalam JMS, client acknowledge umumnya mengakui semua message yang sudah delivered/consumed dalam session tersebut, bukan hanya message yang dipanggil `acknowledge()`.

Ini sangat penting.

### 6.1 Contoh Basic

```java
Session session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(queue);

connection.start();

Message message = consumer.receive(5_000);
if (message != null) {
    handle(message);
    message.acknowledge();
}
```

Sekilas terlihat per-message. Tapi mental model yang lebih aman:

```text
message.acknowledge()
  => acknowledge all messages consumed so far by this session
```

### 6.2 Session-Level Ack Trap

Misalnya satu session menerima 10 message:

```text
Session S received: M1 M2 M3 M4 M5 M6 M7 M8 M9 M10
```

Lalu aplikasi memanggil:

```java
m5.acknowledge();
```

Banyak engineer mengira hanya M5 yang ack. Tetapi JMS semantics mengakui semua message yang sudah dikonsumsi oleh session tersebut.

Secara praktis:

```text
ack(M5) can acknowledge M1..M10 consumed by same session
```

Implikasi:

- Jangan pakai satu session untuk concurrent handler banyak message lalu ack manual sembarangan.
- Jangan mengira `CLIENT_ACKNOWLEDGE` memberi precise individual ack seperti beberapa broker API native.
- Jika butuh isolated ack boundary, gunakan session terpisah, transaction, atau framework/container yang benar.

### 6.3 Batch Processing dengan CLIENT_ACKNOWLEDGE

Salah satu penggunaan wajar:

```java
List<Message> batch = new ArrayList<>();

for (int i = 0; i < 100; i++) {
    Message message = consumer.receive(100);
    if (message == null) {
        break;
    }
    batch.add(message);
}

processBatch(batch);

if (!batch.isEmpty()) {
    batch.get(batch.size() - 1).acknowledge();
}
```

Mental model:

```text
Process all messages in batch successfully
Ack the session's consumed messages
```

Risiko:

- Jika sebagian batch berhasil dan sebagian gagal, kamu harus siap redelivery sebagian atau seluruh batch tergantung boundary.
- Jika processBatch melakukan partial commit ke DB, duplicate harus ditangani.
- Jika prefetch besar, session bisa sudah menerima lebih banyak message daripada batch yang kamu kira.

### 6.4 CLIENT_ACKNOWLEDGE dan `recover()`

Jika message belum diack dan aplikasi ingin meminta redelivery, session/context dapat di-recover.

Classic API:

```java
session.recover();
```

Simplified API:

```java
context.recover();
```

Mental model:

```text
Unacknowledged consumed messages in this session become eligible for redelivery.
```

Contoh:

```java
try {
    Message message = consumer.receive(5_000);
    if (message != null) {
        handle(message);
        message.acknowledge();
    }
} catch (Exception e) {
    session.recover();
}
```

Namun jangan menyalahgunakan `recover()` sebagai retry loop lokal tanpa batas. Jika handler selalu gagal, kamu membuat poison loop.

### 6.5 Kapan Cocok

`CLIENT_ACKNOWLEDGE` cocok untuk:

- manual batch ack,
- low-level consumer yang butuh explicit boundary,
- handler yang tidak memakai transaction tetapi ingin ack setelah side effect,
- sistem yang tahu dan menerima session-level ack semantics,
- integrasi dengan dedup/inbox pattern.

### 6.6 Kapan Tidak Cocok

Tidak cocok jika:

- kamu butuh individual ack per message dalam satu session,
- ada concurrent processing dalam satu session,
- handler melakukan side effect kompleks tanpa idempotency,
- kamu tidak mengontrol prefetch/delivery buffer,
- kamu mengira ack satu message tidak memengaruhi message lain.

---

## 7. DUPS_OK_ACKNOWLEDGE

`DUPS_OK_ACKNOWLEDGE` adalah mode yang mengizinkan provider melakukan acknowledgement secara lebih malas/lazy. Tujuannya biasanya performance.

### 7.1 Mental Model

```text
AUTO_ACKNOWLEDGE:
  provider lebih agresif memastikan ack

DUPS_OK_ACKNOWLEDGE:
  provider boleh menunda ack untuk mengurangi overhead
  duplicate delivery lebih mungkin jika failure terjadi
```

Nama mode-nya sudah memberi warning:

> duplicates are okay.

Bukan berarti provider sengaja selalu duplicate, tetapi aplikasi harus siap duplicate.

### 7.2 Contoh

```java
Session session = connection.createSession(false, Session.DUPS_OK_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(queue);
```

### 7.3 Kapan Cocok

Cocok untuk:

- telemetry non-critical,
- metrics aggregation,
- cache warm-up,
- search index hint,
- notification yang bisa dedup,
- high-throughput event yang idempotent,
- consumer yang memang tidak peduli duplicate.

Contoh:

```text
Message: PageViewedEvent
Handler: increment approximate analytics counter
Duplicate: acceptable within tolerance
```

### 7.4 Kapan Berbahaya

Berbahaya untuk:

- payment,
- legal status update,
- issuing license,
- one-time action,
- email official yang tidak boleh double send,
- external API non-idempotent.

Jika kamu memakai `DUPS_OK_ACKNOWLEDGE` untuk command yang mengubah state penting, kamu sedang menyatakan:

> Saya rela message duplicate dan handler saya aman terhadap duplicate.

Jika itu tidak benar, mode ini salah.

---

## 8. SESSION_TRANSACTED

`SESSION_TRANSACTED` mengubah mental model dari “ack manual” menjadi “commit/rollback”.

### 8.1 Local JMS Transaction

Dalam transacted session, message consumption dan message production di session tersebut berada dalam local transaction JMS.

```java
Session session = connection.createSession(true, Session.SESSION_TRANSACTED);
MessageConsumer consumer = session.createConsumer(inputQueue);
MessageProducer producer = session.createProducer(outputQueue);

try {
    Message input = consumer.receive(5_000);
    if (input != null) {
        Message output = transform(input, session);
        producer.send(output);
        session.commit();
    }
} catch (Exception e) {
    session.rollback();
}
```

Jika commit berhasil:

```text
input message acknowledged
output message sent
```

Jika rollback:

```text
input message not acknowledged / eligible for redelivery
output message not committed
```

### 8.2 Apa yang Tidak Dijamin

Local JMS transaction tidak otomatis mencakup database.

```java
try {
    Message input = consumer.receive();

    jdbcUpdate();      // DB transaction separate
    producer.send(...);// JMS transaction

    session.commit();  // commits JMS only
} catch (Exception e) {
    session.rollback();
}
```

Jika DB commit berhasil tetapi JMS rollback, input message bisa redelivered dan DB update duplicate.

Jika JMS commit berhasil tetapi DB rollback, output event mungkin terkirim padahal state DB tidak berubah.

Jangan menyamakan:

```text
SESSION_TRANSACTED == atomic DB + JMS
```

Yang benar:

```text
SESSION_TRANSACTED == atomicity within JMS session resources
```

Untuk DB + JMS atomicity, opsinya:

- JTA/XA 2-phase commit,
- transactional outbox,
- inbox/dedup,
- saga/compensation,
- redesign side effect boundary.

Part 10 akan membahas ini lebih dalam.

### 8.3 Commit sebagai Ack Boundary

Dalam transacted session, `commit()` adalah acknowledgement boundary.

```text
handle message successfully
commit session
=> message consumed
```

`rollback()` membuat message eligible untuk redelivery.

```text
handle failed
rollback session
=> message redelivered according to broker policy
```

### 8.4 Kapan Cocok

Cocok untuk:

- consume one message and produce another JMS message atomically,
- batch consume then commit as unit,
- JMS-only workflow step,
- handler yang tidak perlu atomic dengan DB,
- processing yang punya external idempotency.

### 8.5 Kapan Tidak Cukup

Tidak cukup untuk:

- update DB + ack message secara atomic,
- call external REST API + ack secara exactly-once,
- send email + ack tanpa duplicate,
- multi-resource transaction tanpa XA/outbox.

---

## 9. Jakarta `JMSContext` Session Modes

JMS 2.0 memperkenalkan simplified API dengan `JMSContext`. Jakarta Messaging melanjutkan model ini di namespace `jakarta.jms`.

### 9.1 Create Context

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
    JMSConsumer consumer = context.createConsumer(queue);
    Message message = consumer.receive();
}
```

Mode yang umum:

```java
JMSContext.AUTO_ACKNOWLEDGE
JMSContext.CLIENT_ACKNOWLEDGE
JMSContext.DUPS_OK_ACKNOWLEDGE
JMSContext.SESSION_TRANSACTED
```

### 9.2 Acknowledge di JMSContext

Dalam simplified API, acknowledge dapat dilakukan melalui message atau context tergantung pola API yang dipakai.

Contoh:

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.CLIENT_ACKNOWLEDGE)) {
    JMSConsumer consumer = context.createConsumer(queue);
    Message message = consumer.receive(5_000);

    if (message != null) {
        handle(message);
        message.acknowledge();
    }
}
```

Atau pada beberapa pola, `context.acknowledge()` tersedia untuk mengakui message yang dikonsumsi dalam context.

Mental model tetap:

```text
ack applies to consumed messages in the context/session boundary
```

### 9.3 Commit/Rollback di JMSContext

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.SESSION_TRANSACTED)) {
    JMSConsumer consumer = context.createConsumer(inputQueue);
    JMSProducer producer = context.createProducer();

    Message input = consumer.receive(5_000);
    if (input != null) {
        String outputPayload = transform(input);
        producer.send(outputQueue, outputPayload);
        context.commit();
    }
} catch (RuntimeException e) {
    // if context still available, rollback should be called in a narrower scope
}
```

Lebih eksplisit:

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.SESSION_TRANSACTED)) {
    JMSConsumer consumer = context.createConsumer(inputQueue);
    JMSProducer producer = context.createProducer();

    try {
        Message input = consumer.receive(5_000);
        if (input != null) {
            producer.send(outputQueue, transform(input));
            context.commit();
        }
    } catch (RuntimeException ex) {
        context.rollback();
        throw ex;
    }
}
```

---

## 10. Ack Timing Patterns

Sekarang kita lihat pola acknowledgement berdasarkan timing.

### 10.1 Ack Before Work

```text
receive
ack
process
```

Ini hampir selalu buruk untuk critical work.

Jika crash setelah ack sebelum process:

```text
broker: done
business: not done
=> message loss
```

Cocok hanya untuk work yang boleh hilang.

### 10.2 Ack After Work

```text
receive
process
ack
```

Ini pola umum.

Jika crash setelah process sebelum ack:

```text
broker: not done
business: done
=> redelivery + duplicate risk
```

Karena itu handler harus idempotent.

### 10.3 Ack with Transaction Commit

```text
receive
process within transaction boundary
commit
```

Untuk JMS-only transaction, commit bisa menggabungkan consume + produce. Untuk DB + JMS, perlu XA atau pattern lain.

### 10.4 Ack After Durable Inbox Record

```text
receive
insert inbox record with unique message id
commit DB
ack
process asynchronously from inbox
```

Ini pattern advanced untuk memindahkan reliability boundary dari broker ke database.

Jika crash setelah insert inbox sebelum ack:

- message redelivered,
- insert duplicate ditolak unique constraint,
- consumer bisa ack karena sudah pernah diterima.

### 10.5 Ack After Business State Transition with Idempotency

```text
receive command
apply transition only if current state allows
commit DB
ack
```

Jika redelivered:

```text
state already moved
handler detects no-op / already applied
ack safely
```

Ini cocok untuk state machine/case management.

---

## 11. Crash Matrix

Mari gunakan contoh handler:

```text
Message: ApproveApplicationCommand(applicationId, commandId)
Side effect:
  1. update application status to APPROVED
  2. write audit trail
  3. publish ApplicationApprovedEvent
  4. ack message
```

### 11.1 Crash Before DB Update

```text
receive
crash
```

Message belum ack. Redelivery aman.

### 11.2 Crash After DB Update Before Audit

```text
receive
update status commit
crash
```

Redelivery akan mencoba update lagi. Aman hanya jika transition idempotent.

Butuh:

```sql
WHERE status = 'PENDING'
```

atau command tracking:

```text
command_id unique
```

### 11.3 Crash After Audit Before Event

```text
status approved
 audit written
crash
```

Redelivery harus tahu apakah event perlu publish. Jika event publish langsung di handler, bisa hilang atau duplicate.

Lebih baik gunakan outbox:

```text
same DB transaction:
  update status
  insert audit
  insert outbox event
ack after commit
```

### 11.4 Crash After Event Publish Before Ack

```text
DB commit
publish event
crash before ack
```

Redelivery bisa publish event kedua kali. Consumer event downstream harus idempotent atau event publish harus melalui outbox.

### 11.5 Crash After Ack Before Non-Durable Side Effect

```text
ack
send email
crash before email
```

Message hilang dari broker, email tidak terkirim. Untuk critical email, ack setelah durable email task/outbox, bukan setelah direct send.

---

## 12. Invariant Ack yang Harus Dipegang

Gunakan invariant berikut saat review desain:

### Invariant 1 — Jangan ack sebelum minimum durable progress

```text
Ack boleh dilakukan hanya setelah sistem punya bukti durable bahwa work sudah selesai atau bisa dilanjutkan tanpa message asli.
```

Contoh bukti durable:

- DB state sudah berubah,
- inbox row sudah inserted,
- outbox row sudah inserted,
- audit row sudah written,
- command idempotency record sudah stored,
- task recovery record sudah created.

### Invariant 2 — Setiap message yang bisa redeliver harus idempotent

Jika acknowledgement terjadi setelah side effect, duplicate bisa terjadi. Maka handler harus aman terhadap redelivery.

### Invariant 3 — Exception berarti failure, kecuali kamu eksplisit mengubahnya menjadi success

Jika handler catch exception dan return normal, provider dapat menganggap message berhasil.

### Invariant 4 — Ack boundary harus sejajar dengan business boundary

Jangan ack ketika baru parse payload jika business work belum selesai.

### Invariant 5 — Session-level ack harus dipahami

Dalam `CLIENT_ACKNOWLEDGE`, ack satu message dapat ack semua message consumed oleh session.

### Invariant 6 — Local JMS transaction bukan distributed transaction

`SESSION_TRANSACTED` tidak otomatis melindungi DB/external API.

---

## 13. Bad Pattern: Swallow Exception di Listener

Ini salah satu bug paling umum:

```java
consumer.setMessageListener(message -> {
    try {
        handle(message);
    } catch (Exception e) {
        log.error("Failed to handle message", e);
    }
});
```

Masalah:

```text
Exception swallowed
onMessage returns normally
AUTO_ACKNOWLEDGE may ack
Message lost from business perspective
```

Lebih aman:

```java
consumer.setMessageListener(message -> {
    try {
        handle(message);
    } catch (RuntimeException e) {
        log.error("Failed to handle message", e);
        throw e;
    } catch (Exception e) {
        log.error("Failed to handle message", e);
        throw new RuntimeException(e);
    }
});
```

Tetapi ini masih belum cukup jika handler sudah melakukan partial side effect. Butuh idempotency.

---

## 14. Bad Pattern: CLIENT_ACKNOWLEDGE dengan Concurrent Processing Satu Session

Contoh buruk:

```java
Session session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(queue);
ExecutorService executor = Executors.newFixedThreadPool(10);

while (running) {
    Message message = consumer.receive();
    executor.submit(() -> {
        handle(message);
        message.acknowledge();
    });
}
```

Masalah:

1. `Session` bukan objek yang dirancang untuk dipakai concurrent sembarangan.
2. Ack satu message dapat ack message lain yang sudah consumed session.
3. Message yang belum selesai di worker lain bisa ikut acknowledged.
4. Crash/failure membuat recovery tidak deterministic.

Desain lebih baik:

- gunakan container listener concurrency yang membuat session per consumer thread,
- gunakan session terpisah per worker,
- gunakan transacted session per processing unit,
- gunakan broker/framework native concurrency config.

---

## 15. Bad Pattern: Ack Setelah External API Non-Idempotent Tanpa Guard

```java
handle(message) {
    PaymentCommand command = parse(message);
    paymentGateway.charge(command.card(), command.amount());
    message.acknowledge();
}
```

Jika crash setelah `charge()` sebelum `acknowledge()`:

```text
payment charged
message redelivered
payment charged again
```

Solusi bukan sekadar memilih ack mode lain. Solusi ada di semantic design:

- gunakan idempotency key ke payment gateway,
- simpan payment attempt dengan unique command id,
- cek status sebelum charge ulang,
- gunakan outbox/payment task state,
- ack hanya setelah durable state menyatakan external side effect sudah recorded.

---

## 16. Ack dan Redelivery

Message yang tidak diack bisa dikirim ulang. Tetapi redelivery behavior bergantung provider dan konfigurasi broker:

- redelivery delay,
- maximum delivery attempts,
- exponential backoff,
- dead letter queue,
- delivery count property,
- rollback handling,
- connection failure handling.

Secara JMS, message dapat membawa indikasi redelivery:

```java
boolean redelivered = message.getJMSRedelivered();
```

Banyak provider juga menyediakan delivery count property, misalnya `JMSXDeliveryCount`.

Contoh:

```java
int deliveryCount = 1;
try {
    if (message.propertyExists("JMSXDeliveryCount")) {
        deliveryCount = message.getIntProperty("JMSXDeliveryCount");
    }
} catch (JMSException e) {
    // fallback
}
```

Gunakan ini untuk observability dan poison message strategy, bukan sebagai satu-satunya business correctness guard.

---

## 17. Ack dan DLQ

DLQ biasanya terjadi ketika message gagal diproses berulang kali. Ack mode memengaruhi bagaimana message mencapai DLQ.

### 17.1 AUTO_ACKNOWLEDGE

Jika listener throw exception, provider/container dapat menyebabkan redelivery. Setelah threshold broker, message dapat masuk DLQ.

Jika exception diswallow, message diack dan tidak masuk DLQ.

### 17.2 CLIENT_ACKNOWLEDGE

Jika tidak diack dan session recover/connection close, message redeliver. Setelah berulang kali gagal, broker policy bisa DLQ.

Jika aplikasi tetap retry lokal tanpa melepaskan message, DLQ mungkin tidak terjadi.

### 17.3 SESSION_TRANSACTED

Rollback berulang bisa mendorong redelivery count. Setelah max attempts, broker dapat mengirim ke DLQ.

### 17.4 Design Rule

```text
DLQ hanya berguna jika failure benar-benar diekspresikan ke broker.
```

Jika kode menangkap semua error lalu ack, DLQ tidak akan pernah menerima message yang gagal.

---

## 18. Ack dan Prefetch

Prefetch membuat provider mengirim beberapa message ke consumer sebelum aplikasi benar-benar memproses semuanya.

```text
Broker -> Consumer buffer: M1 M2 M3 M4 M5 M6 M7 M8 M9 M10
Application currently processing: M1
```

Dalam mode ack tertentu, message yang sudah delivered ke session bisa terdampak oleh ack/recover.

Risiko:

- message dianggap in-flight padahal belum diproses,
- session-level ack mengakui terlalu banyak,
- crash membuat banyak message redeliver,
- satu slow consumer memegang banyak message,
- ordering/fairness terganggu.

Untuk workload critical:

- kecilkan prefetch,
- gunakan transaksi per message/batch kecil,
- gunakan concurrency yang jelas,
- jangan satu session untuk banyak worker manual.

---

## 19. Ack dan Ordering

Acknowledgement dapat memengaruhi ordering karena rollback/redelivery bisa mengembalikan message ke antrean atau mengirim ulang ke consumer.

Contoh:

```text
Queue order: M1 M2 M3
Consumer receives M1, M2, M3 due to prefetch
M1 fails
M2 succeeds
M3 succeeds
```

Jika M2/M3 sudah ack tetapi M1 redeliver, observable order bisa berubah.

Untuk aggregate yang butuh strict order:

- gunakan message group,
- satu consumer per key/partition,
- transaction boundary jelas,
- hindari concurrent processing untuk same entity,
- idempotent + version check.

---

## 20. Ack dan Idempotency

Acknowledgement tidak menggantikan idempotency.

Ack menjawab:

```text
Apakah broker perlu mengirim ulang message?
```

Idempotency menjawab:

```text
Jika message dikirim ulang, apakah business side effect tetap aman?
```

Dalam at-least-once systems, idempotency adalah wajib untuk critical handler.

### 20.1 Idempotency by Message ID

```sql
CREATE TABLE processed_message (
    consumer_name VARCHAR(100) NOT NULL,
    message_id VARCHAR(200) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

Handler:

```java
void handle(Message message) throws Exception {
    String messageId = message.getJMSMessageID();

    if (alreadyProcessed("case-approval-consumer", messageId)) {
        message.acknowledge();
        return;
    }

    processBusinessLogic(message);
    markProcessed("case-approval-consumer", messageId);
    message.acknowledge();
}
```

Masalah: `JMSMessageID` biasanya dibuat broker/provider. Untuk business command, lebih baik ada business idempotency key di payload/header.

### 20.2 Idempotency by Business Command ID

```json
{
  "messageType": "ApproveApplicationCommand",
  "commandId": "cmd-2026-000123",
  "applicationId": "APP-001",
  "requestedBy": "user-123"
}
```

DB:

```sql
CREATE TABLE command_processing (
    command_id VARCHAR(100) PRIMARY KEY,
    status VARCHAR(30) NOT NULL,
    result_ref VARCHAR(100),
    created_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP
);
```

Ini lebih kuat karena duplicate dari source berbeda pun bisa dikontrol.

### 20.3 Idempotency by State Transition

```sql
UPDATE application
SET status = 'APPROVED', approved_at = CURRENT_TIMESTAMP
WHERE application_id = ?
  AND status = 'PENDING';
```

Jika affected rows = 1:

```text
transition applied
```

Jika affected rows = 0:

```text
already approved / invalid transition
```

Handler harus membedakan:

- already done → ack,
- invalid command → DLQ/manual review,
- transient DB failure → rollback/redelivery.

---

## 21. Ack dan Database Transaction: 4 Pola Umum

### 21.1 Pola A — Ack Setelah DB Commit

```text
receive
begin DB tx
update state
commit DB
ack JMS
```

Failure:

```text
crash after DB commit before ack => redelivery duplicate
```

Butuh idempotency.

Ini sering menjadi default pragmatis.

### 21.2 Pola B — Ack Sebelum DB Commit

```text
receive
ack JMS
begin DB tx
update state
commit DB
```

Failure:

```text
crash after ack before DB commit => message lost
```

Hindari untuk critical work.

### 21.3 Pola C — XA Transaction

```text
begin JTA
consume JMS
update DB
commit JTA with 2PC
```

Kelebihan:

- atomic DB + JMS secara transaction manager.

Kekurangan:

- kompleks,
- provider support bervariasi,
- operationally heavy,
- heuristic failure,
- performance cost,
- harder debugging.

### 21.4 Pola D — Inbox/Outbox

```text
receive JMS
insert inbox/command record idempotently
commit DB
ack JMS
business worker processes inbox/outbox transactionally
```

Kelebihan:

- robust,
- observable,
- replayable,
- cocok regulated systems,
- tidak membutuhkan XA.

Kekurangan:

- lebih banyak komponen,
- eventual consistency,
- butuh cleanup/retention,
- butuh relay worker.

---

## 22. Ack dan External Side Effect

External side effect lebih sulit daripada DB karena biasanya tidak bisa ikut transaction lokal.

Contoh external side effect:

- REST call ke agency lain,
- email/SMS,
- payment,
- document signing,
- S3 upload,
- search indexing,
- notification push.

### 22.1 Direct External Call Risk

```text
receive
call external API
ack
```

Crash after API success before ack → duplicate external call.

### 22.2 Safer Pattern: Durable Task + Worker

```text
receive command
write external_task row with idempotency key
commit DB
ack JMS
external worker sends request with idempotency key
records result
```

External worker itself must be retry-safe.

### 22.3 Safer Pattern: Idempotency Key to External API

```http
POST /payments
Idempotency-Key: command-123
```

If retried, provider returns same result.

### 22.4 Safer Pattern: Status Query Before Retry

If external API does not support idempotency, sometimes use:

```text
check by business reference
if already exists, do not create again
else create
```

Not always safe due to race conditions, but often better than blind retry.

---

## 23. Ack dan Poison Message

Poison message adalah message yang terus gagal karena masalah permanen:

- payload invalid,
- schema incompatible,
- missing required field,
- referenced entity not found permanently,
- business rule impossible,
- unauthorized command,
- bug deterministic di handler.

Ack mode memengaruhi poison behavior.

### 23.1 Salah: Infinite Redelivery Tanpa Klasifikasi

```java
try {
    handle(message);
    message.acknowledge();
} catch (Exception e) {
    session.recover();
}
```

Jika payload invalid, message akan terus redeliver.

### 23.2 Lebih Baik: Klasifikasi Error

```text
Transient error:
  DB timeout, broker temporary issue, downstream 503
  => rollback/recover/redelivery

Permanent error:
  invalid schema, unknown enum, impossible state
  => send to invalid-message/DLQ/manual review, then ack original

Bug / unknown:
  fail fast, redelivery limited, DLQ after threshold
```

### 23.3 Manual DLQ Publish Pattern

Kadang aplikasi memutuskan sendiri untuk memarkir message:

```java
try {
    handle(message);
    message.acknowledge();
} catch (PermanentMessageException e) {
    sendToParkingLot(message, e);
    message.acknowledge();
} catch (TransientException e) {
    session.recover();
}
```

Harus hati-hati: `sendToParkingLot` dan `acknowledge` tidak atomic kecuali transaction/pattern yang tepat.

---

## 24. Ack Mode Decision Framework

Gunakan pertanyaan berikut.

### 24.1 Apakah side effect critical?

Jika ya, hindari ack-before-work dan hindari `DUPS_OK` kecuali idempotency kuat.

### 24.2 Apakah handler idempotent?

Jika tidak, jangan deploy sebagai at-least-once consumer critical. Perbaiki idempotency dulu.

### 24.3 Apakah butuh batch?

Jika ya, `CLIENT_ACKNOWLEDGE` atau `SESSION_TRANSACTED` bisa relevan, tapi hati-hati session-level boundary.

### 24.4 Apakah consume dan produce JMS harus atomic?

Gunakan `SESSION_TRANSACTED`.

### 24.5 Apakah DB + JMS harus atomic?

Pertimbangkan:

- XA/JTA jika environment enterprise dan ops sanggup,
- outbox/inbox jika ingin robustness dan auditability,
- idempotency jika acceptable.

### 24.6 Apakah duplicate acceptable?

Jika duplicate acceptable, `DUPS_OK` mungkin bisa digunakan untuk throughput. Jika tidak, tetap butuh idempotency karena mode lain pun tidak memberi exactly-once end-to-end.

---

## 25. Practical Recipes

### 25.1 Simple Non-Critical Consumer

```java
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(queue);

consumer.setMessageListener(message -> {
    try {
        invalidateCache(message);
    } catch (RuntimeException e) {
        // throw to avoid false success if cache invalidation is considered required
        throw e;
    }
});
```

Use when:

```text
Duplicate safe
Loss not catastrophic
Handler simple
```

### 25.2 Critical Consumer with Manual Ack and Idempotency

```java
Session session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(queue);

while (running) {
    Message message = consumer.receive(1_000);
    if (message == null) {
        continue;
    }

    try {
        String commandId = message.getStringProperty("commandId");

        if (commandId == null || commandId.isBlank()) {
            throw new PermanentMessageException("Missing commandId");
        }

        ProcessingResult result = service.processIdempotently(commandId, message);

        if (result.isSuccess() || result.isAlreadyProcessed()) {
            message.acknowledge();
        } else if (result.isPermanentFailure()) {
            parkingLot.store(message, result.reason());
            message.acknowledge();
        } else {
            session.recover();
        }
    } catch (PermanentMessageException e) {
        parkingLot.store(message, e.getMessage());
        message.acknowledge();
    } catch (Exception e) {
        session.recover();
    }
}
```

Notes:

- This assumes one processing flow per session.
- Parking lot + ack are not atomic unless designed carefully.
- For strict consistency, use transacted session or durable DB pattern.

### 25.3 JMS-to-JMS Transactional Transform

```java
Session session = connection.createSession(true, Session.SESSION_TRANSACTED);
MessageConsumer consumer = session.createConsumer(inputQueue);
MessageProducer producer = session.createProducer(outputQueue);

while (running) {
    try {
        Message input = consumer.receive(1_000);
        if (input == null) {
            continue;
        }

        TextMessage output = session.createTextMessage(transform(input));
        output.setJMSCorrelationID(input.getJMSMessageID());

        producer.send(output);
        session.commit();
    } catch (Exception e) {
        session.rollback();
    }
}
```

Semantics:

```text
input consumed and output produced atomically within JMS session
```

### 25.4 DB Update + JMS Ack with Idempotency

```java
Session session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(commandQueue);

while (running) {
    Message message = consumer.receive(1_000);
    if (message == null) {
        continue;
    }

    try {
        String commandId = message.getStringProperty("commandId");

        database.inTransaction(tx -> {
            if (tx.commandAlreadyProcessed(commandId)) {
                return;
            }

            Command command = parse(message);
            tx.applyStateTransition(command);
            tx.insertAudit(command);
            tx.markCommandProcessed(commandId);
        });

        message.acknowledge();
    } catch (TransientDatabaseException e) {
        session.recover();
    } catch (InvalidCommandException e) {
        database.insertInvalidCommandRecord(message, e);
        message.acknowledge();
    }
}
```

Failure after DB commit before ack:

```text
redelivery occurs
commandAlreadyProcessed(commandId) true
ack safely
```

---

## 26. Spring Listener Container Note

Meskipun seri ini bukan mengulang Spring, banyak sistem Java memakai Spring JMS.

Dalam Spring, acknowledgement behavior bisa dipengaruhi oleh:

- listener container acknowledge mode,
- transaction manager,
- session transacted flag,
- error handler,
- caching connection factory,
- concurrency setting,
- rollback behavior.

Contoh hal yang harus dicek:

```text
Jika @JmsListener catch exception lalu tidak throw,
container bisa menganggap message berhasil.
```

```java
@JmsListener(destination = "case.command.approve")
public void onMessage(Message message) {
    try {
        service.handle(message);
    } catch (Exception e) {
        log.error("Failed", e);
        // bad if message should retry
    }
}
```

Lebih baik failure diekspresikan ke container atau diklasifikasikan secara eksplisit.

---

## 27. MDB / Jakarta EE Container Note

Dalam Jakarta EE Message-Driven Bean, acknowledgement sering dikelola container, terutama jika menggunakan container-managed transaction.

Mental model:

```text
MDB method returns normally
  => transaction/ack may commit

MDB method throws system exception / transaction rollback marked
  => message may redeliver
```

Hal yang harus dicek:

- transaction attribute,
- rollback exception behavior,
- activation config,
- max sessions/concurrency,
- redelivery/DLQ policy di broker/resource adapter,
- apakah business exception menyebabkan rollback atau tidak.

Jangan menganggap semua exception otomatis rollback. Periksa container behavior dan konfigurasi.

---

## 28. Observability untuk Ack

Sistem JMS production harus bisa menjawab:

1. Berapa message delivered?
2. Berapa message acknowledged?
3. Berapa message redelivered?
4. Berapa message rollback/recover?
5. Berapa message masuk DLQ?
6. Berapa message stuck in-flight?
7. Berapa lama dari delivered ke ack?
8. Error class apa yang menyebabkan no-ack?
9. Consumer mana yang sering fail?
10. Message type mana yang sering duplicate?

### 28.1 Metric yang Disarankan

```text
jms.consumer.received.count
jms.consumer.ack.count
jms.consumer.nack_or_recover.count
jms.consumer.rollback.count
jms.consumer.redelivery.count
jms.consumer.processing.duration
jms.consumer.ack.duration
jms.consumer.inflight.count
jms.consumer.dlq.publish.count
jms.consumer.permanent_failure.count
jms.consumer.transient_failure.count
```

### 28.2 Log Event Penting

Log minimal:

```json
{
  "event": "jms_message_received",
  "messageId": "ID:...",
  "correlationId": "...",
  "destination": "case.command.approve",
  "messageType": "ApproveApplicationCommand",
  "deliveryCount": 3,
  "redelivered": true
}
```

Saat ack:

```json
{
  "event": "jms_message_acknowledged",
  "messageId": "ID:...",
  "commandId": "cmd-123",
  "processingMs": 124,
  "ackMode": "CLIENT_ACKNOWLEDGE"
}
```

Saat recover/rollback:

```json
{
  "event": "jms_message_recover_requested",
  "messageId": "ID:...",
  "errorClass": "TransientDatabaseException",
  "deliveryCount": 2
}
```

### 28.3 Jangan Log Payload Sembarangan

Untuk regulated systems, payload bisa mengandung PII/business sensitive data. Log metadata, bukan full payload, kecuali ada sanitization dan policy.

---

## 29. Review Checklist

Gunakan checklist ini saat review JMS consumer.

### 29.1 Ack Mode

- [ ] Ack mode eksplisit, bukan default yang tidak diketahui.
- [ ] Tim memahami semantics ack mode tersebut.
- [ ] `CLIENT_ACKNOWLEDGE` tidak disalahpahami sebagai per-message isolated ack.
- [ ] `SESSION_TRANSACTED` tidak disalahpahami sebagai DB+JMS transaction.
- [ ] `DUPS_OK` hanya dipakai jika duplicate benar-benar acceptable.

### 29.2 Handler

- [ ] Handler tidak swallow exception yang seharusnya retry.
- [ ] Permanent vs transient error diklasifikasikan.
- [ ] Side effect critical idempotent.
- [ ] External call memakai idempotency key atau durable task.
- [ ] Ack dilakukan setelah durable progress.

### 29.3 Transaction

- [ ] DB transaction boundary jelas.
- [ ] JMS transaction boundary jelas.
- [ ] Outbox/inbox atau XA dipertimbangkan untuk multi-resource consistency.
- [ ] Failure after DB commit before ack sudah aman.
- [ ] Failure after external success before ack sudah aman.

### 29.4 Concurrency

- [ ] Session tidak dipakai concurrent secara unsafe.
- [ ] Prefetch dipahami.
- [ ] Ack boundary tidak mencakup message yang belum selesai diproses.
- [ ] Listener concurrency tidak memecahkan ordering yang dibutuhkan.

### 29.5 Operations

- [ ] Redelivery policy dikonfigurasi.
- [ ] DLQ/parking lot tersedia.
- [ ] Metrics ack/redelivery/DLQ tersedia.
- [ ] Runbook replay tersedia.
- [ ] Alert untuk redelivery spike dan DLQ growth tersedia.

---

## 30. Common Interview / Design Review Questions

### Q1: Apakah `CLIENT_ACKNOWLEDGE` mengakui satu message saja?

Tidak aman menganggap begitu. Dalam JMS, acknowledgement pada message yang dikonsumsi dapat mengakui semua message yang sudah consumed oleh session tersebut. Ini session-level semantics.

### Q2: Apakah `AUTO_ACKNOWLEDGE` berarti message diack sebelum handler?

Untuk listener, biasanya ack terjadi setelah `onMessage()` return sukses. Tetapi dari sisi desain, kamu tetap harus memahami bahwa jika handler swallow exception, provider/container dapat menganggap success.

### Q3: Apakah transacted session membuat DB update dan JMS ack atomic?

Tidak. `SESSION_TRANSACTED` adalah local JMS transaction untuk session tersebut. Untuk DB + JMS perlu XA/JTA atau pattern seperti outbox/inbox.

### Q4: Mode mana yang paling aman?

Tidak ada mode yang otomatis paling aman. Yang aman adalah kombinasi:

```text
correct ack timing
+ idempotent handler
+ transaction/outbox/inbox where needed
+ redelivery policy
+ DLQ
+ observability
```

### Q5: Kenapa duplicate tetap mungkin walaupun ack manual?

Karena crash bisa terjadi setelah side effect berhasil tetapi sebelum ack sampai ke broker. Broker tidak tahu side effect sudah berhasil, sehingga redelivery bisa terjadi.

### Q6: Bagaimana mencegah duplicate side effect?

Dengan idempotency key, unique constraint, state transition guard, inbox/dedup table, external idempotency key, atau outbox/task state.

---

## 31. Failure Scenario Exercises

### Exercise 1 — Lost Message

Flow:

```text
receive
ack
insert DB
```

Crash setelah ack sebelum insert DB.

Pertanyaan:

- Apa yang terjadi?
- Apakah broker redeliver?
- Bagaimana desain ulangnya?

Jawaban singkat:

- Message hilang dari business perspective.
- Broker tidak redeliver karena sudah ack.
- Ack harus dipindah setelah durable DB progress atau gunakan inbox.

### Exercise 2 — Duplicate External Call

Flow:

```text
receive
call external API success
crash before ack
```

Pertanyaan:

- Apa yang terjadi saat redelivery?
- Apa guard yang diperlukan?

Jawaban:

- External call bisa terulang.
- Butuh idempotency key, durable external task state, atau status reconciliation.

### Exercise 3 — Batch Ack Trap

Flow:

```text
Session receives M1, M2, M3
M1 processing slow
M2 processing success and acknowledge called
M3 not processed yet
```

Pertanyaan:

- Apa risiko?

Jawaban:

- Ack dapat mencakup message consumed lain dalam session.
- M1/M3 bisa dianggap selesai padahal belum benar-benar selesai tergantung delivery/processing model.
- Jangan concurrent manual processing dalam satu session dengan `CLIENT_ACKNOWLEDGE`.

### Exercise 4 — Swallowed Exception

Flow:

```java
try {
    handle(message);
} catch (Exception e) {
    log.error("failed", e);
}
```

Mode: `AUTO_ACKNOWLEDGE`.

Pertanyaan:

- Apa risiko?

Jawaban:

- Listener return normal.
- Provider/container dapat ack.
- Message gagal tapi tidak retry/DLQ.

### Exercise 5 — DB Commit Before Ack

Flow:

```text
receive
DB commit
crash before ack
redelivery
```

Pertanyaan:

- Apakah ini buruk?

Jawaban:

- Ini acceptable jika handler idempotent.
- Ini buruk jika DB update/external action tidak duplicate-safe.

---

## 32. Advanced Mental Model: Ack Is a Responsibility Transfer

Sebelum ack:

```text
Broker masih bertanggung jawab untuk redelivery jika consumer gagal.
```

Setelah ack:

```text
Aplikasi mengambil penuh tanggung jawab bahwa work sudah selesai atau bisa dipulihkan tanpa message dari broker.
```

Karena itu ack adalah momen transfer tanggung jawab.

```text
Before ACK:
  broker durability matters

After ACK:
  application durability matters
```

Jika aplikasi ack sebelum punya durable application state, berarti tanggung jawab berpindah terlalu cepat.

---

## 33. Ack dalam Regulated Case Management System

Untuk domain seperti enforcement lifecycle, case management, appeal, compliance, legal action, atau notification resmi, acknowledgement harus mengikuti domain invariant.

Contoh command:

```text
EscalateCaseCommand
```

Ack boleh dilakukan setelah minimal:

```text
- command idempotency recorded
- case transition persisted
- audit trail persisted
- outbox event persisted
```

Bukan setelah:

```text
- message berhasil di-parse
- case ditemukan
- validation awal lewat
- email sudah dicoba sekali
```

### 33.1 Recommended Flow

```text
JMS command received
  |
  v
Validate envelope
  |
  v
Begin DB transaction
  |
  +-- insert command_processing(commandId) if absent
  +-- check current case state
  +-- apply state transition with optimistic guard
  +-- insert audit trail
  +-- insert outbox event
  v
Commit DB transaction
  |
  v
Acknowledge JMS message
  |
  v
Outbox relay publishes downstream event/email task
```

Jika crash setelah DB commit sebelum ack:

```text
redelivery
command_processing already exists/completed
ack safely
```

Jika crash setelah ack:

```text
DB already contains durable work/outbox
relay can continue
```

Ini adalah bentuk reliability yang cocok untuk regulated systems.

---

## 34. Java 8 sampai Java 25 Considerations

Ack semantics JMS tidak berubah besar karena Java version. Yang berubah adalah cara kamu membangun aplikasi di sekitar semantics itu.

### 34.1 Java 8

- Banyak legacy JMS 1.1/2.0 client masih di Java 8.
- `javax.jms` masih umum.
- Hindari terlalu banyak object allocation dalam high-throughput listener.
- Executor/concurrency manual harus sangat hati-hati.

### 34.2 Java 11/17

- Baseline modern enterprise mulai pindah ke Java 11/17.
- Lebih mudah memakai modern TLS, container runtime, observability agent.
- Jakarta namespace mulai relevan untuk stack baru.

### 34.3 Java 21

- Virtual threads tersedia sebagai fitur final.
- Tetapi JMS `Session` tetap punya thread-safety/lifecycle rule sendiri.
- Virtual thread tidak membuat session aman dipakai concurrent.
- Cocok untuk blocking downstream work jika container/framework mendukung dan boundary jelas.

### 34.4 Java 25

- Gunakan sebagai runtime modern jika broker client/provider mendukung.
- Jangan anggap Java 25 mengubah JMS acknowledgement semantics.
- Fokus pada better observability, structured concurrency patterns di aplikasi sekitar, dan performance tuning JVM modern.

Rule:

```text
New Java runtime improves execution tools, not distributed messaging semantics.
```

---

## 35. Anti-Pattern Summary

| Anti-Pattern | Kenapa Bahaya | Perbaikan |
|---|---|---|
| Ack sebelum side effect durable | Message bisa hilang | Ack setelah durable progress |
| Swallow exception di listener | Broker menganggap success | Re-throw atau classify failure |
| CLIENT_ACK dianggap per-message | Bisa ack message lain | Pahami session-level ack; isolate session |
| Satu session untuk banyak worker manual | Race dan ack boundary kacau | Session per consumer thread/container concurrency |
| SESSION_TRANSACTED dianggap DB transaction | False atomicity | XA/outbox/inbox/idempotency |
| DUPS_OK untuk command critical | Duplicate bisa merusak state | Gunakan idempotency/transaction mode |
| External API tanpa idempotency | Duplicate external side effect | Idempotency key/durable task |
| Infinite recover tanpa DLQ | Poison loop | Redelivery policy + DLQ |
| No metrics redelivery | Incident sulit didiagnosis | Metrics/log correlation |
| Ack mode default tidak diketahui | Semantics invisible | Konfigurasi eksplisit |

---

## 36. Mini Reference: Mode Selection Table

| Workload | Recommended Starting Point | Required Guard |
|---|---|---|
| Cache invalidation | `AUTO_ACKNOWLEDGE` | Duplicate safe operation |
| Metrics/telemetry | `DUPS_OK_ACKNOWLEDGE` or auto | Approximate semantics accepted |
| Critical DB state update | `CLIENT_ACKNOWLEDGE` after DB commit or transacted container | Idempotency / command table |
| JMS consume + JMS produce | `SESSION_TRANSACTED` | Commit/rollback handling |
| DB + event publish | Outbox + ack after DB commit | Relay idempotency |
| External REST call | Durable task + idempotency key | Status reconciliation |
| Batch import | `CLIENT_ACKNOWLEDGE` batch or transacted batch | Partial failure strategy |
| Regulated case transition | DB transaction + command idempotency + audit + outbox, then ack | State transition guard |

---

## 37. Source Notes

Materi ini disusun berdasarkan JMS/Jakarta Messaging semantics umum dan dokumentasi resmi/teknis berikut:

- Jakarta Messaging 3.1 Specification and API documentation.
- Jakarta Messaging API `Session` and `JMSContext` documentation.
- Jakarta EE Tutorial section on Jakarta Messaging concepts and acknowledgement behavior.
- Java EE / Oracle historical JMS API documentation for legacy `javax.jms` semantics.
- IBM MQ JMS/Jakarta Messaging acknowledgement documentation for provider-oriented operational perspective.

Selalu validasi detail provider spesifik karena broker/client seperti ActiveMQ Artemis, ActiveMQ Classic, IBM MQ, WebLogic JMS, Open Liberty resource adapter, Solace, atau RabbitMQ JMS client dapat memiliki konfigurasi redelivery, DLQ, prefetch, transaction, dan failover behavior yang berbeda.

---

## 38. Ringkasan Part 9

Inti part ini:

```text
Acknowledgement is not “I received the message”.
Acknowledgement is “the broker may stop being responsible for this message”.
```

Mode utama:

```text
AUTO_ACKNOWLEDGE
  easy, but failure must propagate correctly

CLIENT_ACKNOWLEDGE
  manual, but session-level semantics matter

DUPS_OK_ACKNOWLEDGE
  performance-oriented, duplicate accepted

SESSION_TRANSACTED
  commit/rollback controls JMS consumption/production
```

Invariant produksi:

```text
Ack only after durable progress.
Assume redelivery can happen.
Make handler idempotent.
Do not swallow failure.
Do not confuse local JMS transaction with distributed transaction.
Observe ack, rollback, redelivery, and DLQ.
```

Jika kamu memahami part ini dengan benar, kamu sudah melewati level “bisa pakai JMS” dan mulai masuk ke level “bisa mendesain messaging system yang tidak rusak saat failure nyata terjadi”.

---

## 39. Status Seri

Selesai:

- Part 0 — Orientation: JMS sebagai Sistem Koordinasi Asinkron, Bukan Sekadar Queue API
- Part 1 — Evolution: JMS 1.1, JMS 2.0, Jakarta Messaging 3.x, dan Dampaknya ke Java 8–25
- Part 2 — Messaging Domain Model: Message, Destination, Producer, Consumer, Session, Connection, Context
- Part 3 — Queue Semantics: Point-to-Point, Competing Consumers, Work Distribution, dan Load Leveling
- Part 4 — Topic Semantics: Publish/Subscribe, Broadcast, Durable Subscription, Shared Subscription
- Part 5 — Message Anatomy: Header, Properties, Body, Metadata, Correlation, dan Semantic Contract
- Part 6 — Message Types: TextMessage, BytesMessage, MapMessage, ObjectMessage, StreamMessage, Generic Message
- Part 7 — Producer Engineering: Send Path, Delivery Mode, Priority, TTL, Delay, Async Send
- Part 8 — Consumer Engineering: Receive Path, Listener, Polling, Ack, Prefetch, dan Flow Control
- Part 9 — Acknowledgement Semantics: AUTO, CLIENT, DUPS_OK, SESSION_TRANSACTED, dan Jakarta Context Modes

Berikutnya:

- Part 10 — Transaction Model: Local JMS Transaction, JTA/XA, 2PC, Outbox, dan Trade-off Konsistensi

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-008.md">⬅️ Part 8 — Consumer Engineering: Receive Path, Listener, Polling, Ack, Prefetch, dan Flow Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-010.md">Part 10 — Transaction Model: Local JMS Transaction, JTA/XA, 2PC, Outbox, dan Trade-off Konsistensi ➡️</a>
</div>
