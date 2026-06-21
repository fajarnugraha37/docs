# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-014.md

# Part 014 — Spring Data Neo4j: Productivity, Boundaries, and Traps

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: memakai Spring Data Neo4j secara produktif tanpa jatuh ke perangkap ORM-style graph modelling

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas integrasi Java dengan Neo4j secara langsung memakai Neo4j Java Driver: driver lifecycle, session, transaction function, parameter binding, result mapping, retry semantics, dan repository design.

Bagian ini membahas **Spring Data Neo4j**, tetapi bukan sebagai tutorial anotasi biasa. Fokus utamanya adalah menjawab pertanyaan arsitektural:

> Kapan Spring Data Neo4j mempercepat delivery, dan kapan justru membuat engineer kehilangan kontrol atas graph query, traversal cost, dan boundary domain?

Spring Data Neo4j, sering disingkat SDN, sangat berguna bila digunakan pada tempat yang benar:

- CRUD sederhana atas node/relationship yang jelas.
- Repository abstraction untuk use case yang tidak traversal-heavy.
- Integrasi natural dengan Spring Boot, transaction management, dependency injection, validation, dan testing.
- Mapping object Java ke property graph untuk domain yang relatif stabil.
- Custom Cypher untuk query yang sudah diketahui bentuknya.

Namun SDN bisa menjadi sumber masalah bila digunakan seperti JPA/Hibernate untuk relational database:

- Menganggap object graph Java sama dengan graph database.
- Mengandalkan automatic persistence untuk subgraph besar.
- Membiarkan repository method menyembunyikan query cost.
- Mengambil graph terlalu luas karena mapping entity terlalu kaya.
- Memakai entity relationship sebagai traversal strategy.
- Menempatkan business traversal penting di balik magic mapping.
- Membuat model Neo4j mengikuti class hierarchy Java, bukan requirement path query.

Setelah bagian ini, kamu diharapkan bisa:

1. Memahami posisi Spring Data Neo4j dalam arsitektur aplikasi Java.
2. Mendesain entity mapping yang tidak merusak model graph.
3. Memutuskan kapan memakai repository derived query, custom Cypher, projection, atau Neo4j Java Driver langsung.
4. Menghindari trap object graph vs database graph.
5. Menguji dan mengobservasi SDN secara production-oriented.
6. Membuat boundary yang sehat antara domain model, persistence model, dan query model.

---

## 1. Apa Itu Spring Data Neo4j?

Spring Data Neo4j adalah bagian dari ekosistem Spring Data yang menyediakan integrasi Spring untuk Neo4j. Ia memberikan fasilitas seperti:

- object mapping,
- Spring Data repositories,
- custom query methods,
- transaction integration,
- conversion,
- reactive support,
- dependency injection,
- Spring Boot auto-configuration.

Secara sederhana:

```text
Java object <-> Spring Data Neo4j mapping layer <-> Neo4j Java Driver <-> Neo4j
```

SDN bukan database engine. SDN juga bukan pengganti Cypher. SDN adalah **persistence abstraction** di atas Neo4j.

Mental model yang sehat:

```text
Neo4j remains graph-native.
Cypher remains the real query language.
SDN is a productivity layer, not a modelling authority.
```

Mental model yang berbahaya:

```text
My Java classes are my graph model.
My repositories are enough for all graph queries.
I can ignore Cypher because SDN will handle traversal.
```

Kalau kamu membawa mental model JPA langsung ke Neo4j, kamu akan membuat sistem yang secara sintaks graph, tetapi secara pikiran masih relational ORM.

---

## 2. Posisi SDN dalam Stack Java + Neo4j

Dalam aplikasi Spring Boot, ada beberapa opsi integrasi Neo4j:

```text
Option A — Neo4j Java Driver langsung
Application Service
  -> Custom Repository
     -> Driver / Session / Transaction
        -> Cypher

Option B — Spring Data Neo4j
Application Service
  -> SDN Repository
     -> Mapping Layer
        -> Neo4j Driver
           -> Cypher

Option C — Hybrid
Application Service
  -> SDN Repository for simple CRUD
  -> Driver-based Repository for critical graph queries
  -> Projection Query Objects for read models
```

Untuk production system yang serius, **Option C sering paling realistis**.

Gunakan SDN untuk:

- create/update node sederhana,
- lookup berdasarkan business key,
- administrative CRUD,
- bounded object mapping,
- simple relationship maintenance,
- query dengan result shape yang stabil.

Gunakan Neo4j Java Driver langsung untuk:

- query traversal kompleks,
- path query kritis,
- performance-sensitive query,
- batch ingestion berat,
- Graph Data Science orchestration,
- query dengan result shape non-entity,
- streaming result besar,
- query yang butuh kontrol transaction/retry/paging lebih eksplisit.

---

## 3. SDN Bukan JPA untuk Graph

Ini bagian paling penting.

Banyak Java engineer familiar dengan JPA/Hibernate. Karena SDN memakai repository, annotation, entity class, dan transaction seperti Spring Data lain, insting pertama biasanya:

```java
@Node
class Person {
    @Id
    private String id;

    @Relationship(type = "KNOWS")
    private Set<Person> friends;
}
```

Lalu muncul asumsi:

```text
Jika saya load Person, saya bisa navigasi person.getFriends().getFriends()...
```

Ini berbahaya.

Graph database memang berisi graph, tetapi **Java object graph bukan database graph**.

Perbedaannya:

| Aspek | Database graph | Java object graph |
|---|---|---|
| Ukuran | Bisa jutaan/miliaran node/relationship | Harus bounded dalam memory process |
| Traversal | Dikontrol oleh query | Bisa terjadi implicit lewat object navigation |
| Cost | Dapat dianalisis dengan PROFILE | Tersembunyi di mapping/loading |
| Identity | Node identity + domain key | Object reference + equals/hashCode |
| Lifecycle | Transactional database state | In-memory mutable object state |
| Boundary | Query-driven | Reference-driven |

Masalahnya bukan SDN-nya. Masalahnya adalah memakai SDN untuk menyamakan dua hal yang berbeda.

