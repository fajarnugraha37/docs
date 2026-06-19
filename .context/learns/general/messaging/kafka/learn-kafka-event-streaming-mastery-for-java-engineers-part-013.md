# learn-kafka-event-streaming-mastery-for-java-engineers-part-013.md

# Part 013 — Kafka Security: TLS, SASL, ACL, Principal, Multi-Tenant Boundaries

## 1. Tujuan Pembelajaran

Bagian ini membangun mental model keamanan Kafka dari sudut pandang engineer yang akan mendesain, mengoperasikan, dan mempertanggungjawabkan sistem event streaming di production.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **encryption**, **authentication**, dan **authorization** dalam Kafka.
2. Memahami bagaimana Kafka menggunakan **listener**, **TLS/SSL**, **SASL**, **principal**, dan **ACL**.
3. Mendesain akses producer/consumer yang minimum tetapi tetap operasional.
4. Memahami boundary multi-tenant pada cluster Kafka.
5. Menghindari kesalahan umum seperti `allow.everyone.if.no.acl.found=true`, shared credential, wildcard ACL berlebihan, dan client principal yang tidak bisa diaudit.
6. Menghubungkan Kafka security dengan Schema Registry, Kafka Connect, ksqlDB, dan service-to-service architecture.
7. Membuat checklist keamanan Kafka untuk platform internal, regulatory systems, dan case management systems.

Security Kafka bukan lapisan kosmetik di akhir proyek. Kafka sering membawa event yang bersifat audit, finansial, personal, operasional, bahkan regulatory. Jika topic adalah contract publik antar sistem, maka security adalah boundary yang menentukan siapa boleh menulis fakta, siapa boleh membaca fakta, siapa boleh mengubah metadata, dan siapa bisa menyebabkan kerusakan lintas domain.

---

## 2. Mental Model Utama

Kafka security bisa dipahami sebagai empat pertanyaan berurutan:

```text
1. Apakah komunikasi dienkripsi?
2. Siapa client ini?
3. Apakah principal ini boleh melakukan operasi tersebut?
4. Apakah tindakan ini bisa diaudit dan dipertanggungjawabkan?
```

Dalam istilah teknis:

| Pertanyaan | Lapisan Kafka | Contoh |
|---|---|---|
| Apakah traffic aman dari penyadapan? | Encryption | TLS/SSL listener |
| Siapa yang terkoneksi? | Authentication | mTLS, SASL/SCRAM, SASL/OAUTHBEARER |
| Boleh melakukan apa? | Authorization | ACL atau RBAC |
| Bisa ditelusuri? | Auditability | principal unik, log akses, IaC ACL |

Security Kafka bukan hanya broker. Ia mencakup:

```text
producer → broker
consumer → broker
broker → broker
broker → controller quorum
admin client → cluster
connect worker → broker
connect worker → external systems
schema registry → broker
ksqlDB → broker
monitoring/exporter → broker
operator/platform automation → cluster
```

Kafka adalah shared infrastructure. Satu konfigurasi longgar bisa membuka data lintas domain, lintas tenant, dan lintas lifecycle.

---

## 3. Konsep Inti: Security Plane Kafka

### 3.1 Encryption

Encryption menjawab pertanyaan:

> Apakah data yang bergerak di jaringan terlindungi dari penyadapan atau manipulasi?

Kafka menggunakan TLS/SSL untuk mengenkripsi koneksi client-broker dan antar broker jika dikonfigurasi. Tanpa TLS, record, key, header, credential, dan metadata bisa terlihat di jaringan internal yang tidak sepenuhnya dipercaya.

Dalam praktik production modern, asumsi aman yang lebih baik adalah:

```text
Internal network is not automatically trusted.
```

Bahkan jika cluster berada di VPC privat, tetap ada risiko:

1. compromised workload,
2. misconfigured network route,
3. packet capture oleh actor internal,
4. cross-tenant exposure,
5. cloud account compromise,
6. compliance requirement.

### 3.2 Authentication

Authentication menjawab pertanyaan:

> Siapa client ini?

Kafka mendukung beberapa pendekatan authentication, terutama:

1. TLS client authentication / mTLS.
2. SASL/SCRAM.
3. SASL/PLAIN, biasanya hanya jika dilindungi TLS.
4. SASL/GSSAPI Kerberos.
5. SASL/OAUTHBEARER.

Authentication menghasilkan identitas yang disebut **principal**.

Contoh principal:

```text
User:case-service-prod
User:enforcement-worker-prod
User:analytics-reader-prod
User:connect-jdbc-source-prod
User:ksqldb-server-prod
```

Principal harus cukup spesifik untuk audit. Principal seperti ini buruk:

```text
User:app
User:kafka-client
User:prod
User:shared-service
```

Mengapa buruk? Karena ketika topic berubah, data bocor, atau event salah diproduksi, kamu tidak bisa menjawab:

```text
Service mana yang melakukan ini?
Instance mana?
Environment mana?
Untuk domain mana?
```

### 3.3 Authorization

Authorization menjawab pertanyaan:

> Principal ini boleh melakukan operasi apa terhadap resource apa?

Kafka menyediakan authorization berbasis ACL pada resource seperti:

1. Cluster.
2. Topic.
3. Consumer group.
4. Transactional ID.
5. Delegation token.

Operasi ACL Kafka mencakup hal seperti:

1. Read.
2. Write.
3. Create.
4. Delete.
5. Alter.
6. Describe.
7. DescribeConfigs.
8. AlterConfigs.
9. ClusterAction.
10. IdempotentWrite.

Untuk engineer aplikasi, pola yang paling sering:

```text
Producer service:
- WRITE topic
- DESCRIBE topic
- maybe IDEMPOTENT_WRITE cluster or transactional permissions if needed

Consumer service:
- READ topic
- DESCRIBE topic
- READ consumer group

Admin/platform automation:
- CREATE topic
- ALTER configs
- DESCRIBE configs
- manage ACL
```

### 3.4 Auditability

Auditability menjawab pertanyaan:

> Setelah sesuatu terjadi, bisakah kita membuktikan siapa melakukan apa, kapan, dan dengan hak akses apa?

Kafka security yang tidak audit-friendly biasanya punya gejala:

