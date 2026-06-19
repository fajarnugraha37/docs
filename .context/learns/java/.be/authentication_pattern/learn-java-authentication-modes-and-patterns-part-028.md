# learn-java-authentication-modes-and-patterns-part-028

# Part 28 — Authentication for Messaging, Jobs, and Event-Driven Java Systems

> Seri: **Java Authentication Modes and Patterns**  
> Target Java: **Java 8 sampai Java 25**  
> Fokus bagian ini: memahami autentikasi di sistem Java yang tidak berjalan dalam pola HTTP request/response langsung: Kafka, RabbitMQ/AMQP, JMS/Jakarta Messaging, job scheduler, batch worker, event consumer, producer, outbox relay, connector, dan workflow asynchronous.

---

## 0. Posisi Part Ini dalam Series

Sampai Part 27, kita sudah membahas authentication di beberapa boundary besar:

- user-facing application,
- Servlet/Jakarta/Spring runtime,
- session/cookie,
- API key,
- HMAC signing,
- JWT dan opaque token,
- OAuth2/OIDC/SAML,
- mTLS,
- service-to-service authentication,
- multi-tenant dan distributed systems.

Bagian ini memperluas authentication ke dunia yang lebih sulit: **event-driven dan asynchronous systems**.

Dalam HTTP, pertanyaan authentication biasanya terlihat sederhana:

```text
Client mengirim request → server memvalidasi credential/token → server tahu principal.
```

Dalam messaging, pertanyaannya berubah menjadi:

```text
Siapa yang boleh connect ke broker?
Siapa yang boleh publish ke topic/queue?
Siapa yang boleh consume?
Siapa actor bisnis di balik message?
Apakah message ini asli, belum dimodifikasi, belum replayed, dan masih relevan?
Apakah consumer memproses atas nama user, service, tenant, batch job, atau sistem?
```

Itu sebabnya authentication untuk messaging tidak boleh disamakan dengan “pasang username/password di connection string”.

---

## 1. Problem yang Diselesaikan

Messaging dan event-driven systems memecah satu alur bisnis menjadi beberapa proses terpisah oleh waktu, broker, queue, topic, retry, partition, dead-letter, scheduler, dan consumer group.

Contoh alur:

```text
User login sebagai Alice
  ↓
Alice submit application
  ↓
Application Service publish event ApplicationSubmitted
  ↓
Kafka / RabbitMQ / JMS broker menyimpan event
  ↓
Screening Worker consume event 20 detik kemudian
  ↓
Notification Worker consume event 1 menit kemudian
  ↓
Audit Worker consume event 5 menit kemudian
```

Pertanyaan yang harus dijawab:

1. Apakah `Application Service` benar-benar service yang sah untuk publish event?
2. Apakah `Screening Worker` benar-benar worker yang sah untuk consume event?
3. Apakah event itu masih membawa identitas Alice?
4. Apakah worker sedang bertindak sebagai Alice, atas nama Alice, atau sebagai sistem?
5. Apakah event boleh diproses ulang?
6. Apakah event bisa dipalsukan oleh service lain?
7. Apakah consumer boleh mempercayai header `userId` di message?
8. Bagaimana membuktikan di audit bahwa keputusan screening berasal dari event yang sah?

Part ini menyelesaikan masalah tersebut dengan membangun mental model berikut:

```text
Messaging authentication =
  connection authentication
+ broker authorization
+ message provenance
+ actor propagation
+ replay resistance
+ consumer-side trust validation
+ audit reconstruction
```

---

## 2. Mental Model Utama

### 2.1 Jangan Campur Tiga Identity Layer

Dalam sistem messaging, minimal ada tiga layer identity:

```text
┌────────────────────────────────────────────────────────────┐
│ 1. Transport / Connection Identity                          │
│    Siapa client yang connect ke broker?                     │
│    Contoh: Kafka producer principal, RabbitMQ user, JMS user │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ 2. Application / Workload Identity                          │
│    Service apa yang mengirim/memproses message?             │
│    Contoh: application-service, screening-worker            │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ 3. Business Actor Identity                                  │
│    Actor bisnis yang memicu aksi?                           │
│    Contoh: end-user Alice, admin Bob, system scheduler      │
└────────────────────────────────────────────────────────────┘
```

Kesalahan umum adalah menganggap ketiganya sama.

Contoh salah:

```json
{
  "userId": "alice"
}
```

Lalu consumer percaya bahwa event pasti berasal dari Alice.

Padahal `userId` di payload bukan credential. Itu hanya data. Yang harus divalidasi:

- producer service-nya sah,
- producer memang berwenang mengirim event untuk tenant/user itu,
- event belum dimodifikasi,
- event berasal dari transition bisnis yang valid,
- consumer tidak sedang menerima instruksi palsu dari topic/queue yang salah.

### 2.2 Broker Authentication Bukan Message Authentication

Broker authentication menjawab:

```text
Apakah client boleh connect ke broker?
```

Message authentication menjawab:

```text
Apakah message ini benar-benar berasal dari actor/workload yang diklaim,
dan apakah isi message belum berubah?
```

Broker-level security penting, tetapi tidak cukup jika:

- banyak service berbagi credential broker,
- topic/queue permission terlalu lebar,
- internal compromised service bisa publish event palsu,
- event disimpan dan diproses ulang di masa depan,
- ada cross-region/cross-broker replication,
- ada connector yang mengambil data dari luar trust boundary.

### 2.3 Event Bukan Request

HTTP request biasanya punya lifecycle singkat.

Event bisa hidup lama:

```text
Created → stored → replicated → consumed → retried → dead-lettered → replayed → archived
```

Karena itu, event authentication harus mempertimbangkan:

- message age,
- replay,
- duplicate delivery,
- schema evolution,
- actor validity saat event dibuat vs saat diproses,
- revoked user/session/token,
- retired service account,
- tenant split/merge,
- legal/audit retention.

---

## 3. Core Concepts

### 3.1 Producer Identity

Producer identity adalah identitas workload yang mengirim message ke broker.

Contoh:

```text
application-service-prod
billing-service-uat
screening-engine-prod
outbox-relay-prod
```

Producer identity harus berbeda dari user identity.

Buruk:

```text
Semua service publish ke Kafka pakai username: app
```

Lebih baik:

```text
application-service-prod hanya boleh write ke application.events
billing-service-prod hanya boleh write ke billing.events
notification-service-prod tidak boleh write ke application.events
```

### 3.2 Consumer Identity

Consumer identity adalah identitas workload yang membaca message.

Contoh:

```text
screening-worker-prod
email-dispatcher-prod
audit-indexer-prod
case-escalation-job-prod
```

Consumer identity harus dibatasi:

- topic/queue apa yang boleh dibaca,
- consumer group apa yang boleh dipakai,
- environment mana,
- tenant mana jika multi-tenant,
- operation apa yang boleh dilakukan setelah consume.

### 3.3 Message Provenance

Message provenance menjawab:

```text
Dari mana message ini berasal?
Service apa yang membuatnya?
Atas trigger apa?
Dari command/request/event sebelumnya yang mana?
```

Minimal metadata:

```json
{
  "eventId": "evt-01HY...",
  "eventType": "ApplicationSubmitted",
  "eventVersion": 3,
  "producer": "application-service",
  "producerInstance": "application-service-7f8d9c",
  "environment": "prod",
  "tenantId": "cea",
  "occurredAt": "2026-06-19T12:34:56Z",
  "publishedAt": "2026-06-19T12:34:57Z",
  "correlationId": "corr-...",
  "causationId": "cmd-...",
  "actor": {
    "type": "END_USER",
    "subject": "user-123",
    "display": "Alice",
    "authTime": "2026-06-19T12:30:00Z"
  }
}
```

### 3.4 Actor Propagation

Actor propagation berarti membawa informasi actor bisnis dari request awal ke proses async.

Tetapi ada perbedaan penting:

```text
Propagated actor ≠ current authenticated broker principal
```

Contoh:

```text
Kafka principal: User:application-service-prod
Business actor: END_USER user-123
Consumer principal: User:screening-worker-prod
```

Consumer tidak “login sebagai Alice”. Consumer memproses event sebagai worker yang sah, dengan konteks bahwa event dipicu oleh Alice.

### 3.5 Delegation vs Impersonation

Dalam messaging, ini sangat penting.

#### Delegation

```text
Service bertindak sebagai dirinya sendiri,
dengan informasi bahwa aksi dipicu oleh user tertentu.
```

Contoh audit:

```text
screening-worker-prod performed preliminary screening
caused_by: user-123 submitted application
```

#### Impersonation

```text
Service bertindak seolah-olah menjadi user.
```

Ini berbahaya kecuali dirancang eksplisit.

Contoh buruk:

```text
Worker membuat API call downstream memakai token Alice yang disimpan di message.
```

Masalah:

- token bisa expired,
- token bisa dicuri dari broker/log,
- user mungkin sudah logout,
- consent/scope mungkin tidak relevan,
- replay bisa memicu operasi berulang sebagai Alice.

Rule praktis:

```text
Jangan kirim access token user mentah di message queue kecuali ada desain keamanan sangat eksplisit.
Lebih sering, kirim actor reference + event facts, lalu worker bertindak sebagai service.
```

---

## 4. Java 8–25 Relevance

Authentication messaging di Java memakai beberapa lapisan API berbeda.

### 4.1 Java 8 Baseline

Java 8 masih sangat umum di enterprise legacy.

Relevansi:

- JAAS untuk Kafka SASL/GSSAPI/Kerberos/SCRAM/PLAIN configuration.
- JCA/JCE untuk HMAC/signature message-level authentication.
- JSSE untuk TLS/mTLS.
- JMS 1.x legacy stacks.
- Spring Framework/Spring Boot lama.

### 4.2 Java 11/17/21 LTS

Di Java modern:

- TLS defaults lebih baik.
- Container/runtime lebih modern.
- Spring Boot 3 membutuhkan Java 17+.
- Jakarta package migration dari `javax.*` ke `jakarta.*`.
- Better observability dan runtime tooling.

### 4.3 Java 21–25

Relevansi authentication async:

- virtual thread dapat dipakai untuk consumer workers, tetapi jangan mengandalkan ThreadLocal security context tanpa desain eksplisit;
- structured concurrency membantu mengelola child tasks dari message processing;
- scoped values dapat menjadi alternatif context passing yang lebih aman di flow tertentu;
- crypto/key handling modern di Java 25 relevan untuk HMAC/signature/key derivation.

### 4.4 Package Reality

Legacy JMS:

```java
javax.jms.ConnectionFactory
javax.jms.Connection
javax.jms.Session
```

Jakarta Messaging modern:

```java
jakarta.jms.ConnectionFactory
jakarta.jms.Connection
jakarta.jms.Session
```

Kafka Java client:

```java
org.apache.kafka.clients.producer.KafkaProducer
org.apache.kafka.clients.consumer.KafkaConsumer
```

RabbitMQ Java client:

```java
com.rabbitmq.client.ConnectionFactory
com.rabbitmq.client.Connection
com.rabbitmq.client.Channel
```

Spring abstractions:

```java
KafkaTemplate
@KafkaListener
RabbitTemplate
@RabbitListener
JmsTemplate
@JmsListener
```

---

## 5. Authentication Modes in Messaging Systems

### 5.1 Username/Password

Common in:

- RabbitMQ PLAIN SASL,
- JMS providers,
- Kafka SASL/PLAIN,
- legacy broker connections.

Pros:

- simple,
- widely supported,
- easy to bootstrap.

Cons:

- bearer-like secret,
- rotation hard if embedded in configs,
- often shared by multiple apps,
- often over-permissioned,
- must be protected by TLS.

Production rule:

```text
Username/password auth for brokers must use TLS and per-workload credentials.
Never share one broker credential across all services.
```

### 5.2 SCRAM

SCRAM is common in Kafka environments.

Pros:

- avoids sending plaintext password directly as authentication proof,
- better than simple PLAIN over many setups,
- supported by Kafka deployments.

Cons:

- still based on shared secret,
- credential lifecycle still matters,
- not enough without topic ACLs.

Kafka supports multiple SASL mechanisms including PLAIN, SCRAM, GSSAPI/Kerberos, and OAUTHBEARER depending on version and configuration. Official Kafka documentation describes SASL client configuration via JAAS login modules.

### 5.3 Kerberos / GSSAPI

Common in older enterprise, Hadoop, regulated environments, AD-integrated infrastructure.

Pros:

- strong enterprise SSO model,
- no app password in many flows,
- centralized identity.

Cons:

- operationally complex,
- ticket lifecycle issues,
- DNS/time sync sensitive,
- hard for cloud-native ephemeral workloads if not designed well.

### 5.4 TLS / mTLS

Broker verifies client certificate.

Pros:

- strong possession proof,
- no password shared with broker,
- good for service identity,
- can integrate with internal PKI/service mesh.

Cons:

- certificate lifecycle required,
- revocation complexity,
- identity mapping from certificate subject/SAN must be precise,
- termination at proxy can weaken end-to-end identity.

### 5.5 OAuth/OIDC Bearer Token for Broker Clients

Kafka supports SASL/OAUTHBEARER in modern setups.

Pros:

- integrates with central IdP,
- token expiry,
- client identity via OAuth client,
- potentially good for cloud-native workloads.