Mental model yang benar:

```text
Database graph adalah source of connected facts.
Java object adalah snapshot terbatas untuk satu use case.
Repository method harus mengambil subgraph sekecil mungkin yang dibutuhkan use case.
```

---

## 4. Core Annotation Model

SDN modern biasanya memakai annotation seperti:

- `@Node`
- `@Relationship`
- `@Id`
- `@GeneratedValue`
- `@Property`
- `@RelationshipProperties`
- `@TargetNode`
- `@Version`
- `@Query`

Contoh sederhana:

```java
import org.springframework.data.annotation.Id;
import org.springframework.data.neo4j.core.schema.Node;
import org.springframework.data.neo4j.core.schema.Property;

@Node("Person")
public class PersonNode {

    @Id
    private final String personId;

    @Property("fullName")
    private String fullName;

    private String email;

    protected PersonNode() {
        this.personId = null;
    }

    public PersonNode(String personId, String fullName, String email) {
        this.personId = personId;
        this.fullName = fullName;
        this.email = email;
    }

    public String personId() {
        return personId;
    }

    public String fullName() {
        return fullName;
    }

    public String email() {
        return email;
    }
}
```

Beberapa prinsip penting:

1. Nama class Java tidak harus sama dengan label domain.
2. Label Neo4j harus dipilih berdasarkan model graph, bukan package Java.
3. Field Java tidak harus mencakup semua property node.
4. Persistence class boleh berbeda dari domain class.
5. Entity mapping harus bounded.

---

## 5. ID Strategy: Jangan Salah Pilih Identity

Di Neo4j, kamu punya beberapa jenis identity:

```text
1. Internal Neo4j element id
2. Generated application id
3. Natural/business key
4. External source id
5. Composite identity
```

Untuk production system, terutama sistem integrasi atau enforcement/case management, biasanya kamu perlu **business-stable external ID**, bukan hanya generated internal ID.

Contoh:

```java
@Node("Case")
public class CaseNode {

    @Id
    private final String caseId;

    private String status;
    private String severity;

    protected CaseNode() {
        this.caseId = null;
    }

    public CaseNode(String caseId, String status, String severity) {
        this.caseId = caseId;
        this.status = status;
        this.severity = severity;
    }
}
```

Constraint Neo4j yang sebaiknya mendampingi:

```cypher
CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.caseId IS UNIQUE;
```

SDN mapping tanpa database constraint tidak cukup. Application-level ID annotation membantu object mapping, tetapi integrity harus dijaga oleh Neo4j constraint juga.

Rule:

```text
@Id in Java is mapping identity.
UNIQUE constraint in Neo4j is database correctness.
You usually need both.
```

---

## 6. Relationship Mapping Sederhana

Contoh relationship sederhana:

```java
@Node("Person")
public class PersonNode {

    @Id
    private String personId;

    private String fullName;

    @Relationship(type = "WORKS_FOR", direction = Relationship.Direction.OUTGOING)
    private OrganizationNode employer;
}

@Node("Organization")
public class OrganizationNode {

    @Id
    private String organizationId;

    private String legalName;
}
```

Ini memetakan graph:

```cypher
(:Person {personId})-[:WORKS_FOR]->(:Organization {organizationId})
```

Cocok untuk relationship 1-hop yang jelas dan bounded.

Namun berhati-hati bila field relationship berupa collection besar:

```java
@Relationship(type = "OWNS", direction = Relationship.Direction.OUTGOING)
private Set<AccountNode> accounts;
```

Pertanyaan desain:

1. Berapa jumlah account maksimum yang realistis?
2. Apakah use case ini selalu butuh semua accounts?
3. Apakah accounts perlu paging?
4. Apakah relationship punya metadata seperti `since`, `source`, `confidence`, `validFrom`, `validTo`?
5. Apakah load Person otomatis akan menarik Set besar?
6. Apakah save Person akan memengaruhi relationship set?

Jika jawabannya tidak jelas, relationship collection di entity bisa menjadi trap.

---

## 7. Relationship Properties

Neo4j relationship bisa punya properties. Dalam SDN, relationship dengan property biasanya dimodelkan dengan class khusus.

Contoh graph:

```cypher
(:Person)-[:OWNS {percentage: 35.0, validFrom: date('2022-01-01'), source: 'Registry'}]->(:Organization)
```

Mapping Java:

```java
import org.springframework.data.neo4j.core.schema.RelationshipProperties;
import org.springframework.data.neo4j.core.schema.TargetNode;

@RelationshipProperties
public class OwnershipRelationship {

    private Double percentage;
    private String source;
    private String validFrom;
    private String validTo;

    @TargetNode
    private OrganizationNode organization;

    protected OwnershipRelationship() {
    }

    public OwnershipRelationship(
        Double percentage,
        String source,
        String validFrom,
        String validTo,
        OrganizationNode organization
    ) {
        this.percentage = percentage;
        this.source = source;
        this.validFrom = validFrom;
        this.validTo = validTo;
        this.organization = organization;
    }
}
```

Di node source:

```java
@Node("Person")
public class PersonNode {

    @Id
    private String personId;

    @Relationship(type = "OWNS", direction = Relationship.Direction.OUTGOING)
    private Set<OwnershipRelationship> ownerships = new HashSet<>();
}
```

Kapan relationship properties cocok?

- Relationship merepresentasikan fact yang punya attribute sendiri.
- Attribute tersebut melekat pada hubungan, bukan pada node source/target.
- Query sering bertanya berdasarkan relationship metadata.
- Relationship tetap binary: source ke target.

Kapan relationship properties tidak cukup?

- Hubungan melibatkan lebih dari dua pihak.
- Relationship punya lifecycle kompleks.
- Relationship perlu approval/evidence/review/action sendiri.
- Relationship menjadi aggregate utama.
- Relationship perlu banyak relationship lain.

Dalam kasus itu, reify relationship menjadi node:

```cypher
(:Person)-[:HAS_OWNERSHIP]->(:Ownership)-[:OF_ORGANIZATION]->(:Organization)
(:Ownership)-[:SUPPORTED_BY]->(:Evidence)
(:Ownership)-[:REVIEWED_BY]->(:Officer)
```

