# learn-java-authentication-modes-and-patterns-part-017

# Part 17 — SAML 2.0 Authentication in Java Enterprise Systems

> Seri: **Java Authentication Modes and Patterns**  
> Part: **017 / 035**  
> Topik: **SAML 2.0 Authentication in Java Enterprise Systems**  
> Target: Java 8 hingga Java 25  
> Level: Advanced / Enterprise / Security Architecture

---

## 0. Ringkasan Eksekutif

SAML 2.0 adalah salah satu protokol federated authentication paling penting di sistem enterprise, government, banking, insurance, healthcare, dan organisasi besar yang memiliki banyak aplikasi internal serta Identity Provider terpusat.

Jika OAuth2/OIDC adalah dunia modern berbasis JSON, REST, browser, mobile, dan API, maka SAML adalah dunia enterprise federation berbasis XML, browser redirect/post binding, signed assertion, metadata, certificate, dan institutional trust.

SAML sering terlihat “legacy”, tetapi dalam praktik enterprise, SAML masih hidup karena:

1. banyak organisasi besar sudah memakai SAML untuk enterprise SSO;
2. banyak SaaS enterprise masih mendukung SAML sebagai opsi utama SSO;
3. integrasi corporate IdP seperti ADFS, Entra ID, Okta, PingFederate, Shibboleth, Oracle Access Manager, dan ForgeRock sering memakai SAML;
4. aplikasi Java lama berbasis Servlet/Jakarta EE/Spring masih banyak memakai SAML;
5. kebutuhan audit, legal identity federation, dan trust contract lintas organisasi cocok dengan model metadata dan certificate SAML.

Mental model terpenting:

> SAML authentication bukan “login XML”.  
> SAML adalah proses ketika **Identity Provider membuat assertion ter-sign** tentang authentication user, lalu **Service Provider memvalidasi assertion itu** berdasarkan trust metadata, certificate, condition, audience, destination, recipient, timestamp, replay cache, dan binding context.

SAML failure paling berbahaya bukan hanya password salah. Failure paling berbahaya adalah ketika Service Provider menerima assertion yang:

- tidak ditujukan untuk dirinya;
- sudah expired;
- replayed;
- signed oleh key yang salah;
- signature-nya valid tetapi elemen yang dipakai aplikasi bukan elemen yang ditandatangani;
- berasal dari IdP yang salah;
- memakai NameID/attribute mapping yang menyebabkan account takeover;
- diterima dari IdP-initiated flow tanpa kontrol correlation yang memadai.

---

## 1. Problem yang Diselesaikan SAML

SAML menyelesaikan masalah:

> “Bagaimana aplikasi A mempercayai hasil authentication yang dilakukan oleh organisasi/IdP B tanpa aplikasi A melihat credential asli user?”

Contoh:

- pegawai login ke corporate IdP, lalu masuk ke aplikasi HR;
- agency government login melalui central identity provider, lalu masuk ke case management system;
- customer enterprise login ke SaaS vendor memakai identity perusahaan;
- universitas login ke library service memakai federated academic identity;
- internal Java monolith memakai ADFS untuk SSO.

Tanpa federation, setiap aplikasi harus menyimpan password sendiri. Itu buruk karena:

1. credential tersebar di banyak aplikasi;
2. offboarding sulit;
3. password policy tidak konsisten;
4. MFA sulit dipusatkan;
5. audit login terpecah;
6. user lifecycle sulit dikendalikan;
7. risiko compromise meningkat.

Dengan SAML:

1. authentication dilakukan di IdP;
2. aplikasi menerima assertion;
3. aplikasi tidak perlu melihat password;
4. user lifecycle dikendalikan di IdP;
5. MFA dapat diberlakukan di IdP;
6. aplikasi cukup memvalidasi assertion dan memetakan identity.

---

## 2. Mental Model Inti

### 2.1 SAML adalah trust contract

SAML bekerja karena ada trust contract antara:

| Entity | Peran |
|---|---|
| Identity Provider / IdP / Asserting Party | Pihak yang mengautentikasi user dan membuat assertion |
| Service Provider / SP / Relying Party | Aplikasi yang mempercayai assertion |
| User / Subject | Orang atau principal yang diautentikasi |
| Browser/User Agent | Medium transport front-channel |
| Metadata | Dokumen trust configuration |
| Certificate | Bukti signing/encryption identity |
| Assertion | Pernyataan terstruktur tentang user dan authentication event |

SP tidak “percaya kepada browser”. SP percaya kepada assertion yang valid secara kriptografis, sesuai audience, masih berlaku, tidak replayed, dan berasal dari IdP yang dipercaya.

---

### 2.2 Assertion bukan credential asli

Dalam SAML, user tidak memberikan password ke SP. SP menerima assertion.

Assertion berisi pernyataan seperti:

```text
Subject:
  NameID = alice@example.com

Authentication Statement:
  User authenticated at 2026-06-19T10:00:00Z
  AuthnContext = password + MFA or specific class

Attribute Statement:
  email = alice@example.com
  department = compliance
  employeeId = E12345
  groups = [case-reviewer, supervisor]

Conditions:
  NotBefore = ...
  NotOnOrAfter = ...
  AudienceRestriction = https://case.example.com/saml/metadata

Signature:
  Signed by IdP private key
```

Yang penting:

> Assertion adalah security token. Ia harus divalidasi seperti token, bukan dibaca seperti data XML biasa.

---

### 2.3 SAML adalah authentication handoff

SAML login adalah handoff:

```text
[User]
  |
  | access SP
  v
[Service Provider]
  |
  | AuthnRequest
  v
[Identity Provider]
  |
  | authenticate user
  | issue signed SAML Response/Assertion
  v
[Service Provider ACS]
  |
  | validate response/assertion
  | create local session
  v
[User logged in to SP]
```

SP tetap biasanya membuat local session setelah assertion valid. Jadi dalam aplikasi web Java:

```text
SAML assertion validation
        |
        v
Local application session creation
        |
        v
Normal request authentication via session cookie
```

Artinya, SAML sering hanya dipakai pada login boundary. Setelah login, request biasa biasanya memakai cookie session aplikasi.

---

## 3. SAML vs OIDC: Jangan Campur Mental Model

| Aspek | SAML 2.0 | OIDC |
|---|---|---|
| Format token | XML assertion | JWT ID Token |
| Transport utama | Browser Redirect/POST binding | HTTP redirect + JSON/token endpoint |
| Metadata | XML metadata | Discovery JSON + JWKS |
| Signature | XML Signature | JWS |
| Typical enterprise usage | Corporate SSO, SaaS enterprise, legacy government | Modern web/mobile/API |
| Subject identifier | NameID | `sub` |
| Claims/attributes | AttributeStatement | claims |
| SP/RP term | Service Provider | Relying Party / Client |
| IdP term | Identity Provider | OpenID Provider |
| Common Java integration | Spring SAML2, OpenSAML, Shibboleth, container/vendor adapter | Spring OAuth2 Client, Jakarta Security OIDC, Keycloak adapter |
| Biggest practical risk | XML signature wrapping, metadata/cert misuse, attribute mapping | JWT validation mistake, redirect/code/token misuse |

