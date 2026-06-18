# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-019

# Part 19 — Provider Differences: ActiveMQ Classic, IBM MQ, RabbitMQ JMS Client, Solace, WebLogic, WildFly, Open Liberty

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: 19 dari 35  
> Target: Java 8 hingga Java 25  
> Fokus: memahami batas portabilitas JMS/Jakarta Messaging dan perbedaan nyata antar provider/broker/runtime enterprise.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 18, kita sudah membangun fondasi:

1. JMS/Jakarta Messaging sebagai kontrak koordinasi asinkron.
2. Perbedaan queue, topic, producer, consumer, session, acknowledgement, transaction, reliability, ordering, retry, selector, security.
3. Broker architecture secara konseptual.
4. ActiveMQ Artemis sebagai reference broker modern.

Part ini menjawab pertanyaan lanjutan yang sangat penting di dunia nyata:

> Jika JMS adalah standard API, apakah semua provider JMS akan berperilaku sama?

Jawaban engineering-nya:

> Tidak. JMS/Jakarta Messaging memberi bahasa API dan semantic baseline, tetapi banyak keputusan production ditentukan oleh provider: broker storage, failover, clustering, DLQ policy, redelivery policy, selector implementation, transaction behavior, admin object model, connection recovery, observability, dan operational tooling.

Ini adalah salah satu perbedaan antara engineer yang “bisa menulis kode JMS” dan engineer yang “bisa mendesain sistem messaging enterprise”.

---

## 1. Mental Model Utama: JMS adalah Contract, Provider adalah Reality

Bayangkan JMS seperti JDBC.

JDBC memberi API umum:

```java
Connection connection = dataSource.getConnection();
PreparedStatement ps = connection.prepareStatement("select * from users where id = ?");
ResultSet rs = ps.executeQuery();
```

Tetapi perilaku nyata sangat dipengaruhi database:

- PostgreSQL berbeda dengan Oracle.
- MySQL berbeda dengan SQL Server.
- Isolation level bisa punya detail berbeda.
- Locking berbeda.
- Optimizer berbeda.
- Driver behavior berbeda.

JMS juga demikian.

JMS memberi API umum:

```java
ConnectionFactory cf = ...;
Connection connection = cf.createConnection();
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
Queue queue = session.createQueue("orders.in");
MessageProducer producer = session.createProducer(queue);
producer.send(session.createTextMessage("hello"));
```

Tetapi perilaku nyata dipengaruhi provider:

- Bagaimana message disimpan?
- Kapan `send()` dianggap sukses?
- Bagaimana redelivery delay dikonfigurasi?
- Bagaimana DLQ dibuat?
- Bagaimana failover client bekerja?
- Apakah queue/topic mapping benar-benar sama?
- Apakah JMS 2.0/Jakarta Messaging 3.x didukung penuh?
- Apakah XA benar-benar stabil untuk workload tertentu?
- Bagaimana observability dilakukan?
- Apakah broker cocok untuk Kubernetes?
- Apakah provider punya extension yang menggoda tetapi mengunci aplikasi?

**Invariant top 1%:**

> Treat JMS portability as source-level portability, not operational equivalence.

Artinya: kode bisa terlihat portable, tetapi production behavior belum tentu portable.

---

## 2. Apa yang Dijamin Spec vs Apa yang Tidak Dijamin

Jakarta Messaging mendeskripsikan API untuk membuat, mengirim, menerima, dan membaca message melalui komunikasi asynchronous yang loosely coupled dan reliable. Tetapi spec tidak mendikte seluruh detail internal broker.

### 2.1 Yang Relatif Portable

Hal-hal berikut biasanya portable di level API:

- `ConnectionFactory`
- `Connection`
- `Session`
- `JMSContext`
- `Queue`
- `Topic`
- `MessageProducer`
- `MessageConsumer`
- `JMSProducer`
- `JMSConsumer`
- `TextMessage`, `BytesMessage`, `MapMessage`, `ObjectMessage`, `StreamMessage`
- `AUTO_ACKNOWLEDGE`
- `CLIENT_ACKNOWLEDGE`
- `DUPS_OK_ACKNOWLEDGE`
- transacted session
- message selector syntax baseline
- header/property access
- temporary destination
- durable subscription baseline

### 2.2 Yang Tidak Boleh Diasumsikan Sama

Hal-hal berikut sering berbeda antar provider:

| Area | Kenapa Berbeda |
|---|---|
| Connection URI | Format failover, discovery, TLS, credential, transport berbeda |
| JNDI/admin object | Naming, lookup, lifecycle, config source berbeda |
| Redelivery policy | Delay, multiplier, max delivery, DLQ routing provider-specific |
| DLQ policy | Nama DLQ, per-queue DLQ, global DLQ, expiry DLQ berbeda |
| Message ordering | Dipengaruhi dispatch, prefetch, priority, rollback, clustering |
| Prefetch/credit | Default dan mekanisme flow control sangat berbeda |
| Persistent storage | Journal/file/db/store implementation berbeda |
| HA/failover | Active/passive, replicated journal, shared store, client reconnect berbeda |
| Clustering | Semantics berbeda: scale-out, store-and-forward, network of brokers, federation |
| XA/JTA | Support ada, tetapi operational risk dan restriction berbeda |
| Selector performance | Indexing dan evaluation berbeda |
| Advisory/management event | Extension provider-specific |
| Observability | MBean, CLI, REST, console, metric names berbeda |
| Security ACL | Permission model berbeda |
| Jakarta namespace | `javax.jms` vs `jakarta.jms` support berbeda |

### 2.3 Rule of Thumb

Jika fitur diperlukan untuk correctness, jangan hanya melihat “JMS compliant”.

Validasi secara eksplisit:

1. Apakah API support ada?
2. Apakah broker support ada?
3. Apakah client library support ada?
4. Apakah feature bekerja di mode cluster/failover?
5. Apakah feature bekerja dengan transaksi?
6. Apakah feature bisa dimonitor?
7. Apakah feature bisa diuji otomatis?
8. Apakah feature bisa dioperasikan saat incident?

---

## 3. Provider Landscape

Kita akan membahas provider/runtime berikut:

1. Apache ActiveMQ Artemis
2. Apache ActiveMQ Classic
3. IBM MQ
4. RabbitMQ JMS Client
5. Solace JMS/Jakarta Messaging API
6. Oracle WebLogic JMS
7. WildFly/JBoss EAP dengan Artemis
8. Open Liberty dengan resource adapter

Part ini bukan vendor marketing. Kita melihatnya dari sudut engineering:

- semantic fit,
- portability,
- migration risk,
- production operations,
- failure behavior,
- Java 8–25 compatibility,
- legacy vs modern Jakarta namespace.

---

## 4. ActiveMQ Artemis

