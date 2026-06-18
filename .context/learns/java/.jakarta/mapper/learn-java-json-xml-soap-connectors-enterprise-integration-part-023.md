# learn-java-json-xml-soap-connectors-enterprise-integration — Part 23
# WSDL Deep Dive: Contract, Types, Messages, Port Types, Bindings, Services, and Evolution

> Seri: Java JSON, XML, SOAP Legacy, dan Jakarta Connectors untuk Java 8–25  
> Bagian: 23 dari 34  
> Status seri: belum selesai  
> Fokus: memahami WSDL sebagai kontrak service formal, bukan sekadar file XML hasil generate dari tool.

---

## 0. Tujuan Bagian Ini

Setelah bagian sebelumnya, kita sudah punya mental model SOAP: SOAP adalah message framework dengan `Envelope`, `Header`, `Body`, `Fault`, processing model, dan binding ke transport seperti HTTP.

Bagian ini masuk ke lapisan yang lebih menentukan dalam enterprise integration:

> **WSDL adalah kontrak formal yang menjelaskan apa yang dapat dipanggil, data apa yang ditukar, bagaimana pesan dibentuk, protocol/binding apa yang digunakan, dan endpoint mana yang tersedia.**

Banyak engineer bisa generate client dari WSDL dengan `wsimport`, tetapi belum tentu bisa:

1. membaca WSDL secara manual,
2. membedakan abstract contract dan concrete transport,
3. memahami kenapa generated Java model berubah saat WSDL berubah,
4. melihat risiko compatibility sebelum production incident,
5. men-debug mismatch SOAP action, namespace, wrapper element, atau binding style,
6. mendesain strategi evolusi WSDL tanpa mematahkan consumer lama.

Target bagian ini adalah membuat kita bisa memperlakukan WSDL sebagai **artifact arsitektural**, bukan file misterius dari vendor.

---

## 1. Mental Model Besar: WSDL Itu Bukan XML Biasa

WSDL adalah XML, tetapi yang penting bukan XML-nya. Yang penting adalah perannya sebagai **service contract**.

Secara konseptual, WSDL menjawab pertanyaan berikut:

```text
1. Data apa yang boleh lewat?
   -> types / XSD

2. Message apa yang ditukar?
   -> message

3. Operasi logis apa yang tersedia?
   -> portType / operation

4. Operasi itu dikirim memakai protocol/message format apa?
   -> binding

5. Endpoint fisiknya di mana?
   -> service / port / address
```

Jadi WSDL menggabungkan dua dunia:

```text
Abstract contract
  - types
  - messages
  - portType / operations

Concrete contract
  - binding
  - service
  - port
  - endpoint address
```

Pemisahan ini sangat penting.

Abstract contract menjelaskan **apa** yang dilakukan service. Concrete contract menjelaskan **bagaimana dan ke mana** pesan dikirim.

Kesalahan umum engineer adalah menganggap WSDL hanya URL endpoint. Padahal endpoint address hanyalah bagian paling akhir. Yang lebih penting adalah bentuk message, namespace, wrapper, binding style, dan type system.

---

## 2. WSDL 1.1 vs WSDL 2.0: Kenapa Kita Fokus WSDL 1.1?

Secara historis ada WSDL 1.1 dan WSDL 2.0.

WSDL 1.1 adalah spesifikasi lama dari 2001 dan sangat dominan dalam ekosistem SOAP enterprise. Banyak tooling Java/JAX-WS/Jakarta XML Web Services, .NET legacy, IBM, Oracle, SAP, government integration, dan banking integration masih berbasis WSDL 1.1.

WSDL 2.0 adalah rekomendasi W3C yang lebih formal dan memperbaiki beberapa model WSDL 1.1. Di WSDL 2.0, istilah `portType` berubah menjadi `interface`, dan struktur modelnya lebih konsisten. Namun dalam praktik enterprise SOAP legacy, WSDL 1.1 jauh lebih sering ditemukan.

Untuk menjadi engineer yang kuat di dunia Java enterprise, kita perlu:

- sangat fasih membaca WSDL 1.1,
- memahami perbedaan konseptual WSDL 2.0,
- tetapi tidak mengasumsikan semua sistem modern sudah pindah ke WSDL 2.0.

Dalam seri ini, fokus utama adalah **WSDL 1.1**, karena itu yang paling sering muncul di JAX-WS/Jakarta XML Web Services production.

Referensi resmi:

- W3C WSDL 1.1: https://www.w3.org/TR/wsdl.html
- W3C WSDL 2.0: https://www.w3.org/TR/wsdl20/
- Jakarta XML Web Services 4.0: https://jakarta.ee/specifications/xml-web-services/4.0/

---

## 3. Struktur Dasar WSDL 1.1

Sebuah WSDL 1.1 biasanya memiliki struktur besar seperti ini:

```xml
<definitions
    name="ExampleService"
    targetNamespace="https://example.com/services/customer"
    xmlns="http://schemas.xmlsoap.org/wsdl/"
    xmlns:tns="https://example.com/services/customer"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">

    <types>
        <!-- XSD schema definitions/imports -->
    </types>

    <message name="GetCustomerRequest">
        <!-- message parts -->
    </message>

    <message name="GetCustomerResponse">
        <!-- message parts -->
    </message>

    <portType name="CustomerPortType">
        <operation name="getCustomer">
            <input message="tns:GetCustomerRequest"/>
            <output message="tns:GetCustomerResponse"/>
            <fault name="CustomerFault" message="tns:CustomerFaultMessage"/>
        </operation>
    </portType>

    <binding name="CustomerSoapBinding" type="tns:CustomerPortType">
        <!-- SOAP binding detail -->
    </binding>

    <service name="CustomerService">
        <port name="CustomerPort" binding="tns:CustomerSoapBinding">
            <soap:address location="https://api.example.com/customer"/>
        </port>
    </service>

</definitions>
```

Setiap elemen punya fungsi berbeda. Jangan baca WSDL dari atas ke bawah seperti file konfigurasi biasa. Bacalah sebagai graph.

```text
service.port
  -> binding
      -> portType
          -> operation
              -> message
                  -> part
                      -> XSD element/type
```

Saat debugging SOAP client, jalur referensi ini jauh lebih penting daripada urutan fisik XML.

---

## 4. `definitions`: Root Contract dan Namespace Hub

Elemen root WSDL 1.1 adalah `definitions`.

Contoh:

```xml
<definitions
    name="CustomerService"
    targetNamespace="https://example.com/customer/wsdl"
    xmlns="http://schemas.xmlsoap.org/wsdl/"
    xmlns:tns="https://example.com/customer/wsdl"
    xmlns:cus="https://example.com/customer/schema"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">
```

Beberapa atribut penting:

| Atribut | Makna |
|---|---|
| `name` | Nama dokumen/service description. Tidak selalu sama dengan nama service runtime. |
| `targetNamespace` | Namespace utama untuk artifacts WSDL seperti message, portType, binding, service. |
| `xmlns` default | Biasanya namespace WSDL: `http://schemas.xmlsoap.org/wsdl/`. |
| `xmlns:tns` | Prefix umum untuk target namespace WSDL sendiri. |
| `xmlns:xsd` | Prefix XML Schema. |
| `xmlns:soap` | Prefix extension binding SOAP 1.1. |

Kesalahan umum:

```text
Menganggap prefix adalah identitas kontrak.
```

Padahal prefix hanya alias lokal. Identitas sebenarnya adalah namespace URI.

Dua WSDL ini secara namespace bisa ekuivalen:

```xml
xmlns:tns="https://example.com/customer/wsdl"
```

```xml
xmlns:abc="https://example.com/customer/wsdl"
```

Prefix berubah, namespace tetap sama. Tooling yang benar membaca QName, bukan string prefix literal.

---

## 5. QName: Konsep Kecil yang Menentukan Segalanya

