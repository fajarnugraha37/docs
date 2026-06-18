# Part 16 — Server-Sent Events and Streaming APIs with Jersey

> Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
> Module: Async & Streaming  
> Java target: Java 8 sampai Java 25  
> Jersey target: Jersey 2.x (`javax.ws.rs`), Jersey 3.x/4.x (`jakarta.ws.rs`)  
> Fokus: SSE, streaming HTTP, lifecycle koneksi panjang, resource cleanup, proxy behavior, dan production failure modelling.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita membahas **async server processing**: `AsyncResponse`, request suspension, timeout, cancellation, executor ownership, dan context propagation.

Part ini melanjutkan dari sana, tetapi problem-nya berbeda.

Async request biasanya menjawab pertanyaan:

> Bagaimana server bisa melepas container thread sementara pekerjaan masih berjalan?

Streaming dan SSE menjawab pertanyaan:

> Bagaimana server bisa mempertahankan koneksi terbuka dan mengirim data bertahap ke client?

Keduanya terlihat mirip karena sama-sama tidak langsung mengembalikan response final. Tetapi secara arsitektur berbeda:

```text
AsyncResponse:
  satu request
  satu response final
  cocok untuk job yang lama tapi hasilnya satu

StreamingOutput:
  satu request
  satu response body yang ditulis bertahap
  cocok untuk file/export/large data stream

SSE:
  satu request
  banyak event satu arah dari server ke client
  cocok untuk notification/progress/feed ringan
```

Part ini fokus ke **Server-Sent Events (SSE)** dan streaming API dengan Jersey, termasuk batas real-world di belakang load balancer, API gateway, reverse proxy, browser, Kubernetes, thread pool, dan network timeout.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan bisa:

1. Menjelaskan bedanya **SSE**, `StreamingOutput`, polling, long polling, dan WebSocket.
2. Mendesain endpoint SSE dengan Jersey menggunakan `Sse`, `SseEventSink`, dan `SseBroadcaster`.
3. Memahami lifecycle koneksi SSE dari connect, send event, heartbeat, disconnect, sampai cleanup.
4. Menghindari resource leak akibat `SseEventSink` yang tidak ditutup atau tidak dihapus dari registry.
5. Memahami proxy buffering, idle timeout, browser reconnect, `Last-Event-ID`, dan heartbeat.
6. Mendesain stream endpoint yang aman dari OOM, thread starvation, blocking write, dan unbounded client state.
7. Mengintegrasikan SSE dengan security context, audit, correlation ID, metrics, dan graceful shutdown.
8. Memilih dengan rasional antara SSE, WebSocket, polling, message queue, async job API, dan normal REST.

---

## 2. Referensi Resmi dan Fakta Versi

Beberapa baseline penting:

- Jersey menyediakan dukungan SSE untuk server dan client. Dokumentasi Jersey menjelaskan SSE sebagai extension yang memakai media type `text/event-stream` dan chunked message support. Implementasi internal Jersey tidak seharusnya digunakan langsung; aplikasi sebaiknya memakai API standar seperti `Sse`, `SseEventSink`, dan `SseBroadcaster`.
- API SSE distandardisasi sejak JAX-RS 2.1 dan setelah migrasi namespace tersedia di package `jakarta.ws.rs.sse`.
- Jakarta REST API menyediakan package `jakarta.ws.rs.sse` untuk dukungan server-side event stream dan client-side event source.
- `SseBroadcaster.broadcast(...)` mem-publish event ke semua `SseEventSink` yang terdaftar.
- `SseEventSource` adalah client API untuk membaca SSE stream dan mendukung reconnect behavior dengan `Last-Event-ID` jika server menyediakan event `id`.

Referensi:

- Jersey User Guide — Server-Sent Events Support: <https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/sse.html>
- Jakarta RESTful Web Services API — `jakarta.ws.rs.sse`: <https://jakarta.ee/specifications/restful-ws/3.1/apidocs/jakarta.ws.rs/jakarta/ws/rs/sse/package-summary>
- Jakarta REST/JAX-RS SSE API history: SSE API mulai menjadi standar sejak JAX-RS 2.1.

Catatan versi:

```text
Jersey 2.x:
  namespace utama: javax.ws.rs
  SSE API: javax.ws.rs.sse pada JAX-RS 2.1 era
  cocok untuk legacy Java EE / Java 8-heavy applications

Jersey 3.x:
  namespace utama: jakarta.ws.rs
  target Jakarta EE 9/10 era
  cocok untuk migrasi javax -> jakarta

Jersey 4.x:
  namespace utama: jakarta.ws.rs
  target Jakarta EE 11 era
  lebih relevan untuk Java modern baseline
```

---

## 3. Mental Model: Streaming HTTP Bukan Message Queue

Salah satu kesalahan paling umum adalah memperlakukan SSE seperti message broker.

SSE bukan RabbitMQ, Kafka, JMS, atau durable queue.

SSE adalah:

```text
HTTP response yang dibiarkan terbuka,
di mana server menulis event-event kecil secara bertahap,
dengan format text/event-stream,
ke client yang sudah membuka koneksi.
```

Artinya:

- Jika client disconnect, koneksi hilang.
- Jika server restart, koneksi hilang.
- Jika event tidak disimpan di tempat durable, event bisa hilang.
- Jika client lambat, server bisa menumpuk buffer atau gagal menulis.
- Jika proxy punya idle timeout, koneksi bisa diputus walaupun aplikasi merasa masih aktif.

Mental model yang benar:

```text
SSE = delivery channel ringan untuk event observasi / progress / notification.
Durability = tanggung jawab storage/message broker/event log lain.
Ordering = hanya relatif terhadap satu stream connection, bukan global distributed guarantee.
Replay = hanya mungkin jika aplikasi menyimpan event dan mendukung Last-Event-ID.
Back-pressure = terbatas, harus didesain sendiri di level aplikasi.
```

Jadi SSE cocok untuk:

- progress export/report,
- notification dashboard,
- case status updates,
- audit monitor internal,
- task progress,
- read-only live feed,
- low-frequency operational events,
- UI update yang tidak harus bidirectional.

SSE kurang cocok untuk:

- chat bidirectional berat,
- collaborative editing,
- high-frequency telemetry,
- guaranteed delivery,
- large binary stream,
- multi-topic durable event bus,
- command channel dari client ke server.

---

## 4. HTTP View: Apa yang Sebenarnya Terjadi?

SSE memakai request HTTP biasa:

```http
GET /api/cases/123/events HTTP/1.1
Accept: text/event-stream
Authorization: Bearer ...
```

Server merespons:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Transfer-Encoding: chunked
```

Body response berisi event-event berbasis teks:

```text
event: status-changed
id: 101
data: {"caseId":"123","status":"REVIEWING"}

:event heartbeat

id: 102
event: assigned
data: {"caseId":"123","officer":"A123"}

```

Format penting:

```text
event: <nama event opsional>
id: <event id opsional>
retry: <reconnect delay hint opsional>
data: <payload baris 1>
data: <payload baris 2>

<blank line mengakhiri satu event>
```

Jika `event:` tidak diberikan, browser `EventSource` akan mengirimkannya ke handler default `onmessage`.

Jika `event:` diberikan, browser perlu listener spesifik:

```javascript
const source = new EventSource('/api/cases/123/events');

source.onmessage = event => {
  console.log('default event', event.data);
};

source.addEventListener('status-changed', event => {
  console.log('status changed', JSON.parse(event.data));
});
```

Ini penting karena banyak bug SSE terlihat seperti “event tidak diterima”, padahal server mengirim named event dan client hanya memasang `onmessage`.

---

## 5. SSE vs Polling vs Long Polling vs WebSocket vs StreamingOutput

### 5.1 Normal Polling

```text
Client setiap N detik request:
  GET /notifications?since=123

Server langsung balas:
  200 OK [events]
```

Kelebihan:

- sederhana,
- mudah di-cache sebagian,
- tidak butuh long-lived connection,
- lebih mudah melewati proxy/firewall.

Kekurangan:

- latency minimal sebesar interval polling,
- request overhead tinggi,
- banyak response kosong,
- kurang efisien untuk update real-time.

Cocok untuk:

- update jarang,
- UI internal sederhana,
- sistem dengan banyak proxy tidak ramah long connection,
- data tidak perlu near-real-time.

### 5.2 Long Polling

```text
Client request:
  GET /notifications/wait?since=123

Server menahan request sampai:
  - event tersedia, atau
  - timeout.

