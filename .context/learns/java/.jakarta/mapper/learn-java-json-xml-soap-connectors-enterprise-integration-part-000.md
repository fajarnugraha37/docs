# learn-java-json-xml-soap-connectors-enterprise-integration-part-000

# Part 0 — Orientation & Mental Model: JSON, XML, SOAP, dan Jakarta Connectors untuk Java 8–25

> Status seri: **belum selesai**. Ini adalah **Part 0 dari 34**.
>
> Tujuan part ini bukan menghafal API. Tujuannya adalah membangun peta mental yang benar supaya part berikutnya tidak terasa seperti kumpulan teknologi terpisah: JSON-P, JSON-B, XML, JAXB, JAX-WS, SOAP, SAAJ, WSDL, XSD, MTOM, WS-*, dan Jakarta Connectors sebenarnya adalah keluarga teknologi untuk menyelesaikan problem yang sama: **membuat sistem Java berbicara dengan sistem lain secara kompatibel, aman, dapat diaudit, dan dapat bertahan puluhan tahun**.

---

## 0.1. Kenapa Seri Ini Penting?

Banyak engineer modern mengenal integrasi hanya sebagai:

```text
HTTP + JSON + REST + DTO + ObjectMapper
```

Itu cukup untuk banyak aplikasi baru, tetapi tidak cukup untuk enterprise system yang hidup lama, terhubung dengan banyak vendor, regulator, bank, government agency, mainframe, message broker, document management system, identity provider, batch gateway, dan legacy platform.

Di lingkungan enterprise, integrasi sering memiliki karakteristik berikut:

1. **Contract-nya lebih tua dari aplikasinya.**
   Sistem Java bisa diganti, tetapi WSDL, XSD, XML schema, message format, atau protocol agreement tetap dipakai oleh banyak pihak.

2. **Compatibility lebih penting daripada elegance.**
   Field yang “jelek” kadang tidak boleh diubah karena sudah dikonsumsi sistem lain selama bertahun-tahun.

3. **Payload adalah bukti.**
   XML/SOAP/JSON sering menjadi artefak audit: siapa mengirim apa, kapan, dengan signature apa, dan bagaimana sistem menafsirkannya.

4. **Failure bukan hanya exception.**
   Failure bisa berupa schema mismatch, namespace salah, duplicate key, XML entity attack, SOAP fault tidak sesuai WSDL, timeout di vendor gateway, certificate expiry, replay attack, XA recovery gagal, atau resource adapter stuck.

5. **Runtime matters.**
   Perbedaan Java 8, Java 11, Java 17, Java 21, dan Java 25 tidak hanya soal syntax. Untuk JAXB/JAX-WS/SAAJ, perbedaan versi Java bisa menentukan apakah aplikasi bisa start atau tidak.

Engineer top-tier bukan hanya tahu cara memanggil library. Mereka tahu:

- boundary mana yang harus dijaga;
- contract mana yang stabil dan mana yang boleh berubah;
- mapping mana yang aman dan mana yang menipu;
- parser mana yang boleh dipakai untuk payload besar;
- konfigurasi security apa yang wajib;
- dependency mana yang harus eksplisit setelah Java 11;
- kapan SOAP harus dipertahankan, dibungkus, atau dimigrasikan;
- kapan Jakarta Connectors masuk akal dibanding adapter biasa;
- bagaimana mendesain integrasi yang bisa dipertanggungjawabkan saat audit, incident, dan migration.

---

## 0.2. Peta Besar Teknologi yang Akan Dipelajari

Seri ini membahas beberapa kelompok teknologi:

```text
Data Contract Layer
├── JSON
│   ├── JSON-P / Jakarta JSON Processing
│   ├── JSON-B / Jakarta JSON Binding
│   ├── Jackson/Gson comparison boundary
│   └── JSON validation, patching, streaming, security
│
├── XML
│   ├── DOM
│   ├── SAX
│   ├── StAX
│   ├── XPath
│   ├── XSLT
│   ├── XSD
│   └── XML parser hardening
│
├── XML Binding
│   ├── JAXB / Jakarta XML Binding
│   ├── xjc schema-first workflow
│   ├── marshalling/unmarshalling
│   ├── adapters and polymorphism
│   └── Java 8–25 migration strategy
│
├── SOAP / XML Web Services
│   ├── SOAP envelope/header/body/fault
│   ├── WSDL
│   ├── JAX-WS / Jakarta XML Web Services
│   ├── SAAJ / Jakarta SOAP with Attachments
│   ├── MTOM/XOP
│   ├── WS-Security, WS-Addressing, WS-Policy overview
│   └── legacy modernization patterns
│
└── Jakarta Connectors / JCA
    ├── Resource Adapter
    ├── Connection Factory
    ├── ManagedConnection
    ├── ActivationSpec
    ├── WorkManager
    ├── XA/local transaction contract
    └── EIS integration reliability model
```

Kunci mental model-nya:

```text
Wire Format  →  Parser/Binder  →  Boundary Model  →  Runtime Contract  →  Operational Guarantees
```

Contoh:

```text
SOAP XML request
→ StAX/SAAJ/JAX-WS runtime
→ JAXB-generated class
→ service boundary
→ transaction/security context
→ audit + retry + fault handling
```

Atau:

```text
Large JSON batch payload
→ JSON-P streaming parser
→ validated command DTO
→ application service
→ idempotent persistence
→ partial failure report
```

Atau:

```text
Legacy EIS event
→ JCA inbound resource adapter
→ message endpoint
→ container-managed transaction
→ domain command
→ recovery after crash
```

---

## 0.3. Javax vs Jakarta: Perubahan yang Tidak Boleh Diremehkan

Salah satu jebakan terbesar di area ini adalah menganggap `javax.*` dan `jakarta.*` hanya rename package. Secara konsep memang banyak API berasal dari Java EE, tetapi dampak praktisnya besar:

```text
Java EE / Jakarta EE 8 era
javax.json.*
javax.json.bind.*
javax.xml.bind.*
javax.xml.ws.*
javax.xml.soap.*
javax.resource.*

Jakarta EE 9+ era
jakarta.json.*
jakarta.json.bind.*
jakarta.xml.bind.*
jakarta.xml.ws.*
jakarta.xml.soap.*
jakarta.resource.*
```

Perubahan namespace ini memengaruhi:

- source code imports;
- generated JAXB classes;
- generated JAX-WS client/server artifacts;
- Maven dependencies;
- application server compatibility;
- annotation scanning;
- reflection configuration;
- JPMS module name;
- transitive dependencies;
- test utilities;
- plugin versions;
- compatibility dengan third-party libraries.

### 0.3.1. Kenapa Java 8 ke Java 11 Sering Rusak di Area Ini?

Di Java 8, banyak aplikasi menggunakan JAXB/JAX-WS/SAAJ seolah-olah itu bagian natural dari JDK. Secara historis, modul Java EE/CORBA pernah disediakan di JDK. Namun JDK 11 menghapus modul Java EE dan CORBA dari Java SE/JDK. Modul yang dihapus mencakup antara lain `java.xml.ws`, `java.xml.bind`, `java.activation`, `java.xml.ws.annotation`, `java.corba`, dan `java.transaction`.

Implikasinya:

```text
Java 8 application:
import javax.xml.bind.JAXBContext;
// bisa compile/run karena ada di JDK

Java 11+ application:
import javax.xml.bind.JAXBContext;
// tidak ada lagi dari JDK; harus tambah dependency eksternal
```

Untuk engineer production, ini bukan detail akademik. Ini menentukan strategi migrasi:

