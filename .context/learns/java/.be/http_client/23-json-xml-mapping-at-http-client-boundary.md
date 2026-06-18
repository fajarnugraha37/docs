# Part 23 — JSON/XML Mapping for HTTP Client Boundary

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `23-json-xml-mapping-at-http-client-boundary.md`  
Target: Java 8–25, backend/integration engineer, production-grade HTTP client engineering

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas request lifecycle, URI, headers, body handling, timeout, pooling, auth, retry, rate limit, circuit breaker, library internals, architecture, error modelling, observability, dan testing.

Part ini fokus pada satu area yang sering tampak sederhana tetapi sering menyebabkan bug production yang sulit dilacak:

> Bagaimana payload JSON/XML dari sistem eksternal diterjemahkan menjadi object Java dengan aman, eksplisit, kompatibel, observable, dan tidak merusak domain model.

Materi ini bukan pengulangan dasar Jackson/JAXB/XML parsing. Fokus kita adalah **mapping di boundary HTTP client**.

Di HTTP client production-grade, mapping bukan sekadar:

```java
ExternalResponse dto = objectMapper.readValue(body, ExternalResponse.class);
```

Mapping adalah proses boundary yang menjawab pertanyaan:

1. Apakah response ini secara transport berhasil?
2. Apakah status code-nya bisa diterima?
3. Apakah `Content-Type` sesuai ekspektasi?
4. Apakah body boleh kosong?
5. Apakah struktur payload kompatibel?
6. Apakah field wajib ada?
7. Apakah enum value dikenal?
8. Apakah angka aman dari precision loss?
9. Apakah waktu memiliki timezone/offset yang benar?
10. Apakah null berarti unknown, absent, cleared, atau invalid?
11. Apakah error body memakai format standar atau vendor-specific?
12. Apakah payload terlalu besar?
13. Apakah parsing failure retryable?
14. Apakah hasil mapping boleh langsung masuk domain?
15. Apakah log aman dari data sensitif?

Jika pertanyaan-pertanyaan ini tidak dijawab, HTTP client akan menjadi sumber silent corruption.

---

## 2. Mental Model: Mapping Adalah Trust Boundary

External API adalah sistem lain. Walaupun dimiliki oleh organisasi yang sama, dari perspektif client tetap harus diperlakukan sebagai **untrusted boundary**.

```text
External HTTP response
        |
        v
Raw bytes
        |
        v
Content-Type validation
        |
        v
Charset / compression / body size control
        |
        v
Parser layer
        |
        v
External DTO
        |
        v
Schema / semantic validation
        |
        v
Anti-corruption mapping
        |
        v
Domain-safe object / typed error
```

Kesalahan umum adalah langsung melompati beberapa tahap:

```text
raw response body -> domain object
```

Itu berbahaya karena domain model menjadi tergantung pada bentuk payload eksternal.

Boundary yang sehat seharusnya begini:

```text
HTTP body -> External DTO -> Client Result -> Domain Model
```

External DTO boleh mengikuti kontrak external API. Domain model tidak boleh dipaksa mengikuti bentuk external API.

---

## 3. Boundary DTO vs Domain Object

### 3.1 Jangan langsung deserialize ke domain object

Contoh buruk:

```java
public final class Customer {
    private CustomerId id;
    private String legalName;
    private CustomerStatus status;
}

Customer customer = objectMapper.readValue(responseBody, Customer.class);
```

Masalah:

1. Nama field domain dipaksa sama dengan API eksternal.
2. Enum domain dipaksa menerima value eksternal.
3. Null dari eksternal masuk ke domain invariant.
4. Unknown field policy bercampur dengan domain.
5. Perubahan API eksternal bisa merusak domain.
6. Error parsing menjadi terlihat seperti domain error.

### 3.2 Gunakan external DTO

```java
public final class ExternalCustomerResponse {
    public String id;
    public String name;
    public String status;
    public String createdAt;
}
```

Lalu map eksplisit:

```java
public final class CustomerMapper {
    public CustomerSnapshot toDomain(ExternalCustomerResponse dto) {
        return new CustomerSnapshot(
            CustomerId.parse(required(dto.id, "id")),
            required(dto.name, "name"),
            ExternalStatusMapper.toDomain(dto.status),
            OffsetDateTime.parse(required(dto.createdAt, "createdAt"))
        );
    }
}
```

Domain hanya menerima object yang sudah melewati validasi boundary.

### 3.3 External DTO boleh “jelek”

External DTO tidak harus indah secara domain.

Misalnya API eksternal mengembalikan:

```json
{
  "cust_id": "C123",
  "customer_nm": "Alice",
  "stat_cd": "A",
  "created_dt": "2026-06-18T10:15:30+07:00"
}
```

DTO boleh mencerminkan kontrak tersebut:

```java
public final class ExternalCustomerDto {
    @JsonProperty("cust_id")
    public String customerId;

    @JsonProperty("customer_nm")
    public String customerName;

    @JsonProperty("stat_cd")
    public String statusCode;

    @JsonProperty("created_dt")
    public String createdDateTime;
}
```

Yang penting domain mapper menerjemahkannya ke model internal yang bersih.

---

## 4. JSON Mapping: Bukan Sekadar ObjectMapper Default

Jackson adalah pilihan umum di Java backend. Namun default konfigurasi tidak selalu cocok untuk boundary eksternal.

Di boundary HTTP client, kita perlu konfigurasi yang sadar kontrak.

Contoh konfigurasi awal:

```java
public final class ExternalApiObjectMapperFactory {

    public static ObjectMapper create() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        // Pilihan policy, bukan default sembarangan.
        mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        mapper.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
        mapper.enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

        return mapper;
    }
}
```

Namun konfigurasi seperti ini tidak boleh dipilih otomatis. Setiap flag punya konsekuensi.

---

## 5. Unknown Field Handling

### 5.1 Unknown field adalah tanda evolusi kontrak

