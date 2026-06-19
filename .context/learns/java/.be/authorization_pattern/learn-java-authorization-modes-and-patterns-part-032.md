# Java Authorization Modes and Patterns — Advanced Engineering
## Part 32 — External Policy Engine Integration from Java

> Seri: `learn-java-authorization-modes-and-patterns`  
> File: `learn-java-authorization-modes-and-patterns-part-032.md`  
> Target pembaca: Java engineer senior/principal yang ingin mendesain authorization system yang aman, audit-ready, scalable, dan maintainable.  
> Versi Java: Java 8 sampai Java 25.  
> Status seri: Part 32 dari 35. Seri belum selesai.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membangun model internal authorization service. Part ini membahas langkah yang lebih jauh: **mengintegrasikan Java application dengan external policy engine**.

External policy engine berarti authorization logic tidak sepenuhnya tertanam di source code aplikasi. Aplikasi tetap melakukan enforcement, tetap memuat subject/action/resource/context, tetapi keputusan final, sebagian keputusan, atau sebagian policy dapat dievaluasi oleh engine/policy runtime terpisah.

Contoh engine/pola yang akan kita bahas:

1. **OPA / Open Policy Agent** dengan Rego.
2. **Cedar-style policy engine** seperti Cedar open source atau Amazon Verified Permissions.
3. **Remote PDP** internal buatan sendiri.
4. **Sidecar PDP** di dekat Java service.
5. **Embedded policy engine** di dalam proses Java.
6. **Gateway/service mesh external authorization**.

Part ini bukan promosi tool. Fokusnya adalah engineering judgment:

> Kapan external policy engine membuat sistem lebih kuat, dan kapan justru menambah latency, operational burden, dan failure mode baru?

---

## 1. Mental Model: Policy Engine Bukan Pengganti Authorization Design

Kesalahan umum engineer adalah mengira:

```text
We use OPA/Cedar/Verified Permissions, therefore authorization is solved.
```

Ini salah.

External policy engine hanya memindahkan **sebagian decision logic** ke tempat lain. Ia tidak otomatis menyelesaikan:

1. Resource modeling.
2. Tenant boundary.
3. Query scoping.
4. Object-level checks.
5. Cache correctness.
6. Audit defensibility.
7. Policy lifecycle.
8. Attribute freshness.
9. Data filtering.
10. Service-to-service confused deputy.
11. Failure semantics.

Model yang benar:

```text
User/Workload Request
        |
        v
Java PEP builds authorization input
        |
        v
Policy Engine / PDP evaluates policy
        |
        v
Java PEP enforces decision
        |
        v
Domain operation / query / transition
```

External policy engine menjawab:

```text
Given this input, under the currently loaded policies and data, should this action be allowed?
```

Tetapi Java application tetap bertanggung jawab untuk:

1. Mengirim input yang benar.
2. Tidak percaya input client mentah.
3. Menentukan resource yang benar.
4. Melakukan query scoping.
5. Menghormati deny decision.
6. Menjalankan obligation.
7. Menulis audit.
8. Menentukan fail-closed/fail-open policy.
9. Menjaga compatibility antar versi policy dan versi aplikasi.

---

## 2. Kapan External Policy Engine Layak Dipakai

External policy engine cocok ketika authorization memenuhi beberapa kondisi berikut.

### 2.1 Policy Sering Berubah

Jika aturan authorization sering berubah karena:

1. Regulasi.
2. Policy internal organisasi.
3. Tenant-specific rule.
4. Product entitlement.
5. Enterprise customer customization.
6. Case management workflow yang berubah.
7. Compliance review.

maka hardcoded Java `if/else` akan menjadi mahal.

Contoh hardcoded buruk:

```java
if (user.hasRole("SENIOR_OFFICER") && caseFile.getRiskLevel() <= 3) {
    return true;
}
```

Masalahnya bukan hanya kode. Masalahnya adalah policy tersebut:

1. Sulit direview non-engineer.
2. Sulit dicari secara global.
3. Sulit dibandingkan antar versi.
4. Sulit disimulasikan.
5. Sulit diaudit.
6. Sulit dirollback tanpa redeploy aplikasi.

### 2.2 Banyak Aplikasi Membutuhkan Policy yang Konsisten

Jika ada banyak service:

```text
case-service
appeal-service
document-service
report-service
workflow-service
notification-service
admin-service
```

lalu semuanya perlu policy yang sama, external PDP dapat membantu menghindari duplikasi.

Tetapi tetap hati-hati:

```text
centralized policy != centralized enforcement
```

Setiap service masih harus menjadi PEP pada boundary-nya masing-masing.

### 2.3 Butuh Explainability dan Policy Audit

External policy engine biasanya lebih cocok untuk:

1. Policy versioning.
2. Policy testing.
3. Policy bundle.
4. Decision log.
5. Policy diff.
6. Policy review.
7. Simulation.
8. Governance.

Dalam regulatory system, pertanyaan audit sering berbentuk:

```text
Pada 2026-03-10 14:23:11, kenapa user A bisa approve case B?
```

Jawaban yang kuat membutuhkan:

1. Policy version.
2. Subject snapshot.
3. Resource snapshot.
4. Context snapshot.
5. Decision reason.
6. Policy evidence.
7. Enforcement point.

External engine dapat membantu, tetapi hanya jika Java PEP mengirim dan menyimpan evidence dengan benar.

### 2.4 Butuh Multi-Model Authorization

Beberapa organisasi tidak cukup dengan satu model:

```text
RBAC  : role grants broad capability
ABAC  : attributes narrow decision
ReBAC : relationship grants object access
ACL   : special object-level exception
PBAC  : policy combines everything
```

External policy engine bisa menjadi tempat komposisi:

```text
allow if role permits action
and resource.tenant == principal.tenant
and case.assignedOfficer == principal.id
and case.state in ["DRAFT", "RETURNED"]
and not principal.id == case.submittedBy
```

### 2.5 Butuh Policy Simulation Sebelum Enforce

External policy dapat dijalankan dalam mode:

1. **Shadow decision**: policy baru dievaluasi tetapi belum dipakai untuk deny.
2. **Decision diff**: bandingkan policy lama vs baru.
3. **Canary policy**: apply hanya sebagian tenant/service.
4. **Dry-run**: audit-only.
5. **Replay historical requests**: uji policy baru terhadap decision lama.

