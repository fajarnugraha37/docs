# learn-java-servlet-websocket-web-container-runtime — Part 022
# Jakarta WebSocket Server Endpoint Model

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `022`  
> Topik: Jakarta WebSocket server endpoint model, annotation endpoint, programmatic endpoint, lifecycle, `Session`, encoder/decoder, configurator, subprotocol, partial message, container integration  
> Target: Java 8 hingga Java 25, Java EE `javax.websocket.*` hingga Jakarta EE `jakarta.websocket.*`

---

## 0. Posisi Part Ini Dalam Seri

Di Part 021 kita membahas WebSocket sebagai **protocol**: handshake HTTP upgrade, frame, message, close code, ping/pong, reconnect, proxy, load balancer, dan failure model jaringan.

Part 022 sekarang masuk ke sisi **Jakarta WebSocket API**: bagaimana protocol itu dipetakan menjadi model pemrograman Java.

Mental shift yang penting:

```text
RFC 6455 WebSocket Protocol
  = aturan wire-level: handshake, frame, opcode, masking, ping/pong, close

Jakarta WebSocket API
  = model aplikasi Java: endpoint, session, message handler, encoder, decoder,
    configurator, path parameter, subprotocol, deployment discovery
```

Jadi engineer Servlet/WebSocket level tinggi tidak hanya tahu:

```java
@ServerEndpoint("/chat")
```

tapi paham:

1. kapan endpoint dibuat,
2. berapa banyak instance endpoint yang ada,
3. thread apa yang memanggil callback,
4. bagaimana message masuk dipilih ke method `@OnMessage`,
5. kapan `Session` valid,
6. bagaimana handshake bisa diintercept,
7. kenapa `HttpSession` berbeda dari WebSocket `Session`,
8. bagaimana dependency injection bisa gagal tergantung container,
9. bagaimana slow client mempengaruhi send,
10. bagaimana endpoint harus didesain agar aman, observable, dan cluster-aware.

Jakarta WebSocket 2.2 adalah release untuk Jakarta EE 11 dan mendefinisikan API server/client endpoint untuk WebSocket berdasarkan RFC 6455. Untuk versi modern, package utamanya adalah `jakarta.websocket.*` dan `jakarta.websocket.server.*`. Pada legacy Java EE/Jakarta EE 8, nama package-nya masih `javax.websocket.*`.

---

## 1. Big Picture: Dari HTTP Upgrade ke Endpoint Callback

Saat client membuka WebSocket:

```text
Browser / client
  └─ HTTP GET + Upgrade: websocket
       ↓
Reverse proxy / load balancer
       ↓
Servlet container / web container
       ↓
WebSocket implementation
       ↓
Endpoint matching
       ↓
Endpoint instance + @OnOpen
       ↓
Message frame stream
       ↓
@OnMessage / MessageHandler
       ↓
@OnClose / @OnError
```

Yang perlu disadari: `@ServerEndpoint` bukan Servlet biasa, tetapi hidup di dalam **web container** yang sama atau runtime yang terintegrasi dengan web container.

Hubungan dengan Servlet:

```text
Servlet stack:
  HTTP request -> filter -> servlet -> response

WebSocket stack:
  HTTP upgrade request -> WebSocket endpoint match -> upgrade accepted
  -> long-lived connection -> message callbacks
```

Setelah upgrade berhasil, koneksi tidak lagi mengikuti request/response Servlet biasa. Tetapi handshake awal tetap HTTP, sehingga masih bersentuhan dengan:

- origin,
- cookie,
- header,
- authentication context,
- reverse proxy,
- TLS termination,
- context path,
- deployment lifecycle,
- container classloader.

---

## 2. Dua Model Endpoint: Annotated vs Programmatic

Jakarta WebSocket menyediakan dua pendekatan utama:

| Model | Bentuk | Cocok Untuk |
|---|---|---|
| Annotated endpoint | `@ServerEndpoint`, `@OnOpen`, `@OnMessage`, `@OnClose`, `@OnError` | mayoritas use case aplikasi |
| Programmatic endpoint | extends `Endpoint`, register via `ServerEndpointConfig` / `ServerContainer` | advanced configuration, dynamic registration, framework integration |

### 2.1 Annotated Endpoint

Contoh minimal:

```java
package com.example.websocket;

import jakarta.websocket.OnClose;
import jakarta.websocket.OnError;
import jakarta.websocket.OnMessage;
import jakarta.websocket.OnOpen;
import jakarta.websocket.Session;
import jakarta.websocket.server.ServerEndpoint;

@ServerEndpoint("/ws/echo")
public class EchoEndpoint {

    @OnOpen
    public void onOpen(Session session) {
        System.out.println("Open: " + session.getId());
    }

    @OnMessage
    public String onText(String message, Session session) {
        return "echo: " + message;
    }

    @OnClose
    public void onClose(Session session) {
        System.out.println("Close: " + session.getId());
    }

    @OnError
    public void onError(Session session, Throwable error) {
        error.printStackTrace();
    }
}
```

Annotated endpoint terlihat sederhana, tetapi container melakukan banyak hal:

1. scan class endpoint,
2. membaca URI template `/ws/echo`,
3. memvalidasi method callback,
4. membuat metadata endpoint,
5. saat handshake masuk, mencocokkan path,
6. membuat endpoint instance,
7. membuat WebSocket `Session`,
8. memanggil lifecycle callback.

### 2.2 Programmatic Endpoint

Programmatic endpoint menggunakan class `Endpoint`:

```java
package com.example.websocket;

import jakarta.websocket.Endpoint;
import jakarta.websocket.EndpointConfig;
import jakarta.websocket.MessageHandler;
import jakarta.websocket.Session;

public class EchoProgrammaticEndpoint extends Endpoint {

    @Override
    public void onOpen(Session session, EndpointConfig config) {
        session.addMessageHandler(String.class, new MessageHandler.Whole<String>() {
            @Override
            public void onMessage(String message) {
                session.getAsyncRemote().sendText("echo: " + message);
            }
        });
    }
}
```

Endpoint ini kemudian didaftarkan dengan `ServerEndpointConfig`:

```java
import jakarta.websocket.server.ServerEndpointConfig;

ServerEndpointConfig config = ServerEndpointConfig.Builder
        .create(EchoProgrammaticEndpoint.class, "/ws/echo-programmatic")
        .build();
```

