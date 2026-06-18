# learn-java-servlet-websocket-web-container-runtime — Part 026
# Server-Sent Events, Long Polling, and Streaming Alternatives

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `026`  
> Topik: Server-Sent Events, Long Polling, HTTP Streaming, dan Alternatif Real-Time Delivery  
> Rentang Java: Java 8 sampai Java 25  
> API utama: Servlet 3.0+ async, `javax.servlet.*`, `jakarta.servlet.*`, browser `EventSource`, HTTP/1.1, HTTP/2, reverse proxy, load balancer

---

## 1. Tujuan Part Ini

Pada part sebelumnya, kita sudah membahas WebSocket dari sisi protokol, endpoint model, state management, reliability, dan security boundary. Tetapi engineer yang matang tidak otomatis memilih WebSocket setiap kali mendengar kata “real-time”.

Banyak kebutuhan real-time sebenarnya hanya membutuhkan **server-to-client update**, bukan full-duplex bidirectional channel. Untuk kasus seperti itu, WebSocket sering terlalu mahal secara operasional: state per koneksi lebih kompleks, authorization per message harus eksplisit, reconnect/resume harus didesain, cluster fan-out lebih rumit, dan debugging production lebih berat.

Part ini membahas alternatif yang sangat penting:

1. **Polling**
2. **Long polling**
3. **Server-Sent Events / SSE**
4. **HTTP streaming manual**
5. **WebSocket** sebagai pembanding, bukan fokus utama
6. **Message broker / async job + notification architecture**

Target akhir part ini bukan sekadar bisa menulis servlet SSE sederhana. Targetnya adalah mampu menjawab pertanyaan arsitektural:

> Untuk kebutuhan update tertentu, transport mana yang paling benar, paling sederhana, paling mudah dioperasikan, dan paling defensible saat production failure terjadi?

---

## 2. Mental Model: Real-Time Bukan Satu Masalah

Kata “real-time” sering dipakai terlalu luas. Dalam sistem web, minimal ada beberapa jenis “real-time” yang berbeda:

| Kebutuhan | Contoh | Karakter |
|---|---|---|
| Periodic freshness | refresh dashboard tiap 30 detik | toleran delay |
| Near-real-time server push | notifikasi status case berubah | satu arah server → client |
| Progress update | export report 0% sampai 100% | satu arah, scoped ke job |
| Collaborative editing | banyak user edit dokumen yang sama | dua arah, ordering penting |
| Chat | user A kirim ke user B | dua arah, low latency |
| Market/tick data | update sangat sering | throughput/backpressure kritikal |
| Command/control | client kirim command, server push state | dua arah, consistency penting |

Kesalahan umum: semua kebutuhan di atas dianggap sama, lalu langsung dipilih WebSocket.

Lebih tepatnya, tentukan dulu sumbu-sumbu berikut:

1. **Arah komunikasi**: client-to-server saja, server-to-client saja, atau full-duplex?
2. **Frekuensi update**: jarang, sedang, tinggi, bursty?
3. **Toleransi delay**: detik, ratusan milidetik, puluhan milidetik?
4. **Reliability**: boleh hilang, harus replay, harus acknowledged?
5. **Ordering**: perlu global order, per user, per entity, atau tidak penting?
6. **Connection lifetime**: pendek, panjang, tab-bound, user-session-bound?
7. **Cluster model**: satu node, banyak node sticky, banyak node non-sticky?
8. **Security**: auth cukup saat connect atau perlu per event/per subscription?
9. **Infrastructure compatibility**: proxy buffering, idle timeout, HTTP/2, WAF, gateway?
10. **Operational cost**: berapa banyak koneksi idle yang sanggup ditahan?

Top 1% engineer tidak memilih transport berdasarkan tren, tetapi berdasarkan **shape of communication** dan **failure semantics**.

---

## 3. Opsi 1 — Polling Biasa

Polling adalah mekanisme client meminta data secara berkala:

```text
client ── GET /notifications?since=123 ──> server
client <── 200 JSON updates ───────────── server

wait 10s

client ── GET /notifications?since=130 ──> server
client <── 200 JSON updates ───────────── server
```

### 3.1 Kapan Polling Cukup

Polling sering diremehkan, padahal untuk banyak sistem enterprise, polling adalah pilihan paling defensible.

Gunakan polling bila:

- update tidak harus sub-second;
- jumlah client tidak ekstrem;
- data bisa diambil dengan query murah;
- UI hanya butuh freshness berkala;
- event loss bisa diperbaiki dengan fetch ulang state terbaru;
- infrastruktur tidak ramah long-lived connection;
- tim butuh solusi sederhana dan mudah di-debug.

Contoh:

- dashboard status aplikasi tiap 30 detik;
- inbox notification count;
- status approval workflow;
- status background report generation;
- refresh list case setelah user idle;
- monitor job batch internal.

### 3.2 Kelebihan Polling

| Aspek | Kelebihan |
|---|---|
| Simplicity | mudah dibuat, diuji, diamati |
| Compatibility | cocok dengan proxy, gateway, CDN, WAF |
| Statelessness | setiap request berdiri sendiri |
| Failure recovery | request berikutnya bisa memperbaiki state |
| Scaling | mudah di-scale horizontal |
| Security | sama seperti HTTP API biasa |
| Debugging | bisa pakai curl, access log, APM biasa |

### 3.3 Kekurangan Polling

| Masalah | Dampak |
|---|---|
| Wasteful | banyak request kosong |
| Latency minimum = interval | update bisa terlambat sampai interval berikutnya |
| Thundering herd | semua client poll bersamaan |
| DB pressure | query count meningkat |
| Mobile/battery cost | lebih boros untuk device tertentu |

### 3.4 Polling yang Baik

Polling yang buruk:

```text
GET /notifications
setInterval(1000)
```

Polling yang lebih baik:

```text
GET /notifications?afterEventId=87201&limit=100
```

Dengan desain:

- client membawa cursor `afterEventId`;
- server mengembalikan event baru;
- response menyertakan `nextCursor`;
- interval memakai jitter;
- server bisa mengembalikan `204 No Content` bila kosong;
- client backoff saat error;
- endpoint cache-aware bila data bukan user-specific;
- query memakai index pada `(user_id, event_id)` atau `(tenant_id, user_id, created_at)`.

