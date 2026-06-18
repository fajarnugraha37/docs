# learn-java-json-xml-soap-connectors-enterprise-integration — Part 28  
# WS-* Interoperability Field Guide

> Seri: Java JSON, XML, SOAP Legacy, dan Jakarta Connectors  
> Bagian: 28 dari 34  
> Target: Java 8 sampai Java 25  
> Fokus: memahami keluarga standar WS-* sebagai lapisan interoperabilitas SOAP: WS-Addressing, WS-Security, WS-Policy, WS-ReliableMessaging, dan cara membedakan standar, profile, vendor behavior, serta risiko production.

---

## 0. Kenapa Bagian Ini Penting?

Setelah memahami SOAP, WSDL, JAX-WS client/server, fault handling, dan attachment/MTOM, kita sampai pada area yang biasanya paling membingungkan dalam integrasi enterprise lama: **WS-\***.

Banyak engineer mengenal SOAP sebagai:

```text
HTTP POST + XML envelope
```

Tetapi di enterprise system, terutama sistem government, banking, insurance, telco, ERP, procurement, e-invoicing, identity federation, document exchange, dan legacy B2B, SOAP sering tidak berhenti di envelope dasar. SOAP message bisa membawa:

- addressing metadata,
- message id,
- action,
- reply endpoint,
- fault endpoint,
- security token,
- timestamp,
- signature,
- encrypted payload,
- policy assertion,
- reliable messaging sequence,
- acknowledgement,
- must-understand headers,
- attachment optimization,
- dan vendor-specific extension.

Keluarga spesifikasi itu sering disebut **WS-\***.

Masalahnya, WS-* bukan satu standar tunggal. Ia adalah kumpulan spesifikasi yang sebagian dikelola W3C, sebagian OASIS, sebagian WS-I profile, sebagian vendor convention, dan sebagian implementasi framework seperti Metro, CXF, WebLogic, WebSphere, JBoss/WildFly, .NET WCF, SAP, Oracle SOA, IBM Integration Bus, dan ESB lama.

Mental model bagian ini:

```text
SOAP Envelope
  ├── Body
  │   └── business payload
  └── Header
      ├── WS-Addressing       -> message routing identity
      ├── WS-Security         -> message-level trust
      ├── WS-Policy           -> machine-readable requirements/capabilities
      ├── WS-ReliableMessaging-> delivery assurance protocol
      ├── WS-AtomicTransaction-> distributed transaction coordination
      └── vendor extensions   -> practical interoperability traps
```

Tujuan kita bukan menghafal semua WS-* spec. Tujuan kita adalah bisa membaca SOAP integration dengan tajam:

1. Header apa yang menentukan perilaku runtime?
2. Mana yang bagian kontrak resmi dan mana yang vendor-specific?
3. Mana yang boleh diubah tanpa breaking consumer?
4. Mana yang harus dites lintas stack?
5. Mana yang menimbulkan risiko security, retry, duplicate, latency, atau operational outage?

---

## 1. Peta Besar WS-* Family

Secara praktis, WS-* dapat dikelompokkan menjadi beberapa kategori.

| Kategori | Contoh Spec | Pertanyaan yang Dijawab |
|---|---|---|
| Addressing/routing | WS-Addressing | Message ini untuk operation apa? Reply/fault harus ke mana? Message id-nya apa? |
| Security | WS-Security, UsernameToken, X.509 Token Profile, SAML Token Profile | Siapa pengirimnya? Payload berubah tidak? Rahasia tidak? Token valid tidak? |
| Policy | WS-Policy, WS-SecurityPolicy | Requirement service apa? Butuh signature? Encryption? MTOM? Reliable messaging? |
| Reliability | WS-ReliableMessaging | Bagaimana menjamin message terkirim, urut, dan diketahui statusnya? |
| Transactions | WS-AtomicTransaction, WS-Coordination | Bisakah distributed transaction antar service dikoordinasi? |
| Metadata | WS-MetadataExchange, WS-Transfer | Bagaimana mendapatkan metadata/policy dari endpoint? |
| Attachments/optimization | MTOM, XOP, SwA | Bagaimana binary data dikirim efisien dalam SOAP? |
| Interoperability profile | WS-I Basic Profile, Basic Security Profile | Subset aturan agar vendor A dan B tidak saling salah tafsir. |

Yang perlu diwaspadai: tidak semua sistem menggunakan semua kategori. Banyak sistem hanya memakai:

```text
WSDL + SOAP 1.1 + document/literal + WS-Security UsernameToken
```

atau:

```text
WSDL + SOAP 1.2 + WS-Addressing + X.509 signature
```

atau:

```text
WSDL + MTOM + WS-Security + proprietary gateway policy
```

Karena itu, membaca WSDL saja tidak selalu cukup. Kita perlu membaca:

- WSDL,
- imported XSD,
- policy attachment,
- sample request/response,
- endpoint gateway documentation,
- certificate/token requirement,
- error/fault catalogue,
- dan runtime logs dari kedua sisi.

---

## 2. Prinsip Utama: WS-* Hidup di SOAP Header

SOAP body biasanya berisi business operation:

```xml
<soap:Body>
  <ns:SubmitApplicationRequest>
    ...
  </ns:SubmitApplicationRequest>
</soap:Body>
```

WS-* biasanya hidup di header:

```xml
<soap:Header>
  <wsa:Action>...</wsa:Action>
  <wsa:MessageID>...</wsa:MessageID>
  <wsse:Security>...</wsse:Security>
  <wsrm:Sequence>...</wsrm:Sequence>
</soap:Header>
```

Header ini bukan “metadata hiasan”. Dalam SOAP processing model, header bisa bersifat:

```xml
soap:mustUnderstand="1"
```

Artinya receiver **wajib memahami dan memproses** header tersebut. Kalau tidak, receiver harus fault.

Mental model:

```text
Body = apa yang diminta secara bisnis
Header = bagaimana message harus diproses secara protokol
```

Kesalahan umum engineer:

```text
"Saya sudah kirim XML body sesuai XSD, kenapa masih gagal?"
```

Jawabannya sering:

```text
Karena header WS-* tidak sesuai requirement endpoint.
```

