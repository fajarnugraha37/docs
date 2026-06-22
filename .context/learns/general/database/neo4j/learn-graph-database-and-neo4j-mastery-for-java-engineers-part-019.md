# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-019.md

# Part 019 — Security, Access Control, Multi-Tenancy, and Regulatory Defensibility

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Fokus: security model, tenant isolation, access-control semantics, auditability, explainability, regulatory defensibility, dan failure modelling pada Neo4j/graph systems.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 018, kita sudah membangun fondasi besar:

- graph thinking,
- property graph model,
- Cypher,
- path semantics,
- modelling methodology,
- anti-pattern,
- schema/index/constraint,
- write correctness,
- query performance,
- supernode,
- Java integration,
- Spring Data Neo4j,
- ingestion pipeline,
- transaction correctness,
- operations,
- clustering/high availability.

Part ini membahas pertanyaan yang sering muncul setelah sistem graph mulai masuk ke domain production yang serius:

> “Bagaimana memastikan graph ini aman, tidak membocorkan relasi sensitif, bisa dipakai multi-tenant, dan bisa dipertanggungjawabkan saat audit/regulatory review?”

Dalam sistem biasa, security sering dimulai dari:

- user boleh lihat record apa,
- user boleh update field apa,
- user boleh akses endpoint apa.

Dalam graph system, security menjadi lebih rumit karena informasi tidak hanya berada pada node/property, tetapi juga pada:

- keberadaan relationship,
- tidak adanya relationship,
- path antar-entity,
- degree node,
- community membership,
- inferred/derived relationship,
- traversal result,
- ranking/score dari algoritma graph,
- visualisasi subgraph.

Graph membuat relationship menjadi first-class citizen. Itu berarti relationship juga menjadi first-class security concern.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan Part 019, kamu harus mampu:

1. Memahami perbedaan security pada row/document system vs graph system.
2. Mendesain authorization boundary untuk node, relationship, property, path, dan query result.
3. Mengevaluasi pilihan multi-tenancy pada Neo4j.
4. Menghindari data leakage melalui traversal, graph visualization, metadata, dan derived edges.
5. Mendesain security trimming untuk graph query.
6. Memahami role-based access control dan fine-grained privilege di Neo4j.
7. Mendesain model provenance/evidence/audit trail untuk sistem regulatory.
8. Membedakan operational audit, business audit, dan evidentiary audit.
9. Membuat graph decision support yang defensible, explainable, dan reproducible.
10. Mengenali failure mode security pada graph workload.

---

## 2. Security Problem pada Graph Database

Graph database menyimpan dan mengekspos struktur relasi.

Dalam relational database, data leakage sering terlihat seperti:

```text
User A bisa membaca row yang harusnya milik User B.
```

Dalam document database:

```text
User A bisa membaca document/subdocument yang harusnya disembunyikan.
```

Dalam graph database:

```text
User A mungkin tidak melihat property sensitif,
tetapi tetap bisa menyimpulkan sesuatu dari connection pattern.
```

Contoh:

```text
(:Person {name: 'Andi'})-[:SUBJECT_OF]->(:Investigation {id: 'INV-123'})
```

Walaupun property `reason`, `riskScore`, atau `allegation` disembunyikan, fakta bahwa Andi terhubung ke `Investigation` sudah sensitif.

Graph leakage bisa terjadi melalui beberapa bentuk.

### 2.1 Node leakage

User melihat node yang tidak boleh dilihat.

```cypher
MATCH (p:Person)
RETURN p
```

Jika tidak difilter, semua person terbuka.

### 2.2 Relationship leakage

User tidak melihat detail node target, tetapi melihat relationship.

```cypher
MATCH (p:Person)-[r:UNDER_INVESTIGATION]->()
RETURN p, type(r)
```

Ini bisa cukup untuk menyimpulkan status investigasi.

### 2.3 Path leakage

User melihat path yang mengungkap koneksi tidak langsung.

```cypher
MATCH path = (p:Person {id: $id})-[*1..4]-(x)
RETURN path
```

Walaupun setiap node tampak tidak terlalu sensitif sendiri-sendiri, kombinasi path bisa membocorkan:

- hubungan bisnis,
- konflik kepentingan,
- jaringan fraud,
- sumber evidence,
- investigator assignment,
- case linkage,
- escalation chain.

### 2.4 Degree leakage

User tidak melihat siapa relasinya, tapi melihat jumlah relasi.

```cypher
MATCH (p:Person {id: $id})--(x)
RETURN count(x)
```

Dalam domain tertentu, degree bisa sensitif.

Contoh:

```text
Akun dengan 4.000 counterparty mungkin entitas risiko tinggi.
```

### 2.5 Negative-information leakage

Tidak ditemukannya path juga bisa sensitif.

```text
Tidak ada hubungan antara pejabat X dan perusahaan Y.
```

Dalam sistem due diligence, absence of relationship bisa menjadi informasi penting.

### 2.6 Derived relationship leakage

Relationship hasil kalkulasi dapat membocorkan fakta asal.

```cypher
(:Person)-[:LIKELY_ASSOCIATED_WITH {confidence: 0.82}]->(:Organization)
```

Walaupun source evidence disembunyikan, derived edge memberi sinyal kuat.

### 2.7 Visualization leakage

Graph visualization sering lebih berbahaya dari query table karena user melihat pola jaringan secara cepat.

Hal-hal yang bisa bocor dari visualisasi:

- central node,
- cluster,
- isolated node,
- hidden intermediary,
- node degree,
- label/type warna,
- relationship density,
- path shape.

---

## 3. Neo4j Security Capability: Mental Model

Neo4j menyediakan authentication dan authorization. Authorization di Neo4j dikelola melalui role-based access control. RBAC mengatur akses berdasarkan role dan privilege. Neo4j juga mendukung fine-grained security untuk membatasi apa yang dapat dibaca/ditulis/administer oleh user.

Secara mental, security Neo4j memiliki beberapa layer:

```text
Application authentication
        ↓
Application authorization
        ↓
Neo4j authentication
        ↓
Neo4j role/privilege authorization
        ↓
Cypher query design
        ↓
Security trimming in query/result
        ↓
Audit and monitoring
```

Jangan berpikir bahwa satu layer cukup.

Untuk production system yang serius, keamanan graph biasanya gabungan:

1. identity provider,
2. application permission model,
3. Neo4j role/privilege,
4. tenant/data partitioning,
5. query-time filtering,
6. response shaping,
7. audit logging,
8. operational monitoring.

---

## 4. Authentication vs Authorization

### 4.1 Authentication

Authentication menjawab:

```text
Siapa kamu?
```

Contoh identity:

- internal user,
- officer,
- analyst,
- investigator,
- supervisor,
- auditor,
- system service account,
- ETL worker,
- batch scoring job,
- external partner.

Dalam arsitektur Java enterprise, authentication biasanya tidak dimulai di Neo4j, tetapi di:

- OAuth2/OIDC provider,
- LDAP/Active Directory,
- IAM platform,
- API gateway,
- service mesh identity,
- workload identity.

Neo4j tetap perlu identity untuk koneksi database, tetapi jangan mencampur seluruh business authorization ke credential database tanpa desain matang.

### 4.2 Authorization

Authorization menjawab:

```text
Kamu boleh melakukan apa terhadap data apa, dalam konteks apa?
```

Pada graph, authorization harus menjawab level tambahan:

```text
Kamu boleh melihat node ini?
Kamu boleh melihat relationship ini?
Kamu boleh melihat bahwa relationship ini ada?
Kamu boleh mengikuti path melalui node ini?
Kamu boleh melihat aggregate/degree dari area ini?
Kamu boleh melihat derived score ini?
Kamu boleh menulis relationship jenis ini?
Kamu boleh mengubah evidence yang sudah dipakai dalam keputusan?
Kamu boleh melihat historical state?
```

---

## 5. Role-Based Access Control di Neo4j

Neo4j mendukung built-in roles dan custom roles. Built-in role dapat menjadi baseline, tetapi production system biasanya membutuhkan custom role.

Contoh role konseptual:

```text
reader
publisher
architect
admin
```

Namun role bisnis biasanya lebih spesifik:

```text
case_viewer
case_investigator
case_supervisor
risk_analyst
evidence_manager
compliance_auditor
tenant_admin
system_ingestor
gds_batch_runner
```

Neo4j privilege dapat mengontrol action pada database/graph/segment tertentu. Prinsip utamanya:

```text
Grant minimum capability needed.
Deny sensitive capability explicitly when necessary.
Separate operational role from business role.
Separate read role from write role.
Separate application runtime account from human admin account.
```

Contoh konseptual:

```cypher
CREATE ROLE case_reader;
GRANT ACCESS ON DATABASE cases TO case_reader;
GRANT MATCH {*} ON GRAPH cases NODES Case TO case_reader;
GRANT MATCH {*} ON GRAPH cases RELATIONSHIPS SUBJECT_OF TO case_reader;
```

Catatan:

- Sintaks detail bisa berbeda tergantung versi Neo4j dan edition.
- Di production, selalu cek manual versi yang dipakai.
- Jangan copy-paste privilege tanpa test dengan user nyata.

---

## 6. Built-in Roles: Berguna tapi Tidak Cukup

Built-in roles memudahkan permulaan, tetapi jarang cukup untuk sistem kompleks.

Masalah jika hanya memakai built-in roles:

1. terlalu kasar,
2. sulit mengekspresikan domain permission,
3. raw database role tidak selalu sama dengan business role,
4. tidak cukup untuk path-based permission,
5. tidak cukup untuk tenant-specific rule,
6. tidak cukup untuk contextual authorization.

Contoh:

```text
Investigator boleh melihat case di unitnya.
Supervisor boleh melihat case bawahannya.
Auditor boleh melihat historical decision tetapi tidak boleh mengubah evidence.
Data-quality operator boleh memperbaiki entity resolution tetapi tidak boleh melihat allegation detail.
```

Ini bukan sekadar `reader` vs `writer`.

---

## 7. Fine-Grained Access Control: Apa yang Bisa dan Tidak Bisa Diselesaikan

Fine-grained access control membantu membatasi access pada label, relationship type, property, dan graph segment.

Tetapi ada batas penting:

```text
Database-level privilege tidak otomatis menyelesaikan semua business authorization.
```

Kenapa?

Karena business authorization sering bergantung pada konteks runtime:

- siapa user saat ini,
- unit organisasi user,
- assignment case,
- purpose of access,
- stage workflow,
- legal hold status,
- jurisdiction,
- sensitivity classification,
- conflict-of-interest rule,
- investigation secrecy window,
- emergency override.

Contoh rule:

```text
User boleh melihat Case jika:
1. user assigned ke case tersebut, atau
2. user supervisor dari assigned officer, atau
3. user auditor dengan scope regulator tertentu, dan
4. case tidak berada di sealed investigation, kecuali user punya sealed_access.
```

Ini biasanya harus direpresentasikan di application layer atau query-level security trimming, bukan hanya DB role.

---

## 8. Application-Level Authorization vs Database-Level Authorization

Ada dua pendekatan ekstrem.

### 8.1 Semua authorization di database

Keuntungan:

- central enforcement,
- mengurangi risiko developer lupa filter,
- berguna untuk direct database access,
- cocok untuk static privilege.

Kerugian:

- sulit untuk rule kontekstual,
- role explosion,
- sulit test business rule kompleks,
- coupling tinggi ke database privilege,
- tidak selalu cocok untuk multi-tenant dynamic runtime.

### 8.2 Semua authorization di aplikasi

Keuntungan:

- fleksibel,
- mudah pakai domain context,
- mudah integrasi workflow,
- rule bisa di-test sebagai domain logic,
- lebih natural untuk service architecture.

Kerugian:

- raw DB access lebih berbahaya,
- query filter bisa lupa,
- security logic tersebar,
- visualization/admin tools bisa bypass,
- butuh disiplin repository/query abstraction.

### 8.3 Pendekatan yang realistis

Untuk sistem serius, gunakan kombinasi:

```text
Neo4j role/privilege:
- coarse database capability,
- operational separation,
- service account restriction,
- deny dangerous operations,
- admin boundary.

Application authorization:
- business permission,
- tenant context,
- workflow state,
- purpose-based access,
- dynamic policy.

Query security trimming:
- enforce accessible subgraph,
- prevent accidental path leak,
- shape result safely.
```

---

## 9. Graph-Specific Authorization Concepts

### 9.1 Node-level authorization

User boleh membaca node tertentu.

Contoh:

```text
Officer A boleh melihat Case C karena assigned.
```

Graph representation:

```cypher
(:User {id: 'u1'})-[:ASSIGNED_TO]->(:Case {id: 'c1'})
```

Query:

```cypher
MATCH (:User {id: $userId})-[:ASSIGNED_TO]->(c:Case {id: $caseId})
RETURN c
```

### 9.2 Relationship-level authorization

User boleh melihat node tetapi tidak semua relationship.

Contoh:

```text
Auditor boleh melihat bahwa case memiliki subject,
tetapi tidak boleh melihat confidential informant relationship.
```

Query harus whitelist relationship type:

```cypher
MATCH (c:Case {id: $caseId})-[r:SUBJECT_OF|SUPPORTED_BY|VIOLATES]->(x)
RETURN c, r, x
```

Jangan lakukan:

```cypher
MATCH (c:Case {id: $caseId})-[r]-(x)
RETURN c, r, x
```

### 9.3 Property-level authorization

User boleh melihat node, tetapi tidak semua property.

Contoh:

```cypher
RETURN c { .id, .status, .createdAt, .riskBand } AS caseView
```

Jangan return raw node untuk API publik/internal user yang berbeda:

```cypher
RETURN c
```

Kenapa?

Karena raw node membawa seluruh property yang dapat dibaca oleh query context.

### 9.4 Path-level authorization

User boleh melihat sebagian path, tetapi tidak semua intermediary.

Contoh:

```text
Analyst boleh melihat bahwa A related to B,
tetapi tidak boleh melihat confidential source node yang menghubungkan mereka.
```

Ada beberapa pilihan:

1. jangan return path raw,
2. return summarized relationship,
3. return redacted path,
4. return explanation yang aman,
5. require elevated permission untuk path detail.

### 9.5 Aggregate-level authorization

User boleh melihat data detail? Belum tentu.
User boleh melihat aggregate? Juga belum tentu.

Contoh leakage:

```cypher
MATCH (u:Officer)-[:ASSIGNED_TO]->(c:Case)
RETURN u.name, count(c)
```

Jumlah case assigned ke officer bisa sensitif.

---

## 10. Security Trimming dalam Graph Query

Security trimming adalah proses mengurangi graph result agar hanya mengandung data yang boleh dilihat user.

Dalam search engine, security trimming sering berarti filter document by ACL.

Dalam graph, trimming harus mempertimbangkan:

- start node,
- traversal relationship types,
- traversal depth,
- allowed labels,
- allowed relationship types,
- allowed properties,
- allowed derived edges,
- allowed path explanation,
- allowed aggregate.

### 10.1 Pattern dasar security trimming

```cypher
MATCH (viewer:User {id: $viewerId})-[:CAN_ACCESS]->(c:Case {id: $caseId})
MATCH (c)-[:SUBJECT_OF]->(p:Person)
RETURN c { .id, .status } AS case,
       p { .id, .displayName } AS subject
```

Ini lebih aman daripada:

```cypher
MATCH (c:Case {id: $caseId})-[]-(x)
RETURN c, x
```

### 10.2 Security anchor

Setiap graph query sensitif harus punya security anchor.

Security anchor adalah bagian query yang membuktikan user punya hak.

Contoh:

```cypher
MATCH (viewer:User {id: $viewerId})
MATCH (viewer)-[:MEMBER_OF]->(:Unit)-[:OWNS]->(c:Case {id: $caseId})
...
```

Jika query tidak punya anchor, pertanyaannya:

```text
Dari mana query tahu user boleh melihat data ini?
```

### 10.3 Jangan filter setelah bocor

Buruk:

```cypher
MATCH path = (c:Case {id: $caseId})-[*1..4]-(x)
WITH path, nodes(path) AS ns
WHERE all(n IN ns WHERE coalesce(n.tenantId, $tenantId) = $tenantId)
RETURN path
```

Masalah:

- expansion sudah terjadi,
- query mungkin mahal,
- intermediary unauthorized mungkin memengaruhi result,
- filter terlambat bisa tetap membuka side-channel via timing/count/error.

Lebih baik batasi sejak awal:

```cypher
MATCH (c:Case {id: $caseId, tenantId: $tenantId})
MATCH path = (c)-[:SUBJECT_OF|SUPPORTED_BY|RELATED_TO*1..3]-(x)
WHERE all(n IN nodes(path) WHERE n.tenantId = $tenantId)
RETURN path
```

Namun untuk security tinggi, lebih baik model relationship/access boundary eksplisit agar traversal tidak menyeberang tenant/scope.

---

## 11. Multi-Tenancy pada Neo4j

Multi-tenancy adalah desain agar satu platform melayani banyak tenant/organisasi/scope data.

Pertanyaan utamanya:

```text
Apakah tenant boleh benar-benar tidak saling melihat?
Apakah ada shared reference data?
Apakah cross-tenant analytics diperlukan?
Apakah tenant punya data residency berbeda?
Apakah tenant punya compliance level berbeda?
Apakah tenant bisa diekspor/dihapus sendiri?
Apakah tenant butuh custom schema/model?
```

Ada beberapa model.

---

## 12. Multi-Tenancy Option 1: Tenant Property di Semua Node/Relationship

Model:

```cypher
(:Case {id: 'C1', tenantId: 'T1'})
(:Person {id: 'P1', tenantId: 'T1'})
(:Case)-[:SUBJECT_OF {tenantId: 'T1'}]->(:Person)
```

### Keuntungan

- sederhana,
- satu database,
- mudah cross-tenant analytics jika diizinkan,
- murah secara operational,
- tidak perlu banyak database.

### Kerugian

- semua query harus filter tenant,
- risiko lupa filter,
- relationship lintas tenant bisa terjadi jika bug,
- index perlu tenant-aware,
- backup/restore per tenant sulit,
- deletion/export per tenant lebih kompleks,
- noisy neighbor lebih besar.

### Query pattern

```cypher
MATCH (c:Case {tenantId: $tenantId, id: $caseId})
MATCH (c)-[:SUBJECT_OF]->(p:Person {tenantId: $tenantId})
RETURN c, p
```

### Kapan cocok

- tenant kecil/menengah,
- isolation requirement moderate,
- operational simplicity lebih penting,
- cross-tenant reporting dibutuhkan,
- data classification relatif sama.

### Kapan tidak cocok

- strict data isolation,
- regulated tenant dengan residency berbeda,
- customer minta independent restore/export,
- tenant besar dengan workload berbeda,
- risiko legal tinggi.

---

## 13. Multi-Tenancy Option 2: Tenant Label

Model:

```cypher
(:Case:Tenant_T1 {id: 'C1'})
(:Person:Tenant_T1 {id: 'P1'})
```

### Keuntungan

- query bisa memakai label tenant,
- beberapa privilege/index bisa lebih mudah dipisah,
- visualisasi tenant lebih jelas.

### Kerugian

- label explosion,
- dynamic label menyulitkan query parameterization,
- schema management kompleks,
- tenant baru berarti label baru,
- tidak ideal untuk ribuan tenant,
- model menjadi operationally noisy.

### Kapan cocok

Jarang menjadi pilihan utama untuk multi-tenancy besar. Bisa berguna untuk:

- environment terbatas,
- tenant sedikit,
- demo/prototype,
- segment statis besar.

---

## 14. Multi-Tenancy Option 3: Separate Database per Tenant

Neo4j mendukung multi-database. Tenant bisa dipisah per database.

Model:

```text
database tenant_t1
database tenant_t2
database tenant_t3
```

### Keuntungan

- isolation lebih kuat,
- query tidak perlu tenant filter di setiap node,
- backup/restore per tenant lebih masuk akal,
- migration per tenant lebih mudah,
- deletion/export tenant lebih jelas,
- privilege bisa database-specific.

### Kerugian

- operational overhead,
- connection routing lebih kompleks,
- schema migration harus multi-database,
- cross-tenant query lebih sulit,
- resource management lebih rumit,
- jumlah database punya batas praktis.

### Kapan cocok

- tenant besar,
- compliance isolation tinggi,
- customer-specific backup/restore,
- customer-specific lifecycle,
- data residency/legal boundary kuat.

---

## 15. Multi-Tenancy Option 4: Separate Cluster per Tenant/Class

Model:

```text
Cluster A: high-security tenants
Cluster B: normal tenants
Cluster C: dedicated tenant X
```

### Keuntungan

- isolation paling kuat,
- resource isolation jelas,
- compliance lebih mudah dijelaskan,
- blast radius lebih kecil,
- upgrade schedule bisa customer-specific.

### Kerugian

- cost tinggi,
- operational overhead tinggi,
- capacity planning lebih sulit,
- platform automation wajib matang.

### Kapan cocok

- regulated enterprise,
- government/public sector,
- large customer dedicated environment,
- strict residency/security class,
- contractual isolation.

---

## 16. Multi-Tenancy Decision Matrix

| Requirement | Tenant Property | Tenant Label | Database per Tenant | Cluster per Tenant/Class |
|---|---:|---:|---:|---:|
| Operational simplicity | High | Medium | Medium-Low | Low |
| Isolation strength | Low-Medium | Medium | High | Very High |
| Cross-tenant analytics | Easy | Medium | Hard | Very Hard |
| Per-tenant backup/restore | Hard | Hard | Good | Good |
| Per-tenant deletion/export | Medium-Hard | Medium-Hard | Good | Good |
| Cost efficiency | High | High | Medium | Low |
| Query safety | Requires discipline | Requires discipline | Better | Best |
| Large tenant support | Risky | Risky | Good | Best |
| Compliance defensibility | Weak-Medium | Medium | High | Very High |

Prinsip praktis:

```text
Jika tenant isolation adalah legal/regulatory promise,
jangan hanya mengandalkan tenantId filter di aplikasi.
```

---

