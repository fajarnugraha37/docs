# learn-java-authentication-modes-and-patterns-part-031

# Part 31 — Performance and Scalability of Authentication

## Status

**Series:** Java Authentication Modes and Patterns  
**Part:** 31 of 35  
**Level:** Advanced / Production Engineering  
**Scope:** Java 8–25, Servlet/Jakarta, Spring Security, OAuth2/OIDC, SAML, mTLS, API key, session, LDAP/Kerberos, messaging, distributed systems  
**Goal:** Memahami authentication sebagai hot path yang harus aman, cepat, stabil, scalable, dan tahan terhadap traffic spike maupun serangan.

---

## 1. Problem yang Diselesaikan

Authentication sering dipikirkan sebagai proses yang terjadi hanya saat login.

Di sistem production, itu keliru.

Authentication bisa terjadi pada banyak titik:

1. Browser mengirim cookie session ke setiap request.
2. Resource server memvalidasi JWT di setiap API call.
3. Resource server melakukan introspection untuk opaque token.
4. Gateway memvalidasi API key di setiap request partner.
5. Service internal mengambil token client credentials.
6. Worker Kafka melakukan SASL/OAUTHBEARER atau mTLS handshake.
7. Backend melakukan bind LDAP saat login user enterprise.
8. Sistem melakukan refresh token rotation.
9. IdP menerbitkan token saat login storm.
10. Service mengambil JWKS saat key rotation.
11. Browser melakukan TLS handshake, kadang dengan client certificate.
12. Password hasher melakukan operasi mahal saat login, reset password, atau migration.

Artinya authentication bukan hanya fitur security. Authentication adalah bagian dari **request critical path** dan **platform capacity model**.

Jika authentication lambat, seluruh aplikasi terasa lambat. Jika authentication dependency down, aplikasi bisa ikut down. Jika authentication cache salah, user yang sudah logout masih bisa akses. Jika password hashing terlalu mahal tanpa throttling, sistem bisa menjadi korban CPU exhaustion. Jika introspection endpoint dipanggil per request tanpa caching, authorization server menjadi single bottleneck.

Part ini menyelesaikan pertanyaan:

> Bagaimana mendesain authentication yang tetap aman tetapi tidak menghancurkan latency, throughput, availability, dan operability sistem Java production?

Kita akan membahas authentication sebagai gabungan:

- security control,
- distributed systems dependency,
- CPU-bound workload,
- network-bound workload,
- cache invalidation problem,
- state management problem,
- failure isolation problem,
- abuse-resistance problem.

---

## 2. Mental Model: Authentication as a Hot Path

Authentication memiliki dua bentuk besar dari sudut performance.

### 2.1 Front-door authentication

Ini authentication yang terjadi saat boundary awal:

```text
user login
partner request
service obtains token
worker connects to broker
client certificate handshake
```

Contoh:

```text
POST /login
  -> load user
  -> verify password hash
  -> evaluate risk
  -> maybe MFA
  -> create session
  -> write audit event
```

Front-door authentication biasanya lebih mahal, tetapi frekuensinya lebih rendah dibanding per-request authentication.

### 2.2 Per-request authentication

Ini authentication atau token/session validation yang terjadi pada setiap request:

```text
GET /api/cases/123
  -> read Authorization header / cookie
  -> parse token / session id
  -> validate signature or session state
  -> load principal / authorities
  -> continue request
```

Per-request authentication harus sangat efisien karena terjadi terus-menerus.

### 2.3 Authentication cost stack

Setiap mode authentication memiliki cost stack sendiri:

```text
Network cost
  DNS, TLS, LDAP, introspection, database, Redis, IdP, JWKS endpoint

CPU cost
  password hashing, JWT signature verification, TLS handshake, JSON/XML parsing

Memory cost
  session object, authority list, cache entries, JWK set, introspection result

Storage cost
  session store, audit logs, failed attempt counters, token revocation list

Coordination cost
  distributed invalidation, key rotation, refresh token reuse detection

Operational cost
  monitoring, alerting, incident response, emergency revocation
```

Top engineer tidak hanya bertanya:

> Apakah authentication aman?

Tetapi juga:

> Aman pada traffic berapa? Dengan dependency failure apa? Dengan attacker menekan path paling mahal? Dengan key rotation? Dengan IdP latency? Dengan cache stale? Dengan login storm? Dengan logout requirement? Dengan audit requirement?

---

## 3. Performance Vocabulary untuk Authentication

Sebelum membahas pattern, kita perlu vocabulary yang presisi.

### 3.1 Latency

Latency adalah waktu untuk satu operasi authentication.

Contoh:

```text
password verification: 80 ms
Redis session lookup: 2 ms
JWT validation: 0.5 ms
opaque token introspection: 40 ms
LDAP bind: 100 ms
TLS handshake: 20 ms
```

Yang penting bukan hanya average, tetapi percentiles:

```text
p50  = normal user experience
p95  = common tail
p99  = production pain
p999 = incident / saturation signal
```

Authentication dependency yang p50-nya bagus tetapi p99-nya buruk bisa membuat request API tidak stabil.

### 3.2 Throughput

Throughput adalah jumlah operasi per detik.

Contoh:

```text
login attempts/sec
JWT validations/sec
session lookups/sec
introspection calls/sec
password hash verifications/sec
LDAP binds/sec
TLS handshakes/sec
```

Authentication throughput sering dibatasi oleh resource tertentu:

```text
password auth       -> CPU-bound
opaque introspection -> network + authorization server capacity
session lookup       -> Redis/database capacity
LDAP bind            -> directory server capacity
mTLS handshake       -> CPU + TLS termination capacity
JWT validation       -> CPU + key cache correctness
```

### 3.3 Saturation

Saturation terjadi ketika resource mendekati batasnya:

```text
CPU 95%
thread pool full
connection pool exhausted
Redis max connections
LDAP server slow
IdP token endpoint rate limited
JWK cache miss storm
session store latency spike
```

Authentication saturation berbahaya karena sering terjadi di pintu masuk sistem. Jika pintu masuk tersaturasi, semua downstream ikut terlihat gagal.

### 3.4 Amplification

Amplification terjadi ketika satu request user menghasilkan banyak operasi authentication internal.

Contoh buruk:

```text
1 API request
  -> validate JWT
  -> call IdP introspection
  -> fetch userinfo
  -> query DB user
  -> query LDAP group
  -> call policy engine
```

Jika 1 request menghasilkan 5 dependency calls, 1.000 RPS menjadi 5.000 dependency RPS.

### 3.5 Staleness

Staleness adalah jarak antara kebenaran sumber dan data yang dipakai runtime.

Contoh:

```text
user revoked at 10:00:00
JWT exp at 10:15:00
resource server still accepts until 10:15:00
staleness window = 15 minutes
```

Performance sering diperoleh dengan caching. Caching hampir selalu menciptakan staleness. Authentication design adalah seni menentukan staleness window yang bisa diterima.

---

## 4. Authentication Mode Cost Model

Mari bandingkan mode authentication berdasarkan cost dan scaling behavior.

| Mode | Primary Cost | Scaling Strength | Scaling Weakness | Typical Risk |
|---|---:|---|---|---|
| Password login | CPU hashing + DB lookup | Simple, local verification | CPU exhaustion, credential stuffing | Account takeover |
| Session cookie | session store lookup | Central revocation, compact cookie | Redis/db dependency | session fixation/stale session |
| JWT bearer | CPU signature + claim validation | Local validation, low latency | revocation hard, key rotation cache | stale privilege/token replay |
| Opaque token | network introspection | central revocation | AS bottleneck | fail-open/fail-closed trade-off |
| API key | hash lookup + rate limit | simple for partners | secret leakage, hot key | broad blast radius |
| HMAC signing | canonicalization + HMAC | replay-resistant if correct | debugging/canonical bugs | signature bypass/replay |
| mTLS | TLS handshake + cert validation | strong possession proof | cert lifecycle/handshake cost | wrong cert-principal mapping |
| LDAP bind | network + directory auth | central enterprise identity | directory outage/latency | login dependency blast radius |
| SAML | XML parse/signature | enterprise federation | XML/security complexity | signature wrapping/replay |
| WebAuthn | signature + challenge state | phishing-resistant | registration/recovery complexity | recovery bypass |

