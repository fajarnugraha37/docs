# learn-java-eclipse-glassfish-runtime-server-engineering-part-014
# Part 14 — JMS dan OpenMQ di GlassFish: Broker, Destination, MDB, Reliability

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: `014 / 034`  
> Fokus: GlassFish sebagai runtime messaging enterprise, OpenMQ sebagai provider Jakarta Messaging, integrasi JMS resource, MDB, reliability, transaksi, redelivery, poison message, monitoring, tuning, dan failure modelling.  
> Target Java: Java 8 sampai Java 25  
> Target GlassFish: GlassFish 5.x sampai 8.x  
> Status seri: **belum selesai**

---

## 0. Premis Utama

Bagian ini tidak akan mengulang ulang API Jakarta Messaging/JMS secara dasar seperti `ConnectionFactory`, `Queue`, `Topic`, `MessageProducer`, `MessageConsumer`, atau `JMSContext`, karena itu sudah termasuk wilayah Jakarta EE dan enterprise integration yang sebelumnya sudah dibahas.

Yang kita dalami di sini adalah:

1. bagaimana GlassFish menyediakan messaging runtime,
2. bagaimana OpenMQ terhubung sebagai provider bawaan,
3. bagaimana resource JMS dipetakan ke connector resource internal GlassFish,
4. bagaimana Message-Driven Bean dijalankan oleh container,
5. bagaimana transaksi, redelivery, acknowledgement, dan poison message bekerja secara operasional,
6. bagaimana mendesain messaging yang reliable, diagnosable, dan production-ready.

Mental model penting:

> JMS bukan hanya API untuk kirim pesan. Di application server, JMS adalah kombinasi antara **broker**, **resource adapter**, **connection pool**, **destination**, **transaction manager**, **container-managed consumer**, dan **operational queueing system**.

Kalau engineer hanya melihat JMS sebagai `send()` dan `onMessage()`, maka saat terjadi duplicate processing, stuck queue, lost consumer, poison message, atau transaction rollback loop, dia akan bingung.

Top-level engineer melihat JMS sebagai sistem antrian dengan boundary, state, delivery semantics, dan failure modes.

---

## 1. Posisi OpenMQ dalam GlassFish

Eclipse OpenMQ adalah provider Jakarta Messaging yang menjadi default messaging provider di Eclipse GlassFish. Dalam deployment GlassFish, OpenMQ menyediakan broker/message service, sedangkan aplikasi berinteraksi lewat Jakarta Messaging API dan resource yang dikelola oleh GlassFish.

Secara konseptual:

```text
Application Code
   |
   | uses Jakarta Messaging API
   v
GlassFish JMS Resource
   |
   | backed by connector resource/pool/admin object
   v
GlassFish Connector Container / Resource Adapter
   |
   v
OpenMQ Broker
   |
   v
Physical Destination / Persistent Store
```

Artinya, ketika aplikasi melakukan:

```java
@Inject
private JMSContext context;

@Resource(lookup = "jms/MyQueue")
private Queue queue;
```

aplikasi tidak langsung "memiliki" queue. Ia memakai resource yang sudah didefinisikan di GlassFish dan dipetakan ke provider messaging.

---

## 2. Java 8 sampai Java 25: Istilah dan Namespace

Perjalanan versi penting:

| Era | Platform | Namespace | Messaging API |
|---|---|---|---|
| Java 8 + Java EE 7/8 | Java EE | `javax.jms.*` | JMS 2.0 |
| Jakarta EE 8 | Jakarta EE transisi | `javax.jms.*` | Jakarta Messaging 2.x naming/transitional |
| Jakarta EE 9+ | Jakarta EE modern | `jakarta.jms.*` | Jakarta Messaging 3.x |
| Jakarta EE 10/11 | Modern Jakarta | `jakarta.jms.*` | Jakarta Messaging modern |

Implikasi praktis:

- Aplikasi GlassFish 5.x cenderung memakai `javax.jms.*`.
- Aplikasi GlassFish 6/7/8 memakai `jakarta.jms.*`.
- Artifact lama yang masih membawa `javax.jms-api.jar` ke dalam WAR/EAR akan bentrok jika dijalankan di runtime Jakarta modern.
- Kode MDB lama dengan annotation `javax.ejb.MessageDriven` harus dimigrasikan ke namespace Jakarta saat pindah ke GlassFish modern.
- Resource naming di GlassFish bisa terlihat mirip, tetapi class dan API package sudah berubah.

Prinsip migrasi:

> Jangan migrasi messaging dengan asumsi "hanya rename import". Messaging melibatkan API, deployment descriptor, MDB activation config, JNDI resource, broker config, transaksi, dan behavior redelivery.

---

## 3. Komponen Utama Messaging di GlassFish

Untuk memahami JMS di GlassFish, pecah menjadi beberapa komponen.

### 3.1 Message Broker

Broker adalah komponen yang menyimpan, merutekan, dan mengirim pesan.

Tanggung jawab broker:

- menerima pesan dari producer,
- menyimpan pesan persistent jika diminta,
- mengirim pesan ke consumer,
- menjaga destination,
- mengelola acknowledgement,
- mengelola redelivery,
- menyediakan metrics,
- mengelola koneksi client,
- mengelola durable subscription,
- menyediakan administrative surface.

### 3.2 JMS Service

JMS service adalah konfigurasi GlassFish yang mengatur hubungan server dengan provider messaging.

Dalam GlassFish, JMS service dapat dikonfigurasi untuk mode seperti:

- embedded/local broker,
- broker yang dikelola GlassFish,
- remote broker,
- cluster/multi-broker topology tergantung dukungan dan konfigurasi.

Mental model:

```text
GlassFish instance
   |
   +-- JMS Service config
          |
          +-- broker lifecycle / address list / provider settings
          +-- connection factory behavior
          +-- destination resource behavior
```

### 3.3 Connection Factory

Connection factory adalah resource yang dipakai aplikasi untuk membuka koneksi JMS ke provider.

Contoh logical resource:

```text
jms/MyConnectionFactory
```

Di baliknya bisa ada:

```text
connector connection pool
connector resource
provider-specific connection configuration
```

### 3.4 Destination Resource

Destination resource adalah object JNDI yang merepresentasikan queue atau topic.

Contoh:

```text
jms/CaseEventQueue
jms/NotificationTopic
```

Destination resource biasanya menunjuk ke physical destination di broker.

### 3.5 Physical Destination

Physical destination adalah queue/topic sungguhan di broker.

Contoh:

```text
CaseEventQueue
EmailOutboxQueue
AuditEventTopic
```

Perbedaan penting:

```text
JNDI destination resource = nama resource yang dilihat aplikasi
Physical destination = object nyata di broker
```

Keduanya bisa punya nama sama, tetapi tidak harus.

