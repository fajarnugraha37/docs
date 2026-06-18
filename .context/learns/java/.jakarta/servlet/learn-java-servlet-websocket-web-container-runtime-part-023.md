# Part 023 — WebSocket Session, Concurrency, and State Management

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> File: `learn-java-servlet-websocket-web-container-runtime-part-023.md`  
> Rentang Java: Java 8 sampai Java 25  
> Fokus: Jakarta/Javax WebSocket session, concurrency, registry, user mapping, slow client, cluster state, presence, dan failure modelling.

---

## 0. Posisi Part Ini di Dalam Seri

Pada part sebelumnya kita sudah membahas **Jakarta WebSocket Server Endpoint Model**:

- `@ServerEndpoint`
- `@OnOpen`
- `@OnMessage`
- `@OnClose`
- `@OnError`
- `Session`
- encoder/decoder
- configurator
- programmatic endpoint
- subprotocol
- hubungan endpoint dengan container

Part ini naik satu level: bukan lagi “bagaimana endpoint dibuat”, tetapi **bagaimana koneksi WebSocket dikelola sebagai stateful runtime object**.

Dalam aplikasi nyata, WebSocket jarang berdiri hanya sebagai:

```java
@OnMessage
public String echo(String message) {
    return message;
}
```

Aplikasi nyata perlu menjawab pertanyaan seperti:

- User A sedang punya berapa koneksi aktif?
- Kalau user login dari 3 tab browser, semuanya dikirim message atau hanya satu?
- Kalau user pindah node karena reconnect, registry lama dibersihkan atau tidak?
- Kalau client lambat membaca, apakah server menumpuk memory?
- Kalau message dikirim bersamaan dari beberapa thread, apakah urutannya masih benar?
- Kalau satu node mati, bagaimana presence user diperbarui?
- Kalau broadcast ke 20.000 koneksi, apakah satu slow client bisa menahan semua?
- Kalau `@OnClose` tidak terpanggil karena network drop, kapan session dianggap mati?

Itulah fokus part ini.

---

## 1. Mental Model Utama: WebSocket Session Bukan HTTP Session

Istilah `Session` di WebSocket sering menipu karena namanya sama-sama “session”.

Ada minimal tiga konsep yang berbeda:

| Konsep | API | Arti | Lifecycle |
|---|---|---|---|
| HTTP session | `HttpSession` | Continuity state request/response HTTP | Biasanya berbasis cookie `JSESSIONID`, bisa bertahan lintas request |
| WebSocket session | `jakarta.websocket.Session` / `javax.websocket.Session` | Satu percakapan WebSocket antara dua endpoint | Dimulai setelah handshake sukses, selesai saat koneksi close/error |
| Business/user session | Domain model internal | Konsep login/user/device/tenant | Ditentukan aplikasi |

WebSocket `Session` adalah **connection conversation object**. Ia bukan otomatis identik dengan user login, bukan otomatis distributed, dan bukan otomatis aman disimpan selamanya.

### 1.1 Analogi yang Lebih Tepat

Bayangkan:

```text
HTTP session     = kartu pengenal user di gedung
WebSocket session = satu sambungan telepon aktif
User account     = orang yang memiliki identitas
Browser tab      = satu alat komunikasi yang dipakai orang itu
Node server      = operator telepon tertentu
```

Satu user bisa punya beberapa “telepon” aktif:

```text
user-123
  ├── tab Chrome laptop      -> ws-session-A di node-1
  ├── tab Chrome laptop lain -> ws-session-B di node-1
  ├── mobile browser         -> ws-session-C di node-2
  └── reconnect lama ghost   -> ws-session-D mungkin belum terdeteksi mati
```

Kalau model state Anda hanya:

```java
Map<String, Session> userToSession;
```

maka Anda sudah membuat asumsi besar: **satu user hanya punya satu koneksi aktif**.

Kadang asumsi ini benar. Sering kali tidak.

---

## 2. `jakarta.websocket.Session`: Apa yang Sebenarnya Diwakili?

Setelah handshake berhasil, runtime WebSocket memberikan object `Session` kepada endpoint. Secara konseptual, object ini memuat:

- identity connection dari sisi server runtime,
- informasi URI/path parameter,
- query string,
- negotiated subprotocol,
- negotiated extensions,
- remote endpoint untuk mengirim message,
- konfigurasi timeout,
- max message size,
- user properties,
- status open/closed,
- set session yang terbuka dalam endpoint yang sama.

Contoh penggunaan dasar:

```java
@ServerEndpoint("/ws/notifications/{userId}")
public class NotificationSocket {

    @OnOpen
    public void onOpen(Session session, @PathParam("userId") String userId) {
        session.getUserProperties().put("userId", userId);
    }

    @OnMessage
    public void onMessage(Session session, String message) {
        String userId = (String) session.getUserProperties().get("userId");
        // handle message from user
    }

    @OnClose
    public void onClose(Session session, CloseReason reason) {
        // cleanup registry
    }
}
```

### 2.1 Apa yang Tidak Boleh Diasumsikan

Jangan asumsi bahwa `Session`:

- aman dipakai selamanya setelah close,
- thread-safe untuk semua operasi aplikasi Anda,
- bisa diserialisasi untuk cluster,
- otomatis merepresentasikan authenticated user,
- otomatis dibersihkan dari registry buatan Anda,
- otomatis memberi backpressure sehat untuk aplikasi,
- otomatis menjaga message ordering saat dikirim dari banyak thread.

`Session` adalah handle runtime. Ia perlu diperlakukan sebagai **resource**.

---

## 3. Lifecycle WebSocket Session sebagai State Machine

Untuk engineer tingkat lanjut, WebSocket harus dilihat sebagai state machine.

```text
              HTTP Upgrade Request
                       │
                       ▼
              HANDSHAKE_VALIDATING
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
        REJECTED             OPENING
                                 │
                                 ▼
                               OPEN
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
        CLIENT_CLOSE       SERVER_CLOSE        TRANSPORT_ERROR
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 ▼
                              CLOSING
                                 │
                                 ▼
                              CLOSED
                                 │
                                 ▼
                              CLEANED
```

Aplikasi Anda biasanya memiliki registry:

```text
OPEN    -> add to registry
CLOSING -> stop accepting new sends
CLOSED  -> remove from registry
CLEANED -> release app state
```

Bug besar muncul ketika state runtime dan state registry tidak sinkron:

```text
runtime session closed
but registry still contains session
```

Akibatnya:

- memory leak,
- ghost presence,
- broadcast mencoba mengirim ke connection mati,
- error log membanjir,
- user terlihat online padahal sudah offline,
- reconnect membuat duplicate session lama dan baru.

