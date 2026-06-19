# learn-java-authentication-modes-and-patterns-part-020

# Part 20 — Passkeys, WebAuthn, FIDO2, and Passwordless Patterns

> Seri: **Java Authentication Modes and Patterns**  
> Target: Java 8 hingga Java 25  
> Level: Advanced / top 1% engineering mental model  
> Fokus: passwordless authentication berbasis public-key credential, WebAuthn, FIDO2, passkeys, dan integrasi backend Java production-grade.

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membahas beberapa mode authentication penting:

- password authentication,
- session-based authentication,
- Servlet/Jakarta/Spring authentication,
- API key,
- HMAC request signing,
- JWT,
- opaque token dan introspection,
- OAuth2,
- OIDC,
- client credentials,
- SAML,
- LDAP/AD/Kerberos,
- mTLS.

Part ini masuk ke mode authentication yang secara modern sering disebut:

- **passwordless authentication**,
- **passkey authentication**,
- **FIDO2 authentication**,
- **WebAuthn authentication**.

Topik ini penting karena passkey bukan sekadar “login tanpa password”. Secara engineering, passkey mengubah model authentication dari:

```text
server menyimpan verifier untuk secret yang user hafal
```

menjadi:

```text
server menyimpan public key dan metadata credential;
user/authenticator membuktikan kepemilikan private key melalui challenge-response
```

Perubahan kecil ini mengubah banyak hal:

- tidak ada password yang bisa di-phish dalam bentuk reusable secret,
- server tidak perlu menyimpan password hash,
- credential biasanya scoped ke relying party/origin,
- authentication memakai tanda tangan digital atas challenge,
- replay resistance menjadi properti inti,
- user verification dapat dipindahkan ke authenticator/platform,
- account recovery menjadi bagian paling kritis dari desain.

Part ini tidak akan mengulang cryptography dasar, TLS dasar, atau session dasar. Kita akan fokus pada cara berpikir, data model, protocol flow, backend Java integration, failure mode, dan decision framework.

---

## 1. Problem yang Diselesaikan

### 1.1 Masalah Password

Password bermasalah bukan hanya karena user memilih password lemah. Problem password jauh lebih struktural:

1. Password adalah **shared secret**.
2. User harus mengingat atau menyimpan secret.
3. Secret diketik ke origin yang user percaya.
4. Secret bisa dipakai ulang di banyak situs.
5. Secret bisa di-phish.
6. Server harus menyimpan verifier, biasanya password hash.
7. Jika database bocor, attacker bisa melakukan offline cracking.
8. Password reset sering menjadi bypass authentication.
9. MFA berbasis OTP masih bisa di-phish melalui real-time proxy.

Password authentication punya invariant yang sulit diperbaiki:

```text
Jika user dapat mengetik credential ke halaman asli,
user juga dapat tertipu mengetiknya ke halaman palsu.
```

Password manager membantu, MFA membantu, rate limit membantu, tetapi password tetap shared secret yang dapat dimasukkan ke tempat salah.

### 1.2 Masalah OTP dan MFA Tradisional

OTP memberi lapisan tambahan, tetapi banyak bentuk OTP tetap memiliki masalah:

- SMS OTP bergantung pada jaringan telco dan nomor telepon.
- Email OTP bergantung pada keamanan email.
- TOTP dapat di-phish oleh reverse proxy real-time.
- Push approval rentan MFA fatigue jika tidak didesain dengan benar.
- Recovery flow sering lebih lemah daripada faktor utama.

Masalahnya bukan hanya “apakah OTP random”, tetapi apakah bukti authentication:

- bound ke origin yang benar,
- non-replayable,
- tidak dapat dipakai ulang oleh attacker,
- tidak dapat diekstrak dari device,
- tidak memberi secret reusable ke server palsu.

### 1.3 Apa yang Ingin Dicapai Passwordless

Passwordless berbasis WebAuthn/passkey ingin mencapai beberapa properti:

1. **No shared password** antara user dan server.
2. **Private key tidak keluar dari authenticator**.
3. **Server menyimpan public key**, bukan secret reusable.
4. **Login memakai challenge-response**.
5. **Credential scoped ke relying party**.
6. **Replay resistance** melalui challenge unik.
7. **Phishing resistance** karena browser/platform mengikat credential ke origin/RP ID.
8. **User verification** dapat dilakukan oleh biometrics/PIN/device unlock.
9. **User presence** dapat dipastikan melalui interaction.
10. **Credential dapat dipakai sebagai first factor atau second factor**.

Mental model paling ringkas:

```text
Password:
  user membuktikan tahu secret yang juga diverifikasi server.

Passkey/WebAuthn:
  user membuktikan private key terkait public key yang server simpan,
  untuk relying party tertentu,
  terhadap challenge yang baru dibuat server.
```

---

## 2. Terminologi Inti

### 2.1 WebAuthn

**WebAuthn** adalah web API yang memungkinkan aplikasi web membuat dan memakai public key credential untuk authentication user. WebAuthn didefinisikan oleh W3C.

Dalam flow WebAuthn:

- browser bertindak sebagai client,
- authenticator membuat/menyimpan credential,
- server bertindak sebagai Relying Party,
- user melakukan ceremony registration atau authentication.

WebAuthn bukan library Java. WebAuthn adalah protocol/API boundary antara:

```text
server <-> browser JavaScript <-> browser/platform <-> authenticator
```

### 2.2 FIDO2

**FIDO2** biasanya merujuk ke kombinasi:

```text
FIDO2 = WebAuthn + CTAP2
```

- WebAuthn: API antara web application/browser dan relying party ecosystem.
- CTAP2: protocol antara client platform/browser dan authenticator, misalnya security key, phone, platform authenticator.

Backend Java biasanya tidak berbicara CTAP langsung. Backend Java biasanya memvalidasi WebAuthn registration/assertion result.

### 2.3 CTAP

**Client to Authenticator Protocol** adalah protocol yang dipakai platform/browser untuk berbicara dengan authenticator eksternal atau platform.

Contoh transport:

- USB,
- NFC,
- BLE,
- hybrid transport,
- platform authenticator internal.

Dari sisi backend Java, CTAP biasanya invisible. Namun engineer senior tetap perlu tahu CTAP karena beberapa behavior authenticator berasal dari sana:

- resident credential,
- discoverable credential,
- user verification capability,
- attestation behavior,
- transport hint,
- credential backup/sync behavior.

### 2.4 Passkey

**Passkey** adalah istilah user-facing untuk FIDO/WebAuthn credential yang biasanya:

- berbasis public key cryptography,
- terkait account user pada aplikasi,
- dapat digunakan untuk passwordless sign-in,
- dapat disimpan di platform authenticator,
- dapat disinkronkan lintas device oleh credential manager tertentu,
- atau dapat berupa device-bound credential pada security key.

Jadi:

```text
Passkey bukan protocol baru.
Passkey adalah packaging/usability model di atas FIDO/WebAuthn credential.
```

### 2.5 Relying Party

**Relying Party (RP)** adalah aplikasi/server yang mempercayai hasil authentication WebAuthn.

Dalam aplikasi Java, RP biasanya adalah backend service yang:

- membuat registration challenge,
- membuat authentication challenge,
- menyimpan public key credential,
- memverifikasi attestation/assertion,
- membuat session setelah authentication berhasil,
- mengelola credential lifecycle.

### 2.6 RP ID

**RP ID** adalah identifier domain untuk relying party. Credential WebAuthn scoped ke RP ID.

Contoh:

```text
Origin: https://login.example.com
RP ID : example.com atau login.example.com tergantung desain
```

RP ID adalah bagian penting dari phishing resistance. Credential untuk `example.com` tidak bisa begitu saja dipakai untuk `evil-example.com`.

### 2.7 Origin

**Origin** adalah tuple:

```text
scheme + host + port
```

Contoh:

```text
https://app.example.com
```

Server harus memvalidasi origin dari client data. Jika origin validation longgar, WebAuthn bisa kehilangan properti security pentingnya.

### 2.8 Authenticator

