# learn-java-json-xml-soap-connectors-enterprise-integration — Part 12
# XML Fundamentals for Java Engineers

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Part: `012 / 034`  
> Topik: XML fundamentals, XML infoset, namespace, QName, element vs attribute, text/mixed content, entity, encoding, canonical mental model  
> Target Java: Java 8 sampai Java 25  
> Fokus: mental model dan foundation sebelum DOM/SAX/StAX, XSD, JAXB, SOAP, WS-Security, dan connector legacy integration

---

## 0. Posisi Part Ini Dalam Series

Kita sudah menutup blok JSON:

1. JSON ecosystem.
2. JSON-P object model.
3. JSON-P streaming.
4. JSON Pointer/Patch/Merge Patch.
5. JSON-P production patterns.
6. JSON-B core.
7. JSON-B annotation.
8. JSON-B customization/provider internals.
9. JSON-B DTO design.
10. JSON security & robustness.

Sekarang kita masuk ke XML.

Kesalahan umum engineer modern adalah melihat XML hanya sebagai:

```text
JSON yang lebih verbose + namespace yang menyebalkan.
```

Itu framing yang salah.

XML bukan sekadar format key-value. XML adalah keluarga teknologi kontrak dokumen yang punya:

- struktur pohon,
- nama terqualified namespace,
- text node,
- attribute,
- processing instruction,
- comment,
- entity,
- DTD,
- XML Schema,
- XPath,
- XSLT,
- canonicalization,
- signature,
- encryption,
- SOAP envelope,
- WSDL contract,
- policy,
- attachment,
- dan banyak runtime behavior yang tidak terlihat dari string XML mentah.

Kalau JSON lebih sering dipakai sebagai **data object interchange**, XML sering dipakai sebagai **document and contract language**.

Di enterprise legacy, finance, government, insurance, telco, healthcare, logistics, dan integration middleware, XML masih bertahan bukan karena “orang belum move on”, tetapi karena XML punya kemampuan yang memang tidak digantikan langsung oleh JSON:

- dokumen dengan mixed content,
- schema kuat,
- namespace composability,
- validasi kompleks,
- signature canonicalization,
- SOAP/WSDL contract,
- extensibility via wildcard,
- dan toolchain kontrak yang sudah lama stabil.

Part ini adalah fondasi mental. Belum fokus pada Java API seperti DOM, SAX, StAX, JAXB. Itu akan masuk di part berikutnya. Di sini kita memastikan model berpikirnya benar.

---

## 1. Learning Objectives

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan XML sebagai **tree of information items**, bukan sekadar string markup.
2. Membedakan:
   - lexical XML,
   - parsed XML,
   - XML infoset,
   - object binding model.
3. Memahami kenapa namespace adalah inti interoperability XML.
4. Menjelaskan QName dan expanded name dengan benar.
5. Membedakan element, attribute, text node, comment, processing instruction, CDATA, entity, dan DTD.
6. Memilih kapan data harus menjadi element dan kapan menjadi attribute.
7. Memahami whitespace, encoding, escaping, dan normalization traps.
8. Menjelaskan kenapa XML bisa menjadi attack surface besar.
9. Membaca XML legacy enterprise tanpa panik ketika bertemu namespace, schema, SOAP envelope, dan generated class.
10. Menyiapkan mental model untuk DOM/SAX/StAX, XSD, JAXB, SOAP, dan WS-Security.

---

## 2. XML Dalam Satu Kalimat yang Benar

XML adalah **standardized markup language untuk merepresentasikan structured information sebagai dokumen hierarkis yang dapat diproses mesin, dengan extensibility melalui element/attribute/namespaces dan ekosistem validasi, query, transformasi, serta security di atasnya**.

Kalimat itu panjang karena XML memang bukan satu hal saja.

XML adalah fondasi untuk banyak teknologi:

```text
XML document
  ├─ XML Namespace
  ├─ DTD
  ├─ XML Schema / XSD
  ├─ XPath
  ├─ XSLT
  ├─ DOM / SAX / StAX
  ├─ JAXB / Jakarta XML Binding
  ├─ SOAP
  ├─ WSDL
  ├─ WS-Security
  ├─ SAML
  ├─ SVG
  ├─ Office Open XML
  └─ many regulatory / government / financial message standards
```

Jadi saat kita belajar XML di Java, sebenarnya kita belajar beberapa layer:

```text
Layer 1 — Lexical syntax
  <case id="123">...</case>

Layer 2 — Parsed tree / events
  startElement(case), attribute(id), characters(...), endElement(case)

Layer 3 — Information model
  document item, element item, attribute item, namespace item, text item

Layer 4 — Schema contract
  what elements exist, in what order, with what type, optionality, constraints

Layer 5 — Binding model
  XML <-> Java object

Layer 6 — Protocol model
  SOAP/WSDL/WS-* contracts

Layer 7 — Runtime integration model
  parser, validator, marshaller, transport, security, transaction, connector
```

Engineer yang hanya paham layer 1 akan mudah salah saat debugging SOAP, JAXB, XSD, atau XML Signature.

---

## 3. XML Bukan JSON: Perbedaan Mental Model

### 3.1 JSON adalah object-ish data model

JSON natural model:

```json
{
  "caseId": "C-001",
  "status": "OPEN",
  "amount": 123.45,
  "tags": ["urgent", "external"]
}
```

Mental model JSON:

```text
object
  key -> value
  key -> value
  key -> array
```

JSON cocok untuk:

- API modern,
- DTO sederhana,
- event payload,
- configuration,
- browser interop,
- service-to-service REST/gRPC-adjacent boundary.

### 3.2 XML adalah document tree model

XML natural model:

```xml
<case id="C-001" xmlns="urn:example:case:v1">
  <status>OPEN</status>
  <amount currency="SGD">123.45</amount>
  <tags>
    <tag>urgent</tag>
    <tag>external</tag>
  </tags>
</case>
```

Mental model XML:

```text
document
  element case {namespace urn:example:case:v1}
    attribute id = C-001
    element status
      text OPEN
    element amount
      attribute currency = SGD
      text 123.45
    element tags
      element tag
        text urgent
      element tag
        text external
```

XML cocok untuk:

- document-oriented data,
- schema-rich contract,
- legacy enterprise messaging,
- SOAP/WSDL,
- standards with namespaces,
- digital signature/encryption scenarios,
- transformation pipelines,
- mixed human/machine document.

### 3.3 XML punya dimensi yang JSON tidak punya secara native

| Concern | JSON | XML |
|---|---|---|
| Key/value object | Native | Bisa, tapi bukan satu-satunya model |
| Attribute | Tidak ada | Native |
| Namespace | Tidak ada native | Fundamental |
| Mixed content | Tidak natural | Native |
| Comments | Tidak ada dalam JSON standar | Ada |
| Processing instruction | Tidak ada | Ada |
| DTD/entity | Tidak ada | Ada |
| Schema language | JSON Schema eksternal | DTD, XSD, Relax NG, Schematron |
| XPath query | Tidak native | Mature |
| XSLT transform | Tidak native | Mature |
| Canonicalization | RFC 8785 ada untuk JSON | XML C14N mature dan dipakai signature |
| SOAP/WSDL | Tidak native | Native ecosystem |

