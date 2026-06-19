# learn-redis-mastery-for-java-engineers-part-030.md

# Part 030 — Testing Redis-Backed Systems

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / backend engineer / tech lead  
> Fokus: strategi testing untuk sistem Java yang memakai Redis sebagai cache, state store sementara, limiter, lock, queue ringan, stream, atau coordination primitive.

---

## 0. Posisi Bagian Ini dalam Seri

Sampai bagian ini, kita sudah membahas Redis dari banyak sisi:

- model eksekusi command,
- data structures,
- TTL dan eviction,
- cache architecture,
- idempotency,
- locks,
- Lua dan Redis Functions,
- Pub/Sub dan Streams,
- persistence,
- replication,
- cluster,
- memory,
- latency,
- Java clients,
- transaction,
- security,
- observability,
- operations.

Sekarang pertanyaan praktisnya:

> Bagaimana kita membuktikan bahwa Redis-backed behavior di aplikasi Java benar, stabil, observable, dan tidak rapuh saat kondisi produksi buruk?

Testing Redis bukan sekadar:

```java
assertEquals("value", redisTemplate.opsForValue().get("key"));
```

Itu hanya membuktikan Redis bisa menyimpan string.

Yang lebih penting adalah membuktikan kontrak sistem:

- cache miss tidak membuat database overload,
- stale cache masih berada dalam toleransi bisnis,
- TTL tidak menyebabkan data hilang terlalu cepat,
- idempotency aman saat retry,
- lock tidak membuat double execution saat JVM pause,
- limiter tidak bocor di concurrency tinggi,
- stream consumer bisa recover dari crash,
- Redis down tidak menjatuhkan seluruh service tanpa kontrol,
- key schema tetap konsisten setelah refactor,
- serialization tidak merusak backward compatibility,
- cluster/sentinel failover tidak memunculkan silent data corruption.

Testing Redis harus diperlakukan sebagai **testing terhadap behavioral contract**, bukan hanya testing command.

---

## 1. Mental Model: Apa yang Sebenarnya Diuji?

Redis-backed system biasanya punya 4 lapisan:

```text
Application behavior
        ↓
Redis access abstraction / repository / adapter
        ↓
Redis command semantics
        ↓
Redis runtime behavior: TTL, memory, latency, failover, persistence, cluster
```

Testing yang buruk hanya menguji lapisan kedua:

```text
"apakah adapter memanggil Redis?"
```

Testing yang kuat menguji kontrak lintas lapisan:

```text
"jika request yang sama datang 10 kali secara paralel,
apakah hanya satu side effect eksternal terjadi,
dan apakah hasilnya stabil setelah Redis timeout?"
```

Redis-backed behavior sering gagal bukan karena command salah, tapi karena asumsi runtime salah:

- Redis selalu tersedia,
- TTL selalu presisi,
- network latency kecil,
- response pasti kembali,
- client retry aman,
- value schema tidak berubah,
- key tidak pernah collide,
- lock holder selalu selesai sebelum lease habis,
- consumer selalu ACK setelah processing,
- eviction tidak pernah terjadi.

Testing harus menyerang asumsi-asumsi itu.

---

## 2. Taxonomy Testing untuk Redis

Gunakan beberapa level testing, bukan satu jenis test untuk semua.

### 2.1 Unit Test

Unit test cocok untuk:

- key builder,
- TTL policy calculation,
- serialization/deserialization wrapper,
- cache decision logic,
- limiter decision function jika dipisah,
- idempotency state transition pure logic,
- lock lease validation,
- stream message mapping.

Unit test tidak cocok untuk membuktikan:

- Redis TTL benar,
- Lua script atomic,
- pipeline behavior benar,
- Redis failover aman,
- Redis Cluster hash slot behavior benar.

### 2.2 Integration Test

Integration test dengan Redis nyata cocok untuk:

- command behavior,
- TTL expiration,
- Lua script,
- `WATCH` / `MULTI` / `EXEC`,
- Redis Streams consumer group,
- Pub/Sub listener,
- serialization nyata,
- Spring Data Redis wiring,
- Lettuce/Jedis configuration.

### 2.3 Contract Test

Contract test menjaga agar boundary aplikasi stabil:

- key naming contract,
- value schema contract,
- Redis type contract,
- TTL contract,
- error handling contract,
- idempotency state contract.

Ini penting saat Redis dipakai oleh banyak service.

### 2.4 Concurrency Test

Concurrency test membuktikan behavior saat race:

- 100 request membuat cache miss yang sama,
- 50 worker mengambil delay queue,
- 20 consumer mencoba claim stream message,
- 100 request memakai idempotency key sama,
- lock acquisition bersamaan.

### 2.5 Failure Injection Test

Failure test menyerang Redis sebagai dependency:

- Redis down,
- Redis lambat,
- connection timeout,
- command timeout,
- Redis restart,
- failover,
- network partition simulasi sederhana,
- memory limit/eviction.

### 2.6 Load and Soak Test

Load test Redis bukan hanya throughput Redis. Yang diuji adalah:

- apakah Java service memakai Redis dengan pola command efisien,
- apakah pool menunggu terlalu lama,
- apakah pipeline/batch menurunkan round trip,
- apakah key growth terkendali,
- apakah TTL bekerja dalam durasi panjang,
- apakah memory fragmentation muncul.

---

## 3. Test Pyramid untuk Redis-Backed Java Service

Pyramid yang sehat:

```text
                         Few
                ┌──────────────────┐
                │ chaos/failover    │
                │ load/soak         │
                └──────────────────┘
              ┌──────────────────────┐
              │ integration tests     │
              │ real Redis            │
              │ Testcontainers        │
              └──────────────────────┘
          ┌──────────────────────────────┐
          │ contract tests                │
          │ key/value/TTL/schema          │
          └──────────────────────────────┘
      ┌────────────────────────────────────┐
      │ unit tests                          │
      │ pure logic, key builders, policies  │
      └────────────────────────────────────┘
                         Many
```

Kesalahan umum:

1. semua Redis logic hanya dites dengan mock,
2. semua Redis logic hanya dites dengan Redis nyata sehingga lambat dan brittle,
3. tidak ada test concurrency,
4. tidak ada test failure,
5. tidak ada test backward compatibility serialization,
6. tidak ada test untuk TTL,
7. tidak ada test untuk key schema.

---

## 4. Jangan Over-Mock Redis

Mock Redis sering memberi rasa aman palsu.

Contoh mock yang menyesatkan:

```java
when(redisTemplate.opsForValue().setIfAbsent(key, value, ttl)).thenReturn(true);
```

Ini tidak membuktikan:

- Redis benar-benar melakukan `SET NX EX`,
- TTL dipasang,
- behavior atomic,
- serialization benar,
- key tidak salah,
- command timeout ditangani.

Mock berguna untuk unit test branch logic, tapi tidak cukup untuk behavior Redis.

Prinsip:

```text
Mock dependency untuk menguji decision logic.
Gunakan Redis nyata untuk menguji Redis semantics.
```

---

## 5. Testcontainers Redis: Default Pilihan untuk Java Integration Test

Untuk Java modern, pendekatan umum adalah memakai Redis container nyata di integration test.

Contoh dengan JUnit 5 dan Testcontainers:

```java
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
@SpringBootTest
class RedisIntegrationTest {

    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:8.0-alpine")
            .withExposedPorts(6379);

    @DynamicPropertySource
    static void redisProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    @Test
    void contextStartsWithRealRedis() {
        // test application behavior here
    }
}
```

Catatan:

- gunakan Redis versi yang mendekati produksi,
- jangan pakai embedded Redis lama sebagai sumber kebenaran,
- jangan hardcode port 6379,
- isolasi key per test,
- flush database hanya jika test benar-benar memiliki instance Redis sendiri.

---

## 6. Embedded Redis: Hati-Hati

Embedded Redis terlihat nyaman, tetapi sering bermasalah:

- versi Redis tertinggal,
- tidak mencerminkan OS/container runtime produksi,
- tidak mendukung fitur baru,
- sulit mereplikasi cluster/sentinel/security,
- perilaku command bisa berbeda.

Embedded Redis boleh dipakai untuk test ringan bila organisasi sudah punya alasan kuat, tetapi untuk mastery-level engineering, Redis nyata via container lebih dapat dipercaya.

---

## 7. Isolasi Key dalam Test

Redis adalah shared keyspace. Test yang buruk bisa saling mengganggu.

Jangan membuat key seperti:

```text
user:123
session:abc
rate:user:42
```

Gunakan test namespace:

```text
test:{runId}:user:123
test:{runId}:session:abc
test:{runId}:rate:user:42
```

Di JUnit:

```java
class RedisKeyFactory {
    private final String namespace;

    RedisKeyFactory(String namespace) {
        this.namespace = namespace;
    }

    String userProfileKey(String userId) {
        return "test:" + namespace + ":user-profile:" + userId;
    }
}
```

Atau gunakan UUID per test class:

```java
private static final String TEST_RUN_ID = UUID.randomUUID().toString();
```

Cleanup:

- untuk Redis container dedicated: `FLUSHDB` aman setelah test,
- untuk Redis shared: jangan `FLUSHDB`; delete hanya key namespace test,
- untuk cluster: cleanup harus cluster-aware.

---

## 8. Contract Test untuk Key Schema

Key schema adalah API internal. Ia harus dites.

Contoh key schema:

```text
app:{tenantId}:user-profile:{userId}
app:{tenantId}:quota:{apiKey}:{yyyyMMddHHmm}
app:{tenantId}:idem:{idempotencyKey}
```

Test:

```java
@Test
void buildsUserProfileKey() {
    RedisKeys keys = new RedisKeys("case-mgmt");

    String key = keys.userProfile("tenant-7", "user-123");

    assertEquals("case-mgmt:{tenant-7}:user-profile:user-123", key);
}
```

Kenapa ini penting?

- menghindari key collision,
- menjaga hash tag Redis Cluster,
- memudahkan observability,
- memudahkan cleanup,
- menjaga compatibility antar service.

Rule penting:

```text
Key naming adalah bagian dari desain sistem, bukan detail string random.
```

---

## 9. Contract Test untuk Redis Type

Redis key punya type. Jika satu service menulis String dan service lain membaca Hash, runtime akan gagal.

Test type contract:

```java
@Test
void userProfileMustBeStoredAsHash() {
    String key = keys.userProfile("tenant-1", "user-1");

    redisTemplate.opsForHash().put(key, "name", "Alya");

    assertEquals("hash", redisTemplate.type(key).code());
}
```

Lebih baik lagi: type contract tidak diekspos ke business code, tapi dijaga oleh adapter.

```text
Business service → UserProfileCache → Redis Hash commands
```

Jangan biarkan seluruh codebase bebas menulis Redis key yang sama memakai type berbeda.

---

## 10. Contract Test untuk TTL

TTL adalah bagian dari business contract.

Contoh:

```java
@Test
void idempotencyKeyHasTwentyFourHourTtl() {
    String key = keys.idempotency("tenant-1", "req-123");

    idempotencyStore.markStarted(key);

    Long ttlSeconds = redisTemplate.getExpire(key, TimeUnit.SECONDS);

    assertNotNull(ttlSeconds);
    assertTrue(ttlSeconds <= 86400);
    assertTrue(ttlSeconds > 86300);
}
```

Namun test TTL harus memperhitungkan waktu berjalan.

Jangan assert terlalu presisi:

```java
assertEquals(86400, ttlSeconds); // brittle
```

Lebih baik pakai range toleransi.

---

## 11. Testing Expiration

Expiration test mudah flaky jika memakai `Thread.sleep` sembarangan.

Contoh sederhana:

```java
@Test
void keyExpiresAfterShortTtl() throws InterruptedException {
    String key = keys.temp("x");

    redisTemplate.opsForValue().set(key, "value", Duration.ofMillis(200));

    assertEquals("value", redisTemplate.opsForValue().get(key));

    Thread.sleep(500);

    assertNull(redisTemplate.opsForValue().get(key));
}
```

Masalah:

- CI lambat,
- scheduling tidak stabil,
- Redis active expiration tidak selalu instan,
- test menjadi flaky.

