# learn-java-json-xml-soap-connectors-enterprise-integration-part-025

# Part 25 — JAX-WS / Jakarta XML Web Services Client Side

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Bagian: `25 dari 34`  
> Topik utama: SOAP client engineering, WSDL-generated proxy, dynamic dispatch, runtime configuration, timeout, handler chain, retry boundary, migration Java 8–25, dan production hardening.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas SOAP mental model, WSDL, dan server-side Jakarta XML Web Services. Sekarang kita masuk ke sisi yang sering paling banyak ditemui di enterprise system nyata: **client SOAP**.

Banyak sistem modern tidak lagi menulis SOAP server baru, tetapi masih harus **mengonsumsi SOAP endpoint** milik:

- core banking,
- insurance platform,
- payment gateway legacy,
- government registry,
- tax/customs system,
- identity provider lama,
- document management system,
- ERP/CRM enterprise,
- message gateway,
- regulatory or licensing platform,
- vendor product yang hanya expose WSDL.

Masalahnya: banyak engineer memperlakukan SOAP client seperti method call biasa:

```java
response = port.submit(request);
```

Padahal secara runtime, baris itu bisa berarti:

1. load WSDL metadata,
2. create service model,
3. create port proxy,
4. convert Java object menjadi XML via JAXB,
5. wrap dalam SOAP envelope,
6. attach SOAP headers,
7. apply handler chain,
8. sign/encrypt/message-policy jika ada,
9. open HTTP/TLS connection,
10. send request,
11. wait response,
12. parse SOAP envelope,
13. map SOAP fault,
14. unmarshal XML body menjadi Java object,
15. expose response context.

Di production, failure bisa muncul di salah satu titik ini. Jadi tujuan bagian ini bukan hanya tahu “cara generate client”, tetapi membangun mental model yang cukup kuat untuk:

- membaca WSDL sebagai client contract,
- memilih proxy client vs dynamic dispatch,
- mengontrol endpoint address, timeout, header, dan transport behavior,
- membedakan network failure, protocol failure, SOAP fault, business rejection, dan unmarshalling failure,
- mendesain retry yang aman,
- menjaga compatibility ketika WSDL berubah,
- migrasi dari Java 8 `javax.xml.ws` ke Java 11+ dan Jakarta `jakarta.xml.ws`,
- menulis client wrapper yang testable, observable, dan defensible.

---

## 1. Mental Model Utama: SOAP Client Bukan Remote Method Call

### 1.1 Ilusi paling berbahaya: proxy terlihat seperti interface biasa

Dalam JAX-WS/Jakarta XML Web Services, client proxy biasanya berbentuk Java interface:

```java
PaymentPort port = service.getPaymentPort();
PaymentResponse response = port.submitPayment(request);
```

Secara syntax, ini mirip local method call. Secara realitas, ini **distributed protocol invocation**.

Perbedaannya fundamental:

| Local method call | SOAP client invocation |
|---|---|
| Memory-local | Network-bound |
| Type system Java penuh | XML/WSDL/XSD contract |
| Exception langsung dari callee | Network/protocol/XML/fault mapping |
| Latency sangat kecil | Latency tidak stabil |
| Transaction bisa satu process | Distributed transaction umumnya tidak ada |
| Object identity mungkin bermakna | XML document value-based |
| Retry biasanya tidak relevan | Retry sangat penting tetapi berbahaya |

SOAP client yang baik harus dilihat sebagai **anti-corruption boundary** antara sistem internal dan kontrak eksternal.

---

## 2. Dua Model Client: Generated Proxy vs Dynamic Dispatch

JAX-WS/Jakarta XML Web Services menyediakan dua gaya besar untuk client:

1. **Static/generated proxy client**
2. **Dynamic `Dispatch` client**

Keduanya sah, tetapi mental model dan use case-nya berbeda.

---

## 3. Static / Generated Proxy Client

### 3.1 Apa itu generated proxy client?

Generated proxy client adalah model paling umum. Kita mulai dari WSDL, lalu tool seperti `wsimport` menghasilkan:

- service class,
- port interface,
- request/response JAXB classes,
- object factory,
- fault classes,
- package metadata,
- sometimes binding metadata.

Contoh hasil konseptual:

```java
PaymentService service = new PaymentService(wsdlUrl);
PaymentPort port = service.getPaymentPort();
PaymentResponse response = port.submitPayment(request);
```

Di Jakarta namespace modern:

```java
import jakarta.xml.ws.Service;
import jakarta.xml.ws.BindingProvider;
```

Di Java EE / Java 8 legacy namespace:

```java
import javax.xml.ws.Service;
import javax.xml.ws.BindingProvider;
```

### 3.2 Kapan generated proxy tepat?

Generated proxy cocok ketika:

- WSDL stabil,
- operasi SOAP cukup banyak,
- payload complex dan schema-first,
- tim ingin type-safe Java model,
- contract external dikelola secara formal,
- sistem butuh compile-time detection saat schema berubah,
- integrasi perlu fault class dan JAXB type mapping yang jelas.

### 3.3 Kapan generated proxy menjadi masalah?

Generated proxy bisa menjadi beban ketika:

- WSDL berubah sering tanpa versioning,
- provider sering mengubah schema minor tetapi breaking,
- hanya butuh forward/proxy SOAP message,
- harus preserve XML persis termasuk unknown header/body,
- payload sangat besar dan tidak ingin full JAXB object graph,
- perlu message-level manipulation yang sulit dengan typed proxy,
- ada mismatch vendor tool/runtime.

Generated code itu bukan domain model. Generated code adalah **contract adapter model**.

---

## 4. Dynamic Dispatch Client

### 4.1 Apa itu `Dispatch`?

`Dispatch<T>` adalah API untuk invocation dinamis ke endpoint SOAP tanpa typed port interface. `Dispatch` juga merupakan subinterface dari `BindingProvider`, sehingga tetap bisa dikonfigurasi request context, endpoint address, dan binding-nya.

Tipe umum:

```java
Dispatch<SOAPMessage>
Dispatch<Source>
Dispatch<JAXBElement<T>>
```

Model konseptual:

```java
QName serviceName = new QName("urn:payment", "PaymentService");
QName portName = new QName("urn:payment", "PaymentPort");

Service service = Service.create(wsdlUrl, serviceName);
Dispatch<SOAPMessage> dispatch = service.createDispatch(
    portName,
    SOAPMessage.class,
    Service.Mode.MESSAGE
);

SOAPMessage response = dispatch.invoke(requestMessage);
```

### 4.2 Mode `MESSAGE` vs `PAYLOAD`

`Dispatch` punya dua mode penting:

| Mode | Makna |
|---|---|
| `Service.Mode.MESSAGE` | Kita bekerja dengan seluruh SOAP message: envelope, header, body. |
| `Service.Mode.PAYLOAD` | Kita hanya bekerja dengan payload/body content. |

Pilih `MESSAGE` jika perlu:

- custom SOAP headers,
- inspect envelope,
- preserve header,
- manipulate fault envelope,
- integrate with WS-Security/legacy header manually,
- debug raw SOAP.

Pilih `PAYLOAD` jika hanya perlu body payload dan runtime menangani envelope.

### 4.3 Kapan `Dispatch` tepat?

`Dispatch` cocok ketika:

- butuh message-level control,
- WSDL tidak cukup stabil untuk generated code,
- sedang membuat SOAP gateway/facade,
- ingin meneruskan payload tanpa full object binding,
- perlu melakukan generic auditing/logging/filtering,
- ingin menguji endpoint dengan raw XML/SOAP,
- harus consume operation yang mapping Java-nya bermasalah.

### 4.4 Trade-off `Dispatch`

`Dispatch` memberi fleksibilitas, tetapi mengurangi type-safety.

