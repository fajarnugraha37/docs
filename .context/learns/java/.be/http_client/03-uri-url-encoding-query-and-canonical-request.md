# Part 3 — URI, URL, Encoding, Query Parameter, dan Canonical Request

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `03-uri-url-encoding-query-and-canonical-request.md`  
Target Java: 8 sampai 25  
Level: Advanced / Production Engineering

---

## 1. Tujuan Part Ini

Pada level pemula, URL sering dianggap hanya string seperti ini:

```text
https://api.example.com/users/123?active=true
```

Lalu engineer menulis kode seperti ini:

```java
String url = baseUrl + "/users/" + userId + "?active=" + active;
```

Untuk demo, ini sering terlihat cukup. Untuk production system, terutama sistem yang berhubungan dengan payment, identity, government integration, audit trail, API gateway, webhook, object storage, search, atau signed request, cara pikir seperti ini berbahaya.

Masalahnya bukan hanya apakah URL tersebut terlihat benar oleh manusia. Masalah sebenarnya adalah:

1. Apakah setiap komponen URI ditempatkan di posisi yang benar?
2. Apakah karakter khusus di-encode sesuai konteks komponennya?
3. Apakah client dan server menafsirkan path/query dengan cara yang sama?
4. Apakah request yang dikirim sama dengan request yang ditandatangani?
5. Apakah retry, cache, deduplication, audit, dan observability memakai identitas request yang konsisten?
6. Apakah data sensitif tidak bocor melalui query string?
7. Apakah dynamic URL tidak membuka celah SSRF, open redirect, atau signature bypass?

Part ini membangun mental model bahwa URI bukan sekadar string. URI adalah **structured protocol boundary**. Jika boundary ini salah, bug-nya sering sulit dilihat karena request tetap tampak seperti HTTP request normal.

---

## 2. Core Mental Model

HTTP request target dapat dipahami sebagai struktur, bukan string.

```text
scheme://authority/path?query#fragment
```

Contoh:

```text
https://api.example.com:8443/v1/users/123/orders?status=PAID&limit=50#section
```

Dipecah menjadi:

```text
scheme     = https
authority  = api.example.com:8443
host       = api.example.com
port       = 8443
path       = /v1/users/123/orders
query      = status=PAID&limit=50
fragment   = section
```

Untuk HTTP client, fragment hampir selalu tidak dikirim ke server. Fragment dipakai oleh client/user agent, bukan bagian dari HTTP request ke origin server.

Mental model yang harus dipegang:

```text
URI string
  bukan sama dengan
request intent

request intent
  harus dibangun dari komponen terstruktur
  lalu di-render menjadi URI final
```

Dengan kata lain, engineer top-tier tidak bertanya:

> Bagaimana cara concat URL?

Tetapi bertanya:

> Komponen mana yang sedang saya isi, aturan encoding apa yang berlaku untuk komponen itu, dan siapa yang akan menafsirkan hasil akhirnya?

---

## 3. URI vs URL vs URN

### 3.1 URI

URI adalah **Uniform Resource Identifier**. Ia mengidentifikasi resource. Tidak semua URI memberi tahu cara mengakses resource.

Contoh URI:

```text
https://api.example.com/users/123
mailto:support@example.com
urn:isbn:9780134685991
```

Dalam Java, `java.net.URI` adalah representasi URI yang immutable dan mendukung parsing, normalizing, resolving, dan relativizing.

### 3.2 URL

URL adalah URI yang juga menunjukkan lokasi/cara mengakses resource.

Contoh URL:

```text
https://api.example.com/users/123
ftp://files.example.com/report.csv
```

Dalam Java modern, untuk membangun dan memvalidasi alamat HTTP, biasanya lebih aman berpikir menggunakan `URI` atau builder library seperti OkHttp `HttpUrl`, bukan merakit `URL` string mentah.

### 3.3 URN

URN adalah identifier yang tidak harus menunjukkan lokasi network.

Contoh:

```text
urn:isbn:9780134685991
```

### 3.4 Kenapa ini penting untuk HTTP client?

Karena semua URL adalah URI secara abstrak, tetapi tidak semua URI adalah HTTP URL. HTTP client membutuhkan URI dengan scheme yang dapat dikirim lewat network, biasanya `http` atau `https`.

Bug umum:

```java
URI uri = URI.create(inputFromUser);
httpClient.send(HttpRequest.newBuilder(uri).build(), BodyHandlers.ofString());
```

Masalahnya:

1. `inputFromUser` bisa memakai scheme tidak diinginkan.
2. Host bisa mengarah ke internal network.
3. Query bisa membawa data sensitif.
4. Path bisa mengandung encoded traversal.
5. Redirect bisa mengubah authority.

Untuk production system, URI harus melewati policy validation, bukan langsung dipakai.

---

## 4. Anatomy URI untuk HTTP Client

### 4.1 Scheme

Scheme menentukan protokol akses.

```text
https://api.example.com
^^^^^
```

Policy production biasanya:

```text
allow: https
maybe allow: http hanya untuk local/dev/internal legacy dengan kontrol ketat
deny: file, jar, ftp, gopher, ldap, data, javascript, ws kecuali memang eksplisit
```

Untuk service-to-service atau third-party API, default aman adalah `https`.

### 4.2 Authority

Authority adalah bagian setelah `//` sebelum path.

```text
https://user:pass@api.example.com:8443/path
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

Authority dapat terdiri dari:

```text
userinfo@host:port
```

Dalam HTTP API client modern, `userinfo` sebaiknya dihindari.

Buruk:

```text
https://username:password@api.example.com/orders
```

Lebih baik:

```http
Authorization: Basic ...
Authorization: Bearer ...
X-API-Key: ...
```

Alasan:

1. URL sering masuk log.
2. URL bisa muncul di tracing, proxy, browser history, monitoring, error message.
3. Credential di URL lebih mudah bocor.

### 4.3 Host

Host adalah identitas server.

```text
https://api.example.com/v1
        ^^^^^^^^^^^^^^^
```

Host harus divalidasi untuk dynamic outbound call.

Contoh policy:

```text
allowed hosts:
- api.payment-provider.com
- identity.partner.gov.sg
- internal-service.namespace.svc.cluster.local
```

Jangan hanya memeriksa substring.

Buruk:

```java
if (url.contains("api.example.com")) {
    allow();
}
```

Bypass:

```text
https://api.example.com.attacker.net
https://attacker.net/?next=api.example.com
```

Lebih aman:

```java
URI uri = URI.create(input);
String host = uri.getHost();
if (!Set.of("api.example.com").contains(host)) {
    throw new IllegalArgumentException("Host not allowed");
}
```

Tetapi untuk SSRF defense, host validation saja belum cukup. Perlu resolusi DNS/IP validation juga, terutama jika input berasal dari user.

### 4.4 Port

Port default:

```text
http  -> 80
https -> 443
```

Port eksplisit:

```text
https://api.example.com:8443/v1
                       ^^^^
