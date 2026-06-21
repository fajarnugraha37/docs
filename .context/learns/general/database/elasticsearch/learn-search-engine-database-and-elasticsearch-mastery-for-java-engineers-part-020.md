# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-020.md

# Part 020 — Security, Authorization, and Permission-Aware Search

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Bagian: `020 / 034`  
> Fokus: security model, authorization boundary, permission-aware search, tenant isolation, field/document protection, data leakage through search UX, auditability, dan regulatory defensibility.  
> Target pembaca: Java software engineer / tech lead yang membangun search platform production-grade untuk sistem enterprise, internal knowledge search, case management, regulatory systems, evidence/document retrieval, dan aplikasi multi-tenant.

---

## 0. Posisi Part Ini Dalam Seri

Sampai bagian sebelumnya, kita sudah membangun fondasi dari sisi retrieval:

- search problem dan relevance;
- inverted index dan information retrieval;
- Lucene internals;
- Elasticsearch architecture;
- document modeling;
- mapping;
- text analysis;
- Query DSL;
- relevance engineering;
- filtering/faceting;
- pagination;
- indexing pipeline;
- consistency/freshness;
- Java integration;
- backend Search API design;
- autocomplete/suggest/highlight;
- multilingual dan domain-specific search.

Bagian ini membahas pertanyaan yang sering terlambat dipikirkan:

> “Siapa yang boleh melihat hasil search ini, field apa yang boleh terlihat, aggregate count apa yang aman ditampilkan, dan bagaimana kita membuktikan bahwa search tidak membocorkan data?”

Dalam sistem kecil, security search sering dianggap sekadar filter tambahan:

```json
{
  "term": {
    "tenant_id": "tenant-a"
  }
}
```

Dalam sistem enterprise, pendekatan itu terlalu sederhana. Search bukan hanya list of hits. Search bisa membocorkan informasi melalui:

- result hit;
- `_source`;
- field projection;
- highlight snippet;
- suggest/autocomplete;
- facet counts;
- aggregation buckets;
- total hit count;
- error messages;
- timing behavior;
- cache behavior;
- exported results;
- stale index;
- alias salah;
- debug endpoint;
- log query;
- observability payload;
- embedding/vector retrieval metadata;
- RAG context sent to LLM.

Security Elasticsearch harus dipahami sebagai kombinasi beberapa lapisan:

1. **Cluster security** — siapa boleh konek ke cluster.
2. **Index/data access** — index atau data stream mana yang boleh dibaca/ditulis.
3. **Document-level authorization** — dokumen mana yang boleh muncul.
4. **Field-level authorization** — field mana yang boleh dibaca.
5. **Application-level authorization** — aturan bisnis yang tidak cukup diekspresikan oleh RBAC/index privileges.
6. **Search UX leakage control** — count, facet, highlight, suggestion, dan export.
7. **Operational security** — secret handling, audit logs, runbook, incident response.
8. **Governance** — review, test, migration, ownership, dan policy drift detection.

Materi ini tidak mengulang dasar authentication/authorization umum secara luas. Fokus kita: **bagaimana security berubah ketika data diakses melalui search engine**.

---

## 1. Mental Model Utama: Search Adalah Visibility Function

Search system sebaiknya dipandang sebagai fungsi:

```text
search(user, query, context) -> visible ranked results
```

Bukan:

```text
search(query) -> ranked results
```

Parameter `user` dan `context` bukan detail tambahan. Mereka bagian dari definisi search.

Search yang benar untuk Alice belum tentu benar untuk Bob, walaupun query string sama.

Contoh:

```text
Query: "fraud investigation"

Alice = investigator untuk region Jakarta
Bob   = reviewer nasional
Carol = external auditor limited scope
Dave  = case officer untuk satu case tertentu
```

Hasil search yang aman berbeda untuk masing-masing:

- Alice boleh melihat case region Jakarta.
- Bob boleh melihat case lintas region.
- Carol hanya boleh melihat dokumen yang sudah disanitasi.
- Dave boleh melihat case yang ditugaskan kepadanya, tetapi tidak semua evidence internal.

Maka search security bukan hanya “login sudah valid”. Search security adalah:

```text
for every returned item:
  user has permission to know that item exists
  user has permission to see the returned fields
  user has permission to see snippets/highlights
  user has permission to see facet/count contribution
  user has permission to export/save/share the result
```

Top-tier engineer tidak bertanya:

> “Apakah query search ini sudah jalan?”

Tetapi:

> “Apakah semua channel output dari search ini aman untuk principal ini, pada waktu ini, dengan policy versi ini?”

---

## 2. Security Boundary: Elasticsearch vs Application

Ada dua ekstrem desain yang sama-sama berbahaya.

### 2.1 Ekstrem 1 — Semua Security Diserahkan Ke Aplikasi

Aplikasi mengambil hasil dari Elasticsearch lalu memfilter di Java:

```java
List<Result> raw = elasticsearch.search(query);
List<Result> visible = raw.stream()
    .filter(result -> authz.canView(user, result))
    .toList();
```

Ini terlihat fleksibel, tetapi berbahaya.

Masalahnya:

1. **Top-K ranking rusak**  
   Elasticsearch mengembalikan top 20 global, lalu aplikasi membuang 15 item. User hanya melihat 5 item, padahal ada ratusan authorized item di bawah ranking global.

2. **Facet count bocor**  
   Aggregation dihitung sebelum filter aplikasi. Count bisa mencerminkan dokumen yang user tidak boleh tahu.

3. **Total hit bocor**  
   `hits.total` bisa memberi tahu bahwa ada ribuan dokumen terkait keyword tertentu.

4. **Highlight bocor**  
   Snippet mungkin sudah dibuat dari field sensitif sebelum aplikasi membuang field.

5. **Network/log bocor**  
   Data tidak authorized sudah keluar dari Elasticsearch ke aplikasi, dan mungkin masuk log/trace/error.

6. **Performance buruk**  
   Aplikasi harus fetch lebih banyak data untuk menyaring hasil.

7. **Semantik search tidak stabil**  
   Page 1 bisa kosong setelah filter, page berikutnya berisi hasil, ranking terlihat aneh.

Kesimpulan:

> Application-side post-filtering boleh dipakai sebagai defense-in-depth, tetapi tidak boleh menjadi satu-satunya mekanisme authorization untuk interactive search.

### 2.2 Ekstrem 2 — Semua Security Diserahkan Ke Elasticsearch

Elasticsearch mendukung role-based access, index privileges, document-level security, field-level security, dan API keys. Itu kuat, tetapi tidak berarti semua policy domain otomatis cocok dimasukkan ke Elasticsearch.

Masalahnya:

1. **Policy domain bisa kompleks**  
   Contoh: case boleh dilihat jika user adalah assigned investigator, supervisor chain, regional reviewer, temporary delegate, auditor dengan warrant tertentu, atau member panel selama window waktu tertentu.

2. **Policy sering bergantung pada state eksternal**  
   Permission bisa berubah karena assignment, escalation, hold, conflict of interest, recusal, organization restructure.

3. **Policy bisa temporal**  
   User boleh melihat dokumen sampai tanggal tertentu, setelah itu akses dicabut.

4. **Policy bisa field-dependent**  
   User boleh melihat metadata case, tetapi tidak witness statement.

5. **Policy bisa action-dependent**  
   Search preview boleh, detail view tidak boleh. Export boleh hanya untuk role tertentu.

6. **Policy bisa audit-dependent**  
   Beberapa akses harus logged dengan reason.

Jika semua dimasukkan ke DLS/FLS secara naif, Anda bisa membuat role explosion, query role yang terlalu kompleks, dan policy drift antara sistem utama dan index.

Kesimpulan:

> Elasticsearch security harus dipakai sebagai enforcement layer yang kuat, tetapi domain authorization tetap perlu dimodelkan secara eksplisit di aplikasi dan pipeline indexing.

### 2.3 Model Yang Lebih Sehat

Desain yang matang biasanya memakai beberapa lapisan:

```text
[User / Service Principal]
        |
        v
[Application Search API]
  - authenticate caller
  - derive principal context
  - validate query contract
  - inject authorization filters
  - restrict fields/highlights/facets/sorts
  - enforce rate limit and export policy
        |
        v
[Elasticsearch]
  - TLS/authentication
  - API key/service credential
  - least privilege index access
  - optional DLS/FLS for strong guardrail
  - index alias/data stream isolation
        |
        v
[Audit/Observability]
  - who searched what
  - what policy was applied
  - how many visible results
  - anomalous queries/export
```

Application Search API tetap menjadi policy decision point dan policy enforcement coordinator. Elasticsearch menjadi data retrieval engine dengan guardrail security.

---

## 3. Threat Model Khusus Search

Sebelum memilih fitur security, buat threat model. Search memiliki ancaman khas.

### 3.1 Unauthorized Result Disclosure

User menerima dokumen yang tidak boleh ia lihat.

Penyebab umum:

- filter permission lupa ditambahkan pada endpoint tertentu;
- search endpoint internal dibuka ke UI;
- alias mengarah ke index salah;
- DLS role salah;
- backfill index tidak mengisi field permission;
- stale permission setelah assignment berubah;
- delete/revocation event gagal diproses;
- nested permission tidak dimodelkan benar;
- result collapsing mengembalikan inner hit yang tidak difilter;
- highlight field sensitif muncul.

### 3.2 Existence Disclosure

User tidak melihat dokumen, tetapi bisa menyimpulkan dokumen ada.

Contoh:

- total hits menunjukkan `12` hasil untuk nama saksi rahasia;
- autocomplete menyarankan nama orang yang tidak boleh diketahui;
- facet count menunjukkan ada case di kategori sensitif;
- error “document not authorized” berbeda dari “document not found”;
- response time berbeda antara dokumen ada dan tidak ada.

Dalam sistem regulasi/hukum, keberadaan dokumen bisa sama sensitifnya dengan isi dokumen.

### 3.3 Field Disclosure

User boleh melihat dokumen, tetapi tidak semua field.

Contoh:

- boleh lihat title dan case number;
- tidak boleh lihat whistleblower name;
- tidak boleh lihat internal legal advice;
- boleh lihat redacted summary;
- tidak boleh lihat raw evidence attachment;
- boleh lihat decision status;
- tidak boleh lihat draft recommendation.

Risiko muncul dari:

- `_source` dikembalikan penuh;
- highlight mengambil field raw;
- sort menggunakan field sensitif lalu leak lewat ordering;
- aggregation pada field sensitif;
- debug/explain memperlihatkan field score contribution;
- logs menyimpan response body.

