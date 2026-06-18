# learn-java-json-xml-soap-connectors-enterprise-integration — Part 29
# SOAP Security in Practice

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Part: 29 dari 34  
> Topik: TLS vs message security, WS-Security, XML Signature, XML Encryption, replay protection, keystore/truststore, canonicalization, dan failure model SOAP security di production  
> Target Java: Java 8 sampai Java 25  
> Target namespace: `javax.*` legacy dan `jakarta.*` modern

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas WS-* sebagai peta interoperabilitas. Bagian ini turun ke level yang lebih operasional: bagaimana mengamankan SOAP service/client secara benar di sistem Java enterprise.

Setelah menyelesaikan bagian ini, kamu diharapkan bisa:

1. membedakan **transport security** dan **message security** secara presisi;
2. memahami kapan cukup memakai TLS dan kapan perlu WS-Security;
3. memahami struktur `wsse:Security` header;
4. memahami `UsernameToken`, `BinarySecurityToken`, signature, encryption, timestamp, nonce, dan replay protection;
5. memahami XML Signature, XML Encryption, canonicalization, dan signature wrapping risk;
6. mendesain trust model berbasis certificate, keystore, truststore, alias, key usage, dan rotation;
7. mengonfigurasi client/server SOAP security secara defensible;
8. membuat failure model untuk authentication, authorization, integrity, confidentiality, replay, clock skew, dan certificate lifecycle;
9. memigrasikan security stack Java 8 `javax` ke Java 11+ / Jakarta tanpa asumsi salah.

Inti mental model bagian ini:

> **TLS mengamankan jalur komunikasi. WS-Security mengamankan pesan.**

Keduanya tidak saling menggantikan sepenuhnya.

---

## 1. Masalah Utama: Banyak Engineer Menganggap SOAP Security = HTTPS

HTTPS memang penting, tetapi dalam banyak enterprise SOAP integration, HTTPS hanya menyelesaikan sebagian masalah.

Misalnya ada request SOAP:

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body>
    <SubmitCaseRequest>
      <caseId>CASE-001</caseId>
      <amount>1000000</amount>
    </SubmitCaseRequest>
  </soap:Body>
</soap:Envelope>
```

Dengan HTTPS, message terlindungi saat transit antara client dan server terdekat.

Tetapi pertanyaan production bukan hanya:

> “Apakah koneksi terenkripsi?”

Pertanyaan yang lebih tajam:

1. Siapa yang membuat message ini?
2. Apakah message berubah setelah dibuat?
3. Apakah message bisa dibaca oleh intermediary?
4. Apakah message ini replay dari request lama?
5. Apakah identity pengirim masih valid saat message diproses asynchronous?
6. Apakah message tetap aman jika melewati gateway, broker, ESB, log pipeline, atau queue?
7. Bagian mana dari message yang sebenarnya ditandatangani?
8. Apakah aplikasi memproses body yang sama dengan body yang diverifikasi?
9. Bagaimana key/certificate dirotasi tanpa memutus integrasi?
10. Bagaimana membuktikan secara audit bahwa request valid pada waktu tertentu?

SOAP security hidup di ruang ini.

---

## 2. Transport Security vs Message Security

### 2.1 Transport Security

Transport security biasanya berarti TLS/HTTPS.

Karakteristiknya:

| Aspek | Transport Security / TLS |
|---|---|
| Boundary | Connection/channel |
| Melindungi | Data in transit antar dua endpoint TLS |
| Integrity | Ya, di channel |
| Confidentiality | Ya, di channel |
| Authentication | Server auth; optional mutual TLS untuk client auth |
| Bertahan melewati intermediary? | Tidak secara message-level |
| Cocok untuk | Direct synchronous HTTP call, simple trust boundary |
| Risiko | Message bisa terbuka di TLS terminator, gateway, proxy, log, atau service internal |

TLS menjawab:

> “Apakah channel dari A ke B aman?”

Bukan:

> “Apakah pesan yang diterima B benar-benar belum berubah sejak dibuat oleh A?”

Jika TLS di-terminate di load balancer, lalu diteruskan plain HTTP ke backend, maka backend menerima message yang tidak lagi dilindungi TLS end-to-end.

Bahkan jika backend leg juga memakai TLS, security masih berbasis hop-by-hop, bukan message-level.

### 2.2 Message Security

Message security berarti security ditempelkan ke SOAP message itu sendiri.

Karakteristiknya:

| Aspek | Message Security / WS-Security |
|---|---|
| Boundary | SOAP message |
| Melindungi | Bagian tertentu dari envelope/header/body |
| Integrity | XML Signature |
| Confidentiality | XML Encryption |
| Authentication | Token/certificate/signature |
| Bertahan melewati intermediary? | Bisa, selama bagian message tidak diubah ilegal |
| Cocok untuk | Multi-hop, async, broker/ESB, non-repudiation-ish audit, cross-org integration |
| Risiko | Kompleksitas tinggi, canonicalization, signature wrapping, policy mismatch |

WS-Security menjawab:

> “Apakah pesan ini sendiri membawa bukti identity, integrity, dan/atau confidentiality?”

### 2.3 Kapan TLS Saja Cukup?

TLS saja sering cukup bila:

1. client dan server berkomunikasi direct;
2. tidak ada store-and-forward;
3. tidak ada intermediary yang perlu membaca sebagian message;
4. tidak ada kebutuhan tanda tangan message untuk audit;
5. tidak ada requirement encrypt sebagian payload secara end-to-end;
6. identity cukup diverifikasi di transport/session layer;
7. payload tidak diproses setelah keluar dari secure channel;
8. integrasi berada dalam satu trust domain yang terkendali.

Contoh:

- internal service-to-service SOAP lama di private network dengan mutual TLS;
- simple partner integration via VPN + mTLS + IP allowlist;
- SOAP endpoint yang hanya menerima request kecil dan langsung memproses synchronously.

Tetapi “cukup” di sini harus berdasarkan threat model, bukan preferensi developer.

### 2.4 Kapan Perlu WS-Security?

WS-Security lebih relevan bila:

1. message melewati ESB/gateway/broker/intermediary;
2. message disimpan sementara sebelum diproses;
3. ada kebutuhan sign/encrypt bagian tertentu dari SOAP body/header;
4. client identity harus dibawa di message, bukan hanya connection;
5. ada requirement audit atau legal defensibility;
6. partner mewajibkan WS-Security policy;
7. multi-hop route membutuhkan intermediary membaca header tetapi tidak body;
8. request perlu divalidasi setelah channel awal sudah tidak ada;
9. ada requirement replay protection berbasis timestamp/nonce/message id;
10. perlu interoperabilitas dengan sistem legacy government/bank/insurance/telco.

Contoh:

- bank mengirim SOAP instruction yang harus ditandatangani;
- government agency mengirim request via central gateway;
- SOAP message masuk queue lalu diproses worker beberapa menit kemudian;
- body berisi dokumen sensitif yang harus dienkripsi untuk final recipient saja;
- partner WSDL mempublikasikan WS-Policy yang mewajibkan signature/encryption.

---

## 3. Security Objective dalam SOAP

Sebelum memilih mekanisme, pisahkan objective-nya.

| Objective | Pertanyaan | Mekanisme umum |
|---|---|---|
| Authentication | Siapa pengirimnya? | mTLS, UsernameToken, X.509 token, SAML token, signature certificate |
| Integrity | Apakah message berubah? | XML Signature |
| Confidentiality | Siapa yang bisa membaca message? | TLS, XML Encryption |
| Replay protection | Apakah request lama dikirim ulang? | Timestamp, nonce, message id, replay cache |
| Authorization | Apakah pengirim boleh melakukan operasi ini? | App-level policy setelah identity established |
| Non-repudiation-ish audit | Bisakah dibuktikan pengirim menandatangani message? | Digital signature + cert chain + timestamp/audit trail |
| Freshness | Apakah message masih dalam waktu valid? | `wsu:Timestamp`, clock skew validation |
| Recipient binding | Untuk siapa message ini dibuat? | Audience/recipient constraints, encryption cert, WS-Addressing `To` |

Kesalahan umum: memakai signature untuk menggantikan authorization.

Signature hanya membuktikan bahwa pihak dengan private key tertentu menandatangani bytes/canonical XML tertentu. Signature tidak otomatis berarti operasi diizinkan.

Authorization tetap harus dilakukan di aplikasi:

```text
verified certificate subject / mapped client identity
        ↓
