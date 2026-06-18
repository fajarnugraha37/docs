# learn-java-json-xml-soap-connectors-enterprise-integration-part-027

# Part 27 — SOAP Attachments & MTOM/SAAJ

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Posisi: Part 27 dari 34  
> Fokus: SOAP attachments, MTOM/XOP, SAAJ, binary payload, streaming, memory trap, interoperability, dan production design untuk Java 8–25.

---

## 0. Tujuan Part Ini

Setelah bagian sebelumnya kita membahas SOAP fault dan resilience, bagian ini masuk ke problem yang sangat nyata di enterprise integration:

> Bagaimana mengirim dokumen, file, image, PDF, arsip, report, atau binary payload besar melalui SOAP tanpa membuat XML menjadi monster base64 yang boros memori, lambat, dan sulit diamankan?

Di dunia modern, file upload sering dibahas lewat HTTP multipart, object storage, signed URL, atau REST endpoint. Tetapi di banyak sistem enterprise dan government, masih banyak integrasi yang mengharuskan:

- SOAP request berisi metadata + attachment.
- SOAP response berisi dokumen hasil proses.
- SOAP fault masih harus membawa business error.
- WSDL masih menjadi source of truth.
- Payload harus bisa di-audit.
- Message harus bisa diamankan dengan TLS dan kadang WS-Security.
- Sistem lawan mungkin .NET/WCF, IBM, Oracle, SAP, legacy ESB, atau app server tua.

Karena itu, memahami SOAP attachments bukan nostalgia. Ini adalah skill penting untuk sistem yang punya:

- regulatory documents,
- case evidence,
- legal files,
- financial statement,
- licensing document,
- identity proof,
- scanned form,
- signed PDF,
- data archival,
- cross-agency exchange,
- B2B integration,
- mainframe/EIS bridge.

Part ini akan membangun mental model agar kita tidak sekadar tahu annotation `@MTOM`, tetapi paham konsekuensi kontrak, wire format, memory, security, interop, dan migration Java 8 sampai Java 25.

---

## 1. Masalah Dasar: XML Tidak Cocok Menyimpan Binary Secara Mentah

XML adalah text format. Binary data tidak bisa langsung dimasukkan begitu saja ke dalam XML element.

Misalnya kita punya PDF:

```text
%PDF-1.7\n...binary bytes...
```

Kalau dimasukkan langsung ke XML, banyak byte tidak valid sebagai karakter XML. Solusi tradisional adalah encode binary menjadi base64:

```xml
<document>
  <fileName>evidence.pdf</fileName>
  <content>JVBERi0xLj...long-base64...</content>
</document>
```

Masalahnya, base64 punya overhead.

Secara kasar:

```text
3 byte binary -> 4 karakter base64
```

Artinya payload membesar sekitar 33%, belum termasuk:

- XML tag overhead,
- whitespace,
- memory copy,
- DOM/JAXB object allocation,
- charset conversion,
- logging accidental dump,
- buffering di client/server/proxy,
- security scanning,
- signature/canonicalization cost,
- timeout karena upload/download lama.

Untuk file kecil, base64 inline mungkin masih acceptable. Untuk file besar, ini bisa menjadi production incident.

### 1.1 Mental Model

Ada tiga bentuk representasi binary dalam SOAP:

```text
[Binary asli]
    |
    | encode base64 inline
    v
[XML element berisi text base64]

atau

[Binary asli]
    |
    | dikirim sebagai MIME attachment
    v
[SOAP envelope + external binary part]

atau

[Binary asli]
    |
    | tidak dikirim via SOAP, hanya reference
    v
[SOAP envelope berisi documentId / URL / token]
```

Jadi pertanyaan desainnya bukan “bagaimana upload file via SOAP”, tetapi:

> Apakah binary harus menjadi bagian dari SOAP infoset, bagian dari MIME package, atau dipindahkan ke storage/reference model?

---

## 2. Empat Strategi Binary Payload di SOAP

## 2.1 Inline Base64

Payload binary diletakkan sebagai text base64 di XML.

Contoh:

```xml
<ns:SubmitDocumentRequest xmlns:ns="urn:agency:document:v1">
  <ns:caseId>CASE-2026-0001</ns:caseId>
  <ns:fileName>evidence.pdf</ns:fileName>
  <ns:content>JVBERi0xLjQKJ...</ns:content>
</ns:SubmitDocumentRequest>
```

Kelebihan:

- Sederhana.
- Semua data ada dalam satu XML document.
- Mudah divalidasi secara logical terhadap XSD `xs:base64Binary`.
- Tidak perlu MIME multipart.
- Cocok untuk payload kecil.

Kekurangan:

- Payload membesar.
- Parser bisa memakan banyak memori.
- JAXB `byte[]` bisa meng-copy data besar ke heap.
- Logging XML bisa membocorkan dokumen.
- Signature/canonicalization bisa mahal.
- Timeout/proxy limit lebih mudah terkena.

Cocok untuk:

- token kecil,
- thumbnail kecil,
- hash/digest,
- document sample kecil,
- payload binary di bawah threshold yang jelas.

Tidak cocok untuk:

- PDF besar,
- ZIP besar,
- image besar,
- batch document,
- regulatory evidence besar.

---

## 2.2 SOAP with Attachments / SwA

SOAP with Attachments mengemas SOAP envelope dan binary part dalam MIME multipart message.

Secara konseptual:

```text
MIME multipart/related
├── Part 1: SOAP Envelope XML
│   └── reference ke attachment
└── Part 2: binary/pdf/image/etc
```

Kelebihan:

- Binary tidak perlu base64 inline.
- Lebih efisien untuk file besar.
- Bisa membawa beberapa attachment.

Kekurangan:

- Interop kadang rumit.
- Reference antar MIME part harus benar.
- Tidak selalu cocok dengan pure JAXB binding.
- Tooling legacy bisa berbeda-beda.
- Security/signature lebih kompleks.

SwA adalah pola lama. Di banyak JAX-WS modern, MTOM lebih sering direkomendasikan daripada SwA manual.

---

## 2.3 MTOM/XOP

MTOM adalah mekanisme optimasi transmisi SOAP untuk binary data. XOP adalah packaging mechanism yang memindahkan binary content dari XML serialization ke MIME part, sambil mempertahankan konsep bahwa binary tersebut secara logical tetap bagian dari XML infoset.

Secara logical, message masih terlihat seperti:

```xml
<content>...base64Binary logical value...</content>
```

Tapi secara wire, yang dikirim bisa menjadi:

```xml
<content>
  <xop:Include href="cid:document-123@example.org"
               xmlns:xop="http://www.w3.org/2004/08/xop/include"/>
</content>
```

Dan binary-nya ada di MIME part terpisah:

```text
--boundary
Content-Type: application/xop+xml; type="text/xml"

<soap:Envelope>...</soap:Envelope>

--boundary
Content-Type: application/pdf
Content-ID: <document-123@example.org>

%PDF-1.7 ...binary...
--boundary--
```

Kunci mental model:

> MTOM bukan mengubah kontrak data menjadi multipart biasa. MTOM menjaga binary sebagai bagian logical dari XML, tetapi mengoptimalkan representasi wire-nya.

Kelebihan:

- Lebih interoperable dalam JAX-WS/.NET world.
- Bisa tetap memakai XSD `xs:base64Binary`.
- JAXB bisa mapping ke `DataHandler`, `Source`, `Image`, atau `byte[]` tergantung binding.
- Lebih efisien untuk binary besar.

Kekurangan:

- Tidak semua binary otomatis dioptimasi.
- Threshold dan provider behavior bisa berbeda.
- Kalau salah mapping, tetap bisa jatuh ke inline base64.
- WS-Security dan signature bisa lebih rumit.
- Beberapa proxy/gateway tidak suka multipart SOAP.

