# Part 6 — Entity Provider Pipeline: `MessageBodyReader`, `MessageBodyWriter`, and Provider Selection

> Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
> File: `06-entity-provider-pipeline-messagebodyreader-messagebodywriter-provider-selection.md`  
> Scope: Java 8 sampai Java 25, Jersey 2.x/3.x/4.x, JAX-RS/Jakarta REST entity provider pipeline  
> Prasyarat: sudah memahami JAX-RS/Jakarta REST dasar, resource matching, parameter injection, `@Consumes`, `@Produces`, dan HTTP media type negotiation.

---

## 0. Posisi Bagian Ini Dalam Seri

Pada part sebelumnya kita membahas **parameter injection**: bagaimana Jersey mengubah bagian-bagian request seperti path, query, header, cookie, matrix, dan form parameter menjadi nilai Java.

Bagian ini membahas boundary yang lebih besar:

```text
HTTP entity body  <->  Java object
```

Inilah wilayah kerja utama:

- `MessageBodyReader<T>` untuk membaca request body menjadi object Java.
- `MessageBodyWriter<T>` untuk menulis object Java menjadi response body.
- Provider selection untuk memilih reader/writer yang tepat.
- Media type matching untuk `Content-Type`, `Accept`, `@Consumes`, dan `@Produces`.
- Generic type handling untuk `List<Foo>`, `Map<String, Foo>`, wrapper response, stream, dan custom container.
- Registration dan priority untuk menghindari konflik provider.
- Failure mode production seperti:
  - `MessageBodyProviderNotFoundException`
  - `No MessageBodyReader found`
  - `No MessageBodyWriter found`
  - entity stream already consumed
  - JSON provider bentrok
  - generic type hilang karena type erasure
  - response serialization gagal setelah status code dianggap sukses

Materi ini bukan pengulangan JSON/Jackson dasar. JSON akan dibahas lebih dalam pada Part 7. Di sini kita membangun mental model pipeline entity Jersey secara umum.

---

## 1. Inti Mental Model

Ketika request masuk ke resource method Jersey, ada dua dunia yang harus dijembatani:

```text
Dunia HTTP:
- method
- URI
- headers
- media type
- bytes stream

Dunia Java:
- resource method
- parameter object
- DTO
- generic type
- annotations
- exception
- response object
```

Untuk bagian entity body, Jersey tidak otomatis “tahu” cara membaca semua byte menjadi object. Ia memakai **provider**.

Provider adalah komponen extension yang mengajari runtime:

```text
Untuk media type X dan Java type Y,
bagaimana body dibaca atau ditulis?
```

Contoh:

```text
application/json + CreateOrderRequest.class
  -> JacksonJsonProvider / JsonBindingProvider / custom JSON provider

text/plain + String.class
  -> String provider

application/octet-stream + byte[].class
  -> byte array provider

application/xml + Customer.class
  -> JAXB / XML provider

multipart/form-data + FormDataMultiPart
  -> multipart provider
```

Jersey tidak hanya melakukan `objectMapper.readValue(...)` secara langsung. Jersey memilih provider berdasarkan kombinasi:

```text
Java type
Generic type
Annotations
Media type
Runtime side: server/client
Direction: read/write
Provider priority
Provider registration source
```

Jadi, kalau ada error body mapping, jangan langsung menyalahkan Jackson. Bisa jadi problemnya ada di:

- resource method signature,
- `@Consumes`,
- `@Produces`,
- `Content-Type`,
- `Accept`,
- provider belum ter-register,
- provider ter-register tetapi kalah priority,
- generic type hilang,
- stream sudah dibaca filter,
- dependency namespace `javax` vs `jakarta` bentrok,
- atau provider hanya tersedia di server tetapi tidak di client.

---

## 2. Pipeline Besar Request dan Response

### 2.1 Request Body Pipeline

Untuk resource method seperti ini:

```java
@POST
@Path("/orders")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response createOrder(CreateOrderRequest request) {
    OrderResult result = orderService.create(request);
    return Response.status(Response.Status.CREATED).entity(result).build();
}
```

Request body pipeline-nya secara konseptual:

```text
Client sends bytes
  |
  v
HTTP request arrives at container
  |
  v
Jersey matches resource method
  |
  v
Jersey sees entity parameter: CreateOrderRequest
  |
  v
Jersey checks Content-Type: application/json
  |
  v
Jersey selects MessageBodyReader<CreateOrderRequest>
  |
  v
Reader consumes InputStream
  |
  v
CreateOrderRequest object created
  |
  v
Validation may run
  |
  v
Resource method invoked
```

Yang penting: resource method **belum dipanggil** sampai entity parameter berhasil dibaca.

Kalau JSON invalid, class tidak bisa dibuat, atau reader tidak ditemukan, failure terjadi sebelum business logic jalan.

### 2.2 Response Body Pipeline

Setelah resource method mengembalikan object:

```text
Resource method returns Response/entity
  |
  v
Jersey determines response entity type
  |
  v
Jersey determines response media type
  |
  v
Jersey selects MessageBodyWriter<T>
  |
  v
Writer serializes Java object to OutputStream
  |
  v
Bytes sent to client
```

Kalau writer gagal, resource method sebenarnya sudah selesai, tetapi response belum sukses terkirim secara penuh.

Ini penting untuk observability: log “method completed” belum tentu berarti response berhasil dikirim.

---

## 3. Dua Interface Kunci

### 3.1 `MessageBodyReader<T>`

Dalam Jakarta REST modern, bentuk dasarnya:

```java
@Provider
@Consumes(MediaType.APPLICATION_JSON)
public class MyDtoReader implements MessageBodyReader<MyDto> {

    @Override
    public boolean isReadable(
            Class<?> type,
            Type genericType,
            Annotation[] annotations,
            MediaType mediaType) {
        return MyDto.class.isAssignableFrom(type);
    }

    @Override
    public MyDto readFrom(
            Class<MyDto> type,
            Type genericType,
            Annotation[] annotations,
            MediaType mediaType,
            MultivaluedMap<String, String> httpHeaders,
            InputStream entityStream) throws IOException {

        // Convert bytes from entityStream into MyDto
        return parse(entityStream);
    }
}
```

`MessageBodyReader` bertugas mengubah:

```text
InputStream + metadata -> Java object
```

Parameter penting:

| Parameter | Makna |
|---|---|
| `Class<?> type` | Raw class target. Untuk `List<Order>`, nilainya biasanya `List.class`. |
| `Type genericType` | Generic type penuh jika tersedia. Untuk `List<Order>`, bisa berupa `ParameterizedType`. |
| `Annotation[] annotations` | Annotation di parameter/entity target. Berguna untuk custom behavior. |
| `MediaType mediaType` | Media type request body berdasarkan `Content-Type`. |
| `httpHeaders` | Header request. |
| `InputStream entityStream` | Stream bytes request body. |

Hal yang sering diremehkan: `type` dan `genericType` bukan hal yang sama.

Contoh:

```java
public Response bulkCreate(List<CreateOrderRequest> requests) { ... }
```

Runtime dapat melihat:

```text
type        = java.util.List
genericType = java.util.List<CreateOrderRequest>
```

Kalau provider hanya melihat `type`, ia tahu ini `List`, tetapi tidak tahu elemen di dalamnya `CreateOrderRequest`.

### 3.2 `MessageBodyWriter<T>`

Bentuk konseptual:

```java
@Provider
@Produces(MediaType.APPLICATION_JSON)
public class MyDtoWriter implements MessageBodyWriter<MyDto> {

    @Override
    public boolean isWriteable(
            Class<?> type,
            Type genericType,
            Annotation[] annotations,
            MediaType mediaType) {
        return MyDto.class.isAssignableFrom(type);
    }

    @Override
    public void writeTo(
            MyDto value,
            Class<?> type,
            Type genericType,
            Annotation[] annotations,
            MediaType mediaType,
            MultivaluedMap<String, Object> httpHeaders,
            OutputStream entityStream) throws IOException {

        // Convert value into bytes and write to entityStream
        serialize(value, entityStream);
    }
}
```

Writer mengubah:

```text
Java object + metadata -> OutputStream
```

Writer biasanya juga bisa mengubah header response, misalnya:

```java
httpHeaders.putSingle(HttpHeaders.CONTENT_TYPE, mediaType.toString());
```

Tetapi dalam desain production, jangan terlalu sering membuat writer yang diam-diam mengubah header global. Itu membuat behavior response sulit diprediksi.

---

## 4. Entity Body vs Parameter Injection

Penting membedakan dua jenis input resource method:

```java
@POST
@Path("/orders/{id}")
public Response update(
        @PathParam("id") String id,
        @HeaderParam("X-Request-Id") String requestId,
        UpdateOrderRequest body) {
    ...
}
```

Yang terjadi:

```text
@PathParam       -> parameter injection
@HeaderParam     -> parameter injection
UpdateOrderRequest tanpa annotation -> entity body reader
```

Dalam JAX-RS/Jakarta REST, biasanya hanya ada satu unannotated entity parameter.

Mental model:

```text
Annotated parameter  -> extracted from request metadata
Unannotated parameter -> extracted from entity body
```

Jika kamu punya dua unannotated parameter seperti:

```java
public Response bad(CreateOrderRequest request, AuditContext audit) { ... }
```

Itu desain yang salah untuk Jersey. Jersey tidak punya dua body. `AuditContext` harus berasal dari injection/context, bukan body parameter kedua.

Desain yang lebih benar:

```java
public Response create(
        CreateOrderRequest request,
        @Context SecurityContext securityContext,
        @Context HttpHeaders headers) {
    ...
}
```

Atau context khusus:

```java
public Response create(
        CreateOrderRequest request,
        @Context RequestContext requestContext) {
    ...
}
```

---

## 5. Provider Selection: Algoritma Mental

Provider selection terlihat sederhana, tetapi di production sering menjadi sumber bug halus.

Secara mental, Jersey memilih reader/writer kira-kira dengan tahapan:

```text
1. Tentukan direction
   - read request body?
   - write response body?

2. Tentukan Java target/source type
   - Class<?> type
   - Type genericType

3. Tentukan media type
   - request read: Content-Type
   - response write: selected response media type from @Produces/Accept/Response

4. Ambil provider yang media type-nya cocok
   - @Consumes untuk reader
   - @Produces untuk writer

5. Panggil isReadable/isWriteable

6. Urutkan berdasarkan priority dan specificity

7. Pilih satu provider

8. Jalankan readFrom/writeTo
```

Salah satu kesalahan berpikir umum:

> “Saya sudah punya Jackson di classpath, jadi otomatis semua JSON akan jalan.”

Belum tentu.

Pertanyaan yang harus dijawab:

```text
Apakah provider Jackson-nya compatible dengan Jersey version?
Apakah provider memakai javax atau jakarta namespace yang sama?
Apakah provider ter-register?
Apakah media type cocok?
Apakah type target bisa dibaca?
Apakah provider kalah dari provider lain?
Apakah object bisa di-deserialize oleh Jackson?
```

---

## 6. Media Type Matching Dalam Entity Provider

### 6.1 Reader Side: `Content-Type` dan `@Consumes`

Untuk request body:

```http
POST /orders HTTP/1.1
Content-Type: application/json

{"productId":"P001","quantity":2}
```

Resource:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateOrderRequest request) { ... }
```

Jersey harus menemukan reader yang dapat membaca:

```text
Java target: CreateOrderRequest
Media type : application/json
```

Kalau request mengirim:

```http
Content-Type: text/plain
```

Padahal method hanya consume JSON, failure biasanya terjadi sebagai `415 Unsupported Media Type` sebelum reader dipilih.

Kalau method menerima media type tersebut tetapi reader tidak ada, error-nya bisa menjadi provider-not-found.

### 6.2 Writer Side: `Accept`, `@Produces`, dan Response Media Type

Untuk response:

```http
GET /orders/123 HTTP/1.1
Accept: application/json
```

Resource:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public OrderDto getOrder() { ... }
```

Jersey memilih writer untuk:

```text
Java source: OrderDto
Media type : application/json
```

Kalau client mengirim:

```http
Accept: application/xml
```

sementara resource hanya produce JSON, bisa muncul `406 Not Acceptable`.

Kalau resource bisa produce JSON tetapi tidak ada writer JSON untuk `OrderDto`, muncul writer-not-found atau serialization failure.

### 6.3 Custom Media Type

Contoh vendor media type:

```java
@Produces("application/vnd.company.order.v1+json")
```

Banyak JSON provider bisa menangani `application/*+json`, tetapi tidak semua konfigurasi provider memperlakukan vendor media type sama.

Untuk API versioning via media type, kamu harus menguji:

```text
application/json
application/vnd.company.order.v1+json
application/problem+json
```

Jangan asumsi semua provider otomatis mendukung suffix `+json` secara sama.

---

## 7. Built-in Provider vs Extension Provider

Jersey/Jakarta REST biasanya menyediakan provider bawaan untuk tipe umum.

Contoh tipe umum:

```text
String
byte[]
InputStream
Reader
File
StreamingOutput
MultivaluedMap form
```

Namun provider untuk JSON/XML/multipart bergantung pada module/dependency yang kamu pasang dan registrasi.

Contoh dependency strategy konseptual:

```text
Jersey core
  -> routing, resource model, provider abstraction

Jersey media JSON module
  -> JSON provider integration

Jersey multipart module
  -> multipart provider

Jackson/Jakarta JSON Binding/JAXB module
  -> actual serialization engine
```

Mental model production:

```text
Jersey tidak sama dengan Jackson.
Jackson tidak sama dengan Jersey provider.
Classpath tidak sama dengan registered provider.
Registered provider tidak sama dengan selected provider.
Selected provider tidak sama dengan successful serialization.
```

---

## 8. Registration Model

Provider bisa didaftarkan melalui beberapa cara.

### 8.1 Annotation Scanning dengan `@Provider`

```java
@Provider
@Consumes(MediaType.APPLICATION_JSON)
public class AuditEventReader implements MessageBodyReader<AuditEvent> {
    ...
}
```

Jika package scanning aktif dan class ini berada di package yang discan, Jersey bisa menemukannya.

Kelebihan:

- simple,
- convenient,
- cocok untuk aplikasi kecil/menengah.

Kekurangan:

- startup kurang deterministik,
- sulit melihat provider graph,
- rawan accidental registration,
- rawan berbeda antara test dan production jika scanning package berbeda.

### 8.2 Explicit Registration di `ResourceConfig`

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(OrderResource.class);
        register(AuditEventReader.class);
        register(AuditEventWriter.class);
    }
}
```

Kelebihan:

- deterministik,
- mudah direview,
- cocok untuk platform internal,
- cocok untuk migration.

Kekurangan:

- lebih verbose,
- perlu disiplin.

Untuk enterprise, explicit registration biasanya lebih sehat.

### 8.3 Register Instance

```java
ObjectMapper mapper = configuredMapper();
register(new JacksonJsonProvider(mapper));
```

Register instance berguna kalau provider butuh object yang sudah dikonfigurasi.

Tapi hati-hati:

```text
Instance provider biasanya singleton-like.
Jangan simpan request-specific mutable state di field provider.
```

Provider harus thread-safe.

### 8.4 Client Side Registration

Provider server dan client tidak otomatis sama.

```java
Client client = ClientBuilder.newBuilder()
        .register(MyJsonProvider.class)
        .build();