Contoh response:

```json
{
  "events": [
    { "id": 87202, "type": "CASE_ASSIGNED", "caseId": "C-1001" },
    { "id": 87203, "type": "TASK_DUE", "taskId": "T-774" }
  ],
  "nextCursor": 87203,
  "recommendedPollAfterMs": 15000
}
```

### 3.5 Polling dengan Jitter

Jangan membuat semua browser poll setiap 10 detik tepat:

```javascript
function nextDelay(baseMs) {
  const jitter = Math.floor(Math.random() * baseMs * 0.3);
  return baseMs + jitter;
}
```

Dengan ini, 10.000 client tidak akan menghantam server di detik yang sama.

---

## 4. Opsi 2 — Long Polling

Long polling adalah kompromi antara polling dan push.

Client membuat request. Jika belum ada data, server **menahan request** sampai:

1. event tersedia;
2. timeout tercapai;
3. koneksi dibatalkan;
4. server shutdown;
5. error terjadi.

```text
client ── GET /events/long-poll?after=100 ──> server
server waits...
server receives event 101
client <── 200 event 101 ─────────────────── server
client immediately reconnects
```

### 4.1 Kapan Long Polling Cocok

Long polling cocok bila:

- update server-to-client tidak terlalu sering;
- browser/proxy tidak stabil untuk SSE/WebSocket;
- ingin push-ish semantics tanpa WebSocket;
- response setiap request tetap finite;
- ingin memakai HTTP request biasa untuk auth/logging/tracing;
- server bisa mengelola async servlet dengan benar.

Contoh:

- notification update;
- “wait until job complete”;
- approval status changed;
- low-volume message delivery;
- compatibility mode untuk environment yang memblokir WebSocket.

### 4.2 Servlet Long Polling dengan AsyncContext

Long polling sebaiknya memakai Servlet async, bukan menahan container worker thread.

Contoh konseptual:

```java
@WebServlet(urlPatterns = "/events/long-poll", asyncSupported = true)
public class LongPollingServlet extends HttpServlet {

    private final EventStore eventStore = EventStore.instance();
    private final PendingRequestRegistry registry = PendingRequestRegistry.instance();

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        long after = parseLong(req.getParameter("after"), 0L);
        String userId = requireUser(req);

        List<Event> events = eventStore.findAfter(userId, after, 100);
        if (!events.isEmpty()) {
            writeJson(resp, events);
            return;
        }

        AsyncContext async = req.startAsync();
        async.setTimeout(25_000);

        PendingLongPoll pending = new PendingLongPoll(userId, after, async);
        registry.register(pending);

        async.addListener(new AsyncListener() {
            @Override
            public void onTimeout(AsyncEvent event) throws IOException {
                registry.remove(pending);
                HttpServletResponse r = (HttpServletResponse) event.getSuppliedResponse();
                if (!r.isCommitted()) {
                    r.setStatus(HttpServletResponse.SC_NO_CONTENT);
                }
                event.getAsyncContext().complete();
            }

            @Override
            public void onComplete(AsyncEvent event) {
                registry.remove(pending);
            }

            @Override
            public void onError(AsyncEvent event) {
                registry.remove(pending);
            }

            @Override
            public void onStartAsync(AsyncEvent event) {
                // no-op
            }
        });
    }
}
```

Ketika event masuk:

```java
public void publish(Event event) {
    eventStore.append(event);

    for (PendingLongPoll pending : registry.findByUser(event.userId())) {
        pending.completeWith(List.of(event));
    }
}
```

### 4.3 Long Polling State Machine

```text
RECEIVED_REQUEST
  ↓
CHECK_EVENT_STORE
  ├─ events found → WRITE_RESPONSE → COMPLETE
  └─ no events
        ↓
     START_ASYNC
        ↓
     REGISTER_PENDING_REQUEST
        ↓
     WAITING
        ├─ event arrives → WRITE_RESPONSE → COMPLETE
        ├─ timeout → 204 NO CONTENT → COMPLETE
        ├─ client abort → CLEANUP
        ├─ server shutdown → CLEANUP/503
        └─ error → CLEANUP
```

### 4.4 Long Polling Failure Modes

| Failure | Root Cause | Mitigation |
|---|---|---|
| worker thread exhaustion | blocking sleep inside servlet | use `AsyncContext` |
| pending request leak | not removed on timeout/error/complete | idempotent cleanup |
| duplicate response | event and timeout race | atomic complete flag |
| lost event | event arrives between store check and registry registration | double-check after registration |
| thundering reconnect | all clients timeout at same duration | client jitter, server jitter |
| proxy timeout before app timeout | LB/proxy shorter than async timeout | align timeouts |
| memory pressure | too many pending requests | per-user/global pending limit |

### 4.5 Race: Event Between Check and Register

Bad flow:

```text
1. server checks store: no event
2. event arrives
3. server registers pending request
4. request waits until timeout, event missed
```

Safer flow:

```text
1. check store
2. if empty, register pending
3. check store again
4. if event exists, complete immediately
```

Pattern:

```java
registry.register(pending);
List<Event> lateEvents = eventStore.findAfter(userId, after, 100);
if (!lateEvents.isEmpty()) {
    pending.completeWith(lateEvents);
}
```

Long polling is simple only when you ignore races. Production-grade long polling treats pending request registration as a concurrency boundary.

---

## 5. Opsi 3 — Server-Sent Events / SSE

SSE adalah mekanisme browser-native untuk menerima event dari server melalui HTTP response yang tetap terbuka.

Client memakai `EventSource`:

```javascript
const source = new EventSource('/events/stream');

source.onmessage = event => {
  console.log('message', event.data);
};

source.addEventListener('case-updated', event => {
  const payload = JSON.parse(event.data);
  console.log(payload.caseId);
});

source.onerror = err => {
  console.log('SSE error', err);
};
```

Server mengirim response dengan content type:

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Body berbentuk event stream:

```text
id: 1001
event: case-updated
data: {"caseId":"C-1001","status":"REVIEW"}

id: 1002
event: notification
data: {"message":"New task assigned"}

```

Perhatikan baris kosong setelah setiap event. Itu delimiter penting.

### 5.1 Format Event Stream

Field utama SSE:

| Field | Fungsi |
|---|---|
| `data:` | payload event |
| `event:` | nama event custom |
| `id:` | event id untuk reconnect/resume |
| `retry:` | rekomendasi reconnect delay dalam ms |
| `:` | comment/heartbeat line |

Contoh:

```text
retry: 5000

id: 87203
event: task-assigned
data: {"taskId":"T-774","assignee":"user-123"}

: heartbeat

```

Multi-line data:

```text
data: line 1
data: line 2

```

Browser akan menggabungkan beberapa `data:` line menjadi satu payload dengan newline.

### 5.2 SSE Itu One-Way

SSE hanya server → client.

Untuk client → server, tetap gunakan HTTP API biasa:

```text
Client command:
POST /cases/C-1001/assign

Server push:
SSE /events/stream emits case-updated
```

Ini sering justru lebih bersih daripada WebSocket:

- command tetap HTTP API biasa;
- authz command tetap di endpoint biasa;
- audit trail command mudah;
- server push hanya notifikasi/perubahan state;
- retry command bisa memakai idempotency key;
- event stream tidak perlu menerima arbitrary client messages.

### 5.3 Kapan SSE Cocok

Gunakan SSE bila:

- komunikasi dominan server → client;
- browser adalah client utama;
- butuh near-real-time update;
- butuh automatic reconnect bawaan browser;
- butuh resume dengan `Last-Event-ID`;
- event berupa text/JSON;
- tidak butuh binary frame;
- tidak butuh client mengirim message di channel yang sama;
- ingin lebih sederhana daripada WebSocket.

Contoh cocok:

- notification center;
- dashboard live update;
- audit/event feed;
- case workflow status;
- report generation progress;
- background job progress;
- admin monitoring panel;
- streaming AI text response;
- deployment progress log;
- workflow timeline live refresh.

### 5.4 Kapan SSE Tidak Cocok

SSE kurang cocok bila:

- butuh full-duplex low-latency;
- butuh binary payload;
- event rate sangat tinggi;
- client bukan browser dan library SSE tidak matang;
- infrastruktur mem-buffer response streaming;
- harus melewati gateway yang tidak mendukung long-lived response;
- butuh strict backpressure per message;
- browser tab membuka banyak SSE connection ke domain sama di HTTP/1.1.

---

## 6. SSE dengan Servlet Async

Servlet SSE sebaiknya menggunakan async karena response bisa hidup lama.

### 6.1 Basic SSE Servlet

```java
@WebServlet(urlPatterns = "/events/stream", asyncSupported = true)
public class SseServlet extends HttpServlet {

    private final SseConnectionRegistry registry = SseConnectionRegistry.instance();

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String userId = requireUser(req);

        resp.setStatus(HttpServletResponse.SC_OK);
        resp.setContentType("text/event-stream");
        resp.setCharacterEncoding("UTF-8");
        resp.setHeader("Cache-Control", "no-cache");
        resp.setHeader("X-Accel-Buffering", "no");

        AsyncContext async = req.startAsync();
        async.setTimeout(0); // container-specific interpretation: no async timeout

        SseConnection connection = new SseConnection(userId, async);
        registry.add(connection);

        async.addListener(new AsyncListener() {
            @Override
            public void onComplete(AsyncEvent event) {
                registry.remove(connection);
            }

            @Override
            public void onTimeout(AsyncEvent event) {
                registry.remove(connection);
                connection.close();
            }

            @Override
            public void onError(AsyncEvent event) {
                registry.remove(connection);
            }

            @Override
            public void onStartAsync(AsyncEvent event) {
                // no-op
            }
        });

        connection.sendComment("connected");
    }
}
```

### 6.2 SSE Connection Wrapper

```java
public final class SseConnection {
    private final String userId;
    private final AsyncContext async;
    private final Object writeLock = new Object();
    private final AtomicBoolean closed = new AtomicBoolean(false);

    public SseConnection(String userId, AsyncContext async) {
        this.userId = userId;
        this.async = async;
    }

    public String userId() {
        return userId;
    }

    public void sendEvent(String id, String event, String jsonData) {
        if (closed.get()) return;

        try {
            ServletResponse response = async.getResponse();
            PrintWriter writer = response.getWriter();

            synchronized (writeLock) {
                if (id != null && !id.isBlank()) {
                    writer.write("id: ");
                    writer.write(sanitizeLine(id));
                    writer.write("\n");
                }

                if (event != null && !event.isBlank()) {
                    writer.write("event: ");
                    writer.write(sanitizeLine(event));
                    writer.write("\n");
                }

                for (String line : splitLines(jsonData)) {
                    writer.write("data: ");
                    writer.write(line);
                    writer.write("\n");
                }

                writer.write("\n");
                writer.flush();

                if (writer.checkError()) {
                    close();
                }
            }
        } catch (IOException | IllegalStateException ex) {
            close();
        }
    }

    public void sendComment(String comment) {
        if (closed.get()) return;

        try {
            PrintWriter writer = async.getResponse().getWriter();
            synchronized (writeLock) {
                writer.write(": ");
                writer.write(sanitizeLine(comment));
                writer.write("\n\n");
                writer.flush();
                if (writer.checkError()) {
                    close();
                }
            }
        } catch (IOException | IllegalStateException ex) {
            close();
        }
    }

    public void close() {
        if (closed.compareAndSet(false, true)) {
            try {
                async.complete();
            } catch (IllegalStateException ignored) {
                // already completed by container/client abort
            }
        }
    }

    private static String sanitizeLine(String value) {
        return value.replace("\r", "").replace("\n", "");
    }

    private static List<String> splitLines(String value) {
        return value.lines().toList();
    }
}
```

### 6.3 Kenapa Ada `writeLock`?

SSE connection adalah satu HTTP response stream. Kalau beberapa thread menulis bersamaan:

```text
Thread A: id: 1
Thread B: id: 2
Thread A: event: x
Thread B: event: y
Thread A: data: ...
Thread B: data: ...
```

Event stream bisa rusak.

Karena itu harus ada single-writer discipline:

- lock sederhana;
- single-thread executor per connection;
- bounded queue + writer worker;
- actor-style connection object.

Untuk production dengan banyak event, bounded queue lebih aman daripada lock langsung, karena lock langsung bisa membuat publisher thread tertahan oleh slow client.

---

## 7. SSE Registry dan Fan-Out

Registry sederhana:

```java
public final class SseConnectionRegistry {
    private final ConcurrentMap<String, CopyOnWriteArraySet<SseConnection>> byUser = new ConcurrentHashMap<>();

    public void add(SseConnection connection) {
        byUser.computeIfAbsent(connection.userId(), ignored -> new CopyOnWriteArraySet<>())
              .add(connection);
    }

    public void remove(SseConnection connection) {
        CopyOnWriteArraySet<SseConnection> set = byUser.get(connection.userId());
        if (set == null) return;

        set.remove(connection);
        if (set.isEmpty()) {
            byUser.remove(connection.userId(), set);
        }
    }

    public void sendToUser(String userId, String id, String event, String jsonData) {
        Set<SseConnection> connections = byUser.getOrDefault(userId, new CopyOnWriteArraySet<>());
        for (SseConnection c : connections) {
            c.sendEvent(id, event, jsonData);
        }
    }
}
```

Catatan production:

- `CopyOnWriteArraySet` cocok bila connect/disconnect jarang dan broadcast lebih sering;
- untuk skala besar, gunakan struktur lebih efisien;
- registry node-local hanya tahu koneksi di node tersebut;
- dalam cluster, event dari node lain harus didistribusikan via broker/pub-sub.

---

## 8. Resume dengan `Last-Event-ID`

SSE punya mekanisme bawaan untuk reconnect. Browser akan mengirim `Last-Event-ID` jika stream sebelumnya menerima event dengan `id:`.

Request reconnect:

```http
GET /events/stream HTTP/1.1
Last-Event-ID: 87203
```

Server bisa membaca:

```java
String lastEventId = req.getHeader("Last-Event-ID");
```

Lalu replay event setelah ID tersebut:

```java
long lastSeen = parseLong(req.getHeader("Last-Event-ID"), 0L);
List<Event> missed = eventStore.findAfter(userId, lastSeen, 500);

for (Event event : missed) {
    connection.sendEvent(
        String.valueOf(event.id()),
        event.type(),
        event.jsonPayload()
    );
}
```

### 8.1 Event ID Harus Stabil

Jangan gunakan random UUID volatile kalau tujuan Anda adalah resume ordered stream.

Lebih baik:

- monotonically increasing per user;
- monotonically increasing per tenant;
- sequence per subscription;
- database event table ID;
- Kafka offset per partition bila desainnya cocok.

### 8.2 Replay Window

SSE reconnect tidak otomatis membuat aplikasi reliable. Anda tetap perlu replay window.

Misalnya simpan event 24 jam:

```text
user_event_log
- id bigint
- user_id
- event_type
- payload_json
- created_at
- expires_at
```

Jika `Last-Event-ID` terlalu lama:

```json
{
  "type": "RESYNC_REQUIRED",
  "reason": "event cursor expired"
}
```

Lalu client fetch state penuh:

```text
GET /notifications/snapshot
```

### 8.3 Snapshot + Stream Pattern

Pattern yang lebih robust:

```text
1. Client GET /state/snapshot
2. Server returns current state + streamCursor
3. Client opens SSE /events/stream?after=streamCursor
4. Server replays events after cursor
5. Client applies event incrementally
6. If cursor expired, client refetches snapshot
```

Ini lebih aman daripada membuka stream tanpa baseline state.

---

## 9. Heartbeat untuk SSE

SSE butuh heartbeat karena koneksi idle bisa diputus oleh proxy, NAT, LB, browser, atau container.

Heartbeat SSE bisa berupa comment:

```text
: heartbeat

```

Keuntungan comment:

- tidak memicu `message` event di client;
- menjaga bytes mengalir;
- sederhana;
- tidak perlu payload JSON.

Contoh scheduler:

```java
public final class SseHeartbeatTask implements Runnable {
    private final SseConnectionRegistry registry;

    @Override
    public void run() {
        for (SseConnection c : registry.allConnections()) {
            c.sendComment("hb " + System.currentTimeMillis());
        }
    }
}
```

Interval harus lebih kecil dari timeout idle terpendek di jalur:

```text
heartbeat interval < smallest idle timeout
```

Jika ALB idle timeout 60 detik, heartbeat 25–30 detik sering lebih aman. Tetapi jangan memilih angka sembarangan; align dengan environment.

---

## 10. SSE dan Proxy Buffering

Masalah produksi paling umum dengan SSE:

> Server sudah flush, tetapi browser menerima event dalam batch beberapa menit kemudian.

Penyebab sering:

- reverse proxy buffering;
- gateway buffering;
- compression buffering;
- CDN tidak cocok untuk streaming;
- servlet response buffer belum flush;
- proxy menunggu buffer penuh;
- HTTP/2 gateway behavior berbeda dari asumsi.

### 10.1 Header yang Umum Dipakai

```http
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
```

`X-Accel-Buffering: no` sering digunakan dengan Nginx untuk menonaktifkan buffering pada response tertentu, tetapi tetap perlu konfigurasi proxy yang benar.

Nginx contoh konseptual:

```nginx
location /events/stream {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

### 10.2 Compression Caveat

Compression bisa membuat event kecil tertahan sampai buffer compression cukup besar.

Untuk SSE, sering lebih aman:

```http
Content-Encoding: identity
```

atau disable gzip untuk `text/event-stream` di proxy/container.

### 10.3 Flush Tidak Selalu Cukup

Di Java:

```java
writer.flush();
```

Ini hanya memastikan aplikasi/container mencoba mengirim bytes ke bawah. Tetapi masih ada lapisan:

```text
Servlet app
  ↓
Container buffer
  ↓