Misalnya:

- `wsa:Action` salah.
- `wsa:To` tidak match endpoint.
- `wsse:Timestamp` expired.
- signature reference salah.
- canonicalization berbeda.
- certificate chain tidak dipercaya.
- policy butuh MTOM tapi client mengirim base64 inline.
- sequence id WS-RM tidak dikenal.
- `mustUnderstand` header tidak dikenali stack receiver.

---

## 3. WS-Addressing

### 3.1. Masalah yang Diselesaikan

Tanpa WS-Addressing, SOAP over HTTP sering mengandalkan:

- URL endpoint,
- SOAPAction HTTP header,
- WSDL operation binding,
- dan body root element.

Tetapi untuk message routing yang lebih kompleks, terutama asynchronous reply, intermediaries, gateways, callbacks, dan non-HTTP transport, informasi itu tidak cukup.

WS-Addressing memperkenalkan **message addressing properties** yang transport-neutral. W3C WS-Addressing 1.0 Core mendefinisikan family of message addressing properties untuk membawa karakteristik message end-to-end, termasuk endpoint references, message identity, dan addressing yang tidak bergantung pada transport tertentu.

### 3.2. Header Umum

Contoh sederhana:

```xml
<soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
  <wsa:Action>urn:SubmitApplication</wsa:Action>
  <wsa:MessageID>urn:uuid:0f8fad5b-d9cb-469f-a165-70867728950e</wsa:MessageID>
  <wsa:To>https://partner.example.gov/ws/ApplicationService</wsa:To>
  <wsa:ReplyTo>
    <wsa:Address>http://www.w3.org/2005/08/addressing/anonymous</wsa:Address>
  </wsa:ReplyTo>
</soap:Header>
```

Header penting:

| Header | Makna |
|---|---|
| `wsa:Action` | Semantic action/operation dari message. Sering harus match WSDL binding/policy. |
| `wsa:MessageID` | Unique id untuk message. Berguna untuk correlation, retry, duplicate detection. |
| `wsa:To` | Destination endpoint URI. |
| `wsa:ReplyTo` | Endpoint untuk response. Anonymous biasanya berarti response via HTTP response biasa. |
| `wsa:FaultTo` | Endpoint untuk fault. |
| `wsa:RelatesTo` | Menghubungkan response/fault ke message request. |

### 3.3. SOAPAction vs WS-Addressing Action

Di SOAP 1.1, ada HTTP header:

```http
SOAPAction: "urn:SubmitApplication"
```

WS-Addressing memiliki:

```xml
<wsa:Action>urn:SubmitApplication</wsa:Action>
```

Dalam sistem lama, keduanya bisa:

- sama,
- berbeda tapi dipetakan oleh framework,
- salah satu diwajibkan,
- atau gateway memvalidasi keduanya.

Rule praktis:

```text
Jangan berasumsi SOAPAction tidak penting hanya karena ada wsa:Action.
Jangan berasumsi wsa:Action otomatis sama dengan SOAPAction.
Baca WSDL binding, policy, dan sample message.
```

### 3.4. WS-Addressing Failure Modes

| Failure | Gejala |
|---|---|
| `Action` mismatch | Fault: action not supported, dispatch failure, operation not found. |
| `To` mismatch | Gateway reject, endpoint mismatch, security policy failure. |
| Duplicate `MessageID` | Message ditolak sebagai duplicate atau dianggap retry. |
| Missing `ReplyTo` | Async service gagal menentukan callback/reply mode. |
| Namespace version mismatch | Receiver tidak mengenali header WS-Addressing. |

Namespace sering menjadi jebakan:

```text
WS-Addressing 2004 submission:
http://schemas.xmlsoap.org/ws/2004/08/addressing

WS-Addressing 1.0 W3C:
http://www.w3.org/2005/08/addressing
```

Dua namespace ini tidak boleh dianggap interchangeable.

---

## 4. WS-Security

### 4.1. Masalah yang Diselesaikan

TLS melindungi koneksi transport:

```text
client -> TLS -> server
```

Tetapi enterprise SOAP sering melewati:

- gateway,
- proxy,
- message broker,
- ESB,
- store-and-forward queue,
- intermediaries,
- archival/audit layer,
- async retry pipeline.

Dalam model itu, TLS tidak cukup untuk menjawab:

- apakah message berubah setelah melewati intermediary?
- siapa signer asli message?
- apakah body tertentu terenkripsi meskipun transport terminate di gateway?
- apakah token identity ikut message?
- apakah message replayed?
- apakah security berlaku end-to-end bukan hop-by-hop?

WS-Security menambahkan message-level security ke SOAP. OASIS SOAP Message Security menjelaskan enhancement untuk SOAP messaging agar bisa menyediakan integrity dan confidentiality.

### 4.2. Komponen Utama WS-Security

Header security umumnya:

```xml
<soap:Header>
  <wsse:Security
      xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
      xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    ...
  </wsse:Security>
</soap:Header>
```

Isi umum:

| Elemen | Fungsi |
|---|---|
| `wsse:UsernameToken` | Username/password atau digest-based credential. |
| `wsu:Timestamp` | Created/expires untuk anti-replay. |
| `ds:Signature` | XML Signature untuk integrity dan signer authentication. |
| `xenc:EncryptedData` | XML Encryption untuk confidentiality. |
| `wsse:BinarySecurityToken` | Sertifikat X.509 atau token binary lain. |
| SAML Assertion | Federated identity/claim. |

### 4.3. UsernameToken

Contoh conceptual:

```xml
<wsse:UsernameToken>
  <wsse:Username>client-a</wsse:Username>
  <wsse:Password Type="...#PasswordDigest">...</wsse:Password>
  <wsse:Nonce>...</wsse:Nonce>
  <wsu:Created>2026-06-17T04:00:00Z</wsu:Created>
</wsse:UsernameToken>
```

Risiko:

| Risiko | Penjelasan |
|---|---|
| PasswordText over non-TLS | Credential terekspos. |
| PasswordDigest salah dihitung | Interop gagal walaupun credential benar. |
| Clock skew | Timestamp ditolak. |
| Nonce reuse | Replay protection gagal. |
| Logging | Token bocor ke log. |