### 3.4 Aggregation Leakage

Facet dan aggregation adalah channel bocor yang sering diremehkan.

Contoh:

```text
User mencari: "Company X"
Facet:
  Enforcement Action: 1
  Closed: 0
  Criminal Referral: 1
```

Walaupun user tidak menerima dokumen detail, facet count bisa mengungkap bahwa Company X terkait criminal referral.

Search UX harus menjawab:

> Apakah count dihitung hanya dari dokumen yang user boleh lihat?

Jika ya, aman secara umum. Jika tidak, bocor.

### 3.5 Suggestion and Autocomplete Leakage

Autocomplete sering dibangun dari index khusus yang lebih longgar.

Contoh:

User mengetik `jo...`, sistem menyarankan:

```text
John Doe - Protected Witness
```

Ini bocor walaupun search utama aman.

Autocomplete harus punya permission model juga. Pilihannya:

- suggestion hanya dari public/visible vocabulary;
- suggestion index per tenant/role;
- suggestion difilter dengan permission field;
- suggestion hanya untuk non-sensitive term;
- disable suggestion untuk field sensitif.

### 3.6 Stale Permission Leakage

Search index adalah turunan dari source-of-truth. Jika permission berubah di canonical system tetapi index belum update, user bisa melihat data lama.

Contoh:

```text
09:00 Alice removed from case C-123
09:00 Canonical DB updated
09:00 Event publish fails
09:05 Alice searches C-123
09:05 Elasticsearch still says Alice has access
```

Ini bukan sekadar consistency issue. Ini security incident.

Untuk permission-sensitive systems, revocation latency harus menjadi explicit SLO.

### 3.7 Service Credential Abuse

Backend sering memakai satu credential kuat untuk search. Jika Search API punya bug, user bisa memicu query luas.

Contoh:

- frontend mengirim raw Query DSL;
- user menambahkan `match_all`;
- user menghapus permission filter;
- user meminta `_source: true`;
- user meminta aggregation field sensitif;
- user mengeksploitasi expensive wildcard query.

Search API tidak boleh menjadi proxy bebas ke Elasticsearch.

### 3.8 Query Log Leakage

Query string bisa berisi data pribadi atau rahasia:

```text
"John Doe corruption witness internal memo"
```

Jika query masuk log, observability, APM, error tracing, BI analytics, atau third-party monitoring, data bisa bocor.

Search logging harus disanitasi dan diklasifikasikan.

---

## 4. Elasticsearch Security Building Blocks

Elasticsearch menyediakan beberapa mekanisme security utama. Untuk desain production, pahami fungsi dan batasnya.

### 4.1 Authentication

Authentication menjawab:

> Siapa yang memanggil Elasticsearch?

Di sisi cluster, akses biasanya memakai:

- username/password untuk user/admin tertentu;
- API key untuk service/application;
- token/service account pada beberapa deployment;
- TLS client certificate pada arsitektur tertentu;
- integration-specific credentials.

Dalam aplikasi Java production, hindari memakai superuser credential. Gunakan service credential dengan least privilege.

Bad smell:

```text
Search API menggunakan elastic superuser karena “lebih gampang”.
```

Konsekuensinya:

- bug aplikasi menjadi full cluster compromise;
- credential leak berdampak besar;
- audit tidak granular;
- tidak ada pembatasan index/action;
- sulit rotasi.

### 4.2 Authorization / RBAC

Elasticsearch Role-Based Access Control mengatur privileges terhadap cluster dan indices. Role dapat memberi privilege seperti read/write/manage terhadap index tertentu.

Contoh konsep:

```text
Role: search_api_reader
  indices: case-search-v*
  privileges: read, view_index_metadata

Role: indexing_worker_writer
  indices: case-search-v*
  privileges: create_index, write, create_doc, delete, view_index_metadata

Role: search_admin
  indices: case-search-v*
  privileges: manage, read, write
```

Gunakan separation of duty:

- search API tidak perlu write;
- indexing worker tidak perlu membaca semua field untuk UI;
- migration job punya privilege terbatas dan temporary;
- observability job tidak perlu full `_source` sensitif;
- admin role tidak dipakai runtime.

### 4.3 Index-Level Security

Index-level security mengatur index/data stream mana yang bisa diakses.

Contoh isolation:

```text
tenant-a-cases-search-v1
tenant-b-cases-search-v1
```

Role tenant A hanya bisa read `tenant-a-*`.

Keuntungan:

- boundary sederhana;
- risiko query filter lupa lebih kecil;
- blast radius per tenant;
- operation bisa dilakukan per tenant.

Kelemahan:

- index explosion;
- shard overhead;
- sulit cross-tenant admin search;
- migration lebih banyak;
- relevance statistics per tenant bisa kecil;
- capacity imbalance.

Index-level security cocok jika tenant besar, regulated, dan isolation requirement kuat.

### 4.4 Document-Level Security / DLS

Document-level security membatasi dokumen yang dapat diakses oleh role berdasarkan query filter. Elastic mendokumentasikan bahwa akses dapat dikontrol pada level dokumen dan field dalam data stream atau index melalui role permissions.

Contoh konseptual DLS:

```json
{
  "indices": [
    {
      "names": ["case-search-*"],
      "privileges": ["read"],
      "query": {
        "term": {
          "tenant_id": "tenant-a"
        }
      }
    }
  ]
}
```

DLS baik untuk guardrail kuat:

- tenant filter;
- department filter;
- environment separation;
- public/private basic filter;
- “only published documents” untuk consumer-facing search.

Namun DLS bukan obat semua masalah. Hati-hati untuk policy yang sangat dinamis atau kompleks.

### 4.5 Field-Level Security / FLS

Field-level security membatasi field yang bisa dibaca. Elastic mendokumentasikan FLS sebagai mekanisme untuk membatasi field yang user punya akses baca dari document-based read APIs.

Contoh konseptual:

```json
{
  "field_security": {
    "grant": [
      "case_id",
      "case_number",
      "title",
      "status",
      "public_summary",
      "opened_at"
    ]
  }
}
```

FLS berguna untuk:

- membedakan internal vs external view;
- menyembunyikan PII;
- membatasi raw content;
- membuat redacted search experience;
- memisahkan metadata dari detail field.

Tetapi FLS tidak menggantikan desain document projection. Jika banyak role punya field visibility berbeda, sering lebih bersih membuat field projection eksplisit:

```json
{
  "case_id": "C-123",
  "public_title": "Investigation summary",
  "internal_title": "Investigation involving confidential witness",
  "public_summary": "Redacted summary...",
  "internal_summary": "Full internal summary...",
  "sensitivity": "CONFIDENTIAL"
}
```

Lalu Search API memilih field yang boleh dikembalikan dan di-highlight.

### 4.6 API Keys

API key digunakan untuk authentication dan authorization service/application. Elastic mendokumentasikan bahwa API keys adalah mekanisme security untuk mengautentikasi dan mengotorisasi akses ke deployments dan Elasticsearch resources. Pada API create key, jika expiration tidak diberikan, key bisa tidak kedaluwarsa; ini harus diperlakukan sebagai risiko operasional.

Praktik sehat:

- buat API key per service;
- batasi role descriptors;
- berikan expiration untuk key temporary;
- rotasi key berkala;
- invalidasi key saat service retired;
- jangan embed key di frontend;
- simpan di secret manager;
- audit usage;
- gunakan key berbeda untuk read/search, indexing, migration, admin.

Contoh separation:

```text
case-search-api-prod-read-key
case-indexer-prod-write-key
case-reindexer-prod-temp-key
case-search-api-staging-read-key
```

Bad smell:

```text
Satu API key dipakai semua service dan environment.
```

### 4.7 Audit Logging

Audit logging menjawab:

> Siapa mengakses apa, kapan, lewat jalur mana, dengan hasil apa?

Untuk search, audit bukan hanya cluster audit. Aplikasi juga harus mencatat intent dan policy context.

Minimal audit event untuk search:

```json
{
  "event_type": "SEARCH_EXECUTED",
  "timestamp": "2026-06-21T10:15:00Z",
  "principal_id": "user-123",
  "principal_roles": ["INVESTIGATOR"],
  "tenant_id": "tenant-a",
  "endpoint": "POST /cases/search",
  "query_class": "case_keyword_search",
  "query_hash": "sha256:...",
  "filters_applied": ["tenant", "assigned_region", "sensitivity"],
  "requested_fields": ["case_number", "title", "status"],
  "returned_count": 20,
  "total_visible_hits_relation": "gte",
  "policy_version": "case-search-authz-v17",
  "correlation_id": "..."
}
```

Jangan selalu log raw query. Query bisa PII. Gunakan hash, redaction, atau classified logging tergantung kebutuhan.

---

## 5. Permission-Aware Search: Definisi Yang Benar

Permission-aware search bukan hanya menambahkan filter.

Definisi matang:

> Permission-aware search adalah desain search di mana semua input, query execution, ranking, fields, highlights, facets, suggestions, pagination, exports, logs, dan downstream usage dibatasi oleh authorization context principal secara konsisten dan dapat diaudit.

Mari pecah menjadi komponen.

### 5.1 Principal Context

Sebelum membangun query Elasticsearch, aplikasi harus membangun `SearchPrincipalContext`.

Contoh Java-style:

```java
public record SearchPrincipalContext(
    String userId,
    String tenantId,
    Set<String> roles,
    Set<String> groups,
    Set<String> regions,
    Set<String> assignedCaseIds,
    Set<String> clearanceLevels,
    boolean canViewSensitive,
    boolean canExport,
    String policyVersion
) {}
```

Context ini bukan sekadar user profile. Ini snapshot authorization untuk request ini.

Sumbernya bisa dari:

- identity provider;
- RBAC service;
- case assignment service;
- delegation service;
- organization hierarchy;
- clearance/sensitivity service;
- policy engine;
- request-scoped purpose/reason.

### 5.2 Authorization Predicate

Dari principal context, bangun predicate:

```text
document is visible if:
  document.tenant_id == principal.tenant_id
  AND document.lifecycle_state in allowed states
  AND document.visibility_scope intersects principal visibility scopes
  AND document.sensitivity <= principal.clearance
  AND (
      document.assigned_user_ids contains principal.user_id
      OR document.assigned_group_ids intersects principal.groups
      OR principal has supervisor override
      OR document.public_to_role intersects principal.roles
  )
```

