# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-006

# Part 6 — Message Types: TextMessage, BytesMessage, MapMessage, ObjectMessage, StreamMessage, Generic Message

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: `006 / 035`  
> Target pembaca: engineer Java backend / enterprise engineer yang ingin memahami JMS/Jakarta Messaging sampai level desain sistem produksi  
> Target Java: Java 8 sampai Java 25  
> API lineage: JMS 1.1 / JMS 2.0 (`javax.jms`) dan Jakarta Messaging 3.x (`jakarta.jms`)

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita membedah anatomi message: header, properties, body, metadata, correlation, dan semantic contract. Part ini masuk lebih dalam ke **jenis body message** yang disediakan JMS/Jakarta Messaging.

Jakarta Messaging mendefinisikan beberapa interface message utama: `Message`, `TextMessage`, `BytesMessage`, `MapMessage`, `ObjectMessage`, dan `StreamMessage`. Ini disebutkan langsung dalam spesifikasi Jakarta Messaging 3.1 sebagai interface umum untuk pesan yang dikirim atau diterima dari provider. Referensi resmi: Jakarta Messaging 3.1 Specification dan API Documentation.  

Referensi:

- Jakarta Messaging 3.1 Specification: <https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html>
- Jakarta Messaging 3.1 API — `Message`: <https://jakarta.ee/specifications/messaging/3.1/apidocs/jakarta.messaging/jakarta/jms/message>
- Jakarta Messaging 3.1 API — `ObjectMessage`: <https://jakarta.ee/specifications/messaging/3.1/apidocs/jakarta.messaging/jakarta/jms/objectmessage>
- Jakarta EE Tutorial — Messaging Concepts: <https://jakarta.ee/learn/docs/jakartaee-tutorial/current/messaging/jms-concepts/jms-concepts.html>

Tujuan utama part ini bukan hanya menjawab “pakai message type yang mana?”, tetapi membangun kemampuan engineering untuk menjawab:

1. Apa implikasi setiap message type terhadap compatibility?
2. Apa implikasi terhadap performance, memory, dan broker storage?
3. Apa implikasi terhadap schema evolution?
4. Apa implikasi terhadap security?
5. Apa implikasi terhadap portability antar provider JMS?
6. Apa message type yang layak dipakai untuk sistem enterprise jangka panjang?
7. Kapan fitur JMS message type justru menjadi jebakan desain?

---

## 2. Mental Model Utama: JMS Message Type Adalah Keputusan Kontrak, Bukan Sekadar Format Data

Banyak engineer memperlakukan message type sebagai detail coding:

```java
TextMessage message = session.createTextMessage(json);
producer.send(message);
```

Itu benar secara teknis, tapi dangkal secara desain.

Dalam sistem enterprise, pemilihan message type adalah keputusan kontrak yang mempengaruhi:

- siapa yang bisa membaca message,
- bagaimana message berevolusi,
- apakah message bisa di-debug,
- bagaimana payload disimpan broker,
- apakah payload aman terhadap deserialization attack,
- apakah consumer lama tetap bisa membaca message baru,
- apakah message bisa dipindahkan antar broker/provider,
- apakah DLQ bisa dianalisis operator,
- apakah replay bisa dilakukan setelah beberapa bulan,
- apakah pesan bisa dikonsumsi oleh non-Java system.

Jadi pertanyaan sebenarnya bukan:

> “JMS punya tipe apa saja?”

Tetapi:

> “Jenis body apa yang menjaga sistem tetap evolvable, observable, secure, portable, dan recoverable?”

Top 1% engineer tidak memilih `ObjectMessage` hanya karena mudah, atau `TextMessage` hanya karena familiar. Mereka memilih berdasarkan lifecycle kontrak dan failure model.

---

## 3. Ringkasan Message Type JMS/Jakarta Messaging

Secara konseptual:

| Type | Body | Mental Model | Umum Dipakai? | Catatan |
|---|---|---|---|---|
| `Message` | Tidak punya body aplikasi | Signal/control message | Kadang | Cocok untuk trigger/event kosong |
| `TextMessage` | `String` | Text payload seperti JSON/XML | Sangat umum | Default terbaik untuk banyak sistem enterprise |
| `BytesMessage` | Raw bytes | Binary payload, custom encoding | Umum untuk high-performance/integration | Butuh schema dan encoding discipline |
| `MapMessage` | Key-value typed map | Structured fields kecil | Kadang | Convenience API, tapi kurang ideal untuk long-term contract |
| `ObjectMessage` | Java `Serializable` object | Java object serialization | Sebaiknya dihindari | Risiko security, compatibility, coupling Java class |
| `StreamMessage` | Sequential primitive stream | Ordered typed stream | Jarang | Sulit berevolusi, jarang jadi pilihan modern |

Prinsip cepat:

- Untuk enterprise integration modern: **prefer `TextMessage` berisi JSON/XML envelope** atau **`BytesMessage` berisi format biner eksplisit**.
- Untuk sistem yang butuh interoperability lintas bahasa: hindari `ObjectMessage`.
- Untuk long-lived contract: hindari format yang bergantung pada class Java internal.
- Untuk regulated/operational environment: pilih format yang mudah diinspeksi, divalidasi, direplay, dan diaudit.

---

## 4. Generic `Message`: Pesan Tanpa Body

### 4.1 Apa Itu `Message`?

`Message` adalah root interface dari semua message JMS/Jakarta Messaging. Ia memiliki header dan properties, tetapi tidak memiliki body aplikasi.

Contoh legacy JMS 1.1 / Java EE style:

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.Destination;
import javax.jms.Message;
import javax.jms.MessageProducer;
import javax.jms.Session;

public final class HeartbeatPublisher {
    public void sendHeartbeat(ConnectionFactory connectionFactory, Destination destination) throws Exception {
        try (Connection connection = connectionFactory.createConnection()) {
            Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
            MessageProducer producer = session.createProducer(destination);

            Message message = session.createMessage();
            message.setStringProperty("eventType", "HEARTBEAT");
            message.setStringProperty("component", "case-worker-01");
            message.setLongProperty("observedAtEpochMillis", System.currentTimeMillis());

            producer.send(message);
        }
    }
}
```

Contoh Jakarta Messaging simplified API:

```java
import jakarta.jms.ConnectionFactory;
import jakarta.jms.Destination;
import jakarta.jms.JMSContext;
import jakarta.jms.Message;

public final class JakartaHeartbeatPublisher {
    public void sendHeartbeat(ConnectionFactory connectionFactory, Destination destination) {
        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            Message message = context.createMessage();
            message.setStringProperty("eventType", "HEARTBEAT");
            message.setStringProperty("component", "case-worker-01");
            message.setLongProperty("observedAtEpochMillis", System.currentTimeMillis());

            context.createProducer().send(destination, message);
        }
    }
}
```

### 4.2 Kapan `Message` Tanpa Body Masuk Akal?

`Message` tanpa body cocok untuk:

1. **Signal message**  
   Misalnya `REINDEX_REQUESTED`, `CACHE_INVALIDATE_ALL`, `REFRESH_CONFIG`, `HEARTBEAT`, `WAKE_UP_WORKER`.

2. **Control-plane event**  
   Pesan bukan membawa data domain, tapi menginstruksikan runtime behavior.

3. **Header/property-only routing**  
   Consumer hanya butuh property tertentu untuk menentukan tindakan.

4. **Minimal trigger**  
   Body tidak dibutuhkan karena consumer akan membaca state terbaru dari source of truth.

Contoh:

```text
Destination: queue.case.reindex.request
Properties:
  commandType = REINDEX_CASE
  caseId      = CASE-2026-000091
  requestedBy = system-maintenance
Body:
  <empty>
```

Ini valid bila `caseId` cukup sebagai referensi dan semua detail dibaca dari database.

### 4.3 Risiko `Message` Tanpa Body

Risiko utamanya adalah semantic contract tersebar di properties.

JMS properties memang berguna untuk routing dan metadata, tetapi jika semua payload domain dipaksa menjadi properties, desain menjadi rapuh:

- property type terbatas,
- nested object tidak natural,
- schema sulit divalidasi,
- kontrak sulit didokumentasikan,
- selector performance bisa terganggu bila property terlalu banyak,
- business payload bercampur dengan broker routing metadata.

Anti-pattern:

```text
Properties:
  caseId = C-001
  applicantName = Alice
  applicantAddressLine1 = ...
  applicantAddressLine2 = ...
  applicantPostalCode = ...
  licenseType = ...
  previousLicenseStatus = ...
  decision = ...
  remarks = ...
  ... 80 fields later
Body:
  <empty>