```

Jika server bisa serialize object, belum tentu client bisa deserialize response yang sama.

Production rule:

```text
Treat server provider registry and client provider registry as two separate runtimes.
```

---

## 9. Priority dan Conflict Resolution

Provider bisa diberi priority:

```java
@Provider
@Priority(Priorities.ENTITY_CODER)
@Produces(MediaType.APPLICATION_JSON)
public class CustomJsonWriter implements MessageBodyWriter<Object> {
    ...
}
```

Namun semakin generic provider kamu, semakin besar risiko shadowing.

Contoh provider berbahaya:

```java
@Provider
@Produces(MediaType.APPLICATION_JSON)
public class CatchAllJsonWriter implements MessageBodyWriter<Object> {
    @Override
    public boolean isWriteable(Class<?> type, Type genericType,
                               Annotation[] annotations, MediaType mediaType) {
        return true;
    }

    @Override
    public void writeTo(Object value, Class<?> type, Type genericType,
                        Annotation[] annotations, MediaType mediaType,
                        MultivaluedMap<String, Object> headers,
                        OutputStream out) throws IOException {
        // custom serialization
    }
}
```

Problem:

```text
Provider ini bisa mengambil alih semua JSON response.
Jackson provider mungkin tidak pernah dipakai.
Error shape mungkin berubah.
Lazy entity mungkin terserialisasi salah.
Performance mungkin turun.
```

Provider generic hanya boleh dibuat jika kamu benar-benar sedang membangun platform serialization layer.

Desain lebih aman:

```java
@Provider
@Produces("application/audit-event+json")
public class AuditEventWriter implements MessageBodyWriter<AuditEvent> {
    @Override
    public boolean isWriteable(Class<?> type, Type genericType,
                               Annotation[] annotations, MediaType mediaType) {
        return AuditEvent.class.isAssignableFrom(type);
    }
}
```

Specific provider lebih defensible.

---

## 10. Generic Type Handling

### 10.1 Problem Type Erasure

Java generic hilang di runtime jika tidak dipertahankan sebagai `Type`.

Contoh response buruk:

```java
@GET
public Response listOrders() {
    List<OrderDto> orders = orderService.list();
    return Response.ok(orders).build();
}
```

Runtime mungkin hanya melihat:

```text
entity class = java.util.ArrayList
```

Banyak JSON provider masih bisa menulis list karena elemen object ada runtime class-nya. Tapi untuk beberapa scenario, terutama deserialization atau generic wrapper, informasi type bisa kurang.

### 10.2 `GenericEntity`

Untuk mempertahankan generic type pada response:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public Response listOrders() {
    List<OrderDto> orders = orderService.list();

    GenericEntity<List<OrderDto>> entity =
            new GenericEntity<List<OrderDto>>(orders) {};

    return Response.ok(entity).build();
}
```

Mental model:

```text
GenericEntity membawa Type penuh agar writer tahu entity bukan hanya List,
tetapi List<OrderDto>.
```

### 10.3 Client Side Generic Type

Saat membaca response client:

```java
List<OrderDto> orders = response.readEntity(new GenericType<List<OrderDto>>() {});
```

Tanpa `GenericType`, kamu sering berakhir dengan:

```text
List<LinkedHashMap>
```

atau mapping yang tidak sesuai.

### 10.4 Custom Wrapper

Misal API response envelope:

```java
public final class ApiResponse<T> {
    private T data;
    private Meta meta;
}
```

Jika endpoint:

```java
public ApiResponse<List<OrderDto>> list() { ... }
```

Provider harus menerima `genericType` agar tahu `T` adalah `List<OrderDto>`.

Jika custom provider mengabaikan `genericType`, generic wrapper sering gagal.

---

## 11. Entity Stream Lifecycle

Entity body adalah stream. Stream punya sifat:

```text
- sekali baca
- forward-only
- bisa besar
- bisa belum selesai datang
- bisa gagal di tengah
- bisa menahan koneksi
```

### 11.1 Request Body Stream Bisa Habis Dibaca

Filter yang membaca body:

```java
@Provider
public class BadLoggingFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext context) throws IOException {
        String body = new String(context.getEntityStream().readAllBytes(), StandardCharsets.UTF_8);
        log.info("body={}", body);
    }
}
```

Problem:

```text
Reader berikutnya menerima stream yang sudah habis.
Resource body menjadi kosong.
JSON provider gagal membaca.
```

Perbaikan minimal:

```java
byte[] bytes = context.getEntityStream().readAllBytes();
log.info("body={}", mask(bytes));
context.setEntityStream(new ByteArrayInputStream(bytes));
```

Tapi ini juga punya risiko:

```text
- OOM untuk body besar
- sensitive data leakage
- performance drop
- double buffering
```

Production rule:

```text
Jangan log full body secara default.
Jika harus, batasi ukuran, masking, sampling, dan hanya di environment aman.
```

### 11.2 Response Stream Bisa Gagal Setelah Header

Writer menulis ke output stream. Jika streaming response besar gagal di tengah:

```text
status code mungkin sudah terkirim,
body partial,
exception mapper mungkin tidak bisa lagi mengubah response.
```

Ini memengaruhi desain file download, export, SSE, dan large payload.

---

## 12. Custom Reader: Contoh Realistis

Misal sistem menerima event internal dengan media type khusus:

```http
Content-Type: application/vnd.company.audit-event+json
```

DTO:

```java
public final class AuditEvent {
    private final String eventId;
    private final String actorId;
    private final String action;
    private final Instant occurredAt;

    public AuditEvent(String eventId, String actorId, String action, Instant occurredAt) {
        this.eventId = eventId;
        this.actorId = actorId;
        this.action = action;
        this.occurredAt = occurredAt;
    }

    public String eventId() { return eventId; }
    public String actorId() { return actorId; }
    public String action() { return action; }
    public Instant occurredAt() { return occurredAt; }
}
```

Reader:

```java
@Provider
@Consumes("application/vnd.company.audit-event+json")
public final class AuditEventReader implements MessageBodyReader<AuditEvent> {

    private final ObjectMapper mapper;

    public AuditEventReader() {
        this.mapper = new ObjectMapper().registerModule(new JavaTimeModule());
    }

    @Override
    public boolean isReadable(Class<?> type,
                              Type genericType,
                              Annotation[] annotations,
                              MediaType mediaType) {
        return AuditEvent.class.isAssignableFrom(type);
    }

    @Override
    public AuditEvent readFrom(Class<AuditEvent> type,
                               Type genericType,
                               Annotation[] annotations,
                               MediaType mediaType,
                               MultivaluedMap<String, String> httpHeaders,
                               InputStream entityStream) throws IOException {
        try {
            AuditEventPayload payload = mapper.readValue(entityStream, AuditEventPayload.class);
            return new AuditEvent(
                    payload.eventId,
                    payload.actorId,
                    payload.action,
                    Instant.parse(payload.occurredAt)
            );
        } catch (JsonProcessingException ex) {
            throw new BadRequestException("Invalid audit event payload", ex);
        }
    }

    private static final class AuditEventPayload {
        public String eventId;
        public String actorId;
        public String action;
        public String occurredAt;
    }
}
```

Catatan desain:

```text
- Reader specific ke AuditEvent.
- Media type specific.
- Parsing exception dipetakan menjadi BadRequestException.
- Tidak menyimpan mutable request state di field.
- ObjectMapper reusable dan thread-safe setelah konfigurasi selesai.
```

