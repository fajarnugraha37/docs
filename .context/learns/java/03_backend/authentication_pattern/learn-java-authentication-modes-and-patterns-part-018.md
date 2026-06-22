# learn-java-authentication-modes-and-patterns-part-018  
# LDAP, Active Directory, Kerberos, and Enterprise Directory Authentication

> Seri: **Java Authentication Modes and Patterns**  
> Part: **018**  
> Target pembaca: engineer Java 8–25 yang ingin memahami authentication enterprise directory secara arsitektural, operasional, dan production-grade.  
> Fokus: **LDAP bind/search, Active Directory conventions, Kerberos/SPNEGO SSO, JAAS Kerberos, group resolution, directory outage behavior, identity mapping, dan failure modeling.**

---

## 0. Executive Summary

Banyak engineer modern langsung melompat ke OAuth2/OIDC, JWT, API gateway, atau service mesh. Tetapi di enterprise besar, government system, bank, telco, dan legacy internal platform, authentication sering masih berakar pada:

1. **LDAP directory**
2. **Microsoft Active Directory**
3. **Kerberos**
4. **SPNEGO / Integrated Windows Authentication**
5. **JAAS Kerberos**
6. **Group/role lookup dari directory**

Materi ini membahas bukan hanya “cara login ke LDAP”, tetapi bagaimana directory authentication bekerja sebagai sistem identitas enterprise.

Mental model utamanya:

```text
User / Workstation / Service
        |
        | presents credential or ticket
        v
Directory / Domain Infrastructure
        |
        | proves identity and returns attributes/groups
        v
Java Application
        |
        | maps identity into application principal/session/token
        v
Authorization and Audit Layer
```

Authentication berbasis directory sering terlihat sederhana:

```text
username + password -> LDAP bind -> success/fail
```

Tetapi pada production system, pertanyaan sebenarnya jauh lebih banyak:

- User login pakai format apa?
  - `uid=fajar,ou=people,dc=example,dc=com`
  - `fajar`
  - `fajar@example.com`
  - `EXAMPLE\fajar`
  - UPN?
  - sAMAccountName?
- Apakah aplikasi boleh mengetahui password user?
- Apakah aplikasi melakukan bind langsung sebagai user?
- Apakah aplikasi memakai service account untuk search user?
- Bagaimana resolve group?
- Apakah nested group dihitung?
- Apakah disabled account ditolak?
- Apakah expired password ditolak?
- Apakah lockout dibedakan dari bad credential?
- Apakah directory outage membuat semua user gagal login?
- Apakah group cache menyebabkan privilege stale?
- Apakah application role berasal dari group directory atau mapping lokal?
- Apakah Java security context menyimpan DN, username, UPN, employee ID, atau immutable subject ID?
- Apakah audit log bisa membuktikan siapa login, dari mana, dan group apa yang dipakai saat itu?

Part ini akan membangun jawaban sistematis.

---

## 1. Problem yang Diselesaikan

Directory authentication menyelesaikan problem klasik enterprise:

> “Bagaimana banyak aplikasi internal bisa mempercayai identitas user dan service tanpa setiap aplikasi menyimpan credential sendiri?”

Tanpa directory:

```text
App A punya user table sendiri
App B punya user table sendiri
App C punya user table sendiri
Password beda-beda
Disable employee harus manual di banyak sistem
Audit tersebar
Policy tidak konsisten
```

Dengan directory:

```text
Identity source centralized
Password policy centralized
Account lifecycle centralized
Group membership centralized
Application dapat menggunakan identity source yang sama
```

Namun centralization juga membawa risiko:

```text
Directory down -> login banyak aplikasi down
Directory compromise -> blast radius besar
Group mapping salah -> privilege salah
Service account bocor -> directory enumeration
LDAP query buruk -> login latency tinggi
Kerberos config salah -> SSO gagal misterius
```

Jadi directory authentication bukan sekadar integrasi teknis. Ia adalah desain identitas enterprise.

---

## 2. Mental Model: Directory Authentication Sebagai 4 Layer

Untuk memahami LDAP/AD/Kerberos, pisahkan menjadi empat layer.

```text
+-------------------------------------------------------------+
| 4. Application Identity Layer                               |
|    App principal, session, roles, tenant, audit subject      |
+-------------------------------------------------------------+
| 3. Attribute and Group Layer                                |
|    LDAP attributes, AD groups, nested group resolution       |
+-------------------------------------------------------------+
| 2. Proof Layer                                              |
|    Password bind, Kerberos ticket, SPNEGO token              |
+-------------------------------------------------------------+
| 1. Directory / Domain Infrastructure Layer                  |
|    LDAP server, AD domain controller, KDC, DNS, realm        |
+-------------------------------------------------------------+
```

### 2.1 Layer 1 — Directory / Domain Infrastructure

Ini sumber identity enterprise.

Contoh:

- OpenLDAP
- Microsoft Active Directory Domain Services
- Red Hat Directory Server
- ApacheDS
- FreeIPA
- Oracle Unified Directory
- LDAP-compatible corporate directory

Layer ini menyimpan:

- user account,
- service account,
- group,
- organizational unit,
- computer object,
- policy metadata,
- password-related state,
- account state,
- certificate mappings,
- Kerberos principal relation.

### 2.2 Layer 2 — Proof Layer

Ini cara user/service membuktikan identitas.

Contoh proof:

```text
Password bind:
  user submits password
  app tries LDAP bind as that user

Kerberos:
  client obtains ticket from KDC
  app validates ticket using service principal/keytab

SPNEGO:
  browser and server negotiate Kerberos/NTLM token over HTTP Negotiate
```

### 2.3 Layer 3 — Attribute and Group Layer

Setelah identity terbukti, aplikasi sering butuh informasi:

```text
displayName
mail
employeeNumber
department
memberOf
groups
account status
tenant/agency/org
```

Di sinilah banyak bug muncul:

- user berhasil login tapi group tidak terbaca,
- nested group tidak dihitung,
- group cache stale,
- DN berubah karena user dipindah OU,
- role mapping terlalu bergantung pada display name,
- directory search terlalu luas dan lambat.

### 2.4 Layer 4 — Application Identity Layer

Aplikasi tidak boleh sekadar “menelan mentah-mentah” LDAP identity.

Aplikasi perlu membentuk identity internal:

```text
Directory identity:
  dn = cn=Fajar Abdi Nugraha,ou=Users,dc=corp,dc=example
  upn = fajar@example.com
  sAMAccountName = fajar
  objectGUID = immutable AD identifier
  groups = [...]

Application identity:
  principalId = internal stable subject id
  username = fajar@example.com
  displayName = Fajar Abdi Nugraha
  authSource = ACTIVE_DIRECTORY
  authorities = ROLE_CASE_OFFICER, ROLE_APPROVER
  loginTime = ...
  authStrength = PASSWORD_DIRECTORY or KERBEROS_SSO
```

Prinsip penting:

> Directory identity harus dipetakan secara eksplisit menjadi application identity. Jangan biarkan DN/group mentah menjadi domain model tanpa normalization.

---

## 3. LDAP: Apa Itu Secara Praktis?

LDAP adalah protokol untuk mengakses directory tree.

Struktur mentalnya:

```text
dc=example,dc=com
|
+-- ou=people
|   |
|   +-- uid=fajar
|   +-- uid=alice
|
+-- ou=groups
    |
    +-- cn=case-officers
    +-- cn=approvers
```

Objek di directory memiliki:

```text
Distinguished Name (DN)
  uid=fajar,ou=people,dc=example,dc=com

Attributes
  uid: fajar
  cn: Fajar Abdi Nugraha
  mail: fajar@example.com
  memberOf: cn=case-officers,ou=groups,dc=example,dc=com
```

### 3.1 DN

DN adalah alamat unik entry dalam tree.

Contoh:

```text
uid=fajar,ou=people,dc=example,dc=com
cn=Case Officers,ou=groups,dc=example,dc=com
```

DN bersifat struktural. Jika user dipindah OU, DN bisa berubah.

Karena itu DN tidak selalu ideal sebagai immutable application user id.

### 3.2 RDN

RDN adalah komponen pertama DN.

```text
uid=fajar
cn=Case Officers
```

### 3.3 Base DN

Base DN adalah akar pencarian.

```text
dc=example,dc=com
ou=people,dc=example,dc=com
```

Search terlalu luas bisa mahal.

Search terlalu sempit bisa gagal menemukan user.

### 3.4 Search Filter

LDAP search filter menentukan entry mana yang dicari.

Contoh:

```text
(uid=fajar)
(mail=fajar@example.com)
(&(objectClass=person)(uid=fajar))
```

### 3.5 Bind

Bind adalah operasi authentication ke LDAP server.

Ada beberapa pola:

```text
Anonymous bind
Simple bind
SASL bind
TLS-protected bind
```

Dalam aplikasi Java enterprise, paling sering:

```text
service account bind -> search user -> user bind with password
```

atau:

```text
construct user DN -> user bind with password
```

---

## 4. LDAP Authentication Pattern 1: Direct DN Bind

Pattern paling sederhana:

```text
Input:
  username = fajar
  password = secret

App:
  dn = "uid=" + username + ",ou=people,dc=example,dc=com"
  ldap.bind(dn, password)
```

Diagram:

```text
Browser
  |
  | username/password
  v
Java App
  |
  | bind as uid=fajar,ou=people,...
  v
LDAP Server
  |
  | success/fail
  v
Java App creates session
```

### 4.1 Kelebihan

- Simple.
- Tidak perlu service account untuk search.
- Password tidak dibandingkan di aplikasi.
- LDAP server melakukan validation.

### 4.2 Kekurangan

- Butuh DN template stabil.
- Tidak cocok jika user bisa berada di banyak OU.
- Tidak cocok jika login identifier bisa email/UPN/employee ID.
- Rentan LDAP injection jika DN dibangun sembarangan.
- Sulit membaca metadata user sebelum bind.

### 4.3 Cocok Untuk

```text
Small directory
Flat OU
Predictable DN
Internal app sederhana
```

### 4.4 Tidak Cocok Untuk

```text
Large enterprise AD
Multiple OU
Multi-domain
User moved between departments
Login by email/UPN
Need account status check before bind
```

---

## 5. LDAP Authentication Pattern 2: Search-Then-Bind

Pattern enterprise yang lebih umum:

```text
1. App bind sebagai service account.
2. App search user berdasarkan login identifier.
3. App ambil DN user.
4. App bind sebagai user DN + submitted password.
5. Jika sukses, app search attributes/groups.
```

Diagram:

```text
Browser
  |
  | username/password
  v
Java App
  |
  | bind as service account
  v
LDAP
  |
  | search (&(objectClass=person)(uid=fajar))
  v
LDAP returns user DN
  |
  | bind as user DN with submitted password
  v
LDAP
  |
  | success/fail
  v
Java App loads groups and creates principal
```

### 5.1 Kelebihan

- User bisa berada di banyak OU.
- Login identifier fleksibel.
- Bisa support email, username, UPN.
- Bisa ambil attributes/groups.
- Lebih cocok untuk AD.

### 5.2 Kekurangan

- Butuh service account.
- Service account harus diamankan.
- Search filter harus aman.
- Directory search latency memengaruhi login.
- Service account permission harus minimum.
- App harus handle duplicate result.

### 5.3 Invariant Penting

Search user harus menghasilkan **tepat satu** candidate.

```text
0 result  -> invalid credential-like response
1 result  -> continue bind
>1 result -> configuration/security error
```

Jangan pilih result pertama secara diam-diam.

### 5.4 Search Filter Aman

Buruk:

```java
String filter = "(uid=" + username + ")";
```

Lebih aman:

```java
String filter = "(&(objectClass=person)(uid={0}))";
```

Dengan API yang mendukung escaping/binding parameter.

LDAP injection bisa terjadi jika input login tidak di-escape.

Contoh input berbahaya:

```text
*)(uid=*
```

Jika filter dibangun dengan string concat, query bisa berubah makna.

---

## 6. LDAP Authentication Pattern 3: Password Compare

Pattern:

```text
1. App bind sebagai service account.
2. App search user.
3. App compare password attribute.
```

Ini umumnya **tidak direkomendasikan**.

Alasan:

- Password attribute biasanya tidak boleh dibaca.
- Aplikasi tidak boleh memvalidasi password directory sendiri.
- Hash scheme directory bisa khusus.
- Policy lockout/expiry mungkin tidak diterapkan sama.
- Audit authentication di directory bisa tidak terjadi.

Lebih baik:

```text
Search user DN -> bind as user with submitted password
```

---

## 7. LDAP Authentication Pattern 4: SASL/GSSAPI

LDAP juga bisa memakai SASL mechanism, termasuk GSSAPI berbasis Kerberos.

Pattern ini lebih kompleks:

```text
Client obtains Kerberos credential
LDAP bind uses SASL/GSSAPI
No password sent to LDAP server
```

Biasanya dipakai pada:

- enterprise SSO,
- service account Kerberos,
- AD-integrated environment,
- secured internal infrastructure.

Untuk aplikasi web Java, Kerberos lebih sering muncul lewat SPNEGO/Negotiate di HTTP, bukan langsung LDAP SASL, walaupun keduanya mungkin.

---

## 8. Active Directory: LDAP Plus Domain Semantics

Active Directory bukan hanya LDAP server.

AD adalah identity/domain platform yang mencakup:

```text
LDAP directory
Kerberos KDC
DNS integration
Group Policy
Computer accounts
User Principal Name
Security Identifier
Domain trust
Global Catalog
Replication
```

Karena itu AD authentication sering punya aturan khusus yang tidak muncul di generic LDAP.

### 8.1 AD Login Identifiers

AD punya beberapa identifier umum:

```text
sAMAccountName:
  fajar

User Principal Name:
  fajar@example.com

Down-level logon name:
  EXAMPLE\fajar

Distinguished Name:
  CN=Fajar Abdi Nugraha,OU=Users,DC=example,DC=com

objectGUID:
  binary immutable identifier

objectSid:
  security identifier
```

Untuk aplikasi Java, login identifier yang umum:

```text
UPN: fajar@example.com
sAMAccountName: fajar
```

Namun untuk identity linking internal, sebaiknya pertimbangkan immutable identifier seperti `objectGUID` atau stable external ID yang disepakati.

### 8.2 AD Group Model

AD group membership bisa berada pada attribute seperti:

```text
memberOf
member
primaryGroupID
```

Namun `memberOf` tidak selalu cukup untuk semua kasus.

Masalah yang sering muncul:

- nested group,
- primary group tidak muncul seperti group biasa,
- cross-domain group,
- Global Catalog visibility,
- group type berbeda,
- user/group berada di domain berbeda,
- large group membership,
- token size problem pada Kerberos.

### 8.3 AD Account State

AD menyimpan status seperti:

```text
disabled account
locked account
password expired
password must change
account expired
bad password count
logon hours
workstation restrictions
```

Tidak semua status terlihat sebagai error yang mudah dipahami oleh aplikasi.

Aplikasi harus menentukan:

```text
Apakah bad password, disabled, expired, dan locked dibedakan ke user?
Apakah semuanya ditampilkan sebagai "invalid username or password"?
Apakah detail hanya masuk audit internal?
```

Best practice UX/security:

```text
User-facing:
  "Invalid username or password"

Audit/internal:
  reason = ACCOUNT_LOCKED / PASSWORD_EXPIRED / DISABLED / BAD_CREDENTIAL
```

---

## 9. Kerberos: Mental Model

Kerberos adalah authentication protocol berbasis ticket.

Prinsip dasarnya:

> Password tidak dikirim ke service. Client mendapatkan ticket dari KDC, lalu service memvalidasi ticket tersebut.

Aktor utama:

```text
Client/User
KDC
  - Authentication Service (AS)
  - Ticket Granting Service (TGS)
Service/Application
```

Flow sederhana:

```text
1. User login ke workstation.
2. Workstation mendapatkan Ticket Granting Ticket (TGT) dari KDC.
3. Browser ingin akses HTTP service.
4. Browser meminta service ticket untuk HTTP/app.example.com.
5. Browser mengirim ticket ke Java app via SPNEGO/Negotiate.
6. Java app memvalidasi ticket menggunakan service keytab.
7. App mengenali principal user.
```

Diagram:

```text
User Workstation
  |
  | login / obtain TGT
  v
KDC
  |
  | TGT
  v
Browser
  |
  | request service ticket for HTTP/app.example.com
  v
KDC
  |
  | service ticket
  v
Browser
  |
  | Authorization: Negotiate <token>
  v
Java Web App
  |
  | validate using keytab for HTTP/app.example.com@REALM
  v
Authenticated principal
```

### 9.1 Kerberos Principal

Contoh principal user:

```text
fajar@EXAMPLE.COM
```

Contoh principal service:

```text
HTTP/app.example.com@EXAMPLE.COM
```

### 9.2 Keytab

Keytab adalah file yang menyimpan key service principal.

```text
app server memiliki keytab
keytab digunakan untuk decrypt/validate service ticket
```

Keytab harus diperlakukan seperti secret tingkat tinggi.

Jika keytab bocor, attacker bisa impersonate service untuk principal tersebut.

### 9.3 Realm

Realm biasanya uppercase domain-like name:

```text
EXAMPLE.COM
```

AD domain sering dipetakan ke Kerberos realm.

### 9.4 SPN

Service Principal Name di AD mengikat service ke account.

Contoh:

```text
HTTP/app.example.com
HTTP/app
```

SPN duplicate adalah sumber masalah klasik Kerberos.

### 9.5 Clock Skew

Kerberos sensitif terhadap waktu.

Jika clock client/server/KDC berbeda terlalu jauh, authentication bisa gagal.

Operational invariant:

```text
Semua node app, client, dan domain controller harus sinkron waktu via NTP.
```

---

## 10. SPNEGO / Negotiate di Java Web App

SPNEGO memungkinkan browser melakukan Integrated Windows Authentication ke web app.

HTTP level:

```http
GET /app HTTP/1.1
Host: app.example.com

HTTP/1.1 401 Unauthorized
WWW-Authenticate: Negotiate

GET /app HTTP/1.1
Host: app.example.com
Authorization: Negotiate YIIF...
```

Server memvalidasi token dan mendapatkan user principal.

### 10.1 Kapan SPNEGO Cocok?

Cocok untuk:

```text
Internal enterprise app
User memakai domain-joined workstation
Browser dikonfigurasi trust intranet zone
AD/Kerberos tersedia
SSO experience dibutuhkan
```

Kurang cocok untuk:

```text
Public internet app
Mobile app
External partner
Unmanaged device
Cross-platform browser environment yang tidak terkontrol
```

### 10.2 Fallback Pattern

Sering production membutuhkan fallback:

```text
Kerberos/SPNEGO success -> SSO
Kerberos/SPNEGO fail    -> form login / OIDC / manual login
```

Namun fallback bisa membuka attack surface:

```text
If SSO fails silently, user may enter password into less secure form.
If fallback bypasses directory policy, authentication assurance weakens.
If fallback maps identity differently, duplicate identity can occur.
```

---

## 11. JAAS Kerberos di Java

Java menyediakan JAAS dan Kerberos support melalui `Krb5LoginModule`.

Mental model:

```text
LoginContext
  -> uses JAAS Configuration
  -> invokes Krb5LoginModule
  -> obtains Kerberos credentials
  -> populates Subject with KerberosPrincipal and credentials
```

Contoh konsep konfigurasi JAAS:

```properties
com.example.App {
  com.sun.security.auth.module.Krb5LoginModule required
  useKeyTab=true
  keyTab="/etc/security/keytabs/http-app.keytab"
  principal="HTTP/app.example.com@EXAMPLE.COM"
  storeKey=true
  doNotPrompt=true
  isInitiator=false;
};
```

Makna konseptual:

```text
useKeyTab=true
  login menggunakan keytab, bukan prompt password

principal=...
  service principal yang digunakan

storeKey=true
  simpan key di Subject private credential

doNotPrompt=true
  jangan prompt password interactive

isInitiator=false
  service menerima token, bukan memulai outbound Kerberos auth
```

Untuk outbound client Kerberos, setting bisa berbeda.

### 11.1 Subject Setelah Login

Setelah `LoginContext.login()` berhasil:

```text
Subject contains:
  KerberosPrincipal
  KerberosTicket or KerberosKey depending configuration
```

Tetapi aplikasi modern jarang langsung mengekspos JAAS ke business code. Biasanya framework seperti Spring Security Kerberos atau container integration membungkusnya.

### 11.2 Java GSS-API

Untuk secure token exchange Kerberos, Java juga punya GSS-API.

