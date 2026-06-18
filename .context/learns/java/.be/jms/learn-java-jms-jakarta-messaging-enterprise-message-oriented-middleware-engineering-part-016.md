# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-016

# Part 16 — Security Model: Authentication, Authorization, TLS, Secret Handling, dan Multi-Tenant Messaging

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Bagian: 16 dari 35  
> Target Java: Java 8 sampai Java 25  
> API: JMS 1.1/2.0 (`javax.jms`) dan Jakarta Messaging 3.x (`jakarta.jms`)  
> Fokus: keamanan end-to-end pada sistem JMS/Jakarta Messaging: identity, credential, TLS/mTLS, authorization per destination, tenant isolation, secret rotation, message confidentiality, auditability, dan failure mode keamanan di production.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kita ingin mampu:

1. Memahami bahwa keamanan JMS bukan hanya `username/password` pada `ConnectionFactory`, tetapi gabungan dari **transport security**, **broker authentication**, **destination authorization**, **message-level confidentiality**, **application-level authorization**, **secret lifecycle**, dan **operational auditability**.
2. Mendesain koneksi JMS yang aman untuk Java 8 sampai Java 25, baik di aplikasi standalone, Spring Boot, Jakarta EE, maupun containerized runtime.
3. Membedakan tanggung jawab keamanan antara:
   - aplikasi producer,
   - aplikasi consumer,
   - broker,
   - network layer,
   - identity provider,
   - secret manager,
   - operator/admin,
   - audit/compliance layer.
4. Menentukan kapan cukup memakai TLS, kapan perlu mTLS, kapan perlu payload encryption, dan kapan perlu tenant-level physical/logical isolation.
5. Menghindari anti-pattern: shared broker credential, wildcard destination access, insecure deserialization, token/password di message body, logging payload sensitif, dan DLQ yang menjadi tempat bocornya data.
6. Mendesain authorization model yang defensible untuk enterprise/regulated system.
7. Menyusun checklist keamanan JMS untuk design review, production readiness, incident response, dan audit.

---

## 2. Posisi Part Ini dalam Seri

Sampai Part 15, kita sudah membahas bagaimana message dikirim, diterima, di-ack, diulang, difilter, dan dipakai untuk koordinasi sistem.

Part 16 menjawab pertanyaan berbeda:

> “Siapa yang boleh melakukan apa terhadap message apa, melalui jalur apa, dengan bukti apa, dan bagaimana kita tahu bahwa sistem tetap aman ketika ada failure?”

Ini penting karena messaging sering menjadi **jalur internal yang terlalu dipercaya**.

Dalam banyak sistem enterprise, HTTP API publik diberi proteksi kuat: OAuth2, OIDC, API gateway, WAF, rate limit, audit, dan schema validation. Tetapi jalur JMS internal kadang dibiarkan longgar:

```text
- satu username/password dipakai semua service,
- semua service boleh send/consume semua queue,
- TLS dimatikan di internal network,
- payload sensitif masuk log,
- DLQ bisa dibaca operator terlalu luas,
- replay tooling tidak punya approval trail,
- message lama masih bisa diproses setelah authorization rule berubah.
```

Ini berbahaya. JMS sering membawa data yang lebih sensitif daripada HTTP API karena message mengandung state transition, user identity, business event, case data, dan payload integrasi antar sistem.

Mental model awal:

```text
JMS security is not one control.
JMS security is a chain of controls.

If any link is weak, the message path becomes weak.
```

---

## 3. JMS Security Bukan Bagian Tunggal dari Spec

JMS/Jakarta Messaging adalah **API messaging**. Ia mendefinisikan cara aplikasi Java membuat, mengirim, menerima, dan membaca message melalui provider. Jakarta Messaging specification sendiri juga menyatakan bahwa full Jakarta EE platform menyediakan messaging provider, dan fitur tambahan seperti MDB dan Jakarta Transactions tersedia di Jakarta EE runtime.

Namun detail keamanan seperti:

- user store,
- role store,
- ACL destination,
- TLS connector,
- mTLS certificate mapping,
- audit log broker,
- LDAP integration,
- Kerberos integration,
- OAuth integration,
- JAAS module,
- vault/secret integration,
- DLQ permission,
- broker clustering security,

biasanya adalah **provider-specific** dan **runtime-specific**.

Artinya:

```text
JMS API gives common programming model.
Provider gives security behavior.
Deployment gives actual security posture.
```

Contoh provider/runtime:

```text
- ActiveMQ Artemis
- ActiveMQ Classic
- IBM MQ
- Solace PubSub+
- TIBCO EMS
- Open Liberty messaging integration
- WildFly / EAP resource adapter
- WebLogic JMS
- RabbitMQ JMS client
```

Jangan pernah mendesain keamanan JMS hanya berdasarkan kode Java producer/consumer. Kita harus membaca:

```text
1. JMS/Jakarta Messaging API contract
2. broker security model
3. application server resource adapter model
4. network topology
5. secret management policy
6. operational procedure
7. compliance/audit requirement
```

---

## 4. Threat Model: Apa yang Harus Dilindungi?

Sebelum bicara TLS, ACL, dan credential, kita harus tahu ancamannya.

### 4.1 Asset yang Dilindungi

Dalam sistem JMS, asset utama adalah:

1. **Message payload**  
   Data bisnis, PII, case details, document metadata, decision outcome, approval state, transaction amount, correspondence content.

2. **Message metadata**  
   Correlation id, tenant id, module id, user id, case id, event type, priority, routing property.

3. **Destination topology**  
   Nama queue/topic bisa mengungkap domain internal.

4. **Broker credential**  
   User/password/certificate/token yang bisa dipakai untuk connect, send, consume, browse, purge, atau administer destination.

5. **Replay capability**  
   Ability untuk mengirim ulang message lama. Dalam regulated system, replay bisa mengubah state jika handler tidak idempotent.

6. **DLQ / parking lot**  
   Tempat berkumpulnya message gagal. Sering mengandung payload lengkap dan error context.

7. **Operational console**  
   Admin UI/CLI untuk browse message, delete queue, purge, move, replay, change ACL.

8. **Audit trail**  
   Bukti siapa melakukan operasi apa, kapan, terhadap message/destination apa.

### 4.2 Actor yang Perlu Dimodelkan

Actor bukan hanya hacker eksternal.

```text
External attacker
Compromised service
Buggy producer
Buggy consumer
Malicious insider
Over-privileged operator
Expired credential still active
Misconfigured deployment
CI/CD pipeline leak
Observability/logging pipeline leak
Replay tool misuse
Test environment data leakage
```

Dalam enterprise, banyak incident bukan karena cryptography rusak, tetapi karena:

```text
- credential dipakai bersama,
- ACL terlalu luas,
- test tool punya akses prod,
- DLQ dibrowse tanpa masking,
- log centralizer menyimpan payload sensitif,
- admin console expose ke network yang salah,
- queue purge dilakukan tanpa approval,
- replay dilakukan tanpa idempotency verification.
```

### 4.3 Threat Scenarios

Beberapa skenario konkret:

| Scenario | Dampak |
|---|---|
| Service A credential bocor dan boleh consume semua queue | Data exfiltration lintas domain |
| Producer palsu send command ke queue case approval | Unauthorized state transition |
| Consumer membaca queue yang bukan domainnya | Tenant/data boundary breach |
| TLS tidak aktif di network internal | Payload bisa disadap di lateral movement |
| DLQ dapat dibrowse oleh semua operator | Data sensitif bocor dari failure path |
| Selector memakai `tenantId` tapi producer bisa memalsukan property | Tenant isolation palsu |
| Replay message lama tanpa validation | State regression atau duplicate decision |
| Message mengandung serialized Java object | Deserialization attack / compatibility failure |
| Shared topic wildcard subscription | Service melihat event yang tidak berhak |
| Broker admin credential ada di image/container | Credential leak permanen |

---

## 5. Security Control Layers

Security JMS harus dilihat sebagai beberapa lapisan.

```text
+---------------------------------------------------------------+
| Application authorization                                     |
| - business permission                                         |
| - command validation                                          |
| - tenant ownership                                            |
| - idempotency / replay safety                                 |
+---------------------------------------------------------------+
| Message contract security                                     |
| - schema validation                                           |
| - trusted producer identity                                   |
| - correlation / audit metadata                                |
| - signature / encryption when needed                          |
+---------------------------------------------------------------+
| JMS provider authorization                                    |
| - send permission                                             |
| - consume permission                                          |
| - browse permission                                           |
| - create/delete/admin permission                              |
+---------------------------------------------------------------+
| Broker authentication                                         |
| - username/password                                           |
| - certificate                                                 |
| - JAAS/LDAP/Kerberos/OAuth/provider-specific integration      |
+---------------------------------------------------------------+
| Transport security                                            |
| - TLS                                                         |
| - mTLS                                                        |
| - hostname verification                                       |
| - truststore/keystore                                         |
+---------------------------------------------------------------+
| Network and platform security                                 |
| - subnet/security group/network policy                        |
| - secret manager                                              |
| - pod identity / IAM                                          |
| - filesystem permission                                       |
| - admin console restriction                                   |
+---------------------------------------------------------------+
| Governance and audit                                          |
| - access review                                               |
| - audit log                                                   |
| - approval workflow                                           |
| - incident response                                           |
+---------------------------------------------------------------+
```

Top 1% mindset:

> Jangan bertanya “apakah JMS kita pakai password?”  
> Bertanyalah “apa invariant keamanan dari message path end-to-end, dan kontrol mana yang membuktikan invariant itu?”

---

## 6. Authentication: Membuktikan Siapa yang Connect ke Broker

Authentication menjawab:

```text
Who is this JMS client?
```

Di kode JMS klasik:

```java
ConnectionFactory factory = ...;
Connection connection = factory.createConnection("case-service", password);
connection.start();
```

Di JMS 2.0 / Jakarta Messaging simplified API:

```java
JMSContext context = connectionFactory.createContext("case-service", password);
```

Atau credential diberikan oleh container/resource adapter, bukan langsung di kode.

### 6.1 Prinsip Credential per Application Identity

Jangan gunakan satu credential bersama untuk semua aplikasi.

Buruk:

```text
username = app
password = same-for-all-services
```

Lebih baik:

```text
case-command-producer
case-command-consumer
appeal-event-publisher
correspondence-email-worker
audit-event-writer
reporting-event-reader
```

Alasannya:

1. Bisa menerapkan least privilege per service.
2. Bisa revoke satu service tanpa mematikan semua.
3. Audit log broker lebih bermakna.
4. Blast radius credential leak lebih kecil.
5. Bisa rotasi bertahap.

### 6.2 Identity Harus Stabil dan Bermakna

Nama user/client identity sebaiknya bukan nama developer, bukan nama pod random, dan bukan nama environment saja.

Buruk:

```text
admin
jmsuser
test
aceas
prod-client
```

Lebih baik:

```text
prod.case-management.command-consumer
prod.case-management.event-publisher
prod.appeal-management.command-consumer
uat.case-management.command-consumer
```

Namun hindari memasukkan data sensitif ke username. Identity cukup untuk audit dan ACL.

### 6.3 Password vs Certificate vs Token

Pilihan authentication tergantung provider:

| Mode | Cocok untuk | Risiko |
|---|---|---|
| Username/password | setup sederhana, legacy JMS, app server resource | raw secret harus dikelola/dirotasi |
| Client certificate / mTLS | high-security internal system, service identity kuat | lifecycle certificate lebih kompleks |
| Kerberos/LDAP/JAAS | enterprise identity existing | integrasi dan troubleshooting kompleks |
| OAuth/token provider-specific | cloud/integration modern | token refresh, support berbeda per provider |
| Container-managed credential | Jakarta EE/app server | hidden config harus diaudit |

### 6.4 Authentication Bukan Authorization

Kesalahan umum:

```text
Client can connect == client is allowed to send/consume any message.
```

Itu salah. Authentication hanya membuktikan identity. Authorization menentukan operasi yang boleh dilakukan.

---

## 7. Authorization: Siapa Boleh Send, Consume, Browse, Admin

Authorization menjawab:

```text
What is this JMS client allowed to do?
```

Dalam broker modern seperti ActiveMQ Artemis, security model biasanya role-based dan diterapkan pada address/queue/destination. Artemis memiliki permission yang fine-grained untuk operasi seperti send, consume, browse, create/delete durable queue, create/delete non-durable queue, manage, dan lain-lain.

Kita harus berpikir dalam operasi, bukan hanya destination.

### 7.1 Permission yang Perlu Dipisahkan

Minimal permission yang sebaiknya dibedakan:

| Permission | Arti | Risiko jika terlalu luas |
|---|---|---|
| Connect | boleh membuka koneksi | entry point lateral movement |
| Send / publish | boleh memasukkan message | command injection / fake event |
| Consume | boleh mengambil message | data leakage / unauthorized processing |
| Browse | boleh melihat tanpa consume | data leakage besar, sering dilupakan |
| Create destination | boleh membuat queue/topic | topology sprawl / bypass governance |
| Delete destination | boleh menghapus queue/topic | data loss |
| Purge | boleh menghapus semua message | data loss / audit issue |
| Move/replay | boleh memindahkan/replay message | unauthorized state change |
| Admin/manage | konfigurasi broker | full compromise |

### 7.2 Least Privilege Destination Matrix

Contoh matrix:

| Client Identity | case.command.in | case.event.out | appeal.command.in | dlq.case | admin |
|---|---:|---:|---:|---:|---:|
| case-api | send | none | none | none | none |
| case-worker | consume | send | none | none | none |
| appeal-worker | none | consume if needed | consume | none | none |
| dlq-repair-tool | none | none | none | browse/move limited | none |
| broker-admin | manage | manage | manage | manage | manage |

Top 1% rule:

> Producer tidak otomatis boleh consume destination yang dia tulis. Consumer tidak otomatis boleh send ke destination yang dia baca.

### 7.3 Command Queue Authorization

Command queue lebih sensitif daripada event topic.

```text
Command = intent to change state.
Event   = fact that state changed.
```

Maka permission send ke command queue harus sangat ketat.

Contoh:

```text
case.approve.command.in
case.assign.command.in
case.close.command.in
```

Hanya service/API yang sudah melakukan user authorization boleh send command tersebut.

Namun tetap jangan percaya sepenuhnya pada upstream. Consumer masih harus melakukan validation:

```text
- command type valid?
- target entity exists?
- tenant matches?
- actor identity valid?
- actor allowed at time of processing?
- state transition legal?
- command not expired?
- command not duplicate?
```