```

Port perlu masuk dalam canonical identity jika berbeda dari default.

```text
https://api.example.com/v1
https://api.example.com:443/v1
```

Secara semantik sering sama, tetapi untuk signature/canonicalization bisa diperlakukan berbeda tergantung aturan signing.

### 4.5 Path

Path menunjukkan resource hierarchy.

```text
https://api.example.com/v1/users/123/orders
                       ^^^^^^^^^^^^^^^^^^^^
```

Path bukan tempat untuk sembarang string. Path terdiri dari segment.

```text
/v1/users/123/orders
 segment: v1
 segment: users
 segment: 123
 segment: orders
```

Masalah besar terjadi ketika nilai dinamis dimasukkan sebagai segment tetapi mengandung `/`, `?`, `#`, `%`, atau karakter reserved.

Contoh:

```java
String userId = "john/doe";
String url = "https://api.example.com/users/" + userId;
```

Hasil:

```text
https://api.example.com/users/john/doe
```

Server bisa membaca ini sebagai dua segment:

```text
users -> john -> doe
```

Padahal intent-nya mungkin satu user id:

```text
users -> john/doe
```

Jika `john/doe` adalah satu segment, `/` harus di-encode sebagai `%2F`, tetapi tidak semua server/router mengizinkan encoded slash karena pertimbangan keamanan.

### 4.6 Query

Query membawa parameter tambahan.

```text
https://api.example.com/orders?status=PAID&limit=50
                              ^^^^^^^^^^^^^^^^^^^^
```

Query bukan sekadar string setelah `?`. Query biasanya adalah sequence name-value pair:

```text
status = PAID
limit  = 50
```

Tetapi query juga bisa punya bentuk lain:

```text
?flag
?tag=a&tag=b
?filter[name]=john
?q=name:john status:active
?ids=1,2,3
?empty=
?null
```

Setiap API punya kontrak interpretasi query sendiri. Client harus mengikuti kontrak itu secara eksplisit.

### 4.7 Fragment

Fragment:

```text
https://example.com/doc#section-1
                       ^^^^^^^^^
```

Fragment tidak dikirim ke server dalam HTTP request normal. Karena itu, fragment tidak boleh digunakan untuk server-side routing atau signing intent kecuali ada protokol khusus di atasnya.

---

## 5. Percent-Encoding: Sumber Banyak Bug Tersembunyi

### 5.1 Apa itu percent-encoding?

Percent-encoding mengubah byte menjadi bentuk `%HH` dalam hexadecimal.

Contoh:

```text
space -> %20
/     -> %2F
?     -> %3F
#     -> %23
%     -> %25
```

Masalahnya: karakter yang harus di-encode berbeda tergantung komponen URI.

Misalnya `?` dalam path perlu di-encode jika dimaksud sebagai data, karena `?` menandai awal query. Tetapi `?` dalam query value mungkin tidak selalu perlu di-encode karena di query ia tidak lagi memulai query baru.

Inilah alasan library seperti OkHttp `HttpUrl` berguna: ia memahami perbedaan encoding per komponen, bukan sekadar menjalankan `URLEncoder` ke seluruh URL.

### 5.2 Jangan encode seluruh URL sekaligus

Buruk:

```java
String encoded = URLEncoder.encode("https://api.example.com/users/john doe", StandardCharsets.UTF_8);
```

Hasilnya kira-kira menjadi:

```text
https%3A%2F%2Fapi.example.com%2Fusers%2Fjohn+doe
```

Itu bukan URL HTTP yang bisa dipakai sebagai request target normal. Yang benar adalah encode **komponen dinamis**, bukan keseluruhan URL.

Benar secara mental model:

```text
scheme  tidak di-encode sebagai data
host    tidak di-encode seperti query
path segment di-encode sebagai path segment
query name/value di-encode sebagai query component
```

### 5.3 `URLEncoder` bukan general URL encoder

Di Java, `URLEncoder` historisnya dipakai untuk HTML form encoding (`application/x-www-form-urlencoded`), bukan general-purpose URI component encoding.

Perilaku penting:

```text
space -> +
```

Dalam query form encoding, `+` sering dipahami sebagai space. Tetapi dalam path, `+` tidak otomatis berarti space. Jika engineer memakai `URLEncoder` untuk path segment, hasilnya bisa salah.

Buruk:

```java
String segment = URLEncoder.encode("john doe", StandardCharsets.UTF_8);
String url = "https://api.example.com/users/" + segment;
```

Hasil:

```text
https://api.example.com/users/john+doe
```

Apakah server membaca `john+doe` sebagai `john doe`? Tidak selalu. Untuk path, space yang aman biasanya `%20`.

Pelajaran:

```text
URLEncoder cocok untuk form/query-style encoding tertentu,
bukan untuk membangun semua bagian URI.
```

### 5.4 Double encoding

Double encoding terjadi ketika data sudah encoded, lalu di-encode lagi.

Input:

```text
john%20doe
```

Jika `%` di-encode lagi:

```text
john%2520doe
```

Karena `%` menjadi `%25`.

Efeknya:

```text
john%20doe   -> decoded sekali -> john doe
john%2520doe -> decoded sekali -> john%20doe
```

Bug seperti ini sering muncul saat:

1. nilai dari config sudah encoded;
2. library builder meng-encode otomatis;
3. engineer meng-encode manual sebelum memasukkan ke builder;
4. signature dibuat dari satu representasi, request dikirim dengan representasi lain.

### 5.5 Under encoding

Under encoding terjadi ketika karakter reserved tidak di-encode padahal dimaksud sebagai data.

Contoh:

```java
String fileName = "report?year=2026.pdf";
String url = "https://storage.example.com/files/" + fileName;
```

Hasil:

```text
https://storage.example.com/files/report?year=2026.pdf
```

Server membaca:

```text
path  = /files/report
query = year=2026.pdf
```

Padahal intent-nya:

```text
path segment = report?year=2026.pdf
```

Seharusnya:

```text
https://storage.example.com/files/report%3Fyear%3D2026.pdf
```

### 5.6 Over encoding

Over encoding terjadi ketika karakter yang seharusnya menjadi delimiter ikut di-encode.

Contoh:

```text
https://api.example.com/v1/users?active=true
```

Jika `?` di-encode sebagai `%3F` pada level seluruh URL:

```text
https://api.example.com/v1/users%3Factive%3Dtrue
```

Server membaca seluruhnya sebagai path, bukan query.

---

## 6. Path Segment vs Path String

### 6.1 Segment adalah boundary penting

Path:

```text
/orgs/acme/users/john
```

Segment:

```text
orgs
acme
users
john
```

Jika nilai dinamis adalah satu segment, gunakan API yang menambahkan segment, bukan concat path string.

Dengan OkHttp:

```java
HttpUrl url = new HttpUrl.Builder()
        .scheme("https")
        .host("api.example.com")
        .addPathSegment("users")
        .addPathSegment("john doe")
        .build();

System.out.println(url);
```

Hasil:

```text
https://api.example.com/users/john%20doe
```

Jika segment mengandung `/`:

```java
.addPathSegment("john/doe")
```

Library akan memperlakukannya sebagai satu segment dan meng-encode slash sesuai aturan path segment.

### 6.2 `addPathSegment` vs `addPathSegments`

Konsep umum di banyak builder:

```text
addPathSegment("a/b")   -> satu segment yang berisi slash sebagai data
addPathSegments("a/b")  -> dua segment: a dan b
```

Perbedaan ini sangat penting.

Contoh intent:

```text
resource id = folder/report.pdf
```

Jika resource id adalah satu identifier, gunakan segment tunggal.

Jika resource id memang hierarchy, gunakan path segments.

### 6.3 Encoded slash problem

Encoded slash `%2F` adalah area rawan.

Beberapa server/router/security filter akan menolak encoded slash atau menormalkannya menjadi `/` sebelum routing. Ini bisa menyebabkan:

1. route mismatch;
2. security bypass;
3. signature mismatch;
4. object key lookup salah;
5. path traversal false positive.

Untuk object storage-like API, slash sering bagian dari object key.

Contoh:

```text
bucket = reports
key    = 2026/06/invoice.pdf
```

Path bisa menjadi:

```text
/reports/2026/06/invoice.pdf
```

Di sini slash memang hierarchy-like delimiter. Tetapi jika API menyatakan key sebagai satu path parameter, perlu hati-hati dengan router.

Rule praktis:

```text
Jangan desain API baru yang membutuhkan encoded slash di path parameter
jika bisa memakai query atau body dengan lebih jelas.
```

---

## 7. Query Parameter: Name, Value, Repetition, Ordering

### 7.1 Query bukan Map sederhana

Banyak engineer memodelkan query sebagai:

```java
Map<String, String> query
```

Ini sering tidak cukup karena query bisa punya:

1. duplicate key;
2. ordered parameter;
3. key tanpa value;
4. empty value;
5. null yang harus diabaikan;
6. array syntax khusus;
7. encoded name;
8. raw query grammar custom.

Contoh:

```text
?tag=java&tag=http&tag=client
```

Jika memakai `Map<String, String>`, hanya satu `tag` yang tersisa.

Lebih akurat:

```text
List<QueryPair>
```

Dengan struktur:

```java
record QueryPair(String name, String value) {}
```

Atau:

```java
Map<String, List<String>>
```

Tetapi untuk canonical signing, bahkan `Map<String, List<String>>` harus punya ordering eksplisit.

### 7.2 Empty vs missing vs null

Bedakan:

```text
?name=       -> name ada, value empty string
?name        -> name ada, value tidak eksplisit
              tergantung parser, bisa dianggap empty atau null
(no name)    -> name tidak ada
```

Dalam Java domain model:

```text
Optional.empty()      -> tidak kirim parameter
""                    -> kirim parameter empty jika API butuh
null                  -> jangan jadikan ambiguous default
```

Rule praktis:

```text
Jangan biarkan null diam-diam berubah menjadi string "null".
```

Bug umum:

```java
String url = base + "?keyword=" + keyword;
```

Jika `keyword == null`:

```text
?keyword=null
```

Ini berbeda dari tidak mengirim keyword.

### 7.3 Query ordering

Untuk banyak server REST biasa, ordering query tidak penting.

```text
?a=1&b=2
?b=2&a=1
```

Tetapi untuk signed request, cache key, deduplication, testing golden file, atau canonical request, ordering bisa penting.

Canonicalization biasanya mengharuskan:

1. sort by parameter name;
2. jika name sama, sort by value;
3. encode name/value dengan aturan tertentu;
4. gabungkan dengan `&`.

Jangan mengandalkan iteration order `HashMap`.

Buruk:

```java
Map<String, String> params = new HashMap<>();
params.put("b", "2");
params.put("a", "1");
String query = params.entrySet().stream()
        .map(e -> e.getKey() + "=" + e.getValue())
        .collect(Collectors.joining("&"));
```

Hasil ordering tidak boleh dijadikan basis signature.

Lebih aman:

```java
Map<String, String> params = new TreeMap<>();
```

Atau sorting eksplisit dengan comparator sesuai canonical spec.

### 7.4 Repeated query parameter

Banyak API memakai repeated parameter:

```text
?status=OPEN&status=CLOSED
```

Alternatif lain:

```text
?status=OPEN,CLOSED
?status[]=OPEN&status[]=CLOSED
?filter[status][0]=OPEN&filter[status][1]=CLOSED
```

Tidak ada satu format universal. API contract harus eksplisit.

Retrofit mendukung List/array untuk query parameter sehingga satu parameter bisa diulang.

```java
@GET("/orders")
Call<List<OrderDto>> listOrders(@Query("status") List<String> statuses);
```

Intent:

```text
/orders?status=OPEN&status=CLOSED
```

### 7.5 Query sebagai data sensitif

Query string sering tersimpan di:

1. access log;
2. reverse proxy log;
3. API gateway log;
4. browser history;
5. metric label jika salah instrumentasi;
6. distributed tracing URL attribute;
7. error message;
8. cache key.

Karena itu hindari data sensitif di query:

```text
?token=...
?password=...
?otp=...
?nric=...
?ssn=...
?api_key=...
```

Jika API third-party memaksa API key di query, mitigasi minimal:

1. redaction di log;
2. jangan masukkan full URL ke exception;
3. jangan jadikan query sebagai metric label;
4. gunakan short retention access log;
5. batasi scope key;
6. gunakan allowlist endpoint.

---

## 8. Canonical Request: Identitas Stabil dari Request

### 8.1 Apa itu canonical request?

Canonical request adalah representasi request yang distandarkan sehingga bisa dipakai untuk:

1. signing;
2. cache key;
3. deduplication;
4. idempotency;
5. audit comparison;
6. golden test;
7. debugging mismatch.

Canonical request biasanya mencakup:

```text
method
scheme
host
port
normalized path
canonical query
selected headers
payload hash
```

Contoh konseptual:

```text
GET
/api/v1/orders
limit=50&status=PAID
host:api.example.com
x-request-date:20260618T050000Z

host;x-request-date
UNSIGNED-PAYLOAD
```

Detail persisnya tergantung protokol. AWS Signature Version 4, misalnya, menggunakan konsep canonical request sebagai bagian proses signing.

### 8.2 Kenapa canonical request penting?

Tanpa canonicalization, dua string berbeda bisa menunjuk intent yang sama:

```text
https://api.example.com/orders?status=PAID&limit=50
https://api.example.com/orders?limit=50&status=PAID
```

Atau sebaliknya, dua string yang terlihat mirip bisa berarti berbeda:

```text
/users/john%2Fdoe
/users/john/doe
```

Atau signature dibuat dari:

```text
/users/john%20doe
```

Tapi request library mengirim:

```text
/users/john+doe
```

Akibatnya server menolak signature, cache miss, dedup gagal, atau audit menyimpan identitas request yang tidak sama dengan network request.

### 8.3 Canonicalization harus mengikuti spec target

Tidak ada canonicalization universal untuk semua API.

Contoh perbedaan:

1. Ada API yang menganggap query order tidak penting.
2. Ada signing spec yang mewajibkan sorted query.
3. Ada server yang decode `%2F` di path.
4. Ada server yang mempertahankan encoded slash.
5. Ada API gateway yang normalize dot-segments.
6. Ada framework yang case-sensitive untuk path, tapi case-insensitive untuk header name.

