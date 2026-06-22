# learn-java-json-xml-soap-connectors-enterprise-integration-part-002

# Part 2 — Java JSON Ecosystem Map: JSON-P, JSON-B, Jackson, Gson, Provider Runtime, dan Pilihan Library yang Benar

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Bagian: `Part 2 dari 34`  
> Target Java: Java 8 sampai Java 25  
> Fokus: memahami ekosistem JSON di Java secara struktural, bukan sekadar hafal API serialize/deserialize.

---

## 0. Tujuan Bagian Ini

Setelah Part 0 dan Part 1, kita sudah membangun fondasi bahwa format data adalah **kontrak antar boundary**. Sekarang kita masuk ke peta ekosistem JSON di Java.

Bagian ini menjawab pertanyaan besar:

1. Di Java, JSON itu sebenarnya diproses lewat layer apa saja?
2. Apa beda JSON-P, JSON-B, Jackson, Gson, Moshi, Yasson, Parsson?
3. Kapan memakai standar Jakarta dan kapan memakai library de-facto seperti Jackson?
4. Apa konsekuensi pilihan JSON library terhadap compatibility, security, performance, migration, dan maintainability?
5. Bagaimana cara berpikir seperti engineer senior saat memilih JSON stack untuk enterprise system?

Bagian ini **belum fokus pada syntax detail JSON-P/JSON-B**. Itu akan dibahas mulai Part 3. Bagian ini adalah peta besar agar nanti setiap API punya tempat yang jelas dalam mental model.

---

## 1. Premis Utama: JSON Library Bukan Sekadar Utility

Banyak engineer memperlakukan JSON library sebagai hal kecil:

```java
objectMapper.writeValueAsString(obj);
jsonb.toJson(obj);
gson.toJson(obj);
```

Padahal di sistem enterprise, JSON library menentukan banyak hal:

- apakah field `null` dikirim atau dihilangkan;
- apakah unknown field ditolak atau diam-diam diabaikan;
- apakah angka besar tetap presisi atau berubah menjadi floating point;
- apakah tanggal memakai timezone eksplisit atau default JVM;
- apakah enum rename akan mematahkan consumer;
- apakah polymorphic deserialization membuka risiko security;
- apakah payload besar diproses streaming atau memenuhi heap;
- apakah behavior sama antara local test, container, dan application server;
- apakah migrasi Java 8 ke 17/21/25 aman;
- apakah migrasi `javax.*` ke `jakarta.*` menyentuh external contract.

Jadi JSON library adalah **boundary runtime**. Ia duduk di antara dunia luar dan model Java kita.

Mental model dasarnya:

```text
External JSON
    ↓
Parser / Reader
    ↓
Tree model or streaming events
    ↓
Binding / Mapping layer
    ↓
DTO boundary
    ↓
Validation / normalization
    ↓
Domain/application model
```

Kesalahan umum terjadi saat semua layer ini dicampur menjadi satu:

```text
JSON langsung bind ke entity/domain object
    ↓
field eksternal bocor ke model internal
    ↓
perubahan internal mematahkan kontrak eksternal
    ↓
security dan compatibility sulit dikendalikan
```

Top-level rule:

> Jangan memilih JSON library hanya dari kemudahan API. Pilih berdasarkan kontrak, runtime, compatibility, observability, dan failure behavior.

---

## 2. Empat Cara Memproses JSON di Java

Secara konseptual, semua library JSON berada di satu atau lebih dari empat model berikut.

| Model | Cara Kerja | Analogi XML | Cocok Untuk | Risiko |
|---|---|---|---|---|
| Streaming parser | Membaca token/event satu per satu | SAX/StAX | payload besar, high throughput, partial extraction | kode lebih kompleks |
| Tree/object model | JSON dibaca menjadi tree node/object | DOM | transformasi dinamis, patch, inspeksi struktur | memory besar untuk payload besar |
| Data binding | JSON otomatis menjadi POJO/record | JAXB-like binding | DTO stabil, API umum | mapping tersembunyi, drift, security |
| Manual mapping | JSON diparse lalu dipetakan sendiri | custom mapper | boundary kritikal, defensive parsing | verbose |

Contoh sederhananya:

```text
Streaming:
  { "id": 1, "name": "A" }
       ↓
  START_OBJECT, KEY_NAME(id), VALUE_NUMBER(1), KEY_NAME(name), VALUE_STRING(A), END_OBJECT

Tree model:
  JsonObject / JsonNode / JsonElement
       ↓
  node.get("id")

Data binding:
  JSON
       ↓
  CustomerDto(id=1, name="A")

Manual mapping:
  parser/tree
       ↓
  validate exact fields
       ↓
  construct DTO explicitly
```

Tidak ada satu model yang selalu benar. Engineer senior biasanya memilih model berdasarkan **boundary risk**.

---

## 3. Peta Ekosistem JSON di Java

Ekosistem JSON Java bisa dibagi menjadi dua keluarga besar:

1. **Standard Jakarta/Java EE family**
   - JSON-P / Jakarta JSON Processing
   - JSON-B / Jakarta JSON Binding
   - Provider seperti Parsson dan Yasson

2. **Library de-facto / external family**
   - Jackson
   - Gson
   - Moshi
   - DSL atau runtime lain dari framework tertentu

Peta mentalnya:

```text
JSON Ecosystem in Java

├── Standard / Jakarta
│   ├── JSON-P / Jakarta JSON Processing
│   │   ├── Object model API
│   │   ├── Streaming API
│   │   ├── JSON Pointer / Patch / Merge Patch
│   │   └── Provider examples: Parsson
│   │
│   └── JSON-B / Jakarta JSON Binding
│       ├── POJO <-> JSON binding
│       ├── Annotation model
│       ├── Adapter / serializer / deserializer
│       └── Provider examples: Yasson
│
└── De-facto libraries
    ├── Jackson
    │   ├── Streaming core
    │   ├── Tree model
    │   ├── Databind
    │   ├── annotations
    │   └── many modules
    │
    ├── Gson
    │   ├── object binding
    │   ├── JsonElement tree model
    │   └── type adapters
    │
    └── Moshi
        ├── adapter-centric model
        ├── Java/Kotlin focus
        └── explicit mapping style
```

Sumber resmi Jakarta menyatakan bahwa Jakarta JSON Processing menyediakan API portable untuk parse, generate, transform, dan query dokumen JSON. JSON-P memiliki object model dan streaming model. Jakarta JSON Binding mendefinisikan framework binding antara Java object dan JSON document. Eclipse Parsson adalah implementasi Jakarta JSON Processing, sedangkan Yasson adalah salah satu reference implementation JSON-B. Jackson sendiri memuat data-binding dan tree model yang dibangun di atas streaming API. Gson menyediakan konversi Java object ke JSON dan sebaliknya. Lihat bagian referensi di akhir file.

---

## 4. JSON-P / Jakarta JSON Processing

### 4.1 Apa Itu JSON-P?

JSON-P adalah API standar Jakarta untuk memproses JSON pada level struktur.

Nama historisnya:

```text
Java EE / Jakarta EE 8 : javax.json.*
Jakarta EE 9+         : jakarta.json.*
```

JSON-P bukan binding utama POJO. JSON-P lebih dekat ke:

- parser;
- generator;
- object model;
- pointer;
- patch;
- merge patch.

Analoginya:

```text
JSON-P terhadap JSON ≈ DOM/StAX terhadap XML
```

JSON-P menjawab pertanyaan:

> Bagaimana membaca, menulis, menavigasi, dan memodifikasi struktur JSON secara eksplisit?

Bukan terutama:

> Bagaimana otomatis mengubah semua JSON menjadi object domain?

### 4.2 Dua Model Utama JSON-P

JSON-P punya dua mode besar.

#### 4.2.1 Object Model API

Object model membaca JSON menjadi struktur immutable:

```java
JsonObject object = Json.createReader(inputStream).readObject();
String name = object.getString("name");
JsonArray items = object.getJsonArray("items");
```

Karakteristik:

- mudah dinavigasi;
- cocok untuk payload kecil sampai sedang;
- cocok untuk validasi manual;
- cocok untuk transformasi sederhana;
- seluruh tree biasanya berada di memory.

Mental model:

```text
InputStream
    ↓
JsonReader
    ↓
JsonObject / JsonArray / JsonValue
    ↓
manual access / transform
```

#### 4.2.2 Streaming API

Streaming API membaca event satu demi satu:

```java
JsonParser parser = Json.createParser(inputStream);
while (parser.hasNext()) {
    JsonParser.Event event = parser.next();
    // handle START_OBJECT, KEY_NAME, VALUE_STRING, etc.
}
```

Karakteristik:

- cocok untuk payload besar;
- tidak perlu memuat seluruh dokumen ke heap;
- cocok untuk ingestion pipeline;
- lebih sulit karena state machine harus dikendalikan sendiri.

Mental model:

```text
InputStream
    ↓
JsonParser
    ↓
event stream
    ↓
stateful extraction
```

### 4.3 Kapan JSON-P Dipilih?

Gunakan JSON-P ketika:

1. Ingin API standar Jakarta, bukan vendor-specific.
2. Perlu memproses JSON tanpa membuat POJO penuh.
3. Payload bisa sangat besar dan perlu streaming.
4. Perlu JSON Pointer/Patch/Merge Patch.
5. Perlu validasi boundary eksplisit.
6. Berada di Jakarta EE container yang sudah menyediakan provider.
7. Ingin meminimalkan dependency non-standard pada modul enterprise tertentu.

Contoh use case:

```text
- audit log JSON diff;
- partial extraction dari event besar;
- pre-validation sebelum binding;
- transformasi field antar versi kontrak;
- JSON Patch endpoint;
- normalisasi payload dari external system;
- membaca envelope JSON yang dynamic.
```

### 4.4 Kapan JSON-P Kurang Nyaman?

JSON-P kurang nyaman ketika:

- DTO stabil dan banyak;
- field mapping kompleks;
- ingin annotation-driven mapping;
- butuh module ekosistem luas seperti Java Time, Kotlin, polymorphism advanced;
- tim sudah heavily standardized pada Jackson.

JSON-P bukan pengganti langsung Jackson Databind. Ia lebih rendah level.

### 4.5 Provider JSON-P

JSON-P adalah API. Butuh implementation/provider.

Contoh provider:

- Eclipse Parsson;
- implementasi bawaan application server;
- provider lain yang kompatibel.

Di Jakarta EE container, provider sering sudah ada. Di aplikasi standalone Spring Boot atau plain Java, dependency harus eksplisit.

Contoh dependency modern Jakarta:

```xml
<dependency>
  <groupId>jakarta.json</groupId>
  <artifactId>jakarta.json-api</artifactId>
  <version>2.1.3</version>
</dependency>

<dependency>
  <groupId>org.eclipse.parsson</groupId>
  <artifactId>parsson</artifactId>
  <version>1.1.7</version>
</dependency>
```

Versi di atas contoh pola, bukan instruksi untuk selalu memakai versi tersebut. Untuk project nyata, align dengan BOM framework/container.

---

## 5. JSON-B / Jakarta JSON Binding

### 5.1 Apa Itu JSON-B?

JSON-B adalah standar Jakarta untuk mapping Java object ke JSON dan sebaliknya.

Nama historis:

```text
Java EE / Jakarta EE 8 : javax.json.bind.*
Jakarta EE 9+         : jakarta.json.bind.*
```

JSON-B menjawab pertanyaan:

> Bagaimana object Java dikonversi menjadi JSON dengan aturan standar?

Contoh:

```java
Jsonb jsonb = JsonbBuilder.create();
String json = jsonb.toJson(new CustomerDto("C-001", "Alice"));
CustomerDto dto = jsonb.fromJson(json, CustomerDto.class);
```

JSON-B lebih tinggi level daripada JSON-P.

```text
JSON-B
  uses / builds on concepts similar to
JSON-P provider/runtime model
```

Secara mental:

```text
JSON document
    ↓
JSON-B runtime
    ↓
constructor / property / field mapping
    ↓
Java DTO
```

### 5.2 JSON-B vs JSON-P

| Aspek | JSON-P | JSON-B |
|---|---|---|
| Level | structural JSON processing | object binding |
| API utama | `JsonObject`, `JsonParser`, `JsonGenerator` | `Jsonb`, annotations, adapters |
| Mirip | DOM/StAX untuk JSON | JAXB untuk JSON |
| Cocok | dynamic JSON, patch, streaming | DTO mapping |
| Risiko | manual state/field handling | hidden implicit mapping |
| Provider contoh | Parsson | Yasson |

Rule praktis:

```text
Jika perlu mengontrol struktur JSON secara eksplisit → JSON-P.
Jika perlu mapping DTO standar Jakarta → JSON-B.
Jika butuh ekosistem module luas dan framework default → Jackson sering lebih pragmatis.
```

### 5.3 Kapan JSON-B Dipilih?

Gunakan JSON-B ketika:

1. Aplikasi berada di Jakarta EE stack.
2. Ingin standard API portable antar Jakarta-compatible runtime.
3. Mapping DTO relatif sederhana dan kontrak stabil.
4. Tidak ingin coupling ke Jackson annotation.
5. Ingin API resmi untuk JSON binding di dunia Jakarta.
6. Application server sudah menyediakan JSON-B provider.

Contoh use case:

```text
- Jakarta REST endpoint dengan DTO sederhana;
- internal service di full Jakarta EE runtime;
- enterprise API yang butuh standar spec;
- modul yang ingin library-neutral.
```

### 5.4 Kapan JSON-B Perlu Diwaspadai?

JSON-B perlu diwaspadai ketika:

- tim menggunakan Spring Boot yang default-nya Jackson;
- butuh fitur Jackson-specific seperti rich polymorphic handling;
- integrasi dengan ecosystem module Jackson sudah kuat;
- DTO memakai idiom modern yang provider-nya belum konsisten;
- perlu strict unknown-property policy yang sangat eksplisit;
- ingin behavior identik lintas runtime, tetapi provider bisa berbeda.

JSON-B adalah standar. Namun standar tidak otomatis berarti paling lengkap untuk semua kebutuhan.

### 5.5 Provider JSON-B: Yasson

JSON-B adalah API. Implementasi populer/reference implementation-nya adalah Yasson.

Dependency pattern standalone:

```xml
<dependency>
  <groupId>jakarta.json.bind</groupId>
  <artifactId>jakarta.json.bind-api</artifactId>
  <version>3.0.1</version>
</dependency>

<dependency>
  <groupId>org.eclipse</groupId>
  <artifactId>yasson</artifactId>
  <version>3.0.4</version>
</dependency>
```

Dalam container Jakarta EE, versi provider sebaiknya mengikuti container/BOM.

---

## 6. Jackson

### 6.1 Apa Itu Jackson?

Jackson adalah library JSON de-facto paling umum di banyak aplikasi Java modern, terutama Spring ecosystem.

Jackson bukan satu library tunggal secara konseptual. Ia adalah suite:

```text
Jackson
├── jackson-core        → streaming parser/generator
├── jackson-databind    → POJO binding + tree model
├── jackson-annotations → annotation model
└── modules             → Java Time, JDK8 types, parameter names, Kotlin, XML, CBOR, YAML, etc.
```

Jackson memiliki tiga mode utama:

1. Streaming API: `JsonParser`, `JsonGenerator`
2. Tree model: `JsonNode`, `ObjectNode`, `ArrayNode`
3. Data binding: `ObjectMapper`

Contoh:

```java
ObjectMapper mapper = new ObjectMapper();
CustomerDto dto = mapper.readValue(json, CustomerDto.class);
String output = mapper.writeValueAsString(dto);
```

### 6.2 Kekuatan Jackson

Jackson kuat karena:

- sangat mature;
- sangat luas dipakai;
- default di Spring Boot;
- module ecosystem besar;
- mendukung streaming, tree, binding sekaligus;
- konfigurasi sangat kaya;
- support Java record, Java Time, Optional, polymorphism, custom serializers;
- performa baik untuk banyak workload;
- community knowledge besar.

Jackson biasanya menjadi pilihan paling pragmatis untuk:

```text
- Spring Boot REST API;
- microservices;
- event-driven JSON messages;
- complex DTO mapping;
- API gateway transformation;
- mixed JSON/YAML/CBOR/XML module needs;
- enterprise codebase dengan banyak existing Jackson annotation.
```

### 6.3 Risiko Jackson

Kekuatan Jackson juga sumber risiko:

1. Terlalu banyak konfigurasi.
2. Behavior bisa berubah karena global `ObjectMapper` config.
3. Annotation Jackson dapat bocor ke domain model.
4. Polymorphic deserialization historis punya risiko security jika tidak dikunci.
5. Unknown property policy sering tidak konsisten antar service.
6. Module auto-registration bisa membuat local dan production berbeda.
7. Default date/time serialization bisa mengejutkan jika tidak distandarkan.