## 17. Shared Reference Data dalam Multi-Tenant Graph

Banyak graph membutuhkan shared reference data:

- regulation,
- jurisdiction,
- industry code,
- country,
- sanction category,
- risk taxonomy,
- product catalog,
- ontology,
- classification tree.

Masalahnya:

```text
Apakah tenant-specific graph boleh terhubung ke shared reference graph?
```

Contoh:

```cypher
(:Case {tenantId: 'T1'})-[:VIOLATES]->(:Regulation {code: 'AML-12'})
(:Case {tenantId: 'T2'})-[:VIOLATES]->(:Regulation {code: 'AML-12'})
```

Jika `Regulation` shared, traversal dari regulation bisa menemukan case lintas tenant.

Buruk:

```cypher
MATCH (:Regulation {code: 'AML-12'})<-[:VIOLATES]-(c:Case)
RETURN c
```

Aman:

```cypher
MATCH (:Regulation {code: 'AML-12'})<-[:VIOLATES]-(c:Case {tenantId: $tenantId})
RETURN c
```

Lebih aman lagi:

- pisahkan reference graph read-only,
- jangan buat reverse traversal dari shared node ke tenant data untuk user biasa,
- materialize reference attributes ke tenant graph jika perlu,
- gunakan query abstraction ketat.

---

## 18. Path-Based Access Control

Dalam graph, permission bisa dimodelkan sebagai path.

Contoh:

```text
User can access Case if:
User -> MEMBER_OF -> Unit -> OWNS -> Case
```

Graph:

```cypher
(:User)-[:MEMBER_OF]->(:Unit)-[:OWNS]->(:Case)
```

Query:

```cypher
MATCH (:User {id: $userId})-[:MEMBER_OF]->(:Unit)-[:OWNS]->(c:Case {id: $caseId})
RETURN c
```

Ini powerful karena authorization rule mengikuti struktur organisasi.

Namun ada risiko:

1. authorization traversal menjadi mahal,
2. perubahan org structure mengubah access massal,
3. cycle dalam org graph bisa membuka akses tidak terduga,
4. inherited permission bisa terlalu luas,
5. debug permission menjadi sulit.

### 18.1 Permission path harus bounded

Jangan:

```cypher
MATCH (:User {id: $userId})-[:MEMBER_OF|PARENT_OF|DELEGATED_TO*]->(c:Case {id: $caseId})
RETURN c
```

Ini terlalu bebas.

Lebih baik:

```cypher
MATCH (:User {id: $userId})-[:MEMBER_OF]->(:Unit)-[:OWNS]->(c:Case {id: $caseId})
RETURN c
```

Atau jika hierarchy diperlukan:

```cypher
MATCH (:User {id: $userId})-[:MEMBER_OF]->(u:Unit)
MATCH (u)-[:PARENT_OF*0..3]->(:Unit)-[:OWNS]->(c:Case {id: $caseId})
RETURN c
```

Tetap bounded.

### 18.2 Permission explanation

Salah satu keunggulan graph adalah ability menjelaskan access:

```cypher
MATCH path = (:User {id: $userId})-[:MEMBER_OF]->(:Unit)-[:OWNS]->(:Case {id: $caseId})
RETURN path
```

Untuk auditor, ini berguna:

```text
User U boleh melihat Case C karena U anggota Unit X dan Unit X pemilik Case C.
```

---

## 19. Security Trimming untuk Graph Visualization

Graph visualization tool harus lebih ketat daripada table API.

Kenapa?

Karena user bisa memperoleh insight dari bentuk graph.

Minimum rules:

1. Jangan expose arbitrary expand.
2. Batasi relationship type yang bisa di-expand.
3. Batasi depth.
4. Batasi node count.
5. Batasi property yang ditampilkan.
6. Redact label sensitif.
7. Jangan tampilkan hidden node sebagai blank node jika blank node masih mengungkap path.
8. Audit setiap expand action.
9. Beri purpose-of-access untuk domain sensitif.
10. Terapkan same authorization rule seperti API backend.

Contoh buruk:

```text
User bisa klik kanan node → Expand all relationships.
```

Ini hampir selalu berbahaya dalam graph sensitif.

Contoh lebih aman:

```text
Expand allowed only:
- SUBJECT_OF
- SUPPORTED_BY
- VIOLATES
- ASSIGNED_TO

Max depth: 2
Max nodes: 200
Excluded relationship:
- CONFIDENTIAL_SOURCE
- INTERNAL_REVIEW_NOTE
- SEALED_INVESTIGATION_LINK
```

---

## 20. Sensitive Relationship Types

Dalam graph, relationship type tertentu harus diperlakukan seperti data rahasia.

Contoh:

```text
CONFIDENTIAL_SOURCE_OF
UNDER_INVESTIGATION_FOR
SUSPECTED_ASSOCIATE_OF
WHISTLEBLOWER_IN
CONFLICT_OF_INTEREST_WITH
SEALED_BY
ESCALATED_DUE_TO
REJECTED_FOR
SANCTIONED_BY
```

Jangan hanya menyembunyikan property.

Relationship existence sendiri sensitif.

Pattern aman:

```text
Sensitive relationship type tidak boleh muncul dalam query umum.
Sensitive relationship punya privilege khusus.
Sensitive relationship tidak boleh ikut generic expand.
Sensitive relationship tidak boleh dipakai sebagai inferred public shortcut tanpa review.
```

---

## 21. Write Security

Read security sering dibahas, tetapi write security sama pentingnya.

Pertanyaan write security:

```text
Siapa boleh membuat relationship?
Siapa boleh menghapus relationship?
Siapa boleh mengubah evidence?
Siapa boleh mengganti subject case?
Siapa boleh membuat derived risk edge?
Siapa boleh override score?
Siapa boleh close case?
Siapa boleh mengubah historical fact?
```

### 21.1 Dangerous write operations

Berbahaya:

```cypher
MATCH (c:Case {id: $caseId})-[r]-()
DELETE r
```

Sangat berbahaya:

```cypher
MATCH (c:Case {id: $caseId})
DETACH DELETE c
```

Dalam Neo4j, `DETACH DELETE` dapat menghapus node beserta relationship-nya. Untuk domain regulated, ini hampir selalu harus dibatasi ketat.

### 21.2 Soft delete vs hard delete

Untuk domain regulatory, hard delete sering tidak boleh dilakukan sembarangan.

Pattern:

```cypher
MATCH (e:Evidence {id: $evidenceId})
SET e.deletedAt = datetime(),
    e.deletedBy = $userId,
    e.deleteReason = $reason,
    e.status = 'RETRACTED'
```

Bukan:

```cypher
MATCH (e:Evidence {id: $evidenceId})
DETACH DELETE e
```

### 21.3 Append-only evidence

Untuk evidence dan decision log, pattern append-only lebih defensible.

```cypher
(:EvidenceVersion {version: 1})-[:SUPERSEDED_BY]->(:EvidenceVersion {version: 2})
```

Atau:

```cypher
(:Evidence)-[:HAS_VERSION]->(:EvidenceSnapshot)
```

---

## 22. Audit Trail: Apa yang Harus Diaudit?

Ada beberapa jenis audit.

### 22.1 Operational audit

Menjawab:

```text
Siapa menjalankan query apa, kapan, dari service mana, berhasil/gagal?
```

Sumber:

- application logs,
- Neo4j query logs,
- auth logs,
- API gateway logs,
- service audit logs.

### 22.2 Business audit

Menjawab:

```text
Siapa melakukan action bisnis apa terhadap case/entity/evidence?
```

Contoh:

```text
Officer A changed Case C from OPEN to ESCALATED.
Supervisor B approved enforcement action E.
Analyst C linked Person P to Organization O as suspected controller.
```

### 22.3 Evidentiary audit

Menjawab:

```text
Fakta/relationship ini berasal dari sumber apa,
dikumpulkan kapan,
oleh siapa,
dengan confidence apa,
dan dipakai dalam decision mana?
```

Ini sangat penting untuk regulatory defensibility.

---

## 23. Provenance Model

Provenance menjawab:

```text
Dari mana fakta graph ini berasal?
```

Contoh buruk:

```cypher
(:Person)-[:OWNS]->(:Company)
```

Tidak jelas sumbernya.

Contoh lebih defensible:

```cypher
(:Person)-[:OWNS {source: 'registry', observedAt: date('2026-01-10')}]->(:Company)
```

Namun ini masih terbatas.

Contoh lebih kuat:

```cypher
(:Person)-[:OWNS]->(:Company)
(:OwnershipFact)-[:ASSERTS]->(:Person)
(:OwnershipFact)-[:ASSERTS]->(:Company)
(:OwnershipFact)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:EXTRACTED_FROM]->(:SourceDocument)
```

Atau relationship reification:

```cypher
(:Person)-[:PARTY_IN]->(:OwnershipAssertion)<-[:PARTY_IN]-(:Company)
(:OwnershipAssertion)-[:SUPPORTED_BY]->(:Evidence)
(:OwnershipAssertion)-[:MADE_BY]->(:Source)
```

### 23.1 Kapan provenance cukup sebagai property?

Gunakan property jika:

- provenance sederhana,
- satu sumber cukup,
- tidak perlu query detail evidence,
- tidak perlu versioning serius.

### 23.2 Kapan provenance harus menjadi node?

Gunakan node jika:

- banyak evidence mendukung satu fact,
- fact bisa diperdebatkan,
- confidence berubah,
- perlu approval workflow,
- perlu audit chain,
- perlu explainability,
- source punya metadata penting,
- source bisa dicabut/retracted.

---

## 24. Evidence Graph Pattern

Untuk regulatory/enforcement, evidence graph sering menjadi core.

Contoh model:

```text
Case
 ├── has allegation
 ├── has evidence
 ├── has subject
 ├── has decision
 └── has action
```

Graph:

```cypher
(:Case)-[:HAS_ALLEGATION]->(:Allegation)
(:Allegation)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:EXTRACTED_FROM]->(:SourceDocument)
(:Evidence)-[:ASSERTS_RELATIONSHIP]->(:Assertion)
(:Decision)-[:BASED_ON]->(:Evidence)
(:Decision)-[:APPROVED_BY]->(:Officer)
```

Keunggulan:

- decision traceable,
- evidence reusable,
- conflicting evidence bisa dimodelkan,
- source lineage jelas,
- audit lebih mudah.

### 24.1 Evidence status

Evidence sebaiknya punya lifecycle:

```text
COLLECTED
VALIDATED
DISPUTED
RETRACTED
SUPERSEDED
EXCLUDED
```

Jangan hapus evidence tanpa jejak.

### 24.2 Confidence and reliability

Pisahkan:

```text
confidence of fact
reliability of source
strength of evidence
recency/freshness
legal admissibility
```

Jangan semua digabung menjadi satu `score` tanpa explanation.

---

## 25. Explainability dalam Graph Decision Support

Graph sering dipakai untuk decision support:

- risk score,
- fraud suspicion,
- case priority,
- relationship discovery,
- entity resolution,
- recommendation tindakan,
- escalation suggestion.

Untuk domain regulated, output seperti ini harus bisa dijelaskan.

Buruk:

```text
Risk score: 87
Reason: graph algorithm
```

Lebih baik:

```text
Risk score: 87 because:
- subject controls 3 companies under active investigation,
- subject shares address with sanctioned entity,
- transaction path connects to high-risk merchant within 2 hops,
- evidence E123 and E456 support ownership link,
- PageRank percentile increased from 70 to 92 after new evidence.
```

### 25.1 Explanation graph

Kamu bisa menyimpan explanation sebagai graph:

```cypher
(:RiskAssessment)-[:BASED_ON]->(:FeatureContribution)
(:FeatureContribution)-[:REFERENCES]->(:Evidence)
(:FeatureContribution)-[:REFERENCES_PATH]->(:PathEvidence)
(:RiskAssessment)-[:GENERATED_BY]->(:ModelVersion)
```

### 25.2 Reproducibility

Audit sering bertanya:

```text
Jika kita jalankan ulang hari ini, apakah hasil lama bisa dijelaskan?
```

Karena graph berubah, jawaban bisa berubah.

Agar reproducible:

- simpan model version,
- simpan algorithm config,
- simpan graph snapshot/version reference,
- simpan input feature values,
- simpan evidence IDs,
- simpan generated timestamp,
- simpan user/system actor,
- simpan result explanation.

---

## 26. Temporal Access dan Historical State

Regulatory system sering butuh pertanyaan temporal:

```text
Apa yang user tahu pada waktu keputusan dibuat?
Apa status relationship saat case ditutup?
Siapa punya akses pada saat evidence dilihat?
```

Ini berbeda dari state sekarang.

### 26.1 Valid time vs transaction time

```text
Valid time:
Kapan fakta berlaku di dunia nyata?

Transaction time:
Kapan fakta masuk/diubah di sistem?
```

Contoh:

```cypher
(:Person)-[:OWNS {validFrom: date('2023-01-01'), validTo: date('2024-05-01'), recordedAt: datetime('2024-06-01T10:00:00Z')}]->(:Company)
```

### 26.2 Audit needs transaction time

Jika hanya menyimpan valid time, kamu tidak tahu kapan sistem mengetahui fakta itu.

Untuk defensibility:

```text
Decision must be judged against knowledge available at decision time.
```

---

## 27. Purpose-Based Access

Dalam domain sensitif, “boleh melihat” kadang bergantung pada purpose.

Contoh:

```text
Auditor boleh melihat data untuk audit.
Investigator boleh melihat data untuk investigation.
Support engineer tidak boleh melihat data kecuali break-glass incident.
```

Model:

```text
access purpose:
- CASE_INVESTIGATION
- QUALITY_REVIEW
- SUPERVISORY_REVIEW
- LEGAL_AUDIT
- INCIDENT_SUPPORT
```

API harus mencatat purpose:

```json
{
  "userId": "u123",
  "caseId": "c456",
  "purpose": "CASE_INVESTIGATION",
  "reason": "Reviewing related party network before escalation"
}
```

Audit log:

```text
u123 accessed graph neighborhood of c456 for CASE_INVESTIGATION at 2026-06-21T10:00Z
```

---

## 28. Break-Glass Access

Break-glass adalah akses darurat.

Contoh:

```text
Production incident but normal access does not permit seeing data.
```

Break-glass harus:

1. explicit,
2. time-limited,
3. reason-required,
4. heavily audited,
5. post-reviewed,
6. minimally scoped,
7. alerting-enabled.

Jangan implementasi break-glass sebagai:

```text
Berikan admin password ke engineer.
```

Lebih baik:

```text
Temporary elevated role + ticket ID + expiry + audit + approval.
```

---

## 29. Data Retention, Legal Hold, and Deletion

Graph deletion lebih rumit karena relationship membuat data saling terhubung.

Pertanyaan retention:

```text
Jika Person harus dihapus, apa yang terjadi pada Case?
Jika Evidence expired, apakah Decision masih bisa dijelaskan?
Jika tenant dihapus, shared reference tetap ada?
Jika data subject meminta deletion, apakah legal hold mencegah deletion?
```

### 29.1 Delete operation bisa merusak explanation

Jika evidence dihapus:

```text
Decision lama kehilangan basis.
```

Pattern:

- redact personal fields,
- preserve non-personal audit metadata,
- tombstone node,
- anonymize relationship,
- retain evidence under legal hold,
- detach from active graph but keep archive graph.

### 29.2 Tombstone pattern

```cypher
MATCH (p:Person {id: $id})
SET p.status = 'DELETED',
    p.deletedAt = datetime(),
    p.name = null,
    p.email = null,
    p.phone = null
```

Tetapi hati-hati: relationship yang tersisa masih bisa mengungkap identitas secara inferensial.

---

## 30. Confidentiality Classes

Untuk domain sensitif, berikan classification pada node/relationship/evidence.

Contoh:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
SEALED
LEGAL_PRIVILEGED
```

Graph:

```cypher
(:Evidence {classification: 'RESTRICTED'})
(:RelationshipAssertion {classification: 'SEALED'})
```

Query harus respect classification:

```cypher
MATCH (e:Evidence)
WHERE e.classification IN $allowedClassifications
RETURN e { .id, .type, .classification }
```

Untuk relationship:

```cypher
MATCH (a)-[r:SUPPORTED_BY]->(e)
WHERE r.classification IN $allowedRelationshipClasses
RETURN a, r, e
```

---

## 31. Relationship Redaction

Kadang node boleh terlihat, relationship tidak.

Contoh:

```text
Person P boleh terlihat sebagai public registry entity.
Company C juga boleh terlihat.
Tetapi P controls C adalah confidential investigation finding.
```

Jangan return raw graph:

```cypher
MATCH path = (p:Person)-[*1..2]-(c:Company)
RETURN path
```

Gunakan projection aman:

```cypher
MATCH (p:Person {id: $personId})
OPTIONAL MATCH (p)-[r:PUBLICLY_ASSOCIATED_WITH]->(c:Company)
RETURN p { .id, .displayName } AS person,
       collect(c { .id, .name }) AS publicCompanies
```

---

## 32. Derived Edges and Security

Derived edge adalah relationship yang dibuat dari hasil kalkulasi.

Contoh:

```cypher
(:Person)-[:LIKELY_RELATED_TO {confidence: 0.91, generatedBy: 'entity-resolution-v4'}]->(:Person)
```

Derived edge berisiko karena:

1. mungkin mengungkap evidence rahasia,
2. bisa dianggap fakta padahal probabilistik,
3. bisa stale,
4. bisa bias,
5. bisa sulit dipertanggungjawabkan.

Pattern aman:

```cypher
(:DerivedRelationship)-[:FROM_MODEL]->(:ModelVersion)
(:DerivedRelationship)-[:BASED_ON]->(:Evidence)
(:DerivedRelationship)-[:CONNECTS]->(:Entity)
(:DerivedRelationship {status: 'PROPOSED', confidence: 0.91})
```

Atau jika tetap memakai edge langsung:

```cypher
(:Person)-[:LIKELY_RELATED_TO {
  confidence: 0.91,
  modelVersion: 'er-v4.2',
  generatedAt: datetime(),
  status: 'PROPOSED',
  classification: 'RESTRICTED'
}]->(:Person)
```

Jangan campur derived edge dengan verified edge tanpa type/status jelas.

---

## 33. GDS Output Security

Graph Data Science menghasilkan score, communities, embeddings, predictions, dan ranking.

Output ini bisa sensitif.

Contoh:

```text
Community ID mengindikasikan orang berada dalam fraud ring.
Centrality score menunjukkan orang penting di jaringan.
Similarity score menghubungkan dua entity yang belum diverifikasi.
Embedding dapat mengandung informasi struktural dari graph sensitif.
```

Security checklist untuk GDS:

1. Apakah input graph sudah security-filtered?
2. Apakah output score boleh dilihat user?
3. Apakah community/cluster label dianggap sensitive?
4. Apakah embedding boleh diekspor?
5. Apakah model version disimpan?
6. Apakah algorithm config disimpan?
7. Apakah result bisa dijelaskan?
8. Apakah stale score dibedakan dari fresh score?
9. Apakah human review diperlukan sebelum action?
10. Apakah false positive impact dipahami?

---

## 34. API Design untuk Secure Graph Access

Jangan expose generic graph query API ke user biasa.

Berbahaya:

```http
POST /graph/query
{
  "cypher": "MATCH (n)-[r]-(m) RETURN n,r,m"
}
```

Ini hanya cocok untuk admin/debug environment sangat terbatas.

Lebih baik expose use-case API:

```http
GET /cases/{caseId}/summary
GET /cases/{caseId}/subjects
GET /cases/{caseId}/evidence-network
GET /cases/{caseId}/related-cases?depth=2
GET /entities/{entityId}/permitted-neighborhood
POST /cases/{caseId}/relationships/{relationshipId}/review
```

Setiap endpoint punya:

- authorization rule,
- allowed expansion,
- allowed projection,
- max depth,
- max result size,
- audit event,
- purpose.

---

## 35. Java Service Architecture for Secure Neo4j Access

Recommended layering:

```text
Controller/API
  ↓
Application Service
  ↓
Authorization Service
  ↓
Graph Query Service / Repository
  ↓
