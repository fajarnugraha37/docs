# Part 19 — SAML, Enterprise SSO, and Legacy Federation Integration

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-19-saml-enterprise-sso-legacy-federation.md`  
> Target pembaca: Java/Jakarta engineer yang ingin memahami SAML dan enterprise SSO bukan sebagai “XML login flow”, tetapi sebagai kontrak trust, identity assertion, container integration, dan production failure surface.

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya sudah membahas OAuth2 Resource Server pattern untuk Servlet/JAX-RS. Sekarang kita masuk ke protokol federation yang jauh lebih tua, masih sangat hidup di enterprise, government, pendidikan, perbankan, insurance, dan legacy IAM: **SAML 2.0**.

SAML sering terasa “jadul” karena berbasis XML, metadata, certificate, redirect/POST binding, dan konfigurasi IdP/SP yang verbose. Tetapi di banyak organisasi besar, SAML masih menjadi standar utama untuk SSO karena:

1. sudah lama dipakai;
2. banyak IAM enterprise mendukungnya dengan matang;
3. cocok untuk browser-based SSO;
4. cocok untuk B2B federation;
5. dipahami oleh tim IAM, compliance, dan security governance;
6. sering sudah terhubung dengan Active Directory/LDAP/enterprise directory;
7. mendukung signed assertion dan metadata exchange;
8. menjadi kontrak identitas lintas organisasi.

Tujuan utama bagian ini:

- memahami SAML sebagai **identity assertion protocol**, bukan hanya login redirect;
- memahami peran **Identity Provider (IdP)** dan **Service Provider (SP)**;
- memahami SAML assertion, subject, attributes, audience, recipient, ACS, metadata, dan certificate;
- memahami SP-initiated vs IdP-initiated login;
- memahami integrasi SAML ke aplikasi Java/Jakarta;
- memahami pilihan integrasi: container, gateway, adapter, library, bridge SAML→OIDC;
- memahami mapping SAML attribute ke caller principal, group, role, dan domain permission;
- memahami security risks seperti XML Signature Wrapping, assertion replay, weak validation, IdP-initiated ambiguity, clock skew, wrong audience, dan trust boundary mistake;
- memahami bagaimana men-debug SAML issue di production;
- memahami strategi migrasi dari SAML ke OIDC tanpa merusak identity contract enterprise.

Referensi resmi utama:

- OASIS SAML 2.0 Technical Overview: https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html
- OASIS SAML 2.0 Core, Bindings, Profiles, Metadata: https://docs.oasis-open.org/security/saml/v2.0/
- OWASP SAML Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html
- Jakarta Security 4.0: https://jakarta.ee/specifications/security/4.0/
- Jakarta Authentication 3.1: https://jakarta.ee/specifications/authentication/3.1/

---

## 1. Mental Model: Apa Itu SAML?

SAML adalah singkatan dari **Security Assertion Markup Language**.

Kalimat paling penting:

> SAML adalah cara standar bagi satu sistem tepercaya untuk membuat pernyataan tentang identitas user, lalu sistem lain menerima pernyataan itu sebagai dasar login dan authorization.

Dalam SAML, yang berpindah bukan password user, tetapi **assertion**.

Contoh mental model:

```text
User ingin masuk ke Aplikasi Jakarta Enterprise.
Aplikasi tidak meminta password langsung.
Aplikasi mengarahkan user ke Identity Provider.
Identity Provider mengautentikasi user.
Identity Provider membuat SAML Assertion.
Browser membawa assertion itu kembali ke aplikasi.
Aplikasi memvalidasi assertion.
Jika valid, aplikasi membuat local session.
```

Dengan kata lain:

```text
Password stays at IdP.
Assertion travels to SP.
Session is created at SP.
```

SAML bukan “database user”. SAML bukan “role engine”. SAML bukan “session store aplikasi”. SAML adalah protokol untuk menyampaikan **asserted identity** dari IdP ke SP.

---

## 2. Aktor Utama SAML

### 2.1 Principal / User / Subject

Ini adalah entitas yang login. Biasanya manusia, tetapi secara konsep bisa juga entitas non-manusia dalam skenario tertentu.

Dalam SAML, user sering disebut **subject**.

Contoh:

```text
Subject = fajar.abdi@example.com
```

Tetapi subject bukan selalu email. Bisa juga:

```text
employeeNumber=12345
uid=fajar
persistent-id=abcde-12345
```

Kesalahan umum:

> Menganggap `NameID` selalu email dan stabil selamanya.

Padahal `NameID` bisa memiliki format berbeda dan lifecycle berbeda.

---

### 2.2 Identity Provider / IdP

**Identity Provider** adalah pihak yang mengautentikasi user dan menerbitkan assertion.

Contoh produk/peran:

- enterprise IAM;
- Active Directory Federation Services;
- Azure AD / Entra ID SAML app;
- Okta SAML app;
- PingFederate;
- Shibboleth;
- Keycloak sebagai SAML IdP;
- government IdP;
- corporate SSO.

Tugas IdP:

1. authenticate user;
2. decide apakah user boleh masuk ke SP tertentu;
3. membuat assertion;
4. menandatangani assertion/response;
5. mengirim assertion ke SP;
6. menyediakan metadata IdP;
7. menyediakan certificate signing;
8. mengirim attributes seperti email, name, department, group.

---

### 2.3 Service Provider / SP

**Service Provider** adalah aplikasi yang menerima SAML assertion dan memberikan layanan kepada user.

Dalam konteks kita:

```text
Jakarta EE web application = SAML Service Provider
```

Tugas SP:

1. membuat AuthnRequest jika SP-initiated;
2. menerima SAML Response di ACS endpoint;
3. memvalidasi signature;
4. memvalidasi issuer;
5. memvalidasi audience;
6. memvalidasi recipient/destination;
7. memvalidasi time condition;
8. memvalidasi replay;
9. membaca subject dan attributes;
10. membuat local authenticated session;
11. memetakan attribute ke role/permission aplikasi;
12. logout jika didukung.

---

### 2.4 Browser

Browser adalah carrier. Ini penting.

SAML Web Browser SSO sangat sering memakai browser untuk membawa pesan SAML via:

- HTTP Redirect Binding;
- HTTP POST Binding;
- Artifact Binding.

Browser tidak boleh dianggap trusted party. Browser hanya transport participant.

Kesalahan fatal:

```text
Karena SAML Response datang dari browser, lalu aplikasi percaya saja isi XML-nya.
```

Yang benar:

```text
SAML Response datang melalui browser, tetapi trust berasal dari signature IdP dan validasi ketat SP.
```

---

## 3. SAML sebagai Trust Contract

SAML bukan terutama masalah parsing XML. SAML adalah kontrak trust.

Sebuah SP percaya kepada IdP karena sebelumnya ada konfigurasi:

```text
SP trusts IdP issuer X
SP trusts IdP signing certificate Y
SP expects audience = SP entity ID
SP expects response at ACS URL Z
SP accepts specific NameID format
SP maps specific attributes to application identity
```

Jika salah satu kontrak ini longgar, security bisa runtuh.

Contoh kontrak minimal:

```yaml
sp:
  entityId: "https://app.example.com/saml/metadata"
  acsUrl: "https://app.example.com/saml/acs"
  requireSignedResponse: true
  requireSignedAssertion: true
  allowedIdpIssuer: "https://idp.example.com/saml"
  trustedIdpCertificates:
    - "MIIC..."
  acceptedNameIdFormats:
    - "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent"
  requiredAttributes:
    - email
    - employeeId
    - groups