resolved partner/account/system principal
        ↓
operation-level authorization
        ↓
resource-level authorization
        ↓
business rule validation
```

---

## 4. Struktur WS-Security Header

WS-Security biasanya muncul di SOAP header.

Contoh sangat disederhanakan:

```xml
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
  xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">

  <soap:Header>
    <wsse:Security soap:mustUnderstand="1">
      <wsu:Timestamp wsu:Id="TS-1">
        <wsu:Created>2026-06-17T03:00:00Z</wsu:Created>
        <wsu:Expires>2026-06-17T03:05:00Z</wsu:Expires>
      </wsu:Timestamp>

      <wsse:BinarySecurityToken
          wsu:Id="X509-1"
          ValueType="...#X509v3"
          EncodingType="...#Base64Binary">
        MIIC...
      </wsse:BinarySecurityToken>

      <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        ...
      </ds:Signature>
    </wsse:Security>
  </soap:Header>

  <soap:Body wsu:Id="Body-1">
    <SubmitCaseRequest>
      <caseId>CASE-001</caseId>
    </SubmitCaseRequest>
  </soap:Body>
</soap:Envelope>
```

Komponen yang sering muncul:

| Komponen | Fungsi |
|---|---|
| `wsse:Security` | Container security header |
| `wsu:Timestamp` | Freshness window |
| `wsse:UsernameToken` | Username/password digest/plain token |
| `wsse:BinarySecurityToken` | Biasanya certificate X.509 |
| `ds:Signature` | XML Digital Signature |
| `xenc:EncryptedData` | XML Encryption result |
| `wsse:SecurityTokenReference` | Referensi ke token/cert/key |
| `wsu:Id` | ID target untuk signature reference |

Mental model:

```text
SOAP Envelope
 ├── Header
 │   └── Security
 │       ├── who / token
 │       ├── freshness / timestamp
 │       ├── proof / signature
 │       └── secrecy / encryption metadata
 └── Body
     └── business payload
```

---

## 5. UsernameToken

`UsernameToken` adalah mekanisme WS-Security untuk membawa username dan password material.

Contoh konseptual:

```xml
<wsse:UsernameToken wsu:Id="UsernameToken-1">
  <wsse:Username>partner-a</wsse:Username>
  <wsse:Password Type="...#PasswordDigest">...</wsse:Password>
  <wsse:Nonce>...</wsse:Nonce>
  <wsu:Created>2026-06-17T03:00:00Z</wsu:Created>
</wsse:UsernameToken>
```

### 5.1 PasswordText vs PasswordDigest

| Mode | Karakteristik | Risiko |
|---|---|---|
| PasswordText | Password dikirim sebagai text dalam security header | Sangat bergantung pada TLS; bahaya jika log/intermediary bocor |
| PasswordDigest | Digest dari nonce + created + password | Lebih baik terhadap password exposure langsung, tetapi tetap butuh TLS dan replay cache |

PasswordDigest bukan pengganti TLS. Ia mengurangi risiko password plain terlihat, tetapi message masih perlu confidentiality channel.

### 5.2 UsernameToken Cocok Untuk Apa?

Cocok bila:

1. partner integration sederhana;
2. tidak ada PKI/certificate management;
3. TLS/mTLS sudah tersedia;
4. requirement tidak membutuhkan digital signature per message;
5. server punya secure password verification mechanism;
6. replay cache bisa diterapkan.

Tidak cocok bila:

1. butuh non-repudiation-ish audit;
2. butuh message integrity end-to-end;
3. request melewati banyak intermediary;
4. shared secret terlalu banyak tersebar;
5. password rotation sulit;
6. banyak partner enterprise yang menuntut X.509 signature.

### 5.3 Replay Protection untuk UsernameToken

Jika memakai nonce + created, server perlu menyimpan nonce yang sudah dipakai untuk window tertentu.

Pseudo-model:

```text
on request:
  validate timestamp within allowed skew/window
  validate nonce exists and format sane
  key = username + nonce + created
  if replayCache.contains(key): reject
  validate password digest
  replayCache.put(key, ttl = freshnessWindow + skew)
  continue
```

Tanpa replay cache, nonce hanya ornamen.

---

## 6. X.509 Certificate dan BinarySecurityToken

Dalam integrasi enterprise, SOAP security sering memakai certificate X.509.

Certificate bisa dipakai untuk:

1. membuktikan identity signer;
2. membawa public key untuk verifikasi signature;
3. membawa public key recipient untuk encryption;
4. mapping partner identity;
5. chain validation terhadap CA/internal CA.

Contoh token:

```xml
<wsse:BinarySecurityToken
    wsu:Id="X509-1"
    ValueType="...#X509v3"
    EncodingType="...#Base64Binary">
  MIIC...
</wsse:BinarySecurityToken>
```

Lalu signature mereferensikan token tersebut.

### 6.1 Certificate Identity Mapping

Jangan langsung pakai `CN` sebagai satu-satunya identity tanpa policy.

Lebih defensible:

```text
certificate chain valid
  + not expired
  + not revoked if revocation checking required
  + issuer trusted
  + key usage / extended key usage sesuai
  + subject/SAN/serial/thumbprint cocok allowlist partner
  + mapped to internal principal
  + operation authorization checked
```

Mapping bisa berbasis:

| Mapping | Kelebihan | Risiko |
|---|---|---|
| Subject DN | Mudah dibaca | Bisa berubah saat renewal |
| Certificate fingerprint/thumbprint | Presisi | Harus update saat rotation |
| Serial + issuer | Stabil dalam CA context | Butuh process CA yang rapi |
| SAN URI/DNS/email | Lebih modern | Tidak semua partner punya SAN rapi |
| Alias truststore | Praktis | Alias bukan bukti cryptographic identity |

### 6.2 Certificate Lifecycle

Certificate bukan setup sekali.

Lifecycle minimal:

```text
request/generate keypair
  → CSR / certificate issuance
  → deploy keystore/truststore
  → configure alias/password
  → test signature/encryption
  → monitor expiry
  → pre-rotate cert
  → overlap old/new trust
  → revoke/remove old