1. credential dipakai bersama banyak service,
2. ACL dibuat manual tanpa review,
3. wildcard topic terlalu luas,
4. tidak ada mapping owner topic,
5. tidak ada change record untuk perubahan ACL,
6. tidak ada korelasi antara deployment service dan principal,
7. Connect worker punya akses ke semua topic,
8. ksqlDB service principal bisa membaca/menulis terlalu banyak topic.

Dalam sistem regulatory, ini bukan sekadar hygiene. Ini bagian dari defensibility.

---

## 4. Kafka Listener Mental Model

Kafka broker dapat memiliki beberapa listener. Listener adalah endpoint jaringan dengan security protocol tertentu.

Contoh conceptual listener:

```properties
listeners=INTERNAL://:9092,EXTERNAL://:9094,CONTROLLER://:9093
advertised.listeners=INTERNAL://broker-1.kafka.svc:9092,EXTERNAL://broker-1.company.com:9094
listener.security.protocol.map=INTERNAL:SASL_SSL,EXTERNAL:SASL_SSL,CONTROLLER:SSL
inter.broker.listener.name=INTERNAL
controller.listener.names=CONTROLLER
```

Mental model:

```text
listener = address + protocol + identity boundary
```

Listener bukan hanya port. Listener menentukan:

1. siapa yang bisa reach broker,
2. security protocol apa yang digunakan,
3. certificate apa yang disajikan,
4. principal mapping apa yang berlaku,
5. traffic path mana yang digunakan client.

### 4.1 Internal Listener

Biasanya digunakan oleh application service di network internal.

Contoh:

```text
INTERNAL://broker-1.kafka.svc.cluster.local:9092
```

Security yang umum:

```text
SASL_SSL
SSL
```

### 4.2 External Listener

Digunakan oleh client di luar network cluster, misalnya aplikasi di VPC lain, on-prem, atau partner.

External listener harus lebih hati-hati:

1. TLS wajib.
2. Authentication kuat.
3. Network allowlist.
4. Rate limit atau quota.
5. Topic-level ACL ketat.
6. Monitoring koneksi.

### 4.3 Controller Listener

Pada KRaft, controller quorum memiliki listener sendiri untuk komunikasi metadata/control-plane. Ini tidak boleh diperlakukan seperti client listener biasa.

Prinsip:

```text
Control-plane listener should be isolated from application clients.
```

---

## 5. TLS / SSL dalam Kafka

Kafka documentation sering memakai istilah SSL karena warisan konfigurasi Java, tetapi secara modern yang dimaksud biasanya TLS.

### 5.1 Apa yang Dilindungi TLS?

TLS dapat memberikan:

1. encryption in transit,
2. server authentication,
3. optional client authentication,
4. integrity protection.

### 5.2 Server Authentication

Client memverifikasi bahwa broker yang dihubungi benar-benar broker sah.

Client membutuhkan truststore yang mempercayai CA broker certificate.

Conceptual client config:

```properties
security.protocol=SSL
ssl.truststore.location=/etc/security/client.truststore.jks
ssl.truststore.password=${TRUSTSTORE_PASSWORD}
ssl.endpoint.identification.algorithm=https
```

`ssl.endpoint.identification.algorithm=https` penting agar hostname verification aktif. Jika dimatikan tanpa alasan kuat, client bisa menerima certificate yang tidak cocok dengan hostname.

### 5.3 Mutual TLS / Client Certificate Authentication

Dengan mTLS, client juga memiliki certificate. Broker memverifikasi client certificate dan membentuk principal dari certificate subject.

Conceptual config:

```properties
security.protocol=SSL
ssl.truststore.location=/etc/kafka/broker.truststore.jks
ssl.truststore.password=${TRUSTSTORE_PASSWORD}
ssl.keystore.location=/etc/kafka/broker.keystore.jks
ssl.keystore.password=${KEYSTORE_PASSWORD}
ssl.key.password=${KEY_PASSWORD}
ssl.client.auth=required
```

Kelebihan mTLS:

1. kuat secara cryptographic,
2. cocok untuk service identity berbasis certificate,
3. tidak mengirim password,
4. bisa diintegrasikan dengan PKI internal.

Kekurangan:

1. certificate lifecycle kompleks,
2. rotation harus disiplin,
3. principal mapping dari DN bisa rumit,
4. debugging lebih sulit untuk tim aplikasi.

### 5.4 Certificate Rotation

Certificate rotation adalah failure mode yang nyata.

Checklist:

1. Gunakan CA yang jelas lifecycle-nya.
2. Hindari certificate expiry mendadak.
3. Monitor expiry.
4. Test rolling certificate rotation di staging.
5. Pastikan broker truststore menerima certificate lama dan baru selama masa transisi.
6. Pastikan client bisa reload credential atau di-restart dengan aman.
7. Jangan hardcode truststore/keystore password di image.

---

## 6. SASL dalam Kafka

SASL adalah framework authentication. Dalam Kafka, SASL biasanya digunakan bersama TLS:

```text
SASL_SSL = TLS encryption + SASL authentication
```

Jangan memakai SASL_PLAINTEXT untuk production kecuali di environment yang benar-benar terisolasi dan kamu tahu risikonya.

### 6.1 SASL/PLAIN

SASL/PLAIN menggunakan username/password.

Contoh client config:

```properties
security.protocol=SASL_SSL
sasl.mechanism=PLAIN
sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required \
  username="case-service-prod" \
  password="${KAFKA_PASSWORD}";
```

Kelebihan:

1. sederhana,
2. mudah dipahami,
3. mudah untuk local/staging.

Kekurangan:

1. credential static,
2. password rotation harus dikelola,
3. risiko secret sprawl,
4. tidak ideal untuk large-scale service identity.

### 6.2 SASL/SCRAM

SCRAM juga username/password, tetapi lebih kuat daripada PLAIN karena menggunakan challenge-response salted password mechanism.

Mechanism umum:

```text
SCRAM-SHA-256
SCRAM-SHA-512
```

Contoh client config:

```properties
security.protocol=SASL_SSL
sasl.mechanism=SCRAM-SHA-512
sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required \
  username="enforcement-worker-prod" \
  password="${KAFKA_PASSWORD}";
```

Kelebihan:

1. cocok untuk service account,
2. lebih aman daripada PLAIN,
3. relatif mudah dioperasikan.

Kekurangan:

1. tetap butuh secret rotation,
2. perlu provisioning credential,
3. tidak otomatis cocok dengan identity provider modern tanpa tambahan integrasi.

### 6.3 SASL/OAUTHBEARER

OAUTHBEARER memungkinkan Kafka client menggunakan token OAuth/OIDC.

Cocok jika organisasi sudah punya identity provider dan ingin service identity berbasis token.

Kelebihan:

1. integrasi dengan IdP,
2. token expiry,
3. bisa mendukung claim-based identity,
4. lebih cocok untuk platform besar.

Kekurangan:

1. setup lebih kompleks,
2. token refresh failure bisa menyebabkan outage,
3. perlu desain mapping claim ke principal,
4. troubleshooting membutuhkan pemahaman IdP.

### 6.4 Kerberos / GSSAPI

Kerberos umum pada environment enterprise lama, terutama integrasi Hadoop/on-prem.

Kelebihan:

1. matang di enterprise,
2. single sign-on internal,
3. cocok untuk domain tertentu.

Kekurangan:

1. kompleks,
2. kurang natural untuk cloud-native workload,
3. debugging sulit,
4. operational burden tinggi.

---

## 7. Principal Design

Principal adalah identitas yang dipakai authorization dan audit.

Desain principal yang baik:

```text
User:<domain>-<service>-<environment>
```

Contoh:

```text
User:case-command-api-prod
User:case-projection-worker-prod
User:enforcement-escalation-worker-prod
User:regulatory-audit-reader-prod
User:connect-postgres-cdc-prod
User:ksqldb-enforcement-prod
```

Desain principal yang buruk:

```text
User:backend
User:kafka
User:service
User:prod-reader
User:shared
```

### 7.1 Principal per Service, Bukan per Team Saja

ACL berbasis team terlalu kasar:

```text
User:case-team-prod
```

Masalahnya:

1. semua service satu tim terlihat sama,
2. sulit membedakan producer vs consumer,
3. rotasi credential berdampak luas,
4. audit menjadi kabur.

Lebih baik:

```text
User:case-command-api-prod
User:case-event-projector-prod
User:case-sla-worker-prod
```

### 7.2 Principal per Environment

Jangan pakai principal yang sama untuk dev, staging, dan prod.

Buruk:

```text
User:case-service
```

Baik:

```text
User:case-service-dev
User:case-service-staging
User:case-service-prod
```

Alasan:

1. mencegah credential dev membaca prod,
2. memudahkan audit,
3. memudahkan rotasi,
4. menghindari environment bleed.

### 7.3 Principal untuk Automation

Platform automation juga harus punya principal khusus.

Contoh:

```text
User:kafka-topic-operator-prod
User:kafka-acl-provisioner-prod
User:kafka-monitoring-prod
```

Jangan pakai superuser credential untuk semua pipeline CI/CD.

---

## 8. ACL Mental Model

ACL adalah tuple konseptual:

```text
principal + operation + resource + host + permission
```

Contoh conceptual:

```text
Principal: User:case-command-api-prod
Operation: Write
Resource: Topic:case.lifecycle.events.v1
Permission: Allow
Host: *
```

ACL bukan sekadar “bisa baca topic”. ACL harus mencakup resource yang benar.

### 8.1 Producer Minimal ACL

Untuk producer biasa:

```text
Topic: case.lifecycle.events.v1
- WRITE
- DESCRIBE
```

Jika idempotent producer atau transaksi digunakan, mungkin perlu permission tambahan sesuai mode cluster/config.

Untuk transactional producer:

```text
Topic: target topic
- WRITE
- DESCRIBE

TransactionalId: case-command-api-prod-*
- WRITE / DESCRIBE as required by deployment
```

Prinsip:

```text
Transactional ID should be scoped, not global.
```

Buruk:

```text
TransactionalId: *
```

Baik:

```text
TransactionalId: case-command-api-prod-*
```

### 8.2 Consumer Minimal ACL

Untuk consumer:

```text
Topic: case.lifecycle.events.v1
- READ
- DESCRIBE

Group: case-projection-worker-prod
- READ
```

Consumer group adalah resource authorization sendiri. Jika lupa memberikan ACL group, consumer bisa gagal walaupun topic READ sudah ada.

### 8.3 Admin Minimal ACL

Admin automation untuk create topic:

```text
Cluster:
- CREATE
- DESCRIBE

Topic prefix:
- CREATE
- DESCRIBE
- ALTER_CONFIGS if allowed by platform policy
```

Namun application service sebaiknya tidak bebas create topic di prod.

### 8.4 Monitoring ACL

Monitoring/exporter biasanya butuh read metadata, bukan read semua data.

Contoh:

```text
Cluster:
- DESCRIBE

Topic:
- DESCRIBE

Group:
- DESCRIBE
```

Jangan beri monitoring principal `READ` semua topic kecuali memang perlu membaca payload.

---

## 9. ACL Pattern untuk Topic

### 9.1 Literal Resource Pattern

Literal berarti ACL berlaku pada resource persis.

```text
Topic: case.lifecycle.events.v1
```

Baik untuk production topic penting.

### 9.2 Prefixed Resource Pattern

Prefixed berarti ACL berlaku untuk resource dengan prefix tertentu.

```text
Topic prefix: case.
```

Berguna untuk domain-scoped access.

Risiko:

```text
Topic prefix: *
Topic prefix: prod.
Topic prefix: event.
```

Prefix terlalu luas membuat boundary tidak bermakna.

### 9.3 Wildcard

Wildcard praktis, tetapi berbahaya.

Contoh buruk:

```text
User:analytics-prod can READ Topic:*
```

Ini berarti analytics bisa membaca semua event, termasuk event sensitif.

Dalam enterprise, wildcard sebaiknya hanya untuk:

1. platform admin sangat terbatas,
2. break-glass access,
3. migration sementara dengan expiry,
4. environment non-production yang benar-benar isolated.

---

## 10. Topic Security by Data Sensitivity

Tidak semua topic punya sensitivitas sama.

Contoh klasifikasi:

| Kelas | Contoh | Security posture |
|---|---|---|
| Public internal | service health events | read luas, write terbatas |
| Domain internal | case state changed | read domain-scoped |
| Sensitive | citizen identity, evidence, enforcement decision | strict read/write, audit, retention reviewed |
| Restricted | legal evidence, whistleblower data, sanctions | isolated topic, explicit approval, no wildcard |

Untuk regulatory/case management systems, event seperti ini sensitif:

```text
case.evidence.attached.v1
case.investigation.opened.v1
case.enforcement.decision.recorded.v1
case.appeal.submitted.v1
case.subject.identity.updated.v1
```

Jangan jadikan topic-topic ini readable oleh semua downstream “untuk fleksibilitas”. Fleksibilitas tanpa boundary adalah data leak yang menunggu waktu.

---

## 11. Multi-Tenant Boundaries

Kafka sering dipakai oleh banyak domain/team dalam satu cluster. Multi-tenant Kafka berarti kamu harus mengendalikan:

1. akses data,
2. resource usage,
3. naming collision,
4. operational blast radius,
5. schema ownership,
6. observability ownership,
7. incident boundary.

### 11.1 Boundary Data

Boundary data melalui:

1. topic namespace,
2. ACL,
3. principal per service,
4. schema subject governance,
5. encryption in transit,
6. optional encryption at rest / field-level encryption.

### 11.2 Boundary Resource

Boundary resource melalui:

1. quotas,
2. partition limits,
3. retention limits,
4. topic creation workflow,
5. max message size policy,
6. producer throughput monitoring,
7. consumer lag SLO.

### 11.3 Boundary Operations

Boundary operations melalui:

1. platform-owned broker configs,
2. domain-owned topic configs dalam batas yang disetujui,
3. GitOps/IaC untuk topic dan ACL,
4. review untuk destructive operations,
5. break-glass protocol.

### 11.4 Cluster per Tenant vs Shared Cluster

| Model | Kelebihan | Kekurangan |
|---|---|---|
| Shared cluster | efisien, mudah operasional, resource pooling | blast radius lebih besar, ACL/quotas wajib matang |
| Cluster per domain | isolation kuat, ownership jelas | mahal, operational overhead tinggi |
| Cluster per sensitivity | balance security dan cost | butuh data classification matang |
| Cluster per environment | wajib untuk prod/non-prod separation | tetap butuh ACL per env |

Rekomendasi umum:

```text
Do not solve every tenancy problem with ACL alone.
```

Untuk data sangat sensitif, cluster-level isolation bisa lebih masuk akal daripada ACL kompleks di shared cluster.

---

## 12. Kafka Connect Security

Kafka Connect memperluas security surface karena ia berdiri di antara Kafka dan external systems.

Connect worker punya beberapa jenis akses:

```text
Connect worker → Kafka internal topics
Connect worker → source/sink topics
Connect connector → external database/API/storage
Connect REST API → operators/users
```

### 12.1 Internal Topics

Kafka Connect distributed mode memakai internal topics:

```text
connect-configs
connect-offsets
connect-status
```

Akses topic ini harus dibatasi. Jika actor tidak sah bisa membaca/mengubah internal topics, ia bisa mengganggu connector configuration, offset, dan status.

### 12.2 Worker Principal vs Connector Principal

Pola sederhana memakai satu principal untuk worker. Masalahnya, semua connector berjalan dengan hak yang sama.

```text
User:connect-worker-prod
```

Ini mudah tetapi coarse-grained.

Risiko:

1. connector A bisa menulis topic connector B,
2. sulit audit per connector,
3. terlalu banyak topic permission pada satu principal,
4. compromised connector berdampak luas.

Pola yang lebih baik pada platform matang:

```text
User:connect-jdbc-source-case-prod
User:connect-s3-sink-audit-prod
User:connect-elasticsearch-sink-search-prod
```

Tidak semua distribusi/deployment Connect mendukung isolasi credential per connector dengan mudah, tetapi desain platform harus menyadari trade-off ini.

### 12.3 Connect REST API

Connect REST API tidak boleh terbuka bebas.

Jika REST API terbuka tanpa auth, actor bisa:

1. membuat connector baru,
2. mengubah connector config,
3. membaca konfigurasi yang mengandung secret,
4. menghentikan connector penting,
5. mengarahkan data ke sink tidak sah.

Prinsip:

```text
Connect REST API is an administrative control plane.
Treat it like production deployment access.
```

### 12.4 Connector Secrets

Connector sering membutuhkan secret:

```text
JDBC password
S3 access key
Elasticsearch API key
HTTP bearer token
```

Jangan simpan secret plaintext di Git atau connector config yang bisa dibaca luas.

Gunakan:

1. secret provider,
2. external secret manager,
3. Kubernetes Secret dengan kontrol akses ketat,
4. config provider,
5. redaction policy,
6. rotation process.

---

## 13. Schema Registry Security

Schema Registry adalah bagian dari contract control plane.

Risiko jika terbuka bebas:

1. actor bisa mendaftarkan schema breaking,
2. actor bisa membaca semua schema domain,
3. actor bisa mengubah compatibility policy,
4. consumer/producer gagal saat evolusi schema,
5. governance contract runtuh.

Security Schema Registry mencakup:

1. TLS untuk komunikasi client-registry.
2. Authentication client.
3. Authorization subject-level jika tersedia.
4. Control siapa boleh register schema.
5. Control siapa boleh mengubah compatibility mode.
6. Audit perubahan schema.

Pola governance:

```text
Producer owner can register schema for owned subjects.
Consumer can read schema for subscribed subjects.
Only platform/schema governance can change global compatibility.
```

---

## 14. ksqlDB Security

ksqlDB biasanya memiliki service principal yang membaca input topic dan menulis output/internal topic.

Risiko:

1. ksqlDB principal diberi read semua topic,
2. user bisa membuat query terhadap data sensitif,
3. internal topic tidak dikelola,
4. output topic bocor ke consumer luas,
5. ksqlDB REST API terbuka.

Prinsip:

```text
ksqlDB is not just a query tool. It is a stream processing service with data access and write capability.
```

Security ksqlDB harus mencakup:

1. authentication ke ksqlDB server,
2. authorization untuk query/user,
3. principal ksqlDB ke Kafka,
4. ACL input topic,
5. ACL output topic,
6. ACL internal topics,
7. schema registry access,
8. audit query creation/change.

---

## 15. Kafka Streams Security

Kafka Streams adalah aplikasi Java biasa, tetapi membutuhkan akses tambahan karena membuat internal topics.

Aplikasi Kafka Streams bisa butuh:

1. read input topics,
2. write output topics,
3. create/write/read internal repartition topics,
4. create/write/read changelog topics,
5. group access berdasarkan `application.id`,
6. transactional ID access jika exactly-once dipakai.

Common issue:

```text
App has READ/WRITE on input/output topics but fails in production because it cannot create or access internal topics.
```

Strategi aman:

1. Pre-create internal topics jika governance ketat.
2. Gunakan prefix internal topic yang predictable dari `application.id`.
3. Scope ACL ke prefix tersebut.
4. Jangan beri app `CREATE` semua topic jika tidak perlu.
5. Dokumentasikan internal topic ownership.

Contoh conceptual:

```text
Application ID: enforcement-sla-streams-prod
Internal topic prefix: enforcement-sla-streams-prod-

ACL:
Topic enforcement.input.events.v1: READ, DESCRIBE
Topic enforcement.sla.breached.v1: WRITE, DESCRIBE
Topic prefix enforcement-sla-streams-prod-: CREATE, READ, WRITE, DESCRIBE
Group enforcement-sla-streams-prod: READ
TransactionalId enforcement-sla-streams-prod-*: WRITE/DESCRIBE as needed
```

---

## 16. Java Client Security Configuration

### 16.1 Producer dengan SASL_SSL SCRAM

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "broker-1:9092,broker-2:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());

props.put(CommonClientConfigs.SECURITY_PROTOCOL_CONFIG, "SASL_SSL");
props.put(SaslConfigs.SASL_MECHANISM, "SCRAM-SHA-512");
props.put(SaslConfigs.SASL_JAAS_CONFIG,
    "org.apache.kafka.common.security.scram.ScramLoginModule required " +
    "username=\"case-command-api-prod\" " +
    "password=\"${KAFKA_PASSWORD}\";");

props.put(SslConfigs.SSL_TRUSTSTORE_LOCATION_CONFIG, "/etc/security/kafka.truststore.jks");
props.put(SslConfigs.SSL_TRUSTSTORE_PASSWORD_CONFIG, System.getenv("KAFKA_TRUSTSTORE_PASSWORD"));

props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

Catatan penting:

```text
Jangan hardcode password seperti contoh literal di source code production.
Gunakan secret manager/environment injection yang diaudit.
```

### 16.2 Consumer dengan SASL_SSL SCRAM

```java
Properties props = new Properties();
props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "broker-1:9092,broker-2:9092");
props.put(ConsumerConfig.GROUP_ID_CONFIG, "case-projection-worker-prod");
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());

props.put(CommonClientConfigs.SECURITY_PROTOCOL_CONFIG, "SASL_SSL");
props.put(SaslConfigs.SASL_MECHANISM, "SCRAM-SHA-512");
props.put(SaslConfigs.SASL_JAAS_CONFIG,
    "org.apache.kafka.common.security.scram.ScramLoginModule required " +
    "username=\"case-projection-worker-prod\" " +
    "password=\"${KAFKA_PASSWORD}\";");

props.put(SslConfigs.SSL_TRUSTSTORE_LOCATION_CONFIG, "/etc/security/kafka.truststore.jks");
props.put(SslConfigs.SSL_TRUSTSTORE_PASSWORD_CONFIG, System.getenv("KAFKA_TRUSTSTORE_PASSWORD"));

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
```

### 16.3 Avoid JAAS String Leakage

`SASL_JAAS_CONFIG` sering bocor ke:

1. logs,
2. exception dump,
3. metrics tags,
4. debug config print,
5. thread dump tooling,
6. deployment manifests.

Prinsip:

```text
Never print effective Kafka client config without redaction.
```

---

## 17. Spring Boot / Spring Kafka Security Configuration

Contoh conceptual `application.yml`:

```yaml
spring:
  kafka:
    bootstrap-servers: broker-1:9092,broker-2:9092
    properties:
      security.protocol: SASL_SSL
      sasl.mechanism: SCRAM-SHA-512
      sasl.jaas.config: >
        org.apache.kafka.common.security.scram.ScramLoginModule required
        username="${KAFKA_USERNAME}"
        password="${KAFKA_PASSWORD}";
      ssl.truststore.location: /etc/security/kafka.truststore.jks
      ssl.truststore.password: ${KAFKA_TRUSTSTORE_PASSWORD}
    producer:
      acks: all
      properties:
        enable.idempotence: true
    consumer:
      group-id: case-projection-worker-prod
      enable-auto-commit: false
```

Production notes:

1. Jangan commit secret ke repository.
2. Pastikan config actuator/env endpoint tidak mengekspos secret.
3. Gunakan secret redaction.
4. Pisahkan credential producer dan consumer jika service punya dua role sensitif.
5. Jangan gunakan satu principal untuk semua microservice Spring.

---

## 18. ACL Examples dengan kafka-acls CLI

Contoh berikut bersifat konseptual. Nama CLI dan option dapat berbeda sesuai distribusi/deployment.

### 18.1 Grant Producer Write

```bash
kafka-acls \
  --bootstrap-server broker-1:9092 \
  --command-config admin.properties \
  --add \
  --allow-principal User:case-command-api-prod \
  --operation Write \
  --operation Describe \
  --topic case.lifecycle.events.v1
```

### 18.2 Grant Consumer Read

```bash
kafka-acls \
  --bootstrap-server broker-1:9092 \
  --command-config admin.properties \
  --add \
  --allow-principal User:case-projection-worker-prod \
  --operation Read \
  --operation Describe \
  --topic case.lifecycle.events.v1
```

```bash
kafka-acls \
  --bootstrap-server broker-1:9092 \
  --command-config admin.properties \
  --add \
  --allow-principal User:case-projection-worker-prod \
  --operation Read \
  --group case-projection-worker-prod
```

### 18.3 Grant Kafka Streams Internal Topic Prefix