---

## 8. Repository Dasar

Contoh repository SDN:

```java
import org.springframework.data.neo4j.repository.Neo4jRepository;

public interface PersonRepository extends Neo4jRepository<PersonNode, String> {

    Optional<PersonNode> findByEmail(String email);

    List<PersonNode> findByFullNameContainingIgnoreCase(String keyword);
}
```

Repository derived query nyaman untuk query sederhana:

- lookup by unique field,
- find by status,
- find by category,
- simple filtering,
- administrative screens.

Namun derived query tidak cocok untuk:

- traversal multi-hop,
- path discovery,
- graph algorithm,
- complex authorization,
- performance-critical query,
- query dengan bounded expansion khusus,
- query yang butuh `PROFILE` dan tuning manual.

Rule:

```text
Use derived repository methods for attribute lookup.
Use Cypher for graph questions.
Use Driver for graph questions that are critical, streaming-heavy, or operationally sensitive.
```

---

## 9. Custom Cypher dengan `@Query`

SDN memungkinkan custom Cypher di repository.

Contoh:

```java
public interface CaseRepository extends Neo4jRepository<CaseNode, String> {

    @Query("""
        MATCH (c:Case {caseId: $caseId})-[:SUBJECT_OF]->(s:Subject)
        RETURN c, collect(s) AS subjects
        """)
    Optional<CaseNode> findCaseWithSubjects(String caseId);
}
```

Namun custom query yang return entity graph perlu hati-hati. Mapping entity membutuhkan shape hasil tertentu agar SDN dapat mengisi relationship dengan benar.

Untuk query read-only yang kompleks, sering lebih aman memakai projection DTO:

```java
public record RelatedCaseSummary(
    String caseId,
    String status,
    String severity,
    long sharedSubjectCount
) {}
```

Repository:

```java
public interface CaseQueryRepository extends Neo4jRepository<CaseNode, String> {

    @Query("""
        MATCH (c:Case {caseId: $caseId})-[:HAS_SUBJECT]->(s:Subject)<-[:HAS_SUBJECT]-(other:Case)
        WHERE other.caseId <> $caseId
        RETURN other.caseId AS caseId,
               other.status AS status,
               other.severity AS severity,
               count(DISTINCT s) AS sharedSubjectCount
        ORDER BY sharedSubjectCount DESC
        LIMIT $limit
        """)
    List<RelatedCaseSummary> findRelatedCases(String caseId, long limit);
}
```

Kelebihan projection:

- Result shape eksplisit.
- Tidak memuat graph besar.
- Tidak bergantung pada entity relationship mapping.
- Cocok untuk API response/read model.
- Lebih mudah di-test.
- Lebih mudah di-tune.

---

## 10. Entity vs Projection vs Domain Object

Dalam aplikasi serius, jangan selalu samakan tiga hal ini:

```text
Persistence entity: bentuk data untuk mapping database.
Domain object: bentuk perilaku/invariant bisnis.
Projection/read model: bentuk data untuk use case baca/API.
```

Contoh buruk:

```java
@Node("Case")
public class Case {
    @Id String caseId;
    Set<Subject> subjects;
    Set<Evidence> evidence;
    Set<Decision> decisions;
    Set<Action> actions;
    Set<Officer> officers;
    Set<Regulation> regulations;

    public void escalate() { ... }
    public void close() { ... }
    public void computeRisk() { ... }
}
```

Class ini mencoba menjadi:

- persistence entity,
- aggregate root,
- read model,
- workflow state machine,
- graph traversal root,
- risk scoring object.

Akhirnya class menjadi terlalu besar dan loading-nya tidak terkendali.

Alternatif lebih sehat:

```text
CaseNode                 -> persistence mapping minimal
CaseLifecycleAggregate   -> domain invariant/status transition
CaseSummaryView          -> read projection for list page
CaseNetworkView          -> graph-oriented projection for investigation
CaseRiskFeatures         -> analytics feature projection
CaseRepository           -> simple persistence
CaseGraphQueryRepository -> custom Cypher / driver queries
```

Mental model:

```text
Use different shapes for different jobs.
Do not force one Java class to represent the entire graph reality.
```

---

## 11. Object Graph Trap

Bayangkan model:

```java
@Node("Person")
class PersonNode {
    @Id String personId;

    @Relationship(type = "OWNS")
    Set<AccountNode> accounts;

    @Relationship(type = "KNOWS")
    Set<PersonNode> knownPeople;

    @Relationship(type = "SUBJECT_OF")
    Set<CaseNode> cases;
}
```

Sekilas wajar. Tetapi pertanyaan penting:

1. Saat load `PersonNode`, relationship mana yang ikut dimuat?
2. Saat save `PersonNode`, relationship mana yang dianggap authoritative?
3. Apakah `knownPeople` bisa ribuan?
4. Apakah `accounts` harus dipaging?
5. Apakah `cases` perlu filter status?
6. Apakah object equality akan membuat collection behavior aneh?
7. Apakah JSON serialization akan recursive?
8. Apakah API response tidak sengaja expose network besar?

Graph database bisa menampung koneksi besar. Java object tidak boleh sembarang memuat koneksi besar.

Rule:

```text
A graph relationship in the database does not imply a Java field in the entity.
Only map relationships that are bounded, commonly needed, and semantically owned by that use case.
```

---

## 12. Relationship Ownership Trap

Dalam object model Java, field relationship sering terasa seperti ownership:

```java
class OrganizationNode {
    Set<PersonNode> employees;
}
```

Tetapi dalam graph, relationship bukan selalu ownership. Relationship bisa berarti:

- association,
- membership,
- observation,
- evidence,
- historical fact,
- derived fact,
- temporary entitlement,
- similarity,
- risk link,
- workflow transition,
- audit relation.

Jika relationship dianggap milik object source, maka save operation bisa berbahaya:

```text
I loaded Organization with 20 employees.
Actually there are 2,000 employees.
I modify one field and save organization.
What does the mapping layer believe about missing relationships?
```

