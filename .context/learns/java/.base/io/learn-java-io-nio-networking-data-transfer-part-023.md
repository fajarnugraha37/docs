# Part 023 — HTTP Data Transfer: Java HTTP Client, Streaming Body, Timeout, Redirect, Proxy, dan TLS

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-023.md`  
> Level: Advanced  
> Prasyarat langsung: Part 019–020 tentang networking/TCP dan Part 021 tentang NIO/event-loop mental model.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami `java.net.http.HttpClient` bukan sebagai sekadar API request HTTP, tetapi sebagai abstraction untuk **data transfer di atas HTTP**.
2. Membedakan dengan jelas antara:
   - request metadata,
   - request body,
   - response metadata,
   - response body,
   - connection lifecycle,
   - transfer lifecycle,
   - application-level semantics.
3. Mendesain upload/download besar tanpa membaca semua payload ke memory.
4. Menggunakan `BodyPublisher`, `BodyHandler`, dan `BodySubscriber` dengan mental model backpressure.
5. Memahami batas timeout, redirect, proxy, TLS, retry, idempotency, checksum, dan resumable transfer.
6. Menentukan kapan `HttpClient` Java standard library cukup, dan kapan perlu library/framework lain.
7. Menghindari bug umum seperti OOM karena `BodyHandlers.ofString()`, retry POST tidak aman, timeout salah tempat, redirect kehilangan header, dan partial download tidak terdeteksi.

---

## 2. Mental Model Besar: HTTP sebagai Data Transfer Protocol

HTTP sering diajarkan sebagai:

```text
client -> request -> server -> response
```

Itu terlalu sederhana untuk production data transfer.

Untuk topik I/O, HTTP lebih tepat dimodelkan seperti ini:

```text
Application Intent
  -> HTTP Method + URI + Headers
  -> Request Body Publisher
  -> Client Connection Pool
  -> TCP/TLS Transport
  -> Server Processing
  -> Response Status + Headers
  -> Response Body Subscriber
  -> Application Sink
```

Setiap layer punya failure mode sendiri.

| Layer | Contoh | Failure |
|---|---|---|
| Intent | upload invoice PDF | duplicate upload, wrong idempotency |
| HTTP metadata | method, URI, headers | wrong content type, auth expired |
| Request body | bytes dari file/input stream | source file berubah, stream gagal |
| Connection | pooled socket | stale connection, reset |
| TLS | HTTPS handshake | expired certificate, hostname mismatch |
| Server | remote processing | 4xx, 5xx, timeout |
| Response body | bytes response | truncated body, disk full saat download |
| Application sink | write file/db/object storage | partial write, checksum mismatch |

Top 1% engineer tidak hanya bertanya “bagaimana cara call API?”, tetapi:

- apakah body bisa besar?
- apakah response harus streaming?
- apakah request aman di-retry?
- apakah failure bisa menghasilkan duplicate?
- apakah timeout berlaku untuk seluruh transfer atau hanya connect?
- apakah response sudah diverifikasi?
- apakah file akhir ditulis atomically?
- apakah credential bocor di log?
- apakah redirect boleh membawa Authorization header?
- apakah download bisa dilanjutkan?

---

## 3. API Utama `java.net.http`

Java modern menyediakan module `java.net.http`. Package ini menyediakan high-level client untuk HTTP/1.1 dan HTTP/2, serta API WebSocket. Tipe utama yang paling penting untuk HTTP transfer adalah:

- `HttpClient`
- `HttpRequest`
- `HttpResponse`
- `HttpRequest.BodyPublishers`
- `HttpResponse.BodyHandlers`
- `HttpResponse.BodySubscribers`

Mental model-nya:

```text
HttpClient
  = reusable, immutable, connection/config owner

HttpRequest
  = immutable description of one HTTP request

BodyPublisher
  = source of request body bytes

BodyHandler<T>
  = decides how to handle response body after status+headers arrive

BodySubscriber<T>
  = consumes response body bytes and produces final T

HttpResponse<T>
  = status + headers + body result T
```

Penting: `HttpClient` sebaiknya dibuat sekali dan dipakai ulang, bukan dibuat setiap request.

```java
HttpClient client = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_2)
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
```

`HttpClient` bersifat immutable setelah dibuat. Konfigurasi seperti preferred protocol version, redirect policy, proxy, authenticator, executor, SSL context, dan connect timeout dipasang di builder.

---

## 4. Request: Metadata, Method, Header, Body

### 4.1 Request bukan hanya URI

Request HTTP minimal punya:

```text
method + URI + headers + optional body
```

Contoh GET sederhana:

```java
HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://example.com/api/documents/123"))
        .timeout(Duration.ofSeconds(10))
        .header("Accept", "application/json")
        .GET()
        .build();
```

Contoh POST JSON kecil:

```java
String json = "{\"name\":\"report.pdf\"}";

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://example.com/api/documents"))
        .timeout(Duration.ofSeconds(15))
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Accept", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
        .build();