| Aspek | Generated proxy | Dispatch |
|---|---|---|
| Type safety | Tinggi | Rendah-sedang |
| Message control | Sedang | Tinggi |
| Ease of use | Tinggi | Sedang-rendah |
| WSDL evolution detection | Compile-time lebih kuat | Runtime/test-time |
| Debug raw SOAP | Tidak langsung | Mudah |
| Unknown extension preservation | Sulit | Lebih mudah |
| Enterprise gateway use case | Kadang tidak cocok | Cocok |

---

## 5. Anatomy Generated Client

Saat tool menghasilkan client dari WSDL, biasanya ada beberapa artefak.

### 5.1 Service class

Biasanya extends `Service`:

```java
@WebServiceClient(
    name = "PaymentService",
    targetNamespace = "urn:payment",
    wsdlLocation = "classpath:wsdl/payment.wsdl"
)
public class PaymentService extends Service {
    public PaymentService(URL wsdlLocation) {
        super(wsdlLocation, new QName("urn:payment", "PaymentService"));
    }

    public PaymentPort getPaymentPort() {
        return super.getPort(
            new QName("urn:payment", "PaymentPort"),
            PaymentPort.class
        );
    }
}
```

Service class adalah factory untuk port proxy.

### 5.2 Port interface / SEI

```java
@WebService(
    targetNamespace = "urn:payment",
    name = "PaymentPort"
)
public interface PaymentPort {

    @WebMethod(operationName = "SubmitPayment")
    PaymentResponse submitPayment(PaymentRequest request)
        throws PaymentFault;
}
```

Port interface adalah Java view atas WSDL `portType`.

### 5.3 JAXB-generated model

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "PaymentRequest", propOrder = {
    "transactionId",
    "amount",
    "currency"
})
public class PaymentRequest {
    protected String transactionId;
    protected BigDecimal amount;
    protected String currency;
}
```

Ini adalah XML contract model, bukan domain model.

### 5.4 Fault class

```java
@WebFault(name = "PaymentFault", targetNamespace = "urn:payment")
public class PaymentFault extends Exception {
    private PaymentFaultDetail faultInfo;
}
```

Modeled fault biasanya muncul sebagai checked exception.

---

## 6. Generated Code Bukan Domain Model

Kesalahan desain umum:

```java
// buruk
public class PaymentServiceDomain {
    private GeneratedPaymentRequest request;
}
```

Masalah:

- domain ikut berubah saat WSDL berubah,
- namespace XML bocor ke business logic,
- test domain bergantung ke generated code,
- sulit migrate `javax` → `jakarta`,
- sulit mengganti provider SOAP,
- validation boundary kabur,
- object generated bisa punya nullability/collection semantics yang tidak cocok dengan domain.

Desain lebih baik:

```text
Application Service
    ↓
Internal Command / DTO
    ↓
SOAP Client Adapter
    ↓
Generated JAXB Request
    ↓
Port Proxy
    ↓
External SOAP Endpoint
```

Pattern:

```java
public final class PaymentGatewayClient {
    private final PaymentPort port;
    private final PaymentSoapMapper mapper;

    public PaymentResult submit(PaymentCommand command) {
        PaymentRequest soapRequest = mapper.toSoapRequest(command);
        try {
            PaymentResponse response = port.submitPayment(soapRequest);
            return mapper.toDomainResult(response);
        } catch (PaymentFault fault) {
            throw mapper.toDomainException(fault);
        }
    }
}
```

Generated object berhenti di adapter.

---

## 7. Creating a Client from WSDL

### 7.1 Java 8 legacy style

Pada Java 8, tool dan API `javax.xml.ws` sering dianggap tersedia dari JDK. Banyak project lama memakai:

```bash
wsimport -keep -p com.example.payment.client https://host/payment?wsdl
```

Lalu import:

```java
import javax.xml.ws.BindingProvider;
```

Namun ini menjadi problem setelah Java 11 karena modul Java EE/CORBA terkait dihapus dari JDK.

### 7.2 Java 11+ explicit dependency mindset

Sejak Java 11, jangan mengandalkan JDK untuk JAX-WS/JAXB/SAAJ. Jadikan dependency dan tooling eksplisit.

Contoh conceptual Maven dependencies untuk Jakarta XML Web Services / Metro style:

```xml
<dependencies>
  <dependency>
    <groupId>com.sun.xml.ws</groupId>
    <artifactId>jaxws-rt</artifactId>
    <version>4.0.3</version>
  </dependency>
</dependencies>
```

Untuk tooling code generation, gunakan plugin atau tool dari implementasi yang sesuai, misalnya Metro/JAX-WS Maven plugin atau wsimport tool artifact sesuai versi stack.

Prinsipnya:

- compile-time API harus jelas,
- runtime implementation harus jelas,
- JAXB runtime harus kompatibel,
- namespace `javax` atau `jakarta` harus konsisten,
- generated source harus masuk proses build deterministik.

### 7.3 `javax` vs `jakarta` decision

| Situasi | Pilihan realistis |
|---|---|
| Aplikasi Java 8 / Jakarta EE lama / Java EE app server lama | `javax.xml.ws` |
| Aplikasi Java 11+ tetapi masih integrasi legacy Java EE libraries | Bisa tetap `javax`, dengan dependency eksplisit |
| Aplikasi Jakarta EE 9/10+ | `jakarta.xml.ws` |
| Aplikasi Spring Boot modern tanpa app server | Pilih stack eksplisit; jangan campur namespace sembarangan |
| Migrasi bertahap banyak dependency lama | Buat adapter boundary; jangan expose generated type ke domain |

Yang paling berbahaya adalah campur sebagian `javax.xml.bind` dengan sebagian `jakarta.xml.bind`, atau generated code `javax` dipakai runtime `jakarta` tanpa strategi jelas.

---

## 8. WSDL Location Strategy

### 8.1 Jangan selalu fetch WSDL dari network saat startup

Generated service class sering punya `wsdlLocation` yang menunjuk URL remote:

```java
new URL("https://partner.example.com/payment?wsdl")
```

Ini berbahaya:

- startup tergantung availability partner,
- DNS/firewall/proxy issue membuat aplikasi gagal start,
- WSDL bisa berubah tanpa kontrol,
- build artifact tidak reproducible,
- test environment bisa accidentally hit production WSDL.

Untuk production, biasanya lebih baik:

1. simpan WSDL/XSD versioned di repository,
2. generate source dari WSDL lokal,
3. package WSDL sebagai resource,
4. override endpoint address via config saat runtime.

### 8.2 Pisahkan WSDL metadata dari endpoint runtime

WSDL bisa berisi alamat endpoint:

```xml
<soap:address location="https://uat.partner.example.com/payment" />
```

Namun runtime endpoint harus configurable:

```java
BindingProvider bp = (BindingProvider) port;
bp.getRequestContext().put(
    BindingProvider.ENDPOINT_ADDRESS_PROPERTY,
    configuredEndpointUrl
);
```

Dengan ini, WSDL tetap contract metadata, sedangkan endpoint actual dikontrol environment.

### 8.3 Resource-based WSDL

Contoh:

```java
URL wsdl = PaymentService.class.getResource("/wsdl/payment/payment.wsdl");
PaymentService service = new PaymentService(wsdl);
PaymentPort port = service.getPaymentPort();
```

Manfaat:

- deterministic build,
- version control,
- repeatable tests,
- tidak tergantung remote metadata,
- bisa diff WSDL antar versi.

---

## 9. `BindingProvider`: Runtime Control Surface

`BindingProvider` adalah interface penting untuk client proxy dan `Dispatch`. Ia menyediakan akses ke:

- request context,
- response context,
- binding,
- endpoint address property,
- session maintenance property,
- username/password property,
- SOAPAction property.

Contoh:

```java
PaymentPort port = service.getPaymentPort();
BindingProvider bp = (BindingProvider) port;

