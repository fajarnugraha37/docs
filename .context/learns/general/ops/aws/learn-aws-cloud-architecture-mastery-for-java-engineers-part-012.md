# learn-aws-cloud-architecture-mastery-for-java-engineers-part-012.md

# Part 012 — Application Data on AWS: Managed Relational, Key-Value, Document, Search, Cache without Repeating Database Internals

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin menguasai AWS dari sisi architecture, production operation, failure modelling, dan engineering decision.  
> Fokus part ini: memahami managed data services di AWS sebagai **operational envelope**, bukan mengulang SQL, PostgreSQL, MySQL, Redis, MongoDB, Elasticsearch, ClickHouse, Kafka, atau database internals yang sudah dibahas di seri lain.

---

## 0. Kenapa Part Ini Penting

Di sistem backend nyata, compute biasanya relatif mudah diganti. Container bisa diredeploy. Lambda bisa diubah version/alias. EC2 bisa direplace Auto Scaling Group. Tetapi **data service** membawa konsekuensi yang jauh lebih berat:

- data punya state historis;
- data punya schema, access pattern, retention, compliance, dan backup;
- data punya latency dan consistency contract;
- data migration mahal dan riskan;
- data corruption lebih buruk daripada service downtime;
- salah pilih database sering baru terasa setelah volume, tenant, regulator, audit, atau reporting berkembang.

Di AWS, banyak engineer jatuh ke dua ekstrem:

1. **Treat everything as RDS**  
   Semua problem dimasukkan ke PostgreSQL/MySQL karena familiar.

2. **Treat every AWS service as magic scaling box**  
   DynamoDB, OpenSearch, ElastiCache, DocumentDB, Neptune, Timestream, Redshift dipakai karena terdengar cocok, tapi tanpa paham operational boundary.

Top engineer tidak mulai dari nama service. Mereka mulai dari pertanyaan:

> Workload ini membutuhkan bentuk data, consistency, query, latency, scale, lifecycle, dan failure behavior seperti apa?

AWS sendiri menganjurkan pendekatan purpose-built data store: memilih data store berdasarkan karakteristik data dan access pattern, bukan memaksakan satu database untuk semua kebutuhan. Rujukan resmi: AWS Decision Guide for databases dan AWS Well-Architected Performance Efficiency pillar.  
Reference:

- https://docs.aws.amazon.com/databases-on-aws-how-to-choose/
- https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/perf_data_use_purpose_built_data_store.html

---

## 1. Batasan Part Ini: Apa yang Tidak Akan Diulang

Karena Anda sudah memiliki seri database dan messaging yang cukup luas, part ini **tidak akan mengulang**:

| Topik lama | Tidak diulang di sini | Fokus AWS di part ini |
|---|---|---|
| PostgreSQL/MySQL | indexing, isolation level detail, query planner, normalization | RDS/Aurora operation, Multi-AZ, backup, failover, maintenance, ownership boundary |
| Redis | eviction algorithm, data structure internal, pub/sub detail | ElastiCache/MemoryDB placement, failover, persistence, network, security, cost |
| MongoDB/document DB | document modelling detail | DocumentDB compatibility boundary, migration risk, operational model |
| Elasticsearch/OpenSearch | inverted index, analyzer, scoring, shard internals | Amazon OpenSearch Service operational envelope, domain topology, snapshot, ingestion pattern |
| ClickHouse/OLAP | columnar internals | Redshift/Athena/S3 placement and analytical architecture boundary |
| Kafka/RabbitMQ | broker internals, partitioning theory, consumer group | MSK/Kinesis/SQS/EventBridge dibahas di part lain; di sini hanya data service relation jika relevan |
| Neo4j/graph | graph traversal theory | Neptune operational and fit boundary |
| QuestDB/time-series | time-series modelling deep dive | Timestream fit, retention tier, ingestion/query boundary |

Tujuan part ini adalah membangun **decision framework** untuk managed data di AWS.

---

## 2. Mental Model: Managed Database Bukan Berarti Database Tanpa Operasi

Kalimat “managed database” sering disalahartikan sebagai:

> AWS yang urus semuanya, kita tinggal pakai.

Yang lebih benar:

> AWS mengelola sebagian besar **undifferentiated heavy lifting**, tetapi application team tetap bertanggung jawab atas data model, access pattern, security, capacity, backup policy, migration, observability, dan failure response.

### 2.1 Apa yang Biasanya Dikelola AWS

Tergantung service, AWS dapat mengelola:

- hardware provisioning;
- storage allocation;
- automated backup;
- patching;
- replication primitive;
- failure detection;
- failover mechanism;
- encryption integration;
- monitoring hooks;
- API management;
- scaling primitive;
- maintenance window.

### 2.2 Apa yang Tetap Menjadi Tanggung Jawab Engineer

Application/platform team tetap bertanggung jawab atas:

- memilih service yang sesuai;
- schema/access-pattern design;
- indexing strategy;
- connection management;
- IAM/network exposure;
- backup retention dan restore testing;
- data classification;
- encryption key strategy;
- migration/cutover;
- observability;
- cost control;
- runbook;
- incident response;
- correctness under retry;
- idempotency;
- data lifecycle;
- data deletion/compliance.

Managed database mengurangi beban operasional, tetapi tidak menghapus kebutuhan engineering judgment.

---

## 3. AWS Data Service Landscape

AWS memiliki banyak data service. Cara termudah memahami landscape-nya adalah berdasarkan **workload shape**, bukan nama service.

| Workload shape | AWS service umum | Cocok untuk | Risiko jika salah pakai |
|---|---|---|---|
| Relational OLTP | RDS, Aurora | transaksi, relational integrity, SQL, existing apps | scaling write, connection storm, migration heavy |
| High-scale key-value/document access | DynamoDB | predictable key access, massive scale, serverless operation | query flexibility rendah, hot partition, bad key design |
| Cache/session/hot data | ElastiCache, MemoryDB | low-latency cache, session, rate limit, ephemeral/hot state | stale data, cache stampede, eviction surprise |
| Search/log-style query | OpenSearch Service | full-text search, faceting, log/search workloads | expensive cluster ops, shard/index lifecycle complexity |
| MongoDB-compatible managed document | DocumentDB | MongoDB API-compatible workloads with AWS managed ops | compatibility gaps, migration assumptions |
| Graph relationship traversal | Neptune | highly connected data, relationship queries | overkill if simple join or hierarchy cukup |
| Time-series | Timestream | metrics/events with time dimension and retention tiering | poor fit for arbitrary OLTP queries |
| Analytical warehouse | Redshift | BI, warehouse, large analytical queries | wrong for OLTP, concurrency/cost planning needed |
| Migration/replication | DMS | database migration, CDC, replication | not magic correctness layer; requires validation |
| Ledger/immutability | QLDB historically, ledger patterns | verifiable history use cases | service fit must be validated; often event log + S3/Object Lock may be better |

