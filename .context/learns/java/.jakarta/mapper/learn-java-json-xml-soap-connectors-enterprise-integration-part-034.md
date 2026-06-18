# learn-java-json-xml-soap-connectors-enterprise-integration — Part 34
# Integration Architecture Capstone

> Seri: Java JSON, XML, SOAP, dan Jakarta Connectors Enterprise Integration  
> Part: 34 dari 34  
> Topik: Choosing JSON/XML/SOAP/JCA, migration matrix Java 8–25, production checklist, testing strategy, security/performance review, dan failure modeling tingkat arsitektur

---

## 0. Tujuan Part Ini

Part ini adalah bagian penutup. Setelah sebelumnya kita membahas JSON-P, JSON-B, XML, XSD, JAXB/Jakarta XML Binding, SOAP, WSDL, JAX-WS/Jakarta XML Web Services, WS-*, dan Jakarta Connectors/JCA secara detail, sekarang kita satukan semuanya menjadi kemampuan arsitektural.

Target part ini bukan membuat kamu hafal API baru. Targetnya adalah membuat kamu mampu menjawab pertanyaan yang lebih penting:

> Dalam sistem enterprise nyata, format/protokol/integration runtime mana yang harus dipilih, bagaimana migration dilakukan tanpa merusak kontrak, bagaimana failure dimodelkan, dan bagaimana integration layer dibuat defensible untuk jangka panjang?

Seorang engineer biasa biasanya berpikir:

> “Pakai JSON saja, SOAP sudah tua.”

Engineer lebih senior berpikir:

> “Tergantung kontrak, governance, partner capability, schema rigor, auditability, transactional boundary, reliability requirement, dan migration risk.”

Engineer top-level berpikir lebih jauh:

> “Integration design adalah desain kontrak antar organisasi, antar runtime, antar versi, antar failure domain, dan antar lifecycle. Format data hanya satu bagian kecil.”

---

## 1. Peta Besar Seluruh Seri

Seluruh seri ini sebenarnya membahas satu topik besar:

```text
External System Boundary
        |
        v
Data Contract
(JSON / XML / XSD / WSDL)
        |
        v
Parsing / Binding
(JSON-P / JSON-B / DOM / SAX / StAX / JAXB)
        |
        v
Protocol Runtime
(HTTP JSON / SOAP / JAX-WS / SAAJ / WS-*)
        |
        v
Enterprise Resource Boundary
(JCA / Resource Adapter / EIS)
        |
        v
Reliability, Security, Observability, Migration
```

Kalau dibuat lebih operasional:

| Layer | Pertanyaan Utama | Contoh Teknologi |
|---|---|---|
| Data representation | Data dikirim dalam bentuk apa? | JSON, XML, binary attachment |
| Contract | Struktur dan constraint disepakati bagaimana? | JSON Schema, XSD, WSDL, OpenAPI |
| Parsing | Data dibaca sebagai tree, stream, atau object? | JSON-P, DOM, SAX, StAX |
| Binding | Data dipetakan ke object Java bagaimana? | JSON-B, JAXB, Jackson |
| Protocol | Message dikirim dengan semantic apa? | REST/HTTP, SOAP, WS-* |
| Runtime | Siapa yang mengelola lifecycle, pooling, transaction? | Jakarta EE server, JAX-WS runtime, JCA container |
| Operation | Failure, retry, logging, audit, monitoring bagaimana? | tracing, DLQ, audit trail, health check |
| Evolution | Perubahan kontrak dikelola bagaimana? | versioning, compatibility test, schema diff |

Mental model utamanya:

> Integration bukan hanya tentang mengirim data. Integration adalah membuat dua sistem tetap bisa saling memahami meskipun berbeda bahasa, runtime, versi, ownership, deployment cadence, dan failure behavior.

---

## 2. Format, Binding, Protocol, dan Runtime Itu Berbeda

Kesalahan umum: mencampur semua istilah menjadi satu.

Contoh kalimat yang sering terdengar:

> “Service ini pakai SOAP, berarti XML.”

Benar tapi tidak lengkap. SOAP memakai XML sebagai message envelope, tetapi SOAP bukan sekadar XML. SOAP punya processing model, header, body, fault, binding, dan extension model.

Contoh lain:

> “Pakai JSON-B berarti API kita JSON.”

Tidak selalu. JSON-B hanya binding Java object ke/dari JSON. API contract tetap harus didefinisikan: field mana wajib, mana optional, apa arti null, bagaimana unknown field diperlakukan, bagaimana versioning dilakukan.

Pisahkan empat konsep ini:

```text
Format      = bentuk representasi data
Contract    = aturan struktur dan semantics data
Binding     = mapping antara data dan object
Protocol    = aturan komunikasi antar sistem
Runtime     = komponen yang menjalankan, mengelola, dan mengamankan komunikasi
```

Contoh:

| Skenario | Format | Contract | Binding | Protocol | Runtime |
|---|---|---|---|---|---|
| REST API modern | JSON | OpenAPI/JSON Schema/manual contract | JSON-B/Jackson | HTTP | Servlet/Jakarta REST/Spring |
| SOAP legacy | XML | WSDL + XSD | JAXB | SOAP over HTTP | JAX-WS/Metro/CXF |
| Large XML feed | XML | XSD/vendor spec | StAX/JAXB partial | SFTP/HTTP/batch | Batch job/container |
| Mainframe/EIS integration | Proprietary/XML/record | Vendor contract | custom/JCA CCI | native protocol | JCA resource adapter |
| Binary document SOAP | XML + MIME/binary | WSDL + MTOM policy | JAXB + DataHandler | SOAP MTOM | JAX-WS/SAAJ |

Top 1% engineer tidak memilih library dulu. Ia mengunci semantics dulu.

---

## 3. Decision Matrix: Kapan Pakai JSON, XML, SOAP, atau JCA?

### 3.1 Gunakan JSON Ketika...

JSON cocok ketika:

- client web/mobile membutuhkan payload ringan;
- model data relatif object-like;
- interoperability lintas bahasa penting;
- consumer tidak membutuhkan schema-heavy validation di transport layer;
- API lebih cocok dengan resource/event style daripada operation-contract style;
- evolusi field bisa dikelola dengan additive compatibility;
- tooling modern seperti OpenAPI, API gateway, REST client, logging, dan observability sudah matang.

Namun JSON lemah jika:

- contract semantics hanya disimpan di dokumentasi longgar;
- null vs absent tidak didefinisikan;
- numeric precision penting tetapi parser berbeda perilaku;
- duplicate keys tidak diproteksi;
- object binding terlalu permisif;
- field authorization tidak dirancang;
- perubahan field dianggap minor padahal consumer bergantung padanya.