Di Elasticsearch, ini menjadi `bool.filter`.

Contoh konseptual:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenant_id": "tenant-a" } },
      { "terms": { "lifecycle_state": ["OPEN", "UNDER_REVIEW", "CLOSED"] } },
      { "terms": { "visibility_scope": ["REGION_JKT", "GROUP_ENF_A"] } },
      { "range": { "sensitivity_rank": { "lte": 30 } } }
    ],
    "should": [
      { "term": { "assigned_user_ids": "user-123" } },
      { "terms": { "assigned_group_ids": ["grp-1", "grp-7"] } },
      { "terms": { "public_to_roles": ["INVESTIGATOR"] } }
    ],
    "minimum_should_match": 1
  }
}
```

Tetapi hati-hati: struktur `bool` permission harus diuji sangat ketat. Kesalahan `should` tanpa `minimum_should_match` bisa membuka akses secara tidak sengaja, tergantung kombinasi `must/filter` lain.

### 5.3 Authorized Field Projection

Search API harus menentukan field yang boleh keluar.

Contoh:

```java
public record FieldPolicy(
    Set<String> sourceIncludes,
    Set<String> sourceExcludes,
    Set<String> highlightFields,
    Set<String> allowedSortFields,
    Set<String> allowedFacetFields
) {}
```

Untuk role eksternal:

```text
sourceIncludes:
  case_number
  public_title
  public_summary
  status
  opened_at

highlightFields:
  public_title
  public_summary

allowedFacetFields:
  status
  public_category
  opened_year

not allowed:
  internal_notes
  witness_names
  legal_advice
  raw_evidence_text
```

### 5.4 Authorized Aggregation

Aggregation hanya boleh dihitung atas dokumen visible. Secara umum, permission filter harus berada di query utama, bukan hanya post-filter.

Aman:

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "tenant-a" } },
        { "terms": { "visibility_scope": ["REGION_JKT"] } }
      ],
      "must": [
        { "match": { "content": "fraud" } }
      ]
    }
  },
  "aggs": {
    "by_status": {
      "terms": {
        "field": "status"
      }
    }
  }
}
```

Berbahaya:

```json
{
  "query": {
    "match": {
      "content": "fraud"
    }
  },
  "post_filter": {
    "term": {
      "tenant_id": "tenant-a"
    }
  },
  "aggs": {
    "by_status": {
      "terms": {
        "field": "status"
      }
    }
  }
}
```

`post_filter` memfilter hits setelah aggregations dihitung. Ini berguna untuk beberapa facet UX, tetapi jika dipakai untuk security filter, aggregation bisa bocor.

Rule:

> Security filter harus diterapkan sebelum hit dan aggregation dihitung.

### 5.5 Authorized Highlight

Highlight harus dibatasi ke field yang boleh dilihat. Jangan highlight raw sensitive content lalu mengandalkan `_source` filtering.

Berbahaya:

```json
{
  "highlight": {
    "fields": {
      "raw_evidence_text": {}
    }
  }
}
```

Jika user tidak boleh melihat `raw_evidence_text`, field itu tidak boleh masuk highlight request.

### 5.6 Authorized Suggestion

Suggestion/autocomplete harus memakai authorization juga.

Pilihan desain:

1. **Public-only suggestion**  
   Hanya suggest vocabulary yang tidak sensitif.

2. **Tenant-scoped suggestion**  
   Filter `tenant_id`.

3. **Permission-scoped suggestion**  
   Dokumen suggestion punya visibility fields.

4. **No sensitive field suggestion**  
   Jangan suggest witness name, sealed case, confidential organization, raw evidence term.

5. **Two-tier suggestion**  
   Generic suggestions untuk semua; authorized entity suggestions untuk user tertentu.

### 5.7 Authorized Export

Export sering lebih sensitif daripada search.

Search page menampilkan 20 hasil. Export bisa mengambil 100.000 hasil.

Policy export harus terpisah:

```text
canSearch != canExport
canViewSummary != canExportRaw
canExportMetadata != canExportEvidence
```

Export harus:

- memakai permission filter yang sama;
- membatasi fields;
- membatasi jumlah;
- audit reason;
- mungkin membutuhkan approval;
- menghasilkan artifact yang diberi retention/expiration;
- diberi watermark atau access control.

---

## 6. Tenant Isolation Models

Multi-tenant search memiliki beberapa model. Tidak ada satu jawaban universal.

### 6.1 Model A — Index Per Tenant

```text
tenant-a-cases-v1
tenant-b-cases-v1
tenant-c-cases-v1
```

Search tenant A hanya ke index tenant A.

Kelebihan:

- isolation kuat;
- mudah menghapus tenant;
- index-level security sederhana;
- mapping bisa berbeda per tenant jika perlu;
- operasional incident per tenant lebih terlokalisasi.

Kekurangan:

- shard/index explosion;
- overhead cluster state;
- tenant kecil boros;
- cross-tenant search sulit;
- migration banyak index;
- capacity imbalance.

Cocok untuk:

- tenant besar;
- regulated isolation;
- data residency berbeda;
- enterprise customer dedicated;
- strict contractual isolation.

### 6.2 Model B — Shared Index With Tenant Filter

```text
cases-search-v1
  tenant_id: tenant-a | tenant-b | tenant-c
```

Setiap search menambahkan filter `tenant_id`.

Kelebihan:

- lebih hemat shard;
- operasional sederhana;
- relevance statistics lebih besar;
- cross-tenant admin search mudah;
- schema governance lebih seragam.

Kekurangan:

- filter tenant wajib benar;
- bug bisa cross-tenant leakage;
- noisy neighbor;
- delete tenant lebih rumit;
- field/mapping harus seragam;
- DLS/application filter sangat penting.

Cocok untuk:

- banyak tenant kecil;
- SaaS umum;
- isolation logical cukup;
- search workload sedang.

### 6.3 Model C — Hybrid

```text
shared-small-tenants-cases-v1
enterprise-tenant-a-cases-v1
enterprise-tenant-b-cases-v1
```

Gabungan:

- tenant kecil di shared index;
- tenant besar/regulated di dedicated index;
- admin search punya mekanisme khusus.

Ini sering paling realistis.

### 6.4 Model D — Routing by Tenant

Shared index tetapi routing menggunakan tenant id.

```text
_index: cases-search-v1
_routing: tenant-a
```

Tujuan:

- query tenant hanya menyentuh shard tertentu;
- locality lebih baik;
- mengurangi fan-out.

Risiko:

- tenant besar membuat shard panas;
- routing salah bisa document “hilang” dari query;
- rebalancing tidak trivial;
- harus konsisten pada indexing dan search.

Routing bisa membantu performance, tetapi bukan security boundary utama.

---

## 7. Modeling Permission Fields Dalam Document

Search authorization hanya bisa efisien jika permission-relevant fields tersedia di index.

### 7.1 Minimal Permission Fields

Untuk multi-tenant enterprise:

```json
{
  "tenant_id": "tenant-a",
  "visibility_scope_ids": ["region:jkt", "division:enforcement"],
  "allowed_user_ids": ["user-123", "user-456"],
  "allowed_group_ids": ["grp-investigator-jkt"],
  "allowed_role_ids": ["role-supervisor"],
  "sensitivity_rank": 30,
  "lifecycle_state": "UNDER_REVIEW",
  "is_deleted": false,
  "embargo_until": "2026-07-01T00:00:00Z"
}
```

Tipe mapping biasanya:

```json
{
  "tenant_id": { "type": "keyword" },
  "visibility_scope_ids": { "type": "keyword" },
  "allowed_user_ids": { "type": "keyword" },
  "allowed_group_ids": { "type": "keyword" },
  "allowed_role_ids": { "type": "keyword" },
  "sensitivity_rank": { "type": "integer" },
  "lifecycle_state": { "type": "keyword" },
  "is_deleted": { "type": "boolean" },
  "embargo_until": { "type": "date" }
}
```

Permission fields harus `keyword`/numeric/date yang filter-friendly, bukan `text` analyzed field.

### 7.2 ACL Expansion vs Policy Attribute Model

Ada dua pendekatan utama.

#### ACL Expansion

Dokumen menyimpan explicit allowed users/groups:

```json
{
  "allowed_user_ids": ["u1", "u2", "u3"],
  "allowed_group_ids": ["g1", "g2"]
}
```

Kelebihan:

- query sederhana;
- mudah dievaluasi oleh Elasticsearch;
- cocok untuk document-level permissions.

Kekurangan:

- ACL besar meningkatkan index size;
- permission change bisa memerlukan update banyak dokumen;
- group membership change tidak selalu langsung reflected;
- stale ACL risk.

#### Policy Attribute Model

Dokumen menyimpan attributes:

```json
{
  "region": "JKT",
  "case_type": "ENFORCEMENT",
  "sensitivity_rank": 30,
  "owning_unit": "unit-a"
}
```

Aplikasi membangun filter berdasarkan principal attributes:

```text
region in principal.regions
AND sensitivity <= principal.clearance
AND owning_unit in principal.units
```

Kelebihan:

- index lebih ringkas;
- group changes tidak selalu perlu reindex;
- lebih cocok untuk ABAC.

Kekurangan:

- query bisa kompleks;
- policy lebih sulit diverifikasi;
- edge case escalation/delegation bisa rumit.

Seringnya desain matang memakai kombinasi:

```text
tenant_id AND sensitivity AND lifecycle AND (attribute access OR explicit ACL)
```

### 7.3 Sensitivity Rank

Daripada string sensitivity saja:

```json
{
  "sensitivity": "CONFIDENTIAL"
}
```

Tambahkan rank numeric:

```json
{
  "sensitivity": "CONFIDENTIAL",
  "sensitivity_rank": 30
}
```

Principal punya clearance rank:

```text
PUBLIC = 0
INTERNAL = 10
RESTRICTED = 20
CONFIDENTIAL = 30
SECRET = 40
```

Filter:

```json
{
  "range": {
    "sensitivity_rank": {
      "lte": 30
    }
  }
}
```

Ini lebih mudah daripada banyak `terms` kombinasi.

### 7.4 Lifecycle State

Permission sering tergantung lifecycle.

Contoh:

```text
DRAFT          -> author + supervisor only
UNDER_REVIEW   -> assigned reviewers
PUBLISHED      -> broader audience
SEALED         -> special clearance only
DELETED        -> nobody except retention admin
ARCHIVED       -> searchable only by auditor role
```