**Authenticator** adalah komponen yang membuat dan memakai credential.

Jenis umum:

1. **Platform authenticator**
   - built-in di device.
   - Contoh: Windows Hello, Touch ID, Face ID, Android credential manager.

2. **Roaming authenticator**
   - terpisah dari device.
   - Contoh: hardware security key via USB/NFC/BLE.

3. **Synced authenticator/passkey provider**
   - credential disinkronkan lintas device melalui platform/cloud provider.

4. **Device-bound authenticator**
   - credential tetap pada device/security key tertentu.

### 2.9 User Presence

**User Presence (UP)** berarti authenticator mendapatkan bukti user hadir saat operasi dilakukan.

Contoh:

- menyentuh security key,
- mengklik konfirmasi,
- membuka device.

UP menjawab:

```text
Apakah ada human interaction saat operasi ini?
```

UP tidak sama dengan user verification.

### 2.10 User Verification

**User Verification (UV)** berarti authenticator memverifikasi user lokal.

Contoh:

- biometric,
- PIN device,
- platform unlock.

UV menjawab:

```text
Apakah authenticator memverifikasi bahwa user lokal yang sah sedang menggunakan credential?
```

Dalam desain authentication, UV sering menjadi pembeda antara:

- passkey sebagai first factor,
- security key sebagai second factor,
- step-up authentication.

### 2.11 Attestation

**Attestation** adalah bukti tentang authenticator atau credential saat registration.

Attestation dapat menjawab:

- authenticator jenis apa yang membuat credential?
- apakah credential dibuat oleh hardware tertentu?
- apakah device memenuhi policy tertentu?
- apakah key dilindungi hardware?

Namun attestation punya trade-off besar:

- privacy risk,
- UX friction,
- vendor metadata complexity,
- enterprise policy complexity.

Banyak consumer application memilih attestation policy yang permissive atau `none`.

### 2.12 Assertion

**Assertion** adalah hasil authentication ceremony. Pada login, authenticator menandatangani challenge dan data tertentu dengan private key credential.

Server memverifikasi assertion menggunakan public key yang tersimpan.

---

## 3. Mental Model Utama

### 3.1 Password vs Passkey

Password flow:

```text
User -> Server:
  "Saya tahu secret ini."

Server:
  "Saya hash dan cocokkan dengan verifier."
```

Passkey flow:

```text
Server -> User/Authenticator:
  "Tandatangani challenge acak ini untuk RP saya."

Authenticator -> Server:
  "Ini signature dari private key credential saya."

Server:
  "Saya verifikasi dengan public key yang pernah saya simpan."
```

Perbedaan besar:

| Aspek | Password | Passkey/WebAuthn |
|---|---|---|
| Secret utama | Diketahui user | Private key di authenticator |
| Server menyimpan | Password hash | Public key + credential metadata |
| Bisa di-phish | Ya | Jauh lebih sulit karena RP/origin bound |
| Bisa replay | Jika secret dicuri, ya | Challenge unik mencegah replay |
| Offline cracking DB leak | Mungkin | Tidak relevan untuk public key |
| UX | User input password | Device unlock / biometric / security key |
| Recovery risk | Sangat tinggi | Tetap tinggi, tetapi berbeda bentuk |

### 3.2 Authentication sebagai Dua Ceremony

WebAuthn punya dua ceremony utama:

1. **Registration ceremony**
   - membuat credential baru.
   - server menyimpan public key credential.

2. **Authentication ceremony**
   - memakai credential yang sudah terdaftar.
   - server memverifikasi signature.

Model:

```text
Registration:
  bind account -> credential public key

Authentication:
  prove possession of credential private key -> create app session
```

### 3.3 Server Tidak Mengautentikasi Biometrics

Kesalahan mental model umum:

```text
"Server memverifikasi fingerprint user."
```

Salah.

Yang benar:

```text
Authenticator lokal memverifikasi user menggunakan biometric/PIN/device unlock.
Server hanya melihat flag/proof bahwa user verification terjadi sesuai WebAuthn data.
```

Server tidak menerima fingerprint, face template, atau PIN device.

Server memverifikasi:

- challenge,
- origin,
- RP ID hash,
- signature,
- credential ID,
- public key,
- flags,
- sign counter jika relevan,
- attestation jika policy membutuhkan.

### 3.4 Passkey Tidak Otomatis Menghapus Semua Risiko

Passkey mengurangi risiko besar, tetapi tidak menghapus semua risiko.

Masih ada risiko:

- account recovery lemah,
- device theft dengan weak local unlock,
- malware/browser compromise,
- session hijacking setelah login,
- malicious OAuth/OIDC integration,
- poor RP ID/origin configuration,
- lost device support burden,
- shared device ambiguity,
- tenant/domain migration issues,
- sync provider trust assumptions,
- phishing via fallback password jika fallback masih aktif.

Passkey adalah strong authentication primitive, bukan seluruh security architecture.

---

## 4. Protocol-Level Architecture

### 4.1 Komponen Sistem

```text
+-------------------+        +------------------+        +---------------------+
| Java Backend RP   | <----> | Browser / Client | <----> | Authenticator       |
|                   |        | WebAuthn API     |        | Platform/Roaming    |
+-------------------+        +------------------+        +---------------------+
        |                            |                             |
        | challenge/options          | navigator.credentials.*      |
        | verify response            | CTAP/platform interaction    |
        | persist public key         | user verification/presence   |
```

Backend Java tidak membuat private key. Backend Java tidak membaca biometric. Backend Java tidak berbicara langsung ke authenticator pada web flow.

Backend Java bertanggung jawab untuk:

1. Membuat challenge yang random dan single-use.
2. Mengirim creation/request options ke browser.
3. Memvalidasi response.
4. Menyimpan credential metadata.
5. Membuat session/token aplikasi setelah sukses.
6. Mengelola lifecycle credential.
7. Menangani recovery dan risk policy.

### 4.2 Registration Ceremony High-Level

```text
1. User login/identity proofing awal atau enrollment context.
2. Backend membuat registration challenge.
3. Backend menyimpan challenge sementara.
4. Backend mengirim PublicKeyCredentialCreationOptions ke browser.
5. Browser memanggil navigator.credentials.create(...).
6. Authenticator membuat key pair.
7. Authenticator mengembalikan attestation object dan client data.
8. Browser mengirim response ke backend.
9. Backend memverifikasi response.
10. Backend menyimpan credential public key dan metadata.
```

### 4.3 Authentication Ceremony High-Level

```text
1. User memilih login dengan passkey.
2. Backend membuat authentication challenge.
3. Backend menyimpan challenge sementara.
4. Backend mengirim PublicKeyCredentialRequestOptions ke browser.
5. Browser memanggil navigator.credentials.get(...).
6. Authenticator mencari credential yang cocok.
7. User presence/user verification dilakukan.
8. Authenticator menandatangani challenge.
9. Browser mengirim assertion response ke backend.
10. Backend memverifikasi signature dan metadata.
11. Backend membuat application session.
```

---

## 5. Registration Ceremony Detail

### 5.1 Input dari Backend

Registration options biasanya memuat:

- challenge,
- RP information,
- user information,
- public key credential parameters,
- authenticator selection,
- attestation preference,
- exclude credentials,
- timeout,
- extensions.

Conceptual JSON:

```json
{
  "challenge": "base64url-random-challenge",
  "rp": {
    "name": "Example App",
    "id": "example.com"
  },
  "user": {
    "id": "base64url-stable-user-handle",
    "name": "fajar@example.com",
    "displayName": "Fajar"
  },
  "pubKeyCredParams": [
    { "type": "public-key", "alg": -7 },
    { "type": "public-key", "alg": -257 }
  ],
  "authenticatorSelection": {
    "residentKey": "preferred",
    "userVerification": "preferred"
  },
  "attestation": "none",
  "excludeCredentials": []
}
```

Backend Java harus menghasilkan options sesuai library/spec, bukan merakit JSON sembarangan jika tidak benar-benar memahami encoding.

### 5.2 Challenge

Challenge harus:

- random kuat,
- cukup panjang,
- single-use,
- punya expiry pendek,
- bound ke action registration,
- bound ke user/account context,
- disimpan server-side atau dibuat secara stateless dengan integrity protection.

Contoh invariant:

```text
registration_challenge.challenge_id hanya boleh berhasil sekali.
registration_challenge.user_id harus sama dengan user yang sedang enroll.
registration_challenge.expires_at harus belum lewat.
registration_challenge.purpose harus REGISTRATION.
```

Jangan memakai challenge yang:

- predictable,
- reusable,
- tidak expired,
- tidak terikat user,
- sama untuk registration dan authentication,
- hanya disimpan di client tanpa integritas.

### 5.3 User Handle

WebAuthn user handle bukan display name.

Properti user handle yang baik:

- stable,
- opaque,
- tidak mengandung email/PII jika bisa dihindari,
- unik per user di RP,
- tidak berubah saat email berubah.

Contoh buruk:

```text
user.id = email user
```

Kenapa buruk?

- email bisa berubah,
- email adalah PII,
- bisa bocor lewat credential metadata/flow tertentu,
- sulit migration.

Contoh lebih baik:

```text
user.id = random 128-bit/256-bit opaque stable ID
```

### 5.4 Exclude Credentials

Saat registration, backend dapat mengirim daftar credential yang sudah terdaftar untuk user agar authenticator mencegah duplikasi credential yang sama.

Gunanya:

- menghindari user mendaftarkan credential yang sama berkali-kali,
- memperbaiki UX,
- menjaga data model tetap bersih.

Namun exclude credentials harus hati-hati untuk privacy/user enumeration, terutama pada flow usernameless atau pre-login enrollment.

### 5.5 Attestation Policy

Attestation preference umum:

- `none`,
- `indirect`,
- `direct`,
- `enterprise`.

Untuk consumer app, `none` sering cukup.

Untuk regulated enterprise, bisa jadi perlu attestation policy seperti:

```text
Hanya authenticator tertentu yang boleh dipakai untuk admin/privileged access.
```

Namun policy seperti ini membawa operational cost:

- metadata service handling,
- vendor compatibility,
- device procurement,
- exception handling,
- privacy review,
- user support.

### 5.6 Public Key Credential Parameters

Backend harus memilih algorithm yang didukung.

Umumnya:

- ES256 / COSE alg `-7`,
- RS256 / COSE alg `-257`,
- EdDSA jika didukung oleh ecosystem/library.

Decision rule:

```text
Jangan pilih algorithm karena trend.
Pilih algorithm berdasarkan browser/authenticator support, library support,
compliance constraint, dan key lifecycle.
```

---

## 6. Registration Verification Backend

Saat browser mengirim registration response, backend harus memvalidasi beberapa hal.

### 6.1 Yang Dikirim Browser

Registration response biasanya mengandung:

- credential ID,
- raw ID,
- type,
- clientDataJSON,
- attestationObject,
- transports metadata jika tersedia.

Conceptual payload:

```json
{
  "id": "credential-id",
  "rawId": "base64url-credential-id",
  "type": "public-key",
  "response": {
    "clientDataJSON": "base64url-json",
    "attestationObject": "base64url-cbor"
  }
}
```

### 6.2 Validation Checklist

Backend harus memvalidasi minimal:

1. `type` adalah `public-key`.
2. `clientDataJSON.type` adalah `webauthn.create`.
3. Challenge cocok dengan challenge yang server keluarkan.
4. Challenge belum expired.
5. Challenge belum pernah dipakai.
6. Origin sesuai allowed origin.
7. RP ID hash cocok.
8. User presence sesuai policy.
9. User verification sesuai policy.
10. Attestation sesuai policy.
11. Public key dapat diekstrak dan didukung.
12. Credential ID belum terdaftar secara tidak sah.
13. User handle/account binding benar.
14. Counter awal disimpan jika tersedia.

### 6.3 Apa yang Disimpan

Minimal credential table:

```sql
CREATE TABLE user_webauthn_credential (
    id                      BIGINT PRIMARY KEY,
    user_id                 BIGINT NOT NULL,
    credential_id_hash      VARBINARY(32) NOT NULL,
    credential_id_encrypted BLOB NOT NULL,
    public_key_cose         BLOB NOT NULL,
    sign_count              BIGINT NULL,
    user_verified_required  BOOLEAN NOT NULL,
    backup_eligible         BOOLEAN NULL,
    backup_state            BOOLEAN NULL,
    transports_json         CLOB NULL,
    attestation_format      VARCHAR(64) NULL,
    aaguid                  VARCHAR(64) NULL,
    name                    VARCHAR(128) NULL,
    created_at              TIMESTAMP NOT NULL,
    last_used_at            TIMESTAMP NULL,
    revoked_at              TIMESTAMP NULL,
    version                 BIGINT NOT NULL
);

CREATE UNIQUE INDEX uq_webauthn_credential_id_hash
ON user_webauthn_credential (credential_id_hash);

CREATE INDEX ix_webauthn_credential_user
ON user_webauthn_credential (user_id, revoked_at);
```

Kenapa ada `credential_id_hash` dan `credential_id_encrypted`?

- Credential ID bukan password, tetapi tetap security-sensitive identifier.
- Hash memudahkan lookup.
- Encrypted value memungkinkan penyimpanan asli bila diperlukan.
- Untuk banyak sistem, menyimpan raw credential ID bisa diterima, tetapi high-assurance system dapat memperlakukan sebagai sensitive metadata.

### 6.4 Credential Naming

User harus dapat mengenali credential:

```text
- "MacBook Pro Chrome"
- "iPhone Passkey"
- "YubiKey 5 NFC"
- "Windows Hello Work Laptop"
```

Namun nama credential tidak boleh menjadi sumber authorization. Nama hanya UX metadata.

---

## 7. Authentication Ceremony Detail

### 7.1 Login dengan Username + Passkey

Flow:

```text
1. User memasukkan username/email.
2. Backend mencari credential milik user.
3. Backend membuat challenge dan allowCredentials.
4. Browser meminta authenticator memakai credential tersebut.
5. Backend verifikasi assertion.
6. Backend membuat session.
```

Kelebihan:

- lebih mudah diterapkan,
- lebih predictable,
- mengurangi ambiguity account selection,
- cocok untuk migrasi dari password.

Kekurangan:

- masih ada username step,
- masih bisa ada user enumeration jika tidak hati-hati,
- belum sepenuhnya usernameless.

### 7.2 Usernameless / Discoverable Credential Login

Flow:

```text
1. User klik "Sign in with passkey".
2. Backend membuat challenge tanpa username spesifik.
3. Browser/authenticator menampilkan credential yang cocok dengan RP.
4. User memilih credential.
5. Assertion mengandung user handle/credential ID.
6. Backend menemukan account dari credential.
7. Backend membuat session.
```

Kelebihan:

- UX lebih passwordless-native,
- user tidak perlu mengetik username,
- phishing resistance tetap kuat.

Kekurangan:

- data model lebih sensitif,
- account discovery harus benar,
- perlu discoverable/resident credential,
- support/platform behavior bisa berbeda.

### 7.3 Request Options

Conceptual authentication options:

```json
{
  "challenge": "base64url-random-challenge",
  "rpId": "example.com",
  "allowCredentials": [
    {
      "type": "public-key",
      "id": "base64url-credential-id",
      "transports": ["internal", "usb", "nfc"]
    }
  ],
  "userVerification": "preferred",
  "timeout": 60000
}
```

Untuk usernameless flow, `allowCredentials` bisa kosong atau tidak dikirim agar authenticator dapat memilih discoverable credentials.

### 7.4 Assertion Response

Assertion response biasanya mengandung:

- credential ID,
- clientDataJSON,
- authenticatorData,
- signature,
- userHandle,
- type.

Backend memverifikasi signature menggunakan public key yang tersimpan.

### 7.5 Assertion Validation Checklist

Backend harus memvalidasi:

1. Credential ID dikenal dan aktif.
2. Challenge cocok, belum expired, belum digunakan.
3. `clientDataJSON.type` adalah `webauthn.get`.
4. Origin allowed.
5. RP ID hash cocok.
6. Signature valid atas signed data.
7. User presence sesuai policy.
8. User verification sesuai policy.
9. User handle cocok jika dikirim.
10. Sign counter tidak menunjukkan cloning jika counter dipakai.
11. Credential belum revoked.
12. Account tidak disabled/locked.
13. Risk policy terpenuhi.
14. Session dibuat dengan rotation dan secure cookie policy.

---

## 8. Signature Verification Mental Model

Secara konseptual:

```text
authenticatorData = binary data from authenticator
clientDataHash    = SHA-256(clientDataJSON)
signedData        = authenticatorData || clientDataHash
signature         = sign(privateKey, signedData)

server verifies:
verify(publicKey, signedData, signature)
```

Backend Java library biasanya menyembunyikan detail CBOR/COSE parsing. Tetapi engineer senior harus tahu data apa yang sebenarnya ditandatangani.

Yang penting:

- challenge ada di `clientDataJSON`,
- origin ada di `clientDataJSON`,
- RP ID hash dan flags ada di `authenticatorData`,
- signature mengikat dua bagian tersebut.

Jadi server tidak boleh hanya memvalidasi signature tanpa memvalidasi challenge/origin/RP ID.

---

## 9. Flags dan Security Semantics

Authenticator data berisi flags. Beberapa yang penting secara konseptual:

### 9.1 User Present Flag

Menunjukkan user presence.

Rule:

```text
Jika policy mengharuskan user presence, flag UP harus true.
```

Hampir semua interactive authentication perlu UP.

### 9.2 User Verified Flag

Menunjukkan user verification.

Rule:

```text
Jika passkey dipakai sebagai passwordless first factor,
user verification biasanya harus required untuk account sensitif.
```

Namun UX dan device compatibility perlu dipertimbangkan.

### 9.3 Backup Eligibility / Backup State

Passkey modern bisa memiliki metadata apakah credential backup eligible atau sudah backed up/synced.

Arti praktis:

- synced passkey lebih nyaman untuk recovery/device migration,
- device-bound credential mungkin lebih kuat untuk high assurance,
- regulated environment mungkin membedakan policy keduanya.

Decision example:

```text
Consumer account:
  synced passkey accepted.

Privileged production admin:
  require hardware security key or managed device-bound credential.
```

---

## 10. Attestation Deep Dive

### 10.1 Apa yang Attestation Buktikan

Attestation dapat membuktikan bahwa credential dibuat oleh authenticator dengan karakteristik tertentu.

Contoh policy:

```text
Admin harus memakai FIPS-certified hardware key.
```

Untuk itu server perlu memeriksa attestation chain dan metadata.

### 10.2 Kapan Attestation Diperlukan

Attestation mungkin diperlukan untuk:

- regulated workforce,
- privileged admin,
- high-value transaction approval,
- device-managed enterprise,
- hardware-backed requirement,
- government/compliance environment.

Tidak selalu diperlukan untuk:

- consumer login umum,
- low-risk account,
- aplikasi internal non-critical,
- migrasi awal dari password.

### 10.3 Risiko Attestation

Attestation membawa risiko:

1. **Privacy**
   - dapat mengungkap jenis authenticator.
2. **Compatibility**
   - device/browser behavior berbeda.
3. **Operational burden**
   - metadata update, vendor trust, cert chain.
4. **False rejection**
   - user legitimate gagal enroll karena authenticator tidak dikenal.
5. **Policy brittleness**
   - terlalu kaku dan sulit rollout.

### 10.4 Practical Recommendation

Untuk banyak aplikasi:

```text
Default: attestation = none
High assurance role: require attestation for selected authenticators
Privileged operation: combine attestation + UV + step-up + audit
```

---

## 11. Resident Credential, Discoverable Credential, and Usernameless Login

### 11.1 Resident/Discoverable Credential

Discoverable credential memungkinkan authenticator menemukan credential untuk RP tanpa server mengirim `allowCredentials` spesifik.

Ini membuka usernameless login:

```text
User tidak mengetik username.
Authenticator menunjukkan credential yang tersedia untuk RP.
```

### 11.2 Trade-Off

| Model | Kelebihan | Kekurangan |
|---|---|---|
| Non-discoverable credential | Simple, server-driven | Butuh username dulu |
| Discoverable credential | Usernameless UX | Lebih banyak platform nuance |
| Synced passkey | Recovery mudah | Trust ke sync provider |
| Device-bound key | Assurance kuat | Recovery/support lebih sulit |

### 11.3 Data Model Impact

Untuk usernameless login, backend harus bisa mencari account dari credential ID atau user handle.

Invariant:

```text
credential_id -> exactly one active account credential binding
```

Jika satu credential ID bisa map ke banyak account, authentication ambiguity terjadi.

---

## 12. Java Backend Integration Patterns

### 12.1 Jangan Implementasi WebAuthn Parsing Sendiri Kecuali Sangat Perlu

WebAuthn melibatkan:

- CBOR,
- COSE keys,
- base64url encoding,
- authenticator data parsing,
- client data parsing,
- signature verification,
- attestation formats,
- extension handling,
- algorithm negotiation.

Implementasi manual raw sangat rentan bug.

Gunakan library Java yang mature jika memungkinkan.

Contoh library ecosystem:

- Yubico `java-webauthn-server`,
- WebAuthn4J,
- framework/IdP built-in WebAuthn support,
- Spring Security custom integration di atas library.

### 12.2 Layering yang Disarankan

```text
Controller/API Layer
  - expose startRegistration
  - expose finishRegistration
  - expose startAuthentication
  - expose finishAuthentication

Application Service
  - validate account state
  - create challenge
  - bind ceremony to user/session
  - call WebAuthn verifier
  - persist credential/session

WebAuthn Library Adapter
  - maps app model <-> library model
  - contains RP config
  - performs library verification call

Repository
  - challenge store
  - credential store
  - audit store

Security Integration
  - creates app session or Spring Authentication
  - rotates session ID
  - emits login event
```

Avoid:

```text
Controller directly parses WebAuthn response and writes DB.
```

### 12.3 Example API Shape

```text
POST /auth/passkey/registration/start
POST /auth/passkey/registration/finish
POST /auth/passkey/authentication/start
POST /auth/passkey/authentication/finish
GET  /account/passkeys
POST /account/passkeys/{id}/rename
POST /account/passkeys/{id}/revoke
```

For usernameless login:

```text
POST /auth/passkey/authentication/start
```

may not require username.

For username-first login:

```text
POST /auth/passkey/authentication/start
{
  "username": "user@example.com"
}
```

### 12.4 Challenge Store

Relational model:

```sql
CREATE TABLE webauthn_challenge (
    id              VARCHAR(64) PRIMARY KEY,
    purpose         VARCHAR(32) NOT NULL,
    user_id         BIGINT NULL,
    challenge_hash  VARBINARY(32) NOT NULL,
    csrf_binding    VARCHAR(128) NULL,
    session_binding VARCHAR(128) NULL,
    created_at      TIMESTAMP NOT NULL,
    expires_at      TIMESTAMP NOT NULL,
    consumed_at     TIMESTAMP NULL,
    metadata_json   CLOB NULL
);

CREATE INDEX ix_webauthn_challenge_expiry
ON webauthn_challenge (expires_at);
```

For Redis:

```text
key: webauthn:challenge:{challengeId}
ttl: 2-5 minutes
value:
  purpose
  userId nullable
  challengeHash
  sessionBinding
  csrfBinding
  rpId
  originPolicy
```

Rule:

```text
Challenge must be consumed atomically.
```

Pseudo:

```java
boolean consumed = challengeStore.consumeIfValid(challengeId, challengeHash, now);
if (!consumed) {
    throw new AuthenticationFailedException("Invalid or expired challenge");
}
```

### 12.5 Spring Security Integration

There are two common patterns.

#### Pattern A — Passkey Login Creates Server Session

```text
WebAuthn assertion verified
  -> create Authentication object
  -> store in SecurityContext
  -> rotate HTTP session
  -> return 204/redirect
```

