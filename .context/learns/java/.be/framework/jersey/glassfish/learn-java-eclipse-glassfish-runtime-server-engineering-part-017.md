# learn-java-eclipse-glassfish-runtime-server-engineering-part-017  
# Part 17 — Security Runtime: Realm, Principal, Role Mapping, TLS, Admin Security, dan Secret Handling

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 17 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **security runtime GlassFish**, bukan pengulangan teori authentication/authorization umum

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami bagaimana GlassFish mengeksekusi security dari sudut pandang runtime;
2. membedakan konsep **realm**, **user**, **group**, **principal**, dan **role**;
3. memahami role mapping antara aplikasi dan identitas runtime;
4. mengelola admin security secara aman;
5. memahami penggunaan keystore, truststore, TLS listener, dan certificate realm;
6. menggunakan password alias dan master password dengan benar;
7. mengetahui batasan secret handling GlassFish;
8. membuat baseline hardening keamanan GlassFish untuk environment enterprise;
9. mendiagnosis failure security seperti 401, 403, realm mismatch, TLS handshake failure, dan admin access issue.

Part ini **tidak** akan mengulang detail Jakarta Security, Servlet Security, JWT, OAuth2, OIDC, Keycloak, atau konsep authentication/authorization umum yang sudah dibahas pada seri sebelumnya. Fokusnya adalah bagaimana semua itu menyentuh GlassFish sebagai **runtime enforcement layer**.

---

## 1. Mental Model: Security di GlassFish Itu Bukan Satu Fitur

Kesalahan umum ketika melihat security application server adalah menganggap security hanya berupa:

- login form;
- user/password;
- role;
- HTTPS;
- admin password.

Di GlassFish, security lebih tepat dipahami sebagai beberapa lapisan yang saling terkait:

```text
[Network Boundary]
  |
  |-- TLS / mTLS / listener security
  |
[Runtime Administration Boundary]
  |
  |-- admin user
  |-- secure admin
  |-- admin listener
  |-- password file
  |
[Identity Boundary]
  |
  |-- realm
  |-- user
  |-- group
  |-- principal
  |
[Application Authorization Boundary]
  |
  |-- app roles
  |-- declared roles
  |-- role mapping
  |-- container enforcement
  |
[Resource Boundary]
  |
  |-- JDBC resource
  |-- JMS resource
  |-- connector resource
  |-- password alias
  |
[Operational Boundary]
  |
  |-- log access
  |-- audit
  |-- keystore/truststore
  |-- file permission
  |-- secrets lifecycle
```

Top 1% engineer tidak hanya bertanya:

> "Bagaimana cara login?"

Melainkan:

> "Boundary mana yang sedang meng-enforce security? Identitas apa yang terlihat di boundary itu? Role apa yang dipakai aplikasi? Secret mana yang hidup di server? Konfigurasi mana yang mutable? Apa failure mode jika salah satu lapisan ini berubah?"

---

## 2. GlassFish sebagai Security Enforcement Runtime

GlassFish bukan hanya menjalankan bytecode aplikasi. Ia juga:

1. menerima koneksi network;
2. memutuskan apakah koneksi boleh masuk;
3. menegosiasikan TLS;
4. memuat credential store tertentu;
5. menjalankan authentication mechanism aplikasi;
6. mengambil user/principal dari realm;
7. memetakan group/principal ke role aplikasi;
8. memutuskan apakah request boleh masuk ke resource;
9. mengelola credential resource seperti DB/JMS;
10. mengamankan admin API dan admin console.

Artinya, security di GlassFish adalah gabungan dari:

- **platform security**: keamanan proses server dan admin surface;
- **transport security**: TLS, certificate, truststore;
- **identity store integration**: file realm, JDBC realm, LDAP realm, certificate realm, custom realm;
- **application authorization**: deklarasi role dan role mapping;
- **secret management**: password alias, master password, password file;
- **runtime isolation**: classloading, target, domain, instance;
- **operational security**: log, audit, patching, file permission.

---

## 3. Istilah Fundamental: User, Group, Principal, Role, Realm

Sebelum masuk detail GlassFish, kita harus meluruskan model istilahnya.

### 3.1 Realm

**Realm** adalah sumber atau mekanisme yang dipakai GlassFish untuk memvalidasi identitas.

Contoh realm:

- file realm;
- admin realm;
- JDBC realm;
- LDAP realm;
- certificate realm;
- custom realm.

Realm menjawab pertanyaan:

> "User ini valid atau tidak, dan ia membawa group apa?"

Realm bukan role aplikasi. Realm adalah identity source.

---

### 3.2 User

**User** adalah identitas yang dikenal oleh realm.

Contoh:

```text
alice
bob
system-admin
batch-user
```

Pada file realm, user disimpan di file keyfile.  
Pada JDBC realm, user disimpan di tabel database.  
Pada LDAP realm, user berasal dari directory server.  
Pada certificate realm, user dapat berasal dari subject certificate.

---

### 3.3 Group

**Group** adalah kategori identitas dari sisi realm.

Contoh:

```text
admin
case-officer
supervisor
finance-user
external-agency
```

Group biasanya berasal dari identity store.

GlassFish menggunakan group sebagai salah satu input untuk role mapping.

---

### 3.4 Principal

**Principal** adalah representasi runtime dari identitas yang sudah terautentikasi.

Dalam aplikasi Java/Jakarta EE, kamu sering melihatnya sebagai:

```java
Principal principal = request.getUserPrincipal();
```

Principal menjawab:

> "Siapa user yang sedang menjalankan request ini menurut container?"

---

### 3.5 Role

**Role** adalah konsep authorization aplikasi.

Contoh role aplikasi:

```text
APPLICATION_VIEWER
APPLICATION_APPROVER
CASE_MANAGER
SYSTEM_ADMIN
```

Role bisa dideklarasikan di:

- annotation;
- `web.xml`;
- `ejb-jar.xml`;
- Jakarta Security annotations;
- deployment descriptor lain.

Role menjawab:

> "Aplikasi mengizinkan akses ini untuk kategori otorisasi apa?"

Role **bukan** selalu sama dengan group.

---

## 4. Perbedaan Paling Penting: Group Realm vs Role Aplikasi

Ini sumber banyak bug 403.

Misalnya:

```text
LDAP group:
  CEA_CASE_OFFICERS

Application role:
  CASE_OFFICER
```

Keduanya bukan otomatis sama.

Aplikasi mungkin mendeklarasikan:

```xml
<security-role>
    <role-name>CASE_OFFICER</role-name>
</security-role>
```

Tetapi realm mengembalikan group:

```text
CEA_CASE_OFFICERS
```

Jika tidak ada mapping, runtime bisa gagal menganggap user punya role tersebut.