Ini sebabnya persistence boundary harus eksplisit.

Untuk relationship besar atau tidak-owned, lebih baik gunakan command-specific Cypher:

```cypher
MATCH (p:Person {personId: $personId})
MATCH (o:Organization {organizationId: $organizationId})
MERGE (p)-[r:WORKS_FOR]->(o)
SET r.validFrom = date($validFrom),
    r.source = $source
```

Daripada memanipulasi collection Java besar.

---

## 13. Save Semantics: Jangan Menganggap `save()` Itu Netral

`repository.save(entity)` terlihat sederhana, tetapi untuk graph entity ia dapat menyentuh node dan relationship yang ada dalam object graph.

Masalah yang harus dipikirkan:

1. Object graph yang sedang di-save sebesar apa?
2. Relationship mana yang dianggap bagian dari persistence state?
3. Apakah collection kosong berarti “tidak dimuat” atau “hapus semua relationship”?
4. Apakah object hasil deserialization dari API request aman untuk langsung di-save?
5. Apakah partial update bisa menghapus relationship karena field null/kosong?
6. Apakah optimistic locking dipakai?
7. Apakah constraint melindungi duplicate?
8. Apakah update idempotent?

Pattern aman:

```text
Do not save arbitrary API request object as graph entity.
Do not use rich graph entity as command DTO.
Do not use save() for relationship-heavy mutation unless the boundary is very clear.
```

Lebih baik:

```text
API Request DTO
  -> Command object
     -> Application service validates intent
        -> Repository executes explicit Cypher mutation
```

Contoh command:

```java
public record LinkSubjectToCaseCommand(
    String caseId,
    String subjectId,
    String relationType,
    String source,
    Instant observedAt
) {}
```

Repository mutation:

```java
public interface CaseMutationRepository extends Neo4jRepository<CaseNode, String> {

    @Query("""
        MATCH (c:Case {caseId: $caseId})
        MATCH (s:Subject {subjectId: $subjectId})
        MERGE (c)-[r:HAS_SUBJECT]->(s)
        ON CREATE SET r.createdAt = datetime($observedAt)
        SET r.relationType = $relationType,
            r.source = $source,
            r.updatedAt = datetime()
        """)
    void linkSubject(
        String caseId,
        String subjectId,
        String relationType,
        String source,
        String observedAt
    );
}
```

Ini jauh lebih eksplisit daripada mengubah `case.getSubjects().add(subject)` lalu `save(case)`.

---

## 14. Transaction Boundary

SDN terintegrasi dengan Spring transaction management.

Contoh:

```java
@Service
public class CaseApplicationService {

    private final CaseRepository caseRepository;
    private final CaseMutationRepository mutationRepository;

    public CaseApplicationService(
        CaseRepository caseRepository,
        CaseMutationRepository mutationRepository
    ) {
        this.caseRepository = caseRepository;
        this.mutationRepository = mutationRepository;
    }

    @Transactional
    public void assignSubject(String caseId, String subjectId, String source) {
        CaseNode caseNode = caseRepository.findById(caseId)
            .orElseThrow(() -> new IllegalArgumentException("Case not found: " + caseId));

        if ("CLOSED".equals(caseNode.status())) {
            throw new IllegalStateException("Cannot modify closed case");
        }

        mutationRepository.linkSubject(
            caseId,
            subjectId,
            "PRIMARY_SUBJECT",
            source,
            Instant.now().toString()
        );
    }
}
```

Transaction boundary sebaiknya berada di application service, bukan sembarang di repository.

```text
Controller should not own graph transaction semantics.
Repository should not own business workflow semantics.
Application service should coordinate invariant + persistence.
```

---

## 15. Optimistic Locking

Untuk entity yang sering di-update secara concurrent, gunakan optimistic locking bila cocok.

```java
import org.springframework.data.annotation.Version;

@Node("Case")
public class CaseNode {

    @Id
    private String caseId;

    private String status;

    @Version
    private Long version;
}
```

Optimistic locking berguna untuk:

- status update,
- lifecycle transition,
- human workflow,
- approval state,
- case assignment,
- record yang diubah oleh banyak user.

Namun optimistic locking tidak menyelesaikan semua graph concurrency problem. Ia tidak otomatis mencegah:

- duplicate relationship tanpa constraint/merge strategy,
- race pada node berbeda,
- semantic conflict di path berbeda,
- deadlock karena banyak relationship writes,
- stale analytical score.

Gunakan bersama:

- unique constraint,
- explicit mutation query,
- retry logic,
- command idempotency,
- domain invariant check.

---

## 16. Derived Query Method: Gunakan Secara Terbatas

Spring Data repository biasanya mendukung method naming pattern seperti:

```java
List<CaseNode> findByStatus(String status);
List<CaseNode> findBySeverityAndStatus(String severity, String status);
Optional<PersonNode> findByEmail(String email);
```

Ini nyaman untuk attribute lookup.

Tetapi hindari membuat derived query seolah-olah menggantikan graph query:

```java
// Secara desain, ini mulai mencurigakan
List<PersonNode> findByAccountsTransactionsCounterpartyAddressCity(String city);
```

Jika pertanyaan sebenarnya adalah graph traversal, tulis Cypher.

```cypher
MATCH (p:Person)-[:OWNS]->(:Account)-[:SENT|RECEIVED]-(:Transaction)-[:WITH_COUNTERPARTY]->(:Counterparty)-[:HAS_ADDRESS]->(:Address {city: $city})
RETURN DISTINCT p
```

Graph question harus tampak sebagai graph pattern, bukan disembunyikan dalam nama method panjang.

---

## 17. Projection untuk Read Model

Projection adalah salah satu alat paling penting untuk memakai SDN dengan sehat.

Bayangkan UI butuh daftar case:

```text
caseId | status | severity | subjectCount | latestDecisionDate
```

Jangan load seluruh `CaseNode` dengan semua relationship. Buat projection:

```java
public record CaseListItem(
    String caseId,
    String status,
    String severity,
    long subjectCount,
    String latestDecisionDate
) {}
```