```

### 4.2 Method semantics mempengaruhi retry

HTTP method bukan dekorasi. Ia membawa semantics.

| Method | Umumnya safe? | Umumnya idempotent? | Catatan |
|---|---:|---:|---|
| GET | Ya | Ya | Tidak boleh mengubah state menurut semantics HTTP |
| HEAD | Ya | Ya | Metadata saja |
| PUT | Tidak safe | Ya | Replace/create resource di URI tertentu |
| DELETE | Tidak safe | Ya secara semantics | Bisa tetap punya efek audit/log |
| POST | Tidak | Tidak | Create/action; retry bisa duplicate |
| PATCH | Tidak | Tidak selalu | Partial update, harus hati-hati |

Untuk data transfer, ini sangat penting:

- retry GET download biasanya aman secara application semantics;
- retry PUT upload ke object key yang sama bisa aman jika resource immutable atau checksum diverifikasi;
- retry POST upload bisa menciptakan duplicate object jika tidak ada idempotency key;
- retry PATCH hampir selalu butuh domain-specific guard.

### 4.3 Header adalah kontrak, bukan tempelan

Header penting untuk transfer:

| Header | Fungsi |
|---|---|
| `Content-Type` | format request body |
| `Content-Length` | ukuran body jika diketahui |
| `Transfer-Encoding` | chunked transfer di HTTP/1.1, biasanya dikelola client |
| `Accept` | format response yang diinginkan |
| `Authorization` | credential/token |
| `Range` | download sebagian |
| `If-Match` | conditional update berdasarkan ETag |
| `If-None-Match` | caching/conditional fetch |
| `ETag` | validator resource |
| `Content-Encoding` | compression encoding, misalnya gzip |
| `Digest` atau custom checksum header | integrity check |
| `Idempotency-Key` | deduplication untuk unsafe retry |

Rule praktis:

> Jangan retry operasi yang mengubah state kecuali kamu bisa menjelaskan mekanisme deduplication atau idempotency-nya.

---

## 5. Sending Request: Synchronous vs Asynchronous

### 5.1 Synchronous `send`

```java
HttpResponse<String> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
);

int status = response.statusCode();
String body = response.body();
```

Model ini blocking terhadap thread pemanggil sampai response selesai diterima sesuai `BodyHandler`.

Cocok untuk:

- CLI sederhana;
- batch job sederhana;
- request yang jumlahnya kecil;
- kode dengan virtual threads;
- logic yang lebih mudah dibaca secara sequential.

### 5.2 Asynchronous `sendAsync`

```java
CompletableFuture<HttpResponse<String>> future = client.sendAsync(
        request,
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
);

future.thenApply(HttpResponse::body)
      .thenAccept(System.out::println)
      .exceptionally(ex -> {
          ex.printStackTrace();
          return null;
      });
```

Model ini menghasilkan `CompletableFuture`.

Cocok untuk:

- fan-out beberapa request;
- integration dengan pipeline async;
- UI/non-blocking workflow;
- ketika ingin compose beberapa remote call.

Namun async bukan otomatis lebih benar.

Kesalahan umum:

```java
client.sendAsync(request, BodyHandlers.ofString())
      .thenApply(response -> heavyCpuWork(response.body())); // bisa menjalankan kerja berat di executor yang tidak kamu kontrol
```

Untuk production, pertimbangkan executor eksplisit:

```java
ExecutorService executor = Executors.newFixedThreadPool(32);

HttpClient client = HttpClient.newBuilder()
        .executor(executor)
        .connectTimeout(Duration.ofSeconds(5))
        .build();
```

Catatan desain:

- executor client mempengaruhi task asynchronous internal/callback tertentu;
- jangan menjalankan parsing besar, write database berat, atau blocking call sembarangan di completion chain;
- bounded executor lebih aman daripada unbounded concurrency.

---

## 6. Response Handling: Jangan Selalu `ofString()`

`BodyHandlers.ofString()` nyaman, tetapi berbahaya untuk response besar.

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

Ini berarti seluruh response body dikumpulkan menjadi `String`.

Bahaya:

- OOM untuk payload besar;
- salah charset jika tidak eksplisit;
- binary response rusak jika diperlakukan sebagai text;
- latency tinggi karena application baru memproses setelah body selesai;
- tidak cocok untuk download file.

### 6.1 Handler umum

| Handler | Cocok untuk | Risiko |
|---|---|---|
| `ofString()` | JSON kecil/text kecil | OOM jika body besar |
| `ofByteArray()` | binary kecil | OOM jika body besar |
| `ofInputStream()` | streaming manual | lifecycle wajib benar |
| `ofFile(Path)` | download langsung ke file | partial file perlu strategy |
| `discarding()` | hanya status/header | body diabaikan |
| `ofLines()` | stream baris | lifecycle stream wajib ditutup |

### 6.2 Pattern: response kecil JSON

```java
HttpResponse<String> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
);

if (response.statusCode() / 100 != 2) {
    throw new IOException("HTTP " + response.statusCode() + ": " + response.body());
}

String json = response.body();
```

Ini acceptable jika kamu punya batas ukuran response dari kontrak API.

### 6.3 Pattern: download file langsung

```java
Path target = Path.of("download.bin");

HttpResponse<Path> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofFile(target)
);

if (response.statusCode() != 200) {
    Files.deleteIfExists(target);
    throw new IOException("Download failed: HTTP " + response.statusCode());
}
```

Masalah: jika response gagal di tengah, kamu harus memahami apakah partial file tertinggal, dan apakah target boleh langsung terlihat oleh consumer lain.

Lebih aman:

```java
Path finalPath = Path.of("download.bin");
Path tempPath = finalPath.resolveSibling(finalPath.getFileName() + ".part");

HttpResponse<Path> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofFile(tempPath)
);

if (response.statusCode() == 200) {
    Files.move(tempPath, finalPath,
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE);
} else {
    Files.deleteIfExists(tempPath);
    throw new IOException("Download failed: HTTP " + response.statusCode());
}
```

Ingat dari Part 014: `ATOMIC_MOVE` hanya dijamin jika filesystem mendukung dan source/target berada dalam filesystem yang sama.

---

## 7. Request Body Publisher

### 7.1 Body kecil dari String

```java
HttpRequest.BodyPublisher body = HttpRequest.BodyPublishers.ofString(
        json,
        StandardCharsets.UTF_8
);
```

Cocok untuk JSON kecil.

### 7.2 Body dari byte array

```java
HttpRequest.BodyPublisher body = HttpRequest.BodyPublishers.ofByteArray(bytes);
```

Cocok untuk binary kecil. Jangan untuk file besar.

### 7.3 Body dari file

```java
Path file = Path.of("report.pdf");

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://example.com/upload"))
        .header("Content-Type", "application/pdf")
        .PUT(HttpRequest.BodyPublishers.ofFile(file))
        .build();