Namun untuk JSON umum, biasanya lebih baik memakai Jackson provider global daripada menulis reader sendiri untuk setiap DTO.

Custom reader masuk akal jika:

```text
- format bukan JSON standar,
- ada media type khusus,
- ada decoding/signature/compression domain-specific,
- ada legacy payload,
- perlu validasi format rendah sebelum masuk DTO,
- perlu mapping dari external representation ke domain-safe representation.
```

---

## 13. Custom Writer: Contoh Realistis

Misal ingin menulis `AuditEvent` ke media type khusus:

```java
@Provider
@Produces("application/vnd.company.audit-event+json")
public final class AuditEventWriter implements MessageBodyWriter<AuditEvent> {

    private final ObjectMapper mapper;

    public AuditEventWriter() {
        this.mapper = new ObjectMapper().registerModule(new JavaTimeModule());
    }

    @Override
    public boolean isWriteable(Class<?> type,
                               Type genericType,
                               Annotation[] annotations,
                               MediaType mediaType) {
        return AuditEvent.class.isAssignableFrom(type);
    }

    @Override
    public void writeTo(AuditEvent value,
                        Class<?> type,
                        Type genericType,
                        Annotation[] annotations,
                        MediaType mediaType,
                        MultivaluedMap<String, Object> httpHeaders,
                        OutputStream entityStream) throws IOException {

        httpHeaders.putSingle(HttpHeaders.CONTENT_TYPE, mediaType.toString());

        AuditEventPayload payload = new AuditEventPayload();
        payload.eventId = value.eventId();
        payload.actorId = value.actorId();
        payload.action = value.action();
        payload.occurredAt = value.occurredAt().toString();

        mapper.writeValue(entityStream, payload);
    }

    private static final class AuditEventPayload {
        public String eventId;
        public String actorId;
        public String action;
        public String occurredAt;
    }
}
```

Jangan lakukan ini:

```java
public boolean isWriteable(...) {
    return true;
}
```

kecuali kamu memang sedang membangun global serialization policy.

---

## 14. Provider dengan Annotation-Aware Behavior

`Annotation[] annotations` berguna untuk behavior khusus.

Contoh annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.PARAMETER, ElementType.METHOD})
public @interface CompactJson {
}
```

Resource:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
@CompactJson
public OrderDto getCompactOrder() {
    return service.getCompactOrder();
}
```

Writer bisa membaca annotation:

```java
private boolean hasCompactJson(Annotation[] annotations) {
    for (Annotation annotation : annotations) {
        if (annotation.annotationType() == CompactJson.class) {
            return true;
        }
    }
    return false;
}
```

Namun hati-hati: annotation-aware provider bisa membuat behavior response sulit ditebak jika terlalu banyak variasi.

Gunakan untuk kasus seperti:

```text
- compact vs detailed representation,
- signed payload,
- encrypted field representation,
- legacy compatibility mode,
- alternate date/time format untuk endpoint tertentu.
```

Tapi jangan jadikan annotation-aware provider sebagai pengganti API versioning yang jelas.

---

## 15. Provider dan Exception Handling

### 15.1 Reader Failure

Jika `readFrom` gagal karena input client invalid, mapping yang benar biasanya `400 Bad Request`.

Contoh:

```java
throw new BadRequestException("Invalid JSON payload", ex);
```

Jangan leak detail parser yang terlalu teknis:

```text
Unexpected character ('}' (code 125)): was expecting double-quote to start field name at [Source: ...]
```

Untuk production, error response bisa:

```json
{
  "errorCode": "INVALID_REQUEST_BODY",
  "message": "Request body is malformed or does not match the expected schema.",
  "correlationId": "..."
}
```

Detail teknis cukup masuk log internal dengan correlation ID.

### 15.2 Writer Failure

Writer failure lebih tricky.

Jika serialization gagal sebelum response committed, exception mapper masih bisa mengubah response. Tetapi jika output sudah partial terkirim, sudah terlambat.

Contoh penyebab writer failure:

```text
- circular reference,
- lazy proxy initialization failure,
- closed stream,
- client disconnected,
- custom serializer exception,
- object graph terlalu besar,
- unsupported type,
- date/time module belum terdaftar.
```

Production rule:

```text
Serialization failure adalah bug server, kecuali disebabkan client disconnect.
```

Jangan mapping semua writer exception menjadi 400.

---

## 16. Common Failure Mode: No MessageBodyReader Found

Contoh error:

```text
MessageBodyProviderNotFoundException: MessageBodyReader not found for media type=application/json,
type=class com.company.CreateOrderRequest,
genericType=class com.company.CreateOrderRequest
```

Diagnosis checklist:

```text
1. Apakah request punya Content-Type?
2. Apakah Content-Type sesuai @Consumes?
3. Apakah JSON provider dependency ada?
4. Apakah provider namespace cocok? javax vs jakarta?
5. Apakah provider ter-register?
6. Apakah provider mendukung media type tersebut?
7. Apakah resource method entity parameter benar?
8. Apakah class DTO bisa dibuat?
9. Apakah stream sudah dibaca filter sebelum reader?
10. Apakah test environment beda dari production registry?
```

Contoh penyebab 1: Tidak ada `Content-Type`.

```http
POST /orders

{"productId":"P001"}
```

Sebagian server bisa default ke `application/octet-stream`, bukan JSON.

Perbaikan:

```http
Content-Type: application/json
```

Contoh penyebab 2: Dependency provider salah namespace.

```text
Aplikasi Jersey 3.x/4.x memakai jakarta.ws.rs.*
Tapi provider library masih javax.ws.rs.*
```

Hasilnya provider tampak ada di classpath, tapi bukan provider untuk runtime Jakarta.

Contoh penyebab 3: Provider tidak didaftarkan.

Perbaikan konseptual:

```java
register(JacksonFeature.class);
```

atau provider yang sesuai dengan versi Jersey yang digunakan.

---

## 17. Common Failure Mode: No MessageBodyWriter Found

Contoh:

```text
MessageBodyWriter not found for media type=application/json,
type=class com.company.OrderResult,
genericType=class com.company.OrderResult
```

Diagnosis checklist:

```text
1. Apakah resource menghasilkan entity non-null?
2. Apakah selected media type jelas?
3. Apakah @Produces sesuai Accept request?
4. Apakah JSON/XML provider tersedia?
5. Apakah DTO bisa diserialize?
6. Apakah return type terlalu abstrak?
7. Apakah response entity generic kehilangan type?
8. Apakah custom writer shadowing provider default?
9. Apakah media type vendor +json didukung?
10. Apakah provider hanya terdaftar di client, bukan server?
```

Contoh return type raw:

```java
@GET
public Object get() {
    return service.getSomething();
}
```

Ini membuat provider selection dan contract API kurang jelas.

Lebih baik:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public OrderDto get() {
    return service.getOrder();
}
```

atau:

```java
public Response get() {
    OrderDto dto = service.getOrder();
    return Response.ok(dto, MediaType.APPLICATION_JSON_TYPE).build();
}
```

---

## 18. DTO Shape dan Provider Pipeline

Provider bisa membaca/menulis body hanya jika serialization engine bisa memahami DTO.

### 18.1 Java 8 Style DTO

```java
public class CreateOrderRequest {
    private String productId;
    private int quantity;

    public CreateOrderRequest() {
    }

    public String getProductId() { return productId; }
    public void setProductId(String productId) { this.productId = productId; }

