# learn-java-deployment-runtime-release-delivery-engineering

# Part 20 — Configuration, Secret Rotation, Certificate Rotation, and Truststore Deployment

> Seri: **Java Deployment Runtime Release Delivery Engineering**  
> Target: Java 8 sampai Java 25  
> Fokus: secret rotation, certificate rotation, keystore/truststore deployment, mTLS, credential lifecycle, Kubernetes secret behavior, restart vs reload, dual-validity windows, emergency rotation, dan auditability.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas stateful deployment: session, cache, queue, scheduler, dan job. Sekarang kita masuk ke salah satu area deployment yang sering terlihat kecil tetapi bisa menyebabkan outage besar: **rotasi secret dan certificate**.

Di sistem production, aplikasi Java jarang berjalan sendirian. Ia biasanya terhubung ke:

- database;
- Redis/cache;
- RabbitMQ/Kafka;
- SMTP server;
- OAuth/OIDC provider;
- SAML IdP;
- external API;
- internal service via mTLS;
- file transfer server;
- object storage;
- signing service;
- payment/regulatory/external government system;
- observability backend;
- secret manager;
- LDAP/AD;
- key management system.

Semua koneksi itu membutuhkan material rahasia atau trust material:

- password;
- API key;
- OAuth client secret;
- JWT signing key;
- private key;
- public certificate;
- CA certificate;
- keystore;
- truststore;
- mTLS client certificate;
- database credential;
- message broker credential;
- encryption key;
- SAML signing certificate;
- OIDC JWKS;
- SMTP credential;
- token exchange credential.

Masalahnya, banyak engineer memperlakukan secret sebagai konfigurasi biasa. Padahal dari sudut deployment, secret adalah **runtime dependency with expiry, blast radius, ownership, propagation delay, compatibility window, revocation semantics, dan audit requirement**.

Bagian ini bertujuan membentuk mental model yang matang:

> Secret/certificate rotation bukan sekadar “ganti value lalu restart”. Ia adalah perubahan sistem terdistribusi yang harus menjaga kompatibilitas antara issuer, consumer, verifier, cache, runtime, traffic, dan audit trail.

---

## 1. Core Mental Model: Secret Rotation Is a Distributed Compatibility Problem

Secret rotation terlihat seperti operasi tunggal:

```text
old_secret -> new_secret
```

Namun di production, realitanya seperti ini:

```text
+----------------+      +---------------------+      +----------------+
| Secret Source  | ---> | Deployment Runtime  | ---> | Java Process   |
| Vault/SSM/K8s  |      | Pod/VM/systemd      |      | JVM/App/Pool   |
+----------------+      +---------------------+      +----------------+
        |                         |                         |
        |                         |                         v
        |                         |                 +---------------+
        |                         |                 | Dependencies  |
        |                         |                 | DB/API/IdP    |
        |                         |                 +---------------+
        |                         |
        v                         v
+----------------+      +---------------------+
| Audit/Policy   |      | Rollout/Rollback    |
+----------------+      +---------------------+
```

Ketika secret berubah, beberapa hal harus benar pada saat yang sama:

1. **Producer/issuer menerima material baru.**  
   Contoh: database sudah memiliki user/password baru, IdP sudah menerima client secret baru, CA sudah menerbitkan cert baru.

2. **Secret store menyimpan value baru.**  
   Contoh: Kubernetes Secret, AWS Secrets Manager, SSM Parameter Store, Vault KV, config server.

3. **Runtime environment mem-propagate value baru.**  
   Contoh: mounted file berubah, env var tidak berubah sampai restart, projected Secret memiliki delay, agent melakukan refresh.

4. **Java application membaca value baru.**  
   Contoh: saat startup, saat connection pool refresh, saat SSLContext dibuat ulang, saat scheduler re-read config.

5. **Dependency menerima autentikasi baru.**  
   Contoh: DB menerima password baru, external API menerima API key baru, TLS peer mempercayai certificate chain baru.

6. **Old material tetap valid selama transisi atau dicabut dengan urutan aman.**  
   Kalau dicabut terlalu cepat, instance lama gagal. Kalau dibiarkan terlalu lama, risiko security meningkat.

Karena itu, pertanyaan deployment yang benar bukan:

> “Bagaimana cara mengganti secret?”

Melainkan:

> “Bagaimana memastikan seluruh producer, consumer, verifier, cache, process, dan traffic path dapat berpindah dari old material ke new material tanpa outage, tanpa silent security gap, dan dengan audit evidence?”

---

## 2. Vocabulary yang Harus Jelas

Sebelum masuk teknis, bedakan beberapa istilah berikut.

### 2.1 Secret

Secret adalah material rahasia yang memberi kemampuan akses atau otorisasi.

Contoh:

- database password;
- API key;
- OAuth client secret;
- private key;
- signing key;
- encryption key;
- SMTP password;
- broker password;
- token refresh secret.

Secret harus dianggap **sensitive by default**.

### 2.2 Credential

Credential adalah material yang dipakai untuk membuktikan identitas.

Contoh:

- username/password;
- client ID + client secret;
- certificate + private key;
- service account token;
- access key + secret key.

Secret adalah bagian dari credential, tetapi credential bisa memiliki metadata seperti identity, role, scope, expiry, dan policy.

### 2.3 Certificate

Certificate adalah dokumen kriptografis yang mengikat identity dengan public key, biasanya ditandatangani oleh CA.

Certificate bukan selalu rahasia. Public certificate boleh dibagikan. Yang rahasia adalah **private key** yang berpasangan dengannya.

### 2.4 Private Key

Private key adalah material paling sensitif dalam TLS/mTLS/signing. Jika private key bocor, attacker bisa menyamar sebagai identitas tersebut selama certificate masih dipercaya.

### 2.5 Keystore

Dalam ekosistem Java, keystore sering berarti file/container yang menyimpan private key dan certificate chain.

Contoh format:

- JKS;
- PKCS12/P12;
- BCFKS;
- PEM bundle, meskipun PEM bukan Java KeyStore type klasik.

### 2.6 Truststore

Truststore menyimpan certificate yang dipercaya untuk memverifikasi peer.

Contoh:

- CA root/internal CA;
- intermediate CA;
- pinned server certificate, walau ini perlu hati-hati;
- partner CA certificate.

Keystore menjawab:

> “Siapa saya, dan private key apa yang saya pakai untuk membuktikannya?”

Truststore menjawab:

> “Siapa yang saya percayai ketika peer menunjukkan certificate?”

### 2.7 Key Rotation

Key rotation berarti mengganti key material. Bisa berupa:

- mengganti password;
- mengganti API key;
- mengganti client secret;
- mengganti private key dan certificate;
- mengganti signing key;
- mengganti encryption key.

### 2.8 Certificate Renewal vs Certificate Rotation

Certificate renewal sering berarti certificate baru diterbitkan untuk key yang sama atau identitas yang sama.

Certificate rotation lebih luas:

- certificate baru;
- private key baru;
- chain baru;
- CA baru;
- trust anchor baru;
- algorithm baru;
- SAN baru;
- expiry policy baru.

Untuk security posture yang matang, renewal tanpa private key rotation tidak selalu cukup.

### 2.9 Reload vs Restart

Reload berarti process tetap hidup dan membaca material baru.

Restart berarti process dimatikan dan dibuat ulang agar membaca material baru dari startup.

Dalam Java, banyak library membuat object seperti `SSLContext`, datasource pool, HTTP client, Kafka client, RabbitMQ connection, atau SMTP session saat startup. Mengubah file secret belum tentu membuat object-object ini memakai value baru.

### 2.10 Revocation

Revocation berarti material lama dinyatakan tidak valid sebelum expiry natural-nya.

Contoh:

- revoke certificate di CA/CRL/OCSP;
- disable database user lama;
- delete old API key;
- remove old OAuth client secret;
- rotate JWT signing key dan hapus old key dari JWKS.

Revocation harus direncanakan karena bisa memutus instance lama yang belum refresh.

---

## 3. Taxonomy Secret dan Trust Material dalam Java Deployment

Tidak semua secret memiliki perilaku deployment yang sama.

### 3.1 Static Startup Secret

Dibaca saat startup dan tidak berubah sampai process restart.