SOAP/WSDL/XSD sangat bergantung pada QName: **qualified name**.

QName terdiri dari:

```text
namespace URI + local name
```

Contoh:

```xml
tns:GetCustomerRequest
```

Kalau `tns` menunjuk ke:

```text
https://example.com/customer/wsdl
```

Maka QName-nya adalah:

```text
{https://example.com/customer/wsdl}GetCustomerRequest
```

Ini penting karena dua elemen dengan nama lokal sama tetapi namespace berbeda adalah dua hal berbeda.

```text
{https://agency-a.example/schema}Application
{https://agency-b.example/schema}Application
```

Keduanya sama-sama `Application`, tetapi bukan tipe yang sama.

Dalam SOAP legacy, banyak bug terjadi karena:

- namespace request body salah,
- wrapper element salah namespace,
- generated client pakai namespace lama,
- vendor mengubah targetNamespace tanpa bilang,
- XSD import menunjuk namespace yang sama tetapi lokasi berbeda,
- environment UAT/PROD memakai WSDL berbeda tetapi namespace terlihat mirip.

Top 1% engineer tidak hanya melihat nama tag. Mereka melihat QName.

---

## 6. `types`: XSD sebagai Data Contract

Elemen `types` berisi definisi tipe data. Biasanya memakai XML Schema/XSD.

Contoh:

```xml
<types>
    <xsd:schema
        targetNamespace="https://example.com/customer/schema"
        elementFormDefault="qualified">

        <xsd:element name="GetCustomerRequest" type="cus:GetCustomerRequestType"/>

        <xsd:complexType name="GetCustomerRequestType">
            <xsd:sequence>
                <xsd:element name="customerId" type="xsd:string"/>
            </xsd:sequence>
        </xsd:complexType>

        <xsd:element name="GetCustomerResponse" type="cus:GetCustomerResponseType"/>

        <xsd:complexType name="GetCustomerResponseType">
            <xsd:sequence>
                <xsd:element name="customerId" type="xsd:string"/>
                <xsd:element name="name" type="xsd:string"/>
                <xsd:element name="status" type="xsd:string" minOccurs="0"/>
            </xsd:sequence>
        </xsd:complexType>

    </xsd:schema>
</types>
```

`types` menjawab:

```text
Payload XML sahnya seperti apa?
Field apa yang wajib?
Field apa yang optional?
Urutannya bagaimana?
Namespace-nya apa?
Tipe datanya apa?
```

Dalam SOAP document/literal, bagian `types` sering lebih penting daripada `message`, karena message biasanya hanya menunjuk ke global element XSD.

---

## 7. Inline Schema vs External Schema

Ada dua pola umum.

### 7.1 Inline Schema

XSD ditulis langsung di dalam WSDL:

```xml
<types>
    <xsd:schema targetNamespace="https://example.com/schema">
        ...
    </xsd:schema>
</types>
```

Kelebihan:

- satu file lebih mudah dibagikan,
- consumer tidak perlu resolve banyak file,
- cocok untuk kontrak kecil.

Kekurangan:

- sulit reuse antar service,
- WSDL menjadi besar,
- perubahan tipe shared bisa tersebar,
- versioning schema lebih sulit.

### 7.2 External Schema Import

WSDL mengimpor XSD external:

```xml
<types>
    <xsd:schema>
        <xsd:import
            namespace="https://example.com/customer/schema"
            schemaLocation="customer.xsd"/>
    </xsd:schema>
</types>
```

Kelebihan:

- schema bisa reuse,
- modular,
- contract governance lebih rapi,
- cocok untuk banyak service dengan vocabulary sama.

Kekurangan:

- consumer/tooling harus bisa resolve import,
- relatif path sering rusak,
- environment URL bisa bocor ke generated code,
- build CI harus menyimpan semua artifact kontrak.

Praktik kuat:

```text
Jangan bergantung pada runtime URL WSDL vendor untuk build production.
Vendor WSDL/XSD harus di-pin ke repository atau artifact registry.
```

Jika client Java selalu generate dari URL live vendor, build menjadi tidak reproducible. Vendor bisa mengubah WSDL tanpa version bump dan build kita berubah diam-diam.

---

## 8. `message`: Bentuk Pesan Abstrak

Elemen `message` mendefinisikan pesan abstrak yang masuk/keluar dari operasi.

Contoh document/literal umum:

```xml
<message name="GetCustomerInput">
    <part name="parameters" element="cus:GetCustomerRequest"/>
</message>

<message name="GetCustomerOutput">
    <part name="parameters" element="cus:GetCustomerResponse"/>
</message>
```

Setiap `message` punya satu atau lebih `part`.

Ada dua gaya part yang sering terlihat:

### 8.1 Part dengan `element`

```xml
<part name="parameters" element="cus:GetCustomerRequest"/>
```

Ini menunjuk ke global XSD element.

Pola ini umum untuk document/literal wrapped.

### 8.2 Part dengan `type`

```xml
<part name="customerId" type="xsd:string"/>
```

Ini menunjuk langsung ke XSD type.

Pola ini lebih sering terlihat pada RPC-style atau legacy style.

Untuk interoperability modern, document/literal dengan `element` biasanya lebih aman karena pesan XML memiliki root element eksplisit yang dapat divalidasi sebagai document.

---

## 9. `portType`: Interface Abstrak Service

`portType` adalah kumpulan operasi abstrak.

Contoh:

```xml
<portType name="CustomerPortType">
    <operation name="getCustomer">
        <input message="tns:GetCustomerInput"/>
        <output message="tns:GetCustomerOutput"/>
        <fault name="CustomerFault" message="tns:CustomerFaultMessage"/>
    </operation>
</portType>
```

Mental model Java:

```text
WSDL portType ~ Java interface / service endpoint interface
WSDL operation ~ method
WSDL input message ~ method request payload
WSDL output message ~ method response payload
WSDL fault message ~ checked/service fault contract
```

Tetapi jangan disamakan sepenuhnya. WSDL adalah message contract; Java method hanyalah salah satu projection.

Contoh generated Java SEI bisa menjadi:

```java
@WebService(targetNamespace = "https://example.com/customer/wsdl", name = "CustomerPortType")
public interface CustomerPortType {

    @WebMethod(operationName = "getCustomer")
    @WebResult(name = "GetCustomerResponse", targetNamespace = "https://example.com/customer/schema")
    GetCustomerResponse getCustomer(
        @WebParam(name = "GetCustomerRequest", targetNamespace = "https://example.com/customer/schema")
        GetCustomerRequest request
    ) throws CustomerFault;
}
```

Mapping ini tidak bebas. Ia ditentukan oleh WSDL, binding style, wrapper pattern, namespace, message part, dan JAXB mapping.

---

## 10. Operation Message Exchange Patterns

WSDL 1.1 mendukung beberapa pola operasi.

### 10.1 Request-Response

Paling umum:

```xml
<operation name="getCustomer">
    <input message="tns:GetCustomerInput"/>
    <output message="tns:GetCustomerOutput"/>
</operation>
```

Makna:

```text
Client mengirim request, server mengembalikan response.
```

### 10.2 One-Way

```xml
<operation name="submitEvent">
    <input message="tns:SubmitEventInput"/>
</operation>
```

Makna:

```text
Client mengirim message; tidak ada output WSDL-level.
```

Hati-hati: one-way bukan berarti pasti asynchronous secara network/runtime. Transport HTTP masih bisa mengembalikan HTTP response minimal. Error handling juga lebih sulit.

### 10.3 Solicit-Response dan Notification

Ada pola lain di WSDL 1.1, tetapi jauh lebih jarang di JAX-WS enterprise biasa. Banyak tooling Java mainstream lebih fokus pada request-response dan one-way.

Prinsip desain:

```text
Jangan memakai one-way hanya karena ingin cepat.
Pakai one-way hanya jika failure semantics, retry, duplicate handling, dan observability sudah jelas.
```

---

## 11. `binding`: Dari Interface Abstrak ke Protocol Konkret

`binding` menghubungkan `portType` ke protocol/message format konkret.

Contoh SOAP 1.1 document/literal:

```xml
<binding name="CustomerSoapBinding" type="tns:CustomerPortType">
    <soap:binding
        style="document"
        transport="http://schemas.xmlsoap.org/soap/http"/>

    <operation name="getCustomer">
        <soap:operation soapAction="getCustomer"/>
        <input>
            <soap:body use="literal"/>
        </input>
        <output>
            <soap:body use="literal"/>
        </output>
        <fault name="CustomerFault">
            <soap:fault name="CustomerFault" use="literal"/>
        </fault>
    </operation>
</binding>
```

Bagian ini menjawab:

```text
PortType ini dikirim memakai SOAP atau bukan?
SOAP version mana?
HTTP transport atau lainnya?
Style document atau rpc?
Body literal atau encoded?
SOAPAction apa?
Header apa yang digunakan?
Fault encoding bagaimana?
```

Kalau `portType` adalah interface abstrak, `binding` adalah adapter protocol.

---

## 12. SOAP Binding Style: Document vs RPC

Dalam SOAP binding WSDL 1.1, `style` bisa `document` atau `rpc`.

### 12.1 Document Style

```xml
<soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
```

Document style berarti isi SOAP body diperlakukan sebagai XML document. Biasanya message part menunjuk ke global element XSD.

Contoh body:

```xml
<soapenv:Body>
    <cus:GetCustomerRequest xmlns:cus="https://example.com/customer/schema">
        <customerId>C-100</customerId>
    </cus:GetCustomerRequest>
</soapenv:Body>
```

Kelebihan:

- lebih natural dengan XSD,
- lebih interoperable,
- cocok untuk contract-first,
- validasi document lebih jelas,
- umum untuk WS-I Basic Profile style.

### 12.2 RPC Style

```xml
<soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
```

RPC style mencoba memodelkan SOAP call seperti pemanggilan procedure/method.

Contoh body kira-kira:

```xml
<soapenv:Body>
    <tns:getCustomer>
        <customerId>C-100</customerId>
    </tns:getCustomer>
</soapenv:Body>
```

RPC style lebih dekat dengan mental model method call, tetapi sering lebih bermasalah untuk interoperability dan compatibility jangka panjang.

Praktik modern SOAP enterprise biasanya lebih memilih:

```text
document/literal, sering dengan wrapped convention
```

---

## 13. `use`: Literal vs Encoded

`soap:body` memiliki atribut `use`.

### 13.1 Literal

```xml
<soap:body use="literal"/>
```

Literal berarti XML body mengikuti XSD literal yang didefinisikan di `types`.

Ini pola yang disukai untuk interoperable SOAP.

### 13.2 Encoded

```xml
<soap:body use="encoded" encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/>
```

Encoded memakai SOAP encoding rules. Ini banyak ditemukan di legacy RPC/encoded lama.

Masalah encoded:

- interoperability lebih buruk,
- XSD contract kurang eksplisit,
- tooling modern sering tidak suka,
- WS-I Basic Profile menghindari RPC/encoded untuk interoperability.

Rule praktis:

```text
Untuk integrasi baru, hindari encoded.
Untuk integrasi legacy, perlakukan encoded sebagai compatibility constraint, bukan desain ideal.
```

---

## 14. Empat Kombinasi Style/Use

Secara klasik ada empat kombinasi:

| Style | Use | Kualitas Praktis |
|---|---|---|
| document | literal | Paling umum dan paling aman untuk interoperability. |
| document | encoded | Jarang dan tidak disukai. |
| rpc | literal | Ada di beberapa legacy; lebih baik daripada rpc/encoded tetapi tetap kurang ideal. |
| rpc | encoded | Legacy berat; sering menyulitkan interoperabilitas. |

Dalam banyak sistem enterprise Java modern/legacy stabil, target yang paling defensible adalah:

```text
document/literal wrapped
```

---

## 15. Document/Literal Wrapped Pattern

Document/literal wrapped bukan sekadar `style=document` dan `use=literal`. Ia adalah convention yang membuat SOAP operation tetap terasa seperti method call, tetapi body tetap berupa XML document.

Pola umum:

```xml
<message name="GetCustomerInput">
    <part name="parameters" element="cus:GetCustomer"/>
</message>

<message name="GetCustomerOutput">
    <part name="parameters" element="cus:GetCustomerResponse"/>
</message>
```

XSD:

```xml
<xsd:element name="GetCustomer">
    <xsd:complexType>
        <xsd:sequence>
            <xsd:element name="customerId" type="xsd:string"/>
        </xsd:sequence>
    </xsd:complexType>
</xsd:element>

<xsd:element name="GetCustomerResponse">
    <xsd:complexType>
        <xsd:sequence>
            <xsd:element name="customer" type="cus:CustomerType"/>
        </xsd:sequence>
    </xsd:complexType>
</xsd:element>
```

SOAP body:

```xml
<soapenv:Body>
    <cus:GetCustomer xmlns:cus="https://example.com/customer/schema">
        <customerId>C-100</customerId>
    </cus:GetCustomer>
</soapenv:Body>
```

Mental model:

```text
Wrapper element = operation-shaped XML element.
Child elements = logical parameters.
Response wrapper = operationName + Response convention.
```

Kelebihan:

- Java method signature bisa tetap natural,
- XML tetap document/literal,
- tooling JAX-WS/.NET biasanya interoperable,
- request dan response memiliki root element eksplisit.

Risiko:

- wrapper element name/namespace harus persis,
- generated Java bisa berubah jika wrapper convention berubah,
- multiple message parts bisa membuat tooling fallback ke bare mapping,
- overloaded operation bisa bermasalah.

---

## 16. Wrapped vs Bare Mapping dalam JAX-WS

JAX-WS sering membedakan parameter style:

```text
WRAPPED
BARE
```

### 16.1 Wrapped

Wrapped berarti request/response dibungkus dalam wrapper element.

Java terasa seperti:

```java
Customer getCustomer(String customerId);
```

Tetapi XML-nya:

```xml
<GetCustomer>
    <customerId>C-100</customerId>
</GetCustomer>
```

### 16.2 Bare

Bare berarti Java parameter/return lebih langsung merepresentasikan XML element.

Java bisa terasa seperti:

```java
GetCustomerResponse getCustomer(GetCustomerRequest request);
```

XML body langsung berisi element request.

Bare sering lebih eksplisit untuk contract-first, tetapi generated method signature bisa kurang “rapi”. Wrapped lebih nyaman untuk Java, tetapi lebih convention-heavy.

Prinsip arsitektural:

```text
Jangan memilih wrapped hanya karena Java method terlihat indah.
Pilih berdasarkan stabilitas WSDL, interoperability consumer, dan clarity XSD contract.
```

---

## 17. `service`, `port`, dan `soap:address`

Bagian `service` mendefinisikan endpoint konkret.

```xml
<service name="CustomerService">
    <port name="CustomerPort" binding="tns:CustomerSoapBinding">
        <soap:address location="https://api.example.com/customer"/>
    </port>
</service>
```

Mental model:

```text
service = kumpulan endpoint
port = satu endpoint konkret dengan binding tertentu
soap:address = URL fisik
```

Satu service bisa punya beberapa port:

```xml
<service name="CustomerService">
    <port name="CustomerSoap11Port" binding="tns:CustomerSoap11Binding">
        <soap:address location="https://api.example.com/customer/soap11"/>
    </port>

    <port name="CustomerSoap12Port" binding="tns:CustomerSoap12Binding">
        <soap12:address location="https://api.example.com/customer/soap12"/>
    </port>
</service>
```