SAML bukan “OIDC versi XML”. Keduanya federated identity protocol, tetapi engineering modelnya berbeda.

---

## 4. Core Entities dalam SAML

### 4.1 Identity Provider / IdP / Asserting Party

IdP bertanggung jawab untuk:

1. menerima AuthnRequest dari SP;
2. melakukan authentication user;
3. menerapkan MFA/policy;
4. membuat SAML Response;
5. menandatangani assertion/response;
6. mengirim hasil ke SP ACS endpoint.

Contoh IdP:

- ADFS;
- Microsoft Entra ID;
- Okta;
- PingFederate;
- Shibboleth IdP;
- Keycloak;
- Oracle Access Manager;
- ForgeRock;
- custom government IdP.

---

### 4.2 Service Provider / SP / Relying Party

SP adalah aplikasi Java yang menerima assertion.

SP bertanggung jawab untuk:

1. membuat AuthnRequest bila SP-initiated;
2. menerima response di Assertion Consumer Service;
3. memvalidasi signature;
4. memvalidasi issuer;
5. memvalidasi audience;
6. memvalidasi destination/recipient;
7. memvalidasi timestamp;
8. memvalidasi InResponseTo;
9. melakukan replay detection;
10. mapping NameID/attribute ke local account;
11. membuat session lokal;
12. mengaudit authentication event.

Dalam Spring Security, ini biasanya direpresentasikan sebagai `RelyingPartyRegistration`, yaitu konfigurasi pasangan SP dan asserting party/IdP.

---

### 4.3 Subject

Subject adalah principal yang assertion-nya sedang dibicarakan.

Subject bisa diidentifikasi lewat:

- transient NameID;
- persistent NameID;
- email;
- username;
- employee ID;
- opaque identifier;
- federation-specific ID.

Kesalahan umum:

> Memakai email sebagai immutable user identity.

Email bisa berubah, bisa didaur ulang, bisa berbeda casing, bisa tidak terverifikasi, atau bisa sama di domain berbeda jika mapping tenant buruk.

Untuk sistem regulated, biasanya lebih aman memiliki:

```text
external_subject_id = issuer + stable_subject_identifier
local_user_id       = immutable internal UUID
display_email       = attribute for communication, not identity root
```

---

### 4.4 SAML Assertion

Assertion adalah dokumen XML yang berisi pernyataan security.

Tipe statement penting:

| Statement | Fungsi |
|---|---|
| Authentication Statement | Menyatakan user sudah diautentikasi |
| Attribute Statement | Menyatakan atribut user |
| Authorization Decision Statement | Jarang dipakai dalam SSO modern |

Untuk SSO, yang paling umum adalah Authentication Statement + Attribute Statement.

---

### 4.5 SAML Response

SAML Response adalah envelope yang dikirim IdP ke SP.

Response bisa berisi assertion. Dalam praktik, yang perlu diperhatikan:

- response bisa signed;
- assertion bisa signed;
- keduanya bisa signed;
- assertion bisa encrypted;
- response punya status;
- response punya destination;
- response bisa punya `InResponseTo`.

SP harus tahu persis elemen mana yang harus signed sesuai policy.

---

### 4.6 Metadata

Metadata adalah konfigurasi trust.

Metadata SP biasanya berisi:

- entityID SP;
- ACS endpoint;
- Single Logout endpoint;
- certificate untuk signing/encryption;
- supported binding;
- requested attributes.

Metadata IdP biasanya berisi:

- entityID IdP;
- SSO endpoint;
- SLO endpoint;
- signing certificate;
- supported binding.

Metadata membuat trust bukan sekadar hardcoded URL.

Namun metadata juga punya lifecycle:

- expiry;
- refresh;
- signing;
- certificate rollover;
- endpoint change;
- multi-certificate overlap.

---

## 5. SAML Flow Utama

## 5.1 SP-Initiated Login

Ini flow paling sehat untuk kebanyakan aplikasi.

```text
1. User membuka aplikasi SP.
2. SP melihat user belum login.
3. SP membuat AuthnRequest.
4. SP menyimpan request ID dalam local state/session.
5. Browser diarahkan ke IdP.
6. IdP authenticate user.
7. IdP membuat SAML Response.
8. Browser POST response ke SP ACS endpoint.
9. SP validate response:
   - signature
   - issuer
   - destination
   - audience
   - condition
   - InResponseTo
   - replay
10. SP mapping user.
11. SP membuat local session.
12. User masuk aplikasi.
```

Kekuatan SP-initiated:

- ada request correlation;
- ada `InResponseTo`;
- lebih mudah mencegah unsolicited assertion;
- lebih cocok untuk multi-IdP/tenant;
- lebih mudah dikontrol redirect target-nya.

---

### 5.2 IdP-Initiated Login

Flow:

```text
1. User membuka portal IdP.
2. User memilih aplikasi.
3. IdP mengirim SAML Response ke SP ACS tanpa AuthnRequest sebelumnya.
4. SP memvalidasi assertion dan membuat session.
```

Risiko:

1. tidak ada `InResponseTo`;
2. correlation lebih lemah;
3. relay state bisa disalahgunakan;
4. multi-tenant discovery lebih rawan;
5. unsolicited login lebih sulit dibedakan dari login yang diharapkan.

IdP-initiated tidak selalu salah, tetapi harus diperlakukan lebih ketat:

- batasi IdP yang boleh unsolicited;
- batasi ACS endpoint;
- validasi issuer;
- validasi audience;
- validasi recipient;
- validasi relay state allowlist;
- enforce short validity;
- enforce replay cache;
- audit sebagai flow berbeda.

---

### 5.3 Single Logout

SAML mendukung Single Logout, tetapi dalam praktik sering kompleks.

Masalahnya:

1. user punya session di SP;
2. user punya session di IdP;
3. user mungkin punya session di banyak SP;
4. logout via front-channel bisa gagal jika browser tertutup;
5. back-channel bisa gagal karena network/cert/proxy;
6. partial logout umum terjadi.

Mental model:

```text
Login federation creates multiple sessions.
Logout federation tries to coordinate invalidation across them.
```

Production rule:

> Jangan menganggap SAML logout selalu global, atomic, dan reliable.

Untuk sistem penting, bedakan:

- local logout;
- IdP logout;
- global logout attempt;
- session expiry;
- forced re-authentication;
- administrator revocation.

---

## 6. Bindings dalam SAML

Binding adalah cara message SAML dikirim.

### 6.1 HTTP Redirect Binding