External API dapat menambah field tanpa seharusnya merusak client. Karena itu, untuk response DTO, sering masuk akal untuk mengabaikan unknown fields.

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public final class ExternalCustomerResponse {
    public String id;
    public String name;
    public String status;
}
```

Atau secara global:

```java
mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
```

Jackson menyediakan fitur untuk menentukan apakah unknown property saat deserialization harus menyebabkan failure atau diabaikan melalui `FAIL_ON_UNKNOWN_PROPERTIES`.

### 5.2 Jangan selalu ignore unknown field

Ada kasus di mana unknown field harus dianggap serius:

1. API internal strict contract.
2. Security-sensitive response.
3. Payment/financial command response.
4. Signing/canonical payload.
5. Back-office regulatory response.
6. Migration validation.
7. Contract test mode.

Untuk production runtime, ignore unknown sering membantu forward compatibility. Untuk CI contract test, fail unknown bisa membantu mendeteksi drift.

### 5.3 Pola yang lebih matang

Gunakan dua mode:

```text
runtime mode:
  tolerate additive unknown fields

contract validation mode:
  detect unknown fields and report drift
```

Dengan begitu sistem tetap robust di production tetapi tetap peka terhadap perubahan kontrak.

---

## 6. Missing Field Handling

Unknown field dan missing field adalah masalah berbeda.

Unknown field:

```json
{
  "id": "C123",
  "name": "Alice",
  "status": "ACTIVE",
  "newField": "unexpected"
}
```

Missing field:

```json
{
  "id": "C123",
  "status": "ACTIVE"
}
```

Jika `name` wajib secara domain, missing field harus ditangkap.

### 6.1 Jangan percaya constructor kosong + public field

DTO seperti ini mudah dipakai tetapi tidak menegakkan requirement:

```java
public final class ExternalCustomerResponse {
    public String id;
    public String name;
    public String status;
}
```

Jika `name` hilang, nilainya `null`.

Lebih aman jika validasi dilakukan eksplisit setelah parsing:

```java
public final class ExternalCustomerValidator {

    public void validate(ExternalCustomerResponse dto) {
        requireNonBlank(dto.id, "id");
        requireNonBlank(dto.name, "name");
        requireNonBlank(dto.status, "status");
    }

    private void requireNonBlank(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new ExternalPayloadSchemaException("Missing required field: " + field);
        }
    }
}
```

### 6.2 Missing field classification

Missing field sebaiknya diklasifikasikan sebagai:

```text
transport? no
protocol? maybe, if Content-Type/body violates declared contract
schema? yes
domain? not yet
retryable? usually no
alert? yes, if contract regression
```

Jangan retry terus jika payload valid secara HTTP tetapi schema-nya salah.

---

## 7. Null Semantics

Null adalah salah satu sumber bug terbesar dalam mapping boundary.

Null bisa berarti:

1. Field tidak diketahui.
2. Field memang kosong.
3. Field tidak berlaku.
4. Field sengaja dihapus.
5. Producer bug.
6. Backward compatibility placeholder.
7. Permission masking.

Contoh:

```json
{
  "middleName": null
}
```

Apakah artinya user tidak punya middle name, data belum tersedia, atau field disembunyikan?

### 7.1 Bedakan absent vs explicit null

JSON absent:

```json
{
  "id": "C123"
}
```

JSON explicit null:

```json
{
  "id": "C123",
  "name": null
}
```

Dalam beberapa domain, keduanya berbeda.

Untuk PATCH-like API, perbedaan ini sangat penting:

```text
field absent      -> jangan ubah
field null        -> clear value
field with value  -> update value
```

### 7.2 Jangan map null langsung ke primitive

Contoh buruk:

```java
public final class ExternalScoreDto {
    public int score;
}
```

Jika JSON tidak punya `score`, Java akan memberi default `0`. Ini bisa membuat data corruption.

Gunakan wrapper:

```java
public final class ExternalScoreDto {
    public Integer score;
}
```

Lalu validasi:

```java
if (dto.score == null) {
    throw new ExternalPayloadSchemaException("score is required");
}
```

### 7.3 Optional di DTO?

Hindari `Optional` sebagai field DTO untuk Jackson boundary kecuali tim benar-benar punya standar kuat.

Lebih umum:

```java
public final class ExternalCustomerDto {
    public String id;
    public String nickname; // nullable by external contract
}
```

Lalu domain mapping:

```java
Optional<String> nickname = Optional.ofNullable(dto.nickname)
    .filter(s -> !s.isBlank());
```

---

## 8. Enum Evolution

Enum adalah jebakan compatibility.

External API hari ini:

```json
{
  "status": "ACTIVE"
}
```

Besok vendor menambah:

```json
{
  "status": "SUSPENDED_PENDING_REVIEW"
}
```

Jika DTO memakai enum langsung:

```java
public enum ExternalStatus {
    ACTIVE,
    INACTIVE
}
```

Parsing bisa gagal. Itu mungkin benar untuk beberapa sistem, tetapi berbahaya jika seluruh flow gagal hanya karena value baru yang sebenarnya bisa diperlakukan sebagai `UNKNOWN`.

### 8.1 Lebih aman: simpan raw string di external DTO

```java
public final class ExternalCustomerDto {
    public String status;
}
```

Lalu mapping eksplisit:

```java
public enum CustomerStatus {
    ACTIVE,
    INACTIVE,
    UNKNOWN
}

public final class ExternalStatusMapper {
    public static CustomerStatus toDomain(String raw) {
        if (raw == null || raw.isBlank()) {
            return CustomerStatus.UNKNOWN;
        }
        return switch (raw) {
            case "A", "ACTIVE" -> CustomerStatus.ACTIVE;
            case "I", "INACTIVE" -> CustomerStatus.INACTIVE;
            default -> CustomerStatus.UNKNOWN;
        };
    }
}
```

Untuk Java 8, gunakan `switch` statement biasa.

### 8.2 Kapan unknown enum harus fail?

Unknown enum harus fail jika:

1. Nilai menentukan aksi irreversible.
2. Nilai menentukan authorization/security decision.
3. Nilai menentukan monetary movement.
4. Nilai menentukan enforcement/legal action.
5. Tidak ada default aman.

Unknown enum boleh menjadi `UNKNOWN` jika:

1. Hanya untuk display.
2. Hanya untuk reporting non-critical.
3. Ada fallback aman.
4. Sistem dapat menyimpan raw value untuk audit.

### 8.3 Simpan raw value untuk audit

```java
public record ExternalStatusView(
    CustomerStatus normalized,
    String raw
) {}
```

Jika menggunakan Java 8:

```java
public final class ExternalStatusView {
    private final CustomerStatus normalized;
    private final String raw;