```

Mental model:

```text
SAML login = cryptographically signed identity statement + strict contextual validation + local session establishment.
```

---

## 4. SAML Assertion

SAML Assertion adalah dokumen XML yang berisi pernyataan IdP tentang subject.

Assertion bisa berisi beberapa statement:

1. **Authentication Statement**  
   User sudah diautentikasi pada waktu tertentu, dengan metode tertentu.

2. **Attribute Statement**  
   User memiliki attribute tertentu.

3. **Authorization Decision Statement**  
   Jarang dipakai dalam SSO modern; authorization biasanya dilakukan aplikasi.

Contoh bentuk konseptual:

```xml
<saml:Assertion>
  <saml:Issuer>https://idp.example.com/saml</saml:Issuer>

  <saml:Subject>
    <saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">
      a8f9d2-user-123
    </saml:NameID>
    <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
      <saml:SubjectConfirmationData
          Recipient="https://app.example.com/saml/acs"
          NotOnOrAfter="2026-06-17T09:10:00Z" />
    </saml:SubjectConfirmation>
  </saml:Subject>

  <saml:Conditions NotBefore="2026-06-17T09:00:00Z"
                   NotOnOrAfter="2026-06-17T09:10:00Z">
    <saml:AudienceRestriction>
      <saml:Audience>https://app.example.com/saml/metadata</saml:Audience>
    </saml:AudienceRestriction>
  </saml:Conditions>

  <saml:AuthnStatement AuthnInstant="2026-06-17T09:00:01Z">
    <saml:AuthnContext>
      <saml:AuthnContextClassRef>
        urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport
      </saml:AuthnContextClassRef>
    </saml:AuthnContext>
  </saml:AuthnStatement>

  <saml:AttributeStatement>
    <saml:Attribute Name="email">
      <saml:AttributeValue>fajar@example.com</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="groups">
      <saml:AttributeValue>ACEAS_APPROVER</saml:AttributeValue>
      <saml:AttributeValue>ACEAS_CASE_OFFICER</saml:AttributeValue>
    </saml:Attribute>
  </saml:AttributeStatement>
</saml:Assertion>
```

Assertion harus dianggap sebagai high-value security artifact.

Jika assertion bocor dan belum expired, attacker bisa melakukan replay jika SP tidak memiliki replay protection.

---

## 5. SAML Response vs SAML Assertion

Perbedaan penting:

```text
SAML Response = envelope dari IdP ke SP.
SAML Assertion = statement identity di dalam response.
```

Sering ada pertanyaan:

> Yang harus ditandatangani response atau assertion?

Jawaban enterprise-safe:

```text
Require signed assertion, dan sering juga signed response, tergantung profile dan library/container.
```

Minimal, SP harus memastikan data identity yang dipakai benar-benar berada di bagian XML yang valid dan terlindungi signature.

Bahaya XML Signature Wrapping muncul ketika aplikasi memvalidasi signature atas elemen A, tetapi membaca identity dari elemen B yang tidak ditandatangani.

OWASP secara eksplisit memperingatkan agar tidak memilih elemen security-sensitive dengan `getElementsByTagName` tanpa validasi yang tepat dan menyarankan selection yang ketat/hardened untuk mencegah signature wrapping.

---

## 6. Entity ID

Setiap IdP dan SP memiliki identifier.

Contoh:

```text
IdP entity ID = https://idp.example.com/saml
SP entity ID  = https://app.example.com/saml/metadata
```

Entity ID bukan harus URL yang bisa dibuka, tetapi biasanya berbentuk URL.

Entity ID dipakai dalam:

- metadata;
- issuer validation;
- audience validation;
- trust configuration.

Kesalahan umum:

```text
Mengubah domain aplikasi lalu lupa update SP entity ID di IdP.
```

Efek:

```text
Login gagal karena audience mismatch.
```

---

## 7. ACS Endpoint

ACS adalah **Assertion Consumer Service**.

Ini endpoint SP yang menerima SAML Response.

Contoh:

```text
https://app.example.com/saml/acs
```

Dalam aplikasi Java/Jakarta, ACS biasanya tidak ditulis manual sebagai servlet biasa jika memakai product/library. ACS di-handle oleh:

- container SAML feature;
- SAML adapter;
- reverse proxy/gateway;
- Spring Security SAML;
- Keycloak adapter/gateway;
- custom Servlet/Jakarta Authentication module.

ACS harus:

1. menerima POST/Redirect sesuai binding;
2. decode SAML Response;
3. validate signature;
4. validate issuer;
5. validate destination/recipient;
6. validate audience;
7. validate time;
8. validate InResponseTo jika SP-initiated;
9. validate replay;
10. establish local session.

ACS bukan endpoint business API.

---

## 8. Metadata

SAML metadata adalah XML yang mendeskripsikan IdP atau SP.

IdP metadata biasanya berisi:

- entity ID;
- SSO endpoint;
- SLO endpoint;
- supported bindings;
- signing certificate;
- encryption certificate;
- NameID formats;
- supported services.

SP metadata biasanya berisi:

- SP entity ID;
- ACS endpoints;
- supported bindings;
- SP certificate untuk signing/encryption;
- requested attributes;
- NameID formats.

Mental model metadata:

```text
Metadata = machine-readable trust configuration.
```

Tetapi metadata sendiri harus diperoleh dari trusted channel.

Jangan asal mengambil metadata URL tanpa validasi provenance.

---

## 9. Certificate dalam SAML

SAML memakai certificate untuk signing dan kadang encryption.

Ada dua konsep besar:

1. **Signing certificate**  
   Untuk memverifikasi bahwa response/assertion benar berasal dari IdP yang dipercaya.

2. **Encryption certificate**  
   Untuk mengenkripsi assertion agar hanya SP yang bisa membaca.

SAML certificate sering self-signed karena trust bukan berdasarkan public CA seperti browser TLS, melainkan berdasarkan metadata exchange.

Jadi validitas certificate dalam SAML biasanya berbasis:

```text
Is this the certificate configured/trusted for this IdP?
```

bukan semata:

```text
Is this certificate chained to a public CA?
```

Namun expiry, rotation, dan key rollover tetap penting.

---

## 10. SP-Initiated Login

SP-initiated login dimulai dari aplikasi.

Flow konseptual:

```text
1. User membuka https://app.example.com/protected
2. SP melihat user belum login
3. SP membuat AuthnRequest
4. Browser diarahkan ke IdP SSO endpoint
5. IdP authenticate user
6. IdP mengirim SAML Response ke SP ACS
7. SP validate response/assertion
8. SP membuat local session
9. User diarahkan ke original URL
```

Diagram:

```text
+---------+             +-------------+             +-----------+
| Browser |             | Jakarta SP  |             | SAML IdP  |
+----+----+             +------+------+             +-----+-----+
     |                         |                          |
     | GET /protected          |                          |
     |------------------------>|                          |
     |                         | build AuthnRequest       |
     | 302 to IdP             |                          |
     |<------------------------|                          |
     | GET IdP SSO + request   |                          |
     |--------------------------------------------------->|
     |                         |                          | authenticate
     |                         |                          | create assertion
     | POST SAMLResponse       |                          |
     |<---------------------------------------------------|
     | POST /saml/acs          |                          |
     |------------------------>| validate                 |
     |                         | create session           |
     | 302 /protected          |                          |
     |<------------------------|                          |
     | GET /protected          |                          |
     |------------------------>|                          |
     | 200                     |                          |
     |<------------------------|                          |
```

Security-critical parts:

- AuthnRequest ID;
- RelayState;
- InResponseTo;
- state correlation;
- ACS validation;
- original URL validation;
- open redirect prevention.

---

## 11. IdP-Initiated Login

IdP-initiated login dimulai dari IdP portal.

Flow:

```text
1. User login ke IdP portal
2. User klik aplikasi
3. IdP mengirim SAML Response langsung ke SP ACS
4. SP validate assertion
5. SP membuat local session
6. User masuk aplikasi
```

Masalah utama:

```text
Tidak selalu ada AuthnRequest dari SP.
```

Akibatnya:

- tidak ada `InResponseTo` yang bisa dicocokkan;
- relay/original URL lebih sulit dikontrol;
- SP harus sangat ketat pada issuer, audience, recipient, destination, signature, time, dan allowed landing page.

IdP-initiated login bukan otomatis insecure, tetapi threat model-nya lebih sulit.

Untuk enterprise:

```text
Prefer SP-initiated jika memungkinkan.
Allow IdP-initiated hanya jika dikontrol ketat dan dibutuhkan oleh enterprise portal.
```

---

## 12. Binding SAML

Binding adalah cara pesan SAML dikirim lewat protokol transport.

### 12.1 HTTP Redirect Binding

Biasanya dipakai untuk AuthnRequest dari SP ke IdP.

Ciri:

- pesan dikompresi;
- base64/url encoded;
- lewat query parameter;
- cocok untuk request kecil.

Contoh konseptual:

```text
GET https://idp.example.com/sso?SAMLRequest=...&RelayState=...
```

### 12.2 HTTP POST Binding

Biasanya dipakai untuk SAML Response dari IdP ke SP.

Ciri:

- browser menerima HTML form auto-submit;
- SAMLResponse ada di form field;
- cocok untuk assertion besar.

Contoh konseptual:

```html
<form method="post" action="https://app.example.com/saml/acs">
  <input type="hidden" name="SAMLResponse" value="..." />
  <input type="hidden" name="RelayState" value="..." />