Reverse proxy buffer
  ↓
Load balancer
  ↓
Browser networking stack
  ↓
EventSource parser
```

Kalau salah satu layer buffering, user tetap melihat delay.

---

## 11. SSE dan HTTP/1.1 vs HTTP/2

Pada HTTP/1.1, browser punya limit koneksi per origin. Jika aplikasi membuka banyak tab atau banyak SSE stream ke domain yang sama, koneksi lain bisa tertahan.

Pada HTTP/2, banyak stream dapat dimultiplex di satu TCP connection, sehingga lebih ramah untuk banyak stream. Namun tetap ada limit negotiated stream dan behavior proxy/gateway.

Prinsip desain:

- jangan buka banyak SSE stream per tab;
- gunakan satu stream per user/session/tab bila mungkin;
- multiplex event type di stream yang sama;
- hindari satu SSE connection per widget;
- pakai named events untuk routing di client.

Bad:

```text
/events/cases
/events/tasks
/events/messages
/events/audit
/events/progress
```

Better:

```text
/events/stream
```

Dengan event type:

```text
event: case-updated
data: {...}

event: task-assigned
data: {...}

event: report-progress
data: {...}

```

---

## 12. SSE Authorization Model

SSE biasanya diautentikasi seperti HTTP GET biasa:

- cookie session;
- bearer token;
- mTLS/internal auth;
- gateway-authenticated identity header.

Tetapi karena stream long-lived, ada pertanyaan penting:

> Apa yang terjadi kalau role user berubah saat koneksi SSE masih terbuka?

Pilihan:

1. tutup semua stream user saat role berubah;
2. revalidate authorization sebelum mengirim setiap event sensitif;
3. TTL pendek untuk stream, paksa reconnect berkala;
4. event tidak membawa data sensitif, hanya signal untuk refetch via authorized API.

Pattern paling defensible untuk banyak enterprise app:

```text
SSE event = lightweight signal
HTTP API = fetch actual sensitive data with normal authorization
```

Contoh:

```text
event: case-changed
data: {"caseId":"C-1001"}
```

Lalu client:

```text
GET /api/cases/C-1001
```

Keuntungan:

- stream tidak membocorkan detail sensitif;
- authorization detail tetap di API biasa;
- jika role berubah, fetch akan ditolak;
- audit access data lebih jelas.

---

## 13. SSE Backpressure dan Slow Client

SSE terlihat sederhana, tetapi slow client tetap masalah.

Jika server publish event lebih cepat daripada client/network bisa menerima:

```text
publisher → SSE connection → socket buffer → proxy → slow browser
```

Risiko:

- memory buffer menumpuk;
- publisher thread tertahan;
- registry lock contention;
- latency event lain meningkat;
- OOM saat banyak slow client.

### 13.1 Bounded Queue Pattern

Daripada menulis langsung dari publisher thread, gunakan queue per connection:

```text
publisher thread
  ↓ offer(event)
bounded queue per connection
  ↓ writer loop
SSE response
```

Policy saat queue penuh:

| Policy | Cocok Untuk |
|---|---|
| drop oldest | dashboard state update |
| drop newest | event lama lebih penting |
| disconnect slow client | notification stream dengan replay |
| coalesce | progress/status updates |
| force resync | state-heavy UI |

Contoh progress event:

```text
10%, 11%, 12%, 13%, 14%
```

Kalau client lambat, tidak perlu kirim semua. Bisa coalesce menjadi latest:

```text
14%
```

### 13.2 Event Type Menentukan Backpressure Policy

| Event Type | Policy |
|---|---|
| notification | store + replay, disconnect if slow |
| dashboard metric | drop old/coalesce |
| progress update | latest wins |
| audit feed | replay required |
| chat-like event | better WebSocket/broker with ACK semantics |

---

## 14. HTTP Streaming Manual

Selain SSE, server bisa mengirim response chunked manual:

```http
HTTP/1.1 200 OK
Content-Type: application/x-ndjson
Transfer-Encoding: chunked

{"type":"progress","value":10}
{"type":"progress","value":20}
{"type":"complete"}
```

Format umum:

- NDJSON: newline-delimited JSON;
- chunked JSON array;
- multipart mixed;
- plain text stream;
- binary stream.

### 14.1 Kapan HTTP Streaming Cocok

- streaming hasil AI/token;
- export progress + generated chunks;
- log tail internal;
- server-to-client stream non-browser atau custom client;
- download yang juga membawa metadata bertahap;
- service-to-service streaming sederhana.

### 14.2 Bedanya dengan SSE

| Aspek | SSE | HTTP Streaming Manual |
|---|---|---|
| Browser API | `EventSource` built-in | `fetch` stream/manual parser |
| Reconnect | built-in | desain sendiri |
| Event ID | built-in field | desain sendiri |
| Named event | built-in | desain sendiri |
| Binary | tidak native | bisa |
| Format | `text/event-stream` | bebas |
| Simplicity di browser | tinggi | sedang/kompleks |

### 14.3 Servlet Streaming Manual

```java
@WebServlet(urlPatterns = "/jobs/progress-stream", asyncSupported = true)
public class NdjsonProgressServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setStatus(200);
        resp.setContentType("application/x-ndjson");
        resp.setCharacterEncoding("UTF-8");
        resp.setHeader("Cache-Control", "no-cache");

        AsyncContext async = req.startAsync();
        async.setTimeout(120_000);

        JobProgressRegistry.subscribe(req.getParameter("jobId"), progress -> {
            try {
                PrintWriter writer = async.getResponse().getWriter();
                writer.write(toJson(progress));
                writer.write("\n");
                writer.flush();
            } catch (IOException e) {
                async.complete();
            }
        });
    }
}
```

Untuk browser modern, `fetch()` bisa membaca stream, tetapi implementasi parsing dan reconnect harus dibuat sendiri.

---

## 15. WebSocket vs SSE vs Long Polling vs Polling

### 15.1 Decision Matrix Ringkas

| Requirement | Best Default |
|---|---|
| Update tiap 30–60 detik | Polling |
| Update jarang tapi ingin cepat | Long polling |
| Server push satu arah ke browser | SSE |
| Full-duplex | WebSocket |
| Binary low-latency | WebSocket |
| Progress report | SSE atau polling |
| Dashboard metrics | SSE atau polling |
| Chat | WebSocket |
| Notification feed | SSE |
| Enterprise approval workflow | polling/SSE |
| Infrastruktur lama/proxy ketat | polling/long polling |
| Need replay/resume sederhana | SSE + event log |
| Need per-message client commands | HTTP API + SSE, atau WebSocket jika benar-benar bidirectional |

### 15.2 Latency vs Complexity

```text
Lowest complexity
  Polling
  Long Polling
  SSE
  WebSocket