Query:

```java
public interface CaseReadRepository extends Neo4jRepository<CaseNode, String> {

    @Query("""
        MATCH (c:Case)
        WHERE c.status = $status
        OPTIONAL MATCH (c)-[:HAS_SUBJECT]->(s:Subject)
        OPTIONAL MATCH (c)-[:HAS_DECISION]->(d:Decision)
        RETURN c.caseId AS caseId,
               c.status AS status,
               c.severity AS severity,
               count(DISTINCT s) AS subjectCount,
               max(toString(d.decidedAt)) AS latestDecisionDate
        ORDER BY latestDecisionDate DESC
        SKIP $skip
        LIMIT $limit
        """)
    List<CaseListItem> listCases(String status, long skip, long limit);
}
```

Keuntungan:

- Tidak terjadi accidental graph loading.
- UI mendapat shape yang diperlukan.
- Query mudah di-profile.
- Pagination jelas.
- Tidak ada recursive serialization.
- Tidak perlu expose entity internal.

---

## 18. DTO Boundary: Jangan Return Entity Langsung dari API

Anti-pattern:

```java
@GetMapping("/cases/{caseId}")
public CaseNode getCase(@PathVariable String caseId) {
    return caseRepository.findById(caseId).orElseThrow();
}
```

Masalah:

- Entity persistence bocor ke API contract.
- Relationship field bisa terserialisasi tidak sengaja.
- Sensitive relationship bisa expose.
- Circular reference bisa terjadi.
- API berubah ketika mapping berubah.
- Lazy/eager behavior bisa memengaruhi response.
- Security trimming sulit.

Pattern lebih sehat:

```java
@GetMapping("/cases/{caseId}")
public CaseDetailResponse getCase(@PathVariable String caseId) {
    return caseQueryService.getCaseDetail(caseId);
}
```

Dengan response eksplisit:

```java
public record CaseDetailResponse(
    String caseId,
    String status,
    String severity,
    List<SubjectSummary> subjects,
    List<EvidenceSummary> evidence,
    List<DecisionSummary> decisions
) {}
```

Entity adalah persistence concern. API response adalah contract concern.

---

## 19. SDN dan Cypher Tuning

Walaupun memakai SDN, kamu tetap harus tahu Cypher dan query plan.

Untuk custom `@Query`, query tetap harus diuji dengan:

```cypher
EXPLAIN ...
PROFILE ...
```

Checklist:

1. Apakah starting point memakai index seek?
2. Apakah traversal bounded?
3. Apakah ada accidental cartesian product?
4. Apakah `OPTIONAL MATCH` menyebabkan row multiplication?
5. Apakah aggregation dilakukan terlalu lambat?
6. Apakah `DISTINCT` dipakai untuk menutupi model/query buruk?
7. Apakah `ORDER BY` dilakukan pada result besar?
8. Apakah pagination dilakukan setelah expansion besar?
9. Apakah projection mengambil terlalu banyak data?
10. Apakah relationship type spesifik?

Jangan biarkan repository abstraction membuat query tidak terlihat.

Rule:

```text
Every important repository query deserves a PROFILE before production.
```

---

## 20. Reactive SDN: Kapan Berguna?

Spring Data Neo4j memiliki dukungan reactive. Ini bisa berguna bila:

- aplikasi sudah reactive end-to-end,
- result streaming besar tapi terkendali,
- service menggunakan WebFlux,
- workload I/O-bound,
- kamu butuh backpressure-aware processing.

Namun reactive bukan solusi otomatis untuk query graph mahal.

Reactive tidak memperbaiki:

- traversal explosion,
- missing index,
- bad cardinality,
- supernode,
- query plan buruk,
- result shape terlalu besar.

Mental model:

```text
Reactive changes how results flow through the application.
It does not make an expensive graph query cheap.
```

Jika query menghasilkan 10 juta path, reactive hanya membuat kerusakan itu mengalir lebih “modern”. Query tetap salah.

---

## 21. Spring Data Neo4j vs Neo4j Java Driver

Perbandingan praktis:

| Kebutuhan | SDN | Java Driver |
|---|---:|---:|
| CRUD sederhana | Sangat cocok | Bisa, tapi verbose |
| Spring repository abstraction | Sangat cocok | Manual |
| Object mapping | Built-in | Manual |
| Custom Cypher sederhana | Cocok | Cocok |
| Query traversal kompleks | Bisa, tapi hati-hati | Lebih cocok |
| Query performance critical | Kadang cocok | Lebih cocok |
| Streaming besar | Terbatas oleh mapping | Lebih terkontrol |
| Batch ingestion | Kurang ideal | Lebih cocok |
| Explicit transaction retry | Abstraction lebih tinggi | Lebih eksplisit |
| GDS orchestration | Bisa via query | Lebih fleksibel |
| Non-entity result shape | Projection bisa | Sangat fleksibel |
| Fine-grained mapping control | Terbatas | Penuh |

Rekomendasi arsitektur:

```text
Use SDN for simple persistence.
Use @Query projections for read models.
Use Driver repositories for critical graph workloads.
Do not force one abstraction to solve all access patterns.
```

---

## 22. Clean Architecture Boundary untuk Neo4j + SDN

Contoh struktur package:

```text
com.example.casegraph
  application
    CaseCommandService.java
    CaseQueryService.java
  domain
    CaseLifecycle.java
    CaseStatus.java
    CaseInvariant.java
  infrastructure
    neo4j
      node
        CaseNode.java
        SubjectNode.java
        EvidenceNode.java
      repository
        CaseRepository.java
        CaseReadRepository.java
        CaseMutationRepository.java
        CaseGraphDriverRepository.java
      mapper
        CaseNodeMapper.java
  api
    CaseController.java
    request
      LinkSubjectRequest.java
    response
      CaseDetailResponse.java
```

Prinsip:

```text
Domain should not depend on SDN annotations.
API should not expose SDN entities.
Application service should coordinate use cases.
Infrastructure should own Cypher and mapping details.
```