Reference:

- https://docs.aws.amazon.com/databases-on-aws-how-to-choose/
- https://docs.aws.amazon.com/whitepapers/latest/aws-overview/database.html

---

## 4. The First Principle: Data Store Selection Starts from Access Pattern

Sebelum memilih service, tulis dulu workload statement.

Contoh buruk:

```text
Kita butuh database yang scalable.
```

Contoh baik:

```text
Kita butuh menyimpan case enforcement dengan 5 juta case aktif, 200 juta event historis,
query utama by caseId dan tenantId, update state case secara transactional, search by party name,
auditable history immutable 7 tahun, p95 read < 100 ms untuk case detail,
p95 search < 1 detik, dan restore point objective < 15 menit.
```

Dari statement kedua, terlihat bahwa satu database mungkin tidak cukup:

- transactional case state mungkin cocok di Aurora/RDS;
- immutable audit event bisa masuk S3/Object Lock atau DynamoDB/S3 hybrid;
- search by party name bisa masuk OpenSearch;
- cache case summary bisa pakai ElastiCache;
- analytics/reporting bisa masuk Redshift/Athena;
- workflow state mungkin di Step Functions atau database khusus aplikasi.

### 4.1 Dimensi Pemilihan Data Store

Gunakan dimensi berikut:

1. **Data shape**  
   Relational, key-value, document, graph, time-series, text, object, analytical.

2. **Access pattern**  
   Lookup by key, range query, join, full-text search, aggregation, traversal, scan, analytics.

3. **Consistency requirement**  
   Strong consistency, eventual consistency, read-your-write, monotonic read, transactional boundary.

4. **Write pattern**  
   Append-only, update-in-place, high-cardinality insert, batch load, CDC.

5. **Read pattern**  
   Point read, fanout read, analytical query, faceted search, dashboard, export.

6. **Latency target**  
   Single-digit ms, tens of ms, hundreds of ms, seconds, batch.

7. **Scale dimension**  
   Storage, write TPS, read TPS, connection count, tenants, partitions, index size.

8. **Failure tolerance**  
   Can degrade? Must be strongly correct? Can retry? Can replay?

9. **Lifecycle**  
   Retention, archival, deletion, legal hold, immutable evidence.

10. **Operational ownership**  
   Who patches, tunes, backs up, restores, and pays?

---

## 5. Amazon RDS: Managed Relational Database Control Plane

Amazon RDS is the managed relational database service family for engines such as PostgreSQL, MySQL, MariaDB, Oracle, and SQL Server. In AWS architecture, RDS is not “just a database”; it is a managed control plane around database instance lifecycle, backup, patching, monitoring, replication primitives, and access configuration.

Reference:

- https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html

### 5.1 When RDS Makes Sense

RDS is usually a strong default when your workload needs:

- relational data model;
- SQL queries;
- ACID transactions;
- existing JDBC ecosystem;
- foreign keys/constraints;
- moderate to high OLTP workload;
- mature operational tooling;
- predictable migration from existing relational database;
- human reporting/debugging via SQL;
- regulatory auditability with structured records.

### 5.2 RDS Is Still Not “Infinite Relational Scaling”

RDS helps with management, but does not eliminate relational constraints:

- write scaling remains engine-dependent;
- connection management still matters;
- bad queries still hurt;
- missing indexes still hurt;
- lock contention still hurts;
- schema migration still risky;
- replication lag still matters;
- failover is not invisible to clients;
- storage growth has limits and cost implications.

### 5.3 RDS Operational Concepts

Core RDS concepts:

| Concept | Meaning |
|---|---|
| DB instance | Managed database compute unit |
| DB engine | PostgreSQL/MySQL/etc. |
| DB subnet group | Subnets where database can be placed |
| Parameter group | Engine configuration contract |
| Option group | Engine-specific optional features |
| Automated backup | Point-in-time recovery capability within retention window |
| Manual snapshot | User-controlled backup artifact |
| Maintenance window | Time AWS can apply certain updates |
| Multi-AZ deployment | High availability deployment pattern |
| Read replica | Read scaling / replication target |

### 5.4 Multi-AZ Is Not Read Scaling by Default

For classic RDS Multi-AZ DB instance deployment, standby is primarily for high availability/failover, not application read traffic.

Common misunderstanding:

```text
Multi-AZ berarti read bisa otomatis dibagi ke dua AZ.
```

Better model:

```text
Multi-AZ primarily improves availability by maintaining standby/failover capability.
Read scaling requires read replicas or engine-specific patterns.
```

Reference:

- https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html

### 5.5 Java Application Concerns with RDS

For Java services, RDS issues often appear as runtime behavior:

- too many JDBC connections;
- connection pool not tuned for database capacity;
- connection leak;
- stale DNS after failover;
- transaction too long;
- retry around non-idempotent transaction;
- schema migration causing lock;
- large result set loading into heap;
- N+1 query amplified under traffic;
- missing timeout on JDBC call;
- connection pool fixed too high per pod/task/instance.

A top AWS Java engineer treats database connection count as shared capacity:

```text
Total possible DB connections = service replicas × maxPoolSize × number_of_services
```

If an ECS service scales from 10 tasks to 100 tasks and each has HikariCP max pool 30, the theoretical connections jump from 300 to 3000. RDS may not survive that, even if CPU looks fine.

### 5.6 RDS Proxy

Amazon RDS Proxy can help improve connection pooling and failover handling for certain workloads, especially serverless or highly elastic applications that create many database connections.

But RDS Proxy is not a fix for:

- bad schema;
- bad query;
- missing transaction boundary;
- unbounded ORM behavior;
- database under-sizing;
- write contention.

Reference:

- https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html

---

## 6. Amazon Aurora: AWS-Native Relational Engine Family

Aurora is relational, but it has AWS-native storage and replication architecture. Aurora is compatible with MySQL and PostgreSQL at the API/protocol level, while offering a distinct managed architecture.

Reference:

- https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html

### 6.1 When Aurora Makes Sense

Aurora is often considered when you need:

- relational semantics;
- PostgreSQL/MySQL compatibility;
- higher availability/scalability envelope than standard RDS;
- read replicas with tighter integration;
- serverless capacity option;
- global database option for disaster recovery / low-latency reads;
- managed storage layer benefits.

### 6.2 Aurora Cluster Mental Model

Aurora is cluster-oriented:

- cluster endpoint;
- writer instance;
- reader endpoint;
- Aurora replicas;
- shared distributed storage;
- cluster volume;
- failover priority;
- parameter groups.

This changes how applications connect:

- write traffic should use writer/cluster endpoint;
- read traffic may use reader endpoint;
- failover can change writer;
- application must handle transient connection errors.

### 6.3 Aurora Serverless

Aurora Serverless is attractive for variable workloads, but the engineering question is not “serverless is cheaper.” The real questions:

- What is the scale-up latency?
- What is the minimum/maximum capacity?
- Is workload spiky or steady?
- Are connections long-lived?
- Does the application tolerate capacity transition?
- Is cost predictable?

### 6.4 Aurora Global Database

Aurora Global Database supports cross-region replication patterns, but it does not magically make all writes multi-region strongly consistent. You still need to design:

- primary region;
- read-only secondary region;
- failover process;
- RPO/RTO;
- DNS/app cutover;
- operational runbook;
- data conflict assumptions.

### 6.5 Aurora Failure Modes

Common Aurora failure modes:

- writer failover breaks existing connections;
- application does not distinguish read/write endpoint;
- read replica lag causes stale read;
- overloaded writer due to reporting query;
- unbounded connection pool;
- maintenance event surprises team;
- slow query log disabled;
- backup exists but restore never tested;
- global database assumed to provide active-active writes.

---

## 7. Amazon DynamoDB: Managed Key-Value / Document Database at AWS Scale

DynamoDB is a fully managed NoSQL database service designed for key-value and document data with high scalability. It is not “schemaless relational database.” It rewards access-pattern-first modelling and punishes vague query requirements.

Reference:

- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html

DynamoDB gets a dedicated deep dive in Part 013, so this section only positions it among other AWS data services.

### 7.1 When DynamoDB Makes Sense

DynamoDB is strong when:

- access patterns are known;
- primary queries are by key/range;
- massive scale is required;
- low operational overhead is important;
- serverless/on-demand capacity is desirable;
- item-level access fits the model;
- high availability and managed replication are important;
- conditional writes can express correctness constraints.

Examples:

- session store;
- user profile by userId;
- idempotency key store;
- workflow state by executionId;
- event metadata by aggregateId/time;
- tenant configuration by tenantId;
- rate limiting counters;
- high-volume lookup table.

### 7.2 When DynamoDB Is a Bad Fit

DynamoDB is often a bad fit when:

- query requirements are exploratory;
- arbitrary ad-hoc filtering is required;
- many joins are needed;
- relational constraints are core correctness mechanism;
- access pattern changes often and unpredictably;
- team has no discipline around key design;
- reporting queries are run directly against operational table.

### 7.3 Java Concerns

In Java, DynamoDB integration often involves:

- AWS SDK v2 DynamoDB client;
- DynamoDB Enhanced Client;
- conditional write;
- idempotency token;
- pagination;
- batch write with retry for unprocessed items;
- async client for high-throughput workloads;
- explicit timeout and retry settings;
- careful object mapping.

### 7.4 Common DynamoDB Failure Modes

- hot partition;
- bad partition key cardinality;
- GSI overloading;
- scan in request path;
- uncontrolled item size;
- eventual consistency surprise;
- conditional write not used where needed;
- table used as reporting database;
- on-demand capacity assumed to have no limits;
- stream consumer falls behind.

---

## 8. Amazon ElastiCache and MemoryDB: Cache Is a Data System Too

AWS offers managed in-memory services such as Amazon ElastiCache and Amazon MemoryDB. ElastiCache supports Redis OSS/Valkey and Memcached-style use cases depending on engine. MemoryDB is positioned for durable Redis-compatible in-memory workloads.

Reference:

- https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html
- https://docs.aws.amazon.com/memorydb/latest/devguide/what-is-memorydb-for-redis.html

### 8.1 Cache Is Not Just “Make It Faster”

A cache changes correctness behavior. Before adding cache, answer:

- What is the source of truth?
- What data may be stale?
- How stale is acceptable?
- Who invalidates cache?
- Is cache write-through, write-behind, or cache-aside?
- What happens when cache is down?
- Is cache allowed to lose data?
- What is the eviction policy?
- Is tenant isolation needed?
- Is cache key design stable?

### 8.2 Common ElastiCache Use Cases

- response caching;
- session storage;
- rate limiting;
- distributed lock with caution;
- leaderboards/counters;
- hot lookup data;
- feature/config cache;
- token/introspection cache;
- queue-like structures only when semantics are acceptable.

### 8.3 Cache-Aside Pattern

Typical cache-aside flow:

```text
1. Service receives request.
2. Service reads cache by key.
3. If hit, return cached value.
4. If miss, read source of truth.
5. Store value in cache with TTL.
6. Return response.
```

Failure questions:

- What if cache read times out?
- What if database read succeeds but cache write fails?
- What if many requests miss the same key simultaneously?
- What if stale value causes business rule violation?

### 8.4 Cache Stampede

Cache stampede occurs when many requests miss the same key at the same time and all hit the backend.

Mitigation:

- jittered TTL;
- request coalescing;
- soft TTL/hard TTL;
- background refresh;
- per-key lock with timeout;
- serving stale data where acceptable;
- pre-warming for predictable hot keys.

### 8.5 Java Concerns

Java service concerns:

- Redis client connection pooling;
- timeout lower than request SLA;
- serialization compatibility;
- large object in cache increasing heap/network;
- cache key versioning;
- tenant prefix in key;
- avoiding blocking calls in reactive stack;
- graceful degradation when cache unavailable.

### 8.6 Common Cache Failure Modes

- cache becomes source of truth accidentally;
- no TTL;
- TTL too long;
- stampede;
- eviction breaks application assumption;
- hot key overload;
- cluster failover causes transient errors;
- cache outage brings down core system;
- sensitive data cached without encryption/access policy;
- key collision across tenant/environment.

---

## 9. Amazon OpenSearch Service: Search/Index Store, Not Primary OLTP Database

Amazon OpenSearch Service is a managed service for OpenSearch clusters. It is often used for full-text search, log analytics, faceted search, and operational search interfaces.

Reference:

- https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html

### 9.1 When OpenSearch Makes Sense

OpenSearch is useful when you need:

- full-text search;
- fuzzy matching;
- faceted filtering;
- relevance scoring;
- log/event search;
- document indexing;
- autocomplete/search UI;
- analytical exploration over indexed documents.

Examples:

- search cases by party name, address, officer, keyword;
- audit log search;
- evidence metadata search;
- customer support search;
- product catalog search;
- operational log search.

### 9.2 OpenSearch Should Usually Not Be Source of Truth

OpenSearch indexes are commonly derived from source-of-truth data.

Better model:

```text
Source of truth: RDS/DynamoDB/S3/Event log
Search projection: OpenSearch index
```

This implies:

- index may lag;
- reindexing must be possible;
- projection version must be managed;
- deletion/privacy rules must propagate;
- search result must be validated against authorization and source data if sensitive.

### 9.3 Search Projection Pattern

```text
Application DB write
    -> outbox/event
    -> stream/queue
    -> indexer service
    -> OpenSearch index
```

Important properties:

- event replay capability;
- idempotent index update;
- index schema version;
- dead-letter handling;
- backfill/reindex pipeline;
- authorization model;
- observability on lag.

### 9.4 Common OpenSearch Failure Modes