Atau satu service bisa punya endpoint test/prod dalam WSDL yang berbeda.

Praktik yang sering lebih sehat:

```text
Jangan hard-code endpoint dari generated WSDL jika environment berbeda.
Override endpoint address via runtime configuration.
```

Di JAX-WS client:

```java
CustomerPortType port = service.getCustomerPort();

BindingProvider bp = (BindingProvider) port;
bp.getRequestContext().put(
    BindingProvider.ENDPOINT_ADDRESS_PROPERTY,
    "https://uat-api.example.com/customer"
);
```

Ini penting karena WSDL contract bisa sama, tetapi endpoint UAT/PROD berbeda.

---

## 18. SOAPAction: Header Kecil, Bug Besar

Dalam SOAP 1.1 HTTP binding, operation biasanya punya `soapAction`.

```xml
<soap:operation soapAction="urn:getCustomer"/>
```

SOAPAction dikirim sebagai HTTP header:

```http
SOAPAction: "urn:getCustomer"
```

Masalah umum:

- server mengharapkan SOAPAction tertentu,
- client mengirim SOAPAction kosong,
- WSDL menyebut `soapAction=""`, tetapi gateway routing butuh nilai,
- quote berbeda,
- SOAP 1.1 vs 1.2 expectation berbeda,
- operation dispatch server memakai SOAPAction, bukan body QName.

Bug ini sering terlihat sebagai:

```text
Operation not found
Cannot dispatch message
No such operation
SOAPAction mismatch
HTTP 500 dengan SOAP Fault ambigu
```

Prinsip debugging:

```text
Saat SOAP call gagal dispatch, cek tiga hal bersamaan:
1. SOAPAction header
2. Body first child QName
3. WSDL binding operation
```

---

## 19. SOAP Header dalam WSDL

SOAP bukan hanya body. Header bisa menjadi bagian kontrak.

Contoh:

```xml
<message name="AuthHeaderMessage">
    <part name="auth" element="auth:AuthHeader"/>
</message>

<binding name="CustomerSoapBinding" type="tns:CustomerPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>

    <operation name="getCustomer">
        <soap:operation soapAction="urn:getCustomer"/>
        <input>
            <soap:body use="literal"/>
            <soap:header
                message="tns:AuthHeaderMessage"
                part="auth"
                use="literal"/>
        </input>
    </operation>
</binding>
```

Header sering dipakai untuk:

- authentication token,
- correlation ID,
- transaction ID,
- routing information,
- WS-Addressing,
- WS-Security,
- tenant/agency metadata.

Namun header contract harus jelas. Jangan menyembunyikan mandatory header hanya di dokumen PDF terpisah jika WSDL bisa menyatakannya.

Masalah umum:

- generated client tidak expose header secara mudah,
- custom handler diperlukan,
- server membutuhkan header tetapi WSDL tidak mencantumkannya,
- security gateway menambahkan/menghapus header,
- namespace header salah.

Di JAX-WS, SOAP header sering diatur via handler chain atau vendor-specific API.

---

## 20. Fault dalam WSDL

SOAP Fault adalah error message terstruktur. Dalam WSDL, fault bisa dimodelkan.

```xml
<message name="CustomerFaultMessage">
    <part name="fault" element="cus:CustomerFault"/>
</message>

<portType name="CustomerPortType">
    <operation name="getCustomer">
        <input message="tns:GetCustomerInput"/>
        <output message="tns:GetCustomerOutput"/>
        <fault name="CustomerFault" message="tns:CustomerFaultMessage"/>
    </operation>
</portType>
```

Binding fault:

```xml
<fault name="CustomerFault">
    <soap:fault name="CustomerFault" use="literal"/>
</fault>
```

Generated Java bisa menjadi checked exception:

```java
public Customer getCustomer(GetCustomerRequest request) throws CustomerFault_Exception;
```

Model fault yang baik biasanya memiliki:

```xml
<xsd:complexType name="CustomerFaultType">
    <xsd:sequence>
        <xsd:element name="code" type="xsd:string"/>
        <xsd:element name="message" type="xsd:string"/>
        <xsd:element name="correlationId" type="xsd:string" minOccurs="0"/>
        <xsd:element name="retryable" type="xsd:boolean" minOccurs="0"/>
    </xsd:sequence>
</xsd:complexType>
```

Prinsip kuat:

```text
Fault contract harus membantu consumer mengambil keputusan:
- retry atau tidak,
- input salah atau server gagal,
- operation idempotent atau tidak,
- error bisa ditampilkan ke user atau hanya internal.
```

SOAP Fault tanpa error taxonomy hanya memindahkan kebingungan dari server ke client.

---

## 21. Import dan Include: Modularitas Kontrak

WSDL dan XSD bisa memecah kontrak menjadi beberapa file.

### 21.1 WSDL Import

```xml
<import
    namespace="https://example.com/common/wsdl"
    location="common.wsdl"/>
```

WSDL import mengimpor definisi WSDL dari namespace lain.

### 21.2 XSD Import

```xml
<xsd:import
    namespace="https://example.com/common/schema"
    schemaLocation="common.xsd"/>
```

XSD import dipakai untuk schema namespace berbeda.

### 21.3 XSD Include

```xml
<xsd:include schemaLocation="customer-types.xsd"/>
```

XSD include dipakai untuk schema dengan namespace sama.

Perbedaan penting:

| Mechanism | Dipakai untuk | Namespace |
|---|---|---|
| WSDL `import` | WSDL definitions lain | Biasanya namespace WSDL lain |
| XSD `import` | Schema namespace berbeda | Berbeda |
| XSD `include` | Schema namespace sama | Sama |

Bug umum:

- memakai `include` padahal namespace berbeda,
- memakai `import` tanpa namespace benar,
- relative path rusak saat WSDL didownload dari URL berbeda,
- generated client gagal karena XSD nested tidak ikut disimpan,
- schemaLocation menunjuk internal hostname vendor.

Praktik enterprise:

```text
Selalu simpan seluruh closure WSDL/XSD dalam repository:
WSDL root + imported WSDL + imported/included XSD.
```

Closure berarti semua file yang diperlukan untuk resolve kontrak secara offline.

---

## 22. Contract-First vs Code-First dalam WSDL

SOAP/JAX-WS mendukung dua pendekatan.

### 22.1 Contract-First

Mulai dari WSDL/XSD, lalu generate Java.

```text
WSDL/XSD -> Java SEI + JAXB classes -> implementation/client
```

Kelebihan:

- kontrak eksplisit,
- stabil untuk multi-platform,
- lebih defensible untuk enterprise/gov/banking,
- schema evolution bisa dikontrol,
- tidak bocor detail Java ke consumer.

Kekurangan:

- perlu skill XSD/WSDL,
- tooling build lebih kompleks,
- developer Java harus menerima generated model.

### 22.2 Code-First

Mulai dari Java annotated service, lalu generate WSDL.

```text
Java class/interface -> generated WSDL/XSD -> consumer
```

Kelebihan:

- cepat untuk internal service,
- nyaman bagi developer Java,
- cocok untuk prototyping.

Kekurangan:

- kontrak mudah drift saat refactor Java,
- type naming bisa berubah,
- namespace bisa tidak dirancang matang,
- compatibility sering tidak terlihat,
- consumer non-Java bisa terdampak desain Java.

Prinsip:

```text
Untuk external/long-lived/regulated integration, contract-first biasanya lebih kuat.
Untuk internal/simple/short-lived integration, code-first bisa diterima dengan contract tests ketat.
```

---

## 23. WSDL sebagai Graph Dependency

Jangan pikir WSDL sebagai satu file. Pikirkan sebagai graph.

```text
CustomerService.wsdl
  imports CommonFault.wsdl
  types imports customer.xsd
  types imports common.xsd
  customer.xsd imports identity.xsd
  common.xsd includes audit-fields.xsd
```