Umum untuk AuthnRequest dari SP ke IdP.

Karakteristik:

- message dikompresi;
- dimasukkan ke query parameter;
- bisa signed;
- cocok untuk request kecil;
- kurang cocok untuk response besar.

---

### 6.2 HTTP POST Binding

Umum untuk SAML Response dari IdP ke SP ACS.

Karakteristik:

- response dikirim via HTML form POST;
- assertion besar masih mungkin;
- front-channel lewat browser;
- browser membawa payload tetapi tidak dipercaya.

---

### 6.3 Artifact Binding

Lebih jarang.

Karakteristik:

- browser hanya membawa artifact/reference;
- SP menukar artifact ke IdP via back-channel;
- mengurangi eksposur assertion di browser;
- lebih kompleks.

---

### 6.4 SOAP Binding

Biasa untuk back-channel seperti artifact resolution atau logout tertentu.

---

## 7. Profiles dalam SAML

Profile adalah kombinasi assertion, protocol, dan binding untuk use case tertentu.

Yang paling relevan:

| Profile | Kegunaan |
|---|---|
| Web Browser SSO Profile | SSO browser klasik |
| Single Logout Profile | Logout antar SP/IdP |
| Artifact Resolution Profile | Reference token style |
| ECP Profile | Enhanced Client or Proxy, jarang untuk web biasa |
| SAML Bearer Assertion OAuth Profile | SAML assertion ditukar menjadi OAuth access token |

Untuk Java enterprise web app, fokus utama adalah Web Browser SSO Profile.

---

## 8. Anatomy of SAML Authentication Response

Contoh konseptual sederhana:

```xml
<samlp:Response
    ID="_response123"
    Version="2.0"
    IssueInstant="2026-06-19T10:00:00Z"
    Destination="https://sp.example.com/login/saml2/sso/idp1"
    InResponseTo="_request456">

    <saml:Issuer>https://idp.example.com/metadata</saml:Issuer>

    <samlp:Status>
        <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
    </samlp:Status>

    <saml:Assertion ID="_assertion789" IssueInstant="2026-06-19T10:00:01Z">
        <saml:Issuer>https://idp.example.com/metadata</saml:Issuer>

        <saml:Subject>
            <saml:NameID Format="...:persistent">abc-123</saml:NameID>
            <saml:SubjectConfirmation Method="...:bearer">
                <saml:SubjectConfirmationData
                    Recipient="https://sp.example.com/login/saml2/sso/idp1"
                    NotOnOrAfter="2026-06-19T10:05:00Z"
                    InResponseTo="_request456"/>
            </saml:SubjectConfirmation>
        </saml:Subject>

        <saml:Conditions
            NotBefore="2026-06-19T09:59:00Z"
            NotOnOrAfter="2026-06-19T10:05:00Z">
            <saml:AudienceRestriction>
                <saml:Audience>https://sp.example.com/saml/metadata</saml:Audience>
            </saml:AudienceRestriction>
        </saml:Conditions>

        <saml:AuthnStatement AuthnInstant="2026-06-19T09:59:30Z">
            <saml:AuthnContext>
                <saml:AuthnContextClassRef>
                    urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport
                </saml:AuthnContextClassRef>
            </saml:AuthnContext>
        </saml:AuthnStatement>

        <saml:AttributeStatement>
            <saml:Attribute Name="email">
                <saml:AttributeValue>alice@example.com</saml:AttributeValue>
            </saml:Attribute>
        </saml:AttributeStatement>
    </saml:Assertion>
</samlp:Response>
```

Jangan fokus pada tag XML-nya saja. Fokus pada invariant:

1. siapa issuer?
2. siapa subject?
3. assertion ditujukan untuk SP mana?
4. sampai kapan berlaku?
5. response ini menjawab request mana?
6. elemen mana yang ditandatangani?
7. apakah signature chain dipercaya?
8. apakah assertion pernah dipakai sebelumnya?
9. apakah attribute mapping aman?
10. apakah local session dibuat dengan benar?

---

## 9. Validation Pipeline yang Benar

SAML SP harus memiliki validation pipeline eksplisit.

### 9.1 Decode dan parse dengan aman

SAML adalah XML. XML parsing harus aman dari:

- XXE;
- entity expansion;
- external DTD;
- schema confusion;
- parser misconfiguration.

Rule:

```text
Never parse SAML XML using generic unsafe XML parser defaults.
```

Gunakan library matang seperti Spring Security SAML2/OpenSAML dan hindari parser custom.

---

### 9.2 Pilih relying party registration

Sebelum percaya response, SP harus menentukan konfigurasi trust yang relevan:

```text
registrationId / ACS endpoint / issuer / entityID
        |
        v
RelyingPartyRegistration
        |
        v
Expected IdP metadata + certificates + SP entityID
```

Multi-tenant aplikasi harus sangat hati-hati. Jangan sampai response dari tenant A divalidasi memakai trust tenant B.

---

### 9.3 Validasi status response

Response harus status success.

Jika bukan success:

- jangan create session;
- audit failure;
- jangan expose detail berlebihan ke user;
- simpan correlation ID.

---

### 9.4 Validasi issuer

Issuer harus sesuai IdP yang dipercaya.

Masalah umum:

```text
Expected issuer:
  https://idp.company.com/metadata

Actual issuer:
  https://evil.example.com/metadata
```

Signature valid tidak cukup bila certificate/key bukan milik IdP yang diharapkan.

---

### 9.5 Validasi signature

SP harus memvalidasi signature memakai certificate IdP yang dipercaya.

Yang perlu jelas:

1. apakah response harus signed?
2. apakah assertion harus signed?
3. apakah keduanya boleh?
4. apakah encrypted assertion wajib?
5. apakah unsigned assertion dalam signed response diterima?
6. apakah multiple assertions diperbolehkan?
7. bagaimana certificate rollover?

Production policy biasanya:

```text
Require signed assertion or signed response according to integration contract.
Prefer signed assertion for clear binding between subject data and signature.
Reject ambiguous/multiple unsigned assertion structures.
```

---

### 9.6 Validasi destination dan recipient

`Destination` dan `Recipient` harus menunjuk ACS endpoint SP yang benar.

Ini mencegah assertion untuk endpoint lain diterima di endpoint ini.

---

### 9.7 Validasi audience

Audience harus mengandung entityID SP.

Ini mencegah token substitution antar service.

Contoh failure:

```text
Assertion issued for:
  https://app-a.example.com/saml/metadata

But accepted by:
  https://app-b.example.com/saml/metadata
```

Ini adalah confused audience problem.

---

### 9.8 Validasi time condition

Validasi:

- `NotBefore`;
- `NotOnOrAfter`;
- `IssueInstant`;
- `SubjectConfirmationData NotOnOrAfter`;
- clock skew.

Clock skew harus terbatas.

