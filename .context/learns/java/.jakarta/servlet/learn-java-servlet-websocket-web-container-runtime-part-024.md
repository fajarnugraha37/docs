# learn-java-servlet-websocket-web-container-runtime — Part 024
# WebSocket Reliability Patterns

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `024`  
> Topik: WebSocket Reliability Patterns  
> Rentang: Java 8 sampai Java 25, Java EE `javax.websocket.*` sampai Jakarta WebSocket `jakarta.websocket.*`  
> Status seri: belum selesai

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. **Part 021** — fondasi protokol WebSocket: handshake, frame, ping/pong, close, proxy, timeout.
2. **Part 022** — model endpoint Jakarta WebSocket: `@ServerEndpoint`, `@OnOpen`, `@OnMessage`, `Session`, encoder/decoder, configurator.
3. **Part 023** — session, concurrency, dan state management: connection registry, mapping user-to-session, slow client, broadcast, cluster, presence.

Part ini naik satu level: **bagaimana membuat koneksi WebSocket menjadi reliable di dunia nyata**.

Reliability di WebSocket bukan berarti koneksi tidak pernah putus. Itu mustahil. Reliability berarti sistem tetap menghasilkan perilaku yang benar walaupun:

- koneksi putus diam-diam,
- proxy menutup idle connection,
- client berganti jaringan,
- tab browser sleep,
- server rolling restart,
- node Kubernetes drain,
- user membuka banyak tab,
- message terkirim dua kali,
- message hilang,
- client reconnect terlalu cepat,
- broker lambat,
- downstream error,
- server overload,
- slow client membuat send queue membengkak.

Mental model utama:

```text
WebSocket reliability is not "keep the socket alive forever".
WebSocket reliability is designing an explicit connection + message lifecycle
that remains correct when connections die, messages duplicate, ordering changes,
and server nodes disappear.
```

---

## 1. Referensi Teknis Utama

Materi ini dibangun di atas beberapa kontrak resmi dan dokumentasi runtime:

- **RFC 6455 — The WebSocket Protocol**: mendefinisikan handshake, framing, control frame, ping, pong, dan close semantics.
- **Jakarta WebSocket 2.2 Specification**: mendefinisikan API endpoint, session, remote endpoint, encoder/decoder, dan konfigurasi di Jakarta EE 11.
- **Jakarta WebSocket API 2.2**: `Session`, `RemoteEndpoint.Basic`, `RemoteEndpoint.Async`, `Endpoint`, `CloseReason`.
- **Tomcat WebSocket How-To**: menjelaskan buffer default, blocking send timeout, dan beberapa properti container-specific.
- Dokumentasi container seperti Tomcat, Jetty, Undertow/WildFly untuk batas runtime seperti idle timeout, buffer size, message size, dan behavior implementasi.

Catatan penting: Jakarta WebSocket memberikan API portable, tetapi **reliability behavior sering dipengaruhi konfigurasi container, proxy, load balancer, browser, dan network**. Engineer top-tier harus bisa membaca spec sekaligus memahami runtime deployment chain.

---

## 2. Reliability Problem Space

### 2.1 WebSocket terlihat sederhana, tetapi stateful

HTTP request biasa bersifat relatif mudah dipulihkan:

```text
Request datang → server proses → response dikirim → koneksi selesai/idle
```

Jika gagal, client dapat retry request tertentu, terutama jika operation idempotent.

WebSocket berbeda:

```text
Handshake HTTP
  ↓
connection established
  ↓
stateful bidirectional stream
  ↓
server/client saling kirim message
  ↓
connection bisa mati kapan saja
  ↓
state session harus dibersihkan atau dipulihkan
```

Masalahnya: koneksi WebSocket membawa state temporal.

Contoh state:

- user online/offline,
- subscription room/topic,
- last acknowledged message,
- pending outbound queue,
- heartbeat timestamp,
- reconnect attempt,
- authorization snapshot,
- selected tenant/case/module,
- inflight command,
- cursor event stream.

Jika state ini tidak didesain eksplisit, bug akan muncul sebagai:

- user masih terlihat online padahal sudah disconnect,
- notifikasi hilang ketika reconnect,
- message diterima dua kali,
- order salah,
- server memory leak,
- WebSocket broadcast lambat karena satu client lambat,
- reconnect storm setelah deploy,
- tab lama menerima event setelah logout,
- server mengirim data ke user yang sudah tidak berhak.

---

## 3. Reliability Tidak Sama Dengan Delivery Guarantee

Sebelum membuat design, pisahkan beberapa konsep.

| Konsep | Pertanyaan | Contoh |
|---|---|---|
| Connection reliability | Apakah koneksi hidup dan bisa dipakai? | heartbeat, idle timeout, reconnect |
| Message delivery | Apakah message sampai? | ACK, retry, replay |
| Message ordering | Apakah urutan tetap benar? | sequence number, per-stream ordering |
| Duplicate handling | Apakah duplikat aman? | message id, idempotency key |
| State recovery | Setelah reconnect, client tahu posisi terakhir? | cursor, last event id |
| Overload protection | Apakah sistem tetap sehat saat client/broker lambat? | bounded queue, backpressure |
| Deployment reliability | Apa yang terjadi saat node restart? | drain, close code, reconnect jitter |

Kesalahan umum adalah menyebut “WebSocket reliable” hanya karena ada ping/pong. Ping/pong hanya membantu mendeteksi koneksi mati. Ia tidak menjamin message business sampai, tidak menjamin ordering, dan tidak menyelesaikan duplicate processing.

---

## 4. Baseline WebSocket Connection State Machine

WebSocket harus dipikirkan sebagai state machine.

```text
[NEW]
  ↓ HTTP upgrade accepted
[OPEN]
  ↓ authenticated/subscribed
[ACTIVE]
  ↓ no app-level traffic for threshold
[IDLE]
  ↓ heartbeat missed
[SUSPECT]
  ↓ timeout exceeded
[CLOSING]
  ↓ close handshake complete / transport gone
[CLOSED]
  ↓ cleanup idempotent
[REMOVED]
```

Versi lebih praktis untuk server:

```text
onOpen
  - assign connectionId
  - bind principal/userId
  - initialize ConnectionState
  - register session
  - set idle timeout / buffer policy if needed
  - optionally send HELLO/SNAPSHOT_REQUIRED

onMessage
  - validate schema
  - validate authz for message type
  - check rate limit
  - update lastSeen
  - apply message idempotency
  - process command/event
  - send ACK/result/event

heartbeat loop
  - send ping or app-level heartbeat
  - mark suspect if no pong/heartbeat reply
  - close if missed threshold exceeded

onError
  - log classified error
  - avoid double cleanup if onClose follows
  - close if protocol/application invariant broken

onClose
  - remove from registry
  - clear subscriptions
  - update presence after debounce
  - cancel outbound sender
  - release buffers
```

Prinsipnya: `onClose` bukan satu-satunya tempat cleanup. Transport bisa gagal dengan urutan callback yang berbeda antar container. Cleanup harus idempotent.

---

## 5. Heartbeat Design

### 5.1 Kenapa heartbeat perlu

Banyak koneksi tidak mati secara bersih.

Kemungkinan nyata:

- Wi-Fi pindah jaringan.
- Laptop sleep.
- Mobile browser background.
- NAT mapping expired.
- Proxy idle timeout.
- Load balancer menutup koneksi tanpa close frame yang terlihat aplikasi.
- Server rolling restart.
- Client tab crash.

Tanpa heartbeat, server bisa menyimpan `Session` yang secara logical sudah mati.

Dampaknya:

- registry membesar,
- broadcast membuang waktu,
- presence salah,
- queue outbound menumpuk,
- memory leak,
- user dianggap online padahal offline.

