# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-24.md

# Part 24 — Security, TLS, AuthN/AuthZ, Multi-Tenancy

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Untuk: Java software engineer yang ingin memahami RabbitMQ sampai level arsitektur dan produksi  
> Fokus part ini: keamanan RabbitMQ sebagai boundary operasional, bukan sekadar `guest/guest` diganti password.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- message lifecycle;
- exchange routing;
- queue semantics;
- Java client;
- publisher confirm;
- consumer ack;
- retry/DLQ;
- Spring AMQP;
- RabbitMQ Streams;
- quorum queues;
- overload/backpressure;
- clustering;
- Federation/Shovel/multi-region.

Sekarang kita masuk ke pertanyaan yang sering terlambat dipikirkan:

> Siapa boleh connect ke broker?  
> Siapa boleh membuat topology?  
> Siapa boleh publish?  
> Siapa boleh consume?  
> Data apa yang boleh lewat broker?  
> Apakah traffic broker terenkripsi?  
> Apakah tenant A bisa melihat queue tenant B?  
> Apakah credentials bisa dirotasi tanpa outage?  
> Apakah operasi admin bisa diaudit?

RabbitMQ security bukan satu fitur tunggal. Ia adalah gabungan dari:

1. **network boundary**;
2. **transport encryption**;
3. **authentication**;
4. **authorization**;
5. **virtual-host isolation**;
6. **resource ownership**;
7. **secrets management**;
8. **message data policy**;
9. **operational auditability**;
10. **blast-radius control**.

Untuk engineer senior, RabbitMQ security harus dipahami sebagai desain sistem, bukan daftar checkbox.

---

## 1. Core Mental Model: Broker adalah Shared Stateful Boundary

RabbitMQ bukan library lokal. RabbitMQ adalah shared infrastructure yang menyimpan:

- connection state;
- channel state;
- exchange definitions;
- queue definitions;
- binding definitions;
- policies;
- users;
- permissions;
- messages;
- unacked deliveries;
- stream segments;
- quorum queue replicated logs;
- federation/shovel state;
- management API access.

Karena itu, breach di RabbitMQ bisa berarti:

- attacker publish fake command;
- attacker consume sensitive event;
- attacker purge queue;
- attacker delete exchange;
- attacker create huge queues and exhaust disk;
- attacker bind queue ke event stream sensitif;
- attacker read DLQ berisi PII/error payload;
- attacker replay workflow trigger;
- attacker disable policies;
- attacker create shovel to exfiltrate messages.

Security boundary RabbitMQ harus diasumsikan sama pentingnya dengan database boundary.

Perbedaannya:

- database biasanya memiliki row/table-level semantics;
- RabbitMQ permission bekerja pada vhost/resource name/pattern;
- message-level authorization umumnya harus didesain di aplikasi/topology;
- broker tidak tahu semantic payload domain;
- sekali user punya read pada queue, user bisa consume pesan dari queue tersebut.

---

## 2. RabbitMQ Security Layers

Gunakan layer model ini:

```text
┌──────────────────────────────────────────┐
│ Application-level authorization           │
│ tenant, actor, domain rule, data policy   │
├──────────────────────────────────────────┤
│ Message contract policy                   │
│ PII minimization, schema, encryption      │
├──────────────────────────────────────────┤
│ RabbitMQ resource authorization           │
│ vhost, configure/write/read permissions   │
├──────────────────────────────────────────┤
│ RabbitMQ authentication                   │
│ username/password, x509, OAuth2/JWT, LDAP │
├──────────────────────────────────────────┤
│ Transport security                        │
│ TLS, cert validation, hostname validation │
├──────────────────────────────────────────┤
│ Network boundary                          │
│ firewall, private subnet, security group  │
├──────────────────────────────────────────┤
│ Host/container/Kubernetes security        │
│ OS, image, volume, secret, RBAC           │
└──────────────────────────────────────────┘
```

Jangan menaruh semua beban keamanan pada satu layer.

Contoh desain lemah:

```text
Broker hanya exposed di private network, jadi semua service pakai user admin yang sama.
```

Masalah:

- private network bukan trust boundary sempurna;
- service compromised bisa delete topology;
- tidak ada attribution;
- credential rotation sulit;
- least privilege tidak ada;
- audit tidak bermakna.

Desain lebih baik:

```text
- Broker hanya private network.
- TLS aktif.
- Setiap service punya credential sendiri.
- Setiap service dibatasi pada vhost/domain tertentu.
- Permission configure/write/read dipisah.
- Topology creation dipisah dari runtime publisher/consumer.
- Admin human access lewat SSO/OAuth/LDAP.
- Secrets dikelola lewat secret manager.
- DLQ access dibatasi.
```

---

## 3. Virtual Host: Isolation Boundary Utama RabbitMQ

RabbitMQ memiliki konsep **virtual host** atau **vhost**.

Mental model:

```text
RabbitMQ cluster
├── vhost: /case-management
│   ├── exchanges
│   ├── queues
│   ├── bindings
│   ├── policies
│   └── permissions
├── vhost: /billing
│   ├── exchanges
│   ├── queues
│   ├── bindings
│   ├── policies
│   └── permissions
└── vhost: /sandbox
    ├── exchanges
    ├── queues
    ├── bindings
    ├── policies
    └── permissions
```

Vhost bukan sekadar namespace kosmetik. Vhost memisahkan:

- exchange names;
- queue names;
- bindings;
- permissions;
- policies;
- runtime operations;
- many resource controls.

Jika service connect ke vhost `/case-management`, ia tidak otomatis punya akses ke `/billing`.

### 3.1 Kapan Membuat Vhost Berbeda?

Gunakan vhost berbeda ketika ada boundary yang kuat:

| Boundary | Vhost terpisah? | Reason |
|---|---:|---|
| Environment dev/staging/prod | Ya | Isolation wajib |
| Domain besar berbeda | Sering ya | Blast radius dan permission |
| Tenant enterprise berbeda | Sering ya | Isolation/security/compliance |
| Team berbeda tapi domain sama | Tergantung | Bisa pakai naming + permission |
| Service berbeda dalam bounded context sama | Tidak selalu | Terlalu banyak vhost membuat operasi berat |
| Temporary integration test | Bisa | Isolation dan cleanup |

Jangan membuat vhost untuk setiap queue kecil tanpa alasan. Vhost adalah isolation boundary, bukan folder.

### 3.2 Vhost per Environment

Minimal:

```text
/case-management-dev
/case-management-staging
/case-management-prod
```

Lebih baik lagi prod broker cluster terpisah dari non-prod.

Jangan campur prod dan dev dalam cluster yang sama hanya karena vhost bisa memisahkan. Vhost tidak melindungi dari:

- node overload;
- disk exhaustion;
- memory alarm;
- cluster misconfiguration;
- plugin-level issue;
- operator error di node.

### 3.3 Vhost per Tenant

Vhost per tenant bisa masuk akal jika:

- tenant besar;
- data isolation tinggi;
- permission harus benar-benar dipisah;
- operational policy berbeda;
- retention berbeda;
- audit/regulatory requirement kuat.

Tetapi vhost per tenant bisa bermasalah jika:

- tenant sangat banyak;
- topology per tenant banyak;
- permission management membengkak;
- monitoring/alerting sulit;
- cluster metadata membesar;
- deployment automation belum matang.

Alternatif:

- vhost per domain;
- tenant id di message envelope;
- per-tenant queues hanya untuk tenant besar;
- policy-based limits;
- application-level authorization.

---

## 4. RabbitMQ Permission Model

RabbitMQ permission per user per vhost memiliki tiga regex permission utama:

1. **configure**
2. **write**
3. **read**

Mental model:

```text
configure = boleh membuat/mengubah/menghapus resource tertentu
write     = boleh publish ke exchange tertentu
read      = boleh consume dari queue tertentu
```

Lebih tepat:

- `configure` berlaku untuk resource seperti exchange/queue/binding yang user boleh declare/delete/configure;
- `write` berlaku untuk operasi menulis ke resource seperti exchange;
- `read` berlaku untuk operasi membaca dari resource seperti queue.

Permission dinyatakan sebagai regex terhadap nama resource.

Contoh:

```bash
rabbitmqctl set_permissions -p /case-management evidence-producer \
  '^$' \
  '^case\.events$' \
  '^$'
```

Artinya:

- configure: tidak boleh configure apa pun;
- write: boleh write ke exchange `case.events`;
- read: tidak boleh read queue mana pun.

### 4.1 Permission Design by Role

Pisahkan role:

| Role | Configure | Write | Read | Use case |
|---|---|---|---|---|
| Topology deployer | exchange/queue/binding pattern | mungkin none | mungkin none | CI/CD creates topology |
| Producer | none | specific exchange | none | publish messages |
| Consumer | none | optional DLX/reply exchange | specific queue | consume messages |
| Worker with retry republish | none | retry/DLX exchange | work queue | handle delayed retry |
| Ops read-only | none | none | maybe none | observe via management |
| Admin | broad | broad | broad | limited human/admin path |

Runtime apps sebaiknya tidak menggunakan admin user.

### 4.2 Configure Permission: Paling Berbahaya

`configure` sering dianggap harmless karena “cuma declare queue”. Itu salah.

Dengan configure permission terlalu luas, service bisa:

- membuat queue baru tanpa limit;
- menghapus queue;
- menghapus exchange;
- mengganti binding;
- membuat binding untuk menyadap event;
- membuat queue yang menyebabkan disk growth;
- declare topology yang konflik dengan existing topology.

Untuk produksi:

- topology sebaiknya dibuat oleh deployment pipeline atau operator;
- runtime app sebaiknya validate topology, bukan bebas menciptakan apa pun;
- jika app harus declare queue, batasi regex nama secara ketat.

Contoh app-specific configure:

```bash
rabbitmqctl set_permissions -p /case-management review-worker \
  '^(case\.review\..*|case\.review\.dlq)$' \
  '^(case\.commands|case\.events|case\.retry)$' \
  '^case\.review\..*'
```

Masih lebih baik jika configure bisa `^$` di prod.

### 4.3 Write Permission

Producer biasanya hanya butuh write ke exchange tertentu:

```text
producer evidence-service:
- write: case.events
- configure: none
- read: none
```

Consumer kadang perlu write jika:

- mengirim reply;
- republish ke retry exchange;
- publish result event;
- publish audit event.

Jangan berikan write ke `.*` untuk convenience.

### 4.4 Read Permission

Consumer butuh read pada queue tertentu, bukan exchange.

```text
review-worker:
- read: case.review.assignment.q
- write: case.events, case.retry
- configure: none
```

Jangan memberi read ke semua queue pada service yang tidak memerlukannya. Queue sering berisi payload paling sensitif karena:

- unprocessed commands;
- DLQ error data;
- retry payload;
- human workflow messages;
- business context.

### 4.5 Empty Regex Pattern

Untuk menolak permission, gunakan regex yang tidak match resource. Dalam contoh umum sering dipakai `^$` jika resource name tidak kosong.

```bash
configure = '^$'
write     = '^case\.events$'
read      = '^$'
```

Ini lebih jelas daripada `.*`.

---

## 5. Resource Naming sebagai Security Tool

Permission regex hanya efektif jika naming disiplin.

Buruk:

```text
events
queue1
tasks
service-a
```

Sulit membuat permission spesifik.

Lebih baik:

```text
case.events
case.commands
case.audit.stream
case.review.assignment.q
case.review.assignment.dlq
case.review.assignment.retry.5s.q
case.notification.email.q
```

Naming yang baik memungkinkan permission:

```text
^case\.review\..*$
^case\.events$
^case\.commands$
```

### 5.1 Naming Convention

Gunakan struktur:

```text
<domain>.<capability>.<purpose>[.<qualifier>]
```

Contoh:

```text
case.events
case.commands
case.review.assign.q
case.review.assign.dlq
case.review.assign.retry.30s.q
case.evidence.ingest.q
case.audit.stream
```

Untuk tenant:

```text
tenant.<tenant-id>.case.events
```

Namun hati-hati: tenant id dalam resource name bisa membocorkan identitas tenant di management UI/logs. Untuk environment sensitif, pakai surrogate id.

---

## 6. Default Users dan Management Access

### 6.1 Jangan Pakai `guest/guest` di Production

RabbitMQ default user `guest` hanya cocok untuk local development. Di production:

- hapus atau disable default user;
- gunakan user per service;
- gunakan admin personal/SSO bila mungkin;
- gunakan secret manager;
- rotate credentials.

### 6.2 Admin User Tidak Boleh Dipakai Runtime App

Anti-pattern:

```yaml
spring.rabbitmq.username: admin
spring.rabbitmq.password: super-secret
```

Masalah:

- app bisa configure/delete semua resource;
- compromise satu service compromise seluruh broker;
- audit attribution buruk;
- permission review tidak bermakna;
- incident blast radius besar.

Lebih baik:

```yaml
spring.rabbitmq.username: case-review-worker-prod
spring.rabbitmq.password: ${secret}
```

Permission:

```text
configure: ^$
write: ^(case\.events|case\.retry)$
read: ^case\.review\.assignment\.q$
```