Ini sulit jika authorization tersebar dalam kode Java tanpa decision abstraction.

---

## 3. Kapan External Policy Engine Tidak Layak Dipakai

External policy engine bukan default terbaik untuk semua aplikasi.

### 3.1 Domain Masih Kecil dan Stabil

Jika rule sederhana:

```text
Only owner can edit draft.
Only admin can manage users.
Published documents are read-only.
```

maka internal policy service Java mungkin lebih jelas, cepat, dan mudah dioperasikan.

### 3.2 Team Belum Punya Discipline Policy Lifecycle

External policy engine butuh kemampuan baru:

1. Policy review.
2. Policy testing.
3. Policy deployment.
4. Bundle management.
5. Schema versioning.
6. PDP observability.
7. Decision log retention.
8. Rollback procedure.
9. Incident handling.

Tanpa ini, policy engine menjadi konfigurasi production yang bisa mengubah security posture tanpa kontrol memadai.

### 3.3 Input Authorization Tidak Stabil

Jika aplikasi belum mampu mendefinisikan:

1. Principal model.
2. Resource model.
3. Action vocabulary.
4. Attribute source.
5. Tenant context.
6. Relationship source.

maka external PDP hanya menerima input kacau dan menghasilkan keputusan yang terlihat formal tetapi salah.

Garbage in, policy out.

### 3.4 Latency Budget Sangat Ketat

Remote PDP menambah:

1. Network hop.
2. Serialization overhead.
3. TLS/mTLS overhead.
4. Retry complexity.
5. Circuit breaker behavior.
6. Tail latency.

Untuk hot path dengan ribuan decision per request, remote PDP bisa terlalu mahal kecuali ada bulk API, local cache, atau embedded/sidecar model.

### 3.5 Policy Membutuhkan Banyak Data Lookup Per Decision

Jika setiap decision butuh:

```text
user memberships
org hierarchy
case assignment
delegation state
tenant config
risk score
active session factor
resource classification
```

maka pertanyaan penting adalah:

```text
Apakah PDP mengambil data sendiri, atau Java service mengirim semua data?
```

Keduanya punya trade-off besar.

---

## 4. Integration Topology

Ada empat topology utama.

---

## 4.1 Embedded Policy Engine

Policy engine berjalan di dalam JVM process.

```text
Java Service
  ├── Controller
  ├── Service
  ├── Authorization PEP
  └── Embedded Policy Engine
```

### Keunggulan

1. Latency rendah.
2. Tidak ada network failure.
3. Mudah dipakai untuk unit/integration test.
4. Cocok untuk single service atau policy yang relatif kecil.
5. Lebih mudah fail-closed karena engine lokal.

### Kelemahan

1. Policy update biasanya butuh reload aplikasi atau dynamic loader.
2. Memory footprint per service.
3. Policy version drift antar service jika deployment tidak disiplin.
4. Bahasa engine harus punya binding JVM yang matang.
5. Governance dan centralized decision log lebih sulit.

### Cocok Untuk

1. Library authorization internal.
2. Monolith modular.
3. Low-latency service.
4. Batch authorization lokal.
5. Offline policy evaluation.

---

## 4.2 Sidecar PDP

Policy engine berjalan sebagai process/container sidecar di pod yang sama.

```text
Pod
 ├── Java App Container
 └── Policy Engine Sidecar
```

Java app memanggil `localhost`.

### Keunggulan

1. Network hop pendek.
2. Isolasi policy runtime dari JVM.
3. Bundle policy bisa dikelola sidecar.
4. Tidak perlu library engine di Java.
5. Lebih resilient dibanding remote central PDP.

### Kelemahan

1. Operational complexity bertambah.
2. Setiap pod punya PDP sendiri.
3. Bundle sync harus benar.
4. Memory/CPU overhead per pod.
5. Troubleshooting melibatkan dua container.

### Cocok Untuk

1. Kubernetes deployment.
2. OPA sidecar pattern.
3. Service yang butuh low latency tapi externalized policy.
4. Policy bundle yang bisa disinkronkan periodik.

---

## 4.3 Remote Central PDP

Policy engine sebagai service terpusat.

```text
Java Service A ----\
Java Service B ----- Remote PDP
Java Service C ----/
```

### Keunggulan

1. Centralized policy evaluation.
2. Centralized decision log.
3. Policy update mudah dikontrol.
4. Cocok untuk shared authorization service.
5. Governance lebih kuat.

### Kelemahan

1. Network latency.
2. Availability dependency.
3. Blast radius besar jika PDP bermasalah.
4. Rate limiting perlu serius.
5. Caching/invalidation lebih sulit.
6. Tail latency bisa merusak request SLA.

### Cocok Untuk

1. Enterprise shared PDP.
2. Cross-service consistent authorization.
3. Admin policy management terpusat.
4. Moderate-latency business operations.

---

## 4.4 Gateway / Service Mesh External Authorization

Authorization dilakukan di gateway/proxy/service mesh.

```text
Client -> Gateway/Envoy/Istio -> Java Service
                  |
                  v
              External Authz
```

### Keunggulan

1. Konsisten untuk edge traffic.
2. Java service lebih sederhana untuk route-level enforcement.
3. Bisa enforce service-to-service boundary.
4. Cocok untuk coarse-grained authorization.

### Kelemahan

1. Tidak cukup untuk object-level authorization.
2. Proxy tidak tahu domain object setelah request body diproses.
3. Risk of false confidence.
4. Query scoping tetap harus di service/database.
5. Business state authorization sulit di gateway.

### Prinsip Penting

Gateway authorization bagus untuk:

```text
Can this caller reach this endpoint/class of operation?
```

Bukan untuk:

```text
Can this officer approve this specific case in this exact state?
```

---

## 5. OPA Integration Model

OPA adalah general-purpose policy engine. Aplikasi mengirim input JSON ke OPA, OPA mengevaluasi Rego policy, lalu mengembalikan decision.

Secara mental:

```text
Java object -> JSON input -> OPA data/policy -> JSON decision -> Java enforcement
```

### 5.1 Input Shape