ActiveMQ Artemis adalah broker modern dari Apache ActiveMQ family dan sudah kita jadikan reference broker di Part 18.

### 4.1 Kekuatan Artemis

Artemis cocok sebagai reference karena:

- mendukung JMS/Jakarta Messaging;
- mendukung banyak protocol;
- punya model internal address + queue + routing type;
- queue/topic JMS dipetakan ke model broker internal;
- punya support anycast/multicast;
- punya journal, paging, flow control, clustering, HA;
- cukup dekat dengan kebutuhan enterprise dan cloud-native.

### 4.2 Yang Harus Dipahami

Artemis bukan sekadar “JMS broker”. Artemis punya core model sendiri.

JMS queue/topic hanyalah salah satu facade di atas core model.

Konsekuensi:

- `Queue` JMS biasanya dipetakan ke address anycast.
- `Topic` JMS biasanya dipetakan ke address multicast.
- Satu address bisa memiliki beberapa queue binding.
- Routing behavior bisa dikonfigurasi di luar kode JMS.
- Admin object naming penting.

### 4.3 Provider-Specific Area

Pada Artemis, area berikut harus dianggap provider-specific:

- address settings;
- dead letter address;
- expiry address;
- redelivery delay;
- max delivery attempts;
- paging configuration;
- journal type;
- cluster connection;
- bridge;
- federation;
- connection TTL;
- consumer window size;
- producer flow control;
- large message handling.

### 4.4 Production Implication

Jika aplikasi Anda ingin tetap portable:

- jangan hardcode Artemis-specific address model ke domain code;
- bungkus konfigurasi provider di infra/config layer;
- jangan membuat business logic bergantung pada nama internal DLQ Artemis;
- gunakan abstraction untuk retry/replay operation;
- tetap test dengan broker nyata.

### 4.5 Kapan Artemis Menarik

Artemis menarik ketika:

- butuh broker open-source modern;
- butuh JMS/Jakarta Messaging plus protocol lain;
- butuh kontrol broker cukup detail;
- ingin deployment mandiri di VM/Kubernetes;
- ingin integrasi dengan WildFly/JBoss ecosystem;
- butuh migration target dari ActiveMQ Classic.

### 4.6 Risiko

Risiko Artemis:

- konfigurasi address/routing bisa membingungkan untuk tim yang berpikir murni JMS;
- clustering/HA perlu desain hati-hati;
- performance sangat dipengaruhi storage dan flow control;
- portability ke provider lain tidak otomatis;
- operational maturity tetap perlu dibangun.

---

## 5. ActiveMQ Classic

ActiveMQ Classic adalah broker JMS yang lebih lama dan banyak ditemukan di legacy enterprise system.

Dokumentasi Apache menyebut ActiveMQ Classic mendukung JMS 1.1 secara penuh, dan mendukung JMS 2.0 / Jakarta Messaging 3.1 secara parsial pada jalur tertentu. Ini penting: jangan menganggap semua fitur JMS modern otomatis aman di ActiveMQ Classic.

### 5.1 Mental Model ActiveMQ Classic

ActiveMQ Classic sering muncul di sistem:

- legacy Java EE/Spring lama;
- aplikasi Java 8;
- sistem yang sudah lama memakai `javax.jms`;
- integrasi dengan broker network-of-brokers;
- workload yang sudah stabil dan tidak ingin diganggu.

### 5.2 Kekuatan ActiveMQ Classic

Kekuatan utamanya:

- sangat populer secara historis;
- banyak contoh, blog, dan tooling lama;
- JMS 1.1 support matang;
- integrasi Spring lama sangat umum;
- relatif mudah untuk local development;
- banyak fitur extension seperti advisory messages, virtual topics, composite destinations.

### 5.3 Provider-Specific Feature yang Sering Membuat Lock-In

ActiveMQ Classic punya beberapa fitur kuat tetapi dapat membuat lock-in:

- virtual topic;
- network of brokers;
- advisory topic;
- composite destination;
- failover transport URI;
- broker-specific redelivery policy;
- KahaDB tuning;
- prefetch policy;
- exclusive consumer;
- message groups behavior;
- scheduled message plugin.

Fitur ini berguna, tetapi jangan anggap portable.

### 5.4 Java 8–25 Consideration

Untuk Java 8 legacy, ActiveMQ Classic masih sering relevan.

Untuk aplikasi modern Java 17/21/25 dengan Jakarta namespace, perlu hati-hati:

- apakah memakai `javax.jms` atau `jakarta.jms`?
- apakah client jar benar?
- apakah container memakai Jakarta EE 9/10/11?
- apakah library lain masih mengharapkan `javax.jms`?
- apakah Spring Boot versi modern mengharapkan `jakarta.jms`?

### 5.5 Migration Risk dari Classic ke Artemis

Migrasi dari ActiveMQ Classic ke Artemis bukan sekadar ganti dependency.

Yang harus dicek:

1. Nama destination.
2. Virtual topic mapping.
3. DLQ policy.
4. Redelivery config.
5. Prefetch behavior.
6. Failover URI.
7. Transaction behavior.
8. Durable subscription behavior.
9. Selector behavior.
10. Management/monitoring tooling.
11. Message store durability.
12. Replay operation.
13. Operational runbook.

### 5.6 Kapan Masih Masuk Akal Memakai Classic

Masih masuk akal jika:

- sistem legacy stabil;
- workload tidak menuntut fitur modern;
- organisasi punya operational knowledge Classic;
- risiko migrasi lebih besar dari benefit;
- aplikasi masih Java 8/`javax.jms`;
- ada fitur Classic-specific yang sulit diganti cepat.

### 5.7 Kapan Sebaiknya Tidak Memulai Baru dengan Classic

Untuk sistem baru, biasanya lebih masuk akal mempertimbangkan Artemis atau provider modern lain, terutama jika:

- target Jakarta namespace;
- Java 17/21/25;
- container/cloud-native;
- perlu lifecycle jangka panjang;
- perlu fitur modern broker;
- ingin menghindari legacy migration debt.

---

## 6. IBM MQ

IBM MQ adalah provider enterprise messaging yang sangat umum di bank, insurance, government, telco, dan organisasi besar.

IBM MQ classes for JMS/Jakarta Messaging mengimplementasikan JMS interface untuk IBM MQ dan juga menyediakan extension IBM MQ-specific. IBM MQ 9.3 memperkenalkan support Jakarta Messaging untuk aplikasi baru dan tetap mendukung JMS 2.0 untuk aplikasi existing, dengan catatan penting: jangan mencampur Jakarta Messaging 3.0 API dan JMS 2.0 API dalam aplikasi yang sama.

### 6.1 Mental Model IBM MQ

IBM MQ bukan hanya JMS broker.

IBM MQ adalah enterprise messaging platform dengan konsep:

- queue manager;
- local queue;
- remote queue;
- transmission queue;
- channel;
- listener;
- client/server connection;
- queue manager cluster;
- MQ security model;
- administrative object;
- MQ-specific message descriptor.

JMS di atas IBM MQ adalah mapping ke model MQ.

### 6.2 Kekuatan IBM MQ

IBM MQ kuat pada:

- enterprise reliability;
- platform maturity;
- mainframe/legacy integration;
- operational governance;
- transactional messaging;
- security/compliance;
- regulated environment;
- cross-platform enterprise integration;
- long-term support.

### 6.3 Provider-Specific Area

IBM MQ-specific concern:

- queue manager configuration;
- channel configuration;
- CCDT;
- MQ connection mode;
- MQMD mapping;
- RFH2 header;
- backout queue;
- backout threshold;
- MQ reason code;
- MQ security exit;
- TLS channel config;
- authority records;
- client reconnect options;
- XA resource behavior;
- resource adapter deployment.

### 6.4 Backout Queue vs DLQ

IBM MQ punya konsep backout handling yang sering muncul di enterprise.

Secara konseptual:

- message gagal diproses;
- delivery count/backout count naik;
- setelah threshold, message bisa dipindahkan ke backout queue;
- jika tidak bisa, bisa masuk DLQ sesuai config.

Jangan menganggap `DLQ` di Artemis/ActiveMQ sama persis dengan `backout queue` IBM MQ.

### 6.5 Java/Jakarta Compatibility Concern

Di aplikasi modern:

- `javax.jms` untuk aplikasi lama;
- `jakarta.jms` untuk aplikasi Jakarta baru;
- jangan campur API dalam satu aplikasi;
- periksa app server resource adapter;
- periksa Spring Boot/Spring Framework version;
- periksa transaction manager compatibility;
- periksa classloader isolation.

### 6.6 Kapan IBM MQ Tepat

IBM MQ sangat tepat jika:

- organisasi sudah punya MQ estate;
- ada integrasi mainframe/core banking;
- butuh enterprise support dan governance;
- compliance tinggi;
- operasi broker dikelola tim platform khusus;
- audit dan change control kuat;
- downtime cost sangat tinggi.

### 6.7 Risiko

Risiko IBM MQ:

- learning curve tinggi;
- banyak konsep non-JMS;
- configuration-heavy;
- license/cost/operational dependency;
- developer lokal bisa sulit menjalankan environment identik;
- portability ke broker open-source tidak sederhana;
- behavior sering terkait policy enterprise yang tidak terlihat di kode.

---

## 7. RabbitMQ JMS Client

RabbitMQ secara asli bukan broker JMS. RabbitMQ adalah message broker yang secara historis kuat di AMQP 0-9-1, dengan exchange/queue/binding/routing key model.

RabbitMQ JMS Client adalah library yang mengimplementasikan JMS di atas RabbitMQ Java client, bekerja bersama plugin tertentu untuk topic exchange behavior. Dokumentasi RabbitMQ menyebut tersedia client JMS 2.x untuk JMS 2.0 dan client JMS 3.x untuk JMS 3.0/Jakarta namespace.

### 7.1 Mental Model RabbitMQ + JMS

Jangan berpikir:

> RabbitMQ JMS Client membuat RabbitMQ menjadi broker JMS native sepenuhnya.

Lebih akurat:

> RabbitMQ JMS Client memberi facade JMS di atas RabbitMQ semantics.

Artinya, ada mapping:

- JMS destination ke RabbitMQ exchange/queue;
- JMS topic ke exchange/binding;
- JMS queue ke queue;
- selector/headers ke capability tertentu;
- acknowledgement ke RabbitMQ ack/nack;
- connection/session ke RabbitMQ connection/channel abstraction.

### 7.2 Kekuatan RabbitMQ

RabbitMQ kuat untuk:

- routing flexible;
- exchange model;
- lightweight deployment;
- broad ecosystem;
- AMQP-native system;
- simple work queue;
- pub/sub via exchange;
- integration with non-Java clients.

### 7.3 Risiko Saat Dipakai sebagai JMS Provider

Risiko utama:

- JMS feature mungkin tidak identik dengan broker JMS native;
- topic semantics bergantung mapping/plugin;
- selector support perlu diverifikasi;
- transaction behavior perlu diuji;
- durable subscription semantics perlu dicek;
- temporary destination behavior perlu dicek;
- failover behavior mengikuti RabbitMQ client/topology;
- DLQ behavior mengikuti RabbitMQ dead-letter exchange pattern;
- admin model bukan JMS-native.

### 7.4 Java Version Concern

RabbitMQ JMS Client memiliki jalur 2.x dan 3.x. Dalam dokumentasi GitHub, 2.x berhubungan dengan JMS 2.0 dan membutuhkan Java 8+, sedangkan 3.x berhubungan dengan JMS 3.0 dan membutuhkan Java 11+.

Konsekuensi:

- Java 8 legacy: biasanya `javax.jms`/JMS 2.x path.
- Java 11+ modern: bisa mempertimbangkan Jakarta/JMS 3.x path.
- Java 17/21/25: periksa dependency dan framework compatibility.

### 7.5 Kapan RabbitMQ JMS Client Masuk Akal

Masuk akal jika:

- organisasi sudah memakai RabbitMQ;
- aplikasi Java butuh JMS API untuk integrasi dengan framework lama;
- semantic kebutuhan sederhana;
- tidak butuh JMS provider behavior kompleks;
- interoperabilitas non-Java penting;
- tim platform sudah matang mengoperasikan RabbitMQ.

### 7.6 Kapan Sebaiknya Hati-Hati

Hati-hati jika:

- butuh strict JMS durable subscription semantics;
- butuh XA/JTA kompleks;
- butuh portable JMS behavior antar provider;
- memakai selector kompleks;
- butuh request/reply JMS penuh;
- ingin migrasi transparan dari IBM MQ/ActiveMQ ke RabbitMQ hanya dengan ganti URL.

---

## 8. Solace JMS / Jakarta Messaging API

Solace menyediakan API JMS dan Jakarta Messaging untuk aplikasi Java yang terhubung ke Solace event broker. Dokumentasi Solace menyebut JMS API menyediakan standard JMS interface dan mendukung pattern publish/subscribe, point-to-point, dan request/reply.

### 8.1 Mental Model Solace

Solace adalah event broker/platform dengan fokus pada:

- event mesh;
- pub/sub skala enterprise;
- multi-protocol messaging;
- routing event lintas environment;
- appliance/software/cloud deployment;
- topic hierarchy;
- enterprise-grade event distribution.

JMS adalah salah satu API access pattern.

### 8.2 Kekuatan Solace

Solace kuat jika:

- event distribution lintas banyak sistem;
- topic routing kaya;
- enterprise event mesh;
- low latency messaging;
- multi-cloud/hybrid eventing;
- banyak protocol harus coexist;
- governance event topic penting.

