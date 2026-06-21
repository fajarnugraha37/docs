# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-016.md

# Part 016 — Java Integration Mastery

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: bagaimana mengintegrasikan Java backend dengan Elasticsearch secara production-grade, typed, observable, resilient, testable, dan evolvable.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 015, kita sudah membangun mental model berikut:

1. Elasticsearch adalah **retrieval engine**, bukan OLTP database utama.
2. Search document adalah **projection untuk retrieval**, bukan domain aggregate murni.
3. Mapping adalah **schema search**.
4. Analyzer menentukan bagaimana teks menjadi token.
5. Query DSL menentukan bagaimana user intent diterjemahkan menjadi retrieval plan.
6. Relevance menentukan urutan hasil, bukan sekadar apakah dokumen cocok.
7. Indexing pipeline harus memperlakukan Elasticsearch sebagai **derived read model** dari source-of-truth.
8. Freshness dan consistency harus didesain eksplisit.

Part ini menjawab pertanyaan praktis:

> Bagaimana semua prinsip itu diterapkan dalam Java backend tanpa membuat kode search menjadi string-concatenation hell, sulit dites, sulit diobservasi, dan rapuh saat mapping/query berubah?

Part ini bukan sekadar “cara memanggil API Elasticsearch dari Java”. Fokus kita adalah desain integrasi yang layak untuk production system.

---

## 1. Prinsip Utama Integrasi Java + Elasticsearch

Integrasi Java dengan Elasticsearch yang matang berdiri di atas beberapa prinsip.

### 1.1 Treat Elasticsearch Access as a Boundary

Elasticsearch bukan detail kecil di repository biasa. Ia punya:

- consistency model berbeda,
- query language berbeda,
- error model berbeda,
- performance model berbeda,
- schema/mapping lifecycle berbeda,
- relevance behavior berbeda,
- operational failure mode berbeda.

Karena itu, akses Elasticsearch sebaiknya dianggap sebagai **external system boundary**, setara dengan akses ke database, message broker, payment gateway, atau identity provider.

Bentuk idealnya:

```text
Application Service
        |
        v
Search Use Case / Search Service
        |
        v
Search Query Builder + Search Client Gateway
        |
        v
Official Elasticsearch Java API Client
        |
        v
Elasticsearch Cluster
```

Jangan biarkan controller, GraphQL resolver, atau service domain membuat Query DSL mentah secara langsung.

---

### 1.2 Separate Domain Model from Search Document Model

Kesalahan umum Java engineer:

```java
class Case {
    UUID id;
    String caseNumber;
    List<Party> parties;
    List<Allegation> allegations;
    CaseStatus status;
}
```

lalu class yang sama langsung dipakai untuk:

- JPA entity,
- API response,
- Elasticsearch document,
- Kafka event payload,
- audit snapshot.

Ini biasanya buruk.

Search document harus mengikuti kebutuhan retrieval:

```java
public record CaseSearchDocument(
    String id,
    String caseNumber,
    String title,
    String summary,
    String status,
    String severity,
    List<String> partyNames,
    List<String> partyIdentifiers,
    List<String> allegationTypes,
    Instant openedAt,
    Instant updatedAt,
    Instant lastActivityAt,
    List<String> permissionPrincipals,
    long version
) {}
```

Search document adalah **projection**. Ia boleh denormalized. Ia boleh punya field tambahan untuk ranking/filtering. Ia tidak harus mengikuti aggregate structure persis.

Rule:

> Domain model menjawab “apa kebenaran bisnisnya?”  
> Search document menjawab “bagaimana objek ini harus ditemukan, difilter, diranking, dan ditampilkan?”

---

### 1.3 Avoid Query DSL String Concatenation

Jangan membuat query seperti ini:

```java
String query = """
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "%s" } }
      ]
    }
  }
}
""".formatted(userInput);
```

Masalahnya:

- raw JSON mudah rusak,
- escaping rentan,
- tidak type-safe,
- refactor field sulit,
- conditional query menjadi messy,
- test assertion berat,
- observability sulit membedakan logical query dengan rendered query,
- injection-like behavior mungkin muncul pada query tertentu seperti `query_string`.

Gunakan official Java API Client, internal query builder, atau abstraction sendiri yang menghasilkan typed request.

---

### 1.4 Make Query Construction Explicit and Testable

Query production biasanya tidak sederhana. Ia punya:

- keyword,
- filters,
- permission constraints,
- tenant constraints,
- lifecycle constraints,
- sorting,
- pagination,
- facets,
- highlighting,
- ranking boosts,
- feature flags,
- backwards compatibility.

Maka query construction harus menjadi unit yang bisa dites.

Contoh struktur:

```text
CaseSearchRequestDto
        |
        v
CaseSearchCriteria
        |
        v
CaseSearchQueryFactory
        |
        v
SearchRequest
```

Testing dilakukan pada `CaseSearchQueryFactory`, bukan hanya integration test full cluster.

---

## 2. Official Elasticsearch Java API Client

Elasticsearch menyediakan official Java API Client. Client ini memberi typed requests dan typed responses untuk API Elasticsearch. Ini lebih aman dibanding membangun HTTP request manual untuk mayoritas use case.

Secara konseptual, stack-nya:

```text
Your Java Code
   |
   v
ElasticsearchClient / ElasticsearchAsyncClient
   |
   v
Transport Layer
   |
   v
HTTP Client
   |
   v
Elasticsearch REST API
```

Pada versi modern, official client menggunakan generated API surface yang mengikuti Elasticsearch API specification.

---

## 3. Dependency dan Versioning

Contoh Maven dependency:

```xml
<dependency>
    <groupId>co.elastic.clients</groupId>
    <artifactId>elasticsearch-java</artifactId>
    <version>${elasticsearch.java.client.version}</version>
</dependency>
```

Prinsip versioning:

1. Samakan major version client dengan major version cluster bila memungkinkan.
2. Jangan upgrade client tanpa compatibility test terhadap cluster.
3. Lock versi client di dependency management.
4. Jangan biarkan transitive dependency mengubah JSON mapper / HTTP stack diam-diam.
5. Dokumentasikan minimum supported Elasticsearch version untuk service Anda.

Contoh:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>co.elastic.clients</groupId>
            <artifactId>elasticsearch-java</artifactId>
            <version>8.19.0</version>
        </dependency>
    </dependencies>
</dependencyManagement>
```

Catatan: versi aktual harus mengikuti versi cluster dan compatibility matrix yang dipakai organisasi Anda.

---

## 4. Client Lifecycle

### 4.1 Client Should Be Long-Lived

Jangan membuat client per request.

Buruk:

```java
public SearchResponse<CaseSearchDocument> search(String keyword) {
    ElasticsearchClient client = createClient(); // jangan
    return client.search(...);
}
```

Baik:

```java
public final class CaseSearchGateway {
    private final ElasticsearchClient client;

    public CaseSearchGateway(ElasticsearchClient client) {
        this.client = client;
    }
}
```

Client harus dikelola sebagai singleton bean / application-scoped component karena koneksi HTTP, pooling, TLS, dan resource internal perlu reuse.

---

### 4.2 Spring Bean Example

Contoh minimal konfigurasi Spring Boot:

```java
@Configuration
public class ElasticsearchConfig {

    @Bean
    public RestClient elasticsearchLowLevelClient(ElasticsearchProperties props) {
        return RestClient.builder(HttpHost.create(props.url()))
            .setDefaultHeaders(new Header[] {
                new BasicHeader("Authorization", "ApiKey " + props.apiKey())
            })
            .setRequestConfigCallback(requestConfig -> requestConfig
                .setConnectTimeout(3_000)
                .setSocketTimeout(30_000)
                .setConnectionRequestTimeout(1_000)
            )
            .build();
    }