Rule:

```text
UsernameToken bukan pengganti desain secret management.
Ia hanya format membawa credential di SOAP header.
```

### 4.4. X.509 Signature

Signature SOAP bukan hanya “encrypt pakai certificate”. Biasanya:

- private key client menandatangani bagian message,
- public certificate dikirim atau direferensikan,
- server memvalidasi signature, certificate chain, truststore, validity, revocation policy jika ada,
- bagian yang ditandatangani ditentukan oleh reference URI.

Contoh high-level:

```xml
<ds:Signature>
  <ds:SignedInfo>
    <ds:CanonicalizationMethod Algorithm="..."/>
    <ds:SignatureMethod Algorithm="..."/>
    <ds:Reference URI="#body-123">
      <ds:Transforms>...</ds:Transforms>
      <ds:DigestMethod Algorithm="..."/>
      <ds:DigestValue>...</ds:DigestValue>
    </ds:Reference>
  </ds:SignedInfo>
  <ds:SignatureValue>...</ds:SignatureValue>
  <ds:KeyInfo>...</ds:KeyInfo>
</ds:Signature>
```

Poin penting:

```text
Signature memvalidasi byte/canonical XML tertentu, bukan object Java.
```

Karena XML canonicalization rumit, hal-hal kecil bisa merusak signature:

- namespace prefix berubah,
- whitespace signifikan dalam konteks tertentu,
- attribute ordering,
- canonicalization algorithm berbeda,
- inclusive vs exclusive canonicalization,
- reference URI salah,
- ID attribute tidak dikenali sebagai XML ID,
- attachment tidak ikut signature padahal policy mengharuskan.

### 4.5. Encryption

XML Encryption bisa mengenkripsi:

- seluruh body,
- elemen tertentu,
- token tertentu,
- atau attachment dalam profil tertentu.

Trade-off:

| Pilihan | Dampak |
|---|---|
| TLS saja | Simpler, hop-by-hop. |
| Sign body | Integrity end-to-end. |
| Encrypt body | Confidentiality end-to-end tapi debugging lebih sulit. |
| Sign then encrypt | Umum, tetapi urutan dan policy harus jelas. |
| Encrypt then sign | Different semantic; perlu disepakati. |

### 4.6. WS-Security Failure Modes

| Failure | Gejala |
|---|---|
| Timestamp expired | `MessageExpired`, `InvalidSecurity`, generic 500. |
| Clock skew | Kadang hanya gagal di environment tertentu. |
| Wrong certificate | Signature invalid atau trust failure. |
| Alias/key password salah | Client gagal sebelum request terkirim. |
| Body ID tidak cocok | Signature reference cannot be resolved. |
| Canonicalization mismatch | Signature verification failed. |
| Header order/policy mismatch | Gateway reject. |
| Token logged | Security incident. |
| Replay detection strict | Retry ditolak sebagai replay. |

### 4.7. Security Boundary yang Benar

Jangan campur aduk:

```text
Authentication: siapa caller?
Integrity: message berubah tidak?
Confidentiality: siapa bisa baca?
Replay protection: message lama dipakai lagi tidak?
Authorization: caller boleh operation ini tidak?
Auditability: bukti transaksi bisa dipertahankan tidak?
```

WS-Security bisa membantu authentication, integrity, confidentiality, dan replay protection. Tetapi authorization tetap harus diputuskan oleh aplikasi/service policy.

---

## 5. WS-Policy

### 5.1. Masalah yang Diselesaikan

Bagaimana client tahu service membutuhkan:

- WS-Addressing?
- MTOM?
- UsernameToken?
- X.509 signature?
- encrypted body?
- reliable messaging?
- TLS?
- algorithm suite tertentu?

Dokumentasi manual bisa menjelaskan, tetapi WS-* mencoba membuat requirement itu machine-readable melalui **WS-Policy**.

W3C WS-Policy 1.5 mendefinisikan general-purpose model dan syntax untuk menggambarkan policy dari entity dalam Web services-based system.

### 5.2. Bentuk Policy

Policy biasanya terlihat seperti:

```xml
<wsp:Policy xmlns:wsp="http://www.w3.org/ns/ws-policy">
  <wsp:ExactlyOne>
    <wsp:All>
      <wsoma:OptimizedMimeSerialization/>
    </wsp:All>
  </wsp:ExactlyOne>
</wsp:Policy>
```

Atau security policy lebih kompleks:

```xml
<wsp:Policy>
  <sp:TransportBinding>
    ...
  </sp:TransportBinding>
  <sp:SignedParts>
    <sp:Body/>
  </sp:SignedParts>
</wsp:Policy>
```

### 5.3. Policy Attachment

Policy bisa ditempel ke:

- WSDL service,
- port,
- binding,
- operation,
- input/output message,
- endpoint metadata,
- atau external policy reference.

Contoh conceptual:

```xml
<wsdl:binding name="ApplicationBinding" type="tns:ApplicationPortType">
  <wsp:PolicyReference URI="#ApplicationSecurityPolicy"/>
  ...
</wsdl:binding>
```

### 5.4. Policy Tidak Sama dengan Runtime Guarantee

Ini jebakan besar.

Policy menyatakan requirement/capability, tetapi:

- tidak semua framework membaca semua assertion,
- tidak semua assertion distandardisasi sama kuat,
- vendor bisa menambahkan assertion sendiri,
- generated client bisa mengabaikan policy tertentu,
- gateway bisa menerapkan policy yang tidak muncul di WSDL publik,
- environment DEV/UAT/PROD bisa berbeda.

Rule:

```text
WS-Policy adalah contract metadata.
Tetapi interop tetap harus dibuktikan dengan sample message dan integration test.
```

### 5.5. Policy Failure Modes

| Failure | Gejala |
|---|---|
| Client generator tidak support assertion | Generated client compile tapi runtime gagal. |
| Vendor-specific policy | Stack lain tidak tahu cara menerapkan. |
| Policy tidak sinkron dengan gateway | WSDL terlihat benar tapi request ditolak. |
| Algorithm suite mismatch | Signature/encryption gagal. |
| MTOM policy ignored | Memory besar atau gateway reject. |
| Security policy terlalu longgar | Compliance gap. |