Jika satu node berubah, efeknya bisa menyebar:

```text
identity.xsd changes nationalId type
  -> customer.xsd generated class changes
  -> GetCustomerResponse changes
  -> generated client changes
  -> equals/hashCode/test snapshot breaks
  -> runtime marshalling output changes
```

Karena itu, governance WSDL harus menyimpan:

- root WSDL,
- dependency WSDL,
- all imported/included XSD,
- checksums,
- version tag,
- generated source version,
- compatibility test results.

---

## 24. Namespace Versioning Strategy

Namespace versioning adalah topik sensitif.

Contoh namespace:

```text
https://example.com/customer/v1
https://example.com/customer/v2
```

Atau:

```text
urn:example:customer:service:2026:01
```

Kapan namespace perlu berubah?

Biasanya saat breaking change:

- rename element,
- remove required element,
- change type incompatible,
- change semantics besar,
- change operation contract,
- change fault model incompatible.

Kapan tidak perlu berubah?

Biasanya untuk additive compatible change:

- menambah optional element di akhir sequence,
- menambah optional fault detail field,
- memperluas enum secara hati-hati jika consumer siap unknown value,
- menambah operation baru.

Namun hati-hati: XSD `sequence` membuat urutan penting. Menambah optional element di tengah sequence bisa mematahkan beberapa consumer atau strict validator.

Praktik aman:

```text
Untuk XSD sequence, tambahkan optional field di akhir.
Untuk breaking change, buat namespace/operation/service version baru.
Jangan diam-diam mengubah schema dengan namespace sama jika consumer sudah production.
```

---

## 25. Compatibility Matrix: Perubahan WSDL Mana yang Aman?

Tabel berikut adalah heuristik. Realitas tergantung tooling dan strictness consumer.

| Perubahan | Biasanya Compatible? | Risiko |
|---|---:|---|
| Tambah operation baru | Ya | Rendah, kecuali generated artifacts konflik nama. |
| Tambah optional element di akhir response | Sering ya | Consumer strict/unmarshaller lama bisa mengabaikan atau gagal tergantung config. |
| Tambah required element di request | Tidak | Client lama tidak mengirim field. |
| Tambah required element di response | Berisiko | Client lama mungkin tidak tahu field; validator bisa gagal. |
| Rename element | Tidak | QName berubah. |
| Rename operation | Tidak | Dispatch/mapping berubah. |
| Change namespace | Tidak | QName berubah total. |
| Change type string → int | Tidak | Parsing/validation bisa gagal. |
| Change maxLength lebih longgar | Biasanya ya | Downstream DB/domain tetap bisa gagal. |
| Change maxLength lebih ketat | Tidak selalu | Data lama bisa invalid. |
| Tambah enum value | Berisiko | Java enum generated client lama bisa gagal parse. |
| Remove enum value | Berisiko | Existing data/consumer assumption rusak. |
| Change SOAPAction | Berisiko tinggi | Gateway/client dispatch bisa gagal. |
| Change endpoint address only | Compatible secara contract | Runtime config/client endpoint perlu update. |
| Change binding document→rpc | Tidak | Message shape berubah. |
| Change literal→encoded | Tidak | Tooling/interoperability berubah. |
| Add optional SOAP header | Mungkin | Handler/security policy bisa terdampak. |
| Add required SOAP header | Tidak untuk client lama | Client lama tidak mengirim header. |

Kunci:

```text
Compatibility WSDL bukan hanya soal XML valid.
Compatibility juga soal generated code, runtime binding, gateway dispatch, validation policy, dan consumer behavior.
```

---

## 26. Reading WSDL: Metode Sistematis

Saat menerima WSDL vendor, jangan langsung generate client. Baca dulu.

### Step 1: Identifikasi target namespace

Cari:

```xml
targetNamespace="..."
```

Tanyakan:

- namespace ada versioning?
- namespace WSDL dan XSD terpisah?
- namespace UAT/PROD sama atau berbeda?

### Step 2: Cari service dan port

```xml
<service>
  <port>
    <soap:address location="..."/>
  </port>
</service>
```

Tanyakan:

- endpoint address environment-specific?
- ada lebih dari satu port?
- SOAP 1.1 atau 1.2?

### Step 3: Dari port, lompat ke binding

```xml
<port binding="tns:CustomerSoapBinding">
```

Cari binding tersebut.

### Step 4: Dari binding, cek style/use/transport

```xml
<soap:binding style="document" transport="..."/>
<soap:body use="literal"/>
```

Tanyakan:

- document/literal?
- rpc/encoded legacy?
- SOAPAction apa?

### Step 5: Dari binding, lompat ke portType

```xml
<binding type="tns:CustomerPortType">
```

Cek operasi abstrak.

### Step 6: Dari operation, cek message

```xml
<input message="tns:GetCustomerInput"/>
```

Cari message.

### Step 7: Dari message part, cek XSD element/type

```xml
<part name="parameters" element="cus:GetCustomer"/>
```

Cari global element di XSD.

### Step 8: Baca XSD dengan teliti

Tanyakan:

- required vs optional?
- nillable vs absent?
- sequence order?
- enum?
- numeric/date type?
- any/wildcard?
- substitution group?
- imported schemas?

### Step 9: Cek faults dan headers

Fault/header sering menentukan production behavior lebih dari happy path.

### Step 10: Simpan artifact dan hash

Simpan WSDL/XSD closure ke repo. Catat checksum.

---

## 27. WSDL dan Generated Java: Kenapa Hasil Tool Bisa Mengejutkan?

Dari WSDL, tool seperti `wsimport`/Metro/JAX-WS dapat menghasilkan:

- service class,
- port interface,
- JAXB model classes,
- fault exception classes,
- object factory,
- package-info namespace mapping,
- async artifacts jika dikonfigurasi.

Perubahan kecil di WSDL bisa mengubah generated Java besar-besaran.

Contoh:

### 27.1 Element Name Berubah

```xml
<xsd:element name="GetCustomerRequest" .../>
```

menjadi:

```xml
<xsd:element name="RetrieveCustomerRequest" .../>
```

Dampak:

- Java class mungkin berubah,
- `ObjectFactory` berubah,
- `@XmlElementDecl` berubah,
- method wrapper berubah,
- tests snapshot berubah,
- runtime body QName berubah.

### 27.2 Namespace Berubah

Namespace berubah lebih besar dampaknya daripada rename class Java, karena QName XML berubah.

```text
{old-namespace}GetCustomerRequest
```

berbeda total dari:

```text
{new-namespace}GetCustomerRequest
```

### 27.3 `minOccurs` Berubah

```xml
<xsd:element name="status" type="xsd:string" minOccurs="0"/>
```

menjadi required:

```xml
<xsd:element name="status" type="xsd:string"/>
```

Generated Java bisa tetap `String`, tetapi contract semantics berubah. Ini contoh kenapa melihat generated code saja tidak cukup.

---

## 28. `wsimport` dan Build Reproducibility

Di Java 8, tool JAX-WS seperti `wsimport` historis tersedia bersama JDK. Sejak Java 11, modul dan tool Java EE/CORBA dihapus dari JDK, sehingga build harus memakai dependency/plugin eksplisit.

Strategi modern:

```text
- Simpan WSDL/XSD di repo atau artifact registry.
- Generate source saat build dengan plugin yang pinned version.
- Jangan generate dari URL live vendor saat CI.
- Commit generated source hanya jika organisasi memilih model checked-in generated code.
- Tambahkan contract diff/checksum.
```

Contoh layout:

```text
src/main/resources/wsdl/customer/CustomerService.wsdl
src/main/resources/wsdl/customer/xsd/customer.xsd
src/main/resources/wsdl/customer/xsd/common.xsd
src/main/jaxws/bindings/customer-bindings.xjb
```