Cons:

- token validation availability,
- clock skew,
- refresh complexity,
- broker/IdP integration complexity,
- token audience/scope design required.

### 5.6 Message-Level Signature

Message carries cryptographic signature.

Pros:

- provenance survives broker hops,
- useful across trust boundaries,
- detects tampering,
- helps forensic audit.

Cons:

- key lifecycle required,
- canonicalization hard,
- does not replace broker auth,
- replay prevention still needed.

### 5.7 No Authentication Inside Private Network

This is an anti-pattern unless the broker is truly isolated and compensating controls are strong.

Bad assumption:

```text
It's internal, so it's safe.
```

Reality:

- compromised pod can connect,
- wrong namespace can access broker,
- leaked broker address can be abused,
- staging credential can be reused,
- internal lateral movement is common.

---

## 6. Kafka Authentication Patterns

### 6.1 Kafka Security Layers

Kafka security usually consists of:

```text
1. Transport encryption: SSL/TLS
2. Client authentication: SSL client cert or SASL
3. Broker-to-broker authentication
4. Topic/group ACL authorization
5. Optional token/OAuth integration
6. Application-level validation
```

Apache Kafka documentation describes SSL encryption, SASL authentication, and authorization for client/broker operations.

### 6.2 Kafka Producer Identity Pattern

Bad:

```properties
security.protocol=SASL_SSL
sasl.mechanism=PLAIN
sasl.jaas.config=... username="shared-app" password="...";
```

Better:

```properties
security.protocol=SASL_SSL
sasl.mechanism=SCRAM-SHA-512
sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required \
  username="application-service-prod" \
  password="${secret}";
```

Design rule:

```text
Kafka principal should map to workload identity, not human user identity.
```

### 6.3 Kafka Consumer Identity Pattern

Consumer credentials should be scoped by:

- environment,
- application,
- topic read access,
- group ID,
- deployment unit,
- tenant if relevant.

Example naming:

```text
screening-worker-prod
screening-worker-uat
audit-indexer-prod
outbox-relay-prod
```

Avoid:

```text
consumer
kafka-client
app-user
```

### 6.4 Kafka ACL Mental Model

For Kafka, authentication says:

```text
This connection is principal X.
```

Authorization says:

```text
Principal X may Write to topic A.
Principal X may Read from topic B.
Principal X may Join consumer group G.
```

Authentication without ACL is incomplete.

### 6.5 Kafka Topic-Level Trust Boundary

Topic is a trust boundary.

Example:

```text
application.commands     high trust, only API command gateway can write
application.events       domain events, only application-service can write
audit.events             append-only audit relay
notification.requests    multiple producers maybe allowed
```

If every service can write to every topic, events become unauthenticated instructions.

### 6.6 Kafka Header Actor Propagation

A common pattern is to put actor metadata in headers.

Example Java conceptual model:

```java
public record ActorContext(
        String actorType,
        String subject,
        String tenantId,
        String sessionId,
        String authTime,
        String assuranceLevel) {
}
```

Kafka headers:

```text
x-correlation-id: corr-123
x-causation-id: cmd-456
x-tenant-id: cea
x-actor-type: END_USER
x-actor-subject: user-123
x-auth-time: 2026-06-19T12:30:00Z
x-producer: application-service
```

But headers are not automatically trusted.

Consumer must evaluate:

```text
Was this topic written only by trusted producers?
Does broker ACL enforce producer identity?
Is the message optionally signed?
Does event schema include immutable actor fields?
Is tenant consistent with topic/key/payload?
```

### 6.7 Kafka OAUTHBEARER Pattern

SASL/OAUTHBEARER can authenticate Kafka clients using OAuth/OIDC-issued tokens.

High-level flow:

```text
Producer/consumer obtains token from IdP
  ↓
Kafka client authenticates to broker with SASL/OAUTHBEARER
  ↓
Broker validates token or delegates validation
  ↓
Principal is derived from token claims
  ↓
ACLs are enforced
```

Design points:

- token audience must be Kafka/broker cluster,
- client identity must not be confused with end-user,
- token lifetime must match long-running client behavior,
- refresh/re-login must be tested,
- broker should not accept tokens meant for random APIs.

### 6.8 Kafka Replay Reality

Kafka supports re-consuming historical messages by offset reset/replay.

This is feature, not bug.

Authentication implication:

```text
A message consumed today may have been produced last month.
Do not assume current user/session/token state from old message.
```

For old events:

- treat actor as historical fact,
- re-evaluate current permissions only if action requires current authorization,
- avoid embedding short-lived access tokens,
- store decision input facts, not live credentials.

---

## 7. RabbitMQ / AMQP Authentication Patterns

### 7.1 RabbitMQ Security Layers

RabbitMQ security commonly involves:

```text
1. Client connection authentication
2. TLS encryption and optional client cert auth
3. Virtual host boundary
4. Configure/write/read permissions
5. Exchange/queue/routing-key permission design
6. Application-level message validation
```

RabbitMQ documentation describes authentication and authorization features, virtual hosts, user permissions, and TLS support.

### 7.2 RabbitMQ User and Virtual Host Pattern

Bad:

```text
user: app
vhost: /
permissions: .* .* .*
```

Better:

```text
user: application-service-prod
vhost: aceas-prod
configure: ^$
write: ^application\.events\.exchange$
read: ^$

user: notification-worker-prod
vhost: aceas-prod
configure: ^$
write: ^$
read: ^notification\.queue$
```

### 7.3 AMQP Routing Trust Boundary

AMQP has multiple naming layers:

- exchange,
- queue,
- binding,
- routing key,
- virtual host.

Authentication design must decide:

```text
Who can publish to which exchange?
Who can create/delete queues?
Who can bind queues?
Who can consume from which queues?
```

A common production mistake:

```text
Service is allowed to create arbitrary queue/binding in shared vhost.
```

This can allow accidental or malicious message interception.

### 7.4 RabbitMQ TLS and x509 Client Identity

mTLS can authenticate clients using certificates.

Design points:

- certificate subject/SAN mapping to RabbitMQ user must be explicit,
- certificate rotation must be rehearsed,
- client must verify broker certificate,
- environment separation must be enforced by CA/truststore/vhost.

### 7.5 RabbitMQ Message Metadata Pattern

AMQP properties can carry metadata:

```text
messageId
correlationId
timestamp
headers
appId
type
userId
```

But these properties are application-controlled unless broker enforces them.

Rule:

```text
Treat AMQP message headers as claims, not proof.
```

Proof comes from:

- broker-authenticated publisher identity,
- permissions,
- optional message signature,
- trusted outbox relay,
- immutable audit event.

---

## 8. JMS / Jakarta Messaging Authentication Patterns

