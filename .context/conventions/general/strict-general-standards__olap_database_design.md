# Strict General Standards: OLAP Database Design

> This document is a mandatory implementation standard for LLM/code agents designing, modifying, reviewing, or generating OLAP/data warehouse/lakehouse/database structures, analytical models, ingestion pipelines, materialized views, and reporting queries.

---

## 1. Purpose

OLAP database design is about producing trustworthy analytical answers from large volumes of historical and current data.

An LLM/code agent MUST treat OLAP design as a semantic modeling problem, not merely a place to copy operational tables.

The goal is to ensure analytical systems are:

- queryable at scale;
- historically correct;
- explicit about grain;
- auditable back to sources;
- cost-aware;
- reproducible;
- safe for evolving business definitions.

---

## 2. Scope

This standard applies to:

- data warehouses;
- lakehouses;
- data marts;
- dimensional models;
- star/snowflake schemas;
- fact and dimension tables;
- slowly changing dimensions;
- aggregation tables;
- materialized views;
- columnar databases;
- analytical SQL;
- batch and streaming ingestion;
- CDC-derived analytical models;
- dashboard/reporting datasets;
- semantic metrics layers.

This standard does not cover operational transactional schema design; use `strict-general-standards__oltp_database_design.md` for OLTP.

---

## 3. Core Principle

> OLAP design MUST optimize for correct, explainable, repeatable analytical answers at scale.

A model that is fast but produces ambiguous metrics is invalid.

A model that is easy to ingest but impossible to interpret is invalid.

A model that copies OLTP tables without defining grain, history, and business meaning is invalid.

---

## 4. Mandatory Language

The terms below are normative:

- **MUST**: required.
- **MUST NOT**: prohibited.
- **SHOULD**: recommended unless there is documented justification.
- **MAY**: optional, but must not violate mandatory rules.

---

## 5. OLAP vs OLTP Boundary

LLM/code agents MUST identify whether a data need is analytical before implementing.

| Dimension       | OLTP                             | OLAP                                     |
| --------------- | -------------------------------- | ---------------------------------------- |
| Main question   | What is the current valid state? | What happened, how much, how often, why? |
| Main shape      | Normalized entities              | Facts, dimensions, wide/columnar records |
| Workload        | small transactional reads/writes | scans, joins, aggregations, time series  |
| Change model    | update current row               | append, snapshot, partition, version     |
| Correctness     | invariant correctness            | metric and historical correctness        |
| Query consumers | application flows                | analysts, dashboards, ML, reporting      |

If a feature asks for dashboards, trends, KPIs, historical comparison, segmentation, forecasting, or regulatory reporting, the LLM SHOULD propose OLAP/read-model design instead of adding heavy reports to OLTP.

---

## 6. Required Analytical Design Inputs

Before designing an OLAP model, the LLM/code agent MUST define:

1. Business question.
2. Metric definitions.
3. Grain of each fact table.
4. Source systems.
5. Source-to-target lineage.
6. Refresh latency requirement.
7. Historical correction behavior.
8. Dimension change behavior.
9. Partitioning strategy.
10. Expected query patterns.
11. Data quality checks.
12. Retention policy.
13. Access/privacy requirements.
14. Cost/performance assumptions.

If unknown, the design MUST state assumptions explicitly.

---

## 7. Grain Rule

Every fact table MUST declare its grain before columns are designed.

The grain is the exact meaning of one row.

Examples:

```text
One row per paid order line item.
One row per case status transition.
One row per API request received by gateway.
One row per account balance snapshot per day.
```

The LLM MUST NOT mix grains in the same fact table.

Bad:

```text
fact_case_activity contains one row for case creation, one row for daily snapshot, and one row for assignment summary.
```

Better:

```text
fact_case_event
fact_case_daily_snapshot
fact_case_assignment_event
```

---

## 8. Fact Table Standards

Fact tables SHOULD represent measurable business processes or events.

Common fact types:

| Fact Type                  | Use Case                                                              |
| -------------------------- | --------------------------------------------------------------------- |
| Transaction fact           | orders, payments, submissions, approvals                              |
| Periodic snapshot fact     | daily balances, monthly inventory, daily case backlog                 |
| Accumulating snapshot fact | lifecycle with milestones, e.g. application processing                |
| Event fact                 | clicks, API requests, state transitions, audit events                 |
| Factless fact              | attendance, eligibility, coverage, occurrence without numeric measure |

Fact tables MUST include:

- declared grain;
- event/effective timestamp;
- load timestamp;
- source reference;
- surrogate or durable business key where appropriate;
- foreign keys to dimensions where applicable;
- additive/semi-additive/non-additive measure classification.

---

## 9. Dimension Table Standards

Dimension tables describe the context of facts.

Dimensions SHOULD be denormalized for analytical usability unless there is a clear reason to snowflake.