Contoh:

```properties
spring.datasource.password=${DB_PASSWORD}
```

Jika `DB_PASSWORD` berasal dari environment variable, nilainya tidak akan berubah di process yang sudah berjalan.

Konsekuensi:

- rotasi membutuhkan restart/rolling restart;
- rollback harus mempertimbangkan apakah secret lama masih valid;
- deployment controller harus memastikan instance baru memakai value baru.

### 3.2 File-Mounted Secret

Secret dipasang sebagai file.

Contoh:

```text
/run/secrets/db-password
/etc/tls/tls.crt
/etc/tls/tls.key
/etc/ssl/truststore.p12
```

Konsekuensi:

- file bisa berubah tanpa restart tergantung runtime platform;
- aplikasi belum tentu membaca ulang;
- symbolic update behavior perlu dipahami;
- `subPath` di Kubernetes punya implikasi penting;
- file permission harus benar.

### 3.3 Dynamically Fetched Secret

Aplikasi mengambil secret dari secret manager saat startup atau runtime.

Contoh:

- AWS Secrets Manager;
- SSM Parameter Store;
- HashiCorp Vault;
- Azure Key Vault;
- GCP Secret Manager.

Konsekuensi:

- aplikasi butuh identity untuk mengambil secret;
- caching harus punya TTL;
- secret manager outage bisa berdampak startup/runtime;
- permission policy menjadi bagian deployment;
- audit lebih baik karena fetch bisa dilog.

### 3.4 Short-Lived Token

Token ephemeral yang hidup sebentar.

Contoh:

- OAuth access token;
- STS token;
- service account token;
- signed JWT;
- database IAM token.

Konsekuensi:

- aplikasi harus punya refresh logic;
- clock skew penting;
- retry harus membedakan 401 karena expired vs invalid;
- token cache harus thread-safe;
- rollout tidak cukup kalau refresh logic salah.

### 3.5 Trust Material

Material untuk memverifikasi peer, bukan untuk membuktikan diri.

Contoh:

- root CA;
- intermediate CA;
- partner API certificate;
- custom truststore;
- JWKS public keys;
- SAML IdP signing cert.

Konsekuensi:

- rotasi sering membutuhkan **overlap**: old + new harus trusted bersamaan;
- trust removal harus dilakukan setelah semua peer pindah ke certificate baru;
- truststore salah bisa menyebabkan outage total pada outbound calls.

### 3.6 Identity Material

Material untuk membuktikan identitas service.

Contoh:

- mTLS client certificate;
- server TLS certificate;
- private key;
- service account credential;
- OAuth client secret.

Konsekuensi:

- issuer/verifier harus siap menerima identitas baru;
- private key protection sangat penting;
- rotation harus menghindari identity mismatch.

---

## 4. The Four Rotation Models

Ada empat model besar rotasi.

### 4.1 Restart-Based Rotation

Material baru dipasang, lalu aplikasi di-restart.

```text
Update Secret -> Rollout Restart -> New Pods/Processes read new value
```

Cocok untuk:

- environment variable secret;
- static datasource password;
- keystore/truststore yang dibaca saat startup;
- framework yang tidak mendukung reload;
- low-frequency rotation.

Kelebihan:

- sederhana;
- deterministic;
- mudah diaudit;
- cocok untuk Kubernetes rolling restart.

Kelemahan:

- menyebabkan restart wave;
- membutuhkan readiness/draining benar;
- tidak cocok untuk very short-lived material;
- bisa gagal jika old material dicabut sebelum semua instance restart.

### 4.2 Reload-Based Rotation

Material baru dipasang, lalu aplikasi membaca ulang tanpa restart.

```text
Update file -> App detects/reloads -> New connections use new material
```

Cocok untuk:

- TLS certificate yang bisa hot reload;
- truststore reload;
- API keys yang dipakai per request;
- config yang memang dirancang reloadable.

Kelebihan:

- menghindari restart;
- cocok untuk high availability;
- lebih fleksibel.

Kelemahan:

- jauh lebih kompleks;
- membutuhkan thread-safe swapping;
- connection pool lama mungkin masih memakai credential lama;
- reload failure harus observable;
- bisa menciptakan mixed state dalam process.

### 4.3 Dual-Credential Rotation

Old dan new credential valid bersamaan selama transisi.

```text
Phase 1: Dependency accepts old + new
Phase 2: Apps move from old to new
Phase 3: Verify no old usage
Phase 4: Revoke old
```

Ini adalah pola paling aman untuk banyak secret.

Cocok untuk:

- database credential dengan user lama dan baru;
- OAuth client secret yang mendukung multiple active secrets;
- API key yang bisa dibuat paralel;
- JWT signing key dengan `kid`;
- mTLS CA rollover;
- SAML certificate rollover.

Kelebihan:

- minimal outage;
- rollback lebih aman;
- observability bisa memastikan migrasi selesai.

Kelemahan:

- tidak semua dependency mendukung dua credential;
- butuh governance agar old secret tidak lupa dicabut;
- butuh metric/log untuk mendeteksi penggunaan old credential.

### 4.4 Indirection-Based Rotation

Aplikasi tidak menyimpan secret final, melainkan mengambil token/credential sementara dari identity system.

Contoh:

- workload identity;
- IAM role;
- Vault dynamic database credentials;
- SPIFFE/SPIRE identity;
- cloud-native service account federation.

Kelebihan:

- long-lived secret berkurang;
- rotation lebih otomatis;
- blast radius lebih kecil;
- audit lebih kuat.

Kelemahan:

- platform lebih kompleks;
- identity provider menjadi critical dependency;
- debugging lebih sulit;
- tidak semua enterprise/external dependency mendukung model ini.

---

## 5. Java-Specific Reality: Why Rotation Is Often Harder Than Expected

Java memiliki beberapa karakteristik yang membuat secret/certificate rotation perlu dipikirkan dari awal.

### 5.1 Banyak Client Membuat Object Sekali Saat Startup

Contoh:

- `DataSource`;
- HikariCP pool;
- `SSLContext`;
- `HttpClient`;
- Apache HttpClient;
- Netty channel pool;
- Kafka producer/consumer;
- RabbitMQ connection factory;
- SMTP `Session`;
- LDAP connection pool;
- SAML metadata resolver;
- JWT decoder/verifier.

Jika secret file berubah, object yang sudah dibuat belum tentu berubah.

Misalnya:

```java
SSLContext sslContext = SSLContextBuilder
    .loadTrustMaterial(trustStoreFile, password)
    .build();
```

`SSLContext` ini tidak otomatis reload hanya karena `trustStoreFile` berubah.

### 5.2 Connection Pool Memegang Koneksi Lama

Jika database password berubah, HikariCP mungkin masih memiliki koneksi lama yang sudah authenticated. Koneksi lama tetap jalan sampai ditutup. Koneksi baru akan memakai credential baru hanya jika pool direkonfigurasi atau process restart.

Risiko:

- app terlihat sehat karena koneksi lama masih hidup;
- setelah pool recycle, koneksi baru gagal;
- error muncul terlambat, bukan saat rotasi;
- rollback menjadi membingungkan.

### 5.3 Truststore Biasanya Dibaca Saat SSLContext Dibuat

Banyak outbound HTTPS/mTLS client memakai `SSLContext` yang dibuat saat startup. Truststore baru tidak otomatis dipakai.

Dampaknya:

- partner mengganti cert;
- secret/truststore file sudah updated;
- pod masih gagal TLS handshake karena JVM/app belum reload trust material.

### 5.4 System Properties Tidak Dinamis

Banyak konfigurasi TLS klasik memakai system properties:

```bash
-Djavax.net.ssl.keyStore=/etc/tls/keystore.p12
-Djavax.net.ssl.keyStorePassword=changeit
-Djavax.net.ssl.trustStore=/etc/tls/truststore.p12
-Djavax.net.ssl.trustStorePassword=changeit
```

Ini biasanya dibaca saat SSL context default dibuat. Mengubah file setelah itu tidak menjamin default context berubah.

### 5.5 Environment Variables Tidak Bisa Diubah untuk Process Berjalan

Jika Java app membaca secret dari env var:

```bash
DB_PASSWORD=old java -jar app.jar
```

Mengubah Kubernetes Secret yang menjadi sumber env var tidak mengubah env var process yang sudah berjalan.

Konsekuensi:

- env var secret almost always membutuhkan restart;
- mounted file secret bisa berubah, tetapi aplikasi harus reload.

### 5.6 Java 8–25 Compatibility Matters

Java 8 legacy app sering menggunakan:

- JKS default assumptions;
- older TLS defaults;
- older HTTP clients;
- custom trust managers;
- manually modified `cacerts`;
- app server shared truststore;
- XML/SOAP clients dengan SSL config global.

Java 17/21/25 modern app lebih sering menggunakan:

- PKCS12;
- containerized trust material;
- framework SSL bundles;
- OpenTelemetry Java agent;
- Kubernetes secret volumes;
- dynamic config integration;
- cloud identity.

Tetapi prinsipnya sama: pahami kapan material dibaca, siapa yang cache, dan bagaimana object diganti.

---

## 6. Keystore dan Truststore dalam Java

### 6.1 Keystore vs Truststore: Jangan Campur Mental Model

Keystore:

```text
Private Key + Certificate Chain
```

Truststore:

```text
Trusted CA/Public Certificates
```

Inbound TLS server membutuhkan keystore untuk menunjukkan identitas server.

Outbound TLS client membutuhkan truststore untuk mempercayai server.

mTLS client membutuhkan keduanya:

- keystore untuk menunjukkan client certificate;
- truststore untuk memverifikasi server certificate.

mTLS server juga membutuhkan keduanya:

- keystore untuk menunjukkan server certificate;
- truststore untuk memverifikasi client certificate.

### 6.2 Format Umum

#### JKS

Legacy Java KeyStore format.

Masih banyak dipakai pada Java 8-era systems, app server lama, enterprise middleware, dan vendor product lama.

#### PKCS12 / P12

Format interoperable yang umum untuk menyimpan private key dan certificate chain.

Umumnya lebih baik untuk deployment modern karena bisa dibuat dengan OpenSSL, dibaca Java, dan dipakai lintas tool.

#### PEM

Format text-based yang umum di cloud native ecosystem.

Kubernetes TLS Secret biasanya menyimpan:

```text
tls.crt
tls.key
```

Banyak Java framework modern bisa bekerja dengan PEM secara langsung, tetapi Java API klasik sering membutuhkan conversion ke PKCS12/JKS.

#### BCFKS

Format dari Bouncy Castle FIPS, relevan untuk environment dengan FIPS atau policy cryptographic tertentu.

### 6.3 Jangan Edit `$JAVA_HOME/lib/security/cacerts` Sembarangan

Anti-pattern klasik:

```bash
keytool -importcert -cacerts -file partner.crt -alias partner
```

Masalah:

- mengubah runtime global;
- sulit diaudit;
- hilang saat image/runtime diupgrade;
- menyebabkan environment drift;
- semua aplikasi dalam runtime itu mempercayai certificate tambahan;
- rollback tidak jelas.

Pattern lebih baik:

```bash
-Djavax.net.ssl.trustStore=/app/config/truststore.p12
-Djavax.net.ssl.trustStorePassword=${TRUSTSTORE_PASSWORD}
-Djavax.net.ssl.trustStoreType=PKCS12
```

Atau framework-specific trust configuration.

### 6.4 Truststore Harus Versioned sebagai Artifact/Config Boundary

Truststore bukan sekadar file tambahan. Ia adalah security policy.

Naming yang lebih baik:

```text
truststore-partner-api-v2026-06.p12
truststore-internal-ca-v3.p12
truststore-regulatory-gateway-rollover-2026q3.p12
```

Metadata yang perlu dicatat:

- included CA/certificate alias;
- fingerprint;
- subject;
- issuer;
- serial number;
- validity;
- purpose;
- owner;
- expiry;
- rollout date;
- removal date untuk old cert.

---

## 7. TLS, mTLS, and Certificate Rotation Mental Model

### 7.1 One-Way TLS

Client memverifikasi server.

```text
Client ---- HTTPS ----> Server
Client verifies server certificate using truststore/CA bundle
```

Java app sebagai client butuh truststore yang mempercayai server certificate chain.

Server app butuh keystore yang berisi private key + certificate chain.

### 7.2 Mutual TLS

Client dan server saling memverifikasi.

```text
Client presents client cert
Server verifies client cert
Server presents server cert
Client verifies server cert
```

Kedua sisi punya:

- keystore;
- truststore;
- certificate chain;
- private key;
- policy siapa yang dipercaya.

### 7.3 Certificate Rotation Timeline

Certificate rotation yang aman biasanya memiliki overlap.

```text
Time --->

Old cert valid:  [==============================]
New cert valid:                 [==============================]

Trust old:       [==============================]
Trust new:                       [==============================]

Safe overlap:                    [===========]
```

Selama overlap:

- server bisa memakai old atau new cert;
- client truststore mempercayai old dan new chain;
- rollback masih mungkin;
- telemetry bisa membuktikan traffic sudah memakai new cert.

### 7.4 CA Rollover Lebih Sulit daripada Leaf Certificate Renewal

Leaf certificate renewal:

```text
Same CA -> new server certificate
```

CA rollover:

```text
Old CA -> New CA
```

CA rollover membutuhkan truststore update di semua client sebelum server berpindah ke certificate dari CA baru.

Urutan aman:

1. Add new CA to all clients.
2. Verify all clients trust old + new CA.
3. Rotate server certificate to new CA.
4. Observe successful handshakes.
5. Remove old CA only after all old certificates are gone.

Jika urutannya dibalik, outage TLS hampir pasti terjadi.

---

## 8. Rotation Patterns by Secret Type

### 8.1 Database Password Rotation

#### Unsafe Pattern

```text
1. Change database password.
2. Update application secret.
3. Restart application.
```

Risiko:

- aplikasi lama langsung gagal membuat koneksi baru;
- rolling deployment bisa mixed state;
- rollback gagal karena old password sudah tidak valid;
- HikariCP error muncul bertahap.

#### Safer Pattern: Dual User

```text
1. Create db_user_v2 with same required privileges.
2. Store new credential in secret manager.
3. Rollout app using db_user_v2.
4. Observe no traffic from db_user_v1.
5. Revoke/disable db_user_v1.
```

Kelebihan:

- rollback masih bisa memakai user lama;
- audit lebih jelas;
- privilege bisa direview ulang;
- tidak tergantung single password mutation.

#### Safer Pattern: Multiple Password Support

Beberapa database/platform mendukung multiple passwords per user atau password rollover. Jika tersedia, ini lebih mudah:

```text
1. Add new password while old remains valid.
2. Roll app to new password.
3. Verify old password no longer used.
4. Remove old password.
```

Namun jangan mengasumsikan semua database mendukung ini.

### 8.2 OAuth Client Secret Rotation

Banyak IdP mendukung multiple active client secrets per client. Gunakan overlap.

```text
1. Add new client secret in IdP.
2. Update secret store.
3. Restart/reload Java app.
4. Observe token endpoint success using new secret.
5. Remove old secret.
```

Risiko umum:

- old secret dihapus sebelum semua pod restart;
- token cache menyembunyikan masalah sampai token expired;
- app hanya gagal setelah access token habis;
- rollout dianggap sukses terlalu cepat.

Verification harus mencakup token refresh, bukan hanya existing token usage.

### 8.3 API Key Rotation

Jika provider mendukung dua API key aktif:

```text
1. Generate new API key.
2. Add to secret store.
3. Roll app.
4. Validate actual external API call.
5. Revoke old key.
```

Jika provider tidak mendukung dua key:

- jadwalkan maintenance window;
- lakukan coordinated switch;
- siapkan rollback dengan re-enable old key jika possible;
- minimalkan TTL cache;
- lakukan synthetic call segera.

### 8.4 JWT Signing Key Rotation

JWT signing key rotation membutuhkan `kid`.

```text
JWKS before:
  kid=old

JWKS during rollover:
  kid=old
  kid=new

JWKS after old tokens expire:
  kid=new
```

Signer mulai menandatangani token baru dengan `kid=new`, tetapi verifier masih harus mempercayai `kid=old` sampai semua token lama expired.