### 5.2 Dua jenis heartbeat

Ada dua level heartbeat:

```text
Protocol-level heartbeat:
  WebSocket Ping/Pong control frame

Application-level heartbeat:
  JSON message seperti {"type":"PING"} / {"type":"PONG"}
```

#### Protocol-level ping/pong

Kelebihan:

- bagian dari RFC WebSocket,
- lebih ringan,
- tidak bercampur dengan business message,
- bisa diproses di level WebSocket implementation.

Kekurangan:

- browser JavaScript API tidak menyediakan API eksplisit untuk mengirim Ping frame native dari browser; server dapat mengirim ping, browser akan merespons pong otomatis di level implementasi.
- tidak membawa metadata aplikasi seperti user state, cursor, version, atau tenant.
- observability aplikasi kadang lebih terbatas.

#### Application-level heartbeat

Kelebihan:

- bisa dikirim dari browser JavaScript sebagai message biasa,
- bisa membawa metadata seperti `lastReceivedSeq`, `clientTime`, `tabId`, `appVersion`, `subscriptionsHash`, `visibilityState`, dan lain-lain,
- mudah dimonitor di application log/metric.

Kekurangan:

- lebih verbose,
- harus divalidasi seperti message biasa,
- bisa tertahan di belakang outbound queue jika desain buruk,
- tidak sama dengan WebSocket control frame.

### 5.3 Rekomendasi praktis

Untuk browser-based WebSocket, pola yang robust:

```text
Server:
  - track lastInboundAt
  - optionally send protocol ping if API/container supports it cleanly
  - close connection if no inbound activity for threshold

Client:
  - send app heartbeat every N seconds while socket is open
  - include last received sequence/cursor if needed
  - reconnect if no server message/heartbeat response within threshold
```

Contoh application heartbeat:

```json
{
  "type": "HEARTBEAT",
  "connectionId": "c-01J...",
  "clientTime": "2026-06-17T09:20:00Z",
  "lastReceivedSeq": 1842,
  "subscriptionsHash": "sha256:..."
}
```

Server response opsional:

```json
{
  "type": "HEARTBEAT_ACK",
  "serverTime": "2026-06-17T09:20:01Z",
  "serverSeq": 1845,
  "reconnectRecommended": false
}
```

### 5.4 Memilih interval heartbeat

Jangan asal pilih 5 detik. Interval harus mempertimbangkan:

- proxy idle timeout,
- load balancer idle timeout,
- mobile/battery impact,
- jumlah koneksi,
- toleransi stale presence,
- biaya message,
- server capacity,
- browser background throttling.

Contoh pendekatan:

```text
LB idle timeout: 60s
Proxy idle timeout: 75s
Desired stale detection: < 90s

Heartbeat interval: 25s–30s
Miss threshold: 2–3 misses
Server close threshold: 75s–90s idle
Client reconnect threshold: 60s–90s no server activity
```

Jika ada 100.000 koneksi dan heartbeat tiap 10 detik:

```text
100.000 / 10 = 10.000 heartbeat/s inbound
```

Itu besar. Untuk sistem skala tinggi, heartbeat harus dihitung sebagai traffic production, bukan noise.

---

## 6. Idle Timeout Alignment

Reliability WebSocket sangat sering rusak karena timeout antar layer tidak sinkron.

Typical chain:

```text
Browser
  ↓
Corporate proxy / mobile network / NAT
  ↓
CDN / WAF
  ↓
Load balancer
  ↓
Ingress / reverse proxy
  ↓
Servlet container
  ↓
Jakarta WebSocket endpoint
```

Setiap layer bisa punya timeout sendiri.

| Layer | Contoh timeout | Risiko |
|---|---:|---|
| Browser/network | tidak deterministik | koneksi hilang tanpa close bersih |
| CDN/WAF | 60s/100s/300s | idle connection ditutup |
| ALB/LB | 60s default umum di beberapa platform | WebSocket reset jika heartbeat lebih jarang |
| Nginx/Ingress | `proxy_read_timeout` | WebSocket putus setiap N detik |
| Container | idle timeout WebSocket | session ditutup server |
| App heartbeat | custom | false positive/false negative |

Prinsip:

```text
Heartbeat interval harus lebih pendek dari timeout idle terpendek di chain.
Close detection threshold harus lebih pendek dari toleransi stale state aplikasi.
Reconnect jitter harus cukup untuk mencegah reconnect storm.
```

Contoh konfigurasi yang buruk:

```text
LB idle timeout      = 60s
App heartbeat        = 120s
Server idle timeout  = 180s
```

Akibat: LB menutup koneksi sebelum aplikasi mengirim heartbeat. Dari sisi aplikasi, koneksi mungkin terlihat mati mendadak.

Contoh konfigurasi lebih masuk akal:

```text
LB idle timeout      = 120s
Proxy read timeout   = 120s
App heartbeat        = 30s
Server suspect       = 75s no inbound
Server close         = 90s no inbound
Client reconnect     = 75s no server activity
```

---

## 7. Reconnect Policy

### 7.1 Reconnect adalah bagian normal WebSocket

WebSocket client production harus menganggap disconnect sebagai kejadian normal.

Penyebab disconnect:

- jaringan berubah,
- server deploy,
- node drain,
- auth expired,
- proxy idle close,
- rate limit,
- overload close,
- browser tab sleep,
- backend maintenance.

Client yang tidak punya reconnect policy akan membuat UX rapuh.

Client yang reconnect terlalu agresif akan membuat sistem jatuh saat outage.

### 7.2 Exponential backoff with jitter

Pola umum:

```text
attempt 1: 0.5s–1s
attempt 2: 1s–2s
attempt 3: 2s–4s
attempt 4: 4s–8s
attempt 5: 8s–16s
cap: 30s–60s
add jitter: randomize delay
```

Contoh pseudo-code client:

```javascript
let attempt = 0;
let socket = null;
let manuallyClosed = false;

function computeReconnectDelay(attempt) {
  const base = 500;
  const cap = 30000;
  const exponential = Math.min(cap, base * Math.pow(2, attempt));
  const jitter = Math.random() * exponential * 0.5;
  return Math.floor(exponential * 0.5 + jitter);
}

function connect() {
  socket = new WebSocket(buildWsUrl());

  socket.onopen = () => {
    attempt = 0;
    sendResumeOrSubscribe();
  };

  socket.onmessage = event => {
    handleMessage(JSON.parse(event.data));
  };

  socket.onclose = event => {
    if (manuallyClosed) return;

    if (event.code === 1008) {
      // Policy violation: probably auth/authorization problem.
      // Do not loop forever without refreshing auth or user action.
      triggerAuthRefreshOrLogout();
      return;
    }

    const delay = computeReconnectDelay(attempt++);
    setTimeout(connect, delay);
  };

  socket.onerror = () => {
    // Browser does not expose much detail here.
    // Let onclose handle reconnect.
  };
}
```

### 7.3 Close code should influence reconnect behavior

Close code bukan dekorasi; ia adalah signal reliability.

| Close code | Meaning umum | Reconnect behavior |
|---:|---|---|
| `1000` | normal closure | biasanya tidak reconnect kecuali app membutuhkan |
| `1001` | going away | reconnect boleh, dengan jitter |
| `1002` | protocol error | jangan retry membabi buta; ada bug/protocol mismatch |
| `1003` | unsupported data | jangan retry message yang sama |
| `1008` | policy violation | refresh auth / stop / user action |
| `1009` | message too big | client harus ubah payload/protocol |
| `1011` | unexpected server error | reconnect dengan backoff |
| custom `4xxx` | application-specific | definisikan kontrak internal |

Contoh custom close code policy:

| Code | Meaning | Client action |
|---:|---|---|
| `4001` | auth token expired | refresh token lalu reconnect |
| `4003` | authorization revoked | stop, tampilkan error |
| `4008` | rate limited | reconnect setelah server-suggested delay |
| `4012` | server restart/drain | reconnect dengan jitter |
| `4029` | too many connections | close tab lama atau backoff lama |

Catatan: pastikan custom code berada di range yang sesuai untuk aplikasi dan tidak bentrok dengan reserved code.

---

## 8. Resume Semantics: Reconnect Tanpa Kehilangan Konteks

Reconnect saja tidak cukup. Setelah reconnect, client harus tahu:

- apakah server mengenali sesi lama,
- subscription apa yang aktif,
- message terakhir yang diterima,
- event apa yang hilang selama offline,
- apakah user masih authorized,
- apakah data lokal harus refresh total.

### 8.1 Resume handshake di level aplikasi

Setelah WebSocket `onopen`, jangan langsung anggap semua state pulih. Kirim message resume:

```json
{
  "type": "RESUME",
  "clientId": "browser-installation-or-device-id",
  "tabId": "tab-abc",
  "previousConnectionId": "conn-old",
  "lastReceivedSeq": 1842,
  "subscriptions": [
    { "topic": "case:CASE-123" },
    { "topic": "user-notifications" }
  ],
  "clientVersion": "2026.06.17-1"
}
```

Server dapat merespons:

```json
{
  "type": "RESUME_ACCEPTED",
  "connectionId": "conn-new",
  "fromSeq": 1843,
  "replayed": 3,
  "requiresSnapshot": false
}
```

Atau:

```json
{
  "type": "RESUME_REJECTED",
  "connectionId": "conn-new",
  "reason": "REPLAY_WINDOW_EXPIRED",
  "requiresSnapshot": true
}
```

### 8.2 Resume modes

| Mode | Kapan dipakai | Konsekuensi |
|---|---|---|
| Full resubscribe | Sistem sederhana | Client daftar ulang semua topic |
| Resume with last seq | Event stream punya sequence | Bisa replay event yang hilang |
| Snapshot then stream | State besar/complex | Client ambil snapshot via HTTP lalu lanjut WebSocket |
| No resume | Chat/fire-and-forget sederhana | Ada risiko event hilang |

Top-tier design biasanya memisahkan:

```text
WebSocket = live delivery channel
HTTP/API  = snapshot and recovery channel
Store     = source of truth
```

Jangan jadikan WebSocket sebagai satu-satunya sumber state permanen.

---

## 9. Message Identity, ACK, dan Retry

### 9.1 Message harus punya identitas

Jika message penting, ia butuh ID.

Contoh envelope:

```json
{
  "messageId": "msg-01J...",
  "type": "CASE_STATUS_CHANGED",
  "stream": "case:CASE-123",
  "seq": 1843,
  "occurredAt": "2026-06-17T09:30:00Z",
  "payload": {
    "caseId": "CASE-123",
    "from": "DRAFT",
    "to": "SUBMITTED"
  }
}
```

Field penting:

| Field | Fungsi |
|---|---|
| `messageId` | deduplication global/per-stream |
| `stream` | grouping ordering |
| `seq` | ordering dan replay cursor |
| `occurredAt` | audit/debug |
| `type` | dispatch schema |
| `payload` | business data |

### 9.2 ACK pattern

ACK bisa dilakukan di beberapa level.

#### Transport-ish ACK

Client mengakui message diterima oleh aplikasi client:

```json
{
  "type": "ACK",
  "messageId": "msg-01J...",
  "stream": "case:CASE-123",
  "seq": 1843
}
```

Ini tidak berarti user sudah melihat atau business action sudah selesai. Hanya berarti client application menerima dan memproses sampai titik tertentu.

#### Business ACK

Untuk command dari client ke server:

```json
{
  "type": "COMMAND_ACK",
  "commandId": "cmd-01J...",
  "status": "ACCEPTED"
}
```

Lalu result final:

```json
{
  "type": "COMMAND_RESULT",
  "commandId": "cmd-01J...",
  "status": "COMPLETED",
  "result": {
    "caseId": "CASE-123",
    "newStatus": "SUBMITTED"
  }
}
```

Pemisahan ini penting untuk operation long-running:

```text
Client sends command
  ↓
Server validates and accepts command
  ↓
Server persists command/job
  ↓
Server eventually emits result/event
```

Tanpa pemisahan, client tidak tahu apakah command hilang, sedang diproses, atau gagal.

### 9.3 Retry policy

Retry harus berbasis idempotency.

Client command:

```json
{
  "type": "SUBMIT_CASE",
  "commandId": "cmd-01J...",
  "idempotencyKey": "case-CASE-123-submit-by-user-U1-v1",
  "payload": {
    "caseId": "CASE-123"
  }
}
```

Server menyimpan hasil command berdasarkan `idempotencyKey`.

Jika client retry karena reconnect:

- kalau command belum diproses → proses,
- kalau sedang diproses → return accepted/in progress,
- kalau sudah sukses → return same result,
- kalau sudah gagal permanen → return same failure.

Tanpa idempotency, reconnect bisa menghasilkan double submit, double payment, double approval, double notification, atau double state transition.

---

## 10. Delivery Guarantees

WebSocket secara native memberikan ordered byte stream di atas satu TCP connection, tetapi application-level reliability tetap tergantung desain.

### 10.1 At-most-once

```text
Server sends once.
If client disconnected, message may be lost.
No retry/replay.
```

Cocok untuk:

- typing indicator,
- ephemeral presence ping,
- live cursor movement,
- temporary UI animation,
- non-critical telemetry.

Kelebihan:

- simple,
- low overhead.

Kekurangan:

- message bisa hilang.

### 10.2 At-least-once

```text
Server retries/replays until ACK or within replay window.
Client may receive duplicate.
```

Cocok untuk:

- notification penting,
- case status changed,
- approval update,
- task assigned,
- report ready.

Kelebihan:

- lebih tahan disconnect.

Kekurangan:

- perlu deduplication,
- duplicate harus aman.

### 10.3 Effectively-once

```text
At-least-once delivery + idempotent processing + deduplication + deterministic state transition.
```

Ini bukan magic exactly-once. Ini desain end-to-end.

Contoh:

```text
Server emits event with eventId and seq.
Client stores last processed seq per stream.
Client ignores duplicate seq/messageId.
Client fetches snapshot if gap detected.
```

Untuk sistem regulatory/case management, target realistis sering:

```text
Critical command: idempotent command processing
Critical event: at-least-once delivery with dedup + replay/snapshot
Ephemeral UI signal: at-most-once
```

---

## 11. Ordering dan Sequence Number

### 11.1 Ordering scope harus eksplisit

Jangan menuntut global ordering untuk seluruh aplikasi kecuali benar-benar perlu. Global ordering mahal dan rapuh.

Lebih baik tentukan ordering scope:

| Scope | Contoh |
|---|---|
| per connection | message outbound ke satu WebSocket session |
| per user | notification user tertentu |
| per room | chat room tertentu |
| per case | case event stream |
| per tenant | audit stream tenant |
| global | jarang, biasanya event log khusus |

Contoh per-case ordering:

```json
{
  "stream": "case:CASE-123",
  "seq": 104,
  "type": "CASE_ASSIGNED"
}
```

Client menyimpan:

```text
lastSeq["case:CASE-123"] = 103
```

Ketika menerima seq 104:

```text
expected = 104 → process → lastSeq = 104
```

Ketika menerima seq 106:

```text
expected = 105 → gap detected → pause/apply recovery
```

Ketika menerima seq 104 lagi:

```text
seq <= lastSeq → duplicate → ignore
```

### 11.2 Gap recovery