- apakah tetap di `javax.*` dengan dependency JAXB/JAX-WS legacy;
- apakah migrasi ke `jakarta.*`;
- apakah app server menyediakan API/implementation;
- apakah generated code harus di-regenerate;
- apakah SOAP client runtime kompatibel dengan Java target;
- apakah ada split package/module issue;
- apakah classpath lama masih aman atau perlu JPMS-aware setup.

### 0.3.2. Jakarta EE 11 dan Posisi SOAP/XML Binding

Jakarta EE modern semakin memusatkan platform utama pada model cloud-native/web/API modern. JSON-P dan JSON-B tetap menjadi bagian penting dari ekosistem Jakarta, sedangkan XML Binding, XML Web Services, dan SOAP with Attachments tidak lagi selalu menjadi bagian platform utama di Jakarta EE 11. Ini bukan berarti teknologi tersebut hilang dari dunia Java. Artinya, engineer harus lebih eksplisit soal dependency dan runtime support.

Mental model yang benar:

```text
Removed from platform != impossible to use
Removed from JDK      != impossible to use
Optional/standalone   == you must manage dependency and runtime deliberately
```

Jadi untuk Java 17/21/25 + Jakarta EE modern, SOAP/JAXB masih bisa dipakai, tetapi jangan mengandalkan “pasti ada di runtime”.

---

## 0.4. Kompatibilitas Java 8 sampai Java 25

Seri ini membahas Java 8 hingga Java 25. Untuk topik JSON/XML/SOAP/JCA, yang penting bukan fitur bahasa semata, tetapi kombinasi:

```text
JDK version
+ namespace generation
+ API artifact
+ implementation artifact
+ application server/runtime
+ build plugin
+ generated source
+ deployment packaging
```

### 0.4.1. Timeline Praktis

| Era | Java | Dampak ke Seri Ini |
|---|---:|---|
| Legacy baseline | 8 | Banyak JAXB/JAX-WS/SAAJ masih terasa built-in; banyak enterprise app lama ada di sini. |
| Modular transition | 9–10 | Modul Java EE deprecated for removal; warning mulai muncul. |
| Break point | 11 | Java EE/CORBA modules removed; dependency JAXB/JAX-WS/SAAJ harus eksplisit. |
| Long-term modernization | 17 | Banyak org migrasi dari 8/11 ke 17; Jakarta namespace mulai relevan. |
| Current enterprise modern | 21 | Java LTS modern; banyak Spring Boot/Jakarta EE runtime target ke sini. |
| Forward-looking | 25 | Target seri ini tetap relevan untuk Java 25 karena API ini external dependencies, bukan built-in JDK feature. |

### 0.4.2. Compatibility Rule of Thumb

Gunakan rule berikut:

```text
Jika code masih javax.*:
    cocok untuk Java EE 8 / Jakarta EE 8 style / legacy migration
    butuh dependency eksplisit di Java 11+

Jika code sudah jakarta.*:
    cocok untuk Jakarta EE 9+
    perlu pastikan semua library satu namespace family

Jangan campur javax.* dan jakarta.* sembarangan:
    type-nya berbeda
    annotation-nya berbeda
    runtime scanning bisa gagal
    generated classes bisa tidak match
```

Contoh mismatch:

```java
// Generated class memakai javax.xml.bind.annotation.XmlRootElement
// Runtime/JAX-RS/JAXB provider mengharapkan jakarta.xml.bind.annotation.XmlRootElement
// Secara nama konsep sama, tetapi class berbeda.
```

Bagi compiler dan runtime:

```text
javax.xml.bind.annotation.XmlRootElement != jakarta.xml.bind.annotation.XmlRootElement
```

---

## 0.5. Kenapa JSON-P dan JSON-B Ada Jika Sudah Ada Jackson?

Pertanyaan realistis:

> “Kalau Jackson sudah sangat populer, kenapa harus belajar JSON-P dan JSON-B?”

Jawabannya bukan “karena lebih bagus”. Jawaban yang benar adalah konteks.

### 0.5.1. JSON-P

JSON-P / JSON Processing adalah API standar Jakarta untuk:

- parsing JSON;
- generating JSON;
- object model;
- streaming model;
- JSON Pointer;
- JSON Patch;
- JSON Merge Patch.

Mental model:

```text
JSON-P = low-level portable JSON processing API
```

JSON-P berguna ketika:

- butuh streaming large JSON payload;
- ingin menghindari mapping langsung ke object;
- perlu transform/diff/patch JSON;
- ingin API standar Jakarta;
- ingin memproses JSON sebagai dokumen, bukan sebagai object domain;
- ingin deterministic control atas output.

### 0.5.2. JSON-B

JSON-B / JSON Binding adalah API standar Jakarta untuk:

```text
Java object ↔ JSON document
```

Mental model:

```text
JSON-B = object mapping standard for Jakarta ecosystem
```

JSON-B berguna ketika:

- ingin portable object binding di Jakarta EE;
- ingin integrasi natural dengan JAX-RS/Jakarta REST runtime;
- ingin annotation model standar Jakarta;
- ingin memisahkan code dari vendor-specific Jackson annotation;
- ingin memahami baseline behavior dari Jakarta stack.

### 0.5.3. Jackson Tetap Penting

Jackson tetap sangat penting, terutama di Spring ecosystem dan banyak sistem modern. Namun seri ini tidak akan menjadi seri Jackson utama. Jackson akan dibahas sebagai pembanding dan integration boundary.

Decision model:

| Kebutuhan | Pilihan Awal |
|---|---|
| Jakarta EE portable JSON binding | JSON-B |
| Low-level JSON document processing | JSON-P |
| Spring Boot default object mapping | Jackson |
| Complex polymorphism + rich ecosystem | Jackson, dengan guardrail ketat |
| Streaming huge JSON tanpa object binding penuh | JSON-P streaming atau Jackson streaming |
| JSON Patch/Merge Patch standar Jakarta | JSON-P |

Prinsip top-tier:

```text
Jangan pilih mapper berdasarkan popularitas saja.
Pilih berdasarkan contract, runtime, observability, security, dan migration path.
```

---

## 0.6. Kenapa XML Masih Penting?

Banyak engineer menganggap XML sudah mati. Itu asumsi yang berbahaya.

XML masih banyak dipakai di:

- SOAP web services;
- financial integration;
- government integration;
- procurement systems;
- document exchange;
- digital signatures;
- regulatory submissions;
- identity protocols;
- legacy middleware;
- enterprise service bus;
- configuration formats;
- standards body schemas;
- banking and insurance payloads.

JSON lebih ringan untuk banyak API modern, tetapi XML memiliki kemampuan yang berbeda:

| Aspek | JSON | XML |
|---|---|---|
| Human readability | Tinggi | Sedang-rendah tergantung kompleksitas |
| Schema maturity | Ada, tetapi ecosystem bervariasi | XSD sangat matang dan detail |
| Namespace | Tidak built-in | Core feature |
| Attributes | Tidak ada | Ada |
| Mixed content | Tidak natural | Native |
| Digital signature ecosystem | Ada, lebih sederhana | XML Signature kompleks tapi banyak legacy standard |
| SOAP compatibility | Tidak | Native |
| Document-centric format | Terbatas | Kuat |

XML bukan “JSON yang verbose”. XML adalah model dokumen dengan namespace, attributes, text nodes, element order, schema, entity, processing instruction, dan canonicalization problem.

Kesalahan umum engineer modern:

```text
Menganggap XML cukup diparse seperti Map<String,Object>.
```

Itu akan gagal saat menghadapi:

- namespace collision;
- qualified vs unqualified elements;
- element order significance;
- `xsi:nil`;
- `xsi:type`;
- substitution group;
- mixed content;
- schema import/include;
- XML signature canonicalization;
- SOAP header processing.

---

## 0.7. JAXB / Jakarta XML Binding: Bukan Sekadar “XML ObjectMapper”

JAXB sering dijelaskan sebagai:

```text
XML ↔ Java object
```

Itu benar, tetapi terlalu dangkal.

Mental model yang lebih tepat:

```text
JAXB = contract-aware object projection over XML schema-shaped documents
```

JAXB tidak hanya membaca field. Ia mengelola:

- element vs attribute;
- namespace;
- root element name;
- type name;
- object factory;
- `JAXBElement` wrapper;
- nillable vs absent;
- schema-derived type;
- adapter;
- inheritance;
- generated package metadata;
- validation integration;
- marshaller/unmarshaller lifecycle;
- classloader and context creation cost.

### 0.7.1. JAXB Code-First vs Schema-First

Ada dua workflow besar:

```text
Schema-first:
XSD → generated Java classes → marshal/unmarshal

Code-first:
Java classes → generated schema → XML contract
```

Untuk enterprise integration, schema-first sering lebih defensible karena contract external bisa menjadi source of truth.

Tetapi tidak selalu. Code-first bisa masuk akal ketika:

- service internal;
- XML hanya serialization detail;
- tidak ada external consumer yang strict;
- schema bukan governance artifact;
- lifecycle masih cepat berubah.

Top-tier judgement:

```text
Jika XML adalah kontrak antar-organisasi, schema-first hampir selalu lebih aman.
Jika XML hanya persistence/config internal, code-first bisa cukup.
```

---

## 0.8. SOAP: Kenapa Masih Hidup?

SOAP sering dibenci karena verbose dan berat. Tetapi SOAP bertahan karena ia menyelesaikan problem yang REST/JSON sering serahkan ke convention.

SOAP menyediakan model eksplisit untuk:

- envelope;
- header extensibility;
- body;
- fault;
- WSDL contract;
- operation binding;
- message-level metadata;
- attachments;
- WS-* policies;
- message-level security;
- tooling untuk generate client/server;
- enterprise interoperability.

Mental model:

```text
SOAP = message protocol with contract and extensibility model
WSDL = machine-readable service contract
XSD  = machine-readable payload contract
JAX-WS = Java programming model around that contract
SAAJ = low-level SOAP message manipulation API
```

REST/JSON cenderung:

```text
HTTP resource + representation + conventions + OpenAPI optional
```

SOAP cenderung:

```text
Operation contract + XML message + strict schema + generated artifacts
```

SOAP bukan pilihan default untuk aplikasi baru. Tetapi untuk sistem legacy/enterprise, kemampuan membaca, memperbaiki, membungkus, mengamankan, dan memigrasikan SOAP adalah skill mahal.

### 0.8.1. SOAP Failure Tidak Sama dengan HTTP Failure

Dalam SOAP, response HTTP 200 bisa berisi SOAP Fault tergantung stack/protocol convention. Sebaliknya, HTTP error bisa terjadi sebelum SOAP layer memproses message.

Mental model:

```text
Transport failure:
    DNS, TLS, connection refused, timeout, HTTP 503

Protocol/message failure:
    malformed SOAP envelope, wrong SOAPAction, unsupported content type

Contract failure:
    invalid XML schema, wrong namespace, missing required element

Business fault:
    known modeled fault from WSDL

Runtime fault:
    unmodeled exception mapped to SOAP fault
```

Engineer biasa hanya menangkap `Exception`.
Engineer top-tier mengklasifikasikan failure untuk menentukan:

- retry atau tidak;
- idempotency key perlu atau tidak;
- alert severity;
- audit evidence;
- consumer-facing error;
- vendor escalation packet;
- replay strategy;
- timeout budget;
- circuit breaker rule.

---

## 0.9. Jakarta Connectors / JCA: Teknologi yang Sering Dilupakan

Jakarta Connectors, dulu dikenal sebagai Java Connector Architecture/JCA, bukan sekadar “connector library”. Ia adalah arsitektur standar agar komponen Jakarta EE dapat terhubung ke Enterprise Information Systems/EIS.

EIS bisa berupa:

- ERP;
- mainframe;
- transaction system;
- legacy queue;
- proprietary system;
- banking host;
- custom enterprise backend;
- non-JDBC resource;
- non-JMS messaging system.

Mental model:

```text
JCA = SPI contract between application server and resource adapter
```

Bukan hanya aplikasi memanggil adapter. Container ikut mengelola:

- connection lifecycle;
- pooling;
- transaction enlistment;
- security credential propagation;
- work management;
- inbound message delivery;
- recovery;
- deployment configuration.

### 0.9.1. Kapan JCA Masuk Akal?

JCA masuk akal ketika integrasi membutuhkan container-level contract:

- pooled connection ke EIS proprietary;
- XA transaction dengan resource external;
- inbound event/message delivery ke application server;
- deployment sebagai `.rar` resource adapter;
- reusable connector untuk banyak aplikasi;
- enterprise app server governance;
- security/credential mapping oleh container;
- recovery semantics penting.

JCA mungkin terlalu berat ketika:

- hanya HTTP client sederhana;
- hanya REST/JSON call stateless;
- aplikasi berjalan di Spring Boot standalone tanpa app server JCA support;
- transaction tidak perlu melibatkan EIS;
- connector hanya wrapper tipis atas SDK vendor.

Decision heuristic:

```text
Jika masalahnya hanya “memanggil API eksternal”, gunakan client library biasa.
Jika masalahnya “mengintegrasikan EIS ke container contract”, pertimbangkan JCA.
```

---

## 0.10. Mental Model Integrasi: 7 Boundary yang Harus Dipisahkan

Agar tidak terjebak desain rapuh, pisahkan 7 boundary berikut.

### Boundary 1 — Wire Format

Ini format aktual di jaringan/storage:

```text
JSON bytes
XML bytes
SOAP envelope
MIME multipart
MTOM/XOP package
binary attachment
```

Pertanyaan desain:

- Apa encoding-nya?
- Apa content type-nya?
- Apakah field order penting?
- Apakah whitespace penting?
- Apakah payload ditandatangani?
- Apakah payload boleh di-normalize?
- Apakah attachment dihitung dalam signature?

### Boundary 2 — Parser Model

Cara membaca bytes:

```text
JSON-P object model
JSON-P streaming
DOM
SAX
StAX
SAAJ
JAX-WS runtime
JAXB unmarshaller
```

Pertanyaan desain:

- Payload kecil atau besar?
- Perlu random access atau sequential scan?
- Perlu preserve struktur asli?
- Perlu validate saat parsing?
- Perlu streaming attachment?
- Aman dari XXE/entity expansion?

### Boundary 3 — Binding Model

Cara mengubah dokumen menjadi object:

```text
JSON-B DTO
Jackson DTO
JAXB-generated class
JAXB handwritten class
Map/tree model
custom adapter
```

Pertanyaan desain:

- Apakah object ini domain object atau boundary DTO?
- Apa makna null vs absent?
- Unknown field harus ditolak atau diabaikan?
- Enum unknown value bagaimana?
- Numeric precision harus `BigDecimal`?
- Date/time pakai timezone apa?

### Boundary 4 — Contract Model

Definisi resmi yang harus dipenuhi:

```text
OpenAPI
JSON Schema
XSD
WSDL
WS-Policy
vendor PDF spec
sample payload agreement
```

Pertanyaan desain:

- Mana source of truth?
- Siapa owner contract?
- Bagaimana versioning?
- Apa backward-compatible change?
- Apa breaking change?
- Bagaimana contract test dijalankan?

### Boundary 5 — Domain Boundary

Bagian aplikasi internal yang tidak boleh bocor ke external contract.

```text
External DTO → validation → command/query → domain service
```

Pertanyaan desain:

- Apakah external field langsung masuk entity?
- Apakah generated JAXB class dipakai di domain?
- Apakah SOAP fault langsung dilempar ke UI?
- Apakah vendor enum bocor ke business logic?
- Apakah internal refactoring akan merusak contract?

Prinsip kuat:

```text
Generated classes are boundary artifacts, not domain models.
```

Tidak mutlak, tetapi sebagai default sangat aman.

### Boundary 6 — Runtime Contract

Siapa yang mengelola execution:

```text
plain Java main
Spring Boot
Jakarta EE app server
Servlet container + Metro
JAX-WS runtime
JCA-capable application server
Kubernetes workload
batch worker
```

Pertanyaan desain:

- Siapa menyediakan API/implementation?
- Siapa mengelola thread?
- Siapa mengelola transaction?
- Siapa mengelola connection pool?
- Siapa mengelola security identity?
- Siapa mengelola classloader?

### Boundary 7 — Operational Contract

Guarantee production:

```text
timeout
retry
idempotency
audit trail
correlation ID
metrics
logging redaction
dead letter
replay
schema validation
certificate rotation
```

Pertanyaan desain:

- Apa yang terjadi jika provider timeout setelah memproses request?
- Bolehkah retry?
- Bagaimana mendeteksi duplicate?
- Payload apa yang boleh disimpan di log?
- Bagaimana replay aman?
- Apa evidence untuk audit?
- Apa alert threshold?

---

## 0.11. Decision Matrix: Pilih Apa untuk Problem Apa?

### 0.11.1. JSON-P vs JSON-B vs Jackson

| Problem | Pilihan Awal | Alasan |
|---|---|---|
| Jakarta EE REST DTO standar | JSON-B | Portable Jakarta standard. |
| Transform JSON dokumen tanpa class | JSON-P | Work at document level. |
| Large JSON array jutaan item | JSON-P streaming | Tidak load seluruh dokumen. |
| JSON Patch/Merge Patch | JSON-P | Ada API standar. |
| Spring Boot API | Jackson | Default ecosystem Spring. |
| Complex polymorphic object graph | Jackson dengan guardrail | Feature lengkap, tapi security perlu ketat. |
| Canonical deterministic JSON | JSON-P/custom generator | Lebih eksplisit. |
| Audit parsing unknown field strict | JSON-B/Jackson custom config | Perlu policy jelas. |

### 0.11.2. XML Parser Choice

| Problem | Pilihan Awal | Hindari |
|---|---|---|
| XML kecil, perlu navigasi tree | DOM | DOM untuk file besar. |
| XML besar, sequential processing | StAX | DOM full load. |
| Event push processing | SAX | Jika butuh kontrol pull. |
| SOAP message low-level | SAAJ/StAX | String manipulation. |
| XML object mapping | JAXB | Manual XPath scattered. |
| XML validation against schema | SchemaFactory + validator | Regex/XML string hack. |
| XML transform | XSLT jika cocok | Manual string replace. |

### 0.11.3. SOAP/JAX-WS Choice

| Problem | Pilihan Awal | Catatan |
|---|---|---|
| Existing WSDL external provider | Generate JAX-WS client | Contract-first. |
| Need expose SOAP endpoint | JAX-WS server | Pastikan runtime support. |
| Need manipulate headers manually | Handler/SAAJ | Jangan string concat XML. |
| Need binary attachment | MTOM/SAAJ | Perhatikan memory. |
| Need modernize SOAP | Facade/anti-corruption layer | Jangan rewrite big-bang. |
| Need WS-Security | Runtime/vendor stack support | Detail interoperabilitas penting. |

### 0.11.4. JCA Choice

| Problem | Pilihan Awal | Catatan |
|---|---|---|
| JDBC database | JDBC/DataSource | Tidak perlu JCA custom. |
| JMS broker | JMS resource adapter/container integration | Tergantung server. |
| Proprietary EIS with connection/session | JCA outbound RA | Jika container-managed contract dibutuhkan. |
| Inbound event from EIS | JCA inbound RA | ActivationSpec/message endpoint. |
| XA across EIS and DB | JCA XA support | Kompleks, test recovery wajib. |
| Simple REST API vendor | HTTP client | JCA biasanya overkill. |

---

## 0.12. Architecture Pattern: Anti-Corruption Layer untuk Integrasi

Untuk enterprise integration, pola paling aman adalah memisahkan external model dari internal model.

```text
External Payload
    ↓
Parser / Binder
    ↓
External Contract Model
    ↓
Contract Validation
    ↓
Anti-Corruption Mapper
    ↓
Internal Command / Query Model
    ↓
Domain/Application Service
    ↓
Persistence / Workflow / Event
```

Contoh SOAP:

```text
WSDL/XSD-generated classes
    ↓
JAX-WS endpoint/client
    ↓
SoapContractValidator
    ↓
SoapToDomainMapper
    ↓
RegisterCaseCommand
    ↓
CaseApplicationService
```

Contoh JSON:

```text
JSON-B RequestDto
    ↓
Jakarta Validation
    ↓
DtoToCommandMapper
    ↓
SubmitApplicationCommand
    ↓
ApplicationService
```

Contoh JCA:

```text
EIS Record
    ↓
Resource Adapter
    ↓
Message Endpoint
    ↓
EisRecordTranslator
    ↓
Domain Command
    ↓
Transactional Service
```

Kenapa ini penting?

Karena external contract berubah dengan alasan external. Domain berubah dengan alasan internal. Jika keduanya dicampur, setiap perubahan vendor/regulator akan menginfeksi core system.

### 0.12.1. Rule: External Model Is Not Domain Model

Default rule:

```text
JAXB generated classes: boundary only
JSON DTOs: boundary only
SOAP fault classes: boundary only
JCA record classes: boundary only
```

Kapan boleh dilanggar?

- aplikasi kecil;
- contract internal dan lifecycle sama;
- tidak ada audit/long-term compatibility requirement;
- biaya mapping lebih besar daripada risiko coupling.

Tetapi untuk sistem besar, terutama regulatory/government/financial, pemisahan ini hampir selalu sepadan.

---

## 0.13. Contract Evolution: Skill yang Membedakan Engineer Senior

Integrasi gagal bukan hanya karena bug. Sering gagal karena contract berubah tanpa strategi.

### 0.13.1. Backward-Compatible Change

Biasanya aman:

- menambah optional field;
- menambah optional XML element dengan `minOccurs=0`;
- menambah enum hanya jika consumer siap unknown value;
- menambah SOAP header optional;
- memperluas documentation tanpa mengubah schema;
- menambah endpoint version baru.

### 0.13.2. Breaking Change

Biasanya berbahaya:

- rename field/element;
- mengubah namespace;
- mengubah required menjadi optional atau sebaliknya tanpa agreement;
- mengubah tipe string menjadi number;
- mengubah date format;
- mengubah numeric precision;
- menghapus field;
- mengubah operation signature WSDL;
- mengubah SOAP fault structure;
- mengubah semantics tanpa mengubah schema.

