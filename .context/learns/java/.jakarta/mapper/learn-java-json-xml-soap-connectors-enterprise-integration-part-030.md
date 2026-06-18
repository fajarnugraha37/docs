# learn-java-json-xml-soap-connectors-enterprise-integration — Part 30
# Legacy SOAP Modernization Patterns

> Seri: **Java (Jakarta/Javax) JSON, XML, XML Binding, XML Web Services, SOAP Legacy, and Connectors**  
> Bagian: **30 dari 34**  
> Target: Java 8 sampai Java 25  
> Fokus: modernisasi sistem SOAP legacy tanpa merusak kontrak, tanpa big-bang rewrite, dan tanpa kehilangan reliability/auditability enterprise integration.

---

## 0. Tujuan Bagian Ini

Setelah bagian sebelumnya, kita sudah punya fondasi:

- XML sebagai data model, bukan sekadar text.
- XSD sebagai kontrak formal.
- JAXB/Jakarta XML Binding sebagai object binding.
- JAX-WS/Jakarta XML Web Services sebagai programming model SOAP.
- WSDL sebagai service contract.
- SOAP fault, attachment, MTOM, SAAJ, WS-* dan SOAP security.

Bagian ini menjawab pertanyaan lanjutan yang sangat sering terjadi di dunia enterprise:

> “Kita punya banyak integrasi SOAP legacy. Apakah harus dibuang, dibungkus, dimigrasi, diganti REST, atau dipertahankan?”

Jawaban top-level-nya:

> **Modernisasi SOAP bukan soal mengubah XML menjadi JSON. Modernisasi SOAP adalah proses mengurangi risiko kontrak, runtime, security, operasional, dan ownership secara bertahap sambil menjaga consumer tetap hidup.**

SOAP legacy sering masih hidup bukan karena engineer tidak tahu REST/JSON, tetapi karena:

- Ada kontrak formal yang sudah dipakai banyak pihak.
- Ada integrasi partner, agency, bank, insurance, government, atau vendor lama.
- Ada security requirement berbasis WS-Security, certificate, signature, encryption, timestamp.
- Ada auditability dan legal defensibility.
- Ada toolchain yang sudah menghasilkan client/server dari WSDL.
- Ada SLA, batch window, settlement, case lifecycle, atau compliance process yang mahal jika rusak.

Jadi goal bagian ini bukan membuat SOAP terlihat modern secara kosmetik. Goal-nya adalah membuat integrasi legacy menjadi:

- Lebih aman.
- Lebih observable.
- Lebih testable.
- Lebih mudah dimigrasi.
- Lebih kompatibel dengan Java 8–25.
- Lebih jelas boundary dan ownership-nya.
- Lebih rendah risiko saat berubah.

---

## 1. Mental Model: SOAP Legacy sebagai Contracted Distributed Boundary

Kesalahan pertama dalam modernisasi SOAP adalah menganggap SOAP endpoint sebagai “old API”. Itu terlalu dangkal.

SOAP endpoint biasanya adalah gabungan dari beberapa kontrak:

```text
SOAP Legacy Integration
├── Transport contract
│   ├── HTTP/S endpoint
│   ├── TLS/mTLS
│   ├── proxy/firewall/VPN
│   └── timeout/network behavior
│
├── Message contract
│   ├── SOAP envelope
│   ├── SOAP header
│   ├── SOAP body
│   ├── SOAP fault
│   └── SOAP version 1.1 / 1.2
│
├── Schema contract
│   ├── XSD elements
│   ├── complex types
│   ├── namespaces
│   ├── nillable/minOccurs/maxOccurs
│   └── extension/wildcard strategy
│
├── Service contract
│   ├── WSDL portType
│   ├── operation name
│   ├── input/output/fault message
│   ├── binding style/use
│   └── service/port address
│
├── Security contract
│   ├── TLS or mTLS
│   ├── WS-Security UsernameToken / BinarySecurityToken
│   ├── XML Signature
│   ├── XML Encryption
│   ├── timestamp / nonce
│   └── certificate trust chain
│
├── Operational contract
│   ├── SLA
│   ├── retry expectation
│   ├── idempotency
│   ├── correlation ID
│   ├── error code semantics
│   └── support/escalation procedure
│
└── Business contract
    ├── state transition
    ├── validation rule
    ├── legal/audit meaning
    ├── data retention
    └── cross-system reconciliation
```

Modernisasi yang hanya membuat REST facade di depan SOAP tetapi tidak memahami lapisan di atas biasanya gagal. Ia terlihat modern dari luar, tetapi masih rapuh di dalam.

---

## 2. Prinsip Utama Modernisasi SOAP

### 2.1 Jangan mulai dari teknologi target

Pertanyaan yang salah:

> “Haruskah SOAP ini kita ubah ke REST?”

Pertanyaan yang lebih benar:

> “Bagian mana dari kontrak ini yang perlu dipertahankan, bagian mana yang bisa distandardisasi, bagian mana yang bisa dipisahkan, dan bagian mana yang bisa diganti tanpa memutus consumer?”

REST/JSON, GraphQL, gRPC, event streaming, atau async messaging hanya pilihan setelah kita tahu karakter kontraknya.

### 2.2 Preserve behavior sebelum replace implementation

Legacy service mungkin punya behavior tersembunyi:

- Field opsional yang sebenarnya mandatory untuk beberapa partner.
- Error code yang dipakai consumer untuk branching logic.
- Response order yang dianggap meaningful.
- Namespace lama yang tidak boleh berubah.
- Empty element vs absent element punya arti berbeda.
- SOAP fault detail diparse oleh client.
- Timeout tertentu dianggap “pending” bukan “failed”.
- Duplicate request dianggap retry valid jika reference number sama.

Modernisasi yang tidak menangkap behavior ini akan menghasilkan regression walaupun unit test hijau.

### 2.3 Jangan jadikan facade sebagai tempat semua dosa

SOAP-to-REST facade sering berubah menjadi monster:

```text
REST Controller
  ├── Validasi aneh
  ├── Mapping XML
  ├── Business workaround
  ├── Retry logic
  ├── Credential injection
  ├── Error translation
  ├── Audit logging
  ├── Rate limit
  ├── Caching
  ├── Partner-specific branching
  └── Temporary fix permanen
```

Facade yang baik harus punya boundary jelas:

- Protocol translation.
- Contract normalization.
- Observability injection.
- Compatibility shielding.
- Limited orchestration bila memang perlu.

Facade yang buruk menjadi rewrite tersembunyi tanpa governance.

### 2.4 Migration harus incremental dan reversible

Legacy enterprise integration jarang aman untuk big-bang cutover. Gunakan pendekatan incremental replacement. Pola Strangler Fig dikenal sebagai pendekatan mengganti sistem lama secara bertahap dengan menaruh mekanisme routing/interception di sekitar sistem lama, sehingga value bisa dirilis bertahap dan risiko lebih rendah dibanding cut-over rewrite penuh.[^fowler-strangler]

Modernisasi yang baik punya karakter:

- Satu operation bisa dipindahkan dulu.
- Satu consumer bisa dipindahkan dulu.
- Satu use case bisa dipindahkan dulu.
- Satu partner bisa dipindahkan dulu.
- Rollback bisa dilakukan tanpa migrasi data besar.
- Observability membandingkan old vs new behavior.

---

## 3. Klasifikasi SOAP Legacy: Tidak Semua Legacy Sama

Sebelum memilih strategi, klasifikasikan dulu service-nya.

### 3.1 Berdasarkan ownership

| Tipe | Contoh | Strategi |
|---|---|---|
| Owned SOAP service | Service dibuat dan dikelola tim sendiri | Bisa refactor, facade, strangler, atau replace |
| Partner SOAP service | Service dimiliki external agency/vendor | Biasanya client-side wrapper/adapter, bukan replace |
| Shared enterprise SOAP service | Dipakai banyak sistem internal | Butuh governance, versioning, consumer inventory |
| Vendor product SOAP service | Bagian dari product/black box | Biasanya anti-corruption layer dan observability |
| Regulatory/mandated SOAP | Format diwajibkan oleh regulator/partner | Preserve contract; modernisasi internal saja |

