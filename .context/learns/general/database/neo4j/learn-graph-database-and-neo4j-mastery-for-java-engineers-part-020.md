# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-020.md

# Part 020 — APOC and Neo4j Tooling Ecosystem

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus bagian ini: memahami ekosistem tooling Neo4j, terutama APOC, Neo4j Browser/Query, Bloom, Desktop, Aura, import/export/refactor utilities, serta batas aman penggunaan tool di production.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami posisi APOC dalam ekosistem Neo4j.
2. Membedakan fitur core Neo4j, Cypher native, APOC Core, APOC Extended, dan tooling visual.
3. Menggunakan tooling Neo4j secara produktif tanpa mengubahnya menjadi hidden business layer.
4. Menilai kapan APOC cocok dipakai untuk operasi data engineering, refactoring, import/export, metadata inspection, dan batch processing.
5. Menilai kapan APOC tidak boleh dipakai karena security, maintainability, auditability, atau operational risk.
6. Mendesain governance penggunaan APOC di lingkungan enterprise/regulatory.
7. Memahami peran Neo4j Browser/Query, Bloom, Desktop, Aura console, logs, metrics, dan CLI dalam workflow developer/operator/analyst.
8. Membuat runbook tooling untuk development, staging, production, incident response, dan audit.

---

## 1. Kenapa Bagian Ini Penting?

Neo4j bukan hanya database engine. Di sekitar Neo4j ada ekosistem:

- Cypher query language,
- Java Driver,
- Spring Data Neo4j,
- APOC,
- Neo4j Browser / Query,
- Neo4j Bloom,
- Neo4j Desktop,
- Neo4j Aura,
- import/export tools,
- admin tools,
- monitoring/logging,
- Graph Data Science,
- custom procedure/function extension.

Untuk engineer yang baru masuk Neo4j, ada dua ekstrem yang sama-sama berbahaya:

1. **Underuse tooling**  
   Semua dilakukan manual dengan query panjang, script ad-hoc, dan migrasi raw. Akibatnya lambat, rawan salah, dan sulit diulang.

2. **Overuse tooling**  
   Semua logic dimasukkan ke APOC/custom procedure/Bloom exploration. Akibatnya business rule tersembunyi, sulit dites, sulit diaudit, dan bisa berbahaya secara security.

Top engineer harus mampu membedakan:

```text
Tooling as acceleration
vs
Tooling as architecture dependency
vs
Tooling as production liability
```

APOC dan tooling Neo4j sangat powerful. Karena powerful, ia harus dipakai dengan governance.

---

## 2. Mental Model: Tooling Layer di Sekitar Neo4j

Bayangkan Neo4j production stack sebagai beberapa lapisan:

```text
Application Layer
  - Java service
  - Spring Boot
  - domain services
  - API handlers
  - batch workers

Integration Layer
  - Neo4j Java Driver
  - Spring Data Neo4j
  - Kafka connector / CDC / ETL jobs

Query Layer
  - Cypher
  - parameters
  - query templates
  - PROFILE/EXPLAIN

Extension Layer
  - APOC Core
  - APOC Extended
  - custom procedures/functions

Operational Tooling Layer
  - Neo4j Browser / Query
  - Aura console
  - logs
  - metrics
  - admin commands
  - backup/restore tools

Analyst / Explorer Layer
  - Neo4j Bloom
  - visualization
  - graph exploration

Database Engine Layer
  - storage
  - transaction log
  - page cache
  - indexes
  - constraints
  - cluster membership
```

Kesalahan umum adalah mencampur tanggung jawab lapisan-lapisan ini.

Contoh buruk:

```text
Business rule penting hanya ada di Bloom perspective.
Production data correction hanya ada di history Browser seseorang.
Critical nightly migration hanya berupa apoc.periodic.iterate manual tanpa versioning.
Authorization filtering diselesaikan dengan query exploration ad-hoc.
```

Contoh sehat:

```text
APOC dipakai untuk refactoring/migration yang versioned.
Browser dipakai untuk inspection, bukan source of truth perubahan.
Bloom dipakai analyst untuk exploration, bukan untuk mengeksekusi keputusan final tanpa audit.
Cypher production disimpan di repository/service code, dites, diprofile, dan dimonitor.
Procedure yang di-enable dibatasi minimal sesuai kebutuhan.
```

---

## 3. Apa Itu APOC?

APOC adalah library prosedur dan fungsi tambahan untuk Neo4j. Secara praktis, APOC menyediakan utilitas yang sering dibutuhkan tetapi tidak selalu tersedia sebagai Cypher native.

Kategori besar penggunaan APOC:

1. data transformation,
2. collection utilities,
3. map utilities,
4. path expansion,
5. metadata/schema introspection,
6. import/export,
7. graph refactoring,
8. batch/periodic execution,
9. text/date/math helpers,
10. triggers/background jobs pada varian tertentu,
11. virtual nodes/relationships,
12. integration helper.

Penting: APOC bukan pengganti desain model graph yang baik. APOC adalah toolbox.

Analogi untuk Java engineer:

```text
Cypher native         ~= Java language + standard library
APOC                 ~= Apache Commons / Guava / admin utility toolkit
Custom procedure     ~= plugin yang kamu tulis sendiri dan deploy ke runtime database
Production app logic ~= business service milik aplikasi
```

Jangan menaruh logic bisnis utama di “Apache Commons”.

---

## 4. APOC Core vs APOC Extended

Secara konseptual, APOC bisa dipahami sebagai dua keluarga:

```text
APOC Core
  - prosedur/fungsi yang lebih umum dan dekat dengan penggunaan database sehari-hari
  - biasanya lebih mudah diterima dalam setup standar

APOC Extended
  - fitur tambahan yang lebih luas
  - bisa membutuhkan konfigurasi/plugin tambahan
  - sering lebih sensitif secara security/operational
```

Dalam production, pertanyaannya bukan:

```text
Bisakah kita enable apoc.*?
```

Pertanyaan yang benar:

```text
Prosedur/fungsi APOC mana yang benar-benar dibutuhkan oleh workload ini?
Apakah ada alternatif Cypher native?
Apakah fungsi itu aman untuk production?
Apakah pengguna/role yang bisa memanggilnya dibatasi?
Apakah penggunaan itu tercatat, dites, dan diaudit?
```

---

## 5. APOC sebagai Extension: Kenapa Security Penting?

APOC menjalankan fungsi/prosedur di dalam lingkungan Neo4j. Beberapa prosedur dapat:

- membaca file,
- menulis file,
- membuat request eksternal,
- menjalankan batch besar,
- melakukan refactor massal,
- memodifikasi graph secara luas,
- mengakses metadata,
- membuat query dinamis.

Itu berarti risiko security mencakup:

1. **security misconfiguration**,
2. **sensitive data exposure**,
3. **SSRF** jika prosedur melakukan akses URL eksternal,
4. **language/query injection** jika query dinamis dibuat dari input tidak terpercaya,
5. **data corruption** dari refactor massal,
6. **availability risk** dari batch besar,
7. **privilege escalation-like effect** melalui prosedur unrestricted,
8. **audit gap** jika perubahan dilakukan manual.

Rule praktis:

```text
Di production, jangan enable apoc.* secara luas hanya karena memudahkan developer.
Enable hanya prosedur yang dibutuhkan, dengan allowlist minimal, role minimal, dan change control.
```

---

## 6. Cypher Native Dulu, APOC Kemudian

Neo4j terus menambah kemampuan Cypher. Banyak hal yang dulu umum dilakukan dengan APOC sekarang bisa dilakukan lebih baik dengan Cypher native.

Prioritas pemilihan:

```text
1. Cypher native
2. Cypher native + subquery
3. Cypher native + transactional subquery
4. APOC Core yang aman dan terbatasi
5. APOC Extended jika benar-benar perlu
6. Custom procedure hanya jika ada justifikasi kuat
```

Kenapa?

Karena Cypher native biasanya:

- lebih portable,
- lebih mudah dipahami tim,
- lebih mudah diprofile,
- lebih sesuai dengan planner/runtime,
- lebih aman dari sisi extension governance,
- lebih mudah didukung linting/review/testing.

Contoh pola pikir:

```cypher
// Jangan langsung pakai APOC untuk semua batching.
// Pertama cek apakah CALL { ... } IN TRANSACTIONS / IN CONCURRENT TRANSACTIONS sudah cukup.
```

Dalam versi Neo4j/Cypher modern, beberapa pola batch yang dulu sangat identik dengan `apoc.periodic.iterate` dapat digantikan oleh transactional subqueries native.

---

## 7. Kategori APOC yang Paling Sering Berguna

### 7.1 Collection dan Map Utilities

Sering berguna ketika Cypher native terasa terlalu verbose untuk manipulasi list/map.

Contoh kebutuhan:

- flatten nested list,
- sort complex collection,
- distinct object map,
- merge map,
- transform map,
- remove nulls,
- convert structures.

Namun hati-hati: jika query menjadi terlalu banyak manipulasi struktur kompleks, mungkin model/projection-nya salah.

Heuristic:

```text
APOC collection utility boleh dipakai untuk convenience.
Tapi kalau business rule utama berupa transformasi list/map sangat kompleks di Cypher,
pertimbangkan pindahkan ke Java service atau pipeline ETL yang lebih testable.
```

---

### 7.2 Metadata dan Schema Introspection

APOC berguna untuk melihat bentuk graph:

- label apa saja,
- relationship type apa saja,
- property key apa saja,
- approximate schema,
- sample relationship structure,
- degree distribution awal,
- model discovery.

Kegunaan:

1. reverse engineering graph lama,
2. audit model drift,
3. eksplorasi dataset baru,
4. debugging import,
5. membuat inventory schema.

Tapi jangan salah: introspection bukan pengganti schema contract.

Jika production graph penting, kamu tetap perlu:

- documented model,
- constraints,
- indexes,
- migration scripts,
- query contract tests,
- data quality tests.

---

### 7.3 Path Expansion

APOC punya beberapa utilitas path expansion yang lebih configurable dibanding Cypher sederhana.

Kegunaan:

- membatasi label,
- membatasi relationship types,
- menentukan uniqueness,
- BFS/DFS-style expansion,
- terminator/end node logic,
- allowlist/denylist traversal.

Ini sangat berguna untuk:

- impact analysis,
- dependency traversal,
- access graph,
- investigation graph,
- case linkage,
- network exploration.

Tetapi path expansion adalah area paling mudah menjadi mahal.

Checklist wajib:

```text
- Depth dibatasi?
- Relationship type dibatasi?
- Direction jelas?
- Label boundary jelas?
- Supernode dihindari?
- Limit bukan satu-satunya guard?
- Query di-PROFILE dengan dataset realistis?
- Timeout/transaction memory dipertimbangkan?
```

---

### 7.4 Graph Refactoring

APOC refactor procedures dapat membantu mengubah model graph:

- merge duplicate nodes,
- merge relationships,
- rename labels,
- rename relationship types,
- rename properties,
- invert relationship direction,
- redirect relationship endpoint,
- extract node dari relationship,
- normalize property.

Ini sangat berguna saat model berevolusi.

Contoh skenario:

```text
Sebelumnya:
(:Person)-[:OWNS {percentage, startDate, evidenceId}]->(:Company)

Setelah requirement berubah:
ownership harus punya multiple evidence, legal basis, temporal revision, reviewer.

Maka relationship OWNS mungkin perlu diekstrak menjadi node:
(:Person)-[:PARTY_IN]->(:Ownership)-[:TARGETS]->(:Company)
(:Ownership)-[:SUPPORTED_BY]->(:Evidence)
(:Ownership)-[:REVIEWED_BY]->(:Officer)
```

