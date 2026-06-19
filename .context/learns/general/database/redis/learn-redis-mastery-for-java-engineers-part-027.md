# learn-redis-mastery-for-java-engineers-part-027.md

# Part 027 — Security: AUTH, ACL, TLS, Network Boundary, Secret Hygiene

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memakai Redis secara production-grade  
> Fokus bagian ini: security Redis sebagai sistem stateful berisi data sensitif, bukan sekadar cache internal

---

## 0. Posisi Bagian Ini Dalam Seri

Sampai bagian sebelumnya, kita sudah membahas Redis dari sisi:

- data model;
- TTL dan eviction;
- caching;
- idempotency;
- rate limiting;
- locking;
- scripting;
- Pub/Sub;
- Streams;
- persistence;
- replication;
- cluster;
- memory;
- latency;
- Java client;
- transaction/optimistic concurrency.

Bagian ini membahas satu pertanyaan yang sering diremehkan:

> Kalau Redis “hanya cache”, apakah Redis perlu security serius?

Jawabannya: **ya, sangat perlu**.

Redis sering berisi:

- session token;
- authentication state;
- authorization cache;
- password reset token;
- OTP state;
- user profile cache;
- account entitlement;
- workflow transient state;
- idempotency key;
- fraud/risk decision cache;
- rate limit counter;
- lock state;
- queue/stream message;
- feature flag targeting;
- vector/search index;
- personally identifiable information;
- temporary regulatory case state.

Banyak organisasi menyebut Redis “cache”, tetapi isi Redis sering cukup kuat untuk:

- mengambil alih sesi user;
- bypass rate limiter;
- mengubah entitlement;
- menghapus evidence sementara;
- mematikan service lewat `FLUSHALL`;
- mencuri data sensitif;
- menyebabkan outage lewat command mahal;
- menjalankan logic server-side yang tidak diaudit;
- membuat sistem mengeluarkan keputusan salah.

Jadi prinsip awal bagian ini:

> Redis harus diperlakukan sebagai **privileged state system**. Bukan karena selalu menjadi source of truth, tetapi karena state di dalamnya sering memengaruhi authorization, correctness, availability, dan auditability.

---

## 1. Mental Model Security Redis

Security Redis bisa dipahami sebagai beberapa boundary.

```text
Application Code
   |
   | client library: Lettuce / Jedis / Spring Data Redis
   v
Network Boundary
   |
   | TLS? private subnet? security group? firewall?
   v
Redis Authentication Boundary
   |
   | AUTH / ACL user / password / certificate
   v
Redis Authorization Boundary
   |
   | allowed commands, key patterns, channel patterns, categories
   v
Redis Runtime Boundary
   |
   | dangerous commands, Lua, functions, config, persistence, replication
   v
Data Boundary
   |
   | PII, tokens, TTL, serialization, encryption-at-app-layer, retention
```

Redis security bukan hanya “pakai password”. Password hanya satu lapisan.

Security Redis production-grade harus menjawab:

1. **Siapa** yang boleh connect?
2. **Dari mana** boleh connect?
3. **Dengan transport apa** koneksi berlangsung?
4. **User Redis mana** yang dipakai aplikasi?
5. **Command apa** yang boleh dijalankan?
6. **Key pattern apa** yang boleh diakses?
7. **Channel pattern apa** yang boleh publish/subscribe?
8. **Data apa** yang boleh disimpan?
9. **Berapa lama** data boleh hidup?
10. **Bagaimana secret dirotasi?**
11. **Bagaimana akses diaudit?**
12. **Bagaimana command berbahaya dibatasi?**
13. **Apa blast radius kalau credential bocor?**

Kalau Redis diakses oleh banyak service dengan satu shared password dan permission `+@all ~*`, maka Redis secara praktis adalah **shared root shell untuk state backend**.

---

## 2. Redis Threat Model

Sebelum bicara konfigurasi, kita perlu memahami threat model.

### 2.1 Threat Actor

Kemungkinan aktor risiko:

| Aktor | Contoh Risiko |
|---|---|
| External attacker | Redis accidentally exposed to internet |
| Compromised app service | Service A credential dipakai akses key Service B |
| Malicious insider | Engineer menjalankan `FLUSHALL` atau dump data |
| Buggy application | Infinite key write, wrong prefix, no TTL |
| Misconfigured CI/CD | Secret Redis tercetak di log |
| Observability leak | Redis URL/password masuk trace atau metric tag |
| Over-privileged batch job | Tool admin bisa menghapus seluruh keyspace |
| Compromised bastion | Operator credential dicuri |
| Rogue script/function | Lua/function mahal atau destruktif |

### 2.2 Asset Yang Dilindungi

Redis asset bukan cuma data.

| Asset | Kenapa Penting |
|---|---|
| Keyspace data | Bisa berisi token, cache PII, workflow state |
| Availability | Redis mati bisa menjatuhkan login, checkout, rate limiter |
| Command surface | `FLUSHALL`, `CONFIG`, `EVAL`, `FUNCTION`, `KEYS` bisa berbahaya |
| Memory capacity | Attack bisa mengisi memory sampai eviction/OOM |
| Latency budget | Command mahal bisa memblokir server |
| Persistence files | RDB/AOF bisa berisi data sensitif |
| Replication links | Replica bisa menjadi jalur kebocoran data |
| Backup | Backup Redis sering lupa dienkripsi/dirotasi |
| Operational credentials | Admin ACL user sering terlalu kuat |

### 2.3 Failure Mode Security

Redis security incident sering tidak tampak sebagai “security incident”. Bisa terlihat seperti:

- cache hit ratio turun;
- Redis memory naik tiba-tiba;
- banyak key hilang;
- latency Redis melonjak;
- service login error;
- rate limiter tidak bekerja;
- lock tidak pernah release;
- queue worker idle;
- `WRONGTYPE` error karena key ditimpa service lain;
- data user bocor lewat debug endpoint;
- failover tidak bisa connect karena credential mismatch;
- aplikasi production memakai Redis staging karena secret salah.

Security Redis harus dikaitkan dengan **operability**.

---

## 3. Network Boundary: Redis Tidak Boleh Jadi Public API

Prinsip pertama:

> Redis bukan service publik. Redis harus berada di private network boundary.

### 3.1 Jangan Expose Redis ke Internet

Redis port default adalah `6379`. Jika Redis dapat diakses dari internet, semua lapisan lain menjadi jauh lebih rapuh.

Redis sebaiknya hanya dapat diakses oleh:

- application subnet;
- specific Kubernetes namespace/network policy;
- specific security group;
- specific VPC/VNet;
- bastion/admin path yang dibatasi;
- monitoring agent yang perlu akses minimal.

Tidak boleh:

```text
0.0.0.0/0 -> Redis:6379
```

Untuk managed Redis seperti cloud service, gunakan:

- private endpoint;
- VPC peering/private link;
- security group allowlist;
- subnet isolation;
- no public access jika memungkinkan.

### 3.2 Protected Mode Bukan Security Strategy Utama

Redis memiliki protected mode untuk mengurangi risiko instance lokal yang accidentally exposed. Tetapi protected mode tidak boleh dianggap sebagai strategi security production.

Strategi production tetap:

- bind ke interface yang tepat;
- firewall/security group;
- authentication;
- ACL;
- TLS;
- least privilege;
- monitoring.

Protected mode adalah safety net, bukan perimeter.

### 3.3 Bind Address

Contoh konfigurasi self-hosted:

```conf
bind 127.0.0.1 10.10.2.15
protected-mode yes
port 6379
```

Untuk container/Kubernetes, jangan asal bind `0.0.0.0` tanpa network policy.

Di Kubernetes, service Redis harus dibatasi dengan:

- namespace isolation;
- NetworkPolicy;
- secret management;
- mTLS/service mesh jika dipakai;
- no LoadBalancer public;
- no NodePort terbuka.

### 3.4 Network Policy Example

Contoh konseptual Kubernetes NetworkPolicy:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: redis-allow-specific-apps
  namespace: platform-data
spec:
  podSelector:
    matchLabels:
      app: redis
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: case-management
          podSelector:
            matchLabels:
              app: case-api
      ports:
        - protocol: TCP
          port: 6379
```

Jangan mengandalkan Redis ACL untuk menggantikan network boundary. ACL membatasi apa yang bisa dilakukan setelah connect. Network boundary membatasi siapa yang bisa mencoba connect.

---

## 4. Authentication: AUTH Legacy vs ACL Users

Redis mendukung dua model besar authentication:

1. legacy password via `requirepass`;
2. ACL users dengan username/password dan permission granular.

Untuk production modern, gunakan ACL users.

### 4.1 Legacy `requirepass`

Contoh:

```conf
requirepass super-secret-password
```

Client connect:

```bash
redis-cli -a super-secret-password
```

Masalah legacy approach:

- satu password untuk semua client;
- permission biasanya terlalu luas;
- tidak ada identity per service;
- rotasi sulit;
- blast radius besar;
- audit lebih lemah;
- tidak bisa membatasi key prefix per service.

Legacy password mungkin masih ada untuk compatibility, tetapi bukan pilihan ideal untuk multi-service production.

### 4.2 ACL User

ACL memungkinkan Redis punya user berbeda dengan permission berbeda.

Contoh:

```conf
user default off
user case-api on >case-api-secret ~case:* +@read +@write -@dangerous
user case-worker on >case-worker-secret ~case:* ~queue:* +@read +@write +@stream -@dangerous
user readonly-dashboard on >dashboard-secret ~metrics:* +@read -@write -@dangerous
```

Makna high-level:

- `user case-api`: nama user;
- `on`: user aktif;
- `>secret`: password;
- `~case:*`: key pattern yang boleh diakses;
- `+@read`: boleh command kategori read;
- `+@write`: boleh command kategori write;
- `-@dangerous`: larang command berbahaya.

ACL memberi kemampuan:

- named users;
- multiple passwords per user;
- command allow/deny;
- command category;
- key pattern restriction;
- channel pattern restriction;
- rotating credentials lebih aman;
- separation of duties.

---

## 5. ACL Core Syntax

ACL syntax Redis perlu dipahami dengan hati-hati.

### 5.1 User On/Off

```conf
user app on >password ...
user old-app off
```

`off` berarti user tidak bisa authenticate.

### 5.2 Password

```conf
user app on >password1 >password2
```

Redis ACL dapat menyimpan lebih dari satu password untuk user. Ini berguna untuk rotasi:

1. tambahkan password baru;
2. deploy app dengan password baru;
3. hapus password lama.

### 5.3 Key Pattern

```conf
~case:*
~tenant:{123}:*
```

Key pattern membatasi key yang boleh diakses user.

Contoh buruk:

```conf
~*
```

Artinya user bisa mengakses semua key.

Contoh lebih baik:

```conf
~case-api:*
~idempotency:case-api:*
~ratelimit:case-api:*
```

### 5.4 Command Permission

```conf
+GET +SET +DEL +EXPIRE
```

Atau kategori:

```conf
+@read +@write
```

Tetapi kategori harus dipakai dengan hati-hati karena bisa memberi permission lebih luas dari yang dibutuhkan.

### 5.5 Deny Specific Commands

```conf
-KEYS -FLUSHALL -FLUSHDB -CONFIG -EVAL -FUNCTION -SCRIPT
```

Untuk service biasa, command admin harus dilarang.

### 5.6 Reset Rules

Redis ACL memiliki modifier reset seperti:

```conf
reset
resetkeys
resetchannels
resetpass
```

Gunakan dengan hati-hati dalam automation karena bisa menghapus permission/password yang sudah ada.

---

## 6. Command Categories: Jangan Beri `+@all` Sembarangan

Redis command dikelompokkan dalam kategori.

Contoh kategori umum:

- `@read`
- `@write`
- `@string`
- `@hash`
- `@set`
- `@sortedset`
- `@stream`
- `@pubsub`
- `@transaction`
- `@scripting`
- `@connection`
- `@admin`
- `@dangerous`
- `@slow`
- `@blocking`

Masalahnya: kategori terlalu luas bisa tidak sesuai kebutuhan aplikasi.

Contoh:

```conf
user app on >secret ~app:* +@all
```

Ini buruk karena app bisa menjalankan command yang tidak perlu.

Lebih baik:

```conf
user session-api on >secret \
  ~session:* \
  +GET +SET +DEL +EXPIRE +TTL +PTTL +MGET +UNLINK \
  -@dangerous
```

Untuk rate limiter:

```conf
user rate-limiter on >secret \
  ~rl:* \
  +GET +SET +INCR +INCRBY +EXPIRE +PTTL +TTL +EVALSHA +SCRIPT|LOAD \
  -@dangerous
```

Untuk stream worker:

```conf
user stream-worker on >secret \
  ~stream:case:* \
  +XREADGROUP +XACK +XCLAIM +XAUTOCLAIM +XINFO +XPENDING +XADD +XTRIM \
  -@dangerous