</form>
```

### 12.3 Artifact Binding

Lebih kompleks.

Browser hanya membawa artifact, lalu SP mengambil assertion langsung dari IdP melalui back-channel.

Keunggulan:

- assertion tidak lewat browser secara penuh;
- bisa lebih aman dalam beberapa skenario.

Trade-off:

- konfigurasi lebih kompleks;
- butuh back-channel connectivity;
- debugging lebih sulit.

---

## 13. RelayState

RelayState adalah parameter untuk membawa state ringan selama flow SAML.

Umumnya dipakai untuk menyimpan:

- original URL;
- state correlation key;
- tenant context;
- selected IdP hint.

RelayState harus diperlakukan seperti input tidak trusted.

Jangan lakukan:

```text
redirect user ke RelayState tanpa validasi
```

Karena bisa menjadi open redirect.

Lebih aman:

```text
RelayState = random state id
server-side session/cache maps state id -> original URL
```

Contoh:

```java
public final class SamlRelayStateRegistry {
    private final Map<String, SavedRequest> saved = new ConcurrentHashMap<>();

    public String create(SavedRequest request) {
        String state = SecureRandomId.newBase64Url(32);
        saved.put(state, request);
        return state;
    }

    public Optional<SavedRequest> consume(String state) {
        return Optional.ofNullable(saved.remove(state));
    }
}
```

Production concern:

- gunakan TTL;
- bind ke session/browser;
- remove setelah dipakai;
- jangan simpan full external URL sembarangan;
- whitelist internal path.

---

## 14. NameID

`NameID` adalah identifier subject di assertion.

NameID memiliki format.

Contoh umum:

```text
urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress
urn:oasis:names:tc:SAML:2.0:nameid-format:persistent
urn:oasis:names:tc:SAML:2.0:nameid-format:transient
urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified
```

### 14.1 Email NameID

Mudah dipahami, tetapi sering tidak stabil.

Risiko:

- email berubah;
- email bisa reused;
- user pindah organisasi;
- case sensitivity;
- alias;
- collision antar IdP.

### 14.2 Persistent NameID

Lebih baik untuk stable federation identifier.

Mental model:

```text
issuer + persistent NameID = federated identity key
```

### 14.3 Transient NameID

Tidak cocok untuk account linking permanen.

Dipakai untuk session sementara.

### 14.4 Recommendation

Untuk aplikasi enterprise:

```text
Jangan hanya pakai NameID mentah sebagai user primary key.
Gunakan issuer + subject identifier + account linking policy.
```

Contoh table:

```sql
CREATE TABLE federated_identity (
    id BIGINT PRIMARY KEY,
    provider_issuer VARCHAR(512) NOT NULL,
    subject_name_id VARCHAR(512) NOT NULL,
    name_id_format VARCHAR(256) NOT NULL,
    local_user_id BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    last_login_at TIMESTAMP,
    UNIQUE (provider_issuer, subject_name_id, name_id_format)
);
```

---

## 15. SAML Attributes

SAML Attribute Statement membawa attribute user.

Contoh attribute:

- email;
- displayName;
- givenName;
- surname;
- employeeId;
- department;
- organization;
- groups;
- role;
- costCenter;
- agencyCode.

Attribute bukan otomatis role aplikasi.

Mapping harus explicit.

Contoh buruk:

```java
if (samlAttributes.get("department").contains("Compliance")) {
    grant("APPROVER");
}
```

Masalah:

- department adalah data HR, bukan security entitlement;
- nama department bisa berubah;
- orang compliance belum tentu approver;
- tidak auditable sebagai authorization policy.

Contoh lebih baik:

```yaml
samlMapping:
  issuer: "https://idp.example.com/saml"
  attributes:
    groups:
      "ACEAS_CASE_OFFICER": "CASE_VIEWER"
      "ACEAS_APPROVER": "CASE_APPROVER"
      "ACEAS_ADMIN": "SYSTEM_ADMIN"
```

Lebih kuat lagi:

```text
SAML group -> application role -> domain permission -> resource/state decision
```

---

## 16. Assertion Validation Pipeline

SP harus melakukan validation pipeline yang ketat.

Pseudo-pipeline:

```text
receive SAML Response
  ↓
decode safely
  ↓
parse XML securely
  ↓
validate schema / structure as appropriate
  ↓
locate signed element safely
  ↓
validate XML signature using trusted IdP cert
  ↓
validate issuer
  ↓
validate destination / recipient
  ↓
validate audience restriction
  ↓
validate time condition with bounded clock skew
  ↓
validate SubjectConfirmation
  ↓
validate InResponseTo if SP-initiated
  ↓
check replay cache
  ↓
extract NameID and attributes only from signed assertion
  ↓
map to local principal/roles
  ↓
create local session
```

Important invariant:

```text
Only extract identity from the signed and validated assertion.
```

---

## 17. Issuer Validation

Issuer menyatakan siapa yang menerbitkan assertion.

Contoh:

```xml
<saml:Issuer>https://idp.example.com/saml</saml:Issuer>
```

SP harus memastikan:

```text
issuer == configured trusted IdP entity ID
```

Jika multi-IdP:

```text
issuer must match one configured IdP tenant/provider
certificate must match issuer
attribute mapping must be issuer-specific
```

Anti-pattern:

```text
Trust any signed assertion if certificate is known globally.
```

Better:

```text
Trust = issuer + certificate + audience + endpoint + mapping profile
```

---

## 18. Audience Validation

Audience membatasi assertion untuk SP tertentu.

Contoh:

```xml
<saml:Audience>https://app.example.com/saml/metadata</saml:Audience>
```

SP harus memvalidasi bahwa audience berisi SP entity ID yang benar.

Failure mode:

```text
Assertion untuk app A diterima oleh app B.
```

Ini bisa terjadi jika audience validation dilemahkan atau SP entity ID antar environment kacau.

Production checklist:

```text
DEV/UAT/PROD harus punya entity ID berbeda.
Jangan reuse PROD assertion di UAT atau sebaliknya.
```

---

## 19. Recipient, Destination, ACS Validation

SAML Response/SubjectConfirmationData biasanya mengandung destination/recipient.

Contoh:

```xml
<saml:SubjectConfirmationData
    Recipient="https://app.example.com/saml/acs"
    NotOnOrAfter="2026-06-17T09:10:00Z" />
```

SP harus memastikan recipient/destination sesuai ACS endpoint yang sedang menerima.

Masalah umum di production:

- aplikasi di belakang reverse proxy;
- internal URL berbeda dari public URL;
- scheme berubah dari HTTPS ke HTTP setelah TLS termination;
- `X-Forwarded-Proto` tidak dipercaya/dikonfigurasi;
- ACS URL di metadata tidak sama dengan request actual;
- domain migration tidak update metadata.

Contoh failure:

```text
Expected recipient: https://app.example.com/saml/acs
Actual request URL seen by app: http://internal-service:8080/saml/acs
Result: recipient validation failed
```

Solusi bukan mematikan validation. Solusi adalah memperbaiki forwarded header/proxy configuration dan canonical external URL.

---

## 20. Time Validation dan Clock Skew

Assertion punya validity window.

Contoh:

```xml
<saml:Conditions NotBefore="2026-06-17T09:00:00Z"
                 NotOnOrAfter="2026-06-17T09:05:00Z" />
