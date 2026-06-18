# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-020

# Part 20 — JMS in Jakarta EE Runtime: MDB, Resource Adapter, JCA, ActivationSpec, dan Container-Managed Messaging

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Target: Java 8 sampai Java 25, JMS 1.1/2.0, Jakarta Messaging 3.x, Jakarta EE runtime, enterprise-grade asynchronous processing  
> Posisi part: Part 20 dari 35  
> Prasyarat langsung: Part 0–19, terutama domain model JMS, ack, transaksi, reliability, provider differences, dan broker architecture.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah melihat JMS/Jakarta Messaging sebagai API dan broker sebagai runtime. Part ini menggeser fokus ke **Jakarta EE container**.

Di standalone Java atau Spring Boot, aplikasi biasanya membuat atau memakai `ConnectionFactory`, membuat `JMSContext`/`Session`, lalu mengatur lifecycle listener sendiri. Di Jakarta EE, sebagian besar tanggung jawab itu bisa dipindahkan ke container:

- container membuat dan mengelola instance consumer,
- container menghubungkan consumer ke broker melalui resource adapter,
- container mengatur transaksi,
- container mengatur concurrency/pooling,
- container melakukan lifecycle start/stop saat deployment,
- container menginjeksi resource via JNDI/CDI,
- container menghubungkan JMS dengan Jakarta Transactions/JTA,
- container menyediakan model Message-Driven Bean atau MDB.

Target pemahaman part ini:

1. Memahami **mengapa MDB ada** dan kapan ia lebih cocok daripada listener manual.
2. Memahami hubungan antara **Jakarta Messaging**, **Jakarta Enterprise Beans**, **Jakarta Connectors/JCA**, dan **Jakarta Transactions**.
3. Membedakan resource statis seperti `ConnectionFactory`/`Queue`/`Topic` dari activation endpoint seperti MDB.
4. Memahami `ActivationSpec` sebagai konfigurasi consumer container-managed.
5. Memahami bagaimana ack, transaction, redelivery, pooling, dan concurrency berubah saat listener dijalankan oleh container.
6. Memahami failure mode khas app server runtime: duplicate delivery, rollback loop, stuck pool, classloader mismatch, namespace mismatch `javax.jms` vs `jakarta.jms`, dan shutdown/redeployment issue.
7. Memiliki checklist desain untuk JMS di Jakarta EE production.

Part ini bukan mengulang Jakarta EE dasar. Kita akan fokus pada **messaging runtime engineering**.

---

## 2. Mental Model Utama

### 2.1 JMS standalone adalah client-managed messaging

Dalam model standalone, aplikasi biasanya melakukan ini sendiri:

```java
ConnectionFactory cf = ...;
Queue queue = ...;

try (JMSContext context = cf.createContext(JMSContext.SESSION_TRANSACTED)) {
    JMSConsumer consumer = context.createConsumer(queue);
    Message message = consumer.receive(5000);
    // process
    context.commit();
}
```

Aplikasi bertanggung jawab terhadap:

- membuat context/session,
- membuat consumer,
- memulai connection jika memakai classic API,
- memproses message,
- commit/rollback,
- reconnect,
- concurrency,
- shutdown,
- error loop,
- resource cleanup.

Model ini memberi kontrol eksplisit, tetapi juga membuat aplikasi harus mengurus banyak detail operasional.

### 2.2 Jakarta EE MDB adalah container-managed message endpoint

Dalam model MDB, developer biasanya menulis business handler:

```java
import jakarta.ejb.ActivationConfigProperty;
import jakarta.ejb.MessageDriven;
import jakarta.jms.Message;
import jakarta.jms.MessageListener;

@MessageDriven(activationConfig = {
        @ActivationConfigProperty(
                propertyName = "destinationLookup",
                propertyValue = "jms/queue/CaseCommandQueue"),
        @ActivationConfigProperty(
                propertyName = "destinationType",
                propertyValue = "jakarta.jms.Queue")
})
public class CaseCommandListener implements MessageListener {

    @Override
    public void onMessage(Message message) {
        // process message
    }
}
```

Yang membuat consumer, menghubungkan ke broker, mengatur pool, transaction enlistment, ack, dan lifecycle bukan lagi kode aplikasi, tetapi **Jakarta EE container**.

Mental modelnya:

```text
Broker
  |
  | JMS/Jakarta Messaging protocol/client provider
  v
Resource Adapter / Messaging Provider Integration
  |
  | Endpoint activation
  v
Jakarta EE Container
  |
  | MDB pool + transaction + injection + interceptors
  v
MessageDrivenBean.onMessage(...)
```

MDB bukan “queue consumer biasa yang kebetulan memakai annotation”. MDB adalah **server-side message endpoint yang dikendalikan container**.

### 2.3 Resource adapter adalah jembatan antara container dan provider

Jakarta EE container tidak selalu tahu detail semua broker. Ia memakai mekanisme integrasi bernama **Jakarta Connectors**, historisnya JCA.

Resource adapter menyediakan jembatan antara application server dan external enterprise information system, termasuk message broker. Untuk messaging, resource adapter biasanya menyediakan:

- managed connection factory,
- connection pooling,
- transaction enlistment,
- inbound endpoint activation,
- activation spec,
- message listener dispatch,
- XA integration bila tersedia,
- credential handling,
- recovery support.

Jadi dalam Jakarta EE, ada dua arah integrasi:

```text
Outbound messaging:
Application code -> ConnectionFactory -> Broker

Inbound messaging:
Broker -> Resource Adapter -> MDB endpoint -> Application code
```

Outbound biasanya dipakai untuk send. Inbound biasanya dipakai untuk receive asynchronous via MDB.

---

## 3. Istilah Penting

### 3.1 Jakarta Messaging

Jakarta Messaging adalah API standard untuk messaging di Jakarta EE. Ini adalah evolusi dari JMS.

Istilah modern:

- JMS lama: `javax.jms`
- Jakarta Messaging modern: `jakarta.jms`

Secara konsep mirip, tetapi package namespace berbeda. Ini bukan sekadar rename kosmetik; di runtime app server, namespace mismatch dapat membuat MDB gagal aktif.

### 3.2 MDB / Message-Driven Bean

MDB adalah enterprise bean yang menerima message secara asinkron. Ia tidak dipanggil langsung oleh client seperti stateless session bean. Ia dipanggil oleh container ketika message tersedia.

Ciri penting:

- tidak punya client-visible business interface,
- container membuat instance,
- container memanggil `onMessage`,
- container bisa membuat pool instance,
- container bisa mengelola transaksi,
- container bisa melakukan dependency injection,
- container bisa menggunakan interceptor,
- container bisa mengatur security context tertentu tergantung server.

### 3.3 Resource Adapter

Resource adapter adalah modul integrasi provider. Dalam konteks JMS/Jakarta Messaging, resource adapter menghubungkan app server dengan broker.

Bentuk deployment historisnya sering berupa `.rar` file, misalnya:

```text
wmq.jmsra.rar
activemq-rar.rar
generic-jms-ra.rar
```

Pada beberapa server modern, resource adapter dapat tertanam atau dikonfigurasi sebagai feature server.

### 3.4 ActivationSpec

`ActivationSpec` adalah konfigurasi inbound endpoint. Secara sederhana, ia menjawab pertanyaan:

> MDB ini harus mendengarkan destination apa, dengan selector apa, durable subscription apa, concurrency seperti apa, acknowledgment/transaction behavior seperti apa, memakai connection factory/resource adapter yang mana?

Developer sering melihatnya sebagai `@ActivationConfigProperty`.

Contoh:

```java
@MessageDriven(activationConfig = {
    @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/queue/CaseCommandQueue"),
    @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue"),
    @ActivationConfigProperty(propertyName = "messageSelector", propertyValue = "tenant = 'CEA'"),
    @ActivationConfigProperty(propertyName = "acknowledgeMode", propertyValue = "Auto-acknowledge")
})
public class CaseCommandListener implements MessageListener {
    public void onMessage(Message message) {
        // handle
    }
}
```

Namun property names sering provider/server-specific. Jangan menganggap semua server menerima property yang sama.

### 3.5 Administered Objects

JMS/Jakarta Messaging mengenal administered objects, misalnya:

- `ConnectionFactory`
- `Queue`
- `Topic`

Objek ini biasanya dikonfigurasi di server/broker/admin console lalu di-lookup via JNDI.

Contoh injection:

```java
import jakarta.annotation.Resource;
import jakarta.jms.ConnectionFactory;
import jakarta.jms.Queue;

public class CaseMessageSender {

    @Resource(lookup = "jms/CaseConnectionFactory")
    private ConnectionFactory connectionFactory;

    @Resource(lookup = "jms/queue/CaseCommandQueue")
    private Queue caseCommandQueue;
}
```

---

## 4. Mengapa MDB Ada?

MDB muncul karena asynchronous consumer dalam enterprise server memiliki kebutuhan yang lebih berat daripada sekadar `while(true) receive()`.

### 4.1 Problem listener manual dalam application server

Bayangkan developer membuat thread sendiri di servlet:

```java
@PostConstruct
public void start() {
    new Thread(() -> {
        while (true) {
            Message m = consumer.receive();
            process(m);
        }
    }).start();
}
```

Ini terlihat sederhana, tetapi problemnya banyak:

1. Thread dibuat di luar kontrol container.
2. Shutdown/redeploy bisa meninggalkan thread zombie.
3. Transaction context tidak otomatis benar.
4. Security context tidak jelas.
5. Connection lifecycle tidak terintegrasi dengan server.
6. Error handling bisa membuat infinite loop.
7. Scaling tidak terkendali.
8. Monitoring tidak standar.
9. Resource leak sulit dilacak.
10. Container tidak bisa melakukan graceful undeploy.

MDB menyelesaikan ini dengan menjadikan message consumer sebagai managed component.

### 4.2 MDB sebagai asynchronous equivalent dari endpoint server-side

Secara arsitektural:

```text
HTTP endpoint:
Client HTTP request -> Servlet/JAX-RS resource -> service method

JMS endpoint:
Broker message -> MDB -> service method
```

Perbedaannya:

| Aspek | HTTP/JAX-RS | JMS/MDB |
|---|---|---|
| Trigger | request langsung | message tersedia |
| Coupling waktu | caller menunggu | caller tidak harus menunggu |
| Retry | biasanya client/gateway | broker/container redelivery |
| Backpressure | HTTP status/timeout | queue depth/consumer flow |
| Transaction boundary | per request | per message delivery |
| Failure signal | response code | ack/rollback/DLQ |

MDB adalah endpoint, tetapi endpoint-nya bukan URL. Endpoint-nya adalah destination + activation configuration.

---

## 5. Jakarta EE Messaging Runtime: Big Picture

### 5.1 Komponen besar

```text
+--------------------------------------------------------------+
| Jakarta EE Application Server                                |
|                                                              |
|  +-------------------+      +-----------------------------+  |
|  | Application Code  |      | Container Services          |  |
|  |                   |      | - CDI / injection           |  |
|  | - MDB             |<-----| - EJB lifecycle             |  |
|  | - Stateless Bean  |      | - transaction manager       |  |
|  | - JAX-RS          |      | - thread pool               |  |
|  | - Services        |      | - security                  |  |
|  +-------------------+      +-----------------------------+  |
|             ^                         ^                       |
|             |                         |                       |
|             v                         v                       |
|  +---------------------------------------------------------+  |
|  | Messaging Provider / Resource Adapter                   |  |
|  | - outbound connection factory                           |  |
|  | - inbound activation                                    |  |
|  | - XA enlistment                                         |  |
|  | - reconnect/recovery                                    |  |
|  +---------------------------------------------------------+  |
+-------------------------------|------------------------------+
                                |
                                v
                          Message Broker
```

### 5.2 Apa yang dimiliki application server?

Application server biasanya mengelola:

- lifecycle aplikasi,
- injection resource,
- thread pool,
- transaction manager,
- EJB/MDB pool,
- JNDI namespace,
- resource adapter deployment,
- security realm,
- metrics/logging integration,
- deployment descriptors.

### 5.3 Apa yang dimiliki broker?

Broker biasanya mengelola:

- destination/address/queue/topic,
- persistence,
- dispatch,
- redelivery,
- DLQ,
- paging,
- clustering,
- protocol endpoint,
- broker-level authentication/authorization,
- broker-level metrics.

### 5.4 Apa yang dimiliki aplikasi?

Aplikasi tetap bertanggung jawab atas:

- message contract,
- idempotency,
- business transaction design,
- handler correctness,
- domain validation,
- observability correlation,
- poison message classification,
- replay safety,
- state machine invariant.

Container tidak bisa menyelamatkan business handler yang tidak idempotent.

---

## 6. MDB Lifecycle

### 6.1 Deployment time

Saat aplikasi dideploy, container:

1. membaca annotation/deployment descriptor MDB,
2. menemukan resource adapter/provider terkait,
3. membuat activation endpoint,
4. menghubungkan MDB ke destination,
5. menyiapkan pool instance,
6. menyiapkan transaction boundary,
7. mulai menerima message jika aplikasi aktif.

### 6.2 Runtime delivery

Saat message tersedia:

```text
Broker dispatches message
  -> resource adapter receives message
  -> resource adapter asks container to deliver to endpoint
  -> container selects MDB instance from pool
  -> container starts transaction if configured
  -> container invokes interceptors
  -> container calls onMessage(message)
  -> application processes message
  -> container commits/rollbacks transaction
  -> resource adapter acknowledges or redelivers according to outcome
```

### 6.3 Undeploy/shutdown

Saat aplikasi distop:

1. container menghentikan activation endpoint,
2. tidak menerima message baru,
3. menunggu in-flight invocation sesuai timeout,
4. rollback message yang belum selesai jika perlu,
5. melepaskan consumer connection,
6. menghancurkan MDB instance.

Failure umum: shutdown terlalu cepat sehingga message yang sedang diproses rollback dan muncul duplicate di startup berikutnya. Ini bukan bug; ini konsekuensi at-least-once delivery.

---

## 7. Message-Driven Bean: Bentuk Kode Modern

### 7.1 Minimal MDB queue listener

```java
package com.example.caseprocessing.messaging;

import jakarta.ejb.ActivationConfigProperty;
import jakarta.ejb.MessageDriven;
import jakarta.jms.JMSException;
import jakarta.jms.Message;
import jakarta.jms.MessageListener;
import jakarta.jms.TextMessage;

@MessageDriven(activationConfig = {
        @ActivationConfigProperty(
                propertyName = "destinationLookup",
                propertyValue = "jms/queue/CaseCommandQueue"),
        @ActivationConfigProperty(
                propertyName = "destinationType",
                propertyValue = "jakarta.jms.Queue")
})
public class CaseCommandMdb implements MessageListener {

    @Override
    public void onMessage(Message message) {
        try {
            if (!(message instanceof TextMessage textMessage)) {
                throw new IllegalArgumentException("Unsupported message type: " + message.getClass().getName());
            }

            String payload = textMessage.getText();
            String correlationId = message.getJMSCorrelationID();

            // Call application service.
            // Keep business logic outside the MDB class.
            handle(payload, correlationId);

        } catch (JMSException e) {
            throw new RuntimeException("Failed to read JMS message", e);
        }
    }

    private void handle(String payload, String correlationId) {
        // Delegate to injected application service in real code.
    }
}
```

Untuk Java 8, pattern matching `instanceof` belum ada:

```java
if (!(message instanceof TextMessage)) {
    throw new IllegalArgumentException("Unsupported message type: " + message.getClass().getName());
}
TextMessage textMessage = (TextMessage) message;
```

### 7.2 Jangan menaruh business logic besar di MDB

MDB sebaiknya tipis:

```text
MDB responsibilities:
- extract message metadata,
- validate envelope basics,
- set correlation context,
- call application service,
- map exception category to rollback/non-rollback policy.

Application service responsibilities:
- parse domain payload,
- validate command/event,
- check idempotency,
- execute domain transition,
- persist result,
- emit follow-up event if needed.
```

Anti-pattern:

```java
@MessageDriven(...)
public class HugeMdb implements MessageListener {
    public void onMessage(Message message) {
        // 800 lines of parsing, SQL, branching, retry, HTTP call, email, audit, and state transition.
    }
}
```

