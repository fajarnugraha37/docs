# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-029.md

# Part 029 — Domain Case Study: IAM, Entitlements, Policy, and Access Graph

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Audiens: Java software engineer / tech lead  
> Fokus: Identity & Access Management, Entitlements, Policy, Access Review, Toxic Combination, Blast Radius, Auditability  
> Status seri: Part 029 dari 032  
> Prasyarat: Part 000–028, terutama modelling, traversal, Cypher, constraints, performance, security, dan GDS fundamentals.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas bagaimana graph database, khususnya Neo4j, dapat dipakai untuk memodelkan dan menganalisis sistem **Identity and Access Management** atau IAM.

IAM sering terlihat seperti problem administrasi biasa:

- user punya role,
- role punya permission,
- permission memberi akses ke resource,
- group berisi user,
- group bisa nested,
- policy memberi allow atau deny,
- approval memberi temporary access.

Tetapi di sistem nyata, struktur ini jarang sederhana.

Contoh:

- seseorang mendapat akses karena menjadi anggota group,
- group tersebut menjadi anggota group lain,
- role diwariskan dari business unit,
- entitlement berasal dari aplikasi legacy,
- permission diberikan lewat exception ticket,
- akses temporary belum dicabut,
- resource berada di hierarchy folder/project/customer/tenant,
- user berpindah department tetapi role lama masih melekat,
- service account punya akses lebih luas daripada user manusia,
- admin role memberi akses ke policy yang dapat menaikkan privilege dirinya sendiri.

Ini bukan sekadar masalah tabel. Ini masalah **jalur akses**.

Pertanyaan IAM yang penting biasanya berbentuk graph:

```text
Siapa bisa mengakses resource ini, lewat jalur apa, dan apakah jalur itu masih valid?
```

Atau:

```text
Akses apa saja yang dimiliki identity ini, secara langsung maupun inherited?
```

Atau:

```text
Apakah kombinasi akses ini membentuk risiko?
```

Atau:

```text
Jika akun ini kompromi, resource mana saja yang terdampak?
```

Graph database cocok karena IAM adalah domain yang inti nilainya berada pada:

- identity,
- membership,
- inheritance,
- delegation,
- ownership,
- policy,
- exception,
- resource hierarchy,
- temporal validity,
- explanation path.

Namun perlu ditegaskan sejak awal: Neo4j tidak otomatis menjadi authorization engine. Ia bisa menjadi:

1. **IAM analysis graph**,
2. **entitlement review platform**,
3. **policy explainability store**,
4. **access graph projection**,
5. **risk and compliance graph**,
6. **decision-support engine**.

Untuk authorization runtime yang sangat latency-sensitive, graph bisa dipakai dengan hati-hati, biasanya sebagai precomputed entitlement projection, bukan setiap request melakukan traversal liar.

---

## 1. Mental Model: IAM Adalah Graph Inheritance Problem

Model IAM sederhana sering digambarkan seperti ini:

```text
User -> Role -> Permission -> Resource
```

Tetapi enterprise IAM biasanya seperti ini:

```text
User
  -> Group
      -> Parent Group
          -> Role
              -> Entitlement
                  -> Permission
                      -> Action
                          -> Resource
                              -> Parent Resource
                                  -> Tenant
```

Ditambah:

```text
User -> Department -> Business Unit -> Default Role
User -> Temporary Assignment -> Privileged Role
User -> Delegated Access -> Another User's Resource
Service Account -> Application -> Environment -> Secret
Policy -> Condition -> Attribute -> Decision
Ticket -> Approval -> Grant -> Expiry
```

IAM menjadi kompleks karena akses tidak hanya “disimpan”, melainkan **diturunkan**.

Dalam graph terms:

- user adalah node,
- group adalah node,
- role adalah node,
- permission adalah node atau relationship,
- resource adalah node,
- membership adalah relationship,
- assignment adalah relationship,
- grant adalah relationship,
- policy adalah node/subgraph,
- inheritance adalah traversal,
- entitlement explanation adalah path,
- access risk adalah pattern.

Contoh pertanyaan:

```cypher
MATCH path =
  (:User {id: $userId})
  -[:MEMBER_OF|ASSIGNED_TO|INHERITS*1..6]->
  (:Role)
  -[:GRANTS]->
  (:Permission)
  -[:APPLIES_TO]->
  (:Resource {id: $resourceId})
RETURN path;
```

Query di atas bukan final production query, tetapi ia menunjukkan inti mental model: access adalah hasil dari path.

---

## 2. Mengapa IAM Cocok untuk Graph Database

### 2.1 Relationship adalah domain object utama

Dalam IAM, relationship bukan detail teknis. Relationship adalah fakta utama.

Contoh relationship:

```text
(:User)-[:MEMBER_OF]->(:Group)
(:Group)-[:MEMBER_OF]->(:Group)
(:User)-[:ASSIGNED_ROLE]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
(:Permission)-[:ALLOWS]->(:Action)
(:Permission)-[:ON]->(:Resource)
(:Resource)-[:CHILD_OF]->(:Resource)
(:User)-[:OWNS]->(:Resource)
(:User)-[:DELEGATED_TO]->(:User)
(:Ticket)-[:APPROVED]->(:Grant)
(:Grant)-[:ENABLES]->(:Role)
```

Jika relationship ini disimpan sebagai foreign key atau array ID biasa, pertanyaan “kenapa user ini bisa akses resource itu?” menjadi join chain yang sulit dijelaskan.

Dalam graph, jawaban natural-nya adalah path.

### 2.2 IAM membutuhkan explanation

Dalam sistem audit-heavy, jawaban “true/false” tidak cukup.

Pertanyaan auditor:

```text
Kenapa Alice bisa approve payment limit 1M?
```

Jawaban yang defensible:

```text
Alice memiliki akses karena:
Alice -> member of FinanceApproverGroup
FinanceApproverGroup -> assigned role PaymentApproverLevel3
PaymentApproverLevel3 -> grants permission APPROVE_PAYMENT
Permission APPROVE_PAYMENT -> applies to PaymentSystem
Grant dibuat oleh ticket IAM-29381
Ticket disetujui oleh Bob pada 2026-03-10
Grant valid sampai 2026-12-31
```

Ini adalah path + metadata.

### 2.3 IAM membutuhkan impact analysis

Jika group `GlobalAdmins` bocor, resource mana yang terdampak?

Jika role `ReadCustomerPII` salah dikonfigurasi, siapa saja yang mendapat akses?

Jika service account `svc-billing-prod` compromise, secret/API/resource mana yang exposed?

Ini semua adalah traversal.

### 2.4 IAM membutuhkan inherited and indirect access analysis

Akses langsung mudah dihitung.

Akses tidak langsung sulit:

```text
User -> Group A -> Group B -> Group C -> Role X -> Permission Y -> Resource Z
```

Bahkan lebih sulit jika ada:

- deny rule,
- time window,
- tenant boundary,
- environment boundary,
- delegation,
- exception,
- attribute condition,
- policy precedence.

Graph membuat inheritance eksplisit dan queryable.

---

## 3. Jangan Salah: Graph IAM Bukan Pengganti Semua IAM

Graph dapat membantu IAM, tetapi tidak semua fungsi IAM harus dipindahkan ke Neo4j.

### 3.1 Komponen IAM umum

Biasanya enterprise IAM memiliki:

- identity provider,
- authentication,
- directory,
- access request workflow,
- approval workflow,
- provisioning/deprovisioning,
- policy engine,
- privileged access management,
- access review,
- audit reporting,
- SIEM integration,
- resource inventory,
- entitlement catalogue.

Neo4j lebih cocok untuk:

```text
connected entitlement analysis
explanation
risk discovery
review campaign support
blast radius
toxic combination detection
policy graph modelling
access path analysis
identity/resource relationship graph
```

Neo4j kurang cocok jika dipakai langsung sebagai:

```text
password store
session store
OAuth/OIDC provider
ultra-low-latency inline authorization engine tanpa precomputation
directory service replacement penuh
audit log immutable ledger tunggal
```

### 3.2 Authorization runtime vs entitlement analysis

Ada dua workload berbeda:

#### Workload A — Authorization runtime

Pertanyaan:

```text
Apakah user U boleh melakukan action A pada resource R sekarang?
```

Kebutuhan:

- latency rendah,
- deterministic,
- high QPS,
- fail-safe,
- simple answer,
- cached/precomputed,
- strongly controlled semantics.

#### Workload B — Entitlement analysis

Pertanyaan:

```text
Siapa saja punya akses ke sensitive resource ini, lewat jalur apa, sejak kapan, dan apakah ada anomali?
```

Kebutuhan:

- traversal kompleks,
- explanation path,
- audit evidence,
- historical analysis,
- batch review,
- risk scoring,
- graph algorithms.

Neo4j sangat kuat untuk Workload B. Untuk Workload A, Neo4j bisa dipakai, tetapi desain harus ketat:

- query bounded,
- index-backed start point,
- precomputed entitlement edge,
- no unbounded traversal,
- timeout,
- deterministic policy ordering,
- fallback decision jelas,
- decision logs immutable.

---

## 4. Core Domain Model

Kita mulai dari model domain IAM yang cukup realistis.

### 4.1 Identity

Identity adalah subject yang dapat memperoleh akses.

Node types:

```text
:User
:ServiceAccount
:MachineIdentity
:Application
:ExternalPrincipal
:Group
:Department
:Team
:BusinessUnit
```

Contoh properties:

```cypher
(:User {
  id: "usr-1001",
  username: "alice",
  email: "alice@example.com",
  status: "ACTIVE",
  employeeType: "FULL_TIME",
  departmentCode: "FIN",
  managerId: "usr-1000",
  createdAt: datetime("2024-01-10T09:00:00Z")
})
```

Untuk service account:

```cypher
(:ServiceAccount {
  id: "svc-billing-prod",
  name: "billing-prod-service-account",
  ownerTeam: "billing-platform",
  environment: "PROD",
  status: "ACTIVE",
  rotationRequired: true
})
```

### 4.2 Resource

Resource adalah object yang dilindungi.

Node types:

```text
:Application
:System
:Database
:Schema
:Table
:Column
:API
:Endpoint
:File
:Folder
:Bucket
:Secret
:Queue
:Topic
:Tenant
:Project
:Case
:CustomerRecord
```

Untuk IAM graph, resource tidak harus sama granular untuk semua sistem. Ada trade-off:

- resource terlalu coarse: audit lemah,
- resource terlalu granular: graph besar dan traversal mahal.

Contoh:

```cypher
(:Resource:Database {
  id: "db-customer-prod",
  name: "customer-prod",
  classification: "CONFIDENTIAL",
  environment: "PROD",
  dataCategory: "CUSTOMER_PII"
})
```

### 4.3 Role

Role adalah bundle permission atau responsibility.

```cypher
(:Role {
  id: "role-payment-approver-l3",
  name: "Payment Approver Level 3",
  domain: "PAYMENT",
  sensitivity: "HIGH",
  privileged: true
})
```

### 4.4 Permission

Permission dapat dimodelkan sebagai node atau relationship.

Sebagai node:

```cypher
(:Permission {
  id: "perm-approve-payment",
  action: "APPROVE",
  objectType: "PAYMENT",
  level: 3
})
```

Sebagai relationship property:

```cypher
(:Role)-[:ALLOWS {
  action: "APPROVE",
  objectType: "PAYMENT",
  level: 3
}]->(:Resource)
```

Rule praktis:

Gunakan node `:Permission` jika permission:

- direferensikan banyak role,
- perlu metadata,
- perlu approval,
- perlu audit,
- perlu classification,
- perlu dikaitkan ke control,
- perlu review lifecycle.

Gunakan relationship property jika permission sederhana dan tidak berdiri sebagai object domain.

### 4.5 Policy

Policy adalah aturan yang menentukan allow/deny/condition.

```cypher
(:Policy {
  id: "policy-finance-approval-prod",
  effect: "ALLOW",
  priority: 100,
  status: "ACTIVE",
  validFrom: date("2026-01-01"),
  validTo: null
})
```

Policy bisa memiliki subgraph:

```text
(:Policy)-[:HAS_CONDITION]->(:Condition)
(:Condition)-[:CHECKS_ATTRIBUTE]->(:Attribute)
(:Condition)-[:USES_OPERATOR]->(:Operator)
(:Condition)-[:EXPECTS_VALUE]->(:Value)
```

Namun jangan over-engineer policy graph jika semua policy sebenarnya lebih cocok disimpan di dedicated policy engine seperti OPA, Cedar, Zanzibar-style tuple store, atau custom ABAC engine.

Graph cocok untuk:

- policy discovery,
- relationship-based authorization,
- explanation,
- analysis,
- risk detection.

### 4.6 Grant

Grant adalah fakta pemberian akses.

Grant sering lebih baik sebagai node daripada relationship jika punya lifecycle.

```cypher
(:Grant {
  id: "grant-88391",
  sourceSystem: "IGA",
  status: "ACTIVE",
  grantedAt: datetime("2026-02-01T10:00:00Z"),
  expiresAt: datetime("2026-08-01T00:00:00Z"),
  reason: "Quarterly audit remediation exception"
})
```

Relasi:

```text
(:User)-[:HAS_GRANT]->(:Grant)
(:Grant)-[:GRANTS_ROLE]->(:Role)
(:Grant)-[:REQUESTED_IN]->(:Ticket)
(:Grant)-[:APPROVED_BY]->(:User)
(:Grant)-[:APPLIES_TO]->(:Resource)
```

Mengapa `Grant` sebagai node?

Karena grant punya:

- request,
- approval,
- expiry,
- revocation,
- evidence,
- owner,
- source system,
- risk score,
- review result.

Relationship langsung seperti:

```text
(:User)-[:ASSIGNED_ROLE]->(:Role)
```

cukup untuk access sederhana, tetapi kurang kuat untuk audit.

---

## 5. Relationship Catalogue

IAM graph harus punya relationship vocabulary yang disiplin.

Contoh relationship types:

```text
MEMBER_OF
PARENT_OF / CHILD_OF
ASSIGNED_ROLE
INHERITS_ROLE
GRANTS_PERMISSION
ALLOWS_ACTION
DENIES_ACTION
APPLIES_TO
OWNS
MANAGES
DELEGATED_TO
APPROVED_BY
REQUESTED_BY
REQUESTED_IN
VALIDATED_BY
REVOKED_BY
REQUIRES_APPROVAL_FROM
CONFLICTS_WITH
ELEVATES_TO
HAS_ATTRIBUTE
BELONGS_TO_TENANT
RUNS_AS
USES_SECRET
CAN_ASSUME
TRUSTS
```

### 5.1 Direction

Pilih direction berdasarkan traversal utama.

Untuk membership:

```text
(:User)-[:MEMBER_OF]->(:Group)
(:Group)-[:MEMBER_OF]->(:Group)
```

Mengapa dari member ke group?

Karena query umum:

```text
Dari user ini, group apa saja yang dia warisi?
```

Untuk resource hierarchy:

```text
(:Resource)-[:CHILD_OF]->(:Resource)
```

Mengapa child ke parent?

Karena query umum:

```text
Resource ini berada di tenant/project/folder mana?
```