---

## 2.4 Reference-Based Transfer

Alih-alih mengirim file dalam SOAP, SOAP hanya membawa reference:

```xml
<SubmitDocumentRequest>
  <caseId>CASE-2026-0001</caseId>
  <documentRef>
    <documentId>DOC-778899</documentId>
    <sha256>...</sha256>
    <downloadUrl>https://...</downloadUrl>
    <expiresAt>2026-06-17T10:30:00Z</expiresAt>
  </documentRef>
</SubmitDocumentRequest>
```

Atau:

```xml
<SubmitDocumentRequest>
  <caseId>CASE-2026-0001</caseId>
  <objectKey>agency-a/case/CASE-2026-0001/evidence.pdf</objectKey>
  <checksum algorithm="SHA-256">...</checksum>
</SubmitDocumentRequest>
```

Kelebihan:

- SOAP message tetap kecil.
- File transfer bisa memakai object storage/CDN/direct upload.
- Retry bisa dipisah antara metadata dan binary.
- Cocok untuk payload sangat besar.
- Lebih mudah mengatur retention/scanning/virus scan.

Kekurangan:

- Butuh dua-phase workflow.
- Butuh lifecycle storage.
- Butuh access control terpisah.
- Konsistensi metadata vs file harus dijaga.
- Tidak selalu diterima oleh partner legacy yang menuntut file dalam SOAP.

Untuk sistem modern, reference-based sering lebih sehat. Untuk sistem legacy yang contract-nya fixed, MTOM/SAAJ masih perlu dikuasai.

---

## 3. Decision Matrix

| Skenario | Pilihan Umum | Alasan |
|---|---|---|
| Payload < 100 KB | Inline base64 | Sederhana, overhead masih bisa diterima. |
| Payload 100 KB–10 MB | MTOM | Mengurangi overhead base64 dan memory pressure. |
| Payload > 10–50 MB | MTOM atau reference-based | Tergantung partner dan infra limit. |
| Payload ratusan MB | Reference-based | SOAP bukan jalur ideal untuk transfer besar. |
| Partner hanya mendukung old SwA | SwA/SAAJ | Harus ikuti kontrak partner. |
| Perlu WSDL-first interop dengan .NET | MTOM + XSD base64Binary + policy | Lebih umum di tool SOAP modern. |
| Perlu message-level signing | Hati-hati MTOM + WS-Security | Signature/canonicalization bisa tricky. |
| Perlu audit dan retention | Reference + checksum atau MTOM dengan audit metadata | Jangan log binary mentah. |
| Perlu streaming penuh | DataHandler/StreamingDataHandler/provider-specific | Hindari `byte[]` untuk file besar. |

Rule of thumb:

> Jangan menjadikan SOAP sebagai file transfer engine besar kecuali contract eksternal memaksa. Kalau terpaksa, pakai MTOM dan desain threshold, streaming, timeout, checksum, dan observability sejak awal.

---

## 4. Jakarta SOAP with Attachments / SAAJ: Apa Itu?

SAAJ awalnya dikenal sebagai SOAP with Attachments API for Java. Dalam dunia Jakarta, ini menjadi **Jakarta SOAP with Attachments**.

SAAJ memberi API low-level untuk membuat, membaca, dan memanipulasi SOAP message.

Contoh objek penting:

- `MessageFactory`
- `SOAPMessage`
- `SOAPPart`
- `SOAPEnvelope`
- `SOAPHeader`
- `SOAPBody`
- `SOAPElement`
- `AttachmentPart`
- `MimeHeaders`
- `SOAPFactory`

Mental model:

```text
JAX-WS = high-level web service programming model
SAAJ   = low-level SOAP message object model
JAXB   = XML <-> Java object binding
StAX   = streaming XML parser/writer
MTOM   = wire optimization for binary content
MIME   = multipart packaging format
```

JAX-WS sering memakai SAAJ di bawahnya, terutama untuk handler atau message manipulation.

### 4.1 Kapan Perlu SAAJ?

Gunakan SAAJ kalau:

- perlu membuat SOAP message secara manual,
- perlu membaca/memanipulasi header/body secara generic,
- perlu menambah attachment manual,
- perlu implementasi client untuk partner sangat legacy,
- perlu debugging message SOAP di luar generated proxy,
- perlu membuat gateway/bridge SOAP,
- perlu handler yang inspect message.

Jangan gunakan SAAJ kalau:

- WSDL sudah jelas dan JAX-WS generated client cukup,
- hanya butuh call operation normal,
- ingin performa streaming optimal untuk payload besar,
- tidak perlu manipulasi message-level.

SAAJ sangat powerful, tetapi juga mudah membuat heap pressure karena `SOAPMessage` biasanya merepresentasikan message sebagai object model.

---

## 5. Dependency dan Namespace Java 8–25

## 5.1 Java 8

Di Java 8, banyak API Java EE lama masih terasa tersedia dari JDK, termasuk JAXB/JAX-WS/SAAJ-related module.

Package lama:

```java
javax.xml.soap.*
javax.xml.ws.*
javax.activation.*
javax.xml.bind.*
```

Banyak aplikasi lama mengandalkan ini tanpa dependency eksplisit.

Masalahnya muncul saat migrasi ke Java 11+.

---

## 5.2 Java 11+

Sejak Java 11, modul Java EE/CORBA yang dulu deprecated for removal di Java 9/10 sudah dihapus dari JDK. Maka JAXB, JAX-WS, SAAJ, dan Activation perlu dependency eksplisit.

Package bisa tetap `javax.*` jika memakai versi lama, atau pindah ke `jakarta.*` jika memakai Jakarta generasi baru.

---

## 5.3 Jakarta Namespace

Jakarta EE 9+ melakukan namespace migration dari:

```java
javax.xml.soap.SOAPMessage
```

menjadi:

```java
jakarta.xml.soap.SOAPMessage
```

Untuk codebase modern Java 17/21/25, sebaiknya pilih salah satu secara konsisten:

- legacy stack: `javax.*`
- Jakarta stack: `jakarta.*`

Jangan campur sembarangan di satu module runtime, karena classpath bisa kacau.

---

## 5.4 Maven Example — Jakarta SAAJ API + Implementation

Contoh umum untuk Jakarta SAAJ:

```xml
<dependencies>
  <dependency>
    <groupId>jakarta.xml.soap</groupId>
    <artifactId>jakarta.xml.soap-api</artifactId>
    <version>3.0.2</version>
  </dependency>

  <dependency>
    <groupId>com.sun.xml.messaging.saaj</groupId>
    <artifactId>saaj-impl</artifactId>
    <version>3.0.4</version>
  </dependency>

  <dependency>
    <groupId>jakarta.activation</groupId>
    <artifactId>jakarta.activation-api</artifactId>
    <version>2.1.3</version>
  </dependency>
</dependencies>
```

Version harus disesuaikan dengan platform/container yang dipakai. Kalau berjalan di application server Jakarta EE, sebagian API/implementation mungkin sudah disediakan container. Kalau standalone Spring Boot/CLI, dependency harus eksplisit.

### 5.5 Rule Dependency

```text
Standalone app:
  API + implementation harus ada.

Jakarta EE server:
  cek apakah spec masih disediakan platform/server.

Java 11+:
  jangan mengandalkan JDK menyediakan JAXB/JAX-WS/SAAJ.

Migration:
  jangan campur javax dan jakarta dalam generated code yang sama.
```

---

## 6. SAAJ Basic: Membuat SOAP Message Manual

Contoh Jakarta SAAJ:

```java
import jakarta.xml.soap.MessageFactory;
import jakarta.xml.soap.SOAPBody;
import jakarta.xml.soap.SOAPElement;
import jakarta.xml.soap.SOAPEnvelope;
import jakarta.xml.soap.SOAPMessage;
import jakarta.xml.soap.SOAPPart;

public class SaajCreateMessageExample {

    public static SOAPMessage createSubmitRequest(String caseId) throws Exception {
        MessageFactory messageFactory = MessageFactory.newInstance();
        SOAPMessage message = messageFactory.createMessage();

        SOAPPart soapPart = message.getSOAPPart();
        SOAPEnvelope envelope = soapPart.getEnvelope();

        envelope.addNamespaceDeclaration("doc", "urn:agency:document:v1");

        SOAPBody body = envelope.getBody();
        SOAPElement request = body.addChildElement("SubmitDocumentRequest", "doc");

        SOAPElement caseIdElement = request.addChildElement("caseId", "doc");
        caseIdElement.addTextNode(caseId);

        SOAPElement fileName = request.addChildElement("fileName", "doc");
        fileName.addTextNode("evidence.pdf");

        message.saveChanges();
        return message;
    }
}
```

Ini berguna untuk memahami struktur, tetapi untuk service yang contract-nya jelas, generated JAX-WS/JAXB lebih maintainable.

---

## 7. SAAJ Attachment Manual

Contoh menambahkan attachment:

```java
import jakarta.activation.DataHandler;
import jakarta.activation.FileDataSource;
import jakarta.xml.soap.AttachmentPart;
import jakarta.xml.soap.MessageFactory;
import jakarta.xml.soap.SOAPBody;
import jakarta.xml.soap.SOAPElement;
import jakarta.xml.soap.SOAPMessage;

import java.io.File;

public class SaajAttachmentExample {

    public static SOAPMessage createMessageWithAttachment(File pdf) throws Exception {
        MessageFactory messageFactory = MessageFactory.newInstance();
        SOAPMessage message = messageFactory.createMessage();

        SOAPBody body = message.getSOAPBody();
        SOAPElement request = body.addChildElement(
                "SubmitDocumentRequest",
                "doc",
                "urn:agency:document:v1"
        );

        request.addChildElement("caseId", "doc").addTextNode("CASE-2026-0001");
        request.addChildElement("fileName", "doc").addTextNode(pdf.getName());

        SOAPElement attachmentRef = request.addChildElement("attachmentRef", "doc");
        attachmentRef.addTextNode("cid:evidence-pdf");

        AttachmentPart attachment = message.createAttachmentPart();
        attachment.setDataHandler(new DataHandler(new FileDataSource(pdf)));
        attachment.setContentId("<evidence-pdf>");
        attachment.setContentType("application/pdf");

        message.addAttachmentPart(attachment);
        message.saveChanges();
        return message;
    }
}
```

Catatan:

- `Content-ID` harus cocok dengan reference di envelope.
- Format reference bisa berbeda antar partner.
- Untuk MTOM, biasanya jangan manual membuat `xop:Include` kecuali benar-benar low-level.
- Generated JAX-WS + MTOM lebih aman untuk interop.

---

## 8. SAAJ Reading Attachments

```java
import jakarta.xml.soap.AttachmentPart;
import jakarta.xml.soap.SOAPMessage;

import java.io.InputStream;
import java.util.Iterator;

public class SaajReadAttachmentExample {

    public static void readAttachments(SOAPMessage message) throws Exception {
        Iterator<?> iterator = message.getAttachments();

        while (iterator.hasNext()) {
            AttachmentPart part = (AttachmentPart) iterator.next();

            String contentId = part.getContentId();
            String contentType = part.getContentType();
            int size = part.getSize();

            System.out.println("Attachment: " + contentId + " " + contentType + " size=" + size);

            try (InputStream in = part.getDataHandler().getInputStream()) {
                // Stream to disk/storage/virus scanner, not to byte[] for large files.
                consumeSafely(in);
            }
        }
    }

    private static void consumeSafely(InputStream in) {
        // Implement bounded copy with max size, checksum, and error handling.
    }
}
```

Production warning:

> Jangan memanggil API yang secara tidak sengaja membaca seluruh attachment ke memory untuk payload besar.

Selalu stream ke:

- temporary file,
- object storage,
- virus scanner,
- checksum calculator,
- bounded buffer,
- content inspection pipeline.

---

## 9. MTOM in JAX-WS Server

Dalam JAX-WS/Jakarta XML Web Services, MTOM biasanya diaktifkan dengan annotation.

Contoh Jakarta style:

```java
import jakarta.activation.DataHandler;
import jakarta.jws.WebMethod;
import jakarta.jws.WebService;
import jakarta.xml.ws.soap.MTOM;

@WebService(
    serviceName = "DocumentSubmissionService",
    portName = "DocumentSubmissionPort",
    targetNamespace = "urn:agency:document:v1"
)
@MTOM(enabled = true, threshold = 1024)
public class DocumentSubmissionEndpoint {

    @WebMethod
    public SubmitDocumentResponse submitDocument(SubmitDocumentRequest request) {
        DataHandler content = request.getContent();

        // Stream content safely to storage/scanner.
        // Do not convert blindly to byte[].

        return new SubmitDocumentResponse("ACCEPTED");
    }
}
```

DTO:

```java
import jakarta.activation.DataHandler;
import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.XmlMimeType;
import jakarta.xml.bind.annotation.XmlRootElement;

@XmlRootElement(name = "SubmitDocumentRequest", namespace = "urn:agency:document:v1")
@XmlAccessorType(XmlAccessType.FIELD)
public class SubmitDocumentRequest {

    @XmlElement(required = true)
    private String caseId;

    @XmlElement(required = true)
    private String fileName;

    @XmlElement(required = true)
    private String contentType;

    @XmlElement(required = true)
    private long declaredSize;

    @XmlElement(required = true)
    private String sha256;

    @XmlElement(required = true)
    @XmlMimeType("application/octet-stream")
    private DataHandler content;

    public String getCaseId() {
        return caseId;
    }

    public DataHandler getContent() {
        return content;
    }
}
```

Kenapa `DataHandler`, bukan `byte[]`?

- `byte[]` cenderung membuat seluruh file masuk heap.
- `DataHandler` memberi abstraction untuk stream/source data.
- Provider bisa mengoptimalkan MTOM lebih baik.

Namun perlu diingat:

> `DataHandler` tidak otomatis menjamin zero-copy streaming end-to-end. Provider, container, handler, security layer, logging layer, dan transport bisa tetap melakukan buffering.

---

## 10. MTOM in JAX-WS Client

Generated client biasanya menghasilkan port proxy. MTOM bisa diaktifkan saat create port atau via binding.

Contoh konsep:

```java
import jakarta.xml.ws.BindingProvider;
import jakarta.xml.ws.soap.MTOMFeature;

public class DocumentClient {

    public SubmitDocumentResponse submit(DocumentSubmissionService service,
                                         SubmitDocumentRequest request) {

        DocumentSubmissionPort port = service.getDocumentSubmissionPort(
                new MTOMFeature(true, 1024)
        );

        BindingProvider bp = (BindingProvider) port;
        bp.getRequestContext().put(
                BindingProvider.ENDPOINT_ADDRESS_PROPERTY,
                "https://partner.example.org/ws/document"
        );

        return port.submitDocument(request);
    }
}
```

Request dengan file:

```java
import jakarta.activation.DataHandler;
import jakarta.activation.FileDataSource;

import java.io.File;

public class RequestFactory {

    public static SubmitDocumentRequest fromFile(String caseId, File file, String sha256) {
        SubmitDocumentRequest request = new SubmitDocumentRequest();
        request.setCaseId(caseId);
        request.setFileName(file.getName());
        request.setContentType("application/pdf");
        request.setDeclaredSize(file.length());
        request.setSha256(sha256);
        request.setContent(new DataHandler(new FileDataSource(file)));
        return request;
    }
}
```