Common dimensions:

- date;
- time;
- customer/user;
- product/service;
- organization;
- geography;
- status;
- channel;
- tenant;
- case type;
- policy/rule version.

Dimension tables MUST define:

- business key;
- surrogate key if used;
- current flag where SCD is used;
- effective date range where historical change matters;
- unknown/default member strategy;
- data quality constraints.

---

## 10. Star Schema Default

For curated reporting marts, the default model SHOULD be a star schema:

```text
fact table at the center
+ denormalized dimensions around it
+ clear grain
+ clear metric semantics
```

Snowflake schema MAY be used only when:

- dimension hierarchy is large and reused;
- storage duplication is material;
- governance requires normalized reference dimensions;
- the query engine handles joins efficiently;
- usability cost is accepted.

---

## 11. Slowly Changing Dimensions

The LLM/code agent MUST decide how dimension changes are handled.

| Type   | Meaning                | Example                         |
| ------ | ---------------------- | ------------------------------- |
| Type 0 | never changes          | birth date                      |
| Type 1 | overwrite              | corrected spelling              |
| Type 2 | versioned history      | customer segment changes        |
| Type 3 | limited previous value | previous region                 |
| Type 6 | hybrid                 | current + historical attributes |

SCD Type 2 requires:

- surrogate key;
- business key;
- effective_from;
- effective_to;
- current flag;
- non-overlap rule;
- deterministic lookup from fact timestamp to dimension version.

---

## 12. Time Modeling

OLAP models MUST be explicit about time.

A table may need multiple timestamps:

- event time: when business event happened;
- ingestion time: when platform received data;
- load time: when warehouse stored data;
- processing time: when transformation ran;
- effective time: when the state becomes valid;
- correction time: when historical correction was applied.

The LLM MUST NOT use a vague `created_at` timestamp as the only time semantics for analytics unless that is truly the business event time.

---

## 13. Metric Semantics

Every metric MUST have a definition.

Metric definition SHOULD include:

- name;
- business meaning;
- formula;
- grain;
- filters;
- inclusion/exclusion rules;
- timezone;
- handling of nulls;
- handling of late-arriving data;
- owner;
- validation source.

Bad:

```text
active_users = count(user_id)
```

Better:

```text
monthly_active_users = count distinct user_id with at least one successful login event in calendar month based on Asia/Jakarta business timezone, excluding system users and deleted test tenants.
```

---

## 14. Additivity Rules

Measures MUST be classified.

| Measure Type  | Meaning                                     | Example                   |
| ------------- | ------------------------------------------- | ------------------------- |
| Additive      | can sum across all dimensions               | sales amount              |
| Semi-additive | can sum across some dimensions but not time | account balance           |
| Non-additive  | cannot be summed directly                   | ratio, percentage, median |

Non-additive measures MUST NOT be pre-aggregated incorrectly.

Example:

```text
average of averages is invalid unless weighted correctly.
```

---

## 15. Data Ingestion Standards

Ingestion MUST preserve enough metadata for lineage and debugging.

Required metadata SHOULD include:

- source system;
- source table/topic/file;
- source primary key or event id;
- source timestamp;
- ingestion timestamp;
- batch id or run id;
- schema version;
- checksum/hash where useful;
- retry count/status where relevant.

The ingestion pipeline MUST be idempotent.

Duplicate events/files MUST NOT inflate metrics.

---

## 16. CDC and Event-Derived Analytics

CDC-derived OLAP models MUST handle:

- insert/update/delete events;
- ordering;
- late arrival;
- schema evolution;
- snapshot vs stream reconciliation;
- tombstones/deletes;
- idempotent merge;
- exactly-once or effectively-once semantics;
- replay/backfill.

CDC logs MUST NOT be exposed directly as business analytics unless transformed into a semantic model.

---

## 17. Batch, Streaming, and Lambda/Kappa Choices

The LLM/code agent MUST choose ingestion style based on latency and correctness needs.

| Mode        | Use When                                                   |
| ----------- | ---------------------------------------------------------- |
| Batch       | daily/hourly reporting, stable sources                     |
| Micro-batch | frequent but bounded refresh                               |
| Streaming   | operational analytics, alerting, near-real-time dashboards |
| Hybrid      | historical backfill + real-time tail                       |

Streaming does not remove the need for backfill, replay, idempotency, and reconciliation.

---

## 18. Partitioning Standards

OLAP tables SHOULD be partitioned when it improves:

- pruning;
- retention;
- load management;
- cost control;
- maintenance;
- parallelism.

Partitioning MUST be based on common filters and lifecycle boundaries, usually time.

Bad:

```text
partition by low-cardinality status with unpredictable skew
```

Better:

```text
partition by event_date, cluster/order by tenant_id, case_type, status where query patterns support it
```

Partition size MUST avoid both extremes:

- too many tiny partitions;
- too few huge partitions.

---

## 19. Clustering, Sorting, and Primary Indexes

Columnar OLAP engines often depend on physical ordering or sparse indexes.

The LLM MUST align sort/order/cluster keys with:

- most common filters;
- range scans;
- high-selectivity dimensions;
- time windows;
- join keys;
- tenant boundaries;
- data skipping behavior of the chosen engine.

The LLM MUST NOT copy OLTP index strategy into OLAP systems.

---

## 20. Materialized Views and Aggregates

Materialized views or aggregate tables MAY be used for repeated expensive queries.

They MUST define:

- source tables;
- refresh mode;
- refresh frequency;
- invalidation behavior;
- dependency order;
- late-arriving data handling;
- recomputation strategy;
- ownership;
- validation query.

Materialized views MUST NOT become hidden sources of truth.

---

## 21. Data Quality Standards

Every curated OLAP layer MUST have data quality checks.

Required checks SHOULD include:

- primary/business key uniqueness;
- referential integrity to dimensions;
- not-null checks for required fields;
- accepted value/domain checks;
- timestamp validity;
- row count reconciliation;
- duplicate detection;
- late-arriving data monitoring;
- freshness SLA;
- anomaly detection for critical metrics.

Data quality failures MUST have visible status, not silently produce dashboards.

---

## 22. Layering Standards

A production analytical platform SHOULD separate layers.

Typical model:

```text
raw / bronze      = source-faithful ingestion
clean / silver    = typed, deduplicated, conformed
curated / gold    = business-ready facts, dimensions, marts
semantic layer    = governed metrics and business definitions
```

The LLM MUST NOT place business KPI definitions directly in raw ingestion tables.

---

## 23. Raw Layer Rules

Raw data SHOULD preserve source fidelity.

Raw layer MUST include:

- source metadata;
- ingestion metadata;
- schema version where possible;
- immutable storage where feasible;
- access restrictions for sensitive data.

Raw tables/files SHOULD NOT be manually edited.

---

## 24. Curated Layer Rules

Curated tables MUST be business-readable.

They SHOULD have:

- clear table names;
- declared grain;
- meaningful dimensions;
- stable metric columns;
- documentation;
- data quality checks;
- owner;
- downstream consumers.

---

## 25. Semantic Layer Rules

Metrics that drive decisions MUST live in a governed semantic layer or equivalent documented contract.

The semantic layer MUST prevent:

- duplicated KPI formulas;
- dashboard-specific conflicting definitions;
- inconsistent timezones;
- inconsistent filters;
- unreviewed metric changes.

---

## 26. Historical Corrections

Analytical systems MUST define correction behavior.

Possible strategies:

- restate history;
- preserve original and correction event;
- maintain adjustment fact;
- rebuild affected partitions;
- snapshot corrected view only.

The chosen strategy MUST match regulatory, financial, and reporting expectations.

---

## 27. Deletes, Privacy, and Retention

OLAP models MUST handle deletion semantics explicitly.

Types:

- source hard delete;
- source soft delete;
- legal purge;
- privacy erasure;
- correction/tombstone;
- retention expiration.

Privacy-sensitive data MUST be minimized, masked, tokenized, aggregated, or access-controlled as appropriate.

Backups, raw layers, caches, and derived tables MUST be included in retention/privacy planning.

---

## 28. Query Design Standards

Analytical SQL MUST be designed for clarity and engine efficiency.

Required:

- avoid unbounded exploratory queries in production dashboards;
- filter on partition columns where possible;
- avoid unnecessary `select *`;
- avoid repeated expensive CTEs if engine materialization behavior is harmful;
- avoid cross joins unless intentional;
- pre-aggregate when repeated;
- validate row multiplication after joins;
- use approximate functions only when accepted;
- document timezone and date truncation behavior.

---

## 29. Join Safety

OLAP joins MUST preserve grain.

Before joining, the LLM MUST check:

1. Is this one-to-one, many-to-one, or many-to-many?
2. Will this multiply fact rows?
3. Is the dimension versioned?
4. Is the join using business key or surrogate key?
5. Is the timestamp needed for SCD lookup?
6. Are unknown dimension values handled?

If a join may multiply measures, the query/design MUST be changed.

---

## 30. Cost and Performance

OLAP design MUST be cost-aware.

The LLM SHOULD consider:

- scanned bytes;
- compression;
- partition pruning;
- clustering/sorting;
- materialization;
- concurrency;
- query cache;
- storage lifecycle;
- cold vs hot data;
- refresh frequency;
- dashboard fan-out.

Fast ingestion that causes expensive query scans is not acceptable unless justified.

---

## 31. Access Control

Analytical access MUST follow least privilege.

Required controls MAY include:

- dataset/table permissions;
- column masking;
- row-level security;
- tenant filtering;
- purpose-based access;
- break-glass audit;
- separate raw vs curated access;
- separate analyst vs application service accounts.