### 7.4 Event Topic Authorization

Event topic juga sensitif. Banyak engineer menganggap event boleh dibaca semua service.

Ini salah untuk domain regulated.

Event bisa mengandung:

```text
- case id
- user id
- status change
- enforcement action
- decision details
- document metadata
- correspondence recipient
```

Maka consumer event harus diberi permission berdasarkan need-to-know.

### 7.5 Browse Permission Harus Diperlakukan Seperti Read Permission

Browse sering dilupakan.

`QueueBrowser` memungkinkan melihat message tanpa consume. Untuk operator, ini berguna. Untuk attacker/over-privileged user, ini jalur data exfiltration.

Guideline:

```text
Browse permission = data read permission.
DLQ browse permission = privileged data read permission.
```

Jika message body mengandung PII, browsing harus:

- dibatasi role,
- diaudit,
- dimasking bila console mendukung,
- tidak diberikan ke generic support role,
- punya approval untuk production.

---

## 8. Transport Security: TLS dan mTLS

Transport security menjawab:

```text
Can someone read or tamper with bytes on the wire?
```

TLS memberikan confidentiality dan integrity untuk koneksi client-broker. mTLS menambahkan client certificate authentication.

### 8.1 Internal Network Bukan Alasan untuk Non-TLS

Argumen yang sering muncul:

```text
“Broker cuma internal, jadi tidak perlu TLS.”
```

Ini lemah untuk production enterprise.

Internal network tetap bisa terkena:

```text
- compromised pod/VM,
- lateral movement,
- misconfigured security group,
- packet capture,
- shared network segment,
- insider risk,
- accidental exposure,
- service mesh misconfiguration.
```

Prinsip modern:

```text
Assume network can be observed.
Assume workload identity can be compromised.
Use defense in depth.
```

### 8.2 TLS Server Authentication

Minimal TLS:

```text
Client verifies broker certificate.
Client truststore contains trusted CA.
Broker presents certificate matching hostname/SAN.
Hostname verification enabled.
Weak protocol/cipher disabled.
```

Kesalahan umum:

```text
- trust all certificates,
- disable hostname verification,
- self-signed cert tanpa lifecycle jelas,
- same certificate reused across environments,
- expired cert not monitored,
- truststore baked into image and forgotten,
- plaintext fallback enabled.
```

### 8.3 mTLS Client Authentication

mTLS menambahkan:

```text
Broker verifies client certificate.
Client certificate maps to broker identity/role.
```

Ini sangat kuat untuk service-to-broker identity, terutama jika certificate lifecycle dikelola otomatis.

Namun mTLS bukan silver bullet:

```text
mTLS proves workload/certificate identity.
It does not prove business permission.
It does not validate message content.
It does not prevent a compromised service from sending valid but malicious messages.
```

### 8.4 TLS Config di Java: Keystore dan Truststore

Pada Java 8–25, konsep dasarnya sama:

```text
truststore = whom I trust
keystore   = who I am / certificate + private key
```

Contoh JVM properties klasik:

```bash
-Djavax.net.ssl.trustStore=/etc/secrets/jms-client.truststore.p12
-Djavax.net.ssl.trustStorePassword=changeit
-Djavax.net.ssl.keyStore=/etc/secrets/jms-client.keystore.p12
-Djavax.net.ssl.keyStorePassword=changeit
```

Namun production modern sebaiknya tidak memasukkan password literal ke command line karena bisa muncul di process list/log. Gunakan mekanisme provider-specific, secret file permission, environment injection yang aman, atau container secret manager.

### 8.5 Certificate Rotation

Certificate rotation harus didesain sebelum incident.

Checklist:

```text
- Can broker trust old and new CA during transition?
- Can client reload truststore without restart?
- If restart required, what is rollout order?
- Is certificate expiry monitored?
- Are cert aliases environment-specific?
- Is private key protected at rest?
- Are certs different across DEV/UAT/PROD?
- Can compromised cert be revoked or removed quickly?
```

---

## 9. Secret Handling: Credential Bukan Konfigurasi Biasa

JMS credential sering masuk ke:

```text
application.properties
YAML config
Docker image layer
Kubernetes ConfigMap
CI/CD variable
shell script
JVM args
broker URL
log line
exception message
admin console screenshot
```

Semua ini berisiko.

### 9.1 Prinsip Secret Handling

```text
Secret must not be in source code.
Secret must not be in image.
Secret must not be in ConfigMap.
Secret must not be logged.
Secret must be environment-scoped.
Secret must be rotatable.
Secret must have owner.
Secret must have expiry/rotation policy.
Secret access must be auditable where possible.
```

### 9.2 Kubernetes Secret Bukan Vault

Kubernetes Secret lebih baik daripada ConfigMap, tetapi bukan otomatis aman. Ia tetap harus dilindungi dengan:

```text
- RBAC ketat,
- encryption at rest,
- namespace isolation,
- secret projection as file if possible,
- minimal pod access,
- no broad list secrets permission,
- no debug shell access sembarangan,
- rotation procedure.
```

### 9.3 Runtime Injection Pattern

Beberapa pattern:

| Pattern | Kelebihan | Risiko |
|---|---|---|
| Env var | sederhana | bisa muncul di dump/process/env inspection |
| Mounted secret file | lebih mudah dibatasi permission | file leakage/debug shell |
| Secret manager SDK | audit/rotation lebih baik | runtime dependency |
| App server credential alias | cocok Jakarta EE | hidden config perlu governance |
| Sidecar/agent injection | central control | operational complexity |

### 9.4 Credential Rotation tanpa Downtime

Idealnya broker mendukung multiple credential valid selama window rotasi.

Prosedur umum:

```text
1. Create new credential/certificate.
2. Add new credential to broker/user store.
3. Deploy apps with new credential.
4. Verify new connections use new credential.
5. Revoke old credential.
6. Confirm no failed reconnect from old credential.
7. Update inventory and audit evidence.
```

Jangan rotasi dengan cara:

```text
- change password broker first,
- semua app langsung gagal reconnect,
- rollback manual tanpa evidence.
```

---

## 10. Message Confidentiality: TLS Saja Tidak Selalu Cukup

TLS melindungi data in transit antara client dan broker.

Namun setelah message masuk broker:

```text
- payload berada di memory broker,
- mungkin ditulis ke disk/journal,
- mungkin masuk DLQ,
- mungkin dibrowse admin console,
- mungkin direplikasi ke broker lain,
- mungkin dibackup,
- mungkin masuk log jika error,
- mungkin dikirim ke consumer yang salah jika ACL salah.
```

Maka untuk data sangat sensitif, pertimbangkan **payload-level encryption**.

### 10.1 Kapan TLS Cukup?

TLS biasanya cukup jika:

```text
- broker dan consumer berada dalam trust boundary yang sama,
- broker admin dipercaya dan diaudit,
- payload tidak mengandung data sangat sensitif,
- destination ACL ketat,
- storage broker terenkripsi at rest,
- DLQ access dibatasi,
- log payload dilarang.
```

### 10.2 Kapan Perlu Payload Encryption?

Pertimbangkan payload encryption jika:

```text
- broker dikelola pihak lain,
- tenant berbeda memakai broker bersama,
- payload mengandung data sensitif tinggi,
- operator broker tidak boleh membaca isi message,
- message disimpan lama,
- ada backup/offline storage,
- compliance mensyaratkan encryption beyond transport,
- DLQ/replay path melibatkan role operasional luas.
```

### 10.3 Envelope Encryption Model

Konsep:

```text
Message body encrypted.
Header/properties minimal tetap plaintext untuk routing.
Data key encrypted by KMS/public key.
Consumer authorized decrypts payload.
```

Envelope contoh:

```json
{
  "schemaVersion": 1,
  "eventType": "CaseApproved",
  "tenantId": "agency-a",
  "correlationId": "corr-123",
  "encryption": {
    "alg": "AES-GCM",
    "keyId": "kms-key-case-events-prod",
    "encryptedDataKey": "...",
    "iv": "..."
  },
  "ciphertext": "..."
}
```

Namun hati-hati: jika `tenantId`, `caseId`, atau `eventType` di header/properties sudah sensitif, encryption body tidak cukup.

### 10.4 Message Signing

Signing berguna untuk membuktikan:

```text
- payload tidak berubah,
- producer yang sah mengirim message,
- consumer dapat memverifikasi integrity end-to-end.
```

Tetapi signing tidak menggantikan broker ACL. Signing juga memerlukan key lifecycle dan canonical serialization.

---

## 11. Application-Level Authorization: Broker ACL Tidak Cukup

Broker authorization biasanya berbasis:

```text
client identity + destination + operation
```

Tetapi bisnis butuh authorization seperti:

```text
user X boleh approve case Y?
agency A boleh melihat case B?
role investigator boleh assign enforcement action?
state transition from DRAFT to APPROVED legal?
command masih dalam validity window?
```

Broker tidak tahu ini.

Maka consumer command harus tetap melakukan business authorization/validation.

### 11.1 Command Message Harus Membawa Actor Context

Contoh command envelope:

```json
{
  "messageId": "msg-2026-000001",
  "correlationId": "corr-abc",
  "commandId": "cmd-abc",
  "commandType": "ApproveCase",
  "tenantId": "agency-a",
  "actor": {
    "userId": "u123",
    "authTime": "2026-06-18T10:20:00Z",
    "sourceSystem": "case-api"
  },
  "target": {
    "caseId": "CASE-001"
  },
  "issuedAt": "2026-06-18T10:21:00Z",
  "expiresAt": "2026-06-18T10:31:00Z",
  "payload": {
    "decision": "APPROVED"
  }
}
```

Consumer tidak boleh menerima command hanya karena message datang dari queue yang benar.

Validation:

```text
- commandId unique?
- tenantId matches target case?
- actor still allowed?
- sourceSystem trusted?
- issuedAt/expiresAt acceptable?
- transition legal from current state?
- duplicate command already processed?
```

### 11.2 Snapshot Authorization vs Processing-Time Authorization

Pertanyaan sulit:

```text
Jika user punya permission saat command dibuat, tetapi permission dicabut sebelum command diproses, apakah command tetap valid?
```

Tidak ada satu jawaban universal. Harus ditentukan per domain.

Model A: authorization at issue time

```text
Jika user valid saat command diterbitkan, command boleh diproses walau permission berubah kemudian.
Cocok untuk command yang dianggap sudah committed intent.
```

Model B: authorization at processing time

```text
Consumer re-check permission saat memproses.
Cocok untuk action sensitif atau queue latency bisa panjang.
```

Model C: hybrid

```text
Issue-time auth + command expiration + re-check untuk high-risk transition.
```

Top 1% engineer akan menanyakan ini di design review, bukan hanya menulis listener.

---

## 12. Tenant Isolation

Multi-tenant messaging bisa dilakukan beberapa cara.

### 12.1 Physical Isolation

```text
Broker per tenant
Cluster per tenant
Namespace/VHost per tenant
```

Kelebihan:

```text
- isolation kuat,
- blast radius kecil,
- audit mudah,
- quota per tenant jelas.
```

Kekurangan:

```text
- biaya operasional lebih tinggi,
- provisioning lebih kompleks,
- monitoring lebih banyak,
- upgrade lebih sulit.
```

### 12.2 Logical Isolation by Destination

```text
tenant-a.case.command.in
tenant-b.case.command.in
```

Kelebihan:

```text
- lebih murah,
- mudah routing,
- ACL per destination bisa jelas.
```

Risiko:

```text
- wildcard ACL salah bisa bocor,
- topology sprawl,
- provisioning destination harus terkendali,
- shared broker resource bisa menyebabkan noisy neighbor.
```

### 12.3 Logical Isolation by Property/Selector

```text
shared.case.event.topic
selector: tenantId = 'agency-a'
```

Ini paling berisiko untuk security boundary.

Selector cocok untuk filtering, tetapi jangan jadikan selector sebagai satu-satunya tenant isolation untuk data sensitif kecuali provider, ACL, dan governance benar-benar mendukung model itu.

Alasannya:

```text
- producer bisa salah/memalsukan tenantId,
- consumer selector salah bisa menerima data tenant lain,
- topic subscriber permission mungkin terlalu luas,
- broker tetap menyimpan semua tenant payload dalam destination yang sama,
- observability/debugging lebih sulit,
- DLQ bercampur antar tenant.
```

### 12.4 Recommended Tenant Isolation Matrix

| Sensitivitas | Rekomendasi |
|---|---|
| Rendah, internal analytics | shared topic + selector bisa diterima |
| Sedang, data bisnis biasa | destination per tenant/domain + ACL |
| Tinggi, PII/regulatory/case data | physical/logical namespace kuat + ACL + encryption consideration |
| Sangat tinggi | broker/cluster per boundary + payload encryption + strict audit |

---

## 13. Destination Naming sebagai Security Boundary

Naming bukan sekadar estetika. Naming memengaruhi ACL, audit, monitoring, dan human operation.

### 13.1 Naming yang Baik

```text
env.domain.capability.messageKind.direction
```

Contoh:

```text
prod.case.command.approve.in
prod.case.event.lifecycle.out
prod.appeal.command.submit.in
prod.correspondence.command.email-send.in
prod.case.dlq.command
prod.case.parking-lot.command
```

Atau jika environment dipisah secara broker/namespace, `prod` tidak perlu di nama destination.

### 13.2 Hindari Naming Terlalu Generic

Buruk:

```text
queue.in
main.queue
event.topic
jms.queue
service.queue
integration.queue
```

Dampaknya:

```text
- ACL sulit spesifik,
- audit log tidak informatif,
- operator rawan salah purge/replay,
- consumer salah subscribe,
- migration sulit.
```

### 13.3 Wildcard ACL Harus Dibatasi

Contoh berbahaya:

```text
role app-users can send to prod.#
role consumers can consume from #
```

Lebih baik eksplisit:

```text
case-api: send prod.case.command.*.in
case-worker: consume prod.case.command.*.in, send prod.case.event.lifecycle.out
appeal-worker: consume prod.appeal.command.*.in, consume prod.case.event.lifecycle.out if approved
```

Wildcard kadang perlu, tetapi harus:

```text
- sempit,
- terdokumentasi,
- direview,
- diuji,
- diaudit,
- tidak diberikan untuk admin operation.
```

---

## 14. DLQ, Parking Lot, dan Replay Security

DLQ adalah salah satu titik paling sensitif.