APOC bisa membantu refactor awal. Tetapi migrasi production harus tetap:

- versioned,
- repeatable,
- tested,
- backed up,
- reversible sejauh mungkin,
- dilengkapi validation query,
- dijalankan bertahap jika data besar.

---

### 7.5 Import / Export

APOC dapat membantu import/export berbagai format atau sumber. Namun untuk import besar, pilih tool berdasarkan konteks:

```text
Small/medium CSV while DB online:
  LOAD CSV atau batch Cypher

Large initial load into empty DB:
  neo4j-admin database import

Streaming updates:
  Kafka connector / CDC / app-driven ingestion

One-off transformation/refactor:
  APOC + transactional batching, dengan guard

Production export/audit:
  controlled export pipeline, bukan manual Browser copy-paste
```

Jangan menjadikan APOC import sebagai jalur ingestion utama jika kebutuhan sebenarnya adalah pipeline enterprise dengan observability, retry, DLQ, schema validation, dan reconciliation.

---

### 7.6 Periodic / Batch Execution

APOC historis sangat populer untuk batch update melalui `apoc.periodic.iterate`.

Mental model-nya:

```text
read query menghasilkan stream item
write query memproses item per batch
setiap batch dieksekusi sebagai transaksi terpisah
opsional paralel
```

Kegunaan:

- update massal,
- backfill property,
- relabel node,
- membuat derived relationships,
- cleaning data,
- migration kecil/menengah.

Risiko:

- batch terlalu besar,
- parallel write konflik lock,
- deadlock,
- partial completion,
- tidak idempotent,
- sulit rollback,
- query read menghasilkan order tidak stabil,
- memory pressure,
- production impact.

Dalam Cypher modern, evaluasi dulu apakah transactional subquery native lebih tepat.

Contoh pola native konseptual:

```cypher
MATCH (p:Person)
CALL (p) {
  SET p.normalizedName = toLower(trim(p.name))
} IN TRANSACTIONS OF 1000 ROWS;
```

Atau untuk parallel/concurrent jika versi mendukung dan operasi aman:

```cypher
MATCH (p:Person)
CALL (p) {
  SET p.normalizedName = toLower(trim(p.name))
} IN CONCURRENT TRANSACTIONS OF 1000 ROWS;
```

Namun concurrent write hanya aman bila tidak ada konflik node/relationship yang sama.

---

## 8. APOC Anti-Patterns

### 8.1 `apoc.cypher.run` sebagai Query String Builder Bebas

Dynamic Cypher kadang berguna, tetapi raw dynamic query sangat rawan:

- injection,
- plan cache buruk,
- sulit review,
- sulit trace,
- sulit test,
- permission boundary kabur.

Anti-pattern:

```cypher
CALL apoc.cypher.run(
  'MATCH (n:' + $label + ') WHERE n.name = "' + $name + '" RETURN n',
  {}
)
```

Lebih aman:

- gunakan parameter,
- validasi label/type dari allowlist aplikasi,
- hindari input user menjadi token query langsung,
- simpan query template di codebase,
- audit semua dynamic query.

---

### 8.2 APOC sebagai Business Rule Engine

Contoh buruk:

```text
Case escalation final ditentukan oleh kumpulan APOC query manual.
Risk score dihitung oleh scheduled APOC job tanpa test.
Access decision dihitung oleh procedure yang hanya dipahami satu developer.
```

Masalah:

- sulit dites,
- sulit explain,
- sulit versioning,
- sulit audit,
- sulit observability,
- ownership kabur.

Better:

```text
Business rule ada di service/pipeline yang versioned dan tested.
Cypher/APOC hanya data access/transformation primitive.
```

---

### 8.3 Manual Data Fix via Browser + APOC

Ini sering terjadi di production incident:

```text
Ada data salah.
Developer buka Browser.
Menjalankan query APOC refactor manual.
Masalah selesai.
Tapi tidak ada script, tidak ada review, tidak ada audit, tidak ada validation.
```

Untuk sistem regulatory, ini hampir selalu tidak defensible.

Better:

```text
1. Buat migration/fix script.
2. Review.
3. Jalankan di staging copy.
4. Ambil backup/snapshot.
5. Jalankan production dengan change ticket.
6. Simpan before/after counts.
7. Simpan validation query result.
8. Buat postmortem bila incident.
```

---

### 8.4 Batch Parallel Tanpa Memahami Lock

Parallel batch bisa mempercepat, tetapi jika batch menyentuh node yang sama, lock conflict muncul.

Contoh risiko:

```text
Membuat relationship dari banyak transaksi menuju node Merchant populer.
Semua thread mencoba update degree/list relationship node yang sama.
Terjadi contention/deadlock/transient error.
```

Mitigasi:

- batch berdasarkan partition yang tidak konflik,
- sort/group by endpoint,
- kurangi parallelism,
- gunakan retry,
- pakai idempotent writes,
- profile di dataset realistis,
- jalankan off-peak.

---

### 8.5 APOC untuk Mengakali Model yang Salah

Tanda-tanda:

```text
Query sederhana butuh banyak APOC path/filter/collection trick.
Harus pakai query dinamis karena label/type terlalu banyak.
Harus merge/refactor data setiap hari karena model tidak stabil.
Traversal butuh blacklist/whitelist kompleks karena relationship semantics tidak jelas.
```

Kemungkinan akar masalah:

- relationship type terlalu generik,
- label taxonomy buruk,
- property semestinya menjadi relationship,
- relationship semestinya menjadi node,
- supernode belum dipecah,
- temporal modelling salah,
- source-of-truth/projection boundary tidak jelas.

---

## 9. Neo4j Browser / Query

Neo4j Browser adalah interface developer untuk menjalankan Cypher dan memvisualisasikan hasil graph. Dalam Aura/produk modern, pengalaman ini sering hadir sebagai Query tool.