Masalahnya:

- sulit dites,
- sulit diobservasi,
- sulit idempotent,
- exception policy bercampur dengan business logic,
- sulit replay,
- sulit migrasi keluar dari MDB jika runtime berubah.

### 7.3 MDB + CDI/EJB injection

```java
@MessageDriven(activationConfig = {
        @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/queue/CaseCommandQueue"),
        @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue")
})
public class CaseCommandMdb implements MessageListener {

    @jakarta.inject.Inject
    private CaseCommandHandler handler;

    @Override
    public void onMessage(Message message) {
        handler.handle(message);
    }
}
```

Tetapi hati-hati: dependency yang diinject harus aman untuk concurrent invocation. MDB instance bisa dipool. Beberapa instance bisa memanggil service yang sama secara paralel.

---

## 8. Transaction Boundary di MDB

### 8.1 Default mental model

Dalam banyak Jakarta EE runtime, MDB sering dijalankan dengan container-managed transaction. Pola default yang umum:

```text
message delivery starts
  -> container begins transaction
  -> onMessage executes
  -> if no runtime exception and transaction not marked rollback
       commit transaction
       ack message
     else
       rollback transaction
       message eligible for redelivery
```

Namun detail default dapat berbeda tergantung server/config. Untuk production, jangan hanya mengandalkan asumsi default. Definisikan policy secara eksplisit.

### 8.2 Container-managed transaction

Contoh eksplisit:

```java
import jakarta.ejb.TransactionAttribute;
import jakarta.ejb.TransactionAttributeType;

@MessageDriven(activationConfig = {
        @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/queue/CaseCommandQueue"),
        @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue")
})
@TransactionAttribute(TransactionAttributeType.REQUIRED)
public class CaseCommandMdb implements MessageListener {

    @Override
    public void onMessage(Message message) {
        // DB update and JMS receive may participate in one transaction if provider supports it.
    }
}
```

`REQUIRED` berarti handler berjalan dalam transaction context. Jika resource adapter dan database mendukung XA/JTA enlistment, DB operation dan JMS receive dapat berada dalam transaksi global.

### 8.3 Bean-managed transaction

Bean-managed transaction lebih jarang dan lebih berisiko jika tidak disiplin.

```java
import jakarta.annotation.Resource;
import jakarta.ejb.MessageDriven;
import jakarta.ejb.TransactionManagement;
import jakarta.ejb.TransactionManagementType;
import jakarta.transaction.UserTransaction;

@MessageDriven(activationConfig = {
        @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/queue/CaseCommandQueue"),
        @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue")
})
@TransactionManagement(TransactionManagementType.BEAN)
public class BeanManagedCaseMdb implements MessageListener {

    @Resource
    private UserTransaction userTransaction;

    @Override
    public void onMessage(jakarta.jms.Message message) {
        try {
            userTransaction.begin();
            // process
            userTransaction.commit();
        } catch (Exception e) {
            try {
                userTransaction.rollback();
            } catch (Exception rollbackFailure) {
                e.addSuppressed(rollbackFailure);
            }
            throw new RuntimeException(e);
        }
    }
}
```

Gunakan hanya jika ada alasan kuat. Container-managed transaction biasanya lebih aman dan lebih konsisten.

### 8.4 Transaction outcome dan redelivery

Prinsip utama:

```text
commit transaction -> message considered successfully consumed
rollback transaction -> message can be redelivered
```

Failure window yang harus dipahami:

| Skenario | Outcome umum |
|---|---|
| Handler throw runtime exception sebelum DB commit | transaction rollback, message redelivered |
| Handler commit DB lalu throw exception di luar transaction | bisa duplicate side effect |
| Handler catch semua exception dan tidak rollback | message dianggap sukses walaupun bisnis gagal |
| Handler melakukan HTTP call lalu rollback | HTTP side effect tidak otomatis rollback |
| Handler timeout container transaction | rollback, redelivery |

Top 1% rule:

> MDB transaction hanya mengontrol resource yang enlisted dalam transaksi. Ia tidak otomatis membuat semua side effect menjadi atomic.

---

## 9. MDB Ack Semantics

### 9.1 Ack manual biasanya bukan concern utama MDB CMT

Di standalone JMS, kita memilih `AUTO_ACKNOWLEDGE`, `CLIENT_ACKNOWLEDGE`, `DUPS_OK_ACKNOWLEDGE`, atau `SESSION_TRANSACTED`.

Di MDB, ack sering dikendalikan oleh container dan transaction outcome.

Jika MDB memakai container-managed transaction:

```text
onMessage success -> transaction commit -> message acknowledged
onMessage failure/rollback -> transaction rollback -> message redelivery
```

Jika MDB tidak transactional, acknowledge mode tertentu bisa menjadi relevan, tetapi detailnya server/provider-specific.

### 9.2 Jangan melakukan `message.acknowledge()` secara sembarang di MDB

Dalam MDB transactional, memanggil manual ack bukan desain yang sehat. Ack harus mengikuti transaction boundary container.

Anti-pattern:

```java
public void onMessage(Message message) {
    message.acknowledge();
    processDatabaseUpdate();
}
```

Jika DB update gagal setelah ack, message bisa hilang dari sudut pandang broker.

### 9.3 Business failure harus dipetakan dengan sengaja

Tidak semua exception harus menyebabkan redelivery.

Contoh permanent business validation error:

```text
Message says: approve case 123
But case 123 is already closed with final status.
```

Jika handler throw exception terus-menerus, message akan retry sampai DLQ, padahal tidak ada transient issue.

Lebih baik:

- simpan rejection/audit record,
- tandai message processed as invalid,
- commit transaction,
- jangan redeliver.

Contoh transient error:

```text
Database unavailable
Downstream identity service timeout
Broker failover during processing
Lock timeout that may recover
```

Untuk transient error:

- rollback transaction,
- biarkan broker/container redeliver,
- batasi redelivery,
- setelah threshold kirim DLQ/parking lot.

---

## 10. Activation Configuration

### 10.1 Annotation-based activation config

```java
@MessageDriven(activationConfig = {
        @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/queue/CaseCommandQueue"),
        @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue"),
        @ActivationConfigProperty(propertyName = "messageSelector", propertyValue = "eventType = 'CASE_SUBMITTED'")
})
public class CaseSubmittedMdb implements MessageListener {
    @Override
    public void onMessage(Message message) {
        // process submitted case
    }
}
```

### 10.2 Common activation properties

Property yang sering ditemui:

| Property | Makna |
|---|---|
| `destinationLookup` | JNDI lookup destination |
| `destination` | Nama destination langsung, provider-specific |
| `destinationType` | Queue atau Topic |
| `messageSelector` | selector JMS |
| `subscriptionDurability` | durable/non-durable topic subscription |
| `clientId` | client id untuk durable subscription |
| `subscriptionName` | nama durable subscription |
| `acknowledgeMode` | ack mode non-transactional |
| `connectionFactoryLookup` | JNDI connection factory |
| `maxSession` / `maxSessions` | concurrency, provider-specific |

Penting: nama property tidak sepenuhnya portable. Cek dokumentasi runtime/provider.

### 10.3 XML deployment descriptor

Di enterprise environment lama, konfigurasi sering dipindah ke descriptor agar bisa berbeda per environment.

Contoh konseptual `ejb-jar.xml`:

```xml
<ejb-jar xmlns="https://jakarta.ee/xml/ns/jakartaee"
         version="4.0">
    <enterprise-beans>
        <message-driven>
            <ejb-name>CaseCommandMdb</ejb-name>
            <ejb-class>com.example.CaseCommandMdb</ejb-class>
            <messaging-type>jakarta.jms.MessageListener</messaging-type>
            <activation-config>
                <activation-config-property>
                    <activation-config-property-name>destinationLookup</activation-config-property-name>
                    <activation-config-property-value>jms/queue/CaseCommandQueue</activation-config-property-value>
                </activation-config-property>
                <activation-config-property>
                    <activation-config-property-name>destinationType</activation-config-property-name>
                    <activation-config-property-value>jakarta.jms.Queue</activation-config-property-value>
                </activation-config-property>
            </activation-config>
        </message-driven>
    </enterprise-beans>
</ejb-jar>
```