Maka dibutuhkan role mapping:

```text
Application Role CASE_OFFICER
  <- mapped from group CEA_CASE_OFFICERS
```

Mental model:

```text
Identity Store / Realm
  user = alice
  groups = [CEA_CASE_OFFICERS, CEA_STAFF]

Application
  roles = [CASE_OFFICER, CASE_APPROVER]

GlassFish Mapping
  CASE_OFFICER <- CEA_CASE_OFFICERS
  CASE_APPROVER <- CEA_APPROVERS

Runtime Decision
  alice has role CASE_OFFICER = true
  alice has role CASE_APPROVER = false
```

---

## 5. Security Flow pada Request Web

Untuk request HTTP aplikasi, alur security secara konseptual seperti ini:

```text
Client
  |
  | HTTPS request
  v
Network Listener
  |
  | TLS handshake jika HTTPS
  v
Virtual Server / HTTP Service
  |
  | route ke web app berdasarkan host/context root
  v
Web Container
  |
  | cek security constraint
  v
Authentication Mechanism
  |
  | BASIC / FORM / CLIENT-CERT / Jakarta Security mechanism / custom
  v
Realm
  |
  | validasi user dan group
  v
Principal established
  |
  | principal + groups tersedia di container
  v
Role Mapping
  |
  | app role dicocokkan dengan group/principal
  v
Authorization Decision
  |
  | allowed / denied
  v
Servlet / JAX-RS / EJB call
```

Jika terjadi error:

- `401 Unauthorized`: biasanya authentication belum berhasil / credential tidak valid / challenge diperlukan.
- `403 Forbidden`: authentication berhasil, tapi authorization gagal.
- `500 Internal Server Error`: bisa terjadi jika mechanism/realm/config error.
- TLS handshake error: gagal sebelum request sampai aplikasi.

---

## 6. Realm di GlassFish

GlassFish menyediakan beberapa tipe realm. Yang penting dipahami bukan hanya cara membuat realm, tapi kapan realm tertentu cocok dan failure mode-nya.

---

### 6.1 File Realm

File realm adalah identity store berbasis file.

Biasanya dipakai untuk:

- local development;
- admin/default setup kecil;
- demo;
- environment sederhana;
- bootstrap awal.

Kelebihan:

- sederhana;
- tidak butuh DB/LDAP;
- mudah dites;
- cocok untuk user sedikit.

Kekurangan:

- tidak cocok untuk user besar;
- sulit diaudit secara enterprise;
- tidak ideal untuk rotasi credential skala besar;
- tidak cocok sebagai source of truth organisasi.

Contoh mental model:

```text
file realm
  |
  |-- keyfile
        |-- user1 -> hashed password + groups
        |-- user2 -> hashed password + groups
```

Command umum:

```bash
asadmin create-file-user \
  --authrealmname file \
  --groups case-officer,staff \
  alice
```

Catatan: command akan meminta password user secara interaktif kecuali diotomasi dengan password file.

---

### 6.2 Admin Realm

Admin realm adalah realm yang dipakai untuk administrasi GlassFish.

Ini berbeda dari user aplikasi.

Jangan campur mental model:

```text
admin user GlassFish
  -> mengakses Admin Console / asadmin remote

application user
  -> mengakses aplikasi bisnis
```

Admin realm harus diproteksi lebih ketat karena ia mengontrol runtime.

Baseline:

- jangan biarkan password admin kosong;
- aktifkan secure admin untuk remote administration;
- batasi admin listener secara network;
- gunakan user admin yang jelas;
- audit penggunaan `asadmin`;
- jangan expose admin console ke internet.

---

### 6.3 JDBC Realm

JDBC realm menggunakan database sebagai identity store.

Cocok untuk:

- aplikasi enterprise dengan user internal di DB;
- integrasi legacy;
- aplikasi yang belum memakai IdP modern;
- kontrol user/group yang dikelola tabel.

Konsep:

```text
GlassFish JDBC Realm
  |
  |-- datasource / JNDI JDBC resource
  |-- user table
  |-- group table
  |-- password column
  |-- digest algorithm
```

Kelebihan:

- data identity bisa dikelola terpusat di DB;
- bisa diaudit dengan mekanisme DB;
- cocok untuk aplikasi legacy.

Kekurangan:

- schema coupling;
- password hashing harus benar;
- perubahan DB bisa memutus login;
- pool/DB outage bisa membuat login gagal;
- bukan pilihan ideal jika organisasi sudah punya IdP/LDAP/OIDC.

Failure mode:

```text
DB down
  -> authentication gagal

JDBC resource salah target
  -> realm gagal lookup

password digest mismatch
  -> semua login gagal

group query salah
  -> login berhasil tapi semua role 403
```

---

### 6.4 LDAP Realm

LDAP realm memakai directory service.

Cocok untuk:

- enterprise identity;
- Active Directory/LDAP integration;
- user/group organisasi;
- central identity management.

Kelebihan:

- source of truth biasanya sudah ada;
- user lifecycle dikelola IAM/IT;
- group bisa mengikuti struktur organisasi.

Kekurangan:

- LDAP query/filter kompleks;
- group nesting bisa bermasalah;
- latency directory mempengaruhi login;
- outage directory mempengaruhi akses aplikasi;
- TLS truststore harus benar jika pakai LDAPS.

Pertanyaan engineering penting:

1. Apakah group langsung atau nested?
2. Apakah user search base benar?
3. Apakah bind DN secret aman?
4. Apakah koneksi LDAP memakai TLS?
5. Apakah timeout LDAP dikonfigurasi?
6. Apakah aplikasi tahan jika LDAP lambat?
7. Bagaimana mapping group LDAP ke role aplikasi?

---

### 6.5 Certificate Realm

Certificate realm dipakai untuk client certificate authentication.

Cocok untuk:

- mutual TLS;
- machine-to-machine trust;
- high-assurance internal system;
- partner integration;
- environment regulated.

Flow:

```text
Client presents certificate
  |
GlassFish validates certificate chain
  |
Truststore verifies issuer
  |
Certificate realm extracts identity
  |
Principal established
  |
Role mapping applied
```

Kelebihan:

- strong authentication;
- cocok untuk system integration;
- tidak bergantung pada password;
- bisa dipadukan dengan network-level trust.

Kekurangan:

- certificate lifecycle kompleks;
- expiry bisa menyebabkan outage;
- truststore harus dikelola ketat;
- revocation checking sering diabaikan;
- mapping certificate subject ke user/role perlu jelas.

Failure mode:

```text
expired client cert
  -> TLS/client auth failure

issuer not trusted
  -> handshake failure

wrong truststore
  -> all clients rejected

CN/SAN mapping wrong
  -> principal mismatch

role mapping missing
  -> auth succeeds, access denied
```