### 10.1 Timeout Tetap Wajib

Binary upload/download memperbesar risiko koneksi menggantung.

Set timeout:

```java
BindingProvider bp = (BindingProvider) port;

bp.getRequestContext().put("com.sun.xml.ws.connect.timeout", 10_000);
bp.getRequestContext().put("com.sun.xml.ws.request.timeout", 120_000);
```

Nama property timeout bisa provider-specific. Untuk Metro/JAX-WS RI, property di atas umum ditemukan. Untuk stack lain, cek dokumentasi runtime.

Design rule:

```text
connect timeout pendek
read/request timeout sesuai ukuran payload
retry hanya untuk operasi idempotent atau punya idempotency key
```

---

## 11. MTOM Threshold

`threshold` menentukan ukuran minimum binary agar dikirim sebagai attachment, bukan inline base64.

Contoh:

```java
@MTOM(enabled = true, threshold = 4096)
```

Makna praktis:

```text
binary <= threshold  -> mungkin inline
binary > threshold   -> kandidat MTOM attachment
```

Namun jangan terlalu menyederhanakan. Provider bisa punya behavior berbeda tergantung:

- mapping type (`byte[]` vs `DataHandler`),
- content type,
- JAXB binding,
- WS-Policy,
- client/server feature,
- handler chain,
- security layer,
- runtime implementation.

Threshold rendah:

- lebih banyak MIME parts,
- overhead boundary meningkat,
- tapi menghindari base64 untuk file kecil-menengah.

Threshold tinggi:

- lebih sedikit multipart,
- tapi binary menengah bisa tetap inline.

Rule of thumb:

```text
1 KB - 4 KB: sering jadi default awal
16 KB - 64 KB: bisa masuk akal kalau banyak file kecil
> 1 MB: terlalu tinggi untuk kebanyakan enterprise document transfer
```

Tetapkan threshold berdasarkan:

- distribusi ukuran dokumen,
- proxy/gateway behavior,
- memory profile,
- partner interop,
- security scanning,
- latency.

---

## 12. WSDL/XSD Design untuk MTOM

Di XSD, binary biasanya tetap didefinisikan sebagai `xs:base64Binary`.

```xml
<xs:complexType name="SubmitDocumentRequest">
  <xs:sequence>
    <xs:element name="caseId" type="xs:string"/>
    <xs:element name="fileName" type="xs:string"/>
    <xs:element name="contentType" type="xs:string"/>
    <xs:element name="declaredSize" type="xs:long"/>
    <xs:element name="sha256" type="xs:string"/>
    <xs:element name="content" type="xs:base64Binary"/>
  </xs:sequence>
</xs:complexType>
```

Untuk membantu tooling menghasilkan `DataHandler`, kadang digunakan annotation `xmime:expectedContentTypes`:

```xml
<xs:element name="content"
            type="xs:base64Binary"
            xmime:expectedContentTypes="application/pdf"
            xmlns:xmime="http://www.w3.org/2005/05/xmlmime"/>
```

Tooling bisa menghasilkan:

```java
@XmlMimeType("application/pdf")
protected DataHandler content;
```

Atau jika tidak, bisa menghasilkan:

```java
protected byte[] content;
```

Dampaknya besar:

```text
byte[]       -> simple, tapi raw binary masuk heap
DataHandler  -> lebih cocok untuk large payload / streaming
```

### 12.1 Contract Metadata yang Sebaiknya Ada

Untuk attachment/document transfer, jangan hanya punya `content`.

Tambahkan metadata:

```xml
<fileName>evidence.pdf</fileName>
<contentType>application/pdf</contentType>
<declaredSize>1234567</declaredSize>
<sha256>...</sha256>
<documentType>EVIDENCE</documentType>
<correlationId>...</correlationId>
```

Kenapa?

- `fileName` untuk audit dan user-level trace.
- `contentType` untuk validation/scanning.
- `declaredSize` untuk limit enforcement.
- `sha256` untuk integrity check.
- `documentType` untuk business rule.
- `correlationId` untuk observability.

### 12.2 Jangan Percaya Metadata Begitu Saja

`contentType` dari client tidak boleh dipercaya penuh.

Perlu validate:

- declared content type,
- detected content type,
- magic bytes,
- extension,
- size limit,
- checksum,
- malware scan,
- document policy.

---

## 13. Message Shape: Inline vs MTOM Wire Format

Logical XML:

```xml
<doc:SubmitDocumentRequest xmlns:doc="urn:agency:document:v1">
  <doc:caseId>CASE-2026-0001</doc:caseId>
  <doc:fileName>evidence.pdf</doc:fileName>
  <doc:content>JVBERi0xLj...</doc:content>
</doc:SubmitDocumentRequest>
```

MTOM optimized SOAP body:

```xml
<doc:SubmitDocumentRequest xmlns:doc="urn:agency:document:v1">
  <doc:caseId>CASE-2026-0001</doc:caseId>
  <doc:fileName>evidence.pdf</doc:fileName>
  <doc:content>
    <xop:Include xmlns:xop="http://www.w3.org/2004/08/xop/include"
                 href="cid:content-abc123@example.org"/>
  </doc:content>
</doc:SubmitDocumentRequest>
```

MIME package:

```text
Content-Type: Multipart/Related;
  boundary="uuid:...";
  type="application/xop+xml";
  start="<root.message@cxf.apache.org>";
  start-info="text/xml"

--uuid:...
Content-Type: application/xop+xml; charset=UTF-8; type="text/xml"
Content-ID: <root.message@cxf.apache.org>

<soap:Envelope>...</soap:Envelope>

--uuid:...
Content-Type: application/pdf
Content-ID: <content-abc123@example.org>
Content-Transfer-Encoding: binary

%PDF-1.7...
--uuid:...--
```

Yang perlu dipahami:

- Partner bisa inspect raw wire dan melihat `xop:Include`.
- Logical application model tetap melihat `content` sebagai binary field.
- Logging SOAP body saja mungkin tidak menampilkan binary, tetapi bisa menampilkan CID.
- Jika gateway memecah/rewrite MIME, attachment bisa hilang.

---

## 14. Security Model untuk SOAP Attachments

## 14.1 Transport Security

Minimum:

```text
HTTPS/TLS wajib
```

Karena attachment bisa berisi data sensitif.

TLS melindungi in transit antara dua endpoint transport. Tapi jika message melewati intermediary yang terminate TLS, data terbuka di sana.

---

## 14.2 Message Security

WS-Security bisa menandatangani/encrypt SOAP message. Tetapi attachment membuat model lebih rumit.

Pertanyaan penting:

- Apakah hanya SOAP body yang ditandatangani?
- Apakah attachment ikut ditandatangani?
- Apakah attachment ikut dienkripsi?
- Apakah signature berlaku pada logical base64 data atau MIME part?
- Apakah intermediary boleh mengubah MIME packaging?
- Apakah MTOM optimization dipertahankan setelah security processing?

Production warning:

> Jangan menganggap attachment aman hanya karena SOAP body signed. Binary part bisa saja tidak ikut signed/encrypted jika konfigurasi WS-Security salah.

### 14.3 Checksum sebagai Business Integrity

Walaupun ada TLS/signature, tetap bagus punya checksum di contract:

```xml
<sha256>8f14e45fceea167a5a36dedd4bea2543...</sha256>
```

Server melakukan:

```text
stream attachment -> calculate SHA-256 -> compare with declared checksum
```

Manfaat:

- deteksi corruption,
- audit trail,
- deduplication,
- evidence integrity,
- retry verification,
- storage validation.