### 3.2 Berdasarkan criticality

| Criticality | Ciri | Implikasi |
|---|---|---|
| Low | Read-only, non-critical, no legal impact | Bisa cepat difacade/rewrite |
| Medium | Data operational, bisa retry/manual repair | Perlu reconciliation dan audit |
| High | Payment, licensing, enforcement, eligibility, case decision | Hindari semantic drift, perlu dual-run/contract tests |
| Extreme | Legal submission, government-to-government, settlement | Preserve WSDL/schema; modernisasi internal sangat hati-hati |

### 3.3 Berdasarkan coupling kontrak

| Coupling | Ciri | Risiko |
|---|---|---|
| Loose | Consumer hanya peduli few fields | REST facade relatif aman |
| Medium | Consumer generate client dari WSDL | Perubahan WSDL bisa break compile/runtime |
| Tight | Consumer parse SOAP fault/detail/header | Error translation harus sangat hati-hati |
| Hidden | Consumer bergantung pada bug/quirk legacy | Perlu characterization tests |

### 3.4 Berdasarkan style SOAP

| Style | Modernization Difficulty | Catatan |
|---|---:|---|
| document-literal wrapped | Rendah–medium | Paling mudah difacade karena request/response mirip command DTO |
| document-literal bare | Medium | Perlu jaga element root dan message mapping |
| RPC/literal | Medium–tinggi | Legacy style; mapping ke REST bisa awkward |
| RPC/encoded | Tinggi | Hindari redesign langsung; sering butuh compatibility adapter |
| WS-Security heavy | Tinggi | Security context tidak boleh hilang saat difacade |
| Attachment/MTOM heavy | Tinggi | Binary streaming dan memory behavior harus diuji |

---

## 4. Modernization Option Matrix

Tidak ada satu strategi untuk semua SOAP legacy. Gunakan matrix berikut.

| Option | Apa yang dilakukan | Cocok untuk | Risiko utama |
|---|---|---|---|
| Stabilize in place | Tetap SOAP, perbaiki dependency, security, observability | Service masih valid dan consumer banyak | Technical debt tetap ada |
| Client wrapper | Buat Java client adapter yang aman | External SOAP tidak bisa diubah | Wrapper jadi tempat logic berlebihan |
| REST facade | Expose REST/JSON di depan SOAP | Consumer baru butuh API modern | Semantic loss XML/SOAP → JSON |
| SOAP facade | Expose WSDL stabil di depan service baru | Consumer lama tidak bisa berubah | Harus preserve WSDL behavior |
| Anti-corruption layer | Pisahkan model legacy dari domain modern | Domain internal ingin bersih | Mapping kompleks |
| Strangler migration | Pindahkan operation/use case bertahap | Legacy owned dan besar | Routing/versioning sulit |
| Parallel run | Old/new jalan bersamaan dan dibandingkan | High-risk migration | Cost dan complexity tinggi |
| Contract-first rewrite | Reimplement service dengan WSDL/XSD sama | Butuh replace runtime tanpa break consumer | Hidden behavior drift |
| Full retirement | Matikan SOAP setelah semua consumer pindah | Consumer inventory lengkap | Unknown consumer muncul belakangan |

---

## 5. Pattern 1 — Stabilize In Place

### 5.1 Inti pattern

Kadang modernisasi terbaik bukan langsung mengganti SOAP, tetapi menstabilkan yang ada.

```text
Before:
Consumer → Legacy SOAP Service

After:
Consumer → Legacy SOAP Service
                ├── explicit dependencies
                ├── patched runtime
                ├── hardened XML parser
                ├── better timeout/retry
                ├── structured audit logs
                ├── correlation ID
                └── contract tests
```

Ini cocok jika:

- Service masih actively used.
- Consumer terlalu banyak.
- Risiko perubahan kontrak tinggi.
- Tim belum punya inventory consumer.
- Masalah terbesar adalah runtime, bukan business model.

### 5.2 Java 8–25 concern

Legacy SOAP di Java 8 sering bergantung pada modul JDK seperti JAX-WS, JAXB, SAAJ. Sejak Java 11, modul Java EE/CORBA seperti `java.xml.ws`, `java.xml.bind`, `java.activation`, dan lainnya dihapus dari JDK, sehingga aplikasi harus membawa dependency sendiri.[^jep320]

Migration minimal:

```xml
<!-- javax-era example for legacy Java 8/11-compatible stack, depending on runtime choice -->
<dependency>
  <groupId>com.sun.xml.ws</groupId>
  <artifactId>jaxws-rt</artifactId>
  <version><!-- pin explicitly --></version>
</dependency>
```

Untuk Jakarta-era:

```xml
<dependency>
  <groupId>com.sun.xml.ws</groupId>
  <artifactId>jaxws-rt</artifactId>
  <version><!-- Jakarta-compatible version --></version>
</dependency>
```

Yang penting bukan artifact exact di contoh ini, tetapi prinsip:

- Jangan mengandalkan JDK menyediakan SOAP stack.
- Pin dependency.
- Pisahkan javax-era dan jakarta-era secara sadar.
- Uji generated code dan runtime di target Java version.
- Hindari campur `javax.xml.ws.*` dan `jakarta.xml.ws.*` di classpath yang sama tanpa strategi jelas.

### 5.3 Stabilization checklist

```text
[ ] Semua SOAP/JAXB/SAAJ dependency eksplisit.
[ ] WSDL/XSD disimpan sebagai versioned artifact.
[ ] Generated source reproducible dari build.
[ ] Timeout connect/read/request diset eksplisit.
[ ] TLS truststore/keystore dikelola eksplisit.
[ ] XML parser hardened terhadap XXE/entity expansion.
[ ] SOAP fault logging tidak membocorkan credential/PII.
[ ] Correlation ID muncul di request, response, fault, log, audit.
[ ] Contract tests memvalidasi sample request/response/fault.
[ ] Observability ada untuk latency, fault rate, timeout, payload size.
```

### 5.4 Kapan cukup stabilize?

Stabilize in place cukup jika:

- SOAP bukan bottleneck utama.
- Kontrak masih cocok dengan business process.
- Biaya migrasi lebih besar daripada risiko maintain.
- Consumer external tidak mungkin berubah.
- Security posture bisa diperbaiki tanpa ubah kontrak.

Jangan memodernisasi hanya karena “SOAP kelihatan lama”. Itu cosmetic modernization.

---

## 6. Pattern 2 — SOAP Client Wrapper / Gateway Client

### 6.1 Inti pattern

Jika SOAP service milik external party, biasanya kita tidak bisa mengganti server. Yang bisa kita kontrol adalah client boundary.

```text
Application Service
    ↓
Domain Port Interface
    ↓
SOAP Client Adapter
    ├── JAX-WS generated client
    ├── request mapper
    ├── response mapper
    ├── fault translator
    ├── timeout/retry policy
    ├── WS-Security handler
    └── observability
    ↓
External SOAP Service
```

### 6.2 Interface internal yang bersih

Jangan biarkan generated SOAP classes bocor ke domain service.

Buruk:

```java
public class CaseService {
    public SubmitCaseResponse submit(SubmitCaseRequest request) {
        // SubmitCaseRequest adalah generated SOAP class
    }
}
```

Lebih baik:

```java
public interface EligibilityGateway {
    EligibilityResult checkEligibility(EligibilityCommand command);
}
```

Adapter:

```java
public final class SoapEligibilityGateway implements EligibilityGateway {

    private final ExternalEligibilityPort port;
    private final EligibilitySoapMapper mapper;
    private final SoapFaultTranslator faultTranslator;

    @Override
    public EligibilityResult checkEligibility(EligibilityCommand command) {
        var soapRequest = mapper.toSoap(command);

        try {
            var soapResponse = port.checkEligibility(soapRequest);
            return mapper.toDomain(soapResponse);
        } catch (Exception ex) {
            throw faultTranslator.translate(ex, command.referenceNo());
        }
    }
}
```

### 6.3 Kenapa wrapper penting?

Wrapper memberi kita tempat untuk mengontrol:

- Timeout.
- Retry.
- Idempotency key.
- Correlation ID.
- Fault normalization.
- Credential injection.
- Payload redaction.
- Metrics.
- Circuit breaker.
- Generated code isolation.

Tanpa wrapper, SOAP dependency menyebar ke seluruh aplikasi.

```text
Bad coupling:
Controller → Service → Business Logic → Generated SOAP DTO
                                      → BindingProvider
                                      → SOAPFaultException
                                      → JAXB ObjectFactory
```

Dengan wrapper:

```text
Controller → Application Service → Domain Port → SOAP Adapter → Generated SOAP Client
```

### 6.4 Fault translation policy

Jangan translate semua SOAP fault menjadi `RuntimeException` generik.

Contoh taxonomy:

```java
public sealed interface ExternalEligibilityFailure
        permits ValidationFailure, PartnerUnavailable, SecurityFailure, UnknownPartnerFailure {
}

public record ValidationFailure(String code, String message) implements ExternalEligibilityFailure {}
public record PartnerUnavailable(String message) implements ExternalEligibilityFailure {}
public record SecurityFailure(String message) implements ExternalEligibilityFailure {}
public record UnknownPartnerFailure(String rawFaultCode, String message) implements ExternalEligibilityFailure {}
```

Mapping:

| SOAP failure | Internal meaning | Retry? |
|---|---|---|
| Client/validation fault | Bad request or business validation | No |
| Server fault | Partner failed processing | Maybe |
| Timeout before response | Unknown outcome | Careful; use idempotency/reconciliation |
| Security fault | Credential/certificate/policy failure | No automatic retry |
| HTTP 503/connection refused | Partner unavailable | Retry with backoff if idempotent |

---

## 7. Pattern 3 — REST/JSON Facade over SOAP

### 7.1 Inti pattern

REST facade expose interface modern untuk consumer baru, sementara backend tetap SOAP.

```text
New Consumer
   ↓ JSON/HTTP
REST Facade
   ├── JSON DTO
   ├── validation
   ├── mapping JSON → SOAP XML model
   ├── SOAP client wrapper
   ├── fault translation SOAP → HTTP problem
   └── observability/audit
   ↓ SOAP
Legacy SOAP Service
```

### 7.2 Kapan cocok?

REST facade cocok jika:

- Consumer baru tidak mau/ tidak bisa consume SOAP.
- Use case relatif command/query sederhana.
- SOAP operation document-literal wrapped.
- Tidak banyak WS-* semantics yang harus diekspos.
- Security bisa direpresentasikan di transport/application layer modern.
- Error semantics bisa diterjemahkan secara aman.

### 7.3 Kapan tidak cocok?

REST facade berbahaya jika:

- SOAP header mengandung business/security context penting.
- WS-Security signature harus end-to-end sampai backend.
- Consumer perlu SOAP fault detail original.
- Payload XML punya mixed content/wildcard/namespace semantics.
- MTOM attachment besar harus streaming end-to-end.
- REST facade menyembunyikan unknown outcome dari timeout.

### 7.4 Mapping SOAP operation ke REST resource

Jangan mapping mekanis seperti ini:

```text
POST /soap/checkEligibility
POST /soap/submitApplication
POST /soap/getCaseStatus
```

Itu hanya SOAP over REST naming.

Lebih baik cari business resource/action:

```text
POST /eligibility-checks
GET  /eligibility-checks/{referenceNo}
POST /applications
GET  /applications/{applicationId}/status
POST /applications/{applicationId}/submission
```

Tetapi hati-hati: tidak semua SOAP operation natural menjadi REST resource. Banyak SOAP operation adalah command.

| SOAP operation | REST candidate | Catatan |
|---|---|---|
| `CheckEligibility` | `POST /eligibility-checks` | Command menghasilkan result |
| `GetCaseStatus` | `GET /cases/{id}/status` | Query idempotent |
| `SubmitApplication` | `POST /applications` | Create command |
| `CancelApplication` | `POST /applications/{id}/cancellation` | Action resource lebih aman daripada fake DELETE |
| `UploadSupportingDocument` | `POST /applications/{id}/documents` | Perlu streaming dan content metadata |

### 7.5 SOAP fault ke HTTP error

Contoh mapping:

| SOAP fault | HTTP | Body |
|---|---:|---|
| Validation/business fault | 400/422 | problem detail dengan code stabil |
| Unauthorized/security fault | 401/403 | jangan bocorkan raw security detail |
| Not found business object | 404 | jika memang resource semantics |
| Duplicate submission | 409 | conflict dengan reference |
| Partner timeout | 504 | outcome unknown jika request mungkin sudah diproses |
| Partner unavailable | 503 | retry-after bila ada |
| Unexpected SOAP fault | 502 | upstream failure |

Contoh response JSON:

```json
{
  "type": "https://api.example.com/problems/partner-validation",
  "title": "Partner rejected the request",
  "status": 422,
  "code": "PARTNER_INVALID_IDENTIFIER",
  "message": "The identifier format is not accepted by the partner system.",
  "correlationId": "9f4cf8a8-2e33-4f52-a4c9-fb3e7df47d11"
}
```

Jangan expose raw SOAP fault lengkap ke public API:

```json
{
  "faultString": "javax.xml.bind.UnmarshalException...",
  "rawXml": "<soap:Envelope>..."
}
```

Itu leakage.

---

## 8. Pattern 4 — SOAP Facade over Modern Service

### 8.1 Inti pattern

Kadang sistem internal sudah modern, tetapi consumer eksternal masih butuh SOAP/WSDL lama. Maka kita mempertahankan SOAP contract di luar dan mengganti implementation di dalam.

```text
Legacy SOAP Consumer
   ↓ SOAP/WSDL lama
SOAP Compatibility Facade
   ├── WSDL lama tetap tersedia
   ├── JAXB model lama tetap valid
   ├── maps legacy XML → modern command
   ├── calls modern service/domain
   ├── maps result → legacy XML
   └── emits legacy-compatible SOAP fault
   ↓
Modern Internal Service
```

Ini kebalikan dari REST facade over SOAP.

### 8.2 Kapan cocok?

- Consumer eksternal tidak bisa berubah.
- Kita ingin mengganti backend implementation.
- WSDL lama sudah menjadi public contract.
- Kita butuh migrasi internal tanpa memaksa partner regenerate client.

### 8.3 Prinsip paling penting

> **WSDL compatibility lebih penting daripada internal elegance.**

Jika consumer lama menggunakan generated client dari WSDL lama, perubahan kecil bisa break:

- namespace berubah,
- element order berubah,
- wrapper element berubah,
- optional field berubah mandatory,
- SOAPAction berubah,
- fault message berubah,
- endpoint policy berubah,
- certificate/signature policy berubah.

Jakarta XML Web Services tetap mendefinisikan cara implementasi XML-based web services berbasis SOAP with Attachments dan Web Services Metadata.[^jakarta-xml-ws] Tetapi dalam modernization, annotation code-first sebaiknya tidak dibiarkan menghasilkan kontrak baru tanpa review. Untuk SOAP compatibility facade, gunakan contract-first WSDL/XSD lama.

### 8.4 Golden rule

```text
Do not regenerate public WSDL accidentally.
```

Simpan WSDL lama sebagai artifact dan jadikan test input.