### 3.6 Message-Driven Bean

MDB adalah consumer yang lifecycle dan concurrency-nya dikelola container.

MDB berbeda dari consumer manual karena:

- container yang membuka connection,
- container yang subscribe ke destination,
- container yang memanggil `onMessage`,
- container yang mengelola transaksi,
- container yang mengelola instance/pool,
- container yang menangani redelivery sesuai konfigurasi.

---

## 4. Model Resource di GlassFish: JMS Resource Bukan Sekadar JMS Resource

Salah satu detail penting: di GlassFish, JMS resource sering dipetakan ke connector resource internal.

Ketika membuat JMS connection factory, GlassFish dapat membuat:

- connector connection pool,
- connector resource.

Ketika membuat JMS destination resource, GlassFish dapat membuat:

- connector admin object resource.

Ini penting karena troubleshooting JMS kadang perlu melihat bukan hanya `list-jms-resources`, tetapi juga connector resource dan admin object.

Mental model:

```text
create-jms-resource --resType jakarta.jms.Queue jms/CaseEventQueue
        |
        v
JNDI resource exposed to app
        |
        v
connector-admin-object-resource
        |
        v
OpenMQ destination metadata
```

Connection factory:

```text
create-jms-resource --resType jakarta.jms.ConnectionFactory jms/CaseCF
        |
        v
JNDI connection factory
        |
        v
connector-connection-pool
        |
        v
connector-resource
        |
        v
OpenMQ resource adapter/provider
```

Implikasi:

- Delete JMS resource dapat berdampak pada connector resource terkait.
- Config drift dapat terjadi jika sebagian resource dibuat manual.
- Troubleshooting perlu tahu lapisan mana yang rusak:
  - JNDI lookup?
  - connector pool?
  - broker unreachable?
  - physical destination missing?
  - authentication?
  - transaction enlistment?

---

## 5. Queue vs Topic dari Perspektif Runtime

### 5.1 Queue

Queue adalah model point-to-point.

Karakteristik:

- satu pesan idealnya dikonsumsi satu consumer,
- cocok untuk workload task/job,
- cocok untuk async processing,
- dapat diproses paralel oleh banyak consumer,
- ordering bisa terpengaruh oleh concurrency,
- redelivery biasanya kembali ke queue yang sama atau dead message destination.

Contoh use case:

- email sending,
- document generation,
- case workflow event processing,
- audit enrichment,
- integration retry,
- notification delivery.

### 5.2 Topic

Topic adalah model publish/subscribe.

Karakteristik:

- satu pesan bisa diterima banyak subscriber,
- cocok untuk event broadcasting,
- subscriber non-durable hanya menerima saat aktif,
- durable subscriber bisa menerima pesan saat offline,
- consumer identity/subscription penting.

Contoh use case:

- domain event broadcast,
- cache invalidation,
- downstream notification,
- activity feed.

### 5.3 Kesalahan Umum Memilih Queue/Topic

Kesalahan:

```text
"Kita pakai topic supaya banyak service bisa consume."
```

Pertanyaan yang benar:

1. Apakah setiap consumer harus menerima semua event?
2. Apakah consumer boleh offline dan tetap catch up?
3. Apakah pesan harus diproses satu kali oleh satu worker saja?
4. Apakah ordering penting?
5. Apakah subscriber bersifat dinamis?
6. Apakah failure satu subscriber boleh menahan subscriber lain?

Decision rule:

| Kebutuhan | Pilihan |
|---|---|
| Work item hanya boleh diproses satu worker | Queue |
| Event harus diterima banyak listener berbeda | Topic |
| Consumer bisa scale horizontally untuk throughput | Queue dengan banyak consumer |
| Broadcast event ke modul berbeda | Topic |
| Setiap service butuh retry/dead-letter sendiri | Bisa topic + per-service queue bridge/pattern |
| Ordering per aggregate penting | Queue + partitioning/concurrency control |

---

## 6. Embedded Broker vs Remote Broker

### 6.1 Embedded / Local Broker

Dalam setup sederhana, broker bisa berjalan dekat dengan GlassFish.

Kelebihan:

- mudah untuk development,
- konfigurasi sederhana,
- cocok untuk local testing,
- cepat untuk proof-of-concept.

Kekurangan:

- lifecycle terlalu dekat dengan app server,
- scaling terbatas,
- failure isolation lemah,
- production observability sering kurang matang,
- restart GlassFish bisa berdampak ke broker lifecycle.

### 6.2 Remote Broker

Broker berjalan sebagai service terpisah.

Kelebihan:

- failure isolation lebih baik,
- dapat diskalakan/dioperasikan terpisah,
- bisa dipakai beberapa app server,
- lebih mudah dipantau sebagai messaging infrastructure,
- lebih cocok untuk production topology.

Kekurangan:

- network failure menjadi faktor,
- perlu credential/security lebih serius,
- perlu monitoring broker dedicated,
- perlu operational runbook terpisah.

### 6.3 Decision Rule

Gunakan embedded/local untuk:

- local dev,
- lightweight testing,
- demo,
- environment sementara.

Gunakan remote/dedicated untuk:

- production,
- multi-instance application server,
- high throughput,
- regulatory audit trail,
- independent operation,
- failure isolation.

---

## 7. Membuat JMS Resource dengan `asadmin`

> Nama command dan opsi dapat berbeda sedikit antar versi GlassFish/OpenMQ, jadi selalu cek `asadmin help <command>` pada runtime target. Pola konseptualnya tetap sama.

### 7.1 Membuat Connection Factory

Contoh pola:

```bash
asadmin create-jms-resource \
  --restype jakarta.jms.ConnectionFactory \
  --enabled=true \
  jms/CaseConnectionFactory
```

Untuk GlassFish lama/Java EE:

```bash
asadmin create-jms-resource \
  --restype javax.jms.ConnectionFactory \
  --enabled=true \
  jms/CaseConnectionFactory
```

Catatan:

- Pada GlassFish Jakarta modern, gunakan tipe `jakarta.jms.*`.
- Pada GlassFish 5/Java EE, gunakan `javax.jms.*`.
- Jangan mencampur `javax` resource type dengan aplikasi `jakarta` modern.

### 7.2 Membuat Queue Resource

```bash
asadmin create-jms-resource \
  --restype jakarta.jms.Queue \
  --property Name=CaseEventQueue \
  jms/CaseEventQueue
```

### 7.3 Membuat Topic Resource

```bash
asadmin create-jms-resource \
  --restype jakarta.jms.Topic \
  --property Name=NotificationTopic \
  jms/NotificationTopic
```

### 7.4 Melihat JMS Resource

```bash
asadmin list-jms-resources
```

Atau cek JNDI:

```bash
asadmin list-jndi-entries
```

### 7.5 Menghapus Resource

```bash
asadmin delete-jms-resource jms/CaseEventQueue
```

Cek resource terkait:

```bash
asadmin list-connector-resources
asadmin list-connector-connection-pools
asadmin list-connector-admin-objects
```

### 7.6 Prinsip Idempotent Script

Script buruk:

```bash
asadmin create-jms-resource --restype jakarta.jms.Queue jms/CaseEventQueue
```

Jika resource sudah ada, gagal.

Script lebih baik:

```bash
asadmin list-jms-resources | grep -q '^jms/CaseEventQueue$' || \
asadmin create-jms-resource \
  --restype jakarta.jms.Queue \
  --property Name=CaseEventQueue \
  jms/CaseEventQueue
```

Tetapi untuk production, lebih baik buat wrapper yang:

1. cek existence,
2. cek expected config,
3. fail jika config berbeda,
4. tidak diam-diam overwrite resource penting.

---

## 8. Physical Destination Management

JMS destination resource di GlassFish belum tentu cukup jika physical destination belum ada atau broker tidak auto-create sesuai policy.

Physical destination harus dipahami sebagai object broker.

Command OpenMQ umum memakai `imqcmd`.

Contoh konseptual:

```bash
imqcmd list dst -u admin
imqcmd create dst -t q -n CaseEventQueue -u admin
imqcmd create dst -t t -n NotificationTopic -u admin
```

Queue:

```bash
imqcmd create dst -t q -n EmailOutboxQueue -u admin
```

Topic:

```bash
imqcmd create dst -t t -n CaseBroadcastTopic -u admin
```

Inspect metrics:

```bash
imqcmd metrics dst -t q -n CaseEventQueue -m ttl -u admin
imqcmd metrics dst -t q -n CaseEventQueue -m con -u admin
```

Apa yang perlu dipantau:

- jumlah message pending,
- number of producers,
- number of consumers,
- enqueue rate,
- dequeue rate,
- average message age,
- redelivery count,
- dead message count,
- broker disk usage,
- connection count.

---

## 9. Message-Driven Bean Runtime

MDB adalah salah satu cara paling kuat dan paling berisiko memakai JMS di application server.

Contoh modern Jakarta:

```java
import jakarta.ejb.ActivationConfigProperty;
import jakarta.ejb.MessageDriven;
import jakarta.jms.Message;
import jakarta.jms.MessageListener;

@MessageDriven(
    activationConfig = {
        @ActivationConfigProperty(
            propertyName = "destinationLookup",
            propertyValue = "jms/CaseEventQueue"
        ),
        @ActivationConfigProperty(
            propertyName = "destinationType",
            propertyValue = "jakarta.jms.Queue"
        )
    }
)
public class CaseEventConsumer implements MessageListener {

    @Override
    public void onMessage(Message message) {
        // process message
    }
}
```

Legacy Java EE:

```java
import javax.ejb.ActivationConfigProperty;
import javax.ejb.MessageDriven;
import javax.jms.Message;
import javax.jms.MessageListener;

@MessageDriven(
    activationConfig = {
        @ActivationConfigProperty(
            propertyName = "destinationLookup",
            propertyValue = "jms/CaseEventQueue"
        ),
        @ActivationConfigProperty(
            propertyName = "destinationType",
            propertyValue = "javax.jms.Queue"
        )
    }
)
public class CaseEventConsumer implements MessageListener {

    @Override
    public void onMessage(Message message) {
        // process message
    }
}
```

### 9.1 Apa yang Container Lakukan

Saat MDB deploy:

1. container membaca annotation/descriptor,
2. container resolve destination,
3. container menyiapkan endpoint,
4. resource adapter subscribe ke destination,
5. container membuat pool MDB,
6. broker mengirim message ke endpoint,
7. container memanggil `onMessage`,
8. transaksi dibuat/diikuti sesuai configuration,
9. commit/rollback menentukan acknowledgement.

### 9.2 MDB Pool

MDB biasanya dipool.

Artinya:

```text
1 queue
   |
   +-- MDB instance #1
   +-- MDB instance #2
   +-- MDB instance #3
   +-- MDB instance #N
```

Konsekuensi:

- throughput naik,
- ordering bisa berubah,
- DB pressure naik,
- downstream service pressure naik,
- duplicate side effect risk naik jika handler tidak idempotent.

### 9.3 MDB Bukan Worker Bebas

MDB tetap berada dalam container rules:

- jangan membuat unmanaged thread sembarangan,
- jangan menyimpan mutable static state untuk koordinasi,
- jangan mengabaikan transaction boundary,
- jangan melakukan blocking remote call tanpa timeout,
- jangan swallow exception yang seharusnya menyebabkan rollback,
- jangan melakukan infinite retry dalam `onMessage`.

---

## 10. Manual Consumer vs MDB

### 10.1 Manual Consumer

Contoh:

```java
@Resource(lookup = "jms/CaseConnectionFactory")
private ConnectionFactory connectionFactory;

@Resource(lookup = "jms/CaseEventQueue")
private Queue queue;

public void consume() {
    try (JMSContext context = connectionFactory.createContext()) {
        JMSConsumer consumer = context.createConsumer(queue);
        Message message = consumer.receive(1000);
        // process
    }
}
```

Kelebihan:

- kontrol explicit,
- cocok untuk scheduled polling,
- mudah untuk custom lifecycle.

Kekurangan:

- lifecycle harus dikelola sendiri,
- concurrency harus dikelola sendiri,
- error handling harus benar,
- mudah melanggar container rule kalau salah.

### 10.2 MDB

Kelebihan:

- container-managed lifecycle,
- transaksi container-managed,
- resource adapter integration,
- lebih idiomatik untuk inbound JMS.

Kekurangan:

- behavior dipengaruhi konfigurasi container,
- concurrency kadang kurang terlihat,
- redelivery loop bisa terjadi diam-diam,
- debugging butuh paham container.

Decision rule:

| Kebutuhan | Pilihan |
|---|---|
| Async event listener enterprise | MDB |
| Polling ringan dengan kontrol manual | Manual consumer |
| Butuh container-managed transaction | MDB |
| Butuh custom backoff sangat spesifik | Manual consumer atau external worker |
| Inbound integration klasik Jakarta EE | MDB |
| Cloud-native independent worker | Dedicated service/consumer di luar GlassFish |

---

## 11. Delivery Semantics: At-Most-Once, At-Least-Once, Exactly-Once

Messaging engineer harus jujur tentang delivery semantics.

### 11.1 At-Most-Once

Pesan mungkin hilang, tetapi tidak diduplikasi.

Contoh:

```text
producer send non-persistent
consumer ack sebelum side effect durable
failure terjadi
```