Pola aman:

```text
Use JSON for flexible application APIs,
but enforce contract discipline through schema/docs/tests,
not through hope.
```

### 3.2 Gunakan JSON-P Ketika...

JSON-P cocok ketika:

- perlu membaca payload besar tanpa materialisasi object penuh;
- perlu membuat/memodifikasi JSON pada level tree/stream;
- perlu JSON Patch, JSON Pointer, Merge Patch;
- perlu canonical/deterministic JSON;
- ingin API standar Jakarta, bukan provider-specific;
- boundary code tidak cocok dipetakan langsung ke DTO.

Gunakan object model JSON-P untuk:

- payload kecil/menengah;
- transformasi tree;
- audit diff;
- patching.

Gunakan streaming JSON-P untuk:

- payload besar;
- partial extraction;
- data pipeline;
- defensive parsing.

### 3.3 Gunakan JSON-B Ketika...

JSON-B cocok ketika:

- mapping Java DTO ↔ JSON cukup natural;
- contract DTO stabil;
- aplikasi berada di ekosistem Jakarta EE;
- ingin binding standar vendor-neutral;
- tidak butuh fitur provider-specific Jackson yang kompleks.

Hindari JSON-B langsung ke domain entity. Lebih aman:

```text
External JSON
   -> Request DTO
   -> Validation
   -> Application Command
   -> Domain Model
```

JSON-B bukan authorization layer. Ia hanya binding layer.

### 3.4 Gunakan XML Ketika...

XML masih sangat relevan ketika:

- kontrak membutuhkan namespace;
- schema formal penting;
- dokumen memiliki struktur campuran element/attribute/text;
- sistem partner sudah XML-first;
- integration bersifat B2B/government/regulated;
- signature/encryption/canonicalization berbasis XML diperlukan;
- backward compatibility berbasis XSD sudah menjadi governance.

XML bukan “JSON yang verbose”. XML punya information model berbeda:

- element;
- attribute;
- namespace;
- QName;
- mixed content;
- entity;
- processing instruction;
- schema type;
- order significance.

### 3.5 Gunakan JAXB/Jakarta XML Binding Ketika...

JAXB cocok ketika:

- XML structure dapat dipetakan relatif stabil ke object graph;
- ada XSD formal;
- ingin schema-first development;
- perlu integrate dengan SOAP/JAX-WS;
- model XML besar tetapi bagian yang dibutuhkan cocok dibinding.

Hindari JAXB jika:

- XML sangat besar dan hanya perlu sedikit field;
- XML sangat dynamic/wildcard-heavy;
- security parser belum dikunci;
- `JAXBContext` dibuat ulang per request;
- classloader/migration `javax`/`jakarta` belum jelas.

Untuk payload besar, kombinasi yang sering lebih aman:

```text
StAX cursor
   -> identify relevant fragment
   -> JAXB unmarshal fragment
   -> process bounded object
```

### 3.6 Gunakan SOAP/JAX-WS Ketika...

SOAP cocok ketika:

- partner mewajibkan WSDL;
- contract operation harus formal;
- ada governance enterprise lama;
- WS-Security, WS-Addressing, WS-Policy, atau MTOM dibutuhkan;
- consumer banyak dan sudah tergantung WSDL;
- migration cost mengganti kontrak lebih tinggi daripada menjaga SOAP.

SOAP tidak otomatis buruk. Yang buruk adalah SOAP tanpa discipline:

- WSDL berubah diam-diam;
- timeout default tidak dikunci;
- retry tidak memahami idempotency;
- SOAP fault dianggap exception lokal;
- attachment dimuat penuh ke memory;
- security header dimanipulasi tanpa threat model.

### 3.7 Gunakan JCA/Jakarta Connectors Ketika...

JCA cocok ketika:

- integrasi ke Enterprise Information System butuh managed connection;
- connection pooling, transaction enlistment, security propagation, dan lifecycle harus dikelola container;
- adapter dipakai banyak aplikasi;
- resource punya native protocol kompleks;
- inbound message delivery dari EIS ke aplikasi butuh kontrak standar;
- XA/local transaction dan recovery adalah requirement.

Hindari JCA jika:

- integrasi hanya HTTP client sederhana;
- tidak ada container Jakarta EE yang mengelola resource adapter;
- tim tidak memiliki operational skill untuk resource adapter;
- lifecycle, pooling, transaction, dan security bisa lebih sederhana ditangani library/client modern.

Heuristic:

```text
If it is just a client library, don't force JCA.
If it is a managed enterprise resource with pooling/transaction/security/lifecycle, consider JCA.
```

---

## 4. Architecture Selection Framework

Gunakan pertanyaan berikut sebelum memilih teknologi:

### 4.1 Contract Questions

1. Apakah kontrak dimiliki internal atau external partner?
2. Apakah consumer bisa diubah bersamaan dengan provider?
3. Apakah schema formal wajib?
4. Apakah field order penting?
5. Apakah namespace penting?
6. Apakah null dan absent punya arti berbeda?
7. Apakah kontrak harus backward-compatible bertahun-tahun?
8. Apakah regulator/auditor perlu melihat contract history?
9. Apakah binary payload bagian dari kontrak?
10. Apakah kontrak harus mendukung extension point?

### 4.2 Runtime Questions

1. Payload size rata-rata dan maksimum berapa?
2. Apakah parsing full tree aman?
3. Apakah streaming diperlukan?
4. Apakah timeout sudah dikunci?
5. Apakah retry aman secara idempotency?
6. Apakah ada transaction boundary lintas resource?
7. Apakah connection pooling dikelola siapa?
8. Apakah credential berasal dari user, service account, atau container?
9. Apakah runtime harus support Java 8, 11, 17, 21, 25?
10. Apakah runtime masih memakai `javax.*` atau sudah `jakarta.*`?

### 4.3 Failure Questions

1. Apa yang terjadi jika partner lambat?
2. Apa yang terjadi jika partner mengirim payload valid schema tapi invalid business rule?
3. Apa yang terjadi jika partner mengirim duplicate key JSON?
4. Apa yang terjadi jika XML punya external entity?
5. Apa yang terjadi jika SOAP fault ambigu?
6. Apa yang terjadi jika response berhasil tapi client timeout?
7. Apa yang terjadi jika retry membuat duplicate transaction?
8. Apa yang terjadi jika schema berubah tanpa pemberitahuan?
9. Apa yang terjadi jika certificate expired?
10. Apa yang terjadi jika connector pool habis?

### 4.4 Governance Questions