```

Catatan:

- contoh ini perlu disesuaikan dengan command nyata yang dipakai client;
- beberapa client/framework mungkin menjalankan command tambahan seperti `HELLO`, `AUTH`, `CLIENT`, `SELECT`, `PING`, `COMMAND`, atau cluster discovery command;
- permission harus diuji lewat integration test.

---

## 7. Key Pattern Authorization dan Prefix Discipline

ACL key pattern hanya berguna kalau key naming disiplin.

Kalau key Anda seperti ini:

```text
user:123
profile:123
cache:abc
lock:xyz
```

Sulit memberi permission yang jelas per bounded context.

Lebih baik:

```text
case-api:v1:case:{caseId}:summary
case-api:v1:session:{sessionId}
case-worker:v1:idempotency:{eventId}
risk-api:v1:rate:{tenantId}:{subject}
```

Dengan prefix ownership:

```text
<owner-service>:<schema-version>:<domain>:<identifier>:<purpose>
```

Maka ACL bisa seperti:

```conf
user case-api on >secret ~case-api:* +GET +SET +DEL +EXPIRE -@dangerous
user risk-api on >secret ~risk-api:* +GET +SET +INCR +EXPIRE -@dangerous
```

### 7.1 Jangan Share Prefix Antar Service

Anti-pattern:

```text
cache:user:123
```

Dipakai oleh:

- user-api;
- billing-api;
- notification-api;
- admin-api.

Akhirnya semua service butuh akses ke `cache:user:*`. ACL menjadi tidak berguna.

Lebih baik:

```text
user-api:v1:user:{id}:profile-cache
billing-api:v1:user:{id}:billing-snapshot
notification-api:v1:user:{id}:preferences-cache
```

Data mungkin berasal dari entity user yang sama, tetapi ownership cache berbeda.

---

## 8. Dangerous Commands

Redis punya command yang sangat berguna untuk operator, tetapi berbahaya untuk aplikasi biasa.

### 8.1 `FLUSHALL` dan `FLUSHDB`

Menghapus seluruh database/keyspace.

Production application user hampir tidak pernah perlu command ini.

```conf
-FLUSHALL -FLUSHDB
```

### 8.2 `CONFIG`

Dapat membaca/mengubah konfigurasi Redis.

Risiko:

- disable protected mode;
- ubah persistence path;
- ubah maxmemory;
- ubah appendonly;
- buka attack surface.

```conf
-CONFIG
```

### 8.3 `KEYS`

`KEYS *` bisa memblokir Redis pada keyspace besar.

Gunakan `SCAN` untuk operasi iteratif, tetapi tetap hati-hati.

```conf
-KEYS
```

### 8.4 `EVAL`, `SCRIPT`, `FUNCTION`

Lua/script/function memungkinkan logic server-side. Berguna, tetapi berbahaya jika user aplikasi biasa boleh menjalankan script arbitrary.

Strategi:

- service biasa hanya boleh `EVALSHA` untuk script yang sudah di-load oleh deployment pipeline;
- atau hanya Redis Functions yang sudah direview;
- larang `EVAL` langsung untuk app runtime bila memungkinkan;
- pisahkan user deployment/function-loader dari user runtime.

Contoh:

```conf
user rate-limiter-runtime on >secret ~rl:* +EVALSHA -EVAL -SCRIPT -FUNCTION
user redis-function-deployer on >secret ~* +FUNCTION +SCRIPT +@read +@write -FLUSHALL -FLUSHDB
```

Namun, command permission harus disesuaikan dengan Redis version dan client behavior.

### 8.5 `MIGRATE`, `RESTORE`, `DUMP`

Command ini dapat memindahkan/mengambil serialized value.

Risiko:

- data exfiltration;
- key injection;
- migration destructive.

Biasanya hanya untuk tooling/operator.

### 8.6 `CLIENT`

`CLIENT KILL`, `CLIENT PAUSE`, `CLIENT TRACKING`, dan command terkait client bisa berdampak pada koneksi lain.

Aplikasi tertentu mungkin perlu `CLIENT SETNAME` atau tracking untuk client-side caching, tetapi jangan beri seluruh `CLIENT` permission tanpa alasan.

### 8.7 `MODULE` / Module-Related Commands

Pada Redis modern, beberapa capability Stack sudah terintegrasi, tetapi prinsipnya sama: command yang mengubah runtime/module/index harus dibatasi.

### 8.8 Admin Commands

Command admin hanya untuk operator/deployment pipeline:

- `SAVE`
- `BGSAVE`
- `BGREWRITEAOF`
- `SHUTDOWN`
- `REPLICAOF`
- `CLUSTER`
- `ACL`
- `CONFIG`
- `MONITOR`
- `DEBUG`

`MONITOR` juga berisiko karena bisa membocorkan command dan data argument.

---

## 9. TLS: Transport Encryption

Redis bisa memakai TLS untuk mengenkripsi komunikasi client-server dan, dalam deployment tertentu, node-to-node.

### 9.1 Kapan TLS Wajib?

TLS sebaiknya dipakai ketika:

- Redis diakses lintas host;
- Redis ada di cloud/managed network;
- network tidak sepenuhnya trusted;
- Redis membawa token/session/PII;
- compliance mensyaratkan encryption in transit;
- multi-tenant infrastructure;
- service mesh tidak sudah menyediakan transport encryption yang valid.

Dalam banyak production environment, jawabannya: **pakai TLS**.

### 9.2 TLS Self-Hosted High-Level Config

Contoh konseptual:

```conf
port 0
tls-port 6379

tls-cert-file /etc/redis/tls/redis.crt
tls-key-file /etc/redis/tls/redis.key
tls-ca-cert-file /etc/redis/tls/ca.crt

tls-auth-clients yes
```

`port 0` menonaktifkan non-TLS TCP port.

### 9.3 Client-Side TLS dengan Lettuce

Contoh high-level Java Lettuce:

```java
RedisURI redisUri = RedisURI.builder()
        .withHost("redis.internal")
        .withPort(6379)
        .withSsl(true)
        .withAuthentication("case-api", redisPassword.toCharArray())
        .build();

RedisClient client = RedisClient.create(redisUri);
StatefulRedisConnection<String, String> connection = client.connect();
```

Untuk certificate validation, jangan disable verification sembarangan.

Anti-pattern:

```java
// Pseudocode anti-pattern: trust all certificates
sslOptions.trustManager(InsecureTrustManagerFactory.INSTANCE);
```

Ini membuat TLS hanya menjadi enkripsi tanpa autentikasi server yang kuat.

### 9.4 TLS Operational Risks

TLS menambah beberapa aspek operasional:

- certificate rotation;
- hostname validation;
- CA truststore;
- expiry monitoring;
- client compatibility;
- latency/CPU overhead;
- failover endpoint certificate matching;
- managed Redis certificate chain updates.

Security yang baik harus masuk runbook, bukan hanya config awal.

---

## 10. Secret Hygiene di Java Services

Redis credential sering bocor bukan dari Redis, tetapi dari cara aplikasi mengelola secret.

### 10.1 Jangan Hardcode

Buruk:

```java
String redisPassword = "P@ssw0rd123";
```

Buruk juga:

```yaml
spring:
  data:
    redis:
      password: P@ssw0rd123
