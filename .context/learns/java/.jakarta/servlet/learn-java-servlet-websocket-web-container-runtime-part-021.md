# learn-java-servlet-websocket-web-container-runtime-part-021

# Part 021 — WebSocket Protocol Fundamentals

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Bagian: `021 / 031`  
> Topik: WebSocket protocol fundamentals sebelum masuk ke Jakarta WebSocket endpoint model  
> Target: Java 8 sampai Java 25, Java EE `javax.websocket.*`, Jakarta EE `jakarta.websocket.*`, Servlet container modern, reverse proxy, Kubernetes/cloud runtime

---

## 0. Posisi Materi Ini Dalam Seri

Sampai Part 020, kita sudah membangun mental model web runtime berbasis HTTP request/response:

1. HTTP request masuk.
2. Reverse proxy/load balancer meneruskan request.
3. Servlet container memilih context dan servlet/filter chain.
4. Application code menghasilkan response.
5. Response dikirim, request lifecycle selesai.

WebSocket mengubah bentuk masalah.

Pada HTTP biasa, request punya pola:

```text
client sends request
server sends response
connection may be reused
logical interaction ends
```

Pada WebSocket, setelah handshake berhasil, pola berubah menjadi:

```text
client opens connection
server accepts upgrade
both sides exchange messages repeatedly
connection remains alive
logical interaction ends only when connection closes or fails
```

Ini terlihat sederhana, tetapi dampak arsitekturnya besar:

- Request lifecycle berubah menjadi **connection lifecycle**.
- Timeout tidak lagi hanya request timeout, tetapi juga idle connection timeout.
- State tidak lagi hanya per-request, tetapi bisa melekat ke koneksi.
- Error tidak selalu terlihat sebagai HTTP status code.
- Load balancer tidak hanya meneruskan request, tetapi mempertahankan tunnel koneksi.
- Scale-out tidak otomatis mudah karena koneksi melekat ke node tertentu.
- Reliability tidak selesai dengan retry HTTP biasa.

Tujuan Part 021 adalah membangun fondasi protokol WebSocket sebelum kita masuk ke Jakarta WebSocket API di Part 022.

---

## 1. Apa Itu WebSocket?

WebSocket adalah protokol komunikasi dua arah penuh atau **full-duplex** di atas satu koneksi TCP yang dimulai dari HTTP handshake.

Secara mental model:

```text
HTTP request/response:

client ── request ──► server
client ◄─ response ── server

WebSocket:

client ◄════════════► server
       bidirectional
       long-lived
       message-based
```

RFC 6455 mendefinisikan WebSocket sebagai protokol yang memungkinkan komunikasi dua arah antara client browser dan remote host, memakai model keamanan berbasis origin, dengan opening handshake lalu message framing di atas TCP.

Jakarta WebSocket adalah API Java untuk membuat server dan client endpoint WebSocket berdasarkan protokol RFC 6455.

---

## 2. Kenapa WebSocket Ada?

Sebelum WebSocket, aplikasi web interaktif sering memakai beberapa pola:

### 2.1 Polling

Client bertanya berkala:

```text
GET /notifications
GET /notifications
GET /notifications
GET /notifications
```

Masalah:

- Banyak request kosong.
- Latency tergantung interval polling.
- Server dan proxy menerima traffic repetitif.
- Inefisien untuk event real-time.

### 2.2 Long Polling

Client mengirim request, server menahan response sampai ada event atau timeout:

```text
client ── GET /events ─────► server
client ◄──── event/timeout ─ server
client ── GET /events ─────► server
```

Lebih baik dari polling biasa, tetapi tetap:

- Setiap event atau timeout butuh request baru.
- Timeout harus diselaraskan dengan proxy/container.
- Server tetap mengelola banyak suspended request.

### 2.3 Server-Sent Events atau SSE

SSE menyediakan stream satu arah dari server ke browser melalui HTTP:

```text
client ── GET /events ─────► server
client ◄════ event stream ══ server
```

Bagus untuk notification feed, progress update, monitoring stream, tetapi bukan full-duplex. Client tetap harus memakai HTTP biasa untuk kirim pesan balik.

### 2.4 WebSocket

WebSocket menyediakan koneksi dua arah:

```text
client ◄════ messages ════► server
```

Cocok untuk:

- chat,
- collaborative editing,
- trading dashboard,
- live monitoring,
- multiplayer/game state,
- command/control interface,
- notification yang butuh immediate client-to-server response,
- browser terminal,
- streaming bidirectional ringan.

Tetapi WebSocket bukan solusi universal. Untuk banyak kasus, SSE atau polling sederhana lebih mudah, lebih observable, dan lebih resilient.

---

## 3. WebSocket Bukan HTTP Biasa

Salah satu kesalahan umum adalah menganggap WebSocket sebagai “REST tapi koneksinya tidak ditutup”. Itu salah.

HTTP request punya struktur:

```text
method + path + headers + optional body → status + headers + body
```

WebSocket setelah upgrade punya struktur:

```text
connection
  ├─ frames
  ├─ messages
  ├─ control frames
  ├─ close handshake
  └─ failure modes outside normal HTTP status
```

Perbedaan kunci:

| Aspek | HTTP | WebSocket |
|---|---|---|
| Lifecycle utama | Request/response | Long-lived connection |
| Direction | Client request, server response | Full-duplex |
| Unit komunikasi | HTTP message | WebSocket message/frame |
| Routing awal | URL/method/header | Handshake path + negotiated endpoint |
| Error utama | Status code | Close code, disconnect, protocol error |
| Retry | Per request | Reconnect + replay/ack design |
| Load balancing | Request-level | Connection-level |
| State | Mostly stateless | Often connection-associated |
| Observability | Access log/status/duration | Open connection, message count, close code, idle, reconnect |

Mental model yang lebih tepat:

```text
WebSocket = HTTP bootstrap + TCP-like long connection + message framing + browser origin model
```

---

## 4. Opening Handshake

WebSocket dimulai sebagai HTTP request. Browser mengirim HTTP GET dengan header upgrade.

Contoh handshake request:

```http
GET /ws/notifications HTTP/1.1
Host: example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Origin: https://app.example.com
Cookie: JSESSIONID=abc123
```

Server membalas:

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

Setelah `101 Switching Protocols`, koneksi tidak lagi diperlakukan sebagai HTTP request/response biasa. Ia menjadi koneksi WebSocket.

### 4.1 Kenapa Handshake Memakai HTTP?

Karena WebSocket ingin bisa berjalan melalui infrastruktur web existing:

- browser,
- port 80/443,
- reverse proxy,
- load balancer,
- TLS termination,
- authentication cookie,
- origin header,
- HTTP path routing.

