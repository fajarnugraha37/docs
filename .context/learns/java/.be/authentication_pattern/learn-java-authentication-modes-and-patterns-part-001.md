# learn-java-authentication-modes-and-patterns-part-001

# Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context

> Seri: **Java Authentication Modes and Patterns**  
> Target: Java 8 sampai Java 25  
> Level: Advanced / architecture-grade / production-grade  
> Fokus Part 1: memahami fondasi authentication di Java runtime: `Subject`, `Principal`, credential, `LoginContext`, `LoginModule`, `CallbackHandler`, dan bagaimana model ini berhubungan dengan framework modern seperti Servlet, Jakarta Security, dan Spring Security.

---

## 1.0. Posisi Part Ini dalam Series

Pada Part 0, kita membangun mental model bahwa authentication adalah proses untuk mengikat suatu aksi ke suatu aktor melalui bukti yang dapat diverifikasi dalam batas kepercayaan tertentu.

Part 1 masuk lebih rendah: **bagaimana Java sendiri memodelkan aktor, identitas, credential, dan konteks keamanan**.

Ini penting karena banyak engineer langsung lompat ke:

```text
Spring Security
JWT filter
OAuth2 login
Keycloak adapter
Servlet session
```

Padahal di bawah semua itu ada konsep yang lebih fundamental:

```text
entity -> subject -> principals -> credentials -> authenticated context -> propagation
```

Framework boleh berubah, tetapi konsep ini tetap muncul dalam bentuk berbeda:

```text
JAAS Subject              -> javax.security.auth.Subject
Servlet Principal         -> java.security.Principal / request user principal
Jakarta Security caller   -> caller principal + groups
Spring Security principal -> Authentication#getPrincipal()
OIDC subject              -> sub claim
JWT identity              -> claims bound to issuer/audience/key
mTLS identity             -> certificate subject/SAN mapped to principal
Kerberos identity         -> KerberosPrincipal
```

Part ini tidak bertujuan menjadikan JAAS sebagai solusi utama semua aplikasi modern. Tujuannya adalah menjadikan JAAS dan Java security model sebagai **bahasa dasar** untuk memahami authentication secara lebih presisi.

---

## 1.1. Problem yang Diselesaikan

Masalah utama yang ingin diselesaikan Part 1:

```text
Bagaimana Java merepresentasikan “siapa aktor saat ini”, bukti apa yang terkait dengannya,
dan bagaimana identitas itu dibawa sepanjang eksekusi program?
```

Dalam aplikasi kecil, pertanyaan ini tampak sederhana:

```java
User user = userRepository.findByUsername(username);
```

Namun pada sistem nyata, pertanyaannya menjadi jauh lebih rumit:

```text
1. Apakah request ini dari human user, service account, batch job, scheduler, atau IdP?
2. Apakah identitas berasal dari password, session, JWT, SAML assertion, Kerberos ticket, certificate, atau API key?
3. Siapa principal utama yang akan dipakai untuk audit?
4. Apakah principal sama dengan username, employee ID, subject ID, email, atau tenant-local account ID?
5. Credential apa yang boleh disimpan di memory?
6. Credential apa yang tidak boleh pernah masuk log?
7. Bagaimana identitas berpindah dari HTTP request ke service layer, async task, message queue, atau database audit?
8. Apa yang terjadi saat thread digunakan ulang?
9. Apa yang terjadi saat virtual thread dipakai?
10. Apa yang terjadi saat context hilang di CompletableFuture/Reactor/Executor?
```

Part ini memberi fondasi untuk menjawab itu.

---

## 1.2. Sumber Konseptual Utama

Ada beberapa anchor resmi yang relevan:

1. **JAAS Reference Guide Java SE 25** menjelaskan bahwa JAAS digunakan untuk authentication agar aplikasi dapat menentukan siapa yang sedang menjalankan kode Java, dan JAAS mengimplementasikan model pluggable authentication module seperti PAM.
2. **`javax.security.auth.Subject` Java SE 25 API** menyatakan bahwa `Subject` merepresentasikan kumpulan informasi terkait satu entity, termasuk identity dan security-related attributes seperti password atau cryptographic keys.
3. **`LoginContext` Java SE 25 API** menjelaskan bahwa `LoginContext` memakai nama aplikasi untuk mencari konfigurasi `LoginModule`, lalu memakai `CallbackHandler` agar module dapat berinteraksi dengan user atau sumber credential.
4. **`LoginModule` Java SE 25 API** menjelaskan bahwa `LoginContext` bertanggung jawab membaca konfigurasi dan menginisialisasi `LoginModule` dengan `Subject`, `CallbackHandler`, shared state, dan options.
5. **Spring Security authentication architecture** menjelaskan bahwa `SecurityContextHolder` adalah tempat Spring Security menyimpan detail siapa yang sedang authenticated.

Referensi lengkap ada di bagian akhir file.

---

## 1.3. Mental Model Utama: Subject Bukan User Biasa

Kesalahan umum:

```text
Subject = User
Principal = Username
Credential = Password
```

Ini terlalu sempit.

Model yang lebih benar:

```text
Subject = entity yang sedang diwakili dalam konteks keamanan
Principal = nama/identity/aspect yang melekat pada Subject
Credential = bukti atau material keamanan yang berkaitan dengan Subject
```

Satu `Subject` bisa punya banyak `Principal`.

Contoh human user:

```text
Subject: orang yang berhasil login

Principals:
- username: fajar
- employeeId: E12345
- email: fajar@example.com
- tenant: agency-a
- role/group: CASE_OFFICER
- externalIdpSub: 94f1b1a8-...

Credentials:
- public credential: certificate public metadata, token metadata
- private credential: password-derived secret, private key, Kerberos ticket, access token
```

Contoh service account:

```text
Subject: service order-service

Principals:
- serviceName: order-service
- workloadId: prod/namespace/order-service
- clientId: order-service-api
- tenant: platform

Credentials:
- private key
- client secret
- mTLS key pair
- short-lived access token
```

Contoh batch job:

```text
Subject: nightly archival job

Principals:
- jobName: archival-close-case-job
- scheduler: quartz
- environment: prod
- runId: 2026-06-19T01:00Z

Credentials:
- job token
- database credential
- cloud role credential
```

Jadi, `Subject` bukan hanya “user dari tabel users”. Ia adalah **security representation of an actor**.

---

## 1.4. Entity, Subject, Principal, Credential: Bedanya Apa?

### 1.4.1. Entity

Entity adalah “sesuatu” di dunia sistem yang bisa melakukan aksi.

```text
Human user
Admin operator
External partner system
Internal microservice
Batch job
Message consumer
CLI client
Mobile app instance
Device
Robot/agent
```

Entity adalah konsep domain/security architecture, bukan selalu class Java.

### 1.4.2. Subject

`Subject` adalah representasi Java security untuk entity yang sedang berada dalam konteks authentication/authorization.

Pertanyaan yang dijawab oleh `Subject`:

```text
Informasi keamanan apa saja yang diketahui sistem tentang entity ini?
```