Kegunaan utama:

1. query exploration,
2. model inspection,
3. quick debugging,
4. visual validation,
5. schema/index/constraint inspection,
6. running admin commands dalam konteks terbatas,
7. learning Cypher,
8. sharing examples.

Strength:

- sangat cepat untuk eksplorasi,
- hasil graph visual langsung,
- cocok untuk pembelajaran,
- cocok untuk debugging query.

Limit:

- bukan migration runner,
- bukan audit system,
- bukan pipeline ingestion,
- bukan production automation,
- history lokal bukan source of truth,
- visual result bisa menipu karena hanya subset data.

Rule sehat:

```text
Browser/Query boleh untuk melihat, mencoba, dan mendiagnosis.
Untuk perubahan production, pindahkan query ke script/versioned job/change process.
```

---

## 10. Neo4j Bloom

Neo4j Bloom adalah aplikasi visual graph exploration untuk user yang tidak harus menulis Cypher. Bloom cocok untuk analyst, investigator, domain expert, dan stakeholder yang perlu melihat hubungan data secara intuitif.

Kegunaan:

1. eksplorasi graph visual,
2. investigation workflow,
3. menemukan pola tersembunyi,
4. demo domain model,
5. analyst-driven discovery,
6. understanding connected context,
7. stakeholder communication.

Contoh dalam enforcement/case management:

```text
Investigator membuka subject Person.
Bloom menampilkan connected organizations, accounts, cases, transactions, evidence.
Investigator expand relationship tertentu: OWNS, CONTROLS, ASSOCIATED_WITH.
Investigator menemukan hidden link ke case lain.
```

Ini sangat powerful. Namun:

```text
Bloom exploration ≠ formal decision.
```

Untuk keputusan regulatory, hasil Bloom harus diterjemahkan menjadi:

- query reproducible,
- evidence references,
- timestamp,
- actor/user identity,
- decision rationale,
- saved report/snapshot,
- audit trail.

Risiko Bloom:

1. over-expansion membuka data sensitif,
2. visual graph menciptakan false impression of causality,
3. analyst bias,
4. hasil eksplorasi tidak reproducible,
5. perspective terlalu permisif,
6. security trimming tidak cukup dipikirkan.

Governance Bloom:

```text
- define perspectives per role,
- limit searchable labels/properties,
- restrict relationship expansion,
- train users: connection is not proof,
- require reproducible query/report for formal action,
- monitor access to sensitive graph data.
```

---

## 11. Neo4j Desktop

Neo4j Desktop berguna untuk local development, learning, prototyping, plugin experiments, dan graph app exploration.

Kegunaan:

- local database instance,
- sandbox experiments,
- plugin testing,
- small demo graph,
- model prototyping,
- Cypher learning.

Jangan salah gunakan Desktop sebagai:

- production database,
- shared team environment tanpa governance,
- source-of-truth dataset,
- secure regulated environment.

Pattern sehat:

```text
Desktop/local:
  - prototype model
  - test Cypher shape
  - explore sample data

Staging:
  - realistic dataset
  - constraints/indexes
  - migration test
  - performance profile

Production:
  - controlled deployment
  - restricted plugins
  - monitoring
  - backup
  - change management
```

---

## 12. Neo4j Aura Console

Neo4j Aura adalah layanan cloud managed Neo4j. Aura console membantu provisioning, monitoring, connection details, backups/snapshots tergantung tier, dan operational management.

Kelebihan managed service:

- operational burden berkurang,
- provisioning cepat,
- patching/maintenance lebih terkelola,
- cloud-native integration lebih mudah,
- cocok untuk tim yang tidak ingin mengoperasikan cluster sendiri.

Tetap harus dipikirkan:

- network access,
- IAM/SSO,
- database user/role,
- backup policy,
- export strategy,
- data residency,
- cost control,
- query workload,
- performance tier,
- observability integration,
- incident response.

Managed tidak berarti bebas governance.

---

## 13. Tooling untuk Developer Workflow

Developer Neo4j yang efektif butuh workflow seperti ini:

```text
1. Modelling hypothesis
2. Sample graph creation
3. Query sketch in Browser/Query
4. PROFILE/EXPLAIN
5. Add constraints/indexes
6. Move query to application/repository code
7. Parameterize
8. Add tests
9. Add performance regression test for critical query
10. Add observability/logging
```

Developer tools yang umum:

- Browser/Query untuk eksplorasi,
- Java Driver untuk app code,
- Testcontainers untuk integration test,
- migration tool/script,
- `cypher-shell` untuk automation,
- logs/metrics untuk profiling,
- APOC untuk utilitas terbatas,
- local Neo4j Desktop/Docker.

Minimum standard untuk query production:

```text
- Query disimpan di codebase.
- Parameterized.
- Ada test data.
- Ada expected result.
- Sudah di-PROFILE di dataset representatif.
- Tidak ada cartesian product tidak sengaja.
- Traversal bounded.
- Index/constraint dependency jelas.
- Error handling/retry jelas.
```

---

## 14. Tooling untuk Analyst / Investigator

Untuk analyst atau investigator, tool utama biasanya Bloom atau UI internal yang dibangun di atas Neo4j.

Workflow sehat:

```text
1. Search known entity.
2. Expand relevant relationship only.
3. Save/record discovered path.
4. Validate with structured query/report.
5. Attach evidence/provenance.
6. Escalate or close finding.
```

Hal yang harus dicegah:

```text
- Expand everything.
- Menyamakan koneksi dengan bukti pelanggaran.
- Mengambil screenshot visual graph sebagai satu-satunya evidence.
- Mengabaikan temporal validity.
- Mengabaikan data source confidence.
- Mengabaikan permission boundary.
```

Untuk sistem enforcement, graph exploration sebaiknya selalu membedakan:

```text
Known fact
Derived connection
Suspicious pattern
Investigative hypothesis
Confirmed violation
Regulatory decision
```

---

## 15. Tooling untuk Operator / SRE / DBA

Operator tidak hanya butuh query tool. Mereka butuh operational control plane.

Yang perlu dimonitor:

- database availability,
- cluster health,
- transaction throughput,
- lock contention,
- slow queries,
- query memory,
- heap usage,
- page cache hit ratio,
- disk usage,
- transaction log growth,
- backup success,
- failed authentication,
- connection pool pressure,
- CPU and IO saturation.

Tooling yang relevan:

- Aura console / operations dashboard,
- metrics endpoint / Prometheus integration,
- query logs,
- debug logs,
- `SHOW TRANSACTIONS`,
- `SHOW INDEXES`,
- `SHOW CONSTRAINTS`,
- admin commands,
- backup/restore tools,
- cypher-shell automation,
- cloud provider monitoring.

Runbook operator harus menjawab:

```text
- Query mana yang sedang lambat?
- Apakah bottleneck CPU, heap, page cache, disk, lock, atau bad plan?
- Apakah ada batch APOC besar berjalan?
- Apakah ada migration/refactor berjalan?
- Apakah cluster routing sehat?
- Apakah backup terakhir valid?
- Apakah storage hampir penuh?
- Apakah ada privilege/procedure misuse?
```

---

## 16. `cypher-shell` dan Automation

`cypher-shell` berguna untuk menjalankan Cypher dari command line/script.

Use case:

- CI validation,
- migration execution,
- smoke test,
- admin inspection,
- batch scripts,
- scheduled maintenance,
- data quality checks.

Contoh pola:

```bash
cypher-shell \
  -a neo4j://localhost:7687 \
  -u neo4j \
  -p "$NEO4J_PASSWORD" \
  -f migrations/020-add-case-evidence-constraints.cypher
```

Prinsip:

```text
Jangan hardcode credential.
Jangan jalankan script destructive tanpa dry-run/backup.
Jangan pakai shell history sebagai audit trail.
Simpan script di repository.
Tambahkan validation query.
```

---

## 17. Neo4j Admin Tools

Admin tools dipakai untuk operasi level database/DBMS, bukan query application biasa.

Kegunaan umum:

- database import offline,
- backup,
- restore,
- consistency check,
- database management,
- diagnostics.

Prinsip:

```text
Admin tools adalah operational scalpel.
Jangan dipakai sebagai workflow aplikasi.
```

Sebelum menjalankan operasi admin besar:

```text
- Pastikan environment benar.
- Pastikan backup ada.
- Pastikan window maintenance disetujui.
- Pastikan rollback plan ada.
- Pastikan operator tahu estimasi impact.
- Pastikan validation setelah operasi.
```

---

## 18. Neo4j Logs dan Query Logs sebagai Tooling

Logs adalah tooling paling underrated.

Jenis informasi penting:

- query lambat,
- transaction timeout,
- deadlock/transient error,
- authentication failure,
- cluster events,
- checkpoint,
- backup,
- plugin loading,
- memory pressure,
- index population.

Query log berguna untuk:

- menemukan expensive query,
- mengidentifikasi query template buruk,
- melihat parameter shape,
- mendeteksi unbounded traversal,
- mendeteksi batch manual,
- capacity planning.

Namun query log juga bisa mengandung data sensitif jika tidak dikonfigurasi hati-hati.

Governance:

```text
- Redact sensitive parameter jika perlu.
- Batasi akses log.
- Integrasikan ke SIEM/observability stack.
- Buat alert untuk pola berbahaya.
- Simpan retention sesuai policy.
```

---

## 19. Graph Visualization: Manfaat dan Bahaya

Graph visual sangat membantu manusia memahami koneksi. Tapi visual graph juga mudah menipu.

Manfaat:

- menunjukkan konteks relasi,
- mempercepat discovery,
- membantu komunikasi stakeholder,
- menunjukkan path/evidence,
- memvalidasi model secara intuitif.

Bahaya:

- node besar terlihat “penting” padahal layout artifact,
- edge dekat terlihat “kuat” padahal tidak berbobot,
- visual subset dianggap lengkap,
- connection dianggap causation,
- temporal order tidak terlihat,
- confidence/provenance tersembunyi.

Rule untuk domain serius:

```text
Visual graph adalah interface eksplorasi.
Keputusan harus didukung query reproducible, evidence, timestamp, dan reasoning tertulis.
```

---

## 20. APOC dalam Migration dan Refactoring Workflow

Migration graph berbeda dari migration relational biasa karena perubahan bisa mencakup:

- labels,
- relationship types,
- relationship direction,
- relationship properties,
- relationship-to-node reification,
- derived edge creation,
- duplicate node merge,
- temporal model rewrite,
- provenance enrichment.

Workflow yang baik:

```text
1. Define target graph model.
2. Write migration Cypher/APOC script.
3. Add precondition checks.
4. Run on sample/staging copy.
5. Validate counts and invariants.
6. PROFILE expensive parts.
7. Decide batch size.
8. Decide parallel or sequential.
9. Backup production.
10. Execute with monitoring.
11. Run post-validation.
12. Keep script and result artifact.
```

Contoh validation checks:

```cypher
// Count migrated relationships
MATCH (:Person)-[r:PARTY_IN]->(:Ownership)
RETURN count(r) AS partyInCount;

// Check ownership nodes without target
MATCH (o:Ownership)
WHERE NOT (o)-[:TARGETS]->(:Company)
RETURN count(o) AS orphanOwnership;

// Check duplicate ownership external IDs
MATCH (o:Ownership)
WITH o.externalId AS id, count(*) AS c
WHERE c > 1
RETURN id, c
LIMIT 20;
```

---

## 21. Tooling Governance Matrix

Gunakan matrix ini untuk menentukan siapa boleh memakai apa.