    public int getQuantity() { return quantity; }
    public void setQuantity(int quantity) { this.quantity = quantity; }
}
```

Kelebihan:

```text
- compatible dengan banyak provider lama,
- mudah untuk Java 8,
- sedikit konfigurasi.
```

Kekurangan:

```text
- mutable,
- primitive default trap,
- invariants mudah dilanggar,
- object bisa dalam state setengah valid.
```

### 18.2 Java 16+ Record DTO

```java
public record CreateOrderRequest(
        String productId,
        Integer quantity
) {}
```

Kelebihan:

```text
- immutable,
- concise,
- cocok sebagai API DTO,
- constructor jelas.
```

Kekurangan:

```text
- butuh provider/serialization engine yang mendukung record,
- tidak untuk Java 8,
- validation harus jelas di component/constructor.
```

### 18.3 Sealed Type dan Polymorphism

```java
public sealed interface PaymentRequest permits CardPaymentRequest, BankTransferPaymentRequest {
}
```

Ini powerful, tetapi untuk JSON polymorphic mapping harus hati-hati:

```text
- type discriminator harus eksplisit,
- jangan aktifkan unsafe default typing,
- jangan expose class name internal,
- pastikan unknown subtype gagal aman.
```

Provider pipeline hanya pintu masuk; keamanan polymorphism ada pada JSON provider config.

---

## 19. Null Entity dan Empty Body

### 19.1 Request Empty Body

Resource:

```java
@POST
public Response create(CreateOrderRequest request) { ... }
```

Request:

```http
POST /orders
Content-Type: application/json
Content-Length: 0
```

Pertanyaan:

```text
Apakah request null?
Apakah reader dipanggil?
Apakah invalid JSON?
Apakah boleh empty body?
```

Behavior bisa bergantung provider dan spec interpretation. Desain API sebaiknya eksplisit:

```text
Endpoint command dengan body wajib -> empty body adalah 400.
Endpoint action tanpa body -> jangan deklarasikan entity parameter.
```

Buruk:

```java
@POST
@Path("/orders/recalculate")
public Response recalculate(RecalculateRequest maybeEmpty) { ... }
```

Lebih jelas jika memang tidak perlu body:

```java
@POST
@Path("/orders/recalculate")
public Response recalculate() { ... }
```

atau jika perlu body:

```java
public Response recalculate(@Valid RecalculateRequest request) { ... }
```

dan validasi `request != null`.

### 19.2 Response Null Entity

```java
return Response.ok(null).build();
```

Ini ambigu.

Apakah maksudnya:

```text
- 200 dengan body JSON null?
- 204 No Content?
- resource not found?
```

Lebih defensible:

```java
return Response.noContent().build();
```

atau:

```java
throw new NotFoundException();
```

atau:

```java
return Response.ok(new ApiResponse<>(null)).build();
```

tergantung contract.

---

## 20. Form, Binary, Stream, dan File Entity

Entity provider tidak hanya JSON.

### 20.1 Text Plain

```java
@POST
@Consumes(MediaType.TEXT_PLAIN)
public Response submit(String text) { ... }
```

Ini memakai provider `String`.

### 20.2 Binary

```java
@POST
@Consumes(MediaType.APPLICATION_OCTET_STREAM)
public Response upload(byte[] bytes) { ... }
```

Problem:

```text
byte[] berarti semua body masuk memory.
```

Untuk payload besar:

```java
public Response upload(InputStream input) { ... }
```

Tapi dengan `InputStream`, kamu bertanggung jawab membaca stream dengan benar, limit ukuran, hashing, dan cleanup.

### 20.3 StreamingOutput

Untuk response besar:

```java
@GET
@Path("/export")
public Response export() {
    StreamingOutput stream = output -> {
        exportService.writeCsv(output);
    };

    return Response.ok(stream, "text/csv")
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=orders.csv")
            .build();
}
```

Ini menghindari membangun seluruh file di memory.

Risiko:

```text
- exception terjadi saat streaming,
- client disconnect,
- transaction tidak boleh dibiarkan terbuka terlalu lama,
- resource DB harus ditutup,
- output bisa dibuffer proxy.
```

### 20.4 Multipart

Multipart biasanya butuh Jersey media multipart module.

Pipeline-nya masih provider, tetapi parsing multipart punya risiko khusus:

```text
- temp file,
- memory threshold,
- filename tidak trusted,
- MIME spoofing,
- size limit,
- virus scanning,
- zip bomb.
```

Multipart akan dibahas lebih detail di Part 17.

---

## 21. Reader/Writer dan Validation Order

Urutan umum:

```text
1. Jersey memilih resource method.
2. Jersey membaca entity body menjadi object.
3. Bean Validation dapat berjalan pada object/parameter.
4. Resource method dipanggil.
```

Artinya:

```text
Validation tidak bisa berjalan jika body gagal dibaca.
```

Contoh:

```java
public record CreateOrderRequest(
        @NotBlank String productId,
        @Min(1) Integer quantity
) {}
```

Jika JSON malformed:

```json
{"productId": "P001", "quantity": }
```

Failure terjadi di reader/deserializer, bukan Bean Validation.

Jika JSON valid tapi value invalid:

```json
{"productId": "", "quantity": 0}
```

Failure terjadi di Bean Validation.

Error contract sebaiknya membedakan:

```text
INVALID_REQUEST_BODY       -> body tidak bisa dibaca/parsing gagal
VALIDATION_FAILED          -> body bisa dibaca tapi melanggar constraint
UNSUPPORTED_MEDIA_TYPE     -> Content-Type tidak didukung
NOT_ACCEPTABLE             -> Accept tidak bisa dipenuhi
```

---

## 22. Provider Pipeline di Server vs Client

### 22.1 Server Read/Write

Server side:

```text
request body  -> reader -> resource parameter
resource return -> writer -> response body
```

### 22.2 Client Write/Read

Client side:

```text
request entity object -> writer -> outbound request body
response body -> reader -> client object
```

Contoh:

```java
Client client = ClientBuilder.newClient();

CreateOrderRequest request = new CreateOrderRequest("P001", 2);

OrderResult result = client
        .target("https://api.example.com/orders")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .post(Entity.entity(request, MediaType.APPLICATION_JSON_TYPE), OrderResult.class);
```

Pipeline client:

```text
CreateOrderRequest
  -> MessageBodyWriter<CreateOrderRequest>
  -> HTTP request bytes
  -> remote server
  -> HTTP response bytes
  -> MessageBodyReader<OrderResult>
  -> OrderResult
```

Jika client tidak punya JSON provider, request bisa gagal sebelum dikirim atau response gagal saat `readEntity`.

Production rule:

```text
Client factory harus mendaftarkan provider yang sama-sama distandarkan oleh platform.
Jangan membuat ClientBuilder.newClient() acak di banyak tempat.
```

---

## 23. Designing Provider Registry Untuk Enterprise

Untuk aplikasi besar, provider registry perlu diperlakukan sebagai runtime contract.

Contoh struktur:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication(AppConfig config) {
        registerResources();
        registerCoreProviders(config);
        registerSecurityProviders(config);
        registerSerializationProviders(config);
        registerObservabilityProviders(config);
    }

    private void registerResources() {
        register(OrderResource.class);
        register(CustomerResource.class);
    }

    private void registerSerializationProviders(AppConfig config) {
        register(new ObjectMapperContextResolver(configuredObjectMapper(config)));
        register(JsonMappingExceptionMapper.class);
    }

    private void registerCoreProviders(AppConfig config) {
        register(CorrelationIdFilter.class);
        register(RequestLoggingFilter.class);
        register(ApiExceptionMapper.class);
    }
}
```

Provider categories:

```text
Serialization providers
  - JSON provider
  - XML provider
  - custom binary provider

Error providers
  - ExceptionMapper

Pipeline providers
  - request/response filter
  - reader/writer interceptor

Injection providers
  - HK2 binder

Observability providers
  - metrics/tracing/logging filters

Security providers
  - auth filter
  - authorization filter
```

Jangan campur semua registration dalam satu list panjang tanpa struktur.

---

## 24. `ContextResolver<T>` dan Serialization Configuration

Untuk JSON/XML provider, sering kali kita tidak perlu membuat `MessageBodyReader/Writer` sendiri. Kita cukup menyediakan konfigurasi engine melalui `ContextResolver`.

Contoh Jackson `ObjectMapper` resolver:

```java
@Provider
public final class ObjectMapperResolver implements ContextResolver<ObjectMapper> {

    private final ObjectMapper mapper;

    public ObjectMapperResolver() {
        this.mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

Mental model:

```text
MessageBodyReader/Writer = siapa yang melakukan read/write
ContextResolver          = konfigurasi dependency yang dipakai provider
```

Ini lebih baik daripada membuat custom JSON provider catch-all.

Tapi konfigurasi global juga harus hati-hati:

```text
- unknown fields allow/disallow,
- null field serialization,
- date/time format,
- enum format,
- BigDecimal handling,
- polymorphism,
- property naming strategy.
```

Perubahan global mapper adalah breaking change untuk API.

---

## 25. `ReaderInterceptor` dan `WriterInterceptor`

Selain `MessageBodyReader/Writer`, ada interceptor entity stream.

### 25.1 ReaderInterceptor

```java
@Provider
public class ChecksumReaderInterceptor implements ReaderInterceptor {
    @Override
    public Object aroundReadFrom(ReaderInterceptorContext context)
            throws IOException, WebApplicationException {

        // inspect headers or wrap stream
        return context.proceed();
    }
}
```

Reader interceptor berjalan di sekitar proses read body.

Use case:

```text
- decompress custom encoding,
- verify signature,
- decrypt body,
- checksum validation,
- limited body buffering,
- audit capture.
```

### 25.2 WriterInterceptor

```java
@Provider
public class SigningWriterInterceptor implements WriterInterceptor {
    @Override
    public void aroundWriteTo(WriterInterceptorContext context)
            throws IOException, WebApplicationException {

        context.proceed();
        // or wrap output stream before proceed
    }
}
```

Use case:

```text
- compress response,
- sign payload,
- encrypt payload,
- transform stream,
- count bytes written.
```

Mental distinction:

```text
MessageBodyReader/Writer -> convert between bytes and object
Reader/WriterInterceptor -> wrap/modify the conversion process
Filter                   -> operate at request/response metadata pipeline
```

Jangan pakai filter untuk tugas yang sebenarnya entity stream transformation jika interceptor lebih tepat.

---

## 26. Performance Model Entity Provider

Entity pipeline bisa menjadi bottleneck besar.

Cost utama:

```text
1. Reading bytes from socket/container input stream
2. Buffering body
3. Parsing format
4. Allocating DTO/object graph
5. Validating object
6. Serializing response object graph
7. Writing bytes to output stream
8. Optional compression/encryption/signature
```

### 26.1 JSON Serialization Cost

JSON cost dipengaruhi:

```text
- jumlah field,
- nested depth,
- collection size,
- reflection/introspection cache,
- date/time conversion,
- BigDecimal formatting,
- custom serializer,
- polymorphism,
- pretty print,
- null inclusion,
- lazy proxy traversal.
```

### 26.2 Buffering Cost

Membaca body menjadi `byte[]` atau `String` untuk logging/inspection menggandakan memory pressure.

```text
10 MB request body
  -> 10 MB raw bytes
  -> maybe 20 MB String char[]/byte[] depending Java representation
  -> object graph hasil parse
  -> validation objects/errors
```

Pada concurrent request tinggi, ini bisa cepat menjadi GC pressure.

### 26.3 Streaming vs Materialization

Materialization:

```text
body penuh -> object penuh -> processing
```

Streaming:

```text
chunk -> process -> write/chunk next
```

Streaming cocok untuk:

```text
- export besar,
- file transfer,
- large CSV,
- large NDJSON,
- object storage proxy.
```

Kurang cocok untuk:

```text
- domain command yang butuh validasi seluruh object,
- transaction kecil,
- request yang harus diaudit secara penuh,
- format yang sulit diproses incremental.
```

---

## 27. Security Model Entity Provider

Entity body adalah boundary trust.

Risiko:

```text
- deserialization attack,
- unsafe polymorphic typing,
- oversized payload,
- compressed bomb,
- XML external entity,
- sensitive field leakage,
- mass assignment,
- over-posting,
- accidental serialization of internal model,
- stack trace leak from parser exception,
- logging body berisi PII/secret.
```

### 27.1 Jangan Pakai Entity Persistence Sebagai API DTO

Buruk:

```java
@POST
public Response create(UserEntity entity) { ... }
```

Risiko:

```text
- client bisa mengisi field internal,
- lazy relation terserialisasi,
- persistence annotation bocor ke API,
- field security sulit dikontrol,
- circular reference.
```

Lebih baik:

```java
public Response create(CreateUserRequest request) { ... }
```

Mapping ke domain/persistence dilakukan eksplisit.

### 27.2 Limit Size

Provider sendiri biasanya bukan tempat terbaik untuk global body size limit. Gunakan layer lebih awal:

```text
- API gateway,
- reverse proxy,
- servlet container,
- Jersey filter/interceptor dengan limit,
- multipart config.
```

Tapi custom reader untuk format khusus tetap harus defensive terhadap input besar.

### 27.3 XML Provider

Jika memakai XML:

```text
- disable XXE,
- batasi entity expansion,
- batasi depth/size,
- jangan parse XML dari untrusted source dengan default unsafe parser.
```

---

## 28. Java 8 sampai Java 25 Considerations

### 28.1 Java 8

Ciri umum:

```text
- javax-era application sering masih Jersey 2.x,
- DTO POJO mutable umum,
- no records,
- no sealed classes,
- older Jackson/JAXB integration,
- migration ke jakarta butuh effort besar.
```

Rekomendasi:

```text
- explicit provider registration,
- DTO dedicated,
- gunakan wrapper type untuk optional/nullable field,
- hindari magic scanning berlebihan,
- siapkan contract tests sebelum migrasi.
```

### 28.2 Java 11/17

Ciri:

```text
- Java EE module removal impact JAXB/JAX-WS lama,
- Jakarta transition mulai relevan,
- stronger TLS/default runtime behavior,
- containerized deployment lebih umum.
```

Rekomendasi:

```text
- dependency eksplisit untuk JAXB/JSON provider,
- hindari mengandalkan JDK-bundled Java EE APIs,
- mulai pisahkan API DTO dari internal entity.
```

### 28.3 Java 21

Ciri:

```text
- virtual threads available,
- records/sealed classes mature,
- modern GC options,
- container runtime lebih matang.
```

Entity provider implication:

```text
- provider tetap harus thread-safe,
- ThreadLocal context harus hati-hati,
- blocking serialization tetap CPU-bound,
- virtual threads tidak mempercepat JSON parsing CPU-heavy.
```

### 28.4 Java 25

Ciri:

```text
- LTS modern line,
- cocok untuk forward-looking runtime,
- Jersey/Jakarta stack harus dicek baseline-nya.
```

Rekomendasi:

```text
- treat Java 25 sebagai runtime target modern,
- tetap compile/test dengan baseline yang disupport produk,
- perhatikan library compatibility,
- jangan mengaktifkan fitur Java modern yang memutus compatibility Java 8 jika module masih harus dual-support.
```

---

## 29. Jersey 2.x, 3.x, 4.x Provider Compatibility

### 29.1 Jersey 2.x

```text
Package namespace: javax.ws.rs.*
Typical era: Java EE / JAX-RS 2.x
```

Provider harus implement:

```java
javax.ws.rs.ext.MessageBodyReader
javax.ws.rs.ext.MessageBodyWriter
```

### 29.2 Jersey 3.x dan 4.x

```text
Package namespace: jakarta.ws.rs.*
Typical era: Jakarta EE 9+
```

Provider harus implement:

```java
jakarta.ws.rs.ext.MessageBodyReader
jakarta.ws.rs.ext.MessageBodyWriter
```

### 29.3 Migration Trap

Jika kamu migrate source code:

```text
javax.ws.rs.ext.MessageBodyReader
  -> jakarta.ws.rs.ext.MessageBodyReader