Ia mengelompokkan:

```text
identities -> principals
security attributes -> credentials
```

### 1.4.3. Principal

`Principal` adalah nama/identity/aspect dari Subject.

Interface `java.security.Principal` sederhana:

```java
public interface Principal {
    String getName();
}
```

Tetapi secara arsitektur, principal tidak harus selalu username. Ia bisa:

```text
user id
email
employee id
tenant id
service name
certificate subject
Kerberos name
OIDC subject
SAML NameID
role/group principal
organization principal
```

Masalah besar muncul ketika engineer menganggap `Principal#getName()` selalu aman dipakai sebagai primary key bisnis.

Contoh buruk:

```java
String username = request.getUserPrincipal().getName();
Order order = orderRepository.findByOwnerUsername(username);
```

Mengapa berbahaya?

```text
1. Username bisa berubah.
2. Email bisa berubah.
3. Username bisa tidak global-unique di multi-tenant system.
4. External IdP subject bisa berubah jika identity linking salah.
5. Display name tidak cocok untuk audit.
6. Principal name dari certificate bisa tidak cocok dengan account id aplikasi.
```

Model lebih baik:

```text
principal.getName() -> authentication display/security name
applicationUserId   -> immutable internal account id
externalSubjectId   -> issuer-scoped external identity
actorId             -> audit identity canonical
```

### 1.4.4. Credential

Credential adalah material yang digunakan untuk membuktikan atau melanjutkan trust.

Contoh credential:

```text
password
password hash input
OTP
private key
client secret
Kerberos ticket
JWT access token
refresh token
SAML assertion
session id
API key
mTLS certificate private key
signed challenge response
```

Dalam JAAS, credential secara teknis bisa berupa object apa pun. Namun secara engineering, credential harus diperlakukan sebagai **sensitive material**.

Aturan production-grade:

```text
1. Jangan log credential.
2. Jangan simpan credential lebih lama dari perlu.
3. Jangan gunakan String untuk secret jika bisa dihindari.
4. Bersihkan char[]/byte[] jika lifecycle memungkinkan.
5. Jangan expose private credential ke layer yang tidak perlu.
6. Jangan menyimpan token mentah dalam audit trail.
7. Simpan hash/fingerprint untuk korelasi, bukan secret mentah.
8. Pisahkan credential untuk authentication dari identity untuk audit.
```

---

## 1.5. JAAS sebagai Model Pluggable Authentication

JAAS adalah Java Authentication and Authorization Service.

Ia penting bukan karena semua aplikasi modern harus memakai JAAS langsung, tetapi karena ia memberikan model eksplisit:

```text
Application -> LoginContext -> Configuration -> LoginModule(s) -> Subject
```

Flow dasar:

```text
1. Aplikasi membuat LoginContext.
2. LoginContext membaca Configuration.
3. Configuration menentukan LoginModule apa saja yang dipakai.
4. Aplikasi memanggil login().
5. LoginContext memanggil LoginModule satu per satu.
6. LoginModule mengambil credential via CallbackHandler atau mekanisme lain.
7. LoginModule memverifikasi credential.
8. Jika berhasil, LoginModule menambahkan Principal/Credential ke Subject.
9. Aplikasi memakai Subject hasil authentication.
10. Saat selesai, logout() membersihkan state yang relevan.
```

Diagram:

```text
+-------------+
| Application |
+------+------+ 
       |
       | creates
       v
+-------------+       reads        +----------------+
| LoginContext+------------------->| Configuration  |
+------+------+                    +-------+--------+
       |                                   |
       | invokes login()                   | selects
       v                                   v
+-------------+                    +----------------+
| LoginModule |<-------------------| module entries |
+------+------+                    +----------------+
       |
       | authenticates
       v
+-------------+
|   Subject   |
+-------------+
```

Mental model penting:

```text
LoginContext = orchestration
LoginModule  = authentication mechanism implementation
Subject      = result container
Principal    = identity aspect
Credential   = proof/security material
```

---

## 1.6. LoginContext: Orchestrator, Bukan Authenticator Tunggal

`LoginContext` bukan tempat logika password, LDAP, Kerberos, atau certificate validation ditulis. Ia adalah orchestrator.

Tugas `LoginContext`:

```text
1. Menentukan konfigurasi login berdasarkan name.
2. Membuat atau menerima Subject.
3. Menginisialisasi LoginModule.
4. Menjalankan lifecycle LoginModule.
5. Menggabungkan hasil authentication.
6. Menentukan apakah keseluruhan login sukses/gagal.
```

Contoh konseptual:

```java
LoginContext loginContext = new LoginContext(
    "MyApplication",
    new UsernamePasswordCallbackHandler(username, password)
);

loginContext.login();
Subject subject = loginContext.getSubject();
```

Di sini `"MyApplication"` bukan label asal-asalan. Nama ini dipakai sebagai lookup key ke konfigurasi JAAS.

Contoh konfigurasi konseptual:

```text
MyApplication {
    com.example.security.DatabaseLoginModule required;
    com.example.security.AuditLoginModule optional;
};
```

Makna:

```text
DatabaseLoginModule harus berhasil.
AuditLoginModule boleh gagal tanpa menggagalkan login.
```

Namun production design harus sangat hati-hati dengan module flag seperti `required`, `requisite`, `sufficient`, `optional`, karena kombinasi yang salah bisa membuat bypass.

---

## 1.7. LoginModule: Boundary antara Credential dan Subject

`LoginModule` adalah implementasi authentication mechanism.

Tugasnya:

```text
1. Menerima Subject yang akan diisi.
2. Mengambil credential input.
3. Memverifikasi credential terhadap authority tertentu.
4. Membuat Principal yang benar.
5. Menambahkan Principal/Credential ke Subject saat commit.
6. Membersihkan temporary state saat abort/logout.
```

Lifecycle umum `LoginModule`:

```text
initialize()
login()
commit()
abort()
logout()
```

Makna lifecycle:

```text
initialize -> menerima Subject, CallbackHandler, shared state, options
login      -> melakukan authentication attempt
commit     -> menulis hasil sukses ke Subject
abort      -> membersihkan jika keseluruhan authentication gagal
logout     -> menghapus Principal/Credential yang ditambahkan
```

Diagram lifecycle:

```text
initialize
    |
    v
 login -------- failed --------+
    |                          |
 success                       v
    |                        abort
    v                          |
 commit <--- all modules ok ---+
    |
    v
 authenticated Subject
    |
    v
 logout
```

Kenapa ada `commit()` terpisah dari `login()`?

Karena JAAS bisa punya beberapa LoginModule. Satu module bisa berhasil secara lokal, tetapi keseluruhan login bisa gagal karena module lain gagal. Karena itu, module tidak seharusnya langsung memfinalisasi Subject terlalu awal.

Mental model:

```text
login()  = prove locally
commit() = publish identity to Subject after overall decision
abort()  = cleanup local success when global authentication fails
```

Ini adalah pola yang sangat berguna bahkan di luar JAAS.