---

### 6.6 Custom Realm

Custom realm dipakai jika identity source tidak cocok dengan file/JDBC/LDAP/certificate realm.

Contoh:

- proprietary IAM;
- legacy SSO;
- token introspection internal;
- government identity gateway;
- custom mainframe user store.

Risiko:

- coupling ke GlassFish internal API;
- classloading issue;
- upgrade compatibility risk;
- security bug jika hashing/token validation salah;
- sulit diaudit jika tidak terdokumentasi.

Prinsip:

> Custom realm hanya digunakan jika benar-benar perlu. Jika bisa memakai Jakarta Security/OIDC di aplikasi atau external IdP di reverse proxy, biasanya itu lebih portable.

---

## 7. Membuat dan Mengelola Realm dengan `asadmin`

Command umum untuk realm:

```bash
asadmin create-auth-realm
asadmin list-auth-realms
asadmin delete-auth-realm
```

Contoh konseptual:

```bash
asadmin create-auth-realm \
  --classname com.sun.enterprise.security.auth.realm.jdbc.JDBCRealm \
  --property jaas-context=jdbcRealm:datasource-jndi=jdbc/securityDS:user-table=APP_USERS:user-name-column=USERNAME:password-column=PASSWORD:group-table=APP_USER_GROUPS:group-name-column=GROUP_NAME:digest-algorithm=SHA-256 \
  appJdbcRealm
```

Catatan:

- property aktual harus divalidasi terhadap versi GlassFish yang dipakai;
- jangan copy-paste config realm tanpa memahami setiap property;
- realm yang salah sering gagal saat login, bukan saat dibuat;
- selalu lakukan smoke test login dan role authorization setelah perubahan realm.

---

## 8. Role Mapping di GlassFish

Aplikasi mendeklarasikan role. GlassFish perlu tahu user/group/principal mana yang mengisi role itu.

Role mapping bisa berada di descriptor GlassFish-specific seperti:

- `glassfish-web.xml`;
- `glassfish-ejb-jar.xml`;
- descriptor terkait aplikasi.

Contoh konseptual `glassfish-web.xml`:

```xml
<glassfish-web-app>
    <security-role-mapping>
        <role-name>CASE_OFFICER</role-name>
        <group-name>CEA_CASE_OFFICERS</group-name>
    </security-role-mapping>

    <security-role-mapping>
        <role-name>CASE_APPROVER</role-name>
        <group-name>CEA_CASE_APPROVERS</group-name>
    </security-role-mapping>
</glassfish-web-app>
```

Mental model:

```text
Aplikasi:
  @RolesAllowed("CASE_OFFICER")

GlassFish:
  CASE_OFFICER <- group CEA_CASE_OFFICERS

Realm:
  alice belongs to CEA_CASE_OFFICERS

Runtime:
  alice allowed
```

Jika mapping hilang:

```text
alice login success
  |
  v
alice principal exists
  |
  v
group exists in realm
  |
  v
application role not mapped
  |
  v
403 Forbidden
```

---

## 9. Default Principal-to-Role Mapping

GlassFish memiliki opsi default principal-to-role mapping, yaitu mapping otomatis antara principal/group dan role yang namanya cocok.

Secara praktis:

```text
Role name = admin
Group name = admin
  -> bisa dianggap match jika default mapping aktif
```

Ini nyaman untuk dev, tetapi harus hati-hati di production.

Kelebihan:

- mengurangi descriptor mapping;
- cepat untuk aplikasi sederhana;
- cocok jika naming role dan group memang dikontrol ketat.

Risiko:

- role aplikasi tidak sengaja sama dengan group eksternal;
- group dari LDAP terlalu luas;
- authorization menjadi implicit;
- review security lebih sulit;
- perubahan group naming bisa berdampak ke akses aplikasi.

Rekomendasi enterprise:

- gunakan mapping eksplisit untuk aplikasi kritikal;
- aktifkan default mapping hanya jika ada standar naming dan review;
- dokumentasikan role-to-group mapping sebagai bagian security design;
- jangan bergantung pada kebetulan nama sama.

---

## 10. Security Descriptor vs Annotation

Aplikasi Jakarta EE bisa mendeklarasikan security lewat annotation atau descriptor.

Contoh annotation:

```java
@RolesAllowed("CASE_OFFICER")
public void submitCase(...) {
    ...
}
```

Contoh descriptor:

```xml
<security-role>
    <role-name>CASE_OFFICER</role-name>
</security-role>
```

GlassFish-specific mapping:

```xml
<security-role-mapping>
    <role-name>CASE_OFFICER</role-name>
    <group-name>CEA_CASE_OFFICERS</group-name>
</security-role-mapping>
```

Prinsip:

- annotation baik untuk security dekat dengan kode;
- descriptor baik untuk mapping environment/runtime;
- GlassFish descriptor baik untuk vendor-specific runtime mapping;
- jangan menyembunyikan authorization penting di terlalu banyak tempat tanpa dokumentasi.

Top-level pattern:

```text
Business authorization intent:
  kode / standard descriptor

Runtime identity mapping:
  GlassFish descriptor / deployment config

Enterprise identity source:
  realm / IAM / LDAP / DB
```

---

## 11. Admin Security

GlassFish punya admin surface:

- Admin Console;
- remote `asadmin`;
- REST admin endpoint;
- DAS administration channel;
- node/instance administration.

Ini sangat sensitif karena admin surface bisa:

- deploy aplikasi;
- undeploy aplikasi;
- mengubah JDBC credential;
- mengubah listener;
- mengubah JVM option;
- membaca konfigurasi;
- restart domain;
- memodifikasi security realm.

Jika admin surface compromise, aplikasi compromise.

---

### 11.1 Admin Password

Admin password dipakai untuk Admin Console dan `asadmin` remote.

Baseline:

```bash
asadmin change-admin-password
```

Jangan gunakan:

- password kosong;
- password default;
- password yang sama lintas environment;
- password yang disimpan plaintext di script;
- shared admin credential tanpa audit.

Untuk automation, gunakan password file dengan permission ketat.

Contoh:

```properties
AS_ADMIN_PASSWORD=...
AS_ADMIN_NEWPASSWORD=...
```

Kemudian:

```bash
asadmin --user admin --passwordfile /secure/path/passwordfile change-admin-password
```

File password harus diproteksi:

```bash
chmod 600 /secure/path/passwordfile
chown glassfish:glassfish /secure/path/passwordfile
```

Pada Windows, gunakan ACL yang membatasi hanya service account terkait.

---

### 11.2 Secure Admin

Secure admin memungkinkan administrasi remote secara aman.

Command umum:

```bash
asadmin enable-secure-admin
asadmin restart-domain
```