### 8.3 Provider-Specific Area

Area Solace-specific:

- VPN/message broker tenancy;
- topic hierarchy;
- queue endpoint;
- durable topic endpoint;
- subscription management;
- guaranteed messaging settings;
- replay feature jika tersedia/diaktifkan;
- flow control;
- client profile;
- ACL profile;
- DMQ/dead message queue behavior;
- Solace-specific headers/properties.

### 8.4 JMS Portability Concern

Jika memakai Solace via JMS:

- API terlihat JMS;
- operational semantics banyak dipengaruhi Solace broker config;
- topic naming convention bisa menjadi platform governance;
- queue subscription model bisa berbeda dari JMS broker tradisional;
- replay/event mesh features bukan portable JMS.

### 8.5 Kapan Solace Tepat

Solace tepat jika:

- organisasi ingin enterprise event broker/event mesh;
- banyak sistem lintas platform;
- topology hybrid/cloud/on-prem;
- event routing menjadi central capability;
- provider support penting;
- pub/sub lebih dominan daripada simple work queue.

### 8.6 Risiko

Risiko Solace:

- lock-in ke event mesh/topic governance;
- local developer setup bisa tidak sesederhana embedded broker;
- feature Solace-specific dapat masuk ke application design;
- migration ke broker JMS biasa mungkin sulit jika memakai semantics Solace yang kuat.

---

## 9. Oracle WebLogic JMS

WebLogic JMS adalah messaging system yang terintegrasi kuat dengan Oracle WebLogic Server. Dokumentasi Oracle menyebut WebLogic JMS mendukung JMS specification dan juga menyediakan extension tambahan di luar standard JMS API.

### 9.1 Mental Model WebLogic JMS

WebLogic JMS bukan hanya client library.

Ia adalah bagian dari application server runtime:

- JMS server;
- JMS module;
- subdeployment;
- connection factory;
- distributed destination;
- SAF store-and-forward;
- persistent store;
- JMS bridge;
- server cluster;
- migratable target;
- transaction integration;
- WebLogic console/JMX management.

### 9.2 Kekuatan WebLogic JMS

Kuat jika:

- aplikasi sudah berjalan di WebLogic;
- perlu integrasi container-managed transaction;
- deployment enterprise centralized;
- admin console/runbook sudah WebLogic-centric;
- Oracle stack dominan;
- XA/JTA/app server integration penting.

### 9.3 Provider-Specific Extension

WebLogic-specific area:

- distributed queue/topic;
- unit-of-order;
- SAF;
- persistent store;
- migratable target;
- JMS module descriptor;
- Work Manager integration;
- WebLogic-specific connection factory tuning;
- quota and threshold;
- paging;
- production pause/consumption pause;
- WLST scripting;
- deployment targeting.

### 9.4 Risiko Portability

Risiko terbesar WebLogic JMS adalah application-server coupling.

Kode bisa terlihat JMS-standard, tetapi operasi bergantung pada:

- WebLogic domain;
- JMS module;
- cluster target;
- JNDI names;
- transaction manager;
- console config;
- WLST automation;
- persistent store location;
- server migration behavior.

Migrasi dari WebLogic JMS ke external broker memerlukan desain ulang operational boundary.

### 9.5 Kapan WebLogic JMS Tepat

Tepat jika:

- organisasi sudah standardized di WebLogic;
- aplikasi monolith/Jakarta EE enterprise;
- container-managed resource penting;
- admin team ahli WebLogic;
- integration dengan Oracle ecosystem penting;
- deployment tidak cloud-native first.

### 9.6 Kapan Perlu Hati-Hati

Hati-hati jika:

- ingin microservice lightweight;
- ingin broker external independent;
- ingin Kubernetes-native deployment;
- ingin menghindari app-server lock-in;
- ingin runtime portable antar container.

---

## 10. WildFly / JBoss EAP dengan ActiveMQ Artemis

WildFly/JBoss EAP menggunakan ActiveMQ Artemis untuk messaging subsystem modern.

### 10.1 Mental Model

Di WildFly, JMS bukan sekadar dependency aplikasi.

Ada messaging subsystem:

- embedded broker;
- remote connector;
- pooled connection factory;
- JMS queue/topic resource;
- MDB integration;
- Jakarta Connectors resource adapter;
- Elytron security integration;
- management CLI;
- standalone-full profile.

### 10.2 Embedded vs Remote Broker

Ada dua model:

| Model | Keterangan |
|---|---|
| Embedded broker | Broker hidup di dalam app server |
| Remote broker | App server connect ke broker eksternal |

Untuk production modern, remote broker sering lebih sehat karena memisahkan lifecycle aplikasi dan broker.

WildFly proposal/dokumentasi juga menyebut remote broker sebagai praktik yang baik untuk memisahkan administrative concerns antara broker dan application server.

### 10.3 Kekuatan WildFly/JBoss Messaging

Kuat jika:

- aplikasi memakai Jakarta EE/MDB;
- butuh container-managed transaction;
- ingin Artemis integration;
- ingin managed connection pooling;
- ingin JCA/resource adapter behavior;
- tim sudah familiar dengan WildFly/JBoss CLI.

### 10.4 Provider-Specific Area

- subsystem XML/CLI config;
- `pooled-connection-factory`;
- resource adapter wiring;
- MDB activation;
- connector/socket binding;
- security domain;
- transaction integration;
- management model;
- embedded broker lifecycle.

### 10.5 Risiko

Risiko:

- config tersebar antara app, server, broker;
- embedded broker dapat mencampur failure domain;
- upgrade app server bisa memengaruhi messaging;
- remote broker config perlu disiplin;
- local dev profile sering berbeda dari production.

---

## 11. Open Liberty dengan Resource Adapter

Open Liberty menyediakan feature Jakarta Messaging 3.1/3.0/2.0 untuk konfigurasi resource adapter agar aplikasi dapat mengakses messaging system melalui Jakarta Messaging API. Dokumentasinya menyatakan resource adapter yang comply dengan Jakarta Connectors 2.1 dapat digunakan.

### 11.1 Mental Model

Open Liberty bukan broker JMS universal.

Ia menyediakan runtime container untuk:

- connection factory;
- queues/topics;
- activation specification;
- resource adapter;
- application injection;
- transaction integration;
- server config as code.

Broker bisa IBM MQ, Artemis, atau provider lain melalui resource adapter yang sesuai.

### 11.2 Kekuatan Open Liberty

Kuat jika:

- aplikasi Jakarta EE modern;
- ingin lightweight app server;
- ingin config eksplisit di `server.xml`;
- butuh integration dengan IBM MQ;
- ingin cloud-native app server runtime;
- butuh MicroProfile/Jakarta EE combination.

### 11.3 Provider-Specific Area