Highest complexity
```

```text
Lowest latency potential
  WebSocket
  SSE
  Long Polling
  Polling
Highest delay
```

Tetapi latency bukan satu-satunya faktor. Dalam enterprise systems, clarity, auditability, and failure recovery sering lebih penting daripada 50ms latency.

---

## 16. Pattern: Command via HTTP, Update via SSE

Ini pattern yang sangat kuat untuk business application.

```text
Browser
  │
  ├── POST /api/cases/C-1001/approve ────────▶ Application API
  │                                             │
  │                                             ├─ validate
  │                                             ├─ authorize
  │                                             ├─ transaction
  │                                             ├─ audit
  │                                             └─ publish domain event
  │
  └── GET /events/stream ◀──────────────────── SSE notification
```

Event:

```text
id: 99301
event: case-updated
data: {"caseId":"C-1001","version":18}

```

Client kemudian fetch:

```text
GET /api/cases/C-1001
```

Keuntungan:

- command tetap transactional;
- idempotency command jelas;
- authorization command tetap matang;
- SSE hanya invalidation signal;
- data access tetap lewat API normal;
- multi-tab refresh lebih mudah;
- event payload bisa kecil;
- replay lebih murah.

---

## 17. Pattern: Job Progress via SSE

Untuk long-running job:

```text
POST /reports/export
→ 202 Accepted
→ { "jobId": "J-123" }

GET /reports/export/J-123/events
→ text/event-stream
```

Event stream:

```text
event: progress
data: {"percent":10,"stage":"Preparing query"}


event: progress
data: {"percent":60,"stage":"Generating file"}


event: completed
data: {"downloadUrl":"/reports/export/J-123/download"}

```

Failure event:

```text
event: failed
data: {"code":"REPORT_TOO_LARGE","message":"Report exceeds allowed size"}

```

State machine:

```text
SUBMITTED
  ↓
QUEUED
  ↓
RUNNING
  ├─ PROGRESS events
  ├─ COMPLETED → download available
  ├─ FAILED → error displayed
  └─ CANCELLED
```

SSE stream bukan source of truth. Source of truth tetap job table/state store.

Client yang reconnect bisa mengambil current state:

```text
GET /reports/export/J-123
```

Lalu lanjut stream.

---

## 18. Pattern: Notification Feed

Notification feed butuh:

- persistent event log;
- cursor;
- read/unread state;
- multi-device support;
- replay;
- expiry;
- per-user authorization.

Data model sederhana:

```text
notification_event
- id
- user_id
- type
- payload_json
- created_at
- expires_at

notification_read_state
- user_id
- last_read_event_id
```

SSE:

```text
id: 10055
event: notification
data: {"notificationId":"N-77","type":"TASK_ASSIGNED"}

```

Client fetch detail:

```text
GET /notifications?after=10040
```

Dengan ini, SSE hanya mempercepat awareness. Jika stream gagal, polling/fetch ulang tetap memperbaiki state.

---

## 19. Cluster Architecture untuk SSE

Node-local SSE registry hanya tahu koneksi di node itu.

```text
          ┌────────── App Node A ──────────┐
Client 1 ─┤ SSE registry: user-1           │
          └────────────────────────────────┘

          ┌────────── App Node B ──────────┐
Client 2 ─┤ SSE registry: user-2           │
          └────────────────────────────────┘
```

Jika event dibuat di Node A untuk user yang tersambung ke Node B, Node A tidak bisa langsung menulis ke connection Node B.

Solusi:

```text
Domain event
  ↓
Broker / PubSub / Redis Stream / Kafka / RabbitMQ
  ↓
All nodes consume relevant event
  ↓
Each node sends to local connected users
```

### 19.1 Broadcast via Pub/Sub

```text
API Node A commits transaction
  ↓
publish UserNotification(user-2)
  ↓
Redis Pub/Sub / Kafka / RabbitMQ
  ↓
Node B receives event
  ↓
Node B registry sends SSE to user-2
```

### 19.2 Sticky Session Tidak Menghilangkan Kebutuhan Broker

Sticky session membuat user reconnect ke node yang sama, tetapi event producer tetap bisa berada di node lain.

Sticky membantu connection affinity, bukan distributed event routing.

### 19.3 Event Store vs Pub/Sub

| Mechanism | Fungsi |
|---|---|
| Pub/Sub | deliver event to currently connected nodes |
| Event store | replay missed events |
| Snapshot API | recover full state |
| SSE registry | active local connections |

Untuk reliability, sering butuh kombinasi:

```text
commit event to store
publish event to broker
send to connected clients
client reconnects with Last-Event-ID
server replays from store
```

---

## 20. Timeout Alignment

Streaming transport sangat sensitif terhadap timeout mismatch.

Lapisan umum:

```text
Browser EventSource
  ↓
Corporate proxy / browser network stack
  ↓
CDN / WAF
  ↓
Load balancer
  ↓
Ingress / reverse proxy
  ↓
Servlet container connector
  ↓
Async servlet timeout
  ↓