Tanpa secure admin, remote admin biasanya tidak boleh/aman digunakan.

Pola minimal:

```bash
asadmin change-admin-password
asadmin enable-secure-admin
asadmin restart-domain
```

Hal penting:

- secure admin biasanya memerlukan admin password yang tidak kosong;
- setelah enable secure admin, restart domain dibutuhkan;
- admin listener harus diproteksi network;
- jangan expose port admin ke internet;
- batasi akses ke bastion/VPN/private subnet.

---

### 11.3 Admin Listener

Default admin console biasanya pada port `4848`.

Security decision:

```text
Apakah admin listener bind ke 0.0.0.0?
Apakah hanya localhost?
Apakah hanya private network?
Apakah ada security group/firewall?
Apakah TLS aktif?
Apakah audit admin action tersedia?
```

Baseline production:

```text
admin listener:
  - tidak expose public internet
  - hanya private/admin network
  - secure admin enabled
  - strong admin password
  - access via bastion/VPN
  - monitored access log
```

---

### 11.4 Admin User Separation

Jangan gunakan satu user admin untuk semua orang.

Ideal:

```text
admin-fajar
admin-release
admin-ops
admin-breakglass
```

Namun dukungan user/role admin perlu dilihat sesuai versi dan konfigurasi GlassFish.

Jika tidak ada fine-grained RBAC yang memadai, minimal lakukan:

- akses admin hanya lewat bastion;
- audit shell command;
- kontrol file password;
- CI/CD service account terpisah;
- break-glass account disimpan aman;
- rotasi credential.

---

## 12. Password Alias dan Master Password

GlassFish menyediakan mekanisme **password alias** untuk menghindari plaintext password langsung di `domain.xml`.

Contoh problem:

```xml
<property name="password" value="SuperSecretDbPassword"/>
```

Ini buruk karena:

- secret terlihat di config;
- bisa masuk backup;
- bisa masuk Git;
- bisa terbaca user OS yang salah;
- sulit rotasi.

Dengan password alias, config bisa memakai referensi:

```text
${ALIAS=dbPassword}
```

Command umum:

```bash
asadmin create-password-alias dbPassword
asadmin list-password-aliases
asadmin delete-password-alias dbPassword
```

Mental model:

```text
domain config
  stores alias reference

domain password store
  stores encrypted secret

master password
  protects password store
```

---

### 12.1 Master Password

Master password dipakai untuk melindungi secret internal domain.

Command umum:

```bash
asadmin change-master-password
```

Pertimbangan:

- jika master password hilang, secret store bisa tidak bisa dibuka;
- perubahan master password harus direncanakan;
- domain restart biasanya diperlukan;
- backup harus mencakup domain config dan keystore/password store terkait;
- jangan samakan master password lintas environment.

---

### 12.2 Password Alias Bukan Secret Manager Modern

Password alias membantu, tetapi bukan pengganti penuh untuk secret manager seperti:

- AWS Secrets Manager;
- AWS SSM Parameter Store;
- HashiCorp Vault;
- Azure Key Vault;
- GCP Secret Manager;
- Kubernetes Secret dengan mekanisme encryption at rest;
- external secret operator.

Password alias melindungi secret di dalam GlassFish domain. Namun ia tidak otomatis menyelesaikan:

- secret rotation workflow;
- access audit per secret;
- centralized policy;
- dynamic credential;
- just-in-time secret;
- secret expiry;
- secret leasing;
- multi-service secret governance.

Prinsip:

```text
Password alias = local GlassFish secret indirection/protection
Secret manager = enterprise secret lifecycle control
```

---

## 13. TLS di GlassFish

TLS bisa terjadi di beberapa tempat:

```text
Client
  |
  | HTTPS
  v
Reverse Proxy / Load Balancer
  |
  | HTTP or HTTPS
  v
GlassFish
```

Ada tiga pola umum.

---

### 13.1 TLS Terminated di GlassFish

```text
Client --HTTPS--> GlassFish
```

Kelebihan:

- end-to-end langsung ke server;
- GlassFish memegang certificate;
- cocok untuk simple deployment.

Kekurangan:

- certificate management tersebar;
- renewal perlu menyentuh GlassFish;
- kurang ideal untuk skala besar dengan banyak instance;
- reverse proxy features terbatas.

---

### 13.2 TLS Terminated di Reverse Proxy

```text
Client --HTTPS--> Nginx/ALB/Proxy --HTTP--> GlassFish
```

Kelebihan:

- certificate management terpusat;
- integrasi dengan WAF/load balancer;
- offload TLS;
- operationally common.

Risiko:

- backend traffic plaintext jika network tidak dipercaya;
- aplikasi harus memahami original scheme;
- secure cookie dan redirect harus benar;
- header `X-Forwarded-*` harus dipercaya hanya dari proxy.

---

### 13.3 TLS End-to-End

```text
Client --HTTPS--> Proxy --HTTPS--> GlassFish
```

Kelebihan:

- transport terenkripsi antar hop;
- cocok untuk zero-trust/internal compliance;
- proxy tetap bisa melakukan routing/load balancing.

Kekurangan:

- certificate management lebih kompleks;
- truststore backend perlu dikelola;
- debugging TLS lebih sulit;
- performance overhead lebih tinggi.

---

## 14. Keystore dan Truststore

### 14.1 Keystore

Keystore menyimpan private key dan certificate yang dipakai server untuk membuktikan identitasnya.

Digunakan untuk:

- HTTPS listener;
- admin secure channel;
- server certificate;
- mungkin client certificate outbound tertentu.

Pertanyaan:

```text
Certificate mana yang GlassFish present ke client?
Private key disimpan di mana?
Alias certificate apa yang dipakai listener?
Kapan certificate expire?
Bagaimana rotasinya?
```

---

### 14.2 Truststore

Truststore menyimpan certificate authority atau certificate yang dipercaya GlassFish.

Digunakan untuk:

- memverifikasi client certificate;
- memverifikasi LDAP/LDAPS server;
- memverifikasi outbound HTTPS target;
- mTLS;
- secure admin antar node jika relevan.

Pertanyaan:

```text
Certificate siapa yang GlassFish percaya?
Apakah CA internal sudah masuk?
Apakah certificate chain lengkap?
Apakah truststore environment-specific?
```

---

### 14.3 Common TLS Failure

#### 1. `PKIX path building failed`

Biasanya GlassFish/JVM tidak percaya certificate chain target.

Penyebab:

- CA belum masuk truststore;
- intermediate certificate hilang;
- truststore yang dipakai salah;
- certificate self-signed belum didaftarkan.

#### 2. `No available certificate or key corresponds to the SSL cipher suites`