Contoh input untuk case approval:

```json
{
  "subject": {
    "id": "user-123",
    "type": "HUMAN_USER",
    "tenant": "agency-a",
    "roles": ["CASE_REVIEWER"],
    "permissions": ["case.approve"],
    "department": "enforcement"
  },
  "action": "case.approve",
  "resource": {
    "type": "case",
    "id": "case-9001",
    "tenant": "agency-a",
    "state": "SUBMITTED",
    "submittedBy": "user-456",
    "assignedReviewer": "user-123",
    "riskLevel": "MEDIUM"
  },
  "context": {
    "channel": "WEB",
    "requestId": "req-abc",
    "time": "2026-06-20T10:15:00Z",
    "mfaLevel": 2
  }
}
```

Top 1% detail: input shape adalah API contract. Jangan desain sebagai dump dari Java object graph.

Buruk:

```text
Serialize whole JPA entity to PDP.
```

Baik:

```text
Build explicit, minimal, stable authorization input DTO.
```

### 5.2 Rego Policy Sketch

```rego
package aceas.authz

default allow := false

allow if {
  input.action == "case.approve"
  input.subject.tenant == input.resource.tenant
  "case.approve" in input.subject.permissions
  input.resource.state == "SUBMITTED"
  input.resource.assignedReviewer == input.subject.id
  input.resource.submittedBy != input.subject.id
}
```

Policy seperti ini menggabungkan:

1. Permission check.
2. Tenant boundary.
3. State guard.
4. Assignment guard.
5. Maker-checker rule.

### 5.3 OPA REST Call from Java 11+

Java 11 punya `java.net.http.HttpClient`.

```java
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public final class OpaClient {
    private final HttpClient httpClient;
    private final URI decisionUri;

    public OpaClient(URI decisionUri) {
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(200))
                .build();
        this.decisionUri = decisionUri;
    }

    public String decideJson(String inputJson) throws IOException, InterruptedException {
        String body = "{\"input\":" + inputJson + "}";

        HttpRequest request = HttpRequest.newBuilder(decisionUri)
                .timeout(Duration.ofMillis(500))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> response = httpClient.send(
                request,
                HttpResponse.BodyHandlers.ofString()
        );

        if (response.statusCode() >= 500) {
            throw new IllegalStateException("OPA server error: " + response.statusCode());
        }
        if (response.statusCode() >= 400) {
            throw new IllegalArgumentException("OPA client error: " + response.statusCode());
        }

        return response.body();
    }
}
```

Catatan Java 8:

1. Tidak ada built-in `HttpClient` modern.
2. Pakai OkHttp/Apache HttpClient/JAX-RS Client.
3. Tetap gunakan timeout pendek.
4. Jangan pakai blocking call tanpa pool/circuit breaker pada high-throughput service.

### 5.4 Jangan Return Boolean Saja

Buruk:

```json
{ "result": true }
```

Lebih baik:

```json
{
  "result": {
    "decision": "ALLOW",
    "reasonCodes": ["TENANT_MATCH", "ASSIGNED_REVIEWER", "MAKER_CHECKER_OK"],
    "policyVersion": "authz-bundle-2026.06.20-001",
    "obligations": [
      { "type": "AUDIT", "level": "HIGH" }
    ]
  }
}
```

Top 1% insight:

> Authorization decision should be operationally useful, not just computationally true.

### 5.5 OPA Bundle Model

OPA bundles memisahkan policy/data deployment dari aplikasi. Bundle biasanya berisi:

```text
/policies/*.rego
/data/*.json
/.manifest
```

Keputusan penting:

1. Bundle versioning.
2. Bundle signing/integrity.
3. Bundle rollback.
4. Partial update behavior.
5. Service compatibility.
6. Stale bundle tolerance.
7. Startup behavior jika bundle tidak tersedia.
8. Decision log menyimpan bundle revision.

### 5.6 OPA Decision Logs

Decision log berguna untuk:

1. Audit.
2. Debugging.
3. Policy tuning.
4. Incident analysis.
5. Shadow decision diff.
6. Regulatory reconstruction.

Tetapi decision log bisa berisi data sensitif. Jangan log full input sembarangan.

Gunakan prinsip:

```text
Log enough to explain, not enough to leak.
```

---

## 6. Cedar-Style Policy Integration

Cedar adalah policy language untuk authorization yang berfokus pada principal, action, resource, context, entity, dan policy. Cedar digunakan oleh Amazon Verified Permissions dan juga tersedia sebagai open-source policy language/SDK.

Mental model Cedar:

```text
permit(
  principal,
  action,
  resource
)
when { context / attributes condition };
```

Cedar cocok untuk fine-grained authorization yang ingin policy-nya readable, analyzable, dan schema-aware.

### 6.1 Cedar Request Shape

Secara konseptual:

```text
principal = User::"user-123"
action    = Action::"case.approve"
resource  = Case::"case-9001"
context   = { mfaLevel: 2, channel: "WEB" }
entities  = graph/attributes of principal/resource/groups/etc.
```

### 6.2 Cedar Policy Sketch

```cedar
permit(
  principal,
  action == Action::"case.approve",
  resource
)
when {
  principal.tenant == resource.tenant &&
  resource.state == "SUBMITTED" &&
  resource.assignedReviewer == principal.id &&
  resource.submittedBy != principal.id &&
  principal has permissions &&
  principal.permissions.contains("case.approve")
};
```

Catatan: sintaks aktual bisa berbeda tergantung schema dan entity model yang digunakan. Yang penting adalah struktur desainnya.

### 6.3 Cedar Strengths

1. Natural untuk principal/action/resource authorization.
2. Mendukung RBAC/ABAC/ReBAC-style modeling.
3. Schema membantu validasi policy.
4. Policies lebih readable untuk review.
5. Cocok untuk centralized policy management.
6. Cocok untuk automated reasoning/policy analysis pada skenario tertentu.

### 6.4 Cedar Integration Options from Java

Ada beberapa opsi:

1. **Amazon Verified Permissions API** dari Java via AWS SDK.
2. **Open-source Cedar Java bindings** jika sesuai maturity/operational need.
3. **Internal service wrapping Cedar engine**.
4. **Hybrid**: internal authorization service memanggil AVP/Cedar hanya untuk subset policy.