    public ExternalStatusView(CustomerStatus normalized, String raw) {
        this.normalized = normalized;
        this.raw = raw;
    }

    public CustomerStatus normalized() { return normalized; }
    public String raw() { return raw; }
}
```

---

## 9. Date/Time Mapping

Waktu adalah sumber bug lintas sistem.

Masalah umum:

1. Timestamp tanpa timezone.
2. Timestamp dengan timezone lokal vendor.
3. Date-only diperlakukan sebagai instant.
4. Epoch seconds vs milliseconds.
5. Format custom.
6. DST issue.
7. `java.util.Date` digunakan tanpa meaning jelas.

### 9.1 Gunakan tipe yang mencerminkan makna

| Makna | Java Type |
|---|---|
| Instant global | `Instant` |
| Timestamp dengan offset | `OffsetDateTime` |
| Tanggal kalender tanpa waktu | `LocalDate` |
| Waktu lokal tanpa tanggal | `LocalTime` |
| Date-time lokal tanpa zone | `LocalDateTime` |
| Zoned calendar event | `ZonedDateTime` |

### 9.2 Jangan asal memakai `LocalDateTime`

`LocalDateTime` tidak punya timezone/offset. Untuk API eksternal, ini sering ambiguous.

Contoh:

```json
{
  "createdAt": "2026-06-18T10:15:30"
}
```

Itu jam berapa secara global?

Jika kontrak tidak menyebut timezone, client harus punya policy eksplisit:

```text
Assume Asia/Jakarta?
Assume UTC?
Reject as invalid?
Ask provider to fix contract?
```

### 9.3 Prefer ISO-8601 dengan offset

```json
{
  "createdAt": "2026-06-18T10:15:30+07:00"
}
```

Mapping:

```java
OffsetDateTime createdAt = OffsetDateTime.parse(dto.createdAt);
Instant instant = createdAt.toInstant();
```

### 9.4 Date-only harus tetap date-only

```json
{
  "expiryDate": "2026-12-31"
}
```

Mapping:

```java
LocalDate expiryDate = LocalDate.parse(dto.expiryDate);
```

Jangan paksa menjadi midnight UTC karena bisa berubah tanggal saat ditampilkan di timezone lain.

---

## 10. Number Mapping dan Precision

Angka di JSON tidak punya tipe eksplisit seperti Java. Masalah muncul saat mapper memilih tipe yang tidak tepat.

### 10.1 Monetary value jangan pakai double

Contoh buruk:

```java
public final class PaymentDto {
    public double amount;
}
```

Gunakan `BigDecimal`:

```java
public final class PaymentDto {
    public BigDecimal amount;
    public String currency;
}
```

Validasi:

```java
if (dto.amount == null || dto.amount.signum() < 0) {
    throw new ExternalPayloadSchemaException("Invalid amount");
}
```

### 10.2 ID numerik jangan selalu dianggap number

External API sering mengirim ID seperti:

```json
{
  "caseId": 1234567890123456789
}
```

Jika melewati JavaScript atau beberapa parser, precision bisa hilang. Untuk external ID, lebih aman memakai string jika kontrak memungkinkan.

```java
public final class CaseDto {
    public String caseId;
}
```

### 10.3 Range validation

Parsing berhasil bukan berarti value valid.

```java
if (dto.pageSize == null || dto.pageSize < 1 || dto.pageSize > 500) {
    throw new ExternalPayloadSchemaException("Invalid pageSize");
}
```

---

## 11. Boolean Mapping

Boolean tampak mudah, tetapi external API sering memakai variasi:

```json
{ "active": true }
{ "active": "Y" }
{ "active": "N" }
{ "active": 1 }
{ "active": "true" }
```

Jangan mencampur semua bentuk ke domain secara diam-diam tanpa policy.

Lebih baik parsing eksplisit:

```java
public final class ExternalBooleanMapper {
    public static boolean parseRequiredFlag(String raw, String field) {
        if ("Y".equals(raw)) return true;
        if ("N".equals(raw)) return false;
        throw new ExternalPayloadSchemaException("Invalid boolean flag for " + field + ": " + raw);
    }
}
```

Jika provider mengirim format tidak konsisten, jadikan itu contract risk, bukan biarkan menjadi bug acak.

---

## 12. Error Body Mapping

HTTP error body sering berbeda dari success body.

Success:

```json
{
  "id": "C123",
  "name": "Alice"
}
```

Error:

```json
{
  "code": "CUSTOMER_NOT_FOUND",
  "message": "Customer does not exist"
}
```

Atau Problem Details:

```json
{
  "type": "https://example.com/problems/customer-not-found",
  "title": "Customer not found",
  "status": 404,
  "detail": "Customer C123 does not exist",
  "instance": "/customers/C123"
}
```

RFC 9457 mendefinisikan format Problem Details untuk membawa detail error machine-readable pada HTTP response body.

### 12.1 Jangan parse error sebagai success DTO

Buruk:

```java
CustomerDto dto = objectMapper.readValue(body, CustomerDto.class);
```

Baik:

```java
if (status >= 200 && status < 300) {
    return parseSuccess(body);
}
return parseError(status, contentType, body);
```

### 12.2 Error body parsing harus best effort

Error response sering rusak, HTML, kosong, atau tidak sesuai schema.

```java
public ExternalApiError parseError(int status, String contentType, String body) {
    if (body == null || body.isBlank()) {
        return ExternalApiError.withoutBody(status);
    }

    if (!contentType.contains("application/json")) {
        return ExternalApiError.unstructured(status, safeSnippet(body));
    }

    try {
        ProblemDetailDto problem = objectMapper.readValue(body, ProblemDetailDto.class);
        return ExternalApiError.problem(status, problem.type, problem.title, problem.detail);
    } catch (JsonProcessingException ex) {
        return ExternalApiError.malformedErrorBody(status, safeSnippet(body));
    }
}
```

Error body parsing failure tidak selalu sama dengan external API failure utama. Jangan sampai error asli hilang hanya karena error parser gagal.

---

## 13. Content-Type Aware Mapping

Response body harus diparse berdasarkan `Content-Type`.

```text
application/json        -> JSON parser
application/problem+json -> Problem Details parser
application/xml         -> XML parser
text/plain              -> plain text parser
text/html               -> usually unexpected for API
empty content-type      -> suspicious, fallback by policy
```

### 13.1 Jangan parse semua sebagai JSON

Jika upstream error gateway mengembalikan HTML:

```html
<html><body>502 Bad Gateway</body></html>
```

JSON parser akan gagal. Failure ini harus diklasifikasikan sebagai unexpected content type atau malformed error body, bukan business error.

### 13.2 Content-Type mismatch

Jika status 200 tetapi `Content-Type: text/html`, padahal kontrak JSON:

```text
classification: protocol/content-type failure
retryable: maybe, depending status/source
alert: yes
```

Contoh validasi:

```java
private void requireJson(String contentType) {
    if (contentType == null || !contentType.toLowerCase(Locale.ROOT).contains("application/json")) {
        throw new UnexpectedContentTypeException(contentType);
    }
}
```

---

## 14. Charset Handling

JSON modern umumnya UTF-8, tetapi real system kadang mengirim charset berbeda atau salah.

Masalah umum:

1. Response header mengaku UTF-8 tetapi body bukan UTF-8.
2. XML menyebut encoding di prolog.
3. Text/plain memakai legacy encoding.
4. Signature dihitung dari byte asli, bukan string hasil decode.

Prinsip:

```text
Parsing structured body: gunakan parser byte/stream jika memungkinkan.
Logging snippet: decode secara aman dan terbatas.
Signing verification: pakai raw bytes sesuai canonical rule.
```

Jangan terlalu cepat mengubah `byte[]` ke `String` sebelum jelas encoding-nya.

---

## 15. XML Mapping

XML masih penting untuk SOAP, enterprise integration, payment gateway lama, regulatory system, file-like API, dan vendor legacy.

Jakarta XML Binding menyediakan runtime binding framework untuk unmarshalling, marshalling, dan validation antara XML dan object Java.

### 15.1 XML memiliki surface area lebih besar dari JSON

XML membawa risiko tambahan:

1. XXE attack.
2. External entity resolution.
3. Billion laughs/entity expansion.
4. Namespace mismatch.
5. Mixed content.
6. Attribute vs element semantics.
7. Schema validation cost.
8. Large document memory blow-up.

### 15.2 Jangan pakai XML parser default tanpa hardening

Untuk DOM/SAX/StAX, matikan external entity dan DTD jika tidak dibutuhkan.

Contoh SAX hardening pattern:

```java
SAXParserFactory factory = SAXParserFactory.newInstance();
factory.setNamespaceAware(true);
factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
```

Catatan: feature support bisa berbeda antar parser. Kode production harus menangani `ParserConfigurationException`, `SAXNotRecognizedException`, dan `SAXNotSupportedException` secara eksplisit.

### 15.3 JAXB/Jakarta XML Binding boundary DTO

```java
@XmlRootElement(name = "Customer")
@XmlAccessorType(XmlAccessType.FIELD)
public class ExternalCustomerXmlDto {