Implikasinya: jangan mendesain XML seperti JSON dengan angle bracket. Kalau sistem eksternal memberi XML yang kaya namespace/schema, hormati model XML-nya.

---

## 4. XML Sebagai Dokumen, Bukan Hanya Data

Kata “document” penting.

Dalam JSON, payload biasanya dianggap data object:

```json
{
  "name": "Fajar",
  "role": "Tech Lead"
}
```

Dalam XML, payload bisa menjadi dokumen dengan struktur semantik:

```xml
<letter xmlns="urn:example:letter:v1">
  <recipient>Fajar</recipient>
  <body>
    Dear <emphasis>Fajar</emphasis>, your case has been approved.
  </body>
</letter>
```

`body` di atas bukan hanya field string. Ia punya mixed content:

```text
text "Dear "
element emphasis
text ", your case has been approved."
```

Kalau kamu bind ini secara naif ke:

```java
class Letter {
    String recipient;
    String body;
}
```

kamu kehilangan struktur.

Di enterprise, ini muncul pada:

- correspondence template,
- document generation,
- regulatory notice,
- SOAP header extension,
- SAML assertion,
- XBRL/finance report,
- healthcare narrative document,
- e-government form submission,
- legal/case document fragments.

XML kuat karena bisa memodelkan data dan dokumen sekaligus.

---

## 5. Lexical XML vs Parsed XML vs Infoset

Ini salah satu mental model terpenting.

### 5.1 Lexical XML

Lexical XML adalah bentuk string/byte yang kamu lihat:

```xml
<case id="C-001"><status>OPEN</status></case>
```

Di level lexical, hal-hal seperti ini terlihat berbeda:

```xml
<case id="C-001">
  <status>OPEN</status>
</case>
```

```xml
<case id='C-001'><status><![CDATA[OPEN]]></status></case>
```

```xml
<c:case xmlns:c="urn:case" id="C-001">
  <c:status>OPEN</c:status>
</c:case>
```

### 5.2 Parsed XML

Parser membaca lexical XML menjadi struktur:

```text
start document
start element case
attribute id = C-001
start element status
characters OPEN
end element status
end element case
end document
```

Di sini beberapa perbedaan lexical mungkin hilang.

Contoh:

```xml
<status><![CDATA[OPEN]]></status>
```

Setelah parsing, CDATA biasanya menjadi character data `OPEN`. Banyak API tidak mempertahankan fakta bahwa teks aslinya ditulis dalam CDATA.

### 5.3 XML Infoset

XML Information Set adalah cara formal untuk menjelaskan informasi apa yang tersedia setelah XML diparse. Ia berbicara tentang information item seperti:

- document information item,
- element information item,
- attribute information item,
- namespace information item,
- processing instruction information item,
- unexpanded entity reference information item,
- character information item,
- comment information item.

Kenapa ini penting?

Karena banyak teknologi XML tidak peduli bentuk string asli. Mereka peduli informasi setelah parsing.

Contoh:

```xml
<a xmlns:x="urn:test" x:id="123"/>
```

Bagi XML namespace-aware processor, attribute itu bukan sekadar `x:id`, tetapi expanded name:

```text
namespace URI = urn:test
local name    = id
prefix        = x
value         = 123
```

Prefix `x` adalah lexical alias. Namespace URI + local name adalah identitas semantik.

### 5.4 Binding Model

JAXB/Jakarta XML Binding menambahkan layer lain:

```xml
<case id="C-001">
  <status>OPEN</status>
</case>
```

menjadi:

```java
CaseDto dto = new CaseDto();
dto.id = "C-001";
dto.status = Status.OPEN;
```

Saat sudah masuk object binding, semakin banyak informasi XML bisa hilang:

- urutan element,
- whitespace,
- comment,
- processing instruction,
- unknown extension,
- prefix asli,
- CDATA boundary,
- attribute order,
- entity reference boundary.

Itu bukan bug. Itu konsekuensi binding.

Top 1% engineer harus tahu di layer mana informasi hilang.

---

## 6. XML Well-Formed vs Valid

Dua istilah ini sering tertukar.

### 6.1 Well-formed XML

XML well-formed berarti dokumen mematuhi aturan syntax dasar XML.

Contoh valid secara syntax:

```xml
<case>
  <status>OPEN</status>
</case>
```

Contoh tidak well-formed:

```xml
<case>
  <status>OPEN</case>
</status>
```

Masalah:

- tag tidak tertutup benar,
- nesting salah,
- attribute tidak diberi quote,
- hanya boleh satu root element,
- karakter ilegal,
- entity tidak didefinisikan,
- namespace declaration invalid.

Kalau tidak well-formed, parser harus gagal.

### 6.2 Valid XML

XML valid berarti dokumen well-formed dan sesuai schema/DTD.

Contoh XML:

```xml
<case>
  <status>OPEN</status>
</case>
```

Bisa well-formed tapi tidak valid jika schema mewajibkan:

```xml
<case>
  <caseId>...</caseId>
  <status>...</status>
  <createdAt>...</createdAt>
</case>
```

Validasi tergantung kontrak:

- DTD,
- XSD,
- Relax NG,
- Schematron,
- custom validation code.

### 6.3 Production implication

Pipeline XML ideal biasanya punya stage:

```text
bytes
  -> decode using declared/transport encoding
  -> parse well-formed XML
  -> namespace-aware processing
  -> optional schema validation
  -> semantic validation
  -> binding / transformation
  -> domain processing
```

Jangan lompat langsung dari string ke object tanpa tahu stage validasi apa yang terjadi.

---

## 7. XML Declaration dan Encoding

Contoh:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<case>...</case>
```

XML declaration dapat menyatakan:

- XML version,
- encoding,
- standalone.

### 7.1 Encoding bukan detail kecil

Di integration legacy, encoding bug sering menjadi production incident:

- partner mengirim ISO-8859-1 tapi header bilang UTF-8,
- XML declaration bilang UTF-8 tapi HTTP `Content-Type` bilang lain,
- file batch disimpan Windows-1252,
- character seperti smart quote, en dash, atau nama non-ASCII rusak,
- signature gagal karena byte representation berubah.

### 7.2 Byte stream vs Reader

Di Java:

```java
InputStream input = ...;
Document doc = builder.parse(input);
```

Parser bisa membaca XML declaration dan BOM.

Tetapi kalau kamu sudah membuat `Reader` dengan charset tertentu:

```java
Reader reader = new InputStreamReader(input, StandardCharsets.UTF_8);
```

Kamu sudah memutuskan decoding sebelum XML parser melihat byte asli.

Ini bisa benar, bisa berbahaya.

Rule of thumb:

```text
Kalau XML datang sebagai byte stream, berikan InputStream ke parser kecuali kamu punya alasan kuat untuk decoding manual.
```

### 7.3 UTF-8 as enterprise default

Untuk sistem baru, gunakan UTF-8 end-to-end:

- HTTP header,
- XML declaration,
- file storage,
- message broker payload,
- database CLOB encoding policy,
- logs,
- test fixtures.

Tapi saat menerima legacy XML, jangan asumsi semua UTF-8.

---

## 8. Element: Unit Struktur Utama XML

Element adalah node utama XML.

```xml
<case>
  <status>OPEN</status>