Map<String, Object> ctx = bp.getRequestContext();
ctx.put(BindingProvider.ENDPOINT_ADDRESS_PROPERTY, endpointUrl);
ctx.put(BindingProvider.USERNAME_PROPERTY, username);
ctx.put(BindingProvider.PASSWORD_PROPERTY, password);
```

Mental model: `BindingProvider` adalah **per-port runtime configuration surface**.

---

## 10. Endpoint Override

### 10.1 Kenapa endpoint override wajib?

Karena endpoint beda per environment:

- local mock,
- DEV,
- SIT,
- UAT,
- pre-prod,
- production,
- disaster recovery,
- blue/green endpoint,
- partner region endpoint.

Jangan compile endpoint production ke generated source.

### 10.2 Template aman

```java
public PaymentPort createPort(SoapClientConfig config) {
    URL wsdl = getClass().getResource("/wsdl/payment/payment.wsdl");
    PaymentService service = new PaymentService(wsdl);
    PaymentPort port = service.getPaymentPort();

    BindingProvider bp = (BindingProvider) port;
    bp.getRequestContext().put(
        BindingProvider.ENDPOINT_ADDRESS_PROPERTY,
        config.endpointUrl()
    );

    return port;
}
```

---

## 11. Timeout: Bagian yang Tidak Boleh Dibiarkan Default

### 11.1 Timeout default adalah risiko production

SOAP client tanpa timeout eksplisit bisa menyebabkan:

- thread pool habis,
- request menggantung,
- queue menumpuk,
- container health check gagal,
- cascading failure,
- connection leak symptoms,
- SLA breach.

Timeout minimal yang harus dipikirkan:

| Timeout | Makna |
|---|---|
| Connect timeout | Batas waktu membuat koneksi TCP/TLS. |
| Read/receive timeout | Batas waktu menunggu response setelah request terkirim. |
| Overall operation timeout | Deadline bisnis end-to-end. |
| Pool acquire timeout | Jika HTTP client underlying punya pool. |
| Retry budget | Total durasi semua attempt. |

### 11.2 Standard vs implementation-specific property

Historically, timeout property di JAX-WS sering implementation-specific. Pada Metro/JAX-WS legacy banyak contoh menggunakan:

```java
ctx.put("com.sun.xml.ws.connect.timeout", 5_000);
ctx.put("com.sun.xml.ws.request.timeout", 30_000);
```

Pada beberapa runtime lain:

```java
ctx.put("javax.xml.ws.client.connectionTimeout", "5000");
ctx.put("javax.xml.ws.client.receiveTimeout", "30000");
```

Pada Jakarta namespace modern, beberapa implementation dapat menggunakan varian:

```java
ctx.put("jakarta.xml.ws.client.connectionTimeout", "5000");
ctx.put("jakarta.xml.ws.client.receiveTimeout", "30000");
```

Karena timeout property bisa berbeda antar implementation/container, production-grade client sebaiknya:

1. dokumentasikan runtime provider,
2. test timeout benar-benar bekerja,
3. buat integration test ke endpoint yang sengaja delay,
4. jangan hanya percaya property name dari blog lama,
5. bungkus config dalam abstraction.

### 11.3 Timeout wrapper

```java
public final class JaxWsTimeoutConfigurer {
    public static void configure(BindingProvider bp, Duration connect, Duration read) {
        Map<String, Object> ctx = bp.getRequestContext();

        int connectMillis = Math.toIntExact(connect.toMillis());
        int readMillis = Math.toIntExact(read.toMillis());

        // Metro/JAX-WS common properties
        ctx.put("com.sun.xml.ws.connect.timeout", connectMillis);
        ctx.put("com.sun.xml.ws.request.timeout", readMillis);

        // Some Javax-era containers
        ctx.put("javax.xml.ws.client.connectionTimeout", String.valueOf(connectMillis));
        ctx.put("javax.xml.ws.client.receiveTimeout", String.valueOf(readMillis));

        // Some Jakarta-era implementations/containers
        ctx.put("jakarta.xml.ws.client.connectionTimeout", String.valueOf(connectMillis));
        ctx.put("jakarta.xml.ws.client.receiveTimeout", String.valueOf(readMillis));
    }
}
```

Ini bukan berarti semua property selalu digunakan. Ini defensive helper untuk stack heterogen, tetapi tetap harus dibuktikan dengan test runtime.

### 11.4 Timeout sebagai business decision

Timeout bukan angka teknis random.

Pertimbangkan:

- SLA upstream,
- SLA downstream,
- user-facing vs batch,
- idempotency,
- retry policy,
- thread pool size,
- expected P95/P99 latency,
- operation cost,
- partner maintenance window,
- failure mode saat timeout.

Contoh:

| Use case | Connect timeout | Read timeout | Retry |
|---|---:|---:|---|
| User search screen | 1–3s | 3–8s | 0–1 retry jika idempotent |
| Payment submit | 2–5s | 15–60s | sangat hati-hati, pakai idempotency key/status check |
| Batch reconciliation | 5–10s | 60–300s | retry dengan backoff dan checkpoint |
| Health check | 0.5–2s | 1–3s | biasanya no retry |

---

## 12. SOAPAction

SOAP 1.1 sering memakai HTTP header `SOAPAction` untuk menunjukkan intent operation. Beberapa legacy endpoint sangat strict terhadap nilainya.

JAX-WS menyediakan property:

```java
ctx.put(BindingProvider.SOAPACTION_USE_PROPERTY, Boolean.TRUE);
ctx.put(BindingProvider.SOAPACTION_URI_PROPERTY, "urn:SubmitPayment");
```

Masalah umum:

- WSDL menyatakan SOAPAction kosong tetapi server butuh isi,
- SOAPAction case-sensitive di gateway legacy,
- quote handling berbeda,
- SOAP 1.1 vs 1.2 behavior berbeda,
- load balancer/gateway routing berdasarkan SOAPAction.

Troubleshooting:

1. capture raw HTTP request,
2. compare dengan SoapUI/Postman/curl yang berhasil,
3. periksa WSDL binding operation,
4. jangan hanya melihat Java method name.

---

## 13. Authentication Patterns untuk SOAP Client

SOAP client authentication bisa terjadi di beberapa layer.

### 13.1 HTTP Basic Auth

```java
ctx.put(BindingProvider.USERNAME_PROPERTY, username);
ctx.put(BindingProvider.PASSWORD_PROPERTY, password);
```

Cocok untuk legacy endpoint sederhana, tetapi harus selalu via TLS.

### 13.2 Mutual TLS

mTLS biasanya bukan dikontrol hanya dari JAX-WS API, tetapi dari JVM/container HTTP/TLS layer:

- keystore,
- truststore,
- client certificate,
- TLS protocol/cipher,
- hostname verification,
- custom SSL context jika supported.

Pada app server, ini sering diatur di server config. Pada standalone client, bisa melalui JVM property atau HTTP transport customization.

### 13.3 SOAP header token

Banyak sistem legacy memakai custom SOAP header:

```xml
<soapenv:Header>
  <auth:Credential xmlns:auth="urn:auth">
    <auth:Username>...</auth:Username>
    <auth:Token>...</auth:Token>
  </auth:Credential>
