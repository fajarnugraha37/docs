# learn-java-camunda-7-bpm-platform-engineering-part-020.md

# Part 020 — Authorization, Identity, Security Hardening, dan Webapp/API Exposure

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Fokus: Camunda BPM Platform / Camunda 7 (`<= 7.x`) untuk Java 8–25  
> Level: Advanced / Principal Engineer  
> Prasyarat: part-000 sampai part-019, terutama human task, history/audit, multi-tenancy, transaction boundary, dan runtime state.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas keamanan Camunda 7 dari sudut pandang engineering platform, bukan sekadar “bagaimana login ke Tasklist”.

Setelah bagian ini, kamu harus bisa menjawab pertanyaan seperti:

1. Kapan Camunda authorization perlu diaktifkan?
2. Apa bedanya authentication, Camunda authorization, tenant check, business authorization, dan domain policy?
3. Kenapa raw Camunda REST API jarang layak diekspos langsung ke frontend/user?
4. Bagaimana mendesain akses task yang aman untuk regulatory case management?
5. Bagaimana cara mengintegrasikan identity eksternal seperti LDAP, SSO, OAuth2/OIDC, atau corporate IAM tanpa membuat Camunda menjadi source of truth utama?
6. Apa risiko security dari Admin, Cockpit, Tasklist, REST API, expression, script, Java serialization, variables, attachments, dan historic data?
7. Apa checklist hardening production untuk Camunda 7?

Core mental model bagian ini:

> Camunda security bukan satu fitur tunggal. Ia adalah kombinasi dari perimeter security, authentication, identity mapping, authorization, tenant isolation, business policy, API design, operational access, audit, dan data-retention discipline.

---

## 1. Referensi Utama

Materi ini disusun dengan rujukan utama dari dokumentasi resmi Camunda 7.24:

- Camunda 7 Authorization Service: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/authorization-service/`
- Camunda 7 Identity Service: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/identity-service/`
- Camunda 7 REST API Authentication: `https://docs.camunda.org/manual/7.24/reference/rest/overview/authentication/`
- Camunda 7 Security Instructions: `https://docs.camunda.org/manual/7.24/user-guide/security/`
- Camunda 7 Password Hashing: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/password-hashing/`
- Camunda Webapps CSRF Prevention: `https://docs.camunda.org/manual/7.24/webapps/shared-options/csrf-prevention/`
- Camunda 7 Multi-Tenancy: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/multi-tenancy/`
- Camunda 7 Process Variables: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/variables/`
- Camunda 7 Custom Code & Security: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/scripting/`

Catatan: dokumentasi Camunda menyatakan bahwa authorization memiliki biaya performa dan kompleksitas, dan sebaiknya digunakan jika diperlukan. Dokumentasi juga menjelaskan bahwa REST API authentication pada pre-built distribution mati secara default dan perlu diaktifkan untuk production.

---

## 2. Mental Model: Security Boundary Camunda 7

Camunda 7 bisa digunakan dalam beberapa mode:

1. Embedded engine di aplikasi Java.
2. Shared engine di application server.
3. REST API sebagai remote interface.
4. Web applications: Cockpit, Tasklist, Admin.
5. External task worker fleet.
6. Custom UI yang memakai backend application layer.
7. Platform multi-tenant atau multi-agency.

Setiap mode punya boundary security berbeda.

```text
[Human User]
    |
    | browser / API client
    v
[Custom Case Management UI]
    |
    | application API: domain-aware, policy-aware
    v
[Application Backend]
    |
    | controlled Engine API calls
    v
[Embedded Camunda Engine]
    |
    | JDBC
    v
[Camunda Database]
```

Dalam topology di atas, user tidak langsung mengirim query bebas ke Camunda. Aplikasi mengontrol API engine yang dipanggil. Karena itu, authorization utama bisa ditegakkan di application/domain layer.

Bandingkan dengan ini:

```text
[Browser / User]
    |
    | direct REST calls
    v
[Camunda REST API]
    |
    v
[Process Engine]
    |
    v
[Camunda Database]
```

Di topology ini, user bisa mengonstruksi query dan command engine secara langsung. Misalnya query task semua user, start process definition tertentu, complete task yang bukan miliknya, correlate message, atau membaca historic variables. Dalam model ini, Camunda authorization menjadi jauh lebih penting.

Prinsip utama:

> Jika untrusted user dapat langsung membentuk query/command ke Process Engine API, kamu perlu authentication dan authorization di boundary Camunda. Jika semua akses ke engine dikontrol oleh aplikasi tepercaya, business authorization bisa ditegakkan di aplikasi, dan Camunda authorization bisa menjadi defense-in-depth atau tidak diaktifkan tergantung kebutuhan.

---

## 3. Layer Security: Jangan Campur Semua Menjadi “Role”

Security di Camunda 7 perlu dipisah menjadi beberapa layer.

| Layer | Pertanyaan | Contoh |
|---|---|---|
| Network boundary | Apakah endpoint dapat dijangkau? | REST API hanya internal subnet/VPN |
| Authentication | Siapa user/client ini? | SSO, LDAP, Basic Auth, OIDC, mTLS |
| Identity mapping | User ini punya group/tenant apa? | `officer`, `supervisor`, `agency-a` |
| Camunda authorization | Resource engine apa yang boleh diakses? | READ Task, UPDATE Process Instance |
| Tenant check | Data tenant mana yang boleh dilihat? | tenant `CEA`, `CPDS`, `agency-x` |
| Business authorization | Secara domain, bolehkah action ini? | officer hanya boleh approve case assigned area |
| UI authorization | Tombol/action apa yang ditampilkan? | Hide “Approve” kalau bukan reviewer |
| Audit | Siapa melakukan apa, kapan, atas dasar apa? | decision audit, user operation log |
| Data protection | Data apa yang boleh disimpan/ditampilkan? | PII, documents, evidence, serialized variables |

Kesalahan umum: menyamakan group Camunda dengan business role penuh.

Misalnya:

```text
Group: supervisor
```

Ini tidak cukup untuk menjawab:

- Supervisor wilayah mana?
- Supervisor untuk case type apa?
- Apakah case sedang dalam state yang bisa di-approve?
- Apakah user pernah menangani case ini sebelumnya sehingga perlu four-eyes separation?
- Apakah ada conflict of interest?
- Apakah approval membutuhkan delegation aktif?

Camunda authorization menjawab resource-level access. Regulatory business rule sering membutuhkan domain-level policy.

---

## 4. Authentication vs Authorization vs Assignment

Tiga konsep ini sering tercampur.

### 4.1 Authentication

Authentication menjawab:

> User/client ini siapa?

Contoh:

- `alice` berhasil login via LDAP.
- `system-worker-a` mengirim client credentials token.
- `case-ui` memanggil backend dengan session user tertentu.

Authentication tidak otomatis berarti user boleh melakukan action.

### 4.2 Authorization

Authorization menjawab:

> User/client ini boleh melakukan operasi apa terhadap resource apa?

Contoh:

- User boleh membaca task `TASK_123`.
- User boleh complete task `TASK_123`.
- User boleh melihat process definition tertentu.
- User boleh akses Cockpit.
- User boleh melakukan migration batch.

### 4.3 Assignment

Assignment menjawab:

> Task ini saat ini ditujukan/dipegang siapa?

Contoh:

- `assignee = alice`
- `candidateGroup = case-officer`
- `owner = supervisor-a`

Assignment bukan authorization penuh.

Task assigned ke `alice` belum tentu secara business boleh di-complete jika:

- case sudah locked oleh rework process,
- user sedang suspended,
- approval membutuhkan two-person rule,
- task sudah expired dan harus escalated,
- case tenant tidak cocok,
- user hanya boleh view tetapi tidak decide.

Prinsip:

> Assignment adalah routing. Authorization adalah permission. Business policy adalah admissibility of action.

---

## 5. Camunda Authorization Service: Apa yang Sebenarnya Dilakukan?

Camunda Authorization Service mengontrol akses ke data yang dikelola engine.

Dokumentasi Camunda menjelaskan authorization sebagai assignment permission ke identity terhadap resource. Identity bisa user, group, atau `ANY`; permission meliputi permission umum seperti `READ`, `UPDATE`, `CREATE`, `DELETE`, `ACCESS`, dan resource meliputi application, authorization, batch, deployment, process definition, process instance, task, dan lain-lain.

Secara mental:

```text
Authorization = Identity + Resource + ResourceId + Permissions
```

Contoh konseptual:

```text
User alice
  boleh READ dan UPDATE
  terhadap Task TASK_123

