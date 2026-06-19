# learn-http-for-web-frontend-perspective-part-026

# Part 026 — Streaming, SSE, WebSocket, WebTransport, and Long Polling

> Seri: `learn-http-for-web-frontend-perspective`  
> Target pembaca: Java software engineer yang ingin menguasai HTTP dari perspektif web/frontend sampai level arsitektural dan operasional.  
> Fokus bagian ini: memahami pilihan komunikasi real-time dan streaming di browser: HTTP streaming, Server-Sent Events, WebSocket, WebTransport, long polling, failure model, reconnect, ordering, backpressure, auth, proxy/CDN, observability, dan decision framework.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 025, kita sudah membangun fondasi:

- HTTP message model.
- Method semantics.
- Status code.
- Header.
- Body/media type/encoding.
- Fetch API.
- CORS.
- Cookie/session/auth.
- Cache/revalidation.
- Redirect.
- Resource loading.
- HTTP/1.1, HTTP/2, HTTP/3.
- TLS/security headers/isolation policy.
- API design, mutation design, dan error contract.

Part ini membahas satu area yang sering membuat desain frontend/backend menjadi rapuh: **komunikasi yang tidak cocok dengan request-response sederhana**.

Contoh kebutuhan:

- progress upload/import;
- notifikasi real-time;
- chat;
- collaborative editing;
- live dashboard;
- order/trade status;
- long-running background job;
- AI/token streaming;
- multiplayer state;
- telemetry near-real-time;
- server push event;
- stock/ticker update;
- regulatory case event timeline;
- enforcement workflow escalation updates;
- report generation progress.

Pertanyaan dasarnya bukan:

> “Pakai WebSocket atau SSE?”

Pertanyaan yang lebih benar:

> “Apa bentuk komunikasi yang dibutuhkan sistem: arah data, ordering, durability, reconnect, backpressure, auth, replay, proxy compatibility, observability, dan failure semantics-nya?”

---

## 1. Core Mental Model

HTTP tradisional adalah model:

```text
client sends request
server sends response
connection may be reused
interaction completes
```

Namun banyak fitur web modern membutuhkan model seperti:

```text
client subscribes
server emits events over time
client reacts incrementally
```

atau:

```text
client and server both send messages independently
connection stays open
state evolves over time
```

atau:

```text
client asks repeatedly
server responds only when something changes
client repeats
```

Karena itu, kita butuh membedakan beberapa dimensi.

---

## 2. Dimensi Desain Komunikasi Real-Time

Jangan mulai dari teknologi. Mulai dari dimensi.

### 2.1 Directionality

Apakah data mengalir:

| Model | Arah | Contoh |
|---|---:|---|
| Request-response | client → server → client | REST API normal |
| Server push one-way | server → client setelah client subscribe | notification feed, progress update |
| Client push one-way | client → server terus-menerus | telemetry upload |
| Bidirectional | client ↔ server | chat, collaborative editing, game |

SSE cocok untuk server-to-client. WebSocket cocok untuk bidirectional. Long polling cocok sebagai fallback. WebTransport cocok untuk aplikasi modern yang butuh stream/datagram di atas HTTP/3, tetapi dukungan dan kompleksitasnya harus dipertimbangkan.

---

### 2.2 Interaction Lifetime

Apakah interaksi:

- pendek: satu request selesai;
- medium: request bertahan beberapa detik;
- panjang: koneksi bertahan menit/jam;
- episodic: reconnect berkala;
- persistent: selalu aktif selama tab hidup.

Semakin panjang lifetime, semakin besar pengaruh:

- load balancer idle timeout;
- reverse proxy buffering;
- mobile network switching;
- browser tab suspension;
- auth token expiry;
- connection leak;
- server memory pressure;
- observability;
- graceful deploy;
- backpressure.

---

### 2.3 Delivery Semantics

Kebutuhan delivery harus jelas.

| Requirement | Pertanyaan desain |
|---|---|
| At most once | Boleh hilang? |
| At least once | Boleh duplicate? |
| Exactly once | Benarkah dibutuhkan atau cukup idempotent processing? |
| Ordered | Harus urut global, per entity, atau per stream? |
| Replayable | Setelah reconnect, client bisa ambil event yang terlewat? |
| Durable | Event harus disimpan server? |

Banyak tim salah memilih WebSocket karena mengira koneksi persistent otomatis berarti reliable. Tidak. WebSocket hanya menyediakan channel. Reliability tetap harus didesain di level application protocol.

---

### 2.4 State Ownership

Tentukan siapa pemilik state:

- server sebagai source of truth;
- client punya local projection;
- client optimistic lalu reconcile;
- event stream sebagai log;
- snapshot + delta;
- polling sebagai synchronization loop.

Untuk frontend enterprise, pola yang sering paling sehat:

```text
initial snapshot via normal HTTP GET
then incremental updates via SSE/WebSocket
periodic reconciliation via GET
```

Kenapa? Karena stream bisa hilang, reconnect bisa terjadi, client bisa tidur, dan event incremental saja sering tidak cukup untuk memulihkan state.

---

## 3. Opsi Teknologi Utama

Kita akan bahas:

1. HTTP streaming.
2. Server-Sent Events / EventSource.
3. Long polling.
4. WebSocket.
5. WebTransport.
6. Short polling sebagai baseline.

---

## 4. Short Polling

Short polling adalah pola paling sederhana:

```text
client: GET /jobs/123/status
server: 200 { status: "running", progress: 40 }
wait 2s
client: GET /jobs/123/status
server: 200 { status: "running", progress: 45 }
wait 2s
...
```

### 4.1 Kapan Short Polling Masuk Akal

Short polling masuk akal ketika:

- update tidak harus sangat real-time;
- interval 2–30 detik cukup;
- jumlah user/koneksi tidak terlalu besar;
- data murah dihitung;
- proxy/CDN compatibility penting;
- implementasi harus sederhana;
- server tidak ingin memegang koneksi panjang;
- event tidak perlu dikirim segera.

Contoh:

- status report generation;
- polling invoice/payment status;
- checking deployment status;
- periodically refreshing dashboard low-frequency;
- background import progress yang tidak kritis real-time.

### 4.2 Kelebihan

- Sangat mudah diimplementasikan.
- Mudah diamankan dengan auth/cookie/header biasa.
- Cocok dengan HTTP infrastructure umum.
- Mudah di-debug via DevTools.
- Mudah di-scale dengan cache atau conditional GET.
- Tidak memerlukan connection lifecycle khusus.

### 4.3 Kekurangan