Contoh:

```text
Allowed skew: 60s or 120s
Assertion lifetime: 2–5 minutes
```

Jangan memakai lifetime panjang seperti 1 jam untuk browser SSO response.

---

### 9.9 Validasi InResponseTo

Untuk SP-initiated flow:

1. SP membuat request ID;
2. request ID disimpan di session/cache;
3. response harus punya `InResponseTo`;
4. nilainya harus cocok;
5. request ID harus one-time-use;
6. hapus setelah dipakai.

Ini mencegah unsolicited/replayed response diterima sebagai jawaban login baru.

---

### 9.10 Replay detection

Assertion ID atau response ID harus masuk replay cache sampai expiry.

Contoh model:

```text
key = issuer + assertion_id
ttl = assertion_not_on_or_after + allowed_skew
```

Jika assertion sama diterima kedua kali, reject.

---

### 9.11 Subject confirmation

Untuk bearer assertion, SP harus memvalidasi:

- method bearer;
- recipient;
- notOnOrAfter;
- inResponseTo bila ada.

Bearer artinya:

> siapa pun yang membawa assertion bisa mencoba menggunakannya, sehingga assertion harus pendek umurnya dan one-time-use.

---

### 9.12 Attribute extraction setelah validation

Jangan mapping user sebelum validation selesai.

Urutan salah:

```text
parse XML
extract email
find user
then validate signature
```

Urutan benar:

```text
parse safely
validate response/assertion
validate trust context
then extract subject/attributes
then map user
```

---

## 10. XML Signature Wrapping

XML Signature Wrapping atau XSW adalah kelas serangan sangat penting di SAML.

Intinya:

> Attacker menyisipkan assertion palsu ke dokumen yang masih memiliki signature valid pada elemen lain, lalu aplikasi membaca assertion palsu, bukan assertion yang ditandatangani.

Contoh konseptual:

```text
Response
  Signed Assertion for victim
  Unsigned manipulated Assertion for attacker
```

Jika validator memvalidasi signature pada assertion pertama, tetapi aplikasi mengambil subject dari assertion kedua memakai query XML yang rapuh, attacker bisa login sebagai user lain.

OWASP menekankan untuk tidak memilih elemen security-related dengan cara generik seperti `getElementsByTagName` tanpa validasi struktur yang kuat. Seleksi elemen harus memastikan data yang dipakai aplikasi adalah data yang benar-benar ditandatangani.

Rule engineering:

1. jangan parse SAML manually;
2. jangan pakai `getElementsByTagName("Assertion")` untuk mengambil principal;
3. gunakan library yang mengikat hasil validasi ke assertion yang validated;
4. reject multiple assertion bila tidak didukung;
5. require exact signed element;
6. validate ID reference secara benar;
7. schema validation dan hardened XPath bila perlu;
8. test dengan malicious SAML samples.

---

## 11. Java XML Security Pitfalls

SAML di Java sangat sensitif terhadap XML stack.

### 11.1 Unsafe parser configuration

Risiko:

- XXE membaca file lokal;
- SSRF via external entity;
- entity expansion DoS;
- DTD injection.

Hardening umum:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();

factory.setNamespaceAware(true);
factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
factory.setXIncludeAware(false);
factory.setExpandEntityReferences(false);
```

Namun untuk SAML, rule utamanya tetap:

```text
Prefer established SAML libraries over hand-rolled XML parsing.
```

---

### 11.2 Namespace confusion

XML namespace membuat query sederhana sering salah.

Contoh buruk:

```java
document.getElementsByTagName("Assertion")
```

Masalah:

- tidak namespace-aware;
- bisa mengambil elemen palsu;
- tidak memastikan parent/position;
- tidak memastikan signed reference.

---

### 11.3 ID attribute handling

XML Signature memakai reference ke ID. Parser harus tahu attribute mana yang ID.

Jika ID handling salah, signature validation bisa keliru.

---

### 11.4 Canonicalization

XML Signature bergantung pada canonicalization. Perubahan whitespace/namespace bisa berpengaruh.

Jangan memodifikasi XML sebelum signature validation.

---

### 11.5 Algorithm restrictions

Jangan menerima algorithm lama/weak.

Policy modern:

- reject SHA-1 bila memungkinkan;
- gunakan SHA-256 atau lebih baik;
- batasi transform yang didukung;
- batasi canonicalization yang tidak diperlukan;
- validasi certificate/key sesuai metadata.

---

## 12. NameID dan Account Mapping

### 12.1 NameID format

Format umum:

| Format | Karakteristik |
|---|---|
| transient | Berubah-ubah, tidak cocok sebagai permanent account key |
| persistent | Stable per IdP-SP pair |
| emailAddress | Mudah dibaca, tetapi tidak selalu aman sebagai immutable ID |
| unspecified | Bergantung kontrak integrasi |

---

### 12.2 Mapping yang buruk

Contoh buruk:

```text
local user lookup by email only
```

Masalah:

1. email berubah;
2. email bisa reused;
3. email bisa tidak unik lintas tenant;
4. casing/normalisasi beda;
5. domain alias;
6. IdP berbeda bisa mengirim email sama;
7. attacker dari IdP lain bisa mengklaim email yang sama jika issuer tidak masuk lookup.

---

### 12.3 Mapping yang lebih aman

Gunakan composite identity:

```text
federated_identity:
  issuer_entity_id
  subject_name_id
  name_id_format
  local_user_id
  first_seen_at
  last_seen_at
```

Lookup:

```text
where issuer_entity_id = ?
  and subject_name_id = ?
  and name_id_format = ?
```

Email tetap attribute, bukan root identity.

---

### 12.4 First-login provisioning

Model:

1. assertion valid;
2. federated identity belum ada;
3. check provisioning policy;
4. create local user atau require linking;
5. audit;
6. bind issuer+subject ke local user.

Jangan auto-link hanya berdasarkan email tanpa policy kuat.

---

## 13. Attribute Mapping

Attribute SAML bisa dipakai untuk:

- display name;
- email;
- department;
- role;
- group;
- employee ID;
- tenant;
- clearance;
- organization unit.

Namun attribute bukan selalu authorization truth.

Pertanyaan desain:

1. Apakah group dari IdP langsung menjadi role aplikasi?
2. Apakah role aplikasi harus dikelola lokal?
3. Apakah attribute update setiap login?
4. Apakah attribute kosong berarti hapus lokal?
5. Apakah attribute multi-value?
6. Apakah value case-sensitive?
7. Apakah role dari IdP scoped per tenant?
8. Apakah perlu approval lokal untuk privileged role?

Pattern yang aman:

```text
SAML Attribute -> normalized external attribute
normalized external attribute -> application entitlement mapping
application entitlement -> local authorization decision
```

Jangan langsung:

```text
SAML group string == application admin
```

tanpa mapping layer dan audit.

---

## 14. AuthnContext dan Assurance

SAML `AuthnContextClassRef` memberi informasi tentang cara user diautentikasi.

Contoh:

- PasswordProtectedTransport;
- TimeSyncToken;
- SmartcardPKI;
- Kerberos;
- MFA-related context, tergantung IdP.

Masalah:

1. IdP berbeda memakai value berbeda;
2. context tidak selalu berarti assurance level yang sama;
3. app sering mengabaikan context;
4. step-up auth sulit jika SP tidak minta context tertentu.

Untuk sistem sensitif:

```text
Low-risk page:
  any valid SAML login