```

jika file ini masuk Git.

Gunakan:

- Kubernetes Secret dengan envelope encryption;
- Vault;
- AWS Secrets Manager;
- GCP Secret Manager;
- Azure Key Vault;
- SOPS/SealedSecrets;
- platform secret injection.

### 10.2 Jangan Log Redis URI

Redis URI bisa berisi credential:

```text
redis://user:password@host:6379
```

Jangan log full URI.

Gunakan redaction:

```java
String safeRedisEndpoint = redisHost + ":" + redisPort;
log.info("Connecting to Redis endpoint={}", safeRedisEndpoint);
```

### 10.3 Jangan Masukkan Secret ke Metric Label

Buruk:

```text
redis_connection_uri="redis://case-api:secret@redis:6379"
```

Metric label sering dikirim ke observability backend dan bertahan lama.

### 10.4 Jangan Print Config Object Mentah

Banyak config object `toString()` menampilkan password. Pastikan redaction.

### 10.5 Secret Rotation Strategy

ACL mendukung beberapa password per user. Ini memungkinkan zero-downtime rotation:

1. Tambahkan password baru ke user yang sama.
2. Deploy aplikasi dengan password baru.
3. Verifikasi semua instance memakai password baru.
4. Hapus password lama.
5. Monitor auth failure.

Contoh konseptual:

```bash
ACL SETUSER case-api >new-secret
# deploy app
ACL SETUSER case-api <old-secret
```

Jangan rotate dengan cara mematikan user lama sebelum semua client pindah.

---

## 11. Data Sensitivity: Cache Bukan Berarti Tidak Sensitif

Kesalahan umum:

> “Data ini cuma cache, jadi tidak perlu perlindungan.”

Cache bisa menyimpan copy data sensitif.

### 11.1 Klasifikasi Data Redis

Sebelum menyimpan value Redis, tentukan klasifikasi:

| Data | Sensitivity | Catatan |
|---|---:|---|
| Rate limit counter | Low/Medium | Bisa memengaruhi availability/fairness |
| Session token | High | Credential-like |
| OTP/password reset | Critical | Harus TTL pendek dan akses ketat |
| User profile cache | Medium/High | Bisa PII |
| Authorization cache | High | Bisa bypass permission jika salah |
| Case workflow state | High | Bisa berdampak pada regulatory decision |
| Search/vector index | Medium/High | Bisa mengandung semantic leakage |
| Idempotency response cache | Medium/High | Bisa menyimpan response payload sensitif |

### 11.2 Jangan Cache Lebih Banyak Dari Yang Dibutuhkan

Buruk:

```json
{
  "userId": "123",
  "name": "Alice",
  "email": "alice@example.com",
  "phone": "+62...",
  "nationalId": "...",
  "address": "...",
  "roles": ["ADMIN"],
  "passwordHash": "..."
}
```

Lebih baik cache projection minimal:

```json
{
  "userId": "123",
  "displayName": "Alice",
  "status": "ACTIVE",
  "roleVersion": 42
}
```

### 11.3 TTL Sebagai Security Control

TTL bukan hanya memory control. TTL adalah security control untuk ephemeral sensitive state.

Contoh:

| Use Case | TTL Guideline |
|---|---:|
| OTP | sangat pendek |
| password reset token | pendek |
| login attempt counter | window-based |
| session | sesuai policy session |
| idempotency response | sesuai retry window |
| cache PII | sesingkat business need |
| lock | bounded lease |

Jangan simpan token sensitif tanpa TTL kecuali sangat disengaja.

### 11.4 Encryption at Application Layer

TLS melindungi data in transit. Persistence encryption/storage encryption melindungi data at rest pada disk. Tetapi Redis process tetap melihat plaintext.

Untuk data sangat sensitif, pertimbangkan encryption di application layer sebelum disimpan ke Redis.

Trade-off:

- tidak bisa query field plaintext;
- debugging lebih sulit;
- key management lebih kompleks;
- value lebih besar;
- rotation lebih sulit;
- tetapi blast radius data dump berkurang.

Jangan gunakan encryption sebagai pengganti ACL dan network security. Encryption adalah tambahan, bukan izin untuk desain sembarangan.

---

## 12. Redis Persistence, Backup, dan Security

Kalau Redis memakai RDB/AOF, data cache bisa masuk disk.

### 12.1 RDB/AOF Bisa Berisi Data Sensitif

RDB/AOF dapat menyimpan:

- session;
- token;
- PII;
- idempotency payload;
- queue message;
- search document;
- workflow state.

Jadi security backup penting.

### 12.2 Backup Control

Checklist:

- backup encrypted at rest;
- backup access dibatasi;
- backup retention sesuai data classification;
- backup tidak masuk bucket public;
- restore test memakai environment aman;
- backup sanitization untuk non-production;
- jangan copy production Redis dump ke laptop pribadi.

### 12.3 Non-Production Data

Jangan restore production Redis dump ke dev/staging tanpa masking jika berisi sensitive data.

Banyak breach terjadi karena data production “sementara” dipakai debugging.

---

## 13. Multi-Tenant dan Bounded Context Isolation

Redis sering dipakai bersama oleh banyak service karena “murah dan cepat”. Ini menciptakan risiko besar.

### 13.1 Shared Redis Anti-Pattern

```text
Redis Cluster Shared
  ├── auth-service
  ├── billing-service
  ├── notification-service
  ├── risk-service
  ├── admin-dashboard
  └── worker-tools
```

Jika semua memakai:

```text
user default +@all ~*
```

maka kompromi satu service membuka semua key.

### 13.2 Isolation Options

Dari paling kuat ke lebih lemah:

1. separate Redis deployment per critical bounded context;
2. separate database/cluster per sensitivity tier;
3. ACL user per service + prefix restriction;
4. logical DB index separation;
5. naming convention saja.

Catatan: logical database index Redis (`SELECT 0`, `SELECT 1`) bukan boundary security kuat, dan Redis Cluster tidak mendukung multi-database seperti standalone. Jangan jadikan DB index sebagai security isolation utama.

### 13.3 Sensitivity Tier

Pisahkan minimal berdasarkan sensitivitas:

| Tier | Contoh | Isolation |
|---|---|---|
| Critical | auth/session/token | dedicated atau strict ACL |
| High | case workflow/regulatory state | dedicated/strict ACL |
| Medium | user profile cache | strict ACL/prefix |
| Low | public metadata cache | shared possible |
| Operational | metrics/ratelimit | tergantung impact |

---

## 14. Java/Spring Configuration Security

### 14.1 Spring Boot Redis Config

Contoh `application.yml` dengan environment variable:

```yaml
spring:
  data:
    redis:
      host: ${REDIS_HOST}
      port: ${REDIS_PORT:6379}
      username: ${REDIS_USERNAME}
      password: ${REDIS_PASSWORD}
      ssl:
        enabled: true
      timeout: 500ms
      connect-timeout: 500ms