---

## 6. WS-ReliableMessaging

### 6.1. Masalah yang Diselesaikan

HTTP request-response biasa tidak menjamin semantik bisnis seperti:

- exactly-once business processing,
- ordered delivery,
- acknowledgment lintas failure,
- recovery setelah connection drop,
- long-running message exchange,
- duplicate detection.

WS-ReliableMessaging mendefinisikan protocol agar messages dapat ditransfer secara reliable antar node dalam presence of software, system, atau network failures. OASIS WS-ReliableMessaging juga mendefinisikan SOAP binding untuk interoperability.

### 6.2. Konsep Utama

| Konsep | Makna |
|---|---|
| RM Source | Pihak yang mengirim reliable message. |
| RM Destination | Pihak yang menerima reliable message. |
| Sequence | Grup message yang dikelola reliability-nya. |
| MessageNumber | Nomor urut message dalam sequence. |
| Ack | Penerima mengakui range message yang diterima. |
| Nack | Indikasi message tidak diterima/diproses dalam variasi tertentu. |
| CreateSequence | Membuka sequence reliability. |
| TerminateSequence | Menutup sequence. |

Contoh conceptual:

```xml
<wsrm:Sequence>
  <wsrm:Identifier>uuid:sequence-123</wsrm:Identifier>
  <wsrm:MessageNumber>42</wsrm:MessageNumber>
</wsrm:Sequence>
```

Acknowledgement:

```xml
<wsrm:SequenceAcknowledgement>
  <wsrm:Identifier>uuid:sequence-123</wsrm:Identifier>
  <wsrm:AcknowledgementRange Lower="1" Upper="42"/>
</wsrm:SequenceAcknowledgement>
```

### 6.3. Delivery Assurance

Delivery assurance dapat mencakup:

| Assurance | Makna |
|---|---|
| AtMostOnce | Tidak diproses lebih dari sekali, tapi bisa tidak terkirim. |
| AtLeastOnce | Akan diusahakan terkirim, tapi duplicate mungkin terjadi. |
| ExactlyOnce | Tidak hilang dan tidak duplicate pada layer protocol tertentu. |
| InOrder | Urutan message dipertahankan. |

Namun, hati-hati:

```text
ExactlyOnce di protocol tidak otomatis berarti exactly-once business effect.
```

Contoh:

- service menerima SOAP message,
- melakukan insert database,
- crash sebelum ack,
- sender retry,
- receiver bisa menerima duplicate,
- kalau business idempotency tidak ada, efek bisnis duplicate tetap terjadi.

Rule top 1%:

```text
Reliable transport/protocol mengurangi uncertainty delivery.
Idempotency key dan business duplicate control tetap wajib di application boundary.
```

### 6.4. WS-RM vs Message Broker

WS-RM bukan pengganti Kafka/RabbitMQ/JMS. Ia adalah SOAP-level reliability protocol.

| Aspek | WS-RM | Message Broker |
|---|---|---|
| Layer | SOAP message protocol | Messaging infrastructure |
| Storage | Tergantung implementation | Broker-managed durable store |
| Routing | Web service endpoint | Queue/topic/exchange |
| Client interop | SOAP stack | Broker protocol/client |
| Observability | Sering sulit | Biasanya lebih eksplisit |
| Modern usage | Legacy/interoperability | Umum untuk async systems |

Gunakan WS-RM jika endpoint SOAP legacy mengharuskannya. Jangan menambahkan WS-RM hanya karena ingin “lebih reliable” tanpa memahami operational complexity.

### 6.5. Failure Modes

| Failure | Gejala |
|---|---|
| Sequence expired | Retry gagal karena sequence tidak valid. |
| Ack lost | Sender retry walau receiver sudah proses. |
| Duplicate message | Business duplicate jika tidak idempotent. |
| In-order blocking | Message nomor 43 tertahan karena 42 hilang. |
| State store corrupt | Sequence recovery gagal. |
| Cluster node mismatch | Sequence ada di node A, retry ke node B gagal jika store tidak shared. |

---

## 7. WS-AtomicTransaction dan Distributed Transaction Warning

WS-AtomicTransaction mencoba menyediakan koordinasi transaksi atomik antar Web services.

Secara mental model:

```text
Service A + Service B + Coordinator
  -> prepare
  -> commit/rollback
```

Masalahnya, distributed transaction antar service biasanya mahal dan rapuh:

- network partition,
- timeout,
- coordinator failure,
- heuristic outcome,
- lock panjang,
- coupling tinggi,
- sulit di-scale,
- sulit diobservasi,
- recovery kompleks,
- vendor interoperability sering menyakitkan.

Dalam arsitektur modern, untuk integrasi antar service, sering lebih aman memakai:

- saga,
- compensation,
- outbox,
- idempotency,
- reconciliation,
- business state machine,
- eventual consistency yang eksplisit.

Namun, di legacy SOAP enterprise, WS-AtomicTransaction bisa muncul dalam environment tertentu seperti Java EE app server, .NET WCF, atau vendor SOA suite.

Rule praktis:

```text
Jangan mengaktifkan WS-AtomicTransaction karena terlihat “enterprise”.
Gunakan hanya jika benar-benar required oleh platform/partner dan operational recovery-nya dipahami.
```

---

## 8. WS-I Profiles: Kenapa “Standar” Saja Tidak Cukup

Banyak spesifikasi SOAP terlalu fleksibel. Dua vendor sama-sama “sesuai standar” tetapi tetap tidak interoperable.

WS-I profile mencoba menentukan subset/praktik agar interoperabilitas lebih tinggi, misalnya:

- Basic Profile,
- Basic Security Profile,
- aturan document/literal,
- aturan WSDL,
- aturan SOAP binding,
- aturan encoding yang sebaiknya dihindari.

Mental model:

```text
Specification = apa yang mungkin.
Profile = subset yang disepakati agar interop lebih aman.
Implementation = apa yang benar-benar dilakukan runtime.
```

Top 1% engineer tidak hanya bertanya:

```text
"Apakah ini SOAP standard?"
```

Tetapi bertanya:

```text
"Profile apa yang diikuti?"
"Stack apa yang digunakan kedua sisi?"
"Sample message canonical seperti apa?"
"Apakah sudah dites dengan tool/vendor sebenarnya?"
```

---

## 9. Vendor-Specific Behavior

SOAP WS-* interoperability sering gagal bukan karena engineer tidak mengerti XML, tetapi karena perbedaan implementasi.

Contoh variasi:

| Area | Variasi Vendor |
|---|---|
| Header order | Ada gateway yang sensitif terhadap urutan. |
| Namespace prefix | Secara XML tidak signifikan, tapi ada sistem buggy yang sensitif. |
| Timestamp skew | 30 detik, 5 menit, 10 menit. |
| Password digest | Encoding/nonce treatment berbeda. |
| Certificate reference | IssuerSerial vs BinarySecurityToken vs Thumbprint. |
| Signature parts | Body saja vs body+timestamp+addressing. |
| Attachment signing | Inline, MIME part, atau tidak didukung. |
| MTOM threshold | Kapan base64 jadi attachment. |
| SOAPAction | Required kosong, quoted, unquoted, atau harus match exact. |
| Fault shape | Modeled fault vs generic SOAP fault. |

Cara berpikir:

```text
Spec tells you the grammar.
Interop tells you the dialect.
```

Dokumen terbaik untuk integrasi legacy biasanya bukan hanya WSDL, tetapi:

- WSDL,
- XSD,
- policy,
- sample successful request,
- sample successful response,
- sample fault,
- certificate requirement,
- supported algorithms,
- clock skew,
- gateway limits,
- timeout,
- max message size,
- MTOM threshold,
- operation idempotency rule,
- retry/reconciliation procedure.

---

## 10. Java Stack Landscape untuk WS-*

### 10.1. Java 8

Di Java 8, banyak engineer terbiasa bahwa JAX-WS/JAXB/SAAJ terasa tersedia dari JDK. Ini membuat project lama sering tidak punya dependency eksplisit.

Konsekuensi:

```text
Build tampak bersih di Java 8.
Migration ke Java 11+ tiba-tiba gagal compile/runtime.
```

### 10.2. Java 11+

Sejak Java 11, modul Java EE/CORBA yang sebelumnya deprecated for removal di Java 9 dihapus dari JDK, termasuk `java.xml.ws`, `java.xml.bind`, `java.activation`, dan related tools. Karena itu JAX-WS/JAXB/SAAJ harus dibawa sebagai dependency/runtime terpisah.

### 10.3. javax vs jakarta

Stack lama menggunakan:

```java
javax.xml.ws.*
javax.xml.bind.*
javax.xml.soap.*
javax.jws.*
```

Stack Jakarta modern menggunakan:

```java
jakarta.xml.ws.*
jakarta.xml.bind.*
jakarta.xml.soap.*
jakarta.jws.*
```

Jebakan:

```text
Tidak boleh mencampur javax dan jakarta secara acak.
Generated code, runtime implementation, annotations, app server, dan dependencies harus sejalur.
```

### 10.4. Implementasi Umum

| Implementasi/Stack | Catatan |
|---|---|
| Metro / Eclipse Metro | Reference lineage untuk JAX-WS/Jakarta XML WS, SAAJ, WSIT features. |
| Apache CXF | Banyak dipakai untuk SOAP/REST, WS-Security, WS-Policy, WS-RM. |
| Axis/Axis2 | Banyak legacy; hati-hati maintenance dan compatibility. |
| Spring-WS | Contract-first SOAP, bukan JAX-WS-centric. |
| WebLogic/WebSphere/JBoss/WildFly | App server dengan integrasi policy/security masing-masing. |
| .NET WCF | Partner enterprise umum; interop perlu profile testing. |

---

## 11. Reading a WS-* SOAP Message: Step-by-Step

Ambil message seperti ini:

```xml
<soap:Envelope
    xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
    xmlns:wsa="http://www.w3.org/2005/08/addressing"
    xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
    xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
    xmlns:app="urn:example:application">

  <soap:Header>
    <wsa:Action soap:mustUnderstand="true">urn:SubmitApplication</wsa:Action>
    <wsa:MessageID>urn:uuid:11111111-2222-3333-4444-555555555555</wsa:MessageID>
    <wsa:To soap:mustUnderstand="true">https://partner/ws/ApplicationService</wsa:To>

    <wsse:Security soap:mustUnderstand="true">
      <wsu:Timestamp wsu:Id="TS-1">
        <wsu:Created>2026-06-17T04:00:00Z</wsu:Created>
        <wsu:Expires>2026-06-17T04:05:00Z</wsu:Expires>
      </wsu:Timestamp>
      ...
    </wsse:Security>
  </soap:Header>

  <soap:Body wsu:Id="Body-1">
    <app:SubmitApplicationRequest>
      ...
    </app:SubmitApplicationRequest>
  </soap:Body>
</soap:Envelope>
```

Baca dengan urutan:

### Step 1 — SOAP Version

```xml
http://www.w3.org/2003/05/soap-envelope
```

Berarti SOAP 1.2.

Kalau SOAP 1.1:

```xml
http://schemas.xmlsoap.org/soap/envelope/
```

Dampak:

- fault shape berbeda,
- content-type berbeda,
- SOAPAction behavior berbeda,
- framework binding bisa berbeda.

### Step 2 — mustUnderstand Headers

Header dengan `mustUnderstand=true` wajib diproses.

Pertanyaan:

```text
Apakah stack saya mengenali WS-Addressing namespace ini?
Apakah stack saya mengenali WS-Security header ini?
Apakah handler chain dipasang?
```

### Step 3 — WS-Addressing

Validasi:

- `Action` sesuai WSDL/policy?
- `To` sesuai actual endpoint?
- `MessageID` unique?
- perlu `ReplyTo`/`FaultTo`?

### Step 4 — WS-Security Timestamp

Validasi:

- waktu UTC?
- clock skew?
- expires masih valid?
- replay cache aktif?

### Step 5 — Signature/Encryption

Validasi:

- bagian mana yang signed?
- body punya `wsu:Id`?
- timestamp signed?
- addressing signed?
- certificate trusted?
- algorithm allowed?