Formula aman:

```text
old key removal time >= last old token issue time + max token lifetime + clock skew buffer
```

Anti-pattern:

- mengganti signing key dan langsung menghapus old key;
- verifier cache JWKS terlalu lama;
- token lifetime panjang tanpa rollover plan;
- tidak punya metric validasi per `kid`.

### 8.5 SAML Certificate Rotation

SAML sering memiliki metadata XML dengan signing/encryption certificate.

Aman jika:

- IdP/SP metadata mendukung multiple certificate;
- old and new cert overlap;
- partner diberi jadwal jauh sebelum expiry;
- metadata cache TTL dipahami;
- signature validation diuji sebelum cutover.

Risiko:

- partner cache metadata berhari-hari;
- certificate baru sudah dipasang tetapi partner belum refresh;
- signature encryption roles tertukar;
- timezone/validity window salah.

### 8.6 mTLS Client Certificate Rotation

Urutan aman:

```text
1. Server trusts CA/cert for old + new client cert.
2. Client receives new keypair/cert.
3. Client rolls to new certificate.
4. Server observes new client identity/fingerprint.
5. Server revokes/removes old client certificate trust.
```

Untuk mTLS, verifikasi bukan hanya “TLS success”, tetapi juga authorization mapping:

- subject DN;
- SAN URI/DNS;
- SPIFFE ID;
- certificate fingerprint;
- issuer;
- serial number;
- mapped service identity.

### 8.7 Server TLS Certificate Rotation

Jika Java app adalah HTTPS server:

```text
1. Obtain new server cert/key.
2. Ensure clients trust chain.
3. Deploy new keystore/cert.
4. Restart/reload server.
5. Validate TLS handshake externally.
6. Monitor expiry and fingerprint.
```

Jika memakai Kubernetes Ingress, certificate sering berhenti di ingress/controller, bukan Java app. Tetapi jika Java app terminates TLS sendiri, app harus punya keystore/reload strategy sendiri.

### 8.8 Truststore Rotation for Outbound Calls

Urutan aman untuk partner CA/cert rollover:

```text
1. Add new CA/cert to truststore while keeping old.
2. Roll/reload Java apps.
3. Partner rotates server certificate.
4. Verify outbound calls succeed.
5. Remove old CA/cert later.
```

Truststore rotation harus mendahului server certificate rotation.

---

## 9. Kubernetes Secrets and Java Deployment

### 9.1 Secret as Environment Variable

Contoh:

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: app-db
        key: password
```

Karakteristik:

- mudah dipakai;
- banyak framework langsung bisa baca;
- tidak berubah sampai pod restart;
- bisa bocor lewat process environment inspection;
- tidak cocok untuk hot reload.

Gunakan untuk secret yang memang restart-based.

### 9.2 Secret as Mounted Volume

Contoh:

```yaml
volumes:
  - name: db-secret
    secret:
      secretName: app-db

volumeMounts:
  - name: db-secret
    mountPath: /run/secrets/db
    readOnly: true
```

Karakteristik:

- secret tersedia sebagai file;
- Kubernetes dapat memperbarui projected secret volume secara eventually consistent;
- aplikasi harus membaca ulang file agar memakai value baru;
- lebih cocok untuk certificate/truststore file;
- file permission dapat dikontrol lebih baik.

### 9.3 Jangan Pakai `subPath` untuk Secret yang Perlu Update

Jika secret volume dipasang via `subPath`, update otomatis biasanya tidak diterima oleh container. Ini sering menjadi penyebab “Secret sudah berubah tapi aplikasi tetap pakai lama”.

Anti-pattern:

```yaml
volumeMounts:
  - name: tls-secret
    mountPath: /etc/tls/tls.crt
    subPath: tls.crt
```

Lebih aman:

```yaml
volumeMounts:
  - name: tls-secret
    mountPath: /etc/tls
    readOnly: true
```

### 9.4 Kubelet Propagation Delay

Ketika Kubernetes Secret diupdate, mounted volume di pod tidak berubah secara instan. Ada delay yang bergantung pada kubelet sync period dan cache propagation behavior.

Implikasi deployment:

- jangan mengasumsikan secret file langsung berubah detik itu juga;
- reload watcher harus toleran delay;
- verification harus mengecek file content/fingerprint di pod;
- restart-based rotation lebih deterministic jika perlu cutover ketat.

### 9.5 Secret Checksum Annotation Pattern

Karena env var secret butuh restart, common pattern:

```yaml
metadata:
  annotations:
    checksum/secret-app-db: "<sha256-of-secret-template>"
```

Saat secret berubah, annotation pod template berubah, sehingga Deployment membuat ReplicaSet baru.

Dalam Helm/Kustomize/GitOps, ini membuat secret change memicu rollout.

### 9.6 Immutable Secret Pattern

Daripada update secret in-place:

```text
app-db-secret -> updated value
```

Gunakan versioned secret:

```text
app-db-secret-v1
app-db-secret-v2
```

Lalu Deployment menunjuk ke secret baru.

Kelebihan:

- rollback lebih jelas;
- audit lebih mudah;
- menghindari ambiguity pod membaca versi mana;
- cocok untuk GitOps.

Kelemahan:

- cleanup harus disiplin;
- manifest lebih banyak;
- old secret harus dihapus setelah safe window.

### 9.7 Secret Store CSI Driver / External Secret Operator Pattern

Dalam beberapa platform, Kubernetes Secret bukan source of truth. Source of truth bisa Vault/AWS/GCP/Azure. Kubernetes hanya projection.

Pattern:

```text
Vault / AWS Secrets Manager / SSM
        |
        v
External Secrets Operator / CSI Driver
        |
        v
Kubernetes Secret or mounted file
        |
        v
Java Pod
```

Pertanyaan deployment:

- apakah update external secret otomatis memicu pod restart?
- apakah mounted file berubah?
- apakah app reload?
- bagaimana audit fetch dilakukan?
- bagaimana gagal jika secret manager unavailable?
- siapa punya permission read secret?

---

## 10. Spring Boot SSL Bundles and Rotation

Spring Boot modern menyediakan abstraksi SSL bundles untuk mengelola trust material dan key material secara lebih terstruktur.

Mental model:

```yaml
spring:
  ssl:
    bundle:
      jks:
        partner-api:
          truststore:
            location: file:/etc/ssl/partner-truststore.p12
            password: ${TRUSTSTORE_PASSWORD}
            type: PKCS12
```

Keuntungan:

- trust material menjadi named bundle;
- bisa dipakai oleh beberapa client/server integration;
- lebih eksplisit daripada global JVM properties;
- lebih mudah diuji;
- mengurangi modifikasi global `cacerts`.

Namun tetap ingat:

- tidak semua client otomatis reload;
- SSLContext yang sudah dibuat mungkin tetap lama;
- reload support tergantung versi/framework/component;
- harus diuji dengan actual handshake.

Deployment engineer tidak boleh hanya membaca fitur “supports SSL bundle”, lalu menganggap rotation solved. Yang harus dicek:

1. Apakah bundle reloadable?
2. Apakah consumer bundle melakukan re-create SSLContext?
3. Apakah connection pool lama ditutup?
4. Apakah failed reload membuat app down atau tetap memakai old material?
5. Apakah metric/log memperlihatkan active certificate fingerprint?

---

## 11. Java System Properties for TLS Deployment

Classic Java TLS config:

```bash
-Djavax.net.ssl.keyStore=/etc/tls/client.p12
-Djavax.net.ssl.keyStorePassword=${KEYSTORE_PASSWORD}
-Djavax.net.ssl.keyStoreType=PKCS12
-Djavax.net.ssl.trustStore=/etc/tls/truststore.p12
-Djavax.net.ssl.trustStorePassword=${TRUSTSTORE_PASSWORD}
-Djavax.net.ssl.trustStoreType=PKCS12
```

Kapan cocok:

- aplikasi sederhana;
- library memakai default JVM SSLContext;
- legacy system;
- app server global configuration;
- tidak perlu per-client trust policy.

Kapan kurang cocok:

- satu aplikasi memanggil banyak partner dengan trust policy berbeda;
- butuh reload granular;
- butuh mTLS hanya untuk client tertentu;
- butuh observability per connection;
- ingin menghindari global trust expansion.

Untuk top 1% engineering, hindari kebiasaan “tambahkan semua CA ke truststore global”. Lebih baik buat trust boundary eksplisit per dependency bila memungkinkan.

---

## 12. Rotation Timeline Blueprint

Gunakan blueprint ini untuk hampir semua rotasi.

```text
Phase 0 — Inventory
  Identify secret/cert, owner, consumer, issuer, expiry, blast radius.