</soapenv:Header>
```

Ini bisa ditambahkan via:

- handler chain,
- provider-specific header API,
- SAAJ/Dispatch message manipulation,
- WS-Security framework.

### 13.4 WS-Security

Jika endpoint memakai WS-Security, authentication bisa melibatkan:

- UsernameToken,
- timestamp,
- nonce,
- XML Signature,
- XML Encryption,
- X.509 certificate,
- replay protection.

Ini tidak boleh diimplementasikan manual secara asal. Biasanya pakai stack seperti Metro WS-Security atau Apache CXF/WSS4J, sesuai container/runtime.

---

## 14. Handler Chain

### 14.1 Apa itu handler?

Handler chain memungkinkan client menjalankan logic sebelum/ setelah message dikirim/diterima.

Jenis umum:

- logical handler: bekerja pada payload/logical message,
- SOAP handler: bekerja pada SOAP message termasuk header/envelope.

Use case:

- correlation ID,
- custom SOAP header,
- audit metadata,
- logging sanitized,
- metrics,
- tracing,
- tenant header,
- request/response inspection,
- masking sensitive fields,
- fault enrichment.

### 14.2 SOAP handler contoh konseptual

```java
public final class CorrelationSoapHandler implements SOAPHandler<SOAPMessageContext> {
    @Override
    public boolean handleMessage(SOAPMessageContext context) {
        Boolean outbound = (Boolean) context.get(MessageContext.MESSAGE_OUTBOUND_PROPERTY);
        if (Boolean.TRUE.equals(outbound)) {
            addCorrelationHeader(context);
        }
        return true;
    }

    @Override
    public boolean handleFault(SOAPMessageContext context) {
        return true;
    }

    @Override
    public void close(MessageContext context) {
    }

    @Override
    public Set<QName> getHeaders() {
        return Set.of(new QName("urn:trace", "CorrelationId"));
    }

    private void addCorrelationHeader(SOAPMessageContext context) {
        // SAAJ manipulation omitted for clarity
    }
}
```

### 14.3 Handler ordering

Handler order matters:

```text
Outbound:
  application object
    → logical handlers
    → SOAP handlers
    → transport

Inbound:
  transport
    → SOAP handlers
    → logical handlers
    → application object
```

Jika ada security signing, logging harus hati-hati. Logging sebelum/ sesudah signing bisa menghasilkan message berbeda.

### 14.4 Handler anti-pattern

Jangan gunakan handler untuk:

- business logic utama,
- retry,
- database transaction,
- heavy blocking operation,
- parsing ulang seluruh payload besar untuk hal kecil,
- logging full PII/secret,
- menyembunyikan error agar caller mengira sukses.

Handler adalah cross-cutting message concern, bukan tempat service orchestration.

---

## 15. Logging SOAP Client dengan Aman

### 15.1 Jangan log full SOAP message secara default

SOAP payload sering berisi:

- identity number,
- name/address,
- credentials,
- token,
- financial amount,
- document metadata,
- case details,
- attachment reference,
- internal system code.

Full logging raw SOAP bisa melanggar security, privacy, dan audit policy.

### 15.2 Logging level yang sehat

Minimal log:

```text
operation=SubmitPayment
endpoint=payment-prod
correlationId=...
externalRequestId=...
durationMs=...
outcome=SUCCESS|FAULT|TIMEOUT|NETWORK_ERROR|UNMARSHAL_ERROR
faultCode=...
faultStringCategory=...
httpStatus=...
retryAttempt=...
```

Payload logging hanya:

- di lower environment,
- dengan masking,
- dengan size limit,
- dengan sampling,
- dengan explicit enablement,
- tidak menyimpan secret/PII.

### 15.3 Masking strategy

```text
<auth:Password>******</auth:Password>
<token>******</token>
<nric>******123A</nric>
<creditCard>************1111</creditCard>
```

Lebih baik masking berdasarkan XML path/QName daripada regex mentah jika memungkinkan.

---

## 16. Error Taxonomy: Jangan Semua Exception Dianggap Sama

SOAP client wrapper harus membedakan kategori error.

| Kategori | Contoh | Makna |
|---|---|---|
| Configuration error | WSDL missing, bad endpoint URL | Deploy/config salah |
| DNS/connect error | Unknown host, connection refused | Upstream unreachable |
| TLS error | cert expired, trust failure | Security/infra issue |
| Timeout | connect/read timeout | Upstream lambat/tidak responsif |
| HTTP error | 404/500/503 gateway | Transport-level failure |
| SOAP fault modeled | checked fault dari WSDL | Business/protocol error yang diketahui |
| SOAP fault unmodeled | `SOAPFaultException` | Server fault tidak termodel |
| Marshal error | Java → XML gagal | Client/request invalid/mapping bug |
| Unmarshal error | XML → Java gagal | Contract mismatch/bad response |
| Handler error | custom header/logging/security gagal | Client middleware failure |

### 16.1 Exception mapping wrapper

```java
public PaymentResult submit(PaymentCommand command) {
    try {
        PaymentRequest request = mapper.toSoap(command);
        PaymentResponse response = port.submitPayment(request);
        return mapper.toResult(response);
    } catch (PaymentFault modeledFault) {
        throw mapBusinessFault(modeledFault);
    } catch (SOAPFaultException unmodeledFault) {
        throw new ExternalProtocolException("SOAP fault", unmodeledFault);
    } catch (WebServiceException transportOrRuntime) {
        throw classifyWebServiceException(transportOrRuntime);
    } catch (RuntimeException unexpected) {
        throw new ExternalClientException("Unexpected SOAP client failure", unexpected);
    }
}
```

Jangan expose `SOAPFaultException` langsung ke domain/application layer.

---

## 17. SOAP Fault Client Handling

### 17.1 Modeled fault

Jika WSDL mendefinisikan fault, generated port method biasanya melempar checked exception.

```java
try {
    port.submitPayment(request);
} catch (InvalidPaymentFault e) {
    // known external business rejection
}
```

Ini biasanya harus dimap ke domain/application exception.

### 17.2 Unmodeled fault

Jika server mengirim SOAP fault yang tidak sesuai WSDL atau runtime tidak bisa map ke modeled fault, client bisa menerima `SOAPFaultException`.

```java
catch (SOAPFaultException e) {
    SOAPFault fault = e.getFault();
    QName code = fault.getFaultCodeAsQName();
    String text = fault.getFaultString();
}
```

Hati-hati: fault string bisa berisi informasi sensitif atau vendor-specific text. Jangan blindly expose ke user.

### 17.3 Fault bukan selalu failure teknis

SOAP fault bisa mewakili:

- validation rejection,
- authorization failure,
- duplicate request,
- business rule violation,
- downstream timeout di server,
- internal error.

Mapping harus berdasarkan `faultcode`, fault detail, dan kontrak partner, bukan hanya status HTTP.

---

## 18. Retry Boundary

### 18.1 Retry adalah keputusan semantik, bukan sekadar teknis

SOAP operation bisa:

- read-only,
- idempotent update,
- non-idempotent submit,
- asynchronous enqueue,
- payment/settlement operation,
- document upload,
- status query,
- cancellation.

Retry aman tergantung operasi.

| Operation | Retry default |
|---|---|
| `getStatus` | Aman dengan backoff |
| `search` | Biasanya aman |
| `submitApplication` | Hanya jika ada idempotency key/request id |
| `makePayment` | Sangat hati-hati; butuh idempotency/status check |
| `cancel` | Tergantung semantics; bisa idempotent jika contract menyatakan |
| `uploadDocument` | Butuh checksum/request id |

### 18.2 Retryable vs non-retryable

Biasanya retryable:

- connect timeout,
- connection reset sebelum request pasti diterima,
- HTTP 502/503/504,
- temporary DNS issue,
- read timeout untuk idempotent operation,
- transient gateway failure.

Biasanya non-retryable:

- validation fault,
- authentication fault,
- authorization fault,
- schema/marshal error,
- contract mismatch,
- duplicate business fault,
- bad request,
- invalid SOAPAction.

Ambiguous:

- read timeout setelah request terkirim untuk non-idempotent operation.

Ini bisa berarti server sudah memproses request tetapi response hilang. Solusinya bukan blind retry, tetapi **status inquiry** atau **idempotency key**.

### 18.3 Retry budget

Jangan desain retry seperti ini:

```text
3 retry × 60s timeout = thread bisa tertahan 180s+
```

Gunakan total budget:

```text
operation deadline = 20s
attempt 1 read timeout = 8s
attempt 2 read timeout = 8s
backoff = 500ms + jitter
leave room for mapping/response
```

---

## 19. Idempotency untuk SOAP Client

Jika kontrak SOAP tidak punya idempotency key, coba cari alternatif:

- business transaction id,
- external reference number,
- request UUID di header,
- unique document number,
- correlation id yang server simpan,
- `getStatusByReference` operation,
- duplicate fault yang bisa diperlakukan sebagai success-if-same-payload.

Pattern:

```text
Before submit:
  generate externalRequestId
  persist local OUTBOUND_REQUEST = PENDING