```

Ini bukan lagi metadata. Ini payload domain yang kebetulan ditempatkan di properties.

### 4.4 Heuristik

Gunakan `Message` tanpa body jika:

- pesan benar-benar hanya signal,
- semua data domain bisa diambil dari source of truth,
- properties tidak menjadi object model tersembunyi,
- message tetap bisa dipahami operator,
- semantic contract kecil dan stabil.

Jangan gunakan jika:

- payload memiliki struktur kompleks,
- butuh schema evolution,
- butuh audit payload lengkap,
- butuh replay tanpa akses ke source system lama,
- properties mulai menjadi “database row mini”.

---

## 5. `TextMessage`: Pilihan Default untuk Banyak Sistem Enterprise

### 5.1 Apa Itu `TextMessage`?

`TextMessage` membawa body berupa `String`. Dokumentasi API menyatakan `TextMessage` digunakan untuk mengirim pesan berisi `java.lang.String`, termasuk text-based message seperti XML content.

Dalam praktik modern, `TextMessage` paling sering membawa:

- JSON,
- XML,
- CSV kecil,
- plain text command,
- structured envelope berbasis text.

Contoh Java 8 / JMS 1.1:

```java
import javax.jms.Destination;
import javax.jms.MessageProducer;
import javax.jms.Session;
import javax.jms.TextMessage;

public final class CaseSubmittedPublisher {
    public void publish(Session session, MessageProducer producer, Destination destination) throws Exception {
        String json = """
                {
                  "eventType": "CaseSubmitted",
                  "eventVersion": 1,
                  "eventId": "evt-10001",
                  "occurredAt": "2026-06-18T10:15:30Z",
                  "caseId": "CASE-2026-000001",
                  "submittedBy": "user-123"
                }
                """;

        TextMessage message = session.createTextMessage(json);
        message.setStringProperty("eventType", "CaseSubmitted");
        message.setIntProperty("eventVersion", 1);
        message.setStringProperty("caseId", "CASE-2026-000001");

        producer.send(destination, message);
    }
}
```

Untuk Java 8, text block belum tersedia, jadi:

```java
String json = "{"
        + "\"eventType\":\"CaseSubmitted\"," 
        + "\"eventVersion\":1,"
        + "\"eventId\":\"evt-10001\"," 
        + "\"caseId\":\"CASE-2026-000001\""
        + "}";
```

Contoh Jakarta Messaging:

```java
import jakarta.jms.ConnectionFactory;
import jakarta.jms.Destination;
import jakarta.jms.JMSContext;
import jakarta.jms.TextMessage;

public final class JakartaCaseSubmittedPublisher {
    public void publish(ConnectionFactory connectionFactory, Destination destination) {
        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            String json = """
                    {
                      "eventType": "CaseSubmitted",
                      "eventVersion": 1,
                      "eventId": "evt-10001",
                      "occurredAt": "2026-06-18T10:15:30Z",
                      "caseId": "CASE-2026-000001",
                      "submittedBy": "user-123"
                    }
                    """;

            TextMessage message = context.createTextMessage(json);
            message.setStringProperty("eventType", "CaseSubmitted");
            message.setIntProperty("eventVersion", 1);
            message.setStringProperty("caseId", "CASE-2026-000001");

            context.createProducer().send(destination, message);
        }
    }
}
```

### 5.2 Mengapa `TextMessage` Sering Menjadi Default yang Baik?

Karena `TextMessage` memiliki kombinasi properti yang kuat:

1. **Readable**  
   Operator bisa membuka DLQ dan melihat payload.

2. **Portable**  
   JSON/XML bisa dibaca oleh Java, .NET, Node.js, Go, Python, dan tool observability.

3. **Versionable**  
   Field baru bisa ditambahkan dengan compatibility strategy.

4. **Debuggable**  
   Mudah dicopy ke test fixture, log sample, replay tool, atau contract test.

5. **Governable**  
   Bisa divalidasi dengan JSON Schema, XML Schema, atau custom validator.

6. **Less coupled to Java class**  
   Tidak mengikat consumer pada package/class Java tertentu.

7. **Operationally friendly**  
   DLQ triage lebih mudah karena payload tidak opaque.

### 5.3 TextMessage Bukan Berarti Tanpa Struktur

Kesalahan umum: karena `TextMessage` hanya string, engineer menganggapnya bebas format.

Ini buruk:

```text
APPROVE|CASE-123|USER-88|2026-06-18
```

Lebih baik gunakan envelope eksplisit:

```json
{
  "messageId": "msg-01HYX7J7A0S4FZX6G5ZQW3A9QB",
  "messageType": "CaseApprovalRequested",
  "messageVersion": 2,
  "correlationId": "corr-2026-00001",
  "causationId": "cmd-2026-00077",
  "occurredAt": "2026-06-18T10:15:30Z",
  "producer": {
    "service": "case-service",
    "version": "4.12.0"
  },
  "payload": {
    "caseId": "CASE-2026-000001",
    "requestedBy": "user-123",
    "approvalStage": "SUPERVISOR_REVIEW"
  }
}
```

Mental model:

```text
JMS Header      = broker/runtime metadata
JMS Properties  = routing/filtering/observability metadata
Text body       = business semantic contract
```

Jangan membaliknya.

### 5.4 JSON vs XML di `TextMessage`

#### JSON Cocok Bila:

- consumer heterogen,
- message relatif domain-event-like,
- butuh human-readable payload,
- evolusi additive field mudah,
- contract test bisa berbasis JSON Schema,
- integrasi modern microservices.

#### XML Cocok Bila:

- enterprise legacy integration,
- payload berbasis dokumen formal,
- ada XSD kuat,
- namespace/versioning XML sudah matang,
- butuh canonical document format,
- integrasi SOAP/legacy masih besar.

#### Trade-off

| Aspek | JSON | XML |
|---|---|---|
| Verbosity | Lebih ringkas | Lebih verbose |
| Schema | JSON Schema, Avro schema, custom | XSD mature |
| Namespace | Lemah/native tidak ada | Kuat |
| Human-readable | Baik | Baik tapi lebih berat |
| Enterprise legacy | Cukup | Sangat kuat |
| Tooling modern web | Sangat kuat | Cukup |
| Payload size | Biasanya lebih kecil | Biasanya lebih besar |

### 5.5 Kelemahan `TextMessage`

`TextMessage` bukan selalu terbaik. Kelemahannya:

1. **Parsing cost**  
   JSON/XML perlu parse. Untuk high-throughput payload besar, cost signifikan.

2. **Encoding ambiguity jika tidak disiplin**  
   String harus diperlakukan sebagai Unicode text. Tapi sistem eksternal kadang mencampur encoding assumption.

3. **Payload biner tidak cocok**  
   Jangan base64 file besar ke `TextMessage` tanpa alasan kuat.

4. **Schema optional discipline**  
   JSON yang terlalu bebas bisa menjadi “dynamic map hell”.

5. **Numeric precision issue**  
   JSON number bisa bermasalah untuk decimal/money bila lintas bahasa.

6. **Large payload problem**  
   Message broker bukan object storage. Payload besar menyebabkan memory, network, journal, paging, dan DLQ problem.

### 5.6 Production Heuristik untuk `TextMessage`

Gunakan `TextMessage` bila:

- payload berbasis dokumen/text,
- perlu dibaca manusia/operator,
- consumer lintas bahasa,
- throughput moderate,
- payload tidak terlalu besar,
- evolusi kontrak lebih penting daripada raw performance,
- replay/debug/audit penting.

Jangan gunakan `TextMessage` bila:

- payload dominan binary,
- payload sangat besar,
- latency parse sangat kritis,
- format butuh compact binary schema,
- consumer semua high-performance binary pipeline.

---

## 6. `BytesMessage`: Raw Bytes untuk Format Eksplisit dan High-Performance Integration

### 6.1 Apa Itu `BytesMessage`?

`BytesMessage` membawa stream of bytes. Receiver bertanggung jawab menginterpretasikan bytes tersebut.

Ini cocok untuk payload yang formatnya bukan String, misalnya:

- Protobuf,
- Avro binary,
- MessagePack,
- CBOR,
- encrypted payload,
- compressed JSON,
- custom binary protocol,
- file chunk kecil,
- image thumbnail kecil,
- integration dengan system binary.

Contoh JMS 1.1:

```java
import javax.jms.BytesMessage;
import javax.jms.MessageProducer;
import javax.jms.Session;
import java.nio.charset.StandardCharsets;

public final class BinaryPublisher {
    public void publish(Session session, MessageProducer producer) throws Exception {
        byte[] payload = "{\"eventType\":\"CaseSubmitted\"}".getBytes(StandardCharsets.UTF_8);

        BytesMessage message = session.createBytesMessage();
        message.writeBytes(payload);
        message.setStringProperty("contentType", "application/json");
        message.setStringProperty("contentEncoding", "utf-8");
        message.setStringProperty("messageType", "CaseSubmitted");
        message.setIntProperty("messageVersion", 1);

        producer.send(message);
    }
}
```

Consumer:

```java
import javax.jms.BytesMessage;
import javax.jms.Message;
import java.nio.charset.StandardCharsets;