```bash
kafka-acls \
  --bootstrap-server broker-1:9092 \
  --command-config admin.properties \
  --add \
  --allow-principal User:enforcement-sla-streams-prod \
  --operation Create \
  --operation Read \
  --operation Write \
  --operation Describe \
  --topic enforcement-sla-streams-prod- \
  --resource-pattern-type prefixed
```

### 18.4 Avoid This

```bash
kafka-acls \
  --add \
  --allow-principal User:case-service-prod \
  --operation All \
  --topic '*'
```

Ini menghilangkan hampir semua boundary.

---

## 19. Security Anti-Patterns

### Anti-Pattern 1 — Shared Credential untuk Semua Service

```text
User:prod-apps
```

Dampak:

1. audit tidak berguna,
2. rotasi credential sulit,
3. compromised service memberi akses luas,
4. tidak bisa enforce least privilege.

Solusi:

```text
Principal per service per environment.
```

### Anti-Pattern 2 — Wildcard READ untuk Analytics

```text
analytics-prod can read all topics
```

Dampak:

1. PII bocor ke data lake,
2. evidence/event sensitif terbaca tanpa approval,
3. data residency dilanggar,
4. downstream copy tidak terkendali.

Solusi:

```text
Curated topics + approval + domain-scoped ACL + data classification.
```

### Anti-Pattern 3 — Application Bisa Create Topic Bebas

Dampak:

1. topic sprawl,
2. naming chaos,
3. retention salah,
4. replication factor salah,
5. governance hilang.

Solusi:

```text
Topic creation lewat platform workflow/IaC.
```

### Anti-Pattern 4 — Connect Worker Superuser

Dampak:

1. connector compromise membaca/menulis semua topic,
2. source credential bocor,
3. sink salah konfigurasi bisa exfiltrate data.

Solusi:

```text
Least privilege per connector/domain where possible.
```

### Anti-Pattern 5 — Disabling Hostname Verification

```properties
ssl.endpoint.identification.algorithm=
```

Dampak:

1. client tidak memverifikasi hostname broker,
2. risiko man-in-the-middle meningkat,
3. certificate mismatch tersembunyi.

Solusi:

```text
Fix certificate SAN/hostname instead of disabling verification.
```

### Anti-Pattern 6 — `allow.everyone.if.no.acl.found=true`

Konfigurasi ini dapat membuat resource tanpa ACL menjadi accessible. Ini sangat berbahaya di production shared cluster.

Solusi:

```text
Default deny mindset.
Explicit ACL for every production resource.
```

### Anti-Pattern 7 — Manual ACL Changes Tanpa Review

Dampak:

1. akses liar,
2. tidak ada audit trail,
3. privilege creep,
4. sulit incident investigation.

Solusi:

```text
ACL as code + review + owner approval + expiry for temporary access.
```

---

## 20. Security untuk Regulatory / Case Management Systems

Dalam sistem enforcement lifecycle, Kafka bisa membawa event seperti:

```text
case.created.v1
case.assigned.v1
case.evidence.received.v1
case.risk.score.updated.v1
case.enforcement.notice.issued.v1
case.appeal.submitted.v1
case.decision.finalized.v1
case.redaction.applied.v1
```

Security concern:

1. Siapa boleh membuat event keputusan?
2. Siapa boleh membaca evidence?
3. Siapa boleh melihat identity subject?
4. Siapa boleh replay event lama?
5. Siapa boleh membuat projection untuk analytics?
6. Siapa boleh membuat connector ke data lake?
7. Siapa boleh mengubah schema event keputusan?
8. Apakah akses sementara punya expiry?
9. Apakah ada log perubahan ACL?
10. Apakah DLQ menyimpan data sensitif?

### 20.1 Decision Events

Event keputusan regulatory harus sangat ketat.

```text
case.enforcement.decision.recorded.v1
```

Producer yang boleh:

```text
User:enforcement-decision-service-prod
```

Consumer yang boleh:

```text
User:case-audit-projector-prod
User:notification-service-prod, if justified
User:regulatory-reporting-prod, if approved
```

Tidak boleh:

```text
User:all-backend-prod
User:analytics-prod wildcard
```

### 20.2 Evidence Events

Evidence events mungkin mengandung dokumen, URI, metadata, subject identity, atau hash.

Prinsip:

```text
Avoid putting raw sensitive evidence payload directly in Kafka unless there is a strong reason.
```

Alternatif:

```text
Kafka event contains immutable evidence reference + hash + access-controlled object storage pointer.
```

Namun reference pun tetap sensitif jika bisa membuka akses ke evidence.

### 20.3 Replay Risk

Kafka memungkinkan replay. Ini powerful, tetapi juga security concern.

Consumer dengan READ access bisa membaca data historis selama retention masih tersedia.

Pertanyaan governance:

1. Apakah consumer baru boleh membaca history penuh?
2. Apakah akses read hanya untuk data baru atau juga replay?
3. Apakah topic retention selaras dengan policy hukum?
4. Apakah replay ke environment non-prod dilarang?
5. Apakah data redaction perlu event korektif?

ACL Kafka tidak membedakan “read from now” vs “read from beginning”. Jika punya READ topic, consumer dapat seek offset lama sejauh retention mengizinkan.

---

## 21. Secret Management

Kafka clients membutuhkan credential. Kesalahan secret management sering lebih berbahaya daripada konfigurasi ACL yang kurang ideal.

### 21.1 Jangan Simpan Secret di Source Code

Buruk:

```java
props.put(SaslConfigs.SASL_JAAS_CONFIG,
  "... username=\"case-service-prod\" password=\"ProdPassword123\";");
```

Baik:

```java
String username = secretProvider.get("kafka.username");
String password = secretProvider.get("kafka.password");
```

### 21.2 Jangan Log Secret

Hindari:

```java
log.info("Kafka config: {}", props);
```

Gunakan redaction:

```text
sasl.jaas.config = [REDACTED]
ssl.truststore.password = [REDACTED]
ssl.keystore.password = [REDACTED]
```

### 21.3 Rotation

Credential harus bisa dirotasi tanpa downtime besar.

Pattern:

1. create new credential,
2. deploy clients dengan credential baru,
3. verify traffic,
4. revoke old credential,
5. audit access.

Jangan menunggu incident untuk membuktikan rotation bisa dilakukan.