Yang terakhir paling berbahaya:

```text
Schema sama, makna berubah.
```

Contoh:

```text
status = "APPROVED"
```

Dulu berarti final approval. Sekarang berarti preliminary approval. Schema tidak berubah, tetapi downstream logic bisa salah.

### 0.13.3. Compatibility Requires Tests

Contract governance tanpa test hanya dokumentasi.

Minimal test strategy:

```text
1. Golden payload test
2. Schema validation test
3. Unknown field behavior test
4. Missing field behavior test
5. Namespace regression test
6. Fault mapping test
7. Round-trip marshalling test
8. Version compatibility test
9. Large payload test
10. Security malicious payload test
```

---

## 0.14. Security Baseline untuk Seri Ini

Security di JSON/XML/SOAP/JCA sering bukan tentang “login”. Ini tentang input processing dan trust boundary.

### 0.14.1. JSON Threats

- deeply nested JSON causing stack/memory pressure;
- huge arrays;
- duplicate keys;
- numeric overflow/precision loss;
- polymorphic deserialization abuse;
- log injection;
- template injection after parsing;
- unknown fields silently ignored;
- data exfiltration via over-broad serialization;
- inconsistent date/time parsing;
- null/absent confusion.

### 0.14.2. XML Threats

- XXE;
- entity expansion / billion laughs;
- external DTD access;
- SSRF through parser;
- XInclude abuse;
- XPath injection;
- XSLT unsafe extension;
- schema poisoning;
- XML Signature Wrapping;
- canonicalization mismatch;
- namespace confusion.

### 0.14.3. SOAP Threats

- header spoofing;
- replay attack;
- weak timestamp validation;
- signature wrapping;
- certificate trust misconfiguration;
- insecure SOAPAction assumptions;
- attachment abuse;
- oversized envelope;
- fault information leakage;
- WS-Security interoperability gaps.

### 0.14.4. JCA Threats

- credential propagation leakage;
- connection reuse across identities;
- XA recovery misconfiguration;
- poison inbound messages;
- unbounded WorkManager tasks;
- resource adapter classloader leaks;
- EIS session corruption;
- transaction timeout mismatch;
- insecure deployment descriptor config.

Top-tier rule:

```text
Parser/binder configuration is security configuration.
```

---

## 0.15. Performance Baseline

Performance di area ini sering ditentukan oleh pilihan parsing/binding, bukan hanya CPU.

### 0.15.1. JSON

Object binding mudah, tetapi bisa mahal:

```text
bytes → parser tokens → intermediate model/object → validation → domain object
```

Untuk payload besar:

```text
streaming parser → process item by item → bounded memory
```

Jangan load seluruh JSON array besar jika bisa diproses streaming.

### 0.15.2. XML

DOM adalah tree penuh di memory. Untuk XML besar, DOM bisa menjadi bom memory.

```text
DOM:
    easy navigation
    expensive memory

SAX:
    push event
    low memory
    harder control flow

StAX:
    pull event
    low memory
    better control in Java application logic

JAXB:
    convenient binding
    can be expensive if context recreated repeatedly
```

`JAXBContext` mahal dibuat. Biasanya cache per set class/package.

### 0.15.3. SOAP

SOAP cost datang dari:

- XML parsing;
- schema validation;
- JAXB binding;
- handler chain;
- WS-Security signature/encryption;
- attachment buffering;
- network latency;
- generated proxy overhead;
- TLS handshake;
- logging payload besar.

SOAP performance tuning tidak boleh dimulai dari micro-optimization. Mulai dari:

```text
timeout budget
payload size
attachment strategy
connection reuse
security processing cost
schema validation policy
logging policy
retry behavior
```

### 0.15.4. JCA

JCA performance ditentukan oleh:

- pool size;
- connection validation;
- transaction enlistment;
- EIS latency;
- WorkManager thread usage;
- inbound delivery concurrency;
- recovery scanning;
- backpressure behavior;
- poison message handling.

---

## 0.16. Observability Baseline

Integrasi tanpa observability akan sulit dioperasikan.

Minimal telemetry:

```text
correlation_id
external_system
operation_name
contract_version
payload_type
request_size
response_size
status_class
fault_code
error_category
timeout_ms
latency_ms
retry_count
idempotency_key
schema_validation_result
certificate_alias/version
adapter_pool_metrics
```

### 0.16.1. Jangan Log Payload Sembarangan

Payload JSON/XML/SOAP sering berisi:

- PII;
- credential;
- access token;
- address;
- personal identifier;
- financial data;
- confidential case content;
- digital signature;
- binary attachment.

Gunakan policy:

```text
Log metadata by default.
Log payload only under controlled debug mode.
Redact sensitive fields.
Store audit payload separately with retention and access control.
Hash payload if only integrity comparison needed.
```

### 0.16.2. Error Category Lebih Berguna daripada Stack Trace Mentah

Gunakan taxonomy:

```text
TRANSPORT_TIMEOUT
TRANSPORT_CONNECTION_FAILED
TLS_HANDSHAKE_FAILED
AUTHENTICATION_FAILED
AUTHORIZATION_FAILED
SCHEMA_VALIDATION_FAILED
NAMESPACE_MISMATCH
UNMARSHAL_FAILED
BUSINESS_FAULT
SOAP_FAULT_UNMODELED
REMOTE_5XX
REMOTE_4XX
RETRY_EXHAUSTED
DUPLICATE_MESSAGE
XA_RECOVERY_FAILED
RESOURCE_POOL_EXHAUSTED
```

Ini membuat incident response lebih cepat.

---

## 0.17. Testing Strategy dari Awal

Seri ini akan sering memakai pendekatan test-first untuk contract.

### 0.17.1. Golden Payload Test

Simpan payload representatif:

```text
src/test/resources/contracts/vendor-a/request-valid-minimal.xml
src/test/resources/contracts/vendor-a/request-valid-full.xml
src/test/resources/contracts/vendor-a/response-business-fault.xml
src/test/resources/contracts/vendor-a/response-invalid-namespace.xml
src/test/resources/contracts/vendor-a/response-large.xml
```

Test bukan hanya happy path.

### 0.17.2. Round-Trip Test

Untuk binding:

```text
object → XML/JSON → object
```

Tetapi hati-hati: round-trip bisa memberi rasa aman palsu. Jika serializer dan deserializer sama-sama salah, test tetap hijau.

Tambahkan:

```text
external sample payload → object → assertion semantic
object → generated payload → schema validation → compare important XML paths
```

### 0.17.3. Contract Compatibility Test

Untuk schema/WSDL:

- validate generated XML against XSD;
- validate sample vendor XML against local model;
- ensure namespace unchanged;
- ensure required elements preserved;
- ensure generated client can compile;
- ensure generated artifacts are deterministic or diffable.

### 0.17.4. Malicious Payload Test

Harus ada test untuk:

- XXE;
- billion laughs/entity expansion;
- large JSON nesting;
- duplicate JSON keys;
- oversized payload;
- invalid numeric precision;
- unknown enum;
- SOAP fault with unexpected structure;
- attachment too large.

---

## 0.18. Dependency and Runtime Strategy

Satu mistake umum: hanya menambah API artifact, lupa implementation.

Contoh salah:

```xml
<dependency>
  <groupId>jakarta.xml.bind</groupId>
  <artifactId>jakarta.xml.bind-api</artifactId>
</dependency>
```

API saja tidak selalu cukup untuk runtime marshalling/unmarshalling. Anda butuh implementation/provider, misalnya JAXB runtime implementation.