Application heartbeat
```

Contoh buruk:

| Layer | Timeout |
|---|---:|
| ALB idle timeout | 60s |
| Nginx proxy_read_timeout | 300s |
| Servlet async timeout | infinite |
| Heartbeat | 120s |

Akibat: ALB memutus koneksi tiap 60 detik sebelum heartbeat.

Contoh lebih baik:

| Layer | Timeout |
|---|---:|
| ALB idle timeout | 60s |
| Heartbeat | 25s |
| Nginx proxy_read_timeout | 75s+ |
| Servlet async timeout | 0/infinite atau > LB |

Prinsip:

```text
heartbeat interval < smallest idle timeout
application timeout should be intentional
client reconnect should use jitter
```

---

## 21. Graceful Shutdown untuk SSE dan Long Polling

Saat rolling update, jangan biarkan koneksi streaming mati secara random.

State:

```text
RUNNING
  ↓ SIGTERM / preStop
DRAINING
  ↓ reject new stream / tell clients reconnect
CLOSING_EXISTING_STREAMS
  ↓ complete async contexts
STOPPED
```

SSE drain event:

```text
event: server-draining
data: {"reconnectAfterMs":3000}

```

Lalu server close connection.

Client:

```javascript
source.addEventListener('server-draining', event => {
  source.close();
  const payload = JSON.parse(event.data);
  setTimeout(connect, payload.reconnectAfterMs + Math.random() * 1000);
});
```

Kubernetes considerations:

- readiness false before shutdown;
- wait drain grace period;
- close or complete long-lived async connections;
- avoid sending new clients to terminating pod;
- align terminationGracePeriodSeconds with drain logic.

---

## 22. Observability untuk Polling/Long Polling/SSE

Metrics penting:

| Metric | Makna |
|---|---|
| active SSE connections | jumlah stream terbuka |
| active long polls | pending request |
| SSE connect rate | churn/reconnect behavior |
| SSE disconnect rate | instability/proxy reset |
| average connection lifetime | apakah koneksi sering putus |
| events sent/sec | throughput |
| event send failures | client abort/connection reset |
| heartbeat failures | broken stream |
| replay count | reconnect/resume volume |
| replay lag | seberapa jauh client tertinggal |
| queue depth per connection | slow client |
| dropped/coalesced events | backpressure |
| async timeout count | timeout behavior |
| proxy 499/502/503/504 | edge failure |

Logs penting:

```text
sse.connect userId=... connectionId=... lastEventId=...
sse.disconnect userId=... connectionId=... reason=client_abort lifetimeMs=...
sse.send_failed userId=... connectionId=... eventId=... error=BrokenPipe
sse.replay userId=... from=87200 to=87230 count=30
sse.queue_full userId=... policy=disconnect
longpoll.timeout userId=... after=87200
```

Jangan log payload sensitif.

---

## 23. Testing Checklist

### 23.1 Functional Tests

- client bisa connect;
- content type benar `text/event-stream`;
- event format benar;
- named event diterima;
- `id` diterima;
- reconnect mengirim `Last-Event-ID`;
- missed events direplay;
- heartbeat tidak merusak parser;
- logout menutup/membatasi stream;
- unauthorized connection ditolak.

### 23.2 Failure Tests

- browser refresh;
- tab ditutup;
- network disconnect;
- proxy idle timeout;
- app node restart;
- rolling update;
- slow client;
- broker unavailable;
- event store unavailable;
- user role berubah saat stream aktif;
- event cursor expired;
- queue penuh;
- burst reconnect 10.000 client.

### 23.3 Load Tests

Load test bukan hanya request/sec. Untuk SSE:

- number of concurrent connections;
- events/sec;
- average event size;
- heartbeat interval;
- reconnect rate;
- slow-client percentage;
- replay volume;
- memory per connection;
- file descriptors/socket limit;
- container thread behavior;
- proxy buffering behavior.

---

## 24. Anti-Patterns

### 24.1 Satu SSE Connection per Widget

Buruk:

```text
Widget A opens /events/a
Widget B opens /events/b
Widget C opens /events/c
```

Lebih baik:

```text
One /events/stream
Route by event type on client
```

### 24.2 SSE Mengirim Data Sensitif Lengkap Tanpa Revalidation

Buruk:

```text
event: case-detail
data: { full confidential case payload }
```

Lebih baik:

```text
event: case-changed
data: { "caseId": "C-1001" }
```

Client fetch lewat authorized API.

### 24.3 Tidak Ada Replay

Kalau event penting, jangan hanya dikirim ke active connection. Simpan event dulu.

Bad:

```text
publish directly to open stream only
```

Better:

```text
store event → publish notification → stream to active clients → replay on reconnect
```

### 24.4 Infinite Stream Tanpa Heartbeat

Koneksi idle akan mati di layer yang tidak Anda lihat.

### 24.5 Publisher Thread Menulis Langsung ke Semua Client

Slow client akan memperlambat publisher.

### 24.6 Menganggap SSE Sama dengan Message Queue

SSE adalah delivery channel ke browser, bukan durable broker.

### 24.7 Tidak Mematikan Proxy Buffering

Aplikasi terlihat benar di local, tetapi “real-time” hilang di staging/prod.

### 24.8 Tidak Ada Connection Limit

Tanpa limit:

- satu user bisa buka 100 tab;
- attacker bisa buka ribuan connection;
- memory/socket habis.

---

## 25. Reference Implementation Architecture

Untuk aplikasi enterprise seperti case management, approval workflow, regulatory enforcement lifecycle, atau internal dashboard, desain yang robust bisa seperti ini:

```text
Browser
  │
  ├── HTTP API commands
  │      POST /cases/{id}/transition
  │      POST /tasks/{id}/complete
  │      GET  /cases/{id}
  │
  └── SSE stream
         GET /events/stream

Application
  │
  ├── Transactional command handler
  │      ├─ validate
  │      ├─ authorize
  │      ├─ mutate DB
  │      ├─ write audit
  │      └─ write outbox event
  │
  ├── Outbox publisher
  │      └─ publish to broker
  │
  ├── Event store
  │      └─ replay by user/cursor
  │
  └── SSE gateway
         ├─ authenticate stream
         ├─ replay after Last-Event-ID
         ├─ register local connection
         ├─ send heartbeat
         ├─ send local events
         └─ cleanup on close