Keuntungan descriptor:

- konfigurasi bisa dipisahkan dari kode,
- lebih mudah override per deployment,
- cocok untuk governance enterprise,
- mengurangi rebuild hanya untuk ganti destination.

Kerugian:

- lebih verbose,
- rawan drift dengan annotation,
- perlu disiplin dokumentasi.

### 10.4 Annotation vs descriptor

| Kriteria | Annotation | Descriptor |
|---|---|---|
| Developer ergonomics | tinggi | sedang/rendah |
| Environment-specific config | kurang ideal | lebih cocok |
| Governance enterprise | sedang | kuat |
| Readability di kode | tinggi | rendah |
| Runtime portability | tetap perlu cek provider | tetap perlu cek provider |

Rekomendasi praktis:

- gunakan annotation untuk local/dev dan definisi sederhana,
- gunakan server config/JNDI untuk resource fisik,
- hindari hardcode credential/broker URL di annotation,
- pertimbangkan descriptor untuk deployment regulated/multi-env.

---

## 11. Outbound Messaging di Jakarta EE

MDB adalah inbound. Tetapi aplikasi Jakarta EE juga sering perlu mengirim message.

### 11.1 Injection ConnectionFactory dan Queue

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.jms.ConnectionFactory;
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;

@ApplicationScoped
public class CaseEventPublisher {

    @Resource(lookup = "jms/CaseConnectionFactory")
    private ConnectionFactory connectionFactory;

    @Resource(lookup = "jms/queue/CaseEventQueue")
    private Queue caseEventQueue;

    public void publishCaseSubmitted(String payload) {
        try (JMSContext context = connectionFactory.createContext()) {
            context.createProducer()
                    .setProperty("eventType", "CASE_SUBMITTED")
                    .send(caseEventQueue, payload);
        }
    }
}
```

### 11.2 Jakarta EE injection of JMSContext

Beberapa runtime mendukung injection `JMSContext`.

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;

@ApplicationScoped
public class CaseEventPublisher {

    @Inject
    private JMSContext context;

    @Resource(lookup = "jms/queue/CaseEventQueue")
    private Queue queue;

    public void send(String payload) {
        context.createProducer().send(queue, payload);
    }
}
```

Namun perhatikan scope dan transaction behavior. Jangan mengasumsikan injected `JMSContext` aman dipakai lintas thread di luar aturan container.

### 11.3 Sending message dalam transaksi bisnis

Contoh service:

```java
import jakarta.ejb.Stateless;
import jakarta.ejb.TransactionAttribute;
import jakarta.ejb.TransactionAttributeType;

@Stateless
public class CaseApprovalService {

    @jakarta.inject.Inject
    private CaseRepository repository;

    @jakarta.inject.Inject
    private CaseEventPublisher publisher;

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void approve(String caseId) {
        repository.markApproved(caseId);
        publisher.publishCaseApproved(caseId);
    }
}
```

Pertanyaan penting:

> Apakah database update dan JMS send berada dalam transaksi atomik yang sama?

Jawabannya tergantung:

- apakah DB resource enlisted di JTA,
- apakah JMS connection factory XA-enabled,
- apakah publisher memakai context yang enlisted,
- apakah container config benar,
- apakah provider mendukung XA dengan benar.

Jika tidak yakin, jangan klaim atomic. Gunakan outbox pattern jika perlu reliability yang eksplisit dan audit-friendly.

---

## 12. Resource Adapter dan JCA Lebih Dalam

### 12.1 Kenapa resource adapter penting?

Tanpa resource adapter, app server hanya tahu standard API. Tetapi untuk inbound message delivery, container perlu berkoordinasi dengan broker provider:

- bagaimana membuat connection,
- bagaimana subscribe ke destination,
- bagaimana menerima message,
- bagaimana memanggil MDB endpoint,
- bagaimana menghubungkan transaksi,
- bagaimana recover setelah crash,
- bagaimana mengatur credential,
- bagaimana melakukan reconnect.

Resource adapter adalah “driver enterprise” untuk broker.

Analogi:

```text
JDBC driver         : database integration
JMS resource adapter: broker integration with app server container
```

Tetapi resource adapter lebih kompleks daripada JDBC driver karena ia juga mengatur inbound callback ke container.

### 12.2 Outbound vs inbound resource adapter function

```text
Outbound:
Application -> ConnectionFactory -> ManagedConnection -> Broker

Inbound:
Broker -> ResourceAdapter -> EndpointActivation -> MDB instance
```

Outbound lebih mirip client connection pooling.

Inbound lebih mirip server endpoint registration.

### 12.3 XA dan recovery

Jika memakai distributed transaction, resource adapter harus mendukung XA resource dan recovery.

Failure yang harus didesain:

```text
Transaction prepared DB and JMS
Server crashes before final commit
Transaction manager restarts
Recovery scans XA resources
In-doubt transaction resolved
```

Masalah umum:

- XA recovery credential tidak dikonfigurasi,
- resource adapter tidak bisa reconnect saat recovery,
- broker XA branch masih in-doubt,
- DB committed tetapi JMS tidak, atau sebaliknya karena misconfiguration,
- transaction timeout terlalu pendek untuk handler lambat.

Top 1% engineer tidak hanya bertanya “support XA?” tetapi:

1. Apakah XA recovery sudah diuji dengan crash nyata?
2. Apakah broker dan DB menunjukkan in-doubt transaction?
3. Apakah runbook recovery ada?
4. Apakah monitoring transaction timeout ada?
5. Apakah kebutuhan bisnis benar-benar memerlukan XA?

---

## 13. Concurrency dan Pooling MDB

### 13.1 MDB pool bukan sama dengan thread pool biasa

Container biasanya membuat beberapa instance MDB dan menjalankan `onMessage` secara paralel.

```text
Queue: CaseCommandQueue
  -> MDB instance #1 handles message A
  -> MDB instance #2 handles message B
  -> MDB instance #3 handles message C
```

Jumlah paralelisme dikendalikan oleh kombinasi:

- container MDB pool size,
- resource adapter session/consumer count,
- broker prefetch/credit,
- destination dispatch policy,
- transaction duration,
- downstream capacity.

### 13.2 Bahaya menaikkan concurrency tanpa capacity model

Jika concurrency dinaikkan dari 5 ke 50:

- DB connection pool bisa habis,
- lock contention naik,
- duplicate/redelivery naik karena timeout,
- downstream HTTP service collapse,
- ordering per entity rusak,
- broker dispatch lebih agresif,
- memory pressure naik karena prefetch.

Formula mental sederhana:

```text
Required consumers ≈ arrival_rate * average_processing_time
```

Jika 100 message/detik masuk dan rata-rata proses 200 ms:

```text
concurrency ≈ 100 * 0.2 = 20 concurrent handlers
```

Lalu tambahkan headroom, tetapi validasi bottleneck downstream.

### 13.3 MDB concurrency dan ordering

Queue dengan satu consumer lebih mudah menjaga order. MDB pool dengan banyak instance dapat memproses message secara paralel.

Jika business invariant memerlukan order per case:

```text
caseId=100: SUBMITTED -> VERIFIED -> APPROVED
```

Maka concurrency harus didesain per aggregate:

- message grouping jika provider mendukung,
- queue partitioning by caseId,
- single-thread processor per partition,
- optimistic state transition check,
- sequence/version number.

Jangan berharap MDB pool otomatis menjaga ordering bisnis.

### 13.4 MDB instance variable harus stateless

MDB instance dipool dan digunakan ulang.

Buruk:

```java
@MessageDriven(...)
public class BadMdb implements MessageListener {

    private String currentCaseId;

    @Override
    public void onMessage(Message message) {
        this.currentCaseId = extractCaseId(message);
        processCurrentCase();
    }
}
```

Lebih aman:

```java
@MessageDriven(...)
public class GoodMdb implements MessageListener {

    @Override
    public void onMessage(Message message) {
        String caseId = extractCaseId(message);
        process(caseId);
    }
}
```

State mutable di field MDB harus dihindari kecuali benar-benar immutable/cache thread-safe dan lifecycle-nya jelas.

---

## 14. Durable Topic Subscription dengan MDB

