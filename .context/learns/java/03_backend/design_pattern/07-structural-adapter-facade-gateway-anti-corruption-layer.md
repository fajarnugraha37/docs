# 07 — Structural Pattern I: Adapter, Facade, Gateway, Anti-Corruption Layer

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Bagian: `07-structural-adapter-facade-gateway-anti-corruption-layer.md`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: structural boundary, model translation, integration isolation, semantic protection, anti-corruption, dan desain adapter/facade/gateway yang tidak bocor.

---

## 0. Peta Besar

Pada bagian sebelumnya kita membahas pattern pembuatan objek: constructor, factory, builder, singleton, registry, dan service locator. Semua itu menjawab pertanyaan:

> Bagaimana objek dibuat, siapa yang berhak membuatnya, dan bagaimana lifecycle-nya dikendalikan?

Bagian ini berpindah ke pertanyaan yang lebih besar:

> Bagaimana sistem kita berinteraksi dengan dunia luar tanpa membiarkan bentuk, bahasa, error, lifecycle, dan kebiasaan dunia luar merusak model internal kita?

Empat pattern utama di bagian ini adalah:

1. **Adapter**  
   Mengubah interface atau bentuk dari sesuatu yang tidak cocok agar bisa dipakai oleh client internal.

2. **Facade**  
   Menyediakan interface sederhana di depan subsystem yang kompleks.

3. **Gateway**  
   Mengisolasi akses ke sistem eksternal, network API, messaging, database eksternal, file service, payment provider, identity provider, dan sejenisnya.

4. **Anti-Corruption Layer / ACL**  
   Lapisan proteksi semantik yang menerjemahkan model eksternal ke model internal, supaya domain internal tidak terkontaminasi konsep dari sistem lain.

Keempatnya mirip, tetapi tidak sama.

Ringkasnya:

```text
Adapter              : interface tidak cocok -> cocokkan.
Facade               : subsystem rumit -> sederhanakan.
Gateway              : external access -> isolasi technical protocol.
Anti-Corruption Layer: model/semantik asing -> lindungi domain internal.
```

Dalam sistem enterprise, pattern ini sangat penting karena sebagian besar kompleksitas tidak datang dari algoritma, tetapi dari boundary:

- API eksternal berubah.
- Format response tidak konsisten.
- Error code vendor tidak stabil.
- Sistem legacy memiliki istilah domain berbeda.
- Data eksternal incomplete.
- Timeout, retry, auth, token, quota, dan versioning harus dikendalikan.
- Model internal perlu tetap bersih untuk jangka panjang.

Engineer junior biasanya menulis:

```java
ExternalResponse response = externalClient.call(...);
entity.setExternalStatus(response.getStatus());
```

Engineer senior bertanya:

```text
Apakah status eksternal punya arti yang sama dengan status internal?
Apakah external response boleh masuk sampai domain model?
Siapa yang menerjemahkan error?
Apa yang terjadi jika vendor menambah field, mengubah enum, atau mengembalikan null?
Apakah retry aman?
Apakah kita punya contract test untuk boundary ini?
Apakah audit internal memakai bahasa internal atau bahasa vendor?
```

Pattern di bagian ini adalah alat untuk menjawab pertanyaan tersebut.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan Adapter, Facade, Gateway, dan Anti-Corruption Layer secara tajam.
2. Menentukan kapan cukup memakai adapter sederhana dan kapan perlu ACL penuh.
3. Mendesain boundary yang menjaga domain internal dari model eksternal.
4. Menerjemahkan request, response, error, status, identifier, timestamp, currency, dan lifecycle antar sistem.
5. Menghindari pass-through adapter yang hanya memindahkan dependency tanpa memberikan isolasi nyata.
6. Membuat Java code yang eksplisit tentang translation, validation, mapping, fallback, dan failure semantics.
7. Mendesain integration boundary yang testable, observable, versionable, dan aman terhadap perubahan eksternal.
8. Menilai trade-off antara simplicity, isolation, duplication, latency, dan maintainability.
9. Mengenali anti-pattern seperti leaky facade, external model infection, DTO tunneling, dan stringly typed gateway.
10. Melakukan refactoring dari codebase yang langsung memakai external API client menjadi boundary yang bersih.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Misalkan sistem internal kamu memiliki domain `Application`, `Case`, `Applicant`, `Decision`, dan `AuditTrail`.

Sistem ini harus berkomunikasi dengan external provider:

- identity provider,
- geolocation API,
- payment API,
- legacy licensing system,
- messaging platform,
- document repository,
- government registry,
- third-party scoring API.

Response eksternal biasanya tidak sempurna:

```json
{
  "code": "00",
  "desc": "SUCCESS",
  "payload": {
    "app_ref": "EXT-99172",
    "stat": "A",
    "addr": null,
    "last_update": "18/06/2026 13:44:20",
    "flags": ["X1", "LEGACY_OVR"]
  }
}
```

Masalahnya:

- `code = "00"` adalah konsep vendor, bukan konsep domain internal.
- `stat = "A"` belum tentu sama dengan `ApplicationStatus.APPROVED`.
- `last_update` memakai format vendor.
- `addr = null` mungkin berarti tidak ditemukan, tidak tersedia, atau provider error.
- `flags` punya arti tersembunyi.
- Nama field eksternal tidak sesuai ubiquitous language internal.

Kalau response itu dibiarkan masuk ke domain, service, repository, controller, dan audit, maka domain internal perlahan berubah menjadi bayangan sistem eksternal.

Awalnya terlihat praktis:

```java
if (response.getCode().equals("00") && response.getPayload().getStat().equals("A")) {
    application.approve();
}
```

Beberapa bulan kemudian:

```java
if ((response.getCode().equals("00") || response.getCode().equals("000"))
        && (response.getPayload().getStat().equals("A")
        || response.getPayload().getStat().equals("APP")
        || response.getPayload().getFlags().contains("LEGACY_OVR"))) {
    application.approve();
}
```

Lalu muncul:

- logic vendor tersebar,
- testing sulit,
- migration sulit,
- audit ambigu,
- domain language rusak,
- error handling inkonsisten,
- coupling naik diam-diam.

Pattern di bagian ini ada untuk mencegah itu.

---

## 3. Mental Model Utama: Boundary Adalah Zona Terjemahan

Boundary bukan sekadar package, interface, atau class wrapper.

Boundary adalah tempat di mana satu dunia diterjemahkan ke dunia lain.

```text
External World                          Internal World
--------------                          --------------
Vendor field name        --->           Domain term
Vendor status code       --->           Domain state
HTTP error               --->           Application failure
Timeout                  --->           Retryable dependency failure
Legacy ID                --->           External reference value object
Null                     --->           explicit absence / failure / unknown
Vendor lifecycle         --->           internal transition event
```

Boundary yang baik tidak hanya mengubah bentuk data. Boundary yang baik mengubah **arti**.

Contoh buruk:

```java
class AddressAdapter {
    InternalAddress adapt(ExternalAddress external) {
        return new InternalAddress(
                external.getPostalCode(),
                external.getLine1(),
                external.getLine2()
        );
    }
}
```

Ini mungkin adapter bentuk data, tetapi belum tentu ACL. Jika `ExternalAddress` punya nilai khusus seperti `postalCode = "000000"` yang berarti “unknown”, adapter di atas gagal menerjemahkan semantik.

Contoh lebih baik:

```java
final class ExternalAddressTranslator {

    AddressResolution translate(ExternalAddressResponse response) {
        if (response == null) {
            return AddressResolution.unavailable("provider-returned-empty-response");
        }

        if ("NOT_FOUND".equals(response.code())) {
            return AddressResolution.notFound();
        }

        if (!"SUCCESS".equals(response.code())) {
            return AddressResolution.providerFailure(response.code(), response.message());
        }

        ExternalAddressPayload payload = response.payload();
        if (payload == null || "000000".equals(payload.postalCode())) {
            return AddressResolution.unknown();
        }

        return AddressResolution.resolved(new Address(
                new PostalCode(payload.postalCode()),
                AddressLine.of(payload.line1()),
                AddressLine.optional(payload.line2())
        ));
    }
}
```

Terjemahan yang matang menjawab:

1. Apa arti sukses?
2. Apa arti tidak ditemukan?
3. Apa arti data kosong?
4. Apa arti error provider?
5. Apakah error retryable?
6. Apakah data cukup valid untuk domain internal?
7. Apa yang boleh masuk ke domain?
8. Apa yang hanya boleh disimpan sebagai external diagnostic?

---

## 4. Adapter Pattern

### 4.1 Definisi

Adapter adalah pattern yang mengubah interface suatu objek agar cocok dengan interface yang diharapkan client.

Secara mental:

```text
Client expects A.
Existing object provides B.
Adapter converts B into A.
```

Diagram sederhana:

```text
Internal Client
      |
      v
Expected Interface
      ^
      |
Adapter
      |
      v
External / Legacy / Incompatible Object
```

Adapter menjawab masalah bentuk interface yang tidak cocok.

### 4.2 Kapan Adapter Dipakai

Gunakan Adapter ketika:

1. Ada class/library/API yang fungsinya berguna tetapi interface-nya tidak sesuai.
2. Kamu ingin melindungi internal code dari dependency langsung ke library/vendor.
3. Ada legacy class dengan method lama, tetapi internal code butuh interface baru.
4. Kamu sedang melakukan migration bertahap dari implementation lama ke baru.
5. Kamu ingin membuat test double lebih mudah.
6. Kamu ingin menyederhanakan penggunaan API yang terlalu teknis.

### 4.3 Contoh Masalah

Misalkan internal domain butuh port seperti ini:

```java
public interface PostalCodeLookup {
    AddressLookupResult lookup(PostalCode postalCode);
}
```

Vendor client menyediakan API seperti ini:

```java
public final class VendorGeoClient {
    public VendorGeoResponse searchByPostal(String postal, String token, int timeoutMillis) {
        // HTTP call to vendor
        return null;
    }
}
```

Jika service internal langsung memakai `VendorGeoClient`, maka service menjadi tahu:

- vendor class,
- token,
- timeout,
- response vendor,
- status vendor,
- error vendor.

Adapter membuat internal service hanya tahu `PostalCodeLookup`.

```java
public final class VendorPostalCodeLookupAdapter implements PostalCodeLookup {

    private final VendorGeoClient client;
    private final VendorTokenProvider tokenProvider;
    private final VendorGeoTranslator translator;
    private final int timeoutMillis;

    public VendorPostalCodeLookupAdapter(
            VendorGeoClient client,
            VendorTokenProvider tokenProvider,
            VendorGeoTranslator translator,
            int timeoutMillis
    ) {
        this.client = client;
        this.tokenProvider = tokenProvider;
        this.translator = translator;
        this.timeoutMillis = timeoutMillis;
    }

    @Override
    public AddressLookupResult lookup(PostalCode postalCode) {
        String token = tokenProvider.currentToken();
        VendorGeoResponse response = client.searchByPostal(
                postalCode.value(),
                token,
                timeoutMillis
        );
        return translator.toAddressLookupResult(response);
    }
}
```