Contoh analogi di sistem modern:

```text
1. Password provider berhasil.
2. MFA provider belum berhasil.
3. Risk engine menolak login.
4. Maka user belum boleh dianggap authenticated final.
```

Jika sistem terlalu cepat membuat session setelah password valid, MFA bisa menjadi kosmetik, bukan authentication boundary.

---

## 1.8. CallbackHandler: Credential Collection Dipisahkan dari Verification

`CallbackHandler` digunakan agar LoginModule bisa meminta credential tanpa mengetahui UI atau input channel.

Contoh channel:

```text
CLI prompt
Swing UI
Servlet request
REST request body
Kerberos ticket cache
environment-specific credential source
```

Kenapa pemisahan ini penting?

Karena authentication mechanism sebaiknya tidak bergantung pada cara credential dikumpulkan.

Model:

```text
Credential collection -> CallbackHandler
Credential verification -> LoginModule
Authentication orchestration -> LoginContext
Authenticated identity -> Subject
```

Dalam framework modern, pola ini muncul lagi:

```text
Spring AuthenticationFilter extracts credential
AuthenticationProvider verifies credential
SecurityContext stores Authentication
```

Atau:

```text
Servlet filter reads Authorization header
JWT decoder verifies token
Authentication object created
SecurityContext populated
```

Artinya, meskipun tidak memakai JAAS, pemisahan tanggung jawabnya tetap relevan.

---

## 1.9. Configuration: Security Behavior sebagai Policy, Bukan Hardcoded Flow

JAAS memakai `Configuration` untuk menentukan module apa saja yang aktif untuk application name tertentu.

Konsep ini mengajarkan prinsip penting:

```text
Authentication mechanism selection sebaiknya bukan tersebar acak di business code.
```

Buruk:

```java
if (type.equals("ldap")) {
    authenticateLdap();
} else if (type.equals("db")) {
    authenticateDb();
} else if (type.equals("saml")) {
    authenticateSaml();
}
```

Lebih baik:

```text
Policy/configuration menentukan mechanism.
Authentication pipeline menjalankan mechanism.
Business code hanya menerima authenticated actor.
```

Dalam Spring Security, prinsip yang sama muncul lewat:

```text
SecurityFilterChain
AuthenticationManager
AuthenticationProvider list
AuthenticationEntryPoint
OAuth2 client/resource server config
```

Dalam Jakarta Security:

```text
HttpAuthenticationMechanism
IdentityStore
container security config
```

Dalam custom platform:

```text
Auth mode registry
Credential extractor registry
Verifier registry
Principal mapper
Session/token issuer
```

---

## 1.10. Public Credential vs Private Credential

JAAS `Subject` memiliki set untuk:

```text
Principals
Public credentials
Private credentials
```

Secara konseptual:

```text
Public credential  -> boleh diketahui lebih luas, misalnya certificate public metadata
Private credential -> sensitive, misalnya password, private key, ticket, token
```

Namun jangan salah paham: “public credential” bukan berarti boleh sembarang dilog. Banyak metadata tetap sensitif secara privacy atau security.

Contoh private credential:

```text
password
refresh token
Kerberos ticket
private key
client secret
API key
raw session token
```

Contoh public-ish credential:

```text
X.509 certificate public part
OIDC ID token claims setelah diverifikasi
credential fingerprint
key id
certificate serial number
```

Production rule:

```text
Credential raw material should rarely escape the authentication boundary.
```

Layer service/domain biasanya tidak butuh credential. Ia butuh actor identity dan permission context.

Buruk:

```java
public void approveCase(String jwtToken, Long caseId) {
    Claims claims = parse(jwtToken);
    ...
}
```

Lebih baik:

```java
public void approveCase(AuthenticatedActor actor, CaseId caseId) {
    ...
}
```

Alasannya:

```text
1. Business logic tidak perlu tahu format credential.
2. Token parsing tidak tersebar.
3. Audit identity konsisten.
4. Token secret tidak bocor ke log business layer.
5. Testing lebih mudah.
6. Migration dari JWT ke opaque token tidak merusak domain layer.
```

---

## 1.11. Principal Design: Jangan Asal Pakai String

`Principal#getName()` hanya mengembalikan `String`. Tetapi sistem production membutuhkan identitas yang lebih kaya.

Masalah umum:

```text
String username = authentication.getName();
```

Lalu string ini dipakai untuk:

```text
owner id
created by
audit actor
tenant resolution
authorization check
row-level security
notification routing
```

Ini rawan.

### 1.11.1. Principal Name Harus Punya Semantik

Pertanyaan desain:

```text
Apakah name itu username?
Apakah name itu email?
Apakah name itu UUID internal?
Apakah name itu OIDC sub?
Apakah name itu SAML NameID?
Apakah name itu certificate subject DN?
Apakah name itu service client_id?
Apakah name itu tenant-scoped atau global?
```

Jika jawabannya tidak eksplisit, audit dan authorization akan kacau.

### 1.11.2. Canonical Actor ID

Untuk sistem enterprise, lebih aman membuat canonical actor model:

```text
ActorContext
- actorId: immutable internal id
- actorType: HUMAN | SERVICE | JOB | DEVICE | SYSTEM
- tenantId
- displayName
- externalIssuer
- externalSubject
- authenticationMethod
- assuranceLevel
- sessionId/tokenId
- requestCorrelationId
```

`Principal` tetap bisa ada, tetapi domain layer memakai `ActorContext` yang lebih jelas.

Contoh:

```java
public record ActorContext(
    String actorId,
    ActorType actorType,
    String tenantId,
    String displayName,
    String externalIssuer,
    String externalSubject,
    String authenticationMethod,
    String assuranceLevel,
    String sessionId,
    String correlationId
) {}
```

Dengan ini, kita tidak menyalahgunakan satu string untuk semua kebutuhan.

---

## 1.12. Subject Mutability dan Lifecycle

`Subject` berisi set principal dan credential. Setelah authentication selesai, pertanyaan penting:

```text
Apakah Subject boleh berubah?
```

Secara desain, identity context yang dipakai di request sebaiknya dianggap immutable setelah authentication final.

Mengapa?

```text
1. Menghindari privilege berubah di tengah request.
2. Menghindari race condition.
3. Memudahkan audit.
4. Memudahkan reasoning authorization.
5. Menghindari side effect antar komponen.
```

Contoh masalah:

```text
Filter A menambahkan principal USER.
Service B menambahkan principal ADMIN karena membaca role dari cache yang salah.
Audit C mencatat actor sebagai ADMIN.
Authorization D sudah telanjur allow.
```

Prinsip:

```text
Authentication phase builds identity.
Authorization phase consumes identity.
Business phase should not mutate identity.
```

Jika ada perubahan seperti step-up MFA, role refresh, impersonation, atau tenant switch, perlakukan sebagai **authentication transition baru**, bukan mutasi diam-diam.

---

## 1.13. Identity Context: Dari Subject ke “Current User”