    @Bean
    public ElasticsearchTransport elasticsearchTransport(RestClient restClient) {
        return new RestClientTransport(
            restClient,
            new JacksonJsonpMapper()
        );
    }

    @Bean
    public ElasticsearchClient elasticsearchClient(ElasticsearchTransport transport) {
        return new ElasticsearchClient(transport);
    }
}
```

Production note:

- secrets jangan di-hardcode,
- TLS certificate harus divalidasi,
- timeout harus eksplisit,
- metrics/tracing perlu ditambahkan,
- client shutdown harus mengikuti lifecycle aplikasi.

---

## 5. Authentication dan Secure Connection

### 5.1 API Key Preferred for Service-to-Service

Untuk backend service, API key sering lebih cocok daripada basic auth karena:

- bisa scoped,
- bisa rotated,
- bisa dicabut,
- bisa dibedakan per service,
- lebih cocok untuk least privilege.

Contoh header:

```java
new BasicHeader("Authorization", "ApiKey " + apiKey)
```

Prinsip:

1. Jangan pakai superuser credential di service aplikasi.
2. Beri permission minimum: read/search untuk query service, write/index untuk indexing worker.
3. Pisahkan credential search path dan indexing path.
4. Rotasi key secara periodik.
5. Audit akses cluster.

---

### 5.2 TLS and Certificate Trust

Untuk production:

- gunakan HTTPS,
- validasi certificate,
- jangan disable hostname verification,
- jangan menerima semua certificate,
- simpan truststore secara aman,
- observasi expiry certificate.

Anti-pattern:

```java
// Jangan membuat TrustManager yang menerima semua certificate.
```

Kalau service Anda regulatory-grade, insecure TLS bypass bisa menjadi temuan audit serius.

---

## 6. Typed Documents dengan Java Records

Java records cocok untuk immutable search document.

```java
public record CaseSearchDocument(
    String id,
    String caseNumber,
    String title,
    String summary,
    String status,
    String severity,
    List<String> partyNames,
    List<String> allegationTypes,
    Instant openedAt,
    Instant updatedAt,
    Instant lastActivityAt,
    List<String> permissionPrincipals,
    long sourceVersion
) {}
```

Keuntungan:

- immutable by default,
- ringkas,
- cocok untuk serialization,
- mengurangi accidental mutation,
- bagus untuk projection.

Namun hati-hati:

- pastikan date format serialisasi cocok mapping,
- pastikan null handling jelas,
- hindari polymorphic model kompleks,
- jangan reuse domain aggregate langsung.

---

## 7. Indexing Single Document

Contoh indexing typed document:

```java
public void indexCase(CaseSearchDocument doc) throws IOException {
    client.index(i -> i
        .index("case-search-v3")
        .id(doc.id())
        .document(doc)
    );
}
```

Prinsip:

1. Gunakan deterministic id.
2. Jangan biarkan Elasticsearch auto-generate id untuk entity search projection.
3. Idempotency lebih mudah jika `_id` = source entity id atau composite stable id.
4. Jangan bergantung pada indexing order tanpa versioning.

Contoh id:

```text
case:{caseId}
case-document:{caseId}:{documentId}
party:{partyId}
```

Untuk index dengan multi-tenant:

```text
tenant:{tenantId}:case:{caseId}
```

Tapi sering lebih baik tenant menjadi field/filter/routing daripada dimasukkan ke `_id` saja.

---

## 8. Refresh Semantics dari Java Code

Recall dari Part 014–015:

- indexing berhasil tidak berarti langsung searchable,
- search visibility tergantung refresh,
- default refresh interval sering sekitar 1 detik pada banyak konfigurasi,
- `refresh=true` mahal bila dipakai per write,
- `refresh=wait_for` bisa dipakai untuk user flow tertentu.

Contoh:

```java
client.index(i -> i
    .index("case-search-v3")
    .id(doc.id())
    .document(doc)
    .refresh(Refresh.WaitFor)
);
```

Gunakan `Refresh.WaitFor` hanya jika flow benar-benar butuh read-after-write dari search.

Contoh cocok:

- user membuat case lalu langsung diarahkan ke search result yang harus memunculkan case itu,
- admin menjalankan manual reindex kecil dan ingin immediate verification,
- integration test.

Tidak cocok:

- high-volume indexing,
- event-driven indexing worker,
- bulk backfill,
- normal update pipeline.

---

## 9. Partial Update vs Full Reindex

### 9.1 Partial Update

```java
Map<String, Object> patch = Map.of(
    "status", "CLOSED",
    "updatedAt", Instant.now().toString()
);

client.update(u -> u
    .index("case-search-v3")
    .id(caseId)
    .doc(patch),
    CaseSearchDocument.class
);
```

Partial update terlihat murah, tetapi ingat Lucene update secara konseptual tetap delete + add document baru pada segment level.

Partial update baik jika:

- patch kecil,
- field tidak membutuhkan rekonstruksi kompleks,
- Anda yakin tidak akan membuat document inconsistent.

---

### 9.2 Full Reindex Per Entity

```java
public void reindexCase(UUID caseId) {
    CaseAggregate aggregate = caseRepository.get(caseId);
    CaseSearchDocument doc = caseSearchProjector.project(aggregate);
    caseSearchGateway.index(doc);
}
```

Full reindex per entity sering lebih aman untuk search projection kompleks.

Keuntungan:

- projection selalu konsisten,
- logic berada di satu tempat,
- tidak perlu patch banyak field tersebar,
- mudah repair.

Kekurangan:

- perlu membaca source-of-truth,
- payload lebih besar,
- lebih mahal untuk update kecil.

Rule praktis:

> Untuk critical business search document, prefer rebuild whole document from canonical source unless volume/cost membuktikan perlu partial update.

---

## 10. Bulk Indexing

Bulk indexing jauh lebih efisien daripada request satu per satu untuk banyak dokumen.

### 10.1 Basic Bulk Request

```java
public void bulkIndexCases(List<CaseSearchDocument> docs) throws IOException {
    BulkRequest.Builder br = new BulkRequest.Builder();

    for (CaseSearchDocument doc : docs) {
        br.operations(op -> op
            .index(idx -> idx
                .index("case-search-v3")
                .id(doc.id())
                .document(doc)
            )
        );
    }

    BulkResponse result = client.bulk(br.build());

    if (result.errors()) {
        for (BulkResponseItem item : result.items()) {
            if (item.error() != null) {
                // classify and handle
                log.warn("Bulk item failed: id={}, type={}, reason={}",
                    item.id(),
                    item.error().type(),
                    item.error().reason()
                );
            }
        }
    }
}
```

Critical point:

> HTTP 200 untuk bulk request tidak berarti semua item berhasil.

Anda wajib cek `result.errors()` dan item-level errors.

---

### 10.2 Bulk Error Classification

Bulk item error harus diklasifikasikan.

| Error Type | Contoh | Retry? | Aksi |
|---|---|---:|---|
| transient cluster issue | timeout, rejected execution | Ya | retry dengan backoff |
| mapping error | field type conflict | Tidak langsung | dead-letter + alert |
| document too large | payload melewati limit | Tidak langsung | fix projection |
| version conflict | event stale | Tergantung | ignore jika old version |
| authorization | forbidden | Tidak | fix credential/role |
| index not found | alias/template salah | Tidak langsung | deployment/config fix |

Jangan retry semua error membabi buta. Mapping error yang di-retry terus akan membuat indexing worker menjadi mesin spam.

---

### 10.3 Bulk Size Heuristic

Tidak ada ukuran universal. Mulai dengan:

- 500–2.000 documents per bulk,
- atau 5–15 MB payload per bulk,
- ukur latency, rejection, heap, merge pressure, network throughput.

Gunakan adaptive tuning berbasis metrik:

```text
if bulk latency naik + rejected execution naik:
    kurangi concurrency atau bulk size