Sensitive raw data MUST NOT be broadly accessible just because it is “analytics.”

---

## 32. Observability

OLAP pipelines and databases MUST expose:

- freshness;
- row counts;
- failed runs;
- late data;
- duplicate rate;
- schema drift;
- query latency;
- scanned bytes/cost;
- materialized view refresh status;
- SLA/SLO violations;
- downstream impact.

Dashboards depending on stale or failed datasets SHOULD display freshness status.

---

## 33. Schema Evolution

OLAP schema changes MUST be backward-compatible for downstream consumers where possible.

Safe changes:

- add nullable column;
- add new dimension attribute;
- add new table;
- add new metric version.

Risky changes:

- rename column;
- change metric definition;
- change grain;
- change timestamp semantics;
- change dimension SCD behavior;
- delete column/table;
- change partition key.

Breaking changes require:

- migration plan;
- consumer impact analysis;
- versioning or compatibility view;
- communication;
- validation.

---

## 34. Testing Requirements

OLAP changes require tests for:

- grain correctness;
- metric formula correctness;
- duplicate prevention;
- late-arriving data;
- SCD lookup;
- partition filtering;
- row count reconciliation;
- null handling;
- data type compatibility;
- timezone boundaries;
- source-to-target lineage;
- access controls.

Critical reports SHOULD have golden datasets with expected outputs.

---

## 35. Common Anti-Patterns

The LLM/code agent MUST reject or flag:

1. Copying OLTP schema directly into BI layer.
2. Fact table without declared grain.
3. Mixing multiple grains in one table.
4. Dashboard-specific metric definitions scattered across SQL files.
5. Average of averages.
6. Many-to-many join that multiplies measures.
7. No late-arriving data strategy.
8. No SCD strategy.
9. Raw CDC table exposed as business report.
10. Partitioning by irrelevant column.
11. Too many tiny partitions.
12. No data quality checks.
13. No lineage to source.
14. No freshness visibility.
15. Using OLTP database for heavy dashboards.
16. Sensitive raw data exposed to all analysts.
17. Materialized view treated as hidden source of truth.
18. Metric changes without versioning.
19. Timezone assumptions hidden inside dashboard code.
20. Backfill performed without idempotency.

---

## 36. Design Decision Algorithm

When asked to design or modify OLAP storage, the LLM MUST follow this sequence:

1. Identify business questions.
2. Define metrics.
3. Define grain.
4. Identify source systems and lineage.
5. Choose fact type.
6. Choose dimensions.
7. Define SCD/history behavior.
8. Define time semantics.
9. Define ingestion pattern.
10. Define partition/cluster/order strategy.
11. Define data quality checks.
12. Define access control and privacy.
13. Define refresh/freshness SLA.
14. Define materializations if needed.
15. Define tests and validation.
16. Flag cost and operational risks.

---

## 37. Acceptance Criteria

An OLAP design is acceptable only if:

- each fact table has declared grain;
- each metric has a definition;
- fact and dimension responsibilities are clear;
- history/SCD behavior is explicit;
- partitioning/ordering matches query patterns;
- ingestion is idempotent;
- lineage is traceable;
- data quality checks exist;
- freshness is observable;
- access controls protect sensitive data;
- query costs are considered;
- downstream breaking changes are managed;
- tests validate grain, metrics, and joins.

---

## 38. Enforcement Snippet for LLM/Code Agent

```text
Before producing OLAP database code, define business question, metric semantics, fact grain, source lineage, time semantics, SCD/history behavior, ingestion idempotency, partitioning, data quality checks, access controls, freshness, and query cost. Never expose raw copied OLTP/CDC tables as business analytics without semantic modeling. Never create a fact table without declaring grain. Never allow joins or aggregations that silently multiply or distort measures.
```

---

## 39. References

- Kimball Group: Dimensional Modeling Techniques — https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/
- Kimball Group: Dimensional Modeling Techniques PDF — https://www.kimballgroup.com/wp-content/uploads/2013/08/2013.09-Kimball-Dimensional-Modeling-Techniques11.pdf
- ClickHouse Documentation: MergeTree Table Engine — https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree
- ClickHouse Documentation: Sparse Primary Indexes — https://clickhouse.com/docs/guides/best-practices/sparse-primary-indexes
- BigQuery Documentation: Partitioned Tables — https://cloud.google.com/bigquery/docs/partitioned-tables
- BigQuery Documentation: Clustered Tables — https://cloud.google.com/bigquery/docs/clustered-tables
- Microsoft Fabric / Data Warehouse modeling guidance — https://learn.microsoft.com/fabric/data-warehouse/dimensional-modeling-overview
- dbt Documentation: Testing and documentation concepts — https://docs.getdbt.com/docs/build/data-tests
