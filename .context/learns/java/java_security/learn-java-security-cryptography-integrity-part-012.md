# learn-java-security-cryptography-integrity-part-012

# Java KeyStore, TrustStore, Certificates, and Private Key Custody

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `012` dari `034`  
> Status seri: **belum selesai**  
> Fokus part ini: memahami bagaimana Java menyimpan, membaca, memilih, memverifikasi, dan mengoperasikan key/certificate secara aman melalui `KeyStore`, truststore, `keytool`, JSSE, dan pola custody private key.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas key management secara umum: lifecycle, rotation, wrapping, KMS, HSM, dan blast radius. Sekarang kita turun ke lapisan yang sangat sering dipakai di Java production system:

1. **Java KeyStore**: container logical untuk key, certificate, secret, dan trust anchor.
2. **TrustStore**: keystore yang digunakan sebagai basis keputusan trust.
3. **Certificate chain**: bagaimana public key diikat ke identity oleh CA.
4. **Private key custody**: bagaimana private key tidak bocor, tidak salah pakai, tidak salah rotasi, dan tidak tersebar tanpa kontrol.
5. **JSSE integration**: bagaimana key/trust material dipakai untuk TLS dan mTLS.
6. **Operational workflow**: `keytool`, CSR, import, export, alias, password, rotation, expiry monitoring, dan incident handling.

Tujuan akhirnya bukan sekadar bisa menjalankan command seperti:

```bash
keytool -list -v -keystore app.p12
```

Tetapi bisa menjawab pertanyaan arsitektural berikut:

- “Di sistem ini, siapa yang memegang private key?”
- “Trust decision dibuat berdasarkan CA mana?”
- “Apakah certificate chain lengkap?”
- “Apakah private key untuk TLS sama dengan private key untuk signing data?”
- “Kalau certificate expired malam ini, service mana yang mati?”
- “Kalau private key bocor, apa blast radius dan recovery path-nya?”
- “Apakah keystore file adalah storage yang cukup, atau kita perlu KMS/HSM?”
- “Apakah application code membaca truststore yang benar, atau diam-diam memakai default `cacerts`?”
- “Apakah mTLS client certificate dipetakan ke identity secara defensible?”

Part ini penting karena banyak incident security Java tidak terjadi di algorithm crypto, tetapi di **pengelolaan trust material**: salah truststore, salah alias, self-signed certificate yang dimasukkan ke semua JVM, private key disimpan di repo, certificate expired, mTLS menerima client certificate tanpa authorization mapping, atau keystore lama masih dipakai setelah rotasi.

---

## 1. Mental Model Utama

### 1.1 KeyStore adalah container, bukan otomatis trust boundary

`KeyStore` di Java adalah abstraksi container. Ia bisa berisi:

- private key + certificate chain,
- secret key,
- trusted certificate,
- metadata seperti alias,
- entry protection.

Tetapi `KeyStore` sendiri tidak berarti “aman secara operasional”. Keamanan bergantung pada:

- tipe keystore,
- password protection,
- file permission,
- lokasi penyimpanan,
- akses runtime,
- backup,
- rotation process,
- audit trail,
- apakah key bisa diekstrak,
- siapa yang bisa membaca/memodifikasi file,
- apakah password disimpan berdekatan dengan keystore.

Jangan berpikir:

> “Sudah di keystore, berarti aman.”

Berpikir yang benar:

> “Keystore adalah packaging format. Custody model tetap harus dirancang.”

---

### 1.2 TrustStore adalah policy input untuk trust decision

Truststore biasanya juga memakai format `KeyStore`, tetapi fungsinya berbeda.

Keystore biasa sering dipakai untuk **membuktikan identity kita**:

```text
Service A punya private key + certificate chain
→ Service A membuktikan diri saat TLS/mTLS/signature
```

Truststore dipakai untuk **memutuskan siapa yang kita percaya**:

```text
Service A punya truststore berisi trusted CA/certificate
→ Service A memverifikasi certificate lawan bicara
```

Jadi beda mental model-nya:

```text
Keystore  : "Ini identitas dan secret milik saya."
Truststore: "Ini pihak/CA yang saya percaya untuk memverifikasi orang lain."
```

Satu file bisa saja berisi keduanya, tetapi secara desain enterprise sebaiknya dipisah agar:

- blast radius lebih kecil,
- ownership lebih jelas,
- rotation lebih aman,
- permission bisa dibedakan,
- audit lebih mudah,
- tidak terjadi accidental trust expansion.

---

### 1.3 Certificate bukan identity final; certificate adalah binding claim

Certificate X.509 mengikat:

```text
Subject / SAN / identity attribute
        ↕ signed by issuer
Public key
```

Certificate bukan “orangnya” atau “servicenya”. Certificate adalah dokumen kriptografis yang menyatakan:

> “Issuer ini menyatakan bahwa public key ini terikat ke identity tertentu, dengan validity dan usage tertentu.”

Maka ketika Java menerima certificate dari peer, pertanyaannya bukan hanya:

- “Apakah signature chain valid?”

Tetapi juga:

- “Apakah certificate ini masih berlaku?”
- “Apakah chain-nya menuju trust anchor yang saya percaya?”
- “Apakah key usage sesuai?”
- “Apakah hostname/SAN cocok?”
- “Apakah certificate ini revoked?”
- “Apakah certificate ini boleh dipakai untuk client authentication/server authentication?”
- “Apakah identity di certificate ini dipetakan ke principal/role/tenant yang benar?”

---

### 1.4 Private key custody adalah kontrol atas kemampuan bertindak

Private key bukan sekadar file rahasia. Private key adalah **capability**.

Siapa pun yang memegang private key dapat melakukan tindakan sesuai usage key tersebut:

| Jenis private key | Kemampuan jika bocor |
|---|---|
| TLS server key | Meniru server dalam kondisi tertentu, terutama jika chain/trust mendukung |
| mTLS client key | Mengakses service lain sebagai client sah |
| JWT signing key | Menerbitkan token palsu |
| Document signing key | Membuat dokumen terlihat sah |
| Audit signing key | Memalsukan evidence integrity |
| Code signing key | Mendistribusikan artifact terlihat trusted |
| CA private key | Menerbitkan certificate untuk identity lain |

Karena itu prinsipnya:

```text
Private key custody = governance atas aksi kriptografis.
```

Kalau private key bocor, masalahnya bukan hanya confidentiality. Masalahnya adalah **authority compromise**.

---

## 2. Vocabulary Penting

### 2.1 Key pair

Pasangan asymmetric key:

```text
Private key: disimpan rahasia, dipakai untuk sign/decrypt/key agreement depending algorithm.
Public key : boleh dibagikan, dipakai untuk verify/encrypt/key agreement depending algorithm.
```

Dalam TLS server authentication, server membuktikan ia memegang private key yang cocok dengan public key di certificate.

---

### 2.2 Certificate

Certificate adalah struktur data yang berisi public key dan identity claim, ditandatangani oleh issuer.

Field penting:

- subject,
- issuer,
- serial number,
- validity period,
- public key,
- signature algorithm,
- SAN,
- key usage,
- extended key usage,
- basic constraints,
- authority key identifier,
- subject key identifier,
- CRL distribution points,
- OCSP authority information access.

---

### 2.3 Certificate chain

Rantai certificate biasanya:

```text
Leaf certificate
  signed by Intermediate CA
    signed by Root CA
      trusted as trust anchor
```

Leaf certificate adalah certificate milik server/client/app. Intermediate CA biasanya harus dikirim bersama leaf certificate saat handshake. Root CA biasanya sudah ada di truststore pihak verifier.

Kesalahan umum:

- hanya meng-install leaf certificate tanpa intermediate,
- chain order salah,
- memasukkan leaf certificate lawan ke truststore padahal seharusnya trust CA,
- root CA ikut dikirim padahal tidak perlu,
- certificate chain valid secara kriptografis tapi tidak sesuai hostname/SAN,
- memakai certificate dengan wrong extended key usage.

---

### 2.4 Trust anchor

Trust anchor adalah certificate/public key yang dipercaya secara langsung oleh verifier. Biasanya Root CA.