- using OpenSearch as transactional source of truth;
- no reindex strategy;
- index mapping changed unsafely;
- shard sizing ignored;
- expensive wildcard queries;
- security filtering applied only at UI;
- cluster storage fills up;
- ingestion lag ignored;
- snapshot/restore untested;
- hot index receives all writes.

---

## 10. Amazon DocumentDB: MongoDB-Compatible Managed Document Database

Amazon DocumentDB is a managed document database service with MongoDB compatibility. The crucial phrase is **compatibility**, not identical behavior in every dimension.

Reference:

- https://docs.aws.amazon.com/documentdb/latest/developerguide/what-is.html

### 10.1 When DocumentDB Makes Sense

DocumentDB can make sense when:

- application already uses MongoDB API patterns;
- document model is core;
- AWS-managed operation is desired;
- team wants integration with VPC/IAM/KMS/CloudWatch ecosystem;
- migration from MongoDB-like workload is being evaluated;
- flexible document shape matters more than relational joins.

### 10.2 Compatibility Boundary

Never assume:

```text
MongoDB app can move to DocumentDB without semantic review.
```

A mature migration checks:

- supported MongoDB API version/features;
- query behavior;
- indexes;
- aggregation pipeline compatibility;
- transaction behavior;
- driver compatibility;
- performance characteristics;
- operational differences;
- backup/restore;
- monitoring;
- failover behavior.

### 10.3 Common DocumentDB Failure Modes

- assuming perfect MongoDB equivalence;
- not testing application query corpus;
- indexes not matching real queries;
- document size growth;
- unbounded arrays;
- cross-document consistency assumptions;
- migration validated only by happy path;
- no rollback plan.

---

## 11. Amazon Neptune: Managed Graph Database

Amazon Neptune is a managed graph database service for highly connected data. It supports graph query languages such as Gremlin and SPARQL, and newer graph workloads may also evaluate openCypher support depending on service capabilities and region.

Reference:

- https://docs.aws.amazon.com/neptune/latest/userguide/intro.html

### 11.1 When Neptune Makes Sense

Neptune is useful when the primary complexity is relationship traversal:

- fraud networks;
- entity resolution;
- regulatory relationship graph;
- beneficial ownership;
- case-to-party-to-asset links;
- recommendation graph;
- network topology;
- knowledge graph;
- access relationship modelling.

### 11.2 When Not to Use Graph

Do not use graph just because data has relationships. Relational databases also model relationships.

Graph becomes compelling when:

- traversal depth is variable;
- relationships are first-class;
- query asks “how are these connected?”;
- many-to-many relationship exploration dominates;
- recursive joins become awkward/expensive;
- graph algorithms/traversals are central.

### 11.3 Regulatory Example

For enforcement/case management:

- Party A owns Company B.
- Company B controls Asset C.
- Asset C is linked to Case D.
- Officer E investigated Case D.
- Party A also appears in Case F through another entity.

A graph database can answer:

```text
Show all cases connected to this party within 3 hops through ownership/control relationships.
```

But do not put all case transactional state into Neptune unless graph traversal is core to writes and reads. Often the pattern is:

```text
Case source of truth: Aurora/RDS
Relationship projection: Neptune
Search projection: OpenSearch
Evidence store: S3
```

### 11.4 Common Neptune Failure Modes

- using graph for simple CRUD;
- no graph query expertise;
- graph projection not synchronized;
- treating graph result as authorization source without validation;
- no backfill/rebuild process;
- unbounded traversals;
- query cost surprise.

---

## 12. Amazon Timestream: Time-Series Store

Amazon Timestream is a managed time-series database service for storing and analyzing time-series data.

Reference:

- https://docs.aws.amazon.com/timestream/latest/developerguide/what-is-timestream.html

### 12.1 When Timestream Makes Sense

Timestream fits workloads where data is naturally:

- time-indexed;
- append-heavy;
- metric/event-like;
- queried by time windows;
- retained differently by age;
- aggregated over time.

Examples:

- IoT telemetry;
- application metrics;
- device readings;
- operational time-series;
- compliance event counters;
- SLA/SLO measurements.

### 12.2 Time-Series Questions

Before choosing Timestream, define:

- write rate;
- cardinality;
- dimensions;
- retention period;
- query windows;
- aggregation needs;
- raw vs rollup data;
- late-arriving data behavior;
- deletion/compliance requirement;
- dashboard concurrency.

### 12.3 Common Timestream Failure Modes

- high-cardinality dimensions without planning;
- using it for arbitrary OLTP data;
- no retention policy clarity;
- dashboards scan too much data;
- raw events retained forever unnecessarily;
- late data not handled;
- cost surprises due to query volume.

---

## 13. Amazon Redshift: Managed Data Warehouse

Amazon Redshift is a managed data warehouse service for analytical workloads. It should not be treated as OLTP database.

Reference:

- https://docs.aws.amazon.com/redshift/latest/mgmt/welcome.html

### 13.1 When Redshift Makes Sense

Redshift is suitable when:

- BI/analytics queries dominate;
- data from multiple systems is consolidated;
- large scans/aggregations are common;
- business users need dashboards;
- historical reporting matters;
- operational database should be protected from reporting workload;
- governed warehouse model is needed.

### 13.2 Operational vs Analytical Separation

A production Java system should usually not run heavy reporting directly on OLTP database.

Common pattern:

```text
Operational DB -> CDC/ETL -> S3 data lake -> Redshift/Athena -> BI dashboards
```

Why:

- protects OLTP latency;
- isolates analytical failure;
- enables retention and historical models;
- supports different access control;
- enables cost management;
- allows schema optimized for analytics.

### 13.3 Common Redshift Failure Modes

- used as transactional DB;
- loaded with unmodelled raw data only;
- no data quality checks;
- dashboard queries overload cluster;
- no workload management planning;
- no cost guardrails;
- no lineage;
- PII copied without governance.

---

## 14. AWS Database Migration Service: Migration and CDC Tool, Not Correctness Magic

AWS Database Migration Service helps migrate and replicate databases. It supports many source and target engines, including AWS-managed and self-managed databases.

Reference:

- https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html
- https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Source.html
- https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.Targets.html

### 14.1 Where DMS Helps

DMS can help with:

- homogeneous migration;
- heterogeneous migration;
- initial full load;
- change data capture;
- migration to AWS;
- replication to analytics/search targets;
- phased cutover.

### 14.2 What DMS Does Not Solve Alone

DMS does not automatically solve:

- semantic schema differences;
- application compatibility;
- dual-write consistency;
- data validation completeness;
- latency tolerance;
- rollback design;
- foreign key/application invariants;
- query performance after migration;
- cutover coordination.

### 14.3 Migration Invariants

For any serious data migration, define:

```text
1. Source of truth during migration.
2. Cutover point.
3. Write freeze or dual-write rule.
4. Data validation method.
5. Rollback condition.
6. RPO/RTO during migration.
7. Observability of replication lag.
8. Owner for reconciliation.
```