### 8.1 JMS Abstraction Reality

Jakarta Messaging defines a standard API for Java applications to send and receive messages through messaging providers.

But authentication semantics are provider-specific.

The API may expose:

```java
connectionFactory.createConnection(username, password)
```

or container-managed connection factories.

But the actual behavior depends on:

- ActiveMQ Artemis,
- IBM MQ,
- WebLogic JMS,
- Open Liberty resource adapter,
- WildFly/EAP messaging,
- cloud JMS-compatible provider.

### 8.2 Container-Managed JMS Connection Identity

In Jakarta EE, JMS connection factory can be configured by container.

Application code may not hold credential directly.

Pattern:

```text
Application injects ConnectionFactory
Container/resource adapter authenticates to broker
Credential lives in server config/secret store
```

Pros:

- central credential management,
- app code cleaner,
- container can pool connections,
- compatible with enterprise operational controls.

Cons:

- identity may be hidden from application developers,
- shared connection factory can accidentally share privilege,
- per-module service identity may be lost.

### 8.3 JMS Message-Driven Bean Identity

In Jakarta EE, message-driven beans consume messages via container-managed runtime.

Key question:

```text
Which identity is used to connect to broker?
Which identity is used to execute application logic?
Which actor is represented in message payload?
```

These are not necessarily the same.

### 8.4 JMS Header Caveat

JMS has standard headers such as:

```text
JMSMessageID
JMSCorrelationID
JMSTimestamp
JMSReplyTo
JMSType
```

And properties:

```text
actorId
tenantId
correlationId
sourceSystem
```

Do not treat custom properties as authenticated unless the producer path is controlled.

---

## 9. Jobs, Schedulers, Batch, and Workload Authentication

### 9.1 Scheduled Job Is an Actor

A scheduled job is not “nobody”. It is an actor.

Examples:

```text
SYSTEM_SCHEDULER
CASE_ESCALATION_JOB
DAILY_RECONCILIATION_JOB
ARCHIVAL_JOB
TOKEN_CLEANUP_JOB
```

Each job should have:

- workload identity,
- purpose,
- scope,
- allowed operations,
- audit identity,
- owner team,
- run schedule,
- failure behavior.

### 9.2 Bad Pattern: Job Uses Admin User

Bad:

```text
Nightly job logs in as admin@example.com
```

Problems:

- audit falsely attributes action to a human,
- password rotation breaks job,
- admin account compromise impacts automation,
- no least privilege,
- impossible to distinguish human vs system action.

Better:

```text
actor_type: SYSTEM_JOB
actor_id: case-escalation-job
workload_principal: case-escalation-worker-prod
```

### 9.3 Batch Job Triggered by User

Some jobs are user-triggered.

Example:

```text
Admin Bob clicks “Generate Report”
  ↓
report-service creates async report job
  ↓
report-worker processes job later
```

Audit should say:

```text
report-worker-prod generated report
triggered_by: admin Bob
request_id: req-123
job_id: job-456
```

Not:

```text
Bob generated file directly at 03:00 via worker thread
```

### 9.4 Job Authentication to Internal APIs

Jobs often call internal services.

Options:

1. service account token,
2. OAuth client credentials,
3. mTLS,
4. signed internal request,
5. workload identity federation,
6. local platform identity.

Do not pass user access tokens into long-running jobs unless designed as delegation with explicit constraints.

---

## 10. Message-Level Authentication

### 10.1 When Broker Authentication Is Not Enough

Consider message-level authentication when:

- messages cross trust boundaries,
- events are archived/replayed,
- broker admin is not fully trusted by application domain,
- multiple producers share a topic,
- regulatory audit requires proof of origin,
- event enters from partner/external system,
- event is consumed by high-risk workflow.

### 10.2 HMAC-Signed Message

Producer signs canonical representation:

```text
signature = HMAC(secret, canonical(headers + payload))
```

Headers:

```text
x-signature-key-id: key-2026-06
x-signature-alg: HMAC-SHA-256
x-signature-created-at: 2026-06-19T12:34:56Z
x-signature: base64url(...)
```

Consumer:

1. read key ID,
2. resolve secret,
3. canonicalize same fields,
4. recompute HMAC,
5. constant-time compare,
6. check timestamp/window,
7. check event ID replay/idempotency,
8. process.

### 10.3 Asymmetric Signed Message

Producer signs with private key; consumer verifies with public key/JWKS/certificate.

Pros:

- consumers do not need signing secret,
- easier multi-consumer verification,
- good for partner integration.

Cons:

- key distribution,
- signature metadata,
- canonicalization,
- replay still separate.

### 10.4 Signed Envelope Pattern

```json
{
  "metadata": {
    "eventId": "evt-123",
    "eventType": "ApplicationSubmitted",
    "producer": "application-service",
    "tenantId": "cea",
    "occurredAt": "2026-06-19T12:34:56Z"
  },
  "payload": {
    "applicationId": "app-123"
  },
  "signature": {
    "alg": "ES256",
    "keyId": "appsvc-key-2026-06",
    "value": "..."
  }
}
```

Important:

```text
Signature must cover metadata and payload.
Do not sign only payload while trusting unsigned tenant/actor headers.
```

### 10.5 Canonicalization Hazard

JSON canonicalization is harder than it looks.

Pitfalls:

- field order,
- whitespace,
- number formatting,
- Unicode normalization,
- omitted nulls,
- schema evolution,
- binary payload,
- compression,
- serialization library differences.

Safer approaches:

- sign bytes actually published,
- use canonical JSON standard if required,
- use envelope with detached binary digest,
- use Avro/Protobuf deterministic serialization where suitable,
- version signing rules.

---

## 11. Actor Propagation Design

### 11.1 Actor Types

Define explicit actor taxonomy:

```text
END_USER
ADMIN_USER
SERVICE
SYSTEM_JOB
EXTERNAL_PARTNER
MIGRATION_SCRIPT
SUPPORT_IMPERSONATION
UNKNOWN_LEGACY
```

Avoid raw nullable `userId` everywhere.

### 11.2 Actor Context Model

Example Java record:

```java
public record MessageActor(
        ActorType type,
        String subject,
        String tenantId,
        String displayName,
        String authMethod,
        String assuranceLevel,
        Instant authTime,
        String sessionId,
        String delegatedBy,
        Map<String, String> attributes) {
}
```

For audit, prefer stable identifiers:

```text
subject: internal immutable user ID
not display name
not email only
```

### 11.3 Causation Chain

Every async message should support:

```text
correlationId: whole business flow
causationId: immediate command/event that caused this event
eventId: current event identity
```

Example:

```text
HTTP request req-1
  → command cmd-1
    → event evt-1
      → event evt-2
```

Metadata:

```json
{
  "correlationId": "req-1",
  "causationId": "evt-1",
  "eventId": "evt-2"
}
```

### 11.4 Do Not Propagate Too Much

Avoid putting these in messages:

- raw access token,
- refresh token,
- session cookie,
- password,
- MFA secret,
- private key,
- full identity provider token if not needed,
- sensitive PII claims.

Prefer:

- stable subject ID,
- tenant ID,
- actor type,
- auth assurance summary,
- correlation ID,
- authorization decision snapshot if needed,
- domain facts.

---

## 12. Authorization Boundary in Messaging

Although this series is authentication-focused, messaging forces us to mention authorization because broker authentication is useless without authorization.

### 12.1 Producer Authorization

Questions:

```text
Can this producer write this event type?
Can this producer write this tenant?
Can this producer write this routing key?
Can this producer publish command-like messages?
```

### 12.2 Consumer Authorization

Questions:

```text
Can this consumer read this topic/queue?
Can it join this consumer group?
Can it process messages for this tenant?
Can it call downstream APIs after consuming?
```

### 12.3 Command vs Event Distinction

Command:

```text
Please do X.
```

Event:

```text
X happened.
```

Commands require stronger authentication/authorization because they instruct behavior.

Events require provenance and integrity because they record facts.

Bad design:

```text
Any service can publish UserDeleted event, and consumers act on it.
```

Better:

```text
Only identity-service can publish UserDeleted.
Consumer validates topic + schema + producer identity + event signature if required.
```

---

## 13. Replay, Duplicate, and Idempotency

### 13.1 Messaging Delivery Reality

Most messaging systems are at-least-once or support reprocessing.

Consumer must expect:

- duplicate messages,
- delayed messages,
- out-of-order messages,
- replay after deployment,
- poison messages,
- offset reset,
- dead-letter re-drive.

Authentication implication:

```text
A validly authenticated producer from the past does not mean the operation should be applied again today.
```

### 13.2 Replay Defense

For command-like messages:

- require unique command ID,
- store processed IDs,
- define expiry window,
- check timestamp,
- sign timestamp and command ID,
- reject stale commands.

For event-like messages:

- use idempotent projection,
- store event ID/offset/version,
- treat replay as rebuild if explicitly allowed,
- do not trigger irreversible side effects during replay unless guarded.

### 13.3 Consumer Idempotency Table

Example schema:

```sql
CREATE TABLE processed_message (
    consumer_name        VARCHAR(128) NOT NULL,
    message_id           VARCHAR(128) NOT NULL,
    topic_or_queue       VARCHAR(256) NOT NULL,
    producer             VARCHAR(128) NOT NULL,
    tenant_id            VARCHAR(64),
    processed_at         TIMESTAMP NOT NULL,
    result_status        VARCHAR(32) NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

This is not only reliability. It is part of authentication/replay safety.

---

## 14. Poison Message and Dead-Letter Security

### 14.1 Poison Message Can Be an Attack

A poison message is not always a bug.

It can be:

- malformed payload,
- oversized payload,
- schema bomb,
- decompression bomb,
- unexpected tenant,
- forged actor,
- replayed command,
- message triggering expensive computation,
- message designed to crash consumer.

### 14.2 DLQ Is a Sensitive System

Dead-letter queues often contain:

- failed payload,
- actor metadata,
- tenant data,
- error details,
- stack traces,
- sometimes sensitive identifiers.

Do not allow broad access to DLQ.

DLQ permissions should be stricter than normal queue in many systems.

### 14.3 Re-drive Requires Authentication

Re-driving DLQ messages is an administrative action.

Audit it:

```text
who re-drove
when
which messages
why
from DLQ to which target
with what filtering
```

If possible, re-drive should preserve original message ID and add re-drive metadata.

---

## 15. Outbox and Relay Authentication

### 15.1 Outbox Pattern Identity Split

Outbox pattern:

```text
Application writes domain data + outbox row in same DB transaction
  ↓
Relay reads outbox row
  ↓
Relay publishes to broker
```

Who is producer?

Technically:

```text
outbox-relay-prod
```

Logically:

```text
application-service domain transition
```

Good event metadata should include both:

```json
{
  "producer": "application-service",
  "publisher": "outbox-relay-prod",
  "sourceTransactionId": "tx-123"
}
```

### 15.2 Outbox Relay Credential Scope

Relay should only publish outbox topics it owns.

Bad:

```text
outbox-relay-prod can write all topics.
```

Better:

```text
application-outbox-relay-prod can write application.events only.
billing-outbox-relay-prod can write billing.events only.
```

### 15.3 Outbox Row Tampering

If attacker can insert outbox rows, broker authentication will not catch it because relay is legitimate.

Controls:

- DB write permissions,
- application-level transition validation,
- outbox table not writable by arbitrary modules,
- event generated from domain state,
- optional signature at application transaction time,
- audit trail around outbox creation.

---

## 16. Inbox Pattern and Consumer Trust

Inbox pattern stores inbound message before processing.

Benefits:

- idempotency,
- audit,
- retry control,
- replay control,
- validation record.

Example flow:

```text
Consumer receives message
  ↓
Validate broker source/topic/headers/signature/schema
  ↓
Store inbox row
  ↓
Process business logic
  ↓
Mark processed
```

Inbox table can store authentication-relevant data:

```sql
producer_principal
producer_claim
signature_key_id
signature_valid
actor_type
actor_subject
tenant_id
received_at
processed_at
```

---

## 17. Spring Kafka Security Pattern

Spring Kafka mostly passes Kafka client security properties to underlying Kafka clients.

Conceptual configuration:

```yaml
spring:
  kafka:
    bootstrap-servers: broker:9093
    properties:
      security.protocol: SASL_SSL
      sasl.mechanism: SCRAM-SHA-512
      sasl.jaas.config: >
        org.apache.kafka.common.security.scram.ScramLoginModule required
        username="application-service-prod"
        password="${KAFKA_PASSWORD}";
```

Important:

```text
Spring configuration convenience does not remove Kafka security design.
You still need distinct principals, ACLs, TLS, topic boundaries, and actor propagation.
```

### 17.1 Listener Context

In `@KafkaListener`, do not assume current Spring Security user exists.

HTTP security context usually does not exist in async consumer thread.

Bad:

```java
Authentication auth = SecurityContextHolder.getContext().getAuthentication();
```

In a Kafka listener, this may be null, stale, or unrelated unless you set it explicitly.

Better:

```java
@KafkaListener(topics = "application.events")
public void onMessage(ConsumerRecord<String, ApplicationEvent> record) {
    MessageActor actor = actorExtractor.from(record.headers(), record.value());
    ProcessingContext context = ProcessingContext.from(record, actor);
    applicationEventHandler.handle(context, record.value());
}
```

If you need a security context, create a separate domain-specific processing context rather than pretending there is an HTTP login session.

---

## 18. Spring RabbitMQ Security Pattern

Spring AMQP/RabbitMQ configuration typically sets connection factory credentials/TLS.

Conceptually:

```yaml
spring:
  rabbitmq:
    host: rabbitmq.internal
    port: 5671
    username: notification-worker-prod
    password: ${RABBITMQ_PASSWORD}
    ssl:
      enabled: true