if CPU rendah + network rendah + no rejection:
    naikkan bulk size/concurrency perlahan

if merge pressure tinggi:
    turunkan indexing rate atau tune index refresh/replica/ILM
```

---

## 11. Bulk Ingester Pattern

Untuk stream indexing, Anda tidak selalu ingin membangun bulk request manual. Pattern yang umum:

```text
incoming indexing events
        |
        v
buffer
        |
        +-- flush by max operations
        +-- flush by max bytes
        +-- flush by interval
        v
bulk request
```

Elasticsearch Java client menyediakan helper bulk ingester pada versi modern. Secara konseptual, parameter penting:

- maximum operations,
- maximum request size,
- flush interval,
- maximum concurrent requests,
- listener untuk success/failure.

Pseudo-structure:

```java
BulkIngester<CaseSearchDocument> ingester = BulkIngester.of(b -> b
    .client(client)
    .maxOperations(1000)
    .flushInterval(5, TimeUnit.SECONDS)
    .maxConcurrentRequests(2)
    .listener(new BulkListener<>() {
        @Override
        public void beforeBulk(long executionId, BulkRequest request, List<CaseSearchDocument> contexts) {
            // metrics
        }

        @Override
        public void afterBulk(long executionId, BulkRequest request, List<CaseSearchDocument> contexts, BulkResponse response) {
            // inspect item errors
        }

        @Override
        public void afterBulk(long executionId, BulkRequest request, List<CaseSearchDocument> contexts, Throwable failure) {
            // request-level failure
        }
    })
);
```

Catatan: signature detail dapat berubah antar versi client; yang penting adalah pattern-nya.

---

## 12. Backpressure di Indexing Worker

Indexing worker production harus punya backpressure. Tanpa backpressure:

- Kafka/RabbitMQ consumer terlalu cepat,
- bulk queue menumpuk,
- heap worker naik,
- Elasticsearch mulai reject,
- retry memperparah load,
- lag meledak,
- dead-letter penuh.

Model sehat:

```text
source events -> bounded queue -> bulk ingester -> Elasticsearch
                     ^                 |
                     |                 v
                 pause/resume <--- rejection/latency metrics
```

Untuk Java service:

- gunakan bounded queue,
- batasi concurrent bulk request,
- pause consumer saat queue penuh,
- retry transient failure dengan exponential backoff + jitter,
- kirim poison event ke dead-letter,
- expose lag metric,
- expose bulk error type metric.

---

## 13. Search Request dari Java

Contoh simple search:

```java
public SearchPage<CaseSearchHit> search(CaseSearchCriteria criteria) throws IOException {
    SearchResponse<CaseSearchDocument> response = client.search(s -> s
        .index("case-search-read")
        .query(q -> q
            .bool(b -> b
                .must(m -> m
                    .multiMatch(mm -> mm
                        .query(criteria.keyword())
                        .fields("title^3", "summary", "partyNames^2", "caseNumber^5")
                    )
                )
                .filter(f -> f.term(t -> t.field("tenantId").value(criteria.tenantId())))
                .filter(f -> f.terms(t -> t
                    .field("permissionPrincipals")
                    .terms(v -> v.value(criteria.principals().stream()
                        .map(FieldValue::of)
                        .toList()))
                ))
            )
        )
        .from(criteria.offset())
        .size(criteria.limit()),
        CaseSearchDocument.class
    );

    return mapResponse(response);
}
```

Masalah dengan contoh di atas: bagus untuk demo, tetapi terlalu inline untuk production. Query real akan membengkak.

---

## 14. Query Factory Pattern

Lebih baik pisahkan query construction.

```java
public final class CaseSearchQueryFactory {

    public Query buildMainQuery(CaseSearchCriteria criteria) {
        return Query.of(q -> q.bool(b -> {
            addKeywordQuery(b, criteria);
            addTenantFilter(b, criteria);
            addPermissionFilter(b, criteria);
            addLifecycleFilter(b, criteria);
            addUserFilters(b, criteria);
            return b;
        }));
    }

    private void addKeywordQuery(BoolQuery.Builder b, CaseSearchCriteria criteria) {
        if (criteria.keyword() == null || criteria.keyword().isBlank()) {
            b.must(q -> q.matchAll(m -> m));
            return;
        }

        b.must(q -> q.multiMatch(mm -> mm
            .query(criteria.keyword())
            .fields("caseNumber^8", "title^4", "partyNames^3", "summary")
            .type(TextQueryType.BestFields)
        ));
    }

    private void addTenantFilter(BoolQuery.Builder b, CaseSearchCriteria criteria) {
        b.filter(q -> q.term(t -> t
            .field("tenantId")
            .value(criteria.tenantId())
        ));
    }

    private void addPermissionFilter(BoolQuery.Builder b, CaseSearchCriteria criteria) {
        List<FieldValue> values = criteria.principals().stream()
            .map(FieldValue::of)
            .toList();

        b.filter(q -> q.terms(t -> t
            .field("permissionPrincipals")
            .terms(ts -> ts.value(values))
        ));
    }
}
```

Manfaat:

- query behavior bisa diuji,
- controller/service tidak penuh DSL,
- permission filter tidak lupa,
- field boosting terkonsolidasi,
- migration field name lebih mudah,
- reusable untuk search/export/count.

---

## 15. Field Name Constants vs Generated Schema

String field name tersebar adalah sumber bug.

Buruk:

```java
.field("partyName")
.field("partyNames")
.field("party_names")
```

Baik minimal:

```java
public final class CaseSearchFields {
    public static final String ID = "id";
    public static final String TENANT_ID = "tenantId";
    public static final String CASE_NUMBER = "caseNumber";
    public static final String TITLE = "title";
    public static final String SUMMARY = "summary";
    public static final String PARTY_NAMES = "partyNames";
    public static final String PERMISSION_PRINCIPALS = "permissionPrincipals";

    private CaseSearchFields() {}
}
```

Lebih matang:

- generate constants dari mapping definition,
- mapping contract test memastikan field ada,
- search code compile-time dekat dengan schema.

---

## 16. Mapping Contract Test

Tujuan: mencegah Java code mencari field yang tidak ada atau salah type.

Contoh assertion sederhana terhadap mapping JSON lokal:

```java
class CaseSearchMappingTest {

    @Test
    void mappingMustContainRequiredFields() throws Exception {
        JsonNode mapping = loadJson("mappings/case-search-v3.json");

        assertFieldType(mapping, "caseNumber", "keyword");
        assertFieldType(mapping, "title", "text");
        assertFieldType(mapping, "title.keyword", "keyword");
        assertFieldType(mapping, "permissionPrincipals", "keyword");
        assertFieldType(mapping, "lastActivityAt", "date");
    }
}
```

Lebih kuat:

- spin up Elasticsearch via Testcontainers,
- create index dengan mapping,
- call Get Mapping API,
- assert field type,
- run sample indexing,
- run sample search.

---

## 17. DTO, Criteria, dan Internal Search Model

Jangan langsung ubah HTTP request menjadi Elasticsearch query. Buat lapisan antara.

```java
public record CaseSearchHttpRequest(
    String q,
    List<String> statuses,
    String severity,
    Instant openedFrom,
    Instant openedTo,
    String sort,
    String cursor,
    Integer size
) {}
```

Normalize menjadi:

```java
public record CaseSearchCriteria(
    String keyword,
    Set<String> statuses,
    Optional<String> severity,
    Optional<Instant> openedFrom,
    Optional<Instant> openedTo,
    CaseSearchSort sort,
    SearchCursor cursor,
    int size,
    String tenantId,
    Set<String> principals
) {}
```

Manfaat criteria layer:

- validasi input,
- defaulting,
- normalize empty string,
- enforce max page size,
- convert external sort name ke internal field,
- inject security context,
- mencegah user memilih field arbitrary.

---

## 18. Pagination di Java: from/size vs search_after

Untuk shallow pagination:

```java
s.from(page * size).size(size)
```

Untuk deep/infinite pagination production:

```java
s.searchAfter(cursor.sortValues())
 .sort(so -> so.field(f -> f.field("lastActivityAt").order(SortOrder.Desc)))
 .sort(so -> so.field(f -> f.field("id.keyword").order(SortOrder.Asc)))
 .size(size);