    @XmlElement(name = "Id")
    public String id;

    @XmlElement(name = "Name")
    public String name;

    @XmlElement(name = "Status")
    public String status;
}
```

Unmarshal:

```java
JAXBContext context = JAXBContext.newInstance(ExternalCustomerXmlDto.class);
Unmarshaller unmarshaller = context.createUnmarshaller();
ExternalCustomerXmlDto dto = (ExternalCustomerXmlDto) unmarshaller.unmarshal(inputStream);
```

Tetap lakukan validasi setelah unmarshal.

### 15.4 Namespace harus eksplisit

Banyak bug XML berasal dari namespace.

```xml
<Customer xmlns="https://api.example.com/customer/v1">
  <Id>C123</Id>
</Customer>
```

Element `Id` dengan namespace berbeda bukan element yang sama.

Jangan mengandalkan local name saja untuk kontrak enterprise yang strict.

---

## 16. Streaming vs Buffering untuk Large Payload

Untuk response kecil, buffer ke memory biasa cukup.

Untuk response besar:

```text
large JSON array
large XML document
large file metadata
large report export
pagination response besar
```

Jangan deserialize semua ke memory jika tidak perlu.

### 16.1 Streaming JSON dengan Jackson

Contoh konseptual:

```java
try (InputStream in = responseBodyStream;
     JsonParser parser = objectMapper.getFactory().createParser(in)) {

    while (parser.nextToken() != null) {
        // parse token by token
    }
}
```

Gunakan streaming jika:

1. Payload besar.
2. Ingin early validation.
3. Ingin proses item satu per satu.
4. Ingin menghindari memory spike.

### 16.2 Streaming XML dengan StAX/SAX

Untuk XML besar, SAX/StAX sering lebih aman daripada DOM.

```text
DOM  -> load entire document into memory
SAX  -> event push parser
StAX -> event pull parser
```

Boundary rule:

```text
small structured response -> object mapping acceptable
large/unknown-size response -> streaming parser preferred
```

### 16.3 Body size limit

Sebelum parse, tentukan limit.

```text
success body max size
error body max size
log snippet max size
stream download max size
```

Jangan biarkan error response 100 MB masuk memory hanya untuk membuat exception message.

---

## 17. Pagination Mapping

External list response sering seperti:

```json
{
  "items": [ ... ],
  "nextPageToken": "abc"
}
```

Atau:

```json
{
  "data": [ ... ],
  "page": 1,
  "pageSize": 50,
  "total": 1234
}
```

Jangan bocorkan bentuk pagination vendor ke domain/use case.

Buat abstraction:

```java
public final class PageResult<T> {
    private final List<T> items;
    private final Optional<String> nextCursor;