| Tool / Capability | Developer Local | Staging | Production Read | Production Write | Notes |
|---|---:|---:|---:|---:|---|
| Browser/Query read | Yes | Yes | Limited | No by default | Production read perlu RBAC |
| Browser/Query write | Yes | Controlled | No | Exceptional | Harus change ticket |
| Bloom exploration | Yes | Yes | Role-based | Usually no | Cocok analyst, bukan mutation |
| APOC collection/map | Yes | Yes | Controlled | Controlled | Prefer query codebase |
| APOC refactor | Yes | Controlled | No | Change-managed | Migration only |
| APOC import/export | Yes | Controlled | Limited | Change-managed | Data leakage risk |
| APOC path expand | Yes | Yes | Controlled | N/A | Guard traversal |
| Dynamic Cypher APOC | Avoid | Avoid | Avoid | Avoid | High risk |
| Admin tools | Local only | Operator | Operator | Operator | Strict access |
| Custom procedure | Rare | Reviewed | Reviewed | Reviewed | Security review required |

---

## 22. Production Policy Template untuk APOC

Contoh policy singkat:

```text
1. APOC disabled by default unless explicitly required.
2. Only required APOC procedures/functions are allowlisted.
3. APOC Extended requires architecture/security approval.
4. Procedures capable of file/network/system access require explicit risk review.
5. Dynamic query execution via APOC is prohibited unless approved.
6. Data-changing APOC usage in production must be executed through versioned scripts.
7. Manual Browser execution for production writes requires emergency/change process.
8. All migration/refactor APOC scripts require pre/post validation queries.
9. Long-running APOC jobs must be monitored and have abort criteria.
10. Production users receive least privilege roles.
```

---

## 23. Tooling Decision Framework

Saat ada kebutuhan, pilih tool dengan pertanyaan berikut.

### Pertanyaan 1 — Apakah ini query aplikasi normal?

Jika ya:

```text
Gunakan Java Driver / Spring Data Neo4j + parameterized Cypher.
Jangan pakai Browser/APOC sebagai runtime logic.
```

### Pertanyaan 2 — Apakah ini eksplorasi developer?

Jika ya:

```text
Browser/Query, Desktop/local DB, sample data.
```

### Pertanyaan 3 — Apakah ini eksplorasi analyst?

Jika ya:

```text
Bloom atau UI internal dengan role/perspective yang jelas.
```

### Pertanyaan 4 — Apakah ini migration/refactor?

Jika ya:

```text
Versioned script + Cypher native + APOC refactor jika perlu + validation + backup.
```

### Pertanyaan 5 — Apakah ini bulk import awal?

Jika ya:

```text
neo4j-admin import untuk large empty DB.
LOAD CSV / batch Cypher untuk smaller online import.
```

### Pertanyaan 6 — Apakah ini streaming data ongoing?

Jika ya:

```text
Kafka connector / CDC / application ingestion pipeline.
Jangan jadikan manual APOC import sebagai ingestion utama.
```

### Pertanyaan 7 — Apakah ini butuh algoritma graph?

Jika ya:

```text
Graph Data Science, bukan APOC ad-hoc traversal kalau problem-nya centrality/community/similarity/path weighted.
```

---

## 24. Contoh End-to-End: Data Quality Investigation

Requirement:

```text
Temukan Person duplicate berdasarkan normalized identity dan merge duplicate secara terkendali.
```

### 24.1 Eksplorasi Awal

```cypher
MATCH (p:Person)
WHERE p.normalizedNationalId IS NOT NULL
WITH p.normalizedNationalId AS id, collect(p) AS people, count(*) AS c
WHERE c > 1
RETURN id, c, people[0..5]
ORDER BY c DESC
LIMIT 20;
```

### 24.2 Risk Assessment

Sebelum merge:

```cypher
MATCH (p:Person)
WHERE p.normalizedNationalId = $id
RETURN p.externalId, labels(p), properties(p), size((p)--()) AS degree;
```

Pertanyaan:

```text
- Apakah duplicate benar-benar sama orang?
- Apakah source berbeda punya confidence berbeda?
- Apakah ada conflicting properties?
- Relationship mana yang harus digabung?
- Apakah ada audit trail merge?
```

### 24.3 Merge dengan APOC Refactor? Hati-Hati

APOC `mergeNodes` bisa membantu, tetapi jangan langsung jalankan untuk semua duplicate.

Better approach:

```text
1. Create CandidateDuplicate group.
2. Review manually/algorithmically.
3. Mark approved merge.
4. Execute controlled merge batch.
5. Store provenance.
6. Preserve old external IDs.
```

Contoh model defensible:

```cypher
MERGE (g:EntityResolutionGroup {id: $groupId})
SET g.status = 'APPROVED',
    g.reason = $reason,
    g.approvedAt = datetime(),
    g.approvedBy = $approvedBy;
```

Kemudian merge fisik hanya jika benar-benar acceptable. Alternatif lebih defensible adalah membuat canonical node:

```text
(:PersonSourceRecord)-[:RESOLVES_TO]->(:PersonCanonical)
```

Ini sering lebih baik untuk regulatory systems karena fakta historis tidak hilang.

---

## 25. Contoh End-to-End: Derived Relationship Backfill

Requirement:

```text
Untuk mempercepat query case impact, buat relationship derived:
(:Case)-[:RELATED_TO {reason, createdByJob, createdAt}]->(:Case)

Jika dua case berbagi subject person atau organization.
```

### 25.1 Query Awal

```cypher
MATCH (c1:Case)-[:HAS_SUBJECT]->(s)<-[:HAS_SUBJECT]-(c2:Case)
WHERE id(c1) < id(c2)
RETURN c1.caseId, c2.caseId, labels(s), s.externalId
LIMIT 20;
```

### 25.2 Backfill Bounded