Index harus menyimpan lifecycle state yang search-relevant.

Jangan mengandalkan aplikasi mengambil detail lalu mengecek lifecycle setelah search.

### 7.5 Temporal Access

Contoh:

```json
{
  "access_valid_from": "2026-06-01T00:00:00Z",
  "access_valid_until": "2026-06-30T23:59:59Z"
}
```

Filter:

```json
{
  "bool": {
    "filter": [
      { "range": { "access_valid_from": { "lte": "now" } } },
      {
        "bool": {
          "should": [
            { "range": { "access_valid_until": { "gte": "now" } } },
            { "bool": { "must_not": { "exists": { "field": "access_valid_until" } } } }
          ],
          "minimum_should_match": 1
        }
      }
    ]
  }
}
```

Namun untuk high-security revocation, jangan bergantung sepenuhnya pada `now` query jika permission update seharusnya immediate. Pastikan revocation event memperbarui index atau gunakan external policy check untuk detail access.

### 7.6 Soft Delete dan Legal Hold

Field:

```json
{
  "is_deleted": false,
  "deleted_at": null,
  "legal_hold": true,
  "retention_class": "CASE_RECORD_7Y"
}
```

Search UI umum harus filter:

```json
{ "term": { "is_deleted": false } }
```

Admin/auditor search mungkin boleh melihat deleted/archived, tetapi harus explicit endpoint dan audit.

---

## 8. Application-Side Authorization Injection Pattern

Search API harus memiliki satu jalur standar untuk menyusun query final.

Bad pattern:

```java
// setiap handler bikin query sendiri-sendiri
caseSearchController.searchCases(...)
documentSearchController.searchDocuments(...)
autocompleteController.suggest(...)
exportController.export(...)
```

Risiko: salah satu endpoint lupa permission filter.

Better pattern:

```text
UserRequest
  -> validate search contract
  -> normalize user query
  -> build search intent
  -> derive principal context
  -> derive authorization policy
  -> derive field/facet/highlight policy
  -> compose ES query
  -> execute
  -> sanitize response
  -> audit
```

### 8.1 Query Composition Pipeline

Java-style abstraction:

```java
public interface SearchQueryComposer {
    SearchRequest compose(SearchIntent intent, SearchPrincipalContext principal);
}
```

Internal stages:

```java
public final class SecureCaseSearchComposer implements SearchQueryComposer {

    private final UserQueryBuilder userQueryBuilder;
    private final AuthorizationFilterBuilder authzFilterBuilder;
    private final FieldPolicyResolver fieldPolicyResolver;
    private final FacetPolicyResolver facetPolicyResolver;
    private final SortPolicyResolver sortPolicyResolver;

    @Override
    public SearchRequest compose(SearchIntent intent, SearchPrincipalContext principal) {
        Query userQuery = userQueryBuilder.build(intent);
        Query authzFilter = authzFilterBuilder.build(principal);
        FieldPolicy fields = fieldPolicyResolver.resolve(intent, principal);

        Query finalQuery = Query.of(q -> q.bool(b -> b
            .must(userQuery)
            .filter(authzFilter)
        ));

        return buildRequest(intent, finalQuery, fields, principal);
    }
}
```

Authorization filter harus menjadi bagian dari final Elasticsearch query, bukan post-process.

### 8.2 Always-On Filters

Beberapa filter tidak boleh opsional:

```text
tenant_id
is_deleted=false
lifecycle visibility
sensitivity clearance
principal scope
embargo
```

Gunakan konsep `MandatorySearchFilter`.

```java
public interface MandatorySearchFilter {
    Query toQuery(SearchPrincipalContext principal);
}
```

Contoh:

```java
public final class TenantMandatoryFilter implements MandatorySearchFilter {
    @Override
    public Query toQuery(SearchPrincipalContext principal) {
        return TermQuery.of(t -> t
            .field("tenant_id")
            .value(principal.tenantId())
        )._toQuery();
    }
}
```

Lalu final composer selalu inject semua mandatory filters.

### 8.3 Fail Closed

Jika principal context tidak lengkap, jangan jalankan search.

Bad:

```java
if (principal.tenantId() != null) {
    filters.add(tenantFilter(principal.tenantId()));
}
```

Jika tenant id null, filter hilang. Ini fail open.

Better:

```java
if (principal.tenantId() == null) {
    throw new AuthorizationContextException("Missing tenant id");
}
filters.add(tenantFilter(principal.tenantId()));
```

Security code harus fail closed.

### 8.4 Deny Raw Query DSL From Clients

Jangan biarkan client mengirim Query DSL arbitrer.

Berbahaya:

```json
POST /search
{
  "query": {
    "match_all": {}
  },
  "_source": true,
  "aggs": {
    "sensitive": {
      "terms": {
        "field": "witness_name.keyword"
      }
    }
  }
}
```

Expose contract yang sempit:

```json
{
  "q": "fraud",
  "filters": {
    "status": ["OPEN", "UNDER_REVIEW"],
    "openedFrom": "2026-01-01"
  },
  "sort": "relevance",
  "pageSize": 20,
  "after": "..."
}
```

Aplikasi menerjemahkan ke Query DSL.

### 8.5 Validate Sort and Facet Fields

Sort field bisa bocor.

Contoh user tidak boleh melihat `risk_score`, tetapi bisa sort by `risk_score`. Dari ordering, ia bisa menebak prioritas internal.

Allowed sort fields harus policy-driven:

```text
external user:
  relevance
  opened_at
  public_title.keyword

internal investigator:
  relevance
  opened_at
  status
  severity_rank
  sla_due_at

not allowed:
  internal_risk_score
  whistleblower_confidence_score
```

Facet fields juga harus policy-driven.

### 8.6 Sanitize Response

Walaupun query sudah benar, response tetap disanitasi:

- remove unexpected fields;
- remove explanation unless allowed;
- remove shard failures details for normal users;
- remove debug metadata;
- clamp total hits if needed;
- normalize not found vs unauthorized behavior;
- redact highlight fragments;
- enforce result shape contract.

---

## 9. Document-Level Security vs Application Filter: Practical Decision Matrix

Gunakan DLS/FLS atau application filter? Jawabannya sering “keduanya, tetapi untuk tujuan berbeda”.

| Requirement | Application Filter | Elasticsearch DLS/FLS | Catatan |
|---|---:|---:|---|
| Tenant isolation sederhana | Baik | Sangat baik | Bisa pakai keduanya |
| Department/region access | Baik | Baik | Jika field static dan query sederhana |
| Assigned user/group ACL | Baik | Baik | ACL besar perlu hati-hati |
| Complex workflow policy | Sangat baik | Terbatas | Aplikasi/policy engine lebih fleksibel |
| Highly dynamic revocation | Baik, dengan policy check | Berisiko stale jika index tidak update | Bisa butuh external decision |
| Field redaction | Baik | Baik | FLS sebagai guardrail, app projection sebagai UX contract |
| Facet leakage prevention | Wajib dipikirkan | Membantu jika filter aktif | Security filter harus sebelum aggs |
| Per-request purpose-based access | Baik | Sulit | Aplikasi lebih cocok |
| Audit reason required | Baik | Terbatas | Audit app-level tetap perlu |
| Defense-in-depth | Baik | Baik | Kombinasi paling kuat |

### 9.1 When DLS Is A Good Fit

DLS cocok ketika predicate relatif stabil:

```text
tenant_id == X
region in [A, B, C]
visibility == PUBLIC
sensitivity_rank <= clearance
```

DLS juga cocok untuk mengurangi dampak bug aplikasi. Misalnya Search API tetap inject tenant filter, tetapi API key untuk tenant A juga punya DLS tenant A.

### 9.2 When DLS Is Not Enough

DLS kurang cocok jika:

- permission berasal dari real-time external service;
- policy berubah per action/purpose;
- policy sangat branching;
- role count sangat banyak;
- document ACL sangat besar dan sering berubah;
- Anda butuh custom audit decision;
- query role menjadi sulit dites.

### 9.3 Recommended Pattern For High-Security Search

Untuk sistem sensitif:

```text
Application Search API:
  - derive policy
  - inject mandatory filters
  - restrict fields/aggs/highlights
  - audit

Elasticsearch credential:
  - least privilege index access
  - optional DLS for tenant/environment boundary
  - optional FLS for sensitive fields guardrail

Detail endpoint:
  - re-check authorization against source-of-truth/policy service
```

Search result boleh menjadi discoverability layer. Detail access tetap bisa memerlukan check lebih kuat.

---

## 10. Security In Search UX Components

### 10.1 Result Hits

Setiap hit harus memenuhi:

```text
visible(document, principal) == true
```

Jangan mengembalikan partial unauthorized hit kecuali policy memang mengizinkan redacted result.

Contoh redacted result:

```json
{
  "case_number": "C-2026-00123",
  "title": "Restricted case",
  "visibility": "RESTRICTED",
  "message": "You have limited visibility to this record."
}
```

Tetapi hati-hati: redacted result tetap mengungkap existence.

### 10.2 Total Hits

`totalHits` bisa bocor. Untuk beberapa sistem, total visible hits aman jika permission filter benar. Untuk sistem lebih sensitif, pertimbangkan:

- tampilkan `100+` bukan exact;
- disable total count untuk sensitive queries;
- gunakan `track_total_hits` terbatas;
- jangan tampilkan count untuk unauthorized scopes.

Elasticsearch sendiri mendukung `track_total_hits` untuk mengontrol akurasi/biaya total hit. Dari sisi security, ini juga bisa mengurangi precision dari side-channel count.

### 10.3 Facets

Facet harus dihitung dari visible documents.

Jika facet field sensitif, jangan tampilkan.

Contoh field yang mungkin sensitif:

```text
criminal_referral_status
whistleblower_present
protected_party_type
internal_risk_score_bucket
legal_privilege_type
investigation_strategy
```

Facet policy harus eksplisit:

```java
boolean canFacet(SearchPrincipalContext principal, String field) {
    return allowedFacetFields(principal).contains(field);
}
```

### 10.4 Highlight

Highlight bisa membuat redaction gagal.

Misalnya `_source` hanya mengembalikan `public_summary`, tetapi highlight mengembalikan `internal_notes`.

Policy:

```text
highlightFields subset of returnedFields
```

Atau:

```text
highlightFields subset of fields explicitly allowed for snippets
```

### 10.5 Autocomplete

Autocomplete punya threat lebih besar karena user bisa melakukan probing cepat.