1. Siapa owner kontrak?
2. Bagaimana contract change disetujui?
3. Bagaimana compatibility dites?
4. Bagaimana sample request/response disimpan?
5. Bagaimana schema/WSDL/version disimpan?
6. Bagaimana breaking change diumumkan?
7. Bagaimana deprecation window dikelola?
8. Bagaimana observability per partner?
9. Bagaimana audit trail request/response disanitasi?
10. Bagaimana incident diklasifikasikan: parsing, contract, protocol, business, infra?

---

## 5. Java 8 sampai Java 25: Migration Matrix

### 5.1 Perubahan Besar yang Harus Diingat

Pada Java 8, banyak tim terbiasa memakai JAXB/JAX-WS/SAAJ seolah-olah bagian natural dari JDK. Sejak Java 11, modul Java EE dan CORBA seperti JAXB/JAX-WS/SAAJ dihapus dari JDK melalui JEP 320. Artinya aplikasi modern harus membawa dependency eksplisit untuk XML Binding, XML Web Services, Activation, dan SOAP Attachments jika masih dibutuhkan.

Selain itu, namespace berpindah:

```text
Java EE / Jakarta EE 8 era:
javax.xml.bind.*
javax.xml.ws.*
javax.xml.soap.*
javax.json.*
javax.json.bind.*
javax.resource.*

Jakarta EE 9+ era:
jakarta.xml.bind.*
jakarta.xml.ws.*
jakarta.xml.soap.*
jakarta.json.*
jakarta.json.bind.*
jakarta.resource.*
```

Migrasi ini bukan sekadar search-replace. Risiko muncul pada:

- generated source dari XJC/wsimport;
- annotation package;
- runtime provider;
- application server version;
- transitive dependency;
- Maven plugin;
- JPMS module name;
- classloader isolation;
- library yang masih `javax`;
- partner SOAP client/server yang dikompilasi dengan versi lama.

### 5.2 Matrix Praktis

| Area | Java 8 | Java 11+ | Java 17/21/25 Modern Practice |
|---|---|---|---|
| JAXB/XML Binding | Sering tersedia dari JDK lama | Harus dependency eksplisit | Gunakan Jakarta XML Binding atau JAXB RI sesuai namespace target |
| JAX-WS/XML Web Services | Sering tersedia dari JDK lama | Harus runtime/tool eksplisit | Gunakan Metro/CXF/vendor runtime; lock generated code |
| SAAJ | Terkait Java EE stack lama | Harus dependency eksplisit | Gunakan hanya saat perlu message-level manipulation |
| JSON-P | Jakarta/Java EE API | Dependency/container API | Gunakan `jakarta.json` untuk Jakarta EE 9+ |
| JSON-B | Jakarta/Java EE API | Dependency/container API | Gunakan provider seperti Yasson bila cocok |
| JCA | App server feature | Tergantung server | Gunakan hanya bila container-managed integration dibutuhkan |
| JPMS | Belum relevan luas | Mulai berdampak | Hindari split package; test module/classpath behavior |
| Native image | Tidak umum | Mulai dipakai | Binding/reflection perlu config eksplisit |

### 5.3 Rule of Thumb Migration

Jangan migrasi semuanya sekaligus.

Urutan lebih aman:

```text
1. Lock contract artifacts
   - XSD
   - WSDL
   - sample JSON/XML
   - compatibility tests

2. Externalize dependencies
   - JAXB
   - JAX-WS
   - SAAJ
   - Activation
   - JSON-P/JSON-B provider

3. Stabilize runtime behavior
   - timeouts
   - parser security
   - context caching
   - classloader checks

4. Migrate namespace deliberately
   - javax branch
   - jakarta branch
   - generated source regeneration

5. Validate interop
   - partner test
   - golden message test
   - security header test
   - fault test

6. Deploy behind compatibility facade if needed
```

Anti-pattern migration:

```text
Upgrade Java version
Upgrade app server
Replace javax with jakarta
Regenerate all SOAP clients
Change dependency versions
Change DTOs
Change parser behavior
Deploy all at once
```

Ini hampir pasti membuat root cause sulit dicari saat ada failure.

---

## 6. Choosing Contract Strategy

### 6.1 Schema-First

Schema-first berarti kontrak ditentukan lebih dulu, lalu kode mengikuti.

Cocok untuk:

- SOAP/WSDL;
- B2B XML;
- government integration;
- multi-consumer API;
- long-lived contract;
- audit-heavy systems.

Kelebihan:

- kontrak eksplisit;
- compatibility bisa dites;
- consumer bisa generate code;
- perubahan terlihat jelas;
- ownership lebih disiplin.

Kekurangan:

- lebih lambat di awal;
- butuh governance;
- schema bisa menjadi terlalu kompleks;
- developer harus memahami XSD/WSDL/JSON Schema.

### 6.2 Code-First

Code-first berarti kode/DTO dibuat dulu, kontrak dihasilkan atau didokumentasikan dari kode.

Cocok untuk:

- internal API;
- single team ownership;
- prototype;
- low-risk consumer;
- kontrak pendek umurnya.

Kelebihan:

- cepat;
- natural untuk developer;
- mudah refactor internal.

Kekurangan:

- contract drift;
- internal detail bocor keluar;
- perubahan Java bisa menjadi breaking change eksternal;
- generated schema sering tidak ideal;
- sulit menjaga compatibility jangka panjang.

### 6.3 Contract-First but Implementation-Friendly

Untuk sistem besar, pendekatan ideal sering bukan schema-first murni atau code-first murni, tetapi:

```text
Contract-first for external boundary.
Code-first inside service boundary.
Mapping layer between them.
```

Contoh:

```text
External SOAP WSDL/XSD
       |
       v
Generated JAXB/JAX-WS DTO
       |
       v
Anti-Corruption Mapper
       |
       v
Application Command / Domain Model
```

Atau:

```text
External JSON API Contract
       |
       v
Request/Response DTO
       |
       v
Validation + Authorization
       |
       v
Application Service
       |
       v
Domain Model
```

Prinsipnya:

> External contract boleh stabil dan lambat berubah. Internal model boleh ekspresif dan berevolusi. Jangan menyamakan keduanya.

---

## 7. Anti-Corruption Layer untuk Integration

Anti-corruption layer bukan hanya pattern DDD abstrak. Dalam integration, ia sangat konkret.

Tanpa anti-corruption layer:

```text
Partner XML/JSON/SOAP DTO
       |
       v
Domain Entity
       |
       v
Database
```

Masalah:

- field partner masuk langsung ke domain;
- naming eksternal mencemari internal model;
- null semantics partner menjadi bug domain;
- versioning partner memaksa refactor domain;
- security field tidak disaring;
- migration menjadi mahal.