### Step 6 — Body Payload

Baru setelah header protokol valid, baca business body:

- namespace benar?
- root element benar?
- XSD valid?
- optional/nillable semantics benar?
- backward-compatible?

Top 1% habit:

```text
Debug SOAP dari envelope outward, bukan langsung dari body DTO.
```

---

## 12. Designing WS-* Interoperability Tests

Testing SOAP WS-* tidak cukup unit test JAXB.

### 12.1. Test Layer

| Layer | Test |
|---|---|
| XML shape | Golden file comparison dengan canonical rules. |
| XSD validation | Validate request/response against schema. |
| WSDL contract | Generated client/server compatibility. |
| Header presence | Assert WS-Addressing/Security headers. |
| Signature | Verify signed parts and certificate. |
| Policy | Check expected policy assertions. |
| Runtime interop | Test against real partner/gateway sandbox. |
| Fault | Test modeled and unmodeled fault behavior. |
| Retry | Test duplicate/retry/idempotency. |
| Clock skew | Test expired/future timestamp. |
| Attachment | Test MTOM/non-MTOM payload. |

### 12.2. Golden Sample Strategy

Simpan sample message:

```text
src/test/resources/soap-samples/
  submit-application-request.valid.soap.xml
  submit-application-response.valid.soap.xml
  submit-application-fault.validation-error.soap.xml
  submit-application-fault.security-error.soap.xml
```

Test yang harus ada:

```text
Can generate request matching required SOAP version.
Can include correct WS-Addressing Action.
Can include required WS-Security timestamp.
Can sign exact required parts.
Can validate response body.
Can parse modeled fault.
Can classify transport vs SOAP vs business failure.
```

### 12.3. Jangan Overfit Prefix

XML namespace prefix tidak seharusnya signifikan:

```xml
<app:SubmitApplicationRequest>
```

dan:

```xml
<x:SubmitApplicationRequest xmlns:x="urn:example:application">
```

secara namespace-aware sama.

Tetapi di dunia legacy, ada sistem buggy yang sensitif prefix. Kalau partner mengharuskan prefix tertentu, catat sebagai **vendor interoperability requirement**, bukan XML semantic requirement.

---

## 13. Observability untuk WS-*

Logging SOAP harus sangat hati-hati.

### 13.1. Jangan Log Mentah Semua

SOAP bisa berisi:

- password token,
- nonce,
- certificate,
- signature,
- encrypted data,
- personal data,
- documents,
- attachments,
- business identifiers,
- replay-sensitive timestamp.

Rule:

```text
Log envelope metadata, bukan rahasia/payload penuh.
```

### 13.2. Metadata yang Berguna

| Metadata | Kegunaan |
|---|---|
| correlation id internal | tracing antar service. |
| `wsa:MessageID` | correlation dengan partner. |
| `wsa:Action` | operation classification. |
| SOAP version | protocol mismatch debugging. |
| endpoint URL | routing/debugging. |
| certificate alias/thumbprint | security debugging tanpa bocor private key. |
| timestamp created/expires | clock skew debugging. |
| fault code/subcode | error classification. |
| retry attempt | resilience analysis. |
| idempotency key | duplicate handling. |

Contoh structured log:

```json
{
  "event": "soap.outbound.request",
  "system": "partner-application-service",
  "operation": "SubmitApplication",
  "soapVersion": "1.2",
  "wsaAction": "urn:SubmitApplication",
  "wsaMessageId": "urn:uuid:11111111-2222-3333-4444-555555555555",
  "security": {
    "timestampCreated": "2026-06-17T04:00:00Z",
    "timestampExpires": "2026-06-17T04:05:00Z",
    "signingCertThumbprint": "redacted-safe-thumbprint"
  },
  "httpStatus": 500,
  "soapFaultCode": "Sender",
  "retryable": false
}
```

---

## 14. Common Production Incident Patterns

### 14.1. “Works in DEV, Fails in UAT”

Kemungkinan:

- UAT gateway policy beda.
- certificate UAT belum di-trust.
- endpoint URL berubah tapi `wsa:To` masih DEV.
- clock NTP drift.
- WSDL DEV dan UAT tidak identik.
- firewall/proxy terminate TLS berbeda.
- SOAPAction divalidasi di UAT tapi tidak di DEV.

### 14.2. “Signature Invalid Padahal XML Terlihat Sama”

Kemungkinan:

- canonicalization berbeda.
- namespace declaration berubah.
- whitespace di signed text node berubah.
- pretty printing setelah signing.
- signed part tidak sama.
- `wsu:Id` tidak dikenali.
- attachment tidak ikut transform.
- framework handler memodifikasi envelope setelah signing.

Rule:

```text
Jangan pretty-print atau mutate SOAP message setelah signature dibuat.
```

### 14.3. “Retry Membuat Duplicate Case”

Kemungkinan:

- HTTP timeout terjadi setelah server memproses request.
- client retry dengan `MessageID` baru.
- server tidak punya business idempotency key.
- WS-RM ack hilang.
- fault diklasifikasikan retryable padahal business side effect sudah terjadi.

Mitigasi:

- business idempotency key,
- duplicate detection table,
- reconciliation endpoint,
- retry hanya untuk safe failure,
- correlation dengan `MessageID`,
- operator runbook.

### 14.4. “SOAPAction Not Supported”

Kemungkinan:

- SOAP 1.1 HTTP header salah.
- `wsa:Action` salah.
- generated client dari WSDL lama.
- operation overload/namespace mismatch.
- endpoint mengarah ke service berbeda.
- quote SOAPAction berbeda.

### 14.5. “mustUnderstand Fault”

Kemungkinan:

- client mengirim header yang server tidak support.
- server butuh module WS-Addressing/WS-Security aktif.
- namespace versi salah.
- actor/role mismatch.
- intermediary tidak memproses header.

---

## 15. Decision Matrix: Kapan Perlu WS-*?