Namun hanya handshake-nya yang HTTP. Setelah upgrade, data dikirim sebagai WebSocket frame.

---

## 5. Header Penting Saat Handshake

### 5.1 `Upgrade: websocket`

Memberitahu server bahwa client ingin mengubah protocol koneksi dari HTTP menjadi WebSocket.

### 5.2 `Connection: Upgrade`

Header hop-by-hop untuk menyatakan bahwa koneksi ini meminta upgrade.

Proxy harus meneruskan header upgrade dengan benar. Banyak kegagalan WebSocket di production berasal dari proxy yang tidak dikonfigurasi untuk upgrade.

### 5.3 `Sec-WebSocket-Key`

Nilai base64 random dari client. Server memakai key ini untuk menghasilkan `Sec-WebSocket-Accept`.

Tujuannya bukan authentication user, melainkan memastikan server benar-benar memahami protokol WebSocket.

### 5.4 `Sec-WebSocket-Accept`

Server menghitung nilai accept dari `Sec-WebSocket-Key` + GUID khusus yang didefinisikan RFC 6455, lalu SHA-1 dan base64.

Secara konseptual:

```text
accept = base64( SHA1( key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11" ) )
```

Ini adalah handshake validation, bukan mekanisme keamanan aplikasi.

### 5.5 `Sec-WebSocket-Version`

Biasanya `13`, sesuai versi final RFC 6455.

### 5.6 `Origin`

Browser mengirim `Origin` untuk membantu server memutuskan apakah koneksi dari origin tersebut diperbolehkan.

Ini sangat penting karena WebSocket bisa membawa cookie otomatis seperti HTTP biasa. Jika server tidak memvalidasi origin, aplikasi bisa terkena risiko cross-site WebSocket hijacking.

### 5.7 `Sec-WebSocket-Protocol`

Digunakan untuk subprotocol negotiation.

Contoh:

```http
Sec-WebSocket-Protocol: graphql-transport-ws, json.v1
```

Server memilih salah satu dan mengembalikannya:

```http
Sec-WebSocket-Protocol: json.v1
```

Subprotocol bukan sekadar label kosmetik. Ia adalah kontrak message-level di atas WebSocket.

Contoh subprotocol:

- STOMP over WebSocket,
- GraphQL subscriptions,
- custom JSON RPC,
- custom domain protocol.

### 5.8 `Sec-WebSocket-Extensions`

Dipakai untuk extension negotiation, misalnya compression extension `permessage-deflate`.

Compression dapat menghemat bandwidth, tetapi punya trade-off:

- CPU overhead,
- memory overhead,
- head-of-line effect pada message besar,
- risiko side-channel jika data rahasia dan attacker-controlled data dikompresi bersama.

---

## 6. Dari HTTP Connection ke WebSocket Connection

Sebelum upgrade:

```text
TCP connection
  └─ HTTP parser
       └─ request routing
            └─ servlet/filter/framework
```

Setelah upgrade:

```text
TCP connection
  └─ WebSocket frame parser
       └─ endpoint/session/message handler
```

Dalam container Java, boundary-nya kira-kira seperti ini:

```text
Client Browser
   │
   │  HTTP GET Upgrade
   ▼
Reverse Proxy / Load Balancer
   │
   │  forwards upgrade
   ▼
Servlet Container Connector
   │
   │  handshake accepted
   ▼
WebSocket Runtime
   │
   │  maps endpoint
   ▼
Jakarta WebSocket Endpoint
```

Servlet filter tertentu mungkin masih terlibat dalam handshake tergantung container/framework integration, tetapi setelah koneksi menjadi WebSocket, message handling tidak sama dengan request servlet biasa.

---

## 7. URI Scheme: `ws://` dan `wss://`

WebSocket memiliki dua scheme:

```text
ws://example.com/ws/chat
wss://example.com/ws/chat
```

Maknanya:

| Scheme | Transport |
|---|---|
| `ws://` | WebSocket over plain TCP |
| `wss://` | WebSocket over TLS |

Di production modern, gunakan `wss://` hampir selalu.

Jika web app diakses via HTTPS, browser biasanya akan memblokir atau memperingatkan mixed content bila mencoba membuka `ws://` ke endpoint tidak aman.

Rule praktis:

```text
https:// page → wss:// websocket
http:// page  → ws:// possible, but not production-grade
```

---

## 8. Frame vs Message

WebSocket adalah message-oriented, tetapi di level wire memakai frame.

```text
message
  ├─ frame 1
  ├─ frame 2
  └─ frame 3
```

Message besar bisa dipecah menjadi beberapa frame.

Ada dua konsep penting:

### 8.1 Frame

Frame adalah unit wire-level. Frame punya opcode, payload length, masking bit, payload, dan metadata lain.

### 8.2 Message

Message adalah unit application-level yang diterima aplikasi.

Contoh aplikasi menerima:

```json
{"type":"notification.read","notificationId":"N-1001"}
```

Walaupun secara wire mungkin dikirim dalam beberapa frame.

Top-tier engineer tidak mencampuradukkan keduanya:

- frame adalah concern protokol/container,
- message adalah concern aplikasi,
- partial message handling adalah area perantara.

---

## 9. Jenis Frame WebSocket

RFC 6455 mendefinisikan beberapa frame type.

| Frame | Opcode | Fungsi |
|---|---:|---|
| Continuation | `0x0` | Lanjutan fragmented message |
| Text | `0x1` | Text message, biasanya UTF-8 |
| Binary | `0x2` | Binary message |
| Close | `0x8` | Menutup koneksi |
| Ping | `0x9` | Liveness check dari satu peer |
| Pong | `0xA` | Response untuk ping atau heartbeat signal |

Control frame seperti close, ping, dan pong punya aturan khusus:

- payload kecil,
- tidak boleh difragmentasi,
- bisa muncul di antara fragmented message,
- harus diproses dengan cepat.

---

## 10. Text Message

Text message adalah payload UTF-8.

Contoh:

```json
{
  "type": "case.status.changed",
  "caseId": "CASE-2026-0001",
  "newStatus": "UNDER_REVIEW"
}
```

Kelebihan:

- mudah debug,
- cocok untuk browser,
- cocok dengan JSON,
- mudah di-log secara selektif,
- mudah versioning.

Kekurangan:

- overhead lebih besar daripada binary,
- parsing JSON butuh CPU,
- schema enforcement perlu dibuat sendiri,
- raw log bisa membocorkan data sensitif.

Text message cocok untuk kebanyakan enterprise web app.

---

## 11. Binary Message

Binary message membawa byte payload.

Cocok untuk:

- protocol compact,
- file chunk,
- audio/video control stream ringan,
- game state,
- protobuf/CBOR/messagepack,
- high-frequency low-latency message.

