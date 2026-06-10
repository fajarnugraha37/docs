# Strict General Standards: Kafka Connect

## 1. Purpose

This standard defines mandatory rules for designing, configuring, deploying, and reviewing Kafka Connect usage in systems generated, modified, or reviewed by an LLM/code agent.

Kafka Connect MUST be treated as an integration runtime for moving data between Kafka and external systems. It MUST NOT be treated as an application framework, business workflow engine, custom ETL dumping ground, or hidden place for domain logic.

## 2. Scope

This standard applies to:

- Kafka Connect workers.
- Source connectors.
- Sink connectors.
- Kafka Connect REST API usage.
- Connector plugins.
- Single Message Transformations (SMTs).
- Converters and serialization.
- Kafka Connect internal topics.
- Connector CI/CD and operations.
- Debezium running on Kafka Connect.

## 3. Non-negotiable principles

1. **Connect is infrastructure-as-code**  
   Worker and connector configs MUST be versioned, reviewed, tested, and deployed through a controlled process.

2. **Connect is not business logic**  
   Connectors and SMTs MUST not encode complex domain decisions.

3. **Distributed mode is the production default**  
   Standalone mode is allowed for local development, tests, or one-off tooling only.

4. **Serialization is a contract**  
   Converters, schemas, and subject naming MUST be deliberate and documented.

5. **Offsets are production state**  
   Offset storage, reset, migration, and deletion MUST be treated as high-risk operational actions.

6. **At-least-once must be assumed**  
   Downstream systems and sink connectors MUST tolerate duplicates unless a narrower guarantee is proven and documented.

7. **Internal topics are critical infrastructure**  
   Config, offset, and status topics MUST be durable, replicated, ACL-protected, and monitored.

8. **Connector failure must be visible**  
   Task failures, stuck tasks, DLQ growth, lag, retries, and rebalance loops MUST trigger alerts.

## 4. Required design questions before implementation

Before generating Kafka Connect configuration, the LLM MUST answer:

- Is this a source or sink connector?
- What data system is integrated?
- Who owns the connector?
- What topics are read or written?
- What is the serialization/converter contract?
- What schema registry or schema governance is used?
- What is the offset strategy?
- What delivery guarantee is expected?
- What retry/DLQ behavior is configured?
- What secrets are required and where are they stored?
- What resources are required?
- How is the connector deployed, upgraded, paused, resumed, and rolled back?
- How are task failures detected?
- What happens during Kafka Connect worker rebalance?

If these are unknown, the LLM MUST produce a draft with TODOs and risk markers, not a production claim.

## 5. Connector classification

### 5.1 Source connector

A source connector moves data from an external system into Kafka.

Mandatory concerns:

- source consistency model
- snapshot/bootstrap behavior
- offset storage
- source-side permissions
- source-side load impact
- key selection
- topic naming
- schema evolution
- duplicate/replay behavior

Examples:

- Debezium PostgreSQL source connector
- JDBC source connector
- file/log source connector
- metrics source connector

### 5.2 Sink connector

A sink connector moves Kafka records into an external system.

Mandatory concerns:

- idempotent writes
- upsert vs append behavior
- delete/tombstone behavior
- error/DLQ behavior
- offset commit timing
- batching
- external system backpressure
- exactly-once claim validation
- retry side effects

Examples:

- Elasticsearch/OpenSearch sink
- JDBC sink
- S3 sink
- object storage sink
- search index sink

## 6. Worker mode rules

### 6.1 Standalone mode

Allowed only for:

- local development
- unit/integration testing
- isolated proof-of-concept
- temporary one-off migration with explicit risk acceptance

Forbidden for:

- production shared pipelines
- critical CDC
- multi-connector shared platform
- high availability requirements

### 6.2 Distributed mode

Production Kafka Connect MUST use distributed mode unless explicitly justified.

Required:

- stable `group.id`
- replicated internal topics
- durable offset storage
- status/config topic protection
- worker identity and scaling plan
- plugin version consistency across workers
- rolling restart process
- metrics and health checks