Tidak ada mode yang selalu paling cepat dan paling aman. Keputusan selalu trade-off.

---

## 5. Latency Budget untuk Authentication

Top-level rule:

> Authentication tidak boleh tidak terlihat di capacity plan.

Setiap aplikasi production perlu latency budget.

Contoh target untuk API umum:

```text
Total API p95 target: 300 ms

Budget:
- network edge:         20 ms
- authentication:       10 ms
- authorization:        15 ms
- business logic:      180 ms
- database:             60 ms
- serialization:        15 ms
```

Jika authentication memakai introspection remote 50 ms pada p95, maka authentication sendiri sudah memakan 16% total budget.

### 5.1 Budget per mode

Estimasi konseptual, bukan angka universal:

```text
JWT local validation:
  usually sub-ms to few ms if key cached and claims simple

Redis session lookup:
  usually low-ms if local region and healthy

Opaque token introspection:
  network-bound; often tens of ms

LDAP bind:
  network-bound; often tens to hundreds of ms

Password hashing:
  intentionally expensive; tens to hundreds of ms

mTLS handshake:
  expensive mostly on connection establishment, reduced by keep-alive/resumption
```

### 5.2 Prinsip budget

1. **Per-request path harus local-first jika possible.**
2. **Network authentication calls harus explicitly budgeted.**
3. **Expensive verification harus berada di low-frequency path.**
4. **Cache harus punya correctness model, bukan hanya TTL.**
5. **Login path harus throttled supaya tidak menjadi CPU DoS vector.**

---

## 6. Password Hashing Performance

Password hashing adalah contoh paling jelas dari trade-off security vs performance.

Hash password harus mahal agar attacker sulit melakukan offline cracking. Tetapi mahal berarti login juga mahal.

### 6.1 Work factor sebagai security knob

Password hash modern memakai work factor.

Contoh:

```text
BCrypt cost 10
BCrypt cost 12
PBKDF2 iterations 310000
Argon2 memory/time/parallelism parameters
```

Work factor menaikkan biaya attacker, tetapi juga menaikkan biaya server.

Mental model:

```text
higher work factor
  -> stronger offline cracking resistance
  -> higher CPU/memory per login
  -> lower max login throughput
  -> higher risk during login storm
```

OWASP menjelaskan work factor sebagai jumlah iterasi/biaya yang membuat hash lebih mahal dihitung, sehingga memperlambat cracking, dan work factor harus dipilih agar tetap acceptable bagi server saat verifikasi password.

### 6.2 Password hashing is deliberately slow

Password verification bukan path yang harus dibuat secepat mungkin. Ia harus dibuat:

```text
slow enough for attacker
fast enough for legitimate login
bounded enough for production capacity
```

Jangan mengoptimasi password hashing dengan cara yang merusak security.

Buruk:

```java
// BAD: fast but insecure for password storage
MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
byte[] hash = sha256.digest(passwordBytes);
```

Lebih benar secara konsep:

```java
// Conceptual only: choose a modern password encoder/library.
PasswordEncoder encoder = new BCryptPasswordEncoder(12);
boolean matches = encoder.matches(rawPassword, storedHash);
```

### 6.3 Capacity calculation

Misal satu password verification membutuhkan 100 ms CPU efektif.

Maka satu CPU core kira-kira hanya bisa:

```text
1000 ms / 100 ms = 10 verifications/sec/core
```

Dengan 8 effective cores:

```text
8 * 10 = 80 verifications/sec
```

Tetapi ini upper bound kasar. Real system punya:

- GC,
- DB lookup,
- audit logging,
- MFA,
- network,
- application overhead,
- noisy neighbor,
- JVM warmup,
- burst traffic.

Maka safe capacity mungkin jauh lebih rendah.

### 6.4 Attack-aware capacity

Password login adalah endpoint yang attacker bisa tekan secara langsung.

Tanpa throttle:

```text
attacker sends 1000 login attempts/sec
password hash cost 100 ms
CPU required ≈ 100 effective cores
```

Ini bisa menjadi denial-of-service walaupun semua password salah.

Karena itu password endpoint harus punya:

1. per-account throttling,
2. per-IP throttling,
3. per-device/session throttling,
4. global login rate guard,
5. queue/backpressure,
6. bot detection/risk scoring jika perlu,
7. circuit breaker untuk expensive path,
8. cheap pre-filter tanpa membocorkan user enumeration.

NIST SP 800-63B mengharuskan verifier memiliki mekanisme rate limiting untuk membatasi failed authentication attempts dan melindungi dari online guessing attacks.

### 6.5 Cheap rejection vs enumeration risk

Engineer sering ingin menolak request secepat mungkin jika username tidak ditemukan.

Naif:

```java
User user = userRepository.findByUsername(username);
if (user == null) {
    return false; // much faster than password hash
}
return passwordEncoder.matches(rawPassword, user.passwordHash());
```

Masalah:

```text
username exists    -> response slower
username not exists -> response faster
```

Ini membuka timing-based user enumeration.

Pattern:

```java
private static final String DUMMY_HASH =
    "$2a$12$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

public boolean authenticate(String username, char[] password) {
    User user = userRepository.findByUsername(normalize(username));

    String hashToCheck = user != null ? user.passwordHash() : DUMMY_HASH;
    boolean passwordMatches = passwordEncoder.matches(CharBuffer.wrap(password), hashToCheck);

    return user != null && passwordMatches && user.isLoginAllowed();
}
```

Catatan:

- dummy hash harus valid,
- cost harus sama dengan hash normal,
- response message tetap generic,
- audit event tetap mencatat kategori internal tanpa membocorkan ke client,
- rate limit tetap berjalan untuk username tidak ditemukan.

### 6.6 Work factor migration performance

Ketika menaikkan work factor, migration sering dilakukan saat user login:

```text
user login with old hash
  -> verify old hash
  -> if valid and old cost
  -> rehash with new cost
  -> update stored hash
```

Masalah performance:

```text
one login now does two expensive operations:
  verify old hash + generate new hash
```

Untuk login storm setelah rollout, ini bisa menaikkan CPU drastis.

Pattern aman:

1. rollout bertahap,
2. monitor CPU login nodes,
3. limit rehash per interval,
4. async rehash hanya jika raw password masih tersedia di request lifecycle dengan aman,
5. jangan simpan raw password,
6. fallback jika DB update gagal,
7. metrics untuk `password_rehash_attempt`, `password_rehash_success`, `password_rehash_skipped`.

### 6.7 Password hashing thread pool

Jangan biarkan expensive hashing menghabiskan semua request threads.

Pattern:

```text
HTTP request thread
  -> validate input
  -> submit password verification to bounded executor
  -> timeout/backpressure if saturated
  -> return controlled error if overloaded
```

Namun hati-hati:

- terlalu banyak thread tidak menciptakan CPU baru,
- virtual thread tidak membuat CPU-bound hash lebih murah,
- unbounded executor adalah DoS amplifier,
- queue terlalu panjang menciptakan latency buruk.

Untuk CPU-bound hashing, bounded pool kira-kira mengikuti core count, bukan request count.

---

## 7. Session Store Performance

Session-based authentication memindahkan cost dari signature validation ke state lookup.

```text
request cookie JSESSIONID
  -> lookup session
  -> load security context/principal
  -> maybe touch expiry
  -> continue request
```

### 7.1 Session lookup as per-request dependency

Jika setiap request butuh Redis lookup, Redis menjadi bagian dari hot path.

```text
1000 API RPS
  -> 1000 session lookups/sec
```

Jika ada session touch/update setiap request:

```text
1000 API RPS
  -> 1000 reads/sec + 1000 writes/sec
```

Ini bisa membebani store.

### 7.2 Sliding expiry write amplification

Session idle timeout sering memakai sliding expiry:

```text
set session TTL to now + 15 minutes on every request
```

Masalah:

```text
every request becomes write
```

Optimasi:

```text
refresh TTL only if last refresh older than threshold
```

Contoh:

```text
idle timeout = 15 minutes
refresh threshold = 60 seconds

If user sends 100 requests in 10 seconds:
  update TTL once, not 100 times
```

### 7.3 Session data size

Session object terlalu besar merusak performance.