Konsep:

```text
GSSContext
GSSCredential
GSSName
acceptSecContext
initSecContext
```

Untuk web SPNEGO, server biasanya melakukan accept security context dari token Negotiate.

---

## 12. Spring Security LDAP

Spring Security LDAP biasanya dipakai ketika aplikasi menerima username/password dan memvalidasi ke LDAP.

Komponen konseptual:

```text
AuthenticationFilter
  -> AuthenticationManager
  -> LdapAuthenticationProvider
      -> Authenticator
          -> BindAuthenticator or PasswordComparisonAuthenticator
      -> AuthoritiesPopulator
          -> group search / role mapping
```

Pattern umum:

```java
@Bean
AuthenticationManager authenticationManager(BaseLdapPathContextSource contextSource) {
    LdapBindAuthenticationManagerFactory factory =
        new LdapBindAuthenticationManagerFactory(contextSource);
    factory.setUserDnPatterns("uid={0},ou=people");
    return factory.createAuthenticationManager();
}
```

Namun konfigurasi real enterprise sering memakai search:

```text
userSearchBase = ou=users
userSearchFilter = (sAMAccountName={0})
groupSearchBase = ou=groups
groupSearchFilter = (member={0})
```

### 12.1 Spring LDAP Bind Authentication

Bind authentication berarti:

```text
Spring tidak membaca password user dari LDAP.
Spring mencoba bind ke LDAP sebagai user.
LDAP menentukan valid/tidaknya password.
```

Ini penting.

Aplikasi tidak memverifikasi password sendiri.

### 12.2 Authorities Populator

Setelah user ter-authenticate, aplikasi perlu authorities.

Contoh mapping:

```text
LDAP group:
  CN=ACEAS_CASE_OFFICER,OU=Groups,DC=example,DC=com

Spring authority:
  ROLE_CASE_OFFICER
```

Jangan selalu expose group raw sebagai role tanpa normalization.

Buruk:

```text
ROLE_CN=ACEAS_CASE_OFFICER,OU=Groups,DC=example,DC=com
```

Lebih baik:

```text
Directory group DN -> mapping table/config -> application role
```

---

## 13. Spring Security Active Directory Provider

Spring Security memiliki provider khusus untuk Active Directory conventions.

Konsep:

```text
ActiveDirectoryLdapAuthenticationProvider(domain, url)
```

Provider ini memahami pola AD seperti UPN/domain.

Namun tetap perlu keputusan desain:

```text
Login identifier apa?
Domain apa?
Apakah multi-domain?
Apakah user search filter custom?
Apakah convert sub-error code?
Apakah role dari memberOf?
Apakah nested group didukung?
```

Active Directory bukan sekadar LDAP generic. Jangan perlakukan AD besar seperti OpenLDAP kecil.

---

## 14. Spring Security Kerberos

Spring Security Kerberos extension menyediakan integrasi SPNEGO/Kerberos untuk Spring app.

Konsep flow:

```text
SpnegoAuthenticationProcessingFilter
  -> KerberosServiceAuthenticationProvider
  -> SunJaasKerberosTicketValidator
  -> UserDetailsService
```

Mental model:

```text
Browser sends Negotiate token
Spring filter extracts token
Kerberos validator validates token using keytab
Principal is extracted
UserDetailsService loads app user/roles
SecurityContext is populated
```

### 14.1 Kerberos Principal to App User

Kerberos principal:

```text
fajar@EXAMPLE.COM
```

Application user:

```text
fajar
fajar@example.com
internal-user-id-123
```

Mapping harus eksplisit.

Jangan berasumsi selalu cukup menghapus suffix realm.

Buruk:

```java
String username = kerberosPrincipal.split("@")[0];
```

Lebih baik:

```text
Kerberos principal -> directory lookup -> immutable user id -> app principal
```

---

## 15. Directory Group Resolution

Group resolution adalah salah satu bagian paling kompleks.

### 15.1 Direct Group

User punya attribute:

```text
memberOf:
  cn=case-officers,ou=groups,dc=example,dc=com
```

Aplikasi membaca langsung.

Kelemahan:

- nested group tidak dihitung,
- primary group AD bisa tidak muncul,
- cross-domain group bisa tidak lengkap.

### 15.2 Group Search

Cari group yang memiliki user sebagai member:

```text
(member=uid=fajar,ou=people,dc=example,dc=com)
```

Kelemahan:

- butuh DN user,
- mahal jika group banyak,
- nested group masih perlu recursion.

### 15.3 Nested Group

Nested group:

```text
Group A contains Group B
Group B contains User
```

Apakah user dianggap anggota Group A?

Dalam enterprise, sering iya.

Tetapi aplikasi harus sadar:

```text
authorization decision may depend on transitive closure of group membership
```

### 15.4 Recursive Group Resolution

Pseudocode:

```text
visited = set()
queue = direct groups

while queue not empty:
  group = queue.pop()
  if group already visited:
    continue
  visited.add(group)

  parentGroups = find groups where member = group.dn
  queue.addAll(parentGroups)
```

Perlu guard:

```text
max depth
cycle detection
timeout
cache
pagination
```

### 15.5 AD Matching Rule for Nested Group

AD punya matching rule khusus untuk nested membership di LDAP filter, sering dikenal sebagai LDAP_MATCHING_RULE_IN_CHAIN.

Contoh konseptual:

```text
(member:1.2.840.113556.1.4.1941:=<userDN>)
```

Ini AD-specific, bukan portable LDAP.

Trade-off:

```text
+ simpler app logic
+ AD server handles recursion
- AD-specific
- can be expensive
- may not behave same across domains/GC
```

---

## 16. Role Mapping Strategy

Jangan samakan group directory dengan role aplikasi secara mentah.

### 16.1 Anti-Pattern: Raw Group Equals Role

```text
CN=Finance-App-Approver,OU=Groups,DC=corp,DC=example
  -> ROLE_CN=Finance-App-Approver,OU=Groups,DC=corp,DC=example
```

Masalah:

- DN bisa berubah.
- Naming group bisa berubah.
- Directory admin bisa membuat group baru tanpa app governance.
- App role menjadi tergantung struktur AD.

### 16.2 Better Pattern: Explicit Mapping

```text
Directory Group                         Application Role
----------------------------------------------------------------
CN=ACEAS_CASE_OFFICER,...               ROLE_CASE_OFFICER
CN=ACEAS_CASE_APPROVER,...              ROLE_CASE_APPROVER
CN=ACEAS_ADMIN,...                      ROLE_ADMIN
```

Role internal stabil.

Group eksternal bisa berubah lewat config/change management.

### 16.3 Best Pattern for Regulated Systems

Untuk sistem regulatori/case management:

```text
Directory group proves organizational membership.
Application role grants domain capability.
Entitlement assignment is auditable.
Mapping changes are versioned.
Login event records mapping snapshot/version.
```

Contoh audit field:

```json
{
  "subject": "user-123",
  "auth_source": "ACTIVE_DIRECTORY",
  "directory_principal": "fajar@example.com",
  "directory_groups_hash": "sha256:...",
  "role_mapping_version": "2026-06-19.1",
  "application_roles": ["ROLE_CASE_OFFICER"],
  "decision": "AUTHENTICATED"
}
```

---

## 17. Account Lifecycle and Deprovisioning

Directory auth sangat kuat untuk account lifecycle.

Jika user resign dan account disabled:

```text
Next login should fail.
Existing session may or may not be invalidated immediately.
```

Pertanyaan desain:

```text
Apakah aplikasi mengecek account status hanya saat login?
Apakah session lama tetap hidup sampai timeout?
Apakah ada periodic revalidation?
Apakah ada push event dari IAM/directory?
Apakah high-risk action melakukan step-up/recheck?
```

### 17.1 Login-Time Only Validation

```text
User disabled after login
Session remains valid until timeout
```

Cocok untuk low/medium risk.

Tidak cukup untuk high-risk admin/regulatory action.

### 17.2 Periodic Revalidation

```text
Every N minutes:
  recheck account status and group version
```

Trade-off:

```text
+ faster deprovisioning effect
- more LDAP load
- outage behavior more complex
```

### 17.3 Action-Time Revalidation

Untuk aksi sensitif:

```text
Before approve/enforce/delete/export:
  recheck user account active
  recheck role/group
```

Cocok untuk regulated systems.

---

## 18. Directory Cache Strategy

Cache diperlukan, tapi berbahaya.

Yang bisa di-cache:

```text
user attributes
group membership
role mapping
successful auth result?
directory metadata
```

Yang sebaiknya tidak di-cache sembarangan:

```text
submitted password
failed login reason detail
raw credential
Kerberos ticket beyond its validity semantics
```

### 18.1 Group Cache

Contoh:

```text
key = directoryUserImmutableId
value = resolvedGroups + resolvedAt + ttl
ttl = 5 minutes
```

Trade-off:

```text
Short TTL:
  + privilege changes apply faster
  - more LDAP load

Long TTL:
  + better performance
  - stale privilege risk
```

### 18.2 Negative Cache

Caching user-not-found bisa mengurangi load saat brute force.

Tetapi hati-hati:

```text
If user newly created, login may fail until cache expires.
If negative cache leaks timing, enumeration risk remains.
```

### 18.3 Cache Invalidation

Ideal:

```text
Directory change event -> invalidate user/group cache
```

Realistis:

```text
TTL + manual admin invalidate + revalidation for sensitive actions
```

---

## 19. Connection Pooling and Timeouts

LDAP login adalah hot path.

Masalah klasik:

```text
LDAP server lambat
Connection leak
No timeout
Thread pool exhaustion
Login storm
Directory outage cascades ke app outage
```

### 19.1 Timeout Invariants

Setiap LDAP call harus punya timeout:

```text
connect timeout
read timeout
search timeout
overall login timeout
```

Jangan biarkan login request menggantung lama.

### 19.2 Pooling

Connection pooling berguna untuk service account search.

Namun untuk user bind, pooling lebih tricky karena connection bound ke identity.

Pattern umum:

```text
service account connection pool for search
short-lived user bind connection for password validation
```

### 19.3 Circuit Breaker

Jika LDAP down:

```text
After repeated failures:
  stop hammering LDAP
  return controlled auth unavailable
  surface operational alert
```

Jangan ubah menjadi:

```text
fail open
allow everyone
fallback to stale group privilege indefinitely
```

Untuk authentication, fail-closed biasanya default.

Namun UX message bisa:

```text
"Authentication service temporarily unavailable"
```

bukan:

```text
"Invalid username or password"
```

karena itu misleading dan mengganggu incident diagnosis.

---

## 20. Directory Outage Behavior

Directory outage harus diputuskan eksplisit.

Mode:

```text
Fail closed:
  no new login

Allow existing sessions:
  existing valid sessions continue until timeout

Revalidate failure:
  sensitive action may be blocked if revalidation required

Break-glass:
  controlled emergency admin account/mode
```

### 20.1 Break-Glass Account

Untuk regulated/mission-critical system, kadang butuh break-glass.

Prinsip:

```text
separate from directory
strong MFA
very limited users
short-lived
heavily audited
alert immediately
manual approval/runbook
disabled by default if possible
```

Break-glass bukan “local admin password semua orang tahu”.

### 20.2 Cached Login?

Beberapa sistem ingin “cached credential login” saat directory down.

Ini berbahaya untuk web enterprise.

Jika dilakukan:

```text
Only for narrow use case
Only with recent successful login
Only with hashed verifier
No privilege escalation
Short validity
Strong audit
```

Namun secara umum, untuk server-side enterprise app:

```text
directory down -> no new directory login
```

lebih aman.

---

## 21. Security Risks

### 21.1 LDAP Injection

Penyebab:

```text
String concatenation in LDAP filter or DN
```

Mitigasi:

```text
escape input
parameterized filter API
strict login identifier validation
allowlist attribute used for login
```

### 21.2 Service Account Overprivilege

Service account sering diberi akses terlalu luas.

Mitigasi:

```text
read-only
minimum OU scope
cannot modify password/group
secret rotated
credential stored in secrets manager
audit bind/search usage
network restricted
```

### 21.3 Group Spoofing via Naming

Jika app mapping role berdasarkan group common name saja:

```text
cn=Admin
```

attacker/internal misconfiguration bisa membuat group `Admin` di OU lain.

Mitigasi:

```text
map by full DN or immutable group ID
restrict search base
validate expected domain/OU
version role mapping
```

### 21.4 Identity Collision

Misalnya:

```text
fajar in domain A
fajar in domain B
```

Jika app hanya menyimpan `username=fajar`, collision terjadi.

Mitigasi:

```text
store issuer/source/domain + immutable subject ID
```

### 21.5 Stale Authorization

User dikeluarkan dari group tapi app cache masih memberi role.

Mitigasi:

```text
short TTL
sensitive action revalidation
event-based invalidation
session role version
```

### 21.6 Kerberos Keytab Theft

Jika keytab bocor, attacker bisa impersonate service.

Mitigasi:

```text
file permission strict
secret distribution controlled
rotate service account key
monitor abnormal service ticket use
run app with least privilege OS user
```

### 21.7 NTLM Fallback

SPNEGO bisa jatuh ke NTLM di beberapa environment.

NTLM punya risiko dan semantik berbeda dari Kerberos.

Mitigasi:

```text
explicitly decide whether NTLM allowed
prefer Kerberos only where possible
monitor negotiated mechanism
document fallback behavior
```

---

## 22. Java Implementation Building Blocks

### 22.1 JNDI LDAP

Java menyediakan JNDI untuk LDAP.

Konsep:

```java
Hashtable<String, String> env = new Hashtable<>();
env.put(Context.INITIAL_CONTEXT_FACTORY, "com.sun.jndi.ldap.LdapCtxFactory");
env.put(Context.PROVIDER_URL, "ldaps://ldap.example.com:636");
env.put(Context.SECURITY_AUTHENTICATION, "simple");
env.put(Context.SECURITY_PRINCIPAL, "uid=service,ou=svc,dc=example,dc=com");
env.put(Context.SECURITY_CREDENTIALS, servicePassword);

DirContext ctx = new InitialDirContext(env);
```

Catatan:

- Gunakan LDAPS atau StartTLS.
- Set timeout.
- Jangan log credential.
- Escape filter.
- Close context.
- Hati-hati referral.
- Hati-hati connection pooling global property.

### 22.2 Spring LDAP / Spring Security LDAP

Lebih nyaman daripada JNDI langsung.

Keuntungan:

```text
template abstraction
context source config
bind authenticator
user search
group authorities populator
integration dengan AuthenticationManager
```

### 22.3 JAAS Krb5LoginModule

Dipakai untuk Kerberos credential acquisition/validation.

### 22.4 GSS-API

Dipakai untuk SPNEGO/Kerberos token handling.

### 22.5 Container Integrated Realm

Tomcat/WildFly/WebLogic/GlassFish bisa punya realm/container auth.

Trade-off:

```text
+ centralized at container
+ legacy enterprise friendly
- app portability/config clarity may suffer
- harder with cloud-native deployment
- app/framework security context mismatch possible
```

---

## 23. Java 8–25 Relevance

### 23.1 Java 8

Java 8 masih banyak dipakai di enterprise legacy.

Relevant APIs:

```text
JNDI LDAP
JAAS
Krb5LoginModule
GSS-API
TLS/JSSE
```

Masalah:

```text
older TLS defaults
legacy crypto config
older framework versions
javax namespace
```

### 23.2 Java 11/17

Common enterprise baseline modern.

Relevant:

```text
better TLS ecosystem
long-term support adoption
Spring Boot 2/3 transition
Jakarta namespace migration around Java 17 era
```

### 23.3 Java 21

Modern LTS baseline.

Relevant:

```text
virtual threads
modern Spring Boot 3.x ecosystem
stronger runtime ergonomics
```

Authentication implication:

```text
ThreadLocal security context propagation must be reviewed with virtual threads and async execution.
```

### 23.4 Java 25

Latest generation in this series scope.

Relevant:

```text
JAAS and LoginContext still present
Kerberos/GSS remains relevant
virtual thread / structured concurrency / scoped value model affects context propagation thinking
crypto/key handling improvements elsewhere in Java 25 ecosystem
```

Core point:

> Directory authentication is old, but its Java integration remains relevant across Java 8–25 because enterprise identity infrastructure changes slower than application frameworks.

---

## 24. Production Design Pattern: LDAP Login with Explicit App Identity

Recommended high-level design:

```text
1. Validate login identifier syntax.
2. Bind service account using secure connection.
3. Search user under constrained base DN.
4. Require exactly one user result.
5. Check account-related attributes if available and reliable.
6. Bind as user DN with submitted password.
7. Reload user attributes/groups using service account.
8. Resolve nested groups if required.
9. Map external groups to internal roles through versioned mapping.
10. Create application principal/session.
11. Audit authentication decision.
12. Cache safe metadata with short TTL.
```

Diagram:

```text
[Login Request]
      |
      v
[Input Normalize]
      |
      v
[Service Bind]
      |
      v
[User Search: exactly one]
      |
      v
[User Bind Password Validation]
      |
      v
[Load Attributes + Groups]
      |
      v
[Map to App Principal]
      |
      v
[Create Session / Token]
      |
      v
[Audit Event]
```

### 24.1 Principal Model

Example Java-ish record:

```java
public record DirectoryAuthenticatedPrincipal(
    String applicationSubjectId,
    String directorySource,
    String directoryImmutableId,
    String loginName,
    String displayName,
    String email,
    Set<String> directoryGroupIds,
    Set<String> applicationRoles,
    Instant authenticatedAt,
    String authenticationMethod,
    String roleMappingVersion
) {}
```

Important:

```text
applicationSubjectId != displayName
applicationSubjectId != mutable DN
applicationSubjectId should be stable
```

---

## 25. Production Design Pattern: Kerberos SSO Login with Directory Enrichment

Flow:

```text
1. Browser sends SPNEGO token.
2. Java app validates token using service principal keytab.
3. Extract Kerberos principal.
4. Normalize principal.
5. Lookup user in directory.
6. Resolve groups.
7. Map groups to roles.
8. Create application session.
9. Audit SSO login.
```

Diagram:

```text
Browser
  |
  | Authorization: Negotiate
  v
SPNEGO Filter
  |
  | validate ticket using keytab
  v
Kerberos Principal
  |
  | lookup directory user
  v
Directory Attributes + Groups
  |
  | map
  v
Application Principal
```

Critical invariant:

```text
Kerberos proves network/domain identity.
Application still decides whether that identity is allowed and what it can do.
```

Kerberos authentication success is not the same as application authorization.

---

## 26. Audit Model

Authentication audit event should capture:

```text
event_type
timestamp
correlation_id
request_id
client_ip
user_agent
auth_method
directory_source
login_identifier_submitted
resolved_subject_id
resolved_directory_id
result
failure_reason_internal
groups_resolved_count
role_mapping_version
application_roles
latency_ms
directory_server/realm if safe
```

Avoid logging:

```text
password
raw Kerberos token
full keytab path if sensitive
sensitive PII beyond necessity
excessive group list if huge/PII-sensitive
```

### 26.1 Example Success Event

```json
{
  "event_type": "AUTHENTICATION_SUCCESS",
  "auth_method": "LDAP_BIND",
  "directory_source": "CORP_AD",
  "resolved_subject_id": "usr_12345",
  "resolved_directory_id": "ad-objectguid-...",
  "role_mapping_version": "2026-06-19.1",
  "application_roles": ["ROLE_CASE_OFFICER"],
  "latency_ms": 184
}
```

### 26.2 Example Failure Event

```json
{
  "event_type": "AUTHENTICATION_FAILURE",
  "auth_method": "LDAP_BIND",
  "directory_source": "CORP_AD",
  "login_identifier_hash": "sha256:...",
  "failure_reason_internal": "BAD_CREDENTIAL",
  "user_visible_reason": "INVALID_CREDENTIAL",
  "latency_ms": 121
}
```

---

## 27. Failure Mode Catalog

### 27.1 User Not Found

Cause:

```text
wrong search base
wrong filter
user disabled/deleted
replication delay
input normalization mismatch
```

User-facing:

```text
Invalid username or password
```

Internal:

```text
USER_NOT_FOUND
```

### 27.2 Multiple Users Found

Cause:

```text
bad filter
non-unique login attribute
multi-domain collision
```

Correct handling:

```text
fail authentication
raise security/config alert
do not choose first user
```

### 27.3 Bad Credential

Cause:

```text
wrong password
expired password sometimes appears differently
locked account sometimes appears differently
```

Handling:

```text
generic user-facing error
internal reason if available
throttling
audit
```

### 27.4 Account Disabled

Handling:

```text
deny login
generic user-facing error or contact admin depending policy
internal audit reason = DISABLED
```

### 27.5 Password Expired / Must Change

Options:

```text
deny and redirect to corporate password change flow
support password change operation if approved
generic fail for app that cannot handle it
```

Do not implement password change casually unless directory governance supports it.

### 27.6 Directory Timeout

Handling:

```text
return auth unavailable
trigger alert
do not mark as bad credential
do not lock local app account due to infra failure
```

### 27.7 Group Lookup Failure After Successful Bind

Important decision:

```text
If user password valid but group lookup fails, should login succeed?
```

For most role-based enterprise apps:

```text
Fail closed.
No roles means no authenticated session.
```

Alternative:

```text
Allow login with minimal role only if explicitly designed.
```

### 27.8 Kerberos Ticket Validation Failure

Causes:

```text
SPN mismatch
keytab wrong
clock skew
DNS alias mismatch
duplicate SPN
browser not configured
realm mismatch
encryption type mismatch
```

Debugging Kerberos requires infra-level visibility, not just Java logs.

---

## 28. Decision Matrix

| Scenario | Recommended Pattern | Notes |
|---|---|---|
| Small internal app, simple LDAP tree | Direct DN bind | Only if DN pattern stable |
| Enterprise AD username/password login | Search-then-bind | Most common |
| Internal SSO on domain-joined machines | Kerberos/SPNEGO | Needs browser/domain config |
| Java service authenticating to LDAP | SASL/GSSAPI or service bind | Depends infra |
| Public internet users | Usually OIDC/passwordless, not LDAP direct | Do not expose AD directly |
| Partner API | OAuth2 client credentials/mTLS/API key | Directory user auth not ideal |
| Regulated internal case app | LDAP/Kerberos + explicit role mapping + audit | Revalidate sensitive actions |
| Multi-domain AD forest | AD-aware design | Avoid username-only identity |
| Cloud-native app with corporate identity | OIDC federation to IdP backed by AD | Often better than direct LDAP |

---

## 29. Common Mistakes

### Mistake 1 — Treating LDAP as a User Table

LDAP is not just a table.

It has:

```text
tree structure
DN semantics
schema
referrals
replication
access control
operational attributes
group semantics
```

### Mistake 2 — Storing DN as Permanent User ID

DN can change.

Prefer immutable directory identifier where possible.

### Mistake 3 — Assuming `memberOf` Means Complete Authorization

Nested groups, primary groups, cross-domain membership, and app-specific role mapping complicate this.

### Mistake 4 — No Timeout

Authentication must be bounded.

No timeout turns directory slowness into app thread exhaustion.

### Mistake 5 — Returning Detailed Login Errors

User-facing distinction between “bad password”, “disabled account”, and “user not found” can help enumeration.

### Mistake 6 — Choosing First Search Result

Multiple user matches is a security incident/configuration bug.

### Mistake 7 — Group CN-Based Role Mapping

Group common name is not globally unique enough.

Use full DN, immutable group ID, or governed mapping.

### Mistake 8 — Kerberos Without DNS/SPN Discipline

Kerberos depends heavily on:

```text
DNS
SPN
realm
keytab
time sync
browser trust zone
```

Application code may be correct while infra config is wrong.

### Mistake 9 — Letting Framework Defaults Decide Identity Semantics

Framework can authenticate.

Architecture must define:

```text
what is subject id?
what is display name?
what is role?
what is tenant?
what is audit principal?
```

### Mistake 10 — No Directory Outage Runbook

Directory outage will happen.

Authentication architecture must define expected behavior.

---

## 30. Testing Strategy

### 30.1 Unit Tests

Test:

```text
login identifier normalization
LDAP filter escaping
group-to-role mapping
duplicate result handling
account state mapping
cache TTL behavior
```

### 30.2 Integration Tests

Use embedded LDAP or containerized LDAP for generic cases.

Test:

```text
successful bind
bad password
user not found
multiple user match
group lookup
nested group if supported
timeout behavior
```

### 30.3 Active Directory Tests

AD-specific behavior often cannot be fully simulated by generic LDAP.

Need environment/integration test for:

```text
UPN login
sAMAccountName login
disabled account
locked account
expired password
nested group
cross-domain group
Global Catalog behavior
Kerberos/SPNEGO
```

### 30.4 Kerberos Test

Kerberos test requires:

```text
KDC
realm config
service principal
keytab
client ticket
time sync
SPNEGO-capable client
```

At minimum, have a staging/integration environment with scripted validation.

### 30.5 Security Regression Tests

Test:

```text
LDAP injection payload
case-insensitive login collision
unicode normalization
duplicate user result
stale group cache
role mapping config error
directory timeout
```

---

## 31. Implementation Checklist

### 31.1 LDAP Search-Then-Bind Checklist

```text
[ ] LDAPS or StartTLS used
[ ] Service account read-only
[ ] Service account secret stored securely
[ ] Login input normalized
[ ] LDAP filter escaped/parameterized
[ ] Search base constrained
[ ] Exactly one user required
[ ] User bind used for password validation
[ ] Account state handled
[ ] Groups loaded safely
[ ] Nested groups decision documented
[ ] Group-to-role mapping explicit
[ ] Connection/read/search timeouts configured
[ ] Circuit breaker or backoff exists
[ ] Audit success/failure
[ ] No password logged
[ ] Directory outage behavior documented
```

### 31.2 Active Directory Checklist

```text
[ ] Login identifier chosen: UPN/sAMAccountName/etc.
[ ] Multi-domain collision handled
[ ] Immutable user identifier selected
[ ] Disabled/locked/expired behavior tested
[ ] Nested group strategy selected
[ ] Global Catalog need evaluated
[ ] Referrals behavior decided
[ ] Group mapping governed
[ ] AD-specific filters documented
```

### 31.3 Kerberos/SPNEGO Checklist

```text
[ ] Service principal created
[ ] SPN registered correctly
[ ] No duplicate SPN
[ ] Keytab generated and protected
[ ] App server hostname/DNS aligned with SPN
[ ] Realm config available
[ ] Clock sync verified
[ ] Browser configured for Negotiate
[ ] NTLM fallback decision explicit
[ ] Kerberos principal mapped to app user safely
[ ] Fallback login behavior documented
[ ] Audit includes auth method = KERBEROS_SPNEGO
```

---

## 32. Top 1% Engineering Perspective

A top-tier engineer does not ask only:

```text
How do I configure LDAP login?
```

They ask:

```text
What identity does this prove?
What trust boundary was crossed?
What attribute is stable?
What happens if user moves OU?
What happens if group membership changes during active session?
What happens if LDAP is down?
What happens if search returns two users?
What happens if AD forest has duplicate usernames?
What happens if Kerberos ticket validates but user is not allowed in app?
What is cached, for how long, and why?
What audit evidence proves the decision?
What is the rollback strategy if directory integration breaks?
```