Strategi lebih baik:

1. gunakan TTL pendek tapi tidak terlalu pendek,
2. polling sampai kondisi terpenuhi dengan timeout,
3. pisahkan test TTL policy dari test Redis expiration.

Contoh polling:

```java
static void awaitUntil(Duration timeout, Supplier<Boolean> condition) throws InterruptedException {
    long deadline = System.nanoTime() + timeout.toNanos();
    while (System.nanoTime() < deadline) {
        if (condition.get()) return;
        Thread.sleep(50);
    }
    fail("condition not met within " + timeout);
}
```

Test:

```java
@Test
void keyEventuallyExpires() throws Exception {
    String key = keys.temp("x");
    redisTemplate.opsForValue().set(key, "value", Duration.ofMillis(300));

    awaitUntil(Duration.ofSeconds(3), () -> redisTemplate.opsForValue().get(key) == null);
}
```

---

## 12. Testing Cache-Aside Behavior

Cache-aside punya kontrak:

1. jika cache hit, database tidak dipanggil,
2. jika cache miss, database dipanggil sekali,
3. hasil database disimpan ke cache dengan TTL,
4. jika entity tidak ada, negative cache mungkin disimpan,
5. jika Redis gagal, service punya policy: fail-open atau fail-closed.

Contoh test hit:

```java
@Test
void cacheHitDoesNotCallDatabase() {
    String userId = "user-1";
    UserProfile cached = new UserProfile(userId, "Alya");

    userProfileCache.put(userId, cached);

    UserProfile result = service.getUserProfile(userId);

    assertEquals(cached, result);
    verify(userRepository, never()).findById(userId);
}
```

Contoh test miss:

```java
@Test
void cacheMissLoadsFromDatabaseAndStoresInRedis() {
    String userId = "user-2";
    UserProfile dbValue = new UserProfile(userId, "Bima");

    when(userRepository.findById(userId)).thenReturn(Optional.of(dbValue));

    UserProfile result = service.getUserProfile(userId);

    assertEquals(dbValue, result);
    assertEquals(dbValue, userProfileCache.get(userId).orElseThrow());
}
```

Yang harus diuji bukan hanya return value, tetapi juga side effect caching.

---

## 13. Testing Negative Caching

Negative caching menyimpan fakta bahwa data tidak ditemukan.

Tanpa negative cache:

```text
10.000 request untuk user tidak ada
→ 10.000 database query
```

Test:

```java
@Test
void missingUserIsNegativeCached() {
    String userId = "missing-user";
    when(userRepository.findById(userId)).thenReturn(Optional.empty());

    assertThrows(NotFoundException.class, () -> service.getUserProfile(userId));
    assertThrows(NotFoundException.class, () -> service.getUserProfile(userId));

    verify(userRepository, times(1)).findById(userId);
}
```

Periksa TTL negative cache lebih pendek dari positive cache:

```java
@Test
void negativeCacheHasShortTtl() {
    String key = keys.userProfileNegative("tenant-1", "missing-user");

    negativeCache.putMissing(key);

    Long ttl = redisTemplate.getExpire(key, TimeUnit.SECONDS);

    assertTrue(ttl > 0);
    assertTrue(ttl <= 300);
}
```

---

## 14. Testing Cache Stampede Protection

Stampede protection harus dites dengan concurrency.

Target behavior:

```text
100 request concurrent untuk key yang sama
→ hanya 1 database load
→ semua request mendapat hasil
```

Contoh kerangka test:

```java
@Test
void concurrentMissesAreCoalesced() throws Exception {
    String userId = "hot-user";
    UserProfile profile = new UserProfile(userId, "Hot User");

    CountDownLatch dbCallStarted = new CountDownLatch(1);
    CountDownLatch releaseDb = new CountDownLatch(1);
    AtomicInteger dbCalls = new AtomicInteger();

    when(userRepository.findById(userId)).thenAnswer(invocation -> {
        dbCalls.incrementAndGet();
        dbCallStarted.countDown();
        releaseDb.await(3, TimeUnit.SECONDS);
        return Optional.of(profile);
    });

    int concurrency = 50;
    ExecutorService executor = Executors.newFixedThreadPool(concurrency);
    List<Future<UserProfile>> futures = new ArrayList<>();

    for (int i = 0; i < concurrency; i++) {
        futures.add(executor.submit(() -> service.getUserProfile(userId)));
    }

    assertTrue(dbCallStarted.await(1, TimeUnit.SECONDS));
    releaseDb.countDown();

    for (Future<UserProfile> future : futures) {
        assertEquals(profile, future.get(3, TimeUnit.SECONDS));
    }

    assertEquals(1, dbCalls.get());
    executor.shutdownNow();
}
```

Catatan:

- test seperti ini bisa flaky jika implementation memang tidak punya request coalescing,
- untuk Redis mutex-based protection, test harus memastikan lock TTL cukup,
- untuk probabilistic refresh, test deterministik lebih sulit; pisahkan random function agar bisa dikontrol.

---

## 15. Testing Idempotency Store

Idempotency bukan hanya `SET NX`.

State minimal:

```text
ABSENT
  ↓ acquire
STARTED
  ↓ complete
COMPLETED(response)
  ↓ ttl expiry
ABSENT
```

Test case penting:

### 15.1 First Request Acquires Key

```java
@Test
void firstRequestAcquiresIdempotencyKey() {
    IdempotencyResult result = store.tryStart("tenant-1", "req-1", fingerprint);

    assertTrue(result.started());
}
```

### 15.2 Duplicate While Started Is Rejected or Waited

```java
@Test
void duplicateWhileStartedDoesNotExecuteAgain() {
    store.tryStart("tenant-1", "req-1", fingerprint);

    IdempotencyResult duplicate = store.tryStart("tenant-1", "req-1", fingerprint);

    assertEquals(IdempotencyStatus.IN_PROGRESS, duplicate.status());
}
```

### 15.3 Completed Response Is Replayed