```text
src/main/resources/wsdl/legacy-case-service-v1.wsdl
src/main/resources/xsd/case-common-v1.xsd
src/test/resources/golden/submit-case-request.xml
src/test/resources/golden/submit-case-response.xml
src/test/resources/golden/validation-fault.xml
```

---

## 9. Pattern 5 — Anti-Corruption Layer

### 9.1 Inti pattern

Anti-corruption layer mencegah model legacy menginfeksi domain modern.

```text
Legacy SOAP Model              Modern Domain Model
-----------------              -------------------
ApplicantType        ───────→   Applicant
EligibilityCode      ───────→   EligibilityDecision
LegacyStatus         ───────→   CaseState
FaultCode            ───────→   DomainFailure
XML date string      ───────→   OffsetDateTime / LocalDate
Y/N flag             ───────→   boolean / enum
```

### 9.2 Kenapa penting?

SOAP legacy sering punya model yang berasal dari:

- mainframe field naming,
- vendor schema,
- government form,
- old DB column,
- batch file format,
- historical policy rule.

Jika model ini masuk ke domain modern, maka domain menjadi sulit berkembang.

Buruk:

```java
public class CaseAggregate {
    private String legacyTxnCd;
    private String wsStatus;
    private XMLGregorianCalendar submitDt;
    private JAXBElement<String> agencyCode;
}
```

Lebih baik:

```java
public final class CaseAggregate {
    private CaseId id;
    private CaseState state;
    private SubmissionTimestamp submittedAt;
    private AgencyCode agencyCode;
}
```

Mapper menjadi boundary eksplisit:

```java
public final class LegacyCaseMapper {

    public SubmitCaseCommand toCommand(SubmitCaseRequest soap) {
        return new SubmitCaseCommand(
                new ApplicantId(required(soap.getApplicantId(), "applicantId")),
                mapApplicationType(soap.getApplicationType()),
                mapDocuments(soap.getSupportingDocuments())
        );
    }

    public SubmitCaseResponse toSoap(SubmitCaseResult result) {
        var response = new SubmitCaseResponse();
        response.setReferenceNo(result.referenceNo().value());
        response.setStatus(mapStatus(result.state()));
        return response;
    }
}
```

### 9.3 Mapping bukan pekerjaan trivial

Mapping harus menyelesaikan semantic mismatch:

| Legacy SOAP | Modern domain | Catatan |
|---|---|---|
| `null`, absent, empty string | distinct domain states | Jangan collapse sembarangan |
| `Y/N/U` | boolean? enum? | Biasanya enum lebih aman |
| free text code | value object | Validate/normalize |
| local date string | `LocalDate` | Perhatikan timezone tidak boleh dipalsukan |
| `XMLGregorianCalendar` | `OffsetDateTime` | Preserve offset bila ada |
| numeric ID as string | String value object | Jangan parse ke long jika leading zero penting |
| fault code | domain failure | Jaga retry semantics |

### 9.4 Anti-corruption test

Mapper harus punya test sendiri:

```java
class LegacyCaseMapperTest {

    @Test
    void mapsAbsentOptionalMiddleNameAsUnknownNotEmptyString() {
        var soap = new SubmitCaseRequest();
        soap.setApplicantId("A123");
        soap.setMiddleName(null);

        var command = mapper.toCommand(soap);

        assertThat(command.middleName()).isEqualTo(Optional.empty());
    }
}
```

Test ini kelihatan kecil, tetapi mencegah semantic drift.

---

## 10. Pattern 6 — Strangler Migration by Operation

### 10.1 Inti pattern

Pindahkan operation satu per satu, bukan seluruh service sekaligus.

```text
              ┌───────────────────────┐
Consumer ───→ │ SOAP Routing Facade    │
              ├───────────────────────┤
              │ SubmitCase ───────────────→ New Submit Service
              │ GetStatus  ───────────────→ Legacy SOAP Service
              │ CancelCase ───────────────→ Legacy SOAP Service
              │ UploadDoc  ───────────────→ Legacy SOAP Service
              └───────────────────────┘
```

### 10.2 Kapan cocok?

- WSDL punya banyak operation.
- Tidak semua operation sama kritikal.
- Ada operation yang mudah dimodernisasi dulu.
- Consumer contract harus tetap sama.
- Backend legacy bisa hidup paralel dengan backend baru.

### 10.3 Urutan operation yang ideal

Mulai dari operation dengan risiko rendah:

1. Read-only query.
2. Operation idempotent.
3. Operation tanpa attachment.
4. Operation tanpa complex WS-Security special case.
5. Operation dengan consumer sedikit.
6. Operation yang punya test data lengkap.
7. Operation yang tidak mengubah state cross-system.

Jangan mulai dari:

- payment/settlement,
- legal submission,
- irreversible state transition,
- operation dengan attachment besar,
- operation yang punya banyak hidden consumer,
- operation dengan unclear retry behavior.

### 10.4 Routing design

Routing bisa berdasarkan:

- operation name,
- SOAPAction,
- request namespace,
- tenant/agency,
- consumer identity,
- feature flag,
- percentage rollout,
- reference number pattern,
- environment.

Contoh conceptual routing:

```java
public final class SoapOperationRouter {

    public RoutingTarget route(SOAPMessage message, ConsumerIdentity consumer) {
        var operation = SoapOperationExtractor.extract(message);

        if (operation.equals("SubmitCase") && featureFlags.isEnabled("new-submit-case", consumer)) {
            return RoutingTarget.NEW_SUBMIT_CASE;
        }

        return RoutingTarget.LEGACY_SOAP;
    }
}
```

### 10.5 Bahaya routing

Routing facade bukan hanya proxy. Ia harus menjaga:

- request body tidak rusak,
- SOAP header dipreserve,
- WS-Security tidak invalid karena message dimodifikasi,
- attachment tidak di-buffer ke memory,
- correlation ID tetap ada,
- timeout dan response code konsisten,
- fault shape sesuai WSDL.

Jika WS-Security signature mencakup body/header, memodifikasi message dapat mematahkan signature. Dalam kasus itu routing harus terjadi sebelum signature verification/creation atau menggunakan terminasi security yang sah secara arsitektur.

---

## 11. Pattern 7 — Strangler Migration by Consumer

### 11.1 Inti pattern

Alihkan consumer satu per satu.

```text
Consumer A ──→ New REST API
Consumer B ──→ Legacy SOAP
Consumer C ──→ Legacy SOAP
Consumer D ──→ New REST API
```

Ini cocok ketika consumer bisa diubah secara bertahap.

### 11.2 Consumer inventory

Sebelum consumer migration, buat inventory:

| Consumer | Owner | Endpoint used | Operation | Auth method | SLA | Contact | Last seen |
|---|---|---|---|---|---|---|---|
| Portal A | Team A | `/CaseService` | Submit/GetStatus | mTLS | High | ... | 2026-06-10 |
| Batch B | Vendor B | `/CaseService` | UploadDoc | WS-Sec cert | Medium | ... | 2026-05-30 |
| Agency C | External | `/CaseService` | All | VPN + cert | High | ... | 2026-06-16 |

Tanpa inventory, retirement berbahaya.

### 11.3 Compatibility period

Consumer migration biasanya butuh periode coexistence:

```text
Phase 1: SOAP only
Phase 2: SOAP + REST facade available
Phase 3: selected consumers migrate to REST
Phase 4: SOAP read-only or limited mode
Phase 5: SOAP retired for migrated consumers
Phase 6: SOAP fully retired if no active consumer
```

### 11.4 Jangan percaya “tidak ada yang pakai” tanpa telemetry

Sistem legacy sering punya unknown consumer:

- batch bulanan,
- job tahunan,
- DR test,
- vendor support script,
- old environment,
- agency integration yang jarang aktif,
- manual back-office tool.

Gunakan access logs, mTLS certificate identity, API gateway logs, SOAPAction metrics, dan business reference number untuk membuktikan usage.

---

## 12. Pattern 8 — Parallel Run and Shadow Comparison