Kelebihan:

- lebih compact,
- parsing bisa lebih cepat,
- schema bisa ketat jika memakai protobuf/flatbuffers.

Kekurangan:

- lebih sulit debug,
- browser handling lebih kompleks,
- observability perlu tooling tambahan,
- backward compatibility harus disiplin.

Rule praktis:

```text
Start with text JSON for clarity.
Move to binary only when there is a measured reason.
```

---

## 12. Fragmentation

Message besar dapat difragmentasi.

Contoh konseptual:

```text
TEXT frame FIN=false
CONT frame FIN=false
CONT frame FIN=true
```

Application biasanya menerima complete message kecuali API endpoint mendukung partial message handler.

Masalah fragmentation penting untuk:

- large message,
- memory pressure,
- streaming-like use case,
- malicious client yang mengirim fragment pelan-pelan,
- backpressure.

Anti-pattern:

```text
Mengizinkan message besar tanpa limit karena "WebSocket kan streaming".
```

WebSocket bukan otomatis solusi streaming besar. Jika payload besar, tentukan:

- max frame size,
- max message size,
- idle timeout,
- read timeout,
- per-user quota,
- backpressure behavior,
- apakah file lebih baik lewat HTTP upload biasa.

---

## 13. Masking

Dalam WebSocket browser-to-server, client frame harus dimask. Server-to-client frame tidak dimask.

Masking bukan encryption. Tujuannya adalah proteksi terhadap beberapa jenis intermediary/proxy cache poisoning dan risiko historis pada infrastruktur HTTP.

Implikasi praktis:

- Aplikasi Java umumnya tidak mengurus masking manual.
- Container/WebSocket runtime menangani masking.
- Jika membuat low-level WebSocket server sendiri, masking wajib dipahami.

---

## 14. Ping dan Pong

Ping/pong adalah control frame untuk liveness.

Alurnya:

```text
peer A ── ping ──► peer B
peer A ◄─ pong ── peer B
```

Pong harus membawa payload yang sesuai dengan ping.

Kegunaan:

- mendeteksi koneksi mati,
- mempertahankan koneksi melewati idle timeout proxy tertentu,
- mengukur round-trip time secara kasar,
- membersihkan ghost connection.

Namun ada nuance penting:

```text
TCP connection terlihat terbuka ≠ application masih sehat
pong diterima ≠ user masih aktif
message terkirim ke socket ≠ business event diproses user
```

Karena itu beberapa aplikasi memakai dua lapis heartbeat:

1. protocol-level ping/pong,
2. application-level heartbeat message.

Contoh app-level heartbeat:

```json
{"type":"heartbeat","clientTime":"2026-06-17T10:00:00Z"}
```

---

## 15. Close Handshake

WebSocket punya close frame. Penutupan normal idealnya berupa close handshake:

```text
client ── close frame ──► server
client ◄─ close frame ─── server
TCP connection closes
```

Browser exposes close event dengan code dan reason.

Close code umum:

| Code | Meaning ringkas |
|---:|---|
| `1000` | Normal closure |
| `1001` | Going away, misalnya browser/tab/server shutdown |
| `1002` | Protocol error |
| `1003` | Unsupported data |
| `1006` | Abnormal closure, tidak dikirim sebagai close frame; dilaporkan lokal |
| `1007` | Invalid payload data |
| `1008` | Policy violation |
| `1009` | Message too big |
| `1011` | Internal server error |
| `1012` | Service restart |
| `1013` | Try again later |

Rule praktis:

- Gunakan `1000` untuk normal close.
- Gunakan `1008` untuk policy violation seperti auth/authorization/message schema failure.
- Gunakan `1009` untuk payload terlalu besar.
- Gunakan `1011` untuk server-side unexpected error.
- Gunakan `1012`/`1013` untuk deploy/restart/overload jika client perlu reconnect dengan backoff.

Jangan membuat close code sembarangan tanpa kontrak client.

---

## 16. WebSocket State Machine

Connection lifecycle dapat dimodelkan sebagai state machine.

```text
NEW
  │
  ▼
CONNECTING
  │ handshake success
  ▼
OPEN
  │ normal close requested
  ▼
CLOSING
  │ close handshake done
  ▼
CLOSED
```

Failure path:

```text
CONNECTING ── handshake rejected ──► CLOSED
OPEN ── network drop ──────────────► CLOSED/ABNORMAL
OPEN ── idle timeout ──────────────► CLOSED/ABNORMAL
OPEN ── protocol error ────────────► CLOSING/CLOSED
OPEN ── server shutdown ───────────► CLOSING/CLOSED
```

Browser WebSocket API juga punya ready state:

```text
CONNECTING = 0
OPEN       = 1
CLOSING    = 2
CLOSED     = 3
```

Server-side engineer harus mendesain aplikasi dengan asumsi state bisa berubah kapan saja:

- Client disconnect saat server hendak mengirim message.
- Server menutup koneksi saat client masih mengirim.
- Network mati tanpa close frame.
- Proxy kill idle connection.
- Browser tab ditutup tanpa graceful close.
- Mobile network berpindah dari Wi-Fi ke cellular.

---

## 17. WebSocket vs Raw TCP

WebSocket sering dianggap “TCP untuk browser”. Secara kasar ada kemiripan karena long-lived dan bidirectional, tetapi WebSocket bukan raw TCP.

| Aspek | Raw TCP | WebSocket |
|---|---|---|
| Browser support | Tidak tersedia langsung | Native browser API |
| Startup | TCP connect | HTTP upgrade handshake |
| Message boundary | Tidak ada, byte stream | Ada message/frame |
| Proxy compatibility | Sulit di web infra | Dirancang untuk web infra |
| Security model | Custom | Browser origin model + TLS |
| Port umum | Custom | 80/443 |
| Framing | Aplikasi sendiri | WebSocket framing |

WebSocket memberi message boundary, tetapi tidak memberi business reliability otomatis.

---

## 18. WebSocket vs HTTP/2

HTTP/2 mendukung multiplexing banyak stream dalam satu koneksi TCP. Namun HTTP/2 bukan pengganti langsung WebSocket.

Perbedaan mental model:

| Aspek | HTTP/2 | WebSocket |
|---|---|---|
| Model | Request/response multiplexed | Full-duplex message connection |
| Browser app API | Fetch/XHR/EventSource | WebSocket API |
| Server push | Deprecated/limited browser support | Not relevant |
| Bidirectional app messages | Tidak senatural WebSocket | Native |
| Proxy handling | HTTP semantic | Upgrade/tunnel semantics |