Biasanya keystore/listener tidak punya key/certificate yang cocok.

Penyebab:

- alias salah;
- private key tidak ada;
- keystore salah;
- certificate tidak cocok;
- password keystore salah.

#### 3. Client certificate rejected

Penyebab:

- client cert expired;
- issuer tidak dipercaya;
- certificate chain tidak lengkap;
- mTLS required tapi client tidak mengirim certificate;
- mapping certificate realm gagal.

---

## 15. TLS Listener dan HTTP Security

GlassFish network listener bisa dikonfigurasi untuk HTTP/HTTPS. Konfigurasi TLS biasanya terkait:

- network listener;
- protocol;
- SSL settings;
- keystore alias;
- client authentication;
- cipher/protocol.

Security baseline:

```text
Disable weak TLS versions.
Disable weak cipher suites.
Use certificate from trusted CA.
Use separate certificate per environment/domain as needed.
Automate certificate expiry monitoring.
Do not expose admin listener publicly.
Use reverse proxy security headers.
```

Untuk Java 8 sampai 25, perlu memperhatikan bahwa default TLS protocol/cipher di JDK berubah seiring waktu. JDK modern lebih ketat terhadap algorithm lemah. Ini bagus untuk security, tetapi bisa memunculkan compatibility issue dengan legacy client/server.

---

## 16. Reverse Proxy dan Header Trust

Jika GlassFish ada di belakang proxy, request yang diterima GlassFish mungkin terlihat seperti:

```text
scheme = http
host = internal-host
port = 8080
remoteAddr = proxy IP
```

Padahal dari client:

```text
scheme = https
host = public.example.com
port = 443
remoteAddr = real client IP
```

Proxy biasanya mengirim:

```text
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-Port
Forwarded
```

Risiko:

- aplikasi membuat redirect ke HTTP padahal client HTTPS;
- secure cookie tidak dipasang;
- audit log hanya melihat IP proxy;
- attacker spoof header jika GlassFish bisa diakses langsung;
- mixed content issue;
- callback URL salah.

Prinsip:

```text
Forwarded headers hanya boleh dipercaya jika request datang dari trusted proxy.
GlassFish/backend tidak boleh bisa diakses langsung dari internet.
```

---

## 17. Cookie Security

GlassFish/web application perlu memastikan cookie penting memiliki:

```text
Secure
HttpOnly
SameSite
appropriate Path
appropriate Domain
reasonable Max-Age
```

Jika TLS terminated di proxy, aplikasi mungkin tidak tahu request original adalah HTTPS. Akibatnya cookie `Secure` bisa tidak aktif jika konfigurasi proxy/header tidak benar.

Baseline:

- enforce HTTPS di edge;
- set secure cookie;
- set HttpOnly untuk session cookie;
- set SameSite sesuai flow;
- jangan set Domain terlalu luas;
- rotate session after login;
- protect session id in logs;
- review timeout.

---

## 18. Security Realms dan Application Portability

Jika aplikasi sangat bergantung pada GlassFish realm, maka aplikasi menjadi lebih vendor-coupled.

Ada tiga level coupling:

### Level 1 — Portable

```text
Application uses Jakarta Security / standard annotations.
Identity handled externally or via standard mechanism.
Runtime-specific mapping minimal.
```

### Level 2 — Moderately Coupled

```text
Application uses standard security roles.
GlassFish descriptors map runtime groups to app roles.
```

### Level 3 — Strongly Coupled

```text
Application depends on GlassFish custom realm/internal API.
Deployment descriptors and runtime config tightly bound to GlassFish.
```

Tidak semua coupling buruk. Untuk aplikasi enterprise regulated, vendor-specific runtime mapping bisa diterima jika:

- terdokumentasi;
- diuji;
- ada migration plan;
- ada audit trail;
- failure mode dipahami.

---

## 19. Resource Secret Handling

Resource seperti JDBC pool biasanya butuh credential.

Contoh buruk:

```bash
asadmin create-jdbc-connection-pool \
  --property user=dbuser:password=PlainTextPassword ...
```

Lebih baik:

```bash
asadmin create-password-alias dbPassword
```

Lalu resource memakai alias.

Konsep:

```text
JDBC Pool
  user = app_user
  password = ${ALIAS=dbPassword}
```

Untuk CI/CD:

```text
External Secret Manager
  |
  | inject at provisioning time
  v
GlassFish password alias
  |
  | referenced by JDBC/JMS/resource config
  v
domain runtime
```

Hal yang perlu dikontrol:

- siapa boleh membaca/menulis password alias;
- bagaimana rotasi dilakukan;
- apakah domain restart diperlukan;
- apakah semua instance mendapat update;
- apakah old connection masih memakai old credential;
- apakah DB credential overlap saat rotasi.

---

## 20. Secret Rotation Strategy

Rotasi secret bukan hanya mengganti password.

Untuk JDBC password:

```text
1. Create new DB password or dual credential window.
2. Update secret manager.
3. Update GlassFish password alias.
4. Restart/reload affected pool or domain if needed.
5. Validate new connections.
6. Drain old connections.
7. Revoke old credential.
8. Verify logs/metrics.
```

Failure jika salah urutan:

```text
DB password changed first
  -> existing pool may survive temporarily
  -> new connections fail
  -> intermittent outage

Alias updated but pool not refreshed
  -> old connections still used
  -> false confidence

Old credential revoked too early
  -> pool exhaustion / login failed
```

Top-level invariant:

> Rotasi credential harus memiliki periode overlap atau mekanisme refresh yang jelas.

---

## 21. File Permission dan OS-Level Security

GlassFish security tidak cukup jika OS file permission buruk.

Direktori sensitif:

```text
domains/domain1/config/
domains/domain1/config/keystore*
domains/domain1/config/cacerts*
domains/domain1/config/domain.xml
domains/domain1/config/admin-keyfile
domains/domain1/config/keyfile
domains/domain1/master-password
domains/domain1/logs/
password files used by scripts
deployment artifacts
```

Baseline Linux:

```bash
useradd --system --home /opt/glassfish glassfish
chown -R glassfish:glassfish /opt/glassfish/glassfish/domains/domain1
chmod -R go-rwx /opt/glassfish/glassfish/domains/domain1/config
chmod 600 /secure/path/passwordfile
```

Prinsip:

```text
GlassFish process user should not be root.
Config files should not be world-readable.
Keystore/password files should be accessible only to service account.
Deployment pipeline should not leave plaintext secrets.
```

---

## 22. Admin Automation Security

Automation sering membuat security melemah karena mengejar repeatability.

Contoh anti-pattern:

```bash
asadmin --user admin --passwordfile ./password.txt deploy app.war
git add password.txt
```

Atau:

```bash
asadmin --password adminadmin ...
```