Mental model:

```text
API artifact        = interfaces/classes used by source code
implementation      = provider that actually runs
container feature   = app server may provide API + implementation
build plugin/tool   = generates source from schema/WSDL
```

### 0.18.1. App Server vs Standalone

Di app server Jakarta EE:

```text
Application may rely on server-provided APIs/features
```

Di Spring Boot/plain Java:

```text
Application must package needed APIs and implementations explicitly
```

Risiko kalau salah:

- `ClassNotFoundException`;
- `NoClassDefFoundError`;
- `NoSuchMethodError`;
- provider not found;
- duplicate implementation conflict;
- javax/jakarta mismatch;
- classloader leak;
- runtime works in local but fails in server.

### 0.18.2. Build-Time Generated Code

XJC/JAX-WS generation bukan detail kecil. Ia menentukan source compatibility.

```text
XSD/WSDL
→ generator plugin version
→ generated package namespace javax/jakarta
→ source code imports
→ runtime API version
→ application server support
```

Jika satu elemen berbeda, build bisa berhasil tetapi runtime gagal.

---

## 0.19. Practical Migration Map

### 0.19.1. Java 8 Legacy App dengan JAXB/JAX-WS Built-in

Masalah umum saat upgrade:

```text
Compile error: package javax.xml.bind does not exist
Runtime error: JAXBException provider not found
wsimport/xjc tool missing
javax.activation missing
SAAJ provider missing
```

Strategi:

1. Inventory semua import `javax.xml.bind`, `javax.xml.ws`, `javax.xml.soap`, `javax.activation`.
2. Inventory generated code.
3. Inventory Maven/Gradle plugins.
4. Tentukan tetap `javax` atau pindah `jakarta`.
5. Tambahkan API + implementation dependencies eksplisit.
6. Regenerate artifacts jika pindah namespace.
7. Jalankan golden payload tests.
8. Jalankan SOAP integration tests.
9. Validasi runtime di target container.

### 0.19.2. Java 17/21 Modern App yang Harus Panggil SOAP Legacy

Strategi umum:

```text
Modern app core tetap clean
SOAP client ditempatkan di adapter module
WSDL-generated classes tidak bocor ke domain
Mapping eksplisit ke internal command/result
Timeout/retry/idempotency didefinisikan di adapter boundary
Golden payload dan fault tests wajib
```

Struktur modul:

```text
app-core
app-usecase
adapter-soap-vendor-a
adapter-rest-public-api
adapter-persistence
```

### 0.19.3. Jakarta EE 10/11 App dengan SOAP Requirement

Jangan asumsikan SOAP/XML Binding otomatis tersedia. Pastikan:

- server mendukung feature yang dibutuhkan;
- API dan implementation sesuai namespace;
- deployment descriptor kompatibel;
- generated artifacts cocok;
- CI environment punya generator tools;
- runtime image memuat dependency yang benar.

---

## 0.20. Common Anti-Patterns

### Anti-Pattern 1 — String Concatenation XML/SOAP

```java
String xml = "<name>" + userInput + "</name>";
```

Masalah:

- escaping salah;
- injection;
- namespace rusak;
- signature invalid;
- encoding error;
- maintainability buruk.

Gunakan XML API/binder.

### Anti-Pattern 2 — Domain Entity Langsung Jadi JSON/XML Contract

```text
JPA Entity == REST DTO == JAXB Model == SOAP Model
```

Masalah:

- lazy loading leak;
- accidental data exposure;
- contract berubah saat database berubah;
- circular reference;
- migration sulit;
- audit tidak jelas.

### Anti-Pattern 3 — Mengabaikan Namespace XML

```text
Element local name sama ≠ element sama
```

XML element identity adalah:

```text
{namespaceURI}localName
```

Bukan hanya `localName`.

### Anti-Pattern 4 — Recreate JAXBContext per Request

```java
JAXBContext.newInstance(MyClass.class); // setiap request
```

Ini mahal. Cache context.

### Anti-Pattern 5 — Retry Semua SOAP Error

Tidak semua error boleh di-retry.

```text
Timeout after remote processed request → retry bisa duplicate
Schema validation error → retry tidak berguna
Business fault → retry biasanya salah
Transient 503 → retry mungkin benar
```

### Anti-Pattern 6 — Silent Unknown Field

Untuk beberapa API, ignore unknown field bagus untuk forward compatibility. Untuk regulatory payload, silent unknown field bisa berbahaya karena sistem menerima data yang tidak dipahami.

Policy harus eksplisit:

```text
Public API: maybe ignore unknown fields
Regulatory submission: maybe reject unknown fields
Internal event: depends on versioning model
```

### Anti-Pattern 7 — Generated Code Diedit Manual

Jangan edit generated JAXB/JAX-WS classes secara manual kecuali benar-benar tahu konsekuensinya. Gunakan binding customization, wrapper, adapter, atau mapper.

### Anti-Pattern 8 — Treat SOAP as REST with XML Body

SOAP bukan sekadar HTTP POST XML. Header, fault, binding, WSDL, SOAPAction, namespace, dan WS-* policy bisa menentukan behavior.

### Anti-Pattern 9 — JCA untuk Semua Integrasi

JCA powerful, tetapi berat. Jangan membuat resource adapter hanya untuk memanggil REST API sederhana.

### Anti-Pattern 10 — Tidak Punya Sample Payload dari Real World

Schema saja tidak cukup. Real system sering mengirim variasi yang tidak tampak di dokumentasi.

---

## 0.21. Top 1% Engineering Lens

Untuk menjadi sangat kuat di area ini, target pemahaman bukan “bisa pakai API”. Targetnya adalah bisa menjawab pertanyaan seperti berikut.

### 0.21.1. Contract Questions

- Apa source of truth contract?
- Siapa consumer dan provider?
- Apa yang dianggap backward-compatible?
- Bagaimana versioning dilakukan?
- Apa payload lama masih bisa dibaca?
- Apa payload baru tidak merusak consumer lama?
- Bagaimana contract diuji di CI?

### 0.21.2. Runtime Questions

- Siapa menyediakan implementation?
- Apakah API berasal dari JDK, dependency, atau container?
- Apakah Java 11+ migration aman?
- Apakah namespace javax/jakarta konsisten?
- Apakah classloader server memengaruhi provider discovery?
- Apakah generated code cocok dengan runtime?

### 0.21.3. Security Questions

- Parser sudah hardened?
- XXE disabled?
- External entity access disabled?
- Polymorphic deserialization aman?
- Unknown field policy eksplisit?
- Payload logging aman?
- SOAP signature diverifikasi dengan benar?
- Replay protection ada?

### 0.21.4. Reliability Questions

- Timeout budget berapa?
- Retry policy berdasarkan failure category apa?
- Idempotency key ada?
- Duplicate detection ada?
- Fault mapping jelas?
- Recovery path ada?
- Dead letter/replay process ada?

### 0.21.5. Operability Questions

- Bisa trace request end-to-end?
- Bisa membedakan network error vs schema error?
- Bisa memberi vendor escalation packet?
- Bisa replay payload aman?
- Bisa rotate certificate tanpa downtime?
- Bisa monitor pool/resource adapter?

### 0.21.6. Evolution Questions

- Jika vendor mengubah optional field, apa yang terjadi?
- Jika enum bertambah, apa yang terjadi?
- Jika namespace berubah, apa yang gagal?
- Jika WSDL berubah, apakah generated code diff terlihat?
- Jika Java upgrade ke 21/25, dependency mana yang berisiko?