public final class BinaryConsumer {
    public void handle(Message message) throws Exception {
        if (!(message instanceof BytesMessage)) {
            throw new IllegalArgumentException("Expected BytesMessage but got " + message.getClass());
        }

        BytesMessage bytesMessage = (BytesMessage) message;
        long length = bytesMessage.getBodyLength();

        if (length > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Message body too large: " + length);
        }

        byte[] bytes = new byte[(int) length];
        bytesMessage.readBytes(bytes);

        String json = new String(bytes, StandardCharsets.UTF_8);
        // parse json
    }
}
```

Contoh Jakarta Messaging:

```java
import jakarta.jms.BytesMessage;
import jakarta.jms.ConnectionFactory;
import jakarta.jms.Destination;
import jakarta.jms.JMSContext;
import java.nio.charset.StandardCharsets;

public final class JakartaBinaryPublisher {
    public void publish(ConnectionFactory connectionFactory, Destination destination) {
        try (JMSContext context = connectionFactory.createContext()) {
            byte[] payload = "{\"eventType\":\"CaseSubmitted\"}".getBytes(StandardCharsets.UTF_8);

            BytesMessage message = context.createBytesMessage();
            message.writeBytes(payload);
            message.setStringProperty("contentType", "application/json");
            message.setStringProperty("contentEncoding", "utf-8");
            message.setStringProperty("messageType", "CaseSubmitted");
            message.setIntProperty("messageVersion", 1);

            context.createProducer().send(destination, message);
        }
    }
}
```

### 6.2 Mental Model `BytesMessage`

`BytesMessage` artinya:

> JMS provider hanya mengantar byte sequence. Semantics sepenuhnya milik aplikasi.

Karena itu, metadata format wajib eksplisit.

Minimal properties yang disarankan:

```text
contentType      = application/x-protobuf | application/json | application/avro | application/octet-stream
contentEncoding  = identity | gzip | zstd | aes-gcm+gzip | utf-8
schemaName       = case.submitted
schemaVersion    = 3
messageType      = CaseSubmitted
messageVersion   = 3
```

Tanpa metadata ini, `BytesMessage` menjadi opaque blob.

### 6.3 BytesMessage dan Schema

Jika menggunakan binary format, jangan hanya menaruh bytes. Harus ada schema governance.

Contoh envelope konseptual:

```text
JMS Properties:
  messageType      = CaseSubmitted
  schemaFormat     = protobuf
  schemaName       = gov.case.CaseSubmitted
  schemaVersion    = 4
  contentType      = application/x-protobuf
  contentEncoding  = identity

Body:
  <protobuf bytes>
```

Atau Avro:

```text
JMS Properties:
  messageType      = CaseSubmitted
  schemaFormat     = avro
  schemaFingerprint = 0x93ac...
  contentType      = application/avro-binary

Body:
  <avro binary>
```

Top 1% rule:

> Binary payload without explicit schema metadata is technical debt disguised as performance optimization.

### 6.4 BytesMessage untuk Compression

Kadang payload JSON besar dikompres lalu dikirim sebagai `BytesMessage`.

Contoh:

```text
contentType      = application/json
contentEncoding  = gzip
body             = gzip(jsonBytes)
```

Ini valid jika:

- payload cukup besar sehingga compression menguntungkan,
- consumer tahu cara decompress,
- observability tetap punya sample/tracing,
- DLQ tooling bisa decode,
- CPU cost compression diterima.

Hati-hati: compression mengurangi readability langsung di broker console.

### 6.5 BytesMessage untuk Encryption

Payload-level encryption bisa menggunakan `BytesMessage`:

```text
contentType        = application/json
contentEncoding    = aes-256-gcm
keyId              = kms-key-2026-06
body               = encrypted(jsonBytes)
```

Namun security design harus matang:

- key rotation,
- authenticated encryption,
- nonce/IV uniqueness,
- integrity check,
- replay implications,
- DLQ analysis procedure,
- separation antara transport TLS dan payload encryption.

Transport TLS melindungi data in transit. Payload encryption melindungi data saat tersimpan di broker/journal/DLQ/backups, tergantung desain.

### 6.6 Kelebihan `BytesMessage`

1. **Efisien untuk binary format**
2. **Tidak memaksa payload menjadi String**
3. **Bisa lebih compact daripada JSON/XML**
4. **Cocok untuk Protobuf/Avro/CBOR**
5. **Bisa membawa encrypted/compressed payload**
6. **Lebih jelas untuk non-text data**

### 6.7 Kelemahan `BytesMessage`

1. **Opaque bagi manusia**
2. **Butuh tooling decode**
3. **Lebih sulit debugging DLQ**
4. **Schema governance wajib**
5. **Payload besar tetap buruk untuk broker**
6. **Portability bergantung pada format bytes, bukan JMS**

### 6.8 Heuristik

Gunakan `BytesMessage` bila:

- format binary eksplisit,
- payload encrypted/compressed,
- performance/size penting,
- semua consumer punya decoder,
- schema registry/governance tersedia,
- DLQ tooling mampu decode.

Jangan gunakan bila:

- hanya karena “lebih cepat” tanpa benchmark,
- operator butuh inspeksi manual cepat,
- schema belum stabil,
- consumer heterogen tapi decoder belum matang,
- payload sebenarnya text kecil yang lebih baik jadi `TextMessage`.

---

## 7. `MapMessage`: Structured Key-Value Convenience, Tapi Bukan Contract Ideal

### 7.1 Apa Itu `MapMessage`?

`MapMessage` membawa body berupa map dari nama field ke value typed primitive/String. Ia terasa nyaman karena mirip object sederhana:

```java
import javax.jms.MapMessage;
import javax.jms.MessageProducer;
import javax.jms.Session;

public final class MapMessagePublisher {
    public void publish(Session session, MessageProducer producer) throws Exception {
        MapMessage message = session.createMapMessage();
        message.setString("eventType", "CaseSubmitted");
        message.setString("caseId", "CASE-2026-000001");
        message.setString("submittedBy", "user-123");
        message.setLong("submittedAtEpochMillis", System.currentTimeMillis());
        message.setInt("eventVersion", 1);

        producer.send(message);
    }
}
```

Consumer:

```java
import javax.jms.MapMessage;
import javax.jms.Message;

public final class MapMessageConsumer {
    public void handle(Message message) throws Exception {
        if (!(message instanceof MapMessage)) {
            throw new IllegalArgumentException("Expected MapMessage");
        }

        MapMessage map = (MapMessage) message;
        String eventType = map.getString("eventType");
        String caseId = map.getString("caseId");
        String submittedBy = map.getString("submittedBy");
        long submittedAt = map.getLong("submittedAtEpochMillis");
    }
}
```

### 7.2 Kapan `MapMessage` Terlihat Menarik?

`MapMessage` menarik karena:

- tidak perlu JSON parser,
- field access langsung,
- tipe primitive tersedia,
- cocok untuk payload kecil,
- mudah untuk demo/simple integration.

Contoh use case masuk akal:

```text
Message type: MetricsSample
Fields:
  component = worker-01
  queueDepth = 1234
  activeConsumers = 8
  observedAtEpochMillis = 1781760000000
```

### 7.3 Problem `MapMessage`

Namun untuk long-term enterprise contract, `MapMessage` punya kelemahan besar:

1. **Kurang natural untuk nested structure**  
   Domain object sering punya nested object/list. Map flat cepat menjadi aneh.

2. **Tidak seportable JSON/XML**  
   Secara API ini JMS-specific. Consumer non-JMS/non-Java lebih sulit.

3. **Schema tooling lebih lemah**  
   Tidak ada JSON Schema/XSD natural.

4. **Evolution discipline manual**  
   Field optional, default, enum, nested compatibility harus diatur sendiri.

5. **Tidak ideal untuk audit document**  
   Operator membaca map mungkin bisa, tapi document semantics kurang jelas.

6. **Provider representation bisa berbeda**  
   Walaupun API standard, internal encoding/provider tooling bisa berbeda.

### 7.4 MapMessage vs Properties

Pertanyaan penting:

> Jika `MapMessage` adalah key-value, bedanya dengan JMS properties apa?

Bedanya secara desain:

```text
Properties = metadata untuk broker/app routing, filtering, tracing, classification
Map body   = data aplikasi utama dalam bentuk key-value
```

Jangan gunakan properties untuk seluruh payload. Tapi juga jangan otomatis gunakan `MapMessage` untuk payload domain kompleks.

Contoh yang masih wajar:

```text
JMS Properties:
  messageType = WorkerMetricReported
  source = worker-01

Map body:
  cpuUsagePercent = 81.3
  heapUsedBytes = 900000000
  activeJobs = 12