Internal service:

```java
public final class ApplicationAddressService {

    private final PostalCodeLookup postalCodeLookup;

    public ApplicationAddressService(PostalCodeLookup postalCodeLookup) {
        this.postalCodeLookup = postalCodeLookup;
    }

    public Address resolveApplicantAddress(PostalCode postalCode) {
        AddressLookupResult result = postalCodeLookup.lookup(postalCode);

        if (result instanceof AddressLookupResult.Resolved resolved) {
            return resolved.address();
        }

        if (result instanceof AddressLookupResult.NotFound) {
            throw new AddressNotFoundException(postalCode);
        }

        if (result instanceof AddressLookupResult.Unavailable unavailable) {
            throw new AddressProviderUnavailableException(unavailable.reason());
        }

        throw new IllegalStateException("Unhandled address lookup result: " + result);
    }
}
```

Dengan Java 17+ sealed interface:

```java
public sealed interface AddressLookupResult
        permits AddressLookupResult.Resolved,
                AddressLookupResult.NotFound,
                AddressLookupResult.Unavailable,
                AddressLookupResult.InvalidProviderResponse {

    record Resolved(Address address) implements AddressLookupResult {}

    record NotFound(PostalCode postalCode) implements AddressLookupResult {}

    record Unavailable(String reason) implements AddressLookupResult {}

    record InvalidProviderResponse(String detail) implements AddressLookupResult {}
}
```

Keuntungan:

- domain tidak tahu vendor response,
- error eksternal diterjemahkan,
- test bisa memakai fake `PostalCodeLookup`,
- vendor bisa diganti,
- token management tidak bocor,
- timeout tidak bocor,
- domain language tetap bersih.

### 4.4 Object Adapter vs Class Adapter

Secara klasik ada dua bentuk:

1. **Class Adapter**  
   Menggunakan inheritance.

2. **Object Adapter**  
   Menggunakan composition.

Di Java modern, object adapter lebih umum karena:

- Java hanya mendukung single inheritance untuk class.
- Composition lebih fleksibel.
- Testability lebih baik.
- Dependency bisa di-inject.
- Lifecycle lebih mudah dikelola.

Contoh object adapter:

```java
public final class LegacyPaymentAdapter implements PaymentPort {

    private final LegacyPaymentClient legacyClient;

    public LegacyPaymentAdapter(LegacyPaymentClient legacyClient) {
        this.legacyClient = legacyClient;
    }

    @Override
    public PaymentResult pay(PaymentRequest request) {
        LegacyPaymentCommand command = toLegacyCommand(request);
        LegacyPaymentResponse response = legacyClient.execute(command);
        return toPaymentResult(response);
    }
}
```

Contoh class adapter jarang ideal:

```java
public final class LegacyPaymentClassAdapter
        extends LegacyPaymentClient
        implements PaymentPort {

    @Override
    public PaymentResult pay(PaymentRequest request) {
        LegacyPaymentResponse response = execute(toLegacyCommand(request));
        return toPaymentResult(response);
    }
}
```

Masalah class adapter:

- adapter mewarisi detail legacy,
- sulit mengganti client,
- lifecycle legacy ikut terbawa,
- test lebih sulit,
- raw inherited method tetap visible jika tidak hati-hati.

Gunakan composition sebagai default.

---

## 5. Facade Pattern

### 5.1 Definisi

Facade menyediakan interface sederhana untuk subsystem yang kompleks.

Jika Adapter fokus pada ketidakcocokan interface, Facade fokus pada penyederhanaan pemakaian subsystem.

Diagram:

```text
Client
  |
  v
Facade
  |-------------------|-------------------|
  v                   v                   v
Subsystem A       Subsystem B         Subsystem C
```

Facade menjawab:

> Bagaimana client bisa memakai capability kompleks tanpa harus tahu semua detail internal subsystem?

### 5.2 Contoh Masalah

Tanpa Facade:

```java
public final class RenewalController {

    private final ApplicantRepository applicantRepository;
    private final LicenseRepository licenseRepository;
    private final FeeCalculator feeCalculator;
    private final DocumentRequirementService documentRequirementService;
    private final PaymentService paymentService;
    private final NotificationService notificationService;
    private final AuditTrailService auditTrailService;

    public RenewalResponse renew(RenewalHttpRequest request) {
        Applicant applicant = applicantRepository.findById(request.applicantId());
        License license = licenseRepository.findActiveLicense(applicant.id());
        Money fee = feeCalculator.calculateRenewalFee(license);
        List<DocumentRequirement> requirements = documentRequirementService.requiredFor(license);
        PaymentResult payment = paymentService.collect(fee, request.paymentMethod());
        notificationService.notifyRenewalSubmitted(applicant);
        auditTrailService.record("renewal submitted");
        return RenewalResponse.success(...);
    }
}
```

Controller tahu terlalu banyak. Ia menjadi orchestration layer yang bocor.

Dengan Facade:

```java
public final class RenewalController {

    private final RenewalApplicationFacade renewalFacade;

    public RenewalController(RenewalApplicationFacade renewalFacade) {
        this.renewalFacade = renewalFacade;
    }

    public RenewalResponse renew(RenewalHttpRequest request) {
        RenewalSubmissionResult result = renewalFacade.submitRenewal(
                new SubmitRenewalCommand(
                        new ApplicantId(request.applicantId()),
                        request.paymentMethod(),
                        request.documentIds()
                )
        );
        return RenewalResponse.from(result);
    }
}
```

Facade:

```java
public final class RenewalApplicationFacade {

    private final ApplicantRepository applicantRepository;
    private final LicenseRepository licenseRepository;
    private final RenewalPolicy renewalPolicy;
    private final FeeCalculator feeCalculator;
    private final PaymentPort paymentPort;
    private final RenewalRepository renewalRepository;
    private final DomainEventPublisher eventPublisher;

    public RenewalSubmissionResult submitRenewal(SubmitRenewalCommand command) {
        Applicant applicant = applicantRepository.get(command.applicantId());
        License license = licenseRepository.getActiveFor(applicant.id());

        renewalPolicy.assertRenewable(applicant, license);

        Money fee = feeCalculator.calculateRenewalFee(license);
        PaymentResult payment = paymentPort.collect(command.paymentMethod(), fee);

        Renewal renewal = Renewal.submit(applicant.id(), license.id(), fee, payment.reference());
        renewalRepository.save(renewal);

        eventPublisher.publish(new RenewalSubmitted(renewal.id(), applicant.id()));

        return RenewalSubmissionResult.accepted(renewal.id());
    }
}
```

Facade menyederhanakan client, tetapi tetap harus hati-hati. Jika Facade mengambil terlalu banyak responsibility, ia berubah menjadi God Service.

### 5.3 Facade vs Service Layer

Tidak semua service adalah Facade.

Facade biasanya:

- menyembunyikan subsystem,
- menyajikan API lebih sederhana,
- sering berada di boundary aplikasi,
- mengurangi dependency client terhadap banyak komponen.

Service layer biasanya:

- mengoordinasikan use case,
- mengatur transaction boundary,
- memanggil domain/persistence/integration,
- bisa menjadi facade terhadap application capability.

Dalam enterprise Java, Application Service sering berperan sebagai Facade untuk use case tertentu.

Namun jangan menyebut semuanya Facade. Pertanyaannya:

```text
Apakah class ini benar-benar menyederhanakan subsystem?
Atau hanya class prosedural yang menampung semua logic?
```

### 5.4 Facade yang Baik

Facade yang baik:

1. Menyediakan operasi level use case.
2. Tidak mengekspos detail subsystem.
3. Tidak mengembalikan entity internal sembarangan.
4. Tidak membiarkan client menentukan urutan internal step.
5. Menjaga invariant proses.
6. Menyediakan error yang meaningful bagi caller.
7. Mudah ditest sebagai orchestration boundary.
8. Punya nama method yang mencerminkan business capability.

Contoh method facade yang baik:

```java
submitRenewal(command)
approveApplication(command)
resolveAddress(query)
generatePaymentAdvice(command)
escalateCase(command)
```

Contoh method facade yang buruk:

```java
getApplicantRepository()
calculateFeeThenMaybePay(...)
process(...)
doRenewalStep1(...)
doRenewalStep2(...)
```

Facade buruk masih memaksa client tahu detail proses.

---

## 6. Gateway Pattern

### 6.1 Definisi

Gateway adalah object yang mengisolasi akses ke resource atau sistem eksternal.

Gateway biasanya membungkus:

- HTTP API,
- SOAP API,
- messaging broker,
- file server,
- S3/blob storage,
- payment provider,
- email provider,
- SMS gateway,
- identity provider,
- legacy database,
- third-party SDK.

Gateway menjawab:

> Bagaimana aplikasi kita mengakses dunia luar melalui interface internal yang stabil?

### 6.2 Gateway vs Adapter

Gateway sering memakai Adapter di dalamnya, tetapi fokusnya lebih spesifik: akses eksternal.

```text
Adapter : mengubah interface yang tidak cocok.
Gateway : membungkus akses ke sistem eksternal.
```

Contoh:

```java
public interface DocumentStorageGateway {
    StoredDocument store(DocumentToStore document);
    DocumentContent retrieve(DocumentId documentId);
}
```

Implementasi:

```java
public final class S3DocumentStorageGateway implements DocumentStorageGateway {

    private final S3Client s3Client;
    private final String bucketName;
    private final DocumentKeyStrategy keyStrategy;

    public S3DocumentStorageGateway(
            S3Client s3Client,
            String bucketName,
            DocumentKeyStrategy keyStrategy
    ) {
        this.s3Client = s3Client;
        this.bucketName = bucketName;
        this.keyStrategy = keyStrategy;
    }

    @Override
    public StoredDocument store(DocumentToStore document) {
        String key = keyStrategy.keyFor(document);

        try {
            s3Client.putObject(
                    PutObjectRequest.builder()
                            .bucket(bucketName)
                            .key(key)
                            .contentType(document.contentType().value())
                            .build(),
                    RequestBody.fromBytes(document.bytes())
            );

            return new StoredDocument(new DocumentStorageKey(key));
        } catch (S3Exception ex) {
            throw new DocumentStorageUnavailableException("Failed to store document", ex);
        }
    }

    @Override
    public DocumentContent retrieve(DocumentId documentId) {
        // retrieve and translate exceptions
        throw new UnsupportedOperationException("example omitted");
    }
}
```

Internal application tidak perlu tahu:

- bucket,
- SDK request type,
- SDK exception,
- key naming,
- content upload detail.