Ada mekanisme WebSocket over HTTP/2 melalui extended CONNECT di RFC 8441, tetapi support bergantung pada client, proxy, dan server. Untuk banyak deployment Java, WebSocket masih sering dipikirkan sebagai HTTP/1.1 upgrade melalui reverse proxy.

Rule praktis:

```text
Jangan asumsikan HTTP/2 otomatis membuat WebSocket lebih baik.
Pastikan support chain: browser → CDN/WAF → LB/proxy → container.
```

---

## 19. WebSocket vs SSE vs Long Polling

Decision matrix:

| Kebutuhan | Polling | Long Polling | SSE | WebSocket |
|---|---:|---:|---:|---:|
| Server → client real-time | Sedang | Baik | Sangat baik | Sangat baik |
| Client → server frequent messages | Buruk | Buruk | Pakai HTTP terpisah | Sangat baik |
| Simplicity | Sangat baik | Sedang | Baik | Lebih kompleks |
| Browser support | Sangat baik | Sangat baik | Baik | Sangat baik |
| Proxy friendliness | Sangat baik | Sedang | Sedang | Perlu konfigurasi |
| Backpressure complexity | Rendah | Sedang | Sedang | Tinggi |
| Scale-out complexity | Rendah | Sedang | Sedang | Tinggi |
| Reconnect complexity | Rendah | Sedang | Sedang | Tinggi |

Gunakan WebSocket jika benar-benar membutuhkan bidirectional low-latency connection.

Jangan gunakan WebSocket hanya karena terdengar modern.

---

## 20. Reverse Proxy dan Load Balancer Boundary

WebSocket hampir selalu berjalan di belakang proxy/LB.

Alur production umum:

```text
Browser
  │ wss://app.example.com/ws
  ▼
CDN/WAF
  ▼
Load Balancer
  ▼
Ingress / Reverse Proxy
  ▼
Servlet Container
  ▼
Jakarta WebSocket Endpoint
```

Agar WebSocket berfungsi, semua layer harus mendukung:

- HTTP upgrade,
- long-lived connection,
- idle timeout yang cukup,
- header forwarding,
- TLS/SNI/certificate yang benar,
- connection draining saat deployment,
- body/frame size limit yang masuk akal.

### 20.1 Nginx Conceptual Config

Contoh konseptual:

```nginx
location /ws/ {
    proxy_pass http://app_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
}
```

Hal penting:

- `proxy_http_version 1.1` diperlukan untuk upgrade tradisional.
- `Upgrade` dan `Connection` harus diteruskan.
- `proxy_read_timeout` harus lebih panjang dari expected idle interval, atau heartbeat harus lebih pendek dari timeout.

### 20.2 Load Balancer Idle Timeout

Jika LB idle timeout 60 detik dan aplikasi tidak mengirim apa pun selama 5 menit, koneksi bisa diputus.

Solusi:

```text
heartbeat interval < lowest idle timeout in chain
```

Contoh:

```text
CDN idle timeout:       100s
LB idle timeout:         60s
Ingress read timeout:    75s
App idle timeout:       120s

Recommended heartbeat:  25-45s, plus jitter if many clients
```

Jangan hanya menaikkan timeout tanpa limit. Long-lived connection adalah resource.

---

## 21. TLS Termination dan Scheme

Biasanya browser memakai:

```text
wss://app.example.com/ws
```

TLS bisa terminate di:

- CDN,
- load balancer,
- ingress proxy,
- container langsung.

Jika TLS terminate sebelum container, backend mungkin menerima plain HTTP. Application tetap perlu tahu original scheme jika membuat URL, logging, origin validation, atau security decision.

Header umum:

```text
X-Forwarded-Proto: https
X-Forwarded-Host: app.example.com
Forwarded: proto=https;host=app.example.com
```

Untuk WebSocket, scheme mapping:

```text
https → wss
http  → ws
```

Bug umum:

```text
Browser page HTTPS mencoba ws://backend-internal/ws
→ mixed content / blocked / wrong host / security failure
```

---

## 22. Authentication Pada Handshake

WebSocket handshake adalah HTTP request, sehingga bisa membawa:

- cookie session,
- authorization header,
- query parameter,
- subprotocol token,
- custom header dari non-browser client.

Namun browser WebSocket API punya batasan: custom header tidak bisa di-set bebas seperti `fetch`. Karena itu browser app sering memakai:

1. cookie-based session,
2. token di query string,
3. token di first application message setelah connection open,
4. token via subprotocol dengan caveat tertentu.

### 22.1 Cookie-Based Auth

Contoh:

```http
Cookie: JSESSIONID=abc123
```

Kelebihan:

- integrated dengan login web biasa,
- mudah untuk same-site app,
- container/framework bisa reuse session.

Risiko:

- browser otomatis mengirim cookie,
- harus validasi `Origin`,
- SameSite/Secure/Domain/Path harus benar,
- session expiry saat connection masih open perlu policy.

### 22.2 Token di Query String

Contoh:

```text
wss://example.com/ws?access_token=...
```

Kelebihan:

- sederhana,
- cocok untuk short-lived pre-signed connection token.

Risiko:

- URL bisa masuk log,
- token bisa terlihat di metrics/proxy/access log,
- browser history biasanya tidak untuk WebSocket URL, tetapi infrastructure logs tetap masalah.

Gunakan hanya jika token:

- short-lived,
- scoped khusus WebSocket,
- tidak reusable untuk API lain,
- tidak disimpan panjang di log.

### 22.3 First Message Auth

Client connect lalu mengirim message pertama:

```json
{"type":"auth","token":"..."}
```

Kelebihan:

- token tidak di URL,
- bisa memakai normal message protocol.

Risiko:

- koneksi sempat terbuka sebelum auth selesai,
- server harus membatasi apa pun sebelum authenticated,
- timeout auth harus pendek,
- rate limit handshake tetap diperlukan.

---

## 23. Authorization Berbeda Dari Authentication

Authentication menjawab:

```text
Siapa koneksi ini?
```

Authorization menjawab:

```text
Message/channel/action apa yang boleh dilakukan koneksi ini?
```

Contoh:

```json
{"type":"case.subscribe","caseId":"CASE-123"}
```

Server harus cek:

- user boleh melihat case tersebut?
- user boleh subscribe channel itu?
- role user masih valid?
- tenant/org cocok?
- session belum revoked?

Jangan menganggap authorization cukup dilakukan saat handshake.

Long-lived connection menimbulkan masalah:

```text
User authorized at 10:00
Role revoked at 10:05
Connection still open at 10:30
```

Desain policy:

- close connection saat role/session revoked,
- revalidate per message,
- revalidate saat subscribe,
- short session TTL + heartbeat auth refresh,
- server-side session registry untuk revoke.

---

## 24. Origin Validation