    public PageResult(List<T> items, Optional<String> nextCursor) {
        this.items = List.copyOf(items);
        this.nextCursor = nextCursor;
    }
}
```

Untuk Java 8, ganti `List.copyOf` dengan defensive copy:

```java
this.items = Collections.unmodifiableList(new ArrayList<>(items));
```

Client method:

```java
PageResult<CustomerSnapshot> searchCustomers(CustomerSearchRequest request);
```

Bukan:

```java
VendorSearchCustomerResponse searchCustomers(...);
```

---

## 18. Polymorphic Payload

Beberapa API mengembalikan payload berbeda berdasarkan field tertentu.

```json
{
  "type": "PERSON",
  "id": "P123",
  "name": "Alice"
}
```

```json
{
  "type": "COMPANY",
  "id": "C123",
  "registeredName": "Acme Ltd"
}
```

Polymorphic deserialization harus hati-hati.

### 18.1 Jangan aktifkan default typing sembarangan

Jackson default typing pada untrusted input bisa berbahaya jika mengizinkan payload menentukan class Java yang dibuat.

Untuk external payload, gunakan discriminator yang terbatas:

```java
public final class ExternalPartyDto {
    public String type;
    public JsonNode raw;
}
```

Lalu pilih parser berdasarkan allowlist:

```java
switch (dto.type) {
    case "PERSON":
        return parsePerson(dto.raw);
    case "COMPANY":
        return parseCompany(dto.raw);
    default:
        throw new ExternalPayloadSchemaException("Unknown party type: " + dto.type);
}
```

### 18.2 Security rule

External JSON/XML tidak boleh menentukan arbitrary Java class.

Payload boleh menentukan business type, bukan implementation class.

---

## 19. Partial Success Mapping

Beberapa API mengembalikan HTTP 200 tetapi isinya partial failure.

```json
{
  "success": true,
  "items": [
    { "id": "1", "status": "OK" },
    { "id": "2", "status": "FAILED", "errorCode": "INVALID_ADDRESS" }
  ]
}
```

Jika client hanya melihat HTTP 200, domain akan salah.

Buat model eksplisit:

```java
public final class BatchClientResult<T> {
    private final List<T> successes;
    private final List<ItemFailure> failures;

    public boolean hasFailures() {
        return !failures.isEmpty();
    }
}
```

Policy harus jelas:

```text
all-or-nothing?
accept partial?
retry failed item only?
surface warning?
audit every item?
```

---

## 20. Empty Body Semantics

HTTP status tertentu boleh tanpa body, misalnya `204 No Content`.

Tetapi `200 OK` dengan body kosong untuk endpoint yang seharusnya mengembalikan object mungkin schema failure.

Decision table:

| Status | Body | Meaning |
|---|---|---|
| 204 | empty | valid no content |
| 200 | empty, expected object | schema/protocol failure |
| 404 | empty | error without body |
| 202 | empty | accepted, possibly valid |
| 304 | empty | valid conditional response |

Client parser harus tahu endpoint contract.

```java
if (status == 204) {
    return ClientResult.noContent();
}

if (body == null || body.isBlank()) {
    throw new EmptyBodyException("Expected customer response body");
}
```

---

## 21. Mapping Failure Taxonomy

Parsing/mapping failure harus diklasifikasikan.

```text
ContentTypeMismatchException
MalformedJsonException
MalformedXmlException
MissingRequiredFieldException
InvalidFieldValueException
UnknownEnumValueException
DateTimeParseBoundaryException
NumericPrecisionException
PayloadTooLargeException
UnexpectedEmptyBodyException
ErrorBodyParseException
```

Jangan lempar generic `RuntimeException`.

### 21.1 Retryability

| Failure | Retryable? | Reason |
|---|---:|---|
| malformed JSON on 200 | biasanya tidak | provider contract bug |
| HTML body on 502 | mungkin | gateway temporary failure |
| empty 200 body | biasanya tidak | schema violation |
| timeout while reading body | mungkin | transport/downstream issue |
| body too large | tidak | policy limit |
| unknown enum | tergantung | contract evolution vs unsafe value |
| error body parse failure on 500 | maybe original 500 retryable | parse failure secondary |

---

## 22. Safe Logging untuk Payload

Jangan log full body sembarangan.

Payload bisa mengandung:

1. Token.
2. Session ID.
3. Personal data.
4. Address.
5. Email.
6. Payment detail.
7. Case/legal detail.
8. Internal reference.
9. Signature material.

### 22.1 Log metadata dulu, body belakangan

Lebih aman:

```text
external_system=CustomerAPI
operation=getCustomer
status=502
content_type=text/html
body_size=1487
parse_error=unexpected_content_type
correlation_id=...
```

Bukan:

```text
body=<full payload>
```

### 22.2 Safe snippet

Jika perlu snippet:

```java
public String safeSnippet(String body) {
    if (body == null) return "";
    String truncated = body.length() > 512 ? body.substring(0, 512) : body;
    return redact(truncated);
}
```

Redaction harus dilakukan sebelum log.

---

## 23. Mapping dan Observability

Mapping boundary harus menghasilkan metric.

Minimal metrics:

```text
http_client_mapping_success_total{client,operation,content_type}
http_client_mapping_failure_total{client,operation,reason}
http_client_payload_size_bytes{client,operation,status_family}
http_client_error_body_parse_failure_total{client,operation}
http_client_unknown_enum_total{client,operation,field}
http_client_missing_required_field_total{client,operation,field}
```

Hati-hati cardinality:

Jangan gunakan raw enum value eksternal sebagai label jika tidak dibatasi.

Buruk:

```text
unknown_enum_value="SOME_VENDOR_RANDOM_VALUE_123"
```

Baik:

```text
field="status"
reason="unknown_enum"
```

Raw value bisa disimpan di structured log dengan redaction dan sampling jika aman.

---

## 24. Mapping di JDK HttpClient

JDK `HttpClient` tidak menyediakan JSON mapper built-in. Kita pilih `BodyHandler` lalu parse sendiri.

### 24.1 Simple buffered JSON

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .GET()
    .header("Accept", "application/json")
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));

if (response.statusCode() >= 200 && response.statusCode() < 300) {
    requireJson(response.headers().firstValue("Content-Type").orElse(""));
    ExternalCustomerDto dto = objectMapper.readValue(response.body(), ExternalCustomerDto.class);
    validator.validate(dto);
    return mapper.toDomain(dto);
}
```