```

Ini jauh lebih baik daripada:

```java
byte[] bytes = Files.readAllBytes(file); // buruk untuk file besar
```

### 7.4 Body dari InputStream

```java
HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://example.com/upload"))
        .POST(HttpRequest.BodyPublishers.ofInputStream(() -> {
            try {
                return Files.newInputStream(Path.of("payload.bin"));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }))
        .build();
```

Perhatikan supplier.

Kenapa supplier, bukan langsung `InputStream`?

Karena client mungkin perlu membuka stream saat transfer benar-benar dimulai. Dalam beberapa skenario retry internal/redirect/authentication, body source yang tidak repeatable bisa menjadi masalah.

Rule:

> Untuk retry manual, pastikan body publisher repeatable. File body biasanya lebih aman daripada InputStream sekali pakai.

---

## 8. Streaming Download dengan `ofInputStream()`

`BodyHandlers.ofInputStream()` memberi `InputStream` response body. Ini memberi kontrol penuh.

```java
HttpResponse<InputStream> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofInputStream()
);

if (response.statusCode() != 200) {
    try (InputStream errorBody = response.body()) {
        String error = new String(errorBody.readAllBytes(), StandardCharsets.UTF_8);
        throw new IOException("HTTP " + response.statusCode() + ": " + error);
    }
}

Path temp = Path.of("download.bin.part");

try (InputStream in = response.body();
     OutputStream out = Files.newOutputStream(temp,
             StandardOpenOption.CREATE,
             StandardOpenOption.TRUNCATE_EXISTING,
             StandardOpenOption.WRITE)) {

    byte[] buffer = new byte[64 * 1024];
    long total = 0;
    int n;

    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
        total += n;
    }
}
```

Keuntungan:

- bisa hitung progress;
- bisa hitung checksum sambil membaca;
- bisa enforce max bytes;
- bisa menulis ke custom sink;
- bisa stop lebih awal.

Risiko:

- wajib close `InputStream`;
- jika tidak membaca sampai selesai, connection mungkin tidak reusable;
- blocking read tetap bisa menggantung jika timeout tidak tepat;
- error saat copy perlu cleanup.

---

## 9. Checksum dan Integrity Verification

HTTP success status tidak selalu cukup. Untuk data transfer penting, verifikasi integrity.

Minimal:

```text
expected length from Content-Length
actual bytes written
optional checksum from server
computed checksum locally
```

Contoh checksum SHA-256 saat download:

```java
MessageDigest digest = MessageDigest.getInstance("SHA-256");
long total = 0;

try (InputStream raw = response.body();
     DigestInputStream in = new DigestInputStream(raw, digest);
     OutputStream out = Files.newOutputStream(tempPath,
             StandardOpenOption.CREATE,
             StandardOpenOption.TRUNCATE_EXISTING,
             StandardOpenOption.WRITE)) {

    byte[] buffer = new byte[64 * 1024];
    int n;
    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
        total += n;
    }
}

String actualSha256 = HexFormat.of().formatHex(digest.digest());
```

Jika server memberi checksum:

```java
Optional<String> expected = response.headers()
        .firstValue("X-Checksum-SHA256");

if (expected.isPresent() && !expected.get().equalsIgnoreCase(actualSha256)) {
    Files.deleteIfExists(tempPath);
    throw new IOException("Checksum mismatch");
}
```

Untuk transfer besar, gunakan:

- checksum per chunk;
- whole-object checksum;
- manifest;
- atomic finalization setelah semua verifikasi sukses.

---

## 10. Timeout: Connect Timeout vs Request Timeout vs Read Stall

Timeout sering salah dimengerti.

### 10.1 Connect timeout di `HttpClient`

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();
```

Ini mengatur batas waktu membuat koneksi TCP/TLS awal, bukan seluruh operasi bisnis.

### 10.2 Request timeout di `HttpRequest`

```java
HttpRequest request = HttpRequest.newBuilder()
        .uri(uri)
        .timeout(Duration.ofSeconds(30))
        .GET()
        .build();
```

Ini timeout untuk request tersebut.

### 10.3 Timeout application-level

Untuk download besar, timeout 30 detik total mungkin salah. Transfer 5 GB bisa valid lebih lama. Yang sering dibutuhkan:

- connect timeout pendek;
- response header timeout sedang;
- idle/stall timeout;
- total deadline;
- retry budget.

`HttpClient` standard tidak selalu memberi semua bentuk timeout granular seperti library khusus. Karena itu, untuk transfer besar kamu mungkin perlu membangun kontrol sendiri di atas streaming, executor, cancellation, dan deadline.

Contoh deadline kasar dengan async:

```java
CompletableFuture<HttpResponse<Path>> future = client.sendAsync(
        request,
        HttpResponse.BodyHandlers.ofFile(tempPath)
);

HttpResponse<Path> response = future
        .orTimeout(10, TimeUnit.MINUTES)
        .join();
```

Tapi ini total timeout, bukan idle timeout per read.

---

## 11. Redirect: Nyaman tapi Tidak Selalu Aman

Redirect policy:

```java
HttpClient client = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
```

Pilihan umum:

- `NEVER`
- `NORMAL`
- `ALWAYS`

Risiko redirect:

1. Authorization header bisa menjadi isu jika redirect cross-origin.
2. Method bisa berubah tergantung status code dan policy.
3. Body mungkin tidak dapat dikirim ulang jika non-repeatable.
4. Redirect ke host tidak dipercaya bisa menjadi data exfiltration vector.
5. Signed URL atau pre-signed URL punya expiry dan scope.

Rule production:

- Untuk API internal sensitif, gunakan `NEVER` atau validate target redirect.
- Untuk download publik, `NORMAL` sering cukup.
- Jangan blindly follow redirect untuk upload credentialed payload.

---

## 12. Proxy dan Enterprise Network Reality

Di enterprise, request sering melewati proxy.

```java
HttpClient client = HttpClient.newBuilder()
        .proxy(ProxySelector.of(new InetSocketAddress("proxy.company.local", 8080)))
        .connectTimeout(Duration.ofSeconds(5))
        .build();
```

Dengan authentication:

```java
Authenticator authenticator = new Authenticator() {
    @Override
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication("user", "secret".toCharArray());
    }
};

HttpClient client = HttpClient.newBuilder()
        .proxy(ProxySelector.of(new InetSocketAddress("proxy.company.local", 8080)))
        .authenticator(authenticator)
        .build();
```

Hal yang perlu diperhatikan:

- proxy bisa memutus idle connection;
- proxy bisa membatasi ukuran upload;
- proxy bisa melakukan TLS interception;
- proxy bisa mengubah error menjadi HTML response;
- proxy credential jangan dilog;
- proxy timeout berbeda dari server timeout;
- `407 Proxy Authentication Required` berbeda dari `401 Unauthorized`.

---

## 13. TLS dan HTTPS Boundary

Untuk HTTPS, `HttpClient` menggunakan TLS stack JVM.

Konsep utama:

```text
client truststore validates server certificate
server certificate proves host identity
optional client keystore provides client certificate for mTLS
```

Konfigurasi `SSLContext`:

```java
SSLContext sslContext = SSLContext.getDefault();

HttpClient client = HttpClient.newBuilder()
        .sslContext(sslContext)
        .build();
```

Untuk custom truststore/keystore, biasanya flow-nya:

```text
load KeyStore
init TrustManagerFactory / KeyManagerFactory
init SSLContext
pass SSLContext to HttpClient
```

Kesalahan umum:

- disable certificate validation di production;
- menerima semua hostname;
- mencampur truststore dev dan prod;
- certificate rotation tidak diuji;
- tidak monitor expiry;
- menyimpan private key tanpa protection;
- menaruh PEM/key di log atau exception.

TLS failure yang sering muncul:

| Failure | Kemungkinan penyebab |
|---|---|
| PKIX path building failed | CA tidak dipercaya |
| hostname verification failed | CN/SAN tidak cocok dengan host |
| handshake_failure | protocol/cipher mismatch, client cert issue |
| certificate expired | sertifikat kedaluwarsa |
| bad_certificate | mTLS client cert salah/tidak dipercaya |

Part 024 akan mendalami TLS lebih dalam; di bagian ini cukup pahami bahwa HTTP data transfer tidak aman hanya karena memakai `https://` jika trust, hostname, credential, dan logging tidak benar.

---

## 14. HTTP/1.1 vs HTTP/2

`HttpClient` dapat memilih preferred protocol:

```java
HttpClient client = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_2)
        .build();
```

Namun ini preferred version. Actual version bisa tergantung server, TLS ALPN, proxy, dan environment.

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
System.out.println(response.version());
```

Perbedaan mental model:

| Aspek | HTTP/1.1 | HTTP/2 |
|---|---|---|
| Connection | beberapa request via keep-alive, tapi concurrency terbatas | multiplexing banyak stream dalam satu connection |
| Head-of-line | bisa terjadi di level connection/request | lebih baik di application framing, tapi TCP HOL tetap ada |
| Header | text-ish | HPACK compressed headers |
| Flow control | mainly TCP | HTTP/2 stream/window flow control |
| Use case | compatible luas | banyak small/medium requests, multiplexing |

Untuk large transfer, HTTP/2 tidak otomatis lebih cepat. Large stream bisa mempengaruhi fairness dan flow-control window. Benchmark dengan workload nyata.

---

## 15. Connection Pooling dan Client Lifecycle

`HttpClient` mengelola connection reuse secara internal. Karena itu:

```java
// Baik
static final HttpClient CLIENT = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();
```

Hindari:

```java
// Buruk: membuat client baru untuk tiap request
HttpClient client = HttpClient.newHttpClient();
client.send(request, handler);
```

Kenapa?

- kehilangan connection reuse;
- overhead TLS handshake berulang;
- konfigurasi tidak konsisten;
- sulit mengontrol proxy/TLS/executor;
- observability kacau.

Rule:

> Buat `HttpClient` sebagai infrastructure component, bukan sebagai local temporary object per call.

---

## 16. Upload Besar: Desain yang Benar

### 16.1 Upload file sederhana

```java
Path file = Path.of("large-report.zip");

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://example.com/uploads/large-report.zip"))
        .timeout(Duration.ofMinutes(30))
        .header("Content-Type", "application/zip")
        .PUT(HttpRequest.BodyPublishers.ofFile(file))
        .build();

HttpResponse<String> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
);

if (response.statusCode() / 100 != 2) {
    throw new IOException("Upload failed: HTTP " + response.statusCode() + " " + response.body());
}
```

### 16.2 Upload dengan checksum header

```java
String sha256 = sha256Hex(file);

HttpRequest request = HttpRequest.newBuilder()
        .uri(uploadUri)
        .header("Content-Type", "application/octet-stream")
        .header("X-Checksum-SHA256", sha256)
        .PUT(HttpRequest.BodyPublishers.ofFile(file))
        .build();