### 14.4 Common DMS Failure Modes

- assuming full load means validated migration;
- no row count/hash reconciliation;
- CDC lag ignored;
- unsupported data type surprise;
- target indexes not ready;
- application cutover before performance test;
- rollback impossible;
- dual writes diverge.

---

## 15. Data Service Selection Matrix

Use this matrix as first-pass reasoning, not as absolute rule.

| Requirement | Usually consider | Be careful about |
|---|---|---|
| ACID relational transactions | RDS/Aurora | connection scaling, failover handling, query tuning |
| Existing Java Spring/JPA app | RDS/Aurora | ORM query explosion, pool size, migration locks |
| Massive key-based lookup | DynamoDB | access pattern rigidity, partition key design |
| Idempotency store | DynamoDB | TTL, conditional write, item size |
| Cache hot data | ElastiCache | invalidation, stale read, outage degradation |
| Durable Redis-compatible primary-ish in-memory state | MemoryDB | service fit, cost, semantics |
| Full-text search | OpenSearch | reindex strategy, source of truth, security filtering |
| MongoDB-compatible managed docs | DocumentDB | compatibility verification |
| Relationship traversal | Neptune | graph expertise, projection sync |
| Time-series metrics/events | Timestream | cardinality, query scan cost, retention |
| Warehouse analytics | Redshift | not OLTP, data governance |
| Data migration/CDC | DMS | validation and cutover complexity |
| Evidence/file body | S3 | metadata/query elsewhere, lifecycle, object lock |

---

## 16. Composite Data Architecture: Most Real Systems Use Multiple Stores

A common senior-level insight:

> Top systems do not choose one perfect database. They choose one source of truth and derive fit-for-purpose projections.

Example architecture for regulated case management:

```text
Aurora/RDS
  - canonical case state
  - assignments
  - transitions
  - relational constraints

S3 + Object Lock
  - evidence files
  - immutable audit exports
  - generated PDFs

DynamoDB
  - idempotency keys
  - workflow correlation state
  - high-volume lookup/session-like state

OpenSearch
  - searchable case projection
  - party/name/address search
  - audit search projection

ElastiCache
  - hot case summaries
  - authorization decision cache with short TTL
  - rate limiting

Redshift/Athena
  - reporting
  - regulatory dashboards
  - historical analytics

DMS / Event pipeline
  - migration or projection feed
```

The architecture works only if you define:

- source of truth;
- projection ownership;
- replay mechanism;
- synchronization lag;
- deletion propagation;
- authorization boundary;
- observability;
- rebuild strategy.

---

## 17. Source of Truth vs Projection

This distinction prevents many AWS data architecture mistakes.

### 17.1 Source of Truth

A source of truth is the system whose state is authoritative for a business fact.

Properties:

- correctness matters most;
- writes are controlled;
- auditability is strong;
- backup/restore is critical;
- invariants are enforced;
- corruption is severe.

Examples:

- case status;
- payment ledger;
- enforcement action decision;
- user consent;
- tenant contract;
- ownership record.

### 17.2 Projection

A projection is a derived view optimized for a query/use case.

Properties:

- can be rebuilt;
- may lag;
- often denormalized;
- optimized for reads/search/analytics;
- must not silently become authority.

Examples:

- search index;
- reporting table;
- cache;
- dashboard materialization;
- graph projection;
- audit search projection.

### 17.3 The Projection Contract

Every projection should have a contract:

```text
Projection name:
Source:
Transformation:
Expected lag:
Rebuild method:
Deletion propagation:
Security filtering:
Owner:
Failure behavior:
```

Without this, projections become hidden correctness dependencies.

---

## 18. Consistency: Do Not Hide It Behind Service Names

Every AWS data service has consistency semantics. Do not say:

```text
Data is in AWS, so consistency is handled.
```

Ask:

- Is read after write guaranteed?
- Is cross-region replication eventually consistent?
- Is index/search projection eventually consistent?
- Is cache stale allowed?
- Is read replica lag acceptable?
- Is transaction boundary local or distributed?
- What happens after failover?
- Can client retry create duplicate writes?

### 18.1 Common Consistency Patterns

| Pattern | Example | Risk |
|---|---|---|
| Strong source + eventual projection | RDS -> OpenSearch | search lag |
| Source + cache | RDS -> ElastiCache | stale cache |
| Async event projection | DynamoDB Stream -> Lambda -> OpenSearch | retry/ordering lag |
| Multi-region read replica | Aurora Global DB | stale secondary read |
| Eventual NoSQL read | DynamoDB eventually consistent read | read-your-write surprise |

### 18.2 User Journey Lens

Map consistency to user journeys.

Example:

```text
User submits enforcement decision.
System confirms decision committed.
Immediately after, user searches case by keyword.
```

Question:

- Must search show the decision immediately?
- If not, what message do we show?
- If yes, should UI read source-of-truth for just-created case?
- Does search index lag violate regulatory workflow?

Consistency is not just a database concept. It is a user experience and compliance concept.

---

## 19. Backup and Restore: Backup Is Not Real Until Restore Is Tested

AWS managed services usually provide backup/snapshot primitives, but production maturity requires restore testing.

### 19.1 Backup Questions

For each data service:

```text
What is backed up?
How often?
How long retained?
Is backup encrypted?
Who can delete backup?
Can backup be restored cross-account?
Can backup be restored cross-region?
How long does restore take?
How often do we test restore?
What data loss is acceptable?
```

### 19.2 RPO and RTO

- **RPO**: maximum acceptable data loss.
- **RTO**: maximum acceptable recovery time.

Example:

```text
Case transaction database:
RPO <= 5 minutes
RTO <= 30 minutes

Search index:
RPO <= 24 hours if rebuildable
RTO <= 4 hours

Cache:
RPO = 100% loss acceptable
RTO <= 10 minutes degraded mode
```

Different stores deserve different recovery targets.

### 19.3 Backup Anti-Patterns

- backup retention not aligned with compliance;
- no restore test;
- same account can delete production and backup;
- backup encryption key can be deleted by same operator;
- backup exists but application config cannot point to restored DB;
- backup not included in game day;
- snapshots never cleaned up;
- cross-region restore untested.

---

## 20. Security Architecture for AWS Data Services

Data services combine many controls:

- IAM;
- VPC networking;
- security group;
- KMS encryption;
- service-specific resource policy;
- database-native user/auth;
- secrets management;
- audit logging;
- backup access control;
- endpoint policy;
- cross-account access.

### 20.1 Data Classification First

Before service selection, classify data:

| Classification | Example | Security implication |
|---|---|---|
| Public | public catalog | minimal confidentiality |
| Internal | operational metadata | IAM/network controls |
| Confidential | customer data | encryption, least privilege, audit |
| Restricted | PII, investigation records | strict access, logging, retention, legal controls |
| Regulated evidence | enforcement documents | immutability, chain of custody, deletion policy |

