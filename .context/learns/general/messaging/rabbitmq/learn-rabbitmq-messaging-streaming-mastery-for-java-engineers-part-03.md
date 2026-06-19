# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-03.md

# Part 03 — Exchange Routing Mastery

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Bagian: `03 / 34`  
> Fokus: exchange, binding, routing key, routing topology, dan desain broker-side routing RabbitMQ modern.

---

## 0. Tujuan Bagian Ini

Di Kafka, routing utama biasanya terjadi melalui pemilihan topic dan partition. Producer memilih topic; partitioning menentukan urutan dan distribusi; consumer group membaca dari topic. RabbitMQ berbeda secara fundamental: producer **tidak harus tahu queue tujuan**. Producer publish ke **exchange**, lalu exchange menerapkan aturan routing berdasarkan **binding** dan **routing key**.

Bagian ini akan membangun mental model yang membuat kamu bisa mendesain routing topology RabbitMQ dengan sadar, bukan hanya menghafal bahwa ada `direct`, `fanout`, `topic`, dan `headers` exchange.

Setelah bagian ini, kamu harus bisa menjawab pertanyaan seperti:

- Haruskah service publish ke queue langsung atau ke exchange?
- Kapan memakai direct exchange, topic exchange, fanout exchange, atau headers exchange?
- Apa bedanya routing key dengan event type?
- Bagaimana mendesain routing key yang evolvable?
- Bagaimana mencegah message hilang karena unroutable?
- Bagaimana membuat topology yang modular, tidak rapuh, dan mudah dioperasikan?
- Bagaimana menghindari routing topology yang terlihat rapi di awal tapi menjadi legacy trap?

---

## 1. Mental Model Utama: Exchange Adalah Router, Queue Adalah Mailbox

RabbitMQ memisahkan dua hal yang sering dicampur di sistem messaging lain:

1. **Ke mana producer mengirim?**  
   Producer mengirim ke exchange.

2. **Di mana message disimpan sampai consumer memproses?**  
   Message disimpan di queue atau stream.

Exchange bukan tempat penyimpanan utama. Exchange adalah routing decision point. Queue adalah storage/delivery point untuk consumer.

Secara konseptual:

```text
Producer
   |
   | basic.publish(exchange, routing_key, message)
   v
Exchange
   |
   | evaluate bindings
   v
Queue(s)
   |
   | deliver
   v
Consumer(s)
```

Exchange menjawab pertanyaan:

> Berdasarkan routing key, binding, dan exchange type, queue mana saja yang harus menerima copy message ini?

Queue menjawab pertanyaan:

> Setelah message sampai di sini, bagaimana message disimpan, dikirim, di-ack, di-redeliver, di-DLQ, dan diamati?

Ini pemisahan yang sangat kuat. Dengan pemisahan ini, producer bisa tetap stabil walaupun consumer bertambah, routing berubah, atau queue baru ditambahkan.

---

## 2. Kenapa Exchange Routing Penting Secara Arsitektur

Exchange routing memungkinkan **broker-side indirection**.

Tanpa exchange routing, producer harus tahu seluruh consumer atau queue tujuan:

```text
Bad coupling:
OrderService -> order.email.queue
OrderService -> order.audit.queue
OrderService -> order.fraud.queue
OrderService -> order.notification.queue
```

Dengan exchange:

```text
Better coupling:
OrderService -> order.events exchange

order.events exchange routes to:
- email queue
- audit queue
- fraud queue
- notification queue
```

Producer hanya tahu bahwa ia menerbitkan event atau command ke exchange tertentu. Consumer topology bisa berubah tanpa mengubah producer.

Ini berguna untuk:

- menambahkan consumer baru tanpa deploy producer;
- memisahkan routing concern dari business logic producer;
- membuat topology audit, notification, workflow, dan integration lebih fleksibel;
- melakukan fanout event tanpa producer mengirim berkali-kali;
- membuat multi-queue routing dengan satu publish;
- mengisolasi service consumer dengan queue masing-masing;
- mendukung evolution of architecture.

Tetapi kekuatan ini juga membuat RabbitMQ mudah disalahgunakan. Routing topology bisa menjadi terlalu kompleks, tidak terdokumentasi, dan sulit di-debug jika desainnya tidak disiplin.

---

## 3. Core Entities dalam Routing

### 3.1 Exchange

Exchange adalah entity RabbitMQ yang menerima publish dan menentukan routing.

Exchange memiliki atribut penting:

```text
name        : nama exchange
kind/type   : direct | fanout | topic | headers | plugin-defined type
durable     : survive broker restart jika true
auto-delete : dihapus otomatis saat tidak dipakai
internal    : tidak bisa dipublish langsung oleh client jika true
arguments   : konfigurasi tambahan, misalnya alternate-exchange
```

Dalam production, exchange yang menjadi bagian dari contract antar-service biasanya **durable**.

### 3.2 Queue

Queue adalah entity penyimpanan dan delivery. Exchange hanya routing. Queue-lah yang menahan message sampai consumer meng-ack.

Atribut queue akan dibahas lebih dalam di part berikutnya, tetapi dari sisi routing, queue adalah target binding.

### 3.3 Binding

Binding adalah aturan yang menghubungkan exchange ke queue atau exchange lain.

```text
Exchange --binding--> Queue
```

Binding bisa punya binding key atau arguments, tergantung exchange type.

Dalam direct/topic exchange, binding key sering menjadi pattern routing.

### 3.4 Routing Key

Routing key adalah string yang dikirim producer saat publish.

```java
channel.basicPublish(
    "case.events",       // exchange
    "case.opened.high",  // routing key
    properties,
    body
);
```

Routing key bukan message type secara otomatis. Routing key adalah input untuk exchange. Ia bisa merepresentasikan event type, severity, tenant, region, domain, command type, atau dimensi routing lain.

Salah satu kesalahan desain paling umum adalah membuat routing key terlalu kebetulan, tanpa taxonomy.

### 3.5 Message Headers

Headers adalah metadata key-value pada message properties. Headers bisa dipakai untuk observability, tracing, correlation, schema versioning, dan pada headers exchange bisa dipakai sebagai basis routing.

Namun jangan menjadikan headers sebagai tempat dumping semua state domain.

---

## 4. Exchange Type Overview

RabbitMQ memiliki beberapa exchange type utama:

| Exchange Type | Routing Basis | Kegunaan Utama |
|---|---|---|
| `direct` | exact match antara routing key dan binding key | command routing, simple event category, fixed destination class |
| `fanout` | semua queue yang bound menerima message | broadcast event, audit tap, cache invalidation |
| `topic` | pattern matching terhadap routing key dot-delimited | flexible pub/sub, domain event routing, multi-dimensional routing |
| `headers` | header matching berdasarkan binding arguments | content/metadata routing yang tidak cocok dengan routing key |
| default exchange | routing key = queue name | direct publish ke queue by name, mostly simple cases |