Jika gap terdeteksi:

```text
Client receives seq 106 while lastSeq is 104.
Missing 105.
```

Opsi recovery:

1. Request replay:

```json
{
  "type": "REPLAY_REQUEST",
  "stream": "case:CASE-123",
  "fromSeq": 105,
  "toSeq": 106
}
```

2. Fetch snapshot via HTTP:

```text
GET /api/cases/CASE-123
```

3. Mark view stale and ask user refresh.

Untuk data penting, snapshot recovery sering lebih sederhana daripada replay tak terbatas.

---

## 12. Replay Window

Replay membutuhkan penyimpanan event/message selama periode tertentu.

Contoh:

```text
Store outbound events per stream for 15 minutes or last 1000 events.
```

Replay window harus menjawab:

- berapa lama client boleh offline dan masih resume?
- berapa banyak event disimpan?
- disimpan di memory, Redis, DB, Kafka, atau broker?
- apakah replay per user atau per topic?
- bagaimana authorization dicek ulang saat replay?
- bagaimana event lama yang sudah tidak boleh dilihat user?

### 12.1 Memory replay buffer

Cocok untuk:

- single node,
- non-critical update,
- low traffic,
- short reconnect.

Risiko:

- hilang saat node restart,
- tidak bekerja lintas node,
- memory leak jika tidak dibatasi.

### 12.2 Redis replay buffer

Cocok untuk:

- multi-node,
- short retention,
- moderate throughput.

Pola:

```text
Redis Stream / List / Sorted Set
key: ws:stream:case:CASE-123
retention: 15 minutes / max length N
```

### 12.3 Kafka/RabbitMQ-backed stream

Cocok untuk:

- event-driven architecture,
- durable event source,
- fan-out besar,
- replay formal.

Namun jangan langsung membawa Kafka hanya untuk WebSocket kecil. Kompleksitas operasionalnya nyata.

### 12.4 Database event table

Cocok untuk:

- auditability,
- regulatory trace,
- business event yang durable,
- snapshot rebuild.

Trade-off:

- latency lebih tinggi,
- perlu indexing,
- retention/archival,
- jangan overload DB untuk heartbeat/ephemeral event.

---

## 13. Slow Client dan Backpressure

### 13.1 Slow client adalah reliability hazard

Satu client lambat tidak boleh membuat:

- broadcast lambat untuk semua,
- worker thread tertahan,
- memory queue membengkak,
- connection registry terkunci,
- GC pressure naik,
- node OOM.

Slow client terjadi karena:

- jaringan lambat,
- browser tab background,
- device low-end,
- mobile network,
- corporate proxy,
- client tidak membaca message cepat,
- payload terlalu besar.

### 13.2 Anti-pattern: send langsung dalam loop broadcast

Buruk:

```java
for (Session session : sessions) {
    session.getBasicRemote().sendText(message);
}
```

Masalah:

- `BasicRemote` blocking.
- Satu client lambat menahan loop.
- Error handling buruk.
- Broadcast latency memburuk.
- Thread container bisa tertahan.

Lebih baik:

```text
broadcast event
  ↓
for each connection: enqueue bounded
  ↓
per connection single writer drains queue
  ↓
if queue full: apply policy
```

### 13.3 Bounded queue per connection

```java
final class WsConnection {
    final String connectionId;
    final Session session;
    final BlockingQueue<OutboundMessage> queue = new ArrayBlockingQueue<>(256);
    final AtomicBoolean writerRunning = new AtomicBoolean(false);
    volatile long lastAckSeq;
    volatile long lastSeenAt;
}
```

Queue policy:

| Policy | Cocok untuk | Risiko |
|---|---|---|
| drop newest | telemetry/UI ephemeral | user kehilangan update baru |
| drop oldest | dashboard latest-state | urutan event bisa rusak |
| coalesce | state update seperti progress | butuh merge logic |
| close slow client | critical ordered stream | client harus reconnect/recover |
| degrade topic | low priority topic | kompleksitas subscription |

Untuk regulatory/case event yang ordered, policy yang sering lebih aman:

```text
If outbound queue full for critical stream:
  close connection with specific close code/reason
  client reconnects
  client resumes from last acknowledged seq or fetches snapshot
```

Lebih baik memaksa recovery daripada menyimpan queue tak terbatas.

### 13.4 Coalescing untuk latest-state update

Misalnya progress report:

```text
10%, 11%, 12%, 13%, 14%, 15%
```

Jika client lambat, tidak perlu semua dikirim. Bisa coalesce menjadi:

```text
15%
```

Contoh event yang bisa di-coalesce:

- progress percentage,
- online member count,
- dashboard metric,
- cursor position,
- typing indicator,
- latest notification badge count.

Event yang tidak boleh sembarang di-coalesce:

- audit event,
- case state transition,
- financial transaction,
- approval action,
- legal workflow event.

---

## 14. Admission Control dan Rate Limiting

Reliability bukan hanya bertahan dari network failure. Reliability juga berarti sistem tidak membiarkan client merusak server.

### 14.1 Connection admission

Saat `onOpen`, validasi:

- authentication valid,
- origin allowed,
- tenant valid,
- max connection per user,
- max connection per IP,
- max connection per tenant,
- maintenance/drain mode,
- server capacity.

Contoh policy:

```text
max 5 active WebSocket connections per user
max 1000 per tenant per node
max 20 connection attempts per IP per minute
```

Jika melebihi:

```text
close 4029 TOO_MANY_CONNECTIONS
or reject handshake if possible
```

### 14.2 Inbound message rate limit

Rate limit per:

- connection,
- user,
- IP,
- tenant,
- message type,
- topic.

Contoh:

```text
HEARTBEAT: 1 per 10s expected, tolerate burst 3
SUBSCRIBE: 30 per minute
COMMAND: 10 per minute
CHAT_MESSAGE: 60 per minute
```

Pelanggaran ringan:

```json
{
  "type": "ERROR",
  "code": "RATE_LIMITED",
  "retryAfterMs": 5000
}
```

Pelanggaran berat:

```text
close 4008 RATE_LIMITED
```

### 14.3 Payload size limit

Payload besar bisa menjadi DoS vector.

Limit harus diatur di beberapa layer:

- WebSocket session max text/binary buffer size,
- application schema limit,
- reverse proxy if applicable,
- broker message limit,
- DB field limit.

Jangan menerima JSON arbitrarily large.

---

## 15. Message Schema Versioning

WebSocket connection bisa hidup lama. Selama connection hidup, deployment baru bisa terjadi.

Masalah:

- server mengirim message type baru,
- client lama tidak paham field baru,
- client mengirim command lama,
- rolling deployment membuat node versi berbeda,
- tab browser masih memuat bundle lama.

### 15.1 Envelope version

```json
{
  "schemaVersion": 2,
  "type": "CASE_STATUS_CHANGED",
  "messageId": "msg-01J...",
  "payload": {}
}
```

### 15.2 Capability negotiation

Saat connect/resume:

```json
{
  "type": "HELLO",
  "clientVersion": "2026.06.17-1",
  "capabilities": [
    "ack.v1",
    "resume.v2",
    "case-event.v3",
    "heartbeat.v1"
  ]
}
```

Server response:

```json
{
  "type": "HELLO_ACK",
  "connectionId": "conn-123",
  "serverVersion": "2026.06.17-2",
  "enabledCapabilities": [
    "ack.v1",
    "resume.v2",
    "case-event.v3"
  ],
  "minimumClientVersion": "2026.06.01-1"
}
```

### 15.3 Backward compatibility rules

- Additive fields are allowed.
- Removing fields requires version bump.
- Changing enum meaning requires version bump.
- Unknown message type should not crash client.
- Unknown field should be ignored unless strict mode needed.
- Server can close with `UPGRADE_REQUIRED` custom code if client version too old.