### 20.2 Encryption

Encryption has layers:

- in transit;
- at rest;
- backup/snapshot;
- application-level encryption if needed;
- KMS key policy;
- per-tenant key consideration;
- rotation strategy;
- encryption context if supported.

Do not only ask:

```text
Is encryption enabled?
```

Ask:

```text
Who can decrypt?
Who can change the key policy?
Who can restore backup using the key?
Can a compromised app role read all tenant data?
```

### 20.3 Network Exposure

For data services in VPC, common controls:

- private subnets;
- no public accessibility unless explicitly justified;
- security group from app SG to DB SG;
- VPC endpoints for service APIs where appropriate;
- private DNS;
- no direct human access except controlled bastion/SSM/session patterns;
- restricted admin path.

### 20.4 Secrets

Database passwords/API tokens should not be baked into:

- AMI;
- container image;
- environment file committed to Git;
- static config in artifact;
- developer laptop scripts.

Use Secrets Manager or Parameter Store depending on rotation/security needs. Rotation must be tested with application connection pool behavior.

---

## 21. Observability for Data Services

Data service observability must cover:

- availability;
- latency;
- throughput;
- error rate;
- saturation;
- connection count;
- replication lag;
- queue/projection lag;
- storage growth;
- backup status;
- restore status;
- slow queries;
- throttle events;
- cache hit ratio;
- index ingestion errors;
- cost anomalies.

### 21.1 Golden Signals by Store

| Service | Important signals |
|---|---|
| RDS/Aurora | CPU, memory, connections, IOPS, storage, locks, slow query, replica lag, failover events |
| DynamoDB | throttled requests, consumed capacity, hot keys, latency, conditional check failure, stream lag |
| ElastiCache | memory, evictions, CPU, connections, replication lag, cache hit ratio, command latency |
| OpenSearch | cluster health, JVM pressure, storage, indexing latency, search latency, rejected requests |
| DocumentDB | CPU, connections, storage, replica lag, query latency |
| Neptune | CPU, memory, query latency, connections, replica lag |
| Timestream | ingestion errors, query latency, bytes scanned, rejected records |
| Redshift | query queue time, concurrency, disk usage, load errors, WLM metrics |
| DMS | replication lag, table errors, task state, CDC throughput |

### 21.2 Application-Level Observability

CloudWatch metrics alone are not enough. Java app should emit:

- database call latency by operation;
- timeout count;
- retry count;
- pool acquisition time;
- query category;
- cache hit/miss;
- projection lag observed by app;
- idempotency conflict count;
- domain-level invariant violation;
- user journey latency.

---

## 22. Cost Engineering for Data Services

Data services often dominate AWS bill.

Cost drivers include:

- provisioned compute;
- storage;
- backup storage;
- IOPS;
- requests;
- read/write capacity;
- data transfer;
- cross-AZ traffic;
- cross-region replication;
- logs/metrics;
- snapshots retained forever;
- index duplication;
- read replicas;
- NAT Gateway for private data access if path poorly designed.

### 22.1 Unit Cost Thinking

Instead of only monthly bill, calculate:

```text
Cost per case
Cost per tenant
Cost per search
Cost per document stored
Cost per audit event
Cost per 1 million API calls
Cost per GB retained per year
```

This exposes architecture flaws early.

### 22.2 Common Cost Traps

- RDS oversized for peak but idle most of day;
- read replicas created for reporting and never removed;
- OpenSearch index retention too long;
- DynamoDB GSI duplicates large data;
- scans against DynamoDB or Athena too frequent;
- cache cluster oversized without hit ratio benefit;
- snapshots retained indefinitely;
- logs ingested at debug level;
- cross-AZ data transfer from chatty app/database placement;
- NAT Gateway used for AWS service traffic that could use VPC endpoints.

---

## 23. Java Data Access Patterns on AWS

### 23.1 Timeouts Everywhere

Every data call should have explicit timeout behavior.

For Java applications:

- JDBC connection timeout;
- socket timeout;
- query timeout;
- pool acquisition timeout;
- AWS SDK API timeout;
- AWS SDK attempt timeout;
- Redis command timeout;
- OpenSearch request timeout;
- transaction timeout.

No timeout means thread exhaustion under partial failure.

### 23.2 Retry with Idempotency

Retry is dangerous around writes.

Safe retry needs:

- idempotency key;
- conditional write;
- transaction token;
- unique constraint;
- deduplication table;
- retry classification;
- bounded attempts;
- jittered backoff.

Dangerous pattern:

```java
try {
    paymentRepository.insert(payment);
} catch (Exception e) {
    paymentRepository.insert(payment); // duplicate side effect risk
}
```

Better pattern:

```text
Use business idempotency key or unique constraint.
Retry only if final state can be safely determined.
```

### 23.3 Connection Pool Sizing

Pool size is not “bigger is better.”

Sizing inputs:

- database max connections;
- number of service replicas;
- expected concurrent requests;
- query latency;
- transaction duration;
- downstream timeout;
- failover behavior;
- batch jobs sharing database.

Formula guardrail:

```text
sum(all service replicas × max pool per replica) < safe database connection budget
```

### 23.4 ORM Discipline

For Java/JPA/Hibernate:

- know generated SQL;
- avoid lazy loading explosion;
- batch writes carefully;
- use pagination;
- avoid loading huge graphs;
- set transaction boundary deliberately;
- avoid database calls inside loops;
- avoid long transactions around remote calls;
- treat migration scripts as production code.

### 23.5 Async AWS SDK vs Blocking JDBC

For AWS-native services like DynamoDB/S3/SQS, Java SDK async client can improve concurrency. For JDBC relational access, blocking calls and thread pool sizing remain important.

Do not mix reactive application style with blocking database calls without isolation.

---

## 24. Failure Mode Catalog

### 24.1 RDS/Aurora

| Failure | Cause | Mitigation |
|---|---|---|
| Connection exhaustion | too many app replicas/pool size | pool budget, RDS Proxy, autoscaling guardrail |
| Failover error | connections dropped | retry transaction safely, DNS handling, shorter TTL awareness |
| Slow query outage | bad query/index | slow query monitoring, query review, performance test |
| Lock contention | long transaction | transaction timeout, migration discipline |
| Storage full | growth unmanaged | alarms, autoscaling storage, archival |
| Reporting impacts OLTP | dashboard against primary | replica/warehouse/export |

### 24.2 DynamoDB

| Failure | Cause | Mitigation |
|---|---|---|
| Hot partition | poor key distribution | better key design, sharding strategy |
| Throttling | capacity/key issue | backoff, capacity review, adaptive design |
| Expensive scan | bad access pattern | GSI/materialized view/rethink model |
| Duplicate write | retry without idempotency | conditional write/idempotency table |
| Stream lag | consumer failure | DLQ, monitoring, replay |