Exchange type bukan sekadar fitur teknis. Ia adalah pilihan arsitektur tentang **di mana routing knowledge diletakkan**.

---

## 5. Direct Exchange

### 5.1 Mental Model

Direct exchange melakukan exact match:

```text
message routing key == binding key
```

Contoh:

```text
Exchange: payment.commands

Bindings:
- payment.capture      -> payment-capture.queue
- payment.refund       -> payment-refund.queue
- payment.reconcile    -> payment-reconcile.queue
```

Publish:

```text
routing key: payment.capture
```

Hasil:

```text
payment-capture.queue receives the message
```

### 5.2 Kapan Direct Exchange Cocok

Gunakan direct exchange saat routing space bersifat eksplisit dan relatif stabil.

Cocok untuk:

- command dispatch;
- job category routing;
- routing ke satu atau beberapa queue dengan exact key;
- workflow step handoff;
- integration channel yang fixed;
- separating command type by queue.

Contoh command:

```text
case.commands exchange

case.evaluate-rules      -> rule-evaluator.queue
case.assign-reviewer     -> reviewer-assignment.queue
case.notify-party        -> notification-dispatch.queue
case.archive-case        -> archival.queue
```

Producer publish:

```text
exchange    = case.commands
routing_key = case.evaluate-rules
```

### 5.3 Direct Exchange Bisa Multicast

Direct exchange tidak selalu one-to-one. Jika beberapa queue memiliki binding key yang sama, semuanya akan menerima message.

```text
Exchange: enforcement.events.direct

Bindings:
case.opened -> investigation-projection.queue
case.opened -> audit-log.queue
case.opened -> notification.queue
```

Publish dengan routing key `case.opened` akan masuk ke tiga queue.

Jadi direct exchange adalah exact-match routing, bukan single-destination routing.

### 5.4 Anti-Pattern Direct Exchange

#### Anti-pattern 1 — Routing key sebagai queue name

```text
routing_key = email-service-prod-high-priority-queue
```

Ini membuat producer tahu internal topology consumer. Kalau queue berubah, producer berubah.

Lebih baik:

```text
routing_key = notification.email.requested
```

Queue bisa bernama:

```text
notification-email-worker.q
```

#### Anti-pattern 2 — Direct exchange untuk taxonomy yang akan berkembang liar

Jika routing key mulai seperti ini:

```text
case.opened.high.jakarta.public-sector.regulated.expedited
```

maka direct exchange menjadi tidak scalable secara cognitive. Topic exchange lebih cocok.

#### Anti-pattern 3 — Satu direct exchange global untuk semua command

```text
global.commands
```

Dengan routing key:

```text
user.create
payment.capture
case.evaluate
inventory.reserve
notification.email
```

Ini cepat menjadi dumping ground. Lebih baik gunakan domain-oriented exchange:

```text
user.commands
payment.commands
case.commands
inventory.commands
notification.commands
```

---

## 6. Fanout Exchange

### 6.1 Mental Model

Fanout exchange mengirim copy message ke semua queue yang bound, mengabaikan routing key.

```text
Producer -> fanout exchange -> all bound queues
```

Contoh:

```text
Exchange: case.lifecycle.broadcast
Type: fanout

Bound queues:
- audit-writer.q
- notification-projector.q
- analytics-ingestor.q
- search-indexer.q
```

Setiap publish ke exchange ini akan diterima semua queue di atas.

### 6.2 Kapan Fanout Cocok

Fanout cocok saat semantic-nya benar-benar broadcast.

Cocok untuk:

- cache invalidation;
- audit tap;
- lifecycle event broadcast;
- system-wide notification;
- simple pub/sub;
- local integration event distribution;
- “everyone interested should receive this”.

### 6.3 Kelebihan Fanout

- Simple.
- Producer tidak perlu routing key taxonomy.
- Menambahkan subscriber baru mudah.
- Cocok untuk event broadcast yang kecil dan jelas.

### 6.4 Kelemahan Fanout

- Tidak ada filtering di broker berdasarkan event type.
- Semua bound queues menerima semua message.
- Consumer harus filter sendiri jika tidak semua relevan.
- Bisa boros bandwidth/storage jika event volume besar.
- Bisa membuat subscriber menerima noise.

### 6.5 Fanout vs Topic dengan `#`

Topic exchange dengan binding `#` dapat berperilaku seperti fanout untuk binding tersebut. Tetapi secara desain, fanout lebih eksplisit jika memang tidak ada routing dimension.

Gunakan fanout jika:

```text
Semua subscriber harus menerima semua message.
```

Gunakan topic jika:

```text
Subscriber berbeda butuh subset berbeda berdasarkan pattern.
```

### 6.6 Anti-Pattern Fanout

#### Anti-pattern 1 — Fanout untuk high-volume event bus

Jika semua consumer menerima semua event padahal hanya sebagian kecil relevan, kamu memindahkan routing dari broker ke aplikasi. Itu membuang resource dan membuat evolusi sulit.

#### Anti-pattern 2 — Fanout karena malas mendesain routing key

Fanout terlihat nyaman di awal. Tetapi saat event berkembang, kamu akan menambahkan filter di setiap consumer. Itu tanda routing concern bocor ke aplikasi.

---

## 7. Topic Exchange

### 7.1 Mental Model

Topic exchange melakukan pattern matching terhadap routing key yang dipisahkan oleh titik (`.`).

Routing key:

```text
case.opened.high
case.closed.normal
evidence.submitted.document
payment.failed.card
```

Binding key bisa memakai wildcard:

```text
*  matches exactly one word
#  matches zero or more words
```

Contoh:

```text
case.*.high
case.#
*.failed.#
evidence.submitted.*
```

### 7.2 Contoh Routing

Exchange:

```text
case.events
Type: topic
```

Bindings:

```text
case.opened.*        -> case-opening-projection.q
case.*.high          -> high-priority-monitor.q
case.#               -> case-audit.q
evidence.submitted.* -> evidence-processor.q
```

Publish:

```text
routing_key = case.opened.high
```

Matches:

```text
case.opened.*  yes
case.*.high    yes
case.#         yes
evidence...    no
```

Hasil:

```text
case-opening-projection.q
high-priority-monitor.q
case-audit.q
```

### 7.3 Topic Exchange Cocok Untuk

- domain event routing;
- multi-subscriber event architecture;
- routing berdasarkan kategori domain;
- routing berdasarkan severity;
- routing berdasarkan region/tenant jika hati-hati;
- audit subset;
- workflow event selection;
- integration event bus di bounded context.

### 7.4 Routing Key sebagai Taxonomy

Routing key topic harus diperlakukan seperti taxonomy, bukan string bebas.

Contoh taxonomy buruk:

```text
opened.case.high
case.high.opened
high.case.opened
caseOpenedHigh
```

Ini buruk karena urutan tidak konsisten.

Contoh taxonomy lebih baik:

```text
<domain>.<entity>.<event>.<qualifier>
```

Misalnya:

```text
case.lifecycle.opened.normal
case.lifecycle.opened.high
case.lifecycle.closed.normal
evidence.document.submitted.normal
evidence.image.submitted.high
review.assignment.created.normal
```

Atau lebih compact:

```text
case.opened.normal
case.opened.high
case.closed.normal
evidence.submitted.document
review.assigned.manual
```

Yang penting bukan satu format universal, tetapi konsistensi dan evolvability.

### 7.5 Routing Key Bukan Payload Schema

Jangan memasukkan semua atribut payload ke routing key.

Buruk:

```text
case.opened.tenant-123.jakarta.high.public-sector.fraud.tax.2026.operator-777
```

Kenapa buruk?

- Routing key terlalu panjang.
- Cardinality meledak.
- Binding sulit diprediksi.
- Operational UI berantakan.
- Perubahan domain menjadi perubahan routing topology.
- Tenant/user-specific routing bisa menciptakan ribuan binding.

Lebih baik routing key hanya berisi dimensi yang benar-benar dipakai untuk routing broker-side:

```text
case.opened.high
```

Metadata lain ada di headers/payload:

```json
{
  "tenantId": "tenant-123",
  "region": "jakarta",
  "caseType": "fraud",
  "openedBy": "operator-777"
}
```

### 7.6 Memilih Urutan Kata Routing Key

Prinsip desain:

1. Letakkan dimensi paling stabil di depan.
2. Letakkan dimensi yang paling sering digunakan sebagai prefix subscription di depan.
3. Hindari dimensi high-cardinality di routing key.
4. Hindari data personal/sensitif di routing key.
5. Jangan terlalu banyak level.
6. Jangan encode versi teknis kecuali benar-benar dipakai untuk routing.

Contoh untuk regulatory case management:

```text
case.opened
case.updated
case.escalated
case.closed
evidence.submitted
evidence.verified
review.assigned
review.completed
enforcement.action.proposed
enforcement.action.approved
enforcement.action.rejected
```

Jika butuh severity:

```text
case.escalated.high
case.escalated.critical
```

Jika severity hanya metadata untuk consumer, jangan masukkan ke routing key.

### 7.7 Topic Wildcard Design

Misalnya routing key:

```text
case.escalated.critical
```

Binding:

```text
case.#                -> all case events
case.escalated.*      -> all escalations
case.*.critical       -> critical case lifecycle signals
enforcement.#         -> all enforcement events
#.critical            -> all critical events across domains
```

Hati-hati dengan `#` terlalu luas:

```text
# -> receives everything
```

Binding `#` berguna untuk audit, tetapi kalau terlalu banyak consumer pakai `#`, topology berubah menjadi fanout terselubung.

### 7.8 Topic Exchange Anti-Patterns

#### Anti-pattern 1 — Wildcard terlalu broad

```text
*.#
#
case.#
```

Jika banyak consumer menggunakan binding luas lalu filter di aplikasi, broker-side routing tidak dimanfaatkan.

#### Anti-pattern 2 — Urutan routing key tidak konsisten

```text
case.opened.high
case.high.closed
critical.case.escalated
```

Ini menghancurkan kemampuan pattern matching.

#### Anti-pattern 3 — Routing key menjadi query language

RabbitMQ topic exchange bukan query engine. Ia pattern matcher sederhana. Jika kamu butuh filtering kompleks berdasarkan banyak metadata, pertimbangkan:

- headers exchange;
- consumer-side filtering;
- separate projection service;
- stream + consumer filtering;
- database/search query setelah event diterima.

#### Anti-pattern 4 — Tenant per routing key tanpa batas

```text
tenant.001.case.opened
tenant.002.case.opened
...
tenant.50000.case.opened
```

Ini bisa valid untuk beberapa multi-tenant architecture, tetapi berbahaya jika tidak ada lifecycle dan cardinality control. Vhost, permission, queue ownership, atau application-level tenant filtering bisa lebih tepat.

---

## 8. Headers Exchange

### 8.1 Mental Model

Headers exchange merutekan message berdasarkan headers, bukan routing key.

Binding dapat menentukan header yang harus cocok, biasanya dengan `x-match`:

```text
x-match = all  -> semua header condition harus match
x-match = any  -> minimal satu condition match
```

Contoh headers:

```json
{
  "domain": "case",
  "event": "opened",
  "priority": "high",
  "region": "apac"
}
```

Binding queue:

```text
x-match = all
domain  = case
priority = high
```

Queue menerima message jika headers cocok.

### 8.2 Kapan Headers Exchange Cocok

Headers exchange cocok jika:

- routing berdasarkan metadata tidak natural jika dipaksa ke dot-delimited routing key;
- perlu matching beberapa attribute;
- routing key terlalu terbatas;
- kamu ingin memisahkan routing taxonomy dari event naming;
- routing condition berbasis headers lebih jelas.

Contoh:

```text
route where:
classification = confidential
region = eu
case_type = enforcement
```

### 8.3 Kelemahan Headers Exchange

Headers exchange sering lebih mahal secara cognitive daripada topic exchange.

Kelemahan:

- topology lebih sulit dibaca sekilas;
- binding arguments lebih verbose;
- debugging routing tidak seintuitif routing key;
- developer lebih sulit menebak message akan masuk queue mana;
- tidak cocok untuk taxonomy event sederhana.

### 8.4 Practical Guidance

Gunakan topic exchange sebagai default untuk event routing multi-dimensional yang masih sederhana.

Gunakan headers exchange jika:

```text
Routing condition memang berupa attribute matching, bukan path/category matching.
```

Jangan memakai headers exchange hanya karena ingin menghindari mendesain routing key.

---

## 9. Default Exchange

RabbitMQ memiliki default exchange dengan nama empty string `""`.

Default exchange adalah direct exchange khusus. Setiap queue secara otomatis bound ke default exchange dengan binding key sama dengan nama queue.

Contoh:

```java
channel.basicPublish("", "email-jobs.q", props, body);
```

Artinya:

```text
Publish ke default exchange dengan routing key email-jobs.q.
Karena queue email-jobs.q otomatis bound dengan key email-jobs.q,
message masuk ke queue tersebut.
```

### 9.1 Kapan Default Exchange Boleh Dipakai

Boleh untuk:

- tutorial;
- local experiment;
- very simple task queue;
- internal single-queue utility;
- quick admin operation.

### 9.2 Kenapa Default Exchange Kurang Ideal untuk Production Architecture

Default exchange membuat producer tahu nama queue.

```text
Producer -> queue name
```

Ini mengikat producer pada consumer topology.

Dalam arsitektur yang sehat:

```text
Producer -> exchange + semantic routing key
Consumer topology -> queue + binding
```

Jadi, hindari default exchange untuk contract antar-service yang evolvable.

---

## 10. Exchange-to-Exchange Binding

RabbitMQ mendukung binding dari exchange ke exchange.

```text
Exchange A -> Exchange B -> Queue
```

Ini berguna untuk menyusun routing topology modular.

Contoh:

```text
case.events.topic
   |
   | binding: case.#
   v
compliance.events.topic
   |
   | binding: case.escalated.*
   v
compliance-escalation.q
```

### 10.1 Kapan Exchange-to-Exchange Cocok

Cocok untuk:

- membuat domain exchange dan integration exchange;
- memisahkan internal event bus dari external integration bus;
- routing dari broad event exchange ke specialized exchange;
- alternate processing path;
- audit tap;
- migration topology;
- filtering sebelum fanout.

### 10.2 Risiko Exchange-to-Exchange

- Routing path menjadi lebih sulit dilacak.
- Bisa menciptakan loop jika tidak hati-hati.
- Debugging unroutable/duplicate message lebih kompleks.
- Topology documentation harus disiplin.

Gunakan exchange-to-exchange binding saat modularitas routing benar-benar memberi nilai, bukan untuk membuat diagram terlihat canggih.

---

## 11. Alternate Exchange

### 11.1 Problem: Unroutable Message

Message bisa tidak masuk queue jika tidak ada binding yang match.

Contoh:

```text
Exchange: case.events.topic
Bindings:
case.opened -> audit.q

Published routing key:
case.reopened
```

Jika tidak ada binding `case.reopened` atau pattern yang match, message menjadi unroutable.

Jika publisher tidak menggunakan `mandatory=true` dan tidak ada alternate exchange, message bisa hilang dari perspektif aplikasi.

### 11.2 Alternate Exchange Mental Model

Alternate exchange adalah exchange cadangan untuk message yang tidak bisa diroute oleh exchange utama.

```text
Producer
  -> primary exchange
      -> if routed: normal queue(s)
      -> if unroutable: alternate exchange
            -> unroutable queue / audit queue / parking queue
```

Contoh:

```text
case.events.topic
  x-alternate-exchange = case.events.unroutable

case.events.unroutable fanout/direct
  -> case-events-unroutable.q
```

### 11.3 Kapan Alternate Exchange Penting

Gunakan alternate exchange untuk:

- critical event publishing;
- audit-sensitive system;
- regulatory messaging;
- integration boundary;
- topology migration;
- catching producer routing bugs;
- detecting unknown event types.

### 11.4 Mandatory Publish vs Alternate Exchange

`mandatory=true` membuat publisher menerima returned message jika message tidak bisa diroute ke queue.

Alternate exchange membuat broker mencoba meroute message ke exchange cadangan.

Keduanya bisa saling melengkapi, tetapi punya tujuan berbeda:

| Mechanism | Responsibility | Hasil |
|---|---|---|
| mandatory publish | publisher aware terhadap unroutable | return callback ke producer |
| alternate exchange | broker-side fallback routing | message masuk fallback topology |

Dalam sistem production yang penting, sering kali kamu ingin:

- publisher confirms untuk memastikan broker menerima publish;
- mandatory/returns untuk mendeteksi unroutable;
- alternate exchange untuk menyimpan/mengaudit unroutable.

---

## 12. Routing Key Design: Prinsip yang Harus Dipegang

Routing key harus didesain seperti public API kecil. Ia adalah bagian dari messaging contract.

### 12.1 Prinsip 1 — Semantic, Bukan Infrastructure Name

Buruk:

```text
rule-evaluator-prod-v2-queue
```

Baik:

```text
case.rules.evaluate
```

Producer tidak perlu tahu queue.

### 12.2 Prinsip 2 — Stable First

Letakkan dimensi yang stabil di awal.

Baik:

```text
case.opened.high
case.closed.normal
case.escalated.critical
```

Buruk:

```text
high.case.opened
normal.case.closed
critical.case.escalated
```

Kenapa? Karena consumer sering subscribe berdasarkan domain:

```text
case.#
```

### 12.3 Prinsip 3 — Jangan Masukkan High-Cardinality Data

Hindari:

```text
case.opened.user-123456
case.opened.tenant-998877
case.opened.case-abc-123
```

High-cardinality data lebih cocok di payload/header.

### 12.4 Prinsip 4 — Jangan Masukkan PII atau Sensitive Data

Routing key sering terlihat di logs, UI, metrics, CLI, dan monitoring.

Jangan:

```text
case.opened.nik-317xxxxxxxxx
case.opened.email-john@example.com
```

### 12.5 Prinsip 5 — Jangan Terlalu Banyak Level

Routing key terlalu dalam sulit dipakai:

```text
case.lifecycle.opened.high.jakarta.public-sector.fraud.manual.review.required.v2
```

Lebih baik:

```text
case.opened.high
```

Sisanya metadata.

### 12.6 Prinsip 6 — Routing Key Harus Tahan Evolusi

Pertimbangkan apa yang terjadi saat event baru ditambahkan.

Jika taxonomy:

```text
case.<event>.<priority>
```

Maka event baru mudah:

```text
case.reopened.normal
case.reassigned.high
```

Consumer lama dengan binding:

```text
case.#
```

bisa tetap menerima semua case event.

Consumer spesifik bisa:

```text
case.opened.*
```

---

## 13. Event Type vs Routing Key

Routing key dan event type sering sama, tetapi tidak wajib sama.

### 13.1 Sama

```text
routing_key = case.opened
payload.eventType = case.opened
```

Ini sederhana dan sering cukup.

### 13.2 Routing Key Lebih Kasar

```text
routing_key = case.lifecycle
payload.eventType = case.opened
```

Cocok jika broker tidak perlu membedakan event type spesifik.

### 13.3 Routing Key Lebih Operasional

```text
routing_key = case.escalated.high
payload.eventType = CaseEscalated
payload.priority = HIGH
```

Cocok jika priority memang dipakai broker untuk routing ke high-priority queue.

### 13.4 Guidance

Jangan otomatis menyamakan routing key dengan class name Java.

Buruk:

```text
com.company.case.domain.events.CaseOpenedEvent
```

Lebih baik:

```text
case.opened
```

Routing key harus bahasa integrasi, bukan bahasa implementation.

---

## 14. Exchange Naming Design

Exchange name juga bagian dari contract.

### 14.1 Naming yang Baik

Contoh:

```text
case.commands
case.events
case.audit
payment.commands
payment.events
notification.commands
integration.partner-x.outbound
integration.partner-x.inbound
```

### 14.2 Naming yang Buruk

```text
exchange1
amq.topic.copy
prod-events-new-final
backend-service-exchange
java-events
```

Masalah:

- tidak menunjukkan domain;
- tidak menunjukkan intent;
- membawa detail implementation;
- sulit dioperasikan.

### 14.3 Domain-Oriented Exchange

Untuk sistem besar, hindari satu exchange global untuk semua hal.

Buruk:

```text
app.events
```

Semua domain publish ke sana:

```text
user.created
payment.failed
case.opened
evidence.submitted
notification.sent
```

Lebih baik:

```text
identity.events
payment.events
case.events
evidence.events
notification.events
```

Dengan ini:

- ownership lebih jelas;
- permission lebih mudah;
- topology lebih mudah dibaca;
- blast radius lebih kecil;
- migration lebih aman.

---

## 15. Queue Naming dari Perspektif Routing

Queue adalah milik consumer atau consumer group, bukan milik producer.

Baik:

```text
case-audit-writer.q
case-search-indexer.q
case-escalation-monitor.q
notification-email-dispatcher.q
```

Buruk:

```text
case.opened
case.closed
payment.failed
```

Kenapa buruk? Karena queue name terlihat seperti event type. Ini membuat orang mengira satu event = satu queue. Dalam RabbitMQ, satu event bisa diroute ke banyak queue, dan satu queue bisa menerima banyak event pattern.

Queue name sebaiknya menjawab:

> Consumer/workload apa yang membaca queue ini?

Bukan:

> Event apa yang dipublish producer?

---

## 16. Topology Patterns

### 16.1 Command Dispatch Pattern

Untuk command, biasanya direct exchange cocok.

```text
Exchange: case.commands
Type: direct

Bindings:
case.evaluate-rules   -> rule-evaluator.q
case.assign-reviewer  -> reviewer-assignment.q
case.send-notice      -> notice-dispatcher.q
```

Karakteristik:

- command biasanya ditujukan untuk satu capability;
- competing consumers bisa scale queue tersebut;
- command punya expectation bahwa sesuatu akan dilakukan;
- duplicate command harus ditangani idempotently.

### 16.2 Domain Event Topic Pattern

Untuk event domain, topic exchange sering cocok.

```text
Exchange: case.events
Type: topic

Bindings:
case.#                -> case-audit.q
case.opened           -> case-onboarding-projection.q
case.escalated.*      -> escalation-monitor.q
case.closed           -> archival-trigger.q
```

Karakteristik:

- event adalah fakta yang sudah terjadi;
- banyak subscriber bisa tertarik;
- producer tidak tahu subscriber;
- routing key taxonomy penting.

### 16.3 Broadcast Notification Pattern

Untuk broadcast sederhana, fanout.

```text
Exchange: deployment.cache-invalidation
Type: fanout

Queues:
service-a-cache.q
service-b-cache.q
service-c-cache.q
```

### 16.4 Audit Tap Pattern

Audit queue menerima semua event penting.

Option A: topic binding broad.

```text
Exchange: case.events topic
Binding: case.# -> case-audit.q
```

Option B: exchange-to-exchange ke audit exchange.

```text
case.events -> audit.events -> audit-writer.q
```

Option C: stream for audit.

Part stream akan membahas ini lebih dalam.

### 16.5 Integration Boundary Pattern

Internal domain event tidak selalu sama dengan external integration event.

```text
case.events
  -> case-integration-projector.q
      -> transforms internal event
      -> publishes to partner-x.outbound
```

Jangan expose semua internal routing key ke partner/system eksternal. Buat boundary yang eksplisit.

---

## 17. Routing Topology untuk Modular Monolith

Dalam modular monolith, RabbitMQ bisa dipakai untuk async boundary antar module atau external integration. Tetapi hati-hati: jika semua module berada dalam satu process dan satu database, in-process event mungkin lebih sederhana.

Jika tetap memakai RabbitMQ:

```text
case.events topic
review.events topic
enforcement.events topic
notification.commands direct
```

Contoh:

```text
CaseModule publishes:
exchange = case.events
routing_key = case.opened

ReviewModule queue:
review-case-opened.q
binding = case.opened

AuditModule queue:
audit-case-events.q
binding = case.#
```

Prinsip:

- exchange mengikuti module/domain owner;
- queue mengikuti consumer capability;
- routing key memakai bahasa domain;
- jangan publish Java internal event class;
- jangan jadikan RabbitMQ pengganti function call jika tidak perlu async boundary.

---

## 18. Routing Topology untuk Microservices

Dalam microservices, exchange routing membantu mengurangi coupling antar service.

Contoh domain services:

```text
case-service
review-service
evidence-service
enforcement-service
notification-service
audit-service
```

Exchange:

```text
case.events
evidence.events
review.events
enforcement.events
notification.commands
```

Queues:

```text
review-case-events.q
binding case.events: case.opened, case.reopened

enforcement-case-events.q
binding case.events: case.review.completed

notification-case-events.q
binding case.events: case.escalated.*

audit-case-events.q
binding case.events: case.#
```

Producer service tidak tahu queue consumer. Consumer service mendeklarasikan queue dan binding yang ia butuhkan.

---

## 19. Ownership Model

Topology harus punya ownership yang jelas.

### 19.1 Exchange Owner

Exchange biasanya dimiliki oleh domain producer atau platform messaging team.

Contoh:

```text
case.events owned by case-service/domain-case team
case.commands owned by case-service/domain-case team
```

### 19.2 Queue Owner

Queue dimiliki oleh consumer.

```text
review-case-opened.q owned by review-service
notification-escalation.q owned by notification-service
```

### 19.3 Binding Owner

Binding sering menjadi contract antara producer domain dan consumer. Dalam praktik:

- consumer tahu event apa yang dibutuhkan;
- producer/domain owner menjamin routing key contract;
- platform/IaC menyimpan topology declaration.

### 19.4 Kenapa Ownership Penting

Tanpa ownership:

- queue lama tidak dihapus;
- binding liar menumpuk;
- publisher tidak tahu siapa consumer;
- breaking change sulit dikendalikan;
- incident debugging lambat.

---

## 20. Declarative Topology

Topology sebaiknya dideklarasikan, bukan dibuat manual ad-hoc di UI.

Bentuk deklarasi bisa:

- Spring AMQP declarables;
- Terraform/provider;
- RabbitMQ definitions JSON;
- Helm chart/Kubernetes operator;
- deployment script;
- internal platform tooling.

### 20.1 Prinsip Declarative Topology

- Topology adalah source-controlled.
- Exchange/queue/binding punya owner.
- Perubahan topology melalui review.
- Production dan staging tidak drift terlalu jauh.
- Naming convention divalidasi.
- Removal punya migration plan.

### 20.2 Topology sebagai API

Treat topology like API.

Breaking changes:

- rename exchange;
- remove routing key;
- change exchange type;
- remove binding yang consumer butuhkan;
- mengubah semantics routing key;
- mengubah queue type tanpa analisis.

Non-breaking changes:

- menambah binding baru;
- menambah queue consumer baru;
- menambah routing key baru jika consumer lama tidak rusak;
- menambah alternate exchange;
- menambah observability queue.

---

## 21. Durability dan Routing

Exchange, queue, dan message durability adalah hal berbeda.

Untuk routing topology:

```text
Durable exchange survives broker restart.
Durable queue survives broker restart.
Persistent message can be recovered if stored durably.
```

Jika exchange non-durable hilang setelah restart, producer bisa publish ke exchange yang tidak ada dan gagal.

Jika queue non-durable hilang, binding juga hilang.

Production default:

```text
Durable exchange: yes
Durable queue: yes
Persistent messages: yes, jika message penting
```

Tetapi durability bukan sinonim high availability. Replication queue type dibahas di part berikutnya.

---

## 22. Unroutable Message Handling Strategy

Setiap exchange penting harus punya strategi untuk unroutable message.

### 22.1 Pilihan Strategy

1. Ignore unroutable.
2. Publisher uses `mandatory=true` and handles return.
3. Configure alternate exchange.
4. Combine mandatory, returns, publisher confirms, and alternate exchange.
5. Use monitoring around unroutable queue.

### 22.2 Production Recommendation

Untuk critical domain events:

```text
- durable topic exchange
- alternate exchange
- unroutable queue
- publisher confirms
- return callback if mandatory used
- alert on unroutable queue depth > 0
```

### 22.3 Why It Matters

Unroutable message bisa berarti:

- producer bug;
- routing key typo;
- topology belum dideploy;
- binding terhapus;
- event baru belum dikenali;
- deployment order salah;
- environment drift.

Dalam sistem regulasi, “message silently dropped” biasanya tidak defensible.

---

## 23. Binding Explosion dan Cardinality Control

RabbitMQ bisa menangani banyak binding, tetapi desain tetap harus memperhatikan cardinality.

### 23.1 Binding Explosion Example

```text
queue-per-tenant
binding-per-tenant-event
binding-per-user
binding-per-case
```

Ini bisa menghasilkan ribuan hingga jutaan binding.

### 23.2 Kenapa Berbahaya

- topology berat dikelola;
- startup declaration lambat;
- management UI sulit digunakan;
- memory overhead;
- debugging sulit;
- lifecycle cleanup risk;
- permission model membengkak.

### 23.3 Alternatif

- route by coarse domain/category;
- filter tenant di consumer;
- separate vhost untuk tenant besar;
- use stream + consumer-side filtering;
- use application-level subscription store;
- create queues only for durable workload, not every entity;
- expire temporary queues.

---

## 24. Temporary, Exclusive, and Auto-Delete Routing

Tidak semua queue/topology harus permanen.

Untuk temporary subscribers, RabbitMQ mendukung queue yang:

- exclusive;
- auto-delete;
- server-named;
- non-durable.

Contoh use case:

- temporary reply queue;
- websocket session fanout;
- short-lived diagnostic consumer;
- temporary notification subscription;
- integration test queue.

Tetapi jangan gunakan temporary queues untuk critical workload yang harus survive restart.

---

## 25. Routing untuk Priority dan SLA

Routing bisa dipakai untuk memisahkan workload berdasarkan SLA.

Contoh:

```text
case.commands direct

case.evaluate.normal   -> case-evaluate-normal.q
case.evaluate.high     -> case-evaluate-high.q
case.evaluate.critical -> case-evaluate-critical.q
```

Atau topic:

```text
case.evaluate.normal
case.evaluate.high
case.evaluate.critical
```

Binding:

```text
case.evaluate.critical -> critical-worker.q
case.evaluate.*        -> normal-worker.q
```

Hati-hati: jika satu message critical juga masuk normal-worker karena binding luas, itu mungkin tidak diinginkan. Desain binding harus eksplisit.

Alternatif lain adalah priority queue, tetapi priority queue punya trade-off performa dan operational. Routing ke queue berbeda sering lebih observable dan controllable.

---

## 26. Routing untuk Retry dan DLQ

Retry topology sering memakai exchange routing.

Contoh umum:

```text
case.commands
  -> rule-evaluator.q
      on failure -> case.commands.dlx
          -> rule-evaluator.retry.5s.q
              TTL expired -> case.commands
```

Atau:

```text
case.commands.dlx direct

routing key case.evaluate-rules.failed
  -> rule-evaluator.dlq
```

Design decision:

- apakah retry routing key sama dengan original?
- apakah DLQ per consumer atau per domain?
- apakah DLX exchange shared atau per workload?
- apakah poison message masuk parking lot?

Part retry akan membahas detailnya. Untuk sekarang, pahami bahwa exchange routing bukan hanya untuk happy path, tetapi juga failure path.

---

## 27. Routing dan Security

Routing topology berhubungan dengan permission.

RabbitMQ permission biasanya memisahkan:

- configure;
- write;
- read.

Producer biasanya butuh write ke exchange tertentu, bukan read queue.

Consumer biasanya butuh read dari queue miliknya dan mungkin configure queue/binding jika topology dideklarasikan oleh aplikasi.

Contoh prinsip:

```text
case-service:
  write: case.events, case.commands
  configure: case.* if owns topology

notification-service:
  read: notification-*.q
  write: notification.commands, notification.events
```

Jangan memberikan semua service akses wildcard ke semua exchange/queue jika tidak perlu.

Routing topology yang jelas memudahkan least privilege.

---

## 28. Routing dan Observability

Topology yang baik mudah diamati.

Pertanyaan observability:

- Exchange mana menerima publish rate tinggi?
- Routing key apa yang dipakai?
- Queue mana menerima message dari exchange mana?
- Queue depth meningkat karena routing apa?
- Ada unroutable message?
- Ada binding yang terlalu broad?
- Ada queue tanpa consumer?
- Ada queue yang tidak pernah menerima message?
- Ada duplicate delivery path yang tidak disengaja?

RabbitMQ tidak selalu menyimpan semua historical routing decision secara detail. Karena itu, kamu butuh:

- naming convention;
- topology documentation;
- publisher logging dengan routing key;
- correlation id;
- message id;
- tracing headers;
- metrics per queue;
- alert pada unroutable/DLQ.

---

## 29. Worked Example: Case Management Routing Topology

Kita desain topology untuk regulatory case management.

### 29.1 Domain Events

Events:

```text
case.opened
case.updated
case.escalated.normal
case.escalated.critical
case.closed
evidence.submitted
evidence.verified
review.assigned
review.completed
enforcement.action.proposed
enforcement.action.approved
enforcement.action.rejected
```

### 29.2 Exchanges

```text
case.events          topic
evidence.events      topic
review.events        topic
enforcement.events   topic
notification.commands direct
audit.unroutable     fanout
```

### 29.3 Queues and Bindings

Audit service:

```text
audit-case.q
  bind case.events: case.#

audit-evidence.q
  bind evidence.events: evidence.#

audit-review.q
  bind review.events: review.#

audit-enforcement.q
  bind enforcement.events: enforcement.#
```

Notification service:

```text
notification-case-escalation.q
  bind case.events: case.escalated.*

notification-enforcement-action.q
  bind enforcement.events: enforcement.action.*
```

Search indexer:

```text
case-search-indexer.q
  bind case.events: case.opened
  bind case.events: case.updated
  bind case.events: case.closed
```

Workflow service:

```text
workflow-review-completed.q
  bind review.events: review.completed

workflow-critical-escalation.q
  bind case.events: case.escalated.critical
```

Unknown/unroutable:

```text
case.events x-alternate-exchange = audit.unroutable
audit-unroutable.q bind audit.unroutable
```

