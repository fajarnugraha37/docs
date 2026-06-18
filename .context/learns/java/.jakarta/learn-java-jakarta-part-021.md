# learn-java-jakarta-part-021.md

# Bagian 21 — Jakarta Batch (`jakarta.batch`): Job, Step, Chunk, Checkpoint, Restartability, dan Production Batch Processing

> Target pembaca: Java engineer yang ingin memahami batch processing bukan sebagai “script yang dijalankan malam hari”, tetapi sebagai **controlled long-running data processing system**: job lifecycle, step orchestration, chunk processing, checkpoint, restartability, partitioning, retry/skip, transaction boundary, operational monitoring, dan failure recovery.
>
> Fokus bagian ini: Jakarta Batch 2.1, Job Specification Language / JSL, `JobOperator`, job instance/execution, step execution, batchlet, chunk, `ItemReader`, `ItemProcessor`, `ItemWriter`, checkpoint, restart, job repository, parameters, listeners, decision, split/flow, partitioning, transaction, skip/retry, idempotency, scheduling, observability, and production failure modes.

---

## Daftar Isi

1. [Orientasi: Kenapa Batch Processing Masih Penting?](#1-orientasi-kenapa-batch-processing-masih-penting)
2. [Mental Model: Batch sebagai Controlled Long-Running Work](#2-mental-model-batch-sebagai-controlled-long-running-work)
3. [Jakarta Batch 2.1 dan Package `jakarta.batch`](#3-jakarta-batch-21-dan-package-jakartabatch)
4. [Batch vs REST vs Messaging vs Streaming](#4-batch-vs-rest-vs-messaging-vs-streaming)
5. [Runtime, Job Repository, dan Operator](#5-runtime-job-repository-dan-operator)
6. [Dependency dan Packaging](#6-dependency-dan-packaging)
7. [Core Concepts: Job, Step, Execution, Instance](#7-core-concepts-job-step-execution-instance)
8. [Job Specification Language / JSL](#8-job-specification-language--jsl)
9. [Starting Jobs dengan `JobOperator`](#9-starting-jobs-dengan-joboperator)
10. [Job Parameters dan Properties](#10-job-parameters-dan-properties)
11. [Job Instance vs Job Execution](#11-job-instance-vs-job-execution)
12. [Batch Status vs Exit Status](#12-batch-status-vs-exit-status)
13. [Step: Unit of Work dalam Job](#13-step-unit-of-work-dalam-job)
14. [Batchlet Step](#14-batchlet-step)
15. [Chunk Step](#15-chunk-step)
16. [`ItemReader`](#16-itemreader)
17. [`ItemProcessor`](#17-itemprocessor)
18. [`ItemWriter`](#18-itemwriter)
19. [Checkpoint dan Restartability](#19-checkpoint-dan-restartability)
20. [Transaction Boundary dalam Chunk](#20-transaction-boundary-dalam-chunk)
21. [Skip dan Retry](#21-skip-dan-retry)
22. [Listeners](#22-listeners)
23. [Decision, Flow, Split](#23-decision-flow-split)
24. [Partitioning](#24-partitioning)
25. [Batch Artifacts dan CDI](#25-batch-artifacts-dan-cdi)
26. [Job Repository](#26-job-repository)
27. [Scheduling dan Triggering](#27-scheduling-dan-triggering)
28. [Input/Output Design](#28-inputoutput-design)
29. [Idempotency dalam Batch](#29-idempotency-dalam-batch)
30. [Restart, Rerun, Resume: Bedanya Apa?](#30-restart-rerun-resume-bedanya-apa)
31. [Large File Processing](#31-large-file-processing)
32. [Database Batch Processing](#32-database-batch-processing)
33. [External API Batch Processing](#33-external-api-batch-processing)
34. [Batch + Messaging + Outbox](#34-batch--messaging--outbox)
35. [Security dan Access Control](#35-security-dan-access-control)
36. [Observability dan Operations](#36-observability-dan-operations)
37. [Performance Engineering](#37-performance-engineering)
38. [Testing Strategy](#38-testing-strategy)
39. [Production Failure Modes](#39-production-failure-modes)
40. [Best Practices dan Anti-Patterns](#40-best-practices-dan-anti-patterns)
41. [Checklist Review](#41-checklist-review)
42. [Case Study 1: Nightly Data Archival](#42-case-study-1-nightly-data-archival)
43. [Case Study 2: Large CSV Import](#43-case-study-2-large-csv-import)
44. [Case Study 3: External System Reconciliation](#44-case-study-3-external-system-reconciliation)
45. [Case Study 4: Failed Job Restart Salah Desain](#45-case-study-4-failed-job-restart-salah-desain)
46. [Latihan Bertahap](#46-latihan-bertahap)
47. [Mini Project: Jakarta Batch Reliability Lab](#47-mini-project-jakarta-batch-reliability-lab)
48. [Referensi Resmi](#48-referensi-resmi)

---

# 1. Orientasi: Kenapa Batch Processing Masih Penting?

Banyak engineer modern fokus pada REST API, event-driven systems, dan stream processing.

Tetapi production system tetap penuh batch workload:

- nightly reconciliation;
- monthly billing;
- daily report generation;
- data archival;
- CSV import/export;
- migration;
- scheduled cleanup;
- retry backlog processing;
- search index rebuild;
- external agency file exchange;
- financial settlement;
- compliance audit extraction;
- notification digest;
- data warehouse load.

Batch adalah cara sistem memproses banyak data secara terkontrol.

## 1.1 Batch bukan cron + script asal jalan

Script sederhana:

```bash
0 1 * * * java -jar archive.jar
```

bisa cukup untuk pekerjaan kecil.

Tetapi enterprise batch butuh:

- job identity;
- execution tracking;
- checkpoint;
- restart;
- parameter;
- step orchestration;
- retry/skip;
- transaction boundary;
- error classification;
- operator controls;
- monitoring;
- audit;
- concurrency control.

Jakarta Batch menyediakan programming model dan runtime untuk hal tersebut.

## 1.2 Batch adalah reliability problem

Batch sering berjalan lama dan menyentuh banyak data.

Failure pasti terjadi:

- job mati di tengah;
- DB timeout;
- row corrupt;
- external API down;
- file setengah terbaca;
- output setengah tertulis;
- transaction timeout;
- duplicate processing;
- disk full;
- memory leak;
- cluster node restart.

Pertanyaan penting:

```text
Jika batch gagal setelah memproses 8 juta dari 10 juta record, apakah harus ulang dari awal?
```

Batch yang bagus bisa restart dari checkpoint atau minimal aman di-rerun.

## 1.3 Batch adalah operational system

Batch harus bisa dijawab oleh operator:

- job apa yang sedang jalan?
- berapa progress-nya?
- mulai kapan?
- input apa?
- parameter apa?
- gagal di step mana?
- error apa?
- apakah bisa restart?
- berapa record sukses/gagal?
- apakah output valid?
- apakah ada duplicate?
- kapan SLA selesai?

Tanpa observability, batch menjadi black box.

---

# 2. Mental Model: Batch sebagai Controlled Long-Running Work

Batch job adalah proses yang memproses kumpulan data dalam satu atau lebih step.

```text
Job
  ├─ Step 1: read source
  ├─ Step 2: transform
  ├─ Step 3: write target
  └─ Step 4: finalize/report
```

## 2.1 Job

Job adalah definisi pekerjaan.

Contoh:

```text
archive-old-cases
import-license-csv
generate-monthly-report
sync-external-agency
```

## 2.2 Job execution

Satu run dari job.

Contoh:

```text
archive-old-cases execution #728 started at 2026-06-12 01:00
```

## 2.3 Step

Step adalah unit pekerjaan dalam job.

```text
validate input
process records
write output
send summary
```

## 2.4 Chunk

Chunk step memproses item dalam potongan.

```text
read 100 items
process 100 items
write 100 items
commit
checkpoint
repeat
```

## 2.5 Batchlet

Batchlet step adalah task-style step.

```text
call stored procedure
move file
send summary
cleanup temp directory
```

## 2.6 Checkpoint

Checkpoint menyimpan posisi progress agar restart tidak harus dari nol.

## 2.7 Job repository

Job repository menyimpan metadata:

- job instance;
- job execution;
- step execution;
- status;
- checkpoint info;
- parameters;
- metrics.

## 2.8 Operator

Operator adalah pihak/API yang menjalankan, menghentikan, melihat, dan restart job.

Dalam Jakarta Batch, ini direpresentasikan oleh `JobOperator`.

---

# 3. Jakarta Batch 2.1 dan Package `jakarta.batch`

Jakarta Batch 2.1 menyediakan Java API dan XML-based Job Specification Language / JSL untuk mendefinisikan batch jobs dari reusable Java application artifacts.

Package penting:

```java
jakarta.batch.runtime
jakarta.batch.operations
jakarta.batch.api
jakarta.batch.api.chunk
jakarta.batch.api.chunk.listener
jakarta.batch.api.listener
jakarta.batch.api.partition
```

## 3.1 Jakarta EE 11

Jakarta EE 11 Platform mencantumkan Batch 2.1 sebagai bagian dari platform.

Walaupun halaman spesifikasi Batch 2.1 menyatakan release untuk Jakarta EE 10, Jakarta EE 11 Platform tetap menggunakan Batch 2.1.

## 3.2 Java SE dan Jakarta EE

Jakarta Batch didesain untuk Jakarta EE platform implementations dan juga Java SE environments.

Artinya job dapat berjalan di runtime EE atau runtime batch standalone jika implementation mendukung.

## 3.3 XML Job Specification Language

Batch job didefinisikan dengan XML.

Biasanya file diletakkan di:

```text
META-INF/batch-jobs/<job-name>.xml
```

Example:

```xml
<job id="archiveCases" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    <step id="archive">
        <chunk item-count="100">
            <reader ref="caseReader"/>
            <processor ref="caseProcessor"/>
            <writer ref="caseWriter"/>
        </chunk>
    </step>
</job>
```

Exact namespace/schema depends version/runtime.

## 3.4 API programming model

Artifacts are Java classes implementing interfaces:

- `Batchlet`;
- `ItemReader`;
- `ItemProcessor`;
- `ItemWriter`;
- listeners;
- partition mapper/collector/analyzer/reducer;
- decider.

## 3.5 Implementation

API only is not enough.

Need batch runtime implementation.

Examples in ecosystem include JBeret and runtime-provided batch implementation in Jakarta EE servers.

---

# 4. Batch vs REST vs Messaging vs Streaming

## 4.1 REST

Request-response.

Use when user/client needs immediate response.

## 4.2 Messaging

Asynchronous processing per message/command/event.

Use when work can be decoupled and triggered by events/queue.

## 4.3 Streaming

Continuous event processing.

Use for real-time continuous data flows.

## 4.4 Batch

Finite set of data processed as a job.

Use when:

- input is bounded;
- process can be scheduled;
- progress/checkpoint needed;
- restartability important;
- per-record processing large;
- operator visibility needed.

## 4.5 Decision table

| Requirement | Good fit |
|---|---|
| User asks current state | REST |
| Send email asynchronously | Messaging |
| Continuous event aggregation | Streaming |
| Nightly reconciliation | Batch |
| Monthly report generation | Batch |
| Process 50GB CSV | Batch |
| Real-time fraud detection | Streaming |
| External API sync once per hour | Batch or messaging depending shape |
| Data archival | Batch |

## 4.6 Batch + messaging combo

Batch can produce messages.

Messaging can trigger batch.

Example:

```text
Scheduled batch scans expired records
  ↓
publishes ArchiveRequested messages
```

or:

```text
FileUploaded event
  ↓
start import batch job
```

---

# 5. Runtime, Job Repository, dan Operator

## 5.1 Batch runtime

Batch runtime manages:

- job start;
- step execution;
- status;
- checkpoint;
- restart;
- listeners;
- partitioning;
- metrics;
- repository persistence.

## 5.2 Job repository

Repository stores job metadata.

Without job repository, restart/progress tracking becomes fragile.

## 5.3 Operator

`JobOperator` controls jobs.

Conceptual operations:

- start job;
- restart execution;
- stop execution;
- abandon execution;
- get job names;
- get job instances;
- get job executions;
- get step executions.

## 5.4 Operator as admin surface

A production system often wraps `JobOperator` in admin endpoint/CLI:

```text
POST /admin/batch/jobs/archiveCases/start
GET /admin/batch/executions/{id}
POST /admin/batch/executions/{id}/restart
POST /admin/batch/executions/{id}/stop
```

Secure heavily.

## 5.5 Runtime-specific admin

App servers may expose batch admin console/CLI.

Use runtime features where available.

## 5.6 Repository durability

If job repository data is lost, restart/progress history may be lost.

Treat it as operational state.

---

# 6. Dependency dan Packaging

## 6.1 Maven API dependency

```xml
<dependency>
  <groupId>jakarta.batch</groupId>
  <artifactId>jakarta.batch-api</artifactId>
  <version>2.1.1</version>
  <scope>provided</scope>
</dependency>
```

Use the version aligned with runtime.

## 6.2 Provided scope

In Jakarta EE runtime, API is usually provided.

## 6.3 Implementation

Standalone applications need batch implementation.

Example implementation family:

- JBeret;
- runtime app server batch implementation.

## 6.4 JSL location

Common packaging:

```text
src/main/resources/META-INF/batch-jobs/my-job.xml
```

Packaged into JAR/WAR/EAR.

## 6.5 Artifact discovery

Batch artifacts can be referenced by name in JSL.

Runtime resolves them via CDI/batch artifact loader depending implementation.

## 6.6 Avoid version mismatch

Problems:

- API 2.1 app on runtime supporting older Batch;
- namespace mismatch;
- provider-specific features used accidentally.

---

# 7. Core Concepts: Job, Step, Execution, Instance

## 7.1 Job definition

Static definition:

```text
archiveCases job
```

## 7.2 Job instance

A logical instance of job, usually determined by job name and identifying parameters.

Example:

```text
archiveCases for cutoffDate=2026-06-01
```

## 7.3 Job execution

A run attempt of job instance.

If job fails and restarts, new execution can belong to same instance.

```text
execution #101 failed
execution #102 restarted same instance
```

## 7.4 Step execution

Execution metadata for a step within job execution.

Includes:

- batch status;
- exit status;
- read count;
- write count;
- commit count;
- rollback count;
- skip count;
- timing.

## 7.5 Why instance vs execution matters

If processing input for date `2026-06-01` fails, restart should continue same logical job instance.

If you want rerun from scratch, maybe new parameter/run ID needed.

## 7.6 Operator consequences

`restart(executionId, properties)` restarts a failed/stopped execution.

`start(jobName, properties)` starts new execution/instance depending parameters.

Understand semantics before building admin UI.

---

# 8. Job Specification Language / JSL

JSL defines job structure in XML.

## 8.1 Simple batchlet job

```xml
<job id="cleanupTempFiles" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    <step id="cleanup">
        <batchlet ref="cleanupBatchlet"/>
    </step>
</job>
```

## 8.2 Chunk job

```xml
<job id="importCustomers" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    <step id="import">
        <chunk item-count="100">
            <reader ref="customerCsvReader"/>
            <processor ref="customerProcessor"/>
            <writer ref="customerWriter"/>
        </chunk>
    </step>
</job>
```

## 8.3 Flow

JSL can sequence steps.

```xml
<step id="validate" next="import">...</step>
<step id="import" next="summary">...</step>
<step id="summary">...</step>
```

## 8.4 Decision

JSL can route based on exit status.

## 8.5 Split

JSL can run flows in parallel.

## 8.6 Properties

JSL can inject properties into artifacts.

```xml
<properties>
    <property name="inputFile" value="#{jobParameters['inputFile']}"/>
</properties>
```

## 8.7 Externalizing operational parameter

Do not hardcode input date/file path in JSL.

Use job parameters.

---

# 9. Starting Jobs dengan `JobOperator`

## 9.1 Get operator

```java
JobOperator jobOperator = BatchRuntime.getJobOperator();
```

or inject depending runtime:

```java
@Inject
JobOperator jobOperator;
```

if supported.

## 9.2 Start job

```java
Properties props = new Properties();
props.setProperty("cutoffDate", "2026-06-01");

long executionId = jobOperator.start("archiveCases", props);
```

## 9.3 Restart job

```java
long newExecutionId = jobOperator.restart(failedExecutionId, props);
```

## 9.4 Stop job

```java
jobOperator.stop(executionId);
```

Stop is cooperative. Job must reach safe stop point.

## 9.5 Abandon job

Abandon marks failed/stopped execution as abandoned so it cannot be restarted.

Use carefully.

## 9.6 Query status

```java
JobExecution execution = jobOperator.getJobExecution(executionId);
BatchStatus status = execution.getBatchStatus();
```

## 9.7 Admin endpoint caution

Starting/stopping jobs is privileged.

Protect with strong authorization and audit.

---

# 10. Job Parameters dan Properties

## 10.1 Job parameters

Parameters define execution input:

```text
cutoffDate=2026-06-01
tenantId=CEA
inputFile=s3://bucket/file.csv
dryRun=false
```

## 10.2 Use explicit parameters

Bad:

```java
LocalDate.now().minusDays(1)
```

deep in reader.

Better:

```text
processingDate=2026-06-11
```

passed as parameter.

## 10.3 Reproducibility

A job should be reproducible by knowing:

- job name;
- parameters;
- code version;
- input version;
- configuration.

## 10.4 Parameters and identity

Parameter choice affects job instance identity.

Use stable identifying parameters.

## 10.5 Properties injection

Batch artifacts can receive properties from JSL.

## 10.6 Validate parameters early

First step should validate:

- required parameters;
- date format;
- tenant validity;
- input exists;
- output target safe;
- range allowed.

Fail fast.

---

# 11. Job Instance vs Job Execution

## 11.1 Example

Job:

```text
dailyReconciliation
```

Parameters:

```text
businessDate=2026-06-11
```

Job instance:

```text
dailyReconciliation[2026-06-11]
```

First run:

```text
execution #900 failed at record 450000
```

Restart:

```text
execution #901 continues/restarts same instance
```

## 11.2 New day

Parameters:

```text
businessDate=2026-06-12
```

Different job instance.

## 11.3 Rerun same day from scratch

You may need additional parameter:

```text
runId=manual-2
```

But be careful: this may create duplicate output if not designed.

## 11.4 Operational implication

Admin UI must show both logical instance and execution attempts.

## 11.5 Audit implication

Audit should record:

- who started;
- parameters;
- execution id;
- restart relationship;
- result.

---

# 12. Batch Status vs Exit Status

## 12.1 Batch status

Standard lifecycle status.

Common statuses:

- STARTING;
- STARTED;
- STOPPING;
- STOPPED;
- FAILED;
- COMPLETED;
- ABANDONED.

## 12.2 Exit status

Application-defined string status.

Examples:

```text
COMPLETED_WITH_WARNINGS
NO_INPUT
PARTIAL_SUCCESS
VALIDATION_FAILED
```

## 12.3 Why both?

Batch status tells runtime lifecycle.

Exit status tells business/application outcome.

## 12.4 Example

A job can technically complete but with skipped invalid records:

```text
BatchStatus = COMPLETED
ExitStatus = COMPLETED_WITH_SKIPS
```

## 12.5 Use exit status for flow decisions

JSL can route based on exit status.

## 12.6 Monitoring

Alert logic should consider both.

---

# 13. Step: Unit of Work dalam Job

Step is a phase within job.

## 13.1 Types

Two common types:

- batchlet step;
- chunk step.

## 13.2 Step boundaries

Step should represent meaningful operation:

```text
validate input
load data
process data
generate summary
archive file
```

## 13.3 Step restart

Restart behavior can depend on step type and checkpoint.

## 13.4 Step metrics

Step execution tracks counts/status.

## 13.5 Step as transaction boundary?

Not usually one transaction for entire step if huge.

Chunk step uses repeated transactions/checkpoints.

## 13.6 Step design rule

Keep step cohesive.

Do not make one giant step with many hidden phases.

---

# 14. Batchlet Step

Batchlet is task-oriented step.

## 14.1 Interface

Conceptual:

```java
@Named
public class CleanupBatchlet implements Batchlet {

    @Override
    public String process() throws Exception {
        // do task
        return "COMPLETED";
    }

    @Override
    public void stop() throws Exception {
        // request stop
    }
}
```

## 14.2 Use cases

- file move;
- cleanup;
- call stored procedure;
- generate summary;
- validate precondition;
- send notification;
- create manifest;
- finalization.

## 14.3 Long-running batchlet

If batchlet processes many records manually, you lose chunk/checkpoint benefits.

Prefer chunk for item processing.

## 14.4 Stop support

`stop()` should signal cooperative stopping.

Use volatile flag or managed mechanism.

## 14.5 Transaction

Batchlet transaction semantics depend runtime/config.

Avoid one huge transaction in batchlet.

## 14.6 Exit status

Return application exit status string.

---

# 15. Chunk Step

Chunk is item-oriented.

```text
reader → processor → writer
```

## 15.1 Flow

```text
open reader/writer
read item
process item
buffer item
repeat until item-count
write chunk
commit
checkpoint
repeat
close
```

## 15.2 item-count

Defines chunk size.

Example:

```xml
<chunk item-count="100">
```

Means commit/checkpoint after 100 items, subject to runtime details.

## 15.3 Why chunk?

Chunk processing:

- bounds transaction size;
- supports checkpoint;
- improves throughput;
- avoids loading all data;
- enables restart.

## 15.4 Chunk size trade-off

Small chunk:

- more commits;
- slower;
- less rework on failure.

Large chunk:

- fewer commits;
- faster;
- more memory;
- more rework on failure;
- longer locks.

## 15.5 Choose by data and side effects

Start with 100/500/1000 depending item cost, test.

## 15.6 Chunk output must be atomic or idempotent

If writer partially writes chunk outside transaction, restart can duplicate.

---

# 16. `ItemReader`

Reader reads input item.

## 16.1 Interface concept

```java
@Named
public class CustomerCsvReader implements ItemReader {

    @Override
    public void open(Serializable checkpoint) throws Exception {
        ...
    }

    @Override
    public Object readItem() throws Exception {
        ...
    }

    @Override
    public Serializable checkpointInfo() throws Exception {
        ...
    }

    @Override
    public void close() throws Exception {
        ...
    }
}
```

## 16.2 Responsibilities

- open input;
- resume from checkpoint;
- read one item;
- return null at end;
- provide checkpoint info;
- close resource.

## 16.3 Checkpoint info

For file:

```text
byte offset
line number
record ID
```

For database:

```text
last processed primary key
```

## 16.4 Reader must be deterministic

On restart, reader should produce same remaining items.

If source changes during job, restart semantics get tricky.

## 16.5 Avoid reading all data

Bad:

```java
List<Record> all = Files.readAllLines(...)
```

Use streaming.

## 16.6 Resource cleanup

Close file/cursor/connection.

## 16.7 Input mutation

Avoid processing source that changes concurrently unless explicitly designed.

---

# 17. `ItemProcessor`

Processor transforms/validates item.

## 17.1 Interface concept

```java
@Named
public class CustomerProcessor implements ItemProcessor {

    @Override
    public Object processItem(Object item) throws Exception {
        CustomerCsvRow row = (CustomerCsvRow) item;
        return validateAndMap(row);
    }
}
```

## 17.2 Return null

Returning null may filter item depending spec/runtime behavior.

Use intentionally.

## 17.3 Responsibilities

- validate item;
- transform to output type;
- enrich if needed;
- classify errors.

## 17.4 Keep processor pure where possible

Pure processor is easier to test.

Avoid external side effects inside processor.

## 17.5 External calls

If processor calls external API for each item, batch can be slow/flaky.

Consider:

- caching;
- bulk API;
- prefetch;
- separate step;
- rate limit;
- retry policy.

## 17.6 Error classification

Throw exceptions that skip/retry config can classify.

---

# 18. `ItemWriter`

Writer writes chunk of processed items.

## 18.1 Interface concept

```java
@Named
public class CustomerWriter implements ItemWriter {

    @Override
    public void open(Serializable checkpoint) throws Exception {
        ...
    }

    @Override
    public void writeItems(List<Object> items) throws Exception {
        ...
    }

    @Override
    public Serializable checkpointInfo() throws Exception {
        ...
    }

    @Override
    public void close() throws Exception {
        ...
    }
}
```

## 18.2 Responsibilities

- open output;
- write chunk;
- provide checkpoint info if needed;
- close output.

## 18.3 Database writer

Use batch insert/update.

Ensure transaction boundary aligns with chunk.

## 18.4 File writer

Writing output file needs restart-safe design.

Options:

- write temp file and rename at end;
- append with checkpoint offset;
- write idempotently by partition;
- avoid partial final file.

## 18.5 External API writer

Harder.

Need idempotency keys and retry/backoff.

## 18.6 Partial write danger

If writer sends 100 emails in chunk and fails at item 70, restart may resend first 69 unless idempotent.

## 18.7 Writer should be idempotent or transactional

This is critical.

---

# 19. Checkpoint dan Restartability

Checkpoint is saved progress.

## 19.1 Why checkpoint?

If job fails after 5 million records, restart from last checkpoint.

## 19.2 Checkpoint info

Stored by runtime via reader/writer checkpoint methods.

Examples:

- file offset;
- line number;
- last ID;
- page token;
- partition range;
- output pointer.

## 19.3 Good checkpoint

Good checkpoint is:

- serializable;
- small;
- stable;
- enough to resume;
- not dependent on volatile object;
- compatible across deployment if possible.

## 19.4 Bad checkpoint

Bad:

```java
return openJdbcConnection;
```

or:

```java
return hugeListOfProcessedItems;
```

## 19.5 Checkpoint frequency

Checkpoint usually tied to chunk commit.

More frequent checkpoint = less rework but more overhead.

## 19.6 Restart strategy

On restart:

```text
load checkpoint
open reader/writer with checkpoint
continue
```

## 19.7 Restart-safe output

Input checkpoint alone is insufficient if output may duplicate.

Design output idempotent.

---

# 20. Transaction Boundary dalam Chunk

## 20.1 Typical chunk transaction

```text
read/process N items
write N items
commit transaction
checkpoint
```

## 20.2 What transaction covers

In Jakarta EE, chunk can participate in transaction depending runtime and resource.

DB operations can commit per chunk.

## 20.3 Avoid huge transaction

Processing 10 million rows in one transaction:

- locks long;
- log grows;
- timeout;
- rollback huge;
- bad concurrency.

## 20.4 Commit interval

Chunk size is commit interval style.

Tune.

## 20.5 External side effects

External calls may not be transactional.

If writer calls HTTP API, rollback won't undo remote call.

Need idempotency/compensation.

## 20.6 Transaction timeout

Set appropriate timeout or keep chunk processing below timeout.

## 20.7 Deadlocks

Batch updates many rows; deadlocks possible.

Use ordering, chunk size, indexes, retry.

---

# 21. Skip dan Retry

## 21.1 Retry

Retry means same item/chunk attempted again after transient failure.

Use for:

- deadlock;
- timeout;
- temporary unavailable;
- transient network issue.

## 21.2 Skip

Skip means item is bad but job can continue.

Use for:

- invalid CSV row;
- non-critical data error;
- unknown optional code;
- business validation failure if allowed.

## 21.3 Not all errors are skippable

Security/integrity errors should fail job.

## 21.4 Skip limit

Set skip limit.

If too many bad records, fail job.

## 21.5 Retry limit

Set retry limit and backoff where supported/provider-specific.

## 21.6 Error report

Skipped items should be recorded for review.

## 21.7 Retry + idempotency

If writer partially succeeded, retry can duplicate.

Ensure idempotency.

---

# 22. Listeners

Listeners observe job/step/chunk/item lifecycle.

## 22.1 Use cases

- logging;
- metrics;
- audit;
- setup/cleanup;
- summary generation;
- error reporting;
- progress tracking.

## 22.2 Listener types

Examples:

- job listener;
- step listener;
- chunk listener;
- item read/process/write listeners;
- skip/retry listeners;
- partition listeners.

## 22.3 Do not put core logic in listener

Listeners should observe/support, not hide main business processing.

## 22.4 Error in listener

Listener failure can fail job.

Handle carefully.

## 22.5 Metrics

Use listener to increment counts and timings, but avoid per-item high-cardinality logs.

## 22.6 Audit

Job start/stop/fail events can be recorded via listeners.

---

# 23. Decision, Flow, Split

## 23.1 Flow

Group of steps.

## 23.2 Decision

Custom decider can route based on status/properties.

Example:

```text
if validation exitStatus = NO_INPUT
  → end
else
  → import
```

## 23.3 Split

Runs flows in parallel.

Use for independent branches.

## 23.4 Parallel risk

Parallel flows can contend for:

- DB locks;
- CPU;
- disk;
- external APIs;
- job repository.

## 23.5 Keep flow understandable

JSL can become complex.

Document job graph.

## 23.6 State transitions

Think of job as state machine.

---

# 24. Partitioning

Partitioning splits step work into partitions.

## 24.1 Use case

Process large data faster:

```text
partition 1: id 1-1,000,000
partition 2: id 1,000,001-2,000,000
...
```

## 24.2 Partition mapper

Defines partitions.

## 24.3 Partition reducer

Aggregates results / handles begin/end.

## 24.4 Partition analyzer/collector

Collects partition status/data.

## 24.5 Partition plan

Can be static or dynamic.

## 24.6 Partition key choice

Good partition key:

- balanced;
- deterministic;
- no overlap;
- covers all data;
- aligns with indexes;
- avoids hot spots.

## 24.7 Danger

Partitions can duplicate or miss data if ranges wrong.

## 24.8 Partition + idempotency

Even with non-overlapping partitions, restart can duplicate output if writer not idempotent.

---

# 25. Batch Artifacts dan CDI

## 25.1 Batch artifact

Artifacts:

- batchlet;
- reader;
- processor;
- writer;
- listener;
- decider;
- partition mapper/reducer/etc.

## 25.2 CDI injection

Modern Jakarta Batch implementations can integrate with CDI.

Example:

```java
@Named("caseReader")
public class CaseReader implements ItemReader {

    @Inject
    CaseRepository repository;
}
```

## 25.3 Scope

Artifacts may be instantiated per job/step/execution depending runtime.

Do not assume singleton unless specified/provider.

## 25.4 Avoid mutable static state

Batch jobs can run concurrently.

Static mutable state causes cross-execution bugs.

## 25.5 Job properties injection

Use batch property injection mechanism/provider-supported injection for JSL properties.

## 25.6 Test artifact independently

Reader/processor/writer should be testable outside runtime.

---

# 26. Job Repository

## 26.1 What it stores

- job instance metadata;
- execution metadata;
- step execution metadata;
- checkpoint info;
- parameters;
- status;
- timestamps;
- metrics.

## 26.2 Why it matters

Restart depends on repository.

Monitoring depends on repository.

Audit may use repository, but don't rely solely if compliance needs durable business audit.

## 26.3 Repository DB

Implementation may use database tables.

Plan:

- backup;
- retention;
- cleanup;
- performance;
- indexes;
- isolation.

## 26.4 Metadata retention

Do not let job repository grow forever.

Archive old executions.

## 26.5 Operational query

Operators need fast query:

- running jobs;
- failed jobs;
- recent executions;
- long-running steps.

## 26.6 Don't put business data in checkpoint

Checkpoint should be operational metadata, not huge business payload.

---

# 27. Scheduling dan Triggering

Jakarta Batch defines job runtime but not necessarily enterprise scheduler.

## 27.1 Trigger options

- cron/system scheduler;
- Jakarta Enterprise Beans timer;
- external scheduler;
- Kubernetes CronJob;
- CI/CD orchestration;
- admin API;
- message/event trigger.

## 27.2 Scheduler responsibility

Scheduler decides when to start.

Batch runtime executes and tracks.

## 27.3 Prevent duplicate starts

If scheduler fires twice, avoid concurrent duplicate job if not allowed.

Use:

- job parameters uniqueness;
- lock table;
- scheduler concurrency policy;
- runtime job status check.

## 27.4 Manual trigger

Manual trigger must be audited.

## 27.5 Timezone

Scheduled business date should be explicit.

```text
businessDate=2026-06-12
```

not inferred inconsistently from server timezone.

## 27.6 Missed schedule

Define what happens if job missed:

- catch up;
- skip;
- run latest only;
- alert.

---

# 28. Input/Output Design

## 28.1 Input source types

- database query;
- file;
- object storage;
- external API;
- message queue;
- previous job output.

## 28.2 Input immutability

Best input is immutable snapshot.

For DB:

- use cutoff timestamp;
- stable ID list;
- snapshot table;
- status flag.

For file:

- immutable file name/checksum.

## 28.3 Output types

- database updates;
- file export;
- messages;
- reports;
- external API calls;
- audit rows.

## 28.4 Output atomicity

For file output:

```text
write temp file → validate → rename final
```

For database:

```text
chunk transaction
```

For external API:

```text
idempotency key
```

## 28.5 Manifest

For file batch, create manifest:

```text
input checksum
record count
success count
failure count
output file
job execution id
```

## 28.6 Reconciliation

Batch should be reconcilable:

```text
input count = success + skipped + failed
```

---

# 29. Idempotency dalam Batch

## 29.1 Why idempotency?

Jobs can restart or rerun.

Without idempotency, duplicates happen.

## 29.2 Techniques

- unique constraint;
- processed-item table;
- upsert;
- version check;
- status transition guard;
- deterministic output path;
- idempotency key for external API;
- delete-and-rebuild isolated output;
- temp then rename.

## 29.3 Item idempotency

Each item should have stable identity.

```text
recordId
caseId
externalReference
line number + file checksum
```

## 29.4 Job idempotency

Same job parameters should not create duplicate business effect.

## 29.5 Side effects

Email/API/file generation need explicit dedup.

## 29.6 Exactly-once

Batch with restart is at-least-once at item level unless carefully transactional.

Design for effectively-once.

---

# 30. Restart, Rerun, Resume: Bedanya Apa?

## 30.1 Restart

Continue failed/stopped execution using checkpoint.

```text
failed at item 5000
restart from checkpoint near 5000
```

## 30.2 Rerun

Start job again from beginning.

May need new job instance/parameters.

## 30.3 Resume

Informal term similar to restart.

## 30.4 Reprocess

Intentionally process data again.

Needs idempotent/overwrite semantics.

## 30.5 Operator UI

Use precise terms:

- Start new job;
- Restart failed execution;
- Stop running execution;
- Abandon execution;
- Rerun with new run ID.

## 30.6 Business approval

Manual rerun of critical batch may need approval/audit.

---

# 31. Large File Processing

## 31.1 Do not load entire file

Use streaming reader.

## 31.2 Checkpoint

Use:

- line number;
- byte offset;
- record sequence;
- file checksum.

## 31.3 File consistency

Ensure file does not change during processing.

Use immutable staging path.

## 31.4 Validate before process

Optional pre-validation step:

- file exists;
- checksum;
- header;
- schema;
- size;
- encoding.

## 31.5 Bad row handling

Skip invalid rows with report if business allows.

## 31.6 Output

Write invalid rows to reject file.

## 31.7 Encoding

Specify character set.

## 31.8 Memory

Avoid accumulating all errors in memory.

Stream error report.

---

# 32. Database Batch Processing

## 32.1 Reader strategies

- cursor reader;
- paging reader;
- keyset reader;
- preselected ID list;
- partitioned ranges.

## 32.2 Offset pagination risk

Large offset is slow and unstable under changes.

Prefer keyset/ID range for large data.

## 32.3 Stable snapshot

If source changes while job runs, results may be inconsistent.

Use:

- cutoff timestamp;
- status claim;
- snapshot table;
- transaction isolation if feasible.

## 32.4 Claiming rows

For multi-worker batch:

```sql
update table
set status='PROCESSING'
where status='PENDING'
fetch first N rows
```

Exact SQL depends DB.

## 32.5 Lock contention

Batch updates can affect OLTP workload.

Run off-peak, throttle, use small chunks.

## 32.6 Indexes

Batch selection predicates need indexes.

## 32.7 Vacuum/space

Large archival/delete jobs affect DB storage and logs.

Plan maintenance.

---

# 33. External API Batch Processing

## 33.1 Challenge

External API can be:

- slow;
- rate-limited;
- flaky;
- non-idempotent;
- inconsistent.

## 33.2 Use rate limiter

Respect provider limits.

## 33.3 Timeout

Every call must have timeout.

## 33.4 Retry

Retry transient errors with backoff.

## 33.5 Idempotency key

For write calls, use idempotency key if provider supports.

## 33.6 Circuit breaker

If API down, stop/park job rather than hammering.

## 33.7 Store response

Store external reference/status for reconciliation.

## 33.8 Do not hold DB transaction during slow API call

Use stage/update pattern.

---

# 34. Batch + Messaging + Outbox

## 34.1 Batch producing messages

Batch may publish messages per item.

Danger:

- duplicates on restart;
- broker down;
- transaction mismatch.

## 34.2 Use outbox

Batch writes outbox rows in DB transaction.

Relay publishes.

## 34.3 Batch consuming messages?

If processing finite queue backlog, batch can drain queue, but messaging consumer may be better.

## 34.4 Event replay batch

Batch can reprocess event log into read model.

Need offset/checkpoint.

## 34.5 Summary events

At job completion, publish:

```text
BatchJobCompleted
BatchJobFailed
```

for monitoring.

## 34.6 Idempotent consumers

Messages from batch can duplicate if job restarts.

Consumers must be idempotent.

---

# 35. Security dan Access Control

## 35.1 Who can start job?

Batch operations are privileged.

Roles:

- BATCH_VIEWER;
- BATCH_OPERATOR;
- BATCH_ADMIN.

## 35.2 Parameter validation

User-provided parameters can be dangerous:

- file path traversal;
- huge date range;
- wrong tenant;
- destructive mode.

Validate and authorize.

## 35.3 Data access

Batch may access sensitive data.

Use least privilege.

## 35.4 Audit

Audit:

- start;
- stop;
- restart;
- abandon;
- parameter;
- actor;
- result.

## 35.5 Secrets

Batch jobs may need external credentials.

Use secret manager/runtime config.

## 35.6 Multi-tenant batch

Ensure tenant parameter enforced in queries/output.

## 35.7 Output security

Reports/exports should be protected and retained according to policy.

---

# 36. Observability dan Operations

## 36.1 Metrics

Track:

- job start/completion/failure;
- duration;
- step duration;
- read count;
- write count;
- skip count;
- retry count;
- commit count;
- rollback count;
- throughput records/sec;
- current progress;
- backlog.

## 36.2 Logs

Include:

- job name;
- execution id;
- step id;
- partition id;
- correlation id/run id;
- record key for errors;
- summarized counts.

Avoid per-record noisy logs unless sampled or error-only.

## 36.3 Progress

For long jobs, expose progress:

```text
processed / estimated total
```

If total unknown, expose throughput and last processed key.

## 36.4 Alerts

Alert on:

- job failed;
- job stuck;
- job SLA exceeded;
- skip count above threshold;
- retry storm;
- DLQ/output error;
- no job run by expected time.

## 36.5 Runbook

Every production batch should have runbook:

- purpose;
- schedule;
- parameters;
- restart procedure;
- rerun procedure;
- output validation;
- common failures;
- contacts.

## 36.6 Dashboard

Batch dashboard should show recent/running/failed jobs.

---

# 37. Performance Engineering

## 37.1 Throughput model

Throughput depends on:

- reader speed;
- processor CPU;
- writer speed;
- chunk size;
- transaction overhead;
- DB indexes;
- external API rate;
- partition count;
- IO bandwidth.

## 37.2 Bottleneck detection

Measure per phase:

```text
read time
process time
write time
commit time
```

## 37.3 Chunk size tuning

Test multiple chunk sizes.

Too small: overhead.

Too large: memory/lock/rework.

## 37.4 Partitioning

Use when single-thread processing too slow and data can be safely split.

## 37.5 Avoid per-item DB query

N+1 in batch is deadly.

Use bulk fetch/cache/join.

## 37.6 Bulk write

Use JDBC batch/JPA batching/provider features.

## 37.7 Memory

Do not store all processed items.

## 37.8 GC

Large object allocations in processor/writer can hurt.

## 37.9 External API

Bulk endpoint > per-item call if available.

---

# 38. Testing Strategy

## 38.1 Unit tests

Test:

- processor logic;
- reader parsing;
- writer mapping;
- policy classification.

## 38.2 Integration tests

Run real batch runtime for small dataset.

Verify:

- job status;
- step status;
- output;
- repository metadata.

## 38.3 Restart tests

Force failure after N items.

Restart.

Assert:

- no duplicates;
- no missing records;
- checkpoint used;
- final counts correct.

## 38.4 Skip/retry tests

Inject bad row and transient failure.

Verify skip/retry counts.

## 38.5 Performance tests

Run realistic volume.

Measure throughput.

## 38.6 Partition tests

Verify no overlap/missing ranges.

## 38.7 Concurrency tests

Start duplicate job concurrently.

Ensure lock/prevention.

## 38.8 Idempotency tests

Run same job twice.

Expected behavior documented.

## 38.9 Chaos tests

- kill process mid-chunk;
- DB restart;
- disk full;
- external API timeout;
- file missing.

---

# 39. Production Failure Modes

## 39.1 Job cannot restart

Cause:

- no checkpoint;
- checkpoint unserializable;
- output not restart-safe.

## 39.2 Duplicate output after restart

Cause:

- writer not idempotent;
- external side effect not deduped;
- checkpoint after partial write.

## 39.3 Missing records

Cause:

- paging over changing data;
- partition range gap;
- incorrect checkpoint.

## 39.4 Infinite retry

Cause:

- permanent bad row classified retryable.

## 39.5 Too many skips silently

Cause:

- high skip limit/no alert.

## 39.6 DB lock storm

Cause:

- huge chunk;
- poor index;
- concurrent OLTP.

## 39.7 Job repository grows forever

Cause:

- no retention cleanup.

## 39.8 Scheduler duplicate run

Cause:

- overlapping schedule;
- no lock.

## 39.9 File half-written

Cause:

- writing directly to final path.

## 39.10 External API rate limit

Cause:

- partitioned job too parallel.

## 39.11 Memory OOM

Cause:

- read all file;
- accumulate error list;
- large chunk.

## 39.12 Operator restarts wrong execution

Cause:

- poor UI/runbook and ambiguous parameters.

---

# 40. Best Practices dan Anti-Patterns

## 40.1 Best practices

- Use explicit job parameters.
- Validate parameters early.
- Use chunk for item processing.
- Use batchlet for task steps.
- Make reader/writer checkpoint-aware.
- Make output idempotent.
- Design restart before coding.
- Use small durable checkpoint.
- Monitor progress.
- Record audit.
- Use runbook.
- Avoid business side effects without idempotency.
- Use outbox for message side effects.
- Test restart and duplicate scenarios.
- Tune chunk size with data.

## 40.2 Anti-pattern: One giant transaction

Bad for locks, timeout, rollback.

## 40.3 Anti-pattern: No checkpoint

Failure means start over.

## 40.4 Anti-pattern: Offset pagination on changing table

Can skip/duplicate records.

## 40.5 Anti-pattern: File output final path directly

Crash creates corrupt final file.

## 40.6 Anti-pattern: Email/API call in writer without idempotency

Restart duplicates side effects.

## 40.7 Anti-pattern: Batch as hidden business logic

Document job purpose and rules.

## 40.8 Anti-pattern: No operator visibility

Batch black box causes incidents.

---

# 41. Checklist Review

## 41.1 Job design

- [ ] Job purpose clear?
- [ ] Parameters explicit?
- [ ] Job instance identity understood?
- [ ] Restart/rerun behavior defined?
- [ ] Runbook exists?

## 41.2 Step design

- [ ] Step boundaries meaningful?
- [ ] Chunk vs batchlet chosen correctly?
- [ ] Chunk size tuned?
- [ ] Transaction timeout safe?
- [ ] Listeners used for metrics/audit only?

## 41.3 Restartability

- [ ] Reader checkpoint correct?
- [ ] Writer restart-safe?
- [ ] Output idempotent?
- [ ] Restart test exists?
- [ ] Duplicate test exists?

## 41.4 Error handling

- [ ] Retryable exceptions classified?
- [ ] Skippable exceptions classified?
- [ ] Skip/retry limits set?
- [ ] Error report generated?
- [ ] Alerts configured?

## 41.5 Operations

- [ ] Job repository persistent?
- [ ] Metadata retention configured?
- [ ] Progress visible?
- [ ] SLA alert configured?
- [ ] Manual start/restart audited?
- [ ] Duplicate schedule prevented?

## 41.6 Security

- [ ] Admin operations protected?
- [ ] Parameters authorized?
- [ ] Output protected?
- [ ] Sensitive logs avoided?

---

# 42. Case Study 1: Nightly Data Archival

## 42.1 Requirement

Archive closed cases older than 7 years.

## 42.2 Design

Job:

```text
archiveClosedCases
```

Parameters:

```text
cutoffDate
tenantId
dryRun
```

Steps:

1. validate parameters;
2. select candidate case IDs;
3. archive documents/metadata in chunks;
4. verify archive count;
5. mark cases archived;
6. generate summary report.

## 42.3 Checkpoint

Use last processed case ID.

## 42.4 Idempotency

If case already archived, skip/no-op.

## 42.5 Transaction

Commit per chunk.

## 42.6 Audit

Record:

- cutoff;
- count;
- actor/scheduler;
- archive location;
- checksum.

## 42.7 Failure recovery

Restart continues from checkpoint.

---

# 43. Case Study 2: Large CSV Import

## 43.1 Requirement

Import 5GB CSV of license holders.

## 43.2 Design

Chunk step:

```text
CSV reader → validator/mapper → DB writer
```

## 43.3 Checkpoint

Line number + file checksum.

## 43.4 Bad rows

Skip invalid rows up to threshold.

Write reject file.

## 43.5 DB writer

Use batch insert/upsert.

## 43.6 Restart

On restart, resume from line checkpoint.

Writer uses unique external ID to avoid duplicate.

## 43.7 Output summary

```text
total rows
inserted
updated
skipped
failed
reject file path
```

---

# 44. Case Study 3: External System Reconciliation

## 44.1 Requirement

Compare local records with external agency records daily.

## 44.2 Challenges

- API rate limit;
- network timeout;
- partial data;
- external inconsistency;
- SLA.

## 44.3 Design

Steps:

1. fetch external snapshot manifest;
2. partition by region/range;
3. compare records;
4. write discrepancy table;
5. generate report;
6. notify operators.

## 44.4 API call strategy

Use timeout, retry, rate limiter.

Do not hold DB transaction during API call.

## 44.5 Idempotency

Discrepancy record unique by:

```text
businessDate + externalId + discrepancyType
```

## 44.6 Restart

Each partition checkpoint stores last external ID/page token.

---

# 45. Case Study 4: Failed Job Restart Salah Desain

## 45.1 Problem

Batch sends email reminders in writer.

Job fails after sending 70 out of 100 emails in chunk.

Transaction rolls back, checkpoint not saved.

Restart resends those 70 emails.

## 45.2 Root cause

External side effect inside chunk writer without idempotency/outbox.

## 45.3 Fix options

Option A:

```text
writer inserts email_request rows
email worker sends idempotently
```

Option B:

```text
writer sends with email_request_id idempotency and records sent before side effect
```

Option C:

```text
avoid email in batch; publish outbox events
```

## 45.4 Lesson

Restartability is not just reader checkpoint. Writer side effect matters more.

---

# 46. Latihan Bertahap

## Latihan 1 — Batchlet job

Create simple batchlet that prints job parameter.

## Latihan 2 — Chunk CSV import

Implement reader/processor/writer for small CSV.

## Latihan 3 — Checkpoint

Fail after N rows, restart.

Verify no duplicate.

## Latihan 4 — Skip invalid row

Configure skip for validation exception.

Generate reject report.

## Latihan 5 — Retry transient DB error

Simulate deadlock/temporary exception.

Verify retry.

## Latihan 6 — JobOperator admin

Start job and query execution status.

## Latihan 7 — Decision flow

If validation returns NO_INPUT, skip import step.

## Latihan 8 — Partition by ID range

Process records in 4 partitions.

Verify no overlap/missing.

## Latihan 9 — Output temp file

Write export to temp then rename final after success.

## Latihan 10 — Outbox side effect

Batch writes outbox rows, relay publishes messages.

---

# 47. Mini Project: Jakarta Batch Reliability Lab

## 47.1 Goal

Create:

```text
jakarta-batch-reliability-lab/
```

## 47.2 Modules

```text
batchlet-basic/
chunk-csv-import/
checkpoint-restart/
skip-retry/
job-operator-admin/
decision-flow/
partitioning/
database-batch/
external-api-batch/
outbox-batch/
observability/
```

## 47.3 Deliverables

```text
README.md
BATCH-MENTAL-MODEL.md
JOB-DESIGN.md
JSL-GUIDE.md
CHECKPOINT-RESTART.md
CHUNK-TRANSACTION.md
SKIP-RETRY.md
PARTITIONING.md
IDEMPOTENCY.md
OPERATIONS-RUNBOOK.md
FAILURE-MODES.md
```

## 47.4 Required experiments

1. Start job with parameters.
2. Query job execution status.
3. Process chunked CSV.
4. Fail and restart from checkpoint.
5. Skip bad records.
6. Retry transient failure.
7. Partition data.
8. Prevent duplicate schedule.
9. Generate audit summary.
10. Run chaos test kill process mid-job.

## 47.5 Evaluation questions

1. What is difference between job instance and execution?
2. What is checkpoint?
3. Why is writer idempotency critical?
4. When use batchlet vs chunk?
5. What does `JobOperator` do?
6. What is difference between batch status and exit status?
7. Why is offset pagination risky?
8. How do you restart a file import safely?
9. How do you prevent duplicate side effects?
10. What metrics are needed for batch operations?

---

# 48. Referensi Resmi

Referensi utama:

1. Jakarta Batch 2.1  
   https://jakarta.ee/specifications/batch/2.1/

2. Jakarta Batch 2.1 Specification  
   https://jakarta.ee/specifications/batch/2.1/jakarta-batch-spec-2.1

3. Jakarta Batch API Docs  
   https://jakarta.ee/specifications/batch/2.1/apidocs/

4. Jakarta Batch Tutorial  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/batch-processing/batch-processing.html

5. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

6. Jakarta EE Platform 11  
   https://jakarta.ee/specifications/platform/11/

7. Jakarta Transactions 2.0  
   https://jakarta.ee/specifications/transactions/2.0/

8. Jakarta Messaging 3.1  
   https://jakarta.ee/specifications/messaging/3.1/

9. Jakarta Concurrency 3.1  
   https://jakarta.ee/specifications/concurrency/3.1/

10. Jakarta Batch Project  
    https://projects.eclipse.org/projects/ee4j.batch

---

# Penutup

Jakarta Batch memberi standard untuk batch application development:

```text
JSL:
  defines job structure

JobOperator:
  starts/stops/restarts/queries jobs

Job Repository:
  stores execution metadata and checkpoints

Batchlet:
  task-oriented step

Chunk:
  item-oriented processing with reader/processor/writer

Checkpoint:
  restart progress

Skip/Retry:
  controlled failure handling

Partition:
  parallel processing
```

Prinsip paling penting:

```text
Batch correctness is restart correctness.
```

Batch yang hanya sukses saat tidak ada failure belum production-grade.

Production-grade batch harus menjawab:

- jika gagal di tengah, apakah aman restart?
- apakah output duplicate?
- apakah input berubah?
- apakah checkpoint cukup?
- apakah writer idempotent?
- apakah operator tahu progress?
- apakah ada audit?
- apakah job bisa dihentikan?
- apakah rerun aman?
- apakah SLA dimonitor?

Engineer top-tier tidak hanya membuat job berjalan. Ia mendesain batch agar aman saat job mati, node restart, DB deadlock, file corrupt, external API timeout, dan operator perlu restart jam 2 pagi tanpa merusak data.

Bagian berikutnya akan membahas **Jakarta Concurrency (`jakarta.enterprise.concurrent`)**: managed executor, managed scheduled executor, context propagation, async tasks, thread ownership, virtual threads, cancellation, timeout, and production concurrency design.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 20 — Jakarta Mail (`jakarta.mail`): SMTP, MIME, Attachment, dan Production Email Pipeline](./learn-java-jakarta-part-020.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 22 — Jakarta Concurrency (`jakarta.enterprise.concurrent`): Managed Threads, Async Task, Context Propagation, dan Resource Safety](./learn-java-jakarta-part-022.md)