Client langsung request lagi setelah response.
```

Kelebihan:

- lebih real-time daripada polling biasa,
- tetap request/response biasa,
- bisa fallback jika SSE tidak feasible.

Kekurangan:

- lifecycle lebih kompleks,
- banyak request menggantung,
- edge case timeout/reconnect,
- server tetap harus mengelola banyak suspended requests.

Cocok untuk:

- environment yang tidak nyaman dengan SSE,
- perlu pseudo-push tapi tetap HTTP request biasa.

### 5.3 Server-Sent Events

```text
Client request sekali:
  GET /events

Server keep connection open:
  data: event1
  data: event2
  data: event3
```

Kelebihan:

- native browser support melalui `EventSource`,
- otomatis reconnect di browser,
- text-based dan mudah di-debug,
- cocok untuk one-way server-to-client updates,
- berjalan di atas HTTP biasa.

Kekurangan:

- satu arah dari server ke client,
- tidak cocok untuk binary,
- proxy buffering/timeout bisa mengganggu,
- browser connection limit perlu dipikirkan,
- back-pressure terbatas.

Cocok untuk:

- notification,
- progress,
- dashboard feed,
- low-to-medium frequency events.

### 5.4 WebSocket

```text
HTTP upgrade -> persistent bidirectional socket
Client <-> Server
```

Kelebihan:

- bidirectional,
- cocok untuk interactive realtime,
- lebih fleksibel untuk protocol custom.

Kekurangan:

- lebih kompleks secara operational,
- load balancer/proxy config lebih sensitif,
- security/audit/protocol design lebih sulit,
- perlu heartbeat dan lifecycle management eksplisit.

Cocok untuk:

- chat,
- collaborative editing,
- live multiplayer,
- bidirectional control channel,
- high interactivity.

### 5.5 `StreamingOutput`

`StreamingOutput` bukan event feed. Ini response body yang ditulis bertahap.

Cocok untuk:

- file download,
- CSV export,
- large report,
- generated archive,
- streaming query result.

Tidak cocok untuk:

- long-lived notification feed,
- event subscription dengan reconnect semantics,
- multiple logical event types.

### 5.6 Decision Matrix

| Kebutuhan | Pilihan Umum |
|---|---|
| Update jarang, sederhana | Polling |
| Near-real-time tapi environment sulit untuk long stream | Long polling |
| Server push satu arah, browser-friendly | SSE |
| Bidirectional realtime | WebSocket |
| Download/export besar | StreamingOutput |
| Guaranteed durable event delivery | Message queue/event log + API |
| UI progress untuk job async | SSE atau polling status endpoint |

Rule of thumb:

```text
Kalau client hanya perlu menerima update dari server: pertimbangkan SSE.
Kalau client juga perlu mengirim command realtime melalui koneksi yang sama: pertimbangkan WebSocket.
Kalau event harus durable dan replayable: gunakan message broker/event store; SSE hanya delivery edge.
```

---

## 6. API Utama SSE di Jakarta REST / Jersey

Package modern:

```java
jakarta.ws.rs.sse.Sse
jakarta.ws.rs.sse.SseEventSink
jakarta.ws.rs.sse.SseBroadcaster
jakarta.ws.rs.sse.OutboundSseEvent
jakarta.ws.rs.sse.InboundSseEvent
jakarta.ws.rs.sse.SseEventSource
```

Legacy Jersey/JAX-RS 2.x:

```java
javax.ws.rs.sse.Sse
javax.ws.rs.sse.SseEventSink
javax.ws.rs.sse.SseBroadcaster
javax.ws.rs.sse.OutboundSseEvent
javax.ws.rs.sse.SseEventSource
```

Konsepnya sama, namespace berbeda.

### 6.1 `Sse`

`Sse` adalah factory/entry point untuk membuat event dan broadcaster.

Biasanya diinjeksi:

```java
@Context
private Sse sse;
```

atau sebagai parameter resource method:

```java
public void stream(@Context Sse sse, @Context SseEventSink sink) { ... }
```

Gunanya:

```java
OutboundSseEvent event = sse.newEventBuilder()
    .id("101")
    .name("case-status-changed")
    .mediaType(MediaType.APPLICATION_JSON_TYPE)
    .data(CaseStatusEvent.class, payload)
    .build();
```

### 6.2 `SseEventSink`

`SseEventSink` merepresentasikan satu koneksi client.

Operasi utama:

```java
sink.send(event);
sink.close();
sink.isClosed();
```

Mental model:

```text
1 browser tab membuka EventSource
= 1 HTTP connection
= 1 SseEventSink di server
```

Kalau 1 user membuka 3 tab, bisa ada 3 sink.

### 6.3 `SseBroadcaster`

`SseBroadcaster` membantu broadcast event ke banyak sink.

```java
SseBroadcaster broadcaster = sse.newBroadcaster();
broadcaster.register(sink);
broadcaster.broadcast(event);
```

Tetapi broadcaster bukan magic durable bus. Ia hanya menyimpan sink yang sedang aktif dan mengirim ke semuanya.

### 6.4 `OutboundSseEvent`

Event yang dikirim server ke client.

Field penting:

```text
id       : event identifier untuk replay/reconnect coordination
name     : named event, dipakai client addEventListener
comment  : comment line, sering untuk heartbeat
retry    : reconnect delay hint
mediaType: media type payload data
 data    : actual event payload
```

### 6.5 `SseEventSource`

Client-side Jakarta REST API untuk consume SSE.

Berguna untuk Java client/service internal:

```java
WebTarget target = client.target("https://example.com/events");

try (SseEventSource source = SseEventSource.target(target).build()) {
    source.register(event -> {
        String data = event.readData();
        System.out.println(data);
    });
    source.open();

    Thread.sleep(60_000);
}
```

Browser client biasanya memakai JavaScript `EventSource`, bukan `SseEventSource`.

---

## 7. Minimal SSE Endpoint di Jersey

Contoh modern Jakarta namespace:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.sse.OutboundSseEvent;
import jakarta.ws.rs.sse.Sse;
import jakarta.ws.rs.sse.SseEventSink;

@Path("/case-events")
public class CaseEventResource {

    @GET
    @Path("/demo")
    @Produces(MediaType.SERVER_SENT_EVENTS)
    public void demo(@Context Sse sse, @Context SseEventSink sink) {
        OutboundSseEvent event = sse.newEventBuilder()
            .name("hello")
            .id("1")
            .mediaType(MediaType.TEXT_PLAIN_TYPE)
            .data(String.class, "hello from jersey")
            .build();

        sink.send(event)
            .whenComplete((ignored, error) -> {
                try {
                    sink.close();
                } catch (Exception closeError) {
                    // log close failure if needed
                }
            });
    }
}
```

Untuk Jersey 2.x legacy:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.sse.OutboundSseEvent;
import javax.ws.rs.sse.Sse;
import javax.ws.rs.sse.SseEventSink;
```

Perhatikan signature method:

```java
public void demo(...)
```

SSE endpoint sering `void` karena response body dikendalikan oleh `SseEventSink`. Jangan return `Response.ok(...)` sambil juga memakai sink; itu mencampur dua model response.

---

## 8. Browser Client Minimal

```html
<script>
  const source = new EventSource('/api/case-events/demo');

  source.addEventListener('hello', event => {
    console.log('hello event:', event.data);
  });

  source.onerror = error => {
    console.log('sse error', error);
  };
</script>
```

Jika server mengirim event tanpa `name`, gunakan:

```javascript
source.onmessage = event => {
  console.log(event.data);
};
```

Jika server mengirim:

```text
event: hello
data: ...
```

maka handler default `onmessage` tidak cukup. Gunakan:

```javascript
source.addEventListener('hello', handler);
```

---

## 9. Resource Lifetime: Hal Paling Penting dalam SSE

SSE endpoint berbeda dari REST biasa karena object yang dibuat tidak selalu mati saat method resource selesai.

Pada REST biasa:

```text
request masuk
resource method execute
response selesai
request selesai
```

Pada SSE:

```text
request masuk
resource method mendaftarkan sink
method selesai
connection tetap hidup
sink dipakai nanti oleh thread/event producer lain
connection bisa hidup menit/jam
```

Ini menciptakan beberapa risiko:

1. `SseEventSink` disimpan terlalu lama.
2. Sink client disconnect tetapi masih ada di map.
3. Broadcast mencoba menulis ke sink mati.
4. User logout tetapi sink masih aktif.
5. Server shutdown tetapi sink tidak ditutup.
6. Setiap sink menyimpan terlalu banyak context sehingga memory bocor.

Mental model:

```text
SSE connection = resource server-side yang mahal.
SseEventSink = harus diperlakukan seperti file handle/socket/db connection.
Kalau dibuka, harus ada strategi close dan cleanup.
```

---

## 10. Simple Broadcaster Pattern

Contoh basic broadcaster:

```java
import jakarta.annotation.PostConstruct;
import jakarta.inject.Singleton;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.sse.OutboundSseEvent;
import jakarta.ws.rs.sse.Sse;
import jakarta.ws.rs.sse.SseBroadcaster;
import jakarta.ws.rs.sse.SseEventSink;