## 7. Internal topic standards

Kafka Connect internal topics MUST be explicitly configured and managed.

Required topics:

- config topic
- offset topic
- status topic

Rules:

1. Internal topics MUST NOT use broker auto-create defaults in production.
2. Replication factor MUST match production durability requirements.
3. Partitions MUST be chosen intentionally, especially for offset topic.
4. Cleanup policy MUST follow Kafka Connect requirements.
5. ACLs MUST restrict access.
6. Backups/retention expectations MUST be documented.
7. Topic deletion or reset MUST require an operational runbook.

## 8. Connector configuration standards

Every connector config MUST include:

- connector name
- connector class
- tasks max
- topic list or topic regex
- converter settings
- key/value schema handling
- error handling
- retry/DLQ behavior
- secret references
- ownership metadata
- environment metadata
- observability labels/tags where supported

Example metadata block as comments or external manifest:

```yaml
owner: platform-data
purpose: sync application events to search index
criticality: high
source_topics:
  - event.licensing.application.lifecycle
sink_system: opensearch
replay_safe: true
idempotency_strategy: document_id = event.aggregate_id + event.version
pii_classification: internal-confidential
rollback_plan: pause connector, restore previous config, replay from committed offsets if safe
```

## 9. Naming standards

Connector names MUST be stable, descriptive, and environment-safe.

Recommended pattern:

```text
<env>.<direction>.<domain>.<source-or-sink>.<purpose>
```

Examples:

```text
prod.source.licensing.postgres.cdc
prod.sink.licensing.opensearch.application-readmodel
prod.sink.audit.s3.raw-events
```

Rules:

- Do not include random build IDs in connector names.
- Do not rename connectors casually because offsets/status/config identity may be affected.
- Environment names MUST be consistent.
- Direction MUST be obvious: `source` or `sink`.

## 10. Converter and schema standards

Converters define the serialization contract between Kafka Connect and Kafka topics.

Rules:

1. Production connectors MUST not use converter defaults without review.
2. Key and value converter MUST be explicitly configured.
3. JSON without schema is allowed only for non-critical or explicitly schema-less data flows.
4. Avro/Protobuf/JSON Schema with Schema Registry SHOULD be used for governed contracts.
5. Schema evolution compatibility mode MUST be defined.
6. Decimal, timestamp, date, binary, and nullable values MUST be tested.
7. Sink connector expectations MUST match topic serialization.
8. Do not mix incompatible converters across connectors that share topics.

## 11. SMT standards

Single Message Transformations are allowed for lightweight message shape changes.

Allowed:

- field extraction
- field masking
- topic routing
- header insertion
- flattening simple structures
- Debezium outbox event routing
- key construction

Forbidden:

- authorization decisions
- complex business rules
- multi-record joins
- long-running enrichment
- external HTTP/database calls
- side effects
- data quality repair that belongs in upstream/downstream code

Rule:

```text
If the transformation needs tests resembling business logic tests, do not put it in SMT.
```

## 12. Error handling standards

Connector error handling MUST be explicit.

Required decisions:

- fail-fast vs tolerate errors
- max retries
- retry backoff
- DLQ topic name
- DLQ context headers
- logging level
- owner of DLQ remediation
- reprocessing process

Rules:

1. Critical CDC/source pipelines SHOULD fail fast rather than silently skip records.
2. Sink connectors writing to non-critical projections MAY use DLQ if reprocessing is safe.
3. DLQ records MUST be monitored.
4. DLQ topics MUST have retention and ACL policy.
5. Sensitive payloads in DLQ MUST be redacted or access-controlled.
6. `errors.tolerance=all` MUST NOT be used without DLQ and alerting.

## 13. Offset management standards

Offsets are production state.

Rules:

- Offset reset/delete MUST require an explicit runbook.
- Connector rename MUST be evaluated for offset impact.
- Source connector bootstrap/snapshot MUST not be restarted accidentally.
- Sink connector replay MUST be idempotent or explicitly append-safe.
- Offset lag MUST be monitored.
- Offset migration MUST be tested in lower environment.

Forbidden:

```text
Delete Connect offset topic to fix connector issue.
```

Required:

- Diagnose root cause.
- Pause connector if needed.
- Assess duplicate/replay impact.
- Execute controlled recovery.

## 14. Task parallelism standards

`tasks.max` MUST be chosen based on connector semantics.

Rules:

1. Increasing tasks does not always increase throughput.
2. Source connector task behavior depends on connector implementation.
3. Sink connector tasks may affect ordering and destination write concurrency.
4. Parallelism MUST respect partitioning, ordering, external API limits, and DB connection limits.
5. Resource requests/limits MUST reflect task count.
6. Scaling MUST be tested with representative data volume.

## 15. Source connector standards

Source connector design MUST include:

- source permission model
- source load model
- snapshot/bootstrap behavior
- offset behavior
- topic mapping
- key mapping
- schema evolution
- duplicate behavior
- source-side retention risk
- backpressure risk

For database CDC, use the Debezium standard.

For polling/JDBC source connectors:

- incrementing/timestamp column strategy MUST be correct
- late updates MUST be handled
- timezone semantics MUST be explicit
- deletes are usually not captured unless specifically supported
- polling interval MUST not overload source DB

## 16. Sink connector standards

Sink connector design MUST include:

- target write semantics
- idempotency/upsert key
- delete/tombstone behavior
- batching
- retry behavior
- DLQ behavior
- schema compatibility
- target capacity limits
- replay safety
- transactional behavior, if any

Rules:

1. Sink side effects MUST be idempotent.
2. External target limits MUST be respected.
3. Retrying non-idempotent writes is forbidden unless protected by unique keys or dedupe.
4. Tombstone handling MUST be tested.
5. Sink connector must not be used for complex workflow orchestration.

## 17. Security standards

Kafka Connect security MUST cover worker, Kafka, source, sink, and REST API.

Rules:

- Protect Kafka Connect REST API.
- Do not expose Connect REST API publicly.
- Use TLS/SASL/ACLs for Kafka where required.
- Use least-privilege credentials for source/sink systems.
- Store secrets in secret manager or externalized secret provider.
- Do not put secrets in connector config in Git.
- Restrict plugin installation path.
- Verify connector plugin provenance.
- Scan connector images/plugins for vulnerabilities.
- Redact credentials from logs.

## 18. Plugin governance standards

Connector plugins are supply-chain dependencies.

Rules:

1. Plugin versions MUST be pinned.
2. Plugin source MUST be trusted.
3. Plugin artifacts MUST be scanned.
4. Plugin changelog/breaking changes MUST be reviewed before upgrade.
5. All workers in a Connect cluster MUST have compatible plugin versions.
6. Plugin installation MUST be reproducible.
7. Custom connectors MUST have tests, metrics, and backward-compatible config handling.

## 19. Observability requirements

Every production Kafka Connect deployment MUST expose:

- worker health
- connector status
- task status
- task failure reason
- restart count
- record read/write rates
- error count
- DLQ count
- source lag
- sink lag/backlog
- offset commit rate
- batch size
- retry rate
- rebalance count/duration
- JVM/container metrics
- external system latency/error rates

Dashboards MUST include:

- Connect cluster overview.
- Connector health by owner/domain.
- Task failure and restart panel.
- Lag and throughput panel.
- DLQ/error panel.
- External dependency health panel.

## 20. Deployment standards

Rules:

1. Worker image MUST be built reproducibly.
2. Connector configs MUST be deployed declaratively where possible.
3. Config drift MUST be detectable.
4. Connector creation/update/delete MUST be auditable.
5. Production changes MUST pass validation in lower environment.
6. Rollback MUST be planned.
7. Pausing/resuming connectors MUST be operationally documented.
8. Disaster recovery MUST define how internal topics and configs are restored.