- Latency minimum sebesar interval polling.
- Bisa boros request saat tidak ada perubahan.
- Bisa membuat thundering herd jika semua client polling serempak.
- Tidak cocok untuk high-frequency updates.
- Tidak cocok untuk bidirectional realtime.

### 4.4 Polling yang Baik

Polling buruk:

```js
setInterval(async () => {
  await fetch('/api/status');
}, 1000);
```

Masalah:

- request bisa overlap;
- interval tetap walau server lambat;
- tidak ada backoff;
- tidak aware tab hidden;
- tidak cancel saat component unmount;
- tidak handle error class.

Polling lebih sehat:

```js
async function pollJobStatus(jobId, { signal }) {
  let delayMs = 1000;

  while (!signal.aborted) {
    const startedAt = Date.now();

    try {
      const response = await fetch(`/api/jobs/${jobId}/status`, { signal });

      if (response.status === 404) {
        throw new Error('Job not found');
      }

      if (response.status === 429 || response.status >= 500) {
        delayMs = Math.min(delayMs * 2, 30000);
      } else {
        const body = await response.json();
        renderJobStatus(body);

        if (body.status === 'succeeded' || body.status === 'failed') {
          return body;
        }

        delayMs = body.nextPollMs ?? 2000;
      }
    } catch (error) {
      if (signal.aborted) return;
      delayMs = Math.min(delayMs * 2, 30000);
    }

    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(0, delayMs - elapsed), signal);
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}
```

Key improvements:

- tidak overlap;
- bisa abort;
- backoff;
- server dapat memberi `nextPollMs`;
- terminal state menghentikan loop;
- failure tidak membuat request storm.

---

## 5. Long Polling

Long polling adalah kompromi antara polling dan push.

Flow:

```text
client: GET /events?since=100
server: tahan request sampai ada event atau timeout
server: 200 { events: [...] }
client: segera request lagi with since=newLastEventId
```

Jika tidak ada event:

```text
client: GET /events?since=100
server: wait up to 30s
server: 204 No Content
client: immediately retry or wait small delay
```

### 5.1 Kapan Long Polling Masuk Akal

Long polling cocok ketika:

- butuh update lebih cepat dari polling biasa;
- WebSocket/SSE tidak tersedia atau tidak diinginkan;
- infrastructure hanya mendukung HTTP request biasa;
- server bisa menahan request;
- event volume tidak terlalu tinggi;
- fallback untuk environment enterprise/proxy ketat.

### 5.2 Kelebihan

- Berbasis HTTP biasa.
- Mudah melewati banyak proxy/firewall.
- Mendukung auth HTTP biasa.
- Bisa replay pakai cursor/offset/event ID.
- Lebih hemat dibanding polling saat jarang ada event.

### 5.3 Kekurangan

- Setiap event batch membutuhkan request baru.
- Server harus mengelola pending request.
- Timeout proxy bisa mengganggu.
- Skalabilitas butuh async/non-blocking server model.
- Latency naik jika reconnect loop buruk.

### 5.4 Long Polling Contract

Endpoint long polling harus punya kontrak jelas:

```http
GET /api/cases/CASE-123/events?after=evt_100&timeoutMs=25000
Accept: application/json
```

Response saat ada event:

```http
200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "events": [
    {
      "id": "evt_101",
      "type": "case.assigned",
      "occurredAt": "2026-06-18T10:12:41Z",
      "payload": {
        "assigneeId": "u_42"
      }
    }
  ],
  "nextCursor": "evt_101"
}
```

Response saat timeout tanpa event:

```http
204 No Content
Cache-Control: no-store
```

### 5.5 Long Polling Frontend Loop

```js
async function longPollEvents({ after, signal }) {
  let cursor = after;
  let retryDelayMs = 250;

  while (!signal.aborted) {
    try {
      const url = new URL('/api/events', window.location.origin);
      if (cursor) url.searchParams.set('after', cursor);
      url.searchParams.set('timeoutMs', '25000');

      const response = await fetch(url, {
        signal,
        cache: 'no-store',
        credentials: 'include'
      });

      if (response.status === 204) {
        retryDelayMs = 250;
        continue;
      }

      if (response.status === 401) {
        await handleSessionExpired();
        return;
      }

      if (response.status === 429 || response.status >= 500) {
        await sleep(retryDelayMs, signal);
        retryDelayMs = Math.min(retryDelayMs * 2, 10000);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      const body = await response.json();
      for (const event of body.events) {
        applyEvent(event);
        cursor = event.id;
      }

      retryDelayMs = 250;
    } catch (error) {
      if (signal.aborted) return;
      await sleep(retryDelayMs, signal);
      retryDelayMs = Math.min(retryDelayMs * 2, 10000);
    }
  }
}
```

Important detail: long polling loop harus segera membuat request baru setelah response berhasil, tetapi harus memakai backoff saat error.

---

## 6. HTTP Streaming with Fetch

HTTP streaming berarti server mengirim response secara bertahap, dan browser memproses chunk sebelum response selesai.

Contoh mental model:

```text
client: GET /api/ai/answer-stream
server: 200 OK
server: chunk "Hello"
server: chunk " world"
server: chunk "..."
server: end
```

Di browser modern, `fetch()` response body adalah `ReadableStream` untuk banyak skenario.

### 6.1 Kapan HTTP Streaming Cocok

Cocok untuk:

- AI token streaming;
- progressive rendering;
- large file processing;
- NDJSON event feed;
- export/download progress;
- streaming logs;
- server-generated incremental content.

Tidak selalu cocok untuk:

- bidirectional realtime;
- very long-lived global connection;
- high-frequency bidirectional updates;
- unreliable datagrams;
- browser compatibility ekstrem.

### 6.2 NDJSON Streaming Pattern

NDJSON = newline-delimited JSON.

Server response:

```http
HTTP/1.1 200 OK
Content-Type: application/x-ndjson
Cache-Control: no-store

{"type":"started","jobId":"j_123"}
{"type":"progress","value":10}
{"type":"progress","value":50}
{"type":"completed","resultUrl":"/exports/j_123.csv"}
```

Frontend parser sederhana:

```js
async function consumeNdjson(url, { signal }) {
  const response = await fetch(url, { signal, credentials: 'include' });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .getReader();

  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += value;

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) continue;
      const event = JSON.parse(line);
      handleStreamEvent(event);
    }
  }

  if (buffer.trim()) {
    handleStreamEvent(JSON.parse(buffer));
  }
}
```

### 6.3 Streaming Pitfalls

#### Pitfall 1 — Proxy Buffering

Reverse proxy bisa menahan chunk sampai buffer penuh.