```

Untuk Spring Boot version tertentu, property naming bisa berbeda. Selalu cek versi framework yang dipakai.

### 14.2 Lettuce TLS dan Timeout

```java
@Bean
public LettuceConnectionFactory redisConnectionFactory(RedisProperties props) {
    RedisStandaloneConfiguration redisConfig = new RedisStandaloneConfiguration();
    redisConfig.setHostName(props.getHost());
    redisConfig.setPort(props.getPort());
    redisConfig.setUsername(props.getUsername());
    redisConfig.setPassword(RedisPassword.of(props.getPassword()));

    LettuceClientConfiguration clientConfig = LettuceClientConfiguration.builder()
            .useSsl()
            .commandTimeout(Duration.ofMillis(500))
            .build();

    return new LettuceConnectionFactory(redisConfig, clientConfig);
}
```

### 14.3 Prevent Native Java Serialization

Security bagian ini juga menyentuh serialization.

Jangan gunakan JDK serialization untuk value Redis jika tidak benar-benar perlu. Risiko:

- gadget deserialization;
- coupling classpath;
- payload opaque;
- sulit audit;
- compatibility buruk;
- accidental sensitive field serialization.

Lebih baik gunakan JSON serializer dengan DTO explicit atau binary format yang dikontrol.

Contoh Spring Redis serializer:

```java
@Bean
public RedisTemplate<String, CaseCacheEntry> redisTemplate(
        RedisConnectionFactory connectionFactory,
        ObjectMapper objectMapper
) {
    RedisTemplate<String, CaseCacheEntry> template = new RedisTemplate<>();
    template.setConnectionFactory(connectionFactory);

    template.setKeySerializer(new StringRedisSerializer());
    template.setHashKeySerializer(new StringRedisSerializer());

    Jackson2JsonRedisSerializer<CaseCacheEntry> valueSerializer =
            new Jackson2JsonRedisSerializer<>(objectMapper, CaseCacheEntry.class);

    template.setValueSerializer(valueSerializer);
    template.setHashValueSerializer(valueSerializer);
    template.afterPropertiesSet();
    return template;
}
```

Catatan: serializer JSON polymorphic typing juga bisa berisiko jika dikonfigurasi sembarangan. Hindari default typing yang menerima arbitrary class dari payload tidak trusted.

---

## 15. Authorization Cache: Security-Critical Use Case

Redis sering dipakai untuk cache authorization. Ini high risk.

### 15.1 Problem

Service ingin menghindari query database/identity provider setiap request.

Maka dibuat cache:

```text
authz:v1:user:{userId}:permissions -> ["CASE_READ", "CASE_APPROVE"]
```

Risiko:

- permission stale setelah role dicabut;
- cache poisoning;
- key overwrite;
- TTL terlalu panjang;
- user service lain bisa menulis permission;
- invalidation gagal;
- data beda tenant tercampur.

### 15.2 Safer Design

Gunakan prinsip:

1. key mencakup tenant/security domain;
2. value mencakup version/issuedAt;
3. TTL pendek;
4. invalidation event jika role berubah;
5. Redis ACL hanya auth service yang boleh write;
6. consumer service read-only;
7. fallback ke source of truth untuk high-risk action.

Contoh key:

```text
authz-api:v1:tenant:{tenantId}:user:{userId}:permission-snapshot
```

Value:

```json
{
  "tenantId": "t-123",
  "userId": "u-456",
  "permissionVersion": 881,
  "permissions": ["CASE_READ", "CASE_APPROVE"],
  "issuedAt": "2026-06-20T10:15:00Z",
  "expiresAt": "2026-06-20T10:20:00Z"
}
```

Design rule:

> High-impact authorization decision should not rely on stale cache without versioning, TTL, and invalidation strategy.

---

## 16. Rate Limiter Security

Rate limiter Redis bisa diserang.

### 16.1 Threats

- attacker membuat cardinality key sangat besar;
- user ID/IP palsu menciptakan banyak key;
- no TTL menyebabkan memory leak;
- ACL terlalu luas memungkinkan reset counter;
- hot key menyebabkan latency;
- cluster hash tag salah menyebabkan cross-slot failure;
- script mahal memblokir Redis.

### 16.2 Controls

- TTL wajib pada counter;
- cap identifier length;
- normalize subject;
- hash sensitive identifier;
- prefix ownership;
- command restriction;
- memory budget;
- metric cardinality control;
- deny `DEL` jika limiter runtime tidak perlu delete;
- script bounded complexity.

Contoh subject normalization:

```java
String normalizedIp = normalizeIp(requestIp);
String subjectHash = hmacSha256(rateLimitSecret, normalizedIp);
String key = "risk-api:v1:rl:ip:" + subjectHash;
```

Jangan simpan raw sensitive identifier jika tidak perlu.

---

## 17. Lock Security

Distributed lock key juga security-sensitive.

Jika attacker atau service lain bisa menulis lock key, mereka bisa:

- mengambil lock palsu;
- menghapus lock;
- memperpanjang lock;
- menyebabkan denial of service;
- membuat workflow stuck.

Controls:

- lock prefix dedicated;
- lock ACL hanya service owner;
- random token value;
- safe unlock via compare-delete;
- TTL wajib;
- fencing token untuk side effect eksternal;
- no manual deletion without runbook.

Contoh ACL:

```conf
user settlement-worker on >secret \
  ~settlement-worker:v1:lock:* \
  +SET +GET +PTTL +EVALSHA \
  -DEL -FLUSHALL -FLUSHDB -CONFIG -KEYS