```

`sha256Hex`:

```java
static String sha256Hex(Path file) throws IOException, NoSuchAlgorithmException {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream in = Files.newInputStream(file);
         DigestInputStream din = new DigestInputStream(in, digest)) {
        din.transferTo(OutputStream.nullOutputStream());
    }
    return HexFormat.of().formatHex(digest.digest());
}
```

Trade-off: menghitung checksum sebelum upload berarti file dibaca dua kali. Untuk file sangat besar, mungkin gunakan chunked upload dengan checksum per chunk.

### 16.3 Upload POST dengan idempotency key

Jika server hanya menyediakan POST:

```java
String idempotencyKey = UUID.randomUUID().toString();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://example.com/api/uploads"))
        .header("Content-Type", "application/octet-stream")
        .header("Idempotency-Key", idempotencyKey)
        .POST(HttpRequest.BodyPublishers.ofFile(file))
        .build();
```

Server harus menyimpan idempotency key dan hasil operasi. Kalau server tidak mendukung ini, retry POST bisa menciptakan duplicate.

---

## 17. Download Besar: Aman, Atomic, dan Verifiable

Pattern production:

```text
1. download ke file .part
2. hitung bytes dan checksum
3. validasi status/header/checksum
4. fsync jika durability penting
5. atomic move ke nama final
6. publish event/manifest setelah final
```

Contoh:

```java
static Path downloadAtomically(
        HttpClient client,
        URI uri,
        Path finalPath,
        Optional<String> expectedSha256
) throws Exception {
    Path tempPath = finalPath.resolveSibling(finalPath.getFileName() + ".part");
    Files.deleteIfExists(tempPath);

    HttpRequest request = HttpRequest.newBuilder()
            .uri(uri)
            .timeout(Duration.ofMinutes(30))
            .GET()
            .build();

    HttpResponse<InputStream> response = client.send(
            request,
            HttpResponse.BodyHandlers.ofInputStream()
    );

    if (response.statusCode() != 200) {
        try (InputStream error = response.body()) {
            String errorBody = new String(error.readNBytes(8192), StandardCharsets.UTF_8);
            throw new IOException("HTTP " + response.statusCode() + ": " + errorBody);
        }
    }

    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    long total = 0;

    try (InputStream raw = response.body();
         DigestInputStream in = new DigestInputStream(raw, digest);
         OutputStream out = Files.newOutputStream(tempPath,
                 StandardOpenOption.CREATE_NEW,
                 StandardOpenOption.WRITE)) {

        byte[] buffer = new byte[64 * 1024];
        int n;
        while ((n = in.read(buffer)) != -1) {
            out.write(buffer, 0, n);
            total += n;
        }
    } catch (Throwable t) {
        Files.deleteIfExists(tempPath);
        throw t;
    }

    String actualSha256 = HexFormat.of().formatHex(digest.digest());
    if (expectedSha256.isPresent()
            && !expectedSha256.get().equalsIgnoreCase(actualSha256)) {
        Files.deleteIfExists(tempPath);
        throw new IOException("Checksum mismatch. bytes=" + total);
    }

    Files.move(tempPath, finalPath,
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE);

    return finalPath;
}
```

Catatan:

- Untuk production, jangan log full URL jika mengandung token.
- Untuk durability setelah download, bisa gunakan `FileChannel.force(true)` sebelum move.
- Untuk huge file, simpan metadata manifest: URI, ETag, length, checksum, downloadedAt.

---

## 18. Resume Download dengan Range Request

HTTP mendukung partial content menggunakan `Range`.

Request:

```java
HttpRequest request = HttpRequest.newBuilder()
        .uri(uri)
        .header("Range", "bytes=" + existingSize + "-")
        .GET()
        .build();
```

Expected response:

- `206 Partial Content` jika server mendukung range;
- `200 OK` jika server mengabaikan Range;
- `416 Range Not Satisfiable` jika offset tidak valid.

Pattern aman:

```text
1. cek ukuran .part
2. kirim Range bytes=<size>-
3. jika 206, append ke .part
4. jika 200, restart dari awal
5. validasi ETag/Last-Modified agar resource tidak berubah
6. validasi final checksum
```

Contoh skeleton:

```java
long existing = Files.exists(partPath) ? Files.size(partPath) : 0L;

HttpRequest.Builder builder = HttpRequest.newBuilder()
        .uri(uri)
        .timeout(Duration.ofMinutes(30))
        .GET();

if (existing > 0) {
    builder.header("Range", "bytes=" + existing + "-");
}

HttpResponse<InputStream> response = client.send(
        builder.build(),
        BodyHandlers.ofInputStream()
);