Buruk:

```text
session:
  user profile
  permissions list 10,000 entries
  menu tree
  tenant config
  large serialized object
```

Lebih baik:

```text
session:
  subject id
  session id
  tenant id
  assurance level
  login time
  last activity
  compact authority version
```

Lalu data lain diambil dari cache/domain store dengan lifecycle yang jelas.

### 7.4 Serialization cost

Java native serialization untuk session cluster sering buruk untuk security dan performance.

Pilih format yang:

- eksplisit,
- compact,
- versionable,
- tidak bergantung pada classpath fragile,
- aman dari deserialization risk.

Untuk session security context, pikirkan:

```text
What exactly needs to survive across requests?
What can be recomputed cheaply?
What must be invalidated if role changes?
```

### 7.5 Redis session design

Jika memakai Redis:

```text
key: sess:{sessionId}
value: compact session envelope
TTL: absolute or idle timeout
```

Perhatikan:

1. connection pool,
2. timeout singkat,
3. retry terbatas,
4. no infinite retry,
5. circuit breaker,
6. hot key risk,
7. memory eviction policy,
8. multi-AZ latency,
9. replication lag,
10. failover semantics.

### 7.6 Fail-open vs fail-closed

Jika session store down, apakah request authenticated boleh lanjut?

Untuk kebanyakan sistem:

```text
session store unavailable -> fail closed
```

Karena server tidak bisa membuktikan session valid.

Namun fail-closed berarti outage session store menjadi outage aplikasi.

Mitigasi:

- highly available session store,
- small local near-cache untuk read-only session validation dengan TTL sangat pendek,
- graceful degradation untuk public endpoints,
- separate login/session store capacity dari business cache,
- emergency operational runbook.

### 7.7 Local cache untuk session

Local cache bisa mengurangi Redis read load.

Tetapi local cache menciptakan stale session problem:

```text
logout at node A
session cached at node B
node B still accepts until local TTL expires
```

Jika requirement logout immediate, local cache harus:

- sangat pendek,
- mendukung invalidation event,
- atau tidak dipakai untuk session validity.

---

## 8. JWT Validation Performance

JWT sering dipilih karena bisa divalidasi lokal.

```text
request Authorization: Bearer eyJ...
  -> parse JWT
  -> select key by kid
  -> verify signature
  -> validate claims
  -> map authorities
```

### 8.1 JWT local validation advantage

Kekuatan JWT:

```text
No per-request network call to authorization server.
```

Ini sangat scalable jika:

- JWK set cached,
- claims validation benar,
- authority mapping efisien,
- token tidak terlalu besar,
- key rotation tidak menyebabkan miss storm.

Spring Security Resource Server mendukung local JWT validation dan menyediakan mekanisme untuk mengatur cache JWK set melalui `NimbusJwtDecoder`; dokumentasinya juga menyebut default in-memory JWK set cache sekitar 5 menit.

### 8.2 JWT cost components

Cost JWT:

```text
Base64URL decode
JSON parse header
select key by kid
signature verification
JSON parse claims
validate iss/aud/exp/nbf
map scopes/roles
create Authentication object
```

Signature verification cost tergantung algorithm:

```text
HS256 -> HMAC symmetric, usually fast, but shared secret distribution risk
RS256 -> RSA verification, common, moderate cost
ES256 -> ECDSA verification, smaller keys/signatures, implementation considerations
EdDSA -> modern, if supported by stack/libraries
```

Jangan memilih algorithm hanya dari speed. Pilih berdasarkan trust model, key distribution, compliance, library support, dan interoperability.

### 8.3 JWK cache miss storm

Jika resource server tidak punya key untuk `kid`, ia mengambil JWKS dari authorization server.

Masalah:

```text
key rotation occurs
100 service instances receive tokens with new kid
all miss cache
all fetch JWKS at once
authorization server/JWKS endpoint overloaded
```

Mitigasi:

1. pre-publish new key before signing tokens,
2. overlap old/new keys,
3. cache JWK set with sane TTL,
4. jitter refresh,
5. background refresh,
6. negative cache unknown `kid` briefly,
7. rate-limit JWKS refresh,
8. share cache if appropriate,
9. monitor `jwt_unknown_kid_total`,
10. run key rotation rehearsal.

### 8.4 Token size and header bloat

JWT terlalu besar merusak performance.

Contoh penyebab:

```text
roles: [thousands of groups]
permissions: [fine-grained resource list]
profile: full user profile
tenant entitlements: huge object
```

Dampak:

- larger HTTP headers,
- gateway/header limit risk,
- more network bytes,
- more parsing cost,
- log leakage risk,
- browser cookie limit risk jika token disimpan di cookie.

Pattern:

```text
JWT contains stable identity and coarse claims.
Fine-grained authorization data loaded separately with cache/versioning.
```

### 8.5 Authority mapping cost

Sering signature verification cepat, tetapi mapping authority lambat.

Buruk:

```java
for each request:
  parse token
  call database to load roles
  call LDAP to load groups
  call permission service
```

Ini membatalkan keunggulan JWT local validation.

Lebih baik:

```text
JWT includes authority version / role summary.
Resource server validates token locally.
Permission service used only for resource-specific decision when needed.
Cache permission by subject+tenant+version.
```

### 8.6 JWT revocation vs performance

JWT lokal cepat karena tidak bertanya ke server pusat. Tetapi ini membuat revocation sulit.

Pilihan:

| Pattern | Performance | Revocation | Cocok untuk |
|---|---:|---:|---|
| Short-lived JWT only | sangat baik | menunggu exp | low-risk API |
| JWT + revocation cache | sedang | lebih cepat | high-risk action |
| JWT + introspection | lebih lambat | central | strict enterprise |
| Opaque token | network-bound | kuat | revocation-heavy |
| Sender-constrained token | baik | leak impact kecil | M2M/high assurance |

Tidak ada solusi gratis.

---

## 9. Opaque Token Introspection Performance

Opaque token memindahkan validation ke authorization server.

```text
request token abc123
  -> resource server calls introspection endpoint
  -> authorization server says active=true/false + metadata
```

RFC 7662 mendefinisikan introspection sebagai cara protected resource mengecek active state dan metadata token. Keunggulannya: revocation lebih mudah dikendalikan pusat. Kelemahannya: ada network call.

Spring Security menjelaskan opaque token dapat diverifikasi via introspection endpoint, dan ini berguna ketika revocation menjadi requirement.

### 9.1 The hidden multiplication problem

Jika resource server menerima 2.000 RPS dan introspection dilakukan per request:

```text
2.000 API RPS -> 2.000 introspection RPS
```

Jika ada 20 resource server:

```text
20 services * 2.000 RPS = 40.000 introspection RPS
```

Authorization server bisa menjadi bottleneck.

### 9.2 Introspection cache

Resource server dapat cache hasil introspection:

```text
cache key: token hash
cache value:
  active
  subject
  client_id
  scope
  exp
  tenant
  introspected_at
TTL: min(token_exp - now, configured_max_ttl)
```

Tetapi cache memperkenalkan staleness.

```text
token revoked now
resource server cached active=true for 60 seconds
attacker can use token until cache expires
```

### 9.3 Cache TTL decision

TTL introspection harus mengikuti risk.

| Risk | TTL Suggestion |
|---|---|
| Low-risk read API | 30–120 seconds possible |
| Medium-risk business API | 10–60 seconds |
| High-risk financial/admin action | no cache or very short cache |
| Emergency revoked token | push invalidation or denylist |

Rule:

```text
cache TTL <= acceptable revocation delay
```

### 9.4 Negative caching

Jika token inactive, bolehkah cache hasil inactive?

Biasanya ya, singkat:

```text
inactive token cache TTL = 5–30 seconds
```

Tujuannya mencegah repeated invalid token membanjiri introspection endpoint.

Tetapi hati-hati pada race:

```text
token newly issued but AS replication delay
resource server introspects -> inactive
negative cache stores inactive
valid user rejected temporarily
```

Gunakan TTL pendek dan observability.

### 9.5 Fail-open vs fail-closed

Jika introspection endpoint timeout:

```text
fail-open  -> availability higher, security weaker
fail-closed -> security stronger, availability weaker
```

Default untuk protected API biasanya fail-closed.