Phase 1 — Prepare
  Generate new material, store securely, validate format, define rollback.

Phase 2 — Enable Overlap
  Make dependency accept old + new, or add new trust before cutover.

Phase 3 — Deploy Consumers
  Roll/reload Java apps to use new material.

Phase 4 — Verify
  Prove actual runtime uses new material.

Phase 5 — Revoke Old
  Remove old material after no usage is observed.

Phase 6 — Evidence
  Record fingerprints, deployment versions, timestamps, approvals, metrics.
```

### 12.1 Phase 0 — Inventory

Checklist:

- What is being rotated?
- Who owns it?
- Where is source of truth?
- Which apps consume it?
- Which environments are affected?
- Does it expire?
- Does it have emergency revocation requirement?
- Is old+new overlap possible?
- Does app require restart or reload?
- Is there a connection pool?
- Is there token cache?
- Is there metadata cache?
- Is there external partner coordination?
- How will we prove cutover?

### 12.2 Phase 1 — Prepare

Checklist:

- Generate new secret/cert/key.
- Validate key size/algorithm.
- Validate certificate chain.
- Validate SAN/CN/issuer.
- Validate keystore password.
- Validate file permission.
- Validate app can read file.
- Validate in lower environment.
- Prepare rollback secret.
- Prepare old removal date.

### 12.3 Phase 2 — Enable Overlap

Examples:

- Add new DB user while old still active.
- Add new OAuth client secret.
- Add new signing key to JWKS before using it.
- Add new CA to truststore before server cert switches.
- Add new SAML certificate to metadata before signing with it.

### 12.4 Phase 3 — Deploy Consumers

For Kubernetes:

```bash
kubectl rollout restart deployment/my-java-service
kubectl rollout status deployment/my-java-service
```

For systemd:

```bash
sudo systemctl restart my-java-service
sudo systemctl status my-java-service
```

For reloadable app, prefer explicit admin operation if available:

```text
POST /internal/reload-tls-material
```

But do not expose this endpoint publicly.

### 12.5 Phase 4 — Verify

Weak verification:

```text
Pod is running.
```

Better verification:

```text
Pod is ready.
Synthetic transaction succeeds.
Outbound TLS handshake succeeds.
Database new connection succeeds.
Token refresh with new client secret succeeds.
Logs show new certificate fingerprint.
Metrics show zero auth failures.
```

Best verification:

```text
Dependency-side logs prove new credential/fingerprint/kid/client cert is being used.
Old credential usage metric is zero for agreed safe window.
```

### 12.6 Phase 5 — Revoke Old

Only revoke after proof.

Examples:

- disable old DB user;
- delete old API key;
- remove old OAuth client secret;
- remove old JWKS key after tokens expire;
- remove old CA/cert from truststore;
- revoke old certificate;
- delete old Kubernetes Secret.

### 12.7 Phase 6 — Evidence

Record:

- request/change ID;
- old fingerprint/alias, if safe;
- new fingerprint/alias;
- affected services;
- deployment versions;
- rollout timestamp;
- verification evidence;
- revocation timestamp;
- approver;
- rollback decision;
- incidents/anomalies.

---

## 13. Restart vs Reload Decision Framework

Use this decision matrix.

| Question | If Yes | If No |
|---|---|---|
| Is the secret read from env var? | Restart required | File/fetch reload may be possible |
| Does app create connection/SSL object once? | Restart or explicit object refresh | Reload easier |
| Does framework support safe reload? | Consider reload | Prefer restart |
| Is material short-lived? | Need dynamic refresh | Restart may be too heavy |
| Is dependency highly critical? | Prefer deterministic restart with rollout | Reload okay if proven |
| Can old+new overlap? | Safer rollout | Need coordinated cutover |
| Is reload observable? | Acceptable | Dangerous |
| Can failed reload rollback in memory? | Acceptable | Prefer restart |

Pragmatic rule:

> Default to restart-based rotation unless you have explicitly engineered, tested, and observed reload semantics.

Reload is not automatically more mature. Unverified reload is often more dangerous than a controlled rolling restart.

---

## 14. Connection Pool Rotation

### 14.1 Database Pool

If database credential changes, the connection pool must eventually create new connections with new credential.

Failure mode:

```text
T0: Password changed.
T1: Existing connections still work.
T2: Pool retires old connection.
T3: New connection fails.
T4: App degrades gradually.
```

Mitigation:

- dual credential/user overlap;
- rolling restart app after secret update;
- explicitly evict pool after updating datasource config;
- synthetic query that forces new connection;
- metric for connection acquisition failure.

### 14.2 HTTP Client Pool

For mTLS or truststore rotation:

- pooled TLS connections may stay open;
- new handshakes use new/old SSLContext depending object refresh;
- HTTP/2 long-lived connections can hide rotation issue;
- connection eviction may be required.

Verification must force new TLS connection, not reuse existing one.

### 14.3 Message Broker Connections

RabbitMQ/Kafka credentials are usually bound at connection creation.

Rotation requires:

- new credential accepted by broker;
- consumers restarted or connection factory refreshed;
- old connection drained;
- unacked messages handled;
- consumer group/rebalance observed.

Do not rotate broker credentials without understanding consumer shutdown semantics.

---

## 15. Certificate Expiry Monitoring

A mature deployment system tracks expiry before outage.

Monitor:

- inbound server cert expiry;
- outbound partner server cert expiry;
- mTLS client cert expiry;
- CA/intermediate expiry;
- keystore/truststore cert aliases;
- SAML signing cert expiry;
- JWKS key rotation schedule;
- Kubernetes TLS Secret certificate expiry;
- cert-manager Certificate status;
- external API certificate chain.

Suggested alert levels:

```text
90 days: planning alert
60 days: owner escalation
30 days: change ticket required
14 days: urgent escalation
7 days: incident-risk alert
3 days: emergency escalation
1 day: page/on-call
```

Expiry is not an “unexpected incident” if the system had the certificate metadata. It is a missed operational control.

---

## 16. Keystore/Truststore Inspection Commands

### 16.1 List Keystore

```bash
keytool -list \
  -keystore keystore.p12 \
  -storetype PKCS12 \
  -storepass "$KEYSTORE_PASSWORD" \
  -v
```

### 16.2 List Truststore

```bash
keytool -list \
  -keystore truststore.p12 \
  -storetype PKCS12 \
  -storepass "$TRUSTSTORE_PASSWORD" \
  -v
```

### 16.3 Show Certificate Fingerprint

```bash
keytool -list \
  -keystore truststore.p12 \
  -storetype PKCS12 \
  -storepass "$TRUSTSTORE_PASSWORD" \
  -alias partner-api-ca \
  -v
```

### 16.4 Inspect Remote TLS Certificate

```bash
openssl s_client -connect api.partner.example.com:443 -servername api.partner.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -fingerprint -sha256
```

### 16.5 Inspect Kubernetes TLS Secret

```bash
kubectl get secret partner-client-tls -o jsonpath='{.data.tls\.crt}' \
  | base64 -d \
  | openssl x509 -noout -subject -issuer -dates -fingerprint -sha256
```

### 16.6 Compare Mounted Cert Inside Pod

```bash
kubectl exec deploy/my-java-service -- \
  sh -c "openssl x509 -in /etc/tls/tls.crt -noout -subject -issuer -dates -fingerprint -sha256"
```

If `openssl` is not available in production image, use a debug pod or ephemeral debug container according to platform policy.

---

## 17. Secure File Permission Patterns

### 17.1 Linux Permission

Private key should not be world-readable.

Example:

```text
/etc/myapp/tls/client.key  0400 or 0440
/etc/myapp/tls/client.crt  0444 or 0440
/etc/myapp/tls/truststore.p12 0440
```

Run app as non-root user:

```text
user: myapp
group: myapp
```

### 17.2 Kubernetes Security Context

Example:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
  readOnlyRootFilesystem: true
```