- resource adapter artifact;
- connector config;
- activation spec properties;
- classloader visibility;
- transaction config;
- TLS config;
- provider-specific managed objects;
- server feature compatibility.

### 11.4 Risiko

Risiko:

- banyak config berada di server layer;
- resource adapter compatibility harus dicek;
- Jakarta namespace migration perlu hati-hati;
- provider restrictions bisa muncul saat deployed sebagai generic resource adapter;
- local dev perlu mendekati production config.

---

## 12. Comparative Matrix

| Provider/Runtime | Best Fit | Strength | Watch Out |
|---|---|---|---|
| ActiveMQ Artemis | Modern open-source JMS/Jakarta broker | Address model, multi-protocol, HA, paging, WildFly ecosystem | Address/routing config, clustering complexity |
| ActiveMQ Classic | Legacy JMS 1.1 estate | Mature historical usage, Spring legacy, simple dev | Partial modern support, migration debt, Classic-specific extension |
| IBM MQ | Enterprise/regulatory/core integration | Reliability, governance, mainframe, support | Complexity, MQ-specific concepts, cost, strict config |
| RabbitMQ JMS Client | RabbitMQ estate needing JMS facade | Routing ecosystem, broad non-Java support | JMS facade over RabbitMQ semantics, feature mismatch risk |
| Solace | Enterprise event mesh/pub-sub | Topic routing, hybrid event distribution, low latency | Platform-specific event mesh model, lock-in risk |
| WebLogic JMS | Oracle/WebLogic enterprise apps | App-server integration, JTA, admin console | WebLogic coupling, domain config dependency |
| WildFly/JBoss + Artemis | Jakarta EE/MDB with Artemis | JCA/MDB integration, CLI, managed pooling | Embedded vs remote broker lifecycle, config complexity |
| Open Liberty + RA | Lightweight Jakarta EE with external broker | Resource adapter flexibility, IBM MQ fit | RA compatibility, server config/classloader issues |

---

## 13. javax.jms vs jakarta.jms Across Providers

### 13.1 The Migration Trap

`javax.jms` and `jakarta.jms` are not the same package.

A class compiled against:

```java
javax.jms.Message
```

is not compatible with:

```java
jakarta.jms.Message
```

Even if the API looks nearly identical, binary compatibility is broken by namespace.

### 13.2 Common Failure Mode

Typical runtime error:

```text
java.lang.ClassNotFoundException: javax.jms.Message
```

or:

```text
java.lang.NoClassDefFoundError: jakarta/jms/Message
```

or:

```text
ClassCastException between provider message object and expected JMS interface
```

### 13.3 Decision Matrix

| Application Stack | Prefer |
|---|---|
| Java EE 7/8 legacy | `javax.jms` |
| Spring Boot 2.x | usually `javax.jms` |
| Jakarta EE 9+ | `jakarta.jms` |
| Spring Boot 3.x | `jakarta.jms` |
| Java 8 legacy broker estate | usually `javax.jms` |
| Java 17/21/25 modern app | usually `jakarta.jms`, unless integrating legacy |

### 13.4 Rule

Do not mix these in the same deployment unit:

```text
javax.jms + jakarta.jms
```

Unless you are building an explicit migration bridge with classloader isolation.

---

## 14. Provider Difference by Feature

### 14.1 Redelivery

JMS gives redelivery signal and acknowledgement semantics.

Provider decides:

- redelivery delay;
- exponential backoff;
- max attempts;
- where poison message goes;
- whether delivery count header/property is exposed;
- how rollback interacts with dispatch;
- whether delay is broker-side or client-side.

### 14.2 DLQ / Backout / DMQ

Names differ:

| Provider | Common Concept |
|---|---|
| Artemis | dead letter address / DLQ routing |
| ActiveMQ Classic | DLQ policy |
| IBM MQ | backout queue / dead-letter queue |
| RabbitMQ | dead-letter exchange / dead-letter queue |
| Solace | DMQ / dead message queue |
| WebLogic | error destination / redelivery config |

Do not hardcode domain assumptions like:

```text
All poison messages go to queue named DLQ.
```

Instead define semantic abstraction:

```text
failed-message-quarantine for <business-flow>
```

and map it to provider config.

### 14.3 Failover

Provider differences:

- client reconnect URI;
- transparent reconnect support;
- session recreation;
- consumer re-subscription;
- in-flight transaction outcome;
- duplicate risk;
- producer send retry behavior;
- temporary destination survival;
- durable subscription recovery.

Top 1% rule:

> Every failover plan must define what happens to in-flight send, in-flight receive, uncommitted transaction, and pending request/reply correlation.

### 14.4 Clustering

“Cluster” means different things:

- broker HA pair;
- load-balanced broker nodes;
- message redistribution;
- network of brokers;
- queue manager cluster;
- event mesh;
- application server cluster;
- Kubernetes pod replica.

Never accept “we use cluster” as sufficient architecture detail.

Ask:

1. Does it preserve ordering?
2. Does it duplicate messages during failover?
3. Does it support transactions?
4. Is storage shared or replicated?
5. How are consumers rebalanced?
6. How is split brain prevented?
7. How is DLQ centralized?
8. What is the recovery time objective?
9. What is the data loss objective?

### 14.5 Selectors

Spec gives selector syntax baseline.

Provider decides:

- evaluation implementation;
- indexing;
- cost under many consumers;
- behavior with different property types;
- management visibility;
- effect on dispatch performance.

### 14.6 Message Groups / Unit of Order

Message group concepts differ:

- JMSXGroupID support;
- WebLogic Unit-of-Order;
- Artemis group bucket behavior;
- ActiveMQ Classic group behavior;
- RabbitMQ equivalent may need routing key/consistent hash/plugin;
- IBM MQ may require design using queue partitioning or MQ-specific features.

### 14.7 Transactions

All providers may claim transaction support, but production reality differs:

- local transaction only;
- JTA resource adapter support;
- XA support;
- recovery logs;
- heuristic outcomes;
- transaction timeout handling;
- app server integration;
- broker failover during 2PC.

Never approve JMS+DB transaction design without testing crash windows.

---

## 15. Portability Layers: How to Avoid Vendor Lock-In Without Becoming Naive

### 15.1 Bad Abstraction

```java
public interface MessageBus {
    void send(String destination, String json);
    String receive(String destination);
}
```

This abstraction hides too much:

- ack semantics;
- transaction boundary;
- retry policy;
- correlation;
- observability;
- idempotency;
- message metadata;
- error classification.

### 15.2 Better Abstraction

Model business intent:

```java
public interface CommandPublisher<C extends BusinessCommand> {
    PublishResult publish(C command, PublishContext context);
}
```

```java
public interface MessageHandler<M extends BusinessMessage> {
    HandlingResult handle(M message, HandlingContext context) throws Exception;
}
```