Rule:

```text
Canonicalization harus mengikuti contract server/signing spec,
bukan preferensi client.
```

### 8.4 Canonicalization dan signing mismatch

Flow yang benar:

```text
build structured request intent
→ render canonical form according to signing spec
→ sign canonical form
→ render actual HTTP request using exact same encoding assumptions
→ send
```

Flow yang berbahaya:

```text
manual concat URL
→ sign string itu
→ masukkan ke library builder
→ library canonicalize/encode lagi
→ request terkirim berbeda dari yang ditandatangani
```

Bug-nya sulit karena log bisa menampilkan URL yang sudah normalized, bukan raw bytes request target.

### 8.5 Payload hash

Beberapa signing protocol memasukkan hash body.

Konsekuensi:

1. Body tidak boleh berubah setelah signing.
2. JSON serialization harus deterministik jika body dibangun ulang.
3. Streaming body perlu strategi khusus.
4. Compression dapat mempengaruhi payload yang benar-benar dikirim.
5. Header `Content-Encoding` harus jelas.

Untuk request signing, jangan berpikir hanya URL. Request identity bisa mencakup body dan header.

---

## 9. Java API: `java.net.URI`

### 9.1 Kapan memakai `URI`

Gunakan `URI` untuk:

1. merepresentasikan alamat yang sudah valid;
2. parsing URI input;
3. mengirim request dengan JDK `HttpClient`;
4. melakukan basic normalization/resolution;
5. memisahkan scheme/host/path/query.

Contoh JDK HttpClient:

```java
HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://api.example.com/users/123"))
        .GET()
        .build();
```

### 9.2 `URI.create` bukan validation policy

`URI.create` hanya membuat/parsing URI. Ia bukan security policy.

```java
URI uri = URI.create(userInput);
```

Setelah itu masih perlu validasi:

```java
if (!"https".equalsIgnoreCase(uri.getScheme())) {
    throw new IllegalArgumentException("Only HTTPS is allowed");
}

if (!allowedHosts.contains(uri.getHost())) {
    throw new IllegalArgumentException("Host is not allowed");
}

if (uri.getUserInfo() != null) {
    throw new IllegalArgumentException("User info is not allowed in URL");
}
```

### 9.3 Komponen raw vs decoded

`URI` punya konsep raw dan decoded component.

Secara mental:

```text
getRawPath()   -> path dengan percent-encoding masih terlihat
getPath()      -> path setelah decoding
getRawQuery()  -> query raw
getQuery()     -> query decoded
```

Untuk canonical signing, raw vs decoded sangat penting.

Contoh:

```text
/users/john%20doe
```

Raw path:

```text
/users/john%20doe
```

Decoded path:

```text
/users/john doe
```

Jika signing spec mengharuskan canonical URI encoded, jangan asal memakai decoded path lalu encode ulang tanpa mengikuti aturan spec.

### 9.4 `normalize()` bukan security sanitizer universal

`URI.normalize()` dapat menghilangkan dot-segments seperti `.` dan `..` dalam path.

Contoh konseptual:

```text
/a/b/../c -> /a/c
```

Tetapi jangan menganggap normalize sebagai SSRF/path traversal sanitizer universal.

Masalah:

1. encoded dot `%2e` mungkin tidak diperlakukan sama;
2. server/proxy mungkin melakukan normalisasi berbeda;
3. double decoding bisa mengubah interpretasi;
4. path traversal pada server side punya konteks filesystem/routing.

Rule:

```text
Normalize untuk canonicalization jika spec meminta.
Validate untuk security.
Jangan mencampur keduanya secara naif.
```

---

## 10. OkHttp `HttpUrl`: Builder yang Sangat Berguna

### 10.1 Kenapa `HttpUrl` penting?

OkHttp `HttpUrl` dirancang untuk compose dan decompose HTTP/HTTPS URL. Ia memahami bahwa encoding berbeda per komponen. Dokumentasi OkHttp menjelaskan bahwa percent-encoding dipakai di setiap URL component kecuali hostname, dan karakter yang perlu di-escape berbeda antar komponen.

Ini tepat untuk production client karena mengurangi string concatenation bug.

### 10.2 Basic usage

```java
HttpUrl url = new HttpUrl.Builder()
        .scheme("https")
        .host("api.example.com")
        .addPathSegment("v1")
        .addPathSegment("users")
        .addPathSegment("john doe")
        .addQueryParameter("active", "true")
        .build();

Request request = new Request.Builder()
        .url(url)
        .get()
        .build();
```

Hasil intent:

```text
https://api.example.com/v1/users/john%20doe?active=true
```

### 10.3 Encoded vs non-encoded API

Builder library sering punya varian:

```text
addQueryParameter
addEncodedQueryParameter
addPathSegment
addEncodedPathSegment
```

Rule:

```text
Gunakan non-encoded variant untuk data mentah.
Gunakan encoded variant hanya jika Anda benar-benar memegang data yang sudah encoded sesuai aturan library.
```

Buruk:

```java
.addQueryParameter("q", "john%20doe")
```

Jika library menganggap input sebagai raw data, `%` akan di-encode menjadi `%25`:

```text
q=john%2520doe
```

Benar jika input raw:

```java
.addQueryParameter("q", "john doe")
```

Benar jika input memang sudah encoded dan API library mendukung:

```java
.addEncodedQueryParameter("q", "john%20doe")
```

Tetapi penggunaan encoded variant harus jarang dan terdokumentasi.

### 10.4 `newBuilder` dari base URL

Pattern umum:

```java
HttpUrl base = HttpUrl.get("https://api.example.com/");

HttpUrl url = base.newBuilder()
        .addPathSegment("v1")
        .addPathSegment("orders")
        .addQueryParameter("status", "PAID")
        .build();
```

Pastikan base URL memiliki trailing slash sesuai intent.

```text
https://api.example.com/base
https://api.example.com/base/
```

Pada URL resolution, trailing slash bisa mengubah hasil relative path. Ini penting untuk Retrofit juga.

---

## 11. Retrofit: `@Path`, `@Query`, dan Encoding Semantics

### 11.1 Retrofit membangun URL dari annotation contract

Retrofit mengubah interface Java menjadi HTTP client.

Contoh:

```java
interface UserApi {
    @GET("/v1/users/{id}")
    Call<UserDto> getUser(@Path("id") String id,
                          @Query("include") String include);
}
```

Pemanggilan:

```java
api.getUser("john doe", "roles");
```

Intent:

```text
GET /v1/users/john%20doe?include=roles
```

### 11.2 `@Path`

`@Path` mengganti placeholder pada path. Nilai biasanya URL encoded secara default.

```java
@GET("/files/{name}")
Call<FileDto> getFile(@Path("name") String name);
```

Jika:

```text
name = report?year=2026.pdf
```

Maka `?` harus menjadi data path, bukan awal query.

### 11.3 `encoded = true`

Retrofit menyediakan opsi `encoded = true` untuk memberi tahu bahwa nilai sudah encoded.

```java
@GET("/files/{path}")
Call<FileDto> getFile(@Path(value = "path", encoded = true) String path);
```