```

Kenapa `-DEL`? Karena release lock harus lewat Lua compare-delete, bukan `DEL` langsung. Tetapi perlu diuji apakah implementasi Anda membutuhkan command tertentu.

---

## 18. Pub/Sub dan Streams Security

### 18.1 Pub/Sub

Risiko Pub/Sub:

- publish event palsu;
- subscribe channel sensitif;
- channel naming bocor tenant/user ID;
- fanout message berisi PII;
- no durability membuat audit tidak bisa mengandalkan Pub/Sub.

Controls:

- channel pattern ACL;
- jangan publish sensitive payload lengkap;
- gunakan event reference ID bila perlu;
- channel prefix per owner;
- logging/audit untuk publisher high-impact.

Contoh channel:

```text
case-api:v1:cache-invalidation
```

Bukan:

```text
user:alice@example.com:password-reset
```

### 18.2 Streams

Redis Streams bisa menyimpan message lebih lama. Perlakukan seperti data store.

Risiko:

- payload sensitif tertahan di stream;
- consumer group unauthorized membaca event;
- PEL berisi pending message lama;
- trimming tidak dikonfigurasi;
- replay oleh actor tidak sah;
- stream menjadi shadow audit log tanpa retention control.

Controls:

- stream ACL per prefix;
- TTL/retention/trimming policy;
- avoid sensitive payload if not needed;
- encrypt sensitive fields;
- consumer identity per group;
- monitor pending entries;
- backup classification.

---

## 19. Search, JSON, Vector Security

Redis modern bisa menyimpan JSON document, index search, dan vector.

Security concern meningkat karena Redis tidak lagi hanya key-value token/counter.

### 19.1 JSON/Search Risk

- field sensitif terindex;
- query bisa menemukan data yang tidak boleh terlihat;
- document projection terlalu luas;
- index name shared antar service;
- stale deleted document;
- backup/search index berisi PII.

### 19.2 Vector Risk

Vector embedding bisa membawa semantic leakage. Walaupun bukan teks asli, embedding bisa merepresentasikan informasi sensitif.

Controls:

- jangan embedding data sensitif tanpa policy;
- pisahkan index per tenant/security domain jika perlu;
- enforce authorization di application layer;
- Redis ACL tidak otomatis memahami row/document-level authorization;
- retention policy jelas;
- deletion propagation jelas.

Redis ACL key pattern membatasi key/command. Ia bukan pengganti domain authorization query-level.

---

## 20. Observability Security

Observability bisa membocorkan Redis data.

### 20.1 Slowlog

Redis slowlog bisa memuat command argument. Jika argument berisi value sensitif, slowlog bisa menjadi data leak.

Controls:

- jangan kirim payload sensitif sebagai command argument yang mudah masuk log;
- batasi akses ke slowlog;
- review log retention;
- gunakan redaction di application logs.

### 20.2 `MONITOR`

`MONITOR` menampilkan command secara real-time. Ini sangat sensitif.

Hanya admin trusted yang boleh.

### 20.3 Application Logs

Jangan log:

- Redis password;
- full Redis URI;
- raw session token;
- OTP;
- lock random token;
- PII payload;
- full idempotency response;
- raw vector input.

Log yang aman:

```java
log.info("Redis cache miss keyType={} tenant={} cacheVersion={}",
        "case-summary", tenantId, "v1");
```

Bukan:

```java
log.info("Redis cache miss key={} value={}", key, value);
```

---

## 21. Incident Response: Jika Redis Credential Bocor

Credential leak harus punya runbook.

### 21.1 Immediate Actions

1. Identifikasi user Redis yang bocor.
2. Tambahkan credential baru atau disable user jika perlu.
3. Deploy aplikasi dengan credential baru.
4. Hapus credential lama.
5. Review ACL user permission.
6. Cari suspicious command patterns.
7. Review key modification/deletion anomalies.
8. Review network access logs/security group logs.
9. Rotasi secrets downstream jika data sensitif mungkin terbaca.
10. Evaluasi apakah backup/dump juga terekspos.

### 21.2 Forensic Questions

- Credential user apa yang bocor?
- Permission-nya apa saja?
- Key pattern apa yang dapat diakses?
- Apakah user bisa `SCAN`, `KEYS`, `DUMP`, `EVAL`, `CONFIG`, `FLUSHALL`?
- Apakah Redis punya audit log/network log?
- Apakah data sensitif di Redis terenkripsi?
- Apakah data di Redis source of truth atau derivatif?
- Apakah ada evidence of deletion?
- Apakah app behavior berubah?

### 21.3 Blast Radius Reduction

Jika ACL baik, jawaban bisa spesifik:

```text
Credential case-api bocor.
User hanya bisa GET/SET/DEL/EXPIRE pada key case-api:*.
Tidak bisa CONFIG, FLUSHALL, KEYS, EVAL, FUNCTION, DUMP.
Tidak bisa akses auth/session keys.
```

Jika ACL buruk:

```text
Credential default bocor.
User punya +@all ~*.
Asumsikan seluruh Redis keyspace compromised dan destructive action mungkin terjadi.
```

---

## 22. Production ACL Design Examples

### 22.1 Session API

Use case:

- create session;
- read session;
- refresh TTL;
- delete session on logout.

Key:

```text
auth-api:v1:session:{sessionId}
```

ACL:

```conf
user auth-api-session on >secret \
  ~auth-api:v1:session:* \
  +GET +SET +DEL +EXPIRE +PEXPIRE +TTL +PTTL +UNLINK +MGET \
  -@dangerous
```

Security notes:

- session ID harus high entropy;
- value jangan berisi password hash;
- TTL wajib;
- consider app-layer encryption untuk high sensitivity;
- jangan expose session key di log.

### 22.2 Cache Reader Dashboard

Use case:

- dashboard membaca metrics cache;
- tidak boleh mengubah data.

ACL:

```conf
user dashboard-readonly on >secret \
  ~metrics-api:v1:* \
  +GET +MGET +HGET +HMGET +HGETALL +TTL +PTTL +SCARD +ZCARD \
  -@write -@dangerous
```

### 22.3 Rate Limiter Runtime

Use case:

- increment counter;
- set expiry;
- run Lua token bucket.

ACL:

```conf
user risk-rate-limiter on >secret \
  ~risk-api:v1:rl:* \
  +GET +SET +INCR +INCRBY +DECR +EXPIRE +PEXPIRE +TTL +PTTL +EVALSHA \
  -EVAL -SCRIPT -FUNCTION -KEYS -CONFIG -FLUSHALL -FLUSHDB
```

### 22.4 Stream Consumer

Use case:

- read stream group;
- ack;
- claim abandoned messages.

ACL:

```conf
user case-stream-worker on >secret \
  ~case-api:v1:stream:* \
  +XREADGROUP +XACK +XPENDING +XCLAIM +XAUTOCLAIM +XINFO +XGROUP \
  -@dangerous
```

Depending on lifecycle, `XGROUP` may be deployment-only rather than runtime.

### 22.5 Deployment User

Use case:

- load functions/scripts;
- create index;
- migration.

ACL:

```conf
user redis-deployer on >secret \
  ~case-api:* ~risk-api:* \
  +FUNCTION +SCRIPT +EVAL +EVALSHA +FT.CREATE +FT.ALTER +FT.DROPINDEX +FT.INFO \
  -FLUSHALL -FLUSHDB -CONFIG -SHUTDOWN