Directory authentication is where security architecture meets enterprise operations.

It is not glamorous, but it is foundational.

---

## 33. Mini Architecture Example

Scenario:

```text
Internal regulatory case management app
Users are employees in corporate AD
App must support SSO in office network
App must support manual login fallback for VPN edge cases
Roles must be auditable
High-risk actions require current entitlement
```

Recommended design:

```text
Primary auth:
  Kerberos/SPNEGO SSO

Fallback auth:
  LDAP search-then-bind over LDAPS

Identity enrichment:
  AD lookup by immutable objectGUID

Role mapping:
  AD group DN -> app role mapping table/config

Session:
  server-side session with absolute timeout and idle timeout

Sensitive actions:
  revalidate account active + role membership if cache older than N minutes

Cache:
  group cache TTL 5 minutes
  role mapping version recorded in session and audit

Outage:
  no new login if AD unavailable
  existing sessions continue for low-risk actions
  sensitive actions blocked if revalidation fails
  break-glass admin path separately controlled

Audit:
  login method, subject id, AD objectGUID, mapping version, roles, result
```

Diagram:

```text
Browser
  |
  | SPNEGO Negotiate
  v
Java App
  |
  | validate Kerberos keytab
  v
Kerberos Principal
  |
  | lookup AD user objectGUID + groups
  v
Role Mapping
  |
  | create app principal/session
  v
Case Management App
```

Fallback:

```text
Browser Login Form
  |
  | username/password
  v
Java App
  |
  | service bind + search user
  | user bind validate password
  | load groups
  v
Same Role Mapping + Session + Audit
```

Critical invariant:

```text
Both SSO and fallback must converge to the same application subject identity.
```

If Kerberos maps to `fajar`, but LDAP maps to `fajar@example.com`, and app treats them as separate accounts, the architecture is broken.

---

## 34. Summary

LDAP, Active Directory, and Kerberos remain critical in enterprise Java authentication.

Key points:

1. LDAP is a directory access protocol, not just a login API.
2. Active Directory adds domain, Kerberos, group, computer, and policy semantics.
3. Simple bind validates password but needs secure transport.
4. Search-then-bind is the common enterprise LDAP pattern.
5. Password compare is usually the wrong pattern.
6. Group resolution is often harder than password validation.
7. Directory groups should be mapped explicitly to application roles.
8. Kerberos enables passwordless SSO via tickets.
9. SPNEGO carries Kerberos authentication over HTTP.
10. JAAS and GSS-API remain relevant for Java Kerberos integration.
11. Directory outage behavior must be designed explicitly.
12. Identity mapping must use stable identifiers, not mutable display names or fragile DN assumptions.
13. Audit must capture authentication method, resolved subject, role mapping version, and decision result.
14. Production-grade directory auth is as much about operations and failure mode as code.

---

## 35. Design Questions

Use these before implementing LDAP/AD/Kerberos authentication:

```text
1. What directory is the source of truth?
2. Is this LDAP generic or Active Directory-specific?
3. What login identifier is accepted?
4. Is the login identifier globally unique?
5. What immutable subject identifier will the app store?
6. Is authentication password bind, Kerberos, SPNEGO, or OIDC federation?
7. If LDAP bind, is it direct DN bind or search-then-bind?
8. How is the search filter protected from injection?
9. What happens if search returns zero users?
10. What happens if search returns multiple users?
11. How are disabled, locked, expired, and password-must-change accounts handled?
12. How are groups resolved?
13. Are nested groups required?
14. Are cross-domain groups required?
15. How are directory groups mapped to app roles?
16. Is the mapping versioned and auditable?
17. How long are group memberships cached?
18. What actions require revalidation?
19. What happens if directory is down?
20. Is there a break-glass path?
21. How are service account secrets stored and rotated?
22. How are keytabs stored and rotated?
23. Are LDAP connections time-bounded?
24. Are login storms protected?
25. Are authentication events observable and forensically useful?
```

---

## 36. References

Primary references used for this part:

1. Oracle Java SE 25 JAAS Reference Guide  
   `https://docs.oracle.com/en/java/javase/25/security/java-authentication-authorization-service-jaas-reference-guide.html`

2. Oracle Java SE 25 `LoginContext` API  
   `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/javax/security/auth/login/LoginContext.html`

3. Oracle Java `Krb5LoginModule` documentation  
   `https://docs.oracle.com/javase/8/docs/jre/api/security/jaas/spec/com/sun/security/auth/module/Krb5LoginModule.html`

4. Oracle Java Single Sign-On Using Kerberos  
   `https://docs.oracle.com/javase/8/docs/technotes/guides/security/jgss/single-signon.html`

5. Spring Security LDAP Authentication Reference  
   `https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/ldap.html`

6. Spring Security Kerberos Reference  
   `https://docs.spring.io/spring-security-kerberos/reference/ssk.html`

7. Microsoft Kerberos Authentication Overview  
   `https://learn.microsoft.com/en-us/windows-server/security/kerberos/kerberos-authentication-overview`

8. Microsoft Windows Authentication Overview  
   `https://learn.microsoft.com/en-us/windows-server/security/windows-authentication/windows-authentication-overview`

---

## 37. Series Status

```text
Part 0  - Orientation: Mental Model of Authentication in Java Systems                      DONE
Part 1  - Java Runtime Security Foundations: Subject, Principal, Credential, Context       DONE
Part 2  - Authentication Taxonomy: Modes, Proof Types, and Trust Models                    DONE
Part 3  - Password Authentication Done Properly                                            DONE
Part 4  - Session-Based Authentication: Cookies, Server State, and Browser Reality         DONE
Part 5  - Servlet Container Authentication                                                 DONE
Part 6  - Jakarta Security and Jakarta Authentication Deep Dive                            DONE
Part 7  - Spring Security Authentication Architecture                                      DONE
Part 8  - Authentication Context Propagation in Servlet, Reactive, Async, Virtual Threads  DONE
Part 9  - API Key Authentication                                                           DONE
Part 10 - HMAC Request Signing                                                             DONE
Part 11 - JWT Authentication: Claims, Validation, and Misuse                               DONE
Part 12 - Opaque Token Authentication and Token Introspection                              DONE
Part 13 - OAuth 2.0 for Java Engineers                                                     DONE
Part 14 - OpenID Connect: Authentication on Top of OAuth2                                  DONE
Part 15 - Authorization Code + PKCE for Java Web and SPA Backends                          DONE
Part 16 - Client Credentials and Machine-to-Machine Authentication                         DONE
Part 17 - SAML 2.0 Authentication in Java Enterprise Systems                               DONE
Part 18 - LDAP, Active Directory, Kerberos, and Enterprise Directory Authentication         DONE
Part 19 - Mutual TLS Authentication                                                        NEXT
```

Series belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-017.md">⬅️ Part 17 — SAML 2.0 Authentication in Java Enterprise Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-019.md">Part 19 — Mutual TLS Authentication ➡️</a>
</div>