---

## 4. Endpoint Instance vs Session State

Pada annotated endpoint, runtime biasanya membuat endpoint instance sesuai aturan WebSocket implementation/spec. Banyak container memakai model satu endpoint instance per connection untuk annotated endpoint, tetapi engineer tidak boleh menggantungkan semua state penting hanya ke field endpoint tanpa memahami lifecycle.

Contoh yang terlihat aman:

```java
@ServerEndpoint("/ws/chat")
public class ChatEndpoint {
    private Session session;

    @OnOpen
    public void onOpen(Session session) {
        this.session = session;
    }
}
```

Untuk state yang benar-benar per connection, ini sering masuk akal.

Namun untuk registry global:

```java
private static final Set<Session> sessions = new HashSet<>(); // berbahaya
```

Ini berbahaya karena:

- `HashSet` tidak thread-safe,
- static state bisa menyebabkan classloader leak saat redeploy,
- session bisa lupa dihapus,
- tidak ada metadata user/device/tenant,
- tidak ada policy slow client,
- tidak cluster-aware.

Versi minimal lebih baik:

```java
private static final Set<Session> sessions = ConcurrentHashMap.newKeySet();
```

Tetapi ini masih hanya menyelesaikan thread-safety dasar, belum menyelesaikan lifecycle, cluster, backpressure, dan ownership.

---

## 5. Registry Session: Dari Naif ke Production-Ready

### 5.1 Registry Naif

```java
public final class NaiveSessionRegistry {
    private final Set<Session> sessions = ConcurrentHashMap.newKeySet();

    public void add(Session session) {
        sessions.add(session);
    }

    public void remove(Session session) {
        sessions.remove(session);
    }

    public void broadcast(String text) {
        for (Session session : sessions) {
            if (session.isOpen()) {
                session.getAsyncRemote().sendText(text);
            }
        }
    }
}
```

Ini cukup untuk demo, tetapi belum cukup untuk production.

Masalah:

- tidak tahu session milik siapa,
- tidak tahu tenant/role/channel,
- tidak tahu connection age,
- tidak tahu device/tab,
- tidak tahu slow send queue,
- tidak menghapus session saat send gagal,
- tidak punya metrics,
- tidak membedakan broadcast internal dan message user-specific,
- tidak ada deduplication.

### 5.2 Registry dengan Metadata

Lebih baik simpan wrapper milik aplikasi:

```java
public final class ClientConnection {
    private final String connectionId;
    private final String userId;
    private final String tenantId;
    private final String deviceId;
    private final Instant openedAt;
    private final Session session;
    private final AtomicBoolean closing = new AtomicBoolean(false);
    private final AtomicLong lastSeenAtMillis = new AtomicLong(System.currentTimeMillis());

    public ClientConnection(
            String connectionId,
            String userId,
            String tenantId,
            String deviceId,
            Instant openedAt,
            Session session
    ) {
        this.connectionId = connectionId;
        this.userId = userId;
        this.tenantId = tenantId;
        this.deviceId = deviceId;
        this.openedAt = openedAt;
        this.session = session;
    }

    public String connectionId() {
        return connectionId;
    }

    public String userId() {
        return userId;
    }

    public String tenantId() {
        return tenantId;
    }

    public Session session() {
        return session;
    }

    public boolean markClosing() {
        return closing.compareAndSet(false, true);
    }

    public boolean isClosing() {
        return closing.get();
    }

    public void touch() {
        lastSeenAtMillis.set(System.currentTimeMillis());
    }

    public long lastSeenAtMillis() {
        return lastSeenAtMillis.get();
    }
}
```

Registry:

```java
public final class WebSocketConnectionRegistry {

    private final ConcurrentMap<String, ClientConnection> byConnectionId = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Set<String>> connectionIdsByUserId = new ConcurrentHashMap<>();

    public void register(ClientConnection connection) {
        byConnectionId.put(connection.connectionId(), connection);
        connectionIdsByUserId
                .computeIfAbsent(connection.userId(), ignored -> ConcurrentHashMap.newKeySet())
                .add(connection.connectionId());
    }

    public void unregister(String connectionId) {
        ClientConnection removed = byConnectionId.remove(connectionId);
        if (removed == null) {
            return;
        }

        Set<String> ids = connectionIdsByUserId.get(removed.userId());
        if (ids != null) {
            ids.remove(connectionId);
            if (ids.isEmpty()) {
                connectionIdsByUserId.remove(removed.userId(), ids);
            }
        }
    }

    public List<ClientConnection> findByUserId(String userId) {
        Set<String> ids = connectionIdsByUserId.getOrDefault(userId, Set.of());
        List<ClientConnection> result = new ArrayList<>(ids.size());
        for (String id : ids) {
            ClientConnection connection = byConnectionId.get(id);
            if (connection != null) {
                result.add(connection);
            }
        }
        return result;
    }

    public int activeConnectionCount() {
        return byConnectionId.size();
    }
}
```

### 5.3 Kenapa Simpan ID, Bukan Langsung `Set<ClientConnection>`?

Karena lebih mudah menjaga indeks konsisten:

```text
primary index:
  connectionId -> ClientConnection

secondary index:
  userId -> Set<connectionId>
```

Ini memudahkan:

- remove by connection id,
- cleanup ghost connection,
- metrics per user,
- future expansion tenant/channel,
- compare-and-remove untuk mencegah race.

---

## 6. Mapping User ke Session: One-to-One, One-to-Many, atau Policy-Based?

Tidak ada satu desain yang selalu benar.

### 6.1 One User, One Connection

Model:

```text
userId -> connectionId
```

Cocok untuk:

- admin console internal,
- single-device policy,
- dashboard operator,
- sistem yang sengaja memaksa satu login aktif.

Risiko:

- tab kedua menimpa tab pertama,
- reconnect race bisa menutup koneksi baru,
- mobile + desktop tidak bisa aktif bersamaan,
- UX membingungkan.

### 6.2 One User, Many Connections

Model:

```text
userId -> Set<connectionId>
```

Cocok untuk:

- notification system,
- chat,
- dashboard multi-tab,
- user yang bisa login dari beberapa device.

Risiko:

- duplicate notification di banyak tab,
- message ack harus jelas per device atau per user,
- presence lebih kompleks,
- fan-out lebih mahal.

### 6.3 One User, Many Devices, Many Tabs

Model:

```text
userId
  -> deviceId
      -> Set<connectionId>
```

Cocok untuk:

- enterprise app,
- mobile + web,
- auditability,
- device management,
- security session listing.

Risiko:

- lebih banyak metadata,
- perlu device identity yang stabil,
- privacy/security harus diperhatikan.

### 6.4 Channel/Room-Based Registry

Model:

```text
roomId/topicId -> Set<connectionId>
```

Cocok untuk:

- chat room,
- collaborative editing,
- case room,
- live dashboard topic,
- workflow event subscriptions.

Di production biasanya registry bukan satu dimensi:

```text
connectionId -> connection
userId       -> connectionIds
tenantId     -> connectionIds
topicId      -> connectionIds
caseId       -> connectionIds
```

Tetapi semakin banyak indeks, semakin penting lifecycle cleanup.

---

## 7. Connection Identity: Jangan Mengandalkan `Session.getId()` Saja

`Session.getId()` berguna, tetapi sebaiknya aplikasi membuat `connectionId` sendiri.

Contoh:

```java
String connectionId = UUID.randomUUID().toString();
session.getUserProperties().put("connectionId", connectionId);
```

Kenapa?

- Anda bisa mengontrol format ID.
- Bisa masuk log correlation.
- Bisa dikirim ke client untuk debugging.
- Bisa dipakai sebagai key registry lintas layer.
- Bisa dibedakan dari ID internal container.
- Bisa digabung dengan node id.

Contoh format yang lebih operasional:

```text
node-3:01JZ6J7KQZ4R4BDKQY8MDQ0X1A
```

Atau:

```text
ws_20260617_node3_6f8c2a9e
```

Untuk distributed tracing, metadata minimal:

```text
connectionId
userId
tenantId
nodeId
endpointPath
clientIpHash
userAgentHash
openedAt
lastSeenAt
closeCode
closeReason
```

---

## 8. Sending Message: `BasicRemote` vs `AsyncRemote`

Jakarta WebSocket menyediakan dua remote endpoint utama:

```java
session.getBasicRemote()
session.getAsyncRemote()
```

### 8.1 `BasicRemote`

Karakteristik:

- operasi send bersifat blocking dari sudut pandang thread pemanggil,
- lebih mudah dipahami,
- failure bisa dilempar sebagai exception,
- berbahaya untuk broadcast besar atau slow client.

Contoh:

```java
try {
    session.getBasicRemote().sendText("hello");
} catch (IOException e) {
    // connection probably failed or send failed
}
```

Masalah:

```text
for every session:
    blocking send
```

Jika satu client lambat, thread broadcast bisa tertahan.

### 8.2 `AsyncRemote`

Karakteristik:

- send tidak memblokir sampai seluruh message terkirim,
- hasil diketahui lewat callback/future-like result,
- lebih cocok untuk fan-out,
- tetap perlu backpressure policy.

Contoh:

```java
session.getAsyncRemote().sendText("hello", result -> {
    if (!result.isOK()) {
        Throwable failure = result.getException();
        // mark connection unhealthy, close, or unregister
    }
});
```

`AsyncRemote` bukan berarti gratis. Ia bisa membuat queue internal. Kalau aplikasi mengirim lebih cepat daripada client/network mampu menerima, memory bisa tumbuh.

### 8.3 Rule of Thumb

| Situasi | Pilihan Awal |
|---|---|
| Message kecil, direct reply, low traffic | `BasicRemote` bisa cukup |
| Broadcast/fan-out | `AsyncRemote` |
| Slow client mungkin terjadi | `AsyncRemote` + queue limit + drop/close policy |
| Strict ordering per connection | single-writer queue per connection |
| Large binary stream | hati-hati, desain backpressure eksplisit |

---

## 9. Message Ordering: Masalah yang Sering Diremehkan

WebSocket di atas satu TCP connection menjaga ordering bytes. Tetapi di aplikasi Java, message bisa dikirim dari banyak thread.

Contoh berbahaya:

```java
void notifyUser(String userId, String message) {
    for (ClientConnection c : registry.findByUserId(userId)) {
        c.session().getAsyncRemote().sendText(message);
    }
}
```

Jika dua thread memanggil bersamaan:

```text
Thread A sends event-1
Thread B sends event-2
```

Anda harus bertanya:

- Apakah event-1 pasti sampai sebelum event-2?
- Apakah async send dipanggil paralel ke session yang sama aman menurut container yang dipakai?
- Apakah message business butuh urutan?
- Apakah client bisa mengurutkan ulang berdasarkan sequence number?

Untuk sistem serius, gunakan salah satu strategi:

1. **Single-writer per connection**
2. **Sequence number di message**
3. **Ordering per aggregate/topic, bukan global**
4. **Client-side reorder/drop stale message**

---

## 10. Single-Writer Queue per Connection

Untuk menjaga ordering dan mengendalikan slow client, buat satu queue outbound per connection.

```text
business events
      │
      ▼
per-connection outbound queue
      │
      ▼
single drain loop
      │
      ▼
session.getAsyncRemote().sendText(...)
```

Contoh sederhana:

```java
public final class OutboundConnection {
    private final Session session;
    private final ArrayBlockingQueue<String> queue;
    private final AtomicBoolean draining = new AtomicBoolean(false);
    private final AtomicBoolean closed = new AtomicBoolean(false);

    public OutboundConnection(Session session, int capacity) {
        this.session = session;
        this.queue = new ArrayBlockingQueue<>(capacity);
    }

    public boolean offer(String message) {
        if (closed.get() || !session.isOpen()) {
            return false;
        }
        boolean accepted = queue.offer(message);
        if (accepted) {
            drain();
        }
        return accepted;
    }

    private void drain() {
        if (!draining.compareAndSet(false, true)) {
            return;
        }
        sendNext();
    }

    private void sendNext() {
        String message = queue.poll();
        if (message == null) {
            draining.set(false);
            if (!queue.isEmpty()) {
                drain();
            }
            return;
        }

        session.getAsyncRemote().sendText(message, result -> {
            if (!result.isOK()) {
                closeSilently();
                return;
            }
            sendNext();
        });
    }

    public void closeSilently() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        queue.clear();
        try {
            if (session.isOpen()) {
                session.close(new CloseReason(
                        CloseReason.CloseCodes.TRY_AGAIN_LATER,
                        "connection closed by server"
                ));
            }
        } catch (IOException ignored) {
            // best-effort close
        }
    }
}
```

Ini belum final production code, tetapi memperlihatkan prinsip:

- ada batas queue,
- hanya satu drain aktif,
- message dikirim serial,
- send berikutnya menunggu callback sebelumnya,
- failure menutup koneksi atau menandai unhealthy.

### 10.1 Kenapa Queue Harus Bounded?

Karena unbounded queue artinya Anda memindahkan outage ke heap.