### 6.3 Gateway Interface Harus Domain-Oriented

Buruk:

```java
public interface PaymentGateway {
    HttpResponse post(String url, Map<String, String> headers, String body);
}
```

Ini bukan gateway domain. Ini HTTP client bocor.

Lebih baik:

```java
public interface PaymentGateway {
    PaymentAuthorization authorize(PaymentAuthorizationRequest request);
    PaymentCapture capture(PaymentCaptureRequest request);
    RefundResult refund(RefundRequest request);
}
```

Gateway internal harus bicara dengan bahasa aplikasi, bukan bahasa transport.

Buruk:

```java
PaymentVendorResponse callPaymentApi(PaymentVendorRequest request);
```

Lebih baik:

```java
PaymentAuthorization authorize(PaymentAuthorizationRequest request);
```

### 6.4 Gateway Harus Menentukan Error Semantics

Gateway tidak boleh membiarkan semua error keluar sebagai `RuntimeException` acak.

Contoh error classification:

```java
public sealed interface ExternalPaymentFailure
        permits ExternalPaymentFailure.Timeout,
                ExternalPaymentFailure.Rejected,
                ExternalPaymentFailure.ProviderUnavailable,
                ExternalPaymentFailure.InvalidResponse {

    record Timeout(Duration duration) implements ExternalPaymentFailure {}

    record Rejected(String providerReason) implements ExternalPaymentFailure {}

    record ProviderUnavailable(String providerCode) implements ExternalPaymentFailure {}

    record InvalidResponse(String detail) implements ExternalPaymentFailure {}
}
```

Atau menggunakan exception taxonomy:

```java
public abstract class PaymentGatewayException extends RuntimeException {
    protected PaymentGatewayException(String message, Throwable cause) {
        super(message, cause);
    }

    public abstract boolean retryable();
}

public final class PaymentGatewayTimeoutException extends PaymentGatewayException {
    public PaymentGatewayTimeoutException(Throwable cause) {
        super("Payment provider timed out", cause);
    }

    @Override
    public boolean retryable() {
        return true;
    }
}

public final class PaymentRejectedException extends PaymentGatewayException {
    public PaymentRejectedException(String reason) {
        super("Payment rejected: " + reason, null);
    }

    @Override
    public boolean retryable() {
        return false;
    }
}
```

Yang penting: caller bisa mengambil keputusan yang benar.

```text
Timeout          -> mungkin retry.
Provider 503     -> mungkin retry/backoff.
Invalid response -> jangan retry buta; perlu alert.
Rejected payment -> jangan retry; user/domain action needed.
Duplicate request-> idempotency handling.
```

### 6.5 Gateway dan Observability

Gateway adalah tempat ideal untuk logging/metrics/tracing karena semua akses eksternal melewati satu boundary.

Yang perlu dicatat:

- external system name,
- operation name,
- latency,
- outcome,
- error category,
- retry count,
- timeout,
- correlation ID,
- external reference ID,
- sanitized provider code,
- rate limit status jika ada.

Jangan log:

- token,
- password,
- PII tanpa masking,
- full payload sensitif,
- private key,
- raw document content.

Contoh metric labels:

```text
external_call_total{system="payment",operation="authorize",outcome="success"}
external_call_total{system="payment",operation="authorize",outcome="timeout"}
external_call_latency_ms{system="payment",operation="authorize"}
external_call_retry_total{system="payment",operation="authorize"}
```

---

## 7. Anti-Corruption Layer / ACL

### 7.1 Definisi

Anti-Corruption Layer adalah lapisan isolasi antara dua model yang berbeda agar model internal tidak terkontaminasi oleh model eksternal.

ACL bukan sekadar mapper.

ACL menerjemahkan:

- struktur data,
- istilah domain,
- status,
- lifecycle,
- invariant,
- error,
- command,
- event,
- identity,
- temporal semantics,
- consistency assumption,
- ownership.

Diagram:

```text
Internal Domain
      |
      v
Internal Port / Use Case Interface
      |
      v
Anti-Corruption Layer
      |-------------------------------|
      v                               v
Translator / Mapper              Gateway / Adapter
      |                               |
      v                               v
External Model                  External System
```

ACL diperlukan ketika masalahnya bukan hanya interface, tetapi perbedaan bahasa dan makna.

### 7.2 Kapan ACL Diperlukan

Gunakan ACL ketika:

1. Sistem eksternal punya domain model berbeda.
2. Legacy system punya istilah yang tidak boleh masuk ke sistem baru.
3. Vendor API tidak stabil atau bukan milik kita.
4. Response eksternal punya banyak kode/status dengan arti bisnis.
5. External lifecycle tidak sama dengan internal lifecycle.
6. Sistem baru sedang menggantikan sistem lama secara bertahap.
7. Ada risiko domain internal menjadi sekadar mirror dari sistem eksternal.
8. Integrasi membawa regulatory/audit consequence.
9. Data eksternal perlu validasi dan normalisasi serius.
10. Business rule internal tidak boleh tersebar mengikuti provider behavior.

### 7.3 Adapter vs ACL

Adapter bisa hanya seperti ini:

```text
Method A -> Method B
Field X  -> Field Y
```

ACL seperti ini:

```text
External status "A" + flag "OVR" + effectiveDate null
    -> Internal concept: DecisionPendingManualReview
    -> Reason: provider approved but override flag requires officer confirmation
    -> Retry: no
    -> Audit: record external approval and internal manual-review transition
```

Perbedaan utama:

| Aspek | Adapter | ACL |
|---|---|---|
| Fokus | Interface compatibility | Semantic protection |
| Kedalaman | Sering teknis | Domain-level |
| Mapping | Bentuk data/method | Meaning, lifecycle, error, invariant |
| Risiko jika tidak ada | Code tidak cocok | Domain internal tercemar |
| Contoh | Convert `VendorClient` ke `PaymentPort` | Translate legacy licensing lifecycle ke internal case lifecycle |

### 7.4 ACL Bukan Selalu Diperlukan

Jangan membuat ACL besar untuk semua hal.

ACL mungkin overkill jika:

- external API sederhana dan stabil,
- tidak ada perbedaan domain signifikan,
- hanya mengambil data lookup sederhana,
- model eksternal memang milik internal team yang sama dan contract stabil,
- cost translation lebih besar daripada risiko coupling,
- integrasi hanya technical transport tanpa semantic mismatch.

Namun walaupun tidak perlu ACL penuh, tetap sebaiknya ada gateway/adapter minimal agar dependency teknis tidak menyebar.

---

## 8. Boundary Translation: Apa Saja yang Harus Diterjemahkan?

Banyak engineer menganggap mapping hanya field-to-field.

Dalam sistem nyata, yang perlu diterjemahkan jauh lebih banyak.

### 8.1 Identifier

External ID tidak sama dengan internal ID.

Buruk:

```java
application.setId(externalResponse.getApplicationId());
```

Lebih baik:

```java
public record ApplicationId(UUID value) {}
public record ExternalApplicationReference(String value) {}
```

Entity:

```java
public final class Application {
    private final ApplicationId id;
    private ExternalApplicationReference externalReference;
}
```

Dengan ini kita tahu:

```text
ApplicationId              : identitas internal.
ExternalApplicationReference: referensi dari sistem luar.
```

### 8.2 Status

External status jarang punya arti yang identik.

```java
public enum VendorStatus {
    A, P, R, X
}

public enum ApplicationState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CANCELLED,
    MANUAL_REVIEW_REQUIRED
}
```

Translator:

```java
public final class VendorStatusTranslator {

    public ApplicationState translate(VendorStatus status, Set<String> flags) {
        if (status == VendorStatus.A && flags.contains("OVERRIDE")) {
            return ApplicationState.MANUAL_REVIEW_REQUIRED;
        }

        return switch (status) {
            case A -> ApplicationState.APPROVED;
            case P -> ApplicationState.UNDER_REVIEW;
            case R -> ApplicationState.REJECTED;
            case X -> ApplicationState.CANCELLED;
        };
    }
}
```

### 8.3 Time

External time format perlu diterjemahkan ke type internal.

Buruk:

```java
String lastUpdate = response.getLastUpdate();
```

Lebih baik:

```java
Instant providerUpdatedAt = vendorTimeParser.parse(response.lastUpdate());
```

Pertanyaan penting:

- timezone apa yang dipakai provider?
- apakah timestamp merepresentasikan created time, updated time, event time, atau processing time?
- apakah provider bisa mengirim timestamp masa depan?
- apakah timestamp nullable?
- apakah precision detik, milidetik, atau nanodetik?

### 8.4 Money and Currency

Jangan terima amount eksternal sebagai `double`.

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("Invalid monetary scale");
        }
    }
}
```

External field:

```json
{
  "amount": "100.00",
  "ccy": "SGD"
}
```

Translator:

```java
public Money toMoney(VendorAmount amount) {
    return new Money(
            new BigDecimal(amount.value()),
            Currency.getInstance(amount.currencyCode())
    );
}
```

### 8.5 Null and Missing Data

External `null` punya banyak kemungkinan arti:

- unknown,
- not applicable,
- not found,
- access denied,
- provider bug,
- field omitted karena API version,
- field omitted karena partial response,
- data pending.

Internal model harus eksplisit.

```java
public sealed interface AddressAvailability {
    record Available(Address address) implements AddressAvailability {}
    record NotFound() implements AddressAvailability {}
    record Unknown(String reason) implements AddressAvailability {}
    record NotApplicable() implements AddressAvailability {}
}
```

### 8.6 Error

External error harus dinormalisasi.

Vendor:

```json
{
  "code": "E1042",
  "message": "Invalid postal"
}
```

Internal:

```java
public sealed interface AddressProviderError {
    record InvalidPostalCode(PostalCode postalCode) implements AddressProviderError {}
    record RateLimited(Duration retryAfter) implements AddressProviderError {}
    record ProviderUnavailable(String providerCode) implements AddressProviderError {}
    record UnexpectedResponse(String detail) implements AddressProviderError {}
}
```

### 8.7 Lifecycle

External lifecycle mungkin berbeda dari internal lifecycle.

```text
External:
NEW -> PROC -> A -> X

Internal:
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> CLOSED
```

Jangan langsung mengubah internal state berdasarkan external status tanpa transition rule.

Lebih baik:

```java
public final class ExternalDecisionTranslator {