Kadang untuk aplikasi kecil, domain class diberi annotation `@Node` bisa diterima. Tetapi untuk sistem kompleks, terutama yang audit-heavy dan long-lived, pisahkan domain model dari persistence model.

---

## 23. Modelling Example: Case Management dengan SDN yang Sehat

Graph target:

```cypher
(:Case {caseId, status, severity})
(:Subject {subjectId, type, displayName})
(:Evidence {evidenceId, source, capturedAt})
(:Decision {decisionId, outcome, decidedAt})

(:Case)-[:HAS_SUBJECT {role, source, createdAt}]->(:Subject)
(:Case)-[:SUPPORTED_BY]->(:Evidence)
(:Case)-[:HAS_DECISION]->(:Decision)
(:Decision)-[:BASED_ON]->(:Evidence)
```

Persistence node minimal:

```java
@Node("Case")
public class CaseNode {

    @Id
    private String caseId;

    private String status;
    private String severity;

    @Version
    private Long version;

    protected CaseNode() {}

    public CaseNode(String caseId, String status, String severity) {
        this.caseId = caseId;
        this.status = status;
        this.severity = severity;
    }

    public String caseId() { return caseId; }
    public String status() { return status; }
    public String severity() { return severity; }
}
```

Perhatikan: `CaseNode` tidak otomatis memiliki semua subjects/evidence/decisions. Itu disengaja.

Repository sederhana:

```java
public interface CaseRepository extends Neo4jRepository<CaseNode, String> {
    List<CaseNode> findByStatus(String status);
}
```

Read projection:

```java
public record CaseNetworkSummary(
    String caseId,
    long subjectCount,
    long evidenceCount,
    long decisionCount
) {}
```

Query:

```java
public interface CaseNetworkReadRepository extends Neo4jRepository<CaseNode, String> {

    @Query("""
        MATCH (c:Case {caseId: $caseId})
        OPTIONAL MATCH (c)-[:HAS_SUBJECT]->(s:Subject)
        WITH c, count(DISTINCT s) AS subjectCount
        OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(e:Evidence)
        WITH c, subjectCount, count(DISTINCT e) AS evidenceCount
        OPTIONAL MATCH (c)-[:HAS_DECISION]->(d:Decision)
        RETURN c.caseId AS caseId,
               subjectCount AS subjectCount,
               evidenceCount AS evidenceCount,
               count(DISTINCT d) AS decisionCount
        """)
    Optional<CaseNetworkSummary> summarizeNetwork(String caseId);
}
```

Mutation query:

```java
public interface CaseMutationRepository extends Neo4jRepository<CaseNode, String> {

    @Query("""
        MATCH (c:Case {caseId: $caseId})
        MATCH (s:Subject {subjectId: $subjectId})
        MERGE (c)-[r:HAS_SUBJECT]->(s)
        ON CREATE SET r.createdAt = datetime($createdAt)
        SET r.role = $role,
            r.source = $source,
            r.updatedAt = datetime()
        """)
    void attachSubject(
        String caseId,
        String subjectId,
        String role,
        String source,
        String createdAt
    );
}
```

Application service:

```java
@Service
public class CaseCommandService {

    private final CaseRepository caseRepository;
    private final CaseMutationRepository mutationRepository;

    public CaseCommandService(
        CaseRepository caseRepository,
        CaseMutationRepository mutationRepository
    ) {
        this.caseRepository = caseRepository;
        this.mutationRepository = mutationRepository;
    }

    @Transactional
    public void attachSubject(String caseId, String subjectId, String role, String source) {
        CaseNode caseNode = caseRepository.findById(caseId)
            .orElseThrow(() -> new IllegalArgumentException("Case not found"));

        if ("CLOSED".equals(caseNode.status())) {
            throw new IllegalStateException("Closed case cannot be modified");
        }

        mutationRepository.attachSubject(
            caseId,
            subjectId,
            role,
            source,
            Instant.now().toString()
        );
    }
}
```

Ini mencerminkan prinsip:

```text
Entity mapping remains small.
Business invariant lives in application/domain layer.
Graph mutation is explicit.
Read model uses projection.
Traversal query is visible as Cypher.
```

---

## 24. Testing dengan SDN

Testing SDN harus meliputi beberapa level.

### 24.1 Unit Test Domain Logic

Tidak perlu Neo4j.

```java
class CaseLifecycleTest {

    @Test
    void closedCaseCannotBeModified() {
        CaseLifecycle lifecycle = new CaseLifecycle("CLOSED");

        assertThrows(IllegalStateException.class, lifecycle::assertCanModify);
    }
}
```

### 24.2 Repository Integration Test

Gunakan Neo4j test database, umumnya dengan Testcontainers.

Tujuan:

- validasi mapping,
- validasi custom Cypher,
- validasi constraint,
- validasi projection,
- validasi transaction behavior,
- validasi query tidak over-fetch.

Contoh skeleton:

```java
@SpringBootTest
@Testcontainers
class CaseRepositoryIT {

    @Container
    static Neo4jContainer<?> neo4j = new Neo4jContainer<>("neo4j:5")
        .withAdminPassword("password");

    @DynamicPropertySource
    static void neo4jProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.neo4j.uri", neo4j::getBoltUrl);
        registry.add("spring.neo4j.authentication.username", () -> "neo4j");
        registry.add("spring.neo4j.authentication.password", () -> "password");
    }

    @Autowired
    CaseRepository caseRepository;

    @Autowired
    CaseMutationRepository mutationRepository;

    @Test
    void attachesSubjectIdempotently() {
        // arrange seed nodes
        // act call mutation twice
        // assert only one HAS_SUBJECT relationship exists
    }
}
```

### 24.3 Query Contract Test

Untuk tiap query penting:

- seed minimal graph,
- run repository method,
- assert exact result,
- assert no unrelated data leaks,
- assert duplicate handling,
- assert empty case,
- assert supernode-like case in smaller form.

### 24.4 Performance Regression Test

Untuk query kritis:

- seed dataset realistis,
- run query dengan representative cardinality,
- track latency,
- track result count,
- optionally capture plan manually via `PROFILE`,
- protect against accidental unbounded traversal.