### 6.3 Human Admin Access

Untuk human admin:

- jangan sharing satu user `admin`;
- gunakan named accounts;
- gunakan SSO/OAuth/LDAP jika tersedia;
- gunakan role separation;
- audit management UI/API usage;
- batasi network access ke management port.

Management UI/API tidak boleh terbuka ke internet publik.

---

## 7. Authentication Options

RabbitMQ mendukung beberapa pendekatan authentication:

1. internal username/password;
2. TLS client certificate/x509 via plugin/mechanism;
3. LDAP backend;
4. OAuth 2.0/JWT backend;
5. HTTP backend custom;
6. combinations/caches tergantung deployment.

Pilih berdasarkan tipe principal:

| Principal | Recommended approach |
|---|---|
| Runtime service sederhana | Username/password via secret manager atau mTLS |
| Kubernetes internal services | Secret manager + TLS; possibly cert auth |
| Human admin | OAuth2/SSO/LDAP |
| Enterprise identity integration | LDAP/OAuth2 |
| Cross-org integration | dedicated credentials, narrow vhost/permission, TLS |
| Edge broker bridge | dedicated shovel/federation user + TLS |

### 7.1 Internal Username/Password

Kelebihan:

- sederhana;
- mudah dipahami;
- cocok untuk service accounts;
- bisa dikelola dengan CLI/API/definitions.

Kekurangan:

- rotation harus dirancang;
- password leakage risk;
- human identity management kurang baik;
- audit user sering service-level, bukan person-level.

Best practice:

- satu user per service per environment;
- password random kuat;
- simpan di secret manager;
- rotate berkala;
- tidak commit ke repo;
- tidak print di log;
- permission minimal.

### 7.2 LDAP

LDAP cocok jika organisasi sudah punya directory service dan ingin:

- centralized identity;
- group-based access;
- human operator management;
- enterprise governance.

Caution:

- mapping LDAP group ke RabbitMQ permission harus diuji;
- LDAP availability mempengaruhi login/auth;
- gunakan TLS ke LDAP;
- cache behavior perlu dipahami;
- jangan membuat authorization expression terlalu sulit di-debug.

### 7.3 OAuth2/JWT

OAuth2/JWT backend cocok untuk:

- SSO modern;
- management UI access;
- service identity berbasis token;
- integration dengan identity provider seperti Keycloak/Entra ID;
- fine-grained scope-based authorization.

Caution:

- token lifetime;
- clock skew;
- JWKS rotation;
- audience/issuer validation;
- scope mapping;
- emergency break-glass admin;
- operational debugging.

### 7.4 TLS Client Certificate / x509

mTLS bisa memberikan identity berbasis certificate.

Kelebihan:

- credential tidak berupa password statis;
- cocok untuk service mesh/internal service identity;
- strong transport identity;
- certificate revocation/rotation bisa jadi governance path.

Caution:

- certificate lifecycle harus matang;
- hostname/SAN validation;
- CA trust management;
- operational complexity;
- Java keystore/truststore configuration;
- expiry monitoring.

---

## 8. Authorization: Jangan Campur dengan Business Authorization

RabbitMQ authorization menjawab:

```text
Apakah principal ini boleh read/write/configure resource broker ini?
```

Ia tidak menjawab:

```text
Apakah user Budi boleh approve case tenant X?
Apakah service ini boleh publish EnforcementActionProposed untuk case status tertentu?
Apakah payload ini mengandung PII yang tidak boleh dikirim ke tenant ini?
```

Itu harus di aplikasi/domain layer.

Jangan mengandalkan RabbitMQ permission untuk business rule granular.

Contoh:

```text
RabbitMQ: review-service boleh consume case.review.assignment.q
Application: review-service memvalidasi reviewer punya authority untuk case tersebut
```

RabbitMQ menjaga transport/resource boundary. Application menjaga domain boundary.

---

## 9. TLS untuk RabbitMQ

TLS punya dua tujuan:

1. **encryption in transit** — mencegah eavesdropping;
2. **peer verification** — memastikan client connect ke broker yang benar dan/atau broker mengenali client certificate.

Tanpa TLS, username/password dan message payload bisa terekspos pada network path tertentu.

### 9.1 AMQP TLS Port

Common convention:

```text
5672  = AMQP plaintext
5671  = AMQP over TLS
15672 = Management HTTP
15671 = Management HTTPS, jika dikonfigurasi
```

Port bisa berubah tergantung config.

Production recommendation:

- expose TLS listener untuk client;
- disable plaintext listener jika memungkinkan;
- management UI gunakan HTTPS;
- management UI hanya reachable dari admin network/VPN;
- validate certificate di client.

### 9.2 Broker TLS Configuration Concept

Contoh konseptual `rabbitmq.conf`:

```ini
listeners.tcp = none
listeners.ssl.default = 5671

ssl_options.cacertfile = /etc/rabbitmq/certs/ca.pem
ssl_options.certfile   = /etc/rabbitmq/certs/server.pem
ssl_options.keyfile    = /etc/rabbitmq/certs/server.key
ssl_options.verify     = verify_peer
ssl_options.fail_if_no_peer_cert = false

management.ssl.port       = 15671
management.ssl.cacertfile = /etc/rabbitmq/certs/ca.pem
management.ssl.certfile   = /etc/rabbitmq/certs/server.pem
management.ssl.keyfile    = /etc/rabbitmq/certs/server.key
```

Catatan:

- `verify_peer` memverifikasi peer certificate;
- `fail_if_no_peer_cert` menentukan apakah client wajib punya cert;
- jika memakai mTLS untuk client auth, biasanya `fail_if_no_peer_cert = true`;
- sesuaikan dengan authentication mechanism.

### 9.3 Java TLS Configuration

Dengan Java client:

```java
ConnectionFactory factory = new ConnectionFactory();
factory.setHost("rabbitmq.prod.internal");
factory.setPort(5671);
factory.setVirtualHost("/case-management-prod");
factory.setUsername("case-review-worker-prod");
factory.setPassword(secret);

factory.useSslProtocol();

try (Connection connection = factory.newConnection("case-review-worker")) {
    // create channels
}
```

Untuk production, jangan hanya `useSslProtocol()` tanpa memikirkan truststore/hostname verification. Pastikan JVM truststore mengenal CA broker, dan certificate broker punya SAN yang sesuai hostname.

Contoh system properties:

```bash
-Djavax.net.ssl.trustStore=/etc/secrets/rabbitmq-truststore.p12
-Djavax.net.ssl.trustStorePassword=${TRUSTSTORE_PASSWORD}
-Djavax.net.ssl.trustStoreType=PKCS12
```

Untuk mTLS:

```bash
-Djavax.net.ssl.keyStore=/etc/secrets/client-keystore.p12
-Djavax.net.ssl.keyStorePassword=${KEYSTORE_PASSWORD}
-Djavax.net.ssl.keyStoreType=PKCS12
-Djavax.net.ssl.trustStore=/etc/secrets/rabbitmq-truststore.p12
-Djavax.net.ssl.trustStorePassword=${TRUSTSTORE_PASSWORD}
-Djavax.net.ssl.trustStoreType=PKCS12
```

### 9.4 Spring Boot TLS Concept

Contoh property style:

```yaml
spring:
  rabbitmq:
    host: rabbitmq.prod.internal
    port: 5671
    virtual-host: /case-management-prod
    username: case-review-worker-prod
    password: ${RABBITMQ_PASSWORD}
    ssl:
      enabled: true
      trust-store: file:/etc/secrets/rabbitmq-truststore.p12
      trust-store-password: ${RABBITMQ_TRUSTSTORE_PASSWORD}
      trust-store-type: PKCS12
      key-store: file:/etc/secrets/client-keystore.p12
      key-store-password: ${RABBITMQ_KEYSTORE_PASSWORD}
      key-store-type: PKCS12
```

Actual property names bisa berbeda tergantung Spring Boot version, jadi selalu cek dokumentasi versi yang dipakai.

### 9.5 TLS Failure Modes

Common issues:

| Symptom | Likely cause |
|---|---|
| handshake failure | protocol/cipher mismatch, wrong cert/key |
| unknown CA | truststore tidak berisi CA broker |
| hostname verification fail | SAN cert tidak match host |
| bad certificate | client cert tidak dipercaya |
| connection works locally but not in prod | berbeda DNS/SAN/network policy |
| sudden outage | certificate expired |

Operational requirement:

- monitor certificate expiry;
- rotate before expiry;
- test cert chain;
- automate deployment;
- maintain break-glass plan.

---

## 10. Secret Management

RabbitMQ credentials adalah production secrets.

Jangan:

```yaml
spring.rabbitmq.password: password123
```

Jangan:

```java
factory.setPassword("hardcoded-secret");
```

Jangan commit:

- password;
- keystore password;
- private key;
- definitions file berisi password hash tanpa governance;
- Kubernetes Secret manifest plaintext;
- `.env` production.

### 10.1 Secret Sources

Gunakan salah satu:

- Kubernetes Secrets + encryption at rest + RBAC;
- external secrets operator;
- Vault;
- AWS Secrets Manager;
- Azure Key Vault;
- GCP Secret Manager;
- platform-specific secret injection;
- service mesh identity/cert.

### 10.2 Credential Rotation Pattern

Rotation sulit jika setiap app hanya mendukung satu credential dan connection long-lived.

Safer rotation:

1. create new user/credential;
2. assign same minimal permissions;
3. deploy app version using new credential;
4. verify connections on new user;
5. revoke old user;
6. monitor failures;
7. remove old secret.

Alternative if password update in place:

1. update secret source;
2. force app reconnect/restart safely;
3. verify old connection behavior;
4. ensure no stale pods.

For zero-downtime service:

- rolling restart;
- readiness checks;
- connection recovery;
- bounded retry startup;
- no global outage during credential rotation.

### 10.3 Service Account Naming

Use explicit names:

```text
case-evidence-producer-prod
case-review-worker-prod
case-notification-consumer-prod
case-topology-deployer-prod
case-ops-readonly-prod
```

Avoid:

```text
app
service
rabbit
admin2
prod-user
```

Clear names help audit.

---

## 11. Topology Deployer Pattern

One common production pattern:

```text
CI/CD topology deployer
  - configure: approved resource patterns
  - write/read: none or minimal

Runtime producer
  - configure: none
  - write: selected exchange
  - read: none

Runtime consumer
  - configure: none
  - write: selected exchange if needed
  - read: selected queue
```

Why?

- topology changes are reviewed;
- app cannot accidentally declare wrong queue type;
- queue arguments/policies controlled;
- security review easier;
- production drift reduced.

### 11.1 Definitions File as Infrastructure Artifact

RabbitMQ definitions can include:

- vhosts;
- users;
- permissions;
- parameters;
- policies;
- queues;
- exchanges;
- bindings.

Use carefully:

- avoid storing raw secrets;
- environment overlays;
- review diffs;
- apply through pipeline;
- validate before prod;
- backup current definitions.

### 11.2 Runtime Declaration Trade-off

Spring AMQP often declares topology on app startup. This is convenient in dev, risky in prod.

Approach:

| Environment | Topology declaration |
|---|---|
| Local | App may auto-declare |
| Test | App/Testcontainers may auto-declare |
| Staging | Pipeline-declared preferred |
| Prod | Pipeline/operator-declared preferred |

Spring setting pattern:

```yaml
app:
  rabbitmq:
    declare-topology: false
```

Then validate existence at startup if needed.

---

## 12. Multi-Tenancy Design

RabbitMQ can support multi-tenancy, but you must choose the isolation level.

### 12.1 Isolation Levels

```text
Level 0: Shared cluster, shared vhost, shared exchanges/queues
Level 1: Shared cluster, shared vhost, tenant-aware routing keys/messages
Level 2: Shared cluster, shared vhost, per-tenant queues
Level 3: Shared cluster, per-tenant vhost
Level 4: Per-tenant cluster
Level 5: Per-tenant region/account/environment
```

Each level increases isolation and cost.

### 12.2 Decision Matrix

| Requirement | Better fit |
|---|---|
| Low cost, many small tenants | shared vhost + app auth |
| Separate consumer backlog per tenant | per-tenant queue or partition |
| Strong permission isolation | per-tenant vhost |
| Strong compliance/data residency | per-tenant cluster/region |
| Noisy-neighbor avoidance | per-tenant cluster or resource quotas |
| Tenant-specific retention | vhost/queue policy per tenant |
| Tenant-specific admin access | vhost/cluster separation |

### 12.3 Shared Vhost Tenant Model

Topology:

```text
exchange: case.events
routing key: tenant.<tenantHash>.case.evidence.submitted
queue: tenant.<tenantHash>.review.q
```

Message envelope:

```json
{
  "messageId": "01J...",
  "tenantId": "tenant-123",
  "messageType": "EvidenceSubmitted",
  "schemaVersion": 1,
  "payload": {}
}
```

Security issue:

- RabbitMQ does not enforce tenantId inside payload;
- any consumer with read access to shared queue can read all messages in that queue;
- producer with write access to exchange may publish fake tenantId unless app-level validation exists.

### 12.4 Per-Tenant Vhost Model