Ini berbahaya jika dipakai tanpa disiplin karena Anda mengambil alih tanggung jawab encoding.

Rule:

```text
Default: encoded=false.
Gunakan encoded=true hanya untuk value yang sudah canonical dan diuji.
```

### 11.4 `@Query`

`@Query` menambahkan query parameter. Nama dan value di-encode secara default.

```java
@GET("/orders")
Call<List<OrderDto>> list(@Query("status") String status,
                          @Query("limit") int limit);
```

Hasil:

```text
/orders?status=PAID&limit=50
```

Jika value null, Retrofit biasanya mengabaikan parameter tersebut. Tetapi Anda tetap harus mendesain domain client agar null semantics eksplisit.

### 11.5 Dynamic URL di Retrofit

Retrofit mendukung `@Url` untuk dynamic URL.

```java
@GET
Call<ResponseBody> get(@Url String url);
```

Ini powerful tetapi rawan:

1. base URL policy bisa dilewati;
2. SSRF risk meningkat;
3. host allowlist perlu manual;
4. tracing endpoint identity lebih sulit;
5. auth interceptor bisa mengirim token ke host yang salah jika tidak hati-hati.

Rule:

```text
Gunakan @Url hanya untuk use case eksplisit seperti pre-signed URL,
redirect-controlled resource, atau endpoint discovery yang tervalidasi.
```

---

## 12. Canonical Query Builder Pattern

Untuk client production, sering berguna punya helper internal yang membangun query secara deterministic.

Contoh model:

```java
public final class QueryParams {
    private final List<Pair> pairs = new ArrayList<>();

    public QueryParams add(String name, String value) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Query name is required");
        }
        if (value != null) {
            pairs.add(new Pair(name, value));
        }
        return this;
    }

    public List<Pair> pairs() {
        return List.copyOf(pairs);
    }

    public record Pair(String name, String value) {}
}
```

Lalu adaptasi ke OkHttp:

```java
QueryParams params = new QueryParams()
        .add("status", "PAID")
        .add("limit", "50");

HttpUrl.Builder builder = base.newBuilder()
        .addPathSegment("orders");

for (QueryParams.Pair pair : params.pairs()) {
    builder.addQueryParameter(pair.name(), pair.value());
}

HttpUrl url = builder.build();
```

Untuk signing:

```java
String canonicalQuery = params.pairs().stream()
        .sorted(Comparator
                .comparing(QueryParams.Pair::name)
                .thenComparing(QueryParams.Pair::value))
        .map(pair -> percentEncodeForSigning(pair.name())
                + "="
                + percentEncodeForSigning(pair.value()))
        .collect(Collectors.joining("&"));
```

Catatan penting: `percentEncodeForSigning` harus mengikuti signing spec, bukan asal memakai `URLEncoder`.

---

## 13. Matrix Parameters dan Path Parameter Semantics

Beberapa server/framework mendukung matrix parameter:

```text
/cars;color=red;year=2026/drivers;age=30
```

Ini jarang dipakai dalam API modern, tetapi bisa muncul di JAX-RS/Jakarta REST heritage.

Masalah:

1. `;` punya makna khusus di path segment untuk beberapa framework.
2. Beberapa proxy/security layer menghapus atau menolak semicolon.
3. URL builder bisa meng-encode atau mempertahankan semicolon tergantung API.

Jika integrasi dengan API yang memakai matrix parameter, dokumentasikan eksplisit:

```text
Apakah ; delimiter path parameter atau data biasa?
Apakah proxy mempertahankan ;?
Apakah signature memakai raw path atau normalized path?
```

Untuk API baru, query parameter lebih umum dan lebih mudah dioperasikan dibanding matrix parameter.

---

## 14. Case Sensitivity

### 14.1 Scheme dan host

Scheme dan host umumnya case-insensitive.

```text
HTTPS://API.EXAMPLE.COM
https://api.example.com
```

Namun canonical form biasanya menurunkan scheme/host menjadi lowercase.

### 14.2 Path

Path umumnya case-sensitive tergantung server.

```text
/users
/Users
```

Jangan normalize path case kecuali contract server menyatakan begitu.

### 14.3 Query

Query parameter name biasanya case-sensitive secara aplikasi.

```text
?status=PAID
?Status=PAID
```

Bisa berbeda.

### 14.4 Header

HTTP header field name case-insensitive, tetapi value tidak selalu.

Untuk canonical signing, header name biasanya dinormalisasi lowercase dan whitespace value dinormalisasi sesuai spec.

---

## 15. Base URL dan Relative URL Pitfall

### 15.1 Trailing slash matters

Base URL:

```text
https://api.example.com/v1
```

Relative:

```text
users
```

Resolution bisa berbeda dari ekspektasi jika base tidak diakhiri `/`.

Bandingkan:

```text
base: https://api.example.com/v1
rel : users
=>   https://api.example.com/users
```

```text
base: https://api.example.com/v1/
rel : users
=>   https://api.example.com/v1/users
```

Dalam Retrofit, base URL biasanya harus berakhir dengan `/`. Ini bukan detail kecil. Ini mencegah ambiguity dalam relative URL resolution.

### 15.2 Leading slash pada endpoint

Endpoint:

```java
@GET("/users")
```

Bisa berarti absolute path dari host root, bukan relatif terhadap base path tertentu.

Jika base URL:

```text
https://api.example.com/api/v1/
```

Maka:

```java
@GET("users")
```

Intent:

```text
/api/v1/users
```

Tetapi:

```java
@GET("/users")
```

Intent:

```text
/users
```

Ini sering menyebabkan request ke endpoint salah tetapi masih valid secara HTTP.

---

## 16. Safe Construction Pattern per Library

### 16.1 JDK `HttpClient` dengan builder URI sederhana

JDK tidak menyediakan full HTTP URL builder seergonomis OkHttp `HttpUrl`. Untuk kasus sederhana, Anda bisa membangun dari komponen secara hati-hati.

Contoh utility minimal:

```java
public final class SimpleUriBuilder {
    private final String scheme;
    private final String host;
    private final List<String> pathSegments = new ArrayList<>();
    private final List<Map.Entry<String, String>> query = new ArrayList<>();

    public SimpleUriBuilder(String scheme, String host) {
        this.scheme = Objects.requireNonNull(scheme);
        this.host = Objects.requireNonNull(host);
    }

    public SimpleUriBuilder pathSegment(String segment) {
        pathSegments.add(Objects.requireNonNull(segment));
        return this;
    }

    public SimpleUriBuilder query(String name, String value) {
        if (value != null) {
            query.add(Map.entry(name, value));
        }
        return this;
    }

    public URI build() {
        String path = "/" + pathSegments.stream()
                .map(SimpleUriBuilder::encodePathSegment)
                .collect(Collectors.joining("/"));

        String queryString = query.stream()
                .map(e -> encodeQueryComponent(e.getKey()) + "=" + encodeQueryComponent(e.getValue()))
                .collect(Collectors.joining("&"));

        String raw = scheme + "://" + host + path + (queryString.isEmpty() ? "" : "?" + queryString);
        return URI.create(raw);
    }

    private static String encodePathSegment(String value) {
        // Simplified for teaching. In production, prefer a proven URI builder.
        return URLEncoder.encode(value, StandardCharsets.UTF_8)
                .replace("+", "%20")
                .replace("%2F", "%2F");
    }

    private static String encodeQueryComponent(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
```