### 24.2 Safer client method skeleton

```java
public CustomerSnapshot getCustomer(CustomerId id) {
    HttpResponse<String> response;
    try {
        response = httpClient.send(buildRequest(id), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    } catch (IOException ex) {
        throw new ExternalTransportException("Customer API transport failure", ex);
    } catch (InterruptedException ex) {
        Thread.currentThread().interrupt();
        throw new ExternalClientInterruptedException("Customer API call interrupted", ex);
    }

    return responseClassifier.classify(
        "getCustomer",
        response.statusCode(),
        response.headers(),
        response.body()
    );
}
```

Classifier menangani status, content-type, success parser, error parser, dan mapping exception.

---

## 25. Mapping di OkHttp

OkHttp memberi `ResponseBody` yang harus ditutup.

```java
try (Response response = okHttpClient.newCall(request).execute()) {
    ResponseBody responseBody = response.body();
    String body = responseBody == null ? "" : responseBody.string();

    if (response.isSuccessful()) {
        requireJson(response.header("Content-Type", ""));
        ExternalCustomerDto dto = objectMapper.readValue(body, ExternalCustomerDto.class);
        validator.validate(dto);
        return mapper.toDomain(dto);
    }

    throw errorMapper.toException(response.code(), response.header("Content-Type"), body);
}
```

Catatan penting:

1. `response.body().string()` hanya bisa dikonsumsi sekali.
2. Untuk body besar, jangan pakai `string()`.
3. Gunakan stream untuk large payload.
4. Selalu tutup response.

Streaming:

```java
try (Response response = okHttpClient.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        return handleError(response);
    }

    try (InputStream in = response.body().byteStream()) {
        ExternalLargeResponse parsed = streamingParser.parse(in);
        return mapper.toDomain(parsed);
    }
}
```

---

## 26. Mapping di Retrofit

Retrofit melakukan mapping melalui converter.

```java
public interface CustomerApi {
    @GET("/customers/{id}")
    Call<ExternalCustomerDto> getCustomer(@Path("id") String id);
}
```

Namun production client tidak seharusnya mengembalikan `ExternalCustomerDto` ke application layer.

Wrapper:

```java
public final class CustomerGateway {
    private final CustomerApi api;
    private final ExternalCustomerValidator validator;
    private final CustomerMapper mapper;

    public CustomerSnapshot getCustomer(CustomerId id) {
        Response<ExternalCustomerDto> response;
        try {
            response = api.getCustomer(id.value()).execute();
        } catch (IOException ex) {
            throw new ExternalTransportException("Customer API transport failure", ex);
        }

        if (response.isSuccessful()) {
            ExternalCustomerDto body = response.body();
            if (body == null) {
                throw new EmptyBodyException("Customer API returned empty success body");
            }
            validator.validate(body);
            return mapper.toDomain(body);
        }

        throw errorMapper.toException(response.code(), response.errorBody());
    }
}
```

### 26.1 Converter is not architecture

Retrofit converter hanya mengubah bytes menjadi DTO. Ia tidak menggantikan:

1. Semantic validation.
2. Error classification.
3. Domain mapping.
4. Retry decision.
5. Audit logic.
6. Redaction.

---

## 27. Mapping di Apache HttpClient

Apache classic response entity perlu dikonsumsi/ditutup dengan benar.

```java
try (CloseableHttpResponse response = client.execute(request)) {
    int status = response.getCode();
    HttpEntity entity = response.getEntity();
    String body = entity == null ? "" : EntityUtils.toString(entity, StandardCharsets.UTF_8);

    if (status >= 200 && status < 300) {
        ExternalCustomerDto dto = objectMapper.readValue(body, ExternalCustomerDto.class);
        validator.validate(dto);
        return mapper.toDomain(dto);
    }

    throw errorMapper.toException(status, body);
}
```

Untuk large payload, gunakan stream dari entity, bukan `EntityUtils.toString`.

---

## 28. DTO Design Guidelines untuk Java 8–25

### 28.1 Java 8-compatible DTO

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public final class ExternalCustomerDto {
    private String id;
    private String name;
    private String status;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}
```

### 28.2 Java 16+ record DTO

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public record ExternalCustomerDto(
    String id,
    String name,
    String status
) {}
```

Record cocok untuk immutable DTO, tetapi tetap perlu validasi boundary.

### 28.3 Jangan masukkan behavior domain ke DTO

DTO sebaiknya tidak berisi business decision:

```java
// Hindari
public boolean canBeApproved() { ... }
```

DTO boleh punya helper minimal jika benar-benar terkait parsing, tetapi lebih bersih jika mapping/validation dipisah.

---

## 29. Validation Setelah Deserialization

Deserialization hanya memastikan payload bisa dibaca sebagai object. Ia tidak memastikan object valid secara kontrak.

Gunakan validator eksplisit:

```java
public final class ExternalCustomerValidator {
    public void validate(ExternalCustomerDto dto) {
        require(dto.id(), "id");
        require(dto.name(), "name");
        require(dto.status(), "status");
    }

    private void require(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new MissingRequiredFieldException(field);
        }
    }
}
```

Untuk Java 8, ganti `isBlank()` dengan trim check:

```java
value.trim().isEmpty()
```

### 29.1 Bean Validation?

Bean Validation bisa digunakan:

```java
public final class ExternalCustomerDto {
    @NotBlank
    public String id;

    @NotBlank
    public String name;
}
```

Tetapi untuk boundary yang kompleks, validator manual sering lebih eksplisit karena bisa mengontrol:

1. Classification.
2. Error message.
3. Field path.
4. Retryability.
5. Redaction.
6. Metrics.

---

## 30. Anti-Corruption Mapping Pattern

Contoh lengkap sederhana:

```java
public final class CustomerGateway {
    private final RawCustomerHttpClient http;
    private final ExternalCustomerParser parser;
    private final ExternalCustomerValidator validator;
    private final CustomerMapper mapper;

    public CustomerSnapshot getCustomer(CustomerId id) {
        RawHttpResponse raw = http.getCustomer(id.value());

        ParsedHttpResult<ExternalCustomerDto> parsed = parser.parse(raw);

        if (!parsed.isSuccess()) {
            throw parsed.error().toException();
        }

        ExternalCustomerDto dto = parsed.body();
        validator.validate(dto);

        return mapper.toDomain(dto);
    }
}
```

Layering:

```text
RawCustomerHttpClient:
  transport concern

ExternalCustomerParser:
  status/content-type/body parser

ExternalCustomerValidator:
  schema/contract validation

CustomerMapper:
  external DTO -> domain model

CustomerGateway:
  orchestration boundary
```

Ini membuat setiap concern mudah dites.

---

## 31. Schema Evolution Strategy

External API berubah. Client harus punya strategi.

### 31.1 Additive field

Provider menambah field baru.

Client response DTO:

```text
should tolerate unless strict validation mode
```

### 31.2 Removed field

Provider menghapus field yang client butuhkan.

```text
should fail schema validation
alert contract regression
usually not retryable
```

### 31.3 Field type changes

```json
{ "amount": "12.50" }
```

menjadi:

```json
{ "amount": 12.50 }
```

Bisa ditoleransi jika policy jelas. Namun jangan terlalu permisif untuk field penting.

### 31.4 Enum value addition

Tentukan per field:

```text
fail closed
or map to UNKNOWN
or preserve raw + degrade
```

### 31.5 Error format changes

Error parser harus best-effort dan tidak menghilangkan status code asli.

---

## 32. Contract Test untuk Mapping

Mapping harus diuji dengan payload nyata.

Test cases minimal:

```text
valid minimal success response
valid full success response
unknown additive field
missing required field
explicit null required field
unknown enum value
invalid date/time
large number / monetary precision
error response standard
error response malformed
HTML error body
empty body
unexpected content type
partial success response
```

Contoh test:

```java
@Test
void shouldRejectMissingRequiredName() {
    String json = "{\"id\":\"C123\",\"status\":\"ACTIVE\"}";

    ExternalCustomerDto dto = objectMapper.readValue(json, ExternalCustomerDto.class);

    assertThrows(MissingRequiredFieldException.class, () -> validator.validate(dto));
}
```

Untuk contract test, simpan sample payload:

```text
src/test/resources/contracts/customer-api/get-customer-200-minimal.json
src/test/resources/contracts/customer-api/get-customer-200-full.json
src/test/resources/contracts/customer-api/get-customer-404-problem.json
src/test/resources/contracts/customer-api/get-customer-500-html.html
```

---

## 33. Security Considerations

Mapping boundary adalah security-sensitive.

### 33.1 Jangan deserialize Java native serialization dari HTTP

Hindari menerima Java native serialized object dari external HTTP boundary. Deserialization Java historically berisiko tinggi jika input tidak trusted.

### 33.2 Batasi polymorphism

Jangan biarkan payload menentukan class Java arbitrary.

### 33.3 Batasi body size

Payload besar dapat menjadi DoS vector.

### 33.4 Harden XML parser

Matikan DTD/external entity jika tidak perlu.

### 33.5 Redact sensitive fields

Field seperti ini harus dianggap sensitif:

```text
token
access_token
refresh_token
authorization
password
secret
apiKey
sessionId
nric
email
phone
address
payment
```

### 33.6 Jangan log signature material

Untuk HMAC/canonical request, jangan log secret, raw Authorization, atau signed canonical string jika berisi data sensitif.

---

## 34. Production Failure Examples

### 34.1 Provider menambah enum baru

Symptom:

```text
JsonMappingException: Cannot deserialize value of type Status from String "PENDING_REVIEW"
```

Root cause:

```text
DTO memakai enum langsung dan tidak punya unknown strategy.
```

Better design:

```text
Raw string in DTO -> mapper decides fail/unknown/degrade.
```

### 34.2 Gateway mengembalikan HTML 502

Symptom:

```text
JsonParseException: Unexpected character '<'
```

Root cause:

```text
Client parse body sebagai JSON sebelum validasi status/content-type.
```

Better design:

```text
classify status -> content-type aware error parser -> preserve original 502.
```

### 34.3 Missing field menjadi default 0

Symptom:

```text
Customer score unexpectedly 0.
```

Root cause:

```text
DTO memakai primitive int; missing field default ke 0.
```

Better design:

```text
Integer + required field validation.
```

### 34.4 Monetary precision loss

Symptom:

```text
Amount mismatch by tiny decimal.
```

Root cause:

```text
double used for money.
```

Better design:

```text
BigDecimal + scale/currency validation.
```

### 34.5 XML XXE vulnerability

Symptom:

```text
XML parser attempts network/file access during parse.
```

Root cause:

```text
External entity resolution enabled.
```

Better design:

```text
Disable DTD/external entity; use hardened parser factory.
```

---

## 35. Design Checklist

Sebelum HTTP client dianggap production-ready, jawab checklist ini.

### 35.1 DTO Boundary

- [ ] Apakah external DTO terpisah dari domain model?
- [ ] Apakah generated DTO tidak bocor ke application layer?
- [ ] Apakah mapper eksplisit tersedia?
- [ ] Apakah raw external enum/value penting disimpan untuk audit?

### 35.2 JSON/XML Parsing

- [ ] Apakah parser dipilih berdasarkan `Content-Type`?
- [ ] Apakah unexpected content type ditangani?
- [ ] Apakah empty body semantics jelas?
- [ ] Apakah body size limit ada?
- [ ] Apakah large payload memakai streaming?

### 35.3 Compatibility

- [ ] Apakah unknown field policy jelas?
- [ ] Apakah missing required field divalidasi?
- [ ] Apakah enum evolution policy jelas?
- [ ] Apakah null semantics jelas?
- [ ] Apakah date/time contract jelas?
- [ ] Apakah number precision aman?

### 35.4 Error Body

