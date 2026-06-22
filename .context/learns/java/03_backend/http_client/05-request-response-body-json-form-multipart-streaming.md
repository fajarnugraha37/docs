# Part 5 — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
Target: Java 8 sampai Java 25  
Fokus: HTTP request/response body sebagai boundary data, resource, memory, streaming, retry, dan production correctness.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

1. HTTP client sebagai production subsystem.
2. Landscape HTTP client Java 8–25.
3. Request lifecycle dari method call sampai response body.
4. URI/URL/encoding/canonical request.
5. Header/content negotiation/compression/metadata contract.

Part ini membahas bagian yang sering terlihat sederhana tetapi sangat sering menjadi sumber bug production: **body handling**.

Banyak engineer memperlakukan HTTP body sebagai:

```java
String body = response.body();
```

atau:

```java
objectMapper.readValue(responseBody, MyDto.class);
```

Padahal di production, HTTP body bukan hanya “data”. HTTP body adalah kombinasi dari:

- format data,
- ukuran data,
- memory pressure,
- stream lifecycle,
- connection reuse,
- retryability,
- compression,
- timeout behavior,
- parsing behavior,
- schema compatibility,
- security boundary,
- audit boundary,
- observability boundary.

Engineer biasa bertanya:

> “Bagaimana cara POST JSON?”

Engineer kuat bertanya:

> “Apakah body ini repeatable, bounded, streamable, observable, retry-safe, memory-safe, parse-safe, dan compatible terhadap evolusi contract?”

Itulah standar mental model yang ingin kita bangun di part ini.

---

## 2. Mental Model: HTTP Body Adalah Byte Stream yang Diberi Makna oleh Metadata

Secara fundamental, HTTP body adalah sequence of bytes.

Makna body tidak muncul dari body itu sendiri, tetapi dari kombinasi:

```text
body bytes
+ Content-Type
+ Content-Encoding
+ Transfer-Encoding
+ Content-Length
+ HTTP method semantics
+ API contract
+ parser/converter
+ domain expectation
```

Contoh:

```http
POST /orders HTTP/1.1
Content-Type: application/json
Content-Length: 43

{"customerId":"C001","amount":120000.50}
```

Bytes yang sama bisa dianggap berbeda jika metadata berubah.

Misalnya:

```http
Content-Type: text/plain

{"customerId":"C001","amount":120000.50}
```

Secara bytes sama, tetapi secara contract berbeda.

Atau:

```http
Content-Encoding: gzip
Content-Type: application/json

<compressed bytes>
```

Body tidak bisa langsung diparse sebagai JSON sebelum didecompress.

Mental model penting:

```text
HTTP body is not an object.
HTTP body is a byte stream.
Content metadata tells the client how to interpret the stream.
Application code maps the interpreted payload into boundary DTO.
Domain code must not depend directly on raw remote payload shape.
```

---

## 3. Klasifikasi Body Berdasarkan Ukuran dan Lifecycle

Tidak semua body boleh diperlakukan sama.

Kita perlu mengklasifikasikan body terlebih dahulu.

### 3.1 Small Bounded Body

Contoh:

- JSON request kecil.
- JSON response kecil.
- form login.
- simple error response.

Karakteristik:

```text
size known or predictably small
safe to buffer in memory
safe to log partially after redaction
usually repeatable
usually retryable if method/idempotency allows
```

Contoh aman:

```json
{
  "postalCode": "179097",
  "unitNo": "10-01"
}
```

### 3.2 Medium Bounded Body

Contoh:

- response list ribuan item.
- export metadata.
- medium JSON payload.
- XML document beberapa MB.

Karakteristik:

```text
bounded but may pressure heap
buffering still possible but must be intentional
parsing cost matters
logging body is dangerous
pagination should be considered
```

### 3.3 Large Bounded Body

Contoh:

- file download 200 MB.
- PDF report.
- CSV export.
- image/video/document.

Karakteristik:

```text
must stream to file/storage/output stream
must not load fully into String or byte[]
retry may need range/resume support
checksum should be considered
progress/timeout matters
```

### 3.4 Unbounded or Long-Lived Body

Contoh:

- server-sent stream.
- log tail stream.
- event stream.
- long polling.
- chunked feed.

Karakteristik:

```text
Content-Length may be absent
connection stays occupied
read timeout semantics differ
backpressure is critical
cancellation must be explicit
```

### 3.5 One-Shot Body

Body yang hanya bisa dibaca/dikirim sekali.

Contoh:

- InputStream dari file/socket.
- stream hasil enkripsi on-the-fly.
- upload stream dari user input.

Karakteristik:

```text
not repeatable
not safely retryable without reconstructing source
body logging can consume stream
must close source correctly
```

### 3.6 Repeatable Body

Body yang bisa dikirim ulang.

Contoh:

- String.
- byte array.
- file path yang bisa dibuka ulang.
- immutable encoded DTO.

Karakteristik:

```text
retry can resend body
signature can be recomputed
content length may be known
better for idempotent retry
```

---

## 4. Request Body: Pertanyaan Desain Sebelum Menulis Kode

Sebelum membuat request body, tanyakan:

1. Apa format body?
   - JSON?
   - XML?
   - form URL encoded?
   - multipart?
   - binary?
   - text?

2. Apakah body kecil atau besar?

3. Apakah body repeatable?

4. Apakah body boleh diretry?

5. Apakah Content-Length diketahui?

6. Apakah perlu streaming?

7. Apakah body mengandung data sensitif?

8. Apakah body perlu disign?

9. Apakah body perlu checksum?

10. Apakah body perlu compression?

11. Apa error behavior jika body gagal ditulis setengah jalan?

12. Bagaimana observability-nya?

Engineer top-tier tidak langsung memilih `String` atau `byte[]`. Ia memahami konsekuensi resource dan protocol dari representasi body.

---

## 5. Request Body JSON

JSON adalah format paling umum dalam HTTP API modern.

Contoh sederhana:

```json
{
  "caseId": "CASE-001",
  "action": "APPROVE",
  "remarks": "Approved after review"
}
```

### 5.1 Masalah Umum JSON Body

Bug umum:

1. Tidak set `Content-Type: application/json`.
2. Charset tidak konsisten.
3. Menggunakan domain entity langsung sebagai request DTO.
4. Null field tidak dipikirkan.
5. Unknown field tidak dipikirkan.
6. Date/time format tidak jelas.
7. BigDecimal berubah precision.
8. Enum remote berubah dan client crash.
9. Body dilog penuh mengandung PII/secret.
10. Body terlalu besar karena nested object tidak sengaja ikut serialize.

### 5.2 Boundary DTO, Bukan Domain Entity

Jangan kirim domain entity langsung.

Buruk:

```java
public void createOrder(Order order) {
    http.post("/orders", objectMapper.writeValueAsString(order));
}
```

Masalah:

- Domain object mungkin punya internal field.
- Lazy-loaded relation bisa ikut terserialisasi.
- Schema remote menjadi tergantung domain internal.
- Field sensitif bisa bocor.
- Contract sulit dievolusi.

Lebih baik:

```java
public record CreateOrderRequest(
        String customerId,
        BigDecimal amount,
        String currency,
        List<CreateOrderLineRequest> lines
) {}

public record CreateOrderLineRequest(
        String sku,
        int quantity,
        BigDecimal unitPrice
) {}
```

Kemudian mapping eksplisit:

```java
CreateOrderRequest request = new CreateOrderRequest(
        order.customerId().value(),
        order.totalAmount().value(),
        order.currency().code(),
        order.lines().stream()
                .map(line -> new CreateOrderLineRequest(
                        line.sku().value(),
                        line.quantity().value(),
                        line.unitPrice().value()))
                .toList()
);
```

Mental model:

```text
Domain object belongs to your internal model.
HTTP DTO belongs to external contract.
Never let remote contract accidentally shape your core domain.
```

### 5.3 JSON Body dengan JDK HttpClient

JDK `HttpClient` tidak menyediakan JSON mapper bawaan. Kita biasanya pakai Jackson/Gson/Moshi dan kirim hasil serialize sebagai string/byte array.

```java
ObjectMapper objectMapper = new ObjectMapper();

CreateOrderRequest payload = new CreateOrderRequest(
        "C001",
        new BigDecimal("120000.50"),
        "IDR",
        List.of(new CreateOrderLineRequest("SKU-1", 2, new BigDecimal("60000.25")))
);

String json = objectMapper.writeValueAsString(payload);

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://api.example.com/orders"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
        .build();

HttpResponse<String> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
);
```

Catatan:

- `BodyPublishers.ofString` cocok untuk body kecil/medium yang sudah ada di memory.
- Untuk body besar, jangan serialize semuanya menjadi `String` jika ukuran bisa besar.
- Pastikan charset konsisten.
- Untuk JSON modern, UTF-8 seharusnya default aman.

### 5.4 JSON Body dengan OkHttp

```java
ObjectMapper objectMapper = new ObjectMapper();

String json = objectMapper.writeValueAsString(payload);

RequestBody body = RequestBody.create(
        json,
        MediaType.get("application/json; charset=utf-8")
);

Request request = new Request.Builder()
        .url("https://api.example.com/orders")
        .post(body)
        .header("Accept", "application/json")
        .build();

try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        throw new IOException("Unexpected status: " + response.code());
    }

    String responseJson = response.body().string();
    CreateOrderResponse result = objectMapper.readValue(responseJson, CreateOrderResponse.class);
}
```

Catatan penting OkHttp:

```text
Response must be closed.
ResponseBody can be consumed only once.
Calling response.body().string() loads entire body into memory.
```

Untuk response kecil, `.string()` cukup. Untuk response besar, gunakan stream.

### 5.5 JSON Body dengan Retrofit

Retrofit memindahkan serialization ke converter.

```java
public interface OrderApi {
    @POST("orders")
    Call<CreateOrderResponse> createOrder(@Body CreateOrderRequest request);
}
```

Setup:

```java
Retrofit retrofit = new Retrofit.Builder()
        .baseUrl("https://api.example.com/")
        .addConverterFactory(JacksonConverterFactory.create(objectMapper))
        .client(okHttpClient)
        .build();

OrderApi api = retrofit.create(OrderApi.class);

Response<CreateOrderResponse> response = api.createOrder(payload).execute();
```

Kelebihan:

- contract lebih type-safe,
- endpoint lebih eksplisit,
- body mapping otomatis,
- mudah diuji dengan MockWebServer.

Risiko:

- error body sering diabaikan,
- converter failure bisa disamakan dengan network failure,
- annotation bisa menyembunyikan behavior encoding/body.

---

## 6. Response Body JSON

Response body handling adalah salah satu sumber bug terbesar.

Contoh response sukses:

```json
{
  "orderId": "ORD-001",
  "status": "CREATED"
}
```

Contoh response error:

```json
{
  "code": "INVALID_AMOUNT",
  "message": "Amount must be greater than zero",
  "traceId": "abc-123"
}
```

Kedua response sama-sama JSON, tetapi maknanya berbeda.

### 6.1 Jangan Parse Body Sukses Sebelum Cek Status

Buruk:

```java
CreateOrderResponse body = objectMapper.readValue(response.body(), CreateOrderResponse.class);
```

Jika status `400` dan body error berbeda schema, parse akan gagal dan error asli hilang.

Lebih baik:

```java
int status = response.statusCode();
String body = response.body();

if (status >= 200 && status < 300) {
    return objectMapper.readValue(body, CreateOrderResponse.class);
}

RemoteError error = tryParseError(body);
throw mapToClientException(status, error);
```

### 6.2 Error Body Harus Dianggap First-Class

Error body sering lebih penting daripada success body.

Informasi penting:

- remote error code,
- message,
- field validation errors,
- trace id,
- retryability hint,
- rate limit hint,
- correlation id.

Buat model error eksplisit:

```java
public record RemoteError(
        String code,
        String message,
        String traceId,
        Map<String, List<String>> fieldErrors
) {}
```

Jangan hanya:

```java
throw new RuntimeException("HTTP 400");
```

Karena itu membuang konteks yang dibutuhkan untuk diagnosis.

### 6.3 Body Bisa Kosong

Status tertentu sering tidak punya body:

- `204 No Content`
- `304 Not Modified`
- beberapa `202 Accepted`
- beberapa error dari gateway/load balancer

Jangan selalu assume body ada.

```java
if (status == 204) {
    return Optional.empty();
}
```

Atau:

```java
String body = response.body();
if (body == null || body.isBlank()) {
    return handleEmptyBody(status);
}
```

### 6.4 Body Bisa Bukan JSON Walaupun Kita Minta JSON

Kita bisa mengirim:

```http
Accept: application/json
```

Tetapi menerima:

```http
Content-Type: text/html
```

Contoh penyebab:

- reverse proxy error page,
- WAF block page,
- load balancer default error,
- upstream crash,
- authentication gateway redirect HTML,
- maintenance page.

Maka parser JSON bisa gagal dengan error misleading.

Client matang memeriksa `Content-Type`.

```java
String contentType = response.headers()
        .firstValue("Content-Type")
        .orElse("");

if (!contentType.toLowerCase(Locale.ROOT).contains("application/json")) {
    throw new UnexpectedContentTypeException(status, contentType, preview(body));
}
```

---

## 7. Form URL Encoded Body

Form URL encoded umum dipakai untuk:

- OAuth2 token endpoint,
- legacy API,
- login form,
- payment gateway,
- third-party integration.

Format:

```http
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=my-client&client_secret=secret
```

### 7.1 Kenapa Tidak Boleh Concatenate String Manual

Buruk:

```java
String body = "client_id=" + clientId + "&client_secret=" + secret;
```

Masalah:

- special character tidak di-encode,
- `&` di value memecah parameter,
- `+` dan space ambigu,
- secret bisa corrupt,
- signature mismatch.

Lebih baik gunakan builder/encoder.

### 7.2 OkHttp FormBody

```java
RequestBody body = new FormBody.Builder(StandardCharsets.UTF_8)
        .add("grant_type", "client_credentials")
        .add("client_id", clientId)
        .add("client_secret", clientSecret)
        .build();

Request request = new Request.Builder()
        .url("https://auth.example.com/oauth/token")
        .post(body)
        .header("Accept", "application/json")
        .build();
```