Contoh masalah klasik:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
```

Konfigurasi ini nyaman untuk forward compatibility, tetapi bisa menyembunyikan typo field penting:

```json
{
  "customerId": "C-001",
  "ammount": 1000
}
```

Jika `ammount` typo dan unknown field diabaikan, sistem bisa menerima data salah tanpa fail-fast.

Top engineer tidak bertanya:

> Bisa deserialize atau tidak?

Mereka bertanya:

> Field mana yang wajib? Field mana yang boleh absent? Unknown field harus warning, reject, atau ignore? Apakah policy berbeda untuk public API, internal event, dan admin import?

### 6.4 Jackson di Jakarta EE

Jackson bisa dipakai di Jakarta EE, tetapi perlu sadar konsekuensi:

- Jakarta REST implementation mungkin default ke JSON-B;
- menambahkan Jackson provider bisa mengubah message body provider selection;
- annotation JSON-B dan Jackson bisa konflik secara konseptual;
- container mungkin punya library sendiri;
- classpath/classloader bisa kompleks di application server.

Rule praktis:

```text
Dalam Jakarta EE full container:
  gunakan JSON-B jika butuh standar dan mapping sederhana.
  gunakan Jackson jika benar-benar butuh fitur/ekosistem Jackson, lalu konfigurasi provider secara eksplisit.

Dalam Spring Boot:
  gunakan Jackson kecuali ada alasan kuat memakai JSON-B.
```

---

## 7. Gson

### 7.1 Apa Itu Gson?

Gson adalah library dari Google untuk mengubah Java object menjadi JSON dan JSON menjadi Java object. Ia populer karena API sederhana dan mudah digunakan.

Contoh:

```java
Gson gson = new Gson();
String json = gson.toJson(dto);
CustomerDto dto = gson.fromJson(json, CustomerDto.class);
```

### 7.2 Kekuatan Gson

Gson unggul pada:

- API sederhana;
- dependency ringan;
- mudah dipakai di utility kecil;
- relatif stabil;
- punya `JsonElement` tree model;
- bisa bekerja dengan class yang tidak punya source code melalui reflection.

### 7.3 Batasan Gson untuk Enterprise Backend Modern

Untuk sistem enterprise backend modern, Gson sering kalah pragmatis dibanding Jackson atau JSON-B karena:

- tidak menjadi default utama di Spring/Jakarta runtime;
- integrasi module tidak seluas Jackson;
- beberapa behavior reflection bisa bermasalah dengan Java modularity/encapsulation;
- konfigurasi enterprise sering lebih terbatas;
- kurang cocok bila seluruh platform sudah standar Jackson atau JSON-B.

Gson masih valid untuk:

```text
- tool kecil;
- library internal ringan;
- legacy codebase yang sudah stabil;
- Android/older Java contexts;
- kasus sederhana tanpa kebutuhan framework integration kompleks.
```

Namun untuk enterprise service baru, pilihan biasanya:

```text
Spring / microservice: Jackson
Jakarta EE standard: JSON-B + JSON-P
High-control parser: JSON-P streaming or Jackson streaming
```

---

## 8. Moshi

Moshi adalah library JSON dari Square untuk Java dan Kotlin, dengan model adapter-centric. Ia populer terutama di ekosistem Android/Kotlin.

Untuk backend Java enterprise murni, Moshi biasanya bukan pilihan utama kecuali organisasi memang sudah menggunakannya atau ada alasan eksplisit.

Kelebihan Moshi:

- adapter model relatif eksplisit;
- cocok untuk Kotlin-oriented codebase;
- lebih strict/modern dalam beberapa desain dibanding Gson;
- bisa mengurangi beberapa magic mapping.

Namun dalam seri ini, Moshi hanya akan disebut sebagai pembanding, bukan fokus utama, karena target kita adalah Jakarta/Javax JSON/XML/SOAP/Connectors dan backend enterprise Java.

---

## 9. JSON-P vs JSON-B vs Jackson vs Gson: Decision Matrix

### 9.1 Matrix Ringkas

| Skenario | Pilihan Utama | Alasan |
|---|---|---|
| Jakarta EE full runtime, DTO sederhana | JSON-B | standar Jakarta, provider container |
| Jakarta EE, dynamic/partial JSON | JSON-P | object/streaming model standar |
| Spring Boot REST API | Jackson | default ecosystem |
| Large JSON ingestion | JSON-P streaming atau Jackson streaming | memory efficient |
| JSON Patch / Merge Patch | JSON-P | standar API patch/pointer |
| Complex polymorphic DTO | Jackson, sangat dikunci | fitur kuat, perlu security guard |
| Library portable tanpa framework coupling | JSON-B/JSON-P API | standard interface |
| Legacy code memakai Gson | Gson | minim churn, selama risk rendah |
| Security-critical external payload | manual parse + strict validation | jangan full auto-bind langsung |
| Event schema dengan evolusi ketat | Jackson/JSON-B + contract tests | binding + compatibility tests |
| Runtime harus portable antar Jakarta server | JSON-B/JSON-P | hindari vendor lock-in |
| Butuh module Java Time/JDK8/Kotlin lengkap | Jackson | module ecosystem matang |

### 9.2 Decision Tree

```text
Mulai
│
├── Apakah runtime utama Spring Boot?
│   ├── Ya → Jackson default, kecuali alasan kuat untuk JSON-B
│   └── Tidak
│
├── Apakah runtime utama Jakarta EE container?
│   ├── Ya
│   │   ├── Butuh binding DTO biasa? → JSON-B
│   │   ├── Butuh structural/dynamic/patch/streaming? → JSON-P
│   │   └── Butuh fitur Jackson khusus? → Jackson provider eksplisit
│   └── Tidak
│
├── Apakah payload sangat besar?
│   ├── Ya → streaming parser, bukan full binding
│   └── Tidak
│
├── Apakah kontrak sangat kritikal/security-sensitive?
│   ├── Ya → parse defensively + validate + map eksplisit
│   └── Tidak
│
└── Pilih library berdasarkan platform standardization, bukan selera personal.
```

---

## 10. `javax.*` vs `jakarta.*` dalam JSON Stack

### 10.1 Perubahan Namespace

Perubahan besar di Jakarta EE 9 adalah perpindahan namespace:

```text
javax.json.*       → jakarta.json.*
javax.json.bind.*  → jakarta.json.bind.*
```

Contoh:

```java
// Java EE / Jakarta EE 8 style
import javax.json.JsonObject;
import javax.json.bind.Jsonb;

// Jakarta EE 9+ style
import jakarta.json.JsonObject;
import jakarta.json.bind.Jsonb;
```

Ini bukan sekadar rename import. Efeknya:

- binary compatibility putus;
- dependency berubah;
- provider harus cocok dengan API namespace;
- application server version harus aligned;
- library yang masih memakai `javax.*` tidak otomatis cocok dengan runtime `jakarta.*`;
- shading/relocation jarang menjadi solusi bersih untuk aplikasi besar.

### 10.2 Mapping Versi Mental

| Era | Namespace | Contoh Platform | Catatan |
|---|---|---|---|
| Java EE 8 / Jakarta EE 8 | `javax.*` | Java EE 8, Jakarta EE 8 | transisi awal Eclipse Foundation |
| Jakarta EE 9+ | `jakarta.*` | Jakarta EE 9, 10, 11 | namespace baru |
| Java 8 app legacy | sering `javax.*` | app server lama | migrasi butuh rencana |
| Java 17/21/25 modern | umumnya `jakarta.*` atau Jackson | Spring/Jakarta modern | dependency explicit |

### 10.3 Kesalahan Migrasi Umum

Kesalahan paling sering:

```text
Compile pakai jakarta.json-api
Runtime provider masih javax.json
    ↓
ClassNotFoundException / NoClassDefFoundError / provider not found
```

atau:

```text
Aplikasi memakai Jakarta REST 3.x
DTO masih penuh annotation javax.*
    ↓