Submit:
  send SOAP request with externalRequestId

If success:
  mark SUCCESS with external response id

If timeout/unknown:
  mark UNKNOWN
  schedule status inquiry by externalRequestId

If duplicate fault:
  query status
  reconcile
```

Ini jauh lebih aman daripada retry buta.

---

## 20. Thread-Safety dan Lifecycle

### 20.1 `Service` vs port proxy

General practical rule:

- `Service` creation can be relatively expensive because it loads service metadata.
- Port proxy has mutable request context.
- Do not casually share one mutable port proxy across threads if you mutate request context per call.

Safer pattern:

```text
Cache Service or factory metadata
Create/configure port per logical client/context
Do not mutate shared port concurrently
```

### 20.2 Why shared port is dangerous

```java
BindingProvider bp = (BindingProvider) sharedPort;
bp.getRequestContext().put("X-Correlation-ID", correlationId);
sharedPort.submit(request);
```

Jika dua thread melakukan ini bersamaan, correlation ID atau endpoint/session/auth context bisa bercampur.

### 20.3 Port factory pattern

```java
public final class PaymentPortFactory {
    private final URL wsdlUrl;
    private final QName serviceName;
    private final SoapClientConfig config;

    public PaymentPort create(String correlationId) {
        PaymentService service = new PaymentService(wsdlUrl);
        PaymentPort port = service.getPaymentPort();
        BindingProvider bp = (BindingProvider) port;

        configureEndpoint(bp);
        configureTimeout(bp);
        configureCorrelation(bp, correlationId);

        return port;
    }
}
```

Jika service creation terbukti mahal, cache service object dengan tetap membuat/configure port secara hati-hati. Benchmark dan test thread-safety provider yang dipakai.

---

## 21. Session Maintenance

`BindingProvider.SESSION_MAINTAIN_PROPERTY` dapat digunakan untuk menjaga session transport-level seperti cookie session di beberapa SOAP services.

```java
ctx.put(BindingProvider.SESSION_MAINTAIN_PROPERTY, Boolean.TRUE);
```

Gunakan hanya jika service contract memang stateful.

SOAP client stateful berisiko:

- load-balanced endpoint butuh sticky session,
- port proxy tidak boleh dishare sembarangan,
- failover lebih sulit,
- retry makin ambigu,
- session expiry harus ditangani.

Default architectural preference: SOAP operation stateless dengan explicit correlation/reference ID.

---

## 22. Client-Side Headers

### 22.1 HTTP headers

Beberapa runtime menyediakan cara menambahkan HTTP headers via message context:

```java
Map<String, List<String>> headers = new HashMap<>();
headers.put("X-Correlation-ID", List.of(correlationId));
headers.put("X-Client-System", List.of("case-management"));

ctx.put(MessageContext.HTTP_REQUEST_HEADERS, headers);
```

Use case:

- correlation,
- API gateway routing,
- client id,
- tenant id,
- environment marker.

Jangan taruh secret sembarangan jika tidak ada policy jelas.

### 22.2 SOAP headers

SOAP headers adalah bagian dari message contract. Tambahkan melalui handler atau Dispatch/SAAJ.

Contoh konseptual:

```xml
<soapenv:Header>
  <trace:CorrelationId xmlns:trace="urn:trace">abc-123</trace:CorrelationId>