    public ExternalDecisionOutcome translate(VendorDecision decision) {
        // maps vendor lifecycle to internal event/outcome
        throw new UnsupportedOperationException("example");
    }
}
```

Lalu internal state machine memutuskan apakah transition valid.

```java
application.applyExternalDecision(outcome);
```

Domain tetap menjadi pemilik transition invariant.

---

## 9. Java 8–25 Perspective

### 9.1 Java 8: Functional Adapter

Java 8 memperkenalkan lambda dan functional interface, sehingga adapter kecil bisa menjadi function.

```java
Function<VendorAddress, Address> addressMapper = vendor -> new Address(
        new PostalCode(vendor.postalCode()),
        AddressLine.of(vendor.line1())
);
```

Ini berguna untuk mapping sederhana.

Namun jangan pakai lambda untuk translation kompleks yang butuh nama, test, observability, dan error semantics.

Buruk:

```java
Function<VendorResponse, Result> mapper = r ->
        r.code().equals("00")
                ? Result.ok(new Address(r.payload().postal()))
                : Result.failed(r.code());
```

Lebih baik:

```java
public final class VendorAddressTranslator {
    public AddressLookupResult translate(VendorResponse response) {
        // explicit, named, testable
    }
}
```

Rule praktis:

```text
Lambda cocok untuk mapping lokal kecil.
Class cocok untuk boundary translation yang punya business meaning.
```

### 9.2 Java 9 Modules: Boundary Bisa Ditegakkan

Dengan Java Platform Module System, kamu bisa menyembunyikan package implementation.

```java
module com.example.application {
    exports com.example.application.port;
    exports com.example.application.usecase;

    requires com.example.domain;
}

module com.example.integration.vendorgeo {
    requires com.example.application;
    requires com.example.domain;

    provides com.example.application.port.PostalCodeLookup
        with com.example.integration.vendorgeo.VendorPostalCodeLookupAdapter;
}
```

Internal package translator/vendor DTO tidak perlu diekspor.

```text
com.example.integration.vendorgeo.internal.dto
com.example.integration.vendorgeo.internal.http
com.example.integration.vendorgeo.internal.translator
```

Ini membantu mencegah external DTO dipakai sembarangan oleh modul lain.

### 9.3 Java 16+ Records: DTO Boundary yang Jelas

Records cocok untuk immutable data carrier.

External DTO:

```java
public record VendorAddressResponse(
        String code,
        String message,
        VendorAddressPayload payload
) {}

public record VendorAddressPayload(
        String postal,
        String block,
        String street,
        String building
) {}
```

Internal value:

```java
public record Address(
        PostalCode postalCode,
        AddressLine line1,
        Optional<AddressLine> line2
) {}
```

Jangan campur external record dan internal record.

Buruk:

```java
public record Address(String postal, String block, String street) {}
```

Jika dipakai untuk external response, internal domain, API response, dan persistence projection sekaligus, maka record menjadi universal DTO anti-pattern.

### 9.4 Java 17+ Sealed Types: Result Modeling

Sealed interface sangat berguna untuk boundary result.

```java
public sealed interface PaymentAuthorization
        permits PaymentAuthorization.Approved,
                PaymentAuthorization.Declined,
                PaymentAuthorization.Pending,
                PaymentAuthorization.Failed {

    record Approved(PaymentReference reference) implements PaymentAuthorization {}
    record Declined(String reason) implements PaymentAuthorization {}
    record Pending(PaymentReference reference) implements PaymentAuthorization {}
    record Failed(PaymentFailure failure) implements PaymentAuthorization {}
}
```

Dengan ini caller dipaksa memahami seluruh outcome.

### 9.5 Java 21+ Pattern Matching Switch

Dengan pattern matching switch, handling result menjadi lebih eksplisit.

```java
return switch (authorization) {
    case PaymentAuthorization.Approved approved ->
            RenewalPaymentStatus.paid(approved.reference());
    case PaymentAuthorization.Declined declined ->
            RenewalPaymentStatus.rejected(declined.reason());
    case PaymentAuthorization.Pending pending ->
            RenewalPaymentStatus.pending(pending.reference());
    case PaymentAuthorization.Failed failed ->
            throw new PaymentProviderException(failed.failure().toString());
};
```

Ini jauh lebih baik daripada `String status` yang dicek manual di banyak tempat.

### 9.6 Java 21 Virtual Threads dan Gateway

Virtual threads membuat blocking IO lebih scalable, tetapi tidak menghapus kebutuhan gateway boundary.

Salah kaprah:

```text
Karena virtual thread murah, gateway tidak perlu timeout/rate-limit/bulkhead.
```

Tetap perlu:

- timeout,
- retry policy,
- rate limit,
- idempotency,
- circuit breaker,
- observability,
- backpressure,
- provider quota protection.

Virtual thread membantu concurrency model, bukan semantic isolation.

### 9.7 Java 25 Scoped Values dan Context Propagation

Scoped values membantu membawa context seperti correlation ID atau security context dengan lebih aman daripada `ThreadLocal` pada concurrency modern.

Namun context tetap tidak boleh bocor menjadi hidden dependency di domain.

Baik:

```text
Gateway menggunakan scoped context untuk correlation ID saat logging/tracing.
```

Buruk:

```text
Domain object membaca scoped context langsung untuk menentukan authorization.
```

Boundary boleh memakai context teknis. Domain sebaiknya menerima explicit input.

---

## 10. Layering yang Disarankan

Salah satu struktur package yang sehat:

```text
com.example.application
  ├── domain
  │   ├── model
  │   ├── policy
  │   └── event
  ├── application
  │   ├── usecase
  │   └── port
  │       ├── PaymentGateway.java
  │       └── PostalCodeLookup.java
  └── integration
      ├── paymentprovider
      │   ├── PaymentProviderGateway.java
      │   ├── PaymentProviderTranslator.java
      │   ├── PaymentProviderErrorTranslator.java
      │   ├── dto
      │   │   ├── PaymentProviderRequest.java
      │   │   └── PaymentProviderResponse.java
      │   └── http
      │       └── PaymentProviderHttpClient.java
      └── geoprovider
          ├── GeoProviderPostalCodeLookupAdapter.java
          ├── GeoProviderTranslator.java
          └── dto
```

Dependency direction:

```text
Domain              -> no external dependency
Application Port    -> depends on domain types
Integration Adapter -> depends on application port + vendor SDK/HTTP client
```

Diagram:

```text
+---------------------------+
|         Domain            |
| Application, Policy, VO   |
+-------------^-------------+
              |
+-------------|-------------+
|      Application Layer    |
| Use Case + Port Interface |
+-------------^-------------+
              |
+-------------|-------------+
|     Integration Layer     |
| Adapter/Gateway/ACL       |
+-------------|-------------+
              v
+---------------------------+
| External System / Vendor  |
+---------------------------+
```

Port berada di application side, bukan integration side.

Buruk:

```java
// in domain service
private final VendorPaymentClient vendorPaymentClient;
```

Baik:

```java
// in application service
private final PaymentGateway paymentGateway;
```

Implementation gateway berada di infrastructure/integration.

---

## 11. Pattern Anatomy

### 11.1 Adapter Anatomy

```text
Context:
Internal code perlu memakai objek/API yang interface-nya tidak sesuai.

Problem:
Interface eksternal tidak cocok dengan interface yang diharapkan internal.

Forces:
- ingin reuse existing implementation
- ingin mengurangi coupling
- ingin testability
- ingin migration bertahap
- tidak ingin ubah external/legacy class

Solution:
Buat adapter yang mengimplementasikan interface internal dan mendelegasikan ke external object.

Consequences:
+ internal code bersih
+ external dependency terisolasi
+ test lebih mudah
- ada extra class
- mapping bisa menjadi kompleks
- adapter bisa menjadi pass-through jika tidak hati-hati
```

### 11.2 Facade Anatomy

```text
Context:
Client perlu memakai subsystem dengan banyak komponen dan sequence kompleks.

Problem:
Client menjadi tahu terlalu banyak detail subsystem.

Forces:
- ingin API sederhana
- ingin mengurangi dependency client
- ingin menjaga urutan operasi
- ingin menjaga invariant proses

Solution:
Buat facade yang menyediakan operasi coarse-grained dan menyembunyikan detail subsystem.

Consequences:
+ client lebih sederhana
+ subsystem detail tersembunyi
+ easier orchestration testing
- facade bisa menjadi god object
- bisa menyembunyikan complexity secara berlebihan
```

### 11.3 Gateway Anatomy

```text
Context:
Aplikasi perlu mengakses resource/sistem eksternal.

Problem:
Technical protocol, SDK, network failure, auth, timeout, dan error eksternal tidak boleh menyebar ke aplikasi.

Forces:
- external system unstable
- network failure unavoidable
- provider SDK changes
- need observability
- need retry/timeout/rate-limit

Solution:
Buat gateway interface internal dan implementation yang membungkus akses eksternal.

Consequences:
+ external access centralized
+ error semantics bisa dinormalisasi
+ testability naik
+ observability jelas
- gateway bisa terlalu generic
- gateway bisa menyembunyikan latency/failure jika tidak didesain eksplisit
```

### 11.4 ACL Anatomy

```text
Context:
Dua sistem punya model domain, lifecycle, dan bahasa yang berbeda.

Problem:
Model eksternal bisa mencemari domain internal.

Forces:
- external model berbeda
- legacy cannot change
- internal model must evolve independently
- semantic mismatch
- migration/modernization

Solution:
Buat layer isolasi yang menerjemahkan model eksternal ke model internal dan sebaliknya.

Consequences:
+ domain internal terlindungi
+ migration lebih aman
+ semantic mismatch eksplisit
+ vendor replacement lebih mudah
- lebih banyak code
- translation logic harus dirawat
- risiko duplication
- perlu contract test yang serius
```

---

## 12. Step-by-Step Implementation: Membuat ACL untuk External Address Provider

### 12.1 Requirement

Aplikasi internal butuh resolve alamat berdasarkan postal code.

Provider eksternal mengembalikan:

```json
{
  "code": "00",
  "message": "OK",
  "data": {
    "POSTAL": "123456",
    "BLK_NO": "10",
    "ROAD_NAME": "NORTH ROAD",
    "BUILDING": "ALPHA TOWER"
  }
}
```

Kemungkinan error:

```json
{"code":"01","message":"NOT_FOUND"}
{"code":"88","message":"RATE_LIMIT"}
{"code":"99","message":"SYSTEM_ERROR"}
```

Internal domain tidak boleh tahu code `00`, `01`, `88`, `99`.

### 12.2 Define Internal Port

```java
public interface AddressLookupPort {
    AddressLookupResult lookup(PostalCode postalCode);
}
```

### 12.3 Define Internal Domain Types

```java
public record PostalCode(String value) {
    public PostalCode {
        if (value == null || !value.matches("\\d{6}")) {
            throw new IllegalArgumentException("Postal code must be 6 digits");
        }
    }
}

public record AddressLine(String value) {
    public AddressLine {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Address line must not be blank");
        }
    }

    public static AddressLine of(String value) {
        return new AddressLine(value.trim());
    }
}