## 21. Kubernetes-specific rules

When running Kafka Connect on Kubernetes:

- Use stable workload identity.
- Configure readiness/liveness carefully; do not restart healthy but busy workers unnecessarily.
- Use PodDisruptionBudget for production clusters.
- Use resource requests/limits.
- Mount plugins read-only where possible.
- Use Kubernetes Secrets or external secret manager.
- Avoid local disk dependence for production state.
- Ensure rolling upgrade does not remove all workers at once.
- Use network policies to restrict source/sink/Kafka access.

## 22. Testing requirements

LLM-generated connector work MUST include or request tests for:

- config syntax validation
- converter compatibility
- SMT output shape
- source/sink connectivity
- task restart
- worker rebalance
- duplicate/replay behavior
- sink idempotency
- DLQ handling
- secret resolution
- schema evolution
- large record behavior
- tombstone/delete handling
- backpressure behavior

## 23. Common anti-patterns

### 23.1 Business logic in Connect

Bad:

```text
Connector SMT transforms event based on business state and decides whether workflow should continue.
```

Required:

- Move business logic into service, Kafka Streams, Flink, or ksqlDB if suitable.

### 23.2 Connect REST API exposed publicly

Bad:

```text
Expose Kafka Connect REST API through public ingress for convenience.
```

Required:

- Restrict to internal network/admin plane.
- Authenticate and authorize access.

### 23.3 Unpinned plugins

Bad:

```text
Download latest connector plugin during image build.
```

Required:

- Pin version and verify artifact.

### 23.4 `errors.tolerance=all` without DLQ

Bad:

```properties
errors.tolerance=all
```

Required:

- DLQ topic.
- error context.
- alerting.
- remediation owner.

### 23.5 Non-idempotent sink

Bad:

```text
Sink connector appends duplicate rows whenever Kafka records are replayed.
```

Required:

- Upsert key.
- unique constraint.
- deterministic document ID.
- dedupe table.

## 24. LLM implementation checklist

Before finalizing Kafka Connect work, the LLM MUST verify:

- [ ] Source vs sink connector is classified.
- [ ] Connector owner and purpose are stated.
- [ ] Worker mode is appropriate.
- [ ] Internal topics are explicitly configured.
- [ ] Converter/schema strategy is explicit.
- [ ] SMTs are simple and documented.
- [ ] Offset behavior is understood.
- [ ] Error/DLQ behavior is explicit.
- [ ] Secrets are externalized.
- [ ] Plugin versions are pinned.
- [ ] Sink idempotency is proven.
- [ ] Observability is defined.
- [ ] Rollback/recovery is documented.

## 25. Enforcement snippet for LLM/code agent

```text
When implementing Kafka Connect:
1. Classify the connector as source or sink.
2. Treat worker and connector configuration as production code.
3. Use distributed mode for production unless explicitly justified.
4. Explicitly configure converters, internal topics, error handling, DLQ, and secrets.
5. Never put complex business logic in SMTs or connector configs.
6. Make sink writes idempotent or explicitly append-safe.
7. Protect Kafka Connect REST API and connector credentials.
8. Monitor task status, lag, errors, DLQ, and rebalance behavior.
9. If offset/replay impact is unknown, stop and mark the design as incomplete.
```

## 26. Acceptance criteria

A Kafka Connect design or implementation is acceptable only if:

- It has clear ownership.
- It separates integration concerns from business logic.
- It uses explicit converter/schema/error/offset strategy.
- It is secure by default.
- It is observable.
- It is replay-safe.
- It has a recovery runbook.

## 27. References

- Apache Kafka documentation.
- Kafka Connect documentation.
- Confluent Kafka Connect documentation.
- Debezium documentation.
- Internal standards: `strict-general-standards__kafka.md`, `strict-general-standards__debenzium.md`, `strict-general-standards__event_design.md`, `strict-general-standards__security_design.md`.