Contoh probing:

```text
a
aa
aaa
john
john d
john doe
```

Jika suggestion mengungkap sensitive names, attacker bisa enumerate.

Mitigasi:

- rate limit;
- minimum prefix length;
- permission filter;
- public-only vocabulary;
- no autocomplete for sensitive names;
- audit unusual prefix probing;
- avoid exact rare term suggestions;
- k-anonymity threshold untuk suggestion publik.

### 10.6 “Did You Mean” and Spell Correction

Spell correction bisa membocorkan terms di corpus.

Jika corpus berisi sensitive names, phrase suggester dapat menyarankan nama tersebut.

Untuk sensitive search, gunakan dictionary/suggestion corpus yang sudah disanitasi.

### 10.7 Search History

Search history juga data sensitif.

Jika aplikasi menyimpan recent searches:

- jangan tampilkan search history lintas device tanpa kontrol;
- jangan simpan raw query terlalu lama;
- encrypt at rest jika perlu;
- beri clear history;
- jangan gunakan query sensitive untuk global suggestions tanpa review.

### 10.8 Saved Search

Saved search harus menyimpan policy context dengan hati-hati.

Problem:

```text
Alice menyimpan search saat punya akses tinggi.
Akses Alice dicabut.
Saved search masih bisa dieksekusi dengan filter lama.
```

Saved search harus dievaluasi ulang terhadap permission saat execution, bukan menyimpan final unrestricted DSL.

### 10.9 Sharing Search Links

URL search link bisa berisi query dan filters.

Pastikan:

- link tidak membawa authorization token;
- penerima link tetap dievaluasi permission-nya;
- filter sensitif tidak bocor di URL jika logs/proxy merekam URL;
- gunakan POST/body untuk query sensitif atau encrypted saved search id.

### 10.10 Export and Download

Export harus jadi use case terpisah.

Controls:

- max rows;
- allowed fields;
- asynchronous job permission snapshot;
- re-check before download;
- expiration;
- watermark;
- audit;
- approval for sensitive export;
- data classification label.

---

## 11. Case Management / Regulatory Search Security Model

Karena konteks Anda dekat dengan regulatory systems, mari buat model realistis.

### 11.1 Domain Entities

Misalnya sistem enforcement lifecycle memiliki:

```text
Case
Party
Allegation
Evidence
Document
Investigation Note
Decision
Escalation
Task
SLA
Audit Record
```

Search bisa dilakukan di beberapa level:

- search case;
- search party;
- search evidence;
- search document full text;
- search decision;
- search across all.

### 11.2 Principal Roles

Contoh role:

```text
Intake Officer
Investigator
Lead Investigator
Supervisor
Legal Reviewer
Decision Maker
External Auditor
Compliance Analyst
System Administrator
Read-only Observer
```

Role saja tidak cukup. Butuh attributes:

```text
tenant
region
unit
assignment
delegation
clearance
conflict-of-interest exclusions
case involvement
purpose of access
```

### 11.3 Visibility Rules

Contoh policy:

```text
A case is searchable by a user if:
  same tenant
  not deleted
  not sealed beyond clearance
  and one of:
    user assigned to case
    user's group assigned to case
    user supervises assigned unit
    user has national reviewer role and case status >= UNDER_REVIEW
    user has auditor role and case included in audit scope
```

Evidence document rule:

```text
An evidence document is searchable if:
  parent case visible
  and document sensitivity <= user clearance
  and document not marked LEGAL_PRIVILEGED unless user has legal role
  and document not protected witness material unless explicit access granted
```

### 11.4 Index Document Shape

Case search document:

```json
{
  "doc_type": "case",
  "case_id": "case-123",
  "tenant_id": "regulator-x",
  "case_number": "ENF-2026-00123",
  "title": "Investigation into reporting irregularities",
  "public_summary": "Summary safe for broad internal visibility...",
  "internal_summary": "Detailed internal narrative...",
  "status": "UNDER_REVIEW",
  "lifecycle_state": "ACTIVE",
  "region_ids": ["region:jkt"],
  "owning_unit_ids": ["unit:enforcement-a"],
  "assigned_user_ids": ["u-101"],
  "assigned_group_ids": ["g-enf-jkt"],
  "auditor_scope_ids": ["audit-2026-q2"],
  "sensitivity": "CONFIDENTIAL",
  "sensitivity_rank": 30,
  "legal_privilege": false,
  "protected_witness_material": false,
  "is_deleted": false,
  "opened_at": "2026-02-14T10:00:00Z",
  "updated_at": "2026-06-20T16:22:00Z"
}
```

Evidence search document:

```json
{
  "doc_type": "evidence",
  "evidence_id": "ev-789",
  "case_id": "case-123",
  "tenant_id": "regulator-x",
  "title": "Bank transfer records March 2026",
  "extracted_text_public": "Redacted extracted text...",
  "extracted_text_internal": "Full extracted text...",
  "evidence_type": "BANK_RECORD",
  "case_region_ids": ["region:jkt"],
  "case_assigned_user_ids": ["u-101"],
  "document_allowed_user_ids": ["u-101", "u-202"],
  "sensitivity_rank": 40,
  "legal_privilege": false,
  "protected_witness_material": false,
  "is_sealed": true,
  "is_deleted": false
}
```

### 11.5 Search Result Defensibility

Dalam regulatory system, Anda perlu menjawab:

```text
Why did this user see this result?
Why did this user not see another result?
Which policy allowed it?
Which fields were returned?
Was the search result complete relative to user's permissions?
Were restricted documents excluded?
Was the search query logged safely?
```

Maka setiap search response internal bisa membawa debug/audit metadata non-user-facing:

```json
{
  "policy_version": "case-search-authz-v17",
  "principal_scope_hash": "sha256:...",
  "mandatory_filters": [
    "tenant",
    "lifecycle",
    "sensitivity",
    "assignment_scope"
  ],
  "field_policy": "investigator-internal-v4"
}
```

Jangan tampilkan metadata sensitif ke user biasa, tetapi simpan untuk audit.

---

## 12. Permission Changes and Index Freshness

Security search sangat tergantung pada freshness permission fields.

### 12.1 Permission Update Types

Perubahan permission bisa berupa:

1. User assigned to case.
2. User removed from case.
3. Group membership changes.
4. Case sensitivity raised.
5. Case sealed/unsealed.
6. Document marked legal privileged.
7. Tenant moved to different policy.
8. Delegation starts/ends.
9. Auditor scope changes.
10. Case deleted/restored.

Tidak semua punya urgency sama.

### 12.2 Grant vs Revoke

Grant delay biasanya UX issue:

```text
User baru ditambahkan ke case tetapi belum bisa search.
```

Revoke delay adalah security issue:

```text
User dicabut dari case tetapi masih bisa search.
```

Maka SLO harus berbeda:

```text
Grant propagation target: < 60s
Revoke propagation target: < 5s or immediate check
```

Untuk sistem sangat sensitif, revocation mungkin harus memakai synchronous invalidation atau detail endpoint re-check.

### 12.3 Event-Driven Permission Indexing

Pipeline:

```text
Canonical permission change
  -> transaction/outbox
  -> event stream
  -> indexing worker
  -> update affected documents in Elasticsearch
  -> verification metric
```

Part Kafka/outbox sudah dibahas di seri lain, jadi di sini fokus search consequence:

- event harus idempotent;
- update harus ordered per entity;
- stale event tidak boleh overwrite permission baru;
- failed update harus retry;
- poison event harus quarantine;
- lag harus monitored;
- reindex job harus bisa rebuild permission fields.

### 12.4 Reconciliation

Harus ada job membandingkan canonical permission dengan index.

Contoh:

```text
Daily full reconciliation:
  sample cases
  compute expected ACL from canonical DB
  fetch indexed ACL from Elasticsearch
  compare hash
  emit drift alert

Critical permission reconciliation:
  after revoke event
  verify document no longer visible under old principal test context
```

### 12.5 Permission Version Field

Tambahkan version/hash:

```json
{
  "permission_version": 42,
  "permission_hash": "sha256:abc...",
  "permission_updated_at": "2026-06-21T12:00:00Z"
}
```

Berguna untuk:

- debugging stale permission;
- reconciliation;
- audit;
- index migration;
- detect partial update failure.

### 12.6 Detail Endpoint Re-Check

Untuk high-risk data:

```text
Search result click -> Detail API -> check current canonical permission -> return detail or deny
```

Ini mengurangi dampak stale search index. Search result mungkin masih muncul sebentar, tetapi detail tidak terbuka. Namun existence leakage masih mungkin terjadi. Untuk highly sensitive cases, revocation harus menghapus visibility dari search juga cepat.

---

## 13. Field-Level Protection Strategy

### 13.1 Separate Searchable Field and Returnable Field

Field yang dipakai untuk search tidak selalu boleh dikembalikan.

Contoh:

```json
{
  "search_all_internal": "full text including sensitive tokens",
  "public_summary": "redacted text visible externally"
}
```

Jika user eksternal mencari term yang hanya ada di internal field, apakah dokumen boleh match?

Ada dua kemungkinan:

1. **Tidak boleh match**  
   Query user eksternal hanya mencari public fields.

2. **Boleh match tetapi tidak boleh reveal snippet**  
   Ini riskan karena existence/term leakage.

Untuk kebanyakan sistem sensitif:

```text
A user should only match against fields they are allowed to use for discovery.
```

Artinya field policy mempengaruhi query fields, bukan hanya response fields.

### 13.2 Role-Specific Search Fields

Contoh:

```text
external auditor:
  public_title
  public_summary
  public_decision_text

investigator:
  public_title
  public_summary
  internal_summary
  evidence_text
  party_names

legal reviewer:
  legal_notes
  privileged_analysis
  decision_draft
```

Query builder harus memilih `multi_match` fields berdasarkan role.

### 13.3 Redacted and Raw Fields

Pattern:

```json
{
  "summary_raw": "Full sensitive summary...",
  "summary_redacted": "Redacted summary...",
  "summary_public": "Public summary..."
}
```

Mapping:

```json
{
  "summary_raw": { "type": "text", "analyzer": "domain_internal" },
  "summary_redacted": { "type": "text", "analyzer": "domain_internal" },
  "summary_public": { "type": "text", "analyzer": "domain_public" }
}
```

Policy:

```text
PUBLIC user searches summary_public
AUDITOR searches summary_redacted
INVESTIGATOR searches summary_raw
```

### 13.4 `_source` Filtering Is Not Enough Alone