Kenapa?

```text
Message di DLQ sering mengandung payload asli.
Message di DLQ sering gagal karena data edge-case.
Operator sering perlu melihatnya.
Replay dapat menyebabkan side effect.
DLQ retention bisa panjang.
```

### 14.1 DLQ Permission Harus Lebih Ketat dari Normal Queue

Jangan menganggap DLQ hanya queue teknis.

DLQ access harus dibagi:

| Role | Permission |
|---|---|
| App runtime | biasanya tidak perlu browse DLQ |
| Support L1 | lihat metadata/masked summary saja |
| Support L2 | browse terbatas, no replay langsung |
| Engineer on-call | inspect + propose repair |
| Approved operator | move/replay setelah approval |
| Broker admin | emergency only, audited |

### 14.2 Replay Harus Ada Governance

Replay bukan operasi teknis biasa. Replay adalah **state-changing operation**.

Replay checklist:

```text
- Why did message fail?
- Is root cause fixed?
- Is handler idempotent?
- Is message still valid?
- Has business state changed since failure?
- Is command expired?
- Is duplicate detection active?
- What is expected side effect?
- Who approved replay?
- How many messages replayed?
- What rollback/compensation exists?
```

### 14.3 DLQ Data Retention

DLQ retention harus punya policy:

```text
- how long retained?
- who can export?
- is payload encrypted?
- is PII masked in tooling?
- is deletion audited?
- are backups covered?
- does retention comply with policy?
```

---

## 15. Logging dan Observability Security

Observability bisa menjadi jalur kebocoran data.

### 15.1 Jangan Log Payload Mentah

Buruk:

```java
catch (Exception e) {
    log.error("Failed to process JMS message: {}", textMessage.getText(), e);
}
```

Masalah:

```text
- payload bisa berisi PII,
- log dikirim ke banyak sistem,
- retention log panjang,
- akses log lebih luas daripada akses broker,
- redaction sulit setelah terlanjur masuk.
```

Lebih baik:

```java
log.error("Failed to process JMS message. messageId={}, correlationId={}, type={}, redelivered={}",
        safe(messageId),
        safe(correlationId),
        safe(eventType),
        redelivered,
        e);
```

### 15.2 Safe Logging Fields

Biasanya aman/loggable:

```text
- correlationId
- messageId if not sensitive
- eventType/commandType
- destination
- consumer group/service name
- redelivery count
- processing duration
- error category
```

Perlu hati-hati:

```text
- userId
- caseId
- tenantId
- email
- phone
- document id
- address
- free-text reason
```

Tidak boleh/log sangat dibatasi:

```text
- full payload
- access token
- password
- private key
- certificate private material
- raw authorization header
- serialized object dump
- decrypted sensitive body
```

### 15.3 Tracing Context

Trace/correlation penting, tetapi jangan masukkan sensitive data ke span attributes.

Baik:

```text
messaging.system=jms
messaging.destination.name=case.command.in
messaging.operation=process
messaging.message.id=...
correlation.id=...
```

Hindari:

```text
case.fullPayload=...
user.nric=...
document.text=...
```

---

## 16. Secure Coding untuk JMS Producer/Consumer

### 16.1 Producer Secure Checklist

Producer harus:

```text
- memakai identity sendiri,
- hanya punya send permission ke destination yang diperlukan,
- tidak menyimpan credential di code,
- menggunakan TLS/mTLS sesuai policy,
- mengisi correlation id,
- mengisi message type/schema version,
- mengisi tenant/domain metadata secara valid,
- tidak mengirim secret/token/password di payload,
- melakukan schema validation sebelum send,
- menandai TTL untuk command yang basi,
- tidak mengirim ObjectMessage dari untrusted source,
- tidak log payload sensitif.
```

### 16.2 Consumer Secure Checklist

Consumer harus:

```text
- memakai identity sendiri,
- hanya punya consume permission ke queue/topic yang diperlukan,
- validate message schema,
- validate message type,
- validate tenant boundary,
- validate command authorization jika command,
- validate state transition,
- enforce idempotency,
- reject expired command,
- handle unknown version safely,
- avoid unsafe deserialization,
- avoid logging payload,
- produce auditable outcome,
- send bad message to controlled failure path.
```

### 16.3 Jangan Trust Message Properties Buta-Buta

Message properties bisa dipakai untuk routing/filtering, tetapi consumer tidak boleh menganggap semuanya benar tanpa validasi.

Contoh:

```text
property tenantId = 'agency-a'
body tenantId = 'agency-b'
```

Apa yang harus dilakukan?

```text
- reject message,
- classify as contract/security violation,
- send to DLQ/security quarantine,
- alert if repeated,
- audit producer identity.
```

### 16.4 Hindari ObjectMessage untuk Boundary Tidak Tepercaya

`ObjectMessage` membawa serialized Java object. Risiko:

```text
- deserialization vulnerability,
- classpath coupling,
- version compatibility issue,
- gadget chain risk,
- object graph terlalu besar,
- sulit schema governance,
- sulit cross-language integration.
```

Untuk enterprise boundary, gunakan format eksplisit seperti JSON/Avro/Protobuf dengan schema validation.

---

## 17. Java 8 sampai Java 25: Pertimbangan Runtime Security

### 17.1 Java 8

Masih banyak legacy JMS berjalan di Java 8.

Perhatian:

```text
- TLS defaults lebih tua,
- cipher/protocol harus dikonfigurasi,
- dependency harus dipatch,
- javax.jms dominan,
- app server legacy mungkin punya security model lama,
- deserialization hardening lebih sulit dibanding runtime modern.
```

### 17.2 Java 11/17

Java 11/17 membawa runtime TLS lebih modern, module system sejak Java 9, dan banyak app mulai migrasi ke Jakarta/Spring Boot modern.

Perhatian:

```text
- javax vs jakarta split,
- dependency conflict,
- TLS config berubah karena provider/security policy,
- illegal reflective access library lama,
- app server compatibility.
```

### 17.3 Java 21/25

Java 21 dan 25 sering dipakai untuk modern runtime. Virtual threads dapat membantu concurrency aplikasi, tetapi tidak otomatis mengubah security model JMS.

Perhatian:

```text
- client library harus kompatibel,
- blocking JMS receive dalam virtual thread harus diuji per provider,
- TLS/cert reload tetap provider-specific,
- structured concurrency tidak menggantikan ack/transaction discipline,
- dependency upgrade harus mencakup CVE broker client.
```

Security invariant tetap sama:

```text
Runtime modern does not fix weak ACL.
Virtual threads do not fix unsafe replay.
Jakarta namespace does not fix over-privileged credentials.
```

---

## 18. Jakarta EE / Resource Adapter Security

Dalam Jakarta EE, aplikasi sering tidak membuat connection dengan password langsung. Resource didefinisikan di server:

```java
@Resource(lookup = "jms/CaseConnectionFactory")
private ConnectionFactory connectionFactory;

@Resource(lookup = "jms/CaseCommandQueue")
private Queue caseCommandQueue;
```

Keamanan berada di konfigurasi server/resource adapter:

```text
- connection factory credential,
- authentication alias,
- resource adapter security domain,
- activation spec credential,
- MDB pool/concurrency,
- transaction enlistment,
- destination permission,
- admin object binding.
```

Pertanyaan design review:

```text
- Credential resource adapter disimpan di mana?
- Siapa bisa membaca/mengubahnya?
- Apakah MDB memakai identity berbeda per module?
- Apakah semua MDB share connection factory credential?
- Apakah server admin console diaudit?
- Apakah deployment descriptor mengandung secret?
- Bagaimana credential rotation dilakukan?
```

---

## 19. Spring Boot / Standalone JMS Security

Pada Spring Boot, security sering dikonfigurasi di properties:

```yaml
spring:
  artemis:
    broker-url: tcp://broker:61616
    user: case-service
    password: ${JMS_PASSWORD}
```

Untuk production:

```text
- gunakan ssl/tls broker URL jika provider mendukung,
- inject password dari secret manager,
- jangan commit property secret,
- jangan enable actuator/env exposure tanpa masking,
- jangan log resolved config,
- batasi connection factory bean per use-case jika ACL berbeda,
- pastikan listener container tidak memakai credential terlalu luas.
```

Contoh pemisahan connection factory:

```text
caseCommandProducerConnectionFactory
caseCommandConsumerConnectionFactory
auditEventPublisherConnectionFactory
```

Ini memang lebih verbose, tetapi lebih defensible.

---

## 20. Broker Admin Plane Security

Broker punya data plane dan admin plane.

```text
Data plane  = send/consume message.
Admin plane = manage broker/destination/user/role/message.
```

Admin plane harus jauh lebih ketat.

Checklist:

```text
- admin console tidak expose publik,
- admin console dibatasi network/VPN/bastion,
- MFA jika tersedia,
- admin user personal, bukan shared,
- break-glass account terkontrol,
- audit log admin aktif,
- role admin dipisah dari app runtime,
- no default password,
- no dummy certificate,
- no anonymous access,
- purge/delete/move operation diaudit,
- config change melalui change management.
```

---

## 21. Security Failure Modes

### 21.1 Shared Credential Leak

```text
Symptom:
- credential satu service bocor.
- ternyata credential dipakai semua service.

Impact:
- attacker bisa send/consume banyak destination.
- sulit tahu service mana pelaku operasi.

Prevention:
- identity per service,
- least privilege,
- secret inventory,
- rotation drill.
```

### 21.2 Wildcard ACL Overreach

```text
Symptom:
- role consumer bisa consume `#` atau `>`.

Impact:
- service bisa membaca data lintas domain/tenant.

Prevention:
- explicit ACL,
- automated ACL test,
- deny-by-default,
- access review.
```

### 21.3 DLQ Data Leak

```text
Symptom:
- support role bisa browse DLQ production.
- DLQ berisi payload PII.

Impact:
- data leakage dari failure path.

Prevention:
- DLQ masking,
- permission split,
- approval-based browse/export,
- payload encryption for high sensitivity.
```

### 21.4 Fake Command Injection

```text
Symptom:
- compromised producer sends valid-looking command.

Impact:
- unauthorized business state transition.

Prevention:
- strict send ACL,
- command validation,
- actor authorization,
- signature for high-risk command,
- anomaly detection.
```

### 21.5 Insecure Deserialization

```text
Symptom:
- ObjectMessage received from untrusted/broad source.

Impact:
- RCE risk, classpath exploit, crash.

Prevention:
- avoid ObjectMessage,
- allowlist classes if unavoidable,
- use explicit schema,
- isolate trusted boundary.
```

### 21.6 Secret in Logs

```text
Symptom:
- connection URL includes password.
- exception logs full config.

Impact:
- credential compromise via log platform.

Prevention:
- config masking,
- secret redaction,
- no password in URL,
- scan logs for leaks.
```

---

## 22. Security Testing

Security JMS perlu diuji, bukan hanya dikonfigurasi.

### 22.1 ACL Negative Tests

Uji bahwa client tidak bisa melakukan operasi yang tidak boleh.

```text
case-api cannot consume case.command.in
case-worker cannot send appeal.command.in
appeal-worker cannot browse case.command.in
normal app cannot browse DLQ
support role cannot purge queue
unauthenticated client cannot connect
expired credential cannot connect
wrong certificate cannot connect
```

### 22.2 Message Contract Security Tests

```text
missing tenantId => reject
body tenantId != property tenantId => reject
unknown command type => reject
expired command => reject
invalid actor => reject
unauthorized transition => reject
duplicate command => no duplicate side effect
malformed JSON => controlled failure path
oversized payload => reject/quarantine
```

### 22.3 TLS Tests

```text
plaintext port disabled?
wrong CA rejected?
expired certificate rejected?
hostname mismatch rejected?
client without cert rejected when mTLS required?
old cert rejected after rotation?
```

### 22.4 Operational Security Tests

```text
Can L1 browse payload? Should not.
Can app runtime purge queue? Should not.
Can replay tool replay without approval? Should not.
Are admin operations audited?
Are message payloads absent from logs?
Are secrets masked in config endpoint?
```

---

## 23. Security Design for Regulated Case Management

Untuk sistem case management/regulatory enforcement, JMS security harus lebih ketat karena message dapat mengubah status hukum/proses.

Contoh domain:

```text
CaseCreated
CaseAssigned
CaseApproved
InvestigationOpened
EnforcementActionIssued
AppealSubmitted
CorrespondenceSent
DocumentGenerated
SlaTimerExpired
```

Risiko:

```text
- unauthorized case transition,
- disclosure case data,
- cross-agency/tenant leak,
- premature notification,
- duplicate enforcement action,
- replay old decision,
- audit gap.
```

Recommended invariants:

```text
Invariant 1:
Only authorized producer identities can send commands to command queues.

Invariant 2:
Every command carries correlationId, commandId, actor context, tenant/domain context, issuedAt, and expiry where relevant.

Invariant 3:
Every consumer validates schema, tenant, state transition, and idempotency before side effect.

Invariant 4:
No service can consume/browse destinations outside its domain need-to-know.

Invariant 5:
DLQ browse/replay is privileged, audited, and approval-based.

Invariant 6:
No payload secrets or sensitive fields appear in application logs.

Invariant 7:
Broker admin actions are attributable to a human/service identity.

Invariant 8:
Credential and certificate rotation is rehearsed and does not require emergency downtime.
```

---

## 24. Reference Secure JMS Architecture

```text
+-------------------+            TLS/mTLS             +----------------------+
| Case API Service  | -------------------------------> | JMS Broker           |
| identity: case-api|                                |                      |
| can send only     |                                | ACL:                 |
| case.command.*    |                                | - case-api send cmd  |
+-------------------+                                | - case-worker consume|
                                                     | - no wildcard consume|
+-------------------+            TLS/mTLS             | - dlq-tool limited   |
| Case Worker       | <------------------------------ |                      |
| identity: worker  |                                +----------+-----------+
| consume command   |                                           |
| validate auth     |                                           |
| idempotent effect |                                           v
+---------+---------+                                +----------------------+
          |                                          | DLQ / Parking Lot    |
          | outbox                                   | browse/replay only   |
          v                                          | approved/audited     |
+-------------------+                                +----------------------+
| Database          |
| case state        |
| inbox/dedup       |
| audit trail       |
| outbox            |
+---------+---------+
          |
          | relay with publisher identity
          v