Pendaftaran aktual bergantung environment. Di container Jakarta EE, biasanya melalui `ServerApplicationConfig` atau `ServerContainer`.

---

## 3. Mapping Endpoint dan Path Parameter

`@ServerEndpoint` menerima URI template:

```java
@ServerEndpoint("/ws/cases/{caseId}/events")
public class CaseEventsEndpoint {

    @OnOpen
    public void onOpen(Session session,
                       @jakarta.websocket.server.PathParam("caseId") String caseId) {
        System.out.println("caseId = " + caseId);
    }
}
```

Jika application context path adalah `/aceas`, endpoint path `/ws/cases/{caseId}/events` biasanya diakses sebagai:

```text
wss://example.com/aceas/ws/cases/CASE-123/events
```

Penting membedakan:

| Komponen | Contoh | Pemilik |
|---|---|---|
| Scheme | `wss` | client/proxy/TLS |
| Host | `example.com` | DNS/proxy |
| Context path | `/aceas` | web app deployment |
| Endpoint path | `/ws/cases/{caseId}/events` | WebSocket endpoint |
| Query string | `?token=...` | client/app, tapi hati-hati security |

### 3.1 Jangan Taruh Secret di URL Jika Bisa Dihindari

Secara teknis query string bisa dibaca di handshake, tetapi token di URL mudah bocor ke:

- access log proxy,
- browser history,
- monitoring,
- exception log,
- screenshot,
- referrer edge case,
- reverse proxy debug log.

Lebih aman:

- cookie session yang valid,
- short-lived token via header jika client non-browser mendukung,
- subprotocol khusus jika benar-benar didesain hati-hati,
- handshake auth melalui configurator dengan origin/header/cookie validation.

Browser WebSocket API tidak mengizinkan custom arbitrary header dengan mudah seperti `fetch`, sehingga desain auth browser WebSocket sering memakai cookie atau token di query string dengan mitigasi ketat.

---

## 4. Endpoint Lifecycle dan Instance Model

Ini salah satu bagian paling penting.

Pada annotated endpoint, container umumnya membuat **endpoint instance per connection**. Artinya:

```text
Client A connects -> Endpoint instance A
Client B connects -> Endpoint instance B
Client C connects -> Endpoint instance C
```

Tetapi jangan membangun desain hanya berdasarkan intuisi ini tanpa membaca spec/container. Yang aman:

1. jangan menyimpan global mutable state di field static tanpa concurrency control,
2. jangan menganggap callback selalu serial secara absolut dalam semua kondisi,
3. jangan menganggap endpoint object adalah Spring singleton biasa,
4. jangan menganggap satu user hanya punya satu connection.

Contoh state per connection:

```java
@ServerEndpoint("/ws/chat/{roomId}")
public class ChatEndpoint {

    private String roomId;
    private String userId;

    @OnOpen
    public void onOpen(Session session,
                       @PathParam("roomId") String roomId) {
        this.roomId = roomId;
        this.userId = resolveUser(session);
    }

    @OnMessage
    public void onMessage(String message) {
        // roomId dan userId adalah state endpoint instance ini
    }
}
```

Ini terlihat nyaman, tetapi tetap perlu hati-hati:

- kalau container membuat instance berbeda per connection, field instance aman untuk connection-local state;
- kalau ada async task yang mengakses field itu, tetap perlu memory visibility dan lifecycle awareness;
- kalau connection ditutup, async task tidak boleh terus memakai state lama;
- kalau user reconnect, instance lama dan baru bisa overlap sebentar.

### 4.1 Callback Lifecycle

Lifecycle normal:

```text
Handshake accepted
  ↓
endpoint instance created/configured
  ↓
@OnOpen
  ↓
@OnMessage zero or more times
  ↓
@OnClose
```

Lifecycle dengan error:

```text
@OnOpen
  ↓
@OnMessage
  ↓
exception occurs
  ↓
@OnError
  ↓
maybe @OnClose depending on failure/close state
```

Jangan mengandalkan urutan error-close terlalu naif. Dalam sistem real:

- network drop bisa terdeteksi terlambat,
- send bisa gagal setelah method application selesai,
- close bisa muncul karena idle timeout proxy,
- error bisa terjadi saat decoding sebelum method `@OnMessage` dipanggil,
- endpoint instance bisa ditinggalkan jika cleanup tidak robust.

---

## 5. `Session`: Bukan `HttpSession`

WebSocket `jakarta.websocket.Session` merepresentasikan satu koneksi WebSocket aktif.

Jangan disamakan dengan Servlet `jakarta.servlet.http.HttpSession`.

| Aspek | WebSocket `Session` | HTTP `HttpSession` |
|---|---|---|
| Representasi | satu WebSocket connection | state user lintas request HTTP |
| Umur | dari open sampai close | sampai timeout/invalidate |
| Identitas | connection id | `JSESSIONID` |
| Bisa banyak per user? | ya, multi-tab/device | biasanya satu logical browser session, tapi tidak mutlak |
| API package | `jakarta.websocket.Session` | `jakarta.servlet.http.HttpSession` |
| State storage | user properties, endpoint registry | session attributes |

Contoh akses WebSocket `Session`:

```java
@OnOpen
public void onOpen(Session session) {
    String id = session.getId();
    session.setMaxIdleTimeout(60_000);
    session.setMaxTextMessageBufferSize(64 * 1024);
    session.getUserProperties().put("openedAt", System.currentTimeMillis());
}
```

### 5.1 `Session.getUserProperties()`

`userProperties` sering dipakai untuk menyimpan metadata connection-local:

```java
session.getUserProperties().put("userId", userId);
session.getUserProperties().put("tenantId", tenantId);
session.getUserProperties().put("roomId", roomId);
```

Gunakan untuk metadata kecil. Jangan dipakai untuk:

- cache besar,
- object graph berat,
- entity persistence attached,
- stream resource,
- connection pool object,
- request-scoped object yang sudah expired.

### 5.2 Session Registry

Untuk broadcast atau push ke user tertentu, aplikasi sering menyimpan registry:

```java
public final class ConnectionRegistry {
    private final ConcurrentMap<String, Set<Session>> byUser = new ConcurrentHashMap<>();

    public void add(String userId, Session session) {
        byUser.computeIfAbsent(userId, key -> ConcurrentHashMap.newKeySet())
              .add(session);
    }

    public void remove(String userId, Session session) {
        Set<Session> sessions = byUser.get(userId);
        if (sessions == null) return;
        sessions.remove(session);
        if (sessions.isEmpty()) {
            byUser.remove(userId, sessions);
        }
    }

    public Set<Session> sessionsOf(String userId) {
        return byUser.getOrDefault(userId, Set.of());
    }
}
```

Pitfall registry:

- lupa remove saat `@OnClose`,
- lupa remove saat send failure,
- menyimpan session dari node lokal lalu berharap bisa dipakai dari node lain,
- memory leak saat client reconnect terus,
- race antara close dan broadcast,
- concurrent send ke session yang sama.

---

## 6. `@OnOpen`

`@OnOpen` dipanggil ketika koneksi berhasil dibuka.

Contoh:

```java
@OnOpen
public void onOpen(Session session,
                   EndpointConfig config,
                   @PathParam("roomId") String roomId) {
    String userId = authenticate(session, config);

    session.getUserProperties().put("userId", userId);
    session.getUserProperties().put("roomId", roomId);

    registry.add(userId, session);
}
```

Tanggung jawab yang umum di `@OnOpen`:

1. validasi user/tenant/room,
2. set limit per connection,
3. register connection,
4. initialize metadata kecil,
5. kirim welcome/initial state jika perlu,
6. reject/close connection jika authorization gagal.

Yang sebaiknya tidak dilakukan di `@OnOpen`:

- query berat tanpa timeout,
- call banyak downstream service,
- load seluruh history chat,
- memblokir thread lama,
- membuka resource yang tidak dibersihkan,
- menaruh logic bisnis besar.

Jika authorization gagal:

```java
@OnOpen
public void onOpen(Session session) throws IOException {
    if (!isAllowed(session)) {
        session.close(new CloseReason(
                CloseReason.CloseCodes.VIOLATED_POLICY,
                "Not allowed"
        ));
    }
}
```

Catatan: cara paling bersih sering kali adalah menolak saat handshake via `Configurator`, bukan setelah connection terbuka.

---

## 7. `@OnMessage`: Whole Message, Partial Message, Pong

`@OnMessage` adalah callback untuk message masuk.

### 7.1 Text Message

```java
@OnMessage
public void onText(String text, Session session) {
    session.getAsyncRemote().sendText("received: " + text);
}
```

Atau bisa return value:

```java
@OnMessage
public String onText(String text) {
    return "echo: " + text;
}
```

Return value praktis untuk echo/simple response, tetapi untuk sistem produksi biasanya `AsyncRemote` lebih eksplisit karena:

- bisa handle callback send result,
- bisa timeout,
- bisa menghindari blocking,
- lebih jelas dalam flow multi-recipient/broadcast.

### 7.2 Binary Message

```java
@OnMessage
public void onBinary(byte[] data, Session session) {
    // handle binary payload
}
```

Atau:

```java
@OnMessage
public void onBinary(ByteBuffer data, Session session) {
    // handle binary payload
}
```

Binary cocok untuk:

- compact protocol,
- file chunk,
- media/control stream,
- IoT-ish payload,
- protobuf/messagepack/custom encoding.

Tetapi binary meningkatkan tuntutan:

- schema governance,
- versioning,
- debugging tooling,
- payload validation,
- backpressure,
- max buffer size.

### 7.3 Partial Message

Untuk message besar atau streaming, API mendukung partial message:

```java
@OnMessage
public void onPartialText(String part, boolean last, Session session) {
    // append chunk, process when last == true
}
```

Mental model:

```text
WebSocket frames can fragment a message.
API can expose whole message or partial message.
Whole message is simpler.
Partial message gives more control for large payloads.
```

Partial message bagus jika:

- payload besar,
- ingin menghindari buffer besar,
- ingin proses bertahap,
- protocol memang chunk-oriented.

Tetapi partial message lebih sulit karena perlu:

- state accumulator,
- max total size,
- timeout per message,
- cleanup saat close/error,
- protection dari infinite stream.

### 7.4 Pong Message

Aplikasi bisa menerima pong:

```java
import jakarta.websocket.PongMessage;

@OnMessage
public void onPong(PongMessage pong, Session session) {
    session.getUserProperties().put("lastPongAt", System.currentTimeMillis());
}
```

Pong dipakai untuk heartbeat/latency detection. Namun detail ping/pong bisa berbeda tergantung container/client. Banyak sistem tetap menambahkan app-level heartbeat JSON karena lebih portable secara bisnis.

---

## 8. Signature Method Callback

Annotated endpoint method boleh menerima kombinasi parameter tertentu, misalnya:

- `Session`,
- `EndpointConfig`,
- `@PathParam`,
- message payload (`String`, `byte[]`, `ByteBuffer`, `Reader`, `InputStream`, decoded object),
- `Throwable` untuk `@OnError`,
- `CloseReason` untuk `@OnClose`,
- `boolean last` untuk partial message.

Contoh `@OnClose`:

```java
@OnClose
public void onClose(Session session, CloseReason reason) {
    String userId = (String) session.getUserProperties().get("userId");
    registry.remove(userId, session);

    log.info("websocket closed sessionId={} code={} reason={}",
            session.getId(),
            reason.getCloseCode(),
            reason.getReasonPhrase());
}
```

Contoh `@OnError`:

```java
@OnError
public void onError(Session session, Throwable error) {
    String sessionId = session != null ? session.getId() : "<no-session>";
    log.warn("websocket error sessionId={}", sessionId, error);
}
```

Prinsip penting:

```text
Callback signature adalah kontrak deployment-time.
Kalau signature invalid, container dapat gagal deploy endpoint.
```

Jadi error bisa terjadi saat startup/deployment, bukan saat request pertama.

---

## 9. Sending Message: `BasicRemote` vs `AsyncRemote`

`Session` menyediakan remote endpoint:

```java
session.getBasicRemote()
session.getAsyncRemote()
```

### 9.1 `BasicRemote`

```java
session.getBasicRemote().sendText("hello");
```

Karakteristik:

- synchronous/blocking style,
- lebih sederhana,
- error langsung lewat exception,
- bisa memblokir thread jika client/network lambat.

Gunakan untuk:

- contoh sederhana,
- admin/internal low-volume,
- response kecil yang tidak latency-critical,
- path yang benar-benar dikontrol.

### 9.2 `AsyncRemote`

```java
session.getAsyncRemote().sendText("hello", result -> {
    if (!result.isOK()) {
        log.warn("send failed", result.getException());
    }
});
```

Karakteristik:

- tidak memblokir caller sampai network write selesai,
- memberi callback hasil send,
- lebih cocok untuk broadcast/push,
- tetap perlu backpressure/admission control.

Jangan salah paham: async send bukan berarti infinite capacity. Jika client lambat dan aplikasi terus enqueue message, memory bisa naik.

### 9.3 Concurrent Send Hazard

Satu `Session` bisa menerima banyak send dari berbagai thread:

```text
business event thread A -> send to user session X
business event thread B -> send to user session X
heartbeat thread C       -> send ping/app heartbeat to session X
```

Risiko:

- ordering kacau,
- container menolak concurrent send,
- queue membengkak,
- message interleaving secara aplikasi,
- close race.

Pattern yang lebih aman:

```text
Per connection outbound queue
  ↓
single writer loop / serialized send
  ↓
AsyncRemote send callback
  ↓
dequeue next only after previous completes or timeout
```

Untuk aplikasi kecil, `synchronized` per session mungkin cukup. Untuk aplikasi serius, desain outbound pipeline eksplisit lebih aman.

---

## 10. Encoder dan Decoder

Encoder/decoder mengubah object aplikasi menjadi message WebSocket dan sebaliknya.

### 10.1 Decoder Text

```java
import jakarta.websocket.DecodeException;
import jakarta.websocket.Decoder;
import jakarta.websocket.EndpointConfig;

public class ChatCommandDecoder implements Decoder.Text<ChatCommand> {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public ChatCommand decode(String text) throws DecodeException {
        try {
            return objectMapper.readValue(text, ChatCommand.class);
        } catch (Exception e) {
            throw new DecodeException(text, "Invalid chat command", e);
        }
    }

    @Override
    public boolean willDecode(String text) {
        return text != null && !text.isBlank();
    }

    @Override
    public void init(EndpointConfig config) {
    }

    @Override
    public void destroy() {
    }
}
```

Endpoint:

```java
@ServerEndpoint(
        value = "/ws/chat/{roomId}",
        decoders = ChatCommandDecoder.class
)
public class ChatEndpoint {

    @OnMessage
    public void onCommand(ChatCommand command, Session session) {
        // already decoded object
    }
}
```

### 10.2 Encoder Text

```java
import jakarta.websocket.EncodeException;
import jakarta.websocket.Encoder;
import jakarta.websocket.EndpointConfig;

public class ChatEventEncoder implements Encoder.Text<ChatEvent> {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public String encode(ChatEvent event) throws EncodeException {
        try {
            return objectMapper.writeValueAsString(event);
        } catch (Exception e) {
            throw new EncodeException(event, "Cannot encode chat event", e);
        }
    }

    @Override
    public void init(EndpointConfig config) {
    }

    @Override
    public void destroy() {
    }
}
```

Endpoint:

```java
@ServerEndpoint(
        value = "/ws/chat/{roomId}",
        decoders = ChatCommandDecoder.class,
        encoders = ChatEventEncoder.class
)
public class ChatEndpoint {

    @OnOpen
    public void onOpen(Session session) {
        ChatEvent event = new ChatEvent("system", "connected");
        session.getAsyncRemote().sendObject(event);
    }
}
```

### 10.3 Encoder/Decoder Design Rules

Do:

- validate schema,
- reject unknown/unsupported message type,
- set max payload size,
- include version/type fields,
- fail closed,
- keep decoder deterministic,
- avoid DB calls inside decoder.

Do not:

- trust arbitrary JSON,
- accept polymorphic deserialization blindly,
- perform authorization in decoder,
- allocate huge objects without limit,
- hide application errors as decode errors,
- use decoder as business service.

Message envelope pattern:

```json
{
  "type": "SUBSCRIBE_CASE_EVENTS",
  "version": 1,
  "correlationId": "c-123",
  "payload": {
    "caseId": "CASE-001"
  }
}
```

Why envelope helps:

- message routing,
- versioning,
- idempotency,
- ack correlation,
- error response,
- audit trail,
- backward compatibility.

---

## 11. `ServerEndpointConfig.Configurator`

Configurator adalah extension point penting untuk handshake dan endpoint creation behavior.

Use cases:

- inspect/validate handshake request,
- copy HTTP session/user metadata into endpoint config,
- enforce origin check,
- choose subprotocol,
- customize endpoint instance creation,
- integrate with DI/framework,
- reject or alter handshake behavior depending container support.

Contoh skeleton:

```java
import jakarta.websocket.HandshakeResponse;
import jakarta.websocket.server.HandshakeRequest;
import jakarta.websocket.server.ServerEndpointConfig;

public class AuthenticatedConfigurator extends ServerEndpointConfig.Configurator {

    @Override
    public void modifyHandshake(ServerEndpointConfig config,
                                HandshakeRequest request,
                                HandshakeResponse response) {
        Object httpSession = request.getHttpSession();
        config.getUserProperties().put("httpSession", httpSession);

        String origin = firstHeader(request, "Origin");
        config.getUserProperties().put("origin", origin);
    }

    private String firstHeader(HandshakeRequest request, String name) {
        var values = request.getHeaders().get(name);
        return values == null || values.isEmpty() ? null : values.get(0);
    }
}
```

Endpoint:

```java
@ServerEndpoint(
        value = "/ws/secure",
        configurator = AuthenticatedConfigurator.class
)
public class SecureEndpoint {

    @OnOpen
    public void onOpen(Session session, EndpointConfig config) {
        Object httpSession = config.getUserProperties().get("httpSession");
        String origin = (String) config.getUserProperties().get("origin");
    }
}
```

### 11.1 Origin Validation

Browser sends `Origin` in WebSocket handshake. Server should validate it for browser-facing WebSocket endpoints.

Example:

```java
public class StrictOriginConfigurator extends ServerEndpointConfig.Configurator {

    private static final Set<String> ALLOWED_ORIGINS = Set.of(
            "https://app.example.com"
    );

    @Override
    public boolean checkOrigin(String originHeaderValue) {
        return originHeaderValue != null && ALLOWED_ORIGINS.contains(originHeaderValue);
    }
}
```

Without origin validation, cookie-authenticated WebSocket endpoints can be exposed to cross-site WebSocket hijacking scenarios.

### 11.2 Subprotocol Negotiation

Client may request:

```text
Sec-WebSocket-Protocol: chat.v2, chat.v1
```

Endpoint:

```java
@ServerEndpoint(
        value = "/ws/chat",
        subprotocols = {"chat.v2", "chat.v1"}
)
public class ChatEndpoint {
}
```

Configurator can customize selection:

```java
@Override
public String getNegotiatedSubprotocol(List<String> supported,
                                       List<String> requested) {
    for (String protocol : requested) {
        if (supported.contains(protocol)) {
            return protocol;
        }
    }
    return "";
}
```

Use subprotocol for protocol semantics, not as a random token transport unless you have a deliberate threat model.

---

## 12. `ServerApplicationConfig` dan Endpoint Discovery

`ServerApplicationConfig` memungkinkan aplikasi mengontrol endpoint mana yang dideploy.

```java
import jakarta.websocket.Endpoint;
import jakarta.websocket.server.ServerApplicationConfig;
import jakarta.websocket.server.ServerEndpointConfig;

public class WebSocketApplicationConfig implements ServerApplicationConfig {

    @Override
    public Set<ServerEndpointConfig> getEndpointConfigs(
            Set<Class<? extends Endpoint>> endpointClasses) {
        return Set.of(
                ServerEndpointConfig.Builder
                        .create(EchoProgrammaticEndpoint.class, "/ws/programmatic")
                        .build()
        );
    }

    @Override
    public Set<Class<?>> getAnnotatedEndpointClasses(Set<Class<?>> scanned) {
        return scanned.stream()
                .filter(clazz -> clazz.getPackageName().startsWith("com.example.websocket"))
                .collect(Collectors.toSet());
    }
}
```

Use cases:

- filter endpoint hasil scanning,
- register programmatic endpoint,
- avoid accidental endpoint exposure,
- different deployment profile,
- framework integration.

Dalam aplikasi modern, framework sering menangani discovery/registration. Tapi memahami ini penting saat:

- endpoint tidak terdeploy,
- path bentrok,
- annotation scanning lambat,
- native image/reflection issue,
- container behavior berbeda.

---

## 13. Dependency Injection Caveat

Pada Jakarta EE full/web profile container, WebSocket endpoint dapat terintegrasi dengan CDI/Jakarta platform features sesuai support container.

Namun dalam praktik, injection sering menjadi sumber bug saat:

- running di plain servlet container,
- menggunakan embedded Tomcat tanpa CDI integration,
- memakai Spring Boot dengan `@ServerEndpoint`,
- endpoint instance dibuat oleh WebSocket container, bukan Spring container,
- configurator custom override instance creation,
- lifecycle endpoint berbeda dari bean lifecycle framework.

Contoh problem:

```java
@ServerEndpoint("/ws/notify")
public class NotifyEndpoint {

    @Inject
    NotificationService notificationService; // bisa null tergantung runtime/config
}
```

Spring Boot problem yang umum:

```java
@ServerEndpoint("/ws/notify")
public class NotifyEndpoint {

    @Autowired
    NotificationService notificationService; // sering null jika endpoint bukan Spring bean
}
```

Solusi tergantung stack:

1. gunakan framework WebSocket abstraction yang dikelola Spring,
2. gunakan `ServerEndpointExporter` dan konfigurasi Spring yang benar,
3. gunakan custom configurator yang mengambil bean dari application context,
4. hindari heavy DI di endpoint; delegasikan ke static-safe registry/service locator dengan hati-hati,
5. gunakan programmatic registration dari bean-managed component.

Prinsip desain:

```text
Endpoint adalah protocol adapter.
Business service tetap berada di layer aplikasi.
Jangan biarkan endpoint menjadi service locator liar atau God object.
```

---

## 14. Desain Endpoint Sebagai Protocol Adapter

Endpoint yang baik biasanya tipis:

```text
WebSocket Endpoint
  - validate connection metadata
  - parse/decode message
  - attach correlation/user/session context
  - call application service
  - map result/event/error to outbound message
  - manage connection lifecycle
```

Bukan:

```text
WebSocket Endpoint
  - query database langsung di banyak tempat
  - manage transaction manual secara tersebar
  - contains business state machine penuh
  - holds global user map tanpa cleanup
  - sends raw entity object ke client
  - catches all exception silently
```

Recommended layering:

```text
@ServerEndpoint
  ↓
ConnectionContextFactory
  ↓
MessageDecoder / EnvelopeParser
  ↓
CommandRouter
  ↓
Application Service
  ↓
Event Publisher / Outbound Gateway
  ↓
Session Send Adapter
```

Contoh message handling lebih terstruktur:

```java
@OnMessage
public void onMessage(ClientEnvelope envelope, Session session) {
    ConnectionContext context = ConnectionContext.from(session);

    try {
        ServerEnvelope response = router.handle(context, envelope);
        send(session, response);
    } catch (DomainException e) {
        send(session, ServerEnvelope.error(envelope.correlationId(), e.code(), e.getMessage()));
    } catch (Exception e) {
        log.error("Unhandled websocket message error", e);
        send(session, ServerEnvelope.error(envelope.correlationId(), "INTERNAL_ERROR", "Unexpected error"));
    }
}
```

---

## 15. Message Routing Model

Untuk aplikasi real, satu endpoint sering menerima banyak jenis message:

```json
{ "type": "SUBSCRIBE", "payload": { "topic": "case:123" } }
{ "type": "UNSUBSCRIBE", "payload": { "topic": "case:123" } }
{ "type": "PING", "payload": {} }
{ "type": "COMMAND", "payload": { "action": "approve" } }
```

Hindari `if-else` raksasa di `@OnMessage`.

Pattern:

```java
public interface ClientMessageHandler<T> {
    String type();
    void handle(ConnectionContext context, T payload);
}
```

Router:

```java
public final class MessageRouter {
    private final Map<String, ClientMessageHandler<?>> handlers;

    public void route(ConnectionContext context, ClientEnvelope envelope) {
        ClientMessageHandler<?> handler = handlers.get(envelope.type());
        if (handler == null) {
            throw new UnsupportedMessageTypeException(envelope.type());
        }
        // deserialize payload to handler type, validate, invoke
    }
}
```

Benefits:

- easier testing,
- isolated authorization per message,
- versioning,
- clear audit,
- easier rate limiting,
- easier feature ownership.

---

## 16. Authorization: Handshake vs Message-Level

WebSocket authorization has two layers:

### 16.1 Connection-Level Authorization

At handshake/open:

- is user authenticated?
- is origin allowed?
- is tenant valid?
- is account active?
- is endpoint allowed for this role?
- connection limit exceeded?

### 16.2 Message-Level Authorization

After connection:

- can user subscribe to this case/topic?
- can user send this command?
- can user see this field?
- did user's permission change after connection opened?
- is tenant boundary still valid?

Critical point:

```text
A WebSocket connection can live longer than the authorization state that allowed it.
```

Therefore:

- re-check authorization for sensitive message,
- close connection when token/session becomes invalid if possible,
- handle permission changes,
- do not assume `@OnOpen` authorization is enough forever.

---

## 17. Error Handling in Endpoint Model

Error categories:

| Category | Example | Response |
|---|---|---|
| Decode error | invalid JSON | send error envelope or close with invalid data |
| Validation error | missing field | send client error envelope |
| Authorization error | forbidden topic | send forbidden or close policy violation |
| Rate limit | too many messages | send rate limit or close |
| Business conflict | invalid state transition | send domain error |
| Internal error | NPE/downstream | send generic error, log detail |
| Protocol error | invalid frame | container may close |
| Network error | broken pipe | cleanup, no response guaranteed |

Example error envelope:

```json
{
  "type": "ERROR",
  "correlationId": "c-123",
  "error": {
    "code": "FORBIDDEN_TOPIC",
    "message": "You are not allowed to subscribe to this topic"
  }
}
```

Avoid:

- exposing stack trace to client,
- swallowing `@OnError`,
- closing every connection for recoverable message error,
- keeping connection open after protocol/security violation,
- assuming error message was delivered before close.

---

## 18. Close Semantics

Use explicit close reason when server intentionally closes:

```java
session.close(new CloseReason(
        CloseReason.CloseCodes.NORMAL_CLOSURE,
        "Server shutdown"
));
```

For policy violation:

```java
session.close(new CloseReason(
        CloseReason.CloseCodes.VIOLATED_POLICY,
        "Connection limit exceeded"
));
```

Common close code categories:

| Code | Meaning |
|---|---|
| 1000 | normal closure |
| 1001 | going away |
| 1002 | protocol error |
| 1003 | unsupported data |
| 1006 | abnormal closure, not sent on wire |
| 1008 | policy violation |
| 1009 | message too big |
| 1011 | unexpected server error |

Application should log close code distribution. It is one of the best signals for WebSocket health.

---

## 19. Buffer Size and Payload Limit

Set size limits deliberately:

```java
@OnOpen
public void onOpen(Session session) {
    session.setMaxTextMessageBufferSize(64 * 1024);
    session.setMaxBinaryMessageBufferSize(256 * 1024);
    session.setMaxIdleTimeout(60_000);
}
```

Why:

- prevent memory abuse,
- avoid accidental huge messages,
- fail fast,
- protect server under reconnect storm,
- make client contract explicit.

Do not rely only on decoder validation. Buffering can happen before decoder sees payload.

---

## 20. Threading and Concurrency Model

The spec abstracts details. Container decides callback threading. Your application must be thread-safe.

Important facts:

1. Multiple clients mean multiple endpoint instances/sessions.
2. Shared registries must be concurrent.
3. Async sends complete later, possibly on different threads.
4. Background events may send to sessions concurrently.
5. Close can race with send.
6. Error can race with cleanup.
7. User reconnect can overlap old connection.

Bad:

```java
private static final List<Session> sessions = new ArrayList<>();
```

Better:

```java
private static final Set<Session> sessions = ConcurrentHashMap.newKeySet();
```

Still not enough for serious production because send serialization/backpressure still matters.

### 20.1 Per-Session State Machine

Think of each connection as state machine:

```text
CONNECTING
  -> OPEN
  -> CLOSING
  -> CLOSED
  -> CLEANED
```

Transitions can be triggered by:

- client close,
- server close,
- network failure,
- idle timeout,
- policy violation,
- decode error,
- deployment shutdown,
- backend overload.

Design cleanup to be idempotent:

```java
public void cleanup(Session session) {
    if (cleanedSessions.add(session.getId())) {
        registry.remove(resolveUser(session), session);
        metrics.decrementActiveConnections();
    }
}
```

---

## 21. Backpressure and Slow Client

Jakarta WebSocket API gives send methods, but your application must decide what to do when client is slow.

Options:

| Strategy | Behavior | Use Case |
|---|---|---|
| Block | wait until sent | simple low-volume, risky under load |
| Async unbounded | enqueue indefinitely | dangerous |
| Bounded queue | drop/close when full | production default candidate |
| Coalesce | keep latest state only | dashboards/presence |
| Drop non-critical | discard typing/heartbeat events | high-frequency low-value events |
| Close slow client | protect server | overload protection |

Example mental model:

```text
Business events arrive faster than client can receive
  ↓
server outbound queue grows
  ↓
memory pressure grows
  ↓
GC/latency degrades
  ↓
all clients affected
```

A top-tier engineer does not treat WebSocket broadcast as a simple loop over sessions.

---

## 22. Cluster Reality

A WebSocket `Session` is node-local.

```text
Node A has session S1
Node B cannot call S1.getAsyncRemote()
```

Therefore in Kubernetes/load-balanced environment:

- connection registry is local to node,
- push event must reach the node that owns connection,
- sticky session may keep connection stable but does not solve fan-out,
- broker/pub-sub is needed for cross-node delivery.

Common architecture:

```text
Application Service publishes event
  ↓
Redis Pub/Sub / RabbitMQ / Kafka / internal event bus
  ↓
Each WebSocket node receives event
  ↓
Node checks local sessions
  ↓
Send only to sessions present on that node
```