```

Harus ada stable tie-breaker.

Cursor sebaiknya opaque untuk client:

```java
public record SearchCursor(List<String> sortValues) {
    public String encode() { /* base64 json */ }
    public static SearchCursor decode(String raw) { /* validate */ }
}
```

Jangan expose raw Elasticsearch sort array secara mentah jika API publik.

---

## 19. Point in Time dari Java

Untuk paginasi konsisten:

```java
OpenPointInTimeResponse pit = client.openPointInTime(o -> o
    .index("case-search-read")
    .keepAlive(t -> t.time("1m"))
);

SearchResponse<CaseSearchDocument> response = client.search(s -> s
    .pit(p -> p.id(pit.id()).keepAlive(t -> t.time("1m")))
    .query(query)
    .sort(...)
    .searchAfter(...)
    .size(size),
    CaseSearchDocument.class
);
```

Pastikan PIT ditutup bila flow selesai:

```java
client.closePointInTime(c -> c.id(pit.id()));
```

Design API:

- cursor menyimpan PIT id + sort values,
- PIT expiry harus ditangani,
- client harus bisa restart pagination dari awal,
- jangan buka PIT tanpa batas.

---

## 20. Sorting Contract

Jangan biarkan user mengirim field Elasticsearch langsung:

Buruk:

```http
GET /cases/search?sort=anyField:desc
```

Baik:

```http
GET /cases/search?sort=recent_activity
GET /cases/search?sort=relevance
GET /cases/search?sort=opened_date_desc
```

Mapping:

```java
public enum CaseSearchSort {
    RELEVANCE,
    RECENT_ACTIVITY,
    OPENED_DATE_DESC,
    CASE_NUMBER_ASC
}
```

Translator:

```java
public List<SortOptions> toSort(CaseSearchSort sort) {
    return switch (sort) {
        case RELEVANCE -> List.of(
            SortOptions.of(s -> s.score(sc -> sc.order(SortOrder.Desc))),
            SortOptions.of(s -> s.field(f -> f.field("id.keyword").order(SortOrder.Asc)))
        );
        case RECENT_ACTIVITY -> List.of(
            SortOptions.of(s -> s.field(f -> f.field("lastActivityAt").order(SortOrder.Desc))),
            SortOptions.of(s -> s.field(f -> f.field("id.keyword").order(SortOrder.Asc)))
        );
        case OPENED_DATE_DESC -> List.of(...);
        case CASE_NUMBER_ASC -> List.of(...);
    };
}
```

Kenapa perlu whitelist:

- mencegah expensive sorting,
- mencegah fielddata pada `text`,
- mencegah leak internal field,
- menjaga API compatibility,
- mempermudah observability per sort mode.

---

## 21. Handling Search Response

Search response tidak boleh bocor mentah ke API user.

Elasticsearch response punya:

- `_index`,
- `_id`,
- `_score`,
- `_source`,
- `sort`,
- `highlight`,
- `aggregations`,
- shard metadata,
- timeout flag.

API response sebaiknya domain-oriented:

```java
public record CaseSearchResult(
    String id,
    String caseNumber,
    String title,
    String summarySnippet,
    String status,
    String severity,
    Instant lastActivityAt,
    double score
) {}

public record SearchPage<T>(
    List<T> items,
    String nextCursor,
    boolean timedOut,
    long tookMillis,
    Map<String, Facet> facets
) {}
```

Mapping:

```java
private SearchPage<CaseSearchResult> mapResponse(SearchResponse<CaseSearchDocument> response) {
    List<CaseSearchResult> items = response.hits().hits().stream()
        .map(hit -> mapHit(hit))
        .toList();

    return new SearchPage<>(
        items,
        buildNextCursor(response),
        response.timedOut(),
        response.took(),
        mapFacets(response.aggregations())
    );
}
```

Prinsip:

> Elasticsearch response adalah internal infrastructure detail. API Anda harus punya contract sendiri.

---

## 22. Timeout Strategy

Timeout ada beberapa layer:

1. HTTP connection timeout.
2. HTTP socket/read timeout.
3. Elasticsearch search timeout.
4. Application use-case timeout.
5. Upstream gateway timeout.

Contoh search timeout:

```java
client.search(s -> s
    .index("case-search-read")
    .query(query)
    .timeout(t -> t.time("2s"))
    .size(20),
    CaseSearchDocument.class
);
```

Design:

```text
User-facing search endpoint SLA: 500ms p95
Elasticsearch search timeout: 400ms
Service timeout budget: 450ms
Gateway timeout: 1s
```

Jangan biarkan Elasticsearch query berjalan lebih lama dari user SLA.

---

## 23. Retry Strategy

Tidak semua operasi boleh di-retry sama.

### 23.1 Search Retry

Search retry harus hati-hati:

- retry bisa menggandakan load saat cluster sedang sakit,
- user bisa melakukan retry sendiri,
- retry pada expensive query bisa memperparah incident.

Gunakan retry terbatas untuk:

- connection reset,
- transient network issue,
- 502/503 tertentu,
- idempotent request.

Jangan retry agresif untuk:

- query timeout,
- circuit breaker,
- bad request,
- authorization error,
- mapping error.

---

### 23.2 Indexing Retry

Indexing retry lebih umum, tapi harus classified:

```text
transient error -> retry with backoff
mapping error -> dead-letter
version conflict -> compare version / ignore stale
forbidden -> fail fast and alert
index not found -> fail deployment / config
```

Gunakan exponential backoff + jitter:

```text
attempt 1: 100ms + jitter
attempt 2: 300ms + jitter
attempt 3: 1s + jitter
attempt 4: 3s + jitter
then DLQ / retry topic / manual repair
```

---

## 24. Optimistic Concurrency dan External Versioning

Elasticsearch mendukung optimistic concurrency via sequence number dan primary term, dan juga beberapa mode versioning tergantung API. Dalam event-driven indexing, Anda butuh strategi agar event lama tidak menimpa projection baru.

Contoh logical source version:

```java
public record CaseChangedEvent(
    UUID caseId,
    long version,
    Instant occurredAt
) {}
```

Projection menyimpan version:

```java
public record CaseSearchDocument(
    String id,
    ...,
    long sourceVersion
) {}
```

Strategi:

1. Event handler membaca aggregate terbaru dan index full document.
2. Bila event lama datang, hasil rebuild tetap latest karena membaca canonical DB terbaru.
3. Jika tidak membaca DB dan memakai event payload langsung, gunakan version guard.

Simpler and robust:

```text
Event says: case 123 changed
Worker reads current case 123 from source DB
Worker projects current state
Worker indexes document with deterministic id
```

Ini mengurangi risiko stale overwrite, dengan biaya read ke source DB.

---

## 25. Handling Deletes

Delete dari source-of-truth harus dipropagasikan.

```java
client.delete(d -> d
    .index("case-search-v3")
    .id(caseId)
);
```

Namun dalam banyak regulatory/case system, delete fisik jarang benar. Sering lebih baik:

```java
status = "DELETED"
visibility = "HIDDEN"
```

Lalu filter search:

```java
b.filter(q -> q.term(t -> t.field("visible").value(true)));
```

Trade-off:

| Approach | Kelebihan | Risiko |
|---|---|---|
| Physical delete | tidak searchable | audit/history hilang dari index |
| Soft delete | audit lebih mudah | harus selalu filter visibility |
| Tombstone document | repair/replay jelas | query harus exclude tombstone |

Untuk compliance, soft delete + retention policy sering lebih defensible.

---

## 26. Index Alias dari Java

Aplikasi jangan menulis langsung ke physical index bila Anda butuh zero-downtime reindex.

Gunakan alias:

```text
case-search-write -> case-search-v3
case-search-read  -> case-search-v3
```

Java config:

```java
public record SearchIndexNames(
    String caseReadAlias,
    String caseWriteAlias
) {}
```

Gateway:

```java
client.search(s -> s.index(indexNames.caseReadAlias()) ...);
client.index(i -> i.index(indexNames.caseWriteAlias()) ...);
```

Saat migration:

```text
case-search-v3 active
case-search-v4 build in background
verify v4
swap read/write alias atomically
```

Aplikasi tidak perlu redeploy hanya karena physical index berubah.

---

## 27. Multi-Tenant Integration

Ada beberapa model:

### 27.1 Shared Index with Tenant Filter

```text
case-search-v3
  tenantId field