Jika query dominan adalah dari parent ke descendants, bisa pakai:

```text
(:Resource)-[:PARENT_OF]->(:Resource)
```

Atau simpan satu direction saja dan query reverse direction saat perlu.

### 5.2 Relationship property

Properties penting:

```text
sourceSystem
validFrom
validTo
createdAt
createdBy
confidence
reason
ticketId
status
environment
scope
condition
lastSeenAt
```

Contoh:

```cypher
(:User)-[:MEMBER_OF {
  sourceSystem: "Okta",
  validFrom: date("2025-01-10"),
  validTo: null,
  status: "ACTIVE",
  lastSeenAt: datetime("2026-06-20T10:00:00Z")
}]->(:Group)
```

Tetapi hati-hati: relationship properties tidak bisa di-index seperti node properties dalam cara yang sama untuk semua pola akses. Jika lifecycle dan lookup penting, gunakan node reifikasi seperti `:Membership`.

---

## 6. Baseline Graph Schema

Model awal:

```text
(:User)-[:MEMBER_OF]->(:Group)
(:Group)-[:MEMBER_OF]->(:Group)
(:User)-[:ASSIGNED_TO]->(:Role)
(:Group)-[:ASSIGNED_TO]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
(:Permission)-[:ALLOWS]->(:Action)
(:Permission)-[:ON]->(:Resource)
(:Resource)-[:CHILD_OF]->(:Resource)
(:Resource)-[:BELONGS_TO]->(:Tenant)
```

Untuk audit-heavy:

```text
(:User)-[:HAS_GRANT]->(:Grant)
(:Group)-[:HAS_GRANT]->(:Grant)
(:Grant)-[:GRANTS_ROLE]->(:Role)
(:Grant)-[:GRANTS_PERMISSION]->(:Permission)
(:Grant)-[:APPLIES_TO]->(:Resource)
(:Grant)-[:REQUESTED_IN]->(:Ticket)
(:Grant)-[:APPROVED_BY]->(:User)
(:Grant)-[:EVIDENCED_BY]->(:Evidence)
```

Untuk risk:

```text
(:Permission)-[:CONFLICTS_WITH]->(:Permission)
(:Role)-[:CONFLICTS_WITH]->(:Role)
(:User)-[:MANAGED_BY]->(:User)
(:User)-[:OWNS]->(:Resource)
(:ServiceAccount)-[:RUNS_AS]->(:Role)
(:Application)-[:USES_SECRET]->(:Secret)
(:Secret)-[:AUTHORIZES]->(:Resource)
```

---

## 7. Constraints and Indexes

IAM graph harus punya identity uniqueness yang kuat.

Contoh constraints:

```cypher
CREATE CONSTRAINT user_id_unique IF NOT EXISTS
FOR (u:User)
REQUIRE u.id IS UNIQUE;

CREATE CONSTRAINT group_id_unique IF NOT EXISTS
FOR (g:Group)
REQUIRE g.id IS UNIQUE;

CREATE CONSTRAINT role_id_unique IF NOT EXISTS
FOR (r:Role)
REQUIRE r.id IS UNIQUE;

CREATE CONSTRAINT permission_id_unique IF NOT EXISTS
FOR (p:Permission)
REQUIRE p.id IS UNIQUE;

CREATE CONSTRAINT resource_id_unique IF NOT EXISTS
FOR (r:Resource)
REQUIRE r.id IS UNIQUE;

CREATE CONSTRAINT grant_id_unique IF NOT EXISTS
FOR (g:Grant)
REQUIRE g.id IS UNIQUE;
```

Indexes:

```cypher
CREATE INDEX user_status_idx IF NOT EXISTS
FOR (u:User)
ON (u.status);

CREATE INDEX resource_classification_idx IF NOT EXISTS
FOR (r:Resource)
ON (r.classification);

CREATE INDEX grant_status_expiry_idx IF NOT EXISTS
FOR (g:Grant)
ON (g.status, g.expiresAt);

CREATE INDEX role_privileged_idx IF NOT EXISTS
FOR (r:Role)
ON (r.privileged);
```

Prinsip:

- selalu start traversal dari node indexed,
- batasi relationship types,
- batasi depth,
- filter status/time validity sedini mungkin,
- hindari query “semua user ke semua resource” tanpa batch partition.

---

## 8. Query Catalogue

Bagian ini adalah inti. Kita butuh query yang menjawab pertanyaan IAM nyata.

### 8.1 What access does this user have?

```cypher
MATCH (u:User {id: $userId})
MATCH path =
  (u)-[:MEMBER_OF|ASSIGNED_TO|HAS_GRANT*1..5]->(x)
WHERE all(r IN relationships(path) WHERE coalesce(r.status, "ACTIVE") = "ACTIVE")
WITH u, nodes(path)[-1] AS terminal, path
OPTIONAL MATCH (terminal)-[:GRANTS|GRANTS_ROLE|GRANTS_PERMISSION*1..3]->(perm:Permission)
OPTIONAL MATCH (perm)-[:ON]->(res:Resource)
RETURN perm.id AS permissionId,
       perm.action AS action,
       res.id AS resourceId,
       res.classification AS classification,
       path AS accessPath
LIMIT 500;
```

Catatan:

- query ini eksploratif,
- untuk production perlu model pasti,
- jangan gunakan relationship alternation terlalu luas tanpa profiling.

Versi lebih structured:

```cypher
MATCH (u:User {id: $userId})
MATCH groupPath = (u)-[:MEMBER_OF*0..4]->(g)
WHERE u.status = "ACTIVE"
WITH u, collect(DISTINCT g) AS principals
UNWIND principals + [u] AS principal
MATCH (principal)-[:ASSIGNED_TO]->(role:Role)-[:GRANTS]->(perm:Permission)-[:ON]->(res:Resource)
RETURN DISTINCT
  role.id AS roleId,
  perm.id AS permissionId,
  perm.action AS action,
  res.id AS resourceId,
  res.classification AS classification;
```

### 8.2 Why can this user access this resource?

```cypher
MATCH (u:User {id: $userId})
MATCH (res:Resource {id: $resourceId})
MATCH path =
  (u)-[:MEMBER_OF*0..4]->(principal)
  -[:ASSIGNED_TO]->(role:Role)
  -[:GRANTS]->(perm:Permission)
  -[:ON]->(res)
RETURN path
LIMIT 20;
```

Better with action:

```cypher
MATCH (u:User {id: $userId})
MATCH (res:Resource {id: $resourceId})
MATCH path =
  (u)-[:MEMBER_OF*0..4]->(principal)
  -[:ASSIGNED_TO]->(role:Role)
  -[:GRANTS]->(perm:Permission {action: $action})
  -[:ON]->(res)
RETURN path,
       role.name AS role,
       perm.id AS permission
LIMIT 20;
```

### 8.3 Who can access this sensitive resource?

```cypher
MATCH (res:Resource {id: $resourceId})
MATCH (principal)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(:Permission)-[:ON]->(res)
MATCH path = (u:User)-[:MEMBER_OF*0..4]->(principal)
WHERE u.status = "ACTIVE"
RETURN DISTINCT u.id AS userId,
       u.email AS email,
       path AS inheritancePath
LIMIT 1000;
```

### 8.4 Find users with privileged access

```cypher
MATCH (u:User {status: "ACTIVE"})
MATCH (u)-[:MEMBER_OF*0..4]->(principal)
MATCH (principal)-[:ASSIGNED_TO]->(r:Role {privileged: true})
RETURN DISTINCT u.id AS userId,
       u.email AS email,
       collect(DISTINCT r.name) AS privilegedRoles
ORDER BY size(privilegedRoles) DESC;
```