---

## 16. Authentication Expiry dan Authorization Drift

WebSocket bisa hidup lebih lama daripada token/session validity.

Masalah:

```text
User opens WebSocket at 09:00.
Token valid until 09:30.
At 09:45 connection still open.
Can server still send data?
```

Jawabannya tergantung policy, tetapi harus eksplisit.

### 16.1 Auth strategies

| Strategy | Behavior | Trade-off |
|---|---|---|
| Auth only at handshake | simple | stale authorization risk |
| Periodic revalidation | safer | DB/cache lookup cost |
| Token refresh message | browser-friendly | protocol complexity |
| Short-lived connection | force reconnect | reconnect overhead |
| Server-side session invalidation push | strong | needs shared session/auth event |

### 16.2 Re-auth message

Server dapat meminta re-auth:

```json
{
  "type": "REAUTH_REQUIRED",
  "reason": "TOKEN_EXPIRING",
  "deadlineMs": 60000
}
```

Client refresh token/session via normal HTTP/OIDC flow, lalu:

```json
{
  "type": "REAUTH",
  "tokenRefreshed": true
}
```

Atau reconnect dengan token/cookie baru.

### 16.3 Authorization per message/topic

Jangan hanya validasi saat connect jika data sensitif per topic.

Contoh:

```text
User boleh connect.
User subscribe case:CASE-123.
Besok permission user dicabut.
Server masih punya subscription lama.
```

Solusi:

- re-check authorization saat subscribe,
- re-check sebelum mengirim event sensitif,
- listen authz change event dan revoke subscription,
- close connection atau unsubscribe topic saat permission berubah.

---

## 17. Presence Reliability

Presence terlihat sederhana: online/offline. Tetapi ini salah satu fitur WebSocket paling sering salah.

### 17.1 Presence bukan boolean sederhana

User bisa punya:

- banyak tab,
- banyak device,
- koneksi lama yang belum cleanup,
- tab background,
- network flapping,
- server node berbeda.

Presence model yang lebih benar:

```text
User online if active connection count > 0 within freshness window.
User offline only after debounce/grace period with no active connection.
```

### 17.2 Presence key design

```text
presence:user:{userId}
  connectionCount
  lastSeenAt
  devices/tabs
  nodeIds
```

Connection registry lokal:

```text
node:{nodeId}:connections
connection:{connectionId} → userId, openedAt, lastSeenAt
```

Cluster presence di Redis:

```text
ws:presence:user:U1 = {
  "connections": ["nodeA:c1", "nodeB:c2"],
  "lastSeenAt": "..."
}
```

### 17.3 Offline debounce

Jangan langsung emit offline saat satu connection close.

Pola:

```text
onClose connection c1:
  remove c1
  if no remaining connection:
     schedule offline event after 15s
  if new connection appears before 15s:
     cancel offline
```

Ini menghindari flicker saat reconnect cepat.

---

## 18. Clustered WebSocket Reliability

### 18.1 Problem multi-node

Dalam cluster:

```text
User A connected to node-1
User B connected to node-2
Business event created on node-3
```

Node-3 tidak punya session object user A/B. Jadi broadcast lokal tidak cukup.

### 18.2 Common architecture

```text
Business service/event source
  ↓
Broker / pub-sub / event bus
  ↓
Each WebSocket node subscribes
  ↓
Node sends only to local sessions
```

Diagram:

```text
          ┌──────────────┐
          │ Event Source │
          └──────┬───────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Broker / Redis  │
        │ PubSub / Kafka  │
        └──────┬────┬─────┘
               │    │
       ┌───────▼┐  ┌▼────────┐
       │ WS N1  │  │ WS N2   │
       └───┬────┘  └────┬────┘
           │            │
       local sessions   local sessions
```

### 18.3 Sticky session: useful but not sufficient

Sticky session helps ensure the same client usually reconnects to the same node.

But sticky session does not solve:

- node crash,
- rolling update,
- cross-node broadcast,
- distributed presence,
- replay after node loss,
- durable delivery.

Treat sticky session as optimization, not correctness foundation.

### 18.4 Node-local vs distributed state

| State | Node-local okay? | Need distributed? |
|---|---|---|
| `jakarta.websocket.Session` object | yes | cannot distribute |
| TCP connection | yes | cannot distribute |
| per-connection send queue | yes | usually local |
| user presence | sometimes | yes for cluster-wide presence |
| subscription list | local plus optional distributed index | yes if event routing needs it |
| durable event cursor | no | yes |
| replay buffer | maybe | yes if node crash recovery needed |

---

## 19. Broker Integration Patterns

### 19.1 When to introduce broker

Introduce broker/pub-sub when:

- multiple WebSocket nodes exist,
- events originate outside WebSocket node,
- fan-out is large,
- replay is needed,
- slow/failed downstream must be isolated,
- event source should not know connection registry.

Avoid broker if:

- single node/simple app,
- events are purely local and ephemeral,
- operational complexity is not justified.

### 19.2 Redis Pub/Sub

Cocok untuk:

- simple fan-out,
- low latency,
- no durability needed.

Limitasi:

- subscriber offline → message lost,
- no built-in replay,
- not enough for critical delivery.

### 19.3 Redis Streams

Cocok untuk:

- short retention replay,
- consumer groups,
- moderate durability.

Trade-off:

- perlu trimming,
- perlu ack/claim management,
- ordering per stream perlu desain.

### 19.4 RabbitMQ

Cocok untuk:

- routing topic,
- queues,
- backpressure via broker,
- reliable broker delivery to WebSocket gateway.

Trade-off:

- WebSocket client still needs ACK/dedup if critical,
- broker ACK bukan client ACK,
- fan-out ke banyak node perlu exchange design.

### 19.5 Kafka

Cocok untuk:

- durable ordered event log,
- replay,
- high throughput,
- event sourcing-ish streams.

Trade-off:

- consumer group semantics harus hati-hati untuk broadcast; consumer group membagi message, bukan broadcast ke semua node kecuali setiap node punya group sendiri atau design topic berbeda.
- operational complexity tinggi.

### 19.6 Broker ACK bukan user ACK

Penting:

```text
Broker delivered event to WebSocket node ≠ browser received event.
Browser received event ≠ user saw event.
User saw event ≠ business process completed.
```

ACK harus didefinisikan sesuai level guarantee.

---

## 20. Graceful Shutdown dan Rolling Deployment

### 20.1 WebSocket membuat shutdown lebih sulit

HTTP request biasanya selesai cepat. WebSocket bisa hidup berjam-jam.

Saat deploy:

```text
Kubernetes sends SIGTERM
  ↓
readiness should turn false
  ↓
load balancer stops new traffic
  ↓
existing WebSocket sessions still open
  ↓
server must decide drain policy
```

### 20.2 Drain policy

Opsi:

1. **Immediate close**
   - cepat,
   - reconnect storm risk.

2. **Graceful close with retry hint**
   - server kirim message `SERVER_DRAINING`, lalu close.

3. **Drain window**
   - stop accepting new sessions,
   - let existing sessions reconnect gradually,
   - close remaining after deadline.

Contoh drain message:

```json
{
  "type": "SERVER_DRAINING",
  "reason": "DEPLOYMENT",
  "reconnectAfterMs": 3000,
  "jitterMs": 10000
}
```

Kemudian close:

```text
close code: 4012
reason: SERVER_RESTART
```

### 20.3 Client behavior saat drain

Client harus:

- tidak reconnect langsung serentak,
- apply jitter,
- resume subscription/cursor,
- tolerate old connection close after new connection open.

### 20.4 Server readiness during drain

Saat drain:

```text
readiness = false
accept new WebSocket = false
existing connection = allowed until deadline
```

Jika readiness tetap true sampai process mati, LB bisa tetap mengirim handshake baru ke node yang akan terminate.

---

## 21. Reconnect Storm

Reconnect storm terjadi saat banyak client reconnect bersamaan.

Penyebab:

- deploy semua node bersamaan,
- broker outage,
- LB timeout seragam,
- server close semua connection tanpa jitter,
- client reconnect delay fixed,
- DNS/load balancer issue.

Dampak:

- handshake spike,
- auth service spike,
- DB/session lookup spike,
- subscription replay spike,
- broker resubscribe spike,
- CPU/GC naik,
- rate limit false positive,
- cascading failure.

Mitigasi:

```text
Client:
  - exponential backoff
  - full jitter
  - honor Retry-After/reconnectAfter
  - cap attempts

Server:
  - drain gradually
  - reject excess handshake with retry hint
  - cache auth/session lookup carefully
  - admission control
  - stagger deployment

Infrastructure:
  - rolling update maxUnavailable controlled
  - readiness gating
  - LB connection draining
  - avoid simultaneous restart all pods
```

---

## 22. Designing WebSocket Protocol Envelope

A reliable WebSocket app needs consistent envelope.

Example envelope:

```json
{
  "schemaVersion": 1,
  "messageId": "msg-01J...",
  "correlationId": "corr-01J...",
  "causationId": "cmd-01J...",
  "type": "CASE_STATUS_CHANGED",
  "stream": "case:CASE-123",
  "seq": 1843,
  "sentAt": "2026-06-17T09:45:00Z",
  "requiresAck": true,
  "payload": {}
}
```

Field reasoning:

| Field | Why it exists |
|---|---|
| `schemaVersion` | compatibility |
| `messageId` | dedup |
| `correlationId` | trace across HTTP/WebSocket/broker |
| `causationId` | link event to command |
| `type` | dispatch |
| `stream` | ordering/replay scope |
| `seq` | gap detection |
| `sentAt` | latency/debug |
| `requiresAck` | delivery policy |
| `payload` | business content |

Error envelope:

```json
{
  "type": "ERROR",
  "correlationId": "corr-01J...",
  "code": "VALIDATION_FAILED",
  "message": "Invalid subscription request.",
  "details": [
    { "field": "topic", "reason": "not allowed" }
  ],
  "retryable": false
}
```

---

## 23. Command vs Event Pattern

Jangan campur command dan event.

### 23.1 Command

Command adalah permintaan melakukan sesuatu.

```json
{
  "type": "COMMAND",
  "commandName": "SUBSCRIBE_CASE",
  "commandId": "cmd-01J...",
  "payload": {
    "caseId": "CASE-123"
  }
}
```

Server response:

```json
{
  "type": "COMMAND_ACK",
  "commandId": "cmd-01J...",
  "status": "ACCEPTED"
}
```

Atau:

```json
{
  "type": "COMMAND_REJECTED",
  "commandId": "cmd-01J...",
  "code": "FORBIDDEN"
}
```

### 23.2 Event

Event adalah fakta yang sudah terjadi.

```json
{
  "type": "EVENT",
  "eventName": "CASE_STATUS_CHANGED",
  "eventId": "evt-01J...",
  "stream": "case:CASE-123",
  "seq": 1843,
  "payload": {
    "from": "DRAFT",
    "to": "SUBMITTED"
  }
}
```

### 23.3 Kenapa pemisahan ini penting

Jika command dan event dicampur:

- client tidak tahu message perlu retry atau tidak,
- server sulit memberi ACK,
- replay event bisa menjalankan command ulang,
- idempotency kacau,
- audit trail sulit.

Mental model:

```text
Command may fail or be rejected.
Event is a fact, should be replayable and deduplicatable.
```

---

## 24. Reliability Pattern by Use Case

### 24.1 Notification badge

Requirement:

- user melihat jumlah notifikasi terbaru,
- tidak harus semua delta terkirim,
- final count harus benar.

Pattern:

```text
WebSocket sends latest count.
Client may miss updates.
On reconnect or page focus, client fetches count via HTTP.
Coalesce outbound count messages.
```

Guarantee:

```text
At-most-once live update + HTTP snapshot correction
```

### 24.2 Chat message

Requirement:

- message tidak boleh hilang,
- duplicate harus dihindari,
- order per room penting.

Pattern:

```text
Client sends command with clientMessageId.
Server persists message.
Server emits event with room seq.
Client ACKs received seq.
Reconnect resumes from last room seq.
```

Guarantee:

```text
At-least-once event delivery + client dedup + per-room ordering
```

### 24.3 Case status update

Requirement:

- event penting,
- auditability penting,
- client UI harus eventually correct.

Pattern:

```text
Status transition persists in DB.
Business event emitted.
WebSocket sends event.
Client validates seq/gap.
If gap or replay window expired, fetch case snapshot via HTTP.
```

Guarantee:

```text
Durable source of truth + live event + snapshot recovery
```

### 24.4 Report generation progress

Requirement:

- progress real-time nice-to-have,
- final result penting.

Pattern:

```text
Progress events coalesced.
Final REPORT_READY event durable.
Client can poll HTTP if WebSocket unavailable.
```

Guarantee:

```text
Ephemeral progress + durable completion event
```

### 24.5 Collaborative editing

Requirement:

- low latency,
- ordering/conflict resolution critical,
- offline/reconnect complex.

Pattern:

```text
Use OT/CRDT or server-authoritative operation log.
WebSocket only transports operations.
Each operation has id, version/vector clock.
Snapshot/rebase on reconnect.
```

Guarantee:

```text
Depends on collaboration algorithm, not WebSocket itself
```

---

## 25. Implementation Skeleton: Reliable-ish WebSocket Gateway

### 25.1 Connection state

```java
public final class ConnectionState {
    public final String connectionId;
    public final String userId;
    public final Session session;
    public final BlockingQueue<OutboundEnvelope> outboundQueue;
    public final AtomicBoolean closed = new AtomicBoolean(false);
    public final AtomicBoolean writerRunning = new AtomicBoolean(false);

    public volatile long openedAtMillis;
    public volatile long lastInboundAtMillis;
    public volatile long lastOutboundAtMillis;
    public volatile long lastAckSeq;

    public ConnectionState(String connectionId, String userId, Session session, int queueCapacity) {
        this.connectionId = connectionId;
        this.userId = userId;
        this.session = session;
        this.outboundQueue = new ArrayBlockingQueue<>(queueCapacity);
        long now = System.currentTimeMillis();
        this.openedAtMillis = now;
        this.lastInboundAtMillis = now;
        this.lastOutboundAtMillis = now;
    }
}
```

### 25.2 Registry

```java
public final class WebSocketRegistry {
    private final ConcurrentHashMap<String, ConnectionState> byConnectionId = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Set<String>> byUserId = new ConcurrentHashMap<>();

    public void add(ConnectionState c) {
        byConnectionId.put(c.connectionId, c);
        byUserId.computeIfAbsent(c.userId, ignored -> ConcurrentHashMap.newKeySet())
                .add(c.connectionId);
    }

    public void remove(ConnectionState c) {
        byConnectionId.remove(c.connectionId);
        Set<String> ids = byUserId.get(c.userId);
        if (ids != null) {
            ids.remove(c.connectionId);
            if (ids.isEmpty()) {
                byUserId.remove(c.userId, ids);
            }
        }
    }

    public Collection<ConnectionState> connectionsOfUser(String userId) {
        Set<String> ids = byUserId.getOrDefault(userId, Set.of());
        List<ConnectionState> result = new ArrayList<>();
        for (String id : ids) {
            ConnectionState c = byConnectionId.get(id);
            if (c != null) result.add(c);
        }
        return result;
    }
}
```