Akibatnya:

```text
server writes every 500ms
browser receives everything at the end
```

Dari sisi frontend terlihat seperti streaming tidak bekerja.

Periksa:

- Nginx buffering;
- CDN buffering;
- compression buffering;
- framework response flushing;
- serverless platform behavior.

#### Pitfall 2 — JSON Array Streaming yang Buruk

Buruk:

```json
[
  { "event": 1 },
  { "event": 2 },
  { "event": 3 }
]
```

Masalah: JSON belum valid sampai array ditutup.

Lebih baik untuk streaming:

```text
{"event":1}\n
{"event":2}\n
{"event":3}\n
```

atau SSE format.

#### Pitfall 3 — Body Stream Only Once

`response.body`, `response.json()`, `response.text()` mengonsumsi body. Jangan baca dua kali.

#### Pitfall 4 — Backpressure Diabaikan

ReadableStream punya konsep backpressure. Namun application-level processing masih bisa lambat. Jika UI update terlalu sering, browser bisa jank.

Solusi:

- batch UI updates;
- throttle render;
- process event queue;
- gunakan `requestAnimationFrame` untuk update visual;
- pisahkan parsing berat ke Web Worker jika perlu.

---

## 7. Server-Sent Events / EventSource

Server-Sent Events atau SSE adalah mekanisme browser untuk menerima event satu arah dari server melalui koneksi HTTP persistent.

MDN menjelaskan `EventSource` sebagai interface web content untuk server-sent events; instance `EventSource` membuka koneksi persistent ke server yang mengirim event dalam format `text/event-stream` sampai koneksi ditutup. Sumber MDN juga menjelaskan bahwa SSE memungkinkan server mengirim data baru ke halaman kapan pun setelah koneksi dibuat.

### 7.1 Flow SSE

```text
browser creates EventSource('/api/events')
server responds 200 text/event-stream
server sends events over same response
browser dispatches message/custom events
connection stays open
```

### 7.2 Wire Format SSE

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

id: evt_100
event: case-updated
data: {"caseId":"CASE-123","status":"under_review"}

id: evt_101
event: case-assigned
data: {"caseId":"CASE-123","assigneeId":"u_42"}

```

Blank line memisahkan event.

Field umum:

| Field | Makna |
|---|---|
| `data:` | payload event |
| `event:` | custom event type |
| `id:` | event ID untuk reconnect/replay |
| `retry:` | reconnect delay hint dalam ms |
| comment `:` | heartbeat/comment |

### 7.3 Frontend SSE Example

```js
const source = new EventSource('/api/cases/CASE-123/events', {
  withCredentials: true
});

source.addEventListener('case-updated', (event) => {
  const payload = JSON.parse(event.data);
  applyCaseUpdate(payload);
});

source.addEventListener('case-assigned', (event) => {
  const payload = JSON.parse(event.data);
  applyAssignment(payload);
});

source.onmessage = (event) => {
  const payload = JSON.parse(event.data);
  applyGenericEvent(payload);
};

source.onerror = () => {
  showConnectionDegradedIndicator();
};

function closeCaseStream() {
  source.close();
}
```

### 7.4 SSE Reconnect and Last-Event-ID

SSE punya reconnect built-in. Jika event memiliki `id:`, browser dapat mengirim `Last-Event-ID` saat reconnect.

Server harus bisa menjawab:

```http
GET /api/events
Last-Event-ID: evt_101
```

Lalu server mengirim event setelah `evt_101`.

Mental model yang benar:

```text
SSE connection is disposable.
Event log/cursor is the reliability mechanism.
```

Koneksi boleh putus. Sistem tetap benar jika event bisa dilanjutkan atau client bisa resync dengan snapshot.

### 7.5 SSE Kelebihan

- API browser sederhana.
- Auto-reconnect built-in.
- Cocok untuk server-to-client push.
- Berbasis HTTP response biasa.
- Lebih sederhana dari WebSocket untuk notifikasi satu arah.
- Event ID/cursor pattern natural.
- Bisa lewat banyak infrastructure HTTP.
- Mudah dipakai untuk progress, notifications, live feed.

### 7.6 SSE Kekurangan

- One-way: server → client.
- Client-to-server tetap via HTTP request terpisah.
- Browser API `EventSource` tidak memberi kontrol header custom seperti `Authorization` secara langsung.
- Auth sering lebih natural memakai cookie, bukan bearer header.
- Per-origin connection limit bisa relevan, khususnya di HTTP/1.1.
- Proxy buffering/timeout bisa merusak.
- Tidak cocok untuk binary data.
- Tidak cocok untuk high-frequency bidirectional traffic.

### 7.7 Auth dengan SSE

Karena `EventSource` tidak menyediakan opsi custom request header seperti fetch, pilihan auth umum:

1. Cookie session.
2. URL token jangka sangat pendek.
3. Same-origin BFF endpoint.
4. Initial auth via normal request lalu stream scoped by server session.

Hati-hati dengan URL token:

- bisa masuk log;
- bisa bocor via history;
- bisa bocor via Referer jika salah policy;
- harus short-lived dan scoped.

Untuk enterprise app, desain yang sering paling aman:

```text
browser -> same-origin BFF SSE endpoint with HttpOnly Secure SameSite cookie
BFF -> backend event system using service credentials
```

### 7.8 Heartbeat SSE

Agar proxy tidak menganggap koneksi idle, server dapat mengirim komentar berkala:

```text
: heartbeat

```

atau:

```text
event: heartbeat
data: {}

```

Komentar lebih ringan jika client tidak perlu memproses event.

### 7.9 SSE untuk Regulatory Case Management

Contoh event:

```text
id: evt_8821
event: case-state-changed
data: {"caseId":"CASE-2026-001","from":"triage","to":"investigation","version":17}

id: evt_8822
event: escalation-triggered
data: {"caseId":"CASE-2026-001","ruleId":"late-response-sla","severity":"high"}

```

Client sebaiknya tidak menjadikan event sebagai satu-satunya source of truth. Gunakan:

```text
initial GET /cases/CASE-2026-001
subscribe SSE /cases/CASE-2026-001/events?after=...
apply deltas
periodic/reconnect reconciliation GET /cases/CASE-2026-001
```

---

## 8. WebSocket

WebSocket menyediakan komunikasi bidirectional antara browser dan server melalui koneksi persistent.

MDN menjelaskan WebSocket API memungkinkan sesi komunikasi interaktif dua arah antara browser dan server. WHATWG WebSockets Standard menyediakan API agar aplikasi web dapat mempertahankan komunikasi bidirectional dengan proses server-side.

### 8.1 WebSocket Flow

```text
client: HTTP GET with Upgrade: websocket
server: 101 Switching Protocols
connection becomes WebSocket
client/server exchange frames
```

URL:

```text
ws://example.com/socket
wss://example.com/socket
```

Untuk production gunakan `wss://`, analog dengan HTTPS.