Secret volume default mode:

```yaml
volumes:
  - name: client-tls
    secret:
      secretName: client-tls-v2
      defaultMode: 0400
```

Be careful: if app needs group read, use `0440` and correct `fsGroup`.

---

## 18. Secret Exposure Anti-Patterns

### 18.1 Secrets in Command Line Arguments

Bad:

```bash
java -Ddb.password=supersecret -jar app.jar
```

Risk:

- appears in process list;
- appears in logs;
- appears in crash reports;
- appears in deployment manifest;
- appears in monitoring.

Prefer file/env secret injection, or secret manager fetch.

### 18.2 Secrets in Logs

Bad:

```text
Connecting to jdbc:oracle:thin:@... user=app password=Secret123
```

Mitigation:

- log redaction;
- avoid dumping full config;
- mask environment variables;
- review exception messages;
- configure framework sanitization.

### 18.3 Secrets in Git

Never commit:

- `.p12` with private key;
- `.jks` with private key;
- `.env` with real values;
- Kubernetes Secret YAML with base64 real secret;
- Terraform state containing plaintext secret without secure backend;
- generated private keys.

### 18.4 One Shared Secret Across Many Services

Bad:

```text
All services use same DB user or same API key.
```

Consequence:

- huge blast radius;
- hard rotation;
- poor audit;
- no per-service revocation.

Prefer per-service credential.

### 18.5 Secret Without Owner

Every secret should have:

- owner;
- purpose;
- environment;
- created date;
- expiry;
- rotation policy;
- dependency;
- revocation procedure.

Secret without owner becomes future outage.

---

## 19. Zero-Downtime Rotation Patterns

### 19.1 Additive Truststore Pattern

Before partner rotates cert, deploy truststore containing both old and new CA/cert.

```text
truststore v1: old-ca
truststore v2: old-ca + new-ca
truststore v3: new-ca
```

Deployment order:

```text
Deploy v2 -> Partner rotates -> Verify -> Deploy v3 later
```

### 19.2 Dual Credential Pattern

```text
credential v1 active
credential v2 active
apps move to v2
credential v1 disabled
```

### 19.3 Versioned Secret Pattern

```text
app-db-v1
app-db-v2
```

Deployment chooses explicit version.

### 19.4 Key ID Pattern

JWT/JWKS:

```json
{
  "keys": [
    { "kid": "2026-01-old", "kty": "RSA", ... },
    { "kid": "2026-06-new", "kty": "RSA", ... }
  ]
}
```

Signer uses new `kid`, verifier keeps old until token expiry.

### 19.5 Sidecar/Agent Refresh Pattern

A sidecar writes refreshed secret/cert to shared volume.

```text
Vault Agent / cert agent -> shared volume -> Java app
```

Still requires Java app to reload or restart.

### 19.6 Short-Lived Identity Pattern

Instead of rotating long-lived secrets manually, issue short-lived credentials automatically.

Examples:

- dynamic DB credentials;
- workload identity token;
- SPIFFE SVID;
- STS temporary credentials.

This reduces long-lived secret risk but increases dependency on identity infrastructure.

---

## 20. Emergency Rotation Runbook

Emergency rotation is needed when secret/private key is suspected compromised.

### 20.1 Triage

Ask:

- What material leaked?
- Is it private key, password, token, certificate, or trust material?
- Which environments?
- Which services?
- What privileges?
- Is attacker activity observed?
- Can old material be disabled immediately without outage?
- Is dual credential possible?
- What is regulatory/audit notification requirement?

### 20.2 Contain

- restrict access;
- disable exposed credential if safe;
- rotate access logs/audit review;
- block suspicious source if applicable;
- pause deployments that could propagate wrong state.

### 20.3 Replace

- generate new material securely;
- update issuer/provider;
- update secret store;
- rollout/reload consumers;
- verify actual usage;
- revoke old material.

### 20.4 Validate

- authentication success;
- authorization correct;
- no fallback to old credential;
- no unexpected error spike;
- no failed TLS handshake spike;
- no DB pool failure;
- no queue consumer disconnect storm;
- audit logs show expected identity.

### 20.5 Post-Incident

- root cause;
- exposure window;
- affected systems;
- secrets scanned;
- hardcoded occurrences removed;
- detection improved;
- owner updated;
- rotation automation improved;
- training/checklist updated.

---

## 21. Concrete Deployment Scenarios

### 21.1 Scenario A — Rotate Database Password in Spring Boot on Kubernetes

Assume:

- Spring Boot app;
- HikariCP;
- DB credential from Kubernetes Secret env var;
- rolling deployment.

Recommended:

```text
1. Create new DB user/password or add second password if supported.
2. Update Kubernetes Secret or create versioned Secret.
3. Change Deployment to reference new secret version.
4. Rollout Deployment.
5. Watch readiness, DB connection acquisition, error logs.
6. Force synthetic query through new pod.
7. Confirm DB audit shows new user/credential.
8. Revoke old user/password.
9. Delete old Kubernetes Secret after retention window.
```

YAML sketch:

```yaml
env:
  - name: SPRING_DATASOURCE_USERNAME
    valueFrom:
      secretKeyRef:
        name: app-db-v2
        key: username
  - name: SPRING_DATASOURCE_PASSWORD
    valueFrom:
      secretKeyRef:
        name: app-db-v2
        key: password
```

Why not hot reload?

Because datasource and pool credential are usually startup-bound unless explicitly engineered.

### 21.2 Scenario B — Add New Partner API CA Before Partner Certificate Rotation

Assume Java app calls partner API over HTTPS.

Recommended:

```text
1. Obtain new partner CA/intermediate cert.
2. Create truststore v2 containing old + new.
3. Deploy truststore v2 to Java apps.
4. Restart/reload apps.
5. Verify outbound calls still work.
6. Ask partner to rotate cert.
7. Verify TLS handshake with new chain.
8. Later create truststore v3 with only new CA.
9. Deploy v3 after old chain no longer used.
```

Key invariant:

> Clients must trust new chain before server presents new chain.

### 21.3 Scenario C — Rotate mTLS Client Certificate

Recommended:

```text
1. Server side adds trust/authorization mapping for new client cert.
2. Generate new client keypair/cert.
3. Store as new Kubernetes TLS Secret.
4. Deploy Java client with new keystore/cert.
5. Force new connection, avoid reusing old HTTP pool.
6. Server logs confirm new client certificate identity.
7. Remove old client cert mapping.
8. Revoke old cert.
```

Important:

- verify certificate subject/SAN mapping;
- verify not only TLS success but business authorization;
- verify HTTP client pool does not hide old connection.

### 21.4 Scenario D — Rotate JWT Signing Key

Recommended:

```text
1. Generate new signing key with kid=new.
2. Publish JWKS with old + new keys.
3. Wait for verifier JWKS cache to refresh.
4. Start signing new tokens with kid=new.
5. Wait max token lifetime + clock skew.
6. Remove old key from JWKS.
7. Monitor token validation failures.
```

Do not remove old key immediately after switching signer.

### 21.5 Scenario E — Rotate SMTP Password

SMTP often has limited observability.

Recommended:

```text
1. Create new SMTP credential if possible.
2. Update secret store.
3. Restart mail sender service.
4. Send synthetic test email to controlled mailbox.
5. Verify SMTP provider auth logs.
6. Disable old SMTP credential.
```

Do not rely only on application startup health; mail failure may appear only when first email is sent.

---

## 22. Observability for Rotation

A rotation is not complete until observable.

### 22.1 Logs

Useful logs:

```text
Loaded truststore alias count=3 source=/etc/ssl/truststore.p12 fingerprint=...
Using mTLS client certificate subject=... serial=... notAfter=...
OAuth token refresh succeeded provider=... client_id=...
Database connection pool initialized user=app_v2 jdbc_url=...
```

Avoid logging actual secrets.

### 22.2 Metrics

Useful metrics:

```text
secret_reload_success_total
secret_reload_failure_total
certificate_days_until_expiry
tls_handshake_failure_total
outbound_auth_failure_total
db_connection_acquire_failure_total
oauth_token_refresh_failure_total
jwt_validation_failure_by_kid_total
active_certificate_not_after_timestamp
```

### 22.3 Traces

Traces can help correlate:

- token refresh latency;
- TLS handshake failures;
- outbound dependency failure;
- retry storm after rotation;
- partial failure only in one zone/node.

### 22.4 Dependency-Side Evidence

Best evidence comes from the dependency:

- DB audit shows user `app_v2`;
- API provider logs show new key ID;
- mTLS server logs show new client cert serial;
- IdP logs show new client secret use;
- JWKS verifier metrics show `kid=new`.

---

## 23. Failure Modes and Diagnosis

### 23.1 Secret Updated, App Still Uses Old Value

Possible causes:

- secret injected as env var;
- pod not restarted;
- Kubernetes projected volume delay;
- mounted via `subPath`;
- app cached value;
- connection pool still alive;
- SSLContext not recreated;
- wrong namespace/secret name;
- GitOps did not sync;
- external secret operator lag.

Diagnosis:

```bash
kubectl describe pod <pod>
kubectl exec <pod> -- env | grep DB
kubectl exec <pod> -- ls -l /run/secrets
kubectl exec <pod> -- sha256sum /run/secrets/db/password
kubectl rollout history deploy/my-service
```

### 23.2 TLS Handshake Fails After Cert Rotation

Possible causes:

- client does not trust new CA;
- missing intermediate certificate;
- server certificate SAN mismatch;
- expired certificate;
- wrong key/cert pair;
- client still using old truststore;
- Java disabled old TLS algorithm;
- SNI mismatch;
- app server not reloaded;
- certificate chain order wrong.

Diagnosis:

```bash
openssl s_client -connect host:443 -servername host -showcerts
keytool -list -keystore truststore.p12 -storetype PKCS12 -v
```

In Java, enable TLS debug only carefully in non-prod or short controlled windows:

```bash
-Djavax.net.debug=ssl,handshake
```

Beware log volume and sensitive details.

### 23.3 DB Works Initially Then Fails Later

Possible causes:

- existing pool connections were authenticated before password change;
- new connections fail after old ones retire;
- database user lacks privilege;
- DNS/service endpoint changed;
- app restarted subset only;
- old and new pods use different credentials.

Diagnosis:

- check Hikari connection acquisition errors;
- force pool recycle in lower env;
- verify DB audit login user;
- compare pod env/secret version;
- check rollout status.

### 23.4 OAuth Token Refresh Fails After Secret Rotation

Possible causes:

- old access token still valid during verification;
- refresh happens later and fails;
- new client secret not activated;
- wrong client ID/secret pair;
- secret whitespace/newline issue;
- token endpoint cache/replication delay;
- clock skew.

Verification:

- force token refresh;
- revoke cached token in test;
- check IdP logs;
- compare client secret version.

### 23.5 JWT Validation Fails Randomly

Possible causes:

- signer uses new `kid`, verifier JWKS cache lacks new key;
- old key removed before old tokens expired;
- multiple issuers with inconsistent JWKS;
- clock skew;
- cache TTL too long;
- deployment skew between auth service and resource service.

Mitigation:

- publish new key before signing;
- keep old key until token expiry;
- reduce JWKS cache TTL during rotation;
- monitor validation failure by `kid`.

---

## 24. Designing a Secret Rotation Capability

A mature organization does not rotate secrets manually forever. It designs a capability.

### 24.1 Inventory System

Track:

- secret ID;
- owner;
- service;
- environment;
- dependency;
- type;
- source of truth;
- expiry;
- rotation frequency;
- last rotated;
- next rotation;
- emergency contact;
- rollback method.

### 24.2 Standard Secret Types

Define templates:

```text
DB_CREDENTIAL
OAUTH_CLIENT_SECRET
API_KEY
MTLS_CLIENT_CERT
SERVER_TLS_CERT
TRUSTSTORE
JWT_SIGNING_KEY
SAML_SIGNING_CERT
SMTP_CREDENTIAL
BROKER_CREDENTIAL
```

Each type has different rotation runbook.

### 24.3 Automation Boundaries

Automate:

- secret creation;
- storage;
- deployment manifest update;
- rollout restart;
- expiry alert;
- fingerprint extraction;
- audit evidence capture.

Do not blindly automate revocation without verification gates.

### 24.4 Rotation as Release

Treat secret rotation as a release:

- planned change;
- risk assessment;
- rollout plan;
- rollback plan;
- verification plan;
- evidence;
- post-change cleanup.

Secret rotation can cause more impact than code deployment.

---

## 25. Java 8 to Java 25 Practical Notes

### 25.1 Java 8

Expect:

- legacy app server;
- JKS assumptions;
- manual `cacerts` modifications;
- older TLS/cipher defaults;
- less framework-level SSL abstraction;
- more global JVM properties;
- more vendor-specific deployment.

Recommendation:

- externalize truststore;
- document aliases and fingerprints;
- avoid editing shared runtime;
- test TLS with target JDK update level;
- plan migration to PKCS12/custom truststore.

### 25.2 Java 11/17

Expect:

- stronger TLS defaults;
- more container deployments;
- more Spring Boot executable JAR;
- more PKCS12 use;
- better tooling and observability.

Recommendation:

- standardize secret injection;
- use dedicated truststore per app/dependency;
- adopt cert expiry metrics;
- use rollout restart for static secrets.

### 25.3 Java 21/25

Expect:

- modern container platform;
- Spring Boot SSL bundles or equivalent abstractions;
- OpenTelemetry agent;
- workload identity;
- virtual threads in some apps;
- stronger platform automation.

Recommendation:

- avoid long-lived static credentials where possible;
- prefer identity-based access;
- implement reload only with strong tests/observability;
- make certificate/key metadata part of health/diagnostic endpoint.

---

## 26. Health Check Design for Secret Rotation

Health checks need nuance.

### 26.1 Liveness Should Not Depend on External Secret Dependency

Bad:

```text
/liveness checks database auth, IdP, partner API, SMTP
```

If dependency has issue, Kubernetes may restart pods unnecessarily and cause storm.

### 26.2 Readiness May Include Critical Dependency

Readiness can check whether app can serve traffic. For rotation, readiness may verify:

- DB connection available;
- truststore loaded;
- required secret readable;
- required certificate not expired;
- token provider reachable if needed at request time.

But avoid expensive external checks on every probe.

### 26.3 Startup Check Can Validate Secret Format

At startup:

- fail fast if keystore unreadable;
- fail fast if password wrong;
- fail fast if certificate expired;
- fail fast if required alias missing;
- fail fast if private key mismatch.

This prevents pod becoming ready with broken security material.

### 26.4 Diagnostic Endpoint

Internal-only diagnostic endpoint could show safe metadata:

```json
{
  "truststores": [
    {
      "name": "partner-api",
      "aliases": ["partner-ca-2026"],
      "minDaysUntilExpiry": 182
    }
  ],
  "mtls": {
    "clientCertSubject": "CN=my-service",
    "serialNumber": "redacted-or-safe",
    "daysUntilExpiry": 88
  }
}
```

Never expose secrets, private keys, passwords, or full token values.

---

## 27. Rollback Strategy for Secret Rotation

Rollback is often misunderstood.

### 27.1 Code Rollback Is Not Secret Rollback

If application version rolls back but secret already changed, old app may fail.

You need matrix:

| App Version | Secret Version | Dependency State | Safe? |
|---|---|---|---|
| v1 | secret old | dependency old | yes |
| v1 | secret new | dependency accepts new | maybe |
| v2 | secret old | dependency accepts old | maybe |
| v2 | secret new | dependency new | yes |
| v1 | secret old | old revoked | no |

### 27.2 Keep Old Credential Until Rollback Window Ends

For critical deployments:

```text
Do not revoke old credential until after deployment stability window.
```

Stability window depends on:

- traffic volume;
- token lifetime;
- connection pool lifetime;
- batch schedule;
- queue consumer cycle;
- partner processing delay;
- business risk.

### 27.3 Rollback Truststore Carefully