Where `HandlingContext` contains:

- message id;
- correlation id;
- causation id;
- trace id;
- delivery attempt;
- received timestamp;
- source destination;
- tenant;
- schema version;
- replay flag;
- idempotency key.

Provider-specific config remains outside business handler.

### 15.3 Keep JMS at Adapter Layer

Recommended structure:

```text
application/
  usecase/
    ApproveCaseHandler.java
    EscalateCaseHandler.java

messaging-contract/
  CaseApprovedEvent.java
  EscalateCaseCommand.java
  MessageEnvelope.java

messaging-jms-adapter/
  JmsCommandPublisher.java
  JmsMessageListener.java
  JmsEnvelopeMapper.java
  JmsErrorClassifier.java

messaging-provider-config/
  artemis/
  ibmmq/
  weblogic/
  solace/
```

This gives you:

- business code not tied to provider;
- provider config isolated;
- mapping explicit;
- migration testable;
- failure handling consistent.

---

## 16. Provider Evaluation Framework

When choosing a JMS provider, do not start from popularity.

Start from semantics.

### 16.1 Workload Questions

1. Is this command processing or event broadcast?
2. Is ordering per aggregate required?
3. Is duplicate processing acceptable if handler is idempotent?
4. Is replay required?
5. Is long retention required?
6. Is request/reply required?
7. Is XA required or can outbox/inbox be used?
8. Is strict low latency required?
9. Is high fan-out required?
10. Is cross-data-center routing required?
11. Is multi-tenant isolation required?
12. Is regulatory audit required?

### 16.2 Operational Questions

1. Who operates the broker?
2. Is there 24/7 support?
3. Is the team familiar with the provider?
4. Can developers run it locally?
5. Is there staging parity?
6. How are broker configs versioned?
7. How are queues/topics provisioned?
8. How is DLQ monitored?
9. How is message replay controlled?
10. How are credentials rotated?
11. How are certs renewed?
12. How are upgrades tested?

### 16.3 Failure Questions

1. What happens if broker disk is full?
2. What happens if consumer is slow?
3. What happens if DB commit succeeds but JMS ack fails?
4. What happens if broker fails during send?
5. What happens if broker fails during XA prepare?
6. What happens if consumer reconnects and receives duplicate?
7. What happens if DLQ is also full?
8. What happens if schema version is unknown?
9. What happens if selector config is wrong?
10. What happens if cluster link breaks?

---

## 17. Migration Patterns Between Providers

### 17.1 Big Bang Migration

```text
Old provider OFF -> New provider ON
```

Usually risky.

Risk:

- messages in-flight;
- unprocessed DLQ;
- durable subscription state;
- producer/consumer version mismatch;
- operational team unfamiliar;
- config mismatch.

### 17.2 Dual Publish

Producer publishes to old and new provider.

```text
Producer -> Old Broker
         -> New Broker
```

Good for migration testing, but risks:

- duplicate business side effect if both consumers active;
- divergence;
- monitoring complexity;
- partial failure handling.

### 17.3 Bridge / Relay

```text
Old Broker -> Relay -> New Broker
```

Good if old producers cannot change quickly.

Need:

- idempotent relay;
- message id mapping;
- correlation preservation;
- DLQ for relay;
- replay strategy;
- schema compatibility.

### 17.4 Consumer Shadowing

New consumer reads copy of traffic but does not perform side effect.

```text
Message -> Old Consumer -> real side effect
        -> New Consumer -> validate only
```

Good for verifying behavior.

Need:

- no external side effect;
- deterministic comparison;
- metrics;
- mismatch report.

### 17.5 Contract-First Migration

Recommended for serious systems:

1. Define envelope contract.
2. Define message schema.
3. Define ack/transaction semantics.
4. Define retry/DLQ semantics.
5. Implement old adapter.
6. Implement new adapter.
7. Run same contract tests against both.
8. Run failure tests against both.
9. Run performance tests against both.
10. Switch traffic gradually.

---

## 18. Testing Provider Portability

### 18.1 Minimum Test Matrix

For each provider candidate, test:

| Test | Why |
|---|---|
| basic send/receive | API correctness |
| persistent message restart | durability |
| consumer crash before ack | redelivery |
| consumer crash after DB commit before ack | duplicate/idempotency |
| rollback retry | redelivery count |
| max retry -> DLQ/backout | poison handling |
| selector filtering | routing correctness |
| durable subscription restart | pub/sub durability |
| request/reply timeout | correlation safety |
| broker restart | recovery |
| broker failover | HA behavior |
| slow consumer | backpressure |
| high payload | memory/storage behavior |
| transaction commit/rollback | consistency |
| TLS cert rotation | security ops |

### 18.2 Testcontainers vs Real Broker

For open-source brokers, Testcontainers can help.

But for enterprise providers:

- IBM MQ container may be available for development, but production config may differ.
- Solace broker container may help, but event mesh/cloud config may differ.
- WebLogic/WildFly/Open Liberty integration should be tested in server runtime.

Do not claim portability after only testing an embedded mock.

### 18.3 Portable Contract Test Example

Pseudo-structure:

```java
interface MessagingProviderHarness {
    void start();
    void stop();
    ConnectionFactory connectionFactory();
    Destination commandQueue();
    Destination eventTopic();
    Destination deadLetterDestination();
    BrokerAdmin admin();
}
```

Then run same tests:

```java
abstract class MessagingContractTest {

    protected abstract MessagingProviderHarness provider();

    @Test
    void persistentMessageSurvivesBrokerRestart() {
        // send persistent message
        // stop broker
        // start broker
        // receive message
        // assert body and metadata
    }

    @Test
    void rollbackCausesRedeliveryWithoutLosingCorrelationId() {
        // receive in transacted session
        // rollback
        // receive again
        // assert JMSRedelivered and correlation preserved
    }
}
```

This approach tests semantics, not just code compilation.

---

## 19. Provider-Specific Configuration Must Be Treated as Code

A common enterprise failure:

```text
Application code is versioned.
Broker config is manually clicked in console.
```

This is dangerous.

Queue/topic config affects correctness:

- max delivery attempts;
- DLQ routing;
- expiry;
- selector;
- permissions;
- persistence;
- paging;
- quota;
- subscription;
- consumer limit;
- address settings.

Therefore broker config must be:

1. versioned;
2. reviewed;
3. promoted across environments;
4. tested;
5. auditable;
6. rollbackable.

Provider tooling differs:

| Provider | Config Automation |
|---|---|
| Artemis | XML/CLI/management API/operator depending deployment |
| ActiveMQ Classic | XML/properties/JMX |
| IBM MQ | MQSC, PCF, scripts, operator/platform tooling |
| RabbitMQ | definitions JSON, CLI, HTTP API, operator |
| Solace | CLI/SEMP/API/Cloud tooling |
| WebLogic | Console/WLST/domain config |
| WildFly | CLI/subsystem XML |
| Open Liberty | `server.xml`, configDropins, resource adapter config |