Biasanya tidak cocok untuk business-critical event.

### 11.2 At-Least-Once

Pesan tidak hilang selama broker/persistence benar, tetapi bisa dikirim ulang.

Ini adalah model paling realistis untuk enterprise messaging.

Konsekuensi:

```text
Consumer harus idempotent.
```

### 11.3 Exactly-Once

Sering dijual sebagai ilusi.

Dalam boundary broker tunggal, transaction manager tertentu, dan resource tertentu, efek bisa dibuat terlihat exactly-once. Tetapi dalam distributed system, terutama melibatkan DB + external API + email + file + HTTP service, exactly-once end-to-end hampir selalu berubah menjadi:

```text
at-least-once delivery + idempotent processing + deduplication
```

Golden rule:

> Design consumer seolah-olah pesan bisa diterima lebih dari sekali.

---

## 12. Persistence dan Reliability

### 12.1 Persistent Message

Persistent message menginstruksikan provider untuk menyimpan pesan secara durable.

Kelebihan:

- survive broker restart,
- lebih reliable.

Kekurangan:

- lebih lambat,
- butuh disk,
- broker store bisa penuh,
- perlu monitoring.

### 12.2 Non-Persistent Message

Non-persistent message lebih cepat, tetapi bisa hilang jika failure.

Cocok untuk:

- cache invalidation yang boleh miss,
- telemetry non-critical,
- transient notification.

Tidak cocok untuk:

- payment,
- compliance event,
- audit event,
- case state transition,
- legal correspondence trigger.

### 12.3 Producer Transaction

Jika producer mengirim message dalam transaksi:

```text
DB update + JMS send
```

Jika memakai JTA/XA, commit keduanya dikoordinasikan.

Jika tidak memakai XA, ada risiko:

```text
DB commit sukses, JMS send gagal
atau
JMS send sukses, DB commit gagal
```

Alternatif umum:

- transactional outbox,
- CDC/Debezium,
- retryable publish table,
- saga.

---

## 13. Acknowledgement dan Transaction Coupling

JMS acknowledgement menentukan kapan broker menganggap pesan selesai.

Dalam MDB container-managed transaction:

```text
onMessage success + transaction commit
        -> message acknowledged

onMessage exception + transaction rollback
        -> message redelivered
```

Dalam manual consumer non-transacted:

- `AUTO_ACKNOWLEDGE`: provider auto ack setelah receive/handler berhasil menurut mekanisme API.
- `CLIENT_ACKNOWLEDGE`: aplikasi memanggil acknowledge.
- `DUPS_OK_ACKNOWLEDGE`: provider boleh lazy acknowledge, duplicate lebih mungkin.
- Transacted session: commit/rollback session menentukan ack.

Dalam container, jangan berpikir acknowledgement berdiri sendiri. Ia sering terkait dengan transaction lifecycle.

---

## 14. Redelivery

Redelivery terjadi ketika pesan sudah dikirim ke consumer tetapi belum dianggap berhasil.

Penyebab:

- `onMessage` throw exception,
- transaction rollback,
- consumer crash,
- app server restart,
- broker disconnect,
- timeout,
- ack gagal,
- poison message.

### 14.1 Redelivery Count

Banyak provider menyertakan metadata delivery count/redelivered flag.

Contoh konseptual:

```java
boolean redelivered = message.getJMSRedelivered();
```

Pada provider tertentu, ada property delivery count.

Gunakan untuk:

- logging,
- routing ke manual recovery,
- alerting,
- custom backoff,
- poison detection.

### 14.2 Redelivery Loop

Bahaya:

```text
message invalid
   -> MDB process
   -> exception
   -> rollback
   -> redelivery
   -> exception
   -> rollback
   -> repeat forever
```

Dampak:

- CPU habis,
- log penuh,
- DB ditekan terus,
- queue tidak maju,
- consumer stuck di satu pesan,
- downstream service dibombardir.

### 14.3 Prinsip Redelivery Aman

1. Batasi jumlah retry.
2. Bedakan transient vs permanent failure.
3. Pindahkan poison message ke dead message destination.
4. Log dengan correlation id.
5. Jangan retry cepat tanpa backoff.
6. Consumer harus idempotent.
7. Side effect harus terlindungi dari duplicate.

---

## 15. Poison Message

Poison message adalah pesan yang selalu gagal diproses.

Contoh:

- JSON schema invalid,
- mandatory field hilang,
- referenced entity tidak pernah ada,
- state transition tidak valid,
- payload versi lama tidak kompatibel,
- consumer bug,
- data corrupt,
- downstream permanent rejection.

### 15.1 Handling yang Buruk

```java
@Override
public void onMessage(Message message) {
    try {
        process(message);
    } catch (Exception e) {
        log.error("Failed", e);
        throw e;
    }
}
```

Jika failure permanent, ini bisa menciptakan infinite redelivery.

### 15.2 Handling yang Lebih Baik

Pseudo-flow:

```text
receive message
   |
   +-- validate envelope
   |
   +-- if invalid permanent:
   |       record failure
   |       move/mark poison
   |       commit consumption if safe
   |
   +-- if transient:
   |       throw exception / rollback
   |
   +-- if business conflict:
   |       idempotency check
   |       decide skip/retry/manual review
   |
   +-- success:
           commit
```

### 15.3 Poison Message Store

Untuk sistem serius, jangan hanya mengandalkan broker dead letter. Simpan record operasional:

```text
message_id
correlation_id
destination
payload_hash
payload_snapshot_or_pointer
failure_type
exception_class
error_message
first_seen_at
last_seen_at
delivery_count
status
manual_action
```

Ini penting untuk regulatory systems karena failure asynchronous harus bisa diaudit.

---

## 16. Dead Message Queue / Dead Letter Strategy

Dead message destination adalah tempat pesan gagal permanen dipindahkan.

Tujuan:

- mencegah queue utama stuck,
- menjaga throughput,
- menyediakan manual recovery,
- mengisolasi bad data,
- membuat alert lebih jelas.

Pattern:

```text
Main Queue
   |
   +-- Consumer success -> done
   |
   +-- transient fail -> retry
   |
   +-- too many fail / permanent -> Dead Message Queue
```

Design decision:

| Pertanyaan | Rekomendasi |
|---|---|
| Satu global DMQ atau per domain queue? | Per domain lebih diagnosable |
| Simpan payload penuh? | Ya jika aman; kalau PII, simpan pointer/hash |
| Ada replay tool? | Ya untuk production-grade |
| Ada owner? | Harus ada owner per queue |
| Alert kapan? | Saat DMQ > 0 untuk critical flow |

---

## 17. Idempotency: Syarat Utama Consumer

Consumer JMS production harus idempotent.

Tanpa idempotency:

```text
message redelivered
   -> email terkirim dua kali
   -> status case berubah dua kali
   -> audit duplicate
   -> payment duplicate
   -> document generated multiple times
```

### 17.1 Idempotency Key

Gunakan key stabil:

```text
event_id
command_id
case_id + transition_id
source_system + source_event_id
message_id dari producer business layer
```

Jangan bergantung penuh pada provider `JMSMessageID` jika message bisa direpublish/reconstructed.

### 17.2 Idempotency Table

Contoh schema konseptual:

```sql
CREATE TABLE processed_message (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    consumer_name VARCHAR(128) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    result_status VARCHAR(32) NOT NULL,
    payload_hash VARCHAR(128),
    correlation_id VARCHAR(128)
);
```

Flow:

```text
begin transaction
   |
   +-- insert idempotency key
   |      |
   |      +-- success -> process
   |      +-- duplicate -> skip safely
   |
   +-- business update
   |
   +-- commit
```

### 17.3 Duplicate Handling

Jika duplicate diterima:

- jangan throw exception,
- jangan rollback,
- acknowledge/commit consumption,
- log sebagai duplicate benign,
- expose metric.

---

## 18. Transaction Patterns JMS + DB

### 18.1 MDB dengan Container-Managed Transaction

Flow:

```text
Broker sends message
   |
MDB onMessage starts/joins transaction
   |
DB update
   |
onMessage returns
   |
Transaction commit
   |
Message ack committed
```

Jika DB gagal:

```text
DB exception
   |
transaction rollback
   |
message redelivered
```

Ini berguna, tetapi bisa menghasilkan duplicate attempt.

### 18.2 JMS Send + DB Update dalam Satu Transaction

Contoh:

```text
Update case status
Publish CaseStatusChanged event
```

Option A — XA/JTA:

```text
single distributed transaction: DB + JMS
```

Kelebihan:

- atomic across resources.

Kekurangan:

- kompleks,
- 2PC overhead,
- recovery complexity,
- XA driver/provider behavior harus valid,
- operational diagnosis sulit.

Option B — Outbox:

```text
DB transaction writes case + outbox row
separate publisher sends JMS message
```

Kelebihan:

- lebih mudah diaudit,
- DB sebagai source of truth,
- recovery lebih jelas,
- cocok untuk regulatory/business state.

Kekurangan:

- eventual consistency,
- perlu publisher/retry process.

Rule:

> Untuk critical business state, outbox sering lebih operasional dan defensible daripada XA, kecuali ada alasan kuat memakai distributed transaction.

---

## 19. Ordering

Ordering adalah salah satu asumsi paling sering salah.

### 19.1 Queue Ordering

Queue sering memberi FIFO-ish behavior, tetapi:

- banyak consumer bisa memproses paralel,
- redelivery bisa mengubah urutan observasi,
- rollback bisa membuat pesan lama muncul lagi,
- broker failover bisa mempengaruhi urutan,
- multi-producer tidak selalu sesuai business order.

### 19.2 Ordering Per Aggregate

Jika ordering penting per `caseId`, jangan mengandalkan satu global queue dengan high concurrency.

Pattern:

```text
Partition by aggregate id
   |
   +-- Queue shard 0
   +-- Queue shard 1
   +-- Queue shard 2
   +-- Queue shard N
```

Atau:

```text
Consumer receives in parallel
   |
   +-- per-case lock / sequencing guard
```

Namun per-case lock di app bisa menciptakan bottleneck.

### 19.3 Design Rule

Tanyakan:

1. Apakah urutan global benar-benar dibutuhkan?
2. Atau hanya urutan per aggregate?
3. Apa konsekuensi out-of-order?
4. Bisa tidak consumer menolak event yang belum waktunya?
5. Ada version number/state transition guard?

Untuk regulatory/case management:

```text
case_state_version
expected_previous_state
event_sequence
```

lebih defensible daripada mengandalkan queue ordering.

---

## 20. Backpressure

Queue adalah buffer, bukan tempat menyembunyikan bottleneck selamanya.

Jika producer lebih cepat daripada consumer:

```text
queue depth naik
message age naik
broker disk naik
SLA turun
```

Backpressure signal:

- pending message count,
- oldest message age,
- producer rate > consumer rate,
- consumer error rate,
- DB pool saturation,
- downstream timeout,
- redelivery count naik.

Backpressure response:

| Gejala | Respons |
|---|---|
| Queue depth naik, consumer sehat | tambah consumer/concurrency |
| Queue depth naik, DB pool saturated | jangan tambah consumer; tune DB/pool/query |
| Redelivery naik | cari poison/transient failure |
| Broker disk naik | cek stuck consumer atau persistence load |
| Downstream timeout | apply circuit breaker/backoff |
| Consumer CPU tinggi | profile handler |

Golden rule:

> Jangan scale consumer jika bottleneck ada di database atau downstream service. Itu hanya mempercepat kegagalan.

---

## 21. Consumer Concurrency Budget

Misalnya:

```text
MDB concurrency = 20
Setiap message melakukan 2 query DB
Setiap message rata-rata 300 ms DB time
```

Maka DB concurrent demand bisa mendekati:

```text
20 concurrent MDB * 1 DB connection per message = 20 DB connections
```

Jika ada 4 instance:

```text
4 * 20 = 80 concurrent consumers
```

Jika tiap consumer melakukan remote API call 2 detik, thread akan tertahan.

Formula sederhana:

```text
effective_concurrency = instances * consumers_per_instance
db_connection_demand ~= effective_concurrency * db_connections_per_message
downstream_concurrency ~= effective_concurrency * downstream_calls_per_message
```

Jangan set MDB pool/concurrency tanpa menghitung:

- DB pool max,
- DB max sessions,
- downstream rate limit,
- average processing time,
- retry behavior,
- redelivery storm risk.

---

## 22. Message Schema dan Envelope

Pesan production tidak boleh hanya payload bebas.

Gunakan envelope:

```json
{
  "eventId": "01J...",
  "eventType": "CaseSubmitted",
  "eventVersion": 3,
  "occurredAt": "2026-06-21T10:15:30Z",
  "producer": "case-service",
  "correlationId": "req-abc",
  "causationId": "cmd-xyz",
  "aggregateType": "Case",
  "aggregateId": "CASE-123",
  "aggregateVersion": 42,
  "payload": {
    "caseId": "CASE-123",
    "submittedBy": "user-001"
  }
}
```

Kenapa penting:

- idempotency,
- tracing,
- ordering,
- versioning,
- replay,
- debugging,
- audit,
- consumer compatibility.

### 22.1 Versioning

Jangan memaksa semua consumer update bersamaan.

Rule:

- additive changes aman,
- remove/rename field berbahaya,
- semantic change harus increment version,
- consumer harus tolerate unknown field,
- producer harus punya compatibility contract.