---

## 22. Network Security

Kafka authorization tidak menggantikan network boundary.

Layer network:

1. private subnet,
2. security group / firewall,
3. Kubernetes NetworkPolicy,
4. VPC peering controls,
5. private link / endpoint service,
6. load balancer listener isolation,
7. no public broker unless explicitly designed.

Principle:

```text
A client that cannot reach Kafka does not need to be authorized by Kafka.
```

Defense in depth:

```text
Network allowlist + TLS + authentication + ACL + quota + audit
```

---

## 23. Quotas as Security Boundary

Quota bukan hanya performance feature. Dalam multi-tenant cluster, quota adalah protection dari noisy neighbor dan accidental denial-of-service.

Contoh risiko:

1. producer bug mengirim 10x traffic,
2. consumer loop melakukan aggressive fetch,
3. connector retry storm,
4. misconfigured batch size menghasilkan pressure besar,
5. analytics consumer membaca ulang seluruh topic saat jam sibuk.

Quota dapat diterapkan pada:

1. producer byte rate,
2. consumer byte rate,
3. request percentage/time,
4. client ID/principal level tergantung konfigurasi.

Security mindset:

```text
Least privilege includes resource privilege, not only data privilege.
```

---

## 24. Data Protection Beyond Kafka ACL

Kafka ACL mengatur akses ke topic, tetapi tidak otomatis melindungi field di dalam event.

Jika topic mengandung data campuran:

```json
{
  "caseId": "CASE-123",
  "subjectName": "...",
  "nationalId": "...",
  "riskScore": 92,
  "decision": "ESCALATE"
}
```

Maka semua consumer dengan READ topic bisa membaca semua field.

Strategi:

1. split sensitive fields into restricted topic,
2. tokenize/pseudonymize PII,
3. encrypt field-level payload,
4. use reference token to secure store,
5. create curated redacted topic,
6. apply data classification at schema level.

Contoh split:

```text
case.lifecycle.events.v1                 # general lifecycle, lower sensitivity
case.subject.identity.events.v1           # restricted identity data
case.evidence.metadata.events.v1          # restricted evidence metadata
case.enforcement.decision.events.v1       # restricted decision trail
```

---

## 25. Security Governance as Code

Manual security configuration tidak scale.

Recommended artifact:

```yaml
topic: case.lifecycle.events.v1
owner: case-platform
classification: sensitive
retention: 365d
producers:
  - principal: User:case-command-api-prod
    operations: [Write, Describe]
consumers:
  - principal: User:case-projection-worker-prod
    group: case-projection-worker-prod
    operations: [Read, Describe]
  - principal: User:case-audit-projector-prod
    group: case-audit-projector-prod
    operations: [Read, Describe]
approvals:
  data-owner: approved
  security: approved
```

Security-as-code memberi:

1. review,
2. diff,
3. rollback,
4. audit trail,
5. repeatability,
6. drift detection.

---

## 26. Failure Modes

### 26.1 Expired Certificate

Symptom:

```text
Clients fail to connect.
SSL handshake exception.
Cluster traffic drops.
```

Prevention:

1. monitor certificate expiry,
2. automate rotation,
3. test rotation,
4. keep overlapping trust during transition.

### 26.2 Wrong Principal Mapping

Symptom:

```text
Client authenticates but ACL denied.
Principal appears as unexpected DN.
```

Prevention:

1. define principal mapping rules,
2. test with real certificate,
3. verify principal in broker auth logs,
4. avoid ambiguous certificate subjects.

### 26.3 ACL Missing Group Permission

Symptom:

```text
Consumer can describe topic but cannot join/read group.
Authorization failed for group.
```

Prevention:

```text
Consumer ACL template must include topic READ/DESCRIBE and group READ.
```

### 26.4 Overbroad Connect Permission

Symptom:

```text
One connector can accidentally write to unrelated topics.
```

Prevention:

1. principal per connector where possible,
2. restrict topic prefixes,
3. review connector configs,
4. restrict Connect REST API.

### 26.5 Secret Leak in Logs

Symptom:

```text
JAAS config appears in application logs.
```

Prevention:

1. config redaction,
2. log scanning,
3. secret manager,
4. avoid dumping Properties.

### 26.6 Wildcard ACL Drift

Symptom:

```text
Temporary wildcard access remains forever.
```

Prevention:

1. expiry date for temporary ACL,
2. scheduled review,
3. IaC policy check,
4. no manual production ACL without ticket.

---

## 27. Design Trade-Offs

### 27.1 mTLS vs SASL/SCRAM

| Dimension | mTLS | SASL/SCRAM |
|---|---|---|
| Identity strength | strong certificate identity | username/password challenge-response |
| Rotation | certificate lifecycle | password/secret lifecycle |
| Operational complexity | higher | moderate |
| Cloud-native friendliness | depends on PKI/tooling | generally simple |
| Audit clarity | good if DN mapping clean | good if username design clean |
| Human debugging | harder | easier |

Practical rule:

```text
Use the mechanism your organization can operate correctly.
Badly operated mTLS is not better than well-operated SCRAM.
```

### 27.2 ACL vs RBAC

Open-source Kafka commonly uses ACL. Some platforms add RBAC.

ACL:

1. close to Kafka resource model,
2. explicit,
3. portable,
4. can become verbose.

RBAC:

1. easier for enterprise role mapping,
2. better for large org governance,
3. depends on vendor/platform,
4. still must map to actual resource boundaries.

Do not assume RBAC automatically solves topic design. Bad topic boundaries remain bad.

### 27.3 One Cluster vs Separate Cluster for Sensitive Data

Shared cluster with ACL:

1. cheaper,
2. simpler operations,
3. needs mature ACL/governance.

Dedicated sensitive cluster:

1. stronger isolation,
2. smaller blast radius,
3. higher cost,
4. more operational overhead.

Decision heuristic:

```text
If unauthorized read would be a severe regulatory incident, consider stronger isolation than ACL alone.
```

---

## 28. Production Readiness Checklist

### 28.1 Broker / Cluster