if (existing > 0 && response.statusCode() == 206) {
    try (InputStream in = response.body();
         OutputStream out = Files.newOutputStream(partPath,
                 StandardOpenOption.APPEND)) {
        in.transferTo(out);
    }
} else if (response.statusCode() == 200) {
    try (InputStream in = response.body();
         OutputStream out = Files.newOutputStream(partPath,
                 StandardOpenOption.CREATE,
                 StandardOpenOption.TRUNCATE_EXISTING,
                 StandardOpenOption.WRITE)) {
        in.transferTo(out);
    }
} else {
    throw new IOException("Unexpected HTTP " + response.statusCode());
}
```

Resume tanpa validator berbahaya. Jika remote file berubah, kamu bisa menggabungkan awal file versi lama dengan akhir file versi baru.

Gunakan salah satu:

- `ETag`;
- `Last-Modified`;
- checksum manifest;
- versioned object URL;
- immutable object key.

---

## 19. Retry Strategy: HTTP Status dan Exception

Retry bukan `catch Exception lalu ulang`.

### 19.1 Retryable condition

Biasanya retryable:

- network timeout sebelum response final;
- connection reset;
- `503 Service Unavailable`;
- `502 Bad Gateway`;
- `504 Gateway Timeout`;
- `429 Too Many Requests`, dengan menghormati `Retry-After`;
- safe/idempotent request.

Biasanya tidak retryable:

- `400 Bad Request`;
- `401 Unauthorized`, kecuali refresh token lalu ulang;
- `403 Forbidden`;
- `404 Not Found`, kecuali eventual consistency case;
- validation error;
- checksum mismatch tanpa investigation;
- POST tanpa idempotency.

### 19.2 Retry budget

Gunakan:

```text
max attempts
backoff
jitter
total deadline
idempotency guard
observability
```

Contoh simple retry:

```java
static <T> HttpResponse<T> sendWithRetry(
        HttpClient client,
        HttpRequest request,
        HttpResponse.BodyHandler<T> handler,
        int maxAttempts
) throws IOException, InterruptedException {
    IOException lastIo = null;

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            HttpResponse<T> response = client.send(request, handler);
            int status = response.statusCode();

            if (status == 429 || status == 502 || status == 503 || status == 504) {
                if (attempt < maxAttempts && isRetrySafe(request)) {
                    sleepBackoff(attempt, response.headers().firstValue("Retry-After"));
                    continue;
                }
            }

            return response;
        } catch (IOException e) {
            lastIo = e;
            if (attempt >= maxAttempts || !isRetrySafe(request)) {
                throw e;
            }
            sleepBackoff(attempt, Optional.empty());
        }
    }

    throw lastIo != null ? lastIo : new IOException("retry failed");
}

static boolean isRetrySafe(HttpRequest request) {
    String method = request.method();
    if (method.equals("GET") || method.equals("HEAD") || method.equals("PUT") || method.equals("DELETE")) {
        return true;
    }
    return request.headers().firstValue("Idempotency-Key").isPresent();
}

static void sleepBackoff(int attempt, Optional<String> retryAfter) throws InterruptedException {
    long baseMillis = Math.min(30_000L, 250L * (1L << Math.min(attempt - 1, 6)));
    long jitter = ThreadLocalRandom.current().nextLong(0, 250);
    Thread.sleep(baseMillis + jitter);
}
```

Ini masih sederhana. Production retry harus mempertimbangkan:

- body repeatability;
- total deadline;
- per-host rate limit;
- circuit breaker;
- metrics;
- cancellation;
- request correlation id.

---

## 20. Rate Limit dan `Retry-After`

Jika server mengembalikan `429 Too Many Requests`, jangan langsung retry cepat.

```java
Optional<String> retryAfter = response.headers().firstValue("Retry-After");
```

`Retry-After` bisa berbentuk:

- angka detik;
- HTTP date.

Production behavior:

```text
if Retry-After exists:
    wait up to allowed max
else:
    exponential backoff with jitter
```

Untuk transfer besar, juga butuh client-side limiter:

- max concurrent uploads;
- max concurrent downloads;
- bytes/sec limit;
- per-host concurrency;
- queue bound;
- cancellation on shutdown.

---

## 21. Authentication Boundary

Umum:

```java
HttpRequest request = HttpRequest.newBuilder()
        .uri(uri)
        .header("Authorization", "Bearer " + token)
        .GET()
        .build();
```

Risiko:

- token bocor di log;
- token dikirim ke redirected host;
- token expired saat upload besar;
- retry dengan token lama menghasilkan 401 loop;
- token ditaruh di query parameter;
- response error dari proxy/server mencetak token.

Pattern:

```text
1. token provider terpisah
2. inject header terakhir sebelum send
3. refresh on 401 maksimal sekali
4. jangan log Authorization
5. jangan follow redirect ke host berbeda untuk request authenticated tanpa validasi
```

---

## 22. Content Encoding dan Compression

HTTP response bisa compressed, misalnya gzip.

Header terkait:

```text
Accept-Encoding: gzip
Content-Encoding: gzip
```

Dengan Java `HttpClient`, detail decompression bisa bergantung pada header dan implementation behavior. Untuk transfer yang harus integrity-verified, bedakan:

```text
compressed bytes over wire
vs
uncompressed entity body exposed to application
```

Checksum harus jelas menghitung yang mana.

Untuk file transfer binary:

- jika server mengirim file zip, jangan minta gzip tambahan kecuali perlu;
- double compression sering tidak berguna;
- compressed response membuat `Content-Length` bisa mereferensikan compressed length;
- progress bar bisa misleading jika decompressed size berbeda.

---

## 23. Multipart Upload: Konsep dan Batas Standard Library

Java standard `HttpClient` tidak menyediakan builder multipart/form-data high-level seperti beberapa library lain. Tapi bisa dibuat manual.

Konsep multipart:

```text
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="metadata"
Content-Type: application/json

{...}
--boundary
Content-Disposition: form-data; name="file"; filename="a.pdf"
Content-Type: application/pdf