```

SP harus memvalidasi:

```text
now >= NotBefore - allowedClockSkew
now < NotOnOrAfter + allowedClockSkew
```

Clock skew diperlukan karena server IdP dan SP bisa beda beberapa detik.

Tetapi jangan terlalu longgar.

Contoh policy:

```yaml
clockSkewSeconds: 120
maxAssertionAgeSeconds: 300
```

Failure mode:

- semua login gagal setelah NTP issue;
- assertion accepted terlalu lama jika skew terlalu besar;
- replay window membesar.

Production invariant:

```text
All IdP/SP nodes must have reliable time synchronization.
```

---

## 21. Replay Protection

SAML bearer assertion bisa direplay jika attacker mendapatkan assertion valid.

SP harus menyimpan assertion ID yang sudah dipakai sampai expiry.

Contoh:

```text
Assertion ID: _abc123
NotOnOrAfter: 09:10:00Z
Replay cache stores _abc123 until 09:10:00Z + skew
```

Jika assertion sama datang lagi:

```text
reject
```

Distributed system concern:

Jika SP berjalan di beberapa node, replay cache harus shared atau setidaknya sticky session + risk accepted.

Better:

- Redis replay cache;
- distributed cache;
- database unique insert;
- short TTL.

Contoh pseudo-code:

```java
public final class SamlReplayGuard {
    private final ReplayCache cache;

    public void assertNotReplayed(String assertionId, Instant expiresAt) {
        boolean inserted = cache.putIfAbsent(assertionId, expiresAt);
        if (!inserted) {
            throw new SamlReplayDetectedException(assertionId);
        }
    }
}
```

---

## 22. XML Signature Wrapping

XML Signature Wrapping adalah class of attack di mana attacker membuat XML dengan elemen signed yang valid, tetapi menambahkan elemen lain yang tidak signed lalu aplikasi membaca elemen yang salah.

Contoh konseptual:

```xml
<Response>
  <Assertion ID="signed-good">
    <!-- signed assertion for victim or benign subject -->
  </Assertion>

  <Assertion ID="attacker-controlled">
    <!-- unsigned assertion read by vulnerable code -->
  </Assertion>

  <Signature>
    <!-- signature references signed-good -->
  </Signature>
</Response>
```

Jika code melakukan:

```java
document.getElementsByTagName("Assertion").item(1)
```

atau mengambil elemen pertama/terakhir tanpa mengikat ke signed reference, identity bisa salah.

OWASP guidance:

- jangan memilih elemen security-sensitive dengan `getElementsByTagName` secara naif;
- gunakan validasi signature library yang hardened;
- pastikan identity diekstrak dari node yang tervalidasi signature;
- gunakan schema hardening/absolute XPath sesuai library.

Rule praktis:

```text
Never parse SAML manually unless you are implementing a security library.
Use mature SAML libraries/container integrations.
```

---

## 23. Secure XML Parsing

SAML berbasis XML. XML parser bisa berbahaya jika tidak dikonfigurasi aman.

Risiko:

- XXE;
- entity expansion;
- external DTD fetch;
- large XML DoS;
- namespace confusion;
- signature canonicalization issue.

Jika harus parse XML, secure defaults harus dipakai.

Contoh defensive parser concept:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
factory.setNamespaceAware(true);
factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
factory.setExpandEntityReferences(false);
```

Tetapi lagi-lagi: untuk SAML, lebih baik memakai library yang memang dirancang untuk SAML.

---

## 24. SAML dan Jakarta Security

Jakarta Security standar modern memiliki built-in support untuk beberapa HTTP authentication mechanism, termasuk OpenID Connect di Jakarta Security 3.0+ dan enhancement di 4.0. Tetapi **SAML bukan built-in core mechanism Jakarta Security standar** seperti OIDC.

Artinya, integrasi SAML di aplikasi Jakarta biasanya dilakukan melalui salah satu pendekatan:

1. container/vendor SAML feature;
2. reverse proxy / gateway SAML SP;
3. application library;
4. Spring Security SAML jika aplikasi Spring;
5. Keycloak sebagai broker/bridge;
6. custom Jakarta Authentication module;
7. custom Jakarta Security `HttpAuthenticationMechanism` yang membungkus library SAML.

Mental model:

```text
SAML handles federation login.
Jakarta container still needs an authenticated caller principal and groups/roles.
```

Yang harus diselesaikan:

```text
SAML assertion -> local principal -> Jakarta caller -> groups/roles -> authorization
```

---

## 25. Integration Option 1: Container / App Server SAML Feature

Beberapa app server memiliki fitur SAML SP.

Contoh pola:

```text
App server handles SAML ACS and validation.
App receives authenticated Principal via container.
Application uses HttpServletRequest.getUserPrincipal() or SecurityContext.
```

Keunggulan:

- integrasi dengan container security;
- principal/role bisa tersedia ke Servlet/JAX-RS/EJB/CDI;
- app code lebih bersih;
- konfigurasi security lebih operasional.

Kekurangan:

- vendor-specific;
- konfigurasi berbeda antar server;
- portability rendah;
- debugging butuh pengetahuan app server;
- upgrade app server bisa memengaruhi security behavior.

Cocok ketika:

- organisasi sudah standardisasi app server;
- IAM team support container SAML;
- aplikasi Jakarta EE tradisional;
- butuh container-managed role enforcement.

---

## 26. Integration Option 2: Reverse Proxy / Gateway SAML SP

Pada pola ini, SAML diproses oleh gateway/proxy, bukan aplikasi.

```text
Browser -> Gateway SAML SP -> Jakarta Application
```

Gateway melakukan:

- SAML login;
- assertion validation;
- session at gateway;
- inject identity headers ke upstream app.

Contoh headers:

```http
X-Authenticated-User: fajar@example.com
X-User-Groups: ACEAS_APPROVER,ACEAS_CASE_OFFICER
X-Auth-Issuer: https://idp.example.com/saml
```

Keunggulan:

- aplikasi tidak perlu SAML library;
- centralized SSO;
- cocok untuk banyak aplikasi legacy;
- migration lebih mudah.

Risiko besar:

```text
Header spoofing.
```

Jika aplikasi bisa diakses langsung tanpa gateway, attacker bisa mengirim header sendiri.

Wajib:

- aplikasi hanya reachable dari gateway;
- strip identity headers dari external request;
- mTLS gateway→app;
- network policy/security group;
- app validates trusted gateway marker;
- signed internal token lebih baik daripada raw header;
- audit gateway identity.

Better pattern:

```text
Gateway validates SAML.
Gateway issues short-lived internal JWT with issuer=gateway.
Jakarta app validates internal JWT.
```

---

## 27. Integration Option 3: Application Library

Aplikasi Java sendiri memakai SAML library.

Contoh pilihan umum:

- OpenSAML;
- pac4j;
- Spring Security SAML;
- vendor SDK;
- framework-specific adapter.

Keunggulan:

- kontrol penuh;
- portable across server;
- bisa embedded di Spring Boot/Jakarta runtime;
- cocok untuk custom mapping.

Kekurangan:

- developer memikul beban security validation;
- salah konfigurasi fatal;
- XML signature handling kompleks;
- upgrade library harus disiplin;
- integration ke container principal/roles tidak otomatis.

Jika memakai library di Jakarta app, pastikan hasil akhirnya tetap mengisi security context/container jika ingin memakai `@RolesAllowed`, `isUserInRole`, atau Jakarta Security `SecurityContext`.

---

## 28. Integration Option 4: SAML to OIDC Bridge

Banyak organisasi modern memakai bridge:

```text
Enterprise SAML IdP -> Broker -> OIDC Client Application
```

Contoh broker:

- Keycloak;
- IAM gateway;
- cloud identity broker;
- custom identity platform.

Flow:

```text
Jakarta app speaks OIDC.
Broker speaks SAML to enterprise IdP.
Broker maps SAML attributes to OIDC claims.
Jakarta Security OIDC mechanism handles app login.
```

Keunggulan:

- aplikasi cukup pakai OIDC;
- SAML complexity dipusatkan di broker;
- modern token/session handling;
- lebih cocok untuk microservices/API;
- easier migration path.