Checksum bukan pengganti signature, tapi sangat berguna.

---

## 15. XML/Attachment Security Risk

## 15.1 XXE Tetap Relevan

SOAP envelope adalah XML. Maka XML parser hardening tetap wajib:

- disable external entity,
- disable external DTD,
- secure processing,
- entity expansion limit,
- external schema access restriction.

Walaupun binary ada di attachment, SOAP envelope tetap bisa diserang.

---

## 15.2 Zip Bomb / Document Bomb

Attachment bisa berupa ZIP, Office document, PDF, image, XML, atau archive nested.

Risiko:

- zip bomb,
- decompression bomb,
- huge image dimension,
- malicious PDF,
- macro/document exploit,
- XML inside attachment with XXE,
- archive path traversal,
- nested archive recursion.

Mitigasi:

- max raw size,
- max decompressed size,
- max file count,
- max nesting depth,
- allowlist MIME type,
- magic-byte validation,
- virus scanning,
- safe extraction path,
- quarantine workflow.

---

## 15.3 Logging Leak

SOAP attachment sangat rawan accidental leak.

Jangan log:

- full SOAP message dengan attachment,
- base64 content,
- MIME body,
- file content,
- full document metadata sensitif.

Log cukup:

```text
correlationId=...
caseId=...
documentType=...
fileNameSanitized=...
contentType=application/pdf
declaredSize=1234567
actualSize=1234567
sha256Prefix=8f14e45f...
mtom=true
attachmentCount=1
```

Untuk audit, simpan checksum dan storage reference, bukan payload di application log.

---

## 16. Memory Model dan Performance Trap

## 16.1 Trap: `byte[]` di JAXB Model

```java
private byte[] content;
```

Untuk file 50 MB:

- raw byte array 50 MB,
- base64 string bisa 66+ MB,
- XML object/tree overhead,
- temporary buffers,
- logging buffers,
- HTTP client buffers,
- security buffers.

Total heap usage bisa beberapa kali ukuran file.

### Lebih baik:

```java
private DataHandler content;
```

Lalu stream:

```java
try (InputStream in = request.getContent().getInputStream()) {
    copyWithLimitAndDigest(in, outputStream, maxBytes, digest);
}
```

---

## 16.2 Trap: Handler Chain Membaca Seluruh Message

JAX-WS handler sering dipakai untuk logging:

```java
soapMessage.writeTo(byteArrayOutputStream);
```

Ini berbahaya untuk MTOM karena bisa:

- memuat seluruh MIME message ke memory,
- meng-inline attachment,
- mengganggu streaming,
- membocorkan payload ke log,
- menambah latency besar.

Safe logging handler harus:

- log metadata saja,
- tidak dump attachment,
- batasi ukuran output,
- redaksi field sensitif,
- skip binary element.

---

## 16.3 Trap: Retry Upload Besar Tanpa Idempotency

Client timeout setelah upload 80% selesai:

```text
Client -> upload request
Server -> menerima dan menyimpan file
Client -> timeout sebelum response diterima
Client -> retry
Server -> menyimpan duplicate
```

Solusi:

- idempotency key,
- checksum-based duplicate detection,
- request correlation id,
- server-side transaction state,
- response lookup by request id.

Contract:

```xml
<requestId>REQ-2026-000001</requestId>
<caseId>CASE-2026-0001</caseId>
<sha256>...</sha256>
```

Server behavior:

```text
if requestId already completed:
    return same response
if same caseId + sha256 already exists:
    apply duplicate policy
else:
    process normally
```

---

## 17. Streaming Copy with Limit and Digest

Contoh utility:

```java
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class AttachmentStreams {

    private AttachmentStreams() {}

    public static Result copyWithSha256AndLimit(
            InputStream rawInput,
            OutputStream output,
            long maxBytes
    ) throws IOException {
        MessageDigest digest = sha256();

        long copied = 0L;
        byte[] buffer = new byte[64 * 1024];

        try (DigestInputStream input = new DigestInputStream(rawInput, digest)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                copied += read;
                if (copied > maxBytes) {
                    throw new AttachmentTooLargeException(maxBytes, copied);
                }
                output.write(buffer, 0, read);
            }
        }

        return new Result(copied, HexFormat.of().formatHex(digest.digest()));
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    public record Result(long size, String sha256) {}

    public static class AttachmentTooLargeException extends IOException {
        public AttachmentTooLargeException(long maxBytes, long actualBytes) {
            super("Attachment exceeded maxBytes=" + maxBytes + ", actualBytes=" + actualBytes);
        }
    }
}
```

Untuk Java 8, ganti `record` dan `HexFormat`:

```java
private static String toHex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) {
        sb.append(String.format("%02x", b));
    }
    return sb.toString();
}
```

---

## 18. Receiving Attachment Safely: Workflow

Jangan langsung proses attachment di memory.

Workflow recommended:

```text
1. Validate SOAP metadata
2. Enforce authz: can caller submit document for this case?
3. Check declared size <= limit
4. Stream attachment to quarantine/temp storage
5. Calculate actual size + SHA-256 while streaming
6. Compare checksum
7. Detect MIME type/magic bytes
8. Virus/malware scan
9. Store final object
10. Persist metadata transactionally
11. Return accepted response
12. Async downstream processing if needed
```

Pseudo service:

```java
public SubmitDocumentResponse submitDocument(SubmitDocumentRequest request) {
    requireAllowedDocumentType(request.getDocumentType());
    requireAllowedContentType(request.getContentType());
    requireMaxDeclaredSize(request.getDeclaredSize());

    String tempObjectKey = storage.allocateTempKey(request.getCaseId());

    AttachmentStreams.Result result;
    try (InputStream in = request.getContent().getInputStream();
         OutputStream out = storage.openTempOutputStream(tempObjectKey)) {
        result = AttachmentStreams.copyWithSha256AndLimit(in, out, limits.maxBytes());
    }

    if (!result.sha256().equalsIgnoreCase(request.getSha256())) {
        storage.deleteTemp(tempObjectKey);
        throw new InvalidAttachmentException("Checksum mismatch");
    }

    scanner.scanOrThrow(tempObjectKey);

    String finalKey = storage.promote(tempObjectKey, request.getCaseId(), result.sha256());

    documentRepository.insert(DocumentMetadata.accepted(
            request.getCaseId(),
            sanitizeFileName(request.getFileName()),
            request.getContentType(),
            result.size(),
            result.sha256(),
            finalKey
    ));

    return new SubmitDocumentResponse("ACCEPTED");
}
```

---

## 19. File Name Handling

File name dari attachment adalah untrusted input.

Jangan gunakan langsung:

```java
Path path = uploadDir.resolve(request.getFileName()); // risky
```

Risiko:

- path traversal: `../../etc/passwd`,
- Windows path: `C:\...`,
- Unicode spoofing,
- control characters,
- overly long names,
- reserved names,
- HTML injection in UI,
- log injection.

Safe approach:

```java
public static String sanitizeFileName(String input) {
    if (input == null || input.isBlank()) {
        return "document.bin";
    }

    String normalized = input.replace('\\', '/');
    String base = normalized.substring(normalized.lastIndexOf('/') + 1);

    base = base.replaceAll("[\\p{Cntrl}]", "");
    base = base.replaceAll("[^a-zA-Z0-9._ -]", "_");
    base = base.trim();

    if (base.isEmpty()) {
        return "document.bin";
    }

    int max = 120;
    return base.length() <= max ? base : base.substring(0, max);
}
```

Untuk storage key, lebih baik jangan pakai filename sebagai identifier utama.

Gunakan:

```text
case/{caseId}/document/{documentId}/content
```

Filename hanya metadata display.

---