Namun sistem dengan graceful degradation bisa membedakan:

```text
read-only low-risk endpoint:
  maybe allow if token was recently active in cache

write/admin endpoint:
  fail closed

public endpoint:
  no auth dependency
```

Jangan membuat fail-open global tanpa risk model.

### 9.6 Introspection bulkhead

Resource server harus melindungi dirinya dari introspection dependency.

Pattern:

```text
bounded connection pool
short timeout
limited retry
circuit breaker
stale cache policy by endpoint risk
metrics
alerting
```

Retry tanpa batas adalah amplifier.

Buruk:

```text
AS slow
resource server retries 3x
traffic 2.000 RPS becomes 6.000 RPS
AS collapses harder
```

---

## 10. API Key Performance and Hot Key Risk

API key validation terlihat sederhana:

```text
read header
hash key
lookup key record
check active/scope/tenant
rate limit
continue
```

Tetapi API key sering dipakai partner dengan traffic tinggi.

### 10.1 Store lookup design

Jangan simpan raw API key.

Pattern:

```text
api key format:
  prefix.public_id.secret

store:
  key_id
  secret_hash
  tenant_id
  scopes
  status
  created_at
  expires_at
  last_used_at
```

Validation:

```text
extract key_id/prefix
load candidate key metadata
constant-time compare hash
check status/scope/tenant
rate limit
```

Performance advantage:

```text
key_id narrows lookup
hash compare avoids raw secret storage
```

### 10.2 Last-used write amplification

Banyak sistem ingin update `last_used_at` pada setiap API call.

Masalah:

```text
10.000 RPS partner key
  -> 10.000 writes/sec to key table
```

Lebih baik:

```text
buffer last-used updates
update at most once per key per N minutes
write asynchronously
store approximate last seen in Redis/metrics
```

### 10.3 Hot key

Satu API key milik partner besar bisa menjadi hot key untuk:

- rate limiter,
- quota counter,
- usage metering,
- audit aggregate,
- Redis key,
- database row.

Mitigasi:

```text
sharded counters
local pre-aggregation
windowed counters
write-behind usage events
separate real-time rate limit from billing aggregate
```

### 10.4 API key cache

API key metadata bisa di-cache.

```text
cache key: key_id
cache value: active/scopes/tenant/version
TTL: short
```

Butuh invalidation untuk revoked key.

Pattern:

```text
key status has version
revocation publishes event
local cache evicts key_id
TTL provides fallback
```

---

## 11. HMAC Request Signing Performance

HMAC signing menambahkan cost canonicalization dan digest.

```text
canonical request = method + path + query + headers + body hash + timestamp
signature = HMAC(secret, canonical request)
```

### 11.1 Cost drivers

1. Body size.
2. Header normalization.
3. Query sorting.
4. Hashing body.
5. Replay cache lookup.
6. Clock validation.
7. Secret lookup.

### 11.2 Large body problem

Jika request body besar:

```text
hash entire body before routing
```

Ini bisa mahal.

Pattern:

```text
client sends content digest header
server streams body hash while reading
server avoids buffering entire body
max body size enforced before expensive work
```

### 11.3 Replay cache performance

HMAC biasanya memakai nonce/timestamp.

```text
nonce key: hmac-nonce:{clientId}:{nonce}
TTL: allowed clock skew window
```

Jika traffic tinggi, replay cache bisa besar.

Mitigasi:

- timestamp window pendek,
- nonce length cukup,
- Redis memory sizing,
- reject old timestamp before nonce lookup,
- rate limit per client,
- avoid storing nonce for requests already rejected early.

### 11.4 Debuggability vs overhead

Signature mismatch sulit di-debug. Tetapi logging canonical request bisa membocorkan data.

Pattern:

```text
log canonical hash, not full canonical string
log signed header names
log timestamp delta
log client id
log reason category
```

---

## 12. LDAP and Directory Authentication Performance

LDAP/AD authentication umum di enterprise.

### 12.1 Bind cost

Typical flow:

```text
search service account bind
  -> search user DN
  -> bind as user with supplied password
  -> search groups
```

Ini network-heavy dan directory-dependent.

### 12.2 Connection pooling

LDAP connection setup bisa mahal.

Pattern:

```text
pool service-account search connections
avoid pooling user password bind connections unless library semantics clear
set connection/read timeout
use TLS correctly
monitor pool saturation
```

### 12.3 Group lookup explosion

Nested groups bisa mahal.

```text
user memberOf group A
A memberOf group B
B memberOf group C
...
```

Jika setiap login melakukan recursive group expansion, directory load tinggi.

Mitigasi:

- cache group mapping per user for short TTL,
- store authority snapshot in local app after login,
- use directory matching rules if AD supports,
- restrict group search base,
- avoid fetching irrelevant groups,
- map only app-relevant groups.

### 12.4 Directory outage

Jika LDAP down:

```text
new login fails
existing sessions may continue
```

Ini perbedaan penting:

```text
login availability != active session availability
```

Pattern:

- do not call LDAP on every request,
- load groups at login or with short authority cache,
- define stale authority window,
- provide admin break-glass mechanism with strict audit,
- monitor LDAP latency separately.

---

## 13. TLS and mTLS Performance

TLS punya dua cost utama:

1. handshake,
2. per-record encryption/decryption.

mTLS menambahkan client certificate verification dan certificate chain processing.

### 13.1 Handshake amortization

Jika koneksi reuse:

```text
one handshake -> many requests
```

Jika koneksi tidak reuse:

```text
every request pays handshake
```

Untuk Java HTTP client/server:

- enable keep-alive,
- tune connection pool,
- avoid creating new HTTP client per request,
- reuse TLS context,
- monitor handshake count,
- use HTTP/2 multiplexing when appropriate.

### 13.2 mTLS at gateway vs app

Option A:

```text
client -> gateway mTLS
          gateway -> app normal/internal TLS
```

Pros:

- app simpler,
- centralized certificate handling,
- easier scaling.

Cons:

- app must trust gateway header carefully,
- original client cert identity must be propagated safely,
- spoofing risk if internal boundary weak.

Option B:

```text
client -> app mTLS end-to-end
```

Pros:

- app directly verifies cert,
- stronger boundary.

Cons:

- app cert handling complexity,
- operational burden,
- harder service mesh/gateway integration.

### 13.3 Certificate revocation performance

CRL/OCSP checks can be slow or flaky.

Design questions:

1. Is revocation checked online?
2. Is OCSP stapling available?
3. What happens if revocation endpoint is down?
4. Is there a local CRL cache?
5. What is acceptable revocation delay?

Again:

```text
security freshness vs availability vs latency
```

---

## 14. SAML Performance

SAML login flow is not usually per-request in modern systems, but login itself can be expensive.

Cost:

- XML parse,
- XML signature validation,
- metadata lookup,
- certificate validation,
- assertion replay cache,
- user provisioning,
- group/attribute mapping,
- session creation.

### 14.1 XML parsing cost and safety

Do not treat SAML XML parsing as ordinary XML parsing.

Performance and security are linked:

- disable unsafe XML features,
- avoid external entity resolution,
- enforce size limits,
- validate signature with correct signed element,
- cache IdP metadata safely,
- cap assertion size.

### 14.2 Metadata refresh

SAML IdP metadata includes keys and endpoints.

Performance pattern:

```text
cache metadata
refresh in background
keep old metadata during transient failure
alert before certificate expiry
```

Avoid fetching metadata synchronously during login unless no alternative.

---

## 15. WebAuthn and Passkey Performance

WebAuthn backend verification is usually not the main bottleneck. The harder problems are:

- challenge storage,
- origin/RP ID validation,
- credential lookup,
- signature verification,
- counter handling,
- recovery flow,
- audit.

### 15.1 Challenge store

Registration/authentication challenge must be stored temporarily.

```text
key: webauthn-challenge:{sessionId or transactionId}
TTL: short, e.g. minutes
value: challenge + user context + intent + rpId + origin expectation
```

Performance concerns:

- do not keep challenges forever,
- avoid unbounded challenge creation,
- rate limit challenge issuance,
- bind challenge to intent,
- clean up after use.

### 15.2 Credential lookup

During assertion, server receives credential ID.

```text
credential_id -> public key + user handle + metadata
```