```

Deployment user should not be used by runtime app pods.

---

## 23. Testing Security Configuration

Security config harus dites seperti business logic.

### 23.1 ACL Integration Test

Buat test yang membuktikan user tidak bisa mengakses key di luar prefix.

Pseudo-test:

```java
@Test
void caseApiCannotAccessAuthSessionKeys() {
    RedisCommands<String, String> caseApi = connectAs("case-api", secret);

    assertThrows(RedisCommandExecutionException.class, () -> {
        caseApi.get("auth-api:v1:session:abc");
    });
}
```

### 23.2 Dangerous Command Test

```java
@Test
void appUserCannotRunFlushAll() {
    RedisCommands<String, String> app = connectAs("case-api", secret);

    assertThrows(RedisCommandExecutionException.class, app::flushall);
}
```

### 23.3 Required Command Test

Jangan hanya test negative case. Test command yang memang perlu.

```java
@Test
void caseApiCanReadAndWriteOwnCacheKey() {
    RedisCommands<String, String> app = connectAs("case-api", secret);

    app.setex("case-api:v1:case:123:summary", 60, "{}" );
    String value = app.get("case-api:v1:case:123:summary");

    assertNotNull(value);
}
```

### 23.4 CI/CD Guardrail

Tambahkan test untuk config ACL generated:

- tidak ada runtime user dengan `+@all`;
- tidak ada runtime user dengan `~*` kecuali explicitly approved;
- default user off;
- dangerous commands denied;
- password tidak empty;
- TLS required untuk non-local env;
- key prefix documented.

---

## 24. Security Review Checklist

Gunakan checklist ini saat design review.

### 24.1 Network

- Redis tidak public internet.
- Redis hanya bisa diakses subnet/service yang perlu.
- Security group/firewall ketat.
- Kubernetes NetworkPolicy tersedia.
- Admin path dibatasi.
- No public LoadBalancer/NodePort.

### 24.2 Authentication

- Default user disabled atau dibatasi.
- Runtime app memakai ACL user named.
- Tidak memakai shared password global.
- Password strong dan disimpan di secret manager.
- Rotasi credential punya runbook.

### 24.3 Authorization

- ACL key pattern per service.
- Runtime user tidak memakai `+@all`.
- Runtime user tidak memakai `~*` kecuali ada exception tertulis.
- Dangerous/admin commands denied.
- Deployment user dipisah dari runtime user.
- Read-only user benar-benar read-only.

### 24.4 TLS

- TLS enabled untuk production/lintas host.
- Certificate validation tidak dimatikan.
- Certificate rotation dimonitor.
- Non-TLS port disabled jika memungkinkan.

### 24.5 Data

- Data sensitif diklasifikasikan.
- PII minimal.
- Token/OTP/session TTL wajib.
- Sensitive value tidak masuk log.
- Persistence/backup encryption jelas.
- Non-production dump tidak memakai raw production data.

### 24.6 Java Client

- Secret tidak hardcoded.
- Redis URI tidak dilog.
- Serializer aman dan explicit.
- Timeout ditentukan.
- Retry tidak membocorkan data/log.
- Connection config support TLS/ACL.

### 24.7 Operations

- ACL tested.
- Security metrics monitored.
- Auth failure alert.
- Slowlog access restricted.
- `MONITOR` restricted.
- Incident runbook tersedia.
- Backup restore procedure aman.

---

## 25. Common Anti-Patterns

### Anti-Pattern 1 — One Redis Password for Everything

```text
All services use redis://default:password@redis:6379
```

Dampak:

- no service identity;
- no blast radius control;
- rotation hard;
- compromised service compromises all Redis data.

### Anti-Pattern 2 — Redis Exposed Internally Without ACL

“Internal network is trusted” adalah asumsi lemah. Internal compromise adalah skenario nyata.

### Anti-Pattern 3 — `+@all ~*` Runtime User

Ini root-like access.

### Anti-Pattern 4 — No TTL for Sensitive State

Password reset token/session/idempotency payload tanpa TTL adalah bug security dan data retention bug.

### Anti-Pattern 5 — Cache PII Full Object

Cache “biar cepat” sering menyimpan field yang tidak pernah dipakai.

### Anti-Pattern 6 — Logging Full Key/Value

Key bisa mengandung email, phone, tenant, case ID. Value bisa mengandung data sensitif.

### Anti-Pattern 7 — Deployment Credential Reused by Runtime

Runtime app tidak perlu `FUNCTION LOAD`, `FT.CREATE`, `CONFIG`, atau `ACL SETUSER`.

### Anti-Pattern 8 — No ACL Test

ACL manual yang tidak dites akan rusak ketika framework/client membutuhkan command tambahan.

### Anti-Pattern 9 — Backup Redis Dipakai Sembarangan

RDB/AOF production dibawa ke staging/laptop untuk debug.

### Anti-Pattern 10 — Redis as Security Source Without Invalidation

Authorization cache dengan TTL panjang tanpa versioning/invalidation bisa menciptakan privilege retention.

---

## 26. Architecture Decision Record Template

Untuk Redis security, buat ADR kecil seperti ini.

```markdown
# ADR: Redis Security Model for <Service>

## Context
<Service> uses Redis for <cache/session/rate limit/idempotency/etc>.

## Data Classification
- Key prefix:
- Value type:
- Contains PII/token/authz state? yes/no
- TTL:
- Persistence impact:

## Network Boundary
- Redis endpoint:
- Allowed clients:
- Network policy/security group:
- Public access: no

## Authentication
- Redis ACL user:
- Secret source:
- Rotation method:

## Authorization
- Allowed key patterns:
- Allowed commands:
- Denied commands:
- Runtime vs deployment user separation:

## TLS
- Enabled:
- Certificate validation:
- Rotation owner:

## Logging/Observability
- Redaction rules:
- Slowlog access:
- Auth failure alert:

## Failure/Incident Response
- Credential leak runbook:
- Redis compromise assumption:
- Data invalidation/rebuild strategy:

## Alternatives Considered
- Shared default user:
- Dedicated Redis deployment:
- App-layer encryption:

## Decision
<Chosen design>

## Consequences
<Trade-offs>
```

---

## 27. Lab: Secure Redis Locally with ACL

### 27.1 Docker Compose

```yaml
services:
  redis:
    image: redis:8
    command: ["redis-server", "/usr/local/etc/redis/redis.conf"]
    ports:
      - "6379:6379"
    volumes:
      - ./redis.conf:/usr/local/etc/redis/redis.conf:ro
```

### 27.2 `redis.conf`

```conf
bind 0.0.0.0
protected-mode yes
port 6379

user default off
user case-api on >case-secret ~case-api:* +GET +SET +DEL +EXPIRE +TTL +PING -@dangerous
user readonly on >readonly-secret ~case-api:* +GET +TTL +PING -@write -@dangerous
```

### 27.3 Test With Redis CLI

```bash
redis-cli --user case-api --pass case-secret PING
redis-cli --user case-api --pass case-secret SET case-api:v1:test hello EX 60
redis-cli --user case-api --pass case-secret GET case-api:v1:test
```

Expected:

```text
PONG
OK
hello
```

Try forbidden key:

```bash
redis-cli --user case-api --pass case-secret SET other-service:v1:test nope EX 60
```

Expected: permission error.

Try forbidden command:

```bash
redis-cli --user case-api --pass case-secret FLUSHALL
```

Expected: permission error.

Try readonly write:

```bash
redis-cli --user readonly --pass readonly-secret SET case-api:v1:test nope
```

Expected: permission error.

---

## 28. Lab: Java ACL Verification with Lettuce

### 28.1 Maven Dependencies

```xml
<dependency>
    <groupId>io.lettuce</groupId>
    <artifactId>lettuce-core</artifactId>
    <version>${lettuce.version}</version>