---

## 20. A Provider-Neutral Message Contract

Even if provider differs, message contract should remain stable.

Recommended envelope:

```json
{
  "messageId": "01J...",
  "messageType": "case.escalation.requested",
  "schemaVersion": 3,
  "correlationId": "corr-...",
  "causationId": "msg-...",
  "idempotencyKey": "case-123:escalation:v5",
  "tenantId": "agency-a",
  "sourceSystem": "case-service",
  "occurredAt": "2026-06-18T12:34:56Z",
  "publishedAt": "2026-06-18T12:34:57Z",
  "payload": {
    "caseId": "CASE-123",
    "fromState": "UNDER_REVIEW",
    "toState": "ESCALATED",
    "reasonCode": "SLA_BREACH"
  }
}
```

Then map important fields to JMS properties for selectors/observability:

```text
messageType      -> JMS property
schemaVersion    -> JMS property
correlationId    -> JMSCorrelationID and envelope
tenantId         -> JMS property
idempotencyKey   -> JMS property and envelope
traceId          -> JMS property
```

Do not rely only on provider-generated `JMSMessageID` for business idempotency.

---

## 21. Provider Selection Examples

### 21.1 Case Management Workflow

Need:

- command queue;
- per-case ordering;
- DLQ triage;
- retry/backoff;
- auditability;
- idempotency;
- moderate throughput;
- strong operational visibility.

Good options:

- Artemis;
- IBM MQ;
- WebLogic JMS if app already WebLogic;
- WildFly + remote Artemis if Jakarta EE runtime.

Less ideal:

- RabbitMQ JMS facade if strict JMS semantics are required.
- Solace if workload is mostly command processing and event mesh is not needed.

### 21.2 Enterprise Event Distribution

Need:

- many subscribers;
- topic hierarchy;
- event mesh;
- cross-system distribution;
- governance;
- hybrid routing.

Good options:

- Solace;
- Artemis depending scale/topology;
- IBM MQ if estate already MQ-centric.

Less ideal:

- simple embedded broker;
- app-server-coupled JMS if event distribution crosses many domains.

### 21.3 Legacy Java 8 Spring App

Need:

- minimal change;
- `javax.jms`;
- Spring Boot 2.x;
- stable queue processing.

Good options:

- ActiveMQ Classic if already used;
- IBM MQ if enterprise standard;
- Artemis with `javax.jms` path if migration is planned carefully.

Avoid:

- forcing Jakarta namespace migration together with broker migration unless necessary.

### 21.4 Modern Java 21/25 Jakarta App

Need:

- `jakarta.jms`;
- cloud-native deployment;
- resource adapter or standalone client;
- strong observability;
- long-term maintainability.

Good options:

- Artemis;
- IBM MQ Jakarta classes/resource adapter;
- Solace Jakarta API;
- Open Liberty + Jakarta Messaging feature/resource adapter;
- WildFly/JBoss + remote Artemis.

Avoid:

- accidental `javax.jms` dependency leaks.

---

## 22. Anti-Patterns

### 22.1 “JMS Compliant, Jadi Aman”

Salah.

Compliance tidak menjamin:

- redelivery policy sama;
- DLQ behavior sama;
- failover sama;
- performance sama;
- operational tooling sama.

### 22.2 “Ganti Provider Cuma Ganti ConnectionFactory”

Mungkin untuk demo.

Tidak cukup untuk production.

Yang perlu dimigrasi:

- destination config;
- retry policy;
- security;
- transaction config;
- monitoring;
- DLQ handling;
- failover URI;
- deployment automation;
- runbook;
- test harness.

### 22.3 Provider Extension di Business Code

Buruk:

```java
if (message.propertyExists("JMSXDeliveryCount")) {
    int count = message.getIntProperty("JMSXDeliveryCount");
}
```

Tidak selalu buruk, tetapi harus dibungkus:

```java
DeliveryMetadata metadata = deliveryMetadataExtractor.extract(message);
```

Dengan adapter per provider.

### 22.4 DLQ Tanpa Ownership

DLQ bukan tempat sampah.

DLQ harus punya:

- owner;
- dashboard;
- SLA;
- triage process;
- replay process;
- audit trail;
- access control;
- retention policy.

### 22.5 Cluster Tanpa Failure Drill

Tidak cukup punya cluster.

Wajib test:

- node kill;
- disk full;
- network partition;
- broker restart;
- consumer reconnect;
- transaction recovery;
- duplicate delivery;
- ordering impact.

---

## 23. Design Review Checklist

Gunakan checklist ini ketika memilih provider JMS.

### 23.1 API Compatibility

- [ ] Apakah aplikasi memakai `javax.jms` atau `jakarta.jms`?
- [ ] Apakah provider client library sesuai?
- [ ] Apakah framework kompatibel?
- [ ] Apakah app server menyediakan API atau aplikasi membawa sendiri?
- [ ] Apakah ada dependency yang menarik namespace lain?

### 23.2 Destination Semantics

- [ ] Queue/topic mapping jelas?
- [ ] Durable subscription diuji?
- [ ] Shared subscription diuji?
- [ ] Temporary destination diuji jika request/reply dipakai?
- [ ] Message group/order behavior diuji?

### 23.3 Reliability

- [ ] Persistent send diuji dengan broker restart?
- [ ] Consumer crash before ack diuji?
- [ ] Consumer crash after side effect before ack diuji?
- [ ] Duplicate handling aman?
- [ ] Idempotency key stabil?

### 23.4 Retry/DLQ

- [ ] Max delivery attempts jelas?
- [ ] Redelivery delay jelas?
- [ ] DLQ/backout/DMQ mapping jelas?
- [ ] Poison message tidak menyebabkan retry storm?
- [ ] Replay process aman?

### 23.5 Transaction

- [ ] Local transaction cukup atau butuh XA?
- [ ] Jika XA, recovery diuji?
- [ ] Jika outbox, relay idempotent?
- [ ] Jika inbox, dedup constraint jelas?
- [ ] Crash window terdokumentasi?

### 23.6 Security

- [ ] TLS/mTLS dikonfigurasi?
- [ ] ACL per destination?
- [ ] Secret rotation?
- [ ] Cert renewal?
- [ ] Audit access?
- [ ] Tenant isolation?

### 23.7 Operations

- [ ] Broker config versioned?
- [ ] Monitoring tersedia?
- [ ] Alert untuk queue depth/DLQ/redelivery?
- [ ] Backup/restore diuji?
- [ ] Upgrade path diuji?
- [ ] Runbook tersedia?

---

## 24. Practical Provider Decision Tree