Credential ID lookup must be indexed and compact.

### 15.3 Counter update race

Some authenticators provide signature counter. Concurrent logins can cause race.

Pattern:

```text
read credential
verify assertion
compare counter
update counter with optimistic lock
```

If strict counter checking causes false positive due to concurrent request, design must be explicit.

---

## 16. Authentication Dependency Mapping

Every authentication architecture should map dependencies.

Example:

```text
Password login:
  App -> User DB
  App -> Password hasher CPU
  App -> MFA provider
  App -> Redis session
  App -> Audit pipeline

JWT API request:
  App -> JWK cache
  App -> local CPU signature verification
  App -> optional permission cache
  App -> audit/metrics

Opaque API request:
  App -> introspection endpoint
  App -> local cache
  App -> audit/metrics

LDAP login:
  App -> LDAP/AD
  App -> User mapping DB
  App -> Redis session
  App -> audit pipeline
```

Then classify each dependency:

| Dependency | Path | Failure Impact | Timeout | Retry | Cache | Owner |
|---|---|---|---:|---:|---|---|
| Redis session | per request | app auth outage | 50ms | no/limited | short local? | platform |
| IdP JWKS | cache miss | token validation failure | 1s | limited | yes | IAM |
| Introspection | per request/cache miss | API auth outage | 200ms | limited | yes | IAM |
| LDAP | login | login outage | 1s | limited | groups cache | enterprise |
| Password CPU | login | CPU saturation | n/a | no | n/a | app |

This table is often more valuable than a diagram.

---

## 17. Caching Patterns in Authentication

Caching is essential, but dangerous if not modeled.

### 17.1 What can be cached?

Common cache candidates:

- JWKS,
- introspection result,
- session envelope,
- API key metadata,
- LDAP group mapping,
- user profile summary,
- authorization server discovery document,
- SAML metadata,
- certificate chain validation result,
- tenant auth configuration.

### 17.2 What should not be cached casually?

Be careful with:

- raw credential,
- raw API key,
- raw password,
- MFA OTP,
- long-lived active token state,
- admin impersonation result,
- high-risk authorization decision,
- failed login counters without atomicity.

### 17.3 Cache key correctness

Wrong cache key can become security bug.

Bad:

```text
cache permission by userId only
```

Better:

```text
cache permission by tenantId + subjectId + clientId + scopeSetHash + authzVersion
```

For multi-tenant auth, cache key must include tenant/issuer.

Bad:

```text
jwkCache[kid]
```

Better:

```text
jwkCache[issuer][kid]
```

Because different issuers can reuse same `kid`.

### 17.4 TTL is not correctness

TTL is a fallback, not a complete invalidation strategy.

For critical revocation:

```text
revocation event -> invalidate cache
TTL -> safety net
```

### 17.5 Cache stampede

When cache expires, all requests refresh at once.

Mitigation:

- jitter TTL,
- single-flight refresh,
- background refresh,
- stale-while-revalidate if security allows,
- per-key locks,
- max refresh rate.

Example mental model:

```text
1000 requests for same token/key at TTL expiry
  naive: 1000 remote calls
  single-flight: 1 remote call + 999 wait/use stale depending policy
```

---

## 18. Rate Limiting, Throttling, and Backpressure

Authentication systems must protect themselves from abuse.

### 18.1 Different limit dimensions

For login:

```text
per account
per IP
per IP subnet
per device fingerprint
per username normalized
per tenant
global login endpoint
```

For API key:

```text
per key
per tenant
per route
per method
per partner plan
global edge
```

For token endpoint:

```text
per client_id
per grant type
per tenant
per source network
```

For introspection:

```text
per resource server
per token hash
per tenant
global AS capacity
```

### 18.2 Throttling vs lockout

Lockout can be abused:

```text
attacker fails login many times for victim
victim account locked
```

Better pattern:

- progressive delay,
- risk-based challenge,
- temporary soft lock,
- user notification,
- avoid permanent lock without recovery,
- admin unlock audit.

### 18.3 Backpressure

If password hashing pool is saturated, do not queue indefinitely.

```text
if queue full:
  return 429 or controlled auth temporarily unavailable
```

Backpressure protects system integrity.

### 18.4 Token bucket example

Conceptual Java-like pseudocode:

```java
public final class LoginThrottle {
    private final RateLimiter byAccount;
    private final RateLimiter byIp;
    private final RateLimiter global;

    public ThrottleDecision check(String normalizedUsername, String ip) {
        if (!global.tryAcquire()) return ThrottleDecision.globalLimit();
        if (!byIp.tryAcquire(ip)) return ThrottleDecision.ipLimit();
        if (!byAccount.tryAcquire(normalizedUsername)) return ThrottleDecision.accountLimit();
        return ThrottleDecision.allowed();
    }
}
```

In production, distributed rate limiting needs atomic counters/windowing and careful Redis/script design.

---

## 19. Threading Model and Authentication

Java 8–25 changes how we think about concurrency.

### 19.1 Platform threads

Classic Servlet stack:

```text
one request occupies one platform thread while processing
```

If authentication blocks on LDAP/introspection, request thread is occupied.

### 19.2 Reactive stack

Reactive stack can handle network waiting with fewer threads.

But:

- CPU-bound password hashing still needs bounded scheduler,
- blocking LDAP calls must not run on event loop,
- context propagation must use Reactor context, not ThreadLocal assumption.

### 19.3 Virtual threads

Virtual threads make blocking I/O cheaper from thread scalability perspective.

But they do not make CPU-bound work cheaper.

```text
LDAP call blocking -> virtual thread helps scalability
password hash CPU -> virtual thread does not reduce CPU cost
JWT signature CPU -> virtual thread does not reduce CPU cost
```

Virtual threads can simplify code, but authentication still needs:

- bounded downstream connections,
- rate limiting,
- timeout,
- backpressure,
- context isolation.

### 19.4 ThreadLocal security context overhead

ThreadLocal itself is not usually dominant cost, but context leakage/propagation bugs are severe.

Performance optimization must not break correctness:

```text
fast but wrong identity propagation = security incident
```

---

## 20. Connection Pooling for Authentication Dependencies

Authentication dependencies often need pools:

- database pool,
- Redis pool,
- LDAP pool,
- HTTP client pool for introspection/userinfo/JWKS,
- token endpoint client pool,
- broker connections,
- TLS connections.

### 20.1 Pool sizing rule

Pool size should be derived from:

```text
expected concurrency = throughput * latency
```

Little's Law mental model:

```text
concurrency ≈ RPS * average latency seconds
```

Example:

```text
introspection RPS = 500
introspection latency = 50 ms = 0.05 s
needed concurrent calls ≈ 500 * 0.05 = 25
```

Pool size maybe 30–50, not 500.

### 20.2 Too small vs too large

Too small:

```text
pool wait high
request latency increases
```

Too large:

```text
downstream overloaded
more memory/thread/context overhead
failure amplification
```

A pool is not just a performance knob. It is also a bulkhead.

### 20.3 Timeout hierarchy

Timeouts should be layered.

Example:

```text
client request timeout:       2s
application auth budget:    200ms
introspection timeout:      100ms
connection timeout:          50ms
pool acquisition timeout:    20ms
```

Avoid situation where authentication dependency waits longer than total request budget.

---

## 21. Login Storms

Login storm happens when many users authenticate at once.

Common triggers:

- office start time,
- session timeout synchronized,
- IdP outage recovery,
- deployment restart losing sessions,
- forced logout,
- password reset campaign,
- mobile app token expiry bug,
- certificate rotation issue,
- bot attack.

### 21.1 Session timeout synchronization

If all sessions expire exactly after 60 minutes from deployment/login campaign:

```text
09:00 login campaign
10:00 many sessions expire
10:00 login storm
```

Mitigation:

- jitter expiration,
- sliding idle timeout,
- token refresh before expiry,
- staggered rollout,
- preserve sessions across deployment,
- avoid mass invalidation unless necessary.

### 21.2 IdP recovery storm

If IdP down for 10 minutes, clients may retry aggressively.

When IdP returns:

```text
all clients retry immediately
IdP collapses again
```

Mitigation:

- exponential backoff,
- jitter,
- retry-after respect,
- circuit breaker,
- client-side retry budget,
- queue with cap,
- health-based gating.