### 14.1 Non-durable topic MDB

Non-durable subscription hanya menerima message saat subscriber aktif.

```java
@MessageDriven(activationConfig = {
        @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/topic/CaseEvents"),
        @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Topic")
})
public class CaseEventMdb implements MessageListener {
    public void onMessage(Message message) {
        // receive while active
    }
}
```

Cocok untuk:

- telemetry low criticality,
- cache invalidation yang bisa recover dari source of truth,
- notification non-critical.

Tidak cocok untuk:

- financial posting,
- regulated state transition,
- irreversible business event.

### 14.2 Durable subscription

Durable subscription membuat broker menyimpan message untuk subscriber meskipun subscriber sedang offline.

Konfigurasi konseptual:

```java
@MessageDriven(activationConfig = {
        @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/topic/CaseEvents"),
        @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Topic"),
        @ActivationConfigProperty(propertyName = "subscriptionDurability", propertyValue = "Durable"),
        @ActivationConfigProperty(propertyName = "clientId", propertyValue = "case-audit-service"),
        @ActivationConfigProperty(propertyName = "subscriptionName", propertyValue = "case-audit-subscription")
})
public class CaseAuditEventMdb implements MessageListener {
    public void onMessage(Message message) {
        // durable event processing
    }
}
```

Provider/server property names bisa berbeda. Validasi di dokumentasi runtime.

### 14.3 Durable subscription failure mode

Durable subscription membawa state broker. Failure umum:

- `clientId` berubah setelah redeploy sehingga subscription baru terbentuk dan message lama tidak dibaca,
- dua deployment memakai `clientId`/subscription name sama sehingga konflik,
- subscription tidak pernah dihapus dan menumpuk backlog,
- selector berubah sehingga ekspektasi backlog berubah,
- durable topic dipakai sebagai event log padahal broker tidak didesain untuk long-term replay seperti Kafka.

Checklist:

- `clientId` stabil dan environment-specific,
- subscription name stabil,
- ownership jelas,
- backlog dipantau,
- unsubscribe procedure jelas,
- replay strategy jelas.

---

## 15. Error Handling di MDB

### 15.1 Runtime exception biasanya menyebabkan rollback

Contoh:

```java
@Override
public void onMessage(Message message) {
    throw new RuntimeException("DB is down");
}
```

Dengan CMT, ini umumnya menandai transaction rollback. Message dapat redeliver.

### 15.2 Checked exception tidak bisa dilempar langsung dari `onMessage`

`MessageListener.onMessage` tidak mendeklarasikan checked exception.

Maka developer sering membungkus:

```java
try {
    process(message);
} catch (RecoverableBusinessException e) {
    throw new RuntimeException(e);
}
```

Namun ini terlalu kasar. Lebih baik kategorikan:

```java
@Override
public void onMessage(Message message) {
    try {
        handler.handle(message);
    } catch (PermanentBusinessException e) {
        auditInvalidMessage(message, e);
        // commit: do not redeliver
    } catch (TransientProcessingException e) {
        throw new RuntimeException(e); // rollback: redeliver
    }
}
```

### 15.3 Mark rollback explicitly

Dalam EJB CMT, bisa memakai `MessageDrivenContext`:

```java
import jakarta.annotation.Resource;
import jakarta.ejb.MessageDrivenContext;

@MessageDriven(...)
public class CaseCommandMdb implements MessageListener {

    @Resource
    private MessageDrivenContext context;

    @Override
    public void onMessage(Message message) {
        try {
            process(message);
        } catch (TransientProcessingException e) {
            context.setRollbackOnly();
            throw new RuntimeException(e);
        }
    }
}
```

Gunakan dengan disiplin. Jangan `setRollbackOnly` lalu swallow exception tanpa observability.

### 15.4 Poison message loop

Jika message selalu gagal:

```text
delivery 1 -> fail -> rollback
redelivery 2 -> fail -> rollback
redelivery 3 -> fail -> rollback
...
```

Tanpa redelivery limit/DLQ, consumer bisa terkunci pada poison message.

MDB bukan pengganti redelivery policy broker. Konfigurasi DLQ tetap wajib.

---

## 16. MDB dan Idempotency

### 16.1 Container-managed transaction tidak menghilangkan duplicate

MDB tetap berada dalam dunia at-least-once delivery.

Duplicate bisa terjadi saat:

- server crash setelah side effect tetapi sebelum final ack,
- transaction recovery ambigu,
- broker failover,
- client reconnect,
- redelivery setelah timeout,
- operator replay dari DLQ.

### 16.2 Idempotent MDB handler

Pola umum:

```java
@Stateless
public class CaseCommandHandler {

    @jakarta.inject.Inject
    private ProcessedMessageRepository processedMessages;

    @jakarta.inject.Inject
    private CaseRepository cases;

    public void handle(CaseCommand command) {
        if (!processedMessages.tryInsert(command.messageId())) {
            return; // duplicate, already processed
        }

        cases.applyTransition(
                command.caseId(),
                command.expectedVersion(),
                command.transition());
    }
}
```

`tryInsert` harus atomic, biasanya dengan unique constraint:

```sql
CREATE TABLE processed_message (
    consumer_name VARCHAR(100) NOT NULL,
    message_id     VARCHAR(200) NOT NULL,
    processed_at   TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

### 16.3 Idempotency key jangan bergantung hanya pada JMSMessageID

`JMSMessageID` dibuat provider. Untuk business idempotency, lebih baik punya application-level message id:

```json
{
  "messageId": "01JABCDE...",
  "eventType": "CASE_APPROVED",
  "aggregateType": "CASE",
  "aggregateId": "CASE-2026-0001",
  "version": 17,
  "occurredAt": "2026-06-18T10:15:00Z",
  "payload": { }
}
```

Gunakan:

```text
consumer_name + application_message_id
```

sebagai dedup key.

---

## 17. MDB dan Observability

### 17.1 Observability minimal

Setiap MDB harus log structured event:

- destination,
- message id,
- correlation id,
- application message id,
- event/command type,
- aggregate id,
- redelivery flag,
- delivery count jika provider menyediakan,
- processing duration,
- outcome,
- exception category.

Contoh konsep:

```text
msg="jms_message_processed"
destination="jms/queue/CaseCommandQueue"
messageId="ID:broker-123"
correlationId="corr-789"
appMessageId="01J..."
caseId="CASE-2026-0001"
redelivered=true
outcome="SUCCESS_DUPLICATE_IGNORED"
durationMs=42
```

### 17.2 Correlation context

MDB sering menjadi entry point asynchronous. Ia harus membangun trace/correlation context dari message property/header.

Contoh:

```java
String correlationId = message.getJMSCorrelationID();
if (correlationId == null || correlationId.isBlank()) {
    correlationId = message.getStringProperty("correlationId");
}
```

Lalu pasang ke MDC/log context:

```java
try (var ignored = CorrelationContext.use(correlationId)) {
    handler.handle(message);
}
```

Untuk Java 8, pakai helper yang mengimplementasikan `AutoCloseable` tanpa `var`.

### 17.3 Metrics penting

Aplikasi/MDB metrics:

- handler count by outcome,
- handler latency histogram,
- failure count by category,
- duplicate ignored count,
- permanent rejection count,
- transient rollback count,
- downstream dependency latency,
- active MDB invocation count.

Broker metrics:

- queue depth,
- enqueue/dequeue rate,
- consumer count,
- redelivery count,
- DLQ depth,
- paging/storage pressure,
- connection count.

Container metrics:

- MDB pool active/idle,
- thread pool saturation,
- transaction timeout count,
- resource adapter reconnect count,
- XA recovery errors.

---

## 18. Deployment Topology di Jakarta EE

### 18.1 Embedded broker vs external broker

Beberapa runtime menyediakan embedded messaging provider. Namun production enterprise sering memakai external broker.

| Model | Kelebihan | Risiko |
|---|---|---|
| Embedded broker | mudah dev/test, sederhana | coupling app-server-broker, scaling terbatas, HA lebih rumit |
| External broker | separation of concern, HA broker dedicated | operasional lebih kompleks, network/security/config lebih banyak |

Untuk regulated/enterprise system, external broker biasanya lebih defendable.

### 18.2 Co-located MDB dengan business app

```text
WAR/EAR contains:
- REST API
- business services
- MDB consumers
```

Kelebihan:

- deployment sederhana,
- service code reusable,
- transaction lokal lebih mudah.

Risiko:

- traffic HTTP dan JMS berebut resource,
- scaling consumer berarti scaling web endpoint juga,
- rollback storm bisa mengganggu API,
- incident blast radius lebih besar.

### 18.3 Dedicated consumer application

```text
case-api.war
case-worker.war / case-worker.ear with MDB
```

Kelebihan:

- scale worker terpisah,
- failure isolation lebih baik,
- tuning thread pool lebih spesifik,
- deployment worker bisa lebih terkendali.

Risiko:

- lebih banyak deployment unit,
- shared code harus dikelola,
- contract internal harus jelas.

Rekomendasi untuk sistem besar: pisahkan API dan worker jika load/failure profile berbeda.

---

## 19. Packaging: WAR, EAR, dan Resource Definition

### 19.1 MDB dalam EJB module/EAR

Secara klasik, MDB berada di EJB module dalam EAR:

```text
case-application.ear
  case-ejb.jar
    CaseCommandMdb.class
    CaseCommandHandler.class
  case-web.war
  lib/