### 25.3 Enqueue with bounded policy

```java
public boolean send(ConnectionState c, OutboundEnvelope message) {
    if (c.closed.get()) return false;

    boolean offered = c.outboundQueue.offer(message);
    if (!offered) {
        closeSlowClient(c, "OUTBOUND_QUEUE_FULL");
        return false;
    }

    startWriterIfNeeded(c);
    return true;
}
```

### 25.4 Single writer loop

```java
private void startWriterIfNeeded(ConnectionState c) {
    if (!c.writerRunning.compareAndSet(false, true)) {
        return;
    }

    writerExecutor.execute(() -> {
        try {
            while (!c.closed.get()) {
                OutboundEnvelope msg = c.outboundQueue.poll();
                if (msg == null) {
                    return;
                }

                String json = encode(msg);
                c.session.getAsyncRemote().sendText(json, result -> {
                    if (!result.isOK()) {
                        closeDueToSendFailure(c, result.getException());
                    }
                });

                c.lastOutboundAtMillis = System.currentTimeMillis();
            }
        } finally {
            c.writerRunning.set(false);
            if (!c.outboundQueue.isEmpty() && !c.closed.get()) {
                startWriterIfNeeded(c);
            }
        }
    });
}
```

Catatan:

- Skeleton ini belum lengkap untuk ordered async send di semua implementasi; production code harus memastikan tidak ada concurrent send hazard sesuai behavior container yang dipakai.
- Untuk stream critical, tunggu callback send sebelum mengirim message berikutnya jika ordering harus ketat.
- Jangan menjadikan sample ini sebagai copy-paste final tanpa load test dan container-specific validation.

### 25.5 Idempotent cleanup

```java
public void cleanup(ConnectionState c, String reason) {
    if (!c.closed.compareAndSet(false, true)) {
        return;
    }

    registry.remove(c);
    subscriptionRegistry.removeAll(c.connectionId);
    c.outboundQueue.clear();

    try {
        if (c.session.isOpen()) {
            c.session.close(new CloseReason(
                CloseReason.CloseCodes.NORMAL_CLOSURE,
                reason
            ));
        }
    } catch (Exception ignored) {
        // Cleanup must not fail because close failed.
    }
}
```

---

## 26. Observability for Reliability

Tanpa metric, WebSocket reliability hanya perasaan.

### 26.1 Connection metrics

- active connections per node,
- active connections per user/tenant,
- new connections per second,
- closes per second,
- close code distribution,
- average connection lifetime,
- reconnect rate,
- rejected handshake count,
- auth failure count,
- max connections reached.

### 26.2 Heartbeat metrics

- heartbeat received rate,
- heartbeat latency,
- missed heartbeat count,
- suspect connections,
- idle timeout close count,
- false positive suspicion.

### 26.3 Message metrics

- inbound messages/sec by type,
- outbound messages/sec by type,
- payload size distribution,
- send latency,
- encode/decode latency,
- ACK latency,
- duplicate message count,
- replay request count,
- replay success/failure,
- gap detected count.

### 26.4 Queue/backpressure metrics

- outbound queue depth per connection,
- max queue depth,
- queue full close count,
- dropped/coalesced message count,
- slow client count,
- broadcast duration,
- per-topic fan-out size.

### 26.5 Cluster metrics

- broker lag,
- pub/sub delivery latency,
- node local sessions,
- distributed presence count,
- subscription count by topic,
- stale presence cleanup count.

### 26.6 Logs

Every important lifecycle log should include:

```text
connectionId
userId or anonymized principal id
tenantId
nodeId
remoteAddr / forwarded info if safe
sessionId hash if relevant
closeCode
closeReason
correlationId
messageId / commandId
stream
seq
latency
queueDepth
```

Jangan log payload sensitif secara mentah.

---

## 27. Failure Model Catalog

### 27.1 Network drop

Symptom:

- no `onClose` immediately,
- send eventually fails,
- heartbeat missed.

Mitigation:

- heartbeat,
- idle timeout,
- idempotent cleanup,
- reconnect/resume.

### 27.2 Proxy idle timeout

Symptom:

- disconnect every fixed interval,
- close code may be abnormal,
- server/client sees reset.

Mitigation:

- align heartbeat < proxy timeout,
- configure proxy WebSocket timeout,
- monitor close timing histogram.

### 27.3 Slow client

Symptom:

- outbound queue grows,
- broadcast latency high,
- memory rises.

Mitigation:

- bounded queue,
- single-writer,
- coalesce/drop/close policy,
- per-client metrics.

### 27.4 Reconnect storm

Symptom:

- connection attempts spike,
- auth/session backend spike,
- CPU high after deploy/outage.

Mitigation:

- jitter,
- backoff,
- drain message,
- admission control,
- stagger deploy.

### 27.5 Duplicate message

Symptom:

- double notification,
- duplicate command effect,
- UI counter wrong.

Mitigation:

- messageId,
- commandId,
- idempotency key,
- client dedup cache.

### 27.6 Message gap

Symptom:

- client expected seq 105 but got 106.

Mitigation:

- replay request,
- snapshot recovery,
- stream cursor.

### 27.7 Authorization drift

Symptom:

- user keeps receiving topic after permission revoked.

Mitigation:

- revalidate subscription,
- authz change event,
- revoke topic/close connection,
- short-lived subscription lease.

### 27.8 Node restart

Symptom:

- all sessions on node drop.

Mitigation:

- graceful drain,
- reconnect with jitter,
- durable cursor/replay/snapshot,
- avoid node-local correctness state.

---

## 28. Reliability Design Decision Matrix

| Requirement | Recommended pattern |
|---|---|
| Real-time but not critical | at-most-once + snapshot refresh |
| Critical notification | messageId + ACK + replay window |
| Command with side effect | commandId + idempotency key + persisted result |
| Ordered event stream | per-stream seq + gap recovery |
| Many clients per topic | broker/pub-sub + local fan-out |
| Multi-node presence | distributed presence + debounce |
| Large fan-out | bounded queues + coalescing/drop/close policy |
| Server deploy | drain + close code + jittered reconnect |
| Auth expiry | reauth/reconnect policy + periodic authz validation |
| Slow client | single writer + bounded queue + slow-client close |
| Mobile/browser sleep | heartbeat tolerant + resume/snapshot |
| Regulatory/audit domain | durable source of truth, WebSocket only live projection |

---

## 29. Anti-Patterns

### 29.1 Treating WebSocket as database

Buruk:

```text
State hanya ada di active WebSocket session.
Jika node restart, state hilang.
```

Benar:

```text
WebSocket is transport/projection.
Source of truth is DB/event store/domain service.
```

### 29.2 Unlimited outbound queue

Buruk:

```text
Slow client → queue grows forever → OOM.
```

Benar:

```text
Bounded queue + explicit overflow policy.
```

### 29.3 No message ID

Buruk:

```text
Duplicate cannot be detected.
Retry unsafe.
```

Benar:

```text
messageId/commandId/idempotencyKey.
```

### 29.4 Fixed reconnect delay

Buruk:

```text
All clients reconnect every 1 second.
```

Benar:

```text
Exponential backoff + jitter + server retry hints.
```

### 29.5 Presence as immediate on/off

Buruk:

```text
onOpen → online
onClose → offline
```

Benar:

```text
online if active count > 0
offline after debounce if no active connection remains
```

### 29.6 Authorization only at handshake

Buruk for sensitive domains:

```text
User authorized at 09:00; permission revoked at 09:05; connection still receives data.
```

Benar:

```text
Validate subscription and sensitive send path; revoke on authz change.
```