`_source` filtering membatasi field di response, tetapi:

- query bisa tetap match field sensitif;
- highlight bisa mengembalikan field sensitif;
- aggregation bisa memakai field sensitif;
- sort bisa memakai field sensitif;
- explain bisa mengungkap scoring dari field sensitif.

Field authorization harus diterapkan ke:

```text
query fields
returned fields
highlight fields
sort fields
facet fields
script fields
runtime fields
explain/debug
export fields
```

### 13.5 Do Not Store What You Cannot Govern

Jika field sangat sensitif dan tidak diperlukan untuk search, jangan index ke Elasticsearch.

Elasticsearch sering menjadi “copy everything for convenience”. Ini buruk.

Pertanyaan wajib untuk setiap field:

```text
Is it needed for search matching?
Is it needed for filtering?
Is it needed for sorting?
Is it needed for display?
Is it needed for highlighting?
Who can access it?
How is it redacted?
How is it deleted?
How is it audited?
```

Jika tidak ada jawaban jelas, jangan masukkan.

---

## 14. Cache, Scoring, and Security

### 14.1 Query Cache and Filter Context

Elasticsearch dapat cache filter/query result tertentu. Dari sisi security, cache internal umumnya tetap mengikuti query dan role/request context, tetapi aplikasi tetap harus hati-hati:

- jangan cache response search lintas user tanpa key authorization context;
- jangan cache autocomplete sensitive secara global;
- jangan cache facet counts tanpa tenant/scope key;
- jangan cache exported result tanpa ownership.

### 14.2 Application Cache Key

Jika aplikasi cache search response:

Bad:

```text
cache key = hash(query)
```

Better:

```text
cache key = hash(query + tenant + principal scopes + field policy + policy version)
```

Namun untuk permission-sensitive search, sering lebih aman tidak cache full response per user kecuali benar-benar perlu.

### 14.3 Ranking Side Effects

Ranking bisa membocorkan hidden signals.

Contoh:

- document lebih tinggi karena internal risk score;
- user tidak boleh melihat risk score, tetapi ranking memberi sinyal;
- ordering berdasarkan priority bisa membocorkan severity.

Jika ranking menggunakan sensitive signal, tanyakan:

> Apakah user boleh mengetahui implikasi dari signal ini melalui ordering?

Jika tidak, gunakan ranking model berbeda untuk user tersebut.

### 14.4 Explain API

Explain API berguna untuk debugging relevance, tetapi bisa membocorkan field names, term stats, boosts, internal signals.

Jangan expose explain ke user biasa. Untuk admin/debug, gate dengan privilege dan audit.

---

## 15. Search Security Testing

Security search harus diuji seperti invariant, bukan manual QA.

### 15.1 Core Invariants

Contoh invariant:

```text
For any principal P and query Q:
  every returned hit H must satisfy canView(P, H)
```

```text
For any principal P:
  response fields subset of allowedFields(P)
```

```text
For any principal P:
  highlight fields subset of allowedHighlightFields(P)
```

```text
For any principal P:
  aggregation fields subset of allowedFacetFields(P)
```

```text
For any revoked access:
  document must not be searchable after revocation SLO
```

### 15.2 Golden Authorization Dataset

Buat dataset kecil tetapi kaya:

```text
Users:
  alice: tenant A, investigator region JKT, clearance 30
  bob: tenant A, reviewer national, clearance 20
  carol: tenant B, investigator, clearance 30
  dave: auditor tenant A, audit scope Q2, clearance 10

Documents:
  doc1: tenant A, region JKT, sensitivity 10
  doc2: tenant A, region BDG, sensitivity 10
  doc3: tenant A, region JKT, sensitivity 40
  doc4: tenant B, region JKT, sensitivity 10
  doc5: tenant A, auditor scope Q2, redacted only
  doc6: tenant A, deleted
  doc7: tenant A, sealed
```

Test expected visibility matrix:

| Principal | doc1 | doc2 | doc3 | doc4 | doc5 | doc6 | doc7 |
|---|---:|---:|---:|---:|---:|---:|---:|
| alice | yes | no | no | no | no/depends | no | no |
| bob | yes | yes | no | no | no/depends | no | no |
| carol | no | no | no | yes | no | no | no |
| dave | redacted | no | no | no | yes | no | no |

### 15.3 Mutation Tests For Authorization Query

Secara sengaja ubah query builder dan pastikan test gagal:

- remove tenant filter;
- remove sensitivity filter;
- change `must` to `should`;
- remove `minimum_should_match`;
- allow forbidden facet;
- include raw field in `_source`;
- include raw field in highlight;
- allow cross-tenant autocomplete.

Jika test tidak gagal, test belum cukup kuat.

### 15.4 Property-Based Testing

Untuk authorization, property-based testing sangat berguna.

Generate random:

- principals;
- tenant ids;
- group memberships;
- document ACLs;
- sensitivity levels;
- lifecycle states;
- query filters.

Invariant:

```java
assertTrue(results.stream().allMatch(hit -> policy.canView(principal, hit.document())));
```

### 15.5 Integration Test With Real Elasticsearch

Unit test query builder tidak cukup. Butuh integration test dengan Elasticsearch container/test cluster karena:

- mapping mempengaruhi term query;
- `text` vs `keyword` bisa membuat filter gagal;
- nested/object behavior berbeda;
- aggregation behavior perlu diverifikasi;
- highlight behavior perlu dilihat;
- `minimum_should_match` semantics harus nyata.

### 15.6 Security Regression Test For Facets

Test khusus:

```text
Given hidden document with status SECRET_STATUS
When unauthorized user searches matching term
Then facet by status must not include SECRET_STATUS
```

### 15.7 Security Regression Test For Suggest

```text
Given confidential party name "John Confidential"
When unauthorized user types "John"
Then suggestion must not include "John Confidential"
```

### 15.8 Revocation Test

```text
Given Alice can see case C
When Alice is removed from case
And permission update is processed
Then Alice search for exact case number returns no result
And Alice detail access is denied
And audit logs show revocation version applied
```

---

## 16. Operational Security

### 16.1 Secret Handling

Elasticsearch credentials/API keys harus:

- disimpan di secret manager;
- tidak di-commit ke repo;
- tidak dicetak di log;
- tidak dimasukkan ke frontend;
- dirotasi;
- dibatasi privilege;
- dipisah per environment;
- dipisah per service.

### 16.2 TLS and Network Boundary

Production cluster harus menggunakan secure communication. Jangan expose Elasticsearch langsung ke public internet. Search harus lewat application API atau controlled gateway.

Network controls:

- private network/VPC;
- firewall/security group;
- TLS;
- mTLS jika perlu;
- IP allowlist untuk admin endpoint;
- no direct browser-to-Elasticsearch for sensitive apps.

### 16.3 Least Privilege Service Accounts

Pisahkan:

```text
search-api-read
indexing-worker-write
reindex-job-temp
admin-ops
monitoring-readonly
```

Jangan gunakan admin credential untuk runtime.

### 16.4 Environment Separation

Production data tidak boleh searchable dari staging/dev.

Jika perlu data untuk dev:

- anonymize;
- subset;
- synthetic data;
- redacted snapshot;
- separate cluster;
- no production API key.

### 16.5 Logging and Tracing

Search request logs harus classified.

Jangan log:

- raw sensitive query;
- full response body;
- `_source` sensitive fields;
- API key;
- authorization token;
- raw DLS query with sensitive group/user ids jika log terlalu luas.

Boleh log:

- query hash;
- query class;
- tenant hash;
- user id if audit-protected;
- result count;
- latency;
- policy version;
- error category.

### 16.6 Error Messages

Jangan bedakan terlalu detail untuk user biasa:

```text
404 not found
```

bisa digunakan untuk:

- document tidak ada;
- document ada tetapi tidak authorized.

Namun internal audit bisa mencatat perbedaan.

### 16.7 Admin Tools

Admin search tools sering lebih berbahaya dari user search.

Controls:

- separate endpoint;
- strong authentication;
- explicit role;
- reason required;
- audit;
- field restrictions;
- no arbitrary DSL unless admin debugging and controlled;
- temporary elevated access;
- break-glass process.

---

## 17. Common Security Anti-Patterns

### 17.1 Raw Elasticsearch Proxy

```text
Frontend -> Backend -> Elasticsearch raw DSL
```

Bahaya:

- user bisa query field/index apa pun;
- user bisa meminta aggregation sensitif;
- user bisa query mahal;
- permission filter bisa dihapus;
- sulit audit intent.

### 17.2 Permission Filter In UI Only

```text
UI hides filters/options, but backend accepts arbitrary values.
```

Attacker bisa call API langsung.

### 17.3 Filter After Search

Aplikasi mengambil hits lalu filter authorization. Ranking, aggregation, and total hits bocor/rusak.

### 17.4 `_source: true` Everywhere

Mengembalikan semua field karena praktis. Ini sering membuka PII/internal fields.

### 17.5 Shared Superuser Credential

Semua service memakai admin credential.

### 17.6 No Revocation Monitoring

Permission berubah tetapi tidak ada metric lag/drift.

### 17.7 Suggestion Index Tidak Diamankan

Search utama aman, autocomplete bocor.

### 17.8 Aggregation On Hidden Corpus

Facet count dihitung dari semua data lalu hits difilter.

### 17.9 Debug Endpoints In Production

Endpoint `/search/debug` mengembalikan raw DSL, explain, source lengkap, atau shard failures ke user yang tidak berhak.

### 17.10 Stale Alias During Migration

Alias swap salah membuat Search API membaca index lama tanpa permission field baru.

### 17.11 Indexing Permission Fields As `text`

`allowed_user_ids` atau `tenant_id` dimapping sebagai `text`. `term` filter gagal atau behavior tidak sesuai.

Permission fields harus `keyword`/numeric/date.

### 17.12 Treating Search As Source of Truth

Detail authorization hanya berdasarkan indexed fields yang bisa stale. Untuk high-risk detail view, re-check source-of-truth.

---

## 18. Design Patterns For Secure Search Platform

### 18.1 Secure Search Gateway Pattern

Semua search melewati satu backend gateway:

```text
Client
  -> Search API Gateway
       -> AuthN/AuthZ
       -> Query validation
       -> Policy injection
       -> ES execution
       -> Response sanitization
       -> Audit
  -> Elasticsearch
```

Tidak ada direct Elasticsearch access dari frontend.

### 18.2 Policy-Aware Query Builder