```

Key idea:

> Business mutation tetap di HTTP API/transaction. SSE hanya transport untuk awareness, invalidation, and progress notification.

---

## 26. Mini Capstone: Designing a Report Progress Channel

Requirement:

- user submit report export;
- export bisa berjalan 2–10 menit;
- user melihat progress;
- user bisa refresh browser;
- user bisa reconnect;
- report bisa gagal;
- deployment rolling update tidak boleh membuat progress hilang.

### 26.1 API Design

```text
POST /reports/exports
→ 202 Accepted
{
  "jobId": "EXP-2026-0001",
  "statusUrl": "/reports/exports/EXP-2026-0001",
  "eventsUrl": "/reports/exports/EXP-2026-0001/events"
}
```

Status:

```text
GET /reports/exports/EXP-2026-0001
```

SSE:

```text
GET /reports/exports/EXP-2026-0001/events
```

Download:

```text
GET /reports/exports/EXP-2026-0001/file
```

### 26.2 Event Model

```json
{
  "eventId": 1001,
  "jobId": "EXP-2026-0001",
  "type": "PROGRESS",
  "percent": 40,
  "stage": "Writing CSV",
  "createdAt": "2026-06-17T09:00:00Z"
}
```

### 26.3 Stream

```text
id: 1001
event: progress
data: {"percent":40,"stage":"Writing CSV"}

id: 1002
event: progress
data: {"percent":80,"stage":"Uploading file"}

id: 1003
event: completed
data: {"downloadUrl":"/reports/exports/EXP-2026-0001/file"}

```

### 26.4 Reconnect

Client reconnects with:

```http
Last-Event-ID: 1001
```

Server:

```text
find job events where event_id > 1001 and job_id = EXP-2026-0001
```

If expired:

```text
event: resync-required
data: {"statusUrl":"/reports/exports/EXP-2026-0001"}

```

### 26.5 Why Not WebSocket?

Because requirement is server → client progress only. Commands are already HTTP:

- start export;
- cancel export;
- download file.

WebSocket would add unnecessary bidirectional complexity.

---

## 27. Choosing the Right Transport: Practical Heuristics

Use this checklist:

### 27.1 Choose Polling When

- update can be delayed;
- state can be refetched cheaply;
- operational simplicity matters;
- infra may not support streaming;
- concurrency is modest.

### 27.2 Choose Long Polling When

- you need faster-than-polling updates;
- SSE/WebSocket is blocked or undesirable;
- events are low frequency;
- response can finish after one event/batch;
- you can manage async pending requests.

### 27.3 Choose SSE When

- browser needs server-to-client updates;
- data is textual/JSON;
- automatic reconnect is useful;
- full-duplex is unnecessary;
- event stream can be modelled with cursor/replay;
- you want simpler ops than WebSocket.

### 27.4 Choose WebSocket When

- client and server both send frequent messages;
- low-latency two-way messaging is core;
- binary frame is useful;
- connection-specific state is necessary;
- per-message protocol is worth the complexity.

### 27.5 Choose Broker-First Architecture When

- multiple services produce events;
- events need durability;
- delivery has to survive node restart;
- clients reconnect frequently;
- fan-out across cluster matters;
- event replay matters.

The frontend transport is not your event system. It is only the last-mile delivery channel.

---

## 28. Production Checklist

Before shipping SSE/long polling:

- [ ] define event semantics: signal vs data;
- [ ] define event ID and ordering scope;
- [ ] define replay window;
- [ ] define reconnect behavior;
- [ ] define heartbeat interval;
- [ ] align proxy/LB/container timeout;
- [ ] disable buffering for streaming path;
- [ ] decide compression behavior;
- [ ] enforce per-user/per-IP connection limit;
- [ ] enforce payload size limit;
- [ ] define slow client policy;
- [ ] add observability metrics;
- [ ] add structured connect/disconnect logs;
- [ ] test browser refresh;
- [ ] test network drop;
- [ ] test app restart;
- [ ] test rolling deployment;
- [ ] test role change/logout;
- [ ] test cursor expired;
- [ ] test broker outage;
- [ ] test high reconnect burst;
- [ ] document fallback strategy.

---

## 29. Key Takeaways

1. WebSocket is not the default answer for every real-time requirement.
2. Polling is often correct for low-frequency enterprise state freshness.
3. Long polling is a useful compatibility bridge but needs async servlet and race-safe pending request handling.
4. SSE is excellent for browser-based one-way server push.
5. SSE is simpler than WebSocket but still needs heartbeat, replay, backpressure, timeout alignment, and proxy buffering control.
6. `Last-Event-ID` helps reconnect, but only if the server maintains replayable event state.
7. For sensitive systems, SSE should often send lightweight invalidation signals, while full data is fetched through authorized HTTP APIs.
8. Reverse proxy buffering can silently destroy real-time behavior.
9. Clustered SSE requires broker/pub-sub plus local connection registry.
10. The last-mile transport is not the source of truth. Durable state belongs in database/event store/broker, not only in open connections.

---

## 30. How This Connects to the Next Part

Part ini menyelesaikan pembahasan alternatif real-time transport setelah WebSocket. Berikutnya kita masuk ke area legacy tetapi masih banyak ditemukan di enterprise Java:

```text
Part 027 — JSP, Jakarta Pages, Expression Language, JSTL: Legacy but Still Important
```

Di part berikutnya, kita akan melihat JSP/Jakarta Pages bukan sebagai “template lama yang jelek”, tetapi sebagai teknologi yang sebenarnya dikompilasi menjadi servlet, punya lifecycle, scope model, tag library, EL evaluation, escaping risk, dan migration concerns.

---

## References

- Jakarta Servlet 6.1 Specification and API
- Jakarta EE Tutorial: Asynchronous Servlet Processing
- WHATWG HTML Living Standard: Server-Sent Events
- MDN Web Docs: Using Server-Sent Events
- RFC 9110: HTTP Semantics
- RFC 6455: The WebSocket Protocol
- Nginx documentation and common production guidance for proxy buffering and streaming response behavior

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-servlet-websocket-web-container-runtime-part-025.md">⬅️ Part 025 — WebSocket Security Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-servlet-websocket-web-container-runtime-part-027.md">Part 027 — JSP, Jakarta Pages, Expression Language, JSTL: Legacy but Still Important ➡️</a>
</div>