</case>
```

Element punya:

- name,
- namespace,
- attributes,
- children,
- text content,
- position/order,
- parent.

### 8.1 Empty element

Dua bentuk lexical ini equivalent secara infoset:

```xml
<case></case>
```

```xml
<case/>
```

Tapi hati-hati di binding/semantics:

```xml
<note></note>
```

bisa berarti empty string.

Sedangkan absent:

```xml
<case/>
```

berarti element `note` tidak ada.

Dalam schema/JAXB, perbedaan ini bisa penting:

```text
absent       -> null / Optional.empty / default
empty        -> "" / empty object / present with empty text
xsi:nil=true -> explicitly nil
```

### 8.2 Element order matters

Dalam JSON object, key order biasanya tidak semantik.

Dalam XML, order child element sering semantik dan schema-controlled.

```xml
<name>
  <first>Fajar</first>
  <last>Nugraha</last>
</name>
```

berbeda dari:

```xml
<name>
  <last>Nugraha</last>
  <first>Fajar</first>
</name>
```

XSD `xs:sequence` bahkan mewajibkan order.

Ini penting untuk JAXB: field order bisa memengaruhi generated XML. Annotation seperti `@XmlType(propOrder = ...)` ada karena XML order penting.

### 8.3 Repeated elements represent list

XML tidak punya array syntax khusus.

Biasanya list direpresentasikan sebagai repeated child elements:

```xml
<tags>
  <tag>urgent</tag>
  <tag>external</tag>
</tags>
```

Atau langsung:

```xml
<case>
  <tag>urgent</tag>
  <tag>external</tag>
</case>
```

Design choice ini memengaruhi schema dan binding.

Wrapped list:

```xml
<tags>
  <tag>urgent</tag>
</tags>
```

lebih eksplisit dan mudah diberi metadata pada container.

Unwrapped list:

```xml
<tag>urgent</tag>
<tag>external</tag>
```

lebih ringkas tetapi bisa menyulitkan extensibility.

---

## 9. Attribute: Metadata atau Data?

Attribute adalah name-value pair pada element.

```xml
<amount currency="SGD">123.45</amount>
```

Attribute punya karakteristik:

- tidak punya child node,
- value-nya string setelah normalization,
- order attribute tidak semantik,
- tidak bisa repeated dengan nama yang sama dalam element yang sama,
- tidak cocok untuk structured data,
- sering cocok untuk metadata kecil.

### 9.1 Kapan pakai attribute?

Gunakan attribute saat nilai:

- metadata tentang element,
- singkat,
- tidak punya substructure,
- tidak perlu mixed content,
- tidak perlu repeated,
- bukan teks panjang,
- bukan data yang perlu extensibility kompleks.

Contoh bagus:

```xml
<amount currency="SGD">123.45</amount>
```

```xml
<case id="C-001" version="3">
  ...
</case>
```

```xml
<document type="NOTICE" language="en-SG">
  ...
</document>
```

### 9.2 Kapan jangan pakai attribute?

Jangan pakai attribute untuk data yang:

- panjang,
- multiline,
- repeated,
- punya struktur,
- butuh markup,
- butuh namespace extensibility sebagai child,
- butuh order,
- butuh nil/absent semantics kompleks.

Contoh buruk:

```xml
<case applicantName="..." applicantAddressLine1="..." applicantAddressLine2="..." applicantPostalCode="..." applicantCountry="..."/>
```

Lebih baik:

```xml
<case>
  <applicant>
    <name>...</name>
    <address>
      <line1>...</line1>
      <line2>...</line2>
      <postalCode>...</postalCode>
      <country>...</country>
    </address>
  </applicant>
</case>
```

### 9.3 Attribute vs element decision matrix

| Question | Prefer Attribute | Prefer Element |
|---|---|---|
| Nilai adalah metadata kecil? | Ya | Bisa juga |
| Nilai punya struktur? | Tidak | Ya |
| Nilai repeated? | Tidak | Ya |
| Nilai teks panjang? | Tidak | Ya |
| Nilai perlu child markup? | Tidak | Ya |
| Nilai perlu order? | Tidak | Ya |
| Nilai perlu namespace extension? | Terbatas | Ya |
| Nilai adalah identity/version/unit? | Sering ya | Bisa juga |

### 9.4 Enterprise rule

Untuk contract yang akan hidup lama:

```text
Pakailah element untuk business data utama.
Pakailah attribute untuk metadata kecil yang melekat pada element.
```

Ini bukan hukum mutlak, tapi default yang aman.

---

## 10. Text Node, Whitespace, dan Mixed Content

XML element bisa berisi text.

```xml
<status>OPEN</status>
```

Text node terlihat sederhana, tapi banyak jebakan.

### 10.1 Whitespace can be data

```xml
<message>Hello</message>
```

berbeda secara lexical dari:

```xml
<message>
  Hello
</message>
```

Dalam banyak parser, text kedua mengandung newline dan spasi.

Untuk data-centric XML, whitespace antar element biasanya tidak penting:

```xml
<case>
  <status>OPEN</status>
</case>
```

Whitespace antara `<case>` dan `<status>` biasanya hanya indentation.

Tapi untuk document-centric XML, whitespace bisa penting:

```xml
<p>Hello <b>Fajar</b>, welcome.</p>
```

Text node:

```text
"Hello "
<b>Fajar</b>
", welcome."
```

Spasi sebelum dan sesudah `<b>` penting.

### 10.2 Mixed content

Mixed content berarti element mengandung text dan child elements bercampur.

```xml
<paragraph>
  Please read <link href="/terms">terms and conditions</link> before submitting.
</paragraph>
```

Ini sangat umum di:

- HTML/XHTML,
- correspondence,
- legal documents,
- rich text,
- documentation,
- regulatory notices,
- XML template systems.

Binding mixed content ke object biasa tidak mudah.

JAXB butuh mapping seperti:

```java
@XmlMixed
@XmlAnyElement
List<Object> content;
```

Itu akan dibahas di Part 20.

### 10.3 Data-centric vs document-centric XML

Data-centric:

```xml
<case>
  <caseId>C-001</caseId>
  <status>OPEN</status>
</case>
```

Document-centric:

```xml
<notice>
  <paragraph>Dear <name>Fajar</name>, your application is approved.</paragraph>