### 22.2 Payload Size

Jangan kirim file besar di JMS.

Pattern:

```text
store file/object externally
send pointer/reference in message
```

Contoh:

```json
{
  "documentId": "DOC-123",
  "storageKey": "s3://bucket/key",
  "checksum": "sha256:..."
}
```

---

## 23. Request/Reply dengan JMS

JMS bisa dipakai untuk request/reply, tetapi perlu hati-hati.

Pattern:

```text
Requester sends message to request queue
   |
   +-- JMSReplyTo = temp/reply queue
   +-- JMSCorrelationID = request id
   |
Responder sends response
```

Risiko:

- timeout handling,
- orphan reply,
- temporary destination lifecycle,
- correlation mismatch,
- memory/resource leak,
- request/reply over queue menjadi RPC terselubung.

Rule:

> Jika butuh synchronous user-facing response, HTTP/gRPC mungkin lebih jelas. JMS request/reply cocok untuk async internal workflow atau legacy integration dengan timeout yang jelas.

---

## 24. Durable Subscription

Topic subscriber bisa durable.

Durable subscription berarti:

```text
subscriber offline
broker tetap menyimpan pesan untuk subscriber
subscriber reconnect
pesan dikirim
```

Butuh identity stabil:

- client id,
- subscription name,
- topic name.

Risiko:

- subscriber tidak pernah consume,
- backlog per subscriber naik,
- broker storage penuh,
- subscription orphan,
- duplicate subscription karena client id berubah.

Operational checklist:

- inventory durable subscriptions,
- monitor backlog per subscription,
- define owner,
- cleanup obsolete subscription,
- alert on old messages.

---

## 25. Security

Messaging security sering diremehkan karena "hanya internal".

Perlu diperhatikan:

- broker admin credential,
- app connection credential,
- TLS broker connection jika network tidak trusted,
- access control destination,
- siapa boleh produce,
- siapa boleh consume,
- credential rotation,
- audit admin action,
- secret placement.

Anti-pattern:

```text
admin/adminadmin credential dipakai aplikasi
```

Prinsip:

- broker admin user hanya untuk admin,
- app producer punya user terbatas,
- app consumer punya user terbatas,
- prod credential tidak ada di artifact,
- gunakan secret manager/environment injection,
- jangan expose broker admin port ke semua network.

---

## 26. Observability JMS

Minimal metrics:

### 26.1 Broker

- broker up/down,
- connection count,
- memory usage,
- disk/store usage,
- destination count,
- broker errors.

### 26.2 Destination

- pending message count,
- oldest message age,
- enqueue rate,
- dequeue rate,
- consumer count,
- producer count,
- redelivery count,
- DMQ count.

### 26.3 Consumer/MDB

- processed count,
- success count,
- failure count,
- average processing time,
- p95/p99 processing time,
- duplicate count,
- poison count,
- transient retry count,
- downstream error count.

### 26.4 Business Metrics

Untuk domain case management/regulatory system:

- case event lag,
- notification delivery lag,
- audit event backlog,
- correspondence generation backlog,
- SLA-impacting queue age.

Golden signal paling penting untuk queue bukan hanya queue depth.

Lebih penting:

```text
oldest message age
```

Karena queue depth 1000 bisa normal jika throughput tinggi. Tetapi pesan tertua 6 jam berarti SLA rusak.

---

## 27. Logging JMS yang Benar

Setiap consumer log minimal:

```text
event_id
message_id
correlation_id
causation_id
destination
consumer_name
delivery_count
aggregate_id
event_type
event_version
processing_result
duration_ms
```

Contoh log sukses:

```text
INFO consumer=case-event-consumer destination=jms/CaseEventQueue eventId=EVT-123 aggregateId=CASE-9 correlationId=REQ-7 result=SUCCESS durationMs=142
```

Contoh log duplicate:

```text
INFO consumer=case-event-consumer eventId=EVT-123 aggregateId=CASE-9 result=DUPLICATE_SKIPPED durationMs=12
```

Contoh log poison:

```text
ERROR consumer=case-event-consumer eventId=EVT-456 aggregateId=CASE-10 result=POISON failureType=SCHEMA_INVALID deliveryCount=5 action=MOVED_TO_DMQ
```

Jangan log payload penuh jika mengandung PII/sensitive data.

---

## 28. Troubleshooting Playbook

### 28.1 Aplikasi Tidak Bisa Lookup JMS Resource

Gejala:

```text
NameNotFoundException
Lookup failed
Injection failed
```

Cek:

```bash
asadmin list-jms-resources
asadmin list-jndi-entries
```

Pertanyaan:

- resource dibuat di target yang benar?
- nama JNDI sama?
- aplikasi deploy ke instance/cluster yang punya resource?
- `javax` vs `jakarta` mismatch?
- resource disabled?

### 28.2 Producer Bisa Send, Consumer Tidak Jalan

Cek:

- destination benar?
- physical destination ada?
- MDB deploy sukses?
- activation config benar?
- consumer count di broker?
- MDB pool disabled?
- app exception saat startup?
- security credential salah?
- broker connection reachable?

Command:

```bash
asadmin list-applications
asadmin list-jms-resources
imqcmd list dst -u admin
imqcmd metrics dst -t q -n CaseEventQueue -m con -u admin
```

### 28.3 Queue Depth Naik

Pertanyaan:

1. Producer rate naik?
2. Consumer count turun?
3. Consumer error naik?
4. DB lambat?
5. Downstream timeout?
6. Redelivery loop?
7. Broker disk hampir penuh?
8. Ada deployment baru?

Diagnose:

```text
queue depth + oldest age + consumer count + app logs + DB pool metrics
```

### 28.4 Pesan Diproses Berkali-kali

Penyebab:

- transaction rollback,
- consumer crash setelah side effect sebelum ack,
- redelivery karena timeout,
- broker reconnect,
- duplicate publish dari producer,
- manual retry/replay.

Cek:

- idempotency table,
- event id,
- JMS redelivered flag,
- delivery count,
- exception logs,
- transaction timeout logs.

### 28.5 MDB Stuck

Kemungkinan:

- handler blocked di DB,
- handler blocked di HTTP call,
- deadlock,
- thread pool exhausted,
- transaction timeout,
- infinite loop,
- synchronized lock contention.

Ambil thread dump:

```bash
jcmd <pid> Thread.print > thread-dump.txt
```

Cari:

- `onMessage`,
- JDBC driver call,
- socket read,
- locked monitor,
- waiting on pool,
- blocked threads.

### 28.6 Broker Tidak Bisa Start

Cek:

- port conflict,
- store lock,
- corrupt store,
- permission issue,
- disk full,
- wrong credential/config,
- Java compatibility,
- previous broker process masih hidup.