### 7.3 JDK HttpClient Form Body

JDK tidak punya form builder bawaan. Buat utility yang benar.

```java
static String formEncode(Map<String, String> values) {
    return values.entrySet().stream()
            .map(e -> encode(e.getKey()) + "=" + encode(e.getValue()))
            .collect(Collectors.joining("&"));
}

static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
}
```

Pemakaian:

```java
String form = formEncode(Map.of(
        "grant_type", "client_credentials",
        "client_id", clientId,
        "client_secret", clientSecret
));

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://auth.example.com/oauth/token"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(form))
        .build();
```

Catatan Java 8:

```java
URLEncoder.encode(value, "UTF-8")
```

karena overload `Charset` baru tersedia di Java lebih baru.

### 7.4 Retrofit Form URL Encoded

```java
public interface AuthApi {
    @FormUrlEncoded
    @POST("oauth/token")
    Call<TokenResponse> token(
            @Field("grant_type") String grantType,
            @Field("client_id") String clientId,
            @Field("client_secret") String clientSecret
    );
}
```

Retrofit mengurus encoding field.

---

## 8. Multipart Body

Multipart digunakan saat satu request memiliki beberapa part dengan metadata masing-masing.

Umum untuk:

- file upload,
- form + file,
- dokumen + metadata JSON,
- multi-file submission.

Contoh konseptual:

```http
Content-Type: multipart/form-data; boundary=abc123

--abc123
Content-Disposition: form-data; name="metadata"
Content-Type: application/json

{"caseId":"CASE-001"}
--abc123
Content-Disposition: form-data; name="document"; filename="evidence.pdf"
Content-Type: application/pdf

<binary bytes>
--abc123--
```

### 8.1 Multipart Bukan Sekadar “Upload File”

Setiap part punya:

- name,
- optional filename,
- content type,
- body bytes,
- optional headers.

Kesalahan umum:

1. Set boundary manual dan salah.
2. Tidak set filename.
3. Salah content type file.
4. File dibaca penuh ke memory.
5. Metadata JSON dikirim sebagai text tanpa content type.
6. Retrying upload besar tanpa idempotency.
7. Tidak validate file size sebelum upload.
8. Tidak close file stream.

### 8.2 OkHttp Multipart

```java
MediaType pdf = MediaType.get("application/pdf");
File file = new File("/data/evidence.pdf");

RequestBody fileBody = RequestBody.create(file, pdf);

RequestBody metadataBody = RequestBody.create(
        "{\"caseId\":\"CASE-001\"}",
        MediaType.get("application/json; charset=utf-8")
);

RequestBody multipartBody = new MultipartBody.Builder()
        .setType(MultipartBody.FORM)
        .addFormDataPart("metadata", null, metadataBody)
        .addFormDataPart("document", file.getName(), fileBody)
        .build();

Request request = new Request.Builder()
        .url("https://api.example.com/cases/CASE-001/documents")
        .post(multipartBody)
        .build();
```

Kelebihan OkHttp:

- builder mengurus boundary,
- part bisa punya body sendiri,
- file body bisa streaming dari file.

### 8.3 Retrofit Multipart

```java
public interface DocumentApi {
    @Multipart
    @POST("cases/{caseId}/documents")
    Call<UploadResponse> upload(
            @Path("caseId") String caseId,
            @Part("metadata") RequestBody metadata,
            @Part MultipartBody.Part document
    );
}
```

Pemakaian:

```java
RequestBody metadata = RequestBody.create(
        "{\"source\":\"PORTAL\"}",
        MediaType.get("application/json; charset=utf-8")
);

RequestBody fileBody = RequestBody.create(
        file,
        MediaType.get("application/pdf")
);

MultipartBody.Part document = MultipartBody.Part.createFormData(
        "document",
        file.getName(),
        fileBody
);

Response<UploadResponse> response = api.upload("CASE-001", metadata, document).execute();
```

### 8.4 JDK HttpClient Multipart

JDK `HttpClient` tidak menyediakan multipart builder bawaan. Bisa dibuat manual, tetapi harus hati-hati.

Contoh simplified untuk file kecil/medium:

```java
String boundary = "----JavaBoundary" + UUID.randomUUID();
Path file = Path.of("/data/evidence.pdf");

byte[] fileBytes = Files.readAllBytes(file); // jangan untuk file besar

ByteArrayOutputStream out = new ByteArrayOutputStream();

out.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
out.write("Content-Disposition: form-data; name=\"metadata\"\r\n".getBytes(StandardCharsets.UTF_8));
out.write("Content-Type: application/json; charset=utf-8\r\n\r\n".getBytes(StandardCharsets.UTF_8));
out.write("{\"caseId\":\"CASE-001\"}\r\n".getBytes(StandardCharsets.UTF_8));

out.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
out.write(("Content-Disposition: form-data; name=\"document\"; filename=\"" + file.getFileName() + "\"\r\n").getBytes(StandardCharsets.UTF_8));
out.write("Content-Type: application/pdf\r\n\r\n".getBytes(StandardCharsets.UTF_8));
out.write(fileBytes);
out.write("\r\n".getBytes(StandardCharsets.UTF_8));

out.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://api.example.com/upload"))
        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .POST(HttpRequest.BodyPublishers.ofByteArray(out.toByteArray()))
        .build();
```

Untuk file besar, jangan gunakan `readAllBytes`. Gunakan library multipart helper atau custom streaming publisher.

Dalam production, jika multipart upload kompleks, OkHttp/Apache sering lebih ergonomis daripada JDK bawaan.

---

## 9. Binary Body dan File Upload

Binary upload bisa berupa:

- raw `application/octet-stream`,
- PDF,
- image,
- ZIP,
- CSV,
- encrypted blob.

### 9.1 Raw Upload dengan JDK HttpClient

```java
Path file = Path.of("/data/report.pdf");

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://api.example.com/reports/upload"))
        .header("Content-Type", "application/pdf")
        .POST(HttpRequest.BodyPublishers.ofFile(file))
        .build();
```

`ofFile` lebih baik daripada `readAllBytes` untuk file besar karena tidak perlu memuat seluruh file ke heap.

### 9.2 Raw Upload dengan OkHttp

```java
File file = new File("/data/report.pdf");

RequestBody body = RequestBody.create(
        file,
        MediaType.get("application/pdf")
);

Request request = new Request.Builder()
        .url("https://api.example.com/reports/upload")
        .put(body)
        .build();
```

### 9.3 Upload dengan Checksum

Untuk file penting, pertimbangkan checksum.

Contoh header:

```http
Digest: sha-256=<base64digest>
```

Atau header custom:

```http
X-Content-SHA256: <hex>
```

Tujuan:

- memastikan payload tidak corrupt,
- membantu deduplication,
- membantu audit,
- membantu idempotency.

Tetapi checksum biasanya membutuhkan pembacaan file. Untuk file besar, hitung checksum streaming.

```java
static String sha256Hex(Path path) throws IOException, NoSuchAlgorithmException {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream in = Files.newInputStream(path)) {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            digest.update(buffer, 0, read);
        }
    }
    return HexFormat.of().formatHex(digest.digest()); // Java 17+
}
```