Group supervisor
  boleh ACCESS
  terhadap Application cockpit

Group officer
  boleh READ
  terhadap ProcessDefinition enforcement-case
```

Camunda menyimpan authorization di tabel identity/authorization internal.

---

## 6. Kapan Authorization Service Perlu Diaktifkan?

Dokumentasi Camunda menyatakan authorization punya cost performa dan kompleksitas, sehingga tidak selalu perlu.

### 6.1 Biasanya perlu jika

1. Camunda REST API dapat diakses user/client yang tidak boleh punya full access.
2. Camunda webapps dapat diakses user yang tidak boleh punya full access.
3. User tidak dipercaya bisa membentuk query/command engine secara bebas.
4. Multi-tenant system memberi akses langsung ke Camunda API/webapp.
5. Tasklist/Cockpit/Admin digunakan oleh operational users dengan permission berbeda.
6. Compliance mengharuskan resource-level enforcement di engine.

### 6.2 Biasanya tidak wajib jika

1. Engine embedded di aplikasi.
2. Semua akses ke engine hanya lewat backend application service.
3. User tidak pernah memanggil Camunda API langsung.
4. Aplikasi sudah enforce business-level authorization secara lengkap.
5. Camunda webapps hanya tersedia untuk trusted admin/operator internal.

Namun “tidak wajib” bukan berarti “tidak berguna”. Untuk defense-in-depth, environment high-risk dapat tetap mengaktifkan authorization walau engine diakses melalui aplikasi.

Trade-off-nya:

| Pilihan | Kelebihan | Risiko/biaya |
|---|---|---|
| Authorization off | Lebih sederhana, query lebih ringan | Engine bergantung total pada app boundary |
| Authorization on | Defense-in-depth, webapp/REST lebih aman | Query lebih kompleks, perlu grant model, admin overhead |
| Hybrid | App policy + limited Camunda auth | Perlu disiplin agar tidak ada gap |

---

## 7. Resource Model Camunda Authorization

Resource Camunda bukan domain object.

Camunda mengenal resource seperti:

- Application
- Authorization
- Batch
- Decision Definition
- Decision Requirements Definition
- Deployment
- Filter
- Group
- Group Membership
- Process Definition
- Process Instance
- Task
- Tenant
- Tenant Membership
- User
- Historic Task / Historic Process, tergantung API/resource support

Yang perlu ditekankan:

> `Process Instance` bukan `Case`. `Task` bukan `Application Review`. `Process Definition` bukan `Business Capability`. Mapping domain harus dikelola secara eksplisit.

Contoh mapping buruk:

```text
Role officer -> semua task bisa update
```

Ini terlalu kasar.

Contoh mapping lebih baik:

```text
Role officer -> aplikasi backend boleh query eligible tasks
Backend policy -> filter by tenant, module, assigned unit, case state, conflict rule
Camunda authorization -> optional READ/UPDATE task defense-in-depth
```

---

## 8. Grant, Revoke, Global, dan ANY

Camunda authorization model punya beberapa jenis authorization:

1. Global authorization.
2. Grant authorization.
3. Revoke authorization.

Konsepnya bisa dibayangkan seperti policy overlay.

```text
Global permissions
    + grant to user/group
    - revoke from user/group
    = effective permissions
```

Namun jangan membangun policy yang terlalu rumit hanya karena engine mendukungnya. Jika banyak revoke spesifik dibutuhkan, biasanya ada masalah desain role/resource.

Anti-pattern:

```text
Grant READ all tasks to group officer
Revoke 500 task-specific permissions per day
```

Lebih baik:

- jangan expose raw Task API,
- gunakan application query dengan business filtering,
- berikan Camunda authorization minimal untuk aplikasi/system role,
- buat custom task projection yang domain-aware.

---

## 9. Camunda Identity Service

Identity Service adalah abstraction untuk user/group/tenant repository.

Dokumentasi Camunda menyebut entity utama:

- User
- Group
- Membership
- Tenant
- Tenant membership

Camunda membedakan identity repository read-only dan writable.

### 9.1 Database Identity Service

Default implementation memakai database engine Camunda.

Kelebihan:

- mudah untuk local/dev,
- cocok untuk demo/internal kecil,
- bisa manage user/group lewat Admin.

Kekurangan:

- jarang cocok sebagai enterprise identity source,
- duplikasi user/group dengan corporate IAM,
- lifecycle user harus disinkronkan,
- password policy, MFA, account lockout, risk-based auth biasanya lebih matang di IAM eksternal.

### 9.2 LDAP Identity Service

Camunda menyediakan LDAP identity provider plugin yang read-only.

Kelebihan:

- memanfaatkan enterprise directory,
- tidak menyimpan password user di Camunda DB,
- group membership bisa berasal dari central source.

Kekurangan:

- group mapping sering terlalu teknis/legacy,
- nested groups dan large directory query bisa berat,
- caching/TTL perlu dikontrol,
- business role tetap belum tentu sama dengan LDAP group.

### 9.3 Custom Identity Provider

Camunda memungkinkan custom provider via identity provider interfaces.

Gunakan ketika:

- identity source bukan LDAP,
- group/tenant membership berasal dari IAM/API internal,
- perlu mapping custom user id/group id,
- perlu read-only integration ke external directory.

Namun jangan menjadikan identity provider sebagai tempat semua business policy. Identity provider idealnya menjawab:

```text
user X exists?
user X punya group apa?
user X punya tenant apa?
```

Bukan:

```text
user X boleh approve case Y karena business rule Z?
```

Itu domain authorization.

---

## 10. User ID, Group ID, dan Tenant ID Hygiene

Camunda punya whitelist pattern untuk user/group/tenant ID. Default pattern historisnya membatasi karakter tertentu.

Masalah nyata enterprise:

- username mengandung dot: `fajar.abdi`
- username mengandung email: `fajar@example.com`
- group mengandung slash: `agency/cea/officer`
- external subject ID berupa UUID/OIDC sub
- tenant ID punya dash/underscore

Policy yang baik:

1. Tentukan canonical Camunda user id.
2. Jangan mengganti user id format setelah production tanpa migration plan.
3. Jangan gunakan display name sebagai user id.
4. Hindari email jika email bisa berubah.
5. Simpan mapping external subject di identity/profile service.
6. Pastikan group id stabil dan predictable.
7. Dokumentasikan tenant id convention.

Contoh:

```text
external subject: oidc sub = 00u7abc...
corporate username: fajar.abdi
camunda userId: u_00u7abc
business profile id: EMP-12345
```

Atau:

```text
camunda userId = corporate immutable staff id
```

Yang penting: immutable dan tidak ambigu.

---

## 11. Authentication untuk REST API

Dokumentasi Camunda menyebut REST API memiliki HTTP Basic Authentication implementation, tetapi pada pre-built distributions authentication REST API mati secara default dan perlu diaktifkan via servlet filter.

Konsep:

```xml
<filter>
  <filter-name>camunda-auth</filter-name>
  <filter-class>
    org.camunda.bpm.engine.rest.security.auth.ProcessEngineAuthenticationFilter
  </filter-class>
  <async-supported>true</async-supported>
  <init-param>
    <param-name>authentication-provider</param-name>
    <param-value>
      org.camunda.bpm.engine.rest.security.auth.impl.HttpBasicAuthenticationProvider
    </param-value>
  </init-param>