```text
client slow
server keeps sending
queue grows
heap grows
GC pressure rises
latency rises
more clients slow
server collapses
```

Bounded queue memaksa aplikasi memilih policy:

- drop newest,
- drop oldest,
- close connection,
- coalesce messages,
- send snapshot instead of event stream,
- apply backpressure upstream.

---

## 11. Slow Client: Salah Satu Musuh Terbesar WebSocket

Slow client adalah client yang tidak membaca secepat server mengirim.

Penyebab:

- jaringan lambat,
- browser tab background/throttled,
- mobile sleep,
- client JS blocked,
- proxy buffering/limit,
- device CPU rendah,
- server mengirim terlalu banyak.

### 11.1 Gejala Server

- outbound queue penuh,
- send callback lambat,
- memory naik,
- active connection tetap tinggi,
- message latency naik,
- broadcast job makin lama,
- thread pool terpakai untuk send/serialization,
- GC pressure meningkat.

### 11.2 Policy Slow Client

| Policy | Cocok Untuk | Risiko |
|---|---|---|
| Close connection | Data realtime, client bisa reconnect | UX disconnect |
| Drop newest | Client hanya perlu stabil | Update terbaru hilang |
| Drop oldest | Client perlu latest state | Event historis hilang |
| Coalesce | Dashboard/count/progress | Tidak cocok untuk event audit |
| Snapshot replace | State view | Butuh endpoint snapshot |
| Backpressure upstream | Pipeline terkendali | Kompleks lintas service |

Contoh coalescing:

```text
instead of queue:
  price changed 100 times
send:
  latest price snapshot
```

Untuk dashboard regulatory/case management, sering lebih baik:

```text
send invalidation event:
  "case-123 changed, refresh summary"
```

daripada mengirim semua perubahan detail.

---

## 12. Broadcast: Fan-Out Bukan Loop Biasa

Broadcast naif:

```java
for (Session s : sessions) {
    s.getAsyncRemote().sendText(payload);
}
```

Untuk 10 session, oke.

Untuk 10.000 session, pertanyaannya:

- payload diserialisasi ulang 10.000 kali atau sekali?
- slow client ditangani bagaimana?
- apakah semua session satu tenant atau semua tenant?
- apakah message relevan untuk semua user?
- apakah ada limit per tick?
- apakah broadcast bisa mengganggu inbound processing?
- apakah ada metrics fan-out latency?

### 12.1 Broadcast yang Lebih Sehat

```java
public final class Broadcaster {
    private final WebSocketConnectionRegistry registry;

    public void broadcastToTenant(String tenantId, String json) {
        List<ClientConnection> targets = registry.findByTenantId(tenantId);
        for (ClientConnection target : targets) {
            boolean accepted = target.outbound().offer(json);
            if (!accepted) {
                // metric: ws.outbound.dropped
                // maybe close slow connection
            }
        }
    }
}
```

Prinsip:

- pilih target tepat,
- serialize payload sekali bila mungkin,
- enqueue bounded,
- jangan blocking loop broadcast,
- emit metrics accepted/dropped/failed,
- jangan satu slow client menghambat semua.

### 12.2 Fan-Out Explosion

Misalnya:

```text
1000 case update/sec
x 5000 clients subscribed
= 5,000,000 delivery attempts/sec
```

Ini bukan masalah WebSocket API saja. Ini masalah desain event.

Solusi mungkin:

- topic partitioning,
- subscription filter,
- coalescing,
- debounce,
- snapshot pull,
- server-side aggregation,
- broker fan-out,
- edge gateway,
- rate limit per user/topic.

---

## 13. Presence: “Online” Itu Bukan Boolean Sederhana

Presence terlihat mudah:

```java
onlineUsers.add(userId);
```

Tapi realita:

```text
user online if at least one healthy connection exists
```

Dengan multi-tab/device:

```text
user online count = number of open connections? no.
user online = count(active healthy connections for user) > 0
```

### 13.1 Presence State Machine

```text
OFFLINE
   │ first connection open
   ▼
ONLINE
   │ no heartbeat for threshold
   ▼
SUSPECT
   │ heartbeat resumes         all connections closed/expired
   ├──────────────────────► ONLINE
   ▼
OFFLINE
```

Kenapa perlu `SUSPECT`?

Karena network disconnect tidak selalu menghasilkan close event tepat waktu.

### 13.2 Presence dengan TTL

Untuk cluster, gunakan TTL presence record:

```text
presence:user-123:connection-abc -> node-1, expires in 45s
```

Heartbeat refresh:

```text
every 15s refresh TTL
```

Jika node mati:

```text
TTL expires automatically
presence eventually removed
```

Ini lebih aman daripada mengandalkan `@OnClose` saja.

---

## 14. Heartbeat dan Last-Seen

WebSocket memiliki ping/pong control frame, tetapi aplikasi sering tetap butuh heartbeat level aplikasi.

### 14.1 Transport-Level Heartbeat

Tujuan:

- menjaga koneksi melewati idle timeout,
- mendeteksi dead peer,
- menghindari half-open connection.

### 14.2 Application-Level Heartbeat

Tujuan:

- memastikan user/session masih relevan,
- update presence,
- measure latency,
- detect tab paused,
- coordinate app-level reconnect.

Contoh message:

```json
{"type":"ping","ts":1710000000000}
```

Response:

```json
{"type":"pong","ts":1710000000000,"serverTime":1710000000123}
```

### 14.3 Heartbeat Interval

Jangan asal 1 detik.

Pertimbangkan:

- LB idle timeout,
- proxy timeout,
- mobile battery,
- number of clients,
- app realtime requirement,
- reconnect storm risk.

Contoh umum:

```text
heartbeat every 20-30 seconds
consider dead after 2-3 missed heartbeats
```

Tetapi angka final harus sesuai platform.

---

## 15. HTTP Session dan WebSocket Session: Bridging Identity dengan Hati-Hati

Saat handshake, WebSocket dimulai sebagai HTTP request upgrade. Pada momen itu aplikasi bisa membaca cookie/token/header dan memutuskan apakah koneksi boleh dibuka.

Setelah WebSocket terbuka, request/response HTTP biasa tidak lagi terjadi untuk message WebSocket.

### 15.1 Menyalin Identity ke WebSocket Session

Contoh via configurator:

```java
public class AuthenticatedConfigurator extends ServerEndpointConfig.Configurator {
    @Override
    public void modifyHandshake(
            ServerEndpointConfig config,
            HandshakeRequest request,
            HandshakeResponse response
    ) {
        Principal principal = request.getUserPrincipal();
        if (principal != null) {
            config.getUserProperties().put("principalName", principal.getName());
        }
    }
}
```