Karena browser otomatis mengirim cookie ke domain yang sesuai, WebSocket endpoint yang memakai cookie session harus memvalidasi `Origin`.

Contoh allowed:

```text
Origin: https://app.example.com
```

Reject:

```text
Origin: https://evil.example.net
```

Origin validation bukan CORS biasa. WebSocket tidak memakai preflight CORS seperti `fetch` tertentu. Server harus punya policy sendiri pada handshake.

Policy sederhana:

```text
allow exact known origins only
avoid wildcard for authenticated WebSocket
log rejected origin with request id
```

Anti-pattern:

```java
// Conceptual anti-pattern
if (origin != null) allow();
```

Origin harus dibandingkan dengan allowlist, bukan sekadar dicek ada/tidak.

---

## 25. Message Protocol: WebSocket Hanya Transport

WebSocket hanya memberi koneksi dan message framing. Ia tidak mendefinisikan business protocol.

Anda harus mendesain message protocol sendiri atau memakai subprotocol existing.

Contoh custom JSON protocol:

```json
{
  "id": "msg-001",
  "type": "case.subscribe",
  "version": 1,
  "payload": {
    "caseId": "CASE-2026-0001"
  }
}
```

Response:

```json
{
  "id": "msg-001",
  "type": "case.subscribe.ack",
  "success": true
}
```

Error:

```json
{
  "id": "msg-001",
  "type": "error",
  "error": {
    "code": "CASE_NOT_AUTHORIZED",
    "message": "You are not allowed to subscribe to this case."
  }
}
```

Minimum field yang sering berguna:

| Field | Fungsi |
|---|---|
| `id` | correlation/idempotency/ack matching |
| `type` | routing message |
| `version` | schema evolution |
| `payload` | business data |
| `timestamp` | debugging/order hint |
| `traceId` | observability jika aman |
| `ackRequired` | reliability policy |

---

## 26. Ordering dan Delivery Semantics

WebSocket menjaga byte order dalam satu TCP connection. Tetapi application-level semantics tetap perlu dirancang.

Dalam satu koneksi:

```text
Message A sent before Message B
→ normally received in order on same connection
```

Namun secara sistem end-to-end:

- client bisa reconnect,
- server node bisa berubah,
- message bisa diproses async,
- server bisa mengirim dari beberapa thread,
- broker bisa reorder tergantung partition/topic,
- duplicate bisa terjadi setelah reconnect/replay.

Jangan menyimpulkan:

```text
WebSocket ordered → business event globally ordered
```

Yang benar:

```text
WebSocket gives connection-level ordered delivery.
Application must define cross-connection, reconnect, cluster, and retry semantics.
```

---

## 27. Reliability: Apa Yang Tidak Diberikan WebSocket

WebSocket tidak otomatis memberi:

- persistent queue,
- offline delivery,
- exactly-once delivery,
- message replay,
- durable subscription,
- per-message transaction,
- cluster fan-out,
- authorization refresh,
- reconnect strategy,
- backpressure policy,
- slow consumer handling.

Jika aplikasi butuh reliability, desain di atas WebSocket.

Contoh reliability layer:

```json
{
  "id": "evt-1001",
  "type": "notification.created",
  "sequence": 42,
  "payload": {...}
}
```

Client ack:

```json
{
  "type": "ack",
  "id": "evt-1001",
  "sequence": 42
}
```

Reconnect resume:

```json
{
  "type": "resume",
  "lastSeenSequence": 42
}
```

Server behavior:

```text
if replay window contains sequence > 42:
    replay missed events
else:
    ask client to full refresh
```

---

## 28. Backpressure dan Slow Client

Backpressure adalah kemampuan sistem untuk menghindari producer mengirim lebih cepat daripada consumer memproses.

Dalam WebSocket:

```text
fast server → slow network/client → outbound buffer grows → memory pressure → node dies
```

Slow client scenarios:

- mobile network lambat,
- browser tab background,
- client JS blocked,
- proxy buffering,
- user tidak membaca data,
- downstream path congested.

Mitigasi:

1. batasi outbound queue per session,
2. drop non-critical message,
3. coalesce message,
4. close slow connection dengan close code/policy,
5. gunakan async send callback untuk tracking,
6. pisahkan topic high/low priority,
7. expose metrics per connection/session.

Policy example:

```text
if outboundQueueSize > 1000:
    if messages are replaceable state updates:
        keep latest only
    else:
        close with 1013 Try Again Later
```

Untuk dashboard state, lebih baik mengirim state terbaru daripada semua intermediate update.

---

## 29. Reconnect Storm

Reconnect storm terjadi ketika banyak client reconnect bersamaan.

Penyebab:

- deploy/restart semua pod,
- LB timeout massal,
- Redis/broker outage,
- DNS issue,
- network partition,
- server close semua connection,
- app bug di heartbeat.

Efek:

```text
100k clients disconnected
→ all reconnect immediately
→ handshake spike
→ auth DB/cache spike
→ thread pool saturated
→ more failures
→ more reconnects
```

Mitigasi client:

```text
exponential backoff + jitter
cap max delay
reset delay after stable connection
avoid synchronized reconnect
```

Contoh policy:

```text
attempt 1: 1s ± jitter
attempt 2: 2s ± jitter
attempt 3: 4s ± jitter
attempt 4: 8s ± jitter
max: 30s ± jitter
```

Mitigasi server:

- rate limit handshake,
- return close code / HTTP rejection with retry hint where possible,
- admission control,
- health/readiness gating,
- graceful drain,
- staggered deployment,
- broker reconnect backoff,
- cache auth decision carefully.

---

## 30. Kubernetes dan Rolling Update Problem

WebSocket connection melekat ke pod/node tertentu.

Pada rolling update:

```text
old pod gets SIGTERM
readiness becomes false
LB stops new connections
existing WebSocket connections still open
pod must drain or close them gracefully
```

Jika tidak didesain:

- connection diputus mendadak,
- client reconnect storm,
- message in-flight hilang,
- presence ghost,
- user melihat UI inconsistent.

Graceful strategy:

1. readiness false dulu,
2. stop accepting new WebSocket connection,
3. notify existing clients:

```json
{"type":"server.draining","retryAfterMs":5000}
```

4. close connection with appropriate code, e.g. `1012 Service Restart`,
5. allow client reconnect with jitter,
6. wait drain grace period,
7. force close remaining connections,
8. shutdown pod.

Server harus membedakan:

```text
normal close by user
server restart close
policy violation close
network abnormal close
```

Karena client behavior berbeda.

---

## 31. Sticky Session dan Cluster Awareness

WebSocket connection adalah long-lived. Setelah connection diterima oleh node A, semua message pada koneksi itu masuk ke node A.