</filter>
```

Dan dokumentasi menegaskan Basic Auth tidak menyediakan encryption, sehingga harus diamankan dengan SSL/TLS.

Namun untuk enterprise modern, Basic Auth biasanya bukan final architecture. Pilihan umum:

1. Reverse proxy/gateway melakukan OIDC/OAuth2 validation.
2. Custom authentication provider untuk Camunda REST.
3. Spring Security untuk embedded REST setup.
4. mTLS antar service internal.
5. Network isolation + service identity.

Prinsip:

> Jangan mengekspos Camunda REST API unauthenticated di production. Jangan juga menganggap authentication cukup jika user masih dapat membentuk query/command bebas.

---

## 12. Kenapa Raw Camunda REST API Berbahaya untuk Frontend

Raw Camunda REST API powerful.

Ia bisa melakukan hal-hal seperti:

- query tasks,
- complete task,
- claim/unclaim task,
- start process instance,
- delete process instance,
- suspend/resume,
- correlate message,
- inspect variables,
- inspect history,
- deploy definition,
- modify process instance,
- run migration/batch,
- manage authorization,
- manage users/groups jika endpoint tersedia dan authorized.

Jika langsung dibuka ke frontend, bahkan user authenticated bisa mencoba:

```http
GET /engine/default/task
GET /engine/default/history/variable-instance
POST /engine/default/process-instance/{id}/modification
POST /engine/default/message
POST /engine/default/task/{id}/complete
```

Walau authorization aktif, kamu masih harus mengelola permission matrix yang kompleks. Dan business constraints seperti conflict-of-interest, area jurisdiction, four-eyes principle, decision reason completeness, document classification, atau statutory deadline tidak otomatis dipahami Camunda.

Pattern yang lebih sehat:

```text
Frontend
  -> Case Management API
      -> Business authorization
      -> Input validation
      -> Domain audit
      -> Camunda TaskService/RuntimeService
      -> Projection update
```

Contoh endpoint domain-aware:

```http
POST /cases/{caseId}/review/approve
```

Bukan:

```http
POST /engine/default/task/{taskId}/complete
```

Backend melakukan:

1. authenticate user,
2. load case,
3. validate tenant,
4. validate role,
5. validate task belongs to case,
6. validate current case state,
7. validate assignment/claim,
8. validate decision payload,
9. write domain audit,
10. complete Camunda task with controlled variables.

---

## 13. Camunda Webapps: Admin, Cockpit, Tasklist

Camunda 7 menyediakan webapps utama:

- Admin
- Cockpit
- Tasklist

### 13.1 Admin

Admin paling sensitif.

Kemampuan Admin dapat mencakup:

- user management,
- group management,
- tenant management,
- authorization management,
- system configuration visibility,
- operational admin functions.

Production principle:

```text
Admin access = highly privileged operator access
```

Jangan berikan Admin ke business user biasa.

### 13.2 Cockpit

Cockpit adalah operational console. Ia berguna untuk:

- process monitoring,
- incident inspection,
- job failure diagnosis,
- process instance state,
- variable visibility,
- migration/modification/restart/suspension di edition/feature tertentu.

Cockpit bukan sekadar dashboard. Ia bisa memberi visibility ke sensitive process data.

Risiko:

- melihat PII di variables,
- melihat business evidence,
- memodifikasi process instance,
- retry job yang punya side effect,
- cancel instance,
- correlate message manual,
- expose error details.

Production principle:

```text
Cockpit access = operator/support access with controlled permissions and audit
```

### 13.3 Tasklist

Tasklist cocok untuk generic human task execution, tetapi untuk enterprise/regulatory workflow sering kurang domain-aware.

Risiko jika dipakai mentah:

- authorization terlalu coarse,
- form terlalu dekat dengan process variable,
- business validation lemah,
- domain audit kurang lengkap,
- UI tidak mencerminkan case context penuh,
- task filters bisa bocor lintas jurisdiction.

Gunakan Tasklist jika:

- use case sederhana,
- users cukup trusted,
- Camunda auth dikonfigurasi matang,
- variable/form tidak sensitive berlebihan,
- business policy sederhana.

Gunakan custom case UI jika:

- ada complex domain authorization,
- case dashboard lintas entity,
- evidence/document integration,
- multi-stage approvals,
- SLA/legal clock,
- cross-module impact,
- regulatory audit requirements.

---

## 14. CSRF, Cookie, dan Webapp Hardening

Dokumentasi Camunda webapps menyebut CSRF filter aktif secara default untuk validating modifying request via webapps, menggunakan synchronization token method per session, dengan opsi same-origin verification.

Hal yang perlu diperhatikan:

1. Pastikan webapps hanya diakses via HTTPS.
2. Aktifkan secure cookie jika deployment HTTPS.
3. Pertahankan SameSite cookie kecuali ada alasan kuat.
4. Set `targetOrigin` jika deployment domain jelas.
5. Jangan menaruh webapps di public internet tanpa reverse proxy/WAF/SSO policy.
6. Pisahkan admin webapp dari user-facing network jika memungkinkan.
7. Jangan deploy example apps/demo user di production.

Topologi sehat:

```text
[Internal Operator Browser]
    |
    | VPN / SSO / corporate network
    v
[Reverse Proxy / WAF]
    |
    | only /camunda/app/cockpit, /camunda/app/admin as needed
    v
[Camunda Webapps]
```

Topologi rawan:

```text
[Internet]
    |
    v