```

Ini umum pada Java EE/Jakarta EE enterprise server.

### 19.2 MDB dalam WAR

Banyak runtime modern mendukung EJB lite/bean dalam WAR, tetapi kemampuan MDB bergantung pada server/profile.

Jangan asumsikan semua runtime “Jakarta EE compatible” mendukung full Enterprise Beans/MDB. Cek apakah runtime menjalankan Web Profile atau Platform/full profile.

### 19.3 Resource definition annotation

Jakarta EE menyediakan annotation untuk mendefinisikan resource, tetapi di production enterprise resource biasanya dikonfigurasi di server.

Contoh konseptual:

```java
@jakarta.jms.JMSDestinationDefinition(
        name = "java:global/jms/queue/CaseCommandQueue",
        interfaceName = "jakarta.jms.Queue",
        destinationName = "CaseCommandQueue"
)
public class MessagingResources {
}
```

Gunakan dengan hati-hati. Untuk local dev, annotation resource definition membantu. Untuk production, server-managed resource memberi governance lebih baik.

---

## 20. Namespace Migration: `javax.jms` vs `jakarta.jms`

### 20.1 Kenapa ini penting di MDB?

Standalone code yang salah import biasanya gagal compile. Namun MDB runtime bisa lebih membingungkan:

- class deploy sukses,
- resource adapter masih berbasis `javax.jms`,
- app memakai `jakarta.jms.MessageListener`,
- container tidak menemukan listener type yang cocok,
- MDB gagal aktif saat deployment.

### 20.2 Matrix sederhana

| Runtime | API app | Resource adapter | Risiko |
|---|---|---|---|
| Java EE 8 | `javax.jms` | `javax.jms` | cocok |
| Jakarta EE 9+ | `jakarta.jms` | `jakarta.jms` | cocok |
| Jakarta EE 10/11 | `jakarta.jms` | old `javax.jms` RA | mismatch tinggi |
| Legacy server | `javax.jms` | new `jakarta.jms` RA | mismatch tinggi |

### 20.3 Migration rule

Saat migrasi:

1. Migrasikan source import.
2. Migrasikan dependency API.
3. Pastikan app server mendukung Jakarta namespace.
4. Pastikan resource adapter provider versi Jakarta-compatible.
5. Pastikan activation property `destinationType` memakai class name yang sesuai:
   - `javax.jms.Queue` untuk Java EE 8/JMS 2.0 runtime lama,
   - `jakarta.jms.Queue` untuk Jakarta Messaging runtime modern.
6. Test MDB activation, bukan hanya compile.

---

## 21. Server-Specific Notes

Bagian ini bukan tutorial lengkap tiap server, tetapi peta mental.

### 21.1 GlassFish / Eclipse GlassFish

GlassFish historically menjadi reference implementation untuk Jakarta EE. Untuk Messaging/MDB:

- cocok untuk mempelajari model standard,
- resource JNDI biasanya dikelola server,
- MDB activation mengikuti container EJB,
- perlu cek provider messaging bawaan dan versinya.

Gunakan untuk learning dan compatibility validation, tetapi production choice tetap tergantung organisasi.

### 21.2 WildFly / JBoss EAP

WildFly/JBoss banyak memakai ActiveMQ Artemis sebagai messaging subsystem modern.

Perhatian:

- destination didefinisikan di messaging subsystem,
- MDB terhubung via resource adapter/subsystem,
- activation property bisa mengikuti naming server,
- pooled connection factory dan XA/non-XA factory harus dipilih dengan benar,
- CLI/server config penting untuk production.

### 21.3 Open Liberty / WebSphere Liberty

Open Liberty/Liberty memakai feature-based configuration.

Perhatian:

- enable feature Jakarta Messaging/Enterprise Beans yang sesuai,
- resource adapter bisa dipakai untuk external provider seperti IBM MQ,
- connection factory, queue, topic, activation specification didefinisikan di `server.xml`,
- config-as-code menjadi kuat.

### 21.4 WebLogic

WebLogic punya JMS provider dan fitur messaging enterprise yang kaya.

Perhatian:

- JMS server, module, subdeployment, distributed destination,
- SAF/store-and-forward,
- connection factory tuning,
- transaction/XA setup,
- cluster topology,
- deployment descriptor WebLogic-specific.

Portability dari/ke WebLogic perlu review vendor extension.

---

## 22. Example: Clean Jakarta EE MDB Architecture

### 22.1 Envelope

```java
public final class CaseCommandEnvelope {
    private final String messageId;
    private final String correlationId;
    private final String commandType;
    private final String caseId;
    private final long expectedVersion;
    private final String payloadJson;

    public CaseCommandEnvelope(
            String messageId,
            String correlationId,
            String commandType,
            String caseId,
            long expectedVersion,
            String payloadJson) {
        this.messageId = messageId;
        this.correlationId = correlationId;
        this.commandType = commandType;
        this.caseId = caseId;
        this.expectedVersion = expectedVersion;
        this.payloadJson = payloadJson;
    }

    public String messageId() { return messageId; }
    public String correlationId() { return correlationId; }
    public String commandType() { return commandType; }
    public String caseId() { return caseId; }
    public long expectedVersion() { return expectedVersion; }
    public String payloadJson() { return payloadJson; }
}
```

Jika target Java 8, gunakan getter biasa seperti di atas. Jika target Java 16+, bisa memakai `record`, tetapi jangan jika library harus kompatibel Java 8.

### 22.2 Parser boundary

```java
import jakarta.jms.JMSException;
import jakarta.jms.Message;
import jakarta.jms.TextMessage;

public class CaseCommandEnvelopeReader {

    public CaseCommandEnvelope read(Message message) {
        try {
            if (!(message instanceof TextMessage)) {
                throw new PermanentMessageException("Expected TextMessage");
            }

            TextMessage textMessage = (TextMessage) message;

            String messageId = textMessage.getStringProperty("appMessageId");
            String commandType = textMessage.getStringProperty("commandType");
            String caseId = textMessage.getStringProperty("caseId");
            long expectedVersion = textMessage.getLongProperty("expectedVersion");
            String correlationId = textMessage.getJMSCorrelationID();
            String payload = textMessage.getText();

            requireNonBlank(messageId, "appMessageId");
            requireNonBlank(commandType, "commandType");
            requireNonBlank(caseId, "caseId");

            return new CaseCommandEnvelope(
                    messageId,
                    correlationId,
                    commandType,
                    caseId,
                    expectedVersion,
                    payload
            );
        } catch (JMSException e) {
            throw new TransientMessageException("Failed to read JMS message", e);
        }
    }

    private static void requireNonBlank(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new PermanentMessageException("Missing required field: " + field);
        }
    }
}
```

### 22.3 Exception categories

```java
public class PermanentMessageException extends RuntimeException {
    public PermanentMessageException(String message) {
        super(message);
    }

    public PermanentMessageException(String message, Throwable cause) {
        super(message, cause);
    }
}