Endpoint:

```java
@ServerEndpoint(
        value = "/ws/notifications",
        configurator = AuthenticatedConfigurator.class
)
public class NotificationEndpoint {

    @OnOpen
    public void onOpen(Session session, EndpointConfig config) {
        String principalName = (String) config.getUserProperties().get("principalName");
        session.getUserProperties().put("principalName", principalName);
    }
}
```

### 15.2 Jangan Simpan `HttpSession` Mentah Sembarangan

Menyimpan reference langsung ke `HttpSession` di WebSocket user properties bisa membawa risiko:

- lifecycle tidak sama,
- session invalidated tapi WebSocket masih terbuka,
- memory retention,
- cluster serialization confusion,
- stale authorization.

Lebih aman simpan snapshot identity minimal:

```text
userId
tenantId
roles/version
authenticatedAt
sessionId hash
```

Lalu validasi ulang untuk operasi sensitif.

---

## 16. Authorization per Message

Handshake authentication hanya menjawab:

```text
boleh buka koneksi atau tidak?
```

Ia belum cukup menjawab:

```text
boleh kirim command ini atau tidak?
boleh subscribe topic ini atau tidak?
boleh broadcast ke case ini atau tidak?
```

Contoh message:

```json
{
  "type": "subscribe",
  "topic": "case:CASE-123"
}
```

Server harus cek:

```text
user has access to CASE-123?
```

Jangan hanya percaya client.

### 16.1 Subscription Registry

```text
connectionId -> subscribed topics
topicId      -> connectionIds
```

Saat user subscribe:

1. parse message,
2. validate schema,
3. authorize topic,
4. register subscription,
5. send ack.

Saat close:

1. remove connection,
2. remove all topic subscriptions,
3. update presence if needed.

---

## 17. Message Schema dan State

WebSocket biasanya membawa banyak jenis message.

Jangan jadikan `String` bebas tanpa envelope.

Gunakan envelope:

```json
{
  "id": "msg-001",
  "type": "case.status.changed",
  "version": 1,
  "sentAt": "2026-06-17T10:15:30Z",
  "payload": {
    "caseId": "CASE-123",
    "status": "UNDER_REVIEW"
  }
}
```

Keuntungan:

- bisa ack by id,
- bisa deduplicate,
- bisa evolve schema,
- bisa route by type,
- bisa log safely,
- bisa reject unsupported version,
- bisa apply authorization per type.

### 17.1 State Client dan Server Harus Sinkron?

Untuk banyak sistem, jangan memaksa WebSocket menjadi source of truth penuh.

Lebih aman:

```text
WebSocket = notification/invalidation channel
REST/JAX-RS/HTTP endpoint = authoritative read model
```

Contoh:

```json
{"type":"case.updated","caseId":"CASE-123","version":42}
```

Client lalu fetch detail:

```http
GET /api/cases/CASE-123
```

Ini mengurangi risiko:

- lost message,
- partial update,
- stale UI,
- large payload fan-out,
- replay complexity.

---

## 18. Cluster: Local Session Tidak Bisa Dipakai Langsung Lintas Node

WebSocket connection bersifat stateful dan melekat ke node tertentu.

```text
client A ───── WebSocket ───── node-1
client B ───── WebSocket ───── node-2
```

Jika business event muncul di node-3, node-3 tidak bisa langsung memanggil `Session` di node-1.

Butuh koordinasi.

### 18.1 Sticky Session

Load balancer bisa menjaga client WebSocket tetap ke node yang sama.

Sticky session membantu koneksi tetap stabil, tetapi tidak menyelesaikan problem fan-out cross-node.

### 18.2 Broker-Based Fan-Out

Model umum:

```text
business service publishes event
          │
          ▼
 Redis Pub/Sub / RabbitMQ / Kafka / JMS
          │
   ┌──────┼──────┐
   ▼      ▼      ▼
 node-1 node-2 node-3
   │      │      │
 local local local
 sessions sessions sessions
```

Setiap node menerima event, lalu mengirim ke local sessions yang relevan.

### 18.3 Redis Pub/Sub vs RabbitMQ vs Kafka

| Teknologi | Cocok Untuk | Catatan |
|---|---|---|
| Redis Pub/Sub | low-latency transient fan-out | message hilang jika subscriber down |
| Redis Streams | replay window ringan | perlu consumer management |
| RabbitMQ | routing, queueing, reliable delivery | lebih operasional, cocok command/event tertentu |
| Kafka | ordered durable event log | cocok high-throughput, replay, audit stream |
| DB polling | sederhana | latency dan DB load |

Untuk WebSocket notification, sering pola terbaik:

```text
durable domain event -> broker/log -> websocket nodes -> transient client delivery
```

Jangan mencampur:

```text
WebSocket delivery success == domain transaction success
```

Keduanya boundary berbeda.

---

## 19. Distributed Presence

Local registry hanya tahu connection di node sendiri.

```text
node-1 knows sessions on node-1
node-2 knows sessions on node-2
```

Untuk tahu user online secara global, perlu distributed presence store.

Contoh Redis key:

```text
ws:presence:{tenantId}:{userId}:{connectionId} = nodeId|openedAt|lastSeenAt
TTL = 60 seconds
```

Heartbeat refresh:

```java
presenceStore.refresh(tenantId, userId, connectionId, Duration.ofSeconds(60));
```

Global online check:

```text
exists ws:presence:tenant-a:user-123:* ?
```

### 19.1 Jangan Terlalu Presisi

Presence distributed hampir selalu **eventually consistent**.

Jangan desain business-critical invariant seperti:

```text
if user online then legally delivered
```

Presence hanya sinyal operasional, bukan bukti delivery formal.

Untuk domain regulasi, audit, atau legal delivery, gunakan mekanisme acknowledgment dan persisted delivery record.

---

## 20. WebSocket dan Delivery Semantics

Default WebSocket memberi Anda:

```text
connection-oriented ordered byte stream while connection is healthy
```

Ia tidak memberi otomatis:

- durable delivery,
- replay setelah reconnect,
- exactly-once,
- offline queue,
- cluster-wide routing,
- deduplication,
- message persistence.

Jika aplikasi butuh guarantee, tambahkan protokol aplikasi.

### 20.1 At-Most-Once

Server kirim, tidak peduli ack.

Cocok untuk:

- typing indicator,
- online presence,
- transient dashboard pulse.

### 20.2 At-Least-Once

Server simpan message, client ack, server retry jika belum ack.

Perlu:

- message id,
- persisted/outbox store,
- ack tracking,
- deduplication client.