Jangan sebar query building.

```text
SearchIntent + PrincipalContext + Policy -> Elasticsearch Query
```

### 18.3 Separate Index For Public vs Internal Search

Jika field visibility sangat berbeda:

```text
public-case-search-v1
internal-case-search-v1
```

Public index hanya mengandung data aman. Ini mengurangi risiko FLS/projection bug.

Trade-off:

- duplicate indexing;
- consistency tambahan;
- relevance berbeda;
- migration lebih banyak.

Tetapi untuk data sangat sensitif, ini sering layak.

### 18.4 Redacted Projection Index

Untuk auditor eksternal:

```text
audit-redacted-case-search-v1
```

Index ini hanya berisi redacted content dan audit scope fields.

### 18.5 Security Filter Library

Buat library internal:

```java
caseSearchSecurityFilters.forPrincipal(principal)
documentSearchSecurityFilters.forPrincipal(principal)
partySearchSecurityFilters.forPrincipal(principal)
```

Semua endpoint memakai library sama.

### 18.6 Policy Versioning

Setiap query mencatat policy version:

```text
case-search-authz-v17
field-policy-investigator-v6
facet-policy-default-v3
```

Saat policy berubah, audit masih bisa menjelaskan search lama.

### 18.7 Defense-In-Depth With DLS/FLS

Jika memungkinkan:

- aplikasi inject filter;
- API key role membatasi index;
- DLS membatasi tenant/environment;
- FLS menyembunyikan field super sensitif;
- response sanitizer memvalidasi shape.

Satu lapisan gagal, lapisan lain menahan blast radius.

---

## 19. Java Implementation Blueprint

### 19.1 Domain Types

```java
public record SearchPrincipalContext(
    String userId,
    String tenantId,
    Set<String> roles,
    Set<String> groupIds,
    Set<String> regionIds,
    int clearanceRank,
    boolean canViewLegalPrivileged,
    boolean canViewProtectedWitnessMaterial,
    boolean canExport,
    String policyVersion
) {
    public SearchPrincipalContext {
        if (userId == null || userId.isBlank()) {
            throw new IllegalArgumentException("userId is required");
        }
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalArgumentException("tenantId is required");
        }
        roles = Set.copyOf(roles == null ? Set.of() : roles);
        groupIds = Set.copyOf(groupIds == null ? Set.of() : groupIds);
        regionIds = Set.copyOf(regionIds == null ? Set.of() : regionIds);
    }
}
```

### 19.2 Authorization Filter Builder

Pseudocode using Elasticsearch Java API Client style:

```java
public final class CaseAuthorizationFilterBuilder {

    public Query build(SearchPrincipalContext principal) {
        List<Query> filters = new ArrayList<>();

        filters.add(term("tenant_id", principal.tenantId()));
        filters.add(term("is_deleted", false));
        filters.add(rangeLte("sensitivity_rank", principal.clearanceRank()));

        if (!principal.canViewLegalPrivileged()) {
            filters.add(term("legal_privilege", false));
        }

        if (!principal.canViewProtectedWitnessMaterial()) {
            filters.add(term("protected_witness_material", false));
        }

        Query scope = Query.of(q -> q.bool(b -> {
            if (!principal.regionIds().isEmpty()) {
                b.should(terms("region_ids", principal.regionIds()));
            }
            if (!principal.groupIds().isEmpty()) {
                b.should(terms("assigned_group_ids", principal.groupIds()));
            }
            b.should(term("assigned_user_ids", principal.userId()));
            b.minimumShouldMatch("1");
            return b;
        }));

        filters.add(scope);

        return Query.of(q -> q.bool(b -> b.filter(filters)));
    }

    private Query term(String field, String value) {
        return Query.of(q -> q.term(t -> t.field(field).value(value)));
    }

    private Query term(String field, boolean value) {
        return Query.of(q -> q.term(t -> t.field(field).value(value)));
    }

    private Query rangeLte(String field, int value) {
        return Query.of(q -> q.range(r -> r.number(n -> n.field(field).lte((double) value))));
    }

    private Query terms(String field, Set<String> values) {
        return Query.of(q -> q.terms(t -> t
            .field(field)
            .terms(v -> v.value(values.stream().map(FieldValue::of).toList()))
        ));
    }
}
```

Catatan: kode di atas blueprint. Sesuaikan dengan versi Java API Client yang digunakan.

### 19.3 Field Policy Resolver

```java
public record SearchFieldPolicy(
    Set<String> sourceIncludes,
    Set<String> highlightFields,
    Set<String> allowedSortFields,
    Set<String> allowedFacetFields,
    Set<String> queryFields
) {}
```

```java
public final class CaseFieldPolicyResolver {

    public SearchFieldPolicy resolve(SearchPrincipalContext principal) {
        if (principal.roles().contains("EXTERNAL_AUDITOR")) {
            return new SearchFieldPolicy(
                Set.of("case_id", "case_number", "public_title", "public_summary", "status"),
                Set.of("public_title", "public_summary"),
                Set.of("relevance", "opened_at", "case_number.keyword"),
                Set.of("status", "public_category", "opened_year"),
                Set.of("public_title^3", "public_summary")
            );
        }

        if (principal.roles().contains("INVESTIGATOR")) {
            return new SearchFieldPolicy(
                Set.of("case_id", "case_number", "title", "summary", "status", "severity", "sla_due_at"),
                Set.of("title", "summary"),
                Set.of("relevance", "opened_at", "severity_rank", "sla_due_at"),
                Set.of("status", "severity", "region_ids", "case_type"),
                Set.of("title^4", "summary^2", "party_names^2", "case_number.keyword^10")
            );
        }

        return new SearchFieldPolicy(
            Set.of("case_id", "case_number", "public_title", "status"),
            Set.of("public_title"),
            Set.of("relevance", "opened_at"),
            Set.of("status"),
            Set.of("public_title^2", "case_number.keyword^10")
        );
    }
}
```

### 19.4 Search Request Composer

```java
public SearchRequest compose(CaseSearchRequest request, SearchPrincipalContext principal) {
    SearchFieldPolicy fieldPolicy = fieldPolicyResolver.resolve(principal);

    Query userQuery = buildUserQuery(request.q(), fieldPolicy.queryFields());
    Query authzQuery = authzFilterBuilder.build(principal);

    Query finalQuery = Query.of(q -> q.bool(b -> b
        .must(userQuery)
        .filter(authzQuery)
    ));

    return SearchRequest.of(s -> s
        .index("case-search-current")
        .query(finalQuery)
        .source(src -> src.filter(f -> f.includes(new ArrayList<>(fieldPolicy.sourceIncludes()))))
        .size(Math.min(request.pageSize(), 50))
        .trackTotalHits(t -> t.enabled(false))
        .highlight(h -> {
            for (String field : fieldPolicy.highlightFields()) {
                h.fields(field, hf -> hf.numberOfFragments(3).fragmentSize(150));
            }
            return h;
        })
    );
}
```

### 19.5 Response Sanitizer

```java
public final class SearchResponseSanitizer {

    public CaseSearchResponse sanitize(
        SearchResponse<CaseSearchDocument> response,
        SearchFieldPolicy fieldPolicy
    ) {
        List<CaseSearchHit> hits = response.hits().hits().stream()
            .map(hit -> sanitizeHit(hit, fieldPolicy))
            .toList();

        return new CaseSearchResponse(hits, buildSafePageInfo(response));
    }

    private CaseSearchHit sanitizeHit(
        Hit<CaseSearchDocument> hit,
        SearchFieldPolicy fieldPolicy
    ) {
        CaseSearchDocument source = hit.source();
        if (source == null) {
            throw new IllegalStateException("Search hit missing source");
        }

        Map<String, List<String>> safeHighlights = hit.highlight().entrySet().stream()
            .filter(e -> fieldPolicy.highlightFields().contains(e.getKey()))
            .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

        return CaseSearchHit.from(source, safeHighlights);
    }
}
```

### 19.6 Audit Event

```java
public record SearchAuditEvent(
    Instant timestamp,
    String principalId,
    String tenantId,
    String endpoint,
    String queryHash,
    String queryClass,
    String policyVersion,
    Set<String> appliedMandatoryFilters,
    Set<String> returnedFields,
    int returnedCount,
    long tookMillis,
    String correlationId
) {}
```

Do not include raw query by default. Jika regulatory requirement membutuhkan raw query, simpan di audit store dengan access control ketat, encryption, dan retention policy.

---

## 20. Secure Search API Contract Example

### 20.1 Request

```json
POST /api/cases/search
{
  "q": "reporting irregularities",
  "filters": {
    "status": ["OPEN", "UNDER_REVIEW"],
    "openedFrom": "2026-01-01",
    "openedTo": "2026-06-30"
  },
  "sort": "relevance",
  "pageSize": 20,
  "after": null,
  "facets": ["status", "caseType", "openedYear"]
}
```

Client tidak mengirim:

- raw Query DSL;
- index name;
- `_source` fields;
- arbitrary aggregations;
- arbitrary sort fields;
- raw highlight fields;
- permission filters.

### 20.2 Server-Side Enrichment

Server menambahkan:

```text
tenant_id filter
visibility scope filter
sensitivity filter
lifecycle filter
field policy
facet policy
highlight policy
sort policy
rate limit
query timeout
```

### 20.3 Response

```json
{
  "results": [
    {
      "caseId": "case-123",
      "caseNumber": "ENF-2026-00123",
      "title": "Investigation into reporting irregularities",
      "status": "UNDER_REVIEW",
      "openedAt": "2026-02-14T10:00:00Z",
      "highlights": {
        "title": ["Investigation into <em>reporting</em> irregularities"]
      }
    }
  ],
  "facets": {
    "status": [
      { "value": "OPEN", "count": 12 },
      { "value": "UNDER_REVIEW", "count": 7 }
    ]
  },
  "page": {
    "next": "opaque-token",
    "hasMore": true
  }
}
```

No raw Elasticsearch response.

---

## 21. Data Leakage Through Aggregation: Detailed Example

Misalnya corpus:

```text
Doc A: visible to Alice, status OPEN, case_type ADMIN
Doc B: hidden from Alice, status CRIMINAL_REFERRAL, case_type ENFORCEMENT
Doc C: hidden from Alice, status SEALED, case_type ENFORCEMENT
```

Alice mencari `Company X`.

### 21.1 Incorrect Query