### 29.4 Why This Design Works

- Producers publish to domain exchanges.
- Consumers own their queue names.
- Event routing keys are semantic.
- Audit can subscribe broadly without forcing every consumer to receive all events.
- Critical escalation has explicit path.
- Unroutable events are captured.
- New consumers can be added via new queues/bindings.
- Routing is explainable in incident review.

---

## 30. Worked Example: Command Routing Topology

Commands:

```text
case.evaluate-rules
case.assign-reviewer
case.send-notice
case.archive
```

Exchange:

```text
case.commands direct
```

Queues:

```text
rule-evaluator.q
  bind case.commands: case.evaluate-rules

reviewer-assignment.q
  bind case.commands: case.assign-reviewer

notice-dispatcher.q
  bind case.commands: case.send-notice

case-archival.q
  bind case.commands: case.archive
```

### 30.1 Why Direct Exchange Fits

Command routing is explicit. Each command type has a capability owner.

A command is usually not broadcast to arbitrary subscribers. If multiple services need to observe that a command was requested, publish an event separately:

```text
case.command.requested
```

But do not confuse command dispatch with event notification.

### 30.2 Command Routing Failure Questions

For each command queue:

- What happens if no consumer is running?
- Is queue durable?
- Is message persistent?
- Are publisher confirms enabled?
- Is command idempotent?
- What is retry path?
- What is DLQ path?
- Who owns stuck command remediation?

Routing only gets message to the correct queue. It does not solve processing correctness.

---

## 31. Java Client Examples

### 31.1 Declare Topic Exchange and Queues

```java
import com.rabbitmq.client.BuiltinExchangeType;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

public final class CaseEventTopology {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setUsername("guest");
        factory.setPassword("guest");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            String exchange = "case.events";

            channel.exchangeDeclare(
                    exchange,
                    BuiltinExchangeType.TOPIC,
                    true // durable
            );

            channel.queueDeclare(
                    "case-audit.q",
                    true,  // durable
                    false, // exclusive
                    false, // autoDelete
                    null
            );

            channel.queueBind("case-audit.q", exchange, "case.#");

            channel.queueDeclare("case-escalation-monitor.q", true, false, false, null);
            channel.queueBind("case-escalation-monitor.q", exchange, "case.escalated.*");

            channel.queueDeclare("case-critical-monitor.q", true, false, false, null);
            channel.queueBind("case-critical-monitor.q", exchange, "case.*.critical");
        }
    }
}
```

### 31.2 Publish Event

```java
import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public final class CaseEventPublisher {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            String exchange = "case.events";
            String routingKey = "case.escalated.critical";

            String eventId = UUID.randomUUID().toString();
            String payload = """
                    {
                      "eventId": "%s",
                      "eventType": "case.escalated",
                      "caseId": "CASE-2026-0001",
                      "priority": "CRITICAL",
                      "occurredAt": "%s"
                    }
                    """.formatted(eventId, Instant.now());

            AMQP.BasicProperties properties = new AMQP.BasicProperties.Builder()
                    .contentType("application/json")
                    .deliveryMode(2) // persistent
                    .messageId(eventId)
                    .correlationId(eventId)
                    .headers(Map.of(
                            "schema", "case.escalated.v1",
                            "producer", "case-service"
                    ))
                    .build();

            channel.basicPublish(
                    exchange,
                    routingKey,
                    true, // mandatory
                    properties,
                    payload.getBytes(StandardCharsets.UTF_8)
            );
        }
    }
}
```

Catatan: contoh ini belum memakai publisher confirms dan return listener secara lengkap. Itu sudah dibahas di part publisher reliability nanti. Di sini fokusnya topology dan routing.

---

## 32. Spring AMQP Topology Example

```java
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class CaseEventTopologyConfig {

    @Bean
    TopicExchange caseEventsExchange() {
        return new TopicExchange("case.events", true, false);
    }

    @Bean
    Queue caseAuditQueue() {
        return new Queue("case-audit.q", true);
    }

    @Bean
    Binding caseAuditBinding(Queue caseAuditQueue, TopicExchange caseEventsExchange) {
        return BindingBuilder
                .bind(caseAuditQueue)
                .to(caseEventsExchange)
                .with("case.#");
    }

    @Bean
    Queue caseEscalationMonitorQueue() {
        return new Queue("case-escalation-monitor.q", true);
    }

    @Bean
    Binding caseEscalationMonitorBinding(
            Queue caseEscalationMonitorQueue,
            TopicExchange caseEventsExchange
    ) {
        return BindingBuilder
                .bind(caseEscalationMonitorQueue)
                .to(caseEventsExchange)
                .with("case.escalated.*");
    }
}
```

Dalam production, pertimbangkan apakah aplikasi consumer boleh mendeklarasikan exchange yang dimiliki producer. Ada beberapa model:

1. Semua topology dideklarasikan terpusat via IaC.
2. Producer owner mendeklarasikan exchange.
3. Consumer owner mendeklarasikan queue dan binding.
4. Platform team mengelola semuanya.

Yang penting: jangan biarkan topology creation menjadi tidak terkontrol.

---

## 33. Debugging Routing

Saat message tidak sampai ke consumer, jangan langsung menyalahkan consumer code. Routing path harus dicek.

### 33.1 Checklist

1. Apakah producer publish ke exchange yang benar?
2. Apakah exchange ada di vhost yang benar?
3. Apakah exchange type sesuai asumsi?
4. Apakah routing key benar?
5. Apakah queue ada?
6. Apakah binding ada?
7. Apakah binding key/pattern match routing key?
8. Apakah message unroutable?
9. Apakah alternate exchange menangkapnya?
10. Apakah queue punya consumer aktif?
11. Apakah message berada di ready atau unacked?
12. Apakah consumer ack/nack menyebabkan redelivery?
13. Apakah permission write/read benar?
14. Apakah producer menggunakan mandatory dan return callback?
15. Apakah ada typo environment/stage?

### 33.2 Debugging Topic Pattern

Routing key:

```text
case.escalated.critical
```

Bindings:

```text
case.*           no, because only matches exactly two words
case.*.*         yes
case.#           yes
*.escalated.*    yes
#.critical       yes
case.escalated   no
```

Banyak bug RabbitMQ berasal dari salah memahami `*` dan `#`.

---

## 34. Common Design Smells

### 34.1 Producer Knows Queue Names

Jika producer publish ke default exchange dengan queue name, producer terlalu tahu consumer topology.

### 34.2 One Global Topic Exchange

Satu exchange global untuk semua domain terlihat sederhana, tetapi ownership dan permission menjadi kabur.

### 34.3 Routing Key Contains Implementation Detail

```text
com.mycompany.service.internal.CaseOpenedEventV2
```

Ini coupling ke Java implementation.

### 34.4 Too Many Wildcards

Jika semua consumer bind `#`, kamu sebenarnya membuat fanout exchange dengan cara lebih membingungkan.