Neo4j Driver
```

Jangan biarkan controller langsung menjalankan Cypher arbitrary.

### 35.1 Request context

Buat context eksplisit:

```java
public record AccessContext(
    String userId,
    String tenantId,
    Set<String> roles,
    Set<String> permissions,
    Set<String> allowedClassifications,
    String purpose,
    String correlationId
) {}
```

### 35.2 Repository method harus menerima context

```java
public interface CaseGraphRepository {
    CaseNetworkView loadPermittedCaseNetwork(
        AccessContext context,
        String caseId,
        int maxDepth
    );
}
```

Jangan:

```java
CaseNetworkView loadCaseNetwork(String caseId);
```

Karena access context hilang.

### 35.3 Query parameterization

```java
Map<String, Object> params = Map.of(
    "tenantId", context.tenantId(),
    "userId", context.userId(),
    "caseId", caseId,
    "allowedClassifications", new ArrayList<>(context.allowedClassifications()),
    "maxDepth", maxDepth
);
```

Jangan string concatenation untuk label/type/property dari user input.

---

## 36. Secure Query Catalogue

Untuk production, buat query catalogue.

Setiap query dicatat:

```text
Query name
Purpose
Endpoint/service owner
Input parameters
Authorization precondition
Tenant filtering strategy
Allowed labels
Allowed relationship types
Allowed properties
Max depth
Max rows/nodes
Index/constraint dependency
Audit event emitted
PII exposure
Classification exposure
Performance profile
Failure mode
```

Contoh:

```text
Query: case.relatedCases.v1
Purpose: Find related cases through shared subject/address/company within 2 hops
Authorization: viewer must CAN_ACCESS case
Tenant: all nodes must tenantId = context.tenantId
Allowed rels: SUBJECT_OF, HAS_ADDRESS, OWNS, RELATED_TO
Max depth: 2
Max cases: 50
Return: case id, case number, status, relationship reason summary
Forbidden: evidence detail, confidential source, sealed relationship
Audit: CASE_RELATED_CASES_VIEWED
```

Ini membuat query defensible saat audit dan review.

---

## 37. Security Testing

Security tidak cukup dengan code review.

### 37.1 Unit tests

Test authorization service:

```text
user assigned to case → allowed
user not assigned → denied
supervisor of assignee → allowed
auditor outside jurisdiction → denied
sealed case without sealed_access → denied
```

### 37.2 Query tests

Gunakan dataset kecil yang sengaja berisi:

- tenant A dan tenant B,
- shared reference node,
- sealed case,
- confidential relationship,
- hidden evidence,
- high-degree node,
- derived edge,
- deleted/tombstoned node.

Test:

```text
Query tidak mengembalikan tenant lain.
Query tidak mengembalikan confidential relationship.
Query tidak melewati sealed intermediary.
Query tidak return raw node property sensitif.
Query bounded pada depth/result size.
```

### 37.3 Negative tests

Security test harus banyak negative case.

```text
Pastikan data tidak muncul.
Pastikan relationship tidak muncul.
Pastikan count tidak bocor.
Pastikan path tidak bocor.
Pastikan deleted/tombstoned data tidak muncul di active view.
```

---

## 38. Observability untuk Security

Monitor bukan hanya CPU/memory/query latency.

Security observability:

- failed auth attempts,
- privilege errors,
- unusual query patterns,
- large graph expand,
- high result cardinality,
- access to sealed/confidential data,
- break-glass access,
- admin role usage,
- query from unexpected service account,
- abnormal read volume by user,
- access outside normal business hours,
- repeated denied access,
- export/download behavior.

### 38.1 Query log review

Neo4j menyediakan logging untuk monitoring. Di production, query logs bisa membantu menemukan:

- slow query,
- dangerous expand,
- unexpected labels/relationship types,
- admin commands,
- high-cardinality scans.

Namun query logs sendiri bisa mengandung data sensitif. Perlakukan log sebagai sensitive artifact.

---

## 39. Failure Modes

### 39.1 Missing tenant filter

Query:

```cypher
MATCH (c:Case {id: $caseId})
RETURN c
```

Jika `caseId` tidak globally unique atau bug input, tenant leak.

Mitigasi:

```cypher
MATCH (c:Case {tenantId: $tenantId, id: $caseId})
RETURN c
```

Plus uniqueness constraint scoped by tenant.

---

### 39.2 Shared reference reverse traversal leak

Query:

```cypher
MATCH (:Regulation {code: $code})<-[:VIOLATES]-(c:Case)
RETURN c
```

Mitigasi:

```cypher
MATCH (:Regulation {code: $code})<-[:VIOLATES]-(c:Case {tenantId: $tenantId})
RETURN c
```

Atau pisahkan reference read path.

---

### 39.3 Generic expand endpoint

API:

```http
GET /graph/node/{id}/expand
```

Tanpa allowed relationship list.

Mitigasi:

- endpoint by use case,
- whitelist relationship type,
- max depth,
- max node count,
- authorization anchor.

---

### 39.4 Raw node return

Query:

```cypher
RETURN n
```

Bocor property sensitif.

Mitigasi:

```cypher
RETURN n { .id, .displayName, .status } AS n
```

---

### 39.5 Derived edge interpreted as verified fact

```text
LIKELY_RELATED_TO dibaca user sebagai RELATED_TO.
```

Mitigasi:

- type jelas,
- status jelas,
- confidence jelas,
- human review,
- UI wording benar,
- explanation tersedia.

---

### 39.6 Visualization over-disclosure

User melihat cluster/sealed relationship via graph shape.

Mitigasi:

- graph projection khusus per role,
- redacted view,
- no arbitrary expand,
- security trimming sebelum visualization.

---

### 39.7 Admin/service account overpowered

Aplikasi production memakai admin database account.

Mitigasi:

- dedicated service account,
- least privilege,
- separate migration account,
- separate read/write accounts,
- rotate credentials,
- monitor usage.

---

### 39.8 Audit trail incomplete

Decision bisa dilihat, tapi evidence basis hilang.

Mitigasi:

- append-only audit,
- evidence provenance,
- decision snapshot,
- model version,
- graph snapshot reference.

---

## 40. Regulatory Defensibility

Regulatory defensibility bukan hanya “data aman”.

Sistem defensible harus bisa menjawab:

```text
1. Data apa yang dipakai?
2. Dari mana data itu berasal?
3. Kapan data itu tersedia?
4. Siapa yang melihat/mengubah data?
5. Apa rule/model/query yang menghasilkan rekomendasi?
6. Apakah user punya hak saat mengakses?
7. Apakah decision bisa direproduksi?
8. Apakah evidence bisa diverifikasi?
9. Apakah data yang dilarang memang tidak dipakai?
10. Apakah perubahan setelah decision tidak mengubah explanation historis?
```

Graph sangat bagus untuk defensibility karena bisa menghubungkan:

- decision,
- evidence,
- source,
- actor,
- regulation,
- policy,
- workflow state,
- affected entity,
- review action.

Tetapi graph juga memperbesar risiko karena hubungan tersembunyi bisa muncul dengan satu traversal.

---

## 41. Defensible Case Decision Pattern

Contoh graph:

```text
(:Case)-[:HAS_DECISION]->(:Decision)
(:Decision)-[:DECIDED_BY]->(:Officer)
(:Decision)-[:APPROVED_BY]->(:Supervisor)
(:Decision)-[:BASED_ON]->(:Evidence)
(:Evidence)-[:EXTRACTED_FROM]->(:SourceDocument)
(:Decision)-[:APPLIES]->(:Regulation)
(:Decision)-[:USED_MODEL]->(:ModelVersion)
(:Decision)-[:USED_QUERY]->(:QueryVersion)
(:Decision)-[:HAS_EXPLANATION]->(:Explanation)
```

Keunggulan:

- audit trail eksplisit,
- evidence lineage jelas,
- decision tidak bergantung pada state graph terkini,
- query/model version tersimpan,
- review bisa dilakukan ulang.

---

## 42. Security Checklist untuk Neo4j Production

### 42.1 Identity and access

- [ ] Service account tidak memakai admin role.
- [ ] Human admin account dipisah dari application account.
- [ ] Role mengikuti least privilege.
- [ ] Dangerous operation dibatasi.
- [ ] Break-glass process ada dan diaudit.
- [ ] External IdP/OIDC/LDAP integration jelas jika dipakai.

### 42.2 Query safety

- [ ] Semua query sensitif punya security anchor.
- [ ] Tenant filter tidak opsional.
- [ ] Tidak ada arbitrary Cypher endpoint untuk user biasa.
- [ ] Tidak ada generic expand all.
- [ ] Semua traversal bounded.
- [ ] Relationship type whitelist.
- [ ] Raw node/relationship tidak dikembalikan ke API umum.
- [ ] Projection field eksplisit.

### 42.3 Multi-tenancy

- [ ] Tenant isolation model dipilih sesuai risk.
- [ ] Shared reference traversal dikontrol.
- [ ] Constraint tenant-aware.
- [ ] Per-tenant export/delete/backup strategy jelas.
- [ ] Cross-tenant analytics punya approval/security model.

### 42.4 Sensitive graph data

- [ ] Sensitive relationship type diidentifikasi.
- [ ] Classification model tersedia.
- [ ] Sealed/confidential data tidak ikut visualization umum.
- [ ] Derived edge punya status/confidence/provenance.
- [ ] GDS output diperlakukan sebagai sensitive data.

### 42.5 Audit and defensibility

- [ ] Business actions diaudit.
- [ ] Evidence provenance disimpan.
- [ ] Decision basis disimpan.
- [ ] Model/query version disimpan.
- [ ] Access purpose dicatat untuk domain sensitif.
- [ ] Historical explanation tidak bergantung pada mutable current graph.

---

## 43. Architecture Review Questions

Gunakan pertanyaan ini saat design review.

1. Apakah user bisa melihat relationship yang tidak boleh dilihat meskipun node boleh terlihat?
2. Apakah path query bisa melewati node/relationship yang tidak boleh diakses?
3. Apakah shared reference node membuka reverse traversal lintas tenant?
4. Apakah tenant isolation hanya bergantung pada developer selalu ingat `tenantId`?
5. Apakah API mengembalikan raw node/relationship?
6. Apakah graph visualization punya rule yang sama dengan backend API?
7. Apakah derived edge dibedakan dari verified fact?
8. Apakah score/cluster/community dari GDS dianggap sensitif?
9. Apakah evidence yang mendukung decision bisa dilacak?
10. Apakah decision lama masih bisa dijelaskan setelah graph berubah?
11. Apakah admin/service account terlalu powerful?
12. Apakah query log sendiri dilindungi?
13. Apakah delete operation menghancurkan audit trail?
14. Apakah break-glass access benar-benar time-limited dan reviewed?
15. Apakah security tests mencakup negative path, bukan hanya allowed path?

---

## 44. Mental Model Ringkas

Security pada graph database bukan hanya:

```text
Can user read this node?
```

Tetapi:

```text
Can user know this relationship exists?
Can user traverse this path?
Can user infer this connection?
Can user see this aggregate?
Can user see this derived score?
Can user reproduce this decision?
Can auditor understand why access was allowed?
```

Graph adalah mesin koneksi. Maka security graph adalah security atas koneksi.

---

## 45. Ringkasan

Part ini membangun fondasi security dan defensibility untuk graph system:

1. Graph leakage bisa muncul dari node, relationship, path, degree, absence, derived edge, dan visualization.
2. Neo4j menyediakan RBAC, built-in/custom roles, privileges, dan fine-grained access control, tetapi business authorization kompleks tetap sering perlu application/query-level enforcement.
3. Multi-tenancy bisa dilakukan dengan tenant property, tenant label, database per tenant, atau cluster per tenant/class. Pilihan harus mengikuti isolation, cost, compliance, dan operational lifecycle.
4. Security trimming adalah pattern wajib untuk graph API sensitif.
5. Relationship type dan path harus diperlakukan sebagai data sensitif.
6. Provenance, evidence graph, decision snapshot, model version, dan query version penting untuk regulatory defensibility.
7. GDS output, embeddings, communities, dan derived edges harus dianggap sensitive artifact.
8. Jangan expose generic graph expand/query kepada user biasa.
9. Query catalogue dan security tests membantu membuat graph system maintainable dan auditable.
10. Sistem graph regulated harus bisa menjawab bukan hanya “apa hasilnya”, tetapi “mengapa, dari sumber apa, oleh siapa, pada waktu apa, dan dengan hak akses apa”.

---

## 46. Latihan

### Latihan 1 — Identify Leakage

Diberikan graph:

```text
(:Person)-[:SUBJECT_OF]->(:Case)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Evidence)-[:PROVIDED_BY]->(:ConfidentialSource)
(:Case)-[:VIOLATES]->(:Regulation)
```

Tentukan leakage apa yang bisa terjadi jika endpoint mengembalikan:

```cypher
MATCH path = (:Case {id: $caseId})-[*1..3]-(x)
RETURN path
```

Jawab dengan kategori:

- node leakage,
- relationship leakage,
- path leakage,
- source leakage,
- inference leakage.

### Latihan 2 — Tenant Boundary

Desain dua model tenant:

1. menggunakan `tenantId` property,
2. menggunakan database per tenant.

Bandingkan untuk requirement:

```text
- 200 tenant kecil,
- 3 tenant enterprise besar,
- cross-tenant fraud analytics,
- per-tenant deletion,
- strict legal isolation.
```

### Latihan 3 — Secure Query Rewrite

Rewrite query ini agar tenant-safe dan role-aware:

```cypher
MATCH path = (c:Case {id: $caseId})-[*1..4]-(x)
RETURN path
```

Tambahkan:

- user access anchor,
- tenant boundary,
- allowed relationship types,
- max depth,
- property projection.

### Latihan 4 — Evidence Defensibility

Modelkan graph untuk keputusan enforcement:

```text
Decision D dibuat oleh Officer O,
disetujui Supervisor S,
berdasarkan Evidence E1 dan E2,
E1 berasal dari SourceDocument SD1,
D menerapkan Regulation R,
D menggunakan risk model version M.
```

Tuliskan Cypher `CREATE`-nya.

### Latihan 5 — Security Test Dataset

Buat minimal dataset untuk menguji:

- tenant leak,
- confidential relationship leak,
- sealed case,
- unauthorized path traversal,
- derived edge exposure,
- deleted/tombstoned node.

---

## 47. Referensi Resmi untuk Diperdalam

Gunakan dokumentasi resmi Neo4j sesuai versi yang dipakai di production:

- Neo4j Operations Manual — Authentication and authorization.
- Neo4j Operations Manual — Role-based access control and privileges.
- Neo4j Operations Manual — Built-in roles and custom roles.
- Neo4j Operations Manual — Attribute-based access control jika memakai OIDC/ABAC.
- Neo4j Operations Manual — Logging and monitoring.
- Neo4j Cypher Manual — Access control and administration commands.
- Neo4j Java Driver Manual — session, transaction, retry, authentication, routing.
- Neo4j Graph Data Science Manual — graph projections and algorithm output handling.

---

## 48. Status Seri

```text
Part 000 selesai — Orientation
Part 001 selesai — Graph Thinking
Part 002 selesai — Property Graph Model
Part 003 selesai — Neo4j Architecture
Part 004 selesai — Cypher Fundamentals
Part 005 selesai — Cypher Path Semantics
Part 006 selesai — Graph Modelling Methodology
Part 007 selesai — Advanced Graph Modelling Patterns
Part 008 selesai — Anti-Patterns in Graph Modelling
Part 009 selesai — Schema, Constraints, Indexes, and Data Integrity
Part 010 selesai — Write Modelling, MERGE, Idempotency, and Concurrency
Part 011 selesai — Query Performance, PROFILE, EXPLAIN, and Plan Tuning
Part 012 selesai — Supernodes, Dense Graphs, and Traversal Explosion
Part 013 selesai — Java Application Integration with Neo4j
Part 014 selesai — Spring Data Neo4j
Part 015 selesai — Data Import, ETL, CDC, and Graph Projection Pipelines
Part 016 selesai — Transactions, Consistency, and Correctness in Graph Workloads
Part 017 selesai — Neo4j Operations
Part 018 selesai — Neo4j Clustering and High Availability
Part 019 selesai — Security, Access Control, Multi-Tenancy, and Regulatory Defensibility

Seri belum selesai.
Masih ada Part 020 sampai Part 032.
```

Lanjut berikutnya:

```text
learn-graph-database-and-neo4j-mastery-for-java-engineers-part-020.md
```

Topik:

```text
APOC and Neo4j Tooling Ecosystem
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Neo4j Clustering and High Availability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-020.md">Part 020 — APOC and Neo4j Tooling Ecosystem ➡️</a>
</div>