```java
@Test
void duplicateAfterCompletionReplaysStoredResponse() {
    store.tryStart("tenant-1", "req-1", fingerprint);
    store.complete("tenant-1", "req-1", responsePayload);

    IdempotencyResult duplicate = store.tryStart("tenant-1", "req-1", fingerprint);

    assertEquals(IdempotencyStatus.COMPLETED, duplicate.status());
    assertEquals(responsePayload, duplicate.response());
}
```

### 15.4 Same Key Different Fingerprint Is Conflict

```java
@Test
void sameIdempotencyKeyWithDifferentFingerprintIsConflict() {
    store.tryStart("tenant-1", "req-1", fingerprintA);

    IdempotencyResult result = store.tryStart("tenant-1", "req-1", fingerprintB);

    assertEquals(IdempotencyStatus.CONFLICT, result.status());
}
```

This is crucial. Without fingerprint checking, a client can accidentally reuse the same idempotency key for a different operation.

---

## 16. Testing Rate Limiter

Rate limiter harus diuji dengan:

- sequential requests,
- boundary condition,
- time window transition,
- concurrency,
- per-dimension isolation,
- TTL cleanup.

Contoh fixed window:

```java
@Test
void allowsUpToLimitThenRejects() {
    String userId = "user-1";

    for (int i = 0; i < 5; i++) {
        assertTrue(rateLimiter.allow(userId));
    }

    assertFalse(rateLimiter.allow(userId));
}
```

Boundary:

```java
@Test
void differentUsersHaveSeparateQuota() {
    for (int i = 0; i < 5; i++) {
        assertTrue(rateLimiter.allow("user-A"));
    }

    assertFalse(rateLimiter.allow("user-A"));
    assertTrue(rateLimiter.allow("user-B"));
}
```

Concurrency test:

```java
@Test
void concurrentRequestsCannotExceedLimit() throws Exception {
    int limit = 10;
    int attempts = 100;
    ExecutorService executor = Executors.newFixedThreadPool(20);
    CountDownLatch start = new CountDownLatch(1);
    AtomicInteger allowed = new AtomicInteger();

    List<Future<?>> futures = new ArrayList<>();
    for (int i = 0; i < attempts; i++) {
        futures.add(executor.submit(() -> {
            start.await();
            if (rateLimiter.allow("user-concurrent")) {
                allowed.incrementAndGet();
            }
            return null;
        }));
    }

    start.countDown();
    for (Future<?> future : futures) future.get();

    assertEquals(limit, allowed.get());
    executor.shutdownNow();
}
```

Jika test ini gagal, limiter tidak atomic.

Biasanya perlu Lua script atau single atomic command pattern.

---

## 17. Testing Distributed Lock

Lock test harus membuktikan minimal:

1. hanya satu caller bisa acquire,
2. caller lain gagal saat lock aktif,
3. unlock hanya bisa dilakukan pemilik token,
4. lock expire jika holder mati,
5. lease terlalu pendek bisa membuat double execution.

### 17.1 Mutual Exclusion Basic

```java
@Test
void onlyOneCallerCanAcquireLock() {
    Optional<LockHandle> a = lockService.tryLock("resource-1", Duration.ofSeconds(5));
    Optional<LockHandle> b = lockService.tryLock("resource-1", Duration.ofSeconds(5));

    assertTrue(a.isPresent());
    assertTrue(b.isEmpty());
}
```

### 17.2 Token-Based Unlock

```java
@Test
void cannotUnlockWithWrongToken() {
    LockHandle owner = lockService.tryLock("resource-1", Duration.ofSeconds(5)).orElseThrow();

    boolean unlocked = lockService.unlock(new LockHandle("resource-1", "wrong-token"));

    assertFalse(unlocked);
    assertFalse(lockService.tryLock("resource-1", Duration.ofSeconds(5)).isPresent());

    assertTrue(lockService.unlock(owner));
}
```

### 17.3 Expired Lock Allows New Owner

```java
@Test
void expiredLockCanBeAcquiredByAnotherCaller() throws Exception {
    lockService.tryLock("resource-1", Duration.ofMillis(200)).orElseThrow();

    awaitUntil(Duration.ofSeconds(3), () ->
            lockService.tryLock("resource-1", Duration.ofSeconds(5)).isPresent()
    );
}
```

### 17.4 Fencing Token Test

If lock protects external resource, test fencing.

```text
Client A gets token 10
Client A pauses
Lock expires
Client B gets token 11
Client B writes with token 11
Client A resumes and tries write with token 10
External resource rejects token 10
```

If external resource does not check fencing token, Redis lock alone is not enough.

---

## 18. Testing Lua Scripts

Lua scripts should be tested as production artifacts.

Test categories:

1. happy path,
2. missing key,
3. wrong type,
4. boundary values,
5. concurrent calls,
6. cluster key discipline,
7. script return shape,
8. deterministic behavior.

Example safe unlock script:

```lua
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
```

Test:

```java
@Test
void unlockScriptDeletesOnlyMatchingToken() {
    String key = keys.lock("resource-1");
    redisTemplate.opsForValue().set(key, "token-a");

    Long wrong = executeUnlockScript(key, "token-b");
    assertEquals(0L, wrong);
    assertEquals("token-a", redisTemplate.opsForValue().get(key));

    Long correct = executeUnlockScript(key, "token-a");
    assertEquals(1L, correct);
    assertNull(redisTemplate.opsForValue().get(key));
}
```

Script contract should be stable:

```text
return 0 = not applied
return 1 = applied
return negative/error code = business-specific rejection
```

Avoid scripts returning ambiguous arrays without a typed wrapper in Java.

---

## 19. Testing Redis Streams Consumer

Redis Streams consumer test must cover more than `XADD` and `XREADGROUP`.

Important cases:

1. consumer receives message,
2. processing success leads to `XACK`,
3. processing failure does not ACK,
4. pending message can be claimed,
5. duplicate delivery is idempotent,
6. trimming does not remove unprocessed required data unexpectedly,
7. consumer restart resumes correctly.

### 19.1 Success ACK

