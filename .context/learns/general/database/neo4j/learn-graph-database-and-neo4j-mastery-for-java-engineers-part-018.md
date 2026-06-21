# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-018.md

# Part 018 — Neo4j Clustering and High Availability

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu mendesain, mengoperasikan, dan men-debug Neo4j cluster secara production-grade.  
> Fokus bagian ini: high availability, read scaling, routing, causal consistency, failover, dan runbook cluster Neo4j.

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya membahas operasi Neo4j sebagai single deployment / production database instance: memory, page cache, backup, monitoring, query log, capacity, restore drill, dan security baseline.

Part ini naik satu tingkat:

```text
Dari:  "Bagaimana menjalankan Neo4j production?"
Menjadi:"Bagaimana menjalankan Neo4j ketika node bisa mati,
         workload perlu tetap tersedia,
         read perlu diskalakan,
         dan aplikasi Java harus routing read/write dengan benar?"
```

Graph database cluster tidak boleh dipikirkan seperti cluster stateless service.

Pada stateless service, menambah instance biasanya berarti:

```text
more instances ≈ more throughput
```

Pada database cluster, terutama graph database, hubungan itu tidak sesederhana itu:

```text
more database members ≠ linear write scaling
more database members ≠ bebas dari consistency concern
more database members ≠ otomatis query lebih cepat
more database members ≠ aman jika driver salah konfigurasi
```

Neo4j clustering terutama menyelesaikan beberapa masalah berikut:

1. **High availability**: database tetap bisa melayani workload meskipun sebagian server gagal.
2. **Read scalability**: query read dapat diarahkan ke beberapa anggota cluster.
3. **Operational resilience**: maintenance, rolling restart, upgrade, dan failure recovery lebih aman.
4. **Causal consistency**: aplikasi dapat memastikan read tertentu melihat hasil write sebelumnya.
5. **Topology-aware routing**: driver dapat mengirim transaksi read/write ke anggota cluster yang tepat.

Namun clustering juga menambah kompleksitas:

1. latency antar anggota cluster,
2. quorum/write acknowledgement,
3. routing table,
4. leadership transfer,
5. failover behaviour,
6. backup topology,
7. capacity imbalance,
8. stale read perception,
9. split-brain avoidance,
10. operational runbook.

Tujuan part ini bukan membuat Anda hafal semua konfigurasi cluster, melainkan membuat Anda bisa menjawab:

```text
- Apa yang sebenarnya menjadi highly available?
- Apa yang bisa diskalakan dengan cluster?
- Apa yang tidak bisa diskalakan dengan cluster?
- Bagaimana Java service harus berperilaku terhadap Neo4j cluster?
- Failure apa yang harus diantisipasi?
- Metrik apa yang harus dipantau?
- Bagaimana membedakan incident aplikasi, query, network, driver, dan database topology?
```

---

## 1. Mental Model Utama: Cluster Bukan “Banyak Database Independen”

Kesalahan mental model paling umum:

```text
"Ada 3 Neo4j server, berarti ada 3 database yang bisa ditulis bebas."
```

Mental model yang lebih tepat:

```text
Neo4j cluster adalah sekumpulan server yang bersama-sama menjalankan
copy database tertentu dengan aturan konsensus, routing, role, dan replikasi.
```

Database dalam cluster bukan sekadar file yang disalin. Ia punya:

1. **database copy** pada server berbeda,
2. **role** tertentu untuk copy tersebut,
3. **routing metadata** supaya client tahu kemana transaksi dikirim,
4. **replication protocol** untuk menjaga konsistensi,
5. **leadership/write coordination** untuk transaksi tulis,
6. **failure detection** saat anggota tidak sehat,
7. **recovery catch-up** saat anggota kembali hidup.

Secara konseptual:

```text
Client Java Service
       |
       | neo4j:// URI + routing driver
       v
Neo4j Cluster Routing
       |
       +--> Member A: database copy, eligible for writes
       +--> Member B: database copy, eligible for writes/reads
       +--> Member C: database copy, read workload / follower/secondary style role
```

Yang penting: aplikasi tidak semestinya memilih server secara manual untuk read/write jika memakai topology cluster. Aplikasi harus menggunakan **routing driver** dan access mode yang benar.

---

## 2. Apa yang Diselesaikan Clustering?

### 2.1 High Availability

High availability berarti sistem tetap dapat memenuhi fungsi kritis ketika sebagian komponen gagal.

Untuk database, HA biasanya berarti:

```text
- read tetap bisa dilayani,
- write tetap bisa dilayani selama syarat quorum/leadership terpenuhi,
- failover terjadi tanpa recovery manual penuh,
- client dapat menemukan anggota cluster yang sehat,
- data tidak corrupt karena dua writer independen.
```

Pada Neo4j, dokumentasi clustering menjelaskan bahwa untuk high availability, database dibuat dengan multiple primaries; writer primary mengirim write secara sinkron ke primary lain dan commit tidak selesai sampai cukup member mengonfirmasi. Jika terlalu banyak primary gagal, database tidak lagi dapat memproses write dan menjadi read-only.

Implikasi engineering-nya:

```text
HA bukan berarti write selalu tersedia dalam semua failure.
HA berarti write tersedia selama cluster masih punya cukup anggota untuk commit aman.
```

Ini trade-off yang benar. Database yang tetap menerima write tanpa mayoritas berisiko split-brain atau data divergence.

### 2.2 Read Scaling

Read scaling berarti query read dapat didistribusikan ke beberapa anggota cluster.

Namun read scaling tidak sama dengan:

```text
"query buruk menjadi cepat karena ada cluster"
```

Jika query melakukan traversal eksplosif, return graph terlalu besar, atau scan besar tanpa index, cluster hanya membuat masalah tersebar.

Read scaling efektif jika:

1. query read relatif independent,
2. result set terkendali,
3. page cache pada anggota read cukup hangat,
4. routing driver mengirim read dengan mode read,
5. latency antar app dan cluster tidak terlalu buruk,
6. workload tidak bottleneck di storage/network/memory.

### 2.3 Operational Continuity

Cluster membantu:

1. rolling restart,
2. rolling upgrade,
3. planned maintenance,
4. hardware replacement,
5. capacity rotation,
6. backup tanpa membebani writer utama secara berlebihan,
7. recovery anggota yang gagal.

Tetapi cluster bukan pengganti backup. Jika data corrupt secara logis karena bug aplikasi, cluster akan mereplikasi bug itu.

```text
Cluster solves availability.
Backup solves recovery.
Audit/event history solves accountability.
Reconciliation solves projection correctness.
```

---

## 3. Apa yang Tidak Diselesaikan Clustering?

### 3.1 Cluster Tidak Membuat Write Scaling Linear

Banyak engineer membawa ekspektasi dari stateless service:

```text
Tambah instance → throughput naik.
```

Untuk write database, khususnya consistent replicated database, write harus dikoordinasikan. Semakin banyak anggota yang perlu ikut acknowledgements, semakin besar kemungkinan latency koordinasi muncul.