---

## 0.22. Reference Architecture: Integration Module Layout

Contoh struktur aplikasi modular:

```text
src/main/java/com/example
├── core
│   ├── domain
│   ├── usecase
│   └── port
│
├── adapter
│   ├── jsonapi
│   │   ├── dto
│   │   ├── mapper
│   │   └── controller
│   │
│   ├── soap
│   │   ├── vendora
│   │   │   ├── generated
│   │   │   ├── client
│   │   │   ├── mapper
│   │   │   ├── fault
│   │   │   └── testdata
│   │   │
│   │   └── vendorb
│   │
│   ├── xmlbatch
│   │   ├── schema
│   │   ├── parser
│   │   ├── binding
│   │   └── mapper
│   │
│   └── jca
│       ├── outbound
│       ├── inbound
│       ├── activation
│       └── recovery
│
└── infrastructure
    ├── observability
    ├── security
    └── config
```

Build/resource layout:

```text
src/main/resources/contracts
├── json
│   ├── public-api-v1
│   └── partner-api-v2
├── xsd
│   ├── agency-a
│   └── agency-b
├── wsdl
│   ├── payment-provider
│   └── identity-provider
└── samples
    ├── valid
    ├── invalid
    ├── faults
    └── malicious
```

Testing layout:

```text
src/test/java
├── contract
├── binding
├── security
├── performance
├── compatibility
└── integration
```

---

## 0.23. Minimal Baseline Project Dependencies: Conceptual View

Jangan copy mentah tanpa menyesuaikan versi. Ini peta konseptual.

### JSON-P / JSON-B

```text
API:
  jakarta.json:jakarta.json-api
  jakarta.json.bind:jakarta.json.bind-api

Implementation examples:
  org.eclipse.parsson:parsson
  org.eclipse:yasson
```

### JAXB / XML Binding

```text
API:
  jakarta.xml.bind:jakarta.xml.bind-api

Implementation examples:
  org.glassfish.jaxb:jaxb-runtime

Tools:
  xjc plugin / jaxb maven plugin variant sesuai javax/jakarta target
```

### JAX-WS / XML Web Services

```text
API:
  jakarta.xml.ws:jakarta.xml.ws-api

Implementation examples:
  Eclipse Metro / JAX-WS RI

Tools:
  wsimport/wsgen via Maven/Gradle plugin
```

### SOAP/SAAJ

```text
API:
  jakarta.xml.soap:jakarta.xml.soap-api

Implementation examples:
  Eclipse Metro SAAJ implementation
```

### JCA / Connectors

```text
API:
  jakarta.resource:jakarta.resource-api

Runtime:
  Jakarta EE application server with connector support
```

Key idea:

```text
API dependency lets code compile.
Implementation/runtime makes it work.
Tool/plugin generates code.
Container may provide some or all of these.
```

---

## 0.24. Learning Roadmap After This Part

Setelah Part 0, seri akan bergerak seperti ini:

```text
Part 1–11   : JSON as contract and processing/binding
Part 12–15  : XML fundamentals, schema, parser security
Part 16–21  : JAXB / Jakarta XML Binding deeply
Part 22–30  : SOAP, WSDL, JAX-WS, SAAJ, WS-* and modernization
Part 31–33  : Jakarta Connectors/JCA
Part 34     : Capstone integration architecture and production checklist
```

Part 0 sengaja tidak masuk terlalu dalam ke syntax API. Syntax tanpa peta mental akan membuat materi berikutnya terasa seperti hafalan.

---

## 0.25. Practical Checklist untuk Mulai Project Integrasi

Gunakan checklist ini setiap kali memulai integrasi JSON/XML/SOAP/JCA.

### Contract

- [ ] Source of truth contract jelas.
- [ ] Owner contract jelas.
- [ ] Versioning strategy jelas.
- [ ] Backward compatibility rule disepakati.
- [ ] Sample payload valid/invalid tersedia.
- [ ] Schema/WSDL/OpenAPI disimpan di repository.

### Runtime

- [ ] Target Java version jelas.
- [ ] Namespace `javax` atau `jakarta` konsisten.
- [ ] API dependency jelas.
- [ ] Implementation dependency jelas.
- [ ] App server/container feature jelas.
- [ ] Generated code strategy jelas.
- [ ] CI punya generator tools.

### Security

- [ ] Parser hardened.
- [ ] XXE/external entity disabled untuk XML.
- [ ] Payload size limit ada.
- [ ] Unknown field policy jelas.
- [ ] Sensitive logging redaction ada.
- [ ] SOAP security policy jelas jika digunakan.
- [ ] Certificate/truststore lifecycle jelas.

### Reliability

- [ ] Timeout budget jelas.
- [ ] Retry policy berbasis failure category.
- [ ] Idempotency strategy ada.
- [ ] Duplicate detection ada jika retry mungkin berbahaya.
- [ ] Fault/error mapping jelas.
- [ ] Dead letter/replay process ada jika async/inbound.

### Observability

- [ ] Correlation ID end-to-end.
- [ ] Metrics per external operation.
- [ ] Error taxonomy terstruktur.
- [ ] Payload hash/audit strategy jelas.
- [ ] Vendor escalation packet bisa dibuat.

### Testing

- [ ] Golden payload tests.
- [ ] Schema validation tests.
- [ ] Round-trip binding tests.
- [ ] Namespace regression tests.
- [ ] Fault mapping tests.
- [ ] Malicious payload tests.
- [ ] Large payload tests.
- [ ] Java version compatibility tests.

---

## 0.26. Mini Case Study: SOAP Legacy Provider di Java 21 Service

### Situasi

Aplikasi Java 21 modern harus memanggil provider SOAP lama. Provider memberi WSDL dan XSD. Response bisa sukses atau SOAP Fault. Payload mengandung personal data. Provider kadang timeout.

### Desain Lemah

```text
Controller langsung panggil generated SOAP client
Generated JAXB class dipakai sebagai domain object
Timeout default
Retry semua exception
Log full XML payload
Tidak ada schema/fault tests
```

Risiko:

- duplicate submission;
- PII leak di log;
- contract change merusak domain;
- incident sulit dianalisis;
- Java upgrade merusak dependency;
- SOAP fault tidak dimapping jelas;
- timeout after remote processing menghasilkan double action.

### Desain Lebih Kuat

```text
adapter-soap-provider-x
├── generated classes from WSDL/XSD
├── ProviderXClient
├── ProviderXFaultClassifier
├── ProviderXMapper
├── ProviderXTimeoutConfig
├── ProviderXAuditPolicy
└── contract tests

core
└── SubmitApplicationUseCase
```

Flow:

```text
Use case command
→ ProviderXMapper
→ generated SOAP request
→ JAX-WS client with explicit timeout
→ response/fault classifier
→ mapped internal result
→ audit metadata + payload hash
```

Retry policy:

```text
Schema error: no retry
Business fault: no retry
Connection refused: retry if safe
Read timeout: retry only if operation idempotent or duplicate detection exists
SOAP fault transient: depends on fault code/vendor agreement
```

Observability:

```text
external_system=PROVIDER_X
operation=SubmitApplication
contract_version=wsdl-2025-09
correlation_id=...
request_hash=...
latency_ms=...
error_category=BUSINESS_FAULT | TRANSPORT_TIMEOUT | SCHEMA_VALIDATION_FAILED
```

Ini contoh perbedaan antara “bisa call SOAP” dan “bisa mengoperasikan integrasi SOAP secara production-grade”.

---