### 8.5 Find toxic combinations

Suppose these role pairs conflict:

```text
PaymentRequester conflicts with PaymentApprover
CustomerDataExporter conflicts with CustomerDataApprover
PolicyAdmin conflicts with SecurityReviewer
```

Model:

```text
(:Role)-[:CONFLICTS_WITH]->(:Role)
```

Query:

```cypher
MATCH (u:User {status: "ACTIVE"})
MATCH (u)-[:MEMBER_OF*0..4]->(principal)
MATCH (principal)-[:ASSIGNED_TO]->(r1:Role)
MATCH (principal2)<-[:MEMBER_OF*0..4]-(u)
MATCH (principal2)-[:ASSIGNED_TO]->(r2:Role)
MATCH (r1)-[:CONFLICTS_WITH]-(r2)
WHERE id(r1) < id(r2)
RETURN DISTINCT u.id AS userId,
       u.email AS email,
       r1.name AS roleA,
       r2.name AS roleB;
```

Better approach:

```cypher
MATCH (u:User {status: "ACTIVE"})
MATCH (u)-[:MEMBER_OF*0..4]->(p)
MATCH (p)-[:ASSIGNED_TO]->(r:Role)
WITH u, collect(DISTINCT r) AS roles
UNWIND roles AS r1
UNWIND roles AS r2
MATCH (r1)-[:CONFLICTS_WITH]-(r2)
WHERE id(r1) < id(r2)
RETURN u.id AS userId,
       u.email AS email,
       collect(DISTINCT [r1.name, r2.name]) AS conflicts;
```

### 8.6 Find orphaned privileged service accounts

```cypher
MATCH (sa:ServiceAccount {status: "ACTIVE"})
WHERE NOT (sa)<-[:OWNS]-(:Team)
MATCH (sa)-[:ASSIGNED_TO]->(r:Role {privileged: true})
RETURN sa.id AS serviceAccount,
       collect(r.name) AS privilegedRoles;
```

### 8.7 Find expired access still effective

```cypher
MATCH (g:Grant)
WHERE g.expiresAt < datetime()
  AND g.status = "ACTIVE"
MATCH path = (subject)-[:HAS_GRANT]->(g)-[:GRANTS_ROLE|GRANTS_PERMISSION]->(x)
RETURN subject.id AS subjectId,
       labels(subject) AS subjectType,
       g.id AS grantId,
       g.expiresAt AS expiredAt,
       path
LIMIT 500;
```

### 8.8 Find access without approval evidence

```cypher
MATCH (g:Grant {status: "ACTIVE"})
WHERE NOT (g)-[:APPROVED_BY]->(:User)
   OR NOT (g)-[:REQUESTED_IN]->(:Ticket)
RETURN g.id AS grantId,
       g.sourceSystem AS sourceSystem,
       g.grantedAt AS grantedAt
ORDER BY g.grantedAt DESC;
```

### 8.9 Find privilege escalation paths

Model:

```text
(:Role)-[:CAN_ASSIGN]->(:Role)
(:Role)-[:CAN_MANAGE]->(:Group)
(:Group)-[:ASSIGNED_TO]->(:Role)
(:Role)-[:CAN_UPDATE_POLICY]->(:Policy)
(:Policy)-[:GRANTS]->(:Role)
```

Query:

```cypher
MATCH (u:User {id: $userId})
MATCH path =
  (u)-[:MEMBER_OF*0..3]->(p)
  -[:ASSIGNED_TO]->(:Role)
  -[:CAN_ASSIGN|CAN_MANAGE|CAN_UPDATE_POLICY*1..4]->
  (target:Role {privileged: true})
RETURN path
LIMIT 20;
```

Caution: privilege escalation graph can explode. Use bounded depth and precise relationship types.

### 8.10 Blast radius of compromised identity

```cypher
MATCH (u:User {id: $userId})
MATCH (u)-[:MEMBER_OF*0..4]->(p)
MATCH (p)-[:ASSIGNED_TO]->(role:Role)-[:GRANTS]->(perm:Permission)-[:ON]->(res:Resource)
RETURN res.classification AS classification,
       count(DISTINCT res) AS resourceCount,
       collect(DISTINCT res.id)[0..20] AS sampleResources
ORDER BY resourceCount DESC;
```

For service account:

```cypher
MATCH (sa:ServiceAccount {id: $serviceAccountId})
MATCH (sa)-[:ASSIGNED_TO|RUNS_AS*1..3]->(role:Role)
MATCH (role)-[:GRANTS]->(perm:Permission)-[:ON]->(res:Resource)
RETURN perm.action AS action,
       res.classification AS classification,
       count(DISTINCT res) AS count;
```

### 8.11 Find users with access outside department boundary

```cypher
MATCH (u:User {status: "ACTIVE"})-[:BELONGS_TO]->(dept:Department)
MATCH (u)-[:MEMBER_OF*0..4]->(p)
MATCH (p)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(:Permission)-[:ON]->(res:Resource)
MATCH (res)-[:OWNED_BY]->(ownerDept:Department)
WHERE dept <> ownerDept
RETURN u.id AS userId,
       dept.code AS userDept,
       ownerDept.code AS resourceOwnerDept,
       count(DISTINCT res) AS resourceCount
ORDER BY resourceCount DESC;
```

### 8.12 Access review campaign

A campaign asks resource owners to review who has access.

```cypher
MATCH (res:Resource {classification: "CONFIDENTIAL"})-[:OWNED_BY]->(owner:User)
MATCH (principal)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(:Permission)-[:ON]->(res)
MATCH (u:User)-[:MEMBER_OF*0..4]->(principal)
WHERE u.status = "ACTIVE"
RETURN owner.id AS reviewerId,
       res.id AS resourceId,
       collect(DISTINCT u.id) AS usersToReview;
```

---

## 9. Modelling RBAC, ABAC, ReBAC, and PBAC

IAM graph sering mencampur beberapa access-control style.

### 9.1 RBAC — Role-Based Access Control

RBAC:

```text
User -> Role -> Permission
```

Graph model:

```text
(:User)-[:ASSIGNED_TO]->(:Role)
(:Group)-[:ASSIGNED_TO]->(:Role)
(:Role)-[:GRANTS]->(:Permission)
```

Cocok jika:

- role stabil,
- permission bisa dibundle,
- audit butuh role explanation,
- organisasi role-centric.

Risiko:

- role explosion,
- stale roles,
- excessive privilege,
- role becomes dumping ground.

### 9.2 ABAC — Attribute-Based Access Control

ABAC:

```text
Allow if subject.department == resource.ownerDepartment
and subject.clearance >= resource.sensitivity
and request.environment == "PROD"
```

Graph model:

```text
(:User)-[:HAS_ATTRIBUTE]->(:Attribute {name, value})
(:Resource)-[:HAS_ATTRIBUTE]->(:Attribute {name, value})
(:Policy)-[:HAS_CONDITION]->(:Condition)
```

Namun ABAC murni kadang lebih cocok di policy engine. Graph berguna untuk:

- relationship-aware attributes,
- policy inventory,
- explainability,
- finding which subjects satisfy policy,
- impact if attribute changes.

### 9.3 ReBAC — Relationship-Based Access Control

ReBAC:

```text
User can access resource if user owns resource,
or user belongs to team that owns project containing resource,
or user's manager approved delegation.
```

Ini paling graph-native.

Model:

```text
(:User)-[:MEMBER_OF]->(:Team)
(:Team)-[:OWNS]->(:Project)
(:Resource)-[:BELONGS_TO]->(:Project)
```

Query:

```cypher
MATCH path =
  (:User {id: $userId})
  -[:MEMBER_OF]->(:Team)
  -[:OWNS]->(:Project)
  <-[:BELONGS_TO]-(:Resource {id: $resourceId})
RETURN path;
```

### 9.4 PBAC — Policy-Based Access Control

PBAC menggabungkan role, attribute, relationship, environment, obligations.

Graph dapat memodelkan policy landscape, tetapi final decision semantics harus jelas.

Pertanyaan penting:

```text
Jika ada allow dan deny, mana menang?
Jika ada dua policy conflicting, priority bagaimana?
Jika inherited access dan explicit deny bertemu, hasilnya apa?
Jika condition tidak bisa dievaluasi, default deny atau allow?
```

Graph menyimpan dan menjelaskan. Decision engine harus deterministic.

---

## 10. Deny, Precedence, and Policy Semantics

Access graph sering gagal bukan karena data kurang, tetapi karena semantics ambigu.

### 10.1 Allow-only model

Sederhana:

```text
Ada path allow => boleh.
Tidak ada path allow => tidak boleh.
```

Cocok untuk banyak entitlement analysis.

### 10.2 Explicit deny

```text
Ada deny path => tidak boleh, walaupun ada allow.
```

Model:

```text
(:Policy {effect: "DENY"})-[:DENIES]->(:Permission)
(:Role)-[:DENIED]->(:Permission)
```

Query:

```cypher
MATCH (u:User {id: $userId})
MATCH (res:Resource {id: $resourceId})
OPTIONAL MATCH allowPath =
  (u)-[:MEMBER_OF*0..4]->(:Group)
  -[:ASSIGNED_TO]->(:Role)
  -[:GRANTS]->(:Permission {action: $action})
  -[:ON]->(res)
OPTIONAL MATCH denyPath =
  (u)-[:MEMBER_OF*0..4]->(:Group)
  -[:ASSIGNED_TO]->(:Role)
  -[:DENIES]->(:Permission {action: $action})
  -[:ON]->(res)
RETURN
  allowPath IS NOT NULL AS hasAllow,
  denyPath IS NOT NULL AS hasDeny,
  CASE
    WHEN denyPath IS NOT NULL THEN false
    WHEN allowPath IS NOT NULL THEN true
    ELSE false
  END AS decision;
```

Namun untuk production, hindari query yang terlalu generic. Precompute effective grants jika perlu.

### 10.3 Priority

Policy priority bisa dimodelkan:

```cypher
(:Policy {effect: "ALLOW", priority: 100})
(:Policy {effect: "DENY", priority: 200})
```

Decision:

```text
highest priority matching policy wins
```

Tetapi ini lebih sulit dijelaskan bila banyak path. Simpan decision log.

---

## 11. Temporal IAM

Access tidak abadi.

Entitlement harus punya waktu:

- grantedAt,
- validFrom,
- expiresAt,
- revokedAt,
- lastSeenAt,
- reviewedAt.

### 11.1 Current-state query

```cypher
MATCH (u:User {id: $userId})-[m:MEMBER_OF]->(g:Group)
WHERE m.validFrom <= date()
  AND (m.validTo IS NULL OR m.validTo > date())
RETURN g;
```

### 11.2 Historical explanation

```cypher
MATCH path =
  (:User {id: $userId})-[rels:MEMBER_OF|ASSIGNED_TO|GRANTS*1..5]->(:Resource {id: $resourceId})
WHERE all(r IN relationships(path)
  WHERE r.validFrom <= date($asOf)
    AND (r.validTo IS NULL OR r.validTo > date($asOf)))
RETURN path;
```

### 11.3 Temporal modelling options

#### Option A — relationship validity properties

```text
(:User)-[:MEMBER_OF {validFrom, validTo}]->(:Group)
```

Good:

- simple,
- traversal natural.

Bad:

- historical versions hard if many changes,
- no index-friendly lifecycle search,
- multiple relationships between same nodes can be confusing.

#### Option B — membership as node

```text
(:User)-[:HAS_MEMBERSHIP]->(:Membership)-[:OF_GROUP]->(:Group)
```

Good:

- membership lifecycle explicit,
- searchable,
- auditable,
- approval/evidence attachable.

Bad:

- longer traversal,
- more graph complexity.

Rule:

Use relationship properties for simple current-state graph. Use reified node for audit-heavy lifecycle.

---

## 12. Multi-Tenancy and Boundary Safety

IAM graph often spans tenants, business units, environments, and legal entities.

### 12.1 Tenant as node

```text
(:User)-[:BELONGS_TO_TENANT]->(:Tenant)
(:Resource)-[:BELONGS_TO_TENANT]->(:Tenant)
(:Group)-[:BELONGS_TO_TENANT]->(:Tenant)
```

Query must enforce tenant boundary:

```cypher
MATCH (u:User {id: $userId})-[:BELONGS_TO_TENANT]->(t:Tenant {id: $tenantId})
MATCH (res:Resource {id: $resourceId})-[:BELONGS_TO_TENANT]->(t)
...
```

### 12.2 Tenant as property

```cypher
(:User {tenantId: "tenant-a"})
```

Good:

- simple,
- indexable,
- easy to filter.

Bad:

- easy to forget filter,
- relationship crossing can leak,
- explanation path may include foreign tenant node if query sloppy.

### 12.3 Separate database per tenant

Good:

- strong isolation,
- easier compliance.

Bad:

- operational overhead,
- cross-tenant analysis hard,
- many databases management cost.

### 12.4 Recommendation

For high-regulatory IAM:

- small number of large tenants: consider database-per-tenant or physical isolation,
- many small tenants: property/node tenant boundary with strict query templates,
- cross-tenant relationship: explicit node and approval.

Never rely only on convention. Enforce tenant filter in repository/query layer.

---

## 13. Security Trimming

Security trimming means query result itself must be filtered according to viewer permission.

Example:

```text
Analyst can search access graph but should only see resources in their department.
```

Naive query:

```cypher
MATCH (u:User)-[:MEMBER_OF*0..4]->(:Group)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(:Permission)-[:ON]->(r:Resource)
RETURN u, r;
```

Risk: analyst sees all users/resources.

Safer pattern:

```cypher
MATCH (viewer:User {id: $viewerId})-[:CAN_VIEW]->(scope:Scope)
MATCH (r:Resource)-[:IN_SCOPE]->(scope)
MATCH (u:User)-[:MEMBER_OF*0..4]->(:Group)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(:Permission)-[:ON]->(r)
RETURN u.id, r.id;
```

Production pattern:

- separate admin graph from user-facing graph,
- use service-level authorization before Neo4j query,
- encode query scope from authenticated principal,
- avoid accepting raw Cypher from UI,
- avoid returning full path if path contains hidden nodes,
- redact path segments when needed.

---

## 14. Access Graph as Projection

Usually Neo4j should not be source-of-truth for every IAM fact.

Sources:

```text
HRIS
IdP
directory
IGA system
PAM system
cloud IAM
database privileges
application ACL
ticketing system
CMDB
data catalogue
resource inventory
SIEM
```

Neo4j stores a **projection**:

```text
source systems -> normalized identity/resource/entitlement graph -> analysis/query/review
```

### 14.1 Projection pipeline

```text
Extract
  -> Normalize identity
  -> Resolve entity
  -> Load nodes
  -> Load relationships/grants
  -> Validate constraints
  -> Compute effective access
  -> Run risk rules
  -> Publish review datasets
```

### 14.2 Idempotency

Use deterministic IDs:

```text
User.id = sourceSystem + ":" + sourceUserId
Group.id = sourceSystem + ":" + sourceGroupId
Grant.id = hash(subjectId, entitlementId, resourceId, sourceSystem)
```

### 14.3 Source conflict

Example:

- HR says Alice inactive,
- Okta says Alice active,
- application says Alice still has admin role.

Do not overwrite blindly. Model source facts:

```text
(:SourceFact)-[:ASSERTS]->(:Membership)
(:SourceFact)-[:FROM_SOURCE]->(:SourceSystem)
```

Or store `sourceSystem` on relationships.

For audit-heavy environment, keep raw source evidence outside graph or in evidence nodes.

---

## 15. Effective Access Materialization

Direct traversal is powerful but may be too expensive for repeated runtime queries.

Materialize:

```text
(:User)-[:EFFECTIVE_ACCESS {
  action,
  source,
  computedAt,
  expiresAt,
  explanationPathHash,
  riskScore
}]->(:Resource)
```

### 15.1 Why materialize?

Use when:

- authorization/runtime query must be low latency,
- access review campaigns need stable snapshot,
- graph traversal is expensive,
- explanation can be computed once,
- report reproducibility matters.

### 15.2 Danger

Materialized effective access can become stale.

Need:

- computedAt,
- source version,
- invalidation,
- rebuild job,
- reconciliation,
- diff,
- confidence/quality status.

### 15.3 Pattern

```text
Raw entitlement graph
  -> compute effective access
  -> write EFFECTIVE_ACCESS edges
  -> serve review/runtime query
  -> store explanation summary
```

Example:

```cypher
MATCH (u:User {status: "ACTIVE"})
MATCH (u)-[:MEMBER_OF*0..4]->(p)
MATCH (p)-[:ASSIGNED_TO]->(:Role)-[:GRANTS]->(perm:Permission)-[:ON]->(res:Resource)
MERGE (u)-[ea:EFFECTIVE_ACCESS {
  action: perm.action,
  resourceId: res.id
}]->(res)
SET ea.computedAt = datetime(),
    ea.permissionId = perm.id;
```

For production, run per user/resource partition, not globally in one huge transaction.

---

## 16. Entitlement Review Workflow

Access review is a common enterprise control.

### 16.1 Objects

```text
ReviewCampaign
ReviewItem
Reviewer
Subject
Resource
AccessPath
Decision
Evidence
```

Model:

```text
(:ReviewCampaign)-[:HAS_ITEM]->(:ReviewItem)
(:ReviewItem)-[:REVIEWS_SUBJECT]->(:User)
(:ReviewItem)-[:REVIEWS_RESOURCE]->(:Resource)
(:ReviewItem)-[:REVIEWS_PERMISSION]->(:Permission)
(:ReviewItem)-[:ASSIGNED_TO_REVIEWER]->(:User)
(:ReviewItem)-[:HAS_DECISION]->(:ReviewDecision)
```

### 16.2 Generate review items

```cypher
MATCH (res:Resource {classification: "CONFIDENTIAL"})<-[:ON]-(perm:Permission)<-[:GRANTS]-(:Role)<-[:ASSIGNED_TO]-(p)
MATCH (u:User)-[:MEMBER_OF*0..4]->(p)
MATCH (res)-[:OWNED_BY]->(owner:User)
MERGE (campaign:ReviewCampaign {id: $campaignId})
CREATE (item:ReviewItem {
  id: randomUUID(),
  status: "PENDING",
  createdAt: datetime()
})
MERGE (campaign)-[:HAS_ITEM]->(item)
MERGE (item)-[:REVIEWS_SUBJECT]->(u)
MERGE (item)-[:REVIEWS_RESOURCE]->(res)
MERGE (item)-[:REVIEWS_PERMISSION]->(perm)
MERGE (item)-[:ASSIGNED_TO_REVIEWER]->(owner);
```

### 16.3 Review decision

```text
APPROVE
REVOKE
NEEDS_MORE_INFO
TRANSFER_REVIEW
EXCEPTION
```

A good review item includes explanation path. But be careful: storing full path as graph relationship can be expensive. Alternatives:

- store path snapshot as JSON,
- store path hash + query parameters,
- store nodes/relationship IDs at campaign time,
- store textual explanation generated from path.

For audit, prefer immutable snapshot.

---

## 17. Toxic Combination Detection

Toxic combination means a user has combination of permissions that violates separation of duties.

Examples:

```text
Can create vendor AND approve vendor payment.
Can modify policy AND review own policy change.
Can export customer data AND delete audit logs.
Can deploy production AND approve own change.
Can create user AND assign admin role.
```

### 17.1 Model conflict as graph

```text
(:Permission)-[:CONFLICTS_WITH {
  reason,
  severity,
  controlId
}]->(:Permission)
```

Or:

```text
(:ControlRule)-[:FORBIDS_COMBINATION]->(:Permission)
(:ControlRule)-[:FORBIDS_COMBINATION]->(:Permission)
```

Control rule as node is better if:

- need severity,
- need evidence,
- need owner,
- need regulation mapping,
- need remediation workflow.

### 17.2 Query

```cypher
MATCH (u:User {status: "ACTIVE"})
MATCH (u)-[:EFFECTIVE_ACCESS]->(:Resource)<-[:ON]-(p1:Permission)
MATCH (u)-[:EFFECTIVE_ACCESS]->(:Resource)<-[:ON]-(p2:Permission)
MATCH (p1)-[c:CONFLICTS_WITH]-(p2)
WHERE id(p1) < id(p2)
RETURN u.id,
       p1.id,
       p2.id,
       c.reason,
       c.severity;
```

If `EFFECTIVE_ACCESS` edges already store permission:

```cypher
MATCH (u:User {status: "ACTIVE"})-[ea1:EFFECTIVE_ACCESS]->()
MATCH (u)-[ea2:EFFECTIVE_ACCESS]->()
MATCH (p1:Permission {id: ea1.permissionId})-[c:CONFLICTS_WITH]-(p2:Permission {id: ea2.permissionId})
WHERE p1.id < p2.id
RETURN u.id, p1.id, p2.id, c.severity, c.reason;
```

### 17.3 False positives

Not every toxic combination is actual violation.

Need context:

- environment,
- scope,
- tenant,
- amount limit,
- resource owner,
- time overlap,
- emergency access status,
- compensating control.

Model context in rule:

```cypher
(:ControlRule {
  id: "SOD-PAYMENT-001",
  severity: "HIGH",
  appliesToEnvironment: "PROD",
  requiresSameTenant: true,
  requiresOverlappingValidity: true
})
```

---

## 18. Privilege Escalation Graph

Privilege escalation is not only “has admin”. It is “can eventually get admin”.

Examples:

```text
User can update group membership of group that has admin role.
User can edit policy that grants admin role.
User can assume service account that has admin role.
User can read secret used by deployment pipeline.
User can deploy code to app that runs with privileged role.
```

### 18.1 Model capability edges

```text
(:Role)-[:CAN_MANAGE_GROUP]->(:Group)
(:Role)-[:CAN_ASSIGN_ROLE]->(:Role)
(:Role)-[:CAN_UPDATE_POLICY]->(:Policy)
(:Policy)-[:GRANTS_ROLE]->(:Role)
(:Role)-[:CAN_READ_SECRET]->(:Secret)
(:Secret)-[:AUTHENTICATES_AS]->(:ServiceAccount)
(:ServiceAccount)-[:ASSIGNED_TO]->(:Role)
(:Role)-[:CAN_DEPLOY_TO]->(:Application)
(:Application)-[:RUNS_AS]->(:ServiceAccount)
```

### 18.2 Query escalation path