```

Again:

```text
Connection auth is only one layer.
Exchange/queue/vhost permissions and message trust model are still required.
```

### 18.1 `@RabbitListener` Actor Context

Same as Kafka:

- no browser session,
- no automatic user principal,
- message headers are claims,
- consumer identity is workload identity.

---

## 19. Spring JMS Security Pattern

Spring JMS typically uses `ConnectionFactory` configured by application/container.

Common issue:

```text
All JMS listeners use one shared connection factory identity.
```

This is operationally convenient but weak for least privilege.

Better:

- separate connection factory per module/consumer class if broker supports it,
- separate credentials per app deployment,
- restrict destinations,
- expose current connection principal in audit if possible,
- do not mix admin and consumer connection identities.

---

## 20. Message Schema for Authentication Metadata

A strong event envelope separates:

- identity of message,
- identity of producer,
- business actor,
- tenant,
- causality,
- payload,
- integrity data.

Example:

```json
{
  "metadata": {
    "messageId": "evt-01J0...",
    "messageType": "ApplicationSubmitted",
    "messageVersion": 4,
    "tenantId": "cea",
    "producer": {
      "service": "application-service",
      "environment": "prod",
      "instance": "application-service-7f8d9c",
      "principal": "kafka:application-service-prod"
    },
    "actor": {
      "type": "END_USER",
      "subject": "usr-123",
      "authMethod": "OIDC",
      "assuranceLevel": "aal2",
      "authTime": "2026-06-19T12:30:00Z"
    },
    "correlationId": "corr-123",
    "causationId": "cmd-456",
    "occurredAt": "2026-06-19T12:34:56Z",
    "publishedAt": "2026-06-19T12:34:57Z"
  },
  "payload": {
    "applicationId": "app-123"
  }
}
```

Optional signature block:

```json
{
  "signature": {
    "alg": "HMAC-SHA-256",
    "keyId": "application-service-2026-06",
    "covers": ["metadata", "payload"],
    "value": "base64url..."
  }
}
```

---

## 21. Trust Matrix

Use a trust matrix before designing authentication.

| Boundary | Authentication Question | Example Control |
|---|---|---|
| App → Broker | Is producer/consumer a valid workload? | SASL, mTLS, OAuth, broker user |
| Broker → App | Is this broker the real broker? | TLS server certificate validation |
| Producer → Topic/Exchange | Can producer publish here? | ACL, vhost permission |
| Consumer → Topic/Queue | Can consumer read here? | ACL, queue permission |
| Message → Consumer | Is message provenance acceptable? | topic boundary, signature, schema |
| Actor → Message | Who triggered the event? | actor envelope, causation ID |
| Replay → Business Operation | Is this duplicate/replayed? | idempotency, event ID, timestamp |
| DLQ → Re-drive | Who reprocessed failed message? | admin auth, audit, approval |

---

## 22. Failure Modes

### 22.1 Shared Broker Credential

Symptom:

```text
All apps use same kafka/rabbitmq username.
```

Impact:

- no attribution,
- no least privilege,
- cannot revoke one service,
- compromised one app compromises all messaging.

Fix:

```text
Per-service, per-environment, least-privilege credentials.
```

### 22.2 Consumer Trusts `userId` Header Blindly

Symptom:

```text
Consumer reads x-user-id and uses it for authorization.
```

Impact:

- forged messages can impersonate user,
- compromised producer can escalate.

Fix:

```text
Validate producer/topic trust boundary, sign messages if needed, and separate actor facts from authorization decisions.
```

### 22.3 User Token Stored in Queue

Symptom:

```text
Message contains Authorization: Bearer eyJ...
```

Impact:

- token leaks through broker/log/DLQ,
- expired token breaks delayed processing,
- replay risk,
- unclear delegation.

Fix:

```text
Use service identity for worker; carry actor reference/facts, not raw token.
```

### 22.4 Topic Permission Too Broad

Symptom:

```text
All services can write to all topics.
```

Impact:

- events become unauthenticated commands,
- one compromised service can trigger workflows elsewhere.

Fix:

```text
Topic/exchange permissions by producer role.
```

### 22.5 Replay Triggers Side Effect

Symptom:

```text
Offset reset sends email/payment/escalation again.
```

Impact:

- duplicate external effects,
- audit confusion,
- fraud/risk.

Fix:

```text
Idempotency table, message IDs, operation-level uniqueness, replay mode flag.
```

### 22.6 DLQ Access Too Broad

Symptom:

```text
Developers/operators can view all DLQ payloads.
```

Impact:

- PII exposure,
- credential/token leakage if bad payloads,
- audit gap.

Fix:

```text
Restrict DLQ access, redact payloads, audit re-drive.
```

### 22.7 Wrong Principal Mapping from mTLS Certificate

Symptom:

```text
Any certificate from internal CA maps to same broker user.
```

Impact:

- certificate identity loses meaning,
- lateral movement.

Fix:

```text
Map SAN/SPIFFE/service name explicitly to broker/application principal.
```

### 22.8 Consumer Uses HTTP SecurityContext

Symptom:

```java
SecurityContextHolder.getContext().getAuthentication()
```

inside message listener.

Impact:

- null auth,
- stale auth,
- leaked auth from reused thread,
- wrong audit actor.

Fix:

```text
Build explicit ProcessingContext from message metadata and consumer identity.
```

---

## 23. Production Design Checklist

### 23.1 Broker Connection

- [ ] TLS enabled for client-broker communication.
- [ ] Client verifies broker certificate.
- [ ] Per-service credential.
- [ ] Per-environment credential.
- [ ] No shared admin credential in app runtime.
- [ ] Credential stored in secret manager, not source code.
- [ ] Rotation procedure tested.
- [ ] Broker-to-broker auth configured where applicable.

### 23.2 Authorization

- [ ] Producer can only write required topics/exchanges.
- [ ] Consumer can only read required topics/queues.
- [ ] Consumer group permissions controlled.
- [ ] Queue/exchange creation restricted.
- [ ] Vhost/namespace/environment separation exists.
- [ ] DLQ access restricted.

### 23.3 Message Metadata

- [ ] Message ID exists.
- [ ] Correlation ID exists.
- [ ] Causation ID exists.
- [ ] Tenant ID exists where relevant.
- [ ] Producer identity recorded.
- [ ] Actor type recorded.
- [ ] Actor subject recorded if applicable.
- [ ] Occurred time and published time are separate.
- [ ] Schema version exists.

### 23.4 Message Integrity

- [ ] Broker ACL is sufficient for internal low-risk events, or
- [ ] Message signature is used for high-risk/cross-boundary events.
- [ ] Signature covers metadata and payload.
- [ ] Key ID and algorithm version exist.
- [ ] Replay window/idempotency exists.
- [ ] Signature verification failure is auditable.

### 23.5 Consumer Processing

- [ ] Consumer does not rely on HTTP session context.
- [ ] Consumer builds explicit processing context.
- [ ] Idempotency is implemented.
- [ ] Poison message handling is defined.
- [ ] DLQ policy is defined.
- [ ] Re-drive is authenticated and audited.
- [ ] Downstream API calls use service identity unless explicit delegation exists.

### 23.6 Audit

- [ ] Broker principal captured if available.
- [ ] Workload principal captured.
- [ ] Business actor captured.
- [ ] Trigger source captured.
- [ ] Message ID captured.
- [ ] Correlation/causation captured.
- [ ] Retry/replay/re-drive captured.
- [ ] Failure reason captured safely.

---

## 24. Implementation Pattern: Processing Context

Instead of using framework security context directly, define processing context.

```java
public enum ActorType {
    END_USER,
    ADMIN_USER,
    SERVICE,
    SYSTEM_JOB,
    EXTERNAL_PARTNER,
    UNKNOWN
}
```

```java
public record ActorContext(
        ActorType type,
        String subject,
        String tenantId,
        String authMethod,
        String assuranceLevel,
        Instant authTime) {
}
```

```java
public record MessageIdentity(
        String messageId,
        String messageType,
        int messageVersion,
        String producer,
        String brokerPrincipal,
        String correlationId,
        String causationId,
        Instant occurredAt,
        Instant receivedAt) {
}
```

```java
public record ProcessingContext(
        MessageIdentity message,
        ActorContext actor,
        String consumerName,
        boolean replay,
        Map<String, String> attributes) {
}
```

Consumer code should pass `ProcessingContext` explicitly:

```java
public final class ApplicationSubmittedHandler {