### 28.7 DMQ Naik

Jangan hanya replay.

Pertanyaan:

- failure permanent atau transient?
- schema berubah?
- deployment consumer baru?
- data source missing?
- consumer bug?
- downstream reject?
- replay aman?
- side effect idempotent?

Flow:

```text
inspect sample
classify failure
fix root cause
replay small batch
monitor duplicate/failure
replay remaining
```

---

## 29. Tuning Messaging

### 29.1 Tuning Producer

Faktor:

- persistent vs non-persistent,
- transaction batch size,
- message size,
- compression,
- connection reuse,
- send rate,
- synchronous send overhead.

Rule:

- jangan create connection per message,
- gunakan resource/container-managed connection,
- batch jika semantics mengizinkan,
- ukur latency send dan broker ack.

### 29.2 Tuning Consumer

Faktor:

- MDB pool size,
- concurrent consumers,
- transaction duration,
- DB time,
- downstream call time,
- message batch/ack mode,
- redelivery delay.

Rule:

- consumer concurrency harus mengikuti bottleneck downstream,
- pendekkan transaction duration,
- jangan memproses file besar di transaction,
- jangan panggil service lambat tanpa timeout.

### 29.3 Tuning Broker

Faktor:

- persistent store,
- disk latency,
- memory limit,
- destination limit,
- producer flow control,
- connection count,
- broker JVM options,
- network latency.

Rule:

- persistent messaging bottleneck sering di disk,
- old message age lebih penting daripada average latency,
- store full adalah incident serius.

---

## 30. Deployment dan Environment Promotion

Messaging config harus ikut release discipline.

Artifact aplikasi saja tidak cukup.

Checklist environment:

```text
[ ] connection factory exists
[ ] destination resource exists
[ ] physical destination exists
[ ] target correct
[ ] credentials correct
[ ] broker reachable
[ ] DMQ configured
[ ] durable subscriptions reviewed
[ ] consumer concurrency set
[ ] monitoring dashboard exists
[ ] alert exists
[ ] replay procedure documented
[ ] idempotency table migrated
```

Config harus terdokumentasi sebagai script:

```bash
asadmin create-jms-resource ...
imqcmd create dst ...
```

Jangan hanya dibuat via Admin Console manual tanpa catatan.

---

## 31. Regulatory / Case Management Lens

Untuk sistem enforcement/case management, messaging sering dipakai untuk:

- state transition event,
- notification,
- audit event,
- SLA reminder,
- escalation trigger,
- document generation,
- integration with external agency,
- asynchronous screening,
- correspondence dispatch.

Risiko domain:

| Risiko | Dampak |
|---|---|
| Duplicate event | status case salah, notification ganda |
| Lost event | escalation tidak jalan |
| Out-of-order event | state transition invalid |
| Poison event | backlog dan SLA breach |
| No audit trail | sulit defensible |
| Replay tanpa kontrol | side effect berulang |
| Shared DMQ tanpa owner | failure tidak ditangani |

Design defensible:

- event id wajib,
- correlation id wajib,
- aggregate version wajib untuk state event,
- idempotency wajib,
- poison handling wajib,
- replay tool audit wajib,
- queue age alert wajib,
- owner per destination wajib.

---

## 32. Production Naming Convention

Contoh convention:

```text
jms/cf/CaseEventCF
jms/queue/CaseEventQueue
jms/queue/CaseEventDLQ
jms/topic/CaseDomainEventTopic
```

Physical destination:

```text
CASE.EVENT.Q
CASE.EVENT.DLQ
CASE.DOMAIN.EVENT.T
```

Consumer name:

```text
case-event-consumer
notification-email-consumer
audit-trail-consumer
```

Idempotency key:

```text
<producer>:<eventType>:<eventId>
```

Metric labels:

```text
destination=CASE.EVENT.Q
consumer=case-event-consumer
eventType=CaseSubmitted
result=success|duplicate|transient_failure|poison
```

---

## 33. Anti-Patterns

### 33.1 Queue sebagai Database

Jika pesan disimpan lama dan dianggap source of truth, desain salah.

Queue adalah transport/buffer, bukan database domain utama.

### 33.2 Consumer Tidak Idempotent

Ini hampir selalu bug production waiting to happen.

### 33.3 Infinite Redelivery

Retry tanpa batas untuk permanent failure akan menghancurkan stabilitas.

### 33.4 Semua Pesan Persistent Tanpa Klasifikasi

Persistent untuk semua hal bisa membebani broker tanpa kebutuhan bisnis.

### 33.5 Satu Global Queue untuk Semua Event

Sulit observability, sulit ownership, sulit tuning, sulit replay.

### 33.6 Mengabaikan Message Age

Queue depth saja tidak cukup.

### 33.7 Menambah Consumer Saat DB Sudah Saturated

Ini memperburuk incident.

### 33.8 Tidak Ada Replay Tool

Jika pesan masuk DLQ, tim harus punya prosedur replay aman.

### 33.9 Menggunakan Topic Tanpa Durable Strategy

Subscriber bisa kehilangan event jika offline.

### 33.10 Membawa API JMS Jar ke Aplikasi

Di application server, API Jakarta/JMS disediakan runtime. Membawa jar API sendiri bisa menyebabkan classloading conflict.

---

## 34. Reference Architecture: Reliable Case Event Queue

Contoh arsitektur:

```text
Case Service
   |
   | DB transaction writes case_state + outbox_event
   v
Outbox Publisher
   |
   | sends persistent JMS message
   v
CASE.EVENT.Q
   |
   +-- Case Projection Consumer
   +-- SLA Consumer
   +-- Notification Consumer
   +-- Audit Consumer
```

Jika setiap consumer harus menerima semua event, gunakan topic atau fan-out pattern:

```text
CASE.DOMAIN.EVENT.T
   |
   +-- durable subscription / queue for audit
   +-- durable subscription / queue for notification
   +-- durable subscription / queue for SLA
```

Lebih operationally clear:

```text
Outbox Publisher
   |
   v
CASE.DOMAIN.EVENT.T
   |
   +-- AUDIT.CASE.EVENT.Q
   +-- SLA.CASE.EVENT.Q
   +-- NOTIFICATION.CASE.EVENT.Q
```

Setiap queue punya:

- owner,
- DLQ,
- retry policy,
- dashboard,
- alert,
- replay runbook.

---

## 35. Minimal Hands-On Lab

### 35.1 Buat Resource

```bash
asadmin create-jms-resource \
  --restype jakarta.jms.ConnectionFactory \
  jms/CaseConnectionFactory

asadmin create-jms-resource \
  --restype jakarta.jms.Queue \
  --property Name=CaseEventQueue \
  jms/CaseEventQueue
```