Trust anchor tidak “terbukti” oleh chain. Ia dipercaya karena policy/konfigurasi.

Inilah alasan truststore sangat sensitif:

```text
Menambahkan trust anchor = memperluas siapa yang bisa dipercaya sistem.
```

---

### 2.5 Keystore

Container yang menyimpan entry seperti:

- `PrivateKeyEntry`,
- `SecretKeyEntry`,
- `TrustedCertificateEntry`.

Di Java, ini diakses melalui `java.security.KeyStore`.

---

### 2.6 Truststore

Keystore yang dipakai oleh trust manager/cert path validation untuk menentukan certificate mana yang dipercaya.

Secara teknis bisa sama format dengan keystore, tetapi secara fungsi berbeda.

---

### 2.7 Alias

Alias adalah nama entry dalam keystore.

Contoh:

```text
tls-server-2026q1
mtls-client-payment-prod-2026
jwt-signing-v3
ca-internal-root-2025
```

Alias bukan security boundary. Alias adalah identifier operational. Namun alias yang buruk menyebabkan outage dan salah key.

Anti-pattern:

```text
mykey
server
1
test
prod
old
```

Alias yang baik harus membantu operator memahami:

- purpose,
- environment,
- rotation generation,
- owner/service,
- validity/epoch.

---

### 2.8 Key usage dan extended key usage

`KeyUsage` membatasi penggunaan cryptographic key, misalnya:

- digital signature,
- key encipherment,
- key agreement,
- certificate signing,
- CRL signing.

`ExtendedKeyUsage` membatasi konteks aplikasi, misalnya:

- server authentication,
- client authentication,
- code signing,
- email protection.

Sertifikat untuk TLS server idealnya punya EKU server auth. Sertifikat untuk mTLS client idealnya punya EKU client auth. Jangan memakai certificate “apa saja yang valid” tanpa mengecek usage.

---

## 3. Java KeyStore Architecture

### 3.1 `java.security.KeyStore`

`KeyStore` adalah API utama untuk membaca/menulis key dan certificate entry.

Model sederhana:

```java
KeyStore keyStore = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("app.p12"))) {
    keyStore.load(in, storePassword);
}

Key key = keyStore.getKey("tls-server-2026q1", keyPassword);
Certificate[] chain = keyStore.getCertificateChain("tls-server-2026q1");
```

Yang perlu dipahami:

1. `KeyStore.getInstance(type)` memilih format/provider.
2. `load(...)` membaca isi ke memory.
3. Password store bisa berbeda dari password private key entry.
4. Alias harus dipilih eksplisit.
5. `KeyStore` object di memory bukan berarti key tidak bisa terekspose.
6. Setelah key diambil sebagai object Java, ia mungkin bisa muncul di heap dump tergantung provider/implementation.

---

### 3.2 Jenis entry

#### 3.2.1 `PrivateKeyEntry`

Berisi:

```text
Private key
Certificate chain untuk public key-nya
```

Dipakai untuk:

- TLS server identity,
- mTLS client identity,
- signing payload,
- signing document,
- signing token,
- code signing.

Risiko utama:

- private key extraction,
- salah alias,
- password leak,
- key reuse lintas purpose,
- certificate expired,
- chain tidak lengkap,
- private key tidak cocok dengan certificate.

---

#### 3.2.2 `SecretKeyEntry`

Berisi symmetric key, misalnya AES key atau HMAC key.

Dipakai untuk:

- encryption,
- MAC,
- local token signing,
- legacy integration.

Risiko utama:

- symmetric key jika bocor memungkinkan decrypt/sign/verify tergantung penggunaan,
- key sulit dirotasi bila tidak ada key id/version,
- key di file biasa sering diekspor dan disalin tanpa audit,
- secret key tidak punya public certificate chain untuk identity.

---

#### 3.2.3 `TrustedCertificateEntry`

Berisi certificate yang dipercaya.

Dipakai di truststore.

Risiko utama:

- terlalu banyak trusted CA,
- memasukkan certificate yang tidak seharusnya trusted,
- truststore shared global antar app,
- expired/weak CA masih trusted,
- default `cacerts` dipakai untuk internal trust tanpa governance.

---

## 4. Keystore Type: JKS, PKCS12, PKCS11, JCEKS, BCFKS

### 4.1 JKS

JKS adalah format lama Java KeyStore.

Karakteristik:

- historical Java-specific,
- banyak legacy system masih pakai,
- kompatibilitas Java lama baik,
- bukan pilihan modern utama untuk portability.

Masalah:

- sering dipakai karena default lama,
- orang sering tidak tahu proteksi formatnya,
- tooling non-Java kurang natural,
- private key import/export workflow terbatas dibanding PKCS#12.

Rekomendasi praktis:

```text
Untuk sistem modern, gunakan PKCS12 kecuali ada constraint legacy kuat.
```

---

### 4.2 PKCS12 / `.p12` / `.pfx`

PKCS#12 adalah format portable untuk menyimpan private key dan certificate.

Karakteristik:

- umum di Java dan non-Java,
- dapat berisi private key + certificate chain,
- cocok untuk TLS/mTLS identity,
- umum dipakai dengan OpenSSL, browsers, enterprise PKI.

Contoh:

```bash
keytool -genkeypair \
  -alias api-prod-2026q1 \
  -keyalg RSA \
  -keysize 3072 \
  -sigalg SHA384withRSA \
  -validity 397 \
  -storetype PKCS12 \
  -keystore api-prod-2026q1.p12
```

Catatan:

- Jangan menganggap `.p12` aman hanya karena ada password.
- Password `.p12` sering menjadi weak link.
- File `.p12` harus diperlakukan sebagai secret high-value.
- Untuk key high-value, prefer non-exportable key di HSM/KMS/PKCS#11.

---

### 4.3 PKCS11

PKCS#11 bukan file keystore biasa. Ini interface ke token/HSM/smart card.

Mental model:

```text
Key tidak harus keluar dari hardware/security module.
Java meminta operasi crypto; module melakukan operasi.
```

Cocok untuk:

- signing key high-value,
- code signing,
- CA key,
- audit signing key,
- regulated environment,
- key yang harus non-exportable.

Trade-off:

- deployment lebih kompleks,
- latency operasi crypto bisa lebih tinggi,
- concurrency/session management perlu dipahami,
- provider config lebih sulit,
- testing lokal lebih rumit,
- failure mode bergeser ke HSM availability/quota/policy.

---

### 4.4 JCEKS

JCEKS adalah format lama yang sering dipakai untuk secret key.

Untuk sistem modern, jangan otomatis memilih JCEKS. Evaluasi:

- apakah provider masih sesuai,
- apakah compliance mengizinkan,
- apakah ada replacement lebih baik,
- apakah secret key seharusnya disimpan di KMS/Secret Manager/HSM.

---

### 4.5 BCFKS

BCFKS adalah Bouncy Castle FIPS KeyStore format, relevan jika menggunakan Bouncy Castle/FIPS environment.

Gunakan hanya jika:

- organisasi memang memilih BC provider,
- ada requirement FIPS/provider tertentu,
- operational tooling dan runtime sudah disiapkan.

Jangan memakai provider tambahan hanya karena terlihat “lebih crypto”. Provider tambahan berarti:

- dependency baru,
- patching baru,
- compatibility baru,
- compliance story baru,
- production support baru.

---

## 5. Keystore vs Truststore: Jangan Dicampur Secara Mental

### 5.1 Keystore untuk identity kita

Contoh service `case-api` perlu membuktikan dirinya ke upstream melalui mTLS.

Ia punya:

```text
case-api-client.p12
  alias: case-api-mtls-client-prod-2026q1
  private key
  certificate chain
```

Pada TLS handshake:

1. upstream meminta client certificate,
2. `case-api` memilih certificate/private key dari keystore,
3. `case-api` membuktikan possession private key,
4. upstream memverifikasi chain dan identity mapping.

---

### 5.2 Truststore untuk mempercayai pihak lain

`case-api` juga perlu memverifikasi certificate upstream.

Ia punya:

```text
case-api-truststore.p12
  alias: gov-internal-root-ca-2025
  alias: gov-intermediate-ca-2026
```