## 20. SOAP Handler untuk Attachment Metadata Logging

Contoh handler konseptual:

```java
import jakarta.xml.soap.SOAPMessage;
import jakarta.xml.ws.handler.MessageContext;
import jakarta.xml.ws.handler.soap.SOAPHandler;
import jakarta.xml.ws.handler.soap.SOAPMessageContext;
import jakarta.xml.namespace.QName;

import java.util.Collections;
import java.util.Iterator;
import java.util.Set;

public class SafeSoapMetadataLoggingHandler implements SOAPHandler<SOAPMessageContext> {

    @Override
    public boolean handleMessage(SOAPMessageContext context) {
        Boolean outbound = (Boolean) context.get(MessageContext.MESSAGE_OUTBOUND_PROPERTY);

        try {
            SOAPMessage message = context.getMessage();
            int attachmentCount = message.countAttachments();

            // Do not call message.writeTo(logStream) in production for attachment-heavy messages.
            System.out.println("soapDirection=" + (Boolean.TRUE.equals(outbound) ? "OUT" : "IN")
                    + " attachmentCount=" + attachmentCount);

            Iterator<?> attachments = message.getAttachments();
            while (attachments.hasNext()) {
                jakarta.xml.soap.AttachmentPart part =
                        (jakarta.xml.soap.AttachmentPart) attachments.next();

                System.out.println("attachment contentId=" + part.getContentId()
                        + " contentType=" + part.getContentType()
                        + " size=" + safeSize(part));
            }
        } catch (Exception e) {
            // Handler must not break business flow because logging failed.
            System.err.println("Failed to log SOAP metadata: " + e.getMessage());
        }

        return true;
    }

    private int safeSize(jakarta.xml.soap.AttachmentPart part) {
        try {
            return part.getSize();
        } catch (Exception e) {
            return -1;
        }
    }

    @Override
    public boolean handleFault(SOAPMessageContext context) {
        return handleMessage(context);
    }

    @Override
    public void close(MessageContext context) {}

    @Override
    public Set<QName> getHeaders() {
        return Collections.emptySet();
    }
}
```

Caveat:

- Bahkan `getSize()` bisa menyebabkan computation/provider behavior tertentu.
- Jangan inspect content stream di handler umum.
- Jangan dump SOAP message penuh.

---

## 21. Interoperability Checklist

Saat berintegrasi dengan partner SOAP attachment, tanyakan detail ini secara eksplisit.

### 21.1 SOAP Version

```text
SOAP 1.1 atau SOAP 1.2?
```

Content-Type berbeda:

- SOAP 1.1 sering `text/xml`
- SOAP 1.2 sering `application/soap+xml`

### 21.2 Attachment Mechanism

```text
Inline base64?
SwA?
MTOM/XOP?
```

Jangan berasumsi.

### 21.3 WSDL Policy

Apakah WSDL menyatakan MTOM policy?

Contoh policy fragment bisa menyatakan optimized MIME serialization. Tetapi banyak legacy partner tidak menyertakan policy lengkap, hanya dokumen integrasi eksternal.

### 21.4 Content-ID Format

```text
cid:abc
<abc>
abc@example.org
```

CID mismatch sering menyebabkan attachment tidak ditemukan.

### 21.5 Content Type

```text
application/pdf
application/octet-stream
image/tiff
application/zip
text/xml
```

Partner kadang strict terhadap content type.

### 21.6 Multiple Attachments

Apakah support banyak attachment?

```xml
<documents>
  <document>...</document>
  <document>...</document>
</documents>
```

Atau satu request satu document?

### 21.7 Size Limit

Limit bisa ada di banyak layer:

- client runtime,
- app server,
- reverse proxy,
- API gateway,
- load balancer,
- WAF,
- partner endpoint,
- XML parser,
- attachment parser,
- disk temp directory,
- object storage policy.

### 21.8 Security Requirement

- TLS version?
- mutual TLS?
- WS-Security UsernameToken?
- X.509 signature?
- encryption?
- timestamp?
- replay protection?
- attachment signed/encrypted?

### 21.9 Fault Behavior

Jika attachment corrupt, response apa?

- SOAP Fault?
- business response status `REJECTED`?
- HTTP 400/500?
- async rejection callback?

### 21.10 Retry and Idempotency

- boleh retry?
- operation idempotent?
- request id wajib?
- duplicate file policy?

---

## 22. Observability untuk SOAP Attachments

Minimum metrics:

```text
soap_attachment_request_count{operation,partner,status}
soap_attachment_bytes_received_total{operation,partner}
soap_attachment_bytes_sent_total{operation,partner}
soap_attachment_size_histogram{operation,partner}
soap_attachment_processing_duration_seconds{operation,partner,stage}
soap_attachment_scan_failures_total{partner,reason}
soap_attachment_checksum_mismatch_total{partner}
soap_attachment_mtom_enabled_count{partner}
soap_attachment_inline_base64_count{partner}
soap_fault_count{operation,partner,fault_code}
```

Log structured:

```json
{
  "event": "soap_attachment_received",
  "correlationId": "CORR-...",
  "requestId": "REQ-...",
  "partner": "AGENCY_A",
  "operation": "SubmitDocument",
  "caseId": "CASE-2026-0001",
  "attachmentCount": 1,
  "declaredSize": 1234567,
  "actualSize": 1234567,
  "contentType": "application/pdf",
  "sha256Prefix": "8f14e45f",
  "mtom": true,
  "durationMs": 842
}
```

Trace spans:

```text
SOAP receive
  -> parse envelope
  -> stream attachment
  -> checksum
  -> virus scan
  -> storage write
  -> DB metadata insert
  -> response send
```

---

## 23. Common Production Incidents

## 23.1 Works in DEV, Fails in UAT Because Gateway Blocks Multipart

Symptom:

```text
HTTP 415 Unsupported Media Type
HTTP 400 Bad Request
Partner says request malformed
```

Cause:

- API gateway not configured for `multipart/related`.
- WAF expects JSON/XML only.
- Content-Type with boundary rejected.

Fix:

- allow `multipart/related`,
- allow `application/xop+xml`,
- preserve MIME boundary,
- disable transformation/compression that breaks MIME.

---

## 23.2 MTOM Enabled but Still Inline Base64

Cause candidates:

- client did not enable MTOM,
- server did not enable MTOM,
- WSDL policy absent,
- field generated as `byte[]`,
- threshold too high,
- provider config wrong,
- handler/security layer forced inlining.

Debug:

- inspect raw HTTP wire in lower environment,
- check Content-Type: `multipart/related`,
- check `xop:Include`,
- check generated model type,
- check MTOM feature on both sides.

---

## 23.3 OutOfMemoryError During Upload

Cause:

- `byte[]` mapping,
- full SOAP logging,
- DOM/SAAJ full tree,
- attachment buffered to heap,
- WS-Security signing entire large payload,
- multiple concurrent uploads.

Fix:

- use `DataHandler`,
- stream to disk/storage,
- disable body dump logging,
- cap concurrency,
- use temp file threshold,
- limit max payload,
- profile heap allocation.

---

## 23.4 Checksum Mismatch

Cause:

- partner computes checksum over base64 text, not raw bytes,
- line-ending transformation,
- encoding confusion,
- compression applied before/after checksum,
- wrong file selected,
- attachment truncated.

Contract must specify:

```text
checksum algorithm: SHA-256
checksum input: raw binary bytes before MTOM/XOP packaging
hex lowercase/uppercase accepted: yes/no
```

---

## 23.5 Attachment Lost After ESB Mediation

Cause:

- ESB reads SOAP envelope but drops MIME parts,
- transformation not MTOM-aware,
- intermediary reserializes SOAP as plain XML,
- `xop:Include` reference becomes dangling.