</notice>
```

Data-centric XML cocok di-bind ke DTO.

Document-centric XML sering lebih cocok diproses dengan DOM/StAX/XPath/XSLT atau hybrid model.

---

## 11. CDATA: Escaping Convenience, Bukan Tipe Data

CDATA:

```xml
<script><![CDATA[
  if (a < b && b > c) {
    console.log("ok");
  }
]]></script>
```

CDATA membuat text bisa berisi karakter seperti `<` tanpa escaping.

Tapi secara model, CDATA adalah character data.

Ini:

```xml
<status><![CDATA[OPEN]]></status>
```

biasanya setara dengan:

```xml
<status>OPEN</status>
```

CDATA bukan:

- security boundary,
- binary encoding,
- JSON container yang aman,
- cara bypass parsing,
- cara membuat markup tidak diproses setelah aplikasi membacanya.

Jika isi CDATA kemudian kamu parse sebagai XML/HTML/JSON/SQL/script, tetap ada risiko injection.

### 11.1 CDATA closing trap

CDATA tidak boleh berisi literal:

```text
]]>
```

Jika data user bisa mengandung `]]>`, generator harus split CDATA atau escape dengan cara lain.

---

## 12. Escaping Rules

Karakter khusus dalam XML text:

| Character | Escape |
|---|---|
| `<` | `&lt;` |
| `>` | `&gt;` biasanya opsional kecuali `]]>` context |
| `&` | `&amp;` |

Dalam attribute value, tambahan:

| Character | Escape |
|---|---|
| `"` | `&quot;` jika attribute pakai double quote |
| `'` | `&apos;` jika attribute pakai single quote |

Contoh:

```xml
<message>5 &lt; 10 &amp; 10 &gt; 5</message>
```

Attribute:

```xml
<user displayName="Fajar &quot;Engineer&quot; Nugraha"/>
```

### 12.1 Jangan concatenate XML string manual

Buruk:

```java
String xml = "<name>" + userInput + "</name>";
```

Jika `userInput`:

```text
</name><admin>true</admin><name>
```

maka struktur berubah.

Gunakan API generator/writer/marshaller yang melakukan escaping.

### 12.2 Escaping context matters

Escaping XML text berbeda dari:

- XML attribute escaping,
- XPath string escaping,
- XSLT escaping,
- HTML escaping,
- SQL escaping,
- JSON escaping,
- log escaping.

Jangan memakai satu utility “escape all” untuk semua context.

---

## 13. Comments dan Processing Instructions

### 13.1 Comment

```xml
<!-- internal note -->
<case>...</case>
```

Comment biasanya tidak masuk business data binding.

Tapi comment bisa penting untuk:

- document processing,
- human-readable generated artifacts,
- canonicalization/signature exclusion/inclusion behavior,
- security scanning.

Jangan meletakkan data sensitif di XML comment. Banyak pipeline menyimpan raw payload untuk audit.

### 13.2 Processing instruction

```xml
<?xml-stylesheet type="text/xsl" href="style.xsl"?>
```

Processing instruction memberi instruksi ke application.

Dalam enterprise data payload biasa, PI jarang dibutuhkan. Kalau menerima XML dari external party, jangan otomatis mengeksekusi behavior dari PI tanpa policy.

---

## 14. Entity, DTD, dan Kenapa XML Bisa Berbahaya

Entity memungkinkan referensi ke nilai lain.

Predefined entities:

```xml
&lt; &gt; &amp; &quot; &apos;
```

DTD bisa mendefinisikan entity:

```xml
<!DOCTYPE message [
  <!ENTITY company "Example Corp">
]>
<message>&company;</message>
```

Setelah expansion:

```xml
<message>Example Corp</message>
```

### 14.1 External entity

DTD juga bisa mendefinisikan external entity:

```xml
<!DOCTYPE data [
  <!ENTITY secret SYSTEM "file:///etc/passwd">
]>
<data>&secret;</data>
```

Ini dasar XXE attack.

Risiko:

- local file disclosure,
- SSRF,
- internal network probing,
- denial of service,
- credential leakage,
- parser hang.

### 14.2 Entity expansion bomb

Contoh konsep “billion laughs”:

```xml
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
]>
<lolz>&lol2;</lolz>
```

Entity kecil bisa expand menjadi teks sangat besar.

### 14.3 Production default

Untuk XML dari sumber eksternal:

```text
Disable DTD/external entity unless explicitly required.
Set parser limits.
Use secure processing.
Do not allow arbitrary external resource loading.
```

Detail config Java akan dibahas di Part 15, tapi mental model-nya harus tertanam dari sekarang.

---

## 15. Namespace: Bagian yang Paling Sering Disalahpahami

Namespace adalah mekanisme untuk menghindari konflik nama dan menggabungkan beberapa vocabulary XML dalam satu dokumen.

Contoh tanpa namespace:

```xml
<id>123</id>
```

`id` milik siapa?

- case id?
- user id?
- document id?
- SOAP id?
- signature id?

Namespace menjawab dengan URI.

```xml
<case:id xmlns:case="urn:example:case:v1">123</case:id>
```

Identitas element bukan `case:id`.

Identitas sebenarnya:

```text
namespace URI = urn:example:case:v1
local name    = id
```

Prefix `case` hanya alias dalam dokumen.

### 15.1 Prefix bukan identitas

Dua XML ini semantik namespace-nya sama:

```xml
<c:case xmlns:c="urn:example:case:v1">
  <c:id>C-001</c:id>
</c:case>
```

```xml
<x:case xmlns:x="urn:example:case:v1">
  <x:id>C-001</x:id>
</x:case>
```

Kalau kode kamu mencari string literal `<c:case>`, kode kamu rapuh.

Yang harus dicari:

```text
namespace URI = urn:example:case:v1
local name    = case
```

### 15.2 Default namespace

```xml
<case xmlns="urn:example:case:v1">
  <id>C-001</id>
</case>
```

Default namespace berlaku untuk element tanpa prefix.

Maka:

```text
case -> {urn:example:case:v1}case
id   -> {urn:example:case:v1}id
```

### 15.3 Default namespace tidak berlaku untuk attribute biasa

Ini jebakan besar.

```xml
<case xmlns="urn:example:case:v1" id="C-001"/>
```

Element `case` berada dalam namespace `urn:example:case:v1`.

Attribute `id` **tidak** berada dalam default namespace.

Attribute tanpa prefix berada dalam no namespace.

Kalau attribute ingin namespace-qualified:

```xml
<case xmlns="urn:example:case:v1"
      xmlns:meta="urn:example:meta:v1"
      meta:id="C-001"/>
```

### 15.4 Namespace URI tidak harus URL yang bisa dibuka

Namespace URI sering terlihat seperti URL:

```xml
xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
```

Tapi itu identifier, bukan instruksi untuk download.

Bisa juga URN:

```xml
xmlns:case="urn:gov:agency:case:v1"
```

Jangan membuat aplikasi mencoba fetch namespace URI.

### 15.5 Namespace versioning

Beberapa organisasi memasukkan versi di namespace:

```text
urn:example:case:v1
urn:example:case:v2
```

Kelebihan:

- jelas bahwa vocabulary berubah,
- bisa coexist v1/v2,
- schema mapping eksplisit.

Kekurangan:

- setiap perubahan namespace bisa memutus consumer,
- binding package berubah,
- XPath/JAXB config berubah,
- migrasi contract lebih berat.

Pilihan versioning namespace harus menjadi keputusan governance, bukan selera developer.

---

## 16. QName dan Expanded Name

QName adalah qualified name secara lexical:

```text
case:id
```

QName terdiri dari:

```text
prefix = case
local  = id
```

Tapi QName harus di-resolve menggunakan namespace context:

```xml
<case:id xmlns:case="urn:example:case:v1">123</case:id>
```

Expanded name:

```text
{urn:example:case:v1}id
```

Dalam Java, `javax.xml.namespace.QName` / `jakarta.xml.namespace.QName` biasanya merepresentasikan:

```text
namespaceURI
localPart
prefix
```

Hal penting:

```text
Equality semantik biasanya namespaceURI + localPart.
Prefix hanya lexical detail.
```

### 16.1 Debugging namespace issue

Kalau JAXB/JAX-WS error seperti:

```text
unexpected element (uri:"urn:foo", local:"case"). Expected elements are <{urn:bar}case>
```

Artinya nama lokal sama, namespace beda.

Ini bukan typo kecil. Ini kontrak berbeda.

### 16.2 Namespace-aware parsing wajib

Banyak bug muncul karena parser namespace awareness mati.

DOM/SAX factory di Java perlu dikonfigurasi:

```java
factory.setNamespaceAware(true);
```

Kalau tidak, `getLocalName()` bisa null dan kode mulai bergantung pada prefix/string mentah.

---

## 17. XML Name, Case Sensitivity, dan Naming Convention

XML case-sensitive.

Ini berbeda:

```xml
<Status>OPEN</Status>
<status>OPEN</status>
<STATUS>OPEN</STATUS>
```

Nama XML dapat berisi karakter luas, tetapi di enterprise schema biasanya gunakan konvensi sederhana:

```xml
<caseId>C-001</caseId>
<createdDateTime>2026-06-17T10:15:30Z</createdDateTime>
```

Atau PascalCase:

```xml
<CaseId>C-001</CaseId>
<CreatedDateTime>2026-06-17T10:15:30Z</CreatedDateTime>
```

SOAP/WSDL enterprise banyak memakai PascalCase karena warisan .NET/enterprise tooling.

Yang penting bukan style mana, tetapi konsistensi dan compatibility.

---

## 18. Nil, Null, Empty, Absent: Empat Hal Berbeda

Dalam XML, ada beberapa representasi “tidak ada nilai”.

### 18.1 Absent element

```xml
<case>
  <status>OPEN</status>
</case>
```

`remark` tidak ada.

Makna:

```text
not provided / unknown / not applicable / no change
```

Tergantung contract.

### 18.2 Empty element

```xml
<remark/>
```

atau:

```xml
<remark></remark>
```

Makna bisa:

```text
provided but empty
```

### 18.3 Whitespace-only element

```xml
<remark>   </remark>
```

Makna bisa berbeda lagi jika whitespace dipertahankan.

### 18.4 Explicit nil

Dengan XML Schema Instance:

```xml
<remark xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/>
```

Makna:

```text
explicitly nil
```

Dalam JAXB, ini berkaitan dengan `nillable = true`.

### 18.5 PATCH/update consequence

Dalam update API:

```text
absent       -> do not change
empty        -> set to empty string
xsi:nil=true -> clear value / set null
```

Kalau contract tidak membedakan ini, integrasi bisa merusak data.

---

## 19. XML Schema Instance Namespace (`xsi`)

Kamu akan sering melihat:

```xml
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
```

`xsi` biasanya dipakai untuk attribute seperti:

```xml
xsi:nil="true"
xsi:type="SomeType"
xsi:schemaLocation="..."
xsi:noNamespaceSchemaLocation="..."
```

### 19.1 `xsi:type`

Contoh:

```xml
<party xsi:type="Organization">
  <name>Example Pte Ltd</name>
</party>
```

Ini menyatakan runtime type dari element.

Dalam binding, `xsi:type` sering terkait polymorphism.

Risiko:

- type confusion,
- unexpected subclass,
- insecure deserialization-like behavior jika binding terlalu permisif,
- compatibility issue jika type tidak dikenal.

### 19.2 `xsi:schemaLocation`

```xml
<case xmlns="urn:example:case:v1"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:schemaLocation="urn:example:case:v1 case-v1.xsd">
</case>
```

Ini hint lokasi schema.

Jangan otomatis download schema dari untrusted XML. Schema loading harus dikontrol application.

---

## 20. XML Base, ID, dan Referensi Internal

XML dapat memakai ID/reference pattern.

```xml
<document>
  <party id="p1">
    <name>Fajar</name>
  </party>
  <case ownerRef="p1"/>
</document>
```

Dalam schema, attribute bisa bertipe `xs:ID` dan `xs:IDREF`.

Ini penting untuk:

- graph-like relationship dalam dokumen tree,
- XML Signature reference,
- SOAP header/body correlation,
- SAML assertion,
- document packaging.

Jebakan:

```text
XML tree bisa merepresentasikan graph melalui ID/IDREF.
Binding ke object tree naive bisa kehilangan semantics referensi.
```

---

## 21. XML Canonicalization: Kenapa String Equality Salah

Dua XML ini bisa semantik sama:

```xml
<case id="C-001" status="OPEN"/>
```

```xml
<case status="OPEN" id="C-001"></case>
```

Attribute order tidak semantik.

Prefix bisa beda tapi namespace sama:

```xml
<c:case xmlns:c="urn:case"/>
```

```xml
<x:case xmlns:x="urn:case"/>
```

Untuk signature, digest, dan comparison, string mentah tidak cukup.

XML canonicalization mencoba menghasilkan byte representation standar dari XML infoset tertentu.

Kenapa ini penting?

- XML Signature memerlukan canonicalization.
- Whitespace/comment/namespace handling bisa membuat signature valid/invalid.
- Pretty-printing signed XML bisa merusak signature.
- Re-serializing XML dengan library berbeda bisa mengubah prefix/order/whitespace.

Rule:

```text
Jangan ubah signed XML kecuali kamu paham canonicalization dan signature reference-nya.
```

---

## 22. XML dan Time/Number Semantics

XML text adalah string sampai diberi tipe oleh schema atau aplikasi.

```xml
<amount>100.00</amount>
<createdAt>2026-06-17T10:15:30+07:00</createdAt>
```

XSD bisa memberi tipe:

```xml
<xs:element name="amount" type="xs:decimal"/>
<xs:element name="createdAt" type="xs:dateTime"/>
```

### 22.1 Decimal

Untuk uang, gunakan decimal, bukan floating point.

Java binding ideal:

```java
BigDecimal amount;
```

Bukan:

```java
double amount;
```

### 22.2 Date/time

XML Schema `dateTime` punya aturan sendiri. Timezone bisa ada atau absent.

Contoh:

```xml
<createdAt>2026-06-17T10:15:30Z</createdAt>
<createdAt>2026-06-17T17:15:30+07:00</createdAt>
<createdAt>2026-06-17T10:15:30</createdAt>
```

Yang terakhir tidak punya timezone. Jangan diam-diam anggap UTC tanpa contract.

Dalam Java modern, mapping perlu dipikirkan:

- `OffsetDateTime`,
- `ZonedDateTime`,
- `LocalDateTime`,
- `Instant`,
- `XMLGregorianCalendar` legacy JAXB.

Detail binding akan dibahas saat JAXB.

---

## 23. XML sebagai Contract Boundary