### 20.3 Effectively-Once

Biasanya dicapai dengan:

- idempotent message id,
- monotonic sequence,
- deduplication,
- versioned aggregate,
- persisted state.

Bukan fitur native WebSocket.

---

## 21. Reconnect dan Duplicate Session

Reconnect selalu terjadi di dunia nyata.

Penyebab:

- network change,
- laptop sleep,
- mobile background,
- LB idle timeout,
- server restart,
- rolling deployment,
- proxy reset,
- browser refresh.

### 21.1 Race yang Umum

```text
T1 old connection still appears open on server
T2 client reconnects and opens new connection
T3 registry now has old + new
T4 old connection finally times out
```

Jika policy one-connection-per-user, hati-hati:

```java
old.close();
registry.put(userId, newConnection);
```

Race bisa menutup koneksi baru jika cleanup salah.

### 21.2 Connection Generation

Gunakan generation/session epoch:

```text
userId -> activeGeneration
connection has generation
```

Ketika reconnect:

```text
new generation > old generation
old cleanup must not remove new connection
```

Contoh compare-remove:

```java
public void unregisterOnlyIfSame(String userId, String connectionId) {
    currentByUser.computeIfPresent(userId, (ignored, current) -> {
        if (current.connectionId().equals(connectionId)) {
            return null;
        }
        return current;
    });
}
```

Prinsip penting:

```text
cleanup old connection must be conditional
```

---

## 22. Inbound Concurrency: `@OnMessage` Bukan Tempat Bebas Blocking

Inbound message bisa datang cepat.

Jika `@OnMessage` melakukan operasi berat:

```java
@OnMessage
public void onMessage(Session session, String json) {
    // parse large JSON
    // call database
    // call remote service
    // publish event
    // send response
}
```

Risiko:

- container thread tertahan,
- message processing backlog,
- timeout/close,
- ordering tidak jelas,
- user bisa DoS dengan spam message.

### 22.1 Pisahkan Inbound Pipeline

```text
@OnMessage
  parse minimal
  validate envelope
  rate-limit
  enqueue command
  return quickly

worker
  authorize
  process
  persist/publish
  respond/notify
```

Tetapi queue inbound juga harus bounded.

```java
boolean accepted = inboundQueue.offer(command);
if (!accepted) {
    closeWithPolicy(session, "server overloaded");
}
```

### 22.2 Rate Limit per Connection/User

Contoh policy:

```text
max 20 commands/sec per connection
max 100 subscriptions/user
max payload 64 KB
max pending inbound 50
```

Kalau tidak, satu user bisa menghabiskan resource node.

---

## 23. Shared Mutable State: Jangan Taruh Domain State Mentah di Endpoint

Anti-pattern:

```java
@ServerEndpoint("/ws/case/{caseId}")
public class CaseSocket {
    private static final Map<String, CaseState> caseStates = new ConcurrentHashMap<>();
}
```

Kenapa berbahaya?

- state node-local,
- hilang saat restart,
- tidak konsisten antar node,
- sulit diaudit,
- race dengan DB transaction,
- memory leak,
- redeploy leak.

Lebih sehat:

```text
WebSocket node-local state:
  connection registry
  subscription registry
  outbound queue
  transient presence

Durable domain state:
  database/event store/cache with clear invalidation
```

WebSocket layer sebaiknya menjadi **delivery edge**, bukan source of truth utama.

---

## 24. Memory Management WebSocket Runtime

WebSocket mengubah profil memory aplikasi.

HTTP request biasa:

```text
request arrives
process
response sent
objects eligible for GC
```

WebSocket:

```text
connection open for minutes/hours
per-connection objects retained
queues retained
subscriptions retained
metadata retained
buffers retained
```

### 24.1 Estimasi Memory

Misalnya:

```text
10,000 connections
x 20 KB app metadata/queue/buffer average
= 200 MB before container/network buffers
```

Kalau outbound queue bisa 100 message x 2 KB:

```text
10,000 x 100 x 2 KB = ~2 GB
```

Itu hanya queue payload.

### 24.2 Memory Budget per Connection

Tentukan budget:

```text
metadata <= 2 KB
queue max <= 32 messages
payload max <= 16 KB
subscriptions max <= 100
idle timeout <= 60 min
heartbeat <= 30 sec
```

Lalu ukur.

Tanpa budget, WebSocket mudah menjadi memory leak yang terlihat seperti “GC problem”.

---

## 25. Payload Size dan Serialization Cost

`String` JSON besar dikirim ke banyak client bisa mahal.

Masalah:

- serialization CPU,
- allocation besar,
- UTF-8 encoding,
- buffer copy,
- network throughput,
- browser parsing,
- GC pressure.

### 25.1 Serialize Once

Untuk broadcast message yang sama:

```java
String json = objectMapper.writeValueAsString(event);
for (ClientConnection c : targets) {
    c.outbound().offer(json);
}
```

Jangan serialize ulang di tiap connection.

### 25.2 Batasi Message

Contoh:

```text
max text message size: 64 KB
max binary message size: depends on use case
large file: do not send via WebSocket; use HTTP download/upload
```

WebSocket bukan pengganti object storage atau file transfer besar untuk mayoritas sistem enterprise.

---

## 26. Backpressure dari Client ke Domain Event

Pertanyaan sulit:

```text
Kalau client tidak mampu menerima event, apakah domain processing harus ikut berhenti?
```

Biasanya jawabannya: **tidak langsung**.

Domain event tetap terjadi. WebSocket delivery adalah projection/delivery channel.

Pola sehat:

```text
domain transaction commits
outbox event persisted
projection updates read model
websocket sends invalidation/update if client connected
client can catch up by pulling latest state
```

Dengan ini, slow WebSocket client tidak merusak domain transaction.

---

## 27. Close Handling: `@OnClose` Harus Idempotent

`@OnClose` bisa terpanggil dalam berbagai kondisi:

- client close normal,
- server close,
- network error,
- idle timeout,
- protocol error,
- deployment shutdown.

Cleanup harus idempotent.

```java
@OnClose
public void onClose(Session session, CloseReason reason) {
    String connectionId = (String) session.getUserProperties().get("connectionId");
    if (connectionId != null) {
        registry.unregister(connectionId);
    }
}
```

Jika cleanup bisa terpanggil dari `@OnError` juga:

```java
private void cleanup(Session session, String source) {
    String connectionId = (String) session.getUserProperties().get("connectionId");
    if (connectionId != null) {
        registry.unregister(connectionId);
    }
}
```

Registry `unregister` harus aman dipanggil berkali-kali.

