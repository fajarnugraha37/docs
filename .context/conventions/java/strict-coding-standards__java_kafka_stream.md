# Strict Coding Standards — Java Kafka Streams

**Status:** Mandatory for LLM-generated Java code that uses Kafka Streams.

**Applies to:** Java services using `org.apache.kafka:kafka-streams`, Kafka Streams DSL, Processor API, state stores, joins, windows, repartition topics, changelog topics, exactly-once stream processing, and interactive queries.

**Related standards:**

- `strict-coding-standards__java_kafka.md`
- `strict-coding-standards__java_concurrency.md`
- `strict-coding-standards__java_data_structure.md`
- `strict-coding-standards__java_time_date.md`
- `strict-coding-standards__java_telemetry.md`
- `strict-coding-standards__java_testing.md`
- `strict-coding-standards__java_benchmarking.md`

---

## 1. Purpose

Kafka Streams code is not allowed to be written as an anonymous chain of `map`, `filter`, and `groupBy` calls.

A Kafka Streams application is a distributed stateful processing system. Every topology must define:

1. input topics,
2. output topics,
3. key model,
4. repartition behavior,
5. state stores,
6. changelog topics,
7. window semantics,
8. timestamp semantics,
9. processing guarantee,
10. restore/rebalance behavior,
11. operational metrics,
12. failure and DLQ strategy.

LLM-generated code must optimize for determinism, state correctness, and operability before compactness.

---

## 2. Baseline Rules

### 2.1 Dependency and Version Governance

**MUST**:

- Pin `kafka-streams` version through dependency management.
- Align `kafka-streams`, `kafka-clients`, SerDes, and framework integration versions.
- Verify broker compatibility before using newer Streams features.
- Keep state-store format and schema migration in release notes.

**MUST NOT**:

- Mix different Kafka client/Streams versions through transitive dependencies.
- Upgrade Kafka Streams to fix syntax without migration testing.
- Use unreleased or milestone APIs in production standards without explicit approval.

### 2.2 Streams Is Not a General Threading Framework

**MUST NOT**:

- Create unmanaged threads inside processors.
- Perform long blocking network/database calls inside stream processing without explicit isolation.
- Use shared mutable static state for topology logic.
- Treat processor instances as singleton services.

Kafka Streams owns task/thread assignment and rebalancing.

---

## 3. Topology Design Contract

Every topology must include:

```md
Kafka Streams Topology Design Note
- Application ID:
- Input topics:
- Output topics:
- Internal topics expected:
- Source key model:
- Output key model:
- Repartition points:
- State stores:
- Changelog topics:
- Window/timestamp policy:
- Processing guarantee:
- SerDes:
- Error handling:
- DLQ/quarantine behavior:
- Scaling model:
- Restore/rebalance expectation:
- Observability:
```

A topology without this note is incomplete.

---

## 4. Application ID Rules

`application.id` is a durable identity.

**MUST**:

- Use stable `application.id` per logical topology.
- Treat changing `application.id` as creating a new consumer group and new internal topic namespace.
- Document migration steps if `application.id` changes.

**MUST NOT**:

- Generate `application.id` dynamically.
- Include environment-random suffixes in production.
- Reuse the same `application.id` for incompatible topologies.

Correct:

```properties
application.id=case-risk-score-v1
```

Forbidden:

```java
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "app-" + UUID.randomUUID());
```

---

## 5. Topic and Internal Topic Rules

### 5.1 Input and Output Topics

All topics must follow `strict-coding-standards__java_kafka.md`.

Additionally, Streams topologies must define:

- source topic partition counts,
- output topic partition counts,
- repartition topic expectations,
- changelog topic retention/compaction expectations,
- schema compatibility for state and output topics.

### 5.2 Internal Topics

Kafka Streams may create internal repartition and changelog topics.

**MUST**:

- Know which operators create internal topics.
- Give state stores explicit names to make internal topics predictable.
- Review ACLs for internal topics.
- Review retention/compaction of changelog topics.

**MUST NOT**:

- Allow random generated store names in production topology when state/changelog operability matters.
- Delete internal topics without understanding state restore impact.

---

## 6. SerDe Rules

### 6.1 Explicit SerDes

**MUST** configure and pass explicit SerDes for keys and values.

Allowed:

```java
Consumed.with(caseIdSerde, caseEventSerde)
Produced.with(caseIdSerde, riskScoreSerde)
Grouped.with(caseIdSerde, caseEventSerde)
Materialized.<String, RiskState, KeyValueStore<Bytes, byte[]>>as("risk-state-store")
        .withKeySerde(Serdes.String())
        .withValueSerde(riskStateSerde)
```