```

Query selalu filter:

```java
b.filter(q -> q.term(t -> t.field("tenantId").value(tenantId)));
```

Kelebihan:

- operationally simple,
- shard usage efisien,
- cocok banyak tenant kecil.

Risiko:

- tenant filter lupa = data leak,
- noisy tenant bisa memengaruhi semua,
- data deletion per tenant lebih sulit.

Mitigasi:

- query factory selalu inject tenant filter,
- integration test security,
- wrapper gateway tidak menerima query tanpa security context,
- optional routing by tenant.

---

### 27.2 Index per Tenant

```text
case-search-tenant-a-v1
case-search-tenant-b-v1
```

Kelebihan:

- isolasi kuat,
- delete tenant mudah,
- per-tenant tuning.

Risiko:

- oversharding,
- cluster state besar,
- operational complexity,
- tenant onboarding/offboarding lebih berat.

Cocok untuk sedikit tenant besar, bukan ribuan tenant kecil.

---

## 28. Permission-Aware Search in Java

Permission filter harus non-optional.

Buruk:

```java
public Query buildQuery(SearchCriteria criteria, boolean includeSecurity) { ... }
```

Baik:

```java
public record SearchSecurityContext(
    String tenantId,
    Set<String> principals,
    boolean canViewRestricted
) {}
```

Criteria selalu membawa security context:

```java
public record CaseSearchCriteria(
    String keyword,
    ...,
    SearchSecurityContext security
) {}
```

Factory selalu apply:

```java
private void addSecurityFilters(BoolQuery.Builder b, SearchSecurityContext security) {
    b.filter(q -> q.term(t -> t
        .field("tenantId")
        .value(security.tenantId())
    ));

    b.filter(q -> q.terms(t -> t
        .field("permissionPrincipals")
        .terms(ts -> ts.value(security.principals().stream()
            .map(FieldValue::of)
            .toList()))
    ));

    if (!security.canViewRestricted()) {
        b.filter(q -> q.term(t -> t.field("restricted").value(false)));
    }
}
```

Test wajib:

- user A tidak melihat dokumen tenant B,
- user tanpa principal tidak melihat restricted document,
- facet counts tidak menghitung dokumen yang tidak boleh dilihat,
- export endpoint memakai permission filter yang sama.

---

## 29. Observability Integration

Search integration tanpa observability adalah blind spot.

Minimal metrics:

### Search Metrics

- request count by endpoint,
- search latency p50/p95/p99,
- Elasticsearch took,
- application total latency,
- timeout count,
- error count by type/status,
- result count distribution,
- zero-result query count,
- query mode: keyword/search_after/facet/export,
- sort mode,
- index alias,
- timed_out flag.

### Indexing Metrics

- indexing event lag,
- bulk request count,
- bulk latency,
- bulk size docs/bytes,
- item failure count by error type,
- retry count,
- DLQ count,
- refresh wait usage,
- queue depth,
- consumer pause duration.

---

### 29.1 Micrometer Example

```java
public SearchPage<CaseSearchResult> search(CaseSearchCriteria criteria) {
    Timer.Sample sample = Timer.start(meterRegistry);
    try {
        SearchPage<CaseSearchResult> result = doSearch(criteria);
        meterRegistry.counter("search.requests", "status", "success").increment();
        meterRegistry.summary("search.results.count").record(result.items().size());
        return result;
    } catch (Exception e) {
        meterRegistry.counter("search.requests", "status", "error", "type", classify(e)).increment();
        throw e;
    } finally {
        sample.stop(meterRegistry.timer("search.latency", "index", "case"));
    }
}
```

Hati-hati cardinality label:

Jangan label metrics dengan raw query string, user id, case id, atau full index physical name yang berubah terlalu sering.

---

## 30. Structured Logging

Log search request secara aman.

Contoh:

```json
{
  "event": "case_search_executed",
  "requestId": "...",
  "tenantId": "t-123",
  "queryHash": "sha256:...",
  "keywordLength": 12,
  "filters": ["status", "severity", "openedAt"],
  "sort": "RECENT_ACTIVITY",
  "size": 20,
  "tookMs": 43,
  "esTookMs": 29,
  "timedOut": false,
  "resultCount": 20
}
```

Jangan log:

- raw sensitive keyword,
- PII,
- full permission principals,
- full Elasticsearch response,
- API key,
- document content.

Untuk debugging, gunakan sampling atau secure debug mode.

---

## 31. Tracing

Trace spans:

```text
HTTP GET /cases/search
  -> validate request
  -> build criteria
  -> build elasticsearch query
  -> elasticsearch.search case-search-read
  -> map response
```

Span attributes yang aman:

- index alias,
- query type,
- size,
- sort mode,
- took ms,
- timed_out,
- result count,
- error type.

Jangan masukkan raw query DSL ke trace by default karena bisa mengandung data sensitif.

---

## 32. Exception Translation

Jangan bocorkan exception Elasticsearch mentah ke controller.

Buat exception domain/infrastructure:

```java
public class SearchUnavailableException extends RuntimeException { ... }
public class SearchTimeoutException extends RuntimeException { ... }
public class SearchQueryRejectedException extends RuntimeException { ... }
public class SearchSchemaMismatchException extends RuntimeException { ... }
```

Translator:

```java
public RuntimeException translate(Exception e) {
    if (isTimeout(e)) return new SearchTimeoutException(e);
    if (isRejected(e)) return new SearchUnavailableException(e);
    if (isBadQuery(e)) return new SearchQueryRejectedException(e);
    if (isMappingProblem(e)) return new SearchSchemaMismatchException(e);
    return new SearchUnavailableException(e);
}
```

HTTP mapping:

| Internal Exception | HTTP Response |
|---|---|
| SearchTimeoutException | 504 or 503 with retryable=false/true depending context |
| SearchUnavailableException | 503 |
| SearchQueryRejectedException | 400 |
| SearchSchemaMismatchException | 500 + alert |
| Authorization failure | 403 |

---

## 33. Testing Strategy

Production-grade Java integration butuh beberapa layer test.

```text
Unit tests
  -> criteria validation
  -> query factory logic
  -> sort translator
  -> cursor encoding

Mapping contract tests
  -> field existence/type
  -> analyzer expectation

Integration tests
  -> real Elasticsearch via Testcontainers
  -> index sample docs
  -> execute queries
  -> assert result order/facets/security

