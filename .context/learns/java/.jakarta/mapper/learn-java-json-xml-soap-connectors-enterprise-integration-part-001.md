# learn-java-json-xml-soap-connectors-enterprise-integration — Part 1
# Data Format as Contract: JSON, XML, XSD, WSDL, and Integration Compatibility

> Seri: **Java JSON, XML, SOAP Legacy, and Jakarta Connectors — Enterprise Integration Deep Dive**  
> Part: **1 dari 34**  
> Target Java: **Java 8 sampai Java 25**  
> Fokus: **memahami data format sebagai kontrak evolutif antar sistem, bukan sekadar payload serialization**

---

## 0. Tujuan Part Ini

Di banyak project, JSON/XML/SOAP diperlakukan terlalu dangkal:

- JSON dianggap cuma `Map<String, Object>` atau DTO yang di-serialize.
- XML dianggap cuma format lama yang verbose.
- XSD dianggap file validasi yang jarang dibaca.
- WSDL dianggap artifact generate-client yang disentuh hanya saat error.
- SOAP dianggap teknologi legacy yang harus segera “dibungkus REST”.

Cara berpikir seperti itu cukup untuk membuat feature bekerja, tetapi tidak cukup untuk merancang integrasi enterprise yang tahan terhadap perubahan, audit, migrasi Java, backward compatibility, dan failure lintas organisasi.

Part ini membangun mental model utama:

> **Data format di boundary sistem adalah contract surface.**  
> Yang dikirim bukan hanya data, tetapi janji: struktur, makna, tipe, optionality, constraint, error semantics, evolusi, dan ekspektasi kompatibilitas.

Setelah Part ini, Anda diharapkan mampu:

1. Membedakan **data representation**, **schema**, **semantic contract**, dan **runtime binding**.
2. Menilai kapan JSON cukup, kapan XML/XSD lebih tepat, kapan WSDL/SOAP masih rasional.
3. Mendesain kontrak yang bisa berevolusi tanpa memecahkan consumer lama.
4. Menghindari anti-pattern seperti shared canonical model yang terlalu besar, DTO bocor dari domain, dan “breaking change yang terlihat harmless”.
5. Membaca integrasi legacy bukan sebagai masalah teknologi lama, tetapi sebagai masalah **contract governance**.
6. Membuat decision matrix untuk JSON/XML/SOAP/JCA di lingkungan Java 8–25.

---

## 1. Kenapa “Format Data” Sebenarnya Adalah Kontrak

### 1.1 Payload bukan hanya bytes

Ketika sistem A mengirim payload ke sistem B, yang terlihat di wire mungkin hanya ini:

```json
{
  "caseId": "C-2026-0000123",
  "status": "PENDING_REVIEW",
  "submittedAt": "2026-06-17T10:15:30+07:00"
}
```

Tetapi secara kontrak, payload ini membawa banyak asumsi tersembunyi:

| Elemen | Pertanyaan kontrak |
|---|---|
| `caseId` | Formatnya stabil? Case-sensitive? Bisa berubah panjang? Bisa null? Globally unique atau hanya unique per agency? |
| `status` | Enum tertutup atau boleh ada nilai baru? Consumer lama harus fail atau ignore? |
| `submittedAt` | Timezone wajib? Precision sampai detik, millis, nanos? Local time atau instant? |
| Field baru | Boleh ditambahkan? Consumer lama ignore atau reject? |
| Field hilang | Apakah absent sama dengan null? Apakah default berlaku? |
| Error | Kalau status tidak dikenal, response apa? Retry atau manual intervention? |

DTO hanya menjawab sebagian kecil: “bagaimana payload masuk ke object”. Kontrak menjawab: “apa arti payload, apa yang boleh berubah, dan apa kewajiban masing-masing pihak”.

### 1.2 Format, schema, binding, dan semantics adalah layer berbeda

Salah satu kesalahan engineer adalah mencampur empat layer ini:

```text
┌──────────────────────────────────────────────┐
│ Semantic Contract                             │
│ Meaning, invariants, business rules, lifecycle│
├──────────────────────────────────────────────┤
│ Schema / Contract Description                 │
│ XSD, WSDL, JSON Schema, OpenAPI, prose spec    │
├──────────────────────────────────────────────┤
│ Data Format                                   │
│ JSON, XML, SOAP envelope, MIME, CSV, binary    │
├──────────────────────────────────────────────┤
│ Runtime Binding                               │
│ JSON-B, Jackson, JAXB, JAX-WS, SAAJ, custom    │
└──────────────────────────────────────────────┘
```

Contoh:

- JSON adalah **format**.
- JSON-B/Jackson adalah **binding runtime**.
- JSON Schema/OpenAPI adalah **contract description**.
- “`status = APPROVED` berarti case sudah final dan tidak bisa diedit” adalah **semantic contract**.

Di XML/SOAP:

- XML adalah **format**.
- XSD adalah **schema**.
- JAXB adalah **binding runtime**.
- WSDL adalah **service contract description**.
- SOAP envelope/header/body/fault adalah **message protocol structure**.
- “SOAP Fault `DuplicateSubmissionFault` berarti client tidak boleh retry dengan payload yang sama kecuali memakai idempotency key baru” adalah **semantic contract**.

Top engineer tidak berhenti di “bisa parse”. Mereka bertanya:

> Apa invariant kontrak ini?  
> Siapa consumer-nya?  
> Bagaimana kalau provider berubah?  
> Apa yang terjadi pada consumer lama?  
> Apakah failure ini retryable, terminal, atau butuh reconciliation?

---

## 2. Evolusi Java 8–25: Kenapa Kontrak Harus Dipisah dari Runtime

### 2.1 Java 8: masa “banyak API enterprise terasa built-in”

Di Java 8, banyak aplikasi terbiasa memakai JAXB/JAX-WS/SAAJ seolah-olah itu bagian natural dari JDK. Ini membuat banyak codebase legacy punya asumsi:

```java
import javax.xml.bind.JAXBContext;
import javax.xml.ws.Service;
```

lalu compile tanpa dependency eksplisit.

Masalahnya: asumsi ini rapuh.

### 2.2 Java 11+: Java EE/CORBA modules dihapus dari JDK

JEP 320 menghapus modul Java EE dan CORBA dari Java SE Platform dan JDK. Modul yang terdampak termasuk `java.xml.ws` untuk JAX-WS/SAAJ/Web Services Metadata, `java.xml.bind` untuk JAXB, `java.activation`, Common Annotations, CORBA, dan JTA subset. Modul-modul itu sebelumnya sudah deprecated for removal di Java 9 dan dihapus di Java 11.  
Sumber: OpenJDK JEP 320 — https://openjdk.org/jeps/320

Dampaknya sangat praktis:

```text
Java 8:
  javax.xml.bind.* mungkin compile tanpa dependency eksplisit.

Java 11+:
  code bisa gagal compile atau runtime ClassNotFoundException
  jika JAXB/JAX-WS/SAAJ tidak ditambahkan sebagai dependency.
```

Oracle migration guide untuk Java 11 juga menegaskan bahwa code yang mereferensikan API tersebut tidak akan compile/run tanpa perubahan build/deployment, dan JAXB/JAX-WS harus diambil dari Maven jika dibutuhkan.  
Sumber: Oracle JDK 11 Migration Guide — https://docs.oracle.com/en/java/javase/11/migrate/

### 2.3 Javax → Jakarta: package rename sebagai contract migration risk

Jakarta EE 9 memindahkan package namespace dari `javax.*` ke `jakarta.*` untuk banyak spesifikasi Jakarta EE. Untuk area seri ini:

```text
javax.json.*       → jakarta.json.*
javax.json.bind.*  → jakarta.json.bind.*
javax.xml.bind.*   → jakarta.xml.bind.*
javax.xml.ws.*     → jakarta.xml.ws.*
javax.xml.soap.*   → jakarta.xml.soap.*
javax.resource.*   → jakarta.resource.*
```