### 6.5 Amazon Verified Permissions Style

Dengan managed service, Java app biasanya:

1. Build request principal/action/resource/context.
2. Call AVP `IsAuthorized`/authorization API.
3. Receive allow/deny + determining policies/context.
4. Enforce result.
5. Log decision correlation.

Trade-off:

Keunggulan:

1. Managed PDP.
2. Centralized policy store.
3. Cedar language.
4. Governance lebih formal.
5. Integrasi AWS ecosystem.

Kelemahan:

1. Network dependency.
2. Cost per call.
3. Vendor dependency.
4. Latency consideration.
5. Data residency and privacy consideration.
6. Need careful batching/caching strategy.

---

## 7. Designing the Java Boundary

Baik memakai OPA, Cedar, AVP, atau PDP internal, Java boundary harus stabil.

Jangan biarkan controller langsung tahu detail engine.

Buruk:

```java
boolean allowed = opaClient.query("/v1/data/authz/allow", json);
if (!allowed) throw new AccessDeniedException("Denied");
```

Lebih baik:

```java
AuthorizationDecision decision = authorizationClient.authorize(
        AuthorizationRequest.builder()
                .subject(subject)
                .action(Action.of("case.approve"))
                .resource(caseResource)
                .context(context)
                .build()
);

authorizationEnforcer.enforce(decision);
```

### 7.1 Interface yang Stabil

```java
public interface ExternalAuthorizationClient {
    PolicyDecision decide(AuthorizationRequest request);
}
```

```java
public final class PolicyDecision {
    private final Decision decision;
    private final List<String> reasonCodes;
    private final List<Obligation> obligations;
    private final String policyEngine;
    private final String policyVersion;
    private final String decisionId;
    private final Duration latency;

    public boolean isAllowed() {
        return decision == Decision.ALLOW;
    }
}
```

```java
public enum Decision {
    ALLOW,
    DENY,
    INDETERMINATE
}
```

Jangan treat network failure sebagai deny biasa tanpa membedakan reason.

```text
DENY             = policy evaluated and denied
INDETERMINATE    = no reliable decision could be made
ERROR            = infrastructure/system failure
```

Pada enforcement, biasanya `INDETERMINATE` dan `ERROR` menjadi deny untuk sensitive operation, tetapi audit reason-nya harus berbeda.

---

## 8. Input Schema Design

Input schema adalah kontrak paling penting.

### 8.1 Prinsip Input Schema

Input harus:

1. Explicit.
2. Minimal.
3. Stable.
4. Versioned.
5. Non-ambiguous.
6. Tenant-aware.
7. Context-aware.
8. Auditable.
9. Not raw entity dump.
10. Not client-controlled.

### 8.2 Contoh Java DTO

```java
public final class AuthorizationRequest {
    private final String schemaVersion;
    private final SubjectDescriptor subject;
    private final String action;
    private final ResourceDescriptor resource;
    private final AuthorizationContext context;

    // constructor/getters omitted
}
```

```java
public final class SubjectDescriptor {
    private final String subjectId;
    private final String subjectType;
    private final String tenantId;
    private final Set<String> roles;
    private final Set<String> permissions;
    private final Map<String, Object> attributes;
}
```

```java
public final class ResourceDescriptor {
    private final String resourceType;
    private final String resourceId;
    private final String tenantId;
    private final Map<String, Object> attributes;
}
```

### 8.3 Schema Versioning

Tambahkan `schemaVersion`.

```json
{
  "schemaVersion": "authz-input.v1",
  "subject": {},
  "action": "case.approve",
  "resource": {},
  "context": {}
}
```

Mengapa?

Policy dan aplikasi bisa berubah tidak serentak.

Tanpa schema version:

1. Policy bisa membaca field yang tidak lagi dikirim.
2. Aplikasi bisa mengirim field baru yang policy lama abaikan.
3. Deny/allow bisa berubah diam-diam.
4. Rollback sulit.

### 8.4 Backward-Compatible Evolution

Perubahan aman:

1. Menambah optional field.
2. Menambah reason code baru.
3. Menambah context field yang tidak dipakai policy lama.
4. Menambah action baru dengan default deny.

Perubahan berbahaya:

1. Rename field.
2. Mengubah meaning field.
3. Menghapus field.
4. Mengubah enum value.
5. Mengubah tenant/source semantics.
6. Mengubah default missing attribute behavior.

---

## 9. Output Schema Design

Output sebaiknya bukan cuma allow/deny.

### 9.1 Minimum Output

```json
{
  "decision": "DENY",
  "reasonCodes": ["TENANT_MISMATCH"],
  "policyVersion": "2026.06.20.001",
  "decisionId": "dec-123"
}
```

### 9.2 Rich Output

```json
{
  "decision": "DENY",
  "reasonCodes": ["MAKER_CHECKER_VIOLATION"],
  "obligations": [
    {
      "type": "AUDIT",
      "severity": "HIGH",
      "fields": ["subjectId", "resourceId", "action", "caseState"]
    }
  ],
  "advice": [
    {
      "type": "USER_MESSAGE",
      "code": "approval.notAllowed.submitterCannotApproveOwnCase"
    }
  ],
  "policyEngine": "OPA",
  "policyPackage": "aceas.authz",
  "policyVersion": "bundle-2026.06.20-001",
  "decisionId": "dec-abc",
  "evaluationTimeMs": 3
}
```

### 9.3 Obligations vs Advice

**Obligation** wajib dilakukan agar decision sah.

Contoh:

1. Write audit event.
2. Mask fields.
3. Require step-up authentication.
4. Apply data filter.
5. Add watermark.

**Advice** adalah saran tambahan.

Contoh:

1. User-facing message code.
2. UI hint.
3. Explanation for support.

Rule:

```text
If Java PEP cannot satisfy obligation, operation must not proceed.
```

---

## 10. Attribute Loading: App-Supplied vs PDP-Supplied

Ada dua pola utama.

### 10.1 App-Supplied Attributes

Java service mengambil semua atribut lalu mengirim ke PDP.

```text
Java service -> DB/services -> build input -> PDP
```

Keunggulan:

1. PDP stateless.
2. Policy evaluation cepat.
3. Java service tahu domain source.
4. Lebih mudah kontrol transaction consistency.

Kelemahan:

1. Input bisa besar.
2. Duplikasi attribute loading antar service.
3. Java service harus tahu semua attribute yang dibutuhkan policy.
4. Policy update bisa membutuhkan aplikasi mengirim field baru.

Cocok untuk:

1. Domain-specific authorization.
2. Object-level checks.
3. Transaction-aware checks.
4. Low operational complexity.

### 10.2 PDP-Supplied Attributes

PDP/PIP mengambil atribut sendiri dari directory/database/service.

```text
Java service -> PDP -> PIP/data sources
```

Keunggulan:

1. Java service lebih sederhana.
2. Policy bisa berubah tanpa mengubah aplikasi untuk beberapa attribute.
3. Centralized attribute source.

Kelemahan:

1. PDP menjadi stateful/complex.
2. Latency bertambah.
3. Availability dependency bertambah.
4. Data freshness sulit.
5. Transaction consistency sulit.
6. PDP bisa menjadi mini-monolith.

Cocok untuk:

1. Enterprise entitlement lookup.
2. Directory/group membership.
3. Low-frequency decisions.
4. Central access management.

### 10.3 Hybrid Pattern

Paling umum di sistem serius:

1. Java app mengirim resource/action/context yang domain-specific.
2. PDP punya policy dan sebagian reference data.
3. Directory/role/relationship bisa disinkronkan sebagai bundle/cache.
4. Hot attributes dikirim dari app.
5. Slow global attributes diambil dari PDP data.

---

## 11. Failure Mode Design

External policy engine menambah failure mode baru.

### 11.1 Failure Types

1. PDP unavailable.
2. PDP timeout.
3. PDP returns 5xx.
4. PDP returns malformed response.
5. Policy bundle missing.
6. Policy parse error.
7. Policy version incompatible.
8. Attribute missing.
9. Data stale.
10. Decision log sink unavailable.
11. Network partition.
12. TLS/mTLS failure.
13. Rate limit exceeded.
14. Circuit breaker open.

### 11.2 Fail-Closed by Default

Untuk sensitive operation:

```text
No decision = no access
```

Contoh:

1. Approve case.
2. Export report.
3. Download confidential document.
4. Change role.
5. Break-glass access.
6. Cross-tenant support access.
7. Payment/refund/revenue action.

### 11.3 Limited Fail-Open Cases

Fail-open hanya boleh untuk carefully selected low-risk read/availability paths.

Contoh yang mungkin:

1. Static public content.
2. Health check internal yang tidak mengungkap data sensitif.
3. Non-sensitive feature flag display.

Tetapi fail-open harus eksplisit:

```text
Action: catalog.readPublic
Risk: low
Fallback: allow only public resources
Audit: yes
Timeout: 200ms
Expiry: no more than 5 minutes
```

### 11.4 Circuit Breaker Semantics

Jika remote PDP timeout terus-menerus, circuit breaker bisa open.

Penting:

```text
Circuit breaker open is not authorization allow.
```

Mapping yang aman:

```text
PDP timeout          -> INDETERMINATE -> deny for sensitive action
Circuit breaker open -> INDETERMINATE -> deny for sensitive action
Malformed decision   -> ERROR         -> deny
Policy not loaded    -> ERROR         -> deny
```

### 11.5 Timeout Budget

Jangan biarkan authorization call menghabiskan request SLA.

Contoh:

```text
Overall request SLA: 1000ms
DB operation:        300ms
Business logic:      200ms
External calls:      200ms
Authorization PDP:   50ms p95 / 150ms max
Remaining buffer:    150ms
```

Timeout harus pendek dan eksplisit.

---

## 12. Latency and Performance Patterns

### 12.1 Single Decision

Untuk operasi command:

```text
POST /cases/{id}/approve
```

single decision biasanya cukup.

### 12.2 Bulk Decision

Untuk list/search:

```text
GET /cases
```

jangan panggil PDP per row.

Buruk:

```text
100 rows -> 100 PDP calls
```

Lebih baik:

1. Query scoping di database.
2. Bulk authorize resource refs.
3. Materialized access table.
4. PDP returns predicate/filter.
5. Precomputed relationship/permission expansion.

### 12.3 Decision Cache

Decision cache bisa aman hanya jika cache key lengkap.

Minimal key:

```text
subjectId
action
resourceType
resourceId
tenantId
policyVersion
subjectEntitlementVersion
resourceAuthzVersion
contextHash
```

Jika context seperti MFA, risk, time window, acting role, delegation berubah, cache key harus berubah.

### 12.4 Policy Cache vs Decision Cache

Policy cache:

```text
Cache policy bundle/data locally.
```

Decision cache:

```text
Cache result of a decision.
```

Policy cache biasanya lebih aman daripada decision cache karena revocation semantics lebih mudah dikontrol.

### 12.5 Local Fallback Policy

Untuk remote PDP, bisa ada fallback local policy.

Tetapi fallback tidak boleh lebih permisif daripada policy utama kecuali risk accepted.

Aman:

```text
remote unavailable -> use local emergency deny-list / deny all sensitive operations
```

Berbahaya:

```text
remote unavailable -> assume previous allow still valid for all actions
```

---

## 13. Security Boundary and Trust Model

### 13.1 Java PEP Must Not Trust Client Claims

Jika request body berisi:

```json
{
  "tenantId": "agency-a",
  "role": "ADMIN"
}
```

jangan kirim langsung ke PDP sebagai subject attribute.

Subject attributes harus berasal dari trusted source:

1. Authenticated session/security context.
2. Token claims yang sudah divalidasi dan mapped.
3. Server-side entitlement store.
4. Directory service.
5. Delegation record.

### 13.2 Resource Attributes Must Be Server-Loaded

Resource tenant/state/owner tidak boleh diambil dari client body.

Buruk:

```java
ResourceDescriptor resource = new ResourceDescriptor(
    request.getCaseId(),
    request.getTenantId(),
    request.getState()
);
```

Baik:

```java
CaseFile caseFile = caseRepository.getRequired(caseId);
ResourceDescriptor resource = ResourceDescriptor.from(caseFile);
```

### 13.3 PDP Authentication