<file bytes>
--boundary--
```

Untuk payload kecil, manual body publisher bisa dibuat dari byte arrays. Untuk file besar, multipart streaming lebih kompleks karena harus menggabungkan:

- prefix bytes;
- file body;
- suffix bytes;
- correct content length jika dibutuhkan;
- repeatability;
- charset/header escaping;
- error handling.

Rule praktis:

- Untuk multipart kecil, standard `HttpClient` cukup.
- Untuk multipart besar dan kompleks, pertimbangkan library yang mendukung streaming multipart robust.
- Jangan `Files.readAllBytes(file)` untuk membuat multipart file besar.

---

## 24. Observability untuk HTTP Transfer

Setiap transfer penting harus punya traceable metadata.

Log minimal:

```text
correlationId
method
safe URI template, not raw signed URL
host
status
attempt
bytes sent/received
elapsed time
checksum result
retry decision
failure category
```

Jangan log:

- Authorization header;
- cookies;
- signed URL full query;
- request/response body yang mengandung PII;
- certificate private material;
- full binary payload.

Metrics:

| Metric | Tujuan |
|---|---|
| request count by host/status | health overview |
| latency histogram | detect slowness |
| bytes uploaded/downloaded | capacity planning |
| retry count | instability signal |
| timeout count | network/server issue |
| checksum failure count | integrity issue |
| active transfers | concurrency control |
| queue depth | backpressure |
| download resume count | network reliability |

Tracing:

- propagate correlation id;
- use W3C traceparent jika sistem mendukung;
- annotate retry attempt;
- annotate remote host dan status class, bukan secret URI.

---

## 25. Failure Model HTTP Data Transfer

| Failure | Gejala | Desain yang benar |
|---|---|---|
| DNS gagal | `UnknownHostException` | retry terbatas, alert config/network |
| connect timeout | gagal sebelum connect | connect timeout pendek, retry safe |
| TLS fail | handshake exception | fix trust/cert, jangan bypass validation |
| 401 | unauthorized | refresh token maksimal sekali |
| 403 | forbidden | jangan retry buta |
| 404 | not found | retry hanya jika eventual consistency valid |
| 429 | rate limited | hormati Retry-After, limiter |
| 500 | server error | retry dengan budget jika safe |
| body truncated | checksum/length mismatch | delete temp, retry/resume |
| disk full | IOException saat write | cleanup temp, alert storage |
| slow response | transfer lama | stall timeout/deadline/progress monitor |
| redirect unsafe | credential leak | validate redirect host/policy |
| duplicate upload | retry POST | idempotency key atau PUT immutable key |
| stale partial file | resume salah | ETag/checksum/version validator |

---

## 26. Decision Matrix

### 26.1 Response handler

| Kebutuhan | Pilihan |
|---|---|
| JSON kecil | `BodyHandlers.ofString(UTF_8)` |
| binary kecil | `BodyHandlers.ofByteArray()` |
| download file biasa | `BodyHandlers.ofFile(tempPath)` + atomic move |
| download dengan checksum/progress | `BodyHandlers.ofInputStream()` |
| hanya status | `BodyHandlers.discarding()` |
| streaming lines | `BodyHandlers.ofLines()` dengan close discipline |

### 26.2 Request body

| Kebutuhan | Pilihan |
|---|---|
| JSON kecil | `BodyPublishers.ofString(json, UTF_8)` |
| binary kecil | `BodyPublishers.ofByteArray(bytes)` |
| upload file besar | `BodyPublishers.ofFile(path)` |
| generated stream | `BodyPublishers.ofInputStream(supplier)` |
| no body | `BodyPublishers.noBody()` |

### 26.3 Client model

| Kebutuhan | Pilihan |
|---|---|
| sederhana/sequential | `send` |
| banyak concurrent call | `sendAsync` + bounded design |
| blocking call skala tinggi | virtual threads bisa cocok |
| streaming besar dengan kontrol detail | `ofInputStream()` dan manual pipeline |
| multipart kompleks | pertimbangkan library khusus |

---

## 27. Production Pattern: Reliable HTTP Download Service

State machine:

```text
NEW
  -> RESOLVING_METADATA
  -> DOWNLOADING_TO_TEMP
  -> VERIFYING
  -> FINALIZING
  -> COMPLETED

Failure:
  -> RETRY_WAIT
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT
```

Metadata table/file:

```text
transfer_id
source_uri_hash
safe_display_name
status
attempt
etag
expected_length
expected_checksum
actual_length
actual_checksum
temp_path
final_path
started_at
updated_at
completed_at
last_error_category
```

Rules:

1. Never expose final file before verification.
2. Always download to `.part`.
3. Store validator: ETag/checksum/version.
4. Retry only if safe.
5. On restart, reconcile `.part` with metadata.
6. If remote supports Range and validator matches, resume.
7. If validator mismatches, delete `.part` and restart.
8. Publish completion only after atomic move.
9. Make cleanup idempotent.
10. Emit metrics for bytes, duration, attempts, failures.

---

## 28. Production Pattern: Reliable HTTP Upload Service

State machine:

```text
NEW
  -> PREPARING_SOURCE
  -> COMPUTING_CHECKSUM
  -> UPLOADING
  -> VERIFYING_REMOTE_ACK
  -> COMPLETED