```java
@Test
void successfulProcessingAcknowledgesMessage() {
    String stream = keys.stream("orders");
    streamTestSupport.createGroup(stream, "workers");

    RecordId id = streamTestSupport.add(stream, Map.of("orderId", "o-1"));

    consumer.pollOnce();

    PendingSummary pending = streamTestSupport.pending(stream, "workers");
    assertEquals(0, pending.getTotalPendingMessages());

    verify(orderHandler).handle("o-1");
}
```

### 19.2 Failure Leaves Pending

```java
@Test
void failedProcessingLeavesMessagePending() {
    doThrow(new RuntimeException("boom"))
            .when(orderHandler).handle("o-1");

    streamTestSupport.add(stream, Map.of("orderId", "o-1"));

    assertThrows(RuntimeException.class, () -> consumer.pollOnce());

    PendingSummary pending = streamTestSupport.pending(stream, "workers");
    assertEquals(1, pending.getTotalPendingMessages());
}
```

### 19.3 Claim Abandoned Message

Test flow:

```text
Consumer A reads message
Consumer A crashes before ACK
Message remains pending
Consumer B claims after idle timeout
Consumer B processes and ACKs
```

This is the essence of testing Redis Streams reliability.

---

## 20. Testing Pub/Sub

Pub/Sub test must account for subscription timing.

Bad test:

```java
publisher.publish("channel", "hello");
assertEquals("hello", listener.lastMessage());
```

This can fail because listener may not be subscribed yet.

Better:

```java
@Test
void subscriberReceivesMessageAfterSubscriptionReady() throws Exception {
    CountDownLatch subscribed = listener.subscribedLatch();
    CountDownLatch received = listener.receivedLatch();

    listenerContainer.addMessageListener(listener, new ChannelTopic("cache-events"));

    assertTrue(subscribed.await(2, TimeUnit.SECONDS));

    redisTemplate.convertAndSend("cache-events", "invalidate:user:1");

    assertTrue(received.await(2, TimeUnit.SECONDS));
    assertEquals("invalidate:user:1", listener.lastMessage());
}
```

Also test disconnect semantics if your system relies on Pub/Sub.

Remember:

```text
Pub/Sub messages sent while subscriber is offline are lost.
```

Your test should make that explicit if the behavior matters.

---

## 21. Testing Serialization Compatibility

Redis value schema evolves. Java classes evolve. Bugs happen when old cached values meet new code.

Avoid Java native serialization for long-lived values. Prefer explicit JSON/MessagePack/Protobuf-like contracts if needed.

Test backward compatibility:

```java
@Test
void canReadPreviousVersionOfCachedUserProfile() {
    String oldJson = """
        {"id":"user-1","displayName":"Alya"}
        """;

    redisTemplate.opsForValue().set(keys.userProfile("user-1"), oldJson);

    UserProfile profile = userProfileCache.get("user-1").orElseThrow();

    assertEquals("user-1", profile.id());
    assertEquals("Alya", profile.displayName());
}
```

Test unknown fields:

```java
@Test
void ignoresUnknownFieldsFromFutureSchema() {
    String futureJson = """
        {"id":"user-1","displayName":"Alya","newField":"future"}
        """;

    redisTemplate.opsForValue().set(keys.userProfile("user-1"), futureJson);

    assertDoesNotThrow(() -> userProfileCache.get("user-1"));
}
```

Test missing fields:

```java
@Test
void handlesMissingOptionalFields() {
    String oldJson = "{" +
            "\"id\":\"user-1\"" +
            "}";

    redisTemplate.opsForValue().set(keys.userProfile("user-1"), oldJson);

    UserProfile profile = userProfileCache.get("user-1").orElseThrow();

    assertEquals("user-1", profile.id());
}
```

---

## 22. Testing Error Handling: Redis Down

Every Redis usage must have failure policy.

Possible policies:

```text
Cache read fails      → bypass Redis and query DB
Cache write fails     → log metric, continue
Rate limiter fails    → fail-open or fail-closed depending risk
Idempotency fails     → usually fail-closed for money/side-effect operations
Lock fails            → do not enter critical section
Session Redis fails   → user may be logged out or request fails
Stream Redis fails    → worker backs off
```

Test these explicitly.

Example cache fail-open:

```java
@Test
void cacheReadFailureFallsBackToDatabase() {
    userProfileCache.simulateReadFailure();
    when(userRepository.findById("user-1"))
            .thenReturn(Optional.of(new UserProfile("user-1", "Alya")));

    UserProfile result = service.getUserProfile("user-1");

    assertEquals("Alya", result.displayName());
    verify(metrics).increment("redis.cache.read.error");
}
```

Example limiter fail-closed:

```java
@Test
void limiterFailureRejectsSensitiveOperation() {
    rateLimiter.simulateRedisTimeout();

    assertThrows(ServiceUnavailableException.class,
            () -> service.performSensitiveOperation("user-1"));
}
```

The same Redis failure can have different correct behavior depending use case.

---

## 23. Failure Injection with Container Stop/Start

With Testcontainers, you can stop Redis during test.

```java
@Test
void serviceHandlesRedisRestart() {
    assertTrue(redis.isRunning());

    redis.stop();

    assertThrows(RedisConnectionFailureException.class,
            () -> redisTemplate.opsForValue().get("x"));

    redis.start();

    awaitUntil(Duration.ofSeconds(10), () -> {
        try {
            redisTemplate.opsForValue().set("x", "y");
            return "y".equals(redisTemplate.opsForValue().get("x"));
        } catch (Exception e) {
            return false;
        }
    });
}
```

Caveat:

- some clients cache connection state,
- Spring context may need reconnection configuration,
- restart test can be slower,
- do not run heavy failure tests in every unit suite.

Put them in integration/chaos profile.

---

## 24. Testing Timeout Behavior

Timeout handling is often more important than Redis correctness.

Bad behavior:

```text
Redis stalls for 5 seconds
Tomcat/Netty threads pile up
connection pool exhausts
service becomes unavailable
```

Test expectations:

- command timeout is bounded,
- failure is mapped to domain policy,
- retry is controlled,
- metrics are emitted,
- caller receives acceptable error.

You can simulate slow Redis with:

- Toxiproxy,
- network shaping,
- blocking command isolation,
- Lua script that consumes time in controlled test environment,
- custom fake adapter for unit-level timeout policy.