Dengan anti-corruption layer:

```text
Partner Contract DTO
       |
       v
Contract Validator
       |
       v
Translator / Mapper
       |
       v
Application Command
       |
       v
Domain Model
```

Translator harus menjawab:

- field external mana yang dipakai?
- field mana yang diabaikan?
- default value berasal dari mana?
- null berarti clear atau unknown?
- unknown enum ditangani bagaimana?
- invalid combination menjadi error apa?
- mapping reverse symmetric atau tidak?

Contoh prinsip mapping:

```java
public final class PartnerApplicationMapper {

    public SubmitApplicationCommand toCommand(PartnerSubmitRequest request) {
        return new SubmitApplicationCommand(
                normalizeExternalReference(request.getReferenceNo()),
                mapApplicant(request.getApplicant()),
                mapDeclaredItems(request.getItems()),
                mapSubmissionChannel(request.getChannel()),
                mapPartnerTimestamp(request.getSubmittedAt())
        );
    }

    private SubmissionChannel mapSubmissionChannel(String raw) {
        if (raw == null || raw.isBlank()) {
            return SubmissionChannel.UNKNOWN_EXTERNAL;
        }
        return switch (raw) {
            case "WEB" -> SubmissionChannel.PARTNER_WEB;
            case "BATCH" -> SubmissionChannel.PARTNER_BATCH;
            default -> SubmissionChannel.UNRECOGNIZED;
        };
    }
}
```

Jangan letakkan logic ini tersebar di controller, endpoint, JAXB class, JSON-B adapter, atau repository.

---

## 8. Canonical Integration Architecture

Untuk enterprise integration yang sehat, boundary sebaiknya punya komponen berikut:

```text
Inbound Adapter
   - HTTP/SOAP/JCA/batch listener
   - transport-level validation
   - authentication extraction

Contract Parser/Binder
   - JSON-P/JSON-B/JAXB/StAX
   - secure parser config
   - strictness policy

Contract Validator
   - schema validation
   - Bean Validation
   - business precondition

Anti-Corruption Mapper
   - external DTO -> internal command
   - internal result -> external response

Application Service
   - transaction boundary
   - domain orchestration
   - idempotency

Outbound Adapter
   - partner client
   - timeout/retry/circuit breaker
   - SOAP/JSON/XML mapping

Observability Layer
   - correlation id
   - partner id
   - operation name
   - latency
   - fault class
   - sanitized payload metadata
```

Struktur package contoh:

```text
com.example.integration.partnerx
  ├── inbound
  │   ├── PartnerXSoapEndpoint.java
  │   └── PartnerXRestController.java
  ├── outbound
  │   └── PartnerXClient.java
  ├── contract
  │   ├── generated
  │   ├── dto
  │   └── schema
  ├── mapping
  │   └── PartnerXMapper.java
  ├── validation
  │   └── PartnerXContractValidator.java
  ├── resilience
  │   ├── PartnerXRetryPolicy.java
  │   └── PartnerXTimeoutPolicy.java
  ├── observability
  │   └── PartnerXIntegrationLogger.java
  └── testkit
      ├── golden-messages
      └── compatibility
```

---

## 9. Production Checklist: JSON Integration

### 9.1 Contract Checklist

- Field required/optional sudah jelas.
- Null vs absent sudah jelas.
- Unknown field policy sudah jelas.
- Unknown enum policy sudah jelas.
- Numeric precision sudah jelas.
- Date/time format dan timezone sudah jelas.
- Array ordering semantics sudah jelas.
- Duplicate key behavior sudah diproteksi.
- Versioning strategy sudah ada.
- Sample payload disimpan sebagai golden files.

### 9.2 Runtime Checklist

- Parser limit untuk size/depth ada.
- Binding tidak langsung ke domain entity.
- DTO tidak mengekspos field sensitive.
- Validation terjadi setelah binding sebelum business logic.
- Error response tidak membocorkan internal class/stacktrace.
- Logging payload disanitasi.
- Large payload menggunakan streaming jika perlu.
- BigDecimal dipakai untuk nilai finansial/presisi.
- JSON canonicalization dipakai jika perlu signature/hash deterministic.

### 9.3 Testing Checklist

- Valid payload.
- Missing required field.
- Explicit null.
- Unknown field.
- Unknown enum.
- Duplicate key.
- Huge number.
- Deep nesting.
- Huge array.
- Invalid date.
- Extra-long string.
- Injection string untuk log/template.

---

## 10. Production Checklist: XML/JAXB Integration

### 10.1 Parser Security Checklist

- External entity disabled.
- External DTD/schema access dibatasi.
- Secure processing enabled.
- XInclude disabled kecuali benar-benar perlu.
- Entity expansion limit dikunci.
- Max element depth/size dikontrol bila runtime mendukung.
- Schema source trusted.
- XSLT external access dibatasi.
- XPath input tidak digabung dari user input mentah.

### 10.2 JAXB Runtime Checklist

- `JAXBContext` di-cache.
- `Marshaller`/`Unmarshaller` tidak dishare antar thread tanpa proteksi.
- Schema validation dipasang bila perlu.
- `ValidationEventHandler` policy jelas.
- Namespace dan element order dikunci.
- `nillable` vs absent jelas.
- `JAXBElement` dipahami, bukan dihapus asal.
- Adapter stateless atau thread-safe.
- Generated source tidak diedit manual.
- XJC binding file disimpan dan versioned.

### 10.3 Testing Checklist

- XML valid sesuai schema.
- XML invalid schema.
- Namespace salah.
- Element order salah.
- Missing required element.
- `xsi:nil`.
- Empty element.
- Unknown extension element.
- XXE attempt.
- Billion laughs/entity expansion.
- Large document.
- Mixed content jika relevan.

---

## 11. Production Checklist: SOAP/JAX-WS Integration

### 11.1 Contract Checklist

- WSDL versioned.
- XSD imported/included secara stabil.
- Operation style jelas.
- Document-literal wrapped diprioritaskan untuk interoperability.
- Fault contract dimodelkan.
- Header contract didokumentasikan.
- WS-Policy jika ada disimpan bersama contract.
- MTOM requirement jelas.
- Endpoint URL configurable.
- Consumer compatibility diuji sebelum perubahan.

### 11.2 Client Checklist

- Connect timeout dikunci.
- Read/request timeout dikunci.
- Endpoint override configurable.
- Retry hanya untuk operation idempotent atau dengan idempotency key.
- SOAP fault dipetakan ke error taxonomy.
- `WebServiceException` tidak dianggap business fault.
- Handler chain tidak menyimpan mutable shared state berbahaya.
- Correlation ID dikirim/diterima.
- Keystore/truststore rotation plan ada.
- Generated client source versioned atau regenerated deterministically.