```

Production incident umum:

1. cert expired;
2. alias berubah;
3. private key tidak ada di keystore;
4. truststore belum menerima cert partner baru;
5. chain incomplete;
6. intermediate CA hilang;
7. server pakai cert TLS untuk WS-Security tetapi key usage/policy berbeda;
8. password keystore salah;
9. container reload tidak mengambil keystore baru;
10. clock server salah sehingga cert dianggap belum valid/sudah expired.

---

## 7. XML Signature di SOAP

XML Signature memberi integrity dan signer authentication untuk bagian XML tertentu.

Struktur konseptual:

```xml
<ds:Signature>
  <ds:SignedInfo>
    <ds:CanonicalizationMethod Algorithm="..."/>
    <ds:SignatureMethod Algorithm="..."/>
    <ds:Reference URI="#Body-1">
      <ds:Transforms>...</ds:Transforms>
      <ds:DigestMethod Algorithm="..."/>
      <ds:DigestValue>...</ds:DigestValue>
    </ds:Reference>
  </ds:SignedInfo>
  <ds:SignatureValue>...</ds:SignatureValue>
  <ds:KeyInfo>...</ds:KeyInfo>
</ds:Signature>
```

Mental model:

```text
selected XML node(s)
  → canonicalize
  → digest
  → put digest in SignedInfo
  → canonicalize SignedInfo
  → sign SignedInfo with private key
  → recipient verifies with public key/cert
```

Signature tidak menandatangani “object Java”. Signature menandatangani canonical XML representation dari node tertentu.

### 7.1 Apa yang Harus Ditandatangani?

Minimal sering:

1. SOAP Body;
2. Timestamp;
3. WS-Addressing headers yang menentukan routing, misalnya `To`, `Action`, `MessageID` jika dipakai;
4. security token reference jika policy membutuhkan token protection.

Contoh policy intent:

```text
Sign:
  - SOAP Body
  - wsu:Timestamp
  - wsa:To
  - wsa:Action
  - wsa:MessageID

Encrypt:
  - SOAP Body content
```

Kenapa routing header perlu disign?

Karena kalau body signed tetapi `Action`/`To` bisa diubah, attacker mungkin membuat message valid secara body tetapi diarahkan ke operation/endpoint lain, tergantung stack.

### 7.2 Reference by ID

Umumnya XML Signature mereferensikan node dengan ID:

```xml
<soap:Body wsu:Id="Body-123">
  ...
</soap:Body>
```

Signature reference:

```xml
<ds:Reference URI="#Body-123">
  ...
</ds:Reference>
```

Masalahnya: XML ID handling bisa tricky karena attribute `wsu:Id` harus dikenali sebagai ID oleh security library. Jangan memvalidasi signature secara manual dengan DOM naive.

### 7.3 Signature Wrapping Attack

Signature wrapping terjadi ketika signature tetap valid terhadap node lama, tetapi aplikasi memproses node lain yang tidak ditandatangani.

Sketsa serangan:

```xml
<soap:Envelope>
  <soap:Header>
    <ds:Signature>
      <!-- signature valid untuk Body-Original -->
    </ds:Signature>
  </soap:Header>

  <soap:Body wsu:Id="Body-Attacker">
    <Transfer amount="999999"/>
  </soap:Body>

  <Wrapper>
    <soap:Body wsu:Id="Body-Original">
      <Transfer amount="10"/>
    </soap:Body>
  </Wrapper>
</soap:Envelope>
```

Jika security layer memverifikasi `Body-Original`, tetapi application layer mengambil `soap:Body` pertama/tertentu secara naive, sistem bisa memproses payload attacker.

Anti-pattern:

```java
NodeList bodies = document.getElementsByTagName("Body");
Node body = bodies.item(0);
```

Ini berbahaya untuk security-sensitive XML.

Prinsip aman:

1. gunakan WS-Security library mature, bukan parser manual;
2. enforce hanya satu SOAP Body yang valid di lokasi yang benar;
3. pastikan application consumes the signed element, not merely any element with same name;
4. validate signature references exactly match expected parts;
5. gunakan schema/structural validation bila sesuai;
6. jangan memakai `getElementsByTagName` untuk memilih security-critical element;
7. reject duplicate IDs;
8. reject unexpected wrapper structures;
9. bind verified security result ke message context yang diproses aplikasi.

---

## 8. Canonicalization: Sumber Banyak Bug Interoperability

XML secara tekstual bisa berbeda tetapi secara logical sama.

Contoh:

```xml
<a b="1" c="2"></a>
```

versus:

```xml
<a c="2" b="1"/>
```

Untuk signature, bytes harus stabil. Maka XML Signature memakai canonicalization.

Canonicalization mengubah XML node menjadi bentuk canonical sebelum digest/signature.

### 8.1 Kenapa Canonicalization Sulit?

Karena XML punya:

1. namespace prefix;
2. default namespace;
3. attribute ordering;
4. whitespace;
5. comments;
6. inclusive/exclusive namespace behavior;
7. inherited namespace declarations;
8. XML parser normalization;
9. transform chain;
10. envelope signature transform.

Bug umum:

| Bug | Dampak |
|---|---|
| Client pakai inclusive C14N, server expect exclusive C14N | Signature validation gagal |
| Namespace prefix berubah di gateway | Bisa gagal jika canonicalization/policy tidak cocok |
| Pretty-print setelah signing | Signature rusak |
| Middleware menambah header yang ikut signed | Signature rusak |
| XML parser mengubah whitespace meaningful | Digest mismatch |
| Transform tidak sama antar stack | Interop gagal |

### 8.2 Rule Praktis

1. Jangan modify message setelah signing.
2. Sign sedekat mungkin dengan outbound transport.
3. Verify sedekat mungkin dengan inbound boundary.
4. Jangan pretty-print signed XML untuk transit.
5. Log sanitized copy, bukan canonical signed bytes yang dipakai processing.
6. Samakan algorithm suite dengan partner sejak awal.
7. Buat golden sample signed message untuk regression test.
8. Test di Java version/runtime yang sama dengan production.

### 8.3 Algorithm Modernity

Hindari algorithm lemah seperti SHA-1 atau RSA v1.5 bila policy memungkinkan.

Preferensi umum modern:

```text
Digest: SHA-256 atau lebih kuat
Signature: RSA-SHA256 / ECDSA-SHA256 sesuai stack/interoperability
Encryption: AES-GCM/CBC sesuai policy dan stack support
Key transport/wrapping: modern RSA-OAEP jika supported
```

Tetapi SOAP legacy sering terkunci pada policy lama. Dalam kondisi begitu, dokumentasikan risk acceptance dan rencana migrasi.

---

## 9. XML Encryption

XML Encryption mengenkripsi bagian XML tertentu.

Contoh konseptual:

```xml
<xenc:EncryptedData Type="http://www.w3.org/2001/04/xmlenc#Content">
  <xenc:EncryptionMethod Algorithm="..."/>
  <ds:KeyInfo>
    <xenc:EncryptedKey>...</xenc:EncryptedKey>
  </ds:KeyInfo>
  <xenc:CipherData>
    <xenc:CipherValue>...</xenc:CipherValue>
  </xenc:CipherData>