### 12.1 Inti pattern

Old dan new dijalankan paralel untuk membandingkan behavior sebelum cutover.

```text
             ┌──────────────→ Legacy SOAP Service → legacy response
Request ───→ │
             └──────────────→ New Service         → shadow response

Compare:
- status
- business code
- normalized payload
- error behavior
- latency
- side effect? usually disabled in shadow
```

### 12.2 Cocok untuk

- High-risk reimplementation.
- Banyak hidden behavior.
- Contract-first rewrite.
- Operation read-only.
- Operation state-changing tetapi bisa dijalankan mode dry-run.

### 12.3 Tantangan state-changing operation

Untuk command yang mengubah state, shadow run berbahaya jika new system ikut melakukan side effect.

Solusi:

- dry-run endpoint,
- sandbox backend,
- mock downstream,
- deterministic simulation,
- compare pre-validation result saja,
- compare mapping result tanpa commit,
- use captured production traffic replay di environment terisolasi.

### 12.4 Normalized comparison

Jangan compare raw XML string.

Buruk:

```text
legacyXml.equals(newXml)
```

Karena XML bisa berbeda secara text tetapi sama secara meaning:

- whitespace,
- attribute order,
- namespace prefix,
- formatting,
- generated timestamp,
- correlation ID.

Lebih baik:

```text
Normalize → canonical domain assertion → compare relevant fields
```

Contoh comparison model:

```java
public record SubmitCaseComparableResult(
        String outcomeCode,
        String referenceNo,
        String normalizedStatus,
        List<String> validationCodes
) {}
```

### 12.5 Mismatch taxonomy

| Mismatch | Severity | Action |
|---|---:|---|
| formatting only | Low | ignore/canonicalize |
| namespace prefix only | Low | ignore if namespace URI same |
| optional field absent vs empty | Medium/high | clarify semantics |
| business code different | High | investigate |
| old accepts, new rejects | High | compatibility gap |
| old rejects, new accepts | High | potential validation regression |
| timeout behavior different | High | resilience policy mismatch |

---

## 13. Pattern 9 — Contract-First Rewrite with Same WSDL

### 13.1 Inti pattern

Reimplement SOAP service dengan mempertahankan WSDL/XSD public contract.

```text
Consumer → Same WSDL/SOAP Contract → New Implementation
```

Ini berbeda dari code-first rewrite.

### 13.2 Kenapa same WSDL penting?

WSDL 1.1 mendefinisikan service secara abstrak dan konkret melalui `types`, `message`, `portType`, `binding`, dan `service`.[^wsdl11] Consumer yang generate client akan bergantung pada shape tersebut.

Jika WSDL berubah, efeknya bisa:

- generated class berubah,
- method signature berubah,
- namespace mismatch,
- SOAPAction mismatch,
- fault mapping berubah,
- deployment descriptor/policy berubah,
- partner test certification harus ulang.

### 13.3 Contract-first build

Ideal structure:

```text
contract/
  case-service-v1.wsdl
  xsd/
    case-common-v1.xsd
    case-submission-v1.xsd

server/
  generated-sources/wsdl
  src/main/java/.../endpoint
  src/main/java/.../mapper
  src/test/resources/golden
```

Build principle:

```text
WSDL/XSD → generated Java model/SEI → implementation class → tests
```

Bukan:

```text
Java class → generated WSDL → hope consumer still works
```

### 13.4 Compatibility gates

CI harus punya gate:

```text
[ ] Generated code reproducible.
[ ] Public WSDL byte/content difference reviewed.
[ ] XSD namespace unchanged unless versioned.
[ ] Golden request unmarshal succeeds.
[ ] Golden response validates against schema.
[ ] Golden fault validates against schema.
[ ] Consumer sample client can call new endpoint.
[ ] SOAPAction and binding version verified.
[ ] WS-Security policy still accepted.
```

---

## 14. Pattern 10 — SOAP-to-Event Bridge

### 14.1 Inti pattern

Beberapa SOAP operation sebenarnya command yang lebih cocok menjadi event-driven flow.

```text
SOAP Consumer
   ↓ SubmitApplication SOAP
SOAP Compatibility Endpoint
   ↓ validate + persist command
Outbox Table
   ↓
Event Broker
   ↓
Modern Processing Services
```

### 14.2 Kapan cocok?

- Operation menerima submission lalu processing lama.
- Consumer tidak butuh immediate final result.
- Ada batch/back-office workflow.
- Ada retry/reconciliation.
- Legacy synchronous call sering timeout.

### 14.3 Response design

SOAP response tetap harus legacy-compatible.

```xml
<SubmitApplicationResponse>
    <ReferenceNo>APP-2026-00001</ReferenceNo>
    <Status>RECEIVED</Status>
</SubmitApplicationResponse>
```

Lalu processing lanjut async.

### 14.4 Risiko

SOAP consumer mungkin menganggap response berarti “completed”, bukan “received”. Jika legacy semantics memang synchronous completed, mengubah menjadi async adalah breaking semantic change walaupun XML response valid.

Karena itu harus bedakan:

| Response meaning | Aman async? |
|---|---:|
| accepted/received | Ya |
| completed/final decision | Tidak tanpa contract change |
| validation result only | Mungkin |
| external side effect completed | Tidak sembarangan |

---

## 15. Pattern 11 — Canonical Internal API, Legacy External Contract

### 15.1 Inti pattern

Gunakan internal canonical API/model, tetapi jangan paksa semua external contract mengikuti canonical model.

```text
External SOAP V1 ─┐
External REST V2 ─┼──→ Contract Adapter → Internal Canonical Command → Domain
Batch File V1  ───┘
```

### 15.2 Canonical model anti-pattern

Canonical model buruk jika dipakai sebagai “one schema to rule them all” untuk semua partner.

Gejala buruk:

- Semua field dari semua partner masuk satu DTO raksasa.
- Banyak field optional tanpa owner.
- Nama field terlalu generic.
- Domain rule tercampur transport concern.
- Versioning impossible karena semua consumer share satu model.

### 15.3 Canonical model yang sehat

Internal canonical model harus:

- Berbasis domain semantics.
- Tidak expose SOAP-specific types.
- Tidak expose REST-specific representation.
- Tidak memaksa external schema berubah.
- Punya mapper per contract.

```text
SOAP V1 DTO → Mapper V1 → Internal Command
REST V2 DTO → Mapper V2 → Internal Command
Batch V1    → Mapper B1 → Internal Command
```

---

## 16. Design: SOAP Modernization Reference Architecture

### 16.1 Layered architecture

```text
┌───────────────────────────────────────────────────────────────┐
│ External Consumers                                             │
│ SOAP legacy clients | REST clients | batch clients             │
└───────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────┐
│ Edge / Gateway Layer                                           │
│ TLS/mTLS | routing | rate limit | basic authn/authz | logging   │
└───────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────┐
│ Compatibility Contract Layer                                   │
│ SOAP endpoint | REST facade | WSDL/XSD | OpenAPI | versioning   │
└───────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────┐
│ Anti-Corruption / Mapping Layer                                │
│ XML/JSON DTO ↔ internal command/result | fault/error mapping    │
└───────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────┐
│ Application Use Case Layer                                     │
│ orchestration | idempotency | transaction boundary | audit      │
└───────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────┐
│ Domain / Integration Layer                                     │
│ domain rules | persistence | events | downstream adapters       │
└───────────────────────────────────────────────────────────────┘
```

### 16.2 Boundary ownership

| Layer | Owns | Should not own |
|---|---|---|
| Gateway | network/security/routing | business mapping |
| SOAP endpoint | WSDL compatibility | domain logic |
| Mapper/ACL | representation translation | persistence transaction |
| Application service | use case orchestration | XML/SOAP classes |
| Domain | business invariant | SOAP fault code |
| Adapter | external call mechanics | domain state machine |

---

## 17. Java Implementation Skeleton: REST Facade over SOAP