public record Address(
        PostalCode postalCode,
        AddressLine block,
        AddressLine roadName,
        Optional<AddressLine> building
) {
    public Address {
        Objects.requireNonNull(postalCode);
        Objects.requireNonNull(block);
        Objects.requireNonNull(roadName);
        building = building == null ? Optional.empty() : building;
    }
}
```

### 12.4 Define Result Type

```java
public sealed interface AddressLookupResult
        permits AddressLookupResult.Resolved,
                AddressLookupResult.NotFound,
                AddressLookupResult.RateLimited,
                AddressLookupResult.ProviderUnavailable,
                AddressLookupResult.InvalidProviderResponse {

    record Resolved(Address address) implements AddressLookupResult {}

    record NotFound(PostalCode postalCode) implements AddressLookupResult {}

    record RateLimited(Duration retryAfter) implements AddressLookupResult {}

    record ProviderUnavailable(String reason) implements AddressLookupResult {}

    record InvalidProviderResponse(String reason) implements AddressLookupResult {}
}
```

### 12.5 Define External DTO

```java
record VendorAddressResponse(
        String code,
        String message,
        VendorAddressData data
) {}

record VendorAddressData(
        String POSTAL,
        String BLK_NO,
        String ROAD_NAME,
        String BUILDING
) {}
```

External DTO sengaja berada di integration package, bukan domain/application package.

### 12.6 Translator

```java
public final class VendorAddressTranslator {

    public AddressLookupResult translate(PostalCode requestedPostalCode, VendorAddressResponse response) {
        if (response == null) {
            return new AddressLookupResult.InvalidProviderResponse("response is null");
        }

        return switch (response.code()) {
            case "00" -> translateSuccess(requestedPostalCode, response);
            case "01" -> new AddressLookupResult.NotFound(requestedPostalCode);
            case "88" -> new AddressLookupResult.RateLimited(Duration.ofMinutes(1));
            case "99" -> new AddressLookupResult.ProviderUnavailable("provider system error");
            default -> new AddressLookupResult.InvalidProviderResponse(
                    "unknown provider code: " + response.code()
            );
        };
    }

    private AddressLookupResult translateSuccess(
            PostalCode requestedPostalCode,
            VendorAddressResponse response
    ) {
        VendorAddressData data = response.data();
        if (data == null) {
            return new AddressLookupResult.InvalidProviderResponse("success response without data");
        }

        try {
            PostalCode returnedPostalCode = new PostalCode(data.POSTAL());

            if (!requestedPostalCode.equals(returnedPostalCode)) {
                return new AddressLookupResult.InvalidProviderResponse(
                        "provider returned different postal code"
                );
            }

            Address address = new Address(
                    returnedPostalCode,
                    AddressLine.of(data.BLK_NO()),
                    AddressLine.of(data.ROAD_NAME()),
                    optionalAddressLine(data.BUILDING())
            );

            return new AddressLookupResult.Resolved(address);
        } catch (IllegalArgumentException ex) {
            return new AddressLookupResult.InvalidProviderResponse(ex.getMessage());
        }
    }

    private Optional<AddressLine> optionalAddressLine(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        return Optional.of(AddressLine.of(value));
    }
}
```

Perhatikan translator melakukan lebih dari field mapping:

- memvalidasi response null,
- memetakan provider code,
- memastikan success punya data,
- memastikan postal code returned sama dengan request,
- mengubah blank building menjadi empty optional,
- mengubah invalid provider data menjadi explicit result.

### 12.7 Gateway / Adapter Implementation

```java
public final class VendorAddressLookupAdapter implements AddressLookupPort {

    private final VendorAddressHttpClient httpClient;
    private final VendorAddressTranslator translator;

    public VendorAddressLookupAdapter(
            VendorAddressHttpClient httpClient,
            VendorAddressTranslator translator
    ) {
        this.httpClient = httpClient;
        this.translator = translator;
    }

    @Override
    public AddressLookupResult lookup(PostalCode postalCode) {
        try {
            VendorAddressResponse response = httpClient.lookup(postalCode.value());
            return translator.translate(postalCode, response);
        } catch (SocketTimeoutException ex) {
            return new AddressLookupResult.ProviderUnavailable("timeout");
        } catch (IOException ex) {
            return new AddressLookupResult.ProviderUnavailable("io-error");
        }
    }
}
```

### 12.8 Application Service Uses Internal Result

```java
public final class ApplicantAddressService {

    private final AddressLookupPort addressLookup;

    public ApplicantAddressService(AddressLookupPort addressLookup) {
        this.addressLookup = addressLookup;
    }

    public Address resolveAddress(PostalCode postalCode) {
        AddressLookupResult result = addressLookup.lookup(postalCode);

        return switch (result) {
            case AddressLookupResult.Resolved resolved -> resolved.address();
            case AddressLookupResult.NotFound ignored ->
                    throw new AddressNotFoundException(postalCode);
            case AddressLookupResult.RateLimited rateLimited ->
                    throw new ExternalDependencyRateLimitedException(rateLimited.retryAfter());
            case AddressLookupResult.ProviderUnavailable unavailable ->
                    throw new ExternalDependencyUnavailableException(unavailable.reason());
            case AddressLookupResult.InvalidProviderResponse invalid ->
                    throw new ExternalDependencyContractException(invalid.reason());
        };
    }
}
```

Application service tidak tahu provider code.

---

## 13. Request Translation

Sering kali engineer hanya memikirkan response translation. Padahal request juga penting.

Internal command:

```java
public record SubmitPaymentCommand(
        ApplicationId applicationId,
        ApplicantId applicantId,
        Money amount,
        PaymentMethod method,
        IdempotencyKey idempotencyKey
) {}
```

Vendor request:

```java
record VendorPaymentRequest(
        String merchantRef,
        String payerRef,
        String amt,
        String ccy,
        String payMode,
        String idemKey
) {}
```

Translator:

```java
public final class VendorPaymentRequestTranslator {

    public VendorPaymentRequest translate(SubmitPaymentCommand command) {
        return new VendorPaymentRequest(
                command.applicationId().value().toString(),
                command.applicantId().value().toString(),
                command.amount().amount().toPlainString(),
                command.amount().currency().getCurrencyCode(),
                translatePaymentMethod(command.method()),
                command.idempotencyKey().value()
        );
    }

    private String translatePaymentMethod(PaymentMethod method) {
        return switch (method) {
            case CREDIT_CARD -> "CC";
            case PAYNOW -> "PN";
            case BANK_TRANSFER -> "BT";
        };
    }
}
```

Request translation harus menjaga:

- idempotency key,
- amount precision,
- currency,
- internal reference,
- external reference,
- mandatory field,
- default value,
- business meaning.

Jangan membuat request vendor langsung dari controller.

---

## 14. Response Translation

Response translation lebih dari `new InternalDto(response.field())`.

Checklist:

1. Apakah response success benar-benar success?
2. Apakah response memiliki partial success?
3. Apakah response punya warning?
4. Apakah response punya business rejection?
5. Apakah response punya technical failure?
6. Apakah data wajib ada?
7. Apakah data external valid menurut invariant internal?
8. Apakah external ID perlu disimpan?
9. Apakah external timestamp perlu dibandingkan?
10. Apakah unknown field harus diabaikan, disimpan, atau dianggap contract violation?

Contoh response result:

```java
public sealed interface PaymentResult {
    record Authorized(PaymentReference reference, Instant authorizedAt) implements PaymentResult {}
    record Declined(String reason) implements PaymentResult {}
    record Pending(PaymentReference reference) implements PaymentResult {}
    record Failed(PaymentFailure failure) implements PaymentResult {}
}
```

Translator:

```java
public final class VendorPaymentResponseTranslator {

    public PaymentResult translate(VendorPaymentResponse response) {
        if (response == null) {
            return new PaymentResult.Failed(PaymentFailure.invalidResponse("null response"));
        }

        return switch (response.status()) {
            case "AUTH" -> authorized(response);
            case "DECL" -> new PaymentResult.Declined(response.reason());
            case "PEND" -> new PaymentResult.Pending(new PaymentReference(response.reference()));
            case "ERR" -> new PaymentResult.Failed(PaymentFailure.providerError(response.errorCode()));
            default -> new PaymentResult.Failed(PaymentFailure.invalidResponse("unknown status"));
        };
    }

    private PaymentResult authorized(VendorPaymentResponse response) {
        if (response.reference() == null || response.reference().isBlank()) {
            return new PaymentResult.Failed(
                    PaymentFailure.invalidResponse("authorized without reference")
            );
        }

        return new PaymentResult.Authorized(
                new PaymentReference(response.reference()),
                parseProviderTime(response.authorizedAt())
        );
    }

    private Instant parseProviderTime(String value) {
        return Instant.parse(value);
    }
}
```

---

## 15. Error Translation

Error translation adalah inti boundary.

### 15.1 Jangan Bocorkan Vendor Exception

Buruk:

```java
public PaymentResult pay(PaymentRequest request) throws StripeException {
    return stripeClient.pay(request);
}
```

Atau:

```java
catch (Exception e) {
    throw new RuntimeException(e);
}
```

Lebih baik:

```java
catch (VendorTimeoutException ex) {
    throw new PaymentProviderTimeoutException(ex);
} catch (VendorAuthenticationException ex) {
    throw new PaymentProviderConfigurationException("authentication failed", ex);
} catch (VendorRateLimitException ex) {
    throw new PaymentProviderRateLimitedException(ex.retryAfter(), ex);
} catch (VendorRejectedException ex) {
    return PaymentResult.declined(ex.reason());
}
```

### 15.2 Error Taxonomy

Gunakan taxonomy yang caller bisa pahami.

```text
Domain rejection:
- payment declined
- address not found
- applicant not eligible

Technical external failure:
- timeout
- connection refused
- TLS failure
- malformed response
- provider unavailable

Contract failure:
- unknown status
- missing mandatory field
- incompatible version

Policy failure:
- rate limited
- quota exceeded
- forbidden by provider