```

Contoh yang mulai buruk:

```text
Map body:
  applicant.name = ...
  applicant.address.line1 = ...
  applicant.address.line2 = ...
  applicant.documents[0].type = ...
  applicant.documents[0].fileId = ...
  applicant.documents[1].type = ...
```

Kalau sudah seperti ini, gunakan JSON/XML/Protobuf.

### 7.5 Heuristik

Gunakan `MapMessage` bila:

- payload kecil,
- struktur flat,
- consumer JMS-only,
- contract short-lived/internal,
- observability/metrics/control message sederhana.

Hindari `MapMessage` bila:

- payload domain kompleks,
- butuh nested structure,
- consumer lintas bahasa,
- schema evolution penting,
- kontrak harus hidup bertahun-tahun,
- DLQ/replay/audit perlu document-level semantics.

---

## 8. `ObjectMessage`: Nyaman, Tapi Sangat Berbahaya untuk Sistem Enterprise Modern

### 8.1 Apa Itu `ObjectMessage`?

`ObjectMessage` membawa Java object yang `Serializable`. Dokumentasi API menyatakan `ObjectMessage` digunakan untuk mengirim pesan yang berisi object serializable dalam bahasa Java.

Contoh:

```java
import java.io.Serializable;

public final class CaseSubmittedEvent implements Serializable {
    private static final long serialVersionUID = 1L;

    private final String caseId;
    private final String submittedBy;

    public CaseSubmittedEvent(String caseId, String submittedBy) {
        this.caseId = caseId;
        this.submittedBy = submittedBy;
    }

    public String getCaseId() {
        return caseId;
    }

    public String getSubmittedBy() {
        return submittedBy;
    }
}
```

Publisher:

```java
import javax.jms.ObjectMessage;
import javax.jms.MessageProducer;
import javax.jms.Session;

public final class ObjectMessagePublisher {
    public void publish(Session session, MessageProducer producer) throws Exception {
        CaseSubmittedEvent event = new CaseSubmittedEvent("CASE-2026-000001", "user-123");
        ObjectMessage message = session.createObjectMessage(event);
        producer.send(message);
    }
}
```

Consumer:

```java
import javax.jms.Message;
import javax.jms.ObjectMessage;

public final class ObjectMessageConsumer {
    public void handle(Message message) throws Exception {
        ObjectMessage objectMessage = (ObjectMessage) message;
        CaseSubmittedEvent event = (CaseSubmittedEvent) objectMessage.getObject();
        // process event
    }
}
```

Terlihat indah. Justru karena itulah berbahaya.

### 8.2 Masalah Utama: Coupling ke Class Java

`ObjectMessage` membuat kontrak message bergantung pada:

- nama package,
- nama class,
- field serialization,
- `serialVersionUID`,
- classpath consumer,
- versi library yang sama/compatible,
- Java serialization behavior.

Artinya message tidak lagi hanya kontrak data. Message menjadi snapshot internal object model Java.

Jika producer mengubah:

```java
com.company.caseapp.event.CaseSubmittedEvent
```

menjadi:

```java
com.company.caseapp.messaging.events.CaseSubmittedEvent
```

message lama bisa gagal dibaca.

Jika field berubah, class berubah, atau dependency hilang, DLQ replay bisa rusak.

### 8.3 Masalah Security: Deserialization Risk

Java deserialization historically adalah area risiko security. `ObjectMessage` memerlukan deserialization object. Jika boundary tidak dikontrol ketat, consumer bisa terekspos pada payload yang menyebabkan deserialization gadget chain atau class loading problem.

Walaupun broker/provider modern bisa memiliki allowlist/trust package mechanism, desain terbaik tetap:

> Jangan jadikan Java native serialization sebagai format kontrak antar sistem.

Terutama untuk:

- message dari external system,
- multi-team environment,
- long-lived queues,
- DLQ replay,
- regulated system,
- system yang menerima message dari boundary tidak sepenuhnya trusted.

### 8.4 Masalah Portability

`ObjectMessage` praktis Java-specific. Sistem .NET, Node.js, Go, atau Python tidak dapat membaca payload tanpa memahami Java serialization.

JMS memang API Java. Tetapi enterprise system modern sering butuh integration heterogen. Mengirim Java object berarti mengunci ekosistem.

### 8.5 Masalah Evolution

Dengan JSON/Protobuf, kita bisa mendesain evolution rule:

- field optional,
- default value,
- additive field,
- deprecate field,
- ignore unknown field,
- schema version.

Dengan Java serialization, evolution lebih rapuh. `serialVersionUID` membantu, tetapi tidak menyelesaikan semantic evolution.

Contoh problem:

Versi 1:

```java
public final class CaseSubmittedEvent implements Serializable {
    private static final long serialVersionUID = 1L;
    private String caseId;
    private String submittedBy;
}
```

Versi 2:

```java
public final class CaseSubmittedEvent implements Serializable {
    private static final long serialVersionUID = 1L;
    private String caseId;
    private UserRef submittedBy;
}
```

Meskipun UID sama, semantic berubah besar.

### 8.6 Masalah Observability dan DLQ

Saat message masuk DLQ, operator ingin tahu:

- ini message apa?
- entity apa?
- gagal karena apa?
- bisa replay atau tidak?
- perlu repair field apa?

Dengan `TextMessage`, operator bisa melihat payload JSON/XML.

Dengan `ObjectMessage`, payload sering opaque. Butuh classpath dan tooling khusus untuk decode. Jika class lama tidak tersedia, payload bisa menjadi artefak mati.

### 8.7 Apakah `ObjectMessage` Selalu Salah?

Tidak selalu. Ada use case terbatas:

- sistem internal sangat tertutup,
- producer/consumer deploy bersama,
- message short-lived,
- tidak ada requirement cross-language,
- tidak ada untrusted producer,
- package/class compatibility dikontrol ketat,
- broker/provider dikonfigurasi dengan allowlist deserialization,
- tidak dipakai untuk long-term durable integration.

Misalnya job queue internal dalam monolith modular yang semua worker versi sama.

Tetapi untuk enterprise integration, default stance:

> Treat `ObjectMessage` as legacy/convenience feature, not as strategic integration format.

### 8.8 Replacement yang Lebih Baik

Daripada:

```java
ObjectMessage(CaseSubmittedEvent)
```

Gunakan:

```java
TextMessage(JSON(CaseSubmittedEventEnvelope))
```

atau:

```java
BytesMessage(Protobuf(CaseSubmittedEvent))
```

Dengan properties:

```text
messageType = CaseSubmitted
messageVersion = 2
contentType = application/json
schemaName = case.submitted
schemaVersion = 2
```

### 8.9 Heuristik

Hindari `ObjectMessage` jika:

- message durable,
- message bisa masuk DLQ,
- replay penting,
- consumer lintas service/team,
- ada security boundary,
- kontrak perlu bertahan lama,
- consumer bukan Java,
- class evolution sering terjadi.

Pertimbangkan hanya jika:

- full control producer/consumer,
- internal-only,
- short-lived,
- classpath locked,
- deserialization allowlist diterapkan,
- ada alasan kuat dan terdokumentasi.

---

## 9. `StreamMessage`: Sequential Typed Stream yang Jarang Dibutuhkan

### 9.1 Apa Itu `StreamMessage`?

`StreamMessage` membawa sequence value typed primitive/String yang dibaca dalam urutan yang sama dengan saat ditulis.

Contoh:

```java
import javax.jms.MessageProducer;
import javax.jms.Session;
import javax.jms.StreamMessage;

public final class StreamPublisher {
    public void publish(Session session, MessageProducer producer) throws Exception {
        StreamMessage message = session.createStreamMessage();
        message.writeString("CaseSubmitted");
        message.writeString("CASE-2026-000001");
        message.writeString("user-123");
        message.writeLong(System.currentTimeMillis());

        producer.send(message);
    }
}
```

Consumer:

```java
import javax.jms.Message;
import javax.jms.StreamMessage;