Catatan: contoh ini untuk mental model. Untuk production, prefer library URI builder yang battle-tested, atau OkHttp `HttpUrl` bila OkHttp memang bagian stack Anda.

### 16.2 OkHttp recommended pattern

```java
HttpUrl url = HttpUrl.get("https://api.example.com/")
        .newBuilder()
        .addPathSegment("v1")
        .addPathSegment("users")
        .addPathSegment(userId)
        .addQueryParameter("include", "roles")
        .build();

Request request = new Request.Builder()
        .url(url)
        .header("Accept", "application/json")
        .get()
        .build();
```

### 16.3 Retrofit recommended pattern

```java
interface UserApi {
    @GET("v1/users/{id}")
    Call<UserDto> getUser(
            @Path("id") String id,
            @Query("include") String include
    );
}
```

Pastikan:

1. base URL benar dan trailing slash;
2. jangan pakai `encoded=true` tanpa alasan kuat;
3. hindari `@Url` untuk input tidak trusted;
4. query List/array sesuai kontrak API;
5. null handling eksplisit di layer domain client.

### 16.4 Apache HttpClient pattern

Apache HttpClient memiliki utility builder seperti `URIBuilder` pada ekosistem HttpComponents.

Pattern:

```java
URI uri = new URIBuilder("https://api.example.com")
        .setPath("/v1/users/" + safeSegment) // hati-hati: jangan concat raw segment jika mengandung slash
        .addParameter("include", "roles")
        .build();
```

Untuk dynamic path segment, pastikan builder/utility yang digunakan benar-benar memperlakukan input sebagai segment, bukan raw path. Jika tidak, buat helper segment encoder teruji.

---

## 17. Security Concerns Khusus URI

### 17.1 SSRF

SSRF terjadi ketika aplikasi melakukan request ke URL yang dikontrol user, lalu attacker memaksa server memanggil internal resource.

Contoh input berbahaya:

```text
http://169.254.169.254/latest/meta-data/
http://localhost:8080/admin
http://127.0.0.1:2375/containers/json
http://internal-service.namespace.svc.cluster.local/secrets
```

Defense minimal:

1. allowlist scheme;
2. allowlist host;
3. resolve DNS dan tolak private/link-local/loopback IP jika input external;
4. validasi ulang setelah redirect;
5. matikan redirect otomatis untuk URL tidak trusted;
6. batasi port;
7. batasi response size;
8. timeout pendek;
9. jangan kirim internal auth header ke dynamic host.

### 17.2 Open redirect follow-up

Jika client mengikuti redirect otomatis, request bisa berpindah host.

Contoh:

```text
https://trusted.example.com/download?id=1
-> 302 Location: https://attacker.example.net/capture
```

Jika client membawa `Authorization` header atau cookie lintas host, itu fatal. Library biasanya punya perlindungan tertentu, tetapi production client tetap perlu policy eksplisit.

Rule:

```text
Untuk request yang membawa credential, redirect lintas host harus diaudit atau ditolak.
```

### 17.3 Header injection via URL-derived value

Jika sebagian URL atau query dipakai ulang menjadi header tanpa sanitasi, CRLF injection bisa terjadi.

Contoh input:

```text
abc%0D%0AX-Injected:true
```

Jangan memasukkan decoded user-controlled URL component ke header/log line tanpa validasi.

### 17.4 Path traversal confusion

Untuk HTTP client, path traversal sering terlihat sebagai server-side concern. Tetapi client juga bisa salah membangun URL:

```text
/files/../../admin
/files/%2e%2e/%2e%2e/admin
```

Jika client membuat signed URL atau proxy request, ia harus memahami apakah path normalization dilakukan sebelum atau sesudah signing/authorization.

---

## 18. Observability: Logging URI Tanpa Membocorkan Data

### 18.1 Jangan log full URL sembarangan

Buruk:

```java
log.info("Calling downstream: {}", request.url());
```

Jika URL mengandung:

```text
?token=secret&email=user@example.com
```

Maka data bocor ke log.

### 18.2 Log structured dan redacted

Lebih baik:

```text
method=GET
scheme=https
host=api.example.com
path_template=/v1/users/{id}
query_keys=include,expand
status=200
duration_ms=123
```

Bukan:

```text
url=https://api.example.com/v1/users/123?token=secret
```

### 18.3 Path template lebih baik daripada actual path

Metric cardinality bisa meledak jika actual path dipakai sebagai label.

Buruk:

```text
http.client.duration{path="/users/123"}
http.client.duration{path="/users/456"}
http.client.duration{path="/users/789"}
```

Baik:

```text
http.client.duration{path_template="/users/{id}"}
```

### 18.4 Canonical request untuk debug internal

Untuk debugging signature atau cache mismatch, simpan canonical request secara aman:

1. redacted sensitive headers;
2. redacted sensitive query;
3. payload hash, bukan payload mentah;
4. request id/correlation id;
5. downstream host/path template.

---

## 19. API Design Implication: Path atau Query?

### 19.1 Path untuk identity/hierarchy

Gunakan path untuk resource identity:

```text
/users/{userId}
/orders/{orderId}
/cases/{caseId}/documents/{documentId}
```

### 19.2 Query untuk filtering/projection/pagination

Gunakan query untuk:

```text
/orders?status=PAID&from=2026-01-01&limit=50
/users?include=roles
/search?q=java+http+client
```

### 19.3 Jangan letakkan secret di path/query

Hindari:

```text
/reset-password/{token}
/download?access_token=...
```

Jika token harus berada di URL karena mekanisme pre-signed URL, perlakukan URL itu sebagai secret:

1. TTL pendek;
2. scope sempit;
3. one-time jika memungkinkan;
4. redaction log;
5. audit access.

### 19.4 Hindari path parameter yang menerima arbitrary raw path

Buruk:

```text
GET /files/{anyPath}
```

Jika `anyPath` bisa mengandung slash, dot segment, encoded slash, unicode normalization, dan reserved char, route menjadi kompleks.

Alternatif:

```text
GET /files?key=2026/06/report.pdf
```

Atau:

```text
POST /files/resolve
{
  "key": "2026/06/report.pdf"
}
```

Tergantung kebutuhan keamanan, cacheability, dan ergonomi.

---

## 20. Unicode, Normalization, dan Internationalization

### 20.1 Unicode bisa punya bentuk berbeda

Karakter yang terlihat sama bisa punya representasi byte berbeda.

Contoh konseptual:

```text
é sebagai satu code point
é sebagai e + combining accent
```

Jika dipakai dalam path/query/signature/cache key, ini bisa menyebabkan mismatch.

### 20.2 Hostname internationalization

Domain internasional dapat direpresentasikan dalam Unicode atau punycode.

Contoh konseptual:

```text
münich.example
xn--mnich-kva.example
```