Java service ke PDP harus authenticated.

Options:

1. mTLS.
2. Service account token.
3. IAM-signed request.
4. Kubernetes service identity.
5. Private network + mTLS.

Jangan expose PDP publik tanpa strong authentication.

### 13.4 PDP Authorization

PDP sendiri butuh authorization.

Tidak semua service boleh query semua policy/data.

Contoh:

```text
case-service may query case policies
report-service may query report policies
admin-service may query policy simulation API
```

### 13.5 Policy Administration Security

PAP lebih sensitif dari PDP.

Siapa yang bisa mengubah policy punya kekuatan mengubah security posture production.

Policy admin harus punya:

1. Strong authentication.
2. Strong authorization.
3. Approval workflow.
4. Separation of duties.
5. Policy test gate.
6. Audit trail.
7. Rollback capability.
8. Change reason.

---

## 14. Policy Versioning and Deployment

### 14.1 Policy Version Must Be Visible

Every decision should know:

```text
policyEngine
policyPackage
policyVersion
schemaVersion
dataVersion
```

Tanpa ini, audit historis rapuh.

### 14.2 Deployment Pipeline

Pipeline ideal:

```text
Policy PR
  -> syntax validation
  -> schema validation
  -> unit tests
  -> golden decision tests
  -> regression tests
  -> security review
  -> approval
  -> package bundle
  -> sign bundle
  -> deploy to staging
  -> shadow run
  -> canary
  -> production rollout
  -> monitor decision diff
```

### 14.3 Golden Decision Tests

Golden test adalah pasangan input-output yang dianggap kontrak.

```json
{
  "name": "reviewer can approve assigned submitted case",
  "input": { ... },
  "expectedDecision": "ALLOW",
  "expectedReasons": ["ASSIGNED_REVIEWER", "STATE_OK"]
}
```

Gunanya:

1. Mencegah policy regression.
2. Dokumentasi executable.
3. Review policy lebih aman.
4. Membantu migration.

### 14.4 Shadow Mode

Java service mengevaluasi dua decision:

```text
current enforced policy -> used for access
candidate policy        -> logged only
```

Decision diff:

```text
current=ALLOW, candidate=DENY
current=DENY,  candidate=ALLOW
```

Diff harus dianalisis sebelum enforcement.

### 14.5 Rollback

Rollback bukan hanya redeploy policy lama.

Periksa:

1. Apakah input schema kompatibel?
2. Apakah data bundle lama masih tersedia?
3. Apakah application version sudah berubah?
4. Apakah policy data migration reversible?
5. Apakah decision cache perlu invalidasi?
6. Apakah audit harus menandai rollback?

---

## 15. Observability

External policy engine harus observable seperti dependency kritikal.

### 15.1 Metrics

Minimal metrics:

```text
authz_decision_total{decision,action,resource_type,tenant}
authz_decision_latency_ms{engine,policy_package}
authz_pdp_error_total{error_type}
authz_pdp_timeout_total
authz_pdp_circuit_open_total
authz_policy_version_active
authz_bundle_age_seconds
authz_cache_hit_total
authz_cache_miss_total
authz_decision_diff_total{old,new}
```

### 15.2 Logs

Decision log should include:

1. Request ID.
2. Subject ID or pseudonymized ID.
3. Action.
4. Resource type.
5. Resource ID where safe.
6. Tenant.
7. Decision.
8. Reason codes.
9. Policy version.
10. Latency.
11. PEP location.
12. Error type if any.

### 15.3 Tracing

Trace span:

```text
HTTP request
  -> load resource
  -> build authz input
  -> PDP call
  -> enforce decision
  -> domain operation
```

Attributes:

```text
authz.engine=opa
authz.decision=deny
authz.action=case.approve
authz.resource_type=case
authz.policy_version=bundle-...
```

Jangan simpan full sensitive input di trace.

---

## 16. Spring Security Integration Pattern

External PDP dapat dibungkus sebagai `AuthorizationManager`.

### 16.1 Request AuthorizationManager

```java
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

import java.util.function.Supplier;

public final class ExternalPdpRequestAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final ExternalAuthorizationClient client;
    private final AuthorizationInputFactory inputFactory;

    public ExternalPdpRequestAuthorizationManager(
            ExternalAuthorizationClient client,
            AuthorizationInputFactory inputFactory
    ) {
        this.client = client;
        this.inputFactory = inputFactory;
    }

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authentication,
            RequestAuthorizationContext context
    ) {
        AuthorizationRequest request = inputFactory.fromHttpRequest(
                authentication.get(),
                context.getRequest()
        );

        PolicyDecision decision = client.decide(request);
        return new AuthorizationDecision(decision.isAllowed());
    }
}
```

Catatan:

1. Request-level manager cocok untuk coarse-grained endpoint checks.
2. Jangan gunakan ini sebagai satu-satunya object-level enforcement.
3. Untuk object-level decision, gunakan service/domain-level authorization.

### 16.2 Method Security Bridge

```java
public final class CaseAuthorizationFacade {
    private final ExternalAuthorizationClient client;

    public boolean canApprove(Authentication authentication, CaseFile caseFile) {
        AuthorizationRequest request = AuthorizationRequestFactory.forCaseApproval(
                authentication,
                caseFile
        );
        return client.decide(request).isAllowed();
    }
}
```

Dipakai di method security:

```java
@PreAuthorize("@caseAuthorizationFacade.canApprove(authentication, #caseFile)")
public void approve(CaseFile caseFile) {
    // still enforce in service if this method can be reached from non-proxied path
}
```

Lebih explicit:

```java
public void approve(String caseId) {
    CaseFile caseFile = caseRepository.getRequired(caseId);
    authorizationService.authorizeApprove(currentSubject(), caseFile);
    caseFile.approve(currentSubject().id());
}
```

---

## 17. Java 8–25 Considerations

### 17.1 Java 8

Constraints:

1. No built-in modern HTTP client.
2. No records.
3. No sealed classes.
4. No virtual threads.
5. More boilerplate DTO.

Recommendation:

1. Use immutable final classes.
2. Use builder carefully.
3. Use explicit DTO mapping.
4. Use mature HTTP client.
5. Keep PDP calls bounded with timeout.