</xenc:EncryptedData>
```

Praktik umum:

1. generate symmetric key per message;
2. encrypt SOAP Body/content dengan symmetric key;
3. encrypt symmetric key dengan recipient public key;
4. recipient decrypts symmetric key dengan private key;
5. recipient decrypts payload.

Mental model:

```text
SOAP Body
  → encrypt with random content key
  → encrypt content key with recipient public key
  → include encrypted key metadata
```

### 9.1 Encrypt Apa?

Pilihan umum:

| Target | Dampak |
|---|---|
| Body content | Header tetap bisa dibaca intermediary |
| Whole Body | Business payload tersembunyi |
| Specific element | Lebih granular, lebih kompleks |
| Security token | Melindungi token/password |

Jangan encrypt semua secara membabi buta jika intermediary perlu membaca header tertentu. Tetapi jangan tinggalkan field sensitif plain hanya karena “sudah HTTPS” jika requirement message-level confidentiality ada.

### 9.2 Sign-then-Encrypt vs Encrypt-then-Sign

Dua pola sering muncul:

#### Sign then encrypt

```text
plain body
  → sign plain body
  → encrypt body/signature parts
```

Kelebihan:

- signature melindungi plaintext semantic;
- signature tersembunyi jika ikut encrypted.

Risiko/kompleksitas:

- recipient harus decrypt dulu sebelum verify;
- intermediaries tidak bisa verify tanpa decrypt.

#### Encrypt then sign

```text
plain body
  → encrypt body
  → sign encrypted data
```

Kelebihan:

- intermediary bisa verify integrity encrypted blob;
- tampering encryption structure terdeteksi.

Risiko/kompleksitas:

- signature membuktikan ciphertext, bukan langsung plaintext;
- policy harus jelas.

Tidak ada jawaban universal. Ikuti WS-Policy partner, threat model, dan stack interoperability.

---

## 10. Timestamp, Clock Skew, Nonce, dan Replay Cache

Replay attack: attacker mengirim ulang message valid lama.

Signature valid tidak otomatis mencegah replay. Signature hanya membuktikan message pernah ditandatangani.

### 10.1 Timestamp

Contoh:

```xml
<wsu:Timestamp wsu:Id="TS-1">
  <wsu:Created>2026-06-17T03:00:00Z</wsu:Created>
  <wsu:Expires>2026-06-17T03:05:00Z</wsu:Expires>
</wsu:Timestamp>
```

Validation:

```text
now = trusted server clock
created <= now + allowedFutureSkew
expires >= now - allowedPastSkew
window <= maxAllowedLifetime
Timestamp is signed
```

Timestamp harus ditandatangani. Jika tidak, attacker bisa mengubah waktu.

### 10.2 Clock Skew

Partner enterprise sering punya clock berbeda beberapa detik/menit.

Konfigurasi praktis:

```text
allowed clock skew: 60s - 300s tergantung policy
message TTL: 300s - 600s untuk synchronous API
```

Terlalu ketat menyebabkan false rejection. Terlalu longgar membuka replay window.

### 10.3 Replay Cache

Replay cache menyimpan identifier request yang sudah diterima.

Sumber key:

1. UsernameToken nonce + created + username;
2. WS-Addressing MessageID;
3. signature digest + timestamp;
4. business idempotency key;
5. custom correlation id.

Pseudo-code:

```java
public final class ReplayValidator {
    private final ReplayStore store;

    public void validate(String sender, String messageId, Instant created, Duration ttl) {
        if (messageId == null || messageId.isBlank()) {
            throw new SecurityException("Missing message id");
        }

        String key = sender + ":" + messageId;
        boolean inserted = store.putIfAbsent(key, created.plus(ttl));

        if (!inserted) {
            throw new SecurityException("Replay detected");
        }
    }
}
```

Replay cache harus atomic. Di cluster, local in-memory cache bisa gagal jika replay masuk node berbeda. Gunakan distributed cache bila threat model menuntut cluster-wide replay protection.

---

## 11. Keystore dan Truststore di Java

SOAP security Java hampir selalu menyentuh keystore/truststore.

### 11.1 Konsep Dasar

| Store | Isi | Dipakai untuk |
|---|---|---|
| Keystore | Private key + certificate chain milik kita | Signing, decrypting, TLS server/client cert |
| Truststore | Certificate/CA yang dipercaya | Verify partner signature, TLS server/client trust |

Jangan campur konsep:

```text
private key kita  → keystore
public cert partner/CA → truststore
```

### 11.2 Format

| Format | Catatan |
|---|---|
| JKS | Legacy Java-specific |
| PKCS12 / `.p12` / `.pfx` | Lebih interoperable; default modern Java sering PKCS12 |
| PEM | Banyak dipakai OpenSSL/nginx, perlu konversi untuk Java stack tertentu |

### 11.3 Command Praktis

Generate keypair ke PKCS12:

```bash
keytool -genkeypair \
  -alias soap-client-signing \
  -keyalg RSA \
  -keysize 3072 \
  -sigalg SHA256withRSA \
  -validity 365 \
  -keystore client-keystore.p12 \
  -storetype PKCS12 \
  -dname "CN=client-a,O=Example Org,C=ID"
```

Export certificate:

```bash
keytool -exportcert \
  -alias soap-client-signing \
  -keystore client-keystore.p12 \
  -storetype PKCS12 \
  -rfc \
  -file client-a.crt
```

Import partner certificate to truststore:

```bash
keytool -importcert \
  -alias partner-a-signing \
  -file partner-a.crt \
  -keystore client-truststore.p12 \
  -storetype PKCS12
```

Inspect keystore:

```bash
keytool -list -v \
  -keystore client-keystore.p12 \
  -storetype PKCS12
```

Check certificate dates:

```bash
keytool -printcert -file partner-a.crt
```

### 11.4 Operational Rules

1. Keystore password bukan aplikasi config biasa; simpan di secret manager.
2. Private key tidak boleh masuk source control.
3. Jangan log keystore path/password/alias sensitif secara berlebihan.
4. Monitor expiry minimal 30/60/90 hari sebelum expired.
5. Dukung overlap old/new cert saat rotation.
6. Pisahkan TLS cert dan WS-Security signing/encryption cert bila policy menuntut.
7. Dokumentasikan alias dan purpose.
8. Gunakan least privilege untuk file permission.
9. Test restart/reload behavior.
10. Buat runbook untuk rollback truststore.

---

## 12. Mutual TLS vs WS-Security Certificate Signature

mTLS dan WS-Security X.509 signature sering disalahpahami sebagai hal yang sama.

| Aspek | mTLS | WS-Security Signature |
|---|---|---|
| Level | Transport connection | SOAP message |
| Private key dipakai untuk | TLS handshake | XML Signature |
| Bukti melekat di message? | Tidak | Ya |
| Bertahan setelah message disimpan? | Tidak | Ya |
| Cocok untuk | Endpoint/channel auth | Message integrity/signer proof |
| Replay protection | Tidak cukup sendiri | Perlu timestamp/replay cache |
| Audit message later | Terbatas | Lebih kuat bila signed message disimpan |

Pola kuat sering memakai keduanya:

```text
mTLS:
  authenticate connection and protect channel