Pada TLS handshake:

1. upstream mengirim server certificate chain,
2. `case-api` memvalidasi chain terhadap truststore,
3. hostname verification dilakukan,
4. handshake hanya lanjut jika trust decision valid.

---

### 5.3 Kesalahan fatal: trust all

Anti-pattern paling berbahaya:

```java
TrustManager[] trustAll = new TrustManager[] {
    new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] chain, String authType) {}
        public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }
};
```

Ini menghancurkan TLS security karena aplikasi tidak lagi memverifikasi peer.

Kalau ada engineer berkata:

> “Ini cuma temporary untuk fix certificate error.”

Jawabannya:

> “Temporary trust bypass di production adalah security incident waiting to happen.”

Yang benar:

- perbaiki chain,
- perbaiki truststore,
- perbaiki hostname/SAN,
- perbaiki CA trust,
- perbaiki environment certificate,
- jangan disable verification.

---

## 6. JSSE: KeyManager dan TrustManager

### 6.1 `KeyManager`

`KeyManager` menentukan key material yang dipakai untuk membuktikan identity local side.

Pada TLS server:

```text
Server KeyManager memilih server certificate/private key.
```

Pada mTLS client:

```text
Client KeyManager memilih client certificate/private key.
```

API umum:

```java
KeyStore ks = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("client.p12"))) {
    ks.load(in, storePassword);
}

KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
kmf.init(ks, keyPassword);
```

Security concern:

- alias selection,
- multiple certificate entries,
- wrong certificate picked,
- expired certificate still selected,
- certificate not valid for purpose,
- key password exposed,
- keystore loaded from wrong path.

---

### 6.2 `TrustManager`

`TrustManager` memutuskan apakah peer certificate trusted.

API umum:

```java
KeyStore ts = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("truststore.p12"))) {
    ts.load(in, trustStorePassword);
}

TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
tmf.init(ts);
```

Security concern:

- wrong truststore,
- accidental default truststore,
- too broad trust anchor,
- custom trust manager bypassing validation,
- no revocation checking,
- hostname verification disabled elsewhere,
- expired root/intermediate still trusted depending chain behavior.

---

### 6.3 `SSLContext`

`SSLContext` menggabungkan key manager, trust manager, dan secure random.

```java
SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(kmf.getKeyManagers(), tmf.getTrustManagers(), SecureRandom.getInstanceStrong());
```

Catatan:

- `TLS` memilih protocol family; policy actual dipengaruhi JDK/security properties.
- Jangan hardcode `SSL` atau protocol lama.
- Konfigurasi cipher/protocol biasanya lebih baik dilakukan via library/framework config yang jelas, bukan custom socket low-level kecuali perlu.

---

## 7. Default Java TrustStore: `cacerts`

JDK/JRE biasanya menyediakan default truststore bernama `cacerts`, biasanya di lokasi seperti:

```text
$JAVA_HOME/lib/security/cacerts
```

Mental model:

```text
cacerts = trust anchor publik/default dari distribusi Java, bukan truststore internal organisasi.
```

Masalah yang sering terjadi:

1. App secara tidak sadar memakai `cacerts` untuk semua outbound HTTPS.
2. Engineer memasukkan internal CA ke global `cacerts` di image/container.
3. Semua app dalam image mendadak mempercayai CA internal yang tidak relevan.
4. Upgrade JDK mengganti truststore behavior.
5. Debug sulit karena trust source tidak eksplisit.

Rekomendasi enterprise:

- Untuk outbound internet umum, default truststore mungkin cukup jika policy mengizinkan.
- Untuk internal mTLS/service-to-service, gunakan truststore eksplisit per domain trust.
- Jangan modify global `cacerts` sembarangan.
- Build image harus jelas: truststore apa, di mana, untuk app apa.
- Gunakan observability untuk log fingerprint certificate/chain pada startup, tanpa log private material.

---

## 8. `keytool`: Utility Penting, Bukan Sekadar Command Hafalan

`keytool` adalah command-line tool untuk mengelola key dan certificate dalam keystore.

### 8.1 Melihat isi keystore

```bash
keytool -list -v \
  -keystore app.p12 \
  -storetype PKCS12
```

Yang harus dicek:

- alias,
- entry type,
- owner/issuer,
- serial number,
- validity,
- SAN,
- key usage,
- extended key usage,
- certificate fingerprint,
- chain length,
- signature algorithm,
- key algorithm dan size.

---

### 8.2 Generate key pair

```bash
keytool -genkeypair \
  -alias case-api-prod-2026q1 \
  -keyalg RSA \
  -keysize 3072 \
  -sigalg SHA384withRSA \
  -validity 397 \
  -storetype PKCS12 \
  -keystore case-api-prod-2026q1.p12
```

Catatan:

- Untuk production public TLS, certificate biasanya diterbitkan CA, bukan self-signed.
- Untuk internal PKI, CSR dikirim ke internal CA.
- Validity harus mengikuti policy CA/organization.
- Key algorithm/size harus mengikuti standard internal dan compliance.

---

### 8.3 Generate CSR

```bash
keytool -certreq \
  -alias case-api-prod-2026q1 \
  -file case-api-prod-2026q1.csr \
  -keystore case-api-prod-2026q1.p12 \
  -storetype PKCS12
```

CSR berisi:

- public key,
- subject info,
- requested extension tergantung command/config,
- signature oleh private key untuk membuktikan possession.

CSR tidak berisi private key.

---

### 8.4 Import certificate reply / chain

Setelah CA menerbitkan certificate, import chain.

```bash
keytool -importcert \
  -alias case-api-prod-2026q1 \
  -file case-api-prod-2026q1-chain.pem \
  -keystore case-api-prod-2026q1.p12 \
  -storetype PKCS12
```

Pastikan:

- alias sama dengan private key entry,
- chain lengkap,
- certificate cocok dengan private key,
- SAN benar,
- key usage benar,
- chain menuju CA yang dipercaya peer.

---

### 8.5 Import trusted certificate ke truststore

```bash
keytool -importcert \
  -alias gov-internal-root-ca-2025 \
  -file gov-internal-root-ca-2025.pem \
  -keystore case-api-truststore.p12 \
  -storetype PKCS12
```

Sebelum import:

- verifikasi fingerprint certificate lewat channel terpercaya,
- jangan download dari chat/email lalu langsung import,
- pastikan itu CA/certificate yang memang harus dipercaya,
- dokumentasikan reason dan owner.

Truststore update harus diperlakukan seperti security change.

---

### 8.6 Convert JKS ke PKCS12

```bash
keytool -importkeystore \
  -srckeystore legacy.jks \
  -srcstoretype JKS \
  -destkeystore modern.p12 \
  -deststoretype PKCS12
```

Checklist setelah convert:

- alias sama atau sengaja diganti,
- entry type benar,
- private key ada,
- chain length benar,
- app bisa load,
- password handling sudah diperbarui,
- old keystore dihapus/diarsip sesuai policy,
- tidak ada duplicate active key yang tidak terkontrol.

---

## 9. Password Protection: Store Password vs Key Password

### 9.1 Dua jenis password

Dalam banyak workflow, ada:

```text
Store password: melindungi integrity/confidentiality keystore file.
Key password  : melindungi private key entry.
```

Kadang keduanya sama karena tooling/framework. Namun secara mental harus dibedakan.

Risiko umum:

- password hardcoded di source,
- password disimpan di file sebelah keystore,
- password masuk command history,
- password muncul di process list,
- password masuk CI log,
- password dipakai ulang lintas environment,
- password terlalu lemah,
- password tidak dirotasi saat orang keluar tim,
- password dipakai untuk banyak keystore.

---

### 9.2 Keystore password bukan pengganti file permission

Keystore password membantu, tetapi jangan menjadikannya satu-satunya kontrol.

Layer yang dibutuhkan:

1. filesystem permission,
2. container secret mount permission,
3. OS user isolation,
4. secret manager access policy,
5. network boundary,
6. audit access,
7. password strength,
8. rotation,
9. backup protection,
10. heap dump/core dump control.

---

### 9.3 Jangan pass password lewat CLI argument kalau bisa dihindari