[Camunda prepackaged distro with demo users/examples]
```

---

## 15. Password Hashing dan Local Users

Jika memakai database identity service, Camunda menyimpan user/password di tabel identity.

Dokumentasi password hashing menjelaskan:

- Camunda 7.6 dan sebelumnya memakai SHA-1.
- Sejak Camunda 7.7 memakai SHA-512.
- Salt random per-user 16 byte dibuat dengan `SecureRandom`.
- Custom password encryptor dimungkinkan.

Namun dalam enterprise, local database user sebaiknya dibatasi untuk:

- bootstrap admin,
- break-glass account,
- local/dev/test,
- fallback terbatas dengan monitoring.

Untuk production, lebih lazim:

- SSO/OIDC/SAML di perimeter,
- LDAP/AD read-only identity,
- corporate IAM sebagai source of truth,
- MFA di identity provider,
- account lifecycle di central IAM.

Break-glass account harus:

- punya password kuat,
- disimpan di vault,
- dipakai hanya saat SSO outage,
- punya audit jelas,
- dirotasi berkala,
- tidak dipakai untuk operasi harian.

---

## 16. Authentication Cache Risk

Dokumentasi security Camunda menyebut authentication cache bisa membuat perubahan user management tidak langsung berdampak pada session aktif. Default TTL bisa membuat user yang dihapus/kehilangan group tetap bisa membaca data atau melakukan operasi sampai cache expired.

Ini penting untuk environment regulated.

Contoh:

```text
09:00 user Alice dicabut dari group supervisor
09:01 Alice masih punya session aktif
09:03 Alice mencoba membuka Cockpit / complete task
09:05 cache expired, akses baru ditolak
```

Mitigasi:

1. Turunkan TTL untuk high-risk environment.
2. Disable cache jika revocation immediacy lebih penting daripada DB load.
3. Tambahkan app-level session invalidation.
4. Gunakan identity gateway yang mendukung token revocation/introspection.
5. Untuk action sensitif, lakukan real-time policy check di backend.

Trade-off:

| TTL tinggi | TTL rendah/0 |
|---|---|
| Lebih ringan ke DB/LDAP | Revocation lebih cepat |
| Risiko stale privilege | Lebih banyak identity lookup |
| Cocok untuk low-risk internal | Cocok untuk high-risk regulated |

---

## 17. Spring Security / OIDC Integration Mindset

Di embedded Spring Boot architecture, biasanya aplikasi sudah punya Spring Security.

Pattern sehat:

```text
Incoming request
  -> Spring Security validates session/JWT/OIDC
  -> Application maps principal to domain user
  -> Application validates business policy
  -> Application calls Camunda Engine API
```

Untuk Camunda webapps dalam Spring Boot, perlu integration khusus agar webapp login dan authorization mengenali user/group.

Namun prinsipnya tetap:

- Jangan menyamakan OAuth scope dengan Camunda permission begitu saja.
- Jangan menyimpan access token sebagai process variable.
- Jangan melakukan remote IAM call di setiap listener/delegate tanpa caching strategy.
- Jangan membocorkan internal group/tenant model ke BPMN gateway terlalu banyak.

Mapping yang lebih stabil:

```text
OIDC claims / IAM groups
  -> application identity profile
  -> normalized platform roles
  -> Camunda groups/tenants if needed
  -> domain policy engine
```

Contoh:

```json
{
  "sub": "00u7abc123",
  "preferred_username": "fajar.abdi",
  "groups": ["agency-cea-case-officer", "system-aceas-user"]
}
```

Normalized:

```text
userId: u_00u7abc123
camundaGroups: [case-officer]
tenants: [cea]
domainRoles: [ENFORCEMENT_REVIEWER]
```

---

## 18. Business Authorization untuk Regulatory Workflow

Camunda authorization bisa mengatur user boleh `READ`/`UPDATE` task. Tapi regulatory workflow biasanya butuh policy lebih kompleks.

Contoh action:

```text
Approve enforcement case
```

Policy domain mungkin:

1. User authenticated.
2. User active.
3. User belongs to tenant/agency case.
4. User has role `ENFORCEMENT_SUPERVISOR`.
5. Case status is `PENDING_SUPERVISOR_REVIEW`.
6. User is assigned reviewer or belongs to fallback group.
7. User did not submit the original recommendation.
8. User has jurisdiction over case location/category.
9. Required documents exist.
10. Decision reason is provided.
11. Case not locked by appeal/reopen process.
12. SLA exception has been acknowledged if overdue.
13. Legal delegation is active at decision time.

Camunda does not know most of this unless you model/code it.

Recommended architecture:

```java
public final class ApproveCaseUseCase {

  private final CaseRepository caseRepository;
  private final TaskGateway taskGateway;
  private final AuthorizationPolicy authorizationPolicy;
  private final DecisionAuditRepository auditRepository;

  @Transactional
  public void approve(ApproveCaseCommand command, CurrentUser user) {
    CaseAggregate caseAggregate = caseRepository.getForUpdate(command.caseId());

    authorizationPolicy.assertCanApprove(user, caseAggregate);

    TaskRef task = taskGateway.findActiveReviewTask(caseAggregate.id())
        .orElseThrow(() -> new IllegalStateException("No active review task"));

    DecisionAudit audit = DecisionAudit.approval(
        caseAggregate.id(),
        user.id(),
        command.reason(),
        command.evidenceRefs()
    );
    auditRepository.save(audit);

    taskGateway.complete(task.id(), Map.of(
        "decision", "APPROVED",
        "decisionAuditId", audit.id().value()
    ));
  }
}
```

Camunda task completion is not the authorization layer. It is the workflow state transition triggered after domain policy passes.

---

## 19. Secure Task Completion Contract

Bad contract:

```json
POST /task/{taskId}/complete
{
  "variables": {
    "approved": true,
    "amount": 1000000,
    "officer": "alice"
  }
}
```

Problems:

- caller controls raw variables,
- task id can be guessed/leaked,
- no domain validation,
- no case binding validation,
- no audit reason contract,
- variable tampering possible,
- business decision not durable outside Camunda.

Better contract:

```json
POST /cases/CASE-2026-0001/review-decision
{
  "decision": "APPROVE",
  "reason": "Inspection evidence is complete and violation threshold is met.",
  "evidenceIds": ["EV-001", "EV-002"],
  "version": 17
}
```

Backend controls variables:

```java
Map<String, Object> variables = Map.of(
    "reviewDecision", decision.name(),
    "reviewDecisionAuditId", auditId,
    "caseVersionAtDecision", caseVersion
);
```

Do not let frontend write arbitrary process variables.

---

## 20. Securing External Task Workers

External task workers are machine clients. They need security too.

Risks:

- worker can fetch topics it should not,
- worker leaks locked task variables,
- worker completes task with manipulated variables,
- worker logs sensitive data,
- worker id reused ambiguously,
- worker credentials shared across environments,
- worker retry behavior causes duplicate side effects.

Minimum controls:

1. Use service identity per worker/application.
2. Restrict network access to engine REST endpoint.
3. Restrict topics by worker credential or gateway policy.
4. Do not fetch all variables by default.
5. Use variable allowlist.
6. Use short-lived secrets/tokens where possible.
7. Store secrets in vault/SSM/Kubernetes Secret, not BPMN variables.
8. Log correlation id and task id, not full payload.
9. Use idempotency for side effects.
10. Monitor unusual failure/retry rate.

Example worker fetch discipline:

```java
client.subscribe("send-notice")
    .lockDuration(30_000)
    .variables("caseId", "noticeTemplateId", "recipientRef")
    .handler((externalTask, externalTaskService) -> {
        String caseId = externalTask.getVariable("caseId");
        String templateId = externalTask.getVariable("noticeTemplateId");
        String recipientRef = externalTask.getVariable("recipientRef");

        // Resolve sensitive recipient data from secure domain service,
        // not from process variables if possible.
    })
    .open();