Neo4j cluster dapat memberi HA untuk write, tetapi bukan berarti semua anggota menerima write independen seperti shard autonomous.

Pertanyaan arsitektur yang benar:

```text
Apakah bottleneck kita benar-benar write throughput?
Atau query modelling, transaction size, lock contention, ingestion batch, index, dan driver usage?
```

Sebelum mengatakan “butuh cluster untuk scale write”, cek dulu:

1. apakah write transaction terlalu besar,
2. apakah `MERGE` tidak didukung constraint,
3. apakah ada supernode lock contention,
4. apakah relationship creation menabrak node yang sama,
5. apakah batch size tidak tepat,
6. apakah index/constraint belum benar,
7. apakah aplikasi membuka terlalu banyak session/transaction,
8. apakah page cache/IO saturasi,
9. apakah query read berat mengganggu write.

### 3.2 Cluster Tidak Menghapus Kebutuhan Query Tuning

Jika query single-node lambat karena:

```text
MATCH p = (a)-[*1..10]-(b)
RETURN p
```

tanpa boundary yang kuat, cluster tidak menyembuhkan. Ia mungkin malah membuat query buruk berjalan di lebih banyak node dan menghabiskan resource lebih luas.

Cluster tidak menghilangkan:

1. cardinality problem,
2. cartesian product,
3. unbounded traversal,
4. supernode,
5. over-returning graph,
6. missing index,
7. large aggregation,
8. memory pressure.

### 3.3 Cluster Tidak Mengganti Domain Partitioning

Jika satu graph terlalu besar, terlalu dense, atau workload-nya secara natural terpisah tenant/domain, cluster bukan satu-satunya jawaban.

Kadang solusi yang lebih tepat adalah:

1. separate database per tenant/classification,
2. separate cluster per domain criticality,
3. graph projection per workload,
4. materialized relationship,
5. archival graph,
6. offline analytical graph,
7. source-of-truth relational + graph projection,
8. workload isolation antara operational graph dan GDS graph.

### 3.4 Cluster Tidak Otomatis Aman dari Human Error

Kesalahan berikut tetap dapat menghancurkan production:

1. query delete tanpa boundary,
2. migration salah,
3. import job duplicate,
4. constraint drop sembarangan,
5. backup tidak bisa restore,
6. config tidak konsisten antar member,
7. driver mengarah ke URI non-routing,
8. aplikasi mengirim read sebagai write,
9. credential bocor,
10. monitoring tidak menangkap lag/replication issue.

---

## 4. Neo4j Cluster Roles: Primary, Secondary, Writer, Reader

Istilah detail dapat berbeda antar versi dan konfigurasi Neo4j, tetapi mental model production-nya:

```text
Primary copy
- Dapat berpartisipasi dalam write consensus.
- Eligible untuk leadership/write coordination.
- Menjadi bagian dari quorum/majority untuk commit aman.

Secondary/read copy
- Membantu read scaling.
- Tidak menjadi writer untuk database tersebut.
- Dapat mengurangi beban read dari primary.
```

Dokumentasi glossary Neo4j menjelaskan primary sebagai copy database yang dapat memproses write transaction dan eligible menjadi leader; primary juga berpartisipasi dalam fault-tolerant writes karena menjadi bagian dari majority yang dibutuhkan untuk acknowledge dan commit write transaction. Secondary copy dapat offload read queries dari primary.

Cara berpikirnya:

```text
Primary = safety + write availability participant
Secondary = read capacity / workload offload
```

Jangan menganggap secondary sebagai “backup”. Ia adalah anggota serving topology, bukan substitute untuk backup restore point.

---

## 5. Leadership dan Write Path

Dalam replicated database, write perlu dikoordinasikan supaya semua anggota tidak menulis versi realitas berbeda.

Simplified write path:

```text
1. Java service membuka write transaction.
2. Routing driver memilih route write yang sesuai.
3. Query dikirim ke writer/leader yang valid.
4. Writer menjalankan transaction.
5. Write direplikasi/di-acknowledge oleh cukup anggota.
6. Commit dinyatakan sukses.
7. Bookmark/state dapat digunakan untuk causal read berikutnya.
```

Pseudo mental model:

```text
Client
  -> route write
  -> leader/writer
  -> replicate to enough primaries
  -> commit acknowledged
  -> return success + state/bookmark
```

Konsekuensinya:

1. write latency mencakup latency koordinasi,
2. network antar cluster member penting,
3. disk/fsync behaviour tetap penting,
4. cluster member lambat bisa memengaruhi commit path,
5. kehilangan terlalu banyak primary membuat write tidak tersedia,
6. failover membutuhkan driver dan aplikasi siap retry transient failure.

---

## 6. Read Path dan Routing

Read path berbeda dari write path.

Read transaction dapat diarahkan ke anggota yang dapat melayani read. Dengan routing driver dan access mode read, client tidak harus hardcode server mana yang dipakai.

Mental model:

```text
Client
  -> open read transaction
  -> driver consults routing table
  -> choose suitable reader
  -> run query
  -> stream result
```

Query Java driver yang benar harus membedakan read/write intent.

Contoh konseptual:

```java
try (Session session = driver.session(SessionConfig.builder()
        .withDatabase("neo4j")
        .build())) {

    return session.executeRead(tx -> {
        Result result = tx.run("""
            MATCH (p:Person {personId: $personId})-[:OWNS]->(a:Account)
            RETURN a.accountId AS accountId
            """, Map.of("personId", personId));

        return result.list(record -> record.get("accountId").asString());
    });
}
```

Write:

```java
try (Session session = driver.session(SessionConfig.builder()
        .withDatabase("neo4j")
        .build())) {

    session.executeWrite(tx -> {
        tx.run("""
            MERGE (p:Person {personId: $personId})
            SET p.updatedAt = datetime()
            """, Map.of("personId", personId));
        return null;
    });
}
```

Kenapa ini penting?

Jika aplikasi menjalankan semua query sebagai write transaction:

```text
- read tidak tersebar optimal,
- primary/writer lebih terbebani,
- read scaling cluster tidak dimanfaatkan,
- bottleneck muncul di tempat yang salah.
```

Jika aplikasi menjalankan write sebagai read transaction:

```text
- query gagal,
- routing tidak sesuai,
- transient error meningkat,
- aplikasi terlihat tidak stabil.
```

---

## 7. Routing Driver: Kenapa `neo4j://` Berbeda dari Target Server Manual

Dalam environment cluster, aplikasi biasanya memakai URI routing:

```text
neo4j://host:7687
neo4j+s://host:7687
neo4j+ssc://host:7687
```

Bukan hardcode:

```text
bolt://member-a:7687
```

Mental model:

```text
neo4j://  -> driver meminta routing table dan mengarahkan query sesuai mode read/write
default bolt:// direct -> target spesifik, bukan topology-aware routing cluster
```