XML di enterprise jarang berdiri sendiri. Biasanya ada contract:

```text
XML payload + XSD + WSDL + business rules + operational rules
```

Contoh contract SOAP:

```text
WSDL defines operation SubmitCase
  XSD defines SubmitCaseRequest
  SOAP binding defines transport/action
  policy defines security requirement
  business doc defines allowed status transitions
```

Jangan menganggap XML sample sebagai contract final. Sample hanya contoh.

Contract yang benar biasanya:

- schema,
- versioning rule,
- namespace policy,
- error/fault model,
- compatibility policy,
- transport/security policy,
- non-functional constraints,
- test vectors.

---

## 24. XML Evolution dan Compatibility

XML contract bisa berevolusi dengan beberapa cara.

### 24.1 Add optional element

Biasanya backward compatible:

```xml
<case>
  <caseId>C-001</caseId>
  <status>OPEN</status>
  <priority>HIGH</priority>
</case>
```

Jika old consumer ignore unknown optional elements.

Tapi bisa break jika:

- schema strict dan tidak allow extension,
- JAXB unmarshaller tidak tolerate unknown elements,
- element order berubah dan schema sequence strict,
- XPath consumer expects exact structure.

### 24.2 Add required element

Biasanya breaking.

Old producer tidak mengirim element baru.

### 24.3 Rename element

Breaking.

### 24.4 Change namespace

Biasanya breaking.

### 24.5 Change element type

Potentially breaking:

```text
xs:int -> xs:long may be okay for some consumers, not all.
xs:string -> complexType is breaking.
xs:date -> xs:dateTime changes semantics.
```

### 24.6 Extension points

XML schema bisa menyediakan wildcard:

```xml
<xs:any namespace="##other" processContents="lax"/>
```

Ini memungkinkan extension.

Tapi wildcard tanpa governance menjadi garbage extension channel.

---

## 25. Namespaced Multi-Vocabulary Document

XML bisa menggabungkan banyak vocabulary.

Contoh SOAP-like:

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:case="urn:example:case:v1"
               xmlns:sec="urn:example:security:v1">
  <soap:Header>
    <sec:CorrelationId>abc-123</sec:CorrelationId>
  </soap:Header>
  <soap:Body>
    <case:SubmitCaseRequest>
      <case:CaseId>C-001</case:CaseId>
    </case:SubmitCaseRequest>
  </soap:Body>
</soap:Envelope>
```

Ini bukan satu object sederhana. Ini beberapa vocabulary dalam satu document:

```text
SOAP envelope vocabulary
Security/correlation vocabulary
Case business vocabulary
```

Parser dan binding harus namespace-aware supaya tidak mencampur element bernama sama dari vocabulary berbeda.

---

## 26. XML Processing Pipeline di Java

Secara konseptual:

```text
InputStream / Reader
  -> XML parser factory
  -> XML parser
  -> events/tree
  -> optional validation
  -> optional XPath/XSLT
  -> optional binding
  -> domain object / command / event
```

Java punya beberapa pendekatan:

```text
DOM  -> parse entire tree into memory
SAX  -> push events to handler
StAX -> pull events from stream
JAXB -> bind XML to Java object
XPath -> query nodes
XSLT -> transform XML
SAAJ -> SOAP message object model
JAX-WS -> SOAP web service binding/proxy
```

Part berikutnya akan membahas DOM/SAX/StAX detail.

Untuk sekarang pahami pilihan besar:

| Approach | Mental Model | Cocok Untuk | Risiko |
|---|---|---|---|
| DOM | whole tree | small/medium document, random access, mutation | memory besar |
| SAX | push events | large read-only stream | code stateful sulit |
| StAX | pull events | large stream with control | manual parsing complexity |
| JAXB | object binding | data-centric XML with stable schema | info loss, binding mismatch |
| XPath | query | extracting known nodes | namespace/escaping/performance |
| XSLT | transform | XML-to-XML/HTML/text transform | maintainability/security |

---

## 27. Java 8 sampai Java 25: XML Foundation yang Tetap Relevan

Walaupun JAXB/JAX-WS keluar dari JDK setelah Java 8, core XML processing masih relevan:

- JAXP APIs tetap bagian Java platform untuk DOM/SAX/StAX/validation/transform.
- JAXB/JAX-WS/SAAJ perlu dependency eksplisit di Java 11+.
- Namespace `javax.*` vs `jakarta.*` memengaruhi migration.
- Java module system bisa memengaruhi reflective binding.
- Security defaults dan parser limits perlu dicek per runtime/JDK.

Mental model XML tidak berubah drastis dari Java 8 ke Java 25. Yang berubah adalah packaging, dependency, namespace API, runtime provider, dan security posture.

---

## 28. Common XML Failure Modes di Production

### 28.1 Namespace mismatch

Gejala:

```text
unexpected element
empty XPath result
JAXB cannot unmarshal
SOAP body not recognized
```

Root cause:

```text
local name sama, namespace URI beda atau parser tidak namespace-aware.
```

### 28.2 Schema order mismatch

XML terlihat “field-nya ada semua” tapi validasi gagal karena order salah.

```xml
<case>
  <status>OPEN</status>
  <caseId>C-001</caseId>
</case>
```

Jika XSD mewajibkan `caseId` lalu `status`, ini invalid.

### 28.3 Encoding mismatch

Gejala:

- karakter rusak,
- parse error pada byte tertentu,
- signature verification gagal,
- partner bilang payload berbeda.

### 28.4 XXE/entity attack

Gejala:

- unexpected outbound request dari server,
- parser lambat,
- memory spike,
- file content muncul di response/log.

### 28.5 Pretty-print breaks signature

XML yang sudah signed di-format ulang, lalu signature invalid.

### 28.6 Binding loses unknown extension

JAXB unmarshal lalu marshal ulang. Unknown element hilang. Partner kehilangan extension data.

### 28.7 Empty vs absent confusion

Update payload menghapus data karena empty string dianggap null atau absent dianggap clear.

### 28.8 Attribute modeled as element mismatch

Producer:

```xml
<amount currency="SGD">100</amount>
```

Consumer expects:

```xml
<amount>
  <currency>SGD</currency>
  <value>100</value>