```cypher
MATCH (c1:Case)-[:HAS_SUBJECT]->(s)<-[:HAS_SUBJECT]-(c2:Case)
WHERE id(c1) < id(c2)
WITH c1, c2, collect(DISTINCT s.externalId)[0..10] AS sharedSubjects
CALL (c1, c2, sharedSubjects) {
  MERGE (c1)-[r:RELATED_TO {reason: 'SHARED_SUBJECT'}]->(c2)
  SET r.sharedSubjects = sharedSubjects,
      r.createdByJob = 'backfill-case-related-to-v1',
      r.createdAt = datetime()
} IN TRANSACTIONS OF 1000 ROWS;
```

### 25.3 Validation

```cypher
MATCH (:Case)-[r:RELATED_TO {reason: 'SHARED_SUBJECT'}]->(:Case)
RETURN count(r) AS relatedCaseEdges;
```

### 25.4 Governance

Derived relationship harus punya:

```text
- reason,
- generation rule version,
- job id,
- createdAt,
- source facts or reproducible query,
- refresh policy,
- deletion/reconciliation policy.
```

Jika tidak, derived edge bisa menjadi stale truth.

---

## 26. Contoh End-to-End: Bloom untuk Investigator

Requirement:

```text
Investigator perlu melihat koneksi antara Person, Organization, Account, Case, Evidence.
```

Bloom perspective bisa dirancang seperti:

```text
Allowed search:
- Person by name/nationalId masked
- Organization by registration number/name
- Case by case number

Allowed expand:
- Person OWNS Organization
- Person CONTROLS Account
- Account TRANSACTED_WITH Account
- Case HAS_SUBJECT Person/Organization
- Case SUPPORTED_BY Evidence

Restricted:
- Officer personal data
- unrelated tenant data
- sealed evidence
- privileged legal advice
```

Guardrail:

```text
- Expansion depth default 1-2.
- Sensitive labels hidden unless role permits.
- Visual finding must be converted into investigation note/report.
- Report references reproducible Cypher query or saved graph state.
```

---

## 27. Hidden Complexity: Tooling Bisa Mengubah Socio-Technical System

Tooling bukan hanya teknis. Tooling mengubah cara orang bekerja.

Jika Bloom membuat investigator mudah menemukan “hubungan”, maka organisasi juga harus mendefinisikan:

```text
Apa arti hubungan?
Apa bedanya coincidence, association, suspicion, evidence, dan finding?
Siapa boleh melihat apa?
Bagaimana hasil eksplorasi direview?
Bagaimana false positive ditangani?
Bagaimana audit trail disimpan?
```

Jika APOC membuat developer mudah melakukan refactor massal, maka organisasi juga harus mendefinisikan:

```text
Siapa boleh menjalankan refactor?
Apakah harus ada backup?
Apakah harus ada approval?
Bagaimana rollback?
Bagaimana membuktikan data tidak rusak?
```

Top engineer melihat tool bukan hanya capability, tapi juga control surface.

---

## 28. Checklist Review Penggunaan APOC di Pull Request

Gunakan checklist ini saat review query/script yang memakai APOC.

```text
Purpose
[ ] Apakah penggunaan APOC punya alasan jelas?
[ ] Apakah Cypher native cukup?
[ ] Apakah operasi ini read-only atau write?

Security
[ ] Apakah procedure/function ini di-allowlist?
[ ] Apakah membutuhkan unrestricted?
[ ] Apakah ada file/network access?
[ ] Apakah input user masuk ke dynamic query?

Correctness
[ ] Apakah operasi idempotent?
[ ] Apakah ada constraints pendukung?
[ ] Apakah ada precondition check?
[ ] Apakah ada post-validation?

Performance
[ ] Apakah traversal bounded?
[ ] Apakah batch size realistis?
[ ] Apakah parallelism aman dari lock conflict?
[ ] Apakah sudah diuji di dataset representatif?

Operations
[ ] Apakah script versioned?
[ ] Apakah backup diperlukan?
[ ] Apakah ada rollback/compensation plan?
[ ] Apakah ada monitoring saat eksekusi?
[ ] Apakah ada audit artifact?
```

---

## 29. Production Runbook: Menangani Query/APOC Job Bermasalah

Gejala:

```text
CPU tinggi, heap pressure, query lambat, transaction timeout, lock contention, DB tidak responsif.
```

Langkah:

```text
1. Identifikasi query/transaction aktif.
2. Cari apakah ada batch APOC / refactor / import berjalan.
3. Cek query log dan transaction metadata jika tersedia.
4. Cek lock contention / waiting transaction.
5. Cek heap/page cache/disk IO.
6. Jika query runaway, terminate transaction secara terkendali.
7. Validasi apakah job partial completed.
8. Jalankan reconciliation query.
9. Putuskan resume/rollback/compensate.
10. Simpan incident notes.
```

Pertanyaan setelah incident:

```text
- Kenapa job bisa dijalankan di jam itu?
- Kenapa batch/parallelism tidak aman?
- Kenapa tidak ada limit/timeout?
- Kenapa staging test tidak menangkap masalah?
- Apakah procedure seharusnya dibatasi?
- Apakah perlu policy baru?
```

---

## 30. Tooling Architecture untuk Tim Java

Untuk tim Java enterprise, arsitektur yang sehat biasanya seperti ini:

```text
repo/
  src/main/java/
    domain/
    application/
    infrastructure/neo4j/
      queries/
      Neo4jCaseRepository.java
      Neo4jInvestigationGraphRepository.java
      Neo4jTransactionRunner.java
  src/test/java/
    integration/
      Neo4jContainerTests.java
  db/neo4j/
    constraints/
    indexes/
    migrations/
    refactors/
    validations/
  docs/
    graph-model.md
    query-catalog.md
    apoc-policy.md
    bloom-perspectives.md
```

Query production jangan tersebar di:

```text
- Browser history,
- Slack snippet,
- local notebook,
- analyst screenshot,
- one-off shell command tanpa repo.
```