Relevance tests
  -> golden queries
  -> expected top K
  -> regression detection

Performance tests
  -> representative data volume
  -> latency and load profile
```

---

### 33.1 Unit Test Query Factory

```java
class CaseSearchQueryFactoryTest {

    private final CaseSearchQueryFactory factory = new CaseSearchQueryFactory();

    @Test
    void queryMustAlwaysContainTenantAndPermissionFilters() {
        CaseSearchCriteria criteria = sampleCriteria();

        Query query = factory.buildMainQuery(criteria);
        String json = renderToJson(query);

        assertThat(json).contains("tenantId");
        assertThat(json).contains("permissionPrincipals");
    }

    @Test
    void blankKeywordShouldUseMatchAllWithFilters() {
        CaseSearchCriteria criteria = sampleCriteriaWithBlankKeyword();

        Query query = factory.buildMainQuery(criteria);
        String json = renderToJson(query);

        assertThat(json).contains("match_all");
        assertThat(json).contains("filter");
    }
}
```

Snapshot testing query JSON bisa membantu, tapi jangan terlalu brittle. Assert invariant penting, bukan semua whitespace/detail generated JSON.

---

### 33.2 Testcontainers Integration Test

Contoh konseptual:

```java
@Testcontainers
class CaseSearchIntegrationTest {

    @Container
    static ElasticsearchContainer elasticsearch = new ElasticsearchContainer(
        "docker.elastic.co/elasticsearch/elasticsearch:8.19.0"
    );

    @BeforeEach
    void setupIndex() {
        createIndexWithMapping("case-search-v3");
        indexSampleDocuments();
        refreshIndex();
    }

    @Test
    void shouldSearchByPartyNameAndRespectPermission() {
        CaseSearchCriteria criteria = criteria("john smith", principals("investigator:123"));

        SearchPage<CaseSearchResult> result = searchService.search(criteria);

        assertThat(result.items())
            .extracting(CaseSearchResult::caseNumber)
            .containsExactly("CASE-001");
    }
}
```

Testcontainers memberi confidence yang tidak bisa diberikan unit test murni, terutama untuk analyzer, mapping, nested query, aggregations, dan sorting.

---

## 34. Search Fixture Design

Fixture search harus sengaja dibuat untuk menangkap edge case.

Contoh data minimal:

| Case | Purpose |
|---|---|
| exact case number | identifier search |
| same title different severity | ranking boost test |
| old vs fresh case | recency boost test |
| restricted case | permission test |
| tenant B case same keyword | tenant isolation test |
| typo variant | fuzzy/autocomplete test |
| synonym variant | synonym test |
| no permission document | facet leakage test |
| duplicate-looking document | tie-breaker test |

Jangan hanya pakai random faker data. Search test butuh curated relevance fixtures.

---

## 35. Search Code Organization

Struktur package yang sehat:

```text
com.example.caseapp.search
  ├── api
  │   ├── CaseSearchController.java
  │   ├── CaseSearchHttpRequest.java
  │   └── CaseSearchHttpResponse.java
  ├── application
  │   ├── CaseSearchService.java
  │   ├── CaseSearchCriteria.java
  │   ├── CaseSearchResult.java
  │   └── SearchSecurityContext.java
  ├── elastic
  │   ├── CaseSearchGateway.java
  │   ├── CaseSearchQueryFactory.java
  │   ├── CaseSearchAggregationFactory.java
  │   ├── CaseSearchSortFactory.java
  │   ├── CaseSearchResponseMapper.java
  │   ├── CaseSearchFields.java
  │   └── SearchIndexNames.java
  ├── indexing
  │   ├── CaseSearchDocument.java
  │   ├── CaseSearchProjector.java
  │   ├── CaseIndexingWorker.java
  │   ├── CaseIndexingEventHandler.java
  │   └── BulkIndexingService.java
  └── config
      └── ElasticsearchConfig.java
```

Boundary jelas:

- `api`: HTTP contract,
- `application`: use-case semantics,
- `elastic`: Elasticsearch implementation,
- `indexing`: projection/write path,
- `config`: client setup.

---

## 36. Spring Data Elasticsearch: Kapan Dipakai?

Spring Data Elasticsearch bisa membantu untuk use case sederhana, repository-style, atau tim yang ingin integrasi Spring idiomatis. Tapi untuk search engineering yang kompleks, hati-hati.

Cocok jika:

- query sederhana,
- CRUD-ish indexing,
- mapping sederhana,
- tim sudah sangat Spring Data oriented,
- relevance bukan inti produk.

Kurang cocok jika:

- Query DSL kompleks,
- relevance engineering penting,
- hybrid search/vector search custom,
- zero-downtime reindex canggih,
- permission-aware search kompleks,
- facet/highlight/pagination custom,
- butuh kontrol penuh request/response.

Untuk seri ini, kita cenderung menggunakan official Java API Client langsung karena memberi kontrol lebih baik.

---

## 37. Reactive vs Blocking Client

Search endpoint sering I/O-bound. Pilihan blocking vs async/reactive tergantung stack aplikasi.

### Blocking

Kelebihan:

- lebih sederhana,
- cocok Spring MVC,
- debugging mudah,
- thread-per-request model familiar.

Risiko:

- thread pool habis bila latency tinggi,
- butuh timeout ketat.

### Async/Reactive

Kelebihan:

- concurrency lebih efisien,
- cocok WebFlux/reactive pipeline,
- bisa parallelize beberapa request.

Risiko:

- kompleksitas meningkat,
- tracing/error handling lebih tricky,
- backpressure harus benar,
- blocking call tersembunyi bisa merusak.

Rule:

> Jangan memilih reactive hanya karena Elasticsearch remote I/O. Pilih reactive jika keseluruhan stack dan tim siap mengelola kompleksitasnya.

---

## 38. Parallel Search Requests

Kadang API perlu beberapa query:

- main result,
- facet counts,
- suggestion,
- related cases.

Jangan otomatis serial:

```text
main search 120ms
facets 90ms
suggestion 40ms
serial total ~250ms
parallel total ~120ms + overhead
```

Tapi parallel juga menambah cluster load.

Design:

- combine dalam satu `_search` bila masuk akal,
- gunakan aggregations jika facet bagian dari result,
- gunakan msearch untuk beberapa independent queries,
- apply timeout per subquery,
- degrade gracefully bila non-critical panel gagal.

---

## 39. Multi Search from Java

Untuk beberapa query independent:

```java
MsearchResponse<CaseSearchDocument> response = client.msearch(ms -> ms
    .searches(s -> s
        .header(h -> h.index("case-search-read"))
        .body(b -> b.query(mainQuery).size(20))
    )
    .searches(s -> s
        .header(h -> h.index("case-search-read"))
        .body(b -> b.query(suggestionQuery).size(5))
    ),
    CaseSearchDocument.class
);
```

Gunakan msearch dengan hati-hati:

- satu HTTP request tidak berarti murah,
- setiap sub-search tetap memakai resource,
- error bisa terjadi per response item,
- observability harus membedakan subquery.

---

## 40. Highlighting Integration

Highlighting biasanya tidak cocok di model `_source` langsung. Ia adalah presentation enhancement.

```java
client.search(s -> s
    .index("case-search-read")
    .query(query)
    .highlight(h -> h
        .fields("summary", hf -> hf
            .fragmentSize(150)
            .numberOfFragments(2)
        )
        .fields("title", hf -> hf
            .numberOfFragments(0)
        )
    ),
    CaseSearchDocument.class
);
```

Mapping response:

```java
Map<String, List<String>> highlight = hit.highlight();
String snippet = highlight.getOrDefault("summary", List.of(doc.summary())).get(0);
```

Security note:

- sanitize highlight output di frontend,
- jangan render sebagai trusted HTML kecuali Anda benar-benar mengontrol tags,
- pastikan highlight tidak membocorkan field yang disembunyikan.

---

## 41. Aggregations Integration

Aggregations response sering verbose. Buat mapper khusus.

```java
public record FacetBucket(String value, long count) {}
public record Facet(String name, List<FacetBucket> buckets) {}
```

Factory:

```java
public void addStatusFacet(SearchRequest.Builder s) {
    s.aggregations("status", a -> a
        .terms(t -> t.field("status").size(20))
    );
}
```

Mapper:

```java
Aggregate statusAgg = response.aggregations().get("status");
List<FacetBucket> buckets = statusAgg.sterms().buckets().array().stream()
    .map(b -> new FacetBucket(b.key().stringValue(), b.docCount()))
    .toList();