public final class StreamConsumer {
    public void handle(Message message) throws Exception {
        StreamMessage stream = (StreamMessage) message;
        String eventType = stream.readString();
        String caseId = stream.readString();
        String submittedBy = stream.readString();
        long submittedAt = stream.readLong();
    }
}
```

### 9.2 Mental Model

`StreamMessage` mirip positional record:

```text
[0] eventType: string
[1] caseId: string
[2] submittedBy: string
[3] submittedAtEpochMillis: long
```

Masalahnya: posisi menjadi kontrak.

Jika versi 2 menambahkan field di tengah:

```text
[0] eventType
[1] caseId
[2] applicationType   <-- new field
[3] submittedBy
[4] submittedAt
```

Consumer lama bisa membaca field salah.

### 9.3 Kelemahan `StreamMessage`

1. **Schema implisit berbasis urutan**
2. **Sulit evolusi**
3. **Sulit debug dibanding JSON/XML**
4. **Kurang natural untuk nested data**
5. **Jarang didukung tooling operasional dengan baik**
6. **Tidak populer dalam desain modern**

### 9.4 Kapan Masih Masuk Akal?

`StreamMessage` bisa dipertimbangkan untuk:

- protocol internal sangat kecil,
- positional format fixed,
- compatibility tidak menjadi prioritas,
- legacy integration,
- micro-optimization yang sudah dibuktikan benchmark.

Namun dalam hampir semua sistem enterprise modern, `TextMessage` atau `BytesMessage` lebih baik.

### 9.5 Heuristik

Default: hindari `StreamMessage` untuk domain event/command jangka panjang.

Gunakan hanya jika:

- format positional memang requirement,
- producer/consumer locked-step,
- schema tidak berubah,
- ada alasan performa yang terbukti,
- debugging tooling tersedia.

---

## 10. Message Body vs JMS Properties: Batas yang Harus Dijaga

Bagian ini sangat penting karena banyak desain JMS rusak bukan karena salah memilih type, tetapi karena salah memisahkan body dan properties.

### 10.1 JMS Properties untuk Apa?

Properties cocok untuk:

- routing,
- filtering selector,
- classification,
- correlation support,
- observability,
- lightweight metadata,
- version hint,
- tenant hint,
- trace propagation.

Contoh:

```text
messageType = CaseSubmitted
messageVersion = 3
tenantId = CEA
caseId = CASE-2026-000001
correlationId = corr-0001
contentType = application/json
schemaName = case.submitted
schemaVersion = 3
```

### 10.2 Body untuk Apa?

Body cocok untuk:

- business payload,
- domain event document,
- command input,
- full semantic data,
- replayable information,
- audit-relevant details.

Contoh body:

```json
{
  "caseId": "CASE-2026-000001",
  "submittedBy": "user-123",
  "submittedAt": "2026-06-18T10:15:30Z",
  "application": {
    "type": "SALESPERSON_REGISTRATION",
    "channel": "INTERNET"
  }
}
```

### 10.3 Rule of Thumb

```text
If broker/consumer must decide whether to receive/process quickly -> property.
If business handler needs it to execute domain logic -> body.
If operator needs it for search/filter -> property summary + body source of truth.
If it changes frequently and structurally -> body.
If it is routing metadata and low cardinality -> property.
```

### 10.4 Anti-Pattern: Property Explosion

Buruk:

```text
Properties:
  applicantName
  applicantPhone
  applicantEmail
  applicantAddress1
  applicantAddress2
  document1Type
  document1File
  document2Type
  document2File
  decisionReason1
  decisionReason2
  decisionReason3
```

Ini membuat broker menjadi object store dan selector engine semu.

### 10.5 Anti-Pattern: Body Opaque Tanpa Properties

Juga buruk:

```text
Properties:
  <none>
Body:
  encrypted bytes with no metadata
```

Consumer dan operator tidak tahu:

- format apa,
- schema apa,
- version berapa,
- type apa,
- decode bagaimana,
- owner siapa.

---

## 11. Payload Size: Broker Bukan Object Storage

Message type apapun bisa disalahgunakan untuk payload besar.

### 11.1 Problem Payload Besar

Payload besar berdampak pada:

- producer memory,
- network transfer,
- broker heap/native memory,
- broker journal/write amplification,
- replication cost,
- paging,
- consumer prefetch memory,
- DLQ storage,
- replay speed,
- backup/restore,
- monitoring UI,
- GC pressure.

### 11.2 Claim Check Pattern

Jika payload besar, gunakan claim check:

```text
Message body:
{
  "documentId": "doc-2026-000001",
  "storageRef": "s3://bucket/path/object",
  "sha256": "...",
  "sizeBytes": 18499231,
  "contentType": "application/pdf"
}
```

Payload aktual disimpan di object storage/document storage. JMS message hanya membawa reference + metadata integrity.

### 11.3 Kapan Claim Check Cocok?

- file besar,
- attachment,
- report PDF,
- document archive,
- payload > operational threshold,
- payload perlu lifecycle sendiri,
- payload perlu access control sendiri.

### 11.4 Risiko Claim Check

Claim check bukan gratis. Harus desain:

- object retention,
- deletion policy,
- access control,
- checksum validation,
- transactional consistency,
- cleanup orphan object,
- replay setelah object expired,
- audit chain.

### 11.5 Heuristik Ukuran

Tidak ada angka universal karena broker/provider berbeda. Tapi rule konseptual:

- message kecil: ideal,
- message sedang: acceptable dengan tuning,
- message besar: evaluasi claim check,
- message sangat besar: hampir pasti salah pakai broker.

Dalam review desain, selalu tanyakan:

```text
Apa payload p50/p95/p99 size?
Apa max size?
Apa yang terjadi jika 10.000 message max-size masuk DLQ?
Apa consumer prefetch x payload size masih muat memory?
Apa broker journal dan replication sanggup?
Apa replay tooling sanggup?
```

---

## 12. Serialization Strategy: Dari Java Object ke Contract Document

### 12.1 Tiga Level Serialization

#### Level 1 — Native Java Serialization

```text
ObjectMessage(Java Serializable)
```

Cepat untuk coding, buruk untuk contract.

#### Level 2 — Text Document Serialization

```text
TextMessage(JSON/XML)
```

Lebih baik untuk readability, portability, evolution.

#### Level 3 — Binary Schema Serialization

```text
BytesMessage(Protobuf/Avro/CBOR)
```

Lebih baik untuk compactness/performance, tetapi butuh tooling dan schema governance.

### 12.2 Decision Matrix

| Requirement | Recommended |
|---|---|
| Human-readable DLQ | `TextMessage` |
| Cross-language | `TextMessage` atau `BytesMessage` dengan open schema |
| High throughput compact payload | `BytesMessage` |
| Enterprise XML contract | `TextMessage` XML |
| Legacy Java-only closed system | Mungkin `ObjectMessage`, tapi hati-hati |
| Simple signal | `Message` |
| Flat metrics/control map | `MapMessage` |
| Long-lived domain event | `TextMessage` JSON/XML atau `BytesMessage` Protobuf/Avro |
| Sensitive encrypted payload | `BytesMessage` |
| Large file transfer | Claim check, bukan body besar |

---

## 13. Schema Evolution per Message Type

### 13.1 `TextMessage` JSON Evolution

Recommended rules:

- tambah field baru sebagai optional,
- jangan rename field tanpa versioning,
- jangan ubah meaning field,
- jangan ubah type field diam-diam,
- consumer harus ignore unknown fields,
- producer jangan langsung menghapus field lama,
- gunakan `messageVersion`,
- gunakan contract test.

Contoh v1:

```json
{
  "messageType": "CaseSubmitted",
  "messageVersion": 1,
  "payload": {
    "caseId": "CASE-1",
    "submittedBy": "user-1"
  }
}
```

v2 additive compatible:

```json
{
  "messageType": "CaseSubmitted",
  "messageVersion": 2,
  "payload": {
    "caseId": "CASE-1",
    "submittedBy": "user-1",
    "submissionChannel": "INTERNET"
  }
}
```

v2 breaking:

```json
{
  "messageType": "CaseSubmitted",
  "messageVersion": 2,
  "payload": {
    "caseReference": "CASE-1",
    "actor": {
      "id": "user-1"
    }
  }
}
```

Breaking change perlu topic/queue version baru atau consumer migration strategy.

### 13.2 `BytesMessage` Protobuf Evolution

Protobuf punya compatibility rules, misalnya field number tidak boleh digunakan ulang sembarangan. JMS tidak menyelesaikan ini; schema discipline tetap di luar JMS.

Properties tetap berguna:

```text
schemaFormat = protobuf
schemaName = case.CaseSubmitted
schemaVersion = 2
```

### 13.3 `MapMessage` Evolution

MapMessage evolution manual:

- field baru boleh ditambah jika consumer lama tidak peduli,
- field wajib lama jangan dihapus cepat,
- type field jangan berubah,
- nested/array sulit,
- default value harus jelas.

### 13.4 `ObjectMessage` Evolution

ObjectMessage evolution paling rapuh:

- classpath harus compatible,
- `serialVersionUID` harus dikelola,
- semantic evolution sulit,
- package rename berbahaya,
- replay message lama bisa gagal.

### 13.5 `StreamMessage` Evolution

StreamMessage evolution juga rapuh:

- urutan field adalah kontrak,
- menambah field di tengah breaking,
- consumer harus tahu versi sebelum membaca urutan,
- sulit self-describing.

---

## 14. Security Analysis per Message Type

### 14.1 `TextMessage`

Risiko:

- injection ke downstream parser,
- XML external entity jika XML parser tidak aman,
- log injection,
- PII leakage dalam DLQ/log,
- schema bypass,
- oversized JSON/XML attack.

Mitigasi:

- validate schema,
- set parser securely,
- limit payload size,
- redact logs,
- classify sensitive fields,
- use content type and version,
- avoid logging full payload in production.

### 14.2 `BytesMessage`

Risiko:

- opaque malicious binary,
- decompression bomb,
- parser vulnerability,
- encryption metadata misuse,
- missing integrity check,
- DLQ unreadable.

Mitigasi:

- strict decoder,
- payload size limit before decompress,
- compression ratio guard,
- authenticated encryption,
- schema validation,
- decode tooling for operators.

### 14.3 `MapMessage`

Risiko:

- property/field confusion,
- unexpected type conversion,
- missing required field,
- weak validation.

Mitigasi:

- explicit validator,
- strict required fields,
- type checks,
- version property.

### 14.4 `ObjectMessage`

Risiko paling besar:

- unsafe deserialization,
- classpath gadget,
- producer spoofing,
- class compatibility failure,
- opaque DLQ.

Mitigasi minimum jika terpaksa:

- trusted producer only,
- broker allowlist/trusted packages,
- separate network/security boundary,
- no external input,
- class versioning policy,
- deserialization filter where applicable,
- prefer replacement with JSON/Protobuf.

### 14.5 `StreamMessage`

Risiko:

- malformed sequence,
- type mismatch,
- parser state confusion,
- version mismatch.

Mitigasi:

- leading version field,
- strict reader,
- length/field count discipline,
- prefer self-describing format.

---

## 15. Performance Model per Message Type

Performance tidak hanya ditentukan oleh message type. Faktor besar:

- payload size,
- delivery mode persistent/non-persistent,
- transaction,
- broker journal,
- network latency,
- consumer prefetch,
- serialization library,
- compression,
- database side effect,
- concurrency model.

Tetapi message type tetap punya karakter.

| Type | CPU Producer | CPU Consumer | Size | Debuggability | Compatibility |
|---|---:|---:|---:|---:|---:|
| `Message` | Low | Low | Tiny | Medium | High jika semantics sederhana |
| `TextMessage` JSON | Medium | Medium | Medium | High | High |
| `TextMessage` XML | Medium/High | Medium/High | Large | High | High di enterprise |
| `BytesMessage` Protobuf | Low/Medium | Low/Medium | Small | Low | High jika schema shared |
| `BytesMessage` compressed | High | High | Small | Low | Medium |
| `MapMessage` | Low/Medium | Low/Medium | Medium | Medium | Medium |
| `ObjectMessage` | Medium | Medium/High | Variable | Low | Low |
| `StreamMessage` | Low | Low | Medium | Low | Low/Medium |

### 15.1 Jangan Menebak Performance

Contoh asumsi yang sering salah:

> “Bytes pasti lebih cepat dari JSON.”

Belum tentu, karena:

- bottleneck mungkin DB,
- message kecil sehingga parse cost kecil,
- persistent fsync mendominasi,
- network mendominasi,
- compression malah menambah CPU,
- consumer concurrency lebih penting.

Top 1% engineer melakukan benchmark dengan workload realistis:

```text
payload size p50/p95/p99
producer concurrency
consumer concurrency
persistent delivery
transaction on/off
broker storage type
DLQ/redelivery scenario
DB side effect included/excluded
```

---

## 16. Java 8 sampai Java 25: Implikasi Praktis

### 16.1 Java 8

Java 8 sering berada di sistem JMS legacy:

- JMS 1.1 / JMS 2.0 `javax.jms`,
- application server lama,
- ActiveMQ Classic / IBM MQ / WebLogic / JBoss legacy,
- Java serialization masih sering ditemukan,
- belum ada records/text blocks.

Rekomendasi:

- tetap bisa gunakan `TextMessage` JSON/XML,
- hindari `ObjectMessage`,
- gunakan POJO DTO biasa,
- gunakan explicit serializer,
- jaga backward compatibility.

### 16.2 Java 11/17

Java 11/17 umum untuk modern enterprise:

- migration ke Jakarta mulai muncul,
- modular runtime mulai relevan,
- TLS/security lebih modern,
- records mulai tersedia sejak Java 16 final,
- sealed class sejak Java 17 dapat membantu model event internal.

Tapi ingat: record Java bagus sebagai model internal, bukan berarti harus dikirim sebagai `ObjectMessage`.

Gunakan:

```java
public record CaseSubmittedPayload(String caseId, String submittedBy) {}
```

Lalu serialize ke JSON/Protobuf, bukan Java serialization.

### 16.3 Java 21/25

Java 21 dan 25 membawa runtime modern, virtual threads, GC improvements, language improvements. Namun JMS client dan listener model tetap harus mengikuti thread-safety rules provider.

Jangan otomatis membuat satu virtual thread per message jika:

- session tidak thread-safe,
- consumer dispatch model dikelola provider,
- transaction context thread-bound,
- listener container sudah mengelola concurrency,
- broker backpressure tidak align.

Message type decision tetap sama:

- durable enterprise contract: `TextMessage`/`BytesMessage`,
- internal signal: `Message`,
- avoid `ObjectMessage`.

---

## 17. Design Patterns Berdasarkan Message Type

### 17.1 Document Event Pattern

Gunakan `TextMessage` JSON/XML.

```text
Destination: topic.case.events
Type: TextMessage
Properties:
  messageType = CaseSubmitted
  messageVersion = 2
  caseId = CASE-2026-001