### 11.3 Server Checklist

- Endpoint tidak mengekspos domain exception.
- Fault mapping eksplisit.
- Payload validation dilakukan.
- Security header diproses sebelum business logic.
- Attachments tidak dimuat penuh tanpa batas.
- SOAPAction/content-type compatibility dites.
- WSDL exposure policy jelas.
- Backward-compatible operation evolution.
- Logging header/body disanitasi.
- Latency dan fault metrics per operation.

---

## 12. Production Checklist: JCA/Jakarta Connectors

### 12.1 Architecture Checklist

- JCA memang dibutuhkan, bukan overengineering.
- Resource adapter lifecycle dipahami.
- Outbound/inbound contract jelas.
- Managed connection factory benar.
- Connection matching benar.
- Connection cleanup aman.
- Pool size dan timeout dikonfigurasi.
- Credential propagation jelas.
- Transaction support level jelas: none/local/XA.
- Recovery behavior diuji.

### 12.2 Reliability Checklist

- Pool exhaustion behavior diketahui.
- Stale connection detection ada.
- Reconnect/backoff policy ada.
- Poison message handling ada.
- Inbound concurrency dikontrol.
- WorkManager usage tidak memonopoli thread.
- Endpoint failure tidak membuat infinite redelivery tanpa batas.
- Idempotency untuk inbound message ada.
- Observability per EIS operation ada.
- Graceful shutdown diuji.

### 12.3 Security Checklist

- Credential tidak hardcoded.
- Container-managed sign-on dipahami.
- Reauthentication behavior jelas.
- Principal mapping jelas.
- Secret rotation plan ada.
- Sensitive resource adapter config dilindungi.
- Audit access ke EIS tersedia.

---

## 13. Error Taxonomy untuk Integration Layer

Tanpa taxonomy, semua error menjadi “failed integration”. Itu tidak cukup untuk production.

Buat taxonomy seperti ini:

| Category | Meaning | Retry? | Owner Awal |
|---|---|---|---|
| `TRANSPORT_TIMEOUT` | partner tidak merespons tepat waktu | maybe | infra/partner |
| `TRANSPORT_CONNECT_FAILED` | tidak bisa connect | yes with backoff | infra/network |
| `AUTHENTICATION_FAILED` | credential/certificate/token salah | no until fixed | security/config |
| `AUTHORIZATION_FAILED` | credential valid tapi tidak punya akses | no | partner/security |
| `MALFORMED_PAYLOAD` | JSON/XML tidak bisa diparse | no | sender |
| `CONTRACT_VALIDATION_FAILED` | parse bisa, schema/contract invalid | no | sender/contract |
| `BUSINESS_REJECTED` | valid technically tapi ditolak bisnis | no | business |
| `SOAP_FAULT_MODELED` | known SOAP fault | depends | partner/business |
| `SOAP_FAULT_UNMODELED` | unexpected SOAP fault | maybe | partner |
| `PROTOCOL_VIOLATION` | content-type/SOAPAction/header salah | no/maybe | sender/partner |
| `DUPLICATE_REQUEST` | idempotency duplicate | no, return known result | application |
| `RESOURCE_POOL_EXHAUSTED` | pool/thread/connection habis | maybe after recovery | platform |
| `INTERNAL_MAPPING_ERROR` | bug mapper/adapter | no | engineering |

Error object internal contoh:

```java
public record IntegrationError(
        IntegrationErrorCategory category,
        String partner,
        String operation,
        String correlationId,
        boolean retryable,
        String safeMessage,
        Throwable cause
) {}
```

Prinsip:

> Retry decision harus berdasarkan kategori error dan idempotency, bukan berdasarkan jenis exception mentah.

---

## 14. Idempotency sebagai Invariant Integration

Dalam distributed systems, kasus paling berbahaya bukan request gagal total. Yang berbahaya adalah:

```text
Client sends request
Partner processes successfully
Response lost / timeout
Client retries
Partner processes again
Duplicate side effect
```

Untuk operation yang mengubah state, harus ada idempotency model.

### 14.1 Idempotency Key

Contoh:

```text
Idempotency-Key: partnerA:submitApplication:REQ-2026-000123
```

Server menyimpan:

- key;
- request hash;
- status;
- result;
- timestamp;
- partner;
- operation.

Jika request sama datang lagi:

- kalau hash sama dan sudah sukses, return result lama;
- kalau hash beda untuk key sama, reject;
- kalau masih processing, return conflict/in-progress;
- kalau failed retryable, boleh diproses ulang sesuai policy.

### 14.2 SOAP Idempotency

Di SOAP, idempotency bisa dibawa melalui:

- business reference number;
- WS-Addressing `MessageID`;
- custom SOAP header;
- application-level transaction ID;
- partner-specific reference.

Jangan bergantung pada TCP/HTTP untuk exactly-once. Itu ilusi.

---

## 15. Observability untuk Integration

Integration observability harus menjawab:

1. Siapa partner?
2. Operasi apa?
3. Contract version apa?
4. Correlation ID apa?
5. Request diterima jam berapa?
6. Binding/parsing berhasil atau gagal?
7. Validation berhasil atau gagal?
8. Outbound call ke mana?
9. Latency berapa?
10. Fault category apa?
11. Retry berapa kali?
12. Payload size berapa?
13. Attachment size berapa?
14. Response status apa?
15. Apakah ada duplicate/idempotency event?

Contoh structured log:

```json
{
  "event": "partner_call_completed",
  "partner": "PARTNER_X",
  "operation": "SubmitApplication",
  "contractVersion": "v2.1",
  "correlationId": "01JABC...",
  "idempotencyKey": "PARTNER_X:SubmitApplication:REQ-123",
  "transport": "SOAP_HTTP",
  "durationMs": 842,
  "requestBytes": 18432,
  "responseBytes": 4096,
  "attempt": 1,
  "result": "SUCCESS"
}
```

Contoh failure log:

```json
{
  "event": "partner_call_failed",
  "partner": "PARTNER_X",
  "operation": "SubmitApplication",
  "correlationId": "01JABC...",
  "category": "SOAP_FAULT_MODELED",
  "retryable": false,
  "faultCode": "Client.ValidationError",
  "safeMessage": "Partner rejected request due to contract validation error"
}
```

Jangan log raw payload penuh secara default. Gunakan:

- payload hash;
- schema version;
- selected safe fields;
- redacted body;
- attachment metadata;
- correlation id.