annotation tidak terbaca provider modern
```

Aturan migrasi:

> API namespace, provider implementation, framework version, app server version, dan transitive dependency harus satu generasi.

---

## 11. Java 8 sampai Java 25: Apa yang Berubah untuk JSON?

JSON-P/JSON-B tidak mengalami nasib yang sama seperti JAXB/JAX-WS yang pernah ada di JDK lalu dihapus. JSON-P/JSON-B umumnya selalu berupa dependency/spec dari Java EE/Jakarta EE ecosystem, bukan bagian inti Java SE.

Namun target Java 8–25 tetap memengaruhi JSON stack lewat hal berikut:

### 11.1 Java 8

Karakter umum:

- banyak aplikasi memakai Java EE 7/8 atau Spring lama;
- namespace `javax.*` umum;
- records belum ada;
- date/time modern sudah ada via `java.time`, tapi butuh module/adapter library;
- reflection lebih longgar dibanding Java modular era.

Impikasi JSON:

```text
- DTO biasanya POJO mutable dengan no-args constructor.
- JSON-B/Jackson/Gson lebih sering memakai reflection field/property.
- Banyak legacy API tidak strict soal null/unknown field.
```

### 11.2 Java 11

Karakter umum:

- LTS modern pertama setelah Java 8;
- Java EE modules tertentu dihapus dari JDK, tetapi ini lebih berdampak pada JAXB/JAX-WS daripada JSON-P/JSON-B;
- dependency explicit menjadi kebiasaan penting;
- banyak migrasi library mulai terasa.

Impikasi JSON:

```text
- jangan mengandalkan classpath accidental dari server/JDK;
- dependency harus jelas;
- CI perlu menjalankan test di target runtime, bukan hanya compile.
```

### 11.3 Java 17

Karakter umum:

- LTS sangat umum di enterprise;
- records sudah stabil;
- sealed classes tersedia;
- strong encapsulation lebih terasa;
- framework modern banyak baseline ke Java 17.

Impikasi JSON:

```text
- record DTO menjadi menarik untuk immutable boundary model;
- reflection access harus compatible;
- Jackson support record matang, JSON-B provider perlu dicek versinya;
- sealed polymorphism butuh strategi eksplisit.
```

### 11.4 Java 21

Karakter umum:

- LTS modern;
- virtual threads tersedia;
- pattern matching semakin matang;
- banyak platform mulai menjadikan Java 21 baseline.

Impikasi JSON:

```text
- JSON parsing tetap CPU/memory-bound, bukan otomatis lebih cepat karena virtual threads;
- blocking IO bisa lebih scalable, tetapi payload besar tetap butuh streaming;
- DTO record semakin natural;
- observability dan allocation profiling makin penting.
```

### 11.5 Java 25

Karakter umum:

- target modern berikutnya dalam horizon enterprise;
- codebase yang benar harus minim asumsi terhadap reflection ilegal;
- dependency alignment menjadi lebih penting.

Impikasi JSON:

```text
- hindari library usang yang bergantung pada illegal reflection;
- gunakan versi provider/library yang aktif maintained;
- jangan campur javax/jakarta;
- kontrak JSON harus diuji di runtime target.
```

---

## 12. Provider, API, Implementation: Bedakan Tiga Hal Ini

Engineer sering bingung karena dependency JSON terlihat mirip.

Ada tiga konsep:

```text
API
  interface/class yang dipakai kode aplikasi

Implementation/provider
  runtime yang benar-benar menjalankan API

Integration layer
  framework/container yang memilih provider untuk HTTP/message body
```

Contoh JSON-P:

```text
API:
  jakarta.json-api

Provider:
  Parsson

Integration:
  Jakarta REST / application server / manual JsonProvider lookup
```

Contoh JSON-B:

```text
API:
  jakarta.json.bind-api

Provider:
  Yasson

Integration:
  Jakarta REST JSON-B message body reader/writer
```

Contoh Jackson:

```text
API + implementation:
  jackson-core
  jackson-databind
  jackson-annotations

Integration:
  Spring MVC HttpMessageConverter
  Jakarta REST Jackson provider
```

### 12.1 Provider Discovery Problem

Standards seperti JSON-P/JSON-B sering menggunakan provider discovery. Masalah bisa muncul ketika:

- ada dua provider di classpath;
- API dan provider beda namespace;
- container menyediakan provider versi A tetapi aplikasi membawa provider versi B;
- fat jar berbeda dengan WAR deployment;
- test runtime berbeda dengan production runtime.

Gejala:

```text
- ProviderNotFoundException
- ClassCastException antar classloader
- NoSuchMethodError
- NoClassDefFoundError
- behavior berbeda antara local dan server
```

Prinsip:

> Untuk aplikasi enterprise, dependency JSON harus diperlakukan seperti dependency database driver: explicit, version-aligned, dan diuji di runtime sebenarnya.

---

## 13. Framework Integration

### 13.1 Jakarta REST

Dalam Jakarta REST, JSON provider biasanya menentukan bagaimana request/response body diproses.

Misalnya endpoint:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse create(CustomerRequest request) {
    return service.create(request);
}
```

Kita tidak memanggil `Jsonb` atau `ObjectMapper` langsung. Framework memilih message body reader/writer.

Pertanyaan penting:

```text
- Provider mana yang dipakai?
- JSON-B atau Jackson?
- Bagaimana null field diserialisasi?
- Unknown field reject atau ignore?
- Date/time format apa?
- Error deserialization menjadi response apa?
- Apakah exception message membocorkan internal class name?
```

### 13.2 Spring Boot

Spring Boot secara umum memakai Jackson untuk JSON HTTP message conversion.

Konsekuensi:

- ObjectMapper sering global bean;
- konfigurasi global bisa memengaruhi semua endpoint;
- annotation Jackson umum dipakai;
- module auto-configuration membantu, tetapi perlu dikunci untuk boundary kritikal.

Contoh masalah:

```java
@Bean
ObjectMapper objectMapper() {
    return new ObjectMapper()
        .findAndRegisterModules()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
}
```

Terlihat nyaman, tetapi global policy `ignore unknown` bisa tidak cocok untuk endpoint admin import yang harus strict.

Solusi senior:

```text
- satu ObjectMapper global untuk default web;
- mapper khusus untuk external partner strict payload;
- mapper khusus untuk audit canonical JSON;
- mapper khusus untuk backward-compatible event replay;
- semua mapper diberi nama dan diuji contract behavior-nya.
```

### 13.3 Messaging: Kafka/RabbitMQ/JMS

Untuk message-driven system, JSON library sering dipakai di serializer/deserializer.

Masalah yang lebih sering terjadi bukan “JSON tidak bisa dibaca”, tetapi:

```text
- producer menghapus field yang consumer lama masih butuh;
- enum baru tidak dikenali consumer lama;
- timestamp format berubah;
- BigDecimal menjadi double;
- unknown field policy berbeda antar consumer;
- message poison karena satu record tidak bisa deserialize;
- retry loop memperparah backlog.
```

Untuk messaging, JSON library harus dipasangkan dengan:

- schema/version strategy;
- dead-letter strategy;
- poison message isolation;
- idempotency;
- replay test;
- compatibility test;
- observability deserialization failure.

---

## 14. Annotation Coupling: Masalah yang Sering Diremehkan

JSON library biasanya punya annotation masing-masing.

Contoh Jackson:

```java
@JsonProperty("customer_id")
private String customerId;
```

Contoh JSON-B:

```java
@JsonbProperty("customer_id")
private String customerId;
```

Sekilas sama, tetapi annotation ini mengikat model ke library tertentu.

### 14.1 Risiko Annotation di Domain Model

Jika domain object diberi annotation JSON:

```java
public class Customer {
    @JsonProperty("customer_id")
    private CustomerId id;
}
```

Maka domain model tahu tentang external JSON contract.

Risikonya:

- domain rename bisa mematahkan API;
- satu domain object dipakai untuk banyak kontrak berbeda;
- internal field ikut terekspos;
- security filtering jadi susah;
- migration Jackson ↔ JSON-B menjadi mahal;
- satu model mencoba melayani REST, event, audit, dan persistence sekaligus.

### 14.2 Boundary DTO Rule

Lebih aman:

```text
External JSON
    ↓
CustomerCreateRequestDto  ← JSON annotations allowed here
    ↓
Validation
    ↓
Command / domain input
    ↓
Domain model             ← no JSON annotations ideally
```

DTO boundary boleh punya annotation karena memang tugasnya berbicara dengan dunia luar.

Domain model sebaiknya tidak bergantung pada JSON library kecuali ada alasan sangat kuat.

### 14.3 Multi-Contract Problem

Satu entity sering perlu muncul dalam beberapa bentuk:

```text
Public API response:
  customerId, displayName

Admin API response:
  customerId, legalName, riskStatus

Audit event:
  entityType, entityId, before, after, actor

Partner export:
  CUSTOMER_ID, CUSTOMER_NAME, STATUS_CODE
```

Jika semua memakai satu class `Customer`, annotation akan saling tarik-menarik.

Solusi:

```text
- DTO per boundary;
- mapper eksplisit;
- contract tests per boundary;
- serialization config per boundary bila perlu.
```