Fix:

- configure ESB MTOM support,
- avoid intermediary transformation,
- test end-to-end wire shape,
- use reference-based transfer if intermediary cannot preserve MTOM.

---

## 24. Testing Strategy

## 24.1 Unit Test Contract Mapping

Test JAXB/JAX-WS model shape:

- field maps to `xs:base64Binary`,
- generated Java type is `DataHandler`,
- `@XmlMimeType` exists if expected,
- no accidental `byte[]` for large document field.

## 24.2 Integration Test Raw Wire

Assert response/request content type:

```text
multipart/related
application/xop+xml
xop:Include
Content-ID
```

Do not only test Java object response. Test wire.

## 24.3 Size Tests

Test matrix:

| Size | Expected |
|---:|---|
| 0 byte | reject or accept based on business rule |
| 1 KB | maybe inline or MTOM depending threshold |
| threshold - 1 | expected behavior |
| threshold + 1 | expected MTOM |
| max size | accept |
| max size + 1 | reject gracefully |
| huge payload | no OOM, controlled failure |

## 24.4 Security Tests

- malicious XML envelope with XXE,
- unsupported content type,
- mismatched checksum,
- wrong declared size,
- path traversal filename,
- zip bomb,
- duplicate request id,
- missing attachment,
- dangling `xop:Include`,
- extra unexpected attachment,
- corrupted MIME boundary.

## 24.5 Interop Test

Test with partner stack:

- Java Metro/CXF,
- .NET/WCF,
- SOAP UI/Postman where applicable,
- ESB/gateway path,
- real TLS/mTLS config,
- production-like proxy limits.

---

## 25. SOAP Attachment vs REST Multipart vs Object Storage

| Dimension | SOAP MTOM | REST multipart | Object storage reference |
|---|---|---|---|
| Legacy interoperability | Strong | Medium | Weak unless redesigned |
| WSDL contract | Strong | None | None/direct API contract |
| Binary efficiency | Good | Good | Excellent |
| Large file scalability | Medium | Medium/Good | Best |
| Message-level security | Possible but complex | Usually transport/security layer | Storage IAM/signature |
| Tooling complexity | High | Medium | Medium |
| Auditability | Good if designed | Good if designed | Very good with metadata |
| Partner requirement fit | High for SOAP ecosystems | Low/medium | Depends |

Modernization guideline:

```text
If partner contract is fixed SOAP: use MTOM safely.
If you own both sides: prefer reference-based transfer for large files.
If service is new and not SOAP-bound: REST multipart or object storage pattern is usually simpler.
```

---

## 26. Top 1% Design Heuristics

## 26.1 Treat Attachment Transfer as a Distributed Workflow

A file submission is not one method call. It is a workflow:

```text
receive -> validate -> persist -> scan -> register -> notify -> audit -> retry/reconcile
```

If you model it as `submit(byte[] file)`, you will miss failure states.

---

## 26.2 Separate Business Acceptance from Technical Receipt

For large files, consider response states:

```xml
<SubmitDocumentResponse>
  <requestId>REQ-001</requestId>
  <technicalStatus>RECEIVED</technicalStatus>
  <businessStatus>PENDING_VALIDATION</businessStatus>
</SubmitDocumentResponse>
```

Technical receipt means bytes arrived. Business acceptance means file passed validation/scanning/business rules.

---

## 26.3 Design for Duplicate and Late Responses

SOAP clients timeout. Servers may still process.

Therefore:

- request id is mandatory,
- operation should be idempotent where possible,
- duplicate response should be deterministic,
- storage should deduplicate by checksum where useful.

---

## 26.4 Do Not Log What You Cannot Afford to Leak

Attachment content is often more sensitive than metadata.

Default:

```text
Never log binary.
Never log base64.
Never log full SOAP message in prod.
```

Use redaction and metadata-only trace.

---

## 26.5 Make Size Limit Explicit at Every Layer

Define:

```text
max attachment size
max request size
max attachment count
max total batch size
max processing time
max concurrent uploads per partner
max temp storage usage
```

Then configure:

- app server,
- HTTP client,
- reverse proxy,
- gateway,
- WAF,
- JVM heap/direct memory,
- temp directory,
- storage lifecycle.

---

## 26.6 Prefer `DataHandler` for Large Binary Contract

Use `byte[]` only when:

- file is guaranteed small,
- memory impact is acceptable,
- interop requires it,
- performance tested under concurrency.

Use `DataHandler` when:

- file can be large,
- MTOM is expected,
- streaming matters,
- contract should not force heap allocation.

---

## 26.7 Verify Wire Format, Not Just Java Object

Many MTOM bugs are invisible at Java object layer.

Always inspect:

- HTTP `Content-Type`,
- MIME boundary,
- root part,
- `xop:Include`,
- attachment part headers,
- actual binary bytes,
- partner response.

---

## 27. Migration Notes: Java 8 to Java 25

## 27.1 From JDK-Bundled to Explicit Dependency

Java 8 apps might compile/run because APIs are in JDK. Java 11+ will fail unless dependencies are added.

Symptoms:

```text
ClassNotFoundException: javax.xml.soap.SOAPMessage
NoClassDefFoundError: javax/xml/ws/Service
package javax.xml.bind does not exist
```

Fix:

- add explicit JAXB/JAX-WS/SAAJ/Activation dependencies,
- choose javax or jakarta line,
- regenerate code if namespace changed,
- align app server/runtime.

---

## 27.2 javax to jakarta

Migration is not just import rename.

Need check:

- generated source package imports,
- WSDL tooling version,
- JAXB runtime version,
- JAX-WS runtime version,
- SAAJ implementation version,
- app server compatibility,
- transitive dependencies,
- handler classes,
- deployment descriptors,
- reflection config,
- test clients.

---

## 27.3 Jakarta EE 11 Caution

Jakarta EE 11 removed some older XML/SOAP-related specifications from the main platform. That does not mean SOAP/JAXB disappear from the world, but it means your platform/server may not provide them by default. Treat XML Binding, XML Web Services, and SOAP with Attachments as explicit stack choices.

---

## 28. Reference Implementation Awareness

Common Java SOAP/SAAJ stacks:

- Eclipse Metro / JAX-WS RI,
- Apache CXF,
- application server built-in stack,
- legacy Oracle/WebLogic stack,
- IBM/WebSphere stack,
- Spring integration around JAX-WS clients.

Behavior differences may include:

- timeout property names,
- MTOM threshold handling,
- temp file buffering,
- attachment streaming support,
- WS-Security integration,
- logging/debugging options,
- generated code style.

Top engineer habit:

> Treat SOAP runtime as infrastructure dependency, not invisible library. Pin versions, document behavior, and test wire-level interoperability.

---

## 29. Practical Blueprint: Document Submission over SOAP MTOM

## 29.1 Contract

Request:

```xml
<SubmitDocumentRequest>
  <requestId>REQ-2026-000001</requestId>
  <caseId>CASE-2026-0001</caseId>
  <documentType>EVIDENCE</documentType>
  <fileName>evidence.pdf</fileName>
  <contentType>application/pdf</contentType>
  <declaredSize>1234567</declaredSize>
  <sha256>...</sha256>
  <content>xs:base64Binary optimized by MTOM</content>
</SubmitDocumentRequest>
```

Response:

```xml
<SubmitDocumentResponse>
  <requestId>REQ-2026-000001</requestId>
  <documentId>DOC-2026-000999</documentId>
  <status>RECEIVED</status>
  <message>Document received and queued for validation</message>
</SubmitDocumentResponse>
```

Faults:

```text
InvalidRequestFault
UnauthorizedCaseFault
AttachmentTooLargeFault
ChecksumMismatchFault
UnsupportedContentTypeFault
MalwareDetectedFault
DuplicateRequestFault
SystemUnavailableFault
```