Dokumentasi Java Driver menjelaskan routing behaviour driver bekerja bersama Neo4j clustering dengan mengarahkan read/write transactions ke cluster members yang sesuai. Jika ingin target machine spesifik, gunakan URI `bolt`, `bolt+s`, atau `bolt+ssc`.

Production implication:

```text
Jika menggunakan cluster tetapi aplikasi memakai direct bolt URI ke satu member,
Anda mungkin secara tidak sengaja membuat single point of failure client-side.
```

Checklist driver URI:

1. gunakan routing URI untuk cluster,
2. set database name eksplisit,
3. gunakan encrypted scheme sesuai environment,
4. jangan hardcode semua traffic ke leader,
5. jangan taruh load balancer TCP bodoh yang memecah routing semantics tanpa desain,
6. pastikan DNS/VIP/LB compatible dengan routing discovery,
7. uji behaviour saat member mati,
8. uji behaviour saat leadership berubah.

---

## 8. Causal Consistency: “Read Setelah Write” Tidak Boleh Berdasarkan Harapan

Dalam distributed database, setelah write sukses, read berikutnya mungkin dikirim ke anggota lain. Jika anggota itu belum melihat state terbaru, aplikasi bisa mengira data hilang.

Causal consistency menjawab masalah:

```text
Jika operasi B secara logis bergantung pada operasi A,
B tidak boleh melihat state sebelum A.
```

Contoh domain:

```text
1. Investigator membuat Case.
2. Sistem langsung membuka halaman detail Case.
3. Read detail harus melihat Case yang baru dibuat.
```

Jika read diarahkan ke anggota cluster yang belum catch up, user melihat:

```text
"Case not found"
```

Padahal write sukses.

Ini bukan bug domain. Ini consistency/routing issue.

Neo4j menggunakan bookmark/state mechanism pada driver untuk mengkoordinasikan causal consistency. Dokumentasi HTTP API menjelaskan bookmark sebagai token yang merepresentasikan state database, dan server memastikan query tidak dieksekusi sebelum state tersebut tersedia. Java Driver juga menyediakan bookmark manager untuk menjaga causal consistency lintas transaksi.

Mental model:

```text
write transaction returns state marker
read transaction carries dependency on that marker
cluster waits/routes so read sees required state
```

Dalam aplikasi Java, managed transactions dan bookmark manager default biasanya membantu untuk alur linear dalam driver/session pattern yang benar. Tetapi Anda harus berhati-hati pada:

1. parallel transaction,
2. request berbeda yang membawa dependency state,
3. async workflow,
4. event-driven projection,
5. multi-service read-after-write,
6. mix antara executableQuery dan session manual,
7. custom driver lifecycle.

---

## 9. Causal Consistency Contoh Kasus

### 9.1 Create Case → Read Case Detail

Flow:

```text
POST /cases
  -> executeWrite CREATE/MERGE Case
  -> returns caseId

GET /cases/{caseId}
  -> executeRead MATCH Case
```

Jika request GET terjadi di service instance berbeda, dan driver/bookmark tidak membawa dependency, ada risiko read diarahkan ke member yang belum punya write terbaru.

Solusi umum:

1. untuk synchronous flow, gunakan driver/session/bookmark manager yang benar,
2. untuk cross-request dependency kritis, bawa bookmark/state bila architecture memungkinkan,
3. atau route immediate read ke writer untuk flow tertentu jika benar-benar diperlukan,
4. desain UI/API agar create response sudah memuat data penting,
5. hindari immediate read yang sebenarnya redundant.

### 9.2 Escalation Write → Notification Read

Flow:

```text
1. Case escalated to EnforcementTeam.
2. Notification service membaca assignee graph.
3. Notification tidak boleh miss assignee baru.
```

Jika notification asynchronous via event, causal consistency database saja tidak cukup. Anda juga perlu event ordering dan projection acknowledgement.

Boundary:

```text
Causal consistency Neo4j mengatur visibility antar transaksi database.
Ia tidak otomatis menyelesaikan ordering antar Kafka/event bus/job scheduler/service lain.
```

### 9.3 Permission Grant → Access Check

Flow:

```text
1. Admin grant permission.
2. User langsung akses resource.
3. Access graph harus melihat permission baru.
```

Jika access check read dari cluster reader yang stale, user dapat salah ditolak.

Untuk authorization-critical read, pertimbangkan:

1. causal bookmark,
2. route read to writer setelah grant,
3. small delay UX bukan solusi defensible,
4. access decision audit mencatat graph state/version,
5. permission graph projection harus punya consistency SLA.

---

## 10. Cluster Topology Design

Cluster topology bukan hanya jumlah node.

Anda harus menjawab:

```text
- Berapa database?
- Database mana critical write?
- Database mana read-heavy?
- Apakah ada multi-tenant isolation?
- Apakah ada analytical workload?
- Apakah GDS berjalan di cluster yang sama?
- Berapa availability target?
- Berapa RPO/RTO?
- Apakah region tunggal atau multi-region?
- Network latency antar member berapa?
- Siapa yang boleh menjadi writer?
```

### 10.1 Minimal HA Topology

Konseptual:

```text
3 primary-capable members
```

Kelebihan:

1. tahan kehilangan satu member untuk write availability,
2. quorum masih mungkin,
3. operationally understandable,
4. cocok untuk banyak production awal.

Risiko:

1. read capacity terbatas,
2. semua member critical,
3. maintenance harus hati-hati,
4. jika dua member bermasalah, write berhenti.

### 10.2 HA + Read Scaling

Konseptual:

```text
3 primary-capable members
+ N secondary/read members
```

Kelebihan:

1. write safety dari primary quorum,
2. read query dapat offload ke secondary,
3. analytical/light reporting read tidak membebani writer secara langsung,
4. maintenance lebih fleksibel.

Risiko:

1. read members tetap perlu capacity,
2. query buruk tetap bisa merusak reader,
3. causal read harus diperhatikan,
4. data freshness expectation harus jelas.

### 10.3 Workload-Isolated Topology

Konseptual:

```text
Operational Graph Cluster
  - low-latency case/investigation workload

Analytical/Science Graph Environment
  - projected or replicated data
  - GDS jobs
  - batch algorithm
```

Kelebihan:

1. GDS/mass traversal tidak mengganggu OLTP graph,
2. capacity planning lebih jelas,
3. query SLA bisa dipisah,
4. lebih aman untuk experimentation.

Risiko:

1. sync/projection complexity,
2. data freshness tidak real-time penuh,
3. governance lebih kompleks,
4. biaya lebih tinggi.

---

## 11. Multi-Region Cluster: Jangan Mengejar “Global Low Latency Write” Secara Naif

Multi-region database adalah area rawan salah desain.

Keinginan bisnis:

```text
"User di semua region harus write cepat dan data langsung konsisten global."
```

Realitas distributed systems:

```text
global synchronous consistency has latency cost.
```

Jika write harus diakui oleh anggota lintas region, latency jaringan antar region masuk ke jalur commit. Jika tidak, consistency semantics berubah.