### 8.2 Frontend WebSocket Example

```js
function createSocket(url) {
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe', topic: 'case:CASE-123' }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    handleSocketMessage(message);
  });

  socket.addEventListener('close', (event) => {
    console.log('socket closed', event.code, event.reason);
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    showConnectionDegradedIndicator();
  });

  return socket;
}
```

### 8.3 WebSocket is a Pipe, Not a Protocol

WebSocket memberi channel. Anda tetap harus mendesain application protocol.

Minimal message envelope:

```json
{
  "id": "msg_123",
  "type": "case.subscribe",
  "timestamp": "2026-06-18T10:00:00Z",
  "payload": {
    "caseId": "CASE-123"
  }
}
```

Untuk response/ack:

```json
{
  "id": "msg_124",
  "type": "ack",
  "correlationId": "msg_123",
  "payload": {
    "status": "subscribed"
  }
}
```

Untuk error:

```json
{
  "id": "msg_125",
  "type": "error",
  "correlationId": "msg_123",
  "error": {
    "code": "SUBSCRIPTION_FORBIDDEN",
    "message": "You cannot subscribe to this case."
  }
}
```

### 8.4 WebSocket Kelebihan

- Full duplex.
- Low overhead setelah koneksi terbentuk.
- Cocok untuk interactive realtime.
- Cocok untuk chat, collaborative apps, multiplayer, control channel.
- Bisa mengirim binary frame.
- Server bisa push kapan saja.
- Client bisa push kapan saja.

### 8.5 WebSocket Kekurangan

- Lebih kompleks di load balancing.
- Perlu connection lifecycle management.
- Perlu custom protocol untuk auth, errors, ack, retry, ordering.
- Proxy/firewall enterprise bisa mengganggu.
- Tidak memakai HTTP semantics setelah upgrade.
- HTTP caching tidak relevan.
- Observability lebih sulit dari request-response biasa.
- Scaling butuh connection fanout/pubsub architecture.
- Backpressure harus dipikirkan.
- Browser API klasik tidak memberikan built-in backpressure yang ideal.

### 8.6 WebSocket Auth Patterns

Pilihan umum:

1. Cookie saat handshake.
2. Short-lived token di query string.
3. Token dalam subprotocol/custom first message.
4. Same-origin BFF socket.

Karena browser WebSocket constructor tidak memungkinkan custom arbitrary headers seperti fetch, bearer token via `Authorization` header tidak mudah dilakukan langsung dari browser WebSocket API.

Contoh first-message auth:

```js
const socket = new WebSocket('wss://api.example.com/realtime');

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({
    type: 'auth',
    token: ephemeralRealtimeToken
  }));
});
```

Server harus menutup koneksi jika auth gagal.

### 8.7 Token Expiry pada WebSocket

Masalah: koneksi bisa hidup lebih lama dari access token.

Opsi desain:

| Opsi | Konsekuensi |
|---|---|
| tutup saat token expired | sederhana, client reconnect setelah refresh |
| re-auth message | lebih smooth, protocol lebih kompleks |
| session cookie server-side | mudah untuk same-origin/BFF, perlu session invalidation |
| short-lived channel token | bagus untuk scoped access, perlu renew flow |

Untuk sistem sensitif, jangan menganggap authorization hanya dicek saat connect. Subscription dan message-level operation juga harus dicek.

### 8.8 Reconnect Strategy

Reconnect buruk:

```js
socket.onclose = () => createSocket(url);
```

Masalah:

- reconnect storm;
- infinite tight loop;
- server makin overload;
- semua client reconnect bersamaan setelah deploy.

Reconnect lebih sehat:

```js
function connectWithBackoff({ url, signal }) {
  let attempt = 0;
  let socket;

  const connect = () => {
    if (signal.aborted) return;

    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      attempt = 0;
      resubscribeAll(socket);
      hideConnectionIssue();
    });

    socket.addEventListener('message', (event) => {
      handleSocketMessage(JSON.parse(event.data));
    });

    socket.addEventListener('close', () => {
      if (signal.aborted) return;

      showConnectionDegradedIndicator();
      const base = Math.min(1000 * 2 ** attempt, 30000);
      const jitter = Math.floor(Math.random() * 1000);
      attempt += 1;

      setTimeout(connect, base + jitter);
    });
  };

  connect();

  signal.addEventListener('abort', () => {
    socket?.close(1000, 'client aborted');
  });
}
```

### 8.9 Ordering and Idempotency

WebSocket preserves order on a connection, tetapi tidak menyelesaikan masalah:

- reconnect gap;
- message duplicate after retry;
- server failover;
- multi-node fanout ordering;
- concurrent streams/topics;
- stale client state.

Gunakan:

- event IDs;
- per-entity version;
- sequence number;
- idempotency key;
- ack/correlation ID;
- snapshot reconciliation.

Contoh event dengan version:

```json
{
  "type": "case.updated",
  "eventId": "evt_9001",
  "caseId": "CASE-123",
  "version": 42,
  "payload": {
    "status": "investigation"
  }
}
```

Client rule:

```text
apply event only if event.version > current.version
if gap detected, refetch snapshot
```

### 8.10 Backpressure in WebSocket

WebSocket API punya `bufferedAmount`.

```js
if (socket.bufferedAmount > 1_000_000) {
  pauseSendingTelemetry();
}
```

Jika client mengirim lebih cepat dari network/server bisa menerima, buffer membesar. Tanpa kontrol, memory meningkat dan latency makin buruk.

Rule:

- jangan kirim telemetry raw high-frequency tanpa batching;
- batasi message rate;
- drop non-critical updates;
- coalesce state updates;
- gunakan ack/windowing jika perlu;
- monitor `bufferedAmount`.

### 8.11 WebSocket Close Codes

Close code penting untuk debugging.

| Code | Makna umum |
|---:|---|
| 1000 | normal closure |
| 1001 | going away |
| 1002 | protocol error |
| 1003 | unsupported data |
| 1006 | abnormal closure, tidak dikirim sebagai frame |
| 1008 | policy violation |
| 1011 | internal error |
| 1013 | try again later |

Client harus membedakan:

- reconnectable close;
- auth failure;
- forbidden subscription;
- protocol mismatch;
- server overload.

---

## 9. WebTransport