High-risk action:
  require recent authentication + MFA context
```

Tapi ini harus didukung IdP dan kontrak SAML.

---

## 15. ForceAuthn dan IsPassive

AuthnRequest bisa membawa parameter:

| Parameter | Makna |
|---|---|
| ForceAuthn | Minta IdP melakukan re-authentication |
| IsPassive | Minta IdP tidak berinteraksi dengan user |

Use case ForceAuthn:

- privileged action;
- user changing bank account;
- signing legal submission;
- admin console access;
- break-glass operation.

Risiko:

- IdP mungkin tidak mendukung;
- behavior vendor berbeda;
- reauthentication tidak sama dengan MFA;
- app tetap harus validate `AuthnInstant` dan context.

---

## 16. RelayState

RelayState biasa dipakai untuk menyimpan state seperti target URL setelah login.

Risiko:

- open redirect;
- tampering;
- state injection;
- overly large state;
- sensitive data leakage;
- IdP-initiated abuse.

Pattern aman:

```text
RelayState = opaque random state ID
server-side state:
  target_path = /case/123
  created_at
  csrf/session binding
  expiry
```

Jangan:

```text
RelayState=https://evil.example.com
```

dan jangan menyimpan data sensitif langsung di RelayState.

---

## 17. SAML Metadata Engineering

### 17.1 Metadata sebagai source of trust

Metadata tidak hanya “file konfigurasi”. Metadata menentukan:

- siapa entity yang dipercaya;
- endpoint mana yang valid;
- certificate mana yang valid;
- binding mana yang didukung.

---

### 17.2 Certificate rollover

Rollover yang buruk sering menyebabkan outage.

Safe rollover pattern:

```text
T0: IdP publishes old + new signing cert
T1: SP refreshes metadata and trusts both
T2: IdP starts signing with new cert
T3: SP validates new signature
T4: old cert removed after safe window
```

Jika SP hanya hardcode satu certificate, rollover menjadi risky.

---

### 17.3 Metadata refresh

Untuk dynamic metadata:

1. fetch via HTTPS;
2. validate metadata signature bila tersedia;
3. cache with expiry;
4. monitor fetch failure;
5. avoid replacing valid metadata with failed fetch;
6. alert before certificate expiry;
7. support rollback.

---

### 17.4 Multi-IdP metadata

Untuk multi-tenant:

```text
tenant_id -> relying_party_registration -> expected issuer/certs/endpoints
```

Jangan memilih IdP hanya dari assertion issuer tanpa tenant context yang kuat, karena bisa menyebabkan tenant confusion.

---

## 18. Java Implementation Models

## 18.1 Spring Security SAML2 Service Provider

Spring Security menyediakan dukungan SAML2 Login untuk aplikasi Servlet.

Konsep utama:

- `saml2Login()`;
- `RelyingPartyRegistration`;
- `RelyingPartyRegistrationRepository`;
- `Saml2Authentication`;
- metadata endpoint;
- ACS endpoint;
- asserting party metadata loading.

Contoh konseptual konfigurasi Spring Boot:

```yaml
spring:
  security:
    saml2:
      relyingparty:
        registration:
          corporate-idp:
            entity-id: "https://sp.example.com/saml/metadata"
            assertion-consumer-service:
              location: "https://sp.example.com/login/saml2/sso/corporate-idp"
            assertingparty:
              metadata-uri: "https://idp.example.com/metadata"