```text
/tenant-a-case
/tenant-b-case
/tenant-c-case
```

Pros:

- stronger isolation;
- simpler permission;
- easier per-tenant cleanup/export;
- easier tenant admin access;
- better blast radius.

Cons:

- metadata overhead;
- automation required;
- monitoring cardinality;
- onboarding/offboarding complexity;
- shared cluster still means shared node resources.

### 12.5 Per-Tenant Cluster

Use for high-risk/high-value tenants:

- regulatory isolation;
- noisy-neighbor prevention;
- data residency;
- custom lifecycle;
- dedicated ops controls.

Cost:

- more clusters;
- more upgrades;
- more monitoring;
- more capacity planning;
- more incident paths.

---

## 13. Message Data Security

Transport security and permissions do not solve payload policy.

Questions:

- Should this data be in a message at all?
- Does payload contain PII?
- Does DLQ retain sensitive data longer than allowed?
- Can message be replayed after legal state changed?
- Are attachments embedded?
- Are secrets accidentally included?
- Is message encrypted end-to-end?
- Are logs redacting headers/payload?

### 13.1 Do Not Put Large/Sensitive Documents in RabbitMQ

Bad:

```json
{
  "caseId": "CASE-123",
  "evidencePdfBase64": "...huge...",
  "passportScanBase64": "..."
}
```

Better:

```json
{
  "caseId": "CASE-123",
  "evidenceId": "EVD-999",
  "documentRef": "evidence-store://bucket/key",
  "contentHash": "sha256:...",
  "classification": "CONFIDENTIAL"
}
```

RabbitMQ should carry coordination data, not become a document store.

### 13.2 PII Minimization

Message contract should include:

```json
{
  "caseId": "CASE-123",
  "tenantId": "TEN-456",
  "actorId": "USR-789",
  "eventType": "EvidenceSubmitted",
  "evidenceId": "EVD-111"
}
```

Not:

```json
{
  "fullName": "...",
  "nationalId": "...",
  "address": "...",
  "rawDocumentText": "..."
}
```

Unless truly needed.

### 13.3 End-to-End Payload Encryption

TLS protects in transit. It does not protect:

- broker memory;
- broker disk;
- DLQ inspection;
- management users with message get capability;
- backups;
- logs if payload logged;
- consumers with read permission.

For highly sensitive payloads, consider application-level encryption:

```text
producer encrypts payload with domain key
broker routes opaque ciphertext
authorized consumer decrypts
```

Trade-offs:

- broker cannot inspect payload;
- debugging harder;
- key rotation complexity;
- DLQ remediation harder;
- schema validation must occur before encryption or after decryption;
- filtering by payload impossible.

### 13.4 Message Retention and Deletion

Queues, DLQs, retry queues, and streams may retain sensitive data.

Define:

- max queue length;
- message TTL;
- DLQ retention;
- stream retention by size/time;
- legal hold rules;
- replay eligibility;
- purge approval process.

Do not let DLQ become an ungoverned sensitive data warehouse.

---

## 14. Management UI and HTTP API Security

Management UI is powerful.

It can expose:

- queues;
- exchanges;
- bindings;
- connections;
- channels;
- consumers;
- message rates;
- users;
- permissions;
- policies;
- definitions;
- sometimes message get/publish operations depending permissions.

Rules:

1. never expose management UI publicly;
2. protect with VPN/private network/SSO;
3. use HTTPS;
4. use individual users;
5. avoid sharing admin account;
6. restrict management tags;
7. audit access;
8. do not allow random developers to get messages from prod queues;
9. separate read-only monitoring from admin rights.

### 14.1 Management Tags

RabbitMQ users can have tags such as administrator/monitoring/policymaker/management depending setup.

Design:

| User type | Capability |
|---|---|
| monitoring | observe metrics |
| policymaker | manage policies, not full admin |
| management | access management UI for permitted resources |
| administrator | full control, limited people only |

Avoid giving `administrator` just to view queue depth.

### 14.2 Message Get from UI

`Get messages` is dangerous in production:

- can remove messages if ack mode selected incorrectly;
- exposes sensitive payload;
- bypasses normal consumer audit;
- can change system behavior.

Production rule:

```text
Message inspection requires incident/change ticket, read-only clone/shadow queue if possible, and redaction policy.
```

For DLQ investigation, prefer tooling that:

- samples safely;
- redacts sensitive fields;
- logs access;
- does not accidentally ack/drop messages.

---

## 15. Network Boundary

RabbitMQ should typically not be internet-facing.

Recommended network posture:

```text
Application subnets -> AMQP TLS listener
Admin VPN/bastion -> Management HTTPS
Monitoring system -> Prometheus endpoint
No public access
```

Controls:

- firewall/security groups;
- Kubernetes NetworkPolicy;
- service mesh policy;
- private DNS;
- no public load balancer unless explicitly required;
- IP allowlist for admin access;
- rate/connection limits if exposed to semi-trusted clients.

### 15.1 Cross-Region Bridges

For Shovel/Federation:

- use TLS;
- dedicated user;
- dedicated vhost where possible;
- narrow permissions;
- avoid admin credentials;
- monitor bridge connections;
- handle duplicate/replay explicitly.

### 15.2 Client Connection Naming

Java client supports connection names.

Use them:

```java
Connection connection = factory.newConnection("case-review-worker-prod/pod-abc123");
```

Why:

- easier incident triage;
- identify rogue clients;
- map connections to deployments;
- audit runtime behavior.

---

## 16. Resource Limits and Abuse Prevention

Security includes preventing accidental or malicious resource exhaustion.

Controls:

- max connections;
- max channels;
- queue length limit;
- message TTL;
- max message size policy at app boundary;
- per-vhost limits;
- operator policies;
- memory/disk alarms;
- stream retention;
- prefetch limits;
- publisher in-flight limits.

### 16.1 Untrusted Producers

If external/semi-trusted producer can publish:

- validate message size before broker if possible;
- use dedicated ingress exchange/vhost;
- restrict routing keys;
- use schema validation at ingress service;
- avoid direct write to internal command exchange;
- rate limit;
- isolate DLQ;
- reject unknown tenants.

Better architecture:

```text
External client -> API Gateway -> Ingress Service -> RabbitMQ internal exchange
```

Not:

```text
External client -> RabbitMQ directly -> internal command queue
```

Unless you have very strong reason and controls.

---

## 17. Java/Spring Security Configuration Pattern

### 17.1 Configuration Object

```java
@ConfigurationProperties(prefix = "app.rabbitmq")
public record RabbitSecurityProperties(
    String host,
    int port,
    String virtualHost,
    String username,
    String password,
    boolean sslEnabled
) {}
```