```

---

## 21. Securing Variables and Serialized Data

Variables are a major security boundary.

Sensitive mistakes:

- storing full access tokens,
- storing password/API secret,
- storing full PII where reference id is enough,
- storing full documents as file variables,
- storing Java serialized objects,
- exposing variables via REST to users,
- querying historic variables broadly,
- logging variable maps in delegates/workers.

Policy:

| Data type | Recommended treatment |
|---|---|
| Access token | Never store as process variable |
| Refresh token | Never store as process variable |
| Password/API key | Never store as process variable |
| PII | Store minimal facts or secure reference |
| Evidence document | Store document id/reference, not binary if possible |
| Decision reason | Store audit id + maybe summary; keep full audit in domain table |
| Integration response | Store normalized outcome, not raw payload unless required |
| JSON snapshot | Versioned, minimized, redacted |
| Java object | Avoid for long-running processes |

Better:

```json
{
  "caseId": "CASE-2026-0001",
  "applicantRef": "PARTY-9981",
  "riskBand": "HIGH",
  "decisionAuditId": "AUD-123"
}
```

Worse:

```json
{
  "applicantName": "...",
  "nric": "...",
  "address": "...",
  "bankAccount": "...",
  "accessToken": "...",
  "rawMyInfoPayload": {...}
}
```

---

## 22. History and Authorization Leakage

History data can expose more than runtime data.

Runtime variable may be deleted when instance completes, but historic variable/detail may remain. If history level is high, historical detail can include variable updates, task events, user operations, incidents, job logs, and more.

Security implications:

1. User who cannot see current task might still see historic variables if history API is exposed too broadly.
2. Deleted process instance runtime data might have remaining history until cleanup.
3. Sensitive exception message can be stored in job log/incident details.
4. Process variable history can contain old sensitive values even after variable is overwritten.
5. User operation log can reveal operational actions.

Controls:

- Limit access to history API.
- Avoid storing sensitive values as variables.
- Redact exception details before throwing where possible.
- Use history cleanup/TTL aligned with retention policy.
- Separate business audit from engine history.
- Use projections for user-facing history instead of raw `ACT_HI_*`.

---

## 23. Cockpit Operator Permissions and Blast Radius

A common production mistake is giving broad Cockpit access to too many people.

Operators need visibility, but not always destructive control.

Separate personas:

| Persona | Needs | Should not do |
|---|---|---|
| L1 support | See status, incident summary | Modify/cancel/retry sensitive process |
| L2 support | Retry failed jobs, inspect variables with masking | Deploy/migrate all definitions |
| Workflow admin | Suspend/resume definitions, batch ops | Manage identity globally |
| Security admin | Manage auth/groups | Inspect business PII unnecessarily |
| Developer | Debug lower env | Have broad prod write access |
| Auditor | Read audit trail | Mutate process state |

Design privileged operations as explicit runbooks:

```text
Retry failed job with external side effect
  -> check idempotency record
  -> check downstream system state
  -> record operator action reason
  -> retry once
  -> verify outcome
```

Do not turn Cockpit into a silent backdoor around business workflow controls.

---

## 24. Instance Modification Security

Process instance modification is powerful.

It can:

- cancel activity instance,
- start before/after activity,
- set variables,
- skip steps,
- bypass normal gateways,
- recover broken state,
- also corrupt audit/business flow if abused.

Security model:

```text
Instance modification = production surgery
```

Controls:

1. Restrict to specialized operators.
2. Require ticket/change reference.
3. Require reason.
4. Require peer approval for high-risk processes.
5. Log before/after state.
6. Prefer domain repair process if possible.
7. Do not use modification as routine business flow.
8. Ensure regulatory audit captures why normal process was overridden.

For regulatory systems, manual modification without business audit is dangerous because it changes execution path outside normal decision model.

---

## 25. Deployment and Model Change Security

Deployment is not just technical release. In Camunda, BPMN/DMN deployment changes executable behavior.

Risks:

- malicious/accidental expression invokes unauthorized bean,
- delegate class binding points to dangerous code,
- script task executes server-side script,
- connector sends data externally,
- DMN changes approval decision,
- BPMN bypasses required review,
- timer/escalation changes statutory behavior,
- call activity binding changes child process.

Controls:

1. Treat BPMN/DMN as code.
2. Require code review for process models.
3. Store BPMN/DMN in Git.
4. Run automated model linting.
5. Restrict deployment permission.
6. Disable or restrict scripts/connectors if not needed.
7. Validate delegate expressions against allowlist.
8. Enforce history TTL and tenant id policies.
9. Validate async boundary and error boundary conventions.
10. Sign/release process artifacts through CI/CD.

Do not allow ad-hoc model deployment from production UI unless governance explicitly permits it.

---

## 26. Expression, Script, and Custom Code Security

Camunda BPMN can bind to Java code via:

- `camunda:class`
- `camunda:delegateExpression`
- `camunda:expression`
- listeners
- scripts
- connectors

Security risks:

- arbitrary bean method invocation,
- access to Spring context,
- classpath gadget exposure,
- unsafe scripts,
- data exfiltration through HTTP connector,
- unexpected file/network access,
- privilege escalation via internal services.

Policy:

1. Prefer delegate expressions to explicit allowlisted workflow adapters.
2. Do not expose entire application service layer to BPMN expressions.
3. Disable scripting if not needed.
4. Restrict scripting engine availability.
5. Avoid script task for business-critical policy.
6. Avoid connector calls directly from BPMN if service layer can control better.
7. Use parse listener/model validation to enforce standards.
8. Keep delegates thin and auditable.

Bad:

```xml
camunda:expression="${userService.grantAdmin(execution.getVariable('userId'))}"
```

Better:

```xml
camunda:delegateExpression="${assignCaseOfficerDelegate}"
```

Where delegate is reviewed, tested, logged, and policy-controlled.

---

## 27. REST API Gateway Pattern

For enterprise production, expose domain API, not engine API.

```text
Browser / External system
  -> API Gateway
  -> Domain Service
  -> Camunda Engine API