Setelah authentication berhasil, aplikasi perlu membuat identitas itu tersedia untuk kode downstream.

Ada beberapa model:

```text
1. Explicit parameter passing
2. ThreadLocal context
3. Request attribute
4. Reactive context
5. Scoped value / structured context
6. Message metadata
7. Database session context
```

### 1.13.1. Explicit Parameter Passing

Contoh:

```java
caseService.approve(actorContext, caseId);
```

Kelebihan:

```text
1. Sangat jelas.
2. Mudah dites.
3. Tidak bergantung pada thread.
4. Cocok untuk async/reactive.
5. Tidak magic.
```

Kekurangan:

```text
1. Verbose.
2. Banyak method signature berubah.
3. Bisa dianggap mengotori domain API.
```

### 1.13.2. ThreadLocal Context

Contoh konseptual:

```java
CurrentActor.set(actorContext);
try {
    caseService.approve(caseId);
} finally {
    CurrentActor.clear();
}
```

Kelebihan:

```text
1. Praktis.
2. Banyak framework menggunakannya.
3. Cocok untuk servlet thread-per-request klasik.
```

Kekurangan besar:

```text
1. Bocor jika tidak dibersihkan.
2. Hilang saat pindah thread.
3. Berbahaya dengan thread pool.
4. Perlu strategi khusus untuk async.
5. Bisa membuat dependency tersembunyi.
```

### 1.13.3. Request Attribute

Contoh:

```java
request.setAttribute("actor", actorContext);
```

Kelebihan:

```text
1. Terikat pada HTTP request.
2. Tidak tergantung ThreadLocal secara langsung.
3. Mudah dipahami di servlet layer.
```

Kekurangan:

```text
1. Tidak otomatis tersedia di service layer non-web.
2. Tidak cocok untuk async/message/job.
3. Bisa coupling ke servlet API.
```

### 1.13.4. Reactive Context

Dalam reactive stack, ThreadLocal sering tidak memadai karena eksekusi bisa berpindah thread.

Model reactive:

```text
Context travels with reactive chain, not with OS thread.
```

Prinsipnya:

```text
Jangan mengandalkan ThreadLocal untuk identity di reactive pipeline kecuali framework menyediakan bridge yang benar.
```

### 1.13.5. Message Metadata

Untuk async messaging:

```text
HTTP request authenticated sebagai user A
service mengirim command ke queue
consumer menjalankan command beberapa detik/menit kemudian
```

Pertanyaan:

```text
Apakah consumer berjalan sebagai user A?
Sebagai service producer?
Sebagai system job?
Apakah user A masih valid?
Apakah authorization perlu dicek ulang?
```

Ini tidak bisa diselesaikan oleh ThreadLocal. Identity harus menjadi bagian dari message envelope atau command metadata.

---

## 1.14. ThreadLocal Identity: Berguna tetapi Berbahaya

Banyak framework memakai ThreadLocal untuk menyimpan current security context.

Spring Security misalnya memakai `SecurityContextHolder` sebagai tempat menyimpan detail siapa yang sedang authenticated. Secara default pada aplikasi servlet, model ini cocok karena satu request biasanya diproses oleh satu thread sampai selesai.

Namun ThreadLocal memiliki failure mode serius.

### 1.14.1. Failure Mode: Context Leak

Contoh buruk:

```java
CurrentActor.set(actorA);
caseService.approve(caseId);
// lupa clear
```

Jika thread pool menggunakan ulang thread yang sama:

```text
Request 1 -> actor A -> Thread-17 -> lupa clear
Request 2 -> anonymous/user B -> Thread-17 -> melihat actor A
```

Dampaknya fatal:

```text
1. Privilege leakage.
2. Audit salah.
3. Data breach.
4. Authorization bypass.
5. Incident sulit direkonstruksi.
```

Rule:

```text
Every set must have guaranteed clear in finally.
```

Contoh benar:

```java
CurrentActor.set(actor);
try {
    chain.doFilter(request, response);
} finally {
    CurrentActor.clear();
}
```

### 1.14.2. Failure Mode: Context Loss

Contoh:

```java
CurrentActor.set(actor);
CompletableFuture.runAsync(() -> {
    auditService.writeSomething(); // actor hilang
});
```

Task berjalan di thread lain. ThreadLocal tidak ikut otomatis.

Solusi bukan asal copy semua context. Perlu desain:

```text
1. Apakah task memang boleh mewarisi identity user?
2. Apakah task harus berjalan sebagai system actor?
3. Apakah authorization harus dicek sekarang atau nanti?
4. Apakah audit harus mencatat initiatedBy dan executedBy secara terpisah?
```

Pattern yang lebih aman:

```text
initiatedBy = human user
executedBy  = service/job actor
```

Contoh audit:

```text
action: SEND_NOTIFICATION
initiatedBy: user:123
executedBy: service:notification-worker
correlationId: abc-123
```

---

## 1.15. Virtual Threads dan Identity Context

Java 21 memperkenalkan virtual threads sebagai fitur final. Series ini mencakup Java 8–25, sehingga identity context harus dipikirkan untuk dua dunia:

```text
Java 8-17  -> platform threads dominan
Java 21-25 -> virtual threads semakin umum
```

Virtual thread tidak otomatis menyelesaikan masalah context.

Hal yang berubah:

```text
1. Virtual thread murah dibuat.
2. Thread-per-request bisa kembali masuk akal untuk banyak workload blocking.
3. ThreadLocal tetap ada, tetapi terlalu banyak ThreadLocal bisa berdampak pada memory/overhead.
4. Context propagation tetap harus eksplisit saat pindah boundary eksekusi.
```

Prinsip:

```text
Virtual thread makes blocking concurrency cheaper, not security context design automatically correct.
```

Untuk authentication, tetap tanyakan:

```text
1. Di mana context dibuat?
2. Di mana context dibersihkan?
3. Apakah context melewati async boundary?
4. Apakah context immutable?
5. Apakah context bisa bocor ke task lain?
```

---

## 1.16. Subject Propagation: Jangan Samakan dengan Token Relay

Subject propagation berarti membawa identity context dari satu bagian program ke bagian lain.

Token relay berarti meneruskan token credential ke downstream system.

Ini berbeda.

```text
Subject propagation:
service A tahu actor adalah user:123

Token relay:
service A meneruskan access token user ke service B
```

Token relay sering dipakai, tetapi tidak selalu benar.

Risiko token relay:

```text
1. Downstream mendapat token dengan audience yang salah.
2. Token bocor ke service yang tidak perlu.
3. Service B bisa menggunakan token untuk call service C tanpa kontrol.
4. Audit menjadi kabur.
5. Revocation dan scope sulit dikendalikan.
```

Alternatif:

```text
1. Token exchange.
2. Downstream-specific token.
3. Service token + actor context metadata.
4. Signed internal assertion.
5. Explicit command identity envelope.
```

Rule:

```text
Propagate identity; do not blindly propagate credentials.
```

---

## 1.17. Authentication Context vs Authorization Context

Authentication context menjawab:

```text
Siapa aktor ini dan bagaimana ia dibuktikan?
```

Authorization context menjawab:

```text
Apa yang boleh dilakukan aktor ini dalam konteks resource tertentu?
```

Jangan mencampur keduanya terlalu dini.

Buruk:

```text
Authenticated principal = "admin"
```

Lebih baik:

```text
actorId = user:123
authenticationMethod = password+mfa
assuranceLevel = high
groups = [case-manager]
permissions evaluated separately against resource
```

Mengapa?

Karena role/permission bisa berubah tergantung:

```text
tenant
case status
ownership
assignment
time
risk level
MFA freshness
data classification
```

Authentication menghasilkan identity; authorization mengevaluasi policy.

---

## 1.18. Framework Mapping: JAAS, Servlet, Jakarta, Spring

### 1.18.1. JAAS

```text
Subject
  -> set of Principal
  -> public credentials
  -> private credentials
```

### 1.18.2. Servlet

Servlet world menyediakan:

```java
Principal principal = request.getUserPrincipal();
boolean inRole = request.isUserInRole("ADMIN");
```

Di sini principal biasanya sudah dibuat oleh container/framework authentication.

### 1.18.3. Jakarta Security

Jakarta Security memperkenalkan abstraction seperti:

```text
HttpAuthenticationMechanism
IdentityStore
CallerPrincipal
groups
```

Pola konseptual:

```text
HTTP credential -> authentication mechanism -> identity store -> caller principal/groups -> container context
```

### 1.18.4. Spring Security

Spring Security memakai:

```text
SecurityContextHolder
SecurityContext
Authentication
GrantedAuthority
AuthenticationManager
AuthenticationProvider
```

Mapping konseptual:

```text
JAAS Subject        ~ Spring Authentication principal + authorities + details
JAAS Principal      ~ principal / username / custom principal object
JAAS Credential     ~ credentials field, token, password, secret
JAAS LoginModule    ~ AuthenticationProvider
JAAS LoginContext   ~ AuthenticationManager orchestration
JAAS Configuration  ~ SecurityFilterChain/provider configuration
```

Mapping ini tidak 1:1 secara API, tetapi sangat berguna secara mental model.

---

## 1.19. Authentication Result Object: Desain yang Baik

Jika Anda membangun authentication subsystem sendiri, jangan hanya mengembalikan boolean.

Buruk:

```java
boolean authenticate(String username, String password);
```

Kenapa buruk?

```text
1. Tidak ada actor identity.
2. Tidak ada authentication method.
3. Tidak ada failure reason yang aman.
4. Tidak ada assurance level.
5. Tidak ada metadata audit.
6. Tidak bisa membedakan password expired, MFA required, locked, disabled.
```

Lebih baik:

```java
sealed interface AuthenticationResult {
    record Success(AuthenticatedActor actor) implements AuthenticationResult {}
    record MfaRequired(PartialActor actor, String challengeId) implements AuthenticationResult {}
    record PasswordChangeRequired(PartialActor actor) implements AuthenticationResult {}
    record Failure(AuthenticationFailureCode code) implements AuthenticationResult {}
}
```

Contoh failure code internal:

```text
INVALID_CREDENTIAL
ACCOUNT_LOCKED
ACCOUNT_DISABLED
PASSWORD_EXPIRED
MFA_REQUIRED
MFA_FAILED
TENANT_DISABLED
IDP_UNAVAILABLE
RISK_DENIED
RATE_LIMITED
```

Tetapi response ke user harus hati-hati:

```text
Internal reason: ACCOUNT_DISABLED
External message: Unable to sign in with the provided credentials.
```

Tujuannya mencegah user enumeration.

---

## 1.20. Partial Authentication

Tidak semua authentication langsung sukses/gagal.

Contoh:

```text
1. Password benar, MFA belum selesai.
2. OIDC login sukses, local account belum linked.
3. SAML assertion valid, tenant belum resolved.
4. Certificate valid, principal mapping ambiguous.
5. Risk engine meminta step-up.
6. Password benar, password expired.
```

Mental model:

```text
Unauthenticated
    -> partially authenticated
    -> fully authenticated
    -> session established
```

State machine:

```text
[ANONYMOUS]
    |
    | password ok
    v
[PASSWORD_VERIFIED]
    |
    | MFA required
    v
[MFA_CHALLENGE_PENDING]
    |
    | MFA ok
    v
[AUTHENTICATED]
    |
    | session issued
    v
[SESSION_ACTIVE]
```

Kesalahan serius:

```text
Membuat full session saat baru password verified, lalu menandai page tertentu butuh MFA.
```

Pattern lebih aman:

```text
Partial session punya capability sangat terbatas.
Full session baru dibuat setelah semua authentication requirement terpenuhi.
```

---

## 1.21. Authentication Boundary

Authentication boundary adalah titik di mana sistem memutuskan:

```text
Mulai titik ini, request/aksi dianggap berasal dari actor tertentu.
```

Contoh boundary:

```text
1. Servlet filter setelah token verified.
2. Gateway setelah mTLS certificate verified.
3. Message consumer setelah message signature verified.
4. Batch job launcher setelah workload identity verified.
5. CLI command setelah device code flow selesai.
```

Setelah boundary, downstream code sebaiknya tidak lagi parsing raw credential.

Buruk:

```text
Controller parse JWT
Service parse JWT lagi
Repository parse tenant claim dari JWT
Audit parse username dari JWT lagi
```

Baik:

```text
Auth boundary parse/verify credential sekali
ActorContext dibuat
Downstream memakai ActorContext
```

Benefits:

```text
1. Verification konsisten.
2. Logging lebih aman.
3. Token format bisa diganti.
4. Audit lebih stabil.
5. Testing lebih sederhana.
```

---

## 1.22. Trust Boundary: Siapa yang Dipercaya?

Authentication selalu berdiri di atas trust.

Pertanyaan:

```text
1. Apakah aplikasi memverifikasi password sendiri?
2. Apakah aplikasi percaya IdP external?
3. Apakah aplikasi percaya API gateway?
4. Apakah service percaya service mesh?
5. Apakah worker percaya message broker?
6. Apakah resource server percaya authorization server?
```

Jika trust boundary tidak eksplisit, vulnerability muncul.

Contoh berbahaya:

```text
Gateway memvalidasi JWT dan mengirim header X-User-Id ke backend.
Backend percaya X-User-Id.
Tapi backend juga bisa diakses langsung dari internal network.
Attacker mengirim X-User-Id palsu.
```

Mitigasi:

```text
1. Backend hanya menerima traffic dari gateway/mesh yang authenticated.
2. Header identity internal ditandatangani atau dibersihkan di edge.
3. Backend tetap memverifikasi token jika boundary tidak kuat.
4. Network policy mencegah direct access.
5. Audit mencatat trusted authentication source.
```

Rule:

```text
Never trust identity headers unless the path that created them is authenticated, authorized, and exclusive.
```

---

## 1.23. Identity Normalization