Configuration failure:
- invalid credential
- missing endpoint
- expired certificate
```

Perbedaan ini penting karena action berbeda:

| Error | Retry? | Alert? | User action? | Audit? |
|---|---:|---:|---:|---:|
| Timeout | mungkin | jika sering | tidak langsung | yes |
| Rate limited | setelah delay | jika melewati threshold | tidak | yes |
| Invalid credential | tidak | yes | tidak | yes |
| Payment declined | tidak | no | yes | yes |
| Unknown status | tidak buta | yes | mungkin | yes |
| Address not found | tidak | no | yes | yes |

### 15.3 Result vs Exception

Gunakan exception untuk technical failure yang mengganggu eksekusi normal.

Gunakan result object untuk business outcome yang expected.

Contoh:

```java
PaymentResult.Declined
```

lebih baik daripada:

```java
throw new PaymentDeclinedException();
```

karena decline adalah hasil bisnis yang normal.

Namun:

```java
throw new PaymentProviderUnavailableException();
```

masuk akal jika provider down dan use case tidak bisa lanjut.

Rule praktis:

```text
Expected business alternative -> result type.
Unexpected technical failure   -> exception atau failure result eksplisit.
```

---

## 16. Version Compatibility

Boundary eksternal berubah.

Pertanyaan:

1. Bagaimana jika provider menambah field?
2. Bagaimana jika provider menghapus field?
3. Bagaimana jika enum bertambah?
4. Bagaimana jika status lama deprecated?
5. Bagaimana jika response punya versi berbeda?
6. Bagaimana jika provider mengubah error code?

### 16.1 Defensive Enum Translation

Jangan langsung pakai `Enum.valueOf` dari string eksternal.

Buruk:

```java
VendorStatus status = VendorStatus.valueOf(response.status());
```

Jika provider menambah status, aplikasi crash.

Lebih baik:

```java
public VendorStatus parseStatus(String raw) {
    return switch (raw) {
        case "A" -> VendorStatus.APPROVED;
        case "P" -> VendorStatus.PENDING;
        case "R" -> VendorStatus.REJECTED;
        default -> VendorStatus.UNKNOWN;
    };
}
```

Lalu translator memutuskan apakah `UNKNOWN` menjadi invalid response, pending manual review, atau ignored.

### 16.2 Contract Test

Untuk gateway/ACL, test penting bukan hanya unit test, tetapi contract test.

Unit test translator:

```java
@Test
void translatesSuccessResponseToResolvedAddress() {
    VendorAddressResponse response = new VendorAddressResponse(
            "00",
            "OK",
            new VendorAddressData("123456", "10", "NORTH ROAD", "ALPHA")
    );

    AddressLookupResult result = translator.translate(new PostalCode("123456"), response);

    assertThat(result).isInstanceOf(AddressLookupResult.Resolved.class);
}
```

Contract test:

```text
Given provider sandbox response for postal code 123456
When gateway calls lookup
Then response can be deserialized
And translator returns Resolved
And no unknown provider code appears
```

Snapshot/golden sample test:

```text
Store representative provider payloads.
Run translator against all samples.
Fail build if known payload no longer maps.
```

---

## 17. Anti-Pattern Catalog

### 17.1 Pass-Through Adapter

Terlihat seperti adapter, tetapi tidak menerjemahkan apa pun.

```java
public final class PaymentAdapter {
    private final VendorPaymentClient client;

    public VendorPaymentResponse pay(VendorPaymentRequest request) {
        return client.pay(request);
    }
}
```

Masalah:

- vendor request masih masuk dari caller,
- vendor response masih keluar ke caller,
- dependency hanya pindah satu class,
- tidak ada semantic protection.

Perbaikan:

```java
public interface PaymentGateway {
    PaymentAuthorization authorize(PaymentAuthorizationRequest request);
}
```

### 17.2 Leaky Facade

Facade yang masih mengekspos detail subsystem.

```java
public final class RenewalFacade {
    public FeeCalculator feeCalculator() { return feeCalculator; }
    public PaymentService paymentService() { return paymentService; }
    public DocumentRequirementService documentRequirementService() { return documentRequirementService; }
}
```

Ini bukan facade. Ini dependency bag.

Facade seharusnya:

```java
public RenewalSubmissionResult submitRenewal(SubmitRenewalCommand command) {
    // encapsulates sequence
}
```

### 17.3 External Model Infection

External DTO dipakai di domain/application.

```java
public final class Application {
    private VendorStatus vendorStatus;
    private VendorAddressResponse addressResponse;
}
```

Masalah:

- domain tergantung vendor,
- vendor migration mahal,
- istilah domain rusak,
- testing domain butuh vendor DTO,
- persistence bisa ikut tercemar.

Perbaikan:

```java
private ApplicationState state;
private ExternalApplicationReference externalReference;
```

Simpan external reference jika perlu, bukan external model.

### 17.4 Universal DTO

Satu DTO dipakai untuk:

- request API,
- response API,
- persistence projection,
- external provider payload,
- internal command,
- domain data.

Awalnya mengurangi class. Lama-lama menjadi coupling monster.

```java
public class ApplicationDto {
    public String id;
    public String status;
    public String externalStatus;
    public String applicantName;
    public String paymentCode;
    public String internalRemarks;
    public String auditReason;
}
```

Perbaikan:

```text
SubmitApplicationCommand
ApplicationSummaryView
ApplicationDetailResponse
ApplicationEntity
ExternalApplicationPayload
Application domain model
```

Bukan berarti harus membuat class tanpa batas. Tapi boundary yang berbeda sering membutuhkan model yang berbeda.

### 17.5 Stringly Typed Gateway

Gateway internal masih memakai string mentah.

```java
paymentGateway.pay("APPROVE", "SGD", "100.00", "CC");
```

Masalah:

- tidak type-safe,
- validasi tersebar,
- typo runtime,
- invariant lemah.

Perbaikan:

```java
paymentGateway.authorize(new PaymentAuthorizationRequest(
        applicationId,
        new Money(new BigDecimal("100.00"), Currency.getInstance("SGD")),
        PaymentMethod.CREDIT_CARD,
        idempotencyKey
));
```

### 17.6 Mapper with Business Logic Hidden Everywhere

Mapping logic tersebar di controller, service, repository, dan client.

```java
// controller
if (vendor.status().equals("A")) ...

// service
if (vendor.status().equals("APP")) ...

// scheduler
if (vendor.code().equals("00")) ...
```

Perbaikan:

- satu translator untuk satu boundary,
- mapping table eksplisit,
- test semua status,
- unknown status strategy.

### 17.7 ACL as Big Ball of Mud

ACL juga bisa gagal jika semua integrasi ditaruh dalam satu class.

```java
public final class ExternalSystemAcl {
    // 5000 lines
    // payment, address, identity, document, notification, status sync
}
```

Perbaikan:

```text
identity/
  IdentityGateway
  IdentityTranslator
payment/
  PaymentGateway
  PaymentRequestTranslator
  PaymentResponseTranslator
address/
  AddressLookupAdapter
  AddressTranslator
```

ACL harus modular.

### 17.8 Over-Abstracted Gateway

Terlalu generic sampai kehilangan makna.

```java
public interface ExternalGateway {
    Object call(String operation, Object request);
}
```

Masalah:

- tidak type-safe,
- caller tahu operation string,
- error tidak jelas,
- testing sulit,
- observability ambigu.

Lebih baik:

```java
public interface PaymentGateway {
    PaymentAuthorization authorize(PaymentAuthorizationRequest request);
    RefundResult refund(RefundRequest request);
}
```

### 17.9 Facade Hiding Transactional Chaos

Facade melakukan terlalu banyak hal dalam satu transaction:

```text
update database
call payment provider
call email provider
call document provider
publish event
update audit
```

Jika salah satu gagal, state ambigu.

Facade harus sadar transaction boundary. Integrasi eksternal sering tidak boleh dilakukan sembarangan di tengah database transaction.

Pattern lanjutan seperti Outbox, Saga, Idempotency akan dibahas di Part 25.

---

## 18. Trade-Off

### 18.1 Keuntungan

Adapter/Facade/Gateway/ACL memberi:

1. Domain model lebih bersih.
2. External dependency terisolasi.
3. Migration provider lebih mudah.
4. Testing lebih mudah.
5. Error semantics lebih eksplisit.
6. Observability external call terpusat.
7. Version compatibility lebih terkendali.
8. Security concern bisa ditempatkan di boundary.
9. Retry/timeout/rate-limit bisa dikendalikan.
10. Team bisa berdiskusi dengan bahasa yang jelas.

### 18.2 Biaya

Namun ada biaya:

1. Lebih banyak class.
2. Mapping code bertambah.
3. Ada risiko duplication.
4. Debugging butuh memahami layer.
5. Boundary bisa terlalu abstrak.
6. Translator perlu dirawat saat provider berubah.
7. Performance overhead kecil tapi ada.
8. Jika salah desain, facade/gateway menjadi tempat semua logic.

### 18.3 Kapan Worth It?

Worth it jika:

- external system penting,
- model eksternal berbeda,
- API tidak stabil,
- failure impact besar,
- domain internal perlu umur panjang,
- regulatory/audit consequence tinggi,
- replacement/migration mungkin terjadi,
- banyak caller memakai external system yang sama.

Mungkin tidak worth it jika:

- script kecil,
- throwaway integration,
- one-off admin tool,
- external API sangat sederhana,
- tidak ada domain translation,
- cost abstraction lebih besar dari risiko.

Top engineer tidak selalu membuat layer. Top engineer tahu kapan boundary harus tebal dan kapan cukup tipis.

---

## 19. Refactoring Path dari Code yang Bocor

### 19.1 Starting Point

```java
public final class ApplicationService {

    private final VendorClient vendorClient;

    public void submit(Application application) {
        VendorResponse response = vendorClient.check(application.getPostalCode());

        if (response.getCode().equals("00")) {
            application.setAddress(response.getData().getAddress());
        } else if (response.getCode().equals("01")) {
            throw new RuntimeException("Address not found");
        } else {
            throw new RuntimeException("Vendor error " + response.getCode());
        }
    }
}
```

Problems:

- service tahu vendor client,
- service tahu vendor code,
- address raw dari vendor masuk domain,
- error generic,
- test butuh vendor response,
- perubahan vendor menyentuh application service.

### 19.2 Step 1 — Introduce Port

```java
public interface AddressLookupPort {
    AddressLookupResult lookup(PostalCode postalCode);
}
```

### 19.3 Step 2 — Introduce Result Type

```java
public sealed interface AddressLookupResult {
    record Resolved(Address address) implements AddressLookupResult {}
    record NotFound() implements AddressLookupResult {}
    record Unavailable(String reason) implements AddressLookupResult {}
}
```

### 19.4 Step 3 — Move Vendor Mapping to Translator

```java
public final class VendorAddressTranslator {
    AddressLookupResult translate(VendorResponse response) {
        // move mapping here
    }
}
```

### 19.5 Step 4 — Implement Adapter/Gateway

```java
public final class VendorAddressLookupGateway implements AddressLookupPort {
    private final VendorClient vendorClient;
    private final VendorAddressTranslator translator;

    public AddressLookupResult lookup(PostalCode postalCode) {
        return translator.translate(vendorClient.check(postalCode.value()));
    }
}
```

### 19.6 Step 5 — Update Application Service

```java
public final class ApplicationService {

    private final AddressLookupPort addressLookup;