Ini bukan sekadar find-and-replace. Risiko migrasinya meliputi:

- dependency lama dan baru bercampur;
- generated JAXB classes masih `javax`;
- app server menyediakan Jakarta API, library lama berharap Javax API;
- SOAP client generated dari tool lama tidak cocok dengan runtime baru;
- transitive dependency membawa API duplikat;
- modul JPMS/classpath memunculkan split package atau class shadowing;
- annotation di DTO berubah package sehingga runtime binding tidak mengenali metadata.

### 2.4 Jakarta EE 11: XML Binding, XML Web Services, SOAP with Attachments keluar dari platform utama

Jakarta EE 11 menghapus XML Binding dan SOAP with Attachments dari platform; platform specification juga menyebut penghapusan XML Web Services, XML Binding, dan SOAP with Attachments dari platform. Artinya teknologi ini tidak hilang dari dunia Java, tetapi tidak lagi diasumsikan sebagai bagian default dari platform modern.  
Sumber: Jakarta EE 11 release page — https://jakarta.ee/release/11/  
Sumber: Jakarta EE Platform 11 — https://jakarta.ee/specifications/platform/11/

Implikasi arsitektural:

- Jika Anda masih butuh SOAP/JAXB/SAAJ, treat as **explicit integration capability**, bukan implicit platform feature.
- Pilih runtime/implementation secara sadar: Metro/JAX-WS RI, JAXB RI, EclipseLink MOXy, app server feature, vendor support.
- Buat boundary adapter supaya legacy SOAP tidak menyebar ke domain dan application layer.
- Jangan membuat domain model tergantung langsung pada annotation SOAP/XML lama kecuali memang intentionally generated model.

### 2.5 Konsekuensi mental model

Karena runtime Java berubah dari 8 sampai 25, kontrak harus dipisah dari implementasi.

```text
Buruk:
  Contract = whatever DTO currently serializes to.

Lebih baik:
  Contract = explicit external agreement.
  DTO/binding = one implementation of that agreement.
```

Dengan mental model ini, migrasi Java 8 → 17 → 21 → 25 tidak otomatis mengubah kontrak eksternal. Yang berubah adalah adapter, dependency, code generation, dan runtime binding.

---

## 3. Format Data sebagai Boundary, Bukan Domain

### 3.1 Boundary model vs domain model

Dalam sistem serius, sebaiknya bedakan:

```text
External Payload Model
  Bentuk sesuai kontrak luar.
  Bisa aneh, legacy, verbose, nullable, stringly typed.

Application Command / Query Model
  Bentuk maksud use case.
  Sudah divalidasi minimal.

Domain Model
  Bentuk invariant internal.
  Tidak tunduk langsung pada format transport.

Persistence Model
  Bentuk storage.
  Optimized untuk query, constraints, migration.
```

Contoh buruk:

```java
@Entity
@XmlRootElement
@JsonbPropertyOrder({"caseId", "status", "submittedAt"})
public class Case {
    @Id
    private Long id;
    private String caseId;
    private String status;
    private LocalDateTime submittedAt;
}
```

Masalah:

- Entity database menjadi kontrak XML/JSON.
- Perubahan DB bisa breaking external contract.
- Annotation JSON/XML/JPA bercampur.
- Field internal mudah bocor.
- Legacy constraint memengaruhi domain.
- Sulit membuat versioning.

Lebih baik:

```text
Inbound JSON/XML/SOAP DTO
        ↓ parse/bind
Contract-level validation
        ↓ map
Application command
        ↓ enforce invariant
Domain model
        ↓ produce outcome
Outbound DTO / event / response
```

Contoh Java:

```java
// External contract DTO: mengikuti API/public contract.
public record SubmitCaseRequestV1(
        String applicantId,
        String caseType,
        String submittedAt,
        Map<String, Object> declaredFacts
) {}

// Application command: lebih dekat ke maksud use case.
public record SubmitCaseCommand(
        ApplicantId applicantId,
        CaseType caseType,
        OffsetDateTime submittedAt,
        DeclaredFacts declaredFacts
) {}

// Mapper: tempat translasi kontrak eksternal ke model internal.
public final class SubmitCaseMapper {
    public SubmitCaseCommand toCommand(SubmitCaseRequestV1 request) {
        return new SubmitCaseCommand(
                ApplicantId.parse(request.applicantId()),
                CaseType.fromExternalCode(request.caseType()),
                OffsetDateTime.parse(request.submittedAt()),
                DeclaredFacts.fromExternalMap(request.declaredFacts())
        );
    }
}
```

Top 1% engineer biasanya punya disiplin boundary seperti ini karena mereka pernah melihat akibat buruk dari model yang tercampur.

### 3.2 Format luar boleh “jelek”; domain internal tidak harus ikut jelek

Legacy SOAP mungkin punya field seperti:

```xml
<APP_STATUS>A</APP_STATUS>
<SUBMIT_DT>20260617</SUBMIT_DT>
<IS_URGENT>Y</IS_URGENT>
```

Jangan paksa domain memakai `String status`, `String submitDt`, `String isUrgent` hanya karena external contract begitu.

Gunakan adapter:

```java
public enum CaseStatus {
    APPROVED,
    PENDING,
    REJECTED;

    public static CaseStatus fromLegacyCode(String code) {
        return switch (code) {
            case "A" -> APPROVED;
            case "P" -> PENDING;
            case "R" -> REJECTED;
            default -> throw new UnknownExternalCodeException("APP_STATUS", code);
        };
    }
}
```

Boundary menerima warisan eksternal. Domain mempertahankan invariant internal.

---

## 4. JSON vs XML: Bukan Sekadar Modern vs Legacy

### 4.1 JSON: minimal, populer, mudah, tetapi schema semantics sering lemah

RFC 8259 mendefinisikan JSON sebagai format pertukaran data yang lightweight, text-based, dan language-independent. JSON memiliki aturan sintaks kecil untuk representasi portable structured data.  
Sumber: RFC 8259 — https://datatracker.ietf.org/doc/html/rfc8259

Kekuatan JSON:

- ringkas dan mudah dibaca;
- cocok untuk HTTP API modern;
- natural untuk JavaScript/TypeScript frontend;
- binding ke DTO relatif mudah;
- cocok untuk event payload dan microservices;
- tooling luas: OpenAPI, JSON Schema, jq, Postman, browser devtools.

Kelemahan JSON:

- tidak punya namespace native;
- tidak punya tipe tanggal native;
- tidak membedakan integer/decimal secara kuat di semua runtime;
- tidak punya attribute vs element model;
- komentar tidak standar;
- duplicate key behavior sering berbeda antar parser;
- absent vs null sering ambigu;
- enum evolution sering diremehkan;
- canonicalization/signature lebih rumit bila tidak distandarkan;
- schema governance sering lebih lemah dibanding XSD/WSDL di enterprise lama.

### 4.2 XML: verbose, tetapi kaya kontrak

XML bukan hanya JSON yang lebih panjang. XML punya konsep:

- namespace;
- QName;
- element dan attribute;
- mixed content;
- schema validation;
- XPath/XSLT;
- canonicalization;
- XML Signature/XML Encryption ecosystem;
- SOAP envelope/header/body/fault;
- XSD type system;
- import/include schema modularity.

XSD 1.1 adalah bahasa schema untuk mendeskripsikan struktur dan membatasi isi dokumen XML, termasuk XML yang memakai namespace.  
Sumber: W3C XSD 1.1 Part 1 — https://www.w3.org/TR/xmlschema11-1/

Kekuatan XML/XSD:

- kuat untuk dokumen formal dan regulatory exchange;
- mendukung namespace dan modular schema;
- constraint bisa sangat rinci;
- schema-first generation mature;
- cocok untuk long-lived inter-organization contract;
- cocok untuk SOAP/WSDL ecosystem;
- validation bisa dilakukan sebelum masuk application logic.

Kelemahan XML:

- verbose;
- parser security harus serius;
- XXE/entity expansion/XInclude risk;
- namespace sering membingungkan;
- generated classes bisa kompleks;
- schema evolution bisa kaku;
- developer modern sering kurang familiar;
- performance/memory bisa buruk jika salah parser model.

### 4.3 SOAP/WSDL: bukan format data, tetapi service contract stack

SOAP bukan hanya XML. SOAP adalah messaging protocol dengan envelope, header, body, fault, dan binding ke transport/protocol. JAX-WS/Jakarta XML Web Services mendefinisikan cara implementasi XML-based Web Services berbasis SOAP with Attachments dan Web Services Metadata.  
Sumber: Jakarta XML Web Services 4.0 — https://jakarta.ee/specifications/xml-web-services/4.0/

WSDL mendeskripsikan service contract:

```text
WSDL
 ├─ types       : XSD/schema tipe data
 ├─ message     : struktur pesan abstrak
 ├─ portType    : operasi abstrak
 ├─ binding     : bagaimana operasi dipetakan ke SOAP/transport
 └─ service     : endpoint konkret
```

Kekuatan SOAP/WSDL:

- contract-first sangat kuat;
- code generation matang;
- typed fault;
- enterprise tooling luas;
- WS-Security/WS-Addressing/WS-Policy;
- cocok untuk B2B/government/legacy regulated systems;
- eksplisit soal operasi dan message shape.

Kelemahan SOAP/WSDL:

- kompleks;
- heavy;
- debugging lebih sulit;
- WS-* interoperability bisa vendor-specific;
- generated client/server bisa fragile;
- migrasi Javax→Jakarta bisa besar;
- banyak organisasi hanya punya partial understanding.

---

## 5. Schema-First vs Code-First vs Example-First

### 5.1 Schema-first

Schema-first berarti kontrak ditulis eksplisit dulu, lalu code mengikuti.

Contoh XML/SOAP:

```text
XSD/WSDL → generated Java classes/client/server skeleton → business implementation
```

Contoh JSON modern:

```text
OpenAPI/JSON Schema → generated DTO/client/server stub → implementation
```

Kelebihan:

- kontrak eksplisit;
- cocok untuk banyak consumer;
- cocok untuk governance;
- memaksa diskusi compatibility sebelum implementasi;
- bisa diuji dengan contract test;
- provider dan consumer bisa bekerja paralel.

Kekurangan:

- butuh disiplin desain kontrak;
- generated code kadang tidak idiomatis;
- perubahan kecil bisa terasa berat;
- schema bisa menjadi terlalu kompleks;
- developer bisa “mengabdi pada schema” tanpa memahami semantic contract.

Gunakan schema-first ketika:

- integrasi lintas organisasi;
- contract harus long-lived;
- banyak consumer;
- regulatory/audit penting;
- failure mahal;
- payload punya struktur kompleks;
- ada kebutuhan code generation;
- provider dan consumer berbeda vendor/tim.

### 5.2 Code-first

Code-first berarti Java class/annotation dibuat dulu, lalu kontrak dihasilkan atau dianggap implisit.

Contoh:

```java
@WebService
public class PaymentService {
    public PaymentResponse submitPayment(PaymentRequest request) { ... }
}
```

atau:

```java
public record CreateApplicationRequest(
    String applicantName,
    String email,
    LocalDate dateOfBirth
) {}
```

lalu OpenAPI/WSDL di-generate.

Kelebihan:

- cepat untuk internal service;
- developer ergonomics bagus;
- cocok untuk prototyping;
- lebih dekat ke code actual;
- sedikit artifact terpisah.

Kekurangan:

- kontrak mudah berubah tanpa sadar;
- refactor internal bisa breaking external API;
- generated schema bisa buruk;
- annotation runtime memengaruhi public contract;
- sulit governance bila banyak tim.

Gunakan code-first ketika:

- consumer sedikit dan dekat;
- API internal;
- lifecycle pendek;
- tim provider-consumer sama;
- contract tidak regulatory-critical;
- backward compatibility masih bisa dikelola dengan komunikasi langsung.

### 5.3 Example-first

Example-first berarti kontrak dibangun dari sample payload.

Contoh:

```json
{
  "applicationNo": "A-001",
  "status": "DRAFT"
}
```

lalu developer menyepakati “formatnya kira-kira begini”.

Kelebihan:

- cepat untuk discovery;
- bagus untuk workshop;
- mudah dipahami non-engineer;
- membantu capture real payload.

Kekurangan:

- tidak cukup sebagai kontrak formal;
- edge case tidak terlihat;
- optionality ambigu;
- type/format sering tidak jelas;
- compatibility tidak terdokumentasi;
- consumer membuat asumsi sendiri.

Gunakan example-first hanya sebagai tahap awal, lalu formalkan ke schema/prose contract.

---

## 6. Contract Surface: Apa Saja yang Harus Dinyatakan

Kontrak matang tidak cukup dengan “field ini ada”. Minimal contract surface meliputi:

### 6.1 Structure

- Nama field/element.
- Nesting.
- Array/list ordering.
- Object/element cardinality.
- Namespace untuk XML.
- Envelope/header/body untuk SOAP.

Contoh struktur JSON:

```json
{
  "caseId": "C-2026-0001",
  "participants": [
    {
      "role": "APPLICANT",
      "name": "Alice"
    }
  ]
}
```

Pertanyaan kontrak:

- Apakah `participants` boleh kosong?
- Apakah ordering participants bermakna?
- Apakah role unique per case?
- Apakah unknown role boleh muncul?

### 6.2 Type

Tipe bukan cuma tipe Java.

| Konsep | JSON | XML/XSD | Java binding |
|---|---|---|---|
| Text | string | `xs:string` | `String` |
| Integer | number | `xs:int`, `xs:long`, `xs:integer` | `int`, `long`, `BigInteger` |
| Decimal | number | `xs:decimal` | `BigDecimal` |
| Date | string convention | `xs:date` | `LocalDate`, `XMLGregorianCalendar` |
| Date-time | string convention | `xs:dateTime` | `OffsetDateTime`, `Instant`, `XMLGregorianCalendar` |
| Binary | base64 string | `xs:base64Binary` | `byte[]`, attachment |
| Enum | string convention | restriction enumeration | enum/string |

JSON number sangat perlu perhatian. Banyak parser bisa membaca number sebagai `Double` jika tidak dikonfigurasi, yang berbahaya untuk uang, rate, fee, tax, scoring, atau regulatory amount.

### 6.3 Presence: required, optional, absent, null, nil

Ini sumber bug besar.

```json
{
  "middleName": null
}
```

berbeda dengan:

```json
{
}
```

Di JSON:

```text
absent = field tidak dikirim
null   = field dikirim dengan nilai null
```

Tetapi apakah maknanya sama? Tergantung kontrak.

Di XML/XSD:

```xml
<middleName xsi:nil="true" />
```

berbeda dari:

```xml
<!-- middleName tidak ada -->
```

Kontrak harus menjelaskan:

- field wajib ada atau tidak;
- null boleh atau tidak;
- absent berarti default atau no-change;
- null berarti clear value atau unknown;
- empty string sama dengan null atau invalid;
- list kosong sama dengan absent atau bukan.

### 6.4 Semantic constraints

Schema bisa menyatakan:

```text
amount is decimal, min 0
```

Tetapi semantic contract bisa menyatakan:

```text
amount must equal sum(lineItems.amount) after currency rounding rule X.
```

Schema tidak selalu cukup. Anda butuh prose/invariant.

Contoh:

```text
If applicationType = RENEWAL, previousLicenceNo is required.
If applicationType = NEW, previousLicenceNo must be absent.
If status = APPROVED, approvedAt must be present and rejectionReason must be absent.
```

### 6.5 Temporal semantics

Tanggal dan waktu sering menjadi sumber bug lintas sistem.

Kontrak harus menjelaskan:

- Apakah timestamp adalah instant atau local date-time?
- Timezone wajib atau tidak?
- Precision: seconds, millis, nanos?
- Apakah date-only memakai timezone agency/server/user?
- Apakah end date inclusive atau exclusive?
- Apakah deadline dihitung berdasarkan business day atau calendar day?

Contoh buruk:

```json
{"submittedAt": "2026-06-17 10:00:00"}
```

Masalah:

- format tidak ISO;
- timezone tidak ada;
- parser antar bahasa bisa beda;
- ambiguity jika sistem lintas negara.

Lebih baik:

```json
{"submittedAt": "2026-06-17T10:00:00+07:00"}
```

atau jika memang instant global:

```json
{"submittedAt": "2026-06-17T03:00:00Z"}
```

### 6.6 Error semantics

Kontrak request/response tidak lengkap tanpa error contract.

Minimal jelaskan:

- error code stabil;
- message untuk manusia atau mesin;
- retryable atau terminal;
- validation error per field;
- correlation/request ID;
- idempotency impact;
- partial success behavior;
- fault mapping untuk SOAP.

Contoh JSON error:

```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "Request failed validation.",
  "correlationId": "01JZ...",
  "fieldErrors": [
    {
      "field": "submittedAt",
      "code": "INVALID_FORMAT",
      "message": "submittedAt must include timezone offset."
    }
  ]
}
```

Contoh SOAP fault concept:

```xml
<soap:Fault>
  <faultcode>soap:Client</faultcode>
  <faultstring>Validation failed</faultstring>
  <detail>
    <ValidationFault>
      <errorCode>INVALID_SUBMITTED_AT</errorCode>
      <correlationId>01JZ...</correlationId>
    </ValidationFault>
  </detail>
</soap:Fault>
```

### 6.7 Operational semantics

Kontrak juga harus menjawab:

- timeout normal berapa?
- payload maximum size?
- attachment maximum size?
- rate limit?
- deduplication window?
- idempotency key wajib?
- retry policy?
- ordering guarantee?
- delivery semantics: at-most-once, at-least-once, effectively-once?
- reconciliation endpoint ada atau tidak?

Ini sering tidak masuk schema, tetapi sangat menentukan production behavior.

---

## 7. Compatibility: Bagian Paling Penting dari Contract Design

### 7.1 Backward dan forward compatibility

```text
Backward compatibility:
  Consumer baru masih bisa membaca payload lama.

Forward compatibility:
  Consumer lama masih bisa bertahan saat payload baru muncul.
```

Dalam distributed system, forward compatibility sering lebih sulit karena provider bisa deploy lebih dulu dari consumer.

### 7.2 Perubahan yang biasanya aman

Untuk JSON object-based contract, perubahan berikut biasanya aman jika consumer dirancang ignore unknown field:

- menambah optional field;
- menambah enum value jika consumer punya unknown handling;
- memperluas maximum length jika storage consumer tidak terbatas ketat;
- menambah object nested optional;
- menambah response metadata.

Untuk XML/XSD, “aman” tergantung schema design. Jika sequence terlalu ketat, menambah element bisa breaking untuk validator lama. Extensibility point seperti `xs:any` atau versioned namespace bisa membantu, tetapi harus dirancang dari awal.

### 7.3 Perubahan yang sering breaking

| Perubahan | Kenapa breaking |
|---|---|
| Rename field/element | Consumer lama mencari nama lama. |
| Mengubah type string → number | Parser/binding lama gagal. |
| Mengubah number precision | Rounding/overflow. |
| Required field baru | Consumer lama tidak mengirim. |
| Optional field jadi required | Request lama invalid. |
| Menghapus enum value | Consumer lama masih mengirim/expect. |
| Menambah enum value tanpa unknown policy | Consumer lama exception. |
| Mengubah date format | Parser lama gagal. |
| Mengubah null semantics | Business behavior berubah diam-diam. |
| Mengubah XML namespace | Binding lama tidak match. |
| Mengubah WSDL operation signature | Generated client lama rusak. |
| Mengubah SOAP fault detail type | Fault handling lama gagal. |

### 7.4 Enum evolution: jebakan klasik

Contoh:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Lalu provider menambah:

```text
PENDING_EXTERNAL_AGENCY
```

Consumer lama bisa:

- gagal deserialize;
- masuk default branch yang salah;
- menampilkan blank;
- memperlakukan sebagai rejected;
- memicu workflow salah.

Pattern yang lebih aman:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
    UNKNOWN;

    public static CaseStatus fromExternal(String value) {
        try {
            return CaseStatus.valueOf(value);
        } catch (IllegalArgumentException ex) {
            return UNKNOWN;
        }
    }
}
```

Namun jangan overgeneralize. Untuk beberapa domain, unknown enum harus fail fast karena bisa membahayakan keputusan regulatory. Yang penting adalah kontrak menyatakan policy:

```text
Unknown status values must be treated as non-terminal and displayed as "Pending / Unknown".
They must not be interpreted as APPROVED or REJECTED.
```

### 7.5 Numeric compatibility

Contoh breaking halus:

```json
{"amount": 100.00}
```

Consumer A pakai `BigDecimal`, consumer B pakai `double`, consumer C pakai JavaScript number.

Risiko:

- precision loss;
- trailing zero semantics hilang;
- currency minor unit salah;
- scientific notation diterima oleh satu parser, ditolak parser lain;
- large integer ID berubah saat lewat JavaScript.

Untuk ID besar, lebih aman gunakan string:

```json
{"transactionId": "90071992547409931234"}
```

Untuk uang:

```json
{
  "amount": "123.45",
  "currency": "SGD"
}
```

atau:

```json
{
  "amountMinorUnits": 12345,
  "currency": "SGD"
}
```

Pilih satu dan dokumentasikan.

---

## 8. Versioning: Jangan Mulai Setelah Terlambat

### 8.1 Tiga jenis versioning

| Jenis | Contoh | Kapan dipakai |
|---|---|---|
| Endpoint version | `/api/v1/cases` | HTTP/REST JSON API |
| Namespace version | `http://example.com/case/v1` | XML/XSD/SOAP |
| Field-level capability | `supportedFeatures: [...]` | Evolusi granular |

### 8.2 JSON versioning

Contoh endpoint version:

```text
POST /api/v1/applications
POST /api/v2/applications
```

Contoh media type version:

```http
Accept: application/vnd.company.application-v2+json
Content-Type: application/vnd.company.application-v2+json
```

Contoh payload version:

```json
{
  "schemaVersion": "1.2",
  "applicationNo": "A-001",
  "status": "SUBMITTED"
}
```

Tidak ada satu cara yang selalu benar. Pilih berdasarkan:

- kontrol atas consumer;
- kebutuhan routing;
- observability;
- backward compatibility;
- gateway/API management;
- caching;
- support window.

### 8.3 XML namespace versioning

Contoh:

```xml
<case:Application xmlns:case="https://example.gov/schema/case/v1">
  <case:ApplicationNo>A-001</case:ApplicationNo>
</case:Application>
```

Versi baru:

```xml
<case:Application xmlns:case="https://example.gov/schema/case/v2">
  <case:ApplicationNo>A-001</case:ApplicationNo>
  <case:Priority>NORMAL</case:Priority>
</case:Application>
```

Namespace versioning jelas, tetapi bisa berat karena binding Java biasanya tergantung namespace.

### 8.4 WSDL versioning

Untuk SOAP, perubahan besar biasanya lebih aman dengan WSDL baru:

```text
ApplicationServiceV1.wsdl
ApplicationServiceV2.wsdl
```

atau endpoint baru:

```text
/soap/application/v1
/soap/application/v2
```

Jangan diam-diam mengubah WSDL lama jika consumer menggunakan generated client. Banyak client menganggap WSDL sebagai compile-time contract.

### 8.5 Support window

Versioning tanpa support window hanyalah penundaan masalah.

Dokumentasikan:

```text
v1 supported until: 2027-12-31
v2 available from: 2026-07-01
Breaking changes require at least 6 months migration notice.
Security-critical changes may use emergency migration path.
```

---

## 9. Contract Governance: Yang Membedakan Sistem Mainan dan Sistem Enterprise

### 9.1 Contract owner

Setiap kontrak perlu owner.

Tanpa owner, keputusan perubahan kontrak menjadi informal:

- “FE butuh field baru.”
- “Vendor minta ganti enum.”
- “DB rename kolom.”
- “Generated class berubah setelah update plugin.”

Owner bertanggung jawab atas:

- versioning;
- compatibility policy;
- review breaking change;
- deprecation;
- changelog;
- consumer communication;
- sample payload;
- contract tests.

### 9.2 Contract review checklist

Sebelum merge perubahan DTO/schema/WSDL:

```text
[ ] Apakah field baru optional atau required?
[ ] Apa default behavior untuk consumer lama?
[ ] Apakah unknown field/value aman?
[ ] Apakah enum bertambah?
[ ] Apakah date/time format berubah?
[ ] Apakah numeric precision berubah?
[ ] Apakah namespace berubah?
[ ] Apakah generated client lama akan rusak?
[ ] Apakah error code baru terdokumentasi?
[ ] Apakah retry semantics berubah?
[ ] Apakah sample payload updated?
[ ] Apakah contract test updated?
[ ] Apakah migration note tersedia?
```

### 9.3 Changelog kontrak

Changelog yang berguna bukan seperti ini:

```text
- Update API.
```

Tetapi seperti ini:

```text
2026-07-01 — v1.3
- Added optional field `externalAgencyReference` to SubmitCaseResponse.
- Existing consumers may ignore this field.
- Field is populated only for cases routed to external agency.
- No request contract change.
- No error contract change.
```

Untuk breaking change:

```text
2026-10-01 — v2.0
- Replaced `submittedAt` format from local date-time to RFC 3339 offset date-time.
- v1 accepted: `2026-06-17 10:00:00`
- v2 requires: `2026-06-17T10:00:00+07:00`
- v1 endpoint remains supported until 2027-03-31.
- Migration: clients must include timezone offset.
```

---

## 10. Consumer-Driven Thinking

### 10.1 Provider tidak tahu semua asumsi consumer

Provider sering berpikir:

> “Saya cuma tambah enum value, harusnya aman.”

Consumer mungkin punya logic:

```java
switch (status) {
    case APPROVED -> showCertificate();
    case REJECTED -> showAppealButton();
    case SUBMITTED -> showPending();
}
```

Jika enum baru muncul, behavior bisa gagal.

### 10.2 Consumer-driven contract testing

Consumer-driven contract test berarti consumer menyatakan ekspektasi minimal yang harus dipenuhi provider.

Contoh ekspektasi consumer:

```text
When a submitted case exists,
GET /cases/{id} returns:
- caseId as non-empty string
- status one of SUBMITTED, APPROVED, REJECTED, UNKNOWN
- submittedAt as ISO offset date-time
```

Provider menjalankan test itu dalam pipeline agar tidak memecahkan consumer.

### 10.3 Tolerant reader pattern

Tolerant reader berarti consumer tidak terlalu kaku terhadap tambahan yang tidak relevan.

Prinsip:

```text
Consumer should read only what it needs.
Consumer should ignore unknown fields when safe.
Consumer should fail fast only for fields that affect correctness.
```

Contoh JSON-B/Jackson policy akan dibahas detail nanti. Di level kontrak, policy-nya harus eksplisit.

### 10.4 Robust writer pattern

Provider harus menulis payload yang stabil dan tidak mengejutkan.

Prinsip:

```text
Provider should not emit random field order if signature/canonicalization matters.
Provider should not emit null for fields historically absent unless contract says so.
Provider should not change number/date formatting casually.
Provider should not overload one field with multiple meanings.
```

---

## 11. Anti-Pattern Besar dalam Contract Design

### 11.1 DTO sebagai domain model

Gejala:

- DTO punya business method kompleks.
- Entity punya annotation JSON/XML/SOAP.
- Field internal muncul di API.
- Breaking API terjadi saat refactor DB/domain.

Solusi:

- Pisahkan external DTO, application command, domain model, persistence model.
- Gunakan mapper eksplisit.
- Buat contract test.

### 11.2 Shared canonical model yang terlalu besar

Banyak enterprise mencoba membuat satu canonical model untuk semua sistem:

```text
EnterpriseCustomer
EnterpriseCase
EnterpriseDocument
EnterpriseTransaction
```

Awalnya terlihat rapi. Lama-lama menjadi monster:

- ratusan field;
- banyak nullable;
- semua sistem hanya pakai subset;
- perubahan satu consumer memengaruhi semua;
- semantic konflik;
- model terlalu general untuk invariant lokal.

Canonical model tidak selalu salah. Yang salah adalah menjadikannya pusat segala makna.

Lebih baik:

```text
Context-specific contract
  + explicit mapping
  + shared vocabulary where useful
  + canonical reference data where stable
```

### 11.3 Stringly typed integration

Contoh:

```json
{
  "status": "1",
  "type": "A",
  "flag": "Y",
  "amount": "100.00",
  "date": "20260617"
}
```

Kadang legacy memaksa seperti ini. Tetapi jangan biarkan stringly typed masuk domain.

Buat value object:

```java
public record ExternalStatusCode(String value) {}
public record Money(BigDecimal amount, Currency currency) {}
public record AgencyLocalDate(LocalDate value) {}
```

### 11.4 Silent defaulting

Contoh:

```java
boolean urgent = request.urgent() != null && request.urgent();
```

Jika `urgent` absent karena bug client, sistem diam-diam menganggap false.

Lebih baik:

- bedakan absent/null/false;
- validasi required field;
- log contract violation;
- gunakan default hanya jika kontrak menyatakan default.

### 11.5 Overloading field

Contoh:

```json
{
  "referenceNo": "A-001"
}
```

Kadang berarti application number, kadang payment reference, kadang external agency reference.

Solusi:

```json
{
  "applicationNo": "A-001",
  "paymentReferenceNo": "P-999",
  "externalAgencyReferenceNo": "EXT-123"
}
```

Lebih verbose, tetapi lebih defensible.

### 11.6 Breaking change disguised as cleanup

Contoh:

- rename `licenceNo` ke `licenseNo` karena spelling;
- ubah `dateOfBirth` dari `dd/MM/yyyy` ke ISO tanpa v2;
- ubah enum `PENDING` ke `PENDING_REVIEW`;
- hapus field deprecated sebelum support window selesai;
- ubah namespace tanpa endpoint baru.

Dalam kontrak eksternal, “cleaner” tidak otomatis lebih benar. Stability sering lebih penting daripada elegance.

---

## 12. Decision Matrix: JSON, XML, SOAP, atau JCA?

### 12.1 JSON cocok jika

Gunakan JSON jika:

- API HTTP modern;
- frontend/browser/mobile consumer;
- payload mostly data-centric;
- contract bisa dikelola via OpenAPI/JSON Schema/prose;
- tidak butuh XML Signature/WS-Security;
- tidak banyak namespace/schema composition;
- consumer bisa tolerate unknown fields;
- latency dan developer velocity penting.

Contoh:

```text
Case search API
Application draft save API
Internal microservice command
Event notification payload
```

### 12.2 XML/XSD cocok jika

Gunakan XML/XSD jika:

- dokumen formal;
- struktur kompleks dan nested;
- namespace penting;
- schema validation kuat dibutuhkan;
- integrasi antar organisasi long-lived;
- payload harus mengikuti standard eksternal;
- ada kebutuhan transformasi XSLT/XPath;
- regulatory exchange berbasis XML.

Contoh:

```text
Government document exchange
Licensing declaration XML
Legacy batch submission
Schema-governed regulatory report
```

### 12.3 SOAP/WSDL cocok jika

Gunakan SOAP/WSDL jika:

- partner hanya menyediakan SOAP;
- contract-first enterprise integration;
- typed faults penting;
- WS-Security/WS-Addressing/WS-Policy dibutuhkan;
- existing ecosystem B2B/government sudah SOAP;
- code generation dari WSDL menjadi requirement;
- audit/interoperability lebih penting daripada simplicity.

Contoh:

```text
Legacy payment gateway SOAP
Government agency web service
Enterprise master data service
External compliance submission service
```

### 12.4 Jakarta Connectors/JCA cocok jika

Gunakan JCA jika:

- integrasi ke Enterprise Information System non-HTTP;
- butuh connection management container;
- butuh transaction/security contract dengan app server;
- inbound message endpoint dari EIS;
- resource adapter vendor tersedia;
- workload enterprise bukan sekadar REST call.

Contoh:

```text
Mainframe adapter
ERP/EIS connector
Legacy messaging system adapter
Transactional inbound/outbound enterprise resource
```

Jakarta Connectors mendefinisikan arsitektur untuk menghubungkan Jakarta EE server ke Enterprise Information Systems melalui resource adapter, connection management, transaction management, dan security contracts.  
Sumber: Jakarta Connectors — https://jakarta.ee/specifications/connectors/

### 12.5 Ringkasan pilihan

| Kebutuhan | Pilihan utama |
|---|---|
| API modern untuk frontend | JSON |
| Contract formal lintas organisasi | XML/XSD atau SOAP/WSDL |
| Legacy enterprise service | SOAP/WSDL |
| Dokumen dengan schema kuat | XML/XSD |
| Binary besar di SOAP | MTOM/SAAJ |
| EIS transactional adapter | JCA |
| Internal event simple | JSON |
| Regulatory long-lived format | XML/XSD |
| Message-level security standard | SOAP WS-Security |

---

## 13. Java Binding Layer: Jangan Salah Memilih Alat

### 13.1 JSON-P

Jakarta JSON Processing mendefinisikan framework Java untuk parsing, generating, transforming, dan querying JSON documents. JSON-P menyediakan object model dan streaming model.  
Sumber: Jakarta JSON Processing — https://jakarta.ee/specifications/jsonp/

Gunakan JSON-P ketika:

- ingin manipulasi JSON tree tanpa DTO;
- perlu streaming large JSON;
- membuat patch/merge/diff;
- butuh API standar Jakarta;
- ingin menghindari binding otomatis.

### 13.2 JSON-B

Jakarta JSON Binding mendefinisikan binding framework untuk mengonversi Java objects ke/dari JSON documents.  
Sumber: Jakarta JSON Binding — https://jakarta.ee/specifications/jsonb/

Gunakan JSON-B ketika:

- ingin object mapping standar Jakarta;
- DTO sederhana;
- integrasi Jakarta REST;
- ingin portability antar Jakarta runtime;
- custom adapter cukup untuk kebutuhan.

### 13.3 Jackson/Gson

Walaupun bukan fokus spesifikasi Jakarta, di dunia Java modern Jackson sangat umum, terutama Spring Boot.

Gunakan Jackson ketika:

- ecosystem Spring;
- butuh fitur luas;
- polymorphism/customization kompleks;
- performance tuning matang;
- modul Java time, Kotlin, afterburner, etc.

Namun dalam seri ini kita tetap fokus pada JSON-P/JSON-B sebagai standard Jakarta, sambil membandingkan dengan Jackson saat relevan.

### 13.4 JAXB / Jakarta XML Binding

Jakarta XML Binding menyediakan API dan tools untuk otomatisasi mapping antara XML documents dan Java objects.  
Sumber: Jakarta XML Binding 4.0 — https://jakarta.ee/specifications/xml-binding/4.0/

Gunakan JAXB ketika:

- XML schema-first;
- generate Java classes dari XSD;
- marshal/unmarshal XML;
- SOAP data binding;
- integrasi legacy XML;
- perlu annotation-based XML mapping.

### 13.5 JAX-WS / Jakarta XML Web Services

Jakarta XML Web Services mendefinisikan cara implementasi XML-based Web Services berbasis SOAP with Attachments dan Web Services Metadata.  
Sumber: Jakarta XML Web Services 4.0 — https://jakarta.ee/specifications/xml-web-services/4.0/

Gunakan JAX-WS ketika:

- expose atau consume SOAP service;
- WSDL-first/codegen workflow;
- typed SOAP fault;
- handler chain;
- SOAP binding;
- WS-* integration.

---

## 14. Contract Boundary Architecture

### 14.1 Recommended architecture

```text
┌────────────────────────────────────────────────────────────┐
│ External System                                             │
│ JSON / XML / SOAP / EIS                                     │
└───────────────────────┬────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────┐
│ Transport Adapter                                           │
│ HTTP client/server, SOAP endpoint/client, JCA adapter        │
└───────────────────────┬────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────┐
│ Format Binding Layer                                        │
│ JSON-P, JSON-B, JAXB, JAX-WS, SAAJ, custom parser            │
└───────────────────────┬────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────┐
│ Contract Validation Layer                                   │
│ schema validation, required fields, semantic preconditions   │
└───────────────────────┬────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────┐
│ Anti-Corruption Mapper                                      │
│ external DTO/code/value mapping → application command        │
└───────────────────────┬────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────┐
│ Application / Domain Layer                                  │
│ use case orchestration, invariant enforcement               │
└───────────────────────┬────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────┐
│ Outbound Contract Mapper                                    │
│ domain outcome → external response/event/fault              │
└────────────────────────────────────────────────────────────┘
```

### 14.2 Kenapa mapping eksplisit penting

Mapping eksplisit terlihat verbose, tetapi memberi kontrol:

- normalize external code;
- validate required semantics;
- convert timezone;
- protect domain invariant;
- log invalid external input;
- support multiple contract versions;
- handle legacy quirks;
- isolate Javax/Jakarta migration.

### 14.3 Package structure contoh

```text
com.example.caseapp
├─ application
│  ├─ SubmitCaseUseCase.java
│  └─ SubmitCaseCommand.java
├─ domain
│  ├─ Case.java
│  ├─ CaseStatus.java
│  └─ ApplicantId.java
├─ integration
│  ├─ restjson
│  │  ├─ v1
│  │  │  ├─ SubmitCaseRequestV1.java
│  │  │  ├─ SubmitCaseResponseV1.java
│  │  │  └─ SubmitCaseJsonMapper.java
│  │  └─ v2
│  ├─ soapagency
│  │  ├─ generated
│  │  ├─ AgencySoapClient.java
│  │  └─ AgencySoapMapper.java
│  └─ xmlbatch
│     ├─ generated
│     ├─ BatchXmlParser.java
│     └─ BatchXmlMapper.java
└─ infrastructure
   └─ observability
```

Jangan campur generated SOAP/JAXB classes langsung ke domain package.

---

## 15. Designing for Failure

### 15.1 Failure taxonomy

Integrasi format/contract bisa gagal di banyak lapisan:

| Lapisan | Contoh failure |
|---|---|
| Transport | timeout, TLS error, DNS, HTTP 502 |
| Framing | invalid MIME boundary, truncated payload |
| Format | invalid JSON/XML syntax |
| Schema | missing required element, invalid type |
| Binding | cannot deserialize date/enum/polymorphic type |
| Semantic | invalid lifecycle transition |
| Authorization | caller not allowed for case type |
| Idempotency | duplicate request unclear |
| Downstream | external SOAP service unavailable |
| Reconciliation | provider accepted but response lost |

Top engineer mendesain response/retry/logging berbeda per lapisan.

### 15.2 Parse failure vs validation failure

Parse failure:

```text
Payload tidak bisa dibaca sebagai JSON/XML.
HTTP 400 / SOAP Client Fault.
Tidak masuk business logic.
```

Validation failure:

```text
Payload valid secara format, tetapi melanggar contract/schema/semantic.
HTTP 422/400 tergantung convention / SOAP modeled fault.
```