```

Tetapi dependency JSON provider masih `javax` based, runtime tidak akan memperlakukannya sebagai Jakarta provider.

Gejala:

```text
Provider ada di dependency tree,
tapi Jersey tidak menemukan reader/writer.
```

Checklist dependency:

```text
- jersey version
- jakarta.ws.rs-api version
- jersey-media-json-* version
- jackson provider artifact namespace
- servlet namespace
- bean validation namespace
- transitive dependency yang membawa javax lama
```

---

## 30. Debugging Methodology

Saat entity provider error, gunakan pendekatan sistematis.

### 30.1 Untuk Request Body Error

Mulai dari HTTP raw:

```text
Method?
URI?
Content-Type?
Content-Length?
Transfer-Encoding?
Body valid?
```

Lalu resource:

```text
Method matched?
@Consumes cocok?
Entity parameter type apa?
Generic type apa?
Validation annotation apa?
```

Lalu provider:

```text
Provider apa yang ter-register?
Media type apa yang didukung?
isReadable return true?
Priority bagaimana?
Namespace cocok?
```

Lalu serialization engine:

```text
DTO punya constructor?
Record supported?
JavaTime module ada?
Unknown property setting?
Enum format?
Custom deserializer?
```

### 30.2 Untuk Response Body Error

Mulai dari resource return:

```text
Return null atau entity?
Response media type eksplisit?
@Produces apa?
Accept request apa?
Generic type preserved?
```

Lalu provider:

```text
Writer tersedia?
isWriteable true?
Priority conflict?
Vendor media type didukung?
```

Lalu object graph:

```text
Circular reference?
Lazy proxy?
Field sensitive?
Unsupported type?
Date/time?
BigDecimal?
```

### 30.3 Tambahkan Diagnostic Saat Startup

Untuk platform internal, bisa buat startup log ringkas:

```text
Registered entity providers:
- JSON provider: JacksonJsonProvider
- ObjectMapper resolver: ObjectMapperResolver
- Multipart provider: enabled
- XML provider: disabled
- Custom readers: AuditEventReader
- Custom writers: AuditEventWriter
```

Jangan log terlalu detail setiap request, tetapi startup summary sangat membantu incident.

---

## 31. Anti-Patterns

### Anti-pattern 1 — Resource Mengembalikan Entity Internal

```java
@GET
public UserEntity getUser() { ... }
```

Dampak:

```text
- serialization tidak terkendali,
- lazy loading error,
- field internal bocor,
- contract API mengikuti database.
```

### Anti-pattern 2 — Catch-All Provider

```java
public boolean isWriteable(...) { return true; }
```

Dampak:

```text
- shadowing provider lain,
- debugging sulit,
- behavior global berubah diam-diam.
```

### Anti-pattern 3 — Membaca Body di Filter Tanpa Reset

Dampak:

```text
- reader melihat empty stream,
- random deserialization error,
- hanya terjadi pada endpoint tertentu.
```

### Anti-pattern 4 — Provider Menyimpan Request State di Field

```java
private String currentRequestId;
```

Provider bisa shared antar request. Ini race condition.

### Anti-pattern 5 — Mengandalkan Scanning Tidak Terkontrol

Dampak:

```text
- provider berbeda antara local/test/prod,
- dependency baru tiba-tiba mengubah behavior,
- migration sulit.
```

### Anti-pattern 6 — Semua Error Mapping Jadi 400

Parser error memang 400, tetapi writer error biasanya 500.

### Anti-pattern 7 — Tidak Menutup Client Response

Di client side:

```java
Response response = target.request().get();
OrderDto dto = response.readEntity(OrderDto.class);
```

Harus pastikan response ditutup jika tidak memakai shortcut yang mengelola lifecycle:

```java
try (Response response = target.request().get()) {
    return response.readEntity(OrderDto.class);
}
```

Connection leak sering muncul dari response yang tidak ditutup.

---

## 32. Production Design Checklist

Gunakan checklist ini saat mendesain entity provider strategy.

### 32.1 Registration

```text
[ ] Provider penting didaftarkan eksplisit.
[ ] Tidak ada provider catch-all yang tidak perlu.
[ ] Server dan client registry dipikirkan terpisah.
[ ] Test registry sama dengan production registry sejauh mungkin.
[ ] Startup log menyebut provider utama.
```

### 32.2 Media Type

```text
[ ] Semua endpoint punya @Consumes/@Produces eksplisit jika punya body.
[ ] Vendor media type diuji.
[ ] application/problem+json diuji jika dipakai error contract.
[ ] 406/415 behavior diuji.
```

### 32.3 DTO

```text
[ ] Request DTO bukan persistence entity.
[ ] Response DTO bukan persistence entity.
[ ] Optional/null/default semantics jelas.
[ ] Generic response memakai GenericEntity jika perlu.
[ ] Java 8/record compatibility sesuai target runtime.
```

### 32.4 Error

```text
[ ] Malformed body dipetakan ke error contract yang jelas.
[ ] Validation error dibedakan dari parser error.
[ ] Writer error dianggap server-side failure.
[ ] Stack trace tidak bocor ke client.
[ ] Correlation ID muncul di error response/log.
```

### 32.5 Security

```text
[ ] Body size dibatasi.
[ ] Sensitive body tidak dilog full.
[ ] Polymorphic deserialization aman.
[ ] XML parser aman jika XML aktif.
[ ] Unknown fields policy disadari.
[ ] Mass assignment dicegah dengan DTO khusus.
```

### 32.6 Performance

```text
[ ] Large payload tidak dipaksa byte[] jika bisa stream.
[ ] Logging body dibatasi ukuran.
[ ] ObjectMapper/config provider reusable dan thread-safe.
[ ] Pretty print tidak aktif di production kecuali sengaja.
[ ] Serialization hotspot bisa diobservasi.
```

---

## 33. Mini Case Study: Kenapa Endpoint JSON Gagal Padahal Jackson Ada?

Kasus:

```java
@POST
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public CaseResponse create(CaseCreateRequest request) {
    return service.create(request);
}
```

Request:

```http
POST /api/cases
Content-Type: application/json
Accept: application/json

{"subject":"Test"}
```

Error:

```text
MessageBodyReader not found for media type=application/json,
type=class com.company.CaseCreateRequest
```

Developer berkata:

> “Tapi jackson-databind ada di pom.”

Analisis:

```text
jackson-databind adalah engine JSON,
bukan otomatis Jersey MessageBodyReader/Writer.
```

Kemungkinan root cause:

```text
1. Jersey media Jackson module belum ditambahkan.
2. Jackson provider belum register.
3. Provider namespace javax, aplikasi jakarta.
4. Auto-discovery disabled.
5. ResourceConfig test berbeda dengan runtime production.
```

Perbaikan:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(CaseResource.class);
        register(JacksonFeature.class); // sesuai artifact/version Jersey yang dipakai
        register(ObjectMapperResolver.class);
    }
}
```