WebTransport adalah API modern untuk komunikasi client-server di atas HTTP/3 yang mendukung reliable streams dan unreliable datagrams.

MDN menjelaskan WebTransport sebagai interface yang memungkinkan user agent terkoneksi ke server HTTP/3, memulai reliable/unreliable transport, dan menutup koneksi. MDN juga menjelaskan WebTransport API sebagai pembaruan modern terhadap WebSocket dengan dukungan multiple streams, unidirectional streams, out-of-order delivery, reliable streams, dan unreliable UDP-like datagrams.

### 9.1 Apa yang WebTransport Tambahkan

Dibanding WebSocket:

| Capability | WebSocket | WebTransport |
|---|---:|---:|
| bidirectional messaging | yes | yes |
| reliable ordered single stream | yes | yes |
| multiple independent streams | no, harus app-level multiplex | yes |
| unreliable datagrams | no | yes |
| HTTP/3/QUIC foundation | no | yes |
| browser support maturity | mature | newer/less universal |
| infrastructure support | broad | more constrained |

### 9.2 Kapan WebTransport Masuk Akal

Pertimbangkan WebTransport untuk:

- real-time media/control;
- gaming;
- low-latency telemetry;
- apps yang butuh unreliable datagrams;
- multiple independent streams;
- cases where head-of-line blocking matters;
- advanced browser/server stack with HTTP/3 support.

Jangan jadikan default untuk normal enterprise CRUD app.

Untuk kebanyakan dashboard, notification, workflow update:

```text
SSE or WebSocket is simpler and more portable.
```

### 9.3 WebTransport Complexity

Anda perlu mempertimbangkan:

- browser support;
- server support;
- HTTP/3 availability;
- CDN/proxy compatibility;
- fallback;
- observability;
- security review;
- operational expertise;
- test infrastructure.

### 9.4 Mental Model

WebTransport bukan “WebSocket lebih baru jadi selalu lebih baik”.

WebTransport adalah pilihan ketika aplikasi membutuhkan properti transport yang tidak disediakan WebSocket secara native.

Jika kebutuhan hanya:

```text
server sends notifications to browser
```

pakai SSE.

Jika kebutuhan:

```text
browser and server exchange command/event messages interactively
```

pakai WebSocket.

Jika kebutuhan:

```text
multiple independent streams + unreliable datagrams + low latency over HTTP/3
```

baru pertimbangkan WebTransport.

---

## 10. Server-Sent Events vs WebSocket vs Long Polling vs Streaming

### 10.1 Comparison Matrix

| Dimension | Short Polling | Long Polling | HTTP Streaming | SSE | WebSocket | WebTransport |
|---|---|---|---|---|---|---|
| direction | client pulls | server delayed response | mostly server → client | server → client | bidirectional | bidirectional/multi-stream/datagram |
| browser API complexity | low | medium | medium | low | medium/high | high |
| server complexity | low | medium | medium | medium | high | high |
| infrastructure compatibility | very high | high | medium/high | medium/high | medium | lower/varies |
| built-in reconnect | no | no | no | yes | no | no |
| custom headers | yes via fetch | yes via fetch | yes via fetch | limited | limited | API-dependent |
| binary | yes | yes | yes | awkward/no | yes | yes |
| event replay | app-level | app-level | app-level | natural via id | app-level | app-level |
| bidirectional | no | awkward | no | no | yes | yes |
| best for | simple status | fallback push | progressive output | notifications/progress | chat/collab/control | advanced low-latency apps |

---

## 11. Choosing the Right Transport

### 11.1 Decision Tree

```text
Need server-to-client updates only?
  yes -> Need broad simplicity and auto-reconnect?
           yes -> SSE
           no  -> HTTP streaming or long polling depending shape
  no -> Need bidirectional interactive messages?
           yes -> WebSocket
           no  -> Normal HTTP/polling likely enough

Need unreliable datagrams/multiple independent streams/HTTP3?
  yes -> Consider WebTransport with fallback

Need easiest enterprise compatibility?
  yes -> Short polling or long polling
```

### 11.2 Common Scenarios

| Scenario | Recommended starting point |
|---|---|
| job progress | polling, SSE if many updates |
| AI token streaming | HTTP streaming or SSE |
| notifications | SSE |
| chat | WebSocket |
| collaborative editing | WebSocket, possibly CRDT/OT protocol |
| live dashboard low frequency | polling or SSE |
| trading/ticker high frequency | WebSocket, specialized infra |
| upload progress client → server | browser upload progress/XHR/fetch limitations, not SSE |
| server log tail | SSE or HTTP streaming |
| multiplayer game | WebSocket or WebTransport |
| enterprise approval workflow updates | SSE + snapshot reconciliation |
| mobile unreliable network | polling/SSE with robust reconnect, avoid assuming persistent stability |

---

## 12. State Synchronization Patterns

### 12.1 Snapshot + Stream

Pattern paling robust:

```text
1. GET /resource snapshot
2. subscribe /resource/events after snapshotVersion
3. apply events if sequential
4. if gap or reconnect uncertainty -> GET snapshot again
```

Example:

```json
{
  "caseId": "CASE-123",
  "version": 42,
  "status": "investigation",
  "assigneeId": "u_10"
}
```

Event:

```json
{
  "eventId": "evt_777",
  "caseId": "CASE-123",
  "fromVersion": 42,
  "toVersion": 43,
  "type": "case.assignee.changed",
  "payload": {
    "assigneeId": "u_11"
  }
}
```

Client rule:

```text
if current.version === event.fromVersion:
  apply event and set version = event.toVersion
else:
  refetch snapshot
```

This is clean, defensible, and incident-friendly.

---

### 12.2 Event Log + Cursor

Good for:

- notifications;
- audit feed;
- timeline;
- append-only stream.

Contract:

```http
GET /api/me/notifications?after=evt_100
```

Response:

```json
{
  "events": [...],
  "nextCursor": "evt_150",
  "hasMore": true
}
```

SSE can use same event IDs.

---

### 12.3 Server Push + Client Ack

Needed when server needs know client received/processed message.

But be careful: browser receiving a WebSocket message does not mean user saw it, processed it, or persisted it.

Separate ack types:

| Ack | Meaning |
|---|---|
| transport received | browser received message |
| processed | app applied message |
| displayed | UI rendered message |
| user seen | user actually viewed/acknowledged |

Do not confuse these.

---

## 13. Reconnect and Resume

Any persistent connection must assume disconnect.

Disconnect causes:

- Wi-Fi to cellular switch;
- laptop sleep;
- browser tab suspension;
- reverse proxy idle timeout;
- server deploy;
- load balancer drain;
- auth expiry;
- network flap;
- VPN change;
- captive portal;
- browser memory pressure.

### 13.1 Resume Contract

Good realtime APIs expose resume points:

```text
Last-Event-ID
cursor
sequence
version
watermark
```

Bad realtime APIs only expose:

```text
connect and hope
```

### 13.2 Gap Detection

Client should detect missing sequence:

```js
function applySequencedEvent(event) {
  if (event.sequence !== lastSequence + 1) {
    scheduleSnapshotRefresh();
    return;
  }

  applyEvent(event);
  lastSequence = event.sequence;
}
```

But global sequence can be expensive. Often better:

- per-user feed cursor;
- per-resource version;
- per-topic sequence.

---

## 14. Heartbeats, Keepalive, and Liveness

Persistent connections need liveness signals.

### 14.1 Heartbeat Types

| Type | Direction | Purpose |
|---|---|---|
| server heartbeat | server → client | keep proxy/browser connection alive, show server alive |
| client ping | client → server | detect broken connection, keep NAT alive |
| application heartbeat | either | confirm application protocol health |

SSE usually server heartbeat.

WebSocket can use:

- protocol ping/pong server-side;
- application-level ping/pong if browser API does not expose low-level ping.

Example app-level ping:

```json
{ "type": "ping", "sentAt": "2026-06-18T10:00:00Z" }
```

Response:

```json
{ "type": "pong", "sentAt": "2026-06-18T10:00:00Z" }
```

### 14.2 Liveness vs Correctness

Heartbeat only says:

```text
connection seems alive
```

It does not say:

```text
all business events are delivered exactly once
```

For correctness, still need event IDs/cursors/versioning.

---

## 15. Backpressure and Flow Control

Backpressure adalah mekanisme agar producer tidak mengirim lebih cepat daripada consumer bisa memproses.

Di frontend:

- network menerima cepat;
- JS parsing bisa lambat;
- rendering bisa lambat;
- state updates bisa mahal;
- React/Vue rendering bisa jank;
- memory bisa naik.

### 15.1 Symptoms

- browser freezes;
- memory grows;
- events arrive late;
- UI lags behind server by minutes;
- websocket `bufferedAmount` grows;
- event queue unbounded;
- CPU high;
- battery drain.

### 15.2 Techniques

- batch messages;
- coalesce updates by entity;
- drop non-critical telemetry;
- throttle UI rendering;
- use worker for parsing;
- use pagination/snapshot instead of pushing everything;
- server-side filtering;
- subscription scoping;
- rate limits;
- explicit ack/windowing;
- bounded queues.

### 15.3 Coalescing Example

If 100 updates arrive for same entity within 1 second, UI may only need latest.

```js
const pendingByCaseId = new Map();
let scheduled = false;

function enqueueCaseUpdate(update) {
  pendingByCaseId.set(update.caseId, update);

  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(flushCaseUpdates);
  }
}

function flushCaseUpdates() {
  scheduled = false;

  for (const update of pendingByCaseId.values()) {
    applyCaseUpdate(update);
  }

  pendingByCaseId.clear();
}
```

---

## 16. Auth, Authorization, and Security

### 16.1 Authentication Is Not Enough

For realtime systems, check authorization at:

1. connection time;
2. subscription time;
3. message send time;
4. event fanout time;
5. token/session renewal time;
6. permission change time.

Example issue:

```text
User opens case stream while allowed.
Admin removes access.
Stream continues sending case updates.
```

Correct behavior:

```text
permission change triggers subscription revocation or stream close
```

### 16.2 CSRF and Realtime

SSE is mostly server-to-client, but opening a stream with cookies can still have implications. WebSocket with cookie auth can be vulnerable to cross-site WebSocket hijacking if origin checks are not enforced.

Server should validate:

- `Origin` header where applicable;
- session;
- CSRF/anti-cross-site policy for state-changing messages;
- allowed subscription topics;
- rate limits.

### 16.3 CORS

SSE and fetch streaming are subject to browser cross-origin rules.

WebSocket has a different model than fetch/CORS, but browsers commonly send `Origin` in WebSocket handshake. Server must validate allowed origins.

Do not assume:

```text
CORS config protects WebSocket endpoint
```

Treat WebSocket origin validation explicitly.

### 16.4 Token in URL Risk

Avoid long-lived token in URL:

```text
wss://example.com/socket?token=secret
```

Risk:

- logs;
- browser history;
- proxy logs;
- analytics;
- referer-like leakage in some flows;
- screenshots/debug dumps.

If unavoidable:

- make token short-lived;
- scope to channel;
- single-use if possible;
- avoid sensitive claims;
- rotate aggressively.

---

## 17. Infrastructure and Deployment Concerns

### 17.1 Load Balancer

Persistent connections affect load balancing.

Questions:

- Is sticky session needed?
- Can any node handle any subscription?
- Is pub/sub used for fanout?
- What happens during node drain?
- How are connections closed during deploy?
- Is there max connection duration?

### 17.2 Reverse Proxy

Check:

- idle timeout;
- response buffering;
- WebSocket upgrade support;
- HTTP/2 behavior;
- max header size;
- compression;
- connection limits;
- keepalive settings.

### 17.3 CDN

CDNs differ in support for:

- WebSocket;
- SSE;
- streaming flush;
- HTTP/3;
- long-lived connections;
- timeout;
- buffering.

Never assume because normal API works, streaming works.

### 17.4 Serverless

Some serverless platforms have limits:

- max request duration;
- streaming support differences;
- connection holding cost;
- cold starts;
- WebSocket gateway-specific model;
- billing per connection/message.

### 17.5 Graceful Deployment

For WebSocket/SSE:

- stop accepting new connections;
- notify clients with retry hint;
- close connections gracefully;
- clients reconnect with jitter;
- resume from cursor;
- avoid all clients reconnecting instantly.

SSE shutdown event example:

```text
event: server-draining
data: {"retryAfterMs":5000}

```

WebSocket shutdown message:

```json
{
  "type": "server.draining",
  "retryAfterMs": 5000
}
```

---

## 18. Observability for Realtime Systems

HTTP request logs are not enough.

### 18.1 Metrics

Track:

- active connections;
- connection open rate;
- connection close rate;
- reconnect rate;
- average connection duration;
- abnormal close count;
- auth failure count;
- subscription count per topic;
- events sent/sec;
- bytes sent/sec;
- message queue lag;
- dropped message count;
- replay requests;
- gap detection count;
- client-side reconnect attempts;
- client-side stream errors.