## 29.2 Runtime Design

```text
JAX-WS Endpoint
  -> authn/authz
  -> metadata validation
  -> DataHandler stream
  -> temp storage
  -> checksum
  -> virus scan
  -> final storage
  -> DB metadata
  -> audit event
  -> response
```

## 29.3 Failure Handling

| Failure | Response |
|---|---|
| Missing attachment | SOAP Fault / business reject |
| Attachment too large | modeled fault |
| Checksum mismatch | modeled fault, delete temp |
| Virus scan fail | business reject/quarantine |
| Storage temporary unavailable | retryable technical fault |
| DB insert fail after file stored | compensating delete or reconciliation job |
| Client timeout after success | idempotency response replay |

---

## 30. Anti-Patterns

## 30.1 `byte[]` Everywhere

```java
public Response upload(byte[] content)
```

This looks simple but destroys scalability.

## 30.2 Full SOAP Logging in Production

```java
message.writeTo(logOutputStream)
```

This can leak data and cause OOM.

## 30.3 No Checksum

Without checksum, you cannot confidently prove stored binary equals submitted binary.

## 30.4 No Idempotency

Without idempotency, timeout retry creates duplicate documents.

## 30.5 Trusting Content-Type

`application/pdf` can be a ZIP, script, or malicious file.

## 30.6 Treating MTOM as Guaranteed Streaming

MTOM optimizes wire format. It does not guarantee every layer streams safely.

## 30.7 Assuming Gateway Supports Multipart

Many XML/SOAP gateways were configured only for plain SOAP XML.

## 30.8 Signing Only Envelope While Ignoring Attachment

Security review must explicitly cover binary part.

---

## 31. Review Checklist

Before shipping SOAP attachment integration:

```text
[ ] Is attachment mechanism agreed? inline / SwA / MTOM / reference
[ ] Is SOAP version agreed? 1.1 / 1.2
[ ] Is WSDL/XSD stable and versioned?
[ ] Is binary field xs:base64Binary?
[ ] Does generated model use DataHandler for large files?
[ ] Is MTOM enabled on client and server?
[ ] Is raw wire verified as multipart/related with xop:Include?
[ ] Is max size enforced before memory explosion?
[ ] Is checksum required and verified over raw bytes?
[ ] Is content type allowlisted and detected?
[ ] Is virus/malware scanning integrated?
[ ] Is filename sanitized?
[ ] Is logging metadata-only?
[ ] Are SOAP faults modeled?
[ ] Is retry/idempotency designed?
[ ] Are timeout values configured?
[ ] Are gateway/WAF/proxy limits tested?
[ ] Are temp file/storage limits configured?
[ ] Is attachment included in signing/encryption if required?
[ ] Is Java 11+ dependency explicit?
[ ] Is javax/jakarta namespace consistent?
[ ] Are interop tests run with partner stack?
```

---

## 32. Key Takeaways

1. SOAP attachment handling is about **binary lifecycle**, not just SOAP syntax.
2. Inline base64 is simple but dangerous for large payloads.
3. MTOM/XOP optimizes binary wire format while preserving logical XML infoset.
4. SAAJ is low-level and useful for manual message/attachment work, but can create memory pressure.
5. For large files, prefer `DataHandler` over `byte[]`.
6. MTOM must be enabled and verified at wire level.
7. Attachment security includes TLS, optional message security, checksum, scanning, and logging discipline.
8. Retry without idempotency creates duplicates.
9. Gateways/proxies often break multipart SOAP if not configured.
10. Java 11+ requires explicit dependencies for SOAP/JAX-WS/JAXB/SAAJ stacks.

---

## 33. Latihan

### Latihan 1 — Wire Format Inspection

Buat client JAX-WS dengan MTOM enabled. Kirim file 10 KB dan 5 MB. Capture raw HTTP request di local proxy. Verifikasi:

- apakah request menjadi `multipart/related`,
- apakah ada `application/xop+xml`,
- apakah body berisi `xop:Include`,
- apakah attachment punya `Content-ID`,
- apakah file kecil inline atau attachment sesuai threshold.

### Latihan 2 — Byte Array vs DataHandler

Buat dua DTO:

```java
byte[] content
DataHandler content
```

Kirim file 20 MB dengan concurrency 10. Bandingkan:

- heap usage,
- GC pause,
- latency,
- request failure,
- wire format.

### Latihan 3 — Safe Receiver

Implementasikan receiver yang:

- stream attachment ke file sementara,
- enforce max 20 MB,
- hitung SHA-256,
- compare checksum,
- reject content type tidak dikenal,
- sanitize filename,
- log metadata only.

### Latihan 4 — Failure Matrix

Buat test untuk:

- missing attachment,
- corrupted MIME boundary,
- checksum mismatch,
- wrong content type,
- duplicate request id,
- client retry after timeout,
- gateway rejects multipart.

---

## 34. Glossary

**SAAJ**  
SOAP with Attachments API. API low-level untuk membuat/memanipulasi SOAP message dan attachment.

**MTOM**  
Message Transmission Optimization Mechanism. Mekanisme optimasi pengiriman binary dalam SOAP.

**XOP**  
XML-binary Optimized Packaging. Packaging yang merepresentasikan binary XML content sebagai MIME part dengan `xop:Include`.

**SwA**  
SOAP with Attachments. Pendekatan lama untuk mengirim SOAP envelope dengan MIME attachments.

**MIME multipart/related**  
Format MIME yang menggabungkan beberapa part terkait, misalnya SOAP envelope dan binary attachment.

**DataHandler**  
Abstraction dari Jakarta Activation untuk data dengan content type, sering digunakan oleh JAXB/JAX-WS untuk binary attachment.

**Content-ID**  
Identifier MIME part yang direferensikan oleh SOAP envelope atau XOP include.

**Inline base64**  
Binary encoded sebagai text base64 langsung di XML element.

**Threshold**  
Batas ukuran untuk menentukan apakah binary di-inline atau dioptimasi sebagai attachment.

---

## 35. Referensi Resmi dan Lanjutan

- Jakarta SOAP with Attachments Specification.
- Jakarta XML Web Services Specification.
- Jakarta XML Binding Specification.
- Jakarta Activation API.
- W3C SOAP Message Transmission Optimization Mechanism.
- W3C XML-binary Optimized Packaging.
- W3C SOAP 1.1 and SOAP 1.2.
- Eclipse Metro SAAJ/JAX-WS documentation.
- Apache CXF MTOM documentation.
- OpenJDK JEP 320: Remove the Java EE and CORBA Modules.
- OWASP guidance for XML and file upload security.

---

## 36. Penutup

SOAP attachment adalah area yang terlihat kecil tetapi sangat sering menjadi sumber incident: OOM, timeout, duplicate file, gateway rejection, attachment hilang, checksum mismatch, atau data sensitif bocor ke log.

Engineer yang kuat tidak hanya tahu `@MTOM`. Engineer yang kuat memahami bahwa binary payload adalah lifecycle:

```text
contract -> wire format -> parser -> memory -> storage -> integrity -> security -> retry -> audit
```

Di part berikutnya kita akan masuk ke **WS-* Interoperability Field Guide**: WS-Addressing, WS-Security, WS-Policy, WS-ReliableMessaging overview, serta batas antara standar dan vendor-specific behavior.

Status seri: belum selesai. Part ini adalah Part 27 dari 34.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 26 — SOAP Faults, Errors & Resilience](./learn-java-json-xml-soap-connectors-enterprise-integration-part-026.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration — Part 28  ](./learn-java-json-xml-soap-connectors-enterprise-integration-part-028.md)

</div>