Untuk Java 8, gunakan utility hex manual atau library.

---

## 10. File Download

File download adalah area yang sangat sering salah karena engineer membaca seluruh response ke memory.

Buruk:

```java
byte[] bytes = response.body();
Files.write(path, bytes);
```

Ini hanya aman untuk file kecil.

### 10.1 Download dengan JDK HttpClient ke File

JDK menyediakan `BodyHandlers.ofFile`.

```java
Path target = Path.of("/data/output/report.pdf");

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://api.example.com/reports/123/download"))
        .GET()
        .build();

HttpResponse<Path> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofFile(target)
);

if (response.statusCode() != 200) {
    throw new IOException("Download failed: " + response.statusCode());
}
```

Catatan:

- Cek status sebelum menganggap file valid.
- Jika server mengembalikan error JSON/HTML, `ofFile` tetap bisa menulis error body ke file target.
- Untuk safety, download ke temp file dulu.

Lebih aman:

```java
Path temp = Files.createTempFile("download-", ".tmp");

HttpResponse<Path> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofFile(temp)
);

if (response.statusCode() == 200) {
    Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
} else {
    String preview = Files.size(temp) <= 4096
            ? Files.readString(temp)
            : "<large error body: " + Files.size(temp) + " bytes>";
    Files.deleteIfExists(temp);
    throw new IOException("Download failed: " + response.statusCode() + " body=" + preview);
}
```

### 10.2 Download dengan OkHttp Streaming

```java
Request request = new Request.Builder()
        .url("https://api.example.com/reports/123/download")
        .get()
        .build();

Path target = Path.of("/data/output/report.pdf");
Path temp = Files.createTempFile("download-", ".tmp");

try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        String errorPreview = response.body() != null ? response.body().string() : "";
        throw new IOException("Download failed: " + response.code() + " body=" + errorPreview);
    }

    ResponseBody body = response.body();
    if (body == null) {
        throw new IOException("Empty response body");
    }

    try (InputStream in = body.byteStream();
         OutputStream out = Files.newOutputStream(temp)) {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
    }
}

Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
```

Poin penting:

```text
Response close closes response body.
Do not call body.string() for large file.
Use temp file to avoid corrupt final file on partial download.
```

### 10.3 Content-Length dan Progress

Jika response punya `Content-Length`, progress bisa dihitung.

```java
long contentLength = body.contentLength(); // may be -1
```

Jika `-1`, server tidak memberi length atau menggunakan transfer chunked.

Progress logic harus support unknown total.

```text
known total: downloaded / total
unknown total: downloaded bytes only
```

### 10.4 Resume Download dengan Range

Untuk file besar, pertimbangkan HTTP Range.

```http
Range: bytes=1048576-
```

Server bisa membalas:

```http
206 Partial Content
Content-Range: bytes 1048576-9999999/10000000
```

Gunakan resume hanya jika:

- server mendukung range,
- file identity stabil,
- ETag/Last-Modified cocok,
- partial file valid,
- checksum akhir diverifikasi.

Jika tidak, resume bisa menghasilkan file corrupt.

---

## 11. Streaming vs Buffering

Ini salah satu keputusan paling penting dalam body handling.

### 11.1 Buffering

Buffering berarti seluruh body dimuat ke memory.

Contoh:

```java
String body = response.body();
byte[] bytes = response.body();
response.body().string();
Files.readAllBytes(path);
```

Cocok untuk:

- response kecil,
- error body kecil,
- JSON kecil,
- body yang perlu diretry,
- body yang perlu disign secara utuh.

Risiko:

- heap pressure,
- GC spike,
- OOM,
- latency meningkat,
- large payload accident.

### 11.2 Streaming

Streaming berarti body diproses bertahap.

Contoh:

```java
try (InputStream in = response.body().byteStream()) {
    // read chunks
}
```

Cocok untuk:

- file besar,
- upload besar,
- response panjang,
- parsing incremental,
- low-memory service.

Risiko:

- stream lifecycle harus disiplin,
- error bisa terjadi di tengah body,
- retry lebih sulit,
- connection lebih lama terpakai,
- backpressure perlu dipikirkan.

### 11.3 Decision Rule

Gunakan aturan sederhana:

```text
If body is known small and bounded → buffering is acceptable.
If body size is unknown, user-controlled, or large → stream.
If body must be retried → prefer repeatable source.
If body contains sensitive data → avoid full logging regardless of size.
```

### 11.4 Set Max Body Size

Untuk response yang di-buffer, punya batas.

Contoh utility:

```java
static byte[] readUpTo(InputStream in, int maxBytes) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int total = 0;
    int read;

    while ((read = in.read(buffer)) != -1) {
        total += read;
        if (total > maxBytes) {
            throw new IOException("Response body exceeds limit: " + maxBytes);
        }
        out.write(buffer, 0, read);
    }

    return out.toByteArray();
}
```

Ini penting untuk:

- error body dari proxy yang bisa besar,
- malicious server,
- accidental massive response,
- third-party API bug.

---

## 12. Response Body Lifecycle dan Connection Reuse

HTTP client pooling bergantung pada body lifecycle.

Secara umum:

```text
response received
→ body stream opened
→ application consumes/closes body
→ connection can be reused or discarded
```

Jika body tidak ditutup:

```text
connection remains occupied
→ pool capacity decreases
→ pending requests wait
→ latency rises
→ timeout spike
→ thread pile-up
→ incident
```

### 12.1 OkHttp: Selalu Close Response

Benar:

```java
try (Response response = client.newCall(request).execute()) {
    // handle response
}
```

Buruk:

```java
Response response = client.newCall(request).execute();
return response.body().string(); // if exception before close, leak risk
```

Lebih aman:

```java
try (Response response = client.newCall(request).execute()) {
    ResponseBody body = response.body();
    return body != null ? body.string() : "";
}
```

### 12.2 JDK HttpClient BodyHandlers

Dengan `BodyHandlers.ofString`, body sudah dibaca menjadi String sebelum response dikembalikan.

Dengan `BodyHandlers.ofInputStream`, aplikasi bertanggung jawab menutup stream.

```java
HttpResponse<InputStream> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofInputStream()
);

try (InputStream in = response.body()) {
    // consume stream
}
```

Jika stream tidak ditutup, resource bisa tertahan.

### 12.3 Apache HttpClient

Classic Apache HttpClient juga butuh entity dikonsumsi/response ditutup.

Pola umum:

```java
try (CloseableHttpResponse response = client.execute(request)) {
    HttpEntity entity = response.getEntity();
    if (entity != null) {
        String body = EntityUtils.toString(entity, StandardCharsets.UTF_8);
    }
}
```

Untuk streaming:

```java
try (CloseableHttpResponse response = client.execute(request)) {
    HttpEntity entity = response.getEntity();
    if (entity != null) {
        try (InputStream in = entity.getContent()) {
            // stream
        }
    }
}
```

---

## 13. Repeatability dan Retryability Body

Retry bukan hanya masalah method/status. Retry juga masalah body.

### 13.1 Repeatable Body

Repeatable body bisa dikirim ulang.

Contoh:

```java
BodyPublishers.ofString(json)
BodyPublishers.ofByteArray(bytes)
BodyPublishers.ofFile(path)
RequestBody.create(file, mediaType)
RequestBody.create(json, mediaType)
```