Unit-level timeout policy test:

```java
@Test
void redisTimeoutIsMappedToCacheMissForNonCriticalCache() {
    when(cache.get("user-1")).thenThrow(new RedisTimeoutException("timeout"));
    when(repository.findById("user-1")).thenReturn(Optional.of(profile));

    UserProfile result = service.getUserProfile("user-1");

    assertEquals(profile, result);
    verify(metrics).increment("redis.timeout", Tags.of("operation", "cache_get"));
}
```

Integration-level network toxicity can be added for critical systems.

---

## 25. Testing Eviction Behavior

Eviction is often ignored until production.

If Redis is configured with `maxmemory` and eviction policy, you need tests or at least staging drills.

What to test:

1. application handles missing cache keys,
2. required keys are not stored in an eviction-prone Redis DB,
3. critical state uses `noeviction` or separate Redis,
4. metric/alert fires when eviction occurs.

A local eviction test can configure Redis:

```text
maxmemory 10mb
maxmemory-policy allkeys-lru
```

Then fill keys until eviction and assert:

- service still works for cache use case,
- eviction metric increases,
- no required idempotency/lock/session keys are in same unsafe namespace.

Design rule:

```text
Do not test your way out of an unsafe Redis memory policy.
Use separate Redis/database/namespace for different durability and eviction requirements.
```

---

## 26. Testing Redis Cluster Key Discipline

If production uses Redis Cluster, tests should catch cross-slot mistakes.

Example key pair requiring same slot:

```text
limiter:{tenant-1}:counter
limiter:{tenant-1}:metadata
```

Both share hash tag `{tenant-1}`.

Contract test:

```java
@Test
void relatedLimiterKeysShareHashTag() {
    String counter = keys.limiterCounter("tenant-1", "api-a");
    String metadata = keys.limiterMetadata("tenant-1", "api-a");

    assertTrue(counter.contains("{tenant-1}"));
    assertTrue(metadata.contains("{tenant-1}"));
}
```

Better: use a CRC16 slot calculator in test utility.

```java
@Test
void multiKeyOperationKeysMustBeInSameSlot() {
    assertEquals(redisSlot(keys.a("tenant-1")), redisSlot(keys.b("tenant-1")));
}
```

If you only run standalone Redis in tests, cross-slot issues may only appear in production. For cluster-heavy systems, add Redis Cluster integration tests or at least slot contract tests.

---

## 27. Testing Sentinel/Failover Behavior

For Sentinel deployments, test:

- client can connect through Sentinel,
- primary discovery works,
- failover is tolerated,
- writes after failover go to new primary,
- retry policy does not duplicate side effects.

Full Sentinel integration tests are heavier, but valuable for critical systems.

Basic scenario:

```text
Start primary + replica + sentinels
Write key
Kill primary
Wait for failover
Write new key
Read from new primary
Assert service recovers within SLO
```

For many teams, this belongs in nightly/staging tests rather than every pull request.

---

## 28. Testing Persistence and Recovery

If Redis is source of truth or semi-durable state, test recovery.

Cases:

1. RDB snapshot recovery,
2. AOF recovery,
3. restart after writes,
4. restart during write load,
5. corrupted/incomplete data handling,
6. expected data loss window.

Example conceptual test:

```text
Start Redis with AOF enabled
Write idempotency completed state
Stop Redis gracefully
Start Redis with same volume
Assert completed state exists
```

For cache-only Redis, persistence recovery may be unnecessary. But then your system must tolerate empty Redis after restart.

Test that too:

```java
@Test
void serviceWorksWhenCacheIsEmptyAfterRedisRestart() {
    redisTemplate.getConnectionFactory().getConnection().serverCommands().flushDb();

    when(repository.findById("user-1")).thenReturn(Optional.of(profile));

    assertEquals(profile, service.getUserProfile("user-1"));
}
```

---

## 29. Testing Key Growth

Redis incidents often come from unbounded key growth.

Test key lifecycle:

- every temporary key has TTL,
- keys are deleted after completion if required,
- stream trimming works,
- dedupe windows expire,
- rate limiter keys expire,
- idempotency keys expire.

Contract test:

```java
@Test
void allTemporaryKeysCreatedByOperationHaveTtl() {
    operation.execute("tenant-1", "req-1");

    Set<String> keys = redisTestSupport.scan("app:{tenant-1}:*");

    for (String key : keys) {
        if (isTemporaryKey(key)) {
            assertTrue(redisTemplate.getExpire(key, TimeUnit.SECONDS) > 0,
                    "temporary key has no TTL: " + key);
        }
    }
}
```

Do not use `KEYS` in production. In tests with dedicated Redis, `KEYS` may be acceptable, but using `SCAN` trains safer habits.

---

## 30. Testing Observability

Redis-backed behavior must emit metrics.

Test that metrics are not forgotten:

- cache hit,
- cache miss,
- cache load error,
- Redis timeout,
- limiter allow/deny,
- lock acquired/failed,
- stream processed/failed/acked,
- Lua script rejected,
- serialization error.

Example:

```java
@Test
void cacheMissEmitsMetric() {
    when(repository.findById("user-1")).thenReturn(Optional.of(profile));

    service.getUserProfile("user-1");

    assertThat(meterRegistry.counter("cache.requests",
            "cache", "user-profile",
            "result", "miss").count()).isEqualTo(1.0);
}
```

If no metric is tested, metric names often drift or disappear during refactor.

---

## 31. Testing Retry Safety

Retries against Redis can duplicate behavior if not designed carefully.

Safe-ish retries:

- cache read,
- cache write best effort,
- idempotent `SET key value`,
- read-only command.

Dangerous retries:

- `INCR`,
- `XADD`,
- queue push,
- limiter consume,
- lock acquire followed by side effect,
- Lua script with non-idempotent mutation.

Test retry behavior:

```java
@Test
void retryDoesNotDoubleConsumeQuota() {
    redisFaultInjector.failAfterCommandAppliedOnce("quota-consume");

    QuotaDecision decision = quotaService.consume("user-1");

    assertTrue(decision.allowed());
    assertEquals(1, quotaStore.used("user-1"));
}
```