```text
Client 1 ───── WebSocket ─────► Pod A
Client 2 ───── WebSocket ─────► Pod B
Client 3 ───── WebSocket ─────► Pod A
```

Jika user A ingin mengirim message ke user B, dan B tersambung ke Pod B, maka Pod A harus punya cara mencapai Pod B.

Pattern:

### 31.1 Node-Local Only

Cocok untuk simple non-clustered app.

```text
Map<userId, Session> localSessions
```

Masalah: tidak bekerja untuk multi-node fan-out.

### 31.2 Sticky Session

LB memastikan client reconnect ke node yang sama selama mungkin.

Membantu session affinity, tetapi tidak menyelesaikan:

- node crash,
- fan-out antar user di node berbeda,
- deploy,
- horizontal scale.

### 31.3 Distributed Pub/Sub

Setiap node subscribe ke broker:

```text
Pod A ─┐
Pod B ─┼── Redis/RabbitMQ/Kafka/pubsub
Pod C ─┘
```

Jika event untuk user X muncul, broker menyampaikan ke node yang punya connection user X.

Kebutuhan tambahan:

- session registry,
- user-to-node mapping,
- duplicate handling,
- delivery acknowledgement,
- cleanup stale mapping.

---

## 32. WebSocket Dengan Message Broker

Broker sering dipakai untuk:

- fan-out antar node,
- decoupling event producer dan WebSocket gateway,
- replay/durable event,
- buffering,
- rate control,
- integration antar service.

Namun broker bukan magic.

| Broker pattern | Cocok untuk | Caveat |
|---|---|---|
| Redis Pub/Sub | Low-latency fan-out sederhana | Tidak durable |
| Redis Streams | Replay ringan, consumer group | Operasional dan trimming perlu desain |
| RabbitMQ | Routing, queue, ack | Per-user queue bisa berat |
| Kafka | Durable ordered log, replay | Latency/partition semantics, complexity |
| In-memory local | Simple single node | Tidak cluster-safe |

Rule praktis:

```text
WebSocket gateway should often be thin.
Durable business events should usually live outside WebSocket connection memory.
```

---

## 33. Observability WebSocket Berbeda Dari HTTP

HTTP access log memberi:

```text
method path status duration bytes
```

Untuk WebSocket, access log handshake hanya melihat:

```text
GET /ws 101
```

Itu tidak cukup.

Metrics yang perlu dipikirkan:

| Metric | Kenapa penting |
|---|---|
| active connections | capacity baseline |
| connections opened/sec | handshake load |
| connections closed/sec | churn |
| close code distribution | failure reason |
| abnormal close count | network/proxy/app issue |
| message received/sec | inbound load |
| message sent/sec | outbound load |
| bytes in/out | bandwidth |
| outbound queue size | slow consumer |
| ping RTT | network health |
| auth failure handshake | attack/misconfig |
| origin rejection | CSWSH defense visibility |
| reconnect rate | client/network/deploy health |
| connection duration | stability |
| per-node connection count | load distribution |

Log events:

```text
connection_opened
connection_authenticated
subscription_created
message_rejected
slow_consumer_detected
connection_closed
connection_abnormal
server_draining
```

Jangan log semua payload mentah di production, terutama jika payload mengandung PII, token, case data, atau message privat.

---

## 34. Debugging WebSocket Dengan Browser DevTools

Browser DevTools biasanya menyediakan tab Network → WS.

Yang perlu dicek:

1. handshake status `101 Switching Protocols`,
2. request headers:
   - `Upgrade`,
   - `Connection`,
   - `Sec-WebSocket-Key`,
   - `Origin`,
   - `Cookie`,
3. response headers:
   - `Upgrade`,
   - `Connection`,
   - `Sec-WebSocket-Accept`,
   - `Sec-WebSocket-Protocol`,
4. messages sent/received,
5. close code,
6. close reason,
7. timing/duration.

Common symptoms:

| Symptom | Kemungkinan |
|---|---|
| HTTP 404 | endpoint path/context/proxy path salah |
| HTTP 400 | invalid upgrade header/protocol mismatch |
| HTTP 401/403 | auth/session/origin rejected |
| HTTP 426 | upgrade required/misrouted request |
| 101 lalu close cepat | app-level auth/exception/idle/policy |
| close 1006 | abnormal close; proxy/network/server crash |
| repeated reconnect | client backoff bug/server close loop |
| works local, fails behind proxy | missing upgrade headers/timeout/TLS/SameSite |

---

## 35. Production Failure Model

WebSocket failure harus dimodelkan eksplisit.

### 35.1 Handshake Failure

```text
Client cannot upgrade to WebSocket.
```

Penyebab:

- route salah,
- endpoint tidak deployed,
- proxy tidak forward upgrade,
- auth expired,
- origin rejected,
- TLS/certificate issue,
- wrong `ws://` vs `wss://`,
- LB/WAF blocking.

Mitigasi:

- clear HTTP status saat reject,
- structured log handshake failure,
- metric by reason,
- client error classification.

### 35.2 Connection Drop

```text
Connection closes unexpectedly.
```

Penyebab:

- network change,
- proxy idle timeout,
- server restart,
- pod killed,
- browser tab suspended,
- mobile background policy,
- NAT timeout.

Mitigasi:

- heartbeat,
- reconnect with jitter,
- resume token/sequence,
- idempotent subscribe.

### 35.3 Slow Consumer

```text
Server sends faster than client can receive.
```

Mitigasi:

- outbound queue limit,
- coalescing,
- drop policy,
- close policy,
- metrics.

### 35.4 Message Protocol Error

```text
Client sends malformed or unauthorized message.
```

Mitigasi:

- schema validation,
- error response,
- rate limit,
- close with `1008`/`1007`/`1009`,
- do not let bad client degrade whole node.

### 35.5 Reconnect Storm

```text
Many clients reconnect at once.
```

Mitigasi:

- jitter,
- admission control,
- deployment drain,
- staggered restart,
- retry hints.

### 35.6 Cluster State Loss

```text
Node has local connection state; node dies.
```

Mitigasi:

- reconstruct state on reconnect,
- externalize durable subscriptions if needed,
- expire stale presence,
- design session registry with TTL.

---

## 36. Mental Model: WebSocket Gateway

Dalam arsitektur enterprise, lebih aman memikirkan WebSocket server sebagai gateway, bukan tempat utama business state.

```text
Browser Clients
   │
   ▼
WebSocket Gateway
   │  authenticate
   │  authorize subscription/message
   │  enforce rate/size/backpressure
   │  maintain connection registry
   │  translate protocol
   ▼
Application Services / Broker / Domain Events
```

Responsibilities gateway:

- handshake validation,
- origin validation,
- auth binding,
- connection lifecycle,
- message parsing/validation,
- protocol versioning,
- fan-out,
- backpressure,
- close/reconnect semantics,
- observability.

Responsibilities domain services:

- business transaction,
- durable state,
- authorization policy source,
- audit,
- event production,
- consistency.

Anti-pattern:

```text
WebSocket endpoint directly owns complex business workflow state only in memory.
```

Jika node restart, state hilang. Jika scale out, state tersebar. Jika reconnect, behavior ambiguous.

---

## 37. Designing Message Types

Message type harus diperlakukan sebagai API contract.

Contoh taxonomy:

```text
system.*
auth.*
heartbeat.*
subscription.*
case.*
notification.*
error
ack
```

Contoh:

```json
{"type":"system.hello","version":1,"connectionId":"c-123"}
{"type":"auth.refresh","token":"..."}
{"type":"subscription.create","topic":"case:CASE-1"}
{"type":"subscription.cancel","topic":"case:CASE-1"}
{"type":"case.event","sequence":101,"payload":{}}
{"type":"ack","id":"msg-123"}
{"type":"error","code":"INVALID_MESSAGE"}
```

Design rules:

1. Every client command should have predictable success/failure response.
2. Every server event should be versioned.
3. Every message with side effect should have idempotency/correlation id.
4. Every subscription should have explicit lifecycle.
5. Every error should be machine-readable.
6. Every unknown message type should be rejected safely.
7. Every large payload should have explicit limit.

---

## 38. Payload Size Policy

WebSocket endpoint harus punya limit.

Contoh policy:

```text
max text message:       64 KiB
max binary message:    256 KiB
max subscriptions/user: 100
max connections/user:   5
max inbound msg/sec:    20
max outbound queue:   1000 messages or 16 MiB
```

Kenapa?

- mencegah memory blowup,
- mencegah malicious payload,
- melindungi parser JSON,
- menghindari latency spike,
- menjaga fairness antar user.

Jika butuh file besar, gunakan HTTP upload/download atau object storage signed URL, bukan WebSocket besar tanpa kontrol.

---

## 39. Heartbeat Design

Heartbeat harus disesuaikan dengan timeout chain.

Contoh:

```text
LB idle timeout:          60s
Ingress read timeout:     75s
Container idle timeout:  120s
Client heartbeat:         30s
Server missed threshold:   3
```

State:

```text
lastPongAt
lastMessageAt
lastAppHeartbeatAt
missedHeartbeatCount
```

Policy:

```text
every 30s:
    send ping

if no pong for 90s:
    close connection
    cleanup session registry
```

Jangan membuat semua client heartbeat pada detik yang sama. Tambahkan jitter:

```text
heartbeat interval = 30s ± 5s
```

Ini mengurangi synchronized traffic spike.

---

## 40. Graceful Shutdown Untuk WebSocket

HTTP graceful shutdown sering cukup dengan berhenti menerima request baru dan menunggu request selesai.

WebSocket berbeda karena koneksi bisa bertahan jam-jaman.

Policy yang lebih realistis:

```text
on shutdown:
    mark server draining
    reject new handshakes
    notify active clients
    close connections gradually
    wait bounded grace period
    force close remaining
```

Message:

```json
{
  "type": "system.draining",
  "reason": "server_restart",
  "retryAfterMs": 3000
}
```

Close:

```text
code: 1012 Service Restart
reason: server restarting
```

Client:

```text
wait retryAfter + jitter
reconnect
resubscribe
resume from last sequence if supported
```

---

## 41. Java/Jakarta Context

Part ini membahas protokol. Implementasi Java akan masuk lebih dalam di Part 022 dan seterusnya.

Namun peta versinya:

| Era | API Package | Contoh |
|---|---|---|
| Java EE / Jakarta EE 8 legacy | `javax.websocket.*` | `@ServerEndpoint` lama |
| Jakarta EE 9+ | `jakarta.websocket.*` | namespace baru |
| Jakarta EE 11 | Jakarta WebSocket 2.2 | modern Jakarta EE baseline |

Container modern:

- Tomcat menyediakan Jakarta WebSocket API implementation.
- Jetty menyediakan WebSocket support dan Jakarta EE environment variants.
- Undertow/WildFly menyediakan WebSocket integration di application server context.
- Open Liberty/Payara/GlassFish menyediakan Jakarta EE WebSocket support sesuai profile/platform.

Tetapi semua tetap tunduk pada realitas protokol:

```text
Handshake must work.
Proxy must support upgrade.
Connection must be managed.
Messages must be validated.
Failures must be modelled.
```

---

## 42. Minimal Browser Client Mental Model

Contoh client sederhana:

```javascript
const socket = new WebSocket("wss://app.example.com/ws/notifications");

socket.addEventListener("open", () => {
  console.log("websocket open");
  socket.send(JSON.stringify({ type: "subscription.create", topic: "notifications" }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  console.log("message", message);
});

socket.addEventListener("close", (event) => {
  console.log("closed", event.code, event.reason, event.wasClean);
});

socket.addEventListener("error", (event) => {
  console.log("websocket error", event);
});
```

Yang sering dilupakan:

- `error` event browser tidak selalu memberi detail lengkap.
- Detail handshake failure sering harus dilihat di Network tab atau server log.
- `close` code `1006` berarti abnormal closure dan bukan close code yang dikirim peer.
- `send()` saat socket belum `OPEN` akan gagal.
- Client harus punya reconnect policy.
- Client harus resubscribe setelah reconnect.

---

## 43. Minimal Server-Side Thinking Before Code

Sebelum menulis endpoint, jawab pertanyaan ini:

### 43.1 Connection

- Siapa boleh connect?
- Dari origin mana?
- Berapa connection per user/IP?
- Berapa idle timeout?
- Bagaimana close saat logout/session revoked?

### 43.2 Message

- Format message apa?
- Bagaimana versioning?
- Bagaimana schema validation?
- Apa max size?
- Apa behavior untuk unknown type?
- Apa setiap command punya ack/error?

### 43.3 Reliability

- Apakah message harus durable?
- Apakah client bisa resume?
- Apakah duplicate mungkin?
- Apakah ordering penting?
- Apa strategy setelah reconnect?

### 43.4 Scale

- Apakah multi-node?
- Bagaimana fan-out antar node?
- Apakah perlu broker?
- Bagaimana session registry dibersihkan?
- Apa yang terjadi saat pod restart?

### 43.5 Operations

- Metrics apa?
- Close code apa?
- Log apa?
- Bagaimana debugging handshake failure?
- Bagaimana mendeteksi slow consumer?

Jika belum bisa menjawab ini, endpoint WebSocket akan menjadi fragile.

---