| Requirement | Bias Pilihan |
|---|---|
| Synchronous internal service modern | Biasanya REST/gRPC/JSON cukup. |
| Legacy partner hanya expose SOAP | Gunakan SOAP sesuai contract. |
| Need message-level signature for legal/audit proof | WS-Security signature masuk akal. |
| TLS terminated at gateway tapi payload harus end-to-end confidential | WS-Security encryption bisa relevan. |
| Async callback SOAP | WS-Addressing relevan. |
| Partner requires reliable SOAP protocol | WS-RM required. |
| Large binary document via SOAP | MTOM. |
| Multi-party distributed transaction | Hindari jika bisa; pertimbangkan saga/reconciliation. |
| Machine-readable endpoint requirement | WS-Policy berguna tapi tetap test actual runtime. |
| New greenfield service | Jangan pilih WS-* kecuali ada constraint eksternal kuat. |

---

## 16. Java Implementation Pattern: Keep WS-* at Boundary

Desain buruk:

```java
public class CaseService {
    public void submit(SOAPMessage message) {
        // business logic membaca wsse/wsa langsung
    }
}
```

Desain lebih baik:

```text
SOAP/JAX-WS Boundary
  -> validates WS-* protocol requirements
  -> extracts trusted caller/correlation/context
  -> maps body to application command
  -> calls domain/application service
```

Contoh conceptual:

```java
public final class PartnerSubmitApplicationEndpoint {

    private final SubmitApplicationUseCase useCase;
    private final SoapContextExtractor contextExtractor;

    public SubmitApplicationResponse submit(SubmitApplicationRequest request) {
        SoapRequestContext ctx = contextExtractor.current();

        SubmitApplicationCommand command = new SubmitApplicationCommand(
                ctx.partnerId(),
                ctx.messageId(),
                request.applicationReference(),
                request.payload()
        );

        SubmitApplicationResult result = useCase.handle(command);

        return SubmitApplicationResponse.from(result);
    }
}
```

Boundary object:

```java
public record SoapRequestContext(
        String partnerId,
        String messageId,
        String action,
        Instant messageCreatedAt,
        String certificateThumbprint,
        String correlationId
) {}
```

Application layer tidak perlu tahu detail:

- XML Signature,
- canonicalization,
- WS-Addressing namespace,
- `SOAPMessage`,
- handler chain,
- WSDL port.

Ia hanya menerima context yang sudah dipercaya dan divalidasi.

---

## 17. Handler Chain Mental Model

JAX-WS handler chain sering dipakai untuk:

- inject WS-Addressing,
- inspect SOAP headers,
- add correlation id,
- log metadata,
- validate custom header,
- map partner context,
- observe fault.

Ada dua tipe besar:

```text
LogicalHandler
  -> melihat message secara payload/logical level

SOAPHandler
  -> melihat SOAPMessage termasuk header/envelope
```

Rule:

```text
Security signing/encryption sebaiknya dikelola framework/security module, bukan manual handler rumit kecuali benar-benar perlu.
```

Bahaya handler:

- mengubah message setelah signing,
- membaca stream attachment sampai habis,
- logging rahasia,
- membuat dependency ke prefix,
- membuat state mutable tidak thread-safe,
- swallowing fault,
- menambah latency besar.

---

## 18. Compatibility Strategy Java 8–25

### 18.1. Baseline Rule

Untuk project yang harus hidup dari Java 8 sampai 25:

```text
Jadikan SOAP/JAXB/JAX-WS/SAAJ dependency eksplisit.
Jangan bergantung pada JDK bundled Java EE modules.
```

### 18.2. Pisahkan Module

Struktur yang lebih aman:

```text
integration-contract/
  XSD, WSDL, generated JAXB/JAX-WS classes

integration-soap-client/
  JAX-WS/CXF/Metro client runtime, WS-* config

application-core/
  command/use-case/domain logic tanpa SOAP dependency

integration-test/
  golden SOAP samples, sandbox test, policy test
```

### 18.3. javax dan jakarta Branching

Jika harus support legacy app server `javax` dan modern Jakarta `jakarta`, jangan campur dalam satu artifact sembarangan.

Pilihan:

| Strategi | Kapan |
|---|---|
| Tetap `javax` untuk legacy runtime | App server lama, Java 8/11 dengan external deps. |
| Migrasi penuh ke `jakarta` | Jakarta EE 9+ / modern runtime. |
| Adapter layer | Perlu transisi bertahap. |
| Separate build profiles/artifacts | Dua target runtime berbeda. |

Rule:

```text
Generated source dari wsimport/xjc harus sesuai namespace API runtime.
```

---

## 19. Runbook Debugging WS-* Incident

Saat integrasi SOAP WS-* gagal, gunakan urutan ini.

### 19.1. Classify Failure

```text
1. Tidak bisa connect?
   -> DNS/TLS/proxy/firewall/endpoint.

2. HTTP error tanpa SOAP fault?
   -> Gateway/container/security transport.

3. SOAP fault?
   -> Baca fault code/subcode/reason/detail.

4. Client exception sebelum send?
   -> KeyStore, TrustStore, generated proxy, marshalling, policy config.

5. Response parse gagal?
   -> Contract drift, namespace, XSD, unexpected fault.
```

### 19.2. Protocol Checklist

```text
[ ] SOAP version benar?
[ ] Endpoint URL benar?
[ ] SOAPAction benar?
[ ] wsa:Action benar?
[ ] wsa:To benar?
[ ] MessageID unique?
[ ] Timestamp UTC dan tidak expired?
[ ] Clock skew OK?
[ ] Certificate alias benar?
[ ] Truststore memercayai partner?
[ ] Signed parts sesuai policy?
[ ] Encryption sesuai policy?
[ ] MTOM on/off sesuai policy?
[ ] Attachment size limit OK?
[ ] Generated client dari WSDL terbaru?
[ ] XSD validation pass?
[ ] Fault mapped dengan benar?
```

### 19.3. Evidence yang Harus Dikumpulkan

Tanpa membocorkan secret:

- timestamp request,
- environment,
- endpoint,
- operation/action,
- `wsa:MessageID`,
- correlation id,
- sanitized SOAP envelope,
- SOAP fault,
- HTTP status,
- TLS/certificate alias/thumbprint,
- WSDL version/hash,
- policy version/hash,
- retry attempt,
- partner reference id jika ada.