Business failure:

```text
Payload valid, tetapi use case tidak bisa dipenuhi.
Contoh: application already approved.
```

Operational failure:

```text
Sistem gagal memproses karena dependency/runtime.
HTTP 503/500 / SOAP Server Fault.
Retry mungkin boleh.
```

Jangan campur semuanya menjadi `500 Internal Server Error`.

### 15.3 Retryability harus eksplisit

Contoh:

| Error | Retry? | Catatan |
|---|---|---|
| Invalid JSON | Tidak | Client harus fix payload. |
| Unknown required enum | Tidak/Manual | Tergantung domain. |
| Timeout sebelum accepted | Mungkin | Butuh idempotency/reconciliation. |
| Timeout setelah accepted | Jangan blind retry | Bisa duplicate. |
| Downstream 503 | Ya dengan backoff | Jika operation idempotent. |
| Duplicate submission | Tidak | Return existing result jika idempotency key sama. |

### 15.4 Idempotency sebagai bagian kontrak

Untuk command seperti submit/payment/create, kontrak perlu idempotency.

Contoh HTTP:

```http
Idempotency-Key: 01JZABC...
```

Contoh payload:

```json
{
  "requestId": "01JZABC...",
  "applicationNo": "A-001"
}
```

Contoh SOAP header:

```xml
<soap:Header>
  <req:RequestId xmlns:req="https://example.gov/request">01JZABC...</req:RequestId>
</soap:Header>
```

Tanpa idempotency, retry policy bisa menciptakan duplicate cases, duplicate payments, duplicate notifications, atau inconsistent audit trail.

---

## 16. Security Implications of Contract Design

### 16.1 Format-level security

JSON risks:

- deeply nested JSON causing stack/memory pressure;
- huge arrays;
- duplicate keys;
- numeric overflow;
- unknown field abuse;
- injection into logs/templates;
- polymorphic deserialization vulnerability if unsafe library config.

XML risks:

- XXE;
- entity expansion/billion laughs;
- XInclude abuse;
- external schema retrieval SSRF;
- XPath injection;
- XML Signature Wrapping;
- canonicalization mistakes;
- oversized documents.

### 16.2 Contract-level security

Kontrak harus membatasi:

- maximum payload size;
- maximum nesting depth;
- maximum array length;
- maximum string length;
- allowed content types;
- allowed character sets;
- attachment count/size;
- known enum values or unknown policy;
- external entity disabled;
- schema location trust policy.

### 16.3 Sensitive data and audit

Kontrak juga harus menyatakan data classification:

```text
Field: nric
Classification: Restricted / PII
Logging: Must be masked except last 4 chars
Storage: Encrypted at rest
Transmission: TLS required
Audit: Access logged
Retention: 7 years
```

Jangan biarkan logging framework otomatis mencetak DTO lengkap.

Contoh buruk:

```java
log.info("Request received: {}", request);
```

Lebih baik:

```java
log.info("SubmitCase request received: requestId={}, applicantIdHash={}, caseType={}",
        request.requestId(),
        hashForLog(request.applicantId()),
        request.caseType());
```

---

## 17. Testing Contract Like a Serious Engineer

### 17.1 Golden sample tests

Simpan sample payload valid dan invalid.

```text
src/test/resources/contracts/submit-case/v1/valid-minimal.json
src/test/resources/contracts/submit-case/v1/valid-full.json
src/test/resources/contracts/submit-case/v1/invalid-missing-case-type.json
src/test/resources/contracts/submit-case/v1/invalid-date-no-timezone.json
```

Test:

```java
@Test
void validMinimalPayloadStillParses() {
    String json = readResource("contracts/submit-case/v1/valid-minimal.json");
    SubmitCaseRequestV1 request = jsonb.fromJson(json, SubmitCaseRequestV1.class);
    assertThat(request.caseType()).isEqualTo("NEW");
}
```

### 17.2 Round-trip tests

Round-trip test memastikan serialize→deserialize stabil.

```java
@Test
void responseRoundTripKeepsContractFields() {
    SubmitCaseResponseV1 response = new SubmitCaseResponseV1("C-001", "SUBMITTED");

    String json = jsonb.toJson(response);
    SubmitCaseResponseV1 parsed = jsonb.fromJson(json, SubmitCaseResponseV1.class);

    assertThat(parsed).isEqualTo(response);
}
```

Tetapi hati-hati: round-trip bisa memberi rasa aman palsu karena producer dan consumer memakai library yang sama. Tambahkan sample dari real consumer/provider.

### 17.3 Backward compatibility tests

Simpan payload versi lama dan pastikan masih diterima.

```text
contracts/archive/v1.0/*.json
contracts/archive/v1.1/*.json
contracts/archive/v1.2/*.json
```

Setiap perubahan DTO/schema harus menjalankan test terhadap archive.

### 17.4 Unknown field tests

```json
{
  "caseId": "C-001",
  "status": "SUBMITTED",
  "futureField": "should be ignored if policy says tolerant"
}
```

Test policy:

```java
@Test
void unknownFieldIsIgnoredForForwardCompatibility() {
    String json = """
        {
          "caseId": "C-001",
          "status": "SUBMITTED",
          "futureField": "x"
        }
        """;

    CaseResponse response = jsonb.fromJson(json, CaseResponse.class);
    assertThat(response.caseId()).isEqualTo("C-001");
}
```

Jika policy adalah strict, test harus sebaliknya.

### 17.5 SOAP/WSDL compatibility tests

Untuk SOAP:

- simpan WSDL baseline;
- simpan generated classes checksum atau API surface;
- test sample SOAP request/response;
- test SOAP Fault detail;
- test namespace;
- test generated client terhadap mock server;
- test real WSDL import/include resolution.

### 17.6 Schema validation tests

Untuk XML:

```java
SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
Schema schema = factory.newSchema(new File("application-v1.xsd"));
Validator validator = schema.newValidator();
validator.validate(new StreamSource(new File("valid-application.xml")));
```

Part XML security nanti akan membahas secure configuration detail.

---

## 18. Practical Design Exercise

Bayangkan Anda perlu membuat integrasi submit application ke external agency.

### 18.1 Requirement awal

```text
Our system submits application data to Agency B.
Agency B returns reference number and status.
Some applications include documents.
Agency B may process asynchronously.
There must be audit trail.
```

Pertanyaan top engineer:

1. Apakah Agency B menyediakan contract existing?
2. JSON, XML, SOAP, SFTP batch, atau JCA/EIS?
3. Apakah submit synchronous atau accepted-for-processing?
4. Apakah response final atau hanya acknowledgement?
5. Bagaimana duplicate submission dicegah?
6. Apakah documents dikirim inline base64, multipart, MTOM, atau pre-signed URL?
7. Apakah schema versioning tersedia?
8. Apa error codes dan retry semantics?
9. Apa maximum payload/document size?
10. Apa audit/correlation ID?
11. Apa support window bila contract berubah?
12. Bagaimana reconciliation jika timeout?

### 18.2 Contract sketch JSON

```json
{
  "schemaVersion": "1.0",
  "requestId": "01JZABCDEF1234567890",
  "applicationNo": "A-2026-00001",
  "applicationType": "NEW",
  "submittedAt": "2026-06-17T10:00:00+07:00",
  "applicant": {
    "applicantId": "S1234567D",
    "name": "Alice Tan"
  },
  "documents": [
    {
      "documentId": "DOC-001",
      "documentType": "IDENTITY_PROOF",
      "sha256": "...",
      "downloadUrl": "https://..."
    }
  ]
}
```

Contract notes:

```text
- requestId is mandatory and idempotent for 24 hours.
- submittedAt must include timezone offset.
- applicationType unknown values must be rejected.
- documents may be empty.
- document downloadUrl expires after 15 minutes.
- provider must not log applicantId in plaintext.
```