### 18.2 Client Telemetry

Frontend should report:

- connection state transitions;
- reconnect attempt count;
- last event ID applied;
- stream error;
- abnormal close code;
- time since last message;
- fallback mode active;
- snapshot reconciliation count.

Example state machine telemetry:

```json
{
  "component": "case-event-stream",
  "state": "reconnecting",
  "attempt": 4,
  "lastEventId": "evt_1042",
  "reason": "abnormal_close"
}
```

### 18.3 Traceability

For message protocols, include:

- message ID;
- correlation ID;
- causation ID;
- user/session ID server-side;
- topic/subscription ID;
- resource ID;
- server node ID;
- event store offset.

This matters when debugging:

```text
User says case status changed late.
```

You need to answer:

- when event was produced;
- when it entered event bus;
- when realtime gateway received it;
- when it was sent to browser;
- whether browser received it;
- whether UI applied it;
- whether snapshot later corrected it.

---

## 19. Browser Lifecycle Issues

Frontend realtime code must account for browser behavior.

### 19.1 Tab Hidden

When tab is hidden:

- timers may be throttled;
- rendering pauses;
- network may continue but JS scheduling changes;
- battery saving can affect behavior.

Strategy:

- reduce polling frequency;
- avoid high-frequency UI updates;
- on visibility resume, reconcile snapshot.

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshSnapshot();
  }
});
```

### 19.2 Page Navigation

Use AbortController / close connection on component or route teardown.

```js
const controller = new AbortController();
startStream({ signal: controller.signal });

function cleanup() {
  controller.abort('route changed');
}
```

For WebSocket/SSE:

```js
source.close();
socket.close(1000, 'route changed');
```

### 19.3 Multiple Tabs

If user opens multiple tabs, each tab may open its own stream/socket.

Problems:

- duplicate server load;
- duplicate notifications;
- race in local storage;
- token refresh stampede;
- inconsistent state.

Possible solutions:

- accept it if low volume;
- BroadcastChannel to share events across tabs;
- SharedWorker for one socket across tabs;
- server rate/subscription limits;
- per-tab connection but deduplicate notifications.

Example BroadcastChannel:

```js
const channel = new BroadcastChannel('case-events');

channel.onmessage = (event) => {
  applyEvent(event.data);
};

function publishEventToOtherTabs(event) {
  channel.postMessage(event);
}
```

---

## 20. Failure Mode Catalogue

### 20.1 Common Failure Modes

| Symptom | Likely cause | Diagnostic direction |
|---|---|---|
| stream works locally, not prod | proxy/CDN buffering | inspect response flush, proxy config |
| WebSocket closes every 60s | idle timeout | heartbeat/load balancer timeout |
| duplicate events | reconnect replay without idempotency | event ID dedupe |
| missing events after sleep | no resume cursor | snapshot reconciliation |
| CORS error on SSE | missing CORS headers/credentials | inspect request/response headers |
| cookie not sent | SameSite/Secure/domain issue | cookie attributes/origin/site |
| all clients reconnect at once | no jitter | reconnect backoff |
| UI freezes during stream | too many render updates | batch/throttle |
| auth changes not respected | authorization only checked at connect | subscription revocation |
| server memory grows | connection leak/subscription leak | lifecycle cleanup |
| messages delayed then burst | buffering/compression | disable buffering, flush chunks |
| event visible in Network but not JS | wrong format/parser/CORS exposure | inspect body/format/API |

---

## 21. Design Templates

### 21.1 Job Progress with Polling

Use when updates every few seconds are enough.

```text
POST /api/imports
201 Created
Location: /api/imports/imp_123

GET /api/imports/imp_123
200 { status, progress, nextPollMs }
```

### 21.2 Job Progress with SSE

Use when progress is frequent and user waits actively.

```text
POST /api/imports
201 Created { importId }

GET /api/imports/imp_123/events
Accept: text/event-stream
```

Events:

```text
event: progress
data: {"progress":40}


event: completed
data: {"downloadUrl":"/api/imports/imp_123/result"}

```

### 21.3 Chat with WebSocket

Use WebSocket because client and server both send messages.

Envelope:

```json
{
  "id": "msg_abc",
  "type": "chat.message.send",
  "payload": {
    "roomId": "room_1",
    "clientMessageId": "client_123",
    "text": "Hello"
  }
}
```

Server ack:

```json
{
  "type": "chat.message.accepted",
  "correlationId": "msg_abc",
  "payload": {
    "serverMessageId": "srv_999",
    "clientMessageId": "client_123"
  }
}
```

### 21.4 Case Workflow Updates with Snapshot + SSE

```text
GET /api/cases/CASE-123
200 { version: 42, ... }