```json
{
  "query": {
    "match": {
      "content": "Company X"
    }
  },
  "post_filter": {
    "term": {
      "allowed_user_ids": "alice"
    }
  },
  "aggs": {
    "by_status": {
      "terms": {
        "field": "status"
      }
    }
  }
}
```

Hits hanya Doc A, tetapi aggregation bisa menunjukkan:

```json
{
  "OPEN": 1,
  "CRIMINAL_REFERRAL": 1,
  "SEALED": 1
}
```

Alice tahu ada sealed/criminal referral terkait Company X.

### 21.2 Correct Query

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "content": "Company X" } }
      ],
      "filter": [
        { "term": { "allowed_user_ids": "alice" } }
      ]
    }
  },
  "aggs": {
    "by_status": {
      "terms": {
        "field": "status"
      }
    }
  }
}
```

Aggregation hanya dari visible docs:

```json
{
  "OPEN": 1
}
```

Rule:

> Kalau filter berhubungan dengan security, jangan letakkan di `post_filter`.

---

## 22. Handling Unauthorized Detail Access

Search dan detail endpoint punya behavior berbeda.

### 22.1 Not Found vs Forbidden

Jika user membuka `/cases/C-123`, apa response jika case ada tetapi tidak authorized?

Pilihan:

1. `403 Forbidden`  
   Jelas secara semantics, tetapi mengungkap existence.

2. `404 Not Found`  
   Mengurangi existence disclosure.

3. `404` untuk user biasa, `403` untuk internal audited context.

Untuk sistem sensitif, sering pilih:

```text
Return 404 for not found or not authorized.
Log internal reason.
```

### 22.2 Search Result Click Race

User melihat result, lalu permission dicabut, lalu klik detail.

Correct behavior:

```text
Detail endpoint re-checks permission and denies.
```

Search index eventually consistent tidak boleh menjadi satu-satunya gate untuk detail.

---

## 23. Security In Index Migration

Migration bisa merusak security.

### 23.1 Mapping Migration Risk

Misalnya v1 punya:

```text
tenant_id keyword
allowed_group_ids keyword
```

v2 lupa mapping `allowed_group_ids`, dynamic mapping menjadikannya `text` + `.keyword` atau tidak sesuai query. Authorization filter bisa gagal.

Mitigation:

- explicit mapping;
- mapping contract test;
- index template governance;
- migration checklist;
- integration test against new index.

### 23.2 Alias Swap Risk

Alias:

```text
case-search-current -> case-search-v1
```

Saat swap ke v2, pastikan:

- v2 sudah punya semua permission fields;
- v2 sudah backfilled permission values;
- Search API version compatible;
- field policy updated;
- DLS/FLS role index patterns include v2;
- rollback safe.

### 23.3 Backfill With Missing Permission

Saat reindex, jangan masukkan dokumen tanpa permission fields ke searchable alias.

Pattern:

```text
build index v2 hidden
validate permission completeness
run authorization test suite
swap alias
```

Query untuk check missing fields:

```json
{
  "query": {
    "bool": {
      "should": [
        { "bool": { "must_not": { "exists": { "field": "tenant_id" } } } },
        { "bool": { "must_not": { "exists": { "field": "sensitivity_rank" } } } },
        { "bool": { "must_not": { "exists": { "field": "lifecycle_state" } } } }
      ],
      "minimum_should_match": 1
    }
  }
}
```

If any hits exist, do not expose index.

---

## 24. Security Metrics and Alerts

Monitor security-specific indicators.

### 24.1 Metrics

```text
search.requests.total by endpoint/tenant/role
search.denied.total
search.empty_result.rate
search.export.requests.total
search.export.rows.total
search.permission_context_missing.total
search.policy_version.count
search.sensitive_facet_rejected.total
search.forbidden_sort_rejected.total
search.raw_dsl_attempt.total
search.revocation_lag.seconds
search.permission_drift.detected.total
search.autocomplete.probing_suspected.total
```

### 24.2 Alerts

Alert examples:

```text
Any search executed without tenant filter -> critical
Any response sanitizer drops unexpected sensitive field -> high
Revocation lag p99 > SLO -> critical
Permission drift detected -> high
Spike in wildcard/suggest probing -> medium/high
Export volume anomaly -> high
Search API using admin credential -> critical
Index alias points to unvalidated index -> critical
```

### 24.3 Dashboards

Security dashboard:

- requests by role;
- denied/invalid query attempts;
- export count by user;
- top query classes;
- revocation lag;
- drift check status;
- sensitive field sanitizer events;
- audit logging health;
- API key usage.

---

## 25. Runbook: Suspected Search Data Leakage

Jika ada dugaan data bocor lewat search:

### 25.1 Immediate Containment

1. Disable affected endpoint or feature flag.
2. Remove/rotate exposed API key if credential suspected.
3. Point alias away from bad index if migration issue.
4. Disable autocomplete/facet/export if leakage channel unclear.
5. Block suspicious user/session if active abuse.

### 25.2 Evidence Preservation

Collect:

- audit logs;
- query hashes/raw queries if available;
- user principal context;
- policy version;
- index alias state;
- mapping version;
- deployment version;
- search response samples;
- authorization decision logs;
- indexing lag metrics;
- permission change events.

### 25.3 Impact Analysis

Ask:

```text
Which users were affected?
Which tenants/scopes?
Which fields leaked?
Was it content, existence, counts, suggestions, or metadata?
What time window?
Which index version?
Which endpoint?
Was export involved?
Was stale permission involved?
```

### 25.4 Remediation

Possible fixes:

- patch query builder;
- add missing mandatory filter;
- fix field policy;
- rebuild index with permission fields;
- update DLS/FLS role;
- purge suggestion index;
- invalidate cache;
- rotate API key;
- add regression test;
- add alert.

### 25.5 Post-Incident Hardening

Add invariant test and monitoring so the same class cannot recur.

---

## 26. Checklist: Production Secure Search

### 26.1 Design Checklist

- [ ] Search API has no raw DSL exposure to untrusted clients.
- [ ] Principal context is explicit and request-scoped.
- [ ] Mandatory authorization filters are always injected.
- [ ] Security filters are in query/filter context, not post-filter.
- [ ] Aggregations operate only on authorized corpus.
- [ ] Field policy controls query fields, returned fields, highlights, facets, sorts, exports.
- [ ] Autocomplete/suggest has permission model.
- [ ] Export has separate authorization and audit.
- [ ] Detail endpoint re-checks current authorization for sensitive data.
- [ ] Tenant isolation model is explicit.
- [ ] Revocation SLO is defined.
- [ ] Permission drift detection exists.

### 26.2 Elasticsearch Checklist

- [ ] TLS enabled.
- [ ] Elasticsearch not publicly exposed.
- [ ] Runtime service does not use superuser.
- [ ] API keys are least privilege.
- [ ] API keys are rotated and invalidated when retired.
- [ ] Index privileges are minimal.
- [ ] DLS/FLS considered for defense-in-depth.
- [ ] Sensitive fields not indexed unless needed.
- [ ] Permission fields mapped as `keyword`/numeric/date.
- [ ] Index templates enforce mapping.
- [ ] Alias swap process validates permission fields.

### 26.3 Testing Checklist

- [ ] Golden authorization matrix exists.
- [ ] Integration tests use real Elasticsearch.
- [ ] Tests cover hits, fields, highlights, facets, suggestions, exports.
- [ ] Mutation tests catch missing tenant/sensitivity filters.
- [ ] Revocation tests exist.
- [ ] Mapping contract tests exist.
- [ ] Saved search/share link tests exist.
- [ ] Debug endpoint tests exist.

### 26.4 Operations Checklist

- [ ] Audit logs include policy version.
- [ ] Raw query logging is controlled/redacted.
- [ ] Revocation lag monitored.
- [ ] Permission drift monitored.
- [ ] Export volume monitored.
- [ ] API key usage monitored.
- [ ] Security incident runbook exists.
- [ ] Break-glass admin access is audited.

---

## 27. Key Takeaways

1. Search security is not just authentication. It is visibility control over hits, fields, counts, suggestions, highlights, exports, and logs.

2. Search must be modeled as:

```text
search(user, query, context) -> authorized ranked results
```

3. Application-side post-filtering after search is usually wrong for security-critical interactive search because it breaks ranking and leaks counts/aggregations.

4. Security filters must be part of the Elasticsearch query before scoring/aggregation response is computed.

5. Elasticsearch DLS/FLS/API keys/RBAC are important building blocks, but domain authorization usually still belongs in a dedicated application/policy layer.

6. Permission fields must be first-class index fields with correct mapping, freshness SLO, and reconciliation.

7. Facets, autocomplete, highlight, and export are common leakage channels.

8. Revocation delay is a security issue, not merely freshness issue.

9. Field-level safety applies to query fields, return fields, highlight fields, sort fields, facet fields, explain/debug, and export.

10. Top-tier Elasticsearch engineering treats search security as testable invariants plus operational monitoring, not as scattered ad hoc filters.

---

## 28. Bridge To The Next Part

Part 020 established secure search as an authorization and data visibility problem.

Next, Part 021 will move into:

```text
Performance Engineering I: Query Performance
```

That part will cover:

- latency decomposition;
- Query DSL cost model;
- filter vs scoring cost;
- query profiling;
- cache behavior;
- expensive query classes;
- wildcard/prefix/regexp cost;
- high-cardinality filters;
- sorting and aggregation cost;
- hot shard symptoms;
- coordinating node bottlenecks;
- practical optimization workflow.

Security and performance are connected: permission filters add cost, DLS/FLS can affect query behavior, and careless optimization can accidentally remove guardrails. Keep that connection in mind.

---

## References

- Elastic Docs — Controlling access at the document and field level: https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/controlling-access-at-document-field-level
- Elastic Docs — User roles and RBAC: https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/user-roles
- Elastic API Docs — Create API key: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-create-api-key
- Elastic Docs — Elasticsearch API keys: https://www.elastic.co/docs/deploy-manage/api-keys/elasticsearch-api-keys
- Elastic Docs — Search application security: https://www.elastic.co/docs/solutions/elasticsearch-solution-project/search-applications/search-application-security
- Elastic Docs — Security limitations: https://www.elastic.co/docs/deploy-manage/security/limitations
- Elastic Docs — Elasticsearch REST APIs / Security APIs: https://www.elastic.co/docs/reference/elasticsearch/rest-apis

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Multilingual and Domain-Specific Search</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-021.md">Part 021 — Performance Engineering I: Query Performance ➡️</a>
</div>