Risiko:

- mapping terjadi di broker, bisa hilang makna;
- issuer berubah dari enterprise IdP ke broker;
- account linking harus jelas;
- role/group transformation harus diaudit;
- logout makin kompleks.

Mental model:

```text
SAML IdP asserts identity to broker.
Broker asserts identity to application via OIDC.
Application trusts broker, not directly original SAML IdP.
```

Audit perlu menyimpan original issuer jika penting:

```json
{
  "iss": "https://broker.example.com/realms/enterprise",
  "sub": "local-broker-subject",
  "original_idp": "https://corporate-idp.example.com/saml",
  "original_subject": "abc-persistent-id"
}
```

---

## 29. Mapping SAML to Jakarta Caller Principal

Setelah assertion valid, aplikasi/container perlu menentukan caller principal.

Pilihan principal:

1. `NameID`;
2. email attribute;
3. employee ID;
4. local username;
5. local user ID;
6. federated composite key.

Best practice:

```text
Use stable local principal for application runtime.
Store federated identity mapping separately.
```

Contoh:

```java
public record FederatedCaller(
    String localUserId,
    String username,
    String displayName,
    String providerIssuer,
    String providerSubject,
    Set<String> externalGroups,
    Set<String> applicationRoles
) {}
```

Container principal bisa memakai username/local user ID:

```java
public final class ApplicationPrincipal implements Principal {
    private final String name;

    public ApplicationPrincipal(String name) {
        this.name = Objects.requireNonNull(name);
    }

    @Override
    public String getName() {
        return name;
    }
}
```

Jangan jadikan email sebagai satu-satunya primary key kecuali organisasi menjamin email immutable dan non-reusable.

---

## 30. Mapping SAML Groups to Roles

SAML attribute sering membawa groups.

Contoh:

```text
SAML groups:
- CN=ACEAS-Approver,OU=Groups,DC=corp,DC=example,DC=com
- CN=ACEAS-CaseOfficer,OU=Groups,DC=corp,DC=example,DC=com
```

Aplikasi tidak seharusnya menyebarkan raw DN ke business code.

Mapping:

```yaml
groupMappings:
  "CN=ACEAS-Approver,OU=Groups,DC=corp,DC=example,DC=com":
    roles:
      - CASE_APPROVER
  "CN=ACEAS-CaseOfficer,OU=Groups,DC=corp,DC=example,DC=com":
    roles:
      - CASE_OFFICER
```

Kemudian role dipakai untuk coarse-grained access:

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(...) {
    ...
}
```

Tetapi domain authorization tetap diperlukan:

```java
authorization.assertAllowed(actor, APPROVE_CASE, caseId);
```

Karena `CASE_APPROVER` belum menjawab:

- case tenant mana;
- state case apa;
- assigned to siapa;
- apakah maker-checker conflict;
- apakah user sedang delegated;
- apakah approval window masih valid.

---

## 31. Attribute Freshness

SAML assertion adalah snapshot saat login.

Jika group user berubah setelah login, aplikasi mungkin tidak tahu sampai session baru.

Masalah:

```text
User removed from admin group at 10:00.
User still has SP session until 18:00.
Application still sees admin role.
```

Mitigasi:

1. session timeout pendek;
2. re-auth for sensitive actions;
3. authorization checks call local entitlement service;
4. back-channel provisioning/deprovisioning;
5. SCIM/user sync;
6. role cache TTL;
7. session revocation integration;
8. admin role requires fresh check.

Design rule:

```text
SAML login establishes identity.
High-risk authorization should not depend solely on stale login-time attributes.
```

---

## 32. Local Session Setelah SAML Login

Setelah SAML berhasil, SP biasanya membuat local session.

SAML assertion tidak dipakai untuk setiap request.

Flow:

```text
SAML assertion accepted once
  ↓
local HttpSession created
  ↓
session cookie sent to browser
  ↓
subsequent requests use session cookie
```

Karena itu session security dari Part 15 tetap berlaku:

- Secure;
- HttpOnly;
- SameSite;
- idle timeout;
- absolute timeout;
- session fixation protection;
- logout invalidation;
- clustered session;
- role freshness.

Important invariant:

```text
SAML is authentication event.
HttpSession is application login state.
```

---

## 33. Single Logout / SLO

SAML mendukung Single Logout, tetapi implementasinya sering sulit.

Ada beberapa masalah:

- semua SP harus mendukung SLO;
- browser bisa ditutup sebelum logout chain selesai;
- back-channel/logout endpoint connectivity;
- session index tracking;
- partial logout;
- IdP-initiated logout;
- race condition;
- UX tidak konsisten.

Practical enterprise stance:

```text
Implement local logout reliably.
Support IdP logout if required.
Do not assume global logout is perfect.
Design session timeout and reauthentication accordingly.
```

Logout layers:

```text
Application local session
Gateway session
SAML IdP session
Corporate desktop/browser SSO session
```

Logout dari aplikasi belum tentu logout dari IdP.

---

## 34. Account Linking

Saat SAML assertion diterima, aplikasi perlu menentukan local account.

Strategi:

### 34.1 Just-in-Time Provisioning

Jika user belum ada, buat local account saat login.

Pros:

- onboarding mudah;
- cocok untuk enterprise SSO.

Cons:

- attribute harus dipercaya;
- deprovisioning harus diselesaikan;
- role assignment risk;
- duplicate account risk.

### 34.2 Pre-Provisioned Account

User harus sudah ada di aplikasi.

Pros:

- controlled;
- cocok untuk regulated app;
- approval workflow bisa dilakukan sebelum akses.

Cons:

- admin overhead;
- sync issue.

### 34.3 Hybrid

JIT untuk profile basic, tetapi role/permission harus pre-approved.

Biasanya paling aman:

```text
First login creates disabled/basic account.
Admin/entitlement process grants app role.
```

---

## 35. Account Linking Key

Jangan hanya pakai email.

Better:

```text
provider_issuer + name_id_format + name_id_value
```

Atau jika IdP menyediakan immutable employee ID:

```text
provider_issuer + employee_id
```

Tetapi harus jelas:

- apakah employee ID immutable?
- apakah employee ID reused?
- apakah contractor/vendor punya namespace berbeda?
- apakah multi-tenant collision mungkin?

Contoh robust identity key:

```java
public record FederatedIdentityKey(
    String providerIssuer,
    String subjectFormat,
    String subjectValue
) {}
```

---

## 36. Multi-IdP SAML

Enterprise app bisa menerima beberapa IdP:

```text
Agency A IdP
Agency B IdP
Vendor IdP
Internal Admin IdP
```

Masalah:

- issuer berbeda;
- certificate berbeda;
- attribute names berbeda;
- NameID format berbeda;
- groups berbeda;
- assurance level berbeda;
- logout berbeda;
- tenant mapping berbeda.

Jangan buat mapping global seperti:

```text
Group "Admin" -> SYSTEM_ADMIN
```

Harus issuer-aware:

```yaml
providers:
  "https://agency-a.example.gov/saml":
    groupsAttribute: "groups"
    mappings:
      "ACEAS_ADMIN": "AGENCY_A_ADMIN"

  "https://vendor.example.com/saml":
    groupsAttribute: "memberOf"
    mappings:
      "VendorSupport": "SUPPORT_READONLY"