---

## 16. Testing Strategy: Dari Unit sampai Partner Certification

### 16.1 Unit Test

Cakupan:

- mapper;
- adapter;
- serializer/deserializer;
- XML/JSON parser config;
- idempotency key generation;
- error classifier.

Contoh mapper test:

```java
@Test
void shouldMapUnknownExternalChannelToUnrecognized() {
    var request = new PartnerSubmitRequest();
    request.setChannel("MYSTERY");

    var command = mapper.toCommand(request);

    assertEquals(SubmissionChannel.UNRECOGNIZED, command.channel());
}
```

### 16.2 Golden Message Test

Simpan sample payload sebagai file:

```text
src/test/resources/golden/partner-x/submit/v2/valid-request.xml
src/test/resources/golden/partner-x/submit/v2/valid-response.xml
src/test/resources/golden/partner-x/submit/v2/fault-validation.xml
src/test/resources/golden/partner-x/submit/v2/unknown-extension.xml
```

Test:

- parse sample;
- bind sample;
- map sample;
- serialize ulang jika perlu;
- assert canonical output;
- assert no contract drift.

### 16.3 Contract Compatibility Test

Untuk XSD/WSDL:

- old sample valid terhadap new schema?
- generated code masih compile?
- operation lama masih ada?
- fault lama masih ada?
- namespace tidak berubah tanpa versioning?
- element optional tidak jadi required?

Untuk JSON:

- old clients bisa mengirim payload lama?
- new fields additive?
- required field tidak bertambah tanpa versioning?
- enum baru tidak merusak consumer?
- unknown field policy dites?

### 16.4 Integration Test

Gunakan fake partner server:

- normal response;
- timeout;
- slow response;
- malformed response;
- SOAP fault;
- TLS failure;
- duplicate response;
- attachment besar;
- invalid content-type.

### 16.5 Chaos / Resilience Test

Simulasikan:

- partner down;
- latency spike;
- half-open connection;
- certificate expired;
- DNS berubah;
- pool exhausted;
- redelivery storm;
- DLQ penuh;
- schema registry unavailable;
- corrupted payload.

---

## 17. Performance Review Framework

Performance integration bukan hanya throughput. Ukur:

| Metric | Meaning |
|---|---|
| p50/p95/p99 latency | distribusi waktu call |
| parse time | waktu parsing/binding |
| validation time | waktu schema/business validation |
| mapping time | waktu transform DTO/domain |
| payload size | request/response bytes |
| attachment size | binary payload bytes |
| allocation rate | object allocation saat parse/bind |
| GC pressure | dampak payload ke heap |
| pool utilization | koneksi/thread/resource usage |
| retry amplification | traffic tambahan akibat retry |
| error rate by category | failure taxonomy |
| partner-specific SLA | per partner/operation |

### 17.1 Performance Anti-Patterns

- Membuat `JAXBContext` per request.
- Parsing XML besar dengan DOM penuh.
- Binding JSON besar ke object graph penuh padahal hanya butuh satu field.
- Base64 binary besar di JSON/XML tanpa streaming strategy.
- Retry serentak tanpa backoff/jitter.
- Timeout terlalu panjang sehingga thread habis.
- Connection pool terlalu kecil tanpa metric.
- Connection pool terlalu besar hingga membanjiri partner.
- Logging raw payload besar synchronous.
- Schema validation berulang untuk artifact yang bisa di-cache.

### 17.2 Performance Decision

```text
Small payload + simple DTO
  -> JSON-B/JAXB object binding acceptable

Large payload + partial extraction
  -> JSON-P streaming / StAX

Large XML + selected subtrees
  -> StAX + JAXB fragment binding

Binary payload
  -> MTOM/attachment/object storage reference, avoid full memory copy

High concurrency partner calls
  -> bounded pool + timeout + backoff + circuit breaker
```

---

## 18. Security Review Framework

Security integration harus dilihat per layer.

### 18.1 Transport Layer

- TLS version policy.
- Mutual TLS jika perlu.
- Certificate validation.
- Hostname verification.
- Keystore/truststore rotation.
- Proxy/gateway behavior.

### 18.2 Message Layer

- JSON duplicate key policy.
- JSON parser limits.
- XML XXE prevention.
- XSD trusted source.
- WS-Security signature validation.
- XML canonicalization correctness.
- Replay protection.
- Timestamp freshness.
- Signature wrapping mitigation.

### 18.3 Application Layer

- Field-level authorization.
- Mass assignment prevention.
- Sensitive field redaction.
- Business rule validation.
- Idempotency protection.
- Audit logging.

### 18.4 Operational Layer

- Secret management.
- Token/certificate rotation.
- Least privilege partner credential.
- Alerting for auth failures.
- Payload retention policy.
- PII masking.
- Incident runbook.

---

## 19. Migration Patterns

### 19.1 Facade Pattern

Gunakan facade ketika internal ingin modern, external contract harus tetap.

```text
Legacy SOAP Consumer
       |
       v
SOAP Facade
       |
       v
Modern Internal Service
```

Facade menjaga WSDL lama, tapi internal service bisa memakai JSON/event/domain API.

### 19.2 Strangler Pattern

Migrasi bertahap per operation.

```text
Old SOAP Service
   | operation A -> old
   | operation B -> new facade
   | operation C -> old
```

Gunakan routing berdasarkan:

- operation;
- partner;
- version;
- feature flag;
- payload property.

### 19.3 Anti-Corruption Mapper

Mencegah kontrak lama mencemari model baru.

```text
Old XML DTO -> Legacy Mapper -> New Command Model
```

### 19.4 Dual-Run / Shadow Mode

Untuk migration risiko tinggi:

```text
Production request
     |
     +--> old path returns actual response
     |
     +--> new path shadow execution, result compared but not returned
```

Cocok untuk:

- mapping migration;
- SOAP-to-REST replacement;
- parser replacement;
- JAXB namespace migration;
- provider switch.

### 19.5 Consumer-Driven Compatibility

Simpan payload nyata yang mewakili consumer utama.

```text
consumer-a-valid-v1.xml
consumer-b-valid-v1.xml
consumer-c-weird-but-supported-v1.xml
```

Regression bukan hanya terhadap spec ideal, tetapi terhadap real interoperability yang sudah dijanjikan.

---

## 20. Governance: Contract Lifecycle

### 20.1 Contract Artifact Repository

Simpan:

```text
contracts/
  partner-x/
    wsdl/
      v1/
      v2/
    xsd/
      common/
      submission/
    json/
      schema/
      examples/
    policy/
      ws-security-policy.xml
    changelog.md
```