Command seperti ini berbahaya:

```bash
java -Djavax.net.ssl.keyStorePassword=SuperSecret ...
```

Risiko:

- terlihat di process list,
- masuk script repo,
- masuk logs/orchestrator events,
- terbaca oleh diagnostic dump,
- tersebar ke monitoring.

Lebih baik:

- secret file dengan permission ketat,
- environment variable hanya jika threat model mengizinkan,
- secret manager,
- Kubernetes secret volume dengan mode permission minimal,
- workload identity mengambil secret saat startup,
- framework secret integration.

Namun environment variable juga bukan magic. Ia bisa bocor lewat:

- process inspection,
- crash dump,
- debug endpoint,
- accidental logging,
- misconfigured runtime.

---

## 10. Loading Keystore di Java Secara Aman

### 10.1 Basic loading pattern

```java
public final class KeyStoreLoader {
    private KeyStoreLoader() {}

    public static KeyStore loadPkcs12(Path path, char[] password) throws GeneralSecurityException, IOException {
        Objects.requireNonNull(path, "path");
        Objects.requireNonNull(password, "password");

        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try (InputStream input = Files.newInputStream(path)) {
            keyStore.load(input, password);
        }
        return keyStore;
    }
}
```

Catatan:

- Pakai `char[]` untuk password, bukan `String`, agar bisa dihapus dari memory setelah dipakai.
- Meski begitu, jangan overclaim: `char[]` tidak menjamin password tidak pernah tersalin di memory oleh library/runtime.
- Jangan log path jika path mengandung sensitive env/tenant info.
- Jangan log exception lengkap jika bisa mengungkap secret config.

---

### 10.2 Clear password setelah dipakai

```java
char[] password = readPasswordFromSecretSource();
try {
    KeyStore ks = KeyStoreLoader.loadPkcs12(path, password);
    // use ks
} finally {
    Arrays.fill(password, '\0');
}
```

Ini hygiene, bukan silver bullet. Tujuannya mengurangi lifetime secret di memory.

---

### 10.3 Validasi alias saat startup

Jangan tunggu request production pertama gagal.

```java
public static void requirePrivateKeyEntry(KeyStore ks, String alias) throws GeneralSecurityException {
    if (!ks.containsAlias(alias)) {
        throw new KeyStoreException("Required key alias not found: " + alias);
    }
    if (!ks.entryInstanceOf(alias, KeyStore.PrivateKeyEntry.class)) {
        throw new KeyStoreException("Alias is not a PrivateKeyEntry: " + alias);
    }
}
```

Startup validation sebaiknya memeriksa:

- alias ada,
- entry type sesuai,
- certificate chain ada,
- certificate belum expired,
- certificate not-before sudah valid,
- key algorithm sesuai policy,
- key size sesuai policy,
- SAN/EKU sesuai purpose,
- fingerprint cocok dengan expected config jika diperlukan,
- expiry diekspos ke metrics.

---

### 10.4 Jangan membaca semua alias secara sembarangan

Keystore bisa berisi banyak entry. Jangan memilih “alias pertama”.

Anti-pattern:

```java
String alias = keyStore.aliases().nextElement();
```

Ini rapuh karena:

- order tidak boleh dijadikan kontrak,
- rotasi menambah alias baru,
- truststore bisa punya banyak certificate,
- wrong key bisa dipakai tanpa error eksplisit.

Gunakan alias eksplisit dari config yang tervalidasi.

---

## 11. Alias Strategy untuk Production

### 11.1 Alias harus menyimpan purpose, bukan rahasia

Contoh baik:

```text
aceas-case-api-tls-server-prod-2026q1
aceas-case-api-mtls-client-gateway-prod-2026q1
aceas-audit-signing-prod-v3
aceas-internal-root-ca-2025
```

Contoh buruk:

```text
server
client
prodkey
fajar
main
new
old
```

Alias baik menjawab:

- service apa,
- purpose apa,
- environment apa,
- generation/rotation apa,
- apakah server/client/signing/trust anchor.

---

### 11.2 Alias bukan tempat menyimpan secret

Jangan taruh informasi sensitif di alias:

```text
prod-db-password-key-supersecret
customer-123456789-identity-signing
```

Alias sering muncul di logs, error, metrics, command output, dan screenshots.

---

### 11.3 Alias untuk rotation

Gunakan version/generation:

```text
jwt-signing-prod-v1
jwt-signing-prod-v2
jwt-signing-prod-v3
```

Untuk TLS:

```text
case-api-tls-prod-2026q1
case-api-tls-prod-2026q2
```

Untuk trust CA:

```text
internal-root-ca-2025
internal-root-ca-2035
internal-intermediate-ca-2026q1
```

Namun jangan hanya mengandalkan alias. Payload/token/signature harus membawa key id bila perlu.

---

## 12. Certificate Chain Operational Model

### 12.1 Chain yang benar

Contoh:

```text
[0] Leaf: case-api.service.internal
[1] Intermediate: GovTech Internal Issuing CA 2026
[2] Root: GovTech Internal Root CA 2025
```

Dalam TLS, server biasanya mengirim leaf + intermediate. Root biasanya tidak perlu dikirim karena verifier sudah punya trust anchor.

---

### 12.2 Chain incomplete

Gejala:

```text
PKIX path building failed
unable to find valid certification path to requested target
```

Penyebab umum:

- intermediate tidak dikirim server,
- truststore tidak punya root CA,
- certificate chain salah order,
- certificate self-signed tidak trusted,
- truststore yang dipakai app bukan yang dikira,
- JDK disabled algorithm menolak chain.

Debug approach:

1. Ambil certificate chain dari server.
2. Periksa leaf SAN/expiry/EKU.
3. Periksa issuer leaf cocok subject intermediate.
4. Periksa issuer intermediate cocok subject root.
5. Periksa root ada di truststore.
6. Periksa disabled algorithms.
7. Periksa hostname verification.
8. Periksa app benar-benar memakai truststore yang dimaksud.

---

### 12.3 Chain valid tapi authorization salah

Dalam mTLS, certificate chain valid hanya berarti:

```text
Certificate berasal dari trust chain yang dipercaya.
```

Belum berarti:

```text
Client boleh melakukan operasi bisnis tertentu.
```

Contoh kegagalan:

```text
Semua service yang punya certificate dari internal CA otomatis dianggap admin.
```

Itu salah. mTLS authentication harus dilanjutkan dengan authorization mapping:

```text
SAN/CN/spiffe id/client cert attribute
  → service principal
  → allowed audience/resource/action
  → policy decision
```

---

## 13. Private Key Custody Model

### 13.1 Custody level

Kita bisa membagi custody menjadi beberapa level:

| Level | Model | Cocok untuk | Risiko |
|---|---|---|---|
| L0 | Private key hardcoded/source | Tidak boleh | Total compromise |
| L1 | Private key file di server | Legacy/internal low-risk | File theft, backup leak |
| L2 | Keystore file + secret manager password | Banyak app enterprise | Runtime host compromise |
| L3 | KMS/HSM exportable/imported key | Cloud-integrated | IAM/policy misuse |
| L4 | HSM/KMS non-exportable signing/decrypt | High-value key | Availability/latency dependency |
| L5 | Dedicated offline CA/cold key ceremony | Root CA/code signing very high value | Operational complexity |

Keystore file biasanya L1/L2. Untuk key high-value seperti CA, audit signing, JWT root signing, atau code signing, perlu mempertimbangkan L3-L5.

---

### 13.2 Private key harus punya purpose tunggal

Jangan pakai private key yang sama untuk:

- TLS server,
- JWT signing,
- document signing,
- audit signing,
- mTLS client.

Alasannya:

1. Different usage punya risk profile berbeda.
2. Rotation cycle berbeda.
3. Access policy berbeda.
4. Blast radius berbeda.
5. Audit requirement berbeda.
6. Algorithm/padding/extension requirement berbeda.
7. Incident response berbeda.

Prinsip:

```text
One key, one purpose, one owner, one rotation policy.
```

---

### 13.3 Private key tidak boleh berpindah tanpa trace

Setiap movement harus punya audit:

- generated where,
- exported by whom,
- imported where,
- stored where,
- backup where,
- accessed by which service,
- rotated when,
- retired when,
- destroyed when.

Kalau organisasi tidak bisa menjawab “di mana private key ini pernah berada?”, custody belum matang.

---

### 13.4 Backup private key adalah private key juga

Backup sering menjadi titik bocor.

Aturan:

- backup encrypted,
- access controlled,
- logged,
- tested recovery,
- expiry/retirement mengikuti key asli,
- jangan backup key yang seharusnya non-exportable,
- jangan membiarkan backup lama setelah rotation.

---

## 14. Deployment Pattern

### 14.1 Keystore baked into container image

Anti-pattern umum:

```text
Docker image berisi app.jar + prod.p12
```

Masalah:

- image registry menjadi private key storage,
- semua environment yang bisa pull image bisa dapat key,
- image layer menyimpan history,
- rotation butuh rebuild/redeploy image,
- scanning/logging bisa leak metadata,
- sulit revoke akses setelah image tersebar.

Biasanya tidak direkomendasikan untuk production key.

---

### 14.2 Keystore mounted as runtime secret

Lebih baik:

```text
Container image tidak berisi key.
Runtime mount /var/run/secrets/app/client.p12
Password dari secret manager/volume/env sesuai policy.
```

Checklist:

- mount read-only,
- file permission minimum,
- secret scoped per service,
- no shell/debug sidecar uncontrolled,
- no broad namespace secret read,
- rotation strategy jelas,
- restart/reload behavior jelas.

---

### 14.3 Keystore pulled at startup from secret manager

Pattern:

```text
App startup
  → authenticate with workload identity
  → fetch keystore + password/secret
  → load in memory
  → optionally write to tmpfs only
```

Kelebihan:

- centralized access policy,
- audit access,
- easier rotation,
- no secret in image,
- avoid Kubernetes secret sprawl.

Risiko:

- startup dependency pada secret manager,
- retry/backoff needed,
- cache invalidation,
- IAM misconfiguration,
- local memory exposure,
- incident if secret manager unavailable.

---

### 14.4 Non-exportable key via KMS/HSM

Pattern:

```text
App tidak membaca private key.
App mengirim digest/payload ke KMS/HSM signing API.
KMS/HSM mengembalikan signature.
```

Kelebihan:

- private key tidak keluar,
- audit per operation,
- policy enforced centrally,
- deletion/disable lebih tegas.

Trade-off:

- latency,
- rate limit,
- network dependency,
- cost,
- API integration,
- retry idempotency,
- canonicalization harus benar sebelum signing.

---

## 15. Rotation Model

### 15.1 Rotation TLS certificate

TLS certificate rotation relatif umum:

```text
Generate new keypair/CSR
→ CA issue new certificate
→ deploy new keystore
→ reload/restart service
→ verify handshake
→ remove old key after safe window
```

Checklist:

- SAN sama/benar,
- chain lengkap,
- key usage/EKU benar,
- not-before sudah aktif,
- not-after cukup,
- trust chain dipercaya client,
- deployment order aman,
- metrics expiry updated,
- old key retired.

---

### 15.2 Rotation mTLS client certificate

mTLS client certificate lebih tricky karena server perlu mempercayai identity client.

Flow:

```text
1. Server trust policy siap menerima new client cert identity.
2. Client deploy new cert/key.
3. Server logs observe new cert fingerprint/identity.
4. Old cert dicabut/di-remove setelah migration window.
```

Jika identity mapping berdasarkan SAN yang sama, rotation lebih mudah. Jika mapping berdasarkan fingerprint/serial, server policy harus diupdate.

---

### 15.3 Rotation truststore

Truststore rotation bisa berdampak besar.

Contoh:

```text
Root CA lama diganti root CA baru.
```

Safe rollout:

```text
Phase 1: truststore berisi old + new CA
Phase 2: certificate peer mulai diterbitkan oleh new CA
Phase 3: semua peer migrated
Phase 4: remove old CA
```

Jangan langsung remove old CA sebelum semua peer migrated.

---

### 15.4 Rotation signing key

Signing key rotation membutuhkan verification overlap.

Misalnya JWT signing:

```text
Signer mulai pakai key v2.
Verifier masih menerima v1 dan v2 sampai token v1 expired.
Setelah TTL selesai, verifier remove v1.
```

Pattern:

```text
active signing key: one
accepted verification keys: many during overlap
```

Payload harus membawa `kid` atau metadata version agar verifier memilih key yang benar.

---

## 16. Expiry Management

Certificate expiry adalah penyebab outage klasik.

### 16.1 Jangan hanya punya kalender manual

Minimal expose metrics:

```text
certificate_not_after_timestamp{alias="case-api-tls-prod-2026q1"}
certificate_days_until_expiry{alias="case-api-tls-prod-2026q1"}
```

Alert:

- warning 60 hari,
- high 30 hari,
- critical 14/7 hari,
- page jika <3 hari untuk critical service.

---

### 16.2 Startup validation bukan cukup

Startup check membantu, tetapi app long-running bisa melewati expiry saat masih running.

Butuh:

- periodic check,
- metrics,
- alert,
- cert inventory,
- owner mapping,
- auto-renewal jika feasible,
- game day expiry simulation.

---

### 16.3 Inventory certificate

Inventory harus punya:

| Field | Contoh |
|---|---|
| Service | case-api |
| Environment | prod |
| Purpose | TLS server |
| Alias | case-api-tls-prod-2026q1 |
| Subject/SAN | case-api.service.internal |
| Issuer | Internal Issuing CA 2026 |
| Serial | 01:AF:... |
| Fingerprint | SHA256:... |
| Not Before | 2026-01-01 |
| Not After | 2026-12-31 |
| Owner | Platform/API team |
| Rotation runbook | link |
| Trust dependencies | gateway, worker, partner |

---

## 17. Revocation: CRL, OCSP, and Reality

Certificate revocation menjawab:

```text
Certificate belum expired, tetapi sudah tidak boleh dipercaya.
```

Mekanisme umum:

- CRL,
- OCSP,
- OCSP stapling,
- private CA revocation lists,
- truststore removal,
- application denylist.

Java certificate validation bisa dikonfigurasi untuk revocation, tetapi real-world behavior bergantung pada:

- JSSE config,
- system properties,
- CertPath settings,
- network access ke OCSP/CRL endpoint,
- fail-open/fail-closed policy,
- CA metadata.

Operationally, revocation tidak boleh diasumsikan “otomatis aman” tanpa testing.

Untuk mTLS internal, sering kali recovery lebih praktis:

1. remove client identity dari authorization policy,
2. rotate certificate/key,
3. update trust if needed,
4. revoke certificate di CA,
5. monitor attempted use of old cert.

---

## 18. Hostname Verification

TLS server certificate validation tidak berhenti pada chain validation.

Verifier juga harus memastikan:

```text
Hostname yang diakses cocok dengan SAN certificate.
```

Kesalahan umum:

- certificate CN benar tapi SAN kosong; modern validation harus memakai SAN,
- wildcard terlalu broad,
- memakai IP tapi certificate hanya punya DNS SAN,
- disable hostname verifier,
- internal service memakai certificate untuk hostname berbeda,
- proxy/gateway mengubah host expectation.

Anti-pattern:

```java
HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> true);
```

Ini merusak protection terhadap man-in-the-middle.

---

## 19. mTLS Identity Mapping

mTLS menjawab:

```text
Apakah peer memiliki private key yang cocok dengan certificate dari trust chain yang dipercaya?
```

Namun business security butuh:

```text
Peer ini siapa dan boleh melakukan apa?
```

### 19.1 Mapping source

Identity bisa diambil dari:

- SAN DNS,
- SAN URI,
- SAN email,
- subject DN,
- certificate fingerprint,
- serial + issuer,
- SPIFFE ID,
- custom extension.

Rekomendasi:

- Hindari CN legacy jika bisa.
- Prefer SAN URI/DNS yang punya struktur service identity jelas.
- Jangan jadikan entire subject string sebagai parser rapuh.
- Jangan hanya trust semua cert dari CA internal sebagai semua role.