```cypher
MATCH (u:User {id: $userId})
MATCH path =
  (u)-[:MEMBER_OF*0..4]->(:Group)
  -[:ASSIGNED_TO]->(:Role)
  -[:CAN_MANAGE_GROUP|CAN_ASSIGN_ROLE|CAN_UPDATE_POLICY|GRANTS_ROLE|CAN_READ_SECRET|AUTHENTICATES_AS|RUNS_AS|CAN_DEPLOY_TO*1..6]->
  (target:Role {privileged: true})
RETURN path
LIMIT 20;
```

Need strict control:

- relationship types explicit,
- depth bounded,
- start node indexed,
- role privileged indexed,
- avoid all-path enumeration beyond reasonable limit.

---

## 19. Graph Data Science for IAM

GDS can support IAM analysis.

### 19.1 Centrality

Find highly connected roles/groups.

Useful for:

- role rationalization,
- identifying dangerous group,
- finding blast-radius hubs.

Example:

```text
High degree group = many users or many roles.
High betweenness group = bridges access between departments.
High PageRank role = structurally important role.
```

### 19.2 Community detection

Find clusters of identities/resources.

Useful for:

- detecting access communities,
- comparing expected org structure vs actual entitlement graph,
- finding shadow access cluster.

### 19.3 Similarity

Find users with unusual access compared to peers.

Example:

```text
Alice has access pattern unlike other Finance analysts.
```

Build user-permission bipartite graph:

```text
(:User)-[:EFFECTIVE_PERMISSION]->(:Permission)
```

Then compute similarity.

### 19.4 Link prediction

Careful. In IAM, link prediction can suggest likely access, but should not auto-grant privileged access.

Use for:

- recommendation to reviewers,
- missing entitlement detection,
- role mining,
- anomaly triage.

Never use link prediction as automatic access grant without governance.

---

## 20. Java Service Architecture

A production access graph service might look like:

```text
iam-source-connectors
  -> entitlement-normalizer
  -> graph-writer-service
  -> graph-query-service
  -> review-campaign-service
  -> risk-analysis-worker
  -> reporting-api
```

### 20.1 Bounded contexts

```text
Identity Ingestion
Resource Inventory
Entitlement Projection
Access Explanation
Access Review
Risk Detection
Policy Analysis
```

Do not put all logic in one giant graph service.

### 20.2 Repository style

Avoid generic repository:

```java
interface GraphRepository<T> {
    T save(T entity);
    Optional<T> findById(String id);
}
```

This encourages ORM thinking.

Prefer query-specific ports:

```java
public interface AccessExplanationQuery {
    AccessExplanation explainAccess(UserId userId, Action action, ResourceId resourceId);
}

public interface EntitlementReviewQuery {
    List<ReviewCandidate> findReviewCandidates(ReviewCampaignCriteria criteria);
}

public interface ToxicCombinationQuery {
    List<ToxicCombinationFinding> findActiveFindings(TenantId tenantId);
}
```

### 20.3 Transaction boundary

Writes:

```text
one source event / batch partition = one transaction
```

Do not write entire enterprise graph in one transaction.

Reads:

```text
one user/resource/action explanation = one read transaction
```

Batch reports:

```text
partition by tenant/resource owner/department
```

### 20.4 Cypher versioning

Treat Cypher as application code:

```text
src/main/resources/cypher/access/explain-access.cypher
src/main/resources/cypher/review/generate-items.cypher
src/main/resources/cypher/risk/find-toxic-combinations.cypher
```

Add:

- tests,
- profiling,
- query contract,
- max result expectation,
- timeout config.

### 20.5 DTO example

```java
public record AccessExplanation(
    String userId,
    String resourceId,
    String action,
    boolean allowed,
    List<AccessPathSegment> path,
    List<String> evidenceIds,
    Instant evaluatedAt
) {}
```

Path segment:

```java
public record AccessPathSegment(
    String fromId,
    String fromType,
    String relationshipType,
    String toId,
    String toType,
    Map<String, Object> attributes
) {}
```

Do not leak raw Neo4j node IDs as durable external IDs.

---

## 21. Testing Strategy

### 21.1 Golden graph fixtures

Create small known graphs:

```text
simple direct role
nested group role
expired grant
deny override
toxic combination
cross-tenant leakage
service account escalation
orphaned privileged account
```

### 21.2 Query tests

For each query:

- expected users,
- expected resources,
- expected path length,
- expected denial reason,
- expected no cross-tenant result.

### 21.3 Invariant tests

Examples:

```text
No active grant without subject.
No active grant without approval if privileged.
No user from tenant A can access tenant B resource unless explicit cross-tenant grant exists.
No service account can be ownerless if privileged.
No active membership without sourceSystem.
No permission on confidential resource without data classification.
```

Cypher invariant:

```cypher
MATCH (g:Grant {status: "ACTIVE"})
WHERE NOT (g)-[:APPROVED_BY]->(:User)
  AND EXISTS {
    MATCH (g)-[:GRANTS_ROLE]->(:Role {privileged: true})
  }
RETURN count(g) AS violations;
```

Test expects `0`.

### 21.4 Performance regression tests

For high-risk queries:

- run `PROFILE`,
- track rows,
- track db hits,
- track duration,
- track cardinality explosion,
- reject query plan regressions.

---

## 22. Operational Risks

### 22.1 Stale graph

Source data changes but graph not updated.

Mitigation:

- source versioning,
- lastSeenAt,
- reconciliation jobs,
- stale data dashboard,
- freshness SLA.

### 22.2 Overbroad traversal

Query accidentally crosses tenants or systems.

Mitigation:

- tenant boundary in every query,
- query templates,
- automated tests,
- security trimming,
- timeout,
- result cap.

### 22.3 Supergroups

Groups like `AllEmployees` create huge fan-out.

Mitigation:

- mark high-degree groups,
- do not traverse through broad groups for all queries,
- materialize effective access,
- segment by tenant/department,
- special-case broad groups in model.

### 22.4 Role explosion

Too many roles with minor differences.

Mitigation:

- role mining,
- permission similarity analysis,
- role rationalization workflow.

### 22.5 Policy ambiguity

Allow/deny/priority semantics unclear.

Mitigation:

- explicit policy model,
- deterministic decision rules,
- decision logs,
- policy tests.

### 22.6 Hidden business logic in Cypher

Complex policy encoded in scattered queries.

Mitigation:

- central query library,
- versioned Cypher,
- ADRs,
- tests,
- explanation format.

### 22.7 Audit path not reproducible

Graph changes after decision, explanation disappears.

Mitigation:

- decision snapshot,
- campaign snapshot,
- path hash,
- source evidence retention,
- immutable audit log outside mutable graph.

---

## 23. Architecture Decision Matrix

Use Neo4j for IAM when:

```text
You need explainable inherited access.
You need cross-system entitlement analysis.
You need access review over complex group/role/resource hierarchy.
You need toxic combination detection.
You need blast-radius analysis.
You need relationship-based authorization analysis.
You need evidence/provenance and audit paths.
```

Be careful when:

```text
Authorization check must be sub-millisecond at massive QPS.
Policy semantics are better represented in a specialized policy engine.
Source data freshness cannot be guaranteed.
IAM data is too sensitive for shared graph without strong isolation.
The team treats graph as generic CRUD store.
```

Avoid Neo4j when:

```text
The access model is flat and simple.
There is no inheritance, no indirect access, no explanation need.
Existing IAM product already answers all audit questions.
Operational team cannot support graph-specific performance/failure modes.
```

---

## 24. End-to-End Example

### 24.1 Scenario

Alice can approve production payments. We need to know why.

Facts:

```text
Alice is member of FinanceOps.
FinanceOps is member of PaymentApprovers.
PaymentApprovers has role PaymentApproverL3.
PaymentApproverL3 grants APPROVE_PAYMENT on PaymentSystemProd.
Grant came from ticket IAM-7821.
Ticket approved by Bob.
Grant expires 2026-12-31.
```