### 21.3 Forced password migration storm

If new policy forces rehash/reset for all users at next login, CPU spike follows.

Mitigation:

- progressive migration,
- background campaign,
- throttle expensive rehash,
- capacity test before rollout.

---

## 22. Graceful Degradation Patterns

Authentication often cannot degrade freely. But some paths can degrade safely.

### 22.1 Classify endpoints by risk

```text
public informational endpoint
low-risk authenticated read endpoint
normal business write endpoint
high-risk admin/financial/regulatory endpoint
```

Then decide failure policy.

Example:

| Dependency Failure | Low-risk Read | Normal Write | High-risk Admin |
|---|---|---|---|
| JWKS refresh fails but old key cached | allow with cached key | allow if token valid | maybe allow if key not expired by policy |
| Introspection down with recent active cache | allow short stale | fail or limited | fail closed |
| LDAP down | existing session continues | existing session continues | step-up unavailable |
| MFA provider down | no new MFA | fail for step-up | fail closed |
| Audit pipeline slow | buffer/drop non-critical? | write durable audit | block if audit legally required |

### 22.2 Avoid global binary behavior

Bad:

```text
if auth dependency slow -> whole app down
```

Better:

```text
classify request by risk and dependency need
apply tailored fallback
```

### 22.3 Stale-while-revalidate

For JWKS/config metadata:

```text
use cached metadata while refreshing in background
```

For token active state, be much more careful.

```text
stale active token = possible security exposure
```

---

## 23. Benchmarking Authentication

Performance claims without measurement are guesses.

### 23.1 What to benchmark

Benchmark separately:

1. password hash verify,
2. JWT validation,
3. opaque introspection with mock latency,
4. Redis session lookup,
5. LDAP bind/group lookup,
6. API key validation,
7. HMAC canonicalization/signature,
8. mTLS handshake vs keep-alive,
9. SAML assertion validation,
10. complete login flow.

### 23.2 Microbenchmark vs system benchmark

Microbenchmark:

```text
How fast is BCrypt verify on this instance type?
How fast is RSA signature verification?
```

System benchmark:

```text
How many logins/sec can the full system handle with DB + audit + MFA mock + session store?
```

Both are needed.

### 23.3 JMH for crypto/hash

Use JMH for CPU-bound Java benchmarks.

Example conceptual benchmark:

```java
@State(Scope.Benchmark)
public class JwtVerifyBenchmark {
    private JwtDecoder decoder;
    private String token;

    @Setup
    public void setup() {
        // initialize decoder with static test key and token
    }

    @Benchmark
    public Jwt decodeAndVerify() {
        return decoder.decode(token);
    }
}
```

For password:

```java
@State(Scope.Benchmark)
public class PasswordVerifyBenchmark {
    private PasswordEncoder encoder;
    private String hash;

    @Setup
    public void setup() {
        encoder = new BCryptPasswordEncoder(12);
        hash = encoder.encode("correct horse battery staple");
    }

    @Benchmark
    public boolean verify() {
        return encoder.matches("correct horse battery staple", hash);
    }
}
```

Important:

- benchmark on production-like CPU,
- benchmark each work factor,
- include warmup,
- measure p95/p99 at system level,
- do not extrapolate laptop result blindly.

### 23.4 Load testing login safely

Login load test must avoid damaging real user accounts.

Use:

- test users,
- isolated environment,
- realistic password hash cost,
- realistic DB/index,
- realistic session store,
- realistic IdP/mock latency,
- audit pipeline enabled,
- throttle behavior enabled.

Measure:

```text
login_success_latency
login_failure_latency
password_hash_duration
mfa_challenge_duration
auth_db_query_duration
session_create_duration
audit_write_duration
rate_limited_count
cpu_usage
thread_pool_queue
```

### 23.5 Chaos testing auth dependencies

Test:

- JWKS endpoint slow,
- JWKS endpoint returns old keys,
- unknown `kid` spike,
- introspection timeout,
- Redis session latency,
- LDAP down,
- MFA provider down,
- audit pipeline down,
- clock skew,
- token endpoint rate limit,
- certificate expiry.

Authentication should have rehearsed failure behavior.

---

## 24. Metrics for Authentication Performance

Metrics should be mode-specific.

### 24.1 Core metrics

```text
auth_request_total{mode,result,tenant,client}
auth_latency_seconds{mode,result}
auth_dependency_latency_seconds{dependency}
auth_failure_total{reason}
auth_rate_limited_total{dimension}
auth_cache_hit_total{cache}
auth_cache_miss_total{cache}
auth_cache_stale_used_total{cache}
auth_token_validation_total{result,reason}
auth_session_lookup_total{result}
auth_password_hash_seconds{algorithm,cost}
auth_introspection_total{result}
auth_jwks_refresh_total{result}
auth_unknown_kid_total{issuer}
auth_ldap_bind_total{result}
auth_mfa_challenge_total{result}
```

### 24.2 Dependency metrics

For each auth dependency:

```text
latency p50/p95/p99
error rate
timeout rate
retry count
circuit breaker state
pool active
pool pending
pool timeout
cache hit/miss
```

### 24.3 RED and USE

RED for request path:

```text
Rate
Errors
Duration
```

USE for resources:

```text
Utilization
Saturation
Errors
```

Authentication needs both.

### 24.4 Alert examples

```text
JWT unknown kid > baseline
JWKS refresh failures > 0 for 5 minutes
introspection p95 > 200ms
password hash p95 > expected * 2
login failure spike by tenant
session store timeout > 1%
LDAP bind timeout > threshold
MFA provider failure > threshold
auth cache miss ratio sudden spike
rate limited global login > threshold
```

Do not alert on every failed login individually. Alert on patterns.

---

## 25. Java Implementation Patterns

### 25.1 Bounded expensive authentication executor

```java
public final class PasswordVerifierService {
    private final ExecutorService passwordExecutor;
    private final PasswordEncoder passwordEncoder;

    public PasswordVerifierService(int workers, int queueSize, PasswordEncoder passwordEncoder) {
        this.passwordEncoder = passwordEncoder;
        this.passwordExecutor = new ThreadPoolExecutor(
            workers,
            workers,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(queueSize),
            new ThreadPoolExecutor.AbortPolicy()
        );
    }

    public CompletableFuture<Boolean> verifyAsync(String rawPassword, String storedHash) {
        return CompletableFuture.supplyAsync(
            () -> passwordEncoder.matches(rawPassword, storedHash),
            passwordExecutor
        );
    }
}
```

Notes:

- bounded queue,
- explicit rejection,
- metrics on rejection,
- clear timeout at caller,
- raw password lifetime minimized.

### 25.2 Single-flight JWKS refresh concept

```java
public final class SingleFlightJwksCache {
    private final AtomicReference<JwkSet> current = new AtomicReference<>();
    private final AtomicReference<CompletableFuture<JwkSet>> refreshInProgress = new AtomicReference<>();

    public JwkSet getOrRefresh() {
        JwkSet cached = current.get();
        if (cached != null && !cached.shouldRefresh()) {
            return cached;
        }

        CompletableFuture<JwkSet> existing = refreshInProgress.get();
        if (existing != null) {
            return cached != null ? cached : existing.join();
        }

        CompletableFuture<JwkSet> started = CompletableFuture.supplyAsync(this::fetchRemoteJwks);
        if (refreshInProgress.compareAndSet(null, started)) {
            started.whenComplete((jwks, error) -> {
                if (error == null) current.set(jwks);
                refreshInProgress.set(null);
            });
            return cached != null ? cached : started.join();
        }

        return current.get();
    }

    private JwkSet fetchRemoteJwks() {
        throw new UnsupportedOperationException("Implement HTTP fetch with timeout and validation");
    }
}
```

This is conceptual. Production code should handle timeout, issuer binding, cache-control, validation, metrics, and error policy.

### 25.3 Introspection cache envelope

```java
public record IntrospectionCacheEntry(
    boolean active,
    String subject,
    String clientId,
    Set<String> scopes,
    Instant expiresAt,
    Instant cachedAt
) {
    boolean usableAt(Instant now) {
        return active && now.isBefore(expiresAt);
    }
}
```

TTL calculation:

```java
Duration ttl = min(
    configuredMaxTtl,
    Duration.between(now, tokenExp)
);
```

Never cache beyond token expiry.

### 25.4 Safe API key lookup

```java
public final class ApiKeyAuthenticator {
    private final ApiKeyRepository repository;
    private final MacHasher hasher;

    public ApiKeyAuthenticationResult authenticate(String presentedKey) {
        ParsedApiKey parsed = ParsedApiKey.parse(presentedKey);
        ApiKeyRecord record = repository.findByKeyId(parsed.keyId())
            .orElse(null);

        if (record == null) {
            hasher.dummyCompare(parsed.secret());
            return ApiKeyAuthenticationResult.invalid();
        }

        boolean matches = hasher.constantTimeMatches(parsed.secret(), record.secretHash());
        if (!matches || !record.active() || record.expired()) {
            return ApiKeyAuthenticationResult.invalid();
        }

        return ApiKeyAuthenticationResult.authenticated(
            record.tenantId(),
            record.clientId(),
            record.scopes(),
            record.version()
        );
    }
}
```

Key point:

- no raw key storage,
- key ID narrows lookup,
- dummy compare reduces timing signal,
- active/expired/scope checks explicit.

### 25.5 Avoid per-request remote authority load

Bad:

```java
public Authentication authenticateJwt(Jwt jwt) {
    List<Group> groups = ldapClient.loadGroups(jwt.getSubject());
    List<Role> roles = database.loadRoles(jwt.getSubject());
    return buildAuth(jwt, groups, roles);
}
```

Better:

```java
public Authentication authenticateJwt(Jwt jwt) {
    TokenClaims claims = validateClaims(jwt);
    AuthoritySnapshot snapshot = authorityCache.get(
        claims.tenantId(),
        claims.subject(),
        claims.authorityVersion()
    );
    return buildAuth(claims, snapshot.authorities());
}
```

But only if snapshot invalidation and staleness are designed.

---

## 26. Architecture Patterns

### 26.1 Local JWT validation for high-throughput APIs

```text
Client
  -> API Gateway
  -> Java Resource Server
       -> local JWT validation
       -> local JWKS cache
       -> local/common permission cache
```

Use when:

- high throughput,
- revocation delay acceptable,
- short token lifetime,
- strong key rotation process.

Avoid when:

- immediate revocation required per request,
- token contains highly volatile privilege,
- clients cannot protect bearer tokens.

### 26.2 Opaque token for revocation-heavy systems

```text
Client
  -> Java Resource Server
       -> introspection cache
       -> Authorization Server introspection endpoint
```

Use when:

- central control is important,
- revocation must be near-real-time,
- token metadata should not be exposed.

Mitigate:

- introspection cache,
- short timeouts,
- circuit breaker,
- AS capacity planning.

### 26.3 Session + BFF for browser apps

```text
Browser
  -> BFF Java backend
       -> server-side session
       -> token stored server-side
       -> downstream API calls
```

Use when:

- browser should not hold access token,
- CSRF/cookie semantics understood,
- central session revocation desired,
- UI and backend are same trust boundary.

Mitigate:

- session store HA,
- CSRF protection,
- SameSite/Secure/HttpOnly,
- session rotation,
- session cache design.

### 26.4 Gateway mTLS + internal token exchange

```text
Partner
  -> mTLS Gateway
       -> validate cert
       -> map partner identity
       -> token exchange / internal token
       -> Java services validate internal token
```

Use when:

- partner identity uses certificates,
- internal services prefer token-based model,
- gateway is strong trust boundary.

Mitigate:

- signed internal headers or internal token,
- prevent header spoofing,
- audit original cert identity,
- certificate rotation playbook.

---

## 27. Failure Modes

### 27.1 Authentication dependency cascade

```text
IdP slow
  -> resource servers waiting
  -> request threads exhausted
  -> health checks fail
  -> autoscaling creates more instances
  -> more instances call IdP
  -> IdP slower
```

Mitigation:

- timeouts,
- circuit breaker,
- cache,
- bulkhead,
- jitter,
- autoscaling based on right signals,
- do not retry aggressively.

### 27.2 Cache correctness bug

```text
cache key = kid
issuer A kid=1
issuer B kid=1
resource server uses wrong key
```

Mitigation:

```text
cache key = issuer + kid
validate issuer before key selection policy completes
bind decoder/validator to tenant issuer
```

### 27.3 Revocation ignored for performance

```text
JWT valid for 8 hours
user terminated now
resource server accepts token until expiry
```

Mitigation:

- shorter access token lifetime,
- denylist for high-risk cases,
- token introspection for critical APIs,
- session/token version claim,
- authority version check,
- event-driven invalidation.

### 27.4 Login DoS through expensive hashing

```text
attacker sends many invalid passwords
server hashes all attempts
CPU exhausted
```

Mitigation:

- rate limiting before hash,
- bounded hash executor,
- global login guard,
- bot mitigation,
- cheap but non-enumerating rejection.

### 27.5 JWKS endpoint outage during cold start

```text
all resource servers restart
need JWKS
JWKS endpoint unavailable
API cannot validate tokens
```

Mitigation:

- persisted JWKS cache if acceptable,
- startup dependency policy explicit,
- warmup before serving,
- graceful stale key policy,
- avoid mass restart during IdP maintenance.

### 27.6 Audit pipeline backpressure

```text
auth logs synchronous
log pipeline slow
login slows/fails
```

Mitigation:

- classify audit durability requirement,
- local durable buffer for critical events,
- bounded async queue for non-critical telemetry,
- drop policy only for non-security debug logs,
- alert on audit lag.

---

## 28. Production Checklist

### 28.1 General authentication performance

- [ ] Authentication modes are listed per endpoint/client type.
- [ ] Per-request vs login-only auth cost separated.
- [ ] Latency budget exists for authentication.
- [ ] p50/p95/p99 metrics exist.
- [ ] Dependency map exists.
- [ ] Timeout/retry/circuit breaker policy exists.
- [ ] Auth dependency pools are sized.
- [ ] Auth caches have key correctness and TTL policy.
- [ ] Revocation staleness is documented.
- [ ] Load test includes authentication path.

### 28.2 Password login

- [ ] Password hashing algorithm/work factor benchmarked.
- [ ] Login endpoint has rate limiting.
- [ ] Hashing uses bounded CPU capacity.
- [ ] Unknown username path avoids timing enumeration.
- [ ] Work factor migration plan exists.
- [ ] Password reset path has same abuse controls.
- [ ] Metrics for hash duration and queue saturation exist.

### 28.3 Session

- [ ] Session store capacity tested.
- [ ] Session payload is compact.
- [ ] Sliding expiration does not write every request unnecessarily.
- [ ] Session invalidation semantics documented.
- [ ] Redis/database timeout is short.
- [ ] Local session cache staleness is acceptable if used.
- [ ] Logout behavior tested under concurrency.

### 28.4 JWT/JWKS

- [ ] Issuer and audience validation enabled.
- [ ] JWKS cache configured.
- [ ] JWKS cache key includes issuer/tenant.
- [ ] Unknown `kid` behavior rate-limited.
- [ ] Key rotation rehearsed.
- [ ] Token size monitored.
- [ ] Authority mapping does not call remote dependency per request unintentionally.

### 28.5 Opaque token

- [ ] Introspection endpoint latency budgeted.
- [ ] Introspection cache TTL tied to revocation requirement.
- [ ] Fail-open/fail-closed policy documented per endpoint risk.
- [ ] Connection pool, timeout, retry, circuit breaker configured.
- [ ] Negative caching considered.
- [ ] Authorization server capacity tested.

### 28.6 LDAP/AD

- [ ] Bind/search flow measured.
- [ ] Group lookup bounded.
- [ ] LDAP timeouts set.
- [ ] Connection pooling configured safely.
- [ ] Directory outage behavior documented.
- [ ] Existing session behavior during directory outage clear.

### 28.7 mTLS

- [ ] Keep-alive/connection reuse enabled.
- [ ] Cert validation latency measured.
- [ ] Revocation checking policy documented.
- [ ] Certificate rotation rehearsed.
- [ ] Gateway-to-app identity propagation protected.

---

## 29. Common Mistakes