### 17.1 Internal port

```java
public interface CaseSubmissionGateway {
    SubmissionResult submit(SubmissionCommand command);
}
```

### 17.2 REST controller

```java
@RestController
@RequestMapping("/applications")
public class ApplicationController {

    private final CaseSubmissionGateway gateway;
    private final RestDtoMapper mapper;

    @PostMapping
    public ResponseEntity<ApplicationResponseDto> submit(
            @RequestBody ApplicationRequestDto request,
            @RequestHeader("X-Correlation-Id") Optional<String> correlationId
    ) {
        var command = mapper.toCommand(request, correlationId.orElseGet(UUID::randomUUID));
        var result = gateway.submit(command);
        return ResponseEntity.accepted().body(mapper.toResponse(result));
    }
}
```

### 17.3 SOAP adapter

```java
public final class SoapCaseSubmissionGateway implements CaseSubmissionGateway {

    private final LegacyCasePort port;
    private final LegacyCaseSoapMapper mapper;
    private final LegacySoapFaultTranslator faultTranslator;

    @Override
    public SubmissionResult submit(SubmissionCommand command) {
        var request = mapper.toSoap(command);

        try {
            configureRequestContext(port, command);
            var response = port.submitCase(request);
            return mapper.toDomain(response);
        } catch (Exception ex) {
            throw faultTranslator.translate(ex, command.correlationId(), command.referenceNo());
        }
    }

    private void configureRequestContext(LegacyCasePort port, SubmissionCommand command) {
        var context = ((BindingProvider) port).getRequestContext();
        context.put(BindingProvider.ENDPOINT_ADDRESS_PROPERTY, resolveEndpoint());
        context.put("com.sun.xml.ws.connect.timeout", 5_000);
        context.put("com.sun.xml.ws.request.timeout", 30_000);
        context.put("X-Correlation-Id", command.correlationId());
    }
}
```

Catatan:

- Timeout property bisa berbeda antar implementation. Jangan hardcode tanpa test runtime.
- Endpoint override harus dikontrol konfigurasi environment.
- Jangan taruh credential di log.
- Jangan expose generated SOAP classes ke REST DTO/domain.

---

## 18. Java Implementation Skeleton: SOAP Compatibility Facade over Modern Service

### 18.1 SEI contract-first

Generated dari WSDL:

```java
@WebService(targetNamespace = "http://legacy.example.com/case/v1")
public interface CaseServicePort {
    SubmitCaseResponse submitCase(SubmitCaseRequest request) throws SubmitCaseFault;
}
```

### 18.2 Endpoint implementation

```java
@WebService(
        serviceName = "CaseService",
        portName = "CaseServicePort",
        targetNamespace = "http://legacy.example.com/case/v1",
        endpointInterface = "com.example.legacy.casev1.CaseServicePort"
)
public class CaseServiceEndpoint implements CaseServicePort {

    private final SubmitCaseUseCase useCase;
    private final LegacyCaseMapper mapper;
    private final LegacyFaultMapper faultMapper;

    @Override
    public SubmitCaseResponse submitCase(SubmitCaseRequest request) throws SubmitCaseFault {
        try {
            var command = mapper.toCommand(request);
            var result = useCase.submit(command);
            return mapper.toSoap(result);
        } catch (DomainValidationException ex) {
            throw faultMapper.toSubmitCaseFault(ex);
        } catch (Exception ex) {
            throw faultMapper.toTechnicalFault(ex);
        }
    }
}
```

### 18.3 Design rule

Endpoint class should be thin.

```text
Endpoint responsibilities:
[+] accept SOAP request
[+] map to command
[+] call use case
[+] map response/fault
[+] attach correlation/audit context
[-] no business rule implementation
[-] no database access directly
[-] no generated class leakage into domain
```

---

## 19. Testing Strategy for SOAP Modernization

### 19.1 Test pyramid khusus SOAP modernization

```text
                   ┌────────────────────────────┐
                   │ Partner / Certification    │
                   └────────────────────────────┘
                 ┌────────────────────────────────┐
                 │ End-to-end environment tests   │
                 └────────────────────────────────┘
              ┌──────────────────────────────────────┐
              │ Contract tests WSDL/XSD/SOAP samples │
              └──────────────────────────────────────┘
           ┌────────────────────────────────────────────┐
           │ Adapter integration tests with mock server  │
           └────────────────────────────────────────────┘
        ┌──────────────────────────────────────────────────┐
        │ Mapper tests / fault translation / idempotency    │
        └──────────────────────────────────────────────────┘
     ┌────────────────────────────────────────────────────────┐
     │ Domain/application unit tests                          │
     └────────────────────────────────────────────────────────┘
```

### 19.2 Golden message tests

Simpan sample XML realistik:

```text
golden/
  submit-case-valid-request.xml
  submit-case-valid-response.xml
  submit-case-validation-fault.xml
  submit-case-security-fault.xml
  submit-case-minimal-request.xml
  submit-case-nillable-field-request.xml
  submit-case-attachment-request.mime
```

Test:

```java
@Test
void goldenSubmitCaseRequestStillUnmarshals() throws Exception {
    var xml = Files.newInputStream(Path.of("src/test/resources/golden/submit-case-valid-request.xml"));
    var request = (SubmitCaseRequest) unmarshaller.unmarshal(xml);

    assertThat(request.getApplicantId()).isEqualTo("A1234567");
}
```

### 19.3 Contract diff tests

Untuk WSDL/XSD:

```text
[ ] No namespace change without version.
[ ] No operation removed.
[ ] No input/output message removed.
[ ] No required element added to existing request.
[ ] No existing element type narrowed.
[ ] No fault removed/renamed.
[ ] No SOAPAction changed unless coordinated.
```

### 19.4 Consumer-driven tests

Untuk consumer penting, buat sample call:

```text
consumer-a-submit-case-request.xml
consumer-b-submit-case-request.xml
consumer-c-upload-doc-request.mime
```

Ini lebih valuable daripada synthetic happy path.

### 19.5 Failure tests

Wajib test:

- timeout before response,
- connection refused,
- malformed SOAP fault,
- invalid XML,
- invalid namespace,
- expired certificate,
- WS-Security timestamp expired,
- duplicate request,
- partner returns HTTP 500 without SOAP fault,
- partner returns SOAP fault with HTTP 200,
- attachment too large,
- partial response/truncated XML.

---

## 20. Observability: Modernisasi Tanpa Telemetry Itu Buta

### 20.1 Metrics minimal

```text
soap_requests_total{operation, consumer, outcome}
soap_request_duration_seconds{operation, consumer}
soap_faults_total{operation, fault_code, fault_type}
soap_timeouts_total{operation, phase}
soap_payload_size_bytes{operation, direction}
soap_attachment_size_bytes{operation}
soap_retries_total{operation, reason}
soap_duplicate_requests_total{operation}
soap_contract_validation_failures_total{operation}
```

### 20.2 Log minimal

Log structured:

```json
{
  "event": "soap_call_completed",
  "operation": "SubmitCase",
  "consumer": "agency-a",
  "correlationId": "9f4cf8a8-2e33-4f52-a4c9-fb3e7df47d11",
  "referenceNo": "APP-2026-00001",
  "outcome": "BUSINESS_FAULT",
  "faultCode": "INVALID_IDENTIFIER",
  "durationMs": 843,
  "retryCount": 0
}
```

Do not log:

- full SOAP envelope with PII,
- password token,
- private key,
- full certificate secret material,
- raw attachment,
- signed payload if it contains sensitive data,
- session/security token.

### 20.3 Trace propagation

SOAP has headers, HTTP has headers, internal services may use trace context. Decide explicitly:

```text
Inbound HTTP X-Correlation-Id
      ↓
SOAP Header CorrelationId
      ↓
Application MDC/log context
      ↓
Outbound downstream call
      ↓
Audit/event record
```