Failure:
  -> RETRY_WAIT
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT
```

Rules:

1. Prefer `PUT` to deterministic resource URI for idempotent upload.
2. If using `POST`, require `Idempotency-Key` support.
3. Use file body publisher, not byte array, for large file.
4. Include checksum if server supports it.
5. Treat 2xx as transport success, not necessarily business success.
6. Parse response contract.
7. Retry only if body is repeatable and operation safe.
8. Preserve audit trail: source checksum, size, destination id, attempts.
9. Never log full body or secret URL.
10. Validate remote side if API supports HEAD/metadata fetch after upload.

---

## 29. Anti-Pattern

### 29.1 Read entire file into memory before upload

```java
byte[] bytes = Files.readAllBytes(path);
BodyPublisher body = BodyPublishers.ofByteArray(bytes);
```

Buruk untuk file besar.

Gunakan:

```java
BodyPublishers.ofFile(path)
```

### 29.2 Download besar sebagai String

```java
BodyHandlers.ofString()
```

Buruk untuk binary dan payload besar.

Gunakan:

```java
BodyHandlers.ofFile(tempPath)
// atau
BodyHandlers.ofInputStream()
```

### 29.3 Retry semua request

```java
catch (Exception e) {
    return sendAgain();
}
```

Berbahaya untuk POST/PATCH dan non-repeatable body.

### 29.4 Menganggap HTTP 200 berarti file valid

HTTP 200 hanya status protocol. File tetap bisa salah jika:

- body truncated;
- proxy mengembalikan HTML;
- content type salah;
- server bug;
- disk write gagal;
- checksum mismatch.

### 29.5 Follow redirect buta untuk request authenticated

Redirect bisa mengirim data ke host lain jika tidak dikontrol.

### 29.6 Membuat `HttpClient` per request

Menghilangkan reuse dan membuat behavior sulit dikontrol.

### 29.7 Logging raw URL dengan token

Signed URL sering mengandung credential di query parameter.

---

## 30. Testing Strategy

### 30.1 Unit test

Test pure logic:

- retry decision;
- idempotency rule;
- checksum validation;
- filename/path sanitizer;
- status code mapping;
- `Retry-After` parser.

### 30.2 Integration test

Gunakan local HTTP server/test container untuk simulasi:

- 200 success;
- 206 partial content;
- 401 then success after token refresh;
- 429 with Retry-After;
- 500 retry;
- connection reset mid-body;
- slow response;
- wrong checksum;
- wrong content length;
- redirect same host;
- redirect different host.

### 30.3 Large file test

- 100 MB;
- 1 GB jika environment memungkinkan;
- low memory JVM;
- disk full simulation;
- interrupted download;
- resume after restart;
- concurrent downloads.

### 30.4 Security test

- ensure Authorization not logged;
- reject unsafe redirect;
- reject unexpected content type if required;
- avoid writing final file on failed verification;
- ensure TLS validation not disabled.

---

## 31. Checklist Engineering

Sebelum membuat HTTP transfer production:

- [ ] Apakah payload bisa besar?
- [ ] Apakah request body streaming?
- [ ] Apakah response body streaming?
- [ ] Apakah timeout sudah dipisah antara connect, request/deadline, dan stall?
- [ ] Apakah operasi aman di-retry?
- [ ] Jika POST, apakah ada idempotency key?
- [ ] Apakah checksum/length diverifikasi?
- [ ] Apakah file ditulis ke temp lalu atomic move?
- [ ] Apakah partial file bisa direconcile saat restart?
- [ ] Apakah Range/resume butuh ETag/checksum validator?
- [ ] Apakah redirect policy aman?
- [ ] Apakah proxy behavior dipertimbangkan?
- [ ] Apakah TLS truststore/hostname validation benar?
- [ ] Apakah token/secret tidak bocor ke log?
- [ ] Apakah concurrency dibatasi?
- [ ] Apakah rate limit dihormati?
- [ ] Apakah metric dan trace cukup?
- [ ] Apakah failure dikategorikan retryable/permanent?
- [ ] Apakah cleanup idempotent?
- [ ] Apakah test mencakup partial transfer dan disk failure?

---

## 32. Ringkasan

`java.net.http.HttpClient` adalah API standard Java yang kuat untuk HTTP/1.1 dan HTTP/2. Namun untuk data transfer serius, yang penting bukan hanya membuat request, melainkan mengelola seluruh lifecycle:

```text
intent -> metadata -> body streaming -> connection/TLS -> status/header -> response streaming -> verification -> atomic publish
```

Prinsip utama:

1. Reuse `HttpClient`.
2. Jangan pakai `ofString()`/`ofByteArray()` untuk payload besar.
3. Gunakan `ofFile()` atau `ofInputStream()` untuk download besar.
4. Gunakan `ofFile()` untuk upload file besar.
5. Retry hanya jika operasi safe/idempotent atau punya idempotency key.
6. Verifikasi checksum/length untuk transfer penting.
7. Tulis ke temp file lalu atomic move.
8. Jangan percaya redirect/token/logging secara buta.
9. Treat HTTP status as protocol signal, not full business correctness.
10. Bangun transfer sebagai state machine jika reliability penting.

Part berikutnya akan masuk lebih dalam ke TLS, certificate, truststore, keystore, mTLS, hostname verification, dan secure data transfer.

---

## 33. Status Seri

Seri belum selesai.

Part yang sudah dibuat sampai titik ini:

- Part 000 — Mental Model Besar Java I/O
- Part 001 — Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug
- Part 002 — Classic `java.io`: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle
- Part 003 — Buffering Deep Dive
- Part 004 — Binary I/O
- Part 005 — Character I/O
- Part 006 — Console I/O
- Part 007 — NIO Core
- Part 008 — ByteBuffer Deep Dive
- Part 009 — FileChannel
- Part 010 — Memory-Mapped File
- Part 011 — NIO.2 File API
- Part 012 — File Attributes, Permissions, Ownership, Metadata
- Part 013 — Directory Traversal, File Tree Walking, Search, Copy, Move, Delete
- Part 014 — Temporary File, Atomic File Write, File Replacement, Crash-Safe Persistence
- Part 015 — WatchService
- Part 016 — Serialization I
- Part 017 — Serialization II
- Part 018 — Compression
- Part 019 — Networking I
- Part 020 — Networking II
- Part 021 — NIO Networking
- Part 022 — UDP, Datagram, Multicast
- Part 023 — HTTP Data Transfer

Part berikutnya:

```text
learn-java-io-nio-networking-data-transfer-part-024.md
```

Topik berikutnya:

```text
TLS, Certificates, TrustStore, KeyStore, dan Secure Data Transfer
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 022 — UDP, Datagram, Multicast, dan Kapan Tidak Boleh Memakai TCP](./learn-java-io-nio-networking-data-transfer-part-022.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 024 — TLS, Certificates, TrustStore, KeyStore, dan Secure Data Transfer](./learn-java-io-nio-networking-data-transfer-part-024.md)

</div>