Maven plugin approach bisa berbeda tergantung Metro/JAX-WS RI/plugin yang dipakai, tetapi prinsipnya sama:

```text
Tool version pinned.
WSDL source pinned.
Generated package explicit.
Binding customization explicit.
CI reproducible.
```

---

## 29. Binding Customization: Mengontrol Java Projection

WSDL/XSD adalah kontrak. Generated Java adalah projection. Kadang projection default tidak ideal.

Binding customization bisa dipakai untuk:

- mengubah package name,
- mengubah class name,
- mapping date/time,
- menghindari name collision,
- mengubah async mapping,
- mengatur wrapper style,
- menyesuaikan JAXB binding.

Contoh JAXB binding sederhana:

```xml
<jaxb:bindings
    version="3.0"
    xmlns:jaxb="https://jakarta.ee/xml/ns/jaxb"
    xmlns:xs="http://www.w3.org/2001/XMLSchema">

    <jaxb:bindings schemaLocation="customer.xsd">
        <jaxb:schemaBindings>
            <jaxb:package name="com.example.integration.customer.schema"/>
        </jaxb:schemaBindings>
    </jaxb:bindings>

</jaxb:bindings>
```

Untuk javax-era/JAXB 2.x, namespace binding berbeda. Ini penting dalam migrasi Java/Jakarta.

Prinsip:

```text
Jangan edit generated source manual.
Kontrol output melalui binding customization dan plugin configuration.
```

Manual edit akan hilang saat regenerate.

---

## 30. WSDL dan Jakarta/XML Namespace Migration

Dalam dunia Java 8–25, ada dua migrasi besar:

```text
javax.* -> jakarta.*
JDK-bundled Java EE modules -> explicit dependencies
```

Dampak ke WSDL:

- WSDL XML contract tidak otomatis berubah hanya karena Java package berubah.
- JAXB/JAX-WS generated Java bisa berubah import dari `javax.xml.bind` ke `jakarta.xml.bind`.
- Annotation Java berubah namespace package.
- Runtime/provider harus konsisten.
- Binding customization namespace bisa berbeda antara generasi tool.

Kesalahan migration umum:

```text
WSDL sama, tetapi generated Java dicampur javax dan jakarta.
```

Contoh masalah:

- class generated memakai `javax.xml.bind.annotation.*`, runtime memakai Jakarta XML Binding 4.x,
- service implementation memakai `jakarta.jws.WebService`, tetapi generated SEI memakai `javax.jws.WebService`,
- dependency Metro/JAX-WS versi lama dipakai di Jakarta EE 10 runtime,
- app server menyediakan Jakarta API tetapi aplikasi membawa javax API lama.

Prinsip:

```text
Pilih satu universe per module:
- legacy javax stack, atau
- modern jakarta stack.
Jangan campur kecuali melalui boundary terisolasi.
```

---

## 31. WSDL Governance di Enterprise System

WSDL adalah contract artifact. Karena itu harus punya governance seperti API spec.

Checklist governance:

```text
[ ] Owner kontrak jelas.
[ ] Versioning policy jelas.
[ ] WSDL/XSD closure disimpan.
[ ] Checksums dicatat.
[ ] Breaking/non-breaking rule disepakati.
[ ] Consumer impact analysis dilakukan.
[ ] Generated code diff direview.
[ ] Sample request/response disediakan.
[ ] Fault taxonomy didokumentasi.
[ ] Header/security policy didokumentasi.
[ ] Endpoint per environment dipisah dari contract.
[ ] Contract test ada di CI.
[ ] Backward compatibility test ada.
```

Tanpa governance, WSDL menjadi “file vendor” yang ditakuti, bukan kontrak yang bisa dikendalikan.

---

## 32. Contract Diff: Apa yang Harus Dibandingkan?

Diff text biasa tidak cukup karena prefix XML bisa berubah tanpa makna berubah.

Yang perlu dibandingkan:

1. QName operation,
2. QName messages,
3. message parts,
4. binding style/use,
5. SOAPAction,
6. header/fault binding,
7. XSD global element/type,
8. `minOccurs`/`maxOccurs`,
9. `nillable`,
10. sequence order,
11. enum values,
12. restrictions,
13. namespace URI,
14. endpoint address jika environment contract memang mencakup address.

Text diff tetap berguna, tetapi semantic diff lebih penting.

Praktik sederhana yang powerful:

```text
1. Store old WSDL/XSD closure.
2. Store new WSDL/XSD closure.
3. Generate Java from both.
4. Diff generated sources.
5. Run sample XML validation old/new.
6. Run consumer contract tests.
7. Classify changes as breaking / compatible / unknown.
```

---

## 33. Testing WSDL-Based Integration

Testing SOAP/WSDL harus berlapis.

### 33.1 Schema Validation Test

Validasi sample request/response terhadap XSD.

```java
SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
Schema schema = factory.newSchema(new File("customer.xsd"));
Validator validator = schema.newValidator();
validator.validate(new StreamSource(new File("sample-response.xml")));
```

Untuk secure XML config, gunakan prinsip dari bagian XML Security.

### 33.2 Generated Client Smoke Test

Pastikan client bisa dibuat dari WSDL pinned.

```java
CustomerService service = new CustomerService(wsdlUrl);
CustomerPortType port = service.getCustomerPort();
```

### 33.3 Golden Sample Test

Simpan sample SOAP request/response sebagai golden files.

```text
src/test/resources/soap/customer/get-customer-request.xml
src/test/resources/soap/customer/get-customer-response.xml
src/test/resources/soap/customer/customer-fault.xml
```

Test:

- unmarshalling response,
- marshalling request,
- namespace correctness,
- fault parsing,
- optional/null cases.

### 33.4 Mock SOAP Server Test

Gunakan stub/mock server untuk memastikan request outgoing sesuai WSDL.

Yang dicek:

- HTTP method,
- Content-Type,
- SOAPAction,
- body QName,
- header presence,
- timeout behavior,
- fault handling.

### 33.5 Interoperability Test

Kalau service external penting, lakukan test dengan environment vendor/partner.

Yang sering berbeda antara mock dan real server:

- strict namespace validation,
- SOAPAction routing,
- TLS/mTLS,
- WS-Security timestamp,
- clock skew,
- required header,
- fault shape,
- max payload size.

---

## 34. Debugging WSDL/SOAP Mismatch

Saat SOAP integration gagal, gunakan decision tree.

### 34.1 Error: `Cannot find dispatch method`

Cek:

```text
[ ] SOAPAction benar?
[ ] Body first child QName benar?
[ ] Namespace wrapper benar?
[ ] Operation name benar?
[ ] SOAP 1.1/1.2 sesuai endpoint?
[ ] Endpoint port benar?
```

### 34.2 Error: `Unmarshalling Error`

Cek:

```text
[ ] Response XML sesuai XSD?
[ ] Namespace element benar?
[ ] Ada field baru tidak dikenal?
[ ] Ada enum value baru?
[ ] Date format valid?
[ ] Field required missing?
[ ] nillable vs empty element tertukar?
```

### 34.3 Error: HTTP 415 Unsupported Media Type

Cek:

```text
[ ] Content-Type SOAP 1.1: text/xml?
[ ] Content-Type SOAP 1.2: application/soap+xml?
[ ] Charset sesuai?
[ ] Gateway policy menerima media type?
```

### 34.4 Error: HTTP 500 dengan SOAP Fault

Cek:

```text
[ ] Fault modeled atau unmodeled?
[ ] Fault detail bisa di-unmarshal?
[ ] Error code retryable?
[ ] Request valid secara XSD?
[ ] Server operation berhasil dispatch tetapi business validation gagal?
```

### 34.5 Error hanya di PROD, bukan UAT

Cek:

```text
[ ] WSDL UAT/PROD benar-benar sama?
[ ] Endpoint address override benar?
[ ] Certificate/truststore berbeda?
[ ] SOAPAction gateway PROD berbeda?
[ ] Security policy PROD lebih ketat?
[ ] Schema version PROD berbeda?
[ ] Load balancer/proxy mengubah header?
```

---

## 35. WSDL Anti-Patterns

### 35.1 Generate dari Live URL Setiap Build

```text
CI -> wsimport https://vendor.com/service?wsdl
```

Masalah:

- vendor bisa mengubah WSDL diam-diam,
- build tidak reproducible,
- CI tergantung network/vendor uptime,
- supply chain contract tidak dikontrol.

Lebih baik:

```text
Pin WSDL/XSD closure di repo/artifact registry.
```

### 35.2 Endpoint Address Dicampur dengan Contract

WSDL dari UAT berisi:

```xml
<soap:address location="https://uat.example.com/service"/>
```

Lalu generated client dipakai di PROD tanpa override.

Lebih baik:

```text
Contract pinned, endpoint runtime-configured.
```

### 35.3 Mengubah Namespace untuk Perubahan Non-Breaking Kecil

Terlalu sering mengganti namespace menciptakan fragmentasi dan memaksa regenerate consumer.

Namespace versioning harus dipakai dengan disiplin.

### 35.4 Tidak Memodelkan Fault

Service hanya mengembalikan generic SOAP Fault tanpa structured detail.

Akibat:

- client tidak tahu retry atau tidak,
- UI tidak bisa menampilkan pesan aman,
- monitoring sulit mengelompokkan error,
- SLA dispute sulit dianalisis.

### 35.5 Menaruh Business Semantics di PDF, Bukan Contract

Contoh:

```text
Field status optional di XSD, tetapi PDF bilang wajib untuk agency tertentu.
```

Ini mungkin tidak bisa sepenuhnya dihindari, tetapi harus diminimalkan. Jika semantics tidak bisa diekspresikan di XSD, buat validation rule dan sample eksplisit.

### 35.6 Menggunakan `xsd:any` Tanpa Governance

`xsd:any` memberi extension point, tetapi juga bisa menjadi pintu ambiguity.

Gunakan dengan:

- namespace constraint,
- processContents policy,
- documented extension contract,
- validation strategy.

### 35.7 Menganggap WSDL Valid Berarti Integration Aman

WSDL valid hanya berarti contract secara struktur bisa dibaca. Integration masih bisa gagal karena:

- auth,
- TLS,
- WS-Security,
- gateway routing,
- timeout,
- payload limit,
- idempotency,
- fault handling,
- partner-specific behavior.

---

## 36. WSDL Design Heuristics untuk Top 1% Engineer

### 36.1 Pisahkan Data Vocabulary dan Service Operations

Jangan campur semua type dalam satu WSDL besar jika domain tumbuh.

Lebih baik:

```text
common-types.xsd
customer-types.xsd
case-types.xsd
customer-service.wsdl
case-service.wsdl
```

### 36.2 Gunakan Stable Namespace

Namespace bukan environment URL.

Buruk:

```text
https://uat.example.com/customer/schema
```

Lebih baik:

```text
https://schemas.example.com/customer/v1
```

Endpoint bisa environment-specific, namespace jangan.

### 36.3 Hindari Leaking Java Internal Names

Buruk:

```xml
<xsd:complexType name="CustomerDtoImpl">
```

Lebih baik:

```xml
<xsd:complexType name="CustomerType">
```

WSDL adalah public contract, bukan dump dari class internal.

### 36.4 Buat Request/Response Explicit

Daripada operation dengan primitive scattered parameters, lebih stabil memakai explicit request/response object.

```text
GetCustomerRequest
GetCustomerResponse
SubmitApplicationRequest
SubmitApplicationResponse
```

Ini memberi ruang evolusi optional fields.

### 36.5 Desain Fault sebagai Contract, Bukan Exception Dump

Fault ideal:

```text
code
message
category
correlationId
retryable
fieldErrors optional
```

Hindari membocorkan:

- stack trace,
- internal class name,
- SQL error mentah,
- file path,
- server hostname.

### 36.6 Tambahkan Optional Fields di Akhir Sequence

XSD sequence order matters. Untuk evolusi kompatibel, tambahkan optional field di akhir.

### 36.7 Jangan Overuse Enum untuk External Domain yang Sering Berubah

Enum memberi constraint kuat, tetapi consumer lama bisa gagal saat value baru muncul.

Untuk domain value yang sering berubah, pertimbangkan:

```text
code list eksternal + string constrained by documentation
```

atau versioning yang jelas.

### 36.8 Sample XML adalah Bagian dari Kontrak

WSDL/XSD formal penting, tetapi sample request/response membantu manusia dan test automation.

Minimal sample:

```text
happy path request
happy path response
validation error fault
auth error fault
not found fault
optional field absent
nillable field nil
maximal payload example
```

---

## 37. Mini Case Study: Vendor Mengubah WSDL Tanpa Version Bump

Situasi:

```text
Client Java kita generate dari CustomerService.wsdl v1.
Vendor mengirim email: "minor WSDL update".
Tidak ada namespace version baru.
```

Perubahan:

```diff
<xsd:element name="customerStatus" type="xsd:string" minOccurs="0"/>
+ <xsd:element name="riskCategory" type="xsd:string"/>
```

Mereka menambah `riskCategory` sebagai required field di response.

Analisis:

- Jika hanya response, client lama mungkin tetap bisa ignore unknown field jika unmarshaller lenient.
- Tetapi XSD contract berubah menjadi response wajib memiliki `riskCategory`.
- Jika test validator lama dipakai terhadap response baru, bisa gagal karena field unknown/sequence mismatch.
- Jika generated Java baru dipakai, class response berubah.
- Jika field ditambahkan di tengah sequence, XML order berubah.
- Jika downstream domain tidak siap, data bisa hilang atau mapping error.

Kesimpulan:

```text
Ini bukan minor dari sudut consumer.
Ini contract change yang harus diuji sebagai compatibility event.
```

Action yang benar:

1. simpan old/new WSDL,
2. semantic diff XSD,
3. regenerate client di branch,
4. run golden sample tests,
5. test against vendor UAT,
6. update DTO/domain mapping,
7. release dengan clear dependency version,
8. monitor unmarshalling/fault rate.

---

## 38. Mini Case Study: SOAPAction Salah Karena Gateway Routing

Situasi:

SOAP request body benar:

```xml
<cus:GetCustomer>
    <customerId>C-100</customerId>
</cus:GetCustomer>
```

Tetapi server mengembalikan:

```text
Cannot dispatch operation
```

WSDL binding:

```xml
<operation name="getCustomer">
    <soap:operation soapAction="urn:CustomerService/getCustomer"/>
</operation>
```

Actual HTTP header:

```http
SOAPAction: ""
```

Root cause:

```text
Gateway/server dispatch memakai SOAPAction, bukan hanya body QName.
Client generated tidak mengirim SOAPAction sesuai binding, atau override handler menghapusnya.
```

Fix:

- pastikan generated client membaca binding benar,
- set SOAPAction jika perlu:

```java
BindingProvider bp = (BindingProvider) port;
bp.getRequestContext().put(BindingProvider.SOAPACTION_USE_PROPERTY, Boolean.TRUE);
bp.getRequestContext().put(BindingProvider.SOAPACTION_URI_PROPERTY, "urn:CustomerService/getCustomer");
```

Catatan:

Property support bisa tergantung stack JAX-WS/provider. Selalu verifikasi wire log.

---

## 39. Mini Case Study: Namespace UAT dan PROD Berbeda

Situasi:

UAT WSDL:

```text
https://uat.vendor.example.com/customer/schema
```

PROD WSDL:

```text
https://vendor.example.com/customer/schema
```

Elemen lokal sama, tetapi namespace berbeda.