```

Gateway responsibilities:

- TLS termination,
- authentication,
- rate limiting,
- request size limit,
- WAF rules,
- audit headers,
- correlation id,
- routing,
- API versioning.

Domain service responsibilities:

- business authorization,
- tenant scoping,
- validation,
- domain audit,
- controlled Camunda calls,
- idempotency,
- response shaping.

Camunda REST should often be:

- internal only,
- not directly accessible from internet,
- possibly accessible only to trusted services/operators,
- protected by mTLS/OIDC/basic+TLS depending environment,
- audited at proxy and app layer.

---

## 28. Security for Message Correlation Endpoints

Message correlation can move process state.

Raw endpoint:

```http
POST /engine/default/message
```

If exposed directly, caller might correlate messages incorrectly or maliciously:

- complete waiting payment,
- simulate external approval,
- trigger cancellation,
- bypass validation,
- correlate by weak business key,
- spam correlation attempts.

Safer pattern:

```http
POST /integrations/payment-events
POST /integrations/onemap-callback
POST /integrations/document-signed-events
```

Backend does:

1. authenticate source system,
2. verify signature/mTLS/token,
3. validate event schema,
4. check replay/idempotency,
5. store inbox event,
6. load domain aggregate,
7. decide whether event is acceptable,
8. correlate controlled Camunda message.

Never trust external event just because it names a `businessKey`.

---

## 29. Security for Start Process Endpoints

Starting a process is also a privileged action.

Risks:

- duplicate process instance,
- process spam/DoS,
- starting wrong tenant process,
- injecting variables,
- bypassing domain creation rules,
- creating case without audit.

Bad:

```http
POST /engine/default/process-definition/key/enforcement-case/start
```

Better:

```http
POST /cases
{
  "caseType": "ENFORCEMENT",
  "subjectRef": "PARTY-9981",
  "source": "INSPECTION",
  "initialEvidenceIds": ["EV-001"]
}
```

Backend controls:

- business key,
- tenant id,
- initial variables,
- deduplication,
- domain case row,
- audit trail,
- process definition selection/version.

---

## 30. Tenant Security Revisited

From part-019: tenant id is logical isolation.

Security concerns:

1. Query must always be tenant-scoped.
2. Deployment must not leak definitions across tenants unintentionally.
3. Message correlation must include tenant dimension where applicable.
4. External task workers must not process wrong tenant accidentally.
5. History queries must be tenant-scoped.
6. Admin users with cross-tenant visibility must be audited.
7. Tenant membership cache/revocation matters.

Business policy should not rely only on `tenantId`.

Example:

```text
tenantId = CEA
```

Still not enough to decide:

- which branch/unit,
- which role,
- which case type,
- which statutory authority,
- which sensitivity classification.

---

## 31. Least Privilege Design

Least privilege applies to both humans and machines.

### 31.1 Human users

- case officer: access own/candidate tasks through domain UI;
- supervisor: access team queue and approval action;
- operator: inspect incidents but not business approve;
- admin: manage platform config but not necessarily inspect PII;
- auditor: read audit reports, no mutation.

### 31.2 Machine clients

- worker `send-notice`: fetch/complete only `send-notice` external tasks;
- integration `payment-callback`: submit payment events only;
- projection service: read required history/runtime events only;
- migration tool: temporary high privilege, disabled after migration;
- monitoring: read metrics/health, not mutate engine.

### 31.3 Database accounts

- application DB user: required engine privileges only;
- reporting user: read-only projection/history, not runtime mutation;
- DBA/admin: privileged but audited;
- migration account: temporary, controlled.

Never use one all-powerful credential everywhere.

---

## 32. Secrets Management

Secrets should not live in:

- BPMN XML,
- DMN tables,
- process variables,
- source code,
- application logs,
- Cockpit-visible variable payload,
- task form hidden fields.

Use:

- vault,
- cloud secret manager,
- Kubernetes Secrets with proper controls,
- AWS SSM/Secrets Manager,
- environment-specific secure config,
- short-lived token exchange.

Delegate/worker should resolve secret at runtime from secure config, not from process instance data.

Bad:

```xml
<camunda:field name="apiKey" stringValue="secret-123" />
```

Better:

```xml
<camunda:field name="credentialRef" stringValue="notice-service-prod" />
```

Delegate resolves `notice-service-prod` via configured secret provider and logs only the reference.

---

## 33. Data Classification for Process Variables

Introduce variable classification:

| Classification | Example | Storage policy |
|---|---|---|
| Public operational | process status | OK in variable/history |
| Internal | routing role, unit | OK with access control |
| Confidential | case summary | minimize, redact in logs |
| Restricted/PII | NRIC, address, phone | prefer reference/tokenized/minimized |
| Secret | API key, token, password | never as variable |
| Legal evidence | document content | secure document store reference |

Add review checklist for every new variable:

1. Is it needed for routing?
2. Is it needed after wait state?
3. Is it needed in history?
4. Can it be represented as reference id?
5. Can it be derived from domain DB?
6. Who can see it in Cockpit/Tasklist/history?
7. What is retention period?
8. Does it contain PII/secret?
9. Is it logged anywhere?
10. Is it serialized object or versioned JSON?

---

## 34. Audit: Camunda User Operation Log vs Business Audit

Camunda can record certain user operations depending history level/configuration.

But regulatory audit usually needs more:

- business decision,
- legal basis,
- role at time of action,
- delegation at time of action,
- evidence snapshot,
- reason statement,
- before/after domain state,
- SLA context,
- exception/override reason,
- approval chain,
- external system references.

Design:

```text
Camunda History
  = technical process execution evidence

Business Audit
  = legal/regulatory decision evidence

Security Audit
  = authentication, authorization, privileged access evidence
```

Do not rely only on Camunda history for legal defensibility.

---

## 35. Secure Architecture Patterns

### 35.1 Internal engine + custom UI

```text
User
 -> Custom UI
 -> Backend with Spring Security
 -> Domain policy
 -> Camunda embedded engine
```

Good for:

- regulatory systems,
- complex authorization,
- rich domain UI,
- high audit requirement.

### 35.2 Shared engine + internal webapps

```text
Internal operators
 -> SSO/VPN
 -> Camunda Webapps
 -> Shared engine
```

Good for:

- operations,
- monitoring,
- support.

Needs:

- strong access control,
- limited operator roles,
- audit.

### 35.3 Remote engine REST internal only

```text
Services/workers
 -> internal network/mTLS/OIDC
 -> Camunda REST
```

Good for:

- distributed services,
- polyglot workers.

Needs:

- service identity,
- rate limiting,
- topic/resource restrictions,
- no public exposure.

### 35.4 Anti-pattern: Public Camunda REST

```text
Internet frontend
 -> Camunda REST directly