---

### 19.2 Mapping example

```text
Certificate SAN URI:
spiffe://prod.internal/ns/enforcement/sa/case-api

Mapping:
principal = service:enforcement.case-api
allowed_actions = [case.read, case.update, evidence.upload]
tenant_scope = enforcement
```

---

### 19.3 Authorization setelah mTLS

mTLS authentication harus disambung:

- endpoint-level allowlist,
- action-level policy,
- tenant boundary,
- request-level authorization,
- audit principal,
- anomaly detection.

---

## 20. Runtime Configuration Patterns

### 20.1 System properties

Java TLS sering dikonfigurasi dengan:

```bash
-Djavax.net.ssl.keyStore=/path/client.p12
-Djavax.net.ssl.keyStorePassword=...
-Djavax.net.ssl.keyStoreType=PKCS12
-Djavax.net.ssl.trustStore=/path/truststore.p12
-Djavax.net.ssl.trustStorePassword=...
-Djavax.net.ssl.trustStoreType=PKCS12
```

Kelebihan:

- simple,
- didukung banyak library,
- cepat untuk legacy.

Kekurangan:

- global untuk JVM,
- sulit per-client/per-destination trust,
- password exposure risk,
- bisa memengaruhi library lain,
- tidak ideal untuk multi-tenant/multi-upstream app.

---

### 20.2 Programmatic SSLContext per client

Untuk aplikasi modern, sering lebih baik membuat `SSLContext` per outbound client.

Kelebihan:

- trust domain eksplisit,
- mTLS identity per upstream,
- tidak memengaruhi seluruh JVM,
- lebih testable,
- lebih jelas dalam code review.

Kekurangan:

- perlu integrasi dengan HTTP client/framework,
- lebih banyak code,
- salah implementasi bisa bypass validation,
- harus memastikan hostname verification tetap aktif.

---

### 20.3 Framework config

Banyak framework Java menyediakan TLS config. Prinsip review-nya:

- Apakah keystore path eksplisit?
- Apakah truststore path eksplisit?
- Apakah protocol/cipher policy sesuai?
- Apakah hostname verification aktif?
- Apakah client auth mode benar: none/want/need?
- Apakah alias selection benar?
- Apakah reload supported?
- Apakah password berasal dari secret source aman?

---

## 21. Hot Reload vs Restart

### 21.1 Restart-based rotation

Paling sederhana:

```text
Deploy new secret
Restart service
Service load keystore baru
```

Kelebihan:

- sederhana,
- predictable,
- mudah diuji,
- cocok untuk stateless service.

Kekurangan:

- butuh rolling restart,
- connection existing mungkin tetap pakai cert lama sampai reconnect,
- tidak ideal untuk low-downtime special systems.

---

### 21.2 Hot reload

Hot reload memungkinkan app membaca trust/key material baru tanpa restart.

Kelebihan:

- mengurangi downtime,
- mempercepat rotation,
- penting untuk beberapa gateway.

Risiko:

- race condition,
- partially loaded keystore,
- password update tidak sinkron,
- connection pool masih pakai SSLContext lama,
- observability lebih sulit,
- rollback harus jelas.

Jika implement hot reload, buat invariant:

```text
New SSLContext only becomes active after full validation succeeds.
Old SSLContext remains active if reload fails.
Reload event is audited.
```

---

## 22. Debugging TLS/Keystore Problem

### 22.1 `javax.net.debug`

Untuk debugging TLS:

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

Gunakan hati-hati:

- output verbose,
- bisa mengandung metadata sensitif,
- jangan aktifkan lama di production,
- sanitize sebelum share.

---

### 22.2 Error: `PKIX path building failed`

Kemungkinan:

- CA tidak ada di truststore,
- intermediate missing,
- wrong truststore path,
- certificate expired,
- algorithm disabled,
- hostname mismatch kadang muncul sebagai error berbeda,
- corporate proxy intercept certificate.

Debug flow:

```text
1. Confirm app truststore path/type/password.
2. List truststore aliases.
3. Capture peer certificate chain.
4. Validate chain manually.
5. Check expiry and SAN.
6. Check JDK version/security properties.
7. Check proxy/gateway.
```

---

### 22.3 Error: `Cannot recover key`

Kemungkinan:

- key password salah,
- store password dan key password berbeda,
- framework hanya mendukung password sama,
- keystore corrupted,
- wrong store type.

---

### 22.4 Error: `No available authentication scheme`

Kemungkinan:

- key algorithm tidak didukung TLS config,
- certificate signature algorithm disabled,
- no suitable certificate found,
- key usage/EKU tidak cocok,
- TLS version/cipher mismatch.

---

### 22.5 Error: `Received fatal alert: bad_certificate`

Kemungkinan:

- peer menolak certificate kita,
- client certificate tidak trusted,
- chain incomplete,
- wrong EKU,
- expired,
- identity mapping ditolak,
- server membutuhkan client auth tapi client tidak mengirim cert.

---

## 23. Security Smells

### 23.1 Keystore smells

- `.p12` ada di Git repository.
- Keystore password ada di `application.yml` plaintext.
- Semua service pakai keystore yang sama.
- Alias bernama `test` di production.
- Key lama masih ada tanpa owner.
- File permission world-readable.
- Keystore di-bake ke Docker image.
- No expiry metrics.
- No rotation runbook.
- No inventory.

---

### 23.2 Truststore smells

- Truststore berisi banyak certificate yang tidak dikenal.
- Internal CA ditambahkan ke global `cacerts` tanpa dokumentasi.
- App memakai default truststore tanpa disadari.
- Self-signed peer certificate langsung dimasukkan ke truststore production.
- Truststore sama untuk semua outbound destination.
- Trust all manager.
- Hostname verification disabled.
- Tidak ada owner untuk trust anchor.

---

### 23.3 Certificate smells

- SAN kosong.
- CN dipakai sebagai identity utama.
- Wildcard terlalu luas.
- Validity terlalu panjang.
- SHA-1/weak signature algorithm.
- RSA key terlalu kecil.
- Wrong EKU.
- Chain tidak lengkap.
- Leaf certificate dipakai sebagai CA.
- Expiry kurang dari 30 hari tanpa alert.

---

### 23.4 Private key custody smells

- Private key dikirim via chat/email.
- Private key ada di laptop banyak orang.
- Private key diekspor dari HSM tanpa reason.
- Satu key untuk banyak purpose.
- Backup key tidak dihapus setelah rotation.
- Tidak ada record siapa generate/import key.
- Tidak ada compromise procedure.
- Key password diketahui seluruh team.

---

## 24. Production Checklist

### 24.1 Keystore checklist

- [ ] Format modern dipilih sengaja, biasanya PKCS12 untuk file-based.
- [ ] Keystore tidak disimpan di source repo.
- [ ] Keystore tidak dibake ke image production.
- [ ] Store password berasal dari secret manager/controlled secret.
- [ ] File permission minimal.
- [ ] Alias eksplisit.
- [ ] Entry type tervalidasi saat startup.
- [ ] Certificate chain lengkap.
- [ ] Expiry metrics tersedia.
- [ ] Rotation runbook tersedia.
- [ ] Owner jelas.

---

### 24.2 Truststore checklist

- [ ] Truststore eksplisit untuk trust domain kritikal.
- [ ] Trust anchor minimal.
- [ ] Setiap trusted certificate punya owner/reason.
- [ ] Tidak ada unknown legacy CA.
- [ ] Tidak memakai trust-all.
- [ ] Hostname verification aktif.
- [ ] Truststore update melalui change control.
- [ ] CA rollover plan tersedia.
- [ ] Default `cacerts` usage dipahami.
- [ ] Revocation strategy dipahami.

---

### 24.3 Certificate checklist

- [ ] SAN benar.
- [ ] CN tidak dijadikan satu-satunya basis.
- [ ] Key usage benar.
- [ ] EKU benar.
- [ ] Validity sesuai policy.
- [ ] Signature algorithm sesuai policy.
- [ ] Key size/curve sesuai policy.
- [ ] Chain path valid.
- [ ] Fingerprint tercatat.
- [ ] Expiry alert aktif.