### 29.7 Broadcasting with blocking send loop

Buruk:

```java
for (Session s : sessions) {
    s.getBasicRemote().sendText(msg);
}
```

Benar:

```text
fan-out to per-connection bounded queue; isolate slow clients.
```

---

## 30. Production Checklist

### 30.1 Connection lifecycle

- [ ] Every connection gets unique `connectionId`.
- [ ] `onOpen`, `onClose`, `onError` logs include connection id and node id.
- [ ] Cleanup is idempotent.
- [ ] Registry does not leak stale sessions.
- [ ] Server can reject new connections during drain.
- [ ] Max connections per user/IP/tenant are enforced.

### 30.2 Heartbeat and timeout

- [ ] Heartbeat interval is shorter than shortest idle timeout in path.
- [ ] Missed heartbeat threshold is explicit.
- [ ] Client reconnects if no server activity.
- [ ] Server closes stale/suspect connection.
- [ ] Idle timeout config documented across LB/proxy/container/app.

### 30.3 Message reliability

- [ ] Important messages have `messageId`.
- [ ] Ordered streams have `seq`.
- [ ] Client tracks last processed seq.
- [ ] Duplicate handling is implemented.
- [ ] Gap recovery strategy exists.
- [ ] Replay window or snapshot fallback exists.
- [ ] Commands have `commandId` and idempotency key if side-effecting.

### 30.4 Backpressure

- [ ] Per-connection outbound queue is bounded.
- [ ] Queue overflow policy is explicit.
- [ ] Slow client close/drop/coalesce policy exists.
- [ ] Broadcast does not block on one client.
- [ ] Send latency and queue depth are measured.

### 30.5 Reconnect

- [ ] Client uses exponential backoff with jitter.
- [ ] Close code influences behavior.
- [ ] Server can send drain/retry hint.
- [ ] Reconnect storm has been load-tested.
- [ ] Resume/resubscribe flow is defined.

### 30.6 Security and authorization

- [ ] Origin validated.
- [ ] Authentication checked at handshake.
- [ ] Authorization checked per subscribe/message/topic.
- [ ] Auth expiry policy exists.
- [ ] Sensitive payloads not logged.
- [ ] Payload size limits exist.

### 30.7 Cluster

- [ ] Local session object is not treated as distributed state.
- [ ] Cross-node fan-out uses broker/pub-sub if needed.
- [ ] Distributed presence is debounced.
- [ ] Sticky session is not relied on for correctness.
- [ ] Node restart recovery is tested.

---

## 31. Mental Model Ringkas

WebSocket reliability bisa diringkas seperti ini:

```text
Connection may die.
Message may duplicate.
Message may be missed.
Order is scoped, not global.
Client may reconnect many times.
Server node may disappear.
Slow clients are normal.
Proxy timeouts are real.
Auth can expire while connected.

Therefore:
  define lifecycle,
  define heartbeat,
  define reconnect,
  define message identity,
  define ack/retry/replay,
  define ordering scope,
  define backpressure,
  define cleanup,
  define observability.
```

Atau lebih pendek:

```text
Do not trust the socket.
Trust durable state, explicit protocol, bounded resources, and recovery paths.
```

---

## 32. Latihan Praktis

### Latihan 1 — Design heartbeat policy

Diberikan:

```text
LB idle timeout: 120s
Ingress proxy timeout: 90s
Expected stale presence tolerance: 60s
Client count: 20.000
```

Tentukan:

- heartbeat interval,
- missed threshold,
- server close threshold,
- estimated heartbeat messages per second,
- trade-off jika interval terlalu pendek.

### Latihan 2 — Design reliable notification

Buat desain untuk notifikasi user:

- user bisa punya 3 tab,
- message penting tidak boleh hilang,
- reconnect bisa terjadi,
- duplicate boleh terjadi asal UI tidak double-count,
- server multi-node.

Tentukan:

- message envelope,
- ACK model,
- replay storage,
- dedup strategy,
- cluster fan-out.

### Latihan 3 — Slow client policy

Satu dashboard topic punya 5.000 subscriber. 50 client lambat.

Tentukan:

- apakah message boleh drop/coalesce,
- queue capacity,
- close policy,
- metric yang harus dimonitor,
- bagaimana mencegah satu client menghambat broadcast.

### Latihan 4 — Rolling deployment WebSocket

Design deployment flow di Kubernetes:

- 10 pod WebSocket,
- 100.000 active connections,
- rolling update,
- client harus reconnect tanpa storm.

Tentukan:

- readiness behavior,
- drain message,
- close code,
- reconnect jitter,
- max unavailable/surge strategy,
- resume strategy.

---

## 33. Kesimpulan Part 024

Pada part ini kita membahas WebSocket reliability sebagai kombinasi:

- heartbeat,
- timeout alignment,
- reconnect backoff,
- resume semantics,
- message identity,
- ACK,
- retry,
- replay,
- ordering scope,
- duplicate handling,
- bounded queue,
- backpressure,
- rate limit,
- schema versioning,
- auth revalidation,
- presence correctness,
- cluster fan-out,
- graceful shutdown,
- reconnect storm mitigation,
- observability.

Poin terpenting:

```text
WebSocket is only a transport.
Reliability comes from the application protocol and system design around it.
```

Untuk sistem penting seperti case management, enforcement workflow, notification, audit-related update, approval, atau regulatory dashboard, WebSocket sebaiknya digunakan sebagai **live projection channel**, bukan sebagai source of truth.

Source of truth tetap:

- database,
- event log,
- durable command store,
- broker stream,
- domain state machine.

WebSocket memberi low-latency delivery. Recovery tetap harus didesain eksplisit.

---

## 34. Status Seri

Seri **belum selesai**.

Part yang sudah dibuat:

- Part 000 — Orientation: Mental Model Server-Side Java Web Runtime
- Part 001 — Evolution: Java EE `javax.*` ke Jakarta EE `jakarta.*`
- Part 002 — HTTP Fundamentals for Servlet Engineers
- Part 003 — Servlet Container Architecture
- Part 004 — Servlet Lifecycle Deep Dive
- Part 005 — Request Object Internals: `HttpServletRequest`
- Part 006 — Response Object Internals: `HttpServletResponse`
- Part 007 — Servlet Mapping, URL Pattern, and Dispatch Resolution
- Part 008 — Request Dispatching: Forward, Include, Async, Error
- Part 009 — Filters: Cross-Cutting Boundary Before Frameworks
- Part 010 — Listeners: Observing Web Application Lifecycle
- Part 011 — ServletContext and Application Scope
- Part 012 — Session Management: `HttpSession` Deep Dive
- Part 013 — Cookies, Headers, SameSite, and Browser Boundary
- Part 014 — Async Servlet: Non-Blocking Request Lifecycle
- Part 015 — Servlet Non-Blocking I/O
- Part 016 — Multipart Upload, File Download, and Large Payload Handling
- Part 017 — Error Handling and Failure Semantics in Servlet Apps
- Part 018 — Threading Model: Classic Servlet, Platform Threads, Virtual Threads
- Part 019 — Web Application Classloading, Deployment, and Redeployment
- Part 020 — Packaging Models: WAR, Embedded Container, Executable JAR, Native-ish Deployments
- Part 021 — WebSocket Protocol Fundamentals
- Part 022 — Jakarta WebSocket Server Endpoint Model
- Part 023 — WebSocket Session, Concurrency, and State Management
- Part 024 — WebSocket Reliability Patterns

Berikutnya:

```text
Part 025 — WebSocket Security Boundary
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 023 — WebSocket Session, Concurrency, and State Management](./learn-java-servlet-websocket-web-container-runtime-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime-part-025](./learn-java-servlet-websocket-web-container-runtime-part-025.md)