WS-Security signature:
  authenticate message signer and protect message integrity

WS-Security encryption:
  protect message content end-to-end when needed
```

Tetapi ini mahal secara operasional. Gunakan bila requirement membenarkan kompleksitasnya.

---

## 13. Authorization Setelah WS-Security

Setelah message lolos security validation, aplikasi harus melakukan authorization.

Contoh alur:

```text
Inbound SOAP request
  ↓
TLS/mTLS validation
  ↓
WS-Security validation
  - timestamp valid
  - signature valid
  - certificate trusted
  - body signed
  - replay not detected
  ↓
Map certificate/token to principal
  ↓
Authorize operation
  ↓
Authorize business resource
  ↓
Validate business payload
  ↓
Execute idempotently
```

Mapping principal contoh:

```java
public record PartnerPrincipal(
        String partnerId,
        String certificateFingerprint,
        String subjectDn,
        Set<String> allowedOperations
) {}
```

Policy check:

```java
public final class SoapAuthorizationService {
    public void authorize(PartnerPrincipal principal, String operation, String agencyCode) {
        if (!principal.allowedOperations().contains(operation)) {
            throw new SecurityException("Operation not allowed for partner");
        }

        // Resource-level check. Example only.
        if (!isAgencyAllowed(principal.partnerId(), agencyCode)) {
            throw new SecurityException("Agency not allowed for partner");
        }
    }

    private boolean isAgencyAllowed(String partnerId, String agencyCode) {
        return true;
    }
}
```

Security validation tanpa authorization hanya membuktikan “siapa”, bukan “boleh apa”.

---

## 14. SOAP Security dengan Apache CXF / WSS4J: Mental Model

Di Java ecosystem, WS-Security sering diimplementasikan via Apache WSS4J, Apache CXF, Metro, atau app server stack.

Apache WSS4J adalah library umum untuk WS-Security processing. CXF sering memakai WSS4J interceptor.

Konsep konfigurasi biasanya:

```text
Outbound client:
  action = Signature Encrypt Timestamp UsernameToken ...
  user = key alias
  password callback = private key password / username password
  signature properties = keystore config
  encryption user = recipient cert alias
  encryption properties = truststore/crypto config

Inbound server:
  action = Signature Encrypt Timestamp ...
  signature verification properties = truststore config
  decryption properties = keystore config
  password callback = private key password
  replay cache = enabled
```

### 14.1 Contoh Properties Konseptual

`client-signature.properties`:

```properties
org.apache.wss4j.crypto.provider=org.apache.wss4j.common.crypto.Merlin
org.apache.wss4j.crypto.merlin.keystore.type=pkcs12
org.apache.wss4j.crypto.merlin.keystore.password=${KEYSTORE_PASSWORD}
org.apache.wss4j.crypto.merlin.keystore.alias=soap-client-signing
org.apache.wss4j.crypto.merlin.keystore.file=/secure/client-keystore.p12
```

`client-encryption.properties`:

```properties
org.apache.wss4j.crypto.provider=org.apache.wss4j.common.crypto.Merlin
org.apache.wss4j.crypto.merlin.keystore.type=pkcs12
org.apache.wss4j.crypto.merlin.keystore.password=${TRUSTSTORE_PASSWORD}
org.apache.wss4j.crypto.merlin.keystore.file=/secure/partner-truststore.p12
```

Password callback konseptual:

```java
public final class WsSecurityPasswordCallback implements CallbackHandler {
    private final Map<String, String> passwordsByIdentifier;

    public WsSecurityPasswordCallback(Map<String, String> passwordsByIdentifier) {
        this.passwordsByIdentifier = Map.copyOf(passwordsByIdentifier);
    }

    @Override
    public void handle(Callback[] callbacks) throws IOException, UnsupportedCallbackException {
        for (Callback callback : callbacks) {
            if (callback instanceof WSPasswordCallback pc) {
                String password = passwordsByIdentifier.get(pc.getIdentifier());
                if (password == null) {
                    throw new IOException("No password configured for identifier: " + pc.getIdentifier());
                }
                pc.setPassword(password);
            } else {
                throw new UnsupportedCallbackException(callback);
            }
        }
    }
}
```

Catatan: class `WSPasswordCallback` berasal dari WSS4J. Package-nya bisa berbeda tergantung versi.

### 14.2 CXF Client Interceptor Konseptual

```java
Map<String, Object> outProps = new HashMap<>();
outProps.put("action", "Timestamp Signature Encrypt");
outProps.put("user", "soap-client-signing");
outProps.put("signaturePropFile", "client-signature.properties");
outProps.put("encryptionPropFile", "client-encryption.properties");
outProps.put("encryptionUser", "partner-a-encryption");
outProps.put("passwordCallbackClass", "com.example.WsSecurityPasswordCallback");
outProps.put("signatureParts", "{}{http://schemas.xmlsoap.org/soap/envelope/}Body;"
        + "{}{http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd}Timestamp");
outProps.put("encryptionParts", "{}{http://schemas.xmlsoap.org/soap/envelope/}Body");

WSS4JOutInterceptor outInterceptor = new WSS4JOutInterceptor(outProps);
Client client = ClientProxy.getClient(port);
client.getOutInterceptors().add(outInterceptor);
```

Ini contoh pola, bukan copy-paste final. Nama property dapat berubah antar versi CXF/WSS4J.

### 14.3 Server Inbound Interceptor Konseptual

```java
Map<String, Object> inProps = new HashMap<>();
inProps.put("action", "Timestamp Signature Encrypt");
inProps.put("signaturePropFile", "server-truststore.properties");
inProps.put("decryptionPropFile", "server-keystore.properties");
inProps.put("passwordCallbackClass", "com.example.ServerKeyPasswordCallback");
inProps.put("enableSignatureConfirmation", "false");
inProps.put("timestampStrict", "true");
inProps.put("timeToLive", "300");
inProps.put("futureTimeToLive", "60");

WSS4JInInterceptor inInterceptor = new WSS4JInInterceptor(inProps);
endpoint.getInInterceptors().add(inInterceptor);
```

Production hardening:

1. require signed body;
2. require signed timestamp;
3. reject unsigned security-relevant headers;
4. enable replay cache if using nonce/timestamp;
5. restrict algorithms;
6. map certificate to principal explicitly;
7. validate certificate chain/expiry/revocation according to policy;
8. sanitize fault response.

---

## 15. Metro / Jakarta XML Web Services Notes

Metro/JAX-WS stack historically supports WS-Security through policy/configuration in app server contexts.

Di Java 8, banyak project mengandalkan `javax.xml.ws`/JAX-WS presence from JDK. Di Java 11+, modul terkait Java EE seperti JAXB/JAX-WS/SAAJ tidak lagi bundled di JDK, sehingga dependency runtime harus eksplisit.

Modern Jakarta stack memakai package `jakarta.xml.ws.*`, `jakarta.xml.soap.*`, `jakarta.xml.bind.*`.

Konsekuensi migration:

| Legacy | Modern |
|---|---|
| `javax.xml.ws.*` | `jakarta.xml.ws.*` |
| `javax.xml.soap.*` | `jakarta.xml.soap.*` |
| `javax.xml.bind.*` | `jakarta.xml.bind.*` |
| JDK-bundled assumption | explicit dependencies/runtime |
| old wsimport location | plugin/tool dependency |
| app server bundled stack | verify Jakarta EE version support |

Jangan mencampur `javax` dan `jakarta` model dalam satu generated artifact kecuali kamu benar-benar tahu classpath boundary-nya.

---

## 16. Policy-Driven Security: WS-Policy Bukan Dekorasi

Banyak partner menyediakan WSDL dengan WS-Policy.

Policy dapat menyatakan:

1. transport binding atau asymmetric binding;
2. required supporting tokens;
3. signed parts;
4. encrypted parts;
5. algorithm suite;
6. timestamp requirement;
7. layout/order;
8. include token behavior;
9. protection order;
10. trust version.

Contoh konseptual policy intent:

```xml
<wsp:Policy>
  <sp:AsymmetricBinding>
    ...
  </sp:AsymmetricBinding>
  <sp:SignedParts>
    <sp:Body/>
  </sp:SignedParts>
  <sp:EncryptedParts>
    <sp:Body/>
  </sp:EncryptedParts>
  <sp:IncludeTimestamp/>