```

Prinsip:

- aggregation names adalah API internal; konstanta-kan,
- facet counts harus mengikuti permission filters,
- jangan expose raw aggregation response,
- batasi size terms aggregation.

---

## 42. Runtime Configuration

Search behavior sering perlu konfigurasi:

```yaml
search:
  indices:
    case-read-alias: case-search-read
    case-write-alias: case-search-write
  defaults:
    page-size: 20
    max-page-size: 100
    timeout: 500ms
  features:
    recency-boost-enabled: true
    semantic-search-enabled: false
  relevance:
    title-boost: 4.0
    case-number-boost: 8.0
    party-name-boost: 3.0
```

Tapi hati-hati:

- terlalu banyak runtime knobs membuat relevance tidak reproducible,
- ubah boost harus lewat review/test,
- config drift antar environment harus dicegah,
- simpan snapshot config untuk incident debugging.

---

## 43. Feature Flags untuk Query Evolution

Relevance improvement sering bertahap.

Contoh:

```java
if (features.semanticSearchEnabled()) {
    addSemanticClause(b, criteria);
} else {
    addLexicalClause(b, criteria);
}
```

Gunakan feature flags untuk:

- query strategy baru,
- boost baru,
- analyzer/index version baru,
- hybrid search rollout,
- new facet.

Namun:

- jangan membuat query factory menjadi hutan if/else,
- hapus flag lama,
- log strategy yang digunakan,
- jalankan relevance regression untuk tiap variant.

---

## 44. Reindex Orchestration from Java

Aplikasi Java sering perlu job reindex:

```text
create new index
load mapping/settings
scan source DB
project documents
bulk index
refresh
verify counts/checksums/sample queries
swap alias
cleanup old index later
```

Service components:

```text
ReindexCommandHandler
  -> IndexAdminGateway
  -> SourceDataScanner
  -> CaseSearchProjector
  -> BulkIndexingService
  -> ReindexVerifier
  -> AliasSwitcher
```

Jangan menjalankan reindex besar dari HTTP request biasa. Gunakan job framework / batch / orchestration.

---

## 45. Index Admin Operations dari Java

Tidak semua service harus punya permission admin. Pisahkan:

| Service | Permission |
|---|---|
| Search API | read/search only |
| Indexing worker | write/index/update/delete |
| Reindex job | create index, put mapping, bulk write, alias update |
| Ops tool | snapshot/restore/ILM/admin |

Least privilege penting.

Jika Search API credential bisa update alias atau delete index, blast radius terlalu besar.

---

## 46. Health Check

Health check harus dibedakan:

### Liveness

Apakah aplikasi hidup?

```text
JVM running, web server accepting request
```

Jangan menjadikan Elasticsearch down sebagai liveness failure; nanti orchestrator bisa restart app terus tanpa menyelesaikan masalah.

### Readiness

Apakah aplikasi siap melayani search?

```text
Elasticsearch reachable
required alias exists
optional: cluster health not red for target index
```

### Dependency Health Detail

```json
{
  "elasticsearch": {
    "reachable": true,
    "clusterStatus": "yellow",
    "caseReadAliasExists": true,
    "caseWriteAliasExists": true
  }
}
```

---

## 47. Graceful Degradation

Search bisa gagal. API harus punya strategi.

Untuk user-facing search:

- tampilkan error jelas,
- boleh fallback ke recent items dari cache hanya jika secara produk benar,
- jangan diam-diam menampilkan hasil stale sebagai hasil search normal tanpa label,
- jangan fallback ke OLTP `LIKE` query untuk traffic besar tanpa guard.

Untuk non-critical panels:

- related cases gagal → sembunyikan panel,
- suggestions gagal → tampilkan search utama,
- facets timeout → tampilkan results tanpa facets dengan indikator.

Design response:

```json
{
  "items": [...],
  "facets": null,
  "warnings": ["FACETS_UNAVAILABLE"]
}
```

---

## 48. Common Java Integration Anti-Patterns

### Anti-Pattern 1: Elasticsearch Repository as Generic CRUD Repository

```java
interface CaseSearchRepository {
    save(Case case);
    findById(UUID id);
    delete(UUID id);
}
```

Ini menyembunyikan kenyataan bahwa search document adalah projection dan query relevance berbeda dari CRUD.

---

### Anti-Pattern 2: Controller Builds Query DSL

Controller harus menangani HTTP, bukan retrieval logic.

---

### Anti-Pattern 3: Missing Security Filter in Some Endpoints

Search endpoint, count endpoint, export endpoint, facet endpoint, suggestion endpoint semuanya harus memakai security context.

---

### Anti-Pattern 4: Bulk Without Item Error Handling

Bulk response harus diperiksa per item.

---

### Anti-Pattern 5: Refresh True Everywhere

`refresh=true` per write bisa membunuh indexing throughput.

---

### Anti-Pattern 6: Raw Query String Logging

Raw query bisa mengandung PII, rahasia, atau data investigasi sensitif.

---

### Anti-Pattern 7: No Mapping Contract Test

Field name berubah, query diam-diam rusak di runtime.

---

### Anti-Pattern 8: Reusing JPA Entity as Search Document

Membuat projection tidak stabil, serialization rumit, dan search model terikat domain persistence.

---

### Anti-Pattern 9: Retrying Mapping Errors Forever

Retry storm tanpa peluang sukses.

---

### Anti-Pattern 10: Exposing Elasticsearch Query DSL to Public API

Memberikan user kemampuan membuat query arbitrary dapat menyebabkan expensive query, data leak, dan API coupling.

---

## 49. Production-Grade Case Search Example

### 49.1 HTTP Request

```http
GET /api/cases/search?q=fraud%20bank&status=OPEN&severity=HIGH&sort=recent_activity&size=20
Authorization: Bearer ...
```

### 49.2 Controller

```java
@RestController
@RequestMapping("/api/cases/search")
public class CaseSearchController {

    private final CaseSearchService service;

    @GetMapping
    public CaseSearchHttpResponse search(
        @Valid CaseSearchHttpRequest request,
        Authentication authentication
    ) {
        return service.search(request, authentication);
    }
}
```

### 49.3 Application Service

```java
public class CaseSearchService {

    private final CaseSearchCriteriaFactory criteriaFactory;
    private final CaseSearchGateway gateway;
    private final CaseSearchResponseAssembler assembler;

    public CaseSearchHttpResponse search(CaseSearchHttpRequest request, Authentication auth) {
        CaseSearchCriteria criteria = criteriaFactory.from(request, auth);
        SearchPage<CaseSearchResult> page = gateway.search(criteria);
        return assembler.toHttpResponse(page);
    }
}
```

### 49.4 Gateway

```java
public class CaseSearchGateway {

    private final ElasticsearchClient client;
    private final CaseSearchQueryFactory queryFactory;
    private final CaseSearchSortFactory sortFactory;
    private final CaseSearchAggregationFactory aggregationFactory;
    private final CaseSearchResponseMapper responseMapper;
    private final SearchIndexNames indexNames;