Sistem modern sering menerima identity dari banyak sumber:

```text
local database
LDAP
SAML IdP
OIDC IdP
mTLS certificate
API key registry
Kerberos
service mesh identity
```

Masing-masing punya format berbeda.

Tujuan normalization:

```text
Mengubah external identity menjadi internal actor model yang stabil.
```

Contoh:

```text
OIDC:
issuer = https://idp.example.com/realms/agency-a
subject = 24828942-....
email = user@example.com

Internal:
actorId = usr_100812
tenantId = agency-a
actorType = HUMAN
```

Jangan gunakan external email sebagai primary key canonical jika bisa berubah.

Gunakan pair:

```text
externalIssuer + externalSubject
```

atau internal immutable mapping.

---

## 1.24. Credential Verification vs Principal Mapping

Dua tahap ini sering dicampur.

```text
Credential verification:
Apakah bukti ini valid?

Principal mapping:
Bukti valid ini merepresentasikan account/actor mana di sistem kita?
```

Contoh OIDC:

```text
1. Verify ID token signature.
2. Verify issuer.
3. Verify audience.
4. Verify expiry/nonce.
5. Extract subject.
6. Find local account linked to issuer+subject.
7. Build actor context.
```

Token valid tidak otomatis berarti user boleh masuk aplikasi.

Mungkin:

```text
1. Tenant belum onboarded.
2. Account disabled.
3. User tidak punya role aplikasi.
4. External identity belum linked.
5. Email belum verified.
6. Assurance level terlalu rendah.
```

Rule:

```text
Valid credential is not the same as accepted actor.
```

---

## 1.25. Authentication Assurance

Tidak semua login memiliki kekuatan yang sama.

Contoh:

```text
Password only
Password + TOTP
Password + phishing-resistant WebAuthn
mTLS client certificate
Kerberos inside managed domain
OIDC login with acr=high
API key from unknown storage
```

Semua bisa menghasilkan authenticated actor, tetapi assurance-nya berbeda.

ActorContext sebaiknya menyimpan:

```text
authenticationMethod
assuranceLevel
authTime
mfaPresent
phishingResistant
credentialAge
sessionAge
```

Mengapa?

Karena operation tertentu butuh step-up.

Contoh:

```text
View dashboard              -> password session cukup
Approve high-value case     -> MFA fresh required
Change bank account         -> phishing-resistant factor required
Export sensitive data       -> high assurance + recent auth
Admin impersonation         -> privileged auth + reason + approval
```

---

## 1.26. Authentication Time vs Request Time

Authentication terjadi pada waktu tertentu. Request terjadi berkali-kali setelah itu.

Penting membedakan:

```text
auth_time    -> kapan user membuktikan identity
session_time -> kapan session dibuat
request_time -> kapan request saat ini diproses
token_iat    -> kapan token diterbitkan
token_exp    -> kapan token kedaluwarsa
```

Failure mode:

```text
User login 8 jam lalu.
Session masih valid.
User mencoba operasi sensitif.
Sistem hanya cek authenticated=true.
```

Lebih baik:

```text
Require recent authentication for sensitive action.
```

Contoh policy:

```text
If action = APPROVE_LEGAL_DECISION
then auth_time must be within last 10 minutes
and MFA must be present
```

---

## 1.27. Logout dan Subject Cleanup

Dalam JAAS ada `logout()` untuk menghapus Principal/Credential dari Subject.

Dalam web modern, logout lebih rumit:

```text
1. Hapus local session.
2. Hapus remember-me cookie.
3. Revoke refresh token.
4. Clear security context.
5. Clear CSRF/session state.
6. Redirect ke IdP logout jika federated.
7. Handle back-channel logout.
8. Handle concurrent sessions.
```

Tetapi prinsip dasarnya sama:

```text
Authenticated context must have explicit cleanup lifecycle.
```

Untuk ThreadLocal:

```text
clear context every request.
```

Untuk session:

```text
invalidate session on logout and rotate session on login.
```

Untuk token:

```text
short expiry, revoke refresh token, optionally denylist token id for high-risk cases.
```

---

## 1.28. Designing a Runtime Authentication Model for Your Application

Jika membangun sistem Java enterprise, buat layer konseptual seperti ini:

```text
CredentialExtractor
    -> membaca credential dari request/message/job context

CredentialVerifier
    -> memverifikasi credential terhadap authority

PrincipalMapper
    -> memetakan verified identity ke internal actor

AuthenticationPolicy
    -> menentukan apakah actor diterima dan assurance cukup

AuthenticationResult
    -> success/partial/failure

ActorContext
    -> immutable identity context untuk downstream

ContextCarrier
    -> cara membawa actor context selama eksekusi
```

Diagram:

```text
+-------------------+
| Incoming Boundary |
+---------+---------+
          |
          v
+-------------------+
| CredentialExtract |
+---------+---------+
          |
          v
+-------------------+
| CredentialVerify  |
+---------+---------+
          |
          v
+-------------------+
| PrincipalMapping  |
+---------+---------+
          |
          v
+-------------------+
| Auth Policy Check |
+---------+---------+
          |
          v
+-------------------+
| ActorContext      |
+---------+---------+
          |
          v
+-------------------+
| Downstream Code   |
+-------------------+
```

---

## 1.29. Anti-Patterns

### Anti-Pattern 1: Boolean Authentication

```java
if (authService.login(username, password)) {
    // ok
}
```

Masalah:

```text
Tidak ada identity object, tidak ada state, tidak ada audit metadata, tidak ada partial auth.
```

### Anti-Pattern 2: Principal Name sebagai Primary Key Global

```java
String userId = principal.getName();
```

Masalah:

```text
Tidak jelas apakah username/email/external subject/tenant-scoped id.
```

### Anti-Pattern 3: Raw Token Masuk Business Layer

```java
service.approve(jwt, caseId);
```

Masalah:

```text
Credential menyebar, verifikasi berulang, audit tidak stabil.
```

### Anti-Pattern 4: ThreadLocal Tanpa Cleanup

```java
CurrentUser.set(user);
chain.doFilter(req, res);
```

Masalah:

```text
Context leak antar request.
```

### Anti-Pattern 5: Trust Header Tanpa Boundary

```java
String user = request.getHeader("X-User-Id");
```

Masalah:

```text
Header bisa dipalsukan jika backend bisa diakses tanpa gateway yang trusted.
```

### Anti-Pattern 6: Token Valid Dianggap Account Valid

Masalah:

```text
External token valid bukan berarti local account aktif, tenant aktif, role ada, atau assurance cukup.
```

### Anti-Pattern 7: MFA sebagai Flag UI

Masalah:

```text
Password login sudah membuat full session, MFA hanya mengunci beberapa page di frontend.
```

MFA harus menjadi bagian dari authentication state machine.

---

## 1.30. Production Checklist

Gunakan checklist ini untuk menilai authentication runtime model.

### Identity Model