@Singleton
public class CaseEventHub {

    @Context
    private Sse sse;

    private SseBroadcaster broadcaster;

    @PostConstruct
    public void init() {
        this.broadcaster = sse.newBroadcaster();

        this.broadcaster.onError((sink, error) -> {
            // log and rely on close/cleanup strategy
            safeClose(sink);
        });

        this.broadcaster.onClose(sink -> {
            // optional logging/metric
        });
    }

    public void register(SseEventSink sink) {
        broadcaster.register(sink);
    }

    public void publishStatusChanged(CaseStatusChanged payload) {
        OutboundSseEvent event = sse.newEventBuilder()
            .name("case-status-changed")
            .id(String.valueOf(payload.eventId()))
            .mediaType(jakarta.ws.rs.core.MediaType.APPLICATION_JSON_TYPE)
            .data(CaseStatusChanged.class, payload)
            .build();

        broadcaster.broadcast(event);
    }

    private static void safeClose(SseEventSink sink) {
        try {
            if (sink != null && !sink.isClosed()) {
                sink.close();
            }
        } catch (Exception ignored) {
            // ignored intentionally
        }
    }
}
```

Resource:

```java
@Path("/cases/{caseId}/events")
public class CaseSseResource {

    private final CaseEventHub eventHub;

    public CaseSseResource(CaseEventHub eventHub) {
        this.eventHub = eventHub;
    }

    @GET
    @Produces(MediaType.SERVER_SENT_EVENTS)
    public void subscribe(
            @PathParam("caseId") String caseId,
            @Context SseEventSink sink,
            @Context SecurityContext securityContext) {

        // validate authorization before register
        // verify user can observe this caseId

        eventHub.register(sink);
    }
}
```

Namun pattern ini masih terlalu sederhana untuk production karena broadcast global tidak memfilter case/user/tenant. Kita perlu registry yang lebih eksplisit.

---

## 11. Production Registry Pattern

Untuk enterprise system, jarang semua client menerima semua event. Biasanya event perlu dipartisi berdasarkan:

- user id,
- tenant id,
- agency id,
- case id,
- role,
- topic,
- subscription type,
- environment.

Struktur sederhana:

```text
SseConnectionRegistry
  Map<TopicKey, Set<ClientConnection>>

ClientConnection
  connectionId
  userId
  tenantId
  caseId/topic
  createdAt
  lastSentAt
  sink
  attributes minimal
```

Contoh implementasi:

```java
public final class SseConnection {
    private final String connectionId;
    private final String userId;
    private final String topic;
    private final SseEventSink sink;
    private final Instant createdAt;
    private final AtomicLong sentCount = new AtomicLong();

    public SseConnection(String connectionId,
                         String userId,
                         String topic,
                         SseEventSink sink,
                         Instant createdAt) {
        this.connectionId = connectionId;
        this.userId = userId;
        this.topic = topic;
        this.sink = sink;
        this.createdAt = createdAt;
    }

    public String connectionId() { return connectionId; }
    public String userId() { return userId; }
    public String topic() { return topic; }
    public SseEventSink sink() { return sink; }
    public Instant createdAt() { return createdAt; }
    public long incrementSentCount() { return sentCount.incrementAndGet(); }
}
```

Registry:

```java
@Singleton
public class SseConnectionRegistry {

    private final ConcurrentMap<String, CopyOnWriteArraySet<SseConnection>> byTopic = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, SseConnection> byConnectionId = new ConcurrentHashMap<>();

    public void register(SseConnection connection) {
        byConnectionId.put(connection.connectionId(), connection);
        byTopic.computeIfAbsent(connection.topic(), ignored -> new CopyOnWriteArraySet<>())
            .add(connection);
    }

    public List<SseConnection> findByTopic(String topic) {
        return List.copyOf(byTopic.getOrDefault(topic, new CopyOnWriteArraySet<>()));
    }

    public void unregister(SseConnection connection) {
        byConnectionId.remove(connection.connectionId());

        CopyOnWriteArraySet<SseConnection> set = byTopic.get(connection.topic());
        if (set != null) {
            set.remove(connection);
            if (set.isEmpty()) {
                byTopic.remove(connection.topic(), set);
            }
        }

        safeClose(connection.sink());
    }

    public int activeConnectionCount() {
        return byConnectionId.size();
    }

    private static void safeClose(SseEventSink sink) {
        try {
            if (sink != null && !sink.isClosed()) {
                sink.close();
            }
        } catch (Exception ignored) {
        }
    }
}
```

Catatan:

- `CopyOnWriteArraySet` cocok untuk read/broadcast jauh lebih sering daripada register/unregister.
- Untuk ribuan koneksi dengan register/unregister tinggi, perlu struktur lain.
- Jangan simpan object besar di `SseConnection`.
- Jangan simpan full `SecurityContext`, full JWT claims besar, atau entity JPA.

---

## 12. Sending Event dengan Cleanup

Jangan asumsikan `sink.send(event)` selalu berhasil.

Client bisa:

- close tab,
- pindah network,
- sleep laptop,
- kena proxy timeout,
- kehilangan auth session,
- lambat membaca response.

Pattern:

```java
@Singleton
public class CaseEventPublisher {

    private final SseConnectionRegistry registry;
    private final Sse sse;

    public CaseEventPublisher(SseConnectionRegistry registry, @Context Sse sse) {
        this.registry = registry;
        this.sse = sse;
    }

    public void publish(String topic, CaseStatusChanged payload) {
        OutboundSseEvent event = sse.newEventBuilder()
            .id(String.valueOf(payload.eventId()))
            .name("case-status-changed")
            .mediaType(MediaType.APPLICATION_JSON_TYPE)
            .data(CaseStatusChanged.class, payload)
            .build();

        for (SseConnection connection : registry.findByTopic(topic)) {
            sendOne(connection, event);
        }
    }

    private void sendOne(SseConnection connection, OutboundSseEvent event) {
        SseEventSink sink = connection.sink();

        if (sink.isClosed()) {
            registry.unregister(connection);
            return;
        }

        sink.send(event).whenComplete((ignored, error) -> {
            if (error != null) {
                registry.unregister(connection);
                return;
            }
            connection.incrementSentCount();
        });
    }
}
```

Core invariant:

```text
Setiap failure saat send harus mengarah ke cleanup.
Setiap close/disconnect harus mengarah ke unregister.
Setiap registry entry harus punya owner lifecycle.
```

---

## 13. Heartbeat: Menjaga Koneksi Tetap Terlihat Hidup

Banyak layer jaringan memutus koneksi idle:

- browser,
- corporate proxy,
- nginx,
- API gateway,
- AWS ALB/NLB,
- ingress controller,
- service mesh,
- firewall,
- servlet container.

Kalau tidak ada event selama 5–60 menit, koneksi bisa diputus. Aplikasi sering tidak tahu sampai mencoba menulis.

Solusi umum: kirim heartbeat periodik.

SSE heartbeat biasanya comment event:

```text
: heartbeat

```

Dalam Jersey:

```java
OutboundSseEvent heartbeat = sse.newEventBuilder()
    .comment("heartbeat")
    .build();
```

Scheduler:

```java
@Singleton
public class SseHeartbeatService {

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
    private final SseConnectionRegistry registry;
    private final Sse sse;

    public SseHeartbeatService(SseConnectionRegistry registry, @Context Sse sse) {
        this.registry = registry;
        this.sse = sse;
    }