    public SearchPage<CaseSearchResult> search(CaseSearchCriteria criteria) {
        try {
            Query query = queryFactory.buildMainQuery(criteria);

            SearchResponse<CaseSearchDocument> response = client.search(s -> {
                s.index(indexNames.caseReadAlias())
                 .query(query)
                 .size(criteria.size())
                 .timeout(t -> t.time("500ms"));

                sortFactory.applySort(s, criteria.sort());
                aggregationFactory.applyFacets(s, criteria);
                criteria.cursor().ifPresent(cursor -> applyCursor(s, cursor));

                return s;
            }, CaseSearchDocument.class);

            return responseMapper.map(response, criteria);
        } catch (Exception e) {
            throw translate(e);
        }
    }
}
```

### 49.5 Query Factory

```java
public class CaseSearchQueryFactory {

    public Query buildMainQuery(CaseSearchCriteria criteria) {
        return Query.of(q -> q.bool(b -> {
            addKeywordClause(b, criteria);
            addBusinessFilters(b, criteria);
            addSecurityFilters(b, criteria.security());
            return b;
        }));
    }
}
```

Dengan struktur ini, query behavior bisa berkembang tanpa mengacaukan controller dan service layer.

---

## 50. Checklist Integrasi Java + Elasticsearch

### Client

- [ ] Official Java API Client digunakan.
- [ ] Client long-lived singleton bean.
- [ ] Timeout eksplisit.
- [ ] TLS valid.
- [ ] API key/credential scoped.
- [ ] Shutdown lifecycle benar.

### Search Query

- [ ] Query DSL tidak dibuat dengan string concatenation.
- [ ] Query factory terpisah.
- [ ] Field names terkonsolidasi.
- [ ] Security filter selalu diterapkan.
- [ ] Sort whitelist.
- [ ] Page size dibatasi.
- [ ] Deep pagination memakai `search_after`/PIT bila perlu.

### Indexing

- [ ] Deterministic document id.
- [ ] Bulk indexing untuk batch.
- [ ] Bulk item errors dicek.
- [ ] Retry classified.
- [ ] DLQ untuk poison events.
- [ ] Backpressure ada.
- [ ] `refresh=true` tidak dipakai sembarangan.

### Schema

- [ ] Search document model terpisah dari domain entity.
- [ ] Mapping contract test ada.
- [ ] Alias digunakan untuk read/write.
- [ ] Migration/reindex path jelas.

### Observability

- [ ] Metrics search latency.
- [ ] Metrics ES took.
- [ ] Metrics timeout/error.
- [ ] Metrics zero-result query.
- [ ] Metrics bulk failures by type.
- [ ] Structured log aman.
- [ ] Trace span untuk Elasticsearch call.

### Testing

- [ ] Unit test query factory.
- [ ] Integration test dengan real Elasticsearch.
- [ ] Permission-aware search test.
- [ ] Facet leakage test.
- [ ] Relevance regression fixture.
- [ ] Cursor/sort stability test.

---

## 51. Mental Model Ringkas

Java integration yang baik bukan ini:

```text
Controller -> JSON string query -> Elasticsearch
```

Melainkan ini:

```text
HTTP request
  -> validated request DTO
  -> normalized search criteria
  -> mandatory security context
  -> query factory
  -> typed Elasticsearch client
  -> response mapper
  -> stable API response
```

Indexing path yang baik bukan ini:

```text
Domain object changed -> partial random update to Elasticsearch
```

Melainkan ini:

```text
Source event
  -> idempotent worker
  -> load canonical state if needed
  -> project search document
  -> bulk index through alias
  -> classify failures
  -> observe lag/errors
  -> repair/replay possible
```

Top-tier engineer tidak hanya bisa “membuat search jalan”. Mereka bisa menjawab:

- Apa contract freshness-nya?
- Bagaimana query ini dites?
- Bagaimana permission tidak bocor?
- Bagaimana mapping berubah tanpa downtime?
- Bagaimana bulk failure ditangani?
- Bagaimana tahu ranking memburuk?
- Bagaimana sistem pulih dari lag/retry/index corruption?
- Bagaimana membatasi blast radius credential?
- Bagaimana observability membuktikan bottleneck ada di app, network, coordinating node, shard, atau query design?

---

## 52. Latihan Praktis

### Latihan 1 — Buat Search Document Projection

Ambil domain `Case`, `Party`, `Allegation`, `Decision`, dan desain `CaseSearchDocument`.

Pastikan field mendukung:

- keyword search,
- case number exact search,
- party name search,
- status filter,
- severity filter,
- opened date filter,
- last activity sort,
- permission-aware search,
- future reindexing.

---

### Latihan 2 — Implement Query Factory

Buat `CaseSearchQueryFactory` yang:

- blank keyword => `match_all` + filters,
- keyword => multi-field search,
- selalu include tenant filter,
- selalu include permission filter,
- support status/severity/date range filter,
- support restricted document filtering.

---

### Latihan 3 — Bulk Indexer dengan Error Classification

Implement bulk service yang:

- menerima list search document,
- mengirim bulk request,
- cek item-level errors,
- classify retryable vs non-retryable,
- log structured error,
- expose metrics.

---

### Latihan 4 — Integration Test dengan Testcontainers

Buat test yang:

- create index + mapping,
- index 10 curated case documents,
- refresh,
- search by party name,
- assert result ranking,
- assert tenant isolation,
- assert permission filter,
- assert facet counts tidak bocor.

---

### Latihan 5 — Cursor Pagination

Implement:

- stable sort by `lastActivityAt desc`, `id asc`,
- encode/decode cursor,
- `search_after`,
- test no duplicate / no missing result across pages.

---

## 53. Kesimpulan Part 016

Pada part ini kita memindahkan Elasticsearch dari “tool yang dipanggil Java” menjadi **boundary arsitektural yang eksplisit**.

Integrasi Java yang matang punya ciri:

1. Official typed client digunakan dengan lifecycle benar.
2. Search document terpisah dari domain entity.
3. Query construction eksplisit, reusable, dan testable.
4. Security filter mandatory, bukan optional.
5. Indexing path idempotent, bulk-aware, retry-aware, dan repairable.
6. Alias digunakan agar migration tidak memaksa redeploy aplikasi.
7. Timeout, retry, dan exception translation didesain sadar failure mode.
8. Metrics, logs, dan traces cukup untuk incident response.
9. Test mencakup mapping, analyzer, query, permission, facet, pagination, dan relevance.
10. Public API tidak bocor detail Elasticsearch internal.

Part berikutnya akan naik ke level API design:

> Bagaimana mendesain backend search endpoint yang stabil, aman, evolvable, dan nyaman dipakai frontend/user tanpa memberi akses liar ke Query DSL Elasticsearch?

---

## Referensi Resmi

- Elastic — Java API Client documentation: https://www.elastic.co/docs/reference/elasticsearch/clients/java
- Elastic — Using the Java API Client: https://www.elastic.co/docs/reference/elasticsearch/clients/java/usage
- Elastic — Bulk indexing multiple documents with Java API Client: https://www.elastic.co/docs/reference/elasticsearch/clients/java/usage/indexing-bulk
- Elastic — Bulk API: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-bulk
- Elastic — Pagination and `search_after`: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results
- Elastic — Near real-time search: https://www.elastic.co/docs/manage-data/data-store/near-real-time-search
- Elastic — Optimistic concurrency control: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/optimistic-concurrency-control


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-015.md">⬅️ Learn Search Engine Database and Elasticsearch Mastery for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-017.md">Part 017 — Search API Design for Backend Engineers ➡️</a>
</div>