```

Identity key juga issuer-aware.

---

## 37. Tenant Resolution with SAML

Dalam sistem multi-tenant, SAML bisa membawa tenant/organization attribute.

Contoh:

```text
agencyCode = CEA
organizationId = ORG-123
```

Pertanyaan penting:

1. Apakah tenant berasal dari IdP?
2. Apakah tenant berasal dari URL/subdomain?
3. Apakah user bisa memiliki banyak tenant?
4. Apakah user memilih active tenant setelah login?
5. Apakah role scoped per tenant?
6. Apakah IdP attribute cukup authoritative?

Model lebih aman:

```text
SAML proves user identity.
Application resolves allowed tenant memberships from local entitlement store.
```

Atau:

```text
SAML provides external organization claim.
Application validates it against known tenant mapping.
```

Jangan langsung percaya tenant input tanpa cross-check.

---

## 38. SAML Behind Reverse Proxy

Banyak SAML issue di Java/Jakarta bukan karena SAML-nya, tetapi karena aplikasi berada di balik proxy.

Contoh deployment:

```text
Browser -> ALB/nginx/Traefik -> Jakarta app
```

Public URL:

```text
https://app.example.com/saml/acs
```

Internal URL:

```text
http://aceas-service.default.svc.cluster.local:8080/saml/acs
```

Jika app/library membangun SP metadata dari internal URL, IdP akan mengirim assertion ke URL salah atau validation gagal.

Checklist:

- configure external base URL;
- configure forwarded headers;
- enforce HTTPS external URL;
- ensure ACS in metadata matches IdP config;
- ensure `X-Forwarded-Proto` only trusted from proxy;
- do not derive security-critical URLs from arbitrary Host header;
- lock allowed host names.

Host header injection risk:

```text
Attacker sends Host: evil.example.com
Application generates ACS URL using Host header
IdP metadata/AuthnRequest uses attacker-controlled URL
```

Mitigation:

```text
Use configured canonical external URL, not raw request host.
```

---

## 39. SAML in Servlet/Jakarta Application

At Servlet level, SAML integration usually ends in one of these states:

### 39.1 Container Principal Established

Best for Jakarta EE:

```java
Principal principal = request.getUserPrincipal();
boolean allowed = request.isUserInRole("CASE_APPROVER");
```

`SecurityContext` also works:

```java
@Inject
SecurityContext securityContext;

public String currentUser() {
    return securityContext.getCallerPrincipal().getName();
}
```

### 39.2 App Session Attribute Only

Less integrated:

```java
session.setAttribute("user", federatedUser);
```

Problem:

- `@RolesAllowed` may not work;
- JAX-RS security context may not know user;
- EJB/CDI method security may not see roles;
- code becomes inconsistent.

### 39.3 Gateway Header Only

Works if carefully designed.

But must convert to local security context or central actor model.

---

## 40. Jakarta Authentication Custom SAM Conceptual Flow

If implementing SAML via Jakarta Authentication/JASPIC, the module must eventually call container callbacks.

Conceptually:

```java
public AuthStatus validateRequest(
        MessageInfo messageInfo,
        Subject clientSubject,
        Subject serviceSubject) throws AuthException {

    HttpServletRequest request = (HttpServletRequest) messageInfo.getRequestMessage();
    HttpServletResponse response = (HttpServletResponse) messageInfo.getResponseMessage();

    if (isAcsPost(request)) {
        SamlAssertion assertion = samlValidator.validate(request);
        FederatedCaller caller = accountService.resolve(assertion);

        callbackHandler.handle(new Callback[] {
            new CallerPrincipalCallback(clientSubject, caller.username()),
            new GroupPrincipalCallback(clientSubject, caller.applicationRoles().toArray(String[]::new))
        });

        createLocalSession(request, caller);
        redirectToSavedRequest(response);
        return AuthStatus.SEND_CONTINUE;
    }

    if (isProtectedResource(request) && !isLoggedIn(request)) {
        redirectToIdp(response, buildAuthnRequest(request));
        return AuthStatus.SEND_CONTINUE;
    }

    return AuthStatus.SUCCESS;
}
```

This is conceptual. Real implementation should use a mature SAML library and container-specific registration.

---

## 41. Custom `HttpAuthenticationMechanism` Conceptual Flow

Jakarta Security approach:

```java
@ApplicationScoped
public class SamlHttpAuthenticationMechanism implements HttpAuthenticationMechanism {

    @Inject
    private IdentityStoreHandler identityStoreHandler;

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) throws AuthenticationException {

        if (isAcsPost(request)) {
            SamlCredential credential = extractAndValidateSaml(request);
            CredentialValidationResult result = identityStoreHandler.validate(credential);

            if (result.getStatus() == CredentialValidationResult.Status.VALID) {
                return context.notifyContainerAboutLogin(
                    result.getCallerPrincipal(),
                    result.getCallerGroups()
                );
            }

            return context.responseUnauthorized();
        }

        if (context.isProtected()) {
            redirectToIdp(response, request);
            return AuthenticationStatus.SEND_CONTINUE;
        }

        return AuthenticationStatus.NOT_DONE;
    }
}
```

This design has two nice boundaries:

```text
Mechanism = protocol interaction
IdentityStore = credential/user/group resolution
```

But SAML validation itself remains complex.

---

## 42. SAML Credential Abstraction

You can model a validated SAML assertion as credential passed to identity layer.

```java
public final class SamlCredential implements Credential {
    private final String issuer;
    private final String nameId;
    private final String nameIdFormat;
    private final Map<String, List<String>> attributes;
    private final Instant authnInstant;
    private final String assertionId;

    // constructor/getters
}
```

Then identity store resolves it:

```java
@ApplicationScoped
public class SamlIdentityStore implements IdentityStore {

    @Override
    public CredentialValidationResult validate(Credential credential) {
        if (!(credential instanceof SamlCredential saml)) {
            return CredentialValidationResult.NOT_VALIDATED_RESULT;
        }

        LocalUser user = accountLinkingService.findOrProvision(saml);
        Set<String> roles = roleMappingService.map(saml.issuer(), saml.attributes(), user);

        return new CredentialValidationResult(
            new CallerPrincipal(user.username()),
            roles
        );
    }
}
```

Important:

```text
IdentityStore should not validate XML signature if the mechanism already does.
Keep validation responsibility clear.
```

---

## 43. SAML and JAX-RS

If SAML creates container session, JAX-RS can use existing security context.

Example:

```java
@Path("/cases")
public class CaseResource {

    @Context
    jakarta.ws.rs.core.SecurityContext jaxrsSecurity;