### 17.2 Connection Factory

```java
@Configuration
@EnableConfigurationProperties(RabbitSecurityProperties.class)
class RabbitConnectionConfig {

    @Bean
    CachingConnectionFactory rabbitConnectionFactory(RabbitSecurityProperties props) throws Exception {
        com.rabbitmq.client.ConnectionFactory nativeFactory = new com.rabbitmq.client.ConnectionFactory();
        nativeFactory.setHost(props.host());
        nativeFactory.setPort(props.port());
        nativeFactory.setVirtualHost(props.virtualHost());
        nativeFactory.setUsername(props.username());
        nativeFactory.setPassword(props.password());
        nativeFactory.setAutomaticRecoveryEnabled(true);
        nativeFactory.setTopologyRecoveryEnabled(false);
        nativeFactory.setConnectionTimeout(10_000);
        nativeFactory.setRequestedHeartbeat(30);

        if (props.sslEnabled()) {
            nativeFactory.useSslProtocol();
        }

        CachingConnectionFactory springFactory = new CachingConnectionFactory(nativeFactory);
        springFactory.setConnectionNameStrategy(cf -> "case-review-worker-prod");
        springFactory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        springFactory.setPublisherReturns(true);
        return springFactory;
    }
}
```

Important:

- real production TLS should configure truststore/keystore properly;
- connection name should include service/pod/env;
- topology recovery disabled if topology is pipeline-managed;
- credentials come from secret manager/env injection;
- do not log password.

### 17.3 Startup Permission Smoke Test

At startup, fail fast if permission/topology invalid.

But avoid destructive tests.

Possible checks:

- passive declare expected queue/exchange;
- publish to health exchange in non-prod;
- verify consumer can start;
- verify listener container health;
- check vhost configured correctly.

Example passive declare:

```java
channel.exchangeDeclarePassive("case.events");
channel.queueDeclarePassive("case.review.assignment.q");
```

If permission insufficient or resource missing, fail before processing traffic.

---

## 18. Designing Service Permissions: Examples

### 18.1 Evidence Service Producer

Needs:

- publish `EvidenceSubmitted` event;
- no consume;
- no topology mutation.

```bash
rabbitmqctl add_user case-evidence-producer-prod '<secret>'
rabbitmqctl set_permissions -p /case-management-prod case-evidence-producer-prod \
  '^$' \
  '^case\.events$' \
  '^$'
```

### 18.2 Review Worker Consumer

Needs:

- consume assignment queue;
- publish review result event;
- maybe publish retry command if app-managed retry.

```bash
rabbitmqctl add_user case-review-worker-prod '<secret>'
rabbitmqctl set_permissions -p /case-management-prod case-review-worker-prod \
  '^$' \
  '^(case\.events|case\.retry)$' \
  '^case\.review\.assignment\.q$'
```

### 18.3 Notification Worker

Needs:

- consume notification queue;
- maybe publish notification result.

```bash
rabbitmqctl set_permissions -p /case-management-prod case-notification-worker-prod \
  '^$' \
  '^case\.events$' \
  '^case\.notification\.email\.q$'
```

### 18.4 Topology Deployer

Needs:

- configure approved resources;
- not consume messages;
- perhaps write none.

```bash
rabbitmqctl set_permissions -p /case-management-prod case-topology-deployer-prod \
  '^case\..*' \
  '^$' \
  '^$'
```

Be careful: configure broad pattern can still mutate critical resources. Restrict deployer use to CI/CD.

### 18.5 DLQ Remediation Tool

Needs:

- read DLQ;
- write replay exchange;
- no configure.

```bash
rabbitmqctl set_permissions -p /case-management-prod case-dlq-remediator-prod \
  '^$' \
  '^case\.replay$' \
  '^case\..*\.dlq$'
```

Add app-level controls:

- operator identity;
- ticket id;
- sample limit;
- replay count limit;
- redaction;
- audit log.

---

## 19. Security for DLQ, Retry, Parking Lot

DLQ often contains the most sensitive and messy data:

- failed commands;
- validation errors;
- stack traces in headers if poorly designed;
- external system responses;
- PII payload;
- poison messages;
- unknown schema versions;
- partially processed workflow state.

Rules:

1. DLQ is production data.
2. DLQ read access should be stricter than normal queue read access.
3. DLQ replay requires audit.
4. DLQ messages should not be manually edited casually.
5. DLQ retention must be explicit.
6. DLQ dashboards should avoid dumping payload.
7. DLQ tooling should redact.
8. Parking lot access should be operationally controlled.

Anti-pattern:

```text
Everyone gets read access to *.dlq so they can debug faster.
```

Better:

```text
DLQ access via remediation service with RBAC, audit, sampling, redaction, and replay workflow.
```

---

## 20. Security for RabbitMQ Streams

Streams introduce additional concerns:

- long retention;
- replay capability;
- historical data exposure;
- offset-based reprocessing;
- consumer can read old messages if authorized;
- stream may be audit-grade data.

A user with read access to a stream may read historical messages depending stream semantics and retention.

Therefore:

- treat stream read permission as access to history;
- avoid putting secrets/large PII in stream;
- use retention policy aligned with compliance;
- control replay tooling;
- log replay jobs;
- distinguish live consumer from replay consumer credentials.

Example users:

```text
case-audit-live-projector-prod
case-audit-replay-tool-prod
case-audit-admin-prod
```

Permissions should differ.

Replay tool should require stronger controls than live projector.

---

## 21. Security for Shovel and Federation

Shovel/Federation users are high-risk because they move messages across brokers.

Bad:

```text
Shovel uses admin credentials on source and destination.
```

Better:

```text
source bridge user:
- read only bridge source queue/exchange as needed

destination bridge user:
- write only destination exchange
```

Controls:

- dedicated users;
- TLS;
- narrow vhost;
- narrow permission;
- no management admin;
- monitor message rates;
- loop prevention;
- data classification review;
- cross-region audit.

If bridge crosses legal/data-residency boundary, message contract must be reviewed.

---

## 22. Observability and Auditability

Security without observability is wishful thinking.

Monitor:

- failed authentication attempts;
- connection count by user;
- unexpected users connected;
- connections from unexpected IPs;
- management login activity;
- permission changes;
- user creation/deletion;
- policy changes;
- topology changes;
- shovel/federation changes;
- DLQ get/replay operations;
- stream replay jobs;
- certificate expiry;
- plaintext listener usage;
- queue creation spikes.

### 22.1 Runtime Labels

At minimum, each connection should reveal:

```text
service name
instance/pod id
environment
version
vhost
username
client properties
```

This allows incident questions:

- Which service published spike traffic?
- Which pod holds unacked messages?
- Which user opened suspicious connection?
- Which consumer started replaying old stream data?

### 22.2 Audit Events in Application Layer

For domain-sensitive operations, emit audit events:

```json
{
  "auditEventType": "DLQ_MESSAGE_REPLAYED",
  "operatorId": "ops-user-123",
  "ticketId": "INC-456",
  "sourceQueue": "case.review.assignment.dlq",
  "messageId": "01J...",
  "reason": "fixed schema migration bug",
  "timestamp": "2026-06-19T10:15:30Z"
}
```

RabbitMQ admin audit alone may not capture business context.

---

## 23. Production Hardening Checklist

### 23.1 Broker Exposure

- [ ] AMQP not public unless intentionally designed.
- [ ] Management UI not public.
- [ ] TLS enabled for AMQP in prod.
- [ ] HTTPS enabled for management UI.
- [ ] Plaintext listeners disabled or strictly internal.
- [ ] Firewall/security groups restrict access.
- [ ] Kubernetes NetworkPolicy restricts pod access.

### 23.2 Identity

- [ ] Default `guest` removed/disabled in prod.
- [ ] One user per service per environment.
- [ ] Human users not shared.
- [ ] Admin user not used by applications.
- [ ] SSO/LDAP/OAuth considered for human/admin access.
- [ ] Credential rotation process tested.

### 23.3 Authorization

- [ ] Runtime apps have minimal configure permission.
- [ ] Producers have write only to required exchanges.
- [ ] Consumers have read only to required queues.
- [ ] DLQ access restricted.
- [ ] Stream replay access restricted.
- [ ] Shovel/Federation users are narrow.
- [ ] Permission regex reviewed.

### 23.4 Topology

- [ ] Resource naming supports permission regex.
- [ ] Topology declaration strategy defined.
- [ ] Prod topology changes through pipeline/review.
- [ ] Policies controlled by ops/platform.
- [ ] No random app can create unbounded queues.

### 23.5 Payload

- [ ] PII minimized.
- [ ] Large binary payloads not embedded.
- [ ] Secret fields not included.
- [ ] DLQ retention defined.
- [ ] Stream retention defined.
- [ ] Payload encryption considered for sensitive domains.
- [ ] Logs redact payload/headers.

### 23.6 Operations

- [ ] Certificate expiry monitored.
- [ ] Auth failures monitored.
- [ ] Unexpected connection/user alert exists.
- [ ] Management actions audited.
- [ ] DLQ replay audited.
- [ ] Definitions backed up.
- [ ] Break-glass admin procedure defined.

---

## 24. Failure and Attack Scenarios

### Scenario 1: Producer Credential Leaked

If producer only has:

```text
write: ^case\.events$
read: ^$
configure: ^$
```

Attacker can:

- publish fake events to `case.events`.

Attacker cannot:

- read queues;
- delete topology;
- create queue;
- consume DLQ;
- access other vhost.

Application still needs:

- message signature or producer allowlist for high-risk commands/events;
- anomaly detection;
- credential revocation;
- idempotency/validation.

### Scenario 2: Consumer Credential Leaked

If consumer has:

```text
read: ^case\.review\.assignment\.q$
write: ^case\.events$
configure: ^$
```

Attacker can:

- consume assigned work;
- possibly ack/drop messages;
- publish output events.

Mitigations:

- narrow queue access;
- monitor unexpected connection name/IP;
- use mTLS;
- revoke credential;
- replay from DLQ/outbox/audit if possible;
- design consumer actions idempotently.

### Scenario 3: Admin Credential Leaked

Attacker can likely:

- delete queues;
- purge queues;
- create users;
- change permissions;
- export definitions;
- inspect data;
- create shovels;
- disrupt cluster.

Mitigations:

- admin access behind SSO/MFA/VPN;
- no shared admin;
- monitor admin events;
- break-glass only;
- backups;
- least privilege operator roles.

### Scenario 4: Rogue Service Creates Queue Bound to Sensitive Exchange

If service has configure on broad names and write/read broad access, it can:

```text
declare queue rogue.q
bind rogue.q to case.events with #
consume all case events
```

Mitigation:

- no broad configure;
- narrow read;
- exchange access controlled;
- topology change audit;
- policies/naming convention.

### Scenario 5: DLQ Contains PII and Everyone Can Read It

Impact:

- sensitive payload exposure;
- compliance breach;
- incident data spread through screenshots/logs;
- uncontrolled replay.

Mitigation:

- restrict DLQ read;
- redaction tool;
- payload minimization;
- retention;
- audit remediation.

---

## 25. Regulatory Case Management Example

Domain:

- evidence submitted;
- risk evaluated;
- enforcement action proposed;
- review assigned;
- escalation triggered;
- notification sent;
- audit archived.

### 25.1 Vhost

```text
/case-management-prod
```

### 25.2 Resources

```text
Exchanges:
- case.events
- case.commands
- case.retry
- case.dlx
- case.audit

Queues:
- case.risk.evaluate.q
- case.review.assign.q
- case.notification.email.q
- case.risk.evaluate.dlq
- case.review.assign.dlq
- case.notification.email.dlq

Streams:
- case.audit.stream
```

### 25.3 Users

```text
case-topology-deployer-prod
case-evidence-producer-prod
case-risk-worker-prod
case-review-worker-prod
case-notification-worker-prod
case-audit-projector-prod
case-dlq-remediator-prod
case-ops-monitor-prod
```

### 25.4 Permission Sketch

Evidence producer:

```text
configure: ^$
write: ^case\.events$
read: ^$
```

Risk worker:

```text
configure: ^$
write: ^(case\.events|case\.retry)$
read: ^case\.risk\.evaluate\.q$
```

Review worker:

```text
configure: ^$
write: ^(case\.events|case\.retry)$
read: ^case\.review\.assign\.q$
```

Notification worker:

```text
configure: ^$
write: ^case\.events$
read: ^case\.notification\.email\.q$
```

Audit projector:

```text
configure: ^$
write: ^$
read: ^case\.audit\.stream$
```

DLQ remediator:

```text
configure: ^$
write: ^case\.replay$
read: ^case\..*\.dlq$
```

### 25.5 Message Contract Security

Envelope:

```json
{
  "messageId": "01JZ...",
  "messageType": "EnforcementActionProposed",
  "schemaVersion": 3,
  "tenantId": "TEN-123",
  "caseId": "CASE-456",
  "actorId": "USR-789",
  "correlationId": "COR-111",
  "causationId": "MSG-222",
  "reasonCode": "RISK_THRESHOLD_EXCEEDED",
  "policyVersion": "risk-policy-2026.06",
  "dataClassification": "CONFIDENTIAL",
  "payload": {
    "actionProposalId": "ACT-999"
  }
}
```