## 0.27. Mini Case Study: Large JSON Batch Import

### Situasi

Sistem menerima JSON array berisi 500.000 record. Engineer menggunakan JSON-B untuk bind seluruh payload ke `List<RecordDto>`.

### Masalah

```text
request bytes → full parse → List<RecordDto> huge → validation → memory pressure → GC spike/OOM
```

### Desain Lebih Baik

Gunakan streaming:

```text
JsonParser
→ read one record object
→ validate one record
→ map to command
→ process in bounded batch
→ checkpoint progress
→ collect partial errors
```

Operational improvements:

- memory bounded;
- partial failure report;
- progress checkpoint;
- backpressure possible;
- easier retry by chunk;
- no giant object graph.

Ini alasan JSON-P tetap penting walaupun JSON-B/Jackson lebih nyaman.

---

## 0.28. Mini Case Study: XML Parser Security

### Situasi

Aplikasi menerima XML upload dari external party. Developer menggunakan default `DocumentBuilderFactory`.

### Risiko

Default parser configuration bisa membuka risiko tergantung implementation/config:

- external entity resolution;
- DTD processing;
- SSRF;
- entity expansion;
- memory exhaustion.

### Desain Lebih Aman

Gunakan secure parser factory:

```text
Disable DOCTYPE if not needed
Disable external general entities
Disable external parameter entities
Disable external DTD loading
Enable secure processing
Limit input size
Validate against expected schema only
```

Prinsip:

```text
Never parse untrusted XML with casual defaults.
```

Detail implementasi akan dibahas di Part 15.

---

## 0.29. Apa yang Harus Dikuasai Setelah Part 0?

Setelah membaca Part 0, Anda harus bisa menjelaskan:

1. Kenapa JSON/XML/SOAP/JCA adalah integration contract technologies, bukan sekadar serialization tools.
2. Kenapa Java 8 ke Java 11+ sering mematahkan JAXB/JAX-WS/SAAJ.
3. Kenapa `javax.*` dan `jakarta.*` tidak boleh dicampur sembarangan.
4. Kapan JSON-P lebih tepat daripada JSON-B.
5. Kapan JAXB schema-first lebih defensible daripada code-first.
6. Kenapa XML namespace adalah bagian identitas data.
7. Kenapa SOAP masih hidup di enterprise.
8. Apa peran WSDL, XSD, SOAP, JAX-WS, dan SAAJ.
9. Kapan Jakarta Connectors/JCA masuk akal.
10. Boundary apa saja yang harus dipisahkan dalam desain integrasi.
11. Apa baseline security untuk JSON/XML/SOAP/JCA.
12. Apa baseline observability dan testing untuk integration layer.

---

## 0.30. Latihan Berpikir

Jawab sendiri sebelum lanjut ke Part 1.

### Latihan 1 — JSON Mapper Choice

Anda menerima JSON payload 2 GB berisi array transaksi. Apakah Anda akan memakai JSON-B untuk bind ke `List<TransactionDto>`? Jelaskan trade-off dan alternatifnya.

### Latihan 2 — XML Namespace

Dua XML payload memiliki element `<Status>APPROVED</Status>`, tetapi namespace berbeda. Apakah keduanya sama? Apa risiko jika parser hanya melihat local name?

### Latihan 3 — Java 8 ke Java 21

Aplikasi Java 8 memakai `javax.xml.bind.JAXBContext` tanpa dependency Maven. Apa yang mungkin rusak saat pindah ke Java 21? Apa langkah inventory yang harus dilakukan?

### Latihan 4 — SOAP Retry

SOAP call timeout setelah 30 detik. Provider mungkin sudah memproses request. Apakah aman retry? Informasi apa yang Anda butuhkan?

### Latihan 5 — JCA vs HTTP Client

Vendor menyediakan REST API stateless. Apakah perlu membuat Jakarta Connector resource adapter? Kapan jawabannya berubah menjadi ya?

---

## 0.31. Ringkasan Part 0

Seri ini akan memperlakukan JSON, XML, SOAP, dan JCA sebagai fondasi integrasi enterprise, bukan sebagai API hafalan.

Model utama:

```text
External Contract
→ Parser/Binder
→ Boundary Model
→ Domain Translation
→ Runtime Contract
→ Security/Reliability/Observability
→ Evolution Strategy
```

Kesimpulan penting:

- JSON-P adalah API standar untuk processing JSON dokumen dan streaming.
- JSON-B adalah API standar untuk binding Java object ↔ JSON.
- XML memiliki model berbeda dari JSON: namespace, schema, attributes, mixed content, canonicalization.
- JAXB/Jakarta XML Binding adalah contract-aware XML object projection, bukan sekadar XML ObjectMapper.
- SOAP adalah message protocol dengan WSDL/XSD contract dan extensibility model.
- JAX-WS/Jakarta XML Web Services adalah programming model untuk XML/SOAP web services.
- SAAJ/Jakarta SOAP with Attachments memungkinkan manipulasi SOAP message low-level.
- Jakarta Connectors/JCA adalah container-level integration contract untuk EIS, bukan sekadar library connector.
- Java 11+ mengharuskan dependency strategy eksplisit untuk JAXB/JAX-WS/SAAJ yang dulu banyak diasumsikan tersedia di JDK 8.
- Jakarta EE modern membutuhkan perhatian pada namespace, platform support, dan standalone dependency.

---

## 0.32. Referensi Resmi dan Sumber Lanjutan

Sumber-sumber berikut dipakai untuk mengunci fakta versi/spec di Part 0 dan akan menjadi rujukan sepanjang seri:

1. OpenJDK JEP 320 — Remove the Java EE and CORBA Modules  
   https://openjdk.org/jeps/320

2. Oracle JDK 11 Migration Guide — Removal of Java EE and CORBA Modules  
   https://docs.oracle.com/en/java/javase/11/migrate/

3. Jakarta JSON Processing Specification  
   https://jakarta.ee/specifications/jsonp/

4. Jakarta JSON Binding Specification  
   https://jakarta.ee/specifications/jsonb/

5. Jakarta XML Binding Specification  
   https://jakarta.ee/specifications/xml-binding/

6. Jakarta XML Web Services Specification  
   https://jakarta.ee/specifications/xml-web-services/

7. Jakarta SOAP with Attachments Specification  
   https://jakarta.ee/specifications/soap-attachments/

8. Jakarta Connectors Specification  
   https://jakarta.ee/specifications/connectors/

9. Jakarta EE 11 Release Notes / Specification Page  
   https://jakarta.ee/release/11/

10. Jakarta EE Platform 11 Specification  
    https://jakarta.ee/specifications/platform/11/

11. Eclipse Metro / Jakarta XML Web Services Implementation  
    https://eclipse-ee4j.github.io/metro-jax-ws/

12. Eclipse Metro / Jakarta SOAP with Attachments Implementation  
    https://eclipse-ee4j.github.io/metro-saaj/

---

## Status Seri

- Part ini: **Part 0 — Orientation & Mental Model** selesai.
- Seri belum selesai.
- Berikutnya: **Part 1 — Data Format as Contract: JSON vs XML sebagai boundary contract, schema-first vs code-first, backward compatibility, versioning, consumer-driven constraints, dan canonical model anti-pattern.**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 29 — Top 1% Design Review: Evaluating a Mail Subsystem Like an Architect](../mail/29-top-one-percent-design-review.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 1 — Data Format as Contract: JSON, XML, XSD, WSDL, and Integration Compatibility](./learn-java-json-xml-soap-connectors-enterprise-integration-part-001.md)