---

## 25. Migration dan Schema Management

SDN tidak menggantikan schema migration.

Kamu tetap butuh mekanisme untuk:

- create constraints,
- create indexes,
- migrate labels,
- rename relationship types,
- backfill properties,
- split/reify relationships,
- populate derived edges,
- validate data quality.

Contoh migration script:

```cypher
CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.personId IS UNIQUE;

CREATE CONSTRAINT case_id_unique IF NOT EXISTS
FOR (c:Case)
REQUIRE c.caseId IS UNIQUE;

CREATE INDEX case_status_idx IF NOT EXISTS
FOR (c:Case)
ON (c.status);
```

Dalam Spring Boot, bisa memakai:

- migration tool custom,
- Neo4j-Migrations,
- Liquibase extension bila sesuai,
- startup runner yang carefully idempotent,
- deployment pipeline script.

Prinsip:

```text
Entity annotations describe mapping.
Database constraints describe correctness.
Migration scripts describe evolution.
Do not confuse the three.
```

---

## 26. Observability untuk SDN

Yang perlu dimonitor:

1. Query latency per repository method.
2. Slow queries di Neo4j logs.
3. Driver connection pool usage.
4. Transaction retry count.
5. Transient error count.
6. Deadlock count.
7. Query result size.
8. HTTP endpoint latency correlated with graph query.
9. Memory pressure di aplikasi karena mapping result besar.
10. Page cache / DB hits di Neo4j.

Di aplikasi, jangan hanya melihat endpoint latency. Tambahkan span/log untuk query penting.

Contoh pattern logging:

```java
long start = System.nanoTime();
try {
    return repository.findRelatedCases(caseId, limit);
} finally {
    long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
    log.info("neo4j.query=findRelatedCases caseId={} limit={} durationMs={}", caseId, limit, durationMs);
}
```

Untuk sistem besar, gunakan tracing:

```text
HTTP request
  -> application service span
     -> repository span
        -> Neo4j query span
```

Tujuannya bukan micro-optimizing. Tujuannya agar saat query graph melambat, kamu bisa melihat query mana dan pattern apa yang menyebabkan masalah.

---

## 27. Common Production Traps

### Trap 1 — Entity terlalu kaya

Gejala:

- load sederhana lambat,
- JSON response besar,
- memory naik,
- query tidak jelas.

Solusi:

- kecilkan entity,
- gunakan projection,
- pisahkan read model.

### Trap 2 — Save object graph besar

Gejala:

- update sederhana menyentuh banyak relationship,
- deadlock meningkat,
- unexpected relationship deletion/update,
- latency tidak stabil.

Solusi:

- explicit mutation query,
- command-specific repository,
- boundary object kecil.

### Trap 3 — Repository method menyembunyikan traversal

Gejala:

- method name panjang,
- query sulit di-profile,
- developer tidak tahu graph pattern.

Solusi:

- tulis custom Cypher,
- dokumentasikan query intent,
- profile query.

### Trap 4 — Return entity dari controller

Gejala:

- sensitive data leak,
- recursive serialization,
- API contract rapuh.

Solusi:

- gunakan response DTO,
- security trimming eksplisit,
- projection.

### Trap 5 — Domain model tercemar persistence annotation

Gejala:

- domain sulit di-test,
- refactor graph merusak business code,
- entity berubah karena API berubah.

Solusi:

- pisahkan domain dan persistence untuk sistem kompleks,
- gunakan mapper.

### Trap 6 — Tidak ada constraint database

Gejala:

- duplicate node,
- duplicate relationship,
- inconsistent identity,
- `MERGE` lambat.

Solusi:

- buat unique constraint,
- buat index yang sesuai,
- validate migration.

### Trap 7 — Reactive dianggap solusi performance

Gejala:

- endpoint reactive tetap lambat,
- query Neo4j tetap mahal,
- memory pressure pindah bentuk.

Solusi:

- tune Cypher,
- batasi traversal,
- perbaiki graph model,
- gunakan streaming hanya setelah query benar.

---

## 28. Decision Matrix: Kapan Pakai Apa?

| Use case | Rekomendasi |
|---|---|
| CRUD node sederhana | SDN repository |
| Lookup by unique business key | SDN repository + constraint |
| API list page | SDN custom `@Query` + projection |
| Relationship mutation kecil dan eksplisit | SDN custom `@Query` |
| Complex multi-hop traversal | Custom Cypher, sering lebih baik via Driver repository |
| Path result | Driver repository / custom projection |
| Heavy batch ingest | Java Driver langsung |
| Large streaming read | Java Driver langsung |
| Graph algorithm orchestration | Java Driver langsung atau dedicated service |
| Domain workflow update | Application service + explicit repository mutation |
| Admin internal screen | SDN repository bisa cukup |
| Public API response | DTO/projection, jangan entity |

---

## 29. Practical Code Template: Hybrid Repository Pattern

### 29.1 SDN Entity

```java
@Node("Subject")
public class SubjectNode {

    @Id
    private String subjectId;

    private String type;
    private String displayName;

    protected SubjectNode() {}

    public SubjectNode(String subjectId, String type, String displayName) {
        this.subjectId = subjectId;
        this.type = type;
        this.displayName = displayName;
    }
}
```

### 29.2 Simple Repository

```java
public interface SubjectRepository extends Neo4jRepository<SubjectNode, String> {
    List<SubjectNode> findByType(String type);
}
```

### 29.3 Projection Repository

```java
public record SubjectCaseCount(
    String subjectId,
    String displayName,
    long caseCount
) {}

public interface SubjectReadRepository extends Neo4jRepository<SubjectNode, String> {

    @Query("""
        MATCH (s:Subject)<-[:HAS_SUBJECT]-(c:Case)
        WHERE s.type = $type
        RETURN s.subjectId AS subjectId,
               s.displayName AS displayName,
               count(DISTINCT c) AS caseCount
        ORDER BY caseCount DESC
        LIMIT $limit
        """)
    List<SubjectCaseCount> topSubjectsByCaseCount(String type, long limit);
}
```