    public void submit(Application application) {
        AddressLookupResult result = addressLookup.lookup(application.postalCode());

        switch (result) {
            case AddressLookupResult.Resolved resolved -> application.assignAddress(resolved.address());
            case AddressLookupResult.NotFound ignored -> application.markAddressMissing();
            case AddressLookupResult.Unavailable unavailable ->
                    throw new ExternalDependencyUnavailableException(unavailable.reason());
            default -> throw new IllegalStateException("Unhandled result");
        }
    }
}
```

### 19.7 Step 6 — Add Tests

Tests:

1. Translator maps success.
2. Translator maps not found.
3. Translator maps unknown code.
4. Gateway handles timeout.
5. Application service reacts to internal result.
6. No application/domain package imports vendor DTO.

### 19.8 Step 7 — Enforce Boundary

Tools:

- ArchUnit tests,
- module boundaries,
- package-private DTO,
- naming convention,
- code review checklist.

Example ArchUnit-like rule:

```java
// pseudo example
noClasses()
    .that().resideInAPackage("..domain..")
    .should().dependOnClassesThat().resideInAPackage("..integration.vendor..");
```

---

## 20. Testing Strategy

### 20.1 Unit Test Translator Heavily

Translator adalah pure logic. Test harus banyak.

```java
class VendorAddressTranslatorTest {

    private final VendorAddressTranslator translator = new VendorAddressTranslator();

    @Test
    void mapsNotFoundCode() {
        VendorAddressResponse response = new VendorAddressResponse("01", "NOT_FOUND", null);

        AddressLookupResult result = translator.translate(new PostalCode("123456"), response);

        assertThat(result).isInstanceOf(AddressLookupResult.NotFound.class);
    }

    @Test
    void mapsUnknownCodeToInvalidResponse() {
        VendorAddressResponse response = new VendorAddressResponse("777", "WEIRD", null);

        AddressLookupResult result = translator.translate(new PostalCode("123456"), response);

        assertThat(result).isInstanceOf(AddressLookupResult.InvalidProviderResponse.class);
    }
}
```

### 20.2 Gateway Test dengan Fake Client

```java
@Test
void gatewayTranslatesHttpResponse() {
    VendorAddressHttpClient fakeClient = postal -> new VendorAddressResponse(
            "00",
            "OK",
            new VendorAddressData(postal, "10", "NORTH ROAD", "ALPHA")
    );

    AddressLookupPort gateway = new VendorAddressLookupAdapter(
            fakeClient,
            new VendorAddressTranslator()
    );

    AddressLookupResult result = gateway.lookup(new PostalCode("123456"));

    assertThat(result).isInstanceOf(AddressLookupResult.Resolved.class);
}
```

### 20.3 Application Service Test dengan Fake Port

```java
@Test
void applicationAssignsResolvedAddress() {
    Address address = new Address(
            new PostalCode("123456"),
            AddressLine.of("10"),
            AddressLine.of("NORTH ROAD"),
            Optional.empty()
    );

    AddressLookupPort fakePort = postal -> new AddressLookupResult.Resolved(address);

    ApplicationService service = new ApplicationService(fakePort);

    // assert domain behavior, not vendor behavior
}
```

### 20.4 Contract Test dengan Provider

Untuk provider nyata:

- sandbox test,
- sample payload test,
- schema compatibility test,
- deserialization test,
- status code coverage,
- timeout behavior test jika mungkin.

### 20.5 Boundary Architecture Test

Pastikan external DTO tidak dipakai di package internal.

```text
Rule:
- domain must not depend on integration
- application port must not expose vendor DTO
- controller must not construct vendor request
- repository must not store vendor response wholesale unless explicit raw audit storage
```

---

## 21. Observability and Debugging Angle

Boundary harus mudah didiagnosis.

### 21.1 Logging

Baik:

```text
event="external_call_completed"
system="address-provider"
operation="lookupPostalCode"
outcome="not_found"
latencyMs=142
correlationId="..."
providerCode="01"
postalCodeHash="..."
```

Buruk:

```text
Vendor response: {full JSON with PII/token}
```

### 21.2 Metrics

Gateway metric:

```text
external_call_total
external_call_duration
external_call_error_total
external_call_timeout_total
external_call_retry_total
external_call_rate_limited_total
external_response_unknown_code_total
```

Unknown code metric sangat penting. Itu tanda contract berubah.

### 21.3 Tracing

Trace span:

```text
ApplicationService.submit
  -> AddressLookupPort.lookup
      -> HTTP GET /provider/address
```

Span attributes:

```text
external.system=address-provider
external.operation=lookup
external.outcome=resolved
http.status_code=200
provider.code=00
```

Jangan masukkan PII sebagai high-cardinality tag.

### 21.4 Audit

Audit internal harus memakai bahasa internal.

Buruk:

```text
Vendor status A received.
```

Lebih baik:

```text
External address lookup resolved applicant postal code.
Provider returned success code.
```

Untuk audit teknis, boleh simpan provider code sebagai metadata terbatas:

```json
{
  "externalSystem": "address-provider",
  "operation": "lookupPostalCode",
  "providerCode": "00",
  "internalOutcome": "ADDRESS_RESOLVED"
}
```

---

## 22. Security Considerations

Boundary eksternal sering membawa security risk.

Gateway/ACL harus menangani:

1. Token management.
2. Credential isolation.
3. Request signing.
4. mTLS/certificate.
5. Secret rotation.
6. PII masking.
7. Least privilege.
8. Input validation.
9. Response validation.
10. SSRF prevention jika URL dinamis.
11. Audit trail.
12. Authorization context.

### 22.1 Jangan Biarkan Token Bocor

Buruk:

```java
public interface ExternalGateway {
    Response call(String token, Request request);
}
```

Internal caller tidak perlu tahu token.

Lebih baik:

```java
public final class VendorGateway implements SomePort {
    private final TokenProvider tokenProvider;

    public Result call(Command command) {
        String token = tokenProvider.currentToken();
        // use token internally
    }
}
```

### 22.2 Validate External Response

Jangan percaya provider 100%.

Validasi:

- mandatory field,
- enum value,
- amount non-negative,
- currency expected,
- returned ID matches request,
- signature valid jika ada,
- timestamp within tolerance,
- duplicate event detection.

### 22.3 Audit Boundary Decision

Jika ACL menerjemahkan external decision menjadi internal transition, audit harus mencatat:

- external input summary,
- translation outcome,
- internal decision,
- rule version jika ada,
- actor/system,
- correlation ID.

---

## 23. Performance Considerations

Adapter/facade/gateway biasanya overhead-nya kecil. Risiko performance lebih sering berasal dari:

- network call,
- serialization/deserialization,
- retry storm,
- large payload mapping,
- N+1 external call,
- lack of caching,
- blocking call tanpa timeout,
- unbounded concurrency.

### 23.1 Avoid N+1 External Calls

Buruk:

```java
for (Application app : applications) {
    Address address = addressLookup.lookup(app.postalCode());
}
```

Jika 1000 application, 1000 external calls.

Alternatif:

- batch API jika provider mendukung,
- caching,
- request coalescing,
- async fan-out with bounded concurrency,
- prefetch,
- domain redesign.

### 23.2 Bounded Concurrency

Gateway harus punya batas.

```text
Max concurrent calls to provider: 50
Timeout: 2 seconds
Retry: max 2 with backoff
Rate limit: 250/min
```

Virtual threads tidak mengganti batas provider.

### 23.3 Mapping Cost

Mapping object biasanya murah. Jangan menghindari boundary hanya karena takut object allocation, kecuali terbukti lewat profiling.

Trade-off:

```text
Sedikit allocation tambahan < domain tercemar dan migration mahal.
```

Namun untuk high-throughput path, perhatikan:

- streaming parser,
- avoiding huge intermediate model,
- object reuse secara hati-hati,
- binary payload handling,
- backpressure.

---

## 24. Design Review Checklist

Gunakan checklist ini saat review integration boundary.

### 24.1 Adapter Checklist

```text
[ ] Apakah adapter mengimplementasikan interface internal?
[ ] Apakah external class tidak bocor ke caller?
[ ] Apakah adapter melakukan translation yang meaningful?
[ ] Apakah dependency teknis terisolasi?
[ ] Apakah adapter testable tanpa external system?
[ ] Apakah adapter terlalu pass-through?
```

### 24.2 Facade Checklist

```text
[ ] Apakah facade menyederhanakan subsystem?
[ ] Apakah method facade level use case/capability?
[ ] Apakah client tidak perlu tahu urutan internal step?
[ ] Apakah facade menjaga invariant proses?
[ ] Apakah facade tidak menjadi god object?
[ ] Apakah facade tidak expose subsystem object?
```

### 24.3 Gateway Checklist

```text
[ ] Apakah gateway interface domain-oriented?
[ ] Apakah SDK/HTTP/messaging detail tidak bocor?
[ ] Apakah timeout eksplisit?
[ ] Apakah error diklasifikasi?
[ ] Apakah retry policy aman?
[ ] Apakah idempotency diperhatikan?
[ ] Apakah observability tersedia?
[ ] Apakah security/credential handling berada di boundary?
```

### 24.4 ACL Checklist

```text
[ ] Apakah external model berbeda secara semantik dari internal model?
[ ] Apakah translation mencakup status, lifecycle, error, ID, timestamp?
[ ] Apakah domain internal bebas dari vendor DTO?
[ ] Apakah unknown external value ditangani eksplisit?
[ ] Apakah contract test tersedia?
[ ] Apakah audit mencatat translation outcome?
[ ] Apakah ACL modular, bukan satu class besar?
[ ] Apakah replacement provider memungkinkan tanpa rewrite domain?
```

---

## 25. Decision Matrix

| Situasi | Pattern Utama | Catatan |
|---|---|---|
| Interface library tidak cocok | Adapter | Fokus compatibility |
| Client terlalu tahu subsystem | Facade | Fokus simplification |
| Akses HTTP/SOAP/SDK eksternal | Gateway | Fokus external access isolation |
| Legacy/external domain berbeda | ACL | Fokus semantic protection |
| External status memengaruhi internal lifecycle | ACL + State Machine | Jangan direct mapping ke state |
| External provider sederhana lookup | Gateway + small translator | ACL penuh mungkin overkill |
| Migration dari legacy ke new system | ACL + Strangler | Boundary sebagai migration shield |
| Banyak caller memakai vendor API | Gateway + Facade | Centralize external semantics |
| Third-party SDK sering berubah | Adapter/Gateway | Hide SDK dependency |
| Controller memanggil banyak subsystem | Facade/Application Service | Simpler use case API |

---

## 26. Common Interview / Staff-Level Discussion

### 26.1 “Apa bedanya Adapter dan Facade?”

Jawaban kuat:

```text
Adapter mengubah interface yang tidak cocok menjadi interface yang diharapkan client. Facade menyederhanakan akses ke subsystem yang kompleks. Adapter biasanya menyelesaikan incompatibility, sedangkan Facade menyelesaikan complexity exposure. Dalam praktik, Facade bisa memakai Adapter/Gateway di bawahnya.
```

### 26.2 “Apa bedanya Gateway dan ACL?”

Jawaban kuat:

```text
Gateway mengisolasi akses teknis ke sistem eksternal: protocol, SDK, timeout, auth, dan error teknis. ACL lebih dalam: ia melindungi domain internal dari model eksternal dengan menerjemahkan semantik, lifecycle, status, invariant, dan error. Gateway bisa menjadi bagian dari ACL.
```

### 26.3 “Kapan ACL overkill?”

Jawaban kuat:

```text
ACL overkill jika external API sederhana, stabil, tidak membawa semantic mismatch, dan hanya dipakai untuk lookup teknis. Namun minimal gateway tetap berguna untuk mengisolasi dependency teknis. ACL penuh menjadi worth it saat external model berbeda, legacy/vendor behavior kompleks, dan perubahan eksternal bisa mencemari domain internal.
```

### 26.4 “Kenapa tidak langsung pakai DTO vendor?”

Jawaban kuat:

```text
Karena DTO vendor membawa bahasa, lifecycle, null semantics, enum, error code, dan compatibility risk vendor. Jika masuk ke domain/application, vendor menjadi bagian dari model internal. Itu membuat migration mahal dan business rule tersebar. DTO vendor seharusnya berhenti di boundary dan diterjemahkan ke model internal.
```

### 26.5 “Bagaimana memastikan boundary tidak bocor?”

Jawaban kuat:

```text
Pisahkan package/module, letakkan port di application side, simpan vendor DTO di integration package, gunakan architecture tests, jangan expose vendor type dari interface internal, test translator, dan review import dependency. Secara desain, domain/application hanya boleh melihat internal model dan port.
```

---

## 27. Case Study Mini: Licensing Status Sync dari Legacy System

### 27.1 Kondisi Awal

Legacy licensing system punya status:

```text
N = new
A = active
S = suspended
T = terminated
E = expired
R = renewed
X = unknown/exception
```

Internal system punya state:

```text
DRAFT
SUBMITTED
ACTIVE
SUSPENDED
EXPIRED
CLOSED
PENDING_REVIEW
```

Naif:

```java
license.setStatus(legacy.status());
```

Ini salah karena external status bukan internal state.

### 27.2 ACL Translation

External event:

```java
record LegacyLicenseSnapshot(
        String legacyLicenseNo,
        String status,
        String effectiveDate,
        String expiryDate,
        List<String> flags
) {}
```

Internal outcome:

```java
public sealed interface LicenseSyncOutcome {
    record Activate(ExternalLicenseReference ref, LocalDate effectiveDate) implements LicenseSyncOutcome {}
    record Suspend(String reason) implements LicenseSyncOutcome {}
    record Expire(LocalDate expiredAt) implements LicenseSyncOutcome {}
    record Close(String reason) implements LicenseSyncOutcome {}
    record RequireManualReview(String reason) implements LicenseSyncOutcome {}
    record Ignore(String reason) implements LicenseSyncOutcome {}
}
```

Translator:

```java
public final class LegacyLicenseTranslator {