Setiap perubahan kontrak harus menjawab:

- apa yang berubah?
- breaking atau non-breaking?
- consumer mana terdampak?
- migration window berapa lama?
- sample payload baru apa?
- test compatibility apa yang ditambahkan?
- rollback bagaimana?

### 20.2 Compatibility Classification

| Change | JSON | XML/XSD | SOAP/WSDL | Risk |
|---|---|---|---|---|
| Add optional field | usually safe | usually safe | usually safe if schema allows | low |
| Add required field | breaking | breaking | breaking | high |
| Rename field/element | breaking | breaking | breaking | high |
| Change namespace | breaking | breaking | breaking | high |
| Add enum value | maybe breaking | maybe breaking | maybe breaking | medium |
| Change type string→number | breaking | breaking | breaking | high |
| Remove operation | n/a | n/a | breaking | high |
| Add operation | safe | safe | usually safe | low |
| Change fault shape | breaking | breaking | breaking | high |

### 20.3 Deprecation Policy

Deprecation harus punya:

- announcement date;
- last supported date;
- migration guide;
- contact point;
- compatibility facade period;
- monitoring for old version usage;
- hard cutoff plan.

---

## 21. Reference Architecture: SOAP Legacy to Modern Core

```text
[External SOAP Consumers]
          |
          v
[SOAP Endpoint / JAX-WS]
          |
          v
[WSDL/XSD Contract Validation]
          |
          v
[Generated JAXB DTO]
          |
          v
[Anti-Corruption Mapper]
          |
          v
[Application Command]
          |
          v
[Domain Service]
          |
          v
[Outbound Adapter]
   | JSON REST Partner
   | SOAP Partner
   | JCA EIS
          |
          v
[Integration Error Taxonomy]
          |
          v
[Modeled SOAP Fault / Response]
```

Important invariants:

- SOAP contract remains stable.
- Domain model does not know WSDL classes.
- Partner failures become internal error taxonomy.
- Internal errors are mapped to safe SOAP faults.
- Observability includes operation, partner, correlation id, and fault category.
- Idempotency is enforced before side effect.

---

## 22. Reference Architecture: JSON API with XML/SOAP Backend

```text
[Modern JSON Client]
        |
        v
[REST/HTTP JSON API]
        |
        v
[JSON-B DTO Binding]
        |
        v
[Validation + Authorization]
        |
        v
[Application Service]
        |
        v
[SOAP Client Adapter]
        |
        v
[JAXB/JAX-WS Generated Client]
        |
        v
[Legacy SOAP Backend]
```

Common trap:

> Exposing SOAP backend shape directly as JSON.

Bad:

```json
{
  "submitApplicationRequest": {
    "arg0": {
      "applicantDtl": {...},
      "txnCd": "A01"
    }
  }
}
```

Better:

```json
{
  "applicant": {...},
  "submissionType": "NEW_APPLICATION",
  "documents": [...]
}
```

Internal SOAP weirdness should not leak to modern clients.

---

## 23. Reference Architecture: JCA Resource Adapter Boundary

```text
[Application Service]
        |
        v
[Outbound Port Interface]
        |
        v
[JCA Connection Factory]
        |
        v
[Managed Connection]
        |
        v
[Resource Adapter]
        |
        v
[Enterprise Information System]
```

For inbound:

```text
[Enterprise Information System]
        |
        v
[Resource Adapter Listener]
        |
        v
[WorkManager]
        |
        v
[MessageEndpointFactory]
        |
        v
[Application Message Endpoint]
        |
        v
[Application Service]
```

Important invariants:

- resource adapter owns protocol details;
- application owns business semantics;
- container owns pooling/lifecycle/transaction/security contracts;
- endpoint must be idempotent;
- recovery must be tested, not assumed.

---

## 24. Failure Modeling: Integration State Machine

A robust integration operation should be modeled as stateful, not just call-and-return.

```text
RECEIVED
   |
   v
PARSED
   |
   v
VALIDATED
   |
   v
MAPPED
   |
   v
IDEMPOTENCY_CHECKED
   |
   v
OUTBOUND_CALLING
   |
   +--> OUTBOUND_TIMEOUT ----+
   |                          |
   +--> OUTBOUND_FAULT -------+--> CLASSIFIED_FAILURE
   |                          |
   +--> OUTBOUND_SUCCESS      |
              |               |
              v               |
        RESPONSE_MAPPED        |
              |               |
              v               |
          COMPLETED <----------+
```

Add persistence for critical operations:

```text
operation_id
partner
operation_name
idempotency_key
request_hash
state
attempt_count
last_error_category
last_error_message
created_at
updated_at
completed_at
```

This gives you:

- resumability;
- auditability;
- duplicate detection;
- incident investigation;
- safe retry;
- operational dashboard.

---

## 25. Top 1% Engineering Heuristics

### 25.1 Never Trust “Valid Payload” Alone

A payload can be:

- syntactically valid;
- schema valid;
- semantically invalid;
- unauthorized;
- duplicate;
- stale;
- malicious;
- too expensive to process.

Validation has layers.

### 25.2 Separate External DTO from Internal Model

If external contract changes force domain refactor, boundary design is weak.

### 25.3 Treat Generated Code as Boundary Artifact

Generated JAXB/JAX-WS code is not domain code. Do not hand-edit it. Regenerate deterministically.

### 25.4 Make Failure Explicit

Do not let random exceptions define integration behavior.

### 25.5 Make Retry Bounded and Semantic

Retry without idempotency is a duplicate generator.

### 25.6 Prefer Streaming for Unbounded Payloads

Tree/object binding is fine only when payload bounds are known.

### 25.7 Contract Tests Are More Valuable Than Mock Tests

Mocking a client method does not prove WSDL/JSON/XML compatibility.

### 25.8 Observability Must Use Business Labels

`IOException` is not enough. You need partner, operation, contract version, and error category.

### 25.9 Migration Must Be Two-Dimensional

You migrate both:

- code/runtime;
- contract/consumer behavior.

Ignoring either one causes production surprises.

### 25.10 Do Not Modernize by Destroying Working Contracts

A stable SOAP contract may be ugly but valuable. Wrap it, observe it, test it, gradually replace it.

---

## 26. Practical Architecture Review Template

Gunakan template ini saat review integration design.

### 26.1 Context

```text
Partner/System:
Direction: inbound/outbound/bidirectional
Protocol:
Format:
Contract artifact:
Owner:
Criticality:
Expected TPS:
Max payload size:
Data sensitivity:
```

### 26.2 Contract