Catatan: file repeatable hanya jika file masih ada dan tidak berubah.

### 13.2 Non-Repeatable Body

Non-repeatable body:

```java
InputStream input = socket.getInputStream();
```

atau upload yang stream-nya hanya bisa dibaca sekali.

Jika koneksi gagal setelah body terkirim sebagian, retry bisa berbahaya:

```text
client doesn't know whether server received full body
server may have created side effect
retry may duplicate operation
```

### 13.3 Retry Decision Matrix

| Method | Body | Idempotency Key | Retry? | Catatan |
|---|---:|---:|---:|---|
| GET | none | not needed | usually yes | asal tidak state-changing |
| PUT | repeatable | recommended | often yes | resource replacement idempotent |
| DELETE | none/small | recommended | sometimes | remote semantics perlu jelas |
| POST create | repeatable | yes | possible | tanpa key berisiko duplicate |
| POST upload | large stream | yes | difficult | butuh resume/dedup server-side |
| POST payment | any | mandatory | dangerous | harus ada idempotency semantics |

Rule:

```text
A retry-safe body is not enough.
The operation must also be semantically retry-safe.
```

---

## 14. Chunked Transfer vs Content-Length

Request/response body bisa dikirim dengan:

1. `Content-Length`.
2. `Transfer-Encoding: chunked`.
3. protocol-specific framing seperti HTTP/2 data frames.

### 14.1 Content-Length

Kelebihan:

- server tahu ukuran body di awal,
- progress bisa dihitung,
- beberapa API mensyaratkan content length,
- signature lebih mudah.

Kekurangan:

- ukuran harus diketahui sebelum kirim,
- bisa membutuhkan buffering.

### 14.2 Chunked Transfer

Kelebihan:

- body bisa dikirim streaming tanpa tahu total length,
- cocok untuk generated stream.

Kekurangan:

- tidak semua server/proxy menerima,
- signature/canonical request bisa lebih kompleks,
- retry lebih sulit,
- progress total tidak diketahui.

### 14.3 Practical Guidance

```text
For small JSON/form → Content-Length naturally known.
For file upload → prefer known file length if available.
For generated stream → chunked may be necessary.
For strict third-party API → verify whether chunked upload is accepted.
```

---

## 15. Compression: Request dan Response Body

Compression bisa terjadi pada response atau request.

### 15.1 Response Compression

Client mengirim:

```http
Accept-Encoding: gzip
```

Server membalas:

```http
Content-Encoding: gzip
```

Banyak client seperti OkHttp dapat melakukan transparent gzip untuk response tertentu.

Risiko:

- Content-Length bisa merepresentasikan compressed size, bukan decompressed size.
- Body yang kecil bisa tidak perlu compression.
- Decompression bomb bisa menyerang memory jika tidak ada limit.
- Logging setelah decompression bisa besar.

### 15.2 Request Compression

Client mengirim:

```http
Content-Encoding: gzip
Content-Type: application/json
```

Body adalah compressed JSON.

Gunakan jika:

- payload besar,
- server mendukung,
- network cost signifikan.

Hindari jika:

- payload kecil,
- server/proxy tidak jelas mendukung,
- request perlu disign dengan format tertentu,
- observability/debugging menjadi sulit.

### 15.3 Security Concern: Compression + Secrets

Compression bisa berbahaya jika attacker bisa memengaruhi payload dan mengamati ukuran compressed body, terutama pada konteks tertentu. Dalam backend-to-backend biasa risikonya lebih rendah, tetapi tetap perlu hati-hati untuk payload yang mencampur secret dan user-controlled content.

---

## 16. Charset dan Text Body

Text body membutuhkan charset.

Contoh:

```http
Content-Type: text/plain; charset=utf-8
```

Untuk JSON, UTF-8 adalah pilihan praktis default. Untuk legacy API, charset bisa menjadi sumber bug.

Bug umum:

- server mengirim ISO-8859-1 tetapi client assume UTF-8,
- client kirim UTF-8 tetapi server assume local encoding,
- tanda plus/spasi salah dalam form,
- emoji/non-ASCII corrupt,
- signature dihitung dengan charset berbeda.

Praktik:

```java
StandardCharsets.UTF_8
```

Jangan:

```java
new String(bytes)
```

karena memakai default charset platform.

Lebih baik:

```java
new String(bytes, StandardCharsets.UTF_8)
```

---

## 17. Backpressure dan Flow Control

Backpressure berarti producer tidak boleh mengirim lebih cepat daripada consumer mampu memproses.

Dalam HTTP body:

```text
remote server produces bytes
→ network buffer
→ client library buffer
→ application parser/writer
→ downstream sink
```

Jika application lambat membaca:

- buffer menumpuk,
- connection tertahan,
- remote bisa terhambat,
- timeout bisa terjadi,
- thread bisa block.

### 17.1 JDK HttpClient dan Reactive Streams

JDK HTTP client body model berbasis `BodyPublisher` dan `BodySubscriber`, yang secara konseptual cocok dengan reactive streams/backpressure.

Namun untuk aplikasi biasa, banyak orang memakai `ofString`, `ofByteArray`, atau `ofFile`.

Gunakan custom subscriber hanya jika benar-benar butuh control advanced.

### 17.2 Blocking Streaming Tetap Butuh Backpressure

Contoh download ke file:

```java
while ((read = in.read(buffer)) != -1) {
    out.write(buffer, 0, read);
}
```

Ini secara natural memberi backpressure karena `read` berikutnya tidak dipanggil sebelum `write` selesai.

Namun jika Anda membaca cepat ke queue tanpa batas:

```java
queue.add(chunk);
```

itu bisa menjadi memory leak.

Gunakan bounded queue jika perlu pipeline.

---

## 18. Parsing Strategy: Full Parse vs Streaming Parse

### 18.1 Full Parse

```java
MyResponse response = objectMapper.readValue(json, MyResponse.class);
```

Cocok untuk payload kecil/medium.

### 18.2 Streaming Parse

Untuk JSON besar:

```java
try (InputStream in = response.body()) {
    JsonParser parser = objectMapper.getFactory().createParser(in);
    while (parser.nextToken() != null) {
        // process token
    }
}
```

Cocok untuk:

- array besar,
- export data,
- event list besar,
- low memory processing.

### 18.3 NDJSON

Beberapa API memakai newline-delimited JSON:

```text
{"id":1,"status":"OK"}
{"id":2,"status":"FAILED"}
{"id":3,"status":"OK"}
```

Jangan parse sebagai satu JSON object. Baca line-by-line.

```java
try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
    String line;
    while ((line = reader.readLine()) != null) {
        Event event = objectMapper.readValue(line, Event.class);
        handle(event);
    }
}
```

---

## 19. XML, SOAP, dan Body Handling Legacy

Walaupun seri ini fokus HTTP client, banyak enterprise integration masih memakai XML/SOAP.

Masalah body XML:

- payload besar,
- namespace rumit,
- XXE risk,
- schema validation cost,
- SOAP fault berbeda dari HTTP error,
- response HTTP 200 tetapi body berisi fault.

Prinsip:

```text
For XML from remote systems, parser security must be explicit.
Do not enable external entities.
Do not parse untrusted XML with unsafe defaults.
```

SOAP error bisa seperti:

```http
HTTP/1.1 200 OK
Content-Type: text/xml

<soap:Envelope>
  <soap:Body>
    <soap:Fault>...</soap:Fault>
  </soap:Body>
</soap:Envelope>
```

Jadi status code saja tidak cukup.

---

## 20. Body Logging dan Redaction

Body logging sangat membantu debugging tetapi sangat berbahaya.

### 20.1 Jangan Log Full Body Secara Default

Risiko:

- PII leak,
- credential leak,
- token leak,
- document leak,
- regulatory breach,
- log cost explosion,
- performance overhead.

### 20.2 Log Metadata Lebih Aman

Log:

```text
method
url template, not full query if sensitive
status
duration
content-type
content-length
body-size
remote trace id
local correlation id
retry attempt
```

Hindari:

```text
Authorization header
Cookie
Set-Cookie
client_secret
password
access_token
refresh_token
NRIC/NIK/passport
full document body
```

### 20.3 Body Preview dengan Limit dan Redaction

Jika harus log body, gunakan preview terbatas.

```java
static String preview(String body, int maxChars) {
    if (body == null) return "";
    String sanitized = redact(body);
    if (sanitized.length() <= maxChars) return sanitized;
    return sanitized.substring(0, maxChars) + "...<truncated>";
}
```

Redaction contoh:

```java
static String redact(String body) {
    return body
            .replaceAll("(?i)\"access_token\"\s*:\s*\"[^\"]+\"", "\"access_token\":\"<redacted>\"")
            .replaceAll("(?i)\"client_secret\"\s*:\s*\"[^\"]+\"", "\"client_secret\":\"<redacted>\"")
            .replaceAll("(?i)\"password\"\s*:\s*\"[^\"]+\"", "\"password\":\"<redacted>\"");
}
```

Catatan: regex redaction untuk JSON bukan solusi sempurna. Untuk sistem serius, redaction berbasis parser lebih aman.

---

## 21. Security Risks pada Body Handling

### 21.1 Oversized Body

Remote/malicious server bisa mengirim body besar.

Mitigasi:

- max response size,
- streaming,
- timeout,
- content-length validation,
- decompressed size limit,
- pagination.

### 21.2 Malformed Body

JSON/XML malformed harus menjadi protocol error, bukan domain error.

```text
HTTP 200 + malformed JSON = remote protocol violation
```

### 21.3 Deserialization Risk

Jangan aktifkan polymorphic deserialization sembarangan.

Hindari menerima type metadata remote yang bisa menentukan class internal.

### 21.4 Zip Bomb / Decompression Bomb

Compressed body kecil bisa menjadi decompressed body sangat besar.

Mitigasi:

- decompressed byte limit,
- streaming decompression,
- reject suspicious compression ratio,
- disable compression untuk endpoint tertentu.

### 21.5 File Upload Security

Client-side juga harus peduli:

- jangan upload path yang salah,
- validate file size,
- validate media type,
- avoid leaking local filename/path,
- checksum file,
- scan file jika required,
- ensure consent/audit.

### 21.6 Filename Injection

Dalam multipart, filename bisa mengandung karakter aneh.

Jangan langsung ambil dari input user tanpa sanitasi.

```java
static String safeFilename(String filename) {
    return filename.replaceAll("[^a-zA-Z0-9._-]", "_");
}
```

---

## 22. Observability untuk Body Handling

Metrics penting:

```text
http.client.request.body.bytes
http.client.response.body.bytes
http.client.response.body.read.duration
http.client.body.parse.duration
http.client.body.parse.error.count
http.client.download.bytes
http.client.upload.bytes
http.client.response.content_type.unexpected.count
http.client.response.body.limit_exceeded.count
```

Log event penting:

```text
body too large
unexpected content type
empty body on expected response
malformed JSON/XML
partial download
checksum mismatch
upload stream failure
response body close failure
```

Trace span attributes:

```text
http.request.body.size
http.response.body.size
http.response.content_type
http.response.content_encoding
http.download.resumed
http.body.parse.format
```

Hindari high-cardinality:

- jangan jadikan full filename sebagai metric label,
- jangan jadikan raw error message sebagai metric label,
- jangan jadikan URL lengkap dengan query sebagai label.

---

## 23. Testing Body Handling

HTTP body handling harus diuji dengan variasi payload.

### 23.1 Test Small JSON Success

- valid JSON,
- expected status,
- expected DTO.

### 23.2 Test Error Body

- `400` dengan JSON error,
- `500` dengan HTML,
- `429` dengan JSON dan `Retry-After`,
- empty error body.

### 23.3 Test Malformed Body

- malformed JSON,
- unexpected enum,
- missing required field,
- invalid date,
- invalid number.

### 23.4 Test Large Body

- large download tidak OOM,
- written to temp file,
- checksum match,
- partial stream failure cleanup.

### 23.5 Test Multipart

- part name benar,
- filename benar,
- content type benar,
- metadata JSON benar,
- boundary valid.

### 23.6 Test Stream Lifecycle

Dengan OkHttp MockWebServer, cek request body dan response behavior.

Pseudo-test:

```java
MockWebServer server = new MockWebServer();
server.enqueue(new MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody("{\"orderId\":\"ORD-001\"}"));

server.start();

// call client

RecordedRequest recorded = server.takeRequest();
assertEquals("application/json; charset=utf-8", recorded.getHeader("Content-Type"));
assertEquals("POST", recorded.getMethod());
```

### 23.7 Fault Injection

Uji:

- response disconnect di tengah body,
- slow body,
- body lebih besar dari limit,
- content-length salah,
- gzip corrupt,
- unknown content type.

---

## 24. Library Mapping: JDK, OkHttp, Retrofit, Apache

### 24.1 JDK HttpClient

Request body:

```text
HttpRequest.BodyPublishers.ofString
HttpRequest.BodyPublishers.ofByteArray
HttpRequest.BodyPublishers.ofFile
HttpRequest.BodyPublishers.ofInputStream
HttpRequest.BodyPublishers.noBody
```

Response body:

```text
HttpResponse.BodyHandlers.ofString
HttpResponse.BodyHandlers.ofByteArray
HttpResponse.BodyHandlers.ofFile
HttpResponse.BodyHandlers.ofInputStream
HttpResponse.BodyHandlers.discarding
```

Strength:

- built-in JDK 11+,
- good for standard HTTP use,
- async support,
- HTTP/2 support.

Limitation:

- no built-in multipart builder,
- no built-in JSON converter,
- fewer ergonomic interceptors than OkHttp,
- advanced body instrumentation may need custom code.

### 24.2 OkHttp

Request body:

```text
RequestBody
FormBody
MultipartBody
RequestBody.create(file, mediaType)
custom RequestBody
```

Response body:

```text
ResponseBody.string()
ResponseBody.bytes()
ResponseBody.byteStream()
ResponseBody.source()
```

Strength:

- ergonomic body model,
- multipart support,
- interceptors,
- event listener,
- good testing story with MockWebServer,
- connection pooling strong.

Risk:

- `string()` and `bytes()` load full body,
- response must be closed,
- custom interceptors can accidentally consume body.

### 24.3 Retrofit

Body model:

```text
@Body
@Field / @FormUrlEncoded
@Multipart / @Part
converter factory
call adapter
```

Strength:

- type-safe API interface,
- converter abstraction,
- clean client boundary,
- good for many endpoint clients.

Risk:

- hides raw HTTP details,
- error body handling must be explicit,
- large streaming needs careful signature design.

### 24.4 Apache HttpClient 5

Body/entity model:

```text
StringEntity
ByteArrayEntity
FileEntity
InputStreamEntity
MultipartEntityBuilder
HttpEntity
EntityUtils
```

Strength:

- mature enterprise feature set,
- connection manager control,
- classic and async APIs,
- proxy/auth/TLS configurability.

Risk:

- API surface larger,
- entity consumption discipline needed,
- migration complexity from 4.x.

---

## 25. Pattern: Safe HTTP Response Parser

Kita bisa membuat parser boundary yang disiplin.

```java
public final class SafeJsonResponseParser {
    private final ObjectMapper objectMapper;
    private final int maxErrorBodyChars;

    public SafeJsonResponseParser(ObjectMapper objectMapper, int maxErrorBodyChars) {
        this.objectMapper = objectMapper;
        this.maxErrorBodyChars = maxErrorBodyChars;
    }

    public <T> T parseSuccessOrThrow(
            int status,
            String contentType,
            String body,
            Class<T> successType
    ) {
        if (status >= 200 && status < 300) {
            if (status == 204 || body == null || body.isBlank()) {
                return null;
            }
            ensureJson(contentType, status, body);
            try {
                return objectMapper.readValue(body, successType);
            } catch (JsonProcessingException e) {
                throw new RemoteProtocolException(
                        "Malformed success JSON from remote. status=" + status,
                        e
                );
            }
        }

        throw mapError(status, contentType, body);
    }

    private void ensureJson(String contentType, int status, String body) {
        if (contentType == null || !contentType.toLowerCase(Locale.ROOT).contains("application/json")) {
            throw new UnexpectedContentTypeException(
                    "Expected JSON but got " + contentType + " status=" + status + " body=" + preview(body)
            );
        }
    }

    private RuntimeException mapError(int status, String contentType, String body) {
        if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("application/json") && body != null && !body.isBlank()) {
            try {
                RemoteError error = objectMapper.readValue(body, RemoteError.class);
                return new RemoteApiException(status, error);
            } catch (JsonProcessingException ignored) {
                return new RemoteProtocolException(
                        "Malformed error JSON. status=" + status + " body=" + preview(body),
                        ignored
                );
            }
        }
        return new RemoteHttpException(status, preview(body));
    }

    private String preview(String body) {
        if (body == null) return "";
        String sanitized = body.replaceAll("(?i)(access_token|client_secret|password)\\s*[:=]\\s*[^,}\\s]+", "$1=<redacted>");
        if (sanitized.length() <= maxErrorBodyChars) return sanitized;
        return sanitized.substring(0, maxErrorBodyChars) + "...<truncated>";
    }
}
```

Exception taxonomy:

```java
class RemoteHttpException extends RuntimeException {
    private final int status;
    RemoteHttpException(int status, String preview) {
        super("Remote HTTP error. status=" + status + " body=" + preview);
        this.status = status;
    }
}

class RemoteApiException extends RuntimeException {
    private final int status;
    private final RemoteError error;
    RemoteApiException(int status, RemoteError error) {
        super("Remote API error. status=" + status + " code=" + error.code());
        this.status = status;
        this.error = error;
    }
}

class RemoteProtocolException extends RuntimeException {
    RemoteProtocolException(String message, Throwable cause) {
        super(message, cause);
    }
}

class UnexpectedContentTypeException extends RuntimeException {
    UnexpectedContentTypeException(String message) {
        super(message);
    }
}
```

Tujuan pattern ini:

```text
transport success does not imply domain success
HTTP status must be classified before body mapping
body parse failure must not hide remote status
error body must be first-class
unexpected content type must be visible
```

---

## 26. Pattern: Safe Download Client

```java
public final class SafeDownloader {
    private final OkHttpClient client;
    private final long maxBytes;

    public SafeDownloader(OkHttpClient client, long maxBytes) {
        this.client = client;
        this.maxBytes = maxBytes;
    }

    public DownloadResult download(String url, Path target) throws IOException {
        Request request = new Request.Builder()
                .url(url)
                .get()
                .build();

        Path temp = Files.createTempFile(target.getParent(), target.getFileName().toString(), ".tmp");
        long total = 0;

        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                String error = response.body() != null ? response.body().string() : "";
                throw new IOException("Download failed. status=" + response.code() + " body=" + preview(error));
            }

            ResponseBody body = response.body();
            if (body == null) {
                throw new IOException("Download failed. empty body");
            }

            try (InputStream in = body.byteStream();
                 OutputStream out = Files.newOutputStream(temp, StandardOpenOption.WRITE)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                    if (total > maxBytes) {
                        throw new IOException("Download exceeds max size: " + maxBytes);
                    }
                    out.write(buffer, 0, read);
                }
            }
        } catch (IOException e) {
            Files.deleteIfExists(temp);
            throw e;
        }

        Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        return new DownloadResult(target, total);
    }

    private String preview(String body) {
        if (body == null) return "";
        return body.length() <= 512 ? body : body.substring(0, 512) + "...<truncated>";
    }
}

record DownloadResult(Path path, long bytes) {}
```

Production improvement:

- checksum,
- content-type validation,
- content-disposition filename handling,
- metrics,
- retry with range,
- timeout budget,
- disk space check.

---

## 27. Pattern: Upload Client dengan Repeatable File Body dan Idempotency

```java
public final class DocumentUploadClient {
    private final OkHttpClient client;
    private final ObjectMapper objectMapper;
    private final HttpUrl baseUrl;

    public DocumentUploadClient(OkHttpClient client, ObjectMapper objectMapper, HttpUrl baseUrl) {
        this.client = client;
        this.objectMapper = objectMapper;
        this.baseUrl = baseUrl;
    }

    public UploadResponse uploadDocument(String caseId, Path file, UploadMetadata metadata) throws IOException {
        if (!Files.exists(file)) {
            throw new FileNotFoundException(file.toString());
        }
        if (Files.size(file) > 50L * 1024 * 1024) {
            throw new IOException("File too large");
        }

        String metadataJson = objectMapper.writeValueAsString(metadata);

        RequestBody metadataBody = RequestBody.create(
                metadataJson,
                MediaType.get("application/json; charset=utf-8")
        );

        RequestBody fileBody = RequestBody.create(
                file.toFile(),
                MediaType.get("application/pdf")
        );

        RequestBody multipart = new MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("metadata", null, metadataBody)
                .addFormDataPart("document", safeFilename(file.getFileName().toString()), fileBody)
                .build();

        String idempotencyKey = UUID.randomUUID().toString();

        Request request = new Request.Builder()
                .url(baseUrl.newBuilder()
                        .addPathSegment("cases")
                        .addPathSegment(caseId)
                        .addPathSegment("documents")
                        .build())
                .header("Idempotency-Key", idempotencyKey)
                .post(multipart)
                .build();

        try (Response response = client.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            if (!response.isSuccessful()) {
                throw new IOException("Upload failed. status=" + response.code() + " body=" + responseBody);
            }
            return objectMapper.readValue(responseBody, UploadResponse.class);
        }
    }

    private String safeFilename(String filename) {
        return filename.replaceAll("[^a-zA-Z0-9._-]", "_");
    }
}

record UploadMetadata(String source, String documentType) {}
record UploadResponse(String documentId, String status) {}
```