Untuk security-sensitive host allowlist, canonical host representation harus jelas.

### 20.3 Homograph risk

Karakter Unicode bisa terlihat mirip dengan karakter ASCII.

Contoh:

```text
аpi.example.com
```

Huruf pertama bisa Cyrillic `а`, bukan ASCII `a`.

Untuk allowlist host, jangan mengandalkan inspeksi visual. Gunakan parser dan canonical representation.

---

## 21. URI Equality: Jangan Asal Compare String

Dua URL string bisa berbeda tetapi semantik network-nya sama:

```text
https://api.example.com:443/users
https://api.example.com/users
```

Atau:

```text
https://API.EXAMPLE.COM/users
https://api.example.com/users
```

Tetapi dua URL yang tampak mirip bisa berbeda:

```text
https://api.example.com/users/john%2Fdoe
https://api.example.com/users/john/doe
```

Untuk equality, tentukan dulu konteks:

1. network endpoint equality;
2. cache key equality;
3. signing equality;
4. audit identity equality;
5. business resource equality.

Masing-masing bisa punya aturan berbeda.

Rule:

```text
Tidak ada satu equality rule untuk semua konteks URI.
```

---

## 22. Failure Modes dan Gejalanya

| Failure | Gejala | Root Cause Umum | Fix |
|---|---|---|---|
| 404 padahal endpoint ada | path berubah | leading slash/trailing slash/base URL salah | pakai builder dan contract test |
| 401/403 signature mismatch | server menolak signature | query ordering/encoding beda | canonical builder sesuai spec |
| 400 bad request | server tidak bisa parse query | double encoding/under encoding | encode per component |
| Data tidak ditemukan | ID berubah | slash dalam path dianggap delimiter | path segment encoding atau desain API ulang |
| Cache miss tinggi | key tidak stabil | query order tidak deterministic | canonical query sort |
| Metric cardinality tinggi | terlalu banyak label | actual URL/path jadi label | path template |
| Secret bocor | token muncul di log | full URL logging | redaction |
| SSRF | server call internal host | dynamic URL tanpa policy | allowlist + DNS/IP validation |
| Redirect leak | token terkirim ke host lain | follow redirect otomatis | validate redirect target |

---

## 23. Production Checklist: URI Construction

Gunakan checklist ini saat design review HTTP client.

### 23.1 Construction

- Apakah URL dibangun dari komponen, bukan string concat raw?
- Apakah path dynamic value diperlakukan sebagai segment?
- Apakah query parameter memakai builder?
- Apakah null/empty/missing dibedakan?
- Apakah repeated query parameter didukung jika API butuh?
- Apakah base URL trailing slash sudah benar?
- Apakah leading slash endpoint disengaja?

### 23.2 Encoding

- Apakah encoding dilakukan per component?
- Apakah tidak memakai `URLEncoder` untuk seluruh URL?
- Apakah tidak terjadi double encoding?
- Apakah encoded variant library dipakai hanya saat perlu?
- Apakah slash, question mark, hash, percent diuji?

### 23.3 Canonicalization

- Apakah request signing memakai canonical spec yang benar?
- Apakah query ordering deterministic?
- Apakah header canonicalization sesuai spec?
- Apakah payload hash sesuai body yang dikirim?
- Apakah canonical form bisa dilog secara aman untuk debugging?

### 23.4 Security

- Apakah scheme dibatasi ke HTTPS?
- Apakah host allowlist diterapkan untuk dynamic URL?
- Apakah userinfo di URL ditolak?
- Apakah redirect lintas host divalidasi?
- Apakah private/link-local IP ditolak untuk URL external?
- Apakah query sensitive redacted?

### 23.5 Observability

- Apakah log memakai path template, bukan full URL?
- Apakah metric tidak memakai actual path dengan ID?
- Apakah query sensitive tidak masuk tracing?
- Apakah request identity cukup untuk debugging tanpa bocor data?

---

## 24. Code Review Smells

Jika melihat ini, berhenti dan review lebih dalam:

```java
String url = baseUrl + "/users/" + userId;
```

```java
String url = String.format("%s/orders?status=%s", baseUrl, status);
```

```java
URLEncoder.encode(fullUrl, UTF_8);
```

```java
@Path(value = "id", encoded = true)
```

tanpa alasan jelas.

```java
@GET
Call<ResponseBody> call(@Url String url);
```

dengan input dari user atau external system tanpa allowlist.

```java
log.info("Calling {}", url);
```

tanpa redaction.

```java
Map<String, String> query = new HashMap<>();
```

untuk signed/canonical request.

```java
if (url.contains("trusted.com"))
```

untuk security validation.

---

## 25. Practice: Edge Case Test Suite

Buat test untuk HTTP client builder Anda dengan input berikut.

### 25.1 Path segment cases

```text
john doe
john/doe
john?active=true
john#admin
john%20doe
..
.%2e
report 2026.pdf
한국어
é
```

Validasi:

1. hasil URL sesuai ekspektasi;
2. tidak double encode;
3. path segment tidak pecah jika tidak seharusnya;
4. signature/canonical form stabil.

### 25.2 Query cases

```text
q = john doe
q = a+b
q = a&b
q = a=b
q = 100%
q = null
q = ""
tag = [java, http, client]
```

Validasi:

1. null tidak menjadi `null` string;
2. empty tetap empty jika contract meminta;
3. repeated parameter benar;
4. ordering canonical deterministic.

### 25.3 Security cases

```text
https://api.example.com.attacker.net
https://attacker.net/?next=api.example.com
http://api.example.com
https://api.example.com:444
https://user:pass@api.example.com
http://127.0.0.1:8080
http://169.254.169.254/latest/meta-data/
```

Validasi:

1. host allowlist tidak berbasis substring;
2. scheme policy bekerja;
3. userinfo ditolak;
4. port policy bekerja;
5. internal IP ditolak untuk external input.

---

## 26. Mini Implementation: Safe Endpoint Builder dengan OkHttp

Contoh untuk client internal yang butuh strict construction.

```java
public final class ExternalApiUrls {
    private final HttpUrl baseUrl;

    public ExternalApiUrls(String baseUrl) {
        HttpUrl parsed = HttpUrl.parse(baseUrl);
        if (parsed == null) {
            throw new IllegalArgumentException("Invalid base URL");
        }
        if (!"https".equals(parsed.scheme())) {
            throw new IllegalArgumentException("Only HTTPS is allowed");
        }
        if (!"api.example.com".equals(parsed.host())) {
            throw new IllegalArgumentException("Unexpected API host: " + parsed.host());
        }
        this.baseUrl = parsed;
    }

    public HttpUrl getUserUrl(String userId, boolean includeRoles) {
        Objects.requireNonNull(userId, "userId");

        HttpUrl.Builder builder = baseUrl.newBuilder()
                .addPathSegment("v1")
                .addPathSegment("users")
                .addPathSegment(userId);

        if (includeRoles) {
            builder.addQueryParameter("include", "roles");
        }

        return builder.build();
    }
}
```

Test intent:

```java
ExternalApiUrls urls = new ExternalApiUrls("https://api.example.com/");

assertEquals(
        "https://api.example.com/v1/users/john%20doe?include=roles",
        urls.getUserUrl("john doe", true).toString()
);
```