## 44. Common Anti-Patterns

### 44.1 Treating WebSocket Like REST

```text
client sends request-like message
server sends response-like message
without lifecycle/reconnect/backpressure design
```

Masalah: begitu connection drop, semua asumsi request/response runtuh.

### 44.2 No Origin Validation

Cookie-based WebSocket tanpa origin validation adalah risiko besar.

### 44.3 Unlimited Message Size

Satu client bisa mengirim payload besar dan memaksa server allocate memory besar.

### 44.4 No Heartbeat

Connection mati diam-diam, registry masih menganggap user online.

### 44.5 Immediate Reconnect Without Backoff

Reconnect storm saat server restart.

### 44.6 Node-Local State Without Cluster Plan

Berjalan di local/single node, rusak saat scale-out.

### 44.7 Logging Full Payload

Membocorkan token, PII, atau domain-sensitive data.

### 44.8 No Backpressure

Outbound buffer tumbuh sampai memory pressure.

### 44.9 Business Transaction Inside Connection Memory

Jika node mati, workflow state hilang.

### 44.10 Assuming `send()` Means Delivered to User

Send success sering hanya berarti data diterima oleh socket/container buffer, bukan user benar-benar memproses business event.

---

## 45. Production Checklist

### Protocol

- [ ] Endpoint memakai `wss://` di production.
- [ ] Handshake `101` berhasil di semua environment.
- [ ] `Upgrade` dan `Connection` diteruskan proxy.
- [ ] Subprotocol dipilih eksplisit jika digunakan.
- [ ] Compression diputuskan sadar trade-off.

### Security

- [ ] Authentication jelas.
- [ ] Origin allowlist diterapkan.
- [ ] Authorization per subscription/message.
- [ ] Max connection per user/IP.
- [ ] Max message size.
- [ ] Rate limit inbound message.
- [ ] Sensitive token tidak bocor di URL/log.

### Reliability

- [ ] Heartbeat ada.
- [ ] Reconnect backoff + jitter.
- [ ] Resubscribe/resume strategy.
- [ ] Duplicate handling.
- [ ] Close code policy.
- [ ] Graceful shutdown/drain.

### Scale

- [ ] Multi-node behavior jelas.
- [ ] Broker/pubsub strategy jika perlu.
- [ ] Session registry cleanup.
- [ ] Sticky session policy dipahami.
- [ ] Reconnect storm mitigation.

### Observability

- [ ] Active connection metric.
- [ ] Open/close rate.
- [ ] Close code distribution.
- [ ] Message in/out rate.
- [ ] Outbound queue metric.
- [ ] Auth/origin reject metric.
- [ ] Reconnect rate.
- [ ] Slow consumer detection.

---

## 46. Latihan Mental Model

### Kasus 1: Notification System

Requirement:

```text
User menerima notifikasi real-time saat case berubah status.
```

Pertanyaan:

- Apakah butuh client-to-server frequent message?
- Kalau hanya server-to-client, apakah SSE cukup?
- Jika WebSocket, bagaimana user subscribe?
- Apakah notifikasi durable?
- Jika user offline, apakah notifikasi tetap muncul saat login lagi?
- Jika node restart, apakah missed notification bisa diambil ulang?

Kemungkinan desain:

```text
Durable notification stored in DB
Domain event published to broker
WebSocket gateway sends live push if user online
Client does full sync on reconnect/login
WebSocket is acceleration channel, not source of truth
```

### Kasus 2: Live Case Collaboration

Requirement:

```text
Beberapa officer melihat case yang sama dan perubahan field terlihat live.
```

Pertanyaan:

- Apakah event ordering penting?
- Apakah concurrent edit boleh?
- Siapa source of truth?
- Bagaimana conflict resolution?
- Apakah optimistic locking tetap perlu?
- Apakah WebSocket message boleh langsung mutate DB?

Kemungkinan desain:

```text
HTTP/command API remains transactional source of truth
WebSocket broadcasts committed changes
Client treats push as invalidation/update signal
Conflict handled by versioning/optimistic lock
```

### Kasus 3: Progress Report Generation

Requirement:

```text
User melihat progress report generation.
```

Pertanyaan:

- Butuh bidirectional?
- SSE cukup?
- Apakah progress event hilang fatal?
- Apa fallback jika connection drop?

Kemungkinan desain:

```text
Use SSE or polling
Report status stored in DB/cache
Client can refresh status via HTTP
WebSocket only if already using gateway for broader real-time platform
```

---

## 47. Ringkasan Inti

WebSocket adalah protokol long-lived, full-duplex, message-oriented yang dimulai dari HTTP upgrade handshake.

Hal yang harus melekat:

1. WebSocket bukan REST panjang.
2. Handshake adalah HTTP; setelah `101`, lifecycle menjadi connection lifecycle.
3. Message framing bukan business reliability.
4. Ping/pong membantu liveness, bukan bukti user memproses event.
5. Close code adalah bagian dari kontrak client/server.
6. Proxy/LB timeout sering menjadi penyebab utama bug production.
7. Authentication saat handshake tidak cukup; authorization message/subscription tetap perlu.
8. Origin validation penting untuk cookie-based browser WebSocket.
9. Backpressure dan slow consumer harus didesain.
10. Reconnect storm adalah risiko arsitektural nyata.
11. WebSocket gateway sebaiknya tidak menjadi satu-satunya source of truth business state.
12. Observability WebSocket harus melampaui access log `101`.

---

## 48. Apa Yang Akan Dibahas Di Part Berikutnya

Part berikutnya:

```text
Part 022 — Jakarta WebSocket Server Endpoint Model
```

Kita akan masuk ke API Java/Jakarta:

- `@ServerEndpoint`,
- `@OnOpen`,
- `@OnMessage`,
- `@OnClose`,
- `@OnError`,
- `Session`,
- endpoint lifecycle,
- programmatic endpoint,
- configurator,
- path parameters,
- encoders/decoders,
- partial message,
- subprotocol negotiation,
- dependency injection caveat,
- hubungan WebSocket endpoint dengan servlet container.

---

## 49. Referensi

- RFC 6455 — The WebSocket Protocol.
- Jakarta WebSocket 2.2 Specification, release for Jakarta EE 11.
- Jakarta EE Tutorial — Jakarta WebSocket.
- Apache Tomcat 11 WebSocket How-To and WebSocket API documentation.
- MDN WebSocket API documentation, especially close event/code and protocol usage.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 020 — Packaging Models: WAR, Embedded Container, Executable JAR, Native-ish Deployments](./learn-java-servlet-websocket-web-container-runtime-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 022 — Jakarta WebSocket Server Endpoint Model](./learn-java-servlet-websocket-web-container-runtime-part-022.md)