</soapenv:Header>
```

Jika header harus masuk signature, order dan timing handler/security stack menjadi penting.

---

## 23. Client-Side Validation

### 23.1 Validate before sending?

Keuntungan validate request against XSD sebelum kirim:

- fail fast,
- error lebih dekat ke caller,
- mengurangi rejected request ke partner,
- bagus untuk testing.

Kerugian:

- CPU overhead,
- schema loading complexity,
- risiko schema local tidak sama dengan partner,
- tidak semua business rule ada di XSD.

### 23.2 Recommended approach

- Di CI/test: validate generated XML terhadap XSD.
- Di production: validate selectively untuk high-risk operation atau saat debugging/configurable.
- Selalu validate domain command sebelum mapping SOAP.
- Jangan menggantungkan semua validasi ke partner.

---

## 24. Marshalling / Unmarshalling Failure

SOAP client failure tidak selalu network.

### 24.1 Marshal failure

Contoh penyebab:

- required XML element null,
- invalid enum value,
- unsupported type adapter,
- namespace mismatch,
- missing `ObjectFactory`,
- invalid `JAXBElement`,
- character not representable in encoding.

Ini biasanya client-side bug atau bad input.

### 24.2 Unmarshal failure

Contoh penyebab:

- partner mengirim field baru yang tidak kompatibel,
- schema berubah tanpa pemberitahuan,
- response namespace salah,
- SOAP body berisi HTML error page,
- proxy/gateway inject content,
- invalid XML character,
- wrong SOAP version,
- fault tidak sesuai WSDL.

Unmarshal failure sering menjadi sinyal contract drift.

---

## 25. Contract Drift Detection

Client SOAP harus punya mekanisme mendeteksi WSDL/XSD berubah.

### 25.1 Simpan contract artifact

```text
src/main/resources/wsdl/payment/payment.wsdl
src/main/resources/wsdl/payment/payment-types.xsd
src/test/resources/contracts/payment/expected-submit-request.xml
src/test/resources/contracts/payment/sample-submit-response.xml
```

### 25.2 Build-time generation harus deterministic

Jangan generate dari URL remote setiap build. Gunakan local pinned WSDL.

### 25.3 Diff strategy

Ketika partner memberi WSDL baru:

1. simpan sebagai versi baru,
2. diff WSDL dan XSD,
3. regenerate client di branch,
4. run compile,
5. run contract tests,
6. compare generated XML sample,
7. classify changes: compatible/breaking/unknown,
8. update mapper only if needed,
9. release adapter version.

### 25.4 Compatibility matrix

| Change | Client impact |
|---|---|
| Add optional element at end | Usually compatible |
| Add required element | Breaking for request generation |
| Remove response element | Breaking if client expects it |
| Rename element | Breaking |
| Change namespace | Breaking |
| Change type string → int | Breaking |
| Add enum value | Could break if enum generated strictly |
| Change SOAPAction | Could break routing |
| Change endpoint only | Runtime config update if endpoint externalized |
| Add operation | Compatible |
| Remove operation | Breaking if used |

---

## 26. Testing SOAP Client

### 26.1 Unit test mapper

Mapper test harus tidak butuh network.

```java
@Test
void mapsCommandToSoapRequest() {
    PaymentCommand command = sampleCommand();
    PaymentRequest request = mapper.toSoap(command);

    assertEquals("SGD", request.getCurrency());
    assertEquals(new BigDecimal("10.00"), request.getAmount());
}
```

### 26.2 XML golden master test

Marshal generated request menjadi XML, compare dengan expected XML secara XML-aware.

Jangan compare raw string jika whitespace/order namespace prefix tidak stabil. Compare:

- XPath,
- canonical XML jika perlu,
- XMLUnit-like diff,
- schema validation.

### 26.3 Mock SOAP server

Gunakan mock HTTP server yang mengembalikan SOAP response/fault.

Test:

- success response,
- modeled fault,
- unmodeled fault,
- HTTP 500 with SOAP fault,
- HTTP 503 without SOAP fault,
- timeout,
- invalid XML,
- wrong namespace,
- slow response,
- connection reset.

### 26.4 Contract test dengan partner sandbox

Jalankan terjadwal atau pre-release:

- real endpoint UAT/sandbox,
- real TLS/cert,
- real authentication,
- minimal safe payload,
- idempotent operation jika memungkinkan,
- record latency and fault.

---

## 27. Observability

SOAP client harus expose telemetry yang memisahkan failure.

### 27.1 Metrics

```text
soap.client.requests.total{operation,outcome}
soap.client.duration.ms{operation,endpoint}
soap.client.faults.total{operation,fault_code}
soap.client.timeouts.total{operation,type}
soap.client.retries.total{operation,result}
soap.client.payload.size.bytes{operation,direction}
```

### 27.2 Logs

Gunakan structured logs:

```json
{
  "event": "soap_client_call",
  "operation": "SubmitPayment",
  "endpointAlias": "payment-prod",
  "correlationId": "abc-123",
  "durationMs": 812,
  "outcome": "SOAP_FAULT",
  "faultCode": "Client.Validation",
  "externalReference": "PAY-2026-0001"
}
```

### 27.3 Tracing

Jika memakai distributed tracing, treat SOAP call sebagai outbound span:

```text
span.name = SOAP PaymentService.SubmitPayment
peer.service = payment-provider
net.peer.name = host
soap.operation = SubmitPayment
```

Trace context bisa dikirim via HTTP header atau SOAP header jika partner mendukung.

---

## 28. Performance Considerations

### 28.1 Cost centers

SOAP client cost berasal dari:

- XML parsing,
- JAXB marshal/unmarshal,
- namespace processing,
- schema validation,
- SAAJ DOM-like message model,
- WS-Security canonicalization/signature,
- TLS handshake,
- HTTP connection setup,
- attachments/MTOM,
- logging raw payload.

### 28.2 Avoid repeated expensive setup

Hindari:

```java
// buruk jika dilakukan setiap call tanpa alasan
URL wsdl = new URL(remoteWsdlUrl);
PaymentService service = new PaymentService(wsdl);
PaymentPort port = service.getPaymentPort();
```

Lebih baik punya client factory dengan caching metadata yang aman.

### 28.3 Payload size

Untuk payload besar:

- jangan full log,
- consider MTOM untuk binary,
- hindari repeated DOM transform,
- gunakan streaming jika menggunakan Dispatch/Source,
- set memory limit di parser/security layer,
- monitor heap allocation.

---

## 29. SOAP Client in Spring Boot / Standalone Java

SOAP client Jakarta XML Web Services bisa dipakai di luar full Jakarta EE app server, tetapi harus membawa runtime.

Prinsip:

```text
Spring Boot app
  → dependency JAX-WS runtime explicit
  → generated client classes
  → configuration properties
  → client wrapper bean
  → observability/retry/circuit breaker at wrapper layer
```

Contoh wrapper bean konseptual:

```java
@Configuration
public class PaymentSoapClientConfiguration {

    @Bean
    PaymentGatewayClient paymentGatewayClient(
        PaymentSoapProperties properties,
        PaymentSoapMapper mapper
    ) {
        PaymentPortFactory factory = new PaymentPortFactory(properties);
        return new PaymentGatewayClient(factory, mapper);
    }
}
```

Jangan biarkan controller/service langsung memanggil generated port.

---

## 30. Circuit Breaker dan Bulkhead

SOAP legacy endpoint sering lambat/tidak stabil. Tambahkan protection di layer wrapper:

- timeout,
- circuit breaker,
- bulkhead/thread pool isolation,
- rate limiter,
- retry with jitter,
- fallback hanya jika business-safe,
- queue untuk async operation.

### 30.1 Bulkhead penting

Jika semua request web thread bisa block di SOAP endpoint, satu partner outage bisa menjatuhkan seluruh aplikasi.

Pattern:

```text
HTTP request thread
  → application service
  → limited executor / bulkhead
  → SOAP client
```

Atau untuk operation non-interactive:

```text
request accepted
  → persist outbound job
  → worker calls SOAP
  → status eventually updated
```

---

## 31. Async SOAP Client Strategy

JAX-WS historically mendukung async client pattern di beberapa bentuk, tetapi di production modern sering lebih jelas memakai application-level async:

```text
Persist request
Publish job/event
Worker invokes SOAP
Persist response/fault
Expose status endpoint/UI
```

Keuntungan:

- retry lebih terkendali,
- idempotency lebih mudah,
- audit trail jelas,
- user tidak menunggu lama,
- failure bisa direkonsiliasi,
- backpressure lebih aman.

Cocok untuk:

- submit application,
- send document,
- regulatory filing,
- reconciliation,
- batch sync,
- external notification.

Tidak cocok untuk:

- low-latency read yang harus immediate,
- operation yang partner hanya izinkan synchronous dan user harus melihat hasil langsung.

---

## 32. Versioning Generated Clients

Jika ada banyak versi WSDL:

```text
com.example.partner.payment.v1
com.example.partner.payment.v2
```

Jangan generate dua versi ke package sama.

Adapter bisa memilih versi:

```java
interface PaymentGateway {
    PaymentResult submit(PaymentCommand command);
}

final class PaymentGatewayV1SoapClient implements PaymentGateway { ... }
final class PaymentGatewayV2SoapClient implements PaymentGateway { ... }
```

Migration strategy:

1. support v1 and v2 side-by-side,
2. route by tenant/env/feature flag,
3. compare responses in shadow mode jika safe,
4. cutover gradually,
5. keep rollback path,
6. remove v1 setelah contract retired.

---

## 33. Jakarta EE 11 Reality Check

Jakarta XML Web Services 4.0 adalah release untuk Jakarta EE 10. Namun Jakarta EE 11 menghapus beberapa spesifikasi seperti XML Web Services, XML Binding, dan SOAP with Attachments dari Platform utama. Artinya, untuk runtime modern tertentu, SOAP stack bisa tidak tersedia by default walau aplikasi masih Java/Jakarta.

Konsekuensi:

- jangan assume app server selalu menyediakan JAX-WS runtime,
- dependency eksplisit makin penting,
- pilih implementation yang kompatibel dengan target runtime,
- migration plan harus include SOAP stack validation,
- smoke test SOAP client di runtime target, bukan hanya compile.

---

## 34. Migration Java 8 → Java 11+ → Java 25

### 34.1 Java 8

Legacy baseline:

- `javax.xml.ws` sering available,
- `wsimport` dari JDK sering dipakai,
- JAXB/JAX-WS/SAAJ dianggap bagian platform,
- banyak code sample lama valid di Java 8.

### 34.2 Java 9/10

Modules Java EE/CORBA deprecated for removal.

### 34.3 Java 11+

JAX-WS/JAXB/SAAJ modules removed from JDK. Dependency/tooling harus eksplisit.

### 34.4 Java 17/21/25

Prinsip sama:

- explicit dependencies,
- no reliance on removed JDK modules,
- check reflective access/JPMS if using modules,
- choose runtime maintained,
- test code generation tool compatibility,
- check TLS defaults/cert algorithms,
- test under production JVM flags.

### 34.5 Migration checklist

```text
[ ] Inventory all imports: javax.xml.ws, javax.jws, javax.xml.bind, javax.xml.soap
[ ] Identify runtime provider: JDK bundled? app server? Metro? CXF? vendor?
[ ] Pin WSDL/XSD locally
[ ] Regenerate clients using compatible tool
[ ] Decide namespace: stay javax or migrate jakarta
[ ] Add explicit API/runtime dependencies
[ ] Add JAXB runtime dependencies
[ ] Test startup without remote WSDL
[ ] Test endpoint override
[ ] Test timeout behavior
[ ] Test SOAP fault mapping
[ ] Test TLS/mTLS
[ ] Test handler chain
[ ] Test payload marshalling/unmarshalling
[ ] Test in target container/JVM
```

---

## 35. SOAP Client Design Blueprint

Production-grade client biasanya punya struktur seperti ini:

```text
payment-integration/
  src/main/resources/wsdl/payment/payment.wsdl
  src/main/resources/wsdl/payment/types.xsd

  generated/
    com.example.partner.payment.v1.*

  adapter/
    PaymentGatewayClient
    PaymentPortFactory
    PaymentSoapMapper
    PaymentFaultMapper
    JaxWsTimeoutConfigurer
    SoapHeaderHandler
    SoapClientMetrics

  domain-facing/
    PaymentGateway
    PaymentCommand
    PaymentResult
    PaymentGatewayException