Atau:

```Dockerfile
ENV ADMIN_PASSWORD=SuperSecret
```

Lebih aman:

- password file generated at runtime;
- file permission ketat;
- secret injected dari CI/CD secret store;
- no secret in Git;
- no secret printed in logs;
- no `set -x` saat menjalankan command dengan secret;
- no plaintext secret in Docker image layers;
- use build-time vs runtime secret carefully;
- rotate CI/CD credential.

---

## 23. Security Logging dan Audit

GlassFish menghasilkan server log dan access log, tetapi audit security yang matang perlu desain.

Yang perlu dicatat:

- admin login;
- failed admin login;
- deployment/undeployment;
- config change;
- auth failure aplikasi;
- repeated 401/403;
- TLS handshake failure pattern;
- realm lookup failure;
- password alias change;
- certificate expiry warning;
- suspicious admin endpoint access;
- access from unusual IP.

Yang tidak boleh sembarangan dicatat:

- password;
- token;
- session id;
- authorization header;
- client certificate private data;
- PII tanpa masking;
- DB credential;
- full SAML/OIDC assertion.

Prinsip:

```text
Security logs must be useful enough for investigation,
but not become a secondary breach surface.
```

---

## 24. Threat Model GlassFish Runtime

Ancaman penting:

### 24.1 Exposed Admin Port

```text
Internet -> :4848 -> Admin Console
```

Impact:

- brute force;
- credential stuffing;
- remote configuration change;
- malicious deployment;
- full compromise.

Mitigation:

- private network only;
- secure admin;
- firewall/security group;
- VPN/bastion;
- strong credentials;
- monitoring.

---

### 24.2 Plaintext Secret in Config

Impact:

- credential leak via backup/Git;
- lateral movement to DB/JMS;
- regulatory incident.

Mitigation:

- password alias;
- secret manager;
- file permission;
- scanning;
- rotation.

---

### 24.3 Weak TLS

Impact:

- MITM;
- compliance failure;
- client rejection by modern systems.

Mitigation:

- modern TLS protocols;
- strong cipher;
- certificate lifecycle;
- truststore hygiene.

---

### 24.4 Misconfigured Role Mapping

Impact:

- unauthorized access if too broad;
- denial of service to valid users if too narrow;
- privilege escalation if default mapping abused.

Mitigation:

- explicit mapping;
- test matrix;
- least privilege;
- role review.

---

### 24.5 Custom Realm Bug

Impact:

- authentication bypass;
- wrong principal;
- wrong group;
- unhandled exception causing login outage.

Mitigation:

- prefer standard mechanisms;
- test heavily;
- code review;
- logging;
- fallback strategy;
- compatibility test on upgrade.

---

## 25. Failure Diagnosis: 401 vs 403 vs TLS vs Runtime Error

### 25.1 401 Unauthorized

Pertanyaan diagnosis:

```text
Apakah request menyertakan credential?
Apakah authentication mechanism aktif?
Apakah realm name cocok?
Apakah user ada?
Apakah password benar?
Apakah password digest cocok?
Apakah login module error?
Apakah session expired?
Apakah reverse proxy menghapus Authorization header?
```

Common causes:

- wrong realm;
- wrong login config;
- user missing;
- invalid password;
- BASIC header stripped by proxy;
- form login action/path mismatch;
- session timeout.

---

### 25.2 403 Forbidden

Pertanyaan diagnosis:

```text
Apakah user sudah login?
Principal terbentuk?
Group apa yang dikembalikan realm?
Role apa yang diminta aplikasi?
Role mapping ada?
Default principal-to-role mapping aktif/tidak?
Apakah case-sensitive mismatch?
Apakah descriptor benar terdeploy?
```

Common causes:

- missing role mapping;
- group name mismatch;
- role name mismatch;
- default mapping assumption salah;
- nested LDAP group tidak terbaca;
- user masuk group yang salah.

---

### 25.3 TLS Handshake Failure

Pertanyaan diagnosis:

```text
Apakah certificate expired?
Apakah hostname cocok?
Apakah truststore punya CA?
Apakah protocol/cipher kompatibel?
Apakah client cert required?
Apakah client mengirim cert?
Apakah alias keystore benar?
```

Tools:

```bash
openssl s_client -connect host:port -showcerts
keytool -list -v -keystore keystore.jks
keytool -list -v -keystore cacerts.jks
```

---

### 25.4 Admin Login Failure

Pertanyaan diagnosis:

```text
Apakah admin password berubah?
Apakah user admin benar?
Apakah secure admin enabled?
Apakah akses remote diizinkan?
Apakah admin port terbuka?
Apakah domain yang diakses benar?
Apakah password file benar formatnya?
```

---

## 26. Practical Security Baseline untuk Production

Baseline minimum:

```text
[Admin]
- change default admin password
- enable secure admin if remote admin needed
- restrict admin port to private/bastion
- no public admin console
- separate CI/CD admin credential if possible

[Network]
- HTTPS at edge
- backend TLS if required by policy
- firewall/security group deny by default
- no direct bypass to backend from internet

[TLS]
- modern TLS protocol
- strong cipher
- certificate expiry monitoring
- keystore/truststore backed up securely
- no expired/self-signed cert in prod unless explicitly trusted internally

[Realm]
- use enterprise identity source where appropriate
- document realm configuration
- avoid custom realm unless justified
- test login and authorization separately

[Role Mapping]
- explicit mapping for critical apps
- least privilege
- role/group matrix maintained
- test 401 and 403 separately

[Secrets]
- no plaintext secret in Git
- use password alias for GlassFish resource password
- use external secret manager for lifecycle control
- protect password files
- rotate credentials

[OS]
- GlassFish not running as root
- domain config permission restricted
- keystore/truststore permission restricted
- logs protected

[Audit]
- admin access monitored
- deployment/config change traceable
- auth failure monitored
- security logs do not leak secrets
```

---

## 27. Role Mapping Test Matrix

Untuk aplikasi enterprise, buat matrix seperti:

| User | Realm Groups | Expected App Roles | Expected Result |
|---|---|---|---|
| alice | CEA_CASE_OFFICERS | CASE_OFFICER | Can view/submit case |
| bob | CEA_CASE_APPROVERS | CASE_APPROVER | Can approve |
| charlie | CEA_STAFF | none | Login ok, case access denied |
| guest | none | none | Login denied or no access |
| admin1 | SYSTEM_ADMIN_GROUP | SYSTEM_ADMIN | Admin module access |

Test minimal:

```text
1. Invalid credential -> 401 / login fail.
2. Valid user without role -> 403.
3. Valid user with correct role -> allowed.
4. User with unrelated group -> denied.
5. Expired/disabled user -> denied.
6. Role mapping changed -> expected result changes.
```