+-------------------+            TLS/mTLS             +----------------------+
| Outbox Relay      | -------------------------------> | case.event.topic     |
| identity: relay   |                                | subscribers limited  |
+-------------------+                                +----------------------+
```

Key properties:

```text
- command path is strict,
- event path is governed,
- broker ACL is least privilege,
- app-level validation still enforced,
- audit is not optional,
- replay is controlled,
- message lifecycle is visible.
```

---

## 25. Design Review Checklist

Gunakan checklist ini saat review sistem JMS.

### 25.1 Identity and Credential

```text
[ ] Apakah setiap service punya broker identity sendiri?
[ ] Apakah credential berbeda per environment?
[ ] Apakah credential tidak ada di source code/image/log?
[ ] Apakah credential bisa dirotasi tanpa downtime besar?
[ ] Apakah credential ownership jelas?
[ ] Apakah credential lama direvoke setelah rotasi?
```

### 25.2 Transport

```text
[ ] Apakah TLS aktif untuk production?
[ ] Apakah plaintext port disabled/restricted?
[ ] Apakah hostname verification aktif?
[ ] Apakah truststore/keystore lifecycle jelas?
[ ] Apakah mTLS diperlukan untuk boundary ini?
[ ] Apakah certificate expiry dimonitor?
```

### 25.3 Authorization

```text
[ ] Apakah ACL deny-by-default?
[ ] Apakah send/consume/browse/admin dipisahkan?
[ ] Apakah command queue send permission sangat terbatas?
[ ] Apakah event topic consume permission need-to-know?
[ ] Apakah wildcard ACL dibatasi?
[ ] Apakah app runtime tidak punya admin permission?
```

### 25.4 Message Contract

```text
[ ] Apakah message punya schema version?
[ ] Apakah correlationId wajib?
[ ] Apakah commandId/eventId wajib?
[ ] Apakah tenant/domain metadata divalidasi?
[ ] Apakah command expiry dipakai untuk action sensitif?
[ ] Apakah payload tidak membawa secret/token/password?
```

### 25.5 Consumer Validation

```text
[ ] Apakah consumer validate schema?
[ ] Apakah consumer validate tenant boundary?
[ ] Apakah consumer validate business authorization bila command?
[ ] Apakah consumer idempotent?
[ ] Apakah duplicate safe?
[ ] Apakah malformed/unknown message masuk controlled failure path?
```

### 25.6 DLQ and Replay

```text
[ ] Apakah DLQ access lebih ketat dari normal queue?
[ ] Apakah DLQ browse diaudit?
[ ] Apakah replay butuh approval?
[ ] Apakah replay idempotency dicek?
[ ] Apakah DLQ retention policy jelas?
[ ] Apakah payload DLQ aman dari kebocoran?
```

### 25.7 Observability and Audit

```text
[ ] Apakah payload sensitif tidak masuk log?
[ ] Apakah correlation id konsisten?
[ ] Apakah broker admin action diaudit?
[ ] Apakah failed auth/authorization dimonitor?
[ ] Apakah unusual send/consume pattern terdeteksi?
[ ] Apakah security incident runbook tersedia?
```

---

## 26. Anti-Pattern Penting

### Anti-Pattern 1 — “Internal Network Is Trusted”

Masalah:

```text
Internal network dianggap aman, TLS dimatikan, ACL longgar.
```

Perbaikan:

```text
Gunakan TLS, network policy, broker ACL, dan least privilege.
```

### Anti-Pattern 2 — Shared Superuser Credential

Masalah:

```text
Semua service memakai user `admin` atau `app`.
```

Perbaikan:

```text
Identity per service, role per destination, no runtime admin privilege.
```

### Anti-Pattern 3 — Selector as Tenant Security Boundary

Masalah:

```text
Semua tenant event masuk satu topic, consumer dibatasi hanya selector tenantId.
```

Perbaikan:

```text
Gunakan destination/namespace/ACL per tenant untuk data sensitif.
```

### Anti-Pattern 4 — DLQ Is Just Technical Garbage

Masalah:

```text
DLQ dianggap tidak penting dan bisa dibrowse bebas.
```

Perbaikan:

```text
DLQ adalah privileged data store dan replay control point.
```

### Anti-Pattern 5 — Payload Logging for Debugging

Masalah:

```text
Payload penuh dilog saat exception.
```

Perbaikan:

```text
Log metadata aman, gunakan secure diagnostic tooling untuk payload bila benar-benar perlu.
```

### Anti-Pattern 6 — Broker ACL Replaces Business Authorization

Masalah:

```text
Consumer percaya semua command yang masuk queue.
```

Perbaikan:

```text
Consumer tetap validate actor, tenant, state transition, expiry, idempotency.
```

---

## 27. Mini Case Study: Secure Case Approval Command

### 27.1 Requirement

Sebuah service `case-api` menerima request approve case dari user. Ia mengirim command ke JMS queue `case.command.approve.in`. Worker memproses command secara asynchronous.

### 27.2 Security Design

Broker ACL:

```text
case-api:
  can send case.command.approve.in
  cannot consume case.command.approve.in
  cannot browse case.command.approve.in
  cannot send case.event.*

case-approval-worker:
  can consume case.command.approve.in
  can send case.event.lifecycle.out
  cannot browse DLQ
  cannot admin

dlq-operator:
  can browse case.command.approve.dlq
  can move with approval process
  cannot send new command directly
```

Command envelope:

```json
{
  "schemaVersion": 1,
  "commandId": "cmd-8f2b",
  "correlationId": "corr-a91c",
  "commandType": "ApproveCase",
  "tenantId": "agency-a",
  "actor": {
    "userId": "user-123",
    "source": "case-api"
  },
  "target": {
    "caseId": "CASE-2026-0001"
  },
  "issuedAt": "2026-06-18T10:00:00Z",
  "expiresAt": "2026-06-18T10:10:00Z",
  "reasonCode": "COMPLIANT"
}
```

Worker validation:

```text
1. Parse JSON safely.
2. Validate schemaVersion supported.
3. Validate commandType = ApproveCase.
4. Validate commandId uniqueness.
5. Validate expiresAt not passed.
6. Load case by caseId.
7. Validate case tenant = tenantId.
8. Validate current state can transition to APPROVED.
9. Validate actor permission if processing-time auth required.
10. Apply state change transactionally with inbox/dedup.
11. Emit CaseApproved event through outbox.
12. Ack/commit only after durable state update.
```

Security outcome:

```text
Even if broker ACL is correct, worker still protects domain invariant.
Even if duplicate command arrives, dedup protects side effect.
Even if old command replays, expiry/state validation protects system.
Even if DLQ is browsed, access is privileged/audited.
```

---

## 28. Practical Java Examples

### 28.1 Avoid Hardcoded Credential

Buruk:

```java
Connection connection = connectionFactory.createConnection("admin", "admin");
```

Lebih baik, minimal:

```java
String username = requireEnv("JMS_USERNAME");
String password = requireEnv("JMS_PASSWORD");