This test is hard to implement with real Redis because “command applied but response lost” is a network-level failure. But the scenario must be represented in design tests or fault-injection tests.

Mental model:

```text
The hardest Redis failure is not "command failed".
The hardest failure is "command may have succeeded but client did not receive response".
```

---

## 32. Testing Backpressure

Redis failure can create upstream pressure:

- thread pool saturation,
- connection pool wait,
- request queue growth,
- DB overload after cache bypass,
- stream consumer lag.

Backpressure tests should verify:

- bounded executor queues,
- bounded Redis command timeout,
- circuit breaker behavior,
- fallback limits,
- DB protection during cache outage.

Example cache outage test:

```text
Given Redis cache is down
And 1000 requests hit same key
Then service must not send 1000 DB queries concurrently
```

This may require request coalescing or local in-process protection.

---

## 33. Testing with Spring Data Redis

Spring Data Redis introduces its own abstractions:

- `RedisTemplate`,
- serializers,
- transaction support,
- repositories,
- cache abstraction,
- listener container,
- reactive template.

Test configuration explicitly.

### 33.1 Serializer Test

```java
@Test
void redisTemplateUsesStringKeysAndJsonValues() {
    assertInstanceOf(StringRedisSerializer.class, redisTemplate.getKeySerializer());
    assertInstanceOf(GenericJackson2JsonRedisSerializer.class, redisTemplate.getValueSerializer());
}
```

### 33.2 Cache TTL Test

If using Spring Cache:

```java
@Test
void springCacheEntryHasConfiguredTtl() {
    service.getUserProfile("user-1");

    String redisKey = "user-profile::user-1";
    Long ttl = redisTemplate.getExpire(redisKey, TimeUnit.SECONDS);

    assertTrue(ttl > 0);
    assertTrue(ttl <= 3600);
}
```

### 33.3 Avoid Invisible Cache Behavior

Spring `@Cacheable` can hide Redis behavior from service code.

Test:

- generated key,
- null handling,
- TTL,
- cache name,
- cache invalidation with `@CacheEvict`,
- behavior on exception.

---

## 34. Testing Reactive Redis

Reactive Redis tests must avoid blocking accidentally.

With Reactor:

```java
@Test
void reactiveCacheReturnsValue() {
    StepVerifier.create(cache.put("k", "v").then(cache.get("k")))
            .expectNext("v")
            .verifyComplete();
}
```

Test timeout:

```java
@Test
void reactiveRedisTimeoutMapsToFallback() {
    StepVerifier.create(service.getUserProfile("user-1"))
            .expectNextMatches(profile -> profile.id().equals("user-1"))
            .verifyComplete();
}
```

Reactive test pitfalls:

- calling `.block()` inside production reactive pipeline,
- not verifying completion,
- ignoring backpressure,
- not testing scheduler/thread behavior,
- not testing cancellation.

---

## 35. Test Data Management

Redis test data should be explicit.

Good:

```java
redisTemplate.opsForValue().set(keys.userProfile("user-1"), jsonProfile);
```

Bad:

```java
// assumes previous test has inserted user-1
```

Rules:

1. each test creates its own keys,
2. each test can run independently,
3. each test can run in random order,
4. cleanup is safe,
5. no shared mutable Redis state unless intentionally testing concurrency.

---

## 36. Production-Like Test Matrix

A strong Redis test plan maps use case to tests.

| Redis Usage | Must-Have Tests |
|---|---|
| Cache | hit, miss, TTL, negative cache, Redis down, stampede |
| Rate limiter | limit boundary, concurrency, TTL, Lua atomicity, dimensions |
| Idempotency | first request, duplicate in-progress, replay completed, fingerprint conflict, TTL expiry |
| Lock | acquire, contention, token unlock, expiry, fencing scenario |
| Stream | read, ack, failure pending, claim, duplicate processing, trimming |
| Pub/Sub | subscriber ready, message received, offline loss behavior |
| Session | TTL refresh, logout delete, Redis down behavior, serialization compatibility |
| Deduplication | duplicate rejected, window expiry, memory growth |
| Delay queue | due ordering, claim race, retry, poison item |
| Search/JSON | index creation, query result, schema evolution, fallback |

---

## 37. CI Strategy

Not every Redis test should run with same frequency.

### Pull Request Suite

Run:

- unit tests,
- key schema tests,
- serializer tests,
- core Redis integration tests,
- Lua script tests,
- important concurrency tests with modest scale.

### Nightly Suite

Run:

- heavier concurrency,
- load-ish tests,
- failover tests,
- Redis restart tests,
- memory/eviction tests,
- stream recovery tests.

### Staging / Pre-Production

Run:

- Sentinel/Cluster failover,
- backup/restore drill,
- upgrade compatibility,
- long-running soak,
- traffic replay if available.

---

## 38. Example Redis Test Support Utility

A small support layer makes tests cleaner.

```java
public class RedisTestSupport {
    private final StringRedisTemplate redis;

    public RedisTestSupport(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public void deleteByPrefix(String prefix) {
        ScanOptions options = ScanOptions.scanOptions()
                .match(prefix + "*")
                .count(1000)
                .build();

        try (Cursor<byte[]> cursor = redis.getConnectionFactory()
                .getConnection()
                .scan(options)) {
            List<String> keys = new ArrayList<>();
            while (cursor.hasNext()) {
                keys.add(new String(cursor.next(), StandardCharsets.UTF_8));
            }
            if (!keys.isEmpty()) {
                redis.delete(keys);
            }
        }
    }

    public void assertHasTtl(String key) {
        Long ttl = redis.getExpire(key, TimeUnit.SECONDS);
        assertNotNull(ttl, "TTL is null for key " + key);
        assertTrue(ttl > 0, "Key has no positive TTL: " + key);
    }

    public void assertType(String key, DataType expected) {
        assertEquals(expected, redis.type(key));
    }
}
```

Be careful: `scan` in tests is okay for dedicated Redis. In production, SCAN still has operational cost and should be used carefully.

---

## 39. Common Testing Anti-Patterns

### 39.1 Mocking Redis and Claiming Integration Coverage