- [ ] TLS enabled for client-broker traffic.
- [ ] Inter-broker traffic secured.
- [ ] Controller/KRaft listener isolated.
- [ ] Hostname verification not disabled casually.
- [ ] Broker certificates monitored for expiry.
- [ ] Authentication enabled.
- [ ] Authorization enabled.
- [ ] Default allow behavior reviewed.
- [ ] Superusers minimal and documented.
- [ ] Broker auth logs retained.

### 28.2 Client Identity

- [ ] Principal per service.
- [ ] Principal per environment.
- [ ] No shared prod credential.
- [ ] Secret stored in approved secret manager.
- [ ] Rotation tested.
- [ ] Config logs redact secrets.

### 28.3 ACL

- [ ] Producer has only required WRITE/DESCRIBE.
- [ ] Consumer has topic READ/DESCRIBE and group READ.
- [ ] Kafka Streams internal topic prefix scoped.
- [ ] Connect internal topic access restricted.
- [ ] Schema Registry subject access governed.
- [ ] No broad wildcard except approved break-glass.
- [ ] Temporary access has expiry.
- [ ] ACL managed as code.

### 28.4 Data Governance

- [ ] Topic classification exists.
- [ ] Sensitive topic consumers approved.
- [ ] Retention matches compliance requirement.
- [ ] DLQ sensitivity reviewed.
- [ ] Replay risk reviewed.
- [ ] Redacted/curated topics used where needed.
- [ ] Schema compatibility policy enforced.

### 28.5 Platform Operations

- [ ] Connect REST API protected.
- [ ] ksqlDB REST API protected.
- [ ] Monitoring access is metadata-only unless justified.
- [ ] Quotas configured for high-risk tenants.
- [ ] Break-glass procedure documented.
- [ ] Security incident playbook exists.

---

## 29. Latihan / Thought Exercises

### Latihan 1 — Desain Principal

Kamu punya service:

```text
case-command-api
case-projection-worker
evidence-ingestion-worker
regulatory-reporting-service
```

Untuk environment:

```text
dev
staging
prod
```

Buat principal naming scheme yang:

1. audit-friendly,
2. environment-safe,
3. tidak terlalu panjang,
4. mudah dipakai di ACL-as-code.

### Latihan 2 — Minimal ACL

Topic:

```text
case.lifecycle.events.v1
```

Producer:

```text
case-command-api-prod
```

Consumer:

```text
case-projection-worker-prod
```

Consumer group:

```text
case-projection-worker-prod
```

Tentukan ACL minimal untuk producer dan consumer.

### Latihan 3 — Sensitive Topic Review

Topic:

```text
case.evidence.metadata.events.v1
```

Consumer request:

```text
analytics-platform-prod wants READ access for dashboarding.
```

Pertanyaan:

1. Apakah langsung diberi READ?
2. Apakah perlu curated/redacted topic?
3. Siapa approval owner?
4. Apakah analytics boleh replay historical data?
5. Apakah DLQ dari pipeline analytics juga sensitif?

### Latihan 4 — Connect Threat Model

Connector:

```text
JDBC source connector from enforcement database to Kafka
```

Identifikasi:

1. Kafka topics yang perlu ditulis.
2. Internal topics yang perlu diakses worker.
3. Database credential yang perlu dijaga.
4. Risiko jika Connect REST API terbuka.
5. Risiko jika worker principal punya WRITE semua topic.

### Latihan 5 — Kafka Streams ACL

Aplikasi Kafka Streams:

```text
application.id = enforcement-sla-streams-prod
input topic = case.lifecycle.events.v1
output topic = case.sla.breached.events.v1
```

Buat ACL untuk:

1. input topic,
2. output topic,
3. internal topics,
4. group,
5. transactional ID jika exactly-once dipakai.

---

## 30. Ringkasan

Kafka security harus dipahami sebagai kombinasi:

```text
network boundary
+ TLS encryption
+ authentication
+ principal design
+ authorization
+ secret management
+ data governance
+ auditability
+ operational discipline
```

Poin paling penting:

1. TLS melindungi traffic, tetapi tidak menentukan siapa boleh baca/tulis topic.
2. Authentication menghasilkan principal; principal harus spesifik dan audit-friendly.
3. Authorization melalui ACL/RBAC harus mengikuti least privilege.
4. Consumer READ access berarti bisa replay data lama selama retention tersedia.
5. Topic security harus mengikuti sensitivitas data, bukan sekadar struktur teknis.
6. Kafka Connect, ksqlDB, Schema Registry, dan Kafka Streams menambah security surface.
7. Wildcard ACL, shared credential, dan open Connect REST API adalah red flag besar.
8. Security harus dikelola sebagai code agar bisa direview, diaudit, dan direproduksi.
9. Untuk regulatory/case management systems, security Kafka adalah bagian dari defensibility.

Mental model akhirnya:

```text
Kafka topic is a shared contract.
Kafka principal is accountable identity.
Kafka ACL is enforceable boundary.
Kafka audit is institutional memory.
Kafka security failure is often architecture failure, not just config failure.
```

---

## 31. Apa yang Tidak Dibahas Mendalam di Part Ini

Part ini sengaja tidak membahas secara detail:

1. Setup certificate authority step-by-step.
2. Full Kerberos administration.
3. Vendor-specific RBAC implementation.
4. Cloud-specific Kafka security detail seperti MSK IAM, Confluent Cloud API keys, atau Azure Event Hubs specifics.
5. Kubernetes service mesh security.
6. Encryption at rest per cloud provider.

Itu bisa menjadi materi lanjutan setelah fondasi Kafka core selesai.

---

## 32. Koneksi ke Part Berikutnya

Setelah memahami security, seri akan masuk ke Kafka Connect.

Security part ini menjadi penting karena Kafka Connect:

1. membawa credential external system,
2. bisa membaca/menulis banyak topic,
3. memiliki REST API control plane,
4. menggunakan internal topics,
5. sering dipakai untuk CDC dan sink data sensitif.

Part berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-014.md
Kafka Connect Fundamentals: Source, Sink, Workers, Tasks, Converters
```

Di sana kita akan membedah Kafka Connect sebagai runtime integrasi data, bukan sekadar plugin runner.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Log Compaction and KTable Mental Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-014.md">Part 014 — Kafka Connect Fundamentals: Source, Sink, Workers, Tasks, Converters ➡️</a>
</div>