</wsp:Policy>
```

Rule praktis:

```text
Do not implement what you think partner wants.
Implement what policy says, then test with real partner validator.
```

Jika policy tidak jelas, minta:

1. sample valid request;
2. sample valid response;
3. certificate chain;
4. algorithm suite;
5. signed parts list;
6. encrypted parts list;
7. timestamp TTL/skew;
8. SOAP version;
9. WS-Addressing version;
10. fault examples.

---

## 17. Logging SOAP Security dengan Aman

SOAP security incident sering diperburuk oleh logging.

Jangan log:

1. plaintext password token;
2. private key material;
3. decrypted sensitive body;
4. full certificate private info;
5. full BinarySecurityToken jika tidak perlu;
6. raw PII payload;
7. full signed message tanpa masking jika mengandung data sensitif;
8. keystore password;
9. session token;
10. decrypted attachments.

Log yang berguna:

| Field | Aman relatif? | Catatan |
|---|---:|---|
| correlation id | Ya | Harus konsisten end-to-end |
| SOAP action | Ya | Bisa sensitif dalam beberapa domain |
| partner id | Ya | Hindari data rahasia |
| cert fingerprint | Ya | Berguna untuk audit |
| cert subject DN | Tergantung | Bisa dianggap sensitif di beberapa organisasi |
| validation failure code | Ya | Jangan bocorkan detail crypto ke caller |
| timestamp created/expires | Ya | Untuk skew debugging |
| message size | Ya | Untuk anomaly detection |
| signed parts result | Ya | Log summary, bukan full XML |

Contoh structured log:

```json
{
  "event": "soap_security_validation_failed",
  "correlationId": "c-123",
  "partnerId": "partner-a",
  "operation": "SubmitCase",
  "reason": "SIGNATURE_INVALID",
  "certificateFingerprint": "SHA256:ABCD...",
  "soapVersion": "1.1",
  "timestampCreated": "2026-06-17T03:00:00Z",
  "serverTime": "2026-06-17T03:12:00Z"
}
```

Fault ke caller harus lebih generik:

```text
Security validation failed.
```

Detail internal masuk log aman, bukan response.

---

## 18. SOAP Fault untuk Security Failure

Security failure perlu dipetakan hati-hati.

| Failure | Internal reason | External response |
|---|---|---|
| Missing signature | `SIGNATURE_REQUIRED` | Security validation failed |
| Invalid signature | `SIGNATURE_INVALID` | Security validation failed |
| Expired timestamp | `MESSAGE_EXPIRED` | Security validation failed |
| Replay detected | `REPLAY_DETECTED` | Security validation failed |
| Unknown certificate | `CERT_NOT_TRUSTED` | Security validation failed |
| Unauthorized operation | `OPERATION_DENIED` | Access denied |
| Malformed security header | `SECURITY_HEADER_INVALID` | Invalid request |

Jangan memberi response terlalu detail seperti:

> “Signature invalid because digest mismatch on Body-123.”

Itu membantu attacker.

Tetapi untuk partner onboarding/UAT, kamu bisa menyediakan secure diagnostic channel terpisah.

---

## 19. Testing SOAP Security

Testing harus mencakup positive dan negative case.

### 19.1 Positive Golden Tests

Simpan sample:

1. valid signed request;
2. valid signed+encrypted request;
3. valid response dari mock/server;
4. cert chain test;
5. boundary timestamp test;
6. large attachment test bila MTOM.

Golden sample berguna untuk mendeteksi regression saat:

1. upgrade Java;
2. upgrade WSS4J/CXF/Metro;
3. migrasi `javax` ke `jakarta`;
4. ganti canonicalization algorithm;
5. ganti namespace/prefix;
6. ganti generated class;
7. ganti app server.

### 19.2 Negative Tests

Buat test yang harus gagal:

| Test | Expected |
|---|---|
| Body diubah setelah signing | Reject |
| Timestamp expired | Reject |
| Timestamp too far in future | Reject |
| Missing timestamp | Reject jika required |
| Unsigned body | Reject |
| Signature valid tapi body wrapper attack | Reject |
| Duplicate `wsu:Id` | Reject |
| Unknown cert | Reject |
| Expired cert | Reject |
| Wrong operation for partner | Reject |
| Replay same MessageID | Reject |
| Encryption to wrong recipient | Reject/decrypt fail |
| Weak algorithm if disallowed | Reject |

### 19.3 Test Harness Pattern

```text
/security-test-fixtures
  /certs
    client-old.p12
    client-new.p12
    partner-truststore.p12
  /messages
    valid-signed.xml
    valid-signed-encrypted.xml
    invalid-body-tampered.xml
    invalid-expired-timestamp.xml
    invalid-wrapper-attack.xml
    invalid-unknown-cert.xml
  /expected
    validation-results.json
```

CI test stages:

```text
unit:
  - config parsing
  - principal mapping
  - replay key generation

integration:
  - sign outbound
  - verify inbound
  - decrypt inbound
  - reject bad fixtures

compatibility:
  - generated WSDL client/server
  - golden message against partner mock
  - Java 8/11/17/21/25 matrix if required