### 24.3 Cache

| Failure | Cause | Mitigation |
|---|---|---|
| Stampede | simultaneous miss | jitter, coalescing, soft TTL |
| Stale decision | TTL too long | shorter TTL, explicit invalidation |
| Cache outage | app hard dependency | fail open/closed by domain, fallback path |
| Eviction surprise | memory pressure | sizing, eviction metrics, key strategy |

### 24.4 OpenSearch

| Failure | Cause | Mitigation |
|---|---|---|
| Search stale | async projection lag | lag metric, UX message, direct source read for critical path |
| Cluster red/yellow | shard/storage/node issue | capacity planning, alarms, index lifecycle |
| Security leak | index contains unauthorized data | document-level filtering, source validation, tenant index strategy |
| No reindex | mapping change | versioned index and alias swap |

### 24.5 Migration/DMS

| Failure | Cause | Mitigation |
|---|---|---|
| Silent data mismatch | no validation | count/hash/domain reconciliation |
| CDC lag | source write load | lag alarms, cutover criteria |
| Unsupported type | schema mismatch | pre-migration assessment |
| Rollback impossible | no plan | explicit rollback design |

---

## 25. Decision Workflow: How to Choose AWS Data Service

Use this step-by-step process.

### Step 1 — Define Domain Facts

```text
What business facts exist?
Which facts are authoritative?
Which facts are derived?
Which facts require audit history?
Which facts are regulated?
```

### Step 2 — Define Access Patterns

```text
Read by what key?
Write by what command?
Search by what fields?
Aggregate by what dimension?
Export how often?
Who queries it?
```

### Step 3 — Define Correctness Requirements

```text
Can user see stale data?
Can duplicate write happen?
Can event be processed twice?
Can projection lag?
Must transaction update multiple entities atomically?
```

### Step 4 — Define Scale and Latency

```text
Storage size now and in 3 years?
Read/write TPS?
Peak factor?
Tenant count?
p95/p99 target?
Batch/reporting load?
```

### Step 5 — Define Operations

```text
Backup?
Restore?
Failover?
Patch?
Schema migration?
Reindex?
Replay?
Data deletion?
```

### Step 6 — Choose Source of Truth

Pick one primary authority for each business fact.

### Step 7 — Add Projections Only When Needed

Add cache/search/analytics/graph only when access pattern requires it.

### Step 8 — Define Synchronization Contract

For every projection:

```text
Source
Trigger
Lag
Replay
Idempotency
Deletion
Security
Monitoring
```

### Step 9 — Review Failure Modes

Run through failure catalog before implementation.

### Step 10 — Record ADR

Document decision and rejected alternatives.

---

## 26. Example: Enforcement Case Management Data Architecture

### 26.1 Requirements

Assume a regulated case management platform:

- cases have lifecycle states;
- actions require audit trail;
- documents/evidence must be retained;
- users search by party, case number, address, keyword;
- tenant isolation required;
- reports generated monthly;
- some workflows long-running;
- external integrations may retry;
- historical records must be defensible.

### 26.2 Candidate Architecture

```text
Aurora PostgreSQL
  - source of truth for case, parties, assignments, state transitions
  - transaction boundaries
  - relational constraints

S3 with versioning/Object Lock where required
  - evidence objects
  - generated letters/reports
  - immutable export bundles

DynamoDB
  - idempotency keys for external submissions
  - workflow correlation state
  - high-volume integration dedupe

OpenSearch
  - search projection for cases/parties/documents metadata
  - not authoritative

ElastiCache
  - short-lived authz decision cache
  - hot reference data cache

Redshift/Athena
  - reporting/analytics
  - fed by CDC/export pipeline

DMS or event/outbox pipeline
  - migration or projection movement where appropriate
```

### 26.3 Why Not One Database?

Aurora can store most structured data, but:

- full-text search in OLTP DB may degrade core workflow;
- reporting queries can overload transactional system;
- evidence files do not belong in relational table blobs at scale;
- idempotency keys may need high-throughput TTL-based store;
- immutable retention has object-store-specific controls.

### 26.4 Critical Invariants

```text
1. Case state authority is Aurora.
2. OpenSearch never authorizes access alone.
3. Evidence object metadata and object pointer must be transactionally associated with case record.
4. Audit events must be append-only.
5. Search index can be rebuilt from source/event history.
6. Cache miss must not change business correctness.
7. Reporting pipeline must not impact OLTP p95 latency.
8. Restore procedures must be tested before production acceptance.
```

---

## 27. Anti-Patterns

### 27.1 “Put Everything in Aurora”

Symptoms:

- OLTP database runs reports;
- audit logs grow without lifecycle;
- file blobs in database;
- search implemented as slow wildcard SQL;
- cache added only after outage;
- read replicas used as dumping ground.

Correction:

- separate source of truth from projections;
- move files to S3;
- move search to OpenSearch if justified;
- move analytics to warehouse/lake;
- define lifecycle.

### 27.2 “Use DynamoDB Because It Scales”

Symptoms:

- access patterns unknown;
- scans in request path;
- GSIs added reactively;
- relational invariants moved into fragile application code;
- reporting team asks for ad-hoc query.

Correction:

- model access patterns first;
- use DynamoDB for known key-based workloads;
- use relational DB where relational correctness dominates.

### 27.3 “OpenSearch Is Our Database”

Symptoms:

- writes only to OpenSearch;
- no event replay;
- no authoritative source;
- mapping change breaks production;
- security filtering inconsistent.

Correction:

- define source of truth;
- treat OpenSearch as projection;
- implement index rebuild.

### 27.4 “Cache Fixes Performance”

Symptoms:

- stale data bugs;
- cache outage causes total outage;
- no invalidation model;
- keys collide across tenants;
- memory grows unpredictably.

Correction:

- define cache correctness contract;
- use TTL and invalidation intentionally;
- design fallback.

### 27.5 “Backup Exists, So We Are Safe”

Symptoms:

- never restored;
- encryption key policy blocks restore;
- app config cannot target restored DB;
- no RTO measurement;
- no cross-account isolation.

Correction:

- run restore game day;
- measure recovery;
- document process.

---

## 28. Architecture Decision Record Template

Use this template for every major data store decision.

```markdown
# ADR: Data Store for <domain/workload>

## Status
Proposed / Accepted / Deprecated / Superseded

## Context
- Business capability:
- Data classification:
- Source of truth or projection:
- Expected scale:
- Latency target:
- Consistency requirement:
- Retention requirement:
- Compliance requirement:

## Access Patterns
1. 
2. 
3. 

## Decision
We will use <AWS service> for <specific responsibility>.

## Why
- 
- 
- 

## Rejected Alternatives
| Alternative | Why rejected |
|---|---|
| RDS/Aurora | |
| DynamoDB | |
| OpenSearch | |
| ElastiCache | |
| S3 | |

## Operational Model
- Backup:
- Restore:
- Scaling:
- Monitoring:
- Failover:
- Patch/maintenance:
- Access control:
- Encryption:

## Projection Contract
If this is a projection:
- Source:
- Trigger:
- Expected lag:
- Rebuild method:
- Deletion propagation:
- Authorization:

## Failure Modes
- 
- 
- 

## Cost Model
- Main cost drivers:
- Unit cost:
- Guardrails:

## Review Date

```