```text
Schema/WSDL/OpenAPI available?
Versioning strategy?
Backward compatibility policy?
Null/absent semantics?
Unknown field/element policy?
Enum evolution policy?
Sample payloads stored?
Golden tests available?
```

### 26.3 Runtime

```text
Parser/binder:
Streaming needed?
Timeouts:
Connection pool:
Thread pool:
Transaction boundary:
Idempotency key:
Retry policy:
Circuit breaker/bulkhead:
```

### 26.4 Security

```text
Authentication:
Authorization:
TLS/mTLS:
Message security:
Parser hardening:
Payload redaction:
Secret rotation:
Audit retention:
```

### 26.5 Failure

```text
Error taxonomy:
Modeled faults:
Retryable categories:
Non-retryable categories:
Duplicate handling:
DLQ/manual recovery:
Partner escalation path:
```

### 26.6 Observability

```text
Correlation ID:
Partner metrics:
Operation metrics:
Payload size metrics:
Latency percentiles:
Fault dashboards:
Alert thresholds:
Runbook:
```

---

## 27. Final Capstone Example: Designing a Regulated Submission Integration

Scenario:

- external agency sends application submission;
- payload is XML because agency has existing XSD;
- attachments can be large;
- acknowledgement must be returned;
- duplicate submissions must not create duplicate cases;
- audit trail required;
- Java 21 runtime;
- legacy partner still expects SOAP.

### 27.1 Recommended Design

```text
SOAP/JAX-WS Endpoint
   -> Secure XML parser settings
   -> JAXB unmarshal generated schema-first DTO
   -> XSD validation
   -> Business validation
   -> Idempotency check using agency submission reference
   -> Map to SubmitCaseCommand
   -> Store request metadata + payload hash
   -> Process domain transaction
   -> Store attachments via streaming/object storage
   -> Return modeled SOAP response/fault
```

### 27.2 Why Not JSON?

Because partner contract is already XSD/WSDL and migration cost is external. Forcing JSON would shift cost to partner and increase risk without immediate business value.

### 27.3 Why Not Direct JAXB to Domain?

Because external agency schema is not your domain model. It may contain legacy naming, optionality, and structures optimized for message exchange, not case lifecycle.

### 27.4 Why MTOM?

If attachments are large, base64 inside XML body inflates payload and memory pressure. MTOM/SOAP attachments can reduce overhead and support better streaming behavior.

### 27.5 Required Invariants

- same submission reference cannot create two cases;
- invalid schema never reaches domain service;
- malformed XML never reaches JAXB business mapping;
- SOAP fault does not leak internal stacktrace;
- payload hash and correlation id are audit-visible;
- attachment size is bounded;
- timeout/retry policy cannot duplicate side effects;
- WSDL/XSD are versioned.

---

## 28. What You Should Be Able to Do After This Series

After completing this series, you should be able to:

1. Explain difference between format, contract, binding, protocol, and runtime.
2. Choose JSON-P vs JSON-B vs Jackson-style binding deliberately.
3. Design DTO boundaries that do not corrupt domain model.
4. Parse large JSON/XML payloads safely.
5. Harden XML parsers against XXE/entity/XInclude/XSLT risks.
6. Use JAXB/Jakarta XML Binding responsibly.
7. Decide schema-first vs code-first with trade-off clarity.
8. Read and reason about WSDL.
9. Build and consume SOAP services without treating them as local methods.
10. Model SOAP faults as distributed failure contracts.
11. Handle SOAP attachments/MTOM safely.
12. Understand WS-* interoperability risks.
13. Secure SOAP beyond simple TLS when message-level security is required.
14. Modernize legacy SOAP without breaking consumers.
15. Understand when JCA is appropriate.
16. Model JCA pooling, transaction, security, inbound/outbound behavior.
17. Build integration error taxonomy.
18. Design idempotent distributed operations.
19. Create production-grade observability for partner integrations.
20. Plan Java 8→11→17→21→25 migration for XML/SOAP/Jakarta stacks.

---

## 29. Final Mental Model

The most important lesson:

```text
Integration is not serialization.
Integration is contract survival under change and failure.
```

A weak integration works only when:

- both systems are healthy;
- payload is perfect;
- network is fast;
- schema never changes;
- partner behaves correctly;
- retry never happens;
- data is small;
- security assumptions hold.

A strong integration works when:

- partner is slow;
- response is lost;
- payload is malformed;
- schema evolves;
- duplicate request arrives;
- certificate rotates;
- attachment is large;
- parser is attacked;
- old consumer still exists;
- runtime migrates from Java 8 to Java 21/25;
- incident needs to be explained with evidence.

That is the difference between API coding and enterprise integration engineering.

---

## 30. Reference Sources

The following official or primary references underpin the series:

- Jakarta JSON Processing specification: https://jakarta.ee/specifications/jsonp/
- Jakarta JSON Binding specification: https://jakarta.ee/specifications/jsonb/
- Jakarta XML Binding specification: https://jakarta.ee/specifications/xml-binding/4.0/
- Jakarta XML Web Services specification: https://jakarta.ee/specifications/xml-web-services/4.0/
- Jakarta SOAP with Attachments specification: https://jakarta.ee/specifications/soap-attachments/
- Jakarta Connectors specification: https://jakarta.ee/specifications/connectors/2.1/
- OpenJDK JEP 320, Remove the Java EE and CORBA Modules: https://openjdk.org/jeps/320
- W3C XML: https://www.w3.org/TR/xml/
- W3C XML Namespaces: https://www.w3.org/TR/xml-names/
- W3C XML Schema: https://www.w3.org/XML/Schema
- W3C SOAP 1.2: https://www.w3.org/TR/soap12-part1/
- W3C WSDL 1.1: https://www.w3.org/TR/wsdl.html
- OASIS WS-Security: https://docs.oasis-open.org/wss-m/wss/v1.1.1/
- W3C WS-Addressing: https://www.w3.org/TR/ws-addr-core/
- W3C WS-Policy: https://www.w3.org/TR/ws-policy/
- OASIS WS-ReliableMessaging: https://docs.oasis-open.org/ws-rx/wsrm/200702/wsrm-1.1-spec-os-01.html
- OWASP XXE Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html
- OWASP Web Service Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Web_Service_Security_Cheat_Sheet.html

---

# Series Completion Status

This is **Part 34 of 34**.

The series **learn-java-json-xml-soap-connectors-enterprise-integration** is now complete.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-json-xml-soap-connectors-enterprise-integration-part-033](./learn-java-json-xml-soap-connectors-enterprise-integration-part-033.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 000 — Big Picture: Persistence as a Boundary, Not a CRUD Layer](../persistence/learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-000.md)

</div>