---

### 24.4 Private key checklist

- [ ] One key one purpose.
- [ ] Non-exportable untuk key high-value jika memungkinkan.
- [ ] Access to key audited.
- [ ] Backup protected.
- [ ] Rotation tested.
- [ ] Compromise runbook tersedia.
- [ ] Key tidak pernah dikirim lewat insecure channel.
- [ ] Key tidak ada di logs/dumps/repo/image.
- [ ] Key password tidak hardcoded.
- [ ] Destruction/retirement process jelas.

---

## 25. Mini Case Study: mTLS untuk Java Regulatory Case API

### 25.1 Context

Ada service:

```text
case-api
```

Ia memanggil:

```text
document-api
payment-api
audit-api
```

Semua komunikasi internal critical harus memakai mTLS.

---

### 25.2 Naive design

```text
Semua service pakai satu internal.p12
Semua service trust internal-root-ca
Semua certificate punya CN=internal-service
Authorization hanya cek certificate valid
```

Masalah:

1. Jika satu service bocor, semua identity bocor.
2. Tidak ada service-level identity.
3. Authorization tidak bisa membedakan case-api vs payment-api.
4. Rotation satu service berdampak semua.
5. Audit principal tidak defensible.
6. Blast radius sangat besar.

---

### 25.3 Better design

Setiap service punya identity sendiri:

```text
case-api keystore:
  alias: aceas-case-api-mtls-client-prod-2026q1
  SAN URI: spiffe://prod.aceas/ns/core/sa/case-api
  EKU: clientAuth

case-api truststore:
  internal issuing CA untuk document/payment/audit domain
```

Server side mapping:

```text
spiffe://prod.aceas/ns/core/sa/case-api
  → principal: service:case-api
  → allowed to call:
      document-api: document.read, evidence.upload
      payment-api: payment.status.read
      audit-api: audit.event.write
```

Audit event:

```json
{
  "authenticated_by": "mTLS",
  "client_principal": "service:case-api",
  "client_cert_fingerprint_sha256": "...",
  "issuer": "ACEAS Internal Issuing CA 2026",
  "action": "evidence.upload",
  "decision": "allow"
}
```

---

### 25.4 Rotation flow

```text
T-60 days:
  alert certificate expiring

T-45 days:
  generate new keypair/CSR

T-40 days:
  CA issue new cert with same service identity

T-30 days:
  deploy new keystore to case-api canary

T-29 days:
  verify downstream accepts new certificate

T-21 days:
  rollout all case-api pods

T-14 days:
  revoke/remove old cert if no active use

T-7 days:
  confirm metrics no old fingerprint seen
```

---

## 26. Review Questions untuk Senior Engineer

Gunakan pertanyaan ini saat design review atau PR review.

### 26.1 Keystore/truststore

1. Keystore ini menyimpan identity siapa?
2. Truststore ini mempercayai siapa?
3. Apakah truststore terlalu luas?
4. Apakah app memakai truststore eksplisit atau default?
5. Apakah alias dipilih eksplisit?
6. Apakah certificate chain lengkap?
7. Apakah ada expiry monitoring?
8. Bagaimana rotation dilakukan tanpa outage?
9. Bagaimana rollback dilakukan?
10. Siapa owner trust anchor?

---

### 26.2 Private key custody

1. Di mana private key digenerate?
2. Apakah private key pernah keluar dari secure boundary?
3. Siapa bisa membaca private key?
4. Apakah akses diaudit?
5. Apakah key punya satu purpose?
6. Apakah backup private key ada?
7. Bagaimana backup dilindungi?
8. Bagaimana key dihancurkan?
9. Apa yang terjadi jika key bocor?
10. Berapa lama recovery dari compromise?

---

### 26.3 Certificate validation

1. Apakah chain menuju trust anchor yang benar?
2. Apakah hostname/SAN diverifikasi?
3. Apakah EKU/KeyUsage dicek?
4. Apakah revocation strategy jelas?
5. Apakah disabled algorithms memengaruhi chain?
6. Apakah certificate identity dipetakan ke authorization?
7. Apakah wildcard certificate acceptable?
8. Apakah self-signed certificate dipakai? Kenapa?
9. Apakah certificate fingerprint dicatat?
10. Apakah certificate inventory lengkap?

---

## 27. Common Anti-Patterns dan Koreksi

### 27.1 “Import certificate error ke cacerts saja”

Masalah:

- memperluas trust global semua app di JVM/image,
- tidak jelas owner/reason,
- sulit audit,
- sulit rollback.

Koreksi:

- buat truststore per app/trust domain,
- import CA/cert yang benar,
- konfigurasi app eksplisit,
- dokumentasikan trust decision.

---

### 27.2 “Disable hostname verification karena internal network”

Masalah:

- internal network juga punya attacker/misroute/proxy risk,
- TLS kehilangan identity binding,
- MITM internal menjadi mungkin.

Koreksi:

- issue certificate dengan SAN benar,
- pakai service DNS yang stabil,
- perbaiki gateway/proxy config.

---

### 27.3 “Satu certificate wildcard untuk semua service”

Masalah:

- key compromise satu service berdampak semua,
- identity tidak granular,
- audit lemah,
- rotation besar.

Koreksi:

- service identity individual,
- short-lived certificate jika memungkinkan,
- automated issuance.

---

### 27.4 “Certificate valid berarti authorized”

Masalah:

- authentication disamakan dengan authorization,
- semua cert dari CA bisa akses semua.

Koreksi:

- map certificate identity ke principal,
- enforce policy per resource/action,
- audit decision.

---

### 27.5 “Keystore password di repo karena cuma internal”

Masalah:

- internal repo sering punya banyak reader,
- secret menyebar ke clone lokal,
- history sulit dibersihkan,
- backup/code search leak.

Koreksi:

- secret manager,
- rotate exposed password/key,
- secret scanning,
- revoke old material.

---

## 28. Implementation Pattern: Safe TLS Client Factory

Contoh ini bukan framework final, tetapi pola berpikir.

```java
public final class TlsMaterial {
    private final KeyStore keyStore;
    private final char[] keyPassword;
    private final KeyStore trustStore;

    public TlsMaterial(KeyStore keyStore, char[] keyPassword, KeyStore trustStore) {
        this.keyStore = Objects.requireNonNull(keyStore);
        this.keyPassword = Objects.requireNonNull(keyPassword).clone();
        this.trustStore = Objects.requireNonNull(trustStore);
    }

    public SSLContext buildSslContext() throws GeneralSecurityException {
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(keyStore, keyPassword);

        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(trustStore);

        SSLContext context = SSLContext.getInstance("TLS");
        context.init(kmf.getKeyManagers(), tmf.getTrustManagers(), SecureRandom.getInstanceStrong());
        return context;
    }

    public void clear() {
        Arrays.fill(keyPassword, '\0');
    }
}
```

Review points:

- Apakah `keyStore` dan `trustStore` benar?
- Apakah alias selection diperlukan?
- Apakah hostname verification tetap aktif di HTTP client?
- Apakah password source aman?
- Apakah keyPassword lifetime cukup pendek?
- Apakah exception tidak membocorkan secret?
- Apakah SSLContext dipakai hanya untuk intended destination?

---

## 29. Implementation Pattern: Startup Certificate Validator

```java
public final class CertificateStartupValidator {
    private CertificateStartupValidator() {}

    public static void validatePrivateKeyCertificate(
            KeyStore keyStore,
            String alias,
            Clock clock,
            Duration expiryWarningThreshold
    ) throws GeneralSecurityException {
        Objects.requireNonNull(keyStore);
        Objects.requireNonNull(alias);
        Objects.requireNonNull(clock);
        Objects.requireNonNull(expiryWarningThreshold);

        if (!keyStore.containsAlias(alias)) {
            throw new KeyStoreException("Missing key alias: " + alias);
        }

        if (!keyStore.entryInstanceOf(alias, KeyStore.PrivateKeyEntry.class)) {
            throw new KeyStoreException("Alias is not a private key entry: " + alias);
        }

        Certificate cert = keyStore.getCertificate(alias);
        if (!(cert instanceof X509Certificate x509)) {
            throw new CertificateException("Certificate is not X.509 for alias: " + alias);
        }

        Instant now = clock.instant();
        try {
            x509.checkValidity(Date.from(now));
        } catch (CertificateExpiredException | CertificateNotYetValidException e) {
            throw new CertificateException("Certificate not valid at startup for alias: " + alias, e);
        }

        Instant notAfter = x509.getNotAfter().toInstant();
        if (notAfter.minus(expiryWarningThreshold).isBefore(now)) {
            // In real app, emit metric/alert, not System.out.
            System.out.println("WARNING: Certificate for alias " + alias + " expires at " + notAfter);
        }
    }
}
```