```

---

## 20. Threat Model Checklist

Gunakan pertanyaan berikut sebelum menetapkan security design.

### 20.1 Channel

1. Apakah request direct atau multi-hop?
2. Apakah TLS di-terminate di load balancer?
3. Apakah internal hop terenkripsi?
4. Apakah mTLS required?
5. Apakah certificate pinning/allowlist required?

### 20.2 Message

1. Bagian mana yang harus signed?
2. Bagian mana yang harus encrypted?
3. Apakah WS-Addressing header harus signed?
4. Apakah attachment juga harus protected?
5. Apakah response juga harus signed/encrypted?

### 20.3 Identity

1. Apakah identity dari mTLS, UsernameToken, X.509 signature, atau SAML token?
2. Bagaimana token/cert dimap ke partner?
3. Apakah satu partner punya banyak cert?
4. Apakah satu cert boleh banyak operation?
5. Bagaimana offboarding partner?

### 20.4 Freshness

1. Apakah timestamp required?
2. TTL berapa?
3. Clock skew berapa?
4. Replay cache cluster-wide atau local?
5. Apa key replay-nya?

### 20.5 Crypto Lifecycle

1. Siapa issue certificate?
2. Apakah chain validated?
3. Apakah revocation checked?
4. Kapan expiry?
5. Bagaimana rotation overlap?
6. Bagaimana emergency revoke?
7. Bagaimana secret distribution?

### 20.6 Observability

1. Apakah security failure punya reason code internal?
2. Apakah correlation ID konsisten?
3. Apakah log bebas secret/PII?
4. Apakah expiry alert ada?
5. Apakah replay detection metric ada?
6. Apakah signature failure spike terdeteksi?

---

## 21. Production Architecture Pattern

### 21.1 Simple Direct Partner SOAP

```text
Partner Client
  → HTTPS/mTLS
  → API Gateway / LB
  → SOAP Service
       - validate mTLS principal
       - validate SOAP schema
       - authorize operation
       - process idempotently
```

Cocok bila tidak ada WS-Security requirement.

### 21.2 Signed SOAP Partner Integration

```text
Partner Client
  - sign Body + Timestamp
  - include cert/token
  - send over TLS

SOAP Service
  - TLS validation
  - WS-Security verify signature
  - validate timestamp
  - replay detection
  - map cert to partner
  - authorize operation/resource
  - process
```

Cocok untuk integrity/audit.

### 21.3 Signed and Encrypted Multi-Hop SOAP

```text
Client
  - sign payload
  - encrypt body for final recipient
  - route via gateway/ESB

Gateway/ESB
  - may inspect routing headers
  - cannot read encrypted body
  - forwards

Final Service
  - decrypt body
  - verify signature
  - validate freshness/replay
  - process
```

Cocok untuk high-sensitivity cross-domain integration.

### 21.4 Store-and-Forward

```text
Client
  - signs message
  - sends to gateway

Gateway
  - persists signed message
  - later forwards

Worker/Service
  - verifies signature at processing time
  - validates timestamp according to agreed async policy
  - checks replay/idempotency
```

Catatan: timestamp TTL untuk async harus didesain berbeda. Jika queue delay 10 menit tetapi TTL 5 menit, request valid akan ditolak.

---

## 22. Common Failure Modes

### 22.1 Signature Invalid Setelah Gateway

Penyebab:

1. gateway pretty-print XML;
2. gateway mengubah namespace prefix/structure;
3. gateway menambah header yang termasuk signed parts;
4. gateway reserializes body;
5. canonicalization mismatch.

Solusi:

1. jangan modifikasi signed parts;
2. sign setelah gateway bila gateway trusted signer;
3. exclude mutable headers dari signed parts jika aman;
4. gunakan policy yang jelas;
5. test dengan real gateway.

### 22.2 Message Expired di Production

Penyebab:

1. clock skew;
2. NTP broken;
3. queue delay;
4. partner timezone formatting salah;
5. TTL terlalu pendek.

Solusi:

1. enforce NTP;
2. monitor clock drift;
3. set skew realistis;
4. bedakan sync vs async TTL;
5. log created/expires/server time.

### 22.3 Unknown Certificate Saat Rotation

Penyebab:

1. truststore belum update;
2. alias salah;
3. chain baru beda CA;
4. intermediate CA tidak disertakan;
5. deployment partial.

Solusi:

1. overlap old+new cert;
2. publish rotation calendar;
3. pre-prod handshake test;
4. expiry alert;
5. emergency truststore reload process.

### 22.4 Signature Valid Tapi Unauthorized

Penyebab:

1. cert trusted tetapi partner tidak boleh operation;
2. shared cert dipakai banyak system;
3. mapping terlalu luas;
4. no resource-level authorization.

Solusi:

1. map cert to principal;
2. operation allowlist;
3. resource constraints;
4. audit partner/action/resource;
5. separate cert per integration bila memungkinkan.

### 22.5 Replay Detected Terlambat

Penyebab:

1. replay cache local per node;
2. load balancer menyebar replay ke node berbeda;
3. cache TTL terlalu pendek;
4. key replay tidak unik;
5. MessageID optional.

Solusi:

1. distributed replay cache;
2. require MessageID/nonce;
3. atomic put-if-absent;
4. TTL >= message validity window;
5. metric replay rejection.

---

## 23. Java Version and Namespace Strategy

### 23.1 Java 8

Di Java 8, banyak SOAP/JAXB/SAAJ API terasa tersedia dari JDK. Tetapi production system sering tetap memakai library/app server sendiri.

Risiko:

1. hidden dependency pada JDK-bundled APIs/tools;
2. sulit migrasi ke Java 11+;
3. old algorithms/defaults;
4. old TLS defaults;
5. library lama tidak mendukung Jakarta namespace.

### 23.2 Java 11+

Sejak Java 11, modul Java EE/CORBA legacy dihapus dari JDK. Untuk SOAP/JAXB/SAAJ, gunakan dependencies eksplisit.

Checklist:

```text
- jaxb-api/runtime explicit
- jaxws-api/runtime explicit
- saaj-api/implementation explicit
- activation explicit if required
- wsimport/wsgen via Maven/Gradle plugin/tool dependency
- WSS4J/CXF/Metro version compatible with target Java
```

### 23.3 Java 17/21/25

Perhatikan:

1. illegal reflective access dari library lama;
2. TLS algorithm restrictions;
3. default disabled algorithms;
4. JPMS/module path vs classpath;
5. app server Jakarta EE compatibility;
6. `javax` vs `jakarta` generated code;
7. cryptographic provider behavior;
8. container image truststore.

### 23.4 Namespace Migration Rule

Jangan setengah-setengah:

```text
Legacy stack:
  javax.xml.ws
  javax.xml.soap
  javax.xml.bind
  old CXF/Metro/app server

Modern Jakarta stack:
  jakarta.xml.ws
  jakarta.xml.soap
  jakarta.xml.bind
  Jakarta-compatible CXF/Metro/app server