Pertanyaan yang harus dijawab:

1. Apakah semua region harus bisa write?
2. Apakah write bisa diarahkan ke home region?
3. Apakah read lokal boleh eventual/causal delayed?
4. Apakah dataset bisa dipartisi per region/tenant?
5. Apakah legal/data residency membatasi replikasi?
6. Apakah use case lebih butuh DR daripada active-active?
7. Berapa latency antar region?
8. Apa RPO/RTO yang realistis?

Untuk banyak sistem enforcement/case management, desain yang lebih defensible:

```text
primary operational region
+ disaster recovery plan
+ read replica / reporting projection jika dibutuhkan
+ clear failover procedure
```

daripada active-active global write tanpa domain partitioning yang kuat.

---

## 12. Load Balancer: Berguna, Tapi Bisa Merusak Jika Tidak Paham Routing

Load balancer sering dipasang di depan database cluster karena pola enterprise umum.

Masalahnya, Neo4j driver routing bukan sekadar TCP round-robin. Driver perlu routing table dan membedakan read/write target.

Jika LB salah:

```text
Client -> LB -> random member
```

maka bisa terjadi:

1. write dikirim ke member yang tidak bisa menerima write,
2. routing discovery gagal,
3. driver tidak mendapat advertised address yang benar,
4. client diarahkan ke node mati,
5. TLS/SNI mismatch,
6. sticky/non-sticky behaviour tidak sesuai,
7. health check menganggap port hidup padahal database tidak sehat.

Prinsip:

```text
LB boleh membantu discovery/accessibility,
tetapi jangan meniadakan routing semantics Neo4j driver.
```

Checklist LB:

1. health check benar-benar memeriksa readiness,
2. advertised address cluster benar,
3. TLS sesuai,
4. routing URI tetap dipakai,
5. failure scenario diuji,
6. tidak semua traffic dipaksa ke satu member,
7. driver logs diperiksa saat topology berubah.

---

## 13. Failure Scenarios yang Wajib Dimodelkan

### 13.1 Satu Member Mati

Expected behaviour:

```text
- cluster mendeteksi member down,
- routing table berubah,
- read/write tetap berjalan jika quorum masih cukup,
- driver mungkin menerima transient error sementara,
- retry policy harus menangani.
```

Yang harus dicek:

1. apakah aplikasi retry transient error,
2. apakah connection pool membersihkan koneksi mati,
3. apakah routing table refresh,
4. apakah alert muncul,
5. apakah backup tetap berjalan,
6. apakah capacity tersisa cukup.

### 13.2 Leader/Writer Mati

Expected behaviour:

```text
- leadership berpindah,
- write sementara gagal/tertunda,
- driver refresh route,
- retry transaction berhasil jika idempotent.
```

Risiko:

1. aplikasi tidak retry,
2. command tidak idempotent,
3. user melihat error meski retry seharusnya bisa sukses,
4. duplicate write jika retry di layer salah,
5. long transaction gagal di tengah.

Design consequence:

```text
Setiap write command penting harus aman untuk retry.
```

### 13.3 Network Partition

Network partition adalah failure yang paling berbahaya secara konseptual.

Cluster yang benar tidak boleh membiarkan dua sisi partition sama-sama melakukan write independen jika tidak aman.

Expected behaviour:

```text
- sisi yang punya quorum dapat lanjut write,
- sisi yang tidak punya quorum menjadi tidak bisa write/read-only/degraded,
- data divergence dicegah.
```

Trade-off:

```text
availability dikorbankan sebagian untuk menjaga consistency.
```

### 13.4 Slow Member

Tidak semua failure berupa mati total.

Slow member bisa karena:

1. disk IO lambat,
2. GC pause,
3. page cache miss tinggi,
4. noisy neighbor,
5. network packet loss,
6. CPU saturation,
7. query analytical berat,
8. backup/job maintenance.

Slow member lebih sulit karena sistem terlihat “up”, tetapi tail latency buruk.

Metrik penting:

1. transaction latency,
2. replication/catch-up status,
3. page cache hit ratio,
4. GC pause,
5. CPU steal,
6. disk latency,
7. connection pool wait,
8. query runtime p95/p99.

### 13.5 Reader Lag / Stale Read Perception

Gejala aplikasi:

```text
- data baru dibuat tapi tidak terlihat,
- permission baru belum aktif,
- update tampak hilang sebentar,
- user refresh lalu muncul.
```

Kemungkinan penyebab:

1. read diarahkan ke reader yang belum catch up,
2. bookmark tidak dipakai lintas transaksi,
3. aplikasi menggunakan direct URI,
4. async pipeline belum selesai,
5. cache aplikasi stale,
6. bukan masalah cluster, tetapi projection/eventual consistency layer lain.

Investigasi harus membedakan:

```text
Database causal consistency issue
vs
Application cache issue
vs
Event projection issue
vs
Transaction actually failed
vs
Query predicate salah
```

### 13.6 Routing Table Stale

Gejala:

1. intermittent failure setelah failover,
2. write dikirim ke old leader,
3. driver log menunjukkan routing table refresh,
4. sebagian service instance sehat, sebagian error.

Penyebab:

1. driver version mismatch,
2. custom connection lifecycle buruk,
3. driver dibuat per request,
4. network/DNS/LB mengganggu routing discovery,
5. advertised address salah,
6. firewall antar service dan member.

Solusi:

1. satu Driver singleton per app lifecycle,
2. gunakan routing URI,
3. upgrade driver sesuai server compatibility,
4. observability driver logs,
5. test failover secara periodik.

---

## 14. Java Service Design untuk Neo4j Cluster

### 14.1 Driver Lifecycle

Salah:

```java
public List<Account> findAccounts(String personId) {
    Driver driver = GraphDatabase.driver(uri, auth); // buruk: per request
    try (Session session = driver.session()) {
        // query
    }
}
```

Benar secara lifecycle:

```java
@Configuration
class Neo4jDriverConfig {

    @Bean(destroyMethod = "close")
    Driver neo4jDriver(Neo4jProperties props) {
        return GraphDatabase.driver(
                props.uri(),
                AuthTokens.basic(props.username(), props.password()),
                Config.builder()
                        .withMaxConnectionPoolSize(props.maxPoolSize())
                        .build()
        );
    }
}
```

Driver harus dianggap sebagai expensive, thread-safe, application-scoped object. Session/transaction dibuat per unit of work.

### 14.2 Access Mode Discipline

Repository/service layer harus membedakan method read dan write.