### 34.5 No Unroutable Strategy

Critical publish tanpa mandatory, return handling, atau alternate exchange adalah desain yang rawan silent loss.

### 34.6 Queue per Event Type by Default

RabbitMQ queue seharusnya merepresentasikan consumer workload, bukan selalu event type.

### 34.7 Headers Exchange for Everything

Headers exchange powerful, tetapi jika semua routing menjadi metadata matrix, topology sulit dipahami.

### 34.8 No Topology Ownership

Exchange/queue/binding tanpa owner akan menjadi sampah operasional.

---

## 35. Routing Design Review Template

Gunakan template ini sebelum menyetujui topology baru.

```markdown
# RabbitMQ Routing Design Review

## Purpose
What business/system capability does this topology support?

## Producer(s)
Which service publishes messages?

## Exchange
Name:
Type:
Durable:
Owner:
Alternate exchange:

## Routing Key Taxonomy
Pattern:
Examples:
What each segment means:
High-cardinality segment? yes/no
Sensitive data risk? yes/no

## Queue(s)
Name:
Owner:
Consumer service:
Queue type:
Durable:
Expected rate:
Expected backlog tolerance:

## Binding(s)
Exchange:
Queue:
Binding key/arguments:
Expected matched routing keys:

## Failure Handling
Unroutable strategy:
DLQ strategy:
Retry strategy:
Poison message strategy:

## Observability
Metrics:
Alerts:
Dashboard:
Trace/correlation headers:

## Security
Publisher permissions:
Consumer permissions:
Vhost:

## Evolution
How to add a new event type?
How to add a new consumer?
What changes are breaking?
What is the migration strategy?
```

---

## 36. Decision Matrix

| Situation | Recommended Exchange | Reason |
|---|---|---|
| One command type to one worker capability | direct | exact semantic dispatch |
| Command type may have multiple independent handlers | direct or topic | exact key can still multicast |
| Every subscriber must receive all messages | fanout | explicit broadcast |
| Domain events with category subscription | topic | flexible pattern matching |
| Audit wants all events in a domain | topic binding `domain.#` | clear broad subscription |
| Routing based on multiple metadata fields | headers | attribute matching |
| Temporary direct-to-queue utility | default exchange | acceptable for simple/internal use |
| Critical messages may be unroutable | alternate exchange + mandatory | safer failure path |
| External partner integration | dedicated integration exchange | boundary isolation |
| High-cardinality per-user routing | usually avoid | topology explosion risk |

---

## 37. Top 1% Mental Models

### 37.1 Exchange Is Policy, Queue Is Workload

Exchange captures routing policy. Queue captures consumer workload and delivery state.

If queue names appear in producer code, ask why.

### 37.2 Routing Key Is a Small Public Language

Routing key is not a random string. It is a small language shared by producers, consumers, operators, and incident responders.

### 37.3 Bindings Are Subscriptions with Operational Cost

Every binding expresses interest. Too many broad bindings create noise. Too many narrow bindings create management cost.

### 37.4 Topic Exchange Is Powerful Because It Is Limited

Topic matching is intentionally simple. Do not turn it into a query engine.

### 37.5 Unroutable Is a First-Class Failure Mode

A message can be accepted by producer code and still not reach any queue if routing is wrong. Production designs must make this observable.

### 37.6 Topology Evolves Like API

Exchange names, routing keys, queue ownership, and binding semantics need compatibility thinking.

---

## 38. Exercises

### Exercise 1 — Design Routing Key Taxonomy

Design routing keys for:

- case opened;
- case escalated;
- evidence submitted;
- review assigned;
- enforcement action approved;
- enforcement action rejected.

Then define bindings for:

- audit service;
- notification service;
- search indexer;
- escalation monitor;
- enforcement workflow service.

### Exercise 2 — Find Anti-Patterns

Given this topology:

```text
Exchange: app.events topic

Routing keys:
prod.case.created.high.john@example.com
caseClosed
payment.failed
high.review.assigned
serviceA.queue

Bindings:
# -> notification.q
# -> audit.q
# -> search.q
```

Identify at least 8 problems.

### Exercise 3 — Unroutable Strategy

You have a `case.events` topic exchange. Producer publishes `case.reopened`, but no queue receives it. Design a safe strategy to detect and preserve the message.

### Exercise 4 — Direct vs Topic

For each scenario, choose direct or topic and explain why:

1. `generate-invoice` command.
2. `case.opened`, `case.closed`, `case.escalated` events.
3. `send-email`, `send-sms`, `send-push` command dispatch.
4. Critical event monitor across multiple domains.
5. Audit of all case events.

---

## 39. Part 03 Summary

Exchange routing adalah salah satu pembeda utama RabbitMQ.

Ringkasan inti:

- Producer publish ke exchange, bukan idealnya ke queue langsung.
- Exchange menentukan routing berdasarkan exchange type, routing key, bindings, dan headers.
- Direct exchange cocok untuk exact semantic dispatch.
- Fanout exchange cocok untuk broadcast murni.
- Topic exchange cocok untuk domain event routing dan subscription pattern.
- Headers exchange cocok untuk attribute-based routing.
- Default exchange berguna, tetapi cenderung menciptakan producer-to-queue coupling.
- Routing key adalah contract kecil yang harus semantic, konsisten, rendah cardinality, dan aman untuk observability.
- Queue name sebaiknya merepresentasikan consumer workload.
- Alternate exchange dan mandatory publish penting untuk menangani unroutable messages.
- Topology harus punya ownership, declaration, review, dan observability.

Jika part 02 menjelaskan bahasa AMQP, part 03 menjelaskan bagaimana bahasa itu dipakai untuk membangun routing architecture yang sehat.

---

## 40. Referensi

- RabbitMQ Documentation — Exchanges: https://www.rabbitmq.com/docs/exchanges
- RabbitMQ Documentation — AMQP 0-9-1 Model Explained: https://www.rabbitmq.com/tutorials/amqp-concepts
- RabbitMQ Documentation — Publishers and Unroutable Messages: https://www.rabbitmq.com/docs/publishers
- RabbitMQ Documentation — Alternate Exchanges: https://www.rabbitmq.com/docs/ae
- RabbitMQ Tutorial — Topic Exchange: https://www.rabbitmq.com/tutorials/tutorial-five-python

---

## 41. Status Seri

Part selesai:

- Part 00 — Orientation, Mental Model, dan Scope RabbitMQ Modern
- Part 01 — Messaging Fundamentals yang Spesifik RabbitMQ
- Part 02 — AMQP 0-9-1 Deep Dive
- Part 03 — Exchange Routing Mastery

Seri belum selesai.

Berikutnya:

- Part 04 — Queue Semantics: Classic, Quorum, Stream


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-02.md">⬅️ Part 02 — AMQP 0-9-1 Deep Dive: Bahasa Internal RabbitMQ</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-04.md">Part 04 — Queue Semantics: Classic, Quorum, Stream ➡️</a>
</div>