try (JMSContext context = connectionFactory.createContext(username, password)) {
    context.createProducer()
            .setProperty("messageType", "CaseApproved")
            .setProperty("schemaVersion", 1)
            .send(destination, payload);
}
```

Helper:

```java
static String requireEnv(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) {
        throw new IllegalStateException("Missing required environment variable: " + name);
    }
    return value;
}
```

Catatan: env var bukan solusi terbaik untuk semua environment, tetapi lebih baik daripada hardcoded secret. Untuk production regulated, gunakan secret manager atau mounted secret file sesuai platform.

### 28.2 Safe Logging Consumer

```java
public void onMessage(Message message) {
    String messageId = null;
    String correlationId = null;
    String messageType = null;

    try {
        messageId = message.getJMSMessageID();
        correlationId = message.getJMSCorrelationID();
        messageType = message.getStringProperty("messageType");

        // Parse and validate payload without logging raw body.
        process(message);

    } catch (Exception ex) {
        log.error(
                "JMS processing failed. messageId={}, correlationId={}, messageType={}, errorClass={}",
                safe(messageId),
                safe(correlationId),
                safe(messageType),
                ex.getClass().getName(),
                ex
        );
        throw wrapForRedelivery(ex);
    }
}

private static String safe(String value) {
    if (value == null) {
        return "<null>";
    }
    if (value.length() > 128) {
        return value.substring(0, 128) + "...";
    }
    return value.replace('\n', '_').replace('\r', '_');
}
```

### 28.3 Reject Tenant Mismatch

```java
void validateTenant(String propertyTenantId, CaseCommand command) {
    if (propertyTenantId == null || command.tenantId() == null) {
        throw new SecurityException("Missing tenant id");
    }
    if (!propertyTenantId.equals(command.tenantId())) {
        throw new SecurityException("Tenant mismatch between message property and payload");
    }
}
```

Untuk kasus production, exception ini sebaiknya diklasifikasikan sebagai contract/security violation, bukan retry transient biasa.

---

## 29. Top 1% Heuristics

1. **Broker ACL is necessary but not sufficient.**  
   ACL membatasi jalur teknis, bukan business authorization.

2. **Every message path has two trust decisions.**  
   Broker memutuskan apakah client boleh send/consume. Aplikasi memutuskan apakah command/event valid secara domain.

3. **DLQ is a privileged data store.**  
   Treat DLQ like production data with dangerous replay capability.

4. **Replay is a write operation.**  
   Jangan izinkan replay tanpa approval, idempotency check, dan audit.

5. **Selectors are not security boundaries by default.**  
   Selector bisa membantu filtering, tetapi tenant isolation perlu ACL/topology/encryption yang jelas.

6. **Transport encryption does not protect data at broker rest.**  
   TLS melindungi wire, bukan admin browse, journal, DLQ, backup, dan logs.

7. **Credential identity must map to service responsibility.**  
   Jika audit log hanya menunjukkan `app`, sistem tidak punya accountability.

8. **Message metadata can be sensitive.**  
   Bahkan tanpa body, `caseId`, `tenantId`, `eventType`, dan destination bisa membocorkan informasi.

9. **No payload in logs by default.**  
   Debugging tidak boleh mengorbankan confidentiality.

10. **Security must be tested negatively.**  
   Jangan hanya test bahwa client yang benar bisa connect. Test bahwa client yang salah gagal.

---

## 30. Latihan Engineering

### Latihan 1 — ACL Matrix

Buat matrix permission untuk domain berikut:

```text
Services:
- case-api
- case-worker
- appeal-api
- appeal-worker
- notification-worker
- audit-writer
- dlq-operator

Destinations:
- case.command.create.in
- case.command.approve.in
- case.event.lifecycle.out
- appeal.command.submit.in
- appeal.event.lifecycle.out
- notification.command.email.in
- audit.event.in
- case.dlq
- appeal.dlq
```

Tentukan siapa boleh send, consume, browse, move, admin.

### Latihan 2 — Threat Model

Ambil satu message flow:

```text
CaseApproved event -> Notification worker -> Email sent
```

Jawab:

```text
- data sensitif apa yang ada di message?
- siapa boleh publish?
- siapa boleh consume?
- apakah topic boleh shared?
- apakah DLQ mengandung data sensitif?
- apakah replay bisa mengirim email duplikat?
- bagaimana idempotency email dijamin?
```

### Latihan 3 — Secret Rotation Plan

Desain rotasi credential broker untuk `case-worker` tanpa downtime.

Harus menjawab:

```text
- bagaimana credential baru dibuat?
- bagaimana broker menerima credential lama dan baru?
- bagaimana deployment dilakukan?
- bagaimana memastikan connection baru memakai credential baru?
- kapan credential lama dicabut?
- alert apa yang harus dipasang?
```

### Latihan 4 — DLQ Replay Governance

Buat approval flow untuk replay 100 failed command dari DLQ.

Harus mencakup:

```text
- root cause evidence,
- sample inspection,
- idempotency proof,
- affected entity list,
- approval role,
- execution window,
- rollback/compensation,
- post-replay verification,
- audit record.
```

---

## 31. Ringkasan

Security JMS/Jakarta Messaging harus dilihat sebagai sistem end-to-end.

Yang harus diingat:

```text
1. JMS API bukan security architecture lengkap.
2. Provider/broker menentukan banyak detail authentication/authorization.
3. TLS/mTLS melindungi transport, bukan seluruh message lifecycle.
4. Broker ACL harus least privilege per service, destination, dan operation.
5. Business authorization tetap wajib di consumer command.
6. Tenant isolation tidak boleh hanya mengandalkan selector untuk data sensitif.
7. DLQ dan replay adalah area security-critical.
8. Secret rotation harus dirancang sebelum incident.
9. Payload sensitif tidak boleh masuk log.
10. Security harus diuji dengan negative test.
```

Dengan mental model ini, kita tidak lagi melihat JMS security sebagai “password untuk connect ke broker”, tetapi sebagai rangkaian invariant:

```text
Only the right producer can send the right message
through the right secure channel
to the right destination
for the right consumer
to perform the right validated side effect
with the right audit trail
and the right recovery control when things fail.
```

---

## 32. Referensi Resmi dan Lanjutan

- Jakarta Messaging 3.1 Specification — Jakarta EE
- Jakarta Messaging API Documentation — Jakarta EE
- Apache ActiveMQ Artemis Security Documentation
- Apache ActiveMQ Artemis TLS / Authentication / Authorization Documentation
- IBM MQ JMS and Jakarta Messaging Documentation
- OWASP Logging Cheat Sheet
- OWASP Secrets Management guidance
- NIST guidance on TLS, identity, and key lifecycle where applicable

---

## 33. Status Seri

Selesai:

```text
Part 0  — Orientation
Part 1  — Evolution
Part 2  — Messaging Domain Model
Part 3  — Queue Semantics
Part 4  — Topic Semantics
Part 5  — Message Anatomy
Part 6  — Message Types
Part 7  — Producer Engineering
Part 8  — Consumer Engineering
Part 9  — Acknowledgement Semantics
Part 10 — Transaction Model
Part 11 — Reliability Semantics
Part 12 — Ordering
Part 13 — Redelivery, Retry, Poison Message, DLQ
Part 14 — Request/Reply over JMS
Part 15 — Selectors and Routing
Part 16 — Security Model
```

Berikutnya:

```text
Part 17 — Broker Architecture: Apa yang Sebenarnya Dilakukan Broker di Balik JMS API
```

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-015.md">⬅️ Part 15 — Selectors and Routing: Message Selector, Header-Based Routing, dan Broker-Side Filtering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-017.md">Learn Java JMS / Jakarta Messaging Enterprise Message-Oriented Middleware Engineering — Part 17 ➡️</a>
</div>