```

Usually bad for:

- regulatory workflow,
- multi-tenant system,
- sensitive variables,
- complex business authorization.

---

## 36. Production Hardening Checklist

### 36.1 Network

- [ ] Camunda REST not public unless explicitly justified.
- [ ] Webapps behind HTTPS.
- [ ] Admin/Cockpit restricted by VPN/SSO/network policy.
- [ ] Database not reachable from application users.
- [ ] Worker endpoints have network allowlist.
- [ ] Separate lower/prod environments.

### 36.2 Authentication

- [ ] REST API authentication enabled if deployed.
- [ ] Basic Auth only over TLS if used.
- [ ] SSO/OIDC/LDAP integration documented.
- [ ] Break-glass account controlled.
- [ ] Demo user removed.
- [ ] Example apps not deployed.
- [ ] Login/logout logging enabled where appropriate.
- [ ] Brute-force protection at IdP/proxy/app layer.

### 36.3 Authorization

- [ ] Decision made whether Camunda auth is on/off/hybrid.
- [ ] If raw REST/webapps exposed to users, authorization enabled.
- [ ] Admin/Cockpit/Tasklist permissions separated.
- [ ] No broad `ALL` permission for regular users.
- [ ] Tenant checks configured if multi-tenant.
- [ ] Authorization performance tested.
- [ ] Business authorization implemented outside Camunda resource permissions.

### 36.4 Variables/data

- [ ] No secrets in variables.
- [ ] No access tokens in variables.
- [ ] PII minimized.
- [ ] File variables avoided for large/sensitive docs unless intentional.
- [ ] Java serialized object variables avoided.
- [ ] Historic variable retention reviewed.
- [ ] Logs redact variable payload.

### 36.5 Webapps

- [ ] CSRF protection enabled.
- [ ] Secure cookie configured under HTTPS.
- [ ] SameSite cookie reviewed.
- [ ] Headers configured at proxy/container.
- [ ] Admin/Cockpit not accessible to broad audience.
- [ ] Operator actions audited/runbooked.

### 36.6 Code/model

- [ ] BPMN/DMN treated as code.
- [ ] Process model review required.
- [ ] Deployment permission restricted.
- [ ] Script/connector usage restricted or disabled if not needed.
- [ ] Delegate expressions allowlisted.
- [ ] External task topics controlled.
- [ ] Workers use service identity.

### 36.7 Operations

- [ ] Incident handling runbooks exist.
- [ ] Instance modification restricted.
- [ ] Retry actions audited.
- [ ] Migration tools temporary and controlled.
- [ ] Security notices monitored.
- [ ] Patch policy defined.
- [ ] Backup/restore access controlled.

---

## 37. Common Security Anti-Patterns

### Anti-pattern 1: “Authenticated means authorized”

User berhasil login, lalu dianggap boleh melihat semua task.

Corrective model:

```text
authenticated user + role + tenant + assignment + domain policy + task state
```

### Anti-pattern 2: Expose `/engine/default/task` to frontend

Frontend diberi kemampuan query engine bebas.

Corrective model:

```text
GET /work-queue/my-tasks
```

Backend memfilter domain-aware.

### Anti-pattern 3: Store JWT/access token as variable

Token menjadi terlihat di Cockpit/history/logs.

Corrective model:

```text
Store credentialRef or integration account identity; resolve token at runtime.
```

### Anti-pattern 4: Use Tasklist for highly regulated case decisions without domain guard

Tasklist bisa complete task, tetapi tidak otomatis enforce legal policy.

Corrective model:

```text
Custom UI + domain use case + controlled task completion.
```

### Anti-pattern 5: Give Cockpit full access to everyone

Cockpit menjadi production backdoor.

Corrective model:

```text
Role-based operator access + runbooks + audit.
```

### Anti-pattern 6: BPMN expressions call arbitrary services

Model menjadi remote control untuk application internals.

Corrective model:

```text
Reviewed delegates only; limited bean exposure.
```

### Anti-pattern 7: Local Camunda users as enterprise identity source

User lifecycle terpisah dari corporate IAM.

Corrective model:

```text
SSO/LDAP/IAM integration; local only for break-glass/dev.
```

### Anti-pattern 8: Rely on tenant id only

Tenant id tidak cukup untuk domain authorization.

Corrective model:

```text
tenant + unit + jurisdiction + role + action + case state + conflict rule.
```

---

## 38. Regulatory Case Management Example

Misal sistem enforcement lifecycle:

```text
Case Created
 -> Officer Review
 -> Supervisor Approval
 -> Legal Review
 -> Notice Issuance
 -> Appeal Window
 -> Closure
```

Security design:

### 38.1 Identity

```text
User: immutable staff id
Groups: case-officer, supervisor, legal-officer, platform-operator
Tenant: agency id
Domain role: role assignment in HR/case-management policy service
```

### 38.2 UI

Custom case UI, bukan raw Tasklist untuk primary user flow.

### 38.3 Camunda authorization

- Business users do not access raw REST.
- Backend service account accesses engine.
- Operators have restricted Cockpit access.
- Admin access limited.
- Optional authorization enabled for webapps.

### 38.4 Task completion

Officer does not call Camunda directly.

```text
POST /cases/{id}/submit-recommendation
```

Backend:

1. authenticates officer,
2. checks tenant/jurisdiction,
3. checks active assignment,
4. checks required evidence,
5. writes business audit,
6. completes Camunda task with controlled variables.

### 38.5 Supervisor approval

Policy includes:

- supervisor role,
- same jurisdiction,
- not original recommender,
- active delegation,
- case state pending approval,
- required reason.

### 38.6 Operator recovery

If job `issue-notice` fails:

- L1 can see incident summary.
- L2 can inspect with masked variables.
- Retry requires checking downstream notice service idempotency.
- If manual correction needed, operator records reason/ticket.

### 38.7 Audit

- Camunda history stores process/task path.
- Domain audit stores decision/reason/evidence/legal basis.
- Security audit stores login/admin/operator actions.

This layering is what makes workflow defensible.

---

## 39. Java 8–25 Considerations

Camunda 7 spans long Java generations. Security posture differs by runtime generation.

### 39.1 Java 8 legacy

Risks:

- older TLS defaults,
- older dependency ecosystem,
- older app server integrations,
- weaker library maintenance posture,
- more likely legacy Java serialization use.

Controls:

- patch aggressively,
- restrict serialization,
- terminate TLS at modern proxy if needed,
- review dependencies,
- isolate legacy runtime.

### 39.2 Java 11/17

More common enterprise upgrade targets. Better baseline for modern TLS, containers, and Spring Boot generations.

Controls:

- align Camunda version support,
- test LDAP/OIDC integration,
- verify app server compatibility,
- monitor reflective access/deprecated modules.

### 39.3 Java 21+

Camunda 7 support depends on specific Camunda version/support matrix. Do not assume all Camunda 7 versions support all modern Java versions.

Controls:

- check supported environments for exact Camunda version,
- run compatibility testing,
- validate classloading and serialization,
- validate Spring Boot starter compatibility,
- validate application server support.

### 39.4 Java 25 planning

For Java 25-era systems, treat Camunda 7 as legacy platform component. Even if application ecosystem moves forward, Camunda 7 compatibility and EoL planning must be considered.

Design for:

- isolation,
- stable API boundary,
- migration path,
- reducing deep coupling to Camunda internals,
- minimizing Java serialized state.

---

## 40. Security Review Questions

Use these questions when reviewing a Camunda 7 platform:

1. Who can reach Camunda REST API?
2. Is REST authentication enabled?
3. Is REST protected by TLS/mTLS/OIDC/proxy?
4. Who can reach Admin/Cockpit/Tasklist?
5. Are demo users/example apps removed?
6. Is Camunda authorization enabled where untrusted users access engine APIs?
7. Are regular users given broad process/task permissions?
8. Are business actions exposed as domain APIs or raw task completion?
9. Can users submit arbitrary process variables?
10. Are secrets ever stored as process variables?
11. Are PII variables minimized?
12. Are historic variables protected and retained correctly?
13. Are external task workers authenticated and topic-scoped?
14. Can any worker fetch all topics?
15. Are message correlation endpoints protected against replay/spoofing?
16. Are instance modification/restart/migration restricted?
17. Are model deployments controlled and reviewed?
18. Are scripts/connectors allowed? If yes, why?
19. Is break-glass access audited?
20. Is privilege revocation delay acceptable?
21. Are operator actions linked to tickets/reasons?
22. Does business audit survive Camunda history cleanup?
23. Are security notices monitored?
24. Is patch/update strategy defined given Camunda 7 lifecycle?

---

## 41. Practical Design Decision Matrix

| Situation | Recommended approach |
|---|---|
| Custom enterprise case UI | Do authN/authZ in app, call embedded/remote engine with service account |
| Business users directly use Tasklist | Enable Camunda auth, restrict groups/tasks, review variable exposure |
| Operators use Cockpit | Restrict via SSO/VPN + Camunda app permissions + audit |
| Public external event callback | Do not expose `/message`; build secure ingestion endpoint |
| External workers | Service identity + topic restriction + variable allowlist + idempotency |
| Multi-tenant platform | Tenant checks + domain policy + tenant-aware query/correlation/history |
| Sensitive PII workflow | Minimize variables, secure references, restricted history, masking |
| Need admin repair in prod | Runbooked Cockpit/API operation with reason/ticket/approval |
| BPMN deployment by business analyst | CI/CD governance + review + linting + limited deployment permission |
| Legacy Java 8 Camunda 7 | Isolate, patch, restrict exposure, plan migration |

---

## 42. Minimal Reference Implementation Sketch

### 42.1 Domain endpoint

```java
@RestController
@RequestMapping("/cases/{caseId}/review")
public class CaseReviewController {