### 18.3 Contract sketch SOAP

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:req="https://example.gov/application/v1">
  <soap:Header>
    <req:RequestId>01JZABCDEF1234567890</req:RequestId>
  </soap:Header>
  <soap:Body>
    <req:SubmitApplicationRequest>
      <req:ApplicationNo>A-2026-00001</req:ApplicationNo>
      <req:ApplicationType>NEW</req:ApplicationType>
      <req:SubmittedAt>2026-06-17T10:00:00+07:00</req:SubmittedAt>
    </req:SubmitApplicationRequest>
  </soap:Body>
</soap:Envelope>
```

Contract notes:

```text
- RequestId header is mandatory.
- SOAP Fault detail must include stable errorCode.
- WSDL v1 namespace remains stable for v1 support window.
- Attachments use MTOM, not inline base64, for documents over 1 MB.
```

---

## 19. Migration Mindset Java 8 → 25

### 19.1 Do not let runtime migration mutate public contract

Jika migrasi Java 8 → 21 mengubah JAXB implementation, JSON-B provider, atau JAX-WS runtime, pastikan payload tetap sama.

Checklist:

```text
[ ] Sample JSON output byte/semantic compatibility checked.
[ ] XML namespace unchanged.
[ ] Date/time format unchanged.
[ ] Null/absent behavior unchanged.
[ ] Field/element order unchanged if partner depends on it.
[ ] SOAPAction unchanged if required.
[ ] WSDL unchanged unless planned version bump.
[ ] Fault detail unchanged.
[ ] Generated classes regenerated deterministically.
[ ] Dependency uses javax or jakarta consistently.
```

### 19.2 Javax/Jakarta bridge strategy

Untuk legacy Java 8/Java EE:

```text
javax.* API likely common.
```

Untuk Jakarta EE 9+:

```text
jakarta.* API expected.
```

Strategi aman:

- jangan campur DTO `javax.xml.bind.annotation.*` dan runtime `jakarta.xml.bind.*`;
- regenerate JAXB/JAX-WS artifacts sesuai target namespace API;
- isolasi generated code per module;
- gunakan adapter module untuk SOAP legacy;
- buat contract tests sebelum migrasi dependency;
- hindari exposing generated class ke core domain.

### 19.3 Explicit dependency principle

Di Java 11+, jangan mengandalkan JDK menyediakan JAXB/JAX-WS/SAAJ.

Prinsip:

```text
If your code imports it, your build must declare it.
If your runtime needs implementation, your deployment must provide it.
If your server provides it, document the feature/version.
```

---

## 20. “Top 1%” Mental Models dari Part Ini

### 20.1 Contract is a product

Kontrak eksternal punya user: consumer system dan tim yang mengoperasikannya.

Raw DTO bukan product. Kontrak yang baik punya:

- documentation;
- examples;
- versioning;
- changelog;
- error semantics;
- test artifacts;
- migration policy;
- owner.

### 20.2 Compatibility is a feature

Backward compatibility bukan pekerjaan tambahan. Ia adalah fitur utama integrasi enterprise.

Jika feature baru merusak consumer lama, feature itu belum selesai.

### 20.3 Binding is replaceable, semantics are not

JSON-B bisa diganti Jackson. JAXB RI bisa diganti MOXy. JAX-WS runtime bisa diganti Metro/vendor runtime.

Tetapi semantic contract tidak boleh berubah diam-diam.

### 20.4 Be strict at boundary, tolerant at evolution points

Tidak semua harus strict, tidak semua harus tolerant.

```text
Strict:
  required identity, money amount, lifecycle transition, security-sensitive enum.

Tolerant:
  additional metadata, optional display fields, future non-critical extension.
```

### 20.5 Legacy is often a contract asset, not just technical debt

SOAP/WSDL/XML legacy sering menyimpan institutional agreement lintas organisasi. Menghapusnya tanpa memahami contract semantics bisa lebih berisiko daripada mempertahankannya dengan adapter yang baik.

---

## 21. Ringkasan

Part ini membangun fondasi bahwa JSON/XML/SOAP/JCA bukan sekadar teknologi serialization, tetapi contract boundary.

Poin utama:

1. Data format adalah permukaan kontrak antar sistem.
2. Pisahkan format, schema, binding, dan semantic contract.
3. JSON cocok untuk API modern, tetapi butuh governance untuk schema, null, enum, date, dan numeric precision.
4. XML/XSD kuat untuk kontrak formal dan dokumen kompleks, tetapi butuh security discipline.
5. SOAP/WSDL masih rasional untuk integrasi enterprise legacy, typed fault, dan WS-* ecosystem.
6. JCA relevan untuk EIS/resource adapter, bukan sekadar HTTP API.
7. Java 8–25 menuntut dependency eksplisit dan perhatian migrasi Javax→Jakarta.
8. Boundary DTO tidak boleh menjadi domain model.
9. Compatibility, versioning, error semantics, dan idempotency adalah bagian dari kontrak.
10. Contract test dan sample archive harus menjadi bagian pipeline.

---

## 22. Latihan Mandiri

### Latihan 1 — Contract review

Ambil satu JSON API internal yang pernah Anda buat. Jawab:

```text
- Field mana yang required?
- Field mana yang optional?
- Apa beda absent dan null?
- Apa policy untuk unknown field?
- Apa policy untuk unknown enum?
- Date/time format apa yang dipakai?
- Numeric field mana yang tidak boleh double?
- Error code mana yang retryable?
- Apakah ada idempotency?
```

Jika sebagian besar tidak terdokumentasi, API itu belum punya contract matang.

### Latihan 2 — Breaking change detection

Untuk setiap perubahan berikut, tentukan aman atau breaking:

```text
1. Tambah optional field response.
2. Tambah required field request.
3. Rename submittedAt menjadi submittedDateTime.
4. Tambah enum PENDING_EXTERNAL_AGENCY.
5. Ubah amount dari string ke number.
6. Ubah XML namespace v1 ke v2.
7. Tambah SOAP Fault detail baru.
8. Ubah null field menjadi absent.
```

Jawaban tergantung consumer policy. Jelaskan asumsi Anda.

### Latihan 3 — Boundary mapping

Buat tiga model untuk satu use case:

```text
SubmitApplicationRequestV1  // external DTO
SubmitApplicationCommand    // application command
Application                 // domain entity/value model
```

Pastikan tidak ada annotation transport di domain model.

---

## 23. Referensi Resmi

- RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format: https://datatracker.ietf.org/doc/html/rfc8259
- Jakarta JSON Processing: https://jakarta.ee/specifications/jsonp/
- Jakarta JSON Binding: https://jakarta.ee/specifications/jsonb/
- W3C XML Schema Definition Language (XSD) 1.1 Part 1: https://www.w3.org/TR/xmlschema11-1/
- Jakarta XML Binding 4.0: https://jakarta.ee/specifications/xml-binding/4.0/
- Jakarta XML Web Services 4.0: https://jakarta.ee/specifications/xml-web-services/4.0/
- Jakarta Connectors: https://jakarta.ee/specifications/connectors/
- OpenJDK JEP 320 — Remove the Java EE and CORBA Modules: https://openjdk.org/jeps/320
- Oracle JDK 11 Migration Guide: https://docs.oracle.com/en/java/javase/11/migrate/
- Jakarta EE 11 Release: https://jakarta.ee/release/11/

---

## 24. Status Seri

- Part ini: **Part 1 — Data Format as Contract**.
- Status: **selesai**.
- Seri: **belum selesai**.
- Berikutnya: **Part 2 — Java JSON Ecosystem Map: JSON-P, JSON-B, Jackson, Gson, Yasson, Parsson, Jakarta REST Integration, Spring/Jakarta Coexistence**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-000.md">⬅️ Part 0 — Orientation & Mental Model: JSON, XML, SOAP, dan Jakarta Connectors untuk Java 8–25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-002.md">Part 2 — Java JSON Ecosystem Map: JSON-P, JSON-B, Jackson, Gson, Provider Runtime, dan Pilihan Library yang Benar ➡️</a>
</div>