GET /api/cases/CASE-123/events?afterVersion=42
text/event-stream
```

Rule:

```text
apply only sequential events
on gap, refetch case snapshot
on reconnect, resume from last event/version
```

This is especially appropriate for enforcement lifecycle modelling because state transition correctness matters more than raw realtime feeling.

---

## 22. Implementation Guidance for Java Backends

Even though this series is frontend perspective, as Java engineer you should map frontend needs to backend implementation constraints.

### 22.1 Servlet Blocking vs Reactive

Long-lived connections can consume server resources.

In Java stacks:

- traditional servlet blocking thread-per-request can be expensive for many SSE/long polling connections;
- async servlet can help;
- Spring WebFlux/Reactor can model streams more naturally;
- Netty-based stacks can handle high concurrency better;
- but complexity rises.

The point is not “always use reactive”. The point:

```text
connection lifetime changes backend capacity model
```

### 22.2 Event Source

Realtime gateway usually should not query database in tight loop.

Better architecture:

```text
business transaction commits
outbox/event emitted
event bus / broker / pubsub
realtime gateway fans out to subscribed clients
client receives event
client may refetch snapshot
```

### 22.3 Outbox and Auditability

For regulated systems, event correctness matters.

Use:

- transactional outbox;
- durable event ID;
- resource version;
- audit trail;
- replay window;
- idempotent consumers;
- event schema evolution.

Streaming connection is delivery channel, not system of record.

---

## 23. Practical Checklist

Before choosing transport, answer:

### 23.1 Product/UX

- How real-time is real-time?
- Is 5 seconds enough?
- Does user need progress or final result only?
- Should UI show degraded connection state?
- What happens after laptop sleep?
- What happens if event arrives twice?
- What happens if event is missed?

### 23.2 Protocol

- One-way or bidirectional?
- Text or binary?
- Ordered or unordered?
- Reliable or best-effort?
- Need replay?
- Need ack?
- Need backpressure?

### 23.3 Security

- How is connection authenticated?
- How are subscriptions authorized?
- What happens when permission changes?
- Are origins validated?
- Are tokens leaked in URL?
- Are cookies SameSite/Secure correct?

### 23.4 Infrastructure

- Does CDN/proxy support it?
- Idle timeout?
- Buffering?
- WebSocket upgrade?
- HTTP/3 support?
- Serverless duration limit?
- Load balancing/stickiness?
- Graceful deploy?

### 23.5 Operations

- Active connection metrics?
- Reconnect metrics?
- Last event ID telemetry?
- Close codes logged?
- Subscription counts?
- Fanout lag?
- Client gap detection?

---

## 24. Strong Defaults

For many web/frontend systems, use these defaults:

### 24.1 Default 1 — Prefer Normal HTTP Until It Hurts

If updates every 5–30 seconds are fine, use polling.

Simple systems fail less often.

### 24.2 Default 2 — For Server-to-Client Updates, Prefer SSE

If data only flows server → client and text events are enough, SSE is often simpler than WebSocket.

### 24.3 Default 3 — For Bidirectional Interactive Apps, Use WebSocket

Chat/collab/control channels usually fit WebSocket.

### 24.4 Default 4 — Add Snapshot Reconciliation

Never rely only on live stream for correctness.

```text
stream for freshness
snapshot for correctness
```

### 24.5 Default 5 — Treat Reconnect as Normal

Connection loss is not an exception. It is a normal state.

### 24.6 Default 6 — Design Application Protocol Explicitly

For WebSocket/WebTransport:

- message ID;
- type;
- payload;
- correlation ID;
- error envelope;
- version;
- auth/authorization;
- ack if needed.

### 24.7 Default 7 — Backoff + Jitter Always

Any reconnect loop without jitter is a future incident.

---

## 25. Anti-Patterns

### Anti-Pattern 1 — WebSocket for Everything

Using WebSocket for simple notifications often increases complexity unnecessarily.

Replacement:

```text
SSE or polling
```

### Anti-Pattern 2 — Stream Without Cursor

If stream disconnects, client cannot know what was missed.

Replacement:

```text
event ID + resume + snapshot reconciliation
```

### Anti-Pattern 3 — No Backoff

Immediate reconnect loops can DDoS your own backend.

Replacement:

```text
exponential backoff + jitter + server retry hints
```

### Anti-Pattern 4 — Auth Only at Connection Time

Permission changes after connection are ignored.

Replacement:

```text
subscription-level and event-level authorization checks
```

### Anti-Pattern 5 — UI Applies Every Event Immediately

High-frequency events cause render storm.

Replacement:

```text
batch/coalesce/throttle
```

### Anti-Pattern 6 — Long-Lived Connection as Source of Truth

A stream is a delivery mechanism, not a durable state model.

Replacement:

```text
durable event log/snapshot/versioning
```

### Anti-Pattern 7 — Token in URL Without Scope/Expiry

Replacement:

```text
cookie/BFF, ephemeral token, scoped token, short expiry
```

---

## 26. Capstone Exercise

Design realtime update for a regulatory enforcement case management UI.

### Scenario

A case detail page must show:

- current case status;
- assigned officer;
- SLA countdown;
- new evidence uploaded;
- escalation triggered;
- comments added;
- approval decision;
- audit timeline updates.

### Requirements

- user may keep tab open all day;
- permissions may change while page is open;
- missing event is unacceptable;
- duplicate event is acceptable if idempotently handled;
- event order matters per case;
- user may have multiple tabs;
- system must be auditable;
- deployment should not break open pages;
- frontend must show degraded connection state.

### Recommended Design

```text
GET /api/cases/{caseId}
-> returns snapshot with version

GET /api/cases/{caseId}/events?afterVersion={version}
-> SSE stream with event id, fromVersion, toVersion, type, payload

on event:
  if fromVersion == currentVersion:
    apply event
  else:
    refetch snapshot

on reconnect:
  resume with last event/version

on permission revoked:
  server emits access-revoked or closes stream
  frontend clears sensitive data and shows access denied

periodically/on visibility resume:
  refetch snapshot
```

Example event:

```json
{
  "eventId": "evt_20260618_000912",
  "caseId": "CASE-2026-001",
  "fromVersion": 57,
  "toVersion": 58,
  "type": "case.escalation.triggered",
  "occurredAt": "2026-06-18T09:43:12Z",
  "payload": {
    "ruleId": "sla.response.overdue",
    "severity": "high"
  }
}
```

This design is strong because:

- SSE is simpler than WebSocket for server-to-client updates;
- snapshot ensures correctness;
- version detects gaps;
- event ID supports dedupe/replay;
- permission revocation can be explicit;
- audit event model aligns with regulatory defensibility.

---

## 27. Summary

Streaming/realtime is not one feature. It is a set of trade-offs.

Key conclusions:

1. Polling is often good enough and operationally simple.
2. Long polling is useful as an HTTP-compatible push fallback.
3. HTTP streaming is useful for progressive output and token/log streams.
4. SSE is excellent for server-to-client text events with auto-reconnect.
5. WebSocket is appropriate for bidirectional interactive systems.
6. WebTransport is powerful but should be reserved for advanced requirements needing HTTP/3 streams/datagrams.
7. Persistent connection is not reliability.
8. Correctness requires event IDs, cursors, versions, replay, or snapshot reconciliation.
9. Reconnect is a normal state, not an edge case.
10. Backpressure and UI batching are frontend responsibilities too.
11. Auth must be checked beyond initial connection.
12. Infrastructure behavior can make or break streaming systems.

The top 1% mental model:

```text
Realtime channel = delivery optimization.
State correctness = versioned model + durable source of truth + reconciliation.
```

---

## 28. References

- MDN Web Docs — EventSource.
- MDN Web Docs — Server-Sent Events.
- MDN Web Docs — WebSocket API.
- WHATWG WebSockets Standard.
- MDN Web Docs — WebTransport.
- MDN Web Docs — WebTransport API.
- WHATWG Streams Standard.
- WHATWG Fetch Standard.
- RFC 9110 — HTTP Semantics.
- RFC 9114 — HTTP/3.

---

## 29. Seri Progress

```text
Part 026 selesai.
Seri belum selesai.
Lanjut ke Part 027: Service Workers, Cache API, Offline, and Request Interception.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-025.md">⬅️ Part 025 — Error Contract Design: Making Failures Useful to Humans and Machines</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-027.md">Part 027 — Service Workers, Cache API, Offline, and Request Interception ➡️</a>
</div>