Graph:

```cypher
MERGE (alice:User {id: "usr-alice"})
SET alice.email = "alice@example.com", alice.status = "ACTIVE"

MERGE (finance:Group {id: "grp-finance-ops"})
SET finance.name = "FinanceOps"

MERGE (approvers:Group {id: "grp-payment-approvers"})
SET approvers.name = "PaymentApprovers"

MERGE (role:Role {id: "role-payment-approver-l3"})
SET role.name = "Payment Approver L3", role.privileged = true

MERGE (perm:Permission {id: "perm-approve-payment-prod"})
SET perm.action = "APPROVE_PAYMENT"

MERGE (res:Resource {id: "payment-system-prod"})
SET res.name = "Payment System Production",
    res.environment = "PROD",
    res.classification = "HIGH"

MERGE (ticket:Ticket {id: "IAM-7821"})
MERGE (bob:User {id: "usr-bob"})
SET bob.email = "bob@example.com"

MERGE (alice)-[:MEMBER_OF {status: "ACTIVE"}]->(finance)
MERGE (finance)-[:MEMBER_OF {status: "ACTIVE"}]->(approvers)
MERGE (approvers)-[:ASSIGNED_TO {status: "ACTIVE"}]->(role)
MERGE (role)-[:GRANTS]->(perm)
MERGE (perm)-[:ON]->(res)

MERGE (grant:Grant {id: "grant-iam-7821-alice-payment"})
SET grant.status = "ACTIVE",
    grant.expiresAt = datetime("2026-12-31T00:00:00Z")

MERGE (grant)-[:REQUESTED_IN]->(ticket)
MERGE (grant)-[:APPROVED_BY]->(bob)
MERGE (alice)-[:HAS_GRANT]->(grant)
MERGE (grant)-[:GRANTS_ROLE]->(role);
```

Explanation query:

```cypher
MATCH (u:User {id: "usr-alice"})
MATCH (res:Resource {id: "payment-system-prod"})
MATCH path =
  (u)-[:MEMBER_OF*0..4]->(principal)
  -[:ASSIGNED_TO]->(role:Role)
  -[:GRANTS]->(perm:Permission {action: "APPROVE_PAYMENT"})
  -[:ON]->(res)
OPTIONAL MATCH grantPath =
  (u)-[:HAS_GRANT]->(grant:Grant)-[:GRANTS_ROLE]->(role)
OPTIONAL MATCH (grant)-[:REQUESTED_IN]->(ticket:Ticket)
OPTIONAL MATCH (grant)-[:APPROVED_BY]->(approver:User)
RETURN path,
       grant.id AS grantId,
       grant.expiresAt AS expiresAt,
       ticket.id AS ticketId,
       approver.id AS approverId;
```

Expected explanation:

```text
Alice can APPROVE_PAYMENT on Payment System Production because:
Alice is member of FinanceOps.
FinanceOps is member of PaymentApprovers.
PaymentApprovers is assigned Payment Approver L3.
Payment Approver L3 grants APPROVE_PAYMENT on Payment System Production.
Grant was requested in IAM-7821 and approved by Bob.
Grant expires on 2026-12-31.
```

This is the core value of graph IAM: not only decision, but reason.

---

## 25. Production Checklist

### 25.1 Modelling checklist

```text
[ ] User, group, role, permission, resource IDs are globally unique.
[ ] Membership and grant lifecycle are represented.
[ ] Tenant/environment boundaries are explicit.
[ ] Sensitive resources are classified.
[ ] Privileged roles are tagged.
[ ] Service accounts have owners.
[ ] Approval evidence is linkable.
[ ] Expiry/revocation is represented.
[ ] Policy precedence is explicit.
[ ] Toxic combinations are modelled as rules.
```

### 25.2 Query checklist

```text
[ ] Every query starts from indexed node.
[ ] Traversal depth is bounded.
[ ] Relationship types are explicit.
[ ] Tenant boundary is included.
[ ] Status/time validity is filtered early.
[ ] Result size is capped.
[ ] PROFILE has acceptable rows/db hits.
[ ] No accidental cartesian product.
[ ] Explanation query returns deterministic path format.
```

### 25.3 Security checklist

```text
[ ] No raw Cypher from user-facing UI.
[ ] Viewer scope is enforced.
[ ] Sensitive path segments can be redacted.
[ ] Cross-tenant traversal is tested.
[ ] Neo4j DB roles are least-privilege.
[ ] Service credentials are rotated.
[ ] Query logs do not leak secrets.
[ ] Audit decision logs are immutable or externally retained.
```

### 25.4 Operations checklist

```text
[ ] Source freshness monitored.
[ ] Reconciliation job exists.
[ ] Effective access materialization has rebuild plan.
[ ] Review campaign snapshots are reproducible.
[ ] Large groups/supernodes are monitored.
[ ] Slow query logs reviewed.
[ ] Backup/restore tested.
[ ] Capacity model includes user/group/resource/permission growth.
```

---

## 26. What Top Engineers Should Internalize

IAM graph is not a fancy visualization of access tables. It is a way to make **access paths** explicit, queryable, explainable, and auditable.

The key mental shift:

```text
Permission is not just a field.
Permission is often the end result of a path.
```

A mature IAM graph answers:

```text
Who has access?
Why do they have access?
Who approved it?
Is it still valid?
Is it excessive?
Does it conflict with another permission?
What happens if this identity is compromised?
What access changed since last review?
Which access paths cross tenant, environment, or department boundary?
Which groups/roles are dangerous hubs?
Can this user escalate to a privileged role?
```

The hard part is not drawing nodes and edges. The hard part is preserving:

- semantic clarity,
- deterministic policy semantics,
- bounded traversal,
- source provenance,
- tenant safety,
- temporal correctness,
- audit reproducibility,
- operational performance.

---

## 27. Summary

In this part, we built an end-to-end mental model for IAM, entitlements, policy, and access graph.

We covered:

- why IAM is naturally graph-shaped,
- where Neo4j fits and where it should not be forced,
- core domain model,
- relationship catalogue,
- RBAC/ABAC/ReBAC/PBAC modelling,
- access explanation,
- entitlement review,
- toxic combination detection,
- privilege escalation path,
- blast-radius analysis,
- materialized effective access,
- temporal validity,
- multi-tenancy,
- security trimming,
- Java service architecture,
- testing and operational failure modes.

The core lesson:

```text
A graph IAM system is valuable when it can explain inherited access paths safely, accurately, and reproducibly.
```

---

## 28. Status Seri

```text
Part 000 selesai.
Part 001 selesai.
Part 002 selesai.
Part 003 selesai.
Part 004 selesai.
Part 005 selesai.
Part 006 selesai.
Part 007 selesai.
Part 008 selesai.
Part 009 selesai.
Part 010 selesai.
Part 011 selesai.
Part 012 selesai.
Part 013 selesai.
Part 014 selesai.
Part 015 selesai.
Part 016 selesai.
Part 017 selesai.
Part 018 selesai.
Part 019 selesai.
Part 020 selesai.
Part 021 selesai.
Part 022 selesai.
Part 023 selesai.
Part 024 selesai.
Part 025 selesai.
Part 026 selesai.
Part 027 selesai.
Part 028 selesai.
Part 029 selesai.
Seri belum selesai.
Masih ada Part 030 sampai Part 032.
```

Lanjut berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-030.md
```

Topik:

```text
Testing, Migration, Refactoring, and Evolution of Graph Systems
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Domain Case Study: Recommendation, Personalization, and Similarity Graph</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-030.md">Part 030 — Testing, Migration, Refactoring, and Evolution of Graph Systems ➡️</a>
</div>