    public LicenseSyncOutcome translate(LegacyLicenseSnapshot snapshot) {
        if (snapshot == null) {
            return new LicenseSyncOutcome.RequireManualReview("missing legacy snapshot");
        }

        if (snapshot.flags().contains("DUP")) {
            return new LicenseSyncOutcome.RequireManualReview("legacy duplicate flag");
        }

        return switch (snapshot.status()) {
            case "A" -> new LicenseSyncOutcome.Activate(
                    new ExternalLicenseReference(snapshot.legacyLicenseNo()),
                    parseDate(snapshot.effectiveDate())
            );
            case "S" -> new LicenseSyncOutcome.Suspend("legacy suspended");
            case "E" -> new LicenseSyncOutcome.Expire(parseDate(snapshot.expiryDate()));
            case "T" -> new LicenseSyncOutcome.Close("legacy terminated");
            case "N", "R" -> new LicenseSyncOutcome.Ignore("legacy status not actionable");
            default -> new LicenseSyncOutcome.RequireManualReview(
                    "unknown legacy status: " + snapshot.status()
            );
        };
    }

    private LocalDate parseDate(String value) {
        return LocalDate.parse(value, DateTimeFormatter.BASIC_ISO_DATE);
    }
}
```

Domain applies outcome:

```java
public final class License {

    private LicenseState state;

    public void applySyncOutcome(LicenseSyncOutcome outcome) {
        switch (outcome) {
            case LicenseSyncOutcome.Activate activate -> activate(activate.effectiveDate());
            case LicenseSyncOutcome.Suspend suspend -> suspend(suspend.reason());
            case LicenseSyncOutcome.Expire expire -> expire(expire.expiredAt());
            case LicenseSyncOutcome.Close close -> close(close.reason());
            case LicenseSyncOutcome.RequireManualReview review -> markPendingReview(review.reason());
            case LicenseSyncOutcome.Ignore ignore -> recordNoOp(ignore.reason());
        }
    }
}
```

Key idea:

```text
ACL menerjemahkan legacy snapshot menjadi internal outcome.
Domain tetap pemilik state transition.
```

---

## 28. Relationship dengan Pattern Lain

Pattern di bagian ini sering dikombinasikan dengan pattern lain.

| Pattern | Kombinasi |
|---|---|
| Factory | Membuat gateway/adapter berdasarkan provider/config |
| Strategy | Memilih translator/policy berbeda per provider |
| Template Method | Standardize external call flow |
| Decorator | Tambahkan retry/logging/metrics di gateway |
| Proxy | Lazy/remote access wrapper |
| Command | Request ke gateway sebagai command object |
| Result | Model outcome eksternal |
| State Machine | Apply translated external lifecycle |
| Repository | Gateway mirip repository untuk external resource, tapi bukan persistence internal |
| Outbox/Inbox | Integrasi reliable event/message |
| Saga | Multi-step external coordination |

Contoh decorator gateway:

```java
public final class MeteredPaymentGateway implements PaymentGateway {

    private final PaymentGateway delegate;
    private final Metrics metrics;

    public PaymentAuthorization authorize(PaymentAuthorizationRequest request) {
        long start = System.nanoTime();
        try {
            PaymentAuthorization result = delegate.authorize(request);
            metrics.increment("payment.authorize.success");
            return result;
        } catch (RuntimeException ex) {
            metrics.increment("payment.authorize.failure");
            throw ex;
        } finally {
            metrics.recordDuration("payment.authorize.duration", System.nanoTime() - start);
        }
    }
}
```

---

## 29. Practical Naming Guide

Nama memengaruhi clarity.

### 29.1 Adapter Naming

```text
VendorPostalCodeLookupAdapter
LegacyPaymentAdapter
OldCaseSystemAdapter
SoapApplicantRegistryAdapter
```

### 29.2 Gateway Naming

```text
PaymentGateway
DocumentStorageGateway
NotificationGateway
IdentityProviderGateway
ExternalCaseRegistryGateway
```

### 29.3 Translator Naming

```text
VendorPaymentRequestTranslator
VendorPaymentResponseTranslator
LegacyLicenseStatusTranslator
ExternalAddressTranslator
ProviderErrorTranslator
```

### 29.4 Facade Naming

```text
RenewalApplicationFacade
CaseLifecycleFacade
ApplicationSubmissionFacade
DocumentGenerationFacade
```

Hindari nama terlalu generic:

```text
CommonAdapter
ExternalService
IntegrationUtil
DataMapper
Processor
Handler
Manager
```

Nama generic membuat responsibility kabur.

---

## 30. Summary

Adapter, Facade, Gateway, dan Anti-Corruption Layer adalah pattern struktural yang terlihat sederhana tetapi sangat menentukan kualitas jangka panjang sistem enterprise.

Inti pembelajaran:

1. **Adapter** menyelesaikan interface mismatch.
2. **Facade** menyederhanakan subsystem kompleks.
3. **Gateway** mengisolasi akses ke sistem eksternal.
4. **Anti-Corruption Layer** melindungi domain internal dari semantik eksternal.
5. Boundary bukan sekadar wrapper; boundary adalah zona translation.
6. Translation harus mencakup field, ID, status, error, lifecycle, timestamp, null semantics, dan invariant.
7. External DTO tidak boleh bocor ke domain/application.
8. Gateway harus punya error taxonomy, timeout, observability, dan security handling.
9. ACL harus modular dan testable, bukan big ball of mud baru.
10. Pattern ini punya biaya; gunakan sesuai risiko dan semantic mismatch.
11. Code boundary yang baik membuat sistem lebih mudah diganti, dites, diaudit, dan dipahami.

Mental model terpenting:

```text
Setiap external system membawa bahasanya sendiri.
Jika kita tidak menerjemahkannya secara eksplisit,
bahasa itu akan masuk diam-diam ke domain internal.
Saat itu terjadi, sistem kita tidak lagi punya model sendiri.
Ia hanya menjadi cermin rapuh dari sistem lain.
```

Engineer top-tier tidak hanya membuat API call berhasil. Mereka menjaga agar setiap boundary punya bahasa, kontrak, failure semantics, dan invariant yang jelas.

---

## 31. Referensi Lanjutan

1. Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides — *Design Patterns: Elements of Reusable Object-Oriented Software*.
2. Eric Evans — *Domain-Driven Design*, khususnya konsep Anti-Corruption Layer.
3. Martin Fowler — Legacy displacement patterns dan Anti-Corruption Layer discussion: https://martinfowler.com/articles/patterns-legacy-displacement/legacy-mimic.html
4. Microsoft Azure Architecture Center — Anti-Corruption Layer pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer
5. Microsoft Azure Architecture Center — Cloud Design Patterns: https://learn.microsoft.com/en-us/azure/architecture/patterns/
6. Gregor Hohpe, Bobby Woolf — *Enterprise Integration Patterns*.
7. Enterprise Integration Patterns — Messaging Gateway: https://www.enterpriseintegrationpatterns.com/patterns/messaging/MessagingGateway.html
8. Enterprise Integration Patterns — Channel Adapter: https://www.enterpriseintegrationpatterns.com/patterns/messaging/ChannelAdapter.html
9. Chris Richardson — Microservices.io Anti-Corruption Layer: https://microservices.io/patterns/refactoring/anti-corruption-layer.html
10. Martin Fowler — Patterns of Enterprise Application Architecture, khususnya Gateway, Mapper, dan Service Layer.

---

## 32. Status Seri

```text
Part 7 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
08-structural-decorator-proxy-interceptor-middleware-chain.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./06-singleton-multiton-registry-service-locator-global-state.md">⬅️ Part 6 — Singleton, Multiton, Registry, Service Locator: Global State Under Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./08-structural-decorator-proxy-interceptor-middleware-chain.md">Part 8 — Structural Pattern II: Decorator, Proxy, Interceptor, Middleware Chain ➡️</a>
</div>