Body:
  full event envelope JSON/XML
```

Cocok untuk:

- domain event,
- integration event,
- audit-friendly events,
- cross-service notification.

### 17.2 Binary Contract Pattern

Gunakan `BytesMessage` Protobuf/Avro.

```text
Destination: queue.case.indexing
Type: BytesMessage
Properties:
  schemaFormat = protobuf
  schemaName = case.IndexDocumentCommand
  schemaVersion = 5
Body:
  protobuf bytes
```

Cocok untuk:

- high-throughput internal pipeline,
- compact event stream,
- schema registry environment.

### 17.3 Signal Message Pattern

Gunakan generic `Message`.

```text
Destination: queue.cache.invalidate
Type: Message
Properties:
  commandType = INVALIDATE_CASE_CACHE
  caseId = CASE-2026-001
```

Cocok untuk:

- refresh,
- wake-up,
- invalidation,
- trigger.

### 17.4 Claim Check Pattern

Gunakan `TextMessage` atau `BytesMessage` kecil berisi reference.

```json
{
  "messageType": "DocumentUploaded",
  "documentId": "DOC-001",
  "storageRef": "s3://bucket/object",
  "sha256": "...",
  "sizeBytes": 10485760
}
```

Cocok untuk:

- dokumen besar,
- attachment,
- payload binary besar.

### 17.5 Avoid Java Object Contract Pattern

Hindari:

```text
ObjectMessage(com.company.SomeEvent)
```

Ganti dengan:

```text
TextMessage(JSON envelope)
```

atau:

```text
BytesMessage(Protobuf envelope)
```

---

## 18. Code Blueprint: Unified Message Envelope dengan `TextMessage`

Contoh tanpa external library agar konsep jelas. Di production, gunakan Jackson/JSON-B sesuai stack.

### 18.1 Envelope Model Modern Java

```java
public record MessageEnvelope<T>(
        String messageId,
        String messageType,
        int messageVersion,
        String correlationId,
        String causationId,
        String occurredAt,
        String producerService,
        T payload
) {
}

public record CaseSubmittedPayload(
        String caseId,
        String submittedBy,
        String submissionChannel
) {
}
```

### 18.2 Publisher Shape

```java
import jakarta.jms.ConnectionFactory;
import jakarta.jms.Destination;
import jakarta.jms.JMSContext;
import jakarta.jms.TextMessage;

public final class EnvelopePublisher {
    public void publishCaseSubmitted(
            ConnectionFactory connectionFactory,
            Destination destination,
            String jsonEnvelope,
            String messageId,
            String correlationId,
            String caseId
    ) {
        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            TextMessage message = context.createTextMessage(jsonEnvelope);
            message.setStringProperty("messageId", messageId);
            message.setStringProperty("messageType", "CaseSubmitted");
            message.setIntProperty("messageVersion", 1);
            message.setStringProperty("correlationId", correlationId);
            message.setStringProperty("caseId", caseId);
            message.setStringProperty("contentType", "application/json");
            message.setStringProperty("schemaName", "case.submitted");
            message.setIntProperty("schemaVersion", 1);

            context.createProducer().send(destination, message);
        }
    }
}
```

### 18.3 Consumer Shape

```java
import jakarta.jms.Message;
import jakarta.jms.TextMessage;