Notice:

- no raw evidence document;
- no full citizen profile;
- reference ids only;
- policy version included;
- classification explicit;
- traceability fields included.

### 25.6 Replay Governance

If DLQ replay happens:

- operator identity required;
- ticket id required;
- replay reason required;
- maximum batch size;
- dry-run mode;
- idempotency check;
- audit event emitted;
- payload redacted in UI.

---

## 26. Common Anti-Patterns

### Anti-Pattern 1: One RabbitMQ User for All Apps

```text
username: app
permissions: .*
```

This destroys least privilege and auditability.

### Anti-Pattern 2: Runtime App Uses Admin

Admin credential in app config is a production incident waiting to happen.

### Anti-Pattern 3: Broad Configure Permission

```text
configure: .*
```

The service can mutate broker topology. That is rarely acceptable.

### Anti-Pattern 4: Management UI Publicly Exposed

Even with password, this is high risk.

### Anti-Pattern 5: No TLS Because “Private Network”

Private networks are not magical. TLS also helps prevent credential leakage and accidental routing through insecure paths.

### Anti-Pattern 6: DLQ as Open Debug Bucket

DLQ can contain sensitive business data and must be governed.

### Anti-Pattern 7: Sensitive Documents in Messages

Broker is not a secure document repository.

### Anti-Pattern 8: Vhost Explosion without Automation

Per-tenant vhost is good only if provisioning, permission, monitoring, backup, and cleanup are automated.

### Anti-Pattern 9: OAuth/LDAP Added without Break-Glass Plan

If identity provider is down, can operators still recover broker safely?

### Anti-Pattern 10: No Credential Rotation Test

A rotation process that has never been tested is an outage plan.

---

## 27. Architecture Review Questions

Ask these in design review:

1. Which vhost will this service use?
2. What exact exchanges can it write to?
3. What exact queues can it read from?
4. Does it need configure permission in production?
5. Who creates topology?
6. How are credentials stored?
7. How are credentials rotated?
8. Is TLS enabled and validated?
9. Is management UI exposed only to admin network?
10. Does any message contain PII/secrets/large binary?
11. What is DLQ retention?
12. Who can inspect DLQ messages?
13. Who can replay DLQ messages?
14. What is stream retention?
15. Can replay expose historical sensitive data?
16. Are tenant boundaries broker-level or application-level?
17. How is tenant authorization enforced?
18. What happens if a producer credential leaks?
19. What happens if a consumer credential leaks?
20. What happens if admin credential leaks?
21. Are Shovel/Federation users narrow?
22. Are connection names meaningful?
23. Are auth failures monitored?
24. Are topology changes audited?
25. Is there a break-glass admin process?

---

## 28. Practical Lab

### 28.1 Create Vhost

```bash
rabbitmqctl add_vhost /case-management-prod
```

### 28.2 Create Users

```bash
rabbitmqctl add_user case-evidence-producer-prod 'change-me-strong'
rabbitmqctl add_user case-review-worker-prod 'change-me-strong'
rabbitmqctl add_user case-topology-deployer-prod 'change-me-strong'
```

### 28.3 Assign Permissions

Producer:

```bash
rabbitmqctl set_permissions -p /case-management-prod case-evidence-producer-prod \
  '^$' \
  '^case\.events$' \
  '^$'
```

Consumer:

```bash
rabbitmqctl set_permissions -p /case-management-prod case-review-worker-prod \
  '^$' \
  '^(case\.events|case\.retry)$' \
  '^case\.review\.assignment\.q$'
```

Topology deployer:

```bash
rabbitmqctl set_permissions -p /case-management-prod case-topology-deployer-prod \
  '^case\..*' \
  '^$' \
  '^$'
```

### 28.4 Verify Permissions

```bash
rabbitmqctl list_permissions -p /case-management-prod
rabbitmqctl list_user_permissions case-review-worker-prod
```

### 28.5 Negative Test

Try to consume using producer credential. It should fail.

Try to publish to unauthorized exchange. It should fail.

Try to declare queue using runtime producer credential. It should fail.

Security tests should include negative tests, not only happy path.

---

## 29. Mini Quiz

### Question 1

A service only publishes events to `case.events`. What permissions should it have?

Recommended:

```text
configure: ^$
write: ^case\.events$
read: ^$
```

### Question 2

Why is configure permission dangerous?

Because it can allow topology mutation: declare/delete queues/exchanges/bindings, create unexpected queues, bind to sensitive exchanges, and cause resource exhaustion.

### Question 3

Does TLS protect messages from broker admins?

No. TLS protects traffic in transit. Broker-side access, disk, memory, DLQ inspection, and consumers with read permission remain separate concerns.

### Question 4

Why should DLQ read access be restricted?

DLQ may contain sensitive failed payloads, business context, validation errors, and data that normal consumers never expose. DLQ inspection/replay is operationally sensitive.

### Question 5

Should RabbitMQ enforce tenant-level business authorization?

No. RabbitMQ can enforce resource-level permissions. Tenant/domain authorization must be handled by application design, topology isolation, vhost strategy, and message contract validation.

---

## 30. Key Takeaways

1. RabbitMQ security is not only password management.
2. Vhost is the main RabbitMQ isolation boundary.
3. Permission regex quality depends on naming quality.
4. Runtime apps should not use admin credentials.
5. `configure` permission is powerful and should be minimized.
6. Producers usually need write-only access to specific exchanges.
7. Consumers usually need read-only access to specific queues plus limited write if they publish results/retries.
8. TLS should be standard in production.
9. Secret rotation must be designed and tested.
10. DLQ, retry queues, and streams require stronger data governance than many teams expect.
11. Multi-tenancy is a spectrum: shared vhost, per-tenant queue, per-tenant vhost, per-tenant cluster.
12. RabbitMQ authorization is resource-level, not domain-level.
13. Management UI/API access is high-risk and must be restricted.
14. Stream read access means historical data access.
15. Shovel/Federation users can exfiltrate data if over-permissioned.
16. Security must be observable: failed auth, unexpected users, topology changes, replay operations.

---

## 31. Where This Leads Next

This part established the security model needed before serious production operation.

Next part:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-25.md
```

Topic:

```text
Observability: Metrics, Logs, Tracing, and Message Forensics
```

Security and observability are connected: you cannot secure what you cannot see, and you cannot debug what you cannot correlate.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-23.md">⬅️ Part 23 — Federation, Shovel, Multi-Region, and Edge Messaging</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-25.md">Part 25 — Observability: Metrics, Logs, Tracing, and Message Forensics ➡️</a>
</div>