```

Runtime flow:

```text
Domain/Application
  ↓ command
PaymentGatewayClient
  ↓ map
Generated SOAP request
  ↓ invoke
JAX-WS port proxy / Dispatch
  ↓ SOAP envelope
Transport/TLS
  ↓
External endpoint
  ↓ response/fault
Unmarshal
  ↓ map
Domain result/exception
```

---

## 36. Example: Clean SOAP Client Wrapper

```java
public final class PaymentGatewayClient implements PaymentGateway {
    private final PaymentPortFactory portFactory;
    private final PaymentSoapMapper mapper;
    private final PaymentFaultMapper faultMapper;

    public PaymentGatewayClient(
        PaymentPortFactory portFactory,
        PaymentSoapMapper mapper,
        PaymentFaultMapper faultMapper
    ) {
        this.portFactory = portFactory;
        this.mapper = mapper;
        this.faultMapper = faultMapper;
    }

    @Override
    public PaymentResult submit(PaymentCommand command) {
        String correlationId = command.correlationId();
        PaymentPort port = portFactory.create(correlationId);

        long start = System.nanoTime();
        try {
            PaymentRequest request = mapper.toSoapRequest(command);
            PaymentResponse response = port.submitPayment(request);
            return mapper.toDomainResult(response);
        } catch (InvalidPaymentFault e) {
            throw faultMapper.mapInvalidPayment(e);
        } catch (SOAPFaultException e) {
            throw faultMapper.mapUnmodeledSoapFault(e);
        } catch (WebServiceException e) {
            throw faultMapper.mapTransportOrRuntime(e);
        } finally {
            long durationMs = (System.nanoTime() - start) / 1_000_000;
            // record metrics/logs without sensitive payload
        }
    }
}
```

`PaymentGateway` interface:

```java
public interface PaymentGateway {
    PaymentResult submit(PaymentCommand command);
}
```

Domain tidak tahu SOAP.

---

## 37. Example: Port Factory

```java
public final class PaymentPortFactory {
    private final URL wsdlUrl;
    private final SoapClientConfig config;

    public PaymentPortFactory(URL wsdlUrl, SoapClientConfig config) {
        this.wsdlUrl = wsdlUrl;
        this.config = config;
    }

    public PaymentPort create(String correlationId) {
        PaymentService service = new PaymentService(wsdlUrl);
        PaymentPort port = service.getPaymentPort();

        BindingProvider bp = (BindingProvider) port;
        configureEndpoint(bp);
        configureTimeout(bp);
        configureHttpHeaders(bp, correlationId);
        configureSoapActionIfNeeded(bp);

        return port;
    }

    private void configureEndpoint(BindingProvider bp) {
        bp.getRequestContext().put(
            BindingProvider.ENDPOINT_ADDRESS_PROPERTY,
            config.endpointUrl()
        );
    }

    private void configureTimeout(BindingProvider bp) {
        JaxWsTimeoutConfigurer.configure(
            bp,
            config.connectTimeout(),
            config.readTimeout()
        );
    }

    private void configureHttpHeaders(BindingProvider bp, String correlationId) {
        Map<String, List<String>> headers = new HashMap<>();
        headers.put("X-Correlation-ID", List.of(correlationId));
        headers.put("X-Client-System", List.of(config.clientSystemName()));
        bp.getRequestContext().put(MessageContext.HTTP_REQUEST_HEADERS, headers);
    }

    private void configureSoapActionIfNeeded(BindingProvider bp) {
        if (config.soapAction() != null) {
            bp.getRequestContext().put(BindingProvider.SOAPACTION_USE_PROPERTY, Boolean.TRUE);
            bp.getRequestContext().put(BindingProvider.SOAPACTION_URI_PROPERTY, config.soapAction());
        }
    }
}
```

Catatan: jika service creation mahal, factory bisa meng-cache `PaymentService`, tetapi tetap hati-hati dengan port/request context mutability.

---

## 38. Example: Dispatch Client for Raw SOAP

```java
public final class RawSoapDispatchClient {
    private final Service service;
    private final QName portName;
    private final String endpointUrl;

    public RawSoapDispatchClient(URL wsdlUrl, QName serviceName, QName portName, String endpointUrl) {
        this.service = Service.create(wsdlUrl, serviceName);
        this.portName = portName;
        this.endpointUrl = endpointUrl;
    }

    public SOAPMessage invoke(SOAPMessage request) {
        Dispatch<SOAPMessage> dispatch = service.createDispatch(
            portName,
            SOAPMessage.class,
            Service.Mode.MESSAGE
        );

        BindingProvider bp = dispatch;
        bp.getRequestContext().put(BindingProvider.ENDPOINT_ADDRESS_PROPERTY, endpointUrl);

        return dispatch.invoke(request);
    }
}
```

Gunakan untuk:

- troubleshooting,
- bridge/gateway,
- custom headers,
- raw message preservation,
- operation yang generated mapping-nya bermasalah.

Jangan gunakan untuk semua hal jika typed proxy sudah cukup dan contract stabil.

---

## 39. Common Production Failure Patterns

### 39.1 Works in SoapUI, fails in Java

Kemungkinan:

- SOAPAction berbeda,
- namespace prefix/URI berbeda,
- missing header,
- TLS truststore berbeda,
- client certificate tidak dikirim,
- proxy setting berbeda,
- HTTP header berbeda,
- generated client memakai endpoint dari WSDL lama,
- timestamp/security header beda,
- content-type SOAP 1.1 vs 1.2 mismatch.

### 39.2 Works in local, fails in server

Kemungkinan:

- app server menyediakan JAX-WS implementation berbeda,
- classloader conflict,
- `javax`/`jakarta` mismatch,
- truststore server beda,
- outbound firewall,
- DNS/proxy config,
- module dependency missing,
- WSDL resource path case-sensitive di Linux.

### 39.3 Timeout ignored

Kemungkinan:

- wrong property name for runtime,
- property type salah: String vs Integer,
- set pada service bukan port,
- set setelah call,
- container overrides HTTP transport,
- using different provider than expected.

### 39.4 SOAP fault tidak termap ke checked exception

Kemungkinan:

- fault detail namespace berbeda,
- WSDL fault definition tidak cocok,
- server mengirim unmodeled fault,
- SOAP version mismatch,
- generated class dari WSDL lama,
- fault wrapper element berubah.

### 39.5 Memory spike

Kemungkinan:

- huge SOAP body,
- attachment tidak streaming,
- full raw logging,
- SAAJ builds full message tree,
- JAXB object graph besar,
- XML security/signature processing,
- repeated service/model creation.

---

## 40. Decision Matrix

### 40.1 Proxy vs Dispatch

| Question | Prefer proxy | Prefer Dispatch |
|---|---|---|
| Need type-safe operation? | Yes | No |
| Need raw SOAP envelope control? | No | Yes |
| WSDL stable? | Yes | Maybe no |
| Need preserve unknown headers? | Hard | Easier |
| Building gateway? | Maybe | Often yes |
| Domain service integration? | Yes | Only behind adapter |
| Debugging/probing? | Maybe | Yes |

### 40.2 Synchronous vs asynchronous wrapper

| Question | Sync | Async/job-based |
|---|---|---|
| User needs immediate answer? | Yes | No |
| Operation slow? | Maybe no | Yes |
| Retry/reconciliation needed? | Harder | Easier |
| Non-idempotent submit? | Risky | Safer with persisted state |
| Batch integration? | No | Yes |

### 40.3 Runtime choice

| Runtime | Consideration |
|---|---|
| Full Jakarta EE server | Check whether XML Web Services included/supported in target version/vendor |
| Spring Boot standalone | Bring explicit JAX-WS runtime/provider |
| Java 8 legacy | Beware future migration; isolate generated code |
| Java 17/21/25 | Explicit dependencies; test provider compatibility |
| Cloud/Kubernetes | Externalize endpoint/cert/config; add observability/timeouts |

---

## 41. Production Checklist

```text
Contract
[ ] WSDL/XSD stored locally and versioned
[ ] Generated source is deterministic
[ ] Generated package includes version namespace
[ ] WSDL endpoint is not hardcoded for production
[ ] Contract diff process exists