Catatan:

- File body repeatable selama file tetap ada dan tidak berubah.
- Idempotency key membantu mencegah duplicate side effect.
- Untuk file sangat besar, pertimbangkan resumable upload/protocol khusus.

---

## 28. Anti-Patterns yang Harus Dihindari

### 28.1 Membaca Semua Response ke String Tanpa Batas

```java
String body = response.body().string();
```

Ini sering aman di development, tetapi bisa OOM di production jika remote mengirim body besar.

### 28.2 Tidak Menutup Response Body

```java
Response response = client.newCall(request).execute();
```

Tanpa `try-with-resources`, pool leak sangat mungkin terjadi.

### 28.3 Menganggap Semua 2xx Punya Body JSON

`204` tidak punya body.

### 28.4 Menganggap Semua Error Body JSON

Gateway sering mengirim HTML.

### 28.5 Log Full Body

Apalagi untuk auth/payment/profile/document endpoint.

### 28.6 Manual Multipart Boundary

Kecuali benar-benar tahu apa yang dilakukan.

### 28.7 Retry Upload Stream Tanpa Idempotency

Bisa duplicate side effect.

### 28.8 Menggunakan Domain Entity sebagai DTO

Membocorkan internal model dan data sensitif.

### 28.9 Mengabaikan Content-Type

Parser error akan misleading.

### 28.10 Tidak Punya Max Body Size

Client menjadi rentan terhadap remote bug/malicious response.

---

## 29. Production Checklist Body Handling

### Request Body Checklist

```text
[ ] Content-Type benar.
[ ] Charset eksplisit jika text.
[ ] Body DTO terpisah dari domain object.
[ ] Body size diketahui atau dibatasi.
[ ] Body repeatability diketahui.
[ ] Retry policy mempertimbangkan body.
[ ] Sensitive data tidak dilog.
[ ] Multipart boundary dikelola library.
[ ] File upload validate size/type/name.
[ ] Checksum/idempotency dipertimbangkan untuk upload penting.
```

### Response Body Checklist

```text
[ ] Status dicek sebelum parse success body.
[ ] Error body diparse/modelkan.
[ ] Empty body ditangani.
[ ] Content-Type divalidasi.
[ ] Body besar distream, bukan dibuffer.
[ ] Response/stream ditutup.
[ ] Max body size diterapkan untuk buffered body.
[ ] Malformed body diklasifikasikan sebagai protocol error.
[ ] Error preview dibatasi dan diredact.
[ ] Download memakai temp file lalu atomic move.
```

### Observability Checklist

```text
[ ] Metric body size request/response.
[ ] Metric parse duration.
[ ] Metric body limit exceeded.
[ ] Metric unexpected content type.
[ ] Log metadata, bukan full body.
[ ] Redaction diterapkan.
[ ] Trace/correlation ID tetap dipropagasi.
```

### Testing Checklist

```text
[ ] Success JSON.
[ ] Error JSON.
[ ] Error HTML.
[ ] Empty body.
[ ] Malformed body.
[ ] Large body.
[ ] Slow body.
[ ] Mid-stream disconnect.
[ ] Multipart request shape.
[ ] File download cleanup on failure.
```

---

## 30. Decision Matrix

| Scenario | Recommended Body Strategy | Notes |
|---|---|---|
| Small JSON request | serialize DTO to string/bytes | OK to buffer |
| Small JSON response | parse string/byte body | limit size |
| OAuth token request | form URL encoded builder | never concatenate manually |
| Multipart upload | library multipart builder | OkHttp/Retrofit ergonomic |
| Large file upload | file-backed request body | avoid `readAllBytes` |
| Large file download | stream to temp file | atomic move after success |
| Unknown response size | stream or bounded read | protect heap |
| Error response | bounded preview + parse if JSON | avoid losing status |
| Long-lived stream | streaming reader/subscriber | cancellation required |
| Retryable POST | repeatable body + idempotency key | semantic safety required |

---

## 31. Top 1% Mental Model

Engineer biasa melihat body sebagai:

```text
JSON in, JSON out
```

Engineer kuat melihat body sebagai:

```text
bounded or unbounded byte stream
+ media type
+ encoding
+ lifecycle
+ memory model
+ retry semantics
+ parse contract
+ error contract
+ security exposure
+ observability signal
```

Engineer top-tier tahu bahwa:

1. Body adalah resource, bukan hanya value.
2. Body lifecycle menentukan connection reuse.
3. Body size menentukan memory safety.
4. Body repeatability menentukan retry safety.
5. Content-Type menentukan parser correctness.
6. Error body adalah bagian contract.
7. Large body harus distream.
8. Sensitive body tidak boleh dilog sembarangan.
9. Multipart punya struktur protocol, bukan string concatenation.
10. File download harus atomic dan recoverable.
11. Body parse failure harus dibedakan dari transport failure.
12. HTTP client boundary harus melindungi domain dari external payload shape.

Jika satu kalimat harus merangkum part ini:

> Treat HTTP body as a controlled stream crossing a trust boundary, not as a convenient string.

---

## 32. Hubungan ke Part Berikutnya

Part ini membahas body. Namun body handling sangat terkait dengan timeout.

Contoh:

- upload besar butuh write timeout yang realistis,
- download besar butuh read timeout yang tidak salah dimaknai,
- streaming response tidak cocok dengan timeout pendek yang didesain untuk JSON kecil,
- retry body harus berada dalam total deadline,
- parse body juga memakai waktu dan CPU.

Karena itu part berikutnya akan masuk ke:

```text
Part 6 — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS
```

Di sana kita akan membedah kenapa “timeout 30 detik” bukan desain yang cukup, dan bagaimana merancang timeout sebagai budget end-to-end.

---

## 33. Referensi Resmi dan Relevan

- Oracle Java Documentation — `java.net.http.HttpClient`, `HttpRequest.BodyPublishers`, `HttpResponse.BodyHandlers`.
- OpenJDK HTTP Client Introduction — body publisher/subscriber model dan reactive streams.
- OkHttp Documentation — `RequestBody`, `ResponseBody`, `FormBody`, `MultipartBody`, recipes, response lifecycle.
- Retrofit Documentation — `@Body`, `@FormUrlEncoded`, `@Multipart`, converter factory.
- Apache HttpClient 5 Documentation — classic/async API, entity model, connection/resource handling.
- Jackson Documentation — streaming parser dan object mapping behavior.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./04-http-headers-content-negotiation-compression-metadata.md">⬅️ Part 4 — Headers, Content Negotiation, Compression, dan Metadata Contract</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./06-timeout-engineering-connect-read-write-call-pool-dns-tls.md">Part 6 — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS ➡️</a>
</div>