    @GET
    @RolesAllowed("CASE_VIEWER")
    public List<CaseDto> list() {
        String username = jaxrsSecurity.getUserPrincipal().getName();
        return service.listCases(username);
    }
}
```

But remember:

```text
JAX-RS SecurityContext and Jakarta Security SecurityContext are related but not identical APIs.
```

In a well-integrated container, both see the caller.

If using custom app-session only, annotations may not work.

---

## 44. SAML and SPA

SAML is browser SSO, but a pure SPA cannot safely validate SAML itself.

Bad pattern:

```text
IdP posts SAMLResponse to browser JavaScript
SPA parses assertion
SPA stores identity in localStorage
```

Very bad.

Better patterns:

### 44.1 Backend for Frontend

```text
SPA -> Jakarta BFF
Jakarta BFF -> SAML SP login
BFF creates HttpOnly session cookie
SPA calls BFF APIs with cookie
```

### 44.2 SAML to OIDC Broker

```text
SPA uses OIDC authorization code + PKCE with broker
Broker federates to SAML IdP
Backend validates access token
```

For modern SPA, OIDC is usually better than direct SAML.

---

## 45. SAML vs OIDC

| Aspect | SAML | OIDC |
|---|---|---|
| Era | Older enterprise federation | Modern web/mobile/API identity |
| Format | XML | JSON/JWT |
| Main use | Browser SSO enterprise | Browser/mobile/API identity |
| Token | Assertion | ID token/access token |
| Discovery | Metadata XML | `.well-known/openid-configuration` |
| Signature | XML Signature | JWS/JWT signature |
| API authorization | Not ideal | Natural with OAuth2 access token |
| Java/Jakarta support | Often vendor/library/gateway | Built into Jakarta Security OIDC mechanism |
| Legacy enterprise | Very common | Increasingly common |
| Failure style | XML/signature/metadata/binding | token/audience/issuer/nonce/redirect |

Migration direction usually:

```text
SAML for enterprise login -> OIDC at app boundary -> OAuth2 access tokens for APIs
```

---

## 46. SAML Security Checklist

Minimum production checklist:

```text
[ ] Require HTTPS for all SAML endpoints.
[ ] Use trusted IdP metadata/certificate.
[ ] Validate response/assertion signature.
[ ] Extract identity only from signed assertion.
[ ] Validate issuer.
[ ] Validate audience.
[ ] Validate recipient/destination.
[ ] Validate NotBefore/NotOnOrAfter.
[ ] Validate SubjectConfirmation.
[ ] Validate InResponseTo for SP-initiated flow.
[ ] Implement replay protection using assertion ID.
[ ] Use secure XML parser/library.
[ ] Protect against XML Signature Wrapping.
[ ] Validate RelayState and prevent open redirect.
[ ] Use canonical external URL behind proxy.
[ ] Separate DEV/UAT/PROD entity IDs/certs.
[ ] Plan IdP certificate rotation.
[ ] Use stable account linking key.
[ ] Map attributes/groups explicitly.
[ ] Do not trust raw gateway headers unless network boundary is enforced.
[ ] Log audit events without logging full assertion.
[ ] Use local session hardening.
```

---

## 47. Logging and Audit

Do not log full SAML Response.

It may contain:

- PII;
- email;
- employee ID;
- group memberships;
- assertion usable for replay during validity window;
- authentication context.

Safe audit event:

```json
{
  "eventType": "SAML_LOGIN_SUCCESS",
  "correlationId": "req-123",
  "providerIssuer": "https://idp.example.com/saml",
  "spEntityId": "https://app.example.com/saml/metadata",
  "subjectHash": "sha256:...",
  "nameIdFormat": "persistent",
  "localUserId": "u-10092",
  "mappedRoles": ["CASE_VIEWER", "CASE_APPROVER"],
  "authnInstant": "2026-06-17T09:00:01Z",
  "assertionIdHash": "sha256:...",
  "result": "SUCCESS"
}
```

Failed event:

```json
{
  "eventType": "SAML_LOGIN_FAILURE",
  "correlationId": "req-124",
  "providerIssuer": "https://idp.example.com/saml",
  "reasonCode": "AUDIENCE_MISMATCH",
  "spEntityId": "https://app.example.com/saml/metadata",
  "clientIp": "203.0.113.10",
  "result": "FAILURE"
}
```

Do not expose detailed validation failure to end-user.

End-user:

```text
Login failed. Please contact support with reference ID ABC123.
```

Ops log:

```text
SAML audience mismatch. Expected https://app.example.com/saml/metadata, got https://old-app.example.com/saml/metadata.
```

---

## 48. Common Production Failures

### 48.1 Audience Mismatch

Cause:

- SP entity ID changed;
- IdP config stale;
- environment copied incorrectly.

Symptom:

```text
SAML assertion rejected: audience restriction failed.
```

Fix:

- update IdP app config;
- regenerate SP metadata;
- separate env metadata.

---

### 48.2 Certificate Rotation Outage

Cause:

- IdP rotates signing certificate;
- SP still trusts old cert only.

Symptom:

```text
Signature validation failed for all users.
```

Fix:

- support certificate rollover window;
- monitor metadata expiry;
- keep old+new cert during transition;
- run pre-prod validation.

---

### 48.3 Clock Skew Login Failure

Cause:

- NTP broken;
- IdP/SP time drift;
- assertion `NotBefore` appears in future.

Symptom:

```text
Assertion not yet valid or expired.
```

Fix:

- restore time sync;
- bounded skew;
- monitor host clock.

---

### 48.4 ACS URL Wrong Behind Proxy

Cause:

- app sees internal URL;
- metadata uses wrong scheme/host;
- forwarded headers misconfigured.

Symptom:

```text
Recipient/Destination mismatch.
```

Fix:

- configure external base URL;
- fix reverse proxy headers;
- do not disable recipient validation.

---

### 48.5 User Can Login But Has No Role

Cause:

- group attribute name changed;
- IdP sends group DN but app expects short name;
- mapping case-sensitive;
- role mapping not issuer-specific.

Symptom:

```text
Login succeeds, then 403 everywhere.
```

Fix:

- inspect attribute release;
- update mapping;
- add audit for unmapped groups;
- create entitlement mapping tests.

---

### 48.6 Duplicate Accounts

Cause:

- account linked by email;
- email changed;
- NameID changed after IdP migration;
- multiple IdPs send same email.

Symptom:

```text
User loses data or gets new empty profile.
```

Fix:

- use federated identity table;
- migration mapping plan;
- manual account merge workflow;
- immutable subject identifier.

---

### 48.7 Replay Cache Missing

Cause:

- app accepts same assertion multiple times;
- no distributed replay cache.

Symptom:

```text
Captured assertion can be reused within validity window.
```

Fix:

- assertion ID cache;
- short assertion validity;
- TLS everywhere;
- do not log assertion.

---

## 49. SAML Threat Model

### Assets

- user identity;
- assertion;
- session cookie;
- signing certificate;
- mapping config;
- local account link;
- audit trail.

### Attackers

- external attacker;
- malicious user;
- compromised browser;
- misconfigured proxy;
- rogue IdP in multi-IdP setup;
- insider changing mapping;
- attacker with logged assertion;
- attacker exploiting XML parser.

### Main threats

```text
Authentication bypass
Assertion replay
XML Signature Wrapping
Wrong audience acceptance
Wrong issuer acceptance
Header spoofing
Open redirect via RelayState
Account takeover via email reuse
Privilege escalation via group mapping
Stale authorization after deprovisioning
Certificate rotation outage
```

### Invariants

```text
Identity must come from validated signed assertion.
Assertion must be intended for this SP.
Assertion must be fresh and not replayed.
Issuer must be trusted and mapped explicitly.
Subject must be linked to correct local account.
External attributes must be mapped through controlled policy.
Local session must be hardened.
Authorization must be enforced in application/domain layer.
```

---

## 50. Designing a SAML Integration for Jakarta Enterprise App

Reference architecture:

```text
+---------+      +----------------+      +--------------------+
| Browser | ---> | Reverse Proxy  | ---> | Jakarta Application |
+---------+      +----------------+      +--------------------+
      |                                           |
      |                                           | SAML SP module/library
      |                                           |
      v                                           v
+----------------+                         +--------------------+
| Enterprise IdP |                         | Local User Store    |
+----------------+                         +--------------------+
                                                |
                                                v
                                          +--------------------+
                                          | Role Mapping Store  |
                                          +--------------------+
                                                |
                                                v
                                          +--------------------+
                                          | Domain Authz Engine |
                                          +--------------------+
                                                |
                                                v
                                          +--------------------+
                                          | Audit Trail         |
                                          +--------------------+