</amount>
```

Keduanya mirip secara manusia, beda total secara contract.

---

## 29. Cara Membaca XML Legacy dengan Sistematis

Ketika menerima XML asing, jangan langsung generate JAXB class. Baca dengan urutan ini:

### Step 1 — Identifikasi root

```text
root local name?
root namespace URI?
root prefix?
```

### Step 2 — Identifikasi vocabulary

Cari namespace declarations:

```xml
xmlns="..."
xmlns:soap="..."
xmlns:xsi="..."
xmlns:ds="..."
```

Tentukan vocabulary apa saja:

- SOAP?
- business payload?
- security/signature?
- schema instance?
- extension namespace?

### Step 3 — Cek schema/WSDL

Apakah ada XSD/WSDL resmi?

Jika ada, sample XML bukan contract utama. Schema/WSDL adalah contract struktural.

### Step 4 — Cek data-centric atau document-centric

Apakah XML mostly:

```text
elements with scalar values -> data-centric
mixed content/rich text -> document-centric
```

### Step 5 — Cek nil/empty/absent semantics

Cari:

```xml
xsi:nil="true"
```

Cek optional fields.

### Step 6 — Cek security-sensitive constructs

Cari:

```xml
<!DOCTYPE
<!ENTITY
<ds:Signature
<xenc:EncryptedData
```

### Step 7 — Cek extension points

Cari unknown namespace atau `xs:any` di schema.

### Step 8 — Baru pilih Java processing strategy

- JAXB kalau data-centric dan schema stabil.
- StAX kalau payload besar dan perlu stream.
- DOM/XPath kalau perlu random access kecil/medium.
- SAAJ/JAX-WS kalau SOAP-level handling.
- Custom hybrid kalau dokumen punya mixed content/signature/extension.

---

## 30. XML Design Principles untuk Sistem Baru

Jika kamu mendesain XML contract baru, pakai prinsip ini.

### 30.1 Namespace eksplisit dan stabil

```xml
<case:SubmitCaseRequest xmlns:case="urn:example:case:v1">
```

Jangan tanpa namespace untuk public enterprise contract.

### 30.2 Business data utama sebagai element

```xml
<Applicant>
  <Name>...</Name>
</Applicant>
```

Bukan attribute raksasa.

### 30.3 Attribute untuk metadata kecil

```xml
<Amount currency="SGD">100.00</Amount>
```

### 30.4 Explicit collection shape

```xml
<Attachments>
  <Attachment>...</Attachment>
</Attachments>
```

### 30.5 Hindari mixed content untuk data API

Mixed content bagus untuk dokumen, buruk untuk DTO API sederhana.

### 30.6 Definisikan null semantics

Dokumentasikan:

```text
absent means what?
empty means what?
xsi:nil means what?
```

### 30.7 Sediakan schema dan examples

Minimal:

- XSD,
- valid sample,
- invalid sample,
- versioning rule,
- error contract,
- charset rule,
- max size/depth rule.

### 30.8 Jangan rely pada prefix tertentu

Prefix boleh berubah. Namespace URI tidak boleh berubah sembarangan.

### 30.9 Jangan izinkan DTD default

Untuk external API, DTD biasanya tidak perlu.

### 30.10 Rancang extension point dengan governance

Jika perlu extension:

```xml
<Extensions>
  <ext:Something xmlns:ext="urn:partner:extension:v1">...</ext:Something>
</Extensions>
```

Jangan biarkan extension liar di mana saja.

---

## 31. XML Testing Strategy Foundation

Untuk XML, test tidak cukup string equality.

### 31.1 Parse and compare semantically

Daripada:

```java
assertEquals(expectedXml, actualXml);
```

lebih baik:

- parse namespace-aware,
- compare selected elements by QName,
- validate against XSD,
- canonicalize jika perlu,
- ignore insignificant whitespace jika contract mengizinkan.

### 31.2 Test cases wajib

Untuk contract XML enterprise:

1. Minimal valid payload.
2. Full valid payload.
3. Unknown optional extension.
4. Wrong namespace.
5. Wrong element order.
6. Missing required element.
7. Empty vs absent vs nil.
8. Non-ASCII character.
9. Large payload.
10. DTD/entity attack attempt.
11. Duplicate/repeated where not allowed.
12. Signed XML if security applies.

### 31.3 Golden file discipline

XML sample file harus disimpan sebagai fixture:

```text
src/test/resources/xml/case/submit-case-valid-minimal.xml
src/test/resources/xml/case/submit-case-valid-full.xml
src/test/resources/xml/case/submit-case-invalid-namespace.xml
```

Jangan embed XML panjang di string Java test kecuali sangat kecil.

---

## 32. XML Observability dan Logging

XML payload sering mengandung PII atau data sensitif.

Logging raw XML harus dikontrol.

### 32.1 Jangan log raw payload default

Buruk:

```java
log.info("Incoming XML: {}", xml);
```

Risiko:

- PII leakage,
- credential leakage,
- token/certificate leakage,
- log injection,
- storage bloat,
- compliance issue.

### 32.2 Log metadata yang aman

Lebih baik:

```text
messageType=SubmitCaseRequest
namespace=urn:example:case:v1
correlationId=abc-123
payloadSize=12834
schemaVersion=v1
validationResult=PASS
```

### 32.3 Redaction harus XML-aware

Regex redaction raw XML mudah salah karena namespace/prefix/formatting bisa berubah.

Lebih baik parse dan redact berdasarkan QName/path.

---

## 33. XML Performance Mental Model

XML parsing cost berasal dari:

- byte decoding,
- tokenization,
- namespace resolution,
- entity handling,
- tree allocation,
- validation,
- binding reflection/codegen,
- whitespace/text node allocation,
- transform/query operations.

### 33.1 DOM memory amplification

XML 5 MB bisa menjadi puluhan MB object graph saat DOM.

Kenapa?

- setiap element menjadi object,
- attribute object,
- text node object,
- parent/child links,
- namespace metadata,
- strings,
- parser buffers.

### 33.2 Streaming reduces memory but increases state complexity

StAX/SAX bisa memproses besar dengan memory rendah, tapi kamu harus mengelola state:

```text
where am I in the document?
which element path am I inside?
what namespace is active?
what partial object am I building?
what happens if parse fails halfway?
```

### 33.3 Validation cost

XSD validation menambah CPU, tapi memberi contract safety. Untuk external boundary, cost ini sering layak.

Optimisasi bukan “matikan validation”, tapi:

- cache schema object,
- batasi payload size,
- streaming validation jika memungkinkan,
- validate hanya boundary penting,
- benchmark real payload.

---

## 34. XML Security Mental Model Sebelum Part 15

Part 15 akan detail security config. Untuk sekarang hafalkan threat classes:

```text
1. Parser resource attack
   - entity expansion
   - deep nesting
   - huge text node
   - huge attribute

2. External resource attack
   - XXE file disclosure
   - SSRF through external entity/schema/stylesheet

3. Injection attack
   - XML injection
   - XPath injection
   - XSLT injection
   - log/template injection

4. Signature/security confusion
   - XML Signature Wrapping
   - canonicalization mismatch
   - unsigned data used as trusted

5. Binding confusion
   - xsi:type abuse
   - unexpected element ignored
   - unknown extension dropped
   - object graph explosion
```

XML security bukan fitur tambahan. Ia harus dipasang di parser boundary.

---

## 35. Mini Case Study: Case Submission XML

Misalkan sistem regulator menerima submission dari external agency.

### 35.1 Payload

```xml
<?xml version="1.0" encoding="UTF-8"?>
<case:SubmitCaseRequest
    xmlns:case="urn:regulator:case:v1"
    xmlns:meta="urn:regulator:metadata:v1"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    meta:correlationId="c9b4c6e2-6f65-4b58-9ff2-0b076f2ef001">

  <case:Case>
    <case:CaseId>C-2026-0001</case:CaseId>
    <case:Applicant>
      <case:Name>Fajar Abdi Nugraha</case:Name>
      <case:Email xsi:nil="true"/>
    </case:Applicant>
    <case:Amount currency="SGD">100.00</case:Amount>
    <case:Remarks/>
  </case:Case>