```

Java security chain:

```java
@Bean
SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/public/**").permitAll()
            .anyRequest().authenticated()
        )
        .saml2Login(saml -> {
            // custom success handler, authentication converter, etc if needed
        })
        .logout(logout -> logout
            .logoutSuccessUrl("/")
        )
        .build();
}
```

Hal yang perlu dipahami:

> Spring config bukan security guarantee otomatis. Security guarantee tergantung registration, metadata, validation policy, attribute mapping, session lifecycle, dan operational practices.

---

### 18.2 OpenSAML

OpenSAML adalah library Java penting untuk membangun dan memproses SAML.

Namun untuk kebanyakan aplikasi, gunakan framework integration di atas OpenSAML daripada memakai OpenSAML mentah.

OpenSAML mentah cocok untuk:

- custom SAML processing;
- advanced validation;
- metadata tooling;
- non-standard integration;
- gateway/federation broker;
- product/platform security layer.

Risiko OpenSAML mentah:

- banyak detail low-level;
- mudah salah memvalidasi XML signature;
- mudah salah pilih assertion;
- butuh expertise tinggi.

---

### 18.3 Shibboleth SP / External Gateway

Pattern lain:

```text
Browser
  -> Apache/Nginx/Shibboleth SP
  -> Java application receives trusted headers
```

Risiko:

1. app mempercayai header tanpa memastikan hanya gateway yang bisa set;
2. header spoofing;
3. missing mTLS/internal network isolation;
4. logout/session mismatch;
5. audit principal tidak lengkap.

Jika memakai gateway/header pattern:

```text
Only accept identity headers from trusted reverse proxy.
Strip incoming identity headers at edge.
Use mTLS or private network between proxy and app.
Audit original IdP issuer and subject.
```

---

### 18.4 Jakarta EE / Container Vendor Adapter

Beberapa application server punya SAML adapter/vendor security integration.

Kelebihan:

- centralized container auth;
- cocok untuk enterprise app server;
- role mapping container;
- integrasi realm/security domain.

Kekurangan:

- vendor-specific;
- portability rendah;
- debugging sulit;
- modern cloud-native deployment kurang fleksibel;
- upgrade dependency bisa lambat.

---

## 19. SP Session Setelah SAML Login

Setelah SAML assertion valid, SP biasanya membuat session lokal.

Flow:

```text
SAML Response valid
  -> create Authentication object
  -> create local HttpSession
  -> issue session cookie
  -> subsequent requests use session cookie
```

Implikasi:

1. assertion pendek umur, session bisa lebih panjang;
2. logout harus menghapus local session;
3. IdP session dan SP session berbeda;
4. role/attribute update hanya terjadi saat login kecuali ada sync lain;
5. user disable di IdP tidak otomatis mematikan SP session kecuali ada back-channel/revocation/session max age.

Production policy:

```text
SAML assertion lifetime: minutes
SP idle timeout: sesuai risk, misalnya 15–30 menit
SP absolute timeout: sesuai risk, misalnya 8–12 jam atau lebih pendek
Re-authentication required for sensitive actions
```

---

## 20. SAML in Multi-Tenant Enterprise Java Systems

Multi-tenant SAML sulit karena setiap tenant bisa punya IdP berbeda.

### 20.1 Tenant discovery

Cara discovery:

1. domain email;
2. tenant-specific URL;
3. subdomain;
4. explicit organization selector;
5. invitation link;
6. stored user preference.

Paling aman biasanya tenant-specific entrypoint:

```text
https://app.example.com/t/{tenantSlug}/login
```

Lalu:

```text
tenantSlug -> relying party registration
```

---

### 20.2 Tenant-bound ACS

ACS bisa shared atau per registration.

Contoh shared:

```text
/login/saml2/sso/{registrationId}
```

Yang penting:

- registration ID tidak boleh mudah menyebabkan tenant confusion;
- response harus sesuai issuer;
- audience harus sesuai SP entity;
- state harus terikat session/request.

---

### 20.3 Cross-tenant subject collision

Jangan:

```text
find user by NameID only
```

Gunakan:

```text
issuer + NameID + tenant
```

atau model yang secara eksplisit memisahkan tenant identity.

---

### 20.4 Tenant offboarding

Ketika tenant memutus integrasi:

1. disable relying party registration;
2. reject new SAML login;
3. expire sessions if required;
4. archive metadata;
5. preserve audit;
6. revoke admin links;
7. rotate related keys if shared risk exists.

---

## 21. SAML Security Checklist

### 21.1 Trust validation

- [ ] Expected issuer checked.
- [ ] Signature required.
- [ ] Signature validated against trusted IdP cert.
- [ ] Weak algorithms rejected.
- [ ] AudienceRestriction checked.
- [ ] Destination checked.
- [ ] Recipient checked.
- [ ] ACS endpoint matched.
- [ ] Metadata source controlled.
- [ ] Certificate rollover supported.

### 21.2 Time and replay

- [ ] `NotBefore` checked.
- [ ] `NotOnOrAfter` checked.
- [ ] bounded clock skew.
- [ ] assertion lifetime short.
- [ ] replay cache enabled.
- [ ] request ID one-time-use.
- [ ] `InResponseTo` required for SP-initiated.

### 21.3 XML security

- [ ] no manual unsafe XML parsing.
- [ ] XXE disabled if parsing needed.
- [ ] no `getElementsByTagName` for security decision.
- [ ] signed element is the element used.
- [ ] multiple assertion behavior controlled.
- [ ] encrypted assertion support tested if required.

### 21.4 Account mapping

- [ ] local identity not based on email only.
- [ ] issuer included in federated identity key.
- [ ] NameID format understood.
- [ ] first-login provisioning controlled.
- [ ] account linking requires strong verification.
- [ ] role/group mapping audited.

### 21.5 Operational

- [ ] metadata expiry monitored.
- [ ] certificate expiry monitored.
- [ ] clock synchronization monitored.
- [ ] IdP outage behavior defined.
- [ ] failed login events logged.
- [ ] successful login events logged.
- [ ] assertion IDs never logged in full if sensitive.
- [ ] PII minimized in logs.

---

## 22. Common Failure Modes

### 22.1 Signature valid, wrong audience

Cause:

- SP validates signature but ignores audience.

Impact:

- assertion for app A accepted by app B.

Fix:

- enforce AudienceRestriction equals expected SP entityID.

---

### 22.2 Valid assertion replayed

Cause:

- no replay cache;
- long assertion lifetime.

Impact:

- captured assertion reused.

Fix:

- short lifetime;
- assertion ID replay cache;
- TLS;
- secure ACS.

---

### 22.3 XML signature wrapping

Cause:

- application reads unsigned assertion after validating signed sibling.

Impact:

- account takeover.

Fix:

- use hardened library;
- bind validation result to extracted assertion;
- reject unexpected structure.

---

### 22.4 Email-based account takeover

Cause:

- auto-link by email from any IdP.

Impact:

- attacker IdP sends victim email.

Fix:

- issuer-bound identity;
- verified tenant;
- controlled provisioning.

---

### 22.5 Certificate rollover outage

Cause:

- SP pins old cert only;
- IdP rotates signing key.

Impact:

- all logins fail.

Fix:

- metadata refresh;
- dual cert overlap;
- expiry alert.

---

### 22.6 IdP-initiated open redirect

Cause:

- RelayState contains arbitrary URL.

Impact:

- phishing/open redirect.

Fix:

- server-side opaque RelayState;
- allowlist relative paths.

---

### 22.7 Clock skew outage

Cause:

- SP clock drift;
- strict NotBefore/NotOnOrAfter.

Impact:

- valid users rejected.

Fix:

- NTP;
- bounded skew;
- monitoring.

---

### 22.8 Wrong IdP selected in multi-tenant app

Cause:

- registration selected by untrusted request parameter only.

Impact:

- tenant confusion/account mix-up.

Fix:

- bind tenant login route to registration;
- validate issuer and audience;
- use state correlation.

---

## 23. Design Patterns

## 23.1 SP-initiated SSO with local session

Best default for Java web apps.

```text
User -> SP -> IdP -> SP ACS -> local session
```

Use when:

- normal browser web app;
- enterprise SSO;
- SaaS tenant login;
- Spring/Jakarta app.

---

## 23.2 SAML gateway / federation broker

Pattern:

```text
Many IdPs -> Broker -> App via OIDC/session/header
```

Use when:

- app does not want to integrate many SAML IdPs;
- need normalization;
- need central audit;
- need multi-protocol support.

Examples:

- Keycloak as broker;
- PingFederate;
- Entra external identities;
- custom identity gateway.

Trade-off:

- simpler app;
- broker becomes critical trust infrastructure.

---

## 23.3 SAML to local RBAC mapping

Pattern:

```text
SAML attributes/groups
  -> normalized identity profile
  -> entitlement mapping
  -> application roles
```

Avoid direct group-to-admin without governance.

---

## 23.4 SAML for login, OAuth2 for API

Common architecture:

```text
Browser login:
  SAML to web app

API calls:
  local session or token from backend

Service-to-service:
  OAuth2 client credentials or mTLS
```

Do not force SAML into every internal API. SAML is primarily suited for browser SSO/federation, not lightweight microservice auth.

---

## 23.5 Step-up with SAML ForceAuthn

Pattern:

```text
User logged in
  -> attempts sensitive action
  -> SP sends AuthnRequest with ForceAuthn / requested context
  -> IdP reauthenticates/MFA
  -> SP validates new AuthnInstant/context
  -> action allowed
```

Works only if IdP supports policy correctly.

---

## 24. SAML and Java Version Relevance: Java 8 to 25

### Java 8

Common reality:

- legacy Spring Security SAML extension;
- older OpenSAML versions;
- app server SAML adapters;
- JKS keystore;
- XML parser hardening often manual;
- older TLS/cipher defaults.

Focus:

- upgrade libraries;
- reject SHA-1 where possible;
- harden XML;
- improve metadata/cert lifecycle.

---

### Java 11

Common baseline for enterprise modernization.

Benefits:

- better TLS defaults than Java 8;
- more modern Spring Boot support;
- easier container deployment.

---

### Java 17

Popular LTS for Spring Boot 3 baseline.

Considerations:

- Jakarta namespace migration if moving from `javax` to `jakarta`;
- Spring Security 6;
- more modern crypto/TLS defaults.

---

### Java 21

Modern LTS.

Considerations:

- virtual threads affect context propagation around authenticated sessions/tasks;
- modern Spring ecosystem;
- better runtime observability.

---

### Java 25

Current modern line in this series.

Considerations:

- stronger alignment with latest Java security APIs;
- modern TLS/runtime behavior;
- PEM and key material handling improvements in newer JDK evolution are relevant to certificate/key operations;
- still use mature SAML libraries rather than custom crypto/XML.

---

## 25. Production Architecture Example

Scenario:

- Java 21 Spring Boot case management app;
- multiple agencies;
- each agency has its own IdP;
- SP supports SAML SSO;
- app has local RBAC;
- audit required.

Architecture:

```text
Browser
  |
  v
https://case.example.com/t/agency-a/login
  |
  v
Tenant Resolver
  |
  v
RelyingPartyRegistration: agency-a
  |
  v
SAML AuthnRequest
  |
  v
Agency A IdP
  |
  v
SAML Response POST to /login/saml2/sso/agency-a
  |
  v
SAML Validation Pipeline
  |
  +-- issuer check
  +-- signature check
  +-- audience check
  +-- destination/recipient check
  +-- InResponseTo check
  +-- time condition check
  +-- replay check
  |
  v
Federated Identity Lookup
  |
  v
Local User + Entitlement Mapping
  |
  v
HttpSession Created
  |
  v
Application Access
```

Persistence tables:

```text
users
  id
  display_name
  email
  status
  created_at

federated_identities
  id
  user_id
  tenant_id
  issuer_entity_id
  name_id
  name_id_format
  first_seen_at
  last_seen_at

saml_login_events
  id
  tenant_id
  issuer_entity_id
  subject_hash
  assertion_id_hash
  response_id_hash
  authn_instant
  result
  failure_reason
  correlation_id
  created_at

tenant_saml_registrations
  id
  tenant_id
  registration_id
  sp_entity_id
  idp_entity_id
  metadata_url
  metadata_cached_until
  enabled
```

---

## 26. Audit Model

Audit event for successful SAML login:

```json
{
  "event_type": "SAML_LOGIN_SUCCESS",
  "tenant_id": "agency-a",
  "registration_id": "agency-a",
  "idp_issuer": "https://idp.agency-a.example/metadata",
  "sp_entity_id": "https://case.example.com/saml/metadata/agency-a",
  "subject_hash": "sha256:...",
  "name_id_format": "persistent",
  "authn_instant": "2026-06-19T09:59:30Z",
  "session_id_hash": "sha256:...",
  "correlation_id": "req-...",
  "source_ip": "203.0.113.10",
  "user_agent_hash": "sha256:...",
  "result": "SUCCESS"
}
```

Audit event for failure:

```json
{
  "event_type": "SAML_LOGIN_FAILURE",
  "tenant_id": "agency-a",
  "registration_id": "agency-a",
  "idp_issuer": "https://idp.agency-a.example/metadata",
  "failure_code": "AUDIENCE_MISMATCH",
  "correlation_id": "req-...",
  "result": "FAILURE"
}
```

Important:

- do not log raw assertion;
- do not log full SAML response;
- avoid logging full PII;
- hash identifiers where possible;
- keep enough information for forensic reconstruction.

---

## 27. Testing Strategy

### 27.1 Unit tests

Test:

- attribute mapping;
- NameID mapping;
- tenant resolution;
- relay state validation;
- entitlement mapping.

---

### 27.2 Integration tests

Test with real SAML library:

- valid signed response;
- expired assertion;
- wrong audience;
- wrong issuer;
- wrong destination;
- missing signature;
- replayed assertion;
- unknown registration;
- certificate rollover.

---

### 27.3 Security regression tests

Include malicious samples:

- XML signature wrapping;
- multiple assertions;
- unsigned assertion plus signed response ambiguity;
- external entity payload;
- open redirect RelayState;
- very large response;
- unsupported algorithm.

---

### 27.4 Operational tests

Test:

- metadata URL down;
- old metadata cache still works;
- cert near expiry alert;
- IdP response latency;
- ACS endpoint behind proxy;
- wrong public URL generation;
- clock drift.

---

## 28. Debugging SAML in Java

### 28.1 Common questions

When login fails, ask:

1. Did SP generate AuthnRequest?
2. Did browser reach IdP?
3. Did IdP authenticate user?
4. Did IdP POST to correct ACS?
5. Does SP recognize registration?
6. Is issuer expected?
7. Is signature valid?
8. Is certificate current?
9. Is audience correct?
10. Is destination/recipient correct?
11. Is assertion expired?
12. Is `InResponseTo` known?
13. Is request ID already used?
14. Did attribute mapping fail?
15. Did local user provisioning fail?

---

### 28.2 Safe debug logging

Do log:

- correlation ID;
- registration ID;
- issuer;
- expected audience;
- actual audience;
- status code;
- failure category;
- timestamp delta;
- certificate fingerprint.

Do not log:

- raw SAML response;
- full assertion;
- full NameID if sensitive;
- attribute values containing PII;
- session cookie;
- private key;
- decrypted assertion.

---

## 29. Decision Framework: When to Use SAML

Use SAML when:

1. enterprise IdP requires SAML;
2. SaaS enterprise SSO is required;
3. legacy corporate federation exists;
4. browser-based SSO is primary;
5. attribute-based enterprise integration is needed;
6. institutional trust metadata/certificate model is acceptable.

Prefer OIDC when:

1. modern web/mobile app;
2. API-first architecture;
3. JSON/JWT ecosystem preferred;
4. dynamic clients;
5. token-based resource server architecture;
6. easier cloud-native integration.

Use federation broker when:

1. many SAML IdPs;
2. app wants OIDC internally;
3. claim normalization needed;
4. multi-tenant enterprise SaaS;
5. IdP-specific quirks should be isolated.

---

## 30. Anti-Patterns

### Anti-pattern 1: “SAML response decoded, therefore authenticated”

Wrong. Decoding Base64/XML does not authenticate anything.

---

### Anti-pattern 2: “Signature valid, therefore accepted”

Wrong. Signature must be valid under expected issuer/cert and assertion must satisfy audience/time/recipient/replay conditions.

---

### Anti-pattern 3: “Email is user ID”

Dangerous. Email is attribute, not universal immutable identity.

---

### Anti-pattern 4: “IdP-initiated is always fine”

Not always. It lacks request correlation and needs stricter controls.

---

### Anti-pattern 5: “Log raw SAML for debugging”

Dangerous. SAML response may contain PII and bearer assertion.

---

### Anti-pattern 6: “Manual XML parsing is simple”

Wrong. SAML XML security is hard.

---

### Anti-pattern 7: “SAML handles app authorization”

Usually wrong. SAML can provide attributes, but app still owns authorization decision.

---

### Anti-pattern 8: “Logout is guaranteed global logout”

Wrong. SAML logout is best-effort and failure-prone.

---

## 31. What Top 1% Engineers Understand About SAML

A strong engineer does not merely know that SAML has IdP and SP. They understand these invariants:

1. Authentication result is a signed assertion, not a password handoff.
2. Browser is a transport, not a trusted party.
3. Signature validation must be tied to the exact assertion consumed.
4. Audience, recipient, destination, issuer, and time conditions are not optional details.
5. NameID mapping determines account takeover risk.
6. Metadata is live trust infrastructure.
7. Certificate rollover is operational security, not paperwork.
8. IdP-initiated SSO weakens request correlation.
9. SAML login usually becomes local session auth after ACS.
10. SAML should not be stretched into every microservice call.
11. Attribute mapping must be governed and auditable.
12. XML security is uniquely dangerous compared to JSON token parsing.
13. Multi-tenant SAML is mostly a tenant isolation problem.
14. Logout is distributed state invalidation and cannot be assumed atomic.
15. Good SAML systems are designed around validation pipeline, not framework defaults.

---

## 32. Practical Design Checklist

Before implementing SAML in Java, answer:

1. Is this SP-initiated, IdP-initiated, or both?
2. What is SP entityID?
3. What is ACS URL?
4. Is assertion signed, response signed, or both?
5. Is assertion encrypted?
6. What IdP certificate is trusted?
7. How is metadata refreshed?
8. How is certificate rollover handled?
9. What NameID format is used?
10. What is the immutable external subject key?
11. What attributes are required?
12. Are attributes authoritative or advisory?
13. How are roles mapped?
14. How is first-login provisioning controlled?
15. Is RelayState opaque and server-side?
16. Is replay cache enabled?
17. How long are assertions valid?
18. What clock skew is accepted?
19. Is IdP-initiated allowed?
20. How are failed logins audited?
21. How are successful logins audited?
22. What happens when IdP is down?
23. What happens when metadata expires?
24. What happens when cert expires?
25. How is logout handled?

---

## 33. Minimal Secure Java/Spring SAML Posture

For a modern Spring Boot app:

1. Use Spring Security SAML2 Service Provider support.
2. Load IdP metadata from controlled source.
3. Configure explicit relying party registration.
4. Use SP-initiated login by default.
5. Require signed assertion/response according to contract.
6. Validate issuer/audience/destination/recipient.
7. Use short assertion validity.
8. Enable replay protection.
9. Use issuer+NameID as federated identity key.
10. Avoid email-only linking.
11. Use local session after login.
12. Rotate session ID after authentication.
13. Audit login success/failure.
14. Monitor metadata/cert expiry.
15. Test malicious SAML samples.
16. Do not manually parse assertion for security decisions.

---

## 34. Summary

SAML 2.0 adalah protokol federated authentication yang tetap sangat penting di Java enterprise. Walaupun terlihat legacy karena berbasis XML, SAML masih menjadi fondasi SSO di banyak organisasi besar.

Hal paling penting:

```text
SAML authentication = validate signed assertion under explicit trust contract,
then map subject safely to local identity,
then create local application session.
```

SAML yang aman membutuhkan:

1. trust metadata yang benar;
2. certificate/key lifecycle yang sehat;
3. signature validation yang ketat;
4. audience/destination/recipient validation;
5. time condition validation;
6. replay defense;
7. account mapping yang issuer-bound;
8. attribute mapping yang governed;
9. XML security awareness;
10. observability dan audit.

SAML bukan hanya “enable SSO”. SAML adalah boundary antara external institutional identity dan local application trust.

---

## 35. Referensi

- OASIS — SAML 2.0 Technical Overview: https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html
- OASIS — Security Assertion Markup Language SAML v2.0 Standard: https://www.oasis-open.org/standard/saml/
- Spring Security — SAML 2.0 Login Overview: https://docs.spring.io/spring-security/reference/servlet/saml2/login/overview.html
- Spring Security — SAML 2.0 Metadata: https://docs.spring.io/spring-security/reference/servlet/saml2/metadata.html
- Spring Security — RelyingPartyRegistration API: https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/saml2/provider/service/registration/RelyingPartyRegistration.html
- OWASP — SAML Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html
- OpenSAML — Project Documentation: https://shibboleth.atlassian.net/wiki/spaces/OSAML/overview
- RFC 7522 — SAML 2.0 Bearer Assertion Profiles for OAuth 2.0: https://datatracker.ietf.org/doc/rfc7522/

---

## 36. Latihan Pemahaman

Jawab pertanyaan berikut sebelum lanjut:

1. Mengapa signature valid saja belum cukup untuk menerima SAML assertion?
2. Mengapa audience restriction wajib divalidasi?
3. Apa risiko memakai email sebagai primary identity?
4. Apa perbedaan SP-initiated dan IdP-initiated login dari sisi security?
5. Mengapa replay cache diperlukan?
6. Bagaimana XML signature wrapping bisa menyebabkan account takeover?
7. Mengapa metadata adalah bagian dari trust infrastructure?
8. Bagaimana desain certificate rollover yang aman?
9. Mengapa SAML login biasanya tetap menghasilkan local session?
10. Kapan lebih baik memakai OIDC daripada SAML?

---

## 37. Koneksi ke Part Berikutnya

Part berikutnya adalah:

> **Part 18 — LDAP, Active Directory, Kerberos, and Enterprise Directory Authentication**

Setelah memahami SAML sebagai federation protocol, kita akan turun ke enterprise directory authentication: LDAP bind, Active Directory group lookup, Kerberos/SPNEGO, JAAS Kerberos, ticket lifecycle, nested group resolution, dan failure mode directory outage.

SAML sering duduk di atas directory system. Banyak IdP SAML sebenarnya melakukan authentication user ke AD/LDAP/Kerberos di belakang layar.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-016.md">⬅️ Part 16 — Client Credentials and Machine-to-Machine Authentication</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-018.md">LDAP, Active Directory, Kerberos, and Enterprise Directory Authentication ➡️</a>
</div>