```

Generated WSDL artifacts harus konsisten dengan runtime.

---

## 24. Design Decision Matrix

| Requirement | Recommended baseline |
|---|---|
| Simple internal direct SOAP | TLS + service auth + schema validation |
| Partner direct SOAP with strong endpoint auth | mTLS + authorization |
| Partner requires message integrity | TLS + WS-Security Signature + Timestamp |
| Body must remain confidential across intermediary | TLS + WS-Security Encryption |
| Async/store-and-forward | WS-Security Signature + async-aware timestamp/idempotency |
| Legal/audit-sensitive instruction | Signature + cert lifecycle + tamper-evident audit |
| Password-based partner auth | TLS + UsernameToken digest + nonce replay cache |
| High-risk multi-hop | mTLS + WS-Security sign/encrypt + signed addressing headers |
| Legacy weak algorithm mandated | Isolate, document risk, monitor, plan migration |
| Java 8 to 17/21 migration | Explicit dependencies + golden signed-message tests |

---

## 25. Implementation Checklist

### 25.1 Client Outbound

- [ ] WSDL/generated client version pinned.
- [ ] SOAP version known.
- [ ] WS-Policy analyzed.
- [ ] Outbound action list defined: Timestamp/Signature/Encrypt/UsernameToken.
- [ ] Signed parts explicit.
- [ ] Encrypted parts explicit.
- [ ] Keystore configured for signing/decryption if needed.
- [ ] Truststore configured for encryption/verification if needed.
- [ ] Password callback uses secret manager.
- [ ] Timestamp TTL set.
- [ ] Algorithm suite agreed.
- [ ] Endpoint timeout configured.
- [ ] Raw secret not logged.
- [ ] Golden outbound message tested.

### 25.2 Server Inbound

- [ ] TLS/mTLS policy defined.
- [ ] WS-Security inbound actions required.
- [ ] Body signature required if policy says so.
- [ ] Timestamp required and signed.
- [ ] Clock skew configured.
- [ ] Replay cache enabled.
- [ ] Duplicate IDs rejected.
- [ ] Certificate trust/mapping implemented.
- [ ] Authorization after authentication implemented.
- [ ] Schema validation considered.
- [ ] Faults sanitized.
- [ ] Structured security logs implemented.
- [ ] Metrics/alerts configured.

### 25.3 Operations

- [ ] Certificate expiry monitored.
- [ ] Rotation runbook exists.
- [ ] Truststore reload/redeploy behavior known.
- [ ] Partner onboarding checklist exists.
- [ ] Negative security test fixtures maintained.
- [ ] Algorithm deprecation tracked.
- [ ] Java/library upgrades tested with signed/encrypted fixtures.

---

## 26. Mini Case Study: Government SOAP Integration

Misal sistem A mengirim `SubmitComplianceCase` ke sistem B melalui central gateway.

Requirement:

1. request via HTTPS;
2. client certificate required;
3. SOAP Body signed;
4. Timestamp included;
5. MessageID included;
6. duplicate MessageID rejected for 10 minutes;
7. response signed by system B;
8. payload contains sensitive case data;
9. gateway boleh membaca routing header tetapi tidak boleh membaca body.

Design:

```text
Client A:
  - mTLS to gateway
  - include WS-Addressing To/Action/MessageID
  - include Timestamp
  - sign Body + Timestamp + To + Action + MessageID
  - encrypt Body for System B certificate

Gateway:
  - validates mTLS client
  - reads routing header
  - does not decrypt body
  - forwards to B

System B:
  - decrypts Body with private key
  - verifies signature using A certificate/truststore
  - validates Timestamp
  - checks MessageID replay cache
  - maps A cert to partner principal
  - authorizes SubmitComplianceCase
  - processes idempotently
  - signs response
```

Failure handling:

| Failure | Action |
|---|---|
| mTLS cert invalid | reject at gateway |
| signature invalid | reject at B, security fault |
| timestamp expired | reject at B, security fault |
| replay MessageID | reject at B, security fault/idempotency response depending policy |
| unauthorized operation | reject with access denied |
| decryption failed | reject, do not reveal details |

Audit record:

```json
{
  "correlationId": "...",
  "messageId": "...",
  "operation": "SubmitComplianceCase",
  "partnerId": "SystemA",
  "certFingerprint": "SHA256:...",
  "signatureValidated": true,
  "timestampCreated": "...",
  "replayCheck": "accepted",
  "authorization": "allowed",
  "decisionTime": "..."
}
```

---

## 27. Top 1% Mental Model

Engineer biasa bertanya:

> “Bagaimana cara enable WS-Security?”

Engineer kuat bertanya:

> “Security property apa yang harus bertahan melewati boundary apa, diverifikasi oleh siapa, pada waktu kapan, dengan key/cert yang lifecycle-nya bagaimana, dan bagaimana failure-nya terbukti aman?”

Gunakan model ini:

```text
Asset
  → threat
  → trust boundary
  → security objective
  → mechanism
  → validation point
  → failure behavior
  → observability
  → lifecycle
```

Contoh:

```text
Asset:
  SOAP Body berisi case decision

Threat:
  tampering oleh intermediary / replay request lama

Boundary:
  client → gateway → service → queue → worker

Objective:
  integrity + freshness + replay protection

Mechanism:
  XML Signature over Body/Timestamp/MessageID + replay cache

Validation point:
  service ingress and/or worker before processing

Failure behavior:
  reject securely, no partial processing

Observability:
  structured security failure log + metrics

Lifecycle:
  cert rotation, algorithm migration, fixture regression
```

---

## 28. Ringkasan

SOAP security bukan hanya menambahkan header.

SOAP security adalah desain boundary:

1. TLS melindungi channel.
2. mTLS mengautentikasi endpoint/channel.
3. WS-Security melindungi message.
4. XML Signature memberi integrity dan signer proof untuk node tertentu.
5. XML Encryption memberi confidentiality untuk bagian message tertentu.
6. Timestamp memberi freshness, tetapi butuh signature.
7. Nonce/MessageID memberi replay resistance, tetapi butuh replay cache.
8. Certificate memberi public-key identity, tetapi butuh trust mapping dan lifecycle.
9. Signature valid tidak berarti authorized.
10. XML Signature Wrapping adalah risiko nyata jika security verification dan application processing tidak terikat pada node yang sama.
11. Canonicalization membuat interop SOAP security rumit.
12. Java 11+ membutuhkan dependency SOAP/JAXB/SAAJ eksplisit.
13. `javax` dan `jakarta` harus konsisten.
14. Golden signed/encrypted fixtures adalah aset migration yang sangat penting.

---

## 29. Referensi Utama

- OASIS, **Web Services Security: SOAP Message Security 1.1.1**.  
  https://docs.oasis-open.org/wss-m/wss/v1.1.1/os/wss-SOAPMessageSecurity-v1.1.1-os.html

- W3C, **XML Signature Syntax and Processing Version 2.0**.  
  https://www.w3.org/TR/xmldsig-core2/

- W3C, **Canonical XML Version 2.0**.  
  https://www.w3.org/TR/xml-c14n2/

- OWASP, **Web Service Security Cheat Sheet**.  
  https://cheatsheetseries.owasp.org/cheatsheets/Web_Service_Security_Cheat_Sheet.html

- OWASP, **XML Security Cheat Sheet**.  
  https://cheatsheetseries.owasp.org/cheatsheets/XML_Security_Cheat_Sheet.html

- OWASP, **SAML Security Cheat Sheet**, bagian signature wrapping guidance.  
  https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html

- Apache, **WSS4J User Guide**.  
  https://ws.apache.org/wss4j/user_guide.html

- Apache CXF, **WS-Security Documentation**.  
  https://cxf.apache.org/docs/ws-security.html

- OpenJDK, **JEP 320: Remove the Java EE and CORBA Modules**.  
  https://openjdk.org/jeps/320

---

## 30. Status Seri

Kita belum selesai.

- Part saat ini: **Part 29 — SOAP Security in Practice**
- Berikutnya: **Part 30 — Legacy SOAP Modernization Patterns**
- Target akhir seri: **Part 34**

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-json-xml-soap-connectors-enterprise-integration — Part 28  ](./learn-java-json-xml-soap-connectors-enterprise-integration-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration — Part 30](./learn-java-json-xml-soap-connectors-enterprise-integration-part-030.md)

</div>