### 17.2 Java 11+

Useful:

1. Built-in `HttpClient`.
2. Better TLS support baseline.
3. Easier async call with `CompletableFuture`.

### 17.3 Java 17+

Useful:

1. Records for immutable DTO.
2. Sealed interfaces/classes for decision/result hierarchy.
3. Pattern matching improvements in later versions.

Example:

```java
public record AuthorizationRequest(
        String schemaVersion,
        SubjectDescriptor subject,
        String action,
        ResourceDescriptor resource,
        AuthorizationContext context
) {}
```

### 17.4 Java 21+

Virtual threads can make blocking PDP calls cheaper per thread, but they do not make remote PDP latency disappear.

Important:

```text
Virtual threads improve concurrency model, not authorization correctness.
```

Still need:

1. Timeout.
2. Circuit breaker.
3. Bulk decision.
4. Cache.
5. Rate limit.
6. Backpressure.

### 17.5 Java 25

For authorization integration, Java 25 does not fundamentally change PDP design. Treat newer language/runtime features as implementation ergonomics, not security model changes.

---

## 18. End-to-End Example: Case Approval with External PDP

### 18.1 Domain Operation

```java
public final class CaseApprovalService {
    private final CaseRepository caseRepository;
    private final AuthorizationService authorizationService;
    private final AuditPublisher auditPublisher;

    public void approve(String caseId, Subject subject) {
        CaseFile caseFile = caseRepository.getRequired(caseId);

        PolicyDecision decision = authorizationService.authorize(
                AuthorizationRequests.caseApprove(subject, caseFile)
        );

        if (!decision.isAllowed()) {
            auditPublisher.authorizationDenied(subject, caseFile, decision);
            throw new AccessDeniedException("case.approve denied: " + decision.safeReasonCode());
        }

        enforceObligations(decision, subject, caseFile);

        caseFile.approveBy(subject.id());
        caseRepository.save(caseFile);

        auditPublisher.authorizationAllowed(subject, caseFile, decision);
    }

    private void enforceObligations(PolicyDecision decision, Subject subject, CaseFile caseFile) {
        for (Obligation obligation : decision.obligations()) {
            if (!obligation.isSupported()) {
                throw new AccessDeniedException("Unsupported authorization obligation");
            }
            obligation.execute(subject, caseFile);
        }
    }
}
```

### 18.2 Authorization Service

```java
public final class AuthorizationService {
    private final ExternalAuthorizationClient client;
    private final AuthorizationDecisionCache cache;
    private final AuthorizationFailureMapper failureMapper;

    public PolicyDecision authorize(AuthorizationRequest request) {
        CacheKey key = CacheKey.from(request);

        PolicyDecision cached = cache.getIfPresent(key);
        if (cached != null && cached.isCacheable()) {
            return cached;
        }

        try {
            PolicyDecision decision = client.decide(request);
            if (decision.isCacheable()) {
                cache.put(key, decision);
            }
            return decision;
        } catch (Exception ex) {
            return failureMapper.toIndeterminate(request, ex);
        }
    }
}
```

### 18.3 Failure Mapper

```java
public final class AuthorizationFailureMapper {
    public PolicyDecision toIndeterminate(AuthorizationRequest request, Exception ex) {
        return PolicyDecision.indeterminate(
                "PDP_UNAVAILABLE",
                "No reliable authorization decision could be obtained"
        );
    }
}
```

PEP then maps `INDETERMINATE` to deny for sensitive action.

---

## 19. Common Mistakes

### 19.1 Treating External PDP as Gateway Only

Endpoint-level allow does not prove object-level allow.

```text
Allowed to call /cases/{id}/approve
```

is not the same as:

```text
Allowed to approve case-9001
```

### 19.2 Sending Raw JWT Claims as Policy Truth

JWT claims can be stale or overbroad.

Treat token as evidence, then map to internal authorization model.

### 19.3 Missing Tenant in Input

If tenant is not in input, policy cannot enforce tenant boundary.

### 19.4 Missing Resource State

If state is not in input, policy cannot enforce workflow guard.

### 19.5 No Policy Version in Audit

Without policy version, historical reconstruction is weak.

### 19.6 No Timeout

PDP call without timeout can cascade failure across system.

### 19.7 Retrying Deny

Retry only infrastructure error, not policy deny.

### 19.8 Caching Allow Too Long

Permission revocation becomes ineffective.

### 19.9 Using Full Entity Serialization

Leads to leakage, unstable schema, lazy-loading traps, huge payloads, and hidden coupling.

### 19.10 Policy Admin Without Review

A policy change can be more dangerous than a code change.

---

## 20. Decision Matrix: OPA vs Cedar-style vs Internal PDP

| Dimension | OPA/Rego | Cedar-style | Internal PDP |
|---|---|---|---|
| General policy flexibility | Very high | High but authorization-focused | Depends on implementation |
| Readability for authorization | Medium to high | High | Depends |
| Schema validation | Possible, not always central | Strong design focus | Custom |
| Java integration | REST/sidecar/common | SDK/service/AVP | Native |
| Operational maturity | Strong ecosystem | Growing/managed options | Your burden |
| Best for | General policy, infra/app authz | Fine-grained app authz | Domain-specific control |
| Risk | Rego complexity, data modeling | Vendor/SDK maturity choices | Reinventing policy engine |
| Auditability | Good if decision logs configured | Good if schema/policy governance used | Must build yourself |

---

## 21. Production Readiness Checklist

Sebelum external policy engine digunakan untuk production enforcement:

### 21.1 Design

- [ ] Action vocabulary stabil.
- [ ] Resource type model stabil.
- [ ] Subject model jelas.
- [ ] Tenant boundary eksplisit.
- [ ] Context field jelas.
- [ ] Input schema versioned.
- [ ] Output schema versioned.
- [ ] Deny-by-default.
- [ ] Indeterminate behavior jelas.
- [ ] Obligation handling jelas.

### 21.2 Security

- [ ] PDP authenticated.
- [ ] PDP authorized.
- [ ] PAP protected.
- [ ] Policy change requires approval.
- [ ] Policy artifact integrity checked.
- [ ] No client-controlled subject/resource attributes.
- [ ] Sensitive input redacted in logs.
- [ ] Break-glass policy separately controlled.