public final class EnvelopeConsumer {
    public void handle(Message message) throws Exception {
        if (!(message instanceof TextMessage textMessage)) {
            throw new IllegalArgumentException("Expected TextMessage, got " + message.getClass().getName());
        }

        String messageType = message.getStringProperty("messageType");
        int messageVersion = message.getIntProperty("messageVersion");
        String correlationId = message.getStringProperty("correlationId");
        String body = textMessage.getText();

        if (!"CaseSubmitted".equals(messageType)) {
            throw new IllegalArgumentException("Unsupported messageType: " + messageType);
        }

        if (messageVersion < 1 || messageVersion > 2) {
            throw new IllegalArgumentException("Unsupported messageVersion: " + messageVersion);
        }

        // Parse JSON, validate schema, map to command/event DTO, process idempotently.
        process(body, correlationId);
    }

    private void process(String body, String correlationId) {
        // domain processing
    }
}
```

Untuk Java 8, pattern matching `instanceof` belum tersedia:

```java
if (!(message instanceof TextMessage)) {
    throw new IllegalArgumentException("Expected TextMessage");
}
TextMessage textMessage = (TextMessage) message;
```

---

## 19. Code Blueprint: Safe `BytesMessage` Reader

Kesalahan umum `BytesMessage` adalah membaca tanpa limit.

Buruk:

```java
byte[] bytes = new byte[(int) bytesMessage.getBodyLength()];
bytesMessage.readBytes(bytes);
```

Jika payload terlalu besar, memory bisa meledak.

Lebih baik:

```java
import jakarta.jms.BytesMessage;
import jakarta.jms.Message;

public final class SafeBytesReader {
    private static final long MAX_MESSAGE_BYTES = 1024 * 1024; // 1 MiB example threshold

    public byte[] readBody(Message message) throws Exception {
        if (!(message instanceof BytesMessage bytesMessage)) {
            throw new IllegalArgumentException("Expected BytesMessage");
        }

        long bodyLength = bytesMessage.getBodyLength();
        if (bodyLength < 0) {
            throw new IllegalArgumentException("Invalid body length: " + bodyLength);
        }
        if (bodyLength > MAX_MESSAGE_BYTES) {
            throw new IllegalArgumentException("Message too large: " + bodyLength);
        }

        byte[] bytes = new byte[(int) bodyLength];
        int totalRead = 0;

        while (totalRead < bytes.length) {
            int read = bytesMessage.readBytes(bytes, bytes.length - totalRead);
            if (read == -1) {
                break;
            }
            totalRead += read;
        }

        if (totalRead != bytes.length) {
            throw new IllegalStateException("Expected " + bytes.length + " bytes but read " + totalRead);
        }

        return bytes;
    }
}
```

Catatan: implementasi provider bisa punya detail behavior. Selalu baca API provider yang dipakai dan test dengan broker nyata.

---

## 20. Decision Framework: Memilih Message Type

Gunakan pertanyaan berurutan berikut.

### 20.1 Apakah Message Butuh Body?

Jika tidak:

```text
Use Message
```

Contoh: heartbeat, trigger, cache invalidation.

### 20.2 Apakah Payload Textual dan Butuh Human Readability?

Jika ya:

```text
Use TextMessage with JSON/XML
```

### 20.3 Apakah Payload Binary / Encoded / Encrypted / Compressed?

Jika ya:

```text
Use BytesMessage with explicit content metadata
```

### 20.4 Apakah Payload Flat dan Internal JMS-only?

Jika ya, `MapMessage` boleh dipertimbangkan. Tapi untuk domain contract jangka panjang, tetap lebih baik JSON/XML.

### 20.5 Apakah Ada yang Mengusulkan `ObjectMessage`?

Tanyakan:

```text
Apakah pesan ini durable?
Apakah bisa masuk DLQ?
Apakah perlu replay setelah deploy versi baru?
Apakah semua consumer Java dengan classpath sama?
Apakah deserialization boundary aman?
Apakah ada consumer non-Java?
Apakah package/class akan tetap stabil bertahun-tahun?
```

Jika ada satu saja jawaban bermasalah, jangan pakai `ObjectMessage`.

### 20.6 Apakah Ada yang Mengusulkan `StreamMessage`?

Tanyakan:

```text
Mengapa positional stream lebih baik daripada JSON/Protobuf?
Bagaimana schema evolution?
Bagaimana operator debug DLQ?
Bagaimana consumer tahu versi sebelum membaca urutan?
```

Jika tidak ada jawaban kuat, jangan pakai `StreamMessage`.

---

## 21. Applied Scenario: Regulated Case Management Platform

Bayangkan sistem case management regulatory.

Ada event:

```text
CaseSubmitted
CaseAssigned
CaseEscalated
CaseDecisionIssued
CaseAppealSubmitted
DocumentUploaded
SlaBreached
EnforcementActionCreated
```

### 21.1 Pilihan yang Baik

Untuk event domain:

```text
TextMessage JSON envelope
```

Alasan:

- audit-friendly,
- DLQ readable,
- replayable,
- cross-service friendly,
- schema evolution feasible,
- mudah dihubungkan dengan trace/correlation.

Untuk document uploaded:

```text
TextMessage JSON claim check
```

Body:

```json
{
  "messageType": "DocumentUploaded",
  "messageVersion": 1,
  "payload": {
    "caseId": "CASE-2026-000001",
    "documentId": "DOC-2026-000099",
    "storageRef": "s3://case-documents/2026/000099.pdf",
    "sha256": "...",
    "sizeBytes": 2097152,
    "contentType": "application/pdf"
  }
}
```

Untuk indexing pipeline high throughput:

```text
BytesMessage Protobuf
```

Jika team punya tooling schema dan decoder.

Untuk heartbeat worker:

```text
Message without body
```

Properties:

```text
component = case-assignment-worker
status = alive
observedAtEpochMillis = ...
```

### 21.2 Pilihan yang Buruk

Buruk:

```text
ObjectMessage(CaseSubmittedEvent)
```

Karena:

- case event perlu audit,
- event durable,
- replay penting,
- class Java bisa berubah,
- deserialization risk,
- operator sulit inspect.

Buruk:

```text
BytesMessage(encrypted bytes)
```

Jika tanpa:

- key id,
- content type,
- schema version,
- decode tooling,
- DLQ procedure.

Buruk:

```text
MapMessage with 70 applicant fields
```

Karena kontrak domain kompleks dipaksa flat.

---

## 22. Failure Modes Berdasarkan Message Type

### 22.1 `TextMessage`

| Failure | Penyebab | Mitigasi |
|---|---|---|
| JSON parse error | producer bug / version mismatch | schema validation, contract test |
| Unknown field ignored incorrectly | consumer strict parser | configure ignore unknown atau version handling |
| Missing field | breaking change | required field validation |
| XML parser vulnerability | unsafe XML parser | disable external entities |
| Payload too large | misuse message as file transfer | claim check |
| PII leaked in logs | log full body | redaction policy |

### 22.2 `BytesMessage`

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Cannot decode | missing schema/version | schema metadata |
| OOM while reading | no size guard | max payload size |
| Decompression bomb | unbounded decompress | compression ratio limit |
| DLQ unreadable | no decode tooling | operational decoder |
| Wrong encoding | metadata missing/wrong | content type/encoding validation |

### 22.3 `MapMessage`

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Missing map key | producer/consumer mismatch | required field validator |
| Wrong type | field changed | versioning, type checks |
| Flat structure collapse | domain grew complex | migrate to JSON/XML |

### 22.4 `ObjectMessage`

| Failure | Penyebab | Mitigasi |
|---|---|---|
| ClassNotFoundException | consumer lacks class | avoid ObjectMessage |
| InvalidClassException | serialVersionUID mismatch | avoid / strict versioning |
| Deserialization exploit | unsafe object graph | avoid / allowlist / filters |
| DLQ cannot inspect | opaque binary Java object | use text/binary schema format |
| Replay fails after deploy | class changed | use stable contract document |

### 22.5 `StreamMessage`

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Field read mismatch | order changed | version first / avoid |
| Type mismatch | producer changed type | strict compatibility |
| Hard to debug | positional opaque fields | use self-describing format |

---

## 23. Review Checklist untuk Pull Request JMS Message Type

Gunakan checklist ini saat review code.

### 23.1 General

- [ ] Message type dipilih dengan alasan eksplisit.
- [ ] Payload size punya batas.
- [ ] Message punya `messageType`.
- [ ] Message punya `messageVersion` atau schema version.
- [ ] Correlation id tersedia.
- [ ] Message dapat di-debug saat masuk DLQ.
- [ ] Replay scenario dipikirkan.
- [ ] Consumer lama terhadap message baru dipikirkan.
- [ ] Message baru terhadap consumer lama dipikirkan.
- [ ] Sensitive data/logging dipikirkan.

### 23.2 Untuk `TextMessage`

- [ ] `contentType` jelas: `application/json` atau `application/xml`.
- [ ] Schema validation tersedia atau direncanakan.
- [ ] Unknown fields strategy jelas.
- [ ] Required fields strategy jelas.
- [ ] Parser secure.
- [ ] Payload tidak terlalu besar.

### 23.3 Untuk `BytesMessage`

- [ ] `contentType` jelas.
- [ ] `contentEncoding` jelas.
- [ ] Schema name/version/fingerprint jelas.
- [ ] Max body size diterapkan.
- [ ] Decoder error masuk failure handling yang benar.
- [ ] DLQ decoder/tooling tersedia.

### 23.4 Untuk `MapMessage`

- [ ] Field flat dan kecil.
- [ ] Tidak dipakai untuk object domain kompleks.
- [ ] Required field validator ada.
- [ ] Type change policy jelas.

### 23.5 Untuk `ObjectMessage`

- [ ] Ada justifikasi kuat mengapa bukan JSON/Protobuf.
- [ ] Producer/consumer trusted.
- [ ] Classpath compatibility dikontrol.
- [ ] Deserialization allowlist/filter diterapkan.
- [ ] Replay setelah upgrade diuji.
- [ ] DLQ inspect tooling tersedia.

Jika checklist ini tidak bisa dipenuhi, tolak desain `ObjectMessage`.

### 23.6 Untuk `StreamMessage`

- [ ] Urutan field terdokumentasi.
- [ ] Version field dibaca paling awal.
- [ ] Evolution strategy jelas.
- [ ] Debug tooling tersedia.

---

## 24. Anti-Pattern Catalog

### 24.1 `ObjectMessage` sebagai DTO Sharing Antar Microservice

```text
service-a sends ObjectMessage(com.company.shared.CaseEvent)
service-b consumes same shared jar
```

Masalah:

- shared library coupling,
- deployment lockstep,
- class evolution fragility,
- non-Java impossible,
- deserialization risk.

Lebih baik:

```text
TextMessage(JSON envelope) or BytesMessage(Protobuf)
```

### 24.2 Menaruh Semua Data di Properties

Masalah:

- selector abuse,
- property explosion,
- poor schema,
- broker metadata pollution.

Lebih baik:

```text
Properties = searchable/routable summary
Body = full contract
```

### 24.3 Mengirim File Besar sebagai BytesMessage

Masalah:

- broker storage pressure,
- DLQ explosion,
- memory pressure,
- slow replay.

Lebih baik:

```text
Claim check with object storage reference
```

### 24.4 TextMessage Tanpa Version

Masalah:

- consumer tidak tahu format,
- migration sulit,
- debugging sulit.

Lebih baik:

```text
messageType + messageVersion + schemaName + schemaVersion
```

### 24.5 BytesMessage Tanpa Decode Metadata

Masalah:

- opaque blob,
- operator helpless,
- consumer mismatch.

Lebih baik:

```text
contentType + contentEncoding + schema metadata
```

### 24.6 StreamMessage untuk Domain Event

Masalah:

- positional schema fragile,
- evolution buruk.

Lebih baik:

```text
Self-describing document or schema-based binary
```

---

## 25. Latihan Engineering

### Latihan 1 — Pilih Message Type

Untuk setiap kasus, pilih message type dan jelaskan alasannya:

1. `CaseSubmitted` event untuk 12 consumer internal dan 2 consumer eksternal.
2. `GenerateMonthlyReport` command dengan parameter kecil.
3. Upload PDF 20 MB dari portal publik.
4. Worker heartbeat setiap 30 detik.
5. Indexing document payload 3 KB, 20.000 message/menit.
6. Legacy Java monolith mengirim job internal ke worker versi sama.
7. Encrypted sensitive investigation payload.

Jawaban yang diharapkan secara umum:

1. `TextMessage` JSON/XML envelope.
2. `TextMessage` atau `Message` + properties jika parameter sangat kecil; lebih aman `TextMessage` command envelope.
3. Claim check; message hanya reference.
4. `Message` tanpa body.
5. `BytesMessage` Protobuf/Avro jika tooling matang; kalau tidak, benchmark `TextMessage` JSON.
6. Mungkin `ObjectMessage`, tapi tetap pertimbangkan JSON karena future-proof.
7. `BytesMessage` dengan encryption metadata dan strict key management.

### Latihan 2 — ObjectMessage Review

Team mengusulkan:

```java
ObjectMessage message = session.createObjectMessage(new CaseDecisionIssuedEvent(...));
```

Pertanyaan review:

- Apakah message durable?
- Apakah bisa masuk DLQ?
- Apakah replay setelah 6 bulan wajib?
- Apakah class event akan berubah?
- Apakah consumer deploy lockstep?
- Apakah ada deserialization allowlist?
- Apakah operator bisa inspect payload?
- Apakah ada consumer non-Java sekarang atau nanti?

Jika sistem regulatory case management, jawaban biasanya mengarah ke: jangan pakai `ObjectMessage`.

### Latihan 3 — Properties vs Body

Diberikan event:

```json
{
  "caseId": "CASE-1",
  "applicant": {
    "name": "Alice",
    "address": {
      "postalCode": "123456"
    }
  },
  "submittedBy": "user-1"
}
```

Tentukan mana yang masuk properties:

Kemungkinan:

```text
Properties:
  messageType = CaseSubmitted
  messageVersion = 1
  caseId = CASE-1
  tenantId = CEA
  correlationId = corr-1
  contentType = application/json