Do not put `Session` object in Redis. Store only logical connection metadata if needed.

---

## 23. Reverse Proxy and Context Path Interaction

Endpoint path is affected by deployment context and proxy rewrite.

Example app:

```java
@ServerEndpoint("/ws/notifications")
```

WAR context:

```text
/aceas
```

Actual URL:

```text
wss://agency.example.com/aceas/ws/notifications
```

If proxy rewrites `/aceas` away before forwarding, backend may see:

```text
/ws/notifications
```

If proxy does not rewrite, backend may see:

```text
/aceas/ws/notifications
```

Mismatch causes:

- 404 during handshake,
- 400 invalid upgrade,
- 502/503 from proxy,
- connection opens locally but fails through ingress,
- wrong scheme `ws` vs `wss`,
- mixed content in browser.

---

## 24. Observability Checklist

For each endpoint, track:

- open count,
- close count by close code,
- active connections,
- active connections per user/tenant/node,
- messages received by type,
- messages sent by type,
- decode failure count,
- validation failure count,
- authorization failure count,
- send failure count,
- average outbound queue size,
- dropped/coalesced message count,
- slow client close count,
- ping/pong latency,
- reconnect rate,
- abnormal closure rate,
- handshake rejection count,
- origin rejection count.

Log fields:

```text
connectionId
userId
tenantId
endpoint
remoteAddress/proxy client address
origin
subprotocol
closeCode
closeReasonCategory
correlationId/messageId
node/pod name
```

Do not log sensitive payloads by default.

---

## 25. Production-Grade Endpoint Skeleton

This is still simplified, but shows better structure than tutorial-level code.

```java
@ServerEndpoint(
        value = "/ws/cases/{caseId}/events",
        decoders = ClientEnvelopeDecoder.class,
        encoders = ServerEnvelopeEncoder.class,
        configurator = CaseWebSocketConfigurator.class,
        subprotocols = {"case-events.v1"}
)
public class CaseEventsEndpoint {

    private static final ConnectionRegistry registry = ConnectionRegistryHolder.registry();
    private static final MessageRouter router = MessageRouterHolder.router();

    @OnOpen
    public void onOpen(Session session,
                       EndpointConfig config,
                       @PathParam("caseId") String caseId) throws IOException {
        ConnectionContext context = ConnectionContextFactory.from(session, config, caseId);

        if (!context.isAuthenticated()) {
            session.close(new CloseReason(
                    CloseReason.CloseCodes.VIOLATED_POLICY,
                    "Authentication required"
            ));
            return;
        }

        if (!context.canConnectToCase(caseId)) {
            session.close(new CloseReason(
                    CloseReason.CloseCodes.VIOLATED_POLICY,
                    "Forbidden"
            ));
            return;
        }

        session.setMaxIdleTimeout(60_000);
        session.setMaxTextMessageBufferSize(64 * 1024);
        session.getUserProperties().put("context", context);

        registry.add(context.userId(), session);
        send(session, ServerEnvelope.connected(caseId));
    }

    @OnMessage
    public void onMessage(ClientEnvelope message, Session session) {
        ConnectionContext context = (ConnectionContext) session.getUserProperties().get("context");

        try {
            ServerEnvelope response = router.route(context, message);
            if (response != null) {
                send(session, response);
            }
        } catch (ForbiddenMessageException e) {
            send(session, ServerEnvelope.error(message.correlationId(), "FORBIDDEN", "Forbidden"));
        } catch (BadClientMessageException e) {
            send(session, ServerEnvelope.error(message.correlationId(), "BAD_MESSAGE", e.getMessage()));
        } catch (Exception e) {
            log.error("Unhandled websocket message error", e);
            send(session, ServerEnvelope.error(message.correlationId(), "INTERNAL_ERROR", "Unexpected error"));
        }
    }

    @OnClose
    public void onClose(Session session, CloseReason reason) {
        cleanup(session, reason, null);
    }

    @OnError
    public void onError(Session session, Throwable error) {
        cleanup(session, null, error);
    }

    private void send(Session session, ServerEnvelope envelope) {
        if (session == null || !session.isOpen()) {
            return;
        }

        session.getAsyncRemote().sendObject(envelope, result -> {
            if (!result.isOK()) {
                log.warn("WebSocket send failed sessionId={}",
                        session.getId(),
                        result.getException());
                safeClose(session, CloseReason.CloseCodes.UNEXPECTED_CONDITION, "Send failed");
            }
        });
    }

    private void cleanup(Session session, CloseReason reason, Throwable error) {
        if (session == null) {
            return;
        }

        ConnectionContext context = (ConnectionContext) session.getUserProperties().get("context");
        if (context != null) {
            registry.remove(context.userId(), session);
        }

        if (error != null) {
            log.warn("WebSocket error sessionId={}", session.getId(), error);
        } else {
            log.info("WebSocket closed sessionId={} reason={}", session.getId(), reason);
        }
    }

    private void safeClose(Session session,
                           CloseReason.CloseCode code,
                           String reason) {
        try {
            if (session.isOpen()) {
                session.close(new CloseReason(code, reason));
            }
        } catch (Exception ignored) {
            // cleanup path must be best-effort
        }
    }
}
```

Catatan: untuk production yang lebih serius, `send()` sebaiknya tidak langsung memanggil `AsyncRemote` dari banyak thread tanpa serialization/backpressure.

---

## 26. Common Deployment Problems

### 26.1 Endpoint Tidak Terdaftar

Gejala:

```text
404 on WebSocket handshake
```

Penyebab:

- class tidak discan,
- dependency WebSocket implementation tidak ada,
- salah package `javax` vs `jakarta`,
- endpoint berada di module/JAR yang tidak discan,
- `ServerApplicationConfig` memfilter endpoint,
- context path salah,
- embedded container belum mengaktifkan server endpoint exporter.

### 26.2 Injection Null

Penyebab:

- endpoint dibuat WebSocket container, bukan DI container,
- konfigurasi integration kurang,
- static field workaround salah,
- custom configurator tidak mengambil bean dengan benar.

### 26.3 Works Local, Fails Behind Proxy

Penyebab:

- proxy tidak forward `Upgrade`/`Connection`,
- idle timeout terlalu pendek,
- path rewrite salah,
- TLS termination membuat browser harus pakai `wss`,
- origin mismatch,
- sticky session kurang untuk stateful assumption.

### 26.4 Memory Leak Setelah Reconnect

Penyebab:

- session registry tidak remove,
- `@OnError` tidak cleanup,
- cleanup tidak idempotent,
- outbound queue tidak dibersihkan,
- scheduled heartbeat task per session tidak dibatalkan.

---

## 27. Java 8 sampai Java 25: Apa yang Relevan?

API WebSocket sendiri tidak berubah mengikuti setiap versi Java SE, tetapi runtime design berubah.

### Java 8

- baseline legacy Java EE banyak masih di sini,
- `javax.websocket.*`,
- lambda membantu handler/callback,
- `CompletableFuture` tersedia,
- platform thread dominan.

### Java 11/17

- common baseline modern enterprise,
- module system bisa mempengaruhi reflective scanning jika modularized,
- container modern mulai lebih agresif mendukung Jakarta namespace.

### Java 21

- virtual threads tersedia sebagai fitur final,
- membantu blocking service layer, tetapi WebSocket callback/send/backpressure tetap perlu desain eksplisit,
- jangan mengira virtual thread menyelesaikan slow client queue.

### Java 25

- platform makin matang untuk concurrency modern,
- structured concurrency/scoped values relevan secara konseptual untuk request/task context propagation,
- tetapi WebSocket long-lived connection tidak selalu cocok dengan request-scoped structured task yang pendek.

Prinsip:

```text
Java version can improve execution model.
It does not remove protocol, lifecycle, state, and backpressure problems.
```

---

## 28. Checklist Desain Endpoint Sebelum Production

Sebelum production, jawab ini:

1. Apa endpoint path final setelah context path dan proxy rewrite?
2. Apakah endpoint memakai `javax` atau `jakarta` sesuai container?
3. Siapa yang membuat endpoint instance?
4. Apakah DI benar-benar bekerja di runtime target?
5. Bagaimana user diautentikasi saat handshake?
6. Apakah `Origin` divalidasi?
7. Apakah message-level authorization dilakukan?
8. Apa envelope message dan versioning strategy?
9. Berapa max payload size?
10. Apa behavior untuk invalid JSON?
11. Apa behavior untuk unsupported message type?
12. Apakah send per session diserialisasi?
13. Bagaimana slow client ditangani?
14. Bagaimana registry dibersihkan?
15. Apakah cleanup idempotent?
16. Bagaimana heartbeat/ping/pong bekerja?
17. Apa close code untuk policy violation?
18. Bagaimana reconnect client bekerja?
19. Apakah multi-tab/device didukung?
20. Bagaimana cluster fan-out bekerja?
21. Apa metric active connection per node?
22. Apakah payload sensitif tidak masuk log?
23. Apa graceful shutdown behavior?
24. Apa test untuk proxy/LB timeout?
25. Apa test untuk reconnect storm?

---

## 29. Mental Model Akhir

Jakarta WebSocket server endpoint bukan sekadar annotation.

Ia adalah gabungan dari:

```text
HTTP upgrade boundary
  + endpoint deployment metadata
  + per-connection lifecycle
  + message dispatch
  + serialization/deserialization
  + authentication/authorization continuation
  + concurrency model
  + outbound backpressure
  + node-local state
  + cluster fan-out
  + failure cleanup
  + observability
```

Kalau Servlet request adalah lifecycle pendek:

```text
request received -> application handles -> response committed -> done
```

maka WebSocket connection adalah lifecycle panjang:

```text
handshake -> open -> many messages -> many sends -> network uncertainty
-> maybe idle -> maybe reconnect -> close/error -> cleanup
```

Top-tier engineer mendesain endpoint sebagai **connection state machine + protocol adapter**, bukan sebagai tempat menaruh semua business logic.

---

## 30. Ringkasan

Di Part 022 ini kita membahas:

- annotated endpoint dengan `@ServerEndpoint`,
- programmatic endpoint dengan `Endpoint` dan `ServerEndpointConfig`,
- endpoint path dan path parameter,
- endpoint lifecycle,
- WebSocket `Session` vs HTTP `HttpSession`,
- `@OnOpen`, `@OnMessage`, `@OnClose`, `@OnError`,
- whole/partial/pong message,
- `BasicRemote` vs `AsyncRemote`,
- encoder/decoder,
- configurator,
- subprotocol negotiation,
- endpoint discovery,
- DI caveat,
- endpoint sebagai protocol adapter,
- message routing,
- authorization boundary,
- error/close semantics,
- payload limit,
- threading/concurrency,
- slow client/backpressure,
- cluster reality,
- reverse proxy interaction,
- observability,
- deployment problems,
- Java 8 sampai Java 25 relevance.

Part berikutnya akan masuk ke **Part 023 — WebSocket Session, Concurrency, and State Management**, yaitu pendalaman khusus tentang registry connection, per-user mapping, multi-tab, clustered state, ordering, concurrent send, slow consumer, ghost presence, dan failure model stateful WebSocket.

---

## Referensi

- Jakarta WebSocket 2.2 Specification: https://jakarta.ee/specifications/websocket/2.2/jakarta-websocket-spec-2.2
- Jakarta WebSocket overview: https://jakarta.ee/specifications/websocket/
- Jakarta EE Tutorial — WebSocket: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/websocket/websocket.html
- Jakarta WebSocket API docs via Apache Tomcat 11 WebSocket 2.2 API: https://tomcat.apache.org/tomcat-11.0-doc/websocketapi/
- `ServerEndpointConfig.Configurator` API: https://jakarta.ee/specifications/websocket/2.0/apidocs/jakarta/websocket/server/serverendpointconfig.configurator
- RFC 6455 — The WebSocket Protocol: https://datatracker.ietf.org/doc/html/rfc6455
- Jetty 12.1 WebSocket Server documentation: https://jetty.org/docs/jetty/12.1/programming-guide/server/websocket.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 021 — WebSocket Protocol Fundamentals](./learn-java-servlet-websocket-web-container-runtime-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 023 — WebSocket Session, Concurrency, and State Management](./learn-java-servlet-websocket-web-container-runtime-part-023.md)