### 35.2 Buat MDB

```java
import jakarta.ejb.ActivationConfigProperty;
import jakarta.ejb.MessageDriven;
import jakarta.jms.Message;
import jakarta.jms.MessageListener;
import jakarta.jms.TextMessage;

@MessageDriven(
    activationConfig = {
        @ActivationConfigProperty(
            propertyName = "destinationLookup",
            propertyValue = "jms/CaseEventQueue"
        ),
        @ActivationConfigProperty(
            propertyName = "destinationType",
            propertyValue = "jakarta.jms.Queue"
        )
    }
)
public class CaseEventConsumer implements MessageListener {

    @Override
    public void onMessage(Message message) {
        try {
            if (message instanceof TextMessage textMessage) {
                String payload = textMessage.getText();
                System.out.println("Received case event: " + payload);
            } else {
                throw new IllegalArgumentException("Unsupported message type: " + message.getClass());
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

### 35.3 Buat Producer

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;

@ApplicationScoped
public class CaseEventProducer {

    @Inject
    private JMSContext context;

    @Resource(lookup = "jms/CaseEventQueue")
    private Queue queue;

    public void publish(String eventJson) {
        context.createProducer()
            .setProperty("eventType", "CaseSubmitted")
            .setProperty("correlationId", "REQ-123")
            .send(queue, eventJson);
    }
}
```

### 35.4 Uji Failure

Modifikasi MDB:

```java
if (payload.contains("FAIL")) {
    throw new RuntimeException("Simulated failure");
}
```

Amati:

- apakah pesan redelivered,
- apakah log berulang,
- apakah queue stuck,
- apakah delivery count berubah,
- bagaimana behavior transaction/ack.

Tujuan lab bukan hanya "berhasil kirim pesan", tapi memahami konsekuensi failure.

---

## 36. Checklist Design Review JMS GlassFish

Sebelum production, jawab:

### Resource

- [ ] Connection factory dibuat via script.
- [ ] Destination resource dibuat via script.
- [ ] Physical destination jelas.
- [ ] Target resource benar.
- [ ] Naming convention konsisten.

### Reliability

- [ ] Pesan critical persistent.
- [ ] Consumer idempotent.
- [ ] Idempotency key jelas.
- [ ] Redelivery policy jelas.
- [ ] DLQ/DMQ strategy jelas.
- [ ] Replay procedure ada.

### Transaction

- [ ] Transaction boundary jelas.
- [ ] DB + JMS consistency pattern jelas.
- [ ] XA vs outbox decision terdokumentasi.
- [ ] Timeout disetel.
- [ ] Rollback behavior diuji.

### Observability

- [ ] Queue depth metric ada.
- [ ] Oldest message age metric ada.
- [ ] Consumer success/failure metric ada.
- [ ] Redelivery metric ada.
- [ ] DLQ alert ada.
- [ ] Correlation id muncul di log.

### Capacity

- [ ] Consumer concurrency dihitung.
- [ ] DB pool cukup.
- [ ] Downstream rate limit dihitung.
- [ ] Broker disk dipantau.
- [ ] Load test dilakukan.

### Security

- [ ] Credential bukan admin default.
- [ ] Secret tidak hardcoded.
- [ ] Broker/admin port tidak exposed sembarangan.
- [ ] Access control destination dipahami.

---

## 37. Mental Model Ringkas

GlassFish JMS/OpenMQ harus dipahami sebagai layered runtime:

```text
Application
   |
   | Jakarta Messaging API
   v
JNDI Resource
   |
   v
Connector Resource / Resource Adapter
   |
   v
JMS Service
   |
   v
OpenMQ Broker
   |
   v
Physical Destination + Persistent Store
```

MDB runtime:

```text
Broker message
   |
   v
Resource Adapter
   |
   v
EJB Container
   |
   v
MDB Pool
   |
   v
Transaction Boundary
   |
   v
Business Side Effects
   |
   v
Commit -> Ack
Rollback -> Redelivery
```

Reliability truth:

```text
Messaging production = at-least-once delivery + idempotent consumer + observable retry + safe poison handling.
```

---

## 38. Ringkasan

Pada Part 14 ini kita membahas:

- posisi OpenMQ sebagai provider messaging default GlassFish,
- perbedaan JMS resource, connector resource, dan physical destination,
- queue vs topic dari perspektif runtime,
- embedded vs remote broker,
- `asadmin` JMS resource management,
- physical destination dengan `imqcmd`,
- MDB lifecycle dan container-managed consumption,
- manual consumer vs MDB,
- delivery semantics,
- persistence,
- acknowledgement,
- transaction coupling,
- redelivery,
- poison message,
- dead message strategy,
- idempotency,
- ordering,
- backpressure,
- concurrency budget,
- envelope dan schema versioning,
- request/reply,
- durable subscription,
- security,
- observability,
- troubleshooting,
- tuning,
- production deployment checklist,
- regulatory/case management lens.

Top 1% understanding bukan hafal command JMS, tetapi mampu menjawab:

> Jika pesan dikirim, siapa menyimpannya?  
> Jika consumer gagal, siapa mengulanginya?  
> Jika transaction rollback, siapa yang melihat efeknya?  
> Jika pesan duplicate, apakah sistem aman?  
> Jika queue naik, bottleneck sebenarnya di mana?  
> Jika pesan poison, bagaimana sistem tetap bergerak?  
> Jika event harus defensible secara audit, bukti apa yang disimpan?

---

## 39. Status Seri

Selesai:

- Part 0 — Orientation
- Part 1 — Version Matrix, Compatibility, dan Migration Map
- Part 2 — Installation, Distribution Layout, dan Runtime Anatomy
- Part 3 — Domain Model
- Part 4 — `asadmin` Deep Dive
- Part 5 — Admin Console, REST Admin API, dan Configuration as Code
- Part 6 — Bootstrap Lifecycle
- Part 7 — Classloading Architecture
- Part 8 — Deployment Model
- Part 9 — GlassFish-Specific Descriptors dan Vendor Extension
- Part 10 — HTTP Stack dan Grizzly Runtime Internals
- Part 11 — Thread Pools, Executor Model, Blocking, Async, dan Virtual Threads
- Part 12 — JDBC Resources dan Connection Pool Engineering
- Part 13 — Transaction Service
- Part 14 — JMS dan OpenMQ di GlassFish

Berikutnya:

- **Part 15 — EJB Container Runtime: Pooling, Passivation, Timers, Remote Calls, dan ORB**

Seri **belum selesai**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-013.md">⬅️ Part 13 — Transaction Service: JTA, XA, Recovery, Timeout, dan Failure Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-015.md">Part 15 — EJB Container Runtime: Pooling, Passivation, Timers, Remote Calls, dan ORB ➡️</a>
</div>