    public void handle(ProcessingContext context, ApplicationSubmitted event) {
        requireTenantConsistency(context, event);
        requireSupportedEventVersion(context.message().messageVersion());
        processDomainTransition(context, event);
    }
}
```

This makes identity explicit and testable.

---

## 25. Implementation Pattern: Message Verification Pipeline

Consumer should not jump directly to business logic.

Recommended pipeline:

```text
Receive raw message
  ↓
Validate transport/source metadata
  ↓
Deserialize safely
  ↓
Validate schema version
  ↓
Validate tenant consistency
  ↓
Validate producer/topic compatibility
  ↓
Verify signature if required
  ↓
Check replay/idempotency
  ↓
Build ProcessingContext
  ↓
Execute business handler
  ↓
Commit offset/ack message
```

### 25.1 Pseudocode

```java
public void consume(RawMessage raw) {
    ReceivedMessage received = receiverMetadataExtractor.extract(raw);

    MessageEnvelope envelope = serializer.deserialize(raw.payload());

    schemaValidator.validate(envelope);
    tenantValidator.validate(envelope);
    producerPolicy.validate(received, envelope.metadata());

    if (signaturePolicy.requiredFor(envelope.metadata().messageType())) {
        signatureVerifier.verify(envelope);
    }

    if (!idempotency.tryStart(envelope.metadata().messageId(), consumerName)) {
        return;
    }

    ProcessingContext context = contextFactory.create(received, envelope);

    try {
        handlerRegistry.dispatch(context, envelope);
        idempotency.markSuccess(envelope.metadata().messageId(), consumerName);
        acknowledger.ack(raw);
    } catch (RetryableException e) {
        idempotency.markRetryableFailure(...);
        throw e;
    } catch (NonRetryableException e) {
        idempotency.markRejected(...);
        deadLetterPublisher.publish(raw, e, context);
        acknowledger.ack(raw);
    }
}
```

---

## 26. Anti-Patterns

### 26.1 “Internal Topic Means Trusted”

Internal does not mean authenticated.

Better wording:

```text
Internal topic is trusted only to the degree that broker authentication, authorization, network policy, producer controls, and audit controls make it trusted.
```

### 26.2 “JWT in Every Message”

Do not blindly put JWT into all messages.

Problems:

- expiry,
- leakage,
- replay,
- token bloat,
- irrelevant audience,
- consumer misuse.

Use event facts and actor context instead.

### 26.3 “One Kafka User for All Services”

Destroys attribution and least privilege.

### 26.4 “DLQ Is Just Debugging”

DLQ is operationally sensitive.

### 26.5 “Consumer Can Authorize from Message Claims Alone”

Message claims are not proof unless they are covered by trusted path/signature.

### 26.6 “Replay Is Same as Normal Processing”

Replay may require different side-effect controls.

### 26.7 “Scheduler Is Not a User”

Scheduler is a system actor and must be auditable.

---

## 27. Design Questions

Before implementing messaging authentication, ask:

1. What workloads can connect to broker?
2. Are credentials per service, per environment, and least privilege?
3. What topics/queues are trust boundaries?
4. What services may publish each event type?
5. What services may consume each event type?
6. Are command messages separated from event messages?
7. Is actor identity propagated as fact, delegation, or impersonation?
8. Are raw user tokens ever placed into messages?
9. What happens when message is processed after user logout?
10. What happens when message is replayed after 3 months?
11. What happens when producer credential is compromised?
12. Can a compromised low-risk service publish high-risk events?
13. Do consumers validate tenant consistency?
14. Is DLQ access controlled and audited?
15. Is re-drive authenticated and auditable?
16. Can audit reconstruct producer, consumer, actor, and causation?
17. Is message-level signing needed?
18. How are signing keys rotated?
19. What is the idempotency model?
20. How are old schema versions handled?

---

## 28. Reference Architecture: Internal Kafka Event Platform

```text
[API Service]
  authenticates end-user via OIDC/session
  validates command authorization
  writes domain state + outbox row
       |
       v
[Outbox Relay]
  authenticates to Kafka as application-outbox-relay-prod
  can write only application.events
  publishes event envelope with actor + causation metadata
       |
       v
[Kafka Broker]
  TLS + SASL/SCRAM or mTLS
  ACL: relay write application.events
  ACL: screening-worker read application.events as group screening
       |
       v
[Screening Worker]
  authenticates as screening-worker-prod
  validates topic/event/tenant/schema
  checks idempotency
  processes as SERVICE worker, caused by END_USER actor
  emits ScreeningCompleted event