```text
Apakah organisasi sudah punya enterprise MQ standard?
  Ya -> IBM MQ / provider standard organisasi, kecuali ada alasan kuat.
  Tidak -> lanjut.

Apakah aplikasi Jakarta EE app-server-centric?
  Ya -> WebLogic JMS / WildFly+Artemis / Open Liberty+RA sesuai runtime.
  Tidak -> lanjut.

Apakah butuh open-source JMS broker modern?
  Ya -> ActiveMQ Artemis.
  Tidak -> lanjut.

Apakah organisasi sudah pakai RabbitMQ dan JMS hanya adapter compatibility?
  Ya -> RabbitMQ JMS Client, tetapi validasi semantic gap.
  Tidak -> lanjut.

Apakah kebutuhan dominan event mesh/pub-sub lintas domain/cloud?
  Ya -> Solace atau event broker platform.
  Tidak -> lanjut.

Apakah sistem legacy ActiveMQ Classic stabil?
  Ya -> pertahankan sementara, rencanakan migration path.
  Tidak -> pilih provider berdasarkan semantics, operations, dan support.
```

---

## 25. Key Takeaways

1. JMS/Jakarta Messaging adalah API standard, bukan jaminan operational equivalence.
2. Provider differences adalah bagian dari desain sistem, bukan detail deployment kecil.
3. `javax.jms` vs `jakarta.jms` adalah boundary besar; jangan dicampur sembarangan.
4. ActiveMQ Artemis cocok sebagai broker modern open-source dan reference learning.
5. ActiveMQ Classic banyak di legacy, tetapi modern support perlu dicek hati-hati.
6. IBM MQ kuat untuk enterprise regulated environment, tetapi membawa konsep MQ-specific.
7. RabbitMQ JMS Client adalah JMS facade di atas RabbitMQ semantics; validasi feature gap.
8. Solace kuat untuk event mesh/pub-sub enterprise, tetapi platform semantics dapat mengunci desain.
9. WebLogic JMS sangat kuat di Oracle app-server estate, tetapi coupling tinggi.
10. WildFly/JBoss dan Open Liberty memberi container-managed integration melalui subsystem/resource adapter.
11. Portability harus diuji melalui contract test dan failure test, bukan hanya compile test.
12. Broker config adalah bagian dari correctness dan harus diperlakukan sebagai code.

---

## 26. Latihan Engineering

### Latihan 1 — Provider Fit

Ambil satu sistem case management dengan requirement:

- per-case ordering;
- retry 3 kali;
- DLQ triage;
- replay manual;
- audit trail;
- Java 21;
- Spring Boot 3;
- Kubernetes;
- no enterprise MQ standard.

Tentukan provider yang Anda pilih dan jelaskan:

1. Kenapa provider itu cocok?
2. Apa risiko utamanya?
3. Apa yang harus diuji sebelum production?
4. Apa provider-specific config yang harus dikunci?

### Latihan 2 — Migration Risk

Sistem lama memakai ActiveMQ Classic dengan virtual topic.

Target baru ingin Artemis.

Buat migration checklist untuk:

- destination mapping;
- durable consumer;
- DLQ;
- redelivery;
- monitoring;
- replay;
- failover;
- performance;
- rollback plan.

### Latihan 3 — Jakarta Namespace Audit

Audit dependency tree aplikasi Java modern.

Cari:

- `javax.jms-api`;
- `jakarta.jms-api`;
- Spring Boot version;
- app server API;
- provider client jar;
- resource adapter jar.

Buat keputusan apakah aplikasi harus tetap `javax.jms` atau pindah ke `jakarta.jms`.

### Latihan 4 — Failure Test Matrix

Pilih dua provider, misalnya Artemis dan IBM MQ.

Buat test matrix untuk:

- persistent send;
- consumer crash;
- duplicate;
- DLQ;
- transaction rollback;
- broker restart;
- failover;
- selector;
- durable subscription.

Bandingkan hasilnya.

---

## 27. Referensi Resmi

- Jakarta Messaging 3.1 — Eclipse Foundation: https://jakarta.ee/specifications/messaging/3.1/
- Apache ActiveMQ Classic documentation: https://activemq.apache.org/components/classic/documentation/
- Apache ActiveMQ Classic JMS 2.0/Jakarta Messaging support notes: https://activemq.apache.org/components/classic/documentation/jms2
- IBM MQ classes for JMS/Jakarta Messaging: https://www.ibm.com/docs/en/ibm-mq/9.3.x?topic=interfaces-mq-classes-jmsjakarta-messaging
- IBM MQ classes for Jakarta Messaging overview: https://www.ibm.com/docs/en/ibm-mq/9.3.x?topic=messaging-mq-classes-jakarta-overview
- RabbitMQ JMS Client: https://www.rabbitmq.com/client-libraries/jms-client
- RabbitMQ JMS Client GitHub: https://github.com/rabbitmq/rabbitmq-jms-client
- Solace JMS API: https://docs.solace.com/API/Solace-JMS-API/jms-get-started-open.htm
- Solace Jakarta Messaging supported environments: https://docs.solace.com/API/Solace-JMS-API/JMS-API-supported-environments.htm
- Oracle WebLogic JMS overview: https://docs.oracle.com/middleware/12212/wls/JMSPG/overview.htm
- Open Liberty Jakarta Messaging 3.1 feature: https://openliberty.io/docs/latest/reference/feature/messaging-3.1.html
- WildFly messaging documentation/source guide: https://github.com/wildfly/wildfly/blob/master/docs/src/main/asciidoc/_admin-guide/subsystem-configuration/Messaging.adoc

---

## 28. Penutup Part 19

Part ini menutup gap penting: memahami JMS bukan berarti memahami semua provider JMS.

Engineer top-tier harus bisa membedakan:

- API contract;
- broker semantics;
- provider extension;
- app server integration;
- operational behavior;
- failure recovery;
- migration risk.

Pada sistem enterprise, provider choice bukan hanya pilihan dependency. Itu adalah keputusan arsitektur yang memengaruhi reliability, security, compliance, runtime operations, dan lifecycle aplikasi selama bertahun-tahun.

Part berikutnya akan masuk ke:

> **Part 20 — JMS in Jakarta EE Runtime: MDB, Resource Adapter, JCA, ActivationSpec, dan Container-Managed Messaging**

Kita akan membahas bagaimana JMS hidup di dalam Jakarta EE runtime, bagaimana MDB menerima message, bagaimana resource adapter bekerja, bagaimana container mengelola transaksi dan concurrency, serta bagaimana app-server-managed messaging berbeda dari standalone JMS client.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-018.md">⬅️ Part 18 — ActiveMQ Artemis Deep Dive sebagai Reference Broker Modern</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-020.md">Part 20 — JMS in Jakarta EE Runtime: MDB, Resource Adapter, JCA, ActivationSpec, dan Container-Managed Messaging ➡️</a>
</div>