---

## 28. Java 8 sampai 25: Security Runtime Considerations

### Java 8

- banyak legacy cipher/protocol masih ditemui;
- TLS defaults lebih longgar dibanding JDK modern;
- Java EE 8 / GlassFish 5 ecosystem masih `javax`;
- dependency lawas mungkin membawa security library lama.

### Java 11

- transisi modular JDK;
- beberapa Java EE module tidak lagi bundled di JDK;
- TLS/security defaults mulai lebih modern;
- perlu cek dependency JAXB/JAX-WS/activation legacy.

### Java 17

- baseline modern enterprise;
- stronger encapsulation;
- TLS/certificate validation lebih ketat;
- cocok untuk Jakarta EE 10/modern runtime.

### Java 21

- baseline penting untuk GlassFish 8;
- virtual thread ada, tapi security context propagation tetap perlu dipahami;
- TLS defaults modern;
- harus cek provider/security library compatibility.

### Java 25

- target modern;
- potensi compatibility issue dengan library lama;
- jangan asumsikan app server + app + dependency langsung aman tanpa test;
- security algorithms/cert validation bisa lebih ketat.

Prinsip upgrade:

```text
JDK upgrade can change security behavior even if application code unchanged.
```

Yang perlu dites:

- TLS inbound;
- TLS outbound;
- LDAP/LDAPS;
- JDBC TLS;
- client certificate;
- JWT/OIDC library;
- password hashing provider;
- keystore format;
- disabled algorithms;
- reflection access for custom realm/security extension.

---

## 29. Security Design Review Checklist

Gunakan checklist ini saat review aplikasi GlassFish:

### Identity

```text
- Realm apa yang digunakan?
- Source of truth user di mana?
- Group berasal dari mana?
- Apakah group nested?
- Bagaimana user disabled/terminated diproses?
```

### Authorization

```text
- Role aplikasi apa saja?
- Role mapping eksplisit atau default?
- Siapa owner role matrix?
- Apakah least privilege?
- Apakah ada test 403?
```

### Transport

```text
- TLS terminate di mana?
- Backend traffic encrypted?
- Truststore/keystore dikelola siapa?
- Cert expiry dimonitor?
- mTLS diperlukan?
```

### Admin

```text
- Admin port expose ke mana?
- Secure admin enabled?
- Admin password rotated?
- Admin action audited?
- CI/CD credential terpisah?
```

### Secret

```text
- Secret ada di Git?
- Secret ada di Docker image layer?
- Password alias dipakai?
- External secret manager dipakai?
- Rotation process tested?
```

### Runtime

```text
- GlassFish berjalan sebagai user non-root?
- File permission domain config aman?
- Debug port disabled?
- Unused services disabled?
- Logs tidak bocor token/password?
```

---

## 30. Anti-Pattern yang Harus Dihindari

### Anti-pattern 1 — Admin Console Public

```text
Admin console accessible from internet.
```

Ini critical risk.

---

### Anti-pattern 2 — Plaintext DB Password di `domain.xml`

```text
password=MyProdDbPassword
```

Gunakan password alias atau external secret flow.

---

### Anti-pattern 3 — Menganggap Login Berhasil Berarti Authorization Benar

Login hanya membuktikan authentication. Authorization masih bergantung role mapping.

---

### Anti-pattern 4 — Role Name Sama dengan LDAP Group Tanpa Review

Default mapping bisa nyaman, tapi implicit authorization sering menjadi sumber privilege creep.

---

### Anti-pattern 5 — Semua User Masuk Group `admin`

Jika group terlalu luas, role mapping menjadi tidak bermakna.

---

### Anti-pattern 6 — Custom Realm Tanpa Threat Model

Custom realm adalah security-sensitive code. Perlakukan seperti komponen auth kritikal.

---

### Anti-pattern 7 — Certificate Tidak Dipantau Expiry

Certificate expiry adalah outage yang sangat bisa dicegah.

---

### Anti-pattern 8 — Secret Dicetak di CI/CD Log

Banyak breach terjadi bukan karena crypto lemah, tetapi karena secret tercetak di log.

---

## 31. Incident Playbook: User Mendapat 403 Setelah Login

Langkah diagnosis:

```text
1. Konfirmasi user berhasil login.
2. Ambil principal name dari aplikasi/log.
3. Ambil groups yang dikembalikan realm.
4. Cek role yang dibutuhkan endpoint.
5. Cek descriptor/annotation role declaration.
6. Cek GlassFish role mapping.
7. Cek apakah default principal-to-role mapping aktif.
8. Cek case sensitivity nama role/group.
9. Cek apakah deployment artifact terbaru sudah terdeploy.
10. Cek apakah target deployment benar.
```

Template root cause:

```text
Symptom:
  Authenticated users from group X receive 403 on endpoint Y.

Root cause:
  Application role Y_ROLE was declared, but GlassFish role mapping only mapped old group OLD_X.
  LDAP group was changed to NEW_X during identity migration.

Fix:
  Update glassfish-web.xml role mapping from OLD_X to NEW_X.
  Redeploy application.
  Add role mapping regression test for group NEW_X.

Prevention:
  Maintain role/group matrix.
  Add deployment smoke test for representative users.
```

---

## 32. Incident Playbook: TLS Handshake Failure Setelah JDK Upgrade

Langkah diagnosis:

```text
1. Cek exact JDK version before/after.
2. Cek error log: disabled algorithm, PKIX, handshake_failure, protocol_version.
3. Cek certificate chain dengan openssl.
4. Cek truststore yang dipakai GlassFish.
5. Cek disabled algorithms di JDK security config.
6. Cek TLS protocol/cipher client dan server.
7. Cek apakah certificate memakai SHA1/weak key/expired.
8. Cek hostname/SAN.
9. Reproduce dengan openssl atau Java client minimal.
```

Kemungkinan root cause:

```text
JDK baru menolak algorithm/certificate lama.
Truststore tidak berisi CA internal.
Client/server hanya support TLS lama.
Intermediate cert hilang.
```

---

## 33. Incident Playbook: Admin `asadmin` Remote Gagal

Langkah diagnosis:

```text
1. Apakah domain hidup?
2. Apakah admin port reachable?
3. Apakah secure admin enabled?
4. Apakah admin password benar?
5. Apakah menggunakan user benar?
6. Apakah password file benar?
7. Apakah firewall/security group mengizinkan?
8. Apakah certificate admin listener dipercaya?
9. Apakah command local atau remote?
10. Apakah mengakses domain/host yang benar?
```

Command inspection:

```bash
asadmin list-domains
asadmin start-domain domain1
asadmin --host localhost --port 4848 version
```

---

## 34. Deep Mental Model: Security Boundary Ownership