Dampak:

```text
{https://uat.vendor.example.com/customer/schema}GetCustomer
```

berbeda dari:

```text
{https://vendor.example.com/customer/schema}GetCustomer
```

Client generated dari UAT bisa gagal di PROD walaupun XML terlihat “sama”.

Prinsip:

```text
Namespace contract tidak boleh environment-specific.
Environment berbeda harus beda endpoint, bukan beda QName.
```

Jika vendor sudah begitu, kita perlu generate per environment atau minta stable namespace. Dalam sistem regulated, ini harus dicatat sebagai risiko integrasi.

---

## 40. WSDL Checklist Sebelum Implementasi Client Java

Sebelum menulis code client, jawab ini:

```text
[ ] WSDL 1.1 atau 2.0?
[ ] SOAP 1.1 atau SOAP 1.2?
[ ] document/literal atau rpc/encoded?
[ ] Wrapped atau bare?
[ ] Endpoint address environment-specific?
[ ] Semua imported WSDL/XSD tersedia offline?
[ ] Namespace stabil antar environment?
[ ] Ada SOAPAction? Required?
[ ] Ada SOAP headers? Auth/correlation/WS-Addressing?
[ ] Ada WS-Security policy?
[ ] Fault modeled?
[ ] Fault detail XSD tersedia?
[ ] Ada sample request/response/fault?
[ ] Payload size limit diketahui?
[ ] Timeout/retry policy jelas?
[ ] Idempotency operation jelas?
[ ] Generated package name dikontrol?
[ ] Java stack javax atau jakarta?
[ ] Build generate dari pinned artifact?
[ ] Contract diff process ada?
```

Jika banyak jawaban kosong, risiko bukan di coding. Risiko ada di contract discovery.

---

## 41. WSDL Checklist Saat Review Perubahan Kontrak

Saat vendor/team mengirim WSDL baru:

```text
[ ] Namespace berubah?
[ ] Operation ditambah/dihapus/rename?
[ ] Message part berubah?
[ ] Binding style/use berubah?
[ ] SOAPAction berubah?
[ ] Header berubah?
[ ] Fault berubah?
[ ] Required field bertambah?
[ ] Optional field bertambah di akhir sequence?
[ ] Type berubah?
[ ] Enum value berubah?
[ ] Length/pattern restriction berubah?
[ ] nillable/minOccurs berubah?
[ ] import/include berubah?
[ ] Endpoint address berubah?
[ ] Generated Java diff direview?
[ ] Golden sample masih valid?
[ ] Consumer lama masih bisa jalan?
```

Kategorikan hasil:

```text
Compatible
Breaking
Potentially breaking
Unknown / requires partner test
```

Jangan menerima label “minor change” tanpa analisis.

---

## 42. Hubungan WSDL dengan Bagian Berikutnya

Bagian ini membangun fondasi untuk bagian selanjutnya:

- Part 24 akan membahas server-side Jakarta XML Web Services/JAX-WS.
- Part 25 akan membahas client-side JAX-WS.
- Part 26 akan membahas fault/error/resilience.
- Part 27 akan membahas attachments/MTOM/SAAJ.
- Part 28–29 akan masuk ke WS-* dan SOAP security.

WSDL adalah pusat dari semua bagian itu. Server-side annotation menghasilkan/menyesuaikan WSDL. Client-side tooling membaca WSDL. Fault harus dimodelkan di WSDL. Header/security/attachments sering muncul melalui binding/policy tambahan di sekitar WSDL.

---

## 43. Ringkasan Mental Model

WSDL harus dibaca sebagai graph kontrak:

```text
service.port.address
    -> binding
        -> portType
            -> operation
                -> input/output/fault message
                    -> message part
                        -> XSD element/type
```

Pemisahan utama:

```text
Abstract:
  types, messages, portType

Concrete:
  binding, service, port, address
```

Hal paling sering menyebabkan production failure:

```text
- namespace/QName mismatch
- SOAPAction mismatch
- document/literal vs rpc confusion
- wrapped vs bare mismatch
- imported schema tidak lengkap
- generated client dari WSDL environment salah
- Java 8 vs 11+ tooling/dependency mismatch
- javax vs jakarta campur
- fault/header tidak dipahami sebagai contract
- WSDL berubah tanpa compatibility review
```

Skill yang membedakan engineer matang:

```text
Tidak hanya bisa generate client dari WSDL,
tetapi bisa membaca, menilai, mengamankan, menguji,
dan mengelola evolusi kontraknya.
```

---

## 44. Latihan Praktis

### Latihan 1 — Trace Graph WSDL

Ambil satu WSDL. Trace manual:

```text
service -> port -> binding -> portType -> operation -> message -> part -> XSD element/type
```

Tulis hasilnya dalam tabel.

### Latihan 2 — Classify Change

Buat 10 perubahan pada XSD/WSDL, lalu klasifikasikan:

```text
compatible / breaking / potentially breaking
```

Contoh:

- tambah optional response field,
- rename namespace,
- tambah required request field,
- ubah SOAPAction,
- tambah enum value,
- ubah endpoint address.

### Latihan 3 — Generate dan Diff Java

Generate Java dari WSDL v1 dan v2. Diff generated source. Identifikasi perubahan yang berasal dari:

- XSD type,
- wrapper element,
- namespace,
- binding style,
- fault model.

### Latihan 4 — Wire-Level Debug

Capture SOAP request dengan logging/proxy. Verifikasi:

```text
[ ] URL endpoint
[ ] HTTP method
[ ] Content-Type
[ ] SOAPAction
[ ] Envelope namespace
[ ] Body first child QName
[ ] Header QName
[ ] Fault detail QName
```

---

## 45. Referensi Utama

- W3C — Web Services Description Language (WSDL) 1.1  
  https://www.w3.org/TR/wsdl.html

- W3C — Web Services Description Language (WSDL) Version 2.0  
  https://www.w3.org/TR/wsdl20/

- W3C — WSDL 1.1 Binding Extension for SOAP 1.2  
  https://www.w3.org/Submission/wsdl11soap12/

- Jakarta XML Web Services 4.0  
  https://jakarta.ee/specifications/xml-web-services/4.0/

- Jakarta XML Binding 4.0  
  https://jakarta.ee/specifications/xml-binding/4.0/

- OpenJDK JEP 320 — Remove the Java EE and CORBA Modules  
  https://openjdk.org/jeps/320

- WS-I Basic Profile overview  
  https://ws-i.org/

---

## 46. Penutup Part 23

Di bagian ini kita memindahkan WSDL dari kategori “file XML generated by tool” menjadi **contract graph** yang bisa dianalisis.

Inti pemahamannya:

```text
WSDL = data contract + message contract + operation contract + protocol binding + endpoint declaration.
```

Jika kita bisa membaca WSDL dengan cara ini, maka JAX-WS/Jakarta XML Web Services tidak lagi terasa seperti magic. Kita tahu dari mana generated Java berasal, kenapa namespace penting, kenapa SOAPAction bisa mematahkan dispatch, dan kenapa contract evolution harus diperlakukan serius.

Bagian berikutnya akan masuk ke sisi server:

```text
Part 24 — JAX-WS / Jakarta XML Web Services Server Side
```

Di sana kita akan melihat bagaimana Java endpoint, annotation, SEI, implementation class, handler, servlet/container integration, dan fault mapping berhubungan langsung dengan WSDL yang sudah kita bedah di bagian ini.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 22 — SOAP Mental Model: Envelope, Header, Body, Fault, SOAP 1.1 vs 1.2, Document-Literal, RPC Legacy, and Why SOAP Survived](./learn-java-json-xml-soap-connectors-enterprise-integration-part-022.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 24 — WS / Jakarta XML Web Services Server Side](./learn-java-json-xml-soap-connectors-enterprise-integration-part-024.md)