Runtime
[ ] JAX-WS/JAXB/SAAJ dependencies explicit for Java 11+
[ ] javax/jakarta namespace consistent
[ ] Runtime provider identified and documented
[ ] Startup does not require remote WSDL
[ ] Tested in target JVM/container

Configuration
[ ] Endpoint URL externalized
[ ] Connect timeout set and tested
[ ] Read timeout set and tested
[ ] SOAPAction configured if required
[ ] TLS/mTLS config tested
[ ] Auth/header config externalized securely

Reliability
[ ] Error taxonomy implemented
[ ] Modeled/unmodeled faults mapped
[ ] Retry policy operation-specific
[ ] Idempotency/status inquiry designed for non-idempotent calls
[ ] Circuit breaker/bulkhead applied where needed
[ ] Async job pattern considered for slow operations

Security
[ ] No full payload logging in production by default
[ ] PII/secret masking implemented
[ ] TLS certificate validation enabled
[ ] No disabled hostname verification in production
[ ] SOAP headers/security tokens handled safely
[ ] XML parser/security limits inherited from stack or explicitly configured where applicable

Observability
[ ] Correlation ID sent and logged
[ ] Metrics per operation/outcome
[ ] Duration recorded
[ ] Fault codes categorized
[ ] Timeout/retry counters available
[ ] Raw message debug controlled and audited

Testing
[ ] Mapper unit tests
[ ] Golden XML tests
[ ] Mock server success/fault/timeout tests
[ ] TLS/auth test
[ ] Partner sandbox smoke test
[ ] Contract drift test/regeneration test
```

---

## 42. Key Takeaways

1. SOAP client is not a local method call; it is a distributed protocol boundary.
2. Generated proxy is best for stable WSDL and type-safe integration.
3. `Dispatch` is best for raw message control, gateway use cases, and difficult legacy edge cases.
4. Generated classes are contract adapter types, not domain model.
5. Always externalize endpoint address from WSDL metadata.
6. Always configure and test timeout behavior in the actual runtime provider.
7. `BindingProvider` is the main runtime control surface for endpoint, context, auth, SOAPAction, and headers.
8. Retry must be based on operation semantics and idempotency, not generic exception handling.
9. SOAP faults must be classified into business/protocol/technical categories.
10. Java 11+ requires explicit JAX-WS/JAXB/SAAJ dependencies; do not rely on removed JDK modules.
11. `javax`/`jakarta` migration must be consistent across generated code, dependencies, runtime, and container.
12. Production SOAP clients need observability, masking, circuit breaker, and contract drift testing.

---

## 43. Latihan Praktis

### Latihan 1 — Generated Client Boundary

Ambil satu WSDL sample. Generate client ke package `partner.payment.v1`. Buat wrapper domain-facing:

```java
interface PaymentGateway {
    PaymentResult submit(PaymentCommand command);
}
```

Pastikan tidak ada generated class muncul di layer controller/domain/application service.

### Latihan 2 — Endpoint Override

Package WSDL lokal sebagai resource. Jalankan test yang membuktikan endpoint runtime bisa diarahkan ke mock server tanpa mengubah WSDL.

### Latihan 3 — Timeout Proof

Buat mock server yang delay 10 detik. Set read timeout 2 detik. Buktikan call gagal sekitar 2 detik di runtime yang dipakai.

### Latihan 4 — Fault Mapping

Mock tiga response:

1. success,
2. modeled SOAP fault,
3. unmodeled SOAP fault.

Pastikan wrapper menghasilkan exception domain yang berbeda.

### Latihan 5 — Retry Safety

Pilih satu operation non-idempotent. Desain state machine:

```text
PENDING → SENT → SUCCESS
              ↘ UNKNOWN → INQUIRY_PENDING → RECONCILED
              ↘ FAILED_FINAL
```

Tentukan kapan retry langsung boleh, kapan harus status inquiry.

---

## 44. Referensi Utama

- Jakarta XML Web Services 4.0 Specification  
  https://jakarta.ee/specifications/xml-web-services/4.0/

- Jakarta XML Web Services API Docs  
  https://jakarta.ee/specifications/xml-web-services/4.0/apidocs/

- `BindingProvider` API  
  https://jakarta.ee/specifications/xml-web-services/4.0/apidocs/jakarta.xml.ws/jakarta/xml/ws/bindingprovider

- `Dispatch` API  
  https://jakarta.ee/specifications/xml-web-services/3.0/apidocs/jakarta.xml.ws/jakarta/xml/ws/dispatch

- Jakarta EE Tutorial — Building Web Services with Jakarta XML Web Services  
  https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/jaxws/jaxws.html

- Eclipse Metro / Jakarta XML Web Services implementation  
  https://eclipse-ee4j.github.io/metro-jax-ws/

- OpenJDK JEP 320 — Remove the Java EE and CORBA Modules  
  https://openjdk.org/jeps/320

---

## 45. Penutup Part 25

Di bagian ini, kita melihat SOAP client sebagai **contract adapter + distributed reliability boundary**. Ini jauh lebih penting daripada sekadar tahu `wsimport` atau `service.getPort()`.

Client SOAP yang matang punya:

- contract pinned,
- generated code isolated,
- endpoint configurable,
- timeout terbukti,
- retry semantik,
- fault taxonomy,
- observability,
- security-aware logging,
- migration path Java/Jakarta yang jelas.

Bagian berikutnya akan memperdalam sisi error: **Part 26 — SOAP Faults, Errors & Resilience**.

Status seri: **belum selesai**.  
Part ini adalah **Part 25 dari 34**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-json-xml-soap-connectors-enterprise-integration — Part 24](./learn-java-json-xml-soap-connectors-enterprise-integration-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 26 — SOAP Faults, Errors & Resilience](./learn-java-json-xml-soap-connectors-enterprise-integration-part-026.md)