---

## 28. `@OnError`: Jangan Asumsikan Session Masih Valid

Contoh:

```java
@OnError
public void onError(Session session, Throwable error) {
    // session may be null depending on failure point/runtime
}
```

Yang perlu dilakukan:

- log dengan connection id jika ada,
- jangan spam stacktrace untuk client disconnect normal,
- cleanup best-effort,
- close jika masih open dan error fatal,
- classify error.

Klasifikasi:

| Error | Perlakuan |
|---|---|
| Bad message schema | send error response atau close policy violation |
| Unauthorized command | reject message, maybe close |
| IOException send failure | mark connection unhealthy, cleanup |
| Decode error | close unsupported/bad payload |
| App exception | log, send server error envelope if possible |
| Client abort/network reset | low severity, cleanup |

---

## 29. Graceful Shutdown untuk WebSocket Sessions

Saat server rolling update, WebSocket connection harus didrain.

State machine shutdown:

```text
RUNNING
  │ readiness false
  ▼
DRAINING
  │ reject new connection
  │ notify existing clients
  │ wait grace period
  ▼
CLOSING_EXISTING
  │ close sessions with retry/restart code
  ▼
STOPPED
```

Contoh close reason:

```java
session.close(new CloseReason(
        CloseReason.CloseCodes.TRY_AGAIN_LATER,
        "server restarting"
));
```

Client harus punya reconnect with jitter.

```text
base delay 1s
max delay 30s
jitter random 0-30%
```

Tanpa jitter, rolling restart bisa menciptakan reconnect storm.

---

## 30. Observability: Metrics yang Wajib Ada

Minimal metrics:

```text
ws.connections.active
ws.connections.opened.total
ws.connections.closed.total
ws.connections.close.code
ws.connections.duration
ws.messages.inbound.total
ws.messages.outbound.total
ws.messages.outbound.failed.total
ws.messages.outbound.dropped.total
ws.messages.outbound.queue.size
ws.messages.outbound.queue.full.total
ws.send.latency
ws.heartbeat.missed.total
ws.presence.active.users
ws.subscriptions.active
ws.reconnect.estimated.total
```

Log fields:

```text
connectionId
userId hash / internal id
tenantId
nodeId
endpoint
remoteIp / forwardedIp
userAgent hash
openedAt
closeCode
closeReason
durationMs
inboundCount
outboundCount
droppedCount
lastSeenAt
```

### 30.1 Jangan Log Payload Sensitif

WebSocket payload sering berisi:

- chat,
- case data,
- user identity,
- token salah tempat,
- document metadata,
- regulatory status.

Log envelope metadata, bukan isi penuh.

---

## 31. Debugging Production Issues

### 31.1 User Tidak Menerima Notification

Check:

```text
1. Apakah user punya active connection?
2. Connection ada di node mana?
3. User subscribe topic yang benar?
4. Event dipublish ke broker?
5. Node penerima event benar?
6. Target filtering benar?
7. Outbound queue accepted atau dropped?
8. Send callback success atau failed?
9. Client menerima tapi reject schema?
10. Client reconnect dan kehilangan state?
```

### 31.2 User Terlihat Online Padahal Offline

Check:

```text
1. Registry cleanup on close berjalan?
2. @OnError juga cleanup?
3. TTL presence ada?
4. Heartbeat expired?
5. Node mati tanpa cleanup?
6. Old connection duplicated setelah reconnect?
7. Distributed presence key expired?
```

### 31.3 Memory Naik Terus

Check:

```text
1. sessions registry tidak berkurang?
2. outbound queue unbounded?
3. subscription index tidak dibersihkan?
4. userProperties menyimpan object besar?
5. static registry menahan old classloader?
6. send failure tidak unregister?
7. heartbeat task menahan reference session?
```

### 31.4 Broadcast Lambat

Check:

```text
1. BasicRemote blocking dipakai?
2. Serialization per connection?
3. Slow client menahan loop?
4. Queue penuh?
5. Payload terlalu besar?
6. Tenant/topic filtering buruk?
7. Broker consumer lag?
8. Network throughput limit?
```

---

## 32. Design Pattern: WebSocket Gateway Layer

Untuk sistem besar, jangan biarkan domain service langsung memegang `Session`.

Pisahkan:

```text
Domain Service
  │ publishes domain event
  ▼
Event Broker / Outbox
  │
  ▼
WebSocket Gateway
  ├── connection registry
  ├── subscription registry
  ├── presence manager
  ├── outbound queue manager
  ├── message encoder
  ├── authz checker
  └── metrics/logging
```

Keuntungan:

- domain logic tidak bergantung pada WebSocket API,
- WebSocket bisa scale horizontal,
- delivery failure tidak menggagalkan transaction,
- observability lebih jelas,
- testing lebih mudah,
- cluster fan-out lebih eksplisit.

---

## 33. Full Example Skeleton: Production-Oriented Notification Socket

### 33.1 Endpoint

```java
@ServerEndpoint(
        value = "/ws/notifications",
        configurator = NotificationSocketConfigurator.class
)
public class NotificationSocketEndpoint {

    private static NotificationRuntime runtime;

    public static void initialize(NotificationRuntime notificationRuntime) {
        runtime = notificationRuntime;
    }

    @OnOpen
    public void onOpen(Session session, EndpointConfig config) {
        AuthenticatedUser user = (AuthenticatedUser) config.getUserProperties().get("authenticatedUser");
        if (user == null) {
            close(session, CloseReason.CloseCodes.VIOLATED_POLICY, "unauthenticated");
            return;
        }

        String connectionId = runtime.newConnectionId();
        session.getUserProperties().put("connectionId", connectionId);
        session.getUserProperties().put("userId", user.userId());
        session.setMaxIdleTimeout(runtime.config().idleTimeoutMillis());
        session.setMaxTextMessageBufferSize(runtime.config().maxTextMessageSizeBytes());

        runtime.connections().register(session, connectionId, user);
    }

    @OnMessage
    public void onMessage(Session session, String json) {
        String connectionId = (String) session.getUserProperties().get("connectionId");
        if (connectionId == null) {
            close(session, CloseReason.CloseCodes.VIOLATED_POLICY, "missing connection id");
            return;
        }
        runtime.inbound().accept(connectionId, json);
    }

    @OnClose
    public void onClose(Session session, CloseReason reason) {
        cleanup(session, "close", reason);
    }

    @OnError
    public void onError(Session session, Throwable error) {
        if (session != null) {
            cleanup(session, "error", null);
        }
        runtime.metrics().recordError(error);
    }

    private void cleanup(Session session, String source, CloseReason reason) {
        Object id = session.getUserProperties().get("connectionId");
        if (id instanceof String connectionId) {
            runtime.connections().unregister(connectionId, source, reason);
        }
    }

    private static void close(Session session, CloseReason.CloseCode code, String reason) {
        try {
            if (session.isOpen()) {
                session.close(new CloseReason(code, reason));
            }
        } catch (IOException ignored) {
            // best effort
        }
    }
}
```