  private final ApproveCaseUseCase approveCaseUseCase;

  @PostMapping("/approve")
  public ResponseEntity<Void> approve(
      @PathVariable String caseId,
      @RequestBody ApproveCaseRequest request,
      Authentication authentication
  ) {
    CurrentUser user = CurrentUser.from(authentication);

    approveCaseUseCase.approve(new ApproveCaseCommand(
        CaseId.of(caseId),
        request.reason(),
        request.evidenceIds(),
        request.expectedVersion()
    ), user);

    return ResponseEntity.noContent().build();
  }
}
```

### 42.2 Policy object

```java
public final class CaseAuthorizationPolicy {

  public void assertCanApprove(CurrentUser user, CaseAggregate caseAggregate) {
    require(user.isAuthenticated(), "Unauthenticated");
    require(user.hasTenant(caseAggregate.tenantId()), "Wrong tenant");
    require(user.hasRole("ENFORCEMENT_SUPERVISOR"), "Missing supervisor role");
    require(caseAggregate.isPendingSupervisorReview(), "Invalid state");
    require(!caseAggregate.wasRecommendedBy(user.userId()), "Four-eyes violation");
    require(user.hasJurisdiction(caseAggregate.jurisdiction()), "No jurisdiction");
  }

  private static void require(boolean condition, String message) {
    if (!condition) {
      throw new AccessDeniedException(message);
    }
  }
}
```

### 42.3 Controlled Camunda gateway

```java
public final class CamundaTaskGateway {

  private final TaskService taskService;

  public Optional<TaskRef> findActiveReviewTask(CaseId caseId) {
    Task task = taskService.createTaskQuery()
        .processInstanceBusinessKey(caseId.value())
        .taskDefinitionKey("Supervisor_Review_Task")
        .active()
        .singleResult();

    return Optional.ofNullable(task).map(t -> new TaskRef(t.getId()));
  }

  public void complete(TaskRef task, ReviewDecision decision, AuditId auditId) {
    Map<String, Object> variables = Map.of(
        "reviewDecision", decision.name(),
        "reviewDecisionAuditId", auditId.value()
    );
    taskService.complete(task.id(), variables);
  }
}
```

This pattern keeps business policy outside BPMN and controls what variables enter the engine.

---

## 43. Key Takeaways

1. Camunda authentication answers who the user/client is; authorization answers what Camunda resource they may access; business policy answers whether a domain action is allowed.
2. Do not expose raw Camunda REST API to untrusted users unless authentication, authorization, tenant checks, API gateway, and business constraints are fully designed.
3. User task assignment is routing, not full permission.
4. Camunda authorization has performance/complexity cost and is most important when users directly interact with engine APIs/webapps.
5. Custom enterprise/regulatory systems usually need domain API + domain authorization + controlled Camunda calls.
6. Admin/Cockpit access is privileged operational access, not ordinary user access.
7. Process variables and history are security-sensitive data stores.
8. External task workers need service identity, topic discipline, variable allowlisting, and idempotency.
9. BPMN/DMN deployment is executable behavior change and must be governed like code.
10. Security design must include identity, tenant, authorization, audit, retention, operator recovery, and migration lifecycle.

---

## 44. Latihan

### Latihan 1 — Threat Model Raw Task Completion

Ambil endpoint hipotetis:

```http
POST /engine/default/task/{taskId}/complete
```

Buat threat model:

1. Bagaimana user bisa mendapatkan task id?
2. Apa yang terjadi jika user mengirim variable arbitrary?
3. Bagaimana memastikan task belong to case yang tepat?
4. Apa business validation yang hilang?
5. Audit apa yang tidak tercatat?
6. Apa alternatif endpoint domain-aware?

### Latihan 2 — Design Operator Role Matrix

Buat role matrix untuk:

- L1 support,
- L2 support,
- workflow admin,
- security admin,
- auditor,
- developer lower environment.

Untuk setiap role, tentukan:

- boleh melihat apa,
- boleh mengubah apa,
- perlu approval apa,
- perlu audit apa.

### Latihan 3 — Variable Classification Review

Ambil 20 process variables dari workflow nyata/hipotetis. Klasifikasikan:

- routing fact,
- domain reference,
- PII,
- secret,
- evidence reference,
- audit reference,
- temporary/transient.

Tentukan mana yang harus dihapus, direduksi, atau dipindah ke domain store.

### Latihan 4 — Business Authorization Policy

Untuk action `ApproveCase`, tulis policy lengkap dalam pseudo-code:

- identity,
- tenant,
- role,
- jurisdiction,
- case state,
- assignment,
- four-eyes,
- SLA,
- evidence completeness,
- audit reason.

### Latihan 5 — Secure Message Ingestion

Desain endpoint `POST /integrations/payment-events` yang akhirnya correlate message ke Camunda.

Tentukan:

- authentication source system,
- signature verification,
- replay protection,
- inbox table,
- idempotency key,
- domain validation,
- correlation key,
- error handling.

---

## 45. Penutup

Camunda 7 security tidak boleh dipikirkan hanya sebagai konfigurasi `authorizationEnabled=true` atau servlet filter Basic Auth. Untuk platform enterprise, khususnya regulatory case management, security adalah desain sistem menyeluruh:

```text
Identity -> Role -> Tenant -> Domain Policy -> Controlled Engine Command -> Audit -> Retention
```

Camunda memberikan primitive yang berguna: identity service, authorization service, tenant checks, webapp authentication, REST authentication hook, CSRF protection, user operation log, dan history. Tetapi primitive ini tidak otomatis menghasilkan business-level security yang defensible.

Engineer yang kuat tidak bertanya hanya:

> “Bagaimana supaya user bisa login ke Camunda?”

Tetapi:

> “Siapa boleh melakukan transisi state apa, pada entity apa, dalam kondisi apa, dengan bukti apa, dan bagaimana hal itu dapat dibuktikan ulang setelah proses selesai?”

Itulah level desain security yang dibutuhkan untuk Camunda 7 production-grade platform.

---

## Status Seri

Part ini selesai.

Seri belum selesai. Lanjut ke:

`learn-java-camunda-7-bpm-platform-engineering-part-021.md` — Spring Boot Integration Advanced: Embedded Engine, Transactions, Beans, Profiles, Testing.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-019.md">⬅️ Part 019 — Multi-Tenancy, Engine Partitioning, Authorization Boundary, dan Shared Platform Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-021.md">Part 021 — Spring Boot Integration Advanced: Embedded Engine, Transactions, Beans, Profiles, Testing ➡️</a>
</div>