Mock proves your mock setup, not Redis behavior.

### 39.2 Sleeping Too Much

Long sleeps make CI slow. Use polling with timeout.

### 39.3 Assuming TTL Exactness

TTL is time-dependent. Use ranges.

### 39.4 Running Tests Against Shared Redis

Dangerous and flaky. Use isolated Redis container.

### 39.5 Testing Only Happy Path

Redis failures are where most real incidents live.

### 39.6 Ignoring Serialization Evolution

Cached values can outlive deployment boundaries.

### 39.7 No Concurrency Tests for Atomicity

Atomicity bugs rarely appear in sequential tests.

### 39.8 No Key Schema Tests

String concatenation bugs become production data bugs.

### 39.9 No Observability Tests

Metrics disappear silently during refactor.

### 39.10 Treating Cache Tests as Less Important

Bad cache behavior can overload the source of truth and trigger cascading failure.

---

## 40. Redis Testing Checklist

Use this checklist during design review.

### Key Contract

- [ ] Key naming is centralized.
- [ ] Key namespace includes app/domain ownership.
- [ ] Redis Cluster hash tags are intentional.
- [ ] Temporary keys have TTL.
- [ ] Shared keys have documented type and schema.

### Value Contract

- [ ] Serializer is explicit.
- [ ] Old values can still be read.
- [ ] Unknown future fields are tolerated if needed.
- [ ] Corrupt value behavior is defined.
- [ ] Large value limit is tested or enforced.

### Cache Contract

- [ ] Hit avoids source-of-truth call.
- [ ] Miss loads and stores.
- [ ] Negative cache behavior is tested.
- [ ] TTL is tested.
- [ ] Stampede protection is tested if required.
- [ ] Redis failure policy is tested.

### Atomicity Contract

- [ ] Limiter concurrency tested.
- [ ] Idempotency duplicate tested.
- [ ] Lock contention tested.
- [ ] Lua script tested with boundary cases.
- [ ] Retry ambiguity considered.

### Runtime Contract

- [ ] Redis down behavior tested.
- [ ] Timeout behavior tested.
- [ ] Reconnect behavior tested if critical.
- [ ] Eviction/missing key behavior tested.
- [ ] Stream recovery tested if using Streams.

### Observability Contract

- [ ] Hit/miss metrics tested.
- [ ] Error metrics tested.
- [ ] Timeout metrics tested.
- [ ] Limiter deny metrics tested.
- [ ] Stream lag/pending metrics considered.

---

## 41. Practical Design Rule

For every Redis usage, write this before coding:

```text
Redis is used for: <purpose>
Correctness requirement: <strict / best-effort / advisory>
If Redis is empty: <behavior>
If Redis is down: <behavior>
If Redis is slow: <behavior>
If key expires early/late: <behavior>
If command succeeds but response is lost: <behavior>
If value schema is old: <behavior>
If concurrent requests happen: <behavior>
Tests proving this: <list>
```

Example:

```text
Redis is used for: user profile cache
Correctness requirement: best-effort stale-tolerant cache
If Redis is empty: load from PostgreSQL
If Redis is down: bypass cache, rate-limit DB fallback
If Redis is slow: timeout after 50ms and fallback
If key expires early/late: acceptable within 15 minutes
If command succeeds but response is lost: safe, cache write is best-effort
If value schema is old: ignore unknown/missing optional fields
If concurrent requests happen: coalesce hot-key miss
Tests proving this: cache hit/miss, TTL, negative cache, Redis down, stampede
```

This transforms Redis from “implementation detail” into an explicit architecture contract.

---

## 42. Mini Lab: Build a Test Suite for Idempotent Payment Command

Scenario:

```text
POST /payments
Idempotency-Key: req-123
```

Requirements:

1. first request executes payment,
2. duplicate in progress does not execute payment again,
3. duplicate completed request returns same response,
4. same key with different body returns conflict,
5. Redis timeout before starting fails closed,
6. completion response is stored with TTL,
7. expired idempotency key allows new request,
8. concurrent same-key requests produce one side effect.

Recommended tests:

```text
PaymentIdempotencyUnitTest
PaymentIdempotencyRedisIntegrationTest
PaymentIdempotencyConcurrencyTest
PaymentIdempotencyFailurePolicyTest
PaymentIdempotencySerializationCompatibilityTest
```

Key schema:

```text
payment:{tenantId}:idem:{idempotencyKey}
```

Value schema:

```json
{
  "state": "STARTED | COMPLETED",
  "fingerprint": "sha256-body-hash",
  "startedAt": "2026-06-20T10:15:00Z",
  "completedAt": "2026-06-20T10:15:01Z",
  "response": {
    "paymentId": "pay_123",
    "status": "ACCEPTED"
  }
}
```

This lab combines many Redis testing skills:

- `SET NX EX`,
- Lua compare/update,
- TTL,
- concurrency,
- serialization,
- failure policy,
- side-effect safety.

---

## 43. Summary

Testing Redis-backed systems requires more than checking whether Redis stores values.

The central question is:

> Does the application remain correct when Redis behaves like a real distributed dependency: fast most of the time, unavailable sometimes, slow occasionally, lossy under eviction, eventually expiring keys, and ambiguous during network failure?

Key takeaways:

1. Treat Redis usage as a behavioral contract.
2. Use unit tests for pure policy logic.
3. Use Testcontainers or real Redis for command semantics.
4. Test key schema, type, TTL, and serialization compatibility.
5. Test concurrency for limiter, lock, idempotency, queue, and stream behavior.
6. Test Redis down/slow behavior explicitly.
7. Test observability so production debugging is possible.
8. Avoid over-mocking Redis.
9. Use polling rather than brittle sleeps for expiration tests.
10. Separate PR tests, nightly tests, and staging failover drills.

Redis mastery is not only knowing commands. It is knowing what must be proven before Redis-backed behavior can be trusted in production.

---

## 44. Status Seri

```text
Part 030 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-031.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Operations: Backup, Upgrade, Migration, Disaster Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-031.md">Part 031 — Redis Design Patterns for Backend Systems ➡️</a>
</div>