### 21.3 Reliability

- [ ] Timeout configured.
- [ ] Circuit breaker configured.
- [ ] Retry only for safe infra errors.
- [ ] Bulk API considered.
- [ ] Cache key correctness reviewed.
- [ ] Revocation delay documented.
- [ ] Fallback behavior risk-approved.
- [ ] Bundle stale detection exists.

### 21.4 Testing

- [ ] Policy unit tests.
- [ ] Golden decision tests.
- [ ] Schema compatibility tests.
- [ ] Decision diff tests.
- [ ] Integration tests from Java PEP to PDP.
- [ ] Negative authorization tests.
- [ ] Tenant isolation tests.
- [ ] Object-level authorization tests.
- [ ] Failure-mode tests.

### 21.5 Operations

- [ ] Metrics exported.
- [ ] Decision log available.
- [ ] Policy version visible.
- [ ] Dashboard exists.
- [ ] Alert for PDP error/timeout.
- [ ] Alert for stale bundle.
- [ ] Rollback procedure tested.
- [ ] Incident runbook written.

---

## 22. Top 1% Engineering Heuristics

1. **Externalize policy only after you can model the decision precisely.**
2. **The input schema is more important than the engine choice.**
3. **Never confuse route authorization with object authorization.**
4. **Remote PDP failure is a security event, not just an availability event.**
5. **Policy version must appear in decision audit.**
6. **Schema compatibility is part of security compatibility.**
7. **Policy admin needs stronger governance than normal feature config.**
8. **Cache policy more readily than decisions.**
9. **Do not serialize domain entities to the PDP. Build explicit authorization DTOs.**
10. **A deny without reason is operationally weak; an allow without evidence is audit-weak.**
11. **PDP should make decisions; PEP must enforce them.**
12. **If Java cannot satisfy obligations, it must not proceed.**
13. **External policy engine is a dependency: monitor it like database/payment gateway.**
14. **Shadow mode is the safest way to migrate policy.**
15. **The best policy engine cannot fix a missing resource load or wrong tenant context.**

---

## 23. Summary

External policy engine integration is not about moving `if` statements out of Java. It is about building a disciplined authorization decision platform where:

1. Java services act as precise PEPs.
2. Policy engine acts as PDP.
3. Policy input/output schemas are stable and versioned.
4. Policy changes are tested, reviewed, deployed, and audited.
5. Failure modes are explicit.
6. Decision logs support reconstruction.
7. Caching and performance do not violate revocation/correctness.
8. Object-level and data-level authorization remain enforced by the application and query layer.

The maturity jump is this:

```text
Junior model:
"Call OPA/Cedar and check true/false."

Senior model:
"Define a versioned authorization contract, enforce safely, observe decisions, govern policy lifecycle, and design failure semantics."

Top 1% model:
"Treat authorization as a distributed decision system with security invariants, explainability, evolution constraints, and operational failure modes."
```

---

## 24. Referensi

1. Open Policy Agent, REST API Reference — https://openpolicyagent.org/docs/rest-api
2. Open Policy Agent, Bundles — https://openpolicyagent.org/docs/management-bundles
3. Open Policy Agent, HTTP API Authorization tutorial — https://openpolicyagent.org/docs/http-api-authorization.html
4. Cedar Policy Language Reference — https://docs.cedarpolicy.com/
5. Cedar Authorization Reference — https://docs.cedarpolicy.com/auth/authorization.html
6. Cedar Java Bindings — https://github.com/cedar-policy/cedar-java
7. Amazon Verified Permissions Documentation — https://docs.aws.amazon.com/verifiedpermissions/
8. AWS Verified Permissions overview — https://aws.amazon.com/verified-permissions/
9. Spring Security Authorization Architecture — https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html
10. OWASP Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
11. OWASP Logging Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
12. NIST RBAC Project — https://csrc.nist.gov/projects/role-based-access-control

---

## 25. Status Seri

Selesai:

- [x] Part 0 — Authorization Mental Model
- [x] Part 1 — Authorization Vocabulary, Semantics, and Invariants
- [x] Part 2 — Java Platform Authorization Primitives
- [x] Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
- [x] Part 4 — RBAC Done Properly
- [x] Part 5 — Permission and Capability Modeling
- [x] Part 6 — ABAC
- [x] Part 7 — PBAC and Policy-as-Code
- [x] Part 8 — ReBAC
- [x] Part 9 — ACL and Domain Object Security
- [x] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
- [x] Part 11 — IDOR, BOLA, and Object-Level Authorization
- [x] Part 12 — Authorization in Layered Java Applications
- [x] Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
- [x] Part 14 — Spring Method Security: Service-Level Authorization
- [x] Part 15 — Spring Domain Authorization Patterns
- [x] Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization
- [x] Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging
- [x] Part 18 — Data-Level Authorization and Query Scoping
- [x] Part 19 — Workflow, State Machine, and Case Management Authorization
- [x] Part 20 — Delegation, Impersonation, Acting Roles, and Break-Glass Access
- [x] Part 21 — Hierarchical Organizations and Complex Role Resolution
- [x] Part 22 — Temporal, Risk-Based, and Contextual Authorization
- [x] Part 23 — Authorization for Microservices and Distributed Systems
- [x] Part 24 — Token Scopes, Claims, and Authorization Boundaries
- [x] Part 25 — Authorization Caching, Performance, and Scalability
- [x] Part 26 — Authorization Failure Semantics and Error Handling
- [x] Part 27 — Auditability, Explainability, and Regulatory Defensibility
- [x] Part 28 — Secure Authorization Testing Strategy
- [x] Part 29 — Authorization Anti-Patterns and Failure Modes
- [x] Part 30 — Designing an Authorization Domain Model in Java
- [x] Part 31 — Building an Internal Authorization Service
- [x] Part 32 — External Policy Engine Integration from Java

Berikutnya:

- [ ] Part 33 — Authorization Migration and Refactoring Legacy Systems
- [ ] Part 34 — Top 1% Authorization Engineering Playbook

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-031.md">⬅️ Part 31 — Building an Internal Authorization Service</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-033.md">Part 33 — Authorization Migration and Refactoring Legacy Systems ➡️</a>
</div>