Forbidden:

```java
builder.stream("case-events");
```

unless defaults are centrally configured and tested.

### 6.2 SerDe Compatibility

**MUST**:

- Version state-store value schemas.
- Test old state/changelog data if upgrading SerDe format.
- Avoid Java native serialization.
- Use deterministic serialization for keys.

**MUST NOT** change key SerDe casually; it changes partitioning and state-store lookup behavior.

---

## 7. Key Model and Repartition Rules

### 7.1 Key Is Part of Topology Correctness

Every stateful operation must define the key it uses.

Stateful operations include:

- `groupBy`,
- `groupByKey`,
- `aggregate`,
- `count`,
- `reduce`,
- joins,
- windows,
- state store access,
- foreign-key lookup patterns.

### 7.2 Repartition Awareness

Operators such as `groupBy` may cause repartitioning.

**MUST**:

- Identify repartition points in the topology design note.
- Name repartition topics where API allows.
- Validate partition count and key distribution.
- Test that downstream stateful operations receive correct keys.

**MUST NOT**:

- Use `groupBy` when `groupByKey` is enough.
- Change keys casually before joins/aggregations.
- Ignore skewed keys.

### 7.3 Null Key Policy

Null keys are forbidden for stateful topology unless explicitly filtered or handled.

Correct:

```java
stream.filter((key, value) -> key != null)
      .groupByKey(...);
```

Better: fix the producer key contract.

---

## 8. DSL Usage Rules

### 8.1 DSL Preferred by Default

Prefer Kafka Streams DSL for standard operations:

- filtering,
- mapping,
- grouping,
- aggregating,
- joining,
- windowing,
- branching,
- materialization.

Processor API is restricted to cases where DSL cannot express the logic cleanly.

### 8.2 Lambda Rules

All lambdas passed to topology operations must be:

- deterministic,
- side-effect-free unless explicitly documented,
- non-blocking,
- not dependent on wall-clock time unless timestamp policy says so,
- not dependent on mutable external state.

Forbidden:

```java
stream.mapValues(value -> externalHttpClient.call(value));
```

unless explicitly isolated and timeout/retry/backpressure semantics are documented.

### 8.3 Branching

For branching workflows:

**MUST** use named predicates or documented route logic.

Avoid unreadable predicate chains.

Correct:

```java
Predicate<String, CaseEvent> approved = (key, event) -> event.status() == APPROVED;
Predicate<String, CaseEvent> rejected = (key, event) -> event.status() == REJECTED;
```

---

## 9. Processor API Rules

Processor API is powerful and dangerous.

Allowed when:

- custom state-store interaction is needed,
- punctuation is needed,
- DSL cannot express the topology clearly,
- low-level metadata access is required.

**MUST**:

- Implement `init`, `process`, and `close` correctly.
- Acquire state stores in `init`.
- Release resources in `close`.
- Assume processor instances may be reused/reinitialized by Kafka Streams.
- Avoid unmanaged threads.
- Avoid blocking calls.

**MUST NOT**:

- Store `ProcessorContext` in global static variables.
- Call external systems without timeout/circuit-breaker design.
- Mutate shared state across tasks.

---

## 10. State Store Rules

### 10.1 Store Naming

Every materialized state store must have an explicit stable name.

Correct:

```java
Materialized.<String, RiskState, KeyValueStore<Bytes, byte[]>>as("case-risk-state-v1")
```

Forbidden:

```java
Materialized.with(keySerde, valueSerde)
```

when the store is operationally important.

### 10.2 State Model

State-store values must be:

- versioned,
- serializable with approved SerDe,
- backward compatible or migratable,
- bounded in size,
- deterministic from input stream where possible.

**MUST NOT** store:

- arbitrary Java objects,
- framework proxies,
- secrets,
- unbounded lists,
- large payload history without retention design.

### 10.3 Changelog and Recovery

For persistent stores:

**MUST**:

- Understand changelog topic creation.
- Ensure ACLs allow changelog topics.
- Plan restore time under expected state size.
- Consider standby replicas for critical stateful applications.
- Monitor restore/rebalance duration.

**MUST NOT** assume local RocksDB/state directory is the source of truth.

Kafka changelogs are the durable recovery mechanism.

### 10.4 State Directory

**MUST**:

- Set state directory intentionally in container/Kubernetes deployments.
- Ensure disk capacity and I/O are monitored.
- Decide whether local state survives restarts.
- Avoid sharing state directory between incompatible app versions.

---

## 11. Windowing and Time Rules

### 11.1 Timestamp Policy

Every windowed topology must define timestamp semantics:

- event time,
- ingestion time,
- processing time,
- custom timestamp extractor.

**MUST NOT** use processing time accidentally for event-time business logic.

### 11.2 Window Configuration

Every window must define:

- window size,
- grace period,
- retention,
- late event behavior,
- suppression behavior if used,
- output semantics.

Correct design note:

```text
Window: tumbling 5 minutes
Timestamp: event.occurredAt
Grace: 2 minutes
Late events after grace: dropped + metric
Output: final result after window close
```

### 11.3 Late and Out-of-Order Events

**MUST** define behavior for out-of-order events.

Allowed policies:

- accept within grace,
- drop and metric,
- route to late-events topic,
- recompute and emit correction event,
- quarantine.

**MUST NOT** silently ignore late events without metrics.

---

## 12. Join Rules

### 12.1 Join Preconditions

Before any join, document:

- key on left side,
- key on right side,
- partition/co-partition requirement,
- window if stream-stream join,
- table freshness if stream-table join,
- null/missing-side behavior,
- duplicate behavior.

### 12.2 KStream-KStream Joins

**MUST** define:

- join window,
- grace,
- timestamp semantics,
- out-of-order behavior.

**MUST NOT** assume two streams join globally unless keys and partitions align.

### 12.3 KStream-KTable Joins

**MUST** define:

- table topic compaction,
- tombstone semantics,
- bootstrap/rebuild behavior,
- missing reference behavior.

### 12.4 GlobalKTable

`GlobalKTable` is restricted.

Allowed only when:

- reference data is small enough for every instance,
- replication to all instances is acceptable,
- startup/restore cost is acceptable,
- memory/disk impact is measured.

---

## 13. Processing Guarantee Rules

### 13.1 Default Guarantee

Default is `at_least_once` unless the design requires `exactly_once_v2`.

**MUST** explicitly set processing guarantee.

```properties
processing.guarantee=at_least_once
```

or

```properties
processing.guarantee=exactly_once_v2
```

### 13.2 Exactly-Once v2

Use `exactly_once_v2` when:

- state-store updates and output records must be transactionally consistent,
- duplicate output is unacceptable,
- the performance/latency cost is accepted,
- consumer isolation expectations are defined.

**MUST NOT** claim end-to-end exactly-once for external side effects.

Kafka Streams EOS covers Kafka read-process-write and materialized state managed by Streams. External systems still require idempotency or transaction coordination.

---

## 14. Error Handling Rules

### 14.1 Deserialization Errors

**MUST** configure deserialization exception handling.

Policies:

- fail application for critical data,
- continue and route/quarantine through framework support,
- custom handler with metrics and DLQ strategy.

**MUST NOT** silently skip corrupt records without metrics and audit trail.

### 14.2 Processing Errors

For logic errors inside topology:

**MUST** classify:

- validation error,
- poison message,
- schema error,
- transient infrastructure failure,
- bug/invariant violation.

**MUST NOT** wrap all exceptions into `RuntimeException` with no context.

### 14.3 Production Errors

Output production failures must be observed through Streams uncaught exception handler, production exception handling config, metrics, and alerts.

---

## 15. External I/O Rules

Kafka Streams topology logic should not call external systems by default.

Restricted:

- HTTP call in `mapValues`,
- database call in processor,
- remote cache call during aggregation,
- RPC call during join.

Allowed only with:

- timeout,
- bounded concurrency,
- circuit breaker,
- retry policy,
- backpressure policy,
- idempotency,
- metrics,
- clear reason why enrichment cannot be modeled as stream-table join.

Preferred design:

- ingest reference data as KTable,
- materialize local state store,
- perform local join/enrichment.

---

## 16. Deployment and Scaling Rules

### 16.1 Parallelism Model

Kafka Streams parallelism is bounded by input topic partitions and task assignment.

**MUST**:

- Match partition count to expected scale.
- Avoid running more active instances than useful partitions unless standby/failover capacity is intended.
- Understand that adding app instances triggers rebalance.

### 16.2 Kubernetes Rules

For Kubernetes deployments:

- graceful shutdown period must cover close/commit behavior,
- readiness must fail during state restore/rebalance if service cannot serve,
- liveness must not kill long restore unless truly stuck,
- persistent volume decision must be explicit for large state stores,
- resource requests must include heap, RocksDB/native memory, page cache, and disk I/O.

### 16.3 State Restore

**MUST** monitor:

- restore duration,
- restore records,
- changelog lag,
- rebalance time,
- task migration,
- standby replicas.

---

## 17. Observability Rules

Every Kafka Streams app must expose:

- input rate,
- output rate,
- skipped records,
- deserialization errors,
- processing errors,
- commit latency,
- poll/process latency,
- task count,
- rebalance count/duration,
- state-store size,
- RocksDB metrics where relevant,
- restore progress,
- consumer lag,
- DLQ/late-event count,
- window drop count.

Logs must include:

- application ID,
- task ID if available,
- topic/partition/offset,
- event type,
- event ID,
- correlation ID,
- state-store name for state errors.

**MUST NOT** log full event payload by default.

---

## 18. Testing Rules

### 18.1 Required Test Types

Kafka Streams topology changes must include:

- topology unit test with `TopologyTestDriver`,
- SerDe test,
- key/repartition test,
- state-store test,
- window/late-event test if windowed,
- join test if joined,
- duplicate/replay test,
- invalid/corrupt event test,
- integration test with real Kafka for rebalance/restore-critical logic.

### 18.2 TopologyTestDriver Rules

**MUST**:

- Provide deterministic timestamps.
- Assert output topic records.
- Inspect state stores where relevant.
- Test tombstones/null values where relevant.
- Test old and new schema versions when migration happens.

**MUST NOT** rely only on happy-path record processing.

### 18.3 Determinism Tests

For stateful topology:

```text
same ordered input -> same state + same output
same duplicate input -> expected idempotent/duplicate behavior
late input within grace -> expected update
late input after grace -> expected drop/quarantine/metric
```

---

## 19. Performance Rules

Performance tuning must be evidence-based.

Review:

- partition count,
- key skew,
- state-store size,
- RocksDB write/read amplification,
- cache size,
- commit interval,
- processing guarantee cost,
- window retention,
- repartition traffic,
- serialization cost,
- restore time,
- standby replicas,
- container memory and disk I/O.

**MUST NOT**:

- increase stream threads blindly,
- disable cache blindly,
- switch to exactly-once without measuring latency/throughput impact,
- create unbounded state stores,
- use large windows without retention/disk planning.

---

## 20. Anti-Patterns

Forbidden unless explicitly approved:

- topology chains with no names/design note,
- no explicit SerDes,
- generated/random state-store names,
- external HTTP/DB calls in per-record mapping,
- `groupBy` without repartition awareness,
- null keys in stateful operations,
- unbounded aggregations,
- windowing without timestamp/grace policy,
- joins without co-partition/key proof,
- changing `application.id` casually,
- deleting internal topics to “fix” app state without migration plan,
- claiming exactly-once for external DB side effects,
- logging full records,
- tests only with mocks and no topology driver.

---

## 21. LLM Implementation Protocol

Before writing Kafka Streams code, the LLM must answer:

1. What is the topology input/output contract?
2. What is the key at every stateful step?
3. Which operations trigger repartition?
4. What stores are materialized and what are their names?
5. What SerDes are used for every key/value/store?
6. What timestamp policy is used?
7. What happens to late/out-of-order events?
8. What processing guarantee is required?
9. What happens on deserialization/processing/production error?
10. How is restore/rebalance observed?
11. What topology tests prove correctness?

If any answer is unknown, the LLM must not invent topology semantics. It must implement only the safe known portion and mark missing decisions.

---

## 22. Reviewer Checklist

Reject Kafka Streams code if any item fails:

- [ ] `application.id` is stable and justified.
- [ ] Input/output topics are documented.
- [ ] Key model is explicit for every stateful operation.
- [ ] Repartition points are identified.
- [ ] SerDes are explicit and compatible.
- [ ] State stores have stable names.
- [ ] Changelog/restore implications are understood.
- [ ] Window timestamp/grace/late-event policy exists if windowed.
- [ ] Joins have key/co-partition/window proof.
- [ ] Processing guarantee is explicitly configured.
- [ ] Error handling is explicit.
- [ ] No hidden external I/O in per-record path unless approved.
- [ ] Metrics cover rate, errors, lag, rebalance, restore, and state.
- [ ] TopologyTestDriver tests cover normal, duplicate, invalid, and late records.
- [ ] Integration test exists for stateful/rebalance-critical topology.

---

## 23. References

- Apache Kafka Streams Documentation: https://kafka.apache.org/documentation/streams/
- Apache Kafka Streams Processor API: https://kafka.apache.org/documentation/streams/developer-guide/processor-api/
- Confluent Kafka Streams Concepts: https://docs.confluent.io/platform/current/streams/concepts.html
- Confluent Kafka Streams Architecture: https://docs.confluent.io/platform/current/streams/architecture.html
- Kafka Streams Javadocs: https://kafka.apache.org/javadoc/
- Confluent Kafka Delivery Semantics: https://docs.confluent.io/kafka/design/delivery-semantics.html