1. Treating authentication as only login.
2. Doing opaque token introspection on every request without capacity plan.
3. Assuming JWT validation is free.
4. Fetching JWKS synchronously on every request.
5. Using `kid` cache without issuer isolation.
6. Putting huge group/permission lists in JWT.
7. Calling LDAP/database for roles on every API request.
8. Updating session TTL and API key `last_used_at` on every request without write budget.
9. Using unbounded thread pools for password hashing.
10. Adding retries to IdP calls without retry budget.
11. Choosing fail-open globally without risk classification.
12. Ignoring login storm scenarios.
13. Benchmarking password hash on laptop and applying result to production.
14. Using local caches for revoked credentials without invalidation model.
15. Autoscaling app instances when bottleneck is external IdP.
16. Not monitoring auth dependency latency separately.
17. Mixing telemetry logs and legally required audit logs without durability distinction.
18. Assuming virtual threads solve CPU-bound authentication cost.
19. Not rehearsing key/cert rotation under load.
20. Letting rate limiter itself become hot key bottleneck.

---

## 30. Design Questions

Use these questions during architecture review.

### 30.1 Mode and path

1. Which authentication operation happens only at login?
2. Which operation happens on every request?
3. Which operation calls network dependency?
4. Which operation is CPU-bound?
5. Which operation writes shared state?

### 30.2 Capacity

1. What is expected normal RPS?
2. What is peak RPS?
3. What is attack RPS assumption?
4. How many password verifications/sec can the system tolerate?
5. How many introspection calls/sec can the AS tolerate?
6. How many session lookups/sec can Redis tolerate?
7. What happens during key rotation?
8. What happens during mass login after deployment?

### 30.3 Caching

1. What is cached?
2. What is cache key?
3. Does cache key include issuer/tenant/client/scope/version?
4. What is TTL?
5. What is invalidation trigger?
6. What is maximum stale window?
7. Is stale acceptable for this endpoint?

### 30.4 Failure

1. If IdP is down, who can still use the system?
2. If introspection is down, which endpoints fail closed?
3. If Redis session store is down, what fails?
4. If LDAP is down, can existing sessions continue?
5. If JWKS endpoint is down, can cached keys be used?
6. If audit pipeline is down, do we block login?

### 30.5 Security vs performance

1. Are we weakening revocation for speed?
2. Are we increasing token lifetime for convenience?
3. Are we caching authorization decisions without versioning?
4. Are we bypassing expensive checks under load?
5. Are we leaking user enumeration through fast failure?

---

## 31. Reference Decision Matrix

| Requirement | Prefer | Avoid |
|---|---|---|
| Very high API throughput, acceptable short revocation delay | short-lived JWT + cached JWKS | per-request introspection without cache |
| Immediate central revocation | opaque token + introspection/cache | long-lived JWT only |
| Browser app, token should not be in browser | BFF + server-side session | SPA storing long-lived tokens |
| Partner API with non-browser clients | API key or HMAC/mTLS depending risk | password auth |
| Strong machine identity | mTLS / private_key_jwt / workload identity | shared client secret everywhere |
| Enterprise directory login | LDAP/Kerberos at login + session | LDAP group lookup per request |
| Strict audit/regulatory action | step-up + fresh auth + durable audit | relying only on old session |
| Low-latency internal service | local token validation + audience | synchronous central auth call per hop |
| High-risk revocation-sensitive service | introspection or token version check | long TTL local-only cache |
| Large permission set | permission cache/version | huge JWT claims |

---

## 32. Practical Architecture Example

Scenario:

```text
Java regulatory case management platform
- browser UI
- internal users
- partner API
- microservices
- async workers
- audit requirement
- role changes must take effect within 5 minutes
- admin action must require step-up
```

Possible design:

```text
Browser UI:
  OIDC Authorization Code + PKCE to BFF
  BFF stores tokens server-side
  browser gets HttpOnly Secure SameSite cookie
  session idle timeout 15m, absolute timeout 8h

API between BFF and services:
  internal short-lived JWT
  aud per service
  JWKS cached with background refresh
  token lifetime 5m

Partner API:
  mTLS at gateway + HMAC request signing for high-risk endpoints
  partner identity mapped to internal client principal
  rate limit per partner/key/certificate

Async workers:
  workload identity for broker connection
  message carries actor envelope for audit, not raw user token

Role change:
  authority_version incremented
  permission cache key includes authority_version
  high-risk endpoints check fresh version

Admin action:
  step-up required if auth_time older than threshold
  durable audit event before/after action
```

Performance model:

```text
Normal API request:
  cookie session lookup at BFF
  internal JWT validation at services
  no IdP call per request

Role freshness:
  cache max staleness <= 5 minutes
  high-risk action does fresh check

Login:
  IdP dependency only at login/refresh
  login storm protected with rate limits

Audit:
  critical audit durable buffer
  non-critical telemetry async
```

This design avoids making IdP or LDAP a per-request dependency while preserving stronger controls where risk requires it.

---

## 33. Summary

Authentication performance is not just optimization. It is part of security architecture.

Key mental models:

1. Authentication is a hot path, not only a login feature.
2. Different modes have different cost profiles.
3. Password hashing must be intentionally expensive but bounded.
4. Session authentication scales through state store design.
5. JWT scales through local validation but pays in revocation complexity.
6. Opaque token improves central control but creates introspection dependency.
7. LDAP and IdP should usually not be called on every request.
8. mTLS cost must be amortized with connection reuse.
9. Cache improves latency but creates staleness and invalidation problems.
10. Rate limiting protects both security and availability.
11. Virtual threads help blocking I/O scalability but not CPU-bound crypto/hash cost.
12. Fail-open/fail-closed must be decided per endpoint risk, not globally.
13. Authentication must be measured with p95/p99, not guessed.
14. Key rotation, login storm, and dependency outage must be rehearsed.
15. A top-tier engineer can explain not only whether auth is secure, but how it behaves under load and failure.

---

## 34. References

- OWASP Password Storage Cheat Sheet — work factors and password storage guidance.  
  https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

- NIST SP 800-63B — Digital Identity Guidelines, authentication and rate limiting guidance.  
  https://pages.nist.gov/800-63-3/sp800-63b.html

- Spring Security OAuth2 Resource Server JWT — JWT validation and JWK Set caching.  
  https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html

- Spring Security OAuth2 Resource Server Opaque Token — token introspection.  
  https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/opaque-token.html

- Spring Security `OpaqueTokenIntrospector` API — contract for introspecting/verifying OAuth2 token.  
  https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/oauth2/server/resource/introspection/OpaqueTokenIntrospector.html

- RFC 7662 — OAuth 2.0 Token Introspection.  
  https://datatracker.ietf.org/doc/html/rfc7662

- RFC 7009 — OAuth 2.0 Token Revocation.  
  https://datatracker.ietf.org/doc/html/rfc7009

- RFC 9700 — OAuth 2.0 Security Best Current Practice.  
  https://datatracker.ietf.org/doc/rfc9700/

- RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens.  
  https://datatracker.ietf.org/doc/html/rfc8705

- RFC 2104 — HMAC: Keyed-Hashing for Message Authentication.  
  https://datatracker.ietf.org/doc/html/rfc2104

- Oracle Java SE Security / JSSE documentation.  
  https://docs.oracle.com/en/java/javase/25/security/

- OpenTelemetry Semantic Conventions — useful for metrics/tracing context when instrumenting authentication paths.  
  https://opentelemetry.io/docs/specs/semconv/

---

## 35. Penutup Part 31

Part ini membahas authentication sebagai performance-critical dan availability-critical subsystem.

Kita sudah melihat bahwa authentication architecture yang baik harus menjawab:

```text
secure against whom?
fast under what load?
available during which dependency failures?
stale for how long?
revocable within what window?
observable with which metrics?
recoverable through which runbook?
```

Ini adalah perbedaan antara implementasi authentication biasa dan engineering authentication yang matang.

**Status:** Part 31 selesai.  
**Series:** belum selesai.  
**Berikutnya:** Part 32 — Authentication Testing Strategy.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-030.md">⬅️ Part 30 — Observability, Audit, and Forensics for Authentication</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-032.md">Part 32 — Authentication Testing Strategy ➡️</a>
</div>