```java
public final class CaseGraphRepository {
    private final Driver driver;

    public CaseGraphRepository(Driver driver) {
        this.driver = driver;
    }

    public CaseView getCase(String caseId) {
        try (Session session = driver.session(SessionConfig.forDatabase("neo4j"))) {
            return session.executeRead(tx -> {
                var result = tx.run("""
                    MATCH (c:Case {caseId: $caseId})
                    OPTIONAL MATCH (c)-[:ASSIGNED_TO]->(u:User)
                    RETURN c.caseId AS caseId, c.status AS status, u.userId AS assignee
                    """, Map.of("caseId", caseId));

                var record = result.single();
                return new CaseView(
                        record.get("caseId").asString(),
                        record.get("status").asString(),
                        record.get("assignee").isNull() ? null : record.get("assignee").asString()
                );
            });
        }
    }

    public void assignCase(String caseId, String userId) {
        try (Session session = driver.session(SessionConfig.forDatabase("neo4j"))) {
            session.executeWrite(tx -> {
                tx.run("""
                    MATCH (c:Case {caseId: $caseId})
                    MATCH (u:User {userId: $userId})
                    MERGE (c)-[:ASSIGNED_TO]->(u)
                    SET c.updatedAt = datetime()
                    """, Map.of("caseId", caseId, "userId", userId));
                return null;
            });
        }
    }
}
```

### 14.3 Retry Semantics

Managed transactions can retry transient failures, but your callback must be safe to execute more than once.

Buruk:

```java
session.executeWrite(tx -> {
    tx.run("CREATE (n:AuditEvent {eventId: randomUUID(), ...})");
    externalEmailService.sendEmail(...); // side effect non-idempotent inside transaction callback
    return null;
});
```

Jika callback diulang, email bisa terkirim dua kali.

Lebih aman:

```text
1. Database transaction writes durable command/result/outbox row/node.
2. External side effect diproses setelah commit melalui outbox/idempotent dispatcher.
3. Retry database transaction tidak menggandakan side effect eksternal.
```

Graph command harus punya deterministic key:

```text
assignmentId = hash(caseId, userId, assignmentType, effectiveFrom)
```

lalu:

```cypher
MERGE (a:Assignment {assignmentId: $assignmentId})
```

bukan `CREATE` acak pada retryable flow.

### 14.4 Timeout dan Backpressure

Cluster tidak boleh diperlakukan sebagai resource tak terbatas.

Atur:

1. transaction timeout,
2. connection acquisition timeout,
3. max connection pool size,
4. request timeout di service,
5. result streaming boundary,
6. query limit,
7. circuit breaker untuk read-heavy endpoint,
8. bulkhead antara endpoint user dan batch job.

Failure yang sering terjadi:

```text
incident database dimulai dari service layer yang mengizinkan terlalu banyak
request paralel menunggu connection, lalu thread pool penuh, lalu retry storm.
```

---

## 15. Session, Transaction, dan Bookmark Boundaries

### 15.1 Session Bukan Conversation Tak Terbatas

Session adalah unit interaksi dengan database, bukan long-lived user conversation.

Jangan menyimpan session di HTTP session/user session.

Pattern:

```text
HTTP request / command handler
  -> open session
  -> execute read/write transaction
  -> consume result
  -> close session
```

### 15.2 Bookmark Boundary Harus Mengikuti Causal Dependency

Pertanyaan penting:

```text
Apakah read ini secara bisnis harus melihat write sebelumnya?
```

Jika ya, pastikan dependency state terbawa.

Contoh:

```text
create case -> open case detail: causal dependency kuat
update profile -> dashboard eventually refresh: mungkin dependency lemah
batch import -> reporting next day: dependency via pipeline watermark, bukan request bookmark
```

### 15.3 Jangan Membuat Semua Read Stronger dari Perlu

Causal consistency ada biaya koordinasi. Jangan semua read dipaksa menunggu latest global state jika use case tidak membutuhkannya.

Klasifikasi read:

```text
Critical read-after-write:
  access control, case creation confirmation, payment/risk decision, audit evidence

Normal user read:
  dashboard, list, recommendation, non-critical search

Analytical read:
  report, graph algorithm, risk batch, trend
```

Masing-masing punya consistency expectation berbeda.

---

## 16. Backup dan Cluster

Cluster bukan backup. Ulangi:

```text
Cluster is not backup.
```

Jika aplikasi menjalankan:

```cypher
MATCH (n) DETACH DELETE n
```

secara salah, cluster akan mereplikasi perubahan itu. Semua copy “available” tetapi data hilang secara logis.

Backup strategy di cluster harus mempertimbangkan:

1. member mana yang dibackup,
2. beban backup pada primary vs secondary,
3. backup consistency,
4. backup schedule,
5. restore ke environment terpisah,
6. restore drill periodik,
7. RPO/RTO,
8. encryption dan access control backup,
9. backup metadata cluster/database,
10. compatibility versi saat restore.

Operational pattern:

```text
Daily backup is not enough.
Tested restore is the real control.
```

Runbook backup cluster minimal:

1. pilih backup source yang sehat,
2. cek replication/catch-up status,
3. jalankan backup,
4. verifikasi backup artifact,
5. restore ke staging/isolated environment,
6. jalankan consistency check,
7. jalankan smoke query domain,
8. catat duration dan failure,
9. audit backup access.

---

## 17. Monitoring Neo4j Cluster

Monitoring single instance saja tidak cukup.

Cluster monitoring harus melihat:

### 17.1 Member Health

1. up/down,
2. role/status,
3. database availability,
4. leader/writer identity,
5. routing availability,
6. replication status,
7. catch-up lag,
8. disk/memory/CPU/network.

### 17.2 Query Health

1. slow query count,
2. query p95/p99 latency,
3. active queries,
4. queued queries,
5. transaction duration,
6. lock wait,
7. deadlock/transient error,
8. page cache hit ratio,
9. heap/GC pressure.

### 17.3 Driver/Application Health

1. connection pool usage,
2. connection acquisition wait,
3. retry count,
4. routing table refresh errors,
5. service endpoint p95/p99,
6. thread pool saturation,
7. error classification by Neo4j status code,
8. read/write transaction mix.

### 17.4 Business Health

Untuk case management / enforcement graph:

1. failed case creation,
2. duplicate entity rate,
3. missing assignment edge,
4. stale projection watermark,
5. access check inconclusive,
6. path query timeout,
7. risk score job delayed,
8. investigation graph load failure.

Production graph tidak sehat bukan hanya ketika CPU 100%. Ia juga tidak sehat ketika invariant domain mulai bocor.

---

## 18. Alerting: Jangan Hanya Alert “Server Down”

Alert yang berguna:

1. cluster member unavailable,
2. database cannot write / read-only unexpected,
3. leadership change frequency tinggi,
4. replication/catch-up lag tinggi,
5. page cache hit ratio turun drastis,
6. GC pause p99 naik,
7. disk usage > threshold,
8. transaction log growth abnormal,
9. slow query spike,
10. deadlock/transient error spike,
11. connection pool exhaustion,
12. routing failures,
13. backup failed,
14. restore verification failed,
15. read-after-write consistency errors dari synthetic test,
16. supernode traversal query timeout spike.

Alert buruk:

```text
CPU > 80% selama 1 menit
```

tanpa konteks.

Alert baik:

```text
Write transaction p99 > SLA selama 10 menit
AND connection acquisition wait meningkat
AND cluster member B catch-up lag naik
```