</case:SubmitCaseRequest>
```

### 35.2 Cara membaca

Root expanded name:

```text
{urn:regulator:case:v1}SubmitCaseRequest
```

Attribute correlation ID:

```text
{urn:regulator:metadata:v1}correlationId
```

`case:Email xsi:nil="true"`:

```text
Email explicitly nil
```

`case:Remarks/`:

```text
Remarks present but empty
```

`currency="SGD"`:

```text
attribute in no namespace, metadata for amount value
```

### 35.3 Potential bugs

Bug 1: Parser not namespace-aware.

```text
case:CaseId treated as literal name instead of namespace + local name.
```

Bug 2: JAXB model expects default namespace, but XML uses prefix. This should not matter if namespace URI correct. If it fails, binding config is wrong.

Bug 3: App treats `xsi:nil=true` same as empty string.

Bug 4: App logs full applicant name/email in raw payload.

Bug 5: App validates only well-formedness, not XSD/business rule.

Bug 6: App does string equality on generated XML and fails because prefix changed from `case` to `ns2`.

Bug 7: App re-marshals and drops `meta:correlationId` because DTO does not capture namespaced attribute.

---

## 36. Java Engineer Checklist Saat Berurusan Dengan XML

Sebelum coding:

```text
[ ] Apakah XML ini data-centric atau document-centric?
[ ] Apakah ada XSD/WSDL resmi?
[ ] Apa root namespace URI dan local name?
[ ] Apakah prefix boleh berubah?
[ ] Apakah parser harus namespace-aware? Hampir selalu ya.
[ ] Apakah DTD/entity perlu? Jika tidak, disable.
[ ] Apakah payload perlu schema validation?
[ ] Apa batas maksimal size/depth/text length?
[ ] Apa semantics absent/empty/nil?
[ ] Apakah ada mixed content?
[ ] Apakah ada signature/encryption?
[ ] Apakah XML boleh diubah/pretty-print?
[ ] Apakah unknown extension harus dipertahankan?
[ ] Apakah raw XML boleh dilog?
[ ] Apakah encoding sudah disepakati?
[ ] Apakah Java 8/11/17/21/25 dependency behavior sudah jelas?
```

Saat debugging:

```text
[ ] Print namespace URI + local name, bukan hanya nodeName.
[ ] Cek XML declaration dan actual bytes.
[ ] Cek schema order.
[ ] Cek default namespace pada element.
[ ] Cek attribute namespace.
[ ] Cek xsi:nil/type.
[ ] Cek parser secure config.
[ ] Cek JAXB/JAX-WS generated package namespace.
[ ] Cek apakah XML ditransform sebelum sampai aplikasi.
```

---

## 37. Anti-Patterns

### Anti-pattern 1: Treat XML as string

```java
if (xml.contains("<status>OPEN</status>")) {
    ...
}
```

Rapuh terhadap namespace, whitespace, prefix, formatting, escaping.

### Anti-pattern 2: Ignore namespace

```java
getElementsByTagName("CaseId")
```

Bisa salah jika ada element `CaseId` dari namespace lain.

### Anti-pattern 3: Bind external XML directly to domain entity

```text
External XML -> JAXB -> JPA Entity
```

Ini mencampur transport contract dengan domain persistence.

Gunakan boundary DTO/command.

### Anti-pattern 4: Enable all parser features because partner XML fails

Kadang partner meminta DTD/external schema. Jangan asal enable. Buat allowlist dan controlled resolver.

### Anti-pattern 5: Reformat signed XML

Pretty-print bisa merusak signature.

### Anti-pattern 6: Assume XML sample covers all cases

Sample bukan schema. Schema bukan semua business rules. Business docs dan test vectors tetap perlu.

### Anti-pattern 7: Drop unknown extension

Dalam contract extensible, unknown extension mungkin harus dipreserve walau aplikasi tidak mengerti.

---

## 38. Relationship ke Part Berikutnya

Part 13 akan membahas:

```text
XML Parsing Models: DOM, SAX, StAX, XPath, XSLT
```

Part ini memberi dasar:

- apa yang diparse,
- apa itu element/attribute/text,
- bagaimana namespace bekerja,
- kenapa parser harus secure,
- kenapa binding bisa kehilangan informasi,
- kenapa XML tree tidak sama dengan Java object.

Tanpa foundation ini, DOM/SAX/StAX terlihat seperti pilihan API biasa. Dengan foundation ini, kamu bisa memilih parser berdasarkan semantics, memory, security, dan contract risk.

---

## 39. Key Takeaways

1. XML bukan JSON yang verbose. XML adalah document tree dengan namespace, attribute, mixed content, schema, dan ekosistem processing luas.
2. Identitas XML element/attribute namespace-aware adalah namespace URI + local name, bukan prefix string.
3. Prefix bisa berubah tanpa mengubah semantics; namespace URI tidak boleh dianggap dekorasi.
4. Default namespace berlaku untuk element, bukan attribute biasa.
5. Well-formed tidak sama dengan valid.
6. CDATA hanya lexical convenience, bukan tipe data dan bukan security boundary.
7. Absent, empty, whitespace-only, dan `xsi:nil=true` adalah semantics berbeda.
8. XML parser boundary adalah security boundary.
9. String equality untuk XML sering salah; canonicalization/semantic comparison diperlukan untuk kasus tertentu.
10. Binding XML ke Java object adalah lossy abstraction; gunakan sadar, bukan otomatis.
11. XML legacy harus dibaca dari root namespace, schema/WSDL, vocabulary, nil semantics, security constructs, lalu baru pilih API.
12. Untuk Java 8–25, mental model XML tetap sama; yang berubah adalah dependency, packaging, namespace `javax`/`jakarta`, provider, dan security defaults.

---

## 40. Referensi Resmi dan Bacaan Lanjutan

Referensi utama yang relevan untuk bagian ini:

1. W3C — XML Information Set, Second Edition  
   `https://www.w3.org/TR/2004/REC-xml-infoset-20040204/`

2. W3C — Namespaces in XML 1.0, Third Edition  
   `https://www.w3.org/TR/xml-names/`

3. Oracle — Java API for XML Processing / StAX tutorial  
   `https://docs.oracle.com/javase/tutorial/jaxp/stax/why.html`

4. Oracle — JAXP Security Guide  
   `https://docs.oracle.com/javase/8/docs/technotes/guides/security/jaxp/jaxp.html`

5. Jakarta XML Binding specification page  
   `https://jakarta.ee/specifications/xml-binding/`

6. Jakarta XML Binding 3.0 Specification  
   `https://jakarta.ee/specifications/xml-binding/3.0/jakarta-xml-binding-spec-3.0`

---

## 41. Status Series

Part 12 selesai.

Series belum selesai.

Berikutnya:

```text
Part 13 — XML Parsing Models: DOM, SAX, StAX, XPath, XSLT
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-011.md">⬅️ Part 011 — JSON Security & Robustness</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-013.md">Learn Java JSON/XML/SOAP/Connectors Enterprise Integration — Part 13 ➡️</a>
</div>