    @PostConstruct
    public void start() {
        scheduler.scheduleAtFixedRate(this::sendHeartbeat, 30, 30, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void stop() {
        scheduler.shutdownNow();
    }

    private void sendHeartbeat() {
        OutboundSseEvent heartbeat = sse.newEventBuilder()
            .comment("heartbeat")
            .build();

        for (SseConnection connection : registry.all()) {
            SseEventSink sink = connection.sink();
            if (sink.isClosed()) {
                registry.unregister(connection);
                continue;
            }
            sink.send(heartbeat).whenComplete((ignored, error) -> {
                if (error != null) {
                    registry.unregister(connection);
                }
            });
        }
    }
}
```

Interval heartbeat harus lebih kecil dari idle timeout terendah di jalur request.

Contoh:

```text
ALB idle timeout: 60s
nginx proxy_read_timeout: 75s
browser okay

heartbeat: 25s atau 30s
```

Jangan kirim heartbeat terlalu sering. Jika ada 10.000 koneksi dan heartbeat tiap 1 detik, kamu menciptakan 10.000 writes/detik hanya untuk keepalive.

---

## 14. Reconnect dan `Last-Event-ID`

Browser `EventSource` otomatis mencoba reconnect ketika koneksi putus.

Jika event memiliki `id`, browser dapat mengirim header:

```http
Last-Event-ID: 102
```

Saat reconnect:

```http
GET /api/cases/123/events HTTP/1.1
Accept: text/event-stream
Last-Event-ID: 102
```

Server bisa membaca header ini:

```java
@GET
@Produces(MediaType.SERVER_SENT_EVENTS)
public void subscribe(
        @PathParam("caseId") String caseId,
        @HeaderParam("Last-Event-ID") String lastEventId,
        @Context SseEventSink sink,
        @Context Sse sse) {

    // register sink
    // optionally replay missed events after lastEventId
}
```

Namun ini hanya berguna jika server punya event log/replay store.

Tanpa durable store:

```text
Last-Event-ID diterima,
tapi server tidak tahu event apa yang hilang,
sehingga reconnect hanya membuat stream baru.
```

Dengan event store:

```text
1. Client reconnect dengan Last-Event-ID = 102
2. Server query event_store where event_id > 102 and topic = X
3. Server kirim missed events
4. Server register stream untuk live events
```

Ingat race condition:

```text
Saat replay event 103..110,
event live 111 bisa muncul.
Kalau tidak hati-hati, event bisa out-of-order atau double-send.
```

Pattern aman:

```text
on reconnect:
  1. register connection sebagai pending/replay mode
  2. ambil snapshot high-watermark saat register
  3. replay lastEventId+1 sampai high-watermark
  4. aktifkan live delivery setelah replay selesai
```

Atau gunakan event broker/log dengan ordering per topic.

---

## 15. SSE Endpoint untuk Progress Long-Running Job

Use case umum:

```text
User trigger export report.
Backend membuat job.
UI subscribe progress.
Server push progress via SSE.
```

Jangan membuat endpoint seperti ini:

```text
GET /export-and-stream-progress
```

lalu satu request melakukan semuanya. Lebih baik pisahkan command dan observation:

```text
POST /exports
  -> 202 Accepted
  -> { "jobId": "exp-123", "statusUrl": "/exports/exp-123", "eventsUrl": "/exports/exp-123/events" }

GET /exports/exp-123/events
  -> text/event-stream progress updates

GET /exports/exp-123/download
  -> file download when completed
```

Kenapa?

- `POST` command bisa timeout/retry dengan idempotency key.
- Job bisa berjalan walaupun browser refresh.
- Progress bisa di-poll sebagai fallback.
- Download dipisah dari event stream.
- Audit trail lebih jelas.

Contoh event:

```text
event: export-started
id: 1
data: {"jobId":"exp-123","progress":0}

event: export-progress
id: 2
data: {"jobId":"exp-123","progress":35,"stage":"QUERYING"}

event: export-completed
id: 3
data: {"jobId":"exp-123","progress":100,"downloadUrl":"/exports/exp-123/download"}
```

Setelah `export-completed`, server boleh menutup stream:

```java
sink.send(completedEvent).whenComplete((ignored, error) -> {
    registry.unregister(connection); // closes sink
});
```

---

## 16. SSE untuk Case Management / Regulatory Workflow

Untuk sistem case management/regulatory lifecycle, SSE bisa dipakai untuk:

- update status case,
- assignment officer,
- document uploaded,
- comment/minute added,
- deadline approaching,
- enforcement action created,
- approval decision changed,
- background screening result completed.

Tetapi SSE harus tetap read-only observation channel.

Command tetap melalui REST endpoint normal:

```text
POST /cases/{caseId}/assign
POST /cases/{caseId}/submit-review
POST /cases/{caseId}/approve
POST /cases/{caseId}/request-info
```

Event SSE hanya memberitahu:

```text
case-assigned
case-status-changed
case-review-submitted
case-approved
case-info-requested
```

Kenapa command tidak dikirim via SSE?

Karena SSE satu arah. Lebih penting lagi, regulatory system membutuhkan:

- authorization jelas,
- request validation jelas,
- idempotency jelas,
- audit command jelas,
- error response jelas,
- transaction boundary jelas.

SSE hanya mempercepat UI awareness.

---

## 17. Security Model untuk SSE

SSE endpoint tetap HTTP endpoint. Semua prinsip security REST tetap berlaku:

- authenticate sebelum membuka stream,
- authorize topic/case sebelum register sink,
- jangan kirim event yang user tidak boleh lihat,
- jangan percaya subscription parameter dari client,
- jangan simpan full credential dalam registry,
- close stream saat session/token invalid jika feasible,
- audit subscription jika datanya sensitif.

### 17.1 Authorization Saat Subscribe

```java
@GET
@Path("/cases/{caseId}/events")
@Produces(MediaType.SERVER_SENT_EVENTS)
public void subscribe(
        @PathParam("caseId") String caseId,
        @Context SseEventSink sink,
        @Context SecurityContext securityContext) {

    UserPrincipal principal = (UserPrincipal) securityContext.getUserPrincipal();

    if (!authorizationService.canViewCase(principal.userId(), caseId)) {
        safeClose(sink);
        throw new ForbiddenException("Not allowed to observe this case");
    }

    registry.register(new SseConnection(
        UUID.randomUUID().toString(),
        principal.userId(),
        "case:" + caseId,
        sink,
        Instant.now()
    ));
}
```

Subtle issue:

```text
Jika response stream sudah mulai dikirim, kamu tidak bisa lagi mengganti status menjadi 403.
```

Maka authorization harus dilakukan **sebelum** register dan sebelum mengirim event pertama.

### 17.2 Authorization Saat Publish

Jangan hanya mengandalkan authorize at subscribe jika permission bisa berubah.

Contoh:

```text
User awalnya boleh melihat case.
Lalu case dipindah agency/tenant.
Stream masih terbuka.
```

Pilihan desain:

1. Saat permission berubah, close semua stream terdampak.
2. Saat publish, filter ulang recipient.
3. Gunakan TTL stream pendek dan reconnect wajib re-authorize.
4. Kombinasi 1 dan 3 untuk data sensitif.

Untuk regulatory/high-sensitivity data, pilihan paling aman:

```text
- authorize saat subscribe,
- publish berdasarkan topic yang sudah terpartisi tenant/case,
- close stream saat access revoked,
- heartbeat/reconnect memaksa periodic reauthorization.
```

### 17.3 Token Expiry

Browser `EventSource` dengan Authorization header tidak native jika pakai constructor standar. Banyak implementasi browser hanya mudah memakai cookie/session. Jika butuh bearer token header, biasanya perlu:

- cookie-based auth,
- polyfill EventSource yang support header,
- token di query string — tidak direkomendasikan untuk sensitive token,
- backend-for-frontend proxy.

Risiko token di query string:

- masuk access log,
- masuk browser history,
- masuk proxy log,
- mudah bocor via referer jika salah konfigurasi.

Untuk enterprise app dengan session cookie secure:

```text
EventSource('/api/events')
Cookie dikirim otomatis jika same-origin dan policy cookie mengizinkan.
```

Pastikan:

- `HttpOnly`,
- `Secure`,
- `SameSite` sesuai kebutuhan,
- CSRF model dipahami.

SSE `GET` tidak mengubah state, tapi tetap bisa membuka data stream. Jadi authorization tetap wajib.

---

## 18. Observability untuk SSE

SSE sulit diobservasi kalau hanya mengukur request duration biasa, karena request duration bisa panjang by design.

Metric yang dibutuhkan:

```text
sse.active_connections
sse.connections.opened_total
sse.connections.closed_total
sse.connections.error_total
sse.events.sent_total
sse.events.failed_total
sse.heartbeat.sent_total
sse.connection.lifetime
sse.send.latency
sse.registry.size_by_topic
sse.reconnect.count
```

Log penting saat subscribe:

```json
{
  "event": "sse_subscribe",
  "connectionId": "c-123",
  "userId": "u-456",
  "topic": "case:789",
  "remoteIp": "10.1.2.3",
  "correlationId": "req-abc"
}
```

Log saat close:

```json
{
  "event": "sse_close",
  "connectionId": "c-123",
  "reason": "send_failure",
  "lifetimeMs": 92000,
  "sentCount": 41
}
```

Jangan log semua event payload mentah. Untuk sensitive workflow, log metadata:

```text
OK:
  event type, topic, event id, recipient count, success/failure count

Hindari:
  full case detail, document content, personal data, raw JWT, full response payload
```

### 18.1 Trace

Tracing SSE agak tricky karena satu request bisa hidup lama.

Jangan membuat satu span request hidup berjam-jam jika tracing backend tidak dirancang untuk itu. Lebih baik:

- span subscribe singkat,
- metric active connection,
- span/log per publish operation,
- correlation event id.

Model:

```text
HTTP subscribe request:
  trace: sse.subscribe
  selesai setelah registration

Publish event:
  trace: case.status.change
    span: event.persist
    span: sse.publish
      attributes: topic, recipient_count, event_type
```

---

## 19. Threading dan Back-Pressure

SSE tampak sederhana, tapi ada persoalan fundamental:

```text
Bagaimana jika server menghasilkan event lebih cepat daripada client/network bisa menerima?
```

SSE/JAX-RS tidak memberikan back-pressure kuat seperti reactive streams end-to-end.

Kemungkinan failure:

- `send` lambat,
- future send menumpuk,
- buffer container/proxy penuh,
- memory meningkat,
- executor habis,
- broadcast ke banyak client memblokir producer.

### 19.1 Jangan Publish dari Transaction Thread Berat

Anti-pattern:

```java
@Transactional
public void approveCase(...) {
    repository.save(...);
    ssePublisher.publish(...); // broadcast ke 5000 client langsung di transaction path
}
```

Masalah:

- transaction jadi tergantung network client,
- latency command naik,
- rollback/commit semantics kabur,
- failure send bisa mengganggu business operation.

Pattern lebih baik:

```text
1. command transaction update database
2. insert domain event/outbox row
3. commit
4. async publisher membaca outbox/event bus
5. SSE publisher mengirim ke active subscribers
```

Dengan ini:

- command success tidak tergantung client stream,
- event bisa retry,
- audit lebih kuat,
- delivery channel bisa diganti.

### 19.2 Per-Connection Queue?

Untuk client lambat, kamu bisa memberi queue per connection. Tapi queue ini harus bounded.

```text
unbounded queue per connection = memory leak waiting to happen
```

Policy saat queue penuh:

| Policy | Cocok Untuk | Risiko |
|---|---|---|
| Drop newest | telemetry ringan | client miss latest event |
| Drop oldest | dashboard latest-state | event history hilang |
| Close connection | sensitive ordered stream | reconnect overhead |
| Coalesce | progress/status | implementasi lebih kompleks |
| Back-pressure producer | sedikit client internal | bisa memperlambat core system |

Untuk progress/status UI, coalescing sering lebih baik:

```text
Daripada queue progress 1%,2%,3%,...,80%,
simpan latest progress saja.
```

### 19.3 Broadcast Fan-out

Broadcast ke N client punya biaya O(N).

Jika event topic punya 10.000 subscriber:

```text
1 event = 10.000 write attempts
heartbeat = 10.000 write attempts setiap interval
```

Ini bukan masalah kecil.

Mitigasi:

- partisi topic,
- limit subscriber per user/topic,
- coalesce event,
- gunakan broker/pubsub internal,
- scale horizontally dengan sticky routing atau distributed pubsub,
- jangan broadcast global kalau event hanya relevan untuk sebagian user.

---

## 20. Horizontal Scaling di Kubernetes / Multi-Instance

Misal ada 4 pod Jersey:

```text
Pod A: client 1,2,3 connected
Pod B: client 4,5 connected
Pod C: client 6 connected
Pod D: no client
```

Jika event dipublish di Pod D, bagaimana client di Pod A/B/C menerima?

SSE connection adalah TCP connection ke pod tertentu. Registry lokal pod hanya tahu sink lokal.

Maka untuk multi-instance, perlu pubsub internal:

```text
Domain event/outbox
  -> Kafka/RabbitMQ/Redis Pub/Sub/JMS/database polling
  -> setiap pod menerima event
  -> setiap pod publish ke local connected sinks yang relevan
```

Architecture:

```text
[Command Service]
      |
      v
[Outbox/Event Broker]
      |
      +--> [Jersey Pod A SSE local registry]
      +--> [Jersey Pod B SSE local registry]
      +--> [Jersey Pod C SSE local registry]
      +--> [Jersey Pod D SSE local registry]
```

Important:

```text
SSE registry is local process memory.
Cluster-wide delivery requires external distribution.
```

### 20.1 Sticky Session?

Sticky session bisa menjaga reconnect user ke pod yang sama, tapi tidak menyelesaikan event distribution jika event diproduksi di pod lain.

Sticky session berguna untuk:

- mengurangi reconnect state churn,
- local in-memory replay pendek,
- simpler debugging.

Tetapi tetap butuh event distribution untuk cluster correctness.

### 20.2 Rolling Deployment

Saat rolling deployment:

```text
Pod lama menerima SIGTERM
Kubernetes mulai terminationGracePeriod
Ingress berhenti routing request baru
existing SSE connections perlu ditutup graceful
browser reconnect ke pod baru
```

Pattern shutdown:

```java
@PreDestroy
public void shutdown() {
    OutboundSseEvent shutdown = sse.newEventBuilder()
        .name("server-shutdown")
        .data(String.class, "server is restarting; reconnect")
        .reconnectDelay(1000)
        .build();

    for (SseConnection connection : registry.all()) {
        connection.sink().send(shutdown).whenComplete((ignored, error) -> {
            registry.unregister(connection);
        });
    }
}
```

Jangan berharap semua client menerima shutdown event. Treat it as best effort.

---

## 21. Reverse Proxy dan Buffering

SSE sering gagal bukan karena kode Jersey, tetapi karena proxy.

Masalah umum:

```text
Server menulis event.
Proxy men-buffer response.
Client tidak melihat event sampai buffer penuh atau response selesai.
```

Untuk nginx, biasanya perlu mematikan buffering untuk SSE route:

```nginx
location /api/events/ {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

Atau response header:

```http
X-Accel-Buffering: no
Cache-Control: no-cache
```

Tergantung proxy, header ini bisa atau tidak dihormati.

### 21.1 Idle Timeout

Layer umum:

```text
Browser
Corporate proxy
CDN
API Gateway
Load Balancer
Ingress Controller
Service Mesh
Servlet Container
Application
```

Koneksi akan diputus oleh timeout terpendek.

Checklist:

```text
- Apa idle timeout load balancer?
- Apa proxy_read_timeout ingress?
- Apakah response buffering off?
- Apakah gzip/compression membuat buffering?
- Apakah HTTP/2 behavior sesuai?
- Apakah heartbeat interval < timeout terpendek?
```

### 21.2 Compression

Compression bisa bermasalah untuk SSE jika membuat data tertahan di buffer compressor.

Untuk event kecil dan sering, compression tidak selalu menguntungkan.

Praktik umum:

```text
Disable gzip/compression untuk text/event-stream,
atau pastikan flush behavior benar.
```

---

## 22. Browser Limit dan UI Design

Browser punya limit koneksi per origin, terutama pada HTTP/1.1. Jika aplikasi membuka banyak `EventSource` per tab/per widget, bisa menghabiskan koneksi.

Anti-pattern:

```text
Dashboard punya 12 widget.
Setiap widget membuka EventSource sendiri.
User buka 3 tab.
Total 36 SSE connections per user.
```

Lebih baik:

```text
1 EventSource per application shell/tab
server mengirim named events/topic multiplexed
client-side event bus mendistribusikan ke widget
```

Contoh event:

```text
event: case-status-changed
data: {...}

event: notification-created
data: {...}

event: export-progress
data: {...}
```

Client:

```javascript
const source = new EventSource('/api/me/events');

source.addEventListener('case-status-changed', e => caseStore.apply(JSON.parse(e.data)));
source.addEventListener('notification-created', e => notificationStore.add(JSON.parse(e.data)));
source.addEventListener('export-progress', e => exportStore.update(JSON.parse(e.data)));
```

Design invariant:

```text
Control number of streams per user.
Do not let every component independently open server connections.
```

---

## 23. CORS dan SSE

Jika SSE endpoint cross-origin:

```javascript
const source = new EventSource('https://api.example.com/events', {
  withCredentials: true
});
```

Server harus mengatur CORS:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Jangan gunakan:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Itu tidak valid untuk credentialed CORS.

Catatan:

- `EventSource` melakukan GET.
- Custom header Authorization tidak didukung native di banyak browser implementation.
- Credential/cookie cross-origin butuh `withCredentials` dan cookie policy yang benar.

Untuk enterprise, paling sederhana:

```text
Serve frontend dan API under same origin via reverse proxy/API gateway.
```

---

## 24. StreamingOutput untuk Download Besar

Selain SSE, Jersey mendukung `StreamingOutput` untuk response body streaming.

Contoh CSV export:

```java
@GET
@Path("/reports/{reportId}/export.csv")
@Produces("text/csv")
public Response exportCsv(@PathParam("reportId") String reportId) {
    StreamingOutput stream = output -> {
        try (Writer writer = new BufferedWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8))) {
            writer.write("id,status,createdAt\n");

            reportService.streamRows(reportId, row -> {
                try {
                    writer.write(row.id());
                    writer.write(',');
                    writer.write(row.status());
                    writer.write(',');
                    writer.write(row.createdAt().toString());
                    writer.write('\n');
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });

            writer.flush();
        }
    };

    return Response.ok(stream)
        .header("Content-Disposition", "attachment; filename=report-" + reportId + ".csv")
        .header("Cache-Control", "no-store")
        .build();
}
```

Risiko:

- exception terjadi setelah header terkirim,
- client disconnect saat streaming,
- DB cursor terlalu lama terbuka,
- transaction terlalu panjang,
- output buffer besar,
- CSV injection,
- memory leak jika collect semua row dulu.

### 24.1 Jangan Collect Semua Data

Anti-pattern:

```java
List<Row> rows = repository.findAllRows(reportId); // 5 million rows
return Response.ok(toCsv(rows)).build();
```

Ini bukan streaming. Ini OOM waiting to happen.

Pattern:

```text
DB cursor/page kecil
  -> transform row
  -> write row ke output
  -> flush periodik
```

### 24.2 Transaction Boundary untuk Streaming

Hati-hati dengan streaming dalam transaction.

Jika transaction dibuka selama seluruh download:

```text
client lambat -> transaction lama -> DB resource lama -> lock/snapshot pressure
```

Alternatif:

- buat export job async menghasilkan file di object storage,
- lalu download file statis,
- atau stream dengan paging read-only tanpa transaction panjang.

Untuk regulatory export besar, async export lebih defensible:

```text
POST /exports
GET /exports/{id}/events
GET /exports/{id}/download
```

---

## 25. Chunked Output dan Flush Semantics

Dalam HTTP streaming, menulis ke `OutputStream` tidak selalu berarti client langsung menerima bytes.

Ada buffer di:

- application writer,
- Jersey/entity provider,
- servlet container,
- TCP stack,
- proxy,
- compression layer,
- browser.

`flush()` membantu, tapi tidak selalu menembus semua layer.

Untuk SSE, event harus diakhiri blank line dan stream perlu flush agar client cepat menerima.

Untuk `StreamingOutput`, flush terlalu sering bisa buruk:

```text
flush setiap row -> overhead tinggi
flush setiap 1000 row atau beberapa KB/MB -> lebih reasonable
```

---

## 26. Error Handling dalam Streaming

Pada REST biasa:

```text
error sebelum response -> bisa map ke JSON error 500/400
```

Pada streaming:

```text
header 200 sudah terkirim
body sebagian sudah terkirim
error terjadi
```

Kamu tidak bisa lagi mengubah status menjadi `500` dengan body error normal.

Untuk SSE, kamu bisa kirim event error sebelum menutup:

```java
OutboundSseEvent errorEvent = sse.newEventBuilder()
    .name("error")
    .mediaType(MediaType.APPLICATION_JSON_TYPE)
    .data(StreamError.class, new StreamError("EXPORT_FAILED", "Export failed"))
    .build();

sink.send(errorEvent).whenComplete((ignored, error) -> registry.unregister(connection));
```

Untuk `StreamingOutput`, jika error terjadi di tengah download:

- client melihat incomplete download,
- browser mungkin menganggap network error,
- audit/log server harus mencatat failure,
- client perlu mekanisme checksum/file metadata untuk validasi.

Untuk file penting:

```text
Generate file dulu secara async.
Verifikasi checksum/size.
Baru expose download.
```

---

## 27. Memory Risk dalam SSE

Memory risk utama:

1. Registry tidak dibersihkan.
2. Setiap connection menyimpan object besar.
3. Queue per connection unbounded.
4. Event payload besar di-broadcast ke banyak connection.
5. Lambda callback menangkap object besar.
6. Metrics label cardinality terlalu tinggi.

Contoh buruk:

```java
class SseConnection {
    SecurityContext fullSecurityContext;
    UserEntity userEntityWithRolesAndPermissions;
    CaseEntity caseEntityWithDocuments;
    List<OutboundSseEvent> pendingEvents = new ArrayList<>();
}
```

Contoh lebih sehat:

```java
class SseConnection {
    String connectionId;
    String userId;
    String tenantId;
    String topic;
    Instant createdAt;
    SseEventSink sink;
}
```

Rule:

```text
Simpan identifier dan metadata minimum, bukan object graph besar.
```

---

## 28. Rate Limiting dan Abuse Protection

SSE endpoint bisa disalahgunakan dengan membuka banyak koneksi.

Proteksi:

- max active streams per user,
- max active streams per IP,
- max active streams per topic,
- auth wajib,
- idle stream TTL,
- server-side close untuk koneksi terlalu lama,
- reject jika system pressure tinggi,
- monitor abnormal reconnect loop.

Contoh policy:

```text
per user:
  max 3 active SSE connections

per IP:
  max 100 active SSE connections

per connection lifetime:
  max 60 minutes, then force reconnect

heartbeat:
  every 25 seconds
```

Saat limit terlampaui:

```java
if (registry.countByUser(userId) >= 3) {
    safeClose(sink);
    throw new TooManyRequestsException("Too many active event streams");
}
```

Tetapi ingat: jika stream sudah dimulai, status error tidak bisa diubah. Limit harus dicek sebelum register/kirim event.

---

## 29. Testing SSE Jersey

Testing SSE butuh lebih dari unit test resource method.

### 29.1 Unit Test Registry

Test:

- register menambah connection,
- unregister menghapus connection,
- unregister idempotent,
- closed sink dibersihkan,
- count per topic/user benar.

### 29.2 Integration Test SSE Endpoint

Gunakan Jersey Test Framework atau container test, lalu client SSE.

Pseudo-test:

```java
@Test
void shouldReceiveCaseStatusEvent() throws Exception {
    WebTarget target = client.target(baseUri).path("/cases/123/events");

    CountDownLatch latch = new CountDownLatch(1);
    AtomicReference<String> received = new AtomicReference<>();

    try (SseEventSource source = SseEventSource.target(target).build()) {
        source.register(event -> {
            if ("case-status-changed".equals(event.getName())) {
                received.set(event.readData());
                latch.countDown();
            }
        });

        source.open();

        publisher.publish("case:123", new CaseStatusChanged("123", "APPROVED", 101));

        assertTrue(latch.await(5, TimeUnit.SECONDS));
        assertTrue(received.get().contains("APPROVED"));
    }
}
```

### 29.3 Failure Tests

Test yang lebih penting:

- client disconnect -> registry cleanup,
- send failure -> unregister,
- heartbeat failure -> unregister,
- unauthorized user cannot subscribe,
- user cannot subscribe to other tenant/case,
- too many connections rejected,
- reconnect with `Last-Event-ID`,
- shutdown closes sinks,
- slow client does not block command transaction.

### 29.4 Proxy/Ingress Test

Banyak SSE bug hanya muncul di staging/prod topology.

Test:

```text
Browser -> CDN/API Gateway/Ingress -> Service -> Jersey
```

Validasi:

- event diterima segera, bukan setelah response selesai,
- heartbeat terlihat,
- koneksi tidak putus sebelum expected timeout,
- reconnect jalan,
- CORS/cookie/auth jalan,
- gzip tidak menahan event,
- rolling deploy reconnect sukses.

---

## 30. Java 8 sampai Java 25 Considerations

### 30.1 Java 8

Di Java 8/Jersey 2.x:

- namespace biasanya `javax.ws.rs`,
- concurrency memakai `ExecutorService`, `CompletableFuture`, scheduler manual,
- tidak ada virtual threads,
- lebih hati-hati dengan thread pool blocking.

Rekomendasi:

```text
- gunakan bounded executor,
- batasi active connection,
- jangan publish blocking di request thread,
- perhatikan GC jika banyak connection metadata.
```

### 30.2 Java 11/17

Java 11/17 sering menjadi baseline modern enterprise.

Manfaat:

- TLS/runtime lebih modern,
- GC improvement,
- container awareness lebih baik,
- records tersedia sejak Java 16 untuk DTO internal jika stack serialization mendukung.

Tetap:

```text
SSE bottleneck bukan hanya thread; network/proxy/client tetap dominan.
```

### 30.3 Java 21/25 dan Virtual Threads

Virtual threads bisa membantu workload blocking, tetapi tidak otomatis membuat SSE scalable tanpa batas.

SSE connection panjang bukan sekadar “thread per request”. Bergantung container/Jersey implementation, koneksi bisa dikelola async/nonblocking atau tetap terkait worker tertentu.

Hal yang perlu dinilai:

- apakah servlet/container mendukung virtual thread executor,
- apakah write ke sink blocking atau async,
- apakah ThreadLocal/MDC context aman,
- apakah banyak long-lived operations memegang resource,
- apakah bottleneck ada di network/client/proxy, bukan thread.

Rule:

```text
Virtual threads dapat mengurangi biaya blocking threads,
tapi tidak menghapus kebutuhan limit, cleanup, heartbeat, back-pressure, dan event distribution.
```

---

## 31. Jersey Config dan Dependency

Untuk SSE di Jersey, pastikan module SSE tersedia.

Contoh Maven Jersey 3.x/4.x style secara konseptual:

```xml
<dependency>
  <groupId>org.glassfish.jersey.media</groupId>
  <artifactId>jersey-media-sse</artifactId>
  <version>${jersey.version}</version>
</dependency>
```

Jersey 2.x masih memakai namespace `javax`, tetapi artifact naming serupa.

Jika memakai Spring Boot/Jakarta EE server, pastikan:

- dependency Jersey tidak konflik dengan server-provided Jersey,
- versi `jersey-media-sse` match dengan Jersey core,
- tidak mencampur `javax.ws.rs.sse` dan `jakarta.ws.rs.sse`,
- JSON provider tersedia jika event data object diserialisasi sebagai JSON.

Common error:

```text
NoClassDefFoundError: jakarta/ws/rs/sse/SseEventSink
```

Kemungkinan:

- runtime Jakarta REST API terlalu lama,
- dependency scope salah,
- server tidak menyediakan JAX-RS/Jakarta REST 2.1+ SSE API,
- namespace mismatch.

---

## 32. Complete Example: Case Event SSE Module

### 32.1 DTO

```java
public record CaseStatusChangedEvent(
    long eventId,
    String caseId,
    String oldStatus,
    String newStatus,
    String changedBy,
    Instant changedAt
) {}
```

Untuk Java 8:

```java
public final class CaseStatusChangedEvent {
    private final long eventId;
    private final String caseId;
    private final String oldStatus;
    private final String newStatus;
    private final String changedBy;
    private final Instant changedAt;

    public CaseStatusChangedEvent(long eventId,
                                  String caseId,
                                  String oldStatus,
                                  String newStatus,
                                  String changedBy,
                                  Instant changedAt) {
        this.eventId = eventId;
        this.caseId = caseId;
        this.oldStatus = oldStatus;
        this.newStatus = newStatus;
        this.changedBy = changedBy;
        this.changedAt = changedAt;
    }

    public long getEventId() { return eventId; }
    public String getCaseId() { return caseId; }
    public String getOldStatus() { return oldStatus; }
    public String getNewStatus() { return newStatus; }
    public String getChangedBy() { return changedBy; }
    public Instant getChangedAt() { return changedAt; }
}
```

### 32.2 Registry

```java
@Singleton
public class CaseSseRegistry {

    private final ConcurrentMap<String, CopyOnWriteArraySet<CaseSseConnection>> byCaseId = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, CaseSseConnection> byConnectionId = new ConcurrentHashMap<>();

    public void register(CaseSseConnection connection) {
        byConnectionId.put(connection.connectionId(), connection);
        byCaseId.computeIfAbsent(connection.caseId(), ignored -> new CopyOnWriteArraySet<>())
            .add(connection);
    }

    public List<CaseSseConnection> connectionsForCase(String caseId) {
        return List.copyOf(byCaseId.getOrDefault(caseId, new CopyOnWriteArraySet<>()));
    }

    public Collection<CaseSseConnection> all() {
        return List.copyOf(byConnectionId.values());
    }

    public void unregister(CaseSseConnection connection, String reason) {
        byConnectionId.remove(connection.connectionId());

        CopyOnWriteArraySet<CaseSseConnection> set = byCaseId.get(connection.caseId());
        if (set != null) {
            set.remove(connection);
            if (set.isEmpty()) {
                byCaseId.remove(connection.caseId(), set);
            }
        }

        safeClose(connection.sink());

        // log reason, lifetime, sent count
    }

    public int countByUser(String userId) {
        int count = 0;
        for (CaseSseConnection connection : byConnectionId.values()) {
            if (connection.userId().equals(userId)) {
                count++;
            }
        }
        return count;
    }

    private static void safeClose(SseEventSink sink) {
        try {
            if (sink != null && !sink.isClosed()) {
                sink.close();
            }
        } catch (Exception ignored) {
        }
    }
}
```

### 32.3 Connection

```java
public final class CaseSseConnection {
    private final String connectionId;
    private final String userId;
    private final String tenantId;
    private final String caseId;
    private final SseEventSink sink;
    private final Instant createdAt;
    private final AtomicLong sentCount = new AtomicLong();

    public CaseSseConnection(String connectionId,
                             String userId,
                             String tenantId,
                             String caseId,
                             SseEventSink sink,
                             Instant createdAt) {
        this.connectionId = connectionId;
        this.userId = userId;
        this.tenantId = tenantId;
        this.caseId = caseId;
        this.sink = sink;
        this.createdAt = createdAt;
    }

    public String connectionId() { return connectionId; }
    public String userId() { return userId; }
    public String tenantId() { return tenantId; }
    public String caseId() { return caseId; }
    public SseEventSink sink() { return sink; }
    public Instant createdAt() { return createdAt; }
    public long incrementSentCount() { return sentCount.incrementAndGet(); }
    public long sentCount() { return sentCount.get(); }
}
```

### 32.4 Resource

```java
@Path("/cases/{caseId}/events")
public class CaseSseResource {

    private final CaseSseRegistry registry;
    private final CaseAuthorizationService authorizationService;

    public CaseSseResource(CaseSseRegistry registry,
                           CaseAuthorizationService authorizationService) {
        this.registry = registry;
        this.authorizationService = authorizationService;
    }

    @GET
    @Produces(MediaType.SERVER_SENT_EVENTS)
    public void subscribe(
            @PathParam("caseId") String caseId,
            @HeaderParam("Last-Event-ID") String lastEventId,
            @Context SseEventSink sink,
            @Context Sse sse,
            @Context SecurityContext securityContext) {

        UserPrincipal user = (UserPrincipal) securityContext.getUserPrincipal();

        if (!authorizationService.canViewCase(user.userId(), caseId)) {
            safeClose(sink);
            throw new ForbiddenException("Not allowed to observe this case");
        }

        if (registry.countByUser(user.userId()) >= 3) {
            safeClose(sink);
            throw new TooManyRequestsException("Too many active event streams");
        }

        CaseSseConnection connection = new CaseSseConnection(
            UUID.randomUUID().toString(),
            user.userId(),
            user.tenantId(),
            caseId,
            sink,
            Instant.now()
        );

        registry.register(connection);

        OutboundSseEvent opened = sse.newEventBuilder()
            .name("stream-opened")
            .id("stream-" + System.currentTimeMillis())
            .mediaType(MediaType.APPLICATION_JSON_TYPE)
            .data(StreamOpenedEvent.class, new StreamOpenedEvent(connection.connectionId(), caseId))
            .build();

        sink.send(opened).whenComplete((ignored, error) -> {
            if (error != null) {
                registry.unregister(connection, "initial_send_failed");
            }
        });

        // Optional: replay after lastEventId if event store exists
    }

    private static void safeClose(SseEventSink sink) {
        try {
            if (sink != null && !sink.isClosed()) {
                sink.close();
            }
        } catch (Exception ignored) {
        }
    }
}
```

### 32.5 Publisher

```java
@Singleton
public class CaseSsePublisher {

    private final CaseSseRegistry registry;
    private final Sse sse;

    public CaseSsePublisher(CaseSseRegistry registry, @Context Sse sse) {
        this.registry = registry;
        this.sse = sse;
    }

    public void publishStatusChanged(CaseStatusChangedEvent payload) {
        OutboundSseEvent event = sse.newEventBuilder()
            .name("case-status-changed")
            .id(String.valueOf(payload.eventId()))
            .mediaType(MediaType.APPLICATION_JSON_TYPE)
            .data(CaseStatusChangedEvent.class, payload)
            .build();

        for (CaseSseConnection connection : registry.connectionsForCase(payload.caseId())) {
            send(connection, event);
        }
    }

    private void send(CaseSseConnection connection, OutboundSseEvent event) {
        SseEventSink sink = connection.sink();

        if (sink.isClosed()) {
            registry.unregister(connection, "sink_already_closed");
            return;
        }

        sink.send(event).whenComplete((ignored, error) -> {
            if (error != null) {
                registry.unregister(connection, "send_failed");
            } else {
                connection.incrementSentCount();
            }
        });
    }
}
```

---

## 33. Common Failure Modes and Diagnosis

### 33.1 Client Tidak Menerima Event

Kemungkinan:

- server tidak mengirim blank line event terminator,
- proxy buffering aktif,
- gzip buffering,
- client pakai `onmessage` padahal server mengirim named event,
- endpoint tidak menghasilkan `text/event-stream`,
- auth redirect HTML dikirim ke EventSource,
- CORS gagal,
- connection closed oleh timeout.

Diagnosis:

```bash
curl -N -H "Accept: text/event-stream" http://localhost:8080/api/events
```

`-N` mematikan curl buffering.

### 33.2 Event Muncul Sekaligus Setelah Lama

Kemungkinan:

- proxy buffering,
- compression buffering,
- writer tidak flush,
- container buffering.

Cek:

- nginx `proxy_buffering off`,
- `X-Accel-Buffering: no`,
- gzip disabled untuk SSE,
- heartbeat terlihat real-time.

### 33.3 Memory Naik Pelan-Pelan

Kemungkinan:

- sink tidak di-unregister,
- registry menyimpan disconnected client,
- queue per connection unbounded,
- connection object menyimpan object graph besar,
- callback menahan reference besar.

Cek:

- metric active connection vs real client,
- heap dump,
- dominator tree untuk `SseEventSink`/connection class,
- close/unregister logs.

### 33.4 Command Endpoint Melambat Saat Banyak Subscriber

Kemungkinan:

- publish SSE dilakukan synchronous dalam transaction/request thread,
- broadcast fan-out besar,
- slow clients memperlambat send.

Solusi:

- outbox/event bus,
- async publisher,
- bounded queue,
- coalescing,
- topic partitioning.

### 33.5 Setelah Deploy, Semua Stream Putus dan UI Error

Normal jika pod restart. Yang perlu dipastikan:

- client auto reconnect,
- endpoint reauthorize,
- missed event strategy jelas,
- UI menampilkan reconnecting state,
- server graceful close best effort.

---

## 34. Design Checklist

Sebelum memakai SSE di production, jawab ini:

### Use Case

- Apakah komunikasi hanya server-to-client?
- Apakah event harus realtime atau cukup polling?
- Apakah event harus durable/replayable?
- Apakah client browser native cukup?

### Security

- Bagaimana auth dilakukan?
- Apakah EventSource bisa membawa credential yang dibutuhkan?
- Apakah authorization dilakukan sebelum register?
- Apakah permission revocation ditangani?
- Apakah payload aman untuk user/topic tersebut?

### Lifecycle

- Siapa menyimpan sink?
- Kapan sink ditutup?
- Bagaimana disconnect terdeteksi?
- Bagaimana cleanup dijamin?
- Apakah ada max lifetime?

### Scaling

- Berapa max connection per pod?
- Berapa max connection per user?
- Bagaimana horizontal scaling?
- Apakah perlu broker/pubsub?
- Apakah event distribution cluster-wide benar?

### Network

- Apakah proxy buffering off?
- Apa idle timeout terendah?
- Berapa heartbeat interval?
- Apakah compression disabled/aman?
- Apakah rolling deploy reconnect tested?

### Reliability

- Apakah event ID ada?
- Apakah `Last-Event-ID` didukung?
- Apakah replay store tersedia?
- Apa policy jika client lambat?
- Apa policy jika queue penuh?

### Observability

- Ada metric active connection?
- Ada metric send failure?
- Ada log subscribe/close?
- Ada event publish metric?
- Payload sensitive dimasking?

---

## 35. Exercises

### Exercise 1 — Basic SSE

Buat endpoint:

```text
GET /time/events
```

Mengirim event waktu server setiap 5 detik selama 1 menit, lalu menutup stream.

Validasi:

- browser menerima event,
- `curl -N` menerima event,
- stream tertutup setelah selesai.

### Exercise 2 — Named Event Bug

Buat server mengirim named event `server-time`. Pasang client hanya dengan `onmessage`. Amati bahwa event tidak diproses oleh handler default. Perbaiki dengan `addEventListener('server-time', ...)`.

Tujuan:

- memahami beda default event dan named event.

### Exercise 3 — Registry Cleanup

Buat registry koneksi. Simulasikan sink failure. Pastikan registry count turun.

Tujuan:

- cleanup invariant.

### Exercise 4 — Heartbeat

Tambahkan heartbeat setiap 25 detik. Uji melalui `curl -N`.

Tujuan:

- melihat comment heartbeat dan menjaga idle connection.

### Exercise 5 — Case Topic

Buat:

```text
GET /cases/{caseId}/events
POST /cases/{caseId}/simulate-status-change
```

Ketika status berubah, hanya subscriber case tersebut yang menerima event.

Tujuan:

- topic partitioning.

### Exercise 6 — Reconnect

Kirim event dengan incremental `id`. Buat client reconnect dan kirim `Last-Event-ID`. Simpan event dalam in-memory list untuk development. Replay event yang missed.

Tujuan:

- memahami bahwa replay butuh event store.

### Exercise 7 — Proxy Simulation

Jalankan aplikasi di belakang nginx. Aktifkan buffering, amati event tertahan. Matikan buffering, amati event realtime.

Tujuan:

- memahami bahwa SSE bug sering ada di network path.

---

## 36. Key Takeaways

1. SSE adalah **HTTP server push satu arah**, bukan message queue.
2. Jersey mendukung SSE melalui API standar `Sse`, `SseEventSink`, `SseBroadcaster`, dan `SseEventSource`.
3. `SseEventSink` adalah resource mahal seperti socket; harus ada cleanup strategy.
4. Heartbeat dibutuhkan karena proxy/load balancer sering memutus idle connection.
5. `Last-Event-ID` hanya berguna jika server punya event store/replay mechanism.
6. Broadcast global sederhana tidak cukup untuk enterprise; butuh topic/user/tenant-aware registry.
7. Horizontal scaling membutuhkan pubsub/event distribution karena sink hanya hidup di pod lokal.
8. Proxy buffering adalah penyebab klasik “SSE tidak realtime”.
9. Streaming error setelah header terkirim tidak bisa dipetakan seperti error REST biasa.
10. Untuk long-running job, pisahkan command, progress stream, status endpoint, dan download.
11. Untuk regulatory/case management, SSE adalah observation channel; command tetap REST biasa dengan audit dan authorization kuat.
12. Virtual threads tidak menghapus kebutuhan limit, cleanup, back-pressure, dan observability.

---

## 37. Jembatan ke Part Berikutnya

Part berikutnya adalah:

```text
Part 17 — Multipart, File Upload, Download, and Large Payload Engineering
```

Kita akan pindah dari streaming event kecil ke payload besar:

- multipart upload,
- file metadata + binary content,
- memory threshold,
- temp file handling,
- size limit,
- MIME validation,
- antivirus scanning pattern,
- hashing,
- download streaming,
- range request discussion,
- path traversal,
- zip bomb,
- untrusted filename,
- auditability.

SSE dan `StreamingOutput` memberi fondasi penting: body HTTP tidak selalu kecil, tidak selalu langsung selesai, dan tidak selalu aman jika lifecycle resource tidak dikendalikan.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 15 — Async Server Processing: `AsyncResponse`, Suspension, Timeout, and Cancellation](./15-async-server-processing-asyncresponse-suspension-timeout-cancellation.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 17 — Multipart, File Upload, Download, and Large Payload Engineering](./17-multipart-file-upload-download-large-payload-engineering.md)