Untuk path dengan slash:

```java
assertEquals(
        "https://api.example.com/v1/users/john%2Fdoe",
        urls.getUserUrl("john/doe", false).toString()
);
```

Catatan: pastikan server memang menerima encoded slash jika userId bisa mengandung slash. Jika tidak, validasi `userId` agar slash ditolak.

---

## 27. Mini Implementation: Retrofit Interface yang Aman

```java
public interface OrderApi {
    @GET("v1/orders/{orderId}")
    Call<OrderDto> getOrder(
            @Path("orderId") String orderId,
            @Query("include") List<String> include
    );

    @GET("v1/orders")
    Call<List<OrderDto>> searchOrders(
            @Query("status") List<String> statuses,
            @Query("from") String fromDate,
            @Query("to") String toDate,
            @Query("limit") Integer limit
    );
}
```

Service wrapper:

```java
public final class OrderClient {
    private final OrderApi api;

    public OrderClient(OrderApi api) {
        this.api = api;
    }

    public OrderDto getOrder(OrderId orderId) throws ExternalApiException {
        try {
            Response<OrderDto> response = api.getOrder(
                    orderId.value(),
                    List.of("items", "payments")
            ).execute();

            if (!response.isSuccessful()) {
                throw ExternalApiException.fromHttpStatus(response.code());
            }

            OrderDto body = response.body();
            if (body == null) {
                throw new ExternalApiException("Empty response body");
            }

            return body;
        } catch (IOException e) {
            throw new ExternalApiException("Transport failure", e);
        }
    }
}
```

Kenapa wrapper tetap penting?

1. Retrofit interface adalah protocol mapping.
2. Domain client wrapper adalah boundary policy.
3. Error mapping, logging, retry, metric, dan validation tidak sebaiknya tersebar di caller.

---

## 28. Mini Implementation: Canonical Query untuk Signing

Contoh sederhana, bukan implementasi SigV4 lengkap.

```java
public final class CanonicalQuery {
    private final List<Pair> pairs = new ArrayList<>();

    public CanonicalQuery add(String name, String value) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("name is required");
        }
        if (value == null) {
            return this;
        }
        pairs.add(new Pair(name, value));
        return this;
    }

    public String render() {
        return pairs.stream()
                .sorted(Comparator
                        .comparing(Pair::name)
                        .thenComparing(Pair::value))
                .map(p -> encode(p.name()) + "=" + encode(p.value()))
                .collect(Collectors.joining("&"));
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8)
                .replace("+", "%20")
                .replace("*", "%2A")
                .replace("%7E", "~");
    }

    private record Pair(String name, String value) {}
}
```

Catatan penting:

```text
Untuk signing nyata, jangan asal pakai implementasi generik ini.
Ikuti aturan encoding dari signing spec target.
```

---

## 29. Decision Guide

### 29.1 Gunakan `URI` saja jika:

- URL static atau sederhana;
- tidak banyak dynamic path/query;
- tidak ada signing kompleks;
- sudah ada utility builder internal yang aman;
- memakai JDK HttpClient tanpa dependency tambahan.

### 29.2 Gunakan OkHttp `HttpUrl` jika:

- banyak dynamic path/query;
- butuh builder yang aman;
- stack sudah memakai OkHttp;
- ingin menghindari manual encoding;
- butuh control URL decomposition.

### 29.3 Gunakan Retrofit annotation jika:

- API contract stabil;
- endpoint bisa direpresentasikan sebagai Java interface;
- ingin type-safe API client;
- DTO/converter jelas;
- HTTP client policy bisa diinjeksi lewat OkHttp/interceptor/wrapper.

### 29.4 Gunakan generated OpenAPI client jika:

- API besar;
- contract formal tersedia;
- banyak endpoint/DTO;
- organisasi butuh governance;
- client harus mengikuti versioned spec.

Tetap bungkus generated client dengan domain adapter agar domain tidak bocor ke generated DTO.

---

## 30. Mental Model Summary

Pegang prinsip berikut:

```text
URI adalah struktur, bukan string.
```

```text
Encoding harus dilakukan per komponen,
bukan terhadap seluruh URL.
```

```text
Path segment dan path string bukan hal yang sama.
```

```text
Query parameter bukan selalu Map<String, String>.
```

```text
Canonical request adalah identitas stabil request,
tetapi aturan canonicalization bergantung pada contract server/signing spec.
```

```text
Dynamic URL adalah security boundary.
```

```text
Full URL hampir selalu terlalu sensitif untuk log/metric.
```

```text
Library builder mengurangi bug,
tetapi tidak menggantikan policy validation.
```

---

## 31. What Top 1% Engineers Do Differently

Engineer biasa membuat request seperti ini:

```java
String url = baseUrl + "/users/" + id + "?include=" + include;
```

Engineer kuat membuat request seperti ini:

```text
validated base URL
+ explicit path segments
+ explicit query parameters
+ deterministic canonical form if needed
+ redacted observability
+ security policy around dynamic URL
+ test coverage for reserved characters
```

Engineer top-tier bertanya:

1. Apakah value ini path segment, path hierarchy, query value, atau raw URL?
2. Apakah data ini sudah encoded atau masih raw?
3. Siapa yang bertanggung jawab melakukan encoding?
4. Apakah server/router/proxy akan decode atau normalize sebelum authorization?
5. Apakah request yang saya sign sama dengan request yang benar-benar dikirim?
6. Apakah log/metric/tracing membocorkan query sensitive?
7. Apakah URL bisa diarahkan ke host internal?
8. Apakah cache key/dedup key stabil?
9. Apakah null, empty, missing punya arti berbeda?
10. Apakah test mencakup `/`, `?`, `#`, `%`, space, unicode, repeated query?

Inilah perbedaan antara “bisa call API” dan “bisa membangun HTTP client yang aman, stabil, dan dapat dioperasikan di production”.

---

## 32. Koneksi ke Part Berikutnya

Part ini membahas bagaimana request target dibangun dengan benar.

Part berikutnya akan membahas metadata HTTP:

```text
Part 4 — Headers, Content Negotiation, Compression, dan Metadata Contract
```

Kita akan masuk ke:

1. header sebagai protocol contract;
2. `Accept` dan `Content-Type`;
3. authorization header;
4. idempotency key;
5. correlation ID dan trace context;
6. conditional request;
7. compression;
8. redaction;
9. header propagation anti-pattern.

Jika Part 3 adalah tentang **alamat request**, Part 4 adalah tentang **makna dan metadata request**.

---

## 33. Status Series

Selesai:

```text
Part 0 — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
Part 1 — Java HTTP Client Landscape di Java 8–25
Part 2 — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body
Part 3 — URI, URL, Encoding, Query Parameter, dan Canonical Request
```

Belum selesai. Masih lanjut ke Part 4 sampai Part 34.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 2 — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body](./02-http-request-lifecycle-from-call-to-response.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 4 — Headers, Content Negotiation, Compression, dan Metadata Contract](./04-http-headers-content-negotiation-compression-metadata.md)