Body:
  full JSON event
```

Jangan taruh seluruh applicant di properties kecuali ada routing/filtering requirement kuat.

---

## 26. Ringkasan Mental Model

1. JMS message type adalah keputusan kontrak, bukan sekadar API call.
2. `Message` tanpa body cocok untuk signal kecil.
3. `TextMessage` adalah default kuat untuk enterprise document/event berbasis JSON/XML.
4. `BytesMessage` cocok untuk binary schema, compression, encryption, dan high-performance payload dengan metadata eksplisit.
5. `MapMessage` cocok untuk flat internal data, tetapi bukan pilihan ideal untuk kontrak domain kompleks.
6. `ObjectMessage` nyaman tetapi berbahaya: class coupling, deserialization risk, portability rendah, replay rapuh.
7. `StreamMessage` jarang cocok untuk sistem modern karena positional schema sulit berevolusi.
8. Properties adalah metadata/routing/filtering, bukan tempat utama business payload.
9. Broker bukan object storage; payload besar sebaiknya pakai claim check.
10. Long-lived integration contract harus readable/evolvable/secure/replayable.

---

## 27. Top 1% Heuristics

Pegang heuristik ini saat mendesain JMS message body:

```text
Choose TextMessage when humans, audit, replay, and interoperability matter.
Choose BytesMessage when binary efficiency matters and schema governance exists.
Choose Message when the message is only a signal.
Choose MapMessage only for small flat internal payloads.
Avoid ObjectMessage unless the system is closed, trusted, short-lived, and version-locked.
Avoid StreamMessage unless positional encoding is a proven requirement.
```

Heuristik desain kontrak:

```text
A message must outlive the code that produced it.
A message in DLQ must still be understandable.
A replayed message must not require historical classpath archaeology.
A binary message must declare how to decode itself.
A text message must declare what it means.
A large payload must be referenced, not carried blindly.
```

Heuristik production:

```text
If operators cannot inspect or classify failed messages, your message format is not production-ready.
If consumers cannot tolerate additive change, your schema is too brittle.
If message replay after deployment is unsafe, your contract is not stable.
If you use ObjectMessage across service boundaries, you probably encoded deployment coupling into your data plane.
```

---

## 28. Koneksi ke Part Berikutnya

Part ini menjawab: “Body message sebaiknya berbentuk apa?”

Part berikutnya akan membahas sisi producer:

- bagaimana message dikirim,
- persistent vs non-persistent delivery,
- TTL,
- priority,
- delivery delay,
- async send,
- producer lifecycle,
- transaction participation,
- batching,
- failure setelah send,
- dan bagaimana producer design mempengaruhi reliability end-to-end.

Dengan kata lain:

```text
Part 6: Apa bentuk pesan?
Part 7: Bagaimana pesan dikirim dengan benar?
```

---

## 29. Status Seri

Seri belum selesai.

Progress saat ini:

- Selesai: Part 0 sampai Part 6
- Berikutnya: Part 7 — Producer Engineering: Send Path, Delivery Mode, Priority, TTL, Delay, Async Send
- Total rencana: 35 part

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-005.md">⬅️ Part 5 — Message Anatomy: Header, Properties, Body, Metadata, Correlation, dan Semantic Contract</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-007.md">Part 7 — Producer Engineering: Send Path, Delivery Mode, Priority, TTL, Delay, Async Send ➡️</a>
</div>