---

## 20. Anti-Patterns

### Anti-Pattern 1 — Treat SOAP Client as Local Method Call

```java
port.submitApplication(request);
```

terlihat lokal, padahal:

- network bisa timeout,
- server bisa proses walau client timeout,
- SOAP fault tidak sama dengan business rejection,
- retry bisa duplicate,
- security header bisa expired,
- generated class bisa drift.

### Anti-Pattern 2 — Blindly Regenerate Client from WSDL

Regenerate tanpa review bisa mengubah:

- package/class names,
- enum values,
- nillable handling,
- wrapper style,
- fault classes,
- operation signature,
- binding behavior.

Gunakan WSDL diff dan generated source diff.

### Anti-Pattern 3 — Log Full SOAP Envelope in Production

Ini bisa membocorkan:

- credential,
- token,
- personal data,
- signed payload,
- document attachment.

### Anti-Pattern 4 — Manual XML String Concatenation

Membuat SOAP XML manual dengan string:

- rentan namespace bug,
- escaping bug,
- signature break,
- injection,
- maintainability buruk.

### Anti-Pattern 5 — Retry All Exceptions

Tidak semua failure retryable.

| Failure | Retry? |
|---|---|
| Network connect timeout | Mungkin, dengan idempotency. |
| Read timeout | Berbahaya; server mungkin sudah proses. |
| SOAP Sender fault | Biasanya tidak. |
| Security fault | Tidak, kecuali token refresh/clock issue yang jelas. |
| Receiver temporary fault | Mungkin. |
| Business validation fault | Tidak. |

---

## 21. Practical Integration Blueprint

Untuk integrasi SOAP WS-* yang production-grade:

```text
1. Contract acquisition
   - WSDL, XSD, policy, samples, certificate docs.

2. Contract classification
   - SOAP version, binding style, WS-* requirements.

3. Code generation
   - pin tool version, generated source committed or reproducible.

4. Runtime configuration
   - endpoint, timeout, TLS, WS-Security, MTOM, handler chain.

5. Boundary mapping
   - generated DTO -> application command.
   - response/fault -> application result/error.

6. Security hardening
   - keystore/truststore, timestamp, replay, no secret logging.

7. Reliability design
   - idempotency key, retry classifier, duplicate handling.

8. Observability
   - message id, action, fault code, latency, partner correlation.

9. Contract tests
   - golden samples, XSD validation, fault parsing.

10. Interop tests
   - actual partner sandbox/gateway.

11. Runbook
   - known faults, certificate renewal, retry/reconciliation.
```

---

## 22. Mental Model Ringkas

WS-* adalah cara SOAP membawa protocol-level behavior di atas XML envelope.

```text
WSDL tells what service operations exist.
XSD tells what payload shape is valid.
SOAP tells how message envelope is structured.
WS-Addressing tells where/how message is addressed.
WS-Security tells how trust/integrity/confidentiality is represented.
WS-Policy tells what requirements/capabilities exist.
WS-RM tells how delivery state is tracked.
Vendor stack tells what actually works.
```

Top 1% SOAP engineer bukan orang yang sekadar bisa generate client dari WSDL. Ia bisa:

- membaca envelope dan header sebagai kontrak runtime,
- membedakan transport failure, protocol fault, security fault, dan business fault,
- memahami signature/encryption sebagai message-level trust,
- mendesain retry tanpa duplicate business effect,
- menahan WS-* complexity tetap di integration boundary,
- membuat runbook yang cukup detail untuk incident production,
- dan merancang migrasi Java 8 → 11+ / `javax` → `jakarta` tanpa merusak kontrak partner.

---

## 23. Checklist Penguasaan Part 28

Setelah bagian ini, kamu harus bisa menjawab:

- Apa beda SOAP body dan WS-* header?
- Apa fungsi `wsa:Action`, `wsa:MessageID`, `wsa:To`, `ReplyTo`, dan `FaultTo`?
- Kenapa SOAPAction dan WS-Addressing Action tidak boleh diasumsikan sama?
- Apa beda TLS dan WS-Security?
- Apa fungsi UsernameToken, Timestamp, XML Signature, XML Encryption, dan BinarySecurityToken?
- Kenapa XML Signature sering gagal walaupun XML “terlihat sama”?
- Apa fungsi WS-Policy dan kenapa policy tidak menjamin runtime interoperability?
- Apa yang diselesaikan WS-ReliableMessaging dan kenapa tetap butuh idempotency?
- Kenapa WS-AtomicTransaction berisiko tinggi untuk service integration modern?
- Bagaimana membaca SOAP message WS-* secara sistematis?
- Metadata apa yang aman dan berguna untuk logging?
- Bagaimana strategi test SOAP WS-* yang tidak rapuh?
- Bagaimana mengelola kompatibilitas Java 8–25 dan `javax`/`jakarta`?

---

## 24. Referensi Utama

- W3C, **Web Services Addressing 1.0 - Core**.
- OASIS, **Web Services Security: SOAP Message Security 1.1.1**.
- W3C, **Web Services Policy 1.5 - Framework**.
- OASIS, **WS-ReliableMessaging v1.2**.
- Jakarta EE, **Jakarta XML Web Services**.
- Jakarta EE, **Jakarta SOAP with Attachments**.
- OpenJDK, **JEP 320: Remove the Java EE and CORBA Modules**.
- WS-I, **Basic Profile / Basic Security Profile**.
- Eclipse Metro / Apache CXF documentation for practical WS-* implementation behavior.

---

## 25. Status Seri

Belum selesai.

Part ini adalah **Part 28 dari 34**.

Berikutnya:

```text
Part 29 — SOAP Security in Practice
```

Bagian berikutnya akan masuk lebih dalam ke praktik security SOAP: TLS vs message security, XML Signature, XML Encryption, timestamp/replay protection, canonicalization, keystore/truststore, certificate rollover, dan cara membuat konfigurasi security yang operasional.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-json-xml-soap-connectors-enterprise-integration-part-027](./learn-java-json-xml-soap-connectors-enterprise-integration-part-027.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration — Part 29](./learn-java-json-xml-soap-connectors-enterprise-integration-part-029.md)

</div>