If partner does not support custom SOAP header, keep correlation in your logs and maybe business reference field.

---

## 21. Idempotency and Unknown Outcome

### 21.1 The hardest SOAP modernization problem

The hardest problem is not XML. It is this:

```text
Client sends SubmitCase
Server processes successfully
Network timeout occurs before client receives response
Client retries
What happens?
```

Possible outcomes:

| Design | Result |
|---|---|
| No idempotency | duplicate case/application/payment |
| Backend rejects duplicate vaguely | consumer cannot recover reliably |
| Idempotency key supported | safe retry/reconciliation |
| Query by reference supported | recover unknown outcome |
| Async accepted model | easier if reference returned early |

### 21.2 Modernization rule

For state-changing SOAP operation, define:

```text
[ ] What is the idempotency key?
[ ] Is it generated by consumer or server?
[ ] Can duplicate request return same response?
[ ] Can consumer query status by reference?
[ ] Is timeout considered failed, pending, or unknown?
[ ] Is retry allowed? How many times? With what backoff?
[ ] What is manual reconciliation path?
```

### 21.3 REST facade must not lie

If SOAP timeout produces unknown outcome, REST facade should not return simple 500 with “failed”.

Better:

```json
{
  "status": "UNKNOWN_OUTCOME",
  "message": "The upstream system did not return a definitive response. Use the reference number to query status or wait for reconciliation.",
  "referenceNo": "APP-2026-00001",
  "correlationId": "..."
}
```

Or use `504 Gateway Timeout` with body that states outcome is unknown.

---

## 22. Security Modernization

### 22.1 Do not weaken security while modernizing

Common bad modernization:

```text
Before:
Consumer → mTLS + WS-Security signed SOAP → Legacy

After:
Consumer → REST over TLS → Facade → unsigned SOAP → Legacy
```

Maybe acceptable internally, maybe not. But it must be a deliberate risk decision, not accidental.

### 22.2 Security mapping questions

| Question | Why it matters |
|---|---|
| Is identity at transport layer, message layer, or both? | Determines whether facade may terminate security |
| Is signature end-to-end required? | Facade cannot modify signed parts freely |
| Are timestamps/nonces validated? | Replay protection can break with queues/retries |
| Is client certificate mapped to business actor? | REST facade needs equivalent auth context |
| Are SOAP headers legally/audit significant? | Must preserve or map explicitly |
| Is encryption message-level? | Facade may not see content unless intended |

### 22.3 Certificate lifecycle

Modernization often fails due to certificate operations, not code:

```text
[ ] keystore owner known
[ ] truststore owner known
[ ] cert expiry monitored
[ ] rotation procedure tested
[ ] lower env certs separated
[ ] partner cert rollover process defined
[ ] clock synchronization monitored
[ ] algorithm restrictions known
[ ] hostname verification behavior tested
```

---

## 23. Data Migration vs Contract Migration

SOAP modernization may or may not require data migration.

| Scenario | Data migration? | Contract migration? |
|---|---:|---:|
| REST facade over SOAP | No | Yes, new REST contract |
| SOAP facade over modern service | Maybe | No external contract change |
| Reimplement SOAP same DB | No/low | No external contract change |
| Reimplement SOAP new DB | Yes | Ideally no external contract change |
| Retire SOAP and move consumers to REST | Maybe | Yes |
| Event-driven replacement | Usually yes/partial | Yes or compatibility facade |

Do not mix too many migrations at once:

```text
Bad:
SOAP → REST + new DB + new domain model + new auth + new workflow + new partner onboarding
```

Safer:

```text
Step 1: stabilize SOAP runtime
Step 2: add observability
Step 3: introduce facade with same backend
Step 4: migrate selected consumer
Step 5: reimplement one operation
Step 6: migrate storage if needed
Step 7: retire old path
```

---

## 24. Governance: The Boring Part That Saves Production

### 24.1 Contract registry

Keep a registry:

| Contract | Version | Owner | Consumers | Status | Retirement date |
|---|---|---|---|---|---|
| CaseService WSDL | v1 | Team A | Agency A/B | Active | TBD |
| Case REST API | v2 | Team A | Portal X | Active | N/A |
| EligibilityService WSDL | v1 | Vendor | ACEAS | External | N/A |

### 24.2 Change classification

| Change | Breaking? | Example |
|---|---:|---|
| Add optional element | Usually no | `minOccurs=0` new field |
| Add required element | Yes | existing request now needs new field |
| Rename element | Yes | QName changes |
| Change namespace | Yes | generated clients break |
| Add new operation | Usually no | existing clients unaffected |
| Remove operation | Yes | consumers break |
| Change fault detail | Often yes | clients parse detail |
| Change timeout semantics | Behavior breaking | retry logic changes |
| Change cert/security policy | Operational breaking | partner cannot connect |

### 24.3 Deprecation process

```text
1. Identify consumers through telemetry.
2. Announce deprecation with exact operation/version.
3. Provide migration guide and test endpoint.
4. Run dual support period.
5. Track consumer migration status.
6. Block new consumers on old contract.
7. Freeze old contract except security fixes.
8. Retire only after evidence, not assumption.
```

---

## 25. Migration Roadmap Template

### Phase 0 — Discovery

```text
[ ] Collect WSDL/XSD.
[ ] Collect sample messages.
[ ] Identify operations.
[ ] Identify consumers.
[ ] Identify certs/security policies.
[ ] Identify runtime Java/app server.
[ ] Identify failure modes.
[ ] Identify SLA and support model.
```

### Phase 1 — Stabilization

```text
[ ] Make dependencies explicit.
[ ] Pin generated code process.
[ ] Harden XML parser.
[ ] Add timeout and retry policy.
[ ] Add correlation ID.
[ ] Add structured logs/metrics.
[ ] Add golden message tests.
```

### Phase 2 — Boundary Isolation

```text
[ ] Wrap SOAP clients behind domain ports.
[ ] Remove generated DTO from domain.
[ ] Create mapper tests.
[ ] Translate faults consistently.
[ ] Define idempotency/unknown outcome policy.
```

### Phase 3 — Compatibility Layer

```text
[ ] Add REST facade or SOAP compatibility facade.
[ ] Preserve WSDL if needed.
[ ] Provide sandbox/test endpoint.
[ ] Add consumer-specific test cases.
[ ] Document mapping and error semantics.
```

### Phase 4 — Incremental Migration

```text
[ ] Route one operation/consumer.
[ ] Observe latency/fault/mismatch.
[ ] Run parallel/shadow comparison if needed.
[ ] Roll out gradually.
[ ] Keep rollback path.
```

### Phase 5 — Retirement

```text
[ ] Freeze old contract.
[ ] Block new consumers.
[ ] Validate no traffic for defined period.
[ ] Archive WSDL/XSD/sample messages.
[ ] Archive cert/config.
[ ] Remove runtime dependencies.
[ ] Update runbooks.
```

---

## 26. Decision Tree

```text
Is the SOAP service externally owned?
├── Yes
│   ├── Need modern internal model?
│   │   ├── Yes → Client wrapper + anti-corruption layer
│   │   └── No  → Stabilize client + observability
│   └── Need expose to new consumers?
│       └── REST facade over SOAP
│
└── No, we own it
    ├── Do external consumers require same WSDL?
    │   ├── Yes → SOAP compatibility facade / contract-first rewrite
    │   └── No
    │       ├── Can consumers migrate incrementally?
    │       │   ├── Yes → Strangler by consumer / REST replacement
    │       │   └── No  → Strangler by operation behind SOAP facade
    │       └── Is operation high-risk state-changing?
    │           ├── Yes → parallel run + idempotency + reconciliation
    │           └── No  → incremental replacement
```

---

## 27. Common Anti-Patterns

### 27.1 Big-bang rewrite

```text
SOAP legacy → brand new REST service → all consumers cut over same weekend
```

Risiko:

- hidden consumer,
- semantic mismatch,
- operational overload,
- no rollback,
- certification failure,
- data reconciliation nightmare.

### 27.2 Code-first WSDL drift

```text
Change Java annotation → WSDL changes → consumer breaks
```

Prevent with WSDL diff gates.

### 27.3 Leaky generated classes

Generated SOAP classes masuk ke domain, database, REST DTO, atau UI. Ini membuat legacy contract menjadi internal architecture.

### 27.4 Error flattening

```text
All SOAP faults → HTTP 500
```

Ini membunuh semantics.

### 27.5 Retry without idempotency

Automatic retry untuk state-changing operation tanpa idempotency bisa menciptakan duplicate business action.

### 27.6 Logging full SOAP envelope

Debugging mudah, compliance/security hancur.

### 27.7 REST facade yang bohong

REST facade mengembalikan “failed” padahal upstream timeout berarti unknown outcome.

### 27.8 Removing SOAP security accidentally

Facade terminate WS-Security/mTLS tanpa equivalent security/audit model.

---

## 28. Production Readiness Checklist

```text
Contract
[ ] WSDL/XSD versioned.
[ ] Compatibility diff reviewed.
[ ] Golden messages available.
[ ] Consumer inventory known.

Runtime
[ ] Java 8/11/17/21/25 target tested as applicable.
[ ] JAXB/JAX-WS/SAAJ dependencies explicit.
[ ] javax/jakarta namespace strategy clear.
[ ] Generated code reproducible.

Security
[ ] TLS/mTLS tested.
[ ] WS-Security policy tested if used.
[ ] Keystore/truststore rotation documented.
[ ] XML parser hardened.
[ ] Sensitive logging redacted.

Reliability
[ ] Timeout policy explicit.
[ ] Retry policy tied to idempotency.
[ ] Unknown outcome handled.
[ ] Duplicate handling tested.
[ ] Reconciliation path exists.

Observability
[ ] Metrics by operation/consumer/outcome.
[ ] Structured logs with correlation ID.
[ ] Fault taxonomy visible.
[ ] Payload/attachment size monitored.
[ ] Alerts for cert expiry, fault spike, timeout spike.

Migration
[ ] Rollout unit defined: operation/consumer/tenant.
[ ] Rollback path tested.
[ ] Shadow/parallel comparison if high risk.
[ ] Deprecation plan documented.
[ ] Retirement based on telemetry evidence.
```

---

## 29. Practical Example: Modernizing a Case Submission SOAP Service

### 29.1 Initial state

```text
External agencies → CaseSubmissionService SOAP v1 → Legacy Java 8 app → Oracle DB
```

Characteristics:

- WSDL shared to agencies.
- Agencies generated SOAP clients years ago.
- Operation: `SubmitCase`, `GetCaseStatus`, `UploadDocument`, `CancelCase`.
- WS-Security certificate signature.
- MTOM for document upload.
- Java 8 runtime.
- No good correlation ID.
- Full envelope logs sometimes enabled.

### 29.2 Bad modernization plan

```text
Rewrite all to REST.
Ask all agencies to migrate.
Replace DB.
Remove SOAP.
Deploy in one cutover.
```

This is high risk.

### 29.3 Better plan

Phase 1:

```text
- Freeze WSDL v1.
- Add structured logging and correlation ID.
- Add metrics per SOAPAction/operation.
- Stop full envelope logging; add redaction.
- Make Java 11+ dependency strategy explicit.
- Add golden message tests.
```

Phase 2:

```text
- Create internal SubmitCaseUseCase.
- Put legacy SOAP generated classes behind mapper.
- Add idempotency by agencyReferenceNo.
- Add status query reconciliation.
```

Phase 3:

```text
- Implement SOAP compatibility facade still serving WSDL v1.
- Route GetCaseStatus to new service first.
- Keep SubmitCase on legacy.
```

Phase 4:

```text
- Shadow SubmitCase validation.
- Compare old/new validation result.
- Fix semantic mismatches.
```

Phase 5:

```text
- Route one agency to new SubmitCase.
- Monitor duplicate, fault, latency, reconciliation.
- Expand gradually.
```

Phase 6:

```text
- Offer REST v2 for new consumers.
- Keep SOAP v1 for legacy agencies until retirement plan accepted.
```

---

## 30. Top 1% Engineering Lens

A strong engineer does not say:

> “SOAP is old, let’s replace it.”

A strong engineer asks:

```text
- What exactly is the external contract?
- Who consumes it?
- Which parts are legally/security/operationally meaningful?
- What behavior is documented vs accidental?
- What can be changed without breaking generated clients?
- What is the rollback unit?
- How do we prove compatibility?
- How do we handle unknown outcome?
- How do we prevent generated legacy classes from corrupting the new domain?
- How do we retire based on evidence, not hope?
```

Top-tier modernization is boring in the best way:

- small steps,
- measurable behavior,
- explicit contracts,
- reversible rollout,
- security preserved,
- failure semantics understood,
- consumer impact governed.

---

## 31. Summary

Legacy SOAP modernization has several valid paths:

- **Stabilize in place** if SOAP is still valuable and risk is runtime/ops.
- **Client wrapper** if SOAP is external and cannot be changed.
- **REST facade over SOAP** if new consumers need modern API but backend remains SOAP.
- **SOAP facade over modern service** if old consumers need WSDL compatibility while backend changes.
- **Anti-corruption layer** to keep domain clean.
- **Strangler by operation/consumer** to reduce big-bang risk.
- **Parallel run/shadow comparison** for high-risk behavior replacement.
- **Contract-first rewrite** when implementation must change but WSDL must remain.
- **Event bridge** when synchronous SOAP command hides asynchronous business workflow.

The central rule:

> **Modernize the boundary deliberately. Do not accidentally change the contract.**

---

## 32. References

[^fowler-strangler]: Martin Fowler, *Strangler Fig Application*, describes incremental replacement by surrounding legacy functionality and gradually routing behavior to the new implementation. https://martinfowler.com/bliki/StranglerFigApplication.html

[^fowler-original-strangler]: Martin Fowler, *Original Strangler Fig Application*, emphasizes reduced risk compared with cut-over rewrite and steady value delivery through incremental replacement. https://martinfowler.com/bliki/OriginalStranglerFigApplication.html

[^jakarta-xml-ws]: Jakarta XML Web Services 4.0 defines a means for implementing XML-based web services based on Jakarta SOAP with Attachments and Jakarta Web Services Metadata. https://jakarta.ee/specifications/xml-web-services/4.0/

[^jep320]: OpenJDK JEP 320 removed Java EE and CORBA modules from Java SE and the JDK, including `java.xml.ws`, `java.xml.bind`, `java.activation`, and related modules. https://openjdk.org/jeps/320

[^wsdl11]: W3C WSDL 1.1 defines XML service description concepts including types, messages, port types, bindings, ports, and services. https://www.w3.org/TR/wsdl.html

[^wsdl-soap12]: W3C submission for WSDL 1.1 SOAP 1.2 binding defines extensions to indicate SOAP 1.2 protocol binding in WSDL 1.1. https://www.w3.org/Submission/wsdl11soap12/

---

## 33. Posisi dalam Seri

Bagian ini adalah **Part 30 dari 34**.

Bagian berikutnya:

> **Part 31 — Jakarta Connectors / JCA Mental Model**

Mulai Part 31, kita bergeser dari SOAP/XML web service ke **Jakarta Connectors / Java Connector Architecture**, yaitu model standar enterprise untuk menghubungkan application server/Jakarta EE runtime dengan Enterprise Information Systems seperti ERP, mainframe, message system, custom protocol, dan resource adapter.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-json-xml-soap-connectors-enterprise-integration — Part 29](./learn-java-json-xml-soap-connectors-enterprise-integration-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration-part-031](./learn-java-json-xml-soap-connectors-enterprise-integration-part-031.md)