Tambahan production:

- cek SAN,
- cek EKU,
- cek key algorithm/size,
- cek fingerprint expected,
- expose metrics,
- fail fast untuk certificate expired,
- warn/page untuk near expiry.

---

## 30. Integrity of Keystore Files

Keystore file sendiri perlu integrity protection.

Threat:

- attacker mengganti keystore dengan key miliknya,
- attacker mengganti truststore agar app percaya CA attacker,
- attacker menghapus entry,
- attacker rollback ke keystore lama,
- attacker mengganti file saat hot reload.

Controls:

1. filesystem permission,
2. immutable deployment artifact for config metadata,
3. secret manager versioning,
4. checksum/signature of keystore bundle,
5. expected fingerprint validation at startup,
6. audit log for secret update,
7. least privilege to update secret,
8. deployment approval,
9. rollback detection via version,
10. runtime read-only mount.

Untuk truststore, expected fingerprint sangat berguna:

```text
Config says expected trusted CA fingerprint = SHA256:abc...
Loaded truststore contains that fingerprint and no unexpected CA.
```

---

## 31. Keystore in Tests

Testing security material butuh hati-hati.

### 31.1 Test keystore boleh dummy, tapi realistis

Buat test keystore yang:

- bukan production secret,
- ada certificate chain dummy,
- punya SAN realistis,
- punya EKU realistis,
- punya expiry cukup untuk test,
- jelas diberi label test.

Jangan commit production-like private key meski “sudah expired”. Private key lama tetap bisa dipakai untuk forensic/social engineering/confusion.

---

### 31.2 Test untuk failure mode

Test case:

- missing alias,
- wrong password,
- expired certificate,
- not-yet-valid certificate,
- wrong EKU,
- wrong SAN,
- incomplete chain,
- wrong truststore,
- truststore has unexpected CA,
- reload fails and old context remains active.

---

## 32. Operational Runbook Template

### 32.1 Certificate rotation runbook

```text
Runbook: Rotate <service> <purpose> certificate

1. Scope
   - Service:
   - Environment:
   - Current alias:
   - New alias:
   - Owner:

2. Pre-check
   - Current cert fingerprint:
   - Current expiry:
   - Dependent clients/servers:
   - Trust chain:

3. Generate/obtain new certificate
   - Key generated at:
   - CSR location:
   - CA ticket/reference:
   - New cert fingerprint:

4. Validate new material
   - Chain complete:
   - SAN correct:
   - EKU correct:
   - KeyUsage correct:
   - Expiry correct:

5. Deploy
   - Secret version:
   - Deployment plan:
   - Canary:
   - Metrics:

6. Verify
   - TLS handshake:
   - mTLS auth:
   - Logs:
   - Downstream acceptance:

7. Retire old material
   - Old cert no longer observed:
   - Old secret disabled/deleted:
   - CA revocation if needed:

8. Rollback
   - Condition:
   - Steps:
   - Max rollback window:
```

---

### 32.2 Truststore update runbook

```text
Runbook: Update truststore for <service>

1. Why trust is changing:
2. Certificate/CA to add/remove:
3. Fingerprint verified via:
4. Owner approval:
5. Blast radius:
6. Compatibility window:
7. Deployment order:
8. Validation:
9. Monitoring:
10. Rollback:
```

---

## 33. Decision Matrix

### 33.1 File keystore vs KMS/HSM

| Situation | File PKCS12 OK? | Prefer KMS/HSM? |
|---|---:|---:|
| Internal low-risk TLS in dev | Yes | No |
| Production service TLS | Sometimes | Maybe |
| mTLS client to sensitive system | Maybe | Consider |
| JWT signing for broad access tokens | Risky | Yes, often |
| Audit log signing | Risky | Yes |
| Code signing | No for serious use | Yes |
| Internal root CA | No | Strongly yes/offline |
| Document legal signature | Usually no | Yes |

---

### 33.2 Truststore scope

| Scope | Use when | Risk |
|---|---|---|
| Global JDK `cacerts` | General public HTTPS | Hidden broad trust |
| App-specific truststore | Most production apps | More config to manage |
| Destination-specific truststore | High assurance integrations | Operational complexity |
| Pinning/fingerprint | Very narrow controlled peer | Rotation fragility |

---

## 34. What Top 1% Engineers Pay Attention To

Top engineers tidak hanya bertanya:

```text
Bagaimana cara load keystore?
```

Mereka bertanya:

1. Apa trust domain-nya?
2. Apa identity yang dibuktikan certificate ini?
3. Siapa CA yang bisa menerbitkan identity itu?
4. Apakah private key exportable?
5. Apakah key punya satu purpose?
6. Apakah certificate usage sesuai?
7. Apakah hostname/SAN verified?
8. Apakah truststore minimal?
9. Apakah rotation bisa dilakukan tanpa downtime?
10. Apakah expiry dimonitor?
11. Apakah compromise path jelas?
12. Apakah trust decision bisa diaudit?
13. Apakah app benar-benar memakai config yang kita pikir dipakai?
14. Apakah semua secret movement tercatat?
15. Apakah desain ini tetap aman ketika ada proxy, container, CI/CD, backup, dan operator manusia?

Security maturity terlihat dari pertanyaan-pertanyaan ini.

---

## 35. Ringkasan

KeyStore dan truststore adalah fondasi praktis Java security production.

Yang harus diingat:

1. `KeyStore` adalah container, bukan otomatis secure custody.
2. Keystore biasanya menyimpan identity/secret milik kita.
3. Truststore menyimpan basis trust untuk memverifikasi pihak lain.
4. Certificate adalah binding public key ke identity claim.
5. Certificate chain harus valid, lengkap, dan menuju trust anchor yang benar.
6. Hostname/SAN verification tidak boleh dimatikan.
7. mTLS authentication bukan authorization.
8. Private key adalah capability, bukan sekadar file.
9. One key should have one purpose.
10. Keystore password bukan pengganti secret management.
11. Default `cacerts` harus dipahami, bukan diasumsikan.
12. Truststore update adalah security change.
13. Certificate expiry harus dimonitor otomatis.
14. Rotation harus punya overlap dan rollback plan.
15. Untuk key high-value, file keystore sering tidak cukup; gunakan KMS/HSM/non-exportable key.

---

## 36. Koneksi ke Part Berikutnya

Part ini membahas bagaimana key dan certificate disimpan/dioperasikan di Java. Part berikutnya akan masuk ke topik yang lebih fundamental untuk certificate trust:

```text
Part 13 — X.509, PKI, Certificate Path Validation, Revocation
```

Di sana kita akan membahas lebih dalam:

- struktur X.509,
- SAN, KeyUsage, EKU, BasicConstraints,
- chain validation,
- root/intermediate/leaf,
- CertPath API,
- revocation,
- certificate pinning,
- mTLS identity mapping,
- failure mode PKI enterprise.

---

## Referensi

1. Oracle Java SE Documentation — `java.security.KeyStore` API.
2. Oracle Java SE Documentation — `keytool` command.
3. Oracle JSSE Reference Guide — key managers, trust managers, keystores, truststores.
4. Oracle Java Security Standard Algorithm Names.
5. OWASP Key Management Cheat Sheet.
6. OWASP Cryptographic Storage Cheat Sheet.
7. NIST SP 800-57 Part 1 Rev. 5 — Recommendation for Key Management.
8. RFC 5280 — Internet X.509 Public Key Infrastructure Certificate and CRL Profile.
9. Java Platform Security Guides and JDK security properties documentation.