</dependency>
<dependency>
    <groupId>org.junit.jupiter</groupId>
    <artifactId>junit-jupiter</artifactId>
    <version>${junit.version}</version>
    <scope>test</scope>
</dependency>
```

### 28.2 Test Helper

```java
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;

import java.time.Duration;

final class RedisAclTestClient {

    static RedisCommands<String, String> connect(String username, String password) {
        RedisURI uri = RedisURI.builder()
                .withHost("localhost")
                .withPort(6379)
                .withAuthentication(username, password.toCharArray())
                .withTimeout(Duration.ofMillis(500))
                .build();

        RedisClient client = RedisClient.create(uri);
        StatefulRedisConnection<String, String> connection = client.connect();
        return connection.sync();
    }
}
```

### 28.3 Tests

```java
import io.lettuce.core.RedisCommandExecutionException;
import io.lettuce.core.api.sync.RedisCommands;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class RedisAclSecurityTest {

    @Test
    void caseApiCanAccessOwnPrefix() {
        RedisCommands<String, String> redis = RedisAclTestClient.connect("case-api", "case-secret");

        redis.setex("case-api:v1:test", 60, "hello");

        assertEquals("hello", redis.get("case-api:v1:test"));
    }

    @Test
    void caseApiCannotAccessOtherPrefix() {
        RedisCommands<String, String> redis = RedisAclTestClient.connect("case-api", "case-secret");

        assertThrows(RedisCommandExecutionException.class, () ->
                redis.setex("other-service:v1:test", 60, "nope")
        );
    }

    @Test
    void caseApiCannotFlushDatabase() {
        RedisCommands<String, String> redis = RedisAclTestClient.connect("case-api", "case-secret");

        assertThrows(RedisCommandExecutionException.class, redis::flushall);
    }

    @Test
    void readonlyCannotWrite() {
        RedisCommands<String, String> redis = RedisAclTestClient.connect("readonly", "readonly-secret");

        assertThrows(RedisCommandExecutionException.class, () ->
                redis.set("case-api:v1:test", "nope")
        );
    }
}
```

Security configuration yang tidak dites hampir pasti akan drift.

---

## 29. Practical Design: Redis Security for Regulatory Case Platform

Misal sistem Anda punya bounded contexts:

- `case-api`;
- `workflow-engine`;
- `enforcement-api`;
- `risk-api`;
- `notification-worker`;
- `admin-dashboard`.

Redis digunakan untuk:

- case summary cache;
- workflow transient state;
- idempotency keys;
- rate limiter;
- distributed lock;
- notification stream;
- dashboard metrics.

### 29.1 Prefix Plan

```text
case-api:v1:cache:case:{caseId}:summary
workflow-engine:v1:state:case:{caseId}
workflow-engine:v1:lock:case:{caseId}
enforcement-api:v1:idempotency:{requestId}
risk-api:v1:rl:tenant:{tenantId}:subject:{subjectHash}
notification-worker:v1:stream:outbound
metrics-api:v1:dashboard:{metricName}
```

### 29.2 ACL Plan

| Redis User | Key Pattern | Commands | Notes |
|---|---|---|---|
| `case-api` | `case-api:*` | read/write cache commands | no scripting/admin |
| `workflow-engine` | `workflow-engine:*` | get/set/del/expire/evalsha | lock release via Lua |
| `enforcement-api` | `enforcement-api:*` | set/get/evalsha | idempotency state machine |
| `risk-api` | `risk-api:*` | incr/set/evalsha/ttl | rate limiter |
| `notification-worker` | `notification-worker:*` | stream commands | no pub/sub admin |
| `dashboard-readonly` | `metrics-api:*` | read only | no write |
| `redis-deployer` | approved prefixes | function/script/index deploy | not runtime |

### 29.3 Security Boundary

- auth/session Redis should be separate if session data is critical;
- workflow state may need dedicated Redis or stronger ACL;
- dashboard read-only must not share runtime write credential;
- backup classification must include workflow state;
- incident runbook must define whether Redis state can be rebuilt from source of truth.

---

## 30. Key Takeaways

1. Redis security is not optional even if Redis is “just cache”.
2. Network isolation is the first boundary; ACL is not a substitute for firewall/private networking.
3. Use ACL users, not one shared default password.
4. Disable or restrict default user.
5. Runtime service credentials should be least privilege.
6. Key naming discipline enables ACL key pattern restriction.
7. Dangerous commands should be denied for application users.
8. TLS should be used for production/lintas-host connections where network is not fully trusted or compliance requires it.
9. Redis values may contain PII/token/session/authorization state; classify them.
10. TTL is a security control for ephemeral sensitive data.
11. RDB/AOF/backups can contain sensitive data.
12. Java services must avoid logging Redis secrets, keys, and values carelessly.
13. Serializer choice is part of security.
14. Test ACL configuration with integration tests.
15. Security design should reduce blast radius when—not if—a credential leaks.

---

## 31. Readiness Checklist for Part 027

Anda siap lanjut jika bisa menjawab:

1. Kenapa Redis tidak boleh dianggap aman hanya karena berada di internal network?
2. Apa perbedaan `requirepass` dan ACL users?
3. Kenapa `+@all ~*` berbahaya untuk runtime service?
4. Bagaimana key naming memengaruhi Redis authorization?
5. Command apa saja yang biasanya harus dilarang untuk app user?
6. Kapan TLS perlu dipakai?
7. Kenapa TTL juga security control?
8. Kenapa RDB/AOF Redis bisa menjadi data leakage vector?
9. Bagaimana melakukan credential rotation dengan ACL multi-password?
10. Bagaimana menulis integration test untuk membuktikan ACL benar?
11. Kenapa authorization cache adalah use case security-critical?
12. Bagaimana membatasi blast radius jika credential Redis service bocor?

---

## 32. Referensi

- Redis documentation — Security: https://redis.io/docs/latest/operate/oss_and_stack/management/security/
- Redis documentation — ACL: https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/
- Redis documentation — TLS: https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/
- Redis documentation — ACL command: https://redis.io/docs/latest/commands/acl-setuser/
- Redis documentation — Command categories: https://redis.io/docs/latest/commands/
- Redis documentation — Redis clients for Java: https://redis.io/docs/latest/develop/clients/lettuce/
- Spring Data Redis Reference: https://docs.spring.io/spring-data/redis/reference/

---

## 33. Status Seri

```text
Part 027 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-028.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Transactions, WATCH, MULTI/EXEC, dan Optimistic Concurrency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-028.md">Part 028 — Observability: Metrics, Logs, Traces, Slowlog, Commandstats ➡️</a>
</div>