- [ ] Apakah success body dan error body diparse berbeda?
- [ ] Apakah Problem Details didukung jika relevan?
- [ ] Apakah malformed error body tetap mempertahankan status code asli?
- [ ] Apakah error parser best-effort?

### 35.5 Security

- [ ] Apakah XML parser hardened?
- [ ] Apakah polymorphic deserialization dibatasi?
- [ ] Apakah tidak memakai native Java deserialization dari external input?
- [ ] Apakah body log direduksi/redacted?
- [ ] Apakah sensitive fields tidak masuk metric label?

### 35.6 Observability

- [ ] Apakah mapping failure punya reason code?
- [ ] Apakah missing field/unknown enum bisa dimonitor?
- [ ] Apakah payload size dimonitor?
- [ ] Apakah parse error tidak menutupi original HTTP status?

### 35.7 Testing

- [ ] Apakah valid minimal/full response dites?
- [ ] Apakah unknown field dites?
- [ ] Apakah missing field dites?
- [ ] Apakah null field dites?
- [ ] Apakah unknown enum dites?
- [ ] Apakah invalid datetime dites?
- [ ] Apakah malformed JSON/XML dites?
- [ ] Apakah HTML error body dites?
- [ ] Apakah empty body dites?
- [ ] Apakah large payload dites?

---

## 36. Top 1% Heuristics

Engineer biasa berpikir:

```text
Saya sudah bisa deserialize JSON ke object.
```

Engineer senior berpikir:

```text
Apakah object hasil deserialization ini valid, aman, kompatibel, observable, dan tidak merusak domain invariant?
```

Engineer top-tier berpikir lebih jauh:

```text
Apa policy evolusi kontrak untuk setiap field?
Apa failure classification jika payload berubah?
Apa data yang boleh masuk log?
Apa yang terjadi jika provider mengirim HTML, null, enum baru, angka besar, timestamp ambiguous, atau body 100 MB?
Apakah domain tetap terlindungi jika external schema berubah?
Apakah mapper bisa diuji tanpa network?
Apakah incident bisa didiagnosis dari metric/log tanpa membuka payload sensitif?
```

Inilah perbedaan antara “HTTP integration works” dan “HTTP integration is operationally safe”.

---

## 37. Ringkasan

Mapping JSON/XML di HTTP client boundary adalah proses transformasi lintas trust boundary.

Alur yang sehat:

```text
raw HTTP response
→ status classification
→ content-type validation
→ body size/streaming policy
→ JSON/XML parser
→ external DTO
→ schema validation
→ semantic validation
→ anti-corruption mapper
→ domain-safe object or typed error
```

Prinsip utama:

1. Jangan deserialize langsung ke domain model.
2. Treat external payload as untrusted.
3. Unknown field, missing field, null, enum, date, number punya policy eksplisit.
4. Error body berbeda dari success body.
5. XML butuh hardening tambahan.
6. Large payload butuh streaming/limit.
7. Mapping failure harus diklasifikasikan dan observable.
8. Log payload hanya jika aman, terbatas, dan redacted.
9. Contract test harus mencakup edge cases.
10. Mapper adalah anti-corruption layer, bukan boilerplate.

---

## 38. Referensi

- Jackson Databind `DeserializationFeature` documentation — unknown properties, numeric precision, and deserialization behavior.
- FasterXML Jackson annotations documentation — `@JsonIgnoreProperties` and related annotations.
- Jakarta XML Binding documentation — runtime binding framework for marshalling/unmarshalling and XML-to-Java mapping.
- RFC 9457 — Problem Details for HTTP APIs.
- JDK `java.net.http` documentation — body handling and HTTP client response processing.
- OkHttp documentation — response body lifecycle and stream handling.
- Retrofit documentation — converter-based mapping from HTTP API interface to Java object.
- Apache HttpClient 5 documentation — entity handling and response processing.

---

## 39. Posisi Kita di Series

Sudah selesai:

1. Part 0 — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
2. Part 1 — Java HTTP Client Landscape di Java 8–25
3. Part 2 — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body
4. Part 3 — URI, URL, Encoding, Query Parameter, dan Canonical Request
5. Part 4 — Headers, Content Negotiation, Compression, dan Metadata Contract
6. Part 5 — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download
7. Part 6 — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS
8. Part 7 — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse
9. Part 8 — DNS, Proxy, Load Balancer, NAT, dan Network Topology Awareness
10. Part 9 — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning
11. Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh
12. Part 11 — Retry Engineering: Idempotency, Backoff, Jitter, Retry Budget, dan Hedging
13. Part 12 — Rate Limiting, Throttling, Bulkhead, dan Client-Side Load Shedding
14. Part 13 — Circuit Breaker, Timeout, Retry, dan Fallback Composition
15. Part 14 — JDK HttpClient Deep Dive
16. Part 15 — OkHttp Deep Dive: Client, Dispatcher, Interceptor, ConnectionPool
17. Part 16 — Retrofit Deep Dive: Type-Safe API Client di Atas OkHttp
18. Part 17 — Apache HttpClient 5 Deep Dive
19. Part 18 — Spring HTTP Client Layer: RestTemplate, WebClient, RestClient
20. Part 19 — API Client Architecture: Port, Adapter, Gateway, SDK, Anti-Corruption Layer
21. Part 20 — Error Modelling: Status Code, Transport Failure, Protocol Failure, Domain Failure
22. Part 21 — Observability: Logging, Metrics, Tracing, Correlation, Redaction
23. Part 22 — Testing HTTP Clients: Unit, Contract, Integration, Chaos, Mock Server
24. Part 23 — JSON/XML Mapping for HTTP Client Boundary

Berikutnya:

Part 24 — Performance Engineering: Throughput, Latency, Allocation, GC, Threading  
File: `24-performance-engineering-throughput-latency-allocation-gc-threading.md`

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 22 — Testing HTTP Clients: Unit, Contract, Integration, Chaos, Mock Server](./22-testing-http-clients-unit-contract-integration-chaos-mockserver.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 24 — Performance Engineering: Throughput, Latency, Allocation, GC, Threading](./24-performance-engineering-throughput-latency-allocation-gc-threading.md)