public class TransientMessageException extends RuntimeException {
    public TransientMessageException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

### 22.4 MDB boundary

```java
import jakarta.ejb.ActivationConfigProperty;
import jakarta.ejb.MessageDriven;
import jakarta.jms.Message;
import jakarta.jms.MessageListener;

@MessageDriven(activationConfig = {
        @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/queue/CaseCommandQueue"),
        @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue")
})
public class CaseCommandMdb implements MessageListener {

    @jakarta.inject.Inject
    private CaseCommandEnvelopeReader reader;

    @jakarta.inject.Inject
    private CaseCommandApplicationService service;

    @jakarta.inject.Inject
    private InvalidMessageAudit invalidMessageAudit;

    @Override
    public void onMessage(Message message) {
        try {
            CaseCommandEnvelope envelope = reader.read(message);
            service.handle(envelope);
        } catch (PermanentMessageException e) {
            invalidMessageAudit.record(message, e);
            // Do not rethrow: commit and prevent infinite redelivery.
        } catch (TransientMessageException e) {
            throw e; // rollback and redeliver.
        }
    }
}
```

### 22.5 Application service

```java
import jakarta.ejb.Stateless;
import jakarta.ejb.TransactionAttribute;
import jakarta.ejb.TransactionAttributeType;

@Stateless
public class CaseCommandApplicationService {

    @jakarta.inject.Inject
    private ProcessedMessageRepository processedMessages;

    @jakarta.inject.Inject
    private CaseRepository cases;

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void handle(CaseCommandEnvelope envelope) {
        boolean firstTime = processedMessages.insertIfAbsent(
                "case-command-consumer",
                envelope.messageId()
        );

        if (!firstTime) {
            return;
        }

        cases.applyCommand(
                envelope.caseId(),
                envelope.expectedVersion(),
                envelope.commandType(),
                envelope.payloadJson()
        );
    }
}
```

Catatan: apakah `@TransactionAttribute` di service efektif tergantung apakah service adalah EJB/CDI bean dan bagaimana ia dipanggil. Self-invocation tidak memicu interceptor transaction. Ini salah satu jebakan klasik.

---

## 23. Failure Modeling untuk MDB

### 23.1 Handler sukses, commit sukses

```text
message delivered
handler updates DB
transaction commit
message acked
```

Outcome: normal.

### 23.2 Handler throw transient exception

```text
message delivered
handler fails due DB timeout
transaction rollback
message redelivered later
```

Outcome: retry.

Risiko: retry storm jika DB down dan redelivery delay terlalu kecil.

### 23.3 Handler catch exception dan tidak rollback

```text
message delivered
handler fails
catch logs only
method returns
transaction commit
message acked
```

Outcome: message lost from business perspective.

Ini salah satu bug paling mahal.

### 23.4 Handler melakukan irreversible side effect lalu rollback

```text
message delivered
handler sends email
DB update fails
transaction rollback
message redelivered
handler sends email again
```

Outcome: duplicate email.

Solusi:

- outbox untuk email,
- idempotency key di downstream,
- side effect after commit pattern,
- external side effect classification.

### 23.5 Server crash after DB commit before broker ack

Jika DB dan JMS tidak dalam transaksi atomik:

```text
message delivered
DB commit success
server crash before ack
message redelivered
```

Outcome: duplicate processing.

Solusi: inbox/dedup.

### 23.6 Poison message due schema mismatch

```text
old consumer expects field A
new producer sends incompatible payload
consumer throws permanent error
message retries repeatedly
DLQ fills
```

Solusi:

- schema compatibility,
- permanent error classification,
- DLQ with triage,
- contract tests.

### 23.7 Activation failure after deployment

```text
application deploys
MDB activation fails due missing destination/resource adapter
app partially starts
no messages consumed
queue depth rises
```

Solusi:

- startup health check for activation,
- deployment validation,
- queue depth alert,
- server logs monitored,
- smoke test message.

### 23.8 Namespace mismatch

```text
app compiled with jakarta.jms.MessageListener
resource adapter supports javax.jms.MessageListener
container cannot match listener endpoint
MDB not activated
```

Solusi:

- align server/app/provider versions,
- use Jakarta-compatible RA,
- integration test actual deployment.

---

## 24. Anti-Patterns

### 24.1 Treating MDB as magic exactly-once processor

Salah:

```text
Because MDB uses container transaction, duplicates cannot happen.
```

Benar:

```text
MDB can reduce some failure windows, but end-to-end duplicate safety still belongs to application design.
```

### 24.2 Doing long blocking work inside MDB without timeout design

MDB yang memproses 20 menit:

- transaction timeout bisa terjadi,
- connection held terlalu lama,
- pool starvation,
- redelivery ambiguous,
- shutdown sulit.

Lebih baik pecah kerja:

- receive command,
- create job record,
- commit,
- worker process job with checkpoint,
- publish completion event.

### 24.3 One MDB consumes many unrelated message types

Buruk:

```java
switch (message.getStringProperty("type")) {
    case "CASE_CREATED": ...
    case "PAYMENT_POSTED": ...
    case "EMAIL_REQUESTED": ...
    case "REPORT_GENERATED": ...
}
```

Masalah:

- failure policy campur,
- DLQ tidak spesifik,
- scaling tidak spesifik,
- ownership kabur,
- observability buruk.

Lebih baik pisahkan destination/consumer berdasarkan bounded context dan failure profile.

### 24.4 Hardcoding broker URL/credential di application code

Jangan:

```java
ActiveMQConnectionFactory cf = new ActiveMQConnectionFactory("tcp://prod-broker:61616");
```

di Jakarta EE app yang seharusnya managed.

Gunakan server-managed resource/JNDI.

### 24.5 Relying on provider-specific activation property without documentation

Jika memakai property khusus seperti `maxSession`, `destination`, `useJNDI`, `setupAttempts`, dokumentasikan:

- provider,
- server version,
- default value,
- reason,
- tested failure scenario.

---

## 25. Design Decision Framework

### 25.1 Kapan memakai MDB?

Gunakan MDB jika:

- aplikasi berjalan di Jakarta EE full/platform runtime,
- butuh asynchronous receive yang container-managed,
- ingin transaction integration dengan JTA,
- ingin injection/interceptor/security/lifecycle server,
- organisasi sudah mengoperasikan app server,
- provider/resource adapter reliable tersedia,
- workload cocok dengan per-message handler.

### 25.2 Kapan tidak memakai MDB?

Hindari MDB jika:

- aplikasi bukan Jakarta EE runtime,
- ingin full control event loop/reactive pipeline,
- butuh streaming log semantics/replay panjang,
- broker/provider tidak punya Jakarta-compatible RA stabil,
- team tidak punya operational skill app server,
- scaling model perlu sangat custom,
- workload long-running dan lebih cocok job worker/checkpoint.

### 25.3 MDB vs manual JMS consumer

| Kriteria | MDB | Manual consumer |
|---|---|---|
| Lifecycle | container-managed | app-managed |
| Transaction | JTA integration kuat | harus dikonfigurasi sendiri |
| Concurrency | MDB pool/container | explicit executor/thread model |
| Portability | tergantung Jakarta EE/provider | tergantung client lib/provider |
| Simplicity | sederhana untuk EE app | sederhana untuk standalone app |
| Operational control | sebagian disembunyikan | lebih eksplisit |
| Failure visibility | perlu server observability | app observability langsung |

### 25.4 MDB vs Spring `@JmsListener`

| Kriteria | MDB | Spring Listener |
|---|---|---|
| Runtime | Jakarta EE container | Spring container |
| Transaction model | EJB/JTA/container | Spring transaction abstraction |
| Deployment | app server/EAR/WAR | Boot jar/war |
| Resource adapter | penting untuk inbound | biasanya client connection factory |
| Operational model | server-centric | app-centric |

Tidak ada yang absolut lebih baik. Pilih sesuai runtime, team, ops, dan integration constraints.

---

## 26. Production Checklist

### 26.1 Runtime compatibility

- [ ] App server mendukung Jakarta Messaging version yang dipakai.
- [ ] Enterprise Beans/MDB support tersedia, bukan hanya Web Profile minimal.
- [ ] Resource adapter/provider sesuai namespace `javax` atau `jakarta`.
- [ ] Broker client/provider version compatible dengan server.
- [ ] Deployment actual MDB activation sudah diuji.

### 26.2 Resource configuration

- [ ] Connection factory didefinisikan server-side.
- [ ] Destination didefinisikan server/broker-side.
- [ ] Credential tidak hardcoded.
- [ ] TLS/mTLS config jelas.
- [ ] XA/non-XA connection factory dipilih sengaja.
- [ ] JNDI names environment-specific dan terdokumentasi.

### 26.3 Transaction and ack

- [ ] Transaction attribute eksplisit.
- [ ] Redelivery behavior diuji.
- [ ] Permanent vs transient exception dibedakan.
- [ ] Handler tidak swallow transient failure.
- [ ] External side effect tidak diasumsikan rollback otomatis.
- [ ] Idempotency/dedup tersedia.

### 26.4 Concurrency

- [ ] MDB pool/concurrency limit diketahui.
- [ ] Broker prefetch/consumer credit diketahui.
- [ ] DB pool cukup untuk MDB concurrency.
- [ ] Downstream capacity dihitung.
- [ ] Ordering requirement dipetakan.
- [ ] Shutdown behavior diuji.

### 26.5 DLQ and retry

- [ ] Redelivery max configured.
- [ ] Redelivery delay/backoff configured.
- [ ] DLQ destination monitored.
- [ ] DLQ triage procedure tersedia.
- [ ] Replay tool aman dan idempotent.
- [ ] Poison message tidak menyebabkan infinite loop.

### 26.6 Observability

- [ ] Message id/correlation id logged.
- [ ] Application message id ada.
- [ ] Handler duration metric ada.
- [ ] Outcome metric ada.
- [ ] Duplicate ignored metric ada.
- [ ] Queue depth alert ada.
- [ ] MDB activation failure alert ada.
- [ ] Transaction timeout alert ada.

---

## 27. Review Questions

1. Apa perbedaan tanggung jawab MDB dan manual JMS listener?
2. Mengapa MDB memerlukan resource adapter untuk inbound delivery?
3. Apa hubungan `ActivationSpec` dengan `@ActivationConfigProperty`?
4. Kenapa `javax.jms` vs `jakarta.jms` mismatch bisa membuat MDB gagal aktif?
5. Dalam MDB CMT, kapan message dianggap sukses?
6. Apa risiko catch exception lalu tidak throw di MDB?
7. Kenapa idempotency tetap wajib walaupun MDB memakai transaction?
8. Bagaimana concurrency MDB dapat merusak ordering bisnis?
9. Kapan durable topic subscription cocok untuk MDB?
10. Apa saja metric minimal untuk MDB production?
11. Apa bedanya redelivery karena transient failure dan permanent rejection?
12. Bagaimana menguji XA recovery secara realistis?

---

## 28. Latihan Engineering

### Latihan 1 — Desain MDB untuk command queue

Desain MDB untuk `CaseApprovalCommandQueue`.

Requirement:

- command harus idempotent,
- duplicate harus diabaikan,
- invalid status transition tidak boleh retry,
- DB timeout boleh retry,
- message harus punya correlation id,
- setiap outcome harus audit.

Output yang harus dibuat:

- envelope fields,
- destination naming,
- exception classification,
- transaction boundary,
- dedup table,
- log fields,
- DLQ policy.

### Latihan 2 — Debug MDB tidak consume message

Gejala:

- deployment sukses,
- message masuk queue,
- consumer count 0,
- tidak ada error di aplikasi,
- server log ada warning resource adapter.

Analisis kemungkinan:

- destinationLookup salah,
- resource adapter tidak aktif,
- namespace mismatch,
- activation property salah,
- app server tidak punya MDB feature,
- connection credential salah,
- broker ACL menolak consumer.

Buat runbook investigasi.

### Latihan 3 — MDB menyebabkan duplicate email

Flow:

```text
MDB receives APPROVAL_COMPLETED
sends email
updates DB notification_sent=true
DB update fails
transaction rollback
message redelivered
email sent again
```

Desain ulang agar aman.

Hint:

- outbox notification,
- idempotency key per email intent,
- commit before external send,
- separate dispatcher,
- provider response tracking.

---

## 29. Ringkasan Part 20

MDB adalah model Jakarta EE untuk menerima message secara asinkron dengan lifecycle, transaction, dependency injection, pooling, dan endpoint activation yang dikelola container.

Poin inti:

1. MDB adalah **managed message endpoint**, bukan sekadar listener biasa.
2. Resource adapter/JCA adalah jembatan antara app server dan broker/provider.
3. `ActivationSpec` mengonfigurasi inbound delivery ke MDB.
4. Container-managed transaction menyederhanakan ack/rollback, tetapi tidak menghilangkan duplicate end-to-end.
5. Exception classification menentukan apakah message diretry atau dianggap selesai sebagai permanent rejection.
6. MDB concurrency harus dihitung berdasarkan capacity, ordering, DB pool, dan downstream limit.
7. Jakarta namespace migration harus mencakup app code, server, provider, dan resource adapter.
8. Production MDB wajib punya DLQ, observability, idempotency, dan deployment activation checks.

Top 1% heuristic:

> MDB memberi operational leverage jika container, resource adapter, broker, dan transaction manager dikonfigurasi benar. Namun correctness tetap berada pada desain message contract, idempotency, exception policy, dan failure recovery aplikasi.

---

## 30. Referensi Resmi dan Bacaan Lanjutan

- Jakarta Messaging 3.1 Specification: https://jakarta.ee/specifications/messaging/3.1/
- Jakarta Messaging API docs: https://jakarta.ee/specifications/messaging/3.1/apidocs/
- Jakarta EE Tutorial — Messaging Concepts: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/messaging/jms-concepts/jms-concepts.html
- Jakarta Enterprise Beans API — `@MessageDriven`: https://jakarta.ee/specifications/enterprise-beans/4.0/apidocs/jakarta/ejb/messagedriven
- Jakarta EE Tutorial — Enterprise Beans / Message-Driven Beans: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/entbeans/ejb-intro/ejb-intro.html
- Open Liberty Jakarta Messaging feature documentation: https://www.ibm.com/docs/en/was-liberty/nd?topic=features-jakarta-messaging-31
- Open Liberty JMS/Jakarta Messaging guide: https://openliberty.io/guides/jms-intro.html
- IBM MQ Resource Adapter for Jakarta Messaging: https://www.ibm.com/docs/en/ibm-mq/
- Red Hat JBoss EAP Message-Driven Beans documentation: https://docs.redhat.com/en/documentation/red_hat_jboss_enterprise_application_platform/
- Oracle WebLogic Server Messaging documentation: https://docs.oracle.com/en/middleware/fusion-middleware/weblogic-server/

---

## 31. Posisi Seri

Selesai:

- Part 0 — Orientation
- Part 1 — Evolution
- Part 2 — Messaging Domain Model
- Part 3 — Queue Semantics
- Part 4 — Topic Semantics
- Part 5 — Message Anatomy
- Part 6 — Message Types
- Part 7 — Producer Engineering
- Part 8 — Consumer Engineering
- Part 9 — Acknowledgement Semantics
- Part 10 — Transaction Model
- Part 11 — Reliability Semantics
- Part 12 — Ordering
- Part 13 — Redelivery, Retry, Poison Message, DLQ, Parking Lot
- Part 14 — Request/Reply over JMS
- Part 15 — Selectors and Routing
- Part 16 — Security Model
- Part 17 — Broker Architecture
- Part 18 — ActiveMQ Artemis Deep Dive
- Part 19 — Provider Differences
- Part 20 — JMS in Jakarta EE Runtime

Berikutnya:

- Part 21 — JMS in Spring Framework / Spring Boot: `JmsTemplate`, Listener Container, Transaction, Error Handler

Status seri: **belum selesai**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-019.md">⬅️ Part 19 — Provider Differences: ActiveMQ Classic, IBM MQ, RabbitMQ JMS Client, Solace, WebLogic, WildFly, Open Liberty</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-021.md">Part 21 — JMS in Spring Framework / Spring Boot: `JmsTemplate`, Listener Container, Transaction, Error Handler ➡️</a>
</div>