Best for:

- server-rendered app,
- BFF,
- enterprise web app,
- apps already using session.

#### Pattern B — Passkey Login Issues Token Through Authorization Server

```text
WebAuthn assertion verified by IdP/auth server
  -> OIDC authorization flow completes
  -> application receives ID/access token
```

Best for:

- multi-app SSO,
- centralized identity,
- mobile/native ecosystem,
- microservice architecture.

A strong architectural rule:

```text
If you already have central IdP/SSO,
prefer passkey support at IdP layer,
not duplicated passkey implementation in every application.
```

Unless application has local high-assurance credential requirement.

---

## 13. Java 8–25 Relevance

### 13.1 Java 8

Java 8 applications can support WebAuthn, but constraints are common:

- older servlet containers,
- older TLS defaults,
- older JSON/CBOR libraries,
- older dependency versions,
- limited modern crypto algorithm support depending provider,
- legacy session architecture.

Recommendation:

```text
Use a mature WebAuthn library compatible with Java 8,
but isolate it behind an adapter to ease migration.
```

### 13.2 Java 11/17

Java 11/17 often provide better production baseline:

- modern TLS behavior,
- stronger library support,
- better runtime performance,
- better container deployment support,
- long-term support availability.

### 13.3 Java 21

Java 21 introduces modern runtime baseline many enterprise systems are adopting:

- virtual threads,
- improved performance,
- better container awareness,
- modern ecosystem compatibility.

For passkey backend, virtual threads do not change protocol semantics, but they can affect:

- context propagation,
- request handling model,
- blocking DB/Redis challenge store calls,
- audit logging pipeline.

### 13.4 Java 25

Java 25 matters for the broader authentication platform because of modern security/runtime evolution, including key material handling improvements and concurrency/context model maturity. For WebAuthn specifically, most heavy lifting still comes from browser/platform and library support, not JDK alone.

Practical rule:

```text
WebAuthn compatibility is more often constrained by browser/platform/library
than by Java language syntax.
```

---

## 14. Data Modeling for Production

### 14.1 Account Table

Do not overload passkey identity into account email.

```sql
CREATE TABLE app_user (
    id              BIGINT PRIMARY KEY,
    external_id     VARCHAR(64) NOT NULL UNIQUE,
    email           VARCHAR(320) NULL,
    status          VARCHAR(32) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL
);
```

### 14.2 Credential Table

```sql
CREATE TABLE passkey_credential (
    id                         BIGINT PRIMARY KEY,
    user_id                    BIGINT NOT NULL,
    credential_id_hash         VARBINARY(32) NOT NULL UNIQUE,
    credential_id              BLOB NOT NULL,
    public_key_cose            BLOB NOT NULL,
    signature_count            BIGINT NULL,
    user_handle                VARBINARY(128) NULL,
    aaguid                     VARCHAR(64) NULL,
    attestation_type           VARCHAR(64) NULL,
    backup_eligible            BOOLEAN NULL,
    backup_state               BOOLEAN NULL,
    discoverable               BOOLEAN NULL,
    transports_json            CLOB NULL,
    nickname                   VARCHAR(128) NULL,
    created_at                 TIMESTAMP NOT NULL,
    last_used_at               TIMESTAMP NULL,
    revoked_at                 TIMESTAMP NULL,
    revoked_reason             VARCHAR(256) NULL,
    created_ip_hash            VARBINARY(32) NULL,
    last_used_ip_hash          VARBINARY(32) NULL,
    version                    BIGINT NOT NULL
);
```

### 14.3 Audit Table

```sql
CREATE TABLE auth_event (
    id                  BIGINT PRIMARY KEY,
    event_type          VARCHAR(64) NOT NULL,
    user_id             BIGINT NULL,
    credential_ref      BIGINT NULL,
    outcome             VARCHAR(32) NOT NULL,
    failure_reason      VARCHAR(128) NULL,
    correlation_id      VARCHAR(128) NOT NULL,
    ip_hash             VARBINARY(32) NULL,
    user_agent_hash     VARBINARY(32) NULL,
    rp_id               VARCHAR(255) NULL,
    origin              VARCHAR(512) NULL,
    user_verified       BOOLEAN NULL,
    user_present        BOOLEAN NULL,
    risk_score          INTEGER NULL,
    created_at          TIMESTAMP NOT NULL
);
```

Event types:

```text
PASSKEY_REGISTRATION_STARTED
PASSKEY_REGISTRATION_SUCCEEDED
PASSKEY_REGISTRATION_FAILED
PASSKEY_AUTHENTICATION_STARTED
PASSKEY_AUTHENTICATION_SUCCEEDED
PASSKEY_AUTHENTICATION_FAILED
PASSKEY_REVOKED
PASSKEY_RENAMED
PASSKEY_RECOVERY_STARTED
PASSKEY_RECOVERY_SUCCEEDED
PASSKEY_RECOVERY_FAILED
```

---

## 15. Account Recovery: The Hardest Part

### 15.1 Why Recovery is Critical

Passkey login may be strong, but account recovery can weaken everything.

Bad design:

```text
Login requires passkey,
but recovery only requires email OTP.
```

Then effective account security becomes:

```text
security = email account security
```

### 15.2 Recovery Options

Possible recovery mechanisms:

1. Multiple registered passkeys.
2. Backup codes.
3. Verified email + cooldown + risk checks.
4. Support-assisted recovery.
5. Identity proofing.
6. Admin reset for enterprise account.
7. Recovery via IdP.
8. Hardware security key backup.
9. Device transfer flow.
10. Time-delayed recovery.

### 15.3 Recommended User Guidance

Encourage:

```text
Register at least two passkeys:
- one platform/synced passkey for convenience,
- one backup security key or second device for recovery.
```

### 15.4 Recovery Risk Model

Recovery should consider:

- account privilege,
- recent password/passkey changes,
- known device,
- geo/IP anomaly,
- email verification age,
- previous successful login method,
- support operator action,
- cooldown after recovery,
- notification to existing devices/sessions.

### 15.5 Recovery Invariant

```text
No recovery path may be materially weaker than the account's required assurance level.
```

For admin account:

```text
Do not allow single email OTP to replace hardware-bound passkey.
```

---

## 16. Passkey as First Factor vs Second Factor

### 16.1 First Factor Passwordless

Passkey as first factor:

```text
User authenticates only with passkey.
```

Usually requires:

- user verification required/preferred depending risk,
- session hardening,
- strong recovery,
- multiple passkeys encouraged,
- fallback carefully controlled.

### 16.2 Second Factor

Passkey/security key as second factor:

```text
Password succeeds,
then WebAuthn assertion required.
```

Useful for:

- gradual migration,
- high-risk roles,
- legacy compatibility,
- reducing phishing impact of password alone.

### 16.3 Step-Up Authentication

For sensitive action:

```text
User already has session,
but action requires fresh WebAuthn assertion.
```

Examples:

- change email,
- add bank account,
- approve payment,
- export sensitive data,
- add admin user,
- rotate API key,
- disable MFA/passkey.

Step-up invariant:

```text
Sensitive action should require recent proof,
not just old session continuity.
```

---

## 17. UX and Product Constraints That Affect Security

### 17.1 Enrollment Timing

Options:

1. During account creation.
2. After first password login.
3. After identity proofing.
4. During admin provisioning.
5. During step-up event.

Risk:

```text
If attacker controls first enrollment,
attacker can bind their own passkey to victim account.
```

So passkey enrollment requires a trustworthy authentication context.

### 17.2 Naming and Managing Passkeys

User needs UI to:

- list passkeys,
- rename passkeys,
- see last used time,
- revoke lost passkeys,
- add backup passkey,
- understand synced vs security key if relevant.

### 17.3 Fallback Messaging

Avoid making fallback path the obvious phishing target.

Bad:

```text
Cannot use passkey? Click here to receive email login link.
```

Better:

```text
Use recovery flow with risk-based checks, notifications, cooldown,
and privilege restrictions until account is re-secured.
```

### 17.4 Shared Devices