```text
[ ] Ada canonical actor id internal.
[ ] Actor type eksplisit: human/service/job/device/system.
[ ] Tenant id eksplisit jika multi-tenant.
[ ] External issuer dan subject disimpan jika federated.
[ ] Display name tidak dipakai sebagai key.
[ ] Email tidak dipakai sebagai immutable identity kecuali memang dijamin.
```

### Principal Model

```text
[ ] Principal name punya semantik jelas.
[ ] Principal tidak dicampur dengan permission domain secara sembarangan.
[ ] Mapping external principal ke internal actor terdokumentasi.
[ ] Multiple principals ditangani secara eksplisit.
```

### Credential Handling

```text
[ ] Raw credential tidak masuk business layer.
[ ] Credential tidak masuk log.
[ ] Token mentah tidak masuk audit trail.
[ ] Secret lifecycle pendek.
[ ] Private credential tidak diekspos ke komponen yang tidak perlu.
[ ] Credential fingerprint/hash dipakai untuk korelasi jika perlu.
```

### Authentication Boundary

```text
[ ] Credential diekstrak di boundary yang jelas.
[ ] Credential diverifikasi sekali secara konsisten.
[ ] ActorContext dibuat setelah verification dan mapping.
[ ] Downstream menerima actor context, bukan raw credential.
[ ] Partial auth tidak dianggap full auth.
```

### Context Propagation

```text
[ ] Context immutable setelah authentication final.
[ ] ThreadLocal dibersihkan dengan finally.
[ ] Async boundary punya strategi eksplisit.
[ ] Message/job identity tidak bergantung pada ThreadLocal.
[ ] initiatedBy dan executedBy dibedakan untuk async/job.
```

### Trust Boundary

```text
[ ] Identity header hanya dipercaya dari path yang authenticated dan exclusive.
[ ] Backend tidak bisa diakses langsung jika bergantung pada gateway identity.
[ ] Token audience/issuer diverifikasi.
[ ] Principal mapping tidak hanya berdasarkan claim lemah.
```

### Audit

```text
[ ] Audit mencatat actorId canonical.
[ ] Audit mencatat authentication method/assurance jika relevan.
[ ] Audit mencatat session/token id fingerprint, bukan raw token.
[ ] Audit bisa membedakan human actor dan service executor.
[ ] Correlation id tersedia.
```

---

## 1.31. Mini Case Study: Login Web App dengan OIDC dan Spring

Misalnya aplikasi Java 21 Spring Boot memakai OIDC.

Naive model:

```text
OIDC login sukses -> Spring Authentication ada -> user authenticated
```

Top 1% model:

```text
1. Browser diarahkan ke IdP.
2. IdP melakukan authentication terhadap human user.
3. Aplikasi menerima authorization code.
4. Backend menukar code dengan token.
5. Backend memverifikasi ID token.
6. Backend memvalidasi issuer, audience, nonce, expiry.
7. Backend membaca subject eksternal.
8. Backend mencari mapping issuer+subject ke internal actor.
9. Backend mengecek tenant/account status.
10. Backend mengecek assurance requirement.
11. Backend membuat ActorContext immutable.
12. Backend membuat local session atau security context.
13. Business code hanya melihat ActorContext.
14. Audit mencatat actorId, external subject, auth method, session id fingerprint.
```

Yang perlu diperhatikan:

```text
Token valid bukan akhir proses.
Token valid hanya input ke principal mapping dan policy acceptance.
```

---

## 1.32. Mini Case Study: Service-to-Service mTLS

Naive model:

```text
mTLS sukses -> service trusted
```

Top 1% model:

```text
1. TLS handshake memverifikasi certificate chain.
2. Server memvalidasi client certificate dari trust anchor yang benar.
3. Certificate SAN dipetakan ke workload identity.
4. Workload identity dipetakan ke service actor internal.
5. Audience/route policy dicek.
6. ActorContext dibuat sebagai SERVICE actor.
7. Downstream audit mencatat service actor.
8. Jika request membawa end-user context, initiatedBy dan executedBy dipisahkan.
```

Contoh:

```text
initiatedBy = user:123
executedBy = service:case-service
```

Ini penting agar audit tidak menyatakan “case-service melakukan segalanya” tanpa jejak user, atau sebaliknya “user melakukan aksi teknis internal” tanpa service executor.

---

## 1.33. Mini Case Study: Batch Job

Naive model:

```text
Batch job tidak perlu authentication karena internal.
```

Top 1% model:

```text
1. Scheduler punya identity.
2. Job definition punya identity.
3. Job run punya run id.
4. Job mendapat credential terbatas.
5. Job membuat ActorContext type JOB/SYSTEM.
6. Semua perubahan data oleh job mencatat executedBy job actor.
7. Jika job dibuat dari permintaan user, audit mencatat initiatedBy user.
```

Audit contoh:

```text
action: AUTO_CLOSE_EXPIRED_CASE
initiatedBy: system:retention-policy
executedBy: job:case-expiry-close-job
runId: jobrun_20260619_010000
```

---

## 1.34. Design Questions untuk Engineer Senior

Gunakan pertanyaan ini saat review architecture authentication.

```text
1. Apa actor types yang didukung sistem?
2. Apa canonical actor id?
3. Apa beda principal eksternal dan actor internal?
4. Credential apa saja yang diterima sistem?
5. Di boundary mana credential diverifikasi?
6. Siapa authority untuk credential tersebut?
7. Apakah token valid otomatis berarti account boleh login?
8. Bagaimana partial authentication dimodelkan?
9. Bagaimana authentication context dibawa ke service layer?
10. Bagaimana context dibersihkan?
11. Apa yang terjadi saat request pindah thread?
12. Apa yang terjadi saat task menjadi async?
13. Apa yang terjadi saat message diproses 10 menit kemudian?
14. Apakah raw credential masuk log/audit?
15. Bagaimana principal dipetakan dalam multi-tenant system?
16. Apakah email/username mutable?
17. Bagaimana service account dibedakan dari human user?
18. Bagaimana mTLS identity dipetakan?
19. Bagaimana logout membersihkan local dan federated state?
20. Bagaimana audit membuktikan siapa yang melakukan aksi?
```

Jika sistem tidak bisa menjawab pertanyaan ini, authentication-nya belum matang.

---

## 1.35. Java 8 sampai Java 25: Relevansi Praktis

### Java 8

Realitas Java 8:

```text
1. Banyak enterprise legacy masih berjalan di Java 8.
2. JAAS, Principal, Subject sudah tersedia.
3. Servlet container dan Spring Security banyak memakai ThreadLocal/request context.
4. Tidak ada virtual thread.
5. Async context propagation sering manual.
```

Fokus:

```text
Be disciplined with ThreadLocal cleanup, session handling, and credential boundaries.
```

### Java 11/17

Realitas:

```text
1. Modular JDK sudah mapan.
2. Banyak organisasi modernisasi dari Java 8 ke 11/17.
3. Spring Boot 2/3 transition sering terjadi.
4. SecurityManager semakin tidak menjadi pusat desain modern.
```

Fokus:

```text
Pisahkan runtime identity model dari framework agar migrasi lebih aman.
```

### Java 21

Realitas:

```text
1. Virtual threads final.
2. Banyak aplikasi blocking dapat scale dengan model thread-per-request modern.
3. Context propagation perlu ditinjau ulang.
```

Fokus:

```text
Jangan berasumsi ThreadLocal selalu gratis dan selalu benar.
```

### Java 25

Realitas:

```text
1. Java SE 25 tetap mempertahankan JAAS API sebagai bagian dari java.base.
2. Dokumentasi JAAS masih relevan untuk memahami Subject/Principal/Credential/LoginContext/LoginModule.
3. Fitur kriptografi dan key handling modern semakin relevan untuk authentication systems.
```

Fokus:

```text
Gunakan konsep lama yang masih valid, tetapi desain implementasi sesuai architecture modern.
```

---

## 1.36. Ringkasan Mental Model

Part ini bisa diringkas menjadi beberapa invariant.

### Invariant 1

```text
Subject is not just user; Subject is security representation of an entity.
```

### Invariant 2

```text
Principal is not always username; it is an identity aspect with explicit semantics.
```

### Invariant 3

```text
Credential is proof material; do not let it leak outside authentication boundary.
```

### Invariant 4

```text
Credential verification and principal mapping are different stages.
```

### Invariant 5

```text
Valid credential does not automatically mean accepted actor.
```

### Invariant 6

```text
Authentication context must have lifecycle: create, propagate, consume, clear.
```

### Invariant 7

```text
ThreadLocal is a carrier, not a security model.
```

### Invariant 8

```text
Propagate identity intentionally; do not blindly propagate credentials.
```

### Invariant 9

```text
Partial authentication must not become full session accidentally.
```

### Invariant 10

```text
Audit needs canonical actor identity, not arbitrary principal string.
```

---

## 1.37. Apa yang Harus Dikuasai Setelah Part Ini

Setelah Part 1, Anda seharusnya bisa:

```text
1. Menjelaskan perbedaan Subject, Principal, Credential, dan ActorContext.
2. Membaca JAAS bukan sebagai teknologi tua, tetapi sebagai model authentication runtime.
3. Memahami LoginContext sebagai orchestrator.
4. Memahami LoginModule sebagai mechanism boundary.
5. Mendesain authentication result yang lebih kaya dari boolean.
6. Membedakan credential verification dari principal mapping.
7. Menjelaskan risiko ThreadLocal identity.
8. Mendesain context propagation untuk request, async, job, dan message.
9. Menghindari principal string sebagai primary key sembarangan.
10. Menentukan authentication boundary dan trust boundary dengan eksplisit.
```

---

## 1.38. Latihan Desain

Jawab pertanyaan berikut untuk sistem Anda sendiri.

### Latihan 1 — Actor Model

```text
Daftarkan semua actor yang bisa melakukan aksi di sistem:
- human user
- admin
- service
- scheduler
- batch job
- external partner
- anonymous user
- support operator
```

Untuk masing-masing, tentukan:

```text
actorType
canonical actorId
credential type
authentication authority
session/token model
audit representation
```

### Latihan 2 — Principal Semantics

Ambil semua tempat di codebase yang memakai:

```text
getUserPrincipal().getName()
Authentication#getName()
JWT sub
email claim
username
createdBy
updatedBy
```

Lalu klasifikasikan:

```text
Apakah ini display name?
Apakah ini login name?
Apakah ini immutable id?
Apakah ini tenant scoped?
Apakah ini external subject?
Apakah ini aman untuk audit?
```

### Latihan 3 — Context Propagation

Pilih satu request flow yang punya async/task/message.

Gambarkan:

```text
HTTP request actor
service actor
message producer
message consumer
job executor
database audit row
```

Tentukan:

```text
Siapa initiatedBy?
Siapa executedBy?
Credential apa yang dibawa?
Identity apa yang dibawa?
Authorization dicek kapan?
```

### Latihan 4 — Authentication Boundary

Untuk setiap endpoint/system entrypoint, jawab:

```text
Credential diterima dari mana?
Siapa yang memverifikasi?
Apa authority-nya?
Apa yang menjadi ActorContext?
Apakah raw credential masih dibawa setelah boundary?
```

---

## 1.39. Kesalahan Konseptual yang Harus Dihilangkan

Hapus kebiasaan berpikir berikut:

```text
Authentication = login page.
Principal = username.
JWT valid = user valid.
ThreadLocal = aman otomatis.
Internal network = trusted.
MFA = halaman tambahan setelah login.
Logout = hapus cookie saja.
Service call = tidak perlu identity.
Batch job = tidak perlu actor.
Audit createdBy = string bebas.
```

Ganti dengan:

```text
Authentication = verified binding between actor, proof, context, and trust boundary.
Principal = explicit identity aspect.
Token validity = one stage before actor acceptance.
Context carrier must have lifecycle.
Every execution has an actor.
Audit requires canonical identity.
```

---

## 1.40. Penutup

Part 1 memberi fondasi runtime untuk seluruh series.

Mulai Part 2, kita akan mengklasifikasikan authentication modes berdasarkan **jenis bukti dan trust model**, bukan berdasarkan nama framework. Ini penting agar kita dapat membandingkan password, session, API key, JWT, mTLS, SAML, OIDC, Kerberos, passkey, dan workload identity secara jernih.

Jika Part 0 menjawab:

```text
Apa itu authentication secara sistemik?
```

Maka Part 1 menjawab:

```text
Bagaimana Java memodelkan identity dan security context di runtime?
```

Part berikutnya:

```text
Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models
```

---

## Referensi Resmi

1. Oracle Java SE 25, **Java Authentication and Authorization Service (JAAS) Reference Guide**  
   https://docs.oracle.com/en/java/javase/25/security/java-authentication-authorization-service-jaas-reference-guide.html

2. Oracle Java SE 25 API, **`javax.security.auth.Subject`**  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/javax/security/auth/Subject.html

3. Oracle Java SE 25 API, **`javax.security.auth.login.LoginContext`**  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/javax/security/auth/login/LoginContext.html

4. Oracle Java SE 25 API, **`javax.security.auth.spi.LoginModule`**  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/javax/security/auth/spi/LoginModule.html

5. Oracle Java SE 25 API, **`javax.security.auth` package summary**  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/javax/security/auth/package-summary.html

6. Spring Security Reference, **Servlet Authentication Architecture**  
   https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html

7. Spring Security Reference, **JAAS Authentication**  
   https://docs.spring.io/spring-security/reference/servlet/authentication/jaas.html

---

## Status Series

```text
Part 0  selesai — Orientation: Mental Model of Authentication in Java Systems
Part 1  selesai — Java Runtime Security Foundations: Subject, Principal, Credential, Context
Part 2  berikutnya — Authentication Taxonomy: Modes, Proof Types, and Trust Models

Series belum selesai.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-000.md">⬅️ Part 0 — Orientation: Mental Model of Authentication in Java Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-002.md">Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models ➡️</a>
</div>