### 33.2 Runtime Composition

```java
public final class NotificationRuntime {
    private final WebSocketConnectionRegistry connections;
    private final InboundMessageService inbound;
    private final WebSocketMetrics metrics;
    private final WebSocketConfig config;
    private final String nodeId;

    public NotificationRuntime(
            WebSocketConnectionRegistry connections,
            InboundMessageService inbound,
            WebSocketMetrics metrics,
            WebSocketConfig config,
            String nodeId
    ) {
        this.connections = connections;
        this.inbound = inbound;
        this.metrics = metrics;
        this.config = config;
        this.nodeId = nodeId;
    }

    public String newConnectionId() {
        return nodeId + ":" + UUID.randomUUID();
    }

    public WebSocketConnectionRegistry connections() {
        return connections;
    }

    public InboundMessageService inbound() {
        return inbound;
    }

    public WebSocketMetrics metrics() {
        return metrics;
    }

    public WebSocketConfig config() {
        return config;
    }
}
```

Dalam Spring/CDI/Jakarta EE app, cara injection berbeda-beda. Intinya: endpoint tidak boleh menjadi tempat semua logic. Endpoint harus tipis.

---

## 34. Common Anti-Patterns

### 34.1 Static `Map<UserId, Session>`

Masalah:

- hanya satu session per user,
- memory leak,
- thread-safety kurang,
- classloader leak,
- cluster impossible.

### 34.2 Broadcast Pakai Blocking Send

```java
for (Session s : sessions) {
    s.getBasicRemote().sendText(message);
}
```

Satu slow client bisa menahan semua.

### 34.3 Tidak Ada Queue Limit

Unbounded queue mengubah slow client menjadi heap exhaustion.

### 34.4 Presence Berdasarkan `@OnOpen` dan `@OnClose` Saja

Network failure tidak selalu memberi close bersih.

### 34.5 Business Transaction Bergantung pada WebSocket Delivery

WebSocket adalah channel delivery, bukan commit protocol.

### 34.6 Tidak Ada Message Envelope

String bebas membuat versioning, ack, routing, dan debugging kacau.

### 34.7 Tidak Ada Authorization per Message

Handshake auth bukan authorization untuk semua topic/command.

### 34.8 Menyimpan Object Besar di `userProperties`

`userProperties` hidup selama connection. Simpan metadata kecil saja.

---

## 35. Checklist Desain WebSocket Session Production

Sebelum production, jawab ini:

### Identity

- [ ] Bagaimana user diambil saat handshake?
- [ ] Apakah satu user boleh banyak connection?
- [ ] Apakah device/tab dibedakan?
- [ ] Apakah connection ID dibuat aplikasi?

### Registry

- [ ] Ada primary index by connection ID?
- [ ] Ada secondary index by user/topic/tenant?
- [ ] Cleanup idempotent?
- [ ] Cleanup conditional untuk reconnect race?

### Sending

- [ ] Pakai `BasicRemote` atau `AsyncRemote` dengan alasan jelas?
- [ ] Ada single-writer queue jika ordering penting?
- [ ] Queue bounded?
- [ ] Slow client policy jelas?
- [ ] Send failure cleanup?

### Inbound

- [ ] Payload max size dibatasi?
- [ ] Message schema/envelope jelas?
- [ ] Rate limit per connection/user?
- [ ] Authorization per command/topic?
- [ ] Blocking work dipisah dari endpoint?

### Cluster

- [ ] Local vs distributed state dipisah?
- [ ] Broker fan-out tersedia jika multi-node?
- [ ] Presence pakai TTL?
- [ ] Sticky session/upgrade proxy dikonfigurasi?

### Reliability

- [ ] Heartbeat strategy ada?
- [ ] Reconnect strategy client ada?
- [ ] Duplicate connection handled?
- [ ] Delivery semantics ditentukan?
- [ ] Ack/replay hanya jika benar-benar dibutuhkan?

### Observability

- [ ] Active connection metrics?
- [ ] Open/close metrics by code?
- [ ] Queue size/drop metrics?
- [ ] Send latency/failure metrics?
- [ ] Connection ID masuk log?
- [ ] Payload sensitif tidak dilog?

---

## 36. Ringkasan Mental Model

WebSocket session adalah **stateful connection resource**, bukan sekadar object untuk `sendText()`.

Untuk menjadi engineer yang kuat di area ini, pikirkan WebSocket sebagai gabungan dari:

```text
connection lifecycle
+ user identity mapping
+ concurrency control
+ outbound backpressure
+ inbound admission control
+ distributed state boundary
+ transient delivery semantics
+ observability
+ graceful shutdown
```

Model buruk:

```text
static Set<Session> sessions
broadcast loop
hope @OnClose always runs
```

Model matang:

```text
connection registry with metadata
bounded outbound queue
single writer per connection if needed
message envelope and authorization
presence TTL
broker fan-out for cluster
idempotent cleanup
graceful drain
metrics and logs
```

WebSocket yang stabil bukan yang “bisa connect”. WebSocket yang stabil adalah yang tetap benar saat:

- client lambat,
- user buka banyak tab,
- reconnect race terjadi,
- node rolling restart,
- broker delay,
- message burst,
- connection mati tanpa close bersih,
- registry cleanup dipanggil dua kali,
- satu tenant punya ribuan active connection.

Itulah level berpikir yang membedakan implementasi demo dari implementasi production-grade.

---

## 37. Referensi

- Jakarta WebSocket 2.2 Specification — Jakarta EE 11 release.
- Jakarta WebSocket API documentation — `Session`, `RemoteEndpoint.Basic`, `RemoteEndpoint.Async`, `CloseReason`, `MessageHandler`.
- RFC 6455 — The WebSocket Protocol.
- Apache Tomcat WebSocket 2.2 API documentation.
- Jetty 12 WebSocket server documentation.

---

## 38. Status Seri

Part ini adalah **Part 023** dari rencana seri:

```text
learn-java-servlet-websocket-web-container-runtime
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 024 — WebSocket Reliability Patterns
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime — Part 022](./learn-java-servlet-websocket-web-container-runtime-part-022.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime — Part 024](./learn-java-servlet-websocket-web-container-runtime-part-024.md)