---

## 15. Null, Absent, Empty: Tiga Makna Berbeda

Salah satu tanda engineer matang adalah tidak menyamakan `null`, absent, dan empty.

```json
{}
```

```json
{ "middleName": null }
```

```json
{ "middleName": "" }
```

Tiga JSON di atas bisa berarti berbeda:

| Bentuk | Makna Potensial |
|---|---|
| field absent | tidak dikirim, tidak ingin mengubah, tidak diketahui |
| field null | sengaja dikosongkan, unknown eksplisit, clear value |
| empty string | nilai ada tapi kosong, user input kosong, legacy convention |

Dalam PATCH endpoint:

```json
{ "email": null }
```

bisa berarti:

```text
hapus email
```

Sedangkan:

```json
{}
```

bisa berarti:

```text
jangan ubah email
```

Jika library binding langsung memetakan keduanya menjadi `email == null`, informasi hilang.

### 15.1 Strategi DTO untuk Partial Update

Jangan memakai DTO biasa untuk PATCH jika perlu membedakan absent dan null.

Kurang aman:

```java
public class UpdateCustomerRequest {
    public String email;
}
```

Lebih eksplisit:

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    private PatchField(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> PatchField<T> absent() {
        return new PatchField<>(false, null);
    }

    public static <T> PatchField<T> present(T value) {
        return new PatchField<>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    public T value() {
        return value;
    }
}
```

Atau gunakan JSON-P tree untuk PATCH boundary lalu map manual.

Top-level principle:

> Auto-binding bagus untuk create/read DTO stabil. Untuk PATCH semantics, sering perlu model khusus.

---

## 16. Number Handling: BigDecimal, Integer, Long, Double

JSON hanya punya konsep number. Java punya banyak tipe:

```text
int, long, BigInteger, float, double, BigDecimal
```

Masalah umum:

```json
{ "amount": 999999999999999999.99 }
```

Jika diparse sebagai `double`, presisi bisa hilang.

Untuk financial/regulatory/audit system:

```text
Money, penalty, tax, fee, balance, score threshold
```

jangan sembarang memakai `double`.

Gunakan:

```java
BigDecimal amount;
```

Namun BigDecimal juga punya isu:

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")) // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) // 0
```

JSON library bisa mempertahankan scale atau mengubah representasi tergantung konfigurasi.

Prinsip:

```text
- Untuk uang: gunakan BigDecimal + currency + scale policy.
- Untuk ID numeric besar: pertimbangkan string agar tidak rusak di JavaScript client.
- Untuk audit: simpan canonical textual representation bila presisi harus defensible.
```

---

## 17. Date/Time Handling

Tanggal adalah sumber bug permanen.

Contoh format:

```json
{ "createdAt": "2026-06-17T10:15:30+07:00" }
```

atau:

```json
{ "createdAt": "2026-06-17T03:15:30Z" }
```

atau:

```json
{ "createdDate": "2026-06-17" }
```

atau buruk:

```json
{ "createdAt": "17/06/2026 10:15" }
```

### 17.1 Tipe Java yang Tepat

| Kebutuhan | Tipe Java |
|---|---|
| timestamp absolut | `Instant` |
| date tanpa waktu | `LocalDate` |
| waktu lokal tanpa zona | `LocalDateTime`, hati-hati |
| waktu dengan offset | `OffsetDateTime` |
| waktu dengan zone rules | `ZonedDateTime` |

Untuk external API, `OffsetDateTime` atau `Instant` sering lebih jelas daripada `LocalDateTime`.

### 17.2 Library Consequence

Jackson butuh module Java Time (`jackson-datatype-jsr310`) untuk handling `java.time` yang baik.

JSON-B provider modern juga mendukung date/time, tetapi format dan default perlu diuji.

Rule:

> Jangan biarkan default date format menjadi kontrak publik tanpa disadari.

Tetapkan format eksplisit di DTO boundary.

---

## 18. Unknown Field Policy

Unknown field policy adalah keputusan kontrak, bukan preferensi library.

Misalnya client mengirim:

```json
{
  "customerId": "C-001",
  "name": "Alice",
  "unexpectedRiskOverride": true
}
```

Apa yang harus dilakukan?

Pilihan:

| Policy | Kelebihan | Risiko |
|---|---|---|
| Reject unknown field | fail-fast, aman untuk input kritikal | kurang forward-compatible |
| Ignore unknown field | forward-compatible | typo/serangan tersembunyi |
| Capture extension field | extensible | perlu governance |
| Warn but accept | observability | kompleks, tetap bisa abuse |

### 18.1 Policy Berdasarkan Boundary

| Boundary | Suggested Policy |
|---|---|
| Public write API | reject atau strict allowlist |
| Public read response | consumer harus ignore unknown |
| Internal event | consumer ignore unknown, producer tidak hapus field sembarangan |
| Admin import | reject unknown |
| Partner integration | sesuai contract, biasanya strict |
| Audit ingestion | capture raw + parse known fields |

Rule yang lebih matang:

```text
Producer boleh menambah optional field.
Consumer sebaiknya tahan terhadap field tambahan.
Tetapi write-side command dari external actor tidak harus menerima field tidak dikenal.
```

---

## 19. Polymorphism: Fitur Kuat, Risiko Besar

Polymorphic JSON berarti satu field bisa menjadi beberapa subtype.

Contoh:

```json
{
  "type": "EMAIL",
  "address": "a@example.com"
}
```

atau:

```json
{
  "type": "SMS",
  "phoneNumber": "+628..."
}
```

Dalam Java:

```java
sealed interface NotificationTarget permits EmailTarget, SmsTarget {}
```

Polymorphism berguna, tetapi auto polymorphic deserialization berisiko bila tipe class bisa dikontrol input.

Buruk:

```json
{
  "@class": "com.example.SomeInternalClass",
  ...
}
```

Prinsip aman:

```text
- Jangan izinkan external JSON menentukan arbitrary Java class.
- Gunakan discriminator allowlist: EMAIL, SMS, WEBHOOK.
- Map discriminator ke subtype secara eksplisit.
- Hindari default typing global untuk untrusted input.
- Contract type ≠ Java class name.
```

Library seperti Jackson sangat powerful untuk polymorphism, tetapi harus dikonfigurasi dengan ketat.

---

## 20. Performance: Binding Itu Nyaman, Tetapi Bukan Selalu Murah

JSON performance dipengaruhi oleh:

- ukuran payload;
- jumlah object allocation;
- reflective access;
- date parsing;
- BigDecimal parsing;
- string interning/copying;
- tree model vs streaming;
- unknown field handling;
- validation;
- exception path;
- logging raw payload.

### 20.1 Full Binding Path

```text
InputStream
    ↓ read all bytes/string maybe
JSON parser
    ↓ token stream
object allocation DTO
    ↓ nested object allocation
validation
    ↓
domain mapping
```

Untuk payload kecil, ini sangat baik.

Untuk payload 100 MB, ini bisa berbahaya.

### 20.2 Tree Model Path

```text
InputStream
    ↓
full JSON tree in memory
    ↓
manual traversal
```

Lebih fleksibel tetapi bisa dua kali mahal:

```text
raw bytes/string + tree nodes + final DTO
```

### 20.3 Streaming Path

```text
InputStream
    ↓
event/token
    ↓
selective extraction / direct processing
```

Lebih efisien, tetapi kode lebih kompleks dan harus stateful.

### 20.4 Rule Praktis

| Payload | Strategy |
|---|---|
| < 1 MB DTO biasa | binding normal cukup |
| 1–10 MB nested | binding masih bisa, ukur allocation |
| 10–100 MB | pertimbangkan streaming/partial parse |
| >100 MB | streaming, chunking, atau ubah protocol |
| unbounded input | wajib limit size/depth/time |

Jangan optimasi dini. Tetapi jangan juga memakai full binding untuk payload tidak terbatas.

---

## 21. Security: JSON Lebih Sederhana dari XML, Tetapi Tidak Bebas Risiko

JSON tidak punya entity expansion seperti XML, tetapi tetap punya banyak risiko:

1. JSON bomb / deeply nested object.
2. Huge array menyebabkan OOM.
3. Huge number parsing mahal.
4. Duplicate keys ambigu.
5. Unknown fields disalahgunakan.
6. Polymorphic deserialization attack.
7. Sensitive field mass assignment.
8. Log injection melalui string field.
9. Error message leakage.
10. Payload replay dalam messaging.

### 21.1 Mass Assignment

Misalnya request:

```json
{
  "name": "Alice",
  "role": "ADMIN",
  "accountLocked": false
}
```

Jika langsung bind ke entity:

```java
class User {
    String name;
    Role role;
    boolean accountLocked;
}
```

maka attacker bisa mengisi field yang tidak seharusnya diinput.

Solusi:

```java
class UpdateProfileRequest {
    String name;
}
```

Boundary DTO harus hanya memuat field yang boleh dikontrol actor.

### 21.2 Duplicate Keys

JSON seperti ini ambigu:

```json
{
  "amount": 100,
  "amount": 999999
}
```

Library bisa memilih first wins, last wins, reject, atau behavior lain.

Untuk sistem audit/financial/regulatory, tentukan policy.

### 21.3 Depth Limit

Payload nested ekstrem:

```json
{"a":{"a":{"a":{"a": ... }}}}
```

bisa menghabiskan stack/memory/time.

Gunakan:

- request body size limit di gateway/server;
- parser constraint jika library mendukung;
- timeout;
- streaming parser;
- validation limit.

---

## 22. Canonical JSON dan Deterministic Serialization

Dalam beberapa use case, JSON output harus deterministik:

- digital signature;
- cache key;
- audit hash;
- idempotency key;
- diff testing;
- snapshot testing.

Masalah:

```json
{"a":1,"b":2}
```

secara semantik sama dengan:

```json
{"b":2,"a":1}
```

Tetapi string-nya berbeda.

Jika hash dihitung dari string raw, hasil berbeda.

Strategi:

```text
- stable property ordering;
- normalize number representation;
- normalize timestamp format;
- consistent null inclusion policy;
- no pretty-print untuk canonical form;
- explicit charset UTF-8;
- canonicalization test.
```

Catatan: canonical JSON untuk signature adalah topik serius. Jangan membuat skema signature sendiri untuk security-critical integration tanpa standar/protokol yang jelas.

---

## 23. DTO Design untuk JSON Boundary

### 23.1 Mutable POJO

```java
public class CustomerRequest {
    public String customerId;
    public String name;
}
```

Kelebihan:

- mudah untuk banyak library;
- cocok Java 8;
- sederhana.

Kekurangan:

- mutable;
- invariant lemah;
- field bisa diubah setelah validation.

### 23.2 Bean dengan Getter/Setter

```java
public class CustomerRequest {
    private String customerId;
    private String name;

    public String getCustomerId() { return customerId; }
    public void setCustomerId(String customerId) { this.customerId = customerId; }
}
```

Kelebihan:

- compatible luas;
- familiar untuk Java EE/Jackson/JSON-B.

Kekurangan:

- banyak boilerplate;
- masih mutable.

### 23.3 Immutable Class

```java
public final class CustomerRequest {
    private final String customerId;
    private final String name;

    public CustomerRequest(String customerId, String name) {
        this.customerId = customerId;
        this.name = name;
    }

    public String customerId() { return customerId; }
    public String name() { return name; }
}
```

Kelebihan:

- invariant lebih kuat;
- thread-safe secara nilai;
- cocok command boundary.

Kekurangan:

- butuh constructor/creator annotation tergantung library;
- Java 8 lebih verbose.

### 23.4 Record DTO

```java
public record CustomerRequest(String customerId, String name) {}
```

Kelebihan:

- ringkas;
- immutable;
- cocok Java 16+;
- bagus untuk DTO.

Kekurangan:

- perlu pastikan library/provider mendukung;
- tidak tersedia di Java 8/11;
- semantic validation tetap perlu di luar atau compact constructor.

### 23.5 Rule DTO by Java Version

| Java Version | DTO Style Aman |
|---|---|
| Java 8 | POJO/bean, explicit constructors jika didukung |
| Java 11 | POJO/immutable class, library config explicit |
| Java 17+ | records sangat layak untuk boundary DTO |
| Java 21/25 | records + sealed types bisa baik, tetapi polymorphism harus dikunci |

---

## 24. JSON Library dan Validation

JSON binding bukan validation.

Deserialize sukses tidak berarti input valid.

Contoh:

```json
{
  "email": "not-an-email",
  "age": -100,
  "status": "APPROVED"
}
```

Library bisa sukses membuat DTO.

Validation layer harus menjawab:

```text
- field wajib ada?
- format benar?
- range benar?
- kombinasi field legal?
- actor boleh mengirim field ini?
- state saat ini mengizinkan perubahan ini?
```

Layering yang benar:

```text
Raw JSON
    ↓
Syntax parse
    ↓
DTO binding
    ↓
Bean validation / manual validation
    ↓
authorization / business rule
    ↓
command/domain execution
```

Jangan taruh business invariant hanya di deserializer.

Deserializer sebaiknya menangani format-level concerns, bukan seluruh policy bisnis.

---

## 25. Error Handling untuk JSON Boundary

Deserialization error harus diterjemahkan menjadi error response yang aman dan berguna.

Buruk:

```text
com.fasterxml.jackson.databind.exc.InvalidFormatException:
Cannot deserialize value of type `com.company.internal.RiskStatus` from String "X"...
```

Masalah:

- membocorkan class internal;
- terlalu teknis untuk client;
- sulit dimonitor sebagai kategori bisnis;
- tidak punya correlation ID.

Lebih baik:

```json
{
  "errorCode": "INVALID_JSON_FIELD",
  "message": "Field 'riskStatus' contains unsupported value.",
  "correlationId": "..."
}
```

Log internal boleh menyimpan detail teknis, tetapi response harus stabil.

Error taxonomy:

| Error | HTTP/Message Handling |
|---|---|
| invalid JSON syntax | 400 / reject message |
| unknown required field | 400 / contract violation |
| invalid enum | 400 |
| missing required field | 400 |
| semantic validation fail | 422 or 400 depending API convention |
| unauthorized field | 403 or 400 depending threat model |
| server mapper misconfig | 500 |
| poison message | DLQ/quarantine |

---

## 26. Contract Testing untuk JSON Library Behavior

Unit test DTO biasa tidak cukup.

Yang harus dites:

```text
- serialization field names;
- null inclusion/exclusion;
- absent field behavior;
- unknown field behavior;
- enum unknown behavior;
- date/time format;
- BigDecimal precision;
- duplicate key policy jika kritikal;
- backward compatibility sample payload;
- forward compatibility sample payload;
- error response mapping.
```

Contoh test sederhana:

```java
@Test
void shouldSerializeCustomerResponseWithStableContract() throws Exception {
    CustomerResponse response = new CustomerResponse("C-001", "Alice");

    String json = mapper.writeValueAsString(response);

    assertThat(json).isEqualTo("{\"customerId\":\"C-001\",\"name\":\"Alice\"}");
}
```

Namun strict string equality bisa rapuh jika field order tidak dijamin.

Alternatif:

```java
JsonNode node = mapper.readTree(json);
assertThat(node.get("customerId").asText()).isEqualTo("C-001");
assertThat(node.has("internalStatus")).isFalse();
```

Untuk canonical/audit JSON, strict string equality boleh dan perlu jika order memang dikunci.

---

## 27. Mixing Libraries: Boleh, Tapi Jangan Acak

Dalam satu enterprise codebase, bisa saja ada:

```text
- Jackson untuk Spring REST;
- JSON-P untuk JSON Patch;
- JSON-B untuk Jakarta module;
- Gson untuk legacy utility.
```

Ini tidak otomatis buruk.

Yang buruk adalah tidak ada boundary yang jelas.

### 27.1 Contoh Mixing yang Buruk

```text
Controller pakai Jackson
Service pakai Gson
Audit pakai JSON-B
Test pakai JSON-P
Semua serialize object yang sama
Tidak ada contract test
```

Akibat:

- output field berbeda;
- null policy berbeda;
- date format berbeda;
- bug hanya muncul di runtime tertentu;
- audit hash tidak stabil.

### 27.2 Contoh Mixing yang Bisa Diterima

```text
Spring REST boundary:
  Jackson ObjectMapper named webObjectMapper

JSON Patch endpoint:
  JSON-P for patch operations

Audit canonicalization:
  dedicated ObjectMapper with sorted properties

Legacy partner adapter:
  Gson isolated in adapter module only
```

Prinsip:

> Mixing library boleh jika tiap library punya ownership boundary, config eksplisit, dan test kontrak sendiri.

---

## 28. Enterprise Architecture Pattern: JSON Boundary Module

Untuk sistem besar, buat modul khusus boundary.

Contoh struktur:

```text
customer-api-contract/
  dto/
    CustomerCreateRequest.java
    CustomerResponse.java
  json/
    CustomerJsonConfig.java
  test/
    contract-samples/
      create-request-v1.json
      response-v1.json

customer-application/
  command/
  usecase/

customer-domain/
  Customer.java
  CustomerId.java
```

Atau untuk event:

```text
customer-events/
  dto/
    CustomerCreatedEventV1.java
    CustomerUpdatedEventV2.java
  schema-samples/
  compatibility-tests/
```

Keuntungan:

- kontrak external terisolasi;
- domain tidak tercemar annotation;
- versioning lebih eksplisit;
- test bisa fokus pada boundary;
- migration JSON library lebih terkontrol;
- ownership tim lebih jelas.

---

## 29. Production Checklist untuk Memilih JSON Stack

Sebelum memilih/mengubah JSON stack, jawab ini:

### 29.1 Platform

- Apakah aplikasi Spring Boot, Jakarta EE, Quarkus, Micronaut, atau plain Java?
- JSON provider default framework apa?
- Apakah ada application server yang menyediakan library sendiri?
- Apakah deployment fat jar, WAR, EAR, atau container image?

### 29.2 Compatibility

- Java version target apa: 8, 11, 17, 21, 25?
- Namespace `javax.*` atau `jakarta.*`?
- Apakah ada library lama yang belum Jakarta-compatible?
- Apakah consumer/producer eksternal bergantung field order/null behavior?

### 29.3 Contract

- Field wajib apa?
- Field optional apa?
- Unknown field policy apa?
- Null vs absent semantics apa?
- Date/time format apa?
- Number precision policy apa?
- Enum evolution policy apa?

### 29.4 Security

- Apakah input trusted atau untrusted?
- Apakah ada polymorphic deserialization?
- Apakah raw payload dilog?
- Apakah request size/depth dibatasi?
- Apakah mass assignment dicegah?
- Apakah duplicate key policy diketahui?

### 29.5 Runtime

- Apakah mapper/thread-safe?
- Apakah mapper dibuat ulang setiap request?
- Apakah provider discovery deterministic?
- Apakah config sama antara test dan production?
- Apakah ada classloader/container conflict?

### 29.6 Observability

- Apakah deserialization error punya metric?
- Apakah field-level validation error terstruktur?
- Apakah payload invalid bisa dikarantina?
- Apakah correlation ID tersedia?
- Apakah sample payload disimpan aman untuk debugging?

### 29.7 Testing

- Apakah ada golden sample JSON?
- Apakah ada backward compatibility tests?
- Apakah ada forward compatibility tests?
- Apakah Java 8/11/17/21 target diuji jika perlu?
- Apakah provider runtime sama dengan production?

---

## 30. Anti-Patterns yang Harus Dihindari

### 30.1 “ObjectMapper Baru Setiap Request”

Buruk:

```java
public String toJson(Object value) throws Exception {
    return new ObjectMapper().writeValueAsString(value);
}
```

Masalah:

- config tidak konsisten;
- mahal;
- module tidak register;
- sulit audit behavior.

Lebih baik:

```java
public final class JsonCodecs {
    private final ObjectMapper mapper;

    public JsonCodecs(ObjectMapper mapper) {
        this.mapper = mapper;
    }
}
```

### 30.2 “DTO Sama dengan Entity”

Buruk:

```java
@PostMapping
public CustomerEntity create(@RequestBody CustomerEntity entity) {
    return repository.save(entity);
}
```

Masalah:

- mass assignment;
- persistence detail bocor;
- lazy fields/relationships kacau;
- external contract tergantung schema internal.

### 30.3 “Global Ignore Unknown untuk Semua”

Buruk jika tanpa sadar:

```text
Semua endpoint ignore unknown fields karena ingin forward compatibility.
```

Lebih baik:

```text
Read-side consumer: tolerant.
Write-side command: strict atau allowlist.
```

### 30.4 “Tanggal Mengikuti Default Library”

Buruk:

```text
Tidak ada yang tahu apakah timestamp output epoch millis, ISO string, local timezone, atau UTC.
```

Lebih baik:

```text
Semua external timestamp: ISO-8601 dengan offset atau UTC Instant.
Contract test wajib.
```

### 30.5 “Polymorphism Berdasarkan Class Name”

Buruk:

```json
{ "@class": "com.company.internal.AdminCommand" }
```

Lebih baik:

```json
{ "type": "ADMIN_APPROVAL_REQUEST" }
```

lalu map `type` ke allowlisted subtype.

---

## 31. Practical Architecture Scenarios

### 31.1 Scenario A: Jakarta EE Monolith dengan REST dan SOAP Legacy

Kondisi:

```text
- Jakarta EE container
- banyak module enterprise
- REST endpoint baru
- SOAP/XML legacy masih ada
- target Java 17/21
```

Pilihan JSON:

```text
- JSON-B untuk DTO REST standar;
- JSON-P untuk dynamic/patch/audit JSON;
- hindari Jackson kecuali ada kebutuhan kuat;
- dependency mengikuti container BOM;
- DTO boundary terpisah dari domain;
- contract tests untuk JSON-B provider behavior.
```

Risiko utama:

```text
- provider behavior berbeda antar app server;
- javax/jakarta campur;
- SOAP/JAXB model dipakai ulang sebagai JSON DTO;
- domain model tercemar annotation XML dan JSON sekaligus.
```

### 31.2 Scenario B: Spring Boot Microservice

Kondisi:

```text
- Spring Boot 3.x
- Java 17/21
- REST + Kafka
- JSON everywhere
```

Pilihan JSON:

```text
- Jackson sebagai default;
- satu web ObjectMapper terstandardisasi;
- mapper khusus untuk event jika perlu;
- Java Time module eksplisit;
- FAIL_ON_UNKNOWN_PROPERTIES policy per boundary;
- record DTO untuk request/response;
- golden sample tests.
```

Risiko utama:

```text
- global ObjectMapper config terlalu longgar;
- event schema tidak dites;
- DTO reuse berlebihan;
- polymorphic deserialization tanpa allowlist.
```

### 31.3 Scenario C: Large File Import JSON

Kondisi:

```text
- partner upload file JSON besar
- ratusan ribu records
- tiap record harus divalidasi
- error sebagian harus dilaporkan
```

Pilihan JSON:

```text
- streaming parser JSON-P/Jackson;
- jangan full bind seluruh file;
- proses record per record;
- batasi memory;
- quarantine invalid records;
- metrics progress;
- idempotency import job.
```

Risiko utama:

```text
- OOM karena tree model;
- satu record invalid menggagalkan seluruh file;
- error report tidak stabil;
- retry import menggandakan data.
```

### 31.4 Scenario D: Regulatory Audit JSON

Kondisi:

```text
- perlu menyimpan before/after state
- perlu hash/signature
- perlu defensible replay
- data bisa dipakai investigasi
```

Pilihan JSON:

```text
- canonical serialization;
- deterministic field order;
- BigDecimal/string precision jelas;
- timestamp UTC/offset jelas;
- raw payload preservation jika legal;
- versioned schema;
- avoid lossy binding.
```

Risiko utama:

```text
- hash berubah karena field order;
- null/absent hilang;
- amount berubah presisi;
- timezone ambiguous;
- library upgrade mengubah output tanpa disadari.
```

---

## 32. Mini Comparison: API Feel

### 32.1 JSON-P Object Model

```java
JsonObject json = Json.createObjectBuilder()
    .add("customerId", "C-001")
    .add("name", "Alice")
    .build();
```

Good for:

```text
- manual construction;
- structural JSON;
- no DTO needed.
```

### 32.2 JSON-B

```java
Jsonb jsonb = JsonbBuilder.create();
String json = jsonb.toJson(new CustomerDto("C-001", "Alice"));
```

Good for:

```text
- standard Jakarta binding;
- DTO mapping.
```

### 32.3 Jackson

```java
ObjectMapper mapper = new ObjectMapper();
String json = mapper.writeValueAsString(new CustomerDto("C-001", "Alice"));
```

Good for:

```text
- Spring ecosystem;
- rich config;
- complex mapping.
```

### 32.4 Gson

```java
Gson gson = new Gson();
String json = gson.toJson(new CustomerDto("C-001", "Alice"));
```

Good for:

```text
- lightweight/simple conversion;
- legacy utility.
```

---

## 33. How a Top 1% Engineer Thinks About JSON Stack

Engineer biasa:

```text
Pakai library apa yang paling gampang?
```

Engineer senior:

```text
Library mana yang default framework?
Bagaimana null/absent semantics?
Apa unknown field policy per boundary?
Apakah date/time deterministic?
Apakah BigDecimal aman?
Apakah provider sama di test dan production?
Apakah ada contract sample?
Apa efek migrasi Java 8 ke 17/21?
Apakah annotation mencemari domain?
Bagaimana failure dimonitor?
```

Top 1% engineer:

```text
JSON library adalah bagian dari integration contract runtime.
Saya harus bisa menjelaskan behavior-nya saat normal, saat payload salah, saat schema berevolusi, saat library upgrade, saat app server berubah, dan saat incident production terjadi.
```

---

## 34. Ringkasan Keputusan

### 34.1 JSON-P

Pilih untuk:

- structural processing;
- streaming;
- JSON Patch/Pointer;
- dynamic payload;
- Jakarta standard low-level JSON.

Hindari sebagai satu-satunya solusi jika:

- butuh mapping banyak DTO stabil;
- tim tidak siap kode manual/stateful.

### 34.2 JSON-B

Pilih untuk:

- Jakarta standard object binding;
- DTO sederhana;
- container-managed Jakarta EE apps;
- portable API.

Hati-hati jika:

- framework utama Spring/Jackson;
- butuh fitur mapping advanced;
- provider behavior belum diuji.

### 34.3 Jackson

Pilih untuk:

- Spring Boot;
- complex JSON mapping;
- ecosystem module besar;
- performance/flexibility seimbang;
- event-driven microservices.

Hati-hati jika:

- config global terlalu longgar;
- polymorphism tidak dikunci;
- annotation bocor ke domain;
- library upgrade tidak dites contract.

### 34.4 Gson

Pilih untuk:

- utility sederhana;
- legacy code stabil;
- dependency ringan.

Hati-hati jika:

- enterprise framework integration kompleks;
- Java modularity/modern DTO needs;
- butuh policy ketat.

---

## 35. Latihan Pemahaman

Jawab tanpa melihat solusi.

### Latihan 1

Sebuah public write API menerima JSON command untuk membuat account. Apakah unknown field sebaiknya di-ignore agar forward-compatible?

Petunjuk:

```text
Bedakan producer/consumer compatibility dengan command input dari actor eksternal.
```

### Latihan 2

Sebuah service menerima file JSON 500 MB berisi array transaksi. Apakah memakai `ObjectMapper.readValue(file, TransactionBatch.class)` aman?

Petunjuk:

```text
Pertimbangkan memory, partial failure, progress, dan retry.
```

### Latihan 3

Sebuah DTO dipakai untuk REST response, Kafka event, dan audit hash. Apa risiko utamanya?

Petunjuk:

```text
Satu model dipakai untuk tiga kontrak dengan stabilitas dan serialization semantics berbeda.
```

### Latihan 4

Tim ingin migrasi dari Java 8 `javax.json.bind.*` ke Java 21 Jakarta. Apa saja yang harus dicek?

Petunjuk:

```text
Namespace, API dependency, provider, app server, transitive dependency, test runtime.
```

### Latihan 5

Kapan JSON-P lebih baik daripada JSON-B?

Petunjuk:

```text
Saat butuh kontrol struktur, streaming, patch, atau payload tidak cocok dipetakan langsung ke POJO.
```

---

## 36. Jawaban Latihan

### Jawaban 1

Tidak otomatis. Untuk public write API, unknown field sering lebih aman ditolak atau ditangani dengan allowlist, karena field tambahan bisa merupakan typo, misuse, atau mass-assignment attempt. Forward compatibility lebih relevan untuk consumer yang membaca response/event dari producer, bukan selalu untuk command input eksternal.

### Jawaban 2

Tidak ideal. Binding seluruh file ke `TransactionBatch` berisiko OOM dan membuat satu record invalid menggagalkan semua. Lebih aman memakai streaming parser, memproses record per record, memberi error report granular, dan mendesain retry/idempotency.

### Jawaban 3

Risikonya adalah contract coupling. REST response, Kafka event, dan audit hash punya kebutuhan berbeda: response bisa evolutif, event perlu compatibility, audit perlu determinisme/canonical form. Satu DTO bisa membuat perubahan kecil di satu boundary mematahkan boundary lain.

### Jawaban 4

Cek minimal:

- import `javax.*` ke `jakarta.*`;
- API artifact;
- provider implementation;
- app server/framework compatibility;
- transitive dependencies;
- annotation package;
- contract tests;
- runtime deployment model;
- NoSuchMethod/ClassNotFound risk;
- behavior serialization setelah migration.

### Jawaban 5

JSON-P lebih baik ketika kita tidak ingin langsung bind ke POJO, misalnya dynamic JSON, JSON Patch, partial extraction, streaming large payload, validasi struktural, canonical manipulation, atau boundary yang perlu defensive parsing.

---

## 37. Checklist Singkat Sebelum Lanjut ke Part 3

Pastikan kamu sudah paham:

- JSON-P adalah structural processing, bukan primarily POJO binding.
- JSON-B adalah Jakarta standard untuk object binding.
- Jackson adalah de-facto powerful ecosystem, terutama Spring.
- Gson sederhana, tetapi bukan default utama enterprise backend modern.
- API dan provider harus dibedakan.
- `javax.*` dan `jakarta.*` tidak boleh dicampur sembarangan.
- Null, absent, empty punya makna berbeda.
- Unknown field policy adalah keputusan kontrak.
- Date/time dan BigDecimal harus distandarkan.
- DTO boundary harus dipisah dari domain model.
- Contract test lebih penting daripada sekadar unit test mapper.

---

## 38. Referensi Resmi dan Bacaan Lanjutan

Referensi berikut dipakai untuk memastikan istilah dan positioning sesuai sumber resmi:

1. Jakarta JSON Processing specification page — mendefinisikan JSON-P sebagai framework Java untuk parsing, generating, transforming, dan querying JSON documents.  
   <https://jakarta.ee/specifications/jsonp/>

2. Jakarta JSON Processing 2.1 — release untuk Jakarta EE 10.  
   <https://jakarta.ee/specifications/jsonp/2.1/>

3. Jakarta JSON Binding specification page — mendefinisikan JSON-B sebagai binding framework untuk converting Java objects ke/dari JSON documents.  
   <https://jakarta.ee/specifications/jsonb/>

4. Jakarta EE Tutorial — JSON-B, menjelaskan JSON-B sebagai standard binding layer dan menyebut Yasson sebagai salah satu reference implementation.  
   <https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jsonb/jsonb.html>

5. Eclipse Parsson project — implementasi Jakarta JSON Processing.  
   <https://projects.eclipse.org/projects/ee4j.parsson>

6. Eclipse Parsson GitHub repository — menyatakan Parsson sebagai implementasi Jakarta JSON Processing specification.  
   <https://github.com/eclipse-ee4j/parsson>

7. Jackson Databind GitHub repository — menjelaskan databind dan tree model Jackson yang dibangun di atas streaming API.  
   <https://github.com/FasterXML/jackson-databind>

8. Jackson main portal repository — menjelaskan Jackson sebagai suite data-processing tools termasuk streaming JSON parser/generator, databinding, dan modules.  
   <https://github.com/FasterXML/jackson>

9. Gson User Guide — menjelaskan Gson sebagai library untuk mengubah Java Objects ke JSON representation dan sebaliknya.  
   <https://github.com/google/gson/blob/main/UserGuide.md>

10. Moshi GitHub repository — menjelaskan Moshi sebagai modern JSON library untuk Android, Java, dan Kotlin.  
    <https://github.com/square/moshi>

---

## 39. Penutup Part 2

Di Part 2 ini kita belum belajar detail syntax JSON-P atau JSON-B. Kita membangun peta agar pilihan library tidak berdasarkan kebiasaan, tetapi berdasarkan boundary, contract, runtime, dan failure model.

Mulai Part 3, kita akan masuk ke JSON-P secara mendalam:

```text
Part 3 — JSON-P Core Mental Model:
Object Model API, JsonObject, JsonArray, JsonValue, JsonReader, JsonWriter,
provider/runtime model, immutable tree, dan kapan object model lebih tepat daripada binding.
```

Status seri: **belum selesai**.  
Part ini adalah **Part 2 dari 34**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-001.md">⬅️ Part 1 — Data Format as Contract: JSON, XML, XSD, WSDL, and Integration Compatibility</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-003.md">Part 3 — JSON-P Core Mental Model: Object Model, Reader/Writer, Builder, Provider, Immutability, dan Boundary Thinking ➡️</a>
</div>