Lalu test:

```text
- POST valid JSON -> 201/200
- POST malformed JSON -> 400 INVALID_REQUEST_BODY
- POST Content-Type text/plain -> 415
- GET Accept application/xml -> 406 jika XML tidak didukung
```

---

## 34. Mini Case Study: Response List Generic Hilang

Kasus:

```java
@GET
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
public Response list() {
    List<CaseSummary> summaries = service.list();
    return Response.ok(summaries).build();
}
```

Di banyak kasus JSON tetap keluar. Tetapi contract test generic wrapper gagal di client:

```java
List<CaseSummary> result = response.readEntity(List.class);
```

Hasil:

```text
List<LinkedHashMap>
```

Perbaikan client:

```java
List<CaseSummary> result = response.readEntity(new GenericType<List<CaseSummary>>() {});
```

Jika server perlu preserve generic type eksplisit:

```java
GenericEntity<List<CaseSummary>> entity =
        new GenericEntity<List<CaseSummary>>(summaries) {};

return Response.ok(entity).build();
```

Lesson:

```text
Generic type adalah bagian dari entity provider contract.
Jangan mengabaikan Type/genericType di custom provider.
```

---

## 35. Mini Case Study: Logging Filter Membuat JSON Request Kosong

Kasus:

```java
@Provider
public class RequestBodyLogFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) throws IOException {
        String body = new String(ctx.getEntityStream().readAllBytes(), StandardCharsets.UTF_8);
        log.info("body={}", body);
    }
}
```

Endpoint mulai gagal:

```text
JSON parse error: no content to map due to end-of-input
```

Root cause:

```text
Filter membaca InputStream sampai habis.
MessageBodyReader menerima stream kosong.
```

Perbaikan basic:

```java
byte[] bytes = ctx.getEntityStream().readAllBytes();
log.info("body={}", maskAndTruncate(bytes));
ctx.setEntityStream(new ByteArrayInputStream(bytes));
```

Perbaikan production:

```text
- hanya log body untuk endpoint tertentu,
- maksimum N KB,
- masking field sensitif,
- sampling,
- disable default di production,
- jangan log file/multipart,
- expose correlation ID untuk trace.
```

---

## 36. Mini Case Study: `javax` vs `jakarta` Provider Collision

Kasus migrasi:

```text
Aplikasi pindah dari Jersey 2.x ke Jersey 3.x.
Source code resource sudah jakarta.ws.rs.*.
Tapi dependency masih membawa provider javax.ws.rs.ext.MessageBodyReader.
```

Gejala:

```text
- classpath terlihat punya JSON provider,
- tidak ada compile error,
- runtime tetap bilang reader/writer tidak ditemukan.
```

Penyebab:

```text
javax.ws.rs.ext.MessageBodyReader != jakarta.ws.rs.ext.MessageBodyReader
```

Mereka interface berbeda.

Checklist migrasi:

```text
[ ] Semua import `javax.ws.rs` diganti `jakarta.ws.rs`.
[ ] Provider artifact versi Jakarta dipakai.
[ ] Servlet API juga jakarta jika container Jakarta.
[ ] Bean Validation provider juga jakarta.
[ ] Dependency tree bebas javax provider lama untuk runtime Jakarta.
[ ] Integration test membaca/menulis JSON benar-benar lewat Jersey runtime.
```

---

## 37. Latihan Pemahaman

### Latihan 1

Endpoint:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateRequest request) { ... }
```

Request tidak punya `Content-Type`, tetapi body JSON valid.

Pertanyaan:

```text
Apa kemungkinan failure?
Apakah reader JSON pasti dipakai?
Apa error contract yang defensible?
```

Jawaban yang diharapkan:

```text
Jersey tidak boleh diasumsikan otomatis menganggap body sebagai JSON.
Content-Type adalah bagian dari contract.
Failure yang defensible adalah 415 Unsupported Media Type atau 400 tergantung runtime path,
tetapi API design harus mewajibkan Content-Type application/json.
```

### Latihan 2

Custom writer:

```java
@Provider
@Produces(MediaType.APPLICATION_JSON)
public class UniversalWriter implements MessageBodyWriter<Object> {
    public boolean isWriteable(...) { return true; }
}
```

Pertanyaan:

```text
Apa risiko production-nya?
```

Jawaban:

```text
Provider ini bisa mengambil alih semua JSON response,
men-shadow provider JSON standar,
mengubah error response,
merusak generic handling,
dan membuat debugging provider selection sulit.
```

### Latihan 3

Client code:

```java
Response response = target.request().get();
List<OrderDto> orders = response.readEntity(List.class);
```

Pertanyaan:

```text
Apa masalahnya?
```

Jawaban:

```text
Generic type hilang. Gunakan GenericType<List<OrderDto>>.
Juga pastikan Response ditutup jika tidak memakai API shortcut.
```

---

## 38. Ringkasan Mental Model

Entity provider pipeline adalah mekanisme Jersey untuk menjembatani:

```text
HTTP bytes <-> Java object
```

Kunci pemahaman:

```text
MessageBodyReader  membaca request/response bytes menjadi Java object.
MessageBodyWriter  menulis Java object menjadi bytes.
Provider selection  bergantung pada type, genericType, annotation, media type, registration, dan priority.
Content-Type        penting untuk request body.
Accept/@Produces    penting untuk response body.
Generic type        harus dipertahankan untuk collection/wrapper.
Entity stream       sekali baca dan bisa besar.
Provider            harus thread-safe dan tidak menyimpan request state.
Server/client       punya provider registry masing-masing.
```

Prinsip production:

```text
Jangan membuat entity pipeline magical.
Buat provider registration eksplisit.
Buat DTO eksplisit.
Buat media type eksplisit.
Bedakan parse error, validation error, unsupported media type, dan serialization error.
Jangan log body sembarangan.
Jangan biarkan provider catch-all mengambil alih runtime tanpa alasan kuat.
```

---

## 39. Apa yang Belum Dibahas dan Akan Masuk Part Berikutnya

Bagian ini membahas provider pipeline secara umum.

Part berikutnya akan masuk lebih dalam ke JSON:

```text
Part 7 — JSON in Jersey: Jackson, JSON-B, MOXy, and Production Serialization Strategy
```

Topik Part 7:

```text
- Jackson vs JSON-B vs MOXy
- ObjectMapper lifecycle
- ContextResolver<ObjectMapper>
- records, sealed classes, Java time
- unknown fields policy
- null handling
- enum compatibility
- polymorphic deserialization security
- lazy proxy serialization
- problem+json
- DTO versioning
- JSON performance
- production ObjectMapper checklist
```

---

## 40. Status Seri

```text
Part 0  — Orientasi Seri — selesai
Part 1  — Jersey Mental Model — selesai
Part 2  — Application Bootstrap — selesai
Part 3  — Resource Model Internals — selesai
Part 4  — Request Matching Deep Dive — selesai
Part 5  — Parameter Injection Semantics — selesai
Part 6  — Entity Provider Pipeline — selesai
Part 7  — JSON in Jersey — berikutnya
...
Part 32 — Capstone — target akhir
```

Seri belum selesai. Ini adalah Part 6 dari rencana 32 part.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./05-parameter-injection-semantics-path-query-header-cookie-matrix-beanparam.md">⬅️ Part 5 — Parameter Injection Semantics: Path, Query, Header, Cookie, Matrix, BeanParam</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./07-json-in-jersey-jackson-jsonb-moxy-production-serialization-strategy.md">Part 7 — JSON in Jersey: Jackson, JSON-B, MOXy, and Production Serialization Strategy ➡️</a>
</div>