```

Request lifecycle:

```text
1. User accesses protected resource.
2. App triggers SAML SP-initiated login.
3. IdP authenticates user.
4. App receives SAML Response at ACS.
5. App validates cryptographic and contextual constraints.
6. App resolves federated identity to local user.
7. App maps external groups to internal roles.
8. App creates hardened local session.
9. App enforces URL/method/domain authorization.
10. App writes authentication and mapping audit events.
```

---

## 51. Data Model for Federated SAML Identity

Example schema:

```sql
CREATE TABLE identity_provider (
    id BIGINT PRIMARY KEY,
    issuer VARCHAR(512) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL,
    metadata_url VARCHAR(1024),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE federated_identity (
    id BIGINT PRIMARY KEY,
    identity_provider_id BIGINT NOT NULL,
    subject_value VARCHAR(512) NOT NULL,
    subject_format VARCHAR(256) NOT NULL,
    local_user_id BIGINT NOT NULL,
    first_seen_at TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMP,
    status VARCHAR(32) NOT NULL,
    UNIQUE (identity_provider_id, subject_value, subject_format)
);

CREATE TABLE external_group_mapping (
    id BIGINT PRIMARY KEY,
    identity_provider_id BIGINT NOT NULL,
    external_group_value VARCHAR(1024) NOT NULL,
    application_role VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    UNIQUE (identity_provider_id, external_group_value, application_role)
);
```

Why this matters:

- issuer-aware identity;
- stable account linking;
- auditable group mapping;
- controlled deactivation;
- easier IdP migration.

---

## 52. IdP Migration

SAML IdP migration is dangerous because subject identifiers can change.

Migration plan:

1. inventory existing federated identities;
2. identify current issuer and NameID format;
3. obtain new IdP subject mapping;
4. run dry-run matching;
5. preserve local user ID;
6. support dual IdP temporarily;
7. log first login under new IdP;
8. detect duplicate account risk;
9. migrate group mappings;
10. test logout/session;
11. communicate user impact;
12. keep rollback path.

Never assume:

```text
same email = same person
```

Better:

```text
old issuer + old subject -> local user
new issuer + new subject -> same local user
```

via approved migration mapping.

---

## 53. SAML to OIDC Migration Strategy

A practical migration path:

### Phase 1 — Existing SAML

```text
Enterprise IdP -> Jakarta app as SAML SP
```

### Phase 2 — Introduce Broker

```text
Enterprise IdP -> Broker via SAML
Broker -> Jakarta app via OIDC
```

### Phase 3 — Standardize Apps on OIDC

```text
Apps use OIDC only.
Broker handles legacy SAML federation.
```

### Phase 4 — Optional IdP Modernization

```text
Enterprise IdP supports OIDC directly.
Broker may remain for policy/mapping.
```

Benefits:

- applications simplify;
- SAML complexity centralized;
- API security becomes OAuth2/OIDC-native;
- role mapping centralized;
- easier for SPA/mobile.

Risks:

- broker becomes critical dependency;
- mapping bugs affect many apps;
- original identity context can be lost;
- logout gets multi-hop.

Mitigation:

- include original IdP info in claims/audit;
- test account linking;
- define mapping ownership;
- treat broker config as security-critical code.

---

## 54. Java 8–25 Considerations

SAML itself is not dependent on Java language version, but runtime matters.

### Java 8

- common in legacy enterprise;
- older XML/security libraries;
- old TLS defaults possible;
- javax namespace common;
- old app servers common.

### Java 11/17

- stronger baseline;
- many Jakarta runtimes support;
- better TLS defaults;
- library updates easier.

### Java 21+

- virtual threads can affect context propagation if custom code assumes thread-local behavior;
- use container-managed context where possible;
- avoid manual thread-local security context for SAML session.

### Java 25

- no special SAML semantic change;
- keep dependency compatibility verified;
- app server support matrix matters more than language feature.

Important:

```text
SAML compatibility is mostly app server/library/protocol/configuration issue, not Java syntax issue.
```

---

## 55. `javax` vs `jakarta`

Older Java EE apps use:

```java
javax.servlet.http.HttpServletRequest
javax.annotation.security.RolesAllowed
```

Modern Jakarta apps use:

```java
jakarta.servlet.http.HttpServletRequest
jakarta.annotation.security.RolesAllowed
```

SAML libraries/frameworks may have versions for either ecosystem.

Migration concern:

- Servlet API namespace;
- filter types;
- security annotations;
- app server version;
- Spring Security version;
- library compatibility;
- transitive dependencies.

Do not mix randomly:

```text
A library compiled for javax.servlet.Filter may not work directly in a jakarta.servlet.Filter container.
```

Migration checklist:

```text
[ ] Choose app runtime: Java EE/javax or Jakarta/jakarta.
[ ] Choose SAML library compatible with runtime.
[ ] Update filters/servlets/listeners namespace.
[ ] Update annotations.
[ ] Re-test container principal propagation.
[ ] Re-test ACS endpoint.
[ ] Re-test session cookie.
[ ] Re-test role checks.
```

---

## 56. Testing SAML Integration

### 56.1 Unit Tests

Test:

- attribute mapping;
- account linking;
- role mapping;
- RelayState validation;
- tenant resolution;
- failure reason mapping.

### 56.2 Integration Tests

Test with mock IdP or test IdP:

- valid login;
- invalid signature;
- expired assertion;
- wrong audience;
- wrong recipient;
- missing attribute;
- unknown user;
- group removed;
- replayed assertion;
- malformed XML;
- IdP-initiated flow if supported.

### 56.3 Environment Tests

Test per DEV/UAT/PROD:

- metadata exchange;
- certificate expiry;
- ACS public URL;
- proxy headers;
- clock sync;
- session timeout;
- logout;
- role mapping.

Example test matrix:

| Scenario | Expected |
|---|---|
| Valid SAML response | Session created |
| Wrong issuer | Reject login |
| Wrong audience | Reject login |
| Expired assertion | Reject login |
| Future NotBefore beyond skew | Reject login |
| Replayed assertion ID | Reject login |
| Missing required email | Reject or provision with policy |
| Unknown group | Login maybe allowed, role not granted, audit warning |
| RelayState external URL | Reject redirect |
| Direct app access with spoofed identity header | Reject |

---

## 57. Observability and Runbook

SAML runbook should answer quickly:

1. Which IdP?
2. Which SP entity ID?
3. Which ACS URL?
4. Which certificate fingerprint?
5. Which assertion ID?
6. Which audience was received?
7. Which issuer was received?
8. Was signature valid?
9. Was assertion expired?
10. Was InResponseTo matched?
11. Which local user was linked?
12. Which external groups were received?
13. Which roles were mapped?
14. Which session ID was created?
15. Which correlation ID ties browser, app, and IdP logs?

Log structured events, not raw XML.

Useful metrics:

```text
saml.login.success.count
saml.login.failure.count
saml.login.failure.by_reason
saml.signature.validation.failure.count
saml.audience.mismatch.count
saml.clock_skew.failure.count
saml.replay.detected.count
saml.unknown_group.count
saml.account_link.created.count
saml.certificate.days_until_expiry
```

Alert on:

- sudden spike in signature failures;
- certificate nearing expiry;
- all login failures;
- replay detected;
- unknown issuer;
- audience mismatch spike after deployment/domain migration.

---

## 58. Design Heuristics

Use SAML directly when:

- enterprise IdP only supports SAML;
- app is classic web app;
- container/gateway SAML support exists;
- browser SSO is primary;
- API/mobile is not the main integration.

Prefer SAML→OIDC bridge when:

- many apps need federation;
- app stack is mixed;
- SPA/mobile/API exists;
- you need OAuth2 access tokens;
- you want Jakarta Security OIDC support;
- migration away from legacy federation is planned.

Avoid custom SAML implementation when:

- no SAML expertise;
- no strong test suite;
- no security review;
- no library maintenance plan;
- app team plans to parse XML manually.

Best enterprise posture:

```text
Centralize SAML complexity.
Normalize identity into stable internal contract.
Keep authorization domain-owned and auditable.
```

---

## 59. Top 1% Engineer Mental Model

A surface-level engineer says:

```text
SAML is login with XML.
```

A stronger engineer says:

```text
SAML is signed assertion-based federation between IdP and SP.
```

A top-tier engineer thinks:

```text
SAML is a trust contract where an external authority asserts authentication facts and attributes about a subject. The application must validate cryptographic proof, contextual constraints, freshness, replay, issuer, audience, and endpoint binding before translating the external identity into a stable local actor. Authorization must remain domain-owned, issuer-aware, tenant-aware, auditable, and resilient to stale attributes and operational failures.
```

That is the level this series targets.

---

## 60. Summary

SAML remains important because enterprise identity changes slowly. Jakarta applications often meet SAML through app server features, gateways, brokers, or libraries. The main engineering challenge is not “how to receive XML”, but how to preserve security meaning across boundaries:

```text
IdP authentication event
  -> signed assertion
  -> strict SP validation
  -> stable local account
  -> mapped application roles
  -> domain authorization
  -> hardened session
  -> audit trail
```

The most dangerous mistakes are:

- manual insecure XML parsing;
- weak signature validation;
- accepting wrong audience/issuer;
- no replay protection;
- trusting raw headers;
- using email as permanent key;
- treating external group as domain permission;
- relying on stale login-time attributes for high-risk authorization;
- disabling validation to fix proxy/domain issues.

SAML is old, but not simple. In enterprise systems, it is often a critical boundary between organizational identity and application authority.

---

## 61. What Comes Next

Next part:

```text
Part 20 — mTLS, Client Certificates, and Strong Caller Authentication
```

Part 20 will discuss strong caller authentication via TLS client certificates, certificate chains, truststore/keystore, subject/SAN mapping, reverse proxy termination, service-to-service identity, certificate rotation, and operational failure modelling.