Shared devices create ambiguity:

- whose platform passkey is available?
- browser profile separation?
- OS account separation?
- remembered session conflict?

Enterprise apps should document supported shared-device behavior.

---

## 18. RP ID, Domain, and Deployment Architecture

### 18.1 RP ID Is a Long-Term Commitment

Choosing RP ID affects future:

- subdomain strategy,
- domain migration,
- SSO login domain,
- mobile app association,
- multi-tenant architecture,
- disaster recovery domain.

Example:

```text
RP ID: example.com
Origins allowed:
  https://app.example.com
  https://login.example.com
```

But you must ensure this matches spec and browser behavior.

### 18.2 Domain Migration Problem

If moving from:

```text
old.example.com
```

to:

```text
new.example.gov
```

existing credentials may not be usable if RP ID changes.

Migration needs:

- overlapping login period,
- re-enrollment flow,
- clear user communication,
- fallback strategy,
- audit and support plan.

### 18.3 Multi-Tenant RP ID

For SaaS:

```text
tenantA.example.com
tenantB.example.com
```

Need decision:

1. Shared RP ID: `example.com`
2. Tenant-specific RP ID: `tenantA.example.com`
3. Custom domain RP ID: `login.customer.com`

Trade-offs:

| Model | Pros | Cons |
|---|---|---|
| Shared RP ID | simpler credential reuse | tenant isolation risk if app logic weak |
| Tenant subdomain RP ID | stronger tenant boundary | more enrollment fragmentation |
| Custom domain | customer ownership | complex origin/RP validation |

### 18.4 Reverse Proxy and TLS Termination

Backend must know external origin correctly.

If app behind ALB/Nginx/API Gateway:

- validate forwarded headers safely,
- do not trust arbitrary `X-Forwarded-*`,
- configure allowed origins explicitly,
- ensure HTTPS external origin.

Bad:

```java
String origin = request.getHeader("Origin");
if (origin.endsWith("example.com")) allow();
```

Better:

```text
Allowed origins are explicit configuration per environment/tenant.
```

---

## 19. Security Failure Modes

### 19.1 Challenge Replay

Cause:

- challenge reusable,
- challenge not consumed atomically,
- expiry too long,
- challenge not bound to purpose.

Mitigation:

- random challenge,
- TTL,
- consume-once,
- purpose binding,
- user/session binding.

### 19.2 Origin Validation Bug

Cause:

- wildcard origin,
- suffix matching mistake,
- trusting Host header blindly,
- wrong proxy config.

Mitigation:

- explicit allowed origin list,
- environment-specific config,
- tenant-aware origin validation,
- security tests.

### 19.3 RP ID Misconfiguration

Cause:

- wrong RP ID for subdomain,
- migration without plan,
- staging/prod domain confusion,
- using localhost assumptions in prod.

Mitigation:

- RP ID decision record,
- environment isolation,
- automated config tests,
- rollout rehearsal.

### 19.4 Weak Enrollment Context

Cause:

- allow passkey registration after weak email link,
- no reauthentication before adding passkey,
- compromised session can add passkey.

Mitigation:

- require recent strong auth to add passkey,
- notify existing channels,
- step-up before credential management,
- cooldown for high-risk changes.

### 19.5 Account Recovery Bypass

Cause:

- email OTP recovery too easy,
- support can reset without strong proof,
- backup codes shown/stored poorly,
- social engineering.

Mitigation:

- risk-based recovery,
- support workflow controls,
- audit operator action,
- delayed recovery for privileged accounts,
- session revocation after recovery.

### 19.6 Session Hijack After Passkey Login

Passkey protects login ceremony. It does not protect a stolen app session.

Mitigation:

- secure cookie flags,
- session rotation,
- device/session management,
- CSRF defense,
- anomaly detection,
- step-up for sensitive actions.

### 19.7 Credential Cloning Signal Ignored

Some authenticators maintain signature counter. If counter decreases or behaves suspiciously, it may indicate cloned authenticator.

Modern synced passkeys can complicate counter interpretation.

Rule:

```text
Treat counter anomaly as risk signal,
not always automatic account lock.
```

### 19.8 Fallback Password Remains Active Forever

If passkey is introduced but password remains available with weak MFA, attacker will attack password path.

Mitigation:

- risk-based disable password option,
- require passkey for high-risk login,
- progressively reduce password fallback,
- monitor fallback usage.

---

## 20. Threat Model

### 20.1 Attacker Has Password Database

With password auth:

```text
attacker can offline crack hashes
```

With passkey:

```text
attacker obtains public keys and credential IDs,
but cannot derive private keys
```

Still sensitive:

- account mapping,
- metadata,
- device info,
- audit events.

### 20.2 Attacker Has Phishing Site

With password:

```text
user can type password into phishing site
```

With passkey:

```text
credential is scoped to RP ID/origin;
browser/authenticator should not release valid assertion for attacker origin
```

Still possible:

- attacker tricks user into fallback path,
- attacker uses OAuth consent attack,
- attacker steals session after login,
- attacker compromises endpoint/browser.

### 20.3 Attacker Has User Device

Outcome depends on:

- local device lock strength,
- user verification required,
- biometric/PIN protection,
- OS account separation,
- credential sync provider,
- session already active.

Mitigation:

- UV required for sensitive accounts,
- session timeout,
- device/session revoke UI,
- step-up for sensitive actions.

### 20.4 Attacker Has Application Session

Passkey may not help if attacker steals session cookie.

Mitigation:

- bind high-risk action to fresh WebAuthn assertion,
- use session anomaly detection,
- rotate session after auth,
- protect browser from XSS,
- use HttpOnly/Secure/SameSite cookies.

### 20.5 Attacker Is Malicious Insider

Potential attacks:

- support resets account,
- DBA modifies credential binding,
- admin registers credential for user,
- audit deletion.

Mitigation:

- immutable audit logs,
- dual control for privileged recovery,
- DB constraints,
- credential registration notification,
- operator identity traceability.

---

## 21. Passkeys with OIDC and SSO

### 21.1 Best Place to Implement Passkeys

If you have central identity provider:

```text
Prefer implementing passkeys in IdP,
then applications consume OIDC/SAML result.
```

Why?

- central policy,
- consistent UX,
- fewer duplicate credential stores,
- unified recovery,
- unified audit,
- SSO benefits.

### 21.2 Application-Level Passkey Still Useful When

- app has local high-assurance step-up requirement,
- app supports offline/local auth,
- app has tenant-specific credential policy,
- IdP cannot support WebAuthn/passkey,
- app is itself the identity provider.

### 21.3 OIDC Claims After Passkey Login

If IdP uses passkey, application may receive claims like:

- `amr` indicating authentication method,
- `acr` indicating assurance level,
- `auth_time` indicating time of authentication.

Application can enforce:

```text
Sensitive operation requires auth_time within last 5 minutes
and amr/acr indicating strong auth/passkey.
```

But claim semantics vary by IdP. Do not assume every IdP maps passkey the same way.

---

## 22. Passkeys in Microservices Architecture

### 22.1 Edge Only

Passkey ceremony is user-facing and browser-bound. It usually happens at:

- web frontend + auth backend,
- BFF,
- identity provider,
- edge authentication service.

Downstream microservices should usually not run WebAuthn ceremony. They should receive:

- session-derived identity,
- access token,
- internal service token,
- signed principal context,
- audit actor metadata.

### 22.2 Propagating Authentication Strength

Downstream services may need to know:

```text
who authenticated?
how did they authenticate?
when did they authenticate?
was user verification performed?
was step-up performed?
```

Do not only propagate `userId`.

Propagate structured auth context:

```json
{
  "subject": "user-123",
  "auth_time": 1780000000,
  "methods": ["passkey"],
  "assurance": "high",
  "user_verified": true,
  "session_id": "opaque-session-ref",
  "actor_type": "human"
}
```

### 22.3 Async Processing

If a passkey-authenticated user triggers an async job:

```text
The job is not authenticated by the passkey.
The job is authorized by a recorded user intent/session/event.
```

Audit event should distinguish:

```text
initiated_by_user = user-123
executed_by_service = report-worker
initial_auth_method = passkey
initial_auth_time = ...
```

---

## 23. Implementation Sketch in Java

The exact API depends on library. The following is architectural pseudocode.

### 23.1 Start Registration

```java
public RegistrationStartResponse startRegistration(UserId userId, HttpRequestContext request) {
    User user = userRepository.requireActive(userId);

    requireRecentAuthentication(userId, Duration.ofMinutes(10));

    Challenge challenge = challengeService.create(
        ChallengePurpose.PASSKEY_REGISTRATION,
        userId,
        request.sessionId(),
        Duration.ofMinutes(5)
    );

    List<CredentialDescriptor> excludeCredentials = credentialRepository
        .findActiveByUserId(userId)
        .stream()
        .map(CredentialDescriptor::from)
        .toList();

    PublicKeyCredentialCreationOptions options = webAuthnRelyingParty.startRegistration(
        user.toWebAuthnUserIdentity(),
        challenge.value(),
        excludeCredentials,
        RegistrationPolicy.defaultPolicy()
    );

    audit.record(AuthEvent.registrationStarted(userId, request));

    return RegistrationStartResponse.from(options, challenge.id());
}
```

### 23.2 Finish Registration

```java
public void finishRegistration(
    UserId userId,
    String challengeId,
    RegistrationResponse response,
    HttpRequestContext request
) {
    Challenge challenge = challengeService.consume(
        challengeId,
        ChallengePurpose.PASSKEY_REGISTRATION,
        userId,
        request.sessionId()
    );

    RegistrationVerificationResult result = webAuthnRelyingParty.finishRegistration(
        challenge.value(),
        response,
        OriginPolicy.forEnvironment(request.environment())
    );

    credentialRepository.insert(new PasskeyCredential(
        userId,
        result.credentialId(),
        result.publicKeyCose(),
        result.signatureCount(),
        result.aaguid(),
        result.backupEligibility(),
        result.backupState(),
        result.transports()
    ));

    audit.record(AuthEvent.registrationSucceeded(userId, result, request));

    notificationService.notifyPasskeyAdded(userId, result.displayMetadata());
}
```

### 23.3 Start Authentication

```java
public AuthenticationStartResponse startAuthentication(
    Optional<String> username,
    HttpRequestContext request
) {
    Optional<User> user = username.flatMap(userRepository::findLoginCandidate);

    Challenge challenge = challengeService.create(
        ChallengePurpose.PASSKEY_AUTHENTICATION,
        user.map(User::id).orElse(null),
        request.anonymousSessionId(),
        Duration.ofMinutes(5)
    );

    List<CredentialDescriptor> allowCredentials = user
        .map(u -> credentialRepository.findActiveByUserId(u.id()))
        .orElse(List.of())
        .stream()
        .map(CredentialDescriptor::from)
        .toList();

    PublicKeyCredentialRequestOptions options = webAuthnRelyingParty.startAuthentication(
        challenge.value(),
        allowCredentials,
        AuthenticationPolicy.defaultPolicy()
    );

    audit.record(AuthEvent.authenticationStarted(user.map(User::id).orElse(null), request));

    return AuthenticationStartResponse.from(options, challenge.id());
}
```

### 23.4 Finish Authentication

```java
public LoginResult finishAuthentication(
    String challengeId,
    AuthenticationResponse response,
    HttpRequestContext request
) {
    Challenge challenge = challengeService.consume(
        challengeId,
        ChallengePurpose.PASSKEY_AUTHENTICATION,
        null,
        request.anonymousSessionId()
    );

    PasskeyCredential credential = credentialRepository
        .findActiveByCredentialId(response.credentialId())
        .orElseThrow(() -> new AuthenticationFailedException("Unknown credential"));

    User user = userRepository.requireActive(credential.userId());

    AssertionVerificationResult result = webAuthnRelyingParty.finishAuthentication(
        challenge.value(),
        response,
        credential.toRegisteredCredential(),
        OriginPolicy.forEnvironment(request.environment())
    );

    credentialRepository.updateAfterSuccessfulUse(
        credential.id(),
        result.newSignatureCount(),
        request.now()
    );

    Session session = sessionService.createAuthenticatedSession(
        user.id(),
        AuthMethod.PASSKEY,
        result.userVerified(),
        request
    );

    audit.record(AuthEvent.authenticationSucceeded(user.id(), credential.id(), result, request));

    return LoginResult.sessionCreated(session);
}
```

Important: real libraries have precise types and validation APIs. Treat this as architectural structure, not copy-paste code.

---

## 24. Testing Strategy

### 24.1 Unit Tests

Test:

- challenge generation entropy shape,
- challenge expiry,
- consume-once behavior,
- user binding,
- purpose binding,
- credential repository uniqueness,
- revocation behavior,
- policy decisions.

### 24.2 Integration Tests

Test with library-generated fixtures or browser automation:

- successful registration,
- successful authentication,
- wrong challenge,
- expired challenge,
- reused challenge,
- wrong origin,
- wrong RP ID,
- revoked credential,
- disabled account,
- missing UV when required,
- duplicate credential.

### 24.3 Browser Tests

Use browser automation where possible for end-to-end UX:

- Chrome/Edge/Safari/Firefox support matrix,
- platform authenticator behavior,
- conditional UI/usernameless login,
- mobile browser behavior,
- cross-device passkey behavior.

### 24.4 Security Regression Tests

Keep explicit tests for previous bugs:

```text
- staging origin accepted in production
- challenge reused after failure
- add passkey without recent auth
- revoked credential still accepted
- user handle maps to wrong user
- wildcard subdomain accepted unexpectedly
```

---

## 25. Observability and Audit

### 25.1 What to Log

Log events, not secrets.

Good fields:

- event type,
- user ID internal,
- credential internal ID,
- outcome,
- failure reason category,
- correlation ID,
- origin,
- RP ID,
- user verification result,
- user presence result,
- IP hash,
- user-agent hash,
- risk score,
- timestamp.

Do not log:

- raw challenge,
- raw credential ID if avoidable,
- raw clientDataJSON,
- raw attestation object,
- biometric data nonexistent anyway,
- session token,
- cookies.

### 25.2 Metrics

Useful metrics:

```text
passkey.registration.started.count
passkey.registration.success.count
passkey.registration.failure.count
passkey.authentication.started.count
passkey.authentication.success.count
passkey.authentication.failure.count
passkey.challenge.expired.count
passkey.challenge.reused.count
passkey.origin.invalid.count
passkey.rp_id.invalid.count
passkey.uv.missing.count
passkey.recovery.started.count
passkey.recovery.success.count
```

### 25.3 Alerting

Alert on:

- spike in failed assertions,
- invalid origin attempts,
- challenge replay attempts,
- recovery spike,
- passkey removal spike,
- admin passkey registration outside expected flow,
- many accounts adding credential from same IP/device pattern.

---

## 26. Performance and Scalability

### 26.1 Cost Profile

Passkey login costs:

- challenge store read/write,
- CBOR/JSON parse,
- signature verification,
- DB credential lookup,
- session creation,
- audit event write.

Usually cheaper than password hashing.

### 26.2 Hot Path Optimization

Optimize:

- credential ID hash lookup,
- short TTL challenge store,
- Redis/DB atomic consume,
- avoid logging large binary payload,
- async audit with durability guarantees if possible,
- JWKS/OIDC integration if IdP-based.

### 26.3 Login Storm

During outage/recovery, many users may retry login.

Protection:

- rate limit start endpoints,
- rate limit finish failures,
- challenge issuance quota,
- per-account and per-IP controls,
- circuit breaker for downstream DB/audit if needed.

---

## 27. Deployment and Environment Strategy

### 27.1 Local Development

Localhost is special in browser security. Development WebAuthn may work on localhost, but do not generalize local behavior to production.

Have explicit configs:

```yaml
webauthn:
  rp-id: localhost
  allowed-origins:
    - http://localhost:3000
    - http://localhost:8080
```

Production:

```yaml
webauthn:
  rp-id: example.com
  allowed-origins:
    - https://app.example.com
    - https://login.example.com
```

### 27.2 Staging vs Production

Never allow staging origin in production verifier.

Bad:

```text
allowedOrigins = ["*"]
```

Good:

```text
allowedOrigins are explicit, immutable per environment, reviewed during deployment.
```

### 27.3 Blue/Green Deployment

Credential validation must work across deployments.

Ensure:

- same RP ID,
- same allowed origins,
- shared credential store,
- shared challenge store or sticky ceremony strategy,
- compatible library versions,
- compatible serialization format.

---

## 28. Common Mistakes

### Mistake 1 — Treating Passkey as Just Another MFA Code

Passkey is not OTP. It is public-key challenge-response bound to RP/origin.

### Mistake 2 — Not Binding Challenge to Purpose

Registration challenge should not be usable for authentication.

### Mistake 3 — Wildcard Origin Validation

Origin validation must be strict.

### Mistake 4 — Weak Recovery Path

Strong login with weak recovery is weak authentication.

### Mistake 5 — Allowing Credential Add Without Step-Up

Adding a passkey is account takeover-sensitive.

### Mistake 6 — Ignoring Domain Migration

RP ID is not a cosmetic config.

### Mistake 7 — Implementing CBOR/COSE Parsing Manually

Use mature library unless you have strong reason.

### Mistake 8 — Storing Email as User Handle

Use opaque stable user handle.

### Mistake 9 — Assuming Passkey Solves Authorization

Authentication success does not imply permission.

### Mistake 10 — No Audit Trail

Without audit, support and incident response become guesswork.

---

## 29. Decision Framework

### 29.1 Should We Add Passkeys?

Use passkeys when:

- phishing resistance matters,
- password reset burden is high,
- user experience matters,
- high-value accounts exist,
- modern browser/platform support is acceptable,
- recovery can be designed safely.

Be careful when:

- user base has old devices/browsers,
- shared terminals dominate,
- domain migration is imminent,
- support team cannot handle recovery,
- IdP already owns authentication and cannot support passkeys yet.

### 29.2 Where Should Passkeys Live?

| Situation | Recommended Location |
|---|---|
| Central SSO exists | IdP/auth server |
| Single Java app | App/BFF backend |
| Multi-app enterprise | IdP |
| High-risk action only | App-level step-up |
| Consumer SaaS | IdP or dedicated auth service |
| Admin console | IdP + hardware key policy or app step-up |

### 29.3 What Policy Should We Use?

| Account Type | Suggested Policy |
|---|---|
| Normal consumer | synced passkey allowed, UV preferred/required depending risk |
| Employee internal | passkey via managed IdP, UV required |
| Admin/privileged | hardware/security key or managed credential, UV required, attestation possibly required |
| Service account | not passkey; use client credentials/mTLS/private key JWT |
| Batch job | not passkey; use workload identity |

---

## 30. Production Checklist

### Protocol

- [ ] Strong random challenge.
- [ ] Challenge TTL.
- [ ] Atomic consume-once.
- [ ] Challenge purpose binding.
- [ ] User/session binding where appropriate.
- [ ] Strict origin validation.
- [ ] Correct RP ID.
- [ ] Signature verification via mature library.
- [ ] UV/UP policy enforced.
- [ ] Credential revocation enforced.

### Data

- [ ] Stable opaque user handle.
- [ ] Unique credential ID mapping.
- [ ] Public key stored safely.
- [ ] Sign counter stored if applicable.
- [ ] Credential metadata captured.
- [ ] Audit event model implemented.
- [ ] No secrets/binary payloads logged.

### UX / Lifecycle

- [ ] Add passkey requires recent authentication.
- [ ] User can list passkeys.
- [ ] User can rename passkeys.
- [ ] User can revoke passkeys.
- [ ] User encouraged to add backup passkey.
- [ ] Recovery flow designed.
- [ ] Notification on credential add/remove.

### Architecture

- [ ] Clear decision: app-level vs IdP-level passkey.
- [ ] Session/token created only after verification.
- [ ] Step-up available for sensitive actions.
- [ ] Domain/RP ID strategy documented.
- [ ] Staging/prod origins separated.
- [ ] Reverse proxy headers handled safely.

### Operations

- [ ] Metrics for success/failure.
- [ ] Alert on anomaly.
- [ ] Support playbook.
- [ ] Recovery playbook.
- [ ] Incident response procedure.
- [ ] Browser/platform compatibility tested.

---

## 31. Design Questions for Senior Review

Use these questions in architecture review:

1. What is the RP ID and why was it chosen?
2. What origins are allowed in each environment?
3. Where are challenges stored and how are they consumed atomically?
4. Is registration bound to a strong enough existing authentication context?
5. Is adding/removing passkey treated as sensitive account operation?
6. Is user handle stable and non-PII?
7. Are credential IDs unique globally?
8. Is user verification required for the right accounts/actions?
9. What happens if user loses all passkeys?
10. Can support recover an account? Under what controls?
11. Is recovery weaker than login?
12. What audit events prove who added a passkey and when?
13. Does logout/session invalidation work after passkey login?
14. Is step-up available for high-risk actions?
15. What happens during domain migration?
16. Are staging credentials isolated from production?
17. Are passkeys implemented in app or IdP, and why?
18. Can downstream services know authentication strength?
19. Are fallback password/OTP flows still attackable?
20. How is suspicious sign counter behavior handled?

---

## 32. Summary

Passkey/WebAuthn authentication is a major shift from shared-secret authentication to public-key proof-of-possession.

The most important mental models:

1. Server stores public key, not password.
2. Authenticator signs server challenge with private key.
3. Browser/platform binds credential use to RP/origin.
4. User verification happens locally, not on server.
5. Registration binds account to credential.
6. Authentication proves possession of that credential.
7. Challenge lifecycle is security-critical.
8. RP ID and origin validation are non-negotiable.
9. Recovery can become the weakest link.
10. Passkey protects login, not automatically session, authorization, or recovery.

Top 1% engineering view:

```text
Do not evaluate passkeys only as a login feature.
Evaluate them as an identity credential lifecycle system:
registration, authentication, recovery, revocation, audit, policy,
deployment, domain strategy, and downstream identity propagation.
```

---

## 33. References

- W3C, **Web Authentication: An API for accessing Public Key Credentials Level 3**. https://www.w3.org/TR/webauthn-3/
- W3C, **Web Authentication Level 2**. https://www.w3.org/TR/webauthn-2/
- FIDO Alliance, **Passkeys**. https://fidoalliance.org/passkeys/
- FIDO Alliance, **User Authentication Specifications Overview**. https://fidoalliance.org/specifications/
- OWASP, **Authentication Cheat Sheet**. https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP, **Multifactor Authentication Cheat Sheet**. https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- Yubico, **java-webauthn-server**. https://developers.yubico.com/java-webauthn-server/
- Yubico, **WebAuthn Server Overview**. https://developers.yubico.com/WebAuthn/WebAuthn_Developer_Guide/WebAuthn_Server_Overview.html
- Spring Security Reference, **Servlet Authentication Architecture**. https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html
- OpenID Connect Core 1.0. https://openid.net/specs/openid-connect-core-1_0.html

---

## 34. Status Series

Part ini adalah **Part 20**.

Status:

```text
Part 0  selesai
Part 1  selesai
Part 2  selesai
Part 3  selesai
Part 4  selesai
Part 5  selesai
Part 6  selesai
Part 7  selesai
Part 8  selesai
Part 9  selesai
Part 10 selesai
Part 11 selesai
Part 12 selesai
Part 13 selesai
Part 14 selesai
Part 15 selesai
Part 16 selesai
Part 17 selesai
Part 18 selesai
Part 19 selesai
Part 20 selesai
Series belum selesai
```

Berikutnya:

```text
Part 21 — Multi-Factor Authentication and Step-Up Authentication
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-019.md">⬅️ Part 19 — Mutual TLS Authentication</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-021.md">Part 21 — Multi-Factor Authentication and Step-Up Authentication ➡️</a>
</div>