---

## 19. Capacity Planning untuk Cluster

Capacity planning cluster tidak hanya mengalikan resource single node.

Pertimbangan:

1. semua member butuh disk untuk database copy,
2. primary member butuh resource untuk write + read jika melayani read,
3. secondary/read member butuh page cache sesuai workload read,
4. network antar member masuk jalur replication,
5. backup butuh IO dan storage terpisah,
6. query berat dapat memanaskan cache berbeda di tiap member,
7. failover berarti kapasitas tersisa harus mampu menanggung beban.

Rule of thumb mental model:

```text
N member cluster harus dirancang untuk tetap melayani beban kritis
saat satu member hilang, bukan hanya saat semua sehat.
```

Contoh:

```text
Normal state:
  3 primaries + 2 readers
  CPU average 55%

Failure state:
  1 reader down
  read load pindah ke reader lain/primary
  CPU bisa naik 75-85%
```

Jika normal state sudah 80%, failure state kemungkinan incident.

Capacity checklist:

1. dataset size,
2. index size,
3. page cache requirement per member,
4. heap requirement,
5. expected QPS read/write,
6. p95/p99 query cost,
7. batch/import windows,
8. GDS/analytics isolation,
9. backup IO window,
10. failure mode headroom,
11. growth forecast,
12. tenant/domain skew,
13. supernode risk.

---

## 20. Rolling Restart dan Rolling Upgrade

Rolling operation harus dirancang sebagai controlled degradation.

Sebelum restart/upgrade:

1. cek cluster healthy,
2. cek backup terbaru valid,
3. cek disk cukup,
4. cek query load rendah atau maintenance window,
5. cek driver compatibility,
6. cek routing URI dan app retry,
7. drain member bila perlu,
8. catat current topology.

Selama rolling restart:

1. restart satu member,
2. tunggu member kembali healthy,
3. cek database available,
4. cek catch-up selesai,
5. cek routing table normal,
6. baru lanjut member berikutnya.

Jangan:

```text
restart semua member sekaligus karena "Kubernetes rolling update pasti aman".
```

Database stateful butuh readiness semantics yang lebih ketat daripada stateless pod.

---

## 21. Kubernetes dan Neo4j Cluster

Karena Anda sudah punya seri Kubernetes, bagian ini tidak mengulang dasar K8s. Fokusnya Neo4j-specific concern.

Neo4j cluster di Kubernetes butuh perhatian pada:

1. stable network identity,
2. persistent volume,
3. pod disruption budget,
4. anti-affinity,
5. readiness/liveness probes yang benar,
6. graceful shutdown,
7. ordered startup bila diperlukan,
8. backup access ke volume/network,
9. resource requests/limits realistis,
10. disk latency storage class,
11. advertised address,
12. TLS certificate,
13. cluster discovery.

Anti-pattern:

```text
- memakai ephemeral storage untuk database,
- probes terlalu agresif sehingga pod dibunuh saat GC pause pendek,
- memory limit terlalu dekat dengan heap+pagecache+native need,
- semua pod di node fisik yang sama,
- rolling update tanpa cluster health gate,
- backup sidecar tidak diuji restore.
```

Kubernetes membuat deployment repeatable. Ia tidak otomatis membuat database stateful aman.

---

## 22. Read Scaling Pattern

### 22.1 Simple OLTP Read Offload

Use case:

```text
- list related cases,
- load entity profile,
- show ownership chain bounded depth,
- check related accounts,
- fetch dashboard summary ringan.
```

Pattern:

```text
Java service executeRead
  -> routing driver
  -> reader/secondary/available read member
```

Boundary:

1. bounded traversal,
2. explicit limit,
3. index-backed starting point,
4. result projection, bukan return full graph,
5. endpoint timeout.

### 22.2 Heavy Analytical Read Isolation

Use case:

```text
- fraud ring scan,
- centrality recomputation,
- community detection prep,
- large path exploration,
- daily risk batch.
```

Pattern:

```text
Do not run unrestricted heavy analytics on operational primary workload.
Use isolated read member, separate database copy, separate cluster, or GDS projection environment.
```

### 22.3 Reporting Projection

Jika business membutuhkan report besar:

```text
Neo4j operational graph
  -> ETL/projection
  -> reporting store / OLAP / search / analytical graph
```

Jangan memaksa Neo4j OLTP cluster menjadi warehouse hanya karena data asalnya graph.

---

## 23. Write Availability Pattern

### 23.1 Idempotent Write Command

Setiap write command yang bisa kena retry/failover harus punya stable command identity.

Contoh:

```text
AssignCaseCommand
- commandId
- caseId
- assigneeId
- assignmentType
- requestedBy
- requestedAt
```

Cypher:

```cypher
MERGE (cmd:GraphCommand {commandId: $commandId})
ON CREATE SET
  cmd.type = 'ASSIGN_CASE',
  cmd.createdAt = datetime(),
  cmd.status = 'APPLIED'
WITH cmd
MATCH (c:Case {caseId: $caseId})
MATCH (u:User {userId: $assigneeId})
MERGE (c)-[r:ASSIGNED_TO {assignmentType: $assignmentType}]->(u)
ON CREATE SET r.assignedAt = datetime(), r.requestedBy = $requestedBy
SET c.updatedAt = datetime()
RETURN cmd.commandId AS commandId
```

Jika transaction callback diulang, state tetap deterministik.

### 23.2 Avoid Non-Database Side Effects Inside Retried Transaction

Jangan lakukan:

1. kirim email,
2. publish Kafka,
3. call payment API,
4. mutate external system,
5. generate non-deterministic ID,

langsung di dalam callback yang dapat diretry.

Gunakan:

1. outbox pattern,
2. deterministic IDs,
3. idempotency key,
4. post-commit dispatcher,
5. external side effect dedup.

---

## 24. Query Design Dalam Cluster

Cluster tidak mengubah prinsip query tuning, tetapi menambah konteks.

### 24.1 Start From Selective Anchor

Selalu mulai dari anchor yang index-backed:

```cypher
MATCH (c:Case {caseId: $caseId})
MATCH path = (c)-[:INVOLVES|RELATED_TO*1..3]-(x)
RETURN path
LIMIT 100
```

Bukan:

```cypher
MATCH path = (:Case)-[:INVOLVES|RELATED_TO*1..3]-(x)
RETURN path
```

### 24.2 Avoid Reader Meltdown

Reader member juga finite. Query read yang buruk bisa:

1. mengisi heap,
2. membuat page cache churn,
3. menaikkan GC,
4. memperlambat query read lain,
5. membuat driver retry ke member lain,
6. menyebarkan load spike.

### 24.3 Query Tags / Metadata

Untuk production, gunakan query metadata jika tersedia dalam integration pattern Anda, atau set logging context di aplikasi supaya query bisa ditelusuri:

```text
requestId, userId, endpoint, useCase, transactionType, tenantId
```

Saat incident:

```text
"slow query MATCH ..." kurang berguna.
"slow query from endpoint /cases/{id}/network tenant A requestId X" jauh lebih berguna.
```

---

## 25. Runbook: Member Down

### Symptom

```text
Alert: cluster member unavailable
```

### Immediate Questions

1. Member mana?
2. Role database apa di member itu?
3. Apakah write masih tersedia?
4. Apakah read p95/p99 naik?
5. Apakah routing errors muncul di aplikasi?
6. Apakah member lain overload?
7. Apakah disk/network/CPU penyebabnya?

### Actions

1. cek cluster status,
2. cek logs member down,
3. cek infrastructure event,
4. cek disk full / OOM / GC / network,
5. jangan restart semua member,
6. pulihkan member satu per satu,
7. tunggu catch-up,
8. verifikasi database available,
9. verifikasi aplikasi stabil,
10. post-incident: cari root cause dan capacity gap.

### Do Not

```text
- delete volume untuk "mempercepat recovery" tanpa prosedur,
- promote/force topology tanpa memahami quorum,
- menjalankan maintenance bersamaan di member lain,
- menganggap read-only state sebagai bug yang harus dipaksa write.
```

---

## 26. Runbook: Write Unavailable / Database Read-Only

### Symptom

```text
Write transaction fails.
Database appears read-only.
```

### Possible Causes

1. terlalu banyak primary unavailable,
2. leadership tidak tersedia,
3. network partition,
4. disk full,
5. database configured read-only,
6. license/config issue,
7. cluster state degraded,
8. driver routing to wrong member.

### Immediate Questions

1. Apakah semua database read-only atau hanya satu?
2. Apakah read masih berjalan?
3. Berapa primary yang healthy?
4. Apakah ada leadership transfer baru?
5. Apakah ada maintenance sedang berjalan?
6. Apakah disk full di writer?
7. Apakah aplikasi memakai routing URI?
8. Apakah error berasal dari semua service instance atau sebagian?

### Actions

1. hentikan batch write/import non-critical,
2. cek cluster topology,
3. cek disk dan logs,
4. cek network antar member,
5. cek apakah quorum cukup,
6. pulihkan member yang gagal,
7. biarkan cluster re-elect/recover sesuai prosedur,
8. verifikasi write kecil,
9. verifikasi aplikasi retry berhenti spike,
10. review retry storm protection.

---

## 27. Runbook: Stale Read / Read-After-Write Failure

### Symptom

```text
User membuat/update data, lalu langsung tidak terlihat.
```

### Investigation Path

1. Apakah write transaction benar-benar commit?
2. Apakah response write sukses atau client timeout?
3. Apakah read query predicate benar?
4. Apakah read memakai driver/session yang sama atau berbeda?
5. Apakah bookmark/causal dependency terbawa?
6. Apakah read diarahkan ke reader lagging?
7. Apakah ada cache aplikasi?
8. Apakah data berasal dari async projection, bukan direct Neo4j write?
9. Apakah multi-service boundary kehilangan consistency context?

### Fix Options

1. gunakan bookmark manager dengan benar,
2. untuk flow kritis, bawa bookmark/state lintas transaction,
3. route immediate critical read ke writer jika diperlukan,
4. ubah API response agar tidak perlu read ulang,
5. tambahkan projection watermark untuk async graph,
6. tambahkan synthetic read-after-write test.

---

## 28. Runbook: Routing Failure

### Symptom

```text
Intermittent ServiceUnavailable / SessionExpired / routing table error
```

### Possible Causes

1. wrong URI scheme,
2. advertised address salah,
3. DNS/LB issue,
4. firewall antar app dan member,
5. driver version incompatible,
6. driver dibuat per request,
7. connection pool exhausted,
8. cluster topology unstable,
9. TLS mismatch.

### Investigation

1. cek URI app,
2. cek driver version,
3. cek logs routing table,
4. cek apakah semua service instance kena,
5. cek network path ke semua advertised addresses,
6. cek certificate/TLS,
7. cek connection pool metrics,
8. cek cluster leadership changes.

### Fix

1. gunakan routing URI,
2. perbaiki advertised address,
3. driver singleton,
4. upgrade driver,
5. perbaiki LB/DNS,
6. set pool size realistis,
7. tambah retry/backoff.

---

## 29. Architecture Decision Matrix

| Requirement | Cluster membantu? | Catatan |
|---|---:|---|
| Database tetap read saat satu server mati | Ya | Jika topology dan capacity benar |
| Database tetap write saat satu server mati | Ya | Selama quorum/primary cukup |
| Write throughput linear naik | Tidak otomatis | Write tetap perlu koordinasi |
| Read throughput naik | Ya | Jika query read routed benar dan reader cukup |
| Query buruk jadi cepat | Tidak | Tetap butuh modelling/tuning |
| Data salah akibat bug aplikasi | Tidak | Cluster mereplikasi logical error |
| Disaster recovery | Sebagian | Tetap butuh backup/restore plan |
| Read-after-write correctness | Bisa | Butuh bookmark/causal consistency pattern |
| Multi-region low-latency global write | Sulit | Ada trade-off latency/consistency |
| Heavy GDS workload di production OLTP | Tidak ideal | Isolasi workload lebih aman |

---

## 30. Checklist Desain Neo4j Cluster

Sebelum production:

```text
Topology
[ ] Jumlah primary/secondary jelas.
[ ] Database critical sudah dipetakan.
[ ] Read scaling target realistis.
[ ] Failure headroom dihitung.
[ ] Region/network latency dipahami.

Driver/Application
[ ] Menggunakan routing URI.
[ ] Driver singleton per app lifecycle.
[ ] Database name eksplisit.
[ ] executeRead/executeWrite disiplin.
[ ] Transaction callback idempotent.
[ ] Retry transient error tersedia.
[ ] Connection pool dimonitor.
[ ] Timeout dan backpressure tersedia.

Consistency
[ ] Flow read-after-write kritis diidentifikasi.
[ ] Bookmark/causal consistency strategy jelas.
[ ] Async projection punya watermark.
[ ] Authorization reads punya consistency policy.

Operations
[ ] Backup cluster diuji restore.
[ ] Runbook member down tersedia.
[ ] Runbook write unavailable tersedia.
[ ] Runbook routing failure tersedia.
[ ] Rolling restart diuji.
[ ] Upgrade procedure diuji.
[ ] Monitoring cluster + driver + business metrics aktif.

Security
[ ] TLS/credential/secret management benar.
[ ] Member communication aman.
[ ] Backup encrypted dan access controlled.
[ ] Admin operations audited.

Performance
[ ] Query critical sudah PROFILE.
[ ] Read/write mix diketahui.
[ ] Page cache sizing per member masuk akal.
[ ] Supernode risk dipantau.
[ ] Batch/GDS/reporting workload diisolasi.
```

---

## 31. Common Mistakes

### Mistake 1: Semua Query Dijalankan Sebagai Write

Akibat:

1. read scaling tidak jalan,
2. primary overload,
3. cluster terlihat tidak berguna,
4. p99 naik.

Fix:

```text
Pisahkan executeRead dan executeWrite di repository/service boundary.
```

### Mistake 2: Direct Bolt ke Satu Member

Akibat:

1. client-side single point of failure,
2. failover tidak transparan,
3. routing table tidak dipakai,
4. manual endpoint management.

Fix:

```text
Gunakan routing URI dan advertised address benar.
```

### Mistake 3: Retry Non-Idempotent Command

Akibat:

1. duplicate relationship,
2. duplicate audit event,
3. double notification,
4. inconsistent external side effect.

Fix:

```text
Stable IDs, MERGE, constraints, outbox, idempotency key.
```

### Mistake 4: Menganggap Secondary Sebagai Backup

Akibat:

1. logical delete tetap direplikasi,
2. tidak ada restore point,
3. ransomware/bug tidak bisa dipulihkan mudah.

Fix:

```text
Backup + restore drill + isolated recovery environment.
```

### Mistake 5: Menjalankan Heavy GDS di Operational Cluster

Akibat:

1. cache churn,
2. memory pressure,
3. latency OLTP naik,
4. incident pada workload user.

Fix:

```text
Separate analytical projection/environment atau jadwal controlled batch.
```

### Mistake 6: Tidak Menguji Failover

Akibat:

1. driver config baru ketahuan salah saat incident,
2. retry tidak bekerja,
3. leadership transfer membuat outage panjang,
4. runbook tidak akurat.

Fix:

```text
Game day: kill member, kill writer, simulate network issue, validate app behaviour.
```

---

## 32. Mental Model Akhir

Neo4j cluster harus dipahami sebagai mekanisme untuk:

```text
- menjaga database tetap available saat sebagian member gagal,
- mendistribusikan read workload,
- mengkoordinasikan write secara aman,
- memungkinkan client routing read/write secara topology-aware,
- mendukung causal consistency ketika read bergantung pada write sebelumnya.
```

Tetapi cluster bukan:

```text
- pengganti modelling yang benar,
- pengganti query tuning,
- pengganti backup,
- magic write scaler,
- solusi untuk semua workload analytical,
- alasan untuk mengabaikan idempotency,
- alasan untuk tidak punya runbook.
```

Untuk Java engineer, prinsip praktisnya:

```text
Driver lifecycle benar.
Access mode benar.
Transaction retry aman.
Write idempotent.
Read-after-write dependency eksplisit.
Query tetap bounded.
Operational metrics terlihat.
Failure diuji sebelum production incident.
```

Cluster yang baik bukan cluster yang tidak pernah gagal. Cluster yang baik adalah cluster yang gagal dengan cara yang sudah dipahami, teramati, terbatas dampaknya, dan bisa dipulihkan.

---

## 33. Latihan Praktis

### Latihan 1 — Identify Read/Write Boundaries

Ambil service graph Anda dan klasifikasikan method repository:

```text
READ:
- findCaseById
- findRelatedParties
- findOwnershipPath
- listOpenCases

WRITE:
- createCase
- assignCase
- escalateCase
- linkEvidence
- closeCase
```

Untuk tiap method, jawab:

1. apakah memakai executeRead/executeWrite benar?
2. apakah query dimulai dari anchor selective?
3. apakah transaction callback idempotent?
4. apakah read perlu melihat write sebelumnya?

### Latihan 2 — Design Cluster Topology

Untuk case management graph:

```text
- 500 concurrent users
- 70% read, 30% write
- path query bounded 1..3
- daily risk scoring batch
- strict read-after-write for case creation and access control
```

Desain:

1. jumlah primary,
2. jumlah read member,
3. apakah GDS dipisah,
4. backup source,
5. consistency policy,
6. failover test.

### Latihan 3 — Write Runbook

Buat runbook untuk:

```text
- satu member down,
- writer unavailable,
- read-after-write failure,
- routing table error,
- backup restore validation failed.
```

Setiap runbook harus punya:

1. symptom,
2. likely causes,
3. first checks,
4. safe actions,
5. unsafe actions,
6. post-incident follow-up.

### Latihan 4 — Build Synthetic Consistency Test

Buat endpoint/job test:

```text
1. create synthetic node with unique ID
2. immediately read from normal read path
3. assert visible
4. delete/cleanup
5. record latency and failures
```

Tujuan bukan load test, tetapi mendeteksi routing/bookmark/causal consistency issue lebih awal.

---

## 34. Referensi Resmi

- Neo4j Operations Manual — Clustering Introduction: `https://neo4j.com/docs/operations-manual/current/clustering/introduction/`
- Neo4j Operations Manual — Clustering: `https://neo4j.com/docs/operations-manual/current/clustering/`
- Neo4j Operations Manual — Clustering Glossary: `https://neo4j.com/docs/operations-manual/current/clustering/glossary/`
- Neo4j Operations Manual — Leadership, routing, and load balancing: `https://neo4j.com/docs/operations-manual/current/clustering/setup/routing/`
- Neo4j Operations Manual — Scaling with Neo4j: `https://neo4j.com/docs/operations-manual/current/scalability/scaling-with-neo4j/`
- Neo4j Java Driver Manual — Advanced connection information: `https://neo4j.com/docs/java-manual/current/connect-advanced/`
- Neo4j Java Driver Manual — Performance recommendations: `https://neo4j.com/docs/java-manual/current/performance/`
- Neo4j Java Driver Manual — Bookmarks / causal consistency: `https://neo4j.com/docs/java-manual/current/bookmarks/`
- Neo4j Java Driver Manual — Query simple/read-write transaction modes: `https://neo4j.com/docs/java-manual/current/query-simple/`
- Neo4j HTTP API — Bookmarks and causal consistency: `https://neo4j.com/docs/http-api/current/bookmarks/`

---

## 35. Ringkasan

Part ini membahas Neo4j clustering sebagai sistem availability dan routing, bukan magic scale-out.

Hal terpenting:

1. cluster membantu HA dan read scaling,
2. write tetap butuh koordinasi aman,
3. primary dan secondary punya peran berbeda,
4. routing driver wajib dipakai dengan benar,
5. Java service harus disiplin `executeRead` dan `executeWrite`,
6. retry hanya aman jika command idempotent,
7. causal consistency harus dipahami untuk read-after-write,
8. cluster bukan backup,
9. monitoring harus mencakup database, driver, dan business invariant,
10. failure harus diuji dengan runbook sebelum incident nyata.

Part berikutnya akan membahas **Security, Access Control, Multi-Tenancy, and Regulatory Defensibility**: bagaimana mendesain Neo4j untuk sistem yang perlu tenant isolation, audit trail, provenance, retention, path-based access control, dan keputusan yang bisa dipertanggungjawabkan.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Neo4j Operations: Deployment, Configuration, Backup, Monitoring, and Capacity</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-019.md">Part 019 — Security, Access Control, Multi-Tenancy, and Regulatory Defensibility ➡️</a>
</div>