If you remove new CA too early and server has rotated, rollback to old truststore breaks outbound calls.

Rollback truststore must match peer certificate state.

---

## 28. Governance and Auditability

For enterprise/regulatory systems, rotation evidence matters.

### 28.1 Change Record Should Include

- reason for rotation;
- planned date/time;
- affected services;
- affected environments;
- old material identifier/fingerprint;
- new material identifier/fingerprint;
- expiry date;
- dependency owner;
- implementation plan;
- rollback plan;
- verification plan;
- revocation plan;
- approvers;
- execution evidence.

Do not include secret values in change records.

### 28.2 Segregation of Duties

A mature process may separate:

- secret generation;
- secret approval;
- deployment execution;
- verification;
- audit review.

But process must not become so slow that secrets expire before rotation.

### 28.3 Evidence Without Leakage

Good evidence:

- certificate fingerprint;
- serial number;
- alias;
- `notBefore`/`notAfter`;
- deployment version;
- rollout status;
- synthetic check result;
- dependency audit log excerpt.

Bad evidence:

- password screenshot;
- private key content;
- full token;
- base64 Kubernetes Secret YAML;
- `.p12` attachment.

---

## 29. Production-Grade Checklist

### 29.1 Before Rotation

- [ ] Secret/cert owner known.
- [ ] Consumers identified.
- [ ] Source of truth identified.
- [ ] Expiry known.
- [ ] Rotation type selected: restart/reload/dual/indirection.
- [ ] Old+new overlap confirmed.
- [ ] Rollback path confirmed.
- [ ] Lower environment tested.
- [ ] Monitoring in place.
- [ ] Change window approved.
- [ ] Communication sent.

### 29.2 During Rotation

- [ ] New material generated securely.
- [ ] New material validated.
- [ ] Secret store updated.
- [ ] Dependency accepts new material.
- [ ] Apps rolled/reloaded.
- [ ] Readiness stable.
- [ ] Synthetic transaction passed.
- [ ] Dependency-side evidence captured.
- [ ] Error rates normal.
- [ ] No unexpected auth/TLS failures.

### 29.3 After Rotation

- [ ] Old material usage is zero.
- [ ] Old material revoked/disabled.
- [ ] Old secret removed or scheduled for removal.
- [ ] Truststore cleanup planned.
- [ ] Expiry monitor updated.
- [ ] Change evidence attached.
- [ ] Runbook updated with lessons learned.

---

## 30. Top 1% Engineering Principles

### Principle 1 — Know When Material Is Loaded

The most important question:

> When does the Java process read this secret/certificate/truststore, and who caches it?

If you cannot answer this, rotation is unsafe.

### Principle 2 — Prefer Overlap Over Big Bang

Big bang rotation is fragile.

Safe systems use:

- dual credential;
- dual trust;
- versioned keys;
- staged rollout;
- delayed revocation.

### Principle 3 — Verification Must Exercise New Material

“App is running” is not enough.

You must prove:

- new DB credential used;
- new client secret used for token refresh;
- new certificate used in TLS handshake;
- new truststore validates peer;
- old credential no longer used before revocation.

### Principle 4 — Restart Is Often More Reliable Than Untested Reload

Hot reload is good only if engineered.

If reload path is not tested, observable, and rollback-safe, controlled rolling restart is usually safer.

### Principle 5 — Truststore Is Security Policy

Truststore updates change who the app trusts.

Treat truststore as carefully as code.

### Principle 6 — Never Let Expiry Become Surprise

Certificate expiry is predictable. Secret expiry is often policy-defined. Outage from expiry is usually a process failure.

### Principle 7 — Separate Identity, Secret, Trust, and Authorization

mTLS success does not mean authorization success. Token validation success does not mean role mapping correct. Secret authentication success does not mean least privilege.

### Principle 8 — Rotation Is Not Complete Until Old Material Is Removed

Leaving old keys forever is not rotation. It is addition.

A rotation has two halves:

```text
adopt new + remove old
```

---

## 31. Mini Case Study: Partner API CA Rollover Incident

### Situation

A Java service calls a partner API. Partner announces certificate renewal. Team updates partner certificate on the day of renewal.

### What Went Wrong

The team misunderstood direction of trust.

They thought:

```text
Partner rotates certificate -> then Java truststore updated
```

Correct order:

```text
Java truststore updated to trust new CA -> partner rotates certificate
```

### Incident

After partner switch:

```text
javax.net.ssl.SSLHandshakeException:
PKIX path building failed
```

Only some pods failed because some had old truststore, some had new truststore, and some reused existing HTTP connections.

### Root Causes

- no certificate inventory;
- no overlap truststore;
- no pre-rotation synthetic handshake;
- truststore mounted as file but app did not reload;
- rollout status checked only pod readiness;
- old/new pod versions mixed;
- no dependency-side verification.

### Corrected Runbook

```text
1. Create truststore v2 with old + new CA.
2. Roll all apps to v2 two weeks before partner cutover.
3. Verify outbound TLS to test endpoint using new chain.
4. Partner rotates certificate.
5. Force new HTTP connection synthetic check.
6. Observe TLS handshake success.
7. After safe window, deploy truststore v3 with only new CA.
```

---

## 32. Practice Exercises

### Exercise 1 — Database Credential Rotation Plan

Design a zero-downtime rotation for:

- Spring Boot app;
- HikariCP;
- Oracle/PostgreSQL database;
- Kubernetes Secret env var;
- 6 replicas;
- rolling update;
- old password must be revoked within 24 hours.

Answer should include:

- whether to use dual user or password update;
- rollout order;
- verification;
- rollback;
- revocation evidence.

### Exercise 2 — mTLS Client Cert Rotation

Design rotation for:

- Java service calling regulatory gateway;
- mTLS client cert expires in 30 days;
- gateway validates subject DN;
- app uses Apache HttpClient pool;
- certificate mounted as Kubernetes Secret.

Answer should include:

- server-side trust preparation;
- client keystore update;
- HTTP pool behavior;
- verification of new client cert;
- old cert revocation.

### Exercise 3 — JWT Signing Key Rotation

Design key rotation for:

- auth service signs JWT;
- resource services cache JWKS for 10 minutes;
- access token lifetime 1 hour;
- refresh token lifetime 7 days;
- signing key must rotate quarterly.

Answer should include:

- JWKS phases;
- `kid` strategy;
- old key removal time;
- monitoring.

### Exercise 4 — Truststore Cleanup

A truststore contains 17 partner certificates, many expired. Design cleanup without outage.

Answer should include:

- inventory;
- mapping cert aliases to dependencies;
- lower environment test;
- staged removal;
- monitoring;
- rollback.

---

## 33. Summary

Secret and certificate rotation is a deployment discipline, not a small configuration chore.

The central model:

```text
issuer/provider accepts new material
secret store contains new material
runtime propagates new material
Java app actually loads new material
dependency verifies/authenticates new material
old material remains during safe overlap
old material is revoked after proof
```

For Java applications, the hardest part is not storing the new value. The hardest part is knowing **when the JVM/framework/client/pool actually uses it**.

A top-tier deployment engineer can reason about:

- env var vs mounted file vs dynamic fetch;
- restart vs reload;
- keystore vs truststore;
- TLS vs mTLS;
- CA rollover vs leaf certificate renewal;
- connection pool behavior;
- JWT `kid` rollover;
- Kubernetes secret propagation;
- old+new overlap;
- verification evidence;
- rollback matrix;
- revocation timing;
- audit trail.

This is the difference between “the secret has been changed” and “the production system has safely migrated to the new trust/identity state.”

---

## 34. References

- Oracle Java Platform `KeyStore` API documentation.
- Oracle Java `keytool` documentation.
- Kubernetes Secrets documentation.
- Kubernetes projected volumes documentation.
- cert-manager Certificate documentation.
- Spring Boot SSL documentation.
- Spring Boot SSL Bundles documentation.
- Java JSSE/TLS system property conventions.
- Common production patterns for OAuth, SAML, mTLS, JWT/JWKS, and database credential rotation.

---

## 35. Status Seri

Selesai: **Part 20 dari 35**.

Belum selesai. Berikutnya:

**Part 21 — Observability-Ready Deployment**