---

## 29. Production Readiness Checklist

Before putting AWS data service into production:

### Service Fit

- [ ] Access patterns documented.
- [ ] Source of truth identified.
- [ ] Projection contract documented.
- [ ] Consistency requirement explicit.
- [ ] Rejected alternatives recorded.

### Security

- [ ] Data classification complete.
- [ ] Encryption at rest enabled.
- [ ] Encryption in transit enforced where applicable.
- [ ] KMS key policy reviewed.
- [ ] IAM least privilege reviewed.
- [ ] Network exposure reviewed.
- [ ] Secrets stored outside artifacts.
- [ ] Admin access controlled and audited.

### Reliability

- [ ] Backup configured.
- [ ] Restore tested.
- [ ] RPO/RTO documented.
- [ ] Failover behavior tested.
- [ ] Client retry behavior safe.
- [ ] Idempotency implemented for retried writes.
- [ ] Quotas reviewed.

### Observability

- [ ] Service metrics alarmed.
- [ ] Application DB call metrics emitted.
- [ ] Slow query/search metrics available.
- [ ] Replication/projection lag monitored.
- [ ] Storage growth alarmed.
- [ ] Backup failure alarmed.
- [ ] Cost anomaly detection enabled.

### Operations

- [ ] Runbook exists.
- [ ] Schema/index migration procedure exists.
- [ ] Reindex/rebuild procedure exists if projection.
- [ ] Data deletion procedure exists.
- [ ] Maintenance window known.
- [ ] Game day scheduled.

### Cost

- [ ] Unit cost defined.
- [ ] Retention policy defined.
- [ ] Overprovisioning reviewed.
- [ ] Cross-AZ/cross-region cost understood.
- [ ] Snapshot/log retention reviewed.

---

## 30. Exercises

### Exercise 1 — Select Data Stores for Case Management

Given:

- 10 million cases;
- 100 million evidence documents;
- search by party and keyword;
- monthly compliance reports;
- immutable 7-year audit trail;
- p95 case detail < 150 ms;
- p95 search < 1 second;
- tenant isolation required.

Task:

1. Choose source of truth.
2. Choose projection stores.
3. Define projection lag tolerance.
4. Define backup/restore strategy.
5. Define failure mode for each store.

### Exercise 2 — Detect Anti-Pattern

Architecture:

```text
Single Aurora PostgreSQL database stores cases, audit logs, files as bytea,
search uses ILIKE '%keyword%', reports run against production every morning,
ECS service has 80 tasks with Hikari maxPoolSize 40.
```

Questions:

1. What will fail first?
2. What should be moved out?
3. How would you redesign without overengineering?
4. What observability is missing?

### Exercise 3 — Projection Contract

Design an OpenSearch projection for case search:

1. Source table/event.
2. Index document schema.
3. Update trigger.
4. Expected lag.
5. Reindex strategy.
6. Delete propagation.
7. Tenant security.
8. Backfill process.

### Exercise 4 — Java Failure Handling

For each data call below, define timeout, retry, and idempotency behavior:

1. Insert enforcement action.
2. Upload evidence metadata.
3. Write idempotency key.
4. Update search index.
5. Read cached authorization decision.
6. Generate monthly report.

---

## 31. Key Takeaways

1. Managed data service does not remove architecture responsibility.
2. Choose AWS data services from access patterns, not popularity.
3. RDS/Aurora are strong for relational transactional source of truth.
4. DynamoDB is powerful when access patterns are explicit and key-based.
5. ElastiCache improves latency but changes correctness behavior.
6. OpenSearch is usually a projection, not source of truth.
7. DocumentDB requires compatibility validation, not assumption.
8. Neptune is for relationship traversal, not generic CRUD.
9. Timestream is for time-series, not arbitrary OLTP.
10. Redshift is for analytics, not transactional request paths.
11. DMS helps migration/CDC, but validation and cutover remain engineering responsibilities.
12. Every projection needs a rebuild strategy.
13. Every data store needs backup, restore, observability, security, and cost model.
14. Java applications must explicitly handle timeout, retry, connection pool, and idempotency.
15. A production AWS architecture usually combines a source of truth with fit-for-purpose projections.

---

## 32. What Comes Next

Part 012 positioned AWS managed data services at the architecture level.

Next part goes deep into one of the most important AWS-native data services:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-013.md
```

Title:

```text
DynamoDB for System Designers: Partition, Access Pattern, Transaction, Stream, dan Global Table
```

In Part 013, we will cover DynamoDB deeply as a system design primitive: partition key, sort key, GSI, LSI, capacity mode, hot partition, conditional write, transaction, stream, global table, TTL, single-table design, Java Enhanced Client, and production failure modes.

---

## References

Primary AWS references used for this part:

1. AWS Database Decision Guide — https://docs.aws.amazon.com/databases-on-aws-how-to-choose/
2. AWS Database overview — https://docs.aws.amazon.com/whitepapers/latest/aws-overview/database.html
3. AWS Well-Architected Performance Efficiency: purpose-built data stores — https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/perf_data_use_purpose_built_data_store.html
4. Amazon RDS User Guide — https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html
5. RDS Multi-AZ deployments — https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html
6. Amazon RDS Proxy — https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html
7. Amazon Aurora User Guide — https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html
8. Amazon DynamoDB Developer Guide — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html
9. Amazon ElastiCache User Guide — https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html
10. Amazon MemoryDB Developer Guide — https://docs.aws.amazon.com/memorydb/latest/devguide/what-is-memorydb-for-redis.html
11. Amazon OpenSearch Service Developer Guide — https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html
12. Amazon DocumentDB Developer Guide — https://docs.aws.amazon.com/documentdb/latest/developerguide/what-is.html
13. Amazon Neptune User Guide — https://docs.aws.amazon.com/neptune/latest/userguide/intro.html
14. Amazon Timestream Developer Guide — https://docs.aws.amazon.com/timestream/latest/developerguide/what-is-timestream.html
15. Amazon Redshift Management Guide — https://docs.aws.amazon.com/redshift/latest/mgmt/welcome.html
16. AWS Database Migration Service User Guide — https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html
17. AWS DMS sources — https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Source.html
18. AWS DMS targets — https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.Targets.html



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Storage Architecture: S3, EBS, EFS, FSx, dan Object Lifecycle</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-013.md">Part 013 — DynamoDB for System Designers: Partition, Access Pattern, Transaction, Stream, dan Global Table ➡️</a>
</div>