Saat debugging security, selalu tanyakan:

```text
Boundary mana yang menolak request?
```

Kemungkinan boundary:

```text
[Client]
  salah credential / salah certificate

[Reverse Proxy]
  block IP / missing header / TLS failure

[GlassFish Listener]
  TLS/cipher/cert failure

[Web Container]
  security constraint / login config

[Realm]
  user/password/group lookup failure

[Role Mapping]
  group tidak match role aplikasi

[Application]
  business authorization denied

[DB/JMS/External Resource]
  credential/resource access denied
```

Ini penting karena error yang terlihat sama bisa punya root cause berbeda.

Contoh:

```text
User cannot access page
```

Bisa berarti:

- proxy redirect loop;
- session cookie tidak secure;
- user tidak login;
- LDAP gagal;
- role mapping salah;
- business rule menolak;
- backend API menolak;
- app deployed ke target salah.

Top-level engineer tidak menebak. Ia memecah boundary.

---

## 35. Praktik Konfigurasi Aman: Contoh Bootstrap Sequence

Contoh sequence konseptual untuk environment baru:

```bash
# 1. Create domain dengan admin password tidak kosong
asadmin create-domain --adminport 4848 --instanceport 8080 prod-domain

# 2. Start domain
asadmin start-domain prod-domain

# 3. Change admin password jika perlu
asadmin change-admin-password --user admin

# 4. Enable secure admin
asadmin enable-secure-admin
asadmin restart-domain prod-domain

# 5. Create password alias untuk DB
asadmin create-password-alias prodDbPassword

# 6. Create JDBC pool menggunakan alias
asadmin create-jdbc-connection-pool \
  --datasourceclassname oracle.jdbc.pool.OracleDataSource \
  --restype javax.sql.DataSource \
  --property user=APP_USER:password='${ALIAS=prodDbPassword}':URL='jdbc:oracle:thin:@//db-host:1521/service' \
  appPool

# 7. Create JDBC resource
asadmin create-jdbc-resource --connectionpoolid appPool jdbc/appDS

# 8. Configure app realm jika digunakan
asadmin create-auth-realm ...

# 9. Deploy app
asadmin deploy --target server app.war

# 10. Smoke test
# - HTTPS access
# - login valid
# - login invalid
# - role allowed
# - role denied
# - DB access
# - logs do not leak secret
```

Catatan:

- command aktual perlu disesuaikan versi dan resource;
- untuk Jakarta namespace modern, tipe resource/classname mungkin berbeda tergantung driver dan target;
- secret sebaiknya diinject dari secret manager, bukan diketik manual di terminal shared.

---

## 36. Keterkaitan dengan Part Sebelumnya

Part ini bergantung pada:

- **Part 3**: domain, target, cluster, config;
- **Part 4**: `asadmin` automation;
- **Part 5**: configuration-as-code;
- **Part 7**: classloading, terutama untuk custom realm/security extension;
- **Part 8–9**: deployment descriptor dan GlassFish-specific descriptor;
- **Part 10**: HTTP listener, virtual server, proxy;
- **Part 12**: JDBC pool untuk JDBC realm dan credential resource;
- **Part 13**: transaction/resource security effect;
- **Part 14–15**: JMS/EJB security contexts.

Security runtime tidak berdiri sendiri. Ia memotong hampir semua subsystem.

---

## 37. Top 1% Takeaways

1. **Realm bukan role.** Realm memvalidasi identitas; role mengontrol akses aplikasi.
2. **Login sukses tidak menjamin authorization sukses.** Banyak 403 berasal dari mapping, bukan authentication.
3. **Admin surface adalah crown jewel.** Jangan pernah expose sembarangan.
4. **Password alias membantu, tapi bukan secret manager penuh.**
5. **TLS failure sering terjadi sebelum aplikasi tersentuh.**
6. **Reverse proxy mengubah security semantics.** Scheme, host, cookie, dan client IP harus benar.
7. **Default principal-to-role mapping adalah trade-off.** Nyaman tapi bisa berbahaya jika implicit.
8. **Custom realm adalah security-critical code.** Hindari kecuali benar-benar perlu.
9. **JDK upgrade bisa mengubah security behavior.** TLS, certificate, disabled algorithms, dan provider bisa berubah.
10. **Security debugging harus boundary-oriented.** Cari boundary yang menolak, bukan menebak dari gejala.

---

## 38. Mini Exercise

Untuk memperkuat pemahaman, desain security runtime untuk skenario berikut:

```text
Aplikasi regulatory case management berjalan di GlassFish.
User internal berasal dari LDAP.
Aplikasi punya role:
- CASE_VIEWER
- CASE_OFFICER
- CASE_APPROVER
- SYSTEM_ADMIN

GlassFish berada di belakang Nginx.
TLS external terminate di Nginx.
Backend Nginx -> GlassFish memakai HTTP private subnet.
Admin Console hanya boleh dari bastion.
DB credential disimpan di AWS Secrets Manager.
GlassFish membutuhkan JDBC pool ke Oracle.
```

Jawab:

1. Realm apa yang dipakai?
2. Bagaimana mapping LDAP group ke role aplikasi?
3. Apakah default principal-to-role mapping boleh dipakai?
4. Di mana TLS terminate?
5. Bagaimana mencegah direct access ke GlassFish?
6. Bagaimana admin access diamankan?
7. Bagaimana secret DB masuk ke GlassFish?
8. Bagaimana rotasi DB password dilakukan?
9. Test 401 dan 403 apa saja yang wajib ada?
10. Log apa yang boleh/tidak boleh dicatat?

---

## 39. Referensi

Referensi utama:

- Eclipse GlassFish Security Guide, Release 8  
  https://glassfish.org/docs/latest/security-guide.html

- Eclipse GlassFish Reference Manual, Release 8  
  https://glassfish.org/docs/latest/reference-manual.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Application Deployment Guide, Release 8  
  https://glassfish.org/docs/latest/application-deployment-guide.html

- Eclipse GlassFish Application Development Guide, Release 8  
  https://glassfish.org/docs/latest/application-development-guide.html

- Jakarta Security Specification  
  https://jakarta.ee/specifications/security/

- Jakarta Servlet Specification  
  https://jakarta.ee/specifications/servlet/

- Jakarta Enterprise Beans Specification  
  https://jakarta.ee/specifications/enterprise-beans/

---

## 40. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 18 — Naming, JNDI, Resource References, dan Cross-Module Binding
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-016.md">⬅️ Part 16 — CDI/HK2 Boundary: Service Locator, Injection Runtime, dan Extension Point GlassFish</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-018.md">Part 18 — Naming, JNDI, Resource References, dan Cross-Module Binding ➡️</a>
</div>