Query production harus menjadi artifact engineering.

---

## 31. Kapan Membuat Custom Procedure?

Custom procedure/function bisa dibuat dalam Java untuk memperluas Neo4j.

Gunakan hanya jika:

1. Cypher native tidak cukup,
2. APOC tidak cukup atau tidak sesuai,
3. logic sangat dekat dengan graph execution,
4. performa memerlukan server-side procedure,
5. input/output bisa didefinisikan jelas,
6. security review memungkinkan,
7. tim siap maintain plugin lintas upgrade Neo4j,
8. testing dan deployment process matang.

Jangan buat custom procedure hanya karena:

```text
- developer lebih nyaman menulis Java daripada Cypher,
- ingin menyembunyikan query kompleks,
- ingin bypass permission,
- ingin cepat tanpa desain model ulang,
- ingin menjalankan business workflow di database.
```

Custom procedure adalah dependency runtime database. Treat it seriously.

---

## 32. Summary Mental Model

Satu kalimat:

```text
APOC dan tooling Neo4j mempercepat eksplorasi, refactoring, operasi, dan productivity, tetapi harus diperlakukan sebagai controlled extension surface, bukan tempat menyembunyikan business logic atau menggantikan architecture discipline.
```

Lebih struktural:

```text
Cypher native:
  default query language

Java Driver / SDN:
  application integration boundary

APOC:
  utility and extension toolbox

Browser/Query:
  developer exploration and diagnostics

Bloom:
  visual exploration for analyst/domain expert

Desktop:
  local development/prototyping

Aura console/admin tools:
  operational management

Logs/metrics:
  production truth for behaviour

GDS:
  graph analytics, not generic APOC replacement
```

---

## 33. Practical Exercises

### Exercise 1 — APOC Policy Draft

Buat policy untuk production Neo4j:

```text
- APOC procedures allowed
- APOC procedures prohibited
- siapa boleh menjalankan
- approval process
- audit requirement
- emergency exception
```

### Exercise 2 — Refactor Script Review

Ambil satu model relationship-property yang mulai kompleks. Desain migration menjadi reified node.

Deliverables:

```text
- before model
- after model
- migration query
- validation query
- rollback/compensation idea
- risk analysis
```

### Exercise 3 — Bloom Perspective Design

Desain Bloom perspective untuk investigation graph:

```text
- searchable entities
- allowed expansions
- hidden labels/properties
- max depth guidance
- report requirement
```

### Exercise 4 — Query Governance

Ambil 5 query Cypher dari Browser history atau eksperimen. Klasifikasikan:

```text
- throwaway exploration
- candidate production query
- migration/refactor query
- dangerous query
- analyst visualization query
```

Pindahkan candidate production query ke struktur repository yang proper.

---

## 34. Checklist Top 1% Engineer untuk Tooling Neo4j

Kamu mulai matang dalam tooling Neo4j jika:

```text
[ ] Kamu tidak mengaktifkan APOC luas tanpa alasan.
[ ] Kamu selalu mencoba Cypher native sebelum APOC.
[ ] Kamu tahu mana APOC read helper dan mana APOC write/refactor risk.
[ ] Kamu tidak menyimpan business rule penting di Browser/Bloom/APOC ad-hoc.
[ ] Kamu membuat migration/refactor sebagai artifact versioned.
[ ] Kamu punya validation query sebelum dan sesudah perubahan massal.
[ ] Kamu memperlakukan Bloom sebagai exploration interface, bukan final evidence engine.
[ ] Kamu membedakan developer tool, analyst tool, dan operator tool.
[ ] Kamu punya allowlist/procedure governance.
[ ] Kamu memahami risiko dynamic Cypher.
[ ] Kamu tahu kapan batch parallel berbahaya karena lock contention.
[ ] Kamu punya runbook untuk runaway query/job.
[ ] Kamu menghubungkan tooling dengan auditability dan regulatory defensibility.
```

---

## 35. Hubungan ke Part Berikutnya

Bagian ini membahas tooling dan APOC sebagai utility ecosystem.

Part berikutnya akan masuk ke **Graph Data Science Fundamentals**, yaitu pergeseran dari operational graph query ke analytical graph computation:

```text
Operational graph:
  pertanyaan per entity/path/case

Graph data science:
  pertanyaan atas struktur graph secara keseluruhan

Contoh:
  - siapa node paling sentral?
  - komunitas apa yang terbentuk?
  - node mana yang mirip?
  - path weighted apa yang paling murah?
  - link mana yang mungkin terbentuk?
  - embedding apa yang merepresentasikan neighbourhood?
```

Jika APOC adalah toolbox utility, maka GDS adalah analytical engine untuk graph algorithms.

---

## 36. Referensi Resmi yang Relevan

Gunakan referensi resmi Neo4j untuk validasi lebih lanjut:

- Neo4j APOC documentation.
- Neo4j APOC security guidelines.
- Neo4j Operations Manual: securing extensions.
- Neo4j Operations Manual: configure plugins.
- Neo4j Browser documentation.
- Neo4j Bloom user guide.
- Neo4j Aura documentation.
- Neo4j Cypher Manual: subqueries in transactions.
- Neo4j Java Reference: user-defined procedures/functions jika membuat extension sendiri.

---

## 37. Penutup

Tooling Neo4j bisa membuat graph work jauh lebih cepat. Tapi semakin cepat sebuah tool mengubah graph, semakin besar kebutuhan governance-nya.

Untuk sistem kecil, tool membantu produktivitas.

Untuk sistem production, tool harus dikendalikan.

Untuk sistem regulatory, tool harus dapat diaudit.

Prinsip akhirnya:

```text
Use tools to accelerate understanding and controlled change.
Do not let tools become invisible architecture.
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Security, Access Control, Multi-Tenancy, and Regulatory Defensibility</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-021.md">Part 021 — Graph Data Science Fundamentals ➡️</a>
</div>