```

Audit record:

```json
{
  "action": "SCREENING_STARTED",
  "performedBy": {
    "type": "SERVICE",
    "id": "screening-worker-prod"
  },
  "causedBy": {
    "type": "END_USER",
    "id": "user-123"
  },
  "sourceMessage": "evt-123",
  "correlationId": "corr-123",
  "tenantId": "cea"
}
```

---

## 29. Reference Architecture: Partner Event Ingestion

```text
[Partner System]
  signs event with private key
       |
       v
[Public Ingestion API]
  authenticates partner via mTLS/OAuth/HMAC
  validates signature/schema/tenant
  normalizes event
  publishes to partner.ingested.events
       |
       v
[Internal Consumers]
  consume normalized trusted event
```

Do not allow external partner to publish directly to core internal topic unless there is strong isolation and validation.

---

## 30. Reference Architecture: Async User-Triggered Job

```text
[Admin UI]
  Bob clicks Generate Report
       |
       v
[Report API]
  authenticates Bob
  checks Bob can generate report
  creates report job with actor context
       |
       v
[Job Queue]
       |
       v
[Report Worker]
  authenticates as report-worker-prod
  processes job as system worker
  caused by Bob
  stores report output
```

Audit:

```text
report-worker-prod generated report R
triggered_by admin Bob
request_id req-123
job_id job-456
```

---

## 31. Testing Strategy

### 31.1 Unit Tests

Test:

- actor extraction,
- tenant consistency,
- signature verification,
- timestamp window,
- idempotency,
- unsupported producer,
- unsupported event type,
- schema version.

### 31.2 Integration Tests

Use test broker/container where possible:

- Kafka with TLS/SASL if feasible,
- RabbitMQ with credentials/vhost permissions,
- JMS provider-specific test setup,
- invalid credential test,
- unauthorized topic publish test,
- unauthorized queue consume test.

### 31.3 Security Regression Tests

Cases:

```text
Forged actor header
Wrong tenant ID
Valid signature over changed payload should fail
Old replayed command rejected
Duplicate event id ignored
Unauthorized producer event rejected
DLQ re-drive records actor
Expired signing key behavior
```

---

## 32. Operational Runbook

### 32.1 Producer Credential Compromise

Steps:

1. disable/revoke producer credential,
2. identify topics/exchanges it could write,
3. list messages produced during compromise window,
4. quarantine suspicious offsets/messages if possible,
5. notify consumers or stop high-risk consumers,
6. rotate credential,
7. replay from safe point if needed,
8. audit business impact.

### 32.2 Consumer Credential Compromise

Steps:

1. revoke consumer credential,
2. identify topics/queues it could read,
3. assess data exposure,
4. rotate credential,
5. check consumer group offsets and unusual access,
6. review DLQ/read logs if available.

### 32.3 Signing Key Compromise

Steps:

1. mark key as compromised,
2. stop accepting signatures after compromise time if possible,
3. rotate key,
4. require new key ID,
5. re-verify high-risk messages,
6. invalidate/replay affected event windows.

### 32.4 Broker Misconfiguration

Example:

```text
ACL accidentally allowed all services to write all topics.
```

Response:

1. fix ACL,
2. determine window,
3. inspect high-risk topics,
4. identify unusual producer principals,
5. replay/repair derived state if needed,
6. create automated ACL regression checks.

---

## 33. Top 1% Engineering Heuristics

### 33.1 Separate “Who Connected” from “Who Caused”

```text
Connected principal: workload identity.
Business actor: cause identity.
```

Never collapse them blindly.

### 33.2 Treat Messages as Durable Claims

Message data survives longer than sessions and tokens.

So store:

- facts,
- stable IDs,
- causation,
- provenance.

Do not store:

- live credentials,
- bearer tokens,
- temporary session state.

### 33.3 Broker ACL Is Part of Domain Integrity

Topic permissions are not only infrastructure configuration. They define who can assert business facts.

### 33.4 Commands Need Stronger Controls Than Events

A command can cause side effects.

An event should represent something already validated.

### 33.5 Replays Are Normal, So Authentication Must Be Replay-Aware

If your design breaks when messages are replayed, it is not production-ready.

### 33.6 Audit Should Reconstruct the Causal Chain

Good audit can answer:

```text
Who connected?
Who published?
Who consumed?
Who caused?
What message?
What previous message/request?
What tenant?
What decision?
```

### 33.7 Never Let Framework Convenience Hide Identity

Spring listener, JMS container, Kafka client, Rabbit connection factory: all can hide the actual credential/principal. Surface it in architecture and audit.

---

## 34. Summary

Authentication for messaging, jobs, and event-driven Java systems is not just broker login.

The correct mental model is:

```text
Messaging authentication =
  workload authentication to broker
+ broker-side authorization
+ message provenance
+ actor propagation
+ replay/idempotency protection
+ consumer validation
+ audit reconstruction
```

Key conclusions:

1. Producer identity, consumer identity, and business actor identity are different.
2. Broker authentication does not automatically authenticate message contents.
3. Headers and payload fields are claims, not proof.
4. User access tokens usually should not be placed into queues/topics.
5. Topic/exchange/queue permissions are part of authentication integrity.
6. Scheduled jobs and batch processes are actors and must be auditable.
7. Replay and duplicate delivery are normal, so idempotency is security-relevant.
8. DLQ and re-drive are sensitive security operations.
9. Message-level signatures are useful when broker trust is insufficient.
10. A top-tier system can reconstruct the full chain: connection principal, producer, consumer, actor, tenant, causation, and result.

---

## 35. References

- Apache Kafka Documentation — Security / SASL Authentication / Security Overview.
- RabbitMQ Documentation — Authentication, Authorisation, Access Control; TLS Support; URI Specification.
- Jakarta Messaging 3.1 Specification.
- Spring Cloud Stream Kafka Binder Security Configuration.
- Spring for Apache Kafka documentation.
- RFC 2104 — HMAC.
- RFC 8705 — OAuth 2.0 Mutual TLS Client Authentication and Certificate-Bound Access Tokens.
- RFC 8693 — OAuth 2.0 Token Exchange.
- RFC 9700 — OAuth 2.0 Security Best Current Practice.
- OWASP REST Security Cheat Sheet.
- OWASP API Security Top 10 2023.
- OWASP Secrets Management Cheat Sheet.

---

## Status Series

- Part 0 sampai Part 28 selesai.
- Series belum selesai.
- Berikutnya: **Part 29 — Authentication Failure Modeling and Attack Simulation**.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-027.md">⬅️ Part 27 — Authentication in Microservices and Distributed Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-029.md">Part 29 — Authentication Failure Modeling and Attack Simulation ➡️</a>
</div>