### 29.4 Driver Repository untuk Traversal Kritis

```java
@Repository
public class SubjectNetworkDriverRepository {

    private final Driver driver;

    public SubjectNetworkDriverRepository(Driver driver) {
        this.driver = driver;
    }

    public List<String> findConnectedSubjectIds(String subjectId, int maxDepth, int limit) {
        String cypher = """
            MATCH (s:Subject {subjectId: $subjectId})
            MATCH path = (s)-[:ASSOCIATED_WITH|SHARES_ACCOUNT|SHARES_ADDRESS*1..%d]-(other:Subject)
            WHERE other.subjectId <> $subjectId
            RETURN DISTINCT other.subjectId AS subjectId
            LIMIT $limit
            """.formatted(maxDepth);

        try (Session session = driver.session()) {
            return session.executeRead(tx -> tx.run(cypher, Map.of(
                    "subjectId", subjectId,
                    "limit", limit
                ))
                .list(record -> record.get("subjectId").asString())
            );
        }
    }
}
```

Catatan: contoh di atas memakai depth dalam string karena Cypher relationship length tidak selalu bisa diparameterisasi seperti value biasa pada semua bentuk query. Dalam production, validasi `maxDepth` harus ketat:

```java
if (maxDepth < 1 || maxDepth > 4) {
    throw new IllegalArgumentException("maxDepth must be between 1 and 4");
}
```

---

## 30. Review Checklist sebelum Memakai SDN di Production

### Mapping

- Apakah setiap `@Node` punya business identity yang jelas?
- Apakah constraint Neo4j mendukung identity tersebut?
- Apakah relationship field bounded?
- Apakah relationship besar tidak dimapping sembarangan?
- Apakah relationship properties dimodelkan dengan benar?
- Apakah entity tidak menjadi mega-object?

### Query

- Apakah graph query penting ditulis sebagai Cypher eksplisit?
- Apakah query sudah di-`PROFILE`?
- Apakah starting point indexed?
- Apakah traversal bounded?
- Apakah projection dipakai untuk read model?
- Apakah pagination dilakukan sebelum result terlalu besar?

### Transaction

- Apakah transaction boundary ada di application service?
- Apakah mutation idempotent?
- Apakah concurrent update dipikirkan?
- Apakah optimistic locking diperlukan?
- Apakah transient error/retry strategy jelas?

### API

- Apakah controller tidak return entity langsung?
- Apakah response DTO eksplisit?
- Apakah sensitive relationship tidak bocor?
- Apakah serialization tidak recursive?

### Operations

- Apakah slow query logging aktif?
- Apakah repository query latency dimonitor?
- Apakah index/constraint migration repeatable?
- Apakah integration test memakai Neo4j nyata/Testcontainers?
- Apakah dataset test mencakup high-degree node?

---

## 31. Mental Model Final

Spring Data Neo4j adalah alat yang bagus, tetapi ia harus diletakkan pada posisi yang benar.

Ringkasnya:

```text
SDN is good at mapping bounded object shapes.
Neo4j is good at answering connected-data questions.
Cypher is the language of those questions.
The Java domain model is not the database graph.
The API response is not the persistence entity.
The repository abstraction must not hide important traversal cost.
```

Kalau kamu memakai SDN untuk CRUD sederhana, projection, dan mutation eksplisit, ia akan meningkatkan produktivitas.

Kalau kamu memakai SDN sebagai ORM untuk seluruh graph, ia bisa membuat graph database terasa lambat, tidak terduga, dan sulit di-debug.

Top 1% engineer tidak hanya tahu annotation. Mereka tahu kapan annotation cukup, kapan harus turun ke Cypher, kapan harus memakai driver langsung, dan kapan harus menolak modelling yang membuat graph terlihat elegan tapi runtime-nya berbahaya.

---

## 32. Ringkasan Bagian 014

Kita sudah membahas:

1. Apa posisi Spring Data Neo4j dalam stack Java + Neo4j.
2. Mengapa SDN bukan JPA untuk graph.
3. Perbedaan database graph dan Java object graph.
4. Annotation utama: `@Node`, `@Relationship`, `@RelationshipProperties`, `@TargetNode`, `@Id`, `@Version`, `@Query`.
5. ID strategy dan pentingnya Neo4j constraint.
6. Relationship mapping sederhana dan relationship properties.
7. Repository dasar dan batas derived query.
8. Custom Cypher dan projection.
9. Pemisahan entity, domain object, dan read model.
10. Object graph trap dan relationship ownership trap.
11. Save semantics dan risiko partial object graph.
12. Transaction boundary yang sehat.
13. Optimistic locking.
14. Reactive SDN dan batasnya.
15. Perbandingan SDN vs Neo4j Java Driver.
16. Clean architecture boundary.
17. Testing, migration, observability, dan production traps.
18. Hybrid repository pattern.
19. Production readiness checklist.

Bagian berikutnya akan membahas **Data Import, ETL, CDC, and Graph Projection Pipelines**: bagaimana mengisi dan menjaga graph tetap sinkron dari relational database, event stream, batch import, CSV, CDC, dan pipeline idempotent tanpa membuat graph menjadi tempat sampah data.

---

## Referensi

- Neo4j Documentation — Spring Data Neo4j Getting Started: https://neo4j.com/docs/getting-started/languages-guides/java/spring-data-neo4j/
- Spring Data Neo4j Reference Documentation: https://docs.spring.io/spring-data/neo4j/docs/current-SNAPSHOT/reference/html/
- Neo4j Java Driver Manual: https://neo4j.com/docs/java-manual/current/
- Neo4j Cypher Manual: https://neo4j.com/docs/cypher-manual/current/
- Neo4j Constraints: https://neo4j.com/docs/cypher-manual/current/schema/constraints/
- Neo4j Indexes: https://neo4j.com/docs/cypher-manual/current/indexes/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Java Application Integration with Neo4j</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-015.md">Part 015 — Data Import, ETL, CDC, and Graph Projection Pipelines ➡️</a>